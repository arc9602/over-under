import { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";

import { ApiError, apiError, apiOk, requireSession, serviceClient } from "@/lib/api/session";
import { formatUsdc, maxLossUnits } from "@/lib/chain/amount";
import { CONTRACT_CENTS } from "@/lib/utils/marketBook";
import { firstIssue, marketSideSchema, priceSchema, quantitySchema, uuidSchema } from "@/lib/validation/common";

/**
 * POST /api/bets/place -- place an order backed by the custodial USDC ledger.
 *
 * This route is the money-bearing counterpart to the `placeMarketOrder` server
 * action: same matching engine, but the user's stake is escrowed out of their
 * available USDC balance first. Nothing here touches the chain. Individual
 * orders are internal ledger movements only -- USDC crosses the chain boundary
 * exactly twice in this system, at deposit and at withdrawal, and putting a
 * signed transaction in the order path would make every fill cost gas and every
 * match wait on a block.
 *
 * Escrow is taken at ORDER PLACEMENT and sized at MAX LOSS, not at fill:
 *
 *   yes @ p x q  ->  p * q cents
 *   no  @ p x q  ->  (100 - p) * q cents
 *
 * (see maxLossUnits, and the header of section 6 in 014_usdc_custody.sql).
 * `p` there is the YES price. `limitPrice` in this request is the price for the
 * side being bought -- the convention market_orders.limit_price uses, which is
 * why 008's matcher derives yes_price as `100 - limit_price` for a resting NO
 * and previewFill in marketBook.ts does the same. The two are converted between
 * below rather than conflated: passing a NO order's own-side limit straight
 * into maxLossUnits would escrow (100 - p) when the risk is p.
 *
 * Escrowing at fill instead would let a user rest orders totalling far more
 * than their balance; when several of them filled together the account would go
 * negative and the CHECK (available >= 0) constraint would start rejecting
 * *fills* at random -- a much worse failure than refusing the order up front.
 */

const placeOrderSchema = z.object({
  marketId: uuidSchema,
  side: marketSideSchema,
  limitPrice: priceSchema,
  quantity: quantitySchema,
});

/**
 * move_usdc raises `Insufficient <bucket> balance` with ERRCODE check_violation
 * when the debit would take a bucket below zero, and the CHECK constraint on
 * usdc_accounts raises the same SQLSTATE if every other layer failed. Either way
 * the user-facing meaning is one thing: not enough money.
 */
function isInsufficientFunds(error: PostgrestError): boolean {
  return error.code === "23514" || /insufficient/i.test(error.message);
}

export async function POST(request: Request) {
  try {
    // Identity is established server-side from the session cookie. A user_id in
    // the request body would let anyone escrow anyone else's balance, since the
    // RPCs below run through the service client with RLS bypassed.
    const { user } = await requireSession();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, "Expected a JSON body");
    }

    const parsed = placeOrderSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(400, firstIssue(parsed.error));
    }
    const { marketId, side, limitPrice, quantity } = parsed.data;

    const db = await serviceClient();

    // Cheap read-only pre-flight so an order against a missing or closed market
    // gets a clean 400 without any money moving and immediately unmoving. This
    // is NOT the authoritative check -- place_market_order re-reads the status
    // under `SELECT ... FOR UPDATE` on the market row, and that is the one that
    // decides. Nothing here is allowed to be load-bearing for correctness.
    const { data: market } = await db
      .from("markets")
      .select("id, status")
      .eq("id", marketId)
      .maybeSingle();

    if (!market) throw new ApiError(404, "Market not found");
    if (market.status !== "open" && market.status !== "active") {
      throw new ApiError(400, "This market is no longer accepting orders");
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
      p_user_id: user.id,
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
      console.error("[bets/place] escrow lock failed", lockError);
      throw new ApiError(500, "Could not reserve funds for this order");
    }

    const { data: result, error: orderError } = await db.rpc("place_market_order", {
      p_market_id: marketId,
      p_user_id: user.id,
      p_side: side,
      p_limit_price: limitPrice,
      p_quantity: quantity,
    });

    if (orderError) {
      // Compensate: the escrow exists but there is no order behind it.
      const { error: releaseError } = await db.rpc("release_usdc_escrow", { p_lock_id: lockId });
      if (releaseError) {
        // The user's funds are stuck in escrow with an open lock row. Loud, and
        // recoverable by releasing that lock id -- never silent.
        console.error(
          "[bets/place] CRITICAL: order failed and escrow release failed; open lock",
          lockId,
          releaseError
        );
      }
      console.error("[bets/place] place_market_order failed", orderError);
      // The matcher's own RAISEs (market closed, position cap) are the useful
      // ones and are written for a user, but they are not distinguishable from
      // internal faults by SQLSTATE, so this stays generic.
      throw new ApiError(400, "That order could not be placed");
    }

    // Attach the order to its escrow lock. Best-effort and deliberately
    // non-fatal: place_market_order does not return the id of the order it
    // created, and the alternative -- creating the order ourselves to know its
    // id -- would mean bypassing the matching engine. The lock is already
    // correct and correctly sized without this; order_id only makes a later
    // per-order cancellation able to find it.
    //
    // Ambiguity is bounded: candidates are filtered to this user's orders in
    // this market with identical side/price/quantity that no lock has claimed,
    // so the only orders that could be confused with each other have identical
    // escrow amounts, which makes any mix-up financially indistinguishable.
    try {
      const { data: candidates } = await db
        .from("market_orders")
        .select("id")
        .eq("market_id", marketId)
        .eq("user_id", user.id)
        .eq("side", side)
        .eq("limit_price", limitPrice)
        .eq("quantity", quantity)
        .order("created_at", { ascending: false })
        .limit(20);

      const ids = (candidates ?? []).map((row) => row.id);
      if (ids.length > 0) {
        const { data: claimed } = await db
          .from("usdc_escrow_locks")
          .select("order_id")
          .in("order_id", ids);

        const taken = new Set((claimed ?? []).map((row) => row.order_id));
        const orderId = ids.find((id) => !taken.has(id));
        if (orderId) {
          await db.from("usdc_escrow_locks").update({ order_id: orderId }).eq("id", lockId);
        }
      }
    } catch (attachError) {
      console.error("[bets/place] could not attach order_id to escrow lock", lockId, attachError);
    }

    const row = Array.isArray(result) ? result[0] : undefined;

    return apiOk({
      escrowLockId: lockId,
      escrowed: escrowAmount,
      filled: row?.filled_qty ?? 0,
      resting: row?.resting_qty ?? quantity,
      avgPriceCents: row?.avg_price_cents ?? null,
    });
  } catch (error) {
    return apiError(error);
  }
}
