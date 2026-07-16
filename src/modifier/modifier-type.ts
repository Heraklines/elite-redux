import { TYPE_BOOST_ITEM_BOOST_PERCENT } from "#app/constants";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import Overrides from "#app/overrides";
import { EvolutionItem, pokemonEvolutions } from "#balance/pokemon-evolutions";
import { tmSpecies } from "#balance/tm-species-map";
import { tmPoolTiers } from "#balance/tms";
import { getBerryEffectDescription, getBerryName } from "#data/berry";
import { getDailyEventSeedLuck } from "#data/daily-seed/daily-run";
import { allMoves, modifierTypes } from "#data/data-lists";
import { erHasRunUnlockableInnate } from "#data/elite-redux/er-ability-capsule";
import { erBiomeShopResolveTier, erBiomeTierPrice, rollErBiomeShopStock } from "#data/elite-redux/er-biome-economy";
import { getErBiomeRule } from "#data/elite-redux/er-biome-rules";
import { ER_COMMUNITY_ITEM_CONFIG, type ErCommunityItemKind } from "#data/elite-redux/er-community-items";
import { erGemItemType } from "#data/elite-redux/er-elemental-gems";
import { getErTemporaryLuck } from "#data/elite-redux/er-fairy-luck";
import { greaterCapsuleHasAnyOption } from "#data/elite-redux/er-greater-ability-capsule";
import { erMegaStoneIconFrame, isErMegaStone } from "#data/elite-redux/er-mega-stones";
import { erReactiveItemType } from "#data/elite-redux/er-reactive-items";
import { ER_ASSAULT_VEST_TYPE, ER_LIFE_ORB_TYPE, ER_ROCKY_HELMET_TYPE } from "#data/elite-redux/er-recreated-items";
import { ER_RELIC_CONFIG, type ErRelicKind } from "#data/elite-redux/er-relics";
import { hasErAilment } from "#data/elite-redux/er-status-cure";
import { erTacticalItemType } from "#data/elite-redux/er-tactical-items";
import { erSeedItemType } from "#data/elite-redux/er-terrain-seeds";
import { SpeciesFormChangeItemTrigger } from "#data/form-change-triggers";
import { getNatureName, getNatureStatMultiplier } from "#data/nature";
import { getPokeballCatchMultiplier, getPokeballName } from "#data/pokeball";
import { pokemonFormChanges, SpeciesFormChangeCondition } from "#data/pokemon-forms";
import { getStatusEffectDescriptor } from "#data/status-effect";
import { BattlerTagType } from "#enums/battler-tag-type";
import { BerryType } from "#enums/berry-type";
import { ChallengeType } from "#enums/challenge-type";
import { FormChangeItem } from "#enums/form-change-item";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveId } from "#enums/move-id";
import { Nature } from "#enums/nature";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import type { PermanentStat, TempBattleStat } from "#enums/stat";
import { getStatKey, Stat, TEMP_BATTLE_STATS } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { EnemyPokemon, PlayerPokemon, Pokemon } from "#field/pokemon";
import {
  AddPokeballModifier,
  AddVoucherModifier,
  AttackTypeBoosterModifier,
  BaseStatModifier,
  BerryModifier,
  BoostBugSpawnModifier,
  BypassSpeedChanceModifier,
  ContactHeldItemTransferChanceModifier,
  CritBoosterModifier,
  CriticalCatchChanceBoosterModifier,
  DamageCalculatorModifier,
  DamageMoneyRewardModifier,
  DoubleBattleChanceBoosterModifier,
  EnemyAttackStatusEffectChanceModifier,
  EnemyDamageBoosterModifier,
  EnemyDamageReducerModifier,
  EnemyEndureChanceModifier,
  EnemyFusionChanceModifier,
  type EnemyPersistentModifier,
  EnemyStatusEffectHealChanceModifier,
  EnemyTurnHealModifier,
  ErAbilityCapsuleModifier,
  ErCommunityItemModifier,
  ErDexNavModifier,
  ErGreaterAbilityCapsuleModifier,
  ErGreaterAbilityRandomizerModifier,
  ErLearnersShroomModifier,
  ErRelicModifier,
  ErTmCaseModifier,
  EvolutionItemModifier,
  EvolutionStatBoosterModifier,
  EvoTrackerModifier,
  ExpBalanceModifier,
  ExpBoosterModifier,
  ExpShareModifier,
  ExtraModifierModifier,
  FieldEffectModifier,
  FlinchChanceModifier,
  FusePokemonModifier,
  GigantamaxAccessModifier,
  HealingBoosterModifier,
  HealShopCostModifier,
  HiddenAbilityRateBoosterModifier,
  HitHealModifier,
  IvScannerModifier,
  LevelIncrementBoosterModifier,
  LockModifierTiersModifier,
  MapModifier,
  MegaEvolutionAccessModifier,
  type Modifier,
  MoneyInterestModifier,
  MoneyMultiplierModifier,
  MoneyRewardModifier,
  MultipleParticipantExpBonusModifier,
  type PersistentModifier,
  PokemonAddMoveSlotModifier,
  PokemonAllMovePpRestoreModifier,
  PokemonBaseStatFlatModifier,
  PokemonBaseStatTotalModifier,
  PokemonExpBoosterModifier,
  PokemonFormChangeItemModifier,
  PokemonFriendshipBoosterModifier,
  PokemonHeldItemModifier,
  PokemonHpRestoreModifier,
  PokemonIncrementingStatModifier,
  PokemonInstantReviveModifier,
  PokemonLevelIncrementModifier,
  PokemonMoveAccuracyBoosterModifier,
  PokemonMultiHitModifier,
  PokemonNatureChangeModifier,
  PokemonNatureWeightModifier,
  PokemonPpRestoreModifier,
  PokemonPpUpModifier,
  PokemonRandomizeAbilityModifier,
  PokemonStatusHealModifier,
  PreserveBerryModifier,
  RememberMoveModifier,
  ResetNegativeStatStageModifier,
  ShinyRateBoosterModifier,
  SpeciesCritBoosterModifier,
  SpeciesStatBoosterModifier,
  SpeedOrderModifier,
  SurviveDamageModifier,
  SwitchEffectTransferModifier,
  TempCritBoosterModifier,
  TempExtraModifierModifier,
  TempStatStageBoosterModifier,
  TerastallizeAccessModifier,
  TerastallizeModifier,
  TmModifier,
  TurnHealModifier,
  TurnHeldItemTransferModifier,
  TurnStatusEffectModifier,
} from "#modifiers/modifier";
import type { PokemonMove } from "#moves/pokemon-move";
import { getVoucherTypeIcon, getVoucherTypeName, VoucherType } from "#system/voucher";
import type { ModifierTypeFunc, WeightedModifierTypeWeightFunc } from "#types/modifier-types";
import type { PokemonMoveSelectFilter, PokemonSelectFilter } from "#ui/party-ui-handler";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { getModifierTierTextTint } from "#ui/text";
import { applyChallenges } from "#utils/challenge-utils";
import { BooleanHolder, formatMoney, NumberHolder, padInt, randSeedInt, randSeedItem } from "#utils/common";
import { getEnumKeys, getEnumValues } from "#utils/enums";
import { getModifierPoolForType, getModifierType } from "#utils/modifier-utils";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";

const outputModifierData = false;
const useMaxWeightForOutput = false;

type NewModifierFunc = (type: ModifierType, args: any[]) => Modifier;

export class ModifierType {
  public id: string;
  public localeKey: string;
  public iconImage: string;
  /**
   * ER reskinned items (#437): runtime tint/alpha for the icon frame, applied
   * wherever the TYPE's icon is drawn with no modifier instance around (the
   * reward shop). Held-item icons re-apply the same recolor in the modifier's
   * getIcon override (Ward Stone / community item pattern).
   */
  public iconTint?: number;
  public iconAlpha?: number;
  public group: string;
  public soundName: string;
  public tier: ModifierTier;
  protected newModifierFunc: NewModifierFunc | null;

  /**
   * Checks if the modifier type is of a specific type
   * @param modifierType - The type to check against
   * @returns Whether the modifier type is of the specified type
   */
  public is<K extends ModifierTypeString>(modifierType: K): this is ModifierTypeInstanceMap[K] {
    const targetType = ModifierTypeConstructorMap[modifierType];
    if (!targetType) {
      return false;
    }
    return this instanceof targetType;
  }

  constructor(
    localeKey: string | null,
    iconImage: string | null,
    newModifierFunc: NewModifierFunc | null,
    group?: string,
    soundName?: string,
  ) {
    this.localeKey = localeKey!; // TODO: is this bang correct?
    this.iconImage = iconImage!; // TODO: is this bang correct?
    this.group = group!; // TODO: is this bang correct?
    this.soundName = soundName ?? "se/restore";
    this.newModifierFunc = newModifierFunc;
  }

  get name(): string {
    return i18next.t(`${this.localeKey}.name` as any);
  }

  getDescription(): string {
    return i18next.t(`${this.localeKey}.description` as any);
  }

  setTier(tier: ModifierTier): void {
    this.tier = tier;
  }

  getOrInferTier(poolType: ModifierPoolType = ModifierPoolType.PLAYER): ModifierTier | null {
    if (this.tier) {
      return this.tier;
    }
    if (!this.id) {
      return null;
    }
    let poolTypes: ModifierPoolType[];
    switch (poolType) {
      case ModifierPoolType.PLAYER:
        poolTypes = [poolType, ModifierPoolType.TRAINER, ModifierPoolType.WILD];
        break;
      case ModifierPoolType.WILD:
        poolTypes = [poolType, ModifierPoolType.PLAYER, ModifierPoolType.TRAINER];
        break;
      case ModifierPoolType.TRAINER:
        poolTypes = [poolType, ModifierPoolType.PLAYER, ModifierPoolType.WILD];
        break;
      default:
        poolTypes = [poolType];
        break;
    }
    // Try multiple pool types in case of stolen items
    for (const type of poolTypes) {
      const pool = getModifierPoolForType(type);
      for (const tier of getEnumValues(ModifierTier)) {
        if (!Object.hasOwn(pool, tier)) {
          continue;
        }
        if (pool[tier].find(m => (m as WeightedModifierType).modifierType.id === this.id)) {
          return (this.tier = tier);
        }
      }
    }
    return null;
  }

  /**
   * Populates item id for ModifierType instance
   * @param func
   */
  withIdFromFunc(func: ModifierTypeFunc): ModifierType {
    this.id = Object.keys(modifierTypeInitObj).find(k => modifierTypeInitObj[k] === func)!; // TODO: is this bang correct?
    return this;
  }

  /**
   * Populates item tier for ModifierType instance
   * Tier is a necessary field for items that appear in player shop (determines the Pokeball visual they use)
   * To find the tier, this function performs a reverse lookup of the item type in modifier pools
   * It checks the weight of the item and will use the first tier for which the weight is greater than 0
   * This is to allow items to be in multiple item pools depending on the conditions, for example for events
   * If all tiers have a weight of 0 for the item, the first tier where the item was found is used
   * @param poolType Default 'ModifierPoolType.PLAYER'. Which pool to lookup item tier from
   * @param party optional. Needed to check the weight of modifiers with conditional weight (see {@linkcode WeightedModifierTypeWeightFunc})
   *  if not provided or empty, the weight check will be ignored
   * @param rerollCount Default `0`. Used to check the weight of modifiers with conditional weight (see {@linkcode WeightedModifierTypeWeightFunc})
   */
  withTierFromPool(
    poolType: ModifierPoolType = ModifierPoolType.PLAYER,
    party?: PlayerPokemon[],
    rerollCount = 0,
  ): ModifierType {
    let defaultTier: undefined | ModifierTier;
    for (const tier of Object.values(getModifierPoolForType(poolType))) {
      for (const modifier of tier) {
        if (this.id === modifier.modifierType.id) {
          let weight: number;
          if (modifier.weight instanceof Function) {
            weight = party ? modifier.weight(party, rerollCount) : 0;
          } else {
            weight = modifier.weight;
          }
          if (weight > 0) {
            this.tier = modifier.modifierType.tier;
            return this;
          }
          if (defaultTier == null) {
            // If weight is 0, keep track of the first tier where the item was found
            defaultTier = modifier.modifierType.tier;
          }
        }
      }
    }

    // Didn't find a pool with weight > 0, fallback to first tier where the item was found, if any
    if (defaultTier) {
      this.tier = defaultTier;
    }

    return this;
  }

  newModifier(...args: any[]): Modifier | null {
    // biome-ignore lint/complexity/useOptionalChain: Changing to optional would coerce null return into undefined
    return this.newModifierFunc && this.newModifierFunc(this, args);
  }
}

type ModifierTypeGeneratorFunc = (party: readonly Pokemon[], pregenArgs?: any[]) => ModifierType | null;

export class ModifierTypeGenerator extends ModifierType {
  private genTypeFunc: ModifierTypeGeneratorFunc;

  constructor(genTypeFunc: ModifierTypeGeneratorFunc, stableId?: string) {
    super(null, null, null);
    this.genTypeFunc = genTypeFunc;
    if (stableId) {
      this.id = stableId;
    }
  }

  generateType(party: readonly Pokemon[], pregenArgs?: any[]) {
    const ret = this.genTypeFunc(party, pregenArgs);
    if (ret) {
      // A direct dynamic factory may already carry its canonical identity
      // (Berry/BaseStat/AttackType/etc.). Do not erase it merely because a
      // caller constructed the generator outside the reward-pool id fix-up.
      if (typeof this.id === "string" && this.id.length > 0) {
        ret.id = this.id;
      }
      ret.setTier(this.tier);
    }
    return ret;
  }
}

export interface GeneratedPersistentModifierType {
  getPregenArgs(): any[];
}

export class AddPokeballModifierType extends ModifierType {
  private pokeballType: PokeballType;
  private count: number;

  constructor(iconImage: string, pokeballType: PokeballType, count: number) {
    super("", iconImage, (_type, _args) => new AddPokeballModifier(this, pokeballType, count), "pb", "se/pb_bounce_1");
    this.pokeballType = pokeballType;
    this.count = count;
  }

  get name(): string {
    return i18next.t("modifierType:ModifierType.AddPokeballModifierType.name", {
      modifierCount: this.count,
      pokeballName: getPokeballName(this.pokeballType),
    });
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.AddPokeballModifierType.description", {
      modifierCount: this.count,
      pokeballName: getPokeballName(this.pokeballType),
      catchRate:
        getPokeballCatchMultiplier(this.pokeballType) > -1
          ? `${getPokeballCatchMultiplier(this.pokeballType)}x`
          : "100%",
      pokeballAmount: `${globalScene.pokeballCounts[this.pokeballType]}`,
    });
  }
}

export class AddVoucherModifierType extends ModifierType {
  private voucherType: VoucherType;
  private count: number;

  constructor(voucherType: VoucherType, count: number) {
    super(
      "",
      getVoucherTypeIcon(voucherType),
      (_type, _args) => new AddVoucherModifier(this, voucherType, count),
      "voucher",
    );
    this.count = count;
    this.voucherType = voucherType;
  }

  get name(): string {
    return i18next.t("modifierType:ModifierType.AddVoucherModifierType.name", {
      modifierCount: this.count,
      voucherTypeName: getVoucherTypeName(this.voucherType),
    });
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.AddVoucherModifierType.description", {
      modifierCount: this.count,
      voucherTypeName: getVoucherTypeName(this.voucherType),
    });
  }
}

export class PokemonModifierType extends ModifierType {
  public selectFilter: PokemonSelectFilter | undefined;

  constructor(
    localeKey: string,
    iconImage: string,
    newModifierFunc: NewModifierFunc,
    selectFilter?: PokemonSelectFilter,
    group?: string,
    soundName?: string,
  ) {
    super(localeKey, iconImage, newModifierFunc, group, soundName);

    this.selectFilter = selectFilter;
  }
}

export class PokemonHeldItemModifierType extends PokemonModifierType {
  constructor(
    localeKey: string,
    iconImage: string,
    newModifierFunc: NewModifierFunc,
    group?: string,
    soundName?: string,
  ) {
    super(
      localeKey,
      iconImage,
      newModifierFunc,
      (pokemon: PlayerPokemon) => {
        const dummyModifier = this.newModifier(pokemon);
        const matchingModifier = globalScene.findModifier(
          m => m instanceof PokemonHeldItemModifier && m.pokemonId === pokemon.id && m.matchType(dummyModifier),
        ) as PokemonHeldItemModifier;
        const maxStackCount = dummyModifier.getMaxStackCount();
        if (!maxStackCount) {
          return i18next.t("modifierType:ModifierType.PokemonHeldItemModifierType.extra.inoperable", {
            pokemonName: getPokemonNameWithAffix(pokemon),
          });
        }
        if (matchingModifier && matchingModifier.stackCount === maxStackCount) {
          return i18next.t("modifierType:ModifierType.PokemonHeldItemModifierType.extra.tooMany", {
            pokemonName: getPokemonNameWithAffix(pokemon),
          });
        }
        return null;
      },
      group,
      soundName,
    );
  }

  newModifier(...args: any[]): PokemonHeldItemModifier {
    return super.newModifier(...args) as PokemonHeldItemModifier;
  }
}

export class TerastallizeModifierType extends PokemonModifierType {
  private teraType: PokemonType;

  constructor(teraType: PokemonType) {
    super(
      "",
      `${PokemonType[teraType].toLowerCase()}_tera_shard`,
      (type, args) => new TerastallizeModifier(type as TerastallizeModifierType, (args[0] as Pokemon).id, teraType),
      (pokemon: PlayerPokemon) => {
        if (
          [pokemon.species.speciesId, pokemon.fusionSpecies?.speciesId].filter(
            s => s === SpeciesId.TERAPAGOS || s === SpeciesId.OGERPON || s === SpeciesId.SHEDINJA,
          ).length > 0
        ) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "tera_shard",
    );

    this.teraType = teraType;
  }

  get name(): string {
    return i18next.t("modifierType:ModifierType.TerastallizeModifierType.name", {
      teraType: i18next.t(`pokemonInfo:type.${toCamelCase(PokemonType[this.teraType])}`),
    });
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.TerastallizeModifierType.description", {
      teraType: i18next.t(`pokemonInfo:type.${toCamelCase(PokemonType[this.teraType])}`),
    });
  }

  getPregenArgs(): any[] {
    return [this.teraType];
  }
}

export class PokemonHpRestoreModifierType extends PokemonModifierType {
  protected restorePoints: number;
  protected restorePercent: number;
  protected healStatus: boolean;

  constructor(
    localeKey: string,
    iconImage: string,
    restorePoints: number,
    restorePercent: number,
    healStatus = false,
    newModifierFunc?: NewModifierFunc,
    selectFilter?: PokemonSelectFilter,
    group?: string,
  ) {
    super(
      localeKey,
      iconImage,
      newModifierFunc
        || ((_type, args) =>
          new PokemonHpRestoreModifier(
            this,
            (args[0] as PlayerPokemon).id,
            this.restorePoints,
            this.restorePercent,
            this.healStatus,
            false,
          )),
      selectFilter
        || ((pokemon: PlayerPokemon) => {
          if (
            !pokemon.hp
            || (pokemon.isFullHp()
              && (!this.healStatus
                || (!pokemon.status && !pokemon.getTag(BattlerTagType.CONFUSED) && !hasErAilment(pokemon))))
          ) {
            return PartyUiHandler.NoEffectMessage;
          }
          return null;
        }),
      group || "potion",
    );

    this.restorePoints = restorePoints;
    this.restorePercent = restorePercent;
    this.healStatus = healStatus;
  }

  getDescription(): string {
    return this.restorePoints
      ? i18next.t("modifierType:ModifierType.PokemonHpRestoreModifierType.description", {
          restorePoints: this.restorePoints,
          restorePercent: this.restorePercent,
        })
      : this.healStatus
        ? i18next.t("modifierType:ModifierType.PokemonHpRestoreModifierType.extra.fullyWithStatus")
        : i18next.t("modifierType:ModifierType.PokemonHpRestoreModifierType.extra.fully");
  }
}

export class PokemonReviveModifierType extends PokemonHpRestoreModifierType {
  constructor(localeKey: string, iconImage: string, restorePercent: number) {
    super(
      localeKey,
      iconImage,
      0,
      restorePercent,
      false,
      (_type, args) =>
        new PokemonHpRestoreModifier(this, (args[0] as PlayerPokemon).id, 0, this.restorePercent, false, true),
      (pokemon: PlayerPokemon) => {
        if (!pokemon.isFainted()) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "revive",
    );

    this.selectFilter = (pokemon: PlayerPokemon) => {
      const selectStatus = new BooleanHolder(pokemon.hp !== 0);
      applyChallenges(ChallengeType.PREVENT_REVIVE, selectStatus);
      if (selectStatus.value) {
        return PartyUiHandler.NoEffectMessage;
      }
      return null;
    };
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonReviveModifierType.description", {
      restorePercent: this.restorePercent,
    });
  }
}

export class PokemonStatusHealModifierType extends PokemonModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new PokemonStatusHealModifier(this, (args[0] as PlayerPokemon).id),
      (pokemon: PlayerPokemon) => {
        if (!pokemon.hp || (!pokemon.status && !pokemon.getTag(BattlerTagType.CONFUSED) && !hasErAilment(pokemon))) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
    );
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonStatusHealModifierType.description");
  }
}

export abstract class PokemonMoveModifierType extends PokemonModifierType {
  public moveSelectFilter: PokemonMoveSelectFilter | undefined;

  constructor(
    localeKey: string,
    iconImage: string,
    newModifierFunc: NewModifierFunc,
    selectFilter?: PokemonSelectFilter,
    moveSelectFilter?: PokemonMoveSelectFilter,
    group?: string,
  ) {
    super(localeKey, iconImage, newModifierFunc, selectFilter, group);

    this.moveSelectFilter = moveSelectFilter;
  }
}

export class PokemonPpRestoreModifierType extends PokemonMoveModifierType {
  protected restorePoints: number;

  constructor(localeKey: string, iconImage: string, restorePoints: number) {
    super(
      localeKey,
      iconImage,
      (_type, args) =>
        new PokemonPpRestoreModifier(this, (args[0] as PlayerPokemon).id, args[1] as number, this.restorePoints),
      (_pokemon: PlayerPokemon) => {
        return null;
      },
      (pokemonMove: PokemonMove) => {
        if (!pokemonMove.ppUsed) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "ether",
    );

    this.restorePoints = restorePoints;
  }

  getDescription(): string {
    return this.restorePoints > -1
      ? i18next.t("modifierType:ModifierType.PokemonPpRestoreModifierType.description", {
          restorePoints: this.restorePoints,
        })
      : i18next.t("modifierType:ModifierType.PokemonPpRestoreModifierType.extra.fully");
  }
}

export class PokemonAllMovePpRestoreModifierType extends PokemonModifierType {
  protected restorePoints: number;

  constructor(localeKey: string, iconImage: string, restorePoints: number) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new PokemonAllMovePpRestoreModifier(this, (args[0] as PlayerPokemon).id, this.restorePoints),
      (pokemon: PlayerPokemon) => {
        if (pokemon.getMoveset().filter(m => m.ppUsed).length === 0) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "elixir",
    );

    this.restorePoints = restorePoints;
  }

  getDescription(): string {
    return this.restorePoints > -1
      ? i18next.t("modifierType:ModifierType.PokemonAllMovePpRestoreModifierType.description", {
          restorePoints: this.restorePoints,
        })
      : i18next.t("modifierType:ModifierType.PokemonAllMovePpRestoreModifierType.extra.fully");
  }
}

export class PokemonPpUpModifierType extends PokemonMoveModifierType {
  protected upPoints: number;

  constructor(localeKey: string, iconImage: string, upPoints: number) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new PokemonPpUpModifier(this, (args[0] as PlayerPokemon).id, args[1] as number, this.upPoints),
      (_pokemon: PlayerPokemon) => {
        return null;
      },
      (pokemonMove: PokemonMove) => {
        if (pokemonMove.getMove().pp < 5 || pokemonMove.ppUp >= 3 || pokemonMove.maxPpOverride) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "ppUp",
    );

    this.upPoints = upPoints;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonPpUpModifierType.description", { upPoints: this.upPoints });
  }
}

export class PokemonNatureChangeModifierType extends PokemonModifierType {
  protected nature: Nature;

  constructor(nature: Nature) {
    super(
      "",
      `mint_${
        getEnumKeys(Stat)
          .find(s => getNatureStatMultiplier(nature, Stat[s]) > 1)
          ?.toLowerCase() || "neutral"
      }`,
      (_type, args) => new PokemonNatureChangeModifier(this, (args[0] as PlayerPokemon).id, this.nature),
      (pokemon: PlayerPokemon) => {
        if (pokemon.getNature() === this.nature) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "mint",
    );

    this.nature = nature;
  }

  get name(): string {
    return i18next.t("modifierType:ModifierType.PokemonNatureChangeModifierType.name", {
      natureName: getNatureName(this.nature),
    });
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonNatureChangeModifierType.description", {
      natureName: getNatureName(this.nature, true, true, true),
    });
  }
}

/**
 * Marker base for ER ability-targeting consumables. Modifiers of this type make
 * the SelectModifierPhase open the party in {@linkcode PartyUiMode.ABILITY_MODIFIER}
 * so the player can pick which ability slot to act on; the chosen slot index is
 * forwarded to `newModifier(pokemon, slotIndex)`.
 */
export abstract class PokemonAbilityModifierType extends PokemonModifierType {}

/**
 * ER Rogue-tier consumable: randomizes one chosen ability slot of a Pokémon
 * (active ability or an ER innate) to any ability in the game (except Truant /
 * Slow Start). Names/descriptions are hardcoded in English here as this is an
 * ER-custom item not present in the shared locales.
 */
export class PokemonRandomizeAbilityModifierType extends PokemonAbilityModifierType {
  constructor() {
    super(
      "",
      "ability_randomizer",
      (_type, args) =>
        new PokemonRandomizeAbilityModifier(this, (args[0] as PlayerPokemon).id, (args[1] as number) ?? 0),
      undefined,
      "ability_capsule",
    );
  }

  get name(): string {
    return "Ability Randomizer";
  }

  getDescription(): string {
    return "Randomizes one chosen ability (or innate) into any ability (except Truant and Slow Start).";
  }
}

/**
 * ER Greater Ability Randomizer (Master-Ball tier - a pink reskin of the Ability
 * Randomizer). Unlike the Randomizer (which instantly rolls one ability into the
 * chosen slot), this one is interactive: the player picks a slot, is shown 4 random
 * abilities WITH descriptions in a chooser, and picks one to replace that slot.
 * Because of the chooser step it is a plain {@linkcode PokemonModifierType} (it only
 * picks the mon on the reward screen); the slot pick + 4-ability picker are driven by
 * {@linkcode ErGreaterAbilityRandomizerPhase}. Pink reskin via `iconTint`.
 */
export class ErGreaterAbilityRandomizerModifierType extends PokemonModifierType {
  constructor() {
    super(
      "",
      "ability_randomizer",
      (type, args) => new ErGreaterAbilityRandomizerModifier(type, (args[0] as PlayerPokemon).id),
      undefined,
      "ability_capsule",
    );
    // Pink reskin of the (already vitamin-reskinned) Ability Randomizer frame so
    // the reward shop + biome shop show the recolored icon (the #437 type-tint path).
    this.iconTint = 0xff7ad0;
  }

  get name(): string {
    return i18next.t("modifierType:erGreaterAbilityRandomizer.name");
  }

  getDescription(): string {
    return i18next.t("modifierType:erGreaterAbilityRandomizer.description");
  }
}

/**
 * ER Rogue-tier consumable: grants a Pokémon a permanent 5th move slot. Only
 * applicable once per Pokémon (the select filter blocks re-use).
 */
export class PokemonAddMoveSlotModifierType extends PokemonModifierType {
  constructor() {
    super(
      "",
      "move_slot_expander",
      // args[1] is the learnable-move index chosen in the REMEMBER_MOVE party UI.
      (type, args) => new PokemonAddMoveSlotModifier(type, (args[0] as PlayerPokemon).id, args[1] as number),
      (pokemon: PlayerPokemon) => {
        if (pokemon.customPokemonData.bonusMoveSlots >= PokemonAddMoveSlotModifier.MAX_BONUS_SLOTS) {
          return PartyUiHandler.NoEffectMessage;
        }
        // Needs at least one learnable move to fill the new slot.
        if (pokemon.getLearnableLevelMoves().length === 0) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
    );
    this.id = "MOVE_SLOT_EXPANDER";
  }

  get name(): string {
    return "Move Slot Expander";
  }

  getDescription(): string {
    return "Permanently grants a Pokémon a 5th move slot.";
  }
}

/**
 * The `modifierTypeInitObj` registry key for a community-item kind, i.e.
 * `ER_<SCREAMING_SNAKE(kind)>` ("powerHerb" -> "ER_POWER_HERB"). Community items
 * are often trainer-held or event-granted, so they skip the reward-screen id
 * fix-up; without a pinned `type.id`, {@linkcode ModifierData} records `typeId=""`
 * and on load `getModifierTypeFuncById("")` is `undefined`, so the item is silently
 * dropped on reload/Continue (same failure mode as the ER gems/relics). Deriving
 * the id here pins it for EVERY grant path. (er-item-save-persistence.test asserts
 * every kind's id resolves, so a kind that breaks the convention fails loudly.)
 */
export function erCommunityItemTypeId(kind: ErCommunityItemKind): string {
  return `ER_${kind.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
}

/**
 * ER community held items (#387): build the ModifierType for a community item
 * kind (live name/description from the config; icon = existing atlas frame,
 * tinted by the modifier's getIcon override).
 */
export function erCommunityItemModifierType(kind: ErCommunityItemKind): PokemonHeldItemModifierType {
  const cfg = ER_COMMUNITY_ITEM_CONFIG[kind];
  const type = new PokemonHeldItemModifierType(
    "",
    cfg.icon,
    (t, args) => new ErCommunityItemModifier(t, (args[0] as Pokemon).id, kind),
  );
  // Pin the registry id so the item survives save/load no matter how it was
  // granted (see erCommunityItemTypeId).
  type.id = erCommunityItemTypeId(kind);
  Object.defineProperty(type, "name", { get: () => cfg.name });
  type.getDescription = () => cfg.description;
  // Carry the reskin tint on the type so the SHOP shows the recolored icon
  // too (#437) - without it a Copper Rod offer rendered as a plain Quick Claw.
  type.iconTint = cfg.tint;
  return type;
}

/**
 * ER relic (#439): build the ModifierType for a relic kind (live name/
 * description from the config; icon = an existing atlas frame, tinted via the
 * modifier's getIcon override and the type's iconTint so the shop matches).
 */
/**
 * The `modifierTypeInitObj` registry key for a relic kind, i.e.
 * `ER_RELIC_<SCREAMING_SNAKE(kind)>` ("cursedIdol" -> "ER_RELIC_CURSED_IDOL").
 * Relics are granted off-pool (Giratina's Bargain, abyss events), so they never
 * pass through the reward-screen id fix-up in {@linkcode getPlayerModifierTypeOptions}
 * - and the Bargain in particular wraps each func in a fresh arrow, so even that
 * reverse-lookup misses. Without a `type.id`, {@linkcode ModifierData} records
 * `typeId=""`, and on load `getModifierTypeFuncById("")` is `undefined`, so the
 * relic is silently dropped on reload/Continue. Deriving the id here pins it for
 * EVERY grant path. (er-relic-save-persistence.test asserts the convention holds
 * for all registered relics, so a future kind that breaks it fails loudly.)
 */
function erRelicTypeId(kind: ErRelicKind): string {
  return `ER_RELIC_${kind.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
}

export function erRelicModifierType(kind: ErRelicKind): ModifierType {
  const cfg = ER_RELIC_CONFIG[kind];
  const type = new ModifierType("", cfg.icon, (t, _args) => new ErRelicModifier(t, kind));
  // Pin the registry id so the relic survives save/load no matter how it was
  // granted (see erRelicTypeId).
  type.id = erRelicTypeId(kind);
  Object.defineProperty(type, "name", { get: () => cfg.name });
  type.getDescription = () => cfg.description;
  type.iconTint = cfg.tint;
  // Relics are not in any modifier pool, so their tier would otherwise stay
  // undefined - which makes the reward screen build its pokeball sprite from a
  // NaN frame and render blank (the relic looked "missing" in the reward UI).
  // Pin them to MASTER so they show with a Master Ball, the top-tier prize they
  // are. (withTierFromPool keeps this, since no pool entry overrides it.)
  type.setTier(ModifierTier.MASTER);
  return type;
}

/**
 * ER Ability Capsule (#387, community batch): on use, offers a CHOICE - cycle the
 * mon's ACTIVE ability through its species' legal abilities (1 -> 2 -> hidden), OR
 * "unlock an innate for the run" (force-unlock one currently-LOCKED innate slot for
 * THIS RUN ONLY; never a permanent candy unlock). The choice + sub-picker are driven
 * by {@linkcode ErAbilityCapsulePhase}. Applicable to any mon that can do EITHER. The
 * name + the two option labels are English hardcoded / i18n'd under the `modifierType`
 * namespace (ER-custom item, no shared locale entry).
 */
export class ErAbilityCapsuleModifierType extends PokemonModifierType {
  constructor() {
    super(
      "",
      "ability_capsule",
      (type, args) => new ErAbilityCapsuleModifier(type, (args[0] as PlayerPokemon).id),
      (pokemon: PlayerPokemon) => {
        // Usable if the mon can cycle its active ability (>= 2 distinct legal
        // abilities) OR has at least one currently-locked innate to run-unlock.
        if (!ErAbilityCapsuleModifier.canCycleActiveAbility(pokemon) && !erHasRunUnlockableInnate(pokemon)) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
    );
  }

  get name(): string {
    return "Ability Capsule";
  }

  getDescription(): string {
    return "Change a Pokémon's active ability (1 -> 2 -> hidden), or unlock one of its locked innates for the run.";
  }
}

/**
 * ER Greater Ability Capsule (the rarer, stronger Ability Capsule - a violet
 * reskin). On use, offers a CHOICE: PERMANENTLY unlock ONE innate slot (the real
 * candy-style unlock - stays unlocked in starter-select + future runs), OR
 * run-unlock TWO innate slots for THIS RUN ONLY. Applicable to any mon with at
 * least one currently-locked innate. The choice + sub-pickers are driven by
 * {@linkcode ErGreaterAbilityCapsulePhase}. Violet reskin via `iconTint`.
 */
export class ErGreaterAbilityCapsuleModifierType extends PokemonModifierType {
  constructor() {
    super(
      "",
      "ability_capsule",
      (type, args) => new ErGreaterAbilityCapsuleModifier(type, (args[0] as PlayerPokemon).id),
      (pokemon: PlayerPokemon) => {
        // Usable only if the mon has at least one currently-locked innate to act on
        // (both options - permanent-unlock-one and run-unlock-two - draw from that set).
        if (!greaterCapsuleHasAnyOption(pokemon)) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
    );
    // Violet reskin of the Ability Capsule frame so the reward + biome shop show
    // the recolored icon (the #437 type-tint path).
    this.iconTint = 0x9a4ce0;
  }

  get name(): string {
    return i18next.t("modifierType:erGreaterAbilityCapsule.name");
  }

  getDescription(): string {
    return i18next.t("modifierType:erGreaterAbilityCapsule.description");
  }
}

/**
 * ER Learner's Shroom (#404, community batch): teaches a Pokemon ANY move it
 * is capable of learning - TMs, ER tutor moves, egg moves (no unlock needed)
 * and already-reached level-up moves. Future level-up moves stay gated behind
 * leveling. Opens the dedicated move-picker party-UI mode.
 */
export class ErLearnersShroomModifierType extends PokemonModifierType {
  constructor() {
    super(
      "",
      "learners_shroom",
      (type, args) => new ErLearnersShroomModifier(type, (args[0] as PlayerPokemon).id, args[1] as number),
      (pokemon: PlayerPokemon) => {
        if (pokemon.getErLearnableShroomMoves().length === 0) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
    );
  }

  get name(): string {
    return "Learner's Shroom";
  }

  getDescription(): string {
    return "Teaches a Pokémon any move it can learn from TMs, tutors or egg moves, your choice. Future level-up moves stay locked.";
  }
}

/**
 * ER TM Case: a single-use universal TM. The player picks a party Pokemon, then
 * picks ANY ONE move from that Pokemon's COMPATIBLE TM list (the moves it can
 * still learn, see {@linkcode PlayerPokemon.getErTmCaseMoves}), and it is taught
 * via {@linkcode LearnMovePhase}. Consumed after teaching one move. Mirrors the
 * Learner's Shroom flow, but the move list is the compatible-TM list instead of
 * everything-learnable. Opens the dedicated ER_TM_CASE_MODIFIER party-UI mode.
 */
export class ErTmCaseModifierType extends PokemonModifierType {
  constructor() {
    super(
      "",
      "tm_case",
      (type, args) => new ErTmCaseModifier(type, (args[0] as PlayerPokemon).id, args[1] as number),
      (pokemon: PlayerPokemon) => {
        if (pokemon.getErTmCaseMoves().length === 0) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
    );
  }

  get name(): string {
    return "TM Case";
  }

  getDescription(): string {
    return "Teach a Pokemon any one move from its TM list.";
  }
}

/**
 * ER Frostbite Orb (#387, community batch): the Toxic/Flame Orb sibling for
 * ER's Frostbite status (freeze does not exist in ER). The modifier reuses the
 * vanilla {@linkcode TurnStatusEffectModifier} plumbing via the FREEZE ->
 * ER_FROSTBITE reroute in `Pokemon.trySetStatus`.
 */
export class ErFrostbiteOrbModifierType extends PokemonHeldItemModifierType {
  constructor() {
    super("", "frostbite_orb", (type, args) => new TurnStatusEffectModifier(type, (args[0] as Pokemon).id));
    this.id = "FROSTBITE_ORB";
  }

  get name(): string {
    return "Frostbite Orb";
  }

  getDescription(): string {
    return "Inflicts Frostbite on the holder at the end of each turn. Useful for abilities triggered by status conditions.";
  }
}

/**
 * ER Dex Nav (#392, community batch): a consumable that scans the current
 * biome and lets the player register 2 of its wild species in the Pokédex as
 * caught (via {@linkcode ErDexNavPhase}).
 */
export class ErDexNavModifierType extends ModifierType {
  constructor() {
    super("", "dex_nav", (type, _args) => new ErDexNavModifier(type));
  }

  get name(): string {
    return "Dex Nav";
  }

  getDescription(): string {
    return "Scans the current biome and registers 2 wild Pokémon of your choice in the Pokédex, as if caught.";
  }
}

export class RememberMoveModifierType extends PokemonModifierType {
  constructor(localeKey: string, iconImage: string, group?: string) {
    super(
      localeKey,
      iconImage,
      (type, args) => new RememberMoveModifier(type, (args[0] as PlayerPokemon).id, args[1] as number),
      (pokemon: PlayerPokemon) => {
        if (pokemon.getLearnableLevelMoves().length === 0) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      group,
    );
  }
}

export class DoubleBattleChanceBoosterModifierType extends ModifierType {
  private maxBattles: number;

  constructor(localeKey: string, iconImage: string, maxBattles: number) {
    super(localeKey, iconImage, (_type, _args) => new DoubleBattleChanceBoosterModifier(this, maxBattles), "lure");

    this.maxBattles = maxBattles;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.DoubleBattleChanceBoosterModifierType.description", {
      battleCount: this.maxBattles,
    });
  }
}

export class TempStatStageBoosterModifierType extends ModifierType implements GeneratedPersistentModifierType {
  private stat: TempBattleStat;
  private nameKey: string;
  private quantityKey: string;

  constructor(stat: TempBattleStat) {
    const nameKey = TempStatStageBoosterModifierTypeGenerator.items[stat];
    super("", nameKey, (_type, _args) => new TempStatStageBoosterModifier(this, this.stat, 5));

    this.stat = stat;
    this.nameKey = nameKey;
    this.quantityKey = stat === Stat.ACC ? "stage" : "percentage";
  }

  get name(): string {
    return i18next.t(`modifierType:TempStatStageBoosterItem.${this.nameKey}`);
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.TempStatStageBoosterModifierType.description", {
      stat: i18next.t(getStatKey(this.stat)),
      amount: i18next.t(`modifierType:ModifierType.TempStatStageBoosterModifierType.extra.${this.quantityKey}`),
    });
  }

  getPregenArgs(): any[] {
    return [this.stat];
  }
}

export class BerryModifierType extends PokemonHeldItemModifierType implements GeneratedPersistentModifierType {
  private berryType: BerryType;

  constructor(berryType: BerryType) {
    super(
      "",
      `${BerryType[berryType].toLowerCase()}_berry`,
      (type, args) => new BerryModifier(type, (args[0] as Pokemon).id, berryType),
      "berry",
    );

    this.berryType = berryType;
    this.id = "BERRY"; // needed to prevent harvest item deletion; remove after modifier rework
  }

  get name(): string {
    return getBerryName(this.berryType);
  }

  getDescription(): string {
    return getBerryEffectDescription(this.berryType);
  }

  getPregenArgs(): any[] {
    return [this.berryType];
  }
}

enum AttackTypeBoosterItem {
  SILK_SCARF,
  BLACK_BELT,
  SHARP_BEAK,
  POISON_BARB,
  SOFT_SAND,
  HARD_STONE,
  SILVER_POWDER,
  SPELL_TAG,
  METAL_COAT,
  CHARCOAL,
  MYSTIC_WATER,
  MIRACLE_SEED,
  MAGNET,
  TWISTED_SPOON,
  NEVER_MELT_ICE,
  DRAGON_FANG,
  BLACK_GLASSES,
  FAIRY_FEATHER,
}

export class AttackTypeBoosterModifierType
  extends PokemonHeldItemModifierType
  implements GeneratedPersistentModifierType
{
  public moveType: PokemonType;
  public boostPercent: number;

  constructor(moveType: PokemonType, boostPercent: number) {
    super(
      "",
      `${AttackTypeBoosterItem[moveType]?.toLowerCase()}`,
      (_type, args) => new AttackTypeBoosterModifier(this, (args[0] as Pokemon).id, moveType, boostPercent),
    );

    this.moveType = moveType;
    this.boostPercent = boostPercent;
    // The move type is carried in getPregenArgs; every concrete variant shares
    // the generator's canonical persistence identity.
    this.id = "ATTACK_TYPE_BOOSTER";
  }

  get name(): string {
    return i18next.t(`modifierType:AttackTypeBoosterItem.${AttackTypeBoosterItem[this.moveType]?.toLowerCase()}`);
  }

  getDescription(): string {
    // TODO: Need getTypeName?
    return i18next.t("modifierType:ModifierType.AttackTypeBoosterModifierType.description", {
      moveType: i18next.t(`pokemonInfo:type.${toCamelCase(PokemonType[this.moveType])}`),
    });
  }

  getPregenArgs(): any[] {
    return [this.moveType];
  }
}

export type SpeciesStatBoosterItem = keyof typeof SpeciesStatBoosterModifierTypeGenerator.items;

/** Modifier type for {@linkcode SpeciesStatBoosterModifier} */
export class SpeciesStatBoosterModifierType
  extends PokemonHeldItemModifierType
  implements GeneratedPersistentModifierType
{
  public key: SpeciesStatBoosterItem;

  constructor(key: SpeciesStatBoosterItem) {
    const item = SpeciesStatBoosterModifierTypeGenerator.items[key];
    super(
      `modifierType:SpeciesBoosterItem.${key}`,
      key.toLowerCase(),
      (type, args) =>
        new SpeciesStatBoosterModifier(type, (args[0] as Pokemon).id, item.stats, item.multiplier, item.species),
    );

    this.key = key;
    // A generator may overwrite this with RARE_SPECIES_STAT_BOOSTER. Direct
    // trainer-item construction uses the ordinary canonical registry entry.
    this.id = "SPECIES_STAT_BOOSTER";
  }

  getPregenArgs(): any[] {
    return [this.key];
  }
}

export class PokemonLevelIncrementModifierType extends PokemonModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new PokemonLevelIncrementModifier(this, (args[0] as PlayerPokemon).id),
      (_pokemon: PlayerPokemon) => null,
    );
  }

  getDescription(): string {
    let levels = 1;
    const hasCandyJar = globalScene.modifiers.find(modifier => modifier instanceof LevelIncrementBoosterModifier);
    if (hasCandyJar) {
      levels += hasCandyJar.stackCount;
    }
    return i18next.t("modifierType:ModifierType.PokemonLevelIncrementModifierType.description", { levels });
  }
}

export class AllPokemonLevelIncrementModifierType extends ModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(localeKey, iconImage, (_type, _args) => new PokemonLevelIncrementModifier(this, -1));
  }

  getDescription(): string {
    let levels = 1;
    const hasCandyJar = globalScene.modifiers.find(modifier => modifier instanceof LevelIncrementBoosterModifier);
    if (hasCandyJar) {
      levels += hasCandyJar.stackCount;
    }
    return i18next.t("modifierType:ModifierType.AllPokemonLevelIncrementModifierType.description", { levels });
  }
}

export class BaseStatBoosterModifierType
  extends PokemonHeldItemModifierType
  implements GeneratedPersistentModifierType
{
  private stat: PermanentStat;
  private key: string;

  constructor(stat: PermanentStat) {
    const key = BaseStatBoosterModifierTypeGenerator.items[stat];
    super("", key, (_type, args) => new BaseStatModifier(this, (args[0] as Pokemon).id, this.stat));

    this.stat = stat;
    this.key = key;
    // The stat variant is carried in getPregenArgs/getArgs; direct event and
    // trainer grants must still be serializable before any pool fix-up runs.
    this.id = "BASE_STAT_BOOSTER";
  }

  get name(): string {
    return i18next.t(`modifierType:BaseStatBoosterItem.${this.key}`);
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.BaseStatBoosterModifierType.description", {
      stat: i18next.t(getStatKey(this.stat)),
    });
  }

  getPregenArgs(): any[] {
    return [this.stat];
  }
}

/**
 * Shuckle Juice item
 */
export class PokemonBaseStatTotalModifierType
  extends PokemonHeldItemModifierType
  implements GeneratedPersistentModifierType
{
  private readonly statModifier: 10 | -15;

  constructor(statModifier: 10 | -15) {
    super(
      statModifier > 0
        ? "modifierType:ModifierType.MYSTERY_ENCOUNTER_SHUCKLE_JUICE_GOOD"
        : "modifierType:ModifierType.MYSTERY_ENCOUNTER_SHUCKLE_JUICE_BAD",
      statModifier > 0 ? "berry_juice_good" : "berry_juice_bad",
      (_type, args) => new PokemonBaseStatTotalModifier(this, (args[0] as Pokemon).id, statModifier),
    );
    this.statModifier = statModifier;
  }

  override getDescription(): string {
    return this.statModifier > 0
      ? i18next.t("modifierType:ModifierType.MYSTERY_ENCOUNTER_SHUCKLE_JUICE_GOOD.description")
      : i18next.t("modifierType:ModifierType.MYSTERY_ENCOUNTER_SHUCKLE_JUICE_BAD.description");
  }

  public getPregenArgs(): any[] {
    return [this.statModifier];
  }
}

class AllPokemonFullHpRestoreModifierType extends ModifierType {
  private descriptionKey: string;

  constructor(localeKey: string, iconImage: string, descriptionKey?: string, newModifierFunc?: NewModifierFunc) {
    super(
      localeKey,
      iconImage,
      newModifierFunc || ((_type, _args) => new PokemonHpRestoreModifier(this, -1, 0, 100, false)),
    );

    this.descriptionKey = descriptionKey!; // TODO: is this bang correct?
  }

  getDescription(): string {
    return i18next.t(
      `${this.descriptionKey || "modifierType:ModifierType.AllPokemonFullHpRestoreModifierType"}.description` as any,
    );
  }
}

class AllPokemonFullReviveModifierType extends AllPokemonFullHpRestoreModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(
      localeKey,
      iconImage,
      "modifierType:ModifierType.AllPokemonFullReviveModifierType",
      (_type, _args) => new PokemonHpRestoreModifier(this, -1, 0, 100, false, true),
    );
    this.group = "revive";
  }
}

export class MoneyRewardModifierType extends ModifierType {
  private moneyMultiplier: number;
  private moneyMultiplierDescriptorKey: string;

  constructor(localeKey: string, iconImage: string, moneyMultiplier: number, moneyMultiplierDescriptorKey: string) {
    super(localeKey, iconImage, (_type, _args) => new MoneyRewardModifier(this, moneyMultiplier), "money", "se/buy");

    this.moneyMultiplier = moneyMultiplier;
    this.moneyMultiplierDescriptorKey = moneyMultiplierDescriptorKey;
  }

  getDescription(): string {
    const moneyAmount = new NumberHolder(globalScene.getWaveMoneyAmount(this.moneyMultiplier));
    globalScene.applyModifiers(MoneyMultiplierModifier, true, moneyAmount);
    const formattedMoney = formatMoney(globalScene.moneyFormat, moneyAmount.value);

    return i18next.t("modifierType:ModifierType.MoneyRewardModifierType.description", {
      moneyMultiplier: i18next.t(this.moneyMultiplierDescriptorKey as any),
      moneyAmount: formattedMoney,
    });
  }
}

export class ExpBoosterModifierType extends ModifierType {
  private boostPercent: number;

  constructor(localeKey: string, iconImage: string, boostPercent: number) {
    super(localeKey, iconImage, () => new ExpBoosterModifier(this, boostPercent));

    this.boostPercent = boostPercent;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.ExpBoosterModifierType.description", {
      boostPercent: this.boostPercent,
    });
  }
}

export class PokemonExpBoosterModifierType extends PokemonHeldItemModifierType {
  private boostPercent: number;

  constructor(localeKey: string, iconImage: string, boostPercent: number) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new PokemonExpBoosterModifier(this, (args[0] as Pokemon).id, boostPercent),
    );

    this.boostPercent = boostPercent;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonExpBoosterModifierType.description", {
      boostPercent: this.boostPercent,
    });
  }
}

export class PokemonFriendshipBoosterModifierType extends PokemonHeldItemModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(localeKey, iconImage, (_type, args) => new PokemonFriendshipBoosterModifier(this, (args[0] as Pokemon).id));
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonFriendshipBoosterModifierType.description");
  }
}

export class PokemonMoveAccuracyBoosterModifierType extends PokemonHeldItemModifierType {
  private amount: number;

  constructor(localeKey: string, iconImage: string, amount: number, group?: string, soundName?: string) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new PokemonMoveAccuracyBoosterModifier(this, (args[0] as Pokemon).id, amount),
      group,
      soundName,
    );

    this.amount = amount;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonMoveAccuracyBoosterModifierType.description", {
      accuracyAmount: this.amount,
    });
  }
}

export class PokemonMultiHitModifierType extends PokemonHeldItemModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(
      localeKey,
      iconImage,
      (type, args) => new PokemonMultiHitModifier(type as PokemonMultiHitModifierType, (args[0] as Pokemon).id),
    );
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.PokemonMultiHitModifierType.description");
  }
}

export class TmModifierType extends PokemonModifierType {
  public moveId: MoveId;

  constructor(moveId: MoveId) {
    super(
      "",
      `tm_${PokemonType[allMoves[moveId].type].toLowerCase()}`,
      (_type, args) => new TmModifier(this, (args[0] as PlayerPokemon).id),
      (pokemon: PlayerPokemon) => {
        if (
          pokemon.compatibleTms.indexOf(moveId) === -1
          || pokemon.getMoveset().filter(m => m.moveId === moveId).length > 0
        ) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
      "tm",
    );

    this.moveId = moveId;
  }

  get name(): string {
    return i18next.t("modifierType:ModifierType.TmModifierType.name", {
      moveId: padInt(Object.keys(tmSpecies).indexOf(this.moveId.toString()) + 1, 3),
      moveName: allMoves[this.moveId].name,
    });
  }

  getDescription(): string {
    return i18next.t(
      globalScene.enableMoveInfo
        ? "modifierType:ModifierType.TmModifierTypeWithInfo.description"
        : "modifierType:ModifierType.TmModifierType.description",
      { moveName: allMoves[this.moveId].name },
    );
  }
}

export class EvolutionItemModifierType extends PokemonModifierType implements GeneratedPersistentModifierType {
  public evolutionItem: EvolutionItem;

  constructor(evolutionItem: EvolutionItem) {
    super(
      "",
      EvolutionItem[evolutionItem].toLowerCase(),
      (_type, args) => new EvolutionItemModifier(this, (args[0] as PlayerPokemon).id),
      (pokemon: PlayerPokemon) => {
        if (
          Object.hasOwn(pokemonEvolutions, pokemon.species.speciesId)
          && pokemonEvolutions[pokemon.species.speciesId].filter(e => e.validate(pokemon, false, this.evolutionItem))
            .length > 0
          && pokemon.getFormKey() !== SpeciesFormKey.GIGANTAMAX
        ) {
          return null;
        }
        if (
          pokemon.isFusion()
          && pokemon.fusionSpecies
          && Object.hasOwn(pokemonEvolutions, pokemon.fusionSpecies.speciesId)
          && pokemonEvolutions[pokemon.fusionSpecies.speciesId].filter(e =>
            e.validate(pokemon, true, this.evolutionItem),
          ).length > 0
          && pokemon.getFusionFormKey() !== SpeciesFormKey.GIGANTAMAX
        ) {
          return null;
        }

        return PartyUiHandler.NoEffectMessage;
      },
    );

    this.evolutionItem = evolutionItem;
  }

  get name(): string {
    return i18next.t(`modifierType:EvolutionItem.${EvolutionItem[this.evolutionItem]}`);
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.EvolutionItemModifierType.description");
  }

  getPregenArgs(): any[] {
    return [this.evolutionItem];
  }
}

/**
 * Class that represents form changing items
 */
export class FormChangeItemModifierType extends PokemonModifierType implements GeneratedPersistentModifierType {
  public formChangeItem: FormChangeItem;

  constructor(formChangeItem: FormChangeItem) {
    super(
      "",
      // ER custom stones reuse an existing items-atlas icon frame (the decomp
      // doesn't ship art for ~200 of them); vanilla stones use their own frame.
      isErMegaStone(formChangeItem)
        ? (erMegaStoneIconFrame(formChangeItem) ?? FormChangeItem[formChangeItem].toLowerCase())
        : FormChangeItem[formChangeItem].toLowerCase(),
      (_type, args) => new PokemonFormChangeItemModifier(this, (args[0] as PlayerPokemon).id, formChangeItem, true),
      (pokemon: PlayerPokemon) => {
        // Make sure the Pokemon has alternate forms
        if (
          Object.hasOwn(pokemonFormChanges, pokemon.species.speciesId) // Get all form changes for this species with an item trigger, including any compound triggers
          && pokemonFormChanges[pokemon.species.speciesId]
            .filter(
              fc => fc.trigger.hasTriggerType(SpeciesFormChangeItemTrigger) && fc.preFormKey === pokemon.getFormKey(),
            )
            // Returns true if any form changes match this item
            .flatMap(fc => fc.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger)
            .flatMap(fc => fc.item)
            .includes(this.formChangeItem)
        ) {
          return null;
        }

        return PartyUiHandler.NoEffectMessage;
      },
    );

    this.formChangeItem = formChangeItem;
  }

  get name(): string {
    // ER custom stones have no locale entry — title-case the enum name
    // (BUTTERFRENITE -> "Butterfrenite", VENUSAURITE_X -> "Venusaurite X").
    if (isErMegaStone(this.formChangeItem)) {
      return FormChangeItem[this.formChangeItem]
        .toLowerCase()
        .split("_")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
    return i18next.t(`modifierType:FormChangeItem.${FormChangeItem[this.formChangeItem]}`);
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.FormChangeItemModifierType.description");
  }

  getPregenArgs(): any[] {
    return [this.formChangeItem];
  }
}

export class FusePokemonModifierType extends PokemonModifierType {
  constructor(localeKey: string, iconImage: string) {
    super(
      localeKey,
      iconImage,
      (_type, args) => new FusePokemonModifier(this, (args[0] as PlayerPokemon).id, (args[1] as PlayerPokemon).id),
      (pokemon: PlayerPokemon) => {
        const selectStatus = new BooleanHolder(pokemon.isFusion());
        applyChallenges(ChallengeType.POKEMON_FUSION, pokemon, selectStatus);
        if (selectStatus.value) {
          return PartyUiHandler.NoEffectMessage;
        }
        return null;
      },
    );
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.FusePokemonModifierType.description");
  }
}

class AttackTypeBoosterModifierTypeGenerator extends ModifierTypeGenerator {
  constructor() {
    super((party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in PokemonType) {
        return new AttackTypeBoosterModifierType(pregenArgs[0] as PokemonType, TYPE_BOOST_ITEM_BOOST_PERCENT);
      }

      const attackMoveTypeWeights = new Map<PokemonType, number>();
      let totalWeight = 0;
      for (const p of party) {
        if (!p.isAllowedInChallenge()) {
          continue;
        }
        for (const pokemonMove of p.getMoveset()) {
          const move = pokemonMove.getMove();
          if (!move.is("AttackMove")) {
            continue;
          }
          // Account for variable type changing moves
          // Get a variable type attribute of the move
          const variableTypeAttr = move.getAttrs("VariableMoveTypeAttr")[0];
          const types = variableTypeAttr?.getTypesForItemSpawn(p, move) ?? [move.type];
          for (const type of types) {
            const currentWeight = attackMoveTypeWeights.get(type) ?? 0;
            if (currentWeight < 3) {
              attackMoveTypeWeights.set(type, currentWeight + 1);
              totalWeight++;
            }
          }
        }
      }

      if (attackMoveTypeWeights.size === 0) {
        return null;
      }

      const randInt = randSeedInt(totalWeight);
      let weight = 0;

      for (const [type, typeWeight] of attackMoveTypeWeights.entries()) {
        if (randInt < weight + typeWeight) {
          return new AttackTypeBoosterModifierType(type, TYPE_BOOST_ITEM_BOOST_PERCENT);
        }
        weight += typeWeight;
      }

      return null;
    }, "ATTACK_TYPE_BOOSTER");
  }
}

class BaseStatBoosterModifierTypeGenerator extends ModifierTypeGenerator {
  public static readonly items: Record<PermanentStat, string> = {
    [Stat.HP]: "hp_up",
    [Stat.ATK]: "protein",
    [Stat.DEF]: "iron",
    [Stat.SPATK]: "calcium",
    [Stat.SPDEF]: "zinc",
    [Stat.SPD]: "carbos",
  };

  constructor() {
    super((_party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs) {
        return new BaseStatBoosterModifierType(pregenArgs[0]);
      }
      const randStat: PermanentStat = randSeedInt(Stat.SPD + 1);
      return new BaseStatBoosterModifierType(randStat);
    }, "BASE_STAT_BOOSTER");
  }
}

class TempStatStageBoosterModifierTypeGenerator extends ModifierTypeGenerator {
  public static readonly items: Record<TempBattleStat, string> = {
    [Stat.ATK]: "x_attack",
    [Stat.DEF]: "x_defense",
    [Stat.SPATK]: "x_sp_atk",
    [Stat.SPDEF]: "x_sp_def",
    [Stat.SPD]: "x_speed",
    [Stat.ACC]: "x_accuracy",
  };

  constructor() {
    super((_party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && TEMP_BATTLE_STATS.includes(pregenArgs[0])) {
        return new TempStatStageBoosterModifierType(pregenArgs[0]);
      }
      const randStat: TempBattleStat = randSeedInt(Stat.ACC, Stat.ATK);
      return new TempStatStageBoosterModifierType(randStat);
    }, "TEMP_STAT_STAGE_BOOSTER");
  }
}

/**
 * Modifier type generator for {@linkcode SpeciesStatBoosterModifierType}, which
 * encapsulates the logic for weighting the most useful held item from
 * the current list of {@linkcode items}.
 */
class SpeciesStatBoosterModifierTypeGenerator extends ModifierTypeGenerator {
  /** Object comprised of the currently available species-based stat boosting held items */
  public static readonly items = {
    LIGHT_BALL: {
      stats: [Stat.ATK, Stat.SPATK],
      multiplier: 2,
      species: [SpeciesId.PIKACHU],
      rare: true,
    },
    THICK_CLUB: {
      stats: [Stat.ATK],
      multiplier: 2,
      species: [SpeciesId.CUBONE, SpeciesId.MAROWAK, SpeciesId.ALOLA_MAROWAK],
      rare: true,
    },
    METAL_POWDER: {
      stats: [Stat.DEF],
      multiplier: 2,
      species: [SpeciesId.DITTO],
      rare: true,
    },
    QUICK_POWDER: {
      stats: [Stat.SPD],
      multiplier: 2,
      species: [SpeciesId.DITTO],
      rare: true,
    },
    DEEP_SEA_SCALE: {
      stats: [Stat.SPDEF],
      multiplier: 2,
      species: [SpeciesId.CLAMPERL],
      rare: false,
    },
    DEEP_SEA_TOOTH: {
      stats: [Stat.SPATK],
      multiplier: 2,
      species: [SpeciesId.CLAMPERL],
      rare: false,
    },
  };

  constructor(rare: boolean) {
    super(
      (party: readonly Pokemon[], pregenArgs?: any[]) => {
        const items = SpeciesStatBoosterModifierTypeGenerator.items;
        if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in items) {
          return new SpeciesStatBoosterModifierType(pregenArgs[0] as SpeciesStatBoosterItem);
        }

        // Get a pool of items based on the rarity.
        const keys: (keyof SpeciesStatBoosterItem)[] = [];
        const values: (typeof items)[keyof typeof items][] = [];
        const weights: number[] = [];
        for (const [key, val] of Object.entries(SpeciesStatBoosterModifierTypeGenerator.items)) {
          if (val.rare !== rare) {
            continue;
          }
          values.push(val);
          keys.push(key as keyof SpeciesStatBoosterItem);
          weights.push(0);
        }

        for (const p of party) {
          const speciesId = p.getSpeciesForm(true).speciesId;
          const fusionSpeciesId = p.isFusion() ? p.getFusionSpeciesForm(true).speciesId : null;
          // TODO: Use commented boolean when Fling is implemented
          const hasFling = false; /* p.getMoveset(true).some(m => m.moveId === MoveId.FLING) */

          for (const i in values) {
            const checkedSpecies = values[i].species;
            const checkedStats = values[i].stats;

            // If party member already has the item being weighted currently, skip to the next item
            const hasItem = p
              .getHeldItems()
              .some(
                m =>
                  m instanceof SpeciesStatBoosterModifier
                  && (m as SpeciesStatBoosterModifier).contains(checkedSpecies[0], checkedStats[0]),
              );

            if (!hasItem) {
              if (
                checkedSpecies.includes(speciesId)
                || (!!fusionSpeciesId && checkedSpecies.includes(fusionSpeciesId))
              ) {
                // Add weight if party member has a matching species or, if applicable, a matching fusion species
                weights[i]++;
              } else if (checkedSpecies.includes(SpeciesId.PIKACHU) && hasFling) {
                // Add weight to Light Ball if party member has Fling
                weights[i]++;
              }
            }
          }
        }

        let totalWeight = 0;
        for (const weight of weights) {
          totalWeight += weight;
        }

        if (totalWeight !== 0) {
          const randInt = randSeedInt(totalWeight, 1);
          let weight = 0;

          for (const i in weights) {
            if (weights[i] !== 0) {
              const curWeight = weight + weights[i];
              if (randInt <= weight + weights[i]) {
                return new SpeciesStatBoosterModifierType(keys[i] as SpeciesStatBoosterItem);
              }
              weight = curWeight;
            }
          }
        }

        return null;
      },
      rare ? "RARE_SPECIES_STAT_BOOSTER" : "SPECIES_STAT_BOOSTER",
    );
  }
}

class TmModifierTypeGenerator extends ModifierTypeGenerator {
  constructor(tier: ModifierTier) {
    super(
      (party: readonly Pokemon[], pregenArgs?: any[]) => {
        if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in MoveId) {
          return new TmModifierType(pregenArgs[0] as MoveId);
        }
        const partyMemberCompatibleTms = party.map(p => {
          const previousLevelMoves = p.getLearnableLevelMoves();
          return (p as PlayerPokemon).compatibleTms.filter(
            tm => !p.moveset.find(m => m.moveId === tm) && !previousLevelMoves.find(lm => lm === tm),
          );
        });
        const tierUniqueCompatibleTms = partyMemberCompatibleTms
          .flat()
          .filter(tm => tmPoolTiers[tm] === tier)
          .filter(tm => !allMoves[tm].name.endsWith(" (N)"))
          .filter((tm, i, array) => array.indexOf(tm) === i);
        if (tierUniqueCompatibleTms.length === 0) {
          return null;
        }
        // TODO: should this use `randSeedItem`?
        const randTmIndex = randSeedInt(tierUniqueCompatibleTms.length);
        return new TmModifierType(tierUniqueCompatibleTms[randTmIndex]);
      },
      tier === ModifierTier.COMMON ? "TM_COMMON" : tier === ModifierTier.GREAT ? "TM_GREAT" : "TM_ULTRA",
    );
  }
}

class EvolutionItemModifierTypeGenerator extends ModifierTypeGenerator {
  constructor(rare: boolean) {
    super(
      (party: readonly Pokemon[], pregenArgs?: any[]) => {
        if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in EvolutionItem) {
          return new EvolutionItemModifierType(pregenArgs[0] as EvolutionItem);
        }

        const evolutionItemPool = [
          party
            .filter(
              p =>
                Object.hasOwn(pokemonEvolutions, p.species.speciesId)
                && (!p.pauseEvolutions
                  || p.species.speciesId === SpeciesId.SLOWPOKE
                  || p.species.speciesId === SpeciesId.EEVEE
                  || p.species.speciesId === SpeciesId.KIRLIA
                  || p.species.speciesId === SpeciesId.SNORUNT),
            )
            .flatMap(p => {
              const evolutions = pokemonEvolutions[p.species.speciesId];
              return evolutions.filter(e => e.isValidItemEvolution(p));
            }),
          party
            .filter(
              p =>
                p.isFusion()
                && p.fusionSpecies
                && Object.hasOwn(pokemonEvolutions, p.fusionSpecies.speciesId)
                && (!p.pauseEvolutions
                  || p.fusionSpecies.speciesId === SpeciesId.SLOWPOKE
                  || p.fusionSpecies.speciesId === SpeciesId.EEVEE
                  || p.fusionSpecies.speciesId === SpeciesId.KIRLIA
                  || p.fusionSpecies.speciesId === SpeciesId.SNORUNT),
            )
            .flatMap(p => {
              const evolutions = pokemonEvolutions[p.fusionSpecies!.speciesId];
              return evolutions.filter(e => e.isValidItemEvolution(p, true));
            }),
        ]
          .flat()
          .flatMap(e => e.evoItem)
          .filter(i => !!i && i > 50 === rare);

        if (evolutionItemPool.length === 0) {
          return null;
        }

        // TODO: should this use `randSeedItem`?
        return new EvolutionItemModifierType(evolutionItemPool[randSeedInt(evolutionItemPool.length)]!); // TODO: is the bang correct?
      },
      rare ? "RARE_EVOLUTION_ITEM" : "EVOLUTION_ITEM",
    );
  }
}

export class FormChangeItemModifierTypeGenerator extends ModifierTypeGenerator {
  constructor(isRareFormChangeItem: boolean) {
    super(
      (party: readonly Pokemon[], pregenArgs?: any[]) => {
        if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in FormChangeItem) {
          return new FormChangeItemModifierType(pregenArgs[0] as FormChangeItem);
        }

        const formChangeItemPool = [
          ...new Set(
            party
              .filter(p => Object.hasOwn(pokemonFormChanges, p.species.speciesId))
              .flatMap(p => {
                const formChanges = pokemonFormChanges[p.species.speciesId];
                let formChangeItemTriggers = formChanges
                  .filter(
                    fc =>
                      ((fc.formKey.indexOf(SpeciesFormKey.MEGA) === -1
                        && fc.formKey.indexOf(SpeciesFormKey.PRIMAL) === -1)
                        || globalScene.getModifiers(MegaEvolutionAccessModifier).length > 0)
                      && ((fc.formKey.indexOf(SpeciesFormKey.GIGANTAMAX) === -1
                        && fc.formKey.indexOf(SpeciesFormKey.ETERNAMAX) === -1)
                        || globalScene.getModifiers(GigantamaxAccessModifier).length > 0)
                      && (fc.conditions.length === 0
                        || fc.conditions.filter(cond => cond instanceof SpeciesFormChangeCondition && cond.predicate(p))
                          .length > 0)
                      && fc.preFormKey === p.getFormKey(),
                  )
                  .map(fc => fc.findTrigger(SpeciesFormChangeItemTrigger) as SpeciesFormChangeItemTrigger)
                  .filter(
                    t =>
                      t?.active
                      && !globalScene.findModifier(
                        m =>
                          m instanceof PokemonFormChangeItemModifier
                          && m.pokemonId === p.id
                          && m.formChangeItem === t.item,
                      ),
                  );

                if (p.species.speciesId === SpeciesId.NECROZMA) {
                  // technically we could use a simplified version and check for formChanges.length > 3, but in case any code changes later, this might break...
                  let foundULTRA_Z = false;
                  let foundN_LUNA = false;
                  let foundN_SOLAR = false;
                  formChangeItemTriggers.forEach((fc, _i) => {
                    console.log("Checking ", fc.item);
                    switch (fc.item) {
                      case FormChangeItem.ULTRANECROZIUM_Z:
                        foundULTRA_Z = true;
                        break;
                      case FormChangeItem.N_LUNARIZER:
                        foundN_LUNA = true;
                        break;
                      case FormChangeItem.N_SOLARIZER:
                        foundN_SOLAR = true;
                        break;
                    }
                  });
                  if (foundULTRA_Z && foundN_LUNA && foundN_SOLAR) {
                    // all three items are present -> user hasn't acquired any of the N_*ARIZERs -> block ULTRANECROZIUM_Z acquisition.
                    formChangeItemTriggers = formChangeItemTriggers.filter(
                      fc => fc.item !== FormChangeItem.ULTRANECROZIUM_Z,
                    );
                  } else {
                    console.log("DID NOT FIND ");
                  }
                }
                return formChangeItemTriggers;
              }),
          ),
        ]
          .flat()
          .flatMap(fc => fc.item)
          .filter(i => (i && i < 100) === isRareFormChangeItem);
        // convert it into a set to remove duplicate values, which can appear when the same species with a potential form change is in the party.

        if (formChangeItemPool.length === 0) {
          return null;
        }

        // TODO: should this use `randSeedItem`?
        return new FormChangeItemModifierType(formChangeItemPool[randSeedInt(formChangeItemPool.length)]);
      },
      isRareFormChangeItem ? "RARE_FORM_CHANGE_ITEM" : "FORM_CHANGE_ITEM",
    );
  }
}

export class ContactHeldItemTransferChanceModifierType extends PokemonHeldItemModifierType {
  private chancePercent: number;

  constructor(localeKey: string, iconImage: string, chancePercent: number, group?: string, soundName?: string) {
    super(
      localeKey,
      iconImage,
      (type, args) => new ContactHeldItemTransferChanceModifier(type, (args[0] as Pokemon).id, chancePercent),
      group,
      soundName,
    );

    this.chancePercent = chancePercent;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.ContactHeldItemTransferChanceModifierType.description", {
      chancePercent: this.chancePercent,
    });
  }
}

export class TurnHeldItemTransferModifierType extends PokemonHeldItemModifierType {
  constructor(localeKey: string, iconImage: string, group?: string, soundName?: string) {
    super(
      localeKey,
      iconImage,
      (type, args) => new TurnHeldItemTransferModifier(type, (args[0] as Pokemon).id),
      group,
      soundName,
    );
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.TurnHeldItemTransferModifierType.description");
  }
}

export class EnemyAttackStatusEffectChanceModifierType extends ModifierType {
  private chancePercent: number;
  private effect: StatusEffect;

  constructor(localeKey: string, iconImage: string, chancePercent: number, effect: StatusEffect, stackCount?: number) {
    super(
      localeKey,
      iconImage,
      (type, _args) => new EnemyAttackStatusEffectChanceModifier(type, effect, chancePercent, stackCount),
      "enemy_status_chance",
    );

    this.chancePercent = chancePercent;
    this.effect = effect;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.EnemyAttackStatusEffectChanceModifierType.description", {
      chancePercent: this.chancePercent,
      statusEffect: getStatusEffectDescriptor(this.effect),
    });
  }
}

export class EnemyEndureChanceModifierType extends ModifierType {
  private chancePercent: number;

  constructor(localeKey: string, iconImage: string, chancePercent: number) {
    super(localeKey, iconImage, (type, _args) => new EnemyEndureChanceModifier(type, chancePercent), "enemy_endure");

    this.chancePercent = chancePercent;
  }

  getDescription(): string {
    return i18next.t("modifierType:ModifierType.EnemyEndureChanceModifierType.description", {
      chancePercent: this.chancePercent,
    });
  }
}

export class WeightedModifierType {
  public modifierType: ModifierType;
  public weight: number | WeightedModifierTypeWeightFunc;
  public maxWeight: number | WeightedModifierTypeWeightFunc;

  constructor(
    modifierTypeFunc: ModifierTypeFunc,
    weight: number | WeightedModifierTypeWeightFunc,
    maxWeight?: number | WeightedModifierTypeWeightFunc,
  ) {
    this.modifierType = modifierTypeFunc();
    this.modifierType.id = Object.keys(modifierTypeInitObj).find(k => modifierTypeInitObj[k] === modifierTypeFunc)!; // TODO: is this bang correct?
    this.weight = weight;
    this.maxWeight = maxWeight || (weight instanceof Function ? 0 : weight);
  }

  setTier(tier: ModifierTier) {
    this.modifierType.setTier(tier);
  }
}

type BaseModifierOverride = {
  name: Exclude<ModifierTypeKeys, GeneratorModifierOverride["name"]>;
  count?: number;
};

/** Type for modifiers and held items that are constructed via {@linkcode ModifierTypeGenerator}. */
export type GeneratorModifierOverride = {
  count?: number;
} & (
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "SPECIES_STAT_BOOSTER" | "RARE_SPECIES_STAT_BOOSTER">;
      type?: SpeciesStatBoosterItem;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "TEMP_STAT_STAGE_BOOSTER">;
      type?: TempBattleStat;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "BASE_STAT_BOOSTER">;
      type?: Stat;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "MINT">;
      type?: Nature;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "ATTACK_TYPE_BOOSTER" | "TERA_SHARD">;
      type?: PokemonType;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "BERRY">;
      type?: BerryType;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "EVOLUTION_ITEM" | "RARE_EVOLUTION_ITEM">;
      type?: EvolutionItem;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "FORM_CHANGE_ITEM" | "RARE_FORM_CHANGE_ITEM">;
      type?: FormChangeItem;
    }
  | {
      name: keyof Pick<typeof modifierTypeInitObj, "TM_COMMON" | "TM_GREAT" | "TM_ULTRA">;
      type?: MoveId;
    }
);

/** Type used to construct modifiers and held items for overriding purposes. */
export type ModifierOverride = GeneratorModifierOverride | BaseModifierOverride;

export type ModifierTypeKeys = keyof typeof modifierTypeInitObj;

const modifierTypeInitObj = Object.freeze({
  POKEBALL: () => new AddPokeballModifierType("pb", PokeballType.POKEBALL, 5),
  GREAT_BALL: () => new AddPokeballModifierType("gb", PokeballType.GREAT_BALL, 5),
  ULTRA_BALL: () => new AddPokeballModifierType("ub", PokeballType.ULTRA_BALL, 5),
  ROGUE_BALL: () => new AddPokeballModifierType("rb", PokeballType.ROGUE_BALL, 5),
  MASTER_BALL: () => new AddPokeballModifierType("mb", PokeballType.MASTER_BALL, 1),

  RARE_CANDY: () => new PokemonLevelIncrementModifierType("modifierType:ModifierType.RARE_CANDY", "rare_candy"),
  RARER_CANDY: () => new AllPokemonLevelIncrementModifierType("modifierType:ModifierType.RARER_CANDY", "rarer_candy"),

  EVOLUTION_ITEM: () => new EvolutionItemModifierTypeGenerator(false),
  RARE_EVOLUTION_ITEM: () => new EvolutionItemModifierTypeGenerator(true),
  FORM_CHANGE_ITEM: () => new FormChangeItemModifierTypeGenerator(false),
  RARE_FORM_CHANGE_ITEM: () => new FormChangeItemModifierTypeGenerator(true),

  EVOLUTION_TRACKER_GIMMIGHOUL: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.EVOLUTION_TRACKER_GIMMIGHOUL",
      "relic_gold",
      (type, args) =>
        new EvoTrackerModifier(type, (args[0] as Pokemon).id, SpeciesId.GIMMIGHOUL, 10, (args[1] as number) ?? 1),
    ),

  MEGA_BRACELET: () =>
    new ModifierType(
      "modifierType:ModifierType.MEGA_BRACELET",
      "mega_bracelet",
      (type, _args) => new MegaEvolutionAccessModifier(type),
    ),
  DYNAMAX_BAND: () =>
    new ModifierType(
      "modifierType:ModifierType.DYNAMAX_BAND",
      "dynamax_band",
      (type, _args) => new GigantamaxAccessModifier(type),
    ),
  TERA_ORB: () =>
    new ModifierType(
      "modifierType:ModifierType.TERA_ORB",
      "tera_orb",
      (type, _args) => new TerastallizeAccessModifier(type),
    ),

  MAP: () => new ModifierType("modifierType:ModifierType.MAP", "map", (type, _args) => new MapModifier(type)),

  // ER (#486) World Map: the obtainable "Upgraded Map" reward. Mechanically it is
  // a MapModifier (so erMapUpgradeTier counts it -> +1 revealed onward route on the
  // World Map), but it carries its own ER name/description and a gold-tinted map
  // icon so the reward screen + biome shop read it as a distinct map upgrade, not
  // the plain vanilla Map. English inline strings (ER custom; no shared locale).
  ER_UPGRADED_MAP: () => {
    const type = new ModifierType("", "map", (t, _args) => new MapModifier(t));
    Object.defineProperty(type, "name", { get: () => "Upgraded Map" });
    type.getDescription = () => "Reveals one extra onward route on your World Map.";
    type.iconTint = 0xffd24a; // warm gold - reads as an upgraded/premium map
    return type;
  },

  POTION: () => new PokemonHpRestoreModifierType("modifierType:ModifierType.POTION", "potion", 20, 10),
  SUPER_POTION: () =>
    new PokemonHpRestoreModifierType("modifierType:ModifierType.SUPER_POTION", "super_potion", 50, 25),
  HYPER_POTION: () =>
    new PokemonHpRestoreModifierType("modifierType:ModifierType.HYPER_POTION", "hyper_potion", 200, 50),
  MAX_POTION: () => new PokemonHpRestoreModifierType("modifierType:ModifierType.MAX_POTION", "max_potion", 0, 100),
  FULL_RESTORE: () =>
    new PokemonHpRestoreModifierType("modifierType:ModifierType.FULL_RESTORE", "full_restore", 0, 100, true),

  REVIVE: () => new PokemonReviveModifierType("modifierType:ModifierType.REVIVE", "revive", 50),
  MAX_REVIVE: () => new PokemonReviveModifierType("modifierType:ModifierType.MAX_REVIVE", "max_revive", 100),

  FULL_HEAL: () => new PokemonStatusHealModifierType("modifierType:ModifierType.FULL_HEAL", "full_heal"),

  SACRED_ASH: () => new AllPokemonFullReviveModifierType("modifierType:ModifierType.SACRED_ASH", "sacred_ash"),

  REVIVER_SEED: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.REVIVER_SEED",
      "reviver_seed",
      (type, args) => new PokemonInstantReviveModifier(type, (args[0] as Pokemon).id),
    ),
  WHITE_HERB: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.WHITE_HERB",
      "white_herb",
      (type, args) => new ResetNegativeStatStageModifier(type, (args[0] as Pokemon).id),
    ),

  ETHER: () => new PokemonPpRestoreModifierType("modifierType:ModifierType.ETHER", "ether", 10),
  MAX_ETHER: () => new PokemonPpRestoreModifierType("modifierType:ModifierType.MAX_ETHER", "max_ether", -1),

  ELIXIR: () => new PokemonAllMovePpRestoreModifierType("modifierType:ModifierType.ELIXIR", "elixir", 10),
  MAX_ELIXIR: () => new PokemonAllMovePpRestoreModifierType("modifierType:ModifierType.MAX_ELIXIR", "max_elixir", -1),

  PP_UP: () => new PokemonPpUpModifierType("modifierType:ModifierType.PP_UP", "pp_up", 1),
  PP_MAX: () => new PokemonPpUpModifierType("modifierType:ModifierType.PP_MAX", "pp_max", 3),

  // ER Rogue-tier consumables.
  ABILITY_RANDOMIZER: () => new PokemonRandomizeAbilityModifierType(),
  MOVE_SLOT_EXPANDER: () => new PokemonAddMoveSlotModifierType(),

  // ER Greater Ability Randomizer (Master-Ball tier): pink reskin of the Ability
  // Randomizer; pick a slot, choose 1 of 4 random abilities to replace it.
  ER_GREATER_ABILITY_RANDOMIZER: () => new ErGreaterAbilityRandomizerModifierType(),

  // ER community item batch (#387/#392).
  ER_CHILI_SAMPLE: () => erCommunityItemModifierType("chiliSample"),
  ER_COPPER_ROD: () => erCommunityItemModifierType("copperRod"),
  ER_RUSTY_CLAW: () => erCommunityItemModifierType("rustyClaw"),
  ER_SPIKED_KNUCKLES: () => erCommunityItemModifierType("spikedKnuckles"),
  ER_LOADED_DICE: () => erCommunityItemModifierType("loadedDice"),
  ER_LUCKY_HEART: () => erCommunityItemModifierType("luckyHeart"),
  ER_OMNI_GEM: () => erCommunityItemModifierType("omniGem"),
  ER_POWER_HERB: () => erCommunityItemModifierType("powerHerb"),

  // ER recreated trainer-only items (Life Orb / Assault Vest / Rocky Helmet).
  // Registered ONLY so the loader's getModifierTypeFuncById(typeId) guard resolves
  // them and they round-trip on Continue (type.id pinned in the factories). They
  // are NOT added to any reward pool - trainers grant them directly.
  ER_LIFE_ORB: () => ER_LIFE_ORB_TYPE(),
  ER_ASSAULT_VEST: () => ER_ASSAULT_VEST_TYPE(),
  ER_ROCKY_HELMET: () => ER_ROCKY_HELMET_TYPE(),

  // ER reactive held items (Ultra-ball tier).
  ER_CELL_BATTERY: () => erReactiveItemType("cellBattery"),
  ER_ABSORB_BULB: () => erReactiveItemType("absorbBulb"),
  ER_SNOWBALL: () => erReactiveItemType("snowball"),
  ER_LUMINOUS_MOSS: () => erReactiveItemType("luminousMoss"),
  ER_WEAKNESS_POLICY: () => erReactiveItemType("weaknessPolicy"),

  // ER tactical held items (Expert Belt / Covert Cloak / Red Card / Eject Button).
  ER_EXPERT_BELT: () => erTacticalItemType("expertBelt"),
  ER_COVERT_CLOAK: () => erTacticalItemType("covertCloak"),
  ER_RED_CARD: () => erTacticalItemType("redCard"),
  ER_EJECT_BUTTON: () => erTacticalItemType("ejectButton"),

  // ER terrain seeds (Great-ball tier).
  ER_ELECTRIC_SEED: () => erSeedItemType("electricSeed"),
  ER_GRASSY_SEED: () => erSeedItemType("grassySeed"),
  ER_MISTY_SEED: () => erSeedItemType("mistySeed"),
  ER_PSYCHIC_SEED: () => erSeedItemType("psychicSeed"),

  // ER elemental gems (18 types; Great-ball tier).
  ER_NORMAL_GEM: () => erGemItemType(PokemonType.NORMAL),
  ER_FIRE_GEM: () => erGemItemType(PokemonType.FIRE),
  ER_WATER_GEM: () => erGemItemType(PokemonType.WATER),
  ER_ELECTRIC_GEM: () => erGemItemType(PokemonType.ELECTRIC),
  ER_GRASS_GEM: () => erGemItemType(PokemonType.GRASS),
  ER_ICE_GEM: () => erGemItemType(PokemonType.ICE),
  ER_FIGHTING_GEM: () => erGemItemType(PokemonType.FIGHTING),
  ER_POISON_GEM: () => erGemItemType(PokemonType.POISON),
  ER_GROUND_GEM: () => erGemItemType(PokemonType.GROUND),
  ER_FLYING_GEM: () => erGemItemType(PokemonType.FLYING),
  ER_PSYCHIC_GEM: () => erGemItemType(PokemonType.PSYCHIC),
  ER_BUG_GEM: () => erGemItemType(PokemonType.BUG),
  ER_ROCK_GEM: () => erGemItemType(PokemonType.ROCK),
  ER_GHOST_GEM: () => erGemItemType(PokemonType.GHOST),
  ER_DRAGON_GEM: () => erGemItemType(PokemonType.DRAGON),
  ER_DARK_GEM: () => erGemItemType(PokemonType.DARK),
  ER_STEEL_GEM: () => erGemItemType(PokemonType.STEEL),
  ER_FAIRY_GEM: () => erGemItemType(PokemonType.FAIRY),
  ER_ABILITY_CAPSULE: () => new ErAbilityCapsuleModifierType(),
  // ER Greater Ability Capsule (Ultra tier): violet reskin of the Ability Capsule;
  // permanently unlock ONE innate, or run-unlock TWO innates.
  ER_GREATER_ABILITY_CAPSULE: () => new ErGreaterAbilityCapsuleModifierType(),
  ER_LEARNERS_SHROOM: () => new ErLearnersShroomModifierType(),
  ER_DEX_NAV: () => new ErDexNavModifierType(),

  // ER TM Case (COMMON tier): single-use universal TM. Replaces the per-move
  // TM_COMMON/GREAT/ULTRA in the reward pool + biome shop. Mirrors the Learner's
  // Shroom flow but its move list is the mon's compatible-TM moves.
  TM_CASE: () => new ErTmCaseModifierType(),

  // ER reward ball: Greater Golden Ball. Like the vanilla Golden Poke Ball (which
  // grants +1 item option at the end of every battle via ExtraModifierModifier),
  // but +2. Seeds the ExtraModifierModifier at stack 2; it shares/merges with the
  // existing extra-option pool, which caps at 3 stacks (so at most +3 options
  // total). Event-only reward - not added to any random pool.
  ER_GREATER_GOLDEN_BALL: () => {
    const type = new ModifierType(
      "modifierType:ModifierType.ER_GREATER_GOLDEN_BALL",
      "pb_gold",
      (type, _args) => new ExtraModifierModifier(type, 2),
      undefined,
      "se/pb_bounce_1",
    );
    type.id = "ER_GREATER_GOLDEN_BALL";
    return type;
  },

  // ER relics (#439 biome overhaul) - permanent team-wide buff items.
  ER_RELIC_FIELD_MEDIC: () => erRelicModifierType("fieldMedic"),
  ER_RELIC_WARM_INCUBATOR: () => erRelicModifierType("warmIncubator"),
  ER_RELIC_COIN_PURSE: () => erRelicModifierType("coinPurse"),
  ER_RELIC_MYSTERY_CHARM: () => erRelicModifierType("mysteryCharm"),
  ER_RELIC_MORALE_BANNER: () => erRelicModifierType("moraleBanner"),
  ER_RELIC_SECOND_WIND: () => erRelicModifierType("secondWind"),
  ER_RELIC_TWIN_LINK: () => erRelicModifierType("twinLink"),
  ER_RELIC_ANCHOR: () => erRelicModifierType("anchor"),
  ER_RELIC_SCRAP_MAGNET: () => erRelicModifierType("scrapMagnet"),
  ER_RELIC_WEATHERVANE: () => erRelicModifierType("weathervane"),
  ER_RELIC_BONDED_CHARM: () => erRelicModifierType("bondedCharm"),
  ER_RELIC_COLLECTORS_ALBUM: () => erRelicModifierType("collectorsAlbum"),
  ER_RELIC_QUARTERMASTER: () => erRelicModifierType("quartermaster"),
  ER_RELIC_LOOKOUT: () => erRelicModifierType("lookout"),
  ER_RELIC_MOLTEN_CORE: () => erRelicModifierType("moltenCore"),
  ER_RELIC_CAPACITOR: () => erRelicModifierType("capacitor"),
  ER_RELIC_PHARAOH_ANKH: () => erRelicModifierType("pharaohAnkh"),
  ER_RELIC_COVENANT: () => erRelicModifierType("covenant"),
  ER_RELIC_CURSED_IDOL: () => erRelicModifierType("cursedIdol"),
  ER_RELIC_BLOOD_PACT: () => erRelicModifierType("bloodPact"),
  ER_RELIC_MOMENTUM_ENGINE: () => erRelicModifierType("momentumEngine"),
  ER_RELIC_STORMGLASS: () => erRelicModifierType("stormglass"),
  ER_RELIC_CARTOGRAPHERS_LENS: () => erRelicModifierType("cartographersLens"),
  ER_RELIC_TRAILBLAZERS_MARK: () => erRelicModifierType("trailblazersMark"),
  ER_RELIC_MERCHANTS_SEAL: () => erRelicModifierType("merchantsSeal"),
  ER_RELIC_GAMBLERS_COIN: () => erRelicModifierType("gamblersCoin"),

  /*REPEL: () => new DoubleBattleChanceBoosterModifierType('Repel', 5),
  SUPER_REPEL: () => new DoubleBattleChanceBoosterModifierType('Super Repel', 10),
  MAX_REPEL: () => new DoubleBattleChanceBoosterModifierType('Max Repel', 25),*/

  LURE: () => new DoubleBattleChanceBoosterModifierType("modifierType:ModifierType.LURE", "lure", 10),
  SUPER_LURE: () => new DoubleBattleChanceBoosterModifierType("modifierType:ModifierType.SUPER_LURE", "super_lure", 15),
  MAX_LURE: () => new DoubleBattleChanceBoosterModifierType("modifierType:ModifierType.MAX_LURE", "max_lure", 30),

  SPECIES_STAT_BOOSTER: () => new SpeciesStatBoosterModifierTypeGenerator(false),
  RARE_SPECIES_STAT_BOOSTER: () => new SpeciesStatBoosterModifierTypeGenerator(true),

  TEMP_STAT_STAGE_BOOSTER: () => new TempStatStageBoosterModifierTypeGenerator(),

  DIRE_HIT: () =>
    new (class extends ModifierType {
      getDescription(): string {
        return i18next.t("modifierType:ModifierType.TempStatStageBoosterModifierType.description", {
          stat: i18next.t("modifierType:ModifierType.DIRE_HIT.extra.raises"),
          amount: i18next.t("modifierType:ModifierType.TempStatStageBoosterModifierType.extra.stage"),
        });
      }
    })("modifierType:ModifierType.DIRE_HIT", "dire_hit", (type, _args) => new TempCritBoosterModifier(type, 5)),

  BASE_STAT_BOOSTER: () => new BaseStatBoosterModifierTypeGenerator(),

  ATTACK_TYPE_BOOSTER: () => new AttackTypeBoosterModifierTypeGenerator(),

  MINT: () =>
    new ModifierTypeGenerator((_party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in Nature) {
        return new PokemonNatureChangeModifierType(pregenArgs[0] as Nature);
      }
      return new PokemonNatureChangeModifierType(randSeedItem(getEnumValues(Nature)));
    }, "MINT"),

  MYSTICAL_ROCK: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.MYSTICAL_ROCK",
      "mystical_rock",
      (type, args) => new FieldEffectModifier(type, (args[0] as Pokemon).id),
    ),

  TERA_SHARD: () =>
    new ModifierTypeGenerator((party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in PokemonType) {
        return new TerastallizeModifierType(pregenArgs[0] as PokemonType);
      }
      if (globalScene.getModifiers(TerastallizeAccessModifier).length === 0) {
        return null;
      }
      const teraTypes: PokemonType[] = [];
      for (const p of party) {
        if (
          !(p.hasSpecies(SpeciesId.TERAPAGOS) || p.hasSpecies(SpeciesId.OGERPON) || p.hasSpecies(SpeciesId.SHEDINJA))
        ) {
          teraTypes.push(p.teraType);
        }
      }
      let excludedType = PokemonType.UNKNOWN;
      if (teraTypes.length > 0 && teraTypes.filter(t => t === teraTypes[0]).length === teraTypes.length) {
        excludedType = teraTypes[0];
      }
      let shardType = randSeedInt(64) ? (randSeedInt(18) as PokemonType) : PokemonType.STELLAR;
      while (shardType === excludedType) {
        shardType = randSeedInt(64) ? (randSeedInt(18) as PokemonType) : PokemonType.STELLAR;
      }
      return new TerastallizeModifierType(shardType);
    }, "TERA_SHARD"),

  BERRY: () =>
    new ModifierTypeGenerator((_party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs && pregenArgs.length === 1 && pregenArgs[0] in BerryType) {
        return new BerryModifierType(pregenArgs[0] as BerryType);
      }
      const berryTypes = getEnumValues(BerryType);
      let randBerryType: BerryType;
      const rand = randSeedInt(12);
      if (rand < 2) {
        randBerryType = BerryType.SITRUS;
      } else if (rand < 4) {
        randBerryType = BerryType.LUM;
      } else if (rand < 6) {
        randBerryType = BerryType.LEPPA;
      } else {
        randBerryType = berryTypes[randSeedInt(berryTypes.length - 3) + 2];
      }
      return new BerryModifierType(randBerryType);
    }, "BERRY"),

  TM_COMMON: () => new TmModifierTypeGenerator(ModifierTier.COMMON),
  TM_GREAT: () => new TmModifierTypeGenerator(ModifierTier.GREAT),
  TM_ULTRA: () => new TmModifierTypeGenerator(ModifierTier.ULTRA),

  MEMORY_MUSHROOM: () => new RememberMoveModifierType("modifierType:ModifierType.MEMORY_MUSHROOM", "big_mushroom"),

  EXP_SHARE: () =>
    new ModifierType("modifierType:ModifierType.EXP_SHARE", "exp_share", (type, _args) => new ExpShareModifier(type)),
  EXP_BALANCE: () =>
    new ModifierType(
      "modifierType:ModifierType.EXP_BALANCE",
      "exp_balance",
      (type, _args) => new ExpBalanceModifier(type),
    ),

  OVAL_CHARM: () =>
    new ModifierType(
      "modifierType:ModifierType.OVAL_CHARM",
      "oval_charm",
      (type, _args) => new MultipleParticipantExpBonusModifier(type),
    ),

  EXP_CHARM: () => new ExpBoosterModifierType("modifierType:ModifierType.EXP_CHARM", "exp_charm", 25),
  SUPER_EXP_CHARM: () => new ExpBoosterModifierType("modifierType:ModifierType.SUPER_EXP_CHARM", "super_exp_charm", 60),
  GOLDEN_EXP_CHARM: () =>
    new ExpBoosterModifierType("modifierType:ModifierType.GOLDEN_EXP_CHARM", "golden_exp_charm", 100),

  LUCKY_EGG: () => new PokemonExpBoosterModifierType("modifierType:ModifierType.LUCKY_EGG", "lucky_egg", 40),
  GOLDEN_EGG: () => new PokemonExpBoosterModifierType("modifierType:ModifierType.GOLDEN_EGG", "golden_egg", 100),

  SOOTHE_BELL: () => new PokemonFriendshipBoosterModifierType("modifierType:ModifierType.SOOTHE_BELL", "soothe_bell"),

  SCOPE_LENS: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.SCOPE_LENS",
      "scope_lens",
      (type, args) => new CritBoosterModifier(type, (args[0] as Pokemon).id, 1),
    ),
  LEEK: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.LEEK",
      "leek",
      (type, args) =>
        new SpeciesCritBoosterModifier(type, (args[0] as Pokemon).id, 2, [
          SpeciesId.FARFETCHD,
          SpeciesId.GALAR_FARFETCHD,
          SpeciesId.SIRFETCHD,
        ]),
    ),

  EVIOLITE: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.EVIOLITE",
      "eviolite",
      (type, args) => new EvolutionStatBoosterModifier(type, (args[0] as Pokemon).id, [Stat.DEF, Stat.SPDEF], 1.5),
    ),

  SOUL_DEW: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.SOUL_DEW",
      "soul_dew",
      (type, args) => new PokemonNatureWeightModifier(type, (args[0] as Pokemon).id),
    ),

  NUGGET: () =>
    new MoneyRewardModifierType(
      "modifierType:ModifierType.NUGGET",
      "nugget",
      1,
      "modifierType:ModifierType.MoneyRewardModifierType.extra.small",
    ),
  BIG_NUGGET: () =>
    new MoneyRewardModifierType(
      "modifierType:ModifierType.BIG_NUGGET",
      "big_nugget",
      2.5,
      "modifierType:ModifierType.MoneyRewardModifierType.extra.moderate",
    ),
  RELIC_GOLD: () =>
    new MoneyRewardModifierType(
      "modifierType:ModifierType.RELIC_GOLD",
      "relic_gold",
      10,
      "modifierType:ModifierType.MoneyRewardModifierType.extra.large",
    ),

  AMULET_COIN: () =>
    new ModifierType(
      "modifierType:ModifierType.AMULET_COIN",
      "amulet_coin",
      (type, _args) => new MoneyMultiplierModifier(type),
    ),
  GOLDEN_PUNCH: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.GOLDEN_PUNCH",
      "golden_punch",
      (type, args) => new DamageMoneyRewardModifier(type, (args[0] as Pokemon).id),
    ),
  COIN_CASE: () =>
    new ModifierType(
      "modifierType:ModifierType.COIN_CASE",
      "coin_case",
      (type, _args) => new MoneyInterestModifier(type),
    ),

  LOCK_CAPSULE: () =>
    new ModifierType(
      "modifierType:ModifierType.LOCK_CAPSULE",
      "lock_capsule",
      (type, _args) => new LockModifierTiersModifier(type),
    ),

  GRIP_CLAW: () =>
    new ContactHeldItemTransferChanceModifierType("modifierType:ModifierType.GRIP_CLAW", "grip_claw", 10),
  WIDE_LENS: () => new PokemonMoveAccuracyBoosterModifierType("modifierType:ModifierType.WIDE_LENS", "wide_lens", 5),

  MULTI_LENS: () => new PokemonMultiHitModifierType("modifierType:ModifierType.MULTI_LENS", "zoom_lens"),

  HEALING_CHARM: () =>
    new ModifierType(
      "modifierType:ModifierType.HEALING_CHARM",
      "healing_charm",
      (type, _args) => new HealingBoosterModifier(type, 1.1),
    ),
  CANDY_JAR: () =>
    new ModifierType(
      "modifierType:ModifierType.CANDY_JAR",
      "candy_jar",
      (type, _args) => new LevelIncrementBoosterModifier(type),
    ),

  BERRY_POUCH: () =>
    new ModifierType(
      "modifierType:ModifierType.BERRY_POUCH",
      "berry_pouch",
      (type, _args) => new PreserveBerryModifier(type),
    ),

  FOCUS_BAND: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.FOCUS_BAND",
      "focus_band",
      (type, args) => new SurviveDamageModifier(type, (args[0] as Pokemon).id),
    ),

  QUICK_CLAW: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.QUICK_CLAW",
      "quick_claw",
      (type, args) => new BypassSpeedChanceModifier(type, (args[0] as Pokemon).id),
    ),

  KINGS_ROCK: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.KINGS_ROCK",
      "kings_rock",
      (type, args) => new FlinchChanceModifier(type, (args[0] as Pokemon).id),
    ),

  LEFTOVERS: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.LEFTOVERS",
      "leftovers",
      (type, args) => new TurnHealModifier(type, (args[0] as Pokemon).id),
    ),
  SHELL_BELL: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.SHELL_BELL",
      "shell_bell",
      (type, args) => new HitHealModifier(type, (args[0] as Pokemon).id),
    ),

  TOXIC_ORB: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.TOXIC_ORB",
      "toxic_orb",
      (type, args) => new TurnStatusEffectModifier(type, (args[0] as Pokemon).id),
    ),
  FLAME_ORB: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.FLAME_ORB",
      "flame_orb",
      (type, args) => new TurnStatusEffectModifier(type, (args[0] as Pokemon).id),
    ),
  FROSTBITE_ORB: () => new ErFrostbiteOrbModifierType(),

  BATON: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.BATON",
      "baton",
      (type, args) => new SwitchEffectTransferModifier(type, (args[0] as Pokemon).id),
    ),

  SHINY_CHARM: () =>
    new ModifierType(
      "modifierType:ModifierType.SHINY_CHARM",
      "shiny_charm",
      (type, _args) => new ShinyRateBoosterModifier(type),
    ),
  ABILITY_CHARM: () =>
    new ModifierType(
      "modifierType:ModifierType.ABILITY_CHARM",
      "ability_charm",
      (type, _args) => new HiddenAbilityRateBoosterModifier(type),
    ),
  CATCHING_CHARM: () =>
    new ModifierType(
      "modifierType:ModifierType.CATCHING_CHARM",
      "catching_charm",
      (type, _args) => new CriticalCatchChanceBoosterModifier(type),
    ),

  IV_SCANNER: () =>
    new ModifierType("modifierType:ModifierType.IV_SCANNER", "scanner", (type, _args) => new IvScannerModifier(type)),

  // ER Battle-Info unlocks (reuse the scanner icon). Names/descriptions are
  // hardcoded in English here as these are ER-custom items not in the locales.
  DAMAGE_CALCULATOR: () =>
    new (class extends ModifierType {
      get name(): string {
        return "Damage Calculator";
      }
      getDescription(): string {
        return "Unlocks the Damage Calculator page in the in-battle Info screen.";
      }
    })("", "scanner", (type, _args) => new DamageCalculatorModifier(type)),

  SPEED_ORDER: () =>
    new (class extends ModifierType {
      get name(): string {
        return "Speed Order";
      }
      getDescription(): string {
        return "Unlocks the Speed Order page in the in-battle Info screen.";
      }
    })("", "scanner", (type, _args) => new SpeedOrderModifier(type)),

  DNA_SPLICERS: () => new FusePokemonModifierType("modifierType:ModifierType.DNA_SPLICERS", "dna_splicers"),

  MINI_BLACK_HOLE: () =>
    new TurnHeldItemTransferModifierType("modifierType:ModifierType.MINI_BLACK_HOLE", "mini_black_hole"),

  VOUCHER: () => new AddVoucherModifierType(VoucherType.REGULAR, 1),
  VOUCHER_PLUS: () => new AddVoucherModifierType(VoucherType.PLUS, 1),
  VOUCHER_PREMIUM: () => new AddVoucherModifierType(VoucherType.PREMIUM, 1),

  GOLDEN_POKEBALL: () =>
    new ModifierType(
      "modifierType:ModifierType.GOLDEN_POKEBALL",
      "pb_gold",
      (type, _args) => new ExtraModifierModifier(type),
      undefined,
      "se/pb_bounce_1",
    ),
  SILVER_POKEBALL: () =>
    new ModifierType(
      "modifierType:ModifierType.SILVER_POKEBALL",
      "pb_silver",
      (type, _args) => new TempExtraModifierModifier(type, 100),
      undefined,
      "se/pb_bounce_1",
    ),

  ENEMY_DAMAGE_BOOSTER: () =>
    new ModifierType(
      "modifierType:ModifierType.ENEMY_DAMAGE_BOOSTER",
      "wl_item_drop",
      (type, _args) => new EnemyDamageBoosterModifier(type, 5),
    ),
  ENEMY_DAMAGE_REDUCTION: () =>
    new ModifierType(
      "modifierType:ModifierType.ENEMY_DAMAGE_REDUCTION",
      "wl_guard_spec",
      (type, _args) => new EnemyDamageReducerModifier(type, 2.5),
    ),
  //ENEMY_SUPER_EFFECT_BOOSTER: () => new ModifierType('Type Advantage Token', 'Increases damage of super effective attacks by 30%', (type, _args) => new EnemySuperEffectiveDamageBoosterModifier(type, 30), 'wl_custom_super_effective'),
  ENEMY_HEAL: () =>
    new ModifierType(
      "modifierType:ModifierType.ENEMY_HEAL",
      "wl_potion",
      (type, _args) => new EnemyTurnHealModifier(type, 2, 10),
    ),
  ENEMY_ATTACK_POISON_CHANCE: () =>
    new EnemyAttackStatusEffectChanceModifierType(
      "modifierType:ModifierType.ENEMY_ATTACK_POISON_CHANCE",
      "wl_antidote",
      5,
      StatusEffect.POISON,
      10,
    ),
  ENEMY_ATTACK_PARALYZE_CHANCE: () =>
    new EnemyAttackStatusEffectChanceModifierType(
      "modifierType:ModifierType.ENEMY_ATTACK_PARALYZE_CHANCE",
      "wl_paralyze_heal",
      2.5,
      StatusEffect.PARALYSIS,
      10,
    ),
  ENEMY_ATTACK_BURN_CHANCE: () =>
    new EnemyAttackStatusEffectChanceModifierType(
      "modifierType:ModifierType.ENEMY_ATTACK_BURN_CHANCE",
      "wl_burn_heal",
      5,
      StatusEffect.BURN,
      10,
    ),
  ENEMY_STATUS_EFFECT_HEAL_CHANCE: () =>
    new ModifierType(
      "modifierType:ModifierType.ENEMY_STATUS_EFFECT_HEAL_CHANCE",
      "wl_full_heal",
      (type, _args) => new EnemyStatusEffectHealChanceModifier(type, 2.5, 10),
    ),
  ENEMY_ENDURE_CHANCE: () =>
    new EnemyEndureChanceModifierType("modifierType:ModifierType.ENEMY_ENDURE_CHANCE", "wl_reset_urge", 2),
  ENEMY_FUSED_CHANCE: () =>
    new ModifierType(
      "modifierType:ModifierType.ENEMY_FUSED_CHANCE",
      "wl_custom_spliced",
      (type, _args) => new EnemyFusionChanceModifier(type, 1),
    ),

  MYSTERY_ENCOUNTER_SHUCKLE_JUICE: () =>
    new ModifierTypeGenerator((_party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs) {
        return new PokemonBaseStatTotalModifierType(pregenArgs[0] as 10 | -15);
      }
      return new PokemonBaseStatTotalModifierType(10);
    }, "MYSTERY_ENCOUNTER_SHUCKLE_JUICE"),
  MYSTERY_ENCOUNTER_OLD_GATEAU: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.MYSTERY_ENCOUNTER_OLD_GATEAU",
      "old_gateau",
      (type, args) => new PokemonBaseStatFlatModifier(type, (args[0] as Pokemon).id),
    ),
  MYSTERY_ENCOUNTER_BLACK_SLUDGE: () =>
    new ModifierTypeGenerator((_party: readonly Pokemon[], pregenArgs?: any[]) => {
      if (pregenArgs) {
        return new ModifierType(
          "modifierType:ModifierType.MYSTERY_ENCOUNTER_BLACK_SLUDGE",
          "black_sludge",
          (type, _args) => new HealShopCostModifier(type, pregenArgs[0] as number),
        );
      }
      return new ModifierType(
        "modifierType:ModifierType.MYSTERY_ENCOUNTER_BLACK_SLUDGE",
        "black_sludge",
        (type, _args) => new HealShopCostModifier(type, 2.5),
      );
    }, "MYSTERY_ENCOUNTER_BLACK_SLUDGE"),
  MYSTERY_ENCOUNTER_MACHO_BRACE: () =>
    new PokemonHeldItemModifierType(
      "modifierType:ModifierType.MYSTERY_ENCOUNTER_MACHO_BRACE",
      "macho_brace",
      (type, args) => new PokemonIncrementingStatModifier(type, (args[0] as Pokemon).id),
    ),
  MYSTERY_ENCOUNTER_GOLDEN_BUG_NET: () =>
    new ModifierType(
      "modifierType:ModifierType.MYSTERY_ENCOUNTER_GOLDEN_BUG_NET",
      "golden_net",
      (type, _args) => new BoostBugSpawnModifier(type),
    ),
});

/**
 * The initial set of modifier types, used to generate the modifier pool.
 */
export type ModifierTypes = typeof modifierTypeInitObj;

export interface ModifierPool {
  [tier: string]: WeightedModifierType[];
}

let modifierPoolThresholds = {};
let ignoredPoolIndexes = {};

let dailyStarterModifierPoolThresholds = {};
// biome-ignore lint/correctness/noUnusedVariables: TODO explain why this is marked as OK
let ignoredDailyStarterPoolIndexes = {};

let enemyModifierPoolThresholds = {};
// biome-ignore lint/correctness/noUnusedVariables: TODO explain why this is marked as OK
let enemyIgnoredPoolIndexes = {};

let enemyBuffModifierPoolThresholds = {};
// biome-ignore lint/correctness/noUnusedVariables: TODO explain why this is marked as OK
let enemyBuffIgnoredPoolIndexes = {};

const tierWeights = [768 / 1024, 195 / 1024, 48 / 1024, 12 / 1024, 1 / 1024];
/**
 * Allows a unit test to check if an item exists in the Modifier Pool. Checks the pool directly, rather than attempting to reroll for the item.
 */
export const itemPoolChecks: Map<ModifierTypeKeys, boolean | undefined> = new Map();

export function regenerateModifierPoolThresholds(
  party: readonly Pokemon[],
  poolType: ModifierPoolType,
  rerollCount = 0,
) {
  const pool = getModifierPoolForType(poolType);
  itemPoolChecks.forEach((_v, k) => {
    itemPoolChecks.set(k, false);
  });

  const ignoredIndexes = {};
  const modifierTableData = {};
  const thresholds = Object.fromEntries(
    new Map(
      Object.keys(pool).map(t => {
        ignoredIndexes[t] = [];
        const thresholds = new Map();
        const tierModifierIds: string[] = [];
        let tierMaxWeight = 0;
        let i = 0;
        pool[t].reduce((total: number, modifierType: WeightedModifierType) => {
          const weightedModifierType = modifierType as WeightedModifierType;
          const existingModifiers = globalScene.findModifiers(
            m => m.type.id === weightedModifierType.modifierType.id,
            poolType === ModifierPoolType.PLAYER,
          );
          const itemModifierType =
            weightedModifierType.modifierType instanceof ModifierTypeGenerator
              ? weightedModifierType.modifierType.generateType(party)
              : weightedModifierType.modifierType;
          const weight =
            existingModifiers.length === 0
            || itemModifierType instanceof PokemonHeldItemModifierType
            || itemModifierType instanceof FormChangeItemModifierType
            || existingModifiers.find(m => m.stackCount < m.getMaxStackCount(true))
              ? weightedModifierType.weight instanceof Function
                ? // biome-ignore lint/complexity/noBannedTypes: TODO: refactor to not use Function type
                  (weightedModifierType.weight as Function)(party, rerollCount)
                : (weightedModifierType.weight as number)
              : 0;
          if (weightedModifierType.maxWeight) {
            const modifierId = weightedModifierType.modifierType.id;
            tierModifierIds.push(modifierId);
            const outputWeight = useMaxWeightForOutput ? weightedModifierType.maxWeight : weight;
            modifierTableData[modifierId] = {
              weight: outputWeight,
              tier: Number.parseInt(t),
              tierPercent: 0,
              totalPercent: 0,
            };
            tierMaxWeight += outputWeight;
          }
          if (weight) {
            total += weight;
          } else {
            ignoredIndexes[t].push(i++);
            return total;
          }
          if (itemPoolChecks.has(modifierType.modifierType.id as ModifierTypeKeys)) {
            itemPoolChecks.set(modifierType.modifierType.id as ModifierTypeKeys, true);
          }
          thresholds.set(total, i++);
          return total;
        }, 0);
        for (const id of tierModifierIds) {
          modifierTableData[id].tierPercent = Math.floor((modifierTableData[id].weight / tierMaxWeight) * 10000) / 100;
        }
        return [t, Object.fromEntries(thresholds)];
      }),
    ),
  );
  for (const id of Object.keys(modifierTableData)) {
    modifierTableData[id].totalPercent =
      Math.floor(modifierTableData[id].tierPercent * tierWeights[modifierTableData[id].tier] * 100) / 100;
    modifierTableData[id].tier = ModifierTier[modifierTableData[id].tier];
  }
  if (outputModifierData) {
    console.table(modifierTableData);
  }
  switch (poolType) {
    case ModifierPoolType.PLAYER:
      modifierPoolThresholds = thresholds;
      ignoredPoolIndexes = ignoredIndexes;
      break;
    case ModifierPoolType.WILD:
    case ModifierPoolType.TRAINER:
      enemyModifierPoolThresholds = thresholds;
      enemyIgnoredPoolIndexes = ignoredIndexes;
      break;
    case ModifierPoolType.ENEMY_BUFF:
      enemyBuffModifierPoolThresholds = thresholds;
      enemyBuffIgnoredPoolIndexes = ignoredIndexes;
      break;
    case ModifierPoolType.DAILY_STARTER:
      dailyStarterModifierPoolThresholds = thresholds;
      ignoredDailyStarterPoolIndexes = ignoredIndexes;
      break;
  }
}

export interface CustomModifierSettings {
  /** If specified, will override the next X items to be the specified tier. These can upgrade with luck. */
  guaranteedModifierTiers?: ModifierTier[];
  /** If specified, will override the first X items to be specific modifier options (these should be pre-genned). */
  guaranteedModifierTypeOptions?: ModifierTypeOption[];
  /** If specified, will override the next X items to be auto-generated from specific modifier functions (these don't have to be pre-genned). */
  guaranteedModifierTypeFuncs?: ModifierTypeFunc[];
  /**
   * If set to `true`, will fill the remainder of shop items that were not overridden by the 3 options above, up to the `count` param value.
   * @example
   * ```ts
   * count = 4;
   * customModifierSettings = { guaranteedModifierTiers: [ModifierTier.GREAT], fillRemaining: true };
   * ```
   * The first item in the shop will be `GREAT` tier, and the remaining `3` items will be generated normally.
   *
   * If `fillRemaining: false` in the same scenario, only 1 `GREAT` tier item will appear in the shop (regardless of the value of `count`).
   * @defaultValue `false`
   */
  fillRemaining?: boolean;
  /** If specified, can adjust the amount of money required for a shop reroll. If set to a negative value, the shop will not allow rerolls at all. */
  rerollMultiplier?: number | undefined;
  /**
   * If `false`, will prevent set item tiers from upgrading via luck.
   * @defaultValue `true`
   */
  allowLuckUpgrades?: boolean;
}

export function getModifierTypeFuncById(id: string): ModifierTypeFunc {
  return modifierTypeInitObj[id];
}

/**
 * Generates modifier options for a {@linkcode SelectModifierPhase}
 * @param count - Determines the number of items to generate
 * @param party - Party is required for generating proper modifier pools
 * @param modifierTiers - (Optional) If specified, rolls items in the specified tiers. Commonly used for tier-locking with Lock Capsule.
 * @param customModifierSettings - See {@linkcode CustomModifierSettings}
 */
export function getPlayerModifierTypeOptions(
  count: number,
  party: PlayerPokemon[],
  modifierTiers?: ModifierTier[],
  customModifierSettings?: CustomModifierSettings,
): ModifierTypeOption[] {
  const options: ModifierTypeOption[] = [];
  const retryCount = Math.min(count * 5, 50);
  if (customModifierSettings) {
    // Guaranteed mod options first
    if (
      customModifierSettings?.guaranteedModifierTypeOptions
      && customModifierSettings.guaranteedModifierTypeOptions.length > 0
    ) {
      options.push(...customModifierSettings.guaranteedModifierTypeOptions!);
    }

    // Guaranteed mod functions second
    if (
      customModifierSettings.guaranteedModifierTypeFuncs
      && customModifierSettings.guaranteedModifierTypeFuncs.length > 0
    ) {
      customModifierSettings.guaranteedModifierTypeFuncs!.forEach((mod, _i) => {
        // ER: resolve guaranteed reward funcs against the FULL modifier registry
        // (`modifierTypes`), not just the vanilla `modifierTypeInitObj`. ER-custom
        // funcs (Relics, ER items) live in `modifierTypes` only, so the vanilla
        // reverse-lookup returned undefined and `undefined.withIdFromFunc(...)`
        // crashed the whole reward screen (Fairy's Boon, Abyssal Vent, etc.).
        // `modifierTypes` is a superset of `modifierTypeInitObj`, so this also
        // covers every vanilla func. Guard each step so an unresolved/undefined
        // entry is skipped instead of crashing.
        const modifierId = Object.keys(modifierTypes).find(k => modifierTypes[k] === mod);
        const builder = modifierId ? modifierTypes[modifierId] : mod;
        const guaranteedMod: ModifierType | undefined = builder?.();
        if (!guaranteedMod) {
          return;
        }

        // Populates item id (used for tier/price reverse-lookup) and tier.
        if (modifierId) {
          guaranteedMod.id = modifierId;
        }
        const tieredMod = guaranteedMod.withTierFromPool(ModifierPoolType.PLAYER, party);

        const modType = tieredMod instanceof ModifierTypeGenerator ? tieredMod.generateType(party) : tieredMod;
        if (modType) {
          const option = new ModifierTypeOption(modType, 0);
          options.push(option);
        }
      });
    }

    // Guaranteed tiers third
    if (customModifierSettings.guaranteedModifierTiers && customModifierSettings.guaranteedModifierTiers.length > 0) {
      const allowLuckUpgrades = customModifierSettings.allowLuckUpgrades ?? true;
      for (const tier of customModifierSettings.guaranteedModifierTiers) {
        options.push(getModifierTypeOptionWithRetry(options, retryCount, party, tier, allowLuckUpgrades));
      }
    }

    // Fill remaining up to `count`. `count` is authoritative: for the post-battle reward
    // it is SelectModifierPhase.getModifierCount(), which equals the guaranteed length
    // UNLESS the player earned extra reward slots (Golden Ball / Greater Golden Ball /
    // Scrap Magnet) - those extras must be filled even when fillRemaining is false (ER
    // #134), otherwise the ball is a no-op in every bundled reward. With no earned extras
    // (or a fixed count like the MEs' count=1) count === options.length here, so this
    // stays a no-op for ordinary fillRemaining:false bundles.
    if (options.length < count) {
      while (options.length < count) {
        options.push(getModifierTypeOptionWithRetry(options, retryCount, party, undefined));
      }
    }
  } else {
    for (let i = 0; i < count; i++) {
      const tier = modifierTiers && modifierTiers.length > i ? modifierTiers[i] : undefined;
      options.push(getModifierTypeOptionWithRetry(options, retryCount, party, tier));
    }
  }

  overridePlayerModifierTypeOptions(options, party);

  return options;
}

/**
 * Will generate a {@linkcode ModifierType} from the {@linkcode ModifierPoolType.PLAYER} pool, attempting to retry duplicated items up to retryCount
 * @param existingOptions Currently generated options
 * @param retryCount How many times to retry before allowing a dupe item
 * @param party Current player party, used to calculate items in the pool
 * @param tier If specified will generate item of tier
 * @param allowLuckUpgrades `true` to allow items to upgrade tiers (the little animation that plays and is affected by luck)
 */
function getModifierTypeOptionWithRetry(
  existingOptions: ModifierTypeOption[],
  retryCount: number,
  party: PlayerPokemon[],
  tier?: ModifierTier,
  allowLuckUpgrades?: boolean,
): ModifierTypeOption {
  allowLuckUpgrades = allowLuckUpgrades ?? true;
  let candidate = getNewModifierTypeOption(party, ModifierPoolType.PLAYER, tier, undefined, 0, allowLuckUpgrades);
  const candidateValidity = new BooleanHolder(true);
  applyChallenges(ChallengeType.WAVE_REWARD, candidate, candidateValidity);
  let r = 0;
  while (
    (existingOptions.length > 0
      && ++r < retryCount
      && existingOptions.filter(o => o.type.name === candidate?.type.name || o.type.group === candidate?.type.group)
        .length > 0)
    || !candidateValidity.value
  ) {
    candidate = getNewModifierTypeOption(
      party,
      ModifierPoolType.PLAYER,
      candidate?.type.tier ?? tier,
      candidate?.upgradeCount,
      0,
      allowLuckUpgrades,
    );
    applyChallenges(ChallengeType.WAVE_REWARD, candidate, candidateValidity);
  }
  return candidate!;
}

/**
 * Replaces the {@linkcode ModifierType} of the entries within {@linkcode options} with any
 * {@linkcode ModifierOverride} entries listed in {@linkcode Overrides.ITEM_REWARD_OVERRIDE}
 * up to the smallest amount of entries between {@linkcode options} and the override array.
 * @param options Array of naturally rolled {@linkcode ModifierTypeOption}s
 * @param party Array of the player's current party
 */
export function overridePlayerModifierTypeOptions(options: ModifierTypeOption[], party: PlayerPokemon[]) {
  const minLength = Math.min(options.length, Overrides.ITEM_REWARD_OVERRIDE.length);
  for (let i = 0; i < minLength; i++) {
    const override: ModifierOverride = Overrides.ITEM_REWARD_OVERRIDE[i];
    const modifierFunc = modifierTypeInitObj[override.name];
    let modifierType: ModifierType | null = modifierFunc();

    if (modifierType instanceof ModifierTypeGenerator) {
      const pregenArgs = "type" in override && override.type !== null ? [override.type] : undefined;
      modifierType = modifierType.generateType(party, pregenArgs);
    }

    if (modifierType) {
      options[i].type = modifierType.withIdFromFunc(modifierFunc).withTierFromPool(ModifierPoolType.PLAYER, party);
    }
  }
}

export function getPlayerShopModifierTypeOptionsForWave(
  waveIndex: number,
  baseCost: number,
  forBiomeShop = false,
): ModifierTypeOption[] {
  // ER Biome Market (#440 / #504): the dedicated BiomeShopPhase ALWAYS shows the
  // per-biome stock (rollErBiomeShopStock excludes heals by design) and NEVER the
  // vanilla healing row. DECOUPLED from the %10 gate: with variable biome length
  // (#504) the market can fire on a non-x0 wave, and the old "x0 only" gate made
  // it fall through to the vanilla heal row - the "biome shop is only healing
  // items" bug. The finale (wave 200) + the Abyss (no economy) yield an empty
  // stock. The vanilla reward row never receives this stock (forBiomeShop=false).
  if (forBiomeShop) {
    if (waveIndex < 200 && globalScene.currentBattle != null) {
      const stock = rollErBiomeShopStock(globalScene.arena.biomeId, waveIndex);
      const options: ModifierTypeOption[] = [];
      for (const entry of stock) {
        let mt: ModifierType | null = modifierTypeInitObj[entry.key]();
        if (mt instanceof ModifierTypeGenerator) {
          // Generator entries (BERRY/TM/MINT/...) resolve against the party,
          // under the same wave seed the stock roll used.
          globalScene.executeWithSeedOffset(
            () => {
              mt = (mt as ModifierTypeGenerator).generateType(globalScene.getPlayerParty()) ?? null;
            },
            waveIndex,
            "er-biome-shop-gen",
          );
        }
        if (mt != null) {
          // CRITICAL: set the id first. getOrInferTier reverse-looks-up the
          // item in the reward pools BY id; without it every item returns a
          // null tier and collapses to one flat price + one stock count.
          mt.withIdFromFunc(modifierTypeInitObj[entry.key]);
          // Price by the item's actual RARITY tier (a Rogue-tier Focus Band
          // costs far more than an Ultra-tier Quick Claw, balls escalate Poke <
          // Great < Ultra < Rogue) x the biome discount - not a flat per-category
          // rate. Explicit map covers staples (balls) that aren't pooled.
          const tier = erBiomeShopResolveTier(entry.key, mt.getOrInferTier(), entry.category);
          // Cache the resolved tier on the type so the phase's stock calc
          // (o.type.getOrInferTier()) reads the SAME tier the price used.
          mt.setTier(tier);
          const cost = erBiomeTierPrice(tier, globalScene.arena.biomeId, entry.category);
          options.push(new ModifierTypeOption(mt, 0, cost));
        }
      }
      return options;
    }
    return [];
  }

  if (!(waveIndex % 10)) {
    // Boss (x0) waves have no vanilla reward shop row - their shop is the biome
    // market (above, via the dedicated phase). Returning [] keeps the vanilla
    // reward screen from rendering uncapped, re-buyable market stock.
    return [];
  }

  // ER Wasteland (#439 §3): scarcity - the every-wave shop here sells NO healing.
  // The whole vanilla shop row is heals/revives/cures, so the row is empty in this
  // biome. Gated on the biome rule; every other biome keeps its heal row.
  if (globalScene.currentBattle != null && getErBiomeRule(globalScene.arena.biomeId)?.shopNoHeal) {
    return [];
  }

  // ER tuning: HP / revive / status-cure items cost 30% less across the board.
  // PP items (Ether/Elixir) and Memory Mushroom keep their vanilla prices.
  const heal = (factor: number): number => baseCost * factor * 0.7;
  const options = [
    [
      new ModifierTypeOption(modifierTypeInitObj.POTION(), 0, heal(0.2)),
      new ModifierTypeOption(modifierTypeInitObj.ETHER(), 0, baseCost * 0.4),
      new ModifierTypeOption(modifierTypeInitObj.REVIVE(), 0, heal(2)),
      // ER: Full Heal sits in the FIRST shop row so it is buyable from wave 1 -
      // early poison/burn is too punishing without an affordable status cure. It
      // is also 20% cheaper than its prior price (heal(1) -> heal(0.8)).
      new ModifierTypeOption(modifierTypeInitObj.FULL_HEAL(), 0, heal(0.8)),
    ],
    [new ModifierTypeOption(modifierTypeInitObj.SUPER_POTION(), 0, heal(0.45))],
    [
      new ModifierTypeOption(modifierTypeInitObj.ELIXIR(), 0, baseCost),
      new ModifierTypeOption(modifierTypeInitObj.MAX_ETHER(), 0, baseCost),
    ],
    [
      new ModifierTypeOption(modifierTypeInitObj.HYPER_POTION(), 0, heal(0.8)),
      new ModifierTypeOption(modifierTypeInitObj.MAX_REVIVE(), 0, heal(2.75)),
      new ModifierTypeOption(modifierTypeInitObj.MEMORY_MUSHROOM(), 0, baseCost * 4),
    ],
    [
      new ModifierTypeOption(modifierTypeInitObj.MAX_POTION(), 0, heal(1.5)),
      new ModifierTypeOption(modifierTypeInitObj.MAX_ELIXIR(), 0, baseCost * 2.5),
    ],
    [new ModifierTypeOption(modifierTypeInitObj.FULL_RESTORE(), 0, heal(2.25))],
    [new ModifierTypeOption(modifierTypeInitObj.SACRED_ASH(), 0, heal(10))],
  ];

  return options
    .slice(0, Math.ceil(Math.max(waveIndex + 10, 0) / 30))
    .flat()
    .filter(shopItem => {
      const status = new BooleanHolder(true);
      applyChallenges(ChallengeType.SHOP_ITEM, shopItem, status);
      return status.value;
    });
}

export function getEnemyBuffModifierForWave(
  tier: ModifierTier,
  enemyModifiers: PersistentModifier[],
): EnemyPersistentModifier {
  let tierStackCount: number;
  switch (tier) {
    case ModifierTier.ULTRA:
      tierStackCount = 5;
      break;
    case ModifierTier.GREAT:
      tierStackCount = 3;
      break;
    default:
      tierStackCount = 1;
      break;
  }

  const retryCount = 50;
  let candidate = getNewModifierTypeOption([], ModifierPoolType.ENEMY_BUFF, tier);
  let r = 0;
  let matchingModifier: PersistentModifier | undefined;
  while (
    ++r < retryCount
    && (matchingModifier = enemyModifiers.find(m => m.type.id === candidate?.type?.id))
    && matchingModifier.getMaxStackCount() < matchingModifier.stackCount + (r < 10 ? tierStackCount : 1)
  ) {
    candidate = getNewModifierTypeOption([], ModifierPoolType.ENEMY_BUFF, tier);
  }

  const modifier = candidate?.type?.newModifier() as EnemyPersistentModifier;
  modifier.stackCount = tierStackCount;

  return modifier;
}

export function getEnemyModifierTypesForWave(
  waveIndex: number,
  count: number,
  party: EnemyPokemon[],
  poolType: ModifierPoolType.WILD | ModifierPoolType.TRAINER,
  upgradeChance = 0,
): PokemonHeldItemModifierType[] {
  const ret = new Array(count)
    .fill(0)
    .map(
      () =>
        getNewModifierTypeOption(party, poolType, undefined, upgradeChance && !randSeedInt(upgradeChance) ? 1 : 0)
          ?.type as PokemonHeldItemModifierType,
    );
  if (!(waveIndex % 1000)) {
    ret.push(getModifierType(modifierTypeInitObj.MINI_BLACK_HOLE) as PokemonHeldItemModifierType);
  }
  return ret;
}

export function getDailyRunStarterModifiers(party: PlayerPokemon[]): PokemonHeldItemModifier[] {
  const ret: PokemonHeldItemModifier[] = [];
  for (const p of party) {
    for (let m = 0; m < 3; m++) {
      const tierValue = randSeedInt(64);

      let tier: ModifierTier;
      if (tierValue > 25) {
        tier = ModifierTier.COMMON;
      } else if (tierValue > 12) {
        tier = ModifierTier.GREAT;
      } else if (tierValue > 4) {
        tier = ModifierTier.ULTRA;
      } else if (tierValue) {
        tier = ModifierTier.ROGUE;
      } else {
        tier = ModifierTier.MASTER;
      }

      const modifier = getNewModifierTypeOption(party, ModifierPoolType.DAILY_STARTER, tier)?.type?.newModifier(
        p,
      ) as PokemonHeldItemModifier;
      ret.push(modifier);
    }
  }

  return ret;
}

/**
 * Generates a ModifierType from the specified pool
 * @param party party of the trainer using the item
 * @param poolType PLAYER/WILD/TRAINER
 * @param tier If specified, will override the initial tier of an item (can still upgrade with luck)
 * @param upgradeCount If defined, means that this is a new ModifierType being generated to override another via luck upgrade. Used for recursive logic
 * @param retryCount Max allowed tries before the next tier down is checked for a valid ModifierType
 * @param allowLuckUpgrades Default true. If false, will not allow ModifierType to randomly upgrade to next tier
 */
function getNewModifierTypeOption(
  party: Pokemon[],
  poolType: ModifierPoolType,
  tier?: ModifierTier,
  upgradeCount?: number,
  retryCount = 0,
  allowLuckUpgrades = true,
): ModifierTypeOption | null {
  const player = !poolType;
  const pool = getModifierPoolForType(poolType);
  let thresholds: object;
  switch (poolType) {
    case ModifierPoolType.PLAYER:
      thresholds = modifierPoolThresholds;
      break;
    case ModifierPoolType.WILD:
      thresholds = enemyModifierPoolThresholds;
      break;
    case ModifierPoolType.TRAINER:
      thresholds = enemyModifierPoolThresholds;
      break;
    case ModifierPoolType.ENEMY_BUFF:
      thresholds = enemyBuffModifierPoolThresholds;
      break;
    case ModifierPoolType.DAILY_STARTER:
      thresholds = dailyStarterModifierPoolThresholds;
      break;
  }
  if (tier === undefined) {
    const tierValue = randSeedInt(1024);
    if (!upgradeCount) {
      upgradeCount = 0;
    }
    if (player && tierValue && allowLuckUpgrades) {
      const partyLuckValue = getPartyLuckValue(party);
      const upgradeOdds = getLuckUpgradeOdds(partyLuckValue);
      let upgraded = false;
      do {
        upgraded = randSeedInt(upgradeOdds) < 4;
        if (upgraded) {
          upgradeCount++;
        }
      } while (upgraded);
    }

    if (tierValue > 255) {
      tier = ModifierTier.COMMON;
    } else if (tierValue > 60) {
      tier = ModifierTier.GREAT;
    } else if (tierValue > 12) {
      tier = ModifierTier.ULTRA;
    } else if (tierValue) {
      tier = ModifierTier.ROGUE;
    } else {
      tier = ModifierTier.MASTER;
    }

    tier += upgradeCount;
    while (tier && (!Object.hasOwn(pool, tier) || pool[tier].length === 0)) {
      tier--;
      if (upgradeCount) {
        upgradeCount--;
      }
    }
  } else if (upgradeCount === undefined && player) {
    upgradeCount = 0;
    if (tier < ModifierTier.MASTER && allowLuckUpgrades) {
      const partyLuckValue = getPartyLuckValue(party);
      const upgradeOdds = getLuckUpgradeOdds(partyLuckValue);
      while (Object.hasOwn(pool, tier + upgradeCount + 1) && pool[tier + upgradeCount + 1].length > 0) {
        if (randSeedInt(upgradeOdds) < 4) {
          upgradeCount++;
        } else {
          break;
        }
      }
      tier += upgradeCount;
    }
  } else if (retryCount >= 100 && tier) {
    retryCount = 0;
    tier--;
  }

  const tierThresholds = Object.keys(thresholds[tier]);
  const totalWeight = Number.parseInt(tierThresholds.at(-1)!);
  const value = randSeedInt(totalWeight);
  let index: number | undefined;
  for (const t of tierThresholds) {
    const threshold = Number.parseInt(t);
    if (value < threshold) {
      index = thresholds[tier][threshold];
      break;
    }
  }

  if (index === undefined) {
    return null;
  }

  if (player) {
    console.log(index, ignoredPoolIndexes[tier].filter(i => i <= index).length, ignoredPoolIndexes[tier]);
  }
  let modifierType: ModifierType | null = pool[tier][index].modifierType;
  if (modifierType instanceof ModifierTypeGenerator) {
    modifierType = (modifierType as ModifierTypeGenerator).generateType(party);
    if (modifierType === null) {
      if (player) {
        console.log(ModifierTier[tier], upgradeCount);
      }
      return getNewModifierTypeOption(party, poolType, tier, upgradeCount, ++retryCount);
    }
  }

  console.log(modifierType, player ? "" : "(enemy)");

  return new ModifierTypeOption(modifierType as ModifierType, upgradeCount!); // TODO: is this bang correct?
}

export function getDefaultModifierTypeForTier(tier: ModifierTier): ModifierType {
  const modifierPool = getModifierPoolForType(ModifierPoolType.PLAYER);
  let modifierType: ModifierType | WeightedModifierType = modifierPool[tier || ModifierTier.COMMON][0];
  if (modifierType instanceof WeightedModifierType) {
    modifierType = (modifierType as WeightedModifierType).modifierType;
  }
  return modifierType;
}

export class ModifierTypeOption {
  public type: ModifierType;
  public upgradeCount: number;
  public cost: number;

  constructor(type: ModifierType, upgradeCount: number, cost = 0) {
    this.type = type;
    this.upgradeCount = upgradeCount;
    this.cost = Math.min(Math.round(cost), Number.MAX_SAFE_INTEGER);
  }
}

/**
 * Hard cap on the party luck value. Vanilla cap was 14 (each Pokemon contributes
 * 0-3 luck via shininess; clamped to 14 to bound the upgrade-odds formula).
 *
 * v3 raises the cap to 18 — the natural ceiling when all 6 party members are
 * triple-variant shinies (3 luck each). Daily Run still seeds within the
 * legacy 0-14 range so existing daily seeds stay reproducible.
 */
export const MAX_PARTY_LUCK = 18;

/**
 * Calculates the team's luck value.
 * @param party The player's party.
 * @returns A number between 0 and {@linkcode MAX_PARTY_LUCK} based on the
 *   party's total luck value (Daily Run rolls a random 0-14 from the seed).
 */
export function getPartyLuckValue(party: readonly Pokemon[]): number {
  if (globalScene.gameMode.isDaily) {
    const DailyLuck = new NumberHolder(0);
    globalScene.executeWithSeedOffset(
      () => {
        const eventLuck = getDailyEventSeedLuck();
        if (eventLuck != null) {
          DailyLuck.value = eventLuck;
          return;
        }

        DailyLuck.value = randSeedInt(15); // Random number between 0 and 14
      },
      0,
      globalScene.seed,
    );
    return DailyLuck.value;
  }

  const eventSpecies = timedEventManager.getEventLuckBoostedSpecies();
  const luck = Phaser.Math.Clamp(
    party
      .map(p => (p.isAllowedInBattle() ? p.getLuck() + (eventSpecies.includes(p.species.speciesId) ? 1 : 0) : 0))
      .reduce((total: number, value: number) => (total += value), 0),
    0,
    MAX_PARTY_LUCK,
  );
  // ER (#542): a Fairy's Boon grants a TEMPORARY party luck surge for a few waves.
  const fairyLuck = getErTemporaryLuck(globalScene.currentBattle?.waveIndex ?? 0);
  return Math.min(timedEventManager.getEventLuckBoost() + (luck ?? 0) + fairyLuck, MAX_PARTY_LUCK);
}

/**
 * Compute the luck-upgrade odds (per-iteration chance is `4 / upgradeOdds`).
 * Lower numbers = higher chance.
 *
 * Vanilla formula was `floor(128 / ((luck + 4) / 4))` = `floor(512 / (luck + 4))`.
 * v3 changes:
 *   - Slight overall boost: numerator becomes `(luck + 5)` instead of `(luck + 4)`,
 *     pushing each tier up a hair across the whole range.
 *   - Super-linear ramp past the legacy cap (luck 15-18): each point above 14
 *     adds 2 instead of 1, so the curve visibly bends as the player approaches
 *     a max-shiny party.
 *
 * Roughly: per-roll upgrade chance at luck 0 ~3.9%, luck 7 ~9.4%, luck 14
 * ~15.4%, luck 15 ~16.7%, luck 16 ~17.9%, luck 17 ~19.4%, luck 18 ~22.2%.
 */
export function getLuckUpgradeOdds(partyLuckValue: number): number {
  const base = Math.min(partyLuckValue, 14) + 5;
  const overflow = Math.max(0, partyLuckValue - 14) * 2;
  return Math.max(1, Math.floor(512 / (base + overflow)));
}

/**
 * 19 letter-rank entries (indices 0..18). Vanilla shipped 15 entries (D..SSS);
 * v3 adds SSS+ for 15-16 and EX for 17-18 to match the new MAX_PARTY_LUCK = 18.
 */
const LUCK_RANK_TABLE = [
  "D", // 0
  "C", // 1
  "C+", // 2
  "B-", // 3
  "B", // 4
  "B+", // 5
  "A-", // 6
  "A", // 7
  "A+", // 8
  "A++", // 9
  "S", // 10
  "S+", // 11
  "SS", // 12
  "SS+", // 13
  "SSS", // 14
  "SSS+", // 15
  "SSS+", // 16
  "EX", // 17
  "EX", // 18
];

export function getLuckString(luckValue: number): string {
  const idx = Phaser.Math.Clamp(luckValue, 0, MAX_PARTY_LUCK);
  return LUCK_RANK_TABLE[idx];
}

export function getLuckTextTint(luckValue: number): number {
  let modifierTier: ModifierTier;
  // 12+ all map to LUXURY (highest tint); the SSS+/EX ranks at 15-18 share
  // the LUXURY color since there's no higher tier to pull a tint from.
  if (luckValue > 11) {
    modifierTier = ModifierTier.LUXURY;
  } else if (luckValue > 9) {
    modifierTier = ModifierTier.MASTER;
  } else if (luckValue > 5) {
    modifierTier = ModifierTier.ROGUE;
  } else if (luckValue > 2) {
    modifierTier = ModifierTier.ULTRA;
  } else if (luckValue) {
    modifierTier = ModifierTier.GREAT;
  } else {
    modifierTier = ModifierTier.COMMON;
  }
  return getModifierTierTextTint(modifierTier);
}

export function initModifierTypes() {
  for (const [key, value] of Object.entries(modifierTypeInitObj)) {
    modifierTypes[key] = value;
  }
}

// TODO: If necessary, add the rest of the modifier types here.
// For now, doing the minimal work until the modifier rework lands.
const ModifierTypeConstructorMap = Object.freeze({
  ModifierTypeGenerator,
  PokemonHeldItemModifierType,
});

/**
 * Map of of modifier type strings to their constructor type
 */
export type ModifierTypeConstructorMap = typeof ModifierTypeConstructorMap;

/**
 * Map of modifier type strings to their instance type
 */
export type ModifierTypeInstanceMap = {
  [K in keyof ModifierTypeConstructorMap]: InstanceType<ModifierTypeConstructorMap[K]>;
};

export type ModifierTypeString = keyof ModifierTypeConstructorMap;
