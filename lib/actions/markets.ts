"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  uuidSchema,
  inviteCodeSchema,
  priceSchema,
  quantitySchema,
  lineText,
  blockText,
} from "@/lib/validation/common";
import { ApiError } from "@/lib/api/session";
import { isUsdcEnabled } from "@/lib/chain/env";
import { placeOrderForUser } from "@/lib/money/placeOrder";

const createMarketSchema = z
  .object({
    title: lineText(3, 200),
    description: blockText(500).optional(),
    yesLabel: lineText(1, 50).default("Yes"),
    noLabel: lineText(1, 50).default("No"),
    maxContracts: z.coerce.number().int().positive().max(100000).optional(),
    deadline: z.string().optional(),
    backing: z.enum(["iou", "usdc"]).default("iou"),
    openingSide: z.enum(["yes", "no"]).optional(),
    openingPrice: priceSchema.optional(),
    openingQuantity: quantitySchema.optional(),
  })
  .refine(
    (d) =>
      [d.openingSide, d.openingPrice, d.openingQuantity].every(Boolean) ||
      [d.openingSide, d.openingPrice, d.openingQuantity].every((v) => !v),
    {
      message: "Fill in side, price and quantity to seed the book, or leave all blank",
      path: ["openingQuantity"],
    }
  );

export async function createMarket(formData: FormData) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsed = createMarketSchema.safeParse({
    title: formData.get("title"),
    // See createBet in lib/actions/bets.ts -- same null-vs-undefined trap.
    description: formData.get("description") || undefined,
    yesLabel: formData.get("yesLabel"),
    noLabel: formData.get("noLabel"),
    maxContracts: formData.get("maxContracts") || undefined,
    deadline: formData.get("deadline") || undefined,
    backing: formData.get("backing") || undefined,
    openingSide: formData.get("openingSide") || undefined,
    openingPrice: formData.get("openingPrice") || undefined,
    openingQuantity: formData.get("openingQuantity") || undefined,
  });

  if (!parsed.success) {
    return { error: "Invalid form data", details: parsed.error.flatten() };
  }

  const {
    title, description, yesLabel, noLabel, maxContracts, deadline, backing,
    openingSide, openingPrice, openingQuantity,
  } = parsed.data;

  // CreateMarketForm doesn't render the backing choice while USDC is
  // disabled, so a `usdc` value reaching here is a crafted request, not a
  // user choice -- the form has no control that produces it. No error, no
  // rejection: silently coerce to 'iou'. Migration 016's backing column is
  // immutable after creation and place_market_order refuses a usdc market
  // with no escrow lock, so failing open here would just hand that request
  // straight to a database check that also declines it. Forcing 'iou' is the
  // safe response, not a workaround for one.
  const resolvedBacking = isUsdcEnabled() ? backing : "iou";

  const { data: market, error } = await supabase
    .from("markets")
    .insert({
      title,
      description: description ?? null,
      yes_label: yesLabel,
      no_label: noLabel,
      max_contracts: maxContracts ?? null,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      creator_id: user.id,
      backing: resolvedBacking,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  if (openingSide && openingPrice && openingQuantity) {
    try {
      await placeOrderForUser({
        userId: user.id,
        marketId: market.id,
        side: openingSide,
        limitPrice: openingPrice,
        quantity: openingQuantity,
      });
    } catch {
      // Non-fatal if this fails -- the market exists either way and the creator
      // can post from its own page. Same call the "wager now" path in
      // createBet makes.
    }
  }

  revalidatePath("/markets");
  redirect(`/markets/${market.id}`);
}

export async function placeMarketOrder(
  identifier: { marketId: string } | { inviteCode: string },
  side: "yes" | "no",
  limitPrice: number,
  quantity: number
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const redirectTarget =
    "inviteCode" in identifier ? `/market/${identifier.inviteCode}` : `/markets/${identifier.marketId}`;
  if (!user) redirect(`/login?redirect=${encodeURIComponent(redirectTarget)}`);

  const parsedPrice = priceSchema.safeParse(limitPrice);
  const parsedQuantity = quantitySchema.safeParse(quantity);
  const parsedSide = z.enum(["yes", "no"]).safeParse(side);
  const parsedIdentifier = "marketId" in identifier
    ? uuidSchema.safeParse(identifier.marketId)
    : inviteCodeSchema.safeParse(identifier.inviteCode);
  if (!parsedPrice.success) return { error: "Price must be a whole number of cents from 1 to 99" };
  if (!parsedQuantity.success) return { error: "Quantity must be at least 1 contract" };
  if (!parsedSide.success) return { error: "Invalid side" };
  if (!parsedIdentifier.success) return { error: "Market not found" };

  const serviceClient = await createServiceClient();
  const { data: market } = await serviceClient
    .from("markets")
    .select("id")
    .match("marketId" in identifier ? { id: parsedIdentifier.data } : { invite_code: parsedIdentifier.data })
    .single();

  if (!market) return { error: "Market not found" };

  let result;
  try {
    result = await placeOrderForUser({
      userId: user.id,
      marketId: market.id,
      side: parsedSide.data,
      limitPrice: parsedPrice.data,
      quantity: parsedQuantity.data,
    });
  } catch (e) {
    // ApiError carries a message meant for a user (see placeOrderForUser and
    // the RAISEs it surfaces). Anything else is unexpected -- logged, and
    // reported generically so internals never leak into a server action's
    // return value the way apiError already keeps them out of a JSON
    // response.
    if (e instanceof ApiError) return { error: e.message };
    console.error("[placeMarketOrder] unexpected failure", e);
    return { error: "That order could not be placed" };
  }

  revalidatePath("/markets");
  revalidatePath(`/markets/${market.id}`);

  // Arriving from an invite link, the user now has an order and so can read
  // the market under RLS -- send them to the real page. Already inside the
  // app, stay put so the freshly rendered book is visible.
  if ("inviteCode" in identifier) redirect(`/markets/${market.id}`);

  return {
    success: true,
    filled: result.filled,
    resting: result.resting,
    avgPrice: result.avgPriceCents,
  };
}

export async function cancelMarketOrder(orderId: string, marketId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedOrderId = uuidSchema.safeParse(orderId);
  if (!parsedOrderId.success) return { error: "Order not found" };

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient.rpc("cancel_market_order", {
    p_order_id: parsedOrderId.data,
    p_user_id: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/markets/${marketId}`);
  return { success: true };
}

export async function lockMarket(marketId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedId = uuidSchema.safeParse(marketId);
  if (!parsedId.success) return { error: "Market not found" };

  const serviceClient = await createServiceClient();
  const { error } = await serviceClient.rpc("lock_market", {
    p_market_id: parsedId.data,
    p_user_id: user.id,
  });

  if (error) return { error: error.message };

  revalidatePath(`/markets/${marketId}`);
  return { success: true };
}

export async function cancelMarket(marketId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const parsedId = uuidSchema.safeParse(marketId);
  if (!parsedId.success) return { error: "Market not found" };

  const { error } = await supabase
    .from("markets")
    .update({ status: "cancelled" })
    .eq("id", parsedId.data)
    .eq("creator_id", user.id)
    .in("status", ["open", "active"]);

  if (error) return { error: error.message };

  revalidatePath("/markets");
  revalidatePath(`/markets/${marketId}`);
  return { success: true };
}
