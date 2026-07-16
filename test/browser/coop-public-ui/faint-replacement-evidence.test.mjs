/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("faint replacement waits for the owned actionable party surface before pressing", async () => {
  const [harness, browserEntry] = await Promise.all([
    readFile(new URL("public-ui-harness.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../../scripts/coop-browser-entry.ts", import.meta.url), "utf8"),
  ]);

  assert.match(browserEntry, /phase === "SwitchPhase" \|\| phase === "CoopGuestFaintSwitchPhase"/u);
  assert.match(browserEntry, /surfaceId: "party:replacement"/u);
  assert.match(
    browserEntry,
    /semantic\.operationClass === "replacement" && uiMode === "PARTY"[\s\S]*?ownerSeat = localReplacementOwner/u,
  );
  assert.match(harness, /findLastSemanticSurface\(from, "party:replacement"\)/u);
  assert.match(harness, /semantic\.observation\.ownerSeat === client\.publicSeat/u);
  assert.match(harness, /semantic\.observation\.seatsWithInput\?\.includes\(client\.publicSeat\)/u);
  assert.match(harness, /await this\.driveReplacement\(outcome\.client, outcomeCursors\)/u);
  assert.match(
    harness,
    /createBattlePromptAdvancer\([\s\S]*?"faint-replacement-picker"[\s\S]*?findOwnedReadyReplacement\(owner,[\s\S]*?await owner\.sequence\(this\.config\.keys\.replacement/u,
  );
});
