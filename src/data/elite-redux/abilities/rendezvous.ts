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
import type { GatedAttr } from "#data/elite-redux/ability-studio/gate-residual";
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

/** What the two seams hand to the gate and the residual: the acting Pokemon, its linked partner and the Pokemon being hit. */
export interface RendezvousHitParams {
  user: Pokemon;
  partner: Pokemon;
  target: Pokemon;
}

/** Per-turn guard so the paired heal fires once (wave:turn:pair key). */
let healedKey = "";

/** The wave:turn:pair key of the once-per-pair-per-turn heal. */
function healKeyOf(user: Pokemon, partner: Pokemon): string {
  const battle = globalScene.currentBattle;
  const pairId = Math.min(user.id, partner.id);
  return `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}:${pairId}`;
}

/**
 * PostSummon marker: forms the link on entry. The two seams below read `gate` ("my linked partner already hit this
 * target this turn", replaceable) and, for the heal only, `residual` ("this pair has not healed yet this turn").
 */
export class RendezvousAbAttr extends PostSummonAbAttr implements GatedAttr<RendezvousHitParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: RendezvousHitParams) => boolean) | undefined;

  /**
   * @param powerMultiplier - Power factor of the second of the two coordinated moves (default 1.2)
   * @param healFraction - Fraction of max HP both linked Pokemon restore (default 0.05)
   */
  constructor(
    public readonly powerMultiplier: number = RENDEZVOUS_POWER_MULTIPLIER,
    public readonly healFraction: number = RENDEZVOUS_HEAL_FRACTION,
  ) {
    super(false);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (!simulated) {
      formLink(pokemon);
    }
  }

  /** The replaceable condition: the linked partner already hit this target earlier this turn. */
  public gate({ partner, target }: RendezvousHitParams): boolean {
    return allyHitTargetThisTurn(partner, target);
  }

  /** Feasibility that stays in the class (heal seam only): this pair has not healed yet this turn (once per pair, not per target). */
  public residual({ user, partner }: RendezvousHitParams): boolean {
    return healedKey !== healKeyOf(user, partner);
  }

  /** The gate as the seams run it: the compiler's replacement when present, else {@linkcode gate}. */
  public gateHolds(params: RendezvousHitParams): boolean {
    return (this.gateOverride ?? this.gate.bind(this))(params);
  }
}

/** The unsuppressed Rendezvous attr `pokemon` carries, if any (found by name, like the engine seams do). */
function rendezvousAttrOf(pokemon: Pokemon): RendezvousAbAttr | undefined {
  return pokemon.getAllActiveAbilityAttrs().find(a => a?.constructor?.name === "RendezvousAbAttr") as
    | RendezvousAbAttr
    | undefined;
}

/**
 * The linked partner of `user` and the Rendezvous attr that powers the pair, IF the two form an active
 * Rendezvous pair (either end carries Rendezvous), else `undefined`.
 */
function rendezvousPair(user: Pokemon): { partner: Pokemon; attr: RendezvousAbAttr } | undefined {
  const partner = getLinkedAlly(user);
  if (!partner) {
    return;
  }
  const attr = rendezvousAttrOf(user) ?? rendezvousAttrOf(partner);
  return attr === undefined ? undefined : { partner, attr };
}

/**
 * Power multiplier for `user`'s move against `target`: 1.2 when `user` is the
 * SECOND of a Rendezvous-linked pair to act on `target` this turn (its partner
 * already hit `target`), else 1. Read from `Move.calculateBattlePower`.
 */
export function erRendezvousPowerMultiplier(user: Pokemon, target: Pokemon): number {
  const pair = rendezvousPair(user);
  if (pair?.attr.gateHolds({ user, partner: pair.partner, target })) {
    return pair.attr.powerMultiplier ?? RENDEZVOUS_POWER_MULTIPLIER;
  }
  return 1;
}

/**
 * Heal both linked Pokemon 5% max HP when `user` completes the SECOND move of a
 * Rendezvous pair aimed at `target`. Fired from `applyOnTargetEffects` after the
 * first actor's hit is already in the ledger. Idempotent within a turn.
 */
export function erRendezvousOnHit(user: Pokemon, target: Pokemon): void {
  const pair = rendezvousPair(user);
  if (!pair) {
    return;
  }
  const { partner, attr } = pair;
  const params: RendezvousHitParams = { user, partner, target };
  if (!attr.gateHolds(params)) {
    return;
  }
  // Once per pair per turn (NOT per target) — so a spread move coordinated on
  // several foes still heals the pair a single 5%.
  if (!attr.residual(params)) {
    return;
  }
  healedKey = healKeyOf(user, partner);
  for (const mon of [user, partner]) {
    if (!mon.isFainted() && !mon.isFullHp()) {
      mon.heal(toDmgValue(mon.getMaxHp() * (attr.healFraction ?? RENDEZVOUS_HEAL_FRACTION), 1));
    }
  }
}
