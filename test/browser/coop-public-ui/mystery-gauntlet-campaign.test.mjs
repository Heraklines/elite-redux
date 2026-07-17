/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { chooseAffordableStarterPair, selectOptionById } from "./campaign-nav.mjs";
import { buildDispatchTable, loadCampaignPolicy } from "./campaign-policy.mjs";
import {
  captureCheckpointPngWithFallback,
  checkpointPixelIntegrityFailure,
  checkpointRequiresGameplayCoverage,
} from "./evidence.mjs";

const root = resolve(import.meta.dirname, "../../..");

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("Mystery gauntlet policy is loud-fail and drives every projected encounter surface", () => {
  withEnvironment(
    {
      COOP_UI_CAMPAIGN_MODE: "gating",
      COOP_UI_AUTO_FIRST: "0",
      COOP_UI_RENDER_PROFILE: "mystery-gauntlet",
      COOP_UI_REQUIRE_MYSTERY_GAUNTLET: "1",
      COOP_UI_MYSTERY_MIN_SURFACES: "6",
    },
    () => {
      const policy = loadCampaignPolicy();
      assert.equal(policy.autoFirst, false);
      assert.deepEqual(policy.mysteryGauntlet, { required: true, minSurfaces: 6 });
      assert.equal(policy.maxBattleLoops, 90);
      assert.equal(policy.moveAnimationsExpected, false);
      const dispatch = buildDispatchTable(policy);
      const surfaces = dispatch.map(driver => driver.v2SurfaceId);
      assert.deepEqual(
        ["mystery-encounter", "mystery-encounter:prompt", "quiz", "bargain", "colosseum"].filter(
          surface => !surfaces.includes(surface),
        ),
        [],
      );
      assert.deepEqual(
        dispatch
          .filter(driver => ["reward-target", "biome-pick"].includes(driver.name))
          .map(driver => [driver.name, driver.v2SurfaceId]),
        [
          ["reward-target", "party:reward-target"],
          ["biome-pick", "world-map"],
        ],
      );
      assert.equal(dispatch.find(driver => driver.name === "reward-target")?.semanticOnly, true);
    },
  );
});

test("workflow builds the staging-only fifth difficulty and fans a fixed ten-wave profile", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/coop-public-ui-campaign.yml"), "utf8");
  assert.match(workflow, /VITE_DEV_TOOLS: 1/u);
  assert.match(
    workflow,
    /profile: mystery-gauntlet\s+artifact: mystery\s+waves: "10"\s+difficulty: mystery\s+difficulty_option: mystery\s+require_mystery: "1"/u,
  );
  assert.match(workflow, /COOP_UI_DIFFICULTY_ID: \$\{\{ matrix\.difficulty \}\}/u);
  assert.match(workflow, /COOP_UI_DIFFICULTY_OPTION_ID: \$\{\{ matrix\.difficulty_option \}\}/u);
  assert.match(workflow, /COOP_UI_REQUIRE_MYSTERY_GAUNTLET: \$\{\{ matrix\.require_mystery \}\}/u);
});

test("campaign requires paired runConfig, the exact semantic schedule, and retained terminals", async () => {
  const harness = await readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8");
  const campaign = await readFile(resolve(root, "test/browser/coop-public-ui/campaign.mjs"), "utf8");
  assert.match(harness, /targetId: this\.config\.difficultyOptionId/u);
  assert.match(harness, /guest received difficulty=\$\{this\.config\.difficultyId\}/u);
  assert.match(harness, /difficulty-\$\{this\.config\.difficultyId\}-attested/u);
  assert.match(campaign, /\[2, "mystery"\][\s\S]*\[6, "mystery"\][\s\S]*\[9, "bargain"\][\s\S]*\[10, "mystery"\]/u);
  assert.match(campaign, /watcherSurfaceId: "mystery-encounter:message"/u);
  assert.match(campaign, /async function driveConfirmedLeave\(/u);
  assert.match(campaign, /owner\.waitForOwnedRewardConfirm\(/u);
  assert.match(campaign, /watcher\.waitForAddressedRewardWatcher\(/u);
  assert.match(campaign, /campaign-semantic-confirmation-barrier/u);
  assert.match(campaign, /async function checkpointRewardPartyTarget\(/u);
  assert.match(campaign, /watcherSurfaceId: "reward-shop"/u);
  assert.match(campaign, /async function driveRewardPartyTarget\(/u);
  assert.match(campaign, /selected\.startsWith\("party-option:"\)/u);
  assert.match(campaign, /campaign-reward-target-action/u);
  assert.match(campaign, /await driveConfirmedLeave\(rig, driver, client, mechanicalBoundary\.authority\)/u);
  assert.match(campaign, /event\.terminal\.wave === wave \+ 1/u);
  assert.match(campaign, /if \(nextBoundary\.wave <= event\.wave\)/u);
  assert.match(campaign, /mysteryEvents: mysteryCoverage\.events/u);
  assert.match(campaign, /ordinal <= policy\.maxBattleLoops/u);
  assert.match(campaign, /\[campaign-loop-budget\]/u);
  assert.match(campaign, /return "target-reached"/u);
  assert.match(campaign, /wave-\$\{event\.wave\}-mystery-terminal/u);
  assert.match(campaign, /battleType: observation\.battleType/u);
  assert.match(campaign, /maxBossSegments: observation\.maxBossSegments/u);
  assert.match(campaign, /observation\.mysteryEncounterType !== first\.mysteryEncounterType/u);
  assert.match(campaign, /observation\.stateDigest !== first\.stateDigest/u);
  assert.match(campaign, /duplicateWaves/u);
  assert.match(campaign, /ordinary encounters were not six distinct registry types/u);
});

test("the continuity profile visibly declines Bargain and co-op cannot persist a half-open phase", async () => {
  const policy = await readFile(resolve(root, "test/browser/coop-public-ui/campaign-policy.mjs"), "utf8");
  const menu = await readFile(resolve(root, "src/ui/handlers/menu-ui-handler.ts"), "utf8");
  const encounter = await readFile(resolve(root, "src/phases/encounter-phase.ts"), "utf8");
  assert.match(policy, /bargainLeave: envKeys\("COOP_UI_BARGAIN_LEAVE_KEYS", \["Backspace"\]\)/u);
  assert.match(policy, /name: "mystery-bargain"[\s\S]*keys: policy\.keys\.bargainLeave/u);
  assert.match(
    menu,
    /if \(globalScene\.gameMode\.isCoop\)[\s\S]*Save & Quit is unavailable during a live co-op session/u,
  );
  assert.match(encounter, /globalScene\.gameData\s*\.saveAll\(/u);
});

test("the companion solo lane publicly selects a readiness-proven empty save slot", async () => {
  const handler = await readFile(resolve(root, "src/ui/handlers/save-slot-select-ui-handler.ts"), "utf8");
  const observer = await readFile(resolve(root, "scripts/coop-browser-entry.ts"), "utf8");
  const navigation = await readFile(resolve(root, "test/browser/coop-public-ui/campaign-nav.mjs"), "utf8");
  const solo = await readFile(resolve(root, "test/browser/coop-public-ui/solo-classic.mjs"), "utf8");
  assert.match(handler, /getSelectedSlotSemanticSelection\(\)/u);
  assert.match(handler, /slot\.hasData === undefined[\s\S]*loaded: false[\s\S]*state: "loading"/u);
  assert.match(observer, /getSelectedSlotSemanticSelection\?\.\(\)/u);
  assert.match(observer, /selection\?\.loaded \? `\$\{selection\.state\}-slot:\$\{selection\.slotId\}` : null/u);
  assert.match(navigation, /event\?\.observation\.ready\.handlerActive === true/u);
  assert.match(navigation, /event\.observation\.selectedOptionId === "empty-slot:0"/u);
  assert.match(navigation, /await client\.press\("Space", "fresh-save-slot-0"\)/u);
  assert.match(solo, /await selectFirstEmptySaveSlot\(client,/u);
});

test("parallel lobby pairing reselects the exact visible username before every request", async () => {
  const [harness, titlePhase] = await Promise.all([
    readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8"),
    readFile(resolve(root, "src/phases/title-phase.ts"), "utf8"),
  ]);
  assert.match(harness, /const targetId = `ask:\$\{username\}`/u);
  assert.match(
    harness,
    /requestCursor = this\.evidence\.cursor\(\);[\s\S]*selectOptionById\(this, \{[\s\S]*surfaceId: "option-select:TitlePhase"[\s\S]*targetId,/u,
  );
  assert.doesNotMatch(harness, /surfaceId: "option-select:TitlePhase"[\s\S]{0,240}submit: false/u);
  assert.match(harness, /Splitting selection and Space into[\s\S]*TitlePhase repaint block the key/u);
  assert.match(
    await readFile(resolve(root, "test/browser/coop-public-ui/campaign-nav.mjs"), "utf8"),
    /requireExplicitUnblocked[\s\S]*observation\.ready\.inputBlocked != null[\s\S]*observation\.ready\.inputBlocked === false/u,
  );
  assert.match(harness, /surface\?\.observation\.optionIds\?\.includes\(targetId\)/u);
  assert.match(harness, /description: `visible lobby option for \$\{username\}`/u);
  assert.match(harness, /this\.lobbySurfaceCursor = this\.evidence\.cursor\(\)/u);
  assert.match(harness, /fromCursor: this\.lobbySurfaceCursor/u);
  assert.match(harness, /requester\.requestPlayer\(acceptorName, \{[\s\S]*purpose: "reissue-request"/u);
  assert.match(
    harness,
    /requester\.requestPlayer\(acceptor\.credentials\.username, \{[\s\S]*purpose: "initial-request"[\s\S]*optional: true/u,
  );
  assert.match(harness, /let nextReissueAt = Date\.now\(\)/u);
  assert.match(
    harness,
    /incoming === requesterName[\s\S]*selectOptionById\(acceptor, \{[\s\S]*targetId: `accept:\$\{requesterName\}`[\s\S]*timeoutMs: LOBBY_REQUEST_REISSUE_MS/u,
  );
  assert.doesNotMatch(harness, /acceptor\.press\("Space", `lobby-accept-/u);
  assert.match(harness, /relayTimeoutMs: OPTIONAL_LOBBY_RELAY_WAIT_MS/u);
  assert.match(harness, /optional && error instanceof Error && \/timed out waiting for request relay/u);
  assert.match(harness, /const relayed = sink\.find\(\/request target=\/u, requestCursor\)/u);
  assert.match(harness, /const binding = sink\.findBinding\(requestCursor\)/u);
  assert.match(harness, /Start Phase \(\?:SelectChallengePhase\|SelectStarterPhase\)/u);
  assert.doesNotMatch(harness, /const canceled = sink\.find\(\/\\\[coop:lobby\\\] cancel\/u/u);
  assert.match(harness, /sink\.find\(\/Start Phase TitlePhase\/u, requestCursor\)/u);
  assert.match(harness, /this\.evidence\.record\("lobby-request-terminal"/u);
  assert.match(harness, /lobby selection returned to TitlePhase before request relay/u);
  assert.match(harness, /outcome\.kind === "title-return"/u);
  assert.match(harness, /failure\?\.status === 409/u);
  assert.match(harness, /failure\.pathname === "\/coop\/v3\/lobby\/respond"/u);
  assert.match(harness, /client\.evidence\.networkState\.apiFailure = null/u);
  assert.match(harness, /proofRequired: "stable-seat-binding"/u);
  assert.match(harness, /waitFor\(\/respond accept=true from=\/u/u);
  assert.match(harness, /description: `Accept relay for \$\{requesterName\}`/u);
  assert.match(harness, /requiring a later stable-seat binding/u);
  assert.doesNotMatch(harness, /requester\.press\("Space", `lobby-reissue-request-/u);
  assert.doesNotMatch(harness, /await this\.evidence\.waitFor\(\/request target=\/u/u);

  // A submit queued for an expired Accept panel must land on an inert row, never on a newly
  // reordered player or Cancel action. A fresh navigation/hover explicitly unlocks the new panel.
  assert.match(titlePhase, /lobbyActionRequiresReselection = true[\s\S]*renderPanel\(\)/u);
  assert.match(
    titlePhase,
    /if \(lobbyActionRequiresReselection\)[\s\S]*label: "Lobby updated - choose again"[\s\S]*handler: \(\) => false/u,
  );
  assert.match(titlePhase, /onHover: \(\) => \{\s*lobbyActionRequiresReselection = false/u);

  // The observed staging poll delivered the original request after 6.2s. Keep retries frequent
  // enough to recover a lost request while leaving the live Accept panel time to be acted on.
  const reissueMs = Number(harness.match(/const LOBBY_REQUEST_REISSUE_MS = ([\d_]+);/u)?.[1].replaceAll("_", ""));
  const optionalRelayMs = Number(
    harness.match(/const OPTIONAL_LOBBY_RELAY_WAIT_MS = ([\d_]+);/u)?.[1].replaceAll("_", ""),
  );
  assert.ok(reissueMs > 6_200 && reissueMs <= 15_000);
  assert.ok(optionalRelayMs > 0 && optionalRelayMs < reissueMs);
});

test("semantic option identity is independent of every presentation language", async () => {
  const [observer, optionType, gender, confirm, title, starter, party, campaignNav] = await Promise.all([
    readFile(resolve(root, "scripts/coop-browser-entry.ts"), "utf8"),
    readFile(resolve(root, "src/ui/handlers/abstract-option-select-ui-handler.ts"), "utf8"),
    readFile(resolve(root, "src/phases/select-gender-phase.ts"), "utf8"),
    readFile(resolve(root, "src/ui/handlers/confirm-ui-handler.ts"), "utf8"),
    readFile(resolve(root, "src/phases/title-phase.ts"), "utf8"),
    readFile(resolve(root, "src/ui/handlers/starter-select-ui-handler.ts"), "utf8"),
    readFile(resolve(root, "src/ui/handlers/party-ui-handler.ts"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/campaign-nav.mjs"), "utf8"),
  ]);

  assert.match(optionType, /semanticId\?: string/u);
  assert.match(observer, /option\?\.semanticId === "string"[\s\S]*option\.semanticId[\s\S]*`slot:\$\{index\}`/u);
  assert.doesNotMatch(observer, /normalizeOptionId|option\.label/u);
  assert.match(gender, /semanticId: "boy"[\s\S]*semanticId: "girl"/u);
  assert.match(confirm, /semanticId: "yes"[\s\S]*semanticId: "no"/u);
  assert.match(title, /semanticId: "new-game"[\s\S]*semanticId: "co-op"/u);
  assert.match(title, /semanticId: `ask:\$\{p\.name\}`/u);
  assert.match(title, /semanticId: `accept:\$\{from\.name\}`/u);
  assert.match(starter, /semanticId: "add-to-party"/u);
  assert.match(starter, /semanticId: key\.toLowerCase\(\)/u);
  assert.match(observer, /selectedOptionId: "starter-action:random"/u);
  assert.match(observer, /selectedOptionId: `starter-team:\$\{starterHandler\.starterIconsCursorIndex\}`/u);
  assert.match(observer, /starterGridCandidates/u);
  assert.match(campaignNav, /chooseAffordableStarterPair/u);
  assert.match(campaignNav, /starter-grid-add-proof/u);
  assert.match(campaignNav, /targetId: "add-to-party"/u);
  assert.match(party, /export enum PartyOption/u);
  assert.match(observer, /partyOptionSemanticId\(/u);
  assert.match(observer, /party-option:\$\{enumName\.toLowerCase\(\)\.replaceAll\("_", "-"\)\}/u);
  assert.match(observer, /partyHandler\.optionsMode === true/u);
  assert.match(observer, /uiMode === "PARTY"\s*\? null/u);
});

test("representative starter selection is deterministic and stays within the co-op budget", () => {
  const pair = chooseAffordableStarterPair({
    starterGridCandidates: [
      { index: 11, speciesId: 728, cost: 4 },
      { index: 3, speciesId: 152, cost: 2 },
      { index: 7, speciesId: 155, cost: 3 },
      { index: 1, speciesId: 906, cost: 4 },
    ],
  });
  assert.deepEqual(pair, [
    { index: 3, speciesId: 152, cost: 2 },
    { index: 7, speciesId: 155, cost: 3 },
  ]);
});

test("paired Chromium runs headful at an explicit player-sized viewport", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/coop-public-ui-campaign.yml"), "utf8");
  const harness = await readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8");
  assert.match(workflow, /COOP_UI_HEADLESS: "0"/u);
  // Optimization brief R1: one player-sized Xvfb display PER SEAT (two players, two
  // devices) - the harness pins each Chromium to its own display and drops cross-seat
  // focus arbitration. The headful + 1440x900 contract this test protects is unchanged.
  assert.match(workflow, /Xvfb :98 -screen 0 1440x900x24/u);
  assert.match(workflow, /Xvfb :99 -screen 0 1440x900x24/u);
  assert.match(workflow, /COOP_UI_DISPLAY_HOST=:98 COOP_UI_DISPLAY_GUEST=:99/u);
  assert.match(harness, /defaultViewport: config\.viewport/u);
  assert.match(harness, /"--disable-dev-shm-usage"/u);
  assert.match(harness, /"--use-gl=angle"/u);
  assert.match(harness, /"--use-angle=swiftshader-webgl"/u);
  assert.match(harness, /"--enable-unsafe-swiftshader"/u);
  assert.match(harness, /`--window-size=\$\{config\.viewport\.width\},\$\{config\.viewport\.height\}`/u);
});

test("visual checkpoints foreground WebGL and reject trivial captures", async () => {
  const evidence = await readFile(resolve(root, "test/browser/coop-public-ui/evidence.mjs"), "utf8");
  assert.match(evidence, /await page\.bringToFront\(\)/u);
  assert.match(evidence, /requestAnimationFrame\(\(\) => requestAnimationFrame\(resolveFrames\)\)/u);
  assert.match(evidence, /screenshot\.byteLength < MIN_CHECKPOINT_PNG_BYTES/u);
  assert.match(evidence, /const capturePaths = \[false, true, false, true, false, true\]/u);
  assert.match(evidence, /failed pixel integrity after \$\{capturePaths\.length\} capture attempts/u);
  assert.match(evidence, /dom\.canvases\.length === 0/u);
  assert.match(evidence, /serializeCheckpointCapture\(\(\) =>[\s\S]*captureCheckpointPngWithFallback/u);
  assert.match(evidence, /checkpointCaptureTail = pending\.catch\(\(\) => \{\}\)/u);
  assert.match(evidence, /verticalEdgeColumns > 18/u);
  assert.match(evidence, /verticalEdgeColumns > 10 && pixelIntegrity\.nearDarkRatio > 0\.15/u);
  assert.match(evidence, /minimumGameplayTileNonDarkRatio < MIN_GAMEPLAY_TILE_NON_DARK_RATIO/u);
  assert.match(evidence, /minimumGameplayTileColorRatio < MIN_GAMEPLAY_TILE_COLOR_RATIO/u);
  assert.match(evidence, /checkpoint-pixel-integrity/u);
});

test("checkpoint capture retries an exception through the alternate Chromium path", async () => {
  const calls = [];
  const persisted = [];
  const page = {
    async bringToFront() {},
    async evaluate() {},
    async screenshot(options) {
      calls.push(options.fromSurface);
      if (calls.length === 1) {
        throw new Error("compositor readback failed");
      }
      return Buffer.alloc(100_000, 1);
    },
  };
  const result = await captureCheckpointPngWithFallback(page, {
    step: "retry-proof",
    dir: "C:/tmp",
    label: "guest",
    settle: async () => {},
    inspect: async () => ({
      colorBinCount: 500,
      nearDarkRatio: 0.05,
      verticalEdgeColumns: 2,
      minimumGameplayTileNonDarkRatio: 0.95,
      minimumGameplayTileColorRatio: 0.8,
    }),
    persist: async path => persisted.push(path),
  });
  assert.deepEqual(calls, [false, true]);
  assert.equal(result.attempt, 2);
  assert.deepEqual(persisted, [resolve("C:/tmp", "retry-proof.png")]);
});

test("checkpoint capture reports each corrupt path with its own metrics", async () => {
  let inspectCall = 0;
  await assert.rejects(
    captureCheckpointPngWithFallback(
      {
        async bringToFront() {},
        async evaluate() {},
        async screenshot() {
          return Buffer.alloc(100_000, 1);
        },
      },
      {
        step: "corrupt-proof",
        dir: "C:/tmp",
        label: "host",
        settle: async () => {},
        inspect: async () => ({
          colorBinCount: 200 + inspectCall++,
          nearDarkRatio: 0.5,
          verticalEdgeColumns: 30,
          minimumGameplayTileNonDarkRatio: 0.2,
          minimumGameplayTileColorRatio: 0.1,
        }),
        persist: async () => {},
      },
    ),
    /attempt 1 fromSurface=false:[\s\S]*bins=200[\s\S]*attempt 2 fromSurface=true:[\s\S]*bins=201[\s\S]*attempt 6 fromSurface=true:[\s\S]*bins=205/u,
  );
});

test("pixel integrity separates observed clean screens from headed compositor corruption", () => {
  // Sampled from prior clean difficulty/starter/gameplay PNGs: vertical UI borders may span the
  // viewport, but they are colorful rather than dark compositor columns.
  for (const clean of [
    {
      colorBinCount: 450,
      nearDarkRatio: 0,
      verticalEdgeColumns: 12,
      minimumGameplayTileNonDarkRatio: 0.98,
      minimumGameplayTileColorRatio: 0.71,
    },
    {
      colorBinCount: 562,
      nearDarkRatio: 0,
      verticalEdgeColumns: 13,
      minimumGameplayTileNonDarkRatio: 0.64,
      minimumGameplayTileColorRatio: 0.29,
    },
    {
      colorBinCount: 503,
      nearDarkRatio: 0,
      verticalEdgeColumns: 0,
      minimumGameplayTileNonDarkRatio: 1,
      minimumGameplayTileColorRatio: 0.85,
    },
    {
      colorBinCount: 45,
      nearDarkRatio: 0.79,
      verticalEdgeColumns: 0,
      minimumGameplayTileNonDarkRatio: 0,
      minimumGameplayTileColorRatio: 0,
    },
  ]) {
    assert.equal(checkpointPixelIntegrityFailure(clean), null);
  }

  // Sampled from the rejected e3abdeea8 headed/Xvfb captures opened during review.
  for (const corrupt of [
    {
      colorBinCount: 112,
      nearDarkRatio: 0.537,
      verticalEdgeColumns: 13,
      minimumGameplayTileNonDarkRatio: 0,
      minimumGameplayTileColorRatio: 0,
    },
    {
      colorBinCount: 261,
      nearDarkRatio: 0.473,
      verticalEdgeColumns: 23,
      minimumGameplayTileNonDarkRatio: 0,
      minimumGameplayTileColorRatio: 0,
    },
    {
      colorBinCount: 90,
      nearDarkRatio: 0.244,
      verticalEdgeColumns: 23,
      minimumGameplayTileNonDarkRatio: 0,
      minimumGameplayTileColorRatio: 0,
    },
  ]) {
    assert.equal(checkpointPixelIntegrityFailure(corrupt), "vertical-stripe compositor corruption");
  }
});

test("gameplay tile coverage rejects partial WebGL captures without rejecting dark setup screens", () => {
  // Sampled from the partial guest save-wait capture in run 29473152825. Its global palette and
  // dark ratio passed the broad integrity checks, but nine of its 6x4 tiles were entirely black.
  const partialGuest = {
    colorBinCount: 45,
    nearDarkRatio: 0.796,
    verticalEdgeColumns: 0,
    minimumGameplayTileNonDarkRatio: 0,
    minimumGameplayTileColorRatio: 0,
  };
  assert.equal(checkpointPixelIntegrityFailure(partialGuest, "page-1-wave-2-command"), "partial gameplay capture");
  assert.equal(checkpointPixelIntegrityFailure(partialGuest, "page-1-campaign-failed"), "partial gameplay capture");
  assert.equal(checkpointPixelIntegrityFailure(partialGuest, "page-1-paired-and-verifying-save"), null);

  // The exact guest failure PNG from run 29477127389 is full on disk despite looking partial in
  // one multi-image viewer: every coarse tile contains both visible and chromatic game pixels.
  const cleanGuestFailure = {
    colorBinCount: 544,
    nearDarkRatio: 0,
    verticalEdgeColumns: 2,
    minimumGameplayTileNonDarkRatio: 1,
    minimumGameplayTileColorRatio: 0.855,
  };
  assert.equal(checkpointPixelIntegrityFailure(cleanGuestFailure, "page-1-campaign-failed"), null);

  assert.equal(checkpointRequiresGameplayCoverage("page-1-wave-10-mystery-terminal"), true);
  assert.equal(checkpointRequiresGameplayCoverage("page-1-campaign-failed"), true);
  assert.equal(checkpointRequiresGameplayCoverage("page-1-title-ready"), false);
  assert.equal(checkpointRequiresGameplayCoverage("page-1-paired-and-verifying-save"), false);
});

test("semantic navigation ignores stale same-surface history before its boundary", async () => {
  const targetId = "ask-peer-to-play";
  const events = [
    {
      index: 4,
      observation: {
        surfaceId: "option-select:TitlePhase",
        selectedOptionId: "classic",
        optionIds: ["classic", "co-op", "cancel"],
        ready: { handlerActive: true, inputBlocked: false },
      },
    },
  ];
  const client = {
    label: "guest-seat",
    evidence: {
      findLastSemanticSurface(fromCursor, surfaceId) {
        return events.findLast(event => event.index >= fromCursor && event.observation.surfaceId === surfaceId) ?? null;
      },
      record() {},
    },
    async press() {
      throw new Error("target was already selected; navigation input was unexpected");
    },
  };
  setTimeout(() => {
    events.push({
      index: 6,
      observation: {
        surfaceId: "option-select:TitlePhase",
        selectedOptionId: targetId,
        optionIds: [targetId, "cancel"],
        ready: { handlerActive: true, inputBlocked: false },
      },
    });
  }, 10);

  await selectOptionById(client, {
    surfaceId: "option-select:TitlePhase",
    targetId,
    submit: false,
    timeoutMs: 250,
    fromCursor: 5,
  });
});

test("semantic navigation never submits a selected lobby row while its repaint blocks input", async () => {
  const targetId = "ask-peer-to-play";
  const events = [
    {
      index: 10,
      observation: {
        surfaceId: "option-select:TitlePhase",
        selectedOptionId: targetId,
        optionIds: [targetId, "cancel"],
        surfaceGeneration: 4,
        ready: { handlerActive: true, inputBlocked: true },
      },
    },
  ];
  const presses = [];
  const client = {
    label: "guest-seat",
    evidence: {
      findLastSemanticSurface(fromCursor, surfaceId) {
        return events.findLast(event => event.index >= fromCursor && event.observation.surfaceId === surfaceId) ?? null;
      },
      record() {},
    },
    async press(key) {
      presses.push(key);
    },
  };
  setTimeout(() => {
    assert.deepEqual(presses, [], "the blocked generation must not receive the submit key");
    events.push({
      index: 11,
      observation: {
        ...events[0].observation,
        ready: { handlerActive: true, inputBlocked: false },
      },
    });
  }, 20);

  await selectOptionById(client, {
    surfaceId: "option-select:TitlePhase",
    targetId,
    timeoutMs: 500,
    fromCursor: 10,
  });
  assert.deepEqual(presses, ["Space"]);
});
