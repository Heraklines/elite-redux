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

/**
 * Select the visible starter, add it through its option menu, submit the team, and confirm.
 * Every transition is observed before the next public key is sent, so text animation or a slow
 * browser cannot reinterpret a later key on the previous screen.
 */
export async function confirmDefaultStarterTeam(client, { timeoutMs = 15_000 } = {}) {
  const optionCursor = client.evidence.cursor();
  await client.press("Space", "starter-open-selected-options");
  await waitForSemanticSurface(client, "option-select:SelectStarterPhase", {
    fromCursor: optionCursor,
    timeoutMs,
  });
  const starterCursor = client.evidence.cursor();
  await selectOptionById(client, {
    surfaceId: "option-select:SelectStarterPhase",
    targetId: "add-to-party",
    navKeys: ["ArrowUp", "ArrowDown"],
    timeoutMs,
  });

  await waitForSemanticSurface(client, "starter-select", { fromCursor: starterCursor, timeoutMs });
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
  },
) {
  const label = `${surfaceId}->${targetId}`;
  let stalls = 0;
  for (let step = 0; step < maxSteps; step++) {
    const event = await readSemantic(client, surfaceId, 0, timeoutMs);
    if (!event) {
      throw new Error(`${client.label}: selectOptionById(${label}) saw no ${surfaceId} semantic surface`);
    }
    const observation = event.observation;
    const plan = planNavigationStep(observation, targetId);
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
    const afterEvent = await waitForNewerSelection(client, surfaceId, beforeIndex, before, timeoutMs);
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
