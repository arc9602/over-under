/**
 * The only place allowed to convert between USDC representations.
 *
 * Three representations exist in this system and they must never be confused:
 *
 *   bigint  -- base units, what the ERC-20 contract actually moves. USDC has
 *              6 decimals, so 1 USDC is 1_000_000n.
 *   string  -- decimal string, what Postgres NUMERIC(20,6) reads and writes.
 *              Supabase returns NUMERIC as a string precisely so it doesn't
 *              lose precision through JSON, and we keep it that way.
 *   number  -- display ONLY. Never persisted, never sent to a contract,
 *              never used in arithmetic that decides a balance.
 *
 * Why `number` is quarantined: JS numbers are IEEE-754 doubles. 0.1 + 0.2 is
 * 0.30000000000000004, and Number.MAX_SAFE_INTEGER is 9_007_199_254_740_991 --
 * which is only ~9 billion USDC in base units, but the failure isn't the
 * ceiling, it's that intermediate rounding silently produces amounts that are
 * off by a fraction of a cent. Do that inside a ledger and the reconciliation
 * queries in 014 start reporting drift that no one can trace.
 *
 * Every function here is pure and env-independent, so it is safe to import
 * from client components, route handlers, and tests alike.
 */

/**
 * USDC's on-chain decimals. Deliberately a hardcoded constant rather than
 * read from NEXT_PUBLIC_USDC_DECIMALS at call time: a wrong value here
 * misprices every amount in the system by a factor of 10^n, and that is not
 * something an env var typo should be able to do. The env var exists to be
 * asserted against the deployed contract at startup, not to be trusted --
 * see assertTokenDecimals below.
 */
export const USDC_DECIMALS = 6;

const SCALE = 10n ** BigInt(USDC_DECIMALS);

/** Matches an unsigned decimal with at most 6 fractional digits. */
const DECIMAL_RE = /^\d+(\.\d{1,6})?$/;

export class AmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmountError";
  }
}

/**
 * Decimal string -> base units.
 *
 * Hand-rolled rather than `Number(s) * 1e6`, which is wrong for values like
 * "0.07" (0.07 * 1e6 === 70000.00000000001, and Math.round hides the bug
 * until an amount lands exactly on a .5 boundary). Splitting on the decimal
 * point and reassembling as BigInt is exact for every input by construction.
 *
 * Rejects rather than truncates anything finer than 6 decimals: silently
 * dropping a user's dust is a decision, and it should be made explicitly by
 * the caller, not implicitly here.
 */
export function parseUsdc(value: string): bigint {
  const trimmed = value.trim();
  if (!DECIMAL_RE.test(trimmed)) {
    throw new AmountError(
      `Not a valid USDC amount: ${JSON.stringify(value)} (expected an unsigned decimal with at most ${USDC_DECIMALS} places)`
    );
  }
  const [whole, fraction = ""] = trimmed.split(".");
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(USDC_DECIMALS, "0"));
}

/**
 * Base units -> decimal string, always with exactly 6 fractional digits so
 * the output is a stable NUMERIC(20,6) literal.
 */
export function formatUsdc(units: bigint): string {
  if (units < 0n) {
    throw new AmountError(`USDC amounts cannot be negative: ${units}`);
  }
  const whole = units / SCALE;
  const fraction = units % SCALE;
  return `${whole}.${fraction.toString().padStart(USDC_DECIMALS, "0")}`;
}

/**
 * Base units -> human display, e.g. 1234500000n -> "1,234.50".
 * Display only. Never feed the result back into parseUsdc.
 */
export function displayUsdc(units: bigint, fractionDigits = 2): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const whole = abs / SCALE;
  const fraction = abs % SCALE;

  // Round the fraction to the requested precision without going through a
  // float: shift, add half, truncate.
  const divisor = 10n ** BigInt(USDC_DECIMALS - fractionDigits);
  let rounded = (fraction + divisor / 2n) / divisor;
  let carriedWhole = whole;
  if (rounded >= 10n ** BigInt(fractionDigits)) {
    // e.g. 0.999999 at 2dp rounds up to 1.00, not 0.100.
    rounded = 0n;
    carriedWhole += 1n;
  }

  const grouped = carriedWhole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const suffix = fractionDigits > 0 ? `.${rounded.toString().padStart(fractionDigits, "0")}` : "";
  return `${negative ? "-" : ""}${grouped}${suffix}`;
}

/**
 * A NUMERIC column as Supabase hands it back. supabase-js types NUMERIC as
 * `number` in generated types, but the wire value is a JSON string -- so the
 * runtime value can be either depending on how it was selected. Normalizing
 * here means callers never have to care, and never accidentally do float math
 * on a value that arrived as a number.
 */
export function parseUsdcColumn(value: string | number | null | undefined): bigint {
  if (value === null || value === undefined) return 0n;
  if (typeof value === "number") {
    // Reached only if a caller selected the column in a way that coerced it.
    // Number -> string via toFixed is exact for the magnitudes involved here,
    // but it is a code smell worth surfacing rather than silently accepting.
    if (!Number.isFinite(value)) {
      throw new AmountError(`Non-finite USDC column value: ${value}`);
    }
    return parseUsdc(value.toFixed(USDC_DECIMALS));
  }
  return parseUsdc(value);
}

/**
 * Max loss for a market order, in base units -- the amount that must be
 * escrowed when the order is placed.
 *
 * A binary contract settles at 100c. Buying YES at price p risks exactly p
 * per contract (that is what you paid, and it is all you can lose); buying NO
 * at the implied price (100 - p) risks (100 - p). So:
 *
 *   yes @ p x q  ->  p * q cents
 *   no  @ p x q  ->  (100 - p) * q cents
 *
 * where p is the YES price in whole cents.
 *
 * CAREFUL: p is the YES price, which is NOT the same as
 * market_orders.limit_price. That column stores the price in the ORDER'S OWN
 * side terms -- 008's matcher derives a resting NO order's yes_price as
 * (100 - limit_price), and previewFill does the same. Passing a NO order's
 * own-side limit straight in therefore escrows (100-p)*q when the actual risk
 * is p*q: a NO @ 38c for 10 would lock $6.20 against $3.80 of exposure.
 * Callers must convert first:
 *
 *   const yesPrice = side === "yes" ? limitPrice : 100 - limitPrice;
 *
 * market_fills.yes_price IS already a genuine YES price and needs no
 * conversion.
 *
 * Computed entirely in integers: cents -> base units is an exact scale by
 * 10^(6-2) = 10_000, so no rounding occurs at any step.
 */
export function maxLossUnits(side: "yes" | "no", limitPriceCents: number, quantity: number): bigint {
  if (!Number.isInteger(limitPriceCents) || limitPriceCents < 1 || limitPriceCents > 99) {
    throw new AmountError(`Limit price must be a whole number of cents in 1..99, got ${limitPriceCents}`);
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new AmountError(`Quantity must be a positive integer, got ${quantity}`);
  }
  const riskCents = side === "yes" ? limitPriceCents : 100 - limitPriceCents;
  return BigInt(riskCents) * BigInt(quantity) * (SCALE / 100n);
}

/**
 * Payout for a winning position: contracts settle at 100c each.
 */
export function settlementPayoutUnits(quantity: number): bigint {
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new AmountError(`Quantity must be a positive integer, got ${quantity}`);
  }
  return BigInt(quantity) * SCALE;
}

/**
 * Guard for the deployed token actually having the decimals we assume. Call
 * once at startup or in a health check -- if a mock ERC-20 with 18 decimals
 * is configured, every amount in the app is off by 10^12 and this is the
 * cheapest possible place to find that out.
 */
export function assertTokenDecimals(onChainDecimals: number): void {
  if (onChainDecimals !== USDC_DECIMALS) {
    throw new AmountError(
      `Configured token reports ${onChainDecimals} decimals but this app assumes ${USDC_DECIMALS}. ` +
        `Point NEXT_PUBLIC_USDC_CONTRACT_ADDRESS at a 6-decimal USDC contract.`
    );
  }
}
