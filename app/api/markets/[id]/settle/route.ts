import { z } from "zod";

import {
  ApiError,
  apiError,
  apiOk,
  requireAdminSession,
  requireSameOrigin,
  serviceClient,
} from "@/lib/api/session";
import { formatUsdc, maxLossUnits, parseUsdcColumn, settlementPayoutUnits } from "@/lib/chain/amount";
import type { MarketSide } from "@/lib/types/database.types";
import { firstIssue, marketSideSchema, uuidSchema } from "@/lib/validation/common";

/**
 * POST /api/markets/[id]/settle -- admin force-settlement of a market against
 * the custodial USDC ledger.
 *
 * The money model, stated once so the arithmetic below is checkable:
 *
 *   A binary contract settles at 100c. Every fill pairs a YES holder at price p
 *   with a NO holder at the implied price (100 - p) for q contracts, and each
 *   side escrowed exactly its own max loss when it placed the order:
 *
 *       yes side stake = p * q cents
 *       no  side stake = (100 - p) * q cents
 *       ----------------------------------
 *       total          = 100 * q cents = settlementPayoutUnits(q)
 *
 *   So the winner's 100c-per-contract payout is not created from anywhere: it
 *   is precisely the two escrowed stakes of that fill. Settling it correctly
 *   means moving the LOSER's stake from their escrow to the winner's available
 *   (payout_usdc_escrow), and returning the winner's OWN stake from their own
 *   escrow to their own available (release_usdc_escrow). Nothing is minted and
 *   nothing is destroyed -- the sum of every user's three buckets is unchanged
 *   by this route, which is what keeps the solvency query in 014 true.
 *
 * Escrow is held per ORDER at max loss, and orders may over-escrow relative to
 * what they actually risked (price improvement on the fill, or a partially
 * filled / never filled resting order). So the accounting here is per USER
 * rather than per lock:
 *
 *     residual(u) = sum of u's open locks for this market
 *                 - sum of the stakes u loses on this market's fills
 *
 * residual(u) is what returns to u's available; everything else was owed away.
 * That handles the market's own exit mechanic for free: buying the opposite
 * side means holding both a winning and a losing fill, and the winning fill's
 * own stake simply falls out as part of the residual.
 */

const settleSchema = z.object({
  outcome: marketSideSchema,
});

type Db = Awaited<ReturnType<typeof serviceClient>>;

type PairPayout = {
  loserId: string;
  winnerId: string;
  units: bigint;
  contracts: number;
};

type UserAccount = {
  /** Total stake this user forfeits across every fill they lost. */
  losingUnits: bigint;
  /** Total still-open escrow this user has locked against this market. */
  lockedUnits: bigint;
  lockIds: string[];
};

type Settlement = {
  payouts: PairPayout[];
  accounts: Map<string, UserAccount>;
  fillCount: number;
};

function account(accounts: Map<string, UserAccount>, userId: string): UserAccount {
  let existing = accounts.get(userId);
  if (!existing) {
    existing = { losingUnits: 0n, lockedUnits: 0n, lockIds: [] };
    accounts.set(userId, existing);
  }
  return existing;
}

/**
 * Reads fills and open escrow locks and works out every movement, WITHOUT
 * making any. Separated from execution on purpose: the invariant checks below
 * must be able to abort before the first dollar moves, since a settlement that
 * fails halfway cannot be rolled back from a route handler.
 */
async function planSettlement(db: Db, marketId: string, outcome: MarketSide): Promise<Settlement> {
  const { data: fills, error: fillsError } = await db
    .from("market_fills")
    .select("yes_user_id, no_user_id, yes_price, quantity")
    .eq("market_id", marketId);

  if (fillsError) {
    console.error("[markets/settle] could not read fills", fillsError);
    throw new ApiError(500, "Could not read this market's positions");
  }

  const { data: locks, error: locksError } = await db
    .from("usdc_escrow_locks")
    .select("id, user_id, amount")
    .eq("market_id", marketId)
    .eq("status", "open");

  if (locksError) {
    console.error("[markets/settle] could not read escrow locks", locksError);
    throw new ApiError(500, "Could not read this market's escrow");
  }

  const accounts = new Map<string, UserAccount>();
  const pairs = new Map<string, PairPayout>();

  for (const fill of fills ?? []) {
    const winnerId = outcome === "yes" ? fill.yes_user_id : fill.no_user_id;
    const loserId = outcome === "yes" ? fill.no_user_id : fill.yes_user_id;
    const loserSide: MarketSide = outcome === "yes" ? "no" : "yes";

    // Both stakes come from maxLossUnits against the fill's own yes_price, so
    // the cent -> base-unit conversion happens in exactly one audited place.
    const winnerStake = maxLossUnits(outcome, fill.yes_price, fill.quantity);
    const loserStake = maxLossUnits(loserSide, fill.yes_price, fill.quantity);

    // The conservation invariant, asserted per fill rather than trusted: the
    // winner's 100c-per-contract payout must be exactly the two stakes.
    if (winnerStake + loserStake !== settlementPayoutUnits(fill.quantity)) {
      console.error("[markets/settle] fill stakes do not sum to the payout", marketId, fill);
      throw new ApiError(500, "Refusing to settle: position arithmetic does not balance");
    }

    account(accounts, loserId).losingUnits += loserStake;
    account(accounts, winnerId); // ensure winners exist in the map even at zero

    const key = `${loserId}>${winnerId}`;
    const pair = pairs.get(key);
    if (pair) {
      pair.units += loserStake;
      pair.contracts += fill.quantity;
    } else {
      pairs.set(key, { loserId, winnerId, units: loserStake, contracts: fill.quantity });
    }
  }

  for (const lock of locks ?? []) {
    const entry = account(accounts, lock.user_id);
    entry.lockedUnits += parseUsdcColumn(lock.amount);
    entry.lockIds.push(lock.id);
  }

  // The one thing that must never be attempted: paying out more of a user's
  // escrow than they actually have locked against this market. That would
  // either fail partway through (leaving a half-settled market) or, worse,
  // consume escrow they hold for a different market. It happens if fills exist
  // that were placed through the non-escrowed server action rather than this
  // API, so it is a real state to guard, not a theoretical one.
  for (const [userId, entry] of accounts) {
    if (entry.losingUnits > entry.lockedUnits) {
      console.error(
        "[markets/settle] escrow does not cover obligations",
        marketId,
        userId,
        formatUsdc(entry.losingUnits),
        formatUsdc(entry.lockedUnits)
      );
      throw new ApiError(
        409,
        "Refusing to settle: some positions in this market have no USDC escrow behind them"
      );
    }
  }

  return {
    payouts: [...pairs.values()],
    accounts,
    fillCount: (fills ?? []).length,
  };
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(request);

    // Admin only. requireAdminSession throws 404 rather than 403 for non-admins
    // -- a 403 would confirm that admin settlement exists here.
    const { user } = await requireAdminSession();

    // Next.js 16: route context params is a Promise and must be awaited.
    const { id } = await context.params;

    const parsedId = uuidSchema.safeParse(id);
    if (!parsedId.success) throw new ApiError(404, "Market not found");
    const marketId = parsedId.data;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Expected a JSON body");
    }

    const parsed = settleSchema.safeParse(body);
    if (!parsed.success) throw new ApiError(400, firstIssue(parsed.error));
    const outcome = parsed.data.outcome;

    const db = await serviceClient();

    // Plan once before claiming the market, so the common rejections (nothing
    // to settle, unbacked positions) come back clean with the market untouched.
    await planSettlement(db, marketId, outcome);

    // ------------------------------------------------------------------
    // Double-settlement guard. This is a compare-and-set in the database, not
    // a read-then-write in TypeScript: the UPDATE only matches a market that
    // is not already resolved or cancelled, so of two concurrent settle
    // requests exactly one gets a row back and the other is refused. Settling
    // twice would pay every winner twice out of escrow that no longer exists.
    //
    // It also closes the market to new orders: place_market_order requires
    // status IN ('open','active') under its own row lock, so once this lands
    // no further fills can appear behind the plan computed below.
    // ------------------------------------------------------------------
    const { data: claimed, error: claimError } = await db
      .from("markets")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", marketId)
      .not("status", "in", '("resolved","cancelled")')
      .select("id")
      .maybeSingle();

    if (claimError) {
      console.error("[markets/settle] could not claim market", claimError);
      throw new ApiError(500, "Could not settle this market");
    }

    if (!claimed) {
      const { data: exists } = await db
        .from("markets")
        .select("id")
        .eq("id", marketId)
        .maybeSingle();
      if (!exists) throw new ApiError(404, "Market not found");
      throw new ApiError(409, "This market has already been settled");
    }

    // Resting orders cannot survive settlement -- unmatched interest will never
    // get a counterparty now -- and their escrow is released below. Same
    // reasoning as lock_market in 008.
    const { error: cancelError } = await db
      .from("market_orders")
      .update({ status: "cancelled" })
      .eq("market_id", marketId)
      .eq("status", "open");

    if (cancelError) {
      console.error("[markets/settle] could not cancel resting orders", cancelError);
      throw new ApiError(500, "Could not settle this market");
    }

    // Re-plan now that the market is closed. The first pass was advisory; this
    // one is what moves money, and it is computed from a book that can no
    // longer change.
    const plan = await planSettlement(db, marketId, outcome);

    // 1. Losers pay winners. Aggregated per (loser, winner) pair so a market
    //    with many fills between the same two people is one movement, matching
    //    what confirm_market_resolution does for the IOU ledger.
    //
    //    Payouts run BEFORE releases: a payout debits the loser's escrow, and
    //    the residual release is sized as (locked - lost). Releasing first
    //    would hand back escrow that is still owed away.
    for (const payout of plan.payouts) {
      const { error } = await db.rpc("payout_usdc_escrow", {
        p_from_user_id: payout.loserId,
        p_to_user_id: payout.winnerId,
        p_amount: formatUsdc(payout.units),
        p_market_id: marketId,
        p_description: `Market settled ${outcome.toUpperCase()}`,
      });

      if (error) {
        // Partial settlement. The market is already marked resolved, which is
        // the deliberate trade-off: a half-paid market that cannot be re-run is
        // recoverable by hand from the ledger, whereas a re-runnable one would
        // pay the already-paid pairs a second time. The open escrow locks left
        // behind are exactly the unfinished work, and reconciliation query 4 in
        // 014 surfaces them.
        console.error(
          "[markets/settle] CRITICAL: partial settlement, payout failed",
          marketId,
          payout.loserId,
          payout.winnerId,
          formatUsdc(payout.units),
          error
        );
        throw new ApiError(500, "Settlement failed partway through and needs manual review");
      }
    }

    // 2. Everything still locked and no longer owed goes back to its owner:
    //    winners' own stakes, over-escrow from price improvement, and the
    //    escrow behind orders that never filled.
    let releasedUnits = 0n;

    for (const [userId, entry] of plan.accounts) {
      if (entry.lockIds.length === 0) continue;

      if (entry.losingUnits === 0n) {
        // Nothing was owed away, so each lock releases in full -- exactly what
        // release_usdc_escrow does, including marking the lock released.
        for (const lockId of entry.lockIds) {
          const { error } = await db.rpc("release_usdc_escrow", { p_lock_id: lockId });
          if (error) {
            console.error("[markets/settle] CRITICAL: escrow release failed", marketId, lockId, error);
            throw new ApiError(500, "Settlement failed partway through and needs manual review");
          }
        }
        releasedUnits += entry.lockedUnits;
        continue;
      }

      // This user lost part of their escrow in step 1, so their locks can no
      // longer be released at face value -- that money is already gone from
      // the escrow bucket. Only the residual comes back, in one movement, and
      // the locks are then closed to keep usdc_escrow_locks reconciled against
      // the escrow bucket.
      const residual = entry.lockedUnits - entry.losingUnits;

      if (residual > 0n) {
        const { error } = await db.rpc("move_usdc", {
          p_kind: "escrow_release",
          p_from_user_id: userId,
          p_from_bucket: "escrow",
          p_to_user_id: userId,
          p_to_bucket: "available",
          p_amount: formatUsdc(residual),
          p_market_id: marketId,
          p_description: `Market settled ${outcome.toUpperCase()}`,
        });

        if (error) {
          console.error("[markets/settle] CRITICAL: residual release failed", marketId, userId, error);
          throw new ApiError(500, "Settlement failed partway through and needs manual review");
        }
        releasedUnits += residual;
      }

      const { error: closeError } = await db
        .from("usdc_escrow_locks")
        .update({ status: "released", released_at: new Date().toISOString() })
        .in("id", entry.lockIds)
        .eq("status", "open");

      if (closeError) {
        console.error("[markets/settle] CRITICAL: could not close escrow locks", marketId, userId, closeError);
        throw new ApiError(500, "Settlement failed partway through and needs manual review");
      }
    }

    // 3. Audit trail, mirroring how a market normally reaches 'resolved'. No
    //    money depends on it, so it runs last and non-fatally: an admin
    //    settlement that paid out correctly must not be reported as a failure
    //    because a bookkeeping row did not insert.
    const { error: supersedeError } = await db
      .from("market_resolutions")
      .update({ status: "superseded", resolved_at: new Date().toISOString() })
      .eq("market_id", marketId)
      .eq("status", "pending");

    const { error: resolutionError } = await db.from("market_resolutions").insert({
      market_id: marketId,
      proposed_by: user.id,
      proposed_outcome: outcome,
      confirmed_by: user.id,
      status: "confirmed",
      resolved_at: new Date().toISOString(),
    });

    if (supersedeError || resolutionError) {
      console.error(
        "[markets/settle] settled, but the resolution record failed",
        marketId,
        supersedeError ?? resolutionError
      );
    }

    const paidUnits = plan.payouts.reduce((total, payout) => total + payout.units, 0n);

    return apiOk({
      marketId,
      outcome,
      fills: plan.fillCount,
      payouts: plan.payouts.length,
      // Decimal strings, never floats: these are ledger amounts.
      paidOut: formatUsdc(paidUnits),
      released: formatUsdc(releasedUnits),
    });
  } catch (error) {
    return apiError(error);
  }
}
