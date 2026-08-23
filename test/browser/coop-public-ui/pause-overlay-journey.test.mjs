/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);

test("Authority V2 admits only provenance-checked local pause overlays", async () => {
  const [registry, ui, uiInputs, observer] = await Promise.all([
    readFile(new URL("src/data/elite-redux/coop/coop-ui-registry.ts", root), "utf8"),
    readFile(new URL("src/ui/ui.ts", root), "utf8"),
    readFile(new URL("src/ui-inputs.ts", root), "utf8"),
    readFile(new URL("scripts/coop-browser-entry.ts", root), "utf8"),
  ]);

  assert.match(
    registry,
    /export function coopLocalOverlayInputAllowed[\s\S]*lastIndexOf\(UiMode\.MENU\)[\s\S]*modeChain\.slice\(menuIndex \+ 1\)[\s\S]*coopUiClassOf\(mode\) === "local-only"/u,
  );
  assert.match(
    ui,
    /localOverlayInput = coopLocalOverlayInputAllowed\(this\.mode, this\.modeChain\)[\s\S]*isCoopV2InteractionHumanInputFrozen\(\)[\s\S]*!localPresentationInput[\s\S]*!localOverlayInput/u,
  );
  assert.match(
    uiInputs,
    /case UiMode\.SETTINGS:[\s\S]*case UiMode\.SETTINGS_DISPLAY:[\s\S]*globalScene\.ui\.processInput\(Button\.CANCEL\)/u,
  );
  assert.match(observer, /case "MENU":[\s\S]*surfaceId: "pause-menu"[\s\S]*ownerModel: "local"/u);
  assert.match(observer, /case "SETTINGS":[\s\S]*surfaceId: "pause-settings"[\s\S]*ownerModel: "local"/u);
  assert.match(
    observer,
    /localOverlayInput = coopLocalOverlayInputAllowed\(ui\.getMode\(\), ui\.getModeChain\(\)\)[\s\S]*v2SurfaceInputBlocked[\s\S]*!localOverlayInput/u,
  );
});

test("a two-browser journey opens, drives, closes, and resumes Settings during a shared reward", async () => {
  const [journeys, config, workflow] = await Promise.all([
    readFile(new URL("test/browser/coop-public-ui/journeys.mjs", root), "utf8"),
    readFile(new URL("test/browser/coop-public-ui/config.mjs", root), "utf8"),
    readFile(new URL(".github/workflows/coop-public-ui-journey.yml", root), "utf8"),
  ]);
  const start = journeys.indexOf("async function rewardPauseSettings");
  const end = journeys.indexOf("function requireEvolutionPromptProof", start);
  assert.ok(start >= 0 && end > start, "the reward pause/settings journey must be a bounded source block");
  const journey = journeys.slice(start, end);

  assert.match(journey, /await rig\.driveWaveToReward\(\)/u);
  assert.match(journey, /owner\.press\("Escape", "reward-open-local-pause-menu"\)/u);
  assert.match(journey, /waitForActionableSemanticSurface\(owner, "pause-menu"/u);
  assert.match(journey, /owner\.press\("Space", "reward-pause-open-game-settings"\)/u);
  assert.match(journey, /waitForActionableSemanticSurface\(owner, "pause-settings"/u);
  assert.match(journey, /owner\.press\("ArrowDown", "reward-pause-settings-move-cursor"\)/u);
  assert.match(journey, /owner\.press\("Escape", "reward-pause-settings-back-to-menu"\)/u);
  assert.match(journey, /owner\.press\("Escape", "reward-close-local-pause-menu"\)/u);
  assert.match(journey, /sameBattleAddress[\s\S]*stateDigest[\s\S]*selectedOptionId/u);
  assert.match(journey, /await rig\.leaveRewardsAndReachWave2\(\)/u);
  assert.match(journeys, /"reward-pause-settings": rewardPauseSettings/u);
  assert.match(config, /"reward-pause-settings"/u);
  assert.match(workflow, /- reward-pause-settings/u);
});
