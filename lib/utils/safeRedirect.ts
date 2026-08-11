/**
 * Only allow same-origin relative paths as a post-login redirect target.
 *
 * app/api/auth/callback/route.ts builds its final redirect as
 * `${origin}${redirect}` -- string concatenation, not URL resolution -- so
 * an unvalidated `redirect` can still escape the origin via the userinfo
 * trick (`redirect=@evil.com` -> "https://app.com@evil.com", which browsers
 * parse as a navigation to evil.com with "app.com" discarded as userinfo) or
 * a protocol-relative value smuggled some other way. `redirect` originates
 * from a query param an attacker fully controls (a phishing link), flows
 * through LoginForm/SignupForm into a cookie, and back out here -- so it has
 * to be validated at the point of use, not trusted because it "looks" like
 * it came from this app.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//") || value.startsWith("/\\")) return fallback;
  if (value.includes("@") || value.includes("://")) return fallback;
  return value;
}
