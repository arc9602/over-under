"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBetInvite } from "@/lib/actions/invites";
import type { BetInviteWithDetails } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export function BetInviteNotifications({
  invites,
}: {
  invites: BetInviteWithDetails[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [activeInviteId, setActiveInviteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function openInvite(invite: BetInviteWithDetails) {
    setActiveInviteId(invite.id);
    setError(null);
    startTransition(async () => {
      const result = await updateBetInvite(invite.id, "seen");
      if (result.error) {
        setError(result.error);
        setActiveInviteId(null);
        return;
      }
      router.push(`/bet/${invite.bet.invite_code}`);
    });
  }

  function declineInvite(inviteId: string) {
    setActiveInviteId(inviteId);
    setError(null);
    startTransition(async () => {
      const result = await updateBetInvite(inviteId, "declined");
      setActiveInviteId(null);
      if (result.error) setError(result.error);
    });
  }

  if (invites.length === 0) return null;

  return (
    <section className="space-y-3" aria-labelledby="bet-invites-heading">
      <div>
        <h2 id="bet-invites-heading" className="text-base font-semibold">
          Bet invitations
        </h2>
        <p className="text-xs text-muted-foreground">
          Friends invited you to make a prediction.
        </p>
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {invites.map((invite) => {
        const working = isPending && activeInviteId === invite.id;
        return (
          <Card key={invite.id} className="border-primary/30 bg-primary/5">
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{invite.bet.title}</p>
                <p className="text-xs text-muted-foreground">
                  From {invite.inviter.display_name ?? `@${invite.inviter.username}`}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  onClick={() => openInvite(invite)}
                  disabled={isPending}
                >
                  {working ? "Opening..." : "Open"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => declineInvite(invite.id)}
                  disabled={isPending}
                >
                  Decline
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </section>
  );
}
