import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getNetBalancesForUser } from "@/lib/queries/balances";
import { BalanceCard } from "@/components/balances/BalanceCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { formatCurrency } from "@/lib/utils/formatCurrency";

export default async function BalancesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const balances = await getNetBalancesForUser(user.id).catch(() => []);

  const totalOwed = balances
    .filter((b) => b.netAmount > 0)
    .reduce((sum, b) => sum + b.netAmount, 0);
  const totalOwing = balances
    .filter((b) => b.netAmount < 0)
    .reduce((sum, b) => sum + Math.abs(b.netAmount), 0);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-black">Balances</h1>

      {balances.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Owed to you</p>
            <p className="text-xl font-black text-emerald-400">{formatCurrency(totalOwed)}</p>
          </div>
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-3">
            <p className="text-xs text-muted-foreground">You owe</p>
            <p className="text-xl font-black text-destructive">{formatCurrency(totalOwing)}</p>
          </div>
        </div>
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
          {balances.map((balance) => (
            <BalanceCard key={balance.friend.id} balance={balance} />
          ))}
        </div>
      )}
    </div>
  );
}
