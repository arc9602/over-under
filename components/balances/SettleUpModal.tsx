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
import { formatCurrency } from "@/lib/utils/formatCurrency";
import type { NetBalance } from "@/lib/types";

interface SettleUpModalProps {
  balance: NetBalance;
  open: boolean;
  onClose: () => void;
}

export function SettleUpModal({ balance, open, onClose }: SettleUpModalProps) {
  const [isPending, startTransition] = useTransition();
  const amountOwed = Math.abs(balance.netAmount);
  const [amount, setAmount] = useState(amountOwed.toFixed(2));

  const youOwe = balance.netAmount < 0;
  const friendName = balance.friend.display_name ?? balance.friend.username;

  function handleSettle() {
    startTransition(async () => {
      const result = await markSettled(balance.friend.id, parseFloat(amount));
      if (result?.error) {
        toast.error(result.error);
      } else {
        toast.success(`Settled ${formatCurrency(parseFloat(amount))} with ${friendName}`);
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
              ? `Confirm that you paid ${friendName} outside the app.`
              : `Confirm that ${friendName} paid you outside the app.`}
          </p>
          <div className="space-y-2">
            <Label htmlFor="settleAmount">Amount</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold">$</span>
              <Input
                id="settleAmount"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="0.01"
                step="0.01"
                className="pl-6"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Full balance: {formatCurrency(amountOwed)}
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
