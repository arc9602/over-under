import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCardSkeleton } from "@/components/shared/Skeletons";

export default function BetDetailLoading() {
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
        <Skeleton className="h-9 w-40" />
        <ChartCardSkeleton />
        {/* The two side columns. */}
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
  );
}
