"use client";

import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cancelMarketOrder } from "@/lib/actions/markets";
import { formatCents, getMyOpenOrders, restingQuantity } from "@/lib/utils/marketBook";
import type { MarketOrder } from "@/lib/types";

interface MyOrdersListProps {
  marketId: string;
  orders: MarketOrder[];
  currentUserId: string;
  yesLabel: string;
  noLabel: string;
}

export function MyOrdersList({
  marketId,
  orders,
  currentUserId,
  yesLabel,
  noLabel,
}: MyOrdersListProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const mine = getMyOpenOrders(orders, currentUserId);
  if (mine.length === 0) return null;

  function handleCancel(orderId: string) {
    setError(null);
    startTransition(async () => {
      const result = await cancelMarketOrder(orderId, marketId);
      if (result?.error) setError(result.error);
    });
  }

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <p className="text-xs font-black tracking-widest text-muted-foreground">YOUR RESTING ORDERS</p>
        <ul className="space-y-2">
          {mine.map((order) => (
            <li key={order.id} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold truncate">
                  {restingQuantity(order)} {order.side === "yes" ? yesLabel : noLabel} at{" "}
                  {formatCents(order.limit_price)}
                </p>
                {order.filled_quantity > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {order.filled_quantity} of {order.quantity} already filled
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive shrink-0"
                onClick={() => handleCancel(order.id)}
                disabled={isPending}
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
