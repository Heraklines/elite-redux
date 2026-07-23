/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { presentationEventView } from "./evidence.mjs";

const root = resolve(import.meta.dirname, "../../..");
const read = path => readFile(resolve(root, path), "utf8");

const [workflow, config, journeys, harness, observer, evidence, recorder, registry, title, replay, stream, transport] =
  await Promise.all([
    read(".github/workflows/coop-public-ui-journey.yml"),
    read("test/browser/coop-public-ui/config.mjs"),
    read("test/browser/coop-public-ui/journeys.mjs"),
    read("test/browser/coop-public-ui/public-ui-harness.mjs"),
    read("scripts/coop-browser-entry.ts"),
    read("test/browser/coop-public-ui/evidence.mjs"),
    read("src/data/elite-redux/coop/coop-turn-recorder.ts"),
    read("src/dev-tools/registry.ts"),
    read("src/phases/title-phase.ts"),
    read("src/phases/coop-replay-turn-phase.ts"),
    read("src/data/elite-redux/coop/coop-battle-stream.ts"),
    read("src/data/elite-redux/coop/coop-transport.ts"),
  ]);

test("the exact-SHA workflow exposes and seals a dedicated Showdown battle journey", () => {
  assert.match(workflow, /options:[\s\S]*- showdown-battle/u);
  assert.match(workflow, /VITE_COOP_BROWSER_FIXTURE:.*inputs\.journey == 'showdown-battle'.*'showdown-battle'.*'off'/u);
  assert.match(workflow, /Verify exact two-browser Showdown admission and turn contracts/u);
  assert.match(workflow, /- "src\/data\/elite-redux\/showdown\/\*\*"/u);
  assert.match(
    workflow,
    /- "src\/phases\/\*\*"/u,
    "Showdown and shared-control phase edits all trigger the exact two-browser journey",
  );
  assert.match(
    workflow,
    /- "src\/ui\/\*\*"/u,
    "every Showdown and shared-control UI edit triggers the exact two-browser journey",
  );
  assert.match(workflow, /src\/phases\/title-phase\|src\/system\/game-data/u);
  assert.match(workflow, /src\/phases\/title-phase\.ts \\/u);
  assert.match(config, /"showdown-battle"/u);
  assert.match(journeys, /"showdown-battle": showdownBattle/u);
  assert.match(
    journeys,
    /showdownBattle\(rig\)[\s\S]*pair\(rig\.config\.requesterSeat, \{ sessionKind: "versus" \}\)[\s\S]*startShowdownBattle\(\)[\s\S]*driveShowdownTurn\(\)/u,
  );
});

test("the preset fixture requires both immutable build identity and exact page URL", () => {
  assert.match(
    registry,
    /isCoopBrowserShowdownFixtureBuild\(\)[\s\S]*VITE_COOP_BROWSER_FIXTURE === "showdown-battle"/u,
  );
  assert.match(
    registry,
    /getCoopBrowserShowdownFixturePreset\(\)[\s\S]*!isCoopBrowserShowdownFixtureBuild\(\)[\s\S]*get\("coopfixture"\) !== "showdown-battle"/u,
  );
  assert.match(
    registry,
    /speciesId: SpeciesId\.PELIPPER[\s\S]*level: 100[\s\S]*abilityIndex: 0[\s\S]*moveset: \[MoveId\.AIR_CUTTER\][\s\S]*item: SHOWDOWN_ITEM_POOL\[0\]/u,
  );
  assert.match(title, /getCoopBrowserShowdownFixturePreset\(\)/u);
  assert.match(
    title,
    /presets: fixtureViews \?\? buildTeamMenuPresetViews\(gameData\)[\s\S]*browserFixturePreset \?\? gameData\.listShowdownTeamPresets\(\)\[idx\]/u,
  );
});

test("Showdown setup exposes locale-independent semantic options with reciprocal local wager ownership", () => {
  assert.match(title, /semanticId: "showdown"[\s\S]*GameModes\.SHOWDOWN/u);
  assert.match(observer, /case "SHOWDOWN_TEAM_MENU":[\s\S]*surfaceId: "showdown-team-menu"[\s\S]*ownerModel: "local"/u);
  assert.match(observer, /case "SHOWDOWN_WAGER":[\s\S]*surfaceId: "wager"[\s\S]*ownerModel: "local"/u);
  assert.match(observer, /showdown-preset:\$\{index\}/u);
  assert.match(observer, /showdown-wager:friendly/u);
});

test("two public clients must prove one positive gameplay epoch before locking the wager", () => {
  const open = harness.slice(
    harness.indexOf("async open()"),
    harness.indexOf("\n  async reopen()", harness.indexOf("async open()")),
  );
  assert.match(
    open,
    /this\.config\.journey === "showdown-battle"[\s\S]*entryUrl\.searchParams\.set\("coopfixture", "showdown-battle"\)[\s\S]*entryUrl\.searchParams\.set\("enableShowdown", "1"\)/u,
    "the exact-SHA Showdown journey must opt into the intentionally disabled public mode before navigation",
  );

  const enter = harness.slice(
    harness.indexOf("async enterShowdownLobby()"),
    harness.indexOf("\n  async waitForLobbyPlayer(", harness.indexOf("async enterShowdownLobby()")),
  );
  assert.match(enter, /targetId: "new-game"/u);
  assert.match(enter, /targetId: "showdown"/u);
  assert.match(enter, /targetId: "showdown-preset:0"/u);
  assert.match(enter, /targetId: "yes"/u);
  assert.match(enter, /waitFor\(\/start announce name=\/u/u);

  const binding = harness.slice(
    harness.indexOf("async completePairingBinding()"),
    harness.indexOf("\n  async assertSharedSurface(", harness.indexOf("async completePairingBinding()")),
  );
  assert.match(binding, /findLastBinding\(roleCursors\[client\.label\]\)/u);
  assert.match(binding, /epochs\.some\(epoch => !Number\.isSafeInteger\(epoch\) \|\| epoch <= 0\)/u);
  assert.match(binding, /new Set\(epochs\)\.size !== 1/u);
  assert.match(binding, /paired-binding-address-proof/u);

  const start = harness.slice(
    harness.indexOf("async startShowdownBattle()"),
    harness.indexOf("\n  /** Drive successive reciprocal", harness.indexOf("async startShowdownBattle()")),
  );
  assert.ok(
    start.indexOf("const wagerCursors = this.pairRoleCursors") < start.indexOf("completePairingBinding()"),
    "wager observation reuses the pre-request cursor and therefore precedes pair() itself",
  );
  assert.ok(start.indexOf("completePairingBinding()") < start.indexOf('waitForSemanticSurface(client, "wager"'));
  assert.ok(
    start.indexOf('waitForSemanticSurface(client, "wager"') < start.indexOf("const battleCursors"),
    "battle evidence receives a fresh cursor only after the one-shot wager was observed",
  );
  assert.match(start, /targetId: "showdown-wager:friendly"/u);
  assert.match(start, /assertSharedCommandFrontier\(battleCursors, "showdown-wave-1-command"/u);
});

test("the journey executes two reciprocal turns and requires every retained frontier", () => {
  const turn = harness.slice(
    harness.indexOf("async driveShowdownTurn()"),
    harness.indexOf("\n  async assertSharedSurface(", harness.indexOf("async driveShowdownTurn()")),
  );
  assert.match(turn, /driveSequentialCommandRound\(/u);
  assert.match(turn, /for \(let round = 1; round <= 2; round\+\+\)/u);
  assert.match(turn, /waitForPostTurnOutcome\(/u);
  assert.match(turn, /outcome\.kind !== "command"/u);
  assert.match(turn, /assertSharedCommandFrontier\(outcomeCursors, `\$\{label\}-next-command`/u);
  assert.match(turn, /assertRetainedContinuation\(outcomeCursors, `\$\{label\}-next-command`/u);
  assert.match(turn, /showdown-turn-2-synchronized/u);
});

test("the real-browser oracle requires streamed ability and environment presentation on both clients", () => {
  assert.match(observer, /const PRESENTATION_PREFIX = "\[coop-browser:presentation\] "/u);
  assert.match(observer, /phaseName === "ShowAbilityPhase" \|\| phaseName === "CoopShowAbilityReplayPhase"/u);
  assert.match(
    observer,
    /phaseName === "CommonAnimPhase"[\s\S]*environmentPresentation\?\.source === "environment"[\s\S]*Number\.isSafeInteger\(anim\)/u,
  );
  const start = harness.slice(
    harness.indexOf("async startShowdownBattle()"),
    harness.indexOf("\n  /** Drive successive reciprocal", harness.indexOf("async startShowdownBattle()")),
  );
  assert.match(start, /authority Showdown ability flyout/u);
  assert.match(start, /renderer Showdown ability flyout/u);
  assert.match(start, /authority Showdown environment animation/u);
  assert.match(start, /renderer Showdown environment animation/u);
  assert.match(start, /hostEnvironmentView\.anim !== guestEnvironmentView\.anim/u);
  assert.match(start, /hostEnvironmentView\.environmentPresentation\?\.value/u);
  assert.match(start, /hostEnvironmentView\.weather !== guestEnvironmentView\.weather/u);
  assert.match(start, /hostEnvironmentView\.terrain !== guestEnvironmentView\.terrain/u);
  assert.match(start, /Showdown ability presentation diverged/u);
  assert.match(start, /Showdown presentation did not complete on both clients before the shared command frontier/u);
  assert.match(start, /showdown-presentation-proof/u);
  assert.match(
    replay,
    /entryPresentationOnly[\s\S]*awaitEntryPresentation[\s\S]*retained entry presentation installed/u,
  );
  assert.match(stream, /awaitEntryPresentation[\s\S]*requestEnemyParty/u);
  assert.match(transport, /enemyPartySync[\s\S]*entryPresentation\?: CoopBattleEvent\[\]/u);
});

test("the real-browser oracle compares every authority event to a completed canonical renderer receipt", () => {
  assert.match(observer, /const PRESENTATION_EVENT_PREFIX = "\[coop-browser:presentation-event\] "/u);
  assert.match(observer, /setCoopPresentationObserver\(observation =>/u);
  assert.match(recorder, /stage:\s*"authority-recorded"/u);
  assert.match(recorder, /stage:\s*"renderer-completed"/u);
  assert.match(evidence, /presentationEventView\(text\)/u);
  assert.match(evidence, /sink\.record\("browser-presentation-event"/u);
  assert.match(harness, /assertPresentationLedger\(cursors, commandMatch, proofName\)/u);
  assert.match(harness, /entry\.stage !== "authority-recorded"/u);
  assert.match(harness, /entry\.stage !== "renderer-completed"/u);
  assert.match(harness, /ordered presentation ledger diverged/u);
  assert.match(harness, /showdown-entry-presentation-ledger/u);
  assert.match(harness, /`\$\{label\}-presentation-ledger`/u);
});

test("presentation receipts reject malformed or unknown event identities", () => {
  const prefix = "[coop-browser:presentation-event] ";
  const valid = {
    version: 1,
    stage: "authority-recorded",
    role: "host",
    epoch: 9,
    wave: 1,
    turn: 1,
    seq: 0,
    event: { k: "showAbility", bi: 0, pokemonId: 1, partySlot: 0, abilityId: 2, passive: false },
  };
  assert.deepEqual(presentationEventView(`${prefix}${JSON.stringify(valid)}`), valid);
  assert.equal(presentationEventView("ordinary log"), null);
  assert.throws(
    () => presentationEventView(`${prefix}${JSON.stringify({ ...valid, event: { k: "future-unwired-kind" } })}`),
    /invalid presentation-event observation/u,
  );
  assert.throws(
    () => presentationEventView(`${prefix}${JSON.stringify({ ...valid, stage: "renderer-queued" })}`),
    /invalid presentation-event observation/u,
  );
});

test("Showdown command convergence excludes account-local state and canonicalizes both battle perspectives by seat", () => {
  assert.match(observer, /const versus = runtime\?\.controller\.isVersusSession\(\) === true/u);
  assert.match(observer, /saveDataDigest = versus \? "versus-account-local-excluded"/u);
  assert.match(observer, /const localIsSeatOne = versus && runtime\?\.controller\.seat === 1/u);
  assert.match(observer, /playerParty: localIsSeatOne \? opponentParty : localParty/u);
  assert.match(observer, /enemyParty: localIsSeatOne \? localParty : opponentParty/u);
  assert.match(observer, /playerField: localIsSeatOne \? opponentField : localField/u);
  assert.match(observer, /enemyField: localIsSeatOne \? localField : opponentField/u);
  assert.match(
    harness,
    /Showdown permits reciprocal[\s\S]*local owners after its observer canonicalizes the two perspective-swapped teams by seat/u,
  );
});
