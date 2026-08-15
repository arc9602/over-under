import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCardSkeleton, OrderBookSkeleton } from "@/components/shared/Skeletons";

/**
 * Tracks the real page's layout: a single centered column below lg, and
 * above it a lg:grid-cols-[1fr_22rem] split with market info scrolling on
 * the left while the order ticket and the rest of the actions stay pinned
 * in a sticky right column. See app/(app)/markets/[marketId]/page.tsx.
 */
export default function MarketDetailLoading() {
  return (
    <div className="max-w-lg mx-auto space-y-6 lg:max-w-none lg:mx-0 lg:grid lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-8 lg:space-y-0">
      {/* Left: title, last price, backing chip, odds chart, order book. */}
      <div className="space-y-4 lg:min-w-0">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-7 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="h-5 w-14 rounded-4xl shrink-0" />
        </div>
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-9 w-full rounded-md" />
        <ChartCardSkeleton />
        <OrderBookSkeleton />
      </div>

      {/* Right: invite panel and the order ticket, pinned once the split
          kicks in above lg. */}
      <div className="space-y-6 lg:sticky lg:top-20">
        <Card>
          <CardContent className="p-4 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full rounded-md" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
            <Skeleton className="h-9 w-full rounded-md" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
