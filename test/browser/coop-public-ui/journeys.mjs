/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { confirmDefaultStarterTeam, selectOptionById, waitForSemanticSurface } from "./campaign-nav.mjs";

const TITLE_PHASE = /Start Phase TitlePhase/u;
const CHALLENGE_PHASE = /Start Phase SelectChallengePhase/u;
const STARTER_PHASE = /Start Phase SelectStarterPhase/u;
function sessionStorageKeys(dom) {
  return dom.storage.map(item => item.key).filter(key => /^sessionData(?:\d*)_/u.test(key));
}

async function waitForResponse(client, pathname, from) {
  return client.evidence.waitForCondition(sink => sink.findResponse(pathname, { from, status: 200, method: "POST" }), {
    timeoutMs: client.config.timeoutMs,
    description: `successful POST ${pathname}`,
  });
}

async function waitForTombstone(client, from) {
  return client.evidence.waitForCondition(
    sink =>
      sink.events.slice(from).find(event => event.kind === "coop-run-status-view" && event.state === "tombstoned"),
    { timeoutMs: client.config.timeoutMs, description: "exact account-scoped co-op tombstone proof" },
  );
}

async function waitForExactDeleteRequest(client, from) {
  return client.evidence.waitForCondition(
    sink => sink.events.slice(from).find(event => event.kind === "coop-cas-delete-request"),
    { timeoutMs: client.config.timeoutMs, description: "exact CAS-delete request commitment" },
  );
}

async function waitForReadyYesConfirmation(client, surfaceId, from) {
  const ready = await client.evidence.waitForCondition(
    sink => {
      const event = sink.findLastSemanticSurface(from, surfaceId);
      const observation = event?.observation;
      return observation?.selectedOptionId === "yes"
        && observation.ready?.handlerActive === true
        && observation.ready.inputBlocked === false
        && Number.isSafeInteger(observation.surfaceGeneration)
        && observation.surfaceGeneration > 0
        ? event
        : null;
    },
    { timeoutMs: client.config.timeoutMs, description: `actionable Yes confirmation ${surfaceId}` },
  );
  client.evidence.record("save-confirm-readiness-proof", {
    surfaceId,
    selectedOptionId: ready.observation.selectedOptionId,
    surfaceGeneration: ready.observation.surfaceGeneration,
    observationIndex: ready.index,
  });
  return ready;
}

function assertExactDeleteProof(client, request, response, tombstone) {
  if (
    request.index >= response.index
    || request.runId !== tombstone.runId
    || request.slot !== tombstone.slot
    || request.checkpointRevision !== tombstone.checkpointRevision
    || request.digest !== tombstone.digest
  ) {
    throw new Error(`${client.label}: CAS-delete request, response, and tombstone did not prove one exact lineage`);
  }
}

async function openTitleOption(client, targetId) {
  await client.evidence.waitFor(TITLE_PHASE, {
    from: client.pageCursor,
    timeoutMs: client.config.timeoutMs,
    description: "TitlePhase before save mutation",
  });
  await waitForSemanticSurface(client, "title-menu", {
    fromCursor: client.pageCursor,
    timeoutMs: client.config.timeoutMs,
  });
  await selectOptionById(client, {
    surfaceId: "title-menu",
    targetId,
    navKeys: ["ArrowUp", "ArrowDown"],
    timeoutMs: client.config.timeoutMs,
  });
}

async function openOccupiedSlotZero(client) {
  // SaveSlotSelectUiHandler opens on slot zero. Its public semantic identity includes the
  // loaded state (`occupied-slot:0`), while the phase-level awaitingActionInput flag remains
  // false because this local handler is not a co-op interaction barrier. Feeding it through the
  // generic option navigator therefore waits forever for a readiness bit this surface does not
  // own. Observe the exact loaded slot identity directly before issuing the player's ACTION.
  await client.evidence.waitForCondition(
    sink => {
      const event = sink.findLastSemanticSurface(client.pageCursor, "save-slot");
      return event?.observation.ready.handlerActive === true && event.observation.selectedOptionId === "occupied-slot:0"
        ? event
        : null;
    },
    { timeoutMs: client.config.timeoutMs, description: "loaded occupied co-op save slot zero" },
  );
}

async function deleteCoopSaveThroughLoadMenu(client) {
  await openTitleOption(client, "load-game");
  await openOccupiedSlotZero(client);
  const before = await client.checkpoint("delete-occupied-coop-slot");
  const beforeKeys = sessionStorageKeys(before);
  if (beforeKeys.length !== 1) {
    throw new Error(
      `${client.label}: expected one local session key before delete, found ${JSON.stringify(beforeKeys)}`,
    );
  }

  const manageCursor = client.evidence.cursor();
  await client.press("Space", "open-save-management-menu");
  await waitForSemanticSurface(client, "option-select:TitlePhase", {
    fromCursor: manageCursor,
    timeoutMs: client.config.timeoutMs,
  });
  const confirmCursor = client.evidence.cursor();
  await selectOptionById(client, {
    surfaceId: "option-select:TitlePhase",
    targetId: "delete-run",
    navKeys: ["ArrowUp", "ArrowDown"],
    timeoutMs: client.config.timeoutMs,
  });
  await waitForReadyYesConfirmation(client, "confirm:TitlePhase", confirmCursor);
  await client.checkpoint("delete-confirm-visible");
  const mutationCursor = client.evidence.cursor();
  await client.press("Space", "confirm-exact-coop-delete");
  const [deleteRequest, deleteResponse, tombstone] = await Promise.all([
    waitForExactDeleteRequest(client, mutationCursor),
    waitForResponse(client, "/savedata/session/coop-cas-delete", mutationCursor),
    waitForTombstone(client, mutationCursor),
  ]);
  assertExactDeleteProof(client, deleteRequest, deleteResponse, tombstone);
  await waitForSemanticSurface(client, "save-slot", {
    fromCursor: mutationCursor,
    timeoutMs: client.config.timeoutMs,
  });
  const after = await client.checkpoint("delete-complete-empty-slot");
  const afterKeys = sessionStorageKeys(after);
  if (afterKeys.length > 0) {
    throw new Error(`${client.label}: exact delete left local session bytes ${JSON.stringify(afterKeys)}`);
  }
  client.evidence.record("save-delete-proof", {
    deleteResponseIndex: deleteResponse.index,
    runId: tombstone.runId,
    slot: tombstone.slot,
    localSessionKeysBefore: beforeKeys,
    localSessionKeysAfter: afterKeys,
  });
  return tombstone;
}

async function overwriteCoopSaveWithSoloRun(client) {
  await openTitleOption(client, "new-game");
  await waitForSemanticSurface(client, "option-select:TitlePhase", {
    fromCursor: client.pageCursor,
    timeoutMs: client.config.timeoutMs,
  });
  await selectOptionById(client, {
    surfaceId: "option-select:TitlePhase",
    targetId: "classic",
    navKeys: ["ArrowUp", "ArrowDown"],
    timeoutMs: client.config.timeoutMs,
  });

  const entry = await client.evidence.waitForCondition(
    sink => sink.find(CHALLENGE_PHASE, client.pageCursor) ?? sink.find(STARTER_PHASE, client.pageCursor),
    { timeoutMs: client.config.timeoutMs, description: "solo challenge or starter surface before overwrite" },
  );
  if (CHALLENGE_PHASE.test(entry.text ?? "")) {
    await client.sequence(client.config.keys.challenge, "overwrite-solo-challenge-start");
  }
  const starterPhase = await client.evidence.waitFor(STARTER_PHASE, {
    from: client.pageCursor,
    timeoutMs: client.config.timeoutMs,
    description: "solo starter selection before overwrite",
  });
  const { launchCursor } = await confirmDefaultStarterTeam(client, {
    fromCursor: starterPhase.index,
    timeoutMs: client.config.timeoutMs,
  });
  await waitForSemanticSurface(client, "option-select:SelectStarterPhase", {
    fromCursor: launchCursor,
    timeoutMs: client.config.timeoutMs,
  });
  await selectOptionById(client, {
    surfaceId: "option-select:SelectStarterPhase",
    targetId: "ace",
    navKeys: ["ArrowUp", "ArrowDown"],
    timeoutMs: client.config.timeoutMs,
  });
  await openOccupiedSlotZero(client);
  await client.checkpoint("overwrite-occupied-coop-slot");

  const confirmCursor = client.evidence.cursor();
  await client.press("Space", "request-overwrite-occupied-coop-slot");
  await waitForReadyYesConfirmation(client, "confirm:SelectStarterPhase", confirmCursor);
  await client.checkpoint("overwrite-confirm-visible");
  const mutationCursor = client.evidence.cursor();
  await client.press("Space", "confirm-overwrite-delete-first");
  const [deleteRequest, deleteResponse, tombstone] = await Promise.all([
    waitForExactDeleteRequest(client, mutationCursor),
    waitForResponse(client, "/savedata/session/coop-cas-delete", mutationCursor),
    waitForTombstone(client, mutationCursor),
  ]);
  assertExactDeleteProof(client, deleteRequest, deleteResponse, tombstone);
  const soloWrite = await waitForResponse(client, "/savedata/updateall", mutationCursor);
  if (soloWrite.index <= deleteResponse.index) {
    throw new Error(
      `${client.label}: overwrite persisted replacement at event ${soloWrite.index} before exact delete ACK ${deleteResponse.index}`,
    );
  }
  await client.waitForLocalCommand(mutationCursor);
  await client.checkpoint("overwrite-solo-wave1-command");
  client.evidence.record("save-overwrite-proof", {
    deleteResponseIndex: deleteResponse.index,
    replacementWriteResponseIndex: soloWrite.index,
    deletedRunId: tombstone.runId,
    slot: tombstone.slot,
  });
  return tombstone;
}

function oppositeSeat(seat) {
  return seat === "host-seat" ? "guest-seat" : "host-seat";
}

async function freshThroughWave2(rig) {
  await rig.loginBoth();
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun();
  await rig.driveWaveToReward();
  await rig.leaveRewardsAndReachWave2();
}

async function probe(rig) {
  await rig.loginBoth();
}

async function freshWave2(rig) {
  await freshThroughWave2(rig);
}

async function freshResume(rig) {
  await freshThroughWave2(rig);
  await rig.coldReopenAndPair(rig.config.requesterSeat);
  await rig.resumeRun({ expectedWave: 2 });
}

async function reverseResume(rig) {
  await freshThroughWave2(rig);
  await rig.coldReopenAndPair(oppositeSeat(rig.config.requesterSeat));
  await rig.resumeRun({ expectedWave: 2 });
}

async function faintReplacement(rig) {
  await rig.loginBoth();
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun({ faintFixture: true });
  await rig.driveWaveToReward({ allowFaint: true });
  if (rig.replacementCount === 0) {
    throw new Error(
      "Deterministic Healing Wish journey reached rewards without opening the configured owner's faint replacement",
    );
  }
}

async function commanderSkip(rig) {
  await rig.loginBoth();
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun({ commanderFixture: true });
  await rig.driveCommanderWaveToReward();
  await rig.leaveRewardsAndReachWave2({ commanderFixture: true });
}

async function gameOver(rig) {
  await rig.loginBoth();
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun({ gameOverFixture: true });
  await rig.driveWaveToGameOver();
}

async function saveMutations(rig) {
  await rig.loginBoth();
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun();
  for (const client of Object.values(rig.clients)) {
    const firstSave = client.evidence.findResponse("/savedata/session/coop-cas-update", {
      status: 200,
      method: "POST",
    });
    if (firstSave == null) {
      throw new Error(`${client.label}: shared wave-1 command never produced a successful exact co-op CAS save`);
    }
  }

  await rig.stopChromeTrace();
  await Promise.all(Object.values(rig.clients).map(client => client.reopen()));
  await rig.loginBoth();

  const deleted = rig.client("host-seat");
  const overwritten = rig.client("guest-seat");
  await deleteCoopSaveThroughLoadMenu(deleted);
  await overwriteCoopSaveWithSoloRun(overwritten);

  await rig.coldReplaceContextsAndLogin();
  const [deletedTitle, overwrittenTitle] = await Promise.all([
    waitForSemanticSurface(deleted, "title-menu", {
      fromCursor: deleted.pageCursor,
      timeoutMs: deleted.config.timeoutMs,
    }),
    waitForSemanticSurface(overwritten, "title-menu", {
      fromCursor: overwritten.pageCursor,
      timeoutMs: overwritten.config.timeoutMs,
    }),
  ]);
  const [deletedCold, overwrittenCold] = await Promise.all([
    deleted.checkpoint("cold-context-delete-absent"),
    overwritten.checkpoint("cold-context-overwrite-present"),
  ]);
  const deletedKeys = sessionStorageKeys(deletedCold);
  const overwrittenKeys = sessionStorageKeys(overwrittenCold);
  if (
    deleted.evidence.networkState.account?.lastSessionSlot !== -1
    || deletedKeys.length > 0
    || deletedTitle.observation.optionIds?.includes("continue")
  ) {
    throw new Error(`${deleted.label}: exact delete reappeared after a brand-new-context login`);
  }
  if (
    overwritten.evidence.networkState.account?.lastSessionSlot !== 0
    || overwrittenKeys.length !== 1
    || !overwrittenTitle.observation.optionIds?.includes("continue")
  ) {
    throw new Error(`${overwritten.label}: replacement save was not durable after a brand-new-context login`);
  }
  deleted.evidence.record("save-cold-reopen-proof", {
    lastSessionSlot: -1,
    sessionKeys: deletedKeys,
    continueVisible: false,
  });
  overwritten.evidence.record("save-cold-reopen-proof", {
    lastSessionSlot: 0,
    sessionKeys: overwrittenKeys,
    continueVisible: true,
  });
}

const journeys = {
  probe,
  "fresh-wave2": freshWave2,
  "fresh-resume": freshResume,
  "reverse-resume": reverseResume,
  "faint-replacement": faintReplacement,
  "commander-skip": commanderSkip,
  "game-over": gameOver,
  "save-mutations": saveMutations,
};

export async function runJourney(rig, name) {
  const journey = journeys[name];
  if (!journey) {
    throw new Error(`No public-UI journey named ${name}`);
  }
  await journey(rig);
}
