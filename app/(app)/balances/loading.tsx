import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageHeaderSkeleton } from "@/components/shared/Skeletons";

export default function BalancesLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />

      {/* Lifetime net stat + sparkline. */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="space-y-1.5">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
          <Skeleton className="w-full" style={{ height: 48 }} />
        </CardContent>
      </Card>

      {/* Outstanding split. */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-baseline justify-between gap-4">
            <Skeleton className="h-2.5 w-20" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-1.5 w-full rounded-full" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-6 w-20" />
            </div>
            <div className="space-y-1.5 flex flex-col items-end">
              <Skeleton className="h-2.5 w-16" />
              <Skeleton className="h-6 w-20" />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <Skeleton className="h-3 w-28" />
        {Array.from({ length: 2 }, (_, i) => (
          <Card key={i}>
            <CardContent className="p-4 flex items-center justify-between">
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
