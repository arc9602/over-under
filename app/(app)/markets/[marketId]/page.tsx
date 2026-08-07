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

  const netIou =
    market.status === "resolved" ? await getNetIouForMarket(marketId, user.id) : undefined;

  return (
    <div className="max-w-lg mx-auto space-y-6">
      <MarketDetail market={market} currentUserId={user.id} />

      <Separator />

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

      {(market.status === "locked" ||
        market.status === "resolving" ||
        market.status === "resolved" ||
        market.status === "stuck") && (
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
  );
}
