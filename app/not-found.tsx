import Link from "next/link";
import { Compass } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Root not-found UI. Fires both for `notFound()` thrown by a route segment
 * and for any URL that doesn't match a route at all. Plain and calm on
 * purpose -- no 404 typography treatment, no joke copy.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <Card className="w-full max-w-sm">
        <CardContent className="p-6 text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-secondary">
            <Compass className="size-5 text-muted-foreground" strokeWidth={1.5} />
          </div>

          <div className="space-y-1.5">
            <h1 className="text-lg font-semibold">Page not found</h1>
            <p className="text-sm text-muted-foreground">
              This page doesn&apos;t exist, or the link may be out of date.
            </p>
          </div>

          {/* "/" rather than "/dashboard": it bounces a signed-in visitor to
              their dashboard and shows the landing page to everyone else, so
              it works whether or not whoever hit this link has an account.
              Same rule already used in app/bet/[inviteCode]/page.tsx and
              app/market/[inviteCode]/page.tsx for their own dead-link case. */}
          <Link
            href="/"
            className={buttonVariants({ className: "w-full font-semibold" })}
          >
            Go to Over/Under
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
