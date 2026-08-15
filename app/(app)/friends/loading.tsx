import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PageHeaderSkeleton } from "@/components/shared/Skeletons";

/**
 * FriendsPage awaits auth then two Supabase queries in parallel
 * (getFriendsForUser, getFriendRequestsForUser) before it can render --
 * real network time, not an instant route. Shape mirrors
 * FriendsPageClient: header, "add a friend" card, then a friend-row list
 * whose avatar + two-line identity + action button is the same shape
 * already used for the outstanding-debt rows in balances/loading.tsx.
 */
export default function FriendsLoading() {
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <PageHeaderSkeleton />

      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-24" />
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Skeleton className="h-8 flex-1" />
            <Skeleton className="h-8 w-32" />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="divide-y divide-border">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-full" />
                <div className="space-y-1.5">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-16" />
                </div>
              </div>
              <Skeleton className="h-7 w-16" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
