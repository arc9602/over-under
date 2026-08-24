import type { AuthError } from "@supabase/supabase-js";

/**
 * Whether getUser() failed to reach a verdict, as opposed to reaching the
 * verdict "not signed in".
 *
 * getUser() returns `user: null` for both, and the difference is only in the
 * error sitting beside it. Treating the two the same is how a network blip
 * becomes a logout: the request is bounced to /login even though the session
 * in the cookie jar is perfectly good, and the user is asked to authenticate
 * their way out of a problem that was never about authentication.
 *
 * The status list is auth-js's own. From its lib/fetch.js:
 *
 *   // 520-529, 530: Cloudflare-specific error codes (web server down,
 *   // connection timed out, etc.) These are infrastructure errors and should
 *   // not cause session invalidation.
 *   const NETWORK_ERROR_CODES = [500, 501, ... 529, 530];
 *
 * A failed fetch -- network down, CORS, an aborted request -- arrives as
 * status 0, and an error raised before any response has a status of undefined.
 * 429 is not in auth-js's list because it does not retry rate limits, but a
 * rate limit is not a logout either, so it belongs here.
 *
 * Worth being precise about what this does NOT protect against: auth-js only
 * clears the session cookies when it gets a definitive answer
 * (isAuthSessionMissingError -> _removeSession). A retryable failure leaves
 * the cookies alone. So the session survives one of these regardless; what
 * this prevents is the pointless bounce to a login screen the user does not
 * need.
 */
export function isAuthServiceUnavailable(
  error: AuthError | null
): error is AuthError {
  if (!error) return false;

  const { status } = error;
  return (
    status === undefined || status === 0 || status === 429 || status >= 500
  );
}

/**
 * getUser(), retried once when the failure was the auth service rather than
 * the user.
 *
 * The first request to a freshly deployed Worker runs on a cold isolate, with
 * no warm connection to Supabase, and getUser() is a live network call on
 * every request that reaches it. That first call is the one that times out --
 * which is why the symptom is "open the app right after a deploy and it acts
 * like you are signed out, open it again and it is fine". Cloudflare deploys
 * on every push, so every deploy handed this to whoever arrived first.
 *
 * One retry, not a loop: a cold connection succeeds on the second attempt or
 * the service is genuinely down, and a signed-out user must not wait through a
 * retry budget to be told what the first call already established. Callers
 * still get the error when the retry fails, and still decide what it means --
 * this only stops a cold start being mistaken for a verdict.
 */
export async function getUserRetrying<T extends { error: AuthError | null }>(
  getUser: () => Promise<T>
): Promise<T> {
  const first = await getUser();
  if (!isAuthServiceUnavailable(first.error)) return first;

  return await getUser();
}
