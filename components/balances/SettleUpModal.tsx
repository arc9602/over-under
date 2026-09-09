"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { markSettled } from "@/lib/actions/balances";
import {
  formatStake,
  formatUnitAmount,
  isMoneyUnit,
  unitLabel,
} from "@/lib/utils/formatStake";
import type { Profile, UnitBalance } from "@/lib/types";

interface SettleUpModalProps {
  friend: Profile;
  /** A single unit's debt. Units settle independently of one another. */
  balance: UnitBalance;
  open: boolean;
  onClose: () => void;
}

export function SettleUpModal({ friend, balance, open, onClose }: SettleUpModalProps) {
  const [isPending, startTransition] = useTransition();
  const money = isMoneyUnit(balance.unit);
  const amountOwed = Math.abs(balance.netAmount);
  const [amount, setAmount] = useState(
    money ? amountOwed.toFixed(2) : formatUnitAmount(amountOwed)
  );

  const youOwe = balance.netAmount < 0;
  const friendName = friend.display_name ?? friend.username;

  function handleSettle() {
    startTransition(async () => {
      const result = await markSettled(
        friend.id,
        parseFloat(amount),
        balance.unit,
        balance.unitPlural
      );
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success(
          `Settled ${formatStake(parseFloat(amount), balance.unit, balance.unitPlural)} with ${friendName}`
        );
        onClose();
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as Settled</DialogTitle>
        </DialogHeader>
        <div className="py-2 space-y-4">
          <p className="text-sm text-muted-foreground">
            {youOwe
              ? `Confirm that you squared up with ${friendName} outside the app.`
              : `Confirm that ${friendName} squared up with you outside the app.`}
          </p>
          <div className="space-y-2">
            <Label htmlFor="settleAmount">
              {money ? "Amount" : `How many ${unitLabel(balance.unit, balance.unitPlural)}?`}
            </Label>
            <div className="relative">
              {money && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">
                  $
                </span>
              )}
              <Input
                id="settleAmount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.01"
                step="0.01"
                className={money ? "pl-6" : ""}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Full balance: {formatStake(amountOwed, balance.unit, balance.unitPlural)}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSettle} disabled={isPending} className="font-bold">
            {isPending ? "Saving…" : "Mark Settled"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
