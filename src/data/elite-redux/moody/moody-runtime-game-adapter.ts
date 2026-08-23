import { globalScene } from "#app/global-scene";
import { speciesEggMoves } from "#balance/moves/egg-moves";
import { allAbilities, allMoves } from "#data/data-lists";
import { settleCoopPartyReorderPresentationReady } from "#data/elite-redux/coop/coop-party-reorder-presentation";
import { ER_RELIC_KINDS } from "#data/elite-redux/er-relics";
import {
  getMoodyCoordinatorEffectState,
  grantMoodyCoordinatorBarrier,
  queueMoodyCoordinatorMovePower,
  recordMoodyCoordinatorMortalWound,
  resetMoodyCoordinatorEffectCounter,
  updateMoodyCoordinatorEffectValues,
} from "#data/elite-redux/moody/moody-coordinator-combat-state";
import {
  type MoodyGameplayCommand,
  type MoodyGameplayEvent,
  runMoodyGameplayEvent,
} from "#data/elite-redux/moody/moody-coordinator-gameplay";
import {
  hydrateMoodyCoordinatorState,
  type MoodyCoordinatorEvent,
} from "#data/elite-redux/moody/moody-runtime-coordinator";
import { recordMoodyRuntimeActionTriggers } from "#data/elite-redux/moody/moody-runtime-field-engine";
import {
  consumeCurrentMoodyLivePendingChoice,
  consumeCurrentMoodyLiveProjection,
  createMoodyLiveExecutionTarget,
  getCurrentMoodyLiveProjection,
  type MoodyLiveCapturePort,
  type MoodyLiveExecutionResult,
  type MoodyLivePokemonPort,
  type MoodyLiveRewardOptionPort,
  resetMoodyCoordinatorLiveCadence,
  runMoodyCoordinatorLive,
} from "#data/elite-redux/moody/moody-runtime-live-adapter";
import type { MoodyRuntimeValue } from "#data/elite-redux/moody/moody-runtime-meta";
import {
  concealPendingMoodyBoonOffer,
  getMoodyBoonOffers,
  getMoodyModeSaveData,
  getMoodyModeState,
  MOODY_BOON_BY_ID,
} from "#data/elite-redux/moody/moody-state";
import { PokemonSummonData } from "#data/pokemon/pokemon-data";
import { Status } from "#data/status-effect";
import { BattleType } from "#enums/battle-type";
import { Command } from "#enums/command";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { ModifierTier } from "#enums/modifier-tier";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { Nature } from "#enums/nature";
import type { PokemonType } from "#enums/pokemon-type";
import { BATTLE_STATS } from "#enums/stat";
import type { StatusEffect } from "#enums/status-effect";
import type { EnemyPokemon, Pokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import { erRelicModifierType, getNewModifierTypeOption, ModifierTypeOption } from "#modifiers/modifier-type";
import { PokemonMove } from "#moves/pokemon-move";
import {
  MoodyCoordinatorChoicePhase,
  MoodyCoordinatorConfirmPhase,
  MoodyCoordinatorOperationPhase,
  MoodyCoordinatorPokemonChoicePhase,
  type MoodyHunterChoice,
} from "#phases/moody-coordinator-choice-phase";
import { MoodyCoordinatorEchoPhase } from "#phases/moody-coordinator-echo-phase";
import { getPokemonSpecies } from "#utils/pokemon-utils";

const MAX_REWARD_TIER = ModifierTier.MASTER;
const HEALING_MARKET_ITEM_IDS = new Set([
  "POTION",
  "SUPER_POTION",
  "HYPER_POTION",
  "MAX_POTION",
  "FULL_RESTORE",
  "REVIVE",
  "MAX_REVIVE",
  "SACRED_ASH",
  "FULL_HEAL",
]);
const NATURE_COUNT = Object.values(Nature).filter(value => typeof value === "number").length;
const declinedTimeLoopPokemonIds = new Set<number>();
const USAGE_TRACKED_EFFECT_IDS = ["blood-market", "cursed-inventory"] as const;
const LEGACY_PROGRESS_BOON_IDS = new Set(["chosen-one", "mithridatism", "hunter-s-mark", "bossbreaker"]);

const MOODY_BOUNTY_LABELS: Readonly<Record<string, string>> = {
  "no-allied-faint": "No allied Pokemon may faint",
  "no-consecutive-repeat": "Do not repeat a move consecutively",
  "five-elemental-types": "Use at least five elemental move types",
  "every-member-acts": "Every conscious party member must act",
  "lowest-level-ko": "The lowest-level Pokemon must score a KO",
  "three-switches": "Switch at least three times",
  "one-ko-each": "No Pokemon may score more than one KO",
  "boss-turn-limit": "Defeat the next boss within ten turns",
};

const MOODY_BOUNTY_DIFFICULTY: Readonly<Record<string, string>> = {
  "no-allied-faint": "MEDIUM",
  "no-consecutive-repeat": "MEDIUM",
  "five-elemental-types": "HARD",
  "every-member-acts": "HARD",
  "lowest-level-ko": "HARD",
  "three-switches": "MEDIUM",
  "one-ko-each": "HARD",
  "boss-turn-limit": "HARD",
};

const MOODY_BOUNTY_FAILURE: Readonly<Record<string, string>> = {
  "no-allied-faint": "Failure: any allied Pokemon faints.",
  "no-consecutive-repeat": "Failure: a Pokemon repeats its previous move.",
  "five-elemental-types": "Failure: fewer than five move types before the boss falls.",
  "every-member-acts": "Failure: a conscious party member never acts.",
  "lowest-level-ko": "Failure: the lowest-level party member scores no KO.",
  "three-switches": "Failure: fewer than three switches are made.",
  "one-ko-each": "Failure: one Pokemon scores a second KO.",
  "boss-turn-limit": "Failure: the boss survives past turn 10.",
};

const MOODY_BOUNTY_MASTER_CONDITION: Readonly<Record<string, string>> = {
  "no-allied-faint": "Master: complete the segment without healing.",
  "no-consecutive-repeat": "Master: also use at least eight move types.",
  "five-elemental-types": "Master: use at least eight move types.",
  "every-member-acts": "Master: every conscious party member must act twice.",
  "lowest-level-ko": "Master: the lowest-level party member must score two KOs.",
  "three-switches": "Master: make at least six switches.",
  "one-ko-each": "Master: complete the segment without an allied faint.",
  "boss-turn-limit": "Master: defeat the boss by turn 6.",
};

interface MoodyBountyState {
  readonly contractId: string;
  readonly startWave: number;
  readonly failed: boolean;
  readonly actedPokemonIds: readonly string[];
  readonly actionCountByPokemon: Readonly<Record<string, number>>;
  readonly moveTypesUsed: readonly number[];
  readonly koByPokemon: Readonly<Record<string, number>>;
  readonly switchCount: number;
  readonly lastMoveByPokemon: Readonly<Record<string, string>>;
  readonly lowestLevelPokemonId: string;
  readonly healingUsed: boolean;
  readonly alliedFaintOccurred: boolean;
}

const MASTER_CONTRACT_PREFIX = "master:";

function baseMoodyBountyContractId(contractId: string): string {
  return contractId.startsWith(MASTER_CONTRACT_PREFIX) ? contractId.slice(MASTER_CONTRACT_PREFIX.length) : contractId;
}

function runtimeRecord(value: MoodyRuntimeValue | undefined): Readonly<Record<string, MoodyRuntimeValue>> | null {
  if (value == null || Array.isArray(value) || typeof value !== "object") {
    return null;
  }
  return value as Readonly<Record<string, MoodyRuntimeValue>>;
}

function readMoodyBountyState(): MoodyBountyState | null {
  const raw = runtimeRecord(getMoodyCoordinatorEffectState("bounty-board")?.values?.activeContract);
  if (raw == null || typeof raw.contractId !== "string") {
    return null;
  }
  return raw as unknown as MoodyBountyState;
}

function updateMoodyBounty(update: (current: MoodyBountyState) => MoodyBountyState): void {
  updateMoodyCoordinatorEffectValues("bounty-board", values => {
    const current = readMoodyBountyState();
    return current == null ? values : { ...values, activeContract: update(current) as unknown as MoodyRuntimeValue };
  });
}

function feasibleMoodyBountyContracts(): readonly string[] {
  const party = globalScene.getPlayerParty().filter(pokemon => !pokemon.isFainted(true));
  const moveTypes = new Set(party.flatMap(pokemon => pokemon.getMoveset().map(move => move.getMove().type)));
  const contracts = ["no-allied-faint", "no-consecutive-repeat", "one-ko-each", "boss-turn-limit"];
  if (moveTypes.size >= 5) {
    contracts.push("five-elemental-types");
  }
  if (party.length > 1) {
    contracts.push("every-member-acts", "lowest-level-ko", "three-switches");
  }
  return contracts;
}

function queueMoodyBountyDraft(nextWave: number): void {
  const state = getMoodyModeState();
  if (state == null || activeBoon("bounty-board") == null) {
    return;
  }
  const result = runMoodySceneCoordinatorEvent({
    type: "contract-draft",
    seed: state.seed ^ nextWave,
    feasibleContractIds: feasibleMoodyBountyContracts(),
  });
  const offered = result?.target.reward.contractIds ?? [];
  if (offered.length === 0) {
    return;
  }
  const select = (contractId: string): void => {
    const baseContractId = baseMoodyBountyContractId(contractId);
    const party = globalScene.getPlayerParty().filter(pokemon => !pokemon.isFainted(true));
    const lowest = party.toSorted((left, right) => left.level - right.level || left.id - right.id)[0];
    updateMoodyCoordinatorEffectValues("bounty-board", values => ({
      ...values,
      activeContract: {
        contractId: baseContractId,
        startWave: nextWave,
        failed: false,
        actedPokemonIds: [],
        actionCountByPokemon: {},
        moveTypesUsed: [],
        koByPokemon: {},
        switchCount: 0,
        lastMoveByPokemon: {},
        lowestLevelPokemonId: String(lowest?.id ?? ""),
        healingUsed: false,
        alliedFaintOccurred: false,
      },
    }));
    consumeCurrentMoodyLiveProjection("contractIds");
  };
  const party = globalScene.getPlayerParty().filter(pokemon => !pokemon.isFainted(true));
  const qualifyingTypes = new Set(party.flatMap(pokemon => pokemon.getMoveset().map(move => move.getMove().type))).size;
  globalScene.phaseManager.unshiftPhase(
    new MoodyCoordinatorOperationPhase(
      {
        kind: "bounty",
        title: "BOUNTY BOARD",
        prompt: "Accept one feasible objective for the next ten waves.",
        confirmLabel: "accept contract",
        cancellable: true,
        minSelections: 1,
        maxSelections: 1,
        trackerLabel: "NEXT 10 WAVES",
        options: offered.map(id => {
          const baseId = baseMoodyBountyContractId(id);
          const master = id !== baseId;
          return {
            id,
            label: MOODY_BOUNTY_LABELS[baseId] ?? baseId,
            badge: master ? "MASTER" : (MOODY_BOUNTY_DIFFICULTY[baseId] ?? "MEDIUM"),
            description: MOODY_BOUNTY_LABELS[baseId] ?? baseId,
            consequenceLines: [
              MOODY_BOUNTY_FAILURE[baseId] ?? "Failure: the objective is not completed.",
              master
                ? (MOODY_BOUNTY_MASTER_CONDITION[baseId] ?? "Master: complete the stricter objective.")
                : "Reward: upgraded item reward with a relic chance.",
              baseId === "five-elemental-types"
                ? `Feasible: current team has ${qualifyingTypes} qualifying move types.`
                : `Feasible: current conscious party has ${party.length} members.`,
            ],
          };
        }),
      },
      selection => {
        const contractId = selection.action === "confirm" ? selection.selectedIds[0] : undefined;
        if (contractId != null && offered.includes(contractId)) {
          select(contractId);
        } else {
          updateMoodyCoordinatorEffectValues("bounty-board", values => ({
            ...values,
            activeContract: null,
          }));
          resetMoodyCoordinatorEffectCounter("bounty-board", "contractChain");
          consumeCurrentMoodyLiveProjection("contractIds");
        }
      },
    ),
  );
}

function settleMoodyBounty(victory: boolean): void {
  const contract = readMoodyBountyState();
  const battle = globalScene.currentBattle;
  if (contract == null || battle == null || battle.waveIndex < contract.startWave || battle.waveIndex % 10 !== 0) {
    return;
  }
  const consciousIds = globalScene
    .getPlayerParty()
    .filter(pokemon => !pokemon.isFainted(true))
    .map(pokemon => String(pokemon.id));
  const masterContract = activeBoon("bounty-board")?.evolutionId === "master-contract";
  const baseCompleted =
    victory
    && !contract.failed
    && (contract.contractId === "no-allied-faint"
      || contract.contractId === "no-consecutive-repeat"
      || (contract.contractId === "five-elemental-types" && contract.moveTypesUsed.length >= 5)
      || (contract.contractId === "every-member-acts"
        && consciousIds.every(id => contract.actedPokemonIds.includes(id)))
      || (contract.contractId === "lowest-level-ko" && (contract.koByPokemon[contract.lowestLevelPokemonId] ?? 0) > 0)
      || (contract.contractId === "three-switches" && contract.switchCount >= 3)
      || contract.contractId === "one-ko-each"
      || (contract.contractId === "boss-turn-limit" && battle.turn <= 10));
  const masterCompleted =
    !masterContract
    || (contract.contractId === "five-elemental-types"
      ? contract.moveTypesUsed.length >= 8
      : contract.contractId === "lowest-level-ko"
        ? (contract.koByPokemon[contract.lowestLevelPokemonId] ?? 0) >= 2
        : contract.contractId === "three-switches"
          ? contract.switchCount >= 6
          : contract.contractId === "boss-turn-limit"
            ? battle.turn <= 6
            : contract.contractId === "no-consecutive-repeat"
              ? contract.moveTypesUsed.length >= 8
              : contract.contractId === "every-member-acts"
                ? consciousIds.every(id => (contract.actionCountByPokemon?.[id] ?? 0) >= 2)
                : contract.contractId === "no-allied-faint"
                  ? !contract.healingUsed
                  : contract.contractId === "one-ko-each"
                    ? !contract.alliedFaintOccurred
                    : !contract.failed && battle.turn <= 8);
  const completed = baseCompleted && masterCompleted;
  if (completed) {
    runMoodySceneCoordinatorEvent({
      type: "contract-completed",
      seed: getMoodyModeState()!.seed ^ battle.waveIndex,
      contractId: contract.contractId,
    });
  }
  updateMoodyCoordinatorEffectValues("bounty-board", values => {
    const { activeContract: _activeContract, ...remaining } = values;
    return {
      ...remaining,
      lastContractCompleted: completed,
      lastContractId: contract.contractId,
    };
  });
  if (!completed) {
    resetMoodyCoordinatorEffectCounter("bounty-board", "contractChain");
  }
}

export interface MoodyRecruiterCollectionData {
  readonly abilityAttr: number;
  readonly eggMoveAttr: number;
  readonly natureAttr: number;
}

export interface MoodyRecruiterSpeciesData {
  readonly abilityIds: readonly number[];
  readonly eggMoveIds: readonly number[];
  readonly natureCount: number;
}

export interface MoodyRecruiterTraitPlan {
  readonly missingTraits: readonly string[];
  readonly traitRarity: Readonly<Record<string, number>>;
}

export interface MoodyRecruiterEncounterResult {
  readonly encounterId: string;
  readonly guaranteedTraits: readonly string[];
  readonly catchRateMultiplier: number;
}

function deterministicIndex(seed: number, length: number): number {
  return length === 0 ? 0 : ((Math.trunc(seed) % length) + length) % length;
}

export function buildMoodyRecruiterTraitPlan(
  collection: MoodyRecruiterCollectionData,
  species: MoodyRecruiterSpeciesData,
  seed: number,
): MoodyRecruiterTraitPlan {
  const missingTraits: string[] = [];
  const traitRarity: Record<string, number> = {};
  const uniqueAbilities = species.abilityIds
    .map((abilityId, abilityIndex) => ({ abilityId, abilityIndex }))
    .filter(({ abilityId, abilityIndex }, index, values) => {
      return abilityId > 0 && values.findIndex(value => value.abilityId === abilityId) === index && abilityIndex < 3;
    });
  const missingAbilities = uniqueAbilities.filter(({ abilityIndex }) => {
    return (collection.abilityAttr & (1 << abilityIndex)) === 0;
  });
  if (missingAbilities.length > 0) {
    const selected = missingAbilities[deterministicIndex(seed, missingAbilities.length)];
    const trait = `ability:${selected.abilityIndex}`;
    missingTraits.push(trait);
    traitRarity[trait] = selected.abilityIndex === 2 ? 0.01 : 0.05;
  }
  species.eggMoveIds.forEach((moveId, eggMoveIndex) => {
    if (moveId <= 0 || (collection.eggMoveAttr & (1 << eggMoveIndex)) !== 0) {
      return;
    }
    const trait = `egg-move:${eggMoveIndex}:${moveId}`;
    missingTraits.push(trait);
    traitRarity[trait] = eggMoveIndex === 3 ? 0.005 : 0.02;
  });
  const missingNatures = Array.from({ length: species.natureCount }, (_, nature) => nature).filter(
    nature => (collection.natureAttr & (1 << (nature + 1))) === 0,
  );
  if (missingNatures.length > 0) {
    const nature = missingNatures[deterministicIndex(seed ^ 0x4f1bbcdc, missingNatures.length)];
    const trait = `nature:${nature}`;
    missingTraits.push(trait);
    traitRarity[trait] = 0.04;
  }
  return { missingTraits, traitRarity };
}

export function isMoodyHealingMarketItem(typeId: string): boolean {
  return HEALING_MARKET_ITEM_IDS.has(typeId);
}

function toPokemonPort(pokemon: Pokemon): MoodyLivePokemonPort {
  const segmented = pokemon as Pokemon & { bossSegments: number };
  return {
    id: String(pokemon.id),
    addMaxHpFraction: fraction => {
      if (fraction <= 0) {
        return;
      }
      const before = pokemon.getMaxHp();
      pokemon.calculateStats();
      pokemon.hp = Math.min(pokemon.getMaxHp(), pokemon.hp + Math.max(1, Math.floor(before * fraction)));
      pokemon.updateInfo(true).catch(() => undefined);
    },
    applyHpDebt: amount => {
      pokemon.hp = Math.min(pokemon.hp, Math.max(1, pokemon.getMaxHp() - Math.max(0, Math.floor(amount))));
      pokemon.updateInfo(true).catch(() => undefined);
    },
    revive: (hpFraction, extraHealthSegments, allStatStages) => {
      pokemon.hp = Math.max(1, Math.floor(pokemon.getMaxHp() * hpFraction));
      if (extraHealthSegments > 0 && pokemon.isEnemy()) {
        pokemon.setBoss(true, Math.max(2, segmented.bossSegments + extraHealthSegments));
      }
      for (const stat of BATTLE_STATS) {
        pokemon.setStatStage(stat, Math.max(pokemon.getStatStage(stat), allStatStages));
      }
      pokemon.updateInfo(true).catch(() => undefined);
    },
    clearNegativeStages: () => {
      for (const stat of BATTLE_STATS) {
        pokemon.setStatStage(stat, Math.max(0, pokemon.getStatStage(stat)));
      }
    },
    clearMajorStatus: () => {
      pokemon.resetStatus(false, false, false, true);
      pokemon.updateInfo(true).catch(() => undefined);
    },
    replaceMove: (originalMoveId, replacementMoveId) => {
      const move = pokemon.getMoveset().find(candidate => String(candidate.moveId) === originalMoveId);
      if (move != null) {
        move.moveId = Number(replacementMoveId);
      }
    },
  };
}

export function toMoodyRewardOptionPort(option: ModifierTypeOption): MoodyLiveRewardOptionPort {
  return {
    id: option.type.id,
    getTier: () => option.type.tier,
    setTier: tier => {
      const bounded = Math.max(ModifierTier.COMMON, Math.min(MAX_REWARD_TIER, Math.floor(tier)));
      const previousTier = option.type.tier;
      option.type.setTier(bounded);
      option.upgradeCount = Math.max(0, option.upgradeCount + bounded - previousTier);
    },
    getQuantity: () => 1,
    setQuantity: quantity => {
      option.upgradeCount += Math.max(0, Math.floor(quantity) - 1);
    },
    reroll: (minimumTier, excludedCategory, options) => {
      const floor = Math.max(ModifierTier.COMMON, Math.min(MAX_REWARD_TIER, Math.floor(minimumTier)));
      for (let attempt = 0; attempt < 12; attempt++) {
        const weighted = getNewModifierTypeOption(globalScene.getPlayerParty(), ModifierPoolType.PLAYER);
        const weightUplift = options?.improvedBaseWeights === true ? 1 : 0;
        const tier = Math.max(floor, Math.min(MAX_REWARD_TIER, (weighted?.type.tier ?? floor) + weightUplift));
        const replacement = getNewModifierTypeOption(
          globalScene.getPlayerParty(),
          ModifierPoolType.PLAYER,
          tier,
          0,
          0,
          true,
        );
        if (replacement != null && (excludedCategory == null || replacement.type.id !== excludedCategory)) {
          option.type = replacement.type;
          option.upgradeCount = replacement.upgradeCount;
          break;
        }
      }
    },
  };
}

function sceneTarget(rewardOptions: ModifierTypeOption[] = [], marketPrice = 0, capture?: MoodyLiveCapturePort) {
  return createMoodyLiveExecutionTarget(
    {
      addMoney: amount => globalScene.addMoney(amount),
      party: globalScene.getPlayerParty().map(toPokemonPort),
      enemies: globalScene.getEnemyParty().map(toPokemonPort),
      reward: {
        options: rewardOptions.map(toMoodyRewardOptionPort),
        boonOffers: [],
        contractIds: [],
        grantedContractRewards: [],
        replacementDisabled: false,
        replacementCost: 0,
        replacementSacrifices: 0,
      },
      market: {
        price: marketPrice,
        itemEffectValue: 1,
        automaticBiomeHealing: true,
        paidWithBloodDebt: false,
        enhancedPurchase: false,
      },
      ...(capture == null ? {} : { capture }),
    },
    getMoodyModeSaveData(),
  );
}

export function runMoodySceneCoordinatorEvent(
  event: MoodyCoordinatorEvent,
  rewardOptions: ModifierTypeOption[] = [],
  marketPrice = 0,
  capture?: MoodyLiveCapturePort,
): MoodyLiveExecutionResult | null {
  const result = runMoodyCoordinatorLive(event, sceneTarget(rewardOptions, marketPrice, capture));
  const pokemonId = "pokemonId" in event ? Number(event.pokemonId) : null;
  if (result != null && pokemonId != null && Number.isSafeInteger(pokemonId)) {
    recordMoodyRuntimeActionTriggers(pokemonId, [...new Set(result.commands.map(command => command.effectId))]);
  }
  return result;
}

function commandNumber(command: MoodyGameplayCommand, key: string, fallback = 0): number {
  const value = command.data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function runGameplay(event: MoodyGameplayEvent): readonly MoodyGameplayCommand[] {
  return runMoodyGameplayEvent(event)?.commands ?? [];
}

function activeBoon(boonId: string) {
  return getMoodyModeState()?.boons.find(boon => boon.boonId === boonId && !boon.dormant);
}

function numericRecord(value: MoodyRuntimeValue | undefined): Record<string, number> {
  if (value == null || Array.isArray(value) || typeof value !== "object") {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, number] => typeof entry[1] === "number"),
  );
}

function recordMoodyBiomePokemonUsage(pokemonId: number): void {
  for (const effectId of USAGE_TRACKED_EFFECT_IDS) {
    updateMoodyCoordinatorEffectValues(effectId, values => {
      const usage = numericRecord(values.usageByPokemon);
      usage[String(pokemonId)] = (usage[String(pokemonId)] ?? 0) + 1;
      return { ...values, usageByPokemon: usage };
    });
  }
}

function moodyUsageRanking(party: readonly Pokemon[], previousBiome = false): string[] {
  const state = getMoodyModeState();
  const source = USAGE_TRACKED_EFFECT_IDS.map(effectId => getMoodyCoordinatorEffectState(effectId)?.values).find(
    values => values != null,
  );
  if (previousBiome && Array.isArray(source?.previousUsageRanking)) {
    const known = new Set(party.map(pokemon => String(pokemon.id)));
    const saved = source.previousUsageRanking.map(String).filter(pokemonId => known.has(pokemonId));
    return [...saved, ...party.map(pokemon => String(pokemon.id)).filter(pokemonId => !saved.includes(pokemonId))];
  }
  const usage = numericRecord(source?.usageByPokemon);
  const hasRecordedUsage = Object.values(usage).some(count => count > 0);
  const threatByPokemon = new Map(
    (state?.recentThreat ?? []).map(threat => [
      String(threat.pokemonId),
      threat.damageDealt + threat.knockouts * 100 + threat.fieldTurns,
    ]),
  );
  return party
    .map((pokemon, partySlot) => ({
      pokemonId: String(pokemon.id),
      partySlot,
      count: hasRecordedUsage ? (usage[String(pokemon.id)] ?? 0) : (threatByPokemon.get(String(pokemon.id)) ?? 0),
    }))
    .toSorted((left, right) => right.count - left.count || left.partySlot - right.partySlot)
    .map(entry => entry.pokemonId);
}

export function notifyMoodyCoordinatorPokemonPermanentlyRemoved(pokemonId: number): void {
  const state = getMoodyModeState();
  const legacy = activeBoon("legacy-slot");
  if (state == null || legacy == null) {
    return;
  }
  const partySlot = globalScene.getPlayerParty().findIndex(pokemon => pokemon.id === pokemonId);
  const boundPartySlot = legacy.target?.partySlots?.[0];
  if (partySlot < 0 || boundPartySlot == null || partySlot !== boundPartySlot) {
    return;
  }
  const eligible = state.boons.filter(boon => {
    if (
      boon.instanceId === legacy.instanceId
      || !LEGACY_PROGRESS_BOON_IDS.has(boon.boonId)
      || !boon.target?.pokemonIds?.includes(pokemonId)
    ) {
      return false;
    }
    return Object.values(boon.progress?.counters ?? {}).some(value => value > 0);
  });
  if (eligible.length === 0) {
    return;
  }
  const result = runMoodySceneCoordinatorEvent({
    type: "pokemon-permanently-removed",
    seed: state.seed ^ pokemonId,
    eligibleImprints: eligible.map(boon => boon.instanceId),
    partySlot,
    boundPartySlot,
  });
  const capacity = legacy.evolutionId === "dynasty" ? 2 : 1;
  const transferFraction = legacy.evolutionId === "perfect-succession" ? 1 : legacy.rank >= 2 ? 0.75 : 0.5;
  if (result != null) {
    globalScene.phaseManager.unshiftPhase(
      new MoodyCoordinatorOperationPhase(
        {
          kind: "legacy",
          title: "LEGACY SLOT",
          prompt: `Choose ${capacity === 1 ? "one imprint" : `up to ${capacity} imprints`} to preserve.`,
          confirmLabel: "store imprint",
          cancellable: false,
          minSelections: 1,
          maxSelections: Math.min(capacity, eligible.length),
          options: eligible.map(boon => ({
            id: boon.instanceId,
            label: MOODY_BOON_BY_ID.get(boon.boonId)?.name ?? boon.boonId,
            description: `Transfers ${Math.round(transferFraction * 100)}% of accumulated progression.`,
            consequenceLines: Object.entries(boon.progress?.counters ?? {}).map(
              ([key, value]) => `${key}: ${value} -> ${Math.floor(value * transferFraction)}`,
            ),
          })),
        },
        operation => {
          const selected = operation.selectedIds.filter(instanceId =>
            eligible.some(boon => boon.instanceId === instanceId),
          );
          updateMoodyCoordinatorEffectValues("legacy-slot", values => ({
            ...values,
            pendingLegacy: {
              removedPokemonId: String(pokemonId),
              partySlot,
              selectedImprints: selected,
              transferFraction,
            },
          }));
        },
      ),
    );
  }
}

function resolvePendingMoodyLegacySlot(): void {
  const pending = runtimeRecord(getMoodyCoordinatorEffectState("legacy-slot")?.values?.pendingLegacy);
  const state = getMoodyModeState();
  if (state == null || pending == null) {
    return;
  }
  const partySlot = Number(pending.partySlot);
  const replacement = globalScene.getPlayerParty()[partySlot];
  if (
    replacement == null
    || !Number.isSafeInteger(partySlot)
    || String(replacement.id) === String(pending.removedPokemonId)
  ) {
    return;
  }
  const selected = new Set(Array.isArray(pending.selectedImprints) ? pending.selectedImprints.map(String) : []);
  const fraction = Math.max(0, Math.min(1, Number(pending.transferFraction ?? 0)));
  for (const boon of state.boons) {
    if (!selected.has(boon.instanceId)) {
      continue;
    }
    boon.target = { ...boon.target, pokemonIds: [replacement.id], partySlots: [partySlot] };
    if (boon.progress?.counters != null) {
      boon.progress.counters = Object.fromEntries(
        Object.entries(boon.progress.counters).map(([key, value]) => [key, Math.floor(value * fraction)]),
      );
    }
  }
  updateMoodyCoordinatorEffectValues("legacy-slot", values => {
    const { pendingLegacy: _pendingLegacy, ...remaining } = values;
    return remaining;
  });
}

function itemStackId(pokemon: Pokemon, itemTypeId: string): string {
  return `${pokemon.id}:${itemTypeId}`;
}

function targetsItem(boonId: string, pokemon: Pokemon, itemTypeId: string): boolean {
  const target = activeBoon(boonId)?.target;
  return (
    (target?.pokemonIds == null || target.pokemonIds.includes(pokemon.id))
    && (target?.itemTypeIds == null || target.itemTypeIds.includes(itemTypeId))
  );
}

export interface MoodyCoordinatorItemActivationPlan {
  readonly preserveStack: boolean;
  readonly repeatActivation: boolean;
  readonly effectMultiplier: number;
}

export function prepareMoodyCoordinatorItemActivation(
  pokemon: Pokemon,
  itemTypeId: string,
  consumable = true,
): MoodyCoordinatorItemActivationPlan {
  const state = getMoodyModeState();
  if (state == null) {
    return { preserveStack: false, repeatActivation: false, effectMultiplier: 1 };
  }
  const warranty = activeBoon("warranty");
  const activationIndex = (warranty?.progress?.counters?.activationsThisBattle ?? 0) + 1;
  const stackId = itemStackId(pokemon, itemTypeId);
  const commands = consumable
    ? runGameplay({
        type: "consumable-activated",
        seed: state.seed ^ pokemon.id ^ activationIndex,
        itemStackId: stackId,
        activationIndex,
        isSelectedStack: targetsItem("warranty", pokemon, itemTypeId),
        roll: (((state.seed ^ pokemon.id ^ activationIndex) >>> 0) % 10_000) / 10_000,
        extendedChance: 0.05,
      })
    : [];
  const rule = getMoodyCoordinatorItemRule(pokemon, itemTypeId);
  return {
    preserveStack: commands.some(command => command.kind === "preserve-item-stack"),
    repeatActivation: commands.some(command => command.kind === "repeat-consumable-effect"),
    effectMultiplier: rule.effectMultiplier,
  };
}

export interface MoodyCoordinatorItemRule {
  readonly ignoreCompatibility: boolean;
  readonly ignoreStackCap: boolean;
  readonly suppressible: boolean;
  readonly effectMultiplier: number;
  readonly extraCap: number;
  readonly secondStackAllowed: boolean;
}

export function getMoodyCoordinatorItemRule(pokemon: Pokemon, itemTypeId: string): MoodyCoordinatorItemRule {
  const state = getMoodyModeState();
  const fallback: MoodyCoordinatorItemRule = {
    ignoreCompatibility: false,
    ignoreStackCap: false,
    suppressible: true,
    effectMultiplier: 1,
    extraCap: 0,
    secondStackAllowed: false,
  };
  if (state == null) {
    return fallback;
  }
  const cursedStack = getCurrentMoodyLiveProjection()?.progression.cursedStack;
  if (cursedStack?.pokemonId === String(pokemon.id) && cursedStack.itemStackId === itemStackId(pokemon, itemTypeId)) {
    return { ...fallback, effectMultiplier: 0 };
  }
  const command = runGameplay({
    type: "item-rule-query",
    seed: state.seed ^ pokemon.id,
    itemStackId: itemStackId(pokemon, itemTypeId),
    isSelectedStack: targetsItem("contraband-slot", pokemon, itemTypeId),
  }).find(candidate => candidate.kind === "override-item-restrictions");
  const baseRule =
    command == null
      ? fallback
      : {
          ignoreCompatibility: command.data.ignoreCompatibility === true,
          ignoreStackCap: command.data.ignoreStackCap === true,
          suppressible: command.data.suppressible !== false,
          effectMultiplier: commandNumber(command, "effectMultiplier", 1),
          extraCap: commandNumber(command, "extraCap"),
          secondStackAllowed: command.data.secondStackAllowed === true,
        };
  const stackCount = globalScene.modifiers
    .filter(
      (modifier): modifier is PokemonHeldItemModifier =>
        modifier instanceof PokemonHeldItemModifier
        && modifier.pokemonId === pokemon.id
        && modifier.type.id === itemTypeId,
    )
    .reduce((total, modifier) => total + modifier.stackCount, 0);
  if (stackCount <= 1 || !state.curses.some(curse => curse.curseId === "jealous-relics")) {
    return baseRule;
  }
  let effectiveCopies = 0;
  for (let copyIndex = 1; copyIndex <= stackCount; copyIndex++) {
    effectiveCopies +=
      runMoodySceneCoordinatorEvent({
        type: "market-price-query",
        seed: state.seed ^ pokemon.id ^ copyIndex,
        price: 0,
        isHealingItem: false,
        itemCopyIndex: copyIndex,
        itemEffectValue: 1,
        duplicateScale: 0.5,
      })?.target.market.itemEffectValue ?? 1;
  }
  return { ...baseRule, effectMultiplier: (baseRule.effectMultiplier * effectiveCopies) / stackCount };
}

export function notifyMoodyCoordinatorBattleEnd(victory: boolean): void {
  const battle = globalScene.currentBattle;
  const state = getMoodyModeState();
  if (battle == null || state == null) {
    return;
  }
  const isBoss = globalScene.getEnemyParty().some(pokemon => pokemon.isBoss());
  settleMoodyBounty(victory);
  runMoodySceneCoordinatorEvent({
    type: "wave-completed",
    seed: state.seed ^ battle.waveIndex,
    waveIndex: battle.waveIndex,
    victory,
    isBoss,
    alliedFaintCount: globalScene.getPlayerParty().filter(pokemon => pokemon.isFainted(true)).length,
    partySize: globalScene.getPlayerParty().length,
    money: globalScene.money,
    compoundInterestCapRemaining: getMoodyCompoundInterestCapRemaining(),
    biomeFailureShieldAvailable: true,
    activeBoonInstanceIds: state.boons.filter(boon => !boon.dormant).map(boon => boon.instanceId),
  });
  resetMoodyCoordinatorLiveCadence("battle");
  if (victory && battle.waveIndex % 10 === 0) {
    resetMoodyCoordinatorLiveCadence("ten-wave-segment");
  }
  if (victory && isBoss) {
    queueMoodyBountyDraft(battle.waveIndex + 1);
  }
  queueMoodyHunterChoice();
}

function isHunterChoice(value: unknown): value is MoodyHunterChoice {
  return value === "damageBonus" || value === "resistanceBonus" || value === "captureBonus";
}

function queueMoodyHunterChoice(): void {
  const pending = getCurrentMoodyLiveProjection()?.progression.pendingChoices.find(
    choice => choice.kind === "queue-post-battle-hunter-choice",
  );
  if (pending == null) {
    return;
  }
  const choices = Array.isArray(pending.data.choices) ? pending.data.choices.filter(isHunterChoice) : [];
  if (choices.length === 0) {
    return;
  }
  consumeCurrentMoodyLivePendingChoice("queue-post-battle-hunter-choice");
  globalScene.phaseManager.unshiftPhase(
    new MoodyCoordinatorChoicePhase(choices, choice => {
      const state = getMoodyModeState();
      if (state == null) {
        return;
      }
      runMoodySceneCoordinatorEvent({
        type: "hunter-choice-resolved",
        seed: state.seed ^ (globalScene.currentBattle?.waveIndex ?? 0),
        choice,
        amount: 0.15,
      });
    }),
  );
}

interface MoodyTurnPokemonSnapshot {
  readonly pokemonId: string;
  readonly hp: number;
  readonly status: null | {
    readonly effect: number;
    readonly toxicTurnCount: number;
    readonly sleepTurnsRemaining?: number;
  };
  readonly summonData: Readonly<Record<string, unknown>>;
  readonly ppUsed: readonly number[];
}

interface MoodyCommittedEnemyAction {
  readonly battleKey: string;
  readonly turn: number;
  readonly pokemonId: string;
  readonly moveId: number;
  readonly targetPokemonIds: readonly string[];
  readonly targetBattlerIndices?: readonly number[];
  readonly useMode: number;
}

interface MoodyTurnSnapshot {
  readonly pokemon: readonly MoodyTurnPokemonSnapshot[];
  readonly phaserRngState: string;
  readonly battleRngState: string | null;
  readonly rngOffset: number;
  readonly rngSeedOverride: string;
  readonly turnCommands: Readonly<Record<string, unknown>>;
  readonly preTurnCommands: Readonly<Record<string, unknown>>;
  readonly committedEnemyActions: readonly MoodyCommittedEnemyAction[];
}

function battleKey(): string {
  const battle = globalScene.currentBattle;
  return `${battle?.waveIndex ?? 0}:${battle?.battleSeed ?? ""}`;
}

function committedActions(): readonly MoodyCommittedEnemyAction[] {
  for (const effectId of ["borrowed-future", "time-loop"] as const) {
    const raw = getMoodyCoordinatorEffectState(effectId)?.values?.committedEnemyActions;
    if (Array.isArray(raw)) {
      return raw.filter((entry): entry is MoodyCommittedEnemyAction => {
        return (
          entry != null && !Array.isArray(entry) && typeof entry === "object" && typeof entry.pokemonId === "string"
        );
      });
    }
  }
  return [];
}

function captureTurnSnapshot(): MoodyTurnSnapshot {
  const battle = globalScene.currentBattle;
  return {
    pokemon: [...globalScene.getPlayerParty(), ...globalScene.getEnemyParty()].map(pokemon => ({
      pokemonId: String(pokemon.id),
      hp: pokemon.hp,
      status:
        pokemon.status == null
          ? null
          : {
              effect: pokemon.status.effect,
              toxicTurnCount: pokemon.status.toxicTurnCount,
              ...(pokemon.status.sleepTurnsRemaining == null
                ? {}
                : { sleepTurnsRemaining: pokemon.status.sleepTurnsRemaining }),
            },
      summonData: pokemon.summonData.toJSON() as unknown as Readonly<Record<string, unknown>>,
      ppUsed: pokemon.getMoveset().map(move => move.ppUsed),
    })),
    phaserRngState: Phaser.Math.RND.state(),
    battleRngState: battle.captureDeterministicRngState(),
    rngOffset: globalScene.rngOffset,
    rngSeedOverride: globalScene.rngSeedOverride,
    turnCommands: structuredClone(battle.turnCommands) as Readonly<Record<string, unknown>>,
    preTurnCommands: structuredClone(battle.preTurnCommands) as Readonly<Record<string, unknown>>,
    committedEnemyActions: structuredClone(committedActions()),
  };
}

function borrowedFutureLeadDetails(lead: EnemyPokemon | undefined): string[] {
  if (lead == null) {
    return [];
  }
  const moveNames = lead.getMoveset().map(move => allMoves[move.moveId]?.name ?? `Move ${move.moveId}`);
  const abilityNames = lead.getAbilitySlots().map(({ ability }) => ability.name);
  const itemNames = (
    globalScene.findModifiers(
      modifier => modifier instanceof PokemonHeldItemModifier && modifier.pokemonId === lead.id,
      false,
    ) as PokemonHeldItemModifier[]
  ).map(modifier => `${modifier.type.name}${modifier.stackCount > 1 ? ` x${modifier.stackCount}` : ""}`);
  return [
    `SCOUTED LEAD: ${lead.getNameToRender()}`,
    `MOVES: ${moveNames.join(" / ") || "None"}`,
    `ABILITIES: ${abilityNames.join(" / ") || "None"}`,
    `ITEMS: ${itemNames.join(" / ") || "None"}`,
  ];
}

async function requestBorrowedFutureContingencyEdit(party: Pokemon[]): Promise<void> {
  const heldItems = globalScene.findModifiers(
    modifier => modifier instanceof PokemonHeldItemModifier && modifier.isTransferable,
    true,
  ) as PokemonHeldItemModifier[];
  const moveOptions = party.flatMap(pokemon =>
    pokemon
      .getMoveset()
      .slice(1)
      .map((move, moveIndex) => ({
        id: `move:${pokemon.id}:${moveIndex + 1}`,
        label: `${pokemon.getNameToRender()}: ${allMoves[move.moveId]?.name ?? `Move ${move.moveId}`}`,
        description: `Move this attack to slot 1, swapping it with ${allMoves[pokemon.moveset[0]!.moveId]?.name ?? "the current first move"}.`,
      })),
  );
  const itemOptions = heldItems.flatMap((modifier, modifierIndex) => {
    const holder = party.find(pokemon => pokemon.id === modifier.pokemonId);
    if (holder == null) {
      return [];
    }
    return party
      .filter(pokemon => pokemon !== holder)
      .map(target => ({
        id: `item:${modifierIndex}:${target.id}`,
        label: `${modifier.type.name} to ${target.getNameToRender()}`,
        description: `Move one ${modifier.type.name} from ${holder.getNameToRender()} to ${target.getNameToRender()}.`,
      }));
  });
  const result = await globalScene.ui.requestMoodyOperation({
    kind: "borrowed-future",
    title: "CONTINGENCY PLAN",
    prompt: "Optionally make one move-slot or held-item arrangement edit before the opening action locks.",
    confirmLabel: "apply edit",
    cancellable: true,
    minSelections: 1,
    maxSelections: 1,
    options: [...moveOptions, ...itemOptions],
  });
  if (result.action !== "confirm" || result.selectedIds.length !== 1) {
    return;
  }
  const [kind, first, second] = result.selectedIds[0]!.split(":");
  if (kind === "move") {
    const pokemon = party.find(candidate => String(candidate.id) === first);
    const moveIndex = Number(second);
    if (pokemon == null || !Number.isInteger(moveIndex) || moveIndex < 1 || moveIndex >= pokemon.moveset.length) {
      return;
    }
    [pokemon.moveset[0], pokemon.moveset[moveIndex]] = [pokemon.moveset[moveIndex]!, pokemon.moveset[0]!];
    const summonedMoveset = pokemon.summonData.moveset;
    if (summonedMoveset != null && summonedMoveset.length === pokemon.moveset.length) {
      [summonedMoveset[0], summonedMoveset[moveIndex]] = [summonedMoveset[moveIndex]!, summonedMoveset[0]!];
    }
    return;
  }
  if (kind === "item") {
    const modifier = heldItems[Number(first)];
    const target = party.find(candidate => String(candidate.id) === second);
    if (modifier != null && target != null) {
      globalScene.tryTransferHeldItemModifier(modifier, target, false, 1, true);
    }
  }
}

export function prepareMoodyCoordinatorEnemyActionCommitments(): void {
  const state = getMoodyModeState();
  const battle = globalScene.currentBattle;
  if (state == null || battle == null || (activeBoon("borrowed-future") == null && activeBoon("time-loop") == null)) {
    return;
  }
  const key = battleKey();
  const existing = committedActions().filter(action => action.battleKey === key && action.turn === battle.turn);
  if (existing.length > 0) {
    return;
  }
  const field = globalScene.getField();
  const actions: MoodyCommittedEnemyAction[] = globalScene.getEnemyField().flatMap(enemy => {
    if (!enemy?.isActive(true)) {
      return [];
    }
    const move = enemy.getNextMove();
    return [
      {
        battleKey: key,
        turn: battle.turn,
        pokemonId: String(enemy.id),
        moveId: move.move,
        targetPokemonIds: move.targets.flatMap(index => (field[index]?.id == null ? [] : [String(field[index].id)])),
        targetBattlerIndices: [...move.targets],
        useMode: move.useMode ?? MoveUseMode.NORMAL,
      },
    ];
  });
  const targetEffect = activeBoon("borrowed-future") == null ? "time-loop" : "borrowed-future";
  updateMoodyCoordinatorEffectValues(targetEffect, values => ({
    ...values,
    committedEnemyActions: actions as unknown as MoodyRuntimeValue,
  }));
  const borrowedFuture = activeBoon("borrowed-future");
  if (battle.turn === 1 && borrowedFuture != null && battle.battleType === BattleType.TRAINER) {
    runGameplay({
      type: "prebattle-commit",
      seed: state.seed ^ battle.waveIndex,
      enemyRoster: globalScene.getEnemyParty().map(enemy => ({ pokemonId: String(enemy.id) })),
      enemyLead: { pokemonId: actions[0]?.pokemonId ?? "" },
      committedActions: actions as unknown as readonly MoodyRuntimeValue[],
      visibleLeadData: {
        pokemonId: actions[0]?.pokemonId ?? "",
        moveIds:
          globalScene
            .getEnemyField()[0]
            ?.getMoveset()
            .map(move => String(move.moveId)) ?? [],
      },
    });
    updateMoodyCoordinatorEffectValues("borrowed-future", values => ({
      ...values,
      committedEnemyActions: actions as unknown as MoodyRuntimeValue,
    }));
    const planningKey = `${key}:${battle.turn}`;
    const planningShown = String(getMoodyCoordinatorEffectState("borrowed-future")?.values?.planningShown ?? "");
    if (actions.length > 0 && planningShown !== planningKey) {
      updateMoodyCoordinatorEffectValues("borrowed-future", values => ({ ...values, planningShown: planningKey }));
      const party = globalScene.getPlayerParty();
      const enemyById = new Map(globalScene.getEnemyParty().map(enemy => [String(enemy.id), enemy]));
      const visibleActions = actions;
      const detailedActions =
        borrowedFuture.evolutionId === "parallel-futures" ? visibleActions : visibleActions.slice(0, 1);
      const leadDetails =
        borrowedFuture.rank >= 2
          ? detailedActions.flatMap(action => borrowedFutureLeadDetails(enemyById.get(action.pokemonId)))
          : [];
      globalScene.phaseManager.unshiftPhase(
        new MoodyCoordinatorOperationPhase(
          {
            kind: "borrowed-future",
            title: "BORROWED FUTURE",
            prompt: "Enemy actions are committed. Reorder once, then begin battle.",
            confirmLabel: "begin battle",
            cancellable: false,
            reorderable: true,
            leadCount: Math.max(1, battle.arrangement.playerCapacity),
            minSelections: 0,
            detailLines: leadDetails,
            committedActions: visibleActions.map(action => ({
              pokemonId: action.pokemonId,
              actor: enemyById.get(action.pokemonId)?.getNameToRender() ?? `Enemy ${action.pokemonId}`,
              action: allMoves[action.moveId]?.name ?? `Move ${action.moveId}`,
              target:
                action.targetBattlerIndices?.map(index => `Field slot ${index + 1}`).join(", ")
                || action.targetPokemonIds.join(", ")
                || "No fixed target",
            })),
            options: party.map((pokemon, index) => ({
              id: String(pokemon.id),
              label: pokemon.getNameToRender(),
              description: `Party position ${index + 1}. LEFT/RIGHT changes the planned order.`,
            })),
          },
          async result => {
            if (result.action !== "confirm" || result.orderedIds.length !== party.length) {
              return;
            }
            const byId = new Map(party.map(pokemon => [String(pokemon.id), pokemon]));
            const ordered = result.orderedIds.flatMap(id => {
              const pokemon = byId.get(id);
              return pokemon == null ? [] : [pokemon];
            });
            if (ordered.length !== party.length || new Set(ordered).size !== party.length) {
              return;
            }
            party.splice(0, party.length, ...ordered);
            await settleCoopPartyReorderPresentationReady(globalScene, battle.arrangement.playerCapacity).catch(
              () => undefined,
            );
            if (borrowedFuture.evolutionId === "contingency-plan") {
              await requestBorrowedFutureContingencyEdit(party);
            }
          },
        ),
      );
    }
  }
}

export function applyMoodyCoordinatorCommittedEnemyAction(enemy: EnemyPokemon, fieldIndex: number): boolean {
  const battle = globalScene.currentBattle;
  const action = committedActions().find(
    candidate =>
      candidate.battleKey === battleKey() && candidate.turn === battle.turn && candidate.pokemonId === String(enemy.id),
  );
  if (action == null) {
    return false;
  }
  const field = globalScene.getField();
  const targets = resolveMoodyCommittedEnemyTargetIndices(action, field);
  battle.turnCommands[battle.arrangement.enemyOffset + fieldIndex] = {
    command: Command.FIGHT,
    move: { move: action.moveId as MoveId, targets, useMode: action.useMode as MoveUseMode },
    skip: false,
  };
  return true;
}

export function resolveMoodyCommittedEnemyTargetIndices(
  action: Pick<MoodyCommittedEnemyAction, "targetBattlerIndices" | "targetPokemonIds">,
  field: readonly (Pick<Pokemon, "id" | "isActive" | "getBattlerIndex"> | undefined)[],
): number[] {
  if (action.targetBattlerIndices != null) {
    return action.targetBattlerIndices.filter(index => field[index]?.isActive());
  }
  return action.targetPokemonIds.flatMap(pokemonId => {
    const target = field.find(candidate => String(candidate?.id) === pokemonId);
    return target == null ? [] : [target.getBattlerIndex()];
  });
}

export function notifyMoodyCoordinatorTurnStart(): void {
  const state = getMoodyModeState();
  const battle = globalScene.currentBattle;
  if (state == null || battle == null) {
    return;
  }
  prepareMoodyCoordinatorEnemyActionCommitments();
  resolvePendingMoodyLegacySlot();
  const borrowedMove = runtimeRecord(getMoodyCoordinatorEffectState("pair-bond")?.values?.borrowedMove);
  if (borrowedMove != null) {
    const expiresAt = Number(borrowedMove.expiresAt);
    if (Number.isFinite(expiresAt) && battle.turn >= expiresAt) {
      const pokemon = globalScene.getPlayerParty().find(member => String(member.id) === String(borrowedMove.pokemonId));
      const moveId = Number(borrowedMove.moveId);
      const index = pokemon?.moveset.findLastIndex(move => move.moveId === moveId) ?? -1;
      if (pokemon != null && index >= 0) {
        pokemon.moveset.splice(index, 1);
      }
      updateMoodyCoordinatorEffectValues("pair-bond", values => {
        const { borrowedMove: _borrowedMove, ...remaining } = values;
        return remaining;
      });
    }
  }
  if (battle.turn === 1 && activeBoon("ability-carousel") != null) {
    const party = globalScene.getPlayerParty().filter(pokemon => pokemon.isAllowedInBattle());
    const compatibleAbilityIdsByPokemon = Object.fromEntries(
      party.map((pokemon, index) => {
        const source = party[(index + 1) % party.length];
        const owned = new Set(pokemon.getAbilitySlots().map(slot => slot.ability.id));
        const candidates =
          source
            ?.getAbilitySlots()
            .map(slot => slot.ability)
            .filter(
              ability =>
                ability.id > 0
                && ability.copiable
                && ability.replaceable
                && !ability.unimplemented
                && !owned.has(ability.id),
            )
            .map(ability => String(ability.id)) ?? [];
        return [String(pokemon.id), candidates];
      }),
    );
    runGameplay({
      type: "battle-start",
      seed: state.seed ^ battle.waveIndex,
      turn: battle.turn,
      occupiedParty: party.map(pokemon => String(pokemon.id)),
      compatibleAbilityIdsByPokemon,
    });
  }
  runGameplay({
    type: "turn-start",
    seed: state.seed ^ battle.turn,
    turn: battle.turn,
    turnSnapshotId: `${battle.waveIndex}:${battle.turn}`,
    snapshot: captureTurnSnapshot() as unknown as MoodyRuntimeValue,
  });
}

export function getMoodyCoordinatorExtraAbilityIds(pokemonId: number): readonly number[] {
  const battle = globalScene.currentBattle;
  const values = getMoodyCoordinatorEffectState("ability-carousel")?.values;
  if (
    battle == null
    || Number(values?.carouselExpiresAt ?? 0) <= battle.turn
    || !Array.isArray(values?.carouselAssignments)
  ) {
    return [];
  }
  return values.carouselAssignments.flatMap(raw => {
    if (raw == null || Array.isArray(raw) || typeof raw !== "object" || String(raw.pokemonId) !== String(pokemonId)) {
      return [];
    }
    const abilityId = Number(raw.abilityId);
    return Number.isSafeInteger(abilityId) && allAbilities[abilityId]?.id > 0 ? [abilityId] : [];
  });
}

function restoreMoodyTurnSnapshot(value: unknown): boolean {
  if (value == null || Array.isArray(value) || typeof value !== "object") {
    return false;
  }
  const turnSnapshot = value as unknown as MoodyTurnSnapshot;
  if (!Array.isArray(turnSnapshot.pokemon)) {
    return false;
  }
  const pokemonById = new Map(
    [...globalScene.getPlayerParty(), ...globalScene.getEnemyParty()].map(pokemon => [String(pokemon.id), pokemon]),
  );
  let restored = false;
  for (const raw of turnSnapshot.pokemon) {
    if (raw == null || typeof raw !== "object") {
      continue;
    }
    const snapshot = raw as unknown as MoodyTurnPokemonSnapshot;
    const pokemon = pokemonById.get(snapshot.pokemonId);
    if (pokemon == null || !Number.isFinite(snapshot.hp)) {
      continue;
    }
    pokemon.hp = Math.max(0, Math.min(pokemon.getMaxHp(), Math.floor(snapshot.hp)));
    pokemon.status =
      snapshot.status == null
        ? null
        : new Status(
            snapshot.status.effect as StatusEffect,
            snapshot.status.toxicTurnCount,
            snapshot.status.sleepTurnsRemaining,
          );
    pokemon.summonData = new PokemonSummonData(
      snapshot.summonData as unknown as ConstructorParameters<typeof PokemonSummonData>[0],
    );
    pokemon.getMoveset().forEach((move, index) => {
      move.ppUsed = Math.max(0, Math.floor(snapshot.ppUsed[index] ?? move.ppUsed));
    });
    pokemon.updateInfo(true).catch(() => undefined);
    restored = true;
  }
  if (typeof turnSnapshot.phaserRngState === "string") {
    Phaser.Math.RND.state(turnSnapshot.phaserRngState);
  }
  globalScene.currentBattle.restoreDeterministicRngState(turnSnapshot.battleRngState ?? null);
  globalScene.rngOffset = Number.isFinite(turnSnapshot.rngOffset) ? turnSnapshot.rngOffset : globalScene.rngOffset;
  globalScene.rngSeedOverride = turnSnapshot.rngSeedOverride ?? globalScene.rngSeedOverride;
  const targetEffect = activeBoon("borrowed-future") == null ? "time-loop" : "borrowed-future";
  updateMoodyCoordinatorEffectValues(targetEffect, values => ({
    ...values,
    committedEnemyActions: turnSnapshot.committedEnemyActions as unknown as readonly MoodyRuntimeValue[],
  }));
  const battle = globalScene.currentBattle;
  battle.turnCommands = structuredClone(turnSnapshot.turnCommands) as typeof battle.turnCommands;
  battle.preTurnCommands = structuredClone(turnSnapshot.preTurnCommands) as typeof battle.preTurnCommands;
  globalScene.phaseManager.clearPhaseQueue();
  globalScene.phaseManager.dynamicQueueManager.clearQueues();
  globalScene.getField().forEach((pokemon, index) => {
    if (!pokemon?.isActive()) {
      return;
    }
    if (pokemon.isPlayer()) {
      globalScene.phaseManager.pushNew("CommandPhase", index);
    } else {
      globalScene.phaseManager.pushNew("EnemyCommandPhase", pokemon.getFieldIndex());
    }
  });
  globalScene.phaseManager.pushNew("TurnStartPhase");
  return restored;
}

export function notifyMoodyCoordinatorBiomeTransition(): void {
  const state = getMoodyModeState();
  if (state == null) {
    return;
  }
  resetMoodyCoordinatorLiveCadence("biome");
  const party = globalScene.getPlayerParty();
  const usageRanking = moodyUsageRanking(party);
  const eligibleStacksByPokemon = Object.fromEntries(
    party.map(pokemon => [
      String(pokemon.id),
      globalScene.modifiers
        .filter(
          (modifier): modifier is PokemonHeldItemModifier =>
            modifier instanceof PokemonHeldItemModifier && modifier.pokemonId === pokemon.id && modifier.stackCount > 0,
        )
        .map(modifier => itemStackId(pokemon, modifier.type.id)),
    ]),
  );
  const apexPokemonId = activeBoon("apex-plunder")?.target?.pokemonIds?.[0];
  runMoodySceneCoordinatorEvent({
    type: "biome-transition",
    seed: state.seed ^ (globalScene.currentBattle?.waveIndex ?? 0),
    waveIndex: globalScene.currentBattle?.waveIndex ?? 0,
    money: globalScene.money,
    compoundInterestCapRemaining: getMoodyCompoundInterestCapRemaining(),
    patientCapitalRate: 0.03,
    usageRanking,
    eligibleStacksByPokemon,
    partyMoves: Object.fromEntries(
      party.map(pokemon => [String(pokemon.id), pokemon.getMoveset().map(move => String(move.moveId))]),
    ),
    eligibleReplacementsByMove: {},
    ...(apexPokemonId == null ? {} : { apexPokemonId: String(apexPokemonId) }),
  });
  for (const effectId of USAGE_TRACKED_EFFECT_IDS) {
    updateMoodyCoordinatorEffectValues(effectId, values => ({
      ...values,
      usageByPokemon: {},
      previousUsageRanking: usageRanking,
    }));
  }
}

function getMoodyCompoundInterestCapRemaining(): number {
  const compound = activeBoon("compound-interest");
  if (compound == null) {
    return 0;
  }
  const capFraction = compound.evolutionId === "patient-capital" ? 0.5 : 0.25;
  const accumulated = Math.max(
    0,
    Number(getMoodyCoordinatorEffectState("compound-interest")?.counters?.accumulatedInterest ?? 0),
  );
  return Math.max(0, Math.floor(globalScene.money * capFraction) - accumulated);
}

export function prepareMoodyCoordinatorTrainerRoster(
  baseRosterSize: number,
  maxRosterSize: number,
  isEligibleTrainer: boolean,
  isBossTrainer: boolean,
): number {
  const state = getMoodyModeState();
  if (state == null) {
    return baseRosterSize;
  }
  const result = runMoodySceneCoordinatorEvent({
    type: "trainer-roster-generated",
    seed: state.seed ^ (globalScene.currentBattle?.waveIndex ?? 0) ^ baseRosterSize,
    isEligibleTrainer,
    isBossTrainer,
    baseRosterSize,
    maxRosterSize,
  });
  return Math.max(
    baseRosterSize,
    Math.min(maxRosterSize, result?.target.progression.trainerRosterSize ?? baseRosterSize),
  );
}

export function shouldMoodyCoordinatorForceElitePursuit(waveIndex: number, isBossWave: boolean): boolean {
  const active = getMoodyModeState()?.curses.some(curse => curse.curseId === "elite-pursuit") === true;
  const force = active && !isBossWave && waveIndex > 0 && waveIndex % 5 === 0;
  if (force) {
    updateMoodyCoordinatorEffectValues("elite-pursuit", values => ({
      ...values,
      lastForcedWave: waveIndex,
    }));
  }
  return force;
}

export function prepareMoodyCoordinatorEnemyGeneration(isBoss: boolean): void {
  const state = getMoodyModeState();
  if (state == null) {
    return;
  }
  const topThreat = state.recentThreat.toSorted(
    (left, right) => right.damageDealt + right.knockouts * 100 - (left.damageDealt + left.knockouts * 100),
  )[0];
  runMoodySceneCoordinatorEvent({
    type: "enemy-boon-generation",
    seed: state.seed ^ (globalScene.currentBattle?.waveIndex ?? 0),
    baseCounterWeight: 1,
    isBoss,
    topThreatPokemonId: String(topThreat?.pokemonId ?? globalScene.getPlayerParty()[0]?.id ?? ""),
  });
}

export function getMoodyCoordinatorEnemyStatMultiplier(): number {
  return getCurrentMoodyLiveProjection()?.progression.futureEnemyStatMultiplier ?? 1;
}

export function getMoodyCoordinatorCounterWeight(): number {
  return getCurrentMoodyLiveProjection()?.progression.counterWeight ?? 1;
}

export function applyMoodyCoordinatorTypeEffectiveness(
  source: Pokemon | undefined,
  target: Pokemon,
  effectiveness: number,
  simulated: boolean,
): number {
  const state = getMoodyModeState();
  if (state == null || simulated || source == null) {
    return effectiveness;
  }
  const direction = source.isPlayer() ? "outgoing" : target.isPlayer() ? "incoming" : null;
  if (direction == null) {
    return effectiveness;
  }
  const pokemon = direction === "outgoing" ? source : target;
  const command = runGameplay({
    type: "type-effectiveness-query",
    seed: state.seed ^ pokemon.id ^ (globalScene.currentBattle?.turn ?? 0),
    direction,
    effectiveness,
    pokemonId: String(pokemon.id),
  }).find(candidate => candidate.kind === "override-type-effectiveness");
  return command == null ? effectiveness : commandNumber(command, "effectiveness", effectiveness);
}

export function notifyMoodyCoordinatorExperience(pokemon: Pokemon): number {
  const state = getMoodyModeState();
  if (state == null || !pokemon.isPlayer()) {
    return 1;
  }
  const party = globalScene.getPlayerParty().toSorted((left, right) => left.level - right.level || left.id - right.id);
  const averageLevel =
    party.length === 0 ? pokemon.level : party.reduce((total, member) => total + member.level, 0) / party.length;
  const levelGap = Math.max(0, averageLevel - pokemon.level);
  const experienceCommands = runGameplay({
    type: "experience-query",
    seed: state.seed ^ pokemon.id ^ (globalScene.currentBattle?.waveIndex ?? 0),
    pokemonId: String(pokemon.id),
    levelGap,
    isLowest: party[0]?.id === pokemon.id,
    isSecondLowest: party[1]?.id === pokemon.id,
  });
  const statCommands = runGameplay({
    type: "pokemon-stat-query",
    seed: state.seed ^ pokemon.id,
    pokemonId: String(pokemon.id),
    levelGap,
    fullyEvolved: pokemon.getEvolution() == null,
    enemyAboveLevel: globalScene.getEnemyParty().some(enemy => enemy.level > pokemon.level),
    caughtUp: levelGap < 5,
  });
  return [...experienceCommands, ...statCommands]
    .filter(command => command.kind === "apply-experience-multiplier" || command.kind === "apply-pokemon-growth")
    .reduce(
      (multiplier, command) =>
        multiplier * commandNumber(command, "multiplier", commandNumber(command, "experienceMultiplier", 1)),
      1,
    );
}

export function notifyMoodyCoordinatorExperienceApplied(pokemon: Pokemon, previousLevelGap: number): void {
  const state = getMoodyModeState();
  if (state == null || !pokemon.isPlayer()) {
    return;
  }
  const highestLevel = Math.max(...globalScene.getPlayerParty().map(member => member.level), pokemon.level);
  const currentGap = highestLevel - pokemon.level;
  if (previousLevelGap < 5 || currentGap >= 5) {
    return;
  }
  const values = getMoodyCoordinatorEffectState("bench-academy")?.values;
  const graduated = Array.isArray(values?.graduatedPokemonIds) ? values.graduatedPokemonIds.map(String) : [];
  if (graduated.includes(String(pokemon.id))) {
    return;
  }
  const commands = runGameplay({ type: "academy-graduated", seed: state.seed ^ pokemon.id });
  const hpCommand = commands.find(command => command.kind === "increase-team-max-hp");
  const fraction = commandNumber(hpCommand ?? { effectId: "", kind: "increase-team-max-hp", data: {} }, "fraction");
  updateMoodyCoordinatorEffectValues("bench-academy", current => ({
    ...current,
    graduatedPokemonIds: [...graduated, String(pokemon.id)],
    teamMaxHpFraction: Math.min(0.1, Number(current.teamMaxHpFraction ?? 0) + fraction),
    ...(commands.some(command => command.kind === "offer-partial-vitamin-transfer")
      ? { pendingVitaminTransferPokemonId: String(pokemon.id) }
      : {}),
  }));
  for (const member of globalScene.getPlayerParty()) {
    member.hp = Math.min(member.hp + Math.max(1, Math.floor(member.getMaxHp() * fraction)), member.getMaxHp());
    member.updateInfo(true).catch(() => undefined);
  }
}

export function getMoodyCoordinatorPairDamageMultiplier(pokemon: Pokemon, simulated: boolean): number {
  const state = getMoodyModeState();
  const pair = activeBoon("pair-bond");
  const ids = pair?.target?.pokemonIds ?? [];
  if (state == null || !pokemon.isPlayer() || ids.length < 2 || !ids.includes(pokemon.id)) {
    return 1;
  }
  const bothConscious = ids.every(id => {
    const member = globalScene.getPlayerParty().find(candidate => candidate.id === id);
    return member != null && !member.isFainted(true);
  });
  if (simulated) {
    return bothConscious ? (pair!.rank >= 2 ? 1.15 : 1.1) : 1;
  }
  const command = runGameplay({ type: "pair-query", seed: state.seed ^ pokemon.id, bothConscious }).find(
    candidate => candidate.kind === "apply-pair-damage",
  );
  return command == null ? 1 : commandNumber(command, "multiplier", 1);
}

export interface MoodyCoordinatorPartyModifiers {
  readonly outgoingDamageMultiplier: number;
  readonly incomingDamageMultiplier: number;
  readonly maxHpMultiplier: number;
  readonly speedMultiplier: number;
  readonly priorityDelta: number;
}

export function getMoodyCoordinatorPartyModifiers(
  pokemon: Pokemon,
  moveType?: PokemonType,
  incoming = false,
): MoodyCoordinatorPartyModifiers {
  const state = getMoodyModeState();
  const fallback = {
    outgoingDamageMultiplier: 1,
    incomingDamageMultiplier: 1,
    maxHpMultiplier: 1,
    speedMultiplier: 1,
    priorityDelta: 0,
  };
  if (state == null || !pokemon.isPlayer()) {
    return fallback;
  }
  const party = globalScene.getPlayerParty();
  const conscious = party.filter(member => !member.isFainted(true));
  const uniqueTypes = new Set(party.flatMap(member => member.getTypes()));
  const oath = activeBoon("monotype-oath");
  const oathType = oath?.target?.pokemonType;
  const matchingContributors =
    oathType == null ? 0 : party.filter(member => member.getTypes().includes(oathType)).length;
  const commands = runGameplay({
    type: "party-composition-query",
    seed: state.seed ^ pokemon.id ^ (moveType ?? 0) ^ Number(incoming),
    uniqueTypeCount: uniqueTypes.size,
    matchingContributors,
    consciousCount: conscious.length,
    allConsciousMatch: oathType != null && conscious.every(member => member.getTypes().includes(oathType)),
    moveMatchesType: !incoming && oathType != null && moveType === oathType && pokemon.getTypes().includes(oathType),
    incomingMatchesType: incoming && oathType != null && moveType === oathType && pokemon.getTypes().includes(oathType),
    firstDamagingMove: pokemon.getMoveHistory().every(record => record.move === MoveId.NONE),
    firstSuperEffectiveHit: pokemon.turnData.attacksReceived.length === 0,
  });
  return commands.reduce((result, command) => {
    if (command.kind !== "apply-party-modifiers" && command.kind !== "apply-monotype-oath") {
      return result;
    }
    return {
      outgoingDamageMultiplier: result.outgoingDamageMultiplier * commandNumber(command, "damageMultiplier", 1),
      incomingDamageMultiplier: result.incomingDamageMultiplier * commandNumber(command, "incomingDamageMultiplier", 1),
      maxHpMultiplier: result.maxHpMultiplier * commandNumber(command, "maxHpMultiplier", 1),
      speedMultiplier: result.speedMultiplier * commandNumber(command, "speedMultiplier", 1),
      priorityDelta: result.priorityDelta + commandNumber(command, "priorityDelta"),
    };
  }, fallback);
}

export function notifyMoodyCoordinatorDirectPairSwitch(outgoing: Pokemon, incoming: Pokemon, voluntary: boolean): void {
  const state = getMoodyModeState();
  if (state != null && voluntary && outgoing.isPlayer() && incoming.isPlayer()) {
    updateMoodyBounty(current => ({ ...current, switchCount: current.switchCount + 1 }));
    const party = globalScene.getPlayerParty().filter(pokemon => pokemon.isAllowedInBattle());
    const outgoingIndex = party.findIndex(pokemon => pokemon.id === outgoing.id);
    const incomingIndex = party.findIndex(pokemon => pokemon.id === incoming.id);
    if (
      Math.abs(outgoingIndex - incomingIndex) === 1
      && activeBoon("ability-carousel")?.evolutionId === "fast-carousel"
    ) {
      const compatibleAbilityIdsByPokemon = Object.fromEntries(
        party.map((pokemon, index) => {
          const source = party[(index + 1) % party.length];
          const owned = new Set(pokemon.getAbilitySlots().map(slot => slot.ability.id));
          const compatible =
            source
              ?.getAbilitySlots()
              .map(slot => slot.ability)
              .filter(
                ability =>
                  ability.id > 0
                  && ability.copiable
                  && ability.replaceable
                  && !ability.unimplemented
                  && !owned.has(ability.id),
              )
              .map(ability => String(ability.id)) ?? [];
          return [String(pokemon.id), compatible];
        }),
      );
      runGameplay({
        type: "adjacent-direct-switch",
        seed: state.seed ^ outgoing.id ^ incoming.id,
        turn: globalScene.currentBattle?.turn ?? 0,
        pokemonId: String(incoming.id),
        compatibleAbilityIds: compatibleAbilityIdsByPokemon[String(incoming.id)] ?? [],
        compatibleAbilityIdsByPokemon,
      });
    }
  }
  const pair = activeBoon("pair-bond");
  const ids = pair?.target?.pokemonIds ?? [];
  if (
    !voluntary
    || state == null
    || !outgoing.isPlayer()
    || !incoming.isPlayer()
    || !ids.includes(outgoing.id)
    || !ids.includes(incoming.id)
  ) {
    return;
  }
  const commands = runGameplay({
    type: "direct-pair-switch",
    seed: state.seed ^ outgoing.id ^ incoming.id,
    pokemonId: String(incoming.id),
  });
  const heal = commands.find(command => command.kind === "heal-incoming-partner");
  if (heal != null) {
    incoming.heal(Math.max(1, Math.floor(incoming.getMaxHp() * commandNumber(heal, "maxHpFraction"))));
  }
  if (commands.some(command => command.kind === "transfer-random-positive-stage")) {
    const positive = BATTLE_STATS.filter(candidateStat => outgoing.getStatStage(candidateStat) > 0);
    const selectedStat = positive[(state.seed ^ outgoing.id ^ incoming.id) % Math.max(1, positive.length)];
    if (selectedStat != null) {
      incoming.setStatStage(selectedStat, incoming.getStatStage(selectedStat) + 1);
    }
  }
}

function notifyMoodyCoordinatorPairMemberFainted(fallen: Pokemon): void {
  const state = getMoodyModeState();
  const pair = activeBoon("pair-bond");
  const ids = pair?.target?.pokemonIds ?? [];
  if (state == null || !fallen.isPlayer() || !ids.includes(fallen.id)) {
    return;
  }
  const survivor = globalScene
    .getPlayerParty()
    .find(member => ids.includes(member.id) && member.id !== fallen.id && !member.isFainted(true));
  if (survivor == null) {
    return;
  }
  const eligibleMoveIds = fallen
    .getMoveset()
    .filter(move => !survivor.getMoveset().some(own => own.moveId === move.moveId))
    .map(move => String(move.moveId));
  const commands = runGameplay({
    type: "pair-member-fainted",
    seed: state.seed ^ fallen.id ^ survivor.id,
    fallenPokemonId: String(fallen.id),
    survivorPokemonId: String(survivor.id),
    eligibleMoveIds,
  });
  const boost = commands.find(command => command.kind === "boost-pair-survivor");
  if (boost != null) {
    if (commandNumber(boost, "allStats") > 0) {
      for (const stat of BATTLE_STATS) {
        survivor.setStatStage(stat, survivor.getStatStage(stat) + commandNumber(boost, "allStats"));
      }
    } else {
      const offense =
        survivor.getStat(BATTLE_STATS[0]) >= survivor.getStat(BATTLE_STATS[2]) ? BATTLE_STATS[0] : BATTLE_STATS[2];
      survivor.setStatStage(offense, survivor.getStatStage(offense) + commandNumber(boost, "highestOffense"));
    }
  }
  const borrowed = commands.find(command => command.kind === "borrow-eligible-move");
  const moveId = Number(borrowed?.data.moveId);
  if (Number.isSafeInteger(moveId) && survivor.moveset.length < survivor.getMaxMoveCount()) {
    survivor.moveset.push(new PokemonMove(moveId as MoveId, 0, 0, 1));
    updateMoodyCoordinatorEffectValues("pair-bond", values => ({
      ...values,
      borrowedMove: {
        pokemonId: String(survivor.id),
        moveId: String(moveId),
        expiresAt: (globalScene.currentBattle?.turn ?? 0) + 2,
      },
    }));
  }
}

export function notifyMoodyCoordinatorPokemonEvolved(pokemon: Pokemon): void {
  const state = getMoodyModeState();
  if (state != null && pokemon.isPlayer()) {
    runGameplay({ type: "pokemon-evolved", seed: state.seed ^ pokemon.id, pokemonId: String(pokemon.id) });
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: command execution is kept adjacent to the segment event that produced it.
export function notifyMoodyCoordinatorBossSegmentBroken(pokemon: Pokemon, boss?: Pokemon): void {
  const state = getMoodyModeState();
  if (state == null || !pokemon.isPlayer()) {
    return;
  }
  const hunter = activeBoon("hunter-s-mark");
  if (boss != null && hunter?.target?.pokemonType != null) {
    runMoodySceneCoordinatorEvent({
      type: "typed-enemy-defeated",
      seed: state.seed ^ boss.id ^ (globalScene.currentBattle?.turn ?? 0),
      matchesMarkedType: boss.getTypes().includes(hunter.target.pokemonType),
      bossSegments: 1,
    });
  }
  const commands = runGameplay({
    type: "boss-segment-broken",
    seed: state.seed ^ pokemon.id ^ (globalScene.currentBattle?.turn ?? 0),
    pokemonId: String(pokemon.id),
    turn: globalScene.currentBattle?.turn ?? 0,
  });
  for (const command of commands) {
    if (command.kind === "heal-pokemon") {
      pokemon.hp = Math.min(
        pokemon.getMaxHp(),
        pokemon.hp + Math.max(1, Math.floor(pokemon.getMaxHp() * commandNumber(command, "maxHpFraction"))),
      );
    } else if (command.kind === "restore-total-pp") {
      let remaining = commandNumber(command, "amount");
      for (const move of pokemon.getMoveset()) {
        const restored = Math.min(move.ppUsed, remaining);
        move.ppUsed -= restored;
        remaining -= restored;
        if (remaining <= 0) {
          break;
        }
      }
    }
  }
  pokemon.updateInfo(true).catch(() => undefined);
}

export function getMoodyCoordinatorTemporaryDamageMultiplier(pokemon: Pokemon): number {
  const save = getMoodyModeSaveData();
  if (save == null) {
    return 1;
  }
  const state = hydrateMoodyCoordinatorState(save).effects.find(effect => effect.effectId === "bossbreaker")?.state;
  return String(state?.values?.temporaryDamagePokemonId ?? "") === String(pokemon.id)
    && Number(state?.values?.temporaryDamageExpiresAt ?? -1) >= (globalScene.currentBattle?.turn ?? 0)
    ? Number(state?.values?.temporaryDamageMultiplier ?? 1)
    : 1;
}

export function getMoodyCoordinatorPocketPriorityDelta(pokemon: Pokemon): number {
  const save = getMoodyModeSaveData();
  if (save == null || !pokemon.isPlayer()) {
    return 0;
  }
  const effect = hydrateMoodyCoordinatorState(save).effects.find(candidate => candidate.effectId === "pocket-turn");
  const boon = activeBoon("pocket-turn");
  const threshold = boon?.rank != null && boon.rank >= 2 ? 2 : 3;
  return Number(effect?.state?.counters?.tempo ?? 0) >= threshold ? 1 : 0;
}

export function getMoodyCoordinatorMoveSelection(
  pokemon: Pokemon,
  moveId: MoveId,
): { readonly selectable: boolean; readonly priorityDelta: number } {
  const state = getMoodyModeState();
  const fallback = { selectable: true, priorityDelta: 0 };
  if (state == null || !pokemon.isPlayer()) {
    return fallback;
  }
  const negativeSpace = activeBoon("negative-space");
  if (
    negativeSpace == null
    || (negativeSpace.target?.pokemonIds != null && !negativeSpace.target.pokemonIds.includes(pokemon.id))
  ) {
    return fallback;
  }
  const known = pokemon.getMoveset().filter(move => move.moveId !== MoveId.NONE);
  const configured = new Set(negativeSpace.target?.moveIds ?? []);
  const maximum = negativeSpace.evolutionId === "void-specialist" ? 3 : negativeSpace.rank >= 2 ? 2 : 1;
  const damaging = known.filter(move => move.getMove().category !== MoveCategory.STATUS);
  const validSeals: MoveId[] = [];
  let sealedDamaging = 0;
  for (const move of known) {
    if (!configured.has(move.moveId) || validSeals.length >= maximum) {
      continue;
    }
    const isDamaging = move.getMove().category !== MoveCategory.STATUS;
    if (isDamaging && sealedDamaging + 1 >= damaging.length) {
      continue;
    }
    validSeals.push(move.moveId);
    sealedDamaging += Number(isDamaging);
  }
  const sealedMoveIds = validSeals.map(String);
  const usable = pokemon
    .getMoveset()
    .filter(move => move.moveId !== MoveId.NONE && !sealedMoveIds.includes(String(move.moveId)));
  const command = runGameplay({
    type: "move-selection-query",
    seed: state.seed ^ pokemon.id ^ moveId,
    pokemonId: String(pokemon.id),
    moveId: String(moveId),
    sealedMoveIds,
    isFirstUsableMove: usable[0]?.moveId === moveId,
  }).find(candidate => candidate.kind === "apply-negative-space");
  return command == null
    ? fallback
    : {
        selectable: command.data.selectable !== false,
        priorityDelta: commandNumber(command, "priorityDelta"),
      };
}

export function getMoodyCoordinatorNegativeSpaceModifiers(
  pokemon: Pokemon,
  moveId?: MoveId,
): {
  readonly outgoingDamageMultiplier: number;
  readonly incomingDamageMultiplier: number;
  readonly priorityDelta: number;
} {
  const boon = activeBoon("negative-space");
  if (
    boon == null
    || !pokemon.isPlayer()
    || (boon.target?.pokemonIds != null && !boon.target.pokemonIds.includes(pokemon.id))
  ) {
    return { outgoingDamageMultiplier: 1, incomingDamageMultiplier: 1, priorityDelta: 0 };
  }
  const validated = pokemon
    .getMoveset()
    .filter(move => !getMoodyCoordinatorMoveSelection(pokemon, move.moveId).selectable);
  const sealedCount = validated.length;
  const isFirstUsableMove =
    moveId != null
    && boon.evolutionId === "open-form"
    && pokemon.getMoveset().find(move => !validated.some(sealed => sealed.moveId === move.moveId))?.moveId === moveId;
  return {
    outgoingDamageMultiplier: boon.evolutionId === "open-form" && sealedCount > 0 && isFirstUsableMove ? 1.25 : 1,
    incomingDamageMultiplier: 1,
    priorityDelta: isFirstUsableMove ? 1 : 0,
  };
}

export function getMoodyCoordinatorPhaseShiftDamageMultiplier(target: Pokemon, simulated: boolean): number {
  const state = getMoodyModeState();
  const boon = activeBoon("phase-shift");
  const turn = globalScene.currentBattle?.turn ?? 0;
  if (state == null || boon?.evolutionId !== "stable-phase" || !target.isPlayer() || simulated) {
    return 1;
  }
  const command = runGameplay({
    type: "direct-hit-preview",
    seed: state.seed ^ target.id ^ turn,
    turn,
    pokemonId: String(target.id),
  }).find(candidate => candidate.kind === "modify-direct-damage");
  const interval = boon.rank >= 2 ? 4 : 5;
  return command != null && (turn <= 0 || turn % interval !== 0) ? commandNumber(command, "multiplier", 1) : 1;
}

function queueSpectralAction(raw: unknown, fallbackPokemon: Pokemon, power: number): void {
  if (raw == null || typeof raw !== "object") {
    return;
  }
  const action = raw as Readonly<Record<string, MoodyRuntimeValue>>;
  const pokemonId = Number(action.pokemonId ?? fallbackPokemon.id);
  const moveId = Number(action.moveId) as MoveId;
  const targetPokemonIds = Array.isArray(action.targetPokemonIds)
    ? action.targetPokemonIds.map(Number).filter(Number.isSafeInteger)
    : [];
  if (Number.isSafeInteger(pokemonId) && Number.isSafeInteger(moveId) && targetPokemonIds.length > 0) {
    globalScene.phaseManager.unshiftPhase(new MoodyCoordinatorEchoPhase(pokemonId, moveId, targetPokemonIds, power));
  }
}

export function notifyMoodyCoordinatorMoveResolved(
  pokemon: Pokemon,
  moveId: MoveId,
  targets: readonly Pokemon[],
  succeeded: boolean,
  damaging: boolean,
  isFollowUp: boolean,
): void {
  const state = getMoodyModeState();
  if (state == null || !pokemon.isPlayer() || isFollowUp) {
    return;
  }
  recordMoodyBiomePokemonUsage(pokemon.id);
  if (succeeded) {
    updateMoodyBounty(current => {
      const pokemonId = String(pokemon.id);
      const previousMove = current.lastMoveByPokemon[pokemonId];
      const actionCount = (current.actionCountByPokemon?.[pokemonId] ?? 0) + 1;
      return {
        ...current,
        failed: current.failed || (current.contractId === "no-consecutive-repeat" && previousMove === String(moveId)),
        actedPokemonIds: [...new Set([...current.actedPokemonIds, pokemonId])],
        actionCountByPokemon: { ...(current.actionCountByPokemon ?? {}), [pokemonId]: actionCount },
        moveTypesUsed: [
          ...new Set([
            ...current.moveTypesUsed,
            pokemon
              .getMoveset()
              .find(move => move.moveId === moveId)
              ?.getMove().type ?? -1,
          ]),
        ].filter(type => type >= 0),
        lastMoveByPokemon: { ...current.lastMoveByPokemon, [pokemonId]: String(moveId) },
      };
    });
  }
  if (!succeeded) {
    runGameplay({
      type: "move-failed",
      seed: state.seed ^ pokemon.id ^ moveId ^ (globalScene.currentBattle?.turn ?? 0),
      pokemonId: String(pokemon.id),
      reason: "move-failed",
    });
    return;
  }
  const actionId = `${globalScene.currentBattle?.waveIndex ?? 0}:${globalScene.currentBattle?.turn ?? 0}:${pokemon.id}:${moveId}`;
  const targetPokemonIds = targets.map(target => String(target.id));
  const pocketCommands = runGameplay({
    type: "allied-move-committed",
    seed: state.seed ^ pokemon.id ^ moveId,
    pokemonId: String(pokemon.id),
    actionId,
    targetActionId: targetPokemonIds.join(","),
  });
  const pocket = pocketCommands.find(command => command.kind === "empower-pocket-turn");
  if (pocket != null) {
    queueSpectralAction(
      { pokemonId: String(pokemon.id), moveId: String(moveId), targetPokemonIds },
      pokemon,
      commandNumber(pocket, "echoPower", 0.5),
    );
  }
  if (!damaging) {
    return;
  }
  const recapCommands = runGameplay({
    type: "allied-damaging-action",
    seed: state.seed ^ pokemon.id ^ moveId ^ (globalScene.currentBattle?.turn ?? 0),
    pokemonId: String(pokemon.id),
    action: { pokemonId: String(pokemon.id), moveId: String(moveId), targetPokemonIds },
  });
  const recap = recapCommands.find(command => command.kind === "replay-spectral-actions");
  const actions = Array.isArray(recap?.data.actions) ? recap.data.actions : [];
  const currentPower = recap == null ? 0 : commandNumber(recap, "echoCurrentPower");
  if (currentPower > 0) {
    queueSpectralAction(
      { pokemonId: String(pokemon.id), moveId: String(moveId), targetPokemonIds },
      pokemon,
      currentPower,
    );
  }
  if (recap != null) {
    for (const action of [...actions].reverse()) {
      queueSpectralAction(action, pokemon, commandNumber(recap, "power", 0.33));
    }
  }
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the three authored valve executors share one atomic overflow event.
export function notifyMoodyCoordinatorPositiveStatOverflow(pokemon: Pokemon, overflowStages: number): void {
  const state = getMoodyModeState();
  const boon = activeBoon("pressure-valve");
  if (state == null || boon == null || !pokemon.isPlayer() || overflowStages <= 0) {
    return;
  }
  if (boon.target?.pokemonIds != null && !boon.target.pokemonIds.includes(pokemon.id)) {
    return;
  }
  const persistedValve = getMoodyCoordinatorEffectState("pressure-valve")?.values?.selectedValve;
  const selected =
    persistedValve === "barrier" || persistedValve === "pp" || persistedValve === "healing"
      ? persistedValve
      : boon.target?.option === "barrier" || boon.target?.option === "pp"
        ? boon.target.option
        : "healing";
  const mostUseful =
    pokemon.hp < pokemon.getMaxHp() ? "healing" : pokemon.getMoveset().some(move => move.ppUsed > 0) ? "pp" : "barrier";
  const commands = runGameplay({
    type: "positive-stat-overflow",
    seed: state.seed ^ pokemon.id ^ overflowStages,
    pokemonId: String(pokemon.id),
    overflowStages,
    selectedValve: selected,
    mostUsefulValve: mostUseful,
  });
  for (const command of commands) {
    if (command.kind === "convert-stat-overflow") {
      const amount = commandNumber(command, "amount");
      if (command.data.valve === "barrier") {
        grantMoodyCoordinatorBarrier(pokemon.id, pokemon.getMaxHp() * amount);
      } else if (command.data.valve === "healing") {
        pokemon.hp = Math.min(pokemon.getMaxHp(), pokemon.hp + Math.max(1, Math.floor(pokemon.getMaxHp() * amount)));
        pokemon.updateInfo(true).catch(() => undefined);
      } else if (command.data.valve === "pp") {
        let remaining = Math.floor(amount);
        for (const move of pokemon.getMoveset().toSorted((left, right) => right.ppUsed - left.ppUsed)) {
          const restored = Math.min(move.ppUsed, remaining);
          move.ppUsed -= restored;
          remaining -= restored;
          if (remaining <= 0) {
            break;
          }
        }
      }
    } else if (command.kind === "queue-next-move-power") {
      queueMoodyCoordinatorMovePower(
        pokemon.id,
        commandNumber(command, "multiplier", 1),
        commandNumber(command, "charges"),
      );
    }
  }
}

export function notifyMoodyCoordinatorEnemyStatIncrease(
  enemy: Pokemon,
  stats: readonly number[],
  stages: number,
): void {
  const state = getMoodyModeState();
  if (state == null || !enemy.isEnemy() || stages <= 0 || stats.length === 0) {
    return;
  }
  const target = globalScene.getPlayerField().find(pokemon => pokemon.isActive(true));
  if (target == null) {
    return;
  }
  const command = runGameplay({
    type: "enemy-effect-created",
    seed: state.seed ^ enemy.id ^ stages,
    effectKind: "stat-stage",
    effectData: { stats: [...stats], stages },
    targetPokemonId: String(target.id),
  }).find(candidate => candidate.kind === "copy-enemy-created-effect");
  if (command == null) {
    return;
  }
  globalScene.phaseManager.unshiftNew(
    "StatStageChangePhase",
    target.getBattlerIndex(),
    true,
    stats,
    stages,
    true,
    false,
    false,
  );
  if (command.data.removeFromEnemy === true) {
    for (const stat of stats) {
      enemy.setStatStage(stat, enemy.getStatStage(stat) - stages);
    }
  }
}

export function notifyMoodyCoordinatorEnemyFieldEffect(
  enemy: Pokemon | undefined,
  effectKind: "weather" | "terrain" | "hazard" | "side-condition",
  effectData: Readonly<Record<string, MoodyRuntimeValue>>,
): { readonly copy: boolean; readonly removeFromEnemy: boolean } {
  const state = getMoodyModeState();
  if (state == null || enemy == null || !enemy.isEnemy()) {
    return { copy: false, removeFromEnemy: false };
  }
  const target = globalScene.getPlayerField().find(pokemon => pokemon.isActive(true));
  if (target == null) {
    return { copy: false, removeFromEnemy: false };
  }
  const command = runGameplay({
    type: "enemy-effect-created",
    seed: state.seed ^ enemy.id ^ (globalScene.currentBattle?.turn ?? 0),
    effectKind,
    effectData,
    targetPokemonId: String(target.id),
  }).find(candidate => candidate.kind === "copy-enemy-created-effect");
  return {
    copy: command != null,
    removeFromEnemy: command?.data.removeFromEnemy === true,
  };
}

export function isMoodyAutomaticBiomeHealingEnabled(): boolean {
  const longNight = getMoodyModeState()?.curses.find(curse => curse.curseId === "the-long-night");
  return longNight?.progress?.flags?.automaticBiomeHealingDisabled !== true;
}

export function buildMoodyContractRelicChoices(seed: number, count = 3): ModifierTypeOption[] {
  const score = (kind: string): number => {
    let hash = seed | 0;
    for (let index = 0; index < kind.length; index++) {
      hash = Math.imul(hash ^ kind.charCodeAt(index), 0x45d9f3b);
    }
    return hash >>> 0;
  };
  return [...ER_RELIC_KINDS]
    .sort((left, right) => score(left) - score(right) || left.localeCompare(right))
    .slice(0, Math.max(1, Math.min(count, ER_RELIC_KINDS.length)))
    .map(kind => new ModifierTypeOption(erRelicModifierType(kind), 1));
}

export function applyMoodyCoordinatorRewardOptions(options: ModifierTypeOption[]): ModifierTypeOption[] {
  const state = getMoodyModeState();
  if (state == null) {
    return options;
  }
  resetMoodyCoordinatorLiveCadence("reward-screen");
  runMoodySceneCoordinatorEvent(
    {
      type: "reward-generated",
      seed: state.seed ^ (globalScene.currentBattle?.waveIndex ?? 0),
      slotCount: options.length,
      offerIds: options.map(option => option.type.id),
    },
    options,
  );
  const contractRewards = consumeCurrentMoodyLiveProjection("grantedContractRewards") ?? [];
  for (const reward of contractRewards) {
    if (reward.relicChoice) {
      options.push(
        ...buildMoodyContractRelicChoices(
          state.seed ^ (globalScene.currentBattle?.waveIndex ?? 0) ^ reward.contractId.length,
        ),
      );
      continue;
    }
    const tier =
      reward.tier === "master"
        ? ModifierTier.MASTER
        : reward.tier === "rogue"
          ? ModifierTier.ROGUE
          : ModifierTier.ULTRA;
    const option = getNewModifierTypeOption(globalScene.getPlayerParty(), ModifierPoolType.PLAYER, tier, 0, 0, false);
    if (option != null) {
      options.push(option);
    }
  }
  return options;
}

export interface MoodyRewardReplacementRule {
  readonly disabled: boolean;
  readonly cost: number;
  readonly sacrifices: number;
}

export function getMoodyCoordinatorRecyclerSelectionCount(): number {
  const base = activeBoon("recycler")?.evolutionId === "upcycler" ? 2 : 1;
  const noTakebacks = getMoodyModeState()?.curses.some(curse => curse.curseId === "no-takebacks") === true;
  return base + (noTakebacks ? 1 : 0);
}

export function getMoodyCoordinatorRewardReplacementRule(
  operation: "reroll" | "recycle" | "replace",
  baseCost = 0,
  baseSacrifices = 0,
): MoodyRewardReplacementRule {
  const state = getMoodyModeState();
  if (state == null) {
    return { disabled: false, cost: baseCost, sacrifices: baseSacrifices };
  }
  const result = runMoodySceneCoordinatorEvent({
    type: "reward-replacement-query",
    seed: state.seed ^ baseCost ^ baseSacrifices,
    operation,
    baseCost,
    baseSacrifices,
  });
  return {
    disabled: result?.target.reward.replacementDisabled ?? false,
    cost: result?.target.reward.replacementCost ?? baseCost,
    sacrifices: result?.target.reward.replacementSacrifices ?? baseSacrifices,
  };
}

export function recycleMoodyCoordinatorRewardOptions(
  options: ModifierTypeOption[],
  destroyedIndices: readonly number[],
): boolean {
  const state = getMoodyModeState();
  const recycler = activeBoon("recycler");
  const uniqueDestroyed = [...new Set(destroyedIndices)]
    .filter(index => index >= 0 && index < options.length)
    .toSorted((left, right) => left - right);
  const requiredSacrifices = getMoodyCoordinatorRecyclerSelectionCount();
  if (
    state == null
    || recycler == null
    || recycler.progress?.flags?.recyclerUsedThisScreen === true
    || uniqueDestroyed.length === 0
    || uniqueDestroyed.length !== requiredSacrifices
    || uniqueDestroyed.length >= options.length
    || getMoodyCoordinatorRewardReplacementRule("recycle", 0, uniqueDestroyed.length).disabled
  ) {
    return false;
  }
  const destroyed = new Set(uniqueDestroyed);
  const remainingIndices = options.map((_option, index) => index).filter(index => !destroyed.has(index));
  const result = runMoodySceneCoordinatorEvent(
    {
      type: "reward-recycle",
      seed: state.seed ^ (globalScene.currentBattle?.waveIndex ?? 0) ^ uniqueDestroyed.join(",").length,
      destroyedIndices: uniqueDestroyed,
      remainingIndices,
      originalRarities: options.map(option => option.type.tier),
      destroyedCategory: options[uniqueDestroyed[0]]?.type.id ?? "",
    },
    options,
  );
  if (result == null) {
    return false;
  }
  for (const index of uniqueDestroyed.toSorted((left, right) => right - left)) {
    options.splice(index, 1);
  }
  return true;
}

export function applyMoodyCoordinatorBoonOffers(waveIndex: number): void {
  const state = getMoodyModeState();
  if (state == null) {
    return;
  }
  const offers = getMoodyBoonOffers(waveIndex);
  const target = sceneTarget();
  target.reward.boonOffers = offers.map(offer => ({
    id: offer.offerId,
    setHidden: hidden => {
      if (hidden) {
        concealPendingMoodyBoonOffer(offer.offerId);
      }
    },
  }));
  runMoodyCoordinatorLive(
    {
      type: "reward-generated",
      seed: state.seed ^ waveIndex,
      slotCount: offers.length,
      offerIds: offers.map(offer => offer.offerId),
    },
    target,
  );
}

export function applyMoodyCoordinatorMarketPrice(price: number, isHealingItem: boolean): number {
  const state = getMoodyModeState();
  if (state == null) {
    return price;
  }
  return (
    runMoodySceneCoordinatorEvent(
      {
        type: "market-price-query",
        seed: state.seed ^ price,
        price,
        isHealingItem,
      },
      [],
      price,
    )?.target.market.price ?? price
  );
}

export function canMoodyCoordinatorPayWithBlood(): boolean {
  const bloodMarket = activeBoon("blood-market");
  return bloodMarket != null && bloodMarket.progress?.flags?.bloodMarketUsedThisBiome !== true;
}

export function isMoodyCoordinatorBloodPremiumPurchase(payment: "money" | "blood"): boolean {
  return payment === "blood" && activeBoon("blood-market")?.evolutionId === "blood-premium";
}

export function getMoodyCoordinatorBloodDebtRate(itemTier: number): number {
  const tier = Math.max(0, Math.min(MAX_REWARD_TIER, Math.floor(itemTier)));
  return Math.min(0.18, 0.06 + tier * 0.03);
}

export interface MoodyBloodDebtPreviewEntry {
  readonly pokemonId: number;
  readonly pokemonName: string;
  readonly hpDebt: number;
}

export function getMoodyCoordinatorBloodDebtPreview(itemTier: number): readonly MoodyBloodDebtPreviewEntry[] {
  const boon = activeBoon("blood-market");
  if (boon == null) {
    return [];
  }
  const party = globalScene.getPlayerParty();
  const byId = new Map(party.map(pokemon => [String(pokemon.id), pokemon]));
  const debtorCount = boon.evolutionId === "split-bill" ? 2 : 1;
  const debtors = moodyUsageRanking(party, true)
    .slice(0, debtorCount)
    .flatMap(pokemonId => {
      const pokemon = byId.get(pokemonId);
      return pokemon == null ? [] : [pokemon];
    });
  const multiplier = (boon.rank >= 2 ? 0.75 : 1) * (boon.evolutionId === "blood-premium" ? 1.5 : 1);
  return debtors.map(pokemon => ({
    pokemonId: pokemon.id,
    pokemonName: pokemon.getNameToRender(),
    hpDebt: Math.ceil((pokemon.getMaxHp() * getMoodyCoordinatorBloodDebtRate(itemTier) * multiplier) / debtors.length),
  }));
}

export function getMoodyCoordinatorHpDebt(pokemonId: number): number {
  const debts = getMoodyCoordinatorEffectState("blood-market")?.values?.bloodDebts;
  if (!Array.isArray(debts)) {
    return 0;
  }
  return debts.reduce((total, raw) => {
    if (raw == null || Array.isArray(raw) || typeof raw !== "object" || String(raw.pokemonId) !== String(pokemonId)) {
      return total;
    }
    const debt = Number(raw.hpDebt);
    return total + (Number.isFinite(debt) ? Math.max(0, Math.floor(debt)) : 0);
  }, 0);
}

export function getMoodyCoordinatorMaxHpMultiplier(pokemon?: Pokemon): number {
  const fraction = Number(getMoodyCoordinatorEffectState("bench-academy")?.values?.teamMaxHpFraction ?? 0);
  const academy = 1 + (Number.isFinite(fraction) ? Math.max(0, fraction) : 0);
  return academy * (pokemon == null ? 1 : getMoodyCoordinatorPartyModifiers(pokemon).maxHpMultiplier);
}

export function notifyMoodyCoordinatorMarketPurchase(
  itemTier: number,
  payment: "money" | "blood" = "money",
): { readonly enhancedPurchase: boolean } {
  const state = getMoodyModeState();
  if (state == null) {
    return { enhancedPurchase: false };
  }
  const party = globalScene.getPlayerParty();
  const result = runMoodySceneCoordinatorEvent({
    type: "market-purchase",
    seed: state.seed ^ itemTier ^ (globalScene.currentBattle?.waveIndex ?? 0),
    itemTier,
    payment,
    debtRate: getMoodyCoordinatorBloodDebtRate(itemTier),
    usageRanking: moodyUsageRanking(party, true),
    maxHpByPokemon: Object.fromEntries(party.map(pokemon => [String(pokemon.id), pokemon.getMaxHp()])),
  });
  return { enhancedPurchase: result?.target.market.enhancedPurchase === true };
}

function moodyRecruiterEncounterId(target: Pokemon): string {
  return `wild:${target.id}`;
}

function applyMoodyRecruiterTrait(target: Pokemon, trait: string, eggMoveSlotsUsed: { value: number }): void {
  const abilityIndex = /^ability:(\d+)$/.exec(trait)?.[1];
  if (abilityIndex != null) {
    target.abilityIndex = Number(abilityIndex);
    return;
  }
  const nature = /^nature:(\d+)$/.exec(trait)?.[1];
  if (nature != null) {
    target.setNature(Number(nature) as Nature);
    target.calculateStats();
    return;
  }
  const eggMove = /^egg-move:(\d+):(\d+)$/.exec(trait);
  if (eggMove == null) {
    return;
  }
  const moveId = Number(eggMove[2]) as MoveId;
  if (target.getMoveset().some(move => move.moveId === moveId)) {
    return;
  }
  const slot = Math.max(
    0,
    Math.min(target.getMaxMoveCount() - 1, target.getMoveset().length - 1 - eggMoveSlotsUsed.value),
  );
  target.setMove(slot, moveId);
  eggMoveSlotsUsed.value++;
}

export function applyMoodyCoordinatorCapture(
  target: Pokemon,
  plan: MoodyRecruiterTraitPlan,
): MoodyRecruiterEncounterResult {
  const state = getMoodyModeState();
  const encounterId = moodyRecruiterEncounterId(target);
  if (state == null) {
    return { encounterId, guaranteedTraits: [], catchRateMultiplier: 1 };
  }
  const eggMoveSlotsUsed = { value: 0 };
  const result = runMoodySceneCoordinatorEvent(
    {
      type: "wild-encounter-generated",
      seed: state.seed ^ target.id,
      missingTraits: plan.missingTraits,
      traitRarity: plan.traitRarity,
      completionistCatchMultiplier: 1.15,
    },
    [],
    0,
    {
      encounterId,
      guaranteedTraits: [],
      catchRateMultiplier: 1,
      addGuaranteedTrait: trait => applyMoodyRecruiterTrait(target, trait, eggMoveSlotsUsed),
      multiplyCatchRate: () => undefined,
    },
  );
  return {
    encounterId,
    guaranteedTraits: [...(result?.target.capture.guaranteedTraits ?? [])],
    catchRateMultiplier: result?.target.capture.catchRateMultiplier ?? 1,
  };
}

export function applyMoodyCoordinatorWildEncounter(target: Pokemon): MoodyRecruiterEncounterResult {
  const rootSpeciesId = target.species.getRootSpeciesId();
  const starterData = globalScene.gameData.starterData[rootSpeciesId];
  const dexData = globalScene.gameData.dexData[rootSpeciesId];
  const eggMoveIds = (speciesEggMoves as Readonly<Record<number, readonly MoveId[]>>)[rootSpeciesId] ?? [];
  const plan = buildMoodyRecruiterTraitPlan(
    {
      abilityAttr: starterData?.abilityAttr ?? 0,
      eggMoveAttr: starterData?.eggMoves ?? 0,
      natureAttr: dexData?.natureAttr ?? 0,
    },
    {
      abilityIds: Array.from({ length: target.species.getAbilityCount() }, (_, index) =>
        target.species.getAbility(index),
      ),
      eggMoveIds,
      natureCount: NATURE_COUNT,
    },
    target.id,
  );
  if (plan.missingTraits.length === 0) {
    return { encounterId: moodyRecruiterEncounterId(target), guaranteedTraits: [], catchRateMultiplier: 1 };
  }
  return applyMoodyCoordinatorCapture(target, plan);
}

export function getMoodyCoordinatorCatchRateMultiplier(target: Pokemon): number {
  return getCurrentMoodyLiveProjection(moodyRecruiterEncounterId(target))?.capture.catchRateMultiplier ?? 1;
}

export async function commitMoodyCoordinatorCaptureSuccess(
  target: Pokemon,
  encounter?: MoodyRecruiterEncounterResult,
  showMessage = false,
): Promise<readonly string[]> {
  encounter ??= {
    encounterId: moodyRecruiterEncounterId(target),
    guaranteedTraits: [
      ...(getCurrentMoodyLiveProjection(moodyRecruiterEncounterId(target))?.capture.guaranteedTraits ?? []),
    ],
    catchRateMultiplier: getMoodyCoordinatorCatchRateMultiplier(target),
  };
  if (encounter.encounterId !== moodyRecruiterEncounterId(target)) {
    return [];
  }
  const rootSpeciesId = target.species.getRootSpeciesId();
  const rootSpecies = getPokemonSpecies(rootSpeciesId);
  const eggMoves = (speciesEggMoves as Readonly<Record<number, readonly MoveId[]>>)[rootSpeciesId] ?? [];
  const committed: string[] = [];
  for (const trait of encounter.guaranteedTraits) {
    const match = /^egg-move:(\d+):(\d+)$/.exec(trait);
    if (match == null) {
      continue;
    }
    const eggMoveIndex = Number(match[1]);
    const moveId = Number(match[2]);
    if (eggMoves[eggMoveIndex] !== moveId) {
      continue;
    }
    if (await globalScene.gameData.setEggMoveUnlocked(rootSpecies, eggMoveIndex, showMessage, showMessage)) {
      committed.push(trait);
    }
  }
  consumeCurrentMoodyLiveProjection("captureTraits", encounter.encounterId);
  return committed;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: lethal interventions must be ordered atomically before normal faint handling resumes.
export function notifyMoodyCoordinatorFaint(target: Pokemon, _source?: Pokemon): boolean {
  const state = getMoodyModeState();
  if (state == null) {
    return false;
  }
  if (target.isPlayer()) {
    if (declinedTimeLoopPokemonIds.delete(target.id)) {
      return false;
    }
    const coordinator = hydrateMoodyCoordinatorState(state);
    const apex = coordinator.effects.find(effect => effect.effectId === "apex-plunder");
    const apexTarget = activeBoon("apex-plunder")?.target?.pokemonIds;
    const apexSegments = Array.isArray(apex?.state?.values?.apexSegments)
      ? apex.state.values.apexSegments.filter((value): value is number => typeof value === "number" && value > 0)
      : [];
    const timeLoop = coordinator.effects.find(effect => effect.effectId === "time-loop");
    const snapshot = timeLoop?.state?.values?.turnSnapshot;
    const snapshotId = String(timeLoop?.state?.values?.turnSnapshotId ?? "");
    const intervention =
      apexSegments.length > 0 && (apexTarget == null || apexTarget.includes(target.id))
        ? "apex"
        : snapshot == null
          ? null
          : "time-loop";
    if (intervention == null) {
      return false;
    }
    const commands = runGameplay({
      type: "lethal-result-preview",
      seed: state.seed ^ target.id ^ (globalScene.currentBattle?.turn ?? 0),
      pokemonId: String(target.id),
      isBossBattle: globalScene.getEnemyParty().some(pokemon => pokemon.isBoss()),
      intervention,
      turnSnapshotId: snapshotId,
      enemyActionIds: [],
    });
    const apexCommand = commands.find(command => command.kind === "consume-apex-segment");
    if (apexCommand != null) {
      target.hp = Math.max(1, Math.floor(target.getMaxHp() * commandNumber(apexCommand, "healFraction", 0.25)));
      target.updateInfo(true).catch(() => undefined);
      return true;
    }
    const rewind = commands.find(command => command.kind === "rewind-turn" || command.kind === "offer-turn-rewind");
    if (rewind == null || snapshot == null) {
      return false;
    }
    if (rewind.kind === "rewind-turn") {
      return restoreMoodyTurnSnapshot(snapshot);
    }
    target.hp = Math.max(1, target.hp);
    globalScene.phaseManager.unshiftPhase(
      new MoodyCoordinatorConfirmPhase(
        "Time Loop can rewind this turn. Rewind?",
        () => restoreMoodyTurnSnapshot(snapshot),
        () => {
          const timeLoopBoon = activeBoon("time-loop");
          const counters = timeLoopBoon?.progress?.counters;
          if (counters != null) {
            counters.segmentUses = Math.max(0, (counters.segmentUses ?? 1) - 1);
          }
          declinedTimeLoopPokemonIds.add(target.id);
          target.hp = 0;
          globalScene.phaseManager.unshiftNew("FaintPhase", target.getBattlerIndex(), true);
        },
      ),
    );
    return true;
  }
  return false;
}

export function notifyMoodyCoordinatorFinalizedFaint(target: Pokemon, source?: Pokemon): void {
  if (getMoodyModeState() == null) {
    return;
  }
  if (!target.isPlayer()) {
    notifyMoodyCoordinatorEnemyDefeated(target, source);
    return;
  }
  updateMoodyBounty(current => ({
    ...current,
    failed: current.failed || current.contractId === "no-allied-faint",
    alliedFaintOccurred: true,
  }));
  if (getMoodyCoordinatorEffectState("mortal-wounds") != null) {
    recordMoodyCoordinatorMortalWound(target.id);
  }
  notifyMoodyCoordinatorPairMemberFainted(target);
}

export function notifyMoodyCoordinatorHealingUsed(pokemon: Pokemon, amount: number): void {
  if (!pokemon.isPlayer() || amount <= 0 || getMoodyModeState() == null) {
    return;
  }
  updateMoodyBounty(current => ({ ...current, healingUsed: true }));
}

/** Records coordinator effects only after all faint-prevention and instant-revive checks have failed. */
export function notifyMoodyCoordinatorEnemyDefeated(target: Pokemon, source?: Pokemon): void {
  const state = getMoodyModeState();
  if (state == null || target.isPlayer()) {
    return;
  }
  if (source?.isPlayer()) {
    updateMoodyBounty(current => {
      const pokemonId = String(source.id);
      const kos = (current.koByPokemon[pokemonId] ?? 0) + 1;
      return {
        ...current,
        failed: current.failed || (current.contractId === "one-ko-each" && kos > 1),
        koByPokemon: { ...current.koByPokemon, [pokemonId]: kos },
      };
    });
  }
  const seed = state.seed ^ target.id ^ (globalScene.currentBattle?.turn ?? 0);
  const hunter = state.boons.find(boon => boon.boonId === "hunter-s-mark" && !boon.dormant);
  runMoodySceneCoordinatorEvent({
    type: "typed-enemy-defeated",
    seed,
    matchesMarkedType: hunter?.target?.pokemonType != null && target.getTypes().includes(hunter.target.pokemonType),
    bossSegments: 0,
  });
  if (target.isBoss() && (target as Pokemon & { bossSegments: number }).bossSegments > 1) {
    const apex = activeBoon("apex-plunder");
    if (apex != null) {
      const stored = getMoodyCoordinatorEffectState("apex-plunder")?.values?.apexSegments;
      const storedCount = Array.isArray(stored) ? stored.length : 0;
      const capacity = apex.evolutionId === "segment-hoard" ? 2 : 1;
      if (storedCount < capacity) {
        const existingTarget = apex.target?.pokemonIds?.[0];
        if (existingTarget != null && storedCount > 0) {
          runMoodySceneCoordinatorEvent({ type: "segmented-boss-defeated", seed, pokemonId: String(existingTarget) });
        } else {
          globalScene.phaseManager.unshiftPhase(
            new MoodyCoordinatorPokemonChoicePhase(
              "APEX PLUNDER",
              "Steal this boss's extra HP segment for the selected Pokemon.",
              (pokemonId, partySlot) => {
                apex.target = { pokemonIds: [pokemonId], partySlots: [partySlot] };
                runMoodySceneCoordinatorEvent({ type: "segmented-boss-defeated", seed, pokemonId: String(pokemonId) });
              },
            ),
          );
        }
      }
    }
  }
  const enemies = globalScene.getEnemyParty();
  const rosterDefeated = enemies.every(pokemon => pokemon === target || pokemon.isFainted(true));
  if (rosterDefeated) {
    runMoodySceneCoordinatorEvent({ type: "boss-final-pokemon-fainted", seed, pokemonId: String(target.id) });
    if (globalScene.currentBattle?.trainer?.config.isBoss) {
      runMoodySceneCoordinatorEvent({
        type: "boss-roster-defeated",
        seed,
        pokemonIds: enemies.map(pokemon => String(pokemon.id)),
      });
    }
  }
}
