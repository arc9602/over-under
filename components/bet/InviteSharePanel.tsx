"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface InviteSharePanelProps {
  inviteCode: string;
}

export function InviteSharePanel({ inviteCode }: InviteSharePanelProps) {
  const [copied, setCopied] = useState(false);

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/bet/${inviteCode}`
      : `/bet/${inviteCode}`;

  async function handleCopy() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleShare() {
    if (navigator.share) {
      await navigator.share({ title: "Join my bet on Over/Under", url: inviteUrl });
    } else {
      handleCopy();
    }
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardContent className="p-4">
        <p className="text-xs font-black tracking-widest text-primary mb-2">INVITE LINK</p>
        <p className="text-xs text-muted-foreground mb-3">
          Share this link with your friend to take the other side.
        </p>
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
