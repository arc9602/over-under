import { Suspense } from "react";
import { connection } from "next/server";
import LoginForm from "./LoginForm";
import { LoginShellFallback } from "./LoginShell";

export default async function LoginPage() {
  // Forces dynamic rendering, for the CSP nonce rather than for any data this
  // page reads.
  //
  // The nonce in lib/security/headers.ts is minted per request by the proxy,
  // and Next can only stamp it onto script tags while server-rendering that
  // request. A prerendered page is built with no request in scope, so its
  // scripts ship without one -- and under `script-src 'nonce-...'
  // 'strict-dynamic'` a script with no nonce is exactly what the browser is
  // being told to refuse. `next build` confirmed /login was prerendering (a
  // static route in the build output), so enforcing the policy would have
  // blocked the login page's own bundle and locked everyone out of the app.
  //
  // This is the page where a CSP is worth the most -- it is where credentials
  // are typed -- so the fix is to make it dynamic, not to exempt it.
  await connection();

  // The fallback is load-bearing, not decorative. LoginForm calls
  // useSearchParams, which opts its subtree out of static rendering -- so this
  // fallback IS the prerendered HTML for /login. Leaving it empty (as it was)
  // shipped a blank page that only became visible once the client bundle ran.
  return (
    <Suspense fallback={<LoginShellFallback />}>
      <LoginForm />
    </Suspense>
  );
}
