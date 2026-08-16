import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/chain/env";
import { getProductMetrics } from "@/lib/queries/metrics";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export default async function AdminMetricsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // /admin is deliberately absent from lib/supabase/middleware.ts's
  // protectedPaths list -- this in-page check is the only gate this route
  // has. Don't assume the middleware covers it just because every other page
  // under (app) gets that for free.
  if (!isAdmin(user.id)) {
    // 404, not 403 or an "unauthorized" message -- same reasoning as
    // requireAdminSession in lib/api/session.ts: a 403 confirms the route
    // exists and that a metrics dashboard is a thing, which is free
    // reconnaissance for a non-admin. Nothing is gained by telling them what
    // they found.
    notFound();
  }

  const metrics = await getProductMetrics();

  // Guarded against 0/0 -- pre-launch, with no bettors yet, this must render
  // 0% rather than NaN%.
  const repeatRate =
    metrics.usersWithABet > 0
      ? (metrics.usersWithTwoPlusBets / metrics.usersWithABet) * 100
      : 0;

  const maxWeekly = Math.max(
    1,
    ...metrics.weekly.map((w) => Math.max(w.signups, w.activeBettors))
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Product Metrics</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Whole-population figures, not scoped to you -- visible here only because you&rsquo;re an admin.
        </p>
      </div>

      {/* Headline row. Repeat rate carries the most visual weight of the
          three -- it's the single best pre-launch signal (one bet is
          curiosity, two is a product) -- the same way /balances gives
          lifetime net top billing over the numbers around it. */}
      <div className="grid grid-cols-3 gap-4 items-end">
        <div>
          <p className="text-sm text-muted-foreground">Total users</p>
          <p className="text-xl font-semibold tabular-nums">{metrics.totalUsers}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Placed a bet</p>
          <p className="text-xl font-semibold tabular-nums">{metrics.usersWithABet}</p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">Repeat rate</p>
          <p className="text-4xl sm:text-5xl font-bold tabular-nums">
            {repeatRate.toFixed(0)}%
          </p>
        </div>
      </div>

      <div className="space-y-3 pt-5 border-t border-border">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Last 12 weeks
          </p>
          <p className="text-sm text-muted-foreground tabular-nums">
            {metrics.totalBets} bets all-time
          </p>
        </div>
        <div className="grid grid-cols-[5.5rem_1fr_1fr] gap-4 text-xs text-muted-foreground">
          <span>Week of</span>
          <span>Signups</span>
          <span>Active bettors</span>
        </div>
        <div className="space-y-2">
          {metrics.weekly.map((w) => (
            <div
              key={w.weekStart}
              className="grid grid-cols-[5.5rem_1fr_1fr] gap-4 items-center text-sm"
            >
              <span className="text-muted-foreground tabular-nums">{w.weekStart}</span>
              <div className="flex items-center gap-2">
                <div
                  className="h-2 rounded-full bg-primary/50"
                  style={{ width: `${(w.signups / maxWeekly) * 100}%` }}
                />
                <span className="tabular-nums">{w.signups}</span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="h-2 rounded-full bg-win/50"
                  style={{ width: `${(w.activeBettors / maxWeekly) * 100}%` }}
                />
                <span className="tabular-nums">{w.activeBettors}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 pt-5 border-t border-border">
        <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
          IOU volume
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Outstanding</p>
            <p className="text-xl font-semibold tabular-nums text-loss">
              {formatCurrency(metrics.unsettledIouCents / 100)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-sm text-muted-foreground">Settled</p>
            <p className="text-xl font-semibold tabular-nums text-win">
              {formatCurrency(metrics.settledIouCents / 100)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
