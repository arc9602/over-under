import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getMarketById } from "@/lib/queries/markets";
import { getNetIouForMarket } from "@/lib/queries/balances";
import { MarketDetail } from "@/components/market/MarketDetail";
import { MarketResolutionPanel } from "@/components/market/MarketResolutionPanel";
import { MyOrdersList } from "@/components/market/MyOrdersList";
import { OrderTicket } from "@/components/market/OrderTicket";
import { InviteSharePanel } from "@/components/bet/InviteSharePanel";
import { cancelMarket, lockMarket } from "@/lib/actions/markets";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

interface Props {
  params: Promise<{ marketId: string }>;
}

export default async function MarketDetailPage({ params }: Props) {
  const { marketId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const market = await getMarketById(marketId);
  if (!market) notFound();

  const isCreator = market.creator_id === user.id;
  const hasTraded =
    market.market_orders.some((o) => o.user_id === user.id) ||
    market.market_fills.some((f) => f.yes_user_id === user.id || f.no_user_id === user.id);
  if (!hasTraded && !isCreator) {
    // They may have the invite link — send them to the public landing.
    redirect(`/market/${market.invite_code}`);
  }

  const canTrade = market.status === "open" || market.status === "active";
  const canLock = isCreator && market.status === "active";
  const canCancel = isCreator && (market.status === "open" || market.status === "active");
  const showResolution =
    market.status === "locked" ||
    market.status === "resolving" ||
    market.status === "resolved" ||
    market.status === "stuck";
  // A cancelled market has nothing to trade and nothing to resolve -- don't
  // reserve a column of empty space beside the market info for it.
  const hasActionPanel = canTrade || canLock || canCancel || showResolution;

  const netIou =
    market.status === "resolved" ? await getNetIouForMarket(marketId, user.id) : undefined;

  return (
    // Below lg this is the same single centered column it always was. From lg
    // up it splits in two: market info (title, price, chart, book) scrolls on
    // the left, while the order ticket and every other action stay pinned in
    // a sticky right column -- so placing a trade never means scrolling past
    // the chart and book first. See plans/009-market-detail.md.
    <div
      className={cn(
        "max-w-lg mx-auto space-y-6",
        hasActionPanel &&
          "lg:max-w-none lg:mx-0 lg:grid lg:grid-cols-[1fr_22rem] lg:items-start lg:gap-8 lg:space-y-0"
      )}
    >
      <div className="lg:min-w-0">
        <MarketDetail market={market} currentUserId={user.id} />
      </div>

      {hasActionPanel && (
        <div className="space-y-6 lg:sticky lg:top-20">
          <Separator className="lg:hidden" />

          {canTrade && (
            <InviteSharePanel
              inviteCode={market.invite_code}
              basePath="/market"
              blurb="Share this link so friends can trade against your orders."
              shareTitle="Trade my market on Over/Under"
            />
          )}

          {canTrade && (
            <OrderTicket
              identifier={{ marketId }}
              currentUserId={user.id}
              yesLabel={market.yes_label}
              noLabel={market.no_label}
              orders={market.market_orders}
              fills={market.market_fills}
              maxContracts={market.max_contracts}
            />
          )}

          {canTrade && (
            <MyOrdersList
              marketId={marketId}
              orders={market.market_orders}
              currentUserId={user.id}
              yesLabel={market.yes_label}
              noLabel={market.no_label}
            />
          )}

          {canLock && (
            <form
              action={async () => {
                "use server";
                await lockMarket(marketId);
              }}
            >
              <Button type="submit" className="w-full font-bold">
                Halt Trading &amp; Start Resolution
              </Button>
            </form>
          )}

          {showResolution && (
            <MarketResolutionPanel market={market} currentUserId={user.id} netIou={netIou} />
          )}

          {canCancel && (
            <form
              action={async () => {
                "use server";
                await cancelMarket(marketId);
              }}
            >
              <Button
                type="submit"
                variant="outline"
                className="text-destructive hover:text-destructive w-full"
              >
                Cancel Market
              </Button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
