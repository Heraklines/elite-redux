import { globalScene } from "#app/global-scene";
import type { BattlerTag } from "#data/battler-tags";
import { allAbilities, allMoves } from "#data/data-lists";
import { MOODY_BOONS, MOODY_CURSES } from "#data/elite-redux/moody/moody-catalog.generated";
import { getMoodyEffectFlyoutCue, shouldShowMoodyEffectFlyout } from "#data/elite-redux/moody/moody-effect-flyout";
import {
  type MoodyRuntimeCommand,
  type MoodyRuntimeCommandKind,
  type MoodyRuntimeFieldEvent,
  type MoodyRuntimeFieldResult,
  type MoodyRuntimeFieldSnapshot,
  type MoodyRuntimeFieldState,
  type MoodyRuntimeStatus,
  resolveMoodyRuntimeField,
} from "#data/elite-redux/moody/moody-runtime-field";
import {
  consumeMoodyRuntimeActionTriggerIds,
  deserializeMoodyRuntimeFieldState,
  didMoodyDamageCrossHpFraction,
  MOODY_RUNTIME_COMMAND_KINDS,
  type MoodyLivePokemonReader,
  MoodyRuntimeFieldEventAdapter,
  recordMoodyRuntimeActionTriggerIds,
  resetMoodyRuntimeFieldState,
  serializeMoodyRuntimeFieldState,
} from "#data/elite-redux/moody/moody-runtime-field-adapter";
import {
  concealPendingMoodyBoonOffer,
  getMoodyModeState,
  setMoodyBoonDormancy,
  setMoodyRuntimeFieldSaveData,
} from "#data/elite-redux/moody/moody-state";
import type { MoodyModeSaveData } from "#data/elite-redux/moody/moody-types";
import { TerrainType } from "#data/terrain";
import type { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { ArenaTagType } from "#enums/arena-tag-type";
import { BattleType } from "#enums/battle-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { ErMoveId } from "#enums/er-move-id";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { BATTLE_STATS, type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { MoodyRuntimeChoicePhase } from "#phases/moody-runtime-choice-phase";

const commandKinds = (...kinds: MoodyRuntimeCommandKind[]): ReadonlySet<MoodyRuntimeCommandKind> => new Set(kinds);

const PASSIVE_OVERLAP: Readonly<Record<string, ReadonlySet<MoodyRuntimeCommandKind>>> = Object.freeze({
  "prismatic-opening": commandKinds("modify-damage"),
  "chromatic-relay": commandKinds("modify-damage"),
  "climate-contrarian": commandKinds("modify-damage"),
  "weather-wake": commandKinds("modify-damage"),
  "adrenal-condition": commandKinds("modify-damage"),
  "toxic-bloom": commandKinds("modify-damage"),
  "insomniac-dreams": commandKinds("allow-move-while-asleep", "modify-priority"),
  "frostbound-time": commandKinds("modify-damage"),
  "misery-loves-company": commandKinds("modify-damage", "modify-priority"),
  "damage-ceiling": commandKinds("cap-damage"),
  "layered-armor": commandKinds("modify-damage"),
  "type-tax": commandKinds("modify-damage"),
  "slow-to-warm": commandKinds("modify-damage", "modify-speed"),
  "accumulated-fatigue": commandKinds("modify-damage"),
  "withering-pp": commandKinds("consume-extra-pp"),
  "brittle-weakness": commandKinds("modify-damage"),
  "reverse-snowball": commandKinds("apply-enemy-stat-multiplier"),
});

export const MOODY_RUNTIME_PASSIVE_OVERLAP = Object.freeze(
  Object.fromEntries(Object.entries(PASSIVE_OVERLAP).map(([effectId, kinds]) => [effectId, Object.freeze([...kinds])])),
);

export function isMoodyRuntimeCommandOwnedByPassive(command: MoodyRuntimeCommand): boolean {
  return PASSIVE_OVERLAP[command.effectId]?.has(command.kind) === true;
}

export type MoodyRuntimeCommandConsumer =
  | "damage-calculation"
  | "move-resolution"
  | "status-attempt"
  | "volatile-attempt"
  | "phase-execution"
  | "weather-choice"
  | "terrain-choice"
  | "temporary-loadout"
  | "switch-attempt"
  | "lead-selection"
  | "encounter-generation"
  | "battle-information"
  | "boon-draft"
  | "state-delta";

export const MOODY_RUNTIME_COMMAND_CONSUMERS = {
  "modify-damage": "damage-calculation",
  "cap-damage": "damage-calculation",
  "split-damage": "damage-calculation",
  "set-move-type": "move-resolution",
  "ignore-weather-penalty": "move-resolution",
  "treat-as-weather-boosted": "move-resolution",
  "modify-priority": "move-resolution",
  "modify-speed": "move-resolution",
  "modify-stat": "phase-execution",
  "ignore-burn-attack-penalty": "move-resolution",
  "modify-burn-damage": "damage-calculation",
  "allow-move-while-asleep": "move-resolution",
  "shorten-status": "status-attempt",
  "prevent-status": "status-attempt",
  "apply-status": "phase-execution",
  "cure-status": "phase-execution",
  "prevent-volatile": "volatile-attempt",
  "shorten-volatile": "volatile-attempt",
  "clear-negative-stages": "phase-execution",
  "clear-volatiles": "phase-execution",
  "apply-barrier": "phase-execution",
  "decay-barrier": "phase-execution",
  heal: "phase-execution",
  "restore-pp": "phase-execution",
  "consume-extra-pp": "move-resolution",
  "typeless-damage": "phase-execution",
  "nonlethal-damage": "phase-execution",
  "request-weather-choice": "weather-choice",
  "request-terrain-choice": "terrain-choice",
  "set-weather": "phase-execution",
  "apply-directional-screen": "phase-execution",
  "carry-field-state": "phase-execution",
  "modify-field-strength": "move-resolution",
  "guarantee-secondary-effect": "move-resolution",
  "increase-secondary-chance": "move-resolution",
  "ignore-defense-fraction": "damage-calculation",
  "grant-temporary-move": "temporary-loadout",
  "request-temporary-move-choice": "temporary-loadout",
  "grant-temporary-ability": "temporary-loadout",
  "execute-committed-move": "phase-execution",
  revive: "phase-execution",
  "lock-switching": "switch-attempt",
  "prevent-switch": "switch-attempt",
  "invalidate-lead": "lead-selection",
  "hide-enemy-information": "battle-information",
  "set-enemy-roster-size": "encounter-generation",
  "set-counter-weight": "encounter-generation",
  "apply-enemy-stat-multiplier": "encounter-generation",
  "set-boon-dormancy": "phase-execution",
  "conceal-boon-offer": "boon-draft",
  "replace-move-temporarily": "temporary-loadout",
  "reset-toxic-counter": "phase-execution",
  "schedule-damage-debt": "state-delta",
  "collect-damage-debt": "phase-execution",
  "queue-next-move-power": "move-resolution",
  "mark-trigger": "state-delta",
} as const satisfies Record<MoodyRuntimeCommandKind, MoodyRuntimeCommandConsumer>;

export const MOODY_RUNTIME_DEFERRED_COMMAND_HOOKS = {
  "modify-damage": "applyMoodyRuntimeBeforeDamage",
  "cap-damage": "applyMoodyRuntimeBeforeDamage",
  "split-damage": "applyMoodyRuntimeBeforeDamage",
  "set-move-type": "consumeMoveResolution",
  "ignore-weather-penalty": "consumeMoveResolution",
  "treat-as-weather-boosted": "consumeMoveResolution",
  "modify-priority": "consumeMoveResolution",
  "modify-speed": "consumeMoveResolution",
  "ignore-burn-attack-penalty": "consumeMoveResolution",
  "modify-burn-damage": "applyMoodyRuntimeBeforeDamage",
  "allow-move-while-asleep": "consumeMoveResolution",
  "request-weather-choice": "scheduleInteractiveCommands",
  "request-terrain-choice": "scheduleInteractiveCommands",
  "modify-field-strength": "consumeMoveResolution",
  "guarantee-secondary-effect": "consumeMoveResolution",
  "increase-secondary-chance": "consumeMoveResolution",
  "ignore-defense-fraction": "applyMoodyRuntimeBeforeDamage",
  "request-temporary-move-choice": "scheduleInteractiveCommands",
  "execute-committed-move": "queueMoodyRuntimeCommittedMove",
  "invalidate-lead": "enforceMoodyRuntimeLead",
  "hide-enemy-information": "prepareMoodyRuntimeEncounter",
  "set-enemy-roster-size": "prepareMoodyRuntimeEncounter",
  "set-counter-weight": "prepareMoodyRuntimeEncounter",
  "apply-enemy-stat-multiplier": "prepareMoodyRuntimeEncounter",
  "conceal-boon-offer": "notifyMoodyRuntimeBoonDraft",
  "queue-next-move-power": "consumeMoveResolution",
} as const satisfies Partial<Record<MoodyRuntimeCommandKind, string>>;

export const MOODY_RUNTIME_EVENT_HOOKS = {
  "battle-start": "MovePhase.start/ensureBattleStart",
  "battle-end": "BattleEndPhase.start",
  entry: "SwitchPhase.start",
  "before-move": "MovePhase.start",
  "move-resolved": "MovePhase.end",
  "before-damage": "Pokemon.calculateDamage",
  "after-damage": "Pokemon.damageAndUpdate",
  heal: "Pokemon.heal",
  "status-attempt": "Pokemon.trySetStatus",
  "status-applied": "Pokemon.doSetStatus",
  "status-cured": "Pokemon.clearStatus",
  "volatile-attempt": "Pokemon.addTag",
  "volatile-applied": "Pokemon.addTag",
  "weather-transition": "Arena.trySetWeather",
  "barrier-ended": "Moody barrier damage consumer",
  "turn-start": "TurnInitPhase.start",
  "turn-end": "TurnEndPhase.start",
  "action-resolved": "MovePhase.end",
  faint: "FaintPhase.start",
  ko: "FaintPhase.start",
  "switch-attempt": "SwitchPhase.start",
  "lead-selection": "EncounterPhase.start",
  "battle-won": "VictoryPhase.start",
  "biome-transition": "NewBattlePhase.start",
  "encounter-generate": "EncounterPhase.runEncounter",
  "boon-draft": "SelectMoodyBoonPhase.start",
} as const satisfies Record<MoodyRuntimeFieldEvent["kind"], string>;

const consumerKinds = new Set(Object.keys(MOODY_RUNTIME_COMMAND_CONSUMERS));
if (
  MOODY_RUNTIME_COMMAND_KINDS.some(kind => !consumerKinds.has(kind))
  || consumerKinds.size !== MOODY_RUNTIME_COMMAND_KINDS.length
) {
  throw new Error("Moody runtime command consumer registry is not exact");
}

export interface MoodyRuntimeExecutionPort<TPokemon> {
  getPokemon(id: number): TPokemon | undefined;
  id(pokemon: TPokemon): number;
  resolveTargets(command: MoodyRuntimeCommand): readonly TPokemon[];
  side(pokemon: TPokemon): "player" | "enemy";
  currentHp?(pokemon: TPokemon): number;
  maxHp(pokemon: TPokemon): number;
  heal(pokemon: TPokemon, amount: number): void;
  damage(pokemon: TPokemon, amount: number, nonlethal: boolean): void;
  restorePp(pokemon: TPokemon, amount: number, moveId?: string, distribution?: "most-depleted"): void;
  consumePp(pokemon: TPokemon, amount: number, moveId?: string): void;
  applyStatus(pokemon: TPokemon, status: MoodyRuntimeStatus): void;
  cureStatus(pokemon: TPokemon): void;
  clearNegativeStages(pokemon: TPokemon, amount: number, categoryChoice: boolean): void;
  modifyStat(pokemon: TPokemon, stat: string, stages: number): void;
  revive(
    pokemon: TPokemon,
    fraction: number,
    extraHealthSegments?: number,
    allStatStages?: number,
    clearStatusAndNegativeStages?: boolean,
  ): void;
  setWeather(weather: string, turns?: number): void;
  setTerrain(terrain: string, turns?: number): void;
  shortenStatus(pokemon: TPokemon, status: string, turns: number): void;
  shortenVolatile(pokemon: TPokemon, volatile: string, turns: number): void;
  clearVolatiles(pokemon: TPokemon): void;
  applyDirectionalScreen(pokemon: TPokemon, category: string, turns: number, multiplier: number): void;
  carryFieldState(serializedFields: readonly string[], turns: number): void;
  grantTemporaryMove(pokemon: TPokemon, moveId: string, pp: number): void;
  grantTemporaryAbility(pokemon: TPokemon, abilityId: string): void;
  replaceMoveTemporarily(pokemon: TPokemon, moveId: string, replacementMoveId: string): void;
  resetToxicCounter(pokemon: TPokemon, stage: number): void;
  setBoonDormancy(instanceIds: readonly string[], dormant: boolean): void;
}

export interface MoodyRuntimeExecutionResult {
  readonly state: MoodyRuntimeFieldState;
  readonly preventedStatusPokemonIds: ReadonlySet<number>;
  readonly preventedSwitchPokemonIds: ReadonlySet<number>;
  readonly deferredCommands: readonly MoodyRuntimeCommand[];
  readonly executedCommands: readonly MoodyRuntimeCommand[];
  readonly skippedPassiveCommands: readonly MoodyRuntimeCommand[];
}

export interface MoodyRuntimePendingConsumption {
  readonly state: MoodyRuntimeFieldState;
  readonly commands: readonly MoodyRuntimeCommand[];
}

export interface MoodyFaintFieldObservation {
  readonly intervene: () => boolean;
  readonly finalize: () => void;
}

export function resolveMoodyFaintLaneOrder(hooks: {
  readonly field: () => MoodyFaintFieldObservation;
  readonly formation: () => void;
  readonly coordinator: () => boolean;
}): "field" | "coordinator" | null {
  const fieldObservation = hooks.field();
  hooks.formation();
  const coordinatorIntervened = hooks.coordinator();
  if (coordinatorIntervened) {
    return "coordinator";
  }
  return fieldObservation.intervene() ? "field" : null;
}

export function consumeMoodyRuntimePendingCommands(
  initialState: MoodyRuntimeFieldState,
  currentBattleId: string,
  consumer: MoodyRuntimeCommandConsumer,
  subjectId?: number,
): MoodyRuntimePendingConsumption {
  const key = `${currentBattleId}:pending:${consumer}`;
  const pending = initialState.lists[key] ?? [];
  const commands: MoodyRuntimeCommand[] = [];
  const remaining: string[] = [];
  for (const serialized of pending) {
    const command = JSON.parse(serialized) as MoodyRuntimeCommand;
    if (MOODY_RUNTIME_COMMAND_CONSUMERS[command.kind] !== consumer) {
      throw new Error(`Moody runtime command ${command.kind} reached the wrong consumer ${consumer}`);
    }
    const applies =
      subjectId == null
      || command.subjectId === subjectId
      || command.targetIds?.includes(subjectId) === true
      || (command.subjectId == null && command.targetIds == null);
    if (applies) {
      if (subjectId != null && command.targetIds != null && command.targetIds.length > 1) {
        commands.push({ ...command, targetIds: [subjectId] });
        const remainingTargetIds = command.targetIds.filter(id => id !== subjectId);
        if (remainingTargetIds.length > 0) {
          remaining.push(JSON.stringify({ ...command, targetIds: remainingTargetIds }));
        }
      } else {
        commands.push(command);
      }
    } else {
      remaining.push(serialized);
    }
  }
  return {
    state: {
      ...initialState,
      lists: { ...initialState.lists, [key]: remaining },
    },
    commands,
  };
}

const barrierKey = (battleId: string, pokemonId: number): string =>
  `${battleId}:runtime-barrier:pokemon:${pokemonId}:amount`;
const barrierAbsorbedKey = (battleId: string, pokemonId: number): string =>
  `${battleId}:runtime-barrier:pokemon:${pokemonId}:last-absorbed`;
const barrierExpiryKey = (battleId: string, pokemonId: number): string =>
  `${battleId}:runtime-barrier:pokemon:${pokemonId}:expires`;
const barrierTagKey = (battleId: string, pokemonId: number): string =>
  `${battleId}:runtime-barrier:pokemon:${pokemonId}:tag`;
const barrierStatusBlockKey = (battleId: string, pokemonId: number): string =>
  `${battleId}:runtime-barrier:pokemon:${pokemonId}:blocks-next-status`;

const MOODY_NEGATIVE_VOLATILES = new Set<BattlerTagType>([
  BattlerTagType.CONFUSED,
  BattlerTagType.INFATUATED,
  BattlerTagType.SEEDED,
  BattlerTagType.NIGHTMARE,
  BattlerTagType.ENCORE,
  BattlerTagType.TRAPPED,
  BattlerTagType.CURSED,
  BattlerTagType.DISABLED,
  BattlerTagType.HEAL_BLOCK,
  BattlerTagType.TORMENT,
  BattlerTagType.TAUNT,
  BattlerTagType.ER_BLEED,
  BattlerTagType.ER_FROSTBITE,
  BattlerTagType.ER_FEAR,
  BattlerTagType.ER_DESPAIR,
  BattlerTagType.ER_DRENCHED,
]);

export function cureMoodyStatusImmediately(pokemon: Pick<Pokemon, "resetStatus">): void {
  pokemon.resetStatus(false, false, false, false);
}

export function restoreMoodyPp(
  moves: readonly { ppUsed: number; getMovePp(): number }[],
  amount: number,
  distribution?: "most-depleted",
): void {
  if (distribution === "most-depleted") {
    let remaining = amount;
    for (const move of moves.toSorted(
      (left, right) => right.ppUsed / Math.max(1, right.getMovePp()) - left.ppUsed / Math.max(1, left.getMovePp()),
    )) {
      const restored = Math.min(move.ppUsed, remaining);
      move.ppUsed -= restored;
      remaining -= restored;
      if (remaining <= 0) {
        break;
      }
    }
    return;
  }
  moves.forEach(move => {
    move.ppUsed = Math.max(0, move.ppUsed - amount);
  });
}

function commandPokemonIds(command: MoodyRuntimeCommand): readonly number[] {
  const targetIds = command.targetIds;
  if (targetIds != null && targetIds.length > 0) {
    return targetIds;
  }
  return command.subjectId == null ? [] : [command.subjectId];
}

function commandAmount<TPokemon>(
  command: MoodyRuntimeCommand,
  pokemon: TPokemon,
  port: MoodyRuntimeExecutionPort<TPokemon>,
): number {
  if (command.amount != null) {
    return Math.max(0, Math.floor(command.amount));
  }
  const basis =
    command.data?.basis === "current-hp" ? (port.currentHp?.(pokemon) ?? port.maxHp(pokemon)) : port.maxHp(pokemon);
  return Math.max(0, Math.floor(basis * (command.fraction ?? 0)));
}

export function executeMoodyRuntimeCommands<TPokemon>(
  commands: readonly MoodyRuntimeCommand[],
  initialState: MoodyRuntimeFieldState,
  battleId: string,
  port: MoodyRuntimeExecutionPort<TPokemon>,
): MoodyRuntimeExecutionResult {
  const numbers = { ...initialState.numbers };
  const lists = Object.fromEntries(Object.entries(initialState.lists).map(([key, value]) => [key, [...value]]));
  const preventedStatusPokemonIds = new Set<number>();
  const preventedSwitchPokemonIds = new Set<number>();
  const deferredCommands: MoodyRuntimeCommand[] = [];
  const executedCommands: MoodyRuntimeCommand[] = [];
  const skippedPassiveCommands: MoodyRuntimeCommand[] = [];
  const defer = (command: MoodyRuntimeCommand): void => {
    const consumer = MOODY_RUNTIME_COMMAND_CONSUMERS[command.kind];
    if (consumer == null) {
      throw new Error(`Moody runtime command has no registered consumer: ${command.kind}`);
    }
    if (!(command.kind in MOODY_RUNTIME_DEFERRED_COMMAND_HOOKS)) {
      throw new Error(`Moody runtime deferred command has no live hook: ${command.kind}`);
    }
    const key = `${battleId}:pending:${consumer}`;
    lists[key] = [...(lists[key] ?? []), JSON.stringify(command)];
    deferredCommands.push(command);
  };

  for (const command of commands) {
    if (isMoodyRuntimeCommandOwnedByPassive(command)) {
      skippedPassiveCommands.push(command);
      continue;
    }
    const targets = port.resolveTargets(command);
    switch (command.kind) {
      case "prevent-status":
        commandPokemonIds(command).forEach(id => preventedStatusPokemonIds.add(id));
        executedCommands.push(command);
        break;
      case "prevent-switch":
      case "lock-switching":
        commandPokemonIds(command).forEach(id => preventedSwitchPokemonIds.add(id));
        executedCommands.push(command);
        break;
      case "heal":
        targets.forEach(pokemon =>
          port.heal(
            pokemon,
            commandAmount(command, pokemon, port) / (command.data?.distributeEvenly === true ? targets.length : 1),
          ),
        );
        executedCommands.push(command);
        break;
      case "typeless-damage":
      case "nonlethal-damage":
        targets.forEach(pokemon =>
          port.damage(pokemon, commandAmount(command, pokemon, port), command.kind === "nonlethal-damage"),
        );
        executedCommands.push(command);
        break;
      case "collect-damage-debt":
        targets.forEach(pokemon => {
          let amount = commandAmount(command, pokemon, port);
          if (command.data?.barriersMayAbsorb === true) {
            const key = barrierKey(battleId, port.id(pokemon));
            const absorbed = Math.min(numbers[key] ?? 0, amount);
            numbers[key] = Math.max(0, (numbers[key] ?? 0) - absorbed);
            amount -= absorbed;
          }
          if (amount > 0) {
            port.damage(pokemon, amount, false);
          }
        });
        executedCommands.push(command);
        break;
      case "restore-pp":
        targets.forEach(pokemon =>
          port.restorePp(
            pokemon,
            Math.max(0, Math.floor(command.amount ?? 1)),
            command.value?.toString(),
            command.data?.distribution === "most-depleted" ? "most-depleted" : undefined,
          ),
        );
        executedCommands.push(command);
        break;
      case "consume-extra-pp":
        targets.forEach(pokemon =>
          port.consumePp(pokemon, Math.max(0, Math.floor(command.amount ?? 1)), command.value?.toString()),
        );
        executedCommands.push(command);
        break;
      case "apply-status":
        if (typeof command.value === "string") {
          targets.forEach(pokemon => port.applyStatus(pokemon, command.value as MoodyRuntimeStatus));
        }
        executedCommands.push(command);
        break;
      case "cure-status":
        targets.forEach(pokemon => port.cureStatus(pokemon));
        executedCommands.push(command);
        break;
      case "clear-negative-stages":
        targets.forEach(pokemon =>
          port.clearNegativeStages(
            pokemon,
            command.amount ?? Number.MAX_SAFE_INTEGER,
            command.data?.categoryChoice === true,
          ),
        );
        executedCommands.push(command);
        break;
      case "modify-stat":
        targets.forEach(pokemon => port.modifyStat(pokemon, String(command.value ?? "attack"), command.amount ?? 0));
        executedCommands.push(command);
        break;
      case "revive":
        targets.forEach(pokemon =>
          port.revive(
            pokemon,
            command.fraction ?? 0.25,
            Number(command.data?.healthSegments ?? 0),
            Number(command.data?.allStats ?? 0),
            command.data?.clearStatusAndNegativeStages === true
              || command.data?.clearNegativeStages === true
              || command.data?.clearMajorStatus === true,
          ),
        );
        executedCommands.push(command);
        break;
      case "set-weather":
        if (typeof command.value === "string") {
          port.setWeather(command.value, command.durationTurns);
        }
        executedCommands.push(command);
        break;
      case "apply-barrier":
        for (const pokemon of targets) {
          const id = port.id(pokemon);
          const key = barrierKey(battleId, id);
          const capFraction = Number(command.data?.capMaxHpFraction);
          const convertsOverflow = command.data?.overflowToHealingAndPower === true;
          const cap = Number.isFinite(capFraction)
            ? port.maxHp(pokemon) * capFraction
            : convertsOverflow
              ? port.maxHp(pokemon)
              : Number.POSITIVE_INFINITY;
          const total = Math.max(0, (numbers[key] ?? 0) + commandAmount(command, pokemon, port));
          numbers[key] = Math.min(cap, total);
          if (convertsOverflow && total > cap) {
            const overflow = total - cap;
            const hpBefore = port.currentHp?.(pokemon) ?? port.maxHp(pokemon);
            port.heal(pokemon, overflow);
            const healed = Math.max(0, (port.currentHp?.(pokemon) ?? hpBefore) - hpBefore);
            const powerOverflow = Math.max(0, overflow - healed);
            if (powerOverflow > 0) {
              const powerKey = `${battleId}:runtime-action:pokemon:${id}:next-power`;
              numbers[powerKey] = Math.max(
                numbers[powerKey] ?? 1,
                1 + Math.min(0.5, powerOverflow / Math.max(1, port.maxHp(pokemon))),
              );
            }
          }
          numbers[barrierExpiryKey(battleId, id)] =
            command.durationTurns == null
              ? Number.MAX_SAFE_INTEGER
              : (globalScene?.currentBattle?.turn ?? 0) + command.durationTurns;
          if (typeof command.value === "string") {
            lists[barrierTagKey(battleId, id)] = [command.value];
          }
          if (command.data?.blocksNextStatus === true) {
            numbers[barrierStatusBlockKey(battleId, id)] = 1;
          }
        }
        executedCommands.push(command);
        break;
      case "decay-barrier":
        for (const pokemon of targets) {
          const id = port.id(pokemon);
          const key = barrierKey(battleId, id);
          const floorFraction = Number(command.data?.onlyAboveMaxHpFraction);
          const floor = Number.isFinite(floorFraction) ? port.maxHp(pokemon) * floorFraction : 0;
          const decay = command.amount ?? port.maxHp(pokemon) * (command.fraction ?? 1);
          const current = numbers[key] ?? 0;
          numbers[key] = current <= floor ? current : Math.max(floor, current - decay);
        }
        executedCommands.push(command);
        break;
      case "shorten-status":
        targets.forEach(pokemon => port.shortenStatus(pokemon, String(command.value ?? ""), command.amount ?? 1));
        executedCommands.push(command);
        break;
      case "shorten-volatile":
        targets.forEach(pokemon => port.shortenVolatile(pokemon, String(command.value ?? ""), command.amount ?? 1));
        executedCommands.push(command);
        break;
      case "clear-volatiles":
        targets.forEach(pokemon => port.clearVolatiles(pokemon));
        executedCommands.push(command);
        break;
      case "apply-directional-screen":
        targets.forEach(pokemon => {
          const category = String(command.value ?? "physical");
          const side = port.side(pokemon);
          numbers[`${battleId}:directional-screen:${side}:${category}:turns`] = Math.max(
            numbers[`${battleId}:directional-screen:${side}:${category}:turns`] ?? 0,
            command.durationTurns ?? 1,
          );
          numbers[`${battleId}:directional-screen:${side}:${category}:multiplier`] = command.multiplier ?? 0.75;
          port.applyDirectionalScreen(pokemon, category, command.durationTurns ?? 1, command.multiplier ?? 0.75);
        });
        executedCommands.push(command);
        break;
      case "carry-field-state":
        port.carryFieldState(command.options ?? [], command.durationTurns ?? 1);
        executedCommands.push(command);
        break;
      case "grant-temporary-move":
        if (typeof command.value === "string") {
          targets.forEach(pokemon => port.grantTemporaryMove(pokemon, command.value as string, command.amount ?? 1));
        }
        executedCommands.push(command);
        break;
      case "grant-temporary-ability":
        if (typeof command.value === "string") {
          targets.forEach(pokemon => port.grantTemporaryAbility(pokemon, command.value as string));
        }
        executedCommands.push(command);
        break;
      case "replace-move-temporarily": {
        const replacement = command.data?.replacementMoveId;
        if (typeof command.value === "string" && typeof replacement === "string") {
          targets.forEach(pokemon => port.replaceMoveTemporarily(pokemon, command.value as string, replacement));
        }
        executedCommands.push(command);
        break;
      }
      case "reset-toxic-counter":
        targets.forEach(pokemon => port.resetToxicCounter(pokemon, command.amount ?? 1));
        executedCommands.push(command);
        break;
      case "set-boon-dormancy":
        port.setBoonDormancy(command.options ?? [], command.value === true);
        executedCommands.push(command);
        break;
      case "prevent-volatile":
        executedCommands.push(command);
        break;
      case "request-weather-choice":
      case "request-terrain-choice":
      case "request-temporary-move-choice":
      case "execute-committed-move":
      case "invalidate-lead":
      case "hide-enemy-information":
      case "set-enemy-roster-size":
      case "set-counter-weight":
      case "conceal-boon-offer":
        defer(command);
        break;
      default:
        if (MOODY_RUNTIME_COMMAND_CONSUMERS[command.kind] === "state-delta") {
          executedCommands.push(command);
        } else {
          defer(command);
        }
        break;
    }
  }
  return {
    state: { ...initialState, numbers, lists },
    preventedStatusPokemonIds,
    preventedSwitchPokemonIds,
    deferredCommands,
    executedCommands,
    skippedPassiveCommands,
  };
}

function statusFromPokemon(pokemon: Pokemon): MoodyRuntimeStatus | undefined {
  if (pokemon.getTag(BattlerTagType.ER_FROSTBITE)) {
    return "frostbite";
  }
  switch (pokemon.status?.effect) {
    case StatusEffect.BURN:
      return "burn";
    case StatusEffect.POISON:
      return "poison";
    case StatusEffect.TOXIC:
      return "toxic";
    case StatusEffect.PARALYSIS:
      return "paralysis";
    case StatusEffect.SLEEP:
      return "sleep";
    default:
      return;
  }
}

function statusToEngine(status: MoodyRuntimeStatus): StatusEffect {
  switch (status) {
    case "burn":
      return StatusEffect.BURN;
    case "poison":
      return StatusEffect.POISON;
    case "toxic":
      return StatusEffect.TOXIC;
    case "paralysis":
      return StatusEffect.PARALYSIS;
    case "sleep":
      return StatusEffect.SLEEP;
    case "frostbite":
      return StatusEffect.FREEZE;
  }
}

const SCENE_READER: MoodyLivePokemonReader<Pokemon> = {
  id: pokemon => pokemon.id,
  side: pokemon => (pokemon.isPlayer() ? "player" : "enemy"),
  partySlot: pokemon => {
    const party: readonly Pokemon[] = pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
    return Math.max(0, party.indexOf(pokemon));
  },
  currentHp: pokemon => pokemon.hp,
  maxHp: pokemon => pokemon.getMaxHp(),
  fainted: pokemon => pokemon.isFainted(true),
  status: statusFromPokemon,
  grounded: pokemon => pokemon.isGrounded(),
  moveIds: pokemon => pokemon.getMoveset().map(move => String(move.moveId)),
  eligibleMoveIds: pokemon =>
    pokemon
      .getMoveset()
      .filter(
        move => (move.isUsable as (candidate: Pokemon, ignorePp?: boolean) => [boolean, string])(pokemon, true)[0],
      )
      .map(move => String(move.moveId)),
  compatibleAbilityIds: pokemon => pokemon.getActiveAbilitySources().map(source => String(source.ability.id)),
  types: pokemon => pokemon.getTypes(false, false).map(String),
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function battleId(): string {
  const battle = globalScene.currentBattle;
  if (battle == null) {
    return "prebattle";
  }
  return `${battle.waveIndex}:${battle.battleSeed}`;
}

function createPokemonMove(
  pokemon: Pokemon,
  moveId: MoveId,
  ppUsed = 0,
  ppUp = 0,
  maxPpOverride?: number,
): ReturnType<Pokemon["getMoveset"]>[number] {
  const template = pokemon.getMoveset()[0];
  if (template == null) {
    throw new Error(`Cannot create a Moody temporary move for Pokemon ${pokemon.id} without a moveset`);
  }
  const PokemonMoveConstructor = template.constructor as new (
    moveId: MoveId,
    ppUsed?: number,
    ppUp?: number,
    maxPpOverride?: number,
  ) => ReturnType<Pokemon["getMoveset"]>[number];
  return new PokemonMoveConstructor(moveId, ppUsed, ppUp, maxPpOverride);
}

const ACTIVE_MOODY_ACTION_IDS = new Map<number, string>();
const EMITTED_MOODY_UI_TRIGGERS = new Map<string, Set<string>>();
let emittedMoodyUiBattleId = "";

export function getMoodyRuntimeTriggerLabels(
  state: Pick<MoodyModeSaveData, "boons" | "curses">,
  effectIds: readonly string[],
): readonly string[] {
  const labels: string[] = [];
  for (const effectId of new Set(effectIds)) {
    const boon = state.boons.find(instance => instance.boonId === effectId);
    if (boon != null) {
      const definition = MOODY_BOONS.find(candidate => candidate.id === effectId);
      const evolution = definition?.evolutions.find(candidate => candidate.id === boon.evolutionId);
      const rank = boon.rank === 2 ? " II" : boon.rank === 3 ? " III" : "";
      labels.push(`${evolution?.name ?? definition?.name ?? effectId}${rank}`);
      continue;
    }
    const curse = state.curses.find(instance => instance.curseId === effectId);
    const definition = curse == null ? undefined : MOODY_CURSES.find(candidate => candidate.id === effectId);
    labels.push(definition?.name ?? effectId);
  }
  return labels;
}

function moodyTriggerSubject(event: MoodyRuntimeFieldEvent): string {
  switch (event.kind) {
    case "entry":
      return String(event.pokemon.id);
    case "before-move":
    case "move-resolved":
      return String(event.user.id);
    case "before-damage":
    case "after-damage":
      return `${event.source?.id ?? "field"}:${event.target.id}`;
    case "heal":
    case "status-applied":
    case "status-cured":
    case "volatile-attempt":
    case "volatile-applied":
    case "barrier-ended":
      return String(event.target.id);
    case "status-attempt":
      return `${event.source?.id ?? "field"}:${event.target.id}`;
    case "weather-transition":
      return `${event.activePokemon.id}:${event.previous}:${event.next}`;
    case "action-resolved":
    case "ko":
      return String(event.actor.id);
    case "faint":
      return String(event.pokemon.id);
    case "switch-attempt":
      return String(event.pokemon.id);
    case "lead-selection":
      return String(event.pokemonId);
    default:
      return "global";
  }
}

export function getMoodyRuntimeTriggerResolutionKey(event: MoodyRuntimeFieldEvent, activeActionId?: string): string {
  if ("actionId" in event) {
    return `${event.battleId}:action:${event.actionId}`;
  }
  if (activeActionId != null) {
    return `${event.battleId}:action:${activeActionId}`;
  }
  return `${event.battleId}:turn:${event.turn}:${event.kind}:${moodyTriggerSubject(event)}`;
}

function emitMoodyRuntimeTriggerLabels(
  state: Pick<MoodyModeSaveData, "boons" | "curses">,
  event: MoodyRuntimeFieldEvent,
  effectIds: readonly string[],
): void {
  if (effectIds.length === 0) {
    return;
  }
  if (emittedMoodyUiBattleId !== event.battleId) {
    emittedMoodyUiBattleId = event.battleId;
    EMITTED_MOODY_UI_TRIGGERS.clear();
  }
  const ownerId = actionOwnerId(event);
  const key = getMoodyRuntimeTriggerResolutionKey(
    event,
    ownerId == null ? undefined : ACTIVE_MOODY_ACTION_IDS.get(ownerId),
  );
  const seen = EMITTED_MOODY_UI_TRIGGERS.get(key) ?? new Set<string>();
  const freshIds = effectIds.filter(effectId => shouldShowMoodyEffectFlyout(effectId) && !seen.has(effectId));
  if (freshIds.length === 0) {
    return;
  }
  freshIds.forEach(effectId => seen.add(effectId));
  EMITTED_MOODY_UI_TRIGGERS.set(key, seen);
  for (const effectId of freshIds) {
    const cue = getMoodyEffectFlyoutCue(state, effectId);
    globalScene.ui.pushMoodyTrigger(cue.name, cue);
  }
}

export function createMoodySceneFieldAdapter(): MoodyRuntimeFieldEventAdapter<Pokemon> | null {
  const battle = globalScene.currentBattle;
  const state = getMoodyModeState();
  if (battle == null || state == null) {
    return null;
  }
  const priorCursor = state.fieldRuntime?.cursor;
  const biomeId = globalScene.arena.biomeId;
  const biomeEpoch =
    priorCursor == null ? 0 : priorCursor.biomeId === biomeId ? priorCursor.biomeEpoch : priorCursor.biomeEpoch + 1;
  return new MoodyRuntimeFieldEventAdapter(
    {
      battleId: battleId(),
      waveIndex: battle.waveIndex,
      turn: battle.turn,
      seed: hashString(`${state.seed}:${battle.battleSeed}`),
      isBoss: battle.trainer?.config.isBoss === true || globalScene.getEnemyParty().some(pokemon => pokemon.isBoss()),
      isTrainer: battle.battleType === BattleType.TRAINER,
      biomeId,
      biomeEpoch,
      playerParty: globalScene.getPlayerParty(),
      enemyParty: globalScene.getEnemyParty(),
      playerActive: globalScene.getPlayerField(),
      enemyActive: globalScene.getEnemyField(),
    },
    SCENE_READER,
  );
}

function scenePort(): MoodyRuntimeExecutionPort<Pokemon> {
  const allPokemon = (): Pokemon[] => [...globalScene.getPlayerParty(), ...globalScene.getEnemyParty()];
  const pokemonById = (id: number): Pokemon | undefined => allPokemon().find(pokemon => pokemon.id === id);
  const statByName: Readonly<Record<string, BattleStat>> = {
    attack: Stat.ATK,
    defense: Stat.DEF,
    accuracy: Stat.ACC,
    evasion: Stat.EVA,
    "special-attack": Stat.SPATK,
    "special-defense": Stat.SPDEF,
    speed: Stat.SPD,
  };
  const weatherByName: Readonly<Record<string, WeatherType>> = {
    clear: WeatherType.NONE,
    sun: WeatherType.SUNNY,
    rain: WeatherType.RAIN,
    sand: WeatherType.SANDSTORM,
    snow: WeatherType.SNOW,
    fog: WeatherType.FOG,
  };
  const terrainByName: Readonly<Record<string, TerrainType>> = {
    none: TerrainType.NONE,
    electric: TerrainType.ELECTRIC,
    grassy: TerrainType.GRASSY,
    misty: TerrainType.MISTY,
    psychic: TerrainType.PSYCHIC,
  };
  return {
    getPokemon: pokemonById,
    id: pokemon => pokemon.id,
    resolveTargets: command => {
      const explicit = commandPokemonIds(command)
        .map(pokemonById)
        .filter((pokemon): pokemon is Pokemon => pokemon != null);
      if (explicit.length > 0) {
        return explicit;
      }
      const playerParty = globalScene.getPlayerParty().filter(pokemon => !pokemon.isFainted(true));
      if (command.data?.target === "lowest-hp-benched-ally") {
        return playerParty
          .filter(pokemon => !pokemon.isActive(true))
          .toSorted((left, right) => left.hp / left.getMaxHp() - right.hp / right.getMaxHp())
          .slice(0, 1);
      }
      if (command.data?.target === "lowest-hp-other-ally") {
        const excludedId = Number(command.data?.excludePokemonId ?? command.subjectId);
        return playerParty
          .filter(pokemon => pokemon.id !== excludedId)
          .toSorted((left, right) => left.hp / left.getMaxHp() - right.hp / right.getMaxHp())
          .slice(0, 1);
      }
      const subject = command.subjectId == null ? undefined : pokemonById(command.subjectId);
      return subject == null ? [] : (subject.getAllies().slice(0, 1) as readonly Pokemon[]);
    },
    side: pokemon => (pokemon.isPlayer() ? "player" : "enemy"),
    currentHp: pokemon => pokemon.hp,
    maxHp: pokemon => pokemon.getMaxHp(),
    heal: (pokemon, amount) => {
      const restored = Math.min(Math.max(0, amount), pokemon.getMaxHp() - pokemon.hp);
      pokemon.hp += restored;
      if (restored > 0) {
        pokemon.updateInfo(true);
      }
    },
    damage: (pokemon, amount, nonlethal) => {
      const resolved = nonlethal ? Math.min(amount, Math.max(0, pokemon.hp - 1)) : amount;
      if (resolved > 0) {
        pokemon.damageAndUpdate(resolved);
      }
    },
    restorePp: (pokemon, amount, moveId, distribution) => {
      const moves =
        moveId == null ? pokemon.getMoveset() : pokemon.getMoveset().filter(move => String(move.moveId) === moveId);
      restoreMoodyPp(moves, amount, distribution);
    },
    consumePp: (pokemon, amount, moveId) => {
      const moves =
        moveId == null ? pokemon.getMoveset() : pokemon.getMoveset().filter(move => String(move.moveId) === moveId);
      moves.forEach(move => move.usePp(amount));
    },
    applyStatus: (pokemon, status) => {
      const effect = statusToEngine(status);
      if (pokemon.status == null && pokemon.canSetStatus(effect, true)) {
        pokemon.doSetStatus(effect);
      }
    },
    cureStatus: cureMoodyStatusImmediately,
    clearNegativeStages: (pokemon, amount, categoryChoice) => {
      const negativeStats = BATTLE_STATS.filter(stat => pokemon.getStatStage(stat) < 0);
      const negativeTags = pokemon.summonData.tags.filter(tag => MOODY_NEGATIVE_VOLATILES.has(tag.tagType));
      if (categoryChoice) {
        const stageSeverity = negativeStats.reduce((sum, stat) => sum - pokemon.getStatStage(stat), 0);
        if (stageSeverity >= Math.max(pokemon.status == null ? 0 : 1, negativeTags.length)) {
          negativeStats.forEach(stat => pokemon.setStatStage(stat, 0));
        } else if (negativeTags.length >= (pokemon.status == null ? 0 : 1)) {
          pokemon.findAndRemoveTags(tag => MOODY_NEGATIVE_VOLATILES.has(tag.tagType));
        } else {
          cureMoodyStatusImmediately(pokemon);
        }
        return;
      }
      let remaining = amount;
      for (const stat of negativeStats) {
        while (remaining > 0 && pokemon.getStatStage(stat) < 0) {
          pokemon.setStatStage(stat, pokemon.getStatStage(stat) + 1);
          remaining--;
        }
      }
      if (remaining > 0 && pokemon.status != null) {
        cureMoodyStatusImmediately(pokemon);
        remaining--;
      }
      if (remaining > 0 && negativeTags[0] != null) {
        const selected = negativeTags[0];
        pokemon.findAndRemoveTags(tag => tag === selected);
      }
    },
    modifyStat: (pokemon, stat, stages) => {
      const battleStats = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD] as const;
      if (stat === "all") {
        battleStats.forEach(battleStat => pokemon.setStatStage(battleStat, pokemon.getStatStage(battleStat) + stages));
        return;
      }
      const resolved =
        stat === "highest-offense"
          ? pokemon.getStat(Stat.ATK, false) >= pokemon.getStat(Stat.SPATK, false)
            ? Stat.ATK
            : Stat.SPATK
          : stat === "highest"
            ? battleStats.toSorted((left, right) => pokemon.getStat(right, false) - pokemon.getStat(left, false))[0]
            : stat === "seeded-random"
              ? battleStats[hashString(`${battleId()}:${pokemon.id}`) % battleStats.length]
              : statByName[stat];
      if (resolved != null) {
        pokemon.setStatStage(resolved, pokemon.getStatStage(resolved) + stages);
      }
    },
    revive: (pokemon, fraction, extraHealthSegments = 0, allStatStages = 0, clearStatusAndNegativeStages = false) => {
      if (pokemon.isFainted(true)) {
        pokemon.resetStatus(true, false, false, false);
        pokemon.hp = Math.max(1, Math.floor(pokemon.getMaxHp() * fraction));
        if (extraHealthSegments > 0 && pokemon.isEnemy()) {
          pokemon.setBoss(true, Math.max(2, pokemon.bossSegments + extraHealthSegments));
        }
        if (allStatStages > 0) {
          for (const stat of BATTLE_STATS) {
            pokemon.setStatStage(stat, Math.max(pokemon.getStatStage(stat), allStatStages));
          }
        }
        if (clearStatusAndNegativeStages) {
          pokemon.resetStatus(true, false, false, false);
          for (const stat of BATTLE_STATS) {
            if (pokemon.getStatStage(stat) < 0) {
              pokemon.setStatStage(stat, 0);
            }
          }
        }
        pokemon.updateInfo(true);
      }
    },
    setWeather: (weather, turns) => {
      const resolved = weatherByName[weather];
      if (resolved != null) {
        globalScene.arena.trySetWeather(resolved, undefined, turns);
      }
    },
    setTerrain: (terrain, turns) => {
      const resolved = terrainByName[terrain];
      if (resolved != null) {
        globalScene.arena.trySetTerrain(resolved, false, undefined, turns);
      }
    },
    shortenStatus: (pokemon, status, turns) => {
      if (status === "sleep" && pokemon.status?.effect === StatusEffect.SLEEP) {
        pokemon.status.sleepTurnsRemaining = Math.max(1, (pokemon.status.sleepTurnsRemaining ?? 1) - turns);
      }
    },
    shortenVolatile: (pokemon, volatile, turns) => {
      const tag = pokemon.getTag(Number(volatile) as unknown as BattlerTagType) as BattlerTag | undefined;
      if (tag != null && tag.turnCount > 0) {
        tag.turnCount = Math.max(1, tag.turnCount - turns);
      }
    },
    clearVolatiles: pokemon => {
      pokemon.findAndRemoveTags(tag => MOODY_NEGATIVE_VOLATILES.has(tag.tagType));
    },
    applyDirectionalScreen: () => {
      // The exact multiplier and duration live in persisted fieldRuntime and are consumed by damage calculation.
    },
    carryFieldState: (serializedFields, turns) => {
      for (const serialized of serializedFields) {
        const field = JSON.parse(serialized) as {
          kind: "weather" | "terrain" | "hazard" | "side-condition";
          id: string;
          ownerSide?: "player" | "enemy";
        };
        if (field.kind === "weather") {
          const weather = weatherByName[field.id];
          if (weather != null) {
            globalScene.arena.trySetWeather(weather, undefined, turns);
          }
        } else if (field.kind === "terrain") {
          const terrain = terrainByName[field.id];
          if (terrain != null) {
            globalScene.arena.trySetTerrain(terrain, false, undefined, turns);
          }
        } else {
          const tag = Number(field.id) as unknown as ArenaTagType;
          if (Number.isSafeInteger(tag)) {
            globalScene.arena.addTag(
              tag,
              turns,
              undefined,
              0,
              field.ownerSide === "player" ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY,
              true,
            );
          }
        }
      }
    },
    grantTemporaryMove: (pokemon, moveId, pp) => {
      const resolved = Number(moveId) as MoveId;
      if (allMoves[resolved] == null || pokemon.getMoveset().some(move => move.moveId === resolved)) {
        return;
      }
      const temporary =
        pokemon.summonData.moveset
        ?? pokemon
          .getMoveset()
          .map(move => createPokemonMove(pokemon, move.moveId, move.ppUsed, move.ppUp, move.maxPpOverride));
      if (temporary.length < 8) {
        temporary.push(createPokemonMove(pokemon, resolved, 0, 0, Math.max(1, pp)));
      }
      pokemon.summonData.moveset = temporary;
    },
    grantTemporaryAbility: (pokemon, abilityId) => {
      const ability = allAbilities[Number(abilityId) as AbilityId];
      if (ability != null) {
        pokemon.setTempAbility(ability, true);
      }
    },
    replaceMoveTemporarily: (pokemon, moveId, replacementMoveId) => {
      const original = Number(moveId) as MoveId;
      const replacement = Number(replacementMoveId) as MoveId;
      if (allMoves[replacement] == null) {
        return;
      }
      const temporary =
        pokemon.summonData.moveset
        ?? pokemon
          .getMoveset()
          .map(move => createPokemonMove(pokemon, move.moveId, move.ppUsed, move.ppUp, move.maxPpOverride));
      const index = temporary.findIndex(move => move.moveId === original);
      if (index >= 0) {
        temporary[index] = createPokemonMove(pokemon, replacement);
        globalScene.phaseManager.queueMessage(
          `${pokemon.getNameToRender()}: ${allMoves[original].name} became ${allMoves[replacement].name} until the next biome.`,
        );
      }
      pokemon.summonData.moveset = temporary;
    },
    resetToxicCounter: (pokemon, stage) => {
      if (pokemon.status?.effect === StatusEffect.TOXIC) {
        pokemon.status.toxicTurnCount = Math.max(0, stage - 1);
      }
    },
    setBoonDormancy: (instanceIds, dormant) => setMoodyBoonDormancy(instanceIds, dormant),
  };
}

function cursorFor(event: MoodyRuntimeFieldEvent) {
  const previous = getMoodyModeState()?.fieldRuntime?.cursor;
  const biomeId = globalScene.arena.biomeId;
  return {
    battleId: event.battleId,
    waveIndex: event.waveIndex,
    turn: event.turn,
    segmentIndex: Math.floor(event.waveIndex / 10),
    biomeId,
    biomeEpoch: previous == null ? 0 : previous.biomeId === biomeId ? previous.biomeEpoch : previous.biomeEpoch + 1,
  };
}

function persistRuntimeState(state: MoodyRuntimeFieldState, event?: MoodyRuntimeFieldEvent): void {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter == null) {
    return;
  }
  const cursorEvent = event ?? adapter.turnStart([]);
  setMoodyRuntimeFieldSaveData(serializeMoodyRuntimeFieldState(state, cursorFor(cursorEvent)));
}

function consumeScenePending(
  consumer: MoodyRuntimeCommandConsumer,
  apply: (command: MoodyRuntimeCommand, port: MoodyRuntimeExecutionPort<Pokemon>) => void,
  subjectId?: number,
): readonly MoodyRuntimeCommand[] {
  const save = getMoodyModeState()?.fieldRuntime;
  if (save == null) {
    return [];
  }
  const consumed = consumeMoodyRuntimePendingCommands(
    deserializeMoodyRuntimeFieldState(save),
    battleId(),
    consumer,
    subjectId,
  );
  const port = scenePort();
  consumed.commands.forEach(command => apply(command, port));
  persistRuntimeState(consumed.state);
  return consumed.commands;
}

function actionKey(pokemonId: number, property: string): string {
  return `${battleId()}:runtime-action:pokemon:${pokemonId}:${property}`;
}

const posthumousFaintKey = (pokemonId: number): string => `${battleId()}:runtime-posthumous-faint:${pokemonId}`;

function clearRuntimeAction(pokemonId: number, promoteNext = false): void {
  ACTIVE_MOODY_ACTION_IDS.delete(pokemonId);
  const save = getMoodyModeState()?.fieldRuntime;
  if (save == null) {
    return;
  }
  const state = deserializeMoodyRuntimeFieldState(save);
  const retained = (key: string): boolean =>
    key === actionKey(pokemonId, "next-power")
    || key === actionKey(pokemonId, "next-power-type")
    || key === actionKey(pokemonId, "next-bonus-damage")
    || key === actionKey(pokemonId, "next-bonus-all-enemies");
  const values = Object.fromEntries(
    Object.entries(state.values).filter(([key]) => !key.startsWith(actionKey(pokemonId, "")) || retained(key)),
  );
  const numbers = Object.fromEntries(
    Object.entries(state.numbers).filter(([key]) => !key.startsWith(actionKey(pokemonId, "")) || retained(key)),
  );
  const lists = Object.fromEntries(
    Object.entries(state.lists).filter(([key]) => !key.startsWith(actionKey(pokemonId, ""))),
  );
  if (promoteNext) {
    const nextPower = numbers[actionKey(pokemonId, "next-power")];
    if (nextPower != null) {
      numbers[actionKey(pokemonId, "power")] = nextPower;
      delete numbers[actionKey(pokemonId, "next-power")];
    }
    const nextPowerType = values[actionKey(pokemonId, "next-power-type")];
    if (nextPowerType != null) {
      values[actionKey(pokemonId, "power-type")] = nextPowerType;
      delete values[actionKey(pokemonId, "next-power-type")];
    }
    const nextBonusDamage = numbers[actionKey(pokemonId, "next-bonus-damage")];
    if (nextBonusDamage != null) {
      numbers[actionKey(pokemonId, "bonus-damage")] = nextBonusDamage;
      delete numbers[actionKey(pokemonId, "next-bonus-damage")];
    }
    const nextBonusAllEnemies = values[actionKey(pokemonId, "next-bonus-all-enemies")];
    if (nextBonusAllEnemies != null) {
      values[actionKey(pokemonId, "bonus-all-enemies")] = nextBonusAllEnemies;
      delete values[actionKey(pokemonId, "next-bonus-all-enemies")];
    }
  }
  persistRuntimeState({ ...state, values, numbers, lists });
}

function actionOwnerId(event: MoodyRuntimeFieldEvent): number | undefined {
  switch (event.kind) {
    case "before-move":
    case "move-resolved":
      return event.user.id;
    case "before-damage":
    case "after-damage":
    case "status-attempt":
      return event.source?.id;
    case "ko":
      return event.actor.id;
    default:
      return;
  }
}

export function recordMoodyRuntimeActionTriggers(pokemonId: number, effectIds: readonly string[]): void {
  const state = runtimeState();
  if (state == null || effectIds.length === 0) {
    return;
  }
  persistRuntimeState(recordMoodyRuntimeActionTriggerIds(state, battleId(), pokemonId, effectIds));
}

function consumeMoveResolution(pokemon: Pokemon, queuedForCurrentAction: boolean): void {
  const save = getMoodyModeState()?.fieldRuntime;
  if (save == null) {
    return;
  }
  const consumed = consumeMoodyRuntimePendingCommands(
    deserializeMoodyRuntimeFieldState(save),
    battleId(),
    "move-resolution",
    pokemon.id,
  );
  const numbers = { ...consumed.state.numbers };
  const values = { ...consumed.state.values };
  for (const command of consumed.commands) {
    switch (command.kind) {
      case "set-move-type":
        values[actionKey(pokemon.id, "move-type")] = command.value ?? "";
        break;
      case "modify-priority":
        numbers[actionKey(pokemon.id, "priority")] =
          (numbers[actionKey(pokemon.id, "priority")] ?? 0) + (command.amount ?? 0);
        break;
      case "ignore-weather-penalty":
      case "treat-as-weather-boosted":
      case "ignore-burn-attack-penalty":
      case "allow-move-while-asleep":
      case "guarantee-secondary-effect":
        values[actionKey(pokemon.id, command.kind)] = true;
        break;
      case "modify-field-strength":
      case "increase-secondary-chance":
        numbers[actionKey(pokemon.id, command.kind)] = command.multiplier ?? command.amount ?? 0;
        if (command.kind === "increase-secondary-chance" && (command.durationTurns ?? 0) > 1) {
          numbers[`${battleId()}:runtime-secondary:pokemon:${pokemon.id}:amount`] = command.amount ?? 0;
          numbers[`${battleId()}:runtime-secondary:pokemon:${pokemon.id}:expires`] =
            globalScene.currentBattle.turn + (command.durationTurns ?? 1) - 1;
        }
        break;
      case "queue-next-move-power":
        if (command.data?.typelessBonusDamage === true) {
          numbers[actionKey(pokemon.id, queuedForCurrentAction ? "bonus-damage" : "next-bonus-damage")] =
            command.amount ?? 0;
          values[actionKey(pokemon.id, queuedForCurrentAction ? "bonus-all-enemies" : "next-bonus-all-enemies")] =
            command.data?.allEnemiesReduced === true;
        } else {
          numbers[actionKey(pokemon.id, queuedForCurrentAction ? "power" : "next-power")] = command.multiplier ?? 1;
          if (typeof command.value === "string") {
            values[actionKey(pokemon.id, queuedForCurrentAction ? "power-type" : "next-power-type")] = command.value;
          }
        }
        break;
      case "consume-extra-pp":
        scenePort().consumePp(pokemon, command.amount ?? 1, command.value?.toString());
        break;
      case "modify-speed":
        numbers[actionKey(pokemon.id, "speed")] = command.multiplier ?? 1;
        break;
      default:
        break;
    }
  }
  persistRuntimeState({ ...consumed.state, numbers, values });
}

function scheduleInteractiveCommands(): void {
  for (const consumer of ["weather-choice", "terrain-choice", "temporary-loadout"] as const) {
    consumeScenePending(consumer, command => {
      if (
        command.kind !== "request-weather-choice"
        && command.kind !== "request-terrain-choice"
        && command.kind !== "request-temporary-move-choice"
      ) {
        throw new Error(`Non-choice command ${command.kind} reached MoodyRuntimeChoicePhase`);
      }
      globalScene.phaseManager.unshiftPhase(
        new MoodyRuntimeChoicePhase(command, option => {
          const port = scenePort();
          if (command.kind === "request-weather-choice") {
            port.setWeather(option, command.durationTurns);
          } else if (command.kind === "request-terrain-choice") {
            port.setTerrain(option, command.durationTurns);
          } else {
            const pokemon = command.subjectId == null ? undefined : port.getPokemon(command.subjectId);
            if (pokemon != null) {
              port.grantTemporaryMove(pokemon, option, command.amount ?? 1);
            }
          }
        }),
      );
    });
  }
}

export function resolveMoodySceneFieldEvent(
  event: MoodyRuntimeFieldEvent,
  options: { readonly execute?: boolean; readonly persist?: boolean } = {},
): (MoodyRuntimeFieldResult & { readonly execution: MoodyRuntimeExecutionResult }) | null {
  const modeState = getMoodyModeState();
  if (modeState == null) {
    return null;
  }
  let state = deserializeMoodyRuntimeFieldState(modeState.fieldRuntime);
  const previousBattleId = modeState.fieldRuntime?.cursor.battleId;
  if (previousBattleId !== event.battleId) {
    state = resetMoodyRuntimeFieldState(state, {
      kind: "battle-start",
      battleId: event.battleId,
      waveIndex: event.waveIndex,
      segmentIndex: Math.floor(event.waveIndex / 10),
      biomeEpoch: cursorFor(event).biomeEpoch,
    });
  }
  const result = resolveMoodyRuntimeField({
    ownerSide: "player",
    boons: modeState.boons,
    curses: modeState.curses,
    state,
    event,
  });
  const execution =
    options.execute === false
      ? executeMoodyRuntimeCommands([], result.state, event.battleId, scenePort())
      : executeMoodyRuntimeCommands(result.commands, result.state, event.battleId, scenePort());
  const ownerId = actionOwnerId(event);
  const boonIds = new Set(modeState.boons.map(boon => boon.boonId));
  const actionState =
    options.persist !== false && ownerId != null && event.kind !== "action-resolved"
      ? recordMoodyRuntimeActionTriggerIds(
          execution.state,
          event.battleId,
          ownerId,
          result.triggeredEffectIds.filter(effectId => boonIds.has(effectId)),
        )
      : execution.state;
  if (options.persist !== false) {
    setMoodyRuntimeFieldSaveData(serializeMoodyRuntimeFieldState(actionState, cursorFor(event)));
  }
  if (options.execute !== false && options.persist !== false) {
    emitMoodyRuntimeTriggerLabels(modeState, event, result.triggeredEffectIds);
  }
  return {
    ...result,
    state: actionState,
    execution: { ...execution, state: actionState },
  };
}

function ensureBattleStart(adapter: MoodyRuntimeFieldEventAdapter<Pokemon>): ReadonlySet<number> {
  const currentId = battleId();
  if (getMoodyModeState()?.fieldRuntime?.cursor.battleId === currentId) {
    return new Set();
  }
  const active =
    globalScene.getPlayerField()[0] ?? globalScene.getPlayerParty().find(pokemon => !pokemon.isFainted(true));
  if (active == null) {
    return new Set();
  }
  const modeState = getMoodyModeState();
  if (globalScene.currentBattle.waveIndex % 10 === 0 && modeState != null) {
    setMoodyBoonDormancy(
      modeState.boons.map(boon => boon.instanceId),
      false,
    );
  }
  resolveMoodySceneFieldEvent(adapter.battleStart(active));
  const initialEntries = adapter.initialEntries({
    weatherOptions: ["clear", "sun", "rain", "sand", "snow", "fog"],
    terrainOptions: ["none", "electric", "grassy", "misty", "psychic"],
  });
  initialEntries.forEach(event => resolveMoodySceneFieldEvent(event));
  if (initialEntries.length > 0) {
    scheduleInteractiveCommands();
  }
  return new Set(initialEntries.map(event => event.pokemon.id));
}

export function applyMoodyRuntimeDamageCommandValues(
  amount: number,
  maxHp: number,
  commands: readonly MoodyRuntimeCommand[],
): number {
  let resolved = amount;
  for (const command of commands) {
    if (isMoodyRuntimeCommandOwnedByPassive(command)) {
      continue;
    }
    if (command.kind === "modify-damage") {
      resolved *= command.multiplier ?? 1;
    } else if (command.kind === "cap-damage") {
      resolved = Math.min(resolved, command.amount ?? maxHp * (command.fraction ?? 1));
    } else if (command.kind === "split-damage") {
      resolved *= command.fraction ?? 1;
    } else if (command.kind === "modify-burn-damage") {
      resolved *= command.multiplier ?? 1;
    } else if (command.kind === "ignore-defense-fraction") {
      resolved /= Math.max(0.01, 1 - (command.fraction ?? 0));
    }
  }
  return resolved;
}

function consumeDamageCommandsFor(
  state: MoodyRuntimeFieldState,
  pokemonIds: readonly number[],
): { readonly state: MoodyRuntimeFieldState; readonly commands: readonly MoodyRuntimeCommand[] } {
  let current = state;
  const commands: MoodyRuntimeCommand[] = [];
  for (const pokemonId of new Set(pokemonIds)) {
    const consumed = consumeMoodyRuntimePendingCommands(current, battleId(), "damage-calculation", pokemonId);
    current = consumed.state;
    commands.push(...consumed.commands);
  }
  return { state: current, commands };
}

function runtimeState(): MoodyRuntimeFieldState | null {
  const save = getMoodyModeState()?.fieldRuntime;
  return save == null ? null : deserializeMoodyRuntimeFieldState(save);
}

export function getMoodyRuntimeMoveTypeOverride(user: Pokemon, fallback: PokemonType): PokemonType {
  const value = runtimeState()?.values[actionKey(user.id, "move-type")];
  const resolved = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(resolved) && PokemonType[resolved] != null ? (resolved as PokemonType) : fallback;
}

export function getMoodyRuntimePriorityDelta(user: Pokemon): number {
  return runtimeState()?.numbers[actionKey(user.id, "priority")] ?? 0;
}

export function prepareMoodyRuntimeMoveResolution(user: Pokemon): void {
  consumeMoveResolution(user, true);
}

export function getMoodyRuntimeEnemyStatMultiplier(pokemon: Pokemon): number {
  if (pokemon.isPlayer()) {
    return 1;
  }
  return runtimeState()?.numbers[`${battleId()}:encounter:enemy-stat-multiplier`] ?? 1;
}

export function getMoodyRuntimeSpeedMultiplier(user: Pokemon): number {
  return runtimeState()?.numbers[actionKey(user.id, "speed")] ?? 1;
}

export function canMoodyRuntimeActWhileAsleep(user: Pokemon): boolean {
  return runtimeState()?.values[actionKey(user.id, "allow-move-while-asleep")] === true;
}

export function getMoodyRuntimeCounterWeight(): number {
  return runtimeState()?.numbers[`${battleId()}:encounter:counter-weight`] ?? 1;
}

export function shouldHideMoodyEnemyInformation(field: "moves" | "abilities" | "items" | "boon-targets"): boolean {
  return runtimeState()?.lists[`${battleId()}:encounter:hidden-information`]?.includes(field) === true;
}

export function getMoodyRuntimeSecondaryChanceBonus(user: Pokemon): number {
  const state = runtimeState();
  if (state == null) {
    return 0;
  }
  const persistent =
    (state.numbers[`${battleId()}:runtime-secondary:pokemon:${user.id}:expires`] ?? -1)
    >= globalScene.currentBattle.turn
      ? (state.numbers[`${battleId()}:runtime-secondary:pokemon:${user.id}:amount`] ?? 0)
      : 0;
  return Math.max(persistent, state.numbers[actionKey(user.id, "increase-secondary-chance")] ?? 0);
}

export function shouldMoodyRuntimeGuaranteeSecondary(user: Pokemon): boolean {
  return runtimeState()?.values[actionKey(user.id, "guarantee-secondary-effect")] === true;
}

export function applyMoodyRuntimeBeforeDamage(
  source: Pokemon,
  target: Pokemon,
  move: Move,
  amount: number,
  simulated: boolean,
): number {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter == null) {
    return amount;
  }
  ensureBattleStart(adapter);
  const modeState = getMoodyModeState();
  let state = deserializeMoodyRuntimeFieldState(modeState?.fieldRuntime);
  let pendingDamageCommands: readonly MoodyRuntimeCommand[] = [];
  if (!simulated) {
    const pending = consumeDamageCommandsFor(state, [source.id, target.id]);
    state = pending.state;
    pendingDamageCommands = pending.commands;
    if (modeState != null) {
      setMoodyRuntimeFieldSaveData(
        serializeMoodyRuntimeFieldState(
          state,
          cursorFor(adapter.beforeDamage({ source, target, amount, direct: true })),
        ),
      );
    }
  }
  const key = barrierKey(battleId(), target.id);
  const barrier = state.numbers[key] ?? 0;
  const absorbed = Math.min(barrier, amount);
  const barrierBroke = barrier > 0 && absorbed >= barrier;
  const barrierTag = state.lists[barrierTagKey(battleId(), target.id)]?.[0];
  if (absorbed > 0) {
    state = {
      ...state,
      numbers: {
        ...state.numbers,
        [key]: barrier - absorbed,
        [barrierAbsorbedKey(battleId(), target.id)]: absorbed,
      },
    };
    if (!simulated && modeState != null) {
      setMoodyRuntimeFieldSaveData(
        serializeMoodyRuntimeFieldState(
          state,
          cursorFor(adapter.beforeDamage({ source, target, amount, direct: true })),
        ),
      );
    }
  }
  let resolved = applyMoodyRuntimeDamageCommandValues(
    Math.max(0, amount - absorbed),
    target.getMaxHp(),
    pendingDamageCommands,
  );
  const category = move.category === MoveCategory.PHYSICAL ? "physical" : "special";
  const screenTurns =
    state.numbers[`${battleId()}:directional-screen:${target.isPlayer() ? "player" : "enemy"}:${category}:turns`] ?? 0;
  if (screenTurns > 0) {
    resolved *=
      state.numbers[`${battleId()}:directional-screen:${target.isPlayer() ? "player" : "enemy"}:${category}:multiplier`]
      ?? 1;
  }
  const actionPower = state.numbers[actionKey(source.id, "power")];
  const actionPowerType = state.values[actionKey(source.id, "power-type")];
  if (actionPower != null && (actionPowerType == null || String(source.getMoveType(move)) === actionPowerType)) {
    resolved *= actionPower;
  }
  const hitIndex = Math.max(1, source.turnData.hitCount - source.turnData.hitsLeft + 1);
  if (hitIndex === 1) {
    const bonusDamage = state.numbers[actionKey(source.id, "bonus-damage")] ?? 0;
    const allEnemies = state.values[actionKey(source.id, "bonus-all-enemies")] === true;
    resolved += bonusDamage * (allEnemies ? 0.5 : 1);
  }
  resolved *= state.numbers[actionKey(source.id, "modify-field-strength")] ?? 1;
  if (
    move.category === MoveCategory.PHYSICAL
    && source.status?.effect === StatusEffect.BURN
    && state.values[actionKey(source.id, "ignore-burn-attack-penalty")] === true
  ) {
    resolved *= 2;
  }
  if (state.values[actionKey(source.id, "ignore-weather-penalty")] === true) {
    resolved *= 2;
  }
  if (state.values[actionKey(source.id, "treat-as-weather-boosted")] === true) {
    resolved *= 1.5;
  }
  const event = adapter.beforeDamage({
    source,
    target,
    amount: resolved,
    direct: true,
    category,
    superEffective:
      (target.turnData.moveEffectiveness
        ?? target.getAttackTypeEffectiveness(source.getMoveType(move), { source, move })) > 1,
    poisonDamage: false,
    hitIndex,
    sameOriginatingAction: source.turnData.hitsLeft > 0,
  });
  const result = resolveMoodySceneFieldEvent(event, { execute: !simulated, persist: !simulated });
  if (simulated) {
    resolved = applyMoodyRuntimeDamageCommandValues(resolved, target.getMaxHp(), result?.commands ?? []);
  } else if (result != null) {
    const consumed = consumeDamageCommandsFor(result.state, [source.id, target.id]);
    resolved = applyMoodyRuntimeDamageCommandValues(resolved, target.getMaxHp(), consumed.commands);
    setMoodyRuntimeFieldSaveData(serializeMoodyRuntimeFieldState(consumed.state, cursorFor(event)));
  }
  if (barrierBroke && !simulated) {
    resolveMoodySceneFieldEvent(adapter.barrierEnded(target, true, barrierTag ?? "runtime-barrier"));
  }
  return Math.max(resolved > 0 ? 1 : 0, Math.floor(resolved));
}

export function applyMoodyRuntimeStatusDamage(target: Pokemon, amount: number, status: StatusEffect): number {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter == null) {
    return amount;
  }
  ensureBattleStart(adapter);
  const event = adapter.beforeDamage({
    target,
    amount,
    direct: false,
    poisonDamage: status === StatusEffect.POISON || status === StatusEffect.TOXIC,
  });
  const result = resolveMoodySceneFieldEvent(event);
  if (result == null) {
    return amount;
  }
  const consumed = consumeDamageCommandsFor(result.state, [target.id]);
  const resolved = applyMoodyRuntimeDamageCommandValues(amount, target.getMaxHp(), consumed.commands);
  setMoodyRuntimeFieldSaveData(serializeMoodyRuntimeFieldState(consumed.state, cursorFor(event)));
  return Math.max(0, Math.floor(resolved));
}

export function notifyMoodyRuntimeDamageApplied(
  source: Pokemon | undefined,
  target: Pokemon,
  amount: number,
  direct: boolean,
): void {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter == null) {
    return;
  }
  const state = deserializeMoodyRuntimeFieldState(getMoodyModeState()?.fieldRuntime);
  const absorbedKey = barrierAbsorbedKey(battleId(), target.id);
  const absorbed = state.numbers[absorbedKey] ?? 0;
  const crossedQuarterHp = didMoodyDamageCrossHpFraction({
    hpBefore: Math.min(target.getMaxHp(), target.hp + Math.max(0, amount)),
    hpAfter: target.hp,
    maxHp: target.getMaxHp(),
  });
  resolveMoodySceneFieldEvent(
    adapter.afterDamage({
      ...(source == null ? {} : { source }),
      target,
      direct,
      amount,
      barrierAbsorbed: absorbed,
      hpAfter: target.hp,
      crossedQuarterHp,
    }),
  );
  if (absorbed > 0) {
    const latest = deserializeMoodyRuntimeFieldState(getMoodyModeState()?.fieldRuntime);
    setMoodyRuntimeFieldSaveData(
      serializeMoodyRuntimeFieldState(
        { ...latest, numbers: { ...latest.numbers, [absorbedKey]: 0 } },
        cursorFor(
          adapter.afterDamage({
            ...(source == null ? {} : { source }),
            target,
            direct,
            amount,
            barrierAbsorbed: 0,
            hpAfter: target.hp,
            crossedQuarterHp,
          }),
        ),
      ),
    );
  }
}

export function notifyMoodyRuntimeHeal(target: Pokemon, requested: number, effective: number): void {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter == null) {
    return;
  }
  const party = target.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
  resolveMoodySceneFieldEvent(
    adapter.heal({
      target,
      amount: requested,
      effectiveAmount: effective,
      benchedAllies: party.filter(pokemon => pokemon !== target && !pokemon.isActive(true) && !pokemon.isFainted(true)),
    }),
  );
}

/**
 * Full-HP healing phases normally skip {@link Pokemon.heal}. Overflow mechanics still need that
 * zero-effective heal event so the requested amount can be converted instead of disappearing.
 */
export function shouldMoodyRuntimeProcessFullHpHeal(target: Pokemon): boolean {
  if (!target.isPlayer()) {
    return false;
  }
  const state = getMoodyModeState();
  if (state == null) {
    return false;
  }
  return state.boons.some(boon => {
    if (boon.dormant) {
      return false;
    }
    if (boon.boonId === "shared-cup") {
      return true;
    }
    if (boon.boonId !== "overflow-ward") {
      return false;
    }
    if (boon.evolutionId === "overflow-doctrine") {
      return true;
    }
    const pokemonIds = boon.target?.pokemonIds;
    return pokemonIds == null || pokemonIds.length === 0 || pokemonIds.includes(target.id);
  });
}

export function shouldMoodyRuntimePreventStatus(target: Pokemon, effect: StatusEffect, source?: Pokemon): boolean {
  const adapter = createMoodySceneFieldAdapter();
  const status = effect === StatusEffect.FREEZE ? "frostbite" : statusFromEngine(effect);
  if (adapter == null || status == null) {
    return false;
  }
  const state = runtimeState();
  const statusBlockKey = barrierStatusBlockKey(battleId(), target.id);
  if (
    state != null
    && (state.numbers[barrierKey(battleId(), target.id)] ?? 0) > 0
    && (state.numbers[statusBlockKey] ?? 0) > 0
  ) {
    persistRuntimeState({ ...state, numbers: { ...state.numbers, [statusBlockKey]: 0 } });
    return true;
  }
  const result = resolveMoodySceneFieldEvent(
    adapter.statusAttempt({
      ...(source == null ? {} : { source, legalOnSource: source.canSetStatus(effect, true) }),
      target,
      status,
    }),
  );
  return result?.execution.preventedStatusPokemonIds.has(target.id) === true;
}

function statusFromEngine(effect: StatusEffect): MoodyRuntimeStatus | undefined {
  switch (effect) {
    case StatusEffect.BURN:
      return "burn";
    case StatusEffect.POISON:
      return "poison";
    case StatusEffect.TOXIC:
      return "toxic";
    case StatusEffect.PARALYSIS:
      return "paralysis";
    case StatusEffect.SLEEP:
      return "sleep";
    default:
      return;
  }
}

export function notifyMoodyRuntimeStatusApplied(target: Pokemon, effect: StatusEffect): void {
  const adapter = createMoodySceneFieldAdapter();
  const status = statusFromEngine(effect);
  if (adapter != null && status != null) {
    resolveMoodySceneFieldEvent(adapter.statusApplied(target, status));
  }
}

export function notifyMoodyRuntimeStatusCured(target: Pokemon, effect: StatusEffect): void {
  const adapter = createMoodySceneFieldAdapter();
  const status = statusFromEngine(effect);
  if (adapter != null && status != null) {
    resolveMoodySceneFieldEvent(adapter.statusCured(target, status, target.getAllies()));
  }
}

export function notifyMoodyRuntimeTurnEnd(): void {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter != null) {
    ensureBattleStart(adapter);
    resolveMoodySceneFieldEvent(adapter.turnEnd([...globalScene.getPlayerField(), ...globalScene.getEnemyField()]));
    const state = runtimeState();
    if (state != null) {
      const numbers = { ...state.numbers };
      for (const side of ["player", "enemy"] as const) {
        for (const category of ["physical", "special"] as const) {
          const key = `${battleId()}:directional-screen:${side}:${category}:turns`;
          numbers[key] = Math.max(0, (numbers[key] ?? 0) - 1);
        }
      }
      persistRuntimeState({ ...state, numbers });
    }
    for (const pokemon of [...globalScene.getPlayerParty(), ...globalScene.getEnemyParty()]) {
      const latest = runtimeState();
      if (
        latest != null
        && (latest.numbers[barrierKey(battleId(), pokemon.id)] ?? 0) > 0
        && (latest.numbers[barrierExpiryKey(battleId(), pokemon.id)] ?? Number.MAX_SAFE_INTEGER)
          <= globalScene.currentBattle.turn
      ) {
        persistRuntimeState({
          ...latest,
          numbers: { ...latest.numbers, [barrierKey(battleId(), pokemon.id)]: 0 },
        });
        resolveMoodySceneFieldEvent(
          adapter.barrierEnded(
            pokemon,
            false,
            latest.lists[barrierTagKey(battleId(), pokemon.id)]?.[0] ?? "runtime-barrier",
          ),
        );
      }
    }
  }
}

export function doesMoodyMoveRaiseUserStats(user: Pokemon, move: Move): boolean {
  return move.getAttrs("StatStageChangeAttr").some(attribute => attribute.selfTarget && attribute.getLevels(user) > 0);
}

const MOODY_DREAM_MOVE_IDS: ReadonlySet<number> = new Set([MoveId.DREAM_EATER, ErMoveId.DREAM_INVERSION]);

export function isMoodyDreamTaggedMove(move: Pick<Move, "id">): boolean {
  return MOODY_DREAM_MOVE_IDS.has(move.id);
}

export function notifyMoodyRuntimeBeforeMove(user: Pokemon, target: Pokemon | undefined, move: Move): void {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter == null) {
    return;
  }
  ensureBattleStart(adapter);
  const priorAction = runtimeState();
  if (priorAction != null) {
    persistRuntimeState(consumeMoodyRuntimeActionTriggerIds(priorAction, battleId(), user.id).state);
  }
  consumeMoveResolution(user, true);
  const moveType = user.getMoveType(move);
  const weather = globalScene.arena.weather?.weatherType ?? WeatherType.NONE;
  const weatherWeakens =
    ((weather === WeatherType.RAIN || weather === WeatherType.HEAVY_RAIN) && moveType === PokemonType.FIRE)
    || ((weather === WeatherType.SUNNY || weather === WeatherType.HARSH_SUN) && moveType === PokemonType.WATER);
  const legalBestType =
    target == null
      ? undefined
      : Array.from({ length: PokemonType.FAIRY + 1 }, (_, type) => type as PokemonType).toSorted(
          (left, right) =>
            target.getAttackTypeEffectiveness(right, { source: user, move })
            - target.getAttackTypeEffectiveness(left, { source: user, move }),
        )[0];
  const actionId = `${battleId()}:${globalScene.currentBattle.turn}:${user.id}:${move.id}`;
  ACTIVE_MOODY_ACTION_IDS.set(user.id, actionId);
  resolveMoodySceneFieldEvent(
    adapter.beforeMove({
      user,
      ...(target == null ? {} : { target }),
      moveId: String(move.id),
      moveType: String(moveType),
      category:
        move.category === MoveCategory.PHYSICAL
          ? "physical"
          : move.category === MoveCategory.SPECIAL
            ? "special"
            : "status",
      damaging: move.category !== MoveCategory.STATUS && move.power > 0,
      raisesStats: doesMoodyMoveRaiseUserStats(user, move),
      actionId,
      asleep: user.status?.effect === StatusEffect.SLEEP,
      dreamTagged: isMoodyDreamTaggedMove(move),
      weatherWeakens,
      ...(legalBestType == null ? {} : { legalBestType: String(legalBestType) }),
      ...(target == null
        ? {}
        : { weaknessMultiplier: target.getAttackTypeEffectiveness(moveType, { source: user, move }) }),
    }),
  );
  consumeMoveResolution(user, false);
}

export function notifyMoodyRuntimeMoveResolved(
  user: Pokemon,
  target: Pokemon | undefined,
  move: Move,
  landed: boolean,
): void {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter == null) {
    return;
  }
  const actionId = `${battleId()}:${globalScene.currentBattle.turn}:${user.id}:${move.id}`;
  const category =
    move.category === MoveCategory.PHYSICAL
      ? "physical"
      : move.category === MoveCategory.SPECIAL
        ? "special"
        : "status";
  const signal = {
    user,
    ...(target == null ? {} : { target }),
    moveId: String(move.id),
    moveType: String(user.getMoveType(move)),
    category,
    damaging: move.category !== MoveCategory.STATUS && move.power > 0,
    actionId,
    ...(target == null
      ? {}
      : {
          weaknessMultiplier:
            target.turnData.moveEffectiveness
            ?? target.getAttackTypeEffectiveness(user.getMoveType(move), { source: user, move }),
        }),
  } as const;
  resolveMoodySceneFieldEvent(
    adapter.moveResolved({ ...signal, landed, dealtDirectDamage: landed && signal.damaging }),
  );
  const triggerState = runtimeState();
  const triggerResult =
    triggerState == null ? null : consumeMoodyRuntimeActionTriggerIds(triggerState, battleId(), user.id);
  if (triggerResult != null) {
    persistRuntimeState(triggerResult.state);
  }
  resolveMoodySceneFieldEvent(
    adapter.actionResolved({
      actor: user,
      ...(target == null ? {} : { target }),
      actionId,
      boonTriggerCount: triggerResult?.effectIds.length ?? 0,
      removableNegativeCount: countRemovableNegativeEffects(user),
    }),
  );
  clearRuntimeAction(user.id);
  const state = runtimeState();
  if (state?.values[posthumousFaintKey(user.id)] === true) {
    const values = { ...state.values };
    delete values[posthumousFaintKey(user.id)];
    persistRuntimeState({ ...state, values });
    globalScene.phaseManager.queueFaintPhase(user.getBattlerIndex(), true);
  }
}

function countRemovableNegativeEffects(pokemon: Pokemon): number {
  const negativeStages = pokemon
    .getStatStages()
    .filter(stage => stage < 0)
    .reduce((sum, stage) => sum - stage, 0);
  const majorStatus = pokemon.status == null ? 0 : 1;
  const volatiles = pokemon.summonData.tags.filter(tag => MOODY_NEGATIVE_VOLATILES.has(tag.tagType)).length;
  return negativeStages + majorStatus + volatiles;
}

export function shouldMoodyRuntimePreventVolatile(target: Pokemon, volatile: string): boolean {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter == null) {
    return false;
  }
  const result = resolveMoodySceneFieldEvent(adapter.volatileAttempt(target, volatile));
  return (
    result?.commands.some(command => command.kind === "prevent-volatile" && command.subjectId === target.id) === true
  );
}

export function notifyMoodyRuntimeVolatileApplied(target: Pokemon, volatile: string): void {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter != null) {
    resolveMoodySceneFieldEvent(adapter.volatileApplied(target, volatile));
    if (volatile === BattlerTagType.ER_FROSTBITE) {
      resolveMoodySceneFieldEvent(adapter.statusApplied(target, "frostbite"));
    }
  }
}

function weatherName(weather: WeatherType): "clear" | "sun" | "rain" | "sand" | "snow" | "fog" {
  switch (weather) {
    case WeatherType.SUNNY:
    case WeatherType.HARSH_SUN:
      return "sun";
    case WeatherType.RAIN:
    case WeatherType.HEAVY_RAIN:
      return "rain";
    case WeatherType.SANDSTORM:
      return "sand";
    case WeatherType.HAIL:
    case WeatherType.SNOW:
    case WeatherType.SNOWY_WRATH:
      return "snow";
    case WeatherType.FOG:
    case WeatherType.EERIE_FOG:
      return "fog";
    default:
      return "clear";
  }
}

export function notifyMoodyRuntimeWeatherTransition(
  previous: WeatherType,
  next: WeatherType,
  naturalOrReplacement: boolean,
): void {
  const adapter = createMoodySceneFieldAdapter();
  const active = globalScene.getPlayerField()[0];
  if (adapter == null || active == null) {
    return;
  }
  const benched = globalScene
    .getPlayerParty()
    .filter(pokemon => !pokemon.isActive(true) && !pokemon.isFainted(true))
    .toSorted((left, right) => left.hp / left.getMaxHp() - right.hp / right.getMaxHp())[0];
  resolveMoodySceneFieldEvent(
    adapter.weatherTransition({
      previous: weatherName(previous),
      next: weatherName(next),
      naturalOrReplacement,
      activePokemon: active,
      lowestHpBenchedAlly: benched,
    }),
  );
}

export function observeMoodyRuntimeFaint(pokemon: Pokemon, source?: Pokemon): MoodyFaintFieldObservation {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter == null) {
    return { intervene: () => false, finalize: () => undefined };
  }
  const preFaintState = runtimeState();
  const turnCommand = globalScene.currentBattle.turnCommands[pokemon.getBattlerIndex()];
  const committedMove = turnCommand?.move;
  const move = committedMove == null ? undefined : allMoves[committedMove.move];
  const allies = (pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty()).filter(
    ally => ally !== pokemon && !ally.isFainted(true),
  );
  const enemies = pokemon.isPlayer() ? globalScene.getEnemyField() : globalScene.getPlayerField();
  const faintEvent = adapter.faint({
    pokemon,
    otherConsciousAllies: allies,
    ...(enemies[0] == null ? {} : { activeEnemy: enemies[0] }),
    ...(move == null
      ? {}
      : {
          committedMove: {
            moveId: String(move.id),
            category:
              move.category === MoveCategory.PHYSICAL
                ? "physical"
                : move.category === MoveCategory.SPECIAL
                  ? "special"
                  : "status",
            eligible: !pokemon.turnData.acted,
          },
        }),
    finalEnemyPokemon:
      !pokemon.isPlayer() && globalScene.getEnemyParty().every(enemy => enemy === pokemon || enemy.isFainted(true)),
  });
  const result = resolveMoodySceneFieldEvent(faintEvent, { execute: false });
  if (result == null) {
    return { intervene: () => false, finalize: () => undefined };
  }
  const terminalCommands = result.commands.filter(
    command => command.kind === "revive" || command.kind === "execute-committed-move",
  );
  const observationCommands = result.commands.filter(command => !terminalCommands.includes(command));
  let finalized = false;
  const finalize = (): void => {
    if (finalized) {
      return;
    }
    finalized = true;
    const observation = executeMoodyRuntimeCommands(observationCommands, result.state, battleId(), scenePort());
    setMoodyRuntimeFieldSaveData(serializeMoodyRuntimeFieldState(observation.state, cursorFor(faintEvent)));
    if (source != null) {
      resolveMoodySceneFieldEvent(adapter.ko(source, pokemon));
    }
  };
  return {
    intervene: () => {
      const revive = terminalCommands.find(command => command.kind === "revive");
      if (revive != null) {
        if (preFaintState == null) {
          return false;
        }
        const execution = executeMoodyRuntimeCommands([revive], preFaintState, battleId(), scenePort());
        persistRuntimeState(execution.state);
        return pokemon.hp > 0;
      }
      const command = terminalCommands.find(candidate => candidate.kind === "execute-committed-move");
      if (command == null || move == null || committedMove == null) {
        return false;
      }
      finalize();
      const state = runtimeState() ?? result.state;
      persistRuntimeState({
        ...state,
        numbers: {
          ...state.numbers,
          [actionKey(pokemon.id, "power")]: command.multiplier ?? 1,
        },
        values: {
          ...state.values,
          [posthumousFaintKey(pokemon.id)]: true,
        },
      });
      const targets =
        turnCommand?.targets
        ?? committedMove.targets
        ?? pokemon
          .getOpponents(false)
          .filter(target => target.isActive(true))
          .map(target => target.getBattlerIndex());
      globalScene.phaseManager.unshiftNew(
        "MovePhase",
        pokemon,
        targets,
        createPokemonMove(pokemon, move.id),
        MoveUseMode.FOLLOW_UP,
        MovePhaseTimingModifier.FIRST,
      );
      return true;
    },
    finalize,
  };
}

export function notifyMoodyRuntimeFaint(pokemon: Pokemon, source?: Pokemon): boolean {
  return observeMoodyRuntimeFaint(pokemon, source).intervene();
}

export function shouldMoodyRuntimePreventSwitch(pokemon: Pokemon, voluntary: boolean): boolean {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter == null) {
    return false;
  }
  const result = resolveMoodySceneFieldEvent(adapter.switchAttempt(pokemon, voluntary));
  return (
    result?.commands.some(
      command =>
        (command.kind === "prevent-switch" || command.kind === "lock-switching")
        && (command.subjectId == null || command.subjectId === pokemon.id),
    ) === true
  );
}

export function notifyMoodyRuntimeEntry(pokemon: Pokemon, isReentry: boolean): void {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter != null) {
    const openingEntryIds = ensureBattleStart(adapter);
    if (!openingEntryIds.has(pokemon.id)) {
      resolveMoodySceneFieldEvent(
        adapter.entry({
          pokemon,
          activePokemon: pokemon.isPlayer() ? globalScene.getPlayerField() : globalScene.getEnemyField(),
          isReentry,
          weatherOptions: ["clear", "sun", "rain", "sand", "snow", "fog"],
          terrainOptions: ["none", "electric", "grassy", "misty", "psychic"],
        }),
      );
    }
    scheduleInteractiveCommands();
  }
}

export function notifyMoodyRuntimeBattleEnd(won: boolean): void {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter == null) {
    return;
  }
  const entered = globalScene.currentBattle.playerParticipantIds ?? new Set<number>();
  const field: MoodyRuntimeFieldSnapshot[] = [];
  if (globalScene.arena.weather != null) {
    field.push({ kind: "weather", id: weatherName(globalScene.arena.weather.weatherType), persistent: true });
  }
  if (globalScene.arena.terrain != null) {
    field.push({
      kind: "terrain",
      id: TerrainType[globalScene.arena.terrain.terrainType].toLowerCase(),
      persistent: true,
    });
  }
  for (const tag of globalScene.arena.tags) {
    field.push({
      kind: "side-condition",
      id: String(tag.tagType),
      ...(tag.side === ArenaTagSide.PLAYER
        ? { ownerSide: "player" as const }
        : tag.side === ArenaTagSide.ENEMY
          ? { ownerSide: "enemy" as const }
          : {}),
      persistent: tag.turnCount !== 0,
    });
  }
  resolveMoodySceneFieldEvent(adapter.battleEnd({ won, enteredPokemonIds: [...entered], field }));
  if (won) {
    resolveMoodySceneFieldEvent(adapter.battleWon({ side: "player", alliedFaints: globalScene.arena.playerFaints }));
  }
}

export function notifyMoodyRuntimeBiomeTransition(): void {
  const adapter = createMoodySceneFieldAdapter();
  const modeState = getMoodyModeState();
  if (adapter == null || modeState == null || modeState.fieldRuntime?.cursor.biomeId === globalScene.arena.biomeId) {
    return;
  }
  const seed = hashString(`${modeState.seed}:${globalScene.currentBattle.battleSeed}`);
  const deterministicIndex = (salt: string, length: number): number => {
    let hash = seed | 0;
    for (let index = 0; index < salt.length; index++) {
      hash = Math.imul(hash ^ salt.charCodeAt(index), 16777619);
    }
    return length === 0 ? 0 : (hash >>> 0) % length;
  };
  const replacementMoveCandidates = Object.fromEntries(
    globalScene.getPlayerParty().map(pokemon => {
      const moveset = pokemon.getMoveset();
      const selected = moveset[deterministicIndex(`entropy:move:${pokemon.id}`, moveset.length)]?.getMove();
      const candidates = Object.values(allMoves)
        .filter(move => selected != null && isLegalMoodyEntropyReplacement(selected, move))
        .map(move => String(move.id));
      return [pokemon.id, candidates];
    }),
  );
  resolveMoodySceneFieldEvent(adapter.biomeTransition(replacementMoveCandidates));
}

export function isLegalMoodyEntropyReplacement(original: Move, candidate: Move): boolean {
  if (
    candidate.id === original.id
    || candidate.id === MoveId.NONE
    || candidate.id === MoveId.STRUGGLE
    || candidate.name.endsWith(" (N)")
    || candidate.category !== original.category
    || candidate.hasAttr("OneHitKOAttr")
    || candidate.hasAttr("FormChangeItemTypeAttr")
    || candidate.hasAttr("TransformAttr")
  ) {
    return false;
  }
  if (original.category === MoveCategory.STATUS || original.power <= 0) {
    return candidate.power <= 0;
  }
  if (candidate.power <= 0) {
    return false;
  }
  const tolerance = Math.max(20, original.power * 0.25);
  return Math.abs(candidate.power - original.power) <= tolerance;
}

export function enforceMoodyRuntimeLead(): void {
  const adapter = createMoodySceneFieldAdapter();
  const party = globalScene.getPlayerParty();
  const lead = party[0];
  if (adapter == null || lead == null) {
    return;
  }
  const result = resolveMoodySceneFieldEvent(adapter.leadSelection(lead));
  const invalid =
    result?.commands.some(command => command.kind === "invalidate-lead" && command.subjectId === lead.id) === true;
  consumeScenePending("lead-selection", command => {
    if (command.kind !== "invalidate-lead") {
      throw new Error(`Invalid Moody lead command: ${command.kind}`);
    }
  });
  if (invalid) {
    const replacement = party.findIndex((pokemon, index) => index > 0 && !pokemon.isFainted(true));
    if (replacement > 0) {
      party.unshift(party.splice(replacement, 1)[0]);
      resolveMoodySceneFieldEvent(adapter.leadSelection(party[0]));
      consumeScenePending("lead-selection", command => {
        if (command.kind !== "invalidate-lead") {
          throw new Error(`Invalid Moody lead command: ${command.kind}`);
        }
      });
    }
  }
}

export function notifyMoodyRuntimeBoonDraft(offerIds: readonly string[]): void {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter != null) {
    resolveMoodySceneFieldEvent(adapter.boonDraft(offerIds));
    consumeScenePending("boon-draft", command => {
      if (command.kind !== "conceal-boon-offer" || typeof command.value !== "string") {
        throw new Error(`Invalid Moody boon-draft command: ${command.kind}`);
      }
      concealPendingMoodyBoonOffer(command.value);
    });
  }
}

export function prepareMoodyRuntimeEncounter(baseRosterSize: number): number {
  const adapter = createMoodySceneFieldAdapter();
  const state = getMoodyModeState();
  if (adapter == null || state == null) {
    return baseRosterSize;
  }
  const threat = state.recentThreat.toSorted(
    (left, right) =>
      right.damageDealt
      + right.bossSegmentDamage * 2
      + right.knockouts * 100
      - (left.damageDealt + left.bossSegmentDamage * 2 + left.knockouts * 100),
  )[0];
  const runtime = deserializeMoodyRuntimeFieldState(state.fieldRuntime);
  resolveMoodySceneFieldEvent(
    adapter.encounterGenerate({
      baseRosterSize,
      playerThreatPokemonId: threat?.pokemonId,
      noFaintWinStreak: runtime.numbers["persistent:reverse-snowball:streak"] ?? 0,
    }),
  );
  let rosterSize = baseRosterSize;
  let updated = runtimeState() ?? runtime;
  const encounter = consumeMoodyRuntimePendingCommands(updated, battleId(), "encounter-generation");
  updated = encounter.state;
  const numbers = { ...updated.numbers };
  for (const command of encounter.commands) {
    if (command.kind === "set-enemy-roster-size") {
      rosterSize = Math.max(rosterSize, Math.floor(command.amount ?? rosterSize));
    } else if (command.kind === "set-counter-weight") {
      numbers[`${battleId()}:encounter:counter-weight`] = command.multiplier ?? 1;
    } else if (command.kind === "apply-enemy-stat-multiplier") {
      numbers[`${battleId()}:encounter:enemy-stat-multiplier`] = command.multiplier ?? 1;
    } else {
      throw new Error(`Invalid Moody encounter-generation command: ${command.kind}`);
    }
  }
  const information = consumeMoodyRuntimePendingCommands({ ...updated, numbers }, battleId(), "battle-information");
  updated = information.state;
  const lists = { ...updated.lists };
  for (const command of information.commands) {
    if (command.kind !== "hide-enemy-information") {
      throw new Error(`Invalid Moody battle-information command: ${command.kind}`);
    }
    lists[`${battleId()}:encounter:hidden-information`] =
      (command.data?.fields as readonly string[] | undefined)?.slice() ?? [];
  }
  persistRuntimeState({ ...updated, numbers, lists });
  return rosterSize;
}

export function notifyMoodyRuntimeTurnStart(): void {
  const adapter = createMoodySceneFieldAdapter();
  if (adapter != null) {
    ensureBattleStart(adapter);
    for (const pokemon of [...globalScene.getPlayerField(), ...globalScene.getEnemyField()]) {
      clearRuntimeAction(pokemon.id, true);
    }
    resolveMoodySceneFieldEvent(adapter.turnStart([...globalScene.getPlayerField(), ...globalScene.getEnemyField()]));
  }
}
