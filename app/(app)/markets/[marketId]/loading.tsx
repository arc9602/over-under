import { Skeleton } from "@/components/ui/skeleton";
import { ChartCardSkeleton, OrderBookSkeleton } from "@/components/shared/Skeletons";

export default function MarketDetailLoading() {
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
          <Skeleton className="h-5 w-14 rounded-4xl shrink-0" />
        </div>
        <Skeleton className="h-10 w-32" />
        <ChartCardSkeleton />
        <OrderBookSkeleton />
      </div>
    </div>
  );
}
