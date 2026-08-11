import { z } from "zod";

/**
 * Shared Zod primitives for server actions. Every mutating action is a
 * callable HTTP endpoint regardless of its TypeScript signature -- Next.js
 * doesn't enforce those types at runtime, so a raw request can send any
 * JSON-serializable value for any argument. These schemas are the actual
 * runtime boundary; the RPCs they front also re-validate (defense in depth),
 * but the RPC's error text is meant for a developer, not a user.
 */

export const uuidSchema = z.uuid("Not a valid id");

/** invite_code is `substr(md5(random()::text), 1, 10)` -- lowercase hex, fixed length. */
export const inviteCodeSchema = z.string().min(1).max(32).regex(/^[a-z0-9]+$/, "Not a valid invite code");

/** A contract price in whole cents, 1-99 (matches CONTRACT_CENTS in marketBook.ts). */
export const priceSchema = z.coerce.number().int().min(1).max(99);

/** Contract quantity for an order. */
export const quantitySchema = z.coerce.number().int().positive().max(100000);

/** A dollar amount for a wager, deposit, or settlement. */
export const moneySchema = z.coerce.number().positive().max(100000);

export const betSideSchema = z.enum(["a", "b"]);
export const marketSideSchema = z.enum(["yes", "no"]);

/** Formats a Zod flatten() result into one line for the existing `{ error }` return shape. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}
