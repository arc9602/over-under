import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/lib/types/database.types";
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  // Note the trailing "s" on "/markets": these are startsWith checks, and
  // "/market" would also gate the public invite landing at /market/<code>.
  const protectedPaths = ["/dashboard", "/bets", "/markets", "/balances", "/settings"];
  const isProtected = protectedPaths.some((p) => pathname.startsWith(p));

  if (!user && isProtected) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("redirect", pathname);
    // Headers apply here too. next.config.ts's headers() never runs for a
    // response middleware returns itself, so an unauthenticated redirect
    // would otherwise be the one hop with no HSTS on it.
    return secure(NextResponse.redirect(loginUrl));
  }

  return secure(supabaseResponse);
}
