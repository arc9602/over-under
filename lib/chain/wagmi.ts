"use client";

import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { polygonAmoy } from "viem/chains";

import { getPublicRpcUrl } from "./env";

/**
 * Client-side wagmi config.
 *
 * createConfig comes from @privy-io/wagmi, not from wagmi itself. The two are
 * API-compatible, but Privy's version is what makes the embedded wallet show
 * up as a wagmi connector -- with the stock wagmi createConfig, useAccount()
 * reports disconnected for a user who signed in with email and has an
 * embedded wallet, because wagmi has no idea that wallet exists. Every
 * balance read and every deposit transfer would then silently do nothing for
 * exactly the users this app is built around.
 *
 * Single chain on purpose. A user on the wrong network is a support problem
 * with no upside here: there is one USDC contract and one vault, both on
 * Amoy, so there is nothing to switch to.
 */
export const wagmiConfig = createConfig({
  chains: [polygonAmoy],
  transports: {
    [polygonAmoy.id]: http(getPublicRpcUrl()),
  },
});
