import {
  createMoodyFormationRuntimeState,
  MOODY_FORMATION_RUNTIME_DEFINITIONS,
  type MoodyFormationCommand,
  type MoodyFormationEffect,
  type MoodyFormationEvent,
  type MoodyFormationPartySnapshot,
  type MoodyFormationPokemonSnapshot,
  type MoodyFormationRuntimeState,
  resolveMoodyFormationEffect,
} from "#data/elite-redux/moody/moody-runtime-formation";

export const MOODY_FORMATION_SAVE_VERSION = 1 as const;

export interface MoodyFormationRuntimeBinding {
  effect: MoodyFormationEffect;
  state: MoodyFormationRuntimeState;
  active: boolean;
  acquisitionOrder: number;
}

/** Plain JSON state. This is the complete formation payload MoodyModeSaveData must persist. */
export interface MoodyFormationRuntimeSaveDataV1 {
  version: typeof MOODY_FORMATION_SAVE_VERSION;
  sequence: number;
  bindings: readonly MoodyFormationRuntimeBinding[];
}

export type MoodyFormationRuntimeSession = MoodyFormationRuntimeSaveDataV1;

export interface MoodyFormationPokemonView extends MoodyFormationPokemonSnapshot {}

export interface MoodyFormationCommandContext {
  sequence: number;
  commandIndex: number;
  effectInstanceId: string;
  event: MoodyFormationEvent;
}

export type MoodyFormationCommandOfKind<K extends MoodyFormationCommand["kind"]> = Extract<
  MoodyFormationCommand,
  { kind: K }
>;

export type MoodyFormationCommandHandlers = {
  [K in MoodyFormationCommand["kind"]]: (
    command: MoodyFormationCommandOfKind<K>,
    context: MoodyFormationCommandContext,
  ) => void;
};

export type MoodyFormationPreflightResult = { ok: true } | { ok: false; reason: string };

export interface MoodyFormationCommandPort {
  /** Must be side-effect free. The entire batch is checked before the first command executes. */
  preflight(command: MoodyFormationCommand, context: MoodyFormationCommandContext): MoodyFormationPreflightResult;
  handlers: MoodyFormationCommandHandlers;
}

export interface MoodyFormationCommandEnvelope {
  effectInstanceId: string;
  command: MoodyFormationCommand;
}

export interface MoodyFormationDispatchTrace {
  effectInstanceId: string;
  triggered: boolean;
  commands: readonly MoodyFormationCommand[];
}

export interface MoodyFormationDispatchResult {
  session: MoodyFormationRuntimeSession;
  commands: readonly MoodyFormationCommandEnvelope[];
  traces: readonly MoodyFormationDispatchTrace[];
}

export type MoodyFormationResetBoundary = "turn" | "battle" | "wave" | "biome" | "run";

export const MOODY_FORMATION_PERSISTENCE_CONTRACT = {
  owner: "MoodyModeSaveData",
  field: "formationRuntime",
  version: MOODY_FORMATION_SAVE_VERSION,
  persistAfter: "every successful dispatch and before every save checkpoint",
  resetCadences: {
    turn: "No blanket deletion. turn-start and turn-complete events advance effect-owned state.",
    battle: "Delete every battle.* counter, flag, value, and list. battle-start also performs this reset.",
    wave: "No blanket deletion. wave-start advances wave-scoped mechanics deterministically.",
    biome: "No blanket deletion. biome-start advances biome-scoped mechanics deterministically.",
    run: "Recreate every registered binding state and reset sequence to zero; remove bindings separately when ending the run.",
  },
} as const;

function cloneTarget(effect: MoodyFormationEffect): MoodyFormationEffect["target"] {
  return {
    ...(effect.target.pokemonIds ? { pokemonIds: [...effect.target.pokemonIds] } : {}),
    ...(effect.target.partySlots ? { partySlots: [...effect.target.partySlots] } : {}),
    ...(effect.target.moveIds ? { moveIds: [...effect.target.moveIds] } : {}),
    ...(effect.target.itemStackIds ? { itemStackIds: [...effect.target.itemStackIds] } : {}),
    ...(effect.target.elementalType === undefined ? {} : { elementalType: effect.target.elementalType }),
    ...(effect.target.moveTag === undefined ? {} : { moveTag: effect.target.moveTag }),
  };
}

function cloneEffect(effect: MoodyFormationEffect): MoodyFormationEffect {
  return { ...effect, target: cloneTarget(effect) };
}

function cloneRuntimeState(state: MoodyFormationRuntimeState): MoodyFormationRuntimeState {
  return {
    counters: { ...state.counters },
    flags: { ...state.flags },
    values: { ...state.values },
    lists: Object.fromEntries(Object.entries(state.lists).map(([key, values]) => [key, [...values]])),
  };
}

function cloneBinding(binding: MoodyFormationRuntimeBinding): MoodyFormationRuntimeBinding {
  return {
    effect: cloneEffect(binding.effect),
    state: cloneRuntimeState(binding.state),
    active: binding.active,
    acquisitionOrder: binding.acquisitionOrder,
  };
}

function sortedBindings(bindings: readonly MoodyFormationRuntimeBinding[]): MoodyFormationRuntimeBinding[] {
  return [...bindings]
    .map(cloneBinding)
    .sort(
      (left, right) =>
        left.acquisitionOrder - right.acquisitionOrder || left.effect.instanceId.localeCompare(right.effect.instanceId),
    );
}

function assertValidEffect(effect: MoodyFormationEffect): void {
  const definition = MOODY_FORMATION_RUNTIME_DEFINITIONS[effect.boonId];
  if (!definition) {
    throw new Error(`Unknown Moody formation boon: ${String(effect.boonId)}`);
  }
  if (effect.rank === 3 && !definition.evolutionIds.includes(effect.evolutionId as never)) {
    throw new Error(`Invalid evolution ${String(effect.evolutionId)} for ${effect.boonId}`);
  }
}

function assertUniqueBindings(bindings: readonly MoodyFormationRuntimeBinding[]): void {
  const ids = new Set<string>();
  for (const binding of bindings) {
    assertValidEffect(binding.effect);
    if (!Number.isSafeInteger(binding.acquisitionOrder) || binding.acquisitionOrder < 0) {
      throw new Error(`Invalid acquisition order for ${binding.effect.instanceId}`);
    }
    if (ids.has(binding.effect.instanceId)) {
      throw new Error(`Duplicate Moody formation effect instance: ${binding.effect.instanceId}`);
    }
    ids.add(binding.effect.instanceId);
  }
}

export function createMoodyFormationRuntimeSession(
  effects: readonly MoodyFormationEffect[],
): MoodyFormationRuntimeSession {
  const bindings = effects.map((effect, acquisitionOrder) => ({
    effect: cloneEffect(effect),
    state: createMoodyFormationRuntimeState(),
    active: true,
    acquisitionOrder,
  }));
  assertUniqueBindings(bindings);
  return { version: MOODY_FORMATION_SAVE_VERSION, sequence: 0, bindings: sortedBindings(bindings) };
}

export function serializeMoodyFormationRuntimeSession(
  session: MoodyFormationRuntimeSession,
): MoodyFormationRuntimeSaveDataV1 {
  assertUniqueBindings(session.bindings);
  return {
    version: MOODY_FORMATION_SAVE_VERSION,
    sequence: session.sequence,
    bindings: sortedBindings(session.bindings),
  };
}

export function hydrateMoodyFormationRuntimeSession(
  saved: MoodyFormationRuntimeSaveDataV1,
): MoodyFormationRuntimeSession {
  if (saved.version !== MOODY_FORMATION_SAVE_VERSION) {
    throw new Error(`Unsupported Moody formation save version: ${String(saved.version)}`);
  }
  if (!Number.isSafeInteger(saved.sequence) || saved.sequence < 0) {
    throw new Error(`Invalid Moody formation sequence: ${String(saved.sequence)}`);
  }
  assertUniqueBindings(saved.bindings);
  return serializeMoodyFormationRuntimeSession(saved);
}

function clearStatePrefix(state: MoodyFormationRuntimeState, prefix: string): MoodyFormationRuntimeState {
  const filter = <T>(record: Readonly<Record<string, T>>): Record<string, T> =>
    Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith(prefix)));
  return {
    counters: filter(state.counters),
    flags: filter(state.flags),
    values: filter(state.values),
    lists: Object.fromEntries(
      Object.entries(state.lists)
        .filter(([key]) => !key.startsWith(prefix))
        .map(([key, values]) => [key, [...values]]),
    ),
  };
}

export function resetMoodyFormationRuntimeSession(
  session: MoodyFormationRuntimeSession,
  boundary: MoodyFormationResetBoundary,
): MoodyFormationRuntimeSession {
  if (boundary === "run") {
    return {
      version: MOODY_FORMATION_SAVE_VERSION,
      sequence: 0,
      bindings: sortedBindings(
        session.bindings.map(binding => ({ ...binding, state: createMoodyFormationRuntimeState() })),
      ),
    };
  }
  if (boundary !== "battle") {
    return serializeMoodyFormationRuntimeSession(session);
  }
  return {
    version: MOODY_FORMATION_SAVE_VERSION,
    sequence: session.sequence,
    bindings: sortedBindings(
      session.bindings.map(binding => ({ ...binding, state: clearStatePrefix(binding.state, "battle.") })),
    ),
  };
}

export function buildMoodyFormationPartySnapshot(
  pokemon: readonly MoodyFormationPokemonView[],
  capacity = 6,
): MoodyFormationPartySnapshot {
  if (!Number.isSafeInteger(capacity) || capacity < 1) {
    throw new Error(`Invalid party capacity: ${String(capacity)}`);
  }
  const slots: (MoodyFormationPokemonSnapshot | null)[] = Array.from({ length: capacity }, () => null);
  for (const view of pokemon) {
    if (!Number.isSafeInteger(view.partySlot) || view.partySlot < 0 || view.partySlot >= capacity) {
      throw new Error(`Pokemon ${view.pokemonId} has invalid party slot ${view.partySlot}`);
    }
    if (slots[view.partySlot] != null) {
      throw new Error(`Duplicate Moody formation party slot: ${view.partySlot}`);
    }
    slots[view.partySlot] = {
      ...view,
      ...(view.positiveStages ? { positiveStages: { ...view.positiveStages } } : {}),
      ...(view.negativeStages ? { negativeStages: { ...view.negativeStages } } : {}),
    };
  }
  return { slots };
}

function commandHandler<K extends MoodyFormationCommand["kind"]>(
  handlers: MoodyFormationCommandHandlers,
  kind: K,
): MoodyFormationCommandHandlers[K] {
  const handler = handlers[kind];
  if (typeof handler !== "function") {
    throw new Error(`Missing Moody formation command handler: ${kind}`);
  }
  return handler;
}

export function executeMoodyFormationCommand(
  port: MoodyFormationCommandPort,
  command: MoodyFormationCommand,
  context: MoodyFormationCommandContext,
): void {
  // The cast is confined to this total, keyed router; the mapped port type requires all command kinds.
  const handler = commandHandler(port.handlers, command.kind) as (
    value: MoodyFormationCommand,
    commandContext: MoodyFormationCommandContext,
  ) => void;
  handler(command, context);
}

export function dispatchMoodyFormationEvent(
  session: MoodyFormationRuntimeSession,
  event: MoodyFormationEvent,
  port: MoodyFormationCommandPort,
): MoodyFormationDispatchResult {
  assertUniqueBindings(session.bindings);
  const sequence = session.sequence + 1;
  const nextBindings: MoodyFormationRuntimeBinding[] = [];
  const commands: MoodyFormationCommandEnvelope[] = [];
  const traces: MoodyFormationDispatchTrace[] = [];

  for (const binding of sortedBindings(session.bindings)) {
    if (!binding.active) {
      nextBindings.push(binding);
      traces.push({ effectInstanceId: binding.effect.instanceId, triggered: false, commands: [] });
      continue;
    }
    const resolution = resolveMoodyFormationEffect(binding.effect, binding.state, event);
    nextBindings.push({ ...binding, state: resolution.state });
    traces.push({
      effectInstanceId: binding.effect.instanceId,
      triggered: resolution.triggered,
      commands: [...resolution.commands],
    });
    commands.push(...resolution.commands.map(command => ({ effectInstanceId: binding.effect.instanceId, command })));
  }

  const contexts = commands.map(
    (envelope, commandIndex): MoodyFormationCommandContext => ({
      sequence,
      commandIndex,
      effectInstanceId: envelope.effectInstanceId,
      event,
    }),
  );
  for (let index = 0; index < commands.length; index++) {
    const result = port.preflight(commands[index].command, contexts[index]);
    if (!result.ok) {
      throw new Error(
        `Moody formation command ${index} from ${commands[index].effectInstanceId} failed preflight: ${result.reason}`,
      );
    }
  }
  for (let index = 0; index < commands.length; index++) {
    executeMoodyFormationCommand(port, commands[index].command, contexts[index]);
  }

  return {
    session: {
      version: MOODY_FORMATION_SAVE_VERSION,
      sequence,
      bindings: sortedBindings(nextBindings),
    },
    commands,
    traces,
  };
}

export interface MoodyFormationHookMapEntry {
  id: string;
  file: string;
  symbol: string;
  anchor: string;
  timing: "before" | "after" | "around";
  events: readonly MoodyFormationEvent["type"][];
  commands: readonly MoodyFormationCommand["kind"][];
}

export interface MoodyFormationCommandExecutionMapEntry {
  kind: MoodyFormationCommand["kind"];
  file: string;
  symbol: string;
  integration: string;
}

/** APIs the typed command handlers should call; interception commands must be consumed at their named event seam. */
export const MOODY_FORMATION_COMMAND_EXECUTION_MAP = [
  {
    kind: "modify-action",
    file: "src/phases/move-phase.ts / src/phases/move-effect-phase.ts / src/field/pokemon.ts",
    symbol: "MovePhase.usePP / MoveEffectPhase.applyToTargets / Pokemon.getAttackDamage",
    integration:
      "Store the modifiers on the current action context, then consume each field at its PP, hit, or damage seam.",
  },
  {
    kind: "heal",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.heal",
    integration: "Resolve pokemonId and heal floor(maxHp * maxHpFraction).",
  },
  {
    kind: "barrier",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.addTag",
    integration: "Attach the Moody barrier battler tag with floor(maxHp * maxHpFraction) shield HP.",
  },
  {
    kind: "restore-pp",
    file: "src/data/moves/pokemon-move.ts",
    symbol: "PokemonMove.ppUsed",
    integration: "Reduce ppUsed for the selected move or every depleted move, clamped at zero.",
  },
  {
    kind: "stat-stage",
    file: "src/phases/stat-stage-change-phase.ts",
    symbol: "StatStageChangePhase",
    integration: "Queue a stat-stage phase and retain durationTurns in the Moody runtime tag when present.",
  },
  {
    kind: "clear-negative-stage",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.getStatStages / Pokemon.setStatStage",
    integration: "Clear the requested lowest-slot deterministic negative stages, or all of them.",
  },
  {
    kind: "clear-volatile",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.findAndRemoveTags",
    integration: "Remove the requested deterministic eligible volatile tags, or all of them.",
  },
  {
    kind: "clear-status",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.resetStatus",
    integration: "Reset the target's major status through the ordinary status phase path.",
  },
  {
    kind: "forced-switch-immunity",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.addTag / forced-switch eligibility checks",
    integration: "Attach a Moody immunity tag and consult it before forced-switch effects select the target.",
  },
  {
    kind: "echo",
    file: "src/phases/move-effect-phase.ts",
    symbol: "MoveEffectPhase post-target continuation",
    integration: "Queue one non-recursive virtual echo using powerFraction and optional offensiveStatOwnerId.",
  },
  {
    kind: "negate",
    file: "src/field/pokemon.ts / src/phases/stat-stage-change-phase.ts",
    symbol: "Pokemon.trySetStatus / Pokemon.addTag / StatStageChangePhase.start",
    integration: "Return before mutation at the matching status, volatile, or stat-drop directed event seam.",
  },
  {
    kind: "survive",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.damageAndUpdate",
    integration: "Clamp direct lethal damage so the target remains at the command's HP value.",
  },
  {
    kind: "experience-multiplier",
    file: "src/phases/exp-phase.ts",
    symbol: "ExpPhase.start",
    integration: "Multiply the target's mutable experience holder before final rounding.",
  },
  {
    kind: "max-hp-and-damage",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.getMaxHp / Pokemon.getAttackDamage",
    integration: "Apply the evaluated multipliers without rewriting base stats; preserve current HP exactly.",
  },
  {
    kind: "copy-secondary",
    file: "src/phases/move-effect-phase.ts",
    symbol: "MoveEffectPhase.triggerMoveEffects",
    integration: "Store the borrowed secondary on action context and consume one guaranteed use post-hit.",
  },
  {
    kind: "status-resistance",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.trySetStatus / Pokemon.addTag",
    integration: "Consult the evaluated resistance tier before committing the matching major or volatile status.",
  },
  {
    kind: "amplify-item",
    file: "src/modifier/modifier.ts",
    symbol: "PokemonHeldItemModifier.apply implementations",
    integration:
      "Use the declared adapter family to scale the successful activation without replaying unrelated onApply effects.",
  },
  {
    kind: "max-pp",
    file: "src/data/moves/pokemon-move.ts",
    symbol: "PokemonMove.getMovePp / PokemonMove.maxPpOverride",
    integration: "Add flatDelta to the runtime max-PP calculation for one move or every move without changing ppUsed.",
  },
  {
    kind: "repertoire-reward",
    file: "src/data/elite-redux/moody/moody-runtime-formation-adapter.ts",
    symbol: "MoodyFormationCommandHandlers.repertoire-reward",
    integration: "Translate the selected reward into one ordinary command and execute it in the same ordered batch.",
  },
  {
    kind: "choice-required",
    file: "src/ui/ui.ts",
    symbol: "UI mode/phase handoff",
    integration:
      "Suspend the action at the explicit choice boundary and resume with a selected finalDraftEndings event field.",
  },
  {
    kind: "disable-move",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.addTag",
    integration: "Attach a battle-duration disable tag for moveId.",
  },
  {
    kind: "mark",
    file: "src/data/elite-redux/moody/moody-state.ts",
    symbol: "MoodyModeSaveData runtime extension",
    integration:
      "Store the named presentation/integration marker in the save-owned runtime extension, never a module global.",
  },
] as const satisfies readonly MoodyFormationCommandExecutionMapEntry[];

/** Existing files remain untouched; these are the exact parent-owned integration seams. */
export const MOODY_FORMATION_HOOK_MAP = [
  {
    id: "wave-boundary",
    file: "src/phases/new-battle-phase.ts",
    symbol: "NewBattlePhase.start",
    anchor: "globalScene.newBattle()",
    timing: "after",
    events: ["wave-start", "biome-start"],
    commands: [],
  },
  {
    id: "final-party-battle-start",
    file: "src/phases/encounter-phase.ts",
    symbol: "EncounterPhase.start loadEnemyAssets continuation",
    anchor: "overrideHeldItems(enemy, false)",
    timing: "after",
    events: ["battle-start"],
    commands: ["max-pp", "max-hp-and-damage", "status-resistance", "experience-multiplier"],
  },
  {
    id: "turn-start",
    file: "src/phases/turn-init-phase.ts",
    symbol: "TurnInitPhase.start",
    anchor: "globalScene.eventTarget.dispatchEvent(new TurnInitEvent())",
    timing: "after",
    events: ["turn-start", "evaluate"],
    commands: ["heal", "barrier", "restore-pp", "stat-stage", "mark"],
  },
  {
    id: "turn-complete",
    file: "src/phases/turn-end-phase.ts",
    symbol: "TurnEndPhase.start",
    anchor: "globalScene.currentBattle.incrementTurn()",
    timing: "before",
    events: ["turn-complete"],
    commands: [],
  },
  {
    id: "entry",
    file: "src/phases/summon-phase.ts",
    symbol: "SummonPhase.queuePostSummon",
    anchor: "pokemon.turnData.summonedThisTurn = true",
    timing: "after",
    events: ["entry"],
    commands: ["heal", "barrier", "restore-pp", "stat-stage", "clear-negative-stage"],
  },
  {
    id: "switch-exit-entry",
    file: "src/phases/switch-summon-phase.ts",
    symbol: "SwitchSummonPhase.switchAndSummon",
    anchor: "this.lastPokemon.leaveField",
    timing: "around",
    events: ["switch", "exit", "entry"],
    commands: ["stat-stage", "clear-negative-stage", "clear-volatile", "forced-switch-immunity", "copy-secondary"],
  },
  {
    id: "move-attempt-and-pp",
    file: "src/phases/move-phase.ts",
    symbol: "MovePhase.start / MovePhase.usePP",
    anchor: "this.usePP()",
    timing: "before",
    events: ["move-attempt", "opponent-move"],
    commands: ["modify-action", "echo", "choice-required", "disable-move", "mark"],
  },
  {
    id: "move-resolution",
    file: "src/phases/move-effect-phase.ts",
    symbol: "MoveEffectPhase.postAnimCallback",
    anchor: "this.applyToTargets(user, targets)",
    timing: "after",
    events: ["move-resolved"],
    commands: ["repertoire-reward", "stat-stage", "restore-pp", "mark"],
  },
  {
    id: "damage-and-lethal",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.damageAndUpdate",
    anchor: "damage = this.damage(damage, ignoreSegments, isIndirectDamage, ignoreFaintPhase, result, isCritical)",
    timing: "before",
    events: ["damage-received", "lethal-check"],
    commands: ["modify-action", "survive", "mark"],
  },
  {
    id: "status-and-volatile",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.trySetStatus / Pokemon.addTag / Pokemon.clearStatus",
    anchor: "this.turnData.pendingStatus = effect / this.summonData.tags.push(newTag) / this.status = null",
    timing: "around",
    events: ["status-directed", "status-cured"],
    commands: ["negate", "clear-status", "clear-volatile", "status-resistance"],
  },
  {
    id: "stat-stage",
    file: "src/phases/stat-stage-change-phase.ts",
    symbol: "StatStageChangePhase.start",
    anchor: "pokemon.setStatStage(s, pokemon.getStatStage(s) + stages.value)",
    timing: "around",
    events: ["stat-drop-directed", "enemy-stat-increase"],
    commands: ["negate", "stat-stage"],
  },
  {
    id: "faint-and-knockout",
    file: "src/phases/faint-phase.ts",
    symbol: "FaintPhase.start / FaintPhase.doFaint",
    anchor: 'applyAbAttrs("PostKnockOutAbAttr", { pokemon: p, victim: pokemon })',
    timing: "around",
    events: ["fainted", "knockout", "final-conscious"],
    commands: ["heal", "restore-pp", "stat-stage", "clear-status", "barrier", "mark"],
  },
  {
    id: "held-item-activation",
    file: "src/modifier/modifier.ts",
    symbol: "PokemonHeldItemModifier.apply implementations",
    anchor: "successful held-item apply return path",
    timing: "after",
    events: ["item-activation"],
    commands: ["amplify-item"],
  },
  {
    id: "effective-stat-and-damage-query",
    file: "src/field/pokemon.ts",
    symbol: "Pokemon.getEffectiveStat / Pokemon.getMaxHp / Pokemon.getAttackDamage",
    anchor: "final calculated value before return",
    timing: "before",
    events: ["evaluate"],
    commands: ["modify-action", "max-hp-and-damage", "status-resistance"],
  },
  {
    id: "battle-end",
    file: "src/phases/battle-end-phase.ts",
    symbol: "BattleEndPhase.start",
    anchor: "snapshotBattleMoneyGainMultiplier()",
    timing: "before",
    events: ["battle-end"],
    commands: [],
  },
] as const satisfies readonly MoodyFormationHookMapEntry[];
