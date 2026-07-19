/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadCampaignPolicy } from "./campaign-policy.mjs";
import { EvidenceSink } from "./evidence.mjs";

function withRenderProfile(value, callback) {
  const previous = process.env.COOP_UI_RENDER_PROFILE;
  try {
    if (value == null) {
      delete process.env.COOP_UI_RENDER_PROFILE;
    } else {
      process.env.COOP_UI_RENDER_PROFILE = value;
    }
    callback();
  } finally {
    if (previous == null) {
      delete process.env.COOP_UI_RENDER_PROFILE;
    } else {
      process.env.COOP_UI_RENDER_PROFILE = previous;
    }
  }
}

function attachConsoleOnly(sink) {
  const handlers = new Map();
  sink.record = (kind, detail = {}) => {
    const event = { index: sink.events.length, kind, ...detail };
    sink.events.push(event);
    return event;
  };
  sink.attach({ on: (name, handler) => handlers.set(name, handler) });
  return text =>
    handlers.get("console")({
      text: () => text,
      type: () => "info",
      location: () => ({ url: "http://127.0.0.1:4175/" }),
    });
}

test("render profiles are explicit and the depth profile retains public Settings keys", () => {
  withRenderProfile(undefined, () => {
    const policy = loadCampaignPolicy();
    assert.equal(policy.renderProfile, "animations-on-surface");
    assert.equal(policy.moveAnimationsExpected, true);
  });

  withRenderProfile("animations-skipped-depth", () => {
    const policy = loadCampaignPolicy();
    assert.equal(policy.moveAnimationsExpected, false);
    assert.deepEqual(policy.keys.renderProfileToggle, ["ArrowRight"]);
    assert.deepEqual(policy.keys.renderProfileOpen.slice(-6), ["r", ...new Array(5).fill("ArrowDown")]);
  });

  withRenderProfile("unlabelled-fast-mode", () => {
    assert.throws(() => loadCampaignPolicy(), /COOP_UI_RENDER_PROFILE/u);
  });
});

test("browser render-profile markers are validated and indexed as evidence", () => {
  const sink = new EvidenceSink("profile", ".");
  const emitConsole = attachConsoleOnly(sink);

  emitConsole(
    '[coop-browser:render-profile] {"version":1,"moveAnimations":false,"gameSpeed":10,"handler":"SettingsDisplayUiHandler"}',
  );
  assert.equal(sink.findRenderProfile(false)?.observation.moveAnimations, false);
  assert.equal(sink.findGameSpeed(10)?.observation.gameSpeed, 10);
  assert.equal(sink.findRenderProfile(true), undefined);

  const generalCursor = sink.cursor();
  emitConsole(
    '[coop-browser:render-profile] {"version":1,"moveAnimations":true,"gameSpeed":10,"handler":"SettingsUiHandler"}',
  );
  assert.equal(sink.findGameSpeed(10, generalCursor)?.observation.handler, "SettingsUiHandler");
  assert.equal(sink.findRenderProfile(true, generalCursor), undefined);

  emitConsole('[coop-browser:render-profile] {"version":1,"moveAnimations":"false","gameSpeed":10}');
  assert.equal(sink.failures.at(-1)?.kind, "browser-surface-invalid");
});

test("the animations-on turn budget is a per-event-derived ceiling scoped to the animations-on profile only", async () => {
  const campaign = await readFile(new URL("campaign.mjs", import.meta.url), "utf8");
  // Track R cycle 13: the animations-on-surface lane spent ~440s on a dense 24-event turn (~18s/event)
  // on the GPU-less SwiftShader runner while sync stayed byte-correct, so the 360s default ceiling
  // expired a CORRECT turn. The calibrated ceiling is DERIVED from the measured per-event cost times a
  // bounded max turn-event count - it is not a hand-picked round number, and it must not touch any other
  // profile's budget.
  assert.match(campaign, /const ANIMATIONS_ON_MEASURED_PER_EVENT_MS = 18_000;/u);
  assert.match(campaign, /const ANIMATIONS_ON_MAX_TURN_EVENTS = 32;/u);
  assert.match(
    campaign,
    /const ANIMATIONS_ON_OUTCOME_HARD_CEILING_MS =\s*ANIMATIONS_ON_MEASURED_PER_EVENT_MS \* ANIMATIONS_ON_MAX_TURN_EVENTS;/u,
  );
  // The default OUTCOME_HARD_CEILING_MS is UNCHANGED - every non-animations profile keeps it.
  assert.match(campaign, /const OUTCOME_HARD_CEILING_MS = 360_000;/u);
  // The calibrated ceiling is passed ONLY when the profile expects animations (policy.moveAnimationsExpected);
  // otherwise null flows through to the default. Asserted at BOTH turn-outcome waits.
  const gated =
    /animationHardCeilingMs: policy\.moveAnimationsExpected \? ANIMATIONS_ON_OUTCOME_HARD_CEILING_MS : null,/gu;
  assert.equal((campaign.match(gated) ?? []).length, 2, "both turn-outcome waits gate the ceiling on the profile");
  // waitForOutcomeBounded threads the override into createAnimationProgressBudget only when non-null, so a
  // null (any other profile) leaves the default OUTCOME_HARD_CEILING_MS in force.
  assert.match(campaign, /animationHardCeilingMs == null \? \{\} : \{ hardCeilingMs: animationHardCeilingMs \}/u);
});
