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
  // SLOT-LIST form only: a surface exposing the mon action SUBMENU (party-option:* ids) is the
  // picker mid-descent - driving party-slot:* keys at it throws "target not in options"
  // (run 29613070126: an errant Space had opened the fainted FIELD slot's submenu, which
  // correctly lacks send-out). The driver must wait for / recover to the slot list.
  const slotListForm = !(
    Array.isArray(observation?.optionIds) && observation.optionIds.some(id => /^party-option:/u.test(id))
  );
  return observation?.operationClass === "replacement"
    && observation.ownerModel === "interaction"
    && (observation.phase === "SwitchPhase" || observation.phase === "CoopGuestFaintSwitchPhase")
    && observation.uiMode === "PARTY"
    && observation.localSeat === client.publicSeat
    && observation.ownerSeat === client.publicSeat
    && observation.seatsWithInput?.includes(client.publicSeat)
    && slotListForm
    && isActionableSemanticObservation(observation, { requireExplicitUnblocked: true })
    ? event
    : null;
}

/** Phases that host a mystery-encounter PARTY sub-prompt: the authoritative host runs it from
 * MysteryEncounterPhase; a guest owner renders it from its CoopReplayMePhase replay. */
const MYSTERY_PARTY_PHASES = new Set(["MysteryEncounterPhase", "CoopReplayMePhase"]);

/**
 * A mystery-encounter PARTY sub-prompt owned by THIS browser's local seat, ready for a key.
 *
 * A `selectPokemonForOption` ME (e.g. PART_TIMER) opens the party UI (`PartyUiMode.SELECT`) on the
 * OWNER client only; the watcher never renders it. Unlike the faint picker (`party:replacement`,
 * `ownerModel: "interaction"`, `ownerSeat === localSeat`), this sub-prompt projects as the plain
 * `party` surface with `ownerModel: "local"` and `ownerSeat: null` - the owner is the seat listed
 * in `seatsWithInput`. So `findSemanticOwner` (which needs `ownerSeat === localSeat`) can never
 * resolve it; this dedicated predicate does, and stays INERT for any non-ME party surface
 * (a between-wave party context has `mysteryEncounterType == null`).
 */
export function findOwnedActionableMysteryPartySurface(client, fromCursor = 0) {
  const event = client.evidence.findLastSemanticSurface(fromCursor, "party");
  const observation = event?.observation;
  // SLOT-LIST form only (same guard as the faint picker): a surface exposing the mon action
  // SUBMENU (party-option:* ids) is the picker mid-descent; driving party-slot:* keys at it throws
  // "target not in options". The driver waits for / recovers to the slot list.
  const slotListForm = !(
    Array.isArray(observation?.optionIds) && observation.optionIds.some(id => /^party-option:/u.test(id))
  );
  return observation?.operationClass === "party"
    && observation.ownerModel === "local"
    && MYSTERY_PARTY_PHASES.has(observation.phase)
    && Number.isSafeInteger(observation.mysteryEncounterType)
    && observation.uiMode === "PARTY"
    && observation.localSeat === client.publicSeat
    && Array.isArray(observation.seatsWithInput)
    && observation.seatsWithInput.length === 1
    && observation.seatsWithInput.includes(client.publicSeat)
    && Array.isArray(observation.optionIds)
    && observation.optionIds.some(id => /^party-slot:\d+$/u.test(id))
    && slotListForm
    && isActionableSemanticObservation(observation, { requireExplicitUnblocked: true })
    ? event
    : null;
}

/** Whether ANY latest surface at/after the cursor is an OPEN party picker (faint replacement or an
 * ME party sub-prompt). The between-wave advancers must not press a stale prompt Space THROUGH an
 * open party UI into a default slot selection (mirrors the existing `party:replacement` guard). */
export function isPartyPickerSurfaceOpen(observation) {
  if (observation?.uiMode !== "PARTY") {
    return false;
  }
  if (observation.surfaceId === "party:replacement") {
    return true;
  }
  return (
    observation.surfaceId === "party"
    && observation.operationClass === "party"
    && Number.isSafeInteger(observation.mysteryEncounterType)
  );
}

/** The first legal party slot for an ME party sub-prompt: an in-battle-eligible, non-fainted mon
 * (the `selectPokemonForOption` filter class - PART_TIMER accepts any non-KOd party member). */
export function mysteryPartyTargetOptionId(observation) {
  const target = observation?.partySlots?.find(slot => slot?.allowedInBattle === true && slot?.fainted !== true);
  return Number.isSafeInteger(target?.slot) ? `party-slot:${target.slot}` : null;
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

function navigationKeysForSurface(observation, navKeys) {
  // The title is not a cyclic list: UP from its first menu row transfers focus to the
  // notification inbox, where further UP presses are intentionally swallowed. The semantic
  // menu projection contains only the visible option rows, so shortest-path list arithmetic
  // would strand the public driver on that unprojected focus target. DOWN always walks and
  // wraps through every title option using the same path available to a human player.
  if (observation?.surfaceId === "title-menu" && navKeys.includes("ArrowDown")) {
    return ["ArrowDown"];
  }
  // Reward cards form one horizontal carousel. A generic four-axis fallback alternates
  // RIGHT/LEFT and can therefore bounce forever between the first two cards, never reaching
  // the third (10x benchmark run 30377355501). Keep both horizontal directions so ordered
  // shortest-path navigation can use the wrap-around edge exactly like a player.
  if (observation?.surfaceId === "reward-shop" && navKeys.includes("ArrowRight") && navKeys.includes("ArrowLeft")) {
    return ["ArrowRight", "ArrowLeft"];
  }
  return navKeys;
}

/**
 * Prefer a directed step when the semantic surface exposes a one-dimensional ordered list.
 * Alternating Up/Down from the first item only visits the two wrap-around endpoints and can
 * permanently skip every middle option (the real difficulty menu exposed exactly this failure).
 * Grid-shaped surfaces keep the caller's axis-cycling fallback because option order does not
 * describe their geometry.
 */
export function chooseNavigationKey(observation, targetId, navKeys, step) {
  const surfaceNavKeys = navigationKeysForSurface(observation, navKeys);
  const options = observation?.optionIds;
  const current = Array.isArray(options) ? options.indexOf(observation.selectedOptionId) : -1;
  const target = Array.isArray(options) ? options.indexOf(targetId) : -1;
  // COMMAND and FIGHT are two-column grids (and may gain a fifth cell). Their option
  // order is stable, but treating either as a one-dimensional wrap-around list sends
  // arrows to nonexistent neighbours. Follow the same row/column geometry a human sees.
  if (
    (observation?.surfaceId === "command:command" || observation?.surfaceId === "command:fight")
    && current >= 0
    && target >= 0
    && surfaceNavKeys.includes("ArrowUp")
    && surfaceNavKeys.includes("ArrowDown")
    && surfaceNavKeys.includes("ArrowLeft")
    && surfaceNavKeys.includes("ArrowRight")
  ) {
    const currentRow = Math.floor(current / 2);
    const targetRow = Math.floor(target / 2);
    if (currentRow < targetRow) {
      return "ArrowDown";
    }
    if (currentRow > targetRow) {
      return "ArrowUp";
    }
    return current < target ? "ArrowRight" : "ArrowLeft";
  }
  const axis = orderedAxisKeys(surfaceNavKeys);
  if (axis != null && current >= 0 && target >= 0 && options.length > 1) {
    const forward = (target - current + options.length) % options.length;
    const backward = (current - target + options.length) % options.length;
    return forward <= backward ? axis.forward : axis.backward;
  }
  return surfaceNavKeys[step % surfaceNavKeys.length];
}

/**
 * Choose a real, currently selectable move from the read-only FIGHT projection.
 * Damaging moves beat status moves; higher visible power wins; stable slot order
 * breaks ties. Later rounds cycle through those damaging candidates so one hidden
 * immunity cannot trap the representative campaign in a permanent no-progress loop.
 * Fixed-damage attacks can report non-positive power, so category is also considered
 * instead of assuming `power > 0` is the complete damage model.
 */
export function chooseBestCampaignMove(observation, cycleIndex = 0) {
  if (
    observation?.surfaceId !== "command:fight"
    || !Array.isArray(observation.optionIds)
    || !Array.isArray(observation.moveSlots)
  ) {
    return null;
  }
  const selectable = observation.moveSlots.filter(
    slot =>
      Number.isSafeInteger(slot?.index)
      && Number.isSafeInteger(slot?.moveId)
      && typeof slot?.optionId === "string"
      && observation.optionIds.includes(slot.optionId)
      && slot.usable === true,
  );
  selectable.sort((left, right) => {
    const leftDamaging = left.category !== "STATUS";
    const rightDamaging = right.category !== "STATUS";
    return (
      Number(rightDamaging) - Number(leftDamaging)
      || Math.max(0, right.power ?? 0) - Math.max(0, left.power ?? 0)
      || left.index - right.index
    );
  });
  const damaging = selectable.filter(slot => slot.category !== "STATUS");
  const candidates = damaging.length > 0 ? damaging : selectable;
  const normalizedCycle = Number.isSafeInteger(cycleIndex) ? Math.max(0, cycleIndex) : 0;
  return candidates[normalizedCycle % candidates.length] ?? null;
}

function partyHealthRatio(slot) {
  return typeof slot?.hp === "number" && typeof slot?.maxHp === "number" && slot.maxHp > 0
    ? slot.hp / slot.maxHp
    : null;
}

/**
 * Choose a voluntary switch only when this seat's active is critically injured and one of its own
 * visible reserves is meaningfully healthier. The command screen already renders the party team bar;
 * this helper reads its semantic mirror but performs no mutation. Requiring a 25-point health gain
 * prevents the driver from oscillating between two equally damaged mons merely to manufacture coverage.
 */
export function chooseVoluntarySwitchTarget(observation, criticalRatio = 0.4, minimumGain = 0.25) {
  if (
    observation?.surfaceId !== "command:command"
    || !/^(?:host|guest)$/u.test(observation.localRole)
    || !Array.isArray(observation.partySlots)
  ) {
    return null;
  }
  const owned = observation.partySlots.filter(slot => slot?.coopOwner === observation.localRole);
  const active = owned.find(slot => slot?.active === true && slot?.fainted !== true);
  const activeRatio = partyHealthRatio(active);
  if (activeRatio == null || activeRatio > criticalRatio) {
    return null;
  }
  const reserve = owned
    .filter(slot => slot?.active !== true && slot?.fainted !== true && slot?.allowedInBattle === true)
    .map(slot => ({ slot, ratio: partyHealthRatio(slot) }))
    .filter(candidate => candidate.ratio != null && candidate.ratio >= activeRatio + minimumGain)
    .sort((left, right) => right.ratio - left.ratio || left.slot.slot - right.slot.slot)[0]?.slot;
  return Number.isSafeInteger(reserve?.slot) ? `party-slot:${reserve.slot}` : null;
}

async function driveCampaignVoluntarySwitch(client, command, targetId, purpose, timeoutMs) {
  const partyCursor = client.evidence.cursor();
  await selectOptionById(client, {
    surfaceId: "command:command",
    targetId: "command:pokemon",
    navKeys: ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"],
    submitKey: "Space",
    fromCursor: command.index,
    timeoutMs,
  });
  await selectOptionById(client, {
    surfaceId: "party",
    targetId,
    navKeys: ["ArrowDown", "ArrowUp"],
    submit: false,
    fromCursor: partyCursor,
    timeoutMs,
  });
  const actionMenuCursor = client.evidence.cursor();
  await client.press("Space", `${purpose}-open-${targetId}`);
  const actionMenu = await client.evidence.waitForCondition(
    sink => {
      const event = sink.findLastSemanticSurface(actionMenuCursor, "party");
      return event?.observation.optionIds?.includes("party-option:send-out") ? event : null;
    },
    { timeoutMs, description: `${purpose} actionable party SEND OUT submenu` },
  );
  await selectOptionById(client, {
    surfaceId: "party",
    targetId: "party-option:send-out",
    navKeys: ["ArrowDown", "ArrowUp"],
    fromCursor: actionMenu.index,
    timeoutMs,
  });
  client.evidence.record("campaign-voluntary-switch", { purpose, targetId });
}

/**
 * Submit a survivability-aware command through the ordinary command UI: make a proven healthier
 * voluntary switch when the acting mon is critical, otherwise choose the strongest visible usable
 * move. All decisions come from the public semantic mirror; all state changes are Space/arrow key
 * presses. Move target selection remains owned by the harness's addressed command-target driver.
 */
export async function driveBestCampaignMove(
  client,
  purpose,
  { timeoutMs = 15_000, cycleIndex = 0, commandEvent = null } = {},
) {
  const command =
    commandEvent?.observation?.surfaceId === "command:command"
      ? commandEvent
      : client.evidence.findLastSemanticSurface(0, "command:command");
  if (command == null) {
    throw new Error(`${client.label}: ${purpose} exposed no command:command semantic surface`);
  }
  const switchTarget = chooseVoluntarySwitchTarget(command.observation);
  if (switchTarget != null) {
    await driveCampaignVoluntarySwitch(client, command, switchTarget, purpose, timeoutMs);
    return;
  }
  const fightCursor = client.evidence.cursor();
  // CommandUiHandler remembers its cursor. A cancelled/superseded target flow can therefore reopen
  // COMMAND on Ball, Pokemon, or Run. Pressing Space blindly here opened that remembered option and
  // made the driver wait forever for FIGHT (depth run 30357074506). Navigate the same visible grid a
  // human uses and prove Fight is selected before submitting.
  await selectOptionById(client, {
    surfaceId: "command:command",
    targetId: "command:fight",
    navKeys: ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"],
    submitKey: "Space",
    fromCursor: command.index,
    timeoutMs,
  });
  const fight = await waitForActionableSemanticSurface(client, "command:fight", {
    fromCursor: fightCursor,
    timeoutMs,
  });
  const move = chooseBestCampaignMove(fight.observation, cycleIndex);
  if (move == null) {
    throw new Error(
      `${client.label}: ${purpose} exposed no observer-proven usable move: `
        + `${JSON.stringify(fight.observation.moveSlots ?? null)}`,
    );
  }
  await selectOptionById(client, {
    surfaceId: "command:fight",
    targetId: move.optionId,
    navKeys: ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"],
    submitKey: "Space",
    fromCursor: fightCursor,
    timeoutMs,
  });
  client.evidence.record("campaign-battle-move", {
    purpose,
    moveId: move.moveId,
    slot: move.index,
    power: move.power,
    category: move.category,
    optionId: move.optionId,
    cycleIndex,
  });
  return move;
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

// Stable species ids are part of the public starter-grid projection. Use that visible identity
// only to prevent both seats from independently choosing the same mono-type pair. This remains
// ordinary human selection through the production grid; it grants no fixture-only Pokemon.
const STARTER_FAMILY_BY_SPECIES = new Map([
  ...[1, 152, 252, 387, 495, 650, 722, 810, 906].map(speciesId => [speciesId, "grass"]),
  ...[4, 155, 255, 390, 498, 653, 725, 813, 909].map(speciesId => [speciesId, "fire"]),
  ...[7, 158, 258, 393, 501, 656, 728, 816, 912].map(speciesId => [speciesId, "water"]),
]);

function starterPairScore(pair, preferredSupportFamily) {
  const families = pair.map(candidate => STARTER_FAMILY_BY_SPECIES.get(candidate.speciesId)).filter(Boolean);
  return [
    pair[0].cost + pair[1].cost,
    families.includes(preferredSupportFamily) ? 1 : 0,
    new Set(families).size,
    -Math.max(pair[0].index, pair[1].index),
  ];
}

function starterScoreOutranks(score, incumbent) {
  if (incumbent == null) {
    return true;
  }
  for (let index = 0; index < score.length; index++) {
    if (score[index] !== incumbent[index]) {
      return score[index] > incumbent[index];
    }
  }
  return false;
}

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

/** Pick an affordable, seat-diverse pair from the observer's read-only visible/caught grid projection. */
export function chooseAffordableStarterPair(observation, budget = COOP_STARTER_BUDGET, publicSeat = 0) {
  const candidates = Array.isArray(observation?.starterGridCandidates)
    ? observation.starterGridCandidates.filter(
        candidate =>
          Number.isSafeInteger(candidate?.index)
          && Number.isSafeInteger(candidate?.speciesId)
          && typeof candidate?.cost === "number"
          && candidate.cost > 0,
      )
    : [];
  const preferredSupportFamily =
    Math.abs(Number.isSafeInteger(publicSeat) ? publicSeat : 0) % 2 === 0 ? "fire" : "water";
  let best = null;
  for (let left = 0; left < candidates.length; left++) {
    for (let right = left + 1; right < candidates.length; right++) {
      const pair = [candidates[left], candidates[right]];
      const total = pair[0].cost + pair[1].cost;
      if (total > budget) {
        continue;
      }
      const score = starterPairScore(pair, preferredSupportFamily);
      if (starterScoreOutranks(score, best?.score)) {
        best = { pair, score };
      }
    }
  }
  if (best == null) {
    return null;
  }
  // Selection order determines the lead. Put each seat's deliberately different support family
  // first so the two active Pokemon do not both open as the same weak Grass starter while the Fire
  // and Water coverage sits in reserve. This is ordinary public starter-grid behavior and keeps the
  // fresh depth profile representative without seeding stats, granting items, or accepting a wipe.
  return best.pair.toSorted((left, right) => {
    const leftPreferred = STARTER_FAMILY_BY_SPECIES.get(left.speciesId) === preferredSupportFamily;
    const rightPreferred = STARTER_FAMILY_BY_SPECIES.get(right.speciesId) === preferredSupportFamily;
    return Number(rightPreferred) - Number(leftPreferred);
  });
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
  const targets = chooseAffordableStarterPair(starterSurface.observation, COOP_STARTER_BUDGET, client.publicSeat);
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
