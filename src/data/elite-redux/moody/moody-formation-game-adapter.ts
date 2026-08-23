import { globalScene } from "#app/global-scene";
import { getMoodyEffectFlyoutCue, shouldShowMoodyEffectFlyout } from "#data/elite-redux/moody/moody-effect-flyout";
import { MOODY_PASSIVE_SUPPORTED_BOON_IDS } from "#data/elite-redux/moody/moody-effects";
import { recordMoodyRuntimeActionTriggers } from "#data/elite-redux/moody/moody-runtime-field-engine";
import {
  MOODY_FORMATION_REPERTOIRE_REWARDS,
  MOODY_FORMATION_RUNTIME_COVERAGE,
  type MoodyFormationCommand,
  type MoodyFormationEffect,
  type MoodyFormationEvent,
  type MoodyFormationFinalDraftEnding,
  type MoodyFormationMoveCategory,
  type MoodyFormationPokemonSnapshot,
  type MoodyFormationRepertoireReward,
  type MoodyFormationStat,
  type MoodyFormationStatus,
  resolveMoodyFormationEffect,
} from "#data/elite-redux/moody/moody-runtime-formation";
import {
  buildMoodyFormationPartySnapshot,
  createMoodyFormationRuntimeSession,
  dispatchMoodyFormationEvent,
  executeMoodyFormationCommand,
  hydrateMoodyFormationRuntimeSession,
  MOODY_FORMATION_SAVE_VERSION,
  type MoodyFormationCommandContext,
  type MoodyFormationCommandHandlers,
  type MoodyFormationRuntimeBinding,
  type MoodyFormationRuntimeSession,
} from "#data/elite-redux/moody/moody-runtime-formation-adapter";
import {
  getMoodyModeState,
  MOODY_BOON_BY_ID,
  setMoodyFormationEngineSaveData,
  setMoodyFormationRuntimeSaveData,
} from "#data/elite-redux/moody/moody-state";
import type { MoodyBoonInstance } from "#data/elite-redux/moody/moody-types";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { isVirtual, MoveUseMode } from "#enums/move-use-mode";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { MoodyFormationChoicePhase } from "#phases/moody-formation-choice-phase";

export const MOODY_FORMATION_COMMAND_KINDS = [
  "modify-action",
  "heal",
  "barrier",
  "restore-pp",
  "stat-stage",
  "clear-negative-stage",
  "clear-volatile",
  "clear-status",
  "forced-switch-immunity",
  "echo",
  "negate",
  "survive",
  "experience-multiplier",
  "max-hp-and-damage",
  "copy-secondary",
  "status-resistance",
  "amplify-item",
  "max-pp",
  "repertoire-reward",
  "choice-required",
  "disable-move",
  "mark",
] as const satisfies readonly MoodyFormationCommand["kind"][];

export const MOODY_FORMATION_HOOK_EVENTS = [
  "battle-start",
  "battle-end",
  "wave-start",
  "biome-start",
  "turn-start",
  "turn-complete",
  "entry",
  "switch",
  "exit",
  "move-attempt",
  "move-resolved",
  "damage-received",
  "lethal-check",
  "knockout",
  "fainted",
  "final-conscious",
  "status-directed",
  "stat-drop-directed",
  "status-cured",
  "enemy-stat-increase",
  "item-activation",
  "opponent-move",
  "evaluate",
] as const satisfies readonly MoodyFormationEvent["type"][];

type CommandOf<K extends MoodyFormationCommand["kind"]> = Extract<MoodyFormationCommand, { kind: K }>;

interface EchoResource {
  command: CommandOf<"echo">;
  moveId: number;
  targets: number[];
}

interface PendingChoiceResource {
  command: CommandOf<"choice-required">;
  effectInstanceId: string;
  event: Extract<MoodyFormationEvent, { type: "move-attempt" }>;
}

interface StatusResistanceResource {
  status: MoodyFormationStatus;
  tier: 1 | 2 | "immune";
}

export interface MoodyFormationEngineState {
  version: 1;
  battleId: string;
  wave: number;
  biome: number;
  commandCounts: Record<MoodyFormationCommand["kind"], number>;
  hookCounts: Record<MoodyFormationEvent["type"], number>;
  pendingActions: Record<string, CommandOf<"modify-action">[]>;
  barriers: Record<string, number>;
  forcedSwitchImmunity: Record<string, "while-active" | "battle">;
  echoes: Record<string, EchoResource[]>;
  activeEchoPower: Record<string, number>;
  activeEchoOffensiveOwner: Record<string, number>;
  negates: Record<string, number>;
  survived: Record<string, number>;
  experienceMultipliers: Record<string, number>;
  maxHpAndDamage: Record<string, CommandOf<"max-hp-and-damage">>;
  copiedSecondaries: Record<string, CommandOf<"copy-secondary">>;
  statusResistances: Record<string, StatusResistanceResource[]>;
  itemAmplifications: Record<string, CommandOf<"amplify-item">>;
  maxPp: Record<string, number>;
  repertoireRewards: Record<string, CommandOf<"repertoire-reward">[]>;
  pendingChoices: PendingChoiceResource[];
  disabledMoves: Record<string, number[]>;
  marks: Record<string, string | number | boolean>;
  timedMarks: Record<string, number>;
}

export interface MoodyFormationEnginePort {
  getMaxHp(pokemonId: number): number;
  heal(pokemonId: number, maxHpFraction: number): void;
  restorePp(pokemonId: number, moveId: number | undefined, amount: number, allDepletedMoves: boolean): void;
  queueStatStage(pokemonId: number, stat: MoodyFormationStat, stages: number): void;
  clearNegativeStages(pokemonId: number, count: number | "all"): void;
  clearVolatiles(pokemonId: number, count: number | "all"): void;
  clearStatus(pokemonId: number): void;
  queueEcho(pokemonId: number, moveId: number, targets: readonly number[]): void;
  presentSurvive(pokemonId: number): void;
  payMaxHpCost(pokemonId: number, maxHpFraction: number): void;
  setMaxPp(pokemonId: number, moveId: number | undefined, flatDelta: number, allMoves: boolean): void;
  announceChoice(
    options: readonly MoodyFormationFinalDraftEnding[],
    chooseCount: 1 | 2,
    resolve: (selected: readonly MoodyFormationFinalDraftEnding[]) => void,
  ): void;
}

const FORMATION_STATS: readonly [MoodyFormationStat, BattleStat][] = [
  ["attack", Stat.ATK],
  ["defense", Stat.DEF],
  ["specialAttack", Stat.SPATK],
  ["specialDefense", Stat.SPDEF],
  ["speed", Stat.SPD],
  ["accuracy", Stat.ACC],
  ["evasion", Stat.EVA],
];

const NEGATIVE_VOLATILES = new Set<BattlerTagType>([
  BattlerTagType.CONFUSED,
  BattlerTagType.INFATUATED,
  BattlerTagType.SEEDED,
  BattlerTagType.NIGHTMARE,
  BattlerTagType.OCTOLOCK,
  BattlerTagType.DROWSY,
  BattlerTagType.TRAPPED,
  BattlerTagType.SALT_CURED,
  BattlerTagType.CURSED,
  BattlerTagType.DISABLED,
  BattlerTagType.TORMENT,
  BattlerTagType.TAUNT,
  BattlerTagType.ER_BLEED,
  BattlerTagType.ER_FROSTBITE,
  BattlerTagType.ER_FEAR,
]);

const MOVE_TAG_FLAGS: readonly [MoveFlags, readonly string[]][] = [
  [MoveFlags.MAKES_CONTACT, ["contact"]],
  [MoveFlags.SOUND_BASED, ["sound"]],
  [MoveFlags.BITING_MOVE, ["bite", "biting"]],
  [MoveFlags.PULSE_MOVE, ["pulse"]],
  [MoveFlags.PUNCHING_MOVE, ["punch", "punching"]],
  [MoveFlags.SLICING_MOVE, ["slice", "slicing"]],
  [MoveFlags.RECKLESS_MOVE, ["recoil", "reckless"]],
  [MoveFlags.BALLBOMB_MOVE, ["bullet", "ball", "bomb"]],
  [MoveFlags.POWDER_MOVE, ["powder"]],
  [MoveFlags.DANCE_MOVE, ["dance"]],
  [MoveFlags.WIND_MOVE, ["wind"]],
  [MoveFlags.AIR_BASED, ["air"]],
  [MoveFlags.ARROW_BASED, ["arrow"]],
  [MoveFlags.BONE_BASED, ["bone"]],
  [MoveFlags.DRILL_BASED, ["drill"]],
  [MoveFlags.FIELD_BASED, ["field"]],
  [MoveFlags.HAMMER_BASED, ["hammer"]],
  [MoveFlags.HORN_BASED, ["horn"]],
  [MoveFlags.KICKING_MOVE, ["kick", "kicking"]],
  [MoveFlags.LUNAR_MOVE, ["lunar"]],
  [MoveFlags.THROW_BASED, ["throw"]],
  [MoveFlags.WEATHER_BASED, ["weather"]],
];

const PENDING_ALLY_FAINT_ENTRY_MARK = "pending-ally-faint-entry";
const FORMATION_ENTRY_SEEN_MARK_PREFIX = "battle-entry-seen:";

function activeFormationBoon(boonId: string): readonly MoodyBoonInstance[] {
  return getMoodyModeState()?.boons.filter(boon => boon.boonId === boonId && boon.dormant !== true) ?? [];
}

function borrowableSecondaryIds(move: Move): readonly string[] {
  if (move.category === MoveCategory.STATUS || move.power <= 0) {
    return [];
  }
  const ids: string[] = [];
  if (move.hasAttr("FlinchAttr")) {
    ids.push(`move:${move.id}:flinch`);
  }
  if (move.hasAttr("ConfuseAttr")) {
    ids.push(`move:${move.id}:confuse`);
  }
  for (const attr of move.getAttrs("StatusEffectAttr")) {
    if (!attr.selfTarget) {
      ids.push(`move:${move.id}:status:${attr.effect}`);
    }
  }
  for (const attr of move.getAttrs("StatStageChangeAttr")) {
    if (!attr.selfTarget && attr.stages < 0) {
      ids.push(`move:${move.id}:stages:${attr.stats.join(",")}:${attr.stages}`);
    }
  }
  return [...new Set(ids)];
}

export function selectMoodyFormationBorrowedSecondaryId(outgoing: Pokemon): string | undefined {
  const eligible = outgoing.getMoveset().flatMap(pokemonMove => borrowableSecondaryIds(pokemonMove.getMove()));
  if (eligible.length === 0) {
    return;
  }
  return eligible[outgoing.randBattleSeedInt(eligible.length)];
}

export function selectMoodyFormationRepertoireRewards(user: Pokemon): readonly MoodyFormationRepertoireReward[] {
  const rewards = [...MOODY_FORMATION_REPERTOIRE_REWARDS];
  for (let index = rewards.length - 1; index > 0; index--) {
    const selected = user.randBattleSeedInt(index + 1);
    const current = rewards[index]!;
    rewards[index] = rewards[selected]!;
    rewards[selected] = current;
  }
  return rewards;
}

export function selectMoodyFormationAdjacentPokemonId(owner: Pokemon, party: readonly Pokemon[]): number | undefined {
  const ownerSlot = party.indexOf(owner);
  if (ownerSlot < 0) {
    return;
  }
  const eligible = party.filter(
    (pokemon, partySlot) =>
      pokemon.id !== owner.id && Math.abs(partySlot - ownerSlot) === 1 && !pokemon.isFainted(true),
  );
  if (eligible.length === 0) {
    return;
  }
  return eligible[owner.randBattleSeedInt(eligible.length)]?.id;
}

function zeroRecord<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map(key => [key, 0])) as Record<K, number>;
}

export function createEmptyMoodyFormationEngineState(): MoodyFormationEngineState {
  return {
    version: 1,
    battleId: "",
    wave: 0,
    biome: -1,
    commandCounts: zeroRecord(MOODY_FORMATION_COMMAND_KINDS),
    hookCounts: zeroRecord(MOODY_FORMATION_HOOK_EVENTS),
    pendingActions: {},
    barriers: {},
    forcedSwitchImmunity: {},
    echoes: {},
    activeEchoPower: {},
    activeEchoOffensiveOwner: {},
    negates: {},
    survived: {},
    experienceMultipliers: {},
    maxHpAndDamage: {},
    copiedSecondaries: {},
    statusResistances: {},
    itemAmplifications: {},
    maxPp: {},
    repertoireRewards: {},
    pendingChoices: [],
    disabledMoves: {},
    marks: {},
    timedMarks: {},
  };
}

function readEngineState(): MoodyFormationEngineState {
  const saved = getMoodyModeState()?.formationEngine;
  if (saved == null) {
    return createEmptyMoodyFormationEngineState();
  }
  try {
    const parsed = JSON.parse(saved.stateJson) as Partial<MoodyFormationEngineState>;
    const empty = createEmptyMoodyFormationEngineState();
    return {
      ...empty,
      ...parsed,
      version: 1,
      commandCounts: { ...empty.commandCounts, ...parsed.commandCounts },
      hookCounts: { ...empty.hookCounts, ...parsed.hookCounts },
      pendingActions: { ...parsed.pendingActions },
      barriers: { ...parsed.barriers },
      forcedSwitchImmunity: { ...parsed.forcedSwitchImmunity },
      echoes: { ...parsed.echoes },
      activeEchoPower: { ...parsed.activeEchoPower },
      activeEchoOffensiveOwner: { ...parsed.activeEchoOffensiveOwner },
      negates: { ...parsed.negates },
      survived: { ...parsed.survived },
      experienceMultipliers: { ...parsed.experienceMultipliers },
      maxHpAndDamage: { ...parsed.maxHpAndDamage },
      copiedSecondaries: { ...parsed.copiedSecondaries },
      statusResistances: { ...parsed.statusResistances },
      itemAmplifications: { ...parsed.itemAmplifications },
      maxPp: { ...parsed.maxPp },
      repertoireRewards: { ...parsed.repertoireRewards },
      pendingChoices: [...(parsed.pendingChoices ?? [])],
      disabledMoves: { ...parsed.disabledMoves },
      marks: { ...parsed.marks },
      timedMarks: { ...parsed.timedMarks },
    };
  } catch {
    return createEmptyMoodyFormationEngineState();
  }
}

function writeEngineState(state: MoodyFormationEngineState): void {
  setMoodyFormationEngineSaveData({ version: 1, stateJson: JSON.stringify(state) });
}

export function getMoodyFormationEngineState(): Readonly<MoodyFormationEngineState> {
  return structuredClone(readEngineState());
}

export interface MoodyFormationHudPokemonSnapshot {
  readonly pokemonId: number;
  readonly barrier: number;
  readonly marks: Readonly<Record<string, string | number | boolean>>;
}

export interface MoodyFormationHudSnapshot {
  readonly activePlayer: readonly MoodyFormationHudPokemonSnapshot[];
}

export function getMoodyFormationHudSnapshot(): MoodyFormationHudSnapshot {
  const engine = readEngineState();
  return {
    activePlayer: globalScene.getPlayerField(true).map(pokemon => {
      const prefix = `${pokemon.id}:`;
      const pokemonSuffix = `:pokemon:${pokemon.id}`;
      return {
        pokemonId: pokemon.id,
        barrier: engine.barriers[actionKey(pokemon.id)] ?? 0,
        marks: Object.fromEntries(
          Object.entries(engine.marks).filter(([key]) => key.startsWith(prefix) || key.endsWith(pokemonSuffix)),
        ),
      };
    }),
  };
}

function pokemonById(pokemonId: number): Pokemon | undefined {
  return globalScene.getPokemonById(pokemonId) ?? undefined;
}

function battleStat(stat: MoodyFormationStat): BattleStat | undefined {
  return FORMATION_STATS.find(([name]) => name === stat)?.[1];
}

export function moodyFormationStatFromBattleStat(stat: BattleStat): MoodyFormationStat | undefined {
  return FORMATION_STATS.find(([, candidate]) => candidate === stat)?.[0];
}

export const LIVE_MOODY_FORMATION_ENGINE_PORT: MoodyFormationEnginePort = {
  getMaxHp(pokemonId) {
    return pokemonById(pokemonId)?.getMaxHp() ?? 100;
  },
  heal(pokemonId, maxHpFraction) {
    const pokemon = pokemonById(pokemonId);
    if (pokemon != null) {
      pokemon.heal(Math.max(1, Math.floor(pokemon.getMaxHp() * maxHpFraction)));
    }
  },
  restorePp(pokemonId, moveId, amount, allDepletedMoves) {
    const pokemon = pokemonById(pokemonId);
    const moves = pokemon
      ?.getMoveset()
      .filter(move => (allDepletedMoves ? move.ppUsed > 0 : moveId == null || move.moveId === moveId));
    for (const move of moves ?? []) {
      move.ppUsed = Math.max(0, move.ppUsed - amount);
    }
  },
  queueStatStage(pokemonId, stat, stages) {
    const pokemon = pokemonById(pokemonId);
    const resolvedStat = battleStat(stat);
    if (pokemon != null && resolvedStat != null) {
      globalScene.phaseManager.unshiftNew(
        "StatStageChangePhase",
        pokemon.getBattlerIndex(),
        true,
        [resolvedStat],
        stages,
      );
    }
  },
  clearNegativeStages(pokemonId, count) {
    const pokemon = pokemonById(pokemonId);
    if (pokemon == null) {
      return;
    }
    const negative = FORMATION_STATS.filter(([, stat]) => pokemon.getStatStage(stat) < 0);
    for (const [, stat] of count === "all" ? negative : negative.slice(0, count)) {
      pokemon.setStatStage(stat, 0);
    }
  },
  clearVolatiles(pokemonId, count) {
    const pokemon = pokemonById(pokemonId);
    if (pokemon == null) {
      return;
    }
    let remaining = count === "all" ? Number.MAX_SAFE_INTEGER : count;
    pokemon.findAndRemoveTags(tag => {
      const remove = remaining > 0 && NEGATIVE_VOLATILES.has(tag.tagType);
      if (remove) {
        remaining--;
      }
      return remove;
    });
  },
  clearStatus(pokemonId) {
    const pokemon = pokemonById(pokemonId);
    if (pokemon?.status != null) {
      pokemon.clearStatus(false, false);
    }
  },
  queueEcho(pokemonId, moveId, targets) {
    const pokemon = pokemonById(pokemonId);
    const pokemonMove = pokemon?.getMoveset().find(candidate => candidate.moveId === moveId);
    const battlerTargets = targets
      .map(targetId => pokemonById(targetId)?.getBattlerIndex())
      .filter((target): target is number => target != null);
    if (pokemon != null && pokemonMove != null && moveId !== MoveId.NONE && battlerTargets.length > 0) {
      globalScene.phaseManager.unshiftNew("MovePhase", pokemon, battlerTargets, pokemonMove, MoveUseMode.FOLLOW_UP);
    }
  },
  presentSurvive(pokemonId) {
    const pokemon = pokemonById(pokemonId);
    if (pokemon != null) {
      globalScene.phaseManager.queueMessage(`${pokemon.name} endured the hit!`, null, true);
    }
  },
  payMaxHpCost(pokemonId, maxHpFraction) {
    const pokemon = pokemonById(pokemonId);
    if (pokemon != null) {
      pokemon.damageAndUpdate(Math.max(1, Math.floor(pokemon.getMaxHp() * maxHpFraction)));
    }
  },
  setMaxPp(pokemonId, moveId, flatDelta, allMoves) {
    const pokemon = pokemonById(pokemonId);
    for (const move of pokemon?.getMoveset() ?? []) {
      if (allMoves || moveId == null || move.moveId === moveId) {
        move.maxPpOverride = Math.max(1, move.getMovePp() + flatDelta);
      }
    }
  },
  announceChoice(options, chooseCount, resolve) {
    globalScene.phaseManager.unshiftPhase(new MoodyFormationChoicePhase(options, chooseCount, resolve));
  },
};

function statusOf(pokemon: Pokemon): MoodyFormationStatus | undefined {
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
      return pokemon.getTag(BattlerTagType.ER_FROSTBITE) == null ? undefined : "frostbite";
  }
}

function highestStat(
  pokemon: Pokemon,
  stats: readonly [MoodyFormationStat, BattleStat][],
): MoodyFormationStat | undefined {
  return stats.toSorted((left, right) => (pokemon.stats[right[1]] ?? 0) - (pokemon.stats[left[1]] ?? 0))[0]?.[0];
}

export function snapshotMoodyFormationPokemon(pokemon: Pokemon): MoodyFormationPokemonSnapshot {
  const party: readonly Pokemon[] = pokemon.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
  const positiveStages: Partial<Record<MoodyFormationStat, number>> = {};
  const negativeStages: Partial<Record<MoodyFormationStat, number>> = {};
  for (const [name, stat] of FORMATION_STATS) {
    const stage = pokemon.getStatStage(stat);
    if (stage > 0) {
      positiveStages[name] = stage;
    }
    if (stage < 0) {
      negativeStages[name] = stage;
    }
  }
  const moves = pokemon.getMoveset().filter(move => move.getMovePp() >= 0);
  const mostDepleted = moves.toSorted(
    (left, right) => right.ppUsed / Math.max(1, right.getMovePp()) - left.ppUsed / Math.max(1, left.getMovePp()),
  )[0];
  const status = statusOf(pokemon);
  return {
    pokemonId: pokemon.id,
    partySlot: Math.max(0, party.indexOf(pokemon)),
    currentHp: pokemon.hp,
    maxHp: pokemon.getMaxHp(),
    conscious: !pokemon.isFainted(true),
    ...(status == null ? {} : { majorStatus: status }),
    positiveStages,
    negativeStages,
    highestOffensiveStat: highestStat(pokemon, [
      ["attack", Stat.ATK],
      ["specialAttack", Stat.SPATK],
    ]) as "attack" | "specialAttack",
    highestNonHpStat: highestStat(pokemon, FORMATION_STATS.slice(0, 5)) as Exclude<
      MoodyFormationStat,
      "accuracy" | "evasion"
    >,
    highestDefensiveStat: highestStat(pokemon, [
      ["defense", Stat.DEF],
      ["specialDefense", Stat.SPDEF],
    ]) as "defense" | "specialDefense",
    ...(mostDepleted == null ? {} : { mostDepletedMoveId: mostDepleted.moveId }),
    allPpFull: moves.every(move => move.ppUsed === 0),
  };
}

function playerPartySnapshot() {
  return buildMoodyFormationPartySnapshot(
    globalScene.getPlayerParty().map(pokemon => snapshotMoodyFormationPokemon(pokemon)),
  );
}

function toFormationEffect(boon: MoodyBoonInstance): MoodyFormationEffect | null {
  if (!MOODY_FORMATION_RUNTIME_COVERAGE.has(boon.boonId as never)) {
    return null;
  }
  return {
    instanceId: boon.instanceId,
    boonId: boon.boonId as MoodyFormationEffect["boonId"],
    rank: boon.rank,
    ...(boon.evolutionId == null
      ? {}
      : { evolutionId: boon.evolutionId as NonNullable<MoodyFormationEffect["evolutionId"]> }),
    target: {
      ...(boon.target?.pokemonIds == null ? {} : { pokemonIds: [...boon.target.pokemonIds] }),
      ...(boon.target?.partySlots == null ? {} : { partySlots: [...boon.target.partySlots] }),
      ...(boon.target?.moveIds == null ? {} : { moveIds: [...boon.target.moveIds] }),
      ...(boon.target?.itemTypeIds == null ? {} : { itemStackIds: [...boon.target.itemTypeIds] }),
      ...(boon.target?.pokemonType == null ? {} : { elementalType: String(boon.target.pokemonType) }),
      ...(boon.target?.option == null ? {} : { moveTag: boon.target.option }),
    },
  };
}

function reconcileSession(): MoodyFormationRuntimeSession | null {
  const state = getMoodyModeState();
  if (state == null) {
    return null;
  }
  const effects = state.boons.map(toFormationEffect).filter((effect): effect is MoodyFormationEffect => effect != null);
  if (state.formationRuntime == null) {
    return createMoodyFormationRuntimeSession(effects);
  }
  const saved = hydrateMoodyFormationRuntimeSession(state.formationRuntime);
  const previous = new Map(saved.bindings.map(binding => [binding.effect.instanceId, binding]));
  const bindings: MoodyFormationRuntimeBinding[] = effects.map((effect, acquisitionOrder) => ({
    effect,
    state: previous.get(effect.instanceId)?.state ?? { counters: {}, flags: {}, values: {}, lists: {} },
    active: state.boons.find(candidate => candidate.instanceId === effect.instanceId)?.dormant !== true,
    acquisitionOrder,
  }));
  return { version: MOODY_FORMATION_SAVE_VERSION, sequence: saved.sequence, bindings };
}

function targetIdFromContext(context: MoodyFormationCommandContext): number | undefined {
  const event = context.event;
  if ("target" in event) {
    return event.target.pokemonId;
  }
  if (event.type === "status-cured") {
    return event.pokemon.pokemonId;
  }
  return;
}

function actionKey(pokemonId: number): string {
  return String(pokemonId);
}

function resistanceKey(pokemonId: number): string {
  return String(pokemonId);
}

function negateKey(pokemonId: number, event: CommandOf<"negate">["event"]): string {
  return `${pokemonId}:${event}`;
}

function itemKey(pokemonId: number, itemStackId: string): string {
  return `${pokemonId}:${itemStackId}`;
}

function maxPpKey(pokemonId: number, moveId: number | undefined): string {
  return `${pokemonId}:${moveId ?? "all"}`;
}

function subjectIdFromContext(context: MoodyFormationCommandContext): number | undefined {
  const event = context.event;
  if ("user" in event) {
    return event.user.pokemonId;
  }
  if ("pokemon" in event) {
    return typeof event.pokemon === "number" ? event.pokemon : event.pokemon.pokemonId;
  }
  if ("incoming" in event) {
    return event.incoming.pokemonId;
  }
  if ("attacker" in event) {
    return event.attacker.pokemonId;
  }
  return targetIdFromContext(context);
}

function markKey(command: CommandOf<"mark">, context: MoodyFormationCommandContext): string {
  return `${command.pokemonId ?? subjectIdFromContext(context) ?? "global"}:${command.name}`;
}

function passiveOwnsCommand(command: MoodyFormationCommand): boolean {
  if (!MOODY_PASSIVE_SUPPORTED_BOON_IDS.has(command.source)) {
    return false;
  }
  return (
    command.kind === "modify-action"
    || command.kind === "experience-multiplier"
    || command.kind === "max-hp-and-damage"
    || command.kind === "max-pp"
    || (command.kind === "mark" && command.name !== "maxHpCost")
  );
}

function pushAction(engine: MoodyFormationEngineState, command: CommandOf<"modify-action">): void {
  const key = actionKey(command.pokemonId);
  engine.pendingActions[key] = [...(engine.pendingActions[key] ?? []), command];
}

function triggerStatName(stat: MoodyFormationStat): string {
  switch (stat) {
    case "specialAttack":
      return "Sp. Atk";
    case "specialDefense":
      return "Sp. Def";
    default:
      return stat.charAt(0).toUpperCase() + stat.slice(1);
  }
}

function formationCommandTriggerLabel(command: MoodyFormationCommand): string {
  switch (command.kind) {
    case "modify-action":
      return "action modified";
    case "heal":
      return `heal ${Math.round(command.maxHpFraction * 100)}%`;
    case "barrier":
      return `+${Math.round(command.maxHpFraction * 100)}% barrier`;
    case "restore-pp":
      return `restore ${command.amount} PP`;
    case "stat-stage":
      return `${command.stages > 0 ? "+" : ""}${command.stages} ${triggerStatName(command.stat)}`;
    case "clear-negative-stage":
      return "negative stages cleared";
    case "clear-volatile":
      return "volatile conditions cleared";
    case "clear-status":
      return "status cleared";
    case "forced-switch-immunity":
      return "forced-switch immunity";
    case "echo":
      return `${Math.round(command.powerFraction * 100)}% echo`;
    case "negate":
      return `${command.event} negated`;
    case "survive":
      return `survive at ${command.hp} HP`;
    case "experience-multiplier":
      return `${command.multiplier}x experience`;
    case "max-hp-and-damage":
      return `${command.maxHpMultiplier}x HP and damage`;
    case "copy-secondary":
      return `borrow ${command.secondaryId}`;
    case "status-resistance":
      return `${command.status} resistance ${command.tier}`;
    case "amplify-item":
      return `${command.multiplier}x item effect`;
    case "max-pp":
      return `+${command.flatDelta} max PP`;
    case "repertoire-reward":
      return `repertoire: ${command.reward}`;
    case "choice-required":
      return "choice required";
    case "disable-move":
      return `move ${command.moveId} disabled`;
    case "mark":
      return `${command.name}: ${String(command.value)}`;
  }
}

function emitMoodyFormationTriggers(
  event: MoodyFormationEvent,
  traces: readonly { effectInstanceId: string; triggered: boolean; commands: readonly MoodyFormationCommand[] }[],
  session: MoodyFormationRuntimeSession,
): void {
  const effects = new Map(session.bindings.map(binding => [binding.effect.instanceId, binding.effect]));
  const emitted = new Set<string>();
  for (const trace of traces) {
    if (!trace.triggered || trace.commands.length === 0) {
      continue;
    }
    const key = `${trace.effectInstanceId}:${event.type}`;
    if (emitted.has(key)) {
      continue;
    }
    emitted.add(key);
    const effect = effects.get(trace.effectInstanceId);
    if (
      effect == null
      || !shouldShowMoodyEffectFlyout(effect.boonId)
      || (effect.boonId === "turntable" && event.type !== "turn-start")
    ) {
      continue;
    }
    const name = MOODY_BOON_BY_ID.get(effect.boonId)?.name ?? effect.boonId;
    const details = [...new Set(trace.commands.map(formationCommandTriggerLabel))];
    const cue = getMoodyEffectFlyoutCue(getMoodyModeState()!, effect.boonId);
    globalScene.ui?.pushMoodyTrigger(`${name}: ${details.join(", ")}`, cue);
  }
}

function formationActionOwnerId(event: MoodyFormationEvent): number | undefined {
  switch (event.type) {
    case "move-attempt":
    case "move-resolved":
      return event.user.pokemonId;
    case "knockout":
      return event.attacker.pokemonId;
    case "switch":
      return event.incoming.pokemonId;
    case "entry":
    case "fainted":
    case "final-conscious":
    case "status-cured":
    case "evaluate":
      return event.pokemon.pokemonId;
    case "turn-complete":
    case "exit":
    case "item-activation":
      return event.pokemonId;
    default:
      return;
  }
}

function recordMoodyFormationActionTriggers(
  event: MoodyFormationEvent,
  traces: readonly { effectInstanceId: string; triggered: boolean }[],
  session: MoodyFormationRuntimeSession,
): void {
  const pokemonId = formationActionOwnerId(event);
  if (pokemonId == null || pokemonById(pokemonId)?.isPlayer() !== true) {
    return;
  }
  const boonIdByInstance = new Map(
    session.bindings.map(binding => [binding.effect.instanceId, binding.effect.boonId] as const),
  );
  const triggeredBoonIds = [
    ...new Set(
      traces
        .filter(trace => trace.triggered)
        .flatMap(trace => {
          const boonId = boonIdByInstance.get(trace.effectInstanceId);
          return boonId == null ? [] : [boonId];
        }),
    ),
  ];
  recordMoodyRuntimeActionTriggers(pokemonId, triggeredBoonIds);
}

function applyRepertoireReward(
  command: CommandOf<"repertoire-reward">,
  engine: MoodyFormationEngineState,
  port: MoodyFormationEnginePort,
): void {
  const amount = command.magnitudeMultiplier;
  const key = actionKey(command.pokemonId);
  switch (command.reward) {
    case "barrier":
      engine.barriers[key] =
        (engine.barriers[key] ?? 0) + Math.max(1, Math.floor(0.15 * amount * port.getMaxHp(command.pokemonId)));
      break;
    case "heal":
      port.heal(command.pokemonId, 0.15 * amount);
      break;
    case "restore-pp":
      port.restorePp(command.pokemonId, undefined, Math.max(1, Math.floor(2 * amount)), true);
      break;
    case "cleanse":
      port.clearStatus(command.pokemonId);
      port.clearVolatiles(command.pokemonId, "all");
      break;
    case "random-stat":
      port.queueStatStage(command.pokemonId, "attack", Math.max(1, Math.floor(amount)));
      break;
    case "next-priority":
      pushAction(engine, {
        kind: "modify-action",
        source: command.source,
        pokemonId: command.pokemonId,
        priorityDelta: Math.max(1, Math.floor(amount)),
      });
      break;
    case "next-secondary":
      pushAction(engine, {
        kind: "modify-action",
        source: command.source,
        pokemonId: command.pokemonId,
        guaranteeSecondary: true,
      });
      break;
    case "type-resistance":
      engine.statusResistances[resistanceKey(command.pokemonId)] = [
        ...(engine.statusResistances[resistanceKey(command.pokemonId)] ?? []),
        { status: "frostbite", tier: amount >= 2 ? "immune" : 2 },
      ];
      break;
  }
}

export function createMoodyFormationCommandHandlers(
  engine: MoodyFormationEngineState,
  port: MoodyFormationEnginePort,
): MoodyFormationCommandHandlers {
  const count = (kind: MoodyFormationCommand["kind"]): void => {
    engine.commandCounts[kind]++;
  };
  return {
    "modify-action": command => {
      count(command.kind);
      if (passiveOwnsCommand(command)) {
        engine.marks[`passive-owned:${command.source}:${command.pokemonId}`] = true;
      } else {
        pushAction(engine, command);
      }
    },
    heal: command => {
      count(command.kind);
      port.heal(command.pokemonId, command.maxHpFraction);
    },
    barrier: command => {
      count(command.kind);
      const key = actionKey(command.pokemonId);
      engine.barriers[key] =
        (engine.barriers[key] ?? 0) + Math.max(1, Math.floor(port.getMaxHp(command.pokemonId) * command.maxHpFraction));
    },
    "restore-pp": command => {
      count(command.kind);
      port.restorePp(command.pokemonId, command.moveId, command.amount, command.allDepletedMoves === true);
    },
    "stat-stage": (command, context) => {
      count(command.kind);
      port.queueStatStage(command.pokemonId, command.stat, command.stages);
      if (command.durationTurns != null) {
        const key = `${command.pokemonId}:temporary-stage:${command.stat}:${context.sequence}:${context.commandIndex}:${context.effectInstanceId}`;
        engine.marks[key] = command.stages;
        engine.timedMarks[key] = command.durationTurns;
      }
    },
    "clear-negative-stage": command => {
      count(command.kind);
      port.clearNegativeStages(command.pokemonId, command.count);
    },
    "clear-volatile": command => {
      count(command.kind);
      port.clearVolatiles(command.pokemonId, command.count);
    },
    "clear-status": command => {
      count(command.kind);
      port.clearStatus(command.pokemonId);
    },
    "forced-switch-immunity": command => {
      count(command.kind);
      engine.forcedSwitchImmunity[actionKey(command.pokemonId)] = command.duration;
    },
    echo: (command, context) => {
      count(command.kind);
      const event = context.event;
      const moveId = event.type === "move-attempt" ? event.moveId : MoveId.NONE;
      const targets = event.type === "move-attempt" && event.targetPokemonId != null ? [event.targetPokemonId] : [];
      const resource = { command, moveId, targets };
      engine.echoes[actionKey(command.pokemonId)] = [...(engine.echoes[actionKey(command.pokemonId)] ?? []), resource];
      if (moveId !== MoveId.NONE && targets.length > 0) {
        port.queueEcho(command.pokemonId, moveId, targets);
      }
    },
    negate: (command, context) => {
      count(command.kind);
      const pokemonId = targetIdFromContext(context);
      if (pokemonId != null) {
        const key = negateKey(pokemonId, command.event);
        engine.negates[key] = (engine.negates[key] ?? 0) + 1;
      }
    },
    survive: command => {
      count(command.kind);
      engine.survived[actionKey(command.pokemonId)] = command.hp;
      port.presentSurvive(command.pokemonId);
    },
    "experience-multiplier": command => {
      count(command.kind);
      if (passiveOwnsCommand(command)) {
        engine.marks[`passive-owned:${command.source}:${command.pokemonId}`] = true;
      } else {
        engine.experienceMultipliers[actionKey(command.pokemonId)] = command.multiplier;
      }
    },
    "max-hp-and-damage": command => {
      count(command.kind);
      if (passiveOwnsCommand(command)) {
        engine.marks[`passive-owned:${command.source}:${command.pokemonId}`] = true;
      } else {
        engine.maxHpAndDamage[actionKey(command.pokemonId)] = command;
      }
    },
    "copy-secondary": command => {
      count(command.kind);
      engine.copiedSecondaries[actionKey(command.pokemonId)] = command;
    },
    "status-resistance": command => {
      count(command.kind);
      const key = resistanceKey(command.pokemonId);
      engine.statusResistances[key] = [
        ...(engine.statusResistances[key] ?? []).filter(resource => resource.status !== command.status),
        { status: command.status, tier: command.tier },
      ];
    },
    "amplify-item": command => {
      count(command.kind);
      engine.itemAmplifications[itemKey(command.pokemonId, command.itemStackId)] = command;
    },
    "max-pp": command => {
      count(command.kind);
      const key = maxPpKey(command.pokemonId, command.moveId);
      const firstApplication = engine.maxPp[key] == null;
      engine.maxPp[key] = command.flatDelta;
      if (passiveOwnsCommand(command)) {
        engine.marks[`passive-owned:${command.source}:${command.pokemonId}`] = true;
      } else if (firstApplication) {
        port.setMaxPp(command.pokemonId, command.moveId, command.flatDelta, command.allMoves);
      }
    },
    "repertoire-reward": command => {
      count(command.kind);
      const key = actionKey(command.pokemonId);
      engine.repertoireRewards[key] = [...(engine.repertoireRewards[key] ?? []), command];
      applyRepertoireReward(command, engine, port);
    },
    "choice-required": (command, context) => {
      count(command.kind);
      if (context.event.type !== "move-attempt") {
        throw new Error("Final Draft choice requires a move-attempt context");
      }
      engine.pendingChoices.push({ command, effectInstanceId: context.effectInstanceId, event: context.event });
      port.announceChoice(command.options, command.chooseCount, resolveMoodyFormationChoice);
    },
    "disable-move": command => {
      count(command.kind);
      const key = actionKey(command.pokemonId);
      engine.disabledMoves[key] = [...new Set([...(engine.disabledMoves[key] ?? []), command.moveId])];
    },
    mark: (command, context) => {
      count(command.kind);
      if (passiveOwnsCommand(command)) {
        engine.marks[`passive-owned:${command.source}:${command.name}`] = true;
        return;
      }
      const key = markKey(command, context);
      engine.marks[key] = command.value;
      if (command.name === "damageWindow") {
        engine.timedMarks[key] = 3;
      } else if (command.name === "revengeDamageMultiplier") {
        engine.timedMarks[key] = 2;
      } else if (command.name === "sameTurnIncomingDamageMultiplier") {
        engine.timedMarks[key] = 1;
      } else if (command.name === "maxHpCost" && typeof command.value === "number") {
        const pokemonId = command.pokemonId ?? subjectIdFromContext(context);
        if (pokemonId != null) {
          port.payMaxHpCost(pokemonId, command.value);
        }
      }
    },
  };
}

function preflight(command: MoodyFormationCommand, context: MoodyFormationCommandContext) {
  if ("pokemonId" in command && pokemonById(command.pokemonId) == null) {
    return { ok: false as const, reason: `Pokemon ${command.pokemonId} is not present` };
  }
  if (command.kind === "negate" && targetIdFromContext(context) == null) {
    return { ok: false as const, reason: "negate requires a directed target context" };
  }
  return { ok: true as const };
}

export function dispatchMoodyFormationGameEvent(
  event: MoodyFormationEvent,
  port: MoodyFormationEnginePort = LIVE_MOODY_FORMATION_ENGINE_PORT,
): readonly MoodyFormationCommand[] {
  const session = reconcileSession();
  if (session == null) {
    return [];
  }
  const engine = readEngineState();
  engine.hookCounts[event.type]++;
  const result = dispatchMoodyFormationEvent(session, event, {
    preflight,
    handlers: createMoodyFormationCommandHandlers(engine, port),
  });
  setMoodyFormationRuntimeSaveData(result.session);
  writeEngineState(engine);
  emitMoodyFormationTriggers(event, result.traces, result.session);
  recordMoodyFormationActionTriggers(event, result.traces, result.session);
  return result.commands.map(envelope => envelope.command);
}

function currentBattleId(): string {
  return `${globalScene.seed}:${globalScene.currentBattle.waveIndex}`;
}

export function startMoodyFormationBattle(): void {
  if (getMoodyModeState() == null || globalScene.currentBattle == null) {
    return;
  }
  const engine = readEngineState();
  const battleId = currentBattleId();
  if (engine.battleId !== battleId) {
    const reset = createEmptyMoodyFormationEngineState();
    reset.commandCounts = engine.commandCounts;
    reset.hookCounts = engine.hookCounts;
    reset.battleId = battleId;
    reset.wave = globalScene.currentBattle.waveIndex;
    reset.biome = globalScene.arena.biomeId;
    writeEngineState(reset);
  }
  dispatchMoodyFormationGameEvent({
    type: "wave-start",
    wave: globalScene.currentBattle.waveIndex,
    seed: Number(globalScene.currentBattle.battleSeed ?? 0),
    party: playerPartySnapshot(),
  });
  if (engine.biome !== globalScene.arena.biomeId) {
    dispatchMoodyFormationGameEvent({ type: "biome-start", biome: globalScene.arena.biomeId });
  }
  dispatchMoodyFormationGameEvent({
    type: "battle-start",
    battleId,
    wave: globalScene.currentBattle.waveIndex,
    biome: globalScene.arena.biomeId,
    party: playerPartySnapshot(),
  });
}

export function endMoodyFormationBattle(): void {
  if (getMoodyModeState() != null && globalScene.currentBattle != null) {
    dispatchMoodyFormationGameEvent({ type: "battle-end", battleId: currentBattleId() });
  }
}

export function startMoodyFormationTurn(): void {
  if (getMoodyModeState() == null || globalScene.currentBattle == null) {
    return;
  }
  dispatchMoodyFormationGameEvent({ type: "turn-start", turn: globalScene.currentBattle.turn });
  for (const pokemon of globalScene.getPlayerParty()) {
    dispatchMoodyFormationGameEvent({
      type: "evaluate",
      pokemon: snapshotMoodyFormationPokemon(pokemon),
      party: playerPartySnapshot(),
      turn: globalScene.currentBattle.turn,
    });
  }
}

export function completeMoodyFormationTurn(): void {
  if (getMoodyModeState() == null || globalScene.currentBattle == null) {
    return;
  }
  for (const pokemon of globalScene.getPlayerParty()) {
    dispatchMoodyFormationGameEvent({
      type: "turn-complete",
      turn: globalScene.currentBattle.turn,
      pokemonId: pokemon.id,
      partySlot: globalScene.getPlayerParty().indexOf(pokemon),
      active: pokemon.isActive(true),
    });
    const engine = readEngineState();
    advanceMoodyFormationTimedResources(engine, pokemon.id, LIVE_MOODY_FORMATION_ENGINE_PORT);
    writeEngineState(engine);
  }
}

export function advanceMoodyFormationTimedResources(
  engine: MoodyFormationEngineState,
  pokemonId: number,
  port: MoodyFormationEnginePort,
): void {
  const prefix = `${pokemonId}:`;
  for (const [key, turns] of Object.entries(engine.timedMarks)) {
    if (!key.startsWith(prefix)) {
      continue;
    }
    if (turns > 1) {
      engine.timedMarks[key] = turns - 1;
      continue;
    }
    const [, kind, stat] = key.split(":");
    const stages = engine.marks[key];
    if (
      kind === "temporary-stage"
      && FORMATION_STATS.some(([candidate]) => candidate === stat)
      && typeof stages === "number"
    ) {
      port.queueStatStage(pokemonId, stat as MoodyFormationStat, -stages);
    }
    delete engine.timedMarks[key];
    delete engine.marks[key];
  }
}

export function notifyMoodyFormationEntry(pokemon: Pokemon, afterAllyFainted?: boolean): void {
  if (!pokemon.isPlayer() || getMoodyModeState() == null) {
    return;
  }
  const engine = readEngineState();
  const pendingFaintedPokemonId = engine.marks[PENDING_ALLY_FAINT_ENTRY_MARK];
  const resolvedAfterAllyFainted =
    afterAllyFainted ?? (typeof pendingFaintedPokemonId === "number" && pendingFaintedPokemonId !== pokemon.id);
  if (pendingFaintedPokemonId != null) {
    delete engine.marks[PENDING_ALLY_FAINT_ENTRY_MARK];
  }
  const entrySeenKey = `${FORMATION_ENTRY_SEEN_MARK_PREFIX}${pokemon.id}`;
  const firstEntryThisBattle = engine.marks[entrySeenKey] !== engine.battleId;
  engine.marks[entrySeenKey] = engine.battleId;
  writeEngineState(engine);
  dispatchMoodyFormationGameEvent({
    type: "entry",
    pokemon: snapshotMoodyFormationPokemon(pokemon),
    firstEntryThisBattle,
    afterAllyFainted: resolvedAfterAllyFainted,
    allyDamagedEarlierThisTurn: pokemon.getAllies().some(ally => ally.turnData.attacksReceived.length > 0),
  });
}

export function notifyMoodyFormationSwitch(outgoing: Pokemon, incoming: Pokemon, voluntary: boolean): void {
  if (!outgoing.isPlayer() || getMoodyModeState() == null) {
    return;
  }
  const tagComboActive = activeFormationBoon("tag-combo").some(boon => {
    const targets = boon.target?.pokemonIds ?? [];
    return targets.includes(outgoing.id) && targets.includes(incoming.id);
  });
  const selectedBorrowedSecondaryId =
    voluntary && tagComboActive ? selectMoodyFormationBorrowedSecondaryId(outgoing) : undefined;
  dispatchMoodyFormationGameEvent({
    type: "switch",
    voluntary,
    outgoing: snapshotMoodyFormationPokemon(outgoing),
    incoming: snapshotMoodyFormationPokemon(incoming),
    allyDamagedEarlierThisTurn: outgoing.getAllies().some(ally => ally.turnData.attacksReceived.length > 0),
    ...(selectedBorrowedSecondaryId == null ? {} : { selectedBorrowedSecondaryId }),
  });
  dispatchMoodyFormationGameEvent({
    type: "exit",
    pokemonId: outgoing.id,
    partySlot: globalScene.getPlayerParty().indexOf(outgoing),
  });
  const engine = readEngineState();
  const outgoingKey = actionKey(outgoing.id);
  if (engine.forcedSwitchImmunity[outgoingKey] === "while-active") {
    delete engine.forcedSwitchImmunity[outgoingKey];
    writeEngineState(engine);
  }
  notifyMoodyFormationEntry(incoming);
}

function categoryOf(move: Move): MoodyFormationMoveCategory {
  if (move.category === MoveCategory.PHYSICAL) {
    return "physical";
  }
  if (move.category === MoveCategory.SPECIAL) {
    return "special";
  }
  return "status";
}

export interface MoodyFormationMoveMetadata {
  moveTags: readonly string[];
  useNumber: number;
  consecutiveUse: number;
}

export function buildMoodyFormationMoveMetadata(user: Pokemon, move: Move): MoodyFormationMoveMetadata {
  const moveTags = MOVE_TAG_FLAGS.flatMap(([flag, tags]) => (move.hasFlag(flag) ? tags : []));
  if (move.hasAttr("MultiHitAttr")) {
    moveTags.push("multi-hit");
  }
  const directHistory = user.getMoveHistory().filter(entry => !isVirtual(entry.useMode));
  const useNumber = directHistory.reduce((count, entry) => count + (entry.move === move.id ? 1 : 0), 1);
  let consecutiveUse = 1;
  for (const entry of directHistory.toReversed()) {
    if (entry.move !== move.id || entry.result !== MoveResult.SUCCESS) {
      break;
    }
    consecutiveUse++;
  }
  return { moveTags: [...new Set(moveTags)], useNumber, consecutiveUse };
}

function activateEchoIfFollowUp(user: Pokemon, move: Move, useMode: MoveUseMode): boolean {
  if (useMode !== MoveUseMode.FOLLOW_UP) {
    return false;
  }
  const engine = readEngineState();
  const key = actionKey(user.id);
  const resources = engine.echoes[key] ?? [];
  const echoIndex = resources.findIndex(resource => resource.moveId === move.id);
  if (echoIndex >= 0) {
    const [echo] = resources.splice(echoIndex, 1);
    engine.echoes[key] = resources;
    engine.activeEchoPower[key] = echo.command.powerFraction;
    if (echo.command.offensiveStatOwnerId != null) {
      engine.activeEchoOffensiveOwner[key] = echo.command.offensiveStatOwnerId;
    }
    writeEngineState(engine);
  }
  return true;
}

export function notifyMoodyFormationMoveAttempt(
  user: Pokemon,
  targets: readonly Pokemon[],
  move: Move,
  useMode: MoveUseMode,
): void {
  if (getMoodyModeState() == null) {
    return;
  }
  if (!user.isPlayer()) {
    dispatchMoodyFormationGameEvent({ type: "opponent-move", moveId: move.id, userPokemonId: user.id });
    return;
  }
  if (activateEchoIfFollowUp(user, move, useMode)) {
    return;
  }
  const engine = readEngineState();
  const key = actionKey(user.id);
  const pokemonMove = user.getMoveset().find(candidate => candidate.moveId === move.id);
  const maxPp = pokemonMove?.getMovePp() ?? move.pp;
  const metadata = buildMoodyFormationMoveMetadata(user, move);
  dispatchMoodyFormationGameEvent({
    type: "move-attempt",
    user: snapshotMoodyFormationPokemon(user),
    ...(targets[0] == null ? {} : { targetPokemonId: targets[0].id, targetTypes: targets[0].getTypes().map(String) }),
    moveId: move.id,
    moveType: String(user.getMoveType(move)),
    category: categoryOf(move),
    moveTags: metadata.moveTags,
    damaging: move.category !== MoveCategory.STATUS && move.power > 0,
    echoEligible: move.category !== MoveCategory.STATUS && move.power > 0,
    priority: move.priority,
    ppBefore: maxPp < 0 ? maxPp : Math.max(0, maxPp - (pokemonMove?.ppUsed ?? 0)),
    maxPp,
    useNumber: metadata.useNumber,
    consecutiveUse: metadata.consecutiveUse,
    isStab: user.getTypes().includes(user.getMoveType(move)),
  });
  const delayed = (engine.echoes[key] ?? []).filter(resource => resource.moveId === MoveId.NONE);
  for (const resource of delayed) {
    resource.moveId = move.id;
    resource.targets = targets.map(target => target.id);
    LIVE_MOODY_FORMATION_ENGINE_PORT.queueEcho(user.id, move.id, resource.targets);
  }
  if (delayed.length > 0) {
    writeEngineState(engine);
  }
}

export function notifyMoodyFormationMoveResolved(
  user: Pokemon,
  move: Move,
  outcome: "hit" | "miss" | "failed" | "immune",
): void {
  if (!user.isPlayer() || getMoodyModeState() == null) {
    return;
  }
  const moveSlot = user.getMoveset().findIndex(candidate => candidate.moveId === move.id);
  const fullRepertoireActive = activeFormationBoon("full-repertoire").some(
    boon => boon.evolutionId === "repertoire-doctrine" || boon.target?.pokemonIds?.includes(user.id) === true,
  );
  const selectedRepertoireRewards = fullRepertoireActive ? selectMoodyFormationRepertoireRewards(user) : undefined;
  dispatchMoodyFormationGameEvent({
    type: "move-resolved",
    user: snapshotMoodyFormationPokemon(user),
    moveId: move.id,
    moveSlot,
    moveType: String(user.getMoveType(move)),
    category: categoryOf(move),
    damaging: move.category !== MoveCategory.STATUS && move.power > 0,
    outcome,
    ...(selectedRepertoireRewards == null ? {} : { selectedRepertoireRewards }),
  });
  consumeMoodyFormationCopiedSecondary(user.id);
  const engine = readEngineState();
  delete engine.pendingActions[actionKey(user.id)];
  delete engine.activeEchoPower[actionKey(user.id)];
  delete engine.activeEchoOffensiveOwner[actionKey(user.id)];
  writeEngineState(engine);
}

export function applyMoodyFormationDamage(
  source: Pokemon,
  target: Pokemon,
  move: Move,
  damage: number,
  simulated: boolean,
): number {
  if (simulated || getMoodyModeState() == null) {
    return damage;
  }
  if (target.isPlayer()) {
    dispatchMoodyFormationGameEvent({
      type: "damage-received",
      target: snapshotMoodyFormationPokemon(target),
      sourcePokemonId: source.id,
      moveType: String(source.getMoveType(move)),
      direct: true,
    });
  }
  const engine = readEngineState();
  const outgoing = engine.pendingActions[actionKey(source.id)] ?? [];
  const incoming = engine.pendingActions[actionKey(target.id)] ?? [];
  const outgoingMultiplier = outgoing.reduce((value, command) => value * (command.damageMultiplier ?? 1), 1);
  const incomingMultiplier = incoming.reduce((value, command) => value * (command.incomingDamageMultiplier ?? 1), 1);
  const maxCommand = engine.maxHpAndDamage[actionKey(source.id)];
  const echoPower = engine.activeEchoPower[actionKey(source.id)] ?? 1;
  const offensiveOwnerId = engine.activeEchoOffensiveOwner[actionKey(source.id)];
  const offensiveOwner = offensiveOwnerId == null ? undefined : pokemonById(offensiveOwnerId);
  const offensiveStat = move.category === MoveCategory.PHYSICAL ? Stat.ATK : Stat.SPATK;
  const offensiveOwnerRatio =
    offensiveOwner == null || move.category === MoveCategory.STATUS
      ? 1
      : offensiveOwner.getEffectiveStat(offensiveStat, target, move)
        / Math.max(1, source.getEffectiveStat(offensiveStat, target, move));
  const markMultiplier = (pokemonId: number, names: readonly string[]): number =>
    names.reduce((value, name) => {
      const marked = engine.marks[`${pokemonId}:${name}`];
      return value * (typeof marked === "number" ? marked : 1);
    }, 1);
  const markedOutgoing = markMultiplier(source.id, [
    "damageWindow",
    "outgoingDamageMultiplier",
    "afflictedDamageMultiplier",
    "revengeDamageMultiplier",
  ]);
  const markedIncoming = markMultiplier(target.id, [
    "incomingDamageMultiplier",
    "afflictedIncomingDamageMultiplier",
    "sameTurnIncomingDamageMultiplier",
  ]);
  return Math.max(
    1,
    Math.floor(
      damage
        * outgoingMultiplier
        * incomingMultiplier
        * (maxCommand?.damageMultiplier ?? 1)
        * echoPower
        * offensiveOwnerRatio
        * markedOutgoing
        * markedIncoming,
    ),
  );
}

export function absorbMoodyFormationBarrier(target: Pokemon, damage: number): number {
  const engine = readEngineState();
  const key = actionKey(target.id);
  const barrier = engine.barriers[key] ?? 0;
  if (barrier <= 0 || damage <= 0) {
    return damage;
  }
  const absorbed = Math.min(barrier, damage);
  engine.barriers[key] = barrier - absorbed;
  engine.marks[`barrier-absorbed:${target.id}`] = absorbed;
  writeEngineState(engine);
  return damage - absorbed;
}

export function grantMoodyFormationBarrierOnce(target: Pokemon, source: string, maxHpFraction: number): number {
  if (maxHpFraction <= 0 || getMoodyModeState() == null || !target.isPlayer()) {
    return 0;
  }
  const engine = readEngineState();
  const usedKey = `once:${source}:pokemon:${target.id}`;
  if (engine.marks[usedKey] === true) {
    return 0;
  }
  const amount = Math.max(1, Math.floor(target.getMaxHp() * maxHpFraction));
  const key = actionKey(target.id);
  engine.barriers[key] = (engine.barriers[key] ?? 0) + amount;
  engine.marks[usedKey] = true;
  writeEngineState(engine);
  return amount;
}

export function applyMoodyFormationLethalClamp(target: Pokemon, damage: number, direct: boolean): number {
  if (!direct || damage < target.hp || getMoodyModeState() == null || !target.isPlayer()) {
    return damage;
  }
  const commands = dispatchMoodyFormationGameEvent({
    type: "lethal-check",
    target: snapshotMoodyFormationPokemon(target),
    hpBeforeFraction: target.hp / Math.max(1, target.getMaxHp()),
    bossBattle: globalScene.getEnemyParty().some(pokemon => pokemon.isBoss()),
    biome: globalScene.arena.biomeId,
  });
  return commands.some(command => command.kind === "survive" && command.pokemonId === target.id)
    ? Math.max(0, target.hp - 1)
    : damage;
}

export function shouldMoodyFormationPreventForcedSwitch(pokemon: Pokemon): boolean {
  return readEngineState().forcedSwitchImmunity[actionKey(pokemon.id)] != null;
}

export function shouldMoodyFormationPreventStatus(
  target: Pokemon,
  status: MoodyFormationStatus,
  volatile: boolean,
): boolean {
  if (!target.isPlayer() || getMoodyModeState() == null) {
    return false;
  }
  const commands = dispatchMoodyFormationGameEvent({
    type: "status-directed",
    target: snapshotMoodyFormationPokemon(target),
    status,
    volatile,
  });
  const engine = readEngineState();
  const negateKind = volatile ? "volatile" : "status";
  const key = negateKey(target.id, negateKind);
  if (
    (engine.negates[key] ?? 0) > 0
    || commands.some(command => command.kind === "negate" && command.event === negateKind)
  ) {
    engine.negates[key] = Math.max(0, (engine.negates[key] ?? 0) - 1);
    writeEngineState(engine);
    return true;
  }
  const resistance = engine.statusResistances[resistanceKey(target.id)]?.find(item => item.status === status);
  if (resistance?.tier === "immune") {
    return true;
  }
  if (resistance?.tier != null) {
    const denominator = resistance.tier === 2 ? 4 : 2;
    return target.randBattleSeedInt(denominator) !== 0;
  }
  return false;
}

export function moodyFormationStatusFromStatusEffect(effect: StatusEffect): MoodyFormationStatus | undefined {
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

export function shouldMoodyFormationPreventStatusEffect(target: Pokemon, effect: StatusEffect): boolean {
  const status = moodyFormationStatusFromStatusEffect(effect);
  return status != null && shouldMoodyFormationPreventStatus(target, status, false);
}

export function shouldMoodyFormationPreventVolatile(target: Pokemon, tagType: BattlerTagType): boolean {
  if (!NEGATIVE_VOLATILES.has(tagType)) {
    return false;
  }
  return shouldMoodyFormationPreventStatus(
    target,
    tagType === BattlerTagType.ER_FROSTBITE ? "frostbite" : "poison",
    true,
  );
}

export function notifyMoodyFormationStatusCured(pokemon: Pokemon, status: MoodyFormationStatus): void {
  if (pokemon.isPlayer() && getMoodyModeState() != null) {
    dispatchMoodyFormationGameEvent({ type: "status-cured", pokemon: snapshotMoodyFormationPokemon(pokemon), status });
  }
}

export function notifyMoodyFormationStatusEffectCured(pokemon: Pokemon, effect: StatusEffect): void {
  const status = moodyFormationStatusFromStatusEffect(effect);
  if (status != null) {
    notifyMoodyFormationStatusCured(pokemon, status);
  }
}

export function shouldMoodyFormationPreventStatDrop(
  target: Pokemon,
  stat: MoodyFormationStat,
  stages: number,
): boolean {
  if (!target.isPlayer() || stages >= 0 || getMoodyModeState() == null) {
    return false;
  }
  const commands = dispatchMoodyFormationGameEvent({
    type: "stat-drop-directed",
    target: snapshotMoodyFormationPokemon(target),
    stat,
    stages,
  });
  const engine = readEngineState();
  const key = negateKey(target.id, "stat-drop");
  if (
    (engine.negates[key] ?? 0) > 0
    || commands.some(command => command.kind === "negate" && command.event === "stat-drop")
  ) {
    engine.negates[key] = Math.max(0, (engine.negates[key] ?? 0) - 1);
    writeEngineState(engine);
    return true;
  }
  return false;
}

export function notifyMoodyFormationEnemyStatIncrease(stat: MoodyFormationStat, stages: number): void {
  if (getMoodyModeState() != null && stages > 0) {
    const party = globalScene.getPlayerParty();
    const owner = activeFormationBoon("copycat-heart")
      .filter(boon => boon.evolutionId === "shared-inspiration")
      .map(boon => party.find(pokemon => pokemon.id === boon.target?.pokemonIds?.[0]))
      .find((pokemon): pokemon is NonNullable<typeof pokemon> => pokemon != null);
    const selectedAdjacentPokemonId = owner == null ? undefined : selectMoodyFormationAdjacentPokemonId(owner, party);
    dispatchMoodyFormationGameEvent({
      type: "enemy-stat-increase",
      stat,
      stages,
      ...(selectedAdjacentPokemonId == null ? {} : { selectedAdjacentPokemonId }),
    });
  }
}

export function notifyMoodyFormationFaint(pokemon: Pokemon, attacker?: Pokemon): void {
  if (getMoodyModeState() == null) {
    return;
  }
  if (pokemon.isPlayer()) {
    dispatchMoodyFormationGameEvent({
      type: "fainted",
      pokemon: snapshotMoodyFormationPokemon(pokemon),
      party: playerPartySnapshot(),
    });
    const conscious = globalScene.getPlayerParty().filter(member => !member.isFainted(true));
    if (conscious.length === 1) {
      dispatchMoodyFormationGameEvent({
        type: "final-conscious",
        pokemon: snapshotMoodyFormationPokemon(conscious[0]),
      });
    }
    const engine = readEngineState();
    engine.marks[PENDING_ALLY_FAINT_ENTRY_MARK] = pokemon.id;
    writeEngineState(engine);
  } else if (attacker?.isPlayer()) {
    dispatchMoodyFormationGameEvent({
      type: "knockout",
      attacker: snapshotMoodyFormationPokemon(attacker),
      defeatedPokemonId: pokemon.id,
      defeatedTypes: pokemon.getTypes().map(String),
      elite: pokemon.isBoss(),
      boss: pokemon.isBoss(),
      bossSegmentBreak: false,
      tenWaveSegment: Math.floor(globalScene.currentBattle.waveIndex / 10),
    });
  }
}

export interface MoodyItemActivationPlan {
  multiplier: number;
  repeatActivation: boolean;
}

export function prepareMoodyFormationItemActivation(
  pokemon: Pokemon,
  itemStackId: string,
  adapter: Extract<MoodyFormationEvent, { type: "item-activation" }>["adapter"],
): MoodyItemActivationPlan {
  if (getMoodyModeState() == null) {
    return { multiplier: 1, repeatActivation: false };
  }
  dispatchMoodyFormationGameEvent({ type: "item-activation", pokemonId: pokemon.id, itemStackId, adapter });
  const command = readEngineState().itemAmplifications[itemKey(pokemon.id, itemStackId)];
  return { multiplier: command?.multiplier ?? 1, repeatActivation: command?.repeatActivation === true };
}

export function getMoodyFormationExperienceMultiplier(pokemon: Pokemon): number {
  return readEngineState().experienceMultipliers[actionKey(pokemon.id)] ?? 1;
}

export function getMoodyFormationMaxHpMultiplier(pokemon: Pokemon): number {
  return readEngineState().maxHpAndDamage[actionKey(pokemon.id)]?.maxHpMultiplier ?? 1;
}

export function getMoodyFormationSpeedMultiplier(pokemon: Pokemon): number {
  return readEngineState().maxHpAndDamage[actionKey(pokemon.id)]?.speedMultiplier ?? 1;
}

export function isMoodyFormationMoveDisabled(pokemon: Pokemon, moveId: number): boolean {
  return readEngineState().disabledMoves[actionKey(pokemon.id)]?.includes(moveId) === true;
}

export function getMoodyFormationAction(pokemonId: number): readonly CommandOf<"modify-action">[] {
  return readEngineState().pendingActions[actionKey(pokemonId)] ?? [];
}

export function getMoodyFormationSecondaryChance(pokemon: Pokemon, baseChance: number): number {
  const engine = readEngineState();
  const actions = engine.pendingActions[actionKey(pokemon.id)] ?? [];
  if (actions.some(command => command.suppressSecondary)) {
    return 0;
  }
  if (actions.some(command => command.guaranteeSecondary) || engine.copiedSecondaries[actionKey(pokemon.id)] != null) {
    return 100;
  }
  return Math.min(
    100,
    actions.reduce((chance, command) => chance * (command.secondaryChanceMultiplier ?? 1), baseChance),
  );
}

export function getMoodyFormationLearnedResistanceTypes(): readonly string[] {
  const session = reconcileSession();
  const values =
    session?.bindings
      .filter(binding => binding.effect.boonId === "scar-reader")
      .flatMap(binding => binding.state.lists["battle.resistances"] ?? []) ?? [];
  return [...new Set(values)];
}

export function resolveMoodyFormationChoice(endings: readonly MoodyFormationFinalDraftEnding[]): void {
  const engine = readEngineState();
  const pending = engine.pendingChoices.shift();
  if (pending == null) {
    return;
  }
  if (endings.length !== pending.command.chooseCount || new Set(endings).size !== endings.length) {
    throw new Error(`Final Draft requires ${pending.command.chooseCount} distinct ending choices`);
  }
  const session = reconcileSession();
  const bindingIndex =
    session?.bindings.findIndex(candidate => candidate.effect.instanceId === pending.effectInstanceId) ?? -1;
  if (session == null || bindingIndex < 0) {
    throw new Error(`Final Draft binding ${pending.effectInstanceId} is no longer active`);
  }
  const binding = session.bindings[bindingIndex]!;
  const event = { ...pending.event, finalDraftEndings: [...endings] };
  const resolution = resolveMoodyFormationEffect(binding.effect, binding.state, event);
  const sequence = session.sequence + 1;
  const handlers = createMoodyFormationCommandHandlers(engine, LIVE_MOODY_FORMATION_ENGINE_PORT);
  for (let commandIndex = 0; commandIndex < resolution.commands.length; commandIndex++) {
    const command = resolution.commands[commandIndex];
    const context: MoodyFormationCommandContext = {
      sequence,
      commandIndex,
      effectInstanceId: pending.effectInstanceId,
      event,
    };
    const checked = preflight(command, context);
    if (!checked.ok) {
      throw new Error(`Final Draft command ${command.kind} failed preflight: ${checked.reason}`);
    }
    executeMoodyFormationCommand({ preflight, handlers }, command, context);
  }
  const bindings = [...session.bindings];
  bindings[bindingIndex] = { ...binding, state: resolution.state };
  setMoodyFormationRuntimeSaveData({ ...session, sequence, bindings });
  writeEngineState(engine);
}

export function consumeMoodyFormationCopiedSecondary(pokemonId: number): string | undefined {
  const engine = readEngineState();
  const resource = engine.copiedSecondaries[actionKey(pokemonId)];
  if (resource == null || resource.uses <= 0) {
    return;
  }
  if (resource.uses <= 1) {
    delete engine.copiedSecondaries[actionKey(pokemonId)];
  } else {
    engine.copiedSecondaries[actionKey(pokemonId)] = { ...resource, uses: resource.uses - 1 };
  }
  writeEngineState(engine);
  return resource.secondaryId;
}

export function resolveMoodyFormationRepertoireReward(pokemonId: number, reward: MoodyFormationRepertoireReward): void {
  const engine = readEngineState();
  engine.marks[`repertoire-selected:${pokemonId}`] = reward;
  writeEngineState(engine);
}
