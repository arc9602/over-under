import { Skeleton } from "@/components/ui/skeleton";
import {
  CardListSkeleton,
  PageHeaderSkeleton,
  StatRowSkeleton,
} from "@/components/shared/Skeletons";

export default function MarketsLoading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <StatRowSkeleton />
      <Skeleton className="h-9 w-full sm:w-72" />
      <CardListSkeleton count={3} />
    </div>
  );
}
