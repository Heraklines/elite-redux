/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER - temporary "challenge tokens" for the press-your-luck / notoriety GUARDIAN
// fights (Glittering Vein, Overgrown Temple, Abyssal Vent, the boss trials, ...).
//
// These are the same endless-mode enemy buff tokens, but applied for a SINGLE
// guardian battle and scaled by DEPTH, on TOP of the existing level / boss-bar /
// BST climb. The loadout is deliberately not-obscene:
//   - Damage Token   (+5% dealt / stack, here capped at +25%)        - core ramp
//   - Defense Token  (-2.5% taken / stack, capped at -10%)           - core ramp
//   - Endure Token   (+2% survive-a-lethal-hit / stack, capped 4%)   - spice, deep
//   - status Token   (on-hit Burn/Poison/Paralysis, 1 stack)         - biome flavor
//   - Recovery Token (+2% max HP / turn, capped 4%)                  - attrition only
// (Fusion + Full-Heal tokens are intentionally NOT used - too swingy / anti-fun.)
//
// CRITICAL: these must NEVER persist into normal play. Three guarantees, all gated
// by erBiomeRoutingActive() (classic only, so endless's own tokens are untouched):
//   1. applyErGuardianTokens() CLEARS any leftovers before adding fresh,
//   2. battle-scene doPostBattleCleanup() calls clearErFightTokens() after EVERY
//      battle (so a guardian's tokens are gone the moment its fight ends), and
//   3. newArena() calls clearErFightTokens() on every biome entry (belt + braces).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import { erBiomeRoutingActive } from "#data/elite-redux/er-biome-routing";
import { StatusEffect } from "#enums/status-effect";
import {
  EnemyAttackStatusEffectChanceModifier,
  EnemyDamageBoosterModifier,
  EnemyDamageReducerModifier,
  EnemyEndureChanceModifier,
  EnemyTurnHealModifier,
  type Modifier,
  type PersistentModifier,
} from "#modifiers/modifier";

/** Per-token stack ceilings (kept low so the ramp is firm, not obscene). */
const MAX_DAMAGE = 5; // +25% damage dealt
const MAX_DEFENSE = 4; // -10% damage taken
const MAX_ENDURE = 2; // 4% chance to survive a lethal hit
const MAX_RECOVERY = 2; // +4% max HP regen per turn (attrition fights only)

export interface ErGuardianTokenOpts {
  /** A biome-themed on-hit status token (Burn / Poison / Paralysis), if any. */
  statusType?: StatusEffect;
  /** Add a Recovery (regen) token - reserved for attrition / notoriety fights. */
  attrition?: boolean;
}

/** The enemy-buff modifier classes that an ER guardian fight may add. */
function isErFightToken(m: Modifier): boolean {
  return (
    m instanceof EnemyDamageBoosterModifier
    || m instanceof EnemyDamageReducerModifier
    || m instanceof EnemyEndureChanceModifier
    || m instanceof EnemyAttackStatusEffectChanceModifier
    || m instanceof EnemyTurnHealModifier
  );
}

/**
 * Remove every ER guardian token from the enemy field. Gated to the World Map
 * (classic) so it can NEVER strip endless mode's own enemy buff tokens - those
 * only exist outside the gate.
 */
export function clearErFightTokens(): void {
  if (!erBiomeRoutingActive()) {
    return;
  }
  const toRemove = globalScene.findModifiers(isErFightToken, false);
  if (toRemove.length === 0) {
    return;
  }
  for (const m of toRemove) {
    globalScene.removeModifier(m, true);
  }
  globalScene.updateModifiers(false, true);
}

/** Build the status-token modifier for a given on-hit status, or null. */
function statusToken(status: StatusEffect): PersistentModifier | null {
  switch (status) {
    case StatusEffect.BURN:
      return new EnemyAttackStatusEffectChanceModifier(
        modifierTypes.ENEMY_ATTACK_BURN_CHANCE().withIdFromFunc(modifierTypes.ENEMY_ATTACK_BURN_CHANCE),
        StatusEffect.BURN,
        5,
        1,
      );
    case StatusEffect.POISON:
      return new EnemyAttackStatusEffectChanceModifier(
        modifierTypes.ENEMY_ATTACK_POISON_CHANCE().withIdFromFunc(modifierTypes.ENEMY_ATTACK_POISON_CHANCE),
        StatusEffect.POISON,
        5,
        1,
      );
    case StatusEffect.PARALYSIS:
      return new EnemyAttackStatusEffectChanceModifier(
        modifierTypes.ENEMY_ATTACK_PARALYZE_CHANCE().withIdFromFunc(modifierTypes.ENEMY_ATTACK_PARALYZE_CHANCE),
        StatusEffect.PARALYSIS,
        5,
        1,
      );
    default:
      return null;
  }
}

/** Add `stacks` copies of a token to the enemy field (each instance is 1 stack;
 * addEnemyModifier merges them by incrementing the running stack count). */
function addStacks(make: () => PersistentModifier, stacks: number): void {
  for (let i = 0; i < stacks; i++) {
    void globalScene.addEnemyModifier(make(), true, true);
  }
}

/**
 * Apply depth-scaled challenge tokens to the current enemy field for ONE guardian
 * fight. Clears any leftovers first. `depth` is 0 for the first/shallow guardian
 * and climbs per stir (press-your-luck) or is a fixed rung for one-shot bosses.
 *
 * No-op outside the World Map gate. Call this right AFTER initBattleWithEnemyConfig
 * (so the enemy exists for the modifier UI); the post-battle cleanup removes them.
 */
export function applyErGuardianTokens(depth: number, opts: ErGuardianTokenOpts = {}): void {
  if (!erBiomeRoutingActive()) {
    return;
  }
  clearErFightTokens();

  const d = Math.max(0, Math.floor(depth));
  const damage = Math.min(MAX_DAMAGE, d + 1);
  const defense = Math.min(MAX_DEFENSE, Math.ceil((d + 1) / 2));
  const endure = d >= 2 ? Math.min(MAX_ENDURE, d - 1) : 0;
  const recovery = opts.attrition ? Math.min(MAX_RECOVERY, Math.ceil((d + 1) / 2)) : 0;
  const wantStatus = opts.statusType != null && d >= 3;

  addStacks(
    () =>
      new EnemyDamageBoosterModifier(
        modifierTypes.ENEMY_DAMAGE_BOOSTER().withIdFromFunc(modifierTypes.ENEMY_DAMAGE_BOOSTER),
        5,
        1,
      ),
    damage,
  );
  addStacks(
    () =>
      new EnemyDamageReducerModifier(
        modifierTypes.ENEMY_DAMAGE_REDUCTION().withIdFromFunc(modifierTypes.ENEMY_DAMAGE_REDUCTION),
        2.5,
        1,
      ),
    defense,
  );
  if (endure > 0) {
    addStacks(
      () =>
        new EnemyEndureChanceModifier(
          modifierTypes.ENEMY_ENDURE_CHANCE().withIdFromFunc(modifierTypes.ENEMY_ENDURE_CHANCE),
          2,
          1,
        ),
      endure,
    );
  }
  if (recovery > 0) {
    addStacks(
      () =>
        new EnemyTurnHealModifier(
          modifierTypes.ENEMY_HEAL().withIdFromFunc(modifierTypes.ENEMY_HEAL),
          2,
          1,
        ),
      recovery,
    );
  }
  if (wantStatus && opts.statusType != null) {
    const tok = statusToken(opts.statusType);
    if (tok) {
      void globalScene.addEnemyModifier(tok, true, true);
    }
  }
  globalScene.updateModifiers(false, true);
}
