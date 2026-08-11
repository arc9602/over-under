import { z } from "zod";

import { parseUsdc } from "@/lib/chain/amount";

/**
 * Zod primitives for the /api/wallet routes, in the same style as
 * lib/validation/common.ts: the route handlers are the runtime boundary, the
 * SQL functions in migration 014 re-validate behind them.
 *
 * Nothing here reads process.env, so this module is safe to import from a
 * client component that needs to build a link message.
 */

/** A 20-byte EVM address, normalized to lowercase on the way through.
 *
 * Lowercasing at the schema boundary is not cosmetic: `wallet_links.address`
 * has a `^0x[0-9a-f]{40}$` CHECK, and every deposit/withdrawal comparison in
 * the system is a plain `===`. Accepting EIP-55 checksum casing and comparing
 * it raw is how the "is this deposit from your wallet?" check quietly returns
 * false for the right address.
 */
export const evmAddressSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{40}$/, "Not a valid wallet address")
  .transform((value) => value.toLowerCase() as `0x${string}`);

/** A 32-byte transaction hash, lowercased to match the usdc_deposits CHECK. */
export const txHashSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]{64}$/, "Not a valid transaction hash")
  .transform((value) => value.toLowerCase() as `0x${string}`);

/**
 * A signature as hex. Length is bounded but not fixed at 65 bytes: EOA
 * signatures are 65, but ERC-1271 smart-account signatures are arbitrary
 * length, and pinning the length here would reject them before viem ever gets
 * a chance to say whether they verify.
 */
export const hexSignatureSchema = z
  .string()
  .trim()
  .regex(/^0x[0-9a-fA-F]+$/, "Not a valid signature")
  .max(4098, "Not a valid signature")
  .transform((value) => value as `0x${string}`);

/**
 * A USDC amount as a decimal string.
 *
 * String, never number: `z.coerce.number()` (what moneySchema in common.ts
 * does for the IOU ledger's display amounts) would put an IEEE-754 double in
 * front of a custodied balance. parseUsdc is the only sanctioned parser and it
 * is exact by construction.
 *
 * The upper bound keeps an absurd input from reaching NUMERIC(20,6) and coming
 * back as an opaque Postgres overflow, which would surface to the user as a
 * flat 500 instead of a validation message.
 */
/** One billion USDC in base units -- far above any plausible testnet balance. */
const MAX_USDC_UNITS = 1_000_000_000n * 1_000_000n;

export const usdcAmountSchema = z
  .string()
  .trim()
  .max(32, "Not a valid amount")
  .superRefine((value, ctx) => {
    // One superRefine rather than two chained .refine()s. Zod runs every
    // refinement in a chain even after an earlier one has already failed, so
    // a second `.refine(v => parseUsdc(v) <= max)` would call parseUsdc on
    // input the first refinement just rejected -- and parseUsdc THROWS on
    // malformed input rather than returning false. The result was that
    // {"amount":"abc"} escaped as an uncaught AmountError and surfaced to the
    // user as a flat 500 instead of a validation message. Parsing exactly
    // once, inside a try, makes that structurally impossible.
    let units: bigint;
    try {
      units = parseUsdc(value);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Enter an amount greater than 0 with at most 6 decimal places",
      });
      return;
    }
    if (units <= 0n) {
      ctx.addIssue({
        code: "custom",
        message: "Enter an amount greater than 0 with at most 6 decimal places",
      });
      return;
    }
    if (units > MAX_USDC_UNITS) {
      ctx.addIssue({ code: "custom", message: "That amount is too large" });
    }
  });

export const walletTypeSchema = z.enum(["embedded", "external"]);

// ============================================================
// The wallet-link message
// ============================================================
/**
 * A signature proves control of a private key. On its own it does NOT say what
 * the signer agreed to or who they agreed it with, so a signature captured
 * from anywhere else -- another dapp, an earlier link, a phishing page -- would
 * otherwise be replayable here.
 *
 * Three fields close that:
 *
 *   Address -- must equal the address being linked, so a signature for wallet
 *              A cannot be presented as proof for wallet B.
 *   Account -- the Supabase user id the link is for, checked against the
 *              session. This is the important one: identity comes from the
 *              session cookie, not the message, so without it an attacker who
 *              captured a victim's link signature could bind the victim's
 *              wallet to the ATTACKER's account -- and since deposit
 *              attribution is "does the Transfer log's `from` match your
 *              linked address", that hands them every deposit the victim makes.
 *   Issued   -- an expiry window, so a leaked signature stops being useful.
 *
 * Exported as a builder rather than documented as a convention because the
 * signing side and the verifying side have to agree byte for byte; two copies
 * of the same string is a bug waiting for someone to fix a typo on one side.
 */
export const WALLET_LINK_STATEMENT = "over-under: link this wallet to my account";

/** How long a link signature stays valid. */
export const WALLET_LINK_MAX_AGE_MS = 10 * 60 * 1000;

/** Tolerance for the signer's clock running ahead of the server's. */
export const WALLET_LINK_MAX_SKEW_MS = 2 * 60 * 1000;

export function buildWalletLinkMessage(input: {
  address: string;
  userId: string;
  issuedAt: Date;
  nonce: string;
}): string {
  return [
    WALLET_LINK_STATEMENT,
    "",
    `Address: ${input.address.toLowerCase()}`,
    `Account: ${input.userId}`,
    `Issued: ${input.issuedAt.toISOString()}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}

export type ParsedWalletLinkMessage = {
  address: string;
  userId: string;
  issuedAt: Date;
  nonce: string;
};

/**
 * Parses a message produced by buildWalletLinkMessage. Returns null on
 * anything that does not match exactly -- a loose parse would defeat the point
 * of signing a structured statement at all.
 */
export function parseWalletLinkMessage(message: string): ParsedWalletLinkMessage | null {
  const lines = message.split("\n");
  if (lines.length !== 6) return null;
  if (lines[0] !== WALLET_LINK_STATEMENT || lines[1] !== "") return null;

  const address = lines[2].startsWith("Address: ") ? lines[2].slice("Address: ".length) : null;
  const userId = lines[3].startsWith("Account: ") ? lines[3].slice("Account: ".length) : null;
  const issued = lines[4].startsWith("Issued: ") ? lines[4].slice("Issued: ".length) : null;
  const nonce = lines[5].startsWith("Nonce: ") ? lines[5].slice("Nonce: ".length) : null;

  if (!address || !userId || !issued || !nonce) return null;
  if (!/^0x[0-9a-f]{40}$/.test(address)) return null;

  const issuedAt = new Date(issued);
  if (Number.isNaN(issuedAt.getTime())) return null;

  return { address, userId, issuedAt, nonce };
}

// ============================================================
// Request bodies
// ============================================================

export const linkWalletSchema = z.object({
  address: evmAddressSchema,
  signature: hexSignatureSchema,
  message: z.string().min(1).max(2000),
  /** Display only -- migration 014 says so explicitly. Never trusted. */
  walletType: walletTypeSchema.optional(),
});

export const depositSchema = z.object({
  transactionHash: txHashSchema,
  amount: usdcAmountSchema,
});

export const withdrawSchema = z.object({
  amount: usdcAmountSchema,
});
