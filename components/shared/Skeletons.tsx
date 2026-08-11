import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Loading placeholders that mirror the real components' geometry. Heights and
 * spacing here are deliberately copied from BetCard/MarketCard/OrderBook and
 * ProbabilityChart -- if a skeleton is a different size than what replaces it,
 * the page jumps on load, which is the bug these are meant to prevent.
 */

/** Matches BetCard / MarketCard: badge row, title, stat pair, split bar, meta. */
export function BetCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-5 w-14 rounded-4xl" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Skeleton className="h-2.5 w-10" />
            <Skeleton className="h-5 w-16" />
          </div>
          <div className="space-y-1 flex flex-col items-end">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-5 w-16" />
          </div>
        </div>
        <Skeleton className="h-1.5 w-full rounded-full" />
        <Skeleton className="h-3 w-24" />
      </CardContent>
    </Card>
  );
}

export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }, (_, i) => (
        <BetCardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Matches the two stat tiles above the dashboard/markets tab strip. */
export function StatRowSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 2 }, (_, i) => (
        <Card key={i}>
          <CardContent className="p-3 space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-6 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Matches OrderBook: two best-price tiles, then two 5-row depth columns. */
export function OrderBookSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 2 }, (_, i) => (
            <div key={i} className="rounded bg-secondary p-2.5 space-y-1.5">
              <Skeleton className="h-2.5 w-16 mx-auto bg-background/60" />
              <Skeleton className="h-6 w-12 mx-auto bg-background/60" />
              <Skeleton className="h-2.5 w-20 mx-auto bg-background/60" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-4 border-t border-border pt-3">
          {Array.from({ length: 2 }, (_, col) => (
            <div key={col} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Skeleton className="h-2.5 w-12" />
                <Skeleton className="h-2.5 w-6" />
              </div>
              {Array.from({ length: 5 }, (_, row) => (
                <div key={row} className="flex items-center justify-between">
                  <Skeleton className="h-3 w-8" />
                  <Skeleton className="h-3 w-16" />
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Matches a chart card: stat header + the 220px ProbabilityChart viewport. */
export function ChartCardSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-6 w-40" />
        </div>
        <Skeleton className="w-full" style={{ height: 220 }} />
      </CardContent>
    </Card>
  );
}

/** Page title + subtitle block. */
export function PageHeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="h-4 w-56" />
    </div>
  );
}
