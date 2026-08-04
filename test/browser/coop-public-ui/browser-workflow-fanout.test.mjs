/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../../..");

function jobBlock(workflow, job) {
  const lines = workflow.split(/\r?\n/gu);
  const start = lines.indexOf(`  ${job}:`);
  assert.notEqual(start, -1, `workflow contains the ${job} job`);
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index++) {
    if (/^ {2}[a-z0-9-]+:\s*$/iu.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

const workflows = [
  {
    file: ".github/workflows/coop-public-ui-journey.yml",
    fanout: ["primary-journey", "reverse-journey"],
  },
  {
    file: ".github/workflows/coop-public-ui-campaign.yml",
    fanout: ["solo-nav", "campaign"],
  },
];

for (const { file, fanout } of workflows) {
  test(`${file} checks out assets only in its once-built bundle job`, async () => {
    const workflow = await readFile(resolve(root, file), "utf8");
    assert.match(jobBlock(workflow, "browser-build"), /submodules: recursive/u);
    for (const job of fanout) {
      const block = jobBlock(workflow, job);
      assert.match(block, /fetch-depth: 1/u, `${job} uses a shallow harness checkout`);
      assert.match(block, /submodules: false/u, `${job} never repeats the asset checkout`);
      assert.doesNotMatch(block, /submodules: recursive/u, `${job} consumes the sealed bundle instead`);
      assert.match(
        block,
        /COOP_UI_ASSET_DIR: \.coop-no-local-asset-fallback/u,
        `${job} cannot consume stale assets from a reused runner`,
      );
    }
  });
}

test("the full gate cannot starve its sealed browser transport behind asset checkout", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/coop-gate-sharded.yml"), "utf8");
  const browser = jobBlock(workflow, "browser");
  const timeout = browser.match(/timeout-minutes:\s*(\d+)/u);
  assert.ok(timeout, "the browser transport has an explicit wall-clock ceiling");
  assert.ok(
    Number(timeout[1]) >= 25,
    "the wall-clock ceiling includes the measured worst-case asset checkout plus the sealed checkpoint",
  );
  assert.match(browser, /submodules: recursive/u, "the measured asset checkout remains part of this job");
  assert.match(browser, /Run two-context sealed-production transport checkpoint/u);
});

test("browser build gates report every blocking Biome diagnostic without legacy lint noise", async () => {
  for (const { file } of workflows) {
    const workflow = await readFile(resolve(root, file), "utf8");
    const build = jobBlock(workflow, "browser-build");
    assert.match(
      build,
      /pnpm exec biome check --diagnostic-level=error --max-diagnostics=none/u,
      `${file} must expose the actual blocking error instead of exhausting Biome's default diagnostic cap`,
    );
  }
});

test("journey bundle resolves one validated asset SHA even when the GitHub API is unavailable", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8");
  const build = jobBlock(workflow, "browser-build");
  assert.match(build, /gh api repos\/Heraklines\/er-assets\/commits\/main --jq \.sha/u);
  assert.match(
    build,
    /git ls-remote https:\/\/github\.com\/Heraklines\/er-assets\.git refs\/heads\/main/u,
    "the immutable public Git ref closes an authenticated API outage",
  );
  assert.match(build, /grep -Eq '\^\[0-9a-f\]\{40\}\$'/u, "either lookup path must produce an exact commit SHA");
});

test("every two-browser journey gives each real Chromium its own display and persistent cache", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8");
  const journey = jobBlock(workflow, "primary-journey");
  const reverse = jobBlock(workflow, "reverse-journey");
  assert.match(journey, /COOP_UI_HEADLESS: "0"/u);
  assert.match(journey, /COOP_UI_PROXY_PRODUCTION_ASSETS: "1"/u);
  assert.match(journey, /COOP_UI_SEAT_PROFILE_DIR: \$\{\{ runner\.temp \}\}\/coop-seat-profiles/u);
  assert.match(journey, /Xvfb :98[\s\S]*Xvfb :99/u);
  assert.match(journey, /COOP_UI_DISPLAY_HOST=:98 COOP_UI_DISPLAY_GUEST=:99/u);
  assert.match(
    journey,
    /export COOP_UI_DISPLAY_HOST=:98 COOP_UI_DISPLAY_GUEST=:99[\s\S]*if \[\[/u,
    "the display assignment must cover both conditional journey entrypoints",
  );
  assert.match(reverse, /COOP_UI_PROXY_PRODUCTION_ASSETS: "1"/u);
});

test("campaign asset proxy is explicit for non-surface profiles and remains off for the production surface oracle", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/coop-public-ui-campaign.yml"), "utf8");
  const plan = jobBlock(workflow, "campaign-plan");
  const entry = artifact => {
    const marker = `artifact: "${artifact}"`;
    const start = plan.indexOf(marker);
    assert.notEqual(start, -1, `campaign matrix contains ${artifact}`);
    const next = plan.indexOf("\n              {", start);
    return plan.slice(start, next < 0 ? plan.length : next);
  };

  assert.match(entry("surface"), /proxy_assets: "0"/u, "surface keeps the direct production 302/CDN path");
  for (const artifact of ["depth", "mystery", "dirty"]) {
    assert.match(entry(artifact), /proxy_assets: "1"/u, `${artifact} explicitly shares the exact-SHA proxy`);
  }
  assert.match(
    jobBlock(workflow, "campaign"),
    /COOP_UI_PROXY_PRODUCTION_ASSETS: \$\{\{ matrix\.proxy_assets \}\}/u,
    "the matrix choice is wired into the sealed preview config",
  );
});

test("journey push qualification covers ordinary gameplay phases and statically owns CommandPhase", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8");
  assert.match(
    workflow,
    /- "src\/phases\/\*\*"/u,
    "a new or migrated gameplay phase cannot bypass the production two-browser journey",
  );
  const build = jobBlock(workflow, "browser-build");
  assert.match(
    build,
    /owned=.*src\/phases\/command-phase/u,
    "the journey rejects CommandPhase TypeScript diagnostics instead of treating them as baseline",
  );
  assert.match(
    build,
    /pnpm exec biome check[\s\S]*src\/phases\/command-phase\.ts/u,
    "the exact command-control boundary is part of the journey's format gate",
  );
});

test("browser qualifications statically own the biome-heal progression boundary", async () => {
  const journeyWorkflow = await readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8");
  const campaignWorkflow = await readFile(resolve(root, ".github/workflows/coop-public-ui-campaign.yml"), "utf8");
  const journeyBuild = jobBlock(journeyWorkflow, "browser-build");
  const campaignBuild = jobBlock(campaignWorkflow, "browser-build");
  assert.match(
    journeyBuild,
    /owned=.*src\/phases\/party-heal-phase/u,
    "PartyHealPhase TypeScript diagnostics cannot hide in the repository baseline",
  );
  assert.match(journeyBuild, /pnpm exec biome check[\s\S]*src\/phases\/party-heal-phase\.ts/u);
  assert.match(campaignBuild, /pnpm exec biome check[\s\S]*src\/phases\/party-heal-phase\.ts/u);
});

test("journey push defaults to fresh-wave2 while manual milestone runs retain fresh-resume", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8");
  const selectedJourneyExpression =
    "inputs.journey || (github.event_name == 'push' && 'fresh-wave2') || 'fresh-resume'";
  const workflowExpression = value => `${String.fromCodePoint(36)}{{ ${value} }}`;
  const selectedJourney = workflowExpression(selectedJourneyExpression);
  const githubRef = workflowExpression("github.ref");
  const normalCadence = workflowExpression("inputs.cadence || 'normal'");
  const primary = jobBlock(workflow, "primary-journey");

  assert.match(
    workflow,
    /workflow_dispatch:\s+inputs:\s+journey:[\s\S]{0,300}?default: fresh-resume[\s\S]{0,200}?- fresh-wave2\s+- fresh-resume/u,
    "manual and milestone dispatches keep fresh-resume as the visible default and explicit option",
  );
  assert.ok(
    workflow.includes("group: coop-public-ui-" + githubRef + "-" + selectedJourney),
    "concurrency identifies the journey that a push actually runs",
  );
  assert.ok(
    primary.includes("name: " + selectedJourney + " / " + normalCadence),
    "the job label identifies fresh-wave2 on push and fresh-resume on a default dispatch",
  );
  assert.ok(
    primary.includes("COOP_UI_JOURNEY: ${{ " + selectedJourneyExpression + " }}"),
    "the driver receives the same selected journey advertised by concurrency and the job label",
  );
  assert.doesNotMatch(
    primary,
    /inputs\.journey \|\| 'fresh-resume'/u,
    "a push must not silently retain the old two-launch journey through a stale fallback",
  );
});

test("same-tab rejoin journey preserves browser storage and proves a post-rejoin battle", async () => {
  const [workflow, config, evidence, browserEntry, harness, journeys] = await Promise.all([
    readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/config.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/evidence.mjs"), "utf8"),
    readFile(resolve(root, "scripts/coop-browser-entry.ts"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/journeys.mjs"), "utf8"),
  ]);

  assert.match(workflow, /options:[\s\S]*- same-tab-rejoin/u);
  assert.match(config, /"same-tab-rejoin"/u);
  assert.match(evidence, /Object\.keys\(sessionStorage\)[\s\S]*sessionStorage: sessionStorageMetadata/u);
  assert.match(
    harness,
    /async reloadInPlace\(\)[\s\S]*page\.reload\([\s\S]*async sameTabReloadAndRejoin\(\)/u,
    "the route must reload the existing tab rather than replace its context",
  );
  assert.match(harness, /pokerogue:coop:p33-reload-resume:v1/u);
  assert.match(harness, /expectedLifecycle: "reload-rejoin"/u);
  assert.match(
    harness,
    /const preReloadRoles = new Map[\s\S]*same-tab provisional host role after rejoin[\s\S]*same-tab-rejoin-role-restored/u,
    "reload must restore the exact proven role map before the human Resume decision creates the guest binding",
  );
  assert.match(harness, /findResponse\("\/coop\/v3\/rejoin"[\s\S]*status: 200[\s\S]*method: "POST"/u);
  assert.match(harness, /P33 peer generation advanced \\d\+->\\d\+ on authenticated hello/u);
  assert.match(
    browserEntry,
    /hasAuthenticatedPairing[\s\S]*p33FrameContext\(\)[\s\S]*p33MembershipSnapshot\(\)/u,
    "the public binding oracle must use the accepted P33 axes, not provisional V1 generation zero",
  );
  assert.match(
    evidence,
    /findBinding\([\s\S]*gameplayBindingReady === true[\s\S]*findPairingRole\(/u,
    "pairing role discovery must remain observable without promoting it to a gameplay binding",
  );
  assert.match(
    journeys,
    /async function sameTabRejoin\(rig\)[\s\S]*sameTabReloadAndRejoin\(\)[\s\S]*resumeRun\(\{ expectedWave: 2 \}\)[\s\S]*assertSameTabRejoinGeneration\([\s\S]*driveWaveToReward\(\)[\s\S]*connection-generation-mismatch/u,
    "the oracle must drive real post-rejoin mechanics and reject the player's stale-generation symptom",
  );
});

test("exact GameOver gate runs the retained guest-renderer phase-queue regression", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8");
  const build = jobBlock(workflow, "browser-build");
  assert.match(
    build,
    /Verify retained GameOver two-engine operation regression[\s\S]*coop-guest-renderer\.test\.ts/u,
    "the exact browser gate proves both the operation journal and its real guest phase-queue continuation",
  );
});

test("journey starter fixtures require both the exact build and exact per-page URL gate", async () => {
  const [workflow, registry, starterHandler] = await Promise.all([
    readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8"),
    readFile(resolve(root, "src/dev-tools/registry.ts"), "utf8"),
    readFile(resolve(root, "src/ui/handlers/starter-select-ui-handler.ts"), "utf8"),
  ]);

  assert.match(
    jobBlock(workflow, "browser-build"),
    /VITE_COOP_BROWSER_FIXTURE:.*commander-skip.*faint-replacement.*game-over.*registered-interactions.*showdown-battle.*off/u,
    "the sealed bundle receives one exact fixture identity and defaults closed",
  );
  assert.match(
    registry,
    /isCoopBrowserCommanderFixtureBuild\(\)[\s\S]*VITE_COOP_BROWSER_FIXTURE === "commander-skip"/u,
  );
  assert.match(registry, /isCoopBrowserFaintFixtureBuild\(\)[\s\S]*VITE_COOP_BROWSER_FIXTURE === "faint-replacement"/u);
  assert.match(registry, /isCoopBrowserGameOverFixtureBuild\(\)[\s\S]*VITE_COOP_BROWSER_FIXTURE === "game-over"/u);
  assert.match(
    registry,
    /isCoopBrowserRegisteredInteractionFixtureBuild\(\)[\s\S]*VITE_COOP_BROWSER_FIXTURE === "registered-interactions"/u,
  );
  assert.match(
    registry,
    /isCoopBrowserShowdownFixtureBuild\(\)[\s\S]*VITE_COOP_BROWSER_FIXTURE === "showdown-battle"/u,
  );
  assert.match(
    registry,
    /getCoopBrowserCommanderFixtureStarters\(\)[\s\S]*!isCoopBrowserCommanderFixtureBuild\(\)[\s\S]*get\("coopfixture"\)[\s\S]*"commander"[\s\S]*"dondozo"/u,
  );
  assert.match(
    registry,
    /getCoopBrowserFaintFixtureStarters\(\)[\s\S]*!isCoopBrowserFaintFixtureBuild\(\)[\s\S]*get\("coopfixture"\)[\s\S]*"faint-owner"[\s\S]*"faint-partner"/u,
  );
  assert.match(
    registry,
    /getCoopBrowserGameOverFixtureStarters\(\)[\s\S]*!isCoopBrowserGameOverFixtureBuild\(\)[\s\S]*get\("coopfixture"\)[\s\S]*"game-over"[\s\S]*MoveId\.MEMENTO/u,
  );
  assert.match(
    registry,
    /isCoopBrowserRegisteredInteractionFixtureActive\(\)[\s\S]*"registered-owner" \|\| fixture === "registered-partner"/u,
  );
  assert.match(
    registry,
    /getCoopBrowserRegisteredInteractionFixtureStarters\(\)[\s\S]*isCoopBrowserRegisteredInteractionFixtureActive\(\)[\s\S]*fixture === "registered-owner"[\s\S]*MoveId\.HEALING_WISH[\s\S]*MoveId\.REVIVAL_BLESSING[\s\S]*MoveId\.WATER_SPOUT[\s\S]*MoveId\.SPLASH/u,
  );
  assert.match(
    registry,
    /getCoopBrowserLongitudinalFixtureStartingLevel\(\)[\s\S]*isCoopBrowserRegisteredInteractionFixtureActive\(\)[\s\S]*\? 100/u,
    "the exact registered-interaction fixture starts overleveled enough to reach Stormglass",
  );
  assert.match(
    starterHandler,
    /const coopBrowserNavigationStarters = getCoopBrowserNavigationFixtureStarters\(\)[\s\S]*const coopBrowserPartyRewardStarters = getCoopBrowserPartyRewardFixtureStarters\(\)[\s\S]*const coopBrowserStarters =[\s\S]*\?\? coopBrowserPartyRewardStarters[\s\S]*\?\? coopBrowserNavigationStarters/u,
    "the visible starter UI resolves the exact-gated navigation and party-reward fixtures",
  );
  assert.match(
    starterHandler,
    /globalScene\.gameMode\.isCoop[\s\S]*seedTeamFromStarters\(coopBrowserStarters, \{[\s\S]*allowUncaught: true,[\s\S]*allowOverValueLimit:[\s\S]*coopBrowserStarters === coopBrowserNavigationStarters[\s\S]*\|\| coopBrowserStarters === coopBrowserPartyRewardStarters/u,
    "only the normal visible co-op starter UI consumes the exact-gated fixture",
  );
});

test("Ability Capsule journey forces and proves the nested reward Summary route in two real browsers", async () => {
  const [workflow, registry, selectModifier, starterHandler, config, harness, policy, campaign] = await Promise.all([
    readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8"),
    readFile(resolve(root, "src/dev-tools/registry.ts"), "utf8"),
    readFile(resolve(root, "src/phases/select-modifier-phase.ts"), "utf8"),
    readFile(resolve(root, "src/ui/handlers/starter-select-ui-handler.ts"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/config.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/campaign-policy.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/campaign.mjs"), "utf8"),
  ]);

  assert.match(workflow, /options:[\s\S]*- ability-capsule/u, "manual dispatch exposes the focused journey");
  assert.match(workflow, /inputs\.journey == 'ability-capsule' && 'ability-capsule'/u);
  assert.match(workflow, /COOP_UI_REQUIRE_ABILITY_CAPSULE:.*ability-capsule/u);
  assert.match(workflow, /COOP_UI_REWARD_INSPECT_SUMMARY:.*ability-capsule/u);
  assert.match(config, /"ability-capsule"/u, "the public driver accepts only the named journey");
  assert.match(
    registry,
    /isCoopBrowserAbilityCapsuleFixtureBuild\(\)[\s\S]*VITE_COOP_BROWSER_FIXTURE === "ability-capsule"/u,
  );
  assert.match(
    registry,
    /isCoopBrowserAbilityCapsuleFixtureActive\(\)[\s\S]*get\("coopfixture"\) === "ability-capsule"/u,
  );
  assert.match(
    registry,
    /getCoopBrowserAbilityCapsuleFixtureStarters\(\)[\s\S]*SpeciesId\.GARCHOMP[\s\S]*MoveId\.WATER_SPOUT/u,
  );
  assert.match(starterHandler, /getCoopBrowserAbilityCapsuleFixtureStarters\(\)/u);
  assert.match(harness, /this\.config\.journey === "ability-capsule"[\s\S]*set\("coopfixture", "ability-capsule"\)/u);
  assert.match(harness, /abilityCapsuleFixture[\s\S]*GARCHOMP_SPECIES_ID/u);
  assert.match(
    selectModifier,
    /isCoopBrowserAbilityCapsuleFixtureActive\(\)[\s\S]*coopRewardWave\(\) === 1[\s\S]*modifierTypes\.ER_ABILITY_CAPSULE/u,
    "the option authority removes random reward-pool coverage",
  );
  assert.match(policy, /COOP_UI_REQUIRE_ABILITY_CAPSULE/u);
  assert.match(policy, /COOP_UI_REWARD_INSPECT_SUMMARY/u);
  assert.match(campaign, /targetId: "party-option:summary"/u);
  assert.match(campaign, /findLastSemanticSurface\(summaryCursor, "summary"\)/u);
  assert.match(campaign, /campaign-reward-summary-inspection/u);
  assert.match(campaign, /campaign-ability-capsule-coverage/u);
  assert.match(campaign, /cursorMirrors\.some\(event => event\.navigationSteps < 1\)/u);
  assert.match(selectModifier, /modifierTypes\.POKEBALL, modifierTypes\.ER_ABILITY_CAPSULE/u);
});

test("party-mutating reward matrix drives every non-held mutation and nested item workflow into wave two", async () => {
  const [
    workflow,
    registry,
    selectModifier,
    selectStarter,
    starterHandler,
    config,
    harness,
    policy,
    campaign,
    browserEntry,
    greaterAbilityCapsulePhase,
    operationEnvelope,
    rewardOperation,
    coopRuntime,
    battleScene,
    modifier,
    evolutionPhase,
    learnMovePhase,
  ] = await Promise.all([
    readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8"),
    readFile(resolve(root, "src/dev-tools/registry.ts"), "utf8"),
    readFile(resolve(root, "src/phases/select-modifier-phase.ts"), "utf8"),
    readFile(resolve(root, "src/phases/select-starter-phase.ts"), "utf8"),
    readFile(resolve(root, "src/ui/handlers/starter-select-ui-handler.ts"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/config.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/campaign-policy.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/campaign.mjs"), "utf8"),
    readFile(resolve(root, "scripts/coop-browser-entry.ts"), "utf8"),
    readFile(resolve(root, "src/phases/er-greater-ability-capsule-phase.ts"), "utf8"),
    readFile(resolve(root, "src/data/elite-redux/coop/coop-operation-envelope.ts"), "utf8"),
    readFile(resolve(root, "src/data/elite-redux/coop/coop-reward-operation.ts"), "utf8"),
    readFile(resolve(root, "src/data/elite-redux/coop/coop-runtime.ts"), "utf8"),
    readFile(resolve(root, "src/battle-scene.ts"), "utf8"),
    readFile(resolve(root, "src/modifier/modifier.ts"), "utf8"),
    readFile(resolve(root, "src/phases/evolution-phase.ts"), "utf8"),
    readFile(resolve(root, "src/phases/learn-move-phase.ts"), "utf8"),
  ]);

  assert.match(workflow, /options:[\s\S]*- party-mutating-rewards/u);
  assert.match(
    workflow,
    /COOP_UI_BOOT_TIMEOUT_MS: \$\{\{ inputs\.journey == 'party-mutating-rewards' && '420000' \|\| '300000' \}\}/u,
    "only the measured high-fanout reward matrix receives extra immutable-asset boot headroom",
  );
  assert.match(workflow, /party_reward_ids:[\s\S]*Optional closed JSON subset/u);
  assert.match(
    workflow,
    /party_reward_id: \$\{\{ fromJSON\(inputs\.journey == 'party-mutating-rewards' && inputs\.party_reward_ids != '' && inputs\.party_reward_ids/u,
    "a demonstrated red subset must be rerunnable without spending 36 browsers again",
  );
  assert.match(
    workflow,
    /render_profile:[\s\S]*default: animations-skipped-depth[\s\S]*animations-on-surface[\s\S]*COOP_UI_RENDER_PROFILE: \$\{\{ inputs\.render_profile \|\| 'animations-skipped-depth' \}\}/u,
    "a focused item journey must be dispatchable with animations enabled without changing its public input path",
  );
  assert.match(
    workflow,
    /group: coop-public-ui-\$\{\{ github\.ref \}\}-\$\{\{ inputs\.journey[\s\S]*\$\{\{ inputs\.render_profile \|\| 'animations-skipped-depth' \}\}/u,
    "animations-on presentation qualification must not queue behind the independent fast mechanical profile",
  );
  const exactVariantRewardIds = new Set([
    "MINT",
    "TERA_SHARD",
    "EVOLUTION_ITEM",
    "RARE_EVOLUTION_ITEM",
    "FORM_CHANGE_ITEM",
    "RARE_FORM_CHANGE_ITEM",
  ]);
  for (const rewardId of [
    "TM_CASE",
    "ER_LEARNERS_SHROOM",
    "MEMORY_MUSHROOM",
    "TM_COMMON",
    "TM_GREAT",
    "TM_ULTRA",
    "ER_ABILITY_CAPSULE",
    "ER_GREATER_ABILITY_CAPSULE",
    "ER_GREATER_ABILITY_RANDOMIZER",
    "ABILITY_RANDOMIZER",
    "MOVE_SLOT_EXPANDER",
    "PP_UP",
    "PP_MAX",
    "ETHER",
    "MAX_ETHER",
    "ELIXIR",
    "MAX_ELIXIR",
    "MINT",
    "TERA_SHARD",
    "RARE_CANDY",
    "RARER_CANDY",
    "POTION",
    "SUPER_POTION",
    "HYPER_POTION",
    "MAX_POTION",
    "FULL_RESTORE",
    "REVIVE",
    "MAX_REVIVE",
    "FULL_HEAL",
    "SACRED_ASH",
    "EVOLUTION_ITEM",
    "RARE_EVOLUTION_ITEM",
    "FORM_CHANGE_ITEM",
    "RARE_FORM_CHANGE_ITEM",
    "DNA_SPLICERS",
    "ER_DEX_NAV",
  ]) {
    assert.match(workflow, new RegExp(`party_reward_id:[\\s\\S]*${rewardId}`, "u"));
    assert.match(registry, new RegExp(`COOP_BROWSER_PARTY_REWARD_FIXTURE_IDS[\\s\\S]*${rewardId}`, "u"));
    assert.match(selectModifier, new RegExp(`COOP_BROWSER_PARTY_REWARD_TYPES[\\s\\S]*${rewardId}`, "u"));
    assert.match(
      selectModifier,
      new RegExp(`${rewardId}: \\(\\) =>`, "u"),
      `${rewardId} must resolve after initModifierTypes instead of capturing the empty registry at module load`,
    );
    if (!exactVariantRewardIds.has(rewardId)) {
      assert.match(
        selectModifier,
        new RegExp(`${rewardId}: \\(\\) => modifierTypes\\.${rewardId},`, "u"),
        `${rewardId} must preserve its original registry function so the presentation has a canonical id`,
      );
    }
  }
  assert.match(config, /"party-mutating-rewards"/u);
  assert.match(browserEntry, /function safeAbilitySlotActivity\(pokemon: Pokemon\): boolean\[\]/u);
  assert.match(browserEntry, /abilitySlotActivity: safeAbilitySlotActivity\(pokemon\)/u);
  assert.match(browserEntry, /runUnlockedAbilitySlots:/u);
  assert.doesNotMatch(
    campaign,
    /changed = changed \|\| abilityChoices\.length/u,
    "an ability picker click is not proof that its Pokémon mutation committed",
  );
  assert.match(
    selectModifier,
    /modifierQueuesContinuation[\s\S]*modifierType instanceof ErDexNavModifierType/u,
    "Dex Nav must retain the reward continuation until its nested result commits",
  );
  assert.match(
    selectModifier,
    /coopModifierFollowUp[\s\S]*modifierType instanceof ErDexNavModifierType[\s\S]*return \{ kind: "ability", wave, turn \}/u,
    "Dex Nav's reward result must authorize its typed ability successor before wave progression",
  );
  assert.match(
    selectModifier,
    /v2ProjectsAbilitySurface[\s\S]*if \(modifierType instanceof ErDexNavModifierType\)[\s\S]*unshiftNew\("ErDexNavPhase", 0, seq, watcher\)[\s\S]*unshiftPhase\(this\.copy\(\)\)[\s\S]*return true;[\s\S]*const target = globalScene\.getPlayerParty\(\)\[slotIndex\]/u,
    "the targetless Dex Nav reward must retain its nested continuation before the ordinary Pokemon target guard",
  );
  assert.match(
    registry,
    /isCoopBrowserPartyRewardFixtureBuild\(\)[\s\S]*VITE_COOP_BROWSER_FIXTURE === "party-mutating-rewards"/u,
  );
  assert.match(registry, /getCoopBrowserPartyRewardFixtureId\(\)[\s\S]*get\("partyreward"\)/u);
  assert.match(
    registry,
    /getCoopBrowserPartyRewardFixtureStarters\(\)[\s\S]*SpeciesId\.GARCHOMP[\s\S]*MoveId\.WATER_SPOUT[\s\S]*MoveId\.TACKLE[\s\S]*MoveId\.SPLASH[\s\S]*MoveId\.PROTECT/u,
  );
  assert.match(
    registry,
    /getCoopBrowserLongitudinalFixtureStartingLevel\(\)[\s\S]*partyRewardFixture === "RARE_EVOLUTION_ITEM"[\s\S]*\? 70/u,
    "the rare evolution fixture retains a high-level legal Kubfu while exercising Scroll of Waters",
  );
  assert.match(
    registry,
    /partyRewardFixture === "EVOLUTION_ITEM"[\s\S]*\? 30/u,
    "the ordinary evolution fixture retains a deterministic legal Partner Pikachu",
  );
  assert.match(
    selectModifier,
    /\[coop-browser:evolution-item-legality\][\s\S]*remainingRuntimeItemEdges[\s\S]*validatesModifierItem[\s\S]*validatesOwnItem/u,
    "an evolution fixture rejection must identify the exact modifier, all post-ER item edges, and target verdict",
  );
  assert.match(
    selectModifier,
    /EVOLUTION_ITEM: \(\) => \(\) =>[\s\S]*EvolutionItem\.THUNDER_STONE[\s\S]*RARE_EVOLUTION_ITEM: \(\) => \(\) =>[\s\S]*EvolutionItem\.SCROLL_OF_WATERS/u,
    "the exact fixtures must use item edges that remain reachable after the ER evolution rewrite",
  );
  assert.match(
    registry,
    /rewardId === "EVOLUTION_ITEM"[\s\S]*SpeciesId\.PIKACHU[\s\S]*rewardId === "RARE_EVOLUTION_ITEM"[\s\S]*SpeciesId\.KUBFU/u,
  );
  assert.match(
    registry,
    /const subjectFormIndex = rewardId === "EVOLUTION_ITEM" \? 1 : 0;[\s\S]*makeStarter\(subjectSpecies, subjectFormIndex\)/u,
    "the ordinary fixture must retain Partner Pikachu form 1 rather than base Pikachu's rewritten level edge",
  );
  assert.match(starterHandler, /getCoopBrowserPartyRewardFixtureStarters\(\)/u);
  assert.match(
    starterHandler,
    /coopBrowserStarters === coopBrowserPartyRewardStarters/u,
    "the exact test fixture must retain its declared reserve despite the ordinary starter point budget",
  );
  assert.match(
    selectStarter,
    /const partyRewardFixtureActive = getCoopBrowserPartyRewardFixtureId\(\) != null;[\s\S]*navigationFixtureActive \|\| partyRewardFixtureActive[\s\S]*\? 0/u,
    "the exact party-mutation fixture must also retain its reserve in the mirrored roster envelope",
  );
  assert.match(
    harness,
    /this\.config\.journey === "party-mutating-rewards"[\s\S]*set\("coopfixture", "party-mutating-rewards"\)[\s\S]*set\("partyreward", this\.config\.partyRewardId\)/u,
  );
  assert.match(harness, /expectedPartyRewardFixtureSpecies\(this\.config\.partyRewardId\)/u);
  assert.match(
    harness,
    /PIKACHU_SPECIES_ID = 25[\s\S]*EVOLUTION_ITEM: PIKACHU_SPECIES_ID[\s\S]*RARE_EVOLUTION_ITEM: KUBFU_SPECIES_ID/u,
    "the browser roster oracle must distinguish the Partner Pikachu and rare Kubfu evolution fixtures",
  );
  assert.match(policy, /COOP_UI_PARTY_REWARD_ID/u);
  assert.match(policy, /partyRewardLearnMoveIds/u);
  assert.match(policy, /nestedDirectRewardIds/u);
  assert.match(workflow, /party-mutating-rewards" \]\]; then[\s\S]*export COOP_UI_CAMPAIGN_WAVES=1/u);
  assert.match(campaign, /driveLearnMoveAccept/u);
  assert.match(browserEntry, /summaryHandler\.summaryUiMode === SummaryUiMode\.LEARN_MOVE/u);
  assert.match(browserEntry, /"learn-move:cancel"/u);
  assert.match(campaign, /replacementMoveId[\s\S]*?selectOptionById\(owner,[\s\S]*?surfaceId: "learn-move:confirm"/u);
  assert.match(campaign, /selectedOptionId === "learn-move:cancel"/u);
  assert.match(campaign, /learn-move replacement confirmation or immediate commit/u);
  assert.match(campaign, /transitioned\.observation\.phase !== "LearnMovePhase"/u);
  assert.match(campaign, /campaign-learn-move-confirm-replacement/u);
  assert.match(campaign, /observation\.phase === "ErGreaterAbilityCapsulePhase" && options\.includes\("slot:1"\)/u);
  assert.match(
    greaterAbilityCapsulePhase,
    /if \(this\.coopIsWatcher\)[\s\S]*this\.coopSurfaceGeneration \+= 1;[\s\S]*notifyCoopV2InteractionSurfaceReady/u,
    "the passive Greater Capsule watcher must allocate a valid surface generation before publishing readiness",
  );
  assert.match(
    greaterAbilityCapsulePhase,
    /private coopSurfaceGeneration = 0;[\s\S]*public coopV2SurfaceGeneration\(\): number[\s\S]*private openChoice[\s\S]*this\.coopSurfaceGeneration \+= 1;/u,
    "the Greater Capsule owner workflow must expose distinct nested picker appearances",
  );
  assert.match(campaign, /finishRewardFusion/u);
  assert.match(campaign, /targetId: "party-option:splice"/u);
  assert.match(campaign, /DNA Splicers secondary target action or immediate fusion commit/u);
  assert.match(campaign, /resolution: "immediate"/u);
  assert.match(campaign, /campaign-party-mutating-reward-coverage/u);
  assert.match(
    campaign,
    /PARTY_REWARD_PRESENTATION_SURFACES[\s\S]*EVOLUTION_ITEM[\s\S]*battle:evolution[\s\S]*FORM_CHANGE_ITEM[\s\S]*battle:form-change/u,
    "animations-on item coverage must name the evolution-style presentation classes it owns",
  );
  assert.match(
    campaign,
    /assertPartyRewardPresentationParity[\s\S]*renderProfile !== "animations-on-surface"[\s\S]*client\.evidence\.events\.slice\(from\)[\s\S]*event\.kind === "browser-surface2"[\s\S]*campaign-party-reward-presentation-proof/u,
    "the exact item action must be followed by a fresh semantic cutscene on both real browsers",
  );
  assert.match(
    campaign,
    /presentationCursors: Object\.fromEntries\([\s\S]*client\.evidence\.cursor\(\)[\s\S]*assertPartyRewardPresentationParity\([\s\S]*targetAction\.presentationCursors/u,
    "unrelated earlier battle presentation cannot satisfy the item-specific oracle",
  );
  assert.match(
    selectModifier,
    /modifier instanceof EvolutionItemModifier[\s\S]*coopAllowNextWaveStart = globalScene\.gameMode\.isCoop && cost === -1/u,
    "only a terminal free evolution reward may inherit the wave-crossing successor permit",
  );
  assert.match(
    modifier,
    /EvolutionItemModifier[\s\S]*coopAllowNextWaveStart = false[\s\S]*"EvolutionPhase"[\s\S]*this\.coopAllowNextWaveStart/u,
    "the evolution modifier must carry its exact parent-boundary permit into the queued evolution",
  );
  assert.match(
    evolutionPhase,
    /this\.coopAllowNextWaveStart[\s\S]*"LearnMovePhase"[\s\S]*LearnMoveType\.LEARN_MOVE[\s\S]*this\.coopAllowNextWaveStart/u,
    "an evolve-move picker must inherit the terminal reward's successor permit",
  );
  assert.match(
    selectModifier,
    /coopPendingEvolutionSettlementOperationId[\s\S]*coopSettleRewardEvolution[\s\S]*coopPendingEvolutionSettlementOperationId = null[\s\S]*coopPendingAuthorityPresentation = structuredClone\(presentation\)[\s\S]*coopProveV2RewardOperationComplete\(operationId\)[\s\S]*coopCommitPendingAuthorityResult\(operationId\)/u,
    "an evolution reward must capture its asynchronous post-image and record exact terminal proof before committing",
  );
  assert.match(
    evolutionPhase,
    /installCoopV2TerminalSuccessor[\s\S]*proveCoopRewardEvolutionSettlement[\s\S]*coopSettleRewardEvolution[\s\S]*this\.postEvolve\(evolvedPokemon\)/u,
    "the live EvolutionPhase must install and prove the delayed reward successor before releasing children",
  );
  assert.match(
    evolutionPhase,
    /v2ControlLedger\.latestControl[\s\S]*v2ControlLedger\.sourceEntryOf\(successor\)[\s\S]*successor\?\.kind === "AWAIT_SUCCESSOR"[\s\S]*successor\.afterOperationId === operationId[\s\S]*successor\.wave === this\.coopRewardSourceWave[\s\S]*successor\.turn === this\.coopRewardSourceTurn[\s\S]*v2ControlLedger\.isMaterialApplied\(successor\)[\s\S]*sourceEntry\.operationId === operationId/u,
    "the authority EvolutionPhase may recover its post-commit successor only from the exact material-applied ledger claim",
  );
  assert.match(
    evolutionPhase,
    /shouldQueueCoopEvolutionReplicaNextWaveBridge[\s\S]*authorityRole === "replica" && allowNextWaveStart[\s\S]*runtime\?\.controller\.authorityRole[\s\S]*terminal\.successor\.allowNextWaveStart/u,
    "only the replica renderer may replace ordinary progression with the signed evolution successor bridge",
  );
  assert.match(
    coopRuntime,
    /settleEvolutionReplay[\s\S]*mayStartSelectedSuccessor[\s\S]*terminalWait = runtime\.v2ControlLedger\.latestControl[\s\S]*terminalWait\?\.kind === "AWAIT_SUCCESSOR"[\s\S]*terminalWait\.afterOperationId === op\.id[\s\S]*terminalWait\.allowNextWaveStart/u,
    "a delayed nested learn-move entry must keep the replica's unsigned local successor unstarted",
  );
  assert.match(
    learnMovePhase,
    /nextInteraction == null[\s\S]*this\.coopParentAllowsNextWaveStart/u,
    "the retained learn-move result must authorize wave N+1 when its item-evolution parent did",
  );
  assert.match(campaign, /targetAction\.partySlot !== targetAction\.beforePartySlot\?\.slot/u);
  assert.match(campaign, /targetAction\.beforePartySlot\?\.coopOwner !== "guest"/u);
  assert.match(campaign, /function latestPartyMaterialObservation\(client, minWave\)/u);
  assert.match(campaign, /observation\.surfaceId !== "unclassified"/u);
  assert.match(campaign, /assertPairedPartyMaterialFrontier\(configuredId, finalObservations\)/u);
  assert.doesNotMatch(
    campaign,
    /never reached a wave-2 command with the target visible/u,
    "a wave-2 Mystery surface is a valid post-mutation material frontier before CommandPhase",
  );
  assert.match(browserEntry, /maxMoveCount: pokemon\.getMaxMoveCount\(\)/u);
  assert.match(browserEntry, /fusionSpeciesId: pokemon\.fusionSpecies\?\.speciesId \?\? null/u);
  assert.match(browserEntry, /statusEffect: pokemon\.status\?\.effect \?\? null/u);
  assert.match(browserEntry, /innateAbilityIds: safeInnateIds\(pokemon\)/u);
  assert.match(browserEntry, /moves: pokemon\.getMoveset\(\)\.map/u);
  assert.match(browserEntry, /modifierStacks: observedPokemonModifierStacks\(pokemon\.id\)/u);
  assert.match(browserEntry, /uiMode === "ER_BARGAIN"[\s\S]*er-bargain-picker:option:/u);
  assert.match(campaign, /dexNav OWNER relay OUTCOME/u);
  assert.match(campaign, /dexChoices\.length !== 2/u);
  assert.match(
    campaign,
    /const priorChoiceIds = new Set\([\s\S]*event\.kind === "campaign-ability-choice"[\s\S]*event\.phase === driver\.abilityPhase[\s\S]*chooseAbilityInteractionOption\(surface\.observation, priorChoiceIds\)/u,
    "every repeated nested ability picker must exclude choices already submitted in that exact phase",
  );
  assert.match(
    campaign,
    /party-option:ability-slot-\$\{slot\}[\s\S]*!excludedOptionIds\.has\(optionId\)/u,
    "Greater Capsule cannot reuse its first innate while selecting the required second slot",
  );
  assert.match(
    browserEntry,
    /phase === "FormChangePhase" \|\| phase === "CoopFormChangeCutsceneReplayPhase"[\s\S]*surfaceId: "battle:form-change"/u,
  );
  assert.match(
    campaign,
    /"battle:form-change"[\s\S]*new Set\(\["FormChangePhase", "CoopFormChangeCutsceneReplayPhase"\]\)/u,
  );
  assert.match(
    operationEnvelope,
    /readonly presentation\?:[\s\S]*Extract<CoopBattleEvent, \{ readonly k: "formChange" \}>[\s\S]*CoopWaveProgressionPresentationV2[\s\S]*readonly k: "evolution"/u,
    "the immutable reward result must carry exact form-change or evolution presentation material",
  );
  assert.match(
    battleScene,
    /resolvePokemonFormChange\([\s\S]*return matchingFormChange \?\? null;[\s\S]*triggerPokemonFormChange\([\s\S]*this\.resolvePokemonFormChange/u,
    "presentation capture and ordinary mechanics must share the exact engine form-edge resolver",
  );
  assert.match(
    selectModifier,
    /coopPendingAuthorityPresentation[\s\S]*resolvePokemonFormChange\(formTarget, SpeciesFormChangeItemTrigger\)[\s\S]*presentation: "evolution"[\s\S]*commitRewardAuthoritativeResult\([\s\S]*presentation: this\.coopPendingAuthorityPresentation/u,
    "the authority must bind the queued form edge to the same reward result that produced it",
  );
  assert.match(
    rewardOperation,
    /isStrictCoopBattleEvent\(presentation\)[\s\S]*isValidWaveProgressionPresentation\(presentation\)[\s\S]*presentation: structuredClone\(presentation\)/u,
    "malformed presentation material cannot enter a reward commit",
  );
  assert.match(
    coopRuntime,
    /v2RewardPresentationOutcomes[\s\S]*coopPresentationOutcome\(pending\)[\s\S]*unshiftNew\("CoopFormChangeReplayPhase", structuredClone\(presentation\), outcomeToken\)[\s\S]*settleCoopPresentationOutcome[\s\S]*"CoopWaveProgressionReplayPhase"[\s\S]*return false;/u,
    "the replica must withhold material completion until its mechanics-free replay reaches a bounded terminal",
  );
});

test("evolution-sync journey proves both real-browser evolution prompts before wave two", async () => {
  const [workflow, registry, selectStarter, starterHandler, pokemon, config, harness, journeys] = await Promise.all([
    readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8"),
    readFile(resolve(root, "src/dev-tools/registry.ts"), "utf8"),
    readFile(resolve(root, "src/phases/select-starter-phase.ts"), "utf8"),
    readFile(resolve(root, "src/ui/handlers/starter-select-ui-handler.ts"), "utf8"),
    readFile(resolve(root, "src/field/pokemon.ts"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/config.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/journeys.mjs"), "utf8"),
  ]);
  const browserEntry = await readFile(resolve(root, "scripts/coop-browser-entry.ts"), "utf8");

  assert.match(workflow, /options:[\s\S]*- evolution-sync/u, "manual dispatch exposes the exact evolution journey");
  assert.match(
    jobBlock(workflow, "browser-build"),
    /inputs\.journey == 'evolution-sync' && 'evolution-sync'/u,
    "the sealed browser bundle carries the dedicated fixture identity",
  );
  assert.match(
    registry,
    /isCoopBrowserEvolutionFixtureBuild\(\)[\s\S]*VITE_COOP_BROWSER_FIXTURE === "evolution-sync"/u,
  );
  assert.match(
    registry,
    /isCoopBrowserEvolutionFixtureActive\(\)[\s\S]*isCoopBrowserEvolutionFixtureBuild\(\)[\s\S]*get\("coopfixture"\) === "evolution-sync"/u,
    "a copied URL token cannot activate the fixture in an ordinary bundle",
  );
  assert.match(
    registry,
    /getCoopBrowserEvolutionFixtureStarters\(\)[\s\S]*isCoopBrowserEvolutionFixtureActive\(\)[\s\S]*SpeciesId\.CATERPIE[\s\S]*SpeciesId\.CASTFORM[\s\S]*SpeciesId\.SPINDA/u,
  );
  assert.match(
    registry,
    /SpeciesId\.CATERPIE, moveId: MoveId\.MAKE_IT_RAIN/u,
    "the level-6 evolution subject ends the battle quickly enough to survive to its ordinary EXP award",
  );
  assert.match(
    registry,
    /getCoopBrowserLongitudinalFixtureStartingLevel\(\)[\s\S]*isCoopBrowserEvolutionFixtureActive\(\)[\s\S]*\? 6[\s\S]*\? 100[\s\S]*: null/u,
    "evolution starts below the level cap while longitudinal fixtures remain level 100",
  );
  assert.match(
    registry,
    /shouldPauseCoopBrowserLongitudinalFixtureEvolutions\(\)[\s\S]*isCoopBrowserCampaignSurvivalFixtureActive\(\)[\s\S]*isCoopBrowserNavigationFixtureActive\(\)/u,
    "survival/navigation fixtures remain paused while evolution-sync remains live",
  );
  assert.match(
    selectStarter,
    /shouldPauseCoopBrowserLongitudinalFixtureEvolutions\(\)[\s\S]*initBattle\([\s\S]*fixturePauseEvolutions/u,
    "launch separates initial level from the evolution-pause policy",
  );
  assert.match(
    pokemon,
    /public pauseEvolutions = false;/u,
    "freshly constructed authority mons and serialized replicas share one explicit evolution flag",
  );
  assert.match(
    selectStarter,
    /isCoopBrowserEvolutionFixtureActive\(\)[\s\S]*!primedEvolutionFixtureSubject[\s\S]*starterPokemon\.species\.speciesId === SpeciesId\.CATERPIE[\s\S]*starterPokemon\.exp = getLevelTotalExp\(starterLevel \+ 1, starterPokemon\.species\.growthRate\) - 1[\s\S]*primedEvolutionFixtureSubject = true/u,
    "the exact initial-save fixture primes one Caterpie one EXP below its next level",
  );
  assert.match(starterHandler, /getCoopBrowserEvolutionFixtureStarters\(\)[\s\S]*seedTeamFromStarters/u);
  assert.match(config, /"evolution-sync"/u);
  assert.match(
    harness,
    /this\.config\.journey === "evolution-sync"[\s\S]*searchParams\.set\("coopfixture", "evolution-sync"\)/u,
  );
  assert.match(
    harness,
    /startFreshRun\(\{[\s\S]*evolutionFixture = false[\s\S]*evolutionFixture[\s\S]*CATERPIE_SPECIES_ID, CASTFORM_SPECIES_ID, SPINDA_SPECIES_ID/u,
    "the public driver proves the exact visible seeded team instead of adding generic starters to it",
  );
  assert.match(
    journeys,
    /async function evolutionSync\(rig\)[\s\S]*rig\.pair\(rig\.config\.requesterSeat\)[\s\S]*rig\.startFreshRun\(\{ evolutionFixture: true \}\)[\s\S]*assertEvolutionFixtureParty\(rig\)[\s\S]*rig\.driveWaveToReward\(\)/u,
  );
  assert.doesNotMatch(
    journeys,
    /async function evolutionSync\(rig\)[\s\S]*freshThroughWave2\(rig, \{ evolutionFixture: true \}\)/u,
    "the focused evolution proof must stop at its authoritative reward successor, before unrelated wave-two RNG",
  );
  assert.match(
    journeys,
    /function assertEvolutionFixtureParty\(rig[\s\S]*speciesId: 10[\s\S]*level: 6[\s\S]*pauseEvolutions: false[\s\S]*freshRunOptions\?\.evolutionFixture[\s\S]*assertEvolutionFixtureParty\(rig/u,
    "the journey proves the exact launch material before it spends a battle input",
  );
  assert.match(journeys, /event\.k === "evolution"/u, "the immutable wave ledger must contain a real evolution");
  assert.match(journeys, /surfaceId === "battle:evolution"/u);
  assert.match(journeys, /requireEvolutionPromptProof\(rig\.host, "EvolutionPhase"\)/u);
  assert.match(journeys, /requireEvolutionPromptProof\(rig\.guest, "CoopWaveProgressionReplayPhase"\)/u);
  assert.match(
    journeys,
    /requireEvolutionPromptProof[\s\S]*isActionableSemanticObservation\(event\.observation, \{[\s\S]*requireExplicitUnblocked: true/u,
    "the final evolution oracle must use the same optional-blocking readiness contract as the keyboard driver",
  );
  assert.match(journeys, /kind === "campaign-battle-prompt-advance"/u);
  assert.match(
    browserEntry,
    /NON_INTERACTIVE_SEMANTIC_TRANSITION_PHASES = new Set\(\["EndEvolutionPhase"\]\)/u,
    "the observer names the native non-interactive evolution teardown explicitly",
  );
  assert.match(
    browserEntry,
    /NON_INTERACTIVE_SEMANTIC_TRANSITION_PAIRS = new Set\(\[[\s\S]*"SelectModifierPhase:EVOLUTION_SCENE"[\s\S]*"LearnMovePhase:EVOLUTION_SCENE"[\s\S]*\]\)/u,
    "the observer suppresses sampled reward and learn-move phase handoffs while evolution UI still owns the screen",
  );
  assert.match(
    browserEntry,
    /semantic == null\s*&&\s*\(NON_INTERACTIVE_SEMANTIC_TRANSITION_PHASES\.has\(phase\)\s*\|\|\s*NON_INTERACTIVE_SEMANTIC_TRANSITION_PAIRS\.has\(`\$\{phase\}:\$\{uiMode\}`\)\)[\s\S]*lastSemanticObservation = "";[\s\S]*return;/u,
    "a stale evolution handler closes observation state instead of emitting a fatal unclassified surface",
  );
  assert.match(journeys, /"evolution-sync": evolutionSync/u);
});

test("registered-interaction journey reaches Revival, Stormglass, and its Mystery successor through public UI", async () => {
  const [workflow, config, harness, commandPhase, campaign, registry, starterCosts, gauntlet] = await Promise.all([
    readFile(resolve(root, ".github/workflows/coop-public-ui-journey.yml"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/config.mjs"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8"),
    readFile(resolve(root, "src/phases/command-phase.ts"), "utf8"),
    readFile(resolve(root, "test/browser/coop-public-ui/campaign.mjs"), "utf8"),
    readFile(resolve(root, "src/dev-tools/registry.ts"), "utf8"),
    readFile(resolve(root, "src/data/balance/starters.ts"), "utf8"),
    readFile(resolve(root, "src/data/elite-redux/er-mystery-gauntlet.ts"), "utf8"),
  ]);
  assert.match(workflow, /- registered-interactions/u);
  assert.match(config, /"registered-interactions"/u);
  assert.match(
    workflow,
    /COOP_UI_REQUIRE_REGISTERED_INTERACTIONS:.*registered-interactions.*'1'[\s\S]*COOP_UI_PREFERRED_MOVE_ID:.*'863'/u,
  );
  assert.match(
    workflow,
    /COOP_UI_DIFFICULTY_ID:.*registered-interactions.*'mystery'.*'ace'[\s\S]*COOP_UI_DIFFICULTY_OPTION_ID:.*registered-interactions.*'mystery'.*'ace'/u,
    "the focused journey selects the real Mystery difficulty through the same public option driver",
  );
  assert.match(
    workflow,
    /VITE_DEV_TOOLS:.*inputs\.journey == 'registered-interactions'.*'1'.*'0'/u,
    "the focused journey's sealed bundle exposes staging's dev-gated Mystery picker and no other journey does",
  );
  assert.match(
    workflow,
    /== "registered-interactions"[\s\S]*export COOP_UI_CAMPAIGN_WAVES=2/u,
    "the focused occurrence journey remains alive through a same-wave embedded battle and the completed Mystery terminal",
  );
  assert.match(workflow, /== "market-wide-lens" \|\| .* == "registered-interactions"[\s\S]*run-campaign\.mjs/u);
  assert.match(harness, /journey === "registered-interactions"[\s\S]*"registered-owner"[\s\S]*"registered-partner"/u);
  assert.match(
    gauntlet,
    /VITE_COOP_BROWSER_FIXTURE === "registered-interactions"[\s\S]*registered-owner[\s\S]*registered-partner[\s\S]*MysteryEncounterType\.FUN_AND_GAMES/u,
    "the exact registered journey forces the exceptional direct-turn Mystery battle",
  );
  assert.match(
    registry,
    /getCoopBrowserNavigationFixtureStartingMoney[\s\S]*isCoopBrowserRegisteredInteractionFixtureActive\(\)[\s\S]*return 100_000/u,
    "the paid Mystery option is enabled only through exact initial-save fixture money",
  );
  const fixtureStart = registry.indexOf("export function getCoopBrowserRegisteredInteractionFixtureStarters");
  const fixtureEnd = registry.indexOf("\n}\n\n/**", fixtureStart);
  const fixture = registry.slice(fixtureStart, fixtureEnd);
  const ownerStart = fixture.indexOf('fixture === "registered-owner"');
  const partnerStart = fixture.indexOf(": [{ speciesId: SpeciesId.BULBASAUR", ownerStart);
  const ownerFixture = fixture.slice(ownerStart, partnerStart);
  assert.match(ownerFixture, /SpeciesId\.MAGIKARP/u);
  assert.match(ownerFixture, /SpeciesId\.SEEL/u);
  assert.doesNotMatch(ownerFixture, /SpeciesId\.RATTATA/u, "the real five-point UI must not reject an illegal reserve");
  const starterCost = speciesName => {
    const match = starterCosts.match(new RegExp(`\\[SpeciesId\\.${speciesName}\\]: (\\d+),`, "u"));
    assert.ok(match, `starter cost is declared for ${speciesName}`);
    return Number(match[1]);
  };
  assert.ok(
    starterCost("MAGIKARP") + starterCost("SEEL") <= 5,
    "the registered owner fixture must remain legal under the real co-op starter budget",
  );
  assert.match(
    harness,
    /registeredInteractionsFixture[\s\S]*\[MAGIKARP_SPECIES_ID, SEEL_SPECIES_ID\][\s\S]*\[BULBASAUR_SPECIES_ID\]/u,
    "the public driver waits only for the exact roster that the production starter UI can accept",
  );
  assert.match(
    commandPhase,
    /installCoopBrowserRegisteredInteractionFixture\(this\.fieldIndex\)[\s\S]*tryCoopCheckpointSync\(\)/u,
    "the host grants Stormglass before sealing the first authoritative command checkpoint",
  );
  assert.match(
    campaign,
    /driveRegisteredInteraction = createBattleRegisteredInteractionDriver[\s\S]*waitForOutcomeBounded[\s\S]*driveRegisteredInteraction/u,
    "the real mid-turn Revival surface remains driven while waiting for the next battle frontier",
  );
  assert.match(
    campaign,
    /policy\.mysteryGauntlet\.required \|\| policy\.navigation\.required \|\| policy\.registeredInteractions\.required[\s\S]*createRegisteredSurfaceProgressBudget/u,
    "each proven public Mystery action extends only the bounded registered-surface budget",
  );
  assert.match(
    campaign,
    /interactionAddresses:op%3Ame:ME_PRESENT:w2:t0/u,
    "the browser oracle requires the exact pre-turn Mystery successor address",
  );
  assert.match(
    campaign,
    /registeredInteractionCoverage\.revival\.length !== 1[\s\S]*registeredInteractionCoverage\.stormglass\.length !== 1[\s\S]*stormglassMysterySuccessor == null[\s\S]*completedMysterySuccessor == null[\s\S]*campaign-registered-interactions/u,
    "the journey cannot pass until the t0 Mystery successor is admitted and its real terminal reaches a later wave",
  );
  assert.match(
    campaign,
    /completedMysterySuccessor\.mysteryEncounterType !== 27/u,
    "an arbitrary no-battle Mystery completion cannot satisfy the Wobbuffet regression",
  );
});

test("Commander journey proves deterministic co-op entry presentation before public command", async () => {
  const harness = await readFile(resolve(root, "test/browser/coop-public-ui/public-ui-harness.mjs"), "utf8");
  const proofStart = harness.indexOf("  assertCommanderEntryPresentation(boundary, purpose)");
  const proofEnd = harness.indexOf("\n  /** Prove the hidden", proofStart);
  assert.notEqual(proofStart, -1, "Commander owns a bounded entry-presentation proof");
  assert.ok(proofEnd > proofStart, "Commander entry-presentation proof has a bounded source block");
  const proof = harness.slice(proofStart, proofEnd);
  assert.match(proof, /assertPresentationLedger\(\s*boundary\.cursors/u);
  for (const kind of ["showAbility", "pokemonAnim", "statStage"]) {
    assert.match(proof, new RegExp(`"${kind}"`, "u"));
  }
  assert.match(proof, /commander-entry-presentation-proof/u);
  assert.match(
    harness,
    /waitForCommanderCommandBoundaryDrivingBattlePrompts\([\s\S]*?assertCommanderEntryPresentation\(boundary, "fresh-wave-1-commander-presentation"\)[\s\S]*?pendingCommanderBoundary = boundary/u,
  );
});
