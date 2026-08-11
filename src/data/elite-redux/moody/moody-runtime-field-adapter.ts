import type {
  MoodyRuntimeCommand,
  MoodyRuntimeCommandKind,
  MoodyRuntimeFieldEvent,
  MoodyRuntimeFieldResult,
  MoodyRuntimeFieldSnapshot,
  MoodyRuntimeFieldState,
  MoodyRuntimePokemonSnapshot,
  MoodyRuntimeSide,
  MoodyRuntimeStatus,
  MoodyRuntimeTerrain,
  MoodyRuntimeWeather,
} from "#data/elite-redux/moody/moody-runtime-field";
import type { MoodyModeSaveData, MoodyRuntimeFieldSaveData } from "#data/elite-redux/moody/moody-types";

type EventOf<K extends MoodyRuntimeFieldEvent["kind"]> = Extract<MoodyRuntimeFieldEvent, { kind: K }>;

export interface MoodyLivePokemonReader<TPokemon> {
  readonly id: (pokemon: TPokemon) => number;
  readonly side: (pokemon: TPokemon) => MoodyRuntimeSide;
  readonly partySlot: (pokemon: TPokemon) => number;
  readonly currentHp: (pokemon: TPokemon) => number;
  readonly maxHp: (pokemon: TPokemon) => number;
  readonly fainted: (pokemon: TPokemon) => boolean;
  readonly status: (pokemon: TPokemon) => MoodyRuntimeStatus | undefined;
  readonly grounded: (pokemon: TPokemon) => boolean;
  readonly moveIds: (pokemon: TPokemon) => readonly string[];
  readonly eligibleMoveIds: (pokemon: TPokemon) => readonly string[];
  readonly compatibleAbilityIds: (pokemon: TPokemon) => readonly string[];
  readonly types: (pokemon: TPokemon) => readonly string[];
}

export interface MoodyLiveBattleSnapshot<TPokemon> {
  readonly battleId: string;
  readonly waveIndex: number;
  readonly turn: number;
  readonly seed: number;
  readonly isBoss: boolean;
  readonly isTrainer: boolean;
  readonly biomeId: number;
  readonly biomeEpoch: number;
  readonly playerParty: readonly TPokemon[];
  readonly enemyParty: readonly TPokemon[];
  readonly playerActive: readonly TPokemon[];
  readonly enemyActive: readonly TPokemon[];
}

export type MoodyModeSaveDataWithFieldRuntime<TSave extends MoodyModeSaveData = MoodyModeSaveData> = TSave & {
  readonly fieldRuntime: MoodyRuntimeFieldSaveData;
};

export type MoodyRuntimeResetBoundary =
  | {
      readonly kind: "battle-start";
      readonly battleId: string;
      readonly waveIndex: number;
      readonly segmentIndex: number;
      readonly biomeEpoch: number;
    }
  | {
      readonly kind: "segment-start";
      readonly segmentIndex: number;
      readonly biomeEpoch: number;
    }
  | {
      readonly kind: "biome-transition";
      readonly biomeEpoch: number;
      readonly segmentIndex: number;
    }
  | { readonly kind: "run-end" };

export const MOODY_RUNTIME_FIELD_RESET_CADENCES = Object.freeze({
  battle: "Keys prefixed by a battle ID live through that battle and are removed before the next battle-start event.",
  boss: "boss:<battleId>: keys live through one boss battle and are removed before any later battle.",
  segment: "segment:<index>: keys live through one ten-wave segment and are removed when segmentIndex changes.",
  biome: "biome:<epoch>: keys live through one biome visit and are removed when biomeEpoch changes.",
  persistent: "persistent: keys survive battles, segments, and biomes and reset only at run end.",
});

export function serializeMoodyRuntimeFieldState(
  state: MoodyRuntimeFieldState,
  cursor: MoodyRuntimeFieldSaveData["cursor"],
): MoodyRuntimeFieldSaveData {
  const sortedEntries = <T>(record: Readonly<Record<string, T>>): readonly (readonly [string, T])[] =>
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right));
  return {
    version: 1,
    cursor: { ...cursor },
    numbers: sortedEntries(state.numbers).map(([key, value]) => [key, value]),
    values: sortedEntries(state.values).map(([key, value]) => [key, value]),
    lists: sortedEntries(state.lists).map(([key, value]) => [key, [...value]]),
  };
}

export function deserializeMoodyRuntimeFieldState(save: MoodyRuntimeFieldSaveData | undefined): MoodyRuntimeFieldState {
  if (!save) {
    return { numbers: {}, values: {}, lists: {} };
  }
  if (save.version !== 1) {
    throw new Error(`Unsupported Moody field runtime save version: ${String(save.version)}`);
  }
  return {
    numbers: Object.fromEntries(save.numbers),
    values: Object.fromEntries(save.values),
    lists: Object.fromEntries(save.lists.map(([key, value]) => [key, [...value]])),
  };
}

export function attachMoodyRuntimeFieldSave<TSave extends MoodyModeSaveData>(
  save: TSave,
  fieldRuntime: MoodyRuntimeFieldSaveData,
): MoodyModeSaveDataWithFieldRuntime<TSave> {
  return { ...save, fieldRuntime };
}

export function extractMoodyRuntimeFieldSave(save: MoodyModeSaveData): MoodyRuntimeFieldSaveData | undefined {
  return save.fieldRuntime;
}

export function resetMoodyRuntimeFieldState(
  state: MoodyRuntimeFieldState,
  boundary: MoodyRuntimeResetBoundary,
): MoodyRuntimeFieldState {
  if (boundary.kind === "run-end") {
    return { numbers: {}, values: {}, lists: {} };
  }
  const keep = (key: string): boolean => {
    if (key.startsWith("persistent:")) {
      return true;
    }
    if (boundary.kind === "battle-start") {
      if (key.startsWith(`${boundary.battleId}:`)) {
        return true;
      }
      if (key.startsWith(`segment:${boundary.segmentIndex}:`)) {
        return true;
      }
      if (key.startsWith(`biome:${boundary.biomeEpoch}:`)) {
        return true;
      }
      return false;
    }
    if (boundary.kind === "segment-start") {
      return key.startsWith(`segment:${boundary.segmentIndex}:`) || key.startsWith(`biome:${boundary.biomeEpoch}:`);
    }
    return key.startsWith(`biome:${boundary.biomeEpoch}:`) || key.startsWith(`segment:${boundary.segmentIndex}:`);
  };
  const filter = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([key]) => keep(key)));
  return {
    numbers: filter(state.numbers),
    values: filter(state.values),
    lists: filter(state.lists),
  };
}

interface MoveSignal<TPokemon> {
  readonly user: TPokemon;
  readonly target?: TPokemon;
  readonly moveId: string;
  readonly moveType: string;
  readonly category: "physical" | "special" | "status";
  readonly damaging: boolean;
  readonly raisesStats?: boolean;
  readonly actionId: string;
}

function optionalField<TKey extends PropertyKey, TValue>(
  key: TKey,
  value: TValue | undefined,
): Partial<Record<TKey, TValue>> {
  return value === undefined ? {} : ({ [key]: value } as Record<TKey, TValue>);
}

export function didMoodyDamageCrossHpFraction(input: {
  readonly hpBefore: number;
  readonly hpAfter: number;
  readonly maxHp: number;
  readonly fraction?: number;
}): boolean {
  const maxHp = Math.max(1, input.maxHp);
  const threshold = maxHp * (input.fraction ?? 0.25);
  return input.hpBefore >= threshold && input.hpAfter < threshold;
}

const actionTriggerKey = (battleId: string, pokemonId: number): string =>
  `${battleId}:runtime-action:pokemon:${pokemonId}:boon-triggers`;

export function recordMoodyRuntimeActionTriggerIds(
  state: MoodyRuntimeFieldState,
  battleId: string,
  pokemonId: number,
  effectIds: readonly string[],
): MoodyRuntimeFieldState {
  const key = actionTriggerKey(battleId, pokemonId);
  const previous = state.lists[key] ?? [];
  const next = [...new Set([...previous, ...effectIds.filter(Boolean)])];
  if (next.length === previous.length && next.every((effectId, index) => effectId === previous[index])) {
    return state;
  }
  return {
    ...state,
    lists: {
      ...state.lists,
      [key]: next,
    },
  };
}

export function consumeMoodyRuntimeActionTriggerIds(
  state: MoodyRuntimeFieldState,
  battleId: string,
  pokemonId: number,
): {
  readonly state: MoodyRuntimeFieldState;
  readonly effectIds: readonly string[];
} {
  const key = actionTriggerKey(battleId, pokemonId);
  const effectIds = state.lists[key] ?? [];
  if (!(key in state.lists)) {
    return { state, effectIds };
  }
  const lists = { ...state.lists };
  delete lists[key];
  return {
    state: { ...state, lists },
    effectIds,
  };
}

export function snapshotMoodyRuntimePokemon<TPokemon>(
  pokemon: TPokemon,
  reader: MoodyLivePokemonReader<TPokemon>,
): MoodyRuntimePokemonSnapshot {
  const status = reader.status(pokemon);
  return {
    id: reader.id(pokemon),
    side: reader.side(pokemon),
    partySlot: reader.partySlot(pokemon),
    currentHp: reader.currentHp(pokemon),
    maxHp: reader.maxHp(pokemon),
    fainted: reader.fainted(pokemon),
    ...optionalField("status", status),
    grounded: reader.grounded(pokemon),
    moveCount: reader.moveIds(pokemon).length,
    moveIds: [...reader.moveIds(pokemon)],
    eligibleMoveIds: [...reader.eligibleMoveIds(pokemon)],
    compatibleAbilityIds: [...reader.compatibleAbilityIds(pokemon)],
    types: [...reader.types(pokemon)],
  };
}

export class MoodyRuntimeFieldEventAdapter<TPokemon> {
  constructor(
    private readonly battle: MoodyLiveBattleSnapshot<TPokemon>,
    private readonly reader: MoodyLivePokemonReader<TPokemon>,
  ) {}

  private common() {
    return {
      battleId: this.battle.battleId,
      waveIndex: this.battle.waveIndex,
      turn: this.battle.turn,
      seed: this.battle.seed,
    } as const;
  }

  public pokemon(pokemon: TPokemon): MoodyRuntimePokemonSnapshot {
    return snapshotMoodyRuntimePokemon(pokemon, this.reader);
  }

  public party(side: MoodyRuntimeSide): readonly MoodyRuntimePokemonSnapshot[] {
    return (side === "player" ? this.battle.playerParty : this.battle.enemyParty).map(pokemon => this.pokemon(pokemon));
  }

  public battleStart(
    activePokemon: TPokemon,
    carriedField?: readonly MoodyRuntimeFieldSnapshot[],
  ): EventOf<"battle-start"> {
    return {
      ...this.common(),
      kind: "battle-start",
      isBoss: this.battle.isBoss,
      isTrainer: this.battle.isTrainer,
      activePokemonId: this.reader.id(activePokemon),
      party: [...this.party("player"), ...this.party("enemy")],
      ...optionalField("carriedField", carriedField),
    };
  }

  public battleEnd(input: {
    won: boolean;
    enteredPokemonIds: readonly number[];
    field?: readonly MoodyRuntimeFieldSnapshot[];
  }): EventOf<"battle-end"> {
    return {
      ...this.common(),
      kind: "battle-end",
      won: input.won,
      party: [...this.party("player"), ...this.party("enemy")],
      enteredPokemonIds: [...input.enteredPokemonIds],
      ...optionalField("field", input.field),
    };
  }

  public entry(input: {
    pokemon: TPokemon;
    activePokemon: readonly TPokemon[];
    isReentry: boolean;
    afterAllyFaint?: boolean;
    weatherOptions?: readonly MoodyRuntimeWeather[];
    terrainOptions?: readonly MoodyRuntimeTerrain[];
  }): EventOf<"entry"> {
    return {
      ...this.common(),
      kind: "entry",
      pokemon: this.pokemon(input.pokemon),
      activePokemonIds: input.activePokemon.map(pokemon => this.reader.id(pokemon)),
      isReentry: input.isReentry,
      ...optionalField("afterAllyFaint", input.afterAllyFaint),
      ...optionalField("weatherOptions", input.weatherOptions),
      ...optionalField("terrainOptions", input.terrainOptions),
    };
  }

  public initialEntries(
    input: { weatherOptions?: readonly MoodyRuntimeWeather[]; terrainOptions?: readonly MoodyRuntimeTerrain[] } = {},
  ): readonly EventOf<"entry">[] {
    return [...this.battle.playerActive, ...this.battle.enemyActive].map(pokemon =>
      this.entry({
        pokemon,
        activePokemon: this.reader.side(pokemon) === "player" ? this.battle.playerActive : this.battle.enemyActive,
        isReentry: false,
        ...optionalField("weatherOptions", input.weatherOptions),
        ...optionalField("terrainOptions", input.terrainOptions),
      }),
    );
  }

  public beforeMove(
    input: MoveSignal<TPokemon> & {
      asleep?: boolean;
      dreamTagged?: boolean;
      weatherWeakens?: boolean;
      legalBestType?: string;
      weaknessMultiplier?: number;
    },
  ): EventOf<"before-move"> {
    return {
      ...this.common(),
      kind: "before-move",
      ...this.moveSnapshot(input),
      ...optionalField("raisesStats", input.raisesStats),
      ...optionalField("asleep", input.asleep),
      ...optionalField("dreamTagged", input.dreamTagged),
      ...optionalField("weatherWeakens", input.weatherWeakens),
      ...optionalField("legalBestType", input.legalBestType),
      ...optionalField("weaknessMultiplier", input.weaknessMultiplier),
    };
  }

  public moveResolved(
    input: MoveSignal<TPokemon> & {
      landed: boolean;
      dealtDirectDamage: boolean;
      weaknessMultiplier?: number;
    },
  ): EventOf<"move-resolved"> {
    return {
      ...this.common(),
      kind: "move-resolved",
      ...this.moveSnapshot(input),
      landed: input.landed,
      dealtDirectDamage: input.dealtDirectDamage,
      ...optionalField("weaknessMultiplier", input.weaknessMultiplier),
    };
  }

  private moveSnapshot(input: MoveSignal<TPokemon>) {
    return {
      user: this.pokemon(input.user),
      ...optionalField("target", input.target ? this.pokemon(input.target) : undefined),
      moveId: input.moveId,
      moveType: input.moveType,
      category: input.category,
      damaging: input.damaging,
      actionId: input.actionId,
    } as const;
  }

  public beforeDamage(input: {
    source?: TPokemon;
    target: TPokemon;
    amount: number;
    direct: boolean;
    category?: "physical" | "special";
    superEffective?: boolean;
    poisonDamage?: boolean;
    hitIndex?: number;
    sameOriginatingAction?: boolean;
  }): EventOf<"before-damage"> {
    return {
      ...this.common(),
      kind: "before-damage",
      ...optionalField("source", input.source ? this.pokemon(input.source) : undefined),
      target: this.pokemon(input.target),
      amount: input.amount,
      direct: input.direct,
      ...optionalField("category", input.category),
      ...optionalField("superEffective", input.superEffective),
      ...optionalField("poisonDamage", input.poisonDamage),
      ...optionalField("hitIndex", input.hitIndex),
      ...optionalField("sameOriginatingAction", input.sameOriginatingAction),
    };
  }

  public afterDamage(input: {
    source?: TPokemon;
    target: TPokemon;
    direct: boolean;
    amount: number;
    barrierAbsorbed: number;
    hpAfter: number;
    crossedQuarterHp: boolean;
  }): EventOf<"after-damage"> {
    return {
      ...this.common(),
      kind: "after-damage",
      ...optionalField("source", input.source ? this.pokemon(input.source) : undefined),
      target: this.pokemon(input.target),
      direct: input.direct,
      amount: input.amount,
      barrierAbsorbed: input.barrierAbsorbed,
      hpAfter: input.hpAfter,
      ...optionalField("crossedQuarterHp", input.crossedQuarterHp),
    };
  }

  public heal(input: {
    target: TPokemon;
    amount: number;
    effectiveAmount: number;
    benchedAllies: readonly TPokemon[];
  }): EventOf<"heal"> {
    return {
      ...this.common(),
      kind: "heal",
      target: this.pokemon(input.target),
      amount: input.amount,
      effectiveAmount: input.effectiveAmount,
      benchedAllies: input.benchedAllies.map(pokemon => this.pokemon(pokemon)),
    };
  }

  public statusAttempt(input: {
    source?: TPokemon;
    target: TPokemon;
    status: MoodyRuntimeStatus;
    legalOnSource?: boolean;
  }): EventOf<"status-attempt"> {
    return {
      ...this.common(),
      kind: "status-attempt",
      ...optionalField("source", input.source ? this.pokemon(input.source) : undefined),
      target: this.pokemon(input.target),
      status: input.status,
      ...optionalField("legalOnSource", input.legalOnSource),
    };
  }

  public statusApplied(target: TPokemon, status: MoodyRuntimeStatus): EventOf<"status-applied"> {
    return {
      ...this.common(),
      kind: "status-applied",
      target: this.pokemon(target),
      status,
    };
  }

  public statusCured(
    target: TPokemon,
    status: MoodyRuntimeStatus,
    adjacentAllies: readonly TPokemon[] = [],
  ): EventOf<"status-cured"> {
    return {
      ...this.common(),
      kind: "status-cured",
      target: this.pokemon(target),
      status,
      adjacentAllies: adjacentAllies.map(pokemon => this.pokemon(pokemon)),
    };
  }

  public volatileAttempt(target: TPokemon, volatile: string): EventOf<"volatile-attempt"> {
    return {
      ...this.common(),
      kind: "volatile-attempt",
      target: this.pokemon(target),
      volatile,
    };
  }

  public volatileApplied(target: TPokemon, volatile: string): EventOf<"volatile-applied"> {
    return {
      ...this.common(),
      kind: "volatile-applied",
      target: this.pokemon(target),
      volatile,
    };
  }

  public weatherTransition(input: {
    previous: MoodyRuntimeWeather;
    next: MoodyRuntimeWeather;
    naturalOrReplacement: boolean;
    activePokemon: TPokemon;
    lowestHpBenchedAlly?: TPokemon;
  }): EventOf<"weather-transition"> {
    return {
      ...this.common(),
      kind: "weather-transition",
      previous: input.previous,
      next: input.next,
      naturalOrReplacement: input.naturalOrReplacement,
      activePokemon: this.pokemon(input.activePokemon),
      ...optionalField(
        "lowestHpBenchedAlly",
        input.lowestHpBenchedAlly ? this.pokemon(input.lowestHpBenchedAlly) : undefined,
      ),
    };
  }

  public barrierEnded(target: TPokemon, broke: boolean, barrierTag?: string): EventOf<"barrier-ended"> {
    return {
      ...this.common(),
      kind: "barrier-ended",
      target: this.pokemon(target),
      broke,
      ...optionalField("barrierTag", barrierTag),
    };
  }

  public turnStart(activePokemon: readonly TPokemon[]): EventOf<"turn-start"> {
    return {
      ...this.common(),
      kind: "turn-start",
      activePokemonIds: activePokemon.map(pokemon => this.reader.id(pokemon)),
    };
  }

  public turnEnd(activePokemon: readonly TPokemon[]): EventOf<"turn-end"> {
    return {
      ...this.common(),
      kind: "turn-end",
      activePokemonIds: activePokemon.map(pokemon => this.reader.id(pokemon)),
    };
  }

  public actionResolved(input: {
    actor: TPokemon;
    target?: TPokemon;
    actionId: string;
    boonTriggerCount: number;
    removableNegativeCount: number;
  }): EventOf<"action-resolved"> {
    return {
      ...this.common(),
      kind: "action-resolved",
      actor: this.pokemon(input.actor),
      ...optionalField("target", input.target ? this.pokemon(input.target) : undefined),
      actionId: input.actionId,
      boonTriggerCount: input.boonTriggerCount,
      removableNegativeCount: input.removableNegativeCount,
    };
  }

  public faint(input: {
    pokemon: TPokemon;
    committedMove?: {
      readonly moveId: string;
      readonly category: "physical" | "special" | "status";
      readonly eligible: boolean;
    };
    otherConsciousAllies: readonly TPokemon[];
    activeEnemy?: TPokemon;
    finalEnemyPokemon?: boolean;
  }): EventOf<"faint"> {
    return {
      ...this.common(),
      kind: "faint",
      isBoss: this.battle.isBoss,
      pokemon: this.pokemon(input.pokemon),
      ...optionalField("committedMove", input.committedMove),
      otherConsciousAllies: input.otherConsciousAllies.map(pokemon => this.pokemon(pokemon)),
      ...optionalField("activeEnemy", input.activeEnemy ? this.pokemon(input.activeEnemy) : undefined),
      ...optionalField("finalEnemyPokemon", input.finalEnemyPokemon),
    };
  }

  public ko(actor: TPokemon, defeated: TPokemon, replacementEnemy?: TPokemon): EventOf<"ko"> {
    return {
      ...this.common(),
      kind: "ko",
      actor: this.pokemon(actor),
      defeated: this.pokemon(defeated),
      ...optionalField("replacementEnemy", replacementEnemy ? this.pokemon(replacementEnemy) : undefined),
    };
  }

  public switchAttempt(pokemon: TPokemon, voluntary: boolean): EventOf<"switch-attempt"> {
    return {
      ...this.common(),
      kind: "switch-attempt",
      pokemon: this.pokemon(pokemon),
      voluntary,
    };
  }

  public leadSelection(pokemon: TPokemon): EventOf<"lead-selection"> {
    return {
      ...this.common(),
      kind: "lead-selection",
      pokemonId: this.reader.id(pokemon),
    };
  }

  public battleWon(input: {
    side: MoodyRuntimeSide;
    selectedReviveIds?: readonly number[];
    alliedFaints: number;
  }): EventOf<"battle-won"> {
    return {
      ...this.common(),
      kind: "battle-won",
      party: this.party(input.side),
      ...optionalField("selectedReviveIds", input.selectedReviveIds),
      alliedFaints: input.alliedFaints,
    };
  }

  public biomeTransition(
    replacementMoveCandidates: Readonly<Record<number, readonly string[]>>,
  ): EventOf<"biome-transition"> {
    return {
      ...this.common(),
      kind: "biome-transition",
      party: this.party("player"),
      replacementMoveCandidates,
    };
  }

  public encounterGenerate(input: {
    baseRosterSize: number;
    playerThreatPokemonId?: number;
    noFaintWinStreak: number;
  }): EventOf<"encounter-generate"> {
    return {
      ...this.common(),
      kind: "encounter-generate",
      isBoss: this.battle.isBoss,
      isTrainer: this.battle.isTrainer,
      baseRosterSize: input.baseRosterSize,
      ...optionalField("playerThreatPokemonId", input.playerThreatPokemonId),
      noFaintWinStreak: input.noFaintWinStreak,
    };
  }

  public boonDraft(offerIds: readonly string[]): EventOf<"boon-draft"> {
    return { ...this.common(), kind: "boon-draft", offerIds: [...offerIds] };
  }
}

export type MoodyExecutableOperation =
  | {
      readonly kind: "modifier";
      readonly timing: "before-resolution" | "after-resolution";
      readonly channel: string;
      readonly command: MoodyRuntimeCommand;
    }
  | {
      readonly kind: "vital";
      readonly timing: "before-resolution" | "after-resolution" | "phase-boundary";
      readonly action: string;
      readonly command: MoodyRuntimeCommand;
    }
  | {
      readonly kind: "condition";
      readonly timing: "before-resolution" | "after-resolution";
      readonly action: string;
      readonly command: MoodyRuntimeCommand;
    }
  | {
      readonly kind: "field";
      readonly timing: "phase-boundary";
      readonly action: string;
      readonly command: MoodyRuntimeCommand;
    }
  | {
      readonly kind: "temporary-loadout";
      readonly timing: "phase-boundary";
      readonly action: "grant-move" | "choose-move" | "grant-ability" | "replace-move";
      readonly command: MoodyRuntimeCommand;
    }
  | {
      readonly kind: "choice";
      readonly timing: "pause-and-resume";
      readonly choice: "weather" | "terrain" | "temporary-move";
      readonly command: MoodyRuntimeCommand;
    }
  | {
      readonly kind: "encounter";
      readonly timing: "generation" | "phase-boundary";
      readonly action: string;
      readonly command: MoodyRuntimeCommand;
    }
  | {
      readonly kind: "signal";
      readonly timing: "after-resolution";
      readonly command: MoodyRuntimeCommand;
    }
  | {
      readonly kind: "persist-state";
      readonly timing: "after-resolution";
      readonly deltas: MoodyRuntimeFieldResult["deltas"];
      readonly state: MoodyRuntimeFieldResult["state"];
    };

export const MOODY_RUNTIME_COMMAND_KINDS = [
  "modify-damage",
  "cap-damage",
  "split-damage",
  "set-move-type",
  "ignore-weather-penalty",
  "treat-as-weather-boosted",
  "modify-priority",
  "modify-speed",
  "modify-stat",
  "ignore-burn-attack-penalty",
  "modify-burn-damage",
  "allow-move-while-asleep",
  "shorten-status",
  "prevent-status",
  "apply-status",
  "cure-status",
  "prevent-volatile",
  "shorten-volatile",
  "clear-negative-stages",
  "clear-volatiles",
  "apply-barrier",
  "decay-barrier",
  "heal",
  "restore-pp",
  "consume-extra-pp",
  "typeless-damage",
  "nonlethal-damage",
  "request-weather-choice",
  "request-terrain-choice",
  "set-weather",
  "apply-directional-screen",
  "carry-field-state",
  "modify-field-strength",
  "guarantee-secondary-effect",
  "increase-secondary-chance",
  "ignore-defense-fraction",
  "grant-temporary-move",
  "request-temporary-move-choice",
  "grant-temporary-ability",
  "execute-committed-move",
  "revive",
  "lock-switching",
  "prevent-switch",
  "invalidate-lead",
  "hide-enemy-information",
  "set-enemy-roster-size",
  "set-counter-weight",
  "apply-enemy-stat-multiplier",
  "set-boon-dormancy",
  "conceal-boon-offer",
  "replace-move-temporarily",
  "reset-toxic-counter",
  "schedule-damage-debt",
  "collect-damage-debt",
  "queue-next-move-power",
  "mark-trigger",
] as const satisfies readonly MoodyRuntimeCommandKind[];

type MissingRuntimeCommandKind = Exclude<MoodyRuntimeCommandKind, (typeof MOODY_RUNTIME_COMMAND_KINDS)[number]>;
type UnexpectedRuntimeCommandKind = Exclude<(typeof MOODY_RUNTIME_COMMAND_KINDS)[number], MoodyRuntimeCommandKind>;
const MOODY_RUNTIME_COMMAND_KINDS_ARE_EXACT: [MissingRuntimeCommandKind, UnexpectedRuntimeCommandKind] extends [
  never,
  never,
]
  ? true
  : false = true;
void MOODY_RUNTIME_COMMAND_KINDS_ARE_EXACT;

export function translateMoodyRuntimeCommand(command: MoodyRuntimeCommand): MoodyExecutableOperation {
  switch (command.kind) {
    case "modify-damage":
    case "cap-damage":
    case "split-damage":
    case "set-move-type":
    case "ignore-weather-penalty":
    case "treat-as-weather-boosted":
    case "modify-priority":
    case "modify-speed":
    case "modify-stat":
    case "ignore-burn-attack-penalty":
    case "modify-burn-damage":
    case "allow-move-while-asleep":
    case "guarantee-secondary-effect":
    case "increase-secondary-chance":
    case "ignore-defense-fraction":
    case "modify-field-strength":
    case "queue-next-move-power":
      return {
        kind: "modifier",
        timing: "before-resolution",
        channel: command.kind,
        command,
      };
    case "apply-barrier":
    case "heal":
    case "restore-pp":
    case "typeless-damage":
    case "nonlethal-damage":
      return {
        kind: "vital",
        timing: "after-resolution",
        action: command.kind,
        command,
      };
    case "decay-barrier":
    case "revive":
    case "execute-committed-move":
    case "collect-damage-debt":
      return {
        kind: "vital",
        timing: "phase-boundary",
        action: command.kind,
        command,
      };
    case "consume-extra-pp":
    case "schedule-damage-debt":
      return {
        kind: "vital",
        timing: "before-resolution",
        action: command.kind,
        command,
      };
    case "shorten-status":
    case "prevent-status":
    case "prevent-volatile":
      return {
        kind: "condition",
        timing: "before-resolution",
        action: command.kind,
        command,
      };
    case "apply-status":
    case "cure-status":
    case "shorten-volatile":
    case "clear-negative-stages":
    case "clear-volatiles":
    case "reset-toxic-counter":
    case "lock-switching":
    case "prevent-switch":
      return {
        kind: "condition",
        timing: "after-resolution",
        action: command.kind,
        command,
      };
    case "set-weather":
    case "apply-directional-screen":
    case "carry-field-state":
      return {
        kind: "field",
        timing: "phase-boundary",
        action: command.kind,
        command,
      };
    case "grant-temporary-move":
      return {
        kind: "temporary-loadout",
        timing: "phase-boundary",
        action: "grant-move",
        command,
      };
    case "request-temporary-move-choice":
      return {
        kind: "choice",
        timing: "pause-and-resume",
        choice: "temporary-move",
        command,
      };
    case "grant-temporary-ability":
      return {
        kind: "temporary-loadout",
        timing: "phase-boundary",
        action: "grant-ability",
        command,
      };
    case "replace-move-temporarily":
      return {
        kind: "temporary-loadout",
        timing: "phase-boundary",
        action: "replace-move",
        command,
      };
    case "request-weather-choice":
      return {
        kind: "choice",
        timing: "pause-and-resume",
        choice: "weather",
        command,
      };
    case "request-terrain-choice":
      return {
        kind: "choice",
        timing: "pause-and-resume",
        choice: "terrain",
        command,
      };
    case "invalidate-lead":
    case "hide-enemy-information":
    case "set-enemy-roster-size":
    case "set-counter-weight":
    case "apply-enemy-stat-multiplier":
    case "set-boon-dormancy":
    case "conceal-boon-offer":
      return {
        kind: "encounter",
        timing:
          command.kind === "set-enemy-roster-size" || command.kind === "set-counter-weight"
            ? "generation"
            : "phase-boundary",
        action: command.kind,
        command,
      };
    case "mark-trigger":
      return { kind: "signal", timing: "after-resolution", command };
    default:
      return assertNever(command.kind);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled Moody runtime command: ${String(value)}`);
}

export function translateMoodyRuntimeResult(result: MoodyRuntimeFieldResult): readonly MoodyExecutableOperation[] {
  const operations = result.commands.map(translateMoodyRuntimeCommand);
  if (result.deltas.length > 0) {
    operations.push({
      kind: "persist-state",
      timing: "after-resolution",
      deltas: result.deltas,
      state: result.state,
    });
  }
  return operations;
}

export const MOODY_RUNTIME_FIELD_HOOK_SITES = [
  {
    path: "src/battle-scene.ts",
    symbol: "BattleScene.newBattle",
    anchor: "public newBattle(fromSession?: SessionSaveData): Battle",
    events: ["battle-start", "biome-transition"] as const,
  },
  {
    path: "src/battle-scene.ts",
    symbol: "BattleScene.generateEnemyModifiers",
    anchor: "generateEnemyModifiers(heldModifiersConfigs?: HeldModifierConfig[][]): Promise<void>",
    events: ["encounter-generate"] as const,
  },
  {
    path: "src/phases/move-phase.ts",
    symbol: "MovePhase.start",
    anchor: "public start(): void",
    events: ["before-move"] as const,
  },
  {
    path: "src/phases/move-phase.ts",
    symbol: "MovePhase.end",
    anchor: "public end(): void",
    events: ["move-resolved", "action-resolved"] as const,
  },
  {
    path: "src/field/pokemon.ts",
    symbol: "Pokemon.damage / Pokemon.damageAndUpdate",
    anchor: "damageAndUpdate(",
    events: ["before-damage", "after-damage", "heal", "barrier-ended"] as const,
  },
  {
    path: "src/field/pokemon.ts",
    symbol: "Pokemon.trySetStatus / Pokemon.doSetStatus",
    anchor: "public trySetStatus(",
    events: ["status-attempt", "status-applied", "status-cured", "volatile-attempt", "volatile-applied"] as const,
  },
  {
    path: "src/field/arena.ts",
    symbol: "Arena.trySetWeather / Arena.trySetTerrain",
    anchor: "public trySetWeather(weather: WeatherType, user?: Pokemon, turnsOverride?: number): boolean",
    events: ["weather-transition"] as const,
  },
  {
    path: "src/phases/switch-phase.ts",
    symbol: "SwitchPhase.start",
    anchor: "start()",
    events: ["switch-attempt", "entry", "lead-selection"] as const,
  },
  {
    path: "src/phases/faint-phase.ts",
    symbol: "FaintPhase.start / FaintPhase.doFaint",
    anchor: "public override start(): void",
    events: ["faint", "ko"] as const,
  },
  {
    path: "src/phases/turn-end-phase.ts",
    symbol: "TurnEndPhase.start",
    anchor: "start()",
    events: ["turn-start", "turn-end"] as const,
  },
  {
    path: "src/phases/victory-phase.ts",
    symbol: "VictoryPhase.start",
    anchor: "start()",
    events: ["battle-won"] as const,
  },
  {
    path: "src/phases/battle-end-phase.ts",
    symbol: "BattleEndPhase.start",
    anchor: "start()",
    events: ["battle-end"] as const,
  },
  {
    path: "src/phases/select-moody-boon-phase.ts",
    symbol: "SelectMoodyBoonPhase.start",
    anchor: "start(): void",
    events: ["boon-draft"] as const,
  },
] as const;
