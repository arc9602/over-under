import "server-only";

import type { z } from "zod";
import type { PostgrestError } from "@supabase/supabase-js";

import { ApiError } from "./session";
import { firstIssue } from "@/lib/validation/common";

/**
 * Request/response plumbing shared by the /api/wallet routes, kept out of
 * session.ts so that file stays about identity.
 */

/**
 * Parses and validates a JSON body, turning both failure modes into an
 * ApiError the route's single `catch (e) { return apiError(e) }` can handle.
 *
 * Note `request.json()` is fallible on its own: a malformed body throws a
 * SyntaxError, which without this would fall through to apiError's unknown
 * branch and be reported as a 500. It is a 400.
 */
export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S
): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new ApiError(400, "Expected a JSON body");
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError(400, firstIssue(parsed.error));
  }
  return parsed.data;
}

/** Postgres unique_violation. */
export const PG_UNIQUE_VIOLATION = "23505";
/** Postgres check_violation -- what move_usdc raises for an overdraft. */
export const PG_CHECK_VIOLATION = "23514";

export function isUniqueViolation(error: PostgrestError | null | undefined): boolean {
  return error?.code === PG_UNIQUE_VIOLATION;
}

/**
 * Maps a raw Postgres error from one of the 014 money functions onto a client
 * message.
 *
 * The matched strings are the RAISE EXCEPTION texts in
 * supabase/migrations/014_usdc_custody.sql, which were written to be read by a
 * person. Everything unmatched is deliberately dropped and becomes a flat 500
 * upstream: an unrecognized Postgres message can name tables, columns and
 * constraint internals, and none of that belongs in a response body.
 */
export function translateMoneyError(error: PostgrestError): ApiError | null {
  const message = `${error.message ?? ""} ${error.details ?? ""}`;

  if (/No verified wallet linked/i.test(message)) {
    return new ApiError(400, "Link a wallet before moving funds");
  }
  if (/withdrawal in progress/i.test(message)) {
    return new ApiError(409, "You already have a withdrawal in progress");
  }
  if (error.code === PG_CHECK_VIOLATION || /Insufficient .* balance/i.test(message)) {
    return new ApiError(400, "Insufficient available balance");
  }
  if (/No USDC account for user/i.test(message)) {
    return new ApiError(400, "This account has no USDC balance yet");
  }
  return null;
}
