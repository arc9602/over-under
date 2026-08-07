import { redirect } from "next/navigation";
import Link from "next/link";
import { getMarketByInviteCode } from "@/lib/queries/markets";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { BetStatusBadge } from "@/components/bet/BetStatusBadge";
import { CountdownTimer } from "@/components/bet/CountdownTimer";
import { OrderTicket } from "@/components/market/OrderTicket";
import { getBestPrices, formatCents } from "@/lib/utils/marketBook";

interface Props {
  params: Promise<{ inviteCode: string }>;
}

export default async function MarketInviteLandingPage({ params }: Props) {
  const { inviteCode } = await params;
  const market = await getMarketByInviteCode(inviteCode);

  if (!market) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-black">Market not found</p>
          <p className="text-muted-foreground text-sm mt-2">
            This invite link may have expired or is invalid.
          </p>
          <Link href="/markets" className="text-primary text-sm mt-4 inline-block hover:underline">
            Go to markets
          </Link>
        </div>
      </div>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Already trading here? Straight to the real market page.
  if (user) {
    const alreadyIn =
      market.creator_id === user.id ||
      market.market_orders.some((o) => o.user_id === user.id);
    if (alreadyIn) redirect(`/markets/${market.id}`);
  }

  const creatorName = market.creator.display_name ?? market.creator.username;
  const best = getBestPrices(market.market_orders);
  const volume = market.market_fills.reduce((sum, f) => sum + f.quantity, 0);
  const canTrade = market.status === "open" || market.status === "active";

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <p className="text-xl font-black tracking-tight text-primary mb-1">OVER/UNDER</p>
          <p className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{creatorName}</span> opened a market
          </p>
        </div>

        <Card className="border-primary/30">
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-black text-lg leading-snug">{market.title}</h2>
              <BetStatusBadge status={market.status} />
            </div>

            {market.description && (
              <p className="text-sm text-muted-foreground">{market.description}</p>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="bg-secondary rounded p-2 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5 truncate">
                  Buy {market.yes_label}
                </p>
                <p className="font-black text-emerald-400">
                  {best.yes ? formatCents(best.yes.price) : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {best.yes ? `${best.yes.quantity} available` : "no offers"}
                </p>
              </div>
              <div className="bg-secondary rounded p-2 text-center">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5 truncate">
                  Buy {market.no_label}
                </p>
                <p className="font-black text-rose-400">
                  {best.no ? formatCents(best.no.price) : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {best.no ? `${best.no.quantity} available` : "no offers"}
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-2xl font-black text-primary">
                {market.last_price != null ? formatCents(market.last_price) : "—"}
              </span>
              {market.deadline && <CountdownTimer deadline={market.deadline} />}
            </div>
            <p className="text-xs text-muted-foreground text-center">
              {volume} {volume === 1 ? "contract" : "contracts"} traded · contracts pay $1 if right
            </p>
          </CardContent>
        </Card>

        {canTrade ? (
          user ? (
            <OrderTicket
              identifier={{ inviteCode }}
              currentUserId={user.id}
              yesLabel={market.yes_label}
              noLabel={market.no_label}
              orders={market.market_orders}
              fills={market.market_fills}
              maxContracts={market.max_contracts}
            />
          ) : (
            <div className="space-y-3">
              <Link
                href={`/signup?redirect=/market/${inviteCode}`}
                className={buttonVariants({ className: "w-full font-black text-base py-6" })}
              >
                Sign Up to Trade
              </Link>
              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link
                  href={`/login?redirect=/market/${inviteCode}`}
                  className="text-primary hover:underline"
                >
                  Sign in
                </Link>
              </p>
            </div>
          )
        ) : (
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              {market.status === "locked" || market.status === "resolving"
                ? "Trading is halted on this market while it resolves."
                : `This market is ${market.status} and no longer accepting orders.`}
            </p>
            {user && (
              <Link href="/markets" className="text-primary text-sm mt-2 inline-block hover:underline">
                Back to markets
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
