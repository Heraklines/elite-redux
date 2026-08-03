/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { configureRenderProfile, raiseGameSpeed } from "./campaign.mjs";
import {
  confirmDefaultStarterTeam,
  isActionableSemanticObservation,
  selectOptionById,
  waitForActionableSemanticSurface,
  waitForSemanticSurface,
} from "./campaign-nav.mjs";
import { loadCampaignPolicy } from "./campaign-policy.mjs";
import { delay } from "./evidence.mjs";

const TITLE_PHASE = /Start Phase TitlePhase/u;
const CHALLENGE_PHASE = /Start Phase SelectChallengePhase/u;
const STARTER_PHASE = /Start Phase SelectStarterPhase/u;
const SLOT_ZERO_FORK_QUARANTINE =
  /resume scan slot=0 load failed \(ignored\) CoopResumeReplicaUnavailableError: (?:equal-revision co-op fork in slot 0|cloud head ancestry conflict for run [0-9a-f-]{36})/u;
const SETTINGS_EXEMPT_JOURNEYS = new Set(["probe", "showdown-battle"]);

function journeySettingsProgress(rig) {
  return {
    note(message, detail = {}) {
      for (const client of Object.values(rig.clients)) {
        client.evidence.record("journey-settings-progress", { message, detail });
      }
    },
  };
}

/**
 * Apply the workflow's requested speed and rendering profile through the same
 * observer-gated, public Settings UI walks used by the campaign. This runs after
 * visible login and before co-op pairing, so every gameplay journey actually
 * exercises the configuration that its workflow claims to qualify.
 */
async function prepareCoopJourneySettings(rig) {
  await rig.loginBoth();
  const policy = loadCampaignPolicy();
  const progress = journeySettingsProgress(rig);
  if (policy.raiseSpeed) {
    await raiseGameSpeed(rig, policy, progress);
  }
  await configureRenderProfile(rig, policy, progress);
}

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

export function isActionableLocalSoloSurface(observation) {
  return (
    observation?.coop === false
    && observation.seatsWithInput?.includes(0)
    && observation.ready?.handlerActive === true
    && observation.ready.inputBlocked !== true
  );
}

/**
 * Drive only real public input while a newly-overwritten solo run renders its battle intro. The old
 * helper waited for Command/check-switch without advancing ordinary MESSAGE prompts, so it timed out
 * inside ShowAbilityPhase even though the save mutation and launch had both succeeded. A prompt is
 * pressed once, then must visibly leave its actionable edge before another press is allowed.
 */
async function driveSoloPresentationToCommand(client, from) {
  const deadline = Date.now() + Math.max(client.config.timeoutMs * 3, 180_000);
  let cursor = from;
  let messagePressArmed = true;
  while (Date.now() < deadline) {
    const boundary = client.evidence.findLastSemanticSurface(cursor);
    const observation = boundary?.observation;
    // A single Space that dismisses the final narration may also open FIGHT before the next observer
    // sample. That is already a real, actionable CommandPhase—not a failure to reach one. Accept any
    // live solo command sub-surface while retaining the exact phase and public-input proof.
    if (
      isActionableLocalSoloSurface(observation)
      && observation.operationClass === "command"
      && observation.phase === "CommandPhase"
    ) {
      client.evidence.record("solo-presentation-command-proof", {
        from,
        observationIndex: boundary.index,
        phase: observation.phase,
        surfaceId: observation.surfaceId,
      });
      return boundary;
    }
    if (isActionableLocalSoloSurface(observation) && observation.surfaceId === "check-switch") {
      await selectOptionById(client, {
        surfaceId: "check-switch",
        targetId: "no",
        navKeys: ["ArrowUp", "ArrowDown"],
        timeoutMs: client.config.timeoutMs,
        fromCursor: boundary.index,
      });
      cursor = boundary.index + 1;
      messagePressArmed = true;
      continue;
    }
    const actionableMessage =
      isActionableLocalSoloSurface(observation)
      && observation.surfaceId === "battle:message"
      && observation.ready.awaitingActionInput === true;
    if (actionableMessage && messagePressArmed) {
      client.evidence.record("solo-presentation-message-advance", {
        observationIndex: boundary.index,
        phase: observation.phase,
        phaseInstance: observation.phaseInstance,
      });
      await client.press("Space", `advance-solo-presentation-${observation.phase}`);
      cursor = boundary.index + 1;
      messagePressArmed = false;
      continue;
    }
    if (boundary != null && !actionableMessage) {
      messagePressArmed = true;
    }
    await delay(100);
  }
  const latest = client.evidence.findLastSemanticSurface(from)?.observation ?? null;
  throw new Error(
    `${client.label}: solo presentation did not reach CommandPhase after overwrite; latest=${JSON.stringify(latest)}`,
  );
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
  await driveSoloPresentationToCommand(client, mutationCursor);
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

function assertEvolutionFixtureParty(rig) {
  const expected = [
    { slot: 0, speciesId: 10, coopOwner: "host", level: 6, pauseEvolutions: false },
    { slot: 1, speciesId: 10, coopOwner: "guest", level: 6, pauseEvolutions: false },
    { slot: 2, speciesId: 351, coopOwner: "host", level: 6, pauseEvolutions: false },
    { slot: 3, speciesId: 351, coopOwner: "guest", level: 6, pauseEvolutions: false },
    { slot: 4, speciesId: 327, coopOwner: "host", level: 6, pauseEvolutions: false },
    { slot: 5, speciesId: 327, coopOwner: "guest", level: 6, pauseEvolutions: false },
  ];
  for (const client of Object.values(rig.clients)) {
    const surface = client.evidence.events.findLast(
      event =>
        event.kind === "browser-surface2"
        && event.observation?.operationClass === "command"
        && event.observation.address?.wave === 1
        && event.observation.partySlots?.length === expected.length,
    );
    const actual = surface?.observation.partySlots.map(({ slot, speciesId, coopOwner, level, pauseEvolutions }) => ({
      slot,
      speciesId,
      coopOwner,
      level,
      pauseEvolutions,
    }));
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`${client.label}: evolution fixture mismatch ${JSON.stringify(actual)}`);
    }
    client.evidence.record("evolution-fixture-party-proof", {
      surfaceIndex: surface.index,
      party: actual,
    });
  }
}

async function freshThroughWave2(rig, freshRunOptions) {
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun(freshRunOptions);
  if (freshRunOptions?.evolutionFixture) {
    assertEvolutionFixtureParty(rig);
  }
  await rig.driveWaveToReward();
  await rig.leaveRewardsAndReachWave2();
}

async function probe(rig) {
  await rig.loginBoth();
}

async function freshWave2(rig) {
  await freshThroughWave2(rig);
}

function sameBattleAddress(left, right) {
  return left?.epoch === right?.epoch && left?.wave === right?.wave && left?.turn === right?.turn;
}

/**
 * Reproduce the live wave-13 freeze with only public keys: open the local pause/settings branch while
 * one seat owns an exact shared reward, prove its cursor moves and Escape unwinds both overlays, then
 * resume the same reward and reach the next two-browser command frontier.
 */
async function rewardPauseSettings(rig) {
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun();
  await rig.driveWaveToReward();

  const clients = Object.values(rig.clients);
  const owner = await rig.host.evidence.waitForCondition(
    () =>
      clients.find(client => {
        const event = client.evidence.findLastSemanticSurface(0, "reward-shop");
        const observation = event?.observation;
        return (
          observation?.localSeat === client.publicSeat
          && observation.ownerSeat === client.publicSeat
          && observation.seatsWithInput?.includes(client.publicSeat)
          && isActionableSemanticObservation(observation, { requireExplicitUnblocked: true })
        );
      }),
    { timeoutMs: rig.config.timeoutMs, description: "actionable shared reward owner before pause overlay" },
  );
  const watcher = clients.find(client => client !== owner);
  if (watcher == null) {
    throw new Error("reward pause/settings journey requires two browser clients");
  }
  const rewardBefore = owner.evidence.findLastSemanticSurface(0, "reward-shop");
  const watcherBefore = watcher.evidence.findLastSemanticSurface(0, "reward-shop");
  if (rewardBefore == null || watcherBefore == null) {
    throw new Error("reward pause/settings journey did not observe both reward projections");
  }

  const menuCursor = owner.evidence.cursor();
  await owner.press("Escape", "reward-open-local-pause-menu");
  const pauseMenu = await waitForActionableSemanticSurface(owner, "pause-menu", {
    fromCursor: menuCursor,
    timeoutMs: rig.config.timeoutMs,
  });
  if (pauseMenu.observation.operationClass !== "local-overlay" || pauseMenu.observation.ownerModel !== "local") {
    throw new Error(`${owner.label}: pause menu was not projected as local-only input`);
  }

  const settingsCursor = owner.evidence.cursor();
  await owner.press("Space", "reward-pause-open-game-settings");
  const settings = await waitForActionableSemanticSurface(owner, "pause-settings", {
    fromCursor: settingsCursor,
    timeoutMs: rig.config.timeoutMs,
  });
  await owner.checkpoint("reward-pause-settings-open");

  const movedCursor = owner.evidence.cursor();
  await owner.press("ArrowDown", "reward-pause-settings-move-cursor");
  const movedSettings = await owner.evidence.waitForCondition(
    sink => {
      const event = sink.findLastSemanticSurface(movedCursor, "pause-settings");
      return event?.observation.selectedOptionId !== settings.observation.selectedOptionId
        && isActionableSemanticObservation(event?.observation, { requireExplicitUnblocked: true })
        ? event
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "actionable moved settings cursor during shared reward" },
  );

  const menuReturnCursor = owner.evidence.cursor();
  await owner.press("Escape", "reward-pause-settings-back-to-menu");
  await waitForActionableSemanticSurface(owner, "pause-menu", {
    fromCursor: menuReturnCursor,
    timeoutMs: rig.config.timeoutMs,
  });

  const rewardReturnCursor = owner.evidence.cursor();
  await owner.press("Escape", "reward-close-local-pause-menu");
  const rewardAfter = await owner.evidence.waitForCondition(
    sink => {
      const event = sink.findLastSemanticSurface(rewardReturnCursor, "reward-shop");
      const observation = event?.observation;
      return observation?.ownerSeat === owner.publicSeat
        && observation.seatsWithInput?.includes(owner.publicSeat)
        && isActionableSemanticObservation(observation, { requireExplicitUnblocked: true })
        ? event
        : null;
    },
    { timeoutMs: rig.config.timeoutMs, description: "same actionable shared reward after closing local overlays" },
  );
  if (
    !sameBattleAddress(rewardBefore.observation.address, rewardAfter.observation.address)
    || rewardBefore.observation.stateDigest !== rewardAfter.observation.stateDigest
    || rewardBefore.observation.selectedOptionId !== rewardAfter.observation.selectedOptionId
  ) {
    throw new Error(`${owner.label}: local pause/settings changed or replaced the underlying reward authority`);
  }
  const watcherAfter = watcher.evidence.findLastSemanticSurface(0, "reward-shop");
  if (
    watcherAfter == null
    || !sameBattleAddress(watcherBefore.observation.address, watcherAfter.observation.address)
    || watcherAfter.observation.ownerSeat !== owner.publicSeat
    || watcherAfter.observation.seatsWithInput?.includes(watcher.publicSeat)
  ) {
    throw new Error(`${watcher.label}: local owner overlay disturbed the reward watcher projection`);
  }
  owner.evidence.record("reward-pause-settings-proof", {
    address: rewardAfter.observation.address,
    ownerSeat: owner.publicSeat,
    settingsCursorBefore: settings.observation.selectedOptionId,
    settingsCursorAfter: movedSettings.observation.selectedOptionId,
    rewardSelection: rewardAfter.observation.selectedOptionId,
  });
  await owner.checkpoint("reward-restored-after-pause-settings");
  await rig.leaveRewardsAndReachWave2();
}

function requireEvolutionPromptProof(client, phase) {
  const surface = client.evidence.events.find(
    event =>
      event.kind === "browser-surface2"
      && event.observation?.surfaceId === "battle:evolution"
      && event.observation.phase === phase
      && event.observation.uiMode === "EVOLUTION_SCENE"
      && event.observation.ownerModel === "local"
      && event.observation.coop === true
      && event.observation.seatsWithInput?.includes(event.observation.localSeat)
      && isActionableSemanticObservation(event.observation, { requireExplicitUnblocked: true }),
  );
  if (surface == null) {
    throw new Error(`${client.label}: no actionable ${phase} evolution surface was observed`);
  }
  const advance = client.evidence.events.find(
    event =>
      event.kind === "campaign-battle-prompt-advance"
      && event.surfaceId === "battle:evolution"
      && event.phase === phase
      && event.inputSeat === client.label,
  );
  if (advance == null || advance.readyEventIndex !== surface.index) {
    throw new Error(`${client.label}: ${phase} evolution prompt was not advanced through its exact readiness event`);
  }
  client.evidence.record("evolution-prompt-proof", {
    phase,
    surfaceIndex: surface.index,
    advanceIndex: advance.index,
    phaseInstance: surface.observation.phaseInstance,
  });
}

async function evolutionSync(rig) {
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun({ evolutionFixture: true });
  assertEvolutionFixtureParty(rig);
  // The first authoritative reward is the ordered successor of the retained
  // evolution. Reaching it proves the evolution released wave progression;
  // entering wave two would add an unrelated, legitimate Mystery roll to this
  // focused presentation contract.
  await rig.driveWaveToReward();
  const ledger = rig.assertWaveProgressionLedger(1, "wave-1-evolution-sync", { requireExp: true });
  if (!ledger.some(entry => entry.event.k === "evolution")) {
    throw new Error(
      `wave-1-evolution-sync: expected a retained evolution; kinds=${ledger.map(entry => entry.event.k)}`,
    );
  }
  requireEvolutionPromptProof(rig.host, "EvolutionPhase");
  requireEvolutionPromptProof(rig.guest, "CoopWaveProgressionReplayPhase");
}

async function freshResume(rig) {
  await freshThroughWave2(rig);
  await rig.coldReopenAndPair(rig.config.requesterSeat);
  await rig.resumeRun({ expectedWave: 2 });
}

async function sameTabRejoin(rig) {
  await freshThroughWave2(rig);
  const rejoinCursors = await rig.sameTabReloadAndRejoin();
  await rig.resumeRun({ expectedWave: 2 });
  rig.assertSameTabRejoinGeneration(rejoinCursors);
  await rig.driveWaveToReward();
  rig.assertNoFatalRecoverySince(rejoinCursors, "same-tab rejoin through one complete post-reload battle");
  for (const client of Object.values(rig.clients)) {
    const mismatch = client.evidence.events
      .slice(rejoinCursors[client.label])
      .find(event => /connection-generation-mismatch/u.test(event.text ?? ""));
    if (mismatch != null) {
      throw new Error(`${client.label}: post-rejoin Authority V2 receipt used a stale generation: ${mismatch.text}`);
    }
    client.evidence.record("same-tab-rejoin-post-battle-proof", {
      resumedWave: 2,
      rewardWave: rig.activeBattleWave,
      mismatch: false,
    });
  }
}

async function reverseResume(rig) {
  await freshThroughWave2(rig);
  await rig.coldReopenAndPair(oppositeSeat(rig.config.requesterSeat));
  await rig.resumeRun({ expectedWave: 2 });
}

async function faintReplacement(rig) {
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun({ faintFixture: true });
  await rig.driveWaveToReward({ allowFaint: true });
  if (rig.replacementCount === 0) {
    throw new Error(
      "Deterministic Healing Wish journey reached rewards without opening the configured owner's faint replacement",
    );
  }
}

async function halfWipe(rig) {
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun({ halfWipeFixture: true });
  await rig.driveHalfWipeToNextCommand();
}

async function commanderSkip(rig) {
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun({ commanderFixture: true });
  await rig.driveCommanderWaveToReward();
  await rig.leaveRewardsAndReachWave2({ commanderFixture: true });
}

async function gameOver(rig) {
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun({ gameOverFixture: true });
  await rig.driveWaveToGameOver();
}

async function showdownBattle(rig) {
  await rig.loginBoth();
  await rig.pair(rig.config.requesterSeat, { sessionKind: "versus" });
  await rig.startShowdownBattle();
  await rig.driveShowdownTurn();
}

async function saveMutations(rig) {
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun();
  for (const client of Object.values(rig.clients)) {
    const firstSave = client.evidence.findResponse("/savedata/session/coop-cas-update", {
      status: 200,
      method: "POST",
      slot: 0,
      mode: "empty",
    });
    if (firstSave == null) {
      throw new Error(`${client.label}: shared wave-1 command never produced a successful exact co-op CAS save`);
    }
  }

  await rig.stopChromeTrace();
  await rig.coldReopenClients();
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

async function forkIsolatedCloudReplica(rig, client, slot) {
  const origin = new URL(rig.config.expectedApiOrigin ?? "");
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.port !== "8788") {
    throw new Error(`resume-scan-isolation fixture refuses non-loopback save origin ${origin.href}`);
  }
  const response = await fetch(new URL("/__coop-fixture/fork-session", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: client.credentials.username, slot }),
  });
  const result = await response.json();
  if (!response.ok || result?.ok !== true || result.slot !== slot) {
    throw new Error(
      `${client.label}: isolated cloud-replica fork failed: ${response.status} ${JSON.stringify(result)}`,
    );
  }
  client.evidence.record("isolated-cloud-replica-fork", result);
  return result;
}

async function isolatedCloudReplicaStatus(rig, client, slot) {
  const origin = new URL(rig.config.expectedApiOrigin ?? "");
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || origin.port !== "8788") {
    throw new Error(`resume-scan-isolation fixture refuses non-loopback save origin ${origin.href}`);
  }
  const response = await fetch(new URL("/__coop-fixture/session-status", origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: client.credentials.username, slot }),
  });
  const result = await response.json();
  if (!response.ok || result?.ok !== true || result.slot !== slot || !/^[0-9a-f]{64}$/u.test(result.sha256)) {
    throw new Error(
      `${client.label}: isolated cloud-replica status failed: ${response.status} ${JSON.stringify(result)}`,
    );
  }
  return result;
}

async function resumeScanIsolation(rig) {
  await rig.pair(rig.config.requesterSeat);
  await rig.startFreshRun();
  for (const client of Object.values(rig.clients)) {
    const firstRequest = client.evidence.findCoopCasUpdateRequest({ slot: 0, mode: "empty" });
    const firstSave = client.evidence.findResponse("/savedata/session/coop-cas-update", {
      status: 200,
      method: "POST",
    });
    if (firstRequest == null || firstSave == null || firstRequest.index >= firstSave.index) {
      throw new Error(`${client.label}: wave-1 command did not empty-CAS slot zero for the isolation fixture`);
    }
  }

  const forkedCloud = new Map(
    await Promise.all(
      Object.values(rig.clients).map(async client => [client.label, await forkIsolatedCloudReplica(rig, client, 0)]),
    ),
  );
  await rig.coldReopenAndPair(rig.config.requesterSeat);
  await rig.host.evidence.waitFor(SLOT_ZERO_FORK_QUARANTINE, {
    from: rig.host.pageCursor,
    timeoutMs: rig.config.timeoutMs,
    description: "slot-scoped co-op fork quarantine",
  });
  const localBefore = new Map(
    await Promise.all(
      Object.values(rig.clients).map(async client => {
        const checkpoint = await client.checkpoint("resume-conflict-isolated-before-launch");
        const sessions = checkpoint.storage.filter(item => /^sessionData(?:\d*)_/u.test(item.key));
        if (sessions.length !== 1 || !/^[0-9a-f]{64}$/u.test(sessions[0].sha256)) {
          throw new Error(`${client.label}: expected one exact quarantined local slot before launch`);
        }
        return [client.label, sessions[0]];
      }),
    ),
  );

  const clientLaunchCursors = new Map(
    Object.values(rig.clients).map(client => [client.label, client.evidence.cursor()]),
  );
  await rig.startFreshRun();
  const localAfter = await Promise.all(
    Object.values(rig.clients).map(async client => {
      const after = await client.checkpoint("resume-conflict-isolated-fresh-command");
      const sessions = after.storage.filter(item => /^sessionData(?:\d*)_/u.test(item.key));
      const before = localBefore.get(client.label);
      const preserved = sessions.find(item => item.key === before?.key);
      if (sessions.length < 2 || preserved?.sha256 !== before?.sha256) {
        throw new Error(`${client.label}: fresh run changed or removed the exact quarantined local slot`);
      }
      const cursor = clientLaunchCursors.get(client.label);
      const freshRequest = client.evidence.events
        .slice(cursor)
        .find(event => event.kind === "coop-cas-update-request" && event.mode === "empty" && event.slot !== 0);
      const freshResponse =
        freshRequest == null
          ? null
          : client.evidence.findResponse("/savedata/session/coop-cas-update", {
              from: cursor,
              status: 200,
              method: "POST",
              slot: freshRequest.slot,
              mode: "empty",
            });
      if (freshRequest == null || freshResponse == null || freshRequest.index >= freshResponse.index) {
        throw new Error(`${client.label}: isolated launch did not empty-CAS a different fresh slot`);
      }
      return { client, sessions, freshRequest, freshResponse };
    }),
  );
  const hostFresh = localAfter.find(proof => proof.client === rig.host);
  if (hostFresh == null) {
    throw new Error(`${rig.host.label}: isolated host proof was not captured`);
  }
  const cloudAfter = await Promise.all(
    Object.values(rig.clients).map(async client => [client, await isolatedCloudReplicaStatus(rig, client, 0)]),
  );
  for (const [client, status] of cloudAfter) {
    if (status.sha256 !== forkedCloud.get(client.label)?.sha256) {
      throw new Error(`${client.label}: fresh launch mutated quarantined cloud slot zero`);
    }
  }
  rig.host.evidence.record("resume-scan-isolation-proof", {
    quarantinedSlot: 0,
    preservedSessionKeys: hostFresh.sessions.map(item => item.key),
    freshSlot: hostFresh.freshRequest.slot,
    freshWriteResponseIndex: hostFresh.freshResponse.index,
    quarantinedCloudSha256: cloudAfter.map(([client, status]) => ({ client: client.label, sha256: status.sha256 })),
  });
}

const journeys = {
  probe,
  "fresh-wave2": freshWave2,
  "reward-pause-settings": rewardPauseSettings,
  "fresh-resume": freshResume,
  "same-tab-rejoin": sameTabRejoin,
  "reverse-resume": reverseResume,
  "faint-replacement": faintReplacement,
  "half-wipe": halfWipe,
  "commander-skip": commanderSkip,
  "game-over": gameOver,
  "evolution-sync": evolutionSync,
  "showdown-battle": showdownBattle,
  "resume-scan-isolation": resumeScanIsolation,
  "save-mutations": saveMutations,
};

export async function runJourney(rig, name) {
  const journey = journeys[name];
  if (!journey) {
    throw new Error(`No public-UI journey named ${name}`);
  }
  if (!SETTINGS_EXEMPT_JOURNEYS.has(name)) {
    await prepareCoopJourneySettings(rig);
  }
  await journey(rig);
}
