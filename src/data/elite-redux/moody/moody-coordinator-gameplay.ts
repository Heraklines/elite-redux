import {
  hydrateMoodyCoordinatorState,
  type MoodyCoordinatorState,
  persistMoodyCoordinatorState,
} from "#data/elite-redux/moody/moody-runtime-coordinator";
import { recordMoodyRuntimeActionTriggers } from "#data/elite-redux/moody/moody-runtime-field-engine";
import {
  applyMoodyRuntimeStateDeltas,
  type MoodyRuntimeCommand,
  type MoodyRuntimeEvent,
  type MoodyRuntimeValue,
  resolveMoodyRuntimeEffect,
} from "#data/elite-redux/moody/moody-runtime-meta";
import { getMoodyModeSaveData, getMoodyModeState } from "#data/elite-redux/moody/moody-state";
import type { MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";

type RuntimeRecord = Readonly<Record<string, MoodyRuntimeValue>>;
type StringMap = Readonly<Record<string, readonly string[]>>;

export type MoodyGameplayEvent =
  | {
      readonly type: "consumable-activated";
      readonly seed: number;
      readonly itemStackId: string;
      readonly activationIndex: number;
      readonly isSelectedStack: boolean;
      readonly roll: number;
      readonly extendedChance: number;
    }
  | {
      readonly type: "item-rule-query";
      readonly seed: number;
      readonly itemStackId: string;
      readonly isSelectedStack: boolean;
    }
  | {
      readonly type: "party-composition-query";
      readonly seed: number;
      readonly uniqueTypeCount: number;
      readonly matchingContributors: number;
      readonly consciousCount: number;
      readonly allConsciousMatch: boolean;
      readonly moveMatchesType: boolean;
      readonly incomingMatchesType: boolean;
      readonly firstDamagingMove: boolean;
      readonly firstSuperEffectiveHit: boolean;
    }
  | {
      readonly type: "pokemon-stat-query";
      readonly seed: number;
      readonly pokemonId: string;
      readonly levelGap: number;
      readonly fullyEvolved: boolean;
      readonly enemyAboveLevel: boolean;
      readonly caughtUp: boolean;
    }
  | { readonly type: "pokemon-evolved"; readonly seed: number; readonly pokemonId: string }
  | { readonly type: "pair-query"; readonly seed: number; readonly bothConscious: boolean }
  | { readonly type: "direct-pair-switch"; readonly seed: number; readonly pokemonId: string }
  | {
      readonly type: "pair-member-fainted";
      readonly seed: number;
      readonly fallenPokemonId: string;
      readonly survivorPokemonId: string;
      readonly eligibleMoveIds: readonly string[];
    }
  | {
      readonly type: "experience-query";
      readonly seed: number;
      readonly pokemonId: string;
      readonly levelGap: number;
      readonly isLowest: boolean;
      readonly isSecondLowest: boolean;
    }
  | { readonly type: "academy-graduated"; readonly seed: number }
  | {
      readonly type: "boss-segment-broken";
      readonly seed: number;
      readonly pokemonId: string;
      readonly turn: number;
    }
  | {
      readonly type: "lethal-result-preview";
      readonly seed: number;
      readonly pokemonId: string;
      readonly isBossBattle: boolean;
      readonly intervention: "apex" | "time-loop";
      readonly turnSnapshotId: string;
      readonly enemyActionIds: readonly string[];
    }
  | {
      readonly type: "allied-damaging-action";
      readonly seed: number;
      readonly pokemonId: string;
      readonly action: RuntimeRecord;
    }
  | { readonly type: "move-failed"; readonly seed: number; readonly pokemonId: string; readonly reason: string }
  | {
      readonly type: "allied-move-committed";
      readonly seed: number;
      readonly pokemonId: string;
      readonly actionId: string;
      readonly targetActionId: string;
    }
  | {
      readonly type: "battle-start";
      readonly seed: number;
      readonly turn: number;
      readonly occupiedParty: readonly string[];
      readonly compatibleAbilityIdsByPokemon: StringMap;
    }
  | {
      readonly type: "adjacent-direct-switch";
      readonly seed: number;
      readonly turn: number;
      readonly pokemonId: string;
      readonly compatibleAbilityIds: readonly string[];
      readonly compatibleAbilityIdsByPokemon: StringMap;
    }
  | {
      readonly type: "enemy-effect-created";
      readonly seed: number;
      readonly effectKind: string;
      readonly effectData: MoodyRuntimeValue;
      readonly targetPokemonId: string;
    }
  | {
      readonly type: "turn-start";
      readonly seed: number;
      readonly turn: number;
      readonly turnSnapshotId: string;
      readonly snapshot: MoodyRuntimeValue;
    }
  | {
      readonly type: "direct-hit-preview";
      readonly seed: number;
      readonly turn: number;
      readonly pokemonId: string;
    }
  | {
      readonly type: "type-effectiveness-query";
      readonly seed: number;
      readonly direction: "outgoing" | "incoming";
      readonly effectiveness: number;
      readonly pokemonId: string;
    }
  | {
      readonly type: "prebattle-commit";
      readonly seed: number;
      readonly enemyRoster: readonly MoodyRuntimeValue[];
      readonly enemyLead: MoodyRuntimeValue;
      readonly committedActions: readonly MoodyRuntimeValue[];
      readonly visibleLeadData: MoodyRuntimeValue;
    }
  | {
      readonly type: "positive-stat-overflow";
      readonly seed: number;
      readonly pokemonId: string;
      readonly overflowStages: number;
      readonly selectedValve: "barrier" | "healing" | "pp";
      readonly mostUsefulValve: "barrier" | "healing" | "pp";
    }
  | {
      readonly type: "move-selection-query";
      readonly seed: number;
      readonly pokemonId: string;
      readonly moveId: string;
      readonly sealedMoveIds: readonly string[];
      readonly isFirstUsableMove: boolean;
    };

export type MoodyGameplayCommandKind =
  | "preserve-item-stack"
  | "repeat-consumable-effect"
  | "override-item-restrictions"
  | "apply-party-modifiers"
  | "apply-monotype-oath"
  | "apply-pokemon-growth"
  | "apply-all-stat-multiplier"
  | "reassign-growth-ring"
  | "apply-pair-damage"
  | "heal-incoming-partner"
  | "transfer-random-positive-stage"
  | "boost-pair-survivor"
  | "borrow-eligible-move"
  | "apply-experience-multiplier"
  | "increase-team-max-hp"
  | "offer-partial-vitamin-transfer"
  | "heal-pokemon"
  | "grant-temporary-damage"
  | "restore-total-pp"
  | "rewind-turn"
  | "offer-turn-rewind"
  | "replay-spectral-actions"
  | "empower-pocket-turn"
  | "grant-temporary-abilities"
  | "copy-enemy-created-effect"
  | "set-ethereal-turn"
  | "modify-direct-damage"
  | "consume-apex-segment"
  | "override-type-effectiveness"
  | "lock-enemy-opening-actions"
  | "convert-stat-overflow"
  | "queue-next-move-power"
  | "apply-negative-space";

export interface MoodyGameplayCommand {
  readonly effectId: string;
  readonly kind: MoodyGameplayCommandKind;
  readonly data: RuntimeRecord;
}

export interface MoodyGameplayResolution {
  readonly save: MoodyModeSaveData;
  readonly commands: readonly MoodyGameplayCommand[];
  readonly triggeredEffectIds: readonly string[];
}

export type MoodyGameplayExecutors = {
  readonly [K in MoodyGameplayCommandKind]: (
    command: Extract<MoodyGameplayCommand, { kind: K }> | MoodyGameplayCommand,
  ) => void | Promise<void>;
};

const GAMEPLAY_COMMAND_KINDS = new Set<MoodyGameplayCommandKind>([
  "preserve-item-stack",
  "repeat-consumable-effect",
  "override-item-restrictions",
  "apply-party-modifiers",
  "apply-monotype-oath",
  "apply-pokemon-growth",
  "apply-all-stat-multiplier",
  "reassign-growth-ring",
  "apply-pair-damage",
  "heal-incoming-partner",
  "transfer-random-positive-stage",
  "boost-pair-survivor",
  "borrow-eligible-move",
  "apply-experience-multiplier",
  "increase-team-max-hp",
  "offer-partial-vitamin-transfer",
  "heal-pokemon",
  "grant-temporary-damage",
  "restore-total-pp",
  "rewind-turn",
  "offer-turn-rewind",
  "replay-spectral-actions",
  "empower-pocket-turn",
  "grant-temporary-abilities",
  "copy-enemy-created-effect",
  "set-ethereal-turn",
  "modify-direct-damage",
  "consume-apex-segment",
  "override-type-effectiveness",
  "lock-enemy-opening-actions",
  "convert-stat-overflow",
  "queue-next-move-power",
  "apply-negative-space",
]);

const EFFECTS_BY_EVENT: Readonly<Record<MoodyGameplayEvent["type"], readonly string[]>> = {
  "consumable-activated": ["warranty"],
  "item-rule-query": ["contraband-slot"],
  "party-composition-query": ["diversity-charter", "monotype-oath"],
  "pokemon-stat-query": ["underdog-dividend", "growth-ring"],
  "pokemon-evolved": ["growth-ring"],
  "pair-query": ["pair-bond"],
  "direct-pair-switch": ["pair-bond"],
  "pair-member-fainted": ["pair-bond"],
  "experience-query": ["bench-academy"],
  "academy-graduated": ["bench-academy"],
  "boss-segment-broken": ["bossbreaker"],
  "lethal-result-preview": ["time-loop", "apex-plunder"],
  "allied-damaging-action": ["recapitulation"],
  "move-failed": ["pocket-turn"],
  "allied-move-committed": ["pocket-turn"],
  "battle-start": ["ability-carousel"],
  "adjacent-direct-switch": ["ability-carousel"],
  "enemy-effect-created": ["mirror-theft"],
  "turn-start": ["phase-shift", "time-loop", "ability-carousel"],
  "direct-hit-preview": ["phase-shift"],
  "type-effectiveness-query": ["inversion-window"],
  "prebattle-commit": ["borrowed-future"],
  "positive-stat-overflow": ["pressure-valve"],
  "move-selection-query": ["negative-space"],
};

function runtimeEvent(event: MoodyGameplayEvent): MoodyRuntimeEvent {
  const { type: kind, seed, ...data } = event;
  return { kind, seed, data } as unknown as MoodyRuntimeEvent;
}

function actionPokemonId(event: MoodyGameplayEvent): number | null {
  const value =
    "pokemonId" in event
      ? event.pokemonId
      : "survivorPokemonId" in event
        ? event.survivorPokemonId
        : "targetPokemonId" in event
          ? event.targetPokemonId
          : null;
  if (value == null) {
    return null;
  }
  const pokemonId = Number(value);
  return Number.isSafeInteger(pokemonId) ? pokemonId : null;
}

function decodeGameplayCommand(effectId: string, command: MoodyRuntimeCommand): MoodyGameplayCommand {
  if (!GAMEPLAY_COMMAND_KINDS.has(command.kind as MoodyGameplayCommandKind)) {
    throw new Error(`Moody gameplay coordinator has no executor for ${effectId}:${command.kind}`);
  }
  return { effectId, kind: command.kind as MoodyGameplayCommandKind, data: command.data };
}

export function coordinateMoodyGameplayEvent(
  save: MoodyModeSaveData,
  event: MoodyGameplayEvent,
): MoodyGameplayResolution {
  const state = hydrateMoodyCoordinatorState(save);
  const activeBoonIds = new Set(save.boons.filter(boon => !boon.dormant).map(boon => boon.boonId));
  const acceptedEffects = new Set(
    event.type === "lethal-result-preview"
      ? [event.intervention === "apex" ? "apex-plunder" : "time-loop"]
      : EFFECTS_BY_EVENT[event.type],
  );
  const commands: MoodyGameplayCommand[] = [];
  const triggeredEffectIds: string[] = [];
  const routed = runtimeEvent(event);
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one effect fold owns the atomic durable state transition for every closed gameplay event.
  const effects: MoodyCoordinatorState["effects"] = state.effects.map(effect => {
    if (save.boons.some(boon => boon.boonId === effect.effectId) && !activeBoonIds.has(effect.effectId)) {
      return effect;
    }
    if (!acceptedEffects.has(effect.effectId)) {
      return effect;
    }
    const resolution = resolveMoodyRuntimeEffect(effect.effectId, effect.stage, routed, effect.state ?? {});
    if (resolution.commands.length > 0 || resolution.stateDeltas.length > 0) {
      triggeredEffectIds.push(effect.effectId);
    }
    commands.push(...resolution.commands.map(command => decodeGameplayCommand(effect.effectId, command)));
    const nextState = applyMoodyRuntimeStateDeltas(effect.state ?? {}, resolution.stateDeltas);
    if (effect.effectId === "time-loop" && event.type === "turn-start") {
      return {
        ...effect,
        state: {
          ...nextState,
          values: {
            ...nextState.values,
            turnSnapshotId: event.turnSnapshotId,
            turnSnapshot: event.snapshot,
          },
        },
      };
    }
    if (effect.effectId === "ability-carousel") {
      if (event.type === "turn-start") {
        const expiresAt = Number(nextState.values?.carouselExpiresAt ?? Number.MAX_SAFE_INTEGER);
        if (event.turn >= expiresAt) {
          return {
            ...effect,
            state: {
              ...nextState,
              values: { ...nextState.values, carouselAssignments: [], carouselExpiresAt: 0 },
            },
          };
        }
      }
      const carousel = resolution.commands.find(command => command.kind === "grant-temporary-abilities");
      if (carousel != null && (event.type === "battle-start" || event.type === "adjacent-direct-switch")) {
        return {
          ...effect,
          state: {
            ...nextState,
            values: {
              ...nextState.values,
              carouselAssignments: carousel.data.assignments ?? [],
              carouselExpiresAt: event.turn + Number(carousel.data.durationTurns ?? 1),
            },
          },
        };
      }
    }
    if (effect.effectId === "bossbreaker" && event.type === "boss-segment-broken") {
      const damage = resolution.commands.find(command => command.kind === "grant-temporary-damage");
      if (damage != null) {
        return {
          ...effect,
          state: {
            ...nextState,
            values: {
              ...nextState.values,
              temporaryDamagePokemonId: event.pokemonId,
              temporaryDamageMultiplier: damage.data.multiplier ?? 1,
              temporaryDamageExpiresAt: event.turn + Number(damage.data.turns ?? 0),
            },
          },
        };
      }
    }
    if (effect.effectId === "pressure-valve" && event.type === "positive-stat-overflow") {
      return {
        ...effect,
        state: {
          ...nextState,
          values: {
            ...nextState.values,
            selectedValve: event.selectedValve,
          },
        },
      };
    }
    if (effect.effectId === "warranty" && event.type === "consumable-activated") {
      return {
        ...effect,
        state: {
          ...nextState,
          counters: {
            ...nextState.counters,
            activationsThisBattle: Math.max(nextState.counters?.activationsThisBattle ?? 0, event.activationIndex),
          },
        },
      };
    }
    return { ...effect, state: nextState };
  });
  return {
    save: persistMoodyCoordinatorState(save, { effects }),
    commands,
    triggeredEffectIds: [...new Set(triggeredEffectIds)],
  };
}

function commitGameplayState(save: MoodyModeSaveData): void {
  const live = getMoodyModeState() as MoodyModeSaveData | null;
  if (live == null) {
    return;
  }
  live.boons = structuredClone(save.boons);
  live.curses = structuredClone(save.curses);
}

export function runMoodyGameplayEvent(event: MoodyGameplayEvent): MoodyGameplayResolution | null {
  const save = getMoodyModeSaveData();
  if (save == null) {
    return null;
  }
  const resolution = coordinateMoodyGameplayEvent(save, event);
  commitGameplayState(resolution.save);
  const pokemonId = actionPokemonId(event);
  if (pokemonId != null) {
    recordMoodyRuntimeActionTriggers(pokemonId, resolution.triggeredEffectIds);
  }
  return resolution;
}

export async function executeMoodyGameplayCommands(
  commands: readonly MoodyGameplayCommand[],
  executors: MoodyGameplayExecutors,
): Promise<void> {
  for (const command of commands) {
    await executors[command.kind](command as never);
  }
}

export const MOODY_GAMEPLAY_PRODUCTION_EVENTS = Object.freeze(
  Object.keys(EFFECTS_BY_EVENT),
) as readonly MoodyGameplayEvent["type"][];
