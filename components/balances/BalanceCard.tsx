"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { SettleUpModal } from "./SettleUpModal";
import { formatStake } from "@/lib/utils/formatStake";
import type { NetBalance, UnitBalance } from "@/lib/types";

interface BalanceCardProps {
  balance: NetBalance;
}

export function BalanceCard({ balance }: BalanceCardProps) {
  // Which unit's settle-up dialog is open. Debts in different units are
  // separate obligations (migration 022), so each settles on its own.
  const [settling, setSettling] = useState<UnitBalance | null>(null);

  const friendName = balance.friend.display_name ?? balance.friend.username;
  const initials = friendName.slice(0, 2).toUpperCase();
  const single = balance.units.length === 1;

  return (
    <>
      <Card>
        <CardContent className="p-4">
          {/* min-w-0 lets the name truncate instead of shoving the button
              off-screen on a narrow viewport. */}
          <div className="flex items-start gap-3">
            <Avatar className="h-9 w-9 shrink-0">
              <AvatarFallback className="bg-secondary text-foreground text-xs font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>

            <div className="min-w-0 flex-1">
              <p className="font-bold text-sm truncate">{friendName}</p>

              <ul className={single ? "" : "mt-1 space-y-1.5"}>
                {balance.units.map((unitBalance) => {
                  const youOwe = unitBalance.netAmount < 0;
                  const amount = Math.abs(unitBalance.netAmount);
                  return (
                    <li
                      key={unitBalance.unit}
                      className="flex items-center justify-between gap-3"
                    >
                      {/* "You owe" / "Owes you" carries the distinction in
                          words before color ever does -- text-win/text-loss
                          here, not text-destructive, since this is a debt
                          between two people, not an error state. */}
                      <p
                        className={`text-xs font-medium tabular-nums ${
                          youOwe ? "text-loss" : "text-win"
                        }`}
                      >
                        {youOwe ? "You owe " : "Owes you "}
                        {formatStake(amount, unitBalance.unit, unitBalance.unitPlural)}
                      </p>
                      {youOwe && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSettling(unitBalance)}
                          className="font-bold text-xs shrink-0"
                        >
                          Settle Up
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {settling && (
        <SettleUpModal
          friend={balance.friend}
          balance={settling}
          open
          onClose={() => setSettling(null)}
        />
      )}
    </>
  );
}
