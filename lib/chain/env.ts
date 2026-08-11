/**
 * Chain environment, validated lazily.
 *
 * Nothing in this module throws at import time, and that is deliberate rather
 * than lax. `next build` imports every module in the graph; if a missing
 * NEXT_PUBLIC_VAULT_ADDRESS threw at module scope, the build would fail on a
 * machine that has no secrets -- which is every CI runner and every fresh
 * clone. Validation happens on first use instead, so the app compiles with a
 * .env.local full of blanks and fails loudly, with a useful message, only when
 * something actually tries to touch the chain.
 *
 * NEXT_PUBLIC_* reads are written out as full static `process.env.X`
 * expressions because that literal form is what Next.js's build-time inlining
 * matches. Computing the key (`process.env["NEXT_PUBLIC_" + name]`) reads as
 * equivalent and is not -- it inlines as undefined in the browser bundle.
 */

import type { Address } from "viem";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function requireEnv(name: string, value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith("PASTE_")) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in.`
    );
  }
  return trimmed;
}

/**
 * Addresses are lowercased on the way out so every comparison in the codebase
 * is a plain `===`. EIP-55 checksum casing is presentational; treating it as
 * significant is how an address equality check quietly returns false for the
 * right address.
 */
function requireAddress(name: string, value: string | undefined): Address {
  const raw = requireEnv(name, value);
  if (!ADDRESS_RE.test(raw)) {
    throw new Error(`${name} is not a valid 0x-prefixed 20-byte address: ${raw}`);
  }
  return raw.toLowerCase() as Address;
}

/** Polygon Amoy testnet. */
export const DEFAULT_CHAIN_ID = 80002;

export function getChainId(): number {
  const raw = process.env.NEXT_PUBLIC_CHAIN_ID?.trim();
  if (!raw) return DEFAULT_CHAIN_ID;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`NEXT_PUBLIC_CHAIN_ID is not a valid chain id: ${raw}`);
  }
  return parsed;
}

export function getUsdcAddress(): Address {
  return requireAddress(
    "NEXT_PUBLIC_USDC_CONTRACT_ADDRESS",
    process.env.NEXT_PUBLIC_USDC_CONTRACT_ADDRESS
  );
}

export function getVaultAddress(): Address {
  return requireAddress("NEXT_PUBLIC_VAULT_ADDRESS", process.env.NEXT_PUBLIC_VAULT_ADDRESS);
}

export function getPrivyAppId(): string {
  return requireEnv("NEXT_PUBLIC_PRIVY_APP_ID", process.env.NEXT_PUBLIC_PRIVY_APP_ID);
}

/**
 * True when the client-side chain config is complete enough to mount the
 * Privy provider. Lets the UI render a "wallet not configured" state instead
 * of crashing the whole tree, which matters while .env.local is still blank.
 */
export function isChainConfigured(): boolean {
  try {
    getPrivyAppId();
    getUsdcAddress();
    getVaultAddress();
    return true;
  } catch {
    return false;
  }
}

export function getPublicRpcUrl(): string {
  return process.env.NEXT_PUBLIC_RPC_URL?.trim() || "https://rpc-amoy.polygon.technology";
}

// ============================================================
// Server-only below this line.
//
// None of these are NEXT_PUBLIC_, so they read as undefined in the browser
// bundle and the functions throw there. That is the intended failure: a
// client component that imports one of these is a bug, and it should be a
// loud one rather than a silent undefined.
// ============================================================

export function getServerRpcUrl(): string {
  return process.env.RPC_URL?.trim() || getPublicRpcUrl();
}

/**
 * The vault signer. This key can move every dollar the platform custodies, so
 * it is read as late as possible and never logged, never returned in a
 * response, never embedded in an error message. In production it belongs in
 * `wrangler secret put VAULT_PRIVATE_KEY`, not in any file.
 */
export function getVaultPrivateKey(): `0x${string}` {
  const raw = requireEnv("VAULT_PRIVATE_KEY", process.env.VAULT_PRIVATE_KEY);
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    // Deliberately does not echo the value.
    throw new Error("VAULT_PRIVATE_KEY is not a valid 0x-prefixed 32-byte hex key");
  }
  return raw as `0x${string}`;
}

/**
 * Supabase user ids permitted to force-settle a market. Empty (the default)
 * disables the admin settle route entirely -- fail closed, so a deploy that
 * forgets to set this cannot be settled by just anyone.
 */
export function getAdminUserIds(): string[] {
  return (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
}

export function isAdmin(userId: string): boolean {
  const admins = getAdminUserIds();
  return admins.length > 0 && admins.includes(userId);
}

/**
 * How many confirmations a deposit needs before it is credited. Amoy reorgs
 * are shallow but not impossible, and crediting at zero confirmations means a
 * reorged-away deposit becomes a real, withdrawable balance.
 */
export function getMinDepositConfirmations(): bigint {
  const raw = process.env.MIN_DEPOSIT_CONFIRMATIONS?.trim();
  const parsed = raw ? Number(raw) : 3;
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`MIN_DEPOSIT_CONFIRMATIONS is not a valid count: ${raw}`);
  }
  return BigInt(parsed);
}
