/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDispatchTable, loadCampaignPolicy } from "./campaign-policy.mjs";
import {
  EvidenceSink,
  isCapturedApiUrl,
  waitForPublicInputDispatch,
  waitForPublicInputFrameSettle,
} from "./evidence.mjs";

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
    assert.equal(
      buildDispatchTable(policy).find(driver => driver.name === "mystery-encounter")?.preferLastEnabledOption,
      false,
    );
  });

  withRenderProfile("animations-skipped-depth", () => {
    const policy = loadCampaignPolicy();
    assert.equal(policy.moveAnimationsExpected, false);
    assert.equal(
      buildDispatchTable(policy).find(driver => driver.name === "mystery-encounter")?.preferLastEnabledOption,
      true,
    );
    assert.deepEqual(policy.keys.renderProfileToggle, ["ArrowRight"]);
    assert.deepEqual(policy.keys.renderProfileOpen.slice(-6), ["r", ...new Array(5).fill("ArrowDown")]);
    assert.equal(policy.keys.renderProfileCloseKeysFromEnv, false);
    assert.deepEqual(policy.keys.renderProfileClose, ["Backspace"]);
  });

  withRenderProfile("unlabelled-fast-mode", () => {
    assert.throws(() => loadCampaignPolicy(), /COOP_UI_RENDER_PROFILE/u);
  });
});

test("campaign game speed is a closed benchmarkable setting", () => {
  const previous = process.env.COOP_UI_GAME_SPEED;
  try {
    for (const gameSpeed of [5, 7, 10]) {
      process.env.COOP_UI_GAME_SPEED = String(gameSpeed);
      assert.equal(loadCampaignPolicy().gameSpeed, gameSpeed);
    }
    process.env.COOP_UI_GAME_SPEED = "6";
    assert.throws(() => loadCampaignPolicy(), /COOP_UI_GAME_SPEED/u);
  } finally {
    if (previous == null) {
      delete process.env.COOP_UI_GAME_SPEED;
    } else {
      process.env.COOP_UI_GAME_SPEED = previous;
    }
  }
});

test("independent browser settings are configured concurrently", async () => {
  const campaign = await readFile(new URL("./campaign.mjs", import.meta.url), "utf8");
  for (const functionName of ["raiseGameSpeed", "configureRenderProfile"]) {
    const start = campaign.indexOf(`function ${functionName}`);
    const end = campaign.indexOf("\n}\n", start);
    const source = campaign.slice(start, end);
    assert.match(
      source,
      /await Promise\.all\(\s*clients\.map\(async client =>/u,
      `${functionName} runs both seats together`,
    );
    assert.doesNotMatch(source, /for \(const client of clients\)/u);
  }
});

test("preview assets are telemetry, while configured local workers remain API evidence", () => {
  const configuredWorkers = new Set(["http://127.0.0.1:8788", "http://127.0.0.1:8789"]);
  assert.equal(isCapturedApiUrl(new URL("http://127.0.0.1:4175/images/pokemon/1.png"), configuredWorkers), false);
  assert.equal(isCapturedApiUrl(new URL("http://127.0.0.1:8788/savedata/session/get"), configuredWorkers), true);
  assert.equal(
    isCapturedApiUrl(new URL("https://er-coop-api-staging.heraklines.workers.dev/coop/v3/heartbeat"), new Set()),
    true,
  );
});

test("the public clients wire their exact configured Worker origins into evidence capture", async () => {
  const harness = await readFile(new URL("./public-ui-harness.mjs", import.meta.url), "utf8");
  assert.match(
    harness,
    /\[config\.expectedApiOrigin, config\.expectedSignalOrigin\]\.filter\(Boolean\)/u,
    "local preview responses must not regain full per-response evidence through a missing origin configuration",
  );
});

test("the remote campaign dispatches independent closed game-speed benchmarks", async () => {
  const workflow = await readFile(
    new URL("../../../.github/workflows/coop-public-ui-campaign.yml", import.meta.url),
    "utf8",
  );
  assert.match(workflow, /game_speed:[\s\S]*options:[\s\S]*- "5"[\s\S]*- "7"[\s\S]*- "10"/u);
  assert.match(workflow, /COOP_UI_GAME_SPEED: \$\{\{ inputs\.game_speed \|\| '10' \}\}/u);
  assert.match(workflow, /group: .*inputs\.game_speed/u, "speed trials must not serialize behind one concurrency key");
});

test("default Display Settings close waits for a fresh title surface and semantically restores New Game", async () => {
  const campaign = await readFile(new URL("./campaign.mjs", import.meta.url), "utf8");
  const configureStart = campaign.indexOf("async function configureRenderProfile");
  const configureEnd = campaign.indexOf("async function assertRenderProfileExecution", configureStart);
  const configure = campaign.slice(configureStart, configureEnd);

  assert.match(configure, /const closeCursor = client\.evidence\.cursor\(\)/u);
  assert.match(configure, /findLastSemanticSurface\(closeCursor, "title-menu"\)/u);
  assert.match(
    configure,
    /selectOptionById\(client, \{[\s\S]*surfaceId: "title-menu"[\s\S]*targetId: "new-game"[\s\S]*submit: false[\s\S]*fromCursor: closeCursor/u,
  );
});

test("every gameplay co-op journey visibly applies its requested settings before pairing", async () => {
  const [campaign, journeySource] = await Promise.all([
    readFile(new URL("./campaign.mjs", import.meta.url), "utf8"),
    readFile(new URL("./journeys.mjs", import.meta.url), "utf8"),
  ]);

  assert.match(campaign, /export async function raiseGameSpeed/u);
  assert.match(campaign, /export async function configureRenderProfile/u);
  assert.match(journeySource, /import \{ configureRenderProfile, raiseGameSpeed \} from "\.\/campaign\.mjs";/u);
  assert.match(journeySource, /import \{ loadCampaignPolicy \} from "\.\/campaign-policy\.mjs";/u);

  const prepareStart = journeySource.indexOf("async function prepareCoopJourneySettings");
  const prepareEnd = journeySource.indexOf("function sessionStorageKeys", prepareStart);
  const prepare = journeySource.slice(prepareStart, prepareEnd);
  assert.ok(prepareStart >= 0 && prepareEnd > prepareStart, "journey settings helper must exist before journey code");
  assert.match(
    prepare,
    /await rig\.loginBoth\(\)[\s\S]+const policy = loadCampaignPolicy\(\)[\s\S]+if \(policy\.raiseSpeed\) \{[\s\S]+await raiseGameSpeed\(rig, policy, progress\)[\s\S]+await configureRenderProfile\(rig, policy, progress\)/u,
  );

  assert.match(journeySource, /const SETTINGS_EXEMPT_JOURNEYS = new Set\(\["probe", "showdown-battle"\]\);/u);
  const runStart = journeySource.indexOf("export async function runJourney");
  const run = journeySource.slice(runStart);
  assert.match(
    run,
    /if \(!SETTINGS_EXEMPT_JOURNEYS\.has\(name\)\) \{[\s\S]+await prepareCoopJourneySettings\(rig\)[\s\S]+await journey\(rig\)/u,
  );

  const gameplayJourneys = [
    "fresh-wave2",
    "reward-pause-settings",
    "fresh-resume",
    "reverse-resume",
    "faint-replacement",
    "commander-skip",
    "game-over",
    "resume-scan-isolation",
    "save-mutations",
  ];
  for (const name of gameplayJourneys) {
    assert.match(journeySource, new RegExp(`"${name}":?`, "u"));
    assert.equal(settingsExemptFromSource(journeySource).has(name), false);
  }
});

function settingsExemptFromSource(source) {
  const match = source.match(/const SETTINGS_EXEMPT_JOURNEYS = new Set\(\[(?<names>[^\]]+)\]\);/u);
  assert.ok(match?.groups?.names, "settings exemption declaration must remain statically inspectable");
  return new Set([...match.groups.names.matchAll(/"(?<name>[^"]+)"/gu)].map(entry => entry.groups.name));
}

test("public keys release before waiting for the exact production input dispatch", async () => {
  const [harness, evidence, observer] = await Promise.all([
    readFile(new URL("./public-ui-harness.mjs", import.meta.url), "utf8"),
    readFile(new URL("./evidence.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../scripts/coop-browser-entry.ts", import.meta.url), "utf8"),
  ]);
  assert.match(
    harness,
    /keyboard\.down\(key\)[\s\S]+keyboard\.up\(key\)[\s\S]+waitForPublicInputDispatch\(this\.evidence/u,
  );
  assert.match(harness, /findLastInputHealth\(this\.pageCursor\)/u);
  assert.match(harness, /findLastInputEcho\(this\.pageCursor\)/u);
  assert.match(harness, /findLastInputDispatch\(this\.pageCursor\)/u);
  assert.match(harness, /waitForPublicInputFrameSettle\(this\.evidence/u);
  assert.doesNotMatch(harness, /keyboard\.press\(key, \{ delay: Math\.min\(this\.config\.actionDelayMs, 100\) \}\)/u);
  const inputDispatchWait = evidence.slice(
    evidence.indexOf("export async function waitForPublicInputDispatch"),
    evidence.indexOf("export async function waitForPublicInputFrameSettle"),
  );
  assert.match(inputDispatchWait, /browser-input-dispatch[\s\S]+controllerType/u);
  assert.doesNotMatch(inputDispatchWait, /browser-input-health|browser-input-echo|requestAnimationFrame/u);
  assert.match(observer, /inputController\?\.events[\s\S]+source\.on\("input_down", observeInputDown\)/u);
  assert.match(observer, /\[coop-browser:input-dispatch\][\s\S]+inputLayerSnapshot\(\)/u);
  assert.match(observer, /pendingInputSettleFrame[\s\S]+inputFrameSettled/u);
});

test("public input pacing accepts only the exact keyboard dispatch for this DOM keydown", async () => {
  const sink = new EvidenceSink("input-dispatch", ".");
  const emitConsole = attachConsoleOnly(sink);
  const waiting = waitForPublicInputDispatch(sink, { from: 0, domKeysBefore: 7, timeoutMs: 1_000 });
  sink.record("browser-input-health", { observation: { domKeys: 8, frame: 101 } });
  sink.record("browser-input-echo", { observation: { domKeys: 8, active: true, uiMode: "LOADING" } });
  sink.record("browser-input-dispatch", { observation: { domKeys: 7, controllerType: "keyboard", button: 0 } });
  sink.record("browser-input-dispatch", { observation: { domKeys: 8, controllerType: "gamepad", button: 0 } });
  emitConsole('[coop-browser:input-dispatch] {"domKeys":8,"controllerType":"keyboard","button":0}');
  const proof = await waiting;
  assert.equal(proof.kind, "browser-input-dispatch");
  assert.equal(proof.observation.domKeys, 8);
});

test("public input pacing cannot accept frame or UI changes without a game dispatch", async () => {
  const sink = new EvidenceSink("input-no-dispatch", ".");
  // This is an in-memory pacing contract, not an artifact test. Install the same console-only
  // recorder as the neighboring cases before emitting observations so parallel `node --test`
  // workers never race a non-initialized filesystem sink in the repository root.
  attachConsoleOnly(sink);
  const waiting = waitForPublicInputDispatch(sink, { from: 0, domKeysBefore: 7, timeoutMs: 30 });
  sink.record("browser-input-health", { observation: { domKeys: 8, frame: 102 } });
  sink.record("browser-input-echo", { observation: { domKeys: 8, active: true, cursor: 1 } });
  await assert.rejects(waiting, /public keyboard key to produce one game input dispatch/u);
});

test("public input pacing waits for the exact key to cross a later Phaser frame", async () => {
  const sink = new EvidenceSink("input-frame-settle", ".");
  attachConsoleOnly(sink);
  const waiting = waitForPublicInputFrameSettle(sink, {
    from: 0,
    domKeys: 8,
    keydownFrame: 101,
    timeoutMs: 1_000,
  });
  sink.record("browser-input-health", {
    observation: {
      domKeys: 8,
      downKeys: 0,
      frame: 101,
      frameAdvancing: false,
      inputFrameSettled: false,
    },
  });
  sink.record("browser-input-health", {
    observation: {
      domKeys: 9,
      downKeys: 0,
      frame: 102,
      frameAdvancing: true,
      inputFrameSettled: true,
    },
  });
  sink.record("browser-input-health", {
    observation: {
      domKeys: 8,
      downKeys: 0,
      frame: 102,
      frameAdvancing: true,
      inputFrameSettled: true,
    },
  });
  const proof = await waiting;
  assert.equal(proof.observation.domKeys, 8);
  assert.equal(proof.observation.frame, 102);
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

test("render-profile execution proof uses canonical presentation outcomes, not debug strings", () => {
  const sink = new EvidenceSink("profile", ".");
  const emitConsole = attachConsoleOnly(sink);
  const event = {
    k: "moveAnim",
    bi: 0,
    moveId: 33,
    actor: { side: "player", pokemonId: 7 },
    targets: [2],
    targetActors: [{ side: "enemy", pokemonId: 8 }],
    hitsSubstitute: [false],
  };
  emitConsole(
    `[coop-browser:presentation-event] ${JSON.stringify({
      version: 1,
      stage: "authority-recorded",
      role: "host",
      epoch: 1,
      wave: 1,
      turn: 1,
      seq: 0,
      event,
    })}`,
  );
  emitConsole(
    `[coop-browser:presentation-event] ${JSON.stringify({
      version: 1,
      stage: "renderer-skipped",
      role: "guest",
      epoch: 1,
      wave: 1,
      turn: 1,
      seq: 0,
      event,
      reason: "animations-disabled",
    })}`,
  );

  assert.equal(
    sink.findPresentationEvent({ stage: "authority-recorded", eventKind: "moveAnim" })?.observation.role,
    "host",
  );
  assert.equal(
    sink.findPresentationEvent({
      stage: "renderer-skipped",
      eventKind: "moveAnim",
      reason: "animations-disabled",
    })?.observation.role,
    "guest",
  );
  assert.equal(sink.findPresentationEvent({ stage: "renderer-completed", eventKind: "moveAnim" }), undefined);
  assert.deepEqual(
    sink
      .findPresentationEvents({
        stage: "renderer-skipped",
        eventKind: "moveAnim",
        epoch: 1,
        wave: 1,
        turn: 1,
        seq: 0,
        canonicalEvent: event,
      })
      .map(entry => entry.observation.role),
    ["guest"],
  );
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
  // A later GPU-less run exposed one 252.3s custom move animation while both ordered streams kept
  // progressing. The sliding allowance is derived from that observation and remains animations-on-only;
  // it must not weaken the 90s detector used by the skipped-animation depth and Mystery profiles.
  assert.match(campaign, /const ANIMATIONS_ON_SLOW_EVENT_MEASURED_MS = 253_000;/u);
  assert.match(
    campaign,
    /const ANIMATIONS_ON_PROGRESS_ALLOWANCE_MS = Math\.ceil\(ANIMATIONS_ON_SLOW_EVENT_MEASURED_MS \* 1\.25\);/u,
  );
  assert.match(campaign, /const ANIMATION_PROGRESS_ALLOWANCE_MS = 90_000;/u);
  // The calibrated ceiling is passed ONLY when the profile expects animations (policy.moveAnimationsExpected);
  // otherwise null flows through to the default. Asserted at BOTH turn-outcome waits.
  const gated =
    /animationHardCeilingMs: policy\.moveAnimationsExpected \? ANIMATIONS_ON_OUTCOME_HARD_CEILING_MS : null,/gu;
  assert.equal((campaign.match(gated) ?? []).length, 2, "both turn-outcome waits gate the ceiling on the profile");
  // waitForOutcomeBounded threads the override into createAnimationProgressBudget only when non-null, so a
  // null (any other profile) leaves the default OUTCOME_HARD_CEILING_MS in force.
  assert.match(campaign, /animationHardCeilingMs == null \? \{\} : \{ hardCeilingMs: animationHardCeilingMs \}/u);
});
