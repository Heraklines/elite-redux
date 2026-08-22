import { globalScene } from "#app/global-scene";
import { erBalanceArr, erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import {
  getErEndlessEquivalentDepth,
  isErEndlessContinuationActive,
} from "#data/elite-redux/er-endless-continuation";
import { getFunModeConfig } from "#data/elite-redux/er-fun-mode";
import { getErDifficulty, type ErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { getErRunPacing, type ErRunPacing } from "#data/elite-redux/er-run-pacing";
import { getRunFavourCap, getRunShinyFavour } from "#data/elite-redux/er-shiny-favour";

export type ErRewardKind = "shiny" | "candy" | "voucher";
export type ErRewardTier = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

export interface ErRewardRateContext {
  difficulty: ErDifficulty;
  pacing: ErRunPacing;
  runWave: number;
  favourPoints: number;
  favourCap: 3 | 5;
  endlessActive: boolean;
  endlessEquivalentDepth: number;
  /** Resolve the deliberately lower Fun-mode economy instead of Classic. */
  funMode?: boolean;
}

export interface ErRewardRateBreakdown {
  difficulty: ErDifficulty;
  equivalentWave: number;
  tier: ErRewardTier;
  baseShiny: number;
  baseCandy: number;
  baseVoucher: number;
  favourMultiplier: number;
  endlessBonus: number;
  totalCap: number;
  totalShiny: number;
  totalCandy: number;
  totalVoucher: number;
}

type RewardDifficulty = "youngster" | "ace" | "elite" | "hell";

const SHINY_KEYS: Readonly<Record<RewardDifficulty, string>> = Object.freeze({
  youngster: "er.rewards.shinyYoungster",
  ace: "er.rewards.shinyAce",
  elite: "er.rewards.shinyElite",
  hell: "er.rewards.shinyHell",
});

const CANDY_KEYS: Readonly<Record<RewardDifficulty, string>> = Object.freeze({
  youngster: "er.rewards.candyYoungster",
  ace: "er.rewards.candyAce",
  elite: "er.rewards.candyElite",
  hell: "er.rewards.candyHell",
});

const VOUCHER_KEYS: Readonly<Record<ErRunPacing, Readonly<Record<RewardDifficulty, string>>>> = Object.freeze({
  normal: Object.freeze({
    youngster: "er.rewards.voucherNormalYoungster",
    ace: "er.rewards.voucherNormalAce",
    elite: "er.rewards.voucherNormalElite",
    hell: "er.rewards.voucherNormalHell",
  }),
  sprint: Object.freeze({
    youngster: "er.rewards.voucherSprintYoungster",
    ace: "er.rewards.voucherSprintAce",
    elite: "er.rewards.voucherSprintElite",
    hell: "er.rewards.voucherSprintHell",
  }),
});

function rewardDifficulty(difficulty: ErDifficulty): RewardDifficulty {
  return difficulty === "mystery" ? "hell" : difficulty;
}

/**
 * Fun Youngster's ten-tier curve is approximately 30% below the unmodified
 * Classic Youngster curve in aggregate. Keep integer rates because candy and
 * voucher balances are integer account currencies.
 */
const FUN_YOUNGSTER_SHINY = Object.freeze([1, 1, 1, 1, 1, 1, 1, 1, 1, 1]);
const FUN_YOUNGSTER_CANDY = Object.freeze([1, 1, 1, 2, 2, 2, 3, 4, 4, 6]);
const FUN_YOUNGSTER_VOUCHER = Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

function assertRateTable(key: string, values: readonly number[], youngsterVouchers = false): void {
  if (
    values.length !== 10
    || values.some((value, index) => !Number.isSafeInteger(value) || value < 0 || value > 50 || (index > 0 && value < values[index - 1]))
    || (youngsterVouchers && values.some(value => value !== 0))
  ) {
    throw new Error(`[er-reward-rates] invalid reward table: ${key}`);
  }
}

function rateTable(key: string, youngsterVouchers = false): readonly number[] {
  const values = erBalanceArr(key);
  assertRateTable(key, values, youngsterVouchers);
  return values;
}

for (const difficulty of Object.keys(SHINY_KEYS) as RewardDifficulty[]) {
  rateTable(SHINY_KEYS[difficulty]);
  rateTable(CANDY_KEYS[difficulty]);
  rateTable(VOUCHER_KEYS.normal[difficulty], difficulty === "youngster");
  rateTable(VOUCHER_KEYS.sprint[difficulty], difficulty === "youngster");
}

export function getErRewardTier(runWave: number, pacing: ErRunPacing): ErRewardTier {
  const equivalentWave = Math.min(200, Math.max(1, Math.floor(runWave)) * (pacing === "sprint" ? 2 : 1));
  const tierEquivalentWaves = erBalanceNum("er.rewards.tierEquivalentWaves");
  return (Math.min(9, Math.floor((equivalentWave - 1) / tierEquivalentWaves)) + 1) as ErRewardTier;
}

export function getErIntegerFavourMultiplier(favourPoints: number, cap: 3 | 5): number {
  return Math.min(cap, 1 + Math.floor((Math.max(0, Math.floor(favourPoints)) + 5) / 10));
}

export function resolveErRewardRates(context: ErRewardRateContext): ErRewardRateBreakdown {
  // Fun Hell deliberately pays the same base economy as unmodified Classic
  // Ace. Fun Youngster uses its own lower curve below.
  const difficulty = context.funMode && context.difficulty === "hell" ? "ace" : rewardDifficulty(context.difficulty);
  const equivalentWave = context.endlessActive
    ? 200
    : Math.min(200, Math.max(1, Math.floor(context.runWave)) * (context.pacing === "sprint" ? 2 : 1));
  const tier = context.endlessActive ? 10 : getErRewardTier(context.runWave, context.pacing);
  const tierIndex = tier - 1;
  const funYoungster = context.funMode === true && context.difficulty === "youngster";
  const baseShiny = funYoungster ? FUN_YOUNGSTER_SHINY[tierIndex] : rateTable(SHINY_KEYS[difficulty])[tierIndex];
  const baseCandy = funYoungster ? FUN_YOUNGSTER_CANDY[tierIndex] : rateTable(CANDY_KEYS[difficulty])[tierIndex];
  const baseVoucher = funYoungster
    ? FUN_YOUNGSTER_VOUCHER[tierIndex]
    : rateTable(VOUCHER_KEYS[context.pacing][difficulty], difficulty === "youngster")[tierIndex];
  const favourMultiplier = getErIntegerFavourMultiplier(context.favourPoints, context.favourCap);
  const endlessBonus = context.endlessActive
    ? Math.floor(
        Math.max(0, Math.floor(context.endlessEquivalentDepth))
          / erBalanceNum("er.rewards.endlessStepEquivalentWaves"),
      ) * erBalanceNum("er.rewards.endlessStepAmount")
    : 0;
  const totalCap = erBalanceNum("er.rewards.totalRateCap");

  return {
    difficulty: context.difficulty,
    equivalentWave,
    tier,
    baseShiny,
    baseCandy,
    baseVoucher,
    favourMultiplier,
    endlessBonus,
    totalCap,
    totalShiny: Math.min(totalCap, baseShiny * favourMultiplier + endlessBonus),
    totalCandy: Math.min(totalCap, baseCandy * favourMultiplier + endlessBonus),
    totalVoucher: Math.min(totalCap, baseVoucher + endlessBonus),
  };
}

export function getErRewardRatesAtWave(runWave: number): ErRewardRateBreakdown {
  const endlessActive = isErEndlessContinuationActive();
  const cap = Math.floor(getRunFavourCap()) >= 5 ? 5 : 3;
  const funMode = globalScene.gameMode?.isFun === true;
  return resolveErRewardRates({
    difficulty: funMode ? getFunModeConfig().difficulty : getErDifficulty(),
    pacing: getErRunPacing(),
    runWave,
    favourPoints: getRunShinyFavour(),
    favourCap: cap,
    endlessActive,
    endlessEquivalentDepth: endlessActive ? getErEndlessEquivalentDepth(runWave) : 0,
    funMode,
  });
}

export function getCurrentErRewardRates(): ErRewardRateBreakdown {
  return getErRewardRatesAtWave(globalScene.currentBattle?.waveIndex ?? 1);
}
