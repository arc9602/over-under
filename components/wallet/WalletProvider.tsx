"use client";

/**
 * Privy + wagmi provider for the authenticated section of the app.
 *
 * Identity is Supabase. Privy is here purely to custody wallets: a user who
 * signed in with a magic link still needs somewhere to hold testnet USDC, and
 * Privy's embedded wallet is that somewhere. Nothing in this file touches
 * login, session, or middleware.
 *
 * Nesting order is load-bearing. PrivyProvider has to be outermost because
 * @privy-io/wagmi's WagmiProvider reads Privy's wallet list to synthesize the
 * embedded-wallet connector, and WagmiProvider needs a QueryClient in scope
 * for its own hooks -- so Privy -> QueryClient -> Wagmi, in that order.
 *
 * When chain env is blank (a fresh clone, CI, or any deploy that hasn't been
 * given a Privy app id yet) this renders children with no provider at all
 * rather than throwing. getPrivyAppId() would throw, and a throw at the layout
 * level takes down every authenticated page in the app. Components that need
 * wallet context gate on isChainConfigured() themselves for the same reason.
 */

import { useState, type ReactNode } from "react";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { polygonAmoy } from "viem/chains";

import { getPrivyAppId, isChainConfigured } from "@/lib/chain/env";
import { wagmiConfig } from "@/lib/chain/wagmi";

export function WalletProvider({ children }: { children: ReactNode }) {
  // Created once per mount. A QueryClient built inline in the render body is
  // a new cache on every render, which silently disables caching and refetches
  // the USDC balance on every keystroke anywhere in the tree.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Chain reads are cheap but not free, and an RPC that briefly
            // rate-limits shouldn't blank out the header balance.
            staleTime: 10_000,
            retry: 2,
            refetchOnWindowFocus: true,
          },
        },
      })
  );

  // Constant for the lifetime of the bundle -- NEXT_PUBLIC_* values are
  // inlined at build time -- so this early return can never change the hook
  // order between renders.
  if (!isChainConfigured()) {
    return <>{children}</>;
  }

  return (
    <PrivyProvider
      appId={getPrivyAppId()}
      config={{
        // Email and social first: the whole point of the embedded wallet is
        // that a user who has never held crypto can still take a position.
        loginMethods: ["email", "google", "wallet"],
        appearance: {
          theme: "dark",
          walletChainType: "ethereum-only",
        },
        embeddedWallets: {
          ethereum: {
            // Only users who arrive without a wallet get one provisioned;
            // someone who connected MetaMask keeps using MetaMask.
            createOnLogin: "users-without-wallets",
          },
          showWalletUIs: true,
        },
        // One chain, one USDC contract, one vault. There is nothing to switch
        // to, so anything other than Amoy is a misconfiguration, not a choice.
        defaultChain: polygonAmoy,
        supportedChains: [polygonAmoy],
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
