import "server-only";

import { createPublicClient, createWalletClient, http, type Address, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygonAmoy } from "viem/chains";

import { getServerRpcUrl, getVaultAddress, getVaultPrivateKey } from "./env";

/**
 * Server-side chain clients.
 *
 * `server-only` at the top is the guard that matters: this module reads
 * VAULT_PRIVATE_KEY, and if a client component ever imported it -- directly or
 * three layers down a barrel file -- the build fails here instead of shipping
 * a bundle for someone to grep. That is a much better failure than a code
 * review catching it, or not.
 *
 * Clients are created per call rather than memoized at module scope. On
 * Cloudflare Workers module scope is evaluated per isolate and an isolate can
 * be reused across requests from different users; a memoized wallet client is
 * cheap to build and sharing one buys nothing but a way to leak state across
 * request boundaries. viem's http transport is stateless, so there is nothing
 * to pool.
 */

export function getPublicClient(): PublicClient {
  return createPublicClient({
    chain: polygonAmoy,
    transport: http(getServerRpcUrl()),
  });
}

/**
 * The vault signer, used only by the withdrawal path.
 *
 * Asserts that the key actually controls NEXT_PUBLIC_VAULT_ADDRESS. Without
 * this check a mismatched pair is undetectable until the first withdrawal:
 * users would have been depositing to an address the platform cannot spend
 * from, and every one of those deposits is stranded. Failing at the first
 * withdrawal attempt -- loudly, before broadcasting anything -- is the
 * cheapest place to catch a fat-fingered env var.
 */
export function getVaultWalletClient() {
  const account = privateKeyToAccount(getVaultPrivateKey());
  const configured = getVaultAddress();

  if (account.address.toLowerCase() !== configured) {
    throw new Error(
      `VAULT_PRIVATE_KEY controls ${account.address.toLowerCase()} but NEXT_PUBLIC_VAULT_ADDRESS is ${configured}. ` +
        `Deposits are going to an address the vault signer cannot spend from.`
    );
  }

  return createWalletClient({
    account,
    chain: polygonAmoy,
    transport: http(getServerRpcUrl()),
  });
}

export function getVaultAccountAddress(): Address {
  return getVaultAddress();
}

export { polygonAmoy };
