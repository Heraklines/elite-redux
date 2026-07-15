/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Plus/Minus paralysis suite (Batch 3, items 5-8).
//
// GENERAL abilities (work on ANY holder). Alignment is ABILITY-based, never
// species-based (see `isPlusMinusAligned`): a Pokemon counts as Plus/Minus-
// aligned when its active ability set includes vanilla Plus or Minus, OR any of
// the four abilities in this suite (documented DEFAULT).
//
//   5. Synchronized Current  — if the holder AND an aligned ally both deal DIRECT
//      damage to the same target in one turn, that target is paralyzed after both
//      hits resolve (normal paralysis immunities apply: Electric types, Limber…).
//   6. Positive Feedback     — when the holder damages a PARALYZED target, it
//      consumes the paralysis, the attack gets +25% power, and the target's
//      HIGHER defensive stat drops one stage after damage.
//   7. Negative Feedback     — when the holder damages a PARALYZED target, it
//      consumes the paralysis, the holder gains +1 Speed, ONE of the target's held
//      items is suppressed until end of the following turn (seeded pick), and the
//      HOLDER's own next physical move is primed to become Electric/Fairy dual-
//      type (self-buff — the maintainer-final reading of the ambiguous "its").
//   8. Closed Circuit        — if the holder and an ally target the same opponent
//      in one turn, whichever acts SECOND launches an extra 25 BP Electric/Fairy
//      special attack at that opponent after both primary moves resolve (uses the
//      dual-type primitive; DEFAULT special, no secondary effects, cannot crit).
//
// Same-turn coordination (Sync Current, Closed Circuit) is resolved through the
// shared turn-attack ledger; the second-actor triggers fire from the batch3
// on-hit dispatcher (`batch3-on-hit.ts`). Singles: no ally, so every coordinated
// innate is inert by design.
// =============================================================================

import { AbAttr, PostAttackAbAttr, VariableMovePowerAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import { DualTypeMoveAttr } from "#data/moves/move";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type {
  AbAttrBaseParams,
  PostMoveInteractionAbAttrParams,
  PreAttackModifyPowerAbAttrParams,
} from "#types/ability-types";
import { primeDualTypeMove } from "./dual-type-move";
import { suppressRandomHeldItem } from "./item-suppression";
import { allyHitTargetThisTurn } from "./turn-attack-ledger";

export const ER_SYNCHRONIZED_CURRENT_ABILITY_ID = 5921;
export const ER_POSITIVE_FEEDBACK_ABILITY_ID = 5922;
export const ER_NEGATIVE_FEEDBACK_ABILITY_ID = 5923;
export const ER_CLOSED_CIRCUIT_ABILITY_ID = 5924;

/** Power boosts / follow-up BP. */
export const POSITIVE_FEEDBACK_POWER_MULTIPLIER = 1.25;
export const CLOSED_CIRCUIT_FOLLOWUP_POWER = 25;

/** The suite's abilities, by constructor name, for ability-based alignment detection. */
const SUITE_ABATTR_NAMES = new Set([
  "SynchronizedCurrentAbAttr",
  "PositiveFeedbackAbAttr",
  "NegativeFeedbackAbAttr",
  "ClosedCircuitAbAttr",
]);

/**
 * ABILITY-based Plus/Minus alignment: vanilla Plus/Minus OR any suite ability.
 * Never keys off species id (documented DEFAULT).
 */
export function isPlusMinusAligned(pokemon: Pokemon): boolean {
  if (!pokemon.isActive(true)) {
    return false;
  }
  if (pokemon.hasAbility(AbilityId.PLUS) || pokemon.hasAbility(AbilityId.MINUS)) {
    return true;
  }
  return pokemon.getAllActiveAbilityAttrs().some(a => a && SUITE_ABATTR_NAMES.has(a.constructor?.name ?? ""));
}

/** Whether `pokemon` carries an unsuppressed ability whose attr constructor name is `name`. */
function carriesAttr(pokemon: Pokemon, name: string): boolean {
  return pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === name);
}

// --- 5. Synchronized Current -------------------------------------------------

/** Marker for Synchronized Current; the paralysis is applied by `erSyncCurrentOnHit`. */
export class SynchronizedCurrentAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}

/**
 * When `user` deals DIRECT damage to `target`, paralyze `target` if a
 * "Synchronized Current holder + aligned ally" pair on `user`'s side has both
 * damaged `target` this turn (this hit is the second). Respects paralysis
 * immunities via `trySetStatus`.
 */
export function erSyncCurrentOnHit(user: Pokemon, target: Pokemon, damaging: boolean): void {
  if (!damaging || target.isFainted()) {
    return;
  }
  const partner = syncCurrentPartner(user, target);
  if (!partner) {
    return;
  }
  // After both hits resolve → apply paralysis (immunities honored inside trySetStatus).
  target.trySetStatus(StatusEffect.PARALYSIS, user);
}

/**
 * An active ally that, together with `user`, forms a Sync-Current pair (one end
 * carries Synchronized Current, both are aligned) and has ALREADY damaged
 * `target` this turn. Returns that ally, or `undefined`.
 */
function syncCurrentPartner(user: Pokemon, target: Pokemon): Pokemon | undefined {
  const userHasSync = carriesAttr(user, "SynchronizedCurrentAbAttr");
  const userAligned = isPlusMinusAligned(user);
  for (const ally of user.getAllies()) {
    if (!ally?.isActive(true) || !allyHitTargetThisTurn(ally, target, true)) {
      continue;
    }
    const allyHasSync = carriesAttr(ally, "SynchronizedCurrentAbAttr");
    // Pair valid when one end has Sync Current and BOTH ends are aligned.
    if (((userHasSync && isPlusMinusAligned(ally)) || (allyHasSync && userAligned)) && isPlusMinusAligned(ally)) {
      return ally;
    }
  }
  return;
}

// --- 6. Positive Feedback ----------------------------------------------------

/** +25% power when the holder's move targets a PARALYZED foe. */
export class PositiveFeedbackPowerAbAttr extends VariableMovePowerAbAttr {
  override canApply({ opponent }: PreAttackModifyPowerAbAttrParams): boolean {
    return opponent?.status?.effect === StatusEffect.PARALYSIS;
  }

  override apply({ power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= POSITIVE_FEEDBACK_POWER_MULTIPLIER;
  }
}

/** Consume the target's paralysis and drop its higher defensive stat after damage. */
export class PositiveFeedbackAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { opponent, hitResult } = params;
    return super.canApply(params) && hitResult < 4 && opponent?.status?.effect === StatusEffect.PARALYSIS;
  }

  override apply({ opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated || !opponent) {
      return;
    }
    // Consume the paralysis (cleared immediately, not via a phase).
    opponent.resetStatus(true, false, false, false);
    // Lower the HIGHER defensive stat by one stage.
    const higherDef = opponent.getStat(Stat.DEF) >= opponent.getStat(Stat.SPDEF) ? Stat.DEF : Stat.SPDEF;
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", opponent.getBattlerIndex(), false, [higherDef], -1);
  }
}

// --- 7. Negative Feedback ----------------------------------------------------

/**
 * Consume the target's paralysis; the holder gains +1 Speed, suppresses one of
 * the target's held items until end of the following turn, and primes its OWN
 * next physical move to Electric/Fairy dual-type (self-buff).
 */
export class NegativeFeedbackAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { opponent, hitResult } = params;
    return super.canApply(params) && hitResult < 4 && opponent?.status?.effect === StatusEffect.PARALYSIS;
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    if (simulated || !opponent) {
      return;
    }
    opponent.resetStatus(true, false, false, false);
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), true, [Stat.SPD], 1);
    // Suppress one seeded-random held item until end of the following turn.
    suppressRandomHeldItem(opponent);
    // Prime the HOLDER's own next physical move → Electric (primary) / Fairy (second).
    primeDualTypeMove(pokemon, PokemonType.ELECTRIC, PokemonType.FAIRY);
  }
}

// --- 8. Closed Circuit -------------------------------------------------------

/** Marker for Closed Circuit; the extra attack is launched by `erClosedCircuitOnHit`. */
export class ClosedCircuitAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}

/** Per-turn guard so the follow-up fires once per pair per target per turn. */
let closedCircuitKey = "";

/**
 * When `user` completes the SECOND move of a Closed-Circuit pair aimed at
 * `target` (its partner already targeted `target` this turn), launch an extra
 * 25 BP Electric/Fairy special attack from `user` at `target`. Fired from the
 * batch3 on-hit dispatcher.
 */
export function erClosedCircuitOnHit(user: Pokemon, target: Pokemon): void {
  const partner = closedCircuitPartner(user, target);
  if (!partner || target.isFainted()) {
    return;
  }
  const battle = globalScene.currentBattle;
  const key = `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}:${Math.min(user.id, partner.id)}:${target.id}`;
  if (closedCircuitKey === key) {
    return;
  }
  closedCircuitKey = key;
  globalScene.phaseManager.unshiftNew(
    "MovePhase",
    user,
    [target.getBattlerIndex()],
    closedCircuitFollowupMove(),
    MoveUseMode.INDIRECT,
  );
}

/**
 * An active ally forming a Closed-Circuit pair with `user` (one end carries
 * Closed Circuit) that has ALREADY targeted `target` this turn. `undefined` if
 * none — meaning `user` is not the second actor of such a pair.
 */
function closedCircuitPartner(user: Pokemon, target: Pokemon): Pokemon | undefined {
  const userHasCc = carriesAttr(user, "ClosedCircuitAbAttr");
  for (const ally of user.getAllies()) {
    if (!ally?.isActive(true) || !allyHitTargetThisTurn(ally, target)) {
      continue;
    }
    if (userHasCc || carriesAttr(ally, "ClosedCircuitAbAttr")) {
      return ally;
    }
  }
  return;
}

/** Build the 25 BP Electric/Fairy special follow-up (Shock Wave clone + Fairy second type). */
function closedCircuitFollowupMove() {
  const move = scriptedPokemonMove(MoveId.SHOCK_WAVE, CLOSED_CIRCUIT_FOLLOWUP_POWER);
  // Attach the Fairy second type onto the scripted clone (own attrs array, never
  // mutating the registered Shock Wave). Idempotent: skip if already attached.
  const built = move.getMove();
  if (!built.attrs.some(a => a instanceof DualTypeMoveAttr)) {
    (built as unknown as { attrs: unknown[] }).attrs = [...built.attrs, new DualTypeMoveAttr(PokemonType.FAIRY)];
  }
  return move;
}
