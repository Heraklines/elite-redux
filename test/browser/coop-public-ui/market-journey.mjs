/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { delay } from "./evidence.mjs";

const MARKET_COLUMNS = 4;

function sameAddress(left, right) {
  return left?.epoch === right?.epoch && left?.wave === right?.wave && left?.turn === right?.turn;
}

function optionById(observation, targetId) {
  return observation.options.find(option => option.id === targetId) ?? null;
}

function quantityOf(observation, typeId, pokemonId) {
  return observation.heldModifiers
    .filter(modifier => modifier.typeId === typeId && modifier.pokemonId === pokemonId)
    .reduce((total, modifier) => total + modifier.quantity, 0);
}

function catalogKey(observation) {
  return JSON.stringify(
    observation.options.map(({ index, id, cost, targetModel }) => ({ index, id, cost, targetModel })),
  );
}

/**
 * Seal the campaign-level market contract after every visited market has reached its
 * next public command surface. A two-parity run is only green when Wide Lens was paid
 * for through both stable seats, never merely because two purchases happened under one
 * owner or because a market screen appeared.
 */
export function assertMarketCoverage(
  coverage,
  { targetId = "WIDE_LENS", requiredPurchases = 0, requireBothOwnerSeats = false } = {},
) {
  const visits = Array.isArray(coverage?.visits) ? coverage.visits : [];
  const purchases = Array.isArray(coverage?.purchases) ? coverage.purchases : [];
  if (purchases.length < requiredPurchases) {
    throw new Error(`market coverage bought ${purchases.length} ${targetId} items; required ${requiredPurchases}`);
  }
  const ownerSeats = assertMarketPurchaseProofs(purchases, targetId);
  if (requireBothOwnerSeats && JSON.stringify(ownerSeats) !== "[0,1]") {
    throw new Error(
      `market coverage did not buy ${targetId} through both interaction-owner seat parities; observed ${JSON.stringify(ownerSeats)}`,
    );
  }
  visits.forEach(assertMarketVisitContinuation);
  return Object.freeze({ targetId, purchaseCount: purchases.length, ownerSeats, visitCount: visits.length });
}

function assertMarketPurchaseProofs(purchases, targetId) {
  for (const purchase of purchases) {
    if (purchase?.targetId !== targetId) {
      throw new Error(
        `market coverage claimed ${targetId} with an unexpected ${purchase?.targetId ?? "unknown"} proof`,
      );
    }
    if (![0, 1].includes(purchase.ownerSeat)) {
      throw new Error(`market coverage has invalid owner seat ${purchase.ownerSeat}`);
    }
  }
  return [...new Set(purchases.map(purchase => purchase.ownerSeat))].sort();
}

function assertMarketVisitContinuation(visit) {
  const interaction = visit?.pinnedInteraction ?? "unknown";
  if (visit?.leaveRequestedViaPublicConfirmation !== true) {
    throw new Error(`market visit at interaction ${interaction} did not use the public leave confirmation`);
  }
  if (visit?.continuation?.status !== "command") {
    throw new Error(`market visit at interaction ${interaction} did not prove a next public command`);
  }
  const sourceWave = visit.purchases?.[0]?.address?.wave;
  if (Number.isSafeInteger(sourceWave) && visit.continuation.wave <= sourceWave) {
    throw new Error(
      `market visit at wave ${sourceWave} did not advance to a later battle wave (${visit.continuation.wave})`,
    );
  }
}

/** Exact non-wrapping directions through the market's visible 4x4 grid. */
export function planMarketGridKeys(currentIndex, targetIndex, columns = MARKET_COLUMNS) {
  if (
    !Number.isSafeInteger(currentIndex)
    || !Number.isSafeInteger(targetIndex)
    || !Number.isSafeInteger(columns)
    || currentIndex < 0
    || targetIndex < 0
    || columns <= 0
  ) {
    throw new Error("market grid navigation requires non-negative integer indices and columns");
  }
  const keys = [];
  const currentRow = Math.floor(currentIndex / columns);
  const targetRow = Math.floor(targetIndex / columns);
  const currentColumn = currentIndex % columns;
  const targetColumn = targetIndex % columns;
  const vertical = targetRow >= currentRow ? "ArrowDown" : "ArrowUp";
  const horizontal = targetColumn >= currentColumn ? "ArrowRight" : "ArrowLeft";
  keys.push(...Array.from({ length: Math.abs(targetRow - currentRow) }, () => vertical));
  keys.push(...Array.from({ length: Math.abs(targetColumn - currentColumn) }, () => horizontal));
  return keys;
}

/**
 * Assert the complete paid, party-target purchase projection on both clients. The owner and watcher
 * use different local stock models, so each must decrement exactly once from its own pre-purchase
 * baseline; the authoritative money and held-item quantity must converge byte-for-byte.
 */
export function assertMarketPurchaseConverged(beforeByLabel, afterByLabel, { ownerLabel, targetId, partySlot }) {
  const labels = Object.keys(beforeByLabel);
  if (labels.length !== 2 || labels.some(label => afterByLabel[label] == null)) {
    throw new Error("market purchase proof requires before/after observations for exactly two clients");
  }
  const ownerBefore = beforeByLabel[ownerLabel];
  const ownerAfter = afterByLabel[ownerLabel];
  if (ownerBefore == null || ownerAfter == null || !ownerBefore.localOwner || !ownerBefore.marketOpen) {
    throw new Error(`market purchase proof has no actionable owner observation for ${ownerLabel}`);
  }
  const watcherLabel = labels.find(label => label !== ownerLabel);
  const watcherBefore = beforeByLabel[watcherLabel];
  const watcherAfter = afterByLabel[watcherLabel];
  if (watcherBefore.localOwner || watcherAfter.localOwner) {
    throw new Error("market watcher unexpectedly reports local ownership");
  }
  for (const label of labels) {
    const before = beforeByLabel[label];
    const after = afterByLabel[label];
    if (!sameAddress(before.address, ownerBefore.address) || !sameAddress(after.address, ownerBefore.address)) {
      throw new Error(`market purchase ${targetId} crossed an address on ${label}`);
    }
    if (
      before.pinnedInteraction !== ownerBefore.pinnedInteraction
      || after.pinnedInteraction !== ownerBefore.pinnedInteraction
    ) {
      throw new Error(`market purchase ${targetId} crossed an interaction pin on ${label}`);
    }
    if (catalogKey(before) !== catalogKey(ownerBefore) || catalogKey(after) !== catalogKey(ownerBefore)) {
      throw new Error(`market purchase ${targetId} catalog diverged on ${label}`);
    }
  }
  const ownerOptionBefore = optionById(ownerBefore, targetId);
  const ownerOptionAfter = optionById(ownerAfter, targetId);
  const watcherOptionBefore = optionById(watcherBefore, targetId);
  const watcherOptionAfter = optionById(watcherAfter, targetId);
  if (
    ownerOptionBefore == null
    || ownerOptionAfter == null
    || watcherOptionBefore == null
    || watcherOptionAfter == null
    || ownerOptionBefore.targetModel !== "party"
  ) {
    throw new Error(`market purchase proof requires party-target stock ${targetId} on both clients`);
  }
  if (ownerOptionBefore.stock - ownerOptionAfter.stock !== 1) {
    throw new Error(`market owner stock for ${targetId} did not decrement exactly once`);
  }
  if (watcherOptionBefore.stock - watcherOptionAfter.stock !== 1) {
    throw new Error(`market watcher apply-ledger stock for ${targetId} did not decrement exactly once`);
  }
  if (ownerBefore.money !== watcherBefore.money || ownerAfter.money !== watcherAfter.money) {
    throw new Error(`market money diverged for ${targetId}`);
  }
  if (ownerBefore.money - ownerAfter.money !== ownerOptionBefore.cost) {
    throw new Error(
      `market charged ${ownerBefore.money - ownerAfter.money} for ${targetId}; expected ${ownerOptionBefore.cost}`,
    );
  }
  const targetPokemonId = ownerBefore.party[partySlot]?.pokemonId;
  if (!Number.isSafeInteger(targetPokemonId)) {
    throw new Error(`market target party slot ${partySlot} is unavailable`);
  }
  const ownerQuantityBefore = quantityOf(ownerBefore, targetId, targetPokemonId);
  const ownerQuantityAfter = quantityOf(ownerAfter, targetId, targetPokemonId);
  for (const label of labels) {
    const before = beforeByLabel[label];
    const after = afterByLabel[label];
    if (
      before.party[partySlot]?.pokemonId !== targetPokemonId
      || after.party[partySlot]?.pokemonId !== targetPokemonId
    ) {
      throw new Error(`market target party identity diverged on ${label}`);
    }
    const beforeQuantity = quantityOf(before, targetId, targetPokemonId);
    const afterQuantity = quantityOf(after, targetId, targetPokemonId);
    if (beforeQuantity !== ownerQuantityBefore || afterQuantity !== ownerQuantityAfter) {
      throw new Error(`market held-item quantity for ${targetId} diverged on ${label}`);
    }
    if (afterQuantity - beforeQuantity !== 1) {
      throw new Error(`market held-item quantity for ${targetId} did not increment exactly once on ${label}`);
    }
  }
  if (!ownerAfter.marketOpen) {
    throw new Error(`market closed after buying ${targetId}; the paid party-target flow must return to the grid`);
  }
  return Object.freeze({
    address: ownerBefore.address,
    pinnedInteraction: ownerBefore.pinnedInteraction,
    ownerSeat: ownerBefore.ownerSeat,
    ownerLabel,
    watcherLabel,
    targetId,
    partySlot,
    pokemonId: targetPokemonId,
    cost: ownerOptionBefore.cost,
    moneyBefore: ownerBefore.money,
    moneyAfter: ownerAfter.money,
    ownerStockBefore: ownerOptionBefore.stock,
    ownerStockAfter: ownerOptionAfter.stock,
    watcherStockBefore: watcherOptionBefore.stock,
    watcherStockAfter: watcherOptionAfter.stock,
  });
}

async function waitForMarket(client, from, predicate, description) {
  return client.evidence.waitForCondition(sink => sink.findLastMarket(from, predicate), {
    timeoutMs: client.config.timeoutMs,
    description,
  });
}

async function readMarketPair(rig, from, pinnedInteraction = null) {
  const clients = Object.values(rig.clients);
  const events = await Promise.all(
    clients.map(client =>
      waitForMarket(
        client,
        from[client.label] ?? 0,
        observation => pinnedInteraction == null || observation.pinnedInteraction === pinnedInteraction,
        "addressed biome-market projection",
      ),
    ),
  );
  const byLabel = Object.fromEntries(events.map((event, index) => [clients[index].label, event.observation]));
  const owners = clients.filter(client => byLabel[client.label].localOwner && byLabel[client.label].marketOpen);
  if (owners.length !== 1) {
    throw new Error(`biome market must expose exactly one actionable owner; observed ${owners.length}`);
  }
  const owner = owners[0];
  const ownerObservation = byLabel[owner.label];
  for (const client of clients) {
    const observation = byLabel[client.label];
    if (
      !sameAddress(observation.address, ownerObservation.address)
      || observation.pinnedInteraction !== ownerObservation.pinnedInteraction
      || catalogKey(observation) !== catalogKey(ownerObservation)
    ) {
      throw new Error(`biome market catalog/address diverged before input on ${client.label}`);
    }
  }
  return { byLabel, owner, pinnedInteraction: ownerObservation.pinnedInteraction };
}

async function selectGridItem(owner, targetIndex, pinnedInteraction) {
  let event = owner.evidence.findLastMarket(
    0,
    observation => observation.pinnedInteraction === pinnedInteraction && observation.marketOpen,
  );
  if (event == null || !Number.isSafeInteger(event.observation.selectedIndex)) {
    throw new Error(`${owner.label}: market grid has no selected public item`);
  }
  const keys = planMarketGridKeys(event.observation.selectedIndex, targetIndex);
  for (const [step, key] of keys.entries()) {
    const from = owner.evidence.cursor();
    const previousIndex = event.observation.selectedIndex;
    await owner.press(key, `market-grid-target-step-${step + 1}/${keys.length}`);
    event = await waitForMarket(
      owner,
      from,
      observation =>
        observation.pinnedInteraction === pinnedInteraction
        && observation.marketOpen
        && observation.selectedIndex !== previousIndex,
      "market cursor movement",
    );
  }
  if (event.observation.selectedIndex !== targetIndex) {
    throw new Error(
      `${owner.label}: market cursor reached ${event.observation.selectedIndex}, expected ${targetIndex}`,
    );
  }
}

async function selectPartyTarget(owner, from, partySlot) {
  let event = await owner.evidence.waitForCondition(sink => sink.findLastSemanticSurface(from, "party:reward-target"), {
    timeoutMs: owner.config.timeoutMs,
    description: "market party-target picker",
  });
  const selected = /^cursor:(\d+)$/u.exec(event.observation.selectedOptionId ?? "");
  if (selected == null) {
    throw new Error(`${owner.label}: party-target picker exposed no selected party slot`);
  }
  let cursor = Number(selected[1]);
  while (cursor !== partySlot) {
    const key = cursor < partySlot ? "ArrowDown" : "ArrowUp";
    const eventIndex = event.index;
    await owner.press(key, `market-party-target-slot-${partySlot}`);
    event = await owner.evidence.waitForCondition(
      sink => {
        const next = sink.findLastSemanticSurface(from, "party:reward-target");
        return next?.index > eventIndex
          && next.observation.selectedOptionId === `cursor:${cursor + (key === "ArrowDown" ? 1 : -1)}`
          ? next
          : null;
      },
      { timeoutMs: owner.config.timeoutMs, description: `market party cursor ${partySlot}` },
    );
    cursor += key === "ArrowDown" ? 1 : -1;
  }
  await owner.press("Space", "market-open-party-apply-option");
  await delay(owner.config.settleDelayMs);
  await owner.checkpoint("market-party-apply-option");
  await owner.press("Space", "market-apply-item-to-party-target");
}

async function buyPartyItem(rig, snapshot, targetId, partySlot) {
  const clients = Object.values(rig.clients);
  const { owner, pinnedInteraction } = snapshot;
  const ownerBefore = snapshot.byLabel[owner.label];
  const option = optionById(ownerBefore, targetId);
  if (option == null || option.targetModel !== "party" || option.stock <= 0 || option.cost > ownerBefore.money) {
    return { status: "unavailable", targetId, reason: option == null ? "not-stocked" : "not-buyable" };
  }
  await selectGridItem(owner, option.index, pinnedInteraction);
  await owner.checkpoint(`market-${targetId}-selected`);
  const actionCursors = Object.fromEntries(clients.map(client => [client.label, client.evidence.cursor()]));
  const targetPokemonId = ownerBefore.party[partySlot]?.pokemonId;
  if (!Number.isSafeInteger(targetPokemonId)) {
    throw new Error(`${owner.label}: market party slot ${partySlot} is unavailable`);
  }
  const heldQuantityBefore = quantityOf(ownerBefore, targetId, targetPokemonId);
  const expectedMoney = ownerBefore.money - option.cost;
  await owner.press("Space", `market-buy-${targetId}`);
  await selectPartyTarget(owner, actionCursors[owner.label], partySlot);
  const afterEvents = await Promise.all(
    clients.map(client =>
      waitForMarket(
        client,
        actionCursors[client.label],
        observation => {
          if (observation.pinnedInteraction !== pinnedInteraction) {
            return false;
          }
          const afterOption = optionById(observation, targetId);
          const beforeOption = optionById(snapshot.byLabel[client.label], targetId);
          return (
            afterOption != null
            && beforeOption != null
            && beforeOption.stock - afterOption.stock === 1
            && observation.money === expectedMoney
            && quantityOf(observation, targetId, targetPokemonId) === heldQuantityBefore + 1
            && (client !== owner || observation.marketOpen)
          );
        },
        `applied ${targetId} market purchase`,
      ),
    ),
  );
  const afterByLabel = Object.fromEntries(afterEvents.map((event, index) => [clients[index].label, event.observation]));
  const proof = assertMarketPurchaseConverged(snapshot.byLabel, afterByLabel, {
    ownerLabel: owner.label,
    targetId,
    partySlot,
  });
  for (const client of clients) {
    client.evidence.record("market-purchase-proof", proof);
  }
  return { status: "purchased", proof, snapshot: { ...snapshot, byLabel: afterByLabel } };
}

async function leaveMarket(owner, pinnedInteraction) {
  const confirmCursor = owner.evidence.cursor();
  await owner.press("Backspace", "market-open-leave-confirmation");
  await waitForMarket(
    owner,
    confirmCursor,
    observation => observation.pinnedInteraction === pinnedInteraction && observation.uiMode === "CONFIRM",
    "market leave confirmation",
  );
  await owner.press("Space", "market-confirm-leave");
}

/**
 * Natural two-browser market visit. It buys the configured held item, returns to the same grid,
 * buys a second party item when affordable/in stock, then leaves normally. Missing target stock is
 * evidence, not a hidden fallback; the campaign's final required-count/parity contract decides pass/fail.
 */
export async function driveTargetedMarket(
  rig,
  from,
  { targetId = "WIDE_LENS", partySlot = 0, secondPurchase = true } = {},
) {
  let snapshot = await readMarketPair(rig, from);
  const purchases = [];
  const primary = await buyPartyItem(rig, snapshot, targetId, partySlot);
  if (primary.status === "purchased") {
    purchases.push(primary.proof);
    snapshot = primary.snapshot;
    if (secondPurchase) {
      const ownerObservation = snapshot.byLabel[snapshot.owner.label];
      // Repeat the already-proven compatible held item. A different random market item may be
      // incompatible with this party even though its public row looks affordable; guessing would
      // turn a harness selection error into a false product failure.
      const second = optionById(ownerObservation, targetId);
      if (second != null) {
        const repeated = await buyPartyItem(rig, snapshot, second.id, partySlot);
        if (repeated.status === "purchased") {
          purchases.push(repeated.proof);
          snapshot = repeated.snapshot;
        }
      }
    }
  }
  await snapshot.owner.checkpoint("market-before-normal-leave");
  await leaveMarket(snapshot.owner, snapshot.pinnedInteraction);
  return {
    ownerLabel: snapshot.owner.label,
    ownerSeat: snapshot.byLabel[snapshot.owner.label].ownerSeat,
    pinnedInteraction: snapshot.pinnedInteraction,
    targetId,
    targetStatus: primary.status,
    targetReason: primary.reason ?? null,
    purchases,
    leaveRequestedViaPublicConfirmation: true,
    continuation: null,
  };
}
