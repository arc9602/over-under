import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/**
 * The static half of the login page: everything that does not depend on
 * useSearchParams.
 *
 * It exists so the Suspense fallback in page.tsx can render the SAME markup
 * the interactive form renders. LoginForm reads searchParams, which bails its
 * subtree out of static rendering -- so whatever sits in that fallback is
 * literally all the prerendered HTML contains. Previously the boundary had no
 * fallback at all, which meant the deployed /login shipped an empty <body>
 * and rendered nothing until the client bundle booted. On a dark theme that
 * is indistinguishable from a broken site, and any client-side failure
 * (blocked script, stale chunk, a cookie that makes the Supabase client throw
 * during init) left a black screen with no error and nothing to read.
 *
 * With a real fallback, the page is legible before JS arrives and stays
 * legible if JS never arrives.
 */
export function LoginShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black tracking-tight text-primary">OVER/UNDER</h1>
          <p className="text-muted-foreground mt-1 text-sm">Private bets with friends</p>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * The pre-hydration button. Disabled rather than absent so the page does not
 * reflow when the real form takes over, and so a user whose JS is still
 * loading sees the control they are waiting for instead of blank space.
 */
export function LoginShellFallback() {
  return (
    <LoginShell>
      <Button type="button" className="w-full font-bold" disabled>
        Continue with Google
      </Button>
    </LoginShell>
  );
}
