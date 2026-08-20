/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  type AbAttrBaseParams,
  AllyStatMultiplierAbAttr,
  type AllyStatMultiplierAbAttrParams,
  AttackTypeImmunityAbAttr,
  MovePowerBoostAbAttr,
  MoveTypeChangeAbAttr,
  PostBiomeChangeTerrainChangeAbAttr,
  PostSummonAbAttr,
  PostSummonTerrainChangeAbAttr,
  StatMultiplierAbAttr,
} from "#abilities/ab-attrs";
import type { AbBuilder } from "#abilities/ability";
import type { Battle } from "#app/battle";
import { globalScene } from "#app/global-scene";
import { GroundedEntryHazardImmunityAbAttr } from "#data/elite-redux/archetypes/entry-hazard-immunity";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import type { BattlerIndex } from "#enums/battler-index";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { PositionalTagType } from "#enums/positional-tag-type";
import { SpeciesId } from "#enums/species-id";
import { type BattleStat, Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { noAbilityTypeOverrideMoves } from "#moves/invalid-moves";
import type { Move } from "#moves/move";
import { isFieldTargeted } from "#moves/move-utils";
import {
  ER_DEMODULATOR_ABILITY_ID,
  ER_ELECTRODYNAMICS_ABILITY_ID,
  ER_MODULATOR_ABILITY_ID,
  ER_PSIONIC_ABILITY_ID,
  ER_SURGES_UP_ABILITY_ID,
} from "./fakemon-pitch-abilities";

const RAICHU_PSIONIC_ABILITY = ER_PSIONIC_ABILITY_ID as AbilityId;
const RAICHU_ELECTRODYNAMICS_ABILITY = ER_ELECTRODYNAMICS_ABILITY_ID as AbilityId;
const magneticFluxRecipients = new Map<Pokemon, Map<Pokemon, object>>();
const magneticFluxOccupants = new Map<BattlerIndex, Pokemon>();
let magneticFluxBattle: Battle | undefined;

function currentTerrain(): TerrainType {
  return globalScene?.arena?.terrainType ?? TerrainType.NONE;
}

function isAnyTerrainActive(): boolean {
  return currentTerrain() !== TerrainType.NONE;
}

function expireFluxOnSwitch(activeField: readonly Pokemon[] | undefined): void {
  if (!activeField) {
    return;
  }
  const currentOccupants = new Map(activeField.map(pokemon => [pokemon.getBattlerIndex(), pokemon]));
  for (const [index, previous] of magneticFluxOccupants) {
    const current = currentOccupants.get(index);
    if (current !== previous) {
      for (const recipients of magneticFluxRecipients.values()) {
        recipients.delete(previous);
      }
    }
  }
  magneticFluxOccupants.clear();
  for (const [index, pokemon] of currentOccupants) {
    magneticFluxOccupants.set(index, pokemon);
  }
}

function resetBattleLocalState(): void {
  const battle = globalScene?.currentBattle;
  if (magneticFluxBattle !== undefined && battle !== magneticFluxBattle) {
    magneticFluxRecipients.clear();
    magneticFluxOccupants.clear();
    const tags = globalScene?.arena?.positionalTagManager?.tags;
    if (tags) {
      globalScene.arena.positionalTagManager.tags = tags.filter(
        tag => tag.tagType !== PositionalTagType.ELECTRODYNAMICS_POSITION,
      );
    }
  }
  magneticFluxBattle = battle;
  expireFluxOnSwitch(globalScene?.getField?.(true));
}
/** Record only a successful Magnetic Flux target receipt for this battle. */
export function recordMagneticFluxRecipient(user: Pokemon, target: Pokemon): void {
  resetBattleLocalState();
  let recipients = magneticFluxRecipients.get(user);
  if (!recipients) {
    recipients = new Map<Pokemon, object>();
    magneticFluxRecipients.set(user, recipients);
  }
  recipients.set(target, target.summonData);
}

function raichuUsesAtePriority(pokemon: Pokemon): boolean {
  return [AbilityId.AERILATE, AbilityId.PIXILATE, AbilityId.REFRIGERATE].some(ability => pokemon.hasAbility(ability));
}

function canElectrodynamicsConvert(move: Move, user: Pokemon): boolean {
  if (move.type !== PokemonType.NORMAL || noAbilityTypeOverrideMoves.has(move.id)) {
    return false;
  }
  if (!user.isTerastallized) {
    return !raichuUsesAtePriority(user);
  }
  if (move.id === MoveId.TERA_BLAST) {
    return false;
  }
  if (
    move.id === MoveId.TERA_STARSTORM
    && user.getTeraType() === PokemonType.STELLAR
    && user.hasSpecies(SpeciesId.TERAPAGOS)
  ) {
    return false;
  }
  return !raichuUsesAtePriority(user);
}

/** Magnet Rise is the Floating tag's source move; Flux recipients are identity-bound per battle. */
export function partnerHasRaichuBoostCondition(partner: Pokemon): boolean {
  resetBattleLocalState();
  const activeField = globalScene?.getField?.(true);
  const magneticFluxTarget =
    (activeField == null || activeField.includes(partner))
    && Array.from(magneticFluxRecipients.values()).some(recipients => recipients.get(partner) === partner.summonData);
  const floatingTag = partner.getTag(BattlerTagType.FLOATING);
  return (
    floatingTag?.sourceMove === MoveId.MAGNET_RISE
    || magneticFluxTarget
    || partner.hasAbility(AbilityId.PLUS)
    || partner.hasAbility(AbilityId.MINUS)
  );
}

/** Register the current battler slot as an Electrodynamics position. */
export function installElectrodynamicsPosition(pokemon: Pokemon): void {
  resetBattleLocalState();
  const manager = globalScene?.arena?.positionalTagManager;
  if (manager && manager.canAddTag(PositionalTagType.ELECTRODYNAMICS_POSITION, pokemon.getBattlerIndex())) {
    manager.addTag({
      tagType: PositionalTagType.ELECTRODYNAMICS_POSITION,
      turnCount: 0,
      targetIndex: pokemon.getBattlerIndex(),
    });
  }
}

/** Whether the current occupant is standing in an Electrodynamics position. */
export function isElectrodynamicsPosition(pokemon: Pokemon): boolean {
  resetBattleLocalState();
  return !!globalScene?.arena?.positionalTagManager?.tags.some(
    tag => tag.tagType === PositionalTagType.ELECTRODYNAMICS_POSITION && tag.targetIndex === pokemon.getBattlerIndex(),
  );
}

/** Electrodynamics positions retain Electric benefits and Psionic's virtual Psychic grounding. */
export function isRaichuTerrainGrounded(pokemon: Pokemon, terrain: TerrainType): boolean {
  return (
    pokemon.isGrounded()
    || (isElectrodynamicsPosition(pokemon)
      && (terrain === TerrainType.ELECTRIC || pokemon.hasAbility(RAICHU_PSIONIC_ABILITY)))
  );
}

/** Resolve whether a matching terrain is active, including virtual slot benefits. */
export function isRaichuTerrainActiveForMove(pokemon: Pokemon, moveType: PokemonType): boolean {
  const terrain =
    moveType === PokemonType.ELECTRIC
      ? TerrainType.ELECTRIC
      : moveType === PokemonType.PSYCHIC
        ? TerrainType.PSYCHIC
        : TerrainType.NONE;
  if (terrain === TerrainType.NONE) {
    return false;
  }
  return (
    currentTerrain() === terrain
    || pokemon.hasAbility(RAICHU_PSIONIC_ABILITY)
    || (terrain === TerrainType.ELECTRIC
      && pokemon.hasAbility(RAICHU_ELECTRODYNAMICS_ABILITY)
      && isElectrodynamicsPosition(pokemon))
  );
}

/** Psionic's Psychic Terrain priority cancellation without mutating the arena. */
export function isRaichuTerrainMoveCancelled(user: Pokemon, targets: BattlerIndex[], move: Move): boolean {
  if (currentTerrain() === TerrainType.PSYCHIC || isFieldTargeted(move) || move.getPriority(user) <= 0) {
    return false;
  }
  const activeField = globalScene?.getField?.(true) ?? [];
  return activeField.some(
    target =>
      targets.includes(target.getBattlerIndex())
      && target.hasAbility(RAICHU_PSIONIC_ABILITY)
      && isRaichuTerrainGrounded(target, TerrainType.PSYCHIC),
  );
}

/** Extra terrain multiplier for Psionic when the matching terrain is virtual. */
export function getRaichuTerrainMoveMultiplier(pokemon: Pokemon, moveType: PokemonType): number {
  const terrain = moveType === PokemonType.ELECTRIC ? TerrainType.ELECTRIC : TerrainType.PSYCHIC;
  if (
    !isRaichuTerrainActiveForMove(pokemon, moveType)
    || currentTerrain() === terrain
    || !isRaichuTerrainGrounded(pokemon, terrain)
  ) {
    return 1;
  }
  return 1.3;
}

/** Holder-side Demodulator / Modulator base-stat multiplier during Electric Terrain. */
export class RaichuTerrainStatMultiplierAbAttr extends StatMultiplierAbAttr {
  constructor(stat: BattleStat, multiplier: number, terrain: TerrainType) {
    super(stat, multiplier, () => currentTerrain() === terrain);
  }
}

/** Partner-side Demodulator / Modulator multiplier with the exact 1.5x/2x split. */
export class RaichuAllyStatMultiplierAbAttr extends AllyStatMultiplierAbAttr {
  private readonly terrain: TerrainType;

  constructor(stat: BattleStat, terrain: TerrainType) {
    super(stat, 1.5, false);
    this.terrain = terrain;
  }

  override canApply(params: AllyStatMultiplierAbAttrParams): boolean {
    return (
      super.canApply(params)
      && currentTerrain() === this.terrain
      && (globalScene?.currentBattle?.getBattlerCount() ?? 1) > 1
    );
  }

  override apply({ target, statVal }: AllyStatMultiplierAbAttrParams): void {
    statVal.value *= partnerHasRaichuBoostCondition(target) ? 2 : 1.5;
  }
}

/** Persistent field-position installation for Electrodynamics. */
export class ElectrodynamicsPositionAbAttr extends PostSummonAbAttr {
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (!simulated) {
      installElectrodynamicsPosition(pokemon);
    }
  }
}

/** Psionic terrain power rider when the matching virtual terrain is active. */
export class PsionicTerrainPowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super((user, _target, move) => getRaichuTerrainMoveMultiplier(user, user.getMoveType(move)) > 1, 1.3);
  }
}

/** Electrodynamics' virtual Electric Terrain move-power rider for its slot occupant. */
export class ElectrodynamicsTerrainPowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super(
      (user, _target, move) =>
        !user.hasAbility(RAICHU_PSIONIC_ABILITY) && getRaichuTerrainMoveMultiplier(user, user.getMoveType(move)) > 1,
      1.3,
    );
  }
}

/** Galvanize conversion supplied by Electrodynamics, with -ate precedence. */
export class ElectrodynamicsGalvanizeAbAttr extends MoveTypeChangeAbAttr {
  constructor() {
    super(PokemonType.ELECTRIC, (user, _target, move) => canElectrodynamicsConvert(move, user));
  }
}

/** Galvanize's standard power rider, sharing the same -ate precedence gate. */
export class ElectrodynamicsGalvanizePowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super((user, _target, move) => canElectrodynamicsConvert(move, user), 1.2);
  }
}

/** All-terrain Surge Surfer: speed doubles under any active terrain. */
export class RaichuAllTerrainSurgeSurferAbAttr extends StatMultiplierAbAttr {
  constructor() {
    super(Stat.SPD, 2, () => isAnyTerrainActive());
  }
}

/** Wire the five source-backed Mega Alolan Raichu abilities. */
export function wireRaichuPitchAbility(builder: AbBuilder, id: number): void {
  switch (id) {
    case ER_DEMODULATOR_ABILITY_ID:
      builder.attr(RaichuTerrainStatMultiplierAbAttr, Stat.ATK, 1.5, TerrainType.ELECTRIC);
      builder.attr(RaichuTerrainStatMultiplierAbAttr, Stat.DEF, 1.5, TerrainType.ELECTRIC);
      builder.attr(RaichuAllyStatMultiplierAbAttr, Stat.ATK, TerrainType.ELECTRIC);
      builder.attr(RaichuAllyStatMultiplierAbAttr, Stat.DEF, TerrainType.ELECTRIC);
      break;
    case ER_MODULATOR_ABILITY_ID:
      builder.attr(RaichuTerrainStatMultiplierAbAttr, Stat.SPATK, 1.5, TerrainType.ELECTRIC);
      builder.attr(RaichuTerrainStatMultiplierAbAttr, Stat.SPDEF, 1.5, TerrainType.ELECTRIC);
      builder.attr(RaichuAllyStatMultiplierAbAttr, Stat.SPATK, TerrainType.ELECTRIC);
      builder.attr(RaichuAllyStatMultiplierAbAttr, Stat.SPDEF, TerrainType.ELECTRIC);
      break;
    case ER_SURGES_UP_ABILITY_ID:
      builder.attr(PostSummonTerrainChangeAbAttr, TerrainType.ELECTRIC);
      builder.attr(PostBiomeChangeTerrainChangeAbAttr, TerrainType.ELECTRIC);
      builder.attr(RaichuAllTerrainSurgeSurferAbAttr);
      break;
    case ER_ELECTRODYNAMICS_ABILITY_ID:
      builder.attr(ElectrodynamicsTerrainPowerAbAttr);
      builder.attr(ElectrodynamicsPositionAbAttr);
      builder.attr(AttackTypeImmunityAbAttr, PokemonType.GROUND);
      builder.attr(GroundedEntryHazardImmunityAbAttr);
      builder.attr(ElectrodynamicsGalvanizeAbAttr);
      builder.attr(ElectrodynamicsGalvanizePowerAbAttr);
      break;
    case ER_PSIONIC_ABILITY_ID:
      builder.attr(PsionicTerrainPowerAbAttr);
      break;
  }
}
