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

test("the replacement picker drive gates its battle-prompt advancer to picker-open (dirty lane)", async () => {
  const harness = await readFile(new URL("public-ui-harness.mjs", import.meta.url), "utf8");
  // Track R run 29644735938 dirty lane: a FRESH createBattlePromptAdvancer scanning from the pre-faint
  // cursor re-matched an already-consumed pre-picker battle:message and pressed Space THROUGH the
  // picker's MESSAGE intro into the PARTY UI. The drive must confine the advancer to the picker-open
  // index so it can only match narration prompts born at-or-after the picker opened.
  const drive = harness.slice(
    harness.indexOf("async driveOwnedReplacementPicker("),
    harness.indexOf("async leaveRewardsAndReachWave2("),
  );
  assert.ok(drive.length > 0, "driveOwnedReplacementPicker must precede leaveRewardsAndReachWave2");
  assert.match(
    drive,
    /const pickerOpenIndex = findReplacementPickerOpenIndex\(owner, replacementCursors\[owner\.label\]/u,
  );
  assert.match(drive, /const advancerCursors = \{ \.\.\.replacementCursors, \[owner\.label\]: pickerOpenIndex \}/u);
  // Track R animations-on-surface lane: a faint window has NO shared public command address (the fainted
  // owner is in its picker while the partner holds/left the command surface), so the advancer must NOT
  // require one - the default eager currentSharedCommandAddress THREW "requires one shared public command
  // address" on a staggered/double faint. It drives only local faint-replay narration by live address.
  assert.match(
    drive,
    /createBattlePromptAdvancer\(this, advancerCursors, \{\}, "faint-replacement-picker", \{\s*requireSharedCommandAddress: false,\s*\}\)/u,
  );
  // The picker-open finder itself uses the first party:replacement surface / SwitchPhase-class start.
  assert.match(
    harness,
    /function findReplacementPickerOpenIndex\(owner, fromCursor\)[\s\S]*?surfaceId === "party:replacement"[\s\S]*?REPLACEMENT_PICKER_OPEN\.test/u,
  );
  assert.match(
    harness,
    /const REPLACEMENT_PICKER_OPEN = \/Start Phase \(\?:SwitchPhase\|CoopGuestFaintSwitchPhase\)\|guest own-faint picker OPEN\//u,
  );
});

test("the replacement picker drive short-circuits a committed pick and guards re-entry (30-wave lane)", async () => {
  const harness = await readFile(new URL("public-ui-harness.mjs", import.meta.url), "utf8");
  // Track R run 29644735938 30-wave lane: after the pick COMMITTED the drive re-entered for the same
  // slot and hung forever waiting for a send-out submenu that will never reappear. The drive must (a)
  // short-circuit the send-out-menu wait once pick-committed evidence appears and (b) refuse re-entry
  // for an already-committed owner+address pick.
  assert.match(harness, /const REPLACEMENT_PICK_COMMITTED = \/faint picker PICK\|Start Phase SwitchSummonPhase\//u);
  assert.match(harness, /this\.committedReplacementPickers = new Set\(\)/u);
  assert.match(
    harness,
    /function replacementPickerCommitKey\(owner, address\)[\s\S]*?\$\{owner\.label\}:\$\{address\?\.epoch/u,
  );
  const drive = harness.slice(
    harness.indexOf("async driveOwnedReplacementPicker("),
    harness.indexOf("async leaveRewardsAndReachWave2("),
  );
  // (b) Re-entry guard: an already-committed owner+address pick returns without a second nav-submit.
  assert.match(
    drive,
    /if \(this\.committedReplacementPickers\.has\(committedKey\)\) \{[\s\S]*?replacement-drive-skipped-committed[\s\S]*?return;/u,
  );
  // (a) Send-out-menu wait resolves on pick-committed evidence instead of hanging.
  assert.match(drive, /if \(pickCommitted\(\) != null\) \{\s*return REPLACEMENT_DRIVE_SUPERSEDED;/u);
  assert.match(drive, /if \(sendOutSurface === REPLACEMENT_DRIVE_SUPERSEDED\) \{/u);
  // The committed key is recorded so the guard fires on any later re-entry for the same window.
  assert.match(drive, /this\.committedReplacementPickers\.add\(committedKey\)/u);
  // The sequential command round advances its scan floor after a late-picker drive so a short-circuited
  // re-entry cannot busy-loop on the same stale surface.
  const round = harness.slice(
    harness.indexOf("async driveSequentialCommandRound("),
    harness.indexOf("async waitForPostTurnOutcome("),
  );
  assert.match(
    round,
    /await this\.driveOwnedReplacementPicker\(client, from\);\s*[\s\S]*?from\[client\.label\] = client\.evidence\.cursor\(\);/u,
  );
});

test("the sequential command round drives a late-opening owned replacement picker (staggered double faint)", async () => {
  const harness = await readFile(new URL("public-ui-harness.mjs", import.meta.url), "utf8");
  // Track R run 29640634363 depth lane: a staggered simultaneous double faint parks the authority in
  // its OWN own-slot SwitchPhase picker AFTER driveReplacement's bounded concurrent-detection window has
  // closed, so it never reaches the round's CommandPhase and driveSequentialCommandRound timed out
  // "waiting for sequential command owners". The command round must therefore clear a late-opening owned
  // actionable replacement picker (like a real human at that seat) before it can converge both owners.
  const round = harness.slice(
    harness.indexOf("async driveSequentialCommandRound("),
    harness.indexOf("async waitForPostTurnOutcome("),
  );
  assert.ok(round.length > 0, "driveSequentialCommandRound must precede waitForPostTurnOutcome");
  assert.match(
    round,
    /const readyReplacement = findOwnedReadyReplacement\(client, from\[client\.label\] \?\? 0\);[\s\S]*?if \(readyReplacement == null\) \{[\s\S]*?await this\.driveOwnedReplacementPicker\(client, from\);[\s\S]*?if \(droveReplacement\) \{/u,
  );
  // Track R animations-on-surface lane (run 29651275134): when driveReplacement already cleared the faint
  // at the wave loop, the owner can advance into its NEXT CommandPhase DURING the picker drive, so the
  // trace holds BOTH the stale party:replacement AND the newer owned command surface. Re-driving the stale
  // replacement here would advance from[client] PAST that once-emitted command surface and time out
  // "waiting for sequential command owners". If an owned command already exists AT/AFTER the replacement,
  // it is resolved - fall through to the command path instead of re-opening the picker.
  assert.match(
    round,
    /const supersedingCommand = findOwnedCommandOrTerminal\(client, from\[client\.label\] \?\? 0\);\s*if \(supersedingCommand != null && supersedingCommand\.index >= readyReplacement\.index\) \{\s*continue;\s*\}/u,
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
