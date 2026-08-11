"use client";

import { WalletProvider } from "./WalletProvider";
import { WalletButton } from "./WalletButton";

/**
 * Provider + button as one unit, so the Privy/wagmi stack has exactly one
 * entry point into the bundle graph and WalletWidget can lazy-load all of it
 * behind a single dynamic import.
 *
 * The provider deliberately wraps only the wallet UI rather than the whole
 * authenticated tree. It used to sit in app/(app)/layout.tsx, which is a
 * SERVER component -- and since client components are still server-rendered,
 * that dragged @privy-io/react-auth and its transitive @reown/appkit and
 * @metamask/sdk into the Cloudflare server bundle. The result was a 23 MB
 * handler against a 3 MiB Worker limit: undeployable.
 *
 * Nothing outside this subtree consumes wallet context, so scoping it here
 * costs nothing and keeps the heavy stack where it belongs -- in the browser,
 * loaded only on pages that actually show a wallet.
 */
export function WalletMount() {
  return (
    <WalletProvider>
      <WalletButton />
    </WalletProvider>
  );
}
