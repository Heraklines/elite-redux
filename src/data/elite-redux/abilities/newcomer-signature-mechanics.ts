/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  AbAttr,
  ArenaTrapAbAttr,
  type CheckTrappedAbAttrParams,
  ConditionalCritAbAttr,
  type ConditionalCritAbAttrParams,
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
import { type GatedAttr, gatedCanApply } from "#data/elite-redux/ability-studio/gate-residual";
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

export class FinalSeasonEntryAbAttr extends PostSummonAbAttr implements GatedAttr<AbAttrBaseParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  /** The battle effect every foe receives (ability studio param; the default is the original ER_QUASHED). */
  public readonly quashTag: BattlerTagType;
  /** How many turns the battle effect lasts (ability studio param; the default is the original 2). */
  public readonly quashTurns: number;

  constructor(quashTag: BattlerTagType = BattlerTagType.ER_QUASHED, quashTurns = 2) {
    super();
    this.quashTag = quashTag;
    this.quashTurns = quashTurns;
  }

  /** Tier B (ability studio spec 3.1): the one clause of the rule lives in `gate`; there is no residual. */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  /** The replaceable condition: this Pokemon came in through a deliberate switch (see markGenuineVoluntaryEntry). */
  public gate({ pokemon }: AbAttrBaseParams): boolean {
    return VOLUNTARY_ENTRY.has(pokemon);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    VOLUNTARY_ENTRY.delete(pokemon);
    if (simulated) {
      return;
    }
    for (const opponent of pokemon.getOpponents()) {
      opponent.addTag(this.quashTag, this.quashTurns, MoveId.NONE, pokemon.id);
    }
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Final Season delayed the opposing side!`);
    FINAL_SEASON_PENDING_FOG.add(pokemon);
  }
}

export class FinalSeasonFogAbAttr extends PostTurnAbAttr implements GatedAttr<AbAttrBaseParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  /** The weather that is set (ability studio param; the default is the original Eerie Fog). */
  public readonly fogWeather: WeatherType;
  /** How many turns the weather lasts (ability studio param; the default is the original 5). */
  public readonly fogTurns: number;

  constructor(fogWeather: WeatherType = WeatherType.EERIE_FOG, fogTurns = 5) {
    super();
    this.fogWeather = fogWeather;
    this.fogTurns = fogTurns;
  }

  /** Tier B (ability studio spec 3.1): the one clause of the rule lives in `gate`; there is no residual. */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  /** The replaceable condition: the entry effect armed the fog for this turn's end. */
  public gate({ pokemon }: AbAttrBaseParams): boolean {
    return FINAL_SEASON_PENDING_FOG.has(pokemon);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    FINAL_SEASON_PENDING_FOG.delete(pokemon);
    if (!simulated && globalScene.arena.trySetWeather(this.fogWeather, pokemon, this.fogTurns)) {
      finalSeasonFogOwner = pokemon;
      finalSeasonFogInstance = globalScene.arena.weather ?? undefined;
    }
  }
}

/** The Eerie Fog on the field is the very one this Pokemon's Final Season set (not another source's fog). */
function finalSeasonFogIsMine(pokemon: Pokemon): boolean {
  return finalSeasonFogOwner === pokemon && finalSeasonFogInstance === globalScene.arena.weather;
}

/** Eerie Fog is the active weather and the move is Dark or Flying. */
function finalSeasonBoostedMoveInFog(pokemon: Pokemon, move: Move): boolean {
  return (
    globalScene.arena.weatherType === WeatherType.EERIE_FOG
    && [PokemonType.DARK, PokemonType.FLYING].includes(pokemon.getMoveType(move))
  );
}

export class FinalSeasonPowerAbAttr
  extends MovePowerBoostAbAttr
  implements GatedAttr<PreAttackModifyPowerAbAttrParams>
{
  constructor(powerMultiplier = 1.3) {
    super(
      (pokemon, _target, move) => finalSeasonFogIsMine(pokemon) && finalSeasonBoostedMoveInFog(pokemon, move),
      powerMultiplier,
    );
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreAttackModifyPowerAbAttrParams) => boolean) | undefined;

  /**
   * Tier B (ability studio spec 3.1): the clause order of the original closure is kept. `guards` holds the first two
   * clauses (the fog is my own: private memory, no library condition yet), `gate` the last two (the weather and the
   * move types, both library conditions).
   */
  override canApply(params: PreAttackModifyPowerAbAttrParams): boolean {
    return gatedCanApply<PreAttackModifyPowerAbAttrParams>(this, params);
  }

  public guards({ pokemon }: PreAttackModifyPowerAbAttrParams): boolean {
    return finalSeasonFogIsMine(pokemon);
  }

  public gate({ pokemon, move }: PreAttackModifyPowerAbAttrParams): boolean {
    return finalSeasonBoostedMoveInFog(pokemon, move);
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

export class FoulHarvestAbAttr extends PostAttackAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /** PP taken from the foe's move per hit (ability studio param; the default is the original 1). */
  public readonly ppDrain: number;
  /** The most charges that can be stored (ability studio param; the default is the original 3). */
  public readonly maxCharges: number;

  /**
   * The first two arguments are the base class's (attack condition, show ability); both stay `undefined` for every
   * shipped user so the base defaults apply, exactly as when this class had no constructor.
   */
  constructor(
    attackCondition?: ConstructorParameters<typeof PostAttackAbAttr>[0],
    showAbility?: boolean,
    ppDrain = 1,
    maxCharges = 3,
  ) {
    super(attackCondition, showAbility);
    this.ppDrain = ppDrain;
    this.maxCharges = maxCharges;
  }

  /** Tier B (ability studio spec 3.1): attack condition first (`guards`), then the replaceable `gate`. */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /**
   * The first clause of the original: the base class's attack condition (constructor argument 0, a library condition
   * through the "ctor:0" binding). It stays first, as before.
   */
  public guards(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params);
  }

  /** The remaining clauses, in the original order: damage was dealt, the hit was not blocked, a new move of mine. */
  public gate(params: PostMoveInteractionAbAttrParams): boolean {
    if (params.damage <= 0 || params.hitResult >= HitResult.NO_EFFECT) {
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
    selected.ppUsed = Math.min(selected.ppUsed + this.ppDrain, selected.getMovePp());
    state.charges = Math.min(this.maxCharges, state.charges + 1);
    globalScene.phaseManager.queueMessage(
      `${opponent.getNameToRender()}'s ${selected.getName()} lost ${this.ppDrain} PP!`,
    );
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

/** The incoming move is sound-based (from the attacker's point of view). */
function porousIsSoundMove(attacker: Pokemon, move: Move): boolean {
  return move.doesFlagEffectApply({ flag: MoveFlags.SOUND_BASED, user: attacker });
}

export class PorousSoundReductionAbAttr
  extends ReceivedMoveDamageMultiplierAbAttr
  implements GatedAttr<PreDefendModifyDamageAbAttrParams>
{
  constructor(damageMultiplier = 0.5) {
    super((_holder, attacker, move) => porousIsSoundMove(attacker, move), damageMultiplier);
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreDefendModifyDamageAbAttrParams) => boolean) | undefined;

  /** Tier B (ability studio spec 3.1): the one clause of the rule lives in `gate`; there is no residual. */
  override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    return gatedCanApply<PreDefendModifyDamageAbAttrParams>(this, params);
  }

  public gate({ opponent, move }: PreDefendModifyDamageAbAttrParams): boolean {
    return porousIsSoundMove(opponent, move);
  }
}

export class PorousChargeAbAttr extends PostDefendAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /** The most charges that can be stored (ability studio param; the default is the original 3). */
  public readonly maxCharges: number;

  constructor(maxCharges = 3) {
    super();
    this.maxCharges = maxCharges;
  }

  /** Tier B (ability studio spec 3.1): the whole rule lives in `gate`; there is no residual. */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  /** In the original order: damage was dealt, the hit was not blocked, and it is a move not yet counted. */
  public gate({ pokemon, opponent, damage, hitResult }: PostMoveInteractionAbAttrParams): boolean {
    const record = opponent.getLastXMoves(1)[0] as object | undefined;
    return damage > 0 && hitResult < HitResult.NO_EFFECT && porousState(pokemon).lastMoveRecord !== record;
  }
  override apply({ pokemon, opponent }: PostMoveInteractionAbAttrParams): void {
    const state = porousState(pokemon);
    state.lastMoveRecord = opponent.getLastXMoves(1)[0] as object | undefined;
    state.stacks = Math.min(this.maxCharges, state.stacks + 1);
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Porous body stored the impact!`);
  }
}

/** The move this Pokemon uses is a Ground move. */
function porousIsGroundMove(pokemon: Pokemon, move: Move): boolean {
  return pokemon.getMoveType(move) === PokemonType.GROUND;
}

/** This Pokemon has at least one stored Porous charge. */
function porousHasCharge(pokemon: Pokemon): boolean {
  return porousState(pokemon).stacks > 0;
}

export class PorousPowerAbAttr extends MovePowerBoostAbAttr implements GatedAttr<PreAttackModifyPowerAbAttrParams> {
  /** Extra power per stored charge, in percent (ability studio param; the default is the original 25). */
  public readonly percentPerCharge: number;

  constructor(percentPerCharge = 25) {
    super((pokemon, _target, move) => porousIsGroundMove(pokemon, move) && porousHasCharge(pokemon), 1);
    this.percentPerCharge = percentPerCharge;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreAttackModifyPowerAbAttrParams) => boolean) | undefined;

  /**
   * Tier B (ability studio spec 3.1), original clause order: `gate` is the move type (a library condition), `residual`
   * is "has a stored charge" (private memory, no library condition yet), which must stay second.
   */
  override canApply(params: PreAttackModifyPowerAbAttrParams): boolean {
    return gatedCanApply<PreAttackModifyPowerAbAttrParams>(this, params);
  }

  public gate({ pokemon, move }: PreAttackModifyPowerAbAttrParams): boolean {
    return porousIsGroundMove(pokemon, move);
  }

  public residual({ pokemon }: PreAttackModifyPowerAbAttrParams): boolean {
    return porousHasCharge(pokemon);
  }

  override apply({ pokemon, power, simulated }: PreAttackModifyPowerAbAttrParams): void {
    const state = porousState(pokemon);
    power.value *= 1 + (this.percentPerCharge / 100) * state.stacks;
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
/** How many stat raises this Pokemon has gained since it came in (Anneal's private counter). */
export function annealGainedCount(pokemon: Pokemon): number {
  return ANNEAL.get(pokemon)?.gained ?? 0;
}

export class AnnealAbAttr extends PostDefendAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /** The most raises I can gain per switch-in (ability studio param; the default is the original 2). */
  public readonly maxTriggers: number;
  /** Stages gained per raise (ability studio param; the default is the original 1). */
  public readonly stages: number;
  /** The stat raised after a physical move (ability studio param; the default is the original Defense). */
  public readonly physicalStat: BattleStat;
  /** The stat raised after any other damaging move (ability studio param; the default is the original Sp. Def). */
  public readonly specialStat: BattleStat;

  constructor(maxTriggers = 2, stages = 1, physicalStat: BattleStat = Stat.DEF, specialStat: BattleStat = Stat.SPDEF) {
    super();
    this.maxTriggers = maxTriggers;
    this.stages = stages;
    this.physicalStat = physicalStat;
    this.specialStat = specialStat;
  }

  /**
   * Tier B (ability studio spec 3.1), original clause order: `guards` (the hit really damaged me and was not blocked),
   * `gate` (the move was resisted but not immune: the two effectiveness clauses, library conditions) and `residual`
   * (my raise counter is below the cap and this is a move not counted yet: private memory). All clauses are pure.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  public guards({ damage, hitResult }: PostMoveInteractionAbAttrParams): boolean {
    return damage > 0 && hitResult < HitResult.NO_EFFECT;
  }

  public gate({ pokemon, opponent, move }: PostMoveInteractionAbAttrParams): boolean {
    return pokemon.getMoveEffectiveness(opponent, move) <= 0.5 && pokemon.getMoveEffectiveness(opponent, move) > 0;
  }

  public residual({ pokemon, opponent }: PostMoveInteractionAbAttrParams): boolean {
    const state = ANNEAL.get(pokemon) ?? { gained: 0, lastMoveRecord: undefined };
    return (
      state.gained < this.maxTriggers && state.lastMoveRecord !== (opponent.getLastXMoves(1)[0] as object | undefined)
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
        [move.category === MoveCategory.PHYSICAL ? this.physicalStat : this.specialStat],
        this.stages,
      );
    }
  }
}

export class VaporBodyAccuracyAbAttr extends AbAttr {
  /** Which incoming moves are slowed: (holder, attacker, move). Default: the move makes contact. */
  public readonly condition: (holder: Pokemon, attacker: Pokemon, move: Move) => boolean;
  /** Accuracy multiplier for those moves (ability studio param; the default is the original 0.7). */
  public readonly accuracyMultiplier: number;

  constructor(
    condition: (holder: Pokemon, attacker: Pokemon, move: Move) => boolean = (holder, attacker, move) =>
      move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: holder }),
    accuracyMultiplier = 0.7,
  ) {
    super();
    this.condition = condition;
    this.accuracyMultiplier = accuracyMultiplier;
  }

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
function heavyweightMultiplier(user: Pokemon, target: Pokemon, percentPerClass = 10, maxClasses = 5): number {
  return (
    1
    + Math.min(maxClasses, Math.max(0, weightClass(user.getWeight()) - weightClass(target.getWeight())))
      * (percentPerClass / 100)
  );
}
export class HeavyweightPowerAbAttr
  extends MovePowerBoostAbAttr
  implements GatedAttr<PreAttackModifyPowerAbAttrParams>
{
  /** Extra power per weight class above the target, in percent (ability studio param; the default is the original 10). */
  public readonly percentPerClass: number;
  /** The most weight classes that count (ability studio param; the default is the original 5). */
  public readonly maxClasses: number;

  constructor(percentPerClass = 10, maxClasses = 5) {
    super((_user, _target, move) => isHeavyweightMove(move), 1);
    this.percentPerClass = percentPerClass;
    this.maxClasses = maxClasses;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreAttackModifyPowerAbAttrParams) => boolean) | undefined;

  /** Tier B (ability studio spec 3.1): the one clause of the original closure lives in `gate`; there is no residual. */
  override canApply(params: PreAttackModifyPowerAbAttrParams): boolean {
    return gatedCanApply<PreAttackModifyPowerAbAttrParams>(this, params);
  }

  /** The replaceable condition: Heavy Slam, Heat Crash or a punching move. */
  public gate({ move }: PreAttackModifyPowerAbAttrParams): boolean {
    return isHeavyweightMove(move);
  }

  override apply({ pokemon, opponent, power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= heavyweightMultiplier(pokemon, opponent, this.percentPerClass, this.maxClasses);
  }
}
const HEAVYWEIGHT_DROP_TURN = new WeakMap<Pokemon, string>();
export class HeavyweightDropAbAttr extends PostAttackAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /** The stat lowered on the target (ability studio param; the default is the original Defense). */
  public readonly dropStat: BattleStat;
  /** The stage change (ability studio param; the default is the original -1). */
  public readonly dropStages: number;

  /**
   * The first two arguments are the base class's (attack condition, show ability); both stay `undefined` for every
   * shipped user so the base defaults apply, exactly as when this class had no constructor.
   */
  constructor(
    attackCondition?: ConstructorParameters<typeof PostAttackAbAttr>[0],
    showAbility?: boolean,
    dropStat: BattleStat = Stat.DEF,
    dropStages = -1,
  ) {
    super(attackCondition, showAbility);
    this.dropStat = dropStat;
    this.dropStages = dropStages;
  }

  /**
   * Tier B (ability studio spec 3.1), original clause order: `guards` = the base attack condition (a library condition
   * through the "ctor:0" binding) and "damage was dealt", `gate` = the move is a heavyweight move (library
   * conditions), `residual` = not yet used this turn (private memory). All clauses are pure.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  public guards(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params) && params.damage > 0;
  }

  public gate({ move }: PostMoveInteractionAbAttrParams): boolean {
    return isHeavyweightMove(move);
  }

  public residual({ pokemon }: PostMoveInteractionAbAttrParams): boolean {
    return HEAVYWEIGHT_DROP_TURN.get(pokemon) !== turnKey();
  }

  override apply({ pokemon, opponent, simulated }: PostMoveInteractionAbAttrParams): void {
    HEAVYWEIGHT_DROP_TURN.set(pokemon, turnKey());
    if (!simulated) {
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        opponent.getBattlerIndex(),
        false,
        [this.dropStat],
        this.dropStages,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Glam Rock and Sediment Bloom

export class GlamRockAbAttr extends PostTurnAbAttr implements GatedAttr<AbAttrBaseParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  /** Layers removed from the hazard each turn (ability studio param; the default is the original 1). */
  public readonly layersRemoved: number;
  /** Stages gained by Defense and Sp. Def (ability studio param; the default is the original 1). */
  public readonly stages: number;
  /** The two stats that are raised (ability studio params; the defaults are the original Defense and Sp. Def). */
  public readonly firstStat: Stat;
  public readonly secondStat: Stat;

  constructor(layersRemoved = 1, stages = 1, firstStat: Stat = Stat.DEF, secondStat: Stat = Stat.SPDEF) {
    super();
    this.layersRemoved = layersRemoved;
    this.stages = stages;
    this.firstStat = firstStat;
    this.secondStat = secondStat;
  }

  /** Tier B (ability studio spec 3.1): the one clause of the rule lives in `gate`; there is no residual. */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  /** The replaceable condition: at least one entry hazard is on my side of the field. */
  public gate({ pokemon }: AbAttrBaseParams): boolean {
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
    if (tag && (tag.layers ?? 1) > this.layersRemoved) {
      (tag as { layers: number }).layers -= this.layersRemoved;
    } else {
      globalScene.arena.removeTagOnSide(type, ownSide(pokemon));
    }
    notifyHazardRemovedBy(pokemon);
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Glam Rock consumed an entry hazard!`);
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      pokemon.getBattlerIndex(),
      true,
      [this.firstStat, this.secondStat],
      this.stages,
    );
  }
}

export function notifyHazardRemovedBy(pokemon: Pokemon): void {
  if (!hasAttr(pokemon, "SedimentBloomMarkerAbAttr")) {
    return;
  }
  // Plant the Bloom as a real, per-side arena tag so it shows in the battle info
  // flyout and survives a mid-battle save. Its drain runs in `processSedimentBlooms`.
  globalScene.arena.addTag(ArenaTagType.SEDIMENT_BLOOM, 0, undefined, pokemon.id, foeSide(pokemon), true);
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} planted a Sediment Bloom!`);
}
export class SedimentBloomMarkerAbAttr extends AbAttr {
  /** The share of max HP drained each turn is 1/this (ability studio param; the default is the original 16). */
  public readonly drainDivisor: number;

  constructor(drainDivisor = 16) {
    super();
    this.drainDivisor = drainDivisor;
  }

  override apply(): void {}
}
export function processSedimentBlooms(): void {
  for (const side of [ArenaTagSide.PLAYER, ArenaTagSide.ENEMY]) {
    const bloom = globalScene.arena.getTagOnSide(ArenaTagType.SEDIMENT_BLOOM, side);
    if (!bloom) {
      continue;
    }
    const source = globalScene.getPokemonById(bloom.sourceId);
    // The planter's own Sediment Bloom attr says how much it drains; without one the original 1/16 applies.
    const planterAttr = source
      ?.getAllActiveAbilityAttrs()
      .find(attr => attr?.constructor?.name === "SedimentBloomMarkerAbAttr") as SedimentBloomMarkerAbAttr | undefined;
    const drainDivisor = planterAttr?.drainDivisor ?? 16;
    let drained = 0;
    const foes = side === ArenaTagSide.PLAYER ? globalScene.getPlayerField() : globalScene.getEnemyField();
    for (const foe of foes.filter(mon => mon.isActive(true))) {
      const amount = Math.max(1, Math.floor(foe.getMaxHp() / drainDivisor));
      drained += foe.damageAndUpdate(
        amount,
        source ? { result: HitResult.INDIRECT, source } : { result: HitResult.INDIRECT },
      );
    }
    const allies = side === ArenaTagSide.PLAYER ? globalScene.getEnemyField() : globalScene.getPlayerField();
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
/** The move deals damage (is not a status move). */
function twoFacedIsDamagingMove(move: Move): boolean {
  return move.category !== MoveCategory.STATUS;
}

/** The other face is out this turn (set by prepareTwoFacedMove, cleared by finishTwoFacedMove). */
function twoFacedIsUnleashed(pokemon: Pokemon): boolean {
  return TWO_FACED_ACTIVE_TURN.get(pokemon) === turnKey();
}

export class TwoFacedPowerAbAttr extends MovePowerBoostAbAttr implements GatedAttr<PreAttackModifyPowerAbAttrParams> {
  /** Power multiplier of an unleashed move (ability studio param; the default is the original 1.5). */
  public readonly unleashedMultiplier: number;
  /** Extra multiplier for the two favoured move types (ability studio param; the default is the original 1.4). */
  public readonly typeBonusMultiplier: number;
  /** First favoured move type (ability studio param; the default is the original Electric). */
  public readonly bonusTypeA: PokemonType;
  /** Second favoured move type (ability studio param; the default is the original Dark). */
  public readonly bonusTypeB: PokemonType;

  constructor(
    unleashedMultiplier = 1.5,
    typeBonusMultiplier = 1.4,
    bonusTypeA: PokemonType = PokemonType.ELECTRIC,
    bonusTypeB: PokemonType = PokemonType.DARK,
  ) {
    super((pokemon, _target, move) => twoFacedIsDamagingMove(move) && twoFacedIsUnleashed(pokemon), 1);
    this.unleashedMultiplier = unleashedMultiplier;
    this.typeBonusMultiplier = typeBonusMultiplier;
    this.bonusTypeA = bonusTypeA;
    this.bonusTypeB = bonusTypeB;
  }

  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreAttackModifyPowerAbAttrParams) => boolean) | undefined;

  /**
   * Tier B (ability studio spec 3.1), original clause order: `gate` is "the move deals damage" (a library condition),
   * `residual` is "my other face is out this turn" (private memory, no library condition yet), which stays second.
   */
  override canApply(params: PreAttackModifyPowerAbAttrParams): boolean {
    return gatedCanApply<PreAttackModifyPowerAbAttrParams>(this, params);
  }

  public gate({ move }: PreAttackModifyPowerAbAttrParams): boolean {
    return twoFacedIsDamagingMove(move);
  }

  public residual({ pokemon }: PreAttackModifyPowerAbAttrParams): boolean {
    return twoFacedIsUnleashed(pokemon);
  }

  override apply({ pokemon, move, power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= this.unleashedMultiplier;
    if ([this.bonusTypeA, this.bonusTypeB].includes(pokemon.getMoveType(move))) {
      power.value *= this.typeBonusMultiplier;
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
export class TwoFacedRecoilAbAttr extends PostAttackAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /** The recoil, in percent of my max HP (ability studio param; the default is the original 15). */
  public readonly recoilPercent: number;

  /**
   * The first two arguments are the base class's (attack condition, show ability); both stay `undefined` for every
   * shipped user so the base defaults apply, exactly as when this class had no constructor.
   */
  constructor(
    attackCondition?: ConstructorParameters<typeof PostAttackAbAttr>[0],
    showAbility?: boolean,
    recoilPercent = 15,
  ) {
    super(attackCondition, showAbility);
    this.recoilPercent = recoilPercent;
  }

  /**
   * Tier B (ability studio spec 3.1), original clause order: `guards` = the base attack condition (a library condition
   * through the "ctor:0" binding) and "damage was dealt", `gate` = my other face is out this turn (private memory, no
   * library condition yet), `residual` = my last move record exists and is not the one already counted (private
   * memory). All clauses are pure, no RNG.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  public guards(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params) && params.damage > 0;
  }

  public gate({ pokemon }: PostMoveInteractionAbAttrParams): boolean {
    return TWO_FACED_ACTIVE_TURN.get(pokemon) === turnKey();
  }

  public residual({ pokemon }: PostMoveInteractionAbAttrParams): boolean {
    const record = pokemon.getLastXMoves(1)[0] as object | undefined;
    return !!record && TWO_FACED_RECOIL_RECORD.get(pokemon) !== record;
  }

  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    TWO_FACED_RECOIL_RECORD.set(pokemon, pokemon.getLastXMoves(1)[0] as object);
    if (!simulated) {
      pokemon.damageAndUpdate(Math.min(pokemon.hp - 1, Math.floor(pokemon.getMaxHp() * (this.recoilPercent / 100))), {
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
export class SetlistPowerAbAttr extends MovePowerBoostAbAttr implements GatedAttr<PreAttackModifyPowerAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreAttackModifyPowerAbAttrParams) => boolean) | undefined;

  /** Extra power for each step of the set list, in percent (ability studio param; the default is the original 20). */
  public readonly bonusPercentPerStep: number;

  constructor(bonusPercentPerStep = 20) {
    super((pokemon, _target, move) => setlistNextLevel(pokemon, move) > 0, 1);
    this.bonusPercentPerStep = bonusPercentPerStep;
  }

  /** Tier B (ability studio spec 3.1): the one clause of the original closure lives in `gate`; there is no residual. */
  override canApply(params: PreAttackModifyPowerAbAttrParams): boolean {
    return gatedCanApply<PreAttackModifyPowerAbAttrParams>(this, params);
  }

  /** The replaceable condition: this is the move my set list expects next (private memory, no library atom yet). */
  public gate({ pokemon, move }: PreAttackModifyPowerAbAttrParams): boolean {
    return setlistNextLevel(pokemon, move) > 0;
  }

  override apply({ pokemon, move, power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= 1 + setlistNextLevel(pokemon, move) * (this.bonusPercentPerStep / 100);
  }
}
export class SetlistAccuracyAbAttr extends SetMoveAccuracyAbAttr implements GatedAttr<SetMoveAccuracyAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: SetMoveAccuracyAbAttrParams) => boolean) | undefined;

  /** Extra accuracy for each step of the set list, in percent (ability studio param; the default is the original 10). */
  public readonly bonusPercentPerStep: number;

  constructor(bonusPercentPerStep = 10) {
    super([MoveId.NONE], 0);
    this.bonusPercentPerStep = bonusPercentPerStep;
  }

  /**
   * Tier B (ability studio spec 3.1), original clause order: `guards` = the move's accuracy is a real number (not a
   * move that never misses), `gate` = this is the move my set list expects next (private memory). All clauses pure.
   */
  override canApply(params: SetMoveAccuracyAbAttrParams): boolean {
    return gatedCanApply<SetMoveAccuracyAbAttrParams>(this, params);
  }

  public guards({ accuracy }: SetMoveAccuracyAbAttrParams): boolean {
    return accuracy.value > 0;
  }

  public gate({ pokemon, move }: SetMoveAccuracyAbAttrParams): boolean {
    return setlistNextLevel(pokemon, move) > 0;
  }

  override apply({ pokemon, move, accuracy }: SetMoveAccuracyAbAttrParams): void {
    accuracy.value *= 1 + setlistNextLevel(pokemon, move) * (this.bonusPercentPerStep / 100);
  }
}

function livingBenchCount(pokemon: Pokemon, maxCount = 5): number {
  const party = pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
  return Math.min(maxCount, party.filter(member => !member.isFainted() && !member.isOnField()).length);
}
export class FanFavoritePowerAbAttr
  extends MovePowerBoostAbAttr
  implements GatedAttr<PreAttackModifyPowerAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreAttackModifyPowerAbAttrParams) => boolean) | undefined;

  /** Extra power for each healthy teammate waiting on the bench, in percent (the default is the original 5). */
  public readonly bonusPercentPerBenched: number;
  /** The most waiting teammates that count (the default is the original 5). */
  public readonly maxBenched: number;

  constructor(bonusPercentPerBenched = 5, maxBenched = 5) {
    super(
      (pokemon, _target, move) => move.category === MoveCategory.SPECIAL && livingBenchCount(pokemon, maxBenched) > 0,
      1,
    );
    this.bonusPercentPerBenched = bonusPercentPerBenched;
    this.maxBenched = maxBenched;
  }

  /**
   * Tier B (ability studio spec 3.1), original clause order: `gate` = the move is a special move (a library
   * condition), `residual` = at least one healthy teammate waits on the bench (no library condition yet).
   */
  override canApply(params: PreAttackModifyPowerAbAttrParams): boolean {
    return gatedCanApply<PreAttackModifyPowerAbAttrParams>(this, params);
  }

  public gate({ move }: PreAttackModifyPowerAbAttrParams): boolean {
    return move.category === MoveCategory.SPECIAL;
  }

  public residual({ pokemon }: PreAttackModifyPowerAbAttrParams): boolean {
    return livingBenchCount(pokemon, this.maxBenched) > 0;
  }

  override apply({ pokemon, power }: PreAttackModifyPowerAbAttrParams): void {
    power.value *= 1 + livingBenchCount(pokemon, this.maxBenched) * (this.bonusPercentPerBenched / 100);
  }
}
export class FanFavoriteAccuracyAbAttr extends SetMoveAccuracyAbAttr implements GatedAttr<SetMoveAccuracyAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: SetMoveAccuracyAbAttrParams) => boolean) | undefined;

  /** Extra accuracy for each healthy teammate waiting on the bench, in percent (the default is the original 5). */
  public readonly bonusPercentPerBenched: number;
  /** The most waiting teammates that count (the default is the original 5). */
  public readonly maxBenched: number;

  constructor(bonusPercentPerBenched = 5, maxBenched = 5) {
    super([MoveId.NONE], 0);
    this.bonusPercentPerBenched = bonusPercentPerBenched;
    this.maxBenched = maxBenched;
  }

  /**
   * Tier B (ability studio spec 3.1), original clause order: `guards` = the move's accuracy is a real number (not a
   * move that never misses), `gate` = at least one healthy teammate waits on the bench (no library condition yet).
   */
  override canApply(params: SetMoveAccuracyAbAttrParams): boolean {
    return gatedCanApply<SetMoveAccuracyAbAttrParams>(this, params);
  }

  public guards({ accuracy }: SetMoveAccuracyAbAttrParams): boolean {
    return accuracy.value > 0;
  }

  public gate({ pokemon }: SetMoveAccuracyAbAttrParams): boolean {
    return livingBenchCount(pokemon, this.maxBenched) > 0;
  }

  override apply({ pokemon, accuracy }: SetMoveAccuracyAbAttrParams): void {
    accuracy.value *= 1 + livingBenchCount(pokemon, this.maxBenched) * (this.bonusPercentPerBenched / 100);
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
export class RingGeneralTrapAbAttr extends ArenaTrapAbAttr implements GatedAttr<CheckTrappedAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: CheckTrappedAbAttrParams) => boolean) | undefined;

  /**
   * The old constructor closure was `holder.getHpRatio() > 0.5 && RING_ENTRY_TURN.get(holder) !== turnKey()
   * && !target.isOfType(GHOST)`. All three clauses are design conditions a player may want to change, so they now
   * live in the editable `gate`; the base class gets an always-true closure and `residual` (`super.canApply`) only
   * adds the engine's own trapping rules.
   */
  constructor() {
    super(() => true);
  }

  /**
   * Tier B (ability studio spec 3.1), original clause order: no `guards` (nothing here is a pure correctness rule),
   * `gate` = my HP is above half (whole percents), I did not come in this turn, the foe is not a Ghost type (a
   * legacy-closure binding until the library has atoms for the first two, R-B13-31 and R-B13-30), `residual` = the
   * engine's own trapping rules (Ghosts and Run Away are never trapped), which are the base class's `canApply`.
   * All clauses are pure, no RNG.
   */
  override canApply(params: CheckTrappedAbAttrParams): boolean {
    return gatedCanApply<CheckTrappedAbAttrParams>(this, params);
  }

  public gate({ pokemon, opponent }: CheckTrappedAbAttrParams): boolean {
    return (
      pokemon.getHpRatio() > 0.5 && RING_ENTRY_TURN.get(pokemon) !== turnKey() && !opponent.isOfType(PokemonType.GHOST)
    );
  }

  public residual(params: CheckTrappedAbAttrParams): boolean {
    return super.canApply(params);
  }
}

const DEADEYE_MARK = new WeakMap<Pokemon, Pokemon>();
export class DeadeyeMarkAbAttr extends PostAttackAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /**
   * Tier B (ability studio spec 3.1), original clause order: `guards` = the base attack condition (a library condition
   * through the "ctor:0" binding) and "damage was dealt", `gate` = the move is an arrow-based or a pulse move (library
   * conditions). There is no residual. All clauses are pure, no RNG.
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  public guards(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params) && params.damage > 0;
  }

  public gate({ move }: PostMoveInteractionAbAttrParams): boolean {
    return move.hasFlag(MoveFlags.ARROW_BASED) || move.hasFlag(MoveFlags.PULSE_MOVE);
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
export class DeadeyeCritAbAttr extends ConditionalCritAbAttr implements GatedAttr<ConditionalCritAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: ConditionalCritAbAttrParams) => boolean) | undefined;

  /**
   * The old constructor closure was `deadeyeApplies` (a target exists, it is the foe I marked, the move is a pulse move,
   * the foe is on the field). The pulse-move rule is a design condition a player may want to change, so it now lives in
   * the editable `gate`; the base class gets an always-true closure and its `canApply` only adds "not already a crit".
   */
  constructor() {
    super(() => true);
  }

  /**
   * Tier B (ability studio spec 3.1). The original order was: not already critical, a target exists, the target is my
   * mark, the move is a pulse move, the target is on the field. Every clause is pure (no RNG, no side effect), so the
   * pulse-move clause may move in front of the two memory clauses without changing any result: `guards` = not already
   * critical (the base class with its always-true closure) and a target exists, `gate` = the move is a pulse move
   * (library condition), `residual` = the target is the foe I marked (a private memory, no library condition yet,
   * R-B13-34) and it is on the field.
   */
  override canApply(params: ConditionalCritAbAttrParams): boolean {
    return gatedCanApply<ConditionalCritAbAttrParams>(this, params);
  }

  public guards(params: ConditionalCritAbAttrParams): boolean {
    return super.canApply(params) && !!params.target;
  }

  public gate({ move }: ConditionalCritAbAttrParams): boolean {
    return move.hasFlag(MoveFlags.PULSE_MOVE);
  }

  public residual({ pokemon, target }: ConditionalCritAbAttrParams): boolean {
    return DEADEYE_MARK.get(pokemon) === target && target.isOnField();
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

export class CenterSpreadReductionAbAttr
  extends ReceivedMoveDamageMultiplierAbAttr
  implements GatedAttr<PreDefendModifyDamageAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreDefendModifyDamageAbAttrParams) => boolean) | undefined;

  /**
   * The old constructor closure was `move.isMultiTarget()`; it is now the editable `gate` and the base class gets an
   * always-true closure. The damage multiplier is an ability studio param (the default is the original 0.75).
   */
  constructor(damageMultiplier = 0.75) {
    super(() => true, damageMultiplier);
  }

  /** Tier B (ability studio spec 3.1): the one clause of the original closure lives in `gate`; there is no residual. */
  override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    return gatedCanApply<PreDefendModifyDamageAbAttrParams>(this, params);
  }

  /** The replaceable condition: the move is a spread move (`Move.isMultiTarget`, even when only one target is left). */
  public gate({ move }: PreDefendModifyDamageAbAttrParams): boolean {
    return move.isMultiTarget();
  }
}
export class CenterOfAttentionAbAttr extends AbAttr {
  /** The stat that falls on a foe that hit my ally instead of me (ability studio param; the default is Sp. Atk). */
  public readonly penaltyStat: BattleStat;
  /** The stage change of that stat (ability studio param; the default is the original -1). */
  public readonly penaltyStages: number;

  constructor(penaltyStat: BattleStat = Stat.SPATK, penaltyStages = -1) {
    super();
    this.penaltyStat = penaltyStat;
    this.penaltyStages = penaltyStages;
  }

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
  const counter = defender
    .getAllActiveAbilityAttrs()
    .find(attr => attr?.constructor?.name === "EclipseWingMarkerAbAttr") as EclipseWingMarkerAbAttr | undefined;
  ECLIPSE_USED_WAVE.set(defender, wave);
  ECLIPSE_COUNTER_TARGET.set(defender, source);
  globalScene.phaseManager.queueMessage(`${defender.getNameToRender()}'s Eclipse Wing held it at 1 HP!`);
  globalScene.phaseManager.queueMessage(`${defender.getNameToRender()}'s Eclipse Wing struck back!`);
  globalScene.phaseManager.unshiftNew(
    "ErSignatureFollowupPhase",
    defender,
    source,
    signatureFollowup(
      MoveId.DARK_PULSE,
      counter?.counterPower ?? 120,
      counter?.counterType ?? PokemonType.DARK,
      MoveCategory.SPECIAL,
    ),
  );
  return true;
}

export class EclipseWingTurnEndAbAttr extends PostTurnAbAttr implements GatedAttr<AbAttrBaseParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: AbAttrBaseParams) => boolean) | undefined;

  /**
   * Tier B (ability studio spec 3.1). The original order was: the foe my counter-strike aimed at has fainted, then I have
   * not fainted. Both clauses are pure (no RNG, no side effect), so "I have not fainted" may come first without changing
   * any result: `guards` = I have not fainted (the shared safety rule), `gate` = the foe my counter-strike aimed at has
   * fainted (a private memory, no library condition yet, R-B13-35). There is no residual.
   */
  override canApply(params: AbAttrBaseParams): boolean {
    return gatedCanApply<AbAttrBaseParams>(this, params);
  }

  public guards({ pokemon }: AbAttrBaseParams): boolean {
    return !pokemon.isFainted();
  }

  public gate({ pokemon }: AbAttrBaseParams): boolean {
    return ECLIPSE_COUNTER_TARGET.get(pokemon)?.isFainted() === true;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    ECLIPSE_COUNTER_TARGET.delete(pokemon);
    if (!simulated) {
      pokemon.damageAndUpdate(pokemon.hp, { result: HitResult.INDIRECT });
    }
  }
}

const SPIRIT_PUNCH_RECORD = new WeakMap<Pokemon, object>();
export class SpiritPunchAbAttr extends PostAttackAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /** Power of the echo as a percent of the move's power (ability studio param; the default is the original 30). */
  public readonly echoPercent: number;
  /** Power of the echo when I have the bonus type, in percent (ability studio param; the default is the original 50). */
  public readonly bonusEchoPercent: number;
  /** The type of the echo (ability studio param; the default is the original Ghost). */
  public readonly echoType: PokemonType;
  /** The holder type that gets the stronger echo (ability studio param; the default is the original Ghost). */
  public readonly bonusType: PokemonType;

  /**
   * The first two arguments are the base class's (attack condition, show ability); both stay `undefined` for every
   * shipped user so the base defaults apply, exactly as when this class had no constructor.
   */
  constructor(
    attackCondition?: ConstructorParameters<typeof PostAttackAbAttr>[0],
    showAbility?: boolean,
    echoPercent = 30,
    bonusEchoPercent = 50,
    echoType: PokemonType = PokemonType.GHOST,
    bonusType: PokemonType = PokemonType.GHOST,
  ) {
    super(attackCondition, showAbility);
    this.echoPercent = echoPercent;
    this.bonusEchoPercent = bonusEchoPercent;
    this.echoType = echoType;
    this.bonusType = bonusType;
  }

  /**
   * Tier B (ability studio spec 3.1), original clause order, all clauses pure, no RNG:
   * `guards` = the base attack condition (a library condition through the "ctor:0" binding), damage was dealt, the hit
   * was not blocked (no library conditions yet, R-B13-3 and R-B13-4); `gate` = the move is a punching move (library
   * condition); `residual` = the move was a single hit, it is not one of the signature follow-up moves, and my last move
   * was not already echoed (R-B13-5, a private once-per-move memory; R-B13-36 and R-B13-37 for the other two).
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  public guards(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params) && params.damage > 0 && params.hitResult < HitResult.NO_EFFECT;
  }

  public gate({ move }: PostMoveInteractionAbAttrParams): boolean {
    return move.hasFlag(MoveFlags.PUNCHING_MOVE);
  }

  public residual(params: PostMoveInteractionAbAttrParams): boolean {
    const record = params.pokemon.getLastXMoves(1)[0] as object | undefined;
    return (
      params.pokemon.turnData.hitCount <= 1
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
    const multiplier = (pokemon.isOfType(this.bonusType) ? this.bonusEchoPercent : this.echoPercent) / 100;
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()}'s Spirit Punch echoed!`);
    globalScene.phaseManager.unshiftNew(
      "ErSignatureFollowupPhase",
      pokemon,
      opponent,
      signatureFollowup(move.id, move.power * multiplier, this.echoType, move.category, true),
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
  /** Power of the replayed move as a percent of its own power (ability studio param; the default is the original 40). */
  public readonly replayPercent: number;

  /**
   * The first two arguments are the base class's (attack condition, show ability); both stay `undefined` for every
   * shipped user so the base defaults apply, exactly as when this class had no constructor.
   */
  constructor(
    attackCondition?: ConstructorParameters<typeof PostAttackAbAttr>[0],
    showAbility?: boolean,
    replayPercent = 40,
  ) {
    super(attackCondition, showAbility);
    this.replayPercent = replayPercent;
  }

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
      signatureFollowup(prior.id, prior.power * (this.replayPercent / 100), prior.type, prior.category),
    );
  }
}

const SKYHOOK_TURN = new WeakMap<Pokemon, string>();
const SKYHOOK_BOOST_SIDE = new Map<ArenaTagSide, number>();
let skyhookBattle: object | undefined;
function ensureSkyhookBattle(): void {
  if (skyhookBattle !== globalScene.currentBattle) {
    SKYHOOK_BOOST_SIDE.clear();
    skyhookBattle = globalScene.currentBattle;
  }
}
const SKYHOOK_SWITCH = new ForceSwitchOutHelper(SwitchType.SWITCH);
export class SkyhookAbAttr extends PostAttackAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /** Chance (percent) that the Pokemon that replaces me enters with +1 Speed (ability studio param; the default is the original 20). */
  public readonly speedBoostChancePercent: number;

  /** Number of Speed stages my replacement gains when the roll succeeds (ability studio param; the default is the original 1). */
  public readonly speedBoostStages: number;

  /**
   * The first two arguments are the base class's (attack condition, show ability); both stay `undefined` for every
   * shipped user so the base defaults apply, exactly as when this class had no constructor.
   */
  constructor(
    attackCondition?: ConstructorParameters<typeof PostAttackAbAttr>[0],
    showAbility?: boolean,
    speedBoostChancePercent = 20,
    speedBoostStages = 1,
  ) {
    super(attackCondition, showAbility);
    this.speedBoostChancePercent = speedBoostChancePercent;
    this.speedBoostStages = speedBoostStages;
  }

  /**
   * Tier B (ability studio spec 3.1), original clause order, all clauses pure, no RNG: `guards` = the base attack
   * condition (a library condition through the "ctor:0" binding), damage was dealt, and this is the final hit of the
   * move; `gate` = I have not switched out this turn yet (a private per-Pokemon memory, no library condition yet,
   * R-B13-17); `residual` = every foe allows my switch (feasibility, stays in the class).
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  public guards(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params) && params.damage > 0 && params.pokemon.turnData.hitsLeft <= 1;
  }

  public gate({ pokemon }: PostMoveInteractionAbAttrParams): boolean {
    return SKYHOOK_TURN.get(pokemon) !== turnKey();
  }

  public residual({ pokemon }: PostMoveInteractionAbAttrParams): boolean {
    return pokemon.getOpponents().every(opponent => SKYHOOK_SWITCH.getSwitchOutCondition(pokemon, opponent));
  }

  override apply({ pokemon, simulated }: PostMoveInteractionAbAttrParams): void {
    SKYHOOK_TURN.set(pokemon, turnKey());
    if (simulated) {
      return;
    }
    ensureSkyhookBattle();
    SKYHOOK_BOOST_SIDE.set(
      ownSide(pokemon),
      pokemon.randBattleSeedInt(100) < this.speedBoostChancePercent ? this.speedBoostStages : 0,
    );
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
    globalScene.phaseManager.unshiftNew("StatStageChangePhase", pokemon.getBattlerIndex(), true, [Stat.SPD], boost);
  }
}

export class BootHillAbAttr extends PostAttackAbAttr implements GatedAttr<PostMoveInteractionAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PostMoveInteractionAbAttrParams) => boolean) | undefined;

  /** The marker hurts the next foe by 1 / this many parts of its max HP (ability studio param; the default is the original 8). */
  public readonly damageDivisor: number;

  /** Speed stages the marker takes from the next foe (ability studio param; the default is the original 1). */
  public readonly speedStages: number;

  /** The first two arguments are the base class's (attack condition, show ability); both stay `undefined` for every shipped user. */
  constructor(
    attackCondition?: ConstructorParameters<typeof PostAttackAbAttr>[0],
    showAbility?: boolean,
    damageDivisor = 8,
    speedStages = 1,
  ) {
    super(attackCondition, showAbility);
    this.damageDivisor = damageDivisor;
    this.speedStages = speedStages;
  }

  /**
   * Tier B (ability studio spec 3.1), original clause order, all clauses pure, no RNG: `guards` = the base attack
   * condition (a library condition through the "ctor:0" binding) and damage was dealt; `gate` = the target was knocked
   * out (no library condition yet, R-B13-44); `residual` = the move is not one of the ability's own follow-up moves
   * (R-B13-37).
   */
  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    return gatedCanApply<PostMoveInteractionAbAttrParams>(this, params);
  }

  public guards(params: PostMoveInteractionAbAttrParams): boolean {
    return super.canApply(params) && params.damage > 0;
  }

  public gate({ opponent }: PostMoveInteractionAbAttrParams): boolean {
    return opponent.isFainted();
  }

  public residual({ move }: PostMoveInteractionAbAttrParams): boolean {
    return !isSignatureFollowup(move);
  }

  override apply({ pokemon }: PostMoveInteractionAbAttrParams): void {
    // Plant the marker as a real, per-side arena tag so it shows in the battle
    // info flyout and survives a mid-battle save. Consumed in `applyGraveMarkerOnEntry`.
    globalScene.arena.addTag(ArenaTagType.GRAVE_MARKER, 0, undefined, pokemon.id, foeSide(pokemon), true);
    globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} planted a Grave Marker!`);
  }
}
export function applyGraveMarkerOnEntry(pokemon: Pokemon): void {
  const side = ownSide(pokemon);
  const marker = globalScene.arena.getTagOnSide(ArenaTagType.GRAVE_MARKER, side);
  if (!marker) {
    return;
  }
  const source = globalScene.getPokemonById(marker.sourceId);
  globalScene.arena.removeTagOnSide(ArenaTagType.GRAVE_MARKER, side, true);
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} was struck by the Grave Marker!`);
  // The planter's Boot Hill block carries the two numbers; when the planter or its block is gone the shipped values apply.
  const planter = source?.getAllActiveAbilityAttrs().find(attr => attr instanceof BootHillAbAttr) as
    | BootHillAbAttr
    | undefined;
  const damageDivisor = planter?.damageDivisor ?? 8;
  const speedStages = planter?.speedStages ?? 1;
  const damage = Math.max(1, Math.floor(pokemon.getMaxHp() / damageDivisor));
  pokemon.damageAndUpdate(damage, source ? { result: HitResult.INDIRECT, source } : { result: HitResult.INDIRECT });
  if (!pokemon.isFainted()) {
    pokemon.setStatStage(Stat.SPD, Math.max(-6, pokemon.getStatStage(Stat.SPD) - speedStages));
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
export class ReductionPowerAbAttr extends MovePowerBoostAbAttr implements GatedAttr<PreAttackModifyPowerAbAttrParams> {
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreAttackModifyPowerAbAttrParams) => boolean) | undefined;

  /**
   * The old constructor closure was "Reduction consumed the field for this very move this turn"; it is now the
   * editable `gate` and the base class gets an always-true closure. The power multiplier is an ability studio param
   * (the default is the original 1.5).
   */
  constructor(powerMultiplier = 1.5) {
    super(() => true, powerMultiplier);
  }

  /** Tier B (ability studio spec 3.1): the one clause of the original closure lives in `gate`; there is no residual. */
  override canApply(params: PreAttackModifyPowerAbAttrParams): boolean {
    return gatedCanApply<PreAttackModifyPowerAbAttrParams>(this, params);
  }

  /** The replaceable condition: prepareReductionMove consumed the field for this move on this turn (private memory). */
  public gate({ pokemon, move }: PreAttackModifyPowerAbAttrParams): boolean {
    const state = REDUCTION_ACTIVE.get(pokemon);
    return state?.move === move && state.turn === turnKey();
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
export class LivingChromeReductionAbAttr
  extends ReceivedMoveDamageMultiplierAbAttr
  implements GatedAttr<PreDefendModifyDamageAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreDefendModifyDamageAbAttrParams) => boolean) | undefined;

  /** Damage multiplier against a type I remembered (ability studio param; the default is the original 0.5). */
  public readonly typeMultiplier: number;
  /** Damage multiplier against every type while the shape memory is the flat Eevee one (ability studio param; the default is the original 0.75). */
  public readonly flatMultiplier: number;

  /**
   * The old constructor closure was the shape-memory test; it is now the editable `gate` and the base class gets an
   * always-true closure.
   */
  constructor(typeMultiplier = 0.5, flatMultiplier = 0.75) {
    super(() => true, typeMultiplier);
    this.typeMultiplier = typeMultiplier;
    this.flatMultiplier = flatMultiplier;
  }

  /** Tier B (ability studio spec 3.1): the one clause of the original closure lives in `gate`; there is no residual. */
  override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    return gatedCanApply<PreDefendModifyDamageAbAttrParams>(this, params);
  }

  /**
   * The replaceable condition, the whole original closure, in order: I hold a shape memory from this wave, it was made
   * on this very turn, and (it is the flat Eevee memory or the attacker's move type is one I remembered).
   */
  public gate({ pokemon: holder, opponent: attacker, move }: PreDefendModifyDamageAbAttrParams): boolean {
    const state = SHAPE_MEMORY.get(holder);
    if (
      !state
      || state.wave !== (globalScene.currentBattle?.waveIndex ?? 0)
      || state.expires !== (globalScene.currentBattle?.turn ?? 0)
    ) {
      return false;
    }
    return state.flat || state.types.includes(attacker.getMoveType(move));
  }

  override apply(params: PreDefendModifyDamageAbAttrParams): void {
    const state = SHAPE_MEMORY.get(params.pokemon);
    params.damage.value = Math.floor(params.damage.value * (state?.flat ? this.flatMultiplier : this.typeMultiplier));
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
  if (accuracy.value <= 0) {
    return;
  }
  const vaporBody = target
    .getAllActiveAbilityAttrs()
    .find(attr => attr?.constructor?.name === "VaporBodyAccuracyAbAttr") as VaporBodyAccuracyAbAttr | undefined;
  if (vaporBody?.condition(target, user, move)) {
    accuracy.value *= vaporBody.accuracyMultiplier;
  }
}

const TRAPPING_TAGS = [
  BattlerTagType.TRAPPED,
  BattlerTagType.NO_RETREAT,
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
    // The protector's own marker attr says which stat falls and by how much; without one the original Sp. Atk -1 applies.
    const marker = protectingAlly
      .getAllActiveAbilityAttrs()
      .find(attr => attr?.constructor?.name === "CenterOfAttentionAbAttr") as CenterOfAttentionAbAttr | undefined;
    globalScene.phaseManager.queueMessage(`${protectingAlly.getNameToRender()} drew the attacker's attention!`);
    globalScene.phaseManager.unshiftNew(
      "StatStageChangePhase",
      attacker.getBattlerIndex(),
      false,
      [marker?.penaltyStat ?? Stat.SPATK],
      marker?.penaltyStages ?? -1,
    );
  }
}
const CENTER_PENALTY_RECORD = new WeakMap<Pokemon, object>();

export type NewcomerSignatureMechanicStateValue = string | number | boolean | null;

export interface NewcomerSignatureMechanicSnapshot {
  effectId: string;
  sourceMoveId?: number;
  sourceEntityId?: number;
  state: ReadonlyArray<readonly [string, NewcomerSignatureMechanicStateValue]>;
}

/**
 * Decision-relevant state that otherwise lives only in module-local WeakMaps.
 * This is intentionally a read-only projection: combat telemetry must never
 * mutate an ability's live state while taking an observation.
 */
export function snapshotNewcomerSignatureMechanics(pokemon: Pokemon): NewcomerSignatureMechanicSnapshot[] {
  const snapshots: NewcomerSignatureMechanicSnapshot[] = [];
  const add = (
    effectId: string,
    state: ReadonlyArray<readonly [string, NewcomerSignatureMechanicStateValue]>,
    source?: { moveId?: number; entityId?: number },
  ): void => {
    snapshots.push({
      effectId,
      ...(source?.moveId == null ? {} : { sourceMoveId: source.moveId }),
      ...(source?.entityId == null ? {} : { sourceEntityId: source.entityId }),
      state,
    });
  };

  if (VOLUNTARY_ENTRY.has(pokemon) || FINAL_SEASON_PENDING_FOG.has(pokemon)) {
    add("final-season", [
      ["voluntaryEntry", VOLUNTARY_ENTRY.has(pokemon)],
      ["pendingFog", FINAL_SEASON_PENDING_FOG.has(pokemon)],
    ]);
  }
  const foul = FOUL_HARVEST.get(pokemon);
  if (foul) {
    add("foul-harvest", [["charges", foul.charges]]);
  }
  const porous = POROUS.get(pokemon);
  if (porous) {
    add("porous", [["stacks", porous.stacks]]);
  }
  const anneal = ANNEAL.get(pokemon);
  if (anneal) {
    add("anneal", [["gained", anneal.gained]]);
  }
  const heavyweightTurn = HEAVYWEIGHT_DROP_TURN.get(pokemon);
  if (heavyweightTurn) {
    add("heavyweight", [["lastDropTurn", heavyweightTurn]]);
  }
  const twoFacedLastTurn = TWO_FACED_LAST_TURN.get(pokemon);
  const twoFacedActiveTurn = TWO_FACED_ACTIVE_TURN.get(pokemon);
  if (twoFacedLastTurn || twoFacedActiveTurn) {
    add("two-faced", [
      ["lastTurn", twoFacedLastTurn ?? null],
      ["activeTurn", twoFacedActiveTurn ?? null],
      ["ready", twoFacedReady(pokemon)],
    ]);
  }
  const setlist = SETLIST.get(pokemon);
  if (setlist) {
    add("setlist", [
      ["moves", setlist.moves.join(",")],
      ["expectedMoveId", setlist.expected ?? null],
      ["crescendo", setlist.crescendo],
    ]);
  }
  const ringEntryTurn = RING_ENTRY_TURN.get(pokemon);
  if (ringEntryTurn) {
    add("ring-general", [["entryTurn", ringEntryTurn]]);
  }
  const deadeyeTarget = DEADEYE_MARK.get(pokemon);
  if (deadeyeTarget) {
    add("deadeye-draw", [["targetEntityId", deadeyeTarget.id]], { entityId: deadeyeTarget.id });
  }
  const eclipseWave = ECLIPSE_USED_WAVE.get(pokemon);
  const eclipseTarget = ECLIPSE_COUNTER_TARGET.get(pokemon);
  if (eclipseWave != null || eclipseTarget) {
    add(
      "eclipse-wing",
      [
        ["usedWave", eclipseWave ?? null],
        ["counterTargetEntityId", eclipseTarget?.id ?? null],
      ],
      eclipseTarget ? { entityId: eclipseTarget.id } : undefined,
    );
  }
  const encore = ENCORE_SET.get(pokemon);
  if (encore) {
    add(
      "encore-set",
      [["previousMoveId", encore.previous?.id ?? null]],
      encore.previous ? { moveId: encore.previous.id } : undefined,
    );
  }
  const skyhookTurn = SKYHOOK_TURN.get(pokemon);
  if (skyhookTurn) {
    add("skyhook", [["lastTriggerTurn", skyhookTurn]]);
  }
  const reduction = REDUCTION_ACTIVE.get(pokemon);
  if (reduction) {
    add(
      "reduction",
      [
        ["moveId", reduction.move.id],
        ["turn", reduction.turn],
      ],
      { moveId: reduction.move.id },
    );
  }
  const crackedWave = CRACKED_USED_WAVE.get(pokemon);
  const crackedTypes = CRACKED_TYPES.get(pokemon);
  if (crackedWave != null || crackedTypes) {
    add("cracked-vessel", [
      ["usedWave", crackedWave ?? null],
      ["remainingTypes", crackedTypes?.join(",") ?? ""],
    ]);
  }
  const shape = SHAPE_MEMORY.get(pokemon);
  if (shape) {
    add("living-chrome", [
      ["wave", shape.wave],
      ["count", shape.count],
      ["types", shape.types.join(",")],
      ["flat", shape.flat],
      ["expiresTurn", shape.expires],
    ]);
  }
  const superego = SUPEREGO_TURN.get(pokemon);
  if (superego != null && superego.size > 0) {
    add("superego", [["usedStats", [...superego.entries()].map(([stat, turn]) => `${stat}:${turn}`).join(",")]]);
  }
  return snapshots;
}

export function notifySignatureHazardRemoval(user: Pokemon, removed: number): void {
  const removedBloom = globalScene.arena.removeTagOnSide(ArenaTagType.SEDIMENT_BLOOM, ownSide(user), true);
  if (removed > 0 || removedBloom) {
    notifyHazardRemovedBy(user);
  }
}

// ---------------------------------------------------------------------------
// Marker attrs and wiring.

export class EclipseWingPowerAbAttr
  extends MovePowerBoostAbAttr
  implements GatedAttr<PreAttackModifyPowerAbAttrParams>
{
  /** Set by the ability studio compiler to replace {@linkcode gate} on a freshly built instance. */
  public declare gateOverride: ((params: PreAttackModifyPowerAbAttrParams) => boolean) | undefined;

  /**
   * The old constructor closure was `getHpRatio() < 1 / 3 && move type is Dark or Flying`; the type rule is now the
   * editable `gate` and the HP rule the `residual`, and the base class gets an always-true closure. The power
   * multiplier is an ability studio param (the default is the original 1.5).
   */
  constructor(powerMultiplier = 1.5) {
    super(() => true, powerMultiplier);
  }

  /**
   * Tier B (ability studio spec 3.1). The original order was: HP, then type. Both clauses are pure (no RNG, no side
   * effect), so the type clause may come first without changing any result: `gate` = the move is a Dark or Flying move
   * (library conditions), `residual` = my HP, rounded to a whole percent, is below a third (no library condition yet,
   * R-B13-47).
   */
  override canApply(params: PreAttackModifyPowerAbAttrParams): boolean {
    return gatedCanApply<PreAttackModifyPowerAbAttrParams>(this, params);
  }

  public gate({ pokemon, move }: PreAttackModifyPowerAbAttrParams): boolean {
    return [PokemonType.DARK, PokemonType.FLYING].includes(pokemon.getMoveType(move));
  }

  public residual({ pokemon }: PreAttackModifyPowerAbAttrParams): boolean {
    return pokemon.getHpRatio() < 1 / 3;
  }
}
export class EclipseWingMarkerAbAttr extends AbAttr {
  /** Power of the counter-strike (ability studio param; the default is the original 120). */
  public readonly counterPower: number;

  /** Type of the counter-strike (ability studio param; the default is the original Dark). */
  public readonly counterType: PokemonType;

  constructor(counterPower = 120, counterType: PokemonType = PokemonType.DARK) {
    super();
    this.counterPower = counterPower;
    this.counterType = counterType;
  }

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
