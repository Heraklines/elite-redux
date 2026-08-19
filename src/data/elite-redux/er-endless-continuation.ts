import { getErRunPacingProfile, isErSprintRun } from "#data/elite-redux/er-run-pacing";

export type ErEndlessRiftCategory = "pressure" | "mutation";
export type ErEndlessRiftDuration = 1 | 2 | 3 | 4;

export interface ErEndlessRiftDefinition {
  readonly id: string;
  readonly name: string;
  readonly category: ErEndlessRiftCategory;
  readonly pulses: ErEndlessRiftDuration;
  readonly hostile: boolean;
  readonly description: string;
  readonly incompatibleWith?: readonly string[];
}

export interface ErEndlessActiveRift {
  id: string;
  pulsesRemaining: number;
  acquiredAtDepth: number;
}

export interface ErEndlessGhostHistoryEntry {
  snapshotId: string;
  uploaderKey: string;
  teamFingerprint: string;
  encounter: number;
}

export interface ErEndlessGhostRoute {
  riftId: "parallel-lives" | "echo-hunt";
  sourceUserId: string;
  sourceSnapshotId: string;
  snapshotIds: string[];
  encounterIndex: number;
}

export interface ErEndlessNemesisEntry {
  snapshotId: string;
  rank: number;
  lastEncounter: number;
}

export interface ErEndlessGhostEncounter {
  sourceSnapshotId: string;
  eventId: string;
  playerKos: number;
  playerHpDamage: number;
  playerStartingMaxHp: number;
  reducedToOne: boolean;
  topPerformer: boolean;
  finalized: boolean;
}

export interface ErEndlessGhostResult {
  sourceSnapshotId: string;
  eventId: string;
  result: "player-win" | "ghost-win";
  playerKos: number;
  playerHpRemoved: number;
  turnsSurvived: number;
}

export interface ErEndlessDeferredDamage {
  fieldIndex: number;
  isPlayer: boolean;
  amount: number;
  dueTurn: number;
}

export interface ErEndlessMoveSnapshot {
  moveId: number;
  ppUsed: number;
  ppUp: number;
  maxPpOverride?: number | undefined;
}

export interface ErEndlessBattleRuntimeSaveData {
  wave: number;
  typeOverrides: Record<string, number[]>;
  priorityDeltas: Record<string, number[]>;
  healUses: Record<string, number>;
  barriers: Record<string, number>;
  refrainSlots: Record<string, number>;
  refrainRepeats: Record<string, number>;
  oathMasks: Record<string, number>;
  bloodcasts: Record<string, boolean>;
  forcedRotationIds: number[];
  moveSnapshots: Record<string, ErEndlessMoveSnapshot[]>;
  avalancheTriggers: Record<string, number>;
  avalancheEchoTurns: Record<string, number>;
  erosion: Record<string, { sourceId: number; moveType: number; stages: number }>;
  deferredDamage: ErEndlessDeferredDamage[];
  reservoirInitialized: boolean;
  playerReservoir: number;
  enemyReservoir: number;
  graveReturnAvailable: boolean;
  graveReturnUsed: boolean;
  suppressedRelics: { player?: string; enemy?: string };
  formSnapshots: Record<string, number>;
  echoMoveSignatures: Record<string, string>;
  raidEmptyMinionSlots: number[];
  lastWeather?: number;
  lastTerrain?: number;
}

export interface ErEndlessSaveData {
  version: 1;
  enteredAtWave: number;
  seed: string;
  pulse: number;
  ghostEncounters: number;
  activeRifts: ErEndlessActiveRift[];
  ghostHistory: ErEndlessGhostHistoryEntry[];
  nemesisLineages?: ErEndlessNemesisEntry[] | undefined;
  currentGhostEncounter?: ErEndlessGhostEncounter | undefined;
  ghostRoute?: ErEndlessGhostRoute | undefined;
  battleRuntime?: ErEndlessBattleRuntimeSaveData | undefined;
}

export const ER_ENDLESS_CYCLE_EQUIVALENT_WAVES = 200;
export const ER_ENDLESS_RAID_EQUIVALENT_INTERVAL = 50;

export const ER_ENDLESS_RIFTS: readonly ErEndlessRiftDefinition[] = [
  { id: "weather-carousel", name: "Weather Carousel", category: "mutation", pulses: 3, hostile: false, description: "Weather changes at battle start and every second turn. Terrain changes every third turn. Clear weather and no terrain remain possible." },
  { id: "full-type-flux", name: "Full Type Flux", category: "mutation", pulses: 3, hostile: false, description: "Every Pokemon receives temporary random typing each battle while keeping its normal number of types." },
  { id: "inverse-rift", name: "Inverse Rift", category: "pressure", pulses: 2, hostile: true, description: "Ordinary type effectiveness is reversed. Type immunities become 2x weaknesses." },
  { id: "resistance-erosion", name: "Resistance Erosion", category: "pressure", pulses: 3, hostile: true, description: "Consecutive damaging moves of the same type against the same target raise effectiveness by one stage, up to 4x." },
  { id: "fractured-immunities", name: "Fractured Immunities", category: "pressure", pulses: 4, hostile: true, description: "Type-based immunities become 1/4x damage. Ability and item immunities remain complete." },
  { id: "primal-convergence", name: "Primal Convergence", category: "mutation", pulses: 2, hostile: false, description: "Eligible Pokemon temporarily enter their strongest legal advanced form.", incompatibleWith: ["mega-storm"] },
  { id: "move-scrambler", name: "Move Scrambler", category: "mutation", pulses: 3, hostile: true, description: "After a move resolves, that moveset slot becomes another eligible move until the battle ends." },
  { id: "metronome-veil", name: "Metronome Veil", category: "mutation", pulses: 2, hostile: true, description: "Each Pokemon receives four temporary legal moves with four PP for the battle." },
  { id: "four-move-oath", name: "Four-Move Oath", category: "pressure", pulses: 3, hostile: true, description: "A used moveset slot locks until every other usable slot has been used once." },
  { id: "refrain", name: "Refrain", category: "pressure", pulses: 4, hostile: true, description: "Repeating a moveset slot reduces its damage by 20% per repeat and raises its PP cost, resetting on another slot or a switch." },
  { id: "echo-chamber", name: "Echo Chamber", category: "mutation", pulses: 3, hostile: false, description: "Each Pokemon's first eligible damaging move per battle repeats at 25% power without secondary effects." },
  { id: "category-flip", name: "Category Flip", category: "mutation", pulses: 3, hostile: false, description: "Physical moves use Special Attack and Special Defense; special moves use Attack and Defense." },
  { id: "shared-reservoir", name: "Shared Reservoir", category: "pressure", pulses: 3, hostile: true, description: "Each side spends moves from one battle-long shared PP reservoir. Expensive low-PP moves consume more." },
  { id: "healing-lock", name: "Healing Lock", category: "pressure", pulses: 1, hostile: true, description: "All HP restoration becomes zero. Revives return Pokemon at exactly 1 HP." },
  { id: "diminishing-recovery", name: "Diminishing Recovery", category: "pressure", pulses: 3, hostile: true, description: "Successive heals on the same Pokemon fall from 100% to a minimum of 20% effectiveness each battle." },
  { id: "overheal-barrier", name: "Overheal Barrier", category: "mutation", pulses: 4, hostile: false, description: "Healing above maximum HP becomes a temporary barrier capped at 30% maximum HP." },
  { id: "bloodcasting", name: "Bloodcasting", category: "mutation", pulses: 3, hostile: true, description: "Moves without PP may still be used, but cost 15% maximum HP after resolving." },
  { id: "restless-checkpoints", name: "Restless Checkpoints", category: "pressure", pulses: 3, hostile: true, description: "Checkpoint healing restores only half of missing HP and PP; fainted Pokemon return at 25% HP." },
  { id: "pulsing-trick-room", name: "Pulsing Trick Room", category: "mutation", pulses: 3, hostile: false, description: "Speed order is reversed on odd turns and normal on even turns." },
  { id: "priority-roulette", name: "Priority Roulette", category: "mutation", pulses: 3, hostile: true, description: "Each moveset slot receives a temporary -1, 0, or +1 priority adjustment each battle." },
  { id: "sudden-death", name: "Sudden Death", category: "pressure", pulses: 2, hostile: true, description: "From turn 8 onward, every active Pokemon loses increasing maximum-HP damage at turn end." },
  { id: "deferred-damage", name: "Deferred Damage", category: "mutation", pulses: 3, hostile: true, description: "Direct attacks deal 70% immediately and the remaining 30% to that field position next turn." },
  { id: "entropy", name: "Entropy", category: "pressure", pulses: 3, hostile: true, description: "Every nonzero stat stage moves one stage toward zero at each turn end." },
  { id: "escalation-clock", name: "Escalation Clock", category: "pressure", pulses: 2, hostile: true, description: "Direct damage rises by 10% after each completed turn, up to +100%." },
  { id: "format-roulette", name: "Format Roulette", category: "mutation", pulses: 3, hostile: false, description: "Each battle rolls Singles, Doubles, or Triples, limited by both parties' available Pokemon." },
  { id: "forced-rotation", name: "Forced Rotation", category: "pressure", pulses: 3, hostile: true, description: "Pokemon that score a KO must rotate to the next able reserve at turn end." },
  { id: "pursuit-field", name: "Pursuit Field", category: "pressure", pulses: 4, hostile: true, description: "Voluntary switching costs the outgoing Pokemon 12.5% maximum HP." },
  { id: "baton-world", name: "Baton World", category: "mutation", pulses: 3, hostile: false, description: "Voluntary switches transfer every positive and negative stat stage." },
  { id: "soul-link", name: "Soul Link", category: "mutation", pulses: 2, hostile: true, description: "Direct damage to one active Pokemon is divided among all conscious active allies." },
  { id: "status-roulette", name: "Status Roulette", category: "pressure", pulses: 2, hostile: true, description: "Random legal major statuses are assigned to active Pokemon on both sides at battle start." },
  { id: "contagion", name: "Contagion", category: "pressure", pulses: 3, hostile: true, description: "Contact with a major-status target has a 30% chance to copy that status to the attacker." },
  { id: "misery-mirror", name: "Misery Mirror", category: "pressure", pulses: 3, hostile: true, description: "Inflicting a major status has a 50% chance to inflict the same status on its user when legal." },
  { id: "status-relay", name: "Status Relay", category: "mutation", pulses: 3, hostile: true, description: "Voluntary switching transfers the outgoing Pokemon's major status when legal." },
  { id: "status-polarity", name: "Status Polarity", category: "mutation", pulses: 3, hostile: false, description: "Major statuses keep their downside but also grant a status-specific defensive or offensive benefit." },
  { id: "avalanche-reroll", name: "Avalanche Reroll", category: "mutation", pulses: 3, hostile: true, description: "Added Avalanche abilities reroll at battle start and return to their canonical Endless list afterward." },
  { id: "rotating-avalanche", name: "Rotating Avalanche", category: "pressure", pulses: 4, hostile: true, description: "Only one of four deterministic groups of added Avalanche abilities is active each turn." },
  { id: "trigger-burnout", name: "Trigger Burnout", category: "pressure", pulses: 3, hostile: true, description: "Discrete Avalanche triggers suppress themselves after three successful activations each battle." },
  { id: "ability-echo", name: "Ability Echo", category: "mutation", pulses: 2, hostile: true, description: "Each Pokemon's first eligible Avalanche trigger each turn resolves twice." },
  { id: "empty-hands", name: "Empty Hands", category: "pressure", pulses: 2, hostile: true, description: "Held-item effects are suppressed for both sides. Ownership, transfer, and theft remain available." },
  { id: "predatory-theft", name: "Predatory Theft", category: "mutation", pulses: 4, hostile: false, description: "Theft and removal effects target the highest-tier eligible held item." },
  { id: "relic-blackout", name: "Relic Blackout", category: "pressure", pulses: 3, hostile: true, description: "One combat-applicable relic on each side is suppressed each battle." },
  { id: "relic-overdrive", name: "Relic Overdrive", category: "mutation", pulses: 2, hostile: false, description: "Numerical combat effects from relics are doubled." },
  { id: "mega-storm", name: "Mega Storm", category: "mutation", pulses: 3, hostile: false, description: "Every legally Mega-capable Pokemon automatically Mega Evolves.", incompatibleWith: ["primal-convergence"] },
  { id: "mega-decay", name: "Mega Decay", category: "pressure", pulses: 3, hostile: true, description: "Advanced forms deal 25% more direct damage but lose 5% maximum HP each turn." },
  { id: "avalanche-surge", name: "Avalanche Surge", category: "mutation", pulses: 1, hostile: false, description: "Both sides temporarily double their extra Avalanche abilities, up to 100, for the next battle." },
  { id: "seventh-shadow", name: "Seventh Shadow", category: "mutation", pulses: 1, hostile: true, description: "The next ghost adds one complete member donated by another victorious team." },
  { id: "full-procession", name: "Full Procession", category: "pressure", pulses: 1, hostile: true, description: "The next ghost adds seventh and eighth members donated by victorious teams." },
  { id: "counter-draft", name: "Counter Draft", category: "pressure", pulses: 1, hostile: true, description: "The next ghost replaces one original member with a complete victorious donor set selected against your recent threats." },
  { id: "segment-bloom", name: "Segment Bloom", category: "pressure", pulses: 1, hostile: true, description: "Every member of the next ghost team gains one additional health segment." },
  { id: "grave-return", name: "Grave Return", category: "pressure", pulses: 1, hostile: true, description: "The first member of the next ghost team to faint returns once at the back of its party with half HP and PP." },
  { id: "parallel-lives", name: "Parallel Lives", category: "mutation", pulses: 3, hostile: true, description: "The next three ghost encounters use different complete victorious teams from one account." },
  { id: "echo-hunt", name: "Echo Hunt", category: "pressure", pulses: 3, hostile: true, description: "Three encounters pursue one ghost lineage, gaining equipment, segments, a donor, and counter-biased boons." },
  { id: "no-sanctuary", name: "No Sanctuary", category: "pressure", pulses: 2, hostile: true, description: "Biome shops and checkpoint healing are disabled. Ordinary rewards and Endless Rates are unchanged." },
] as const;

const RIFT_BY_ID = new Map(ER_ENDLESS_RIFTS.map(rift => [rift.id, rift]));
const ENCOUNTER_SCOPED_RIFTS = new Set([
  "avalanche-surge",
  "seventh-shadow",
  "full-procession",
  "counter-draft",
  "segment-bloom",
  "grave-return",
  "parallel-lives",
  "echo-hunt",
]);
let state: ErEndlessSaveData | null = null;

function hash32(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function cloneBattleRuntime(value: ErEndlessBattleRuntimeSaveData): ErEndlessBattleRuntimeSaveData {
  return {
    ...value,
    typeOverrides: Object.fromEntries(Object.entries(value.typeOverrides ?? {}).map(([key, types]) => [key, [...types]])),
    priorityDeltas: Object.fromEntries(Object.entries(value.priorityDeltas ?? {}).map(([key, deltas]) => [key, [...deltas]])),
    healUses: { ...(value.healUses ?? {}) },
    barriers: { ...(value.barriers ?? {}) },
    refrainSlots: { ...(value.refrainSlots ?? {}) },
    refrainRepeats: { ...(value.refrainRepeats ?? {}) },
    oathMasks: { ...(value.oathMasks ?? {}) },
    bloodcasts: { ...(value.bloodcasts ?? {}) },
    forcedRotationIds: [...(value.forcedRotationIds ?? [])],
    moveSnapshots: Object.fromEntries(
      Object.entries(value.moveSnapshots ?? {}).map(([key, moves]) => [key, moves.map(move => ({ ...move }))]),
    ),
    avalancheTriggers: { ...(value.avalancheTriggers ?? {}) },
    avalancheEchoTurns: { ...(value.avalancheEchoTurns ?? {}) },
    erosion: Object.fromEntries(Object.entries(value.erosion ?? {}).map(([key, entry]) => [key, { ...entry }])),
    deferredDamage: (value.deferredDamage ?? []).map(entry => ({ ...entry })),
    reservoirInitialized: value.reservoirInitialized === true,
    playerReservoir: Math.max(0, Math.floor(value.playerReservoir ?? 0)),
    enemyReservoir: Math.max(0, Math.floor(value.enemyReservoir ?? 0)),
    graveReturnAvailable: value.graveReturnAvailable === true,
    graveReturnUsed: value.graveReturnUsed === true,
    suppressedRelics: { ...(value.suppressedRelics ?? {}) },
    formSnapshots: { ...(value.formSnapshots ?? {}) },
    echoMoveSignatures: { ...(value.echoMoveSignatures ?? {}) },
    raidEmptyMinionSlots: [...(value.raidEmptyMinionSlots ?? [])],
  };
}

function cloneState(value: ErEndlessSaveData): ErEndlessSaveData {
  return {
    ...value,
    activeRifts: value.activeRifts.map(rift => ({ ...rift })),
    ghostHistory: value.ghostHistory.map(entry => ({ ...entry })),
    nemesisLineages: (value.nemesisLineages ?? []).map(entry => ({ ...entry })),
    currentGhostEncounter: value.currentGhostEncounter == null ? undefined : { ...value.currentGhostEncounter },
    ghostRoute: value.ghostRoute == null
      ? undefined
      : { ...value.ghostRoute, snapshotIds: [...value.ghostRoute.snapshotIds] },
    battleRuntime: value.battleRuntime == null ? undefined : cloneBattleRuntime(value.battleRuntime),
  };
}

export function isErEndlessContinuationActive(): boolean {
  return state != null;
}

export function getErEndlessState(): Readonly<ErEndlessSaveData> | null {
  return state;
}

export function getErEndlessSaveData(): ErEndlessSaveData | undefined {
  return state == null ? undefined : cloneState(state);
}

export function resetErEndlessContinuation(): void {
  state = null;
}

export function restoreErEndlessContinuation(data: ErEndlessSaveData | undefined): boolean {
  if (data?.version !== 1 || !Number.isFinite(data.enteredAtWave) || data.enteredAtWave < 1) {
    state = null;
    return false;
  }
  const battleRuntime = data.battleRuntime;
  state = {
    version: 1,
    enteredAtWave: Math.floor(data.enteredAtWave),
    seed: String(data.seed ?? ""),
    pulse: Math.max(0, Math.floor(data.pulse ?? 0)),
    ghostEncounters: Math.max(0, Math.floor(data.ghostEncounters ?? 0)),
    activeRifts: (data.activeRifts ?? [])
      .filter(rift => RIFT_BY_ID.has(rift.id) && Number.isFinite(rift.pulsesRemaining) && rift.pulsesRemaining > 0)
      .slice(0, 8)
      .map(rift => ({ ...rift, pulsesRemaining: Math.floor(rift.pulsesRemaining) })),
    ghostHistory: (data.ghostHistory ?? []).slice(-80).map(entry => ({ ...entry })),
    nemesisLineages: (data.nemesisLineages ?? [])
      .filter(entry => typeof entry?.snapshotId === "string" && entry.snapshotId.length > 0)
      .slice(-40)
      .map(entry => ({
        snapshotId: entry.snapshotId,
        rank: Math.max(1, Math.floor(entry.rank ?? 1)),
        lastEncounter: Math.max(0, Math.floor(entry.lastEncounter ?? 0)),
      })),
    currentGhostEncounter: data.currentGhostEncounter == null
      ? undefined
      : {
          sourceSnapshotId: String(data.currentGhostEncounter.sourceSnapshotId ?? ""),
          eventId: String(data.currentGhostEncounter.eventId ?? ""),
          playerKos: Math.max(0, Math.floor(data.currentGhostEncounter.playerKos ?? 0)),
          playerHpDamage: Math.max(0, Math.floor(data.currentGhostEncounter.playerHpDamage ?? 0)),
          playerStartingMaxHp: Math.max(1, Math.floor(data.currentGhostEncounter.playerStartingMaxHp ?? 1)),
          reducedToOne: data.currentGhostEncounter.reducedToOne === true,
          topPerformer: data.currentGhostEncounter.topPerformer === true,
          finalized: data.currentGhostEncounter.finalized === true,
        },
    ghostRoute: data.ghostRoute == null
      ? undefined
      : {
          riftId: data.ghostRoute.riftId,
          sourceUserId: String(data.ghostRoute.sourceUserId ?? ""),
          sourceSnapshotId: String(data.ghostRoute.sourceSnapshotId ?? ""),
          snapshotIds: (data.ghostRoute.snapshotIds ?? []).map(String).slice(0, 3),
          encounterIndex: Math.max(0, Math.min(3, Math.floor(data.ghostRoute.encounterIndex ?? 0))),
        },
    battleRuntime: battleRuntime != null && battleRuntime.wave > 0 ? cloneBattleRuntime(battleRuntime) : undefined,
  };
  return true;
}

export function getErEndlessActualWave(runWave: number): number {
  return state == null ? 0 : Math.max(0, Math.floor(runWave) - state.enteredAtWave);
}

export function getErEndlessEquivalentDepth(runWave: number): number {
  return getErEndlessActualWave(runWave) * getErRunPacingProfile().progressionScale;
}

export interface ErEndlessPressureBonuses {
  boonBudget: number;
  segmentBudget: number;
  riftSlots: number;
}

const PRESSURE_ORDERS = [
  ["boon", "segment", "rifts"],
  ["boon", "rifts", "segment"],
  ["segment", "boon", "rifts"],
  ["segment", "rifts", "boon"],
  ["rifts", "boon", "segment"],
  ["rifts", "segment", "boon"],
] as const;

/**
 * Every 15 Normal or 7 Sprint waves adds one enemy-pressure package. Each
 * seed-randomized group of three contains one boon, one segment, and two Rift
 * slots, preventing health-only streaks while remaining stable across reloads.
 */
export function getErEndlessPressureBonuses(runWave: number): ErEndlessPressureBonuses {
  if (state == null) {
    return { boonBudget: 0, segmentBudget: 0, riftSlots: 0 };
  }
  const milestones = Math.floor(getErEndlessActualWave(runWave) / (isErSprintRun() ? 7 : 15));
  const completeGroups = Math.floor(milestones / 3);
  const bonuses: ErEndlessPressureBonuses = {
    boonBudget: completeGroups,
    segmentBudget: completeGroups,
    riftSlots: completeGroups * 2,
  };
  const remainder = milestones % 3;
  if (remainder === 0) {
    return bonuses;
  }
  const order = PRESSURE_ORDERS[hash32(`${state.seed}:pressure:${completeGroups}`) % PRESSURE_ORDERS.length];
  for (let index = 0; index < remainder; index++) {
    switch (order[index]) {
      case "boon":
        bonuses.boonBudget++;
        break;
      case "segment":
        bonuses.segmentBudget++;
        break;
      case "rifts":
        bonuses.riftSlots += 2;
        break;
    }
  }
  return bonuses;
}

export function getErEndlessBonusBoonBudget(runWave: number): number {
  return getErEndlessPressureBonuses(runWave).boonBudget;
}

/** Cumulative extra health bars distributed across every Endless enemy party. */
export function getErEndlessBonusSegmentBudget(runWave: number): number {
  return getErEndlessPressureBonuses(runWave).segmentBudget;
}

export function getErEndlessBonusRiftSlots(runWave: number): number {
  return getErEndlessPressureBonuses(runWave).riftSlots;
}

/** Scripted/wild boss encounters receive twice the ordinary boon and bonus-segment pressure. */
export function scaleErEndlessEncounterPressureBudget(budget: number, bossBattle: boolean): number {
  return Math.max(0, Math.floor(budget)) * (bossBattle ? 2 : 1);
}

export function getErEndlessCycle(runWave: number): number {
  const depth = getErEndlessEquivalentDepth(runWave);
  return depth === 0 ? 1 : Math.floor((depth - 1) / ER_ENDLESS_CYCLE_EQUIVALENT_WAVES) + 1;
}

export function getErEndlessCycleWave(runWave: number): number {
  const depth = getErEndlessEquivalentDepth(runWave);
  return depth === 0 ? 0 : ((depth - 1) % ER_ENDLESS_CYCLE_EQUIVALENT_WAVES) + 1;
}

export function getErEndlessRateBonus(runWave: number): number {
  return Math.floor(getErEndlessEquivalentDepth(runWave) / 50);
}

export function isErEndlessRaidWave(runWave: number): boolean {
  const depth = getErEndlessEquivalentDepth(runWave);
  return depth > 0 && depth % ER_ENDLESS_RAID_EQUIVALENT_INTERVAL === 0;
}

/** Every Endless raid slot has twice the segments of an ordinary wild boss at that wave. */
export function getErEndlessRaidBossSegments(wildBossSegments: number): number {
  return Math.max(2, Math.floor(wildBossSegments)) * 2;
}

export function isErEndlessCycleFinale(runWave: number): boolean {
  const depth = getErEndlessEquivalentDepth(runWave);
  return depth > 0 && depth % ER_ENDLESS_CYCLE_EQUIVALENT_WAVES === 0;
}

export function isErEndlessCycleBoundaryAfterWave(runWave: number): boolean {
  return isErEndlessCycleFinale(runWave);
}

export function getErEndlessEnemyAvalancheCount(runWave: number): number {
  const base = Math.floor(getErEndlessEquivalentDepth(runWave) / 10) + 1;
  return Math.min(100, hasErEndlessRift("avalanche-surge") ? base * 2 : base);
}

export function getErEndlessPlayerAvalancheCount(runWave: number): number {
  const base = Math.floor(getErEndlessEquivalentDepth(runWave) / 20);
  return Math.min(100, hasErEndlessRift("avalanche-surge") ? base * 2 : base);
}

export function getErEndlessActiveRifts(): readonly ErEndlessActiveRift[] {
  return state?.activeRifts ?? [];
}

export function getErEndlessRiftDefinition(id: string): ErEndlessRiftDefinition | undefined {
  return RIFT_BY_ID.get(id);
}

export function hasErEndlessRift(id: string): boolean {
  return state?.activeRifts.some(rift => rift.id === id) === true;
}

/**
 * Resolve a held-item candidate without coupling the Endless state module to
 * modifier classes. Outside Predatory Theft the caller's seeded random choice
 * is preserved. During the Rift, tier wins first, then stack count, then the
 * stable modifier id so every theft/removal implementation agrees.
 */
export function getErEndlessHeldItemCandidateIndex<T>(
  candidates: readonly T[],
  fallbackIndex: number,
  getTier: (candidate: T) => number,
  getStackCount: (candidate: T) => number,
  getStableId: (candidate: T) => string,
): number {
  if (candidates.length === 0) {
    return -1;
  }
  if (!hasErEndlessRift("predatory-theft")) {
    return Math.max(0, Math.min(candidates.length - 1, fallbackIndex));
  }
  let bestIndex = 0;
  for (let index = 1; index < candidates.length; index++) {
    const candidate = candidates[index];
    const best = candidates[bestIndex];
    const tierDelta = getTier(candidate) - getTier(best);
    const stackDelta = getStackCount(candidate) - getStackCount(best);
    if (
      tierDelta > 0
      || (tierDelta === 0 && stackDelta > 0)
      || (tierDelta === 0 && stackDelta === 0 && getStableId(candidate).localeCompare(getStableId(best)) < 0)
    ) {
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function consumeErEndlessRift(id: string): boolean {
  if (state == null) {
    return false;
  }
  const before = state.activeRifts.length;
  state.activeRifts = state.activeRifts.filter(rift => rift.id !== id);
  return state.activeRifts.length !== before;
}

export function shouldErEndlessRiftPulseAfterWave(runWave: number): boolean {
  if (state == null) {
    return false;
  }
  const actual = getErEndlessActualWave(runWave);
  const interval = isErSprintRun() ? 3 : 5;
  return actual > 0 && actual % interval === 0;
}

function compatibleCandidates(category?: ErEndlessRiftCategory): ErEndlessRiftDefinition[] {
  if (state == null) {
    return [];
  }
  const active = new Set(state.activeRifts.map(rift => rift.id));
  return ER_ENDLESS_RIFTS.filter(definition => {
    if (category != null && definition.category !== category) {
      return false;
    }
    if (active.has(definition.id)) {
      return false;
    }
    return !state!.activeRifts.some(rift => {
      const current = RIFT_BY_ID.get(rift.id);
      return current?.incompatibleWith?.includes(definition.id) || definition.incompatibleWith?.includes(rift.id);
    });
  });
}

function rollRift(category?: ErEndlessRiftCategory, requireHostile = false): ErEndlessActiveRift | null {
  if (state == null) {
    return null;
  }
  let candidates = compatibleCandidates(category);
  if (requireHostile && candidates.some(rift => rift.hostile)) {
    candidates = candidates.filter(rift => rift.hostile);
  }
  if (candidates.length === 0) {
    return null;
  }
  const index = hash32(`${state.seed}:rift:${state.pulse}:${state.activeRifts.length}:${category ?? "any"}`) % candidates.length;
  const definition = candidates[index];
  return {
    id: definition.id,
    pulsesRemaining: definition.pulses,
    acquiredAtDepth: 0,
  };
}

function addRift(category?: ErEndlessRiftCategory, requireHostile = false, runWave = state?.enteredAtWave ?? 0): ErEndlessActiveRift | null {
  const rolled = rollRift(category, requireHostile);
  if (rolled == null || state == null) {
    return null;
  }
  rolled.acquiredAtDepth = getErEndlessEquivalentDepth(runWave);
  if (state.activeRifts.length >= 8) {
    state.activeRifts.sort((a, b) => a.pulsesRemaining - b.pulsesRemaining || a.acquiredAtDepth - b.acquiredAtDepth);
    state.activeRifts.shift();
  }
  state.activeRifts.push(rolled);
  return { ...rolled };
}

export function initializeErEndlessContinuation(enteredAtWave: number, seed: string): ErEndlessActiveRift[] {
  state = {
    version: 1,
    enteredAtWave: Math.max(1, Math.floor(enteredAtWave)),
    seed,
    pulse: 0,
    ghostEncounters: 0,
    activeRifts: [],
    ghostHistory: [],
    nemesisLineages: [],
    currentGhostEncounter: undefined,
    ghostRoute: undefined,
    battleRuntime: undefined,
  };
  const pressure = addRift("pressure", true, enteredAtWave);
  const mutation = addRift("mutation", false, enteredAtWave);
  return [pressure, mutation].filter((rift): rift is ErEndlessActiveRift => rift != null);
}

export function getErEndlessBattleRuntime(): ErEndlessBattleRuntimeSaveData | undefined {
  return state?.battleRuntime;
}

export function setErEndlessBattleRuntime(runtime: ErEndlessBattleRuntimeSaveData | undefined): void {
  if (state != null) {
    state.battleRuntime = runtime;
  }
}

export function pulseErEndlessRifts(runWave: number): ErEndlessActiveRift[] {
  if (state == null) {
    return [];
  }
  state.pulse++;
  state.activeRifts = state.activeRifts
    .map(rift => ENCOUNTER_SCOPED_RIFTS.has(rift.id)
      ? { ...rift }
      : { ...rift, pulsesRemaining: rift.pulsesRemaining - 1 })
    .filter(rift => rift.pulsesRemaining > 0);
  const added: ErEndlessActiveRift[] = [];
  const first = addRift(undefined, !state.activeRifts.some(rift => RIFT_BY_ID.get(rift.id)?.hostile), runWave);
  if (first) {
    added.push(first);
  }
  const target = Math.min(
    8,
    2 + Math.floor(getErEndlessEquivalentDepth(runWave) / 100) + getErEndlessBonusRiftSlots(runWave),
  );
  while (state.activeRifts.length < target) {
    const next = addRift(undefined, !state.activeRifts.some(rift => RIFT_BY_ID.get(rift.id)?.hostile), runWave);
    if (!next) {
      break;
    }
    added.push(next);
  }
  return added;
}

export function canUseErEndlessGhost(snapshotId: string, uploaderKey: string, teamFingerprint: string): boolean {
  if (state == null) {
    return true;
  }
  const encounter = state.ghostEncounters;
  return !state.ghostHistory.some(entry =>
    (entry.snapshotId === snapshotId && encounter - entry.encounter < 40)
    || (entry.uploaderKey === uploaderKey && encounter - entry.encounter < 10)
    || (entry.teamFingerprint === teamFingerprint && encounter - entry.encounter < 60));
}

export function recordErEndlessGhost(snapshotId: string, uploaderKey: string, teamFingerprint: string): void {
  if (state == null) {
    return;
  }
  state.ghostEncounters++;
  state.ghostHistory.push({ snapshotId, uploaderKey, teamFingerprint, encounter: state.ghostEncounters });
  state.ghostHistory = state.ghostHistory.filter(entry => state!.ghostEncounters - entry.encounter < 60).slice(-120);
}

export function getErEndlessNemesisRank(snapshotId: string): number {
  return state?.nemesisLineages?.find(entry => entry.snapshotId === snapshotId)?.rank ?? 0;
}

/** Scale only a returning Nemesis's saved relic stacks; ordinary ghosts retain their authentic snapshot. */
export function getErEndlessNemesisRelicBudgetMultiplier(rank: number): number {
  if (rank >= 4) {
    return 1.75;
  }
  return rank >= 2 ? 1.5 : 1;
}

/** Every tenth ghost encounter may deliberately revive the strongest personal Nemesis. */
export function getErEndlessReturningNemesisId(): string | undefined {
  if (state == null || (state.ghostEncounters + 1) % 10 !== 0) {
    return undefined;
  }
  return (state.nemesisLineages ?? [])
    .filter(entry => state!.ghostEncounters - entry.lastEncounter >= 5)
    .sort((left, right) => right.rank - left.rank || left.lastEncounter - right.lastEncounter)[0]
    ?.snapshotId;
}

export function beginErEndlessGhostEncounter(
  snapshotId: string,
  playerStartingMaxHp: number,
  topPerformer: boolean,
): void {
  if (state == null) {
    return;
  }
  state.currentGhostEncounter = {
    sourceSnapshotId: snapshotId,
    eventId: `${state.seed}:${state.ghostEncounters}:${snapshotId}`,
    playerKos: 0,
    playerHpDamage: 0,
    playerStartingMaxHp: Math.max(1, Math.floor(playerStartingMaxHp)),
    reducedToOne: false,
    topPerformer,
    finalized: false,
  };
}

export function recordErEndlessGhostPlayerDamage(amount: number): void {
  const encounter = state?.currentGhostEncounter;
  if (encounter && !encounter.finalized && Number.isFinite(amount) && amount > 0) {
    encounter.playerHpDamage += Math.floor(amount);
  }
}

export function recordErEndlessGhostPlayerFaint(consciousParty: number): void {
  const encounter = state?.currentGhostEncounter;
  if (!encounter || encounter.finalized) {
    return;
  }
  encounter.playerKos++;
  encounter.reducedToOne ||= consciousParty <= 1;
}

export function finalizeErEndlessGhostEncounter(
  result: ErEndlessGhostResult["result"],
  turnsSurvived: number,
): ErEndlessGhostResult | null {
  const encounter = state?.currentGhostEncounter;
  if (state == null || !encounter || encounter.finalized) {
    return null;
  }
  encounter.finalized = true;
  const qualifies = result === "ghost-win"
    || encounter.playerKos >= 4
    || encounter.reducedToOne
    || encounter.topPerformer;
  if (qualifies) {
    const lineages = state.nemesisLineages ??= [];
    const existing = lineages.find(entry => entry.snapshotId === encounter.sourceSnapshotId);
    if (existing) {
      existing.rank++;
      existing.lastEncounter = state.ghostEncounters;
    } else {
      lineages.push({
        snapshotId: encounter.sourceSnapshotId,
        rank: 1,
        lastEncounter: state.ghostEncounters,
      });
      state.nemesisLineages = lineages.slice(-40);
    }
  }
  return {
    sourceSnapshotId: encounter.sourceSnapshotId,
    eventId: encounter.eventId,
    result,
    playerKos: encounter.playerKos,
    playerHpRemoved: Math.min(1, encounter.playerHpDamage / encounter.playerStartingMaxHp),
    turnsSurvived: Math.max(0, Math.floor(turnsSurvived)),
  };
}

export function getErEndlessGhostRoute(): Readonly<ErEndlessGhostRoute> | undefined {
  return state?.ghostRoute;
}

export function beginErEndlessGhostRoute(route: Omit<ErEndlessGhostRoute, "encounterIndex">): void {
  if (state == null) {
    return;
  }
  state.ghostRoute = {
    ...route,
    snapshotIds: [...route.snapshotIds].slice(0, 3),
    encounterIndex: 0,
  };
}

export function advanceErEndlessGhostRoute(): number {
  if (state?.ghostRoute == null) {
    return 0;
  }
  state.ghostRoute.encounterIndex++;
  const remaining = Math.max(0, 3 - state.ghostRoute.encounterIndex);
  if (remaining === 0) {
    consumeErEndlessRift(state.ghostRoute.riftId);
    state.ghostRoute = undefined;
  }
  return remaining;
}
