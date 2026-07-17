/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * State-aware navigation against the read-only v2 semantic surface mirror
 * (`[coop-browser:surface2]`). Instead of pulsing blind keys, the driver reads the
 * visible options + selected id, presses a direction, VERIFIES the selected id changed,
 * and submits only once the target option is selected. Pure decision logic is split out
 * (`planNavigationStep`) so it is unit-testable without a browser.
 */

import { delay } from "./evidence.mjs";

/** Shared readiness contract for every public semantic driver, not only the lobby. */
export function isActionableSemanticObservation(observation, { requireExplicitUnblocked = false } = {}) {
  if (observation?.ready?.handlerActive !== true) {
    return false;
  }
  if (requireExplicitUnblocked) {
    // Input-blocked is the production UI handler's strongest answer to "would a key be accepted
    // now?". Some handlers (notably STARTER_SELECT) expose it while their enclosing phase reports
    // awaitingActionInput=false, so an explicit false must win. Other always-live handlers (COMMAND
    // and FIGHT) have no blocking field at all; for those, active + not-explicitly-not-awaiting is
    // the complete contract. Requiring the optional field to exist made the real wave-1 COMMAND
    // screen permanently non-actionable in the browser oracle.
    if (observation.ready.inputBlocked != null) {
      return observation.ready.inputBlocked === false;
    }
    return observation.ready.awaitingActionInput !== false;
  }
  return observation.ready.inputBlocked !== true && observation.ready.awaitingActionInput !== false;
}

/** A replacement surface owned by this browser and ready for a human-equivalent key. */
export function findOwnedActionableReplacementSurface(client, fromCursor = 0) {
  const event = client.evidence.findLastSemanticSurface(fromCursor, "party:replacement");
  const observation = event?.observation;
  return observation?.operationClass === "replacement"
    && observation.ownerModel === "interaction"
    && (observation.phase === "SwitchPhase" || observation.phase === "CoopGuestFaintSwitchPhase")
    && observation.uiMode === "PARTY"
    && observation.localSeat === client.publicSeat
    && observation.ownerSeat === client.publicSeat
    && observation.seatsWithInput?.includes(client.publicSeat)
    && isActionableSemanticObservation(observation, { requireExplicitUnblocked: true })
    ? event
    : null;
}

/**
 * The currently rendered target picker for this stable seat.
 *
 * Looking up only the last matching `command:target` event is insufficient: after ACTION
 * closes the picker that event remains in the trace. Requiring it to also be the client's
 * latest semantic surface prevents a delayed poll from spending a second key on the next UI.
 */
export function findOwnedActionableTargetSurface(client, fromCursor = 0, expectedAddress = null) {
  const event = client.evidence.findLastSemanticSurface(fromCursor, "command:target");
  const latest = client.evidence.findLastSemanticSurface(fromCursor);
  const observation = event?.observation;
  const address = observation?.address;
  const addressKey =
    Number.isSafeInteger(address?.epoch) && Number.isSafeInteger(address?.wave) && Number.isSafeInteger(address?.turn)
      ? `${address.epoch}:${address.wave}:${address.turn}`
      : null;
  return event != null
    && latest?.index === event.index
    && observation?.operationClass === "command"
    && observation.ownerModel === "local"
    && observation.phase === "SelectTargetPhase"
    && observation.uiMode === "TARGET_SELECT"
    && observation.localSeat === client.publicSeat
    && observation.seatsWithInput?.includes(client.publicSeat)
    && (expectedAddress == null || addressKey === expectedAddress)
    && Array.isArray(observation.optionIds)
    && observation.optionIds.length > 0
    && observation.optionIds.includes(observation.selectedOptionId)
    && isActionableSemanticObservation(observation, { requireExplicitUnblocked: true })
    ? event
    : null;
}

/** Pick the first observer-proven healthy reserve, never the currently fielded/fainted slot. */
export function replacementTargetOptionId(observation) {
  const target = observation?.partySlots?.find(slot => slot?.replacementEligible === true);
  return Number.isSafeInteger(target?.slot) ? `party-slot:${target.slot}` : null;
}

/**
 * Decide the next navigation action from the current semantic observation.
 * Returns one of:
 *   { kind: "wait" }         no observation yet - poll again
 *   { kind: "submit" }       the target option is selected - press the submit key
 *   { kind: "navigate" }     move the cursor (caller presses a nav key, then verifies)
 *   { kind: "unavailable" }  the target id is not among the visible options - loud fail
 */
export function planNavigationStep(observation, targetId) {
  if (observation == null) {
    return { kind: "wait" };
  }
  // A semantic selection is not permission to press yet. Option panels are rebuilt when
  // dynamic data changes (notably the co-op lobby), and the production handler deliberately
  // blocks input during that repaint. Treat the mirror's readiness as part of the public UI
  // state so a real key cannot be swallowed between "selected" and "submit".
  if (!isActionableSemanticObservation(observation, { requireExplicitUnblocked: true })) {
    return { kind: "wait" };
  }
  if (observation.selectedOptionId === targetId) {
    return { kind: "submit" };
  }
  if (Array.isArray(observation.optionIds) && !observation.optionIds.includes(targetId)) {
    return { kind: "unavailable" };
  }
  return { kind: "navigate" };
}

function orderedAxisKeys(navKeys) {
  if (navKeys.length !== 2) {
    return null;
  }
  if (navKeys.includes("ArrowDown") && navKeys.includes("ArrowUp")) {
    return { forward: "ArrowDown", backward: "ArrowUp" };
  }
  if (navKeys.includes("ArrowRight") && navKeys.includes("ArrowLeft")) {
    return { forward: "ArrowRight", backward: "ArrowLeft" };
  }
  return null;
}

/**
 * Prefer a directed step when the semantic surface exposes a one-dimensional ordered list.
 * Alternating Up/Down from the first item only visits the two wrap-around endpoints and can
 * permanently skip every middle option (the real difficulty menu exposed exactly this failure).
 * Grid-shaped surfaces keep the caller's axis-cycling fallback because option order does not
 * describe their geometry.
 */
export function chooseNavigationKey(observation, targetId, navKeys, step) {
  const options = observation?.optionIds;
  const current = Array.isArray(options) ? options.indexOf(observation.selectedOptionId) : -1;
  const target = Array.isArray(options) ? options.indexOf(targetId) : -1;
  const axis = orderedAxisKeys(navKeys);
  if (axis != null && current >= 0 && target >= 0 && options.length > 1) {
    const forward = (target - current + options.length) % options.length;
    const backward = (current - target + options.length) % options.length;
    return forward <= backward ? axis.forward : axis.backward;
  }
  return navKeys[step % navKeys.length];
}

/** Wait until a semantic observation for `surfaceId` appears at/after `fromCursor`, or null on timeout. */
async function readSemantic(client, surfaceId, fromCursor, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = client.evidence.findLastSemanticSurface(fromCursor, surfaceId);
    if (event) {
      return event;
    }
    await delay(80);
  }
  return null;
}

/** Wait for a real semantic surface emitted after `fromCursor`. */
export async function waitForSemanticSurface(client, surfaceId, { fromCursor = 0, timeoutMs = 15_000 } = {}) {
  const event = await readSemantic(client, surfaceId, fromCursor, timeoutMs);
  if (event == null) {
    throw new Error(`${client.label}: timed out waiting for semantic surface ${surfaceId}`);
  }
  return event;
}

/** Wait for a rendered option surface whose production handler will accept an action now. */
export async function waitForActionableSemanticSurface(client, surfaceId, { fromCursor = 0, timeoutMs = 15_000 } = {}) {
  return client.evidence.waitForCondition(
    sink => {
      const event = sink.findLastSemanticSurface(fromCursor, surfaceId);
      return isActionableSemanticObservation(event?.observation, { requireExplicitUnblocked: true }) ? event : null;
    },
    { timeoutMs, description: `actionable semantic surface ${surfaceId}` },
  );
}

/**
 * Select slot zero on the fresh-account SAVE screen. The registered-account fixture has no saves; this
 * helper waits for the real handler's public loaded+empty projection before issuing the same ACTION a player uses.
 */
export async function selectFirstEmptySaveSlot(client, { fromCursor = 0, timeoutMs = 15_000 } = {}) {
  const ready = await client.evidence.waitForCondition(
    sink => {
      const event = sink.findLastSemanticSurface(fromCursor, "save-slot");
      return event?.observation.ready.handlerActive === true && event.observation.selectedOptionId === "empty-slot:0"
        ? event
        : null;
    },
    { timeoutMs, description: "fresh-account first loaded empty save slot" },
  );
  client.evidence.record("fresh-save-slot-proof", {
    surfaceId: ready.observation.surfaceId,
    selectedOptionId: ready.observation.selectedOptionId,
  });
  await client.press("Space", "fresh-save-slot-0");
}

/** One starter per seat could not survive wave 2 after the enemy-kit rebalance.
 * Two per seat is the largest fresh-account team the real five-point co-op budget
 * guarantees and exercises faint-replacement sync. */
const MIN_STARTERS_PER_SEAT = 2;
const COOP_STARTER_BUDGET = 5;
const STARTER_GRID_COLUMNS = 9;

/** The party size the visible starter bar last showed in this evidence sink (observer-read). */
function visibleTeamSize(sink, fromCursor) {
  const team = sink.findLastSemanticSurface(fromCursor, "starter-select")?.observation.teamSpeciesIds;
  return Array.isArray(team) ? team.length : 0;
}

function requireRepresentativeStarterTeam(client, fielded) {
  if (fielded < MIN_STARTERS_PER_SEAT) {
    throw new Error(
      `${client.label}: fielded ${fielded}/${MIN_STARTERS_PER_SEAT} minimum starters through the public UI; `
        + "the campaign would not represent survivability or faint-replacement sync",
    );
  }
}

async function waitForVisibleTeamGrowth(client, fromCursor, fielded, timeoutMs) {
  return client.evidence
    .waitForCondition(
      sink => {
        const size = visibleTeamSize(sink, fromCursor);
        return size > fielded ? size : null;
      },
      {
        timeoutMs,
        description: `visible starter team grew past ${fielded}`,
      },
    )
    .then(
      size => size,
      () => null,
    );
}

/** Pick the strongest affordable pair from the observer's read-only visible/caught grid projection. */
export function chooseAffordableStarterPair(observation, budget = COOP_STARTER_BUDGET) {
  const candidates = Array.isArray(observation?.starterGridCandidates)
    ? observation.starterGridCandidates.filter(
        candidate =>
          Number.isSafeInteger(candidate?.index)
          && Number.isSafeInteger(candidate?.speciesId)
          && typeof candidate?.cost === "number"
          && candidate.cost > 0,
      )
    : [];
  let best = null;
  for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      const pair = [candidates[left], candidates[right]];
      const total = pair[0].cost + pair[1].cost;
      if (total > budget) {
        continue;
      }
      const score = [total, -Math.max(pair[0].index, pair[1].index)];
      if (best == null || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) {
        best = { pair, score };
      }
    }
  }
  return best?.pair ?? null;
}

async function waitForStarterGridMove(client, fromIndex, selectedOptionId, timeoutMs) {
  return client.evidence.waitForCondition(
    sink => {
      const event = sink.findLastSemanticSurface(0, "starter-select");
      return event?.index > fromIndex
        && event.observation.selectedOptionId?.startsWith("starter-grid:")
        && event.observation.selectedOptionId !== selectedOptionId
        ? event
        : null;
    },
    { timeoutMs, description: `starter grid moved from ${selectedOptionId}` },
  );
}

async function moveStarterGridTo(client, target, timeoutMs) {
  let event = client.evidence.findLastSemanticSurface(0, "starter-select");
  if (!event?.observation.selectedOptionId?.startsWith("starter-grid:")) {
    const enterCursor = client.evidence.cursor();
    await client.press("ArrowRight", "starter-enter-grid");
    event = await client.evidence.waitForCondition(
      sink => {
        const next = sink.findLastSemanticSurface(enterCursor, "starter-select");
        return next?.observation.selectedOptionId?.startsWith("starter-grid:") ? next : null;
      },
      { timeoutMs, description: "starter grid cursor after entering from side controls" },
    );
  }

  for (let step = 0; step < 64; step++) {
    const current = Number(event.observation.selectedOptionId.slice("starter-grid:".length));
    if (current === target.index) {
      return event;
    }
    const currentRow = Math.floor(current / STARTER_GRID_COLUMNS);
    const targetRow = Math.floor(target.index / STARTER_GRID_COLUMNS);
    const key =
      currentRow < targetRow
        ? "ArrowDown"
        : currentRow > targetRow
          ? "ArrowUp"
          : current < target.index
            ? "ArrowRight"
            : "ArrowLeft";
    const beforeIndex = event.index;
    const beforeId = event.observation.selectedOptionId;
    await client.press(key, `starter-grid-to-${target.speciesId}:step-${step}`);
    event = await waitForStarterGridMove(client, beforeIndex, beforeId, timeoutMs);
  }
  throw new Error(`${client.label}: starter grid did not reach species ${target.speciesId} at index ${target.index}`);
}

async function addStarterGridCandidate(client, target, fielded, timeoutMs) {
  await moveStarterGridTo(client, target, timeoutMs);
  const optionCursor = client.evidence.cursor();
  await client.press("Space", `starter-open-${target.speciesId}`);
  await waitForSemanticSurface(client, "option-select:SelectStarterPhase", {
    fromCursor: optionCursor,
    timeoutMs,
  });
  const addCursor = client.evidence.cursor();
  await selectOptionById(client, {
    surfaceId: "option-select:SelectStarterPhase",
    targetId: "add-to-party",
    navKeys: ["ArrowDown", "ArrowUp"],
    fromCursor: optionCursor,
    timeoutMs,
  });
  const grownSize = await waitForVisibleTeamGrowth(client, addCursor, fielded, timeoutMs);
  if (grownSize == null) {
    throw new Error(`${client.label}: visible team did not accept starter species ${target.speciesId}`);
  }
  client.evidence.record("starter-grid-add-proof", { target, fielded: grownSize });
  return grownSize;
}

/**
 * Build a representative team through deterministic public grid navigation. Random selection can
 * legally choose a cost-4 lead three times in a row and leave no room for a second mon, making a
 * release gate probabilistic. The observer only reports the visible/caught grid and costs; every
 * state change remains a real human keyboard action against the production UI.
 */
export async function confirmDefaultStarterTeam(client, { fromCursor = client.pageCursor, timeoutMs = 15_000 } = {}) {
  const starterSurface = await waitForActionableSemanticSurface(client, "starter-select", { fromCursor, timeoutMs });
  const targets = chooseAffordableStarterPair(starterSurface.observation);
  if (targets == null) {
    throw new Error(
      `${client.label}: visible starter grid exposed no two-mon team within the ${COOP_STARTER_BUDGET}-point budget`,
    );
  }

  let fielded = visibleTeamSize(client.evidence, fromCursor);
  for (const target of targets) {
    fielded = await addStarterGridCandidate(client, target, fielded, timeoutMs);
  }
  requireRepresentativeStarterTeam(client, fielded);
  client.evidence.record("starter-team-fielded", { fielded, target: MIN_STARTERS_PER_SEAT });
  const confirmCursor = client.evidence.cursor();
  await client.press("Enter", "starter-submit-team");
  await waitForSemanticSurface(client, "confirm:SelectStarterPhase", {
    fromCursor: confirmCursor,
    timeoutMs,
  });
  const launchCursor = client.evidence.cursor();
  await client.press("Space", "starter-confirm-team");
  return { launchCursor };
}

/**
 * Submit and confirm a visible party materialized by a build-gated public-browser fixture.
 * The observer is assertion-only: Enter and Space are still the real public starter UI actions.
 */
export async function confirmSeededStarterTeam(
  client,
  expectedSpecies,
  { fromCursor = client.pageCursor, timeoutMs = 15_000 } = {},
) {
  const expectedSpeciesIds = Array.isArray(expectedSpecies) ? expectedSpecies : [expectedSpecies];
  const seeded = await client.evidence.waitForCondition(
    sink => {
      const event = sink.findLastSemanticSurface(fromCursor, "starter-select");
      return JSON.stringify(event?.observation.teamSpeciesIds) === JSON.stringify(expectedSpeciesIds) ? event : null;
    },
    {
      timeoutMs,
      description: `visible seeded starter team species=${expectedSpeciesIds.join(",")}`,
    },
  );
  client.evidence.record("seeded-starter-visible-proof", {
    expectedSpeciesIds,
    observation: seeded.observation,
  });
  await waitForActionableSemanticSurface(client, "starter-select", { fromCursor, timeoutMs });
  const confirmCursor = client.evidence.cursor();
  await client.press("Enter", "starter-submit-visible-seeded-team");
  await waitForSemanticSurface(client, "confirm:SelectStarterPhase", {
    fromCursor: confirmCursor,
    timeoutMs,
  });
  const launchCursor = client.evidence.cursor();
  await client.press("Space", "starter-confirm-visible-seeded-team");
  return { launchCursor };
}

/**
 * Drive `client` to select the option with stable id `targetId` on `surfaceId`, verifying
 * that each navigation keypress actually changed the selected id (a press that does not move
 * the cursor is a stall; too many in a row is a loud failure, never a silent blind pulse).
 * Presses `submitKey` once the target is selected. Throws on unavailable target / stall /
 * budget exhaustion. Returns `{ steps }`.
 */
export async function selectOptionById(
  client,
  {
    surfaceId,
    targetId,
    navKeys = ["ArrowDown"],
    submitKey = "Space",
    submit = true,
    maxSteps = 24,
    timeoutMs = 15_000,
    fromCursor = 0,
  },
) {
  const label = `${surfaceId}->${targetId}`;
  let stalls = 0;
  let step = 0;
  const deadline = Date.now() + timeoutMs;
  while (step < maxSteps && Date.now() < deadline) {
    const remainingMs = Math.max(1, deadline - Date.now());
    const event = await readSemantic(client, surfaceId, fromCursor, remainingMs);
    if (!event) {
      throw new Error(`${client.label}: selectOptionById(${label}) saw no ${surfaceId} semantic surface`);
    }
    const observation = event.observation;
    const plan = planNavigationStep(observation, targetId);
    if (plan.kind === "wait") {
      await delay(Math.min(80, remainingMs));
      continue;
    }
    if (plan.kind === "submit") {
      if (submit) {
        await client.press(submitKey, `nav-submit-${label}`);
      }
      client.evidence.record("campaign-nav", {
        surfaceId,
        targetId,
        action: submit ? "submit" : "selected",
        steps: step,
      });
      return { steps: step, surfaceEventIndex: event.index };
    }
    if (plan.kind === "unavailable") {
      throw new Error(
        `${client.label}: selectOptionById(${label}) target not in options ${JSON.stringify(observation.optionIds)}`,
      );
    }
    // navigate: press a direction, then verify the selected id actually changed.
    const before = observation.selectedOptionId;
    const beforeIndex = event.index;
    const key = chooseNavigationKey(observation, targetId, navKeys, step);
    await client.press(key, `nav-move-${label}-step${step}`);
    const afterEvent = await waitForNewerSelection(client, surfaceId, beforeIndex, before, remainingMs);
    if (afterEvent == null) {
      stalls += 1;
      client.evidence.record("campaign-nav", { surfaceId, targetId, action: "stall", key, step });
      // Cycle through the provided nav axes before giving up (e.g. a 2x2 grid needs Down + Right).
      if (stalls > navKeys.length) {
        throw new Error(`${client.label}: selectOptionById(${label}) cursor did not move after ${stalls} presses`);
      }
    } else {
      stalls = 0;
    }
    step += 1;
  }
  if (Date.now() >= deadline) {
    throw new Error(`${client.label}: selectOptionById(${label}) timed out waiting for an actionable target`);
  }
  throw new Error(`${client.label}: selectOptionById(${label}) did not reach the target in ${maxSteps} steps`);
}

/** Wait for a v2 observation newer than `fromIndex` whose selected id differs from `before`. */
async function waitForNewerSelection(client, surfaceId, fromIndex, before, timeoutMs) {
  const deadline = Date.now() + Math.min(timeoutMs, 4_000);
  while (Date.now() < deadline) {
    const event = client.evidence.findLastSemanticSurface(0, surfaceId);
    if (event && event.index > fromIndex && event.observation.selectedOptionId !== before) {
      return event;
    }
    await delay(80);
  }
  return null;
}
