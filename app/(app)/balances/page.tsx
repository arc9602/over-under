import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getNetBalancesForUser, getIouLedger } from "@/lib/queries/balances";
import { BalanceCard } from "@/components/balances/BalanceCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { SplitBar } from "@/components/shared/SplitBar";
import { Sparkline } from "@/components/charts/Sparkline";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import { getNetBalanceHistory, getPortfolioStats } from "@/lib/utils/portfolio";
import type { IouEntry } from "@/lib/types";

export default async function BalancesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [balances, ledger] = await Promise.all([
    getNetBalancesForUser(user.id).catch(() => []),
    getIouLedger(user.id).catch(() => [] as IouEntry[]),
  ]);

  const totalOwed = balances
    .filter((b) => b.netAmount > 0)
    .reduce((sum, b) => sum + b.netAmount, 0);
  const totalOwing = balances
    .filter((b) => b.netAmount < 0)
    .reduce((sum, b) => sum + Math.abs(b.netAmount), 0);

  const stats = getPortfolioStats(ledger, user.id);
  const history = getNetBalanceHistory(ledger, user.id);
  const outstandingNet = totalOwed - totalOwing;
  const up = stats.lifetimeNet >= 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Portfolio</h1>
        {/* States plainly that these are IOUs between people, not an
            account balance the app is holding -- see PRODUCT.md's money
            model: this page is IOU-only. */}
        <p className="text-muted-foreground text-sm mt-0.5">
          What you&rsquo;ve won and lost, and what&rsquo;s still owed between you and your friends.
        </p>
      </div>

      {ledger.length > 0 && (
        // The net figure is the only reason this page exists. It reads as
        // the page's subject -- no card, no eyebrow label -- the same way
        // the dashboard's exposure line does, just scaled up to carry the
        // page on its own instead of sitting inside a box beside a list.
        <div className="space-y-3">
          <div>
            <p className="text-sm text-muted-foreground">Lifetime net</p>
            <p
              className={cn(
                "text-4xl sm:text-5xl font-bold tabular-nums",
                up ? "text-win" : "text-loss"
              )}
            >
              {up ? "+" : "−"}
              {formatCurrency(Math.abs(stats.lifetimeNet))}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              {stats.wins}W · {stats.losses}L
              {stats.winRate != null && ` · ${stats.winRate.toFixed(0)}% win rate`}
            </p>
          </div>
          {history.length > 1 && (
            <Sparkline
              values={history.map((h) => h.net)}
              colorClassName={up ? "text-win" : "text-loss"}
              height={56}
            />
          )}
        </div>
      )}

      {balances.length > 0 && (
        // A hairline stands in for the card border this section used to
        // have -- enough to separate "what you've made lifetime" from
        // "what's live right now" without stacking a second box under the
        // hero figure.
        <div className="space-y-3 pt-5 border-t border-border">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-sm text-muted-foreground">Outstanding</p>
            <p
              className={cn(
                "text-sm font-semibold tabular-nums",
                outstandingNet >= 0 ? "text-win" : "text-loss"
              )}
            >
              {outstandingNet >= 0 ? "+" : "−"}
              {formatCurrency(Math.abs(outstandingNet))} net
            </p>
          </div>
          <SplitBar leftValue={totalOwed} rightValue={totalOwing} />
          {/* Owed-to-you vs. you-owe is the second most important thing on
              this page. Label, position (left/right), and now a leading
              sign all carry the distinction alongside text-win/text-loss --
              a colorblind reader isn't left relying on color alone. */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Owed to you</p>
              <p className="text-xl font-semibold tabular-nums text-win">
                +{formatCurrency(totalOwed)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground">You owe</p>
              <p className="text-xl font-semibold tabular-nums text-loss">
                −{formatCurrency(totalOwing)}
              </p>
            </div>
          </div>
        </div>
      )}

      {balances.length === 0 ? (
        <EmptyState
          title="All square"
          description="Once you owe a friend or they owe you, it'll show up here."
          ctaLabel="New Bet"
          ctaHref="/bets/new"
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">
            Open Positions
          </p>
          {balances.map((balance) => (
            <BalanceCard key={balance.friend.id} balance={balance} />
          ))}
        </div>
      )}
    </div>
  );
}
