"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SettleUpModal } from "./SettleUpModal";
import { formatCurrency } from "@/lib/utils/formatCurrency";
import type { NetBalance } from "@/lib/types";

interface BalanceCardProps {
  balance: NetBalance;
}

export function BalanceCard({ balance }: BalanceCardProps) {
  const [showModal, setShowModal] = useState(false);
  const youOwe = balance.netAmount < 0;
  const friendName = balance.friend.display_name ?? balance.friend.username;
  const initials = friendName.slice(0, 2).toUpperCase();
  const amount = Math.abs(balance.netAmount);

  return (
    <>
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center justify-between gap-3">
            {/* min-w-0 lets the name truncate instead of shoving the button
                off-screen on a narrow viewport. */}
            <div className="flex items-center gap-3 min-w-0">
              <Avatar className="h-9 w-9 shrink-0">
                <AvatarFallback className="bg-secondary text-foreground text-xs font-bold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="font-bold text-sm truncate">{friendName}</p>
                <p
                  className={`text-xs font-medium tabular-nums ${
                    youOwe ? "text-destructive" : "text-win"
                  }`}
                >
                  {youOwe
                    ? `You owe ${formatCurrency(amount)}`
                    : `Owes you ${formatCurrency(amount)}`}
                </p>
              </div>
            </div>
            {youOwe && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowModal(true)}
                className="font-bold text-xs shrink-0"
              >
                Settle Up
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <SettleUpModal
        balance={balance}
        open={showModal}
        onClose={() => setShowModal(false)}
      />
    </>
  );
}
