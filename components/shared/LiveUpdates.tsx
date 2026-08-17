"use client";

import { useLiveChannel } from "@/lib/realtime/useLiveChannel";

interface LiveUpdatesProps {
  topic: string;
}

/**
 * Renders nothing. Its only job is to let a page that's a server component
 * opt into live updates by dropping in one element, without the page itself
 * having to become a client component just to hold a `useEffect` and a
 * Supabase subscription -- that boundary stays contained in here and in the
 * hook it calls.
 */
export function LiveUpdates({ topic }: LiveUpdatesProps) {
  useLiveChannel(topic);
  return null;
}
