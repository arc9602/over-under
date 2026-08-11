import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database.types";
import { isAdmin } from "@/lib/chain/env";

/**
 * Shared authentication and response shape for the /api/wallet and
 * /api/markets route handlers.
 *
 * Identity is Supabase Auth, not Privy. Privy owns wallets; Supabase owns who
 * you are. That split is what lets this whole feature be additive: every RLS
 * policy and every SECURITY DEFINER function in migrations 010-014 keys off
 * auth.uid(), so swapping the identity provider would mean rewriting all of
 * them. A Privy access token proves control of a wallet -- it does not prove
 * which over-under account you are, and treating it as if it did is how one
 * user's deposit gets credited to another.
 */

export type Session = {
  user: User;
  /** RLS-respecting client, acting as the signed-in user. */
  supabase: SupabaseClient<Database>;
};

/**
 * Thrown-and-caught control flow, so route handlers read as a straight line
 * instead of nesting a null check around every step.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function requireSession(): Promise<Session> {
  const supabase = await createClient();
  // getUser(), never getSession(): getSession reads the cookie and trusts it,
  // while getUser revalidates the JWT against Supabase. On a money endpoint
  // the difference is whether a forged or stale cookie can move funds.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new ApiError(401, "You must be signed in");
  }
  return { user, supabase };
}

export async function requireAdminSession(): Promise<Session> {
  const session = await requireSession();
  if (!isAdmin(session.user.id)) {
    // Deliberately 404, not 403: a 403 confirms the route exists and that
    // admin settlement is a thing, which is free reconnaissance. Nothing is
    // gained by telling a non-admin what they found.
    throw new ApiError(404, "Not found");
  }
  return session;
}

/**
 * Service-role client, for the SECURITY DEFINER money functions in 014.
 *
 * Those functions have EXECUTE revoked from anon/authenticated, so they are
 * unreachable through the user's own client -- that revoke is what stops a
 * user POSTing to /rest/v1/rpc/credit_usdc_deposit and minting themselves a
 * balance. Reaching them requires this client, which bypasses RLS entirely.
 *
 * The consequence: every caller of this MUST have already established which
 * user it is acting for via requireSession(), and must pass that user's id
 * explicitly. There is no auth.uid() inside these calls to fall back on.
 */
export function serviceClient() {
  return createServiceClient();
}

/**
 * The verified wallet address linked to a user, or null.
 *
 * Read through the service client because a route handler often needs this
 * while acting on behalf of the user, and wallet_links is RLS-scoped to
 * auth.uid() -- which is fine for the user's own row, but this helper is also
 * used to resolve a deposit's sender, where the row may not be the caller's.
 */
export async function getLinkedWallet(userId: string): Promise<string | null> {
  const db = await serviceClient();
  const { data } = await db
    .from("wallet_links")
    .select("address")
    .eq("user_id", userId)
    .maybeSingle();

  return data?.address ?? null;
}

export async function requireLinkedWallet(userId: string): Promise<string> {
  const address = await getLinkedWallet(userId);
  if (!address) {
    throw new ApiError(400, "Link a wallet before moving funds");
  }
  return address;
}

/**
 * Single exit point for errors. Unknown errors are logged server-side and
 * reported to the client as a flat 500 with no detail -- a Postgres exception
 * message from one of the money functions can name tables, columns and
 * constraint internals, and none of that belongs in a response body.
 */
export function apiError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[api] unhandled error", error);
  return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
}

export function apiOk<T extends Record<string, unknown>>(body: T, status = 200): NextResponse {
  return NextResponse.json(body, { status });
}
