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
