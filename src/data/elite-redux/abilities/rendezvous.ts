/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Rendezvous` (link-driven trio, item 3).
//
// DOUBLES/TRIPLES innate (inert in singles). On entry the holder LINKs to a
// nearest living ally (see `link.ts`). During a turn in which BOTH the holder
// and its linked ally target the SAME opponent:
//   - the SECOND of the two moves to resolve gains +20% power; and
//   - BOTH linked Pokemon restore 5% of their max HP (once per such turn).
//
// The pair is holder + linked ally; the holder's Rendezvous grants the effect to
// WHICHEVER of the two acts second (so the ally's move is boosted too even
// though it has no ability). "Same opponent this turn" and "who acted first" are
// resolved through the shared turn-attack ledger (`turn-attack-ledger.ts`): the
// power multiplier is read in `Move.calculateBattlePower`; the heal fires from
// `MoveEffectPhase.applyOnTargetEffects`.
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";
import { toDmgValue } from "#utils/common";
import { formLink, getLinkedAlly } from "./link";
import { allyHitTargetThisTurn } from "./turn-attack-ledger";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_RENDEZVOUS_ABILITY_ID = 5919;

/** Power multiplier granted to the second of the two coordinated moves. */
export const RENDEZVOUS_POWER_MULTIPLIER = 1.2;
/** Fraction of max HP both linked Pokemon restore. */
export const RENDEZVOUS_HEAL_FRACTION = 0.05;

/** PostSummon marker: forms the link on entry. */
export class RendezvousAbAttr extends PostSummonAbAttr {
  constructor() {
    super(false);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (!simulated) {
      formLink(pokemon);
    }
  }
}

/** Whether `pokemon` carries an unsuppressed Rendezvous. */
function hasRendezvous(pokemon: Pokemon): boolean {
  return pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "RendezvousAbAttr");
}

/**
 * The linked partner of `user` IF the two form an active Rendezvous pair (either
 * end carries Rendezvous), else `undefined`.
 */
function rendezvousPartner(user: Pokemon): Pokemon | undefined {
  const partner = getLinkedAlly(user);
  if (!partner) {
    return;
  }
  return hasRendezvous(user) || hasRendezvous(partner) ? partner : undefined;
}

/**
 * Power multiplier for `user`'s move against `target`: 1.2 when `user` is the
 * SECOND of a Rendezvous-linked pair to act on `target` this turn (its partner
 * already hit `target`), else 1. Read from `Move.calculateBattlePower`.
 */
export function erRendezvousPowerMultiplier(user: Pokemon, target: Pokemon): number {
  const partner = rendezvousPartner(user);
  if (partner && allyHitTargetThisTurn(partner, target)) {
    return RENDEZVOUS_POWER_MULTIPLIER;
  }
  return 1;
}

/** Per-turn guard so the paired heal fires once (wave:turn key). */
let healedKey = "";

/**
 * Heal both linked Pokemon 5% max HP when `user` completes the SECOND move of a
 * Rendezvous pair aimed at `target`. Fired from `applyOnTargetEffects` after the
 * first actor's hit is already in the ledger. Idempotent within a turn.
 */
export function erRendezvousOnHit(user: Pokemon, target: Pokemon): void {
  const partner = rendezvousPartner(user);
  if (!partner || !allyHitTargetThisTurn(partner, target)) {
    return;
  }
  // Once per pair per turn (NOT per target) — so a spread move coordinated on
  // several foes still heals the pair a single 5%.
  const battle = globalScene.currentBattle;
  const pairId = Math.min(user.id, partner.id);
  const key = `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}:${pairId}`;
  if (healedKey === key) {
    return;
  }
  healedKey = key;
  for (const mon of [user, partner]) {
    if (!mon.isFainted() && !mon.isFullHp()) {
      mon.heal(toDmgValue(mon.getMaxHp() * RENDEZVOUS_HEAL_FRACTION, 1));
    }
  }
}
