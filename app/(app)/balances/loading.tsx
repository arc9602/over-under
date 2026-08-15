import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/shared/Skeletons";

/**
 * Shapes here track the real page deliberately. A skeleton whose layout does
 * not match what replaces it produces a visible jump on load, which is worse
 * than showing nothing: the boxes it drew turn out to have been lies about
 * where the content was going to be. When the page's composition changes,
 * this file changes with it.
 */
export default function BalancesLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      {/* Lifetime net, unboxed -- the page's subject sits directly on the
          background now, at display size, with its sparkline beneath. */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-12 w-48 sm:h-14 sm:w-56" />
        <Skeleton className="w-full" style={{ height: 48 }} />
      </div>

      {/* Outstanding split, separated by a hairline rather than a card. */}
      <div className="space-y-3 border-t border-border pt-6">
        <div className="flex items-baseline justify-between gap-4">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-1.5 w-full rounded-full" />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-7 w-24" />
          </div>
          <div className="flex flex-col items-end space-y-1.5">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-7 w-24" />
          </div>
        </div>
      </div>

      {/* The position list keeps its cards -- those are real rows of content,
          not a stat tile standing in for a heading. */}
      <div className="space-y-3">
        <Skeleton className="h-4 w-28" />
        {Array.from({ length: 2 }, (_, i) => (
          <Card key={i}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
              <Skeleton className="h-7 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
