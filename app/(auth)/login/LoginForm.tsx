"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { safeRedirectPath } from "@/lib/utils/safeRedirect";

export default function LoginForm() {
  const searchParams = useSearchParams();
  const redirect = safeRedirectPath(searchParams.get("redirect"));
  const callbackError = searchParams.get("error");

  const [error, setError] = useState<string | null>(
    callbackError === "auth_callback_failed" ? "Sign in failed. Please try again." : null
  );

  async function handleGoogleSignIn() {
    setError(null);
    document.cookie = `oauth_redirect=${redirect}; path=/; max-age=600; SameSite=Lax`;
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
      },
    });
    if (error) setError(error.message);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black tracking-tight text-primary">OVER/UNDER</h1>
          <p className="text-muted-foreground mt-1 text-sm">Private bets with friends</p>
        </div>

        {error && (
          <p className="text-sm text-destructive mb-4 text-center">{error}</p>
        )}

        <Button
          type="button"
          className="w-full font-bold"
          onClick={handleGoogleSignIn}
        >
          Continue with Google
        </Button>
      </div>
    </div>
  );
}
