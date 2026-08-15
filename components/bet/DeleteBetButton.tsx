"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { deleteBet } from "@/lib/actions/bets";
import { cn } from "@/lib/utils";

interface DeleteBetButtonProps {
  betId: string;
  betTitle: string;
  className?: string;
}

/**
 * The dashboard's delete affordance -- a secondary, icon-only trigger that
 * only ever renders on a bet lib/utils/betDelete.ts's isBetDeletable already
 * says is eligible, plus the confirming dialog itself. Deliberately a
 * self-contained unit (trigger + dialog together) rather than a controlled
 * modal like SettleUpModal, since every call site here just wants "render
 * this, or don't" with no state of its own to share.
 *
 * Rendered as a sibling of the bet's own <Link> in both BetRow and the
 * dashboard's mobile card wrapper (app/(app)/dashboard/page.tsx), never
 * nested inside it -- a <button> inside an <a> is invalid HTML, and it would
 * also make "never mis-clickable on the way to opening a bet" impossible to
 * guarantee. Being a sibling means a click here simply never reaches the
 * Link's own navigation handler, no stopPropagation required.
 */
export function DeleteBetButton({ betId, betTitle, className }: DeleteBetButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteBet(betId);
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`Deleted "${betTitle}"`);
      setOpen(false);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Delete "${betTitle}"`}
        onClick={(e) => {
          // Belt-and-suspenders: this button is never nested inside the
          // row's <Link>, so a click here can't reach its navigation
          // handler regardless -- but stopping it here too costs nothing
          // and keeps that guarantee from depending on where a future call
          // site happens to put this component.
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className={cn(
          "text-muted-foreground hover:text-destructive hover:bg-destructive/10",
          className
        )}
      >
        <Trash2 />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this bet?</DialogTitle>
            <DialogDescription>
              This permanently deletes &ldquo;{betTitle}&rdquo;. It cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={handleDelete}
              disabled={isPending}
              className="font-bold"
            >
              {isPending ? "Deleting…" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
