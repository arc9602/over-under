"use client";

import dynamic from "next/dynamic";

/**
 * The wallet UI, loaded in the browser only.
 *
 * ssr: false is the whole point. @privy-io/react-auth pulls in @reown/appkit
 * and @metamask/sdk transitively; server-rendering that subtree put all of it
 * in the Cloudflare Worker bundle and pushed the handler to 23 MB against a
 * 3 MiB limit. None of it can do anything useful during SSR anyway -- it needs
 * window, an injected provider, and a live connection.
 *
 * ssr: false requires a client component to declare it, which is why this file
 * exists separately from WalletMount: app/(app)/layout.tsx and AppNav are
 * server components and cannot call dynamic() with that option themselves.
 *
 * The skeleton is sized to match the rendered button so the header does not
 * shift when the real one arrives.
 */
const WalletMount = dynamic(() => import("./WalletMount").then((m) => m.WalletMount), {
  ssr: false,
  loading: () => <div className="h-7 w-28 animate-pulse rounded bg-secondary" aria-hidden />,
});

export function WalletWidget() {
  return <WalletMount />;
}
