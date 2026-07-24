/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { CoopBattleEvent } from "#data/elite-redux/coop/coop-transport";

/** Hard bound for the summon/on-entry cosmetic prefix retained beside one command-open state. */
const MAX_ENTRY_PRESENTATION_EVENTS = 256;
/** Defensive ceiling for ER innate plus shared GIFT ability-source indexes. */
const MAX_ABILITY_SOURCE_SLOT = 31;

function isSafeAddressPart(value: unknown, allowZero = true): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isValidBattlerIndex(value: unknown): value is number {
  // Protocol 48 supports the current single/double/triple topology and leaves room for six seats per side.
  return isSafeAddressPart(value) && value <= 11;
}

function isActorAddressableBattlerIndex(value: unknown): value is number {
  return value === -1 || isValidBattlerIndex(value);
}

function isValidPartySlot(value: unknown): value is number {
  return isSafeAddressPart(value) && value <= 5;
}

function isPositiveSafeAddressPart(value: unknown): value is number {
  return isSafeAddressPart(value) && value > 0;
}

function isPresentationActorRef(value: unknown): value is { side: "player" | "enemy"; pokemonId: number } {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const actor = value as Record<string, unknown>;
  return (actor.side === "player" || actor.side === "enemy") && isPositiveSafeAddressPart(actor.pokemonId);
}

/** Strict closed-union validator for every authoritative battle-presentation event. */
export function isStrictCoopBattleEvent(value: unknown): value is CoopBattleEvent {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const event = value as Record<string, unknown>;
  switch (event.k) {
    case "message":
      return typeof event.text === "string";
    case "moveUsed":
      return (
        isValidBattlerIndex(event.bi)
        && isSafeAddressPart(event.moveId, false)
        && Array.isArray(event.targets)
        && event.targets.every(isValidBattlerIndex)
        && isPresentationActorRef(event.actor)
        && Array.isArray(event.targetActors)
        && event.targetActors.length === event.targets.length
        && event.targetActors.every(isPresentationActorRef)
      );
    case "hp":
      return (
        isActorAddressableBattlerIndex(event.bi)
        && isFiniteNumber(event.hp)
        && event.hp >= 0
        && isFiniteNumber(event.maxHp)
        && event.maxHp > 0
        && (event.sp === undefined || isFiniteNumber(event.sp))
        && (event.result === undefined || [1, 2, 3, 4, 10, 12, 13].includes(event.result as number))
        && (event.critical === undefined || typeof event.critical === "boolean")
        && (event.result === undefined) === (event.critical === undefined)
        && isPresentationActorRef(event.actor)
      );
    case "faint":
      return (
        isActorAddressableBattlerIndex(event.bi)
        && (event.narrate === undefined || typeof event.narrate === "boolean")
        && (event.sp === undefined || isFiniteNumber(event.sp))
        && isPresentationActorRef(event.actor)
      );
    case "statStage":
      return (
        isActorAddressableBattlerIndex(event.bi)
        && isSafeAddressPart(event.stat)
        && isFiniteNumber(event.value)
        && isPresentationActorRef(event.actor)
      );
    case "status":
      return (
        isActorAddressableBattlerIndex(event.bi)
        && isSafeAddressPart(event.status)
        && isPresentationActorRef(event.actor)
      );
    case "showAbility":
      return (
        isActorAddressableBattlerIndex(event.bi)
        && isPositiveSafeAddressPart(event.pokemonId)
        && isValidPartySlot(event.partySlot)
        && isPositiveSafeAddressPart(event.abilityId)
        && typeof event.passive === "boolean"
        && isSafeAddressPart(event.passiveSlot)
        && event.passiveSlot <= MAX_ABILITY_SOURCE_SLOT
        && isPresentationActorRef(event.actor)
        && event.actor.pokemonId === event.pokemonId
      );
    case "tera":
      return (
        isActorAddressableBattlerIndex(event.bi)
        && isPositiveSafeAddressPart(event.pokemonId)
        && isValidPartySlot(event.partySlot)
        && isSafeAddressPart(event.teraType)
        && isPresentationActorRef(event.actor)
        && event.actor.pokemonId === event.pokemonId
      );
    case "weather":
      return (
        isSafeAddressPart(event.weather)
        && isSafeAddressPart(event.turnsLeft)
        && (event.anim === undefined || isSafeAddressPart(event.anim))
      );
    case "terrain":
      return (
        isSafeAddressPart(event.terrain)
        && isSafeAddressPart(event.turnsLeft)
        && (event.anim === undefined || isSafeAddressPart(event.anim))
      );
    case "switch":
      return (
        isValidBattlerIndex(event.bi)
        && isValidPartySlot(event.partySlot)
        && isPositiveSafeAddressPart(event.pokemonId)
        && isPositiveSafeAddressPart(event.speciesId)
        && isSafeAddressPart(event.switchType)
        && typeof event.doReturn === "boolean"
        && isPresentationActorRef(event.actor)
        && event.actor.pokemonId === event.pokemonId
      );
    default:
      return false;
  }
}

/** Strict, bounded validator shared by compatibility transport and Authority V2 command-open material. */
export function isStrictCoopEntryPresentation(value: unknown): value is CoopBattleEvent[] {
  return Array.isArray(value) && value.length <= MAX_ENTRY_PRESENTATION_EVENTS && value.every(isStrictCoopBattleEvent);
}
