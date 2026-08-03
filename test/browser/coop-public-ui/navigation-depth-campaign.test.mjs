/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertNavigationCoverage,
  assertNavigationFixtureParty,
  recordNavigationCommandFrontier,
} from "./campaign.mjs";

function party() {
  return [
    { slot: 0, speciesId: 150, coopOwner: "host", level: 100, pauseEvolutions: true },
    { slot: 1, speciesId: 150, coopOwner: "guest", level: 100, pauseEvolutions: true },
    { slot: 2, speciesId: 888, coopOwner: "host", level: 100, pauseEvolutions: true },
    { slot: 3, speciesId: 888, coopOwner: "guest", level: 100, pauseEvolutions: true },
    { slot: 4, speciesId: 889, coopOwner: "host", level: 100, pauseEvolutions: true },
    { slot: 5, speciesId: 889, coopOwner: "guest", level: 100, pauseEvolutions: true },
  ];
}

function rigAt(wave, biomeId = 2, trainerVisible = false, guestPresentation = null) {
  const records = [];
  const baseObservation = {
    operationClass: "command",
    address: { epoch: 7, wave, turn: 1 },
    partySlots: party(),
    arena: { biomeId, weather: 0, terrain: 0 },
    presentation: {
      trainerVisible,
      enemyTrainerVisible: false,
      enemyTrainerAlpha: 0,
      enemyTrainerPresented: false,
    },
    displayedWave: wave,
  };
  const makeClient = label => {
    const observation =
      label === "guest-seat" && guestPresentation != null
        ? {
            ...baseObservation,
            presentation: { ...baseObservation.presentation, ...guestPresentation },
          }
        : baseObservation;
    return {
      label,
      evidence: {
        events: [],
        findLastSemanticSurface: () => ({ observation }),
        record: (kind, detail) => records.push({ label, kind, detail }),
      },
    };
  };
  return { clients: { host: makeClient("host-seat"), guest: makeClient("guest-seat") }, records };
}

test("navigation fixture proves three level-100 mons per player on both browser projections", () => {
  const rig = rigAt(1);
  const proof = assertNavigationFixtureParty(rig, 1);
  assert.equal(proof.party.length, 6);
  assert.equal(rig.records.filter(record => record.kind === "campaign-navigation-level100-party").length, 2);

  const broken = rigAt(1);
  broken.clients.guest.evidence.findLastSemanticSurface = () => ({
    observation: {
      operationClass: "command",
      address: { wave: 1 },
      partySlots: party().map(slot => (slot.slot === 5 ? { ...slot, level: 99 } : slot)),
    },
  });
  assert.throws(() => assertNavigationFixtureParty(broken, 1), /fixture mismatch/u);
});

test("navigation command frontier requires paired arena and trainer cleanup parity", () => {
  const coverage = { commandFrontiers: [] };
  const rig = rigAt(21, 8, false);
  const frontier = recordNavigationCommandFrontier(rig, coverage, 21);
  assert.deepEqual(frontier.arena, { biomeId: 8, weather: 0, terrain: 0 });
  assert.equal(frontier.presentation.trainerVisible, false);
  assert.equal(coverage.commandFrontiers.length, 1);
});

test("navigation command frontier compares rendered trainer presentation, not a transparent sprite's stale flag", () => {
  const transparent = { commandFrontiers: [] };
  const transparentRig = rigAt(5, 0, false, {
    enemyTrainerVisible: true,
    enemyTrainerAlpha: 0,
    enemyTrainerPresented: false,
  });
  assert.doesNotThrow(() => recordNavigationCommandFrontier(transparentRig, transparent, 5));

  const rendered = { commandFrontiers: [] };
  const renderedRig = rigAt(5, 0, false, {
    enemyTrainerVisible: true,
    enemyTrainerAlpha: 1,
    enemyTrainerPresented: true,
  });
  assert.throws(() => recordNavigationCommandFrontier(renderedRig, rendered, 5), /presentation diverged/u);
});

function completeCoverage() {
  return {
    crossroads: [
      { wave: 5, targetId: "stay" },
      { wave: 10, targetId: "leave" },
    ],
    worldMaps: [{ wave: 10, targetId: "biome:8" }],
    commandFrontiers: [
      { wave: 1, arena: { biomeId: 2, weather: 0, terrain: 0 }, presentation: { trainerVisible: false } },
      { wave: 11, arena: { biomeId: 8, weather: 1, terrain: 0 }, presentation: { trainerVisible: false } },
      { wave: 21, arena: { biomeId: 8, weather: 0, terrain: 2 }, presentation: { trainerVisible: false } },
      { wave: 31, arena: { biomeId: 9, weather: 0, terrain: 0 }, presentation: { trainerVisible: false } },
    ],
    waveSurfaces: [
      {
        wave: 10,
        surfaces: [{ surface: "biome-shop" }, { surface: "crossroads" }, { surface: "biome-pick" }],
      },
    ],
  };
}

function completeMarkets() {
  return {
    visits: [
      { address: { wave: 10 }, ownerSeat: 1 },
      { address: { wave: 20 }, ownerSeat: 0 },
      { address: { wave: 30 }, ownerSeat: 1 },
    ],
    purchases: [{}, {}],
  };
}

test("30-wave navigation acceptance closes markets, both routes, map, second biome, and wave-20 gym", () => {
  const proof = assertNavigationCoverage(
    completeCoverage(),
    completeMarkets(),
    [{ wave: 20, battleType: "TRAINER", trainerBoss: true }],
    30,
  );
  assert.deepEqual(proof.requiredMarketWaves, [10, 20, 30]);
  assert.deepEqual(new Set(proof.marketOwners), new Set([0, 1]));
  assert.equal(proof.chained, true);
});

test("navigation acceptance treats the milestone biome shop as the reward boundary", () => {
  const coverage = completeCoverage();
  assert.deepEqual(
    coverage.waveSurfaces[0].surfaces.map(surface => surface.surface),
    ["biome-shop", "crossroads", "biome-pick"],
  );
  assert.doesNotThrow(() =>
    assertNavigationCoverage(coverage, completeMarkets(), [{ wave: 20, battleType: "TRAINER", trainerBoss: true }], 30),
  );
});

test("navigation acceptance fails loudly when a nominal driver never crosses a required surface", () => {
  const missingMarket = completeMarkets();
  missingMarket.visits = missingMarket.visits.filter(visit => visit.address.wave !== 20);
  assert.throws(
    () => assertNavigationCoverage(completeCoverage(), missingMarket, [], 30),
    /missing biome markets at waves 20/u,
  );

  const noLeave = completeCoverage();
  noLeave.crossroads = [{ wave: 5, targetId: "stay" }];
  assert.throws(
    () =>
      assertNavigationCoverage(
        noLeave,
        completeMarkets(),
        [{ wave: 20, battleType: "TRAINER", trainerBoss: true }],
        30,
      ),
    /both Stay and Leave/u,
  );
});

test("the journey is exact-build gated, initial-save only, four-hour bounded, and live-observable", async () => {
  const [registry, starterHandler, starterPhase, crossroads, observer, workflow, campaign, headlessSoak] =
    await Promise.all([
      readFile(new URL("../../../src/dev-tools/registry.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../src/ui/handlers/starter-select-ui-handler.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../src/phases/select-starter-phase.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../src/phases/er-crossroads-phase.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../scripts/coop-browser-entry.ts", import.meta.url), "utf8"),
      readFile(new URL("../../../.github/workflows/coop-public-ui-journey.yml", import.meta.url), "utf8"),
      readFile(new URL("campaign.mjs", import.meta.url), "utf8"),
      readFile(new URL("../../tools/coop-soak-driver.ts", import.meta.url), "utf8"),
    ]);
  assert.match(registry, /VITE_COOP_BROWSER_FIXTURE === "navigation-depth-30"/u);
  assert.match(registry, /get\("coopfixture"\) === "navigation-depth-30"/u);
  assert.match(
    registry,
    /getCoopBrowserLongitudinalFixtureStartingLevel[\s\S]*isCoopBrowserNavigationFixtureActive\(\)[\s\S]*\? 100[\s\S]*: null/u,
  );
  assert.match(
    registry,
    /getCoopBrowserNavigationFixtureStartingMoney[\s\S]*isCoopBrowserNavigationFixtureActive\(\) \? 100_000 : null/u,
    "the exact navigation bundle receives enough initial-save money to make both market-owner purchases deterministic",
  );
  assert.match(
    registry,
    /shouldPauseCoopBrowserLongitudinalFixtureEvolutions\(\)[\s\S]*isCoopBrowserCampaignSurvivalFixtureActive\(\)[\s\S]*isCoopBrowserNavigationFixtureActive\(\)/u,
  );
  assert.match(starterHandler, /getCoopBrowserNavigationFixtureStarters\(\)/u);
  assert.match(
    registry,
    /getCoopBrowserNavigationFixtureStarters[\s\S]*SpeciesId\.MEWTWO[\s\S]*MoveId\.AURA_SPHERE[\s\S]*SpeciesId\.ZACIAN[\s\S]*MoveId\.SACRED_SWORD[\s\S]*SpeciesId\.ZAMAZENTA[\s\S]*MoveId\.MOONBLAST/u,
    "the longitudinal fixture must expose strong legal multi-type attacks instead of testing starter-budget survivability",
  );
  assert.match(starterHandler, /allowOverValueLimit:\s*coopBrowserStarters === coopBrowserNavigationStarters/u);
  assert.match(starterHandler, /!options\.allowOverValueLimit && !this\.tryUpdateValue\(cost, true\)/u);
  assert.match(
    starterPhase,
    /const navigationFixtureActive = isCoopBrowserNavigationFixtureActive\(\)[\s\S]*const partyRewardFixtureActive = getCoopBrowserPartyRewardFixtureId\(\) != null[\s\S]*cost:\s*navigationFixtureActive \|\| partyRewardFixtureActive\s*\?\s*0\s*:\s*globalScene\.gameData\.getSpeciesStarterValue\(s\.speciesId\)/u,
    "the exact navigation fixture must retain its roster-budget exemption when another exact fixture shares the envelope boundary",
  );
  assert.match(
    starterHandler,
    /valueLimitLabel\.setVisible\(!this\.rosterPickMode && coopBrowserNavigationStarters == null\)/u,
  );
  assert.match(
    starterPhase,
    /const fixturePauseEvolutions = shouldPauseCoopBrowserLongitudinalFixtureEvolutions\(\)[\s\S]*this\.initBattle\(merged, true, owners, undefined, fixtureStartingLevels, fixturePauseEvolutions\)/u,
  );
  assert.equal(
    (
      starterPhase.match(/if \(fixtureStartingMoney != null\) \{\s*globalScene\.money = fixtureStartingMoney;\s*\}/gu)
      ?? []
    ).length,
    2,
    "both the legacy fallback and authoritative host set the fixture purse before initial battle construction",
  );
  assert.match(crossroads, /label: "Stay",\s*semanticId: "stay"/u);
  assert.match(crossroads, /label: "Leave",\s*semanticId: "leave"/u);
  assert.match(observer, /level: pokemon\.level/u);
  assert.match(observer, /function coopBrowserPresentationSnapshot\(\)/u);
  assert.match(observer, /trainerVisible: playerTrainer\?\.visible === true/u);
  assert.match(observer, /enemyTrainerVisible/u);
  assert.match(observer, /enemyTrainerAlpha/u);
  assert.match(observer, /enemyTrainerPresented/u);
  assert.match(workflow, /navigation-depth-30' && 240/u);
  assert.match(workflow, /COOP_UI_CAMPAIGN_HARD_TIMEOUT_MS:[^\n]*13800000/u);
  assert.match(workflow, /COOP_UI_REQUIRE_NAVIGATION_DEPTH:[^\n]*navigation-depth-30/u);
  assert.match(
    workflow,
    /campaign_pid=\$![\s\S]*tail -n 1 "\$progress_file"[\s\S]*\[coop-journey:runner-heartbeat\][\s\S]*::notice title=Co-op journey heartbeat::[\s\S]*wait "\$campaign_pid"[\s\S]*exit "\$campaign_status"/u,
    "long public journeys must expose their latest causal milestone without changing the driver",
  );
  assert.match(campaign, /\[coop-soak:\$\{kind\}\]/u);
  assert.match(campaign, /startHeartbeat\(\(\) => campaignLiveSnapshot/u);
  assert.match(
    campaign,
    /const cycleCampaignMoves =[\s\S]*policy\.navigation\.required \|\| policy\.market\.requiredPurchases > 0 \|\| policy\.mysteryGauntlet\.required;[\s\S]*cycleIndex: cycleCampaignMoves \? turn - 1 : 0/u,
    "navigation, market, and Mystery drivers must cycle the observer-proven coverage set across a real multi-turn battle",
  );
  assert.match(
    campaign,
    /const registeredSurfaceProgressBudget =\s*policy\.mysteryGauntlet\.required \|\| policy\.navigation\.required/u,
    "embedded Mystery chains must extend navigation only from observer-proven public progress",
  );
  assert.match(
    campaign,
    /requireExp:[\s\S]*policy\.navigation\.required[\s\S]*policy\.market\.requiredPurchases > 0[\s\S]*policy\.mysteryGauntlet\.required[\s\S]*policy\.registeredInteractions\.required[\s\S]*&& \(battleKind\.battleType === "WILD"/u,
    "level-100 navigation and market fixtures must retain ledger equality without inventing an EXP cue",
  );
  assert.match(headlessSoak, /\[coop-soak:wave-start\]/u);
  assert.match(headlessSoak, /\[coop-soak:wave-complete\]/u);
});
