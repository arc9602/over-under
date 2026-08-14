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

/**
 * Characters that are never legitimately part of a name, title, or label a
 * person typed, and that change what a reader sees rather than what the
 * string says.
 *
 * This is not an XSS defense -- React escapes everything it renders, and
 * nothing in this app builds HTML by hand. The exposure is impersonation.
 * U+202E (RIGHT-TO-LEFT OVERRIDE) reverses the rendering of everything that
 * follows it, so a display name can be made to read as a different person's
 * entirely. Zero-width characters let two accounts render as visually
 * identical names while comparing as distinct strings. In a product where you
 * decide whether to take the other side of someone's bet based on who they
 * appear to be, a name that lies is worth something to an attacker.
 *
 * Written as escapes rather than literals on purpose: every character in this
 * class is invisible or direction-altering, so a literal form is unreviewable
 * in a diff and survives a copy-paste as something other than what it looks
 * like. \t and \n are deliberately excluded -- the two sanitizers below
 * decide what to do with them per field.
 */
const DECEPTIVE_CHARS = new RegExp(
  [
    "[\\u0000-\\u0008\\u000B-\\u001F\\u007F-\\u009F]", // C0/C1 controls
    "[\\u200B-\\u200F]", // zero-width space/joiners, LRM/RLM
    "[\\u2028\\u2029]", // line and paragraph separators
    "[\\u202A-\\u202E]", // bidi embeddings and overrides, incl. RLO
    "[\\u2066-\\u2069]", // bidi isolates
    "\\uFEFF", // zero-width no-break space / BOM
  ].join("|"),
  "g"
);

/**
 * Single-line human text: names, titles, option labels. Strips the deceptive
 * characters above, collapses any run of whitespace to one space, and trims.
 * Newlines are whitespace here by design -- these fields render on one line,
 * and a title containing a line break is a layout break, not a formatting
 * choice.
 */
export function sanitizeLine(raw: string): string {
  return raw.replace(DECEPTIVE_CHARS, "").replace(/\s+/g, " ").trim();
}

/**
 * Multi-line human text: descriptions. Same character strip, but newlines
 * survive because a paragraph break there is a real authoring decision. Runs
 * of blank lines collapse to one and per-line trailing whitespace goes, so a
 * description can't smuggle in vertical space that pushes content off a card.
 */
export function sanitizeBlock(raw: string): string {
  return raw
    .replace(DECEPTIVE_CHARS, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A single-line text field, sanitized *before* its length is checked. The
 * order matters: checking first would let 50 spaces or 50 zero-width
 * characters satisfy a `.min(1)` and then land in the database as an empty
 * name, which is exactly the impersonation case this is meant to close.
 */
export function lineText(min: number, max: number) {
  return z.string().transform(sanitizeLine).pipe(z.string().min(min).max(max));
}

/** Multi-line equivalent of `lineText`, for description fields. */
export function blockText(max: number) {
  return z.string().transform(sanitizeBlock).pipe(z.string().max(max));
}

/** Formats a Zod flatten() result into one line for the existing `{ error }` return shape. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input";
}
