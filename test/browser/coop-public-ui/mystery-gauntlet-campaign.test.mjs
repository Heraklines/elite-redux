/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { buildDispatchTable, loadCampaignPolicy } from "./campaign-policy.mjs";

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
      const surfaces = buildDispatchTable(policy).map(driver => driver.v2SurfaceId);
      assert.deepEqual(
        ["mystery-encounter", "mystery-encounter:prompt", "quiz", "bargain", "colosseum"].filter(
          surface => !surfaces.includes(surface),
        ),
        [],
      );
    },
  );
});

test("workflow builds the staging-only fifth difficulty and fans a fixed ten-wave profile", async () => {
  const workflow = await readFile(resolve(root, ".github/workflows/coop-public-ui-campaign.yml"), "utf8");
  assert.match(workflow, /VITE_DEV_TOOLS: 1/u);
  assert.match(
    workflow,
    /profile: mystery-gauntlet\s+artifact: mystery\s+waves: "10"\s+difficulty: mystery\s+difficulty_option: mystery-test\s+require_mystery: "1"/u,
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
  assert.match(campaign, /event\.terminal\.wave === wave \+ 1/u);
  assert.match(campaign, /if \(nextBoundary\.wave <= event\.wave\)/u);
  assert.match(campaign, /mysteryEvents: mysteryCoverage\.events/u);
  assert.match(campaign, /ordinal <= policy\.maxBattleLoops/u);
  assert.match(campaign, /\[campaign-loop-budget\]/u);
  assert.match(campaign, /return "target-reached"/u);
  assert.match(campaign, /wave-\$\{event\.wave\}-mystery-terminal/u);
  assert.match(campaign, /battleType: observation\.battleType/u);
  assert.match(campaign, /maxBossSegments: observation\.maxBossSegments/u);
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
