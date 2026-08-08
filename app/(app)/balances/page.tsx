import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getNetBalancesForUser, getIouLedger } from "@/lib/queries/balances";
import { BalanceCard } from "@/components/balances/BalanceCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { SplitBar } from "@/components/shared/SplitBar";
import { Sparkline } from "@/components/charts/Sparkline";
import { Card, CardContent } from "@/components/ui/card";
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
        <h1 className="text-2xl font-black">Portfolio</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Track your balances and performance.
        </p>
      </div>

      {ledger.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Lifetime Net
                </p>
                <p
                  className={`text-3xl font-black tabular-nums ${
                    up ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {up ? "+" : "−"}
                  {formatCurrency(Math.abs(stats.lifetimeNet))}
                </p>
                <p className="text-xs text-muted-foreground">
                  {stats.wins}W · {stats.losses}L
                  {stats.winRate != null && ` · ${stats.winRate.toFixed(0)}% win rate`}
                </p>
              </div>
            </div>
            {history.length > 1 && (
              <Sparkline
                values={history.map((h) => h.net)}
                colorClassName={up ? "text-emerald-400" : "text-rose-400"}
              />
            )}
          </CardContent>
        </Card>
      )}

      {balances.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                Outstanding
              </p>
              <p
                className={`text-sm font-black tabular-nums ${
                  outstandingNet >= 0 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {outstandingNet >= 0 ? "+" : "−"}
                {formatCurrency(Math.abs(outstandingNet))} net
              </p>
            </div>
            <SplitBar leftValue={totalOwed} rightValue={totalOwing} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Owed to you
                </p>
                <p className="text-xl font-black tabular-nums text-emerald-400">
                  {formatCurrency(totalOwed)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  You owe
                </p>
                <p className="text-xl font-black tabular-nums text-rose-400">
                  {formatCurrency(totalOwing)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {balances.length === 0 ? (
        <EmptyState
          title="All square"
          description="No outstanding balances. Start a bet to get things going."
          ctaLabel="New Bet"
          ctaHref="/bets/new"
        />
      ) : (
        <div className="space-y-3">
          <p className="text-xs font-black tracking-widest text-muted-foreground uppercase">
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
