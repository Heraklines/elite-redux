import type { PreAttackModifyDamageAbAttrParams } from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import {
  applyAbAttrs,
  applyOnGainAbAttrs,
  applyOnLoseAbAttrs,
  getEnemyPassiveSlotLimit,
} from "#abilities/apply-ab-attrs";
import { generateMoveset } from "#app/ai/ai-moveset-gen";
import type { Battle } from "#app/battle";
import type { AnySound, BattleScene } from "#app/battle-scene";
import { EVOLVE_MOVE, PLAYER_PARTY_MAX_SIZE, RARE_CANDY_FRIENDSHIP_CAP, RELEARN_MOVE } from "#app/constants";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import Overrides from "#app/overrides";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import type { FORCED_RIVAL_SIGNATURE_MOVES } from "#balance/moves/signature-moves";
import type { SpeciesFormEvolution } from "#balance/pokemon-evolutions";
import {
  FusionSpeciesFormEvolution,
  pokemonEvolutions,
  pokemonPrevolutions,
  validateShedinjaEvo,
} from "#balance/pokemon-evolutions";
import { BASE_HIDDEN_ABILITY_RATE, BASE_SHINY_CHANCE, SHINY_EPIC_CHANCE, SHINY_VARIANT_CHANCE } from "#balance/rates";
import {
  getStarterValueFriendshipCap,
  speciesStarterCosts,
  TRAINER_MAX_FRIENDSHIP_WAVE,
  TRAINER_MIN_FRIENDSHIP,
} from "#balance/starters";
import { tmSpecies } from "#balance/tm-species-map";
import { reverseCompatibleTms, speciesTmMoves } from "#balance/tms";
import type { SuppressAbilitiesTag } from "#data/arena-tag";
import { EntryHazardTag, isMagicRoomActive, isWonderRoomActive, NoCritTag, WeakenMoveScreenTag } from "#data/arena-tag";
import { fieldSpriteOffset } from "#data/battle-format";
import {
  AutotomizedTag,
  BattlerTag,
  type BattlerTagFromType,
  CritBoostTag,
  EncoreTag,
  ExposedTag,
  GroundedTag,
  getBattlerTag,
  HighestStatBoostTag,
  MoveRestrictionBattlerTag,
  PowerTrickTag,
  SemiInvulnerableTag,
  SubstituteTag,
  TarShotTag,
  TrappedTag,
  TypeImmuneTag,
} from "#data/battler-tags";
import { getDailyEventSeedBoss, isDailyForcedWaveHiddenAbility } from "#data/daily-seed/daily-run";
import { isDailyEventSeed, isDailyFinalBoss } from "#data/daily-seed/daily-seed-utils";
import { allAbilities, allMoves } from "#data/data-lists";
import { erBadSpliceOnLeaveField } from "#data/elite-redux/abilities/bad-splice";
import { erFaultCurrentOnLeaveField, erOverloadedSelfLocked } from "#data/elite-redux/abilities/charge-stack";
import { erApplyChivalry } from "#data/elite-redux/abilities/chivalry";
import {
  dualTypePrimeMoveType,
  dualTypePrimeSecondType,
  dualTypeStabBonus,
} from "#data/elite-redux/abilities/dual-type-move";
import { erTryLastHost } from "#data/elite-redux/abilities/last-host";
import { erLibraryCastIsSpecial, erLibraryDamageMultiplier } from "#data/elite-redux/abilities/library";
import { erTryLifePreserver } from "#data/elite-redux/abilities/life-preserver";
import { erOmniformRevertOnLeaveField } from "#data/elite-redux/abilities/omniform";
import { erShatteredPsycheOnLeaveField } from "#data/elite-redux/abilities/shattered-psyche";
import { erApplySoulmateHealCopy, erApplySoulmateRedirect } from "#data/elite-redux/abilities/soulmate";
import { getGraftedTypes } from "#data/elite-redux/abilities/type-graft";
import { PersistentFieldAuraAbAttr } from "#data/elite-redux/archetypes/persistent-field-aura";
import { suppressesOpponentDamageBoosts } from "#data/elite-redux/archetypes/post-defend-suppress-opponent-damage-boost";
import { coopAllowAccountWrite } from "#data/elite-redux/coop/coop-account-gate";
import { isCoopAuthoritativeGuestGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import { coopAttributeNewMon, coopHalfIsFull } from "#data/elite-redux/coop/coop-session";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";
import { isCoopRecording, recordCoopEvent } from "#data/elite-redux/coop/coop-turn-recorder";
import {
  erRecordAchievementDamageAndUpdate,
  erRecordAchievementFusion,
  erRecordAchievementRelicSurvive,
  erRecordAchievementStatusSet,
} from "#data/elite-redux/er-achievement-tracker";
import { getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import {
  getErSharedGiftAbilityIdsFor,
  isErBlackShiny,
  maybeUpgradeToErBlackShiny,
  resetErBlackShinyState,
} from "#data/elite-redux/er-black-shinies";
import { erBlackSpritePath, erBlackSpritePathFromBase } from "#data/elite-redux/er-black-sprite-manifest";
import { erTryApplyOmniGem } from "#data/elite-redux/er-community-items";
import { erTryApplyGem } from "#data/elite-redux/er-elemental-gems";
import {
  chooseMoveIndex,
  damageToScore,
  ER_HAZARD_MOVE_IDS,
  ER_SLOW_DOOMED_PENALTY,
  ER_UNUSABLE_MOVE_SCORE,
  type ErBoostStages,
  type ErDepth1Before,
  type ErDepth1Move,
  type ErHazardKind,
  type ErHazards,
  erAssessThreat,
  erDepth1MoveScore,
  getErAiProfile,
  shouldDevalueSlowMove,
  strategicMoveScore,
} from "#data/elite-redux/er-enemy-ai";
import { isErFinalBossSpecies } from "#data/elite-redux/er-final-boss";
import {
  erBloodPactDealMultiplier,
  erBloodPactTakeMultiplier,
  erCapacitorElectricMultiplier,
  erMoltenCoreFireMultiplier,
  erMoraleBannerMultiplier,
  erTryPharaohAnkh,
  erTrySecondWind,
  erTwinLinkMultiplier,
} from "#data/elite-redux/er-relics";
import { applyErResistBerry } from "#data/elite-redux/er-resist-berries";
import {
  erYoungsterFreeInnateSlots,
  getErDifficulty,
  getErDifficultyShinyMultiplier,
} from "#data/elite-redux/er-run-difficulty";
import { getRunShinyMultiplier } from "#data/elite-redux/er-shiny-favour";
import { getErShinyLabEarnedTierForPokemon, rollErShinyLabWildSavedLook } from "#data/elite-redux/er-shiny-lab-effects";
import { applyErAtlasFrameRate } from "#data/elite-redux/er-sprite-anim";
import {
  erApplyTacticalDamage,
  erTacticalAirBalloonUngrounds,
  erTacticalBlocksBattlerTag,
  erTacticalBypassesTrap,
  erTacticalIronBallGrounds,
  erTacticalProtectsAbility,
  erTacticalSpeedMultiplier,
  erTacticalUtilityUmbrella,
  erTacticalZoomLensMultiplier,
  erTryApplyExpertBelt,
} from "#data/elite-redux/er-tactical-items";
import { enforceErEliteBstCurve } from "#data/elite-redux/er-trainer-runtime-hook";
import {
  applyErWardStoneBlock,
  ER_WARD_BLOCKED_TAGS,
  erWardStoneStatusLabel,
  erWardStoneTagLabel,
  findErWardStone,
} from "#data/elite-redux/er-ward-stones";
import { getLevelTotalExp } from "#data/exp";
import {
  SpeciesFormChangeActiveTrigger,
  SpeciesFormChangeLapseTeraTrigger,
  SpeciesFormChangeMoveLearnedTrigger,
  SpeciesFormChangePostMoveTrigger,
} from "#data/form-change-triggers";
import { Gender } from "#data/gender";
import { getNatureStatMultiplier } from "#data/nature";
import {
  CustomPokemonData,
  PokemonBattleData,
  PokemonSummonData,
  PokemonTempSummonData,
  PokemonTurnData,
  PokemonWaveData,
} from "#data/pokemon-data";
import type { SpeciesFormChange } from "#data/pokemon-forms";
import type { PokemonSpeciesForm } from "#data/pokemon-species";
import { PokemonSpecies } from "#data/pokemon-species";
import { getRandomStatus, getStatusEffectHealText, getStatusEffectOverlapText, Status } from "#data/status-effect";
import { getTerrainBlockMessage, TerrainType } from "#data/terrain";
import type { TypeDamageMultiplier } from "#data/type";
import { getTypeDamageMultiplier, getTypeRgb } from "#data/type";
import { isFogWeather } from "#data/weather";
import { AbilityId } from "#enums/ability-id";
import { AiType } from "#enums/ai-type";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerIndex } from "#enums/battler-index";
import { BattlerTagLapseType } from "#enums/battler-tag-lapse-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import type { BerryType } from "#enums/berry-type";
import { BiomeId } from "#enums/biome-id";
import { ChallengeType } from "#enums/challenge-type";
import { Challenges } from "#enums/challenges";
import { DexAttr } from "#enums/dex-attr";
import { ErAbilityId } from "#enums/er-ability-id";
import { FieldPosition } from "#enums/field-position";
import { HitResult } from "#enums/hit-result";
import { LearnMoveSituation } from "#enums/learn-move-situation";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { isIgnorePP, isVirtual, MoveUseMode } from "#enums/move-use-mode";
import { Nature } from "#enums/nature";
import { PokeballType } from "#enums/pokeball";
import { PokemonAnimType } from "#enums/pokemon-anim-type";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import {
  BATTLE_STATS,
  type BattleStat,
  EFFECTIVE_STATS,
  type EffectiveStat,
  PERMANENT_STATS,
  type PermanentStat,
  Stat,
} from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { SwitchType } from "#enums/switch-type";
import type { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { WeatherType } from "#enums/weather-type";
import {
  BaseStatModifier,
  BerryModifier,
  CritBoosterModifier,
  EnemyDamageBoosterModifier,
  EnemyDamageReducerModifier,
  EnemyFusionChanceModifier,
  EvoTrackerModifier,
  HiddenAbilityRateBoosterModifier,
  PokemonBaseStatFlatModifier,
  PokemonBaseStatTotalModifier,
  PokemonFriendshipBoosterModifier,
  PokemonHeldItemModifier,
  PokemonIncrementingStatModifier,
  PokemonMultiHitModifier,
  PokemonNatureWeightModifier,
  ShinyRateBoosterModifier,
  StatBoosterModifier,
  SurviveDamageModifier,
  TempCritBoosterModifier,
  TempStatStageBoosterModifier,
} from "#modifiers/modifier";
import { applyMoveAttrs } from "#moves/apply-attrs";
import type { Move } from "#moves/move";
import { effectiveBattlerId, getMoveTargets } from "#moves/move-utils";
import { PokemonMove } from "#moves/pokemon-move";
import {
  ErShinyLabSpriteFxOverlay,
  getErShinyLabNamePrefixForPokemon,
  getErShinyLabPokemonBattleSource,
  getErShinyLabSpriteFxLookForPokemon,
  getErShinyLabSpriteFxTime,
  hasErShinyLabExactSpriteFx,
} from "#sprites/er-shiny-lab-sprite-fx";
import { loadMoveAnimations } from "#sprites/pokemon-asset-loader";
import type { Variant } from "#sprites/variant";
import {
  populateErShinyLabPaletteVariantColors,
  populateVariantColors,
  variantColorCache,
  variantData,
} from "#sprites/variant";
import { achvs } from "#system/achv";
import type { PokemonData } from "#system/pokemon-data";
import { RibbonData } from "#system/ribbons/ribbon-data";
import { awardRibbonsToSpeciesLine } from "#system/ribbons/ribbon-methods";
import type { AbAttrMap, AbAttrString, TypeMultiplierAbAttrParams } from "#types/ability-types";
import type { Constructor } from "#types/common";
import type {
  GetAttackDamageParams,
  GetAttackTypeEffectivenessParams,
  GetBaseDamageParams,
} from "#types/damage-params";
import type { DamageCalculationResult, DamageResult } from "#types/damage-result";
import type { LevelMoves } from "#types/pokemon-level-moves";
import type { StarterDataEntry, StarterMoveset } from "#types/save-data";
import type { TurnMove } from "#types/turn-move";
import type { AbstractConstructor, Mutable } from "#types/type-helpers";
import { BattleInfo } from "#ui/battle-info";
import { EnemyBattleInfo } from "#ui/enemy-battle-info";
import type { PartyOption } from "#ui/party-ui-handler";
import { PartyUiHandler, PartyUiMode } from "#ui/party-ui-handler";
import { PlayerBattleInfo } from "#ui/player-battle-info";
import { coerceArray } from "#utils/array";
import { applyChallenges } from "#utils/challenge-utils";
import { argbFromRgba, deltaRgb, rgbaFromArgb, rgbaToInt, rgbHexToRgba, rgbToHsv } from "#utils/color-utils";
import {
  BooleanHolder,
  fixedInt,
  getIvsFromId,
  isBetween,
  NumberHolder,
  randSeedFloat,
  randSeedInt,
  randSeedIntRange,
  randSeedItem,
  toDmgValue,
} from "#utils/common";
import { calculateBossSegmentDamage } from "#utils/damage";
import { getEnumValues } from "#utils/enums";
import { cachedFetch } from "#utils/fetch-utils";
import { isSlotActive } from "#utils/passive-utils";
import { decodeNickname, getFusedSpeciesName, getPokemonSpecies, getPokemonSpeciesForm } from "#utils/pokemon-utils";
import { inSpeedOrder } from "#utils/speed-order-generator";
import { ValueHolder } from "#utils/value-holder";
import { QuantizerCelebi } from "@material/material-color-utilities";
import i18next from "i18next";
import Phaser from "phaser";
import SoundFade from "phaser3-rex-plugins/plugins/soundfade";
import type { NonEmptyTuple } from "type-fest";

export abstract class Pokemon extends Phaser.GameObjects.Container {
  /**
   * This pokemon's {@link https://bulbapedia.bulbagarden.net/wiki/Personality_value | Personality value/PID},
   * used to determine various parameters of this Pokemon.
   * Represented as a random 32-bit unsigned integer.
   * TODO: Stop treating this like a unique ID and stop treating 0 as no pokemon
   */
  public id: number;
  /**
   * The Pokemon's current nickname, or `undefined` if it currently lacks one.
   * If omitted, references to this should refer to the default name for this Pokemon's species.
   */
  public nickname?: string | undefined;
  public species: PokemonSpecies;
  public formIndex: number;
  public abilityIndex: number;
  public passive: boolean;
  public shiny: boolean;
  public variant: Variant;
  public pokeball: PokeballType;
  protected battleInfo: BattleInfo;
  public level: number;
  public exp: number;
  public gender: Gender;
  public hp: number;
  public stats: number[];
  public ivs: number[];
  public nature: Nature;
  public moveset: PokemonMove[];
  /**
   * This Pokemon's current {@link https://m.bulbapedia.bulbagarden.net/wiki/Status_condition#Non-volatile_status | non-volatile status condition},
   * or `null` if none exist.
   * @todo Make private
   */
  public status: Status | null;
  /**
   * The Pokémon's current friendship value, ranging from 0 to 255.
   * @see {@link https://bulbapedia.bulbagarden.net/wiki/Friendship}
   */
  public friendship: number;
  /**
   * The level at which this Pokémon was met
   * @remarks
   * Primarily used for displaying in the summary screen
   */
  public metLevel: number;
  /**
   * The ID of the biome this Pokémon was met in
   * @remarks
   * Primarily used for display in the summary screen.
   */
  public metBiome: BiomeId | -1;
  // TODO: figure out why this is used and document it (seems only to be read for getting the Pokémon's egg moves)
  public metSpecies: SpeciesId;
  /** The wave index at which this Pokémon was met/encountered */
  public metWave: number;
  public luck: number;
  public pauseEvolutions: boolean;
  public pokerus: boolean;
  /**
   * Indicates whether this Pokémon has left or is about to leave the field
   * @remarks
   * When `true` on a Wild Pokemon, this indicates it is about to flee.
   */
  public switchOutStatus = false;
  public evoCounter: number;
  /** The type this Pokémon turns into when Terastallized  */
  public teraType: PokemonType;
  /** Whether this Pokémon is currently Terastallized */
  public isTerastallized: boolean;
  /** The set of Types that have been boosted by this Pokémon's Stellar Terastallization. */
  // TODO: Make this an actual set that is serialized to/from an array
  public stellarTypesBoosted: PokemonType[];

  // TODO: Create a fusionData class / interface and move all fusion-related fields there, exposed via getters
  /** If this Pokémon is a fusion, the species it is fused with; `null` if not a fusion */
  public fusionSpecies: PokemonSpecies | null;
  public fusionFormIndex: number;
  public fusionAbilityIndex: number;
  public fusionShiny: boolean;
  public fusionVariant: Variant;
  public fusionGender: Gender;
  public fusionLuck: number;
  public fusionCustomPokemonData: CustomPokemonData | null;
  public fusionTeraType: PokemonType;

  public customPokemonData: CustomPokemonData = new CustomPokemonData();

  /* Pokemon data types, in vaguely decreasing order of precedence */

  /**
   * Data that resets only on *battle* end (hit count, harvest berries, etc.)
   * Kept between waves.
   */
  public battleData: PokemonBattleData = new PokemonBattleData();
  /** Data that resets on switch or battle end (stat stages, battler tags, etc.) */
  public summonData: PokemonSummonData = new PokemonSummonData();
  /** Similar to {@linkcode PokemonSummonData}, but is reset on reload (not saved to file). */
  public tempSummonData: PokemonTempSummonData = new PokemonTempSummonData();
  /** Wave data correponding to moves/ability information revealed */
  public waveData: PokemonWaveData = new PokemonWaveData();
  /** Per-turn data like hit count & flinch tracking */
  public turnData: PokemonTurnData = new PokemonTurnData();

  /** Used by Mystery Encounters to execute pokemon-specific logic (such as stat boosts) at start of battle */
  public mysteryEncounterBattleEffects?: (pokemon: Pokemon) => void;

  /** The position of this Pokémon on the field */
  public fieldPosition: FieldPosition;

  public maskEnabled: boolean;
  public maskSprite: Phaser.GameObjects.Sprite | null;
  private tintSprite: Phaser.GameObjects.Sprite | null = null;
  private erShinyLabFxOverlay: ErShinyLabSpriteFxOverlay | null = null;
  private erShinyLabFxTimer: Phaser.Time.TimerEvent | null = null;

  /**
   * The set of all TMs that have been used on this Pokémon
   *
   * @remarks
   * Used to allow re-learning TM moves via, e.g., the Memory Mushroom
   */
  public usedTMs: MoveId[];

  private shinySparkle: Phaser.GameObjects.Sprite;

  // TODO: Rework this eventually
  constructor(
    x: number,
    y: number,
    species: PokemonSpecies,
    level: number,
    abilityIndex?: number,
    formIndex?: number,
    gender?: Gender,
    shiny?: boolean,
    variant?: Variant,
    ivs?: number[],
    nature?: Nature,
    dataSource?: Pokemon | PokemonData,
  ) {
    super(globalScene, x, y);

    this.species = species;
    this.pokeball = dataSource?.pokeball || PokeballType.POKEBALL;
    this.level = level;

    this.abilityIndex = abilityIndex ?? this.generateAbilityIndex();

    if (formIndex !== undefined) {
      this.formIndex = formIndex;
    }
    if (gender !== undefined) {
      this.gender = gender;
    }
    if (shiny !== undefined) {
      this.shiny = shiny;
    }
    if (variant !== undefined) {
      this.variant = variant;
    }
    this.exp = dataSource?.exp || getLevelTotalExp(this.level, species.growthRate);

    if (dataSource) {
      this.id = dataSource.id;
      this.hp = dataSource.hp;
      this.stats = dataSource.stats;
      this.ivs = dataSource.ivs;
      this.passive = !!dataSource.passive;
      if (this.variant === undefined) {
        this.variant = 0;
      }
      this.nature = dataSource.nature || (0 as Nature);
      this.nickname = dataSource.nickname;
      this.moveset = dataSource.moveset;
      this.status = dataSource.status!; // TODO: is this bang correct?
      this.friendship = dataSource.friendship ?? this.species.baseFriendship;
      this.metLevel = dataSource.metLevel || 5;
      this.luck = dataSource.luck;
      this.metBiome = dataSource.metBiome;
      this.metSpecies =
        dataSource.metSpecies ?? (this.metBiome === -1 ? this.species.getRootSpeciesId(true) : this.species.speciesId);
      this.metWave = dataSource.metWave ?? (this.metBiome === -1 ? -1 : 0);
      this.pauseEvolutions = dataSource.pauseEvolutions;
      this.pokerus = !!dataSource.pokerus;
      this.fusionSpecies =
        dataSource.fusionSpecies instanceof PokemonSpecies
          ? dataSource.fusionSpecies
          : dataSource.fusionSpecies
            ? getPokemonSpecies(dataSource.fusionSpecies)
            : null;
      this.fusionFormIndex = dataSource.fusionFormIndex;
      this.fusionAbilityIndex = dataSource.fusionAbilityIndex;
      this.fusionShiny = dataSource.fusionShiny;
      this.fusionVariant = dataSource.fusionVariant || 0;
      this.fusionGender = dataSource.fusionGender;
      this.fusionLuck = dataSource.fusionLuck;
      this.fusionCustomPokemonData = dataSource.fusionCustomPokemonData;
      this.fusionTeraType = dataSource.fusionTeraType;
      this.usedTMs = dataSource.usedTMs ?? [];
      this.customPokemonData = new CustomPokemonData(dataSource.customPokemonData);
      this.teraType = dataSource.teraType;
      this.isTerastallized = dataSource.isTerastallized;
      this.stellarTypesBoosted = dataSource.stellarTypesBoosted ?? [];
    } else {
      this.id = randSeedInt(4294967296);
      this.ivs = ivs || getIvsFromId(this.id);

      if (this.gender === undefined) {
        this.gender = this.species.generateGender();
      }

      if (this.formIndex === undefined) {
        this.formIndex = globalScene.getSpeciesFormIndex(species, this.gender, this.nature, this.isPlayer());
      }

      if (this.shiny === undefined) {
        this.trySetShiny();
      }

      if (this.variant === undefined) {
        this.variant = this.shiny ? this.generateShinyVariant() : 0;
        // ER Black Shinies (#349): an epic (variant 2) roll upgrades to the
        // t4 BLACK tier with chance 1/50.
        maybeUpgradeToErBlackShiny(this);
      }

      if (nature === undefined) {
        this.generateNature();
      } else {
        this.setNature(nature);
      }

      this.friendship = species.baseFriendship;
      this.metLevel = level;
      this.metBiome = globalScene.currentBattle ? globalScene.arena.biomeId : -1;
      this.metSpecies = species.speciesId;
      this.metWave = globalScene.currentBattle ? globalScene.currentBattle.waveIndex : -1;
      this.pokerus = false;

      if (level > 1) {
        const fused = new BooleanHolder(globalScene.gameMode.isSplicedOnly);
        if (!fused.value && this.isEnemy() && !this.hasTrainer()) {
          globalScene.applyModifier(EnemyFusionChanceModifier, false, fused);
          // ER Laboratory (#439 §3): the experiment biome biases the WILD fusion
          // roll - ~half of wild encounters here come out as fusions. Only the
          // chokepoint wild path (enemy + no trainer) is touched; trainer mons and
          // spliced-only runs are unaffected.
          if (!fused.value && globalScene.currentBattle) {
            const fusionPct = getErBiomeRule(globalScene.arena.biomeId)?.wildFusionChancePct;
            if (fusionPct && randSeedInt(100) < fusionPct) {
              fused.value = true;
            }
          }
        }

        if (fused.value) {
          this.calculateStats();
          this.generateFusionSpecies();
        }
      }
      this.luck = (this.shiny ? this.variant + 1 : 0) + (this.fusionShiny ? this.fusionVariant + 1 : 0);
      this.fusionLuck = this.luck;

      this.teraType = randSeedItem(this.getTypes(false, false, true));
      this.isTerastallized = false;
      this.stellarTypesBoosted = [];
    }

    this.summonData = new PokemonSummonData(dataSource?.summonData);
    this.battleData = new PokemonBattleData(dataSource?.battleData);

    this.generateName();

    if (!dataSource) {
      this.calculateStats();
    }
  }

  /** The amount of EXP the Pokemon has earned within its current level */
  public get levelExp(): number {
    return this.exp - getLevelTotalExp(this.level, this.species.growthRate);
  }

  /**
   * Return the name that will be displayed when this Pokemon is sent out into battle.
   * @param useIllusion - (Default `true`) Whether to consider this Pokemon's illusion if present
   * @param prependFormName - (Default `true`) Whether to put "Mega"/etc in front of the Pokemon's name if applicable
   * @returns The name to render for this {@linkcode Pokemon}.
   */
  getNameToRender({
    useIllusion = true,
    prependFormName = true,
  }: {
    useIllusion?: boolean;
    prependFormName?: boolean;
  } = {}) {
    const { illusion } = this.summonData;
    if (useIllusion && illusion) {
      if (illusion.nickname) {
        return decodeNickname(illusion.nickname, this.name);
      }
      return illusion.name;
    }

    const base = this.nickname
      ? decodeNickname(this.nickname, this.name)
      : prependFormName
        ? this.name
        : this.isFusion()
          ? getFusedSpeciesName(this.species.getName(), this.fusionSpecies!.getName())
          : this.species.getName();

    // ER Shiny Lab: a player-chosen preset name prefixes the displayed name everywhere
    // ("Glittering Rayquaza"). Composes over nickname + species name, skipped under an illusion
    // (disguise), and fail-safe (resolver never throws). Cosmetic only: nothing keys off the
    // display string (species is resolved by numeric id), so this cannot misresolve a mon.
    const prefix = getErShinyLabNamePrefixForPokemon(this);
    return prefix ? `${prefix} ${base}` : base;
  }

  /**
   * Return this Pokemon's {@linkcode PokeballType}.
   * @param useIllusion - Whether to consider this Pokemon's illusion if present; default `false`
   * @returns The {@linkcode PokeballType} that will be shown when this Pokemon is sent out into battle.
   */
  getPokeball(useIllusion = false): PokeballType {
    return useIllusion ? (this.summonData.illusion?.pokeball ?? this.pokeball) : this.pokeball;
  }

  init(): void {
    this.fieldPosition = FieldPosition.CENTER;
    this.initBattleInfo();

    globalScene.fieldUI.addAt(this.battleInfo, 0);

    const getSprite = (hasShadow?: boolean) => {
      const ret = globalScene.addPokemonSprite(
        this,
        0,
        0,
        `pkmn__${this.presentationIsBack() ? "back__" : ""}sub`,
        undefined,
        true,
      );
      ret.setOrigin(0.5, 1);
      ret.setPipeline(globalScene.spritePipeline, {
        tone: [0.0, 0.0, 0.0, 0.0],
        hasShadow: !!hasShadow,
        teraColor: getTypeRgb(this.getTeraType()),
        isTerastallized: this.isTerastallized,
      });
      return ret;
    };

    this.setScale(this.getSpriteScale());

    const sprite = getSprite(true);
    const tintSprite = getSprite();

    tintSprite.setVisible(false);
    this.tintSprite = tintSprite;

    this.addAt(sprite, 0);
    this.erShinyLabFxOverlay?.destroy();
    this.erShinyLabFxOverlay = new ErShinyLabSpriteFxOverlay(sprite, `battle-shiny-lab-fx-${this.id}`);
    this.addAt(this.erShinyLabFxOverlay.getSprite(), 1);
    this.addAt(tintSprite, 2);

    if (this.isShiny(true) && !this.shinySparkle) {
      this.initShinySparkle();
    }
  }

  abstract initBattleInfo(): void;

  public isOnField(): boolean {
    if (!globalScene) {
      return false;
    }
    if (this.switchOutStatus) {
      return false;
    }
    return globalScene.field.getIndex(this) > -1;
  }

  /**
   * Checks if a pokemon is fainted (ie: its `hp <= 0`).
   * Usually should not be called directly in favor of calling {@linkcode isAllowedInBattle()}.
   * @param checkStatus - Whether to also check that the pokemon's status is {@linkcode StatusEffect.FAINT}; default `false`
   * @returns Whether this Pokemon is fainted, as described above.
   */
  public isFainted(checkStatus = false): boolean {
    return this.hp <= 0 && (!checkStatus || this.status?.effect === StatusEffect.FAINT);
  }

  /**
   * Check if this pokemon is both not fainted and allowed to be used based on currently active challenges.
   * @returns Whether this Pokemon is allowed to partake in battle.
   */
  public isAllowedInBattle(): boolean {
    return !this.isFainted() && this.isAllowedInChallenge();
  }

  /**
   * Check if this pokemon is allowed based on any active challenges.
   * Usually should not be called directly in favor of consulting {@linkcode isAllowedInBattle()}.
   * @returns Whether this Pokemon is allowed under the current challenge conditions.
   */
  public isAllowedInChallenge(): boolean {
    const challengeAllowed = new BooleanHolder(true);
    applyChallenges(ChallengeType.POKEMON_IN_BATTLE, this, challengeAllowed);
    return challengeAllowed.value;
  }

  /**
   * Checks if this {@linkcode Pokemon} is allowed in battle (ie: not fainted, and allowed under any active challenges).
   * @param onField - Whether to also check if the pokemon is currently on the field; default `false`
   * @returns Whether this pokemon is considered "active", as described above.
   * Returns `false` if there is no active {@linkcode BattleScene} or the pokemon is disallowed.
   */
  public isActive(onField = false): boolean {
    if (!globalScene) {
      return false;
    }
    return this.isAllowedInBattle() && (!onField || this.isOnField());
  }

  public getDexAttr(): bigint {
    let ret = 0n;
    if (this.gender !== Gender.GENDERLESS) {
      ret |= this.gender === Gender.FEMALE ? DexAttr.FEMALE : DexAttr.MALE;
    }
    ret |= this.shiny ? DexAttr.SHINY : DexAttr.NON_SHINY;
    ret |= this.variant >= 2 ? DexAttr.VARIANT_3 : this.variant === 1 ? DexAttr.VARIANT_2 : DexAttr.DEFAULT_VARIANT;
    ret |= globalScene.gameData.getFormAttr(this.formIndex);
    return ret;
  }

  /**
   * Sets the Pokemon's name. Only called when loading a Pokemon so this function needs to be called when
   * initializing hardcoded Pokemon or else it will not display the form index name properly.
   */
  public generateName(): void {
    if (!this.fusionSpecies) {
      this.name = this.species.getName(this.formIndex);
      return;
    }
    this.name = getFusedSpeciesName(
      this.species.getName(this.formIndex),
      this.fusionSpecies.getName(this.fusionFormIndex),
    );
    if (this.battleInfo) {
      this.updateInfo(true);
    }
  }

  /** Generate `abilityIndex` based on species and hidden ability if not pre-defined. */
  private generateAbilityIndex(): number {
    const hiddenAbilityChance = new ValueHolder(BASE_HIDDEN_ABILITY_RATE);
    // Ability Charms should only affect wild Pokemon
    // TODO: move this `if` check into the ability charm code
    if (!this.hasTrainer()) {
      globalScene.applyModifiers(HiddenAbilityRateBoosterModifier, true, hiddenAbilityChance);
    }

    // Neither RNG roll depends on the outcome of the other, so that Ability Charms do not affect RNG.
    const regularAbility = this.species.ability2 === this.species.ability1 ? 0 : randSeedInt(2);
    const useHiddenAbility = this.species.abilityHidden ? !randSeedInt(hiddenAbilityChance.value) : false;

    return useHiddenAbility ? 2 : regularAbility;
  }

  /**
   * Set this pokemon's illusion to the data of the given pokemon.
   *
   * @remarks
   * When setting the illusion of a wild pokemon, a {@linkcode PokemonSpecies} is generally passed.
   * When setting the illusion of a pokemon in this way, the fields required by illusion data
   * but missing from `PokemonSpecies` are set as follows
   * - `pokeball` and `nickname` are both inherited from this pokemon
   * - `shiny` will always be set if this pokemon OR its fusion is shiny
   * - `variant` will always be 0
   * - Fields related to fusion will be set to `undefined` or `0` as appropriate
   * - The gender is set to be the same as this pokemon, if it is compatible with the provided pokemon.
   *   - If the provided pokemon can only ever exist as one gender, it is always that gender
   *   - If this pokemon is genderless but the provided pokemon isn't, then a gender roll is done based on this
   *     pokemon's ID
   */
  setIllusion(pokemon: Pokemon | PokemonSpecies): boolean {
    this.breakIllusion();
    if (pokemon instanceof Pokemon) {
      const speciesId = pokemon.species.speciesId;

      this.summonData.illusion = {
        name: pokemon.name,
        nickname: pokemon.nickname,
        shiny: pokemon.shiny,
        variant: pokemon.variant,
        fusionShiny: pokemon.fusionShiny,
        fusionVariant: pokemon.fusionVariant,
        species: speciesId,
        formIndex: pokemon.formIndex,
        gender: pokemon.gender,
        pokeball: pokemon.pokeball,
        fusionFormIndex: pokemon.fusionFormIndex,
        fusionSpecies: pokemon.fusionSpecies || undefined,
        fusionGender: pokemon.fusionGender,
      };

      if (pokemon.shiny || pokemon.fusionShiny) {
        this.initShinySparkle();
      }
    } else {
      // Correct the gender in case the illusioned species has a gender incompatible with this pokemon
      let gender = this.gender;
      switch (pokemon.malePercent) {
        case null:
          gender = Gender.GENDERLESS;
          break;
        case 0:
          gender = Gender.FEMALE;
          break;
        case 100:
          gender = Gender.MALE;
          break;
        default:
          gender = (this.id % 256) * 0.390625 < pokemon.malePercent ? Gender.MALE : Gender.FEMALE;
      }
      /*
      TODO: Allow setting `variant` to something other than 0, which would require first loading the
      assets for the provided species, as its entry would otherwise not
      be guaranteed to exist in the `variantData` map. But this would prevent `summonData` from being populated
      until the assets are loaded, which would cause issues as this method cannot be easily promisified.
      */
      this.summonData.illusion = {
        fusionShiny: false,
        fusionVariant: 0,
        shiny: this.shiny || this.fusionShiny,
        variant: 0,
        nickname: this.nickname,
        name: pokemon.name,
        species: pokemon.speciesId,
        formIndex: pokemon.formIndex,
        gender,
        pokeball: this.pokeball,
      };

      if (this.shiny || this.fusionShiny) {
        this.initShinySparkle();
      }
    }
    this.loadAssets(false, true).then(() => this.playAnim());
    this.updateInfo();
    return true;
  }

  /**
   * Break the illusion of this pokemon, if it has an active illusion.
   * @returns Whether an illusion was broken.
   */
  breakIllusion(): boolean {
    if (!this.summonData.illusion) {
      return false;
    }
    this.summonData.illusion = null;
    if (this.isOnField()) {
      globalScene.playSound("PRSFX- Transform");
    }
    if (this.shiny) {
      this.initShinySparkle();
    }
    this.loadAssets(false).then(() => this.playAnim());
    this.updateInfo(true);
    return true;
  }

  abstract isPlayer(): this is PlayerPokemon;

  abstract isEnemy(): this is EnemyPokemon;

  abstract hasTrainer(): boolean;

  abstract getFieldIndex(): number;

  abstract getBattlerIndex(): BattlerIndex;

  /**
   * Load all assets needed for this Pokemon's use in battle
   * @param ignoreOverride - Whether to ignore overrides caused by {@linkcode MoveId.TRANSFORM | Transform}; default `true`
   * @param useIllusion - Whether to consider this pokemon's active illusion; default `false`
   * @returns A promise that resolves once all the corresponding assets have been loaded.
   */
  async loadAssets(ignoreOverride = true, useIllusion = false): Promise<void> {
    /** Promises that are loading assets and can be run concurrently. */
    const loadPromises: Promise<void>[] = [];
    // Assets for moves — defend against id-map drift where a moveset entry
    // points to an invalid move (e.g. ER custom move that failed to init).
    // We filter out undefined Move references rather than crash here, which
    // would otherwise hang ShowTrainerPhase → NextEncounterPhase → loadAssets
    // (user-visible "freeze when trainer loads").
    const moveIds = this.getMoveset()
      .map(m => m.getMove()?.id)
      .filter((id): id is MoveId => id !== undefined);
    loadPromises.push(loadMoveAnimations(moveIds));

    /** alias for `this.summonData.illusion`; bangs on this are safe when guarded with `useIllusion` being true   */
    const illusion = this.summonData.illusion;
    useIllusion = useIllusion && !!illusion;

    // Load the assets for the species form
    const formIndex = useIllusion ? illusion!.formIndex : this.formIndex;
    loadPromises.push(
      this.getSpeciesForm(false, useIllusion).loadAssets(
        this.getGender(useIllusion) === Gender.FEMALE,
        formIndex,
        this.isShiny(useIllusion),
        this.getVariant(useIllusion),
      ),
    );

    // Showdown 1v1 (C5): the versus GUEST's OWN team (authoritatively ENEMY instances) renders BACK
    // sprites via the perspective flip, so their back atlas MUST be preloaded here or they'd show a
    // substitute placeholder. `presentationIsBack()` collapses to `isPlayer()` off the versus-guest
    // path, so solo / co-op / host preload exactly as before (byte-identical). The host's team on the
    // guest (Player instances flipped to FRONT) needs no back atlas - its front is loaded by the
    // species-form loadAssets above.
    if (this.presentationIsBack() || this.getFusionSpeciesForm(false, useIllusion)) {
      // Guard against re-issuing an already-loaded (or in-flight) atlas: a
      // duplicate `loadPokemonAtlas` for the same key orphans files in Phaser's
      // shared loader and can wedge ALL sprite loads (the species loader has the
      // same guard). loadAssets is called repeatedly (illusion break, transform,
      // form change), so this matters.
      const playerBattleKey = this.getBattleSpriteKey(true, ignoreOverride);
      if (!globalScene.textures.exists(playerBattleKey)) {
        globalScene.loadPokemonAtlas(playerBattleKey, this.getBattleSpriteAtlasPath(true, ignoreOverride));
      }
    }
    // ER Black Shinies (#349): the t4 FRONT atlas lives under its own
    // `-erblack` key, which the species-form loadAssets above (vanilla keys
    // only) never queues. Without this an ENEMY black shiny (wild upgrade,
    // hell finale, dev scenarios) keys to a texture that was never loaded and
    // renders blank.
    const erBlackFrontKey = this.getBattleSpriteKey(false, ignoreOverride);
    if (erBlackFrontKey.endsWith("-erblack") && !globalScene.textures.exists(erBlackFrontKey)) {
      globalScene.loadPokemonAtlas(erBlackFrontKey, this.getBattleSpriteAtlasPath(false, ignoreOverride));
    }
    if (this.getFusionSpeciesForm()) {
      const { fusionFormIndex, fusionShiny, fusionVariant } = useIllusion ? illusion! : this;
      loadPromises.push(
        this.getFusionSpeciesForm(false, useIllusion).loadAssets(
          this.getFusionGender(false, useIllusion) === Gender.FEMALE,
          fusionFormIndex,
          fusionShiny,
          fusionVariant,
        ),
      );
      const fusionBattleKey = this.getFusionBattleSpriteKey(true, ignoreOverride);
      if (!globalScene.textures.exists(fusionBattleKey)) {
        globalScene.loadPokemonAtlas(fusionBattleKey, this.getFusionBattleSpriteAtlasPath(true, ignoreOverride));
      }
    }

    if (this.isShiny(true)) {
      loadPromises.push(
        populateVariantColors(this, false, ignoreOverride).then(() =>
          populateErShinyLabPaletteVariantColors(this, false),
        ),
      );
      if (this.isPlayer()) {
        loadPromises.push(
          populateVariantColors(this, true, ignoreOverride).then(() =>
            populateErShinyLabPaletteVariantColors(this, true),
          ),
        );
      }
    }

    const shinyLabLook = getErShinyLabSpriteFxLookForPokemon(this);
    if (shinyLabLook?.loadout.palette) {
      const frontSource = getErShinyLabPokemonBattleSource(this, false, ignoreOverride, shinyLabLook);
      if (frontSource.atlasPath && !globalScene.textures.exists(frontSource.key)) {
        globalScene.loadPokemonAtlas(frontSource.key, frontSource.atlasPath);
      }
      if (this.isPlayer()) {
        const backSource = getErShinyLabPokemonBattleSource(this, true, ignoreOverride, shinyLabLook);
        if (backSource.atlasPath && !globalScene.textures.exists(backSource.key)) {
          globalScene.loadPokemonAtlas(backSource.key, backSource.atlasPath);
        }
      }
    }

    await Promise.allSettled(loadPromises);

    // Wait for any queued sprite/atlas loads to finish. Every `loadPokemonAtlas`
    // above is guarded by `textures.exists(...)`, so on a cached load (save-load,
    // repeat encounter, transform/illusion refresh on an already-loaded form)
    // NOTHING gets queued. Calling `load.start()` on an empty/idle loader does
    // NOT emit COMPLETE, so a bare `await once(COMPLETE)` would hang forever — the
    // user-visible "mon shows a placeholder/substitute sprite and the game freezes
    // when it attacks" (the attack phase awaits loadAssets). Guard against that by
    // resolving immediately when, after `start()`, the loader is still idle (i.e.
    // there was nothing to load). Uses only `isLoading()`/`start()` so it stays
    // correct under the test harness's mocked loader too.
    await new Promise<void>(resolve => {
      const onComplete = () => resolve();
      globalScene.load.once(Phaser.Loader.Events.COMPLETE, onComplete);
      if (!globalScene.load.isLoading()) {
        globalScene.load.start();
      }
      // If start() found nothing to load, the loader stays idle and COMPLETE
      // will never fire — detach the listener and resolve now.
      if (!globalScene.load.isLoading()) {
        globalScene.load.off(Phaser.Loader.Events.COMPLETE, onComplete);
        resolve();
      }
    });

    // With the sprites loaded, generate the animation frame information.
    //
    // Do this for BOTH the player and the enemy battle sprite. The enemy's
    // front-sprite anim is normally built by the species-form `loadAssets` above,
    // but that only builds it inside `finalize()` (which requires the atlas
    // texture to be present): if that call settled via its ~10s safety-backstop
    // on a slow/contended load (the common trigger is loading a save, where the
    // whole party + both wild mons request atlases at once), the anim can be
    // missing — leaving the mon stuck on a substitute placeholder and logging
    // "Missing animation: pkmn__<id>". Rebuilding here closes that gap. It is
    // strictly gap-filling: guarded by `textures.exists` (never build frames for
    // an unloaded atlas) AND `!anims.exists` (never clobber an existing anim).
    // ER Black Shinies (#349): also gap-fill the FRONT `-erblack` anim for
    // PLAYER black shinies (summary screen / catch panel play the front key,
    // which the back-keyed build below never covers).
    const animKeys = new Set([this.getBattleSpriteKey(this.presentationIsBack(), ignoreOverride)]);
    const erBlackFrontAnimKey = this.getBattleSpriteKey(false, ignoreOverride);
    if (erBlackFrontAnimKey.endsWith("-erblack")) {
      animKeys.add(erBlackFrontAnimKey);
    }
    // ER (#396): also gap-fill the plain FRONT key - the evolution scene, egg
    // hatch and summary play `getSpriteKey()` (no "back__"), which the keys
    // above never cover for player mons. A redux shiny whose atlas finalize
    // was skipped logged "Missing animation: pkmn__er__<form>_shiny3" and the
    // evolution screen kept showing the PRE-evolution sprite.
    animKeys.add(this.getSpriteKey(ignoreOverride));
    for (const battleSpriteKey of animKeys) {
      if (!globalScene.textures.exists(battleSpriteKey) || globalScene.anims.exists(battleSpriteKey)) {
        continue;
      }
      const originalWarn = console.warn;
      // Ignore warnings for missing frames, because there will be a lot
      console.warn = () => {};
      const battleFrameNames = globalScene.anims.generateFrameNames(battleSpriteKey, {
        zeroPad: 4,
        suffix: ".png",
        start: 1,
        end: 400,
      });
      console.warn = originalWarn;
      globalScene.anims.create({
        key: battleSpriteKey,
        frames: battleFrameNames,
        frameRate: 10,
        repeat: -1,
      });
      // ER: honour a multi-frame custom atlas's authored cadence (no-op otherwise).
      applyErAtlasFrameRate(globalScene.anims, battleSpriteKey, globalScene.textures.get(battleSpriteKey)?.customData);
    }
    // With everything loaded, now begin playing the animation.
    this.playAnim();

    // update the fusion palette
    this.updateFusionPalette();
    if (this.summonData.speciesForm) {
      this.updateFusionPalette(true);
    }
  }

  /**
   * Gracefully handle errors loading a variant sprite. Log if it fails and attempt to fall back on
   * non-experimental sprites before giving up.
   *
   * @param cacheKey - The cache key for the variant color sprite
   * @param attemptedSpritePath - The sprite path that failed to load
   * @param useExpSprite - Whether the attempted sprite was experimental
   * @param battleSpritePath - The filename of the sprite
   * @param optionalParams - Any additional params to log
   */
  async fallbackVariantColor(
    cacheKey: string,
    attemptedSpritePath: string,
    useExpSprite: boolean,
    battleSpritePath: string,
    ...optionalParams: any[]
  ) {
    console.warn(`Could not load ${attemptedSpritePath}!`, ...optionalParams);
    if (useExpSprite) {
      await this.populateVariantColorCache(cacheKey, false, battleSpritePath);
    }
  }

  /**
   * Attempt to process variant sprite color caches.
   * @param cacheKey - the cache key for the variant color sprite
   * @param useExpSprite - Whether experimental sprites should be used if present
   * @param battleSpritePath - the filename of the sprite
   */
  async populateVariantColorCache(cacheKey: string, useExpSprite: boolean, battleSpritePath: string) {
    const spritePath = `./images/pokemon/variant/${useExpSprite ? "exp/" : ""}${battleSpritePath}.json`;
    return cachedFetch(spritePath)
      .then(res => {
        // Prevent the JSON from processing if it failed to load
        if (!res.ok) {
          return this.fallbackVariantColor(
            cacheKey,
            res.url,
            useExpSprite,
            battleSpritePath,
            res.status,
            res.statusText,
          );
        }
        return res.json();
      })
      .catch(error => {
        return this.fallbackVariantColor(cacheKey, spritePath, useExpSprite, battleSpritePath, error);
      })
      .then(c => {
        if (c != null) {
          variantColorCache[cacheKey] = c;
        }
      });
  }

  getFormKey(): string {
    if (this.species.forms.length === 0 || this.species.forms.length <= this.formIndex) {
      return "";
    }
    return this.species.forms[this.formIndex].formKey;
  }

  getFusionFormKey(): string | null {
    if (!this.fusionSpecies) {
      return null;
    }
    if (this.fusionSpecies.forms.length === 0 || this.fusionSpecies.forms.length <= this.fusionFormIndex) {
      return "";
    }
    return this.fusionSpecies.forms[this.fusionFormIndex].formKey;
  }

  //#region Atlas and sprite ID methods
  // TODO: Add more documentation for all these attributes.
  // They may be all similar, but what each one actually _does_ is quite unclear at first glance

  getSpriteAtlasPath(ignoreOverride = false): string {
    // Delegate to the species form's `getSpriteAtlasPath` rather than deriving
    // the path from the sprite id. ER-custom species (`ErCustomSpecies`) use a
    // different atlas-path scheme than their sprite-key scheme (key `er__{slug}`
    // vs path `elite-redux/{slug}/front`), so the old id→path string-replace
    // produced a wrong path (`er/{slug}`) and 404'd. The override is authoritative.
    const formIndex = this.summonData.illusion?.formIndex ?? this.formIndex;
    // ER Black Shinies (#349): use the generated t4 atlas when it exists
    // (base form only — forms fall back to the interim tint).
    if (isErBlackShiny(this) && formIndex === 0) {
      const black = erBlackSpritePath(this.species.speciesId, false);
      if (black) {
        return black;
      }
    }
    const basePath = this.getSpeciesForm(ignoreOverride, true).getSpriteAtlasPath(
      this.getGender(ignoreOverride, true) === Gender.FEMALE,
      formIndex,
      this.shiny,
      this.variant,
    );
    // ER CUSTOM black shinies (#349/#393): slug-based atlases are keyed by
    // their PLAIN base path (elite-redux/{slug}/front ->
    // black/elite-redux/{slug}/front). No formIndex gate: Redux FORMS of
    // vanilla species resolve to a slug path too. CRITICAL: black shinies ARE
    // shiny, so `basePath` is the SHINY path (elite-redux/{slug}/shiny-3) and
    // never matched the manifest - every Redux black shiny fell back to the
    // tint placeholder. Look up with shiny=false (black art replaces the
    // shiny look entirely).
    if (isErBlackShiny(this)) {
      const plainPath = this.getSpeciesForm(ignoreOverride, true).getSpriteAtlasPath(
        this.getGender(ignoreOverride, true) === Gender.FEMALE,
        formIndex,
        false,
        0,
      );
      const blackCustom = erBlackSpritePathFromBase(plainPath);
      if (blackCustom) {
        return blackCustom;
      }
    }
    return basePath;
  }

  /**
   * Showdown 1v1 (C5): whether THIS mon renders on the ON-SCREEN PLAYER (bottom) side from this
   * client's viewpoint. Normally `=== isPlayer()`. On the versus GUEST the perspective flip inverts
   * it so the guest's OWN team (authoritatively the ENEMY side) presents on the bottom and the host's
   * team on top. Presentation-only + read-only: it feeds ONLY render decisions (back-vs-front sprite
   * default, info-panel slide direction) - never authoritative state / the checksum - and collapses
   * to `isPlayer()` off the versus-guest path (solo / co-op / host byte-identical).
   */
  private presentationIsPlayerSide(): boolean {
    return this.isPlayer();
  }

  /**
   * The DEFAULT battle-sprite orientation (BACK sprite vs front): the player-side mons face away
   * (back sprite). Task F1 collapsed the former Showdown presentation flip into the data-level side
   * swap (`showdown-side-swap.ts`), so rendering is now correct by construction on every client and
   * this is simply {@linkcode isPlayer}.
   */
  private presentationIsBack(): boolean {
    return this.presentationIsPlayerSide();
  }

  getBattleSpriteAtlasPath(back?: boolean, ignoreOverride?: boolean): string {
    if (back === undefined) {
      back = this.presentationIsBack();
    }
    // Same rationale as `getSpriteAtlasPath`: delegate to the species form's
    // override so ER-custom BACK sprites resolve to `elite-redux/{slug}/back`
    // instead of the bogus `back/er/{slug}` the id→path replace produced (which
    // 404'd → missing player back sprite → battle softlock).
    const formIndex = this.summonData.illusion?.formIndex ?? this.formIndex;
    // ER Black Shinies (#349): generated t4 atlas (front or back) when present.
    if (isErBlackShiny(this) && formIndex === 0) {
      const black = erBlackSpritePath(this.species.speciesId, !!back);
      if (black) {
        return black;
      }
    }
    const baseBattlePath = this.getSpeciesForm(ignoreOverride, true).getSpriteAtlasPath(
      this.getGender(ignoreOverride, true) === Gender.FEMALE,
      formIndex,
      this.shiny,
      this.variant,
      back,
    );
    // ER CUSTOM black shinies (#349/#393): slug-based scheme, keyed by the
    // PLAIN base path. As in getSpriteAtlasPath: black shinies are shiny, so
    // the shiny battle path (elite-redux/{slug}/shiny-back-3) never matched
    // the front/back manifest keys - resolve with shiny=false instead.
    if (isErBlackShiny(this)) {
      const plainBattlePath = this.getSpeciesForm(ignoreOverride, true).getSpriteAtlasPath(
        this.getGender(ignoreOverride, true) === Gender.FEMALE,
        formIndex,
        false,
        0,
        back,
      );
      const blackCustom = erBlackSpritePathFromBase(plainBattlePath);
      if (blackCustom) {
        return blackCustom;
      }
    }
    return baseBattlePath;
  }

  getSpriteId(ignoreOverride?: boolean): string {
    const formIndex = this.summonData.illusion?.formIndex ?? this.formIndex;
    return this.getSpeciesForm(ignoreOverride, true).getSpriteId(
      this.getGender(ignoreOverride, true) === Gender.FEMALE,
      formIndex,
      this.shiny,
      this.variant,
    );
  }

  getBattleSpriteId(back?: boolean, ignoreOverride?: boolean): string {
    if (back === undefined) {
      back = this.presentationIsBack();
    }

    const formIndex = this.summonData.illusion?.formIndex ?? this.formIndex;

    return this.getSpeciesForm(ignoreOverride, true).getSpriteId(
      this.getGender(ignoreOverride, true) === Gender.FEMALE,
      formIndex,
      this.shiny,
      this.variant,
      back,
    );
  }

  getSpriteKey(ignoreOverride?: boolean): string {
    const base = this.getSpeciesForm(ignoreOverride, false).getSpriteKey(
      this.getGender(ignoreOverride) === Gender.FEMALE,
      this.formIndex,
      this.isShiny(false),
      this.getVariant(false),
    );
    // ER Black Shinies (#349): distinct texture key for the t4 atlas
    // (numeric scheme OR slug-based ER-custom scheme). The resolved atlas
    // path is authoritative - no formIndex gate (Redux forms have slug art).
    if (isErBlackShiny(this) && this.getSpriteAtlasPath(ignoreOverride).startsWith("black/")) {
      return `${base}-erblack`;
    }
    return base;
  }

  getBattleSpriteKey(back?: boolean, ignoreOverride?: boolean): string {
    const base = `pkmn__${this.getBattleSpriteId(back, ignoreOverride)}`;
    if (back === undefined) {
      back = this.presentationIsBack();
    }
    // ER Black Shinies (#349): distinct texture key for the t4 atlas
    // (numeric scheme OR slug-based ER-custom scheme). The resolved atlas
    // path is authoritative - no formIndex gate (Redux forms have slug art).
    if (isErBlackShiny(this) && this.getBattleSpriteAtlasPath(back, ignoreOverride).startsWith("black/")) {
      return `${base}-erblack`;
    }
    return base;
  }

  getFusionSpriteId(ignoreOverride?: boolean): string {
    const fusionFormIndex = this.summonData.illusion?.fusionFormIndex ?? this.fusionFormIndex;
    return this.getFusionSpeciesForm(ignoreOverride, true).getSpriteId(
      this.getFusionGender(ignoreOverride, true) === Gender.FEMALE,
      fusionFormIndex,
      this.fusionShiny,
      this.fusionVariant,
    );
  }

  getFusionBattleSpriteId(back?: boolean, ignoreOverride?: boolean): string {
    if (back === undefined) {
      back = this.presentationIsBack();
    }

    const fusionFormIndex = this.summonData.illusion?.fusionFormIndex ?? this.fusionFormIndex;

    return this.getFusionSpeciesForm(ignoreOverride, true).getSpriteId(
      this.getFusionGender(ignoreOverride, true) === Gender.FEMALE,
      fusionFormIndex,
      this.fusionShiny,
      this.fusionVariant,
      back,
    );
  }

  getFusionBattleSpriteKey(back?: boolean, ignoreOverride?: boolean): string {
    return `pkmn__${this.getFusionBattleSpriteId(back, ignoreOverride)}`;
  }

  getFusionBattleSpriteAtlasPath(back?: boolean, ignoreOverride?: boolean): string {
    if (back === undefined) {
      back = this.presentationIsBack();
    }
    // Delegate to the fusion species form's `getSpriteAtlasPath` override (same
    // ER-custom key-vs-path scheme fix as `getBattleSpriteAtlasPath`), so an
    // ER-custom fusion partner's back sprite resolves to `elite-redux/{slug}/back`
    // rather than the bogus `back/er/{slug}`.
    const fusionFormIndex = this.summonData.illusion?.fusionFormIndex ?? this.fusionFormIndex;
    return this.getFusionSpeciesForm(ignoreOverride, true).getSpriteAtlasPath(
      this.getFusionGender(ignoreOverride, true) === Gender.FEMALE,
      fusionFormIndex,
      this.fusionShiny,
      this.fusionVariant,
      back,
    );
  }

  getIconAtlasKey(ignoreOverride = false, useIllusion = true): string {
    const illusion = this.summonData.illusion;
    const { formIndex, variant } = useIllusion && illusion ? illusion : this;
    return this.getSpeciesForm(ignoreOverride, useIllusion).getIconAtlasKey(
      formIndex,
      this.isBaseShiny(useIllusion),
      variant,
    );
  }

  getFusionIconAtlasKey(ignoreOverride = false, useIllusion = true): string {
    const illusion = this.summonData.illusion;
    const { fusionFormIndex, fusionVariant } = useIllusion && illusion ? illusion : this;
    return this.getFusionSpeciesForm(ignoreOverride, useIllusion).getIconAtlasKey(
      fusionFormIndex,
      this.isFusionShiny(),
      fusionVariant,
    );
  }

  getIconId(ignoreOverride?: boolean, useIllusion = false): string {
    const illusion = this.summonData.illusion;
    const { formIndex, variant } = useIllusion && illusion ? illusion : this;
    return this.getSpeciesForm(ignoreOverride, useIllusion).getIconId(
      this.getGender(ignoreOverride, useIllusion) === Gender.FEMALE,
      formIndex,
      this.isBaseShiny(),
      variant,
    );
  }

  getFusionIconId(ignoreOverride?: boolean, useIllusion = true): string {
    const illusion = this.summonData.illusion;
    const { fusionFormIndex, fusionVariant } = useIllusion && illusion ? illusion : this;
    return this.getFusionSpeciesForm(ignoreOverride, useIllusion).getIconId(
      this.getFusionGender(ignoreOverride, useIllusion) === Gender.FEMALE,
      fusionFormIndex,
      this.isFusionShiny(),
      fusionVariant,
    );
  }

  /**
   * Icon frame id for this Pokemon's **base form** (formIndex 0), keeping the
   * same gender / shiny / variant resolution as {@linkcode getIconId}.
   *
   * Elite Redux adds extra forms (e.g. `"redux"`) to many vanilla species, but
   * those forms have no dedicated icon frame in the bundled `pokemon_icons_N`
   * atlas — `getIconId` returns e.g. `"21-redux"` for a redux Spearow, a frame
   * that does not exist. This resolves to the base-species frame (`"21"`,
   * `"21s"` for shiny, `"521-f"` for gendered, etc.) which always exists and
   * shows the correct Pokémon. Used as the icon fallback in
   * {@linkcode BattleScene.addPokemonIcon}.
   *
   * Note: this calls {@linkcode PokemonSpecies.getIconId} on the *species*
   * (not the {@linkcode PokemonSpeciesForm} returned by `getSpeciesForm`),
   * because a form's `getFormSpriteKey` ignores the passed `formIndex` and
   * always re-appends its own `formKey` — so calling it with `formIndex = 0`
   * would still yield the broken `"<id>-<formKey>"` frame.
   */
  getBaseIconId(useIllusion = false): string {
    const illusion = this.summonData.illusion;
    const species = useIllusion && illusion ? getPokemonSpecies(illusion.species) : this.species;
    const variant = useIllusion && illusion ? illusion.variant : this.variant;
    return species.getIconId(
      this.getGender(false, useIllusion) === Gender.FEMALE,
      0,
      this.isBaseShiny(useIllusion),
      variant,
    );
  }
  //#endregion Atlas and sprite ID methods

  /**
   * Return this Pokemon's {@linkcode PokemonSpeciesForm | SpeciesForm}.
   * @param ignoreOverride - Whether to ignore any overrides caused by {@linkcode MoveId.TRANSFORM | Transform}; default `false`
   * and overrides `useIllusion`.
   * @param useIllusion - Whether to consider this Pokemon's illusion if present; default `false`.
   * @returns This Pokemon's {@linkcode PokemonSpeciesForm}.
   */
  getSpeciesForm(ignoreOverride = false, useIllusion = false): PokemonSpeciesForm {
    if (!ignoreOverride && this.summonData.speciesForm) {
      return this.summonData.speciesForm;
    }

    const species: PokemonSpecies =
      useIllusion && this.summonData.illusion ? getPokemonSpecies(this.summonData.illusion.species) : this.species;
    const formIndex = useIllusion && this.summonData.illusion ? this.summonData.illusion.formIndex : this.formIndex;

    if (species.forms && species.forms.length > 0) {
      return species.forms[formIndex];
    }

    return species;
  }

  /**
   * Getter function that returns whether this {@linkcode Pokemon} is currently transformed into another one
   * (such as by the effects of {@linkcode MoveId.TRANSFORM} or {@linkcode AbilityId.IMPOSTER}.
   * @returns Whether this Pokemon is currently transformed.
   */
  public isTransformed(): boolean {
    return this.summonData.speciesForm !== null;
  }

  /**
   * Return whether this Pokemon can transform into an opposing Pokemon.
   * @param target - The {@linkcode Pokemon} being transformed into
   * @returns Whether this Pokemon can transform into `target`.
   */
  public canTransformInto(target: Pokemon): boolean {
    return !(
      // Neither pokemon can be already transformed
      (
        this.isTransformed()
        || target.isTransformed() // Neither pokemon can be behind an illusion
        || target.summonData.illusion
        || this.summonData.illusion // The target cannot be behind a substitute
        || target.getTag(BattlerTagType.SUBSTITUTE) // Transforming to/from fusion pokemon causes various problems (crashes, etc.) // TODO: Consider lifting restriction once bug is fixed
        || this.isFusion()
        || target.isFusion()
      )
    );
  }

  /**
   * Return the {@linkcode PokemonSpeciesForm | SpeciesForm} of this Pokemon's fusion counterpart.
   * @param ignoreOverride - Whether to ignore species overrides caused by {@linkcode MoveId.TRANSFORM | Transform}; default `false`
   * @param useIllusion - Whether to consider the species of this Pokemon's illusion; default `false`
   * @returns The {@linkcode PokemonSpeciesForm} of this Pokemon's fusion counterpart.
   */
  public getFusionSpeciesForm(ignoreOverride = false, useIllusion = false): PokemonSpeciesForm {
    const fusionSpecies: PokemonSpecies =
      useIllusion && this.summonData.illusion ? this.summonData.illusion.fusionSpecies! : this.fusionSpecies!;
    const fusionFormIndex =
      useIllusion && this.summonData.illusion ? this.summonData.illusion.fusionFormIndex! : this.fusionFormIndex;

    if (!ignoreOverride && this.summonData.fusionSpeciesForm) {
      return this.summonData.fusionSpeciesForm;
    }
    if (fusionSpecies?.forms?.length === 0 || fusionFormIndex >= fusionSpecies?.forms.length) {
      return fusionSpecies;
    }
    return fusionSpecies?.forms[fusionFormIndex];
  }

  getSprite(): Phaser.GameObjects.Sprite {
    return this.getAt(0);
  }

  getTintSprite(): Phaser.GameObjects.Sprite | null {
    return this.maskEnabled ? this.maskSprite : this.tintSprite;
  }

  getSpriteScale(): number {
    const formKey = this.getFormKey();
    if (
      this.isMax() === true
      || formKey === "segin-starmobile"
      || formKey === "schedar-starmobile"
      || formKey === "navi-starmobile"
      || formKey === "ruchbah-starmobile"
      || formKey === "caph-starmobile"
    ) {
      // G-Max and starmobiles have flat 1.5x scale
      return 1.5;
    }

    // TODO: Rather than using -1 as a default... why don't we just change it to 1????????
    if (this.customPokemonData.spriteScale <= 0) {
      return 1;
    }
    return this.customPokemonData.spriteScale;
  }

  /** Resets the pokemon's field sprite properties, including position, alpha, and scale */
  public resetSprite(): void {
    // Resetting properties should not be shown on the field
    this.setVisible(false);

    // Remove the offset from having a Substitute active
    if (this.isOffsetBySubstitute()) {
      this.x -= this.getSubstituteOffset()[0];
      this.y -= this.getSubstituteOffset()[1];
    }

    // Reset sprite display properties
    this.setAlpha(1);
    this.setScale(this.getSpriteScale());
  }

  getHeldItems(): PokemonHeldItemModifier[] {
    if (!globalScene) {
      return [];
    }
    return globalScene.findModifiers(
      m => m instanceof PokemonHeldItemModifier && m.pokemonId === this.id,
      this.isPlayer(),
    ) as PokemonHeldItemModifier[];
  }

  updateScale(): void {
    this.setScale(this.getSpriteScale());
  }

  async updateSpritePipelineData(): Promise<void> {
    [this.getSprite(), this.getTintSprite()]
      .filter(s => !!s)
      .map(s => {
        s.pipelineData["teraColor"] = getTypeRgb(this.getTeraType());
        s.pipelineData["isTerastallized"] = this.isTerastallized;
      });
    await this.updateInfo(true);
  }

  initShinySparkle(): void {
    const shinySparkle = globalScene.addFieldSprite(0, 0, "shiny");
    shinySparkle.setVisible(false);
    shinySparkle.setOrigin(0.5, 1);
    this.add(shinySparkle);

    this.shinySparkle = shinySparkle;
  }

  /**
   * Attempts to animate a given {@linkcode Phaser.GameObjects.Sprite}
   * @see {@linkcode Phaser.GameObjects.Sprite.play}
   * @param sprite - Sprite to animate
   * @param tintSprite - Sprite placed on top of the sprite to add a color tint
   * @param animConfig - String to pass to the sprite's {@linkcode Phaser.GameObjects.Sprite.play | play} method
   * @returns true if the sprite was able to be animated
   */
  tryPlaySprite(sprite: Phaser.GameObjects.Sprite, tintSprite: Phaser.GameObjects.Sprite, key: string): boolean {
    // Catch errors when trying to play an animation that doesn't exist
    try {
      sprite.play(key);
      tintSprite.play(key);
    } catch (error: unknown) {
      console.error(`Couldn't play animation for '${key}'!\nIs the image for this Pokemon missing?\n`, error);

      return false;
    }

    return true;
  }

  playAnim(): void {
    this.tryPlaySprite(this.getSprite(), this.getTintSprite()!, this.getBattleSpriteKey()); // TODO: is the bang correct?
    this.refreshErShinyLabBattleFx();
  }

  private startErShinyLabBattleFxTimer(): void {
    if (this.erShinyLabFxTimer) {
      return;
    }
    this.erShinyLabFxTimer = globalScene.time.addEvent({
      delay: 100,
      loop: true,
      callback: () => {
        if (!this.active || !this.visible || !this.isOnField()) {
          return;
        }
        this.refreshErShinyLabBattleFx();
      },
    });
  }

  private stopErShinyLabBattleFxTimer(): void {
    this.erShinyLabFxTimer?.remove();
    this.erShinyLabFxTimer = null;
  }

  private restoreErShinyLabTintSprite(): void {
    const sprite = this.getSprite();
    this.tintSprite?.setTexture(sprite.texture.key, sprite.frame?.name).setOrigin(sprite.originX, sprite.originY);
  }

  private refreshErShinyLabBattleFx(): void {
    const look = getErShinyLabSpriteFxLookForPokemon(this);
    if (!this.erShinyLabFxOverlay || !hasErShinyLabExactSpriteFx(look)) {
      this.restoreErShinyLabTintSprite();
      this.erShinyLabFxOverlay?.hide();
      this.stopErShinyLabBattleFxTimer();
      return;
    }

    const source = {
      ...getErShinyLabPokemonBattleSource(this, this.isPlayer(), undefined, look),
      frame: this.getSprite().frame?.name,
    };
    if (this.erShinyLabFxOverlay.refresh(look, source, getErShinyLabSpriteFxTime())) {
      this.erShinyLabFxOverlay.copyTextureTo(this.tintSprite);
      this.getSprite().setVisible(false);
      this.startErShinyLabBattleFxTimer();
    } else {
      this.restoreErShinyLabTintSprite();
      this.erShinyLabFxOverlay.hide();
      this.stopErShinyLabBattleFxTimer();
    }
  }

  getFieldPositionOffset(): [number, number] {
    // Multi-format: spacing widens with the side's capacity (binary keeps the legacy +/-32;
    // a 3-wide side spreads + staggers so all three sprites stay separated). See battle-format.
    const arr = globalScene.currentBattle?.arrangement;
    const capacity = arr ? (this.isPlayer() ? arr.playerCapacity : arr.enemyCapacity) : 1;
    return fieldSpriteOffset(this.fieldPosition, capacity, this.isPlayer());
  }

  /**
   * Returns the Pokemon's offset from its current field position in the event that
   * it has a Substitute doll in effect. The offset is returned in `[ x, y ]` format.
   * @see {@linkcode SubstituteTag}
   * @see {@linkcode getFieldPositionOffset}
   */
  getSubstituteOffset(): [number, number] {
    return this.isPlayer() ? [-30, 10] : [30, -10];
  }

  /**
   * Returns whether or not the Pokemon's position on the field is offset because
   * the Pokemon has a Substitute active.
   * @see {@linkcode SubstituteTag}
   */
  isOffsetBySubstitute(): boolean {
    const substitute = this.getTag(SubstituteTag);
    if (!substitute || substitute.sprite === undefined) {
      return false;
    }
    // During the Pokemon's MoveEffect phase, the offset is removed to put the Pokemon "in focus"
    const currentPhase = globalScene.phaseManager.getCurrentPhase();
    return !(currentPhase.is("MoveEffectPhase") && currentPhase.getPokemon() === this);
  }

  /** If this Pokemon has a Substitute on the field, removes its sprite from the field. */
  destroySubstitute(): void {
    const substitute = this.getTag(SubstituteTag);
    if (substitute?.sprite) {
      substitute.sprite.destroy();
    }
  }

  /**
   * Set the field position of this Pokémon
   * @param fieldPosition - The new field position
   * @param duration - How long the transition should take, in milliseconds; if `0` or `undefined`, the position is changed instantly
   */
  public setFieldPosition(fieldPosition: FieldPosition, duration?: number): Promise<void> {
    return new Promise(resolve => {
      // Multi-format: apply the bar's mini + per-slot stacking for this mon's CURRENT field
      // slot BEFORE the position-change early-return. A triple's CENTRE mon keeps the default
      // CENTER position, so the early-return previously left its bar full-size + overlapping
      // the others. Binary is unchanged (single -> mini false + slot 0 = no-op; the two double
      // mons always change position so this ran anyway).
      const arr = globalScene.currentBattle?.arrangement;
      const sideCapacity = arr ? (this.isPlayer() ? arr.playerCapacity : arr.enemyCapacity) : 1;
      // Only a PLAYER's lone single mon uses the big bar; every other case (any multi-mon
      // side, and all enemy bars) uses the compact mini bar. This matches the legacy result
      // exactly for single/double (the setMini guard makes the redundant calls no-ops) while
      // also making a triple's CENTRE mon mini (the bug: its bar was full-size + overlapping).
      this.battleInfo.setMini(!(this.isPlayer() && sideCapacity === 1));
      this.battleInfo.setSlotOffset(this.getFieldIndex(), sideCapacity);
      // Triple+: thin the stacked bars and shift them off the sprites (player down, enemy up).
      this.battleInfo.applyTripleThin(sideCapacity, this.isPlayer());

      if (fieldPosition === this.fieldPosition) {
        resolve();
        return;
      }

      const initialOffset = this.getFieldPositionOffset();

      this.fieldPosition = fieldPosition;

      const newOffset = this.getFieldPositionOffset();

      const relX = newOffset[0] - initialOffset[0];
      const relY = newOffset[1] - initialOffset[1];

      const subTag = this.getTag(SubstituteTag);

      if (duration) {
        // TODO: can this use stricter typing?
        const targets: any[] = [this];
        if (subTag?.sprite) {
          targets.push(subTag.sprite);
        }
        globalScene.tweens.add({
          targets,
          x: (_target, _key, value: number) => value + relX,
          y: (_target, _key, value: number) => value + relY,
          duration,
          ease: "Sine.easeOut",
          onComplete: () => resolve(),
        });
      } else {
        this.x += relX;
        this.y += relY;
        if (subTag?.sprite) {
          subTag.sprite.x += relX;
          subTag.sprite.y += relY;
        }
      }
    });
  }

  /**
   * Retrieves the entire set of stats of this {@linkcode Pokemon}.
   * @param bypassSummonData - Whether to prefer actual stats (`true`) or in-battle overridden stats (`false`); default `true`
   * @returns The numeric values of this {@linkcode Pokemon}'s stats as an array.
   */
  getStats(bypassSummonData = true): number[] {
    if (!bypassSummonData) {
      // Only grab summon data stats if nonzero
      return this.summonData.stats.map((s, i) => s || this.stats[i]);
    }
    return this.stats;
  }

  /**
   * Retrieves the corresponding {@linkcode PermanentStat} of the {@linkcode Pokemon}.
   * @param stat - The {@linkcode PermanentStat} to retrieve
   * @param bypassSummonData - Whether to prefer actual stats (`true`) or in-battle overridden stats (`false`); default `true`
   * @returns The numeric value of the desired {@linkcode Stat}.
   */
  getStat(stat: PermanentStat, bypassSummonData = true): number {
    if (!bypassSummonData) {
      // 0 = no override
      return this.summonData.stats[stat] || this.stats[stat];
    }
    return this.stats[stat];
  }

  /**
   * Change one of this {@linkcode Pokemon}'s {@linkcode PermanentStat}s to the specified value.
   * @param stat - The {@linkcode PermanentStat} to be overwritten
   * @param value - The stat value to set. Ignored if `<=0`
   * @param bypassSummonData - Whether to write to actual stats (`true`) or in-battle overridden stats (`false`); default `true`
   */
  setStat(stat: PermanentStat, value: number, bypassSummonData = true): void {
    if (value <= 0) {
      return;
    }

    if (bypassSummonData) {
      this.stats[stat] = value;
    } else {
      this.summonData.stats[stat] = value;
    }
  }

  /**
   * Retrieves the entire set of in-battle stat stages of the {@linkcode Pokemon}.
   * @returns the numeric values of the {@linkcode Pokemon}'s in-battle stat stages if available, a fresh stat stage array otherwise
   */
  getStatStages(): number[] {
    return this.summonData.statStages;
  }

  /**
   * Retrieve the value of the given stat stage for this {@linkcode Pokemon}.
   * @param stat - The {@linkcode BattleStat} to retrieve the stat stage for
   * @returns The value of the desired stat stage as a number within the range `[-6, +6]`.
   */
  getStatStage(stat: BattleStat): number {
    return this.summonData.statStages[stat - 1];
  }

  /**
   * Sets this {@linkcode Pokemon}'s in-battle stat stage to the corresponding value.
   * @param stat - The {@linkcode BattleStat} whose stage is to be overwritten
   * @param value - The value of the stat stage to set, forcibly clamped within the range `[-6, +6]`.
   */
  setStatStage(stat: BattleStat, value: number): void {
    this.summonData.statStages[stat - 1] = Phaser.Math.Clamp(value, -6, 6);
  }

  /**
   * Calculate the critical-hit stage of a move used **against** this pokemon by
   * the given source.
   *
   * @param source - The {@linkcode Pokemon} using the move
   * @param move - The {@linkcode Move} being used
   * @returns The final critical-hit stage value
   */
  getCritStage(source: Pokemon, move: Move): number {
    const critStage = new NumberHolder(0);
    applyMoveAttrs("HighCritAttr", source, this, move, critStage);
    globalScene.applyModifiers(CritBoosterModifier, source.isPlayer(), source, critStage);
    globalScene.applyModifiers(TempCritBoosterModifier, source.isPlayer(), critStage);
    applyAbAttrs("BonusCritAbAttr", { pokemon: source, critStage });
    const critBoostTag = source.getTag(CritBoostTag);
    if (critBoostTag) {
      // Dragon cheer only gives +1 crit stage to non-dragon types
      critStage.value += critBoostTag.critStages;
    }

    // ER Battle Aura: while any holder is on the field, every battler gets a
    // crit-stage bonus. Scanned by name (registration-free); max, not sum.
    let fieldCritBonus = 0;
    for (const p of globalScene.getField(true)) {
      for (const attr of p.getAllActiveAbilityAttrs()) {
        if (attr?.constructor?.name === "FieldCritBoostAbAttr") {
          fieldCritBonus = Math.max(fieldCritBonus, (attr as unknown as { bonus: number }).bonus);
        }
      }
    }
    critStage.value += fieldCritBonus;

    // ER Pretentious: the attacker's accumulated KO crit-stacks. Scanned by name.
    for (const attr of source.getAllActiveAbilityAttrs()) {
      if (attr?.constructor?.name === "CritStackOnKoAbAttr") {
        critStage.value += (attr as unknown as { currentStacks: (p: Pokemon) => number }).currentStacks(source);
      }
    }

    // ER biome identity (#439 §3 Group F): the Abyss sharpens Dark-type attackers
    // - a +1 crit stage while fighting on the dread floor.
    if (getErBiomeRule(globalScene.arena.biomeId)?.darkCritBoost && source.isOfType(PokemonType.DARK)) {
      critStage.value += 1;
    }

    console.log(`crit stage: +${critStage.value}`);
    return critStage.value;
  }

  /**
   * Calculates the category of a move when used by this pokemon after
   * category-changing move effects are applied.
   * @param target - The {@linkcode Pokemon} using the move
   * @param move - The {@linkcode Move} being used
   * @returns The given move's final category
   */
  getMoveCategory(target: Pokemon, move: Move): MoveCategory {
    const moveCategory = new NumberHolder(move.category);
    applyMoveAttrs("VariableMoveCategoryAttr", this, target, move, moveCategory);
    return moveCategory.value;
  }

  /**
   * Calculates and retrieves the final value of a stat considering any held
   * items, move effects, opponent abilities, and whether there was a critical
   * hit.
   * @param stat - The desired {@linkcode EffectiveStat | Stat} to check.
   * @param opponent - The {@linkcode Pokemon} being targeted, if applicable.
   * @param move - The {@linkcode Move} being used, if any. Used to check ability ignoring effects and similar.
   * @param ignoreAbility - Whether to ignore ability effects of the user; default `false`.
   * @param ignoreOppAbility - Whether to ignore ability effects of the target; default `false`.
   * @param ignoreAllyAbility - Whether to ignore ability effects of the user's allies; default `false`.
   * @param isCritical - Whether a critical hit has occurred or not; default `false`.
   * If `true`, will nullify offensive stat drops or defensive stat boosts.
   * @param simulated - Whether to nullify any effects that produce changes to game state during calculations; default `true`
   * @param ignoreHeldItems - Whether to ignore the user's held items during stat calculation; default `false`.
   * @returns The final in-battle value for the given stat.
   */
  // TODO: Replace the optional parameters with an object to make calling this method less cumbersome
  getEffectiveStat(
    stat: EffectiveStat,
    opponent?: Pokemon,
    move?: Move,
    ignoreAbility = false,
    ignoreOppAbility = false,
    ignoreAllyAbility = false,
    isCritical = false,
    simulated = true,
    ignoreHeldItems = false,
  ): number {
    // ER Wonder Room (move 472): while active, ATK and SpAtk are swapped
    // field-wide, and their stat stages ("buffs") are ignored. The swap reads
    // the OTHER offensive stat's RAW base value; the stat-stage multiplier is
    // skipped for the swapped stat below. Ability/held-item multipliers stay
    // keyed to the requested offensive slot (they are not stat "buffs").
    const wonderRoomSwapped = (stat === Stat.ATK || stat === Stat.SPATK) && isWonderRoomActive();
    const baseStat = wonderRoomSwapped ? (stat === Stat.ATK ? Stat.SPATK : Stat.ATK) : stat;
    const statVal = new NumberHolder(this.getStat(baseStat, false));
    if (!ignoreHeldItems) {
      globalScene.applyModifiers(StatBoosterModifier, this.isPlayer(), this, stat, statVal);
    }

    // The Ruin abilities here are never ignored, but they reveal themselves on summon anyway
    const fieldApplied = new BooleanHolder(false);
    for (const pokemon of globalScene.getField(true)) {
      // TODO: remove `canStack` toggle from ability as breaking out renders it useless
      applyAbAttrs("FieldMultiplyStatAbAttr", {
        pokemon,
        stat,
        statVal,
        target: this,
        hasApplied: fieldApplied,
        simulated,
      });
      if (fieldApplied.value) {
        break;
      }
    }

    // Elite Redux — Blind Rage's Mold Breaker must NOT bypass abilities that
    // modify base stats (Grass Pelt, Fur Coat). When the attacker carries the
    // `PreserveBaseStatAbilitiesAbAttr` marker, apply the defender's
    // StatMultiplier abilities even though ability-ignore is otherwise active.
    const preserveBaseStatAbilities =
      ignoreAbility && (opponent?.hasAbilityWithAttr("PreserveBaseStatAbilitiesAbAttr") ?? false);
    if (!ignoreAbility || preserveBaseStatAbilities) {
      applyAbAttrs("StatMultiplierAbAttr", {
        pokemon: this,
        stat,
        statVal,
        simulated,
        // TODO: maybe just don't call this if the move is none?
        move: move ?? allMoves[MoveId.NONE],
      });
    }

    const ally = this.getAlly();
    if (ally != null) {
      applyAbAttrs("AllyStatMultiplierAbAttr", {
        pokemon: ally,
        stat,
        statVal,
        simulated,
        // TODO: maybe just don't call this if the move is none?
        move: move ?? allMoves[MoveId.NONE],
        ignoreAbility: move?.hasFlag(MoveFlags.IGNORE_ABILITIES) || ignoreAllyAbility,
      });
    }

    // ER field-aura hook: scan on-field battlers for any
    // PersistentFieldAuraAbAttr that should boost `subject`'s stat. Direct
    // constructor.name lookup avoids touching pokerogue's AbilityAttrs map.
    if (!ignoreAbility) {
      PersistentFieldAuraAbAttr.applyAuras(this, stat, statVal);
    }

    let ret =
      statVal.value
      * (wonderRoomSwapped
        ? 1 // ER Wonder Room: swapped ATK/SpAtk ignore stat stages ("buffs")
        : this.getStatStageMultiplier(stat, opponent, move, ignoreOppAbility, isCritical, simulated, ignoreHeldItems));

    switch (stat) {
      case Stat.ATK:
        if (this.getTag(BattlerTagType.SLOW_START)) {
          ret >>= 1;
        }
        // ER (#427): infatuation cuts Attack and Sp. Atk in HALF - the ER ROM
        // replaces vanilla's 50% immobilize chance with this stat cut (see
        // InfatuatedTag.lapse, where the immobilize roll was removed).
        if (this.getTag(BattlerTagType.INFATUATED)) {
          ret /= 2;
        }
        break;
      case Stat.DEF:
        // Ice-types gain +50% Def in snow — and in ER's Snowy Wrath (er 666), a
        // damaging snow that carries the same Ice Defense boost. ER Snow Warning
        // (117) summons HAIL, which the dex says also grants Ice types the +50%
        // Def boost, so HAIL is included here too.
        if (
          this.isOfType(PokemonType.ICE)
          && (globalScene.arena.weather?.weatherType === WeatherType.SNOW
            || globalScene.arena.weather?.weatherType === WeatherType.SNOWY_WRATH
            || globalScene.arena.weather?.weatherType === WeatherType.HAIL)
        ) {
          ret *= 1.5;
        }
        break;
      case Stat.SPATK:
        // ER (#427): see the Stat.ATK case - infatuation halves both.
        if (this.getTag(BattlerTagType.INFATUATED)) {
          ret /= 2;
        }
        break;
      case Stat.SPDEF:
        if (this.isOfType(PokemonType.ROCK) && globalScene.arena.weather?.weatherType === WeatherType.SANDSTORM) {
          ret *= 1.5;
        }
        break;
      case Stat.SPD: {
        const side = this.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
        if (globalScene.arena.getTagOnSide(ArenaTagType.TAILWIND, side)) {
          ret *= 2;
        }
        if (globalScene.arena.getTagOnSide(ArenaTagType.GRASS_WATER_PLEDGE, side)) {
          ret >>= 2;
        }

        if (this.getTag(BattlerTagType.SLOW_START)) {
          ret >>= 1;
        }
        if (this.status && this.status.effect === StatusEffect.PARALYSIS) {
          ret >>= 1;
        }
        if (this.getTag(BattlerTagType.UNBURDEN) && this.hasAbility(AbilityId.UNBURDEN)) {
          ret *= 2;
        }
        // ER tactical items: Iron Ball halves Speed, Float Stone raises it 10%.
        if (!ignoreHeldItems) {
          ret *= erTacticalSpeedMultiplier(this);
        }
        break;
      }
    }

    const highestStatBoost = this.findTag(
      t => t instanceof HighestStatBoostTag && (t as HighestStatBoostTag).stat === stat,
    ) as HighestStatBoostTag;
    if (highestStatBoost) {
      ret *= highestStatBoost.multiplier;
    }

    return Math.max(Math.floor(ret), 1);
  }

  calculateStats(): void {
    if (!this.stats) {
      this.stats = [0, 0, 0, 0, 0, 0];
    }

    // Get and manipulate base stats
    const baseStats = this.calculateBaseStats();
    // Using base stats, calculate and store stats one by one
    for (const s of PERMANENT_STATS) {
      const statHolder = new NumberHolder(Math.floor((2 * baseStats[s] + this.ivs[s]) * this.level * 0.01));
      if (s === Stat.HP) {
        statHolder.value = statHolder.value + this.level + 10;
        globalScene.applyModifier(PokemonIncrementingStatModifier, this.isPlayer(), this, s, statHolder);
        // Shedinja - any form, including ER's Mega Shedinja - always has exactly 1 HP,
        // its whole identity. Base Shedinja gets this via Wonder Guard, but Mega
        // Shedinja's kit (Cheating Death / Magic Guard) replaces Wonder Guard, so it
        // fell through to the normal formula (base HP 1 -> ~95 at high level). Key the
        // 1-HP rule on the species line too (its mega baseStats HP is already 1).
        if (this.hasAbility(AbilityId.WONDER_GUARD, false, true) || this.hasSpecies(SpeciesId.SHEDINJA)) {
          statHolder.value = 1;
        }
        if (this.hp > statHolder.value || this.hp === undefined) {
          this.hp = statHolder.value;
        } else if (this.hp) {
          const lastMaxHp = this.getMaxHp();
          if (lastMaxHp && statHolder.value > lastMaxHp) {
            this.hp += statHolder.value - lastMaxHp;
          }
        }
      } else {
        statHolder.value += 5;
        const natureStatMultiplier = new NumberHolder(getNatureStatMultiplier(this.getNature(), s));
        globalScene.applyModifier(PokemonNatureWeightModifier, this.isPlayer(), this, natureStatMultiplier);
        if (natureStatMultiplier.value !== 1) {
          statHolder.value = Math.max(
            Math[natureStatMultiplier.value > 1 ? "ceil" : "floor"](statHolder.value * natureStatMultiplier.value),
            1,
          );
        }
        globalScene.applyModifier(PokemonIncrementingStatModifier, this.isPlayer(), this, s, statHolder);
      }

      statHolder.value = Phaser.Math.Clamp(statHolder.value, 1, Number.MAX_SAFE_INTEGER);

      this.setStat(s, statHolder.value);
    }
  }

  calculateBaseStats(): number[] {
    const baseStats = this.getSpeciesForm(true).baseStats.slice(0);
    applyChallenges(ChallengeType.FLIP_STAT, this, baseStats);
    // Shuckle Juice
    globalScene.applyModifiers(PokemonBaseStatTotalModifier, this.isPlayer(), this, baseStats);
    // Old Gateau
    globalScene.applyModifiers(PokemonBaseStatFlatModifier, this.isPlayer(), this, baseStats);
    if (this.isFusion()) {
      const fusionBaseStats = this.getFusionSpeciesForm(true).baseStats.slice(0);
      applyChallenges(ChallengeType.FLIP_STAT, this, fusionBaseStats);

      for (const s of PERMANENT_STATS) {
        baseStats[s] = Math.ceil((baseStats[s] + fusionBaseStats[s]) / 2);
      }
    } else if (globalScene.gameMode.isSplicedOnly) {
      for (const s of PERMANENT_STATS) {
        baseStats[s] = Math.ceil(baseStats[s] / 2);
      }
    }
    // Vitamins
    globalScene.applyModifiers(BaseStatModifier, this.isPlayer(), this, baseStats);

    // ER Bog Witch curse (#508): a permanent "anti-vitamin" - one base stat is
    // cut 10% until the curse is lifted at the Cleansing Font. -1 = uncursed.
    const cursedStat = this.customPokemonData.erCursedStat;
    if (cursedStat >= 0 && cursedStat < baseStats.length) {
      baseStats[cursedStat] = Math.max(1, Math.floor(baseStats[cursedStat] * 0.9));
    }

    return baseStats;
  }

  // TODO: Convert this into a getter
  getNature(): Nature {
    return this.customPokemonData.nature === -1 ? this.nature : this.customPokemonData.nature;
  }

  // TODO: Convert this into a setter OR just add a listener for calculateStats...
  setNature(nature: Nature): void {
    this.nature = nature;
    this.calculateStats();
  }

  setCustomNature(nature: Nature): void {
    this.customPokemonData.nature = nature;
    this.calculateStats();
  }

  /**
   * Randomly generate and set this Pokémon's nature
   * @param naturePool - An optional array of Natures to choose from. If not provided, all natures will be considered.
   */
  private generateNature(naturePool?: Nature[]): void {
    if (naturePool === undefined) {
      naturePool = getEnumValues(Nature);
    }
    const nature = naturePool[randSeedInt(naturePool.length)];
    this.setNature(nature);
  }

  // TODO: Convert this into a getter
  isFullHp(): boolean {
    return this.hp >= this.getMaxHp();
  }

  // TODO: Convert this into a getter
  getMaxHp(): number {
    return this.getStat(Stat.HP);
  }

  /** Returns the amount of hp currently missing from this {@linkcode Pokemon} (max - current) */
  getInverseHp(): number {
    return this.getMaxHp() - this.hp;
  }

  /**
   * Return the ratio of this Pokémon's current HP to its maximum HP
   * @param precise - Whether to return the exact HP ratio (e.g. `0.54321`), or one rounded to the nearest %; default `false`
   * @returns The current HP ratio
   */
  getHpRatio(precise = false): number {
    return precise ? this.hp / this.getMaxHp() : Math.round((this.hp / this.getMaxHp()) * 100) / 100;
  }

  /**
   * Return this Pokemon's {@linkcode Gender}.
   * @param ignoreOverride - Whether to ignore any overrides caused by {@linkcode MoveId.TRANSFORM | Transform}; default `false`
   * @param useIllusion - Whether to consider this pokemon's illusion if present; default `false`
   * @returns the {@linkcode Gender} of this {@linkcode Pokemon}.
   */
  getGender(ignoreOverride = false, useIllusion = false): Gender {
    if (useIllusion && this.summonData.illusion) {
      return this.summonData.illusion.gender;
    }
    if (!ignoreOverride && this.summonData.gender != null) {
      return this.summonData.gender;
    }
    return this.gender;
  }

  /**
   * Return this Pokemon's fusion's {@linkcode Gender}.
   * @param ignoreOverride - Whether to ignore any overrides caused by {@linkcode MoveId.TRANSFORM | Transform}; default `false`
   * @param useIllusion - Whether to consider this pokemon's illusion if present; default `false`
   * @returns The {@linkcode Gender} of this {@linkcode Pokemon}'s fusion.
   */
  getFusionGender(ignoreOverride = false, useIllusion = false): Gender {
    if (useIllusion && this.summonData.illusion?.fusionGender) {
      return this.summonData.illusion.fusionGender;
    }
    if (!ignoreOverride && this.summonData.fusionGender != null) {
      return this.summonData.fusionGender;
    }
    return this.fusionGender;
  }

  /**
   * Check whether this Pokémon is shiny, including its fusion species
   *
   * @param useIllusion - Whether to consider an active illusion
   * @returns Whether this Pokemon is shiny
   * @see {@linkcode isBaseShiny}
   */
  isShiny(useIllusion = false): boolean {
    return this.isBaseShiny(useIllusion) || this.isFusionShiny(useIllusion);
  }

  /**
   * Get whether this Pokémon's _base_ species is shiny
   * @param useIllusion - Whether to consider an active illusion; default `false`
   * @returns Whether the pokemon is shiny
   */
  isBaseShiny(useIllusion = false) {
    return useIllusion ? (this.summonData.illusion?.shiny ?? this.shiny) : this.shiny;
  }

  /**
   * Get whether this Pokémon's _fusion_ species is shiny
   * @param useIllusion - Whether to consider an active illusion; default `true`
   * @returns Whether this Pokémon's fusion species is shiny, or `false` if there is no fusion
   */
  isFusionShiny(useIllusion = false) {
    if (!this.isFusion(useIllusion)) {
      return false;
    }
    return useIllusion ? (this.summonData.illusion?.fusionShiny ?? this.fusionShiny) : this.fusionShiny;
  }

  /**
   * Check whether this Pokemon is doubly shiny (both normal and fusion are shiny).
   * @param useIllusion - Whether to consider an active illusion; default `false`
   * @returns Whether this pokemon's base and fusion counterparts are both shiny.
   */
  isDoubleShiny(useIllusion = false): boolean {
    return this.isFusion(useIllusion) && this.isBaseShiny(useIllusion) && this.isFusionShiny(useIllusion);
  }

  /**
   * Return this Pokemon's shiny variant.
   * If a fusion, returns the maximum of the two variants.
   * Only meaningful if this pokemon is actually shiny.
   * @param useIllusion - Whether to consider an active illusion; default `false`
   * @returns The shiny variant of this Pokemon.
   */
  getVariant(useIllusion = false): Variant {
    const illusion = this.summonData.illusion;
    const baseVariant = useIllusion ? (illusion?.variant ?? this.variant) : this.variant;
    if (!this.isFusion(useIllusion)) {
      return baseVariant;
    }
    const fusionVariant = useIllusion ? (illusion?.fusionVariant ?? this.fusionVariant) : this.fusionVariant;
    return Math.max(baseVariant, fusionVariant) as Variant;
  }

  /**
   * Return the base pokemon's variant. Equivalent to {@linkcode getVariant} if this pokemon is not a fusion.
   * @param useIllusion - Whether to consider an active illusion; default `false`
   * @returns The shiny variant of this Pokemon's base species.
   */
  getBaseVariant(useIllusion = false): Variant {
    const illusion = this.summonData.illusion;
    return useIllusion && illusion ? (illusion.variant ?? this.variant) : this.variant;
  }

  /**
   * Get the shiny variant of this Pokémon's _fusion_ species
   *
   * @remarks
   * Always returns `0` if the pokemon is not a fusion.
   * @param useIllusion - Whether to consider an active illusion
   * @returns The shiny variant of this pokemon's fusion species.
   */
  getFusionVariant(useIllusion = false): Variant {
    if (!this.isFusion(useIllusion)) {
      return 0;
    }
    const illusion = this.summonData.illusion;
    return illusion ? (illusion.fusionVariant ?? this.fusionVariant) : this.fusionVariant;
  }

  /**
   * Return this pokemon's overall luck value, based on its shininess (1 pt per variant lvl).
   * @returns The luck value of this Pokemon.
   */
  getLuck(): number {
    // Co-op (#633 Fix #3): a merged co-op mon uses its OWNER's canonical luck (snapshotted at
    // merge time), so the shared party's total luck is identical on both clients instead of
    // each deriving the partner mon's luck from ITS OWN dex unlocks. Gated to co-op + a present
    // snapshot; solo / non-merged mons fall through to the unchanged derivation below.
    if (globalScene.gameMode.isCoop && this.customPokemonData?.coopLuck != null) {
      return this.customPokemonData.coopLuck;
    }
    const base = this.luck + (this.isFusion() ? this.fusionLuck : 0);
    // ER (#432): a Black Shiny is the rarest shiny tier and grants a flat
    // Luck 5 (a regular shiny caps at 3). DERIVED here, never stored - the
    // save keeps its ordinary variant/luck fields untouched, so this is
    // additive and fully save-safe.
    return this.customPokemonData?.erBlackShiny ? Math.max(base, 5) : base;
  }

  /**
   * Return whether this {@linkcode Pokemon} is currently fused with anything.
   * @param useIllusion - Whether to consider an active illusion; default `false`
   * @returns Whether this Pokemon is currently fused with another species.
   */
  isFusion(useIllusion = false): boolean {
    return !!(useIllusion ? (this.summonData.illusion?.fusionSpecies ?? this.fusionSpecies) : this.fusionSpecies);
  }

  /**
   * Return this {@linkcode Pokemon}'s name.
   * @param useIllusion - Whether to consider an active illusion; default `false`
   * @returns This Pokemon's name.
   * @see {@linkcode getNameToRender} - gets this Pokemon's display name.
   */
  getName(useIllusion = false): string {
    return useIllusion ? (this.summonData.illusion?.name ?? this.name) : this.name;
  }

  /**
   * Check whether this {@linkcode Pokemon} has a fusion with the specified {@linkcode SpeciesId}.
   * @param species - The {@linkcode SpeciesId} to check against.
   * @returns Whether this Pokemon is currently fused with the specified {@linkcode SpeciesId}.
   */
  hasFusionSpecies(species: SpeciesId): boolean {
    return this.fusionSpecies?.speciesId === species;
  }

  /**
   * Check whether this {@linkcode Pokemon} either is or is fused with the given {@linkcode SpeciesId}.
   * @param species - The {@linkcode SpeciesId} to check against.
   * @param formKey - If provided, will require the species to be in the given form.
   * @returns Whether this Pokemon has this species as either its base or fusion counterpart.
   */
  hasSpecies(species: SpeciesId, formKey?: string): boolean {
    if (formKey == null) {
      return this.species.speciesId === species || this.fusionSpecies?.speciesId === species;
    }

    return (
      (this.species.speciesId === species && this.getFormKey() === formKey)
      || (this.fusionSpecies?.speciesId === species && this.getFusionFormKey() === formKey)
    );
  }

  abstract isBoss(): boolean;

  /**
   * Return all the {@linkcode PokemonMove}s that make up this Pokemon's moveset.
   * Takes into account player/enemy moveset overrides (which will also override PP count).
   * @param ignoreOverride - Whether to ignore any overrides caused by {@linkcode MoveId.TRANSFORM | Transform}; default `false`
   * @returns An array of {@linkcode PokemonMove}, as described above.
   */
  getMoveset(ignoreOverride = false): PokemonMove[] {
    // Override moveset based on arrays specified in overrides.ts
    const overrideArray = coerceArray(this.isPlayer() ? Overrides.MOVESET_OVERRIDE : Overrides.ENEMY_MOVESET_OVERRIDE);
    if (overrideArray.length === 0) {
      const ms = !ignoreOverride && this.summonData.moveset ? this.summonData.moveset : this.moveset;
      // ER hardening: filter out moveset entries whose moveId can't resolve
      // to a Move in `allMoves`. Without this filter, every caller of
      // getMoveset has to defensively check `move.getMove()` before reading
      // .category/.type/.name — and many don't, causing trainer freezes.
      // Track unresolved moves at the source to keep the surface clean.
      return ms.filter(m => allMoves[m.moveId] !== undefined);
    }

    if (!this.isPlayer()) {
      this.moveset = [];
    }
    // TODO: Preserve PP used while the moveset override is active
    overrideArray.forEach((move: MoveId, index: number) => {
      const ppUsed = this.moveset[index]?.ppUsed ?? 0;
      this.moveset[index] = new PokemonMove(move, Math.min(ppUsed, allMoves[move].pp));
    });

    const ms = !ignoreOverride && this.summonData.moveset ? this.summonData.moveset : this.moveset;
    return ms.filter(m => allMoves[m.moveId] !== undefined);
  }

  /**
   * The maximum number of moves this Pokémon may know at once. Base cap is 4,
   * raised by ER's "5th move slot" consumable (stored on
   * {@linkcode CustomPokemonData.bonusMoveSlots}). Used by the learn-move flow
   * and the fight/summary UIs in place of a hardcoded `4`.
   */
  public getMaxMoveCount(): number {
    return 4 + (this.customPokemonData?.bonusMoveSlots ?? 0);
  }

  /**
   * Check which egg moves have been unlocked for this {@linkcode Pokemon}.
   * Looks at either the species it was met at or the first {@linkcode Species} in its evolution
   * line that can act as a starter and provides those egg moves.
   * @returns An array of all {@linkcode MoveId}s that are egg moves and unlocked for this Pokemon.
   */
  getUnlockedEggMoves(): MoveId[] {
    const moves: MoveId[] = [];
    const species =
      this.metSpecies in speciesEggMoves ? this.metSpecies : this.getSpeciesForm(true).getRootSpeciesId(true);
    if (species in speciesEggMoves) {
      for (let i = 0; i < 4; i++) {
        if (globalScene.gameData.starterData[species].eggMoves & (1 << i)) {
          moves.push(speciesEggMoves[species][i]);
        }
      }
    }
    return moves;
  }

  /**
   * Get all possible learnable level moves for the {@linkcode Pokemon},
   * excluding any moves already known.
   *
   * Available egg moves are only included if the {@linkcode Pokemon} was
   * in the starting party of the run and if Fresh Start is not active.
   * @returns An array of {@linkcode MoveId}s, as described above.
   */
  /**
   * ER Learner's Shroom (#404): every move this Pokemon is capable of
   * learning through ANY source - TMs, ER tutor moves (merged into
   * speciesTmMoves), egg moves (no unlock needed) and level-up moves it has
   * ALREADY reached. The single exception, per the maintainer: level-up moves
   * it has not learned yet stay gated behind leveling. Known moves excluded.
   */
  public getErLearnableShroomMoves(): MoveId[] {
    const formKey = this.getFormKey();
    const tmMoves = (speciesTmMoves[this.species.speciesId] ?? [])
      .filter(m => (Array.isArray(m) ? m[0] === formKey : true))
      .map(m => (Array.isArray(m) ? m[1] : m));
    const rootSpeciesId =
      this.metSpecies in speciesEggMoves ? this.metSpecies : this.getSpeciesForm(true).getRootSpeciesId(true);
    const eggMoves: MoveId[] = speciesEggMoves[rootSpeciesId] ?? [];
    // Level-up moves up to the CURRENT level only (the "not learned from
    // level up yet" exception), same source the Memory Mushroom uses.
    const reachedLevelMoves = this.getLearnableLevelMoves();
    const seen = new Set<MoveId>();
    const out: MoveId[] = [];
    for (const m of [...reachedLevelMoves, ...eggMoves, ...tmMoves]) {
      if (m && !seen.has(m) && !this.moveset.some(pm => pm?.moveId === m)) {
        seen.add(m);
        out.push(m);
      }
    }
    return out;
  }

  public getLearnableLevelMoves(): MoveId[] {
    let levelMoves = this.getLevelMoves(1, true, false, true).map(lm => lm[1]);
    if (this.metBiome === -1 && !globalScene.gameMode.isFreshStartChallenge() && !globalScene.gameMode.isDaily) {
      levelMoves = this.getUnlockedEggMoves().concat(levelMoves);
    }
    if (Array.isArray(this.usedTMs) && this.usedTMs.length > 0) {
      levelMoves = this.usedTMs.filter(m => !levelMoves.includes(m)).concat(levelMoves);
    }
    // Dedupe by moveId AND drop already-known moves. A move can sit in BOTH the
    // (ER-expanded) level-up learnset and the egg-move pool - e.g. Drifloon's
    // Psycho Shift - which otherwise lists it twice on the move-swap screen.
    const seen = new Set<MoveId>();
    levelMoves = levelMoves.filter(lm => {
      if (!lm || seen.has(lm) || this.moveset.some(m => m?.moveId === lm)) {
        return false;
      }
      seen.add(lm);
      return true;
    });
    return levelMoves;
  }

  /**
   * Evaluate and return this Pokemon's typing.
   * @param includeTeraType - (Default `true`) Whether to use this Pokemon's tera type if Terastallized; default `true`
   * @param returnOriginalTypesIfStellar - (Default `false`) Whether to treat this Pokemon as its original types if it is currently {@linkcode PokemonType.STELLAR | Tera Stellar}
   * @param ignoreOverride - (Default `false`) Whether to ignore any overrides caused by {@linkcode MoveId.TRANSFORM | Transform} and similar effects; default `false`
   * @param useIllusion - (Default `false`) Whether to consider an active illusion; default `false`
   * @returns A non-empty array of {@linkcode PokemonType}s corresponding to this Pokemon's typing (real or perceived).
   */
  public getTypes(
    includeTeraType = true,
    returnOriginalTypesIfStellar = false,
    ignoreOverride = false,
    useIllusion = false,
  ): Mutable<NonEmptyTuple<PokemonType>> {
    const teraType = this.getTeraType();
    // Stellar tera does nothing defensively (uses original types)
    const shouldUseTeraStellar = !(returnOriginalTypesIfStellar && teraType === PokemonType.STELLAR);

    if (includeTeraType && this.isTerastallized && shouldUseTeraStellar) {
      return [teraType];
    }

    const types = new Set(this.getBaseTypes(ignoreOverride, useIllusion));

    // become UNKNOWN if no types are present, or remove it if other types are present.
    // TODO: Move this after the added type checks once Roost is refactored to check removed types correctly
    if (types.size === 0) {
      types.add(PokemonType.UNKNOWN);
    } else if (types.size > 1) {
      types.delete(PokemonType.UNKNOWN);
    }

    // check type added to Pokemon from moves like Forest's Curse or Trick Or Treat.
    if (!ignoreOverride && this.summonData.addedType) {
      types.add(this.summonData.addedType);
    }

    // ER type-graft substrate (Batch 4): additional types grafted onto this
    // Pokemon for the wave by Draconic Voodoo / Bad Splice stack on top of its
    // native + added typing. Skipped under ignoreOverride like `addedType`.
    if (!ignoreOverride) {
      for (const grafted of getGraftedTypes(this)) {
        types.add(grafted);
      }
    }

    return Array.from(types) as Mutable<NonEmptyTuple<PokemonType>>;
  }

  /**
   * Helper to {@linkcode getTypes} that handles computing a Pokemon's normal typing.
   */
  private getBaseTypes(ignoreOverride = false, useIllusion = false): PokemonType[] {
    if (!ignoreOverride && this.summonData.types.length > 0 && (!this.summonData.illusion || !useIllusion)) {
      return this.summonData.types;
    }

    const speciesForm = this.getSpeciesForm(ignoreOverride, useIllusion);
    const fusionSpeciesForm = this.getFusionSpeciesForm(ignoreOverride, useIllusion);

    // TODO: This `map` call is only needed due to the fact that these arrays use -1 as defaults
    const customTypes = this.customPokemonData.types.map(t => (t === PokemonType.UNKNOWN ? undefined : t));

    const firstType = customTypes[0] ?? speciesForm.type1;
    const secondCustomType = customTypes[1] ?? speciesForm.type2;

    // Second type
    let secondType: PokemonType | null = secondCustomType;

    if (fusionSpeciesForm) {
      // Check if the fusion Pokemon also has permanent changes from ME when determining the fusion types
      const fusionCustomTypes =
        this.fusionCustomPokemonData?.types.map(t => (t === PokemonType.UNKNOWN ? undefined : t)) ?? [];

      const fusionType1 = fusionCustomTypes[0] ?? fusionSpeciesForm.type1;
      const fusionType2 = fusionCustomTypes[1] ?? fusionSpeciesForm.type2;

      // Assign second type if the fusion can provide one
      if (fusionType2 !== null && fusionType2 !== firstType) {
        secondType = fusionType2;
      } else if (fusionType1 !== firstType) {
        secondType = fusionType1;
      }
    }

    // ER N-type static model: species/forms that are natively 3+ types (Mega
    // Parasect = Bug/Grass/Ghost, Primal Regigigas = six types, ...) carry the
    // extra static types in `speciesForm.getExtraTypes()`. Fold them in on top
    // of type1/type2 so effectiveness, STAB, immunity checks and the N-type
    // battle-info renderer (which iterates every getTypes() entry) pick them up
    // automatically. Skipped when a custom-types override or fusion is present
    // above only for the first two slots — the extra static types still apply to
    // the base form's own typing. `getTypes()` wraps this in a Set, so a duplicate
    // (already type1/type2) is harmless. Only used when NOT overridden by
    // customPokemonData for the primary types (the extra set has no custom-override
    // analogue and is intrinsic to the form). */
    const extraTypes = speciesForm.getExtraTypes();
    if (extraTypes.length > 0) {
      return [firstType, secondType ?? PokemonType.UNKNOWN, ...extraTypes];
    }

    return [firstType, secondType ?? PokemonType.UNKNOWN];
  }

  /**
   * Check if this Pokemon's typing includes the specified type.
   * @param type - The {@linkcode PokemonType} to check
   * @param includeTeraType - Whether to use this Pokemon's tera type if Terastallized; default `true`
   * @param returnOriginalTypesIfStellar - (Default `false`)
   *   Whether to treat this Pokemon as its original types if it is currently {@linkcode PokemonType.STELLAR | Tera Stellar}
   * @param ignoreOverride - (Default `false`) Whether to ignore any overrides caused by {@linkcode MoveId.TRANSFORM | Transform} and similar effects
   * @returns Whether this Pokemon is of the specified type.
   */
  // TODO: Make `returnOriginalTypesIfStellar` default to `true`
  public isOfType(
    type: PokemonType,
    includeTeraType = true,
    returnOriginalTypesIfStellar = false,
    ignoreOverride = false,
  ): boolean {
    return this.getTypes(includeTeraType, returnOriginalTypesIfStellar, ignoreOverride).includes(type);
  }

  /**
   * Get this Pokemon's non-passive {@linkcode Ability}, factoring in fusions, overrides and ability-changing effects.

   * Should rarely be called directly in favor of {@linkcode hasAbility} or {@linkcode hasAbilityWithAttr},
   * both of which check both ability slots and account for suppression.
   * @see {@linkcode hasAbility} and {@linkcode hasAbilityWithAttr} are the intended ways to check abilities in most cases
   * @param ignoreOverride - Whether to ignore any overrides caused by {@linkcode MoveId.TRANSFORM | Transform}; default `false`
   * @returns The non-passive {@linkcode Ability} of this Pokemon.
   */
  public getAbility(ignoreOverride = false): Ability {
    if (!ignoreOverride && this.summonData.ability) {
      return allAbilities[this.summonData.ability];
    }
    if (Overrides.ABILITY_OVERRIDE && this.isPlayer()) {
      return allAbilities[Overrides.ABILITY_OVERRIDE];
    }
    if (Overrides.ENEMY_ABILITY_OVERRIDE && this.isEnemy()) {
      return allAbilities[Overrides.ENEMY_ABILITY_OVERRIDE];
    }
    if (
      this.customPokemonData.ability != null
      && this.customPokemonData.ability !== -1
      && this.customAbilityOverridesApply()
    ) {
      return allAbilities[this.customPokemonData.ability];
    }
    if (this.isBoss() && isDailyFinalBoss()) {
      const eventBoss = getDailyEventSeedBoss();
      if (eventBoss?.ability != null) {
        return allAbilities[eventBoss.ability];
      }
    }
    let abilityId = this.getSpeciesForm(ignoreOverride).getAbility(this.abilityIndex);
    if (abilityId === AbilityId.NONE) {
      abilityId = this.species.ability1;
    }
    // Defensive: an unregistered or out-of-range ability id must never yield
    // `undefined` here — callers (e.g. hasAbility/hasAbilityWithAttr) deref
    // `.id`/`.hasAttr`, and an undefined slip-through softlocks the phase queue
    // (notably EggLapsePhase generating an ER-custom species whose ability id
    // isn't in `allAbilities`). Fall back to the species' primary ability, then
    // to NONE, so a valid Ability is always returned.
    return allAbilities[abilityId] ?? allAbilities[this.species.ability1] ?? allAbilities[AbilityId.NONE];
  }

  /**
   * Gets the passive ability of the pokemon. This should rarely be called, most of the time
   * {@linkcode hasAbility} or {@linkcode hasAbilityWithAttr} are better used as those check both the passive and
   * non-passive abilities and account for ability suppression.
   * @see {@linkcode hasAbility} {@linkcode hasAbilityWithAttr} Intended ways to check abilities in most cases
   * @returns The passive {@linkcode Ability} of the pokemon
   */
  public getPassiveAbility(): Ability {
    if (this.isFusion()) {
      return this.getPassiveAbilities()[0] ?? allAbilities[AbilityId.NONE];
    }
    if (Overrides.PASSIVE_ABILITY_OVERRIDE && this.isPlayer()) {
      return allAbilities[Overrides.PASSIVE_ABILITY_OVERRIDE];
    }
    if (Overrides.ENEMY_PASSIVE_ABILITY_OVERRIDE && this.isEnemy()) {
      return allAbilities[Overrides.ENEMY_PASSIVE_ABILITY_OVERRIDE];
    }
    if (
      this.customPokemonData.passive != null
      && this.customPokemonData.passive !== -1
      && this.customAbilityOverridesApply()
    ) {
      return allAbilities[this.customPokemonData.passive];
    }
    if (this.isBoss() && isDailyFinalBoss()) {
      const eventBoss = getDailyEventSeedBoss();
      if (eventBoss?.passive != null) {
        return allAbilities[eventBoss.passive];
      }
    }

    return allAbilities[this.species.getPassiveAbility(this.formIndex)];
  }

  /**
   * Return the 3 ER-style passive abilities for this Pokemon, resolving
   * through the species' {@linkcode PokemonSpeciesForm.getPassiveAbilities}
   * override. Each entry is the {@linkcode Ability} instance for that slot,
   * or `null` if that slot is empty (`AbilityId.NONE`).
   *
   * Slot 0 honors overrides / custom data / event bosses identically to
   * {@linkcode getPassiveAbility}, so legacy single-passive behavior is
   * preserved when no 3-passive override has been installed on the species.
   *
   * When a transform override has been installed via
   * {@linkcode setTempPassives} (`summonData.passiveAbilities`), each
   * non-undefined slot in the override replaces the corresponding derived
   * passive — used by `PokemonTransformPhase` to copy the target's full
   * passive set.
   *
   * Used by {@linkcode applyAbAttrs} to iterate all 3 passive slots when
   * applying ability attributes (ER 3-passive model).
   */
  public getPassiveAbilities(): readonly (Ability | null)[] {
    // Slot 0 must continue to honor overrides / customPokemonData / event
    // boss settings so single-passive behavior is preserved when no
    // 3-passive override is set on the species. We mirror the lookup order
    // used by getPassiveAbility() exactly for slot 0.
    let slot0: Ability | null = null;
    if (Overrides.PASSIVE_ABILITY_OVERRIDE && this.isPlayer()) {
      slot0 = allAbilities[Overrides.PASSIVE_ABILITY_OVERRIDE];
    } else if (Overrides.ENEMY_PASSIVE_ABILITY_OVERRIDE && this.isEnemy()) {
      slot0 = allAbilities[Overrides.ENEMY_PASSIVE_ABILITY_OVERRIDE];
    } else {
      const customSlot0 = this.getAbilityOverrideForSlot(1);
      if (customSlot0 !== undefined) {
        slot0 = allAbilities[customSlot0];
      }
    }
    if (slot0 === null && this.isBoss() && isDailyFinalBoss()) {
      const eventBoss = getDailyEventSeedBoss();
      if (eventBoss?.passive != null) {
        slot0 = allAbilities[eventBoss.passive];
      }
    }

    const derivedIds = this.resolveDerivedPassiveIds();

    if (slot0 === null) {
      slot0 = derivedIds[0] === AbilityId.NONE ? null : allAbilities[derivedIds[0]];
    }

    // Apply transform override (`summonData.passiveAbilities`) per-slot. A slot
    // override of `undefined` means "no override for this slot" (keep derived).
    // A slot override of `AbilityId.NONE` means "explicitly empty this slot".
    const transformOverride = this.summonData.passiveAbilities;
    const customSlot1 = this.getAbilityOverrideForSlot(2);
    const customSlot2 = this.getAbilityOverrideForSlot(3);
    const slot1Id = customSlot1 ?? transformOverride?.[1] ?? derivedIds[1];
    const slot2Id = customSlot2 ?? transformOverride?.[2] ?? derivedIds[2];
    if (transformOverride?.[0] != null) {
      slot0 = transformOverride[0] === AbilityId.NONE ? null : allAbilities[transformOverride[0]];
    }
    const slots: (Ability | null)[] = [
      slot0,
      slot1Id === AbilityId.NONE ? null : allAbilities[slot1Id],
      slot2Id === AbilityId.NONE ? null : allAbilities[slot2Id],
    ];
    // ER Black Shinies (#349): append the active GIFT abilities — this mon's
    // own gift plus any on-field black-shiny ally's gift. Flowing them through
    // the passive list makes combat + every abilities screen pick them up.
    for (const giftId of getErSharedGiftAbilityIdsFor(this)) {
      const gift = allAbilities[giftId];
      if (gift && !slots.some(a => a?.id === gift.id)) {
        slots.push(gift);
      }
    }
    return slots;
  }

  /**
   * The selectable ability "slots" for this Pokémon, used by the ER Ability
   * Randomizer: slot 0 is the active ability, slots 1-3 are the ER innate
   * (passive) slots that resolve to a real ability. Returns one entry per
   * present slot, each with the {@linkcode Ability} currently occupying it.
   */
  public getAbilitySlots(): { slot: number; ability: Ability }[] {
    const slots: { slot: number; ability: Ability }[] = [{ slot: 0, ability: this.getAbility() }];
    // Only the 3 real innate slots are selectable — the ER Black Shiny GIFT
    // (appended past index 2 by getPassiveAbilities) must NEVER be targetable
    // by the Ability Randomizer (maintainer rule, #349).
    const passives = this.getPassiveAbilities().slice(0, 3);
    for (let i = 0; i < passives.length; i++) {
      const ability = passives[i];
      if (ability != null && ability.id !== AbilityId.NONE) {
        slots.push({ slot: i + 1, ability });
      }
    }
    return slots;
  }

  /**
   * Persistently override the ability occupying a given slot (0 = active
   * ability, 1-3 = ER innate slots). Stored on {@linkcode CustomPokemonData} so
   * it survives the run. Used by the ER Ability Randomizer consumable.
   */
  public setAbilityOverrideForSlot(slot: number, abilityId: AbilityId): void {
    const owner = this.getAbilitySlotOwner(slot, true);
    if (!owner) {
      return;
    }
    owner.data[owner.key] = abilityId;
    if (owner.usesFormDerivedAbilities) {
      owner.data.abilityOverridesForm = true;
    }
  }

  private getAbilityOverrideForSlot(slot: number): AbilityId | undefined {
    const owner = this.getAbilitySlotOwner(slot);
    if (!owner || (owner.usesFormDerivedAbilities && !owner.data.abilityOverridesForm)) {
      return;
    }
    const abilityId = owner.data[owner.key];
    return abilityId == null || abilityId === -1 ? undefined : abilityId;
  }

  private getAbilitySlotOwner(
    slot: number,
    createFusionData = false,
  ): {
    data: CustomPokemonData;
    key: "ability" | "passive" | "passive2" | "passive3";
    usesFormDerivedAbilities: boolean;
  } | null {
    const baseOwner = (key: "ability" | "passive" | "passive2" | "passive3") => ({
      data: this.customPokemonData,
      key,
      usesFormDerivedAbilities: this.baseUsesFormDerivedAbilities(),
    });
    const fusionOwner = (key: "passive" | "passive3") => {
      const data =
        this.fusionCustomPokemonData
        ?? (createFusionData ? (this.fusionCustomPokemonData = new CustomPokemonData()) : null);
      return data
        ? {
            data,
            key,
            usesFormDerivedAbilities: this.fusionUsesFormDerivedAbilities(),
          }
        : null;
    };

    if (!this.isFusion()) {
      return [baseOwner("ability"), baseOwner("passive"), baseOwner("passive2"), baseOwner("passive3")][slot] ?? null;
    }
    return [baseOwner("ability"), fusionOwner("passive"), baseOwner("passive2"), fusionOwner("passive3")][slot] ?? null;
  }

  private resolveDerivedPassiveIds(): readonly [AbilityId, AbilityId, AbilityId] {
    const baseIds = this.species.getPassiveAbilities(this.formIndex);
    if (!this.isFusion() || !this.fusionSpecies) {
      return baseIds;
    }
    const fusionIds = this.fusionSpecies.getPassiveAbilities(this.fusionFormIndex);
    return [fusionIds[0], baseIds[1], fusionIds[2]];
  }

  /**
   * Gets a list of all instances of a given ability attribute among abilities this pokemon has.
   * Accounts for all the various effects which can affect whether an ability will be present or
   * in effect, and both passive and non-passive.
   * @param attrType - {@linkcode AbAttr} The ability attribute to check for.
   * @param canApply - Whether to check if the ability is currently active; Default `true`
   * @param ignoreOverride - Whether to ignore ability changing effects; Default `false`
   * @returns An array of all the ability attributes on this ability.
   */
  public getAbilityAttrs<T extends AbAttrString>(attrType: T, canApply = true, ignoreOverride = false): AbAttrMap[T][] {
    const abilityAttrs: AbAttrMap[T][] = [];

    // ER 3-passive model: gather attrs from the active ability AND all eligible
    // innate (passive) slots, not just slot 0. Mirrors applyAbAttrsInternal's
    // gating (enemy level slot-limit + per-slot canApplyAbility + id dedup) so
    // query methods agree with what applyAbAttrs actually fires. Previously this
    // only consulted getPassiveAbility() (slot 0), making innates in slots 1-2
    // invisible (e.g. innate Rock Head failing to block recoil).
    const active = this.getAbility(ignoreOverride);
    const seen = new Set<number>([active.id]);
    if (!canApply || this.canApplyAbility()) {
      abilityAttrs.push(...active.getAttrs(attrType));
    }

    const passives = this.getPassiveAbilities();
    const slotLimit = getEnemyPassiveSlotLimit(this);
    for (let slot = 0; slot < passives.length; slot++) {
      // ER Black Shinies (#349): GIFT slots (>= 3) ignore the enemy level limit.
      if (slot < 3 && slot >= slotLimit) {
        continue;
      }
      const pa = passives[slot];
      if (!pa || seen.has(pa.id)) {
        continue;
      }
      if (!canApply || this.canApplyAbility(true, slot)) {
        abilityAttrs.push(...pa.getAttrs(attrType));
        seen.add(pa.id);
      }
    }

    return abilityAttrs;
  }

  /**
   * ER (#425): EVERY ability attr currently applicable on this Pokémon — the
   * active ability plus each ELIGIBLE innate slot, with the same gating as
   * {@linkcode getAbilityAttrs} / applyAbAttrsInternal (enemy level slot-limit,
   * per-slot {@linkcode canApplyAbility} — which enforces the player's candy
   * unlocks — and ability-id dedup).
   *
   * The "registration-free" name-scan sites (OffensiveTypeChartOverrideAbAttr
   * and friends) used to read `getAbility().attrs` + `getPassiveAbilities()`
   * RAW, which leaked LOCKED innates into battle — a locked Overwhelm let
   * Dragon moves hit Fairies. All such sites must route through this.
   */
  public getAllActiveAbilityAttrs(): readonly AbAttrMap[AbAttrString][] {
    const out: AbAttrMap[AbAttrString][] = [];
    const active = this.getAbility();
    const seen = new Set<number>([active.id]);
    if (this.canApplyAbility()) {
      out.push(...active.attrs);
    }
    const passives = this.getPassiveAbilities();
    const slotLimit = getEnemyPassiveSlotLimit(this);
    for (let slot = 0; slot < passives.length; slot++) {
      // ER Black Shinies (#349): GIFT slots (>= 3) ignore the enemy level limit.
      if (slot < 3 && slot >= slotLimit) {
        continue;
      }
      const pa = passives[slot];
      if (!pa || seen.has(pa.id)) {
        continue;
      }
      if (this.canApplyAbility(true, slot)) {
        out.push(...pa.attrs);
        seen.add(pa.id);
      }
    }
    return out;
  }

  /**
   * Set this Pokémon's temporary ability, activating it if it normally activates on summon
   *
   * Also clears primal weather if it is from the ability being changed
   * @param ability - The temporary ability to set
   * @param passive - Whether to set the passive ability instead of the non-passive one; default `false`
   */
  public setTempAbility(ability: Ability, passive = false): void {
    // ER Ability Shield: the holder's ability cannot be changed or replaced.
    if (erTacticalProtectsAbility(this)) {
      globalScene.phaseManager.queueMessage(`${this.getNameToRender()}'s Ability Shield protected its Ability!`);
      return;
    }
    applyOnLoseAbAttrs({ pokemon: this, passive });
    if (passive) {
      this.summonData.passiveAbility = ability.id;
    } else {
      this.summonData.ability = ability.id;
    }
    applyOnGainAbAttrs({ pokemon: this, passive });
  }

  /**
   * Set this Pokémon's temporary passive ability triple. Used by transform/
   * Imposter to copy the target's full ER 3-passive set in addition to its
   * active ability.
   *
   * Each non-null entry replaces the corresponding species-derived passive
   * slot in {@linkcode getPassiveAbilities}. Calls
   * {@linkcode applyOnLoseAbAttrs}/{@linkcode applyOnGainAbAttrs} per slot so
   * abilities with on-summon hooks re-trigger correctly when the passive
   * changes mid-battle.
   * @param passives - A triple of passive `Ability`s (or `null` for an empty
   *   slot), e.g. the result of `target.getPassiveAbilities()`.
   */
  public setTempPassives(passives: readonly (Ability | null)[]): void {
    // Capture the previous resolved passives so we can fire onLose attrs per slot.
    const previous = this.getPassiveAbilities();
    for (let slot = 0; slot < 3; slot++) {
      // Fire onLose for any pre-existing slot whose id differs from the new value
      // so abilities like Drought (primal weather) correctly clean up.
      if (previous[slot] !== null && previous[slot]?.id !== passives[slot]?.id) {
        applyOnLoseAbAttrs({ pokemon: this, passive: true, passiveSlot: slot as 0 | 1 | 2 });
      }
    }
    this.summonData.passiveAbilities = passives.map(p => (p === null ? AbilityId.NONE : p.id));
    for (let slot = 0; slot < 3; slot++) {
      if (passives[slot] !== null && previous[slot]?.id !== passives[slot]?.id) {
        applyOnGainAbAttrs({ pokemon: this, passive: true, passiveSlot: slot as 0 | 1 | 2 });
      }
    }
  }

  /** Mark the Pokémon's ability as revealed. */
  public revealAbility(): void {
    this.waveData.abilityRevealed = true;
  }

  /**
   * Suppresses an ability and calls its onlose attributes
   */
  public suppressAbility() {
    // ER Ability Shield: the holder's ability cannot be suppressed.
    if (erTacticalProtectsAbility(this)) {
      globalScene.phaseManager.queueMessage(`${this.getNameToRender()}'s Ability Shield protected its Ability!`);
      return;
    }
    applyOnLoseAbAttrs({ pokemon: this, passive: true });
    applyOnLoseAbAttrs({ pokemon: this, passive: false });
    this.summonData.abilitySuppressed = true;
  }

  /**
   * Checks if a pokemon has a passive either from:
   *  - bought with starter candy
   *  - set by override
   *  - is a boss pokemon
   * @returns `true` if the Pokemon has a passive
   */
  public hasPassive(): boolean {
    // ER Black Shinies (#349): the GIFT slot is always active, regardless of
    // candy unlocks — a black shiny always "has a passive", and so does an
    // ally currently RECEIVING a shared gift on the field.
    if (this.customPokemonData?.erBlackShiny || getErSharedGiftAbilityIdsFor(this).length > 0) {
      return true;
    }
    // returns override if valid for current case
    // TODO: This can be simplified greatly with minimal effort via ternaries
    if (
      (Overrides.HAS_PASSIVE_ABILITY_OVERRIDE === false && this.isPlayer())
      || (Overrides.ENEMY_HAS_PASSIVE_ABILITY_OVERRIDE === false && this.isEnemy())
    ) {
      return false;
    }
    if (
      ((Overrides.PASSIVE_ABILITY_OVERRIDE !== AbilityId.NONE || Overrides.HAS_PASSIVE_ABILITY_OVERRIDE)
        && this.isPlayer())
      || ((Overrides.ENEMY_PASSIVE_ABILITY_OVERRIDE !== AbilityId.NONE || Overrides.ENEMY_HAS_PASSIVE_ABILITY_OVERRIDE)
        && this.isEnemy())
    ) {
      return true;
    }

    const { gameMode } = globalScene;
    if (gameMode.isDaily && this.customPokemonData.passive != null && this.customPokemonData.passive !== -1) {
      return true;
    }

    // ER 3-passive model: for the player, "has passive" means ANY of the 3 innate
    // slots is unlocked AND enabled in starterData. The legacy single `this.passive`
    // flag reflected slot 0 only, so unlocking 2+ slots (or only slot 2) broke it.
    let basePassive = this.passive;
    if (this.isPlayer()) {
      // ER Youngster mode (#368): innates are temp-unlocked by level for the
      // run, so the player "has a passive" whenever any slot is filled. ER
      // (#379): DAILY runs likewise unlock all innates for the run.
      // #611: read each slot's unlock from the species that OWNS it (fusion-aware),
      // so a fusion whose 3rd innate is unlocked only on the fusion species counts.
      basePassive =
        ([0, 1, 2] as const).some(s => isSlotActive(this.innateSlotPassiveAttr(s), s))
        || ((erYoungsterFreeInnateSlots(this.level) > 0 || gameMode.isDaily)
          && this.getPassiveAbilities().some(a => a != null)) // ER (#381): a TRUANT innate is always live (it is a nerf). // ER Ability Capsule run-unlock (maintainer request): a run-unlocked innate // makes the mon "have a passive" this run, so the candy-unlock gate at the // top of canApplyAbility (which short-circuits when hasPassive() is false) // lets the run-only innate through. Run-scoped; never a permanent unlock.
        || (this.customPokemonData?.erRunUnlockedAbilitySlots?.length ?? 0) > 0
        || this.getPassiveAbilities()
          .slice(0, 3)
          .some(a => a?.id === AbilityId.TRUANT);
    } else if (this.isEnemy()) {
      // ER: enemies ALWAYS have their innates active (no candy-unlock gate) — unlike
      // the player, whose innate slots are gated by `passiveAttr` above. This only
      // enables the passive at all; the NUMBER of enemy innate slots still ramps
      // with level via `getEnemyPassiveSlotLimit()`. Bosses are not special-cased:
      // vanilla's boss-passive suppression is intentionally not used in ER.
      basePassive = this.getPassiveAbilities().some(a => a != null);
    }
    const hasPassive = new BooleanHolder(basePassive);
    applyChallenges(ChallengeType.PASSIVE_ACCESS, this, hasPassive);

    return hasPassive.value || this.isBoss();
  }

  /**
   * Whether an ability "drives a form change" — i.e. it IS a species' form
   * mechanic (Forecast, Hunger Switch, Flower Gift, Zen Mode, Ice Face, …).
   *
   * ER relocates several of these signature abilities from the active slot into
   * an INNATE. Innates are normally gated behind the candy passive unlock, which
   * would stop those species from ever changing form until unlocked (Castform
   * ignoring weather, Morpeko never toggling hunger form, …). Allowing a
   * form-change ability to drive its form change is always safe — it is identity,
   * not a power bonus — so the unlock gates in {@linkcode canApplyAbility},
   * {@linkcode hasAbility} and {@linkcode hasAbilityWithAttr} carve it out.
   */
  private static readonly FORM_CHANGE_DRIVER_ATTRS = [
    "PostSummonFormChangeByWeatherAbAttr",
    "PostWeatherChangeFormChangeAbAttr",
    "PostTurnFormChangeAbAttr",
    "PostSummonFormChangeAbAttr",
    "PostBattleInitFormChangeAbAttr",
    "PreSwitchOutFormChangeAbAttr",
    "PostFaintFormChangeAbAttr",
    "PostVictoryFormChangeAbAttr",
    "IceFaceFormChangeAbAttr",
    // ER Patchwork's fog-restore of a busted disguise (identity, not a power
    // spike) — carve out both hooks so the innate drives it without the unlock.
    "FogRestoreDisguiseFormChangeAbAttr",
    "PostSummonFogRestoreDisguiseAbAttr",
  ] as const satisfies readonly AbAttrString[];

  private abilityDrivesFormChange(ability: Ability | null | undefined): boolean {
    if (!ability) {
      return false;
    }
    // Battle Bond is a POWER SPIKE (Greninja -> Ash, Darmanitan-Bond -> Blunder,
    // plus a stat boost on form-less users), NOT passive species identity like the
    // weather/turn/summon form changes below. It must gate like any other innate:
    // a LOCKED Battle Bond innate does NOTHING on a KO (no form change AND no stat
    // boost) until the slot is unlocked - whereas before, because the ability
    // *carries* form-change-driver attrs, the whole ability (incl. the stat boost)
    // bypassed the unlock gate (the "Battle Bond procced/boosted while locked" bug).
    // When the slot IS unlocked, the form (when a path exists) or the boost fires
    // normally. Excluded explicitly here, the inverse of the STANCE_CHANGE case.
    if (ability.id === AbilityId.BATTLE_BOND) {
      return false;
    }
    // ER relocates Stance Change into an INNATE slot (Aegislash #480). Unlike the
    // weather/turn form abilities above, Stance Change is a gate-only MARKER with
    // no form-change AbAttr — the actual swap lives in the form-change table keyed
    // on `hasAbility(STANCE_CHANGE)`. Treat it as a driver so its innate slot is
    // never candy/level gated; otherwise Aegislash stays stuck in one form until
    // the slot unlocks (the cause of the "stance change stuck" report).
    if (ability.id === AbilityId.STANCE_CHANGE) {
      return true;
    }
    return Pokemon.FORM_CHANGE_DRIVER_ATTRS.some(attr => ability.hasAttr(attr));
  }

  /**
   * Check whether this Pokémon can apply its current ability
   *
   * @remarks
   * This should rarely be
   * directly called, as {@linkcode hasAbility} and {@linkcode hasAbilityWithAttr} already call this.
   * @param passive - Whether to check the passive (`true`) or non-passive (`false`) ability; default `false`
   * @param passiveSlot - When `passive` is `true`, which of the 3 ER passive slots
   *   (0, 1, or 2) to check. Defaults to slot 0 for legacy single-passive
   *   callers. Ignored when `passive` is `false`.
   * @returns Whether the ability can be applied. Returns `false` immediately when
   *   the requested passive slot is empty (so the dispatcher in
   *   {@linkcode applySingleAbAttrs} short-circuits without falling back to slot 0).
   */
  /**
   * The candy `passiveAttr` that governs the unlock of innate `slot` for this mon.
   * For a fusion the innate slots 0 and 2 (passive / passive3) belong to the FUSION
   * species and slot 1 (passive2) to the base - mirroring {@linkcode getAbilitySlotOwner}
   * - so each slot's unlock must be read from the species that OWNS it. For a
   * non-fusion every slot uses the base species. (#611: a passive3 unlocked on the
   * fusion species was ignored because every slot consulted the base's `passiveAttr`.)
   *
   * Public so UI surfaces that render per-slot lock state (the in-battle Abilities
   * panel) read the unlock from the same owning species the battle-time gates do,
   * keeping "shown locked" in sync with "actually live".
   */
  public innateSlotPassiveAttr(slot: 0 | 1 | 2): number {
    // Co-op (#633 Fix #3): a merged co-op mon carries its OWNER's per-account innate-unlock
    // snapshot. Read that instead of THIS client's local `starterData` - otherwise the same
    // shared mon's active innates would be gated by each player's own candy unlocks (a
    // divergent per-account state). Gated strictly to co-op + a present snapshot, so solo /
    // non-merged mons fall through to the unchanged local-account read below.
    if (globalScene.gameMode.isCoop && this.customPokemonData?.coopPassiveAttr != null) {
      return this.customPokemonData.coopPassiveAttr[slot] ?? 0;
    }
    const owner =
      this.isFusion() && this.fusionSpecies && (slot === 0 || slot === 2) ? this.fusionSpecies : this.species;
    return globalScene.gameData.starterData[owner.getRootSpeciesId()]?.passiveAttr ?? 0;
  }

  public canApplyAbility(passive = false, passiveSlot = 0): boolean {
    // ER 3-passive: resolve the candidate ability first (before the unlock gates
    // below) so we can special-case form-change-driving innates. We avoid falling
    // back to `this.getAbility()` for an empty passive slot because that would
    // double-fire on legacy species (slots 1/2 are NONE), and callers explicitly
    // requesting an empty slot should get `false` (nothing to apply).
    const ability = passive ? this.getPassiveAbilities()[passiveSlot] : this.getAbility();
    if (!ability) {
      return false;
    }
    // ER Giratina's Bargain - Curiosity (#544): a slot the player LOCKED via the
    // Curiosity gamble is dead for the rest of the run. The ER ability-slot index
    // is 0 for the active ability and `passiveSlot + 1` for an innate slot
    // (matching {@linkcode getAbilitySlots}). This wins over the form-change
    // exemption below - the player explicitly chose to disable THIS slot, so even
    // a relocated Stance Change / Forecast innate goes silent. Player-only: enemy
    // innate gating is by level, and a copied/transformed enemy must not inherit a
    // player's lock set. Run-scoped (serialized on customPokemonData), never an
    // account unlock.
    if (this.isPlayer() && this.customPokemonData?.erLockedAbilitySlots?.includes(passive ? passiveSlot + 1 : 0)) {
      return false;
    }
    // Form-change-driving innates (Forecast/Hunger Switch/Flower Gift/… relocated
    // by ER into an innate slot) are species identity and must never be gated
    // behind the candy passive unlock — see {@linkcode abilityDrivesFormChange}.
    // (Battle Bond is deliberately EXCLUDED from that exemption — it is a power
    // spike, not passive identity, so a locked Battle Bond innate does nothing.)
    const drivesFormChange = passive && this.abilityDrivesFormChange(ability);
    // ER Black Shinies (#349): the GIFT slot (>= 3) is exempt from hasPassive
    // and from candy unlock gates — it is always live (suppression below still
    // applies, so Neutralizing Gas / ER Frisk affect it like any ability).
    const isGiftSlot = passive && passiveSlot >= 3;
    if (passive && !isGiftSlot && !this.hasPassive() && !drivesFormChange) {
      return false;
    }
    // ER 3-passive model: gate each innate slot individually for the player by its
    // candy unlock + enable state. Skipped when a passive override forces passives
    // on (tests/dev) or the slot drives a form change. Enemy slot gating is by
    // level, applied in applyAbAttrsInternal.
    if (passive && !isGiftSlot && this.isPlayer() && !drivesFormChange) {
      const overridden =
        Overrides.HAS_PASSIVE_ABILITY_OVERRIDE === true || Overrides.PASSIVE_ABILITY_OVERRIDE !== AbilityId.NONE;
      if (!overridden) {
        // #611: read the unlock from the species that OWNS this slot (the fusion
        // species for the fusion-owned slots 0/2). See `innateSlotPassiveAttr`.
        const passiveAttr = this.innateSlotPassiveAttr(passiveSlot as 0 | 1 | 2);
        // ER Youngster mode (#368): innate slots are TEMP-unlocked by level
        // for the run (no candy purchase needed; nothing persisted) — the
        // same 1/15/24 ramp enemies use. Candy unlocks still count too.
        // ER (#379): DAILY runs unlock ALL innates for the run, run-only.
        // ER (#381): a TRUANT innate is a NERF - it is always active for free
        // (gating a downside behind a candy purchase makes no sense).
        const freeInnate =
          passiveSlot < erYoungsterFreeInnateSlots(this.level)
          || globalScene.gameMode?.isDaily === true // ER Innate Shrine (#514): a mon attuned at the Temple shrine has all its // innate slots unlocked for the run.
          || this.customPokemonData?.erInnateShrineUnlocked === true // ER Ability Capsule run-unlock (maintainer request): the INVERSE of the // Curiosity lock - a slot the player paid a capsule to "unlock an innate for // the run" fires this run without the permanent candy unlock. Stored as the // ER slot index (passiveSlot + 1), serialized run-only on customPokemonData; // never writes starterData.passiveAttr. The Curiosity lock above (which // returns false before reaching here) still wins, so a run-unlocked slot that // is ALSO Curiosity-locked stays dead.
          || this.customPokemonData?.erRunUnlockedAbilitySlots?.includes(passiveSlot + 1) === true
          || ability.id === AbilityId.TRUANT;
        if (!freeInnate && !isSlotActive(passiveAttr, passiveSlot as 0 | 1 | 2)) {
          return false;
        }
      }
    }
    if (this.isFusion() && ability.hasAttr("NoFusionAbilityAbAttr")) {
      return false;
    }
    // Suppression / transformation checks are ignored during moveset generation
    if (globalScene.movesetGenInProgress) {
      return true;
    }
    if (this.isTransformed() && ability.hasAttr("NoTransformAbilityAbAttr")) {
      return false;
    }
    const arena = globalScene?.arena;
    if (arena.ignoreAbilities && arena.ignoringEffectSource !== this.getBattlerIndex() && ability.ignorable) {
      return false;
    }
    if (this.summonData.abilitySuppressed && ability.suppressable) {
      return false;
    }
    const suppressAbilitiesTag = arena.getTag(ArenaTagType.NEUTRALIZING_GAS) as SuppressAbilitiesTag;
    const suppressOffField = ability.hasAttr("PreSummonAbAttr");
    if ((this.isOnField() || suppressOffField) && suppressAbilitiesTag && !suppressAbilitiesTag.beingRemoved) {
      const thisAbilitySuppressing = ability.hasAttr("PreLeaveFieldRemoveSuppressAbilitiesSourceAbAttr");
      const hasSuppressingAbility = this.hasAbilityWithAttr("PreLeaveFieldRemoveSuppressAbilitiesSourceAbAttr", false);
      // Neutralizing gas is up - suppress abilities unless they are unsuppressable or this pokemon is responsible for the gas
      // (Balance decided that the other ability of a neutralizing gas pokemon should not be neutralized)
      // If the ability itself is neutralizing gas, don't suppress it (handled through arena tag)
      const unsuppressable =
        !ability.suppressable
        || thisAbilitySuppressing
        || (hasSuppressingAbility && !suppressAbilitiesTag.shouldApplyToSelf());
      if (!unsuppressable) {
        return false;
      }
    }
    // ER Mental Pollution (816): while an OTHER on-field Pokémon holds an ACTIVE
    // Mental Pollution AND is currently enraged (ER_ENRAGE), this Pokémon's
    // suppressable abilities are disabled for as long as it stays on the field
    // (foes and allies alike; the enraged holder is self-exempt). The enrage
    // state itself broadcasts the suppression — a foe that never attacks the
    // holder is still suppressed. Dynamic: lifts the moment the holder stops
    // being enraged (i.e. switches out) or this mon leaves the field.
    if (
      ability.suppressable
      && this.isOnField()
      && globalScene
        .getField(true)
        .some(
          p =>
            p !== this
            && p.getTag(BattlerTagType.ER_ENRAGE) != null
            && p.hasAbilityWithAttr("SuppressFieldAbilitiesWhenEnragedAbAttr"),
        )
    ) {
      return false;
    }
    return (this.hp > 0 || ability.bypassFaint) && !ability.conditions.find(condition => !condition(this));
  }

  /**
   * Check whether a pokemon has the specified ability in effect, either as a normal or passive ability.
   * Accounts for all the various effects which can disable or modify abilities.
   * @param ability - The {@linkcode AbilityId | Ability} to check for
   * @param canApply - Whether to check if the ability is currently active; default `true`
   * @param ignoreOverride - Whether to ignore any overrides caused by {@linkcode MoveId.TRANSFORM | Transform}; default `false`
   * @returns Whether this {@linkcode Pokemon} has the given ability
   */
  public hasAbility(ability: AbilityId, canApply = true, ignoreOverride = false): boolean {
    if (this.getAbility(ignoreOverride).id === ability && (!canApply || this.canApplyAbility())) {
      return true;
    }
    // ER 3-passive model: check every eligible innate slot, not just slot 0.
    // Short-circuit on "no usable passive" EXCEPT when the queried ability is a
    // form-change driver (Forecast/Hunger Switch/Flower Gift relocated into an
    // innate slot) — those are never candy-gated, so we must still scan the slots
    // to find them (covers both the "changes form" canApply path and the "revert
    // to normal" canApply=false path, e.g. Air Lock / switch-out).
    if (!this.hasPassive() && !this.abilityDrivesFormChange(allAbilities[ability])) {
      return false;
    }
    const passives = this.getPassiveAbilities();
    const slotLimit = getEnemyPassiveSlotLimit(this);
    for (let slot = 0; slot < passives.length; slot++) {
      const pa = passives[slot];
      // Form-change drivers are species identity, never gated by the enemy slot
      // limit or candy unlock — match them regardless of slot position (#480:
      // Stance Change sits in innate slot 2, past a low-level enemy's slot limit).
      if (pa?.id === ability && this.abilityDrivesFormChange(pa) && (!canApply || this.canApplyAbility(true, slot))) {
        return true;
      }
      // ER Black Shinies (#349): GIFT slots (>= 3) ignore the enemy slot limit.
      if (slot < 3 && slot >= slotLimit) {
        continue;
      }
      if (pa?.id === ability && (!canApply || this.canApplyAbility(true, slot))) {
        return true;
      }
    }
    return false;
  }

  /**
   * ER meta/pool helper: does this Pokémon have {@linkcode ability} available to it
   * as its active ability OR as an **unlocked** innate slot?
   *
   * Unlike {@linkcode hasAbility} (which, with `canApply: false`, matches a latent
   * innate regardless of whether the player has unlocked it, and with
   * `canApply: true` also folds in transient battle state like HP / suppression),
   * this only reflects what the player permanently has access to: the active
   * ability plus any candy-unlocked innate slot. It deliberately ignores
   * field/HP/suppression so it is safe to call out of battle (reward pools, shop).
   *
   * Used by ability-gated reward-pool conditions so items that only benefit a
   * locked innate (e.g. Mystical Rock for an un-unlocked Seed Sower) don't appear.
   */
  public hasUnlockedAbility(ability: AbilityId): boolean {
    if (this.getAbility(true).id === ability) {
      return true;
    }
    const passives = this.getPassiveAbilities();
    const slotLimit = getEnemyPassiveSlotLimit(this);
    for (let slot = 0; slot < 3 && slot < slotLimit; slot++) {
      const pa = passives[slot as 0 | 1 | 2];
      if (pa?.id !== ability) {
        continue;
      }
      // Form-change-driving innates are species identity, never candy-gated.
      if (this.abilityDrivesFormChange(pa)) {
        return true;
      }
      // Enemy innates are ungated (their slot count still ramps by level elsewhere).
      if (!this.isPlayer()) {
        return true;
      }
      // Dev/test passive overrides force all innate slots on (mirrors canApplyAbility).
      const overridden =
        Overrides.HAS_PASSIVE_ABILITY_OVERRIDE === true || Overrides.PASSIVE_ABILITY_OVERRIDE !== AbilityId.NONE;
      // #611: a fusion's slots 0/2 are owned by the fusion species, so read each
      // slot's unlock from its owner (mirrors `canApplyAbility`/`hasPassive`) - keeps
      // reward-pool gating consistent with what is actually live in battle.
      const passiveAttr = this.innateSlotPassiveAttr(slot as 0 | 1 | 2);
      if (overridden || isSlotActive(passiveAttr, slot as 0 | 1 | 2)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check whether this pokemon has an ability with the specified attribute in effect, either as a normal or passive ability.
   * Accounts for all the various effects which can disable or modify abilities.
   * @param attrType - The {@linkcode AbAttr | attribute} to check for
   * @param canApply - Whether to check if the ability is currently active; default `true`
   * @param ignoreOverride - Whether to ignore any overrides caused by {@linkcode MoveId.TRANSFORM | Transform}; default `false`
   * @returns Whether this Pokemon has an ability with the given {@linkcode AbAttr}.
   */
  public hasAbilityWithAttr(attrType: AbAttrString, canApply = true, ignoreOverride = false): boolean {
    if ((!canApply || this.canApplyAbility()) && this.getAbility(ignoreOverride).hasAttr(attrType)) {
      return true;
    }
    // ER 3-passive model: check every eligible innate slot, not just slot 0.
    // Short-circuit on "no usable passive" EXCEPT when the queried attribute is a
    // form-change driver — those innates are never candy-gated (see `hasAbility`).
    if (!this.hasPassive() && !(Pokemon.FORM_CHANGE_DRIVER_ATTRS as readonly AbAttrString[]).includes(attrType)) {
      return false;
    }
    const passives = this.getPassiveAbilities();
    const slotLimit = getEnemyPassiveSlotLimit(this);
    for (let slot = 0; slot < passives.length; slot++) {
      // ER Black Shinies (#349): GIFT slots (>= 3) ignore the enemy slot limit.
      if (slot < 3 && slot >= slotLimit) {
        continue;
      }
      const pa = passives[slot];
      if (pa?.hasAttr(attrType) && (!canApply || this.canApplyAbility(true, slot))) {
        return true;
      }
    }
    return false;
  }

  /**
   * Return the ability priorities of the pokemon's ability and, if enabled, its passive ability
   * @returns A tuple containing the ability priorities of the pokemon
   */
  public getAbilityPriorities(): [activePriority: number] | [activePriority: number, passivePriority: number] {
    const abilityPriority = this.getAbility().postSummonPriority;
    if (this.hasPassive()) {
      return [abilityPriority, this.getPassiveAbility().postSummonPriority];
    }
    return [abilityPriority];
  }

  /**
   * Gets the weight of the Pokemon with subtractive modifiers (Autotomize) happening first
   * and then multiplicative modifiers happening after (Heavy Metal and Light Metal)
   * @returns the kg of the Pokemon (minimum of 0.1)
   */
  public getWeight(): number {
    const autotomizedTag = this.getTag(AutotomizedTag);
    let weightRemoved = 0;
    if (autotomizedTag != null) {
      weightRemoved = 100 * autotomizedTag.autotomizeCount;
    }
    const minWeight = 0.1;
    const weight = new NumberHolder(this.species.weight - weightRemoved);

    // This will trigger the ability overlay so only call this function when necessary
    applyAbAttrs("WeightMultiplierAbAttr", { pokemon: this, weight });
    return Math.max(minWeight, weight.value);
  }

  /**
   * @returns This Pokemon's current Tera {@linkcode PokemonType | type}, accounting for species-based restrictions
   */
  // TODO: Make this into a getter
  getTeraType(): PokemonType {
    if (this.hasSpecies(SpeciesId.TERAPAGOS)) {
      return PokemonType.STELLAR;
    }
    if (this.hasSpecies(SpeciesId.OGERPON)) {
      const ogerponForm = this.species.speciesId === SpeciesId.OGERPON ? this.formIndex : this.fusionFormIndex;
      switch (ogerponForm) {
        case 0:
        case 4:
          return PokemonType.GRASS;
        case 1:
        case 5:
          return PokemonType.WATER;
        case 2:
        case 6:
          return PokemonType.FIRE;
        case 3:
        case 7:
          return PokemonType.ROCK;
      }
    }
    if (this.hasSpecies(SpeciesId.SHEDINJA)) {
      return PokemonType.BUG;
    }
    return this.teraType;
  }

  public isGrounded(): boolean {
    // ER Iron Ball grounds the holder unconditionally (wins over any float);
    // an unpopped Air Balloon ungrounds it. Iron Ball is checked first.
    if (erTacticalIronBallGrounds(this)) {
      return true;
    }
    if (erTacticalAirBalloonUngrounds(this)) {
      return false;
    }
    return (
      !!this.getTag(GroundedTag)
      || (!this.isOfType(PokemonType.FLYING, true, true)
        && !this.hasAbility(AbilityId.LEVITATE) // Elite Redux: `FloatAbAttr` (Hover, Fey Flight, …) ungrounds like Levitate.
        && !this.hasAbilityWithAttr("FloatAbAttr")
        && !this.getTag(BattlerTagType.FLOATING)
        && !this.getTag(SemiInvulnerableTag))
    );
  }

  /**
   * Determines whether this Pokemon is prevented from running or switching due
   * to effects from moves and/or abilities.
   * @param trappedAbMessages - If defined, ability trigger messages
   * (e.g. from Shadow Tag) are forwarded through this array.
   * @param simulated - If `true`, applies abilities via simulated calls.
   * @returns `true` if the pokemon is trapped
   */
  public isTrapped(trappedAbMessages: string[] = [], simulated = true): boolean {
    const commandedTag = this.getTag(BattlerTagType.COMMANDED);
    if (commandedTag?.getSourcePokemon()?.isActive(true)) {
      return true;
    }

    if (this.isOfType(PokemonType.GHOST)) {
      return false;
    }

    // ER Shed Shell / Smoke Ball: the holder can always switch out / flee,
    // bypassing every trapping effect (ability, move-tag and Fairy Lock).
    if (erTacticalBypassesTrap(this)) {
      return false;
    }

    /** Holds whether the pokemon is trapped due to an ability */
    const trapped = new BooleanHolder(false);
    // ER Ward Stones (#358): merely HOLDING a stone makes the bearer immune to
    // ability-based trapping (Shadow Tag / Arena Trap / Magnet Pull style) —
    // this one case costs NO charge (maintainer spec). Trapping from moves,
    // tags or Fairy Lock still applies below.
    if (!findErWardStone(this)) {
      for (const opponent of inSpeedOrder(this.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER)) {
        if (opponent.switchOutStatus === false) {
          applyAbAttrs(
            "CheckTrappedAbAttr",
            { pokemon: opponent, trapped, opponent: this, simulated },
            trappedAbMessages,
          );
        }
      }
    }

    const side = this.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    return (
      trapped.value
      || !!this.getTag(TrappedTag) // ER FEAR traps the bearer (ROM). Ghost's early-return above still lets // Ghosts switch out, matching vanilla trap rules.
      || !!this.getTag(BattlerTagType.ER_FEAR) // ER Overloaded (5927): the holder cannot voluntarily switch while at 4 stacks.
      || erOverloadedSelfLocked(this)
      || !!globalScene.arena.getTagOnSide(ArenaTagType.FAIRY_LOCK, side)
    );
  }

  /**
   * Calculates the type of a move when used by this Pokemon after
   * type-changing move and ability attributes have applied.
   * @param move - {@linkcode Move} The move being used.
   * @param simulated - If `true`, prevents showing abilities applied in this calculation.
   * @returns The {@linkcode PokemonType} of the move after attributes are applied
   */
  public getMoveType(move: Move, simulated = true): PokemonType {
    const moveTypeHolder = new NumberHolder(move.type);

    applyMoveAttrs("VariableMoveTypeAttr", this, null, move, moveTypeHolder);

    // Moves that are overridden by an ability (e.g. Aerilate) should not have their type
    // changed by MoveTypeChangeAbAttr
    if (!move.hasAttr("OverrideMoveEffectAttr")) {
      applyAbAttrs("MoveTypeChangeAbAttr", {
        pokemon: this,
        move,
        simulated,
        moveType: moveTypeHolder,
        opponent: this,
      });
    }

    // If the user is terastallized and the move is tera blast, or tera starstorm that is stellar type,
    // then bypass the check for ion deluge and electrify
    if (
      this.isTerastallized
      && (move.id === MoveId.TERA_BLAST
        || (move.id === MoveId.TERA_STARSTORM && moveTypeHolder.value === PokemonType.STELLAR))
    ) {
      return moveTypeHolder.value as PokemonType;
    }

    globalScene.arena.applyTags(ArenaTagType.ION_DELUGE, moveTypeHolder);
    if (this.getTag(BattlerTagType.ELECTRIFIED)) {
      moveTypeHolder.value = PokemonType.ELECTRIC;
    }

    // ER Negative Feedback (5923) prime: the holder's primed next PHYSICAL move
    // takes on the Electric primary type (Fairy second type is applied in
    // getAttackTypeEffectiveness). Flipping the type here means absorb/redirect
    // abilities (Volt Absorb, Lightning Rod) see it as Electric and interact.
    const primedType = dualTypePrimeMoveType(this, move);
    if (primedType !== undefined) {
      moveTypeHolder.value = primedType;
    }

    return moveTypeHolder.value as PokemonType;
  }

  /**
   * Calculate the effectiveness of the move against this Pokémon, including
   * modifiers from move and ability attributes
   * @param source - The attacking Pokémon.
   * @param move - The move being used by the attacking Pokémon.
   * @param ignoreAbility - Whether to ignore abilities that might affect type effectiveness or immunity; default `false`
   * @param simulated - (Default `true`) Whether to apply abilities via simulated calls. \
   *   ⚠️ Should only ever be false during `MoveEffectPhase`
   * @param cancelled - Stores whether the move was cancelled by a non-type-based immunity.
   * @param useIllusion - Whether to consider an active illusion
   * @returns The type damage multiplier, indicating the effectiveness of the move
   */
  getMoveEffectiveness(
    source: Pokemon,
    move: Move,
    ignoreAbility = false,
    simulated = true,
    cancelled?: BooleanHolder,
    useIllusion = false,
    ignoreSourceAbility = false,
  ): TypeDamageMultiplier {
    if (!ignoreSourceAbility && this.turnData?.moveEffectiveness != null) {
      return this.turnData?.moveEffectiveness;
    }

    if (move.hasAttr("TypelessAttr")) {
      return 1;
    }
    const moveType = source.getMoveType(move);

    const typeMultiplier = new NumberHolder(
      move.category !== MoveCategory.STATUS || move.hasAttr("RespectAttackTypeImmunityAttr")
        ? this.getAttackTypeEffectiveness(moveType, { source, simulated, move, useIllusion, ignoreSourceAbility })
        : 1,
    );

    if (this.getTypes(true, true).find(t => move.isTypeImmune(source, this, t))) {
      typeMultiplier.value = 0;
    }

    // ER Mycelium Might (510): the holder's STATUS-category moves bypass TYPE-based
    // immunities/resistances — the type-chart 0x (Thunder Wave vs Ground) and the
    // isTypeImmune 0x (powder vs Grass). Only the type-based zeroing computed above
    // is undone here; ability-based immunities (Soundproof, Levitate) and tag/
    // substitute immunities run later and still hold. Status-application immunities
    // (Toxic vs Steel, Will-O-Wisp vs Fire) live in canSetStatus, handled separately.
    if (
      move.category === MoveCategory.STATUS
      && typeMultiplier.value === 0
      && !ignoreSourceAbility
      && source.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "StatusMoveTypeImmunityBypassAbAttr")
    ) {
      typeMultiplier.value = 1;
    }

    // TODO: Rework to use an apply method specific to Tar Shot
    if (this.getTag(TarShotTag) && moveType === PokemonType.FIRE) {
      typeMultiplier.value *= 2;
    }

    const cancelledHolder = cancelled ?? new BooleanHolder(false);
    // TypeMultiplierAbAttrParams is shared amongst the type of AbAttrs we will be invoking
    const commonAbAttrParams: TypeMultiplierAbAttrParams = {
      pokemon: this,
      opponent: source,
      move,
      cancelled: cancelledHolder,
      simulated,
      typeMultiplier,
    };
    if (!ignoreAbility) {
      applyAbAttrs("TypeImmunityAbAttr", commonAbAttrParams);

      if (!cancelledHolder.value) {
        applyAbAttrs("MoveImmunityAbAttr", commonAbAttrParams);
      }

      // Do not check queenly majesty unless this is being simulated
      // This is because the move effect phase should not check queenly majesty, as that is handled by the move phase
      if (simulated && !cancelledHolder.value) {
        for (const p of this.getAlliesGenerator()) {
          applyAbAttrs("FieldPriorityMoveImmunityAbAttr", {
            pokemon: p,
            opponent: source,
            move,
            cancelled: cancelledHolder,
            simulated,
          });
        }
      }

      // ER Noise Cancel (595): protects the holder AND its ally from being
      // targeted by sound-based moves. The attr rides no standard PreDefend path,
      // so dispatch it explicitly over the target's whole side (holder-inclusive
      // via getAlliesGenerator). NON-simulated on purpose — a hard immunity that
      // must also hold in the real hit phase. Any side member carrying the attr
      // cancels the move against the actual target (SOUND_BASED is a static flag).
      if (!cancelledHolder.value) {
        for (const p of this.getAlliesGenerator()) {
          const ncParams: TypeMultiplierAbAttrParams = { ...commonAbAttrParams, pokemon: p };
          for (const attr of p.getAllActiveAbilityAttrs()) {
            if (attr?.constructor?.name !== "UserFieldFlagImmunityAbAttr") {
              continue;
            }
            const nc = attr as unknown as {
              canApply: (params: TypeMultiplierAbAttrParams) => boolean;
              apply: (params: TypeMultiplierAbAttrParams) => void;
            };
            if (nc.canApply(ncParams)) {
              nc.apply(ncParams);
            }
          }
          if (typeMultiplier.value === 0) {
            break;
          }
        }
      }
    }

    const immuneTags = this.findTags(tag => tag instanceof TypeImmuneTag && tag.immuneType === moveType);
    for (const tag of immuneTags) {
      if (move && !move.getAttrs("HitsTagAttr").some(attr => attr.tagType === tag.tagType)) {
        typeMultiplier.value = 0;
        break;
      }
    }

    // Apply Tera Shell's effect to attacks after all immunities are accounted for
    if (!ignoreAbility && move.category !== MoveCategory.STATUS) {
      applyAbAttrs("FullHpResistTypeAbAttr", commonAbAttrParams);
    }

    if (move.category === MoveCategory.STATUS && move.hitsSubstitute(source, this)) {
      typeMultiplier.value = 0;
    }

    return (cancelledHolder.value ? 0 : typeMultiplier.value) as TypeDamageMultiplier;
  }

  /**
   * Calculate the type effectiveness multiplier of a Move used **against** this Pokemon.
   * @param moveType - The {@linkcode PokemonType} of the move being used
   * @param params - Parameters used to modify the type effectiveness
   * @returns The computed type effectiveness multiplier.
   */
  public getAttackTypeEffectiveness(
    moveType: PokemonType,
    {
      source,
      ignoreSourceAbility = false,
      ignoreStrongWinds = false,
      simulated = true,
      move,
      useIllusion = false,
    }: GetAttackTypeEffectivenessParams = {},
  ): TypeDamageMultiplier {
    if (moveType === PokemonType.STELLAR) {
      return this.isTerastallized ? 2 : 1;
    }

    const types = this.getTypes(true, true, false, useIllusion);
    const { arena } = globalScene;

    // ER Air Balloon: a non-popped balloon makes ANY holder immune to Ground moves
    // (the engine's ground immunity below only covers Flying types + Levitate; the
    // balloon must grant it directly). Iron Ball wins if both are held (isGrounded
    // is then true, so this is skipped).
    if (moveType === PokemonType.GROUND && !this.isGrounded() && erTacticalAirBalloonUngrounds(this)) {
      return 0;
    }

    // Handle flying v ground type immunity without removing flying type so effective types are still effective
    // Related to https://github.com/pagefaultgames/pokerogue/issues/524
    // TODO: Fix once gravity makes pokemon actually grounded in #5950
    if (
      moveType === PokemonType.GROUND
      && types.includes(PokemonType.FLYING)
      && (this.isGrounded() || arena.hasActiveGravity())
    ) {
      types.splice(types.indexOf(PokemonType.FLYING), 1);
    }

    const multi = new NumberHolder(1);
    for (const defenderType of types) {
      const typeMulti = getTypeDamageMultiplier(moveType, defenderType);
      // If the target is immune to the type in question, check for effects that would ignore said nullification
      // TODO: Review if the `isActive` check is needed anymore
      if (
        source?.isActive(true)
        && typeMulti === 0
        && this.checkIgnoreTypeImmunity({ source, simulated, moveType, defenderType, ignoreSourceAbility })
      ) {
        continue;
      }
      multi.value *= typeMulti;
    }

    // Apply any typing changes from Freeze-Dry, etc.
    if (move) {
      applyMoveAttrs("MoveTypeChartOverrideAttr", source ?? null, this, move, multi, types, moveType);
    }

    // ER dual-type PRIME (Negative Feedback 5923): fold the primed move's SECOND
    // type (Fairy) into the effectiveness product. Move-instance DualTypeMoveAttr
    // second types (Closed Circuit's follow-up) are already handled by the
    // MoveTypeChartOverrideAttr pass above; this covers only the primed case.
    if (move && source && !ignoreSourceAbility) {
      const primeSecond = dualTypePrimeSecondType(source, move);
      if (primeSecond !== undefined) {
        multi.value *= this.getAttackTypeEffectiveness(primeSecond, { source });
      }
    }

    // ER OFFENSIVE type-chart overrides: the attacker's ability can rewrite how
    // its own move type interacts with the defender's types (e.g. Ground Shock,
    // Molten Down). Scanned by name (same registration-free pattern as
    // RecoilDamageMultiplierAbAttr) so no central AbAttr-map edit is needed.
    if (source && !ignoreSourceAbility) {
      const sourceAttrs = source.getAllActiveAbilityAttrs();
      for (const attr of sourceAttrs) {
        if (attr?.constructor?.name === "OffensiveTypeChartOverrideAbAttr") {
          // Respect an optional holder-side condition (e.g. Draconize 413 /
          // Draconic Might 841 only pierce Fairy immunity when the HOLDER is
          // Dragon-type). No condition => always fires (Ground Shock, Molten
          // Down, Trash Heap, ...).
          const cond = attr.getCondition?.();
          if (!cond || cond(source)) {
            (attr as unknown as { fire: (mt: PokemonType, dts: PokemonType[], h: NumberHolder) => void }).fire(
              moveType,
              types,
              multi,
            );
          }
        }
        // ER Bone Zone: bone-flagged moves bypass type immunities (0x → 1x) and
        // double resisted damage (<1x → ×2). Needs the move, so gate on it.
        if (move && attr?.constructor?.name === "BoneMoveTypeChartAbAttr") {
          (attr as unknown as { fire: (m: typeof move, h: NumberHolder) => void }).fire(move, multi);
        }
        // ER Desert Spirit: in sand, Ground moves hit airborne (0x → 1x).
        if (attr?.constructor?.name === "WeatherGroundAirborneAbAttr") {
          (attr as unknown as { fire: (mt: PokemonType, h: NumberHolder) => void }).fire(moveType, multi);
        }
      }

      // ER "ignore resistances" (e.g. Normalize): clamp the holder's RESISTED
      // matchups (sub-neutral but not immune) up to neutral. Immunities (0×) and
      // weaknesses (>1×) are left intact.
      if (
        multi.value > 0
        && multi.value < 1
        && sourceAttrs.some(a => a?.constructor?.name === "IgnoreResistancesAbAttr")
      ) {
        multi.value = 1;
      }
    }

    // ER DEFENSIVE type-weakness nulls (e.g. Gifted Mind "Nulls Psychic weakness"):
    // this Pokémon's own ability/innates can divide out a super-effective
    // contribution of one of its types, so the matchup reads neutral (no SE message).
    {
      const defAttrs = this.getAllActiveAbilityAttrs();
      for (const attr of defAttrs) {
        if (attr?.constructor?.name === "DefensiveTypeWeaknessNullAbAttr") {
          (attr as unknown as { fire: (mt: PokemonType, dts: readonly PokemonType[], h: NumberHolder) => void }).fire(
            moveType,
            types,
            multi,
          );
        }
      }
    }

    // Handle strong winds lowering effectiveness of types super effective against pure flying
    if (
      !ignoreStrongWinds
      && arena.weatherType === WeatherType.STRONG_WINDS
      && !arena.weather?.isEffectSuppressed()
      && this.isOfType(PokemonType.FLYING)
      && getTypeDamageMultiplier(moveType, PokemonType.FLYING) === 2
    ) {
      multi.value /= 2;
      if (!simulated) {
        globalScene.phaseManager.queueMessage(i18next.t("weather:strongWindsEffectMessage"));
      }
    }
    // ER Ice Statue: the afflicted target has NO resistances — any sub-neutral
    // multiplier (resistances and immunities) is clamped up to neutral. Its
    // weaknesses (already pure Ice via the type override) still apply.
    if (multi.value < 1 && this.getTag(BattlerTagType.ER_ICE_STATUE) != null) {
      multi.value = 1;
    }
    // ER Dojo (#439 §3): martial mastery - moves of the biome's `unresistedType`
    // (Fighting) are NEVER resisted here. Any sub-neutral matchup (resistances AND
    // immunities, i.e. <1x including 0x) is floored to 1x; weaknesses are untouched.
    // Gated on an active attacker so it only affects real offense in this biome.
    if (
      multi.value < 1
      && source?.isActive(true)
      && getErBiomeRule(globalScene.arena.biomeId)?.unresistedType === moveType
    ) {
      multi.value = 1;
    }
    return multi.value as TypeDamageMultiplier;
  }

  /**
   * Sub-method of {@linkcode getAttackTypeEffectiveness} that handles nullifying type immunities.
   * @param source - The {@linkcode Pokemon} using the move
   * @param simulated - Whether to prevent changes to game state during calculations
   * @param moveType - The {@linkcode PokemonType} of the move being used
   * @param defenderType - The {@linkcode PokemonType} of the defender
   * @returns Whether the type immunity was bypassed
   */
  private checkIgnoreTypeImmunity({
    source,
    simulated,
    moveType,
    defenderType,
    ignoreSourceAbility,
  }: {
    source: Pokemon;
    simulated: boolean;
    moveType: PokemonType;
    defenderType: PokemonType;
    ignoreSourceAbility: boolean;
  }): boolean {
    // TODO: remove type assertion once method is properly typed
    const hasExposed = !!this.findTag(
      tag =>
        [BattlerTagType.IGNORE_DARK, BattlerTagType.IGNORE_GHOST].includes(tag.tagType)
        && (tag as ExposedTag).ignoreImmunity(defenderType, moveType),
    );
    if (hasExposed) {
      return true;
    }

    const ignoreImmunity = new BooleanHolder(false);
    if (!ignoreSourceAbility) {
      applyAbAttrs("IgnoreTypeImmunityAbAttr", {
        pokemon: source,
        cancelled: ignoreImmunity,
        simulated,
        moveType,
        defenderType,
      });
    }
    return ignoreImmunity.value;
  }

  /**
   * Compute the given Pokémon's matchup score against this Pokémon
   * @remarks
   * In most cases, this score ranges from near-zero to 16, but the maximum possible matchup score is 64.
   * @param opponent - The Pokemon to compare this Pokémon against
   * @returns A score value based on how favorable this Pokémon is when fighting the given Pokémon
   */
  getMatchupScore(opponent: Pokemon, useBestMove = false): number {
    const enemyTypes = opponent.getTypes(true, false, false, true);
    /** Is this Pokemon faster than the opponent? */
    const outspeed =
      (this.isActive(true) ? this.getEffectiveStat(Stat.SPD, opponent) : this.getStat(Stat.SPD, false))
      >= opponent.getEffectiveStat(Stat.SPD, this);

    /**
     * Based on how effectively this Pokemon defends against the opponent's types.
     * This score cannot be higher than 4.
     */
    // TODO: This should use a `reduce` over the types
    let defScore = 1 / Math.max(this.getAttackTypeEffectiveness(enemyTypes[0], { source: opponent }), 0.25);
    if (enemyTypes.length > 1) {
      // TODO: Shouldn't this pass `simulated=true` here?
      const secondTypeEff = this.getAttackTypeEffectiveness(enemyTypes[1], {
        source: opponent,
        simulated: false,
        useIllusion: true,
      });
      defScore /= Math.max(secondTypeEff, 0.25);
    }

    const moveset = this.moveset;
    let moveAtkScoreLength = 0;
    let atkScore = 0;
    // TODO: this calculation needs to consider more factors; it's currently very simplistic
    for (const move of moveset) {
      const resolvedMove = move.getMove();
      // Defend against id-map drift: a moveset entry can point to a move
      // that didn't register in allMoves (typically ER customs that failed
      // to init). Skip rather than crash the enemy-command phase.
      if (!resolvedMove) {
        continue;
      }
      // NOTE: Counter and Mirror Coat are considered as attack moves here
      if (resolvedMove.category === MoveCategory.STATUS || move.getPpRatio() <= 0) {
        continue;
      }
      const moveType = resolvedMove.type;
      let thisScore = opponent.getAttackTypeEffectiveness(moveType, {
        source: this,
        simulated: true,
        useIllusion: true,
      });

      // Add STAB multiplier for attack type effectiveness.
      // For now, simply don't apply STAB to moves that may change type
      if (this.isOfType(moveType, true) && !move.getMove().hasAttr("VariableMoveTypeAttr")) {
        thisScore *= 1.5;
      }

      // ER smarter AI (`useBestMove`): take the BEST damaging move's effectiveness
      // rather than the average - if this mon switches in, it uses its strongest
      // move, so a single 4x option shouldn't be diluted by weak coverage. The
      // default (vanilla) path still averages.
      if (useBestMove) {
        atkScore = Math.max(atkScore, thisScore);
      } else {
        atkScore += thisScore;
      }
      moveAtkScoreLength++;
    }
    // Vanilla: average the attack score (|| 1 prevents division by zero). ER's
    // `useBestMove` already holds the max, so skip the averaging there.
    if (!useBestMove) {
      atkScore /= moveAtkScoreLength || 1;
    }
    /**
     * Based on this Pokemon's HP ratio compared to that of the opponent.
     * This ratio is multiplied by 1.5 if this Pokemon outspeeds the opponent;
     * however, the final ratio cannot be higher than 1.
     */
    const hpRatio = this.getHpRatio();
    const oppHpRatio = opponent.getHpRatio();
    // TODO: use better logic for predicting whether the pokemon "is dying"
    // E.g., perhaps check if it would faint if the opponent were to use the same move it just used
    // (twice if the user is slower)
    const isDying = hpRatio <= 0.2;
    let hpDiffRatio = hpRatio + (1 - oppHpRatio);
    if (isDying && this.isActive(true)) {
      //It might be a sacrifice candidate if hp under 20%
      const badMatchup = atkScore < 1.5 && defScore < 1.5;
      if (!outspeed && badMatchup) {
        //It might not be a worthy sacrifice if it doesn't outspeed or doesn't do enough damage
        hpDiffRatio *= 0.85;
      } else {
        hpDiffRatio = 1 - hpRatio + (outspeed ? 0.2 : 0.1);
      }
    } else if (outspeed) {
      hpDiffRatio *= 1.25;
    } else if (hpRatio > 0.2 && hpRatio <= 0.4) {
      // Might be considered to be switched because it's not in low enough health
      hpDiffRatio *= 0.5;
    }
    return (atkScore + defScore) * Math.min(hpDiffRatio, 1);
  }

  /**
   * Get the first evolution this Pokémon meets the conditions to evolve into
   * @remarks
   * Fusion evolutions are also considered.
   * @returns The evolution this pokemon can currently evolve into, or `null` if it cannot evolve
   */
  /**
   * Collect every evolution whose conditions are currently satisfied.
   *
   * Most branched evolutions are disambiguated by their own conditions (time of
   * day, gender, held item, …) so only one validates at a time. When two or more
   * validate simultaneously — i.e. the line genuinely offers the player a choice
   * (e.g. a species with multiple open level-up paths) — all of them are returned
   * so the caller can prompt for a selection. Non-fusion paths come first, in
   * declaration order, so `[0]` matches the legacy {@linkcode getEvolution} pick.
   */
  getValidEvolutions(): SpeciesFormEvolution[] {
    const valid: SpeciesFormEvolution[] = [];

    // ER (megas are permanent resting forms): a battle-only form - Mega / Primal /
    // Gigantamax / Eternamax - is terminal and must NEVER evolve. Several ER level-evo
    // edges are NOT form-gated (preFormKey null), so they fired for the mega form too
    // (reported: Mega Scrafty -> Scrafster; same class for Mega Scyther, Primal Cascoon).
    // The BASE (non-mega) form still evolves normally.
    if (this.isMega() || this.isMax()) {
      return valid;
    }

    if (Object.hasOwn(pokemonEvolutions, this.species.speciesId)) {
      for (const e of pokemonEvolutions[this.species.speciesId]) {
        if (e.validate(this)) {
          valid.push(e);
        }
      }
    }

    if (this.isFusion() && this.fusionSpecies && Object.hasOwn(pokemonEvolutions, this.fusionSpecies.speciesId)) {
      for (const e of pokemonEvolutions[this.fusionSpecies.speciesId]) {
        const fe = new FusionSpeciesFormEvolution(this.species.speciesId, e);
        if (fe.validate(this, true)) {
          valid.push(fe);
        }
      }
    }

    return valid;
  }

  getEvolution(): SpeciesFormEvolution | null {
    return this.getValidEvolutions()[0] ?? null;
  }

  /**
   * Get all level up moves in a given range for a particular pokemon.
   * @param startingLevel - Don't include moves below this level
   * @param includeEvolutionMoves - Whether to include evolution moves
   * @param simulateEvolutionChain - Whether to include moves from prior evolutions
   * @param includeRelearnerMoves - Whether to include moves that would require a relearner. Note the move relearner inherently allows evolution moves
   * @returns A list of moves and the levels they can be learned at
   */
  getLevelMoves(
    startingLevel?: number,
    includeEvolutionMoves = false,
    simulateEvolutionChain = false,
    includeRelearnerMoves = false,
    learnSituation: LearnMoveSituation = LearnMoveSituation.MISC,
  ): LevelMoves {
    const ret: LevelMoves = [];
    let levelMoves: LevelMoves = [];
    if (!startingLevel) {
      startingLevel = this.level;
    }
    if (learnSituation === LearnMoveSituation.EVOLUTION_FUSED && this.fusionSpecies) {
      // For fusion evolutions, get ONLY the moves of the component mon that evolved
      levelMoves = this.getFusionSpeciesForm(true)
        .getLevelMoves()
        .filter(
          lm =>
            (includeEvolutionMoves && lm[0] === EVOLVE_MOVE)
            || (includeRelearnerMoves && lm[0] === RELEARN_MOVE)
            || lm[0] > 0,
        );
    } else {
      if (simulateEvolutionChain) {
        const evolutionChain = this.species.getSimulatedEvolutionChain(
          this.level,
          this.hasTrainer(),
          this.isBoss(),
          this.isPlayer(),
        );
        for (let e = 0; e < evolutionChain.length; e++) {
          // TODO: Might need to pass specific form index in simulated evolution chain
          const speciesLevelMoves = getPokemonSpeciesForm(evolutionChain[e][0], this.formIndex).getLevelMoves();
          if (includeRelearnerMoves) {
            levelMoves.push(...speciesLevelMoves);
          } else {
            levelMoves.push(
              ...speciesLevelMoves.filter(
                lm =>
                  (includeEvolutionMoves && lm[0] === EVOLVE_MOVE)
                  || ((!e || lm[0] > 1) && (e === evolutionChain.length - 1 || lm[0] <= evolutionChain[e + 1][1])),
              ),
            );
          }
        }
      } else {
        levelMoves = this.getSpeciesForm(true)
          .getLevelMoves()
          .filter(
            lm =>
              (includeEvolutionMoves && lm[0] === EVOLVE_MOVE)
              || (includeRelearnerMoves && lm[0] === RELEARN_MOVE)
              || lm[0] > 0,
          );
      }
      if (this.fusionSpecies && learnSituation !== LearnMoveSituation.EVOLUTION_FUSED_BASE) {
        // For fusion evolutions, get ONLY the moves of the component mon that evolved
        if (simulateEvolutionChain) {
          const fusionEvolutionChain = this.fusionSpecies.getSimulatedEvolutionChain(
            this.level,
            this.hasTrainer(),
            this.isBoss(),
            this.isPlayer(),
          );
          for (let e = 0; e < fusionEvolutionChain.length; e++) {
            // TODO: Might need to pass specific form index in simulated evolution chain
            const speciesLevelMoves = getPokemonSpeciesForm(
              fusionEvolutionChain[e][0],
              this.fusionFormIndex,
            ).getLevelMoves();
            if (includeRelearnerMoves) {
              levelMoves.push(
                ...speciesLevelMoves.filter(
                  lm => (includeEvolutionMoves && lm[0] === EVOLVE_MOVE) || lm[0] !== EVOLVE_MOVE,
                ),
              );
            } else {
              levelMoves.push(
                ...speciesLevelMoves.filter(
                  lm =>
                    (includeEvolutionMoves && lm[0] === EVOLVE_MOVE)
                    || ((!e || lm[0] > 1)
                      && (e === fusionEvolutionChain.length - 1 || lm[0] <= fusionEvolutionChain[e + 1][1])),
                ),
              );
            }
          }
        } else {
          levelMoves.push(
            ...this.getFusionSpeciesForm(true)
              .getLevelMoves()
              .filter(
                lm =>
                  (includeEvolutionMoves && lm[0] === EVOLVE_MOVE)
                  || (includeRelearnerMoves && lm[0] === RELEARN_MOVE)
                  || lm[0] > 0,
              ),
          );
        }
      }
    }
    levelMoves.sort((lma: [number, number], lmb: [number, number]) => (lma[0] > lmb[0] ? 1 : lma[0] < lmb[0] ? -1 : 0));

    /**
     * Filter out moves not within the correct level range(s)
     * Includes moves below startingLevel, or of specifically level 0 if
     * includeRelearnerMoves or includeEvolutionMoves are true respectively
     */
    levelMoves = levelMoves.filter(lm => {
      const level = lm[0];
      const isRelearner = level < startingLevel;
      const allowedEvolutionMove = level === 0 && includeEvolutionMoves;

      return !(level > this.level) && (includeRelearnerMoves || !isRelearner || allowedEvolutionMove);
    });

    /**
     * This must be done AFTER filtering by level, else if the same move shows up
     * in levelMoves multiple times all but the lowest level one will be skipped.
     * This causes problems when there are intentional duplicates (i.e. Smeargle with Sketch)
     */
    if (levelMoves) {
      Pokemon.getUniqueMoves(levelMoves, ret);
    }

    return ret;
  }

  /**
   * Helper function for getLevelMoves
   *
   * @remarks
   * Finds all non-duplicate items from the input, and pushes them into the output.
   * Two items count as duplicate if they have the same Move, regardless of level.
   *
   * @param levelMoves - The input array to search for non-duplicates from
   * @param ret - The output array to be pushed into.
   */
  private static getUniqueMoves(levelMoves: LevelMoves, ret: LevelMoves): void {
    const uniqueMoves: MoveId[] = [];
    for (const lm of levelMoves) {
      if (!uniqueMoves.find(m => m === lm[1])) {
        uniqueMoves.push(lm[1]);
        ret.push(lm);
      }
    }
  }

  /**
   * Get a list of all egg moves
   * @returns list of egg moves
   */
  getEggMoves(): MoveId[] | undefined {
    return speciesEggMoves[this.getSpeciesForm().getRootSpeciesId()];
  }

  /**
   * Create a new {@linkcode PokemonMove} and set it to the specified move index in this Pokémon's moveset.
   * @param moveIndex - The index of the move to set
   * @param moveId - The ID of the move to set
   */
  setMove(moveIndex: number, moveId: MoveId): void {
    if (moveId === MoveId.NONE) {
      return;
    }
    const move = new PokemonMove(moveId);
    this.moveset[moveIndex] = move;
    if (this.summonData.moveset) {
      this.summonData.moveset[moveIndex] = move;
    }
  }

  /**
   * Attempt to set the Pokémon's shininess based on the trainer's trainer ID and secret ID.
   * Endless Pokemon in the end biome are unable to be set to shiny
   *
   * @remarks
   *
   * The exact mechanic is that it calculates E as the XOR of the player's trainer ID and secret ID.
   * F is calculated as the XOR of the first 16 bits of the Pokemon's ID with the last 16 bits.
   * The XOR of E and F are then compared to the {@linkcode shinyThreshold} (or {@linkcode thresholdOverride} if set) to see whether or not to generate a shiny.
   * The base shiny odds are {@linkcode BASE_SHINY_CHANCE} / 65536
   * @param thresholdOverride - number that is divided by 2^16 (65536) to get the shiny chance, overrides {@linkcode shinyThreshold} if set (bypassing shiny rate modifiers such as Shiny Charm)
   * @returns true if the Pokemon has been set as a shiny, false otherwise
   */
  trySetShiny(thresholdOverride?: number): boolean {
    // Shiny Pokemon should not spawn in the end biome in endless
    if (globalScene.gameMode.isEndless && globalScene.arena.biomeId === BiomeId.END) {
      return false;
    }

    const rand1 = (this.id & 0xffff0000) >>> 16;
    const rand2 = this.id & 0x0000ffff;

    const E = globalScene.gameData.trainerId ^ globalScene.gameData.secretId;
    const F = rand1 ^ rand2;

    const shinyThreshold = new NumberHolder(BASE_SHINY_CHANCE);
    if (thresholdOverride === undefined) {
      if (timedEventManager.isEventActive()) {
        const tchance = timedEventManager.getClassicTrainerShinyChance();
        if (this.isEnemy() && this.hasTrainer() && tchance > 0) {
          shinyThreshold.value = Math.max(tchance, shinyThreshold.value); // Choose the higher boost
        } else {
          // Wild shiny event multiplier
          shinyThreshold.value *= timedEventManager.getShinyEncounterMultiplier();
        }
      }
      if (this.isPlayer() || !this.hasTrainer()) {
        // Apply shiny modifiers only to Player or wild mons
        globalScene.applyModifiers(ShinyRateBoosterModifier, true, shinyThreshold);
        // ER: challenge "Favour" raises shiny odds (up to 3x) on a challenge run.
        shinyThreshold.value *= getRunShinyMultiplier();
        // ER (#368/#402): WILD shiny odds scale with run difficulty (Elite 1.5x,
        // Hell 2x) and stack with the boosts above (challenge-capped at 6x).
        if (this.isEnemy() && !this.hasTrainer()) {
          shinyThreshold.value *= getErDifficultyShinyMultiplier();
        }
      }
    } else {
      shinyThreshold.value = thresholdOverride;
    }

    this.shiny = (E ^ F) < shinyThreshold.value;

    if (this.shiny) {
      this.initShinySparkle();
    }

    return this.shiny;
  }

  /**
   * Tries to set a Pokémon's shininess based on seed
   *
   * @remarks
   * For manual use only, usually to roll a Pokemon's shiny chance a second time.
   * If it rolls shiny, or if it's already shiny, also sets a random variant and give the Pokemon the associated luck.
   *
   * The base shiny odds are {@linkcode BASE_SHINY_CHANCE} / `65536`
   * @param thresholdOverride number that is divided by `2^16` (`65536`) to get the shiny chance, overrides {@linkcode shinyThreshold} if set (bypassing shiny rate modifiers such as Shiny Charm)
   * @param applyModifiersToOverride If {@linkcode thresholdOverride} is set and this is true, will apply Shiny Charm and event modifiers to {@linkcode thresholdOverride}
   * @param maxThreshold The maximum threshold allowed after applying modifiers
   * @returns Whether this Pokémon was set to shiny
   */
  public trySetShinySeed(
    thresholdOverride?: number,
    applyModifiersToOverride?: boolean,
    maxThreshold?: number,
  ): boolean {
    if (!this.shiny) {
      const shinyThreshold = new NumberHolder(thresholdOverride ?? BASE_SHINY_CHANCE);
      if (applyModifiersToOverride) {
        if (timedEventManager.isEventActive()) {
          shinyThreshold.value *= timedEventManager.getShinyEncounterMultiplier();
        }
        globalScene.applyModifiers(ShinyRateBoosterModifier, true, shinyThreshold);
      }

      if (maxThreshold && maxThreshold > 0) {
        shinyThreshold.value = Math.min(maxThreshold, shinyThreshold.value);
      }

      this.shiny = randSeedInt(65536) < shinyThreshold.value;
    }

    if (this.shiny) {
      this.variant = this.variant ?? 0;
      this.variant = Math.max(this.generateShinyVariant(), this.variant) as Variant; // Don't set a variant lower than the current one
      // ER Black Shinies (#349): the re-roll can also hit the 1/50 t4 upgrade.
      maybeUpgradeToErBlackShiny(this);
      this.luck = this.variant + 1 + (this.fusionShiny ? this.fusionVariant + 1 : 0);
      this.initShinySparkle();
    }

    return this.shiny;
  }

  /**
   * Randomly generate a shiny variant
   *
   * @remarks
   * Variants are returned with the following probabilities:
   *
   * | Variant | Description    | Probability |
   * |---------|----------------|-------------|
   * | 0       | Basic shiny    | 60%         |
   * | 1       | Rare variant   | 30%         |
   * | 2       | Epic variant   | 10%         |
   *
   * @returns The randomly chosen shiny variant
   */
  protected generateShinyVariant(): Variant {
    const formIndex: number = this.formIndex;
    let variantDataIndex: string | number = this.species.speciesId;
    if (this.species.forms.length > 0) {
      const formKey = this.species.forms[formIndex]?.formKey;
      if (formKey) {
        variantDataIndex = `${variantDataIndex}-${formKey}`;
      }
    }
    // Checks if there is no variant data for both the index or index with form
    if (
      !this.shiny
      || (!Object.hasOwn(variantData, variantDataIndex) && !Object.hasOwn(variantData, this.species.speciesId))
    ) {
      return 0;
    }
    const rand = new NumberHolder(0);
    globalScene.executeWithSeedOffset(
      () => {
        rand.value = randSeedInt(10);
      },
      this.id,
      globalScene.waveSeed,
    );
    if (rand.value >= SHINY_VARIANT_CHANCE) {
      return 0; // 6/10
    }
    if (rand.value >= SHINY_EPIC_CHANCE) {
      return 1; // 3/10
    }
    return 2; // 1/10
  }

  /**
   * Used by Mystery Encounters to override a Pokemon's ability to be its hidden ability
   * @param haThreshold - The denominator for the HA chance (`1 / haThreshold`)
   */
  public tryRerollHiddenAbilitySeed(haThreshold: number): void {
    if (!this.species.abilityHidden) {
      return;
    }

    const hiddenAbilityChance = new ValueHolder(haThreshold);
    globalScene.applyModifiers(HiddenAbilityRateBoosterModifier, true, hiddenAbilityChance);

    if (!randSeedInt(hiddenAbilityChance.value)) {
      this.abilityIndex = 2;
    }
  }

  /**
   * Generate a fusion species and add it to this Pokémon
   * @param forStarter - Whether this fusion is being generated for a starter Pokémon; default `false`
   */
  public generateFusionSpecies(forStarter?: boolean): void {
    const hiddenAbilityChance = new ValueHolder(BASE_HIDDEN_ABILITY_RATE);
    if (!this.hasTrainer()) {
      globalScene.applyModifiers(HiddenAbilityRateBoosterModifier, true, hiddenAbilityChance);
    }

    const hasHiddenAbility = !randSeedInt(hiddenAbilityChance.value);
    const randAbilityIndex = randSeedInt(2);

    const filter = forStarter
      ? (species: PokemonSpecies) => {
          return (
            Object.hasOwn(pokemonEvolutions, species.speciesId)
            && !Object.hasOwn(pokemonPrevolutions, species.speciesId)
            && !species.subLegendary
            && !species.legendary
            && !species.mythical
            && !species.isTrainerForbidden()
            && species.speciesId !== this.species.speciesId
            && species.speciesId !== SpeciesId.DITTO
          );
        }
      : this.species.getCompatibleFusionSpeciesFilter();

    let fusionOverride: PokemonSpecies | undefined;

    if (forStarter && this.isPlayer() && Overrides.STARTER_FUSION_SPECIES_OVERRIDE) {
      fusionOverride = getPokemonSpecies(Overrides.STARTER_FUSION_SPECIES_OVERRIDE);
    } else if (this.isEnemy() && Overrides.ENEMY_FUSION_SPECIES_OVERRIDE) {
      fusionOverride = getPokemonSpecies(Overrides.ENEMY_FUSION_SPECIES_OVERRIDE);
    }

    this.fusionSpecies =
      fusionOverride
      ?? globalScene.randomSpecies(globalScene.currentBattle?.waveIndex || 0, this.level, false, filter, true);
    this.fusionAbilityIndex =
      this.fusionSpecies.abilityHidden && hasHiddenAbility
        ? 2
        : this.fusionSpecies.ability2 === this.fusionSpecies.ability1
          ? 0
          : randAbilityIndex;
    this.fusionShiny = this.shiny;
    this.fusionVariant = this.variant;

    if (this.fusionSpecies.malePercent === null) {
      this.fusionGender = Gender.GENDERLESS;
    } else {
      const genderChance = (this.id % 256) * 0.390625;
      if (genderChance < this.fusionSpecies.malePercent) {
        this.fusionGender = Gender.MALE;
      } else {
        this.fusionGender = Gender.FEMALE;
      }
    }

    this.fusionFormIndex = globalScene.getSpeciesFormIndex(
      this.fusionSpecies,
      this.fusionGender,
      this.getNature(),
      true,
    );
    this.fusionLuck = this.luck;

    this.generateName();
  }

  /** Remove the fusion species from this Pokémon */
  public clearFusionSpecies(): void {
    this.fusionSpecies = null;
    this.fusionFormIndex = 0;
    this.fusionAbilityIndex = 0;
    this.fusionShiny = false;
    this.fusionVariant = 0;
    this.fusionGender = 0;
    this.fusionLuck = 0;
    this.fusionCustomPokemonData = null;

    this.generateName();
    this.calculateStats();
  }

  /**
   * Generate a semi-random moveset for this Pokémon
   *
   * @param useRivalSignatures - (default `false`) Sets moveset gen to use rival signature pool ({@linkcode FORCED_RIVAL_SIGNATURE_MOVES})
   */
  public generateAndPopulateMoveset(useRivalSignatures = false): void {
    generateMoveset(this, useRivalSignatures);

    // Trigger FormChange, except for enemy Pokemon during Mystery Encounters, to avoid crashes
    if (
      this.isPlayer()
      || !globalScene.currentBattle?.isBattleMysteryEncounter()
      || !globalScene.currentBattle?.mysteryEncounter
    ) {
      globalScene.triggerPokemonFormChange(this, SpeciesFormChangeMoveLearnedTrigger);
    }
  }

  /**
   * Attempt to populate this Pokemon's moveset based on those from a Starter
   * @param moveset - The {@linkcode StarterMoveset} to use; will override corresponding slots
   * of this Pokemon's moveset
   * @param ignoreValidate - Whether to ignore validating the passed-in moveset; default `false`
   */
  tryPopulateMoveset(moveset: StarterMoveset, ignoreValidate = false): void {
    // TODO: Why do we need to re-validate starter movesets after picking them?
    if (
      !ignoreValidate
      && !this.getSpeciesForm().validateStarterMoveset(
        moveset,
        globalScene.gameData.starterData[this.species.getRootSpeciesId()].eggMoves,
      )
    ) {
      return;
    }

    moveset.forEach((m, i) => {
      this.moveset[i] = new PokemonMove(m);
    });
  }

  /**
   * Attempt to select the move at the move index.
   * @param moveIndex - The index of the move to select
   * @param ignorePp - Whether to ignore PP when checking if the move is usable (defaults to false)
   * @returns A tuple containing a boolean indicating if the move can be selected, and a string with the reason if it cannot be selected
   */
  public trySelectMove(moveIndex: number, ignorePp?: boolean): [isUsable: boolean, failureMessage: string] {
    const move: PokemonMove | undefined = this.getMoveset()[moveIndex];
    if (!move) {
      // should never happen
      return [false, ""];
    }
    return move.isUsable(this, ignorePp, true);
  }

  /** Show this Pokémon's info panel */
  showInfo(): void {
    if (!this.battleInfo.visible) {
      const otherBattleInfo = globalScene.fieldUI
        .getAll()
        .slice(0, 4)
        .find(ui => ui instanceof BattleInfo && (ui as BattleInfo) instanceof PlayerBattleInfo === this.isPlayer());
      if (!otherBattleInfo || !this.getFieldIndex()) {
        globalScene.fieldUI.sendToBack(this.battleInfo);
        globalScene.sendTextToBack(); // Push the top right text objects behind everything else
      } else {
        globalScene.fieldUI.moveAbove(this.battleInfo, otherBattleInfo);
      }
      // Showdown 1v1 (C5, reworked): the panel slides IN from its on-screen corner;
      // `presentationIsPlayerSide()` maps the flipped guest to that corner (identity off the
      // versus-guest path). The exp-bar mask nudge keys on the PANEL CLASS, not `isPlayer()` -
      // under the flip a player-side mon wears the ENEMY panel (no expMaskRect), and the old
      // isPlayer() guard dereferenced undefined and crashed the guest's summon (staging 2026-07-07).
      this.battleInfo.setX(this.battleInfo.x + (this.presentationIsPlayerSide() ? 150 : this.isBoss() ? -198 : -150));
      this.battleInfo.setVisible(true);
      if (this.battleInfo instanceof PlayerBattleInfo) {
        // TODO: How do you get this to not require a private property access?
        this.battleInfo.expMaskRect.x += 150;
      }
      globalScene.tweens.add({
        targets: [this.battleInfo, this.battleInfo.expMaskRect],
        x: this.presentationIsPlayerSide() ? "-=150" : `+=${this.isBoss() ? 246 : 150}`,
        duration: 1000,
        ease: "Cubic.easeOut",
      });
    }
  }

  /** Hide this Pokémon's info panel */
  async hideInfo(): Promise<void> {
    return new Promise(resolve => {
      if (this.battleInfo?.visible) {
        globalScene.tweens.add({
          targets: [this.battleInfo, this.battleInfo.expMaskRect],
          x: this.presentationIsPlayerSide() ? "+=150" : `-=${this.isBoss() ? 246 : 150}`,
          duration: 500,
          ease: "Cubic.easeIn",
          onComplete: () => {
            // Panel-class keyed, mirroring showInfo (the flip decouples panel chrome from isPlayer()).
            if (this.battleInfo instanceof PlayerBattleInfo) {
              this.battleInfo.expMaskRect.x -= 150;
            }
            this.battleInfo.setVisible(false);
            this.battleInfo.setX(
              this.battleInfo.x - (this.presentationIsPlayerSide() ? 150 : this.isBoss() ? -198 : -150),
            );
            resolve();
          },
        });
      } else {
        resolve();
      }
    });
  }

  updateInfo(instant?: boolean): Promise<void> {
    return this.battleInfo.updateInfo(this, instant);
  }

  toggleStats(visible: boolean): void {
    this.battleInfo.toggleStats(visible);
  }

  /**
   * Adds experience to this PlayerPokemon, subject to wave based level caps.
   * @param exp - The amount of experience to add
   * @param ignoreLevelCap - Whether to ignore level caps when adding experience; default `false`
   */
  addExp(exp: number, ignoreLevelCap = false) {
    const maxExpLevel = globalScene.getMaxExpLevel(ignoreLevelCap);
    const initialExp = this.exp;
    this.exp += exp;
    while (this.level < maxExpLevel && this.exp >= getLevelTotalExp(this.level + 1, this.species.growthRate)) {
      this.level++;
    }
    if (this.level >= maxExpLevel) {
      console.log(initialExp, this.exp, getLevelTotalExp(this.level, this.species.growthRate));
      this.exp = Math.max(getLevelTotalExp(this.level, this.species.growthRate), initialExp);
    }
  }

  /**
   * Check whether the specified Pokémon is an opponent
   * @param target - The {@linkcode Pokemon} to compare against
   * @returns `true` if the two pokemon are opponents, `false` otherwise
   */
  public isOpponent(target: Pokemon): boolean {
    return this.isPlayer() !== target.isPlayer();
  }

  getOpponent(targetIndex: number): Pokemon | null {
    const ret = this.getOpponents()[targetIndex];
    // TODO: why does this check for summonData and can we remove it?
    if (ret.summonData) {
      return ret;
    }
    return null;
  }

  /**
   * Returns the pokemon that oppose this one and are active in non-speed order
   *
   * @param onField - whether to also check if the pokemon is currently on the field (defaults to true)
   */
  getOpponents(onField = true): Pokemon[] {
    return (this.isPlayer() ? globalScene.getEnemyField() : globalScene.getPlayerField()).filter(p =>
      p.isActive(onField),
    );
  }

  /**
   * @returns A generator of pokemon that oppose this one in speed order
   */
  public getOpponentsGenerator(): Generator<Pokemon, number> {
    return inSpeedOrder(this.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER);
  }

  /**
   * Foes this mon can REACH given the format's positional adjacency - the placement-dependent
   * subset of {@linkcode getOpponents}. In a triple a wing reaches only the foe opposite it +
   * the centre; the centre reaches all. Binary battles are unaffected (every pair is mutually
   * adjacent), so this equals {@linkcode getOpponents} there. Use for placement-dependent foe
   * effects (Intimidate, Download, Trace, Cotton Down, ...) so a wing never touches the far foe.
   */
  getAdjacentOpponents(onField = true): Pokemon[] {
    const arrangement = globalScene.currentBattle?.arrangement;
    const opponents = this.getOpponents(onField);
    if (!arrangement) {
      return opponents;
    }
    // effectiveBattlerId: a lone recentered survivor counts as CENTER (see move-utils).
    const selfId = effectiveBattlerId(this);
    return opponents.filter(p => arrangement.isAdjacent(selfId, effectiveBattlerId(p)));
  }

  getOpponentDescriptor(): string {
    return this.isPlayer() ? i18next.t("arenaTag:opposingTeam") : i18next.t("arenaTag:yourTeam");
  }

  /**
   * Every other Pokemon on this one's side, in field-slot order. A single/double battle
   * yields at most one; a triple center has two. Mirrors the legacy {@linkcode getAlly}
   * semantics (the raw slot occupants, NOT active-filtered).
   */
  getAllies(): Pokemon[] {
    const field: Pokemon[] = this.isPlayer() ? globalScene.getPlayerField() : globalScene.getEnemyField();
    return field.filter(p => p != null && p !== this);
  }

  /**
   * Allies this mon is ADJACENT to - the placement-dependent subset of {@linkcode getAllies}.
   * Binary: the single ally, if any. Triple: a wing has one adjacent ally (the centre); the
   * centre has two. Binary is byte-identical to {@linkcode getAllies}. Use for adjacency-limited
   * ally auras (Battery, Power Spot, Steely Spirit, Healer, ...).
   */
  getAdjacentAllies(): Pokemon[] {
    const arrangement = globalScene.currentBattle?.arrangement;
    const allies = this.getAllies();
    if (!arrangement) {
      return allies;
    }
    // effectiveBattlerId: a lone recentered survivor counts as CENTER (see move-utils).
    const selfId = effectiveBattlerId(this);
    return allies.filter(p => arrangement.isAdjacent(selfId, effectiveBattlerId(p)));
  }

  /**
   * The "primary" ally (first by slot order), or `undefined` if alone. Kept for the many
   * single-ally call sites; multi-ally logic (triples) should use {@linkcode getAllies}.
   */
  getAlly(): Pokemon | undefined {
    return this.getAllies()[0];
  }

  /**
   * @returns A generator of Pokémon on the allied field in speed order.
   */
  getAlliesGenerator(): Generator<Pokemon, number> {
    return inSpeedOrder(this.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY);
  }

  /**
   * Calculate the stat stage multiplier of the user against an opponent
   *
   * @remarks
   * This does not apply to evasion or accuracy
   * @see {@linkcode getAccuracyMultiplier}
   * @param stat - The {@linkcode EffectiveStat} to calculate
   * @param opponent - The {@linkcode Pokemon} being targeted
   * @param move - The {@linkcode Move} being used
   * @param ignoreOppAbility - determines whether the effects of the opponent's abilities (i.e. Unaware) should be ignored; default `false`
   * @param isCritical - determines whether a critical hit has occurred or not; default `false`
   * @param simulated - determines whether effects are applied without altering game state; default `true`
   * @param ignoreHeldItems - determines whether this Pokemon's held items should be ignored during the stat calculation; default `false`
   * @returns the stat stage multiplier to be used for effective stat calculation
   */
  getStatStageMultiplier(
    stat: EffectiveStat,
    opponent?: Pokemon,
    move?: Move,
    ignoreOppAbility = false,
    isCritical = false,
    simulated = true,
    ignoreHeldItems = false,
  ): number {
    const statStage = new NumberHolder(this.getStatStage(stat));
    const ignoreStatStage = new BooleanHolder(false);

    // ER BLEED negates the effects of the bearer's stat stages (offensive and
    // defensive) while preserving the stored stages for when it is cured.
    if (this.getTag(BattlerTagType.ER_BLEED)) {
      statStage.value = 0;
    }

    if (opponent) {
      if (isCritical) {
        switch (stat) {
          case Stat.ATK:
          case Stat.SPATK:
            statStage.value = Math.max(statStage.value, 0);
            break;
          case Stat.DEF:
          case Stat.SPDEF:
            statStage.value = Math.min(statStage.value, 0);
            break;
        }
      }
      if (!ignoreOppAbility) {
        applyAbAttrs("IgnoreOpponentStatStagesAbAttr", {
          pokemon: opponent,
          ignored: ignoreStatStage,
          stat,
          simulated,
          opponent: this,
        });
      }
      if (move) {
        applyMoveAttrs("IgnoreOpponentStatStagesAttr", this, opponent, move, ignoreStatStage);
      }
    }

    if (!ignoreStatStage.value) {
      const statStageMultiplier = new NumberHolder(Math.max(2, 2 + statStage.value) / Math.max(2, 2 - statStage.value));
      if (!ignoreHeldItems) {
        globalScene.applyModifiers(TempStatStageBoosterModifier, this.isPlayer(), stat, statStageMultiplier);
      }
      return Math.min(statStageMultiplier.value, 4);
    }
    return 1;
  }

  /**
   * Calculates the accuracy multiplier of the user against a target.
   *
   * This method considers various factors such as the user's accuracy level, the target's evasion level,
   * abilities, and modifiers to compute the final accuracy multiplier.
   *
   * @param target - The target Pokémon against which the move is used.
   * @param sourceMove - The move being used by the user.
   * @returns The calculated accuracy multiplier.
   */
  getAccuracyMultiplier(target: Pokemon, sourceMove: Move): number {
    const isOhko = sourceMove.hasAttr("OneHitKOAccuracyAttr");
    if (isOhko) {
      return 1;
    }

    const userAccStage = new NumberHolder(this.getStatStage(Stat.ACC));
    const targetEvaStage = new NumberHolder(target.getStatStage(Stat.EVA));

    const ignoreAccStatStage = new BooleanHolder(false);
    const ignoreEvaStatStage = new BooleanHolder(false);

    // TODO: consider refactoring this method to accept `simulated` and then pass simulated to these applyAbAttrs
    applyAbAttrs("IgnoreOpponentStatStagesAbAttr", {
      pokemon: target,
      stat: Stat.ACC,
      ignored: ignoreAccStatStage,
      opponent: this,
    });
    applyAbAttrs("IgnoreOpponentStatStagesAbAttr", {
      pokemon: this,
      stat: Stat.EVA,
      ignored: ignoreEvaStatStage,
      opponent: target,
    });
    applyMoveAttrs("IgnoreOpponentStatStagesAttr", this, target, sourceMove, ignoreEvaStatStage);

    globalScene.applyModifiers(TempStatStageBoosterModifier, this.isPlayer(), Stat.ACC, userAccStage);

    userAccStage.value = ignoreAccStatStage.value ? 0 : Math.min(userAccStage.value, 6);
    targetEvaStage.value = ignoreEvaStatStage.value ? 0 : targetEvaStage.value;

    if (target.findTag(t => t instanceof ExposedTag)) {
      targetEvaStage.value = Math.min(0, targetEvaStage.value);
    }

    const accuracyMultiplier = new NumberHolder(1);
    if (userAccStage.value !== targetEvaStage.value) {
      accuracyMultiplier.value =
        userAccStage.value > targetEvaStage.value
          ? (3 + Math.min(userAccStage.value - targetEvaStage.value, 6)) / 3
          : 3 / (3 + Math.min(targetEvaStage.value - userAccStage.value, 6));
    }

    applyAbAttrs("StatMultiplierAbAttr", {
      pokemon: this,
      stat: Stat.ACC,
      statVal: accuracyMultiplier,
      move: sourceMove,
    });

    const evasionMultiplier = new NumberHolder(1);
    applyAbAttrs("StatMultiplierAbAttr", {
      pokemon: target,
      stat: Stat.EVA,
      statVal: evasionMultiplier,
      move: sourceMove,
    });

    // Elite Redux (#394): ER Smokescreen blankets the target's whole side in smoke,
    // granting +25% evasiveness for 5 turns. Boost the target's evasion multiplier
    // while its side holds the tag (the final return is accuracy / evasion).
    const smokeSide = target.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    if (globalScene.arena.getTagOnSide(ArenaTagType.ER_SMOKESCREEN, smokeSide)) {
      evasionMultiplier.value *= 1.25;
    }

    const ally = this.getAlly();
    if (ally != null) {
      const ignore =
        this.hasAbilityWithAttr("MoveAbilityBypassAbAttr") || sourceMove.hasFlag(MoveFlags.IGNORE_ABILITIES);
      applyAbAttrs("AllyStatMultiplierAbAttr", {
        pokemon: ally,
        stat: Stat.ACC,
        statVal: accuracyMultiplier,
        ignoreAbility: ignore,
        move: sourceMove,
      });

      applyAbAttrs("AllyStatMultiplierAbAttr", {
        pokemon: ally,
        stat: Stat.EVA,
        statVal: evasionMultiplier,
        ignoreAbility: ignore,
        move: sourceMove,
      });
    }

    // ER Zoom Lens (held by the attacker): +20% accuracy when the target has
    // already acted this turn.
    return (accuracyMultiplier.value / evasionMultiplier.value) * erTacticalZoomLensMultiplier(this, target);
  }

  /**
   * Calculates the base damage of the given move against this Pokemon when attacked by the given source.
   * Used during damage calculation and for Shell Side Arm's forecasting effect.
   * @param __namedParameters.source - Needed for proper typedoc rendering
   * @returns The move's base damage against this Pokemon when used by the source Pokemon.
   */
  getBaseDamage({
    source,
    move,
    moveCategory,
    ignoreAbility = false,
    ignoreSourceAbility = false,
    ignoreAllyAbility = false,
    ignoreSourceAllyAbility = false,
    isCritical = false,
    simulated = true,
  }: GetBaseDamageParams): number {
    const isPhysical = moveCategory === MoveCategory.PHYSICAL;

    /** A base damage multiplier based on the source's level */
    const levelMultiplier = (2 * source.level) / 5 + 2;

    /** The power of the move after power boosts from abilities, etc. have applied */
    const power = move.calculateBattlePower(source, this, simulated, ignoreSourceAbility);

    /**
     * The attacker's offensive stat for the given move's category.
     * Critical hits cause negative stat stages to be ignored.
     */
    const sourceAtk = new NumberHolder(
      source.getEffectiveStat(
        isPhysical ? Stat.ATK : Stat.SPATK,
        this,
        undefined,
        ignoreSourceAbility,
        ignoreAbility,
        ignoreAllyAbility,
        isCritical,
        simulated,
      ),
    );
    applyMoveAttrs("VariableAtkAttr", source, this, move, sourceAtk);

    // ER attack-stat substitution abilities (Ancient Idol: use Def/SpDef;
    // Momentum: use Speed on contact). Scanned by name — registration-free,
    // same pattern as OffensiveTypeChartOverrideAbAttr.
    if (!ignoreSourceAbility) {
      const subAttrs = source.getAllActiveAbilityAttrs();
      for (const attr of subAttrs) {
        if (attr?.constructor?.name === "AttackStatSubstituteAbAttr") {
          const sub = (
            attr as unknown as { resolveStat: (m: Move, p: boolean, s: Pokemon) => EffectiveStat | null }
          ).resolveStat(move, isPhysical, source);
          if (sub != null) {
            sourceAtk.value = source.getEffectiveStat(
              sub,
              this,
              undefined,
              ignoreSourceAbility,
              ignoreAbility,
              ignoreAllyAbility,
              isCritical,
              simulated,
            );
          }
        }
        // ER Relativity (5911): when the holder acted BEFORE this target this
        // turn, its damaging moves use its CURRENT Speed in place of Atk/SpAtk.
        // Order-based (Trick-Room-safe) — resolved inside `resolveOffenseStat`.
        if (attr?.constructor?.name === "RelativityAbAttr") {
          const sub = (
            attr as unknown as { resolveOffenseStat: (s: Pokemon, t: Pokemon) => EffectiveStat | null }
          ).resolveOffenseStat(source, this);
          if (sub != null) {
            sourceAtk.value = source.getEffectiveStat(
              sub,
              this,
              undefined,
              ignoreSourceAbility,
              ignoreAbility,
              ignoreAllyAbility,
              isCritical,
              simulated,
            );
          }
        }
      }
    }

    /**
     * This Pokemon's defensive stat for the given move's category.
     * Critical hits cause positive stat stages to be ignored.
     *
     * Elite Redux: `DefensiveStatSubstituteAbAttr` (Tangled Feet) may swap which
     * stat the formula reads here (e.g. Speed in place of Def/SpDef when confused
     * or enraged); the attr is gated, so this is a no-op for every other ability.
     */
    const defensiveStatHolder = new NumberHolder<EffectiveStat>(isPhysical ? Stat.DEF : Stat.SPDEF);
    if (!ignoreAbility) {
      applyAbAttrs("DefensiveStatSubstituteAbAttr", {
        pokemon: this,
        simulated,
        statHolder: defensiveStatHolder,
      });
    }
    // Elite Redux: on a critical hit, an attacker ability may retarget the
    // defender's WEAKER defensive stat (Deadeye 376). Source-side, crit-only.
    if (isCritical && !ignoreSourceAbility) {
      applyAbAttrs("CritUseLowerDefensiveStatAbAttr", {
        pokemon: source,
        simulated,
        defender: this,
        statHolder: defensiveStatHolder,
      });
    }
    // Elite Redux: Exploit Weakness (284) retargets the defender's WEAKER
    // defensive stat when the defender is statused. Source-side; gated on the
    // cheap status check so the hot path only fires the dispatch vs statused foes.
    if (this.status != null && this.status.effect !== StatusEffect.NONE && !ignoreSourceAbility) {
      applyAbAttrs("LowerDefensiveStatVsStatusedFoeAbAttr", {
        pokemon: source,
        simulated,
        defender: this,
        statHolder: defensiveStatHolder,
      });
    }
    const targetDef = new NumberHolder(
      this.getEffectiveStat(
        defensiveStatHolder.value,
        source,
        move,
        ignoreAbility,
        ignoreSourceAbility,
        ignoreSourceAllyAbility,
        isCritical,
        simulated,
      ),
    );
    applyMoveAttrs("VariableDefAttr", source, this, move, targetDef);

    /**
     * The attack's base damage, as determined by the source's level, move power
     * and Attack stat as well as this Pokemon's Defense stat
     */
    const baseDamage = (levelMultiplier * power * sourceAtk.value) / targetDef.value / 50 + 2;

    /** Debug message for non-simulated calls (i.e. when damage is actually dealt) */
    if (!simulated) {
      console.log(
        `Move: ${move.name} | Base damage: ${baseDamage} | Power: ${power} | Source attack: ${sourceAtk.value} | Target defense: ${targetDef.value}`,
      );
    }

    return baseDamage;
  }

  /** Determine the STAB multiplier for a move used against this pokemon.
   *
   * @param source - The attacking {@linkcode Pokemon}
   * @param move - The {@linkcode Move} used in the attack
   * @param ignoreSourceAbility - If `true`, ignores the attacking Pokemon's ability effects
   * @param simulated - If `true`, suppresses changes to game state during the calculation
   *
   * @returns The STAB multiplier for the move used against this Pokemon
   */
  // TODO: This uses nothing from this Pokemon AT ALL, so why is this called on the defender?
  public calculateStabMultiplier(
    source: Pokemon,
    move: Move,
    ignoreSourceAbility: boolean,
    simulated: boolean,
  ): number {
    // Struggle cannot benefit from any STAB multipliers, even if the user is typeless
    if (move.hasAttr("TypelessAttr")) {
      return 1;
    }

    // ER Relic Stone (866): while a Relic Stone holder OTHER than the attacker is
    // on the field, no other battler benefits from STAB — neither the base 1.5
    // typing STAB nor any ability-granted STAB (Adaptability/StabBoostAbAttr) nor
    // the Tera boost. The holder itself keeps its STAB (p !== source).
    const relicStoneSuppressed = globalScene
      .getField()
      .some(
        p =>
          p != null && p !== source && !p.isFainted() && p.hasAbility(ErAbilityId.RELIC_STONE as unknown as AbilityId),
      );
    if (relicStoneSuppressed) {
      return 1;
    }

    const sourceTypes = source.getTypes(false, false);
    const sourceTeraType = source.getTeraType();
    const moveType = source.getMoveType(move);
    const matchesSourceType = sourceTypes.includes(source.getMoveType(move));

    const stabMultiplier = new NumberHolder(1);

    if (matchesSourceType && moveType !== PokemonType.STELLAR) {
      stabMultiplier.value += 0.5;
    }

    // ER dual-type move primitive (Batch 3): a dual-type move (Closed Circuit's
    // follow-up, or a Negative Feedback prime) grants STAB if the user shares
    // EITHER type — this adds the +0.5 for the SECOND type when the user has it
    // and it isn't already the (post-conversion) move type.
    stabMultiplier.value += dualTypeStabBonus(source, move, moveType);

    applyMoveAttrs("CombinedPledgeStabBoostAttr", source, this, move, stabMultiplier);

    if (!ignoreSourceAbility) {
      applyAbAttrs("StabBoostAbAttr", { pokemon: source, simulated, multiplier: stabMultiplier });
    }

    if (source.isTerastallized) {
      stabMultiplier.value += source.getTeraTypeBoost(sourceTeraType, moveType, matchesSourceType);
    }

    return Math.min(stabMultiplier.value, 2.25);
  }

  /**
   * Helper function to {@linkcode calculateStabMultiplier} that handles computing boosts from a Pokemon being Terastallized.
   * @param teraType - This Pokemon's Tera Type
   * @param moveType - The type of the `Move` being used
   * @param matchesSourceType - Whether the move type matches this Pokemon's base type
   * @returns The additional STAB bonus this Pokemon receives from terastallization.
   * @remarks
   * Unlike most other functions used during damage calculation, this is computed from the perspective of the _attacker_
   * (given it functions entirely independently of the defender's stats, abilities, etc.).
   */
  private getTeraTypeBoost(teraType: PokemonType, moveType: PokemonType, matchesSourceType: boolean): number {
    // Non-stellar Teras give a 50% boost to their type exclusively
    if (teraType !== PokemonType.STELLAR) {
      return teraType === moveType ? 0.5 : 0;
    }

    // TODO: Instead of ignoring terapagos' tera stellar boosts when calling this,
    // we should avoid pushing its usages to the array altogether to reduce save data size
    const canBoostStellar = !this.stellarTypesBoosted.includes(moveType) || this.hasSpecies(SpeciesId.TERAPAGOS);
    if (!canBoostStellar) {
      return 0;
    }
    // Stellar gives 50% to original types and 20% to others, but once per move type
    return matchesSourceType ? 0.5 : 0.2;
  }

  /**
   * Calculates the damage of an attack made by another Pokemon against this Pokemon
   * @param __namedParameters.source - Needed for proper typedoc rendering
   * @returns The {@linkcode DamageCalculationResult}
   */
  // TODO: Condense various multipliers into a separate function for easier unit testing
  getAttackDamage({
    source,
    move,
    ignoreAbility = false,
    ignoreSourceAbility = false,
    ignoreAllyAbility = false,
    ignoreSourceAllyAbility = false,
    isCritical = false,
    simulated = true,
    effectiveness,
    forcedRandomMultiplier,
    skipOpponentDamageBoostSuppression = false,
  }: GetAttackDamageParams): DamageCalculationResult {
    const damage = new NumberHolder(0);
    const defendingSide = this.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;

    const variableCategory = new NumberHolder(move.category);
    applyMoveAttrs("VariableMoveCategoryAttr", source, this, move, variableCategory);
    // ER ability-side category override (Mystic Blades: slicing moves become
    // SPECIAL). Scanned by name — registration-free, same pattern as the
    // AttackStatSubstituteAbAttr scan in getBaseDamage. Flipping the category
    // here makes the move fully special downstream (Sp.Atk offense, Sp.Def
    // defense, no burn halving, Light-Screen-blocked).
    if (!ignoreSourceAbility) {
      for (const attr of source.getAllActiveAbilityAttrs()) {
        if (attr?.constructor?.name === "MoveCategoryOverrideAbAttr") {
          const overridden = (attr as unknown as { resolveCategory: (m: Move) => MoveCategory | null }).resolveCategory(
            move,
          );
          if (overridden != null) {
            variableCategory.value = overridden;
          }
        }
        // ER Crosscut (5908): the SECOND strike of a doubled slicing/pulse move
        // flips to the opposite category (each strike keyed on the strike index).
        if (attr?.constructor?.name === "CrosscutSecondStrikeAbAttr") {
          const flipped = (
            attr as unknown as { resolveSecondStrikeCategory: (m: Move, s: Pokemon, t: Pokemon) => MoveCategory | null }
          ).resolveSecondStrikeCategory(move, source, this);
          if (flipped != null) {
            variableCategory.value = flipped;
          }
        }
      }
      // ER Library (5928): a cast recorded move is computed as SPECIAL (holder's
      // Sp.Atk vs the target's Sp.Def) regardless of its native category.
      if (erLibraryCastIsSpecial(source, move)) {
        variableCategory.value = MoveCategory.SPECIAL;
      }
    }
    const moveCategory = variableCategory.value as MoveCategory;

    /** The move's type after type-changing effects are applied */
    const moveType = source.getMoveType(move);

    /** If `value` is `true`, cancels the move and suppresses "No Effect" messages */
    const cancelled = new BooleanHolder(false);

    /**
     * The effectiveness of the move being used. Along with type matchups, this
     * accounts for changes in effectiveness from the move's attributes and the
     * abilities of both the source and this Pokemon.
     *
     */
    const typeMultiplier =
      effectiveness
      ?? this.getMoveEffectiveness(source, move, ignoreAbility, simulated, cancelled, false, ignoreSourceAbility);

    const isPhysical = moveCategory === MoveCategory.PHYSICAL;

    /** Combined damage multiplier from field effects such as weather, terrain, etc. */
    const arenaAttackTypeMultiplier = new NumberHolder(
      globalScene.arena.getAttackTypeMultiplier(moveType, source.isGrounded()),
    );
    applyMoveAttrs("IgnoreWeatherTypeDebuffAttr", source, this, move, arenaAttackTypeMultiplier);
    // ER Utility Umbrella (held by the attacker): the holder ignores the sun's /
    // rain's boost and penalty on its OWN moves (divide the weather component out).
    erTacticalUtilityUmbrella(source, moveType, arenaAttackTypeMultiplier);
    // Ability-side analogue (ER Catastrophe): let the attacker's ability cancel an
    // adverse weather type debuff for the resolved move type, matching Hydro Steam.
    if (!ignoreSourceAbility) {
      applyAbAttrs("IgnoreWeatherTypeDebuffAbAttr", {
        pokemon: source,
        simulated,
        move,
        arenaTypeMultiplier: arenaAttackTypeMultiplier,
      });
    }

    // ER Eerie Fog: Ghost- and Psychic-type defenders take 20% less move damage.
    const erFog = globalScene.arena.weather;
    if (
      isFogWeather(erFog?.weatherType)
      && !erFog?.isEffectSuppressed()
      && (this.isOfType(PokemonType.GHOST) || this.isOfType(PokemonType.PSYCHIC))
    ) {
      arenaAttackTypeMultiplier.value *= 0.8;
    }

    const isTypeImmune = typeMultiplier * arenaAttackTypeMultiplier.value === 0;

    if (cancelled.value || isTypeImmune) {
      return {
        cancelled: cancelled.value,
        result: move.id === MoveId.SHEER_COLD ? HitResult.IMMUNE : HitResult.NO_EFFECT,
        damage: 0,
      };
    }

    // If the attack deals fixed damage, return a result with that much damage
    const fixedDamage = new NumberHolder(0);
    applyMoveAttrs("FixedDamageAttr", source, this, move, fixedDamage);
    if (fixedDamage.value) {
      const multiLensMultiplier = new NumberHolder(1);
      globalScene.applyModifiers(
        PokemonMultiHitModifier,
        source.isPlayer(),
        source,
        move.id,
        null,
        multiLensMultiplier,
      );
      fixedDamage.value = toDmgValue(fixedDamage.value * multiLensMultiplier.value);

      return {
        cancelled: false,
        result: HitResult.EFFECTIVE,
        damage: fixedDamage.value,
      };
    }

    // If the attack is a one-hit KO move, return a result with damage equal to this Pokemon's HP
    const isOneHitKo = new BooleanHolder(false);
    applyMoveAttrs("OneHitKOAttr", source, this, move, isOneHitKo);
    if (isOneHitKo.value) {
      return {
        cancelled: false,
        result: HitResult.ONE_HIT_KO,
        damage: this.hp,
      };
    }

    /**
     * The attack's base damage, as determined by the source's level, move power
     * and Attack stat as well as this Pokemon's Defense stat
     */
    const baseDamage = this.getBaseDamage({
      source,
      move,
      moveCategory,
      ignoreAbility,
      ignoreSourceAbility,
      ignoreAllyAbility,
      ignoreSourceAllyAbility,
      isCritical,
      simulated,
    });

    /** 25% damage debuff on moves hitting more than one non-fainted target (regardless of immunities) */
    const { targets, multiple } = getMoveTargets(source, move.id);
    const numTargets = multiple ? targets.length : 1;
    const targetMultiplier = numTargets > 1 ? 0.75 : 1;

    /** Multiplier for moves enhanced by Multi-Lens and/or Parental Bond */
    const multiStrikeEnhancementMultiplier = new NumberHolder(1);
    globalScene.applyModifiers(
      PokemonMultiHitModifier,
      source.isPlayer(),
      source,
      move.id,
      null,
      multiStrikeEnhancementMultiplier,
    );

    // ER Multi-Headed: the extra "head" strikes deal reduced damage — for a
    // 2-headed mon the 2nd hit is 25%; for a 3-headed mon the 2nd is 20% and the
    // 3rd is 15% (the 1st head always hits at full power). The strikes themselves
    // are added by the ability's AddSecondStrikeAbAttr wiring; this only scales
    // their damage. Pokerogue's AddSecondStrike (Parental Bond) otherwise deals
    // full damage on every strike, so without this Multi-Headed hit 2-3× at 100%.
    // Scoped to Multi-Headed holders only — Multi-Lens, Parental Bond and ordinary
    // multi-hit moves are untouched.
    if (source.hasAbility(ErAbilityId.MULTI_HEADED as unknown as AbilityId)) {
      const strikeIndex = source.turnData.hitCount - source.turnData.hitsLeft; // 0-based
      if (strikeIndex > 0) {
        multiStrikeEnhancementMultiplier.value *= source.turnData.hitCount <= 2 ? 0.25 : strikeIndex === 1 ? 0.2 : 0.15;
      }
    }

    // ER Minion Control (#399): "+1 hit per healthy party member" was hitting
    // up to 6x at FULL power (big community report). Per the v2.65.3b ROM long
    // description: "The first hit deals full damage while each additional hit
    // deals 10% damage." (full 6 hits = 150% total).
    if (source.hasAbility(ErAbilityId.MINION_CONTROL as unknown as AbilityId)) {
      const strikeIndex = source.turnData.hitCount - source.turnData.hitsLeft; // 0-based
      if (strikeIndex > 0) {
        multiStrikeEnhancementMultiplier.value *= 0.1;
      }
    }

    /** Doubles damage if this Pokemon's last move was Glaive Rush */
    const glaiveRushMultiplier = new NumberHolder(1);
    if (this.getTag(BattlerTagType.RECEIVE_DOUBLE_DAMAGE)) {
      glaiveRushMultiplier.value = 2;
    }

    /** The damage multiplier when the given move critically hits */
    const criticalMultiplier = new NumberHolder(isCritical ? 1.5 : 1);
    if (!ignoreSourceAbility) {
      applyAbAttrs("MultCritAbAttr", { pokemon: source, simulated, critMult: criticalMultiplier });
    }

    /**
     * A multiplier for random damage spread in the range [0.85, 1]
     * This is always 1 for simulated calls.
     */
    const randomMultiplierHolder = new NumberHolder(
      forcedRandomMultiplier ?? (simulated ? 1 : this.randBattleSeedIntRange(85, 100) / 100),
    );
    // Elite Redux: abilities like Bad Luck / Bad Omen force attacks against the
    // holder (`this` = the defender) to roll minimum damage. No-op for every
    // ability lacking EnemyMinDamageRollAbAttr.
    if (!simulated) {
      applyAbAttrs("EnemyMinDamageRollAbAttr", {
        pokemon: this,
        simulated,
        rollMultiplier: randomMultiplierHolder,
      });
    }
    const randomMultiplier = randomMultiplierHolder.value;

    /** A damage multiplier for when the attack is of the attacker's type and/or Tera type. */
    const stabMultiplier = this.calculateStabMultiplier(source, move, ignoreSourceAbility, simulated);

    /** Halves damage if the attacker is using a physical attack while burned */
    let burnMultiplier = 1;
    if (
      isPhysical
      && source.status
      && source.status.effect === StatusEffect.BURN
      && !move.hasAttr("BypassBurnDamageReductionAttr")
    ) {
      const burnDamageReductionCancelled = new BooleanHolder(false);
      if (!ignoreSourceAbility) {
        applyAbAttrs("BypassBurnDamageReductionAbAttr", {
          pokemon: source,
          cancelled: burnDamageReductionCancelled,
          simulated,
        });
      }
      if (!burnDamageReductionCancelled.value) {
        burnMultiplier = 0.5;
      }
    }

    /**
     * Halves damage if the attacker is using a special attack while
     * frostbitten (ER status — see {@linkcode BattlerTagType.ER_FROSTBITE}).
     * Mirrors the BURN halving above but on the special side, matching the
     * Gen 9 mainline FROSTBITE mechanic Elite Redux ports. The check uses the
     * battler-tag presence rather than a dedicated `StatusEffect` because ER's
     * FROSTBITE is modeled as a battler tag rather than a primary status (so
     * we don't have to mutate pokerogue's `StatusEffect` enum). The BURN
     * `Bypass` ability hook IS now mirrored: Rage Point (703) "negates burn's
     * Attack drop and freeze's Special Attack drop" — it carries
     * `BypassBurnDamageReductionAbAttr`, which we consult here too so the same
     * ability waives both halvings. (Round 7 of the ER bespoke ability grind;
     * frostbite bypass added in the 695–714 audit follow-up.)
     */
    let frostbiteMultiplier = 1;
    if (!isPhysical && source.getTag(BattlerTagType.ER_FROSTBITE)) {
      const frostbiteReductionCancelled = new BooleanHolder(false);
      if (!ignoreSourceAbility) {
        applyAbAttrs("BypassBurnDamageReductionAbAttr", {
          pokemon: source,
          cancelled: frostbiteReductionCancelled,
          simulated,
        });
      }
      if (!frostbiteReductionCancelled.value) {
        frostbiteMultiplier = 0.5;
      }
    }

    /** ER FEAR: the feared target takes 50% more damage (ROM). */
    const fearMultiplier = this.getTag(BattlerTagType.ER_FEAR) ? 1.5 : 1;

    /** ER Safe Passage (979): the guided switch-in takes -35% damage this turn. */
    const safePassageMultiplier = this.getTag(BattlerTagType.ER_SAFE_PASSAGE) ? 0.65 : 1;

    /** Reduces damage if this Pokemon has a relevant screen (e.g. Light Screen for special attacks) */
    const screenMultiplier = new NumberHolder(1);

    // Critical hits should bypass screens
    if (!isCritical) {
      globalScene.arena.applyTagsForSide(WeakenMoveScreenTag, defendingSide, source, moveCategory, screenMultiplier);
    }

    /**
     * For each {@linkcode HitsTagAttr} the move has, doubles the damage of the move if:
     * The target has a {@linkcode BattlerTagType} that this move interacts with
     * AND
     * The move doubles damage when used against that tag
     */
    const hitsTagMultiplier = new NumberHolder(1);
    move
      .getAttrs("HitsTagAttr")
      .filter(hta => hta.doubleDamage)
      .forEach(hta => {
        if (this.getTag(hta.tagType)) {
          hitsTagMultiplier.value *= 2;
        }
      });

    /** Halves damage if this Pokemon is grounded in Misty Terrain against a Dragon-type attack */
    const mistyTerrainMultiplier =
      globalScene.arena.terrain?.terrainType === TerrainType.MISTY
      && this.isGrounded()
      && moveType === PokemonType.DRAGON
        ? 0.5
        : 1;

    /**
     * ER relics (#439): team-wide damage buffs that apply only to PLAYER
     * attackers. Morale Banner = +15% while the team is faint-free this biome;
     * Twin Link = +15% for moves of the type shared by party slots 2 and 3;
     * Blood Pact = +20% on ALL of the team's hits. All return 1 when their relic
     * isn't held or the condition isn't met.
     */
    const erRelicMultiplier = source.isPlayer()
      ? erMoraleBannerMultiplier()
        * erTwinLinkMultiplier(moveType)
        * erMoltenCoreFireMultiplier(moveType)
        * erCapacitorElectricMultiplier(moveType)
        * erBloodPactDealMultiplier()
      : 1;

    /**
     * ER relics (#439): Blood Pact's double edge - while held, the player's mons
     * (the DEFENDER `this` here) take +15% damage. 1 for enemy defenders / when the
     * relic isn't held. Multiplies with the offensive bonus only on the rare
     * player-vs-player hit.
     */
    const erRelicDefenderMultiplier = this.isPlayer() ? erBloodPactTakeMultiplier() : 1;

    /**
     * ER Library (5928): a repeated use of a move recorded in a Library holder's
     * library deals 15% less damage to that holder's whole side. 1 when the move
     * is not a repeat of a recorded move on the defender's side.
     */
    const erLibraryMultiplier = erLibraryDamageMultiplier(this, move);

    damage.value = toDmgValue(
      baseDamage
        * targetMultiplier
        * multiStrikeEnhancementMultiplier.value
        * arenaAttackTypeMultiplier.value
        * glaiveRushMultiplier.value
        * criticalMultiplier.value
        * randomMultiplier
        * stabMultiplier
        * typeMultiplier
        * burnMultiplier
        * frostbiteMultiplier
        * fearMultiplier
        * safePassageMultiplier
        * screenMultiplier.value
        * hitsTagMultiplier.value
        * mistyTerrainMultiplier
        * erRelicMultiplier
        * erRelicDefenderMultiplier
        * erLibraryMultiplier,
    );

    // ER Overrule 815: on a CRITICAL hit, the holder's attacks deal double damage
    // if they are resisted (negating the not-very-effective penalty). No-op for
    // every Pokémon lacking the OverruleCritAbAttr marker.
    if (isCritical && !ignoreSourceAbility && typeMultiplier < 1 && source.hasAbilityWithAttr("OverruleCritAbAttr")) {
      damage.value = toDmgValue(damage.value * 2);
    }

    if (!ignoreSourceAbility) {
      applyAbAttrs("MoveDamageBoostAbAttr", {
        pokemon: source,
        opponent: this,
        move,
        simulated,
        damage,
      });
    }

    const opponentDamageBoostSuppressionCeiling =
      !skipOpponentDamageBoostSuppression
      && !ignoreAbility
      && !ignoreSourceAbility
      && suppressesOpponentDamageBoosts(this)
        ? this.getAttackDamage({
            source,
            move,
            ignoreAbility,
            ignoreSourceAbility: true,
            ignoreAllyAbility: true,
            ignoreSourceAllyAbility: true,
            isCritical,
            simulated: true,
            forcedRandomMultiplier: randomMultiplierHolder.value,
            skipOpponentDamageBoostSuppression: true,
          }).damage
        : null;

    /** Apply the enemy's Damage and Resistance tokens */
    if (!source.isPlayer()) {
      globalScene.applyModifiers(EnemyDamageBoosterModifier, false, damage);
    }
    if (!this.isPlayer()) {
      globalScene.applyModifiers(EnemyDamageReducerModifier, false, damage);
    }

    // ER Omni Gem (#387): once per battle, the attacker's first damaging move
    // deals double damage. Consumed only on real (non-simulated) calcs.
    erTryApplyOmniGem(source, damage, simulated);

    // ER elemental Gems: 1.3x to the attacker's first move of the matching type,
    // then the gem shatters (consumed only on real calcs).
    erTryApplyGem(source, moveType, damage, simulated);

    // ER Expert Belt (held by the attacker): x1.2 on super-effective hits
    // (effectiveness >= 2, per ER battle_util.c). Passive - never consumed -
    // so it applies to simulated calcs too, like the recreated Life Orb below.
    erTryApplyExpertBelt(source, typeMultiplier, damage);

    // ER tactical boosters (held by the attacker): Punching Glove (+10% punching),
    // Muscle Band (+10% physical), Wise Glasses (+10% special), Metronome
    // (+20%/consecutive same-move use). All passive - apply on simulated calcs.
    erApplyTacticalDamage(source, move, moveCategory, damage);

    // ER resistance berries (#357): if the DEFENDER holds the berry matching
    // this hit's type, halve the damage BEFORE it lands and consume the berry
    // (super-effective hits only; Chilan works on any Normal hit).
    applyErResistBerry(this, moveType, typeMultiplier, damage, simulated);

    // ER recreated Life Orb (held by the attacker): ×1.3 outgoing damage. The
    // matching ~1/10 max-HP recoil is applied in the move-effect phase. Scanned
    // by class name to avoid a load-order import cycle (modifier ↔ pokemon).
    if (
      globalScene.findModifier(
        m => m.constructor?.name === "ErLifeOrbModifier" && (m as { pokemonId?: number }).pokemonId === source.id,
        source.isPlayer(),
      )
    ) {
      damage.value = toDmgValue(damage.value * 1.3);
    }

    const abAttrParams: PreAttackModifyDamageAbAttrParams = {
      pokemon: this,
      opponent: source,
      move,
      simulated,
      damage,
    };
    // ER Overrule 815: on a CRITICAL hit, the holder's attacks ignore the
    // defender's damage-reducing abilities (Multiscale, Filter, Fur Coat, …).
    // No-op for every attacker lacking the OverruleCritAbAttr marker.
    const overruleIgnoresDefAbilities =
      isCritical && !ignoreSourceAbility && source.hasAbilityWithAttr("OverruleCritAbAttr");
    // Apply this Pokemon's post-calc defensive modifiers (e.g. Fur Coat)
    if (!ignoreAbility && !overruleIgnoresDefAbilities) {
      applyAbAttrs("ReceivedMoveDamageMultiplierAbAttr", abAttrParams);

      // Friend Guard: EVERY active ally that has it reduces the damage (all allies, not just the
      // first - a triple centre has two). Multi-battle only; a single has no ally. `getBattlerCount()
      // > 1` is byte-identical to the old `double` gate for singles/doubles and enables triples.
      if (globalScene.currentBattle.getBattlerCount() > 1) {
        for (const ally of this.getAllies()) {
          if (ally.isActive(true)) {
            applyAbAttrs("AlliedFieldDamageReductionAbAttr", { ...abAttrParams, pokemon: ally });
          }
        }
      }
    }

    // This attribute may modify damage arbitrarily, so be careful about changing its order of application.
    applyMoveAttrs("ModifiedDamageAttr", source, this, move, damage);

    // The pre-defend "endure / revive" hook used to gate on `isFullHp()` at
    // the dispatch site, mirroring vanilla Sturdy's hardcoded full-HP precond.
    // Elite Redux primitives (see {@linkcode PreFaintReviveAbAttr}) carry the
    // HP gate inside their own `canApply` to support non-full-HP variants
    // (Gallantry / Lucky Halo / Cheating Death gate on `hp-threshold:0`, etc).
    // Vanilla `PreDefendFullHpEndureAbAttr` still checks `isFullHp()` in its
    // own `canApply`, so removing this precondition does NOT change Sturdy
    // semantics — it just stops blocking non-Sturdy subclasses at the dispatch
    // site. (Round 7 of the ER bespoke ability grind.)
    if (!ignoreAbility) {
      applyAbAttrs("PreDefendFullHpEndureAbAttr", abAttrParams);
    }

    if (opponentDamageBoostSuppressionCeiling !== null) {
      damage.value = Math.min(damage.value, opponentDamageBoostSuppressionCeiling);
    }

    // debug message for when damage is applied
    if (!simulated) {
      console.log(`Move: ${move.name} | Attack damage: ${damage.value}`);
    }

    let hitResult: HitResult;
    if (typeMultiplier < 1) {
      hitResult = HitResult.NOT_VERY_EFFECTIVE;
    } else if (typeMultiplier > 1) {
      hitResult = HitResult.SUPER_EFFECTIVE;
    } else {
      hitResult = HitResult.EFFECTIVE;
    }

    return {
      cancelled: cancelled.value,
      result: hitResult,
      damage: damage.value,
    };
  }

  /**
   * Determine whether the given move will score a critical hit **against** this Pokemon.
   * @param source - The {@linkcode Pokemon} using the move
   * @param move - The {@linkcode Move} being used
   * @returns Whether the move will critically hit the defender.
   */
  getCriticalHitResult(source: Pokemon, move: Move): boolean {
    if (move.hasAttr("FixedDamageAttr")) {
      // fixed damage moves (Dragon Rage, etc.) will never crit
      return false;
    }

    const alwaysCrit = new BooleanHolder(false);
    applyMoveAttrs("CritOnlyAttr", source, this, move, alwaysCrit);
    applyAbAttrs("ConditionalCritAbAttr", { pokemon: source, isCritical: alwaysCrit, target: this, move });
    const alwaysCritTag = !!source.getTag(BattlerTagType.ALWAYS_CRIT);
    const critChance = [24, 8, 2, 1][Phaser.Math.Clamp(this.getCritStage(source, move), 0, 3)];

    let isCritical = alwaysCrit.value || alwaysCritTag || critChance === 1;

    // If we aren't already guaranteed to crit, do a random roll & check overrides
    isCritical ||= Overrides.CRITICAL_HIT_OVERRIDE ?? globalScene.randBattleSeedInt(critChance) === 0;

    // apply crit block effects from lucky chant & co., overriding previous effects
    const blockCrit = new BooleanHolder(false);
    applyAbAttrs("BlockCritAbAttr", { pokemon: this, blockCrit });
    globalScene.arena.applyTagsForSide(
      NoCritTag,
      this.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY,
      blockCrit,
    );
    isCritical &&= !blockCrit.value; // need to roll a crit and not be blocked by either crit prevention effect

    return isCritical;
  }

  /**
   * Submethod called by {@linkcode damageAndUpdate} to apply damage to this Pokemon and adjust its HP.
   * @param damage - The damage to deal
   * @param _ignoreSegments - Whether to ignore boss segments; default `false`
   * @param preventEndure - Whether to allow the damage to bypass an Endure/Sturdy effect
   * @param ignoreFaintPhase - Whether to ignore adding a FaintPhase if this damage causes a faint
   * @returns The actual damage dealt
   */
  // TODO: Rework this to use an object for the optional parameters
  // TODO: Remove uses of this outside of the `Pokemon` class and subclasses and change to `protected`
  // Known violators: Pain Split, Status effect code
  damage(damage: number, _ignoreSegments = false, preventEndure = false, ignoreFaintPhase = false): number {
    if (this.isFainted()) {
      return 0;
    }
    const surviveDamage = new BooleanHolder(false);

    // check for endure and other abilities that would prevent us from death
    if (!preventEndure && this.hp - damage <= 0) {
      if (this.hp >= 1 && this.getTag(BattlerTagType.ENDURING)) {
        surviveDamage.value = this.lapseTag(BattlerTagType.ENDURING);
      } else if (this.hp > 1 && this.getTag(BattlerTagType.STURDY)) {
        surviveDamage.value = this.lapseTag(BattlerTagType.STURDY);
      } else if (this.hp >= 1 && this.getTag(BattlerTagType.ENDURE_TOKEN)) {
        surviveDamage.value = this.lapseTag(BattlerTagType.ENDURE_TOKEN);
      }
      if (!surviveDamage.value) {
        globalScene.applyModifiers(SurviveDamageModifier, this.isPlayer(), this, surviveDamage);
      }
      // ER relic (#439): Second Wind - once per biome, the first player mon that
      // would faint survives at 1 HP (like a one-shot Focus Sash). Checked last so
      // it only consumes its charge when nothing else already saved the mon.
      let erRelicSaved = false;
      if (!surviveDamage.value && erTrySecondWind(this)) {
        surviveDamage.value = true;
        erRelicSaved = true;
      }
      // ER relic (#439): Pharaoh's Ankh - once per battle, ANY player mon that
      // would faint clings to life at 1 HP (re-arms each battle).
      if (!surviveDamage.value && erTryPharaohAnkh(this)) {
        surviveDamage.value = true;
        erRelicSaved = true;
      }
      if (surviveDamage.value) {
        damage = this.hp - 1;
        // catalog-v2 (#900) IMMORTAL_OBJECT: a RELIC (not an ability) prevented this faint.
        if (erRelicSaved) {
          erRecordAchievementRelicSurvive(this);
        }
      }
    }

    // ER Last Host (ability): once per battle, a holder that would faint - from
    // DIRECT *or* INDIRECT damage - while a foe is affected by Infestation clings to
    // life at 1 HP, consuming that foe's Infestation and dealing 25% of its max HP.
    // Deliberately OUTSIDE the `!preventEndure` guard above: unlike Endure/Sturdy,
    // Last Host explicitly survives indirect damage (poison, weather, recoil, an
    // Infestation tick, etc.), which the engine flags `preventEndure`.
    if (!surviveDamage.value && this.hp - damage <= 0 && erTryLastHost(this)) {
      surviveDamage.value = true;
      damage = this.hp - 1;
    }

    damage = Math.min(damage, this.hp);
    this.hp -= damage;
    // Co-op host turn recorder (#633, animation-replay redesign - Step 2): record the post-damage hp
    // (and a faint when this hit KOs) at the UNIVERSAL damage chokepoint, so the AUTHORITATIVE guest
    // can drain the HP bar + play the faint for a KO from ANY source - a move hit, end-of-turn status
    // (poison/burn), weather chip, recoil, an entry hazard on switch-in, or a multi-KO - not only the
    // direct move-hit path. `this.hp` here is the authoritative post-hit value (no RNG). The faint is
    // emitted whenever this damage drops the mon to 0 (independent of `ignoreFaintPhase`, which only
    // gates the HOST's FaintPhase, not the guest's animation event); since `damage()` no-ops once the
    // mon is already fainted (the isFainted early-return above), the faint event fires EXACTLY once per
    // KO. A substitute hit mutates `substitute.hp` directly and never calls this method, so it stays
    // excluded. Inert unless a recording is open (only the host, mid-turn, in a live co-op run) - solo
    // / non-host is byte-for-byte unaffected.
    if (isCoopRecording()) {
      recordCoopEvent({
        k: "hp",
        bi: this.getBattlerIndex(),
        hp: this.hp,
        maxHp: this.getMaxHp(),
        sp: this.species?.speciesId ?? 0,
      });
      if (this.isFainted()) {
        // #691 (host-language leak): carry `narrate` = whether the host shows an "X fainted!" message for
        // this KO, so the guest regenerates the faint line in its OWN language IFF true (and narrates
        // exactly the KOs the host narrated). DEVIATION from the spec's literal `!ignoreFaintPhase`: in
        // this codebase a DIRECT move-hit KO (the dominant narrated case) reaches `damage()` with
        // `ignoreFaintPhase=true` and its FaintPhase is DEFERRED to MoveEffectPhase.onFaintTarget
        // (move-effect-phase.ts), so the message IS shown; `!ignoreFaintPhase` would be FALSE for exactly
        // those KOs and the guest would never narrate them. Every KO that reaches this universal chokepoint
        // results in a FaintPhase (here when `!ignoreFaintPhase`, else via the move's deferred
        // onFaintTarget) and thus a shown message, so `narrate` is TRUE for a recorded faint. The flag is
        // kept on the wire (not hardcoded on the guest) so the GATING semantics + forward-compat hold (an
        // event may carry narrate=false and the guest suppresses the line).
        recordCoopEvent({ k: "faint", bi: this.getBattlerIndex(), narrate: true, sp: this.species?.speciesId ?? 0 });
      }
    }
    if (this.isFainted() && !ignoreFaintPhase) {
      globalScene.phaseManager.queueFaintPhase(this.getBattlerIndex(), preventEndure);
      this.destroySubstitute();
      this.lapseTag(BattlerTagType.COMMANDED);
    }
    return damage;
  }

  /**
   * Given the damage, adds a new DamagePhase and update HP values, etc.
   *
   * @remarks
   * Checks for {@linkcode HitResult.INDIRECT | Indirect} hits to account for Endure/Reviver Seed applying correctly
   * @param damage - The damage to inflict on this Pokémon
   * @param __namedParameters.source - Needed for proper typedoc rendering
   * @returns Amount of damage actually done
   */
  damageAndUpdate(
    damage: number,
    {
      result = HitResult.EFFECTIVE,
      isCritical = false,
      ignoreSegments = false,
      ignoreFaintPhase = false,
      source,
    }: {
      /**
       * An enum if it's super effective, not very effective, etc; default {@linkcode HitResult.EFFECTIVE}
       */
      result?: DamageResult;
      /** Whether the attack was a critical hit */
      isCritical?: boolean;
      /** Whether to ignore boss segments */
      ignoreSegments?: boolean;
      /** Whether to ignore adding a FaintPhase if this damage causes a faint; default `false` */
      ignoreFaintPhase?: boolean;
      /** The Pokémon inflicting the damage, or `undefined` if not caused by a Pokémon */
      source?: Pokemon;
    } = {},
  ): number {
    const isIndirectDamage = [HitResult.INDIRECT, HitResult.INDIRECT_KO].includes(result);
    // ER Magic Room (move 478) — dex: "Prevents passive damage ... for 5 turns."
    // While Magic Room is active, ALL passive/indirect damage on the field (weather,
    // status, hazards, Leech Seed, bleed, etc.) is nullified. (The dex's "disables
    // mega stones" half is a battle no-op here — ER megas are permanent forms.)
    if (isIndirectDamage && isMagicRoomActive()) {
      return 0;
    }
    const damagePhase = globalScene.phaseManager.create(
      "DamageAnimPhase",
      this.getBattlerIndex(),
      damage,
      result as DamageResult,
      isCritical,
    );
    globalScene.phaseManager.unshiftPhase(damagePhase);
    if (this.switchOutStatus && source) {
      damage = 0;
    }
    // ER Chivalry (ability 5909): on a DIRECT hit, a doubles ally absorbs 50% of
    // this Pokemon's incoming damage (raw), or — in singles after the holder
    // voluntarily switched out — 25% is redirected to the off-field holder. The
    // transferred share is removed from this Pokemon's incoming damage.
    if (!isIndirectDamage && source && damage > 0) {
      damage -= erApplyChivalry(this, damage);
    }
    // ER Soulmate (ability 5918): on a DIRECT hit, if this Pokemon's linked
    // partner carries Soulmate, 25% is redirected to that partner as raw HP.
    if (!isIndirectDamage && source && damage > 0) {
      damage -= erApplySoulmateRedirect(this, damage);
    }
    // ER Life Preserver (ability 5916): once per battle, a DIRECT attack that
    // would faint this Pokemon is clamped to leave it at 1 HP if a living ally
    // carries the ability — and the attacker is Drenched. Direct hits only
    // (indirect chip does not trigger it), and only when this hit is lethal.
    if (!isIndirectDamage && source && damage > 0 && this.hp - damage <= 0 && erTryLifePreserver(this, source)) {
      damage = this.hp - 1;
    }
    damage = this.damage(damage, ignoreSegments, isIndirectDamage, ignoreFaintPhase);
    erRecordAchievementDamageAndUpdate(this, damage, source, isIndirectDamage ? "indirect" : "direct");
    // Damage amount may have changed, but needed to be queued before calling damage function
    damagePhase.updateAmount(damage);
    /**
     * Run PostDamageAbAttr from any source of damage that is not from a multi-hit
     * Multi-hits are handled in move-effect-phase.ts for PostDamageAbAttr
     */
    if (!source || source.turnData.hitCount <= 1) {
      applyAbAttrs("PostDamageAbAttr", { pokemon: this, damage, source });
    }
    return damage;
  }

  /**
   * Restore a specific amount of HP to this Pokémon
   * @param amount - The amount of HP to restore
   * @returns The true amount of HP restored; may be less than `amount` if `amount` would overheal
   */
  public heal(amount: number): number {
    const healAmount = Math.min(amount, this.getMaxHp() - this.hp);
    this.hp += healAmount;
    // ER Soulmate (ability 5918): 50% of the direct healing a Soulmate holder
    // receives is copied to its linked ally (guarded against recursion).
    erApplySoulmateHealCopy(this, healAmount);
    return healAmount;
  }

  public isBossImmune(): boolean {
    return this.isBoss();
  }

  /**
   * @returns Whether this Pokémon is in a Dynamax or Gigantamax form
   */
  public isMax(): boolean {
    const maxForms = [
      SpeciesFormKey.GIGANTAMAX,
      SpeciesFormKey.GIGANTAMAX_RAPID,
      SpeciesFormKey.GIGANTAMAX_SINGLE,
      SpeciesFormKey.ETERNAMAX,
    ] as string[];
    return (
      maxForms.includes(this.getFormKey()) || (!!this.getFusionFormKey() && maxForms.includes(this.getFusionFormKey()!))
    );
  }

  /**
   * @returns Whether this Pokémon is in a Mega or Primal form
   */
  public isMega(): boolean {
    const megaForms = [
      SpeciesFormKey.MEGA,
      SpeciesFormKey.MEGA_X,
      SpeciesFormKey.MEGA_Y,
      SpeciesFormKey.MEGA_Z,
      SpeciesFormKey.PRIMAL,
    ] as string[];
    return (
      megaForms.includes(this.getFormKey())
      || (!!this.getFusionFormKey() && megaForms.includes(this.getFusionFormKey()!))
    );
  }

  private formUsesDerivedAbilities(formKey: string | null | undefined): boolean {
    return (
      formKey === SpeciesFormKey.MEGA
      || formKey === SpeciesFormKey.MEGA_X
      || formKey === SpeciesFormKey.MEGA_Y
      || formKey === SpeciesFormKey.MEGA_Z
      || formKey === SpeciesFormKey.PRIMAL
      || formKey === SpeciesFormKey.GIGANTAMAX
      || formKey === SpeciesFormKey.GIGANTAMAX_RAPID
      || formKey === SpeciesFormKey.GIGANTAMAX_SINGLE
      || formKey === SpeciesFormKey.ETERNAMAX // ER: Zacian/Zamazenta Crowned (Rusted Sword/Shield) carry their OWN ER // ability set in the form data (Crowned Sword + Steelworker/Battle Armor/ // Keen Edge), like a mega. Without this the form reads the BASE (Hero) kit // - the live "Zacian Crowned looks vanilla / doesn't get Keen Edge" report.
      || formKey === "crowned"
    );
  }

  private baseUsesFormDerivedAbilities(): boolean {
    return this.formUsesDerivedAbilities(this.getFormKey());
  }

  private fusionUsesFormDerivedAbilities(): boolean {
    return this.formUsesDerivedAbilities(this.getFusionFormKey());
  }

  /**
   * ER: Mega / Gigantamax / Eternamax / Primal forms carry their OWN ability
   * set in species data (active ability + the 3 innate slots). Per-Pokémon
   * ability overrides written for the BASE form — by the Ability Randomizer,
   * custom-starter config, or mystery encounters via
   * `customPokemonData.ability/passive/passive2/passive3` — must NOT shadow the
   * form's abilities while the Pokémon is in such a form. When this returns
   * true, {@linkcode getAbility} / {@linkcode getPassiveAbility} /
   * {@linkcode getPassiveAbilities} skip those overrides and fall through to the
   * form's species abilities.
   *
   * The overrides are NOT cleared (they remain in `customPokemonData`), so if
   * the Pokémon ever reverts to its base form the base-form ability set is
   * restored — correct whether mega/max is permanent (the PokeRogue default) or
   * manually reverted.
   */
  public usesFormDerivedAbilities(): boolean {
    return this.baseUsesFormDerivedAbilities() || this.fusionUsesFormDerivedAbilities();
  }

  /**
   * Whether this Pokémon's per-Pokémon ability/passive overrides
   * ({@linkcode CustomPokemonData}) should be honored in its current form.
   *
   * Normally overrides are skipped while {@linkcode usesFormDerivedAbilities} is
   * true (mega / G-max use their own species innates). The exception is when the
   * ER Ability Randomizer was used on the Pokémon *while it was in that form* —
   * it then sets {@linkcode CustomPokemonData.abilityOverridesForm}, so the
   * reroll actually applies to (and is visible on) the form instead of being
   * silently shadowed.
   */
  public customAbilityOverridesApply(): boolean {
    return !this.baseUsesFormDerivedAbilities() || this.customPokemonData.abilityOverridesForm;
  }

  /**
   * Check whether a battler tag can be added to this Pokémon
   *
   * @param tagType - The tag to check
   * @returns - Whether the tag can be added
   * @see {@linkcode addTag}
   */
  public canAddTag(tagType: BattlerTagType): boolean {
    if (this.getTag(tagType)) {
      return false;
    }

    const stubTag = new BattlerTag(tagType, 0, 0);

    const cancelled = new BooleanHolder(false);
    applyAbAttrs("BattlerTagImmunityAbAttr", { pokemon: this, tag: stubTag, cancelled, simulated: true });

    for (const pokemon of this.getAlliesGenerator()) {
      applyAbAttrs("UserFieldBattlerTagImmunityAbAttr", {
        pokemon,
        tag: stubTag,
        cancelled,
        simulated: true,
        target: this,
      });
    }

    return !cancelled.value;
  }

  /**
   * Add a new {@linkcode BattlerTag} of the specified `tagType`
   *
   * @remarks
   * Also ensures the tag is able to be applied, similar to {@linkcode canAddTag}
   *
   * @param tagType - The type of tag to add
   * @param turnCount - The number of turns the tag should last; default `0`
   * @param sourceMove - The id of the move that causing the tag to be added, if caused by a move
   * @param sourceId - The {@linkcode Pokemon#id | id} of the pokemon causing the tag to be added, if caused by a Pokémon
   * @returns Whether the tag was successfully added
   * @see {@linkcode canAddTag}
   */
  public addTag(tagType: BattlerTagType, turnCount = 0, sourceMove?: MoveId, sourceId?: number): boolean {
    const existingTag = this.getTag(tagType);
    if (existingTag) {
      existingTag.onOverlap(this);
      return false;
    }

    // ER Ward Stones (#358): block external CC tags (flinch / confusion /
    // infatuation / the ER statuses) before they attach, one charge per block.
    if (
      ER_WARD_BLOCKED_TAGS.has(tagType)
      && sourceId !== this.id
      && applyErWardStoneBlock(this, erWardStoneTagLabel(tagType))
    ) {
      return false;
    }

    // ER tactical items: Mental Herb cures a mental affliction (consumed), and
    // Throat Spray blocks Throat Chop while held.
    if (erTacticalBlocksBattlerTag(this, tagType, sourceId)) {
      return false;
    }

    const newTag = getBattlerTag(tagType, turnCount, sourceMove!, sourceId!); // TODO: are the bangs correct?

    // TODO: Just call canAddTag() here? Can possibly overload it to accept an actual tag instead of just a type
    const cancelled = new BooleanHolder(false);
    applyAbAttrs("BattlerTagImmunityAbAttr", { pokemon: this, tag: newTag, cancelled });
    if (cancelled.value) {
      return false;
    }

    for (const pokemon of this.getAlliesGenerator()) {
      applyAbAttrs("UserFieldBattlerTagImmunityAbAttr", { pokemon, tag: newTag, cancelled, target: this });
      if (cancelled.value) {
        return false;
      }
    }

    if (newTag.canAdd(this)) {
      this.summonData.tags.push(newTag);
      newTag.onAdd(this);
      return true;
    }

    return false;
  }

  public getTag<T extends BattlerTagType | AbstractConstructor<BattlerTag> | Constructor<BattlerTag>>(
    tagType: T,
  ): BattlerTagFromType<T> | undefined;
  public getTag(tagType: BattlerTagType | Constructor<BattlerTag>): BattlerTag | undefined {
    return typeof tagType === "function"
      ? this.summonData.tags.find(t => t instanceof tagType)
      : this.summonData.tags.find(t => t.tagType === tagType);
  }

  findTag<T extends BattlerTag>(tagFilter: (tag: BattlerTag) => tag is T): T | undefined;
  findTag(tagFilter: (tag: BattlerTag) => boolean): BattlerTag | undefined;
  /**
   * Find the first `BattlerTag` matching the specified predicate
   * @remarks
   * Equivalent to `this.summonData.tags.find(tagFilter)`.
   * @param tagFilter - The predicate to match against
   * @returns The first matching tag, or `undefined` if none match
   */
  public findTag<T extends BattlerTag>(tagFilter: (tag: BattlerTag) => tag is T): T | undefined;
  /**
   * Find the first `BattlerTag` matching the specified predicate
   * @remarks
   * Equivalent to `this.summonData.tags.find(tagFilter)`.
   * @param tagFilter - The predicate to match against
   * @returns The first matching tag, or `undefined` if none match
   */
  public findTag(tagFilter: (tag: BattlerTag) => boolean): BattlerTag | undefined;
  public findTag(tagFilter: (tag: BattlerTag) => boolean) {
    return this.summonData.tags.find(tagFilter);
  }

  /**
   * Return the list of `BattlerTag`s that satisfy the given predicate
   * @remarks
   * Equivalent to `this.summonData.tags.filter(tagFilter)`.
   * @param tagFilter - The predicate to match against
   * @returns The filtered list of tags
   */
  public findTags<T extends BattlerTag>(tagFilter: (tag: BattlerTag) => tag is T): T[];
  /**
   * Return the list of `BattlerTag`s that satisfy the given predicate
   * @remarks
   * Equivalent to `this.summonData.tags.filter(tagFilter)`.
   * @param tagFilter - The predicate to match against
   * @returns The filtered list of tags
   */
  public findTags(tagFilter: (tag: BattlerTag) => boolean): BattlerTag[];
  public findTags(tagFilter: (tag: BattlerTag) => boolean): BattlerTag[] {
    return this.summonData.tags.filter(tagFilter);
  }

  /**
   * Lapse the first {@linkcode BattlerTag} matching `tagType`
   *
   * @remarks
   * Also responsible for removing the tag when the lapse method returns `false`.
   *
   * ⚠️ Lapse types other than `CUSTOM` are generally lapsed automatically. However, some tags
   * support manually lapsing
   *
   * @param tagType - The {@linkcode BattlerTagType} to search for
   * @param lapseType - The lapse type to use for the lapse method; defaults to {@linkcode BattlerTagLapseType.CUSTOM}
   * @param args - Any optional arguments required to lapse the given tag
   * @returns Whether a tag matching the given type was found
   * @see {@linkcode BattlerTag.lapse}
   */
  public lapseTag(
    tagType: BattlerTagType,
    // TODO: Enforce that this is an acceptable lapse type for the tag being triggered
    lapseType: BattlerTagLapseType = BattlerTagLapseType.CUSTOM,
  ): boolean {
    const { tags } = this.summonData;
    const tag = tags.find(t => t.tagType === tagType);
    if (!tag) {
      return false;
    }

    if (!tag.lapse(this, lapseType)) {
      tag.onRemove(this);
      tags.splice(tags.indexOf(tag), 1);
    }
    return true;
  }

  /**
   * Tick down all {@linkcode BattlerTags} that lapse on the provided
   * `lapseType`, removing any whose durations fall below 0.
   * @param lapseType - The type of lapse to process
   */
  public lapseTags(lapseType: Exclude<BattlerTagLapseType, BattlerTagLapseType.CUSTOM>): void {
    const tags = this.summonData.tags;
    tags
      .filter(
        t =>
          lapseType === BattlerTagLapseType.FAINT
          || (t.lapseTypes.some(lType => lType === lapseType) && !t.lapse(this, lapseType)),
      )
      .forEach(t => {
        t.onRemove(this);
        tags.splice(tags.indexOf(t), 1);
      });
  }

  /**
   * Remove the first tag matching `tagType` and invoke its
   * {@linkcode BattlerTag#onRemove | onRemove} method.
   * @remarks
   * Only removes the first matching tag, if multiple are present; to remove all
   * matching tags, use {@linkcode findAndRemoveTags} instead.
   * @param tagType - The tag type to search for and remove
   */
  public removeTag(tagType: BattlerTagType): void {
    const tags = this.summonData.tags;
    const tag = tags.find(t => t.tagType === tagType);
    if (tag) {
      tag.onRemove(this);
      tags.splice(tags.indexOf(tag), 1);
    }
  }

  /**
   * Find and remove all {@linkcode BattlerTag}s matching the given function and
   * invoke their {@linkcode BattlerTag#onRemove | onRemove} methods.
   * @remarks
   * Removes all matching tags; to remove only the first matching tag, use
   * {@linkcode removeTag} instead.
   * @param tagFilter - A function dictating which tags to remove
   */
  public findAndRemoveTags(tagFilter: (tag: BattlerTag) => boolean): void {
    const tags = this.summonData.tags;
    const tagsToRemove = tags.filter(t => tagFilter(t));
    for (const tag of tagsToRemove) {
      tag.turnCount = 0;
      tag.onRemove(this);
      tags.splice(tags.indexOf(tag), 1);
    }
  }

  /**
   * Remove all tags that were applied by a Pokémon with the given `sourceId`,
   * invoking their {@linkcode BattlerTag#onRemove | onRemove} methods.
   * @param sourceId - Tags with this {@linkcode Pokemon#id | id} as their {@linkcode BattlerTag#sourceId | sourceId} will be removed
   * @see {@linkcode findAndRemoveTags}
   */
  public removeTagsBySourceId(sourceId: number): void {
    this.findAndRemoveTags(t => t.isSourceLinked() && t.sourceId === sourceId);
  }

  /**
   * Change the `sourceId` of all tags on this Pokémon with the given `sourceId` to `newSourceId`.
   * @param sourceId - The {@linkcode Pokemon#id | id} of the pokemon whose tags are to be transferred
   * @param newSourceId - The {@linkcode Pokemon#id | id} of the pokemon to which the tags are being transferred
   */
  public transferTagsBySourceId(sourceId: number, newSourceId: number): void {
    this.summonData.tags.forEach(t => {
      if (t.sourceId === sourceId) {
        t.sourceId = newSourceId;
      }
    });
  }

  /**
   * Transfer stat changes and Tags from another Pokémon
   *
   * @remarks
   * Used to implement Baton Pass and switching via the Baton item.
   *
   * @param source - The pokemon whose stats/Tags are to be passed on from, ie: the Pokemon using Baton Pass
   */
  public transferSummon(source: Pokemon): void {
    for (const s of BATTLE_STATS) {
      const sourceStage = source.getStatStage(s);
      if (this.isPlayer() && sourceStage === 6) {
        globalScene.validateAchv(achvs.TRANSFER_MAX_STAT_STAGE);
      }
      this.setStatStage(s, sourceStage);
    }

    for (const tag of source.summonData.tags) {
      if (
        !tag.isBatonPassable
        || (tag.tagType === BattlerTagType.TELEKINESIS
          && this.species.speciesId === SpeciesId.GENGAR
          && this.getFormKey() === "mega")
      ) {
        continue;
      }

      if (tag instanceof PowerTrickTag) {
        tag.swapStat(this);
      }

      this.summonData.tags.push(tag);
    }

    this.updateInfo();
  }

  /**
   * Get whether the given move is currently disabled for this Pokémon by a move restriction tag.
   *
   * @remarks
   * ⚠️ Only checks for restrictions due to a battler tag, not due to the move's own attributes.
   * @param moveId - The ID of the move to check
   * @returns `true` if the move is disabled for this Pokemon, otherwise `false`
   * @see {@linkcode MoveRestrictionBattlerTag}
   */
  // TODO: Move this behavior into a matcher and expunge it from the codebase - we only use it for tests
  public hasRestrictingTag(moveId: MoveId): boolean {
    return this.getRestrictingTag(moveId) != null;
  }

  /**
   * Get the {@linkcode MoveRestrictionBattlerTag} that is restricting this Pokemon's move usage, if one exists.
   *
   * @param moveId - The ID of the move to check
   * @returns The first tag on this Pokemon that restricts the move, or `undefined` if the move is not restricted.
   * @remarks
   * Does not consider target-based restrictions from Heal Block, which is done by {@linkcode getTargetRestrictingTag}.
   */
  private getRestrictingTag(moveId: MoveId): MoveRestrictionBattlerTag | undefined {
    return this.findTag(t => t instanceof MoveRestrictionBattlerTag && t.isMoveRestricted(moveId, this)) as
      | MoveRestrictionBattlerTag
      | undefined;
  }

  /**
   * Determine whether the given move is selectable by this Pokemon.
   * @param moveId - The `MoveId` to check
   * @returns A tuple containing whether the move can be selected and the text to display if it cannot
   * @remarks
   * Checks both the move's own restrictions and any `BattlerTag`-imposed restrictions.
   */
  public isMoveSelectable(moveId: MoveId): [selectable: boolean, msg: string] {
    const restrictedTag = this.getRestrictingTag(moveId);
    if (restrictedTag) {
      return [false, restrictedTag.selectionDeniedText(this, moveId)];
    }
    return allMoves[moveId].checkRestrictions(this);
  }

  /**
   * Return whether this Pokemon is restricted from using a move against the given target.
   * @param moveId - The `MoveId` of the move being used
   * @param target - The `Pokemon` being targeted by the move
   * @returns Whether `moveId` is unable to target `target` due to a restricting effect
   * @remarks
   * Currently used solely to prevent Pollen Puff from being used on an ally with Heal Block active.
   */
  // TODO: Expand `MoveRestriction`s to allow for target based conditions and
  // remove this entire line of functions
  // TODO: Move into matcher and remove (used solely for tests)
  isMoveTargetRestricted(moveId: MoveId, target: Pokemon): boolean {
    return !!this.getTargetRestrictingTag(moveId, target);
  }

  /**
   * Return the `BattlerTag` preventing this Pokemon from using a move against the given target.
   * @param moveId - The `MoveId` of the move being used
   * @param target - The `Pokemon` being targeted by the move
   * @returns The first `BattlerTag` preventing this Pokemon from using `moveId` against `target` (if one exists).
   * @remarks
   * Currently used solely to prevent Pollen Puff from being used on an ally with Heal Block active.
   * @privateRemarks
   * Note that the tag in question will be attached to the **target** of the move, not the user!
   */
  getTargetRestrictingTag(moveId: MoveId, target: Pokemon): MoveRestrictionBattlerTag | undefined {
    // NB: We check the target's tags because Heal Block belongs to the opponent
    return target.findTag(
      (tag): tag is MoveRestrictionBattlerTag =>
        tag instanceof MoveRestrictionBattlerTag && tag.isMoveTargetRestricted(moveId, this, target),
    );
  }

  /**
   * Return this Pokemon's move history.
   * Entries are sorted in order of OLDEST to NEWEST.
   * @returns An array of {@linkcode TurnMove}s, as described above.
   * @see {@linkcode getLastXMoves}
   */
  public getMoveHistory(): TurnMove[] {
    return this.summonData.moveHistory;
  }

  /**
   * Add a move to the end of this {@linkcode Pokemon}'s move history,
   * used to record its most recently executed actions.
   * @param turnMove - The move to add to the history
   */
  public pushMoveHistory(turnMove: TurnMove): void {
    if (!this.isOnField()) {
      return;
    }
    this.getMoveHistory().push(turnMove);
  }

  /**
   * Return a list of the most recent move entries in this {@linkcode Pokemon}'s move history.
   * The retrieved values are sorted in order from **NEWEST** to **OLDEST**.
   * @param moveCount - The maximum number of move entries to retrieve.
   * If negative, retrieves the Pokemon's entire move history (equivalent to reversing the output of {@linkcode getMoveHistory}).
   * Default is `1`.
   * @returns An array of {@linkcode TurnMove}s, as specified above.
   * @privateRemarks
   * Callers that want to obtain the last move actually _executed_ (i.e. selected from the user's moveset)
   * should use {@linkcode getLastNonVirtualMove} instead.
   */
  // TODO: Most moves accessing this can be reworked to use the current "move in flight" once implemented
  public getLastXMoves(moveCount = 1): readonly TurnMove[] {
    const hist = this.getMoveHistory().toReversed();
    if (moveCount <= 0) {
      return hist;
    }
    return hist.slice(0, moveCount);
  }

  /**
   * Return the most recently executed {@linkcode TurnMove} this {@linkcode Pokemon} has used that is:
   * - Not {@linkcode MoveId.NONE}
   * - Non-virtual ({@linkcode MoveUseMode | useMode} < {@linkcode MoveUseMode.INDIRECT})
   * @param ignoreStruggle - Whether to additionally ignore {@linkcode MoveId.STRUGGLE}; default `false`
   * @param ignoreFollowUp - Whether to ignore moves with a use type of {@linkcode MoveUseMode.FOLLOW_UP}
   * (e.g. ones called by Copycat/Mirror Move); default `true`.
   * @returns The last move this Pokemon has used satisfying the aforementioned conditions,
   * or `undefined` if no applicable moves have been used since switching in.
   */
  public getLastNonVirtualMove(ignoreStruggle = false, ignoreFollowUp = true): TurnMove | undefined {
    return this.getMoveHistory().findLast(
      m =>
        m.move !== MoveId.NONE
        && (!ignoreStruggle || m.move !== MoveId.STRUGGLE)
        && (!isVirtual(m.useMode) || (!ignoreFollowUp && m.useMode === MoveUseMode.FOLLOW_UP)),
    );
  }

  /**
   * Return this Pokemon's move queue, consisting of all the moves it is slated to perform.
   * @returns An array of {@linkcode TurnMove}, as described above
   */
  public getMoveQueue(): TurnMove[] {
    return this.summonData.moveQueue;
  }

  /**
   * Add a new entry to the end of this Pokemon's move queue.
   * @param queuedMove - A {@linkcode TurnMove} to push to this Pokemon's queue.
   */
  public pushMoveQueue(queuedMove: TurnMove): void {
    this.summonData.moveQueue.push(queuedMove);
  }

  /**
   * Change this Pokémon's form to the specified form, loading the required
   * assets and updating its stats and info display.
   * @param formChange - The form to change to
   * @returns A Promise that resolves once the form change has completed.
   */
  public async changeForm(formChange: SpeciesFormChange): Promise<void> {
    this.formIndex = Math.max(
      this.species.forms.findIndex(f => f.formKey === formChange.formKey),
      0,
    );
    this.generateName();

    const abilityCount = this.getSpeciesForm().getAbilityCount();
    if (this.abilityIndex >= abilityCount) {
      console.warn(
        "Pokemon ability index out of bounds!"
          + `Name: ${this.name}`
          + `Old Ability Index: ${this.abilityIndex}`
          + `Ability Count: ${abilityCount}`
          + `Form Key: ${formChange.formKey}`,
      );
      this.abilityIndex = abilityCount - 1;
    }

    globalScene.gameData.setPokemonSeen(this, false);
    this.setScale(this.getSpriteScale());

    await this.loadAssets();
    this.calculateStats();
    globalScene.updateModifiers(this.isPlayer(), true);
    await Promise.all([this.updateInfo(), globalScene.updateFieldScale()]);
  }

  /**
   * Play this Pokémon's cry sound
   * @param soundConfig - Optional sound configuration to apply to the cry
   * @param sceneOverride - Optional scene to use instead of the global scene
   */
  public cry(soundConfig?: Phaser.Types.Sound.SoundConfig, sceneOverride?: BattleScene): AnySound | null {
    const scene = sceneOverride ?? globalScene; // TODO: is `sceneOverride` needed?
    const cry = this.getSpeciesForm(undefined, true).cry(soundConfig);
    if (!cry || globalScene.masterVolume === 0 || globalScene.fieldVolume === 0) {
      return cry;
    }
    let duration = cry.totalDuration * 1000;
    if (this.fusionSpecies && this.getSpeciesForm(undefined, true) !== this.getFusionSpeciesForm(undefined, true)) {
      const fusionCry = this.getFusionSpeciesForm(undefined, true).cry(soundConfig, true);
      if (!fusionCry) {
        return cry;
      }
      duration = Math.min(duration, fusionCry.totalDuration * 1000);
      fusionCry.destroy();
      scene.time.delayedCall(fixedInt(Math.ceil(duration * 0.4)), () => {
        try {
          SoundFade.fadeOut(scene, cry, fixedInt(Math.ceil(duration * 0.2)));
          const fusionCryInner = this.getFusionSpeciesForm(undefined, true).cry({
            seek: Math.max(fusionCry.totalDuration * 0.4, 0),
            ...soundConfig,
          });
          if (fusionCryInner) {
            SoundFade.fadeIn(
              scene,
              fusionCryInner,
              fixedInt(Math.ceil(duration * 0.2)),
              scene.masterVolume * scene.fieldVolume,
              0,
            );
          }
        } catch (err) {
          console.error(err);
        }
      });
    }

    return cry;
  }

  /**
   * Play this Pokémon's faint cry, pausing its animation until the cry is finished.
   * @param callback - A function to be called once the cry has finished playing
   */
  public faintCry(callback: () => any): void {
    if (this.fusionSpecies && this.getSpeciesForm() !== this.getFusionSpeciesForm()) {
      this.fusionFaintCry(callback);
      return;
    }

    const key = this.species.getCryKey(this.formIndex);
    const crySoundConfig = { rate: 0.85, detune: 0 };
    if (this.isPlayer()) {
      // If fainting is permanent, emphasize impact
      const preventRevive = new BooleanHolder(false);
      applyChallenges(ChallengeType.PREVENT_REVIVE, preventRevive);
      if (preventRevive.value) {
        crySoundConfig.detune = -100;
        crySoundConfig.rate = 0.7;
      }
    }
    const cry = globalScene.playSound(key, crySoundConfig);
    if (!cry || globalScene.fieldVolume === 0 || globalScene.masterVolume === 0) {
      callback();
      return;
    }
    const sprite = this.getSprite();
    const tintSprite = this.getTintSprite();
    const delay = Math.max(cry.totalDuration * 50, 25);

    let frameProgress = 0;
    let frameThreshold: number;

    sprite.anims.pause();
    tintSprite?.anims.pause();

    let faintCryTimer: Phaser.Time.TimerEvent | null = globalScene.time.addEvent({
      delay: fixedInt(delay),
      repeat: -1,
      callback: () => {
        frameThreshold = sprite.anims.msPerFrame / crySoundConfig.rate;
        frameProgress += delay;
        while (frameProgress > frameThreshold) {
          if (sprite.anims.duration) {
            sprite.anims.nextFrame();
            tintSprite?.anims.nextFrame();
          }
          frameProgress -= frameThreshold;
        }
        if (cry && !cry.pendingRemove) {
          cry.setRate(crySoundConfig.rate * 0.99);
        } else {
          faintCryTimer?.destroy();
          faintCryTimer = null;
          if (callback) {
            callback();
          }
        }
      },
    });

    // Failsafe
    globalScene.time.delayedCall(fixedInt(3000), () => {
      if (!faintCryTimer || !globalScene) {
        return;
      }
      if (cry?.isPlaying) {
        cry.stop();
      }
      faintCryTimer.destroy();
      if (callback) {
        callback();
      }
    });
  }

  /**
   * Play this Pokémon's fusion faint cry, which is a mixture of the faint cries
   * for both of its species
   * @param callback - A function to be called once the cry has finished playing
   */
  private fusionFaintCry(callback: () => any): void {
    const key = this.species.getCryKey(this.formIndex);
    let i = 0;
    let rate = 0.85;
    const cry = globalScene.playSound(key, { rate });
    const sprite = this.getSprite();
    const tintSprite = this.getTintSprite();

    const fusionCryKey = this.fusionSpecies!.getCryKey(this.fusionFormIndex);
    let fusionCry = globalScene.playSound(fusionCryKey, {
      rate,
    });
    if (!cry || !fusionCry || globalScene.fieldVolume === 0 || globalScene.masterVolume === 0) {
      callback();
      return;
    }
    fusionCry.stop();
    let duration = cry.totalDuration * 1000;
    duration = Math.min(duration, fusionCry.totalDuration * 1000);
    fusionCry.destroy();
    const delay = Math.max(duration * 0.05, 25);

    let transitionIndex = 0;
    let durationProgress = 0;

    const transitionThreshold = Math.ceil(duration * 0.4);
    while (durationProgress < transitionThreshold) {
      ++i;
      durationProgress += delay * rate;
      rate *= 0.99;
    }

    transitionIndex = i;

    i = 0;
    rate = 0.85;

    let frameProgress = 0;
    let frameThreshold: number;

    sprite.anims.pause();
    tintSprite?.anims.pause();

    let faintCryTimer: Phaser.Time.TimerEvent | null = globalScene.time.addEvent({
      delay: fixedInt(delay),
      repeat: -1,
      callback: () => {
        ++i;
        frameThreshold = sprite.anims.msPerFrame / rate;
        frameProgress += delay;
        while (frameProgress > frameThreshold) {
          if (sprite.anims.duration) {
            sprite.anims.nextFrame();
            tintSprite?.anims.nextFrame();
          }
          frameProgress -= frameThreshold;
        }
        if (i === transitionIndex && fusionCryKey) {
          SoundFade.fadeOut(globalScene, cry, fixedInt(Math.ceil((duration / rate) * 0.2)));
          fusionCry = globalScene.playSound(fusionCryKey, {
            // TODO: This bang is correct as this callback can only be called once, but
            // this whole block with conditionally reassigning fusionCry needs a second lock.
            seek: Math.max(fusionCry!.totalDuration * 0.4, 0),
            rate,
          });
          if (fusionCry) {
            SoundFade.fadeIn(
              globalScene,
              fusionCry,
              fixedInt(Math.ceil((duration / rate) * 0.2)),
              globalScene.masterVolume * globalScene.fieldVolume,
              0,
            );
          }
        }
        rate *= 0.99;
        if (cry && !cry.pendingRemove) {
          cry.setRate(rate);
        }
        if (fusionCry && !fusionCry.pendingRemove) {
          fusionCry.setRate(rate);
        }
        if ((!cry || cry.pendingRemove) && (!fusionCry || fusionCry.pendingRemove)) {
          faintCryTimer?.destroy();
          faintCryTimer = null;
          if (callback) {
            callback();
          }
        }
      },
    });

    // Failsafe
    globalScene.time.delayedCall(fixedInt(3000), () => {
      if (!faintCryTimer || !globalScene) {
        return;
      }
      if (cry?.isPlaying) {
        cry.stop();
      }
      if (fusionCry?.isPlaying) {
        fusionCry.stop();
      }
      faintCryTimer.destroy();
      if (callback) {
        callback();
      }
    });
  }

  /**
   * Check the specified pokemon is considered to be the opposite gender as this pokemon
   * @param pokemon - The Pokémon to compare against
   * @returns Whether the pokemon are considered to be opposite genders
   */
  public isOppositeGender(pokemon: Pokemon): boolean {
    return (
      this.gender !== Gender.GENDERLESS
      && pokemon.gender === (this.gender === Gender.MALE ? Gender.FEMALE : Gender.MALE)
    );
  }

  /**
   * Display an immunity message for a failed status application.
   * @param quiet - Whether to suppress message and return early
   * @param reason - The reason for the status application failure;
   * can be "overlap" (already has same status), "other" (generic fail message)
   * or a {@linkcode TerrainType} for terrain-based blockages.
   * Default `"other"`
   */
  public queueStatusImmuneMessage(
    quiet: boolean,
    reason: "overlap" | "other" | Exclude<TerrainType, TerrainType.NONE> = "other",
  ): void {
    if (quiet) {
      return;
    }

    let message: string;
    if (reason === "overlap") {
      // "XYZ is already XXX!"
      message = getStatusEffectOverlapText(this.status?.effect ?? StatusEffect.NONE, getPokemonNameWithAffix(this));
    } else if (typeof reason === "number") {
      // "XYZ was protected by the XXX terrain!" /
      // "XYZ surrounds itself with a protective mist!"
      message = getTerrainBlockMessage(this, reason);
    } else {
      // "It doesn't affect XXX!"
      message = i18next.t("abilityTriggers:moveImmunity", {
        pokemonNameWithAffix: getPokemonNameWithAffix(this),
      });
    }

    globalScene.phaseManager.queueMessage(message);
  }

  /**
   * Check if a status effect can be applied to this {@linkcode Pokemon}.
   *
   * @param effect - The {@linkcode StatusEffect} whose applicability is being checked
   * @param quiet - Whether to suppress in-battle messages for status checks; default `false`
   * @param overrideStatus - Whether to allow overriding the Pokemon's current status with a different one; default `false`
   * @param sourcePokemon - The {@linkcode Pokemon} applying the status effect to the target,
   * or `null` if the status is applied from a non-Pokemon source (hazards, etc.); default `null`
   * @param ignoreField - Whether to ignore field effects (weather, terrain, etc.) preventing status application;
   * default `false`
   * @returns Whether {@linkcode effect} can be applied to this Pokemon.
   */
  // TODO: Review and verify the message order precedence in mainline if multiple status-blocking effects are present at once
  // TODO: Make argument order consistent with `trySetStatus`
  public canSetStatus(
    effect: StatusEffect,
    quiet = false,
    overrideStatus = false,
    sourcePokemon: Pokemon | null = null,
    ignoreField = false,
    ignoreTypeImmunity = false,
    // Category of the move applying the status (null for non-move sources). Lets
    // a status-move-only immunity bypass (ER Mycelium Might) gate on it.
    sourceMoveCategory: MoveCategory | null = null,
  ): boolean {
    if (effect !== StatusEffect.FAINT) {
      // Status-overriding moves (i.e. Rest) fail if their respective status already exists;
      // all other moves fail if the target already has _any_ status
      if (overrideStatus ? this.status?.effect === effect : this.status || this.turnData.pendingStatus) {
        this.queueStatusImmuneMessage(quiet, overrideStatus ? "overlap" : "other"); // having different status displays generic fail message
        return false;
      }
      // ER: Frostbite is a MAJOR status implemented as a BattlerTag (not
      // `this.status`), so the vanilla "already has a status" check above misses
      // it — letting a frostbitten Pokemon also be paralyzed/burned/etc. A major
      // status is exclusive, so a frostbitten holder blocks any new status (Rest's
      // override path still works because it heals via its own flow).
      if (!overrideStatus && this.getTag(BattlerTagType.ER_FROSTBITE)) {
        this.queueStatusImmuneMessage(quiet, "other");
        return false;
      }
      if (this.isGrounded() && !ignoreField && globalScene.arena.terrain?.terrainType === TerrainType.MISTY) {
        this.queueStatusImmuneMessage(quiet, TerrainType.MISTY);
        return false;
      }
    }

    const types = this.getTypes(true, true);

    /* Whether the target is immune to the specific status being applied. */
    let isImmune = false;
    /** The reason for a potential blockage; default "other" for type-based. */
    let reason: "other" | Exclude<TerrainType, TerrainType.NONE> = "other";

    switch (effect) {
      case StatusEffect.POISON:
      case StatusEffect.TOXIC:
        // Check for type based immunities and/or Corrosion from the applier.
        isImmune = types.some(defType => {
          // only 1 immunity needed to block
          if (defType !== PokemonType.POISON && defType !== PokemonType.STEEL) {
            return false;
          }

          // No source (such as from Toxic Spikes) = blocked by default
          if (!sourcePokemon) {
            return true;
          }

          const cancelImmunity = new BooleanHolder(false);
          // TODO: Determine if we need to pass `quiet` as the value for simulated in this call
          applyAbAttrs("IgnoreTypeStatusEffectImmunityAbAttr", {
            pokemon: sourcePokemon,
            cancelled: cancelImmunity,
            statusEffect: effect,
            defenderType: defType,
            moveCategory: sourceMoveCategory ?? undefined,
          });
          return !cancelImmunity.value;
        });
        break;
      case StatusEffect.PARALYSIS:
        // ER Glare (er move 137, effect 41 "Paralyze Ignore Type"): its status
        // attr sets `ignoreTypeImmunity`, letting it paralyze Electric types for
        // that move ONLY. Every other paralysis source keeps the Electric immunity.
        isImmune = !ignoreTypeImmunity && this.isOfType(PokemonType.ELECTRIC);
        break;
      case StatusEffect.SLEEP:
        isImmune = this.isGrounded() && globalScene.arena.terrainType === TerrainType.ELECTRIC;
        reason = TerrainType.ELECTRIC;
        break;
      case StatusEffect.FREEZE: {
        const weatherType = globalScene.arena.weatherType;
        isImmune =
          this.isOfType(PokemonType.ICE)
          || (!ignoreField && (weatherType === WeatherType.SUNNY || weatherType === WeatherType.HARSH_SUN));
        break;
      }
      case StatusEffect.BURN:
        // ER Spectral Flame (er move 966) burns "including Fire types": its
        // status attr sets `ignoreTypeImmunity`, bypassing the Fire immunity
        // for this move ONLY. Every other burn source keeps the immunity.
        isImmune = !ignoreTypeImmunity && this.isOfType(PokemonType.FIRE);
        // ER Mycelium Might (510): a source ability can pierce the Fire-type burn
        // immunity (Will-O-Wisp vs Fire), mirroring the Poison/Toxic Corrosion
        // hook above. Only fires if the applier carries the matching bypass.
        if (isImmune && sourcePokemon) {
          const cancelImmunity = new BooleanHolder(false);
          applyAbAttrs("IgnoreTypeStatusEffectImmunityAbAttr", {
            pokemon: sourcePokemon,
            cancelled: cancelImmunity,
            statusEffect: effect,
            defenderType: PokemonType.FIRE,
            moveCategory: sourceMoveCategory ?? undefined,
          });
          if (cancelImmunity.value) {
            isImmune = false;
          }
        }
        break;
    }

    if (isImmune) {
      this.queueStatusImmuneMessage(quiet, reason);
      return false;
    }

    // Check for cancellations from self/ally abilities
    const cancelled = new BooleanHolder(false);
    applyAbAttrs("StatusEffectImmunityAbAttr", { pokemon: this, effect, cancelled, simulated: quiet });
    if (cancelled.value) {
      return false;
    }

    for (const pokemon of this.getAlliesGenerator()) {
      applyAbAttrs("UserFieldStatusEffectImmunityAbAttr", {
        pokemon,
        effect,
        cancelled,
        simulated: quiet,
        target: this,
        source: sourcePokemon,
      });
      if (cancelled.value) {
        return false;
      }
    }

    // Perform safeguard checks
    if (sourcePokemon && sourcePokemon !== this && this.isSafeguarded(sourcePokemon)) {
      if (!quiet) {
        globalScene.phaseManager.queueMessage(
          i18next.t("moveTriggers:safeguard", { targetName: getPokemonNameWithAffix(this) }),
        );
      }
      return false;
    }

    return true;
  }

  /**
   * Attempt to set this Pokemon's status to the specified condition.
   * Enqueues a new `ObtainStatusEffectPhase` to trigger animations, etc.
   * @param effect - The {@linkcode StatusEffect} to set
   * @param sourcePokemon - The {@linkcode Pokemon} applying the status effect to the target,
   * or `null` if the status is applied from a non-Pokemon source (hazards, etc.); default `null`
   * @param sleepTurnsRemaining - The number of turns to set {@linkcode StatusEffect.SLEEP} for;
   * defaults to a random number between 2 and 4 and is unused for non-Sleep statuses
   * @param sourceText - The text to show for the source of the status effect, if any; default `null`
   * @param overrideStatus - Whether to allow overriding the Pokemon's current status with a different one; default `false`
   * @param quiet - Whether to suppress in-battle messages for status checks; default `true`
   * @param overrideMessage - String containing text to be displayed upon status setting; defaults to normal key for status
   * and is used exclusively for Rest
   * @returns Whether the status effect phase was successfully created.
   * @see {@linkcode doSetStatus} - alternate function that sets status immediately (albeit without condition checks).
   */
  public trySetStatus(
    effect: StatusEffect,
    sourcePokemon?: Pokemon,
    sleepTurnsRemaining?: number,
    sourceText: string | null = null,
    overrideStatus?: boolean,
    quiet = true,
    overrideMessage?: string,
    ignoreTypeImmunity = false,
    // Category of the move applying the status (null for non-move sources).
    sourceMoveCategory: MoveCategory | null = null,
  ): boolean {
    // TODO: This needs to propagate failure status for status moves
    if (!effect) {
      return false;
    }

    // ER: the vanilla FREEZE status does not exist — it is replaced by Frostbite
    // (an ER battler tag). Any attempt to freeze a Pokemon (vanilla Ice moves,
    // abilities, etc.) instead inflicts ER_FROSTBITE, which carries its own
    // immunity rules (Ice-types, already-frostbitten) in the tag's canAdd. This
    // single intercept catches every freeze source so "FRZ" never appears.
    if (effect === StatusEffect.FREEZE) {
      return this.addTag(BattlerTagType.ER_FROSTBITE, 0, undefined, sourcePokemon?.id);
    }

    if (
      !this.canSetStatus(effect, quiet, overrideStatus, sourcePokemon, false, ignoreTypeImmunity, sourceMoveCategory)
    ) {
      return false;
    }
    if (this.isFainted() && effect !== StatusEffect.FAINT) {
      return false;
    }

    // ER Ward Stones (#358): a charged stone instantly blocks any EXTERNALLY
    // inflicted status before it lands (not retroactive like a Lum Berry).
    // Self-inflicted statuses (Rest, recoil statuses) are exempt.
    if (
      effect !== StatusEffect.FAINT
      && sourcePokemon !== this
      && applyErWardStoneBlock(this, erWardStoneStatusLabel(effect))
    ) {
      return false;
    }

    /** If this Pokemon falls asleep in the middle of a multi-hit attack, cancel its subsequent hits. */
    // FREEZE returns above after being translated to Frostbite, so it cannot reach this branch.
    if (effect === StatusEffect.SLEEP) {
      const currentPhase = globalScene.phaseManager.getCurrentPhase();
      if (currentPhase.is("MoveEffectPhase") && currentPhase.getUserPokemon() === this) {
        this.turnData.hitCount = 1;
        this.turnData.hitsLeft = 1;
      }
    }

    if (overrideStatus) {
      this.resetStatus(false);
    } else {
      this.turnData.pendingStatus = effect;
    }

    globalScene.phaseManager.unshiftNew(
      "ObtainStatusEffectPhase",
      this.getBattlerIndex(),
      effect,
      sourcePokemon,
      sleepTurnsRemaining,
      sourceText,
      overrideMessage,
    );

    return true;
  }

  /**
   * Set this Pokemon's {@linkcode status | non-volatile status condition} to the specified effect.
   * @param effect - The {@linkcode StatusEffect} to set
   * @remarks
   * Clears this pokemon's `pendingStatus` in its {@linkcode Pokemon.turnData | turnData}.
   *
   * ⚠️ This method does **not** check for feasibility; that is the responsibility of the caller.
   */
  public doSetStatus(effect: Exclude<StatusEffect, StatusEffect.SLEEP>): void;
  /**
   * Set this Pokemon's {@linkcode status | non-volatile status condition} to the specified effect.
   * @param effect - {@linkcode StatusEffect.SLEEP}
   * @param sleepTurnsRemaining - The number of turns to inflict sleep for; defaults to a random number between 2 and 4
   * @remarks
   * Clears this pokemon's `pendingStatus` in its {@linkcode Pokemon#turnData}.
   *
   * ⚠️ This method does **not** check for feasibility; that is the responsibility of the caller.
   */
  public doSetStatus(effect: StatusEffect.SLEEP, sleepTurnsRemaining?: number): void;
  /**
   * Set this Pokemon's {@linkcode status | non-volatile status condition} to the specified effect.
   * @param effect - The {@linkcode StatusEffect} to set
   * @param sleepTurnsRemaining - The number of turns to inflict sleep for; defaults to a random number between 2 and 4
   * and is unused for all non-sleep Statuses
   * @remarks
   * Clears this pokemon's `pendingStatus` in its {@linkcode Pokemon#turnData}.
   *
   * ⚠️ This method does **not** check for feasibility; that is the responsibility of the caller.
   */
  public doSetStatus(effect: StatusEffect, sleepTurnsRemaining?: number): void;
  /**
   * Set this Pokemon's {@linkcode status | non-volatile status condition} to the specified effect.
   * @param effect - The {@linkcode StatusEffect} to set
   * @param sleepTurnsRemaining - The number of turns to inflict sleep for; defaults to a random number between 2 and 4
   * and is unused for all non-sleep Statuses
   * @remarks
   * Clears this pokemon's `pendingStatus` in its {@linkcode Pokemon#turnData}.
   *
   * ⚠️ This method does **not** check for feasibility; that is the responsibility of the caller.
   * @todo Make this and all related fields private and change tests to use a field-based helper or similar
   */
  public doSetStatus(
    effect: StatusEffect,
    sleepTurnsRemaining = effect === StatusEffect.SLEEP ? this.randBattleSeedIntRange(2, 4) : 0,
  ): void {
    // Reset any pending status
    this.turnData.pendingStatus = StatusEffect.NONE;
    switch (effect) {
      case StatusEffect.POISON:
      case StatusEffect.TOXIC:
        this.setFrameRate(8);
        break;
      case StatusEffect.PARALYSIS:
        this.setFrameRate(5);
        break;
      case StatusEffect.SLEEP: {
        this.setFrameRate(3);

        // ER Fairy Cave blessing (#439 §3 Group F): status conditions wear off a
        // turn faster - sleep lasts one fewer turn (min 1).
        if (getErBiomeRule(globalScene.arena.biomeId)?.fairyBlessing) {
          sleepTurnsRemaining = Math.max(1, sleepTurnsRemaining - 1);
        }

        // If the user is semi-invulnerable when put asleep (such as due to Yawm),
        // remove their invulnerability and cancel the upcoming move from the queue
        const invulnTagTypes = [
          BattlerTagType.FLYING,
          BattlerTagType.UNDERGROUND,
          BattlerTagType.UNDERWATER,
          BattlerTagType.HIDDEN,
        ];

        if (this.findTag(t => invulnTagTypes.includes(t.tagType))) {
          this.findAndRemoveTags(t => invulnTagTypes.includes(t.tagType));
          this.getMoveQueue().shift();
        }
        break;
      }
      case StatusEffect.FREEZE:
        this.setFrameRate(0);
        break;
      case StatusEffect.BURN:
        this.setFrameRate(14);
        break;
      case StatusEffect.FAINT:
        break;
      default:
        effect satisfies StatusEffect.NONE;
        break;
    }

    this.status = new Status(effect, 0, sleepTurnsRemaining);
    erRecordAchievementStatusSet(this, effect);
  }

  /**
   * Helper function for the Move phase that queues the status cure message,
   * resets it, and updates the info display.
   * @param effect - The effect to cure. If this does not match the current status, nothing happens.
   * @param msg - If provided, will override the default message displayed when removing status.
   * Used for moves that thaw the user out
   */
  // TODO: Distinguish this more from `resetStatus`
  public cureStatus(effect: StatusEffect, msg = getStatusEffectHealText(effect, getPokemonNameWithAffix(this))): void {
    if (effect !== this.status?.effect) {
      return;
    }

    globalScene.phaseManager.queueMessage(msg);
    // cannot use `asPhase=true` as it will cause status to be reset _after_ the move phase ends
    this.resetStatus(undefined, undefined, undefined, false);
    this.updateInfo();
  }

  /**
   * Reset this Pokémon's status
   * @param revive - Whether revive should be cured; default `true`
   * @param confusion - Whether to also cure confusion; default `false`
   * @param reloadAssets - Whether to reload the assets or not; default `false`
   * @param asPhase - Whether to reset the status in a phase or immediately; default `true`
   */
  resetStatus(revive = true, confusion = false, reloadAssets = false, asPhase = true): void {
    const lastStatus = this.status?.effect;
    if (!revive && lastStatus === StatusEffect.FAINT) {
      return;
    }

    if (asPhase) {
      globalScene.phaseManager.unshiftNew("ResetStatusPhase", this, confusion, reloadAssets);
    } else {
      this.clearStatus(confusion, reloadAssets);
    }
  }

  /**
   * Perform the action of clearing a Pokemon's status
   * @remarks
   * This is a helper to {@linkcode resetStatus}, which should be called directly instead of this method
   * @param confusion - Whether to also clear this Pokémon's confusion
   * @param reloadAssets - Whether to reload this pokemon's assets
   */
  public clearStatus(confusion: boolean, reloadAssets: boolean) {
    const lastStatus = this.status?.effect;
    this.status = null;
    this.setFrameRate(10);
    if (lastStatus === StatusEffect.SLEEP && this.getTag(BattlerTagType.NIGHTMARE)) {
      this.lapseTag(BattlerTagType.NIGHTMARE);
    }
    if (confusion && this.getTag(BattlerTagType.CONFUSED)) {
      this.lapseTag(BattlerTagType.CONFUSED);
    }
    if (reloadAssets) {
      this.loadAssets(false).then(() => this.playAnim());
    }
    this.updateInfo(true);
  }

  /**
   * Check if this Pokémon is protected by Safeguard
   * @param attacker - The Pokémon responsible for the interaction that needs to check against Safeguard
   * @returns Whether this Pokémon is protected by Safeguard
   */
  public isSafeguarded(attacker: Pokemon): boolean {
    const defendingSide = this.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    if (globalScene.arena.getTagOnSide(ArenaTagType.SAFEGUARD, defendingSide)) {
      const bypassed = new BooleanHolder(false);
      if (attacker) {
        applyAbAttrs("InfiltratorAbAttr", { pokemon: attacker, bypassed });
      }
      return !bypassed.value;
    }
    return false;
  }

  /**
   * Perform miscellaneous setup for when the Pokemon is summoned, like generating the substitute sprite
   * @param resetSummonData - Whether to additionally reset the Pokemon's summon data (default: `false`)
   */
  public fieldSetup(resetSummonData?: boolean): void {
    this.switchOutStatus = false;
    if (globalScene) {
      globalScene.triggerPokemonFormChange(this, SpeciesFormChangePostMoveTrigger, true);
    }
    // If this Pokemon has a Substitute when loading in, play an animation to add its sprite
    if (this.getTag(SubstituteTag)) {
      globalScene.triggerPokemonBattleAnim(this, PokemonAnimType.SUBSTITUTE_ADD);
      this.getTag(SubstituteTag)!.sourceInFocus = false;
    }

    // If this Pokemon has Commander and Dondozo as an active ally, hide this Pokemon's sprite.
    if (
      this.hasAbilityWithAttr("CommanderAbAttr")
      && globalScene.currentBattle.double
      && this.getAlly()?.species.speciesId === SpeciesId.DONDOZO
    ) {
      this.setVisible(false);
    }

    if (resetSummonData) {
      this.resetSummonData();
    }
  }

  /**
   * Reset this Pokemon's {@linkcode PokemonSummonData | SummonData} and {@linkcode PokemonTempSummonData | TempSummonData}
   * in preparation for switching pokemon, as well as removing any relevant on-switch tags.
   */
  public resetSummonData(): void {
    if (this.summonData.speciesForm) {
      this.summonData.speciesForm = null;
      this.updateFusionPalette();
    }
    // ER BLEED behaves like a non-volatile status: it must SURVIVE a switch-out.
    // resetSummonData() rebuilds summonData from scratch (clearing all volatile
    // tags), which would otherwise wipe the bleed - so carry an active bleed onto
    // the fresh summonData, the way vanilla status (which lives outside summonData)
    // persists. A fainted mon keeps no status, so only carry it while alive.
    const bleedTag = this.isFainted() ? undefined : this.getTag(BattlerTagType.ER_BLEED);
    this.summonData = new PokemonSummonData();
    this.tempSummonData = new PokemonTempSummonData();
    if (bleedTag) {
      this.summonData.tags.push(bleedTag);
    }
    this.updateInfo();
  }

  /**
   * Reset this Pokémon's per-battle {@linkcode PokemonBattleData | battleData}
   * as well as any transient {@linkcode PokemonWaveData | waveData} for the current wave.
   *
   * @remarks
   * Should be called once per arena transition (new biome/trainer battle/Mystery Encounter).
   */
  public resetBattleAndWaveData(): void {
    this.battleData = new PokemonBattleData();
    this.resetWaveData();
  }

  /**
   * Reset this Pokémon's {@linkcode PokemonWaveData | waveData}
   *
   * @remarks
   * Should be called upon starting a new wave in addition to whenever an arena transition occurs.
   * @see {@linkcode resetBattleAndWaveData}
   */
  resetWaveData(): void {
    this.waveData = new PokemonWaveData();
    this.tempSummonData.waveTurnCount = 1;
  }

  /**
   * Reset this Pokémon's Terastallization state
   *
   * @remarks
   * Responsible for all of the cleanup required when a pokemon goes from being
   * terastallized to no longer terastallized:
   * - Resetting stellar type boosts
   * - Updating the Pokémon's terastallization-dependent form
   * - Adjusting the sprite pipeline to remove the Tera effect
   */
  resetTera(): void {
    const wasTerastallized = this.isTerastallized;
    this.isTerastallized = false;
    this.stellarTypesBoosted = [];
    if (wasTerastallized) {
      this.updateSpritePipelineData();
      globalScene.triggerPokemonFormChange(this, SpeciesFormChangeLapseTeraTrigger);
    }
  }

  /**
   * Clear this Pokémon's transient turn data
   */
  resetTurnData(): void {
    this.turnData = new PokemonTurnData();
  }

  getExpValue(): number {
    // Logic to factor in victor level has been removed for balancing purposes, so the player doesn't have to focus on EXP maxxing
    return (this.getSpeciesForm().getBaseExp() * this.level) / 5 + 1;
  }

  //#region Sprite and Animation Methods
  setFrameRate(frameRate: number) {
    // `anims.get` returns undefined when the sprite's animation isn't registered
    // (e.g. the HEADLESS test environment) — guard the assignment so applying a
    // status (which sets a status-specific frame rate) doesn't crash there.
    const anim = globalScene.anims.get(this.getBattleSpriteKey());
    if (anim) {
      anim.frameRate = frameRate;
    }
    // Bench and freshly reconstructed authoritative mons may not have presentation children yet.
    // A status/frame-rate update is still mechanically valid there; animation begins after init/load.
    const sprite = this.getSprite();
    if (sprite != null) {
      try {
        sprite.play(this.getBattleSpriteKey());
      } catch (err: unknown) {
        console.error(`Failed to play animation for ${this.getBattleSpriteKey()}`, err);
      }
    }
    const tintSprite = this.getTintSprite();
    if (tintSprite != null) {
      try {
        tintSprite.play(this.getBattleSpriteKey());
      } catch (err: unknown) {
        console.error(`Failed to play animation for ${this.getBattleSpriteKey()}`, err);
      }
    }
  }

  tint(color: number, alpha?: number, duration?: number, ease?: string) {
    const tintSprite = this.getTintSprite();
    tintSprite?.setTintFill(color);
    tintSprite?.setVisible(true);

    if (duration) {
      tintSprite?.setAlpha(0);

      globalScene.tweens.add({
        targets: tintSprite,
        alpha: alpha || 1,
        duration,
        ease: ease || "Linear",
      });
    } else {
      tintSprite?.setAlpha(alpha);
    }
  }

  untint(duration: number, ease?: string) {
    const tintSprite = this.getTintSprite();

    if (duration) {
      globalScene.tweens.add({
        targets: tintSprite,
        alpha: 0,
        duration,
        ease: ease || "Linear",
        onComplete: () => {
          tintSprite?.setVisible(false);
          tintSprite?.setAlpha(1);
        },
      });
    } else {
      tintSprite?.setVisible(false);
      tintSprite?.setAlpha(1);
    }
  }

  enableMask() {
    if (!this.maskEnabled) {
      this.maskSprite = this.getTintSprite();
      this.maskSprite?.setVisible(true);
      this.maskSprite?.setPosition(
        this.x * this.parentContainer.scale + this.parentContainer.x,
        this.y * this.parentContainer.scale + this.parentContainer.y,
      );
      this.maskSprite?.setScale(this.getSpriteScale() * this.parentContainer.scale);
      this.maskEnabled = true;
    }
  }

  disableMask() {
    if (this.maskEnabled) {
      this.maskSprite?.setVisible(false);
      this.maskSprite?.setPosition(0, 0);
      this.maskSprite?.setScale(this.getSpriteScale());
      this.maskSprite = null;
      this.maskEnabled = false;
    }
  }

  /** Play the shiny sparkle animation and effects, if applicable */
  sparkle(): void {
    if (this.shinySparkle) {
      // ER Black Shinies (#349): the t4 summon sparkle FX is BLACK, not the
      // epic-red variant-2 effect.
      if (isErBlackShiny(this)) {
        this.shinySparkle.setTintFill(0x111016);
      } else {
        this.shinySparkle.clearTint();
      }
      globalScene.animations.doShinySparkleAnim(this.shinySparkle, this.variant);
    }
  }

  updateFusionPalette(ignoreOverride?: boolean): void {
    if (!this.getFusionSpeciesForm(ignoreOverride)) {
      [this.getSprite(), this.getTintSprite()]
        .filter(s => !!s)
        .map(s => {
          s.pipelineData[`spriteColors${ignoreOverride && this.summonData.speciesForm ? "Base" : ""}`] = [];
          s.pipelineData[`fusionSpriteColors${ignoreOverride && this.summonData.speciesForm ? "Base" : ""}`] = [];
        });
      return;
    }

    const speciesForm = this.getSpeciesForm(ignoreOverride);
    const fusionSpeciesForm = this.getFusionSpeciesForm(ignoreOverride);

    const spriteKey = speciesForm.getSpriteKey(
      this.getGender(ignoreOverride) === Gender.FEMALE,
      speciesForm.formIndex,
      this.shiny,
      this.variant,
    );
    const backSpriteKey = speciesForm
      .getSpriteKey(this.getGender(ignoreOverride) === Gender.FEMALE, speciesForm.formIndex, this.shiny, this.variant)
      .replace("pkmn__", "pkmn__back__");
    const fusionSpriteKey = fusionSpeciesForm.getSpriteKey(
      this.getFusionGender(ignoreOverride) === Gender.FEMALE,
      fusionSpeciesForm.formIndex,
      this.fusionShiny,
      this.fusionVariant,
    );
    const fusionBackSpriteKey = fusionSpeciesForm
      .getSpriteKey(
        this.getFusionGender(ignoreOverride) === Gender.FEMALE,
        fusionSpeciesForm.formIndex,
        this.fusionShiny,
        this.fusionVariant,
      )
      .replace("pkmn__", "pkmn__back__");

    const sourceTexture = globalScene.textures.get(spriteKey);
    const sourceBackTexture = globalScene.textures.get(backSpriteKey);
    const fusionTexture = globalScene.textures.get(fusionSpriteKey);
    const fusionBackTexture = globalScene.textures.get(fusionBackSpriteKey);

    const [sourceFrame, sourceBackFrame, fusionFrame, fusionBackFrame] = [
      sourceTexture,
      sourceBackTexture,
      fusionTexture,
      fusionBackTexture,
    ].map(texture => texture.frames[texture.firstFrame]);
    const [sourceImage, sourceBackImage, fusionImage, fusionBackImage] = [
      sourceTexture,
      sourceBackTexture,
      fusionTexture,
      fusionBackTexture,
    ].map(i => i.getSourceImage() as HTMLImageElement);

    // Defensive: when a (newly evolved) fusion's front/back/fusion atlas has not
    // finished loading - or 404'd (an ER-custom evolved-fusion form whose sprite is
    // absent on the CDN) - Phaser hands back the `__MISSING` placeholder whose frame
    // or source image is missing. Reading `frame.width` below then THROWS; that
    // rejects `loadAssets`, which the evolution flow awaits with no catch, so the
    // evolution scene hangs forever on a black screen (the Rare-Candy-on-a-fused-mon
    // crash). Bail gracefully instead: the sprite keeps its existing colours and the
    // palette rebuilds on the next refresh once the atlas is present.
    if (
      [sourceTexture, sourceBackTexture, fusionTexture, fusionBackTexture].some(t => t.key === "__MISSING")
      || [sourceFrame, sourceBackFrame, fusionFrame, fusionBackFrame].some(frame => !frame?.width || !frame?.height)
      || [sourceImage, sourceBackImage, fusionImage, fusionBackImage].some(img => !img)
    ) {
      console.warn("updateFusionPalette: a sprite texture/frame is not loaded yet; skipping fusion palette build");
      return;
    }

    const canvas = document.createElement("canvas");
    const backCanvas = document.createElement("canvas");
    const fusionCanvas = document.createElement("canvas");
    const fusionBackCanvas = document.createElement("canvas");

    const spriteColors: number[][] = [];
    const pixelData: Uint8ClampedArray[] = [];

    [canvas, backCanvas, fusionCanvas, fusionBackCanvas].forEach((canv: HTMLCanvasElement, c: number) => {
      const context = canv.getContext("2d");
      const frame = [sourceFrame, sourceBackFrame, fusionFrame, fusionBackFrame][c];
      canv.width = frame.width;
      canv.height = frame.height;

      if (context) {
        context.drawImage(
          [sourceImage, sourceBackImage, fusionImage, fusionBackImage][c],
          frame.cutX,
          frame.cutY,
          frame.width,
          frame.height,
          0,
          0,
          frame.width,
          frame.height,
        );
        const imageData = context.getImageData(frame.cutX, frame.cutY, frame.width, frame.height);
        pixelData.push(imageData.data);
      }
    });

    for (let f = 0; f < 2; f++) {
      const variantColors = variantColorCache[f ? backSpriteKey : spriteKey];
      const variantColorSet = new Map<number, number[]>();
      if (this.shiny && variantColors && variantColors[this.variant]) {
        Object.keys(variantColors[this.variant]).forEach(k => {
          variantColorSet.set(
            rgbaToInt(Array.from(Object.values(rgbHexToRgba(k)))),
            Array.from(Object.values(rgbHexToRgba(variantColors[this.variant][k]))),
          );
        });
      }

      for (let i = 0; i < pixelData[f].length; i += 4) {
        if (pixelData[f][i + 3]) {
          const pixel = pixelData[f].slice(i, i + 4);
          let [r, g, b, a] = pixel;
          if (variantColors) {
            const color = rgbaToInt([r, g, b, a]);
            if (variantColorSet.has(color)) {
              const mappedPixel = variantColorSet.get(color);
              if (mappedPixel) {
                [r, g, b, a] = mappedPixel;
              }
            }
          }
          if (!spriteColors.find(c => c[0] === r && c[1] === g && c[2] === b)) {
            spriteColors.push([r, g, b, a]);
          }
        }
      }
    }

    const fusionSpriteColors = JSON.parse(JSON.stringify(spriteColors));

    const pixelColors: number[] = [];
    for (let f = 0; f < 2; f++) {
      for (let i = 0; i < pixelData[f].length; i += 4) {
        const total = pixelData[f].slice(i, i + 3).reduce((total: number, value: number) => total + value, 0);
        if (!total) {
          continue;
        }
        pixelColors.push(
          argbFromRgba({
            r: pixelData[f][i],
            g: pixelData[f][i + 1],
            b: pixelData[f][i + 2],
            a: pixelData[f][i + 3],
          }),
        );
      }
    }

    const fusionPixelColors: number[] = [];
    for (let f = 0; f < 2; f++) {
      const variantColors = variantColorCache[f ? fusionBackSpriteKey : fusionSpriteKey];
      const variantColorSet = new Map<number, number[]>();
      if (this.fusionShiny && variantColors && variantColors[this.fusionVariant]) {
        for (const k of Object.keys(variantColors[this.fusionVariant])) {
          variantColorSet.set(
            rgbaToInt(Array.from(Object.values(rgbHexToRgba(k)))),
            Array.from(Object.values(rgbHexToRgba(variantColors[this.fusionVariant][k]))),
          );
        }
      }
      for (let i = 0; i < pixelData[2 + f].length; i += 4) {
        const total = pixelData[2 + f].slice(i, i + 3).reduce((total: number, value: number) => total + value, 0);
        if (!total) {
          continue;
        }
        let [r, g, b, a] = [
          pixelData[2 + f][i],
          pixelData[2 + f][i + 1],
          pixelData[2 + f][i + 2],
          pixelData[2 + f][i + 3],
        ];
        if (variantColors) {
          const color = rgbaToInt([r, g, b, a]);
          if (variantColorSet.has(color)) {
            const mappedPixel = variantColorSet.get(color);
            if (mappedPixel) {
              [r, g, b, a] = mappedPixel;
            }
          }
        }
        fusionPixelColors.push(argbFromRgba({ r, g, b, a }));
      }
    }

    if (fusionPixelColors.length === 0) {
      // ERROR HANDLING IS NOT OPTIONAL BUDDY
      console.log("Failed to create fusion palette");
      return;
    }

    let paletteColors: Map<number, number>;
    let fusionPaletteColors: Map<number, number>;

    const originalRandom = Math.random;
    Math.random = () => randSeedFloat();

    globalScene.executeWithSeedOffset(
      () => {
        paletteColors = QuantizerCelebi.quantize(pixelColors, 4);
        fusionPaletteColors = QuantizerCelebi.quantize(fusionPixelColors, 4);
      },
      0,
      "This result should not vary",
    );

    Math.random = originalRandom;

    paletteColors = paletteColors!; // erroneously tell TS compiler that paletteColors is defined!
    fusionPaletteColors = fusionPaletteColors!; // mischievously misinform TS compiler that fusionPaletteColors is defined!
    const [palette, fusionPalette] = [paletteColors, fusionPaletteColors].map(paletteColors => {
      let keys = Array.from(paletteColors.keys()).sort((a: number, b: number) =>
        paletteColors.get(a)! < paletteColors.get(b)! ? 1 : -1,
      );
      let rgbaColors: Map<number, number[]>;
      let hsvColors: Map<number, number[]>;

      const mappedColors = new Map<number, number[]>();

      do {
        mappedColors.clear();

        rgbaColors = keys.reduce((map: Map<number, number[]>, k: number) => {
          map.set(k, Object.values(rgbaFromArgb(k)));
          return map;
        }, new Map<number, number[]>());
        hsvColors = Array.from(rgbaColors.keys()).reduce((map: Map<number, number[]>, k: number) => {
          const rgb = rgbaColors.get(k)!.slice(0, 3);
          map.set(k, rgbToHsv(rgb[0], rgb[1], rgb[2]));
          return map;
        }, new Map<number, number[]>());

        for (let c = keys.length - 1; c >= 0; c--) {
          const hsv = hsvColors.get(keys[c])!;
          for (let c2 = 0; c2 < c; c2++) {
            const hsv2 = hsvColors.get(keys[c2])!;
            const diff = Math.abs(hsv[0] - hsv2[0]);
            if (diff < 30 || diff >= 330) {
              if (mappedColors.has(keys[c])) {
                mappedColors.get(keys[c])!.push(keys[c2]);
              } else {
                mappedColors.set(keys[c], [keys[c2]]);
              }
              break;
            }
          }
        }

        mappedColors.forEach((values: number[], key: number) => {
          const keyColor = rgbaColors.get(key)!;
          const valueColors = values.map(v => rgbaColors.get(v)!);
          const color = keyColor.slice(0);
          let count = paletteColors.get(key)!;
          for (const value of values) {
            const valueCount = paletteColors.get(value);
            if (!valueCount) {
              continue;
            }
            count += valueCount;
          }

          for (let c = 0; c < 3; c++) {
            color[c] *= paletteColors.get(key)! / count;
            values.forEach((value: number, i: number) => {
              if (paletteColors.has(value)) {
                const valueCount = paletteColors.get(value)!;
                color[c] += valueColors[i][c] * (valueCount / count);
              }
            });
            color[c] = Math.round(color[c]);
          }

          paletteColors.delete(key);
          for (const value of values) {
            paletteColors.delete(value);
            if (mappedColors.has(value)) {
              mappedColors.delete(value);
            }
          }

          paletteColors.set(
            argbFromRgba({
              r: color[0],
              g: color[1],
              b: color[2],
              a: color[3],
            }),
            count,
          );
        });

        keys = Array.from(paletteColors.keys()).sort((a: number, b: number) =>
          paletteColors.get(a)! < paletteColors.get(b)! ? 1 : -1,
        );
      } while (mappedColors.size > 0);

      return keys.map(c => Object.values(rgbaFromArgb(c)));
    });

    const paletteDeltas: number[][] = [];

    spriteColors.forEach((sc: number[], i: number) => {
      paletteDeltas.push([]);
      for (const p of palette) {
        paletteDeltas[i].push(deltaRgb(sc, p));
      }
    });

    const easeFunc = Phaser.Tweens.Builders.GetEaseFunction("Cubic.easeIn");

    for (let sc = 0; sc < spriteColors.length; sc++) {
      const delta = Math.min(...paletteDeltas[sc]);
      const paletteIndex = Math.min(paletteDeltas[sc].indexOf(delta), fusionPalette.length - 1);
      if (delta < 255) {
        const ratio = easeFunc(delta / 255);
        const color = [0, 0, 0, fusionSpriteColors[sc][3]];
        for (let c = 0; c < 3; c++) {
          color[c] = Math.round(fusionSpriteColors[sc][c] * ratio + fusionPalette[paletteIndex][c] * (1 - ratio));
        }
        fusionSpriteColors[sc] = color;
      }
    }

    [this.getSprite(), this.getTintSprite()]
      .filter(s => !!s)
      .forEach(s => {
        s.pipelineData[`spriteColors${ignoreOverride && this.summonData.speciesForm ? "Base" : ""}`] = spriteColors;
        s.pipelineData[`fusionSpriteColors${ignoreOverride && this.summonData.speciesForm ? "Base" : ""}`] =
          fusionSpriteColors;
      });

    canvas.remove();
    fusionCanvas.remove();
  }

  //#endregion Sprite and Animation Methods

  /**
   * Generate a random number using the current battle's seed, or the global seed if `globalScene.currentBattle` is falsy
   * @param range - How large of a range of random numbers to choose from.
   * @param min - (Default `0`) The minimum integer to pick
   * @returns A random integer between `min` and `min + range - 1`
   * @remarks If `range <= 1`, this returns `min`
   * @privateRemarks
   * This calls either {@linkcode BattleScene.randBattleSeedInt}
   * which calls {@linkcode Battle.randSeedInt}
   * which calls {@linkcode randSeedInt}, \
   * or it directly calls {@linkcode randSeedInt} if there is no current battle.
   */
  randBattleSeedInt(range: number, min = 0): number {
    return globalScene.currentBattle ? globalScene.randBattleSeedInt(range, min) : randSeedInt(range, min);
  }

  /**
   * Generate a random number within the specified range
   * @param min - The minimum integer to generate
   * @param max - The maximum integer to generate
   * @returns A random integer between `min` and `max` (inclusive)
   */
  randBattleSeedIntRange(min: number, max: number): number {
    return this.randBattleSeedInt(max - min + 1, min);
  }

  /**
   * Causes a Pokemon to leave the field (such as in preparation for a switch out/escape).
   * @param clearEffects - Whether effects should be cleared, or passed to the next pokemon (e.g. due to Baton Pass)
   * @param hideInfo - Indicates if this should also play the animation to hide the Pokemon's info container
   */
  leaveField(clearEffects = true, hideInfo = true, destroy = false) {
    this.resetSprite();
    this.resetTurnData();
    for (const p of inSpeedOrder(ArenaTagSide.BOTH)) {
      if (p !== this) {
        p.removeTagsBySourceId(this.id);
      }
    }

    if (clearEffects) {
      this.destroySubstitute();
      this.resetSummonData();
    }
    if (hideInfo) {
      this.hideInfo();
    }
    // Trigger abilities that activate upon leaving the field
    applyAbAttrs("PreLeaveFieldAbAttr", { pokemon: this });
    // ER Fault Current (5926): reset the consecutive-active-turn counter on exit.
    erFaultCurrentOnLeaveField(this);
    // ER Bad Splice (5932): when the holder leaves, restore each opponent's exact
    // prior typing by un-grafting only the types Bad Splice added.
    erBadSpliceOnLeaveField(this);
    // ER Omniform (5929): revert an adaptive-transform holder to its pre-battle
    // species/form + stats (summonData was already reset above).
    erOmniformRevertOnLeaveField(this);
    // ER Shattered Psyche (5968): when a fused entity leaves the field, split its
    // HP back proportionally, restore its own max HP, and clear the blended look.
    erShatteredPsycheOnLeaveField(this);
    this.switchOutStatus = true;
    globalScene.triggerPokemonFormChange(this, SpeciesFormChangeActiveTrigger, true);
    globalScene.field.remove(this, destroy);
  }

  /**
   * @inheritdoc {@linkcode Phaser.GameObjects.Container#destroy}
   *
   * ### Custom Behavior
   * In addition to the base `destroy` behavior, this also destroys the Pokemon's
   * {@linkcode battleInfo} and substitute sprite (as applicable).
   */
  destroy(): void {
    this.stopErShinyLabBattleFxTimer();
    this.erShinyLabFxOverlay?.destroy();
    this.erShinyLabFxOverlay = null;
    this.battleInfo?.destroy();
    this.destroySubstitute();
    super.destroy();
  }

  // TODO: Turn this into a getter
  getBattleInfo(): BattleInfo {
    return this.battleInfo;
  }

  /**
   * Check whether or not this Pokémon's root form has the same ability
   * @param abilityIndex - The ability index to check
   * @returns Whether the Pokemon's root form has the same ability
   */
  private hasSameAbilityInRootForm(abilityIndex: number): boolean {
    const currentAbilityIndex = this.abilityIndex;
    const rootForm = getPokemonSpecies(this.species.getRootSpeciesId());
    return rootForm.getAbility(abilityIndex) === rootForm.getAbility(currentAbilityIndex);
  }

  /**
   * Helper function to check if the player already owns the starter data of this Pokémon's
   * current ability
   * @param ownedAbilityAttrs - The owned abilityAttr of this Pokemon's root form
   * @returns true if the player already has it, false otherwise
   */
  checkIfPlayerHasAbilityOfStarter(ownedAbilityAttrs: number): boolean {
    if ((ownedAbilityAttrs & 1) > 0 && this.hasSameAbilityInRootForm(0)) {
      return true;
    }
    if ((ownedAbilityAttrs & 2) > 0 && this.hasSameAbilityInRootForm(1)) {
      return true;
    }
    return (ownedAbilityAttrs & 4) > 0 && this.hasSameAbilityInRootForm(2);
  }

  /**
   * Reduces one of this Pokemon's held item stacks by 1, removing it if applicable.
   * Does nothing if this Pokemon is somehow not the owner of the held item.
   * @param heldItem - The item stack to be reduced.
   * @param forBattle - Whether to trigger in-battle effects (such as Unburden) after losing the item. Default: `true`
   * Should be `false` for all item loss occurring outside of battle (MEs, etc.).
   * @returns Whether the item was removed successfully.
   */
  public loseHeldItem(heldItem: PokemonHeldItemModifier, forBattle = true): boolean {
    // TODO: What does a -1 pokemon id mean?
    if (heldItem.pokemonId !== -1 && heldItem.pokemonId !== this.id) {
      return false;
    }

    heldItem.stackCount--;
    if (heldItem.stackCount <= 0) {
      globalScene.removeModifier(heldItem, this.isEnemy());
    }
    if (forBattle) {
      applyAbAttrs("PostItemLostAbAttr", { pokemon: this });
      // ER Fetch (er move 969) consumed-item ledger: record a NON-BERRY,
      // re-grantable held item that was just lost IN BATTLE (knocked off,
      // a consumed one-time item like White/Power Herb, etc.) so Fetch can
      // retrieve "its lost item". Berries are tracked separately in
      // `battleData.berriesEaten` (Harvest) and handled by Fetch's berry path;
      // gems shatter through their own path (er-elemental-gems) and record there.
      if (!(heldItem instanceof BerryModifier)) {
        const typeId = heldItem.type?.id;
        if (typeId) {
          this.battleData.lostItems.push({ typeId });
        }
      }
    }

    return true;
  }

  /**
   * Record a berry being eaten for ability and move triggers.
   * Only tracks things that proc _every_ time a berry is eaten.
   * @param berryType - The type of berry being eaten.
   * @param updateHarvest - Whether to track the berry for harvest; default `true`.
   */
  public recordEatenBerry(berryType: BerryType, updateHarvest = true) {
    this.battleData.hasEatenBerry = true;
    if (updateHarvest) {
      // Only track for harvest if we actually consumed the berry
      this.battleData.berriesEaten.push(berryType);
    }
    this.turnData.berriesEaten.push(berryType);
  }

  /**
   * Get the number of persistent treasure items this Pokemon has
   * @remarks
   * Persistent treasure items are defined as held items that give money
   * after battle, such as the Lucky Egg or the Amulet Coin.
   * Used exclusively for Gimmighoul's evolution condition
   * @returns The number of persistent treasure items this Pokémon has
   */
  getPersistentTreasureCount(): number {
    return (
      this.getHeldItems().filter(m => m.is("DamageMoneyRewardModifier")).length
      + globalScene.findModifiers(m => m.is("MoneyMultiplierModifier") || m.is("ExtraModifierModifier")).length
    );
  }
}

export class PlayerPokemon extends Pokemon {
  // Showdown versus-guest flip: the panel CLASS follows the presentation side (initBattleInfo),
  // so the base `battleInfo: BattleInfo` declaration is NOT narrowed here - either chrome fits.
  public compatibleTms: MoveId[];
  /**
   * Co-op ownership tag (#633, P1g): in co-op mode the single shared 6-slot party
   * is split between two players (up to 3 each). This records WHICH player owns
   * this mon, so the per-player 3-cap is enforced off a persistent tag (party
   * slots shift on add/remove, so slot index is unreliable). `undefined` for
   * every non-co-op mon, which leaves all other modes untouched.
   */
  public coopOwner?: CoopRole;

  constructor(
    species: PokemonSpecies,
    level: number,
    abilityIndex?: number,
    formIndex?: number,
    gender?: Gender,
    shiny?: boolean,
    variant?: Variant,
    ivs?: number[],
    nature?: Nature,
    dataSource?: Pokemon | PokemonData,
  ) {
    super(106, 148, species, level, abilityIndex, formIndex, gender, shiny, variant, ivs, nature, dataSource);

    if (Overrides.STATUS_OVERRIDE) {
      this.status = new Status(Overrides.STATUS_OVERRIDE, 0, 4);
    }

    if (Overrides.SHINY_OVERRIDE) {
      this.shiny = true;
      this.initShinySparkle();
    } else if (Overrides.SHINY_OVERRIDE === false) {
      this.shiny = false;
    }

    if (Overrides.VARIANT_OVERRIDE !== null && this.shiny) {
      this.variant = Overrides.VARIANT_OVERRIDE;
    }

    // ER (#349, dev suite): starters arrive with shiny EXPLICITLY set, which
    // skips the base constructor's upgrade roll - apply the forced black
    // override here so the black atlas is part of the initial load.
    if (!dataSource && Overrides.ER_BLACK_SHINY_PLAYER_OVERRIDE !== null) {
      maybeUpgradeToErBlackShiny(this);
    }

    if (!dataSource) {
      if (
        globalScene.gameMode.isDaily // Keldeo is excluded due to crashes involving its signature move and the associated form change
        || (Overrides.STARTER_SPECIES_OVERRIDE && Overrides.STARTER_SPECIES_OVERRIDE !== SpeciesId.KELDEO)
      ) {
        this.generateAndPopulateMoveset();
      } else {
        this.moveset = [];
      }
    }
    if (dataSource) {
      // Restore the co-op ownership tag (#633, P1g) from the save / source mon so
      // it survives a serialize -> deserialize round-trip and a clone-on-evolve.
      // Player-only field, so it is restored here rather than in the base ctor.
      const sourceOwner = (dataSource as { coopOwner?: CoopRole }).coopOwner;
      if (sourceOwner !== undefined) {
        this.coopOwner = sourceOwner;
      }
    }
    this.generateCompatibleTms();
  }

  initBattleInfo(): void {
    const info = new PlayerBattleInfo();
    this.battleInfo = info;
    info.initInfo(this);
  }

  override isPlayer(): this is PlayerPokemon {
    return true;
  }

  override isEnemy(): this is EnemyPokemon {
    return false;
  }

  override hasTrainer(): boolean {
    return true;
  }

  override isBoss(): boolean {
    return false;
  }

  getFieldIndex(): number {
    return globalScene.getPlayerField().indexOf(this);
  }

  getBattlerIndex(): BattlerIndex {
    return this.getFieldIndex();
  }

  generateCompatibleTms(): void {
    this.compatibleTms = [];

    const tms = Object.keys(tmSpecies);
    for (const tm of tms) {
      const moveId = Number.parseInt(tm) as MoveId;
      let compatible = false;
      for (const p of tmSpecies[tm]) {
        if (Array.isArray(p)) {
          const [pkm, form] = p;
          if (
            (pkm === this.species.speciesId || (this.fusionSpecies && pkm === this.fusionSpecies.speciesId))
            && form === this.getFormKey()
          ) {
            compatible = true;
            break;
          }
        } else if (p === this.species.speciesId || (this.fusionSpecies && p === this.fusionSpecies.speciesId)) {
          compatible = true;
          break;
        }
      }
      if (reverseCompatibleTms.indexOf(moveId) > -1) {
        compatible = !compatible;
      }
      if (compatible) {
        this.compatibleTms.push(moveId);
      }
    }
  }

  /**
   * ER TM Case: every move this Pokemon can still learn from a TM, i.e. its
   * COMPATIBLE TM moves ({@linkcode PlayerPokemon.compatibleTms}, the ER TM/tutor
   * compatibility list) minus any move already in its moveset. This is the list
   * the ER_TM_CASE_MODIFIER party-UI mode displays.
   */
  public getErTmCaseMoves(): MoveId[] {
    const seen = new Set<MoveId>();
    const out: MoveId[] = [];
    for (const m of this.compatibleTms) {
      if (m && !seen.has(m) && !this.moveset.some(pm => pm?.moveId === m)) {
        seen.add(m);
        out.push(m);
      }
    }
    return out;
  }

  /**
   * Cause this Pokémon to leave the field (via {@linkcode leaveField}) and then
   * open the party switcher UI to switch in a new Pokémon
   * @param switchType - The type of this switch-out. If this is
   * `BATON_PASS` or `SHED_TAIL`, this Pokémon's effects are not cleared upon leaving
   * the field.
   */
  switchOut(switchType: SwitchType = SwitchType.SWITCH): Promise<void> {
    return new Promise(resolve => {
      this.leaveField(switchType === SwitchType.SWITCH);

      globalScene.ui.setMode(
        UiMode.PARTY,
        PartyUiMode.FAINT_SWITCH,
        this.getFieldIndex(),
        (slotIndex: number, _option: PartyOption) => {
          if (slotIndex >= globalScene.currentBattle.getBattlerCount() && slotIndex < 6) {
            globalScene.phaseManager.queueDeferred(
              "SwitchSummonPhase",
              switchType,
              this.getFieldIndex(),
              slotIndex,
              false,
            );
          }
          globalScene.ui.setMode(UiMode.MESSAGE).then(resolve);
        },
        PartyUiHandler.FilterNonFainted,
      );
    });
  }
  /**
   * Add friendship to this Pokemon
   *
   * @remarks
   * This adds friendship to the pokemon's friendship stat (used for evolution, return, etc.) and candy progress. \
   * For fusions, candy progress for each species in the fusion is halved.
   *
   * @param friendship - The amount of friendship to add. Negative values will reduce friendship, though not below 0.
   * @param capped - (Default `false`) Whether the friendship gain should respect {@linkcode RARE_CANDY_FRIENDSHIP_CAP}.
   */
  public addFriendship(friendship: number, capped = false): void {
    // Short-circuit friendship loss, which doesn't impact candy friendship
    if (friendship <= 0) {
      this.friendship = Math.max(this.friendship + friendship, 0);
      return;
    }

    const { gameData, gameMode } = globalScene;

    const starterSpeciesId = this.species.getRootSpeciesId();
    const fusionStarterSpeciesId = this.isFusion() && this.fusionSpecies ? this.fusionSpecies.getRootSpeciesId() : 0;
    const starterGameData = gameData.starterData;
    const starterData: [StarterDataEntry, SpeciesId][] = [[starterGameData[starterSpeciesId], starterSpeciesId]];
    if (fusionStarterSpeciesId) {
      starterData.push([starterGameData[fusionStarterSpeciesId], fusionStarterSpeciesId]);
    }
    const amount = new NumberHolder(friendship);
    globalScene.applyModifier(PokemonFriendshipBoosterModifier, true, this, amount);
    friendship = amount.value;

    const newFriendship = this.friendship + friendship;
    /** If capped is true, don't allow friendship gain to exceed {@linkcode RARE_CANDY_FRIENDSHIP_CAP} */
    const finalFriendship =
      capped && newFriendship > RARE_CANDY_FRIENDSHIP_CAP
        ? Math.max(RARE_CANDY_FRIENDSHIP_CAP, this.friendship)
        : newFriendship;

    this.friendship = Math.min(finalFriendship, 255);
    if (this.friendship >= 255) {
      globalScene.validateAchv(achvs.MAX_FRIENDSHIP);
      awardRibbonsToSpeciesLine(this.species.speciesId, RibbonData.FRIENDSHIP);
    }

    let candyFriendshipMultiplier = gameMode.isClassic ? timedEventManager.getClassicFriendshipMultiplier() : 1;
    if (fusionStarterSpeciesId) {
      candyFriendshipMultiplier /= timedEventManager.areFusionsBoosted() ? 1.5 : 2;
    }
    const candyFriendshipAmount = Math.floor(friendship * candyFriendshipMultiplier);
    // Add to candy progress for this mon's starter species and its fused species (if it has one)
    starterData.forEach(([sd, id]: [StarterDataEntry, SpeciesId]) => {
      sd.friendship = (sd.friendship || 0) + candyFriendshipAmount;
      const friendshipCap = getStarterValueFriendshipCap(speciesStarterCosts[id]);
      if (sd.friendship >= friendshipCap) {
        const wasCandyIncremeted = gameData.addStarterCandy(id, Math.floor(sd.friendship / friendshipCap));
        if (wasCandyIncremeted) {
          sd.friendship %= friendshipCap;
        } else {
          sd.friendship = friendshipCap - 1;
        }
      }
    });
  }

  getPossibleEvolution(evolution: SpeciesFormEvolution | null): Promise<Pokemon> {
    if (!evolution) {
      return new Promise(resolve => resolve(this));
    }
    return new Promise(resolve => {
      const evolutionSpecies = getPokemonSpecies(evolution.speciesId);
      const isFusion = evolution instanceof FusionSpeciesFormEvolution;
      let ret: PlayerPokemon;
      if (isFusion) {
        const originalFusionSpecies = this.fusionSpecies;
        const originalFusionFormIndex = this.fusionFormIndex;
        this.fusionSpecies = evolutionSpecies;
        this.fusionFormIndex =
          evolution.evoFormKey === null
            ? this.fusionFormIndex
            : Math.max(
                evolutionSpecies.forms.findIndex(f => f.formKey === evolution.evoFormKey),
                0,
              );
        ret = globalScene.addPlayerPokemon(
          this.species,
          this.level,
          this.abilityIndex,
          this.formIndex,
          this.gender,
          this.shiny,
          this.variant,
          this.ivs,
          this.nature,
          this,
        );
        this.fusionSpecies = originalFusionSpecies;
        this.fusionFormIndex = originalFusionFormIndex;
      } else {
        const carriedFormIndex =
          evolution.evoFormKey !== null && !isFusion
            ? Math.max(
                evolutionSpecies.forms.findIndex(f => f.formKey === evolution.evoFormKey),
                0,
              )
            : this.formIndex;
        // Mirror evolve()'s guard so the PREVIEW sprite/name doesn't show a
        // battle-only form (e.g. a Redux mon previewing as "Mega <evo>"); prefer
        // the carried form's key (Redux -> Redux).
        const formIndex = this.resolveSafeEvolvedFormIndex(evolutionSpecies, carriedFormIndex, this.getFormKey());
        ret = globalScene.addPlayerPokemon(
          isFusion ? this.species : evolutionSpecies,
          this.level,
          this.abilityIndex,
          formIndex,
          this.gender,
          this.shiny,
          this.variant,
          this.ivs,
          this.nature,
          this,
        );
      }
      // Resolve even if the evolved mon's assets fail to load. Without the catch a
      // rejected loadAssets (e.g. a missing ER-custom evolved-fusion atlas) leaves
      // this promise pending forever, and the evolution scene - which awaits it -
      // hangs on a black screen. Degrade to whatever sprite state `ret` has instead.
      ret
        .loadAssets()
        .catch((err: unknown) => console.error("getPossibleEvolution: failed to load evolved sprite assets", err))
        .then(() => resolve(ret));
    });
  }

  evolve(evolution: SpeciesFormEvolution | null, preEvolution: PokemonSpeciesForm): Promise<void> {
    if (!evolution) {
      return new Promise(resolve => resolve());
    }
    return new Promise(resolve => {
      this.pauseEvolutions = false;
      // Capture the PRE-evolution form key BEFORE any mutation below — it is what
      // sanitizeEvolvedFormIndex() needs to carry the current form (e.g. "redux")
      // onto the evolved species. The `preEvolution` arg is unreliable: one caller
      // passes a PokemonSpecies (no `formKey`), so `preEvolution.formKey` is
      // undefined → "" → the Redux form got dropped to base on evolve (#325:
      // Kadabra-Redux → normal Alakazam) even though the preview, which reads
      // this.getFormKey(), showed the correct Redux sprite.
      const preEvoFormKey = this.getFormKey();
      // Handles Nincada evolving into Ninjask + Shedinja
      this.handleSpecialEvolutions(evolution);
      const isFusion = evolution instanceof FusionSpeciesFormEvolution;
      if (isFusion) {
        this.fusionSpecies = getPokemonSpecies(evolution.speciesId);
      } else {
        this.species = getPokemonSpecies(evolution.speciesId);
      }
      if (evolution.preFormKey !== null) {
        const formIndex = Math.max(
          (!isFusion || !this.fusionSpecies ? this.species : this.fusionSpecies).forms.findIndex(
            f => f.formKey === evolution.evoFormKey,
          ),
          0,
        );
        if (isFusion) {
          this.fusionFormIndex = formIndex;
        } else {
          this.formIndex = formIndex;
        }
      }
      // Guard against landing on a transient battle-only form (mega / primal /
      // Gigantamax / Eternamax) as an evolution result. These forms are never a
      // valid evolution destination — they are reached only in-battle via a
      // stone, orb, or Dynamax. The pre-evolution form index is otherwise
      // carried over verbatim (Pokémon keep the same form slot when evolving,
      // e.g. a regional form evolves into the same regional form). When the
      // source and target species have mismatched form layouts (e.g. ER's
      // "redux" Krabby at index 1 evolving into Kingler, whose index 1 is
      // "gigantamax"), that carry-over can point at a battle-only form. Reset to
      // the normal base form (the canonical index-0 form key "") in that case.
      // Prefer the form key captured from the live pre-evo Pokémon; fall back to
      // the (sometimes species-level) preEvolution arg. This is what carries
      // "redux" (and other regional/custom forms) across the evolution.
      this.sanitizeEvolvedFormIndex(isFusion, preEvoFormKey || ((preEvolution as { formKey?: string }).formKey ?? ""));
      this.generateName();
      if (isFusion) {
        const abilityCount = this.getFusionSpeciesForm().getAbilityCount();
        const preEvoAbilityCount = preEvolution.getAbilityCount();
        if ([0, 1, 2].includes(this.fusionAbilityIndex)) {
          // Handles cases where a Pokemon with 3 abilities evolves into a Pokemon with 2 abilities (ie: Eevee -> any Eeveelution)
          if (this.fusionAbilityIndex === 2 && preEvoAbilityCount === 3 && abilityCount === 2) {
            this.fusionAbilityIndex = 1;
          }
        } else {
          // Prevent pokemon with an illegal ability value from breaking things
          console.warn("this.fusionAbilityIndex is somehow an illegal value, please report this");
          console.warn(this.fusionAbilityIndex);
          this.fusionAbilityIndex = 0;
        }
      } else {
        const abilityCount = this.getSpeciesForm().getAbilityCount();
        const preEvoAbilityCount = preEvolution.getAbilityCount();
        if ([0, 1, 2].includes(this.abilityIndex)) {
          // Handles cases where a Pokemon with 3 abilities evolves into a Pokemon with 2 abilities (ie: Eevee -> any Eeveelution)
          if (this.abilityIndex === 2 && preEvoAbilityCount === 3 && abilityCount === 2) {
            this.abilityIndex = 1;
          }
        } else {
          // Prevent pokemon with an illegal ability value from breaking things
          console.warn("this.abilityIndex is somehow an illegal value, please report this");
          console.warn(this.abilityIndex);
          this.abilityIndex = 0;
        }
      }
      // ER (#445): the Ability Capsule writes a persistent ACTIVE-ability
      // override (customPokemonData.ability). If evolution introduces that exact
      // ability as an INNATE of the evolved form, the override would duplicate
      // an innate - wasting the active slot (reported: a capsule'd Earthbound
      // Dugtrio evolving into a form that already has Earthbound as an innate).
      // Drop the redundant override so the active ability re-derives to the
      // form's normal ability (the mon keeps the innate AND gains a distinct
      // active). Only the active-ability override is touched; innate-slot
      // overrides (the Ability Randomizer) are independent and left alone.
      const capsuleAbilityId = this.customPokemonData.ability;
      if (capsuleAbilityId != null && capsuleAbilityId !== -1) {
        const evolvedInnates = this.getPassiveAbilities();
        const duplicatesEvolvedInnate = evolvedInnates.some(a => a?.id === capsuleAbilityId);
        // #607: a capsule override that pinned one of the PRE-evo species' OWN
        // abilities is no longer legal if the evolved species doesn't share it (ER
        // lines can diverge entirely, e.g. Shelmet's Damp -> Accelgor has no Damp).
        // Drop it so the active re-derives to a real ability of the evolved form.
        // Deliberate non-species overrides (ME / custom starter) are never one of
        // the pre-evo's own abilities, so they're left alone.
        const activeAbilityIds = (form: PokemonSpeciesForm): AbilityId[] =>
          Array.from({ length: form.getAbilityCount() }, (_, i) => form.getAbility(i));
        const wasPreEvoActive = activeAbilityIds(preEvolution).includes(capsuleAbilityId);
        const isEvolvedActive = activeAbilityIds(this.getSpeciesForm()).includes(capsuleAbilityId);
        if (duplicatesEvolvedInnate || (wasPreEvoActive && !isEvolvedActive)) {
          this.customPokemonData.ability = -1;
          this.customPokemonData.abilityOverridesForm = false;
        }
      }
      this.compatibleTms.splice(0, this.compatibleTms.length);
      this.generateCompatibleTms();
      const updateAndResolve = () => {
        // Finish the evolution even if the evolved sprite's assets fail to load. The
        // species is already mutated above; stats + dex info must still update and the
        // promise must resolve, or the evolution scene hangs on a black screen (the
        // Rare-Candy-on-a-fused-mon crash, when the evolved-fusion atlas is missing).
        this.loadAssets()
          .catch((err: unknown) => console.error("evolve: failed to load evolved sprite assets", err))
          .then(() => {
            this.calculateStats();
            this.updateInfo(true).then(() => resolve());
          });
      };
      if (preEvolution.speciesId === SpeciesId.GIMMIGHOUL) {
        const evotracker = this.getHeldItems().find(m => m instanceof EvoTrackerModifier) ?? null;
        if (evotracker) {
          globalScene.removeModifier(evotracker);
        }
      }
      if (!globalScene.gameMode.isDaily || this.metBiome > -1) {
        globalScene.gameData.updateSpeciesDexIvs(this.species.speciesId, this.ivs);
        globalScene.gameData.setPokemonSeen(this, false);
        coopAllowAccountWrite("own-evolution", () => globalScene.gameData.setPokemonCaught(this, false)).then(() =>
          updateAndResolve(),
        );
      } else {
        updateAndResolve();
      }
    });
  }

  /**
   * Ensure the (possibly carried-over) form index after evolving does not point
   * at a transient battle-only form — Mega, Primal, Gigantamax, or Eternamax.
   * Those forms are only reachable in-battle (stone / orb / Dynamax) and must
   * never be a Pokémon's resting form after evolution. When the resolved form
   * is battle-only, fall back to the species' normal base form (form key `""`,
   * canonically index 0).
   *
   * @param isFusion - Whether to sanitize the fusion species' form index instead
   *   of the base species'.
   */
  /**
   * Resolve a safe RESTING form index for a just-evolved Pokémon. Evolutions
   * carry the pre-evolution form index over verbatim (so a regional/variant form
   * evolves into the same variant), but when source and target have mismatched
   * form layouts that can land on a battle-only form. Specifically: ER injects a
   * "redux" form on many species, and the target species may have a "mega" at the
   * same index — so a Redux Kadabra (index 1) carried into Alakazam (index 1 =
   * "mega") would become Mega Alakazam.
   *
   * Logic: if the carried form is fine (exists and is not battle-only), keep it.
   * Otherwise prefer a NON-battle-only form whose key matches the pre-evolution
   * form key (Redux -> Redux, e.g. Kadabra Redux -> Alakazam Redux), then fall
   * back to the canonical base form ("").
   */
  private resolveSafeEvolvedFormIndex(
    species: PokemonSpecies | null,
    carriedIndex: number,
    preferredFormKey: string,
  ): number {
    const battleOnlyFormKeys: string[] = [
      SpeciesFormKey.MEGA,
      SpeciesFormKey.MEGA_X,
      SpeciesFormKey.MEGA_Y,
      SpeciesFormKey.PRIMAL,
      SpeciesFormKey.GIGANTAMAX,
      SpeciesFormKey.GIGANTAMAX_SINGLE,
      SpeciesFormKey.GIGANTAMAX_RAPID,
      SpeciesFormKey.ETERNAMAX,
    ];
    const forms = species?.forms;
    if (!forms || forms.length === 0) {
      return carriedIndex;
    }
    const carried = forms[carriedIndex];
    if (carried && !battleOnlyFormKeys.includes(carried.formKey)) {
      return carriedIndex;
    }
    if (preferredFormKey) {
      const preferred = forms.findIndex(f => f.formKey === preferredFormKey && !battleOnlyFormKeys.includes(f.formKey));
      if (preferred >= 0) {
        return preferred;
      }
    }
    const normalIndex = forms.findIndex(f => f.formKey === "");
    return normalIndex >= 0 ? normalIndex : 0;
  }

  private sanitizeEvolvedFormIndex(isFusion: boolean, preferredFormKey = ""): void {
    const species = isFusion ? this.fusionSpecies : this.species;
    const currentFormIndex = isFusion ? this.fusionFormIndex : this.formIndex;
    const safeIndex = this.resolveSafeEvolvedFormIndex(species, currentFormIndex, preferredFormKey);
    if (isFusion) {
      this.fusionFormIndex = safeIndex;
    } else {
      this.formIndex = safeIndex;
    }
  }

  private handleSpecialEvolutions(evolution: SpeciesFormEvolution) {
    const isFusion = evolution instanceof FusionSpeciesFormEvolution;

    const evoSpecies = isFusion ? this.fusionSpecies : this.species;
    if (evoSpecies?.speciesId === SpeciesId.NINCADA && evolution.speciesId === SpeciesId.NINJASK) {
      const newEvolution = pokemonEvolutions[evoSpecies.speciesId][1];

      // Co-op authoritative (#633 B6): the GUEST is a pure renderer; the bonus Shedinja is a
      // STRUCTURAL party-add with a per-client random id + per-client-bound cloned held items, so it
      // must be added by the HOST alone and adopted by the guest via the snapshot benchParty reconcile
      // (B4). Skip on the authoritative guest; solo / host / lockstep are unaffected. Read through the
      // cycle-free gate (coop-authoritative-gate.ts) - importing coop-runtime here would close a
      // value-level import cycle (runtime -> coop-battle-engine -> #field/pokemon).
      if (validateShedinjaEvo() && !isCoopAuthoritativeGuestGated()) {
        const newPokemon = globalScene.addPlayerPokemon(
          this.species,
          this.level,
          this.abilityIndex,
          this.formIndex,
          undefined,
          this.shiny,
          this.variant,
          this.ivs,
          this.nature,
        );
        newPokemon.passive = this.passive;
        newPokemon.moveset = this.moveset.slice();
        newPokemon.moveset = this.copyMoveset();
        newPokemon.luck = this.luck;
        newPokemon.gender = Gender.GENDERLESS;
        newPokemon.metLevel = this.metLevel;
        newPokemon.metBiome = this.metBiome;
        newPokemon.metSpecies = this.metSpecies;
        newPokemon.metWave = this.metWave;
        newPokemon.fusionSpecies = this.fusionSpecies;
        newPokemon.fusionFormIndex = this.fusionFormIndex;
        newPokemon.fusionAbilityIndex = this.fusionAbilityIndex;
        newPokemon.fusionShiny = this.fusionShiny;
        newPokemon.fusionVariant = this.fusionVariant;
        newPokemon.fusionGender = this.fusionGender;
        newPokemon.fusionLuck = this.fusionLuck;
        newPokemon.fusionTeraType = this.fusionTeraType;
        newPokemon.usedTMs = this.usedTMs;
        // Co-op (#633, P1g): the evolved mon INHERITS the evolving mon's owner so
        // an evolution never shifts a mon between halves or breaks the per-player
        // cap. (Nincada -> Ninjask + Shedinja: the bonus Shedinja stays the same
        // owner; an evolution is owner-net-neutral.)
        if (this.coopOwner !== undefined) {
          newPokemon.coopOwner = this.coopOwner;
        }

        globalScene.getPlayerParty().push(newPokemon);
        newPokemon.evolve(isFusion ? new FusionSpeciesFormEvolution(this.id, newEvolution) : newEvolution, evoSpecies);
        const modifiers = globalScene.findModifiers(
          m => m instanceof PokemonHeldItemModifier && m.pokemonId === this.id,
          true,
        ) as PokemonHeldItemModifier[];
        modifiers.forEach(m => {
          const clonedModifier = m.clone() as PokemonHeldItemModifier;
          clonedModifier.pokemonId = newPokemon.id;
          globalScene.addModifier(clonedModifier, true);
        });
        globalScene.updateModifiers(true);
      }
    }
  }

  getPossibleForm(formChange: SpeciesFormChange): Promise<Pokemon> {
    return new Promise(resolve => {
      const formIndex = Math.max(
        this.species.forms.findIndex(f => f.formKey === formChange.formKey),
        0,
      );
      const ret = globalScene.addPlayerPokemon(
        this.species,
        this.level,
        this.abilityIndex,
        formIndex,
        this.gender,
        this.shiny,
        this.variant,
        this.ivs,
        this.nature,
        this,
      );
      ret.loadAssets().then(() => resolve(ret));
    });
  }

  changeForm(formChange: SpeciesFormChange): Promise<void> {
    return new Promise(resolve => {
      this.formIndex = Math.max(
        this.species.forms.findIndex(f => f.formKey === formChange.formKey),
        0,
      );
      this.generateName();
      const abilityCount = this.getSpeciesForm().getAbilityCount();
      if (this.abilityIndex >= abilityCount) {
        // Shouldn't happen
        this.abilityIndex = abilityCount - 1;
      }

      this.compatibleTms.splice(0, this.compatibleTms.length);
      this.generateCompatibleTms();
      const updateAndResolve = () => {
        this.loadAssets().then(() => {
          this.calculateStats();
          globalScene.updateModifiers(true, true);
          this.updateInfo(true).then(() => resolve());
        });
      };
      if (!globalScene.gameMode.isDaily || this.metBiome > -1) {
        globalScene.gameData.setPokemonSeen(this, false);
        globalScene.gameData.setPokemonCaught(this, false).then(() => updateAndResolve());
      } else {
        updateAndResolve();
      }
    });
  }

  clearFusionSpecies(): void {
    super.clearFusionSpecies();
    this.generateCompatibleTms();
  }

  /**
   * Fuse another PlayerPokemon into this one
   * @param pokemon - The PlayerPokemon to fuse to this one
   */
  fuse(pokemon: PlayerPokemon): void {
    this.fusionSpecies = pokemon.species;
    this.fusionFormIndex = pokemon.formIndex;
    this.fusionAbilityIndex = pokemon.abilityIndex;
    this.fusionShiny = pokemon.shiny;
    this.fusionVariant = pokemon.variant;
    this.fusionGender = pokemon.gender;
    this.fusionLuck = pokemon.luck;
    this.fusionCustomPokemonData = new CustomPokemonData(pokemon.customPokemonData);
    if (pokemon.pauseEvolutions || this.pauseEvolutions) {
      this.pauseEvolutions = true;
    }

    globalScene.validateAchv(achvs.SPLICE);
    erRecordAchievementFusion(this.species.speciesId, pokemon.species.speciesId);
    globalScene.gameData.gameStats.pokemonFused++;

    // Store the average HP% that each Pokemon has
    const maxHp = this.getMaxHp();
    const newHpPercent = (pokemon.hp / pokemon.getMaxHp() + this.hp / maxHp) / 2;

    this.generateName();
    this.calculateStats();

    // Set this Pokemon's HP to the average % of both fusion components
    this.hp = Math.round(maxHp * newHpPercent);
    if (!this.isFainted()) {
      // If this Pokemon hasn't fainted, make sure the HP wasn't set over the new maximum
      this.hp = Math.min(this.hp, maxHp);
      this.status = getRandomStatus(this.status, pokemon.status); // Get a random valid status between the two
    } else if (!pokemon.isFainted()) {
      // If this Pokemon fainted but the other hasn't, make sure the HP wasn't set to zero
      this.hp = Math.max(this.hp, 1);
      this.status = pokemon.status; // Inherit the other Pokemon's status
    }

    this.generateCompatibleTms();
    this.updateInfo(true);
    const fusedPartyMemberIndex = globalScene.getPlayerParty().indexOf(pokemon);
    let partyMemberIndex = globalScene.getPlayerParty().indexOf(this);
    if (partyMemberIndex > fusedPartyMemberIndex) {
      partyMemberIndex--;
    }

    // combine the two mons' held items
    const fusedPartyMemberHeldModifiers = globalScene.findModifiers(
      m => m instanceof PokemonHeldItemModifier && m.pokemonId === pokemon.id,
      true,
    ) as PokemonHeldItemModifier[];
    for (const modifier of fusedPartyMemberHeldModifiers) {
      globalScene.tryTransferHeldItemModifier(modifier, this, false, modifier.getStackCount(), true, true, false);
    }
    globalScene.updateModifiers(true, true);
    globalScene.removePartyMemberModifiers(fusedPartyMemberIndex);
    globalScene.getPlayerParty().splice(fusedPartyMemberIndex, 1)[0];
    const newPartyMemberIndex = globalScene.getPlayerParty().indexOf(this);
    pokemon
      .getMoveset(true)
      .map((m: PokemonMove) =>
        globalScene.phaseManager.unshiftNew("LearnMovePhase", newPartyMemberIndex, m.getMove().id),
      );
    pokemon.destroy();
    this.updateFusionPalette();
  }

  unfuse(): Promise<void> {
    return new Promise(resolve => {
      this.clearFusionSpecies();

      this.updateInfo(true).then(() => resolve());
      this.updateFusionPalette();
    });
  }

  /** Returns a deep copy of this Pokemon's moveset array */
  copyMoveset(): PokemonMove[] {
    const newMoveset: PokemonMove[] = [];
    this.moveset.forEach(move => {
      newMoveset.push(new PokemonMove(move.moveId, 0, move.ppUp, move.maxPpOverride));
    });

    return newMoveset;
  }
}

export class EnemyPokemon extends Pokemon {
  // Showdown versus-guest flip: the panel CLASS follows the presentation side (initBattleInfo),
  // so the base `battleInfo: BattleInfo` declaration is NOT narrowed here - either chrome fits.
  public trainerSlot: TrainerSlot;
  public aiType: AiType;
  public bossSegments: number;
  public bossSegmentIndex: number;
  public initialTeamIndex: number;
  /** To indicate if the instance was populated with a dataSource -> e.g. loaded & populated from session data */
  public readonly isPopulatedFromDataSource: boolean;

  constructor(
    species: PokemonSpecies,
    level: number,
    trainerSlot: TrainerSlot,
    boss: boolean,
    shinyLock = false,
    dataSource?: PokemonData,
    forRival = false,
  ) {
    super(
      236,
      84,
      species,
      level,
      dataSource?.abilityIndex,
      dataSource?.formIndex,
      dataSource?.gender,
      !shinyLock && dataSource ? dataSource.shiny : false,
      !shinyLock && dataSource ? dataSource.variant : undefined,
      undefined,
      dataSource ? dataSource.nature : undefined,
      dataSource,
    );

    this.trainerSlot = trainerSlot;
    this.initialTeamIndex = globalScene.currentBattle?.enemyParty.length ?? 0;
    this.isPopulatedFromDataSource = !!dataSource; // if a dataSource is provided, then it was populated from dataSource
    // Keep the neutral boss state concrete on every EnemyPokemon.  The save/network PokemonData
    // representation already canonicalizes a non-boss to `bossSegments: 0`, while this constructor
    // previously left both numeric fields absent when `boss === false`.  That made an authoritative
    // round-trip change only the guest from `undefined/undefined` to `0/0`, despite identical gameplay
    // semantics.  `setBoss(false)` is the class's own neutral-state initializer and consumes no RNG.
    this.setBoss(boss, dataSource?.bossSegments);

    if (Overrides.ENEMY_STATUS_OVERRIDE) {
      this.status = new Status(Overrides.ENEMY_STATUS_OVERRIDE, 0, 4);
    }

    if (Overrides.ENEMY_GENDER_OVERRIDE !== null) {
      this.gender = Overrides.ENEMY_GENDER_OVERRIDE;
    }

    const speciesId = this.species.speciesId;

    if (
      speciesId in Overrides.ENEMY_FORM_OVERRIDES
      && Overrides.ENEMY_FORM_OVERRIDES[speciesId] != null
      && this.species.forms[Overrides.ENEMY_FORM_OVERRIDES[speciesId]]
    ) {
      this.formIndex = Overrides.ENEMY_FORM_OVERRIDES[speciesId];
    }

    if (!dataSource) {
      // ER (#441): universal power gate at THE chokepoint every enemy passes
      // through (wild, trainer, mystery encounter, scripted - several ME
      // paths construct EnemyPokemon directly and bypassed every per-pipeline
      // gate, which is how a level-9 Moltres Ex reached wave 15 on
      // Youngster). Over-ceiling species devolve or swap BEFORE the moveset
      // is generated, so the final mon's kit matches its final species.
      // Saved battles (dataSource) are restored untouched.
      enforceErEliteBstCurve(this);
      this.generateAndPopulateMoveset(forRival);
      if (shinyLock || Overrides.ENEMY_SHINY_OVERRIDE === false) {
        this.shiny = false;
      } else {
        this.trySetShiny();
      }

      if (!this.shiny && Overrides.ENEMY_SHINY_OVERRIDE) {
        this.shiny = true;
        this.initShinySparkle();
      }

      if (this.shiny) {
        this.variant = Overrides.ENEMY_VARIANT_OVERRIDE ?? this.generateShinyVariant();
      }

      // ER (#349): the base-constructor shiny roll above was DISCARDED by this
      // re-roll - drop any black state it left, then run the t4 upgrade (1/50
      // of epic, or the dev-suite forced override) on the FINAL shiny/variant.
      // Without this, wild enemies could never naturally roll black.
      resetErBlackShinyState(this);
      maybeUpgradeToErBlackShiny(this);
      if (this.shiny && !this.hasTrainer() && !this.customPokemonData.erShinyLab) {
        this.customPokemonData.erShinyLab = rollErShinyLabWildSavedLook(
          getErShinyLabEarnedTierForPokemon(this),
          randSeedInt,
        );
      }

      this.luck = (this.shiny ? this.variant + 1 : 0) + (this.fusionShiny ? this.fusionVariant + 1 : 0);

      if (isDailyFinalBoss()) {
        this.applyCustomDailyBossConfig();
      } else {
        this.applyCustomDailyConfig();
      }

      if (this.hasTrainer() && globalScene.currentBattle) {
        const { waveIndex } = globalScene.currentBattle;
        const ivs: number[] = [];
        while (ivs.length < 6) {
          ivs.push(randSeedIntRange(Math.floor(waveIndex / 10), 31));
        }
        this.ivs = ivs;
        this.friendship = Phaser.Math.Clamp(
          Math.round(255 * (waveIndex / TRAINER_MAX_FRIENDSHIP_WAVE)),
          TRAINER_MIN_FRIENDSHIP,
          255,
        );
      }
    }

    this.aiType = boss || this.hasTrainer() ? AiType.SMART : AiType.SMART_RANDOM;
  }

  initBattleInfo(): void {
    if (this.battleInfo) {
      if (this.battleInfo instanceof EnemyBattleInfo) {
        this.battleInfo.updateBossSegments(this);
      }
    } else {
      const info = new EnemyBattleInfo();
      this.battleInfo = info;
      info.initInfo(this);
      info.updateBossSegments(this);
    }
  }

  /**
   * Set this {@linkcode EnemyPokemon}'s boss status.
   *
   * @param boss - Whether this pokemon should be a boss; default `true`
   * @param bossSegments - Optional amount amount of health bar segments to give;
   * will be generated by {@linkcode BattleScene.getEncounterBossSegments} if omitted
   */
  setBoss(boss = true, bossSegments?: number): void {
    if (!boss) {
      this.bossSegments = 0;
      this.bossSegmentIndex = 0;
      return;
    }

    this.bossSegments =
      bossSegments
      ?? globalScene.getEncounterBossSegments(globalScene.currentBattle.waveIndex, this.level, this.species, true);
    this.bossSegmentIndex = this.bossSegments - 1;
  }

  /**
   * Helper method to apply the custom daily config to this pokemon.
   */
  private applyCustomDailyConfig(): void {
    if (!isDailyEventSeed()) {
      return;
    }

    if (isDailyForcedWaveHiddenAbility() && this.species.abilityHidden) {
      this.abilityIndex = 2;
    }
  }

  /**
   * Helper method to apply the custom daily boss config to this pokemon.
   */
  private applyCustomDailyBossConfig(): void {
    if (!isDailyFinalBoss()) {
      return;
    }

    const bossConfig = getDailyEventSeedBoss();
    if (!bossConfig) {
      return;
    }

    if (bossConfig.formIndex != null) {
      this.formIndex = bossConfig.formIndex;
    }

    if (bossConfig.variant != null) {
      this.shiny = true;
      this.variant = bossConfig.variant;
    }

    if (bossConfig.nature != null) {
      this.setNature(bossConfig.nature);
    }

    if (bossConfig.moveset != null) {
      this.tryPopulateMoveset(bossConfig.moveset, true);
    }
  }

  override generateAndPopulateMoveset(useRivalSignatures = false, formIndex?: number): void {
    switch (true) {
      case this.species.speciesId === SpeciesId.SMEARGLE:
        this.moveset = [
          new PokemonMove(MoveId.SKETCH),
          new PokemonMove(MoveId.SKETCH),
          new PokemonMove(MoveId.SKETCH),
          new PokemonMove(MoveId.SKETCH),
        ];
        break;
      case this.species.speciesId === SpeciesId.ETERNATUS:
        this.moveset = (formIndex === undefined ? this.formIndex : formIndex)
          ? [
              new PokemonMove(MoveId.DYNAMAX_CANNON),
              new PokemonMove(MoveId.CROSS_POISON),
              new PokemonMove(MoveId.FLAMETHROWER),
              new PokemonMove(MoveId.RECOVER, 0, -4),
            ]
          : [
              new PokemonMove(MoveId.ETERNABEAM),
              new PokemonMove(MoveId.SLUDGE_BOMB),
              new PokemonMove(MoveId.FLAMETHROWER),
              new PokemonMove(MoveId.COSMIC_POWER),
            ];
        if (globalScene.gameMode.hasChallenge(Challenges.INVERSE_BATTLE)) {
          this.moveset[2] = new PokemonMove(MoveId.THUNDERBOLT);
        }
        break;
      default:
        super.generateAndPopulateMoveset(useRivalSignatures);
        break;
    }
  }

  /**
   * Determines the move this Pokemon will use on the next turn, as well as
   * the Pokemon the move will target.
   * @returns this Pokemon's next move in the format {move, moveTargets}
   */
  // TODO: split this up and move it elsewhere
  getNextMove(): TurnMove {
    // If this Pokemon has a usable move already queued, return it,
    // removing all unusable moves before it in the queue.
    const moveQueue = this.getMoveQueue();
    for (const [i, queuedMove] of moveQueue.entries()) {
      const movesetMove = this.getMoveset().find(m => m.moveId === queuedMove.move);
      // If the queued move was called indirectly, ignore all PP and usability checks.
      // Otherwise, ensure that the move being used is actually usable & in our moveset.
      // TODO: What should happen if a pokemon forgets a charging move mid-use?
      if (isVirtual(queuedMove.useMode) || movesetMove?.isUsable(this, isIgnorePP(queuedMove.useMode), true)) {
        moveQueue.splice(0, i); // TODO: This should not be done here
        return queuedMove;
      }
    }

    // We went through the entire queue without a match; clear the entire thing.
    this.summonData.moveQueue = [];

    // Filter out any moves this Pokemon cannot use
    let movePool = this.getMoveset().filter(m => m.isUsable(this, false, true)[0]);
    // If no moves are left, use Struggle. Otherwise, continue with move selection
    if (movePool.length > 0) {
      // If there's only 1 move in the move pool, use it.
      if (movePool.length === 1) {
        return {
          move: movePool[0].moveId,
          targets: this.getNextTargets(movePool[0].moveId),
          useMode: MoveUseMode.NORMAL,
        };
      }
      // If a move is forced because of Encore, use it.
      // Said moves are executed normally
      const encoreTag = this.getTag(EncoreTag);
      if (encoreTag) {
        const encoreMove = movePool.find(m => m.moveId === encoreTag.moveId);
        if (encoreMove) {
          return {
            move: encoreMove.moveId,
            targets: this.getNextTargets(encoreMove.moveId),
            useMode: MoveUseMode.NORMAL,
          };
        }
      }
      switch (this.aiType) {
        // No enemy should spawn with this AI type in-game
        case AiType.RANDOM: {
          const moveId = movePool[globalScene.randBattleSeedInt(movePool.length)].moveId;
          return { move: moveId, targets: this.getNextTargets(moveId), useMode: MoveUseMode.NORMAL };
        }
        case AiType.SMART_RANDOM:
        case AiType.SMART: {
          /**
           * Search this Pokemon's move pool for moves that will KO an opposing target.
           * If there are any moves that can KO an opponent (i.e. a player Pokemon),
           * those moves are the only ones considered for selection on this turn.
           */
          const koMoves = movePool.filter(pkmnMove => {
            if (!pkmnMove) {
              return false;
            }

            const move = pkmnMove.getMove()!;
            if (move.moveTarget === MoveTarget.ATTACKER) {
              return false;
            }

            const fieldPokemon = globalScene.getField();
            const moveTargets = getMoveTargets(this, move.id)
              .targets.map(ind => fieldPokemon[ind])
              .filter(p => this.isPlayer() !== p.isPlayer());
            // Only considers critical hits for crit-only moves or when this Pokemon is under the effect of Laser Focus
            const isCritical = move.hasAttr("CritOnlyAttr") || !!this.getTag(BattlerTagType.ALWAYS_CRIT);

            return (
              move.category !== MoveCategory.STATUS
              && moveTargets.some(p => {
                const doesNotFail =
                  !globalScene.arena.isMoveWeatherCancelled(this, move)
                  && (move.applyConditions(this, p, -1)
                    || [MoveId.SUCKER_PUNCH, MoveId.UPPER_HAND, MoveId.THUNDERCLAP].includes(move.id));
                return (
                  doesNotFail
                  && p.getAttackDamage({
                    source: this,
                    move,
                    ignoreAbility: !p.waveData.abilityRevealed,
                    ignoreSourceAbility: false,
                    ignoreAllyAbility: !p.getAlly()?.waveData.abilityRevealed,
                    ignoreSourceAllyAbility: false,
                    isCritical,
                    simulated: true,
                  }).damage >= p.hp
                );
              })
            );
          }, this);

          if (koMoves.length > 0) {
            movePool = koMoves;
          }

          // ER (Elite/Hell trainers & bosses): a smarter, near-optimal profile.
          // Inactive (false) for Youngster/Ace and wild -> the vanilla path below
          // runs unchanged. See er-enemy-ai.ts / the AI design doc.
          const erAi = getErAiProfile(this);

          /**
           * Move selection is based on the move's calculated "benefit score" against the
           * best possible target(s) (as determined by {@linkcode getNextTargets}).
           * For more information on how benefit scores are calculated, see `docs/enemy-ai.md`.
           */
          const moveScores = movePool.map(() => 0);
          const moveTargets = Object.fromEntries(movePool.map(m => [m.moveId, this.getNextTargets(m.moveId)]));
          movePool.forEach((pokemonMove, moveIndex) => {
            const move = pokemonMove.getMove();

            let moveScore = moveScores[moveIndex];
            const targetScores: number[] = [];

            for (const mt of moveTargets[move.id]) {
              // Prevent a target score from being calculated when the target is whoever attacks the user
              if (mt === BattlerIndex.ATTACKER) {
                break;
              }

              const target = globalScene.getField()[mt];
              /**
               * The "target score" of a move is given by the move's user benefit score + the move's target benefit score.
               * If the target is an ally, the target benefit score is multiplied by -1.
               * Side membership via the arrangement, NOT `mt < BattlerIndex.ENEMY`: a TRIPLE's
               * enemies start at flat index 3, so the constant-2 boundary made the AI score the
               * player's THIRD mon as its own ally (avoiding damage onto it, favoring buffs).
               */
              const arrangement = globalScene.currentBattle.arrangement;
              const targetIsAllied = arrangement
                ? arrangement.areAllies(mt, this.getBattlerIndex())
                : mt < BattlerIndex.ENEMY === this.isPlayer();
              let targetScore =
                move.getUserBenefitScore(this, target, move)
                + move.getTargetBenefitScore(this, target, move) * (targetIsAllied ? 1 : -1);
              if (Number.isNaN(targetScore)) {
                console.error(`Move ${move.name} returned score of NaN`);
                targetScore = 0;
              }
              // If this move is unimplemented, or the move is known to fail when used, set its target score to -20
              if (
                (move.name.endsWith(" (N)") || !move.applyConditions(this, target, -1))
                && ![MoveId.SUCKER_PUNCH, MoveId.UPPER_HAND, MoveId.THUNDERCLAP].includes(move.id)
              ) {
                targetScore = -20;
              } else if (move.is("AttackMove")) {
                /**
                 * Attack moves are given extra multipliers to their base benefit score based on
                 * the move's type effectiveness against the target and whether the move is a STAB move.
                 */
                const effectiveness = target.getMoveEffectiveness(
                  this,
                  move,
                  !target.waveData.abilityRevealed,
                  undefined,
                  undefined,
                  true,
                );

                if (target.isPlayer() !== this.isPlayer()) {
                  targetScore *= effectiveness;
                  if (this.isOfType(move.type)) {
                    targetScore *= 1.5;
                  }
                } else if (effectiveness) {
                  targetScore /= effectiveness;
                  if (this.isOfType(move.type)) {
                    targetScore /= 1.5;
                  }
                }
                // If a move has a base benefit score of 0, its benefit score is assumed to be unimplemented at this point
                if (!targetScore) {
                  targetScore = -20;
                }
              }
              targetScores.push(targetScore);
            }
            // When a move has multiple targets, its score is equal to the maximum target score across all targets
            moveScore += Math.max(...targetScores);

            // could make smarter by checking opponent def/spdef
            moveScores[moveIndex] = moveScore;
          });

          // ER smarter AI: re-score ATTACK moves by REAL simulated damage (vs the
          // target's actual bulk), accuracy-weighted, with a KO bonus - replacing
          // the vanilla power/effectiveness proxy. Non-attack moves keep their
          // vanilla benefit score (refined in a later slice); a move the vanilla
          // pass flagged unusable (<= -20) is left alone.
          if (erAi.active) {
            // Strategic (Slice 3) context, computed once: how many opposing mons
            // are left to punish, and whether a hazard is already on their side.
            const opponentSide = this.isPlayer() ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
            const mySide = this.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
            const opponentParty = this.isPlayer() ? globalScene.getEnemyParty() : globalScene.getPlayerParty();
            const myParty = this.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
            const opponentBenchCount = opponentParty.filter(p => !p.isFainted()).length;
            const hazardAlreadyUp =
              globalScene.arena.findTagsOnSide(t => t instanceof EntryHazardTag, opponentSide).length > 0;

            const activeOpponents = this.getOpponents().filter(o => o.isActive(true));
            // The experimental (Foul-Play-style) brain plays a depth-1 positional
            // game: it scores the board AFTER my move + the opponent's best reply.
            // It models a 1v1 board (me vs the lone opponent), so it engages whenever
            // there is exactly ONE active opponent - including a triple/double endgame
            // where my side still has allies (they aren't modelled in the lookahead, a
            // conservative under-estimate). With >1 opponent it falls back to greedy.
            // TODO(triple): a full 3-opponent depth-1 lookahead would model all foes.
            const useDepth1 = erAi.kind === "experimental" && activeOpponents.length === 1;

            if (useDepth1) {
              const oppMon = activeOpponents[0];
              // Worst incoming hit + speed read (fog-aware) - the maximin reply.
              const threat = erAssessThreat(this);
              const readBoosts = (p: Pokemon): ErBoostStages => ({
                atk: p.getStatStage(Stat.ATK),
                def: p.getStatStage(Stat.DEF),
                spa: p.getStatStage(Stat.SPATK),
                spd: p.getStatStage(Stat.SPDEF),
                spe: p.getStatStage(Stat.SPD),
              });
              const readHazards = (side: ArenaTagSide): ErHazards => {
                const layersOf = (tagType: ArenaTagType): number =>
                  (globalScene.arena.getTagOnSide(tagType, side) as EntryHazardTag | undefined)?.layers ?? 0;
                return {
                  stealthRock: layersOf(ArenaTagType.STEALTH_ROCK) > 0,
                  spikesLayers: layersOf(ArenaTagType.SPIKES),
                  toxicSpikesLayers: layersOf(ArenaTagType.TOXIC_SPIKES),
                  stickyWeb: layersOf(ArenaTagType.STICKY_WEB) > 0,
                };
              };
              const before: ErDepth1Before = {
                myActive: {
                  fainted: false,
                  hpFraction: this.getHpRatio(),
                  status: this.status?.effect ?? StatusEffect.NONE,
                  boosts: readBoosts(this),
                },
                oppActive: {
                  fainted: false,
                  hpFraction: oppMon.getHpRatio(),
                  status: oppMon.status?.effect ?? StatusEffect.NONE,
                  boosts: readBoosts(oppMon),
                },
                myHp: this.hp,
                myMaxHp: this.getMaxHp(),
                oppHp: oppMon.hp,
                oppMaxHp: oppMon.getMaxHp(),
                myReserveAlive: Math.max(0, myParty.filter(p => !p.isFainted()).length - 1),
                oppReserveAlive: Math.max(0, opponentBenchCount - 1),
                myHazards: readHazards(mySide),
                oppHazards: readHazards(opponentSide),
                // Matchup is rank-neutral within a turn (same actives), so 0 here;
                // switch-time matchup lives in enemy-command-phase.
                matchup: 0,
              };
              const hazardKindOf = (id: number): ErHazardKind | undefined => {
                switch (id) {
                  case MoveId.STEALTH_ROCK:
                    return "stealthRock";
                  case MoveId.SPIKES:
                    return "spikes";
                  case MoveId.TOXIC_SPIKES:
                    return "toxicSpikes";
                  case MoveId.STICKY_WEB:
                    return "stickyWeb";
                  default:
                    return;
                }
              };

              movePool.forEach((pokemonMove, moveIndex) => {
                const move = pokemonMove.getMove();
                // The vanilla pass flags two very different things with the same
                // <= -20: a move that CANNOT be used (unimplemented, or its
                // conditions fail this turn - e.g. Fake Out after turn 1), and a
                // move that simply does NOTHING (immune / 0 effectiveness, e.g.
                // Ground vs a Flying target). They must be ranked differently:
                //   - unusable  -> forced below every real score (never picked).
                //   - no-effect -> falls through and is scored on its true 0
                //     damage, so it ranks HONESTLY below moves that connect.
                // Leaving no-effect moves at the fixed -20 sentinel was a bug: in
                // a losing position real moves' depth-1 scores drop below -20, so
                // the immune move out-sorted them (Rapidash High Horsepower into a
                // Flying target over a super-effective Wild Charge).
                if (moveScores[moveIndex] <= -20) {
                  const unusable =
                    move.name.endsWith(" (N)")
                    || (!move.applyConditions(this, oppMon, -1)
                      && ![MoveId.SUCKER_PUNCH, MoveId.UPPER_HAND, MoveId.THUNDERCLAP].includes(move.id));
                  if (unusable) {
                    moveScores[moveIndex] = ER_UNUSABLE_MOVE_SCORE;
                    return;
                  }
                  // else: usable but no-effect - score it (getAttackDamage yields 0).
                }
                // Raw, accuracy-weighted damage my move deals to the lone opponent.
                let myDamage = 0;
                if (move.is("AttackMove")) {
                  const isCritical = move.hasAttr("CritOnlyAttr") || !!this.getTag(BattlerTagType.ALWAYS_CRIT);
                  const { damage } = oppMon.getAttackDamage({
                    source: this,
                    move,
                    ignoreAbility: !oppMon.waveData.abilityRevealed,
                    ignoreSourceAbility: false,
                    ignoreAllyAbility: !oppMon.getAlly()?.waveData.abilityRevealed,
                    ignoreSourceAllyAbility: false,
                    isCritical,
                    simulated: true,
                  });
                  const acc = move.accuracy <= 0 ? 100 : Math.min(move.accuracy, 100);
                  myDamage = damage * (acc / 100);
                }
                // Setup (self stat-boost) delta, read straight off the move's attr.
                let myBoostDelta: ErBoostStages | undefined;
                if (move.moveTarget === MoveTarget.USER && move.hasAttr("StatStageChangeAttr")) {
                  const delta: ErBoostStages = { atk: 0, def: 0, spa: 0, spd: 0, spe: 0 };
                  for (const attr of move.getAttrs("StatStageChangeAttr")) {
                    for (const stat of attr.stats) {
                      if (stat === Stat.ATK) {
                        delta.atk += attr.stages;
                      } else if (stat === Stat.DEF) {
                        delta.def += attr.stages;
                      } else if (stat === Stat.SPATK) {
                        delta.spa += attr.stages;
                      } else if (stat === Stat.SPDEF) {
                        delta.spd += attr.stages;
                      } else if (stat === Stat.SPD) {
                        delta.spe += attr.stages;
                      }
                    }
                  }
                  myBoostDelta = delta;
                }
                const d1: ErDepth1Move = {
                  myDamage,
                  oppReplyDamage: threat.worstIncomingDamage,
                  iMoveFirst: threat.outspeeds || move.priority > 0,
                  myBoostDelta,
                  addsOppHazard: ER_HAZARD_MOVE_IDS.has(move.id) ? hazardKindOf(move.id) : undefined,
                };
                moveScores[moveIndex] = erDepth1MoveScore(before, d1);
              });
            } else {
              // Phase A (threat-awareness): if this mon CANNOT KO this turn (the KO
              // filter left a normal pool), assess whether an opponent will KO IT
              // this turn and whether it outspeeds. When doomed AND outsped, a slow
              // move won't even execute - so below we devalue non-priority moves,
              // steering the AI toward a priority snipe.
              const threat =
                koMoves.length === 0
                  ? erAssessThreat(this)
                  : { incomingKO: false, outspeeds: true, worstIncomingDamage: 0 };

              movePool.forEach((pokemonMove, moveIndex) => {
                const move = pokemonMove.getMove();
                if (moveScores[moveIndex] <= -20) {
                  return;
                }
                if (move.is("AttackMove")) {
                  // Slice 1: re-score attacks by real simulated damage.
                  let best = 0;
                  for (const mt of moveTargets[move.id]) {
                    if (mt === BattlerIndex.ATTACKER) {
                      continue;
                    }
                    const target = globalScene.getField()[mt];
                    if (!target || target.isPlayer() === this.isPlayer()) {
                      continue;
                    }
                    const isCritical = move.hasAttr("CritOnlyAttr") || !!this.getTag(BattlerTagType.ALWAYS_CRIT);
                    const { damage } = target.getAttackDamage({
                      source: this,
                      move,
                      ignoreAbility: !target.waveData.abilityRevealed,
                      ignoreSourceAbility: false,
                      ignoreAllyAbility: !target.getAlly()?.waveData.abilityRevealed,
                      ignoreSourceAllyAbility: false,
                      isCritical,
                      simulated: true,
                    });
                    best = Math.max(best, damageToScore(damage, target.getMaxHp(), target.hp, move.accuracy));
                  }
                  // Slice 4 (doubles/triples): a spread move that also hits our own ally is
                  // penalized by the damage it would deal them - so the AI won't Earthquake
                  // its non-immune partner (and never KOs its own ally). In a triple there
                  // can be TWO allies, so penalise by EACH ally the spread would hit (the old
                  // single getAlly() under-counted, letting the AI spread into its own team).
                  const hitsAlly =
                    move.moveTarget === MoveTarget.ALL_NEAR_OTHERS
                    || move.moveTarget === MoveTarget.ALL_OTHERS
                    || move.moveTarget === MoveTarget.ALL;
                  if (best > 0 && hitsAlly) {
                    for (const ally of this.getAllies()) {
                      if (ally.isFainted()) {
                        continue;
                      }
                      const { damage: allyDamage } = ally.getAttackDamage({
                        source: this,
                        move,
                        ignoreAbility: false,
                        ignoreSourceAbility: false,
                        ignoreAllyAbility: false,
                        ignoreSourceAllyAbility: false,
                        isCritical: false,
                        simulated: true,
                      });
                      best -= damageToScore(allyDamage, ally.getMaxHp(), ally.hp, 100);
                    }
                  }
                  // Phase A: doomed-and-outsped -> a slow move likely won't execute,
                  // so devalue it (a priority move keeps full value and wins).
                  if (best > 0 && shouldDevalueSlowMove(threat.incomingKO, threat.outspeeds, move.priority)) {
                    best *= ER_SLOW_DOOMED_PENALTY;
                  }
                  moveScores[moveIndex] = best;
                  return;
                }
                // Slice 3: setup (self stat-boost) + hazard valuation. Other
                // non-attack moves keep their vanilla benefit score.
                const isHazard = ER_HAZARD_MOVE_IDS.has(move.id);
                const isSetup = move.moveTarget === MoveTarget.USER && move.hasAttr("StatStageChangeAttr");
                if (isHazard || isSetup) {
                  moveScores[moveIndex] = strategicMoveScore(moveScores[moveIndex], {
                    isSetup,
                    isHazard,
                    userHpRatio: this.getHpRatio(),
                    opponentBenchCount,
                    hazardAlreadyUp,
                  });
                }
              });
            }
          }

          // Sort the move pool in decreasing order of move score
          const sortedMovePool = movePool.slice(0);
          sortedMovePool.sort((a, b) => {
            const scoreA = moveScores[movePool.indexOf(a)];
            const scoreB = moveScores[movePool.indexOf(b)];
            return scoreA < scoreB ? 1 : scoreA > scoreB ? -1 : 0;
          });
          let chosenMoveIndex = 0;
          if (erAi.active) {
            // ER determinism dial: Hell (sharpness 1) always takes the best move;
            // Elite slides to a worse one only rarely. Scores aligned to sortedMovePool.
            const sortedScores = sortedMovePool.map(m => moveScores[movePool.indexOf(m)]);
            chosenMoveIndex = chooseMoveIndex(sortedScores, erAi.sharpness, n => globalScene.randBattleSeedInt(n));
          } else if (this.aiType === AiType.SMART_RANDOM) {
            // Has a 5/8 chance to select the best move, and a 3/8 chance to advance to the next best move (and repeat this roll)
            while (chosenMoveIndex < sortedMovePool.length - 1 && globalScene.randBattleSeedInt(8) >= 5) {
              chosenMoveIndex++;
            }
          } else if (this.aiType === AiType.SMART) {
            // The chance to advance to the next best move increases when the compared moves' scores are closer to each other.
            while (
              chosenMoveIndex < sortedMovePool.length - 1
              && moveScores[movePool.indexOf(sortedMovePool[chosenMoveIndex + 1])]
                / moveScores[movePool.indexOf(sortedMovePool[chosenMoveIndex])]
                >= 0
              && globalScene.randBattleSeedInt(100)
                < Math.round(
                  (moveScores[movePool.indexOf(sortedMovePool[chosenMoveIndex + 1])]
                    / moveScores[movePool.indexOf(sortedMovePool[chosenMoveIndex])])
                    * 50,
                )
            ) {
              chosenMoveIndex++;
            }
          }

          const chosenMove = sortedMovePool[chosenMoveIndex];

          // biome-ignore format: For some reason this gets broken into multiple lines
          console.log("Move Pool:", movePool.map((m) => m.getName()));
          console.log("Move Scores:", moveScores);
          // biome-ignore format: For some reason this gets broken into multiple lines
          console.log("Sorted Move Pool:", sortedMovePool.map((m) => m.getName()));
          console.log("Chosen Move:", chosenMove.getName());
          if (erAi.active) {
            console.log(`ER AI: ${erAi.kind} brain (sharpness ${erAi.sharpness})`);
          }

          return {
            move: chosenMove.moveId,
            targets: moveTargets[chosenMove.moveId],
            useMode: MoveUseMode.NORMAL,
          };
        }
      }
    }

    // No moves left means struggle
    return {
      move: MoveId.STRUGGLE,
      targets: this.getNextTargets(MoveId.STRUGGLE),
      useMode: MoveUseMode.IGNORE_PP,
    };
  }

  /**
   * Determines the Pokemon the given move would target if used by this Pokemon
   * @param moveId - The move to be used
   * @returns The indexes of the Pokemon the given move would target
   */
  getNextTargets(moveId: MoveId): BattlerIndex[] {
    const moveTargets = getMoveTargets(this, moveId);
    const targets = globalScene.getField(true).filter(p => moveTargets.targets.indexOf(p.getBattlerIndex()) > -1);
    // If the move is multi-target, return all targets' indexes
    if (moveTargets.multiple) {
      return targets.map(p => p.getBattlerIndex());
    }

    const move = allMoves[moveId];

    /**
     * Get the move's target benefit score against each potential target.
     * For allies, this score is multiplied by -1.
     */
    const benefitScores = targets.map(p => [
      p.getBattlerIndex(),
      move.getTargetBenefitScore(this, p, move) * (p.isPlayer() === this.isPlayer() ? 1 : -1),
    ]);

    const sortedBenefitScores = benefitScores.slice(0);
    sortedBenefitScores.sort((a, b) => {
      const scoreA = a[1];
      const scoreB = b[1];
      return scoreA < scoreB ? 1 : scoreA > scoreB ? -1 : 0;
    });

    if (sortedBenefitScores.length === 0) {
      // Set target to BattlerIndex.ATTACKER when using a counter move
      // This is the same as when the player does so
      if (move.hasAttr("CounterDamageAttr")) {
        return [BattlerIndex.ATTACKER];
      }

      return [];
    }

    let targetWeights = sortedBenefitScores.map(s => s[1]);
    const lowestWeight = targetWeights.at(-1) ?? 0;

    // If the lowest target weight (i.e. benefit score) is negative, add abs(lowestWeight) to all target weights
    if (lowestWeight < 1) {
      for (let w = 0; w < targetWeights.length; w++) {
        targetWeights[w] += Math.abs(lowestWeight - 1);
      }
    }

    // Remove any targets whose weights are less than half the max of the target weights from consideration
    const benefitCutoffIndex = targetWeights.findIndex(s => s < targetWeights[0] / 2);
    if (benefitCutoffIndex > -1) {
      targetWeights = targetWeights.slice(0, benefitCutoffIndex);
    }

    const thresholds: number[] = [];
    let totalWeight = 0;
    targetWeights.reduce((total: number, w: number) => {
      total += w;
      thresholds.push(total);
      totalWeight = total;
      return total;
    }, 0);

    /**
     * Generate a random number from 0 to (totalWeight-1),
     * then select the first target whose cumulative weight (with all previous targets' weights)
     * is greater than that random number.
     */
    const randValue = globalScene.randBattleSeedInt(totalWeight);
    let targetIndex = 0;

    thresholds.every((t, i) => {
      if (randValue >= t) {
        return true;
      }

      targetIndex = i;
      return false;
    });

    return [sortedBenefitScores[targetIndex][0]];
  }

  override isPlayer(): this is PlayerPokemon {
    return false;
  }

  override isEnemy(): this is EnemyPokemon {
    return true;
  }

  override hasTrainer(): boolean {
    return !!this.trainerSlot;
  }

  override isBoss(): boolean {
    return !!this.bossSegments;
  }

  getBossSegmentIndex(): number {
    const segments = (this as EnemyPokemon).bossSegments;
    const segmentSize = this.getMaxHp() / segments;
    for (let s = segments - 1; s > 0; s--) {
      const hpThreshold = Math.round(segmentSize * s);
      if (this.hp > hpThreshold) {
        return s;
      }
    }

    return 0;
  }

  /**
   * @inheritdoc
   * @param ignoreSegments - Whether to ignore boss segments when applying damage
   */
  public damage(damage: number, ignoreSegments = false, preventEndure = false, ignoreFaintPhase = false): number {
    if (this.isFainted()) {
      return 0;
    }

    const segmentSize = this.getMaxHp() / this.bossSegments;

    let clearedBossSegmentIndex = this.isBoss() ? this.bossSegmentIndex + 1 : 0;

    if (this.isBoss() && !ignoreSegments) {
      [damage, clearedBossSegmentIndex] = calculateBossSegmentDamage(
        damage,
        this.hp,
        segmentSize,
        this.getMinimumSegmentIndex(),
        this.bossSegmentIndex,
      );
    }

    // ER (#423): the HELL finale STARTS as Primal Cascoon (formIndex 1), so
    // the vanilla `formIndex === 0` stage-one check missed it - the last
    // shield-breaking hit carried through and the boss died straight into the
    // victory screen instead of reaching its black shiny stage 2. Stage one on
    // Hell = ER finale species that has NOT been black-promoted yet.
    const erHellFinaleStageOne =
      this.formIndex > 0
      && isErFinalBossSpecies(this.species.speciesId)
      && !this.customPokemonData?.erBlackShiny
      && getErDifficulty() === "hell";
    const isFinaleSpecies =
      this.species.speciesId === SpeciesId.ETERNATUS || isErFinalBossSpecies(this.species.speciesId);
    if (
      globalScene.currentBattle.isClassicFinalBoss
      && isFinaleSpecies
      && (this.formIndex === 0 || erHellFinaleStageOne)
      && this.bossSegmentIndex < 1
    ) {
      damage = Math.min(damage, this.hp - 1);
    }

    const ret = super.damage(damage, ignoreSegments, preventEndure, ignoreFaintPhase);

    if (this.isBoss()) {
      if (ignoreSegments) {
        clearedBossSegmentIndex = Math.ceil(this.hp / segmentSize);
      }
      if (clearedBossSegmentIndex <= this.bossSegmentIndex) {
        this.handleBossSegmentCleared(clearedBossSegmentIndex);
      }
      if (this.battleInfo instanceof EnemyBattleInfo) {
        this.battleInfo.updateBossSegments(this);
      }
    }

    return ret;
  }

  private getMinimumSegmentIndex(): number {
    const isFinaleSpecies =
      this.species.speciesId === SpeciesId.ETERNATUS || isErFinalBossSpecies(this.species.speciesId);
    if (globalScene.currentBattle.isClassicFinalBoss && isFinaleSpecies && !this.formIndex) {
      return 1;
    }

    return 0;
  }

  /**
   * Go through a boss' health segments and give stats boosts for each newly cleared segment
   *
   * @remarks
   * The base boost is 1 to a random stat that's not already maxed out per broken shield
   * For Pokemon with 3 health segments or more, breaking the last shield gives +2 instead
   * For Pokemon with 5 health segments or more, breaking the last two shields give +2 each
   * @param segmentIndex - index of the segment to get down to (0 = no shield left, 1 = 1 shield left, etc.)
   */
  handleBossSegmentCleared(segmentIndex: number): void {
    let doStatBoost = !this.hasTrainer();
    // TODO: Rewrite this bespoke logic to improve clarity
    while (this.bossSegmentIndex > 0 && segmentIndex - 1 < this.bossSegmentIndex) {
      this.bossSegmentIndex--;

      // Continue, _not_ break here, to ensure that each segment is still broken
      if (!doStatBoost) {
        continue;
      }
      let boostedStat: EffectiveStat | undefined;
      // Filter out already maxed out stat stages and weigh the rest based on existing stats
      const leftoverStats = EFFECTIVE_STATS.filter((s: EffectiveStat) => this.getStatStage(s) < 6);
      const statWeights = leftoverStats.map((s: EffectiveStat) => this.getStat(s, false));

      const statThresholds: number[] = [];
      let totalWeight = 0;

      for (const i in statWeights) {
        totalWeight += statWeights[i];
        statThresholds.push(totalWeight);
      }

      // Pick a random stat from the leftover stats to increase its stages
      const randInt = randSeedInt(totalWeight);
      for (const i in statThresholds) {
        if (randInt < statThresholds[i]) {
          boostedStat = leftoverStats[i];
          break;
        }
      }

      if (boostedStat === undefined) {
        doStatBoost = false;
        continue;
      }

      let stages = 1;

      // increase the boost if the boss has at least 3 segments and we passed last shield
      if (this.bossSegments >= 3 && this.bossSegmentIndex === 0) {
        stages++;
      }
      // increase the boost if the boss has at least 5 segments and we passed the second to last shield
      if (this.bossSegments >= 5 && this.bossSegmentIndex === 1) {
        stages++;
      }

      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        this.getBattlerIndex(),
        true,
        [boostedStat],
        stages,
        true,
        true,
      );
    }
  }

  public getFieldIndex(): number {
    return globalScene.getEnemyField().indexOf(this);
  }

  public getBattlerIndex(): BattlerIndex {
    const fieldIndex = this.getFieldIndex();
    if (fieldIndex === -1) {
      return BattlerIndex.ATTACKER;
    }
    // Multi-format: the enemy side's base flat-index (legacy == BattlerIndex.ENEMY == 2;
    // triple shifts it to 3). Falls back to the legacy constant outside a battle.
    const enemyOffset = globalScene.currentBattle?.arrangement.enemyOffset ?? BattlerIndex.ENEMY;
    return enemyOffset + fieldIndex;
  }

  /**
   * Add a new pokemon to the player's party (at `slotIndex` if set).
   * The new pokemon's visibility will be set to `false`.
   * @param pokeballType - The type of pokeball the pokemon was caught with
   * @param slotIndex - An optional index to place the pokemon in the party
   * @returns The pokemon that was added or null if the pokemon could not be added
   */
  public addToParty(pokeballType: PokeballType, slotIndex = -1) {
    const party = globalScene.getPlayerParty();
    let ret: PlayerPokemon | null = null;

    // Co-op (#633, P1g): a single player can never grow their half of the shared
    // party past COOP_SLOTS_PER_PLAYER. Attribute this obtain to the half with
    // room via coopAttributeNewMon (P1: the emptier half - swappable so P2 can
    // attribute to the actual ball-thrower instead) and reject when BOTH halves
    // are full. Solo / all other modes skip this entirely (6-cap below unchanged).
    let coopOwner: CoopRole | undefined;
    if (globalScene.gameMode.isCoop) {
      coopOwner = coopAttributeNewMon(party) ?? undefined;
      if (coopOwner === undefined || coopHalfIsFull(party, coopOwner)) {
        return ret;
      }
    }

    if (party.length < PLAYER_PARTY_MAX_SIZE) {
      this.pokeball = pokeballType;
      this.metLevel = this.level;
      this.metBiome = globalScene.arena.biomeId;
      this.metWave = globalScene.currentBattle.waveIndex;
      this.metSpecies = this.species.speciesId;
      const newPokemon = globalScene.addPlayerPokemon(
        this.species,
        this.level,
        this.abilityIndex,
        this.formIndex,
        this.gender,
        this.shiny,
        this.variant,
        this.ivs,
        this.nature,
        this,
      );

      // Co-op (#633, P1g): stamp the resolved owner on the newly added mon so the
      // per-player cap holds for this mon's whole life (incl. save/reload).
      if (coopOwner !== undefined) {
        newPokemon.coopOwner = coopOwner;
      }

      if (isBetween(slotIndex, 0, PLAYER_PARTY_MAX_SIZE - 1)) {
        party.splice(slotIndex, 0, newPokemon);
      } else {
        party.push(newPokemon);
      }

      // Hide the Pokemon since it is not on the field
      newPokemon.setVisible(false);

      ret = newPokemon;
      globalScene.triggerPokemonFormChange(newPokemon, SpeciesFormChangeActiveTrigger, true);
    }

    return ret;
  }

  /**
   * Show or hide the type effectiveness multiplier window
   * Passing undefined will hide the window
   */
  public updateEffectiveness(effectiveness?: string) {
    if (this.battleInfo instanceof EnemyBattleInfo) {
      this.battleInfo.updateEffectiveness(effectiveness);
    }
  }

  public toggleFlyout(visible: boolean): void {
    if (this.battleInfo instanceof EnemyBattleInfo) {
      this.battleInfo.toggleFlyout(visible);
    }
  }
}
