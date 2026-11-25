/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// EVALUATE (game) side of the guard registry. A guard predicate returns TRUE when the guard
// PASSES (the ability may go on). The bodies are moved verbatim out of
// PostDamageForceSwitchAbAttr.canApply (ab-attrs.ts), in the original order and with the original
// nesting: guards 2 to 4 only apply when the source has a last move on record.

import { allMoves } from "#data/data-lists";
import { abilityQuery, ENGINE_QUERY } from "#data/elite-redux/ability-studio/runtime-capabilities";
import { AbilityId } from "#enums/ability-id";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { SpeciesId } from "#enums/species-id";
import type { Frame } from "./frame";

export type GuardPredicate = (frame: Frame) => boolean;

const FORBIDDEN_ATTACKING_MOVES: readonly MoveId[] = [
  MoveId.BELLY_DRUM,
  MoveId.SUBSTITUTE,
  MoveId.CURSE,
  MoveId.PAIN_SPLIT,
];
const FORBIDDEN_DEFENDING_MOVES: readonly MoveId[] = [MoveId.DRAGON_TAIL, MoveId.CIRCLE_THROW];

export const GUARD_EVALUATORS: Readonly<Record<string, GuardPredicate>> = {
  // A fainted holder never changes form (HpThresholdFormChangeAbAttr).
  "not-fainted": frame => !frame.holder.isFainted(),
  // Will not activate when the Pokemon's HP is lowered by cutting its own HP.
  "not-own-hp-cost-move": frame => {
    const lastMoveUsed = frame.holder.getLastXMoves()[0];
    return !FORBIDDEN_ATTACKING_MOVES.includes(lastMoveUsed?.move);
  },
  // Dragon Tail and Circle Throw switch out the Pokemon before the ability activates, and so does
  // Sky Drop while the Pokemon is in the air.
  "not-already-forced-out": frame => {
    const enemyLastMoveUsed = frame.other?.getLastXMoves()[0];
    if (frame.other === undefined || !enemyLastMoveUsed) {
      return true;
    }
    return !(
      FORBIDDEN_DEFENDING_MOVES.includes(enemyLastMoveUsed.move)
      || (enemyLastMoveUsed.move === MoveId.SKY_DROP && enemyLastMoveUsed.result === MoveResult.OTHER)
    );
  },
  // Will not activate for a move affected by Sheer Force.
  "sheer-force-negates": frame => {
    const source = frame.other;
    const enemyLastMoveUsed = source?.getLastXMoves()[0];
    if (source === undefined || !enemyLastMoveUsed) {
      return true;
    }
    return !(
      allMoves[enemyLastMoveUsed.move].chance >= 0 && abilityQuery(source, ENGINE_QUERY.SHEER_FORCE_SECONDARY_EFFECTS)
    );
  },
  // Forecast works for Castform and Flower Gift for Cherrim only (PostWeatherChangeFormChangeAbAttr.guards).
  "weather-form-species-only": frame =>
    (frame.holder.species.speciesId === SpeciesId.CASTFORM && frame.holder.hasAbility(AbilityId.FORECAST))
    || (frame.holder.species.speciesId === SpeciesId.CHERRIM && frame.holder.hasAbility(AbilityId.FLOWER_GIFT)),
  // Activate only after the last hit of multistrike moves.
  "after-final-hit": frame => {
    const source = frame.other;
    if (source === undefined || !source.getLastXMoves()[0]) {
      return true;
    }
    return !(source.turnData.hitsLeft > 1);
  },
  // ---- Librarian pass (B19) ---------------------------------------------------------------
  // Does not trigger when the target's ability ignores the extra effects of attacks.
  "not-blocked-by-effect-shield": frame => !frame.other?.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr"),
  "not-self-target": frame => frame.holder !== frame.other,
  // `Boolean(sourcePokemon)`: weather and hazards have no source Pokemon.
  "status-set-by-a-pokemon": frame => Boolean(frame.other),
  // Not a miss, not blocked, not immune: EFFECTIVE, SUPER_EFFECTIVE, NOT_VERY_EFFECTIVE or ONE_HIT_KO.
  "hit-connected": frame => frame.hitResult !== undefined && frame.hitResult < HitResult.NO_EFFECT,
  "hit-connected-on-another-pokemon": frame =>
    frame.holder !== frame.other && frame.hitResult !== undefined && frame.hitResult < HitResult.NO_EFFECT,
  "hit-dealt-damage": frame => frame.damage !== undefined && frame.damage > 0,
  "hit-on-another-living-target": frame =>
    frame.holder !== frame.other
    && frame.other !== undefined
    && !frame.other.isFainted()
    && frame.damage !== undefined
    && frame.damage > 0,
  // The holder is the attacker of an after-my-attack trigger: its own multi-hit counter.
  "after-my-final-hit": frame => !(frame.holder.turnData.hitsLeft > 1),
  "knocked-out-by-a-move": frame => !!frame.other && !!frame.move,
  "attacker-still-standing": frame => frame.other !== undefined && !frame.other.isFainted(),
  // The faint is credited to the holder only when its attack was the last direct hit the victim took.
  "credited-with-the-knock-out": frame => {
    const lastAttack = frame.other?.turnData?.attacksReceived?.[0];
    return !!lastAttack && lastAttack.sourceId === frame.holder.id;
  },
  "not-protected-from-indirect-damage": frame => !frame.holder.hasAbilityWithAttr("BlockNonDirectDamageAbAttr"),
};

export function evaluateGuard(name: string, frame: Frame): boolean {
  const guard = GUARD_EVALUATORS[name];
  if (guard === undefined) {
    throw new Error(`there is no safety rule called "${name}"`);
  }
  return guard(frame);
}

/** Runs guards in the order given; stops at the first one that blocks (original short-circuiting). */
export function guardsPass(names: readonly string[], frame: Frame): boolean {
  for (const name of names) {
    if (!evaluateGuard(name, frame)) {
      return false;
    }
  }
  return true;
}
