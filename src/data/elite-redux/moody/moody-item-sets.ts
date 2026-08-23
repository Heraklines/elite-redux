import type { MoodyRuntimeValue } from "#data/elite-redux/moody/moody-runtime-meta";

export type MoodyItemSetId = "complete-nutrition" | "restoration-kit" | "tacticians-tools" | "volatile-core";

export interface MoodyActiveItemSet {
  readonly [key: string]: MoodyRuntimeValue;
  readonly setId: MoodyItemSetId;
  readonly pieceCount: number;
  readonly tier: 3 | 5;
  readonly statMultiplier: number;
  readonly healingMultiplier: number;
  readonly firstHealBarrierFraction: number;
  readonly accuracyMultiplier: number;
  readonly firstMovePriorityDelta: number;
  readonly firstMovePowerMultiplier: number;
  readonly damageMultiplier: number;
  readonly selfStatusDamageMultiplier: number;
}

export const MOODY_ITEM_SET_PIECES: Readonly<Record<MoodyItemSetId, readonly string[]>> = {
  "complete-nutrition": [
    "BASE_STAT_BOOSTER:hp_up",
    "BASE_STAT_BOOSTER:protein",
    "BASE_STAT_BOOSTER:iron",
    "BASE_STAT_BOOSTER:calcium",
    "BASE_STAT_BOOSTER:zinc",
    "BASE_STAT_BOOSTER:carbos",
  ],
  "restoration-kit": ["LEFTOVERS", "SHELL_BELL", "HEALING_CHARM", "BERRY_POUCH", "REVIVER_SEED"],
  "tacticians-tools": ["QUICK_CLAW", "KINGS_ROCK", "WIDE_LENS", "GRIP_CLAW", "BATON"],
  "volatile-core": ["TOXIC_ORB", "FLAME_ORB", "FROSTBITE_ORB", "FOCUS_BAND", "WHITE_HERB"],
};

function blank(setId: MoodyItemSetId, pieceCount: number, tier: 3 | 5): MoodyActiveItemSet {
  return {
    setId,
    pieceCount,
    tier,
    statMultiplier: 1,
    healingMultiplier: 1,
    firstHealBarrierFraction: 0,
    accuracyMultiplier: 1,
    firstMovePriorityDelta: 0,
    firstMovePowerMultiplier: 1,
    damageMultiplier: 1,
    selfStatusDamageMultiplier: 1,
  };
}

function bonuses(setId: MoodyItemSetId, pieceCount: number, tier: 3 | 5, complete: boolean): MoodyActiveItemSet {
  const active = blank(setId, pieceCount, tier);
  switch (setId) {
    case "complete-nutrition":
      return { ...active, statMultiplier: complete && tier === 5 ? 1.15 : tier === 5 ? 1.1 : 1.05 };
    case "restoration-kit":
      return {
        ...active,
        healingMultiplier: complete && tier === 5 ? 1.35 : tier === 5 ? 1.25 : 1.15,
        firstHealBarrierFraction: tier === 5 ? (complete ? 0.15 : 0.1) : 0,
      };
    case "tacticians-tools":
      return {
        ...active,
        accuracyMultiplier: complete && tier === 5 ? 1.15 : 1.1,
        firstMovePriorityDelta: tier === 5 ? 1 : 0,
        firstMovePowerMultiplier: tier === 5 ? (complete ? 1.25 : 1.1) : 1,
      };
    case "volatile-core":
      return {
        ...active,
        damageMultiplier: complete && tier === 5 ? 1.25 : tier === 5 ? 1.15 : 1.08,
        selfStatusDamageMultiplier: tier === 5 ? (complete ? 0.25 : 0.5) : 1,
      };
  }
}

export function resolveMoodyActiveItemSets(
  ownedDistinctItemIds: readonly string[],
  stage: string,
  chosenSetId: string | null,
): readonly MoodyActiveItemSet[] {
  const owned = new Set(ownedDistinctItemIds);
  const selected = Object.entries(MOODY_ITEM_SET_PIECES)
    .map(([setId, pieces]) => ({
      setId: setId as MoodyItemSetId,
      pieceCount: pieces.filter(piece => owned.has(piece)).length,
    }))
    .toSorted((left, right) => {
      const leftChosen = Number(left.setId === chosenSetId);
      const rightChosen = Number(right.setId === chosenSetId);
      return rightChosen - leftChosen || right.pieceCount - left.pieceCount || left.setId.localeCompare(right.setId);
    });
  const rankTwo = stage !== "base";
  const slots = stage === "curator" ? 2 : 1;
  return selected
    .filter(entry => entry.pieceCount >= (rankTwo && entry.setId === chosenSetId ? 2 : 3))
    .slice(0, slots)
    .map(entry => {
      const fivePieceThreshold = rankTwo && entry.setId === chosenSetId ? 4 : 5;
      const tier = entry.pieceCount >= fivePieceThreshold ? 5 : 3;
      return bonuses(
        entry.setId,
        entry.pieceCount,
        tier,
        stage === "complete-collection" && entry.setId === chosenSetId,
      );
    });
}

function isRecord(value: MoodyRuntimeValue | undefined): value is Readonly<Record<string, MoodyRuntimeValue>> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function decodeMoodyActiveItemSets(value: MoodyRuntimeValue | undefined): readonly MoodyActiveItemSet[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap(raw => {
    if (!isRecord(raw) || typeof raw.setId !== "string" || !(raw.setId in MOODY_ITEM_SET_PIECES)) {
      return [];
    }
    const tier = raw.tier === 5 ? 5 : raw.tier === 3 ? 3 : null;
    if (tier == null) {
      return [];
    }
    return [
      {
        setId: raw.setId as MoodyItemSetId,
        pieceCount: Number(raw.pieceCount) || tier,
        tier,
        statMultiplier: Number(raw.statMultiplier) || 1,
        healingMultiplier: Number(raw.healingMultiplier) || 1,
        firstHealBarrierFraction: Number(raw.firstHealBarrierFraction) || 0,
        accuracyMultiplier: Number(raw.accuracyMultiplier) || 1,
        firstMovePriorityDelta: Number(raw.firstMovePriorityDelta) || 0,
        firstMovePowerMultiplier: Number(raw.firstMovePowerMultiplier) || 1,
        damageMultiplier: Number(raw.damageMultiplier) || 1,
        selfStatusDamageMultiplier: Number(raw.selfStatusDamageMultiplier) || 1,
      },
    ];
  });
}
