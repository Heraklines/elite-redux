/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("switch presentation is host-authored and the renderer never predicts its own switch", () => {
  const producer = read("src/phases/switch-summon-phase.ts");
  const replay = read("src/phases/coop-replay-turn-phase.ts");
  const replayPhases = read("src/phases/coop-replay-phases.ts");
  const animations = read("src/animations.ts");
  const rendererGate = read("src/data/elite-redux/coop/coop-renderer-gate.ts");
  const guestTurn = read("src/phases/turn-start-phase.ts");

  assert.match(producer, /recordCoopEvent\(\{\s*k:\s*"switch"/u);
  assert.match(producer, /pokemonId:\s*incoming\.id/u);
  assert.match(producer, /speciesId:\s*incomingSpeciesId/u);
  assert.match(
    replay,
    /case\s+"switch":[\s\S]+pm\.unshiftNew\("CoopSwitchReplayPhase",\s*event,\s*undefined,\s*outcomeToken\)/u,
  );
  assert.match(rendererGate, /"CoopSwitchReplayPhase"/u);
  assert.match(
    replayPhases,
    /renderType\s*!==\s*Phaser\.HEADLESS[\s\S]+addPokeballOpenParticles/u,
    "headless presentation cannot leave an orphaned particle timer after scene teardown",
  );
  assert.match(
    animations,
    /doDefaultPbOpenParticles[\s\S]+const scene = globalScene[\s\S]+const particleTimer = scene\.time\.addEvent[\s\S]+scene\.add == null[\s\S]+particleTimer\.remove\(\)/u,
    "the shared animation boundary binds its timer to one scene and retires callbacks after teardown",
  );
  assert.doesNotMatch(guestTurn, /mirrorGuestOwnSwitch|summonCoopPlayerField/u);
});

test("healing is an authority-authored presentation and every event kind is exhaustively rendered", () => {
  const pokemon = read("src/field/pokemon.ts");
  const replay = read("src/phases/coop-replay-turn-phase.ts");
  const replayPhases = read("src/phases/coop-replay-phases.ts");

  assert.match(
    pokemon,
    /public heal\([\s\S]+healAmount > 0 && isCoopRecording\(\)[\s\S]+recordCoopEvent\(\{\s*k: "hp"/u,
  );
  assert.match(replayPhases, /const healing = toHp > fromHp[\s\S]+CommonBattleAnim\(CommonAnim\.HEALTH_UP, mon\)/u);
  assert.match(replayPhases, /damageNumberHandler\.add\(mon, amount, HitResult\.HEAL, false\)/u);
  assert.match(replay, /const unhandledEvent: never = event/u);
});

test("damage effectiveness and critical presentation are authority-authored end to end", () => {
  const pokemon = read("src/field/pokemon.ts");
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  const replay = read("src/phases/coop-replay-phases.ts");

  assert.match(pokemon, /presentationResult[\s\S]+result: presentationResult, critical: presentationCritical/u);
  assert.match(transport, /result\?: number;\s*critical\?: boolean/u);
  assert.match(replay, /damageNumberHandler\.add\(mon, amount, damageResult, this\.critical\)/u);
  assert.match(replay, /HitResult\.SUPER_EFFECTIVE[\s\S]+playSound\("se\/hit_strong"\)/u);
  assert.match(replay, /repeat:\s*5[\s\S]+setVisible/u);
});

test("Terastallization is authority-authored and replayed without renderer mechanics", () => {
  const producer = read("src/phases/tera-phase.ts");
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  const replay = read("src/phases/coop-replay-phases.ts");
  const replayPump = read("src/phases/coop-replay-turn-phase.ts");

  assert.match(producer, /recordCoopEvent\(\{[\s\S]+k: "tera"[\s\S]+teraType: this\.pokemon\.getTeraType\(\)/u);
  assert.match(transport, /k: "tera";\s*bi: number;\s*pokemonId: number;\s*partySlot: number;\s*teraType: number;/u);
  const teraReplay = replay.slice(
    replay.indexOf("export class CoopTeraReplayPhase"),
    replay.indexOf("export class", replay.indexOf("export class CoopTeraReplayPhase") + 1),
  );
  assert.match(teraReplay, /CommonAnim\.TERASTALLIZE/u);
  assert.doesNotMatch(teraReplay, /isTerastallized = true/u);
  assert.match(replayPump, /case "tera":[\s\S]+"CoopTeraReplayPhase"/u);
});

test("ordinary co-op and Showdown both replay retained entry presentation before command input", () => {
  const summon = read("src/phases/summon-phase.ts");
  const initEncounter = read("src/phases/init-encounter-phase.ts");
  const command = read("src/phases/command-phase.ts");
  const turnInit = read("src/phases/turn-init-phase.ts");
  const replay = read("src/phases/coop-replay-turn-phase.ts");
  const replayPhases = read("src/phases/coop-replay-phases.ts");

  assert.match(
    summon,
    /if \(isAuthoritativeBattleSession\(\) && controller\?\.role === "host"\)[\s\S]+beginCoopRecording/u,
  );
  assert.doesNotMatch(summon, /isVersusSession\(\).*beginCoopRecording/u);
  assert.match(
    initEncounter,
    /isAuthoritativeBattleSession\(\) && controller\?\.role === "host"[\s\S]+beginCoopRecording/u,
  );
  assert.match(
    command,
    /const entryPresentation = sealCoopEntryPresentation\(\);[\s\S]+rebroadcastCoopWaveStartAuthorityAfterEntryEffects\(entryPresentation\)/u,
  );
  assert.match(
    turnInit,
    /if \(globalScene\.currentBattle\.turn === 1\)[\s\S]+"CoopReplayTurnPhase"[\s\S]+globalScene\.currentBattle\.waveIndex,[\s\S]+true,/u,
  );
  assert.doesNotMatch(turnInit, /isShowdownGuestFlipGated\(\) && globalScene\.currentBattle\.turn === 1/u);
  const entryPump = replay.slice(
    replay.indexOf("private async pumpEntryPresentation"),
    replay.indexOf("private handleAuthorityFailure"),
  );
  assert.match(entryPump, /this\.renderEvents\(events\)[\s\S]+"CoopFinalizeEntryPresentationPhase"/u);
  assert.doesNotMatch(
    entryPump,
    /this\.renderEvents\(events\)[\s\S]+streamer\.noteRenderedThrough/u,
    "queueing entry cues is not permission to advance their watermark",
  );
  assert.match(
    replayPhases,
    /class CoopFinalizeEntryPresentationPhase[\s\S]+inspectCoopPresentationOutcomes[\s\S]+noteRenderedThrough[\s\S]+this\.end\(\)/u,
    "the last queued phase must prove every outcome before command control can open",
  );
});

test("renderer fixtures cannot manufacture legacy wave authority", () => {
  const rendererFixture = read("test/tests/elite-redux/coop/coop-guest-renderer.test.ts");

  assert.doesNotMatch(rendererFixture, /makeCoopOperationId/u);
  assert.doesNotMatch(rendererFixture, /partner\.send\(\{\s*t:\s*"waveResolved"/u);
  assert.doesNotMatch(rendererFixture, /pendingOperation:\s*\{[\s\S]*kind:\s*"WAVE_ADVANCE"/u);
});

test("every authority event receives an ordered renderer-completion receipt in the exact-browser build", () => {
  const recorder = read("src/data/elite-redux/coop/coop-turn-recorder.ts");
  const replay = read("src/phases/coop-replay-turn-phase.ts");
  const browser = read("scripts/coop-browser-entry.ts");
  const harness = read("test/browser/coop-public-ui/public-ui-harness.mjs");

  assert.match(recorder, /stage:\s*"authority-recorded"/u);
  assert.match(recorder, /stage:\s*"renderer-completed"/u);
  assert.match(replay, /class CoopPresentationReceiptPhase[\s\S]+observeCoopRenderedPresentation/u);
  assert.match(replay, /const canonicalEvents = events[\s\S]+canonicalEvents\[eventOffset\]/u);
  assert.match(replay, /if \(hasCoopPresentationObserver\(\)\)[\s\S]+CoopPresentationReceiptPhase/u);
  assert.match(browser, /\[coop-browser:presentation-event\]/u);
  assert.match(harness, /assertPresentationLedger\(battleCursors, commandMatch/u);
  assert.match(harness, /assertPresentationLedger\(presentationCursors, commandMatch/u);
  assert.match(harness, /ordered presentation ledger diverged/u);
});

test("presentation liveness uses an exact runtime wall scheduler rather than the ambient Phaser scene clock", () => {
  const watchdog = read("src/phases/coop-presentation-watchdog.ts");

  assert.match(watchdog, /const scene = globalScene/u);
  assert.match(watchdog, /streamer\.scheduleAuthorityRetry\(callback, ms\)/u);
  assert.match(watchdog, /generation !== coopSessionGeneration\(\) \|\| getCoopBattleStreamer\(\) !== streamer/u);
  assert.doesNotMatch(watchdog, /globalScene\.time\.delayedCall/u);
});

test("an authoritative host turn commit cannot silently release without its immutable recording", () => {
  const commit = read("src/phases/coop-turn-commit-phase.ts");

  assert.match(commit, /const runtime = getCoopRuntime\(\)/u);
  assert.match(commit, /controller\.role !== "host" \|\| !isAuthoritativeBattleSession\(\)/u);
  assert.match(commit, /if \(recording\.turn < 0\) \{/u);
  assert.match(commit, /fatal\(reason\)/u);
  assert.doesNotMatch(
    commit,
    /controller == null \|\| streamer == null \|\| controller\.role !== "host" \|\| recording\.turn < 0/u,
  );
});

test("V2 replacement animation drains before its checkpoint can install", () => {
  const replay = read("src/phases/coop-replay-turn-phase.ts");
  const presentationGate = replay.indexOf("hasRenderedReplacementPresentation(envelope)");
  const apply = replay.indexOf("this.applyReplacementTransaction(envelope)", presentationGate);
  assert.ok(presentationGate >= 0, "replacement replay has an exactly-once presentation gate");
  assert.ok(apply > presentationGate, "checkpoint apply occurs only after the presentation gate");
  assert.match(replay, /CoopSwitchReplayPhase[\s\S]+CoopReplayTurnPhase[\s\S]+this\.end\(\)/u);
});

test("protocol 47 requires immutable presentation results and stable live actor identities", () => {
  const adapter = read("src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts");
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  const stream = read("src/data/elite-redux/coop/coop-battle-stream.ts");
  const move = read("src/phases/move-phase.ts");
  assert.match(adapter, /live authority carrier has invalid replacement presentation/u);
  assert.match(adapter, /"presentation"/u);
  assert.match(transport, /COOP_PROTOCOL_VERSION\s*=\s*"er-coop-47"/u);
  assert.match(transport, /actor: CoopPresentationActorRef/u);
  assert.doesNotMatch(transport, /actor\?: CoopPresentationActorRef/u);
  assert.match(stream, /event\.targetActors\.length === event\.targets\.length/u);
  assert.match(move, /targets: targetEntries\.map\(entry => entry\.target\)/u);
  assert.match(move, /targetActors: targetEntries\.map\(entry => entry\.actor\)/u);
});

test("every co-op renderer boundary triggers the production two-browser journey", () => {
  const workflow = read(".github/workflows/coop-public-ui-journey.yml");
  for (const path of [
    "src/data/elite-redux/coop/**",
    "src/data/elite-redux/showdown/**",
    "src/field/**",
    "src/phase-manager.ts",
    "src/phases/**",
    "src/ui/**",
  ]) {
    assert.match(workflow, new RegExp(`- "${path.replaceAll("*", "\\*")}"`, "u"));
  }
});

test("production-transition fixtures use public commands and terminal teardown cannot resurrect a dead client", () => {
  const harness = read("test/tools/coop-duo-harness.ts");
  const biomeJourney = read("test/tests/elite-redux/coop/coop-transition-t2-biome.test.ts");
  const mysteryJourney = read("test/tests/elite-redux/coop/coop-transition-t2-mystery.test.ts");

  assert.match(harness, /options\.submitHostTackle[\s\S]+host selects Fight through COMMAND UI/u);
  assert.match(harness, /prev\.runtime\.localTransport\.state !== "closed"/u);
  assert.match(
    harness,
    /startGuestMeShopOwner[\s\S]+peerContextByScene\.get\(guestScene\)[\s\S]+withClient\(peerCtx, \(\) => drainLoopback\(\)\)/u,
  );
  assert.doesNotMatch(
    harness,
    /for \(const runtime of \[rig\.guestRuntime, rig\.hostRuntime\]\) \{\s*if \(runtime\.localTransport\.state === "closed"\)/u,
  );
  assert.match(biomeJourney, /submitHostTackle:\s*true/u);
  assert.doesNotMatch(biomeJourney, /game\.move\.select\(/u);
  assert.match(mysteryJourney, /submitHostTackle:\s*true/u);
  assert.doesNotMatch(mysteryJourney, /game\.move\.select\(/u);
});
