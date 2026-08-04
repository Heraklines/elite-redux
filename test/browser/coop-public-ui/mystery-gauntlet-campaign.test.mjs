/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  assertAsymmetricAbilityProjection,
  assertAsymmetricBargainProjection,
  assertAsymmetricMysteryPromptProjection,
  assertAsymmetricRevivalProjection,
  assertAsymmetricStormglassProjection,
  assertMysteryFixtureParty,
  campaignBattleTurnBudget,
  chooseAbilityInteractionOption,
  chooseMysteryEncounterOption,
  chooseRevivalPartySlot,
  chooseRewardPartyActionOption,
  chooseRewardPartyTargetSlot,
  chooseStormglassOption,
  classifyRewardTargetApplyOutcome,
  createMysteryNarrationAdvancer,
  createRegisteredSurfaceProgressBudget,
  driveMysteryEncounterChoice,
  mechanicalBoundaryFromPairedSurfaces,
  pairedMysteryProjectionMatches,
  partyReorderPresentationMatches,
  resolveSurfaceOwner,
  restoredRewardRowMatches,
  retainedPartyEvolutionNeedsProgressBudget,
  retainStableWatcherSurfaceCursors,
  rewardCursorProjectionMatches,
  rewardPartyTargetCandidates,
  selectLatestMysteryAuthorityEvent,
} from "./campaign.mjs";
import {
  chooseAffordableStarterPair,
  chooseBestCampaignMove,
  chooseNavigationKey,
  chooseVoluntarySwitchTarget,
  driveBestCampaignMove,
  findLocalActionableIvScannerSurface,
  isPartyPickerSurfaceOpen,
  ownedReserveSwitchTargetIds,
  selectOptionById,
} from "./campaign-nav.mjs";
import { ABILITY_INTERACTION_SURFACES, buildDispatchTable, loadCampaignPolicy } from "./campaign-policy.mjs";
import {
  captureCheckpointPngWithFallback,
  checkpointPixelIntegrityFailure,
  checkpointRequiresGameplayCoverage,
} from "./evidence.mjs";
import { reachFirstCommand } from "./solo-classic.mjs";

const root = resolve(import.meta.dirname, "../../..");

test("Mystery interaction qualification proves its six level-100 fixture mons on both browsers", () => {
  const party = [
    { slot: 0, speciesId: 86, coopOwner: "host", level: 100, pauseEvolutions: true },
    { slot: 1, speciesId: 86, coopOwner: "guest", level: 100, pauseEvolutions: true },
    { slot: 2, speciesId: 351, coopOwner: "host", level: 100, pauseEvolutions: true },
    { slot: 3, speciesId: 351, coopOwner: "guest", level: 100, pauseEvolutions: true },
    { slot: 4, speciesId: 327, coopOwner: "host", level: 100, pauseEvolutions: true },
    { slot: 5, speciesId: 327, coopOwner: "guest", level: 100, pauseEvolutions: true },
  ];
  const records = [];
  const makeClient = label => ({
    label,
    evidence: {
      findLastSemanticSurface: () => ({
        observation: { operationClass: "command", address: { wave: 1 }, partySlots: party },
      }),
      record: (kind, detail) => records.push({ label, kind, detail }),
    },
  });
  const proof = assertMysteryFixtureParty(
    { clients: { host: makeClient("host-seat"), guest: makeClient("guest-seat") } },
    1,
  );
  assert.equal(proof.party.length, 6);
  assert.equal(records.filter(record => record.kind === "campaign-mystery-level100-party").length, 2);
});

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
      assert.equal(dispatch.find(driver => driver.name === "mystery-encounter")?.preferLastEnabledOption, true);
      const surfaces = dispatch.map(driver => driver.v2SurfaceId);
      assert.deepEqual(
        ["mystery-encounter", "mystery-encounter:prompt", "quiz", "bargain", "colosseum"].filter(
          surface => !surfaces.includes(surface),
        ),
        [],
      );
      // Track R cycle-11: a guest-owned `selectPokemonForOption` ME (PART_TIMER) opens a PARTY
      // sub-prompt with NO driver, stalling the mystery lane (run 29654429335). The dispatch now
      // carries an OWNER-ONLY mystery-party driver keyed off the plain `party` surface.
      const mysteryParty = dispatch.find(driver => driver.name === "mystery-party");
      assert.ok(mysteryParty != null, "dispatch must carry a mystery-party driver");
      assert.equal(mysteryParty.mysteryParty, true);
      assert.equal(mysteryParty.v2SurfaceId, "party");
      assert.equal(mysteryParty.phase, buildDispatchTable(policy).find(d => d.name === "mystery-encounter")?.phase);
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
      assert.deepEqual(
        dispatch
          .filter(driver =>
            ["mystery-subprompt", "mystery-quiz", "mystery-bargain", "mystery-colosseum"].includes(driver.name),
          )
          .map(driver => [driver.name, driver.semanticOnly]),
        [
          ["mystery-subprompt", true],
          ["mystery-quiz", true],
          ["mystery-bargain", true],
          ["mystery-colosseum", true],
        ],
        "mutually exclusive Mystery variants must register only from their exact semantic surface",
      );
      assert.deepEqual(
        dispatch
          .filter(driver => driver.name.startsWith("learn-move-"))
          .map(driver => [driver.name, driver.v2SurfaceId, driver.phase.source]),
        [
          ["learn-move-confirm", "learn-move:confirm", "Start Phase LearnMovePhase"],
          ["learn-move-batch", "learn-move-batch", "Start Phase LearnMoveBatchPhase"],
        ],
        "single-move confirmation and batch learning must never share a semantic surface policy",
      );
    },
  );
});

test("every registered ability phase has an exact semantic driver and input-inert watcher contract", async () => {
  const [observer, registry, regularCapsule, greaterCapsule, greaterRandomizer, dexNav] = await Promise.all([
    readFile(resolve(root, "scripts/coop-browser-entry.ts"), "utf8"),
    readFile(resolve(root, "src/data/elite-redux/coop/coop-operation-surface-registry.ts"), "utf8"),
    readFile(resolve(root, "src/phases/er-ability-capsule-phase.ts"), "utf8"),
    readFile(resolve(root, "src/phases/er-greater-ability-capsule-phase.ts"), "utf8"),
    readFile(resolve(root, "src/phases/er-greater-ability-randomizer-phase.ts"), "utf8"),
    readFile(resolve(root, "src/phases/er-dex-nav-phase.ts"), "utf8"),
  ]);
  const policy = loadCampaignPolicy();
  const dispatch = buildDispatchTable(policy);
  const expected = ABILITY_INTERACTION_SURFACES.flatMap(({ phase, kinds }) =>
    kinds.map(kind => `ability:${phase}:${kind}`),
  );
  assert.deepEqual(
    dispatch.filter(driver => driver.abilitySurface).map(driver => driver.v2SurfaceId),
    expected,
    "one dispatch entry must exist for every human-visible ability surface shape",
  );
  for (const { phase } of ABILITY_INTERACTION_SURFACES) {
    assert.match(registry, new RegExp(`"${phase}"`, "u"), `${phase} must remain in the production registry`);
    assert.match(observer, new RegExp(`"${phase}"`, "u"), `${phase} must remain in the browser observer`);
  }
  assert.match(observer, /semantic\.operationClass === "ability"[\s\S]*candidate = phase\.coopSeq/u);
  assert.match(observer, /interactionTargetPartySlot/u);
  assert.match(observer, /coopV2SurfaceGeneration/u);
  for (const [phase, source] of [
    ["ErAbilityCapsulePhase", regularCapsule],
    ["ErGreaterAbilityCapsulePhase", greaterCapsule],
    ["ErGreaterAbilityRandomizerPhase", greaterRandomizer],
    ["ErDexNavPhase", dexNav],
  ]) {
    assert.match(
      source,
      /if \(this\.coopIsWatcher\) \{[\s\S]*?setMode\(UiMode\.MESSAGE\)[\s\S]*?notifyCoopV2InteractionSurfaceReady/u,
      `${phase} watcher must install its passive MESSAGE handler before publishing V2 control readiness`,
    );
  }
});

test("ability owner/watcher proof rejects a second input seat or divergent mechanical state", () => {
  const owner = {
    surfaceId: "ability:ErAbilityCapsulePhase:option",
    operationClass: "ability",
    phase: "ErAbilityCapsulePhase",
    uiMode: "OPTION_SELECT",
    localSeat: 1,
    ownerSeat: 1,
    seatsWithInput: [1],
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: false },
    address: { epoch: 7, wave: 3, turn: 1 },
    stateDigest: "same-state",
    interactionTargetPartySlot: 2,
  };
  const watcher = {
    ...owner,
    surfaceId: "ability:ErAbilityCapsulePhase:message",
    uiMode: "MESSAGE",
    localSeat: 0,
    ready: { handlerActive: true, awaitingActionInput: false, inputBlocked: true },
  };
  assert.deepEqual(assertAsymmetricAbilityProjection(owner, watcher), {
    surfaceId: owner.surfaceId,
    watcherSurfaceId: watcher.surfaceId,
    phase: owner.phase,
    address: owner.address,
    stateDigest: owner.stateDigest,
    ownerSeat: 1,
    watcherSeat: 0,
    interactionTargetPartySlot: 2,
  });
  assert.throws(
    () => assertAsymmetricAbilityProjection(owner, { ...watcher, seatsWithInput: [0, 1] }),
    /input-inert ability watcher/u,
  );
  assert.throws(
    () => assertAsymmetricAbilityProjection(owner, { ...watcher, stateDigest: "different" }),
    /different authoritative states/u,
  );
});

test("ability party driver targets the phase-owned mon and a stable ability slot", () => {
  assert.equal(
    chooseAbilityInteractionOption({
      phase: "ErAbilityCapsulePhase",
      selectedOptionId: "slot:0",
      optionIds: ["slot:0", "slot:1", "slot:2"],
    }),
    "slot:0",
    "top-level capsule choices must be retained as exact public-driver evidence",
  );
  assert.equal(
    chooseAbilityInteractionOption({
      phase: "ErGreaterAbilityCapsulePhase",
      selectedOptionId: "slot:0",
      optionIds: ["slot:0", "slot:1", "slot:2"],
    }),
    "slot:1",
    "the Greater Capsule journey must choose its run-material branch instead of an account-only permanent unlock",
  );
  assert.equal(
    chooseAbilityInteractionOption({
      phase: "ErGreaterAbilityCapsulePhase",
      interactionTargetPartySlot: 2,
      optionIds: ["party-slot:0", "party-slot:1", "party-slot:2"],
    }),
    "party-slot:2",
  );
  assert.equal(
    chooseAbilityInteractionOption({
      phase: "ErGreaterAbilityCapsulePhase",
      selectedOptionId: "party-option:ability-slot-0",
      optionIds: ["party-option:ability-slot-0", "party-option:ability-slot-1", "party-option:ability-slot-2"],
    }),
    "party-option:ability-slot-1",
    "capsules prefer a locked innate over the active slot",
  );
  assert.equal(
    chooseAbilityInteractionOption({
      phase: "ErGreaterAbilityRandomizerPhase",
      selectedOptionId: "party-option:ability-slot-1",
      optionIds: ["party-option:ability-slot-0", "party-option:ability-slot-1"],
    }),
    "party-option:ability-slot-0",
    "the randomizer accepts any slot and deterministically uses the active slot first",
  );
  assert.equal(
    chooseAbilityInteractionOption(
      {
        phase: "ErGreaterAbilityCapsulePhase",
        selectedOptionId: "party-option:ability-slot-1",
        optionIds: ["party-option:ability-slot-0", "party-option:ability-slot-1", "party-option:ability-slot-2"],
      },
      new Set(["slot:1", "party-option:ability-slot-1"]),
    ),
    "party-option:ability-slot-2",
    "the Greater Capsule run branch must choose a distinct second locked innate",
  );
  assert.equal(
    chooseAbilityInteractionOption(
      {
        phase: "ErDexNavPhase",
        selectedOptionId: "slot:0",
        optionIds: ["slot:0", "slot:1", "slot:2"],
      },
      new Set(["slot:0"]),
    ),
    "slot:1",
    "Dex Nav must choose a different visible ability on its second pass",
  );
});

test("Revival and Stormglass have stable-owner public drivers instead of generic local surfaces", async () => {
  const [observer, registry, revivalPhase, guestRevivalPhase, stormglassPhase] = await Promise.all([
    readFile(resolve(root, "scripts/coop-browser-entry.ts"), "utf8"),
    readFile(resolve(root, "src/data/elite-redux/coop/coop-operation-surface-registry.ts"), "utf8"),
    readFile(resolve(root, "src/phases/revival-blessing-phase.ts"), "utf8"),
    readFile(resolve(root, "src/phases/coop-guest-revival-phase.ts"), "utf8"),
    readFile(resolve(root, "src/phases/er-stormglass-picker-phase.ts"), "utf8"),
  ]);
  const dispatch = buildDispatchTable(loadCampaignPolicy());
  assert.deepEqual(
    dispatch
      .filter(driver => driver.asymmetricSurface === "revival" || driver.asymmetricSurface === "stormglass")
      .map(driver => [driver.name, driver.v2SurfaceId, driver.watcherSurfaceId]),
    [
      ["revival", "revival:party", "revival:party"],
      ["stormglass-message", "stormglass:message", "stormglass:message"],
      ["stormglass-option", "stormglass:option", "stormglass:message"],
    ],
  );
  assert.match(registry, /REVIVAL:[\s\S]*UiMode\.PARTY[\s\S]*"RevivalBlessingPhase"[\s\S]*"CoopGuestRevivalPhase"/u);
  assert.match(registry, /STORMGLASS_PRESENT:[\s\S]*UiMode\.OPTION_SELECT[\s\S]*UiMode\.MESSAGE/u);
  assert.match(observer, /surfaceId: "revival:party", operationClass: "revival", ownerModel: "interaction"/u);
  assert.match(observer, /surfaceId: `stormglass:\$\{uiMode === "MESSAGE" \? "message" : "option"\}`/u);
  assert.match(observer, /semantic\.operationClass === "stormglass"[\s\S]*return "host"/u);
  assert.match(observer, /phase\.ownerIsGuest === true[\s\S]*return "guest"/u);
  assert.match(observer, /phase\.user\?\.coopOwner === "guest" \? "guest" : "host"/u);
  assert.match(revivalPhase, /this\.user\.coopOwner[\s\S]*startCoopPartnerPick\(\)/u);
  assert.match(guestRevivalPhase, /this\.ownerIsGuest[\s\S]*PartyUiMode\.REVIVAL_BLESSING/u);
  assert.match(stormglassPhase, /this\.coopOwner = spoofed \|\| controller\.role === "host"/u);
});

test("Revival and Stormglass projection proofs reject actionable watchers and choose visible targets", () => {
  const base = {
    localSeat: 1,
    ownerSeat: 1,
    seatsWithInput: [1],
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: false },
    address: { epoch: 9, wave: 4, turn: 2 },
    stateDigest: "same-state",
  };
  const revivalOwner = {
    ...base,
    surfaceId: "revival:party",
    operationClass: "revival",
    phase: "CoopGuestRevivalPhase",
    uiMode: "PARTY",
    optionIds: ["party-slot:0", "party-slot:1", "party-slot:2"],
    partySlots: [
      { slot: 0, fainted: false },
      { slot: 1, fainted: true },
      { slot: 2, fainted: false },
    ],
  };
  const revivalWatcher = {
    ...revivalOwner,
    phase: "RevivalBlessingPhase",
    localSeat: 0,
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: true },
  };
  assert.equal(chooseRevivalPartySlot(revivalOwner), "party-slot:1");
  assert.equal(isPartyPickerSurfaceOpen(revivalOwner), true);
  assert.equal(assertAsymmetricRevivalProjection(revivalOwner, revivalWatcher).ownerSeat, 1);
  assert.throws(
    () =>
      assertAsymmetricRevivalProjection(revivalOwner, {
        ...revivalWatcher,
        ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: false },
      }),
    /input-inert watcher/u,
  );

  const stormglassOwner = {
    ...base,
    surfaceId: "stormglass:option",
    operationClass: "stormglass",
    phase: "ErStormglassPickerPhase",
    uiMode: "OPTION_SELECT",
    optionIds: ["slot:0", "slot:1", "slot:2", "slot:3", "slot:4"],
  };
  const stormglassWatcher = {
    ...stormglassOwner,
    surfaceId: "stormglass:message",
    localSeat: 0,
    uiMode: "MESSAGE",
    ready: { handlerActive: true, awaitingActionInput: false, inputBlocked: true },
  };
  assert.equal(chooseStormglassOption(stormglassOwner), "slot:0");
  assert.equal(assertAsymmetricStormglassProjection(stormglassOwner, stormglassWatcher).watcherSeat, 0);
  assert.throws(
    () => assertAsymmetricStormglassProjection(stormglassOwner, { ...stormglassWatcher, stateDigest: "different" }),
    /different authoritative states/u,
  );
});

test("the IV scanner is actionable only as this browser's exact local presentation prompt", () => {
  let event = {
    index: 41,
    observation: {
      surfaceId: "confirm:ScanIvsPhase",
      operationClass: "confirm",
      ownerModel: "local",
      phase: "ScanIvsPhase",
      uiMode: "CONFIRM",
      localSeat: 1,
      ownerSeat: null,
      seatsWithInput: [1],
      optionIds: ["yes", "no"],
      selectedOptionId: "yes",
      ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: false },
    },
  };
  let latest = event;
  const client = {
    publicSeat: 1,
    evidence: {
      findLastSemanticSurface: (_from, surfaceId) => (surfaceId === "confirm:ScanIvsPhase" ? event : latest),
    },
  };

  assert.equal(findLocalActionableIvScannerSurface(client), event);
  event = {
    ...event,
    observation: { ...event.observation, ready: { ...event.observation.ready, inputBlocked: true } },
  };
  latest = event;
  assert.equal(findLocalActionableIvScannerSurface(client), null);
  event = {
    ...event,
    observation: { ...event.observation, ready: { ...event.observation.ready, inputBlocked: false } },
  };
  latest = { index: 42, observation: { surfaceId: "battle:message" } };
  assert.equal(findLocalActionableIvScannerSurface(client), null);
});

test("local presentation input has one registry shared by production and the two-browser oracle", async () => {
  const [registry, gate, ui, observer, policy, campaign] = await Promise.all(
    [
      "src/data/elite-redux/coop/coop-local-presentation-input.ts",
      "src/data/elite-redux/coop/coop-renderer-gate.ts",
      "src/ui/ui.ts",
      "scripts/coop-browser-entry.ts",
      "test/browser/coop-public-ui/campaign-policy.mjs",
      "test/browser/coop-public-ui/campaign.mjs",
    ].map(path => readFile(resolve(root, path), "utf8")),
  );
  assert.match(registry, /COOP_LOCAL_PRESENTATION_INPUT_PHASES[\s\S]*"ScanIvsPhase"/u);
  assert.match(
    registry,
    /COOP_LOCAL_PRESENTATION_INPUT_SURFACES[\s\S]*"EvolutionPhase"[\s\S]*"CoopWaveProgressionReplayPhase"[\s\S]*"FormChangePhase"[\s\S]*"CoopFormChangeCutsceneReplayPhase"[\s\S]*"EVOLUTION_SCENE"/u,
  );
  assert.match(gate, /\.\.\.COOP_LOCAL_PRESENTATION_INPUT_PHASES/u);
  assert.match(
    ui,
    /localPresentationInput = isCoopLocalPresentationInputSurface[\s\S]*UiMode\[this\.mode\][\s\S]*localOverlayInput = coopLocalOverlayInputAllowed\(this\.mode, this\.modeChain\)[\s\S]*!hostEngineDialogueAdvance[\s\S]*!localPresentationInput[\s\S]*!localOverlayInput/u,
  );
  assert.match(
    observer,
    /case "CONFIRM":[\s\S]*isCoopLocalPresentationInputSurface\(phase, uiMode\)[\s\S]*ownerModel: "local"/u,
  );
  assert.match(
    observer,
    /localOverlayInput = coopLocalOverlayInputAllowed\(ui\.getMode\(\), ui\.getModeChain\(\)\)[\s\S]*v2InputFrozen[\s\S]*&& !localPresentationInput[\s\S]*&& !localOverlayInput/u,
  );
  assert.match(policy, /name: "iv-scanner"[\s\S]*localPerClientSurface: true/u);
  assert.match(campaign, /if \(driver\.localPerClientSurface\)[\s\S]*findLocalActionableIvScannerSurface/u);
  assert.match(campaign, /targetId: "no"[\s\S]*campaign-local-presentation/u);
  assert.match(campaign, /driver\.localPerClientSurface \? \[client\] : Object\.values\(rig\.clients\)/u);
});

test("a chained Mystery gauntlet refreshes only from proven surface progress and remains hard-bounded", () => {
  let now = 1_000;
  const budget = createRegisteredSurfaceProgressBudget(9_000, 3_000, 2, { now: () => now });
  assert.equal(budget.deadline(), 10_000);
  assert.equal(budget.hardDeadline(), 16_000);

  // Early progress cannot shrink or gratuitously inflate the existing base window.
  now = 4_000;
  assert.equal(budget.noteProgress().extensionApplied, false);
  assert.equal(budget.deadline(), 10_000);

  // A real public action near the boundary grants one normal surface allowance.
  now = 9_000;
  assert.equal(budget.noteProgress().extensionApplied, true);
  assert.equal(budget.deadline(), 12_000);

  // Repeated progress can never cross the immutable coverage-derived ceiling.
  now = 15_000;
  const capped = budget.noteProgress();
  assert.equal(capped.deadlineMs, 16_000);
  assert.equal(capped.hardCeilingReached, true);
  now = 30_000;
  assert.equal(budget.noteProgress().deadlineMs, 16_000);
});

test("workflow builds the staging-only fifth difficulty and fans a configurable ten-wave-default profile", async () => {
  const [workflow, registry, starterCosts, starterHandler, starterPhase, harness, campaign, battleScene] =
    await Promise.all([
      readFile(resolve(root, ".github/workflows/coop-public-ui-campaign.yml"), "utf8"),
      readFile(resolve(root, "src/dev-tools/registry.ts"), "utf8"),
      readFile(resolve(root, "src/data/balance/starters.ts"), "utf8"),
      readFile(resolve(root, "src/ui/handlers/starter-select-ui-handler.ts"), "utf8"),
      readFile(resolve(root, "src/phases/select-starter-phase.ts"), "utf8"),
      readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8"),
      readFile(resolve(root, "test/browser/coop-public-ui/campaign.mjs"), "utf8"),
      readFile(resolve(root, "src/battle-scene.ts"), "utf8"),
    ]);
  assert.match(workflow, /VITE_DEV_TOOLS: 1/u);
  assert.match(workflow, /VITE_COOP_BROWSER_FIXTURE: campaign-survival/u);
  assert.match(
    workflow,
    /Drive two isolated built clients through the \$\{\{ matrix\.profile \}\} campaign[\s\S]*COOP_UI_JOURNEY: campaign/u,
    "the campaign process must not silently inherit the generic probe journey identity",
  );
  assert.match(
    workflow,
    /COOP_UI_EXPECT_RECLAIM: \$\{\{ matrix\.dirty_accounts == '1' && '1' \|\| '0' \}\}/u,
    "the seeded dirty-account lane must activate its reclaim proof and suppress the clean depth fixture",
  );
  assert.match(
    await readFile(resolve(root, "test/browser/coop-public-ui/config.mjs"), "utf8"),
    /const allowedJourneys = new Set\(\[[\s\S]*"campaign"/u,
    "the explicit campaign runtime identity must be accepted by shared browser config",
  );
  assert.match(
    registry,
    /isCoopBrowserCampaignFixtureBuild\(\)[\s\S]*VITE_COOP_BROWSER_FIXTURE === "campaign-survival"[\s\S]*isCoopBrowserCampaignFixtureActive\(\)[\s\S]*fixture === "campaign-survival" \|\| fixture === "campaign-party"[\s\S]*getCoopBrowserCampaignFixtureStarters\(\)[\s\S]*SpeciesId\.SEEL[\s\S]*SpeciesId\.CASTFORM[\s\S]*SpeciesId\.SPINDA/u,
  );
  assert.match(
    registry,
    /getCoopBrowserLongitudinalFixtureStartingLevel\(\)[\s\S]*isCoopBrowserCampaignSurvivalFixtureActive\(\)[\s\S]*\? 100[\s\S]*: null/u,
    "the interaction-only Mystery journey cannot randomly wipe before its wave-10 authority boundary",
  );
  assert.match(
    registry,
    /shouldPauseCoopBrowserLongitudinalFixtureEvolutions\(\)[\s\S]*isCoopBrowserCampaignSurvivalFixtureActive\(\)[\s\S]*isCoopBrowserNavigationFixtureActive\(\)/u,
    "survival and navigation fixtures pause incidental evolutions without weakening the dedicated proof lane",
  );
  for (const species of ["SEEL", "CASTFORM", "SPINDA"]) {
    assert.match(
      starterCosts,
      new RegExp(`\\[SpeciesId\\.${species}\\]: 1,`, "u"),
      `${species} must remain a one-point starter so the three-mon fixture fits one co-op seat's five-point limit`,
    );
  }
  assert.match(starterHandler, /getCoopBrowserCampaignFixtureStarters\(\)/u);
  assert.match(
    starterPhase,
    /const fixturePauseEvolutions = shouldPauseCoopBrowserLongitudinalFixtureEvolutions\(\)[\s\S]*this\.initBattle\(merged, true, owners, undefined, fixtureStartingLevels, fixturePauseEvolutions\)/u,
  );
  assert.match(
    starterPhase,
    /if \(pauseEvolutions\)[\s\S]*starterPokemon\.pauseEvolutions = true/u,
    "the level-100 fixture must not manufacture post-wave evolution coverage",
  );
  assert.match(
    harness,
    /renderProfile === "mystery-gauntlet"[\s\S]*difficultyId === "mystery"[\s\S]*set\("coopfixture", "campaign-survival"\)/u,
  );
  assert.match(harness, /campaignSurvivalFixture[\s\S]*SEEL_SPECIES_ID, CASTFORM_SPECIES_ID, SPINDA_SPECIES_ID/u);
  assert.match(campaign, /assertMysteryFixtureParty\(rig, 1\)[\s\S]*mystery fixture level-100 parties proven/u);
  assert.match(
    harness,
    /journey === "campaign"[\s\S]*renderProfile === "animations-skipped-depth"[\s\S]*!this\.config\.expectReclaim[\s\S]*set\("coopfixture", "campaign-party"\)/u,
    "the normal-level depth roster must be exact-build, exact-profile, and clean-account gated",
  );
  assert.match(
    campaign,
    /const useDepthPartyFixture =[\s\S]*rig\.config\.journey === "campaign"[\s\S]*!rig\.config\.expectReclaim[\s\S]*campaignSurvivalFixture: policy\.mysteryGauntlet\.required \|\| useDepthPartyFixture[\s\S]*assertDepthFixtureParty\(rig, 1\)[\s\S]*depth fixture normal-level six-mon party proven/u,
    "the short depth lane must visibly confirm and then attest its six normal-level starters",
  );
  assert.match(
    campaign,
    /assertDepthFixtureParty[\s\S]*party\.length !== 6[\s\S]*slot\.level >= 100[\s\S]*slot\.pauseEvolutions === true/u,
    "the depth fixture must reject level-100 or evolution-paused material",
  );
  assert.match(
    campaign,
    /requireExp:[\s\S]*policy\.navigation\.required[\s\S]*policy\.market\.requiredPurchases > 0[\s\S]*policy\.mysteryGauntlet\.required[\s\S]*policy\.registeredInteractions\.required/u,
    "level-100 navigation, market, Mystery, and registered-interaction fixtures must not invent an EXP cue",
  );
  assert.match(
    battleScene,
    /isFixedBattle\(waveIndex\) && !erGauntletActive\(\)[\s\S]*handleFixedBattle\(resolved\)[\s\S]*handleNonFixedBattle\(resolved\)/u,
    "the scripted Mystery schedule must own fixed Classic wave slots such as wave 5",
  );
  assert.match(
    workflow,
    /mystery_waves:\s+description: [^\n]+\s+required: false\s+type: string\s+default: "10"/u,
    "manual and milestone dispatches default to the full ten-wave Mystery journey",
  );
  assert.match(
    workflow,
    /MYSTERY_WAVES: \$\{\{ inputs\.mystery_waves \|\| '10' \}\}[\s\S]*--arg mysteryWaves "\$MYSTERY_WAVES"[\s\S]*profile: "mystery-gauntlet", artifact: "mystery", waves: \$mysteryWaves,\s+difficulty: "mystery", difficulty_option: "mystery", require_mystery: "1"/u,
    "the dynamic Mystery matrix consumes the dispatch control while push and schedule retain ten waves",
  );
  assert.match(workflow, /COOP_UI_DIFFICULTY_ID: \$\{\{ matrix\.difficulty \}\}/u);
  assert.match(workflow, /COOP_UI_DIFFICULTY_OPTION_ID: \$\{\{ matrix\.difficulty_option \}\}/u);
  assert.match(workflow, /COOP_UI_REQUIRE_MYSTERY_GAUNTLET: \$\{\{ matrix\.require_mystery \}\}/u);
  assert.match(workflow, /profile: "mystery-gauntlet"[\s\S]{0,700}?reward_mode: "pick-first"/u);
  assert.match(workflow, /campaign_profile:[\s\S]*- mystery/u, "mystery-only diagnosis is directly dispatchable");
});

test("Mystery qualification keeps one visual proof without screenshotting every checkpoint shape", async () => {
  const [campaign, config] = await Promise.all([
    readFile(resolve(root, "test/browser/coop-public-ui/campaign.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/config.mjs"), "utf8"),
  ]);
  assert.match(config, /renderProfile === "animations-on-surface"/u);
  assert.match(
    config,
    /difficultyOptionId,[\s\S]*renderProfile,[\s\S]*locales:/u,
    "the parsed render profile must reach PublicUiClient.open before its first immutable URL is built",
  );
  assert.match(
    campaign,
    /const firstMysteryVisualProof = stage === "presentation" && stats\.mysteryEvents\.length === 0/u,
  );
  assert.match(campaign, /client\.checkpoint\([\s\S]*\{ full: firstMysteryVisualProof \}/u);
});

test("Mystery gauntlet picks the visible safe exit while normal play preserves the first enabled choice", () => {
  const observation = {
    optionIds: [
      "mystery-option:0:disabled",
      "mystery-option:1:enabled",
      "mystery-option:2:enabled",
      "mystery-action:view-party",
    ],
  };
  assert.equal(chooseMysteryEncounterOption(observation, false), "mystery-option:1:enabled");
  assert.equal(chooseMysteryEncounterOption(observation, true), "mystery-option:2:enabled");
});

test("campaign fight policy prefers a usable damaging move and follows the visible two-column grid", () => {
  const observation = {
    surfaceId: "command:fight",
    selectedOptionId: "move:45:slot:0",
    optionIds: ["move:45:slot:0", "move:33:slot:1", "move:74:slot:2", "move:22:slot:3"],
    moveSlots: [
      { index: 0, optionId: "move:45:slot:0", moveId: 45, power: 0, category: "STATUS", usable: true },
      { index: 1, optionId: "move:33:slot:1", moveId: 33, power: 40, category: "PHYSICAL", usable: true },
      { index: 2, optionId: "move:74:slot:2", moveId: 74, power: 0, category: "STATUS", usable: true },
      { index: 3, optionId: "move:22:slot:3", moveId: 22, power: 45, category: "PHYSICAL", usable: true },
    ],
  };

  const best = chooseBestCampaignMove(observation);
  assert.equal(best?.optionId, "move:22:slot:3");
  assert.equal(
    chooseBestCampaignMove(observation, 1)?.optionId,
    "move:33:slot:1",
    "later rounds try the next observer-proven damaging move instead of repeating an immunity forever",
  );
  assert.equal(
    chooseBestCampaignMove(observation, 2)?.optionId,
    "move:22:slot:3",
    "the damaging-move policy cycles deterministically",
  );
  assert.equal(
    chooseBestCampaignMove(observation, 0, 74)?.optionId,
    "move:74:slot:2",
    "an exact interaction fixture may request one observer-proven usable status move",
  );
  assert.equal(
    chooseBestCampaignMove(
      {
        ...observation,
        moveSlots: observation.moveSlots.map(slot => (slot.moveId === 74 ? { ...slot, usable: false } : slot)),
      },
      0,
      74,
    )?.optionId,
    "move:22:slot:3",
    "an exhausted preferred move falls back to the ordinary strongest usable move",
  );
  assert.equal(
    chooseNavigationKey(observation, best.optionId, ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"], 0),
    "ArrowDown",
  );
  assert.equal(
    chooseNavigationKey(
      { ...observation, selectedOptionId: "move:74:slot:2" },
      best.optionId,
      ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"],
      1,
    ),
    "ArrowRight",
  );
  assert.equal(
    chooseNavigationKey(
      {
        surfaceId: "command:command",
        selectedOptionId: "command:ball",
        optionIds: ["command:fight", "command:ball", "command:pokemon", "command:run"],
      },
      "command:fight",
      ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"],
      0,
    ),
    "ArrowLeft",
    "a remembered Ball cursor must visibly return to Fight instead of submitting Ball",
  );

  withEnvironment({ COOP_UI_BATTLE_KEYS: "" }, () => {
    assert.equal(loadCampaignPolicy().keys.battleKeysFromEnv, false);
  });
  withEnvironment({ COOP_UI_BATTLE_KEYS: '["Space","ArrowRight","Space"]' }, () => {
    const policy = loadCampaignPolicy();
    assert.equal(policy.keys.battleKeysFromEnv, true);
    assert.deepEqual(policy.keys.battle, ["Space", "ArrowRight", "Space"]);
  });
});

test("reward navigation treats the visible reward carousel as one horizontal axis", () => {
  const observation = {
    surfaceId: "reward-shop",
    selectedOptionId: "ER_OMNI_GEM",
    optionIds: ["ER_OMNI_GEM", "POKEBALL", "BERRY"],
  };
  assert.equal(
    chooseNavigationKey(observation, "BERRY", ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"], 0),
    "ArrowLeft",
    "three rewards must reach the wrap-around third card instead of oscillating between cards zero and one",
  );
});

test("reward cursor projection requires the watcher's exact addressed visual selection", () => {
  const authority = {
    surfaceId: "reward-shop",
    address: { epoch: 12, wave: 1, turn: 3 },
    stateDigest: "cursor-on-capsule",
    localSeat: 0,
    ownerSeat: 0,
    seatsWithInput: [0],
    selectedOptionId: "ER_ABILITY_CAPSULE",
    optionIds: ["POKEBALL", "ER_ABILITY_CAPSULE"],
    ready: { handlerActive: true, inputBlocked: false },
  };
  const watcher = {
    ...authority,
    localSeat: 1,
    ready: { handlerActive: true, inputBlocked: false },
  };
  assert.equal(rewardCursorProjectionMatches(authority, watcher), true);
  assert.equal(
    rewardCursorProjectionMatches(authority, { ...watcher, selectedOptionId: "POKEBALL" }),
    false,
    "the initial watcher card cannot satisfy proof after the owner moved to the capsule",
  );
  assert.equal(
    rewardCursorProjectionMatches(authority, { ...watcher, address: { ...watcher.address, wave: 2 } }),
    false,
    "a matching card at another reward address is stale evidence",
  );
  assert.equal(
    rewardCursorProjectionMatches(authority, { ...watcher, seatsWithInput: [1] }),
    false,
    "a second actionable cursor is not a cosmetic watcher projection",
  );
});

test("Check Team reorder proof requires both party order and an atomically ready visible field", () => {
  const expectedPartyIds = [303, 202, 101, 404];
  const ready = {
    partySlots: expectedPartyIds.map(pokemonId => ({ pokemonId })),
    presentation: {
      expectedPlayerFieldIds: [303, 202],
      playerFieldReady: true,
      playerField: [
        {
          pokemonId: 303,
          visible: true,
          alpha: 1,
          spriteVisible: true,
          spriteAlpha: 1,
          infoVisible: true,
          infoAlpha: 1,
        },
        {
          pokemonId: 202,
          visible: true,
          alpha: 1,
          spriteVisible: true,
          spriteAlpha: 1,
          infoVisible: true,
          infoAlpha: 1,
        },
      ],
    },
  };
  assert.equal(partyReorderPresentationMatches(ready, expectedPartyIds), true);
  assert.equal(
    partyReorderPresentationMatches(
      {
        ...ready,
        presentation: {
          ...ready.presentation,
          playerFieldReady: false,
          playerField: ready.presentation.playerField.map(field => ({ ...field, visible: false })),
        },
      },
      expectedPartyIds,
    ),
    false,
    "mechanical party convergence cannot hide a blank active field",
  );
  assert.equal(
    partyReorderPresentationMatches(
      { ...ready, partySlots: [{ pokemonId: 101 }, ...ready.partySlots.slice(1)] },
      expectedPartyIds,
    ),
    false,
    "visible field convergence cannot hide a stale party order",
  );
});

test("Check Team return reuses only the watcher's proven stable post-reorder surface", () => {
  const returnCursors = { owner: 40, watcher: 50 };
  const postReorderCursors = { owner: 20, watcher: 30 };
  assert.deepEqual(retainStableWatcherSurfaceCursors(returnCursors, postReorderCursors, ["watcher"]), {
    owner: 40,
    watcher: 30,
  });
  assert.throws(
    () => retainStableWatcherSurfaceCursors(returnCursors, {}, ["watcher"]),
    /watcher has no stable watcher cursor/u,
  );
});

test("Check Team return does not mistake its transient action row for the retained reward cards", () => {
  const address = { epoch: 19, wave: 4, turn: 2 };
  const base = {
    surfaceId: "reward-shop",
    address,
    ready: { handlerActive: true, inputBlocked: false },
  };
  assert.equal(
    restoredRewardRowMatches(
      {
        ...base,
        selectedOptionId: "reward-action:check-team",
        optionIds: ["reward-action:reroll", "reward-action:check-team"],
      },
      ["POKEBALL", "ER_GREATER_ABILITY_RANDOMIZER"],
      address,
    ),
    false,
  );
  assert.equal(
    restoredRewardRowMatches(
      { ...base, selectedOptionId: "POKEBALL", optionIds: ["POKEBALL", "ER_GREATER_ABILITY_RANDOMIZER"] },
      ["POKEBALL", "ER_GREATER_ABILITY_RANDOMIZER"],
      address,
    ),
    true,
  );
});

test("Greater Ability Randomizer policy mandates the public Check Team reorder journey", () => {
  withEnvironment({ COOP_UI_PARTY_REWARD_ID: "ER_GREATER_ABILITY_RANDOMIZER" }, () => {
    assert.equal(loadCampaignPolicy().partyMutatingReward.checkTeamReorder, true);
  });
  withEnvironment({ COOP_UI_PARTY_REWARD_ID: "ER_ABILITY_CAPSULE" }, () => {
    assert.equal(loadCampaignPolicy().partyMutatingReward.checkTeamReorder, false);
  });
});

test("ordinary campaign turns keep the strongest visible move instead of weakening by turn number", async () => {
  const campaign = await readFile(resolve(root, "test/browser/coop-public-ui/campaign.mjs"), "utf8");
  assert.doesNotMatch(
    campaign,
    /cycleIndex:\s*turn\s*-\s*1/u,
    "a later battle turn is not evidence that the strongest move failed or hit an immunity",
  );
  assert.match(
    campaign,
    /driveBestCampaignMove\(client, commandPurpose, \{[\s\S]*?commandEvent,[\s\S]*?preferredMoveId:/u,
  );
  assert.match(
    campaign,
    /const cycleCampaignMoves =[\s\S]*policy\.navigation\.required[\s\S]*policy\.market\.requiredPurchases > 0[\s\S]*policy\.mysteryGauntlet\.required[\s\S]*cycleIndex: cycleCampaignMoves \? turn - 1 : 0/u,
    "longitudinal and Mystery fixtures rotate their proven damaging moves instead of repeating an immunity",
  );
});

test("a mechanically progressing Mystery battle is not mislabeled a softlock on turn thirteen", () => {
  assert.equal(campaignBattleTurnBudget(12, { mysteryGauntlet: { required: true } }), 30);
  assert.equal(
    campaignBattleTurnBudget(12, { mysteryGauntlet: { required: false } }),
    12,
    "ordinary fast campaigns retain the stricter runaway-battle signal",
  );
});

test("a semantic-only Bargain owner may advance to narration while its watcher retains the frozen offer", () => {
  const event = (index, observation) => ({ index, kind: "browser-surface2", observation });
  const evidence = events => ({
    events,
    findLastSemanticSurface(from = 0, surfaceId = null) {
      return this.events
        .slice(from)
        .toReversed()
        .find(
          candidate =>
            candidate.kind === "browser-surface2"
            && (surfaceId == null || candidate.observation.surfaceId === surfaceId),
        );
    },
  });
  const address = { epoch: 17, wave: 9, turn: 1 };
  const owner = {
    label: "owner",
    publicSeat: 0,
    evidence: evidence([
      event(0, {
        surfaceId: "bargain",
        localSeat: 0,
        ownerSeat: 0,
        address,
        ready: { handlerActive: true, inputBlocked: false },
      }),
      event(1, {
        surfaceId: "mystery-encounter:message",
        localSeat: 0,
        ownerSeat: 0,
        address,
        ready: { handlerActive: true, awaitingActionInput: true },
      }),
    ]),
  };
  const watcher = {
    label: "watcher",
    publicSeat: 1,
    evidence: evidence([
      event(0, {
        surfaceId: "bargain",
        localSeat: 1,
        ownerSeat: 0,
        address,
        ready: { handlerActive: true, inputBlocked: true },
      }),
    ]),
  };
  const driver = {
    name: "mystery-bargain",
    v2SurfaceId: "bargain",
    semanticOnly: true,
  };

  assert.doesNotThrow(() =>
    resolveSurfaceOwner({ clients: { owner, watcher } }, driver, { owner: 0, watcher: 0 }, new Map(), true),
  );
  assert.equal(
    resolveSurfaceOwner({ clients: { owner, watcher } }, driver, { owner: 0, watcher: 0 }, new Map(), true),
    null,
    "the completed Bargain picker is no longer a pending owner control",
  );
});

test("campaign switch policy chooses only the acting seat's meaningfully healthier reserve", () => {
  const observation = {
    surfaceId: "command:command",
    localRole: "guest",
    partySlots: [
      { slot: 0, coopOwner: "host", active: true, fainted: false, hp: 4, maxHp: 20, allowedInBattle: true },
      { slot: 1, coopOwner: "guest", active: true, fainted: false, hp: 6, maxHp: 20, allowedInBattle: true },
      { slot: 2, coopOwner: "host", active: false, fainted: false, hp: 20, maxHp: 20, allowedInBattle: true },
      { slot: 3, coopOwner: "guest", active: false, fainted: false, hp: 18, maxHp: 20, allowedInBattle: true },
    ],
  };
  assert.equal(chooseVoluntarySwitchTarget(observation), "party-slot:3");
  assert.deepEqual(ownedReserveSwitchTargetIds(observation), ["party-slot:3"]);
  assert.equal(
    chooseVoluntarySwitchTarget({
      ...observation,
      partySlots: observation.partySlots.map(slot => (slot.slot === 1 ? { ...slot, hp: 14 } : slot)),
    }),
    null,
    "a healthy active must not be swapped merely to generate switch coverage",
  );
  assert.equal(
    chooseVoluntarySwitchTarget({
      ...observation,
      partySlots: observation.partySlots.map(slot => (slot.slot === 3 ? { ...slot, hp: 8 } : slot)),
    }),
    null,
    "a marginal reserve must not cause low-HP switch thrashing",
  );
});

test("campaign move driving semantically selects Fight instead of assuming the remembered command cursor", async () => {
  const navigation = await readFile(resolve(root, "test/browser/coop-public-ui/campaign-nav.mjs"), "utf8");
  const start = navigation.indexOf("export async function driveBestCampaignMove");
  const end = navigation.indexOf("\n}\n\n/** Wait until", start);
  const drive = navigation.slice(start, end);

  assert.ok(start >= 0 && end > start, "the campaign move driver is present");
  assert.match(drive, /chooseVoluntarySwitchTarget\(command\.observation\)/u);
  assert.match(drive, /driveCampaignVoluntarySwitch\(client, command, switchTarget, purpose, timeoutMs\)/u);
  assert.match(drive, /surfaceId: "command:command"[\s\S]+targetId: "command:fight"/u);
  assert.doesNotMatch(drive, /client\.press\("Space", `\$\{purpose\}-open-fight`\)/u);

  assert.match(navigation, /surfaceId: "party"[\s\S]+targetId: "party-option:send-out"/u);
  assert.match(navigation, /client\.evidence\.record\("campaign-voluntary-switch"/u);
});

test("campaign move driving resumes a Fight submenu opened before round admission", async () => {
  const presses = [];
  const records = [];
  const fightEvent = {
    index: 0,
    kind: "browser-surface2",
    observation: {
      surfaceId: "command:fight",
      operationClass: "command",
      ownerModel: "local",
      phase: "CommandPhase",
      uiMode: "FIGHT",
      address: { epoch: 91, wave: 1, turn: 5 },
      localSeat: 0,
      seatsWithInput: [0],
      selectedOptionId: "move:94:slot:3",
      optionIds: ["move:94:slot:3"],
      moveSlots: [{ index: 3, optionId: "move:94:slot:3", moveId: 94, category: "SPECIAL", power: 90, usable: true }],
      ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
    },
  };
  const events = [fightEvent];
  const evidence = {
    cursor: () => events.length,
    findLastSemanticSurface(from = 0, surfaceId = null) {
      return events
        .filter(
          event =>
            event.index >= from
            && event.kind === "browser-surface2"
            && (surfaceId == null || event.observation.surfaceId === surfaceId),
        )
        .at(-1);
    },
    record(kind, detail) {
      records.push({ kind, ...detail });
    },
  };
  const client = {
    label: "host-seat",
    publicSeat: 0,
    evidence,
    async press(key, purpose) {
      presses.push({ key, purpose });
    },
  };

  const move = await driveBestCampaignMove(client, "resume-fight", {
    timeoutMs: 1_000,
    commandEvent: fightEvent,
  });

  assert.equal(move.moveId, 94);
  assert.deepEqual(presses, [{ key: "Space", purpose: "nav-submit-command:fight->move:94:slot:3" }]);
  assert.equal(records.at(-1).kind, "campaign-battle-move");
});

test("a rejected voluntary switch stays on the same owner and falls back to a relayed attack", async () => {
  const address = { epoch: 91, wave: 2, turn: 3 };
  const partySlots = [
    { slot: 0, coopOwner: "host", active: true, fainted: false, hp: 4, maxHp: 25, allowedInBattle: true },
    { slot: 1, coopOwner: "guest", active: true, fainted: false, hp: 9, maxHp: 22, allowedInBattle: true },
    { slot: 2, coopOwner: "host", active: false, fainted: false, hp: 22, maxHp: 22, allowedInBattle: true },
  ];
  const events = [];
  const presses = [];
  const records = [];
  let nextIndex = 0;
  const pushSurface = observation => {
    const event = { index: nextIndex++, kind: "browser-surface2", observation };
    events.push(event);
    return event;
  };
  const pushRelay = () => {
    events.push({
      index: nextIndex++,
      kind: "console",
      text: "[coop:relay] broadcastLocalCommand SEND fieldIndex=0 owner=host turn=3 command=0",
    });
  };
  const commandObservation = selectedOptionId => ({
    surfaceId: "command:command",
    operationClass: "command",
    ownerModel: "local",
    address,
    localSeat: 0,
    localRole: "host",
    seatsWithInput: [0],
    selectedOptionId,
    optionIds: ["command:fight", "command:ball", "command:pokemon", "command:run"],
    partySlots,
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
  });
  const firstCommand = pushSurface(commandObservation("command:fight"));
  const evidence = {
    cursor: () => nextIndex,
    findLast(pattern, from = 0) {
      return events.filter(event => event.index >= from).findLast(event => pattern.test(event.text ?? ""));
    },
    findLastSemanticSurface(from = 0, surfaceId = null) {
      return events
        .filter(
          event =>
            event.index >= from
            && event.kind === "browser-surface2"
            && (surfaceId == null || event.observation.surfaceId === surfaceId),
        )
        .at(-1);
    },
    record(kind, data) {
      records.push({ kind, ...data });
      events.push({ index: nextIndex++, kind, ...data });
    },
    async waitForCondition(predicate, { timeoutMs, description }) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const result = predicate(evidence);
        if (result) {
          return result;
        }
        await new Promise(resolvePromise => setTimeout(resolvePromise, 1));
      }
      throw new Error(`fixture timed out waiting for ${description}`);
    },
  };
  const inputHandlers = [
    {
      matches: purpose => purpose.startsWith("nav-move-command:command->command:pokemon"),
      run: () => pushSurface(commandObservation("command:pokemon")),
    },
    {
      matches: purpose => purpose === "nav-submit-command:command->command:pokemon",
      run: () =>
        pushSurface({
          surfaceId: "party",
          address,
          selectedOptionId: "party-slot:0",
          optionIds: ["party-slot:0", "party-slot:1", "party-slot:2"],
          partySlots,
          ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
        }),
    },
    {
      matches: purpose => purpose.startsWith("nav-move-party->party-slot:2"),
      run: current => {
        const slot = Number(current.observation.selectedOptionId.split(":").at(-1));
        pushSurface({ ...current.observation, selectedOptionId: `party-slot:${Math.min(2, slot + 1)}` });
      },
    },
    {
      matches: purpose => purpose.endsWith("-open-party-slot:2"),
      run: current =>
        pushSurface({
          ...current.observation,
          selectedOptionId: "party-option:send-out",
          optionIds: ["party-option:send-out", "party-option:summary", "party-option:cancel"],
        }),
    },
    {
      matches: purpose => purpose === "nav-submit-party->party-option:send-out",
      run: () =>
        // The production trace returned to CommandPhase narration without ever emitting SEND.
        pushSurface({
          surfaceId: "battle:message",
          address,
          phase: "CommandPhase",
          phaseInstance: 25,
          localSeat: 0,
          seatsWithInput: [0],
          ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: null },
        }),
    },
    {
      matches: purpose => purpose.endsWith("-dismiss-switch-rejection"),
      run: () => pushSurface(commandObservation("command:fight")),
    },
    {
      matches: purpose => purpose === "nav-submit-command:command->command:fight",
      run: () =>
        pushSurface({
          surfaceId: "command:fight",
          address,
          selectedOptionId: "move-slot:0",
          optionIds: ["move-slot:0"],
          moveSlots: [
            { index: 0, optionId: "move-slot:0", moveId: 55, category: "SPECIAL", power: 40, pp: 20, usable: true },
          ],
          ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
        }),
    },
    {
      matches: purpose => purpose === "nav-submit-command:fight->move-slot:0",
      run: pushRelay,
    },
  ];
  const client = {
    label: "host-seat",
    publicSeat: 0,
    evidence,
    async press(key, purpose) {
      presses.push({ key, purpose });
      const current = evidence.findLastSemanticSurface();
      const handler = inputHandlers.find(candidate => candidate.matches(purpose));
      assert.ok(handler, `unexpected fixture input ${key} for ${purpose}`);
      handler.run(current);
    },
  };

  const move = await driveBestCampaignMove(client, "rejected-switch", {
    timeoutMs: 1_000,
    commandEvent: firstCommand,
  });

  assert.equal(move.moveId, 55);
  assert.equal(records.filter(record => record.kind === "campaign-voluntary-switch").length, 0);
  assert.equal(records.filter(record => record.kind === "campaign-voluntary-switch-rejected").length, 1);
  assert.equal(records.filter(record => record.kind === "campaign-battle-move").length, 1);
  assert.equal(presses.filter(press => press.purpose.endsWith("-dismiss-switch-rejection")).length, 1);
  assert.ok(
    presses.some(press => press.purpose === "nav-submit-command:fight->move-slot:0"),
    "the same owner must submit an attack after the rejected switch",
  );
});

test("an all-PP-depleted active backs out and relays an owned reserve switch", async () => {
  const address = { epoch: 92, wave: 7, turn: 1 };
  const partySlots = [
    { slot: 0, coopOwner: "host", active: true, fainted: false, hp: 16, maxHp: 25, allowedInBattle: true },
    { slot: 1, coopOwner: "guest", active: true, fainted: false, hp: 20, maxHp: 25, allowedInBattle: true },
    { slot: 2, coopOwner: "host", active: false, fainted: false, hp: 22, maxHp: 22, allowedInBattle: true },
  ];
  const events = [];
  const records = [];
  const presses = [];
  let nextIndex = 0;
  const pushSurface = observation => {
    const event = { index: nextIndex++, kind: "browser-surface2", observation };
    events.push(event);
    return event;
  };
  const commandObservation = selectedOptionId => ({
    surfaceId: "command:command",
    operationClass: "command",
    ownerModel: "local",
    address,
    localSeat: 0,
    localRole: "host",
    seatsWithInput: [0],
    selectedOptionId,
    optionIds: ["command:fight", "command:ball", "command:pokemon", "command:run"],
    partySlots,
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
  });
  const firstCommand = pushSurface(commandObservation("command:fight"));
  const evidence = {
    cursor: () => nextIndex,
    findLast(pattern, from = 0) {
      return events.filter(event => event.index >= from).findLast(event => pattern.test(event.text ?? ""));
    },
    findLastSemanticSurface(from = 0, surfaceId = null) {
      return events
        .filter(
          event =>
            event.index >= from
            && event.kind === "browser-surface2"
            && (surfaceId == null || event.observation.surfaceId === surfaceId),
        )
        .at(-1);
    },
    record(kind, data) {
      records.push({ kind, ...data });
      events.push({ index: nextIndex++, kind, ...data });
    },
    async waitForCondition(predicate, { timeoutMs, description }) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const result = predicate(evidence);
        if (result) {
          return result;
        }
        await new Promise(resolvePromise => setTimeout(resolvePromise, 1));
      }
      throw new Error(`fixture timed out waiting for ${description}`);
    },
  };
  const inputHandlers = [
    {
      matches: purpose => purpose === "nav-submit-command:command->command:fight",
      run: () =>
        pushSurface({
          surfaceId: "command:fight",
          address,
          localSeat: 0,
          seatsWithInput: [0],
          selectedOptionId: "move-slot:0",
          optionIds: ["move-slot:0"],
          moveSlots: [
            { index: 0, optionId: "move-slot:0", moveId: 323, category: "SPECIAL", power: 150, usable: false },
          ],
          ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
        }),
    },
    {
      matches: purpose => purpose.endsWith("-no-usable-move-back"),
      run: () => pushSurface(commandObservation("command:fight")),
    },
    {
      matches: purpose => purpose.startsWith("nav-move-command:command->command:pokemon"),
      run: () => pushSurface(commandObservation("command:pokemon")),
    },
    {
      matches: purpose => purpose === "nav-submit-command:command->command:pokemon",
      run: () =>
        pushSurface({
          surfaceId: "party",
          address,
          selectedOptionId: "party-slot:0",
          optionIds: ["party-slot:0", "party-slot:1", "party-slot:2"],
          partySlots,
          ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
        }),
    },
    {
      matches: purpose => purpose.startsWith("nav-move-party->party-slot:2"),
      run: current => {
        const slot = Number(current.observation.selectedOptionId.split(":").at(-1));
        pushSurface({ ...current.observation, selectedOptionId: `party-slot:${Math.min(2, slot + 1)}` });
      },
    },
    {
      matches: purpose => purpose.endsWith("-open-party-slot:2"),
      run: current =>
        pushSurface({
          ...current.observation,
          selectedOptionId: "party-option:send-out",
          optionIds: ["party-option:send-out", "party-option:summary", "party-option:cancel"],
        }),
    },
    {
      matches: purpose => purpose === "nav-submit-party->party-option:send-out",
      run: () =>
        events.push({
          index: nextIndex++,
          kind: "console",
          text: "[coop:relay] broadcastLocalCommand SEND fieldIndex=0 owner=host turn=1 command=2",
        }),
    },
  ];
  const client = {
    label: "host-seat",
    publicSeat: 0,
    evidence,
    async press(key, purpose) {
      presses.push({ key, purpose });
      const handler = inputHandlers.find(candidate => candidate.matches(purpose));
      assert.ok(handler, `unexpected fixture input ${key} for ${purpose}`);
      handler.run(evidence.findLastSemanticSurface());
    },
  };

  const result = await driveBestCampaignMove(client, "no-pp", { timeoutMs: 1_000, commandEvent: firstCommand });

  assert.equal(result, undefined);
  assert.equal(records.filter(record => record.kind === "campaign-no-usable-move").length, 1);
  assert.equal(records.filter(record => record.kind === "campaign-no-usable-move-switch").length, 1);
  assert.equal(records.filter(record => record.kind === "campaign-voluntary-switch").length, 1);
  assert.equal(records.filter(record => record.kind === "campaign-battle-move").length, 0);
  assert.ok(presses.some(press => press.key === "Backspace" && press.purpose.endsWith("-no-usable-move-back")));
});

test("an all-PP-depleted last owner selects the public move slot to trigger Struggle", async () => {
  const address = { epoch: 1828284717667802, wave: 7, turn: 6 };
  const partySlots = [
    { slot: 0, coopOwner: "host", active: true, fainted: false, hp: 16, maxHp: 25, allowedInBattle: true },
    { slot: 1, coopOwner: "guest", active: true, fainted: false, hp: 20, maxHp: 25, allowedInBattle: true },
  ];
  const events = [];
  const records = [];
  const presses = [];
  let nextIndex = 0;
  const pushSurface = observation => {
    const event = { index: nextIndex++, kind: "browser-surface2", observation };
    events.push(event);
    return event;
  };
  const firstCommand = pushSurface({
    surfaceId: "command:command",
    operationClass: "command",
    ownerModel: "local",
    address,
    localSeat: 0,
    localRole: "host",
    seatsWithInput: [0],
    selectedOptionId: "command:fight",
    optionIds: ["command:fight", "command:ball", "command:pokemon", "command:run"],
    partySlots,
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
  });
  const evidence = {
    cursor: () => nextIndex,
    findLastSemanticSurface(from = 0, surfaceId = null) {
      return events
        .filter(
          event =>
            event.index >= from
            && event.kind === "browser-surface2"
            && (surfaceId == null || event.observation.surfaceId === surfaceId),
        )
        .at(-1);
    },
    record(kind, data) {
      records.push({ kind, ...data });
      events.push({ index: nextIndex++, kind, ...data });
    },
    async waitForCondition(predicate, { timeoutMs, description }) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const result = predicate(evidence);
        if (result) {
          return result;
        }
        await new Promise(resolvePromise => setTimeout(resolvePromise, 1));
      }
      throw new Error(`fixture timed out waiting for ${description}`);
    },
  };
  const inputHandlers = [
    {
      matches: purpose => purpose === "nav-submit-command:command->command:fight",
      run: () =>
        pushSurface({
          surfaceId: "command:fight",
          address,
          localSeat: 0,
          seatsWithInput: [0],
          selectedOptionId: "move:323:slot:0",
          optionIds: ["move:323:slot:0"],
          moveSlots: [
            {
              index: 0,
              optionId: "move:323:slot:0",
              moveId: 323,
              category: "SPECIAL",
              power: 150,
              usable: false,
            },
          ],
          ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
        }),
    },
    {
      matches: purpose => purpose === "nav-submit-command:fight->move:323:slot:0",
      run: () => {},
    },
  ];
  const client = {
    label: "host-seat",
    publicSeat: 0,
    evidence,
    async press(key, purpose) {
      presses.push({ key, purpose });
      const handler = inputHandlers.find(candidate => candidate.matches(purpose));
      assert.ok(handler, `unexpected fixture input ${key} for ${purpose}`);
      handler.run();
    },
  };

  const move = await driveBestCampaignMove(client, "last-owner-no-pp", {
    timeoutMs: 1_000,
    commandEvent: firstCommand,
  });

  assert.equal(move.optionId, "move:323:slot:0");
  assert.equal(records.filter(record => record.kind === "campaign-battle-struggle").length, 1);
  assert.equal(records.filter(record => record.kind === "campaign-no-usable-move").length, 0);
  assert.equal(records.filter(record => record.kind === "campaign-no-usable-move-switch").length, 0);
  assert.ok(presses.some(press => press.purpose === "nav-submit-command:fight->move:323:slot:0"));
  assert.ok(!presses.some(press => press.key === "Backspace"));
});

test("title navigation never shortcuts upward into the notification inbox", () => {
  const title = {
    surfaceId: "title-menu",
    selectedOptionId: "new-game",
    optionIds: ["new-game", "load-game", "profile", "settings", "slot:4"],
  };

  assert.equal(chooseNavigationKey(title, "settings", ["ArrowDown", "ArrowUp"], 0), "ArrowDown");
  assert.equal(
    chooseNavigationKey({ ...title, selectedOptionId: "settings" }, "new-game", ["ArrowUp", "ArrowDown"], 1),
    "ArrowDown",
  );
});

test("reward targeting chooses a legal visible party slot instead of blindly selecting slot zero", () => {
  const partySlots = [
    { slot: 0, fainted: false, hp: 20, maxHp: 20, allowedInBattle: true },
    { slot: 1, fainted: false, hp: 7, maxHp: 20, allowedInBattle: true },
    { slot: 2, fainted: true, hp: 0, maxHp: 20, allowedInBattle: false },
    { slot: 3, fainted: false, hp: 20, maxHp: 20, statusEffect: 6, allowedInBattle: true },
  ];
  const boundary = rewardId => ({
    authority: { partySlots },
    peerEvents: [{ observation: { surfaceId: "reward-shop", selectedOptionId: rewardId } }],
  });

  assert.deepEqual(chooseRewardPartyTargetSlot(boundary("REVIVE"), 0), {
    slot: 2,
    rewardId: "REVIVE",
  });
  assert.deepEqual(chooseRewardPartyTargetSlot(boundary("SUPER_POTION"), 0), {
    slot: 1,
    rewardId: "SUPER_POTION",
  });
  assert.deepEqual(chooseRewardPartyTargetSlot(boundary("RARE_CANDY"), 0), {
    slot: 0,
    rewardId: "RARE_CANDY",
  });
  assert.deepEqual(chooseRewardPartyTargetSlot(boundary("FULL_HEAL"), 0), {
    slot: 1,
    rewardId: "FULL_HEAL",
  });
});

test("reward targeting prefers the acting seat's legal mon when utility is otherwise equal", () => {
  const boundary = rewardId => ({
    authority: {
      localRole: "guest",
      partySlots: [
        { slot: 0, coopOwner: "host", fainted: false, hp: 20, maxHp: 20, allowedInBattle: true },
        { slot: 1, coopOwner: "guest", fainted: false, hp: 20, maxHp: 20, allowedInBattle: true },
        { slot: 2, coopOwner: "host", fainted: true, hp: 0, maxHp: 20, allowedInBattle: false },
        { slot: 3, coopOwner: "guest", fainted: true, hp: 0, maxHp: 20, allowedInBattle: false },
      ],
    },
    peerEvents: [{ observation: { surfaceId: "reward-shop", selectedOptionId: rewardId } }],
  });

  assert.deepEqual(chooseRewardPartyTargetSlot(boundary("RARE_CANDY"), 0), {
    slot: 1,
    rewardId: "RARE_CANDY",
  });
  assert.deepEqual(chooseRewardPartyTargetSlot(boundary("REVIVE"), 0), {
    slot: 3,
    rewardId: "REVIVE",
  });
  assert.deepEqual(rewardPartyTargetCandidates(boundary("RARE_CANDY"), 0), {
    slots: [1, 0],
    rewardId: "RARE_CANDY",
  });
});

test("reward targeting follows nested move and ability choices instead of requiring APPLY", () => {
  assert.equal(
    chooseRewardPartyActionOption({
      optionIds: ["party-option:apply", "party-option:summary", "party-option:cancel"],
    }),
    "party-option:apply",
  );
  assert.equal(
    chooseRewardPartyActionOption({ optionIds: ["party-option:move-1", "party-option:cancel"] }),
    "party-option:move-1",
  );
  assert.equal(
    chooseRewardPartyActionOption({
      optionIds: ["party-option:ability-slot-0", "party-option:ability-slot-1", "party-option:cancel"],
    }),
    "party-option:ability-slot-0",
  );
  assert.equal(chooseRewardPartyActionOption({ optionIds: ["party-option:summary", "party-option:cancel"] }), null);
});

test("party evolution rewards retain a bounded presentation-progress budget when move animations are skipped", () => {
  assert.equal(retainedPartyEvolutionNeedsProgressBudget({ required: true, rewardId: "EVOLUTION_ITEM" }), true);
  assert.equal(retainedPartyEvolutionNeedsProgressBudget({ required: true, rewardId: "RARE_EVOLUTION_ITEM" }), true);
  assert.equal(retainedPartyEvolutionNeedsProgressBudget({ required: true, rewardId: "FORM_CHANGE_ITEM" }), false);
  assert.equal(retainedPartyEvolutionNeedsProgressBudget({ required: false, rewardId: "EVOLUTION_ITEM" }), false);
});

test("reward targeting distinguishes an accepted transient PARTY shell from an inoperable prompt", () => {
  const address = { epoch: 7, wave: 7, turn: 3 };
  const transientParty = {
    kind: "browser-surface2",
    observation: {
      surfaceId: "party:reward-target",
      address,
      selectedOptionId: "party-slot:0",
      ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
    },
  };
  assert.equal(classifyRewardTargetApplyOutcome([transientParty], 0, address), null);
  assert.equal(
    classifyRewardTargetApplyOutcome(
      [transientParty, { kind: "console", text: "Start Phase NewBattlePhase" }],
      0,
      address,
    )?.status,
    "accepted",
  );
  assert.equal(
    classifyRewardTargetApplyOutcome(
      [
        {
          ...transientParty,
          observation: {
            ...transientParty.observation,
            ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: null },
          },
        },
      ],
      0,
      address,
    )?.status,
    "rejected",
  );
});

test("a Mystery reward keeps its paired owner boundary for semantic leave confirmation", () => {
  const watcher = {
    index: 10,
    observation: {
      surfaceId: "reward-shop",
      localSeat: 0,
      ownerSeat: 1,
      seatsWithInput: [1],
      address: { epoch: 7, wave: 2, turn: 1 },
      stateDigest: "same-state",
    },
  };
  const owner = {
    index: 12,
    observation: {
      ...watcher.observation,
      localSeat: 1,
      ready: { handlerActive: true, awaitingActionInput: true },
    },
  };

  assert.deepEqual(mechanicalBoundaryFromPairedSurfaces([watcher, owner], "reward-shop"), {
    authority: owner.observation,
    ownerEvent: owner,
    peerEvents: [watcher],
  });
});

test("Mystery choice navigation skips a production-disabled default through verified public keys", async () => {
  const events = [
    {
      index: 0,
      observation: {
        surfaceId: "mystery-encounter",
        ownerSeat: 1,
        localSeat: 1,
        seatsWithInput: [1],
        selectedOptionId: "mystery-option:0:disabled",
        optionIds: ["mystery-option:0:disabled", "mystery-option:1:enabled", "mystery-action:view-party"],
        ready: { handlerActive: true, inputBlocked: false },
      },
    },
  ];
  const presses = [];
  const records = [];
  const evidence = {
    events,
    findLastSemanticSurface(fromCursor, surfaceId) {
      return events.findLast(event => event.index >= fromCursor && event.observation.surfaceId === surfaceId) ?? null;
    },
    async waitForCondition(predicate) {
      const value = predicate(this);
      assert.ok(value != null, "the enabled owner option must already be actionable");
      return value;
    },
    record(kind, payload) {
      records.push({ kind, payload });
    },
  };
  const owner = {
    label: "guest-seat",
    publicSeat: 1,
    evidence,
    async press(key) {
      presses.push(key);
      if (key === "ArrowRight") {
        events.push({
          index: events.length,
          observation: {
            ...events[0].observation,
            selectedOptionId: "mystery-option:1:enabled",
          },
        });
      }
    },
  };

  await driveMysteryEncounterChoice({ config: { timeoutMs: 500 } }, owner, { "guest-seat": 0 });

  assert.deepEqual(presses, ["ArrowRight", "Space"]);
  assert.equal(records.at(-1)?.kind, "campaign-mystery-option-proof");
  assert.equal(records.at(-1)?.payload.targetId, "mystery-option:1:enabled");
});

test("campaign requires paired runConfig, the exact semantic schedule, and retained terminals", async () => {
  const harness = await readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8");
  const campaign = await readFile(resolve(root, "test/browser/coop-public-ui/campaign.mjs"), "utf8");
  const observer = await readFile(resolve(root, "scripts/coop-browser-entry.ts"), "utf8");
  const awaitable = await readFile(resolve(root, "src/ui/handlers/awaitable-ui-handler.ts"), "utf8");
  assert.match(harness, /targetId: this\.config\.difficultyOptionId/u);
  assert.match(harness, /guest received difficulty=\$\{this\.config\.difficultyId\}/u);
  assert.match(harness, /difficulty-\$\{this\.config\.difficultyId\}-attested/u);
  assert.match(
    harness,
    /waitForAllLocalCommandsDrivingBattlePrompts[\s\S]*createMysteryNarrationAdvancer[\s\S]*findLastSemanticSurface\([\s\S]*"mystery-encounter"[\s\S]*driveMysteryEncounterChoice/u,
    "fresh/resume boundaries must route an observed Mystery owner instead of waiting only for CommandPhase",
  );
  assert.match(
    harness,
    /observation\.ownerSeat === client\.publicSeat[\s\S]*observation\.localSeat === client\.publicSeat[\s\S]*observation\.seatsWithInput\?\.includes\(client\.publicSeat\)[\s\S]*observation\.ready\?\.inputBlocked === false/u,
    "the short-journey Mystery bridge must remain owner-exact and readiness-gated",
  );
  assert.match(campaign, /\[2, "mystery"\][\s\S]*\[6, "mystery"\][\s\S]*\[9, "bargain"\][\s\S]*\[10, "mystery"\]/u);
  assert.match(campaign, /async function checkpointAsymmetricBargainSurface\(/u);
  assert.match(campaign, /watcher input-inert mirrored Bargain projection/u);
  assert.match(campaign, /watcherSurfaceId: watcherObservation\.surfaceId/u);
  assert.doesNotMatch(campaign, /watcherSurfaceId: "mystery-encounter:message"/u);
  assert.match(campaign, /async function driveConfirmedLeave\(/u);
  assert.match(campaign, /owner\.waitForOwnedRewardConfirm\(/u);
  assert.match(campaign, /watcher\.waitForAddressedRewardWatcher\(/u);
  assert.match(campaign, /campaign-semantic-confirmation-barrier/u);
  assert.match(campaign, /async function checkpointRewardPartyTarget\(/u);
  assert.match(campaign, /watcherSurfaceId: "reward-shop"/u);
  assert.match(campaign, /async function driveRewardPartyTarget\(/u);
  assert.match(
    campaign,
    /const match = \/\^party-slot:\(\\d\+\)\$\/u[\s\S]*selectedOptionId === `party-slot:\$\{nextCursor\}`/u,
  );
  assert.doesNotMatch(campaign, /\^cursor:\(\\d\+\)\$/u);
  assert.match(campaign, /selected\.startsWith\("party-option:"\)/u);
  assert.match(campaign, /campaign-reward-target-action/u);
  assert.match(campaign, /async function selectRewardOptionWithMirroredCursor\(/u);
  assert.match(campaign, /campaign-reward-cursor-mirror/u);
  assert.match(campaign, /campaign-reward-target-dismiss-rejection/u);
  assert.match(campaign, /campaign-reward-target-exhausted/u);
  assert.match(awaitable, /public isAwaitingActionInput\(\): boolean/u);
  assert.match(observer, /partyPromptReady\.call\(handler\) === true/u);
  assert.match(campaign, /await driveConfirmedLeave\(rig, driver, client, mechanicalBoundary\.authority, cursors\)/u);
  assert.match(campaign, /mechanicalBoundary = mysteryCheckpoint\.boundary/u);
  // Track R dirty lane wave-3: the watcher's non-actionable reward-shop replica is emitted ONCE and held on
  // a digest-budget-throttled runner (guest "mechanical digest p95 70.7ms exceeds the 50ms budget"), so the
  // reward-watcher wait must scan from the WAVE-START cursor (not a post-convergence cursor), else it times
  // out ("timed out waiting for non-actionable reward watcher") on a correctly-parked guest.
  assert.match(
    campaign,
    /export async function driveConfirmedLeave\(rig, driver, owner, authority, waveStartCursors = null\)/u,
  );
  assert.match(
    campaign,
    /const watcherRewardFrom = waveStartCursors\?\.\[watcher\.label\] \?\? confirmationCursors\[watcher\.label\]/u,
  );
  assert.match(
    campaign,
    /watcher\.waitForAddressedRewardWatcher\(watcherRewardFrom, owner\.publicSeat, authority\.address\)/u,
  );
  assert.match(campaign, /event\.terminal\.wave === wave \+ 1/u);
  assert.match(campaign, /if \(nextBoundary\.wave <= event\.wave\)/u);
  assert.match(campaign, /mysteryEvents: mysteryCoverage\.events/u);
  assert.match(campaign, /ordinal <= policy\.maxBattleLoops/u);
  assert.match(campaign, /\[campaign-loop-budget\]/u);
  assert.match(campaign, /return "target-reached"/u);
  assert.match(campaign, /wave-\$\{event\.wave\}-mystery-terminal/u);
  assert.match(campaign, /battleType: observation\.battleType/u);
  assert.match(campaign, /bossEnemyCount: observation\.bossEnemyCount/u);
  assert.match(campaign, /maxBossSegments: observation\.maxBossSegments/u);
  assert.match(campaign, /bossEight\.bossEnemyCount < 2 \|\| bossEight\.maxBossSegments < 1/u);
  assert.match(campaign, /observation\.mysteryEncounterType === authority\.mysteryEncounterType/u);
  assert.match(campaign, /if \(!observations\.every\(matchesAuthority\)\)/u);
  assert.match(campaign, /paired Mystery \$\{stage\} convergence at/u);
  assert.match(campaign, /observation\.stateDigest === authority\.stateDigest/u);
  assert.match(campaign, /duplicateWaves/u);
  assert.match(campaign, /\.filter\(\(\[wave\]\) => wave <= policy\.targetWaves\)/u);
  assert.match(campaign, /policy\.targetWaves >= 7/u);
  assert.match(campaign, /Math\.min\(policy\.mysteryGauntlet\.minSurfaces, expectedEvents\.size\)/u);
  assert.match(campaign, /ordinary encounters were not distinct registry types/u);
  // Track R run 29644735938 mystery lane: the ME driver never advanced the owner's post-pick narration.
  // The between-wave loop must own a per-prompt-generation advancer for the owner's
  // mystery-encounter:message prompts (host MysteryEncounterPhase / guest CoopReplayMePhase), keyed by
  // phaseInstance in a consumed-instance set like createBattlePromptAdvancer, driven only for the seat
  // that owns the surface (localSeat === ownerSeat, seatsWithInput includes it).
  assert.match(campaign, /export function createMysteryNarrationAdvancer\(rig, from, stats, purpose\)/u);
  assert.match(
    campaign,
    /surfaceId === "mystery-encounter:message"[\s\S]*?operationClass === "encounter-prompt"[\s\S]*?interactiveMysteryPhases\.has\(observation\.phase\)/u,
  );
  assert.match(campaign, /"MysteryEncounterOptionSelectedPhase"/u);
  assert.match(campaign, /observation\.localSeat === observation\.ownerSeat/u);
  // Track R mystery-gauntlet wave-1 ME (#816): on a GUEST-owned ME the authoritative HOST advances its OWN
  // engine MESSAGE dialogue in every production ME phase (the guest renderer's CoopReplayMePhase Space never
  // relays to the host), so the advancer must drive the host too - else its selected-option narration parks
  // forever after the owner's option pick (host stalled at an actionable mystery-encounter:message).
  assert.match(campaign, /client === rig\.host && observation\.localSeat !== observation\.ownerSeat/u);
  assert.match(campaign, /\(ownerDrives \|\| hostEngineDialogue\)/u);
  assert.match(campaign, /consumedInstances\.add\(`\$\{client\.label\}:\$\{surfaceId\}:\$\{phaseInstance\}`\)/u);
  assert.match(campaign, /const advanceMysteryNarration = createMysteryNarrationAdvancer\(/u);
  assert.match(campaign, /if \(await advanceMysteryNarration\(\)\) \{/u);
  assert.match(observer, /uiMode === "MYSTERY_ENCOUNTER"/u);
  assert.match(observer, /mystery-option:\$\{index\}:\$\{disabled \? "disabled" : "enabled"\}/u);
  // Run 30205274431: after a guest-owned Mystery option launched a trainer battle, both engines reached
  // the battle handoff, but the observer kept classifying the host's actionable battle intro as an
  // interaction-owned Mystery prompt. The ordinary battle prompt driver therefore could not reproduce the
  // public host input needed to reach the exact command-open successor. Once the handoff starts, this phase
  // is local battle presentation, not part of the alternating Mystery interaction.
  assert.match(observer, /phase\.startsWith\("MysteryEncounter"\) && phase !== "MysteryEncounterBattlePhase"/u);
  assert.match(
    campaign,
    /await driveMysteryEncounterChoice\(rig, client, cursors, driver\.preferLastEnabledOption === true\)/u,
  );

  // Track R cycle-11 mystery lane (run 29654429335): a guest-owned PART_TIMER opened a PARTY
  // sub-prompt (surfaceId "party", ownerModel "local", ownerSeat null) with no driver; the owner
  // sat ~180s and the host's await exhausted -> shared-session terminal. The mystery-party driver
  // resolves the owner via the ME-gated owned-picker finder (never the generic v2 semantic owner,
  // which needs ownerSeat === localSeat), drives it OWNER-ONLY (the watcher never renders it, so it
  // must NOT route through the paired-mystery checkpoint), and both between-wave advancers guard
  // against pressing a stale prompt THROUGH the open party UI.
  const nav = await readFile(resolve(root, "test/browser/coop-public-ui/campaign-nav.mjs"), "utf8");
  assert.match(nav, /export function findOwnedActionableMysteryPartySurface\(client, fromCursor = 0\)/u);
  assert.match(
    nav,
    /observation\.ownerModel === "local"[\s\S]*Number\.isSafeInteger\(observation\.mysteryEncounterType\)/u,
  );
  assert.match(nav, /export function isPartyPickerSurfaceOpen\(observation\)/u);
  assert.match(nav, /export function mysteryPartyTargetOptionId\(observation\)/u);
  assert.match(nav, /slot\?\.allowedInBattle === true && slot\?\.fainted !== true/u);
  assert.match(campaign, /async function driveMysteryPartyPicker\(rig, owner, cursors, stats\)/u);
  assert.match(campaign, /findOwnedActionableMysteryPartySurface\(owner, from\)/u);
  assert.match(campaign, /targetId: "party-option:select"/u);
  // The paired-mystery checkpoint (which awaits the surface on BOTH clients) must be SKIPPED for the
  // owner-only party sub-prompt, else the watcher hangs it.
  assert.match(campaign, /if \(driver\.mysteryParty\) \{[\s\S]*OWNER-ONLY/u);
  assert.match(campaign, /await driveMysteryPartyPicker\(rig, client, cursors, stats\)/u);
  // Track R run 29673757003: a guest-owned Field Trip secondary prompt is intentionally OWNER-ONLY.
  // The host runs the authoritative encounter engine and remains on its input-inert addressed Mystery
  // projection; only CoopReplayMePhase renders the host-streamed capture selector on the guest. Requiring
  // a second actionable `mystery-encounter:prompt` on the host made a correct production handoff time out.
  assert.match(campaign, /async function checkpointAsymmetricMysteryPromptSurface\(/u);
  assert.match(campaign, /driver\.name === "mystery-subprompt"/u);
  assert.match(campaign, /owner-only actionable Mystery secondary prompt/u);
  assert.match(campaign, /input-inert Mystery secondary watcher projection/u);
  assert.doesNotMatch(campaign, /paired actionable Mystery \$\{stage\} surface/u);
  // Both advancers use the shared party-picker guard (faint replacement OR ME party sub-prompt).
  assert.equal((campaign.match(/isPartyPickerSurfaceOpen\(latestSurface\?\.observation\)/gu) ?? []).length, 2);
});

test("a generic Mystery secondary prompt has one actionable owner and one converged inert watcher", () => {
  const owner = {
    surfaceId: "mystery-encounter:prompt",
    phase: "CoopReplayMePhase",
    uiMode: "OPTION_SELECT",
    localSeat: 1,
    ownerSeat: 1,
    seatsWithInput: [1],
    selectedOptionId: "slot:0",
    optionIds: ["slot:0", "slot:1"],
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: false },
    address: { epoch: 19, wave: 2, turn: 1 },
    stateDigest: "mechanical-state",
    mysteryEncounterType: 8,
  };
  const watcher = {
    surfaceId: "mystery-encounter",
    phase: "MysteryEncounterPhase",
    uiMode: "MYSTERY_ENCOUNTER",
    localSeat: 0,
    ownerSeat: 1,
    seatsWithInput: [1],
    selectedOptionId: "cursor:0",
    optionIds: null,
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: false },
    address: { epoch: 19, wave: 2, turn: 1 },
    stateDigest: "mechanical-state",
    mysteryEncounterType: 8,
  };
  assert.deepEqual(assertAsymmetricMysteryPromptProjection(owner, watcher), {
    stage: "subprompt",
    surfaceId: "mystery-encounter:prompt",
    watcherSurfaceId: "mystery-encounter",
    phase: "CoopReplayMePhase",
    uiMode: "OPTION_SELECT",
    selectedOptionId: "slot:0",
    address: { epoch: 19, wave: 2, turn: 1 },
    ownerSeat: 1,
    watcherSeat: 0,
    optionIds: ["slot:0", "slot:1"],
    mysteryEncounterType: 8,
    stateDigest: "mechanical-state",
  });
  assert.throws(
    () => assertAsymmetricMysteryPromptProjection(owner, { ...watcher, seatsWithInput: [0, 1] }),
    /watcher was not input-inert/u,
  );
  assert.throws(
    () => assertAsymmetricMysteryPromptProjection(owner, { ...watcher, stateDigest: "diverged" }),
    /owner\/watcher state diverged/u,
  );
});

test("the mirrored Bargain offer gives input only to its exact interaction owner", () => {
  const owner = {
    surfaceId: "bargain",
    phase: "TheBargainPhase",
    uiMode: "ER_BARGAIN",
    localSeat: 0,
    ownerSeat: 0,
    seatsWithInput: [0],
    selectedOptionId: "cursor:0",
    optionIds: null,
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
    address: { epoch: 19, wave: 9, turn: 1 },
    stateDigest: "bargain-state",
    mysteryEncounterType: null,
  };
  const watcher = {
    ...owner,
    localSeat: 1,
    ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: true },
  };

  assert.deepEqual(assertAsymmetricBargainProjection(owner, watcher), {
    stage: "presentation",
    surfaceId: "bargain",
    watcherSurfaceId: "bargain",
    phase: "TheBargainPhase",
    uiMode: "ER_BARGAIN",
    selectedOptionId: "cursor:0",
    address: { epoch: 19, wave: 9, turn: 1 },
    ownerSeat: 0,
    watcherSeat: 1,
    optionIds: null,
    mysteryEncounterType: null,
    stateDigest: "bargain-state",
  });
  assert.throws(
    () => assertAsymmetricBargainProjection(owner, { ...watcher, ready: { handlerActive: true, inputBlocked: false } }),
    /watcher was not input-inert/u,
  );
  assert.throws(
    () => assertAsymmetricBargainProjection(owner, { ...watcher, stateDigest: "diverged" }),
    /owner\/watcher state diverged/u,
  );
});

test("paired structured Mystery surfaces inherit nullable encounter metadata without hiding conflicts", () => {
  const authority = {
    surfaceId: "quiz",
    phase: "ErQuizPhase",
    uiMode: "ER_QUIZ",
    operationClass: "quiz",
    ownerSeat: 0,
    selectedOptionId: "cursor:0",
    optionIds: null,
    mysteryEncounterType: 33,
    displayedWave: 3,
    stateDigest: "mechanical-state",
    address: { epoch: 19, wave: 3, turn: 1 },
  };
  const renderer = { ...authority, mysteryEncounterType: null };

  assert.equal(
    pairedMysteryProjectionMatches(authority, renderer, "subprompt"),
    true,
    "a nested renderer may omit encounter metadata already proven by the paired presentation",
  );
  assert.equal(
    pairedMysteryProjectionMatches(authority, { ...renderer, mysteryEncounterType: 21 }, "subprompt"),
    false,
    "two conflicting non-null encounter identities remain a hard divergence",
  );
  assert.equal(
    pairedMysteryProjectionMatches(authority, { ...renderer, stateDigest: "diverged" }, "subprompt"),
    false,
    "nullable presentation metadata cannot weaken mechanical digest convergence",
  );
  assert.equal(
    pairedMysteryProjectionMatches(authority, { ...renderer, displayedWave: 2 }, "subprompt"),
    false,
    "a renderer cannot present an old HUD wave under a newer authoritative Mystery address",
  );
  assert.equal(
    pairedMysteryProjectionMatches({ ...authority, displayedWave: 2 }, renderer, "subprompt"),
    false,
    "the authority surface itself cannot attest with a stale rendered HUD wave",
  );
});

test("paired Mystery convergence follows the newest ordered address when the interaction owner outruns the host", () => {
  const runtimeHost = {
    index: 101,
    observation: {
      localRole: "host",
      localSeat: 0,
      ownerSeat: 1,
      seatsWithInput: [1],
      address: { epoch: 1828208874108895, wave: 3, turn: 1 },
      stateDigest: "retired-wave-three",
    },
  };
  const interactionOwner = {
    index: 202,
    observation: {
      localRole: "guest",
      localSeat: 1,
      ownerSeat: 1,
      seatsWithInput: [1],
      address: { epoch: 1828208874108895, wave: 4, turn: 1 },
      stateDigest: "authorized-wave-four",
    },
  };

  assert.equal(
    selectLatestMysteryAuthorityEvent([interactionOwner, runtimeHost]),
    interactionOwner,
    "the runtime role must not make an already-retired Mystery address canonical",
  );
  assert.equal(
    selectLatestMysteryAuthorityEvent([
      interactionOwner,
      {
        ...runtimeHost,
        observation: { ...runtimeHost.observation, address: interactionOwner.observation.address },
      },
    ]).observation.localRole,
    "guest",
    "the actionable interaction owner is canonical once both browsers report the same address",
  );
});

test("paired Mystery convergence does not canonize a transient watcher reward cursor", () => {
  const address = { epoch: 1828721258330852, wave: 6, turn: 1 };
  const owner = {
    index: 5160,
    observation: {
      localRole: "guest",
      localSeat: 1,
      ownerSeat: 1,
      seatsWithInput: [1],
      selectedOptionId: "cursor:0",
      address,
      stateDigest: "42525210ba7056ce",
    },
  };
  const transientWatcher = {
    index: 4800,
    observation: {
      localRole: "host",
      localSeat: 0,
      ownerSeat: 1,
      seatsWithInput: [1],
      selectedOptionId: "reward-action:reroll",
      address,
      stateDigest: "42525210ba7056ce",
    },
  };

  assert.equal(selectLatestMysteryAuthorityEvent([transientWatcher, owner]), owner);
  assert.equal(selectLatestMysteryAuthorityEvent([owner, transientWatcher]), owner);
});

test("the mystery narration driver advances selected-option and Bargain outcome prompts once", async () => {
  const hostEvents = [
    {
      index: 0,
      kind: "browser-surface2",
      observation: {
        surfaceId: "mystery-encounter:message",
        operationClass: "encounter-prompt",
        phase: "MysteryEncounterOptionSelectedPhase",
        uiMode: "MESSAGE",
        ownerModel: "interaction",
        coop: true,
        localSeat: 0,
        ownerSeat: 1,
        seatsWithInput: [1],
        phaseInstance: 14,
        ready: { handlerActive: true, awaitingActionInput: true },
      },
    },
  ];
  const guestEvents = [];
  const makeClient = (label, events) => {
    const presses = [];
    return {
      label,
      presses,
      evidence: {
        events,
        findLastSemanticSurface(fromCursor = 0) {
          return events.filter(event => event.index >= fromCursor && event.kind === "browser-surface2").at(-1) ?? null;
        },
        record() {},
      },
      async press(key, purpose) {
        presses.push({ key, purpose });
      },
    };
  };
  const host = makeClient("host-seat", hostEvents);
  const guest = makeClient("guest-seat", guestEvents);
  const rig = { host, guest, clients: { host, guest } };
  const stats = {};
  const advance = createMysteryNarrationAdvancer(
    rig,
    { "host-seat": 0, "guest-seat": 0 },
    stats,
    "wave-1-mystery-narration",
  );

  assert.equal(await advance(), true);
  assert.deepEqual(host.presses, [
    {
      key: "Space",
      purpose: "wave-1-mystery-narration-host-seat-mystery-narration-1",
    },
  ]);
  assert.deepEqual(guest.presses, []);
  assert.equal(await advance(), false, "one prompt generation must never be submitted twice");

  guestEvents.push({
    index: 0,
    kind: "browser-surface2",
    observation: {
      surfaceId: "mystery-encounter:message",
      operationClass: "encounter-prompt",
      phase: "TheBargainPhase",
      uiMode: "MESSAGE",
      ownerModel: "interaction",
      coop: true,
      localSeat: 1,
      ownerSeat: 1,
      seatsWithInput: [1],
      phaseInstance: 15,
      ready: { handlerActive: true, awaitingActionInput: true },
    },
  });
  assert.equal(await advance(), true);
  assert.deepEqual(guest.presses, [
    {
      key: "Space",
      purpose: "wave-1-mystery-narration-guest-seat-mystery-narration-2",
    },
  ]);
  assert.equal(await advance(), false, "the Bargain outcome prompt must never be submitted twice");
});

test("the mystery narration driver waits through an exact guest-ack fence without consuming the prompt", async () => {
  const events = [
    {
      index: 0,
      kind: "browser-surface2",
      observation: {
        surfaceId: "mystery-encounter:message",
        operationClass: "encounter-prompt",
        phase: "MysteryEncounterPhase",
        uiMode: "MESSAGE",
        ownerModel: "interaction",
        coop: true,
        localSeat: 0,
        ownerSeat: 1,
        seatsWithInput: [1],
        phaseInstance: 13,
        ready: { handlerActive: true, awaitingActionInput: true, inputBlocked: true },
      },
    },
  ];
  const presses = [];
  const host = {
    label: "host-seat",
    evidence: {
      events,
      findLastSemanticSurface(fromCursor = 0) {
        return events.filter(event => event.index >= fromCursor && event.kind === "browser-surface2").at(-1) ?? null;
      },
      record() {},
    },
    async press(key) {
      presses.push(key);
    },
  };
  const guest = {
    label: "guest-seat",
    evidence: {
      events: [],
      findLastSemanticSurface() {
        return null;
      },
      record() {},
    },
    async press() {},
  };
  const advance = createMysteryNarrationAdvancer(
    { host, guest, clients: { host, guest } },
    { "host-seat": 0, "guest-seat": 0 },
    {},
    "guest-ack-fence",
  );

  assert.equal(await advance(), false, "production-rejected pending-ack input is not spent");
  events.push({
    ...events[0],
    index: 1,
    observation: { ...events[0].observation, ready: { ...events[0].observation.ready, inputBlocked: false } },
  });
  assert.equal(await advance(), true, "the same exact prompt becomes drivable after its acknowledgement fence clears");
  assert.deepEqual(presses, ["Space"]);
});

test("Authority V2 routes guest replay narration through its exact acknowledgement path", async () => {
  const ui = await readFile(resolve(root, "src/ui/ui.ts"), "utf8");
  const observer = await readFile(resolve(root, "scripts/coop-browser-entry.ts"), "utf8");
  assert.match(
    ui,
    /const authoritativeGuestReplay =[\s\S]*phaseName === "CoopReplayMePhase" && getCoopNetcodeMode\(\) === "authoritative"[\s\S]*\|\| authoritativeGuestReplay/u,
    "the guest replay phase must reach coopGuestAcknowledgeMeNarration after a consumed MESSAGE press",
  );
  assert.match(
    ui,
    /const authoritativeGuestReplayActive =[\s\S]*phaseName === "CoopReplayMePhase"[\s\S]*const meInteractiveSurfaceActive =[\s\S]*mePump\.isSessionActive\(\) \|\| authoritativeGuestReplayActive/u,
    "a retained V2 replay prompt must not depend on the retired legacy Mystery pump session",
  );
  assert.match(
    observer,
    /hostEngineDialogueBlockedByAck[\s\S]*coopHostMeNarrationAwaitingGuestAck\(runtime\)/u,
    "the public oracle must expose the same host pending-ack fence production enforces",
  );
  assert.match(observer, /const learnMovePartySlot =/u);
  assert.match(observer, /semantic\.operationClass === "learn-move"/u);
  assert.match(
    observer,
    /getPlayerParty\(\)\[learnMovePartySlot as number\][\s\S]*\.coopOwner/u,
    "learn-move ownership must come from the Pokemon rather than the prior alternating interaction",
  );
  assert.match(
    observer,
    /phase === "CoopReplayLearnMovePhase"[\s\S]*replayLearnMoveOwner \? "learn-move:confirm" : "learn-move:summary"/u,
    "a guest replay must distinguish its actionable owner picker from the read-only host-owned watcher",
  );
  assert.match(
    observer,
    /phase === "LearnMovePhase"[\s\S]*semantic\.operationClass === "learn-move"[\s\S]*ownerSeat != null[\s\S]*surfaceId: localSeat === ownerSeat \? "learn-move:confirm" : "learn-move:summary"/u,
    "a queue-owned LearnMovePhase must expose the Pokemon owner as actionable after stable ownership resolves",
  );
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
  assert.match(solo, /chooseBestCampaignMove\(fight\.observation\)/u);
  assert.match(solo, /targetId: move\.optionId/u);
  assert.doesNotMatch(solo, /surfaceId: FIGHT_SURFACE,\s+targetId: "cursor:0"/u);
});

function soloCommandProgressClient(promptCount) {
  const events = [
    {
      index: 0,
      kind: "browser-surface2",
      observation: {
        surfaceId: "check-switch",
        optionIds: ["yes", "no"],
        selectedOptionId: "no",
        ready: { handlerActive: true, inputBlocked: false },
      },
    },
  ];
  const presses = [];
  const evidence = {
    events,
    findLastSemanticSurface(fromCursor = 0, surfaceId = null) {
      return events
        .filter(
          event =>
            event.index >= fromCursor
            && event.kind === "browser-surface2"
            && (surfaceId == null || event.observation.surfaceId === surfaceId),
        )
        .at(-1);
    },
    async waitForCondition(predicate, { timeoutMs = 500, description = "condition" } = {}) {
      const deadline = Date.now() + Math.min(timeoutMs, 500);
      while (Date.now() < deadline) {
        const result = predicate(this);
        if (result) {
          return result;
        }
        await new Promise(resolveDelay => setTimeout(resolveDelay, 2));
      }
      throw new Error(`timed out waiting for ${description}`);
    },
    record() {},
  };
  return {
    label: "solo-seat",
    config: { timeoutMs: 500 },
    evidence,
    presses,
    async press(key, purpose) {
      presses.push({ key, purpose });
      const submittedPrompts = presses.filter(entry => entry.purpose === "nav-submit-check-switch->no").length;
      setTimeout(() => {
        const observation =
          submittedPrompts < promptCount
            ? {
                surfaceId: "check-switch",
                optionIds: ["yes", "no"],
                selectedOptionId: "no",
                ready: { handlerActive: true, inputBlocked: false },
              }
            : {
                surfaceId: "command:command",
                ready: { handlerActive: true, awaitingActionInput: null, inputBlocked: null },
              };
        events.push({ index: events.length, kind: "browser-surface2", observation });
      }, 10);
    },
  };
}

test("solo command setup retires a lingering switch prompt after exactly one submit", async () => {
  const client = soloCommandProgressClient(1);
  const command = await reachFirstCommand(client, 0);
  assert.equal(command.observation.surfaceId, "command:command");
  assert.deepEqual(client.presses, [{ key: "Space", purpose: "nav-submit-check-switch->no" }]);
});

test("solo command setup submits each distinct switch prompt exactly once", async () => {
  const client = soloCommandProgressClient(2);
  const command = await reachFirstCommand(client, 0);
  assert.equal(command.observation.surfaceId, "command:command");
  assert.deepEqual(client.presses, [
    { key: "Space", purpose: "nav-submit-check-switch->no" },
    { key: "Space", purpose: "nav-submit-check-switch->no" },
  ]);
});

test("the high-frequency semantic observer caches only its expensive digest on a fixed SLA", async () => {
  const observer = await readFile(resolve(root, "scripts/coop-browser-entry.ts"), "utf8");
  assert.match(observer, /function semanticMechanicalDigest\(key: string\)/u);
  assert.match(
    observer,
    /Math\.ceil\(sorted\.length \* 0\.95\) - 1/u,
    "the 20-sample p95 must select nearest-rank index 18 rather than treating the lone maximum as p95",
  );
  assert.match(
    observer,
    /key === semanticDigestCacheKey && now - semanticDigestCacheAt < 1_000[\s\S]*return semanticDigestCache/u,
  );
  assert.match(
    observer,
    /semanticMechanicalDigest\(\s*`watcher:\$\{runtime\.controller\.sessionEpoch\}:/u,
    "the replay-waiter path that previously digested at 10 Hz must use the cache",
  );
  assert.doesNotMatch(
    observer,
    /rendererWaitReady === true[\s\S]{0,700}computeMechanicalDigest\(\)/u,
    "a parked replay waiter must not walk the full state on every 100 ms observer poll",
  );
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
  assert.match(harness, /const binding = sink\.findPairingRole\(requestCursor\)/u);
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
  assert.match(
    observer,
    /uiMode === "PARTY"[\s\S]*partyPromptReady\.call\(handler\) === true[\s\S]*\? true\s*:\s*null/u,
  );
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
    { index: 7, speciesId: 155, cost: 3 },
    { index: 3, speciesId: 152, cost: 2 },
  ]);
});

test("paired starter selection diversifies the two visible seat rosters", () => {
  const observation = {
    starterGridCandidates: [
      { index: 3, speciesId: 152, cost: 2 }, // Chikorita
      { index: 7, speciesId: 155, cost: 3 }, // Cyndaquil
      { index: 8, speciesId: 158, cost: 3 }, // Totodile
      { index: 11, speciesId: 728, cost: 4 },
    ],
  };
  assert.deepEqual(chooseAffordableStarterPair(observation, 5, 0), [
    { index: 7, speciesId: 155, cost: 3 },
    { index: 3, speciesId: 152, cost: 2 },
  ]);
  assert.deepEqual(chooseAffordableStarterPair(observation, 5, 1), [
    { index: 8, speciesId: 158, cost: 3 },
    { index: 3, speciesId: 152, cost: 2 },
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

test("semantic grid navigation explores directions per cursor state instead of cycling globally", async () => {
  const optionIds = [
    "mystery-option:0:enabled",
    "mystery-option:1:enabled",
    "mystery-option:2:enabled",
    "mystery-action:view-party",
  ];
  const targetId = "mystery-option:2:enabled";
  const transitions = new Map([
    [`${optionIds[3]}:ArrowRight`, optionIds[1]],
    [`${optionIds[1]}:ArrowRight`, optionIds[0]],
    [`${optionIds[1]}:ArrowDown`, optionIds[0]],
    [`${optionIds[0]}:ArrowRight`, targetId],
    // The former global sequence followed these three edges forever:
    // view-party --Right--> 1 --Down--> 0 --Left--> view-party.
    [`${optionIds[0]}:ArrowLeft`, optionIds[3]],
  ]);
  const events = [
    {
      index: 1,
      observation: {
        surfaceId: "mystery-encounter",
        selectedOptionId: optionIds[3],
        optionIds,
        ready: { handlerActive: true, inputBlocked: false },
      },
    },
  ];
  const presses = [];
  const client = {
    label: "host-seat",
    evidence: {
      findLastSemanticSurface(fromCursor, surfaceId) {
        return events.findLast(event => event.index >= fromCursor && event.observation.surfaceId === surfaceId) ?? null;
      },
      record() {},
    },
    async press(key) {
      presses.push(key);
      if (key === "Space") {
        return;
      }
      const current = events.at(-1).observation;
      const selectedOptionId = transitions.get(`${current.selectedOptionId}:${key}`);
      assert.ok(selectedOptionId, `fixture has no ${key} edge from ${current.selectedOptionId}`);
      events.push({
        index: events.at(-1).index + 1,
        observation: { ...current, selectedOptionId },
      });
    },
  };

  await selectOptionById(client, {
    surfaceId: "mystery-encounter",
    targetId,
    navKeys: ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"],
    timeoutMs: 1_000,
  });

  assert.deepEqual(presses, ["ArrowRight", "ArrowRight", "ArrowRight", "Space"]);
});
