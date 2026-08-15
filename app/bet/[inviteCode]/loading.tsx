import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/**
 * The invite link is the front door -- PRODUCT.md: "a recipient may not
 * have an account." InviteLandingPage awaits getBetByInviteCode, then
 * (once that resolves) an auth check, before it can render anything, so
 * this is a real wait, not an instant route. Shape mirrors the page's own
 * layout: wordmark, hero card (title/badge/description/meta), then the
 * side-choice tiles from BetInviteWager/SideChoice.
 */
export default function BetInviteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <Skeleton className="mx-auto h-4 w-28" />

        <Card className="border-primary/30">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <Skeleton className="h-7 w-3/4" />
              <Skeleton className="h-5 w-14 shrink-0 rounded-4xl" />
            </div>
            <Skeleton className="h-4 w-full" />
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
            <Skeleton className="h-3 w-40" />
          </CardContent>
        </Card>

        <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-2">
          {Array.from({ length: 2 }, (_, i) => (
            <div
              key={i}
              className="space-y-1.5 rounded-lg border border-border bg-secondary/40 p-3"
            >
              <Skeleton className="h-4 w-3/4 bg-background/60" />
              <Skeleton className="h-3 w-1/2 bg-background/60" />
            </div>
          ))}
        </div>
        <Skeleton className="h-11 w-full rounded-lg" />
      </div>
    </div>
  );
}
