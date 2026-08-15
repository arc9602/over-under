"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { inviteFriendToBet } from "@/lib/actions/invites";
import type { Profile } from "@/lib/types";

interface InviteSharePanelProps {
  inviteCode: string;
  /** Public landing route this code belongs to. Markets share the same panel. */
  basePath?: "/bet" | "/market";
  blurb?: string;
  shareTitle?: string;
  betId?: string;
  friends?: Profile[];
  invitedFriendIds?: string[];
}

export function InviteSharePanel({
  inviteCode,
  basePath = "/bet",
  blurb = "Share this link with your friend to take the other side.",
  shareTitle = "Join my bet on Over/Under",
  betId,
  friends = [],
  invitedFriendIds = [],
}: InviteSharePanelProps) {
  const [copied, setCopied] = useState(false);
  const [selectedFriendId, setSelectedFriendId] = useState("");
  const [sentFriendIds, setSentFriendIds] = useState(invitedFriendIds);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${basePath}/${inviteCode}`
      : `${basePath}/${inviteCode}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (navigator.share) {
      await navigator.share({ title: shareTitle, url: inviteUrl });
    } else {
      handleCopy();
    }
  }

  function handleFriendInvite() {
    if (!betId || !selectedFriendId) return;
    setInviteError(null);
    startTransition(async () => {
      const result = await inviteFriendToBet(betId, selectedFriendId);
      if (result.error) {
        setInviteError(result.error);
        return;
      }
      setSentFriendIds((ids) => [...ids, selectedFriendId]);
      setSelectedFriendId("");
    });
  }

  const availableFriends = friends.filter(
    (friend) => !sentFriendIds.includes(friend.id)
  );

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4">
        {betId && (
          <div className="mb-4 border-b border-border pb-4">
            <p className="mb-2 text-xs font-semibold tracking-widest text-primary">
              INVITE A FRIEND
            </p>
            {friends.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                Add friends first, then invite them here.{" "}
                <Link href="/friends" className="font-bold text-primary hover:underline">
                  Find friends
                </Link>
              </p>
            ) : availableFriends.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                All eligible friends have already been invited.
              </p>
            ) : (
              <div className="flex gap-2">
                <select
                  value={selectedFriendId}
                  onChange={(event) => setSelectedFriendId(event.target.value)}
                  className="h-9 min-w-0 flex-1 rounded border border-input bg-background px-3 text-sm"
                  disabled={isPending}
                  aria-label="Friend to invite"
                >
                  <option value="">Choose a friend</option>
                  {availableFriends.map((friend) => (
                    <option key={friend.id} value={friend.id}>
                      {friend.display_name ?? friend.username} (@{friend.username})
                    </option>
                  ))}
                </select>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleFriendInvite}
                  disabled={isPending || !selectedFriendId}
                >
                  {isPending ? "Sending..." : "Invite"}
                </Button>
              </div>
            )}
            {inviteError && (
              <p className="mt-2 text-xs text-destructive" role="alert">
                {inviteError}
              </p>
            )}
          </div>
        )}
        <p className="text-xs font-semibold tracking-widest text-primary mb-2">INVITE LINK</p>
        <p className="text-xs text-muted-foreground mb-3">{blurb}</p>
        <div className="flex items-center gap-2 bg-background rounded border border-border px-3 py-2 mb-3">
          <span className="text-xs text-muted-foreground flex-1 truncate">{inviteUrl}</span>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleCopy} variant="outline" size="sm" className="flex-1 font-bold">
            {copied ? "Copied!" : "Copy Link"}
          </Button>
          <Button onClick={handleShare} size="sm" className="flex-1 font-bold">
            Share
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
