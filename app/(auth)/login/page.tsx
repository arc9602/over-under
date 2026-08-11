import { Suspense } from "react";
import LoginForm from "./LoginForm";
import { LoginShellFallback } from "./LoginShell";

export default function LoginPage() {
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
