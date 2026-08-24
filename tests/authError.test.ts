/**
 * Unit tests for the auth-failure discriminator and its retry.
 *
 *   node --test tests/
 *
 * Same conventions as sanitize.test.ts: node:test, no new dependencies,
 * explicit .ts extensions and relative paths because Node's native type
 * stripping resolves neither extensionless specifiers nor tsconfig's "@/*".
 *
 * What these defend is the difference between "not signed in" and "could not
 * tell you". getUser() reports both as user: null, and the app answered both
 * by sending the user to a login screen -- so a cold Worker isolate, a rate
 * limit or a 5xx read as a logout to somebody holding a valid session. Getting
 * this classification wrong in either direction is a real bug: too broad and a
 * genuinely signed-out visitor walks past the gate, too narrow and the app
 * goes back to logging people out over a network blip.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  getUserRetrying,
  isAuthServiceUnavailable,
} from "../lib/supabase/authError.ts";

/** Minimal stand-in for AuthError -- only `status` is ever read. */
const err = (status: number | undefined) =>
  ({ status }) as unknown as Parameters<typeof isAuthServiceUnavailable>[0];

describe("isAuthServiceUnavailable", () => {
  test("no error is not a failure", () => {
    assert.equal(isAuthServiceUnavailable(null), false);
  });

  test("a verdict of 'not signed in' is not a service failure", () => {
    // 400 is AuthSessionMissingError, 401/403 are a rejected or expired token.
    // These are answers, and the caller must act on them.
    for (const status of [400, 401, 403, 404, 422]) {
      assert.equal(isAuthServiceUnavailable(err(status)), false, `status ${status}`);
    }
  });

  test("infrastructure failures are not verdicts", () => {
    // 0 is a failed fetch, undefined is an error raised before any response,
    // 429 is a rate limit, and 5xx/52x are auth-js's own NETWORK_ERROR_CODES.
    for (const status of [undefined, 0, 429, 500, 502, 503, 504, 520, 522, 530]) {
      assert.equal(isAuthServiceUnavailable(err(status)), true, `status ${status}`);
    }
  });
});

describe("getUserRetrying", () => {
  test("does not retry a successful call", async () => {
    let calls = 0;
    const result = await getUserRetrying(async () => {
      calls++;
      return { error: null, data: { user: { id: "u1" } } };
    });

    assert.equal(calls, 1);
    assert.equal(result.data.user.id, "u1");
  });

  test("does not retry a genuine signed-out answer", async () => {
    // The point of the single retry is cold starts. A signed-out visitor must
    // not wait through it to be told what the first call already established.
    let calls = 0;
    await getUserRetrying(async () => {
      calls++;
      return { error: err(400), data: { user: null } };
    });

    assert.equal(calls, 1);
  });

  test("retries once when the service was unreachable, and keeps the result", async () => {
    // The cold-isolate case: first call pays connection setup and times out,
    // second succeeds.
    let calls = 0;
    const result = await getUserRetrying(async () => {
      calls++;
      return calls === 1
        ? { error: err(0), data: { user: null } }
        : { error: null, data: { user: { id: "u1" } } };
    });

    assert.equal(calls, 2);
    assert.equal(result.error, null);
    assert.equal(result.data.user?.id, "u1");
  });

  test("retries exactly once, and surfaces the failure when it does not clear", async () => {
    // One retry, not a loop -- and the caller still gets the error, because
    // deciding what an outage means is the caller's job, not this helper's.
    let calls = 0;
    const result = await getUserRetrying(async () => {
      calls++;
      return { error: err(503), data: { user: null } };
    });

    assert.equal(calls, 2);
    assert.equal(result.error?.status, 503);
  });
});
