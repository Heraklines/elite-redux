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
//     mons' hp and maxHP summed). The absorbed mon becomes temporarily
//     unavailable without entering the faint pipeline, and the fused entity
//     takes both mons' already-committed actions that turn.
//   - SINGLES: the active opponent fuses with a SEEDED-random pick from the enemy
//     bench (randBattleSeedInt only - the co-op determinism requirement, never
//     Math.random). With NO bench mon the ability does nothing and is NOT
//     consumed (it may still fire on a later turn once a bench mon exists).
//
// UN-FUSE: when the fused entity leaves the field or the battle ends, its
// current HP is split back PROPORTIONALLY to each constituent's original max HP.
// Both constituents and any pre-existing DNA-fusion identity are restored.
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
let shatteredPsycheBattle: object | undefined;
const shatteredPsycheFiredHolders = new Set<number>();

/** Un-fuse bookkeeping for a fused entity, keyed by the entity's pokemon id. */
interface FusionRecord {
  /** The entity carrying the temporary fusion. */
  readonly primary: Pokemon;
  /** The fused entity's ORIGINAL max HP (its own contribution). */
  readonly primaryMax: number;
  /** The absorbed constituent's original max HP (its contribution). */
  readonly constituentMax: number;
  /** The absorbed constituent. Battle-local only; never serialized. */
  readonly constituent: Pokemon;
  /** Whether the constituent occupied a field seat before it was absorbed. */
  readonly constituentWasOnField: boolean;
  /** Complete pre-existing DNA-fusion identity of the primary. */
  readonly primaryFusion: FusionIdentity;
}
const shatteredPsycheLedger = new Map<number, FusionRecord>();
/** Temporarily absorbed Pokemon are alive, but must not be targetable or selectable as reserves. */
const shatteredPsycheAbsorbed = new WeakSet<Pokemon>();

interface FusionIdentity {
  readonly species: Pokemon["fusionSpecies"];
  readonly formIndex: number;
  readonly abilityIndex: number;
  readonly shiny: boolean;
  readonly variant: Pokemon["fusionVariant"];
  readonly gender: Pokemon["fusionGender"];
  readonly luck: number;
  readonly customPokemonData: Pokemon["fusionCustomPokemonData"];
}

/** Whether a living party member is temporarily contained inside a Shattered Psyche fusion. */
export function erShatteredPsycheIsAbsorbed(pokemon: Pokemon): boolean {
  return shatteredPsycheAbsorbed.has(pokemon);
}

/** Read-only holder/fusion state for combat-policy observations. */
export function erShatteredPsycheState(pokemon: Pokemon):
  | {
      fired: boolean;
      wave: number;
      fusion: {
        primaryMax: number;
        constituentMax: number;
        constituentId: number;
      } | null;
    }
  | undefined {
  const wave = globalScene.currentBattle?.waveIndex ?? -1;
  const sameBattle = shatteredPsycheBattle === globalScene.currentBattle;
  const fired = sameBattle && shatteredPsycheWaveKey === String(wave) && shatteredPsycheFiredHolders.has(pokemon.id);
  const record =
    sameBattle && shatteredPsycheWaveKey === String(wave) ? (shatteredPsycheLedger.get(pokemon.id) ?? null) : null;
  const fusion = record
    ? {
        primaryMax: record.primaryMax,
        constituentMax: record.constituentMax,
        constituentId: record.constituent.id,
      }
    : null;
  return fired || fusion ? { fired, wave, fusion } : undefined;
}

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
  primary.fusionCustomPokemonData = constituent.customPokemonData;
  primary.generateName();
}

function snapshotFusionIdentity(primary: Pokemon): FusionIdentity {
  return {
    species: primary.fusionSpecies,
    formIndex: primary.fusionFormIndex,
    abilityIndex: primary.fusionAbilityIndex,
    shiny: primary.fusionShiny,
    variant: primary.fusionVariant,
    gender: primary.fusionGender,
    luck: primary.fusionLuck,
    customPokemonData: primary.fusionCustomPokemonData,
  };
}

/** Restore the exact DNA-fusion identity that existed before the forced fusion. */
function restoreFusionIdentity(primary: Pokemon, identity: FusionIdentity): void {
  primary.fusionSpecies = identity.species;
  primary.fusionFormIndex = identity.formIndex;
  primary.fusionAbilityIndex = identity.abilityIndex;
  primary.fusionShiny = identity.shiny;
  primary.fusionVariant = identity.variant;
  primary.fusionGender = identity.gender;
  primary.fusionLuck = identity.luck;
  primary.fusionCustomPokemonData = identity.customPokemonData;
  primary.generateName();
  primary.calculateStats();
}

/** Living, benched (off-field) enemy party members `holder` could absorb in singles. */
function enemyBench(holder: Pokemon): Pokemon[] {
  const party = holder.isPlayer() ? globalScene.getEnemyParty() : globalScene.getPlayerParty();
  return party.filter(p => p?.isAllowedInBattle() && !p.isOnField());
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
  if (
    !primary
    || !constituent
    || primary === constituent
    || shatteredPsycheLedger.has(primary.id)
    || shatteredPsycheAbsorbed.has(primary)
    || shatteredPsycheAbsorbed.has(constituent)
  ) {
    return false;
  }

  const primaryMax = primary.getMaxHp();
  const constituentMax = constituent.getMaxHp();
  const bonusMove = pickConstituentMove(constituent, holder, constituentOnField);
  const primaryFusion = snapshotFusionIdentity(primary);

  // Combined HP: sum both mons' current + max HP onto the primary.
  primary.setStat(Stat.HP, primaryMax + constituentMax);
  primary.hp = Math.min(primaryMax + constituentMax, primary.hp + Math.max(0, constituent.hp));
  applyFusionLook(primary, constituent);
  shatteredPsycheLedger.set(primary.id, {
    primary,
    primaryMax,
    constituentMax,
    constituent,
    constituentWasOnField: constituentOnField,
    primaryFusion,
  });
  shatteredPsycheAbsorbed.add(constituent);

  // Temporarily retire the absorbed constituent without sending it through
  // FaintPhase. A synthetic faint used to award a KO, run VictoryPhase, replace
  // trainer slots, move held items, and tear down UI even though the Pokemon was
  // still part of the combined entity.
  if (constituentOnField) {
    const slot = constituent.getBattlerIndex();
    const cmd = globalScene.currentBattle.turnCommands[slot];
    if (cmd) {
      cmd.skip = true;
    }
    constituent.switchOutStatus = true;
    constituent.setVisible(false);
    constituent.getSprite()?.setVisible(false);
    constituent.hideInfo();
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
  if (shatteredPsycheBattle !== battle) {
    // Defensive boundary recovery for interrupted/legacy phase queues. Normally
    // BattleEndPhase restores these before rewards and before newBattle().
    erShatteredPsycheEndBattle();
    shatteredPsycheBattle = battle;
    shatteredPsycheWaveKey = waveKey;
    shatteredPsycheFiredHolders.clear();
  }
  for (const holder of globalScene.getField()) {
    if (!holder?.isActive(true) || shatteredPsycheFiredHolders.has(holder.id)) {
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
  const { primaryHp, constituentHp } = splitFusedHp(pokemon.hp, rec.primaryMax, rec.constituentMax);
  restoreFusionIdentity(pokemon, rec.primaryFusion);
  pokemon.setStat(Stat.HP, rec.primaryMax);
  pokemon.hp = Math.max(0, Math.min(rec.primaryMax, primaryHp));
  rec.constituent.hp = Math.max(0, Math.min(rec.constituentMax, constituentHp));
  shatteredPsycheAbsorbed.delete(rec.constituent);

  if (rec.constituentWasOnField && rec.constituent.active) {
    rec.constituent.switchOutStatus = false;
    rec.constituent.setVisible(true);
    rec.constituent.setAlpha(1);
    rec.constituent.getSprite()?.setVisible(true);
    rec.constituent.showInfo();
    rec.constituent.updateInfo(true);
  }
  pokemon.updateInfo(true);
}

/** Restore every outstanding forced fusion before post-battle rewards and teardown. */
export function erShatteredPsycheEndBattle(): void {
  for (const [primaryId, rec] of [...shatteredPsycheLedger.entries()]) {
    if (rec.primary.active) {
      erShatteredPsycheOnLeaveField(rec.primary);
      continue;
    }
    shatteredPsycheAbsorbed.delete(rec.constituent);
    shatteredPsycheLedger.delete(primaryId);
  }
}
