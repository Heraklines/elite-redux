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
  const guestPicker = await readFile(
    new URL("../../../src/phases/coop-guest-faint-switch-phase.ts", import.meta.url),
    "utf8",
  );
  const stream = await readFile(
    new URL("../../../src/data/elite-redux/coop/coop-battle-stream.ts", import.meta.url),
    "utf8",
  );
  const hostSwitch = await readFile(new URL("../../../src/phases/switch-phase.ts", import.meta.url), "utf8");

  assert.match(browserEntry, /phase === "SwitchPhase" \|\| phase === "CoopGuestFaintSwitchPhase"/u);
  assert.match(browserEntry, /surfaceId: "party:replacement"/u);
  assert.match(browserEntry, /const coopOwner = pokemon\.coopOwner \?\? null/u);
  assert.match(browserEntry, /coopOwner === localRole/u);
  assert.match(
    browserEntry,
    /semantic\.operationClass === "replacement" && uiMode === "PARTY"[\s\S]*?ownerSeat = localReplacementOwner/u,
  );
  assert.match(harness, /findOwnedActionableReplacementSurface\(client, from\)/u);
  assert.match(harness, /replacementTargetOptionId\(replacementSurface\.observation\)/u);
  assert.match(harness, /await this\.driveReplacement\(outcome\.client, outcomeCursors\)/u);
  assert.match(guestPicker, /registerCoopFaintSwitchPickerTerminal\(/u);
  assert.match(guestPicker, /wave: sourceWave,[\s\S]*turn: sourceTurn/u);
  assert.match(guestPicker, /guest own-faint picker CLOSE from committed authority/u);
  assert.match(stream, /acceptsCheckpointAddress\(envelope: CoopCheckpointEnvelope\)/u);
  assert.match(stream, /peekCheckpointForTurn\(turn: number\)/u);
  assert.match(hostSwitch, /const operationSourceAddress = this\.faintSourceAddress \?\? \{[\s\S]*wave:[\s\S]*turn:/u);
  assert.match(hostSwitch, /const sourceAddress = operationSourceAddress/u);
  assert.match(hostSwitch, /waitForOperationMaterialApplied\(operationId\)[\s\S]*releaseAfterPeerMaterial\(\)/u);
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
          { slot: 0, coopOwner: "guest", fainted: true, active: true, replacementEligible: false },
          { slot: 1, coopOwner: "guest", fainted: false, active: false, replacementEligible: true },
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

test("replacement targeting never selects a healthy partner-owned reserve", () => {
  const observation = {
    partySlots: [
      { slot: 2, coopOwner: "host", fainted: false, active: false, replacementEligible: false },
      { slot: 3, coopOwner: "guest", fainted: false, active: false, replacementEligible: true },
    ],
  };
  assert.equal(replacementTargetOptionId(observation), "party-slot:3");
});
