import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCheckoutIdentity,
  assertCurrentBranchHead,
  assertDistIdentity,
  assertFastForwardPromotion,
  assertLiveIdentity,
  versionIdentitySha,
} from "../../scripts/verify-staging-promotion.mjs";

const OLD = "a".repeat(40);
const CURRENT = "b".repeat(40);

test("checkout seal refuses a mutable-ref checkout that differs from the dispatch SHA", () => {
  assert.equal(assertCheckoutIdentity(CURRENT, CURRENT), CURRENT);
  assert.throws(() => assertCheckoutIdentity(OLD, CURRENT), /checkout HEAD is/u);
});

test("bundle identity must be the exact checked-out source", () => {
  assert.equal(assertDistIdentity(CURRENT, { identity: { sha: CURRENT } }), CURRENT);
  assert.throws(() => assertDistIdentity(CURRENT, { identity: { sha: OLD } }), /dist\/version\.json reports/u);
  assert.throws(() => versionIdentitySha({ identity: { sha: "b8d35fe" } }), /full lowercase Git SHA/u);
});

test("queued and rerun promotions cannot roll back a branch that advanced", () => {
  assert.equal(assertCurrentBranchHead(CURRENT, CURRENT), CURRENT);
  assert.throws(() => assertCurrentBranchHead(OLD, CURRENT), /refusing stale promotion/u);
});

test("a promotion must be a fast-forward of the currently served staging source", () => {
  assert.equal(assertFastForwardPromotion(OLD, CURRENT, true), CURRENT);
  assert.throws(() => assertFastForwardPromotion(CURRENT, OLD, false), /refusing non-fast-forward/u);
});

test("post-deploy attestation requires Pages and Worker to serve one exact SHA", () => {
  const page = { identity: { sha: CURRENT } };
  const worker = { ok: true, identityConfigured: true, sourceSha: CURRENT };
  assert.equal(assertLiveIdentity(CURRENT, page, worker), CURRENT);
  assert.throws(() => assertLiveIdentity(CURRENT, { identity: { sha: OLD } }, worker), /staging identity split/u);
  assert.throws(() => assertLiveIdentity(CURRENT, page, { ...worker, sourceSha: OLD }), /staging identity split/u);
  assert.throws(() => assertLiveIdentity(CURRENT, page, { ...worker, identityConfigured: false }), /did not attest/u);
});
