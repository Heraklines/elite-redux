/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Shattered Psyche (ability 5968, Primal Mew's innate).
//
// Once per battle, after the commands for the turn are locked in (post-command
// timing, from the top of TurnStartPhase), the holder fuses TWO of its opponents
// into ONE temporary entity:
//   - DOUBLES: the two enemy field mons fuse into one, with COMBINED HP (both
//     mons' hp and maxHP summed). The absorbed mon leaves the field (a real
//     FaintPhase - the only field removal the co-op checkpoint fully models),
//     and the fused entity takes BOTH mons' actions each turn (its own move plus
//     the absorbed mon's move, delivered by ErShatteredPsycheBonusPhase).
//   - SINGLES: the active opponent fuses with a SEEDED-random pick from the enemy
//     bench (randBattleSeedInt only - the co-op determinism requirement, never
//     Math.random). With NO bench mon the ability does nothing and is NOT
//     consumed (it may still fire on a later turn once a bench mon exists).
//
// UN-FUSE: when the fused entity leaves the field (faint / battle end), its
// current HP is split back PROPORTIONALLY to each constituent's original max HP,
// the entity's own max HP is restored, and the blended look is cleared. The
// absorbed constituent is not re-summoned (the fusion lasts until the entity
// leaves the field), so the only co-op field mutation is the initial FaintPhase.
//
// CO-OP SAFETY: this runs HOST/SOLO ONLY (the guest diverts the whole turn to
// CoopReplayTurnPhase before the trigger). Every effect is expressed through
// state the per-turn checkpoint already reconciles (hp / maxHp / fainted) or a
// streamed phase cue (FaintPhase, MovePhase); the fusion fields and the un-fuse
// ledger are host-local cosmetics that never cross the wire.
//
// REUSES the existing fusion infrastructure - the `fusionSpecies`/`fusionFormIndex`/
// ... fields the DNA Splicer path populates - for the blended sprite/name, rather
// than a parallel system.
// =============================================================================

import { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { Command } from "#enums/command";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Ability id: next free id after the type-nativization band (ends 5967). */
export const ER_SHATTERED_PSYCHE_ABILITY_ID = 5968;

/** Attr constructor name used to detect the ability on the field (unsuppressed). */
const SHATTERED_PSYCHE_ATTR_NAME = "ShatteredPsycheAbAttr";

/**
 * Marker ability: the fusion is driven imperatively from {@linkcode
 * erShatteredPsycheMaybeFuse} (turn-start, host-only), not from an attr hook, so
 * `apply` is a no-op (mirrors ClosedCircuitAbAttr's marker pattern).
 */
export class ShatteredPsycheAbAttr extends AbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}

/** Per-battle (per-wave) once-only guard. Host-local; never serialized. */
let shatteredPsycheWaveKey = "";
const shatteredPsycheFiredHolders = new Set<number>();

/** Un-fuse bookkeeping for a fused entity, keyed by the entity's pokemon id. */
interface FusionRecord {
  /** The fused entity's ORIGINAL max HP (its own contribution). */
  readonly primaryMax: number;
  /** The absorbed constituent's original max HP (its contribution). */
  readonly constituentMax: number;
  /** The absorbed constituent's pokemon id. */
  readonly constituentId: number;
}
const shatteredPsycheLedger = new Map<number, FusionRecord>();

/**
 * Split `currentHp` of a fused entity back into the two constituents' shares,
 * PROPORTIONAL to each one's original max HP. Pure + exhaustively rounded so the
 * two shares always sum to exactly `currentHp`.
 */
export function splitFusedHp(
  currentHp: number,
  primaryMax: number,
  constituentMax: number,
): { primaryHp: number; constituentHp: number } {
  const total = primaryMax + constituentMax;
  if (total <= 0 || currentHp <= 0) {
    return { primaryHp: Math.max(0, currentHp), constituentHp: 0 };
  }
  const primaryHp = Math.min(primaryMax, Math.round((currentHp * primaryMax) / total));
  const constituentHp = Math.max(0, Math.min(constituentMax, currentHp - primaryHp));
  return { primaryHp, constituentHp };
}

/** Whether `pokemon` carries an unsuppressed Shattered Psyche. */
function carriesShatteredPsyche(pokemon: Pokemon): boolean {
  return pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === SHATTERED_PSYCHE_ATTR_NAME);
}

/**
 * The absorbed constituent's move for its bonus action. DOUBLES: the move it
 * already committed this turn (its `turnCommand`). SINGLES: a seeded pick from
 * the bench mon's usable moveset (its command was never rolled).
 */
function pickConstituentMove(constituent: Pokemon, holder: Pokemon, onField: boolean): MoveId {
  if (onField) {
    const cmd = globalScene.currentBattle.turnCommands[constituent.getBattlerIndex()];
    if (cmd?.command === Command.FIGHT && cmd.move && cmd.move.move !== MoveId.NONE) {
      return cmd.move.move;
    }
  }
  const usable = constituent.getMoveset().filter(m => m != null && !m.isOutOfPp());
  if (usable.length === 0) {
    return MoveId.NONE;
  }
  return usable[holder.randBattleSeedInt(usable.length)].moveId;
}

/** Copy the constituent's fusion identity onto the primary (the blended look). */
function applyFusionLook(primary: Pokemon, constituent: Pokemon): void {
  primary.fusionSpecies = constituent.species;
  primary.fusionFormIndex = constituent.formIndex;
  primary.fusionAbilityIndex = constituent.abilityIndex;
  primary.fusionShiny = constituent.shiny;
  primary.fusionVariant = constituent.variant;
  primary.fusionGender = constituent.gender;
  primary.fusionLuck = constituent.luck;
}

/** Clear a blended look (on un-fuse). */
function clearFusionLook(primary: Pokemon): void {
  primary.fusionSpecies = null;
  primary.fusionFormIndex = 0;
  primary.fusionAbilityIndex = 0;
  primary.fusionShiny = false;
  primary.fusionVariant = 0;
}

/** Living, benched (off-field) enemy party members `holder` could absorb in singles. */
function enemyBench(holder: Pokemon): Pokemon[] {
  const party = holder.isPlayer() ? globalScene.getEnemyParty() : globalScene.getPlayerParty();
  return party.filter(p => p != null && !p.isFainted() && !p.isOnField());
}

/**
 * Attempt the fusion for `holder`. Returns `true` when it fired (so the once-per-
 * battle guard consumes it), `false` when it could not (singles with no bench),
 * leaving it un-consumed to retry a later turn.
 */
function tryFuseOpponents(holder: Pokemon): boolean {
  const opponents = holder.getOpponents(true);
  let primary: Pokemon | undefined;
  let constituent: Pokemon | undefined;
  let constituentOnField = false;

  if (opponents.length >= 2) {
    // Doubles: the two enemy field mons fuse.
    primary = opponents[0];
    constituent = opponents[1];
    constituentOnField = true;
  } else if (opponents.length === 1) {
    // Singles: the active opponent fuses with a seeded bench pick.
    primary = opponents[0];
    const bench = enemyBench(holder);
    if (bench.length === 0) {
      return false; // no bench mon -> no-op, NOT consumed
    }
    constituent = bench[holder.randBattleSeedInt(bench.length)];
  } else {
    return false;
  }
  if (!primary || !constituent || primary === constituent) {
    return false;
  }

  const primaryMax = primary.getMaxHp();
  const constituentMax = constituent.getMaxHp();
  const bonusMove = pickConstituentMove(constituent, holder, constituentOnField);

  // Combined HP: sum both mons' current + max HP onto the primary.
  primary.setStat(Stat.HP, primaryMax + constituentMax);
  primary.hp = Math.min(primaryMax + constituentMax, primary.hp + Math.max(0, constituent.hp));
  applyFusionLook(primary, constituent);
  shatteredPsycheLedger.set(primary.id, { primaryMax, constituentMax, constituentId: constituent.id });

  // Remove the absorbed constituent.
  if (constituentOnField) {
    // On-field: skip its queued action, then remove it via a real FaintPhase
    // (the only field removal the co-op checkpoint fully models).
    const slot = constituent.getBattlerIndex();
    const cmd = globalScene.currentBattle.turnCommands[slot];
    if (cmd) {
      cmd.skip = true;
    }
    constituent.hp = 0;
    globalScene.phaseManager.unshiftNew("FaintPhase", slot, true);
  } else {
    // Off-field bench mon (not in the field checksum): flag it defeated.
    constituent.hp = 0;
  }

  // Refresh the fused entity's HP bar / name to the combined values.
  primary.updateInfo();

  // The fused entity's SECOND action: the absorbed constituent's move.
  if (bonusMove !== MoveId.NONE) {
    globalScene.phaseManager.pushNew("ErShatteredPsycheBonusPhase", primary, bonusMove, MoveUseMode.NORMAL);
  }
  return true;
}

/**
 * Turn-start hook (host/solo only - called after the guest early-return in
 * TurnStartPhase). Once per battle, the first un-fired Shattered Psyche holder on
 * the field fuses two of its opponents.
 */
export function erShatteredPsycheMaybeFuse(): void {
  const battle = globalScene.currentBattle;
  if (!battle) {
    return;
  }
  const waveKey = String(battle.waveIndex);
  if (shatteredPsycheWaveKey !== waveKey) {
    shatteredPsycheWaveKey = waveKey;
    shatteredPsycheFiredHolders.clear();
    shatteredPsycheLedger.clear();
  }
  for (const holder of globalScene.getField()) {
    if (!holder || !holder.isActive(true) || shatteredPsycheFiredHolders.has(holder.id)) {
      continue;
    }
    if (!carriesShatteredPsyche(holder)) {
      continue;
    }
    if (tryFuseOpponents(holder)) {
      shatteredPsycheFiredHolders.add(holder.id);
    }
  }
}

/**
 * Leave-field hook: when a fused entity leaves the field, split its current HP
 * back to each constituent PROPORTIONALLY, restore its own max HP, and clear the
 * blended look. The absorbed constituent is not re-summoned.
 */
export function erShatteredPsycheOnLeaveField(pokemon: Pokemon): void {
  const rec = shatteredPsycheLedger.get(pokemon.id);
  if (!rec) {
    return;
  }
  shatteredPsycheLedger.delete(pokemon.id);
  const { primaryHp } = splitFusedHp(pokemon.hp, rec.primaryMax, rec.constituentMax);
  pokemon.setStat(Stat.HP, rec.primaryMax);
  pokemon.hp = Math.max(0, Math.min(rec.primaryMax, primaryHp));
  clearFusionLook(pokemon);
}
