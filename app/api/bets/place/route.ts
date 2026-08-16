import { z } from "zod";

import { ApiError, apiError, apiOk, requireSameOrigin, requireSession } from "@/lib/api/session";
import { isUsdcEnabled } from "@/lib/chain/env";
import { placeOrderForUser } from "@/lib/money/placeOrder";
import { firstIssue, marketSideSchema, priceSchema, quantitySchema, uuidSchema } from "@/lib/validation/common";

/**
 * POST /api/bets/place -- place an order, escrowing USDC first if the market
 * requires it.
 *
 * This route is a thin auth/validation shell around `placeOrderForUser` (see
 * lib/money/placeOrder.ts), which is also the path the `placeMarketOrder`
 * server action now goes through. Before migration 016 the two callers were
 * independent and only this one escrowed -- that gap is what 016 closes at
 * the database, and this route no longer needs to be the only place that
 * gets it right. What stays here is what's specific to being an HTTP route:
 * origin checking, session lookup, and request-body validation.
 */

const placeOrderSchema = z.object({
  marketId: uuidSchema,
  side: marketSideSchema,
  limitPrice: priceSchema,
  quantity: quantitySchema,
});

export async function POST(request: Request) {
  try {
    // This route escrows USDC before an order can rest or fill, so it is
    // custody too. Same 404-not-403 guard as the /api/wallet routes -- see
    // lib/api/session.ts's requireAdminSession for why 404: a 403 would
    // confirm escrowed betting exists on this deployment. Checked before even
    // requireSameOrigin, so the response is identical to a route that was
    // never built.
    if (!isUsdcEnabled()) {
      throw new ApiError(404, "Not found");
    }
    requireSameOrigin(request);

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

    const result = await placeOrderForUser({ userId: user.id, marketId, side, limitPrice, quantity });

    return apiOk(result);
  } catch (error) {
    return apiError(error);
  }
}
