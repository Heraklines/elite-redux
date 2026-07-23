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
  const rendererGate = read("src/data/elite-redux/coop/coop-renderer-gate.ts");
  const guestTurn = read("src/phases/turn-start-phase.ts");

  assert.match(producer, /recordCoopEvent\(\{\s*k:\s*"switch"/u);
  assert.match(producer, /pokemonId:\s*incoming\.id/u);
  assert.match(producer, /speciesId:\s*incomingSpeciesId/u);
  assert.match(replay, /case\s+"switch":\s*pm\.unshiftNew\("CoopSwitchReplayPhase",\s*event\)/u);
  assert.match(rendererGate, /"CoopSwitchReplayPhase"/u);
  assert.match(
    replayPhases,
    /renderType\s*!==\s*Phaser\.HEADLESS[\s\S]+addPokeballOpenParticles/u,
    "headless presentation cannot leave an orphaned particle timer after scene teardown",
  );
  assert.doesNotMatch(guestTurn, /mirrorGuestOwnSwitch|summonCoopPlayerField/u);
});

test("V2 replacement animation drains before its checkpoint can install", () => {
  const replay = read("src/phases/coop-replay-turn-phase.ts");
  const presentationGate = replay.indexOf("hasRenderedReplacementPresentation(envelope)");
  const apply = replay.indexOf("this.applyReplacementTransaction(envelope)", presentationGate);
  assert.ok(presentationGate >= 0, "replacement replay has an exactly-once presentation gate");
  assert.ok(apply > presentationGate, "checkpoint apply occurs only after the presentation gate");
  assert.match(replay, /CoopSwitchReplayPhase[\s\S]+CoopReplayTurnPhase[\s\S]+this\.end\(\)/u);
});

test("live replacement material cannot omit the immutable presentation result", () => {
  const adapter = read("src/data/elite-redux/coop/authority-v2/adapters/faint-replacement.ts");
  const transport = read("src/data/elite-redux/coop/coop-transport.ts");
  assert.match(adapter, /live authority carrier has invalid replacement presentation/u);
  assert.match(adapter, /"presentation"/u);
  assert.match(transport, /COOP_PROTOCOL_VERSION\s*=\s*"er-coop-45"/u);
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
