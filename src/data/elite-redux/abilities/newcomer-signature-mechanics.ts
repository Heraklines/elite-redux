/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  AbAttr,
  ArenaTrapAbAttr,
  ConditionalCritAbAttr,
  ForceSwitchOutHelper,
  ForceSwitchOutImmunityAbAttr,
  MovePowerBoostAbAttr,
  PostAttackAbAttr,
  PostDefendAbAttr,
  PostSummonAbAttr,
  PostSummonAddArenaTagAbAttr,
  PostTurnAbAttr,
  type PreDefendModifyDamageAbAttrParams,
  ReceivedMoveDamageMultiplierAbAttr,
  SetMoveAccuracyAbAttr,
  type SetMoveAccuracyAbAttrParams,
  WeightMultiplierAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allAbilities, allMoves } from "#data/data-lists";
import { primeDualTypeMove } from "#data/elite-redux/abilities/dual-type-move";
// biome-ignore lint/suspicious/noImportCycles: Scripted follow-ups must construct real Move instances.
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import type { PokemonMove } from "#data/moves/pokemon-move";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErAbilityId } from "#enums/er-ability-id";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { SwitchType } from "#enums/switch-type";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type {
  AbAttrBaseParams,
  PostMoveInteractionAbAttrParams,
  PreAttackModifyPowerAbAttrParams,
} from "#types/ability-types";
import type { NumberHolder } from "#utils/value-holder";
import { ER_INVERSE_ROOM_ABILITY_ID, ER_METEOR_MASS_ABILITY_ID } from "./newcomer-batch2";
import {
  ER_ANNEAL_ABILITY_ID,
  ER_BOOT_HILL_ABILITY_ID,
  ER_CENTER_OF_ATTENTION_ABILITY_ID,
  ER_CRACKED_VESSEL_ABILITY_ID,
  ER_DEADEYE_DRAW_ABILITY_ID,
  ER_ECLIPSE_WING_ABILITY_ID,
  ER_ENCORE_SET_ABILITY_ID,
  ER_FAN_FAVORITE_ABILITY_ID,
  ER_FINAL_SEASON_ABILITY_ID,
  ER_FOUL_HARVEST_ABILITY_ID,
  ER_GILLIE_SUIT_ABILITY_ID,
  ER_GLAM_ROCK_ABILITY_ID,
  ER_HEAVYWEIGHT_ABILITY_ID,
  ER_LIVING_CHROME_ABILITY_ID,
  ER_POROUS_ABILITY_ID,
  ER_REDUCTION_ABILITY_ID,
  ER_RING_GENERAL_ABILITY_ID,
  ER_SEDIMENT_BLOOM_ABILITY_ID,
  ER_SETLIST_ABILITY_ID,
  ER_SKYHOOK_ABILITY_ID,
  ER_SPIRIT_PUNCH_ABILITY_ID,
  ER_SUPEREGO_ABILITY_ID,
  ER_TWO_FACED_UNLEASHED_ABILITY_ID,
  ER_VAPOR_BODY_ABILITY_ID,
} from "./newcomer-signature-abilities";

const HAZARDS = [
  ArenaTagType.SPIKES,
  ArenaTagType.TOXIC_SPIKES,
  ArenaTagType.STEALTH_ROCK,
  ArenaTagType.STICKY_WEB,
  ArenaTagType.HOT_COALS,
  ArenaTagType.FOAMY_WEB,
  ArenaTagType.CREEPING_THORNS,
  ArenaTagType.ER_INFESTATION_TRAP,
] as const;

function hasAttr(pokemon: Pokemon, name: string): boolean {
  return pokemon.getAllActiveAbilityAttrs().some(attr => attr?.constructor?.name === name);
}

function turnKey(): string {
  return `${globalScene.currentBattle?.waveIndex ?? 0}:${globalScene.currentBattle?.turn ?? 0}`;
}

function ownSide(pokemon: Pokemon): ArenaTagSide {
  return pokemon.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
}

function foeSide(pokemon: Pokemon): ArenaTagSide {
  return pokemon.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
}

// ---------------------------------------------------------------------------
// Final Season

const VOLUNTARY_ENTRY = new WeakSet<Pokemon>();
const FINAL_SEASON_PENDING_FOG = new WeakSet<Pokemon>();
let finalSeasonFogOwner: Pokemon | undefined;
let finalSeasonFogInstance: object | undefined;

export function markGenuineVoluntaryEntry(pokemon: Pokemon): void {
  VOLUNTARY_ENTRY.add(pokemon);
}

export class FinalSeasonEntryAbAttr extends PostSummonAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return VOLUNTARY_ENTRY.has(pokemon);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    VOLUNTARY_ENTRY.delete(pokemon);
    if (simulated) {
      return;
    }
    for (const opponent of pokemon.getOpponents()) {
      opponent.addTag(BattlerTagType.ER_QUASHED, 2, MoveId.NONE, pokemon.id);
    }
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Final Season delayed the opposing side!`);
    FINAL_SEASON_PENDING_FOG.add(pokemon);
  }
}

export class FinalSeasonFogAbAttr extends PostTurnAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return FINAL_SEASON_PENDING_FOG.has(pokemon);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    FINAL_SEASON_PENDING_FOG.delete(pokemon);
    if (!simulated && globalScene.arena.trySetWeather(WeatherType.EERIE_FOG, pokemon, 5)) {
      finalSeasonFogOwner = pokemon;
      finalSeasonFogInstance = globalScene.arena.weather ?? undefined;
    }
  }
}

export class FinalSeasonPowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super(
      (pokemon, _target, move) =>
        finalSeasonFogOwner === pokemon
        && finalSeasonFogInstance === globalScene.arena.weather
        && globalScene.arena.weatherType === WeatherType.EERIE_FOG
        && [PokemonType.DARK, PokemonType.FLYING].includes(pokemon.getMoveType(move)),
      1.3,
    );
  }
}

// ---------------------------------------------------------------------------
// Foul Harvest

interface FoulHarvestState {
  charges: number;
  lastMoveRecord: object | undefined;
}

const FOUL_HARVEST = new WeakMap<Pokemon, FoulHarvestState>();
const LAST_EXECUTED_MOVE = new WeakMap<Pokemon, string>();

export function recordSignatureExecutedMove(pokemon: Pokemon, move: Move): void {
  if (pokemon.getMoveset().some(slot => slot.getMove().name === move.name)) {
    LAST_EXECUTED_MOVE.set(pokemon, move.name);
  }
}

function foulState(pokemon: Pokemon): FoulHarvestState {
  let state = FOUL_HARVEST.get(pokemon);
  if (!state) {
    state = { charges: 0, lastMoveRecord: undefined };
    FOUL_HARVEST.set(pokemon, state);
  }
  return state;
}

export class FoulHarvestAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    if (!super.canApply(params) || params.damage <= 0 || params.hitResult >= HitResult.NO_EFFECT) {
      return false;
    }
    const record = params.pokemon.getLastXMoves(1)[0] as object | undefined;
    return !!record && foulState(params.pokemon).lastMoveRecord !== record;
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    const state = foulState(pokemon);
    state.lastMoveRecord = pokemon.getLastXMoves(1)[0] as object | undefined;
    if (simulated) {
      return;
    }
    const moveset = opponent.getMoveset().filter(move => move.moveId !== MoveId.NONE);
    if (moveset.length === 0) {
      return;
    }
    const recentName = LAST_EXECUTED_MOVE.get(opponent);
    const selected =
      (recentName ? moveset.find(move => move.getMove().name === recentName) : undefined)
      ?? moveset[pokemon.randBattleSeedInt(moveset.length)];
    if (!selected || selected.isOutOfPp()) {
      return;
    }
    selected.ppUsed++;
    state.charges = Math.min(3, state.charges + 1);
    globalScene.phaseManager.queueMessage(`${opponent.getNameToRender()}'s ${selected.getName()} lost 1 PP!`);
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Foul Harvest stored a charge!`);
  }
}

export function applyFoulHarvestDrainBonus(user: Pokemon, move: Move, baseHeal: number): number {
  if (!hasAttr(user, "FoulHarvestAbAttr")) {
    return baseHeal;
  }
  const state = foulState(user);
  if (state.charges <= 0) {
    return baseHeal;
  }
  const bonus = Math.floor(user.turnData.singleHitDamageDealt * 0.25 * state.charges);
  state.charges--;
  const usedMove = user.getMoveset().find(slot => slot.moveId === move.id);
  if (usedMove && usedMove.ppUsed > 0) {
    usedMove.ppUsed--;
  }
  globalScene.phaseManager.queueMessage(`${user.getNameToRender()}'s Foul Harvest empowered the drain!`);
  return baseHeal + bonus;
}

export function foulHarvestCharges(pokemon: Pokemon): number {
  return foulState(pokemon).charges;
}

// ---------------------------------------------------------------------------
// Porous, Anneal, Vapor Body, Heavyweight

interface PorousState {
  stacks: number;
  lastMoveRecord: object | undefined;
}
const POROUS = new WeakMap<Pokemon, PorousState>();
function porousState(pokemon: Pokemon): PorousState {
  let state = POROUS.get(pokemon);
  if (!state) {
    state = { stacks: 0, lastMoveRecord: undefined };
    POROUS.set(pokemon, state);
  }
  return state;
}

export class PorousResetAbAttr extends PostSummonAbAttr {
  override apply({ pokemon }: AbAttrBaseParams): void {
    POROUS.set(pokemon, { stacks: 0, lastMoveRecord: undefined });
  }
}

export class PorousSoundReductionAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  constructor() {
    super((_holder, attacker, move) => move.doesFlagEffectApply({ flag: MoveFlags.SOUND_BASED, user: attacker }), 0.5);
  }
}

export class PorousChargeAbAttr extends PostDefendAbAttr {
  override canApply({ pokemon, opponent, damage, hitResult }: PostMoveInteractionAbAttrParams): boolean {
    const record = opponent.getLastXMoves(1)[0] as object | undefined;
    return damage > 0 && hitResult < HitResult.NO_EFFECT && porousState(pokemon).lastMoveRecord !== record;
  }
  override apply({ pokemon, opponent }: PostMoveInteractionAbAttrParams): void {
    const state = porousState(pokemon);
    state.lastMoveRecord = opponent.getLastXMoves(1)[0] as object | undefined;
    state.stacks = Math.min(3, state.stacks + 1);
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Porous body stored the impact!`);
  }
}

export class PorousPowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super(
      (pokemon, _target, move) => pokemon.getMoveType(move) === PokemonType.GROUND && porousState(pokemon).stacks > 0,
      1,
    );
  }
  override apply({ pokemon, power, simulated }: PreAttackModifyPowerAbAttrParams): void {
    const state = porousState(pokemon);
    power.value *= 1 + 0.25 * state.stacks;
    if (!simulated) {
      state.stacks = 0;
      globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} released its Porous power!`);
    }
  }
}

export function porousCharges(pokemon: Pokemon): number {
  return porousState(pokemon).stacks;
}

interface AnnealState {
  gained: number;
  lastMoveRecord: object | undefined;
}
const ANNEAL = new WeakMap<Pokemon, AnnealState>();
export class AnnealResetAbAttr extends PostSummonAbAttr {
  override apply({ pokemon }: AbAttrBaseParams): void {
    ANNEAL.set(pokemon, { gained: 0, lastMoveRecord: undefined });
  }
}
export class AnnealAbAttr extends PostDefendAbAttr {
  override canApply({ pokemon, opponent, move, damage, hitResult }: PostMoveInteractionAbAttrParams): boolean {
    const state = ANNEAL.get(pokemon) ?? { gained: 0, lastMoveRecord: undefined };
    return (
      damage > 0
      && hitResult < HitResult.NO_EFFECT
      && pokemon.getMoveEffectiveness(opponent, move) <= 0.5
      && pokemon.getMoveEffectiveness(opponent, move) > 0
      && state.gained < 2
      && state.lastMoveRecord !== (opponent.getLastXMoves(1)[0] as object | undefined)
    );
  }
  override apply({ pokemon, opponent, move, simulated }: PostMoveInteractionAbAttrParams): void {
    const state = ANNEAL.get(pokemon) ?? { gained: 0, lastMoveRecord: undefined };
    state.lastMoveRecord = opponent.getLastXMoves(1)[0] as object | undefined;
    state.gained++;
    ANNEAL.set(pokemon, state);
    if (!simulated) {
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        [move.category === MoveCategory.PHYSICAL ? Stat.DEF : Stat.SPDEF],
        1,
      );
    }
  }
}

export class VaporBodyAccuracyAbAttr extends AbAttr {
  override apply(): void {}
}

// Meteor Mass (5997) weight multiplier. FLAG (designer sign-off): no 2.65 dex text
// exists for this slot, so 3x is a chosen number — it matches the established ER
// Lead Coat / Chrome Coat `WeightMultiplierAbAttr(3)` precedent and maxes the holder's
// Heavy Slam / Heat Crash weight ratio while inflating incoming Grass Knot / Low Kick.
const METEOR_MASS_WEIGHT_MULTIPLIER = 3;
const INVERSE_ROOM_TURNS = 5;

const WEIGHT_THRESHOLDS = [10, 25, 50, 100, 200];
function weightClass(weight: number): number {
  return WEIGHT_THRESHOLDS.filter(threshold => weight >= threshold).length;
}
function isHeavyweightMove(move: Move): boolean {
  return move.id === MoveId.HEAVY_SLAM || move.id === MoveId.HEAT_CRASH || move.hasFlag(MoveFlags.PUNCHING_MOVE);
}
function heavyweightMultiplier(user: Pokemon, target: Pokemon): number {
  return 1 + Math.min(5, Math.max(0, weightClass(user.getWeight()) - weightClass(target.getWeight()))) * 0.1;
}
export class HeavyweightPowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super((_user, _target, move) => isHeavyweightMove(move), 1);
  }
  override apply({ pokemon, opponent, power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= heavyweightMultiplier(pokemon, opponent);
  }
}
const HEAVYWEIGHT_DROP_TURN = new WeakMap<Pokemon, string>();
export class HeavyweightDropAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (
      super.canApply(params)
      && params.damage > 0
      && isHeavyweightMove(params.move)
      && HEAVYWEIGHT_DROP_TURN.get(params.pokemon) !== turnKey()
    );
  }
  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    HEAVYWEIGHT_DROP_TURN.set(pokemon, turnKey());
    if (!simulated) {
      globalScene.phaseManager.unshiftNew("StatStageChangePhase", opponent.getBattlerIndex(), false, [Stat.DEF], -1);
    }
  }
}

// ---------------------------------------------------------------------------
// Glam Rock and Sediment Bloom

export class GlamRockAbAttr extends PostTurnAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return HAZARDS.some(tag => !!globalScene.arena.getTagOnSide(tag, ownSide(pokemon)));
  }
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    const type = HAZARDS.find(hazardType => !!globalScene.arena.getTagOnSide(hazardType, ownSide(pokemon)));
    if (!type) {
      return;
    }
    const tag = globalScene.arena.getTagOnSide(type, ownSide(pokemon)) as { layers?: number } | undefined;
    if (tag && (tag.layers ?? 1) > 1) {
      (tag as { layers: number }).layers--;
    } else {
      globalScene.arena.removeTagOnSide(type, ownSide(pokemon));
    }
    notifyHazardRemovedBy(pokemon);
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Glam Rock consumed an entry hazard!`);
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      pokemon.getBattlerIndex(),
      true,
      [Stat.DEF, Stat.SPDEF],
      1,
    );
  }
}

interface BloomState {
  source: Pokemon;
  side: ArenaTagSide;
}
const BLOOMS = new Map<ArenaTagSide, BloomState>();
let bloomBattle: object | undefined;
function ensureBloomBattle(): void {
  if (bloomBattle !== globalScene.currentBattle) {
    BLOOMS.clear();
    bloomBattle = globalScene.currentBattle;
  }
}
export function notifyHazardRemovedBy(pokemon: Pokemon): void {
  ensureBloomBattle();
  if (!hasAttr(pokemon, "SedimentBloomMarkerAbAttr")) {
    return;
  }
  BLOOMS.set(foeSide(pokemon), { source: pokemon, side: foeSide(pokemon) });
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} planted a Sediment Bloom!`);
}
export class SedimentBloomMarkerAbAttr extends AbAttr {
  override apply(): void {}
}
export function processSedimentBlooms(): void {
  ensureBloomBattle();
  for (const bloomState of BLOOMS.values()) {
    const pokemon = bloomState.source;
    let drained = 0;
    const foes = bloomState.side === ArenaTagSide.PLAYER ? globalScene.getPlayerField() : globalScene.getEnemyField();
    for (const foe of foes.filter(mon => mon.isActive(true))) {
      const amount = Math.max(1, Math.floor(foe.getMaxHp() / 16));
      drained += foe.damageAndUpdate(amount, { result: HitResult.INDIRECT, source: pokemon });
    }
    const allies = bloomState.side === ArenaTagSide.PLAYER ? globalScene.getEnemyField() : globalScene.getPlayerField();
    for (const ally of allies) {
      ally.heal(drained);
    }
  }
}

// ---------------------------------------------------------------------------
// Two-Faced Unleashed, Setlist, Fan Favorite

const TWO_FACED_LAST_TURN = new WeakMap<Pokemon, string>();
const TWO_FACED_ACTIVE_TURN = new WeakMap<Pokemon, string>();
const TWO_FACED_RECOIL_RECORD = new WeakMap<Pokemon, object>();
function twoFacedReady(pokemon: Pokemon): boolean {
  if (TWO_FACED_ACTIVE_TURN.get(pokemon) === turnKey()) {
    return true;
  }
  const [wave, turn] = turnKey().split(":").map(Number);
  const prior = TWO_FACED_LAST_TURN.get(pokemon);
  if (!prior) {
    return true;
  }
  const [priorWave, priorTurn] = prior.split(":").map(Number);
  return wave !== priorWave || turn > priorTurn + 1;
}
export class TwoFacedPowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super(
      (pokemon, _target, move) =>
        move.category !== MoveCategory.STATUS && TWO_FACED_ACTIVE_TURN.get(pokemon) === turnKey(),
      1,
    );
  }
  override apply({ pokemon, move, power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= 1.5;
    if ([PokemonType.ELECTRIC, PokemonType.DARK].includes(pokemon.getMoveType(move))) {
      power.value *= 1.4;
    }
  }
}

export function prepareTwoFacedMove(pokemon: Pokemon, move: Move): void {
  if (move.category !== MoveCategory.STATUS && hasAttr(pokemon, "TwoFacedPowerAbAttr") && twoFacedReady(pokemon)) {
    TWO_FACED_ACTIVE_TURN.set(pokemon, turnKey());
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} unleashed its other face!`);
  }
}

export function finishTwoFacedMove(pokemon: Pokemon, move: Move): void {
  if (move.category !== MoveCategory.STATUS && TWO_FACED_ACTIVE_TURN.get(pokemon) === turnKey()) {
    TWO_FACED_LAST_TURN.set(pokemon, turnKey());
    TWO_FACED_ACTIVE_TURN.delete(pokemon);
  }
}
export class TwoFacedRecoilAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const record = params.pokemon.getLastXMoves(1)[0] as object | undefined;
    return (
      super.canApply(params)
      && params.damage > 0
      && TWO_FACED_ACTIVE_TURN.get(params.pokemon) === turnKey()
      && !!record
      && TWO_FACED_RECOIL_RECORD.get(params.pokemon) !== record
    );
  }
  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    TWO_FACED_RECOIL_RECORD.set(pokemon, pokemon.getLastXMoves(1)[0] as object);
    if (!simulated) {
      pokemon.damageAndUpdate(Math.min(pokemon.hp - 1, Math.floor(pokemon.getMaxHp() * 0.15)), {
        result: HitResult.INDIRECT,
      });
    }
  }
}

interface SetlistState {
  moves: MoveId[];
  expected: MoveId | undefined;
  crescendo: number;
  lastRecord: object | undefined;
}
const SETLIST = new WeakMap<Pokemon, SetlistState>();
function setlistState(pokemon: Pokemon): SetlistState {
  let state = SETLIST.get(pokemon);
  if (!state) {
    state = { moves: [], expected: undefined, crescendo: 0, lastRecord: undefined };
    SETLIST.set(pokemon, state);
  }
  return state;
}
export class SetlistResetAbAttr extends PostSummonAbAttr {
  override apply({ pokemon }: AbAttrBaseParams): void {
    SETLIST.set(pokemon, { moves: [], expected: undefined, crescendo: 0, lastRecord: undefined });
  }
}
export class SetlistTrackAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const record = params.pokemon.getLastXMoves(1)[0] as object | undefined;
    return super.canApply(params) && !!record && setlistState(params.pokemon).lastRecord !== record;
  }
  override apply({ pokemon, move }: PostMoveInteractionAbAttrParams): void {
    const state = setlistState(pokemon);
    state.lastRecord = pokemon.getLastXMoves(1)[0] as object | undefined;
    if (state.moves.length < 2) {
      if (!state.moves.includes(move.id)) {
        state.moves.push(move.id);
      }
      if (state.moves.length === 2) {
        state.expected = state.moves[0];
      }
      return;
    }
    if (!state.moves.includes(move.id) || move.id !== state.expected) {
      state.crescendo = 0;
      state.expected = state.moves[0];
      return;
    }
    state.crescendo = Math.min(2, state.crescendo + 1);
    state.expected = state.moves.find(id => id !== move.id);
  }
}

export function finishSetlistMove(pokemon: Pokemon, move: Move): void {
  if (move.category === MoveCategory.STATUS || isSignatureFollowup(move) || !hasAttr(pokemon, "SetlistPowerAbAttr")) {
    return;
  }
  const state = setlistState(pokemon);
  if (state.moves.length < 2) {
    if (!state.moves.includes(move.id)) {
      state.moves.push(move.id);
      globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Setlist recorded ${move.name}!`);
    }
    if (state.moves.length === 2) {
      state.expected = state.moves[0];
    }
    return;
  }
  if (!state.moves.includes(move.id) || move.id !== state.expected) {
    state.crescendo = 0;
    state.expected = state.moves[0];
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Setlist lost its rhythm!`);
    return;
  }
  state.crescendo = Math.min(2, state.crescendo + 1);
  state.expected = state.moves.find(id => id !== move.id);
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Setlist reached crescendo ${state.crescendo}!`);
}
function setlistNextLevel(pokemon: Pokemon, move: Move): number {
  const state = setlistState(pokemon);
  return state.moves.length === 2 && state.expected === move.id ? Math.min(2, state.crescendo + 1) : 0;
}
export class SetlistPowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super((pokemon, _target, move) => setlistNextLevel(pokemon, move) > 0, 1);
  }
  override apply({ pokemon, move, power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= 1 + setlistNextLevel(pokemon, move) * 0.2;
  }
}
export class SetlistAccuracyAbAttr extends SetMoveAccuracyAbAttr {
  constructor() {
    super([MoveId.NONE], 0);
  }
  override canApply({ pokemon, move, accuracy }: SetMoveAccuracyAbAttrParams): boolean {
    return accuracy.value > 0 && setlistNextLevel(pokemon, move) > 0;
  }
  override apply({ pokemon, move, accuracy }: SetMoveAccuracyAbAttrParams): void {
    accuracy.value *= 1 + setlistNextLevel(pokemon, move) * 0.1;
  }
}

function livingBenchCount(pokemon: Pokemon): number {
  const party = pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
  return Math.min(5, party.filter(member => !member.isFainted() && !member.isOnField()).length);
}
export class FanFavoritePowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super((pokemon, _target, move) => move.category === MoveCategory.SPECIAL && livingBenchCount(pokemon) > 0, 1);
  }
  override apply({ pokemon, power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= 1 + livingBenchCount(pokemon) * 0.05;
  }
}
export class FanFavoriteAccuracyAbAttr extends SetMoveAccuracyAbAttr {
  constructor() {
    super([MoveId.NONE], 0);
  }
  override canApply({ pokemon, accuracy }: SetMoveAccuracyAbAttrParams): boolean {
    return accuracy.value > 0 && livingBenchCount(pokemon) > 0;
  }
  override apply({ pokemon, accuracy }: SetMoveAccuracyAbAttrParams): void {
    accuracy.value *= 1 + livingBenchCount(pokemon) * 0.05;
  }
}

// ---------------------------------------------------------------------------
// Ring General, Deadeye Draw, Center of Attention

const RING_ENTRY_TURN = new WeakMap<Pokemon, string>();
export class RingGeneralEntryAbAttr extends PostSummonAbAttr {
  override apply({ pokemon }: AbAttrBaseParams): void {
    RING_ENTRY_TURN.set(pokemon, turnKey());
  }
}
export class RingGeneralTrapAbAttr extends ArenaTrapAbAttr {
  constructor() {
    super(
      (holder, target) =>
        holder.getHpRatio() > 0.5 && RING_ENTRY_TURN.get(holder) !== turnKey() && !target.isOfType(PokemonType.GHOST),
    );
  }
}

const DEADEYE_MARK = new WeakMap<Pokemon, Pokemon>();
export class DeadeyeMarkAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (
      super.canApply(params)
      && params.damage > 0
      && (params.move.hasFlag(MoveFlags.ARROW_BASED) || params.move.hasFlag(MoveFlags.PULSE_MOVE))
    );
  }
  override apply({ pokemon, opponent }: PostMoveInteractionAbAttrParams): void {
    DEADEYE_MARK.set(pokemon, opponent);
    globalScene.phaseManager.queueMessage(
      `${pokemon.getNameToRender()}'s Deadeye Draw marked ${opponent.getNameToRender()}!`,
    );
  }
}
function deadeyeApplies(user: Pokemon, target: Pokemon | null, move: Move): boolean {
  return !!target && DEADEYE_MARK.get(user) === target && move.hasFlag(MoveFlags.PULSE_MOVE) && target.isOnField();
}
export class DeadeyeCritAbAttr extends ConditionalCritAbAttr {
  constructor() {
    super(deadeyeApplies);
  }
}
export class DeadeyeMarkerAbAttr extends AbAttr {
  override apply(): void {}
}
export function shouldDeadeyeUseLowerDefense(user: Pokemon, target: Pokemon, move: Move): boolean {
  return hasAttr(user, "DeadeyeMarkerAbAttr") && deadeyeApplies(user, target, move);
}
export function clearDeadeyeMarksFor(pokemon: Pokemon): void {
  DEADEYE_MARK.delete(pokemon);
  for (const battler of globalScene.getField(true)) {
    if (DEADEYE_MARK.get(battler) === pokemon) {
      DEADEYE_MARK.delete(battler);
    }
  }
}

export class CenterSpreadReductionAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  constructor() {
    super((_holder, _attacker, move) => move.isMultiTarget(), 0.75);
  }
}
export class CenterOfAttentionAbAttr extends AbAttr {
  override apply(): void {}
}

// ---------------------------------------------------------------------------
// Scripted counters, echoes, pivots, and entry traps.

const SIGNATURE_FOLLOWUPS = new WeakSet<Move>();
const IGNORE_DEFENSE_BOOST_FOLLOWUPS = new WeakSet<Move>();
const SUPPRESS_KO_FOLLOWUPS = new WeakSet<Move>();

function signatureFollowup(
  moveId: MoveId,
  power: number,
  type: PokemonType,
  category: MoveCategory,
  ignoreDefenseBoosts = false,
): PokemonMove {
  const pokemonMove = scriptedPokemonMove(moveId, Math.max(1, Math.floor(power)), { type, category, alwaysHit: true });
  const move = pokemonMove.getMove();
  SIGNATURE_FOLLOWUPS.add(move);
  SUPPRESS_KO_FOLLOWUPS.add(move);
  if (ignoreDefenseBoosts) {
    IGNORE_DEFENSE_BOOST_FOLLOWUPS.add(move);
  }
  return pokemonMove;
}

export function isSignatureFollowup(move: Move): boolean {
  return SIGNATURE_FOLLOWUPS.has(move);
}
export function signatureFollowupIgnoresDefenseBoosts(move: Move): boolean {
  return IGNORE_DEFENSE_BOOST_FOLLOWUPS.has(move);
}
export function signatureFollowupSuppressesKoEffects(move: Move): boolean {
  return SUPPRESS_KO_FOLLOWUPS.has(move);
}

const ECLIPSE_USED_WAVE = new WeakMap<Pokemon, number>();
const ECLIPSE_COUNTER_TARGET = new WeakMap<Pokemon, Pokemon>();

export function tryEclipseWing(defender: Pokemon, source: Pokemon | undefined): boolean {
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  if (
    !source
    || !defender.isFullHp()
    || defender.getMaxHp() <= 1
    || !hasAttr(defender, "EclipseWingMarkerAbAttr")
    || ECLIPSE_USED_WAVE.get(defender) === wave
  ) {
    return false;
  }
  ECLIPSE_USED_WAVE.set(defender, wave);
  ECLIPSE_COUNTER_TARGET.set(defender, source);
  globalScene.phaseManager.queueMessage(`${defender.getNameToRender()}'s Eclipse Wing held it at 1 HP!`);
  globalScene.phaseManager.queueMessage(`${defender.getNameToRender()}'s Eclipse Wing struck back!`);
  globalScene.phaseManager.unshiftNew(
    "ErSignatureFollowupPhase",
    defender,
    source,
    signatureFollowup(MoveId.DARK_PULSE, 120, PokemonType.DARK, MoveCategory.SPECIAL),
  );
  return true;
}

export class EclipseWingTurnEndAbAttr extends PostTurnAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return ECLIPSE_COUNTER_TARGET.get(pokemon)?.isFainted() === true && !pokemon.isFainted();
  }
  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    ECLIPSE_COUNTER_TARGET.delete(pokemon);
    if (!simulated) {
      pokemon.damageAndUpdate(pokemon.hp, { result: HitResult.INDIRECT });
    }
  }
}

const SPIRIT_PUNCH_RECORD = new WeakMap<Pokemon, object>();
export class SpiritPunchAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const record = params.pokemon.getLastXMoves(1)[0] as object | undefined;
    return (
      super.canApply(params)
      && params.damage > 0
      && params.hitResult < HitResult.NO_EFFECT
      && params.move.hasFlag(MoveFlags.PUNCHING_MOVE)
      && params.pokemon.turnData.hitCount <= 1
      && !isSignatureFollowup(params.move)
      && !!record
      && SPIRIT_PUNCH_RECORD.get(params.pokemon) !== record
    );
  }
  override apply({ pokemon, opponent, move, simulated }: PostMoveInteractionAbAttrParams): void {
    SPIRIT_PUNCH_RECORD.set(pokemon, pokemon.getLastXMoves(1)[0] as object);
    if (simulated || opponent.isFainted()) {
      return;
    }
    const multiplier = pokemon.isOfType(PokemonType.GHOST) ? 0.5 : 0.3;
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Spirit Punch echoed!`);
    globalScene.phaseManager.unshiftNew(
      "ErSignatureFollowupPhase",
      pokemon,
      opponent,
      signatureFollowup(move.id, move.power * multiplier, PokemonType.GHOST, move.category, true),
    );
  }
}

interface EncoreState {
  previous?: Move;
  lastRecord?: object;
}
const ENCORE_SET = new WeakMap<Pokemon, EncoreState>();
export class EncoreSetResetAbAttr extends PostSummonAbAttr {
  override apply({ pokemon }: AbAttrBaseParams): void {
    ENCORE_SET.set(pokemon, {});
  }
}
export class EncoreSetAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const state = ENCORE_SET.get(params.pokemon) ?? {};
    const record = params.pokemon.getLastXMoves(1)[0] as object | undefined;
    return (
      super.canApply(params)
      && params.damage > 0
      && !isSignatureFollowup(params.move)
      && !!record
      && state.lastRecord !== record
    );
  }
  override apply({ pokemon, opponent, move, simulated }: PostMoveInteractionAbAttrParams): void {
    const state = ENCORE_SET.get(pokemon) ?? {};
    const prior = state.previous;
    state.lastRecord = pokemon.getLastXMoves(1)[0] as object;
    state.previous = move;
    ENCORE_SET.set(pokemon, state);
    if (simulated || !prior || prior.id === move.id || opponent.isFainted()) {
      return;
    }
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Encore Set replayed ${prior.name}!`);
    globalScene.phaseManager.unshiftNew(
      "ErSignatureFollowupPhase",
      pokemon,
      opponent,
      signatureFollowup(prior.id, prior.power * 0.4, prior.type, prior.category),
    );
  }
}

const SKYHOOK_TURN = new WeakMap<Pokemon, string>();
const SKYHOOK_BOOST_SIDE = new Map<ArenaTagSide, boolean>();
let skyhookBattle: object | undefined;
function ensureSkyhookBattle(): void {
  if (skyhookBattle !== globalScene.currentBattle) {
    SKYHOOK_BOOST_SIDE.clear();
    skyhookBattle = globalScene.currentBattle;
  }
}
const SKYHOOK_SWITCH = new ForceSwitchOutHelper(SwitchType.SWITCH);
export class SkyhookAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (
      super.canApply(params)
      && params.damage > 0
      && params.pokemon.turnData.hitsLeft <= 1
      && SKYHOOK_TURN.get(params.pokemon) !== turnKey()
      && params.pokemon.getOpponents().every(opponent => SKYHOOK_SWITCH.getSwitchOutCondition(params.pokemon, opponent))
    );
  }
  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    SKYHOOK_TURN.set(pokemon, turnKey());
    if (simulated) {
      return;
    }
    ensureSkyhookBattle();
    SKYHOOK_BOOST_SIDE.set(ownSide(pokemon), pokemon.randBattleSeedInt(100) < 20);
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Skyhook pulled it back!`);
    SKYHOOK_SWITCH.switchOutLogic(pokemon);
  }
}

export function applyPendingSkyhookEntryBoost(pokemon: Pokemon): void {
  ensureSkyhookBattle();
  const side = ownSide(pokemon);
  const boost = SKYHOOK_BOOST_SIDE.get(side);
  SKYHOOK_BOOST_SIDE.delete(side);
  if (boost) {
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), true, [Stat.SPD], 1);
  }
}

interface GraveMarkerState {
  source: Pokemon;
  side: ArenaTagSide;
}
const GRAVE_MARKERS = new Map<ArenaTagSide, GraveMarkerState>();
let graveMarkerBattle: object | undefined;
function ensureGraveMarkerBattle(): void {
  if (graveMarkerBattle !== globalScene.currentBattle) {
    GRAVE_MARKERS.clear();
    graveMarkerBattle = globalScene.currentBattle;
  }
}
export class BootHillAbAttr extends PostAttackAbAttr {
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return (
      super.canApply(params) && params.damage > 0 && params.opponent.isFainted() && !isSignatureFollowup(params.move)
    );
  }
  override apply({ pokemon }: PostMoveInteractionAbAttrParams): void {
    ensureGraveMarkerBattle();
    const side = foeSide(pokemon);
    GRAVE_MARKERS.set(side, { source: pokemon, side });
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} planted a Grave Marker!`);
  }
}
export function applyGraveMarkerOnEntry(pokemon: Pokemon): void {
  ensureGraveMarkerBattle();
  const side = ownSide(pokemon);
  const marker = GRAVE_MARKERS.get(side);
  if (!marker) {
    return;
  }
  const { source } = marker;
  GRAVE_MARKERS.delete(side);
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} was struck by the Grave Marker!`);
  const damage = Math.max(1, Math.floor(pokemon.getMaxHp() / 8));
  pokemon.damageAndUpdate(damage, { result: HitResult.INDIRECT, source });
  if (!pokemon.isFainted()) {
    pokemon.setStatStage(Stat.SPD, Math.max(-6, pokemon.getStatStage(Stat.SPD) - 1));
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Speed fell!`);
  }
}

// ---------------------------------------------------------------------------
// Reduction, Cracked Vessel, Living Chrome, and Superego engine hooks.

function weatherType(weather: WeatherType): PokemonType | undefined {
  switch (weather) {
    case WeatherType.SUNNY:
    case WeatherType.HARSH_SUN:
      return PokemonType.FIRE;
    case WeatherType.RAIN:
    case WeatherType.HEAVY_RAIN:
      return PokemonType.WATER;
    case WeatherType.SANDSTORM:
      return PokemonType.ROCK;
    case WeatherType.HAIL:
    case WeatherType.SNOW:
      return PokemonType.ICE;
    case WeatherType.FOG:
    case WeatherType.EERIE_FOG:
      return PokemonType.GHOST;
    default:
      return;
  }
}
function terrainType(terrain: TerrainType): PokemonType | undefined {
  switch (terrain) {
    case TerrainType.ELECTRIC:
      return PokemonType.ELECTRIC;
    case TerrainType.GRASSY:
      return PokemonType.GRASS;
    case TerrainType.MISTY:
      return PokemonType.FAIRY;
    case TerrainType.PSYCHIC:
      return PokemonType.PSYCHIC;
    case TerrainType.TOXIC:
      return PokemonType.POISON;
    default:
      return;
  }
}
interface ReductionState {
  move: Move;
  turn: string;
}
const REDUCTION_ACTIVE = new WeakMap<Pokemon, ReductionState>();
export function prepareReductionMove(pokemon: Pokemon, move: Move): void {
  if (move.category === MoveCategory.STATUS || !hasAttr(pokemon, "ReductionPowerAbAttr")) {
    return;
  }
  const second = reductionSecondaryType();
  if (second === undefined) {
    return;
  }
  REDUCTION_ACTIVE.set(pokemon, { move, turn: turnKey() });
  primeDualTypeMove(pokemon, pokemon.getMoveType(move), second, false);
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Reduction consumed the field!`);
  if (terrainType(globalScene.arena.terrainType) !== undefined) {
    globalScene.arena.trySetTerrain(TerrainType.NONE, false, pokemon);
  }
  const weather = globalScene.arena.weatherType;
  if (
    ![WeatherType.HARSH_SUN, WeatherType.HEAVY_RAIN, WeatherType.STRONG_WINDS].includes(weather)
    && weatherType(weather) !== undefined
  ) {
    globalScene.arena.trySetWeather(WeatherType.NONE, pokemon);
  }
}
export function finishReductionMove(pokemon: Pokemon, move: Move): void {
  if (REDUCTION_ACTIVE.get(pokemon)?.move === move) {
    REDUCTION_ACTIVE.delete(pokemon);
  }
}
export class ReductionPowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super((pokemon, _target, move) => {
      const state = REDUCTION_ACTIVE.get(pokemon);
      return state?.move === move && state.turn === turnKey();
    }, 1.5);
  }
}
function reductionSecondaryType(): PokemonType | undefined {
  return terrainType(globalScene.arena.terrainType) ?? weatherType(globalScene.arena.weatherType);
}

const CRACKED_USED_WAVE = new WeakMap<Pokemon, number>();
const CRACKED_TYPES = new WeakMap<Pokemon, PokemonType[]>();
export function tryCrackedVessel(defender: Pokemon, source: Pokemon | undefined): boolean {
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  if (!source || !hasAttr(defender, "CrackedVesselMarkerAbAttr") || CRACKED_USED_WAVE.get(defender) === wave) {
    return false;
  }
  CRACKED_USED_WAVE.set(defender, wave);
  const kept = defender.getTypes().slice(0, -1);
  const liveTypes = kept.length > 0 ? kept : [PokemonType.UNKNOWN];
  CRACKED_TYPES.set(defender, liveTypes);
  defender.summonData.types = [...liveTypes];
  defender.updateInfo();
  globalScene.phaseManager.queueMessage(`${defender.getNameToRender()}'s Cracked Vessel shattered!`);
  globalScene.arena.trySetWeather(WeatherType.EERIE_FOG, defender, 4);
  for (const adjacent of [...defender.getAdjacentAllies(), ...defender.getAdjacentOpponents()]) {
    adjacent.trySetStatus(StatusEffect.TOXIC, defender, undefined, null, false, false);
  }
  return true;
}
export class CrackedVesselRestoreTypesAbAttr extends PostSummonAbAttr {
  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return CRACKED_TYPES.has(pokemon);
  }
  override apply({ pokemon }: AbAttrBaseParams): void {
    pokemon.summonData.types = [...CRACKED_TYPES.get(pokemon)!];
    pokemon.updateInfo();
  }
}

interface ShapeMemory {
  wave: number;
  count: number;
  types: PokemonType[];
  flat: boolean;
  expires: number;
}
const SHAPE_MEMORY = new WeakMap<Pokemon, ShapeMemory>();
export function recordLivingChromeTransformation(
  pokemon: Pokemon,
  previousTypes: PokemonType[],
  previousFormIndex: number,
): void {
  if (!hasAttr(pokemon, "LivingChromeMarkerAbAttr")) {
    return;
  }
  const wave = globalScene.currentBattle?.waveIndex ?? 0;
  const prior = SHAPE_MEMORY.get(pokemon);
  const count = prior?.wave === wave ? prior.count : 0;
  if (count >= 3) {
    return;
  }
  SHAPE_MEMORY.set(pokemon, {
    wave,
    count: count + 1,
    types: [...new Set(previousTypes)].slice(0, 2),
    flat: pokemon.species.speciesId === SpeciesId.EEVEE && previousFormIndex === 0,
    expires: globalScene.currentBattle?.turn ?? 0,
  });
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} retained a Shape Memory!`);
}
export class LivingChromeReductionAbAttr extends ReceivedMoveDamageMultiplierAbAttr {
  constructor() {
    super((holder, attacker, move) => {
      const state = SHAPE_MEMORY.get(holder);
      if (
        !state
        || state.wave !== (globalScene.currentBattle?.waveIndex ?? 0)
        || state.expires !== (globalScene.currentBattle?.turn ?? 0)
      ) {
        return false;
      }
      return state.flat || state.types.includes(attacker.getMoveType(move));
    }, 0.5);
  }
  override apply(params: PreDefendModifyDamageAbAttrParams): void {
    const state = SHAPE_MEMORY.get(params.pokemon);
    params.damage.value = Math.floor(params.damage.value * (state?.flat ? 0.75 : 0.5));
  }
}

const SUPEREGO_TURN = new WeakMap<Pokemon, Map<BattleStat, string>>();
export function applySuperegoAfterBoost(boosted: Pokemon, stat: BattleStat, canBeCopied: boolean): void {
  // Egoist/Opportunist copies are queued as non-copyable. Superego must not
  // react to that derived boost, but ordinary self-boosts by an Egoist holder
  // remain valid targets.
  if (!canBeCopied) {
    return;
  }
  for (const holder of boosted.getOpponents()) {
    if (!hasAttr(holder, "SuperegoMarkerAbAttr")) {
      continue;
    }
    const prior = holder.getStatStage(stat);
    const raised = boosted.getStatStage(stat);
    if (raised <= prior) {
      continue;
    }
    let used = SUPEREGO_TURN.get(holder);
    if (!used) {
      used = new Map();
      SUPEREGO_TURN.set(holder, used);
    }
    if (used.get(stat) === turnKey()) {
      continue;
    }
    used.set(stat, turnKey());
    holder.setStatStage(stat, raised);
    boosted.setStatStage(stat, prior);
    globalScene.phaseManager.queueMessage(`${holder.getNameToRender()}'s Superego seized the boost!`);
  }
}

export function applyVaporBodyAccuracy(user: Pokemon, target: Pokemon, move: Move, accuracy: NumberHolder): void {
  if (
    accuracy.value > 0
    && hasAttr(target, "VaporBodyAccuracyAbAttr")
    && move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target })
  ) {
    accuracy.value *= 0.7;
  }
}

const TRAPPING_TAGS = [
  BattlerTagType.TRAPPED,
  BattlerTagType.BIND,
  BattlerTagType.WRAP,
  BattlerTagType.FIRE_SPIN,
  BattlerTagType.WHIRLPOOL,
  BattlerTagType.CLAMP,
  BattlerTagType.SAND_TOMB,
  BattlerTagType.MAGMA_STORM,
  BattlerTagType.SNAP_TRAP,
  BattlerTagType.THUNDER_CAGE,
  BattlerTagType.INFESTATION,
] as const;
export function hasEffectiveMoveTrap(pokemon: Pokemon): boolean {
  const tags = pokemon.findTags(candidate =>
    TRAPPING_TAGS.includes(candidate.tagType as (typeof TRAPPING_TAGS)[number]),
  );
  return tags.some(tag => {
    if (!hasAttr(pokemon, "VaporBodyAccuracyAbAttr") || !tag.sourceMove) {
      return true;
    }
    return !allMoves[tag.sourceMove]?.hasFlag(MoveFlags.MAKES_CONTACT);
  });
}

export function applyCenterOfAttentionPenalty(attacker: Pokemon, target: Pokemon, move: Move, damage: number): void {
  if (damage <= 0 || move.category === MoveCategory.STATUS || hasAttr(target, "CenterOfAttentionAbAttr")) {
    return;
  }
  const record = attacker.getLastXMoves(1)[0];
  const protectingAlly = target.getAllies().find(ally => hasAttr(ally, "CenterOfAttentionAbAttr"));
  if (
    protectingAlly
    && !record?.targets.includes(protectingAlly.getBattlerIndex())
    && (!record || CENTER_PENALTY_RECORD.get(attacker) !== record)
  ) {
    if (record) {
      CENTER_PENALTY_RECORD.set(attacker, record);
    }
    globalScene.phaseManager.queueMessage(`${protectingAlly.getNameToRender()} drew the attacker's attention!`);
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", attacker.getBattlerIndex(), false, [Stat.SPATK], -1);
  }
}
const CENTER_PENALTY_RECORD = new WeakMap<Pokemon, object>();

export function notifySignatureHazardRemoval(user: Pokemon, removed: number): void {
  const side = ownSide(user);
  const removedBloom = BLOOMS.delete(side);
  if (removed > 0 || removedBloom) {
    notifyHazardRemovedBy(user);
  }
}

// ---------------------------------------------------------------------------
// Marker attrs and wiring.

export class EclipseWingPowerAbAttr extends MovePowerBoostAbAttr {
  constructor() {
    super(
      (pokemon, _target, move) =>
        pokemon.getHpRatio() < 1 / 3 && [PokemonType.DARK, PokemonType.FLYING].includes(pokemon.getMoveType(move)),
      1.5,
    );
  }
}
export class EclipseWingMarkerAbAttr extends AbAttr {
  override apply(): void {}
}
export class LivingChromeMarkerAbAttr extends AbAttr {
  override apply(): void {}
}
export class CrackedVesselMarkerAbAttr extends AbAttr {
  override apply(): void {}
}
export class SuperegoMarkerAbAttr extends AbAttr {
  override apply(): void {}
}

export function wireNewcomerSignatureAbility(
  builder: {
    attr: (cls: any, ...args: any[]) => unknown;
    attrs: AbAttr[];
    unsuppressable(): any;
    uncopiable(): any;
    unreplaceable(): any;
  },
  id: number,
): void {
  switch (id) {
    case ER_ECLIPSE_WING_ABILITY_ID:
      builder.attr(EclipseWingPowerAbAttr);
      builder.attr(EclipseWingTurnEndAbAttr);
      builder.attr(EclipseWingMarkerAbAttr);
      break;
    case ER_FINAL_SEASON_ABILITY_ID:
      builder.attr(FinalSeasonEntryAbAttr);
      builder.attr(FinalSeasonFogAbAttr);
      builder.attr(FinalSeasonPowerAbAttr);
      break;
    case ER_FOUL_HARVEST_ABILITY_ID:
      builder.attr(FoulHarvestAbAttr);
      break;
    case ER_POROUS_ABILITY_ID:
      builder.attr(PorousResetAbAttr);
      builder.attr(PorousSoundReductionAbAttr);
      builder.attr(PorousChargeAbAttr);
      builder.attr(PorousPowerAbAttr);
      break;
    case ER_GLAM_ROCK_ABILITY_ID:
      builder.attr(ForceSwitchOutImmunityAbAttr);
      builder.attr(GlamRockAbAttr);
      break;
    case ER_SEDIMENT_BLOOM_ABILITY_ID:
      builder.attr(SedimentBloomMarkerAbAttr);
      break;
    case ER_TWO_FACED_UNLEASHED_ABILITY_ID:
      builder.attr(TwoFacedPowerAbAttr);
      builder.attr(TwoFacedRecoilAbAttr);
      builder.unsuppressable().uncopiable().unreplaceable();
      break;
    case ER_SKYHOOK_ABILITY_ID:
      builder.attr(SkyhookAbAttr);
      break;
    case ER_ANNEAL_ABILITY_ID:
      builder.attr(AnnealResetAbAttr);
      builder.attr(AnnealAbAttr);
      break;
    case ER_LIVING_CHROME_ABILITY_ID:
      builder.attr(LivingChromeMarkerAbAttr);
      builder.attr(LivingChromeReductionAbAttr);
      break;
    case ER_VAPOR_BODY_ABILITY_ID:
      builder.attr(VaporBodyAccuracyAbAttr);
      break;
    case ER_HEAVYWEIGHT_ABILITY_ID:
      builder.attr(HeavyweightPowerAbAttr);
      builder.attr(HeavyweightDropAbAttr);
      break;
    case ER_SPIRIT_PUNCH_ABILITY_ID:
      builder.attr(SpiritPunchAbAttr);
      break;
    case ER_DEADEYE_DRAW_ABILITY_ID:
      builder.attr(DeadeyeMarkAbAttr);
      builder.attr(DeadeyeCritAbAttr);
      builder.attr(DeadeyeMarkerAbAttr);
      break;
    case ER_BOOT_HILL_ABILITY_ID:
      builder.attr(BootHillAbAttr);
      break;
    case ER_GILLIE_SUIT_ABILITY_ID:
      builder.attrs.push(
        ...(allAbilities[ErAbilityId.PREDATOR]?.attrs ?? []),
        ...(allAbilities[AbilityId.PROTEAN]?.attrs ?? []),
      );
      break;
    case ER_RING_GENERAL_ABILITY_ID:
      builder.attr(RingGeneralEntryAbAttr);
      builder.attr(RingGeneralTrapAbAttr);
      break;
    case ER_ENCORE_SET_ABILITY_ID:
      builder.attr(EncoreSetResetAbAttr);
      builder.attr(EncoreSetAbAttr);
      break;
    case ER_SETLIST_ABILITY_ID:
      builder.attr(SetlistResetAbAttr);
      builder.attr(SetlistPowerAbAttr);
      builder.attr(SetlistAccuracyAbAttr);
      break;
    case ER_FAN_FAVORITE_ABILITY_ID:
      builder.attr(FanFavoritePowerAbAttr);
      builder.attr(FanFavoriteAccuracyAbAttr);
      break;
    case ER_REDUCTION_ABILITY_ID:
      builder.attr(ReductionPowerAbAttr);
      break;
    case ER_CRACKED_VESSEL_ABILITY_ID:
      builder.attr(CrackedVesselMarkerAbAttr);
      builder.attr(CrackedVesselRestoreTypesAbAttr);
      break;
    case ER_CENTER_OF_ATTENTION_ABILITY_ID:
      builder.attr(CenterSpreadReductionAbAttr);
      builder.attr(CenterOfAttentionAbAttr);
      break;
    case ER_SUPEREGO_ABILITY_ID:
      builder.attr(SuperegoMarkerAbAttr);
      break;
    case ER_METEOR_MASS_ABILITY_ID:
      // Weight-centric signature (Metagross Battle Bond innate). Tripling the holder's
      // weight (via getWeight -> WeightMultiplierAbAttr) both maxes its own Heavy Slam /
      // Heat Crash weight RATIO and makes incoming Grass Knot / Low Kick read the huge
      // weight; HeavyweightPowerAbAttr adds the flat weight-class power boost for Heavy
      // Slam / Heat Crash / punching moves (its signature Meteor Mash reads as a meteor).
      builder.attr(WeightMultiplierAbAttr, METEOR_MASS_WEIGHT_MULTIPLIER);
      builder.attr(HeavyweightPowerAbAttr);
      break;
    case ER_INVERSE_ROOM_ABILITY_ID:
      // On entry, auto-set the SAME Inverse Room field effect the MOVE "Inverse Room"
      // (id 844) sets — the Drought pattern, reusing InverseRoomTag as the one source of
      // truth for the reversed type chart (5 turns, field-wide). Room-overlap semantics
      // are faithful: re-entering while its own room is still up toggles it off.
      builder.attr(PostSummonAddArenaTagAbAttr, true, ArenaTagType.INVERSE_ROOM, INVERSE_ROOM_TURNS);
      break;
  }
}
