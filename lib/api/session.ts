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

/**
 * Resolves the origin requireSameOrigin treats as "this deployment", most-
 * trusted source first. Not exported -- requireSameOrigin is the only
 * caller, and keeping this out of the public surface means nothing else can
 * come to depend on the tier order without that being visible in a diff to
 * this file.
 *
 *   1. APP_ORIGIN, if set. The explicit override an operator reaches for
 *      when tiers 2/3 get it wrong for this deployment -- see .env.example.
 *      Parsed through `new URL(...).origin` so a trailing slash or a stray
 *      path on the env var can't break the equality check below, and a
 *      value that fails to parse is logged and ignored rather than making
 *      every request throw because of one bad env var.
 *
 *   2. The Host header, if present. This app runs on Cloudflare Workers via
 *      OpenNext (see wrangler.jsonc / open-next.config.ts), and the request
 *      object a handler sees there is not guaranteed to be the literal URL
 *      the browser addressed -- it can be rewritten to an internal host, or
 *      show `http:` where the client actually used `https:` because TLS
 *      terminated at the edge and only the decrypted request reaches this
 *      code. Host is what the edge used to route here and survives that
 *      rewriting; request.url does not. The scheme is corrected the same
 *      way: trust the request URL's own protocol UNLESS x-forwarded-proto
 *      says https, since that header is exactly what records "the browser
 *      spoke TLS to the edge" when the inner request no longer says so.
 *
 *      x-forwarded-host is deliberately NOT read here, and that is the
 *      security-relevant line in this function. Host is set by whatever
 *      terminated the connection to this process and is what actually
 *      routed the request here; x-forwarded-host is, on many proxy stacks,
 *      just another client-supplied header that nothing rewrites or
 *      verifies in transit. Reading it would let an attacker send their own
 *      expected origin alongside a forged Origin header and pass this check
 *      by construction -- the exact bypass this function exists to prevent.
 *
 *   3. request.url's own origin, same as before this tiering existed. Only
 *      reached if there is no APP_ORIGIN and no Host header, which in
 *      practice means tier 2 always wins once a Host header is present.
 */
function resolveExpectedOrigin(request: Request): string {
  const appOrigin = process.env.APP_ORIGIN?.trim();
  if (appOrigin) {
    try {
      return new URL(appOrigin).origin;
    } catch {
      console.error("[api] APP_ORIGIN is not a valid URL -- ignoring it", appOrigin);
    }
  }

  const host = request.headers.get("host");
  if (host) {
    let protocol = new URL(request.url).protocol;
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    if (forwardedProto?.toLowerCase() === "https") {
      protocol = "https:";
    }
    try {
      return new URL(`${protocol}//${host}`).origin;
    } catch {
      // Malformed Host header -- fall through to tier 3 rather than throw
      // out of a resolver that requireSameOrigin expects never to throw.
    }
  }

  return new URL(request.url).origin;
}

/**
 * CSRF defense-in-depth for the route handlers in app/api/wallet and
 * app/api/bets/place and app/api/markets/[id]/settle.
 *
 * Today, cross-site POST protection rests entirely on the session cookie's
 * SameSite=Lax attribute -- and that is an implicit default @supabase/ssr's
 * cookie helper sets, not an assertion this app makes anywhere in its own
 * code. Next.js's built-in CSRF Origin check (see server-actions.md under
 * node_modules/next/dist/docs) covers Server Actions only; it does not run
 * for route handlers, which is what every endpoint here is. So this is that
 * check, done explicitly.
 *
 * The expected origin comes from resolveExpectedOrigin() above rather than a
 * plain `new URL(request.url).origin` -- see that function for why a single
 * source is not reliable on this app's Cloudflare Workers deployment target.
 *
 * Missing-both-headers is a REJECT, not a pass-through, and that is the part
 * of this function worth arguing with before changing. A check that passes
 * when the header is absent is not a check, because the attacker -- not this
 * server -- decides whether the header is sent; a cross-site form POST or a
 * bare XHR from a page that strips Referer would sail through. Every
 * legitimate caller of these endpoints is fetch() from this app's own pages,
 * and browsers always attach Origin to a same-site-or-not JSON POST like
 * these take. So absence of both is treated as hostile. Fail closed.
 */
export function requireSameOrigin(request: Request): void {
  const forbidden = new ApiError(403, "Cross-origin requests are not allowed");
  const expectedOrigin = resolveExpectedOrigin(request);

  const origin = request.headers.get("origin");
  if (origin !== null) {
    let actual: string;
    try {
      actual = new URL(origin).origin;
    } catch {
      // A value that doesn't even parse as a URL is not a same-origin claim.
      throw forbidden;
    }
    if (actual !== expectedOrigin) {
      throw forbidden;
    }
    return;
  }

  // No Origin. Fall back to Referer -- some legitimate same-origin requests
  // omit Origin (see the Referrer-Policy discussion in lib/security/headers.ts
  // for why this app's own outbound links keep Referer trimmed to origin-only
  // for cross-origin destinations; same-origin fetches still send the full
  // value here).
  const referer = request.headers.get("referer");
  if (referer !== null) {
    let actual: string;
    try {
      actual = new URL(referer).origin;
    } catch {
      throw forbidden;
    }
    if (actual !== expectedOrigin) {
      throw forbidden;
    }
    return;
  }

  // Both absent. See the function comment: this is deliberate, not a gap.
  throw forbidden;
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
 * Sliding-window rate limit, keyed to a user already established by
 * requireSession() -- see check_rate_limit in
 * supabase/migrations/011_caller_identity_and_rate_limiting.sql for the
 * window/lock semantics, and lib/actions/balances.ts's markSettled for the
 * calling convention this copies. place_market_order and place_wager
 * already call check_rate_limit themselves inside their own SQL, so this is
 * only for routes that reach money-moving RPCs without going through one of
 * those two functions first.
 */
export async function enforceRateLimit(
  userId: string,
  action: string,
  maxCount: number,
  windowSeconds: number
): Promise<void> {
  const db = await serviceClient();
  const { data: allowed, error } = await db.rpc("check_rate_limit", {
    p_user_id: userId,
    p_action: action,
    p_max_count: maxCount,
    p_window_seconds: windowSeconds,
  });

  if (error) {
    // Same rule as apiError below: a raw Postgres message can name tables
    // and constraints, so it is logged, not returned.
    console.error("[api] rate limit check failed", action, error);
    throw new ApiError(500, "Something went wrong");
  }
  if (!allowed) {
    throw new ApiError(429, "Too many requests -- wait a moment and try again");
  }
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
