"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Root error boundary. Catches anything a server or client component throws
 * anywhere under the root layout (a failed Supabase query, a bad param) and
 * shows this instead of Next's default error screen.
 *
 * Next.js only guarantees the real `error.message` here for Client Component
 * errors -- a Server Component error already arrives generic in production.
 * We don't rely on that split: this file never reads `error.message` at all,
 * so a Postgres/Supabase string (see supabase/migrations/017_direct_write_hardening.sql)
 * has no path into the DOM regardless of where the throw happened.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server-side only: correlates with the digest shown below.
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
            <TriangleAlert className="size-5 text-destructive" strokeWidth={1.5} />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold">Something went wrong</h1>
            {/* Fixed copy, not derived from `error` in any way -- this is the
                line that guarantees error.message never reaches the DOM. */}
            <p className="text-sm text-muted-foreground">
              We hit a problem loading this page. Nothing was lost, and your
              bets and markets are unaffected -- try again, or head back to
              your dashboard.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Button onClick={() => reset()} className="w-full font-semibold">
              Try again
            </Button>
            <Link
              href="/dashboard"
              className={buttonVariants({
                variant: "outline",
                className: "w-full font-semibold",
              })}
            >
              Back to dashboard
            </Link>
          </div>

          {error.digest && (
            <p className="font-mono text-xs text-muted-foreground/60">
              Reference: {error.digest}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
