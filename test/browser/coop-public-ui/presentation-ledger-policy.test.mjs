/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isAcceptedRendererPresentationReceipt,
  latestMoveAnimationsAttestation,
} from "./presentation-ledger-policy.mjs";

const receipt = (stage, reason) => ({ role: "guest", stage, ...(reason == null ? {} : { reason }) });

test("animation-on presentation proof accepts only completed renderer receipts", () => {
  assert.equal(isAcceptedRendererPresentationReceipt(receipt("renderer-completed"), false), true);
  assert.equal(isAcceptedRendererPresentationReceipt(receipt("renderer-skipped", "animations-disabled"), false), false);
  assert.equal(isAcceptedRendererPresentationReceipt(receipt("renderer-failed", "watchdog-expired"), false), false);
});

test("attested animation-off proof accepts only the typed intentional skip", () => {
  assert.equal(isAcceptedRendererPresentationReceipt(receipt("renderer-completed"), true), true);
  assert.equal(isAcceptedRendererPresentationReceipt(receipt("renderer-skipped", "animations-disabled"), true), true);
  assert.equal(isAcceptedRendererPresentationReceipt(receipt("renderer-skipped", "unknown"), true), false);
  assert.equal(isAcceptedRendererPresentationReceipt(receipt("renderer-failed", "animations-disabled"), true), false);
  assert.equal(isAcceptedRendererPresentationReceipt({ role: "host", stage: "renderer-completed" }, true), false);
});

test("the latest real-browser render-profile attestation owns skip policy", () => {
  assert.equal(latestMoveAnimationsAttestation([]), null);
  assert.equal(
    latestMoveAnimationsAttestation([
      { kind: "browser-render-profile", observation: { moveAnimations: false } },
      { kind: "browser-render-profile", observation: { moveAnimations: true } },
    ]),
    true,
  );
  assert.equal(
    latestMoveAnimationsAttestation([
      { kind: "browser-render-profile", observation: { moveAnimations: true } },
      { kind: "unrelated", observation: { moveAnimations: false } },
      { kind: "browser-render-profile", observation: { moveAnimations: false } },
    ]),
    false,
  );
});
