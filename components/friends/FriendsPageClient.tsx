"use client";

import { FormEvent, useEffect, useRef, useState, useTransition } from "react";
import {
  cancelFriendRequest,
  findFriendByEmail,
  removeFriend,
  respondFriendRequest,
  sendFriendRequest,
  searchUsernames,
  type EmailSearchResult,
  type UsernameSearchResult,
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

/** Row shape shared by both discovery results -- neither carries an email. */
function DiscoveryRow({
  result,
  onAdd,
  disabled,
}: {
  result: UsernameSearchResult | EmailSearchResult;
  onAdd: () => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar>
          {result.avatarUrl && (
            <AvatarImage
              src={result.avatarUrl}
              alt={result.displayName ?? result.username}
            />
          )}
          <AvatarFallback>
            {(result.displayName ?? result.username)
              .split(" ")
              .map((part) => part[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">
            {result.displayName ?? result.username}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            @{result.username}
          </p>
        </div>
      </div>
      <Button size="sm" onClick={onAdd} disabled={disabled}>
        Add
      </Button>
    </div>
  );
}

// A typeahead fires one request per pause in typing, not one per keystroke --
// this is the floor on that pause. The RPC behind it (021) has its own rate
// limit as a backstop, but a client that hammers it on every keystroke burns
// that budget for no benefit, since nobody reads results that fast anyway.
const TYPEAHEAD_DEBOUNCE_MS = 300;
const MIN_PREFIX_LENGTH = 2;

// findFriendByEmail (lib/actions/friends.ts) resolves "no such account",
// "that account opted out", and "that's your own email" to the identical
// `{ result: null }` on purpose -- see that file's comment. This is the one
// string shown for all three, so it must stay the only place that renders
// anything for a null result. A 'use server' file can only export async
// functions, which is why this constant lives here instead of next to the
// logic it describes.
const EMAIL_NOT_FOUND_MESSAGE = "No account found with that email";

export function FriendsPageClient({
  friends,
  incoming,
  outgoing,
}: FriendsPageClientProps) {
  const [username, setUsername] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [suggestions, setSuggestions] = useState<UsernameSearchResult[]>([]);
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null);
  // Counts requests as they're actually launched (after the debounce delay),
  // not as they're typed. Only the response whose number still matches the
  // ref when it resolves is allowed to paint -- anything else is a slower
  // request for a prefix the user has since typed past, and letting it win
  // the race would show results for text that's no longer in the box. This
  // is the bug that looks like flaky search rather than what it is.
  const requestSeq = useRef(0);

  const [email, setEmail] = useState("");
  const [emailResult, setEmailResult] = useState<EmailSearchResult | null>(null);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailSearchPending, startEmailSearch] = useTransition();

  useEffect(() => {
    const prefix = username.replace(/^@/, "").trim().toLowerCase();
    if (prefix.length < MIN_PREFIX_LENGTH) {
      // Short or empty input shows nothing at all -- no dropdown, no "no
      // results" box. There's nothing useful to say about one character.
      setSuggestions([]);
      setSuggestionsError(null);
      return;
    }

    const timer = setTimeout(async () => {
      const seq = ++requestSeq.current;
      const result = await searchUsernames(prefix);
      if (seq !== requestSeq.current) return; // stale -- a newer request is in flight
      if ("error" in result) {
        setSuggestions([]);
        setSuggestionsError(result.error);
      } else {
        setSuggestionsError(null);
        setSuggestions(result.results);
      }
    }, TYPEAHEAD_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [username]);

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
      if (result.success) {
        setUsername("");
        setSuggestions([]);
      }
      return result;
    });
  }

  function handleAddSuggestion(result: UsernameSearchResult) {
    runAction(async () => {
      const outcome = await sendFriendRequest(result.username);
      if (outcome.success) {
        setUsername("");
        setSuggestions([]);
      }
      return outcome;
    });
  }

  function handleEmailSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setEmailMessage(null);
    setEmailResult(null);
    startEmailSearch(async () => {
      const result = await findFriendByEmail(email);
      if ("error" in result) {
        setEmailMessage(result.error);
        return;
      }
      if (!result.result) {
        setEmailMessage(EMAIL_NOT_FOUND_MESSAGE);
        return;
      }
      setEmailResult(result.result);
    });
  }

  function handleAddByEmail() {
    if (!emailResult) return;
    runAction(async () => {
      const outcome = await sendFriendRequest(emailResult.username);
      if (outcome.success) {
        setEmail("");
        setEmailResult(null);
        setEmailMessage(null);
      }
      return outcome;
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
        <CardContent className="space-y-4">
          <div>
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
            <p className="mt-1 text-xs text-muted-foreground">
              Usernames autocomplete as you type.
            </p>
            {suggestions.length > 0 && (
              <div className="mt-2 divide-y divide-border rounded-lg border border-border px-3">
                {suggestions.map((result) => (
                  <DiscoveryRow
                    key={result.id}
                    result={result}
                    onAdd={() => handleAddSuggestion(result)}
                    disabled={isPending}
                  />
                ))}
              </div>
            )}
            {suggestionsError && (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {suggestionsError}
              </p>
            )}
          </div>

          {message && (
            <p className="text-sm text-destructive" role="alert">
              {message}
            </p>
          )}

          <div className="border-t border-border pt-4">
            <form onSubmit={handleEmailSearch} className="flex gap-2">
              <Input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="Their email address"
                autoCapitalize="none"
                autoCorrect="off"
                disabled={emailSearchPending}
                aria-label="Friend email"
              />
              <Button
                type="submit"
                variant="outline"
                disabled={emailSearchPending || !email.trim()}
              >
                Search
              </Button>
            </form>
            <p className="mt-1 text-xs text-muted-foreground">
              Email needs the full address -- it only matches an exact one, on
              submit.
            </p>
            {emailResult && (
              <div className="mt-2 rounded-lg border border-border px-3">
                <DiscoveryRow
                  result={emailResult}
                  onAdd={handleAddByEmail}
                  disabled={isPending}
                />
              </div>
            )}
            {emailMessage && (
              <p className="mt-2 text-sm text-destructive" role="alert">
                {emailMessage}
              </p>
            )}
          </div>
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
