/**
 * Unit tests for the USDC amount codec and the settlement arithmetic.
 *
 *   node --test tests/
 *
 * No test framework and no new dependencies: node:test is built in, and Node
 * 24 strips TypeScript types natively. Imports use explicit .ts extensions
 * because that native stripping does not resolve extensionless specifiers, and
 * relative paths because it does not read tsconfig's "@/*" alias either.
 *
 * These cover the money math that settlement depends on. The concurrency
 * guarantees -- double-spend under simultaneous bets, deposit-hash replay --
 * are properties of Postgres row locks and unique constraints, not of this
 * code, so they live in tests/concurrency.sql where they can actually be
 * exercised against a real database.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseUsdc,
  formatUsdc,
  displayUsdc,
  parseUsdcColumn,
  maxLossUnits,
  settlementPayoutUnits,
  assertTokenDecimals,
  AmountError,
  USDC_DECIMALS,
} from "../lib/chain/amount.ts";

describe("parseUsdc", () => {
  test("parses whole and fractional amounts exactly", () => {
    assert.equal(parseUsdc("0"), 0n);
    assert.equal(parseUsdc("1"), 1_000_000n);
    assert.equal(parseUsdc("1.5"), 1_500_000n);
    assert.equal(parseUsdc("0.000001"), 1n);
    assert.equal(parseUsdc("1234.567891"), 1_234_567_891n);
  });

  test("is exact for values that float math gets wrong", () => {
    // The whole reason this codec exists. These specific amounts do not
    // survive `Number(s) * 1e6`: 2.01 lands on 2009999.9999999998 and 4.03 on
    // 4030000.0000000005. Truncating those gives an off-by-one in base units,
    // and the error accumulates silently across a ledger.
    assert.equal(parseUsdc("2.01"), 2_010_000n);
    assert.equal(parseUsdc("2.09"), 2_090_000n);
    assert.equal(parseUsdc("4.02"), 4_020_000n);
    assert.equal(parseUsdc("4.03"), 4_030_000n);

    // Pin the bug being avoided, so this fails loudly if anyone ever
    // "simplifies" parseUsdc back to float multiplication.
    assert.notEqual(Number("2.01") * 1e6, 2_010_000);
    assert.notEqual(Number("4.03") * 1e6, 4_030_000);
    assert.equal(Math.trunc(Number("2.01") * 1e6), 2_009_999); // the off-by-one
  });

  test("tolerates surrounding whitespace", () => {
    assert.equal(parseUsdc("  2.50  "), 2_500_000n);
  });

  test("rejects more precision than the chain can represent", () => {
    // Rejected rather than truncated: silently dropping a user's dust is a
    // decision the caller should make explicitly.
    assert.throws(() => parseUsdc("1.0000001"), AmountError);
  });

  test("rejects negatives, blanks, and garbage", () => {
    for (const bad of ["-1", "", "  ", "abc", "1.2.3", "1e6", "+1", "0x1", "NaN", "Infinity"]) {
      assert.throws(() => parseUsdc(bad), AmountError, `expected ${JSON.stringify(bad)} to be rejected`);
    }
  });
});

describe("formatUsdc", () => {
  test("always emits exactly 6 decimal places", () => {
    assert.equal(formatUsdc(0n), "0.000000");
    assert.equal(formatUsdc(1n), "0.000001");
    assert.equal(formatUsdc(1_000_000n), "1.000000");
    assert.equal(formatUsdc(1_234_567_891n), "1234.567891");
  });

  test("round-trips with parseUsdc for arbitrary values", () => {
    const values = [0n, 1n, 999_999n, 1_000_000n, 70_000n, 123_456_789_012n];
    for (const v of values) {
      assert.equal(parseUsdc(formatUsdc(v)), v);
    }
  });

  test("refuses negative amounts", () => {
    assert.throws(() => formatUsdc(-1n), AmountError);
  });
});

describe("displayUsdc", () => {
  test("groups thousands and rounds to 2dp", () => {
    assert.equal(displayUsdc(1_234_500_000n), "1,234.50");
    assert.equal(displayUsdc(0n), "0.00");
    assert.equal(displayUsdc(1_000_000n), "1.00");
    assert.equal(displayUsdc(1_234_567_890_123n), "1,234,567.89");
  });

  test("rounds half up without a float round-trip", () => {
    assert.equal(displayUsdc(1_005_000n), "1.01");
    assert.equal(displayUsdc(1_004_999n), "1.00");
  });

  test("carries into the whole part instead of producing 0.100", () => {
    // 0.999999 at 2dp must become 1.00, not 0.100 -- the carry case that a
    // naive pad/truncate gets wrong.
    assert.equal(displayUsdc(999_999n), "1.00");
    assert.equal(displayUsdc(1_999_999n), "2.00");
  });

  test("handles a zero-decimal request", () => {
    assert.equal(displayUsdc(1_500_000n, 0), "2");
    assert.equal(displayUsdc(1_400_000n, 0), "1");
  });
});

describe("parseUsdcColumn", () => {
  test("accepts the string form Postgres NUMERIC actually returns", () => {
    assert.equal(parseUsdcColumn("12.500000"), 12_500_000n);
  });

  test("treats null and undefined as zero", () => {
    assert.equal(parseUsdcColumn(null), 0n);
    assert.equal(parseUsdcColumn(undefined), 0n);
  });

  test("rejects non-finite numbers rather than coercing them", () => {
    assert.throws(() => parseUsdcColumn(Number.NaN), AmountError);
    assert.throws(() => parseUsdcColumn(Number.POSITIVE_INFINITY), AmountError);
  });
});

describe("maxLossUnits", () => {
  test("YES risks the price paid, NO risks the complement", () => {
    // p is the YES price. A NO order's own-side limit must be converted by
    // the caller before it gets here -- see the doc comment on maxLossUnits.
    assert.equal(maxLossUnits("yes", 62, 10), 6_200_000n);
    assert.equal(maxLossUnits("no", 62, 10), 3_800_000n);
  });

  test("the two sides of a contract always sum to 100c", () => {
    for (let price = 1; price <= 99; price++) {
      const yes = maxLossUnits("yes", price, 1);
      const no = maxLossUnits("no", price, 1);
      assert.equal(yes + no, settlementPayoutUnits(1), `price ${price} does not sum to 100c`);
    }
  });

  test("scales linearly with quantity", () => {
    assert.equal(maxLossUnits("yes", 33, 100), maxLossUnits("yes", 33, 1) * 100n);
  });

  test("rejects prices outside the tradeable 1..99 band", () => {
    for (const price of [0, 100, -1, 50.5, Number.NaN]) {
      assert.throws(() => maxLossUnits("yes", price, 1), AmountError, `price ${price} should be rejected`);
    }
  });

  test("rejects non-positive or fractional quantities", () => {
    for (const qty of [0, -1, 1.5]) {
      assert.throws(() => maxLossUnits("yes", 50, qty), AmountError, `qty ${qty} should be rejected`);
    }
  });
});

describe("settlement conservation", () => {
  /**
   * The invariant the settle route asserts per fill before it moves any money:
   * the winner's escrowed stake plus the loser's escrowed stake is exactly the
   * contract's settlement value. If this ever fails, settlement is either
   * minting money or destroying it.
   */
  test("winner stake + loser stake === payout, for every price and quantity", () => {
    for (let price = 1; price <= 99; price++) {
      for (const qty of [1, 3, 10, 97, 1000]) {
        const yesStake = maxLossUnits("yes", price, qty);
        const noStake = maxLossUnits("no", price, qty);
        const payout = settlementPayoutUnits(qty);

        assert.equal(
          yesStake + noStake,
          payout,
          `conservation broken at price=${price} qty=${qty}`
        );
      }
    }
  });

  test("worked example: NO rests at 38c, YES crosses, resolves YES", () => {
    // Bob rests NO @ 38c x10 -> escrows 3.80. Alice takes it; the resting
    // order transacts at its own limit so the fill's yes_price is 62.
    const quantity = 10;
    const fillYesPrice = 62;

    const aliceStake = maxLossUnits("yes", fillYesPrice, quantity); // 6.20
    const bobStake = maxLossUnits("no", fillYesPrice, quantity); //    3.80

    assert.equal(formatUsdc(aliceStake), "6.200000");
    assert.equal(formatUsdc(bobStake), "3.800000");

    // YES wins: Alice collects both stakes, which is exactly 100c x 10.
    assert.equal(formatUsdc(aliceStake + bobStake), "10.000000");
    assert.equal(aliceStake + bobStake, settlementPayoutUnits(quantity));
  });

  test("no rounding drift across many odd-priced fills", () => {
    // Every fill conserves individually, so a book of them conserves in
    // aggregate. Odd prices and odd quantities are where a cents->base-units
    // conversion would drift if it went through a float.
    let escrowed = 0n;
    let paid = 0n;

    for (let i = 0; i < 500; i++) {
      const price = (i % 99) + 1;
      const qty = (i % 17) + 1;
      escrowed += maxLossUnits("yes", price, qty) + maxLossUnits("no", price, qty);
      paid += settlementPayoutUnits(qty);
    }

    assert.equal(escrowed, paid);
  });
});

describe("assertTokenDecimals", () => {
  test("accepts a 6-decimal token", () => {
    assert.doesNotThrow(() => assertTokenDecimals(USDC_DECIMALS));
  });

  test("rejects an 18-decimal mock, which would misprice everything by 10^12", () => {
    assert.throws(() => assertTokenDecimals(18), AmountError);
  });
});
