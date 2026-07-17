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

/** How many starters each seat tries to field. One starter per seat could not survive wave 2
 *  after the enemy-kit rebalance (run 29551213918 depth: a lone Bulbasaur wiped to a bug double)
 *  - a two-player party of six is the representative real-play shape AND exercises the co-op
 *  faint-replacement sync paths the single-mon party never reached. */
const STARTERS_PER_SEAT = 3;

/** The party size the visible starter bar last showed in this evidence sink (observer-read). */
function visibleTeamSize(sink, fromCursor) {
  const team = sink.findLastSemanticSurface(fromCursor, "starter-select")?.observation.teamSpeciesIds;
  return Array.isArray(team) ? team.length : 0;
}

/**
 * Field up to {@linkcode STARTERS_PER_SEAT} starters, submit the team, and confirm.
 * Every transition is observed before the next public key is sent, so text animation or a slow
 * browser cannot reinterpret a later key on the previous screen. Each ADD is verified against
 * the visible team bar (`teamSpeciesIds` growth); an add the game refuses (starter-point cap)
 * closes the option menu and stops adding - at least ONE fielded starter stays mandatory.
 */
export async function confirmDefaultStarterTeam(client, { fromCursor = client.pageCursor, timeoutMs = 15_000 } = {}) {
  await waitForActionableSemanticSurface(client, "starter-select", { fromCursor, timeoutMs });
  let fielded = 0;
  for (let slot = 0; slot < STARTERS_PER_SEAT; slot++) {
    if (slot > 0) {
      // Move the grid cursor to the next starter. The move itself is best-effort (the grid
      // cursor is not semantically labeled); the ADD below is the verified step either way.
      await client.press("ArrowRight", `starter-move-to-slot-${slot}`);
    }
    const optionCursor = client.evidence.cursor();
    await client.press("Space", `starter-open-selected-options:slot-${slot}`);
    try {
      await waitForSemanticSurface(client, "option-select:SelectStarterPhase", {
        fromCursor: optionCursor,
        timeoutMs: slot === 0 ? timeoutMs : 5_000,
      });
    } catch (error) {
      if (slot === 0) {
        throw error; // the first starter's menu MUST open - that path was always mandatory
      }
      // A locked/unaffordable grid slot opens no menu: field what we have.
      client.evidence.record("starter-add-stopped", { slot, fielded, reason: "starter option menu did not open" });
      break;
    }
    const starterCursor = client.evidence.cursor();
    try {
      await selectOptionById(client, {
        surfaceId: "option-select:SelectStarterPhase",
        targetId: "add-to-party",
        navKeys: ["ArrowUp", "ArrowDown"],
        timeoutMs,
      });
    } catch (error) {
      // No visible add-to-party option (cap reached / not addable): close the menu and field
      // what we have. A zero-starter team is still a hard failure below.
      client.evidence.record("starter-add-stopped", { slot, fielded, reason: String(error?.message ?? error) });
      await client.press("Backspace", `starter-close-options:slot-${slot}`);
      break;
    }
    await waitForSemanticSurface(client, "starter-select", { fromCursor: starterCursor, timeoutMs });
    const grown = await client.evidence
      .waitForCondition(sink => (visibleTeamSize(sink, starterCursor) > fielded ? true : null), {
        timeoutMs: 5_000,
        description: `visible starter team grew past ${fielded}`,
      })
      .then(
        () => true,
        () => false,
      );
    if (!grown) {
      client.evidence.record("starter-add-stopped", { slot, fielded, reason: "team bar did not grow (cap)" });
      break;
    }
    fielded += 1;
  }
  if (fielded === 0) {
    throw new Error(`${client.label}: could not field a single starter through the public UI`);
  }
  client.evidence.record("starter-team-fielded", { fielded, target: STARTERS_PER_SEAT });
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
      return { steps: step };
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
