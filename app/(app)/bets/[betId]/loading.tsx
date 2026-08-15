import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCardSkeleton } from "@/components/shared/Skeletons";

/**
 * Tracks BetDetail's real order: the proposition leads (title at the same
 * text-2xl sm:text-3xl the real page uses), then where the viewer stands,
 * then what happens next, then the pool and its charts. A skeleton whose
 * shape doesn't match what replaces it produces a visible jump on load --
 * see app/(app)/balances/loading.tsx.
 */
export default function BetDetailLoading() {
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="space-y-5">
        {/* 1. The proposition. */}
        <div className="space-y-1">
          <div className="flex items-start justify-between gap-4">
            <Skeleton className="h-8 w-3/4 sm:h-9" />
            <Skeleton className="h-5 w-14 rounded-4xl shrink-0" />
          </div>
          <Skeleton className="h-4 w-1/2" />
        </div>

        {/* 2. Where the viewer stands: a side line, then stake/payout. */}
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <div className="flex items-baseline gap-6">
            <div className="space-y-1">
              <Skeleton className="h-3 w-10" />
              <Skeleton className="h-6 w-20" />
            </div>
            <div className="space-y-1">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-6 w-20" />
            </div>
          </div>
        </div>

        {/* 3. What happens next. */}
        <Skeleton className="h-4 w-64" />

        {/* 4. Pool total, split, and charts. */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-4 w-16" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
          <ChartCardSkeleton />
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 2 }, (_, i) => (
              <Card key={i}>
                <CardContent className="p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-12" />
                  </div>
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
