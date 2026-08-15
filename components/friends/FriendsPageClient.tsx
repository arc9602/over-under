"use client";

import { FormEvent, useState, useTransition } from "react";
import {
  cancelFriendRequest,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
} from "@/lib/actions/friends";
import type { FriendRequestWithProfile, Profile } from "@/lib/types";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface FriendsPageClientProps {
  friends: Profile[];
  incoming: FriendRequestWithProfile[];
  outgoing: FriendRequestWithProfile[];
}

function initials(profile: Profile) {
  return (profile.display_name ?? profile.username)
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function ProfileIdentity({ profile }: { profile: Profile }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <Avatar>
        {profile.avatar_url && (
          <AvatarImage
            src={profile.avatar_url}
            alt={profile.display_name ?? profile.username}
          />
        )}
        <AvatarFallback>{initials(profile)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold">
          {profile.display_name ?? profile.username}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          @{profile.username}
        </p>
      </div>
    </div>
  );
}

export function FriendsPageClient({
  friends,
  incoming,
  outgoing,
}: FriendsPageClientProps) {
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function runAction(action: () => Promise<{ error?: string; success?: boolean }>) {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      setMessage(result.error ?? null);
    });
  }

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = username.replace(/^@/, "");
    runAction(async () => {
      const result = await sendFriendRequest(value);
      if (result.success) setUsername("");
      return result;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Friends</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Add people by username, then invite them directly to your bets.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a friend</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAdd} className="flex gap-2">
            <Input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="@username"
              autoCapitalize="none"
              autoCorrect="off"
              disabled={isPending}
              aria-label="Friend username"
            />
            <Button type="submit" disabled={isPending || !username.trim()}>
              Send request
            </Button>
          </form>
          {message && (
            <p className="mt-2 text-sm text-destructive" role="alert">
              {message}
            </p>
          )}
        </CardContent>
      </Card>

      {incoming.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Friend requests ({incoming.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {incoming.map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <ProfileIdentity profile={request.profile} />
                <div className="flex shrink-0 gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      runAction(() => respondFriendRequest(request.id, true))
                    }
                    disabled={isPending}
                  >
                    Accept
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      runAction(() => respondFriendRequest(request.id, false))
                    }
                    disabled={isPending}
                  >
                    Decline
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {outgoing.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sent requests</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {outgoing.map((request) => (
              <div
                key={request.id}
                className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                <ProfileIdentity profile={request.profile} />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    runAction(() => cancelFriendRequest(request.id))
                  }
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Your friends ({friends.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {friends.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No friends yet. Send a request using their username.
            </p>
          ) : (
            <div className="divide-y divide-border">
              {friends.map((friend) => (
                <div
                  key={friend.id}
                  className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                >
                  <ProfileIdentity profile={friend} />
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => runAction(() => removeFriend(friend.id))}
                    disabled={isPending}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
