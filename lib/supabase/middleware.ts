import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database.types";
import { isAuthServiceUnavailable } from "@/lib/supabase/authError";
import {
  STATIC_SECURITY_HEADERS,
  buildCsp,
  cspHeaderName,
  generateNonce,
} from "@/lib/security/headers";

/**
 * Session refresh + security headers for every matched request.
 *
 * The two jobs share this file because they share the response object, and
 * @supabase/ssr's cookie contract is unusually brittle about that: the
 * response it writes refreshed auth cookies onto is the one that must reach
 * the browser. Building a second response and copying headers across is how
 * a silently-signed-out user happens.
 */
export async function updateSession(request: NextRequest) {
  // One nonce per request. Next.js finds it by parsing the
  // `Content-Security-Policy` REQUEST header for the 'nonce-...' pattern, then
  // stamps it onto the framework and page script tags itself -- which is why
  // that header is set on the request below even when the response ships the
  // policy as report-only.
  const nonce = generateNonce();
  const csp = buildCsp(nonce);

  /** Request headers carrying the nonce through to the renderer. */
  const withNonce = (base: Headers) => {
    const headers = new Headers(base);
    headers.set("x-nonce", nonce);
    headers.set("Content-Security-Policy", csp);
    return headers;
  };

  /** Applied to whatever response ends up being returned, on every path. */
  const secure = <T extends NextResponse>(response: T): T => {
    for (const { key, value } of STATIC_SECURITY_HEADERS) {
      response.headers.set(key, value);
    }
    response.headers.set(cspHeaderName(), csp);
    return response;
  };

  const pathname = request.nextUrl.pathname;

  // The OAuth callback owns the auth cookies for its own request, alone.
  //
  // It is the one route where the incoming cookies are mid-transition: the
  // old session (if any) is on its way out and the one being minted from the
  // `code` param is on its way in. Running the refresh below as well puts two
  // Supabase clients on the same cookie jar in a single request -- this one
  // computing deletions from the OLD state while the route handler writes the
  // NEW one -- and both sets of Set-Cookie headers land on the same response.
  // The browser then resolves a delete and a write of the same cookie name by
  // header order, which is not a thing to leave to chance for the header that
  // IS the session. Bail out before the client is built; the route handler
  // does the whole job correctly on its own.
  if (pathname === "/api/auth/callback") {
    return secure(
      NextResponse.next({ request: { headers: withNonce(request.headers) } })
    );
  }

  let supabaseResponse = NextResponse.next({
    request: { headers: withNonce(request.headers) },
  });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          // Rebuilt from request.headers rather than from the snapshot taken
          // above: request.cookies.set() rewrites the underlying Cookie
          // header, and reusing a stale copy would hand the renderer the
          // pre-refresh session.
          supabaseResponse = NextResponse.next({
            request: { headers: withNonce(request.headers) },
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // The error is read, not discarded. getUser() reports "not signed in" and
  // "could not tell you" the same way -- user: null -- and only this error
  // distinguishes them. See isAuthServiceUnavailable.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // Note the trailing "s" on "/markets": these are startsWith checks, and
  // "/market" would also gate the public invite landing at /market/<code>.
  const protectedPaths = ["/dashboard", "/bets", "/markets", "/balances", "/settings"];
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));

  // Fail open on an infrastructure fault, closed on an authentication one.
  //
  // getUser() is a network round-trip to Supabase on all but static assets, so
  // every rate limit, 5xx and dropped connection between this Worker and the
  // auth server used to read as "signed out" and bounce the user to /login --
  // holding a valid session the whole time. This is not a hole: the page they
  // continue to still runs its own check in app/(app)/layout.tsx, so a request
  // that genuinely has no session is stopped there rather than here.
  if (!user && isProtected && isAuthServiceUnavailable(error)) {
    return secure(supabaseResponse);
  }

  if (!user && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirect", pathname);

    const redirectResponse = NextResponse.redirect(loginUrl);

    // The cookies are the point of this copy, not a tidiness nicety.
    //
    // Reaching here with no user usually means getUser() just tried to refresh
    // an expired session and failed, and Supabase's response to that is to
    // expire the auth cookies via setAll() -- onto supabaseResponse, which
    // this branch is about to throw away. Returning a bare redirect drops
    // those Set-Cookie headers and leaves the dead session sitting in the
    // browser.
    //
    // That is what made sign-in take two clicks. The stale cookie survived the
    // bounce to /login and was still attached when the user pressed "Continue
    // with Google", so it rode along to /api/auth/callback and to the browser
    // client that mints the PKCE verifier -- and a Supabase client that fails
    // to recover a session clears that verifier along with the session it
    // gave up on. No verifier, no code exchange: the callback bounced them
    // straight back to /login. The second click worked because by then the
    // dead cookie had finally been cleared by a response that kept its
    // headers.
    for (const cookie of supabaseResponse.cookies.getAll()) {
      redirectResponse.cookies.set(cookie);
    }

    // Headers apply here too. next.config.ts's headers() never runs for a
    // response middleware returns itself, so an unauthenticated redirect
    // would otherwise be the one hop with no HSTS on it.
    return secure(redirectResponse);
  }

  return secure(supabaseResponse);
}
