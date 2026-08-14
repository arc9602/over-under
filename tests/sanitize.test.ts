/**
 * Unit tests for the human-text sanitizers.
 *
 *   node --test tests/
 *
 * Same conventions as amount.test.ts: node:test, no new dependencies,
 * explicit .ts extensions and relative paths because Node's native type
 * stripping resolves neither extensionless specifiers nor tsconfig's "@/*".
 *
 * Every character under test is built with String.fromCharCode rather than
 * pasted in literally. All of them are invisible or direction-altering, so a
 * literal form is unreviewable in a diff, can silently change under an
 * editor's normalization, and makes the whole file read as binary to grep.
 * Keeping the source pure ASCII means the code point being tested is stated
 * in the one place a reader can actually check it.
 *
 * What these defend is not XSS: React escapes every string it renders and
 * nothing here builds HTML by hand. It is impersonation. A display name
 * carrying U+202E renders as a different name than it stores, and one padded
 * with zero-width characters can look identical to somebody else's while
 * comparing as a distinct string.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { sanitizeLine, sanitizeBlock, lineText, blockText } from "../lib/validation/common.ts";

const ch = (code: number) => String.fromCharCode(code);

const RLO = ch(0x202e); // right-to-left override
const LRE = ch(0x202a); // left-to-right embedding
const PDF = ch(0x202c); // pop directional formatting
const LRI = ch(0x2066); // left-to-right isolate
const PDI = ch(0x2069); // pop directional isolate
const ZWSP = ch(0x200b); // zero-width space
const ZWNJ = ch(0x200c); // zero-width non-joiner
const ZWJ = ch(0x200d); // zero-width joiner
const BOM = ch(0xfeff); // zero-width no-break space
const NUL = ch(0x0000); // null, a C0 control
const BEL = ch(0x0007); // bell, a C0 control
const NEL = ch(0x0085); // next line, a C1 control

describe("sanitizeLine", () => {
  test("strips a right-to-left override", () => {
    // The classic spoof: everything after the RLO renders in reverse.
    assert.equal(sanitizeLine(`alice${RLO}bob`), "alicebob");
  });

  test("strips bidi isolates and embeddings", () => {
    assert.equal(sanitizeLine(`${LRI}a${PDI}b`), "ab");
    assert.equal(sanitizeLine(`${LRE}a${PDF}b`), "ab");
  });

  test("strips zero-width characters that let two names render identically", () => {
    assert.equal(sanitizeLine(`ali${ZWSP}ce`), "alice");
    assert.equal(sanitizeLine(`ali${ZWNJ}ce`), "alice");
    assert.equal(sanitizeLine(`ali${ZWJ}ce`), "alice");
    assert.equal(sanitizeLine(`${BOM}alice`), "alice");
  });

  test("strips C0 and C1 control characters", () => {
    assert.equal(sanitizeLine(`a${NUL}b${BEL}c`), "abc");
    assert.equal(sanitizeLine(`a${NEL}bc`), "abc");
  });

  test("collapses newlines and tabs, since these fields render on one line", () => {
    assert.equal(sanitizeLine("Leafs\nmiss\tplayoffs"), "Leafs miss playoffs");
  });

  test("collapses runs of whitespace and trims", () => {
    assert.equal(sanitizeLine("  Leafs    miss   playoffs  "), "Leafs miss playoffs");
  });

  test("leaves legitimate non-ASCII text alone", () => {
    // The point is removing characters that deceive, not forcing ASCII. Real
    // names are not ASCII and have to survive intact.
    const li = ch(0x674e) + ch(0x660e); // a common Chinese name
    assert.equal(sanitizeLine(li), li);

    const jose = `Jos${ch(0x00e9)} ${ch(0x00c1)}lvarez`;
    assert.equal(sanitizeLine(jose), jose);
  });

  test("leaves markup-looking text intact rather than escaping it", () => {
    // React escapes on render. Escaping here as well would double-escape and
    // corrupt a legitimate title.
    assert.equal(sanitizeLine("Will AT&T stay < $20?"), "Will AT&T stay < $20?");
    assert.equal(sanitizeLine("<b>bold</b> & 'quoted'"), "<b>bold</b> & 'quoted'");
  });
});

describe("sanitizeBlock", () => {
  test("keeps newlines, because a paragraph break in a description is intentional", () => {
    assert.equal(sanitizeBlock("first line\nsecond line"), "first line\nsecond line");
  });

  test("collapses runs of blank lines that would push content off a card", () => {
    assert.equal(sanitizeBlock("top\n\n\n\n\nbottom"), "top\n\nbottom");
  });

  test("strips per-line trailing whitespace and trims the block", () => {
    assert.equal(sanitizeBlock("top   \nbottom  "), "top\nbottom");
  });

  test("still strips the deceptive characters", () => {
    assert.equal(sanitizeBlock(`alice${RLO}bob\nali${ZWSP}ce`), "alicebob\nalice");
  });
});

describe("lineText schema", () => {
  test("sanitizes before checking length, so invisible padding cannot satisfy a minimum", () => {
    // This ordering is the whole point. Checking length first would let each
    // of these through and store an empty display name -- exactly the
    // impersonation case the sanitizer exists to close.
    assert.equal(lineText(1, 50).safeParse("   ").success, false);
    assert.equal(lineText(1, 50).safeParse(ZWSP.repeat(3)).success, false);
    assert.equal(lineText(1, 50).safeParse(RLO).success, false);
  });

  test("length is measured on the sanitized value, not the raw input", () => {
    // 50 real characters plus stripped padding still fits a max of 50.
    const result = lineText(1, 50).safeParse("a".repeat(50) + ZWSP.repeat(20));
    assert.equal(result.success, true);
    assert.equal(result.data, "a".repeat(50));
  });

  test("returns the cleaned value, not the original", () => {
    const result = lineText(3, 200).safeParse(`  Leafs${RLO}   miss playoffs  `);
    assert.equal(result.success, true);
    assert.equal(result.data, "Leafs miss playoffs");
  });

  test("rejects genuinely over-length input", () => {
    assert.equal(lineText(3, 200).safeParse("a".repeat(201)).success, false);
  });

  test("rejects non-strings, since a server action argument can be any JSON value", () => {
    assert.equal(lineText(1, 50).safeParse(null).success, false);
    assert.equal(lineText(1, 50).safeParse(42).success, false);
    assert.equal(lineText(1, 50).safeParse({}).success, false);
  });
});

describe("blockText schema", () => {
  test("accepts an empty description", () => {
    // Unlike lineText there is no minimum -- description is optional content.
    assert.equal(blockText(500).safeParse("").success, true);
  });

  test("measures length after sanitizing", () => {
    const result = blockText(10).safeParse("hello" + ZWSP.repeat(5));
    assert.equal(result.success, true);
    assert.equal(result.data, "hello");
  });
});
