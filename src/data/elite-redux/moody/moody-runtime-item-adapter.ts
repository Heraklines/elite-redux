import { globalScene } from "#app/global-scene";
import { runMoodyCoordinatorLive } from "#data/elite-redux/moody/moody-runtime-live-adapter";
import { getMoodyModeState } from "#data/elite-redux/moody/moody-state";
import { Stat } from "#enums/stat";
import type { PersistentModifier } from "#modifiers/modifier";

const VITAMIN_VARIANT_BY_STAT: Readonly<Partial<Record<Stat, string>>> = {
  [Stat.HP]: "hp_up",
  [Stat.ATK]: "protein",
  [Stat.DEF]: "iron",
  [Stat.SPATK]: "calcium",
  [Stat.SPDEF]: "zinc",
  [Stat.SPD]: "carbos",
};

export function canonicalMoodySetPieceId(modifier: PersistentModifier): string | null {
  const typeId = modifier.type?.id;
  if (typeof typeId !== "string" || typeId.length === 0) {
    return null;
  }
  if (typeId !== "BASE_STAT_BOOSTER") {
    return typeId;
  }
  const type = modifier.type as { getPregenArgs?: () => unknown[] };
  const stat = type.getPregenArgs?.()[0];
  const variant = typeof stat === "number" ? VITAMIN_VARIANT_BY_STAT[stat as Stat] : undefined;
  return variant == null ? null : `${typeId}:${variant}`;
}

export function notifyMoodyCoordinatorItemInventory(modifiers: readonly PersistentModifier[]): void {
  const state = getMoodyModeState();
  const collector = state?.boons.find(boon => boon.boonId === "set-collector" && !boon.dormant);
  if (state == null || collector == null) {
    return;
  }
  const ownedDistinctItemIds = [
    ...new Set(modifiers.map(canonicalMoodySetPieceId).filter((pieceId): pieceId is string => pieceId != null)),
  ];
  runMoodyCoordinatorLive(
    {
      type: "item-set-query",
      seed: state.seed ^ ownedDistinctItemIds.length,
      ownedDistinctItemIds,
      chosenSetId: collector.target?.option ?? null,
    },
    {
      addMoney: () => undefined,
      party: [],
      enemies: [],
      reward: {
        options: [],
        boonOffers: [],
        contractIds: [],
        grantedContractRewards: [],
        replacementDisabled: false,
        replacementCost: 0,
        replacementSacrifices: 0,
      },
      market: {
        price: 0,
        itemEffectValue: 1,
        automaticBiomeHealing: true,
        paidWithBloodDebt: false,
        enhancedPurchase: false,
      },
      capture: {
        guaranteedTraits: [],
        catchRateMultiplier: 1,
        addGuaranteedTrait: () => undefined,
        multiplyCatchRate: () => undefined,
      },
      progression: {
        notifications: [],
        pendingChoices: [],
        selectedImprints: [],
        apexSegmentsByPokemon: {},
        cursedStack: null,
        trainerRosterSize: null,
        counterWeight: 0,
        counterTargetPokemonId: null,
        futureEnemyStatMultiplier: 1,
        activeItemSets: [],
      },
      mutationReceipts: [],
    },
  );
  for (const pokemon of globalScene.getPlayerParty()) {
    pokemon.calculateStats();
    pokemon.updateInfo(true).catch(() => undefined);
  }
}
