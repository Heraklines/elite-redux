import { globalScene } from "#app/global-scene";
import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import type { Challenge } from "#data/challenge";
import {
  FlipStatChallenge,
  FreshStartChallenge,
  InverseBattleChallenge,
  SingleGenerationChallenge,
  SingleTypeChallenge,
} from "#data/challenge";
import { getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { Challenges } from "#enums/challenges";
import { DexAttr } from "#enums/dex-attr";
import { PlayerGender } from "#enums/player-gender";
import { PokemonType } from "#enums/pokemon-type";
import { getShortenedStatKey, Stat } from "#enums/stat";
import { ErRelicModifier, TurnHeldItemTransferModifier } from "#modifiers/modifier";
import { RibbonData } from "#system/ribbons/ribbon-data";
import type { ConditionFn } from "#types/common";
import { isNuzlockeChallenge } from "#utils/challenge-utils";
import { NumberHolder } from "#utils/common";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";
import type { Modifier } from "typescript";

export enum AchvTier {
  COMMON,
  GREAT,
  ULTRA,
  ROGUE,
  MASTER,
}

export class Achv {
  public localizationKey: string;
  public id: string;
  public name: string;
  public description: string;
  public iconImage: string;
  public score: number;

  public secret: boolean;
  public hasParent: boolean;
  public parentId: string;

  protected conditionFunc?: ConditionFn;

  constructor(
    localizationKey: string,
    description: string,
    iconImage: string,
    score: number,
    conditionFunc?: ConditionFn,
  ) {
    this.description = description;
    this.iconImage = iconImage;
    this.score = score;
    if (conditionFunc != null) {
      this.conditionFunc = conditionFunc;
    }
    this.localizationKey = localizationKey;
  }

  /**
   * Get the name of the achievement based on the gender of the player
   * @param playerGender - the gender of the player (default: {@linkcode PlayerGender.UNSET})
   * @returns the name of the achievement localized for the player gender
   */
  getName(playerGender: PlayerGender = PlayerGender.UNSET): string {
    const genderStr = PlayerGender[playerGender].toLowerCase();
    // Localization key is used to get the name of the achievement
    return i18next.t(`achv:${this.localizationKey}.name`, {
      context: genderStr,
    });
  }

  getDescription(): string {
    return this.description;
  }

  getIconImage(): string {
    return this.iconImage;
  }

  setSecret(hasParent?: boolean): this {
    this.secret = true;
    this.hasParent = !!hasParent;
    return this;
  }

  validate(args?: any[]): boolean {
    return !this.conditionFunc || this.conditionFunc(args);
  }

  getTier(): AchvTier {
    if (this.score >= 100) {
      return AchvTier.MASTER;
    }
    if (this.score >= 75) {
      return AchvTier.ROGUE;
    }
    if (this.score >= 50) {
      return AchvTier.ULTRA;
    }
    if (this.score >= 25) {
      return AchvTier.GREAT;
    }
    return AchvTier.COMMON;
  }
}

export class MoneyAchv extends Achv {
  moneyAmount: number;

  constructor(localizationKey: string, moneyAmount: number, iconImage: string, score: number) {
    super(localizationKey, "", iconImage, score, () => globalScene.money >= this.moneyAmount);
    this.moneyAmount = moneyAmount;
  }
}

export class RibbonAchv extends Achv {
  ribbonAmount: number;

  constructor(localizationKey: string, ribbonAmount: number, iconImage: string, score: number) {
    super(
      localizationKey,
      "",
      iconImage,
      score,
      () => globalScene.gameData.gameStats.ribbonsOwned >= this.ribbonAmount,
    );
    this.ribbonAmount = ribbonAmount;
  }
}

export class DamageAchv extends Achv {
  damageAmount: number;
  // intentionally overwriting base property
  protected declare readonly conditionFunc: ConditionFn<[number | NumberHolder]>;

  constructor(localizationKey: string, damageAmount: number, iconImage: string, score: number) {
    super(localizationKey, "", iconImage, score);
    this.conditionFunc = (args: [NumberHolder | number]) =>
      (args[0] instanceof NumberHolder ? args[0].value : args[0]) >= this.damageAmount;
    this.damageAmount = damageAmount;
  }
}

export class HealAchv extends Achv {
  healAmount: number;
  protected declare readonly conditionFunc: ConditionFn<[number | NumberHolder]>;

  constructor(localizationKey: string, healAmount: number, iconImage: string, score: number) {
    super(localizationKey, "", iconImage, score);
    this.conditionFunc = (args: [number | NumberHolder]) =>
      (args[0] instanceof NumberHolder ? args[0].value : args[0]) >= this.healAmount;
    this.healAmount = healAmount;
  }
}

export class LevelAchv extends Achv {
  level: number;

  constructor(localizationKey: string, level: number, iconImage: string, score: number) {
    super(
      localizationKey,
      "",
      iconImage,
      score,
      (args: any[]) => (args[0] instanceof NumberHolder ? args[0].value : args[0]) >= this.level,
    );
    this.level = level;
  }
}

export class ModifierAchv extends Achv {
  constructor(
    localizationKey: string,
    description: string,
    iconImage: string,
    score: number,
    modifierFunc: (modifier: Modifier) => boolean,
  ) {
    super(localizationKey, description, iconImage, score, (args: any[]) => modifierFunc(args[0] as Modifier));
  }
}

export class ChallengeAchv extends Achv {
  constructor(
    localizationKey: string,
    description: string,
    iconImage: string,
    score: number,
    challengeFunc: (challenge: Challenge) => boolean,
  ) {
    super(localizationKey, description, iconImage, score, (args: any[]) => challengeFunc(args[0] as Challenge));
  }
}

/**
 * A transient achievement-bar entry used to announce a granted REWARD through the
 * game's native pop-up. NOT a real achievement (never added to `achvs`): it carries
 * its own display name, reward text, and icon frame, and {@linkcode AchvBar}
 * special-cases it (custom description, no score). One-off, never persisted.
 */
export class RewardAchv extends Achv {
  public readonly rewardText: string;
  private readonly displayName: string;

  constructor(displayName: string, rewardText: string, iconImage: string) {
    super("", "", iconImage, 0);
    this.displayName = displayName;
    this.rewardText = rewardText;
  }

  override getName(_playerGender: PlayerGender = PlayerGender.UNSET): string {
    return this.displayName;
  }
}

/**
 * Get the description of an achievement from the localization file with all the necessary variables filled in
 * @param localizationKey The localization key of the achievement
 * @returns The description of the achievement
 */
export function getAchievementDescription(localizationKey: string): string {
  // We need to get the player gender from the game data to add the correct prefix to the achievement name
  const genderIndex = globalScene?.gameData?.gender ?? PlayerGender.MALE;
  const genderStr = PlayerGender[genderIndex].toLowerCase();

  switch (localizationKey) {
    case "10KMoney":
      return i18next.t("achv:moneyAchv.description", {
        context: genderStr,
        moneyAmount: achvs._10K_MONEY.moneyAmount.toLocaleString("en-US"),
      });
    case "100KMoney":
      return i18next.t("achv:moneyAchv.description", {
        context: genderStr,
        moneyAmount: achvs._100K_MONEY.moneyAmount.toLocaleString("en-US"),
      });
    case "1MMoney":
      return i18next.t("achv:moneyAchv.description", {
        context: genderStr,
        moneyAmount: achvs._1M_MONEY.moneyAmount.toLocaleString("en-US"),
      });
    case "10MMoney":
      return i18next.t("achv:moneyAchv.description", {
        context: genderStr,
        moneyAmount: achvs._10M_MONEY.moneyAmount.toLocaleString("en-US"),
      });
    case "250Dmg":
      return i18next.t("achv:damageAchv.description", {
        context: genderStr,
        damageAmount: achvs._250_DMG.damageAmount.toLocaleString("en-US"),
      });
    case "1000Dmg":
      return i18next.t("achv:damageAchv.description", {
        context: genderStr,
        damageAmount: achvs._1000_DMG.damageAmount.toLocaleString("en-US"),
      });
    case "2500Dmg":
      return i18next.t("achv:damageAchv.description", {
        context: genderStr,
        damageAmount: achvs._2500_DMG.damageAmount.toLocaleString("en-US"),
      });
    case "10000Dmg":
      return i18next.t("achv:damageAchv.description", {
        context: genderStr,
        damageAmount: achvs._10000_DMG.damageAmount.toLocaleString("en-US"),
      });
    case "250Heal":
      return i18next.t("achv:healAchv.description", {
        context: genderStr,
        healAmount: achvs._250_HEAL.healAmount.toLocaleString("en-US"),
        HP: i18next.t(getShortenedStatKey(Stat.HP)),
      });
    case "1000Heal":
      return i18next.t("achv:healAchv.description", {
        context: genderStr,
        healAmount: achvs._1000_HEAL.healAmount.toLocaleString("en-US"),
        HP: i18next.t(getShortenedStatKey(Stat.HP)),
      });
    case "2500Heal":
      return i18next.t("achv:healAchv.description", {
        context: genderStr,
        healAmount: achvs._2500_HEAL.healAmount.toLocaleString("en-US"),
        HP: i18next.t(getShortenedStatKey(Stat.HP)),
      });
    case "10000Heal":
      return i18next.t("achv:healAchv.description", {
        context: genderStr,
        healAmount: achvs._10000_HEAL.healAmount.toLocaleString("en-US"),
        HP: i18next.t(getShortenedStatKey(Stat.HP)),
      });
    case "lv100":
      return i18next.t("achv:levelAchv.description", {
        context: genderStr,
        level: achvs.LV_100.level,
      });
    case "lv250":
      return i18next.t("achv:levelAchv.description", {
        context: genderStr,
        level: achvs.LV_250.level,
      });
    case "lv1000":
      return i18next.t("achv:levelAchv.description", {
        context: genderStr,
        level: achvs.LV_1000.level,
      });
    case "10Ribbons":
      return i18next.t("achv:ribbonAchv.description", {
        context: genderStr,
        ribbonAmount: achvs._10_RIBBONS.ribbonAmount.toLocaleString("en-US"),
      });
    case "25Ribbons":
      return i18next.t("achv:ribbonAchv.description", {
        context: genderStr,
        ribbonAmount: achvs._25_RIBBONS.ribbonAmount.toLocaleString("en-US"),
      });
    case "50Ribbons":
      return i18next.t("achv:ribbonAchv.description", {
        context: genderStr,
        ribbonAmount: achvs._50_RIBBONS.ribbonAmount.toLocaleString("en-US"),
      });
    case "75Ribbons":
      return i18next.t("achv:ribbonAchv.description", {
        context: genderStr,
        ribbonAmount: achvs._75_RIBBONS.ribbonAmount.toLocaleString("en-US"),
      });
    case "100Ribbons":
      return i18next.t("achv:ribbonAchv.description", {
        context: genderStr,
        ribbonAmount: achvs._100_RIBBONS.ribbonAmount.toLocaleString("en-US"),
      });
    case "transferMaxStatStage":
      return i18next.t("achv:transferMaxStatStage.description", {
        context: genderStr,
      });
    case "maxFriendship":
      return i18next.t("achv:maxFriendship.description", {
        context: genderStr,
      });
    case "megaEvolve":
      return i18next.t("achv:megaEvolve.description", { context: genderStr });
    case "gigantamax":
      return i18next.t("achv:gigantamax.description", { context: genderStr });
    case "terastallize":
      return i18next.t("achv:terastallize.description", { context: genderStr });
    case "stellarTerastallize":
      return i18next.t("achv:stellarTerastallize.description", {
        context: genderStr,
      });
    case "splice":
      return i18next.t("achv:splice.description", { context: genderStr });
    case "miniBlackHole":
      return i18next.t("achv:miniBlackHole.description", {
        context: genderStr,
      });
    case "catchMythical":
      return i18next.t("achv:catchMythical.description", {
        context: genderStr,
      });
    case "catchSubLegendary":
      return i18next.t("achv:catchSubLegendary.description", {
        context: genderStr,
      });
    case "catchLegendary":
      return i18next.t("achv:catchLegendary.description", {
        context: genderStr,
      });
    case "seeShiny":
      return i18next.t("achv:seeShiny.description", { context: genderStr });
    case "shinyParty":
      return i18next.t("achv:shinyParty.description", { context: genderStr });
    case "hatchMythical":
      return i18next.t("achv:hatchMythical.description", {
        context: genderStr,
      });
    case "hatchSubLegendary":
      return i18next.t("achv:hatchSubLegendary.description", {
        context: genderStr,
      });
    case "hatchLegendary":
      return i18next.t("achv:hatchLegendary.description", {
        context: genderStr,
      });
    case "hatchShiny":
      return i18next.t("achv:hatchShiny.description", { context: genderStr });
    case "hiddenAbility":
      return i18next.t("achv:hiddenAbility.description", {
        context: genderStr,
      });
    case "perfectIvs":
      return i18next.t("achv:perfectIvs.description", { context: genderStr });
    case "classicVictory":
      return i18next.t("achv:classicVictory.description", {
        context: genderStr,
      });
    case "unevolvedClassicVictory":
      return i18next.t("achv:unevolvedClassicVictory.description", {
        context: genderStr,
      });
    case "monoGenOne":
      return i18next.t("achv:monoGenOne.description", { context: genderStr });
    case "monoGenTwo":
      return i18next.t("achv:monoGenTwo.description", { context: genderStr });
    case "monoGenThree":
      return i18next.t("achv:monoGenThree.description", {
        context: genderStr,
      });
    case "monoGenFour":
      return i18next.t("achv:monoGenFour.description", {
        context: genderStr,
      });
    case "monoGenFive":
      return i18next.t("achv:monoGenFive.description", {
        context: genderStr,
      });
    case "monoGenSix":
      return i18next.t("achv:monoGenSix.description", { context: genderStr });
    case "monoGenSeven":
      return i18next.t("achv:monoGenSeven.description", {
        context: genderStr,
      });
    case "monoGenEight":
      return i18next.t("achv:monoGenEight.description", {
        context: genderStr,
      });
    case "monoGenNine":
      return i18next.t("achv:monoGenNine.description", {
        context: genderStr,
      });
    case "monoNormal":
    case "monoFighting":
    case "monoFlying":
    case "monoPoison":
    case "monoGround":
    case "monoRock":
    case "monoBug":
    case "monoGhost":
    case "monoSteel":
    case "monoFire":
    case "monoWater":
    case "monoGrass":
    case "monoElectric":
    case "monoPsychic":
    case "monoIce":
    case "monoDragon":
    case "monoDark":
    case "monoFairy":
      return i18next.t("achv:monoType.description", {
        context: genderStr,
        type: i18next.t(`pokemonInfo:type.${toCamelCase(localizationKey.slice(4))}`),
      });
    case "freshStart":
      return i18next.t("achv:freshStart.description", { context: genderStr });
    case "inverseBattle":
      return i18next.t("achv:inverseBattle.description", {
        context: genderStr,
      });
    case "flipStats":
      return i18next.t("achv:flipStats.description", { context: genderStr });
    case "flipInverse":
      return i18next.t("achv:flipInverse.description", { context: genderStr });
    case "nuzlocke":
      return i18next.t("achv:nuzlocke.description", { context: genderStr });
    case "breedersInSpace":
      return i18next.t("achv:breedersInSpace.description", {
        context: genderStr,
      });
    case "limbo":
      return i18next.t("achv:limbo.description", { context: genderStr });
    case "purgatory":
      return i18next.t("achv:purgatory.description", { context: genderStr });
    case "inferno":
      return i18next.t("achv:inferno.description", { context: genderStr });
    case "lastStand":
      return i18next.t("achv:lastStand.description", { context: genderStr });
    case "permadeath":
      return i18next.t("achv:permadeath.description", { context: genderStr });
    case "devilsBargain":
      return i18next.t("achv:devilsBargain.description", { context: genderStr });
    case "exorcist":
      return i18next.t("achv:exorcist.description", { context: genderStr });
    case "primalCascoon":
      return i18next.t("achv:primalCascoon.description", { context: genderStr });
    case "beamSpam":
    case "goodChip":
    case "backInBlood":
    case "shieldBreak":
    case "cccCombo":
    case "gear5":
    case "metalSlime":
    case "jurassicEnd":
    case "heedingTheWarning":
    case "megaflare":
    case "yo":
    case "weaveNationCertified":
    case "critMattered":
    case "autoCounter":
    case "snakesOnAPlane":
    case "believeIt":
    case "holdIt":
    case "chainReaction":
    case "iJustGotHere":
    case "sorryForTheWait":
    case "hollowWickerBasket":
    case "everyoneGetOut":
    case "mutuallyAssuredDestruction":
    case "fullOnMegaPower":
    case "originalDragonSpirit":
    case "incompatibleHardware":
    case "dreamcatcher":
    case "compleatNightmare":
    case "pokeHimOn":
    case "superArmor":
    case "pkStarstorm":
    case "realisticFlashIsBoring":
    case "endTheLegend":
    case "squatter":
    // ER Elemental Apex mono-type achievements (their .description keys exist in
    // achv.json; without a case here they hit the default and render blank).
    case "scorchedEarth":
    case "absoluteZero":
    case "endlessNight":
    case "tempest":
    // Achievement expansion wave (#900): Versus / Co-op / Triples / Shiny Lab.
    case "firstBlood":
    case "duelist":
    case "veteranDuelist":
    case "legendaryDuelist":
    case "rawTalent":
    case "budgetChampion":
    case "ragsToRiches":
    case "apexPredator":
    case "theHouseRemembers":
    case "cocytus":
    case "giudecca":
    case "theUpsideDown":
    case "monochromeRequiem":
    case "typecastTrio":
    case "phantomFormation":
    case "highRoller":
    case "allIn":
    case "flawlessDuel":
    case "davidAndGoliath":
    case "goodSport":
    case "coOpInitiate":
    case "betterTogether":
    case "partnersInCrime":
    case "longHaulDuo":
    case "theLongRoad":
    case "dynamicDuo":
    case "generousSoul":
    case "guardianAngel":
    case "sharedTriumph":
    case "centuryOfTrouble":
    case "threesCompany":
    case "tripleThreat":
    case "tripleDown":
    case "centerStage":
    case "holdTheLine":
    case "ghostTriad":
    case "oneTurnClear":
    case "triadOfHell":
    case "fashionista":
    case "lookCollector10":
    case "lookCollector25":
    case "lookCollector50":
    case "lookCollector100":
    case "presetCurator":
    case "signatureStyle":
    // Definitive achievement expansion (70 new): their .description keys exist in
    // achv.json; without a case here they hit the default and render blank.
    case "rankedAndFiled":
    case "greatExpectations":
    case "ultraInstinct":
    case "masterPlan":
    case "championMaterial":
    case "fiveAlarmStreak":
    case "metaBreaker":
    case "capSpace":
    case "houseMoney":
    case "doubleOrNothing":
    case "prodigalMon":
    case "davidWasRanked":
    case "zeroSumHero":
    case "sixPack":
    case "lifelineSubscription":
    case "noIInTeam":
    case "parallelPlay":
    case "hellIsOtherPeople":
    case "weBothLived":
    case "naturalSelectionBias":
    case "formationBreaker":
    case "leftRightGoodnight":
    case "lastMonStanding":
    case "threePieceCombo":
    case "oneHpAndADream":
    case "noSell":
    case "setupPayoff":
    case "zeroToHero":
    case "checkmateInOne":
    case "formVoltron":
    case "pureVanilla":
    case "chargeItToTheGame":
    case "theLongestTurn":
    case "statusQuo":
    case "immortalObject":
    case "technicalDifficulties":
    case "evictionNotice":
    case "identityTheft":
    case "deadRinger":
    case "hellHouse":
    case "tripleExorcism":
    case "finalAnswer":
    case "areYouNotEntertained":
    case "sevenDeadlyCheckboxes":
    case "readTheFinePrint":
    case "justSayNo":
    case "delveTooDeep":
    case "strangerThanFiction":
    case "museumQuality":
    case "blackFriday":
    case "biomeTourist":
    case "fourMachinesOneDream":
    case "goldenTicket":
    case "fusionDance":
    case "twoLegendsOneSlot":
    case "crossVersionCompatibility":
    case "labRat":
    case "presetJetSet":
    case "nameRecognition":
    case "numberGoUp":
    case "groundhogWeek":
    case "hellAndBack":
    case "glassCannon":
    case "generationGap":
    case "houseOfMirrors":
    case "deadChannel":
    case "warOfAttrition":
    case "trinityTest":
    case "oppositionResearch":
    case "monoGenReduxVictory":
      return i18next.t(`achv:${localizationKey}.description`, { context: genderStr });
    case "relicHunter":
      return i18next.t("achv:relicHunter.description", { context: genderStr });
    case "allShinyTiers":
      return i18next.t("achv:allShinyTiers.description", { context: genderStr });
    case "masterOfAll":
      return i18next.t("achv:masterOfAll.description", { context: genderStr });
    case "dailyVictory":
      return i18next.t("achv:dailyVictory.description", { context: genderStr });
    default:
      return "";
  }
}

// TODO: Find a better way to block achievements for certain challenges
/** Returns `true` if the inverse or flip stat challenges are active */
const inverseAndFlipStatAchievementsBlock = () =>
  globalScene.gameMode.challenges.some(
    c => [Challenges.INVERSE_BATTLE, Challenges.FLIP_STAT].includes(c.id) && c.value > 0,
  );

/** Returns `true` if the passives challenge on `all` is active */
const passivesChallengeAchievementsBlock = () =>
  globalScene.gameMode.challenges.some(c => c.id === Challenges.PASSIVES && c.value === 2);

/**
 * Returns `true` when the ER "apex stack" challenges are ALL active: NU usage tier
 * (`USAGE_TIER` value 4) + Doubles Only + Ghost Trainers. Difficulty is gated
 * separately by each tier (Limbo = ace/youngster, Purgatory = elite, Inferno = hell).
 */
const apexStackActive = () => {
  const ch = globalScene.gameMode.challenges;
  return (
    ch.some(c => c.id === Challenges.USAGE_TIER && c.value === 4)
    && ch.some(c => c.id === Challenges.DOUBLES_ONLY && c.value > 0)
    && ch.some(c => c.id === Challenges.GHOST_TRAINERS && c.value > 0)
  );
};

/**
 * Like {@linkcode apexStackActive} but with a mono-TYPE lock in place of the NU
 * usage tier: SingleType(type) + Doubles Only + Ghost Trainers all active. A
 * SingleType challenge stores `type + 1` as its value (see SingleTypeChallenge).
 * Drives the Elemental Apex achievements (Elite/Hell gated separately).
 */
const monoTypeApexActive = (type: PokemonType) => {
  const ch = globalScene.gameMode.challenges;
  return (
    ch.some(c => c.id === Challenges.SINGLE_TYPE && c.value === type + 1)
    && ch.some(c => c.id === Challenges.DOUBLES_ONLY && c.value > 0)
    && ch.some(c => c.id === Challenges.GHOST_TRAINERS && c.value > 0)
  );
};

/**
 * COCYTUS stack: the Inferno stack with TRIPLES_ONLY swapped in for Doubles Only
 * (NU usage tier `value === 4` + Triples Only + Ghost Trainers). The triple format is
 * a distinct, harder axis than doubles, so Cocytus sits deeper than Inferno. Difficulty
 * (hell) is gated separately at the achievement.
 */
const tripleApexStackActive = () => {
  const ch = globalScene.gameMode.challenges;
  return (
    ch.some(c => c.id === Challenges.USAGE_TIER && c.value === 4)
    && ch.some(c => c.id === Challenges.TRIPLES_ONLY && c.value > 0)
    && ch.some(c => c.id === Challenges.GHOST_TRAINERS && c.value > 0)
  );
};

/**
 * GIUDECCA stack: the Inferno stack on the PU usage tier (`value === 3`) instead of NU
 * (PU + Doubles Only + Ghost Trainers). A sibling apex tier at the same reward class as
 * Inferno (a parallel usage-tier flavour).
 * NOTE (codebase tier semantics): usage-tier legality is `lineTier >= challengeValue`, so
 * NU (value 4) is actually the SMALLEST legal pool and PU (value 3) admits PU+NU lines - i.e.
 * PU is a marginally LARGER pool than NU here, not smaller. Giudecca is therefore treated as
 * a SIBLING of Inferno (equal reward tier), not a strictly-harder rung.
 */
const puApexStackActive = () => {
  const ch = globalScene.gameMode.challenges;
  return (
    ch.some(c => c.id === Challenges.USAGE_TIER && c.value === 3)
    && ch.some(c => c.id === Challenges.DOUBLES_ONLY && c.value > 0)
    && ch.some(c => c.id === Challenges.GHOST_TRAINERS && c.value > 0)
  );
};

/** True when a given challenge id is active (value > 0) this run. */
const challengeActive = (id: Challenges) => globalScene.gameMode.challenges.some(c => c.id === id && c.value > 0);

/** True on the Elite or Hell ER difficulty tiers (the two hardest). */
const isEliteOrHell = () => getErDifficulty() === "elite" || getErDifficulty() === "hell";

/** True when either battle-format challenge (Doubles Only / Triples Only) is active. */
const anyFormatChallengeActive = () =>
  challengeActive(Challenges.DOUBLES_ONLY) || challengeActive(Challenges.TRIPLES_ONLY);

/** True when any mono-roster challenge (Single Generation / Single Type / Monocolor) is active. */
const anyMonoRosterChallengeActive = () =>
  challengeActive(Challenges.SINGLE_GENERATION)
  || challengeActive(Challenges.SINGLE_TYPE)
  || challengeActive(Challenges.MONO_COLOR);

/** The ER mono-gen "RDX" pseudo-generation value (ER customs, speciesId >= 10000). */
const ER_RDX_CHALLENGE_GEN = 10;

/** The eighteen mono-TYPE ribbon flags (one per type), for the Master of All achv. */
const MONO_TYPE_RIBBONS = [
  RibbonData.MONO_NORMAL,
  RibbonData.MONO_FIGHTING,
  RibbonData.MONO_FLYING,
  RibbonData.MONO_POISON,
  RibbonData.MONO_GROUND,
  RibbonData.MONO_ROCK,
  RibbonData.MONO_BUG,
  RibbonData.MONO_GHOST,
  RibbonData.MONO_STEEL,
  RibbonData.MONO_FIRE,
  RibbonData.MONO_WATER,
  RibbonData.MONO_GRASS,
  RibbonData.MONO_ELECTRIC,
  RibbonData.MONO_PSYCHIC,
  RibbonData.MONO_ICE,
  RibbonData.MONO_DRAGON,
  RibbonData.MONO_DARK,
  RibbonData.MONO_FAIRY,
] as const;

/**
 * True once every one of the eighteen mono-type ribbons has been earned by ANY
 * species (the ribbon bitfields are OR'd across the whole dex). STATE check -
 * only fired from the ribbon-award transition (game-over), never at load.
 */
const allMonoTypeRibbonsEarned = () => {
  let all = 0n;
  for (const entry of Object.values(globalScene.gameData.dexData)) {
    all |= entry.ribbons.getRibbons();
  }
  return MONO_TYPE_RIBBONS.every(flag => (all & flag) !== 0n);
};

/**
 * True once the dex records a shiny in all three variant tiers (variant 1/2/3) -
 * some entry with each of DEFAULT_VARIANT, VARIANT_2, VARIANT_3 alongside SHINY.
 * Mirrors the starter-select variant-unlock read. STATE check - fired only from
 * the shiny-catch transition, never at load.
 */
const ownsShinyOfEveryTier = () => {
  let has1 = false;
  let has2 = false;
  let has3 = false;
  for (const entry of Object.values(globalScene.gameData.dexData)) {
    const shiny = entry.caughtAttr & DexAttr.SHINY;
    if (!shiny) {
      continue;
    }
    has1 ||= (entry.caughtAttr & DexAttr.DEFAULT_VARIANT) !== 0n;
    has2 ||= (entry.caughtAttr & DexAttr.VARIANT_2) !== 0n;
    has3 ||= (entry.caughtAttr & DexAttr.VARIANT_3) !== 0n;
    if (has1 && has2 && has3) {
      return true;
    }
  }
  return false;
};

export const achvs = {
  CLASSIC_VICTORY: new Achv(
    "classicVictory",
    "classicVictory.description",
    "classic_ribbon_default",
    250,
    () => globalScene.gameData.gameStats.sessionsWon === 0,
  ),
  _10_RIBBONS: new RibbonAchv("10Ribbons", 10, "common_ribbon", 50),
  _25_RIBBONS: new RibbonAchv("25Ribbons", 25, "great_ribbon", 75),
  _50_RIBBONS: new RibbonAchv("50Ribbons", 50, "ultra_ribbon", 100),
  _75_RIBBONS: new RibbonAchv("75Ribbons", 75, "rogue_ribbon", 125),
  _100_RIBBONS: new RibbonAchv("100Ribbons", 100, "master_ribbon", 150),
  _10K_MONEY: new MoneyAchv("10KMoney", 10000, "nugget", 25),
  _100K_MONEY: new MoneyAchv("100KMoney", 100000, "big_nugget", 25).setSecret(true),
  _1M_MONEY: new MoneyAchv("1MMoney", 1000000, "relic_gold", 50).setSecret(true),
  _10M_MONEY: new MoneyAchv("10MMoney", 10000000, "coin_case", 50).setSecret(true),
  _250_DMG: new DamageAchv("250Dmg", 250, "lucky_punch", 25),
  _1000_DMG: new DamageAchv("1000Dmg", 1000, "lucky_punch_great", 25).setSecret(true),
  _2500_DMG: new DamageAchv("2500Dmg", 2500, "lucky_punch_ultra", 50).setSecret(true),
  _10000_DMG: new DamageAchv("10000Dmg", 10000, "lucky_punch_master", 50).setSecret(true),
  _250_HEAL: new HealAchv("250Heal", 250, "potion", 25),
  _1000_HEAL: new HealAchv("1000Heal", 1000, "super_potion", 25).setSecret(true),
  _2500_HEAL: new HealAchv("2500Heal", 2500, "hyper_potion", 50).setSecret(true),
  _10000_HEAL: new HealAchv("10000Heal", 10000, "max_potion", 50).setSecret(true),
  LV_100: new LevelAchv("lv100", 100, "rare_candy", 25).setSecret(),
  LV_250: new LevelAchv("lv250", 250, "rarer_candy", 25).setSecret(true),
  LV_1000: new LevelAchv("lv1000", 1000, "candy_jar", 50).setSecret(true),
  TRANSFER_MAX_STAT_STAGE: new Achv("transferMaxStatStage", "transferMaxStatStage.description", "baton", 25),
  MAX_FRIENDSHIP: new Achv("maxFriendship", "maxFriendship.description", "ribbon_friendship", 25),
  MEGA_EVOLVE: new Achv("megaEvolve", "megaEvolve.description", "mega_bracelet", 50),
  GIGANTAMAX: new Achv("gigantamax", "gigantamax.description", "dynamax_band", 50),
  TERASTALLIZE: new Achv("terastallize", "terastallize.description", "tera_orb", 25),
  STELLAR_TERASTALLIZE: new Achv(
    "stellarTerastallize",
    "stellarTerastallize.description",
    "stellar_tera_shard",
    25,
  ).setSecret(true),
  SPLICE: new Achv("splice", "splice.description", "dna_splicers", 50),
  MINI_BLACK_HOLE: new ModifierAchv(
    "miniBlackHole",
    "miniBlackHole.description",
    "mini_black_hole",
    25,
    modifier => modifier instanceof TurnHeldItemTransferModifier,
  ).setSecret(),
  HIDDEN_ABILITY: new Achv("hiddenAbility", "hiddenAbility.description", "ability_charm", 25),
  PERFECT_IVS: new Achv("perfectIvs", "perfectIvs.description", "blunder_policy", 25),
  SEE_SHINY: new Achv("seeShiny", "seeShiny.description", "pb_gold", 50),
  SHINY_PARTY: new Achv("shinyParty", "shinyParty.description", "shiny_charm", 50).setSecret(true),
  CATCH_SUB_LEGENDARY: new Achv("catchSubLegendary", "catchSubLegendary.description", "rb", 50).setSecret(),
  CATCH_MYTHICAL: new Achv("catchMythical", "catchMythical.description", "strange_ball", 75).setSecret(),
  CATCH_LEGENDARY: new Achv("catchLegendary", "catchLegendary.description", "mb", 100).setSecret(),
  HATCH_SUB_LEGENDARY: new Achv("hatchSubLegendary", "hatchSubLegendary.description", "epic_egg", 50).setSecret(),
  HATCH_MYTHICAL: new Achv("hatchMythical", "hatchMythical.description", "manaphy_egg", 50).setSecret(),
  HATCH_LEGENDARY: new Achv("hatchLegendary", "hatchLegendary.description", "legendary_egg", 100).setSecret(),
  HATCH_SHINY: new Achv("hatchShiny", "hatchShiny.description", "rogue_egg", 100).setSecret(),
  DAILY_VICTORY: new Achv("dailyVictory", "dailyVictory.description", "calendar", 100),
  FRESH_START: new ChallengeAchv(
    "freshStart",
    "freshStart.description",
    "reviver_seed",
    100,
    c =>
      c instanceof FreshStartChallenge
      && c.value === 1
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  NUZLOCKE: new ChallengeAchv(
    "nuzlocke",
    "nuzlocke.description",
    "leaf_stone",
    100,
    () => isNuzlockeChallenge() && !inverseAndFlipStatAchievementsBlock() && !passivesChallengeAchievementsBlock(),
  ),
  INVERSE_BATTLE: new ChallengeAchv(
    "inverseBattle",
    "inverseBattle.description",
    "inverse",
    100,
    c => c instanceof InverseBattleChallenge && c.value > 0,
  ),
  FLIP_STATS: new ChallengeAchv(
    "flipStats",
    "flipStats.description",
    "dubious_disc",
    100,
    c => c instanceof FlipStatChallenge && c.value > 0,
  ),
  MONO_GEN_ONE_VICTORY: new ChallengeAchv(
    "monoGenOne",
    "monoGenOne.description",
    "ribbon_gen1",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 1
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_GEN_TWO_VICTORY: new ChallengeAchv(
    "monoGenTwo",
    "monoGenTwo.description",
    "ribbon_gen2",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 2
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_GEN_THREE_VICTORY: new ChallengeAchv(
    "monoGenThree",
    "monoGenThree.description",
    "ribbon_gen3",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 3
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_GEN_FOUR_VICTORY: new ChallengeAchv(
    "monoGenFour",
    "monoGenFour.description",
    "ribbon_gen4",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 4
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_GEN_FIVE_VICTORY: new ChallengeAchv(
    "monoGenFive",
    "monoGenFive.description",
    "ribbon_gen5",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 5
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_GEN_SIX_VICTORY: new ChallengeAchv(
    "monoGenSix",
    "monoGenSix.description",
    "ribbon_gen6",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 6
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_GEN_SEVEN_VICTORY: new ChallengeAchv(
    "monoGenSeven",
    "monoGenSeven.description",
    "ribbon_gen7",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 7
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_GEN_EIGHT_VICTORY: new ChallengeAchv(
    "monoGenEight",
    "monoGenEight.description",
    "ribbon_gen8",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 8
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_GEN_NINE_VICTORY: new ChallengeAchv(
    "monoGenNine",
    "monoGenNine.description",
    "ribbon_gen9",
    100,
    c =>
      c instanceof SingleGenerationChallenge
      && c.value === 9
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_NORMAL: new ChallengeAchv(
    "monoNormal",
    "monoNormal.description",
    "ribbon_normal",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 1
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_FIGHTING: new ChallengeAchv(
    "monoFighting",
    "monoFighting.description",
    "ribbon_fighting",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 2
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_FLYING: new ChallengeAchv(
    "monoFlying",
    "monoFlying.description",
    "ribbon_flying",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 3
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_POISON: new ChallengeAchv(
    "monoPoison",
    "monoPoison.description",
    "ribbon_poison",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 4
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_GROUND: new ChallengeAchv(
    "monoGround",
    "monoGround.description",
    "ribbon_ground",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 5
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_ROCK: new ChallengeAchv(
    "monoRock",
    "monoRock.description",
    "ribbon_rock",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 6
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_BUG: new ChallengeAchv(
    "monoBug",
    "monoBug.description",
    "ribbon_bug",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 7
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_GHOST: new ChallengeAchv(
    "monoGhost",
    "monoGhost.description",
    "ribbon_ghost",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 8
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_STEEL: new ChallengeAchv(
    "monoSteel",
    "monoSteel.description",
    "ribbon_steel",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 9
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_FIRE: new ChallengeAchv(
    "monoFire",
    "monoFire.description",
    "ribbon_fire",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 10
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_WATER: new ChallengeAchv(
    "monoWater",
    "monoWater.description",
    "ribbon_water",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 11
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_GRASS: new ChallengeAchv(
    "monoGrass",
    "monoGrass.description",
    "ribbon_grass",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 12
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_ELECTRIC: new ChallengeAchv(
    "monoElectric",
    "monoElectric.description",
    "ribbon_electric",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 13
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_PSYCHIC: new ChallengeAchv(
    "monoPsychic",
    "monoPsychic.description",
    "ribbon_psychic",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 14
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_ICE: new ChallengeAchv(
    "monoIce",
    "monoIce.description",
    "ribbon_ice",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 15
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_DRAGON: new ChallengeAchv(
    "monoDragon",
    "monoDragon.description",
    "ribbon_dragon",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 16
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_DARK: new ChallengeAchv(
    "monoDark",
    "monoDark.description",
    "ribbon_dark",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 17
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  MONO_FAIRY: new ChallengeAchv(
    "monoFairy",
    "monoFairy.description",
    "ribbon_fairy",
    100,
    c =>
      c instanceof SingleTypeChallenge
      && c.value === 18
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  UNEVOLVED_CLASSIC_VICTORY: new Achv(
    "unevolvedClassicVictory",
    "unevolvedClassicVictory.description",
    "eviolite",
    50,
    () => globalScene.getPlayerParty().some(p => p.getSpeciesForm(true).speciesId in pokemonEvolutions),
  ),
  FLIP_INVERSE: new ChallengeAchv(
    "flipInverse",
    "flipInverse.description",
    "cracked_pot",
    50,
    c =>
      c instanceof FlipStatChallenge
      && c.value > 0
      && globalScene.gameMode.challenges.some(c => c.id === Challenges.INVERSE_BATTLE && c.value > 0),
  ).setSecret(),
  BREEDERS_IN_SPACE: new Achv("breedersInSpace", "breedersInSpace.description", "moon_stone", 50).setSecret(),
  // ER apex stack: NU usage tier + Doubles Only + Ghost Trainers, one tier per
  // difficulty (difficulty-exclusive, so a single run unlocks exactly one). Auto-
  // validated at game-over (ChallengeAchv) only on a challenge victory.
  LIMBO: new ChallengeAchv(
    "limbo",
    "limbo.description",
    "spell_tag",
    100,
    () => apexStackActive() && (getErDifficulty() === "ace" || getErDifficulty() === "youngster"),
  ),
  PURGATORY: new ChallengeAchv(
    "purgatory",
    "purgatory.description",
    "reaper_cloth",
    125,
    () => apexStackActive() && getErDifficulty() === "elite",
  ),
  INFERNO: new ChallengeAchv(
    "inferno",
    "inferno.description",
    "pb_black",
    150,
    () => apexStackActive() && getErDifficulty() === "hell",
  ),
  // ER "Elemental Apex": a mono-TYPE run with Doubles Only + Ghost Trainers cleared
  // on Elite or Hell. Same shape as the apex stack, swapping the NU usage tier for a
  // single-type lock. Each unlocks a matching Shiny Lab aura (er-shiny-lab-effects).
  SCORCHED_EARTH: new ChallengeAchv(
    "scorchedEarth",
    "scorchedEarth.description",
    "flame_plate",
    130,
    () => monoTypeApexActive(PokemonType.FIRE) && (getErDifficulty() === "elite" || getErDifficulty() === "hell"),
  ),
  ABSOLUTE_ZERO: new ChallengeAchv(
    "absoluteZero",
    "absoluteZero.description",
    "icicle_plate",
    130,
    () => monoTypeApexActive(PokemonType.ICE) && (getErDifficulty() === "elite" || getErDifficulty() === "hell"),
  ),
  ENDLESS_NIGHT: new ChallengeAchv(
    "endlessNight",
    "endlessNight.description",
    "dread_plate",
    130,
    () => monoTypeApexActive(PokemonType.DARK) && (getErDifficulty() === "elite" || getErDifficulty() === "hell"),
  ),
  TEMPEST: new ChallengeAchv(
    "tempest",
    "tempest.description",
    "zap_plate",
    130,
    () => monoTypeApexActive(PokemonType.ELECTRIC) && (getErDifficulty() === "elite" || getErDifficulty() === "hell"),
  ),
  // ER difficulty-tiered Nuzlocke (the base NUZLOCKE above still fires on any
  // difficulty; these add the harder Elite/Hell tiers with bigger shiny rewards).
  LAST_STAND: new ChallengeAchv(
    "lastStand",
    "lastStand.description",
    "focus_sash",
    110,
    () =>
      isNuzlockeChallenge()
      && getErDifficulty() === "elite"
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  PERMADEATH: new ChallengeAchv(
    "permadeath",
    "permadeath.description",
    "dusk_stone",
    125,
    () =>
      isNuzlockeChallenge()
      && getErDifficulty() === "hell"
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  // ER milestone achievements (event-gated). The three event-based ones are plain
  // Achvs validated at their phase site; the three state-based ones carry a
  // conditionFunc GATE and are validated only from the matching in-run transition
  // (a relic pickup / a shiny catch / the ribbon award) so they never fire on load.
  DEVILS_BARGAIN: new Achv("devilsBargain", "devilsBargain.description", "soul_dew", 50),
  EXORCIST: new Achv("exorcist", "exorcist.description", "ghost_gem", 75),
  PRIMAL_CASCOON: new Achv("primalCascoon", "primalCascoon.description", "shed_shell", 100),
  BEAM_SPAM: new Achv("beamSpam", "beamSpam.description", "lucky_punch", 50),
  GOOD_CHIP: new Achv("goodChip", "goodChip.description", "toxic_orb", 50),
  BACK_IN_BLOOD: new Achv("backInBlood", "backInBlood.description", "ability_charm", 50),
  SHIELD_BREAK: new Achv("shieldBreak", "shieldBreak.description", "brick", 50),
  CCC_COMBO: new Achv("cccCombo", "cccCombo.description", "multi_lens", 50),
  GEAR_5: new Achv("gear5", "gear5.description", "mega_bracelet", 50),
  METAL_SLIME: new Achv("metalSlime", "metalSlime.description", "metal_coat", 50),
  JURASSIC_END: new Achv("jurassicEnd", "jurassicEnd.description", "old_amber", 50),
  HEEDING_THE_WARNING: new Achv("heedingTheWarning", "heedingTheWarning.description", "pb_gold", 50),
  MEGAFLARE: new Achv("megaflare", "megaflare.description", "tm_dragon", 50),
  YO: new Achv("yo", "yo.description", "pb_gold", 50),
  WEAVE_NATION_CERTIFIED: new Achv("weaveNationCertified", "weaveNationCertified.description", "bright_powder", 50),
  CRIT_MATTERED: new Achv("critMattered", "critMattered.description", "scope_lens", 50),
  AUTO_COUNTER: new Achv("autoCounter", "autoCounter.description", "focus_band", 50),
  SNAKES_ON_A_PLANE: new Achv("snakesOnAPlane", "snakesOnAPlane.description", "ribbon_flying", 75),
  BELIEVE_IT: new Achv("believeIt", "believeIt.description", "fire_stone", 50),
  HOLD_IT: new Achv("holdIt", "holdIt.description", "protective_pads", 50),
  CHAIN_REACTION: new Achv("chainReaction", "chainReaction.description", "linking_cord", 50),
  I_JUST_GOT_HERE: new Achv("iJustGotHere", "iJustGotHere.description", "eject_button", 50),
  SORRY_FOR_THE_WAIT: new Achv("sorryForTheWait", "sorryForTheWait.description", "power_herb", 75),
  HOLLOW_WICKER_BASKET: new Achv("hollowWickerBasket", "hollowWickerBasket.description", "trick_room", 50),
  RELIC_HUNTER: new Achv(
    "relicHunter",
    "relicHunter.description",
    "relic_band",
    50,
    () => globalScene.findModifiers(m => m instanceof ErRelicModifier).length >= 5,
  ),
  ALL_SHINY_TIERS: new Achv("allShinyTiers", "allShinyTiers.description", "pb_gold", 75, () => ownsShinyOfEveryTier()),
  MASTER_OF_ALL: new Achv("masterOfAll", "masterOfAll.description", "relic_crown", 150, () =>
    allMonoTypeRibbonsEarned(),
  ),
  // === ER feat/collection achievements (batch 2) ============================
  // Event-gated plain Achvs validated from the matching er-achievement-tracker
  // hook (the same pattern as the BEAM_SPAM..HOLLOW_WICKER_BASKET block above).
  // Icons are existing item-atlas frames chosen thematically.
  EVERYONE_GET_OUT: new Achv("everyoneGetOut", "everyoneGetOut.description", "eject_button", 50),
  MUTUALLY_ASSURED_DESTRUCTION: new Achv(
    "mutuallyAssuredDestruction",
    "mutuallyAssuredDestruction.description",
    "reaper_cloth",
    50,
  ),
  FULL_ON_MEGA_POWER: new Achv("fullOnMegaPower", "fullOnMegaPower.description", "mega_bracelet", 75),
  ORIGINAL_DRAGON_SPIRIT: new Achv("originalDragonSpirit", "originalDragonSpirit.description", "dna_splicers", 50),
  INCOMPATIBLE_HARDWARE: new Achv("incompatibleHardware", "incompatibleHardware.description", "dubious_disc", 25),
  DREAMCATCHER: new Achv("dreamcatcher", "dreamcatcher.description", "moon_stone", 50),
  COMPLEAT_NIGHTMARE: new Achv("compleatNightmare", "compleatNightmare.description", "dread_plate", 25),
  POKE_HIM_ON: new Achv("pokeHimOn", "pokeHimOn.description", "zap_plate", 25),
  SUPER_ARMOR: new Achv("superArmor", "superArmor.description", "metal_coat", 50),
  PK_STARSTORM: new Achv("pkStarstorm", "pkStarstorm.description", "tm_dragon", 25),
  REALISTIC_FLASH_IS_BORING: new Achv("realisticFlashIsBoring", "realisticFlashIsBoring.description", "power_herb", 50),
  END_THE_LEGEND: new Achv("endTheLegend", "endTheLegend.description", "brick", 50),
  // Stay in one biome for >= 20 waves (deliberate overstay through full notoriety).
  SQUATTER: new Achv("squatter", "squatter.description", "leftovers", 50),

  // === Achievement expansion wave (#900) ===================================
  // All event-gated plain Achvs validated from the ER social/versus/coop tracker
  // (er-social-achievement-tracker) or the Shiny Lab callbacks - same observer
  // pattern as the BEAM_SPAM..SQUATTER block above (the tracker gates the
  // condition; these carry no conditionFunc so validate() is a pass-through).
  // Icons are existing item-atlas frames chosen thematically.

  // --- Versus: Showdown 1v1 PvP -------------------------------------------
  // Win-count records: renamed from the opaque RIVAL_RECORD_N to self-explanatory
  // Duelist ranks (they are lifetime showdown-WIN totals, not a rival streak).
  FIRST_BLOOD: new Achv("firstBlood", "firstBlood.description", "brick", 25),
  DUELIST: new Achv("duelist", "duelist.description", "rb", 50),
  VETERAN_DUELIST: new Achv("veteranDuelist", "veteranDuelist.description", "mb", 75),
  LEGENDARY_DUELIST: new Achv("legendaryDuelist", "legendaryDuelist.description", "relic_crown", 100),
  HIGH_ROLLER: new Achv("highRoller", "highRoller.description", "coin_case", 50),
  ALL_IN: new Achv("allIn", "allIn.description", "relic_gold", 75),
  FLAWLESS_DUEL: new Achv("flawlessDuel", "flawlessDuel.description", "focus_sash", 75),
  DAVID_AND_GOLIATH: new Achv("davidAndGoliath", "davidAndGoliath.description", "focus_band", 75),
  GOOD_SPORT: new Achv("goodSport", "goodSport.description", "ribbon_friendship", 25),
  // #900 follow-up: skill / restriction Showdown feats (detected in evaluateShowdownResult).
  RAW_TALENT: new Achv("rawTalent", "rawTalent.description", "eviolite", 50),
  BUDGET_CHAMPION: new Achv("budgetChampion", "budgetChampion.description", "nugget", 50),
  RAGS_TO_RICHES: new Achv("ragsToRiches", "ragsToRiches.description", "big_nugget", 75),
  APEX_PREDATOR: new Achv("apexPredator", "apexPredator.description", "scope_lens", 75),
  // Gambler's consolation: LOSE a shiny you staked in a Showdown wager (settlement takes it).
  THE_HOUSE_REMEMBERS: new Achv("theHouseRemembers", "theHouseRemembers.description", "soul_dew", 50),

  // --- Co-op: shared-run feats --------------------------------------------
  CO_OP_INITIATE: new Achv("coOpInitiate", "coOpInitiate.description", "linking_cord", 25),
  BETTER_TOGETHER: new Achv("betterTogether", "betterTogether.description", "linking_cord", 25),
  PARTNERS_IN_CRIME: new Achv("partnersInCrime", "partnersInCrime.description", "linking_cord", 50),
  LONG_HAUL_DUO: new Achv("longHaulDuo", "longHaulDuo.description", "leftovers", 75),
  THE_LONG_ROAD: new Achv("theLongRoad", "theLongRoad.description", "dusk_stone", 100),
  DYNAMIC_DUO: new Achv("dynamicDuo", "dynamicDuo.description", "classic_ribbon_default", 100),
  GENEROUS_SOUL: new Achv("generousSoul", "generousSoul.description", "soul_dew", 25),
  GUARDIAN_ANGEL: new Achv("guardianAngel", "guardianAngel.description", "focus_sash", 50),
  SHARED_TRIUMPH: new Achv("sharedTriumph", "sharedTriumph.description", "legendary_egg", 100),
  // Reach wave 100 in co-op on Hell (renamed + retuned from the old wave-25 Double Trouble).
  CENTURY_OF_TROUBLE: new Achv("centuryOfTrouble", "centuryOfTrouble.description", "dread_plate", 100),

  // --- Battle: Triple Battle feats ----------------------------------------
  THREES_COMPANY: new Achv("threesCompany", "threesCompany.description", "multi_lens", 25),
  TRIPLE_THREAT: new Achv("tripleThreat", "tripleThreat.description", "multi_lens", 50),
  TRIPLE_DOWN: new Achv("tripleDown", "tripleDown.description", "multi_lens", 75),
  CENTER_STAGE: new Achv("centerStage", "centerStage.description", "scope_lens", 50),
  HOLD_THE_LINE: new Achv("holdTheLine", "holdTheLine.description", "protective_pads", 50),
  GHOST_TRIAD: new Achv("ghostTriad", "ghostTriad.description", "ghost_gem", 75),
  ONE_TURN_CLEAR: new Achv("oneTurnClear", "oneTurnClear.description", "power_herb", 75),
  TRIAD_OF_HELL: new Achv("triadOfHell", "triadOfHell.description", "dread_plate", 100),

  // --- Collection: Shiny Lab feats ----------------------------------------
  FASHIONISTA: new Achv("fashionista", "fashionista.description", "shiny_charm", 25),
  LOOK_COLLECTOR_10: new Achv("lookCollector10", "lookCollector10.description", "shiny_charm", 25),
  LOOK_COLLECTOR_25: new Achv("lookCollector25", "lookCollector25.description", "shiny_charm", 50),
  LOOK_COLLECTOR_50: new Achv("lookCollector50", "lookCollector50.description", "shiny_charm", 75),
  LOOK_COLLECTOR_100: new Achv("lookCollector100", "lookCollector100.description", "shiny_charm", 100),
  PRESET_CURATOR: new Achv("presetCurator", "presetCurator.description", "baton", 50),
  SIGNATURE_STYLE: new Achv("signatureStyle", "signatureStyle.description", "pb_gold", 75),

  // === #900 follow-up: challenge-stack apex + combo clears ==================
  // Auto-validated at game-over (ChallengeAchv) only on a challenge victory - each
  // reads gameMode.challenges via a pure helper (ignoring the per-challenge arg), so
  // it fires once regardless of which challenge triggers the sweep. CHALLENGE category
  // is inferred from the subclass.

  // Deeper apex rungs beyond Inferno (Divine-Comedy-adjacent). COCYTUS = the frozen
  // ninth circle (NU + Triples Only + Ghost Trainers, hell). GIUDECCA = its innermost
  // round (PU + Doubles Only + Ghost Trainers, hell), a sibling apex to Inferno.
  COCYTUS: new ChallengeAchv(
    "cocytus",
    "cocytus.description",
    "icicle_plate",
    175,
    () => tripleApexStackActive() && getErDifficulty() === "hell",
  ),
  GIUDECCA: new ChallengeAchv(
    "giudecca",
    "giudecca.description",
    "pb_black",
    160,
    () => puApexStackActive() && getErDifficulty() === "hell",
  ),
  // Tasteful challenge-combination clears (mid-tier). Each requires BOTH named
  // challenges active on a victory; the inverse/flip + passives-all blocks apply
  // except where the combo itself requires inverse.
  THE_UPSIDE_DOWN: new ChallengeAchv(
    "theUpsideDown",
    "theUpsideDown.description",
    "inverse",
    110,
    () => isNuzlockeChallenge() && challengeActive(Challenges.INVERSE_BATTLE) && !passivesChallengeAchievementsBlock(),
  ),
  MONOCHROME_REQUIEM: new ChallengeAchv(
    "monochromeRequiem",
    "monochromeRequiem.description",
    "dubious_disc",
    110,
    () =>
      isNuzlockeChallenge()
      && challengeActive(Challenges.MONO_COLOR)
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  TYPECAST_TRIO: new ChallengeAchv(
    "typecastTrio",
    "typecastTrio.description",
    "multi_lens",
    100,
    () =>
      challengeActive(Challenges.SINGLE_TYPE)
      && challengeActive(Challenges.TRIPLES_ONLY)
      && !inverseAndFlipStatAchievementsBlock()
      && !passivesChallengeAchievementsBlock(),
  ),
  // Win a run with Triples Only + Ghost Trainers both active, at ANY difficulty. Same
  // challenge-stack detection pattern as COCYTUS (fired from the game-over ChallengeAchv
  // loop); a full-run clear, so the +2 Premium run-completion bonus applies and it gates
  // the Double Team ("echoes") aura via ER_SHINY_LAB_EFFECT_ACHV.
  PHANTOM_FORMATION: new ChallengeAchv(
    "phantomFormation",
    "phantomFormation.description",
    "ghost_gem",
    120,
    () => challengeActive(Challenges.TRIPLES_ONLY) && challengeActive(Challenges.GHOST_TRAINERS),
  ),

  // === Definitive achievement expansion (70 new) ===========================
  // Detection/tracking lives in the ER trackers (separate work); these carry NO
  // conditionFunc so validate() is a pass-through EXCEPT the §2.8 full-run challenges,
  // which are ChallengeAchvs validated at game-over on a challenge victory. Scores:
  // Easy=25, Medium=50, Hard=75, Very-hard=100 (MASTER_PLAN 110, TRINITY_TEST 120,
  // ARE_YOU_NOT_ENTERTAINED 120, CHAMPION_MATERIAL 150). Icons are existing item-atlas
  // frames from the catalog's verified icon map.

  // --- §2.1 Versus and ranked ---------------------------------------------
  RANKED_AND_FILED: new Achv("rankedAndFiled", "rankedAndFiled.description", "pb", 25),
  GREAT_EXPECTATIONS: new Achv("greatExpectations", "greatExpectations.description", "gb", 50),
  ULTRA_INSTINCT: new Achv("ultraInstinct", "ultraInstinct.description", "ub", 75),
  MASTER_PLAN: new Achv("masterPlan", "masterPlan.description", "mb", 110),
  CHAMPION_MATERIAL: new Achv("championMaterial", "championMaterial.description", "classic_ribbon_15", 150),
  FIVE_ALARM_STREAK: new Achv("fiveAlarmStreak", "fiveAlarmStreak.description", "flame_orb", 75),
  META_BREAKER: new Achv("metaBreaker", "metaBreaker.description", "everstone", 100),
  CAP_SPACE: new Achv("capSpace", "capSpace.description", "coupon", 75),
  HOUSE_MONEY: new Achv("houseMoney", "houseMoney.description", "coin_case", 100),
  DOUBLE_OR_NOTHING: new Achv("doubleOrNothing", "doubleOrNothing.description", "loaded_dice", 100),
  PRODIGAL_MON: new Achv("prodigalMon", "prodigalMon.description", "linking_cord", 75),
  // Secret until the ranked ladder exposes the OPPONENT's tier client-side (the
  // pre-match tier comparison cannot be observed yet), so it ships hidden rather
  // than visibly unearnable. Wire detection with the ranked-ladder expansion.
  DAVID_WAS_RANKED: new Achv("davidWasRanked", "davidWasRanked.description", "lucky_punch", 75).setSecret(),
  ZERO_SUM_HERO: new Achv("zeroSumHero", "zeroSumHero.description", "metal_powder", 100),

  // --- §2.2 Co-op ---------------------------------------------------------
  SIX_PACK: new Achv("sixPack", "sixPack.description", "exp_share", 25),
  LIFELINE_SUBSCRIPTION: new Achv("lifelineSubscription", "lifelineSubscription.description", "max_revive", 75),
  NO_I_IN_TEAM: new Achv("noIInTeam", "noIInTeam.description", "exp_balance", 50),
  PARALLEL_PLAY: new Achv("parallelPlay", "parallelPlay.description", "multi_lens", 75),
  HELL_IS_OTHER_PEOPLE: new Achv("hellIsOtherPeople", "hellIsOtherPeople.description", "flame_plate", 100),
  WE_BOTH_LIVED: new Achv("weBothLived", "weBothLived.description", "sacred_ash", 100),

  // --- §2.3 Battle, triples, ghost combat ---------------------------------
  NATURAL_SELECTION_BIAS: new Achv("naturalSelectionBias", "naturalSelectionBias.description", "wide_lens", 75),
  FORMATION_BREAKER: new Achv("formationBreaker", "formationBreaker.description", "ground_gem", 75),
  LEFT_RIGHT_GOODNIGHT: new Achv("leftRightGoodnight", "leftRightGoodnight.description", "black_belt", 50),
  LAST_MON_STANDING: new Achv("lastMonStanding", "lastMonStanding.description", "focus_band", 75),
  THREE_PIECE_COMBO: new Achv("threePieceCombo", "threePieceCombo.description", "metronome", 75),
  ONE_HP_AND_A_DREAM: new Achv("oneHpAndADream", "oneHpAndADream.description", "focus_sash", 100),
  NO_SELL: new Achv("noSell", "noSell.description", "weakness_policy", 75),
  SETUP_PAYOFF: new Achv("setupPayoff", "setupPayoff.description", "x_attack", 50),
  ZERO_TO_HERO: new Achv("zeroToHero", "zeroToHero.description", "shell_bell", 75),
  CHECKMATE_IN_ONE: new Achv("checkmateInOne", "checkmateInOne.description", "scope_lens", 100),
  FORM_VOLTRON: new Achv("formVoltron", "formVoltron.description", "reveal_glass", 50),
  PURE_VANILLA: new Achv("pureVanilla", "pureVanilla.description", "mint_neutral", 75),
  CHARGE_IT_TO_THE_GAME: new Achv("chargeItToTheGame", "chargeItToTheGame.description", "power_herb", 50),
  THE_LONGEST_TURN: new Achv("theLongestTurn", "theLongestTurn.description", "grip_claw", 50),
  STATUS_QUO: new Achv("statusQuo", "statusQuo.description", "toxic_orb", 100),
  IMMORTAL_OBJECT: new Achv("immortalObject", "immortalObject.description", "relic_band", 50),

  // --- §2.4 Training ------------------------------------------------------
  TECHNICAL_DIFFICULTIES: new Achv("technicalDifficulties", "technicalDifficulties.description", "tm_normal", 25),

  // --- §2.5 Mystery encounters and events ---------------------------------
  EVICTION_NOTICE: new Achv("evictionNotice", "evictionNotice.description", "spell_tag", 75),
  IDENTITY_THEFT: new Achv("identityTheft", "identityTheft.description", "scanner", 75),
  DEAD_RINGER: new Achv("deadRinger", "deadRinger.description", "reaper_cloth", 75),
  HELL_HOUSE: new Achv("hellHouse", "hellHouse.description", "spooky_plate", 100),
  TRIPLE_EXORCISM: new Achv("tripleExorcism", "tripleExorcism.description", "ghost_gem", 100),
  FINAL_ANSWER: new Achv("finalAnswer", "finalAnswer.description", "wise_glasses", 50),
  ARE_YOU_NOT_ENTERTAINED: new Achv("areYouNotEntertained", "areYouNotEntertained.description", "leaders_crest", 120),
  SEVEN_DEADLY_CHECKBOXES: new Achv("sevenDeadlyCheckboxes", "sevenDeadlyCheckboxes.description", "prison_bottle", 100),
  READ_THE_FINE_PRINT: new Achv("readTheFinePrint", "readTheFinePrint.description", "griseous_core", 75),
  JUST_SAY_NO: new Achv("justSayNo", "justSayNo.description", "light_stone", 50),
  DELVE_TOO_DEEP: new Achv("delveTooDeep", "delveTooDeep.description", "black_augurite", 100),
  STRANGER_THAN_FICTION: new Achv("strangerThanFiction", "strangerThanFiction.description", "old_gateau", 75),

  // --- §2.6 Collection, economy, fusion, Shiny Lab ------------------------
  MUSEUM_QUALITY: new Achv("museumQuality", "museumQuality.description", "relic_gold", 75),
  BLACK_FRIDAY: new Achv("blackFriday", "blackFriday.description", "black_glasses", 75),
  BIOME_TOURIST: new Achv("biomeTourist", "biomeTourist.description", "map", 75),
  FOUR_MACHINES_ONE_DREAM: new Achv("fourMachinesOneDream", "fourMachinesOneDream.description", "mystery_egg", 50),
  GOLDEN_TICKET: new Achv("goldenTicket", "goldenTicket.description", "golden_mystic_ticket", 50),
  FUSION_DANCE: new Achv("fusionDance", "fusionDance.description", "dna_splicers", 50),
  TWO_LEGENDS_ONE_SLOT: new Achv("twoLegendsOneSlot", "twoLegendsOneSlot.description", "n_lunarizer", 75),
  CROSS_VERSION_COMPATIBILITY: new Achv(
    "crossVersionCompatibility",
    "crossVersionCompatibility.description",
    "n_solarizer",
    75,
  ),
  LAB_RAT: new Achv("labRat", "labRat.description", "shiny_stone", 50),
  PRESET_JET_SET: new Achv("presetJetSet", "presetJetSet.description", "pair_of_tickets", 75),
  NAME_RECOGNITION: new Achv("nameRecognition", "nameRecognition.description", "silk_scarf", 75),
  NUMBER_GO_UP: new Achv("numberGoUp", "numberGoUp.description", "amulet_coin", 50),

  // --- §2.7 Victory meta-achievements -------------------------------------
  GROUNDHOG_WEEK: new Achv("groundhogWeek", "groundhogWeek.description", "sun_flute", 100),

  // --- §2.8 Full-run challenges (ChallengeAchv, validated at game-over) ----
  HELL_AND_BACK: new ChallengeAchv(
    "hellAndBack",
    "hellAndBack.description",
    "charcoal",
    100,
    () =>
      getErDifficulty() === "hell"
      && !anyFormatChallengeActive()
      && !challengeActive(Challenges.USAGE_TIER)
      && !anyMonoRosterChallengeActive()
      && !challengeActive(Challenges.HARDCORE),
  ),
  GLASS_CANNON: new ChallengeAchv(
    "glassCannon",
    "glassCannon.description",
    "prism_scale",
    100,
    () => isEliteOrHell() && isNuzlockeChallenge() && challengeActive(Challenges.FLIP_STAT),
  ),
  GENERATION_GAP: new ChallengeAchv(
    "generationGap",
    "generationGap.description",
    "ghost_memory",
    100,
    () =>
      isEliteOrHell() && challengeActive(Challenges.SINGLE_GENERATION) && challengeActive(Challenges.GHOST_TRAINERS),
  ),
  HOUSE_OF_MIRRORS: new ChallengeAchv(
    "houseOfMirrors",
    "houseOfMirrors.description",
    "mirror_herb",
    100,
    () => isEliteOrHell() && challengeActive(Challenges.MONO_COLOR) && challengeActive(Challenges.INVERSE_BATTLE),
  ),
  DEAD_CHANNEL: new ChallengeAchv(
    "deadChannel",
    "deadChannel.description",
    "douse_drive",
    100,
    () =>
      getErDifficulty() === "hell"
      && challengeActive(Challenges.MONO_COLOR)
      && isNuzlockeChallenge()
      && challengeActive(Challenges.GHOST_TRAINERS),
  ),
  WAR_OF_ATTRITION: new ChallengeAchv(
    "warOfAttrition",
    "warOfAttrition.description",
    "macho_brace",
    100,
    () => getErDifficulty() === "hell" && challengeActive(Challenges.FRESH_START) && isNuzlockeChallenge(),
  ),
  TRINITY_TEST: new ChallengeAchv(
    "trinityTest",
    "trinityTest.description",
    "hard_meteorite",
    120,
    () =>
      getErDifficulty() === "hell"
      && challengeActive(Challenges.SINGLE_GENERATION)
      && challengeActive(Challenges.TRIPLES_ONLY)
      && challengeActive(Challenges.GHOST_TRAINERS),
  ),
  OPPOSITION_RESEARCH: new ChallengeAchv(
    "oppositionResearch",
    "oppositionResearch.description",
    "zoom_lens",
    100,
    () =>
      isEliteOrHell()
      && challengeActive(Challenges.INVERSE_BATTLE)
      && challengeActive(Challenges.SINGLE_TYPE)
      && challengeActive(Challenges.GHOST_TRAINERS),
  ),
  // Mono-Gen on the ER "RDX" pseudo-generation (value 10 = ER customs, speciesId >= 10000).
  MONO_GEN_REDUX_VICTORY: new ChallengeAchv(
    "monoGenReduxVictory",
    "monoGenReduxVictory.description",
    "upgrade",
    75,
    c => c instanceof SingleGenerationChallenge && c.value === ER_RDX_CHALLENGE_GEN,
  ),
};

export function initAchievements() {
  const achvKeys = Object.keys(achvs) as (keyof typeof achvs)[];
  achvKeys.forEach((a: keyof typeof achvs, i: number) => {
    achvs[a].id = a;
    if (achvs[a].hasParent) {
      achvs[a].parentId = achvKeys[i - 1];
    }
  });
}
