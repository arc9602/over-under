"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

// A single place_market_order can fire several triggers in one statement
// (orders, then fills, sometimes a resolution too), each landing as its own
// broadcast within milliseconds of the others. Coalescing on a trailing
// window means a burst costs one refetch instead of one per event -- without
// it, a busy market turns every open tab into a request amplifier hammering
// its own server.
const REFRESH_COALESCE_MS = 1000;

/**
 * Subscribes to the private broadcast channel defined in migration 020
 * ('market:<uuid>' or 'bet:<uuid>') and calls router.refresh() when the
 * database signals that something on it changed. Safe to call unconditionally
 * -- pass topic === null to mean "don't subscribe," so callers can satisfy
 * the rules of hooks while still deciding at render time whether a live
 * channel makes sense.
 *
 * router.refresh() re-runs the current route's server components through
 * their existing RLS-protected queries; that refetch, not the socket, is
 * what actually carries any data back to the page.
 */
export function useLiveChannel(topic: string | null) {
  const router = useRouter();
  // Kept in a ref so the subscribe effect below doesn't need `router` as a
  // dependency -- router identity churn would otherwise tear down and
  // reopen the channel on renders that have nothing to do with the topic.
  const routerRef = useRef(router);
  routerRef.current = router;

  useEffect(() => {
    if (!topic) return;

    const supabase = createClient();
    let cancelled = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let refreshPending = false;
    let warned = false;

    const refreshNow = () => {
      refreshPending = false;
      routerRef.current.refresh();
    };

    const requestRefresh = () => {
      // A backgrounded tab refetching on every event is pure waste -- hold
      // off and catch up once with a single refresh when it becomes visible
      // again, instead of firing (and re-debouncing) the whole time it's
      // hidden.
      if (document.visibilityState !== "visible") {
        refreshPending = true;
        return;
      }
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        refreshNow();
      }, REFRESH_COALESCE_MS);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible" && refreshPending) {
        refreshNow();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const channel = supabase.channel(topic, { config: { private: true } });

    channel.on("broadcast", { event: "changed" }, () => {
      // The payload ({ kind, at }) is intentionally dataless -- see the
      // header of supabase/migrations/020_realtime_and_indexes.sql. Treat it
      // purely as a trigger to refetch, never as a source of data. The
      // channel's whole security argument rests on there being nothing in
      // this payload to leak; if you're tempted to start passing real data
      // through it (an id, an amount, anything), re-read 020's header first.
      requestRefresh();
    });

    const applyAuth = (accessToken: string | null | undefined) => {
      // Private channels are authorized by RLS on realtime.messages at join
      // time, evaluated against the JWT the realtime socket is carrying --
      // so that JWT has to be set before subscribing, or the join is denied.
      void supabase.realtime.setAuth(accessToken ?? undefined);
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return;
      applyAuth(session?.access_token);
      channel.subscribe((status, err) => {
        if (
          !warned &&
          (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
        ) {
          // Degrade, never break: live updates are an enhancement on top of
          // pages that already work from their initial server render. Log
          // once so a real problem is discoverable, then leave the page
          // alone -- no retry loop, no throw, nothing the user sees.
          warned = true;
          console.warn(`[useLiveChannel] "${topic}" subscription ${status}`, err);
        }
      });
    });

    // Supabase access tokens are short-lived (about an hour), and a channel
    // whose token has expired simply stops being authorized -- no error, no
    // event, it just goes quiet. Re-applying on TOKEN_REFRESHED (and
    // SIGNED_IN, in case the session was still settling when the channel
    // first subscribed) is what keeps a long-open tab live. This is the
    // single most likely way this feature breaks in production, and the
    // hardest to notice, because nothing throws when it does.
    const {
      data: { subscription: authSubscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") {
        applyAuth(session?.access_token);
      }
    });

    return () => {
      // Leaked channels accumulate across client-side navigations and will
      // eventually hit the per-client channel cap, so every exit path --
      // unmount or topic change -- has to tear this all the way down.
      cancelled = true;
      if (debounceTimer) clearTimeout(debounceTimer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      authSubscription.unsubscribe();
      void supabase.removeChannel(channel);
    };
  }, [topic]);
}
