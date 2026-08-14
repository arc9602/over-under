import "server-only";

import type { PostgrestError } from "@supabase/supabase-js";

import { ApiError, serviceClient } from "@/lib/api/session";
import { formatUsdc, maxLossUnits } from "@/lib/chain/amount";
import { CONTRACT_CENTS } from "@/lib/utils/marketBook";

/**
 * The single place an order gets placed, for either kind of market.
 *
 * Before migration 016 there were two independent callers of
 * place_market_order -- this server action and the /api/bets/place route --
 * and only the route escrowed. That let a usdc-backed market accumulate
 * fills with nothing behind them (see the header of 016_market_backing.sql
 * for what that costs). The SQL now refuses to create a fill that doesn't
 * match its market's backing, but refusing at the database is a floor, not a
 * substitute for doing the right thing in the first place -- an unbacked
 * usdc order still 400s instead of silently working, but only after the
 * caller already built the wrong request. Routing every caller through this
 * one function is what makes "do the right thing" the only path that exists.
 */

export type PlaceOrderInput = {
  userId: string;
  marketId: string;
  side: "yes" | "no";
  limitPrice: number;
  quantity: number;
};

export type PlaceOrderResult = {
  filled: number;
  resting: number;
  avgPriceCents: number | null;
  escrowLockId: string | null;
  /**
   * What was actually taken out of available and held, as a decimal string --
   * null on an IOU market, where nothing was. Reported rather than left for
   * the caller to recompute: the caller would have to re-derive it from side,
   * price and quantity through maxLossUnits, and a second implementation of
   * that arithmetic is a second thing that can disagree with the ledger.
   */
  escrowed: string | null;
};

/**
 * move_usdc raises `Insufficient <bucket> balance` with ERRCODE check_violation
 * when the debit would take a bucket below zero, and the CHECK constraint on
 * usdc_accounts raises the same SQLSTATE if every other layer failed. Either way
 * the user-facing meaning is one thing: not enough money.
 */
function isInsufficientFunds(error: PostgrestError): boolean {
  return error.code === "23514" || /insufficient/i.test(error.message);
}

export async function placeOrderForUser(input: PlaceOrderInput): Promise<PlaceOrderResult> {
  const { userId, marketId, side, limitPrice, quantity } = input;
  const db = await serviceClient();

  // Cheap read-only pre-flight so an order against a missing or closed market
  // gets a clean 400 without any money moving and immediately unmoving. This
  // is NOT the authoritative check -- place_market_order re-reads the status
  // (and, as of 016, the backing) under `SELECT ... FOR UPDATE` on the market
  // row, and that is the one that decides. Nothing here is allowed to be
  // load-bearing for correctness.
  const { data: market } = await db
    .from("markets")
    .select("id, status, backing")
    .eq("id", marketId)
    .maybeSingle();

  if (!market) throw new ApiError(404, "Market not found");
  if (market.status !== "open" && market.status !== "active") {
    throw new ApiError(400, "This market is no longer accepting orders");
  }

  if (market.backing !== "usdc") {
    const { data: result, error } = await db.rpc("place_market_order", {
      p_market_id: marketId,
      p_user_id: userId,
      p_side: side,
      p_limit_price: limitPrice,
      p_quantity: quantity,
    });

    if (error) {
      console.error("[placeOrderForUser] place_market_order failed", error);
      throw new ApiError(400, "That order could not be placed");
    }

    const row = Array.isArray(result) ? result[0] : undefined;
    return {
      filled: row?.filled_qty ?? 0,
      resting: row?.resting_qty ?? quantity,
      avgPriceCents: row?.avg_price_cents ?? null,
      escrowLockId: null,
      escrowed: null,
    };
  }

  // Own-side limit price -> the YES-denominated price maxLossUnits expects.
  // Both branches then come out as `limitPrice * quantity`, which is exactly
  // what this order can lose: what you pay for a contract is all you can lose
  // on it, since the worst case is that it settles at 0c.
  const yesPrice = side === "yes" ? limitPrice : CONTRACT_CENTS - limitPrice;

  // Integer cents -> base units, exactly. No float ever participates.
  const escrowUnits = maxLossUnits(side, yesPrice, quantity);
  const escrowAmount = formatUsdc(escrowUnits);

  // ------------------------------------------------------------------
  // Ordering: ESCROW FIRST, then create the order.
  //
  // The two failure modes are not symmetric, so the order is not a matter of
  // taste:
  //
  //   order first, escrow fails  -> a live order rests on the book (or has
  //       already matched) with nothing behind it. Another user's order can
  //       fill against it in the same instant, and that counterparty is now
  //       holding a real position against a stake that does not exist. There
  //       is no compensating action: you cannot un-fill someone else's trade,
  //       and settlement will later find a loser whose escrow cannot cover
  //       what they owe.
  //
  //   escrow first, order fails  -> money sits in the user's own escrow
  //       bucket with no order attached. Nothing is mispriced, nobody else is
  //       affected, and the compensating action (release_usdc_escrow, below)
  //       is a single call that returns it. Even if THAT fails, the worst
  //       case is a user temporarily unable to spend their own funds, with an
  //       open row in usdc_escrow_locks naming the exact amount -- a
  //       recoverable, auditable state.
  //
  // Unbacked exposure to a third party is unrecoverable; over-escrow of the
  // user's own funds is recoverable. So the recoverable failure goes second.
  //
  // Note there is deliberately no "check the balance, then lock" step. The
  // row lock inside move_usdc IS the double-spend protection: a concurrent
  // request for the same funds blocks on that lock rather than reading a
  // stale balance. A SELECT-then-branch in TypeScript would be a textbook
  // TOCTOU race and would defeat the entire design.
  // ------------------------------------------------------------------
  const { data: lockId, error: lockError } = await db.rpc("lock_usdc_escrow", {
    p_user_id: userId,
    p_amount: escrowAmount,
    p_market_id: marketId,
  });

  if (lockError || !lockId) {
    if (lockError && isInsufficientFunds(lockError)) {
      throw new ApiError(
        400,
        `Not enough available USDC. This order needs ${escrowAmount} USDC held in escrow until the market settles.`
      );
    }
    // Anything else is an internal fault; the raw message names tables and
    // constraints, so it is logged rather than returned.
    console.error("[placeOrderForUser] escrow lock failed", lockError);
    throw new ApiError(500, "Could not reserve funds for this order");
  }

  // The lock is attached to its order (p_escrow_lock_id -> order_id) inside
  // place_market_order itself, in the same transaction that creates the
  // order row. That retires what used to live here: a best-effort search
  // through market_orders for a same-user/side/price/quantity row that no
  // lock had yet claimed. That search was correct only by accident -- it
  // relied on ambiguous candidates being financially indistinguishable -- and
  // it couldn't run until after the order existed. SQL now has the order id
  // in hand at the moment it creates the row, so there is nothing left to
  // search for.
  const { data: result, error: orderError } = await db.rpc("place_market_order", {
    p_market_id: marketId,
    p_user_id: userId,
    p_side: side,
    p_limit_price: limitPrice,
    p_quantity: quantity,
    p_escrow_lock_id: lockId,
  });

  if (orderError) {
    // Compensate: the escrow exists but there is no order behind it.
    const { error: releaseError } = await db.rpc("release_usdc_escrow", { p_lock_id: lockId });
    if (releaseError) {
      // The user's funds are stuck in escrow with an open lock row. Loud, and
      // recoverable by releasing that lock id -- never silent.
      console.error(
        "[placeOrderForUser] CRITICAL: order failed and escrow release failed; open lock",
        lockId,
        releaseError
      );
    }
    console.error("[placeOrderForUser] place_market_order failed", orderError);
    // The matcher's own RAISEs (market closed, position cap) are the useful
    // ones and are written for a user, but they are not distinguishable from
    // internal faults by SQLSTATE, so this stays generic.
    throw new ApiError(400, "That order could not be placed");
  }

  const row = Array.isArray(result) ? result[0] : undefined;

  return {
    filled: row?.filled_qty ?? 0,
    resting: row?.resting_qty ?? quantity,
    avgPriceCents: row?.avg_price_cents ?? null,
    escrowLockId: lockId,
    escrowed: escrowAmount,
  };
}
