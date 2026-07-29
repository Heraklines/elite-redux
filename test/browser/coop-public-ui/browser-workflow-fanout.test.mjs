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
  assert.match(journey, /COOP_UI_HEADLESS: "0"/u);
  assert.match(journey, /COOP_UI_SEAT_PROFILE_DIR: \$\{\{ runner\.temp \}\}\/coop-seat-profiles/u);
  assert.match(journey, /Xvfb :98[\s\S]*Xvfb :99/u);
  assert.match(journey, /COOP_UI_DISPLAY_HOST=:98 COOP_UI_DISPLAY_GUEST=:99/u);
  assert.match(
    journey,
    /export COOP_UI_DISPLAY_HOST=:98 COOP_UI_DISPLAY_GUEST=:99[\s\S]*if \[\[/u,
    "the display assignment must cover both conditional journey entrypoints",
  );
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
    primary.includes(
      "COOP_UI_JOURNEY: ${{ inputs.journey == 'market-wide-lens' && 'probe' || " + selectedJourneyExpression + " }}",
    ),
    "the driver receives the same selected journey advertised by concurrency and the job label",
  );
  assert.doesNotMatch(
    primary,
    /inputs\.journey \|\| 'fresh-resume'/u,
    "a push must not silently retain the old two-launch journey through a stale fallback",
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
    /VITE_COOP_BROWSER_FIXTURE:.*commander-skip.*faint-replacement.*game-over.*showdown-battle.*off/u,
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
    starterHandler,
    /getCoopBrowserCommanderFixtureStarters\(\)[\s\S]*\?\? getCoopBrowserFaintFixtureStarters\(\)[\s\S]*\?\? getCoopBrowserGameOverFixtureStarters\(\)[\s\S]*globalScene\.gameMode\.isCoop[\s\S]*seedTeamFromStarters\(coopBrowserStarters, \{ allowUncaught: true \}\)/u,
    "only the normal visible co-op starter UI consumes the exact-gated fixture",
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
