export const MOODY_FORMATION_BOON_IDS = [
  "crowned-vanguard",
  "bastion-seat",
  "relay-seat",
  "echo-seat",
  "sanctuary-seat",
  "hungry-seat",
  "twin-sigil",
  "empty-throne",
  "rotating-spotlight",
  "last-chair",
  "chosen-one",
  "scar-reader",
  "signature-technique",
  "improviser",
  "blood-rival",
  "survivor-s-pride",
  "quiet-mentor",
  "copycat-heart",
  "mithridatism",
  "heirloom-bearer",
  "parting-gift",
  "counterrotation",
  "tag-combo",
  "hold-the-line",
  "revenge-entry",
  "turntable",
  "countermelody",
  "type-echo",
  "off-brand-genius",
  "specialist-s-focus",
  "conservation-law",
  "deep-reservoir",
  "full-repertoire",
  "refrain",
  "failure-is-data",
  "overdraft",
  "final-draft",
] as const;

export type MoodyFormationBoonId = (typeof MOODY_FORMATION_BOON_IDS)[number];
export type MoodyFormationRank = 1 | 2 | 3;
export type MoodyFormationStat =
  | "attack"
  | "defense"
  | "specialAttack"
  | "specialDefense"
  | "speed"
  | "accuracy"
  | "evasion";
export type MoodyFormationMoveCategory = "physical" | "special" | "status";
export type MoodyFormationStatus = "burn" | "poison" | "toxic" | "paralysis" | "sleep" | "frostbite";
export type MoodyFormationFinalDraftEnding = "climax" | "precision" | "revision";
export type MoodyFormationResetCadence = "battle" | "wave" | "biome" | "ten-wave-segment" | "permanent";

const EVOLUTIONS = {
  "crowned-vanguard": ["royal-vanguard", "ambush-doctrine"],
  "bastion-seat": ["citadel-seat", "bastion-doctrine"],
  "relay-seat": ["perfect-handoff", "momentum-relay"],
  "echo-seat": ["reverberant-seat", "echo-doctrine"],
  "sanctuary-seat": ["hallowed-seat", "sanctuary-doctrine"],
  "hungry-seat": ["glutton-s-throne", "feast-for-all"],
  "twin-sigil": ["twin-engine", "last-twin"],
  "empty-throne": ["solitary-kingdom", "court-of-ashes"],
  "rotating-spotlight": ["encore", "ensemble"],
  "last-chair": ["sole-survivor", "refusal-to-fall"],
  "chosen-one": ["conqueror", "living-legend"],
  "scar-reader": ["pattern-reader", "deep-scar"],
  "signature-technique": ["masterpiece", "school-founder"],
  improviser: ["virtuoso", "improvisational-doctrine"],
  "blood-rival": ["slayer", "obsession"],
  "survivor-s-pride": ["deathless-pride", "last-laugh"],
  "quiet-mentor": ["senior-mentor", "balanced-tutelage"],
  "copycat-heart": ["better-than-you", "shared-inspiration"],
  mithridatism: ["acquired-immunity", "weaponized-affliction"],
  "heirloom-bearer": ["living-heirloom", "family-treasury"],
  "parting-gift": ["keepsake", "parting-doctrine"],
  counterrotation: ["perfect-counterstep", "counterrotation-doctrine"],
  "tag-combo": ["relay-chemistry", "double-tag"],
  "hold-the-line": ["entrenched", "bulwark"],
  "revenge-entry": ["vengeful-sweep", "protective-revenge"],
  turntable: ["syncopation", "double-time"],
  countermelody: ["dissonance", "call-and-response"],
  "type-echo": ["resonant-pair", "type-choir"],
  "off-brand-genius": ["polymath", "off-brand-doctrine"],
  "specialist-s-focus": ["fanatic", "specialist-doctrine"],
  "conservation-law": ["final-reserve", "conservation-doctrine"],
  "deep-reservoir": ["artesian-move", "deep-wells"],
  "full-repertoire": ["virtuoso", "repertoire-doctrine"],
  refrain: ["crescendo", "efficient-refrain"],
  "failure-is-data": ["scientific-method", "team-research"],
  overdraft: ["blood-credit", "emergency-funding"],
  "final-draft": ["director-s-cut", "collected-works"],
} as const satisfies Record<MoodyFormationBoonId, readonly [string, string]>;

export type MoodyFormationEvolutionId = (typeof EVOLUTIONS)[MoodyFormationBoonId][number];

export interface MoodyFormationTarget {
  pokemonIds?: readonly number[];
  partySlots?: readonly number[];
  moveIds?: readonly number[];
  itemStackIds?: readonly string[];
  elementalType?: string;
  moveTag?: string;
}

export interface MoodyFormationEffect {
  instanceId: string;
  boonId: MoodyFormationBoonId;
  rank: MoodyFormationRank;
  evolutionId?: MoodyFormationEvolutionId;
  target: MoodyFormationTarget;
}

export interface MoodyFormationPokemonSnapshot {
  pokemonId: number;
  partySlot: number;
  currentHp: number;
  maxHp: number;
  conscious: boolean;
  majorStatus?: MoodyFormationStatus;
  positiveStages?: Partial<Record<MoodyFormationStat, number>>;
  negativeStages?: Partial<Record<MoodyFormationStat, number>>;
  highestOffensiveStat?: "attack" | "specialAttack";
  highestNonHpStat?: Exclude<MoodyFormationStat, "accuracy" | "evasion">;
  highestDefensiveStat?: "defense" | "specialDefense";
  mostDepletedMoveId?: number;
  allPpFull?: boolean;
}

export interface MoodyFormationPartySnapshot {
  slots: readonly (MoodyFormationPokemonSnapshot | null)[];
}

export type MoodyFormationEvent =
  | {
      type: "battle-start";
      battleId: string;
      wave: number;
      biome: number;
      party: MoodyFormationPartySnapshot;
    }
  | { type: "battle-end"; battleId: string }
  | {
      type: "wave-start";
      wave: number;
      seed: number;
      party: MoodyFormationPartySnapshot;
    }
  | { type: "biome-start"; biome: number }
  | { type: "turn-start"; turn: number }
  | {
      type: "turn-complete";
      turn: number;
      pokemonId: number;
      partySlot: number;
      active: boolean;
    }
  | {
      type: "entry";
      pokemon: MoodyFormationPokemonSnapshot;
      firstEntryThisBattle: boolean;
      afterAllyFainted: boolean;
      allyDamagedEarlierThisTurn: boolean;
    }
  | {
      type: "switch";
      voluntary: boolean;
      outgoing: MoodyFormationPokemonSnapshot;
      incoming: MoodyFormationPokemonSnapshot;
      allyDamagedEarlierThisTurn: boolean;
      selectedPositiveStages?: readonly {
        stat: MoodyFormationStat;
        stages: number;
      }[];
      selectedBorrowedSecondaryId?: string;
    }
  | { type: "exit"; pokemonId: number; partySlot: number }
  | {
      type: "move-attempt";
      user: MoodyFormationPokemonSnapshot;
      targetPokemonId?: number;
      targetTypes?: readonly string[];
      moveId: number;
      moveType: string;
      category: MoodyFormationMoveCategory;
      moveTags: readonly string[];
      damaging: boolean;
      echoEligible: boolean;
      priority: number;
      ppBefore: number;
      maxPp: number;
      useNumber: number;
      consecutiveUse: number;
      isStab: boolean;
      previousAlliedAction?: {
        pokemonId: number;
        moveType: string;
        damaging: boolean;
      };
      opponentLastMoveId?: number;
      finalDraftEndings?: readonly MoodyFormationFinalDraftEnding[];
    }
  | {
      type: "move-resolved";
      user: MoodyFormationPokemonSnapshot;
      moveId: number;
      moveSlot: number;
      moveType: string;
      category: MoodyFormationMoveCategory;
      damaging: boolean;
      outcome: "hit" | "miss" | "failed" | "immune";
      selectedStats?: readonly MoodyFormationStat[];
      selectedRepertoireRewards?: readonly MoodyFormationRepertoireReward[];
    }
  | {
      type: "damage-received";
      target: MoodyFormationPokemonSnapshot;
      sourcePokemonId?: number;
      moveType: string;
      direct: boolean;
    }
  | {
      type: "lethal-check";
      target: MoodyFormationPokemonSnapshot;
      hpBeforeFraction: number;
      bossBattle: boolean;
      biome: number;
    }
  | {
      type: "knockout";
      attacker: MoodyFormationPokemonSnapshot;
      defeatedPokemonId: number;
      defeatedTypes: readonly string[];
      elite: boolean;
      boss: boolean;
      bossSegmentBreak: boolean;
      tenWaveSegment: number;
    }
  | {
      type: "fainted";
      pokemon: MoodyFormationPokemonSnapshot;
      party: MoodyFormationPartySnapshot;
    }
  | { type: "final-conscious"; pokemon: MoodyFormationPokemonSnapshot }
  | {
      type: "status-directed";
      target: MoodyFormationPokemonSnapshot;
      status: MoodyFormationStatus;
      volatile: boolean;
    }
  | {
      type: "stat-drop-directed";
      target: MoodyFormationPokemonSnapshot;
      stat: MoodyFormationStat;
      stages: number;
    }
  | {
      type: "status-cured";
      pokemon: MoodyFormationPokemonSnapshot;
      status: MoodyFormationStatus;
    }
  | {
      type: "enemy-stat-increase";
      stat: MoodyFormationStat;
      stages: number;
      selectedAdjacentPokemonId?: number;
    }
  | {
      type: "item-activation";
      pokemonId: number;
      itemStackId: string;
      adapter:
        | "magnitude"
        | "duration"
        | "charges"
        | "probability"
        | "cooldown"
        | "stack-cap"
        | "bespoke"
        | "ineligible";
    }
  | { type: "opponent-move"; moveId: number; userPokemonId: number }
  | {
      type: "evaluate";
      pokemon: MoodyFormationPokemonSnapshot;
      party: MoodyFormationPartySnapshot;
      turn: number;
    };

export const MOODY_FORMATION_REPERTOIRE_REWARDS = [
  "barrier",
  "heal",
  "restore-pp",
  "cleanse",
  "random-stat",
  "next-priority",
  "next-secondary",
  "type-resistance",
] as const;

export type MoodyFormationRepertoireReward = (typeof MOODY_FORMATION_REPERTOIRE_REWARDS)[number];

export type MoodyFormationCommand =
  | {
      kind: "modify-action";
      source: MoodyFormationBoonId;
      pokemonId: number;
      damageMultiplier?: number;
      incomingDamageMultiplier?: number;
      priorityDelta?: number;
      ppCost?: number;
      accuracyMultiplier?: number;
      alwaysHits?: boolean;
      guaranteeSecondary?: boolean;
      secondaryChanceMultiplier?: number;
      suppressSecondary?: boolean;
    }
  | {
      kind: "heal";
      source: MoodyFormationBoonId;
      pokemonId: number;
      maxHpFraction: number;
    }
  | {
      kind: "barrier";
      source: MoodyFormationBoonId;
      pokemonId: number;
      maxHpFraction: number;
    }
  | {
      kind: "restore-pp";
      source: MoodyFormationBoonId;
      pokemonId: number;
      moveId?: number;
      amount: number;
      allDepletedMoves?: boolean;
    }
  | {
      kind: "stat-stage";
      source: MoodyFormationBoonId;
      pokemonId: number;
      stat: MoodyFormationStat;
      stages: number;
      durationTurns?: number;
    }
  | {
      kind: "clear-negative-stage";
      source: MoodyFormationBoonId;
      pokemonId: number;
      count: number | "all";
    }
  | {
      kind: "clear-volatile";
      source: MoodyFormationBoonId;
      pokemonId: number;
      count: number | "all";
    }
  | { kind: "clear-status"; source: MoodyFormationBoonId; pokemonId: number }
  | {
      kind: "forced-switch-immunity";
      source: MoodyFormationBoonId;
      pokemonId: number;
      duration: "while-active" | "battle";
    }
  | {
      kind: "echo";
      source: MoodyFormationBoonId;
      pokemonId: number;
      powerFraction: number;
      offensiveStatOwnerId?: number;
    }
  | {
      kind: "negate";
      source: MoodyFormationBoonId;
      event: "status" | "volatile" | "stat-drop";
    }
  | { kind: "survive"; source: MoodyFormationBoonId; pokemonId: number; hp: 1 }
  | {
      kind: "experience-multiplier";
      source: MoodyFormationBoonId;
      pokemonId: number;
      multiplier: number;
    }
  | {
      kind: "max-hp-and-damage";
      source: MoodyFormationBoonId;
      pokemonId: number;
      maxHpMultiplier: number;
      damageMultiplier: number;
      speedMultiplier: number;
      preserveCurrentHp: true;
    }
  | {
      kind: "copy-secondary";
      source: MoodyFormationBoonId;
      pokemonId: number;
      secondaryId: string;
      uses: number;
      guaranteed: true;
    }
  | {
      kind: "status-resistance";
      source: MoodyFormationBoonId;
      pokemonId: number;
      status: MoodyFormationStatus;
      tier: 1 | 2 | "immune";
    }
  | {
      kind: "amplify-item";
      source: MoodyFormationBoonId;
      pokemonId: number;
      itemStackId: string;
      multiplier: number;
      protected: true;
      adapter: Exclude<Extract<MoodyFormationEvent, { type: "item-activation" }>["adapter"], "ineligible">;
      repeatActivation: boolean;
    }
  | {
      kind: "max-pp";
      source: MoodyFormationBoonId;
      pokemonId: number;
      moveId?: number;
      flatDelta: number;
      allMoves: boolean;
    }
  | {
      kind: "repertoire-reward";
      source: MoodyFormationBoonId;
      pokemonId: number;
      reward: MoodyFormationRepertoireReward;
      magnitudeMultiplier: number;
    }
  | {
      kind: "choice-required";
      source: MoodyFormationBoonId;
      choice: "final-draft";
      options: readonly MoodyFormationFinalDraftEnding[];
      chooseCount: 1 | 2;
    }
  | {
      kind: "disable-move";
      source: MoodyFormationBoonId;
      pokemonId: number;
      moveId: number;
      duration: "battle";
    }
  | {
      kind: "mark";
      source: MoodyFormationBoonId;
      name: string;
      value: string | number | boolean;
      pokemonId?: number;
    };

export interface MoodyFormationRuntimeState {
  counters: Readonly<Record<string, number>>;
  flags: Readonly<Record<string, boolean>>;
  values: Readonly<Record<string, string | number | boolean>>;
  lists: Readonly<Record<string, readonly string[]>>;
}

export interface MoodyFormationResolution {
  state: MoodyFormationRuntimeState;
  commands: readonly MoodyFormationCommand[];
  triggered: boolean;
}

export interface MoodyFormationTriggerDescriptions {
  base: string;
  rankTwo: string;
  evolutionA: string;
  evolutionB: string;
}

export interface MoodyFormationRuntimeDefinition {
  number: number;
  boonId: MoodyFormationBoonId;
  evolutionIds: readonly [MoodyFormationEvolutionId, MoodyFormationEvolutionId];
  resetCadence: MoodyFormationResetCadence;
  triggerDescriptions: MoodyFormationTriggerDescriptions;
}

const DESCRIPTIONS: readonly [MoodyFormationResetCadence, string, string, string, string][] = [
  [
    "battle",
    "First damaging move gains priority.",
    "Existing-priority opening gains power.",
    "Recharge after three complete bench turns.",
    "Each occupied slot receives one weaker opening.",
  ],
  [
    "battle",
    "First entry creates a barrier.",
    "First-entry barrier is larger.",
    "Three bench turns recharge a smaller barrier.",
    "Each party member receives a first-entry barrier.",
  ],
  [
    "battle",
    "Voluntary switch transfers one chosen positive stage.",
    "Transfer up to two distinct stages.",
    "Transfer the two highest stages and clear one negative stage.",
    "Each Pokemon can relay one stage once.",
  ],
  [
    "battle",
    "First eligible damaging move echoes.",
    "Echo power increases.",
    "Re-entry rearms one additional echo.",
    "Each party member receives a weaker echo.",
  ],
  [
    "battle",
    "First directed status or volatile is negated.",
    "A separate stat-drop charge is added.",
    "Re-entry rearms status protection once.",
    "The side shares two qualifying negations.",
  ],
  [
    "permanent",
    "KOs bank Feast tokens for the next battle.",
    "Token cap and healing increase.",
    "Excess healing becomes barrier and unused full-state tokens persist.",
    "Half of recovery is redirected to the weakest bench ally.",
  ],
  [
    "battle",
    "Direct partner switches heal; partner faint boosts survivor.",
    "Healing rises and clears one negative stage.",
    "Partner switches transfer a positive stage.",
    "Partner faint grants an all-offense-and-Speed window.",
  ],
  [
    "permanent",
    "Empty and fainted slots increase max HP and damage.",
    "Both slot bonuses increase.",
    "Empty slots also increase Speed.",
    "Fainted slots strengthen and final survivor cleanses and barriers.",
  ],
  [
    "wave",
    "Seeded occupied slot becomes Star with experience and opening power.",
    "Experience and opening power increase.",
    "A Star KO heals and retains the next rotation.",
    "Adjacent slots receive half combat power.",
  ],
  [
    "battle",
    "Final conscious occupant heals, cleanses stages, and gains Speed.",
    "Healing rises and volatiles clear.",
    "Also boosts offense and damage temporarily.",
    "Also barriers and blocks forced switching.",
  ],
  [
    "ten-wave-segment",
    "First elite or boss KO grants persistent Glory.",
    "Glory cap rises and grants damage reduction.",
    "Only boss progress counts and damage per stack rises.",
    "Cap rises, faint loss ends, and elite progress alternates.",
  ],
  [
    "battle",
    "Damage teaches resistance to its elemental type.",
    "Learned reduction increases.",
    "Track the two latest types.",
    "First learned type carries into next battle turn one.",
  ],
  [
    "permanent",
    "Exact move gains power and every third use is free.",
    "Power and secondary probability rise.",
    "Power rises and final PP guarantees a secondary.",
    "Selected mechanical move tag gains team-wide power.",
  ],
  [
    "battle",
    "Four distinct move slots grant one supplied random stat.",
    "Can trigger twice.",
    "Three slots grant two supplied random stats.",
    "Each ally can trigger the weaker four-slot effect.",
  ],
  [
    "permanent",
    "Damage and KO healing improve against selected type.",
    "Both values increase.",
    "Incoming damage from selected type falls.",
    "Each ten KOs adds permanent typed damage.",
  ],
  [
    "biome",
    "Lethal damage from above 20% is survived once per biome.",
    "Also clears negative stages and volatiles.",
    "Cadence becomes once per boss battle.",
    "Next damaging move doubles and cannot miss.",
  ],
  [
    "battle",
    "Adjacent slots borrow Mentor's highest non-HP stat.",
    "Duration increases.",
    "All other occupied slots receive the bonus.",
    "Adjacent sides receive offense and defense respectively.",
  ],
  [
    "battle",
    "First enemy stat increase is copied.",
    "First two increases copy.",
    "Copied increase gains one stage.",
    "First copy also reaches a supplied adjacent ally.",
  ],
  [
    "permanent",
    "Three cures of a status grant status-specific resistance.",
    "Each cure heals.",
    "Six cures grant immunity.",
    "Six cures heavily reduce penalties and empower while afflicted.",
  ],
  [
    "battle",
    "Selected item stack is amplified and protected.",
    "Amplification increases.",
    "First activation repeats.",
    "Second selected stack receives smaller protected amplification.",
  ],
  [
    "battle",
    "First voluntary marked-slot exit heals and clears a volatile.",
    "Healing rises and clears a negative stage.",
    "Also transfers one supplied positive stage.",
    "Each ally's first voluntary switch provides weaker healing.",
  ],
  [
    "battle",
    "Marked entry after same-turn ally damage reduces incoming damage.",
    "Reduction increases.",
    "Next move gains priority.",
    "Each ally can trigger a weaker reduction once.",
  ],
  [
    "battle",
    "Direct pair switch borrows a supplied safe secondary once.",
    "Can trigger once per direction.",
    "Borrowed secondary applies twice.",
    "Also echoes with outgoing offensive stats.",
  ],
  [
    "battle",
    "Three complete active turns entrench defenses and prevent forced switching.",
    "Entrenches after two turns.",
    "Defensive stages increase.",
    "First ally entering behind entrenched Pokemon gains barrier.",
  ],
  [
    "battle",
    "Entry after ally faint grants Speed and temporary power.",
    "Also boosts highest offense.",
    "KO extends the active window.",
    "Power is replaced by barrier and volatile cleanse.",
  ],
  [
    "battle",
    "Turns alternate outgoing and incoming modifiers.",
    "Modifiers increase.",
    "First Offbeat move gains priority and first Downbeat status is negated.",
    "Each beat lasts two turns at greater strength.",
  ],
  [
    "battle",
    "Repeated opposing move arms a different response move.",
    "Can arm twice.",
    "Repeated move's next secondaries are suppressed.",
    "Each ally can trigger a weaker response once.",
  ],
  [
    "battle",
    "Matching elemental action by a different ally creates an echo.",
    "Echo increases.",
    "Bound pair creates a stronger echo.",
    "Any ally can create a weaker echo.",
  ],
  [
    "permanent",
    "Selected Pokemon's non-STAB damage increases.",
    "Power increases.",
    "Accuracy and secondary chance also improve.",
    "All allies gain weaker non-STAB damage.",
  ],
  [
    "permanent",
    "Selected type gains power while other types lose power.",
    "Both bonus and penalty increase.",
    "Typed specialization becomes extreme.",
    "All allies receive a weaker typed specialization.",
  ],
  [
    "battle",
    "Moves gain power at three low-PP thresholds.",
    "Threshold bonuses rise.",
    "Final PP doubles and guarantees a secondary.",
    "All allies receive weaker thresholds.",
  ],
  [
    "battle",
    "Selected move gains max PP and restores another move periodically.",
    "PP and trigger cadence improve.",
    "Restore all depleted other moves.",
    "All moves gain PP while selected restoration remains.",
  ],
  [
    "battle",
    "First use of each category grants supplied non-repeating rewards and Curtain Call.",
    "Reward magnitudes rise.",
    "Curtain Call starts after two categories and all three adds another reward.",
    "Each ally receives one reduced reward per category.",
  ],
  [
    "battle",
    "Consecutive selected-move use escalates power and PP cost.",
    "Maximum power increases.",
    "Later repetitions reach a higher ceiling.",
    "PP escalation is reduced.",
  ],
  [
    "battle",
    "First miss, failure, or immunity refunds PP, grants Speed, and arms accuracy.",
    "Two failures can trigger.",
    "Also arms a guaranteed secondary.",
    "Each ally can trigger once.",
  ],
  [
    "battle",
    "Selected zero-PP move can spend HP for power and a guaranteed secondary.",
    "Cost falls and power rises.",
    "A second overdraft is allowed at higher cost.",
    "Any move can overdraw once without secondary guarantee.",
  ],
  [
    "battle",
    "Final PP requests one of three deterministic endings.",
    "All ending values improve.",
    "Choose two endings and disable the move afterward.",
    "Every move receives a weaker once-per-battle ending.",
  ],
];

export const MOODY_FORMATION_RUNTIME_DEFINITIONS: Readonly<
  Record<MoodyFormationBoonId, MoodyFormationRuntimeDefinition>
> = Object.fromEntries(
  MOODY_FORMATION_BOON_IDS.map((boonId, index) => {
    const [resetCadence, base, rankTwo, evolutionA, evolutionB] = DESCRIPTIONS[index];
    return [
      boonId,
      {
        number: index + 1,
        boonId,
        evolutionIds: EVOLUTIONS[boonId],
        resetCadence,
        triggerDescriptions: { base, rankTwo, evolutionA, evolutionB },
      },
    ];
  }),
) as unknown as Readonly<Record<MoodyFormationBoonId, MoodyFormationRuntimeDefinition>>;

export const MOODY_FORMATION_RUNTIME_COVERAGE: ReadonlySet<MoodyFormationBoonId> = new Set(MOODY_FORMATION_BOON_IDS);

export function createMoodyFormationRuntimeState(): MoodyFormationRuntimeState {
  return { counters: {}, flags: {}, values: {}, lists: {} };
}

function cloneState(state: MoodyFormationRuntimeState): {
  counters: Record<string, number>;
  flags: Record<string, boolean>;
  values: Record<string, string | number | boolean>;
  lists: Record<string, string[]>;
} {
  return {
    counters: { ...state.counters },
    flags: { ...state.flags },
    values: { ...state.values },
    lists: Object.fromEntries(Object.entries(state.lists).map(([key, value]) => [key, [...value]])),
  };
}

function isTargetPokemon(effect: MoodyFormationEffect, pokemonId: number): boolean {
  return effect.target.pokemonIds?.includes(pokemonId) ?? false;
}

function isTargetSlot(effect: MoodyFormationEffect, slot: number): boolean {
  return effect.target.partySlots?.includes(slot) ?? false;
}

function isTargetMove(effect: MoodyFormationEffect, moveId: number): boolean {
  return effect.target.moveIds?.includes(moveId) ?? false;
}

function isEvolution(effect: MoodyFormationEffect, id: MoodyFormationEvolutionId): boolean {
  return effect.rank === 3 && effect.evolutionId === id;
}

function occupiedPokemon(party: MoodyFormationPartySnapshot): MoodyFormationPokemonSnapshot[] {
  return party.slots.filter((pokemon): pokemon is MoodyFormationPokemonSnapshot => pokemon != null);
}

function lowestHpBench(
  party: MoodyFormationPartySnapshot,
  excludedPokemonId: number,
): MoodyFormationPokemonSnapshot | undefined {
  return occupiedPokemon(party)
    .filter(pokemon => pokemon.conscious && pokemon.pokemonId !== excludedPokemonId)
    .sort(
      (left, right) => left.currentHp / left.maxHp - right.currentHp / right.maxHp || left.partySlot - right.partySlot,
    )[0];
}

function deterministicIndex(seed: number, wave: number, length: number): number {
  if (length === 0) {
    return -1;
  }
  let value = (seed ^ Math.imul(wave + 1, 0x9e3779b1)) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  return (value >>> 0) % length;
}

function stageEntries(pokemon: MoodyFormationPokemonSnapshot): { stat: MoodyFormationStat; stages: number }[] {
  return Object.entries(pokemon.positiveStages ?? {})
    .filter((entry): entry is [MoodyFormationStat, number] => typeof entry[1] === "number" && entry[1] > 0)
    .map(([stat, stages]) => ({ stat, stages }));
}

function resetBattleState(state: ReturnType<typeof cloneState>): void {
  for (const record of [state.counters, state.flags, state.values, state.lists]) {
    for (const key of Object.keys(record)) {
      if (key.startsWith("battle.")) {
        delete record[key];
      }
    }
  }
}

export function resolveMoodyFormationEffect(
  effect: MoodyFormationEffect,
  inputState: MoodyFormationRuntimeState,
  event: MoodyFormationEvent,
): MoodyFormationResolution {
  if (effect.rank === 3 && !EVOLUTIONS[effect.boonId].includes(effect.evolutionId as never)) {
    throw new Error(`Invalid evolution ${String(effect.evolutionId)} for ${effect.boonId}`);
  }
  const state = cloneState(inputState);
  const commands: MoodyFormationCommand[] = [];
  const add = (command: MoodyFormationCommand): void => {
    commands.push(command);
  };
  const count = (key: string): number => state.counters[key] ?? 0;
  const increment = (key: string, amount = 1): number => (state.counters[key] = count(key) + amount);
  const setFlag = (key: string, value = true): void => {
    state.flags[key] = value;
  };

  if (event.type === "battle-start") {
    resetBattleState(state);
    state.values["battle.id"] = event.battleId;
  }

  switch (effect.boonId) {
    case "crowned-vanguard": {
      if (event.type === "turn-complete" && !event.active && isTargetSlot(effect, event.partySlot)) {
        increment("battle.benchTurns");
      }
      if (
        event.type === "entry"
        && isTargetSlot(effect, event.pokemon.partySlot)
        && isEvolution(effect, "royal-vanguard")
        && count("battle.benchTurns") >= 3
        && !state.flags["battle.rearmed"]
      ) {
        setFlag("battle.rearmed");
        setFlag("battle.openingUsed", false);
      }
      if (event.type === "move-attempt" && event.damaging) {
        const doctrine = isEvolution(effect, "ambush-doctrine");
        const applies = doctrine ? true : isTargetSlot(effect, event.user.partySlot);
        const key = doctrine ? `battle.opening.${event.user.pokemonId}` : "battle.openingUsed";
        if (applies && !state.flags[key]) {
          add({
            kind: "modify-action",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            ...(event.priority > 0 && effect.rank >= 2
              ? { damageMultiplier: doctrine ? 1.15 : 1.2 }
              : { priorityDelta: 1 }),
          });
          setFlag(key);
        }
      }
      break;
    }
    case "bastion-seat": {
      if (event.type === "turn-complete" && !event.active && isTargetSlot(effect, event.partySlot)) {
        increment("battle.benchTurns");
      }
      if (event.type === "entry") {
        const doctrine = isEvolution(effect, "bastion-doctrine");
        const applies = doctrine || isTargetSlot(effect, event.pokemon.partySlot);
        const key = doctrine ? `battle.entry.${event.pokemon.pokemonId}` : "battle.firstEntry";
        const citadelRefresh =
          isEvolution(effect, "citadel-seat") && count("battle.benchTurns") >= 3 && state.flags["battle.firstEntry"];
        if (applies && ((!state.flags[key] && event.firstEntryThisBattle) || citadelRefresh)) {
          add({
            kind: "barrier",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            maxHpFraction: doctrine ? 0.12 : citadelRefresh ? 0.15 : effect.rank >= 2 ? 0.3 : 0.2,
          });
          setFlag(key);
          if (citadelRefresh) {
            state.counters["battle.benchTurns"] = 0;
          }
        }
      }
      break;
    }
    case "relay-seat": {
      if (event.type === "switch" && event.voluntary) {
        const doctrine = isEvolution(effect, "momentum-relay");
        const applies = doctrine || isTargetSlot(effect, event.outgoing.partySlot);
        const key = doctrine ? `battle.relay.${event.outgoing.pokemonId}` : "battle.relay";
        if (applies && !state.flags[key]) {
          const available = event.selectedPositiveStages ?? stageEntries(event.outgoing);
          const selected = isEvolution(effect, "perfect-handoff")
            ? [...available].sort((a, b) => b.stages - a.stages || a.stat.localeCompare(b.stat)).slice(0, 2)
            : available.slice(0, effect.rank >= 2 && !doctrine ? 2 : 1);
          for (const stage of selected) {
            add({
              kind: "stat-stage",
              source: effect.boonId,
              pokemonId: event.incoming.pokemonId,
              stat: stage.stat,
              stages: Math.min(1, stage.stages),
            });
          }
          if (isEvolution(effect, "perfect-handoff")) {
            add({
              kind: "clear-negative-stage",
              source: effect.boonId,
              pokemonId: event.incoming.pokemonId,
              count: 1,
            });
          }
          if (selected.length > 0) {
            setFlag(key);
          }
        }
      }
      break;
    }
    case "echo-seat": {
      if (
        event.type === "entry"
        && isEvolution(effect, "reverberant-seat")
        && count("battle.echoUses") === 1
        && state.flags["battle.hasExited"]
      ) {
        setFlag("battle.reentryReady");
      }
      if (event.type === "exit" && isTargetSlot(effect, event.partySlot)) {
        setFlag("battle.hasExited");
      }
      if (event.type === "move-attempt" && event.damaging && event.echoEligible) {
        const doctrine = isEvolution(effect, "echo-doctrine");
        const applies = doctrine || isTargetSlot(effect, event.user.partySlot);
        const key = doctrine ? `battle.echo.${event.user.pokemonId}` : "battle.echoUses";
        const used = doctrine ? (state.flags[key] ? 1 : 0) : count(key);
        const canUse =
          used === 0 || (isEvolution(effect, "reverberant-seat") && used === 1 && state.flags["battle.reentryReady"]);
        if (applies && canUse) {
          add({
            kind: "echo",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            powerFraction: doctrine ? 0.15 : effect.rank >= 2 ? 0.35 : 0.25,
          });
          doctrine ? setFlag(key) : increment(key);
        }
      }
      break;
    }
    case "sanctuary-seat": {
      const doctrine = isEvolution(effect, "sanctuary-doctrine");
      if (
        event.type === "entry"
        && isEvolution(effect, "hallowed-seat")
        && isTargetSlot(effect, event.pokemon.partySlot)
        && state.flags["battle.statusUsed"]
        && !state.flags["battle.statusRefreshed"]
      ) {
        setFlag("battle.statusUsed", false);
        setFlag("battle.statusRefreshed");
      }
      if (event.type === "status-directed" && (doctrine || isTargetSlot(effect, event.target.partySlot))) {
        const key = doctrine ? "battle.sharedNegations" : "battle.statusUsed";
        const available = doctrine ? count(key) < 2 : !state.flags[key];
        if (available) {
          add({
            kind: "negate",
            source: effect.boonId,
            event: event.volatile ? "volatile" : "status",
          });
          doctrine ? increment(key) : setFlag(key);
        }
      }
      if (
        event.type === "stat-drop-directed"
        && effect.rank >= 2
        && (doctrine || isTargetSlot(effect, event.target.partySlot))
      ) {
        const key = doctrine ? "battle.sharedNegations" : "battle.statDropUsed";
        const available = doctrine ? count(key) < 2 : !state.flags[key];
        if (available) {
          add({ kind: "negate", source: effect.boonId, event: "stat-drop" });
          doctrine ? increment(key) : setFlag(key);
        }
      }
      break;
    }
    case "hungry-seat": {
      const cap = effect.rank >= 2 ? 4 : 3;
      if (event.type === "knockout" && isTargetSlot(effect, event.attacker.partySlot)) {
        state.counters.feastTokens = Math.min(cap, count("feastTokens") + 1);
      }
      if (event.type === "battle-start") {
        const occupant = event.party.slots.find(pokemon => pokemon != null && isTargetSlot(effect, pokemon.partySlot));
        const tokens = count("feastTokens");
        if (occupant && tokens > 0) {
          const healing = tokens * (effect.rank >= 2 ? 0.1 : 0.08);
          const ally = lowestHpBench(event.party, occupant.pokemonId);
          const redirect = isEvolution(effect, "feast-for-all") && ally != null ? 0.5 : 0;
          add({
            kind: "heal",
            source: effect.boonId,
            pokemonId: occupant.pokemonId,
            maxHpFraction: healing * (1 - redirect),
          });
          add({
            kind: "restore-pp",
            source: effect.boonId,
            pokemonId: occupant.pokemonId,
            ...(occupant.mostDepletedMoveId == null ? {} : { moveId: occupant.mostDepletedMoveId }),
            amount: Math.max(1, Math.ceil(tokens * (1 - redirect))),
          });
          if (ally && redirect > 0) {
            add({
              kind: "heal",
              source: effect.boonId,
              pokemonId: ally.pokemonId,
              maxHpFraction: healing * redirect,
            });
            add({
              kind: "restore-pp",
              source: effect.boonId,
              pokemonId: ally.pokemonId,
              ...(ally.mostDepletedMoveId == null ? {} : { moveId: ally.mostDepletedMoveId }),
              amount: Math.max(1, Math.floor(tokens * redirect)),
            });
          }
          if (isEvolution(effect, "glutton-s-throne") && occupant.currentHp === occupant.maxHp) {
            add({
              kind: "barrier",
              source: effect.boonId,
              pokemonId: occupant.pokemonId,
              maxHpFraction: healing,
            });
          }
          const retain =
            isEvolution(effect, "glutton-s-throne")
            && occupant.currentHp === occupant.maxHp
            && occupant.allPpFull === true;
          state.counters.feastTokens = retain ? tokens : 0;
        }
      }
      break;
    }
    case "twin-sigil": {
      if (
        event.type === "switch"
        && event.voluntary
        && isTargetSlot(effect, event.outgoing.partySlot)
        && isTargetSlot(effect, event.incoming.partySlot)
      ) {
        add({
          kind: "heal",
          source: effect.boonId,
          pokemonId: event.incoming.pokemonId,
          maxHpFraction: effect.rank >= 2 ? 0.12 : 0.08,
        });
        if (effect.rank >= 2) {
          add({
            kind: "clear-negative-stage",
            source: effect.boonId,
            pokemonId: event.incoming.pokemonId,
            count: 1,
          });
        }
        if (isEvolution(effect, "twin-engine")) {
          const stage = event.selectedPositiveStages?.[0] ?? stageEntries(event.outgoing)[0];
          if (stage) {
            add({
              kind: "stat-stage",
              source: effect.boonId,
              pokemonId: event.incoming.pokemonId,
              stat: stage.stat,
              stages: 1,
            });
          }
        }
      }
      if (event.type === "fainted" && isTargetSlot(effect, event.pokemon.partySlot)) {
        const survivor = occupiedPokemon(event.party).find(
          pokemon =>
            pokemon.conscious
            && isTargetSlot(effect, pokemon.partySlot)
            && pokemon.pokemonId !== event.pokemon.pokemonId,
        );
        if (survivor) {
          if (isEvolution(effect, "last-twin")) {
            for (const stat of ["attack", "specialAttack", "speed"] as const) {
              add({
                kind: "stat-stage",
                source: effect.boonId,
                pokemonId: survivor.pokemonId,
                stat,
                stages: 1,
                durationTurns: 3,
              });
            }
          } else {
            add({
              kind: "stat-stage",
              source: effect.boonId,
              pokemonId: survivor.pokemonId,
              stat: survivor.highestOffensiveStat ?? "attack",
              stages: 1,
            });
          }
        }
      }
      break;
    }
    case "empty-throne": {
      if (event.type === "evaluate") {
        const empty = event.party.slots.filter(slot => slot == null).length;
        const fainted = occupiedPokemon(event.party).filter(pokemon => !pokemon.conscious).length;
        const emptyBonus = effect.rank >= 2 ? 0.12 : 0.1;
        const faintedBonus = isEvolution(effect, "court-of-ashes") ? 0.1 : effect.rank >= 2 ? 0.08 : 0.06;
        add({
          kind: "max-hp-and-damage",
          source: effect.boonId,
          pokemonId: event.pokemon.pokemonId,
          maxHpMultiplier: 1 + empty * emptyBonus + fainted * faintedBonus,
          damageMultiplier: 1 + empty * emptyBonus + fainted * faintedBonus,
          speedMultiplier: 1 + (isEvolution(effect, "solitary-kingdom") ? empty * 0.05 : 0),
          preserveCurrentHp: true,
        });
      }
      if (
        event.type === "final-conscious"
        && isEvolution(effect, "court-of-ashes")
        && !state.flags["battle.courtTriggered"]
      ) {
        add({
          kind: "clear-status",
          source: effect.boonId,
          pokemonId: event.pokemon.pokemonId,
        });
        add({
          kind: "barrier",
          source: effect.boonId,
          pokemonId: event.pokemon.pokemonId,
          maxHpFraction: 0.2,
        });
        setFlag("battle.courtTriggered");
      }
      break;
    }
    case "rotating-spotlight": {
      if (event.type === "wave-start") {
        const slots = occupiedPokemon(event.party)
          .map(pokemon => pokemon.partySlot)
          .sort((a, b) => a - b);
        const retained = state.flags.retainStar && typeof state.values.starSlot === "number";
        state.values.starSlot = retained
          ? state.values.starSlot
          : (slots[deterministicIndex(event.seed, event.wave, slots.length)] ?? -1);
        setFlag("retainStar", false);
        setFlag("battle.starOpening", false);
      }
      if (event.type === "evaluate") {
        const starSlot = Number(state.values.starSlot ?? -1);
        const distance = Math.abs(event.pokemon.partySlot - starSlot);
        if (event.pokemon.partySlot === starSlot) {
          add({
            kind: "experience-multiplier",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            multiplier: effect.rank >= 2 ? 1.75 : 1.5,
          });
        } else if (isEvolution(effect, "ensemble") && distance === 1) {
          add({
            kind: "mark",
            source: effect.boonId,
            name: "openingDamageMultiplier",
            value: effect.rank >= 2 ? 1.15 : 1.1,
          });
        }
      }
      if (event.type === "move-attempt" && event.damaging) {
        const starSlot = Number(state.values.starSlot ?? -1);
        const adjacent = isEvolution(effect, "ensemble") && Math.abs(event.user.partySlot - starSlot) === 1;
        const key = `battle.starOpening.${event.user.pokemonId}`;
        if ((event.user.partySlot === starSlot || adjacent) && !state.flags[key]) {
          add({
            kind: "modify-action",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            damageMultiplier: adjacent ? (effect.rank >= 2 ? 1.15 : 1.1) : effect.rank >= 2 ? 1.3 : 1.2,
          });
          setFlag(key);
        }
      }
      if (
        event.type === "knockout"
        && isEvolution(effect, "encore")
        && event.attacker.partySlot === Number(state.values.starSlot ?? -1)
      ) {
        add({
          kind: "heal",
          source: effect.boonId,
          pokemonId: event.attacker.pokemonId,
          maxHpFraction: 0.1,
        });
        setFlag("retainStar");
      }
      break;
    }
    case "last-chair": {
      if (
        event.type === "final-conscious"
        && isTargetSlot(effect, event.pokemon.partySlot)
        && !state.flags["battle.triggered"]
      ) {
        add({
          kind: "heal",
          source: effect.boonId,
          pokemonId: event.pokemon.pokemonId,
          maxHpFraction: effect.rank >= 2 ? 0.35 : 0.25,
        });
        add({
          kind: "clear-negative-stage",
          source: effect.boonId,
          pokemonId: event.pokemon.pokemonId,
          count: "all",
        });
        add({
          kind: "stat-stage",
          source: effect.boonId,
          pokemonId: event.pokemon.pokemonId,
          stat: "speed",
          stages: 1,
        });
        if (effect.rank >= 2) {
          add({
            kind: "clear-volatile",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            count: "all",
          });
        }
        if (isEvolution(effect, "sole-survivor")) {
          add({
            kind: "stat-stage",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            stat: event.pokemon.highestOffensiveStat ?? "attack",
            stages: 1,
          });
          add({
            kind: "mark",
            source: effect.boonId,
            name: "damageWindow",
            value: 1.2,
          });
          state.counters["battle.damageWindow"] = 3;
        }
        if (isEvolution(effect, "refusal-to-fall")) {
          add({
            kind: "barrier",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            maxHpFraction: 0.3,
          });
          add({
            kind: "forced-switch-immunity",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            duration: "battle",
          });
        }
        setFlag("battle.triggered");
      }
      break;
    }
    case "chosen-one": {
      if (event.type === "knockout" && isTargetPokemon(effect, event.attacker.pokemonId)) {
        const conqueror = isEvolution(effect, "conqueror");
        const living = isEvolution(effect, "living-legend");
        const qualifies = conqueror ? event.boss || event.bossSegmentBreak : event.elite || event.boss;
        const segmentKey = `segment.${event.tenWaveSegment}`;
        let permitted = qualifies && !state.flags[segmentKey];
        if (living && event.elite && !event.boss) {
          permitted = permitted && increment("eliteProgress") % 2 === 0;
        }
        if (permitted) {
          const cap = living ? 20 : effect.rank >= 2 ? 15 : 10;
          state.counters.glory = Math.min(cap, count("glory") + 1);
          setFlag(segmentKey);
        }
      }
      if (
        event.type === "fainted"
        && isTargetPokemon(effect, event.pokemon.pokemonId)
        && !isEvolution(effect, "living-legend")
      ) {
        state.counters.glory = Math.max(0, count("glory") - 1);
      }
      if (event.type === "evaluate" && isTargetPokemon(effect, event.pokemon.pokemonId)) {
        const glory = count("glory");
        add({
          kind: "mark",
          source: effect.boonId,
          name: "outgoingDamageMultiplier",
          value: 1 + glory * (isEvolution(effect, "conqueror") ? 0.03 : 0.02),
        });
        if (effect.rank >= 2) {
          add({
            kind: "mark",
            source: effect.boonId,
            name: "incomingDamageMultiplier",
            value: 1 - glory * 0.005,
          });
        }
      }
      break;
    }
    case "scar-reader": {
      if (event.type === "damage-received" && isTargetPokemon(effect, event.target.pokemonId)) {
        const learned = state.lists["battle.resistances"] ?? [];
        const carry = state.values.carryResistance === event.moveType && count("battle.turn") <= 1;
        if (learned.includes(event.moveType) || carry) {
          add({
            kind: "modify-action",
            source: effect.boonId,
            pokemonId: event.target.pokemonId,
            incomingDamageMultiplier: effect.rank >= 2 && !isEvolution(effect, "pattern-reader") ? 0.65 : 0.75,
          });
        }
        const capacity = isEvolution(effect, "pattern-reader") ? 2 : 1;
        state.lists["battle.resistances"] = [event.moveType, ...learned.filter(type => type !== event.moveType)].slice(
          0,
          capacity,
        );
        if (!state.values["battle.firstResistance"]) {
          state.values["battle.firstResistance"] = event.moveType;
        }
      }
      if (
        event.type === "battle-end"
        && isEvolution(effect, "deep-scar")
        && typeof state.values["battle.firstResistance"] === "string"
      ) {
        state.values.carryResistance = state.values["battle.firstResistance"];
      }
      if (event.type === "turn-start") {
        state.counters["battle.turn"] = event.turn;
      }
      break;
    }
    case "signature-technique": {
      if (event.type === "move-attempt") {
        const school = isEvolution(effect, "school-founder");
        const exactMove = isTargetMove(effect, event.moveId);
        const taggedMove = school && effect.target.moveTag != null && event.moveTags.includes(effect.target.moveTag);
        const applies = school ? taggedMove : exactMove;
        if (applies) {
          add({
            kind: "modify-action",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            damageMultiplier: school ? 1.15 : isEvolution(effect, "masterpiece") ? 1.4 : effect.rank >= 2 ? 1.25 : 1.15,
            ...(exactMove && event.useNumber % 3 === 0 ? { ppCost: 0 } : {}),
            ...(exactMove && effect.rank >= 2 ? { secondaryChanceMultiplier: 1.25 } : {}),
            ...(isEvolution(effect, "masterpiece") && event.ppBefore === 1 ? { guaranteeSecondary: true } : {}),
          });
        }
      }
      break;
    }
    case "improviser": {
      if (
        event.type === "move-resolved"
        && (isTargetPokemon(effect, event.user.pokemonId) || isEvolution(effect, "improvisational-doctrine"))
      ) {
        const ownerKey = isEvolution(effect, "improvisational-doctrine")
          ? `battle.${event.user.pokemonId}`
          : "battle.owner";
        const slotsKey = `${ownerKey}.slots`;
        const slots = new Set(state.lists[slotsKey] ?? []);
        slots.add(String(event.moveSlot));
        state.lists[slotsKey] = [...slots].sort();
        const threshold = isEvolution(effect, "virtuoso") ? 3 : 4;
        const triggerCap = effect.rank >= 2 && !isEvolution(effect, "improvisational-doctrine") ? 2 : 1;
        const triggerKey = `${ownerKey}.triggers`;
        if (slots.size >= threshold && count(triggerKey) < triggerCap) {
          const stats = (event.selectedStats ?? ["speed"]).slice(0, isEvolution(effect, "virtuoso") ? 2 : 1);
          for (const stat of stats) {
            add({
              kind: "stat-stage",
              source: effect.boonId,
              pokemonId: event.user.pokemonId,
              stat,
              stages: 1,
            });
          }
          increment(triggerKey);
          state.lists[slotsKey] = [];
        }
      }
      break;
    }
    case "blood-rival": {
      const selectedType = effect.target.elementalType;
      if (
        event.type === "move-attempt"
        && isTargetPokemon(effect, event.user.pokemonId)
        && selectedType != null
        && event.targetTypes?.includes(selectedType)
      ) {
        add({
          kind: "modify-action",
          source: effect.boonId,
          pokemonId: event.user.pokemonId,
          damageMultiplier: 1 + (effect.rank >= 2 ? 0.35 : 0.25) + count("obsession") * 0.02,
        });
      }
      if (
        event.type === "knockout"
        && isTargetPokemon(effect, event.attacker.pokemonId)
        && selectedType != null
        && event.defeatedTypes.includes(selectedType)
      ) {
        add({
          kind: "heal",
          source: effect.boonId,
          pokemonId: event.attacker.pokemonId,
          maxHpFraction: effect.rank >= 2 ? 0.12 : 0.08,
        });
        if (isEvolution(effect, "obsession") && increment("typedKos") % 10 === 0) {
          state.counters.obsession = Math.min(10, count("obsession") + 1);
        }
      }
      if (
        event.type === "damage-received"
        && isEvolution(effect, "slayer")
        && isTargetPokemon(effect, event.target.pokemonId)
        && event.moveType === selectedType
      ) {
        add({
          kind: "modify-action",
          source: effect.boonId,
          pokemonId: event.target.pokemonId,
          incomingDamageMultiplier: 0.8,
        });
      }
      break;
    }
    case "survivor-s-pride": {
      if (
        event.type === "lethal-check"
        && isTargetPokemon(effect, event.target.pokemonId)
        && event.hpBeforeFraction > 0.2
      ) {
        const key = isEvolution(effect, "deathless-pride")
          ? `boss.${event.bossBattle ? (state.values["battle.id"] ?? "current") : "none"}`
          : `biome.${event.biome}`;
        if ((isEvolution(effect, "deathless-pride") ? event.bossBattle : true) && !state.flags[key]) {
          add({
            kind: "survive",
            source: effect.boonId,
            pokemonId: event.target.pokemonId,
            hp: 1,
          });
          add({
            kind: "stat-stage",
            source: effect.boonId,
            pokemonId: event.target.pokemonId,
            stat: "speed",
            stages: 2,
          });
          if (effect.rank >= 2) {
            add({
              kind: "clear-negative-stage",
              source: effect.boonId,
              pokemonId: event.target.pokemonId,
              count: "all",
            });
            add({
              kind: "clear-volatile",
              source: effect.boonId,
              pokemonId: event.target.pokemonId,
              count: "all",
            });
          }
          if (isEvolution(effect, "last-laugh")) {
            setFlag("battle.lastLaughReady");
          }
          setFlag(key);
        }
      }
      if (
        event.type === "move-attempt"
        && event.damaging
        && isTargetPokemon(effect, event.user.pokemonId)
        && state.flags["battle.lastLaughReady"]
      ) {
        add({
          kind: "modify-action",
          source: effect.boonId,
          pokemonId: event.user.pokemonId,
          damageMultiplier: 2,
          alwaysHits: true,
        });
        setFlag("battle.lastLaughReady", false);
      }
      break;
    }
    case "quiet-mentor": {
      if (event.type === "battle-start") {
        const mentor = occupiedPokemon(event.party).find(pokemon => isTargetPokemon(effect, pokemon.pokemonId));
        if (mentor) {
          const recipients = isEvolution(effect, "senior-mentor")
            ? occupiedPokemon(event.party).filter(pokemon => pokemon.pokemonId !== mentor.pokemonId)
            : occupiedPokemon(event.party).filter(pokemon => Math.abs(pokemon.partySlot - mentor.partySlot) === 1);
          for (const recipient of recipients) {
            let stat: MoodyFormationStat = mentor.highestNonHpStat ?? "speed";
            if (isEvolution(effect, "balanced-tutelage")) {
              stat =
                recipient.partySlot < mentor.partySlot
                  ? (mentor.highestOffensiveStat ?? "attack")
                  : (mentor.highestDefensiveStat ?? "defense");
            }
            add({
              kind: "stat-stage",
              source: effect.boonId,
              pokemonId: recipient.pokemonId,
              stat,
              stages: 1,
              durationTurns: isEvolution(effect, "senior-mentor") ? 1 : effect.rank >= 2 ? 2 : 1,
            });
          }
        }
      }
      break;
    }
    case "copycat-heart": {
      if (event.type === "enemy-stat-increase") {
        const cap = effect.rank >= 2 ? 2 : 1;
        if (count("battle.copies") < cap) {
          const owner = effect.target.pokemonIds?.[0];
          if (owner != null) {
            add({
              kind: "stat-stage",
              source: effect.boonId,
              pokemonId: owner,
              stat: event.stat,
              stages: Math.min(6, event.stages + (isEvolution(effect, "better-than-you") ? 1 : 0)),
            });
            if (
              isEvolution(effect, "shared-inspiration")
              && count("battle.copies") === 0
              && event.selectedAdjacentPokemonId != null
            ) {
              add({
                kind: "stat-stage",
                source: effect.boonId,
                pokemonId: event.selectedAdjacentPokemonId,
                stat: event.stat,
                stages: event.stages,
              });
            }
            increment("battle.copies");
          }
        }
      }
      break;
    }
    case "mithridatism": {
      if (event.type === "status-cured" && isTargetPokemon(effect, event.pokemon.pokemonId)) {
        const key = `cures.${event.status}`;
        const cures = increment(key);
        if (effect.rank >= 2) {
          add({
            kind: "heal",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            maxHpFraction: 0.1,
          });
        }
        if (cures >= 3) {
          state.flags[`resistance.${event.status}`] = true;
        }
      }
      if (event.type === "evaluate" && isTargetPokemon(effect, event.pokemon.pokemonId) && event.pokemon.majorStatus) {
        const status = event.pokemon.majorStatus;
        const cures = count(`cures.${status}`);
        if (isEvolution(effect, "acquired-immunity") && cures >= 6) {
          add({
            kind: "status-resistance",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            status,
            tier: "immune",
          });
        } else if (isEvolution(effect, "weaponized-affliction") && cures >= 6) {
          add({
            kind: "status-resistance",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            status,
            tier: 2,
          });
          add({
            kind: "mark",
            source: effect.boonId,
            name: "afflictedDamageMultiplier",
            value: 1.25,
          });
          add({
            kind: "mark",
            source: effect.boonId,
            name: "afflictedIncomingDamageMultiplier",
            value: 0.8,
          });
        } else if (cures >= 3) {
          add({
            kind: "status-resistance",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            status,
            tier: 1,
          });
        }
      }
      break;
    }
    case "heirloom-bearer": {
      if (
        event.type === "item-activation"
        && isTargetPokemon(effect, event.pokemonId)
        && event.adapter !== "ineligible"
      ) {
        const primary = effect.target.itemStackIds?.[0] === event.itemStackId;
        const secondary =
          isEvolution(effect, "family-treasury") && effect.target.itemStackIds?.[1] === event.itemStackId;
        if (primary || secondary) {
          const firstKey = `battle.itemActivation.${event.itemStackId}`;
          add({
            kind: "amplify-item",
            source: effect.boonId,
            pokemonId: event.pokemonId,
            itemStackId: event.itemStackId,
            multiplier: secondary ? 1.2 : effect.rank >= 2 ? 1.4 : 1.25,
            protected: true,
            adapter: event.adapter,
            repeatActivation: isEvolution(effect, "living-heirloom") && !state.flags[firstKey],
          });
          setFlag(firstKey);
        }
      }
      break;
    }
    case "parting-gift": {
      if (event.type === "switch" && event.voluntary) {
        const doctrine = isEvolution(effect, "parting-doctrine");
        const applies = doctrine || isTargetSlot(effect, event.outgoing.partySlot);
        const key = doctrine ? `battle.parting.${event.outgoing.pokemonId}` : "battle.parting";
        if (applies && !state.flags[key]) {
          add({
            kind: "heal",
            source: effect.boonId,
            pokemonId: event.incoming.pokemonId,
            maxHpFraction: doctrine ? 0.08 : effect.rank >= 2 ? 0.15 : 0.1,
          });
          add({
            kind: "clear-volatile",
            source: effect.boonId,
            pokemonId: event.incoming.pokemonId,
            count: 1,
          });
          if (effect.rank >= 2 && !doctrine) {
            add({
              kind: "clear-negative-stage",
              source: effect.boonId,
              pokemonId: event.incoming.pokemonId,
              count: 1,
            });
          }
          if (isEvolution(effect, "keepsake")) {
            const stage = event.selectedPositiveStages?.[0] ?? stageEntries(event.outgoing)[0];
            if (stage) {
              add({
                kind: "stat-stage",
                source: effect.boonId,
                pokemonId: event.incoming.pokemonId,
                stat: stage.stat,
                stages: 1,
              });
            }
          }
          setFlag(key);
        }
      }
      break;
    }
    case "counterrotation": {
      if (event.type === "entry" && event.allyDamagedEarlierThisTurn) {
        const doctrine = isEvolution(effect, "counterrotation-doctrine");
        const applies = doctrine || isTargetSlot(effect, event.pokemon.partySlot);
        const key = doctrine ? `battle.counterrotation.${event.pokemon.pokemonId}` : "battle.counterrotation";
        if (applies && !state.flags[key]) {
          add({
            kind: "mark",
            source: effect.boonId,
            name: "sameTurnIncomingDamageMultiplier",
            value: doctrine ? 0.8 : effect.rank >= 2 ? 0.6 : 0.75,
          });
          if (isEvolution(effect, "perfect-counterstep")) {
            setFlag(`battle.priority.${event.pokemon.pokemonId}`);
          }
          setFlag(key);
        }
      }
      if (event.type === "move-attempt" && state.flags[`battle.priority.${event.user.pokemonId}`]) {
        add({
          kind: "modify-action",
          source: effect.boonId,
          pokemonId: event.user.pokemonId,
          priorityDelta: 1,
        });
        setFlag(`battle.priority.${event.user.pokemonId}`, false);
      }
      break;
    }
    case "tag-combo": {
      if (
        event.type === "switch"
        && event.voluntary
        && isTargetPokemon(effect, event.outgoing.pokemonId)
        && isTargetPokemon(effect, event.incoming.pokemonId)
      ) {
        const direction = `${event.outgoing.pokemonId}>${event.incoming.pokemonId}`;
        const key = effect.rank >= 2 ? `battle.tag.${direction}` : "battle.tag.total";
        if (!state.flags[key] && event.selectedBorrowedSecondaryId) {
          add({
            kind: "copy-secondary",
            source: effect.boonId,
            pokemonId: event.incoming.pokemonId,
            secondaryId: event.selectedBorrowedSecondaryId,
            uses: isEvolution(effect, "relay-chemistry") ? 2 : 1,
            guaranteed: true,
          });
          if (isEvolution(effect, "double-tag")) {
            add({
              kind: "echo",
              source: effect.boonId,
              pokemonId: event.incoming.pokemonId,
              powerFraction: 0.2,
              offensiveStatOwnerId: event.outgoing.pokemonId,
            });
          }
          setFlag(key);
        }
      }
      break;
    }
    case "hold-the-line": {
      if (
        event.type === "turn-complete"
        && isTargetPokemon(effect, event.pokemonId)
        && event.active
        && !state.flags["battle.entrenched"]
      ) {
        const turns = increment("battle.activeTurns");
        if (turns >= (effect.rank >= 2 ? 2 : 3)) {
          for (const stat of ["defense", "specialDefense"] as const) {
            add({
              kind: "stat-stage",
              source: effect.boonId,
              pokemonId: event.pokemonId,
              stat,
              stages: isEvolution(effect, "entrenched") ? 2 : 1,
            });
          }
          add({
            kind: "forced-switch-immunity",
            source: effect.boonId,
            pokemonId: event.pokemonId,
            duration: "while-active",
          });
          setFlag("battle.entrenched");
        }
      }
      if (event.type === "exit" && isTargetPokemon(effect, event.pokemonId)) {
        if (isEvolution(effect, "bulwark") && state.flags["battle.entrenched"]) {
          setFlag("battle.bulwarkReady");
        }
        state.counters["battle.activeTurns"] = 0;
        setFlag("battle.entrenched", false);
      }
      if (
        event.type === "switch"
        && isEvolution(effect, "bulwark")
        && isTargetPokemon(effect, event.outgoing.pokemonId)
        && (state.flags["battle.entrenched"] || state.flags["battle.bulwarkReady"])
        && !state.flags["battle.bulwarkUsed"]
      ) {
        add({
          kind: "barrier",
          source: effect.boonId,
          pokemonId: event.incoming.pokemonId,
          maxHpFraction: 0.2,
        });
        setFlag("battle.bulwarkUsed");
        setFlag("battle.bulwarkReady", false);
      }
      break;
    }
    case "revenge-entry": {
      if (event.type === "entry" && event.afterAllyFainted && isTargetPokemon(effect, event.pokemon.pokemonId)) {
        add({
          kind: "stat-stage",
          source: effect.boonId,
          pokemonId: event.pokemon.pokemonId,
          stat: "speed",
          stages: 1,
        });
        state.counters["battle.revengeTurns"] = 2;
        if (isEvolution(effect, "protective-revenge")) {
          add({
            kind: "barrier",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            maxHpFraction: 0.3,
          });
          add({
            kind: "clear-volatile",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            count: "all",
          });
        } else {
          add({
            kind: "mark",
            source: effect.boonId,
            name: "revengeDamageMultiplier",
            value: 1.2,
          });
        }
        if (effect.rank >= 2) {
          add({
            kind: "stat-stage",
            source: effect.boonId,
            pokemonId: event.pokemon.pokemonId,
            stat: event.pokemon.highestOffensiveStat ?? "attack",
            stages: 1,
          });
        }
      }
      if (
        event.type === "knockout"
        && isEvolution(effect, "vengeful-sweep")
        && isTargetPokemon(effect, event.attacker.pokemonId)
        && count("battle.revengeTurns") > 0
      ) {
        increment("battle.revengeTurns");
      }
      if (
        event.type === "turn-complete"
        && isTargetPokemon(effect, event.pokemonId)
        && count("battle.revengeTurns") > 0
      ) {
        state.counters["battle.revengeTurns"] = Math.max(0, count("battle.revengeTurns") - 1);
      }
      break;
    }
    case "turntable": {
      const doubleTime = isEvolution(effect, "double-time");
      const beatFor = (turn: number): "offbeat" | "downbeat" =>
        Math.floor((turn - 1) / (doubleTime ? 2 : 1)) % 2 === 0 ? "offbeat" : "downbeat";
      if (event.type === "turn-start") {
        state.values["battle.beat"] = beatFor(event.turn);
        state.counters["battle.turn"] = event.turn;
        setFlag("battle.beatMoveUsed", false);
        setFlag("battle.beatStatusUsed", false);
        add({
          kind: "mark",
          source: effect.boonId,
          name: "beat",
          value: state.values["battle.beat"],
        });
      }
      if (event.type === "move-attempt") {
        const beat = String(state.values["battle.beat"] ?? beatFor(1));
        const modifier = doubleTime ? 1.25 : effect.rank >= 2 ? 1.2 : 1.15;
        if (beat === "offbeat") {
          add({
            kind: "modify-action",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            damageMultiplier: modifier,
            ...(isEvolution(effect, "syncopation") && !state.flags["battle.beatMoveUsed"] ? { priorityDelta: 1 } : {}),
          });
          setFlag("battle.beatMoveUsed");
        }
      }
      if (event.type === "damage-received" && String(state.values["battle.beat"]) === "downbeat") {
        add({
          kind: "modify-action",
          source: effect.boonId,
          pokemonId: event.target.pokemonId,
          incomingDamageMultiplier: doubleTime ? 0.75 : effect.rank >= 2 ? 0.8 : 0.85,
        });
      }
      if (
        event.type === "status-directed"
        && isEvolution(effect, "syncopation")
        && String(state.values["battle.beat"]) === "downbeat"
        && !state.flags["battle.beatStatusUsed"]
      ) {
        add({
          kind: "negate",
          source: effect.boonId,
          event: event.volatile ? "volatile" : "status",
        });
        setFlag("battle.beatStatusUsed");
      }
      break;
    }
    case "countermelody": {
      if (event.type === "opponent-move") {
        const previous = Number(state.values["battle.opponentMove"] ?? -1);
        if (previous === event.moveId) {
          setFlag("battle.responseReady");
          state.values["battle.repeatedMove"] = event.moveId;
          if (isEvolution(effect, "dissonance")) {
            setFlag("battle.suppressRepeatedSecondary");
          }
        }
        state.values["battle.opponentMove"] = event.moveId;
      }
      if (event.type === "move-attempt") {
        const doctrine = isEvolution(effect, "call-and-response");
        const applies = doctrine || isTargetPokemon(effect, event.user.pokemonId);
        const useKey = doctrine ? `battle.response.${event.user.pokemonId}` : "battle.responseUses";
        const cap = effect.rank >= 2 && !doctrine ? 2 : 1;
        if (
          applies
          && state.flags["battle.responseReady"]
          && event.moveId !== Number(state.values["battle.repeatedMove"] ?? -1)
          && count(useKey) < cap
        ) {
          add({
            kind: "modify-action",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            priorityDelta: 1,
            alwaysHits: true,
            damageMultiplier: doctrine ? 1.1 : 1.2,
          });
          increment(useKey);
          setFlag("battle.responseReady", false);
        }
        if (
          isEvolution(effect, "dissonance")
          && state.flags["battle.suppressRepeatedSecondary"]
          && event.moveId === Number(state.values["battle.repeatedMove"])
        ) {
          add({
            kind: "modify-action",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            suppressSecondary: true,
          });
          setFlag("battle.suppressRepeatedSecondary", false);
        }
      }
      break;
    }
    case "type-echo": {
      if (
        event.type === "move-attempt"
        && event.damaging
        && event.previousAlliedAction?.damaging
        && event.previousAlliedAction.pokemonId !== event.user.pokemonId
        && event.previousAlliedAction.moveType === event.moveType
      ) {
        const pair = isEvolution(effect, "resonant-pair");
        const doctrine = isEvolution(effect, "type-choir");
        const applies =
          doctrine
          || (pair
            ? isTargetPokemon(effect, event.user.pokemonId)
              && isTargetPokemon(effect, event.previousAlliedAction.pokemonId)
            : isTargetPokemon(effect, event.user.pokemonId));
        if (applies) {
          add({
            kind: "echo",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            powerFraction: pair ? 0.5 : doctrine ? 0.2 : effect.rank >= 2 ? 0.35 : 0.25,
          });
        }
      }
      break;
    }
    case "off-brand-genius": {
      if (
        event.type === "move-attempt"
        && event.damaging
        && !event.isStab
        && (isTargetPokemon(effect, event.user.pokemonId) || isEvolution(effect, "off-brand-doctrine"))
      ) {
        add({
          kind: "modify-action",
          source: effect.boonId,
          pokemonId: event.user.pokemonId,
          damageMultiplier: isEvolution(effect, "off-brand-doctrine") ? 1.15 : effect.rank >= 2 ? 1.3 : 1.2,
          ...(isEvolution(effect, "polymath") ? { accuracyMultiplier: 1.1, secondaryChanceMultiplier: 1.25 } : {}),
        });
      }
      break;
    }
    case "specialist-s-focus": {
      if (
        event.type === "move-attempt"
        && event.damaging
        && (isTargetPokemon(effect, event.user.pokemonId) || isEvolution(effect, "specialist-doctrine"))
      ) {
        const selected = event.moveType === effect.target.elementalType;
        const multiplier = isEvolution(effect, "specialist-doctrine")
          ? selected
            ? 1.15
            : 0.95
          : isEvolution(effect, "fanatic")
            ? selected
              ? 1.55
              : 0.85
            : effect.rank >= 2
              ? selected
                ? 1.35
                : 0.9
              : selected
                ? 1.2
                : 0.95;
        add({
          kind: "modify-action",
          source: effect.boonId,
          pokemonId: event.user.pokemonId,
          damageMultiplier: multiplier,
        });
      }
      break;
    }
    case "conservation-law": {
      if (
        event.type === "move-attempt"
        && event.damaging
        && (isTargetPokemon(effect, event.user.pokemonId) || isEvolution(effect, "conservation-doctrine"))
      ) {
        const fraction = event.ppBefore / Math.max(1, event.maxPp);
        const doctrine = isEvolution(effect, "conservation-doctrine");
        const bonuses = doctrine ? [0.05, 0.15, 0.3] : effect.rank >= 2 ? [0.15, 0.3, 0.5] : [0.08, 0.2, 0.35];
        const index = event.ppBefore === 1 ? 2 : fraction <= 0.25 ? 1 : fraction < 0.5 ? 0 : -1;
        if (index >= 0) {
          add({
            kind: "modify-action",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            damageMultiplier: isEvolution(effect, "final-reserve") && event.ppBefore === 1 ? 2 : 1 + bonuses[index],
            ...(isEvolution(effect, "final-reserve") && event.ppBefore === 1 ? { guaranteeSecondary: true } : {}),
          });
        }
      }
      break;
    }
    case "deep-reservoir": {
      if (event.type === "battle-start") {
        const pokemonId =
          effect.target.pokemonIds?.[0]
          ?? occupiedPokemon(event.party).find(pokemon => isTargetMove(effect, pokemon.mostDepletedMoveId ?? -1))
            ?.pokemonId;
        if (pokemonId != null) {
          add({
            kind: "max-pp",
            source: effect.boonId,
            pokemonId,
            ...(effect.target.moveIds?.[0] == null ? {} : { moveId: effect.target.moveIds[0] }),
            flatDelta: isEvolution(effect, "deep-wells") ? 2 : effect.rank >= 2 ? 5 : 3,
            allMoves: isEvolution(effect, "deep-wells"),
          });
        }
      }
      if (event.type === "move-resolved" && isTargetMove(effect, event.moveId)) {
        const uses = increment("battle.reservoirUses");
        if (uses % (effect.rank >= 2 ? 4 : 5) === 0) {
          add({
            kind: "restore-pp",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            amount: 1,
            allDepletedMoves: isEvolution(effect, "artesian-move"),
          });
        }
      }
      break;
    }
    case "full-repertoire": {
      if (
        event.type === "move-resolved"
        && (isTargetPokemon(effect, event.user.pokemonId) || isEvolution(effect, "repertoire-doctrine"))
      ) {
        const owner = isEvolution(effect, "repertoire-doctrine") ? event.user.pokemonId : effect.target.pokemonIds?.[0];
        if (owner === event.user.pokemonId) {
          const key = `battle.categories.${owner}`;
          const categories = new Set(state.lists[key] ?? []);
          const isNew = !categories.has(event.category);
          if (isNew) {
            categories.add(event.category);
            state.lists[key] = [...categories].sort();
            const doctrine = isEvolution(effect, "repertoire-doctrine");
            const usedKey = `battle.repertoireRewards.${owner}`;
            const usedRewards = new Set(state.lists[usedKey] ?? []);
            const availableRewards = (event.selectedRepertoireRewards ?? []).filter(reward => !usedRewards.has(reward));
            const curtainAt = isEvolution(effect, "virtuoso") ? 2 : 3;
            const rewardCount = doctrine
              ? 1
              : categories.size === curtainAt
                ? 3
                : isEvolution(effect, "virtuoso") && categories.size === 3
                  ? 2
                  : 1;
            const rewards = availableRewards.slice(0, rewardCount);
            for (const reward of rewards) {
              add({
                kind: "repertoire-reward",
                source: effect.boonId,
                pokemonId: owner,
                reward,
                magnitudeMultiplier: doctrine ? 0.75 : effect.rank >= 2 ? 1.25 : 1,
              });
              usedRewards.add(reward);
            }
            state.lists[usedKey] = [...usedRewards].sort();
            if (!doctrine && categories.size === curtainAt) {
              add({
                kind: "mark",
                source: effect.boonId,
                name: "curtainCallRewards",
                value: 2,
              });
            } else if (!doctrine && isEvolution(effect, "virtuoso") && categories.size === 3) {
              add({
                kind: "mark",
                source: effect.boonId,
                name: "fullRepertoireReward",
                value: 1,
              });
            }
          }
        }
      }
      break;
    }
    case "refrain": {
      if (event.type === "move-attempt" && isTargetMove(effect, event.moveId)) {
        const step = Math.max(1, event.consecutiveUse);
        const basePower = [1, 1.2, 1.45, 1.75][Math.min(3, step - 1)];
        const power = isEvolution(effect, "crescendo")
          ? [1, 1.2, 1.55, 2, 2.25][Math.min(4, step - 1)]
          : effect.rank >= 2 && step >= 4
            ? 2
            : basePower;
        const ppCost = isEvolution(effect, "efficient-refrain")
          ? [1, 1, 2, 3][Math.min(3, step - 1)]
          : [1, 2, 3, 4][Math.min(3, step - 1)];
        add({
          kind: "modify-action",
          source: effect.boonId,
          pokemonId: event.user.pokemonId,
          damageMultiplier: power,
          ppCost,
        });
      }
      if (event.type === "move-resolved") {
        if (!isTargetMove(effect, event.moveId) || event.outcome !== "hit") {
          state.counters["battle.refrain"] = 0;
        } else {
          increment("battle.refrain");
        }
      }
      if (event.type === "switch" && isTargetPokemon(effect, event.outgoing.pokemonId)) {
        state.counters["battle.refrain"] = 0;
      }
      break;
    }
    case "failure-is-data": {
      if (
        event.type === "move-resolved"
        && event.outcome !== "hit"
        && (isTargetPokemon(effect, event.user.pokemonId) || isEvolution(effect, "team-research"))
      ) {
        const doctrine = isEvolution(effect, "team-research");
        const key = doctrine ? `battle.failure.${event.user.pokemonId}` : "battle.failureUses";
        const cap = doctrine ? 1 : effect.rank >= 2 ? 2 : 1;
        if (count(key) < cap) {
          add({
            kind: "restore-pp",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            moveId: event.moveId,
            amount: 1,
          });
          add({
            kind: "stat-stage",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            stat: "speed",
            stages: 1,
          });
          setFlag(`battle.accuracy.${event.user.pokemonId}`);
          if (isEvolution(effect, "scientific-method")) {
            setFlag(`battle.secondary.${event.user.pokemonId}`);
          }
          increment(key);
        }
      }
      if (event.type === "move-attempt" && state.flags[`battle.accuracy.${event.user.pokemonId}`]) {
        add({
          kind: "modify-action",
          source: effect.boonId,
          pokemonId: event.user.pokemonId,
          alwaysHits: true,
          ...(state.flags[`battle.secondary.${event.user.pokemonId}`] ? { guaranteeSecondary: true } : {}),
        });
        setFlag(`battle.accuracy.${event.user.pokemonId}`, false);
        setFlag(`battle.secondary.${event.user.pokemonId}`, false);
      }
      break;
    }
    case "overdraft": {
      if (event.type === "move-attempt" && event.ppBefore === 0) {
        const emergency = isEvolution(effect, "emergency-funding");
        const applies = emergency || isTargetMove(effect, event.moveId);
        const key = emergency ? "battle.overdraftAny" : "battle.overdraftUses";
        const cap = isEvolution(effect, "blood-credit") ? 2 : 1;
        if (applies && count(key) < cap) {
          const nextUse = count(key) + 1;
          const hpCost = isEvolution(effect, "blood-credit") && nextUse === 2 ? 0.3 : effect.rank >= 2 ? 0.15 : 0.2;
          add({
            kind: "mark",
            source: effect.boonId,
            name: "maxHpCost",
            value: hpCost,
          });
          add({
            kind: "modify-action",
            source: effect.boonId,
            pokemonId: event.user.pokemonId,
            damageMultiplier: effect.rank >= 2 ? 1.45 : 1.3,
            ppCost: 0,
            ...(emergency ? {} : { guaranteeSecondary: true }),
          });
          increment(key);
        }
      }
      break;
    }
    case "final-draft": {
      if (event.type === "move-attempt" && event.ppBefore === 1) {
        const collected = isEvolution(effect, "collected-works");
        const applies = collected || isTargetMove(effect, event.moveId);
        const key = collected ? `battle.finalDraft.${event.user.pokemonId}.${event.moveId}` : "battle.finalDraft";
        if (applies && !state.flags[key]) {
          const endings = event.finalDraftEndings ?? [];
          const chooseCount = isEvolution(effect, "director-s-cut") ? 2 : 1;
          if (endings.length < chooseCount) {
            add({
              kind: "choice-required",
              source: effect.boonId,
              choice: "final-draft",
              options: ["climax", "precision", "revision"],
              chooseCount,
            });
          } else {
            const weaker = collected;
            if (endings.includes("climax")) {
              add({
                kind: "modify-action",
                source: effect.boonId,
                pokemonId: event.user.pokemonId,
                damageMultiplier: weaker ? 1.5 : effect.rank >= 2 ? 2.3 : 2,
              });
            }
            if (endings.includes("precision")) {
              add({
                kind: "modify-action",
                source: effect.boonId,
                pokemonId: event.user.pokemonId,
                alwaysHits: true,
                guaranteeSecondary: !weaker,
                ...(effect.rank >= 2 && !weaker ? { damageMultiplier: 1.2 } : {}),
              });
            }
            if (endings.includes("revision")) {
              add({
                kind: "restore-pp",
                source: effect.boonId,
                pokemonId: event.user.pokemonId,
                moveId: event.moveId,
                amount: weaker ? 1 : effect.rank >= 2 ? 3 : 2,
              });
              add({
                kind: "mark",
                source: effect.boonId,
                name: "maxHpCost",
                value: weaker ? 0.1 : 0.15,
              });
            }
            if (isEvolution(effect, "director-s-cut")) {
              add({
                kind: "disable-move",
                source: effect.boonId,
                pokemonId: event.user.pokemonId,
                moveId: event.moveId,
                duration: "battle",
              });
            }
            setFlag(key);
          }
        }
      }
      break;
    }
  }

  return {
    state,
    commands,
    triggered: commands.length > 0 || JSON.stringify(state) !== JSON.stringify(inputState),
  };
}
