/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { progressionEventView } from "./evidence.mjs";

const root = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const read = path => readFile(resolve(root, path), "utf8");
const prefix = "[coop-browser:progression-event] ";
const valid = {
  version: 1,
  stage: "authority-recorded",
  role: "host",
  epoch: 7,
  wave: 2,
  seq: 0,
  event: {
    k: "exp",
    partySlot: 0,
    pokemonId: 42,
    display: "field",
    expGain: 12,
    fromLevel: 5,
    toLevel: 5,
    fromExp: 20,
    toExp: 32,
  },
};

test("retained wave-progression observations are strict, typed browser evidence", () => {
  assert.deepEqual(progressionEventView(`${prefix}${JSON.stringify(valid)}`), valid);
  assert.throws(
    () => progressionEventView(`${prefix}${JSON.stringify({ ...valid, event: { k: "unknown" } })}`),
    /invalid progression-event observation/u,
  );
  assert.throws(
    () => progressionEventView(`${prefix}${JSON.stringify({ ...valid, stage: "renderer-failed", role: "guest" })}`),
    /invalid progression-event observation/u,
  );
  assert.equal(progressionEventView("ordinary browser log"), null);
});

test("authority and replica publish one lifecycle-owned progression ledger", async () => {
  const [
    observer,
    runtime,
    replay,
    rewardOperation,
    playerBattleInfo,
    entry,
    evidence,
    harness,
    campaign,
    campaignWorkflow,
    journeyWorkflow,
  ] = await Promise.all([
    read("src/data/elite-redux/coop/coop-wave-progression-observer.ts"),
    read("src/data/elite-redux/coop/coop-runtime.ts"),
    read("src/phases/coop-wave-progression-replay-phase.ts"),
    read("src/data/elite-redux/coop/coop-reward-operation.ts"),
    read("src/ui/battle-info/player-battle-info.ts"),
    read("scripts/coop-browser-entry.ts"),
    read("test/browser/coop-public-ui/evidence.mjs"),
    read("test/browser/coop-public-ui/public-ui-harness.mjs"),
    read("test/browser/coop-public-ui/campaign.mjs"),
    read(".github/workflows/coop-public-ui-campaign.yml"),
    read(".github/workflows/coop-public-ui-journey.yml"),
  ]);

  assert.match(observer, /"authority-recorded" \| "renderer-completed" \| "renderer-failed"/u);
  assert.match(runtime, /capture\.events\.push\(structuredClone\(event\)\)[\s\S]*stage: "authority-recorded"/u);
  assert.match(replay, /stage: "renderer-completed"[\s\S]*stage: "renderer-failed"/u);
  assert.match(replay, /override retire\(\): void[\s\S]*super\.retire\(\)[\s\S]*controller\.abort\(\)/u);
  assert.match(replay, /Promise\.race\(\[render\(controller\.signal, armWatchdog\), aborted\]\)/u);
  assert.match(
    replay,
    /showAutoText\([\s\S]*globalScene\.ui\.showText\(text, delay, finish, null, false\)/u,
    "retained narration is visual output and cannot open a second human control lease on the replica",
  );
  assert.match(
    replay,
    /promptLevelUpStats\([\s\S]+for \(let panel = 0; panel < 2; panel\+\+\)[\s\S]+presentationDelay\([\s\S]+handler\.processInput\(Button\.ACTION\)/u,
    "both retained level-up panels remain visible but their callbacks are lifecycle-owned",
  );
  assert.match(
    replay,
    /renderPartyExp\([\s\S]+await pokemon\.updateInfo\(true\)[\s\S]+partyExpBar\.showPokemonExp\([\s\S]+partyExpBar\.hide\(\)/u,
    "party EXP installs its immutable field preimage instantly and receipts the retained flyout, not a second EXP tween",
  );
  assert.match(
    playerBattleInfo,
    /if \(instant\) \{[\s\S]+this\.expMaskRect\.x = ratio \* 510;[\s\S]+complete\(\);[\s\S]+return;[\s\S]+globalScene\.tweens\.add\([\s\S]+updatePokemonExp\(pokemon, instant, durationMultiplier\)/u,
    "PlayerBattleInfo must bypass the render-tick tween and honor instant through recursive level-boundary EXP updates",
  );
  assert.match(entry, /setCoopWaveProgressionPresentationObserver[\s\S]*PROGRESSION_EVENT_PREFIX/u);
  assert.match(
    rewardOperation,
    /retainEnvelope\(res\.envelope, binding\)[\s\S]*isValidWaveProgressionPresentation\(progressionPresentation\)[\s\S]*stage: "authority-recorded"[\s\S]*wave: prepared\.wave/u,
    "reward-owned evolution presentation must enter the authority evidence ledger only after its immutable result is retained",
  );
  assert.match(evidence, /sink\.record\("browser-progression-event"/u);
  assert.match(
    harness,
    /assertWaveProgressionLedger\(wave, proofName[\s\S]*renderer-failed[\s\S]*retained progression ledger diverged/u,
  );
  assert.match(campaign, /assertWaveProgressionLedger\(waveNo, `campaign-wave-\$\{waveNo\}-progression-ledger`/u);
  for (const workflow of [campaignWorkflow, journeyWorkflow]) {
    assert.match(workflow, /wave-progression-presentation-evidence\.test\.mjs/u);
  }
});
