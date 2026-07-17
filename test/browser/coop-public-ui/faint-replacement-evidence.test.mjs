/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { findOwnedActionableReplacementSurface, replacementTargetOptionId } from "./campaign-nav.mjs";

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
  assert.match(harness, /findOwnedActionableReplacementSurface\(client, from\)/u);
  assert.match(harness, /replacementTargetOptionId\(replacementSurface\.observation\)/u);
  assert.match(harness, /await this\.driveReplacement\(outcome\.client, outcomeCursors\)/u);
  assert.match(
    harness,
    /createBattlePromptAdvancer\([\s\S]*?"faint-replacement-picker"[\s\S]*?findOwnedReadyReplacement\(owner,[\s\S]*?targetId: "party-option:send-out"/u,
  );
});

for (const phase of ["SwitchPhase", "CoopGuestFaintSwitchPhase"]) {
  test(`replacement consumer accepts the actionable ${phase} owner surface`, () => {
    const event = {
      observation: {
        surfaceId: "party:replacement",
        operationClass: "replacement",
        ownerModel: "interaction",
        phase,
        uiMode: "PARTY",
        localSeat: 1,
        ownerSeat: 1,
        seatsWithInput: [1],
        ready: { handlerActive: true, inputBlocked: false },
        partySlots: [
          { slot: 0, fainted: true, active: true, replacementEligible: false },
          { slot: 1, fainted: false, active: false, replacementEligible: true },
        ],
      },
    };
    const client = {
      publicSeat: 1,
      evidence: { findLastSemanticSurface: () => event },
    };
    assert.equal(findOwnedActionableReplacementSurface(client, 0), event);
    assert.equal(replacementTargetOptionId(event.observation), "party-slot:1");
  });
}
