/**
 * Persists the wager a signed-out visitor is about to place across the
 * Google OAuth round-trip, so `/bet/[inviteCode]` can restore their choice
 * instead of dropping it and making them start over.
 *
 * sessionStorage survives the trip to Google and back because OAuth returns
 * to the same tab, same origin -- LoginForm/api/auth/callback already rely
 * on that same property for the `oauth_redirect` cookie. It deliberately
 * does NOT go in the `?redirect=` query param: that param is already
 * user-influenced and feeds a same-origin-only post-login redirect (see
 * safeRedirectPath), and widening it into a structured wager payload would
 * enlarge that surface for no gain.
 *
 * This module is imported from client components, but those are still
 * server-rendered once before they hydrate, and this app additionally
 * builds for Cloudflare Workers, where `sessionStorage` doesn't exist at
 * all -- a bare reference at module scope would throw during the build, not
 * just at runtime. Every export below checks `typeof window` first and
 * no-ops when it's absent.
 */

export type PendingWager =
  | {
      kind: "bet";
      inviteCode: string;
      side: "a" | "b" | null;
      optionId: string | null;
      amount: number;
      savedAt: number;
    }
  | {
      kind: "market";
      inviteCode: string;
      side: "yes" | "no";
      limitPrice: number;
      quantity: number;
      savedAt: number;
    };

/** Anything older than this is treated as abandoned, not restored. */
const TTL_MS = 30 * 60 * 1000;

/** Namespaced so this module can't collide with anything else in the tab's sessionStorage. */
function storageKey(kind: "bet" | "market", inviteCode: string): string {
  return `overunder:pendingWager:${kind}:${inviteCode}`;
}

export function savePendingWager(wager: PendingWager): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(storageKey(wager.kind, wager.inviteCode), JSON.stringify(wager));
  } catch {
    // Storage can be full, or denied entirely (some browsers in private
    // mode). Losing the restore-after-login convenience is fine; throwing
    // out of a click handler and breaking the commit flow is not.
  }
}

export function readPendingWager(kind: "bet" | "market", inviteCode: string): PendingWager | null {
  if (typeof window === "undefined") return null;
  const key = storageKey(kind, inviteCode);
  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isValidPendingWager(parsed, kind, inviteCode)) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    if (Date.now() > parsed.savedAt + TTL_MS) {
      window.sessionStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    // Corrupt JSON, a value some other script wrote under our key, or a
    // storage read that throws (denied access) -- never let a bad read
    // break the page render. Treat it the same as "nothing saved".
    return null;
  }
}

export function clearPendingWager(kind: "bet" | "market", inviteCode: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKey(kind, inviteCode));
  } catch {
    // Best effort -- see savePendingWager.
  }
}

/**
 * Never trust what came out of storage: it could be last week's shape from
 * a previous deploy, garbage from a browser extension, or a value written
 * under this key by mistake. `inviteCode` is checked too, not just `kind`,
 * even though the key already embeds it -- this is the actual runtime
 * boundary, the key match is only ever a first filter.
 */
function isValidPendingWager(
  value: unknown,
  kind: "bet" | "market",
  inviteCode: string
): value is PendingWager {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;

  if (v.kind !== kind) return false;
  if (v.inviteCode !== inviteCode) return false;
  if (typeof v.amount !== "number" || !Number.isFinite(v.amount)) return false;
  if (typeof v.savedAt !== "number" || !Number.isFinite(v.savedAt)) return false;

  if (kind === "bet") {
    if (v.side !== "a" && v.side !== "b" && v.side !== null) return false;
    if (typeof v.optionId !== "string" && v.optionId !== null) return false;
    return true;
  }

  // kind === "market"
  if (v.side !== "yes" && v.side !== "no") return false;
  if (typeof v.limitPrice !== "number" || !Number.isInteger(v.limitPrice) || v.limitPrice < 1 || v.limitPrice > 99) {
    return false;
  }
  if (typeof v.quantity !== "number" || !Number.isInteger(v.quantity) || v.quantity <= 0) return false;
  return true;
}
