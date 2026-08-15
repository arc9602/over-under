import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Same wait as app/bet/[inviteCode]/loading.tsx (getMarketByInviteCode then
 * an auth check before anything renders), plus the backing pill
 * (IOU/USDC) -- PRODUCT.md: "backing is a first-class fact on every market
 * surface," so its row gets a placeholder here too rather than popping in
 * after everything else.
 */
export default function MarketInviteLoading() {
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

            <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/40 px-2.5 py-2">
              <Skeleton className="h-4 w-10 shrink-0 bg-background/60" />
              <Skeleton className="h-3 w-40 bg-background/60" />
            </div>

            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-3 w-24" />
            </div>
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
