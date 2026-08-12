import { MOODY_BOONS, MOODY_CURSES } from "#data/elite-redux/moody/moody-catalog.generated";
import { resolveMoodyActiveItemSets } from "#data/elite-redux/moody/moody-item-sets";

export type MoodyRuntimeStage = "base" | "rank-two" | string;
export type MoodyRuntimeValue =
  | number
  | string
  | boolean
  | null
  | readonly MoodyRuntimeValue[]
  | {
      readonly [key: string]: MoodyRuntimeValue;
    };

export interface MoodyRuntimeEvent {
  readonly kind: string;
  readonly seed: number;
  readonly data: Readonly<Record<string, MoodyRuntimeValue>>;
}

export interface MoodyRuntimeState {
  readonly counters?: Readonly<Record<string, number>>;
  readonly flags?: Readonly<Record<string, boolean>>;
  readonly values?: Readonly<Record<string, MoodyRuntimeValue>>;
}

export interface MoodyRuntimeCommand {
  readonly kind: string;
  readonly data: Readonly<Record<string, MoodyRuntimeValue>>;
}

export interface MoodyRuntimeStateDelta {
  readonly op: "set" | "increment" | "delete";
  readonly path: `counters.${string}` | `flags.${string}` | `values.${string}`;
  readonly value?: MoodyRuntimeValue;
}

export interface MoodyRuntimeResult {
  readonly commands: readonly MoodyRuntimeCommand[];
  readonly stateDeltas: readonly MoodyRuntimeStateDelta[];
}

export interface MoodyRuntimeEventContract {
  readonly kind: string;
  readonly requiredInputs: readonly string[];
}

export interface MoodyRuntimeEffectMeta {
  readonly id: string;
  readonly number: number;
  readonly source: "boon" | "curse";
  readonly status: "ready" | "blocked";
  readonly base: string;
  readonly rankTwo?: string;
  readonly evolutions: readonly { readonly id: string; readonly description: string }[];
  readonly events: readonly MoodyRuntimeEventContract[];
}

export const MOODY_RUNTIME_BOON_IDS = [
  "compound-interest",
  "warranty",
  "recycler",
  "set-collector",
  "blood-market",
  "bounty-board",
  "recruiter-s-eye",
  "contraband-slot",
  "diversity-charter",
  "monotype-oath",
  "underdog-dividend",
  "growth-ring",
  "flawless-ledger",
  "hunter-s-mark",
  "pair-bond",
  "bench-academy",
  "bossbreaker",
  "legacy-slot",
  "time-loop",
  "recapitulation",
  "pocket-turn",
  "ability-carousel",
  "mirror-theft",
  "phase-shift",
  "apex-plunder",
  "inversion-window",
  "borrowed-future",
  "pressure-valve",
  "negative-space",
] as const;

export const MOODY_RUNTIME_NONCOMBAT_CURSE_IDS = [
  "frayed-supplies",
  "thin-wallet",
  "jealous-relics",
  "no-takebacks",
  "mortal-wounds",
  "cursed-inventory",
  "elite-pursuit",
  "hollow-victory",
  "the-long-night",
] as const;

export const MOODY_RUNTIME_PROGRESSION_CURSE_IDS = [
  "public-enemy",
  "mood-swing",
  "nemesis-protocol",
  "blood-moon",
  "reverse-snowball",
  "cursed-draft",
  "entropy",
  "feedback-loop",
] as const;

export const MOODY_RUNTIME_CURSE_IDS = [
  ...MOODY_RUNTIME_NONCOMBAT_CURSE_IDS,
  ...MOODY_RUNTIME_PROGRESSION_CURSE_IDS,
] as const;

export const MOODY_RUNTIME_BLOCKED_IDS = [] as const;

const MOODY_RUNTIME_BLOCKED_ID_SET = new Set<string>(MOODY_RUNTIME_BLOCKED_IDS);

const EVENT_CONTRACTS: Readonly<Record<string, readonly MoodyRuntimeEventContract[]>> = {
  "compound-interest": [
    { kind: "boss-defeated", requiredInputs: ["money", "capRemaining"] },
    { kind: "biome-transition", requiredInputs: ["money", "patientRate", "capRemaining"] },
    { kind: "market-purchase", requiredInputs: [] },
  ],
  warranty: [{ kind: "consumable-activated", requiredInputs: ["itemStackId", "activationIndex", "isSelectedStack"] }],
  recycler: [
    {
      kind: "reward-recycle",
      requiredInputs: ["destroyedIndices", "remainingIndices", "originalRarities", "destroyedCategory"],
    },
  ],
  "set-collector": [{ kind: "item-set-query", requiredInputs: ["ownedDistinctItemIds", "chosenSetId"] }],
  "blood-market": [
    { kind: "blood-market-purchase", requiredInputs: ["itemTier", "debtRate", "usageRanking", "maxHpByPokemon"] },
  ],
  "bounty-board": [
    { kind: "contract-draft", requiredInputs: ["feasibleContractIds"] },
    { kind: "contract-completed", requiredInputs: ["contractId"] },
    { kind: "contract-declined", requiredInputs: [] },
    { kind: "contract-failed", requiredInputs: [] },
  ],
  "recruiter-s-eye": [{ kind: "wild-encounter-generated", requiredInputs: ["missingTraits", "traitRarity"] }],
  "contraband-slot": [{ kind: "item-rule-query", requiredInputs: ["itemStackId", "isSelectedStack"] }],
  "diversity-charter": [
    {
      kind: "party-composition-query",
      requiredInputs: ["uniqueTypeCount", "firstDamagingMove", "firstSuperEffectiveHit"],
    },
  ],
  "monotype-oath": [
    {
      kind: "party-composition-query",
      requiredInputs: [
        "matchingContributors",
        "consciousCount",
        "allConsciousMatch",
        "moveMatchesType",
        "incomingMatchesType",
        "firstDamagingMove",
      ],
    },
  ],
  "underdog-dividend": [
    { kind: "pokemon-stat-query", requiredInputs: ["levelGap", "fullyEvolved", "enemyAboveLevel", "caughtUp"] },
  ],
  "growth-ring": [
    { kind: "pokemon-stat-query", requiredInputs: ["fullyEvolved"] },
    { kind: "pokemon-evolved", requiredInputs: ["pokemonId"] },
  ],
  "flawless-ledger": [
    { kind: "wave-completed", requiredInputs: ["alliedFaintCount", "biomeFailureShieldAvailable"] },
    { kind: "reward-generated", requiredInputs: ["slotCount"] },
  ],
  "hunter-s-mark": [
    { kind: "typed-enemy-defeated", requiredInputs: ["matchesMarkedType", "bossSegments"] },
    { kind: "hunter-choice-resolved", requiredInputs: ["choice", "amount"] },
  ],
  "pair-bond": [
    { kind: "pair-query", requiredInputs: ["bothConscious"] },
    { kind: "direct-pair-switch", requiredInputs: [] },
    { kind: "pair-member-fainted", requiredInputs: ["fallenPokemonId", "survivorPokemonId", "eligibleMoveIds"] },
  ],
  "bench-academy": [
    { kind: "experience-query", requiredInputs: ["levelGap", "isLowest", "isSecondLowest"] },
    { kind: "academy-graduated", requiredInputs: [] },
  ],
  bossbreaker: [{ kind: "boss-segment-broken", requiredInputs: ["pokemonId"] }],
  "legacy-slot": [
    { kind: "pokemon-permanently-removed", requiredInputs: ["eligibleImprints", "partySlot", "boundPartySlot"] },
  ],
  "time-loop": [
    {
      kind: "lethal-result-preview",
      requiredInputs: ["isBossBattle", "segmentUses", "turnSnapshotId", "enemyActionIds"],
    },
  ],
  recapitulation: [{ kind: "allied-damaging-action", requiredInputs: ["action"] }],
  "pocket-turn": [
    { kind: "move-failed", requiredInputs: ["reason"] },
    { kind: "allied-move-committed", requiredInputs: ["actionId", "targetActionId"] },
  ],
  "ability-carousel": [
    { kind: "battle-start", requiredInputs: ["occupiedParty", "compatibleAbilityIdsByPokemon"] },
    { kind: "adjacent-direct-switch", requiredInputs: ["pokemonId", "compatibleAbilityIds"] },
  ],
  "mirror-theft": [{ kind: "enemy-effect-created", requiredInputs: ["effectKind", "effectData", "targetPokemonId"] }],
  "phase-shift": [
    { kind: "turn-start", requiredInputs: ["turn"] },
    { kind: "direct-hit-preview", requiredInputs: ["turn"] },
  ],
  "apex-plunder": [
    { kind: "segmented-boss-defeated", requiredInputs: ["pokemonId"] },
    { kind: "lethal-result-preview", requiredInputs: ["pokemonId"] },
    { kind: "biome-transition", requiredInputs: ["pokemonId"] },
  ],
  "inversion-window": [
    { kind: "type-effectiveness-query", requiredInputs: ["direction", "effectiveness", "pokemonId"] },
  ],
  "borrowed-future": [
    { kind: "prebattle-commit", requiredInputs: ["enemyRoster", "enemyLead", "committedActions", "visibleLeadData"] },
  ],
  "pressure-valve": [
    {
      kind: "positive-stat-overflow",
      requiredInputs: ["pokemonId", "overflowStages", "selectedValve", "mostUsefulValve"],
    },
  ],
  "negative-space": [{ kind: "move-selection-query", requiredInputs: ["pokemonId", "moveId", "isFirstUsableMove"] }],
  "frayed-supplies": [{ kind: "direct-healing-query", requiredInputs: ["amount"] }],
  "thin-wallet": [{ kind: "market-price-query", requiredInputs: ["price"] }],
  "jealous-relics": [{ kind: "item-effect-query", requiredInputs: ["copyIndex", "effectValue", "duplicateScale"] }],
  "no-takebacks": [{ kind: "reward-replacement-query", requiredInputs: ["operation", "baseCost", "baseSacrifices"] }],
  "mortal-wounds": [
    { kind: "revive-query", requiredInputs: ["pokemonId"] },
    { kind: "biome-transition", requiredInputs: [] },
  ],
  "cursed-inventory": [
    { kind: "biome-transition", requiredInputs: ["usageRanking", "eligibleStacksByPokemon"] },
    { kind: "item-effect-query", requiredInputs: ["pokemonId", "itemStackId", "isActive"] },
  ],
  "elite-pursuit": [{ kind: "wave-encounter-query", requiredInputs: ["waveIndex", "isBossWave"] }],
  "hollow-victory": [
    { kind: "battle-completed", requiredInputs: ["alliedFaintCount"] },
    { kind: "reward-generated", requiredInputs: [] },
  ],
  "the-long-night": [
    { kind: "biome-heal-query", requiredInputs: [] },
    { kind: "market-price-query", requiredInputs: ["price", "isHealingItem"] },
  ],
  "public-enemy": [
    {
      kind: "trainer-roster-generated",
      requiredInputs: ["isEligibleTrainer", "isBossTrainer", "baseRosterSize", "maxRosterSize"],
    },
    { kind: "boss-final-pokemon-fainted", requiredInputs: ["pokemonId"] },
  ],
  "mood-swing": [{ kind: "ten-wave-boundary", requiredInputs: ["waveIndex", "activeBoonInstanceIds"] }],
  "nemesis-protocol": [
    { kind: "enemy-boon-generation", requiredInputs: ["baseCounterWeight", "isBoss", "topThreatPokemonId"] },
  ],
  "blood-moon": [{ kind: "boss-roster-defeated", requiredInputs: ["pokemonIds"] }],
  "reverse-snowball": [{ kind: "battle-completed", requiredInputs: ["partySize", "alliedFaintCount"] }],
  "cursed-draft": [{ kind: "boon-draft-generated", requiredInputs: ["offerIds"] }],
  entropy: [{ kind: "biome-transition", requiredInputs: ["partyMoves", "eligibleReplacementsByMove"] }],
  "feedback-loop": [
    { kind: "action-boons-resolved", requiredInputs: ["pokemonId", "maxHp", "currentHp", "triggeredBoonIds"] },
  ],
};

const boonById = new Map(MOODY_BOONS.map(boon => [boon.id, boon]));
const curseById = new Map(MOODY_CURSES.map(curse => [curse.id, curse]));

export const MOODY_RUNTIME_EFFECTS: readonly MoodyRuntimeEffectMeta[] = [
  ...MOODY_RUNTIME_BOON_IDS.map(id => {
    const definition = boonById.get(id)!;
    return {
      id,
      number: definition.number,
      source: "boon" as const,
      status: MOODY_RUNTIME_BLOCKED_ID_SET.has(id) ? ("blocked" as const) : ("ready" as const),
      base: definition.base,
      rankTwo: definition.rankTwo,
      evolutions: definition.evolutions.map(evolution => ({ id: evolution.id, description: evolution.description })),
      events: EVENT_CONTRACTS[id],
    };
  }),
  ...MOODY_RUNTIME_CURSE_IDS.map(id => {
    const definition = curseById.get(id)!;
    return {
      id,
      number: definition.number,
      source: "curse" as const,
      status: "ready" as const,
      base: definition.description,
      evolutions: [],
      events: EVENT_CONTRACTS[id],
    };
  }),
];

export const MOODY_RUNTIME_EFFECT_BY_ID = new Map(MOODY_RUNTIME_EFFECTS.map(effect => [effect.id, effect]));

function numberValue(event: MoodyRuntimeEvent, key: string, fallback = 0): number {
  const value = event.data[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(event: MoodyRuntimeEvent, key: string): boolean {
  return event.data[key] === true;
}

function stringValue(event: MoodyRuntimeEvent, key: string): string {
  const value = event.data[key];
  return typeof value === "string" ? value : "";
}

function stringArray(event: MoodyRuntimeEvent, key: string): readonly string[] {
  const value = event.data[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function objectValue(event: MoodyRuntimeEvent, key: string): Readonly<Record<string, MoodyRuntimeValue>> {
  const value = event.data[key];
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, MoodyRuntimeValue>>)
    : {};
}

function counter(state: MoodyRuntimeState, key: string): number {
  return state.counters?.[key] ?? 0;
}

function flag(state: MoodyRuntimeState, key: string): boolean {
  return state.flags?.[key] === true;
}

function command(kind: string, data: Readonly<Record<string, MoodyRuntimeValue>> = {}): MoodyRuntimeCommand {
  return { kind, data };
}

function set(path: MoodyRuntimeStateDelta["path"], value: MoodyRuntimeValue): MoodyRuntimeStateDelta {
  return { op: "set", path, value };
}

function increment(path: MoodyRuntimeStateDelta["path"], value: number): MoodyRuntimeStateDelta {
  return { op: "increment", path, value };
}

function result(
  commands: readonly MoodyRuntimeCommand[] = [],
  stateDeltas: readonly MoodyRuntimeStateDelta[] = [],
): MoodyRuntimeResult {
  return { commands, stateDeltas };
}

function choose(seed: number, values: readonly string[], salt = 0): string | undefined {
  if (values.length === 0) {
    return;
  }
  let mixed = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  return values[(mixed >>> 0) % values.length];
}

function seededFraction(seed: number, salt: number): number {
  let mixed = (seed ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return (mixed >>> 0) / 0x1_0000_0000;
}

function masterContractModifier(contractId: string): Readonly<Record<string, MoodyRuntimeValue>> {
  switch (contractId) {
    case "five-elemental-types":
      return { requiredCount: 8 };
    case "every-member-acts":
      return { minimumActionsPerMember: 2 };
    case "lowest-level-ko":
      return { requiredKoCount: 2 };
    case "break-boss-segment":
      return { requiredSegmentCount: 2 };
    case "distinct-statuses":
      return { requiredCount: 5 };
    case "three-switches":
      return { requiredCount: 6 };
    case "marked-above-threshold":
      return { minimumHpFraction: 0.8 };
    case "boss-turn-limit":
      return { maximumTurns: 6 };
    case "win-under-weather":
      return { maximumTurns: 8 };
    case "no-allied-faint":
      return { additionalConstraint: "no-healing" };
    case "no-healing":
      return { additionalConstraint: "no-allied-faint" };
    case "no-consecutive-repeat":
      return { additionalConstraint: "use-eight-elemental-types" };
    case "no-super-effective":
      return { additionalConstraint: "no-consumables" };
    case "no-consumables":
      return { additionalConstraint: "no-healing" };
    case "one-ko-each":
      return { additionalConstraint: "no-allied-faint" };
    default:
      return { thresholdMultiplier: 2 };
  }
}

function rank(stage: MoodyRuntimeStage): 1 | 2 | 3 {
  return stage === "base" ? 1 : stage === "rank-two" ? 2 : 3;
}

function resolveBoon(
  effectId: string,
  stage: MoodyRuntimeStage,
  event: MoodyRuntimeEvent,
  state: MoodyRuntimeState,
): MoodyRuntimeResult {
  const currentRank = rank(stage);
  const evolution = currentRank === 3 ? stage : undefined;
  switch (effectId) {
    case "compound-interest": {
      if (event.kind === "market-purchase" && evolution === "aggressive-investment") {
        return result([], [set("counters.accumulatedInterest", 0)]);
      }
      if (event.kind !== "boss-defeated" && !(event.kind === "biome-transition" && evolution === "patient-capital")) {
        return result();
      }
      const rate =
        event.kind === "biome-transition"
          ? numberValue(event, "patientRate")
          : evolution === "aggressive-investment"
            ? 0.1
            : currentRank >= 2
              ? 0.075
              : 0.05;
      const amount = Math.max(
        0,
        Math.min(Math.floor(numberValue(event, "money") * rate), numberValue(event, "capRemaining")),
      );
      return result(
        [command("grant-money", { amount, source: effectId })],
        [increment("counters.accumulatedInterest", amount)],
      );
    }
    case "warranty": {
      if (event.kind !== "consumable-activated") {
        return result();
      }
      const selected = booleanValue(event, "isSelectedStack");
      const activation = numberValue(event, "activationIndex");
      const guaranteed = selected && activation <= (currentRank >= 2 ? 2 : 1);
      const extended =
        evolution === "extended-warranty"
        && activation === 1
        && numberValue(event, "roll", 1) < numberValue(event, "extendedChance");
      const commands =
        guaranteed || extended
          ? [command("preserve-item-stack", { itemStackId: stringValue(event, "itemStackId") })]
          : [];
      return result(
        evolution === "lifetime-warranty" && selected && activation === 1
          ? [...commands, command("repeat-consumable-effect")]
          : commands,
      );
    }
    case "recycler": {
      if (event.kind !== "reward-recycle") {
        return result();
      }
      const destroyed = event.data.destroyedIndices;
      const upcycle = evolution === "upcycler";
      const destroyedIndices = Array.isArray(destroyed)
        ? destroyed.filter((value): value is number => typeof value === "number")
        : [];
      const originalRarities = Array.isArray(event.data.originalRarities) ? event.data.originalRarities : [];
      const minimumOutputTier = Math.max(
        0,
        ...destroyedIndices.map(index => {
          const tier = originalRarities[index];
          return typeof tier === "number" ? tier + 1 : 0;
        }),
      );
      return result(
        [
          command(upcycle ? "generate-upcycled-reward" : "reroll-reward-options", {
            destroyedIndices: destroyed ?? [],
            rerollIndices: event.data.remainingIndices ?? [],
            improvedBaseWeights: true,
            minimumOriginalRarity: currentRank >= 2,
            excludedCategory: evolution === "closed-loop" ? (event.data.destroyedCategory ?? null) : null,
            minimumTierIncrease: upcycle ? 1 : 0,
            minimumOutputTier: upcycle ? minimumOutputTier : 0,
            applyLuckAfterward: true,
          }),
        ],
        [set("flags.recyclerUsedThisScreen", true)],
      );
    }
    case "set-collector": {
      if (event.kind !== "item-set-query") {
        return result();
      }
      const activeSets = resolveMoodyActiveItemSets(
        stringArray(event, "ownedDistinctItemIds"),
        stage,
        stringValue(event, "chosenSetId") || null,
      );
      return result([command("apply-item-set-bonuses", { activeSets })], [set("values.activeItemSets", activeSets)]);
    }
    case "blood-market": {
      if (event.kind !== "blood-market-purchase") {
        return result();
      }
      const ranking = stringArray(event, "usageRanking");
      const debtors = evolution === "split-bill" ? ranking.slice(0, 2) : ranking.slice(0, 1);
      const hp = objectValue(event, "maxHpByPokemon");
      const multiplier = (currentRank >= 2 ? 0.75 : 1) * (evolution === "blood-premium" ? 1.5 : 1);
      const debts = debtors.map(pokemonId => ({
        pokemonId,
        hpDebt: Math.ceil(
          ((Number(hp[pokemonId]) || 0) * numberValue(event, "debtRate") * multiplier) / debtors.length,
        ),
      }));
      return result(
        [
          command("purchase-with-blood-debt", {
            debts,
            enhancedPurchase: evolution === "blood-premium",
            expiresAt: "next-biome-transition",
          }),
        ],
        [set("values.bloodDebts", debts)],
      );
    }
    case "bounty-board": {
      if (event.kind === "contract-draft") {
        const feasible = stringArray(event, "feasibleContractIds");
        const count = currentRank >= 2 ? 3 : 1;
        const offered: string[] = [];
        for (let index = 0; index < Math.min(count, feasible.length); index++) {
          const selected = choose(
            event.seed,
            feasible.filter(candidate => !offered.includes(candidate)),
            index,
          );
          if (selected != null) {
            offered.push(selected);
          }
        }
        const contractIds =
          evolution === "master-contract" ? offered.map(contractId => `master:${contractId}`) : offered;
        return result([
          command("offer-feasible-contracts", {
            contractIds: [...new Set(contractIds)],
            optional: true,
            autoAccept: false,
            masterDifficulty: evolution === "master-contract",
            objectiveDifficulty: evolution === "master-contract" ? "master" : "standard",
            objectiveModifiers:
              evolution === "master-contract"
                ? offered.map(contractId => ({
                    contractId: `master:${contractId}`,
                    ...masterContractModifier(contractId),
                  }))
                : [],
            chainLength: evolution === "relic-hunter" ? 2 : 1,
          }),
        ]);
      }
      if (event.kind === "contract-declined" || event.kind === "contract-failed") {
        return result([], [set("counters.contractChain", 0), set("values.activeContract", null)]);
      }
      if (event.kind === "contract-completed") {
        const priorChain = evolution === "relic-hunter" ? counter(state, "contractChain") : 0;
        const completedChain = priorChain + 1;
        const guaranteedRelic = evolution === "relic-hunter" && completedChain >= 2;
        const relicChance = currentRank >= 2 ? 0.25 : 0.15;
        const rolledRelic = evolution !== "relic-hunter" && seededFraction(event.seed, 0x52454c49) < relicChance;
        return result(
          [
            command("grant-contract-reward", {
              contractId: stringValue(event, "contractId"),
              tier: evolution === "master-contract" ? "master" : currentRank >= 2 ? "rogue" : "ultra",
              relicChance,
              relicChoice: guaranteedRelic || rolledRelic,
              relicGuaranteedByChain: guaranteedRelic,
            }),
          ],
          [
            set("counters.contractChain", evolution === "relic-hunter" && !guaranteedRelic ? completedChain : 0),
            set("values.activeContract", null),
          ],
        );
      }
      return result();
    }
    case "recruiter-s-eye": {
      if (event.kind !== "wild-encounter-generated" || flag(state, "recruiterUsedThisBiome")) {
        return result();
      }
      const missing = stringArray(event, "missingTraits");
      const rarity = objectValue(event, "traitRarity");
      const ordered = [...missing].sort((a, b) => {
        if (evolution === "ability-hunter") {
          return Number(b.startsWith("ability:")) - Number(a.startsWith("ability:"));
        }
        if (evolution === "completionist") {
          return (Number(rarity[a]) || 0) - (Number(rarity[b]) || 0);
        }
        return a.localeCompare(b);
      });
      return result(
        [
          command("guarantee-collectible-traits", {
            traits: ordered.slice(0, currentRank >= 2 ? 2 : 1),
            revealIvsOnFirstCaptureAttempt: true,
          }),
          ...(evolution === "completionist"
            ? [
                command("set-capture-rate-multiplier", {
                  multiplier: numberValue(event, "completionistCatchMultiplier", 1.15),
                }),
              ]
            : []),
        ],
        [set("flags.recruiterUsedThisBiome", true)],
      );
    }
    case "contraband-slot": {
      if (event.kind !== "item-rule-query" || !booleanValue(event, "isSelectedStack")) {
        return result();
      }
      return result([
        command("override-item-restrictions", {
          itemStackId: stringValue(event, "itemStackId"),
          ignoreCompatibility: true,
          ignoreStackCap: currentRank >= 2,
          suppressible: false,
          effectMultiplier: currentRank >= 2 ? 1.25 : 1,
          extraCap: evolution === "smuggler-king" ? 2 : 0,
          secondStackAllowed: evolution === "black-market-arsenal",
        }),
      ]);
    }
    case "diversity-charter": {
      if (event.kind !== "party-composition-query") {
        return result();
      }
      const count = numberValue(event, "uniqueTypeCount");
      const thresholds = currentRank >= 2 ? [3, 5, 7, 9, 11] : [4, 6, 8, 10, 12];
      const scale = evolution === "cosmopolitan-team" ? 1.5 : 1;
      return result([
        command("apply-party-modifiers", {
          maxHpMultiplier: count >= thresholds[0] ? 1 + 0.05 * scale : 1,
          damageMultiplier: count >= thresholds[1] ? 1 + 0.1 * scale : 1,
          incomingDamageMultiplier: count >= thresholds[2] ? 1 - 0.08 * scale : 1,
          speedMultiplier: count >= thresholds[3] ? 1 + 0.1 * scale : 1,
          firstMovePowerMultiplier:
            count >= thresholds[4] && booleanValue(event, "firstDamagingMove") ? 1 + 0.15 * scale : 1,
          adaptiveBarrierFraction:
            evolution === "adaptive-charter" && count >= 10 && booleanValue(event, "firstSuperEffectiveHit") ? 0.15 : 0,
        }),
      ]);
    }
    case "monotype-oath": {
      if (event.kind !== "party-composition-query") {
        return result();
      }
      const contributors = Math.min(6, numberValue(event, "matchingContributors"));
      const damage = (currentRank >= 2 ? 0.05 : 0.04) * contributors;
      const hp = (currentRank >= 2 ? 0.04 : 0.03) * contributors;
      return result([
        command("apply-monotype-oath", {
          damageMultiplier: booleanValue(event, "moveMatchesType") ? 1 + damage : 1,
          maxHpMultiplier: 1 + hp,
          priorityDelta:
            evolution === "pure-doctrine"
            && booleanValue(event, "allConsciousMatch")
            && booleanValue(event, "firstDamagingMove")
              ? 1
              : 0,
          incomingDamageMultiplier:
            evolution === "protective-oath" && booleanValue(event, "incomingMatchesType")
              ? Math.max(0, 1 - 0.05 * contributors)
              : 1,
        }),
      ]);
    }
    case "underdog-dividend": {
      if (event.kind !== "pokemon-stat-query") {
        return result();
      }
      const gap = numberValue(event, "levelGap");
      const eligible = gap >= 5;
      const unevolved = booleanValue(event, "fullyEvolved") ? 1 : 1.25;
      const cap = currentRank >= 2 ? 0.3 : 0.2;
      let statBonus = eligible ? Math.min(cap, gap * 0.02) * unevolved : 0;
      if (evolution === "giant-killer" && booleanValue(event, "enemyAboveLevel")) {
        statBonus *= 2;
      }
      if (evolution === "graduate" && booleanValue(event, "caughtUp")) {
        statBonus = Math.max(statBonus, 0.05);
      }
      return result(
        [
          command("apply-pokemon-growth", {
            nonHpStatMultiplier: 1 + statBonus,
            experienceMultiplier: eligible ? 1 + (currentRank >= 2 ? 0.75 : 0.5) * unevolved : 1,
          }),
        ],
        evolution === "graduate" && booleanValue(event, "caughtUp") ? [set("flags.graduated", true)] : [],
      );
    }
    case "growth-ring": {
      if (event.kind === "pokemon-evolved" && evolution === "evergrowth") {
        return result([command("reassign-growth-ring")], [set("flags.evergrowthRetained", true)]);
      }
      if (event.kind !== "pokemon-stat-query") {
        return result();
      }
      const evolved = booleanValue(event, "fullyEvolved");
      const bonus =
        evolution === "refusal-to-grow" && !evolved
          ? 0.4
          : evolved
            ? evolution === "evergrowth" && flag(state, "evergrowthRetained")
              ? 0.1
              : 0
            : currentRank >= 2
              ? 0.3
              : 0.2;
      return result([
        command("apply-all-stat-multiplier", {
          multiplier: 1 + bonus,
          movePowerMultiplier: evolution === "refusal-to-grow" && !evolved ? 1.1 : 1,
        }),
      ]);
    }
    case "flawless-ledger": {
      if (event.kind === "wave-completed") {
        const flawless = numberValue(event, "alliedFaintCount") === 0;
        const marks = counter(state, "ledgerMarks");
        const progress = counter(state, "ledgerProgress");
        const required = Math.floor(marks / 2) + 2;
        if (!flawless) {
          if (currentRank >= 2 && booleanValue(event, "biomeFailureShieldAvailable")) {
            return result([], [set("flags.ledgerFailureShieldUsed", true)]);
          }
          return result([], [set("counters.ledgerProgress", 0)]);
        }
        const next = progress + 1;
        return next >= required
          ? result(
              [command("ledger-mark-earned", { mark: marks + 1 })],
              [set("counters.ledgerProgress", 0), increment("counters.ledgerMarks", 1)],
            )
          : result([], [increment("counters.ledgerProgress", 1)]);
      }
      if (event.kind === "reward-generated") {
        const slots = Math.max(1, numberValue(event, "slotCount"));
        const uplifts = Math.floor(counter(state, "ledgerMarks") / 2);
        const offsets = Array.from({ length: slots }, (_, index) => Math.floor((uplifts + slots - 1 - index) / slots));
        return result([
          command("apply-pre-luck-rarity-uplifts", {
            offsets,
            playerChoosesSlots: evolution === "exact-accounting",
            quantityUplifts: evolution === "compound-ledger" ? Math.floor(uplifts / 3) : 0,
          }),
        ]);
      }
      return result();
    }
    case "hunter-s-mark": {
      if (event.kind === "hunter-choice-resolved") {
        return result([], [increment(`counters.${stringValue(event, "choice")}`, numberValue(event, "amount"))]);
      }
      if (event.kind !== "typed-enemy-defeated" || !booleanValue(event, "matchesMarkedType")) {
        return result();
      }
      const bossSegments = Math.max(0, numberValue(event, "bossSegments"));
      const gain = evolution === "apex-hunter" && bossSegments > 0 ? bossSegments * 3 : 1;
      const threshold = currentRank >= 2 ? 8 : 10;
      const total = counter(state, "hunterProgress") + gain;
      return result(
        total >= threshold
          ? [
              command("queue-post-battle-hunter-choice", {
                choices: ["damageBonus", "resistanceBonus", "captureBonus"],
                broadMultiplier: evolution === "broad-hunt" ? 0.75 : 1,
              }),
            ]
          : [],
        [set("counters.hunterProgress", total % threshold)],
      );
    }
    case "pair-bond": {
      if (event.kind === "pair-query" && booleanValue(event, "bothConscious")) {
        return result([command("apply-pair-damage", { multiplier: currentRank >= 2 ? 1.15 : 1.1 })]);
      }
      if (event.kind === "direct-pair-switch") {
        return result([
          command("heal-incoming-partner", { maxHpFraction: currentRank >= 2 ? 0.12 : 0.08 }),
          ...(evolution === "soulmates" ? [command("transfer-random-positive-stage")] : []),
        ]);
      }
      if (event.kind === "pair-member-fainted") {
        return result([
          command("boost-pair-survivor", {
            pokemonId: stringValue(event, "survivorPokemonId"),
            allStats: evolution === "avenger-bond" ? 1 : 0,
            highestOffense: evolution === "avenger-bond" ? 0 : 1,
            turns: 2,
          }),
          ...(evolution === "avenger-bond"
            ? [
                command("borrow-eligible-move", {
                  moveId: choose(event.seed, stringArray(event, "eligibleMoveIds")) ?? null,
                }),
              ]
            : []),
        ]);
      }
      return result();
    }
    case "bench-academy": {
      if (event.kind === "academy-graduated") {
        return result(
          [
            command("increase-team-max-hp", { fraction: counter(state, "graduations") < 10 ? 0.01 : 0 }),
            ...(evolution === "elite-academy" ? [command("offer-partial-vitamin-transfer")] : []),
          ],
          [set("counters.graduations", Math.min(10, counter(state, "graduations") + 1))],
        );
      }
      if (event.kind !== "experience-query" || numberValue(event, "levelGap") < 5) {
        return result();
      }
      const multiplier = currentRank >= 2 ? 2.5 : 2;
      return result([
        command("apply-experience-multiplier", {
          multiplier: booleanValue(event, "isLowest")
            ? multiplier
            : evolution === "peer-tutoring" && booleanValue(event, "isSecondLowest")
              ? 1 + (multiplier - 1) / 2
              : 1,
        }),
      ]);
    }
    case "bossbreaker": {
      if (event.kind !== "boss-segment-broken") {
        return result();
      }
      const broken = counter(state, "segmentsBroken") + 1;
      return result(
        [
          command("heal-pokemon", { maxHpFraction: currentRank >= 2 ? 0.25 : 0.15 }),
          command("grant-temporary-damage", { multiplier: currentRank >= 2 ? 1.3 : 1.2, turns: 2 }),
          ...(evolution === "segment-eater" ? [command("restore-total-pp", { amount: 3 })] : []),
        ],
        [
          increment("counters.segmentsBroken", 1),
          ...(evolution === "veteran-breaker" && broken % 3 === 0 && counter(state, "veteranStacks") < 5
            ? ([increment("counters.veteranStacks", 1)] as const)
            : []),
        ],
      );
    }
    case "legacy-slot": {
      if (event.kind !== "pokemon-permanently-removed") {
        return result();
      }
      if (numberValue(event, "partySlot", -1) !== numberValue(event, "boundPartySlot", -2)) {
        return result();
      }
      const eligible = stringArray(event, "eligibleImprints");
      const capacity = evolution === "dynasty" ? 2 : 1;
      return result(
        [
          command("choose-progression-imprints", {
            eligibleImprints: eligible,
            capacity,
            transferFraction: evolution === "perfect-succession" ? 1 : currentRank >= 2 ? 0.75 : 0.5,
          }),
        ],
        [set("values.pendingLegacyImprints", eligible.slice(0, capacity))],
      );
    }
    case "time-loop": {
      if (event.kind !== "lethal-result-preview") {
        return result();
      }
      const allowedBattle = booleanValue(event, "isBossBattle") || evolution === "second-timeline";
      if (!allowedBattle || counter(state, "segmentUses") > 0) {
        return result();
      }
      return result(
        [
          command(currentRank >= 2 ? "offer-turn-rewind" : "rewind-turn", {
            turnSnapshotId: stringValue(event, "turnSnapshotId"),
            revealEnemyActions: evolution === "deja-vu",
            enemyActionIds: event.data.enemyActionIds ?? [],
          }),
        ],
        [increment("counters.segmentUses", 1)],
      );
    }
    case "recapitulation": {
      if (event.kind !== "allied-damaging-action") {
        return result();
      }
      const history = Array.isArray(state.values?.actionHistory)
        ? (state.values!.actionHistory as readonly MoodyRuntimeValue[])
        : [];
      const next = [...history, event.data.action ?? null].slice(-3);
      const interval = evolution === "extended-history" ? 4 : 3;
      const count = counter(state, "damagingActions") + 1;
      const replay = count % interval === 0;
      return result(
        replay
          ? [
              command("replay-spectral-actions", {
                actions: next.slice(0, evolution === "extended-history" ? 3 : 2),
                power: evolution === "extended-history" ? 0.3 : currentRank >= 2 ? 0.4 : 0.33,
                echoCurrentPower: evolution === "grand-recap" ? 0.2 : 0,
                secondaryEffects: false,
                consumesPp: false,
              }),
            ]
          : [],
        [increment("counters.damagingActions", 1), set("values.actionHistory", next)],
      );
    }
    case "pocket-turn": {
      const threshold = currentRank >= 2 ? 2 : 3;
      const max = evolution === "stored-tempo" ? threshold * 2 : threshold;
      if (event.kind === "move-failed") {
        return result([], [set("counters.tempo", Math.min(max, counter(state, "tempo") + 1))]);
      }
      if (event.kind === "allied-move-committed" && counter(state, "tempo") >= threshold) {
        return result(
          [
            command("empower-pocket-turn", {
              actionId: stringValue(event, "actionId"),
              priorityDelta: 1,
              echoPower: 0.5,
              targetPriorityDelta: evolution === "time-theft" ? -1 : 0,
            }),
          ],
          [increment("counters.tempo", -threshold)],
        );
      }
      return result();
    }
    case "ability-carousel": {
      if (
        event.kind !== "battle-start"
        && !(
          event.kind === "adjacent-direct-switch"
          && evolution === "fast-carousel"
          && !flag(state, "fastCarouselUsed")
        )
      ) {
        return result();
      }
      const compatible = objectValue(event, "compatibleAbilityIdsByPokemon");
      const assignments = Object.entries(compatible).map(([pokemonId, ids], index) => ({
        pokemonId,
        abilityId:
          choose(
            event.seed,
            Array.isArray(ids) ? ids.filter((abilityId): abilityId is string => typeof abilityId === "string") : [],
            index,
          ) ?? null,
      }));
      return result(
        [
          command("grant-temporary-abilities", {
            assignments,
            durationTurns: currentRank >= 2 ? 2 : 1,
            adjacentChoice: evolution === "grand-carousel" ? "weighted-either" : "next-occupied",
          }),
        ],
        event.kind === "adjacent-direct-switch" ? [set("flags.fastCarouselUsed", true)] : [],
      );
    }
    case "mirror-theft": {
      if (event.kind !== "enemy-effect-created") {
        return result();
      }
      const key =
        evolution === "hall-of-mirrors" ? `mirrorUses:${stringValue(event, "targetPokemonId")}` : "mirrorUses";
      if (counter(state, key) >= (currentRank >= 2 ? 2 : 1)) {
        return result();
      }
      return result(
        [
          command("copy-enemy-created-effect", {
            effectKind: stringValue(event, "effectKind"),
            effectData: event.data.effectData ?? null,
            removeFromEnemy: evolution === "perfect-theft",
          }),
        ],
        [increment(`counters.${key}`, 1)],
      );
    }
    case "phase-shift": {
      const interval = currentRank >= 2 ? 4 : 5;
      const ethereal = numberValue(event, "turn") > 0 && numberValue(event, "turn") % interval === 0;
      if (event.kind === "turn-start") {
        return result(
          [
            command("set-ethereal-turn", {
              active: ethereal,
              outgoingDamageMultiplier: evolution === "ghost-turn" && ethereal ? 1.25 : 1,
            }),
          ],
          ethereal && evolution === "stable-phase" ? [set("flags.stablePhasePendingHit", true)] : [],
        );
      }
      if (event.kind === "direct-hit-preview" && (ethereal || flag(state, "stablePhasePendingHit"))) {
        return result(
          [command("modify-direct-damage", { multiplier: 0.1 })],
          evolution === "stable-phase" ? [set("flags.stablePhasePendingHit", false)] : [],
        );
      }
      return result();
    }
    case "apex-plunder": {
      const pokemonId = stringValue(event, "pokemonId");
      if (event.kind === "segmented-boss-defeated") {
        const existing = Array.isArray(state.values?.apexSegments)
          ? state.values.apexSegments.filter((value): value is number => typeof value === "number" && value > 0)
          : [];
        const capacity = evolution === "segment-hoard" ? 2 : 1;
        if (existing.length >= capacity) {
          return result();
        }
        const fraction = evolution === "segment-hoard" ? 0.25 : currentRank >= 2 ? 0.5 : 0.25;
        const stored = [...existing, fraction].slice(0, capacity);
        return result(
          [
            command("store-apex-segment", {
              pokemonId,
              segments: stored.length,
              hpFractions: stored,
            }),
          ],
          [set("values.apexSegments", stored)],
        );
      }
      if (
        event.kind === "lethal-result-preview"
        && Array.isArray(state.values?.apexSegments)
        && state.values!.apexSegments.length > 0
      ) {
        return result(
          [command("consume-apex-segment", { pokemonId, healFraction: state.values!.apexSegments[0] })],
          [set("values.apexSegments", state.values!.apexSegments.slice(1))],
        );
      }
      if (event.kind === "biome-transition" && evolution === "apex-heart") {
        return result([], [set("values.apexSegments", [0.25])]);
      }
      return result();
    }
    case "inversion-window": {
      if (event.kind !== "type-effectiveness-query") {
        return result();
      }
      const direction = stringValue(event, "direction");
      const effectiveness = numberValue(event, "effectiveness", 1);
      const perPokemon = evolution === "inversion-doctrine" ? `:${stringValue(event, "pokemonId")}` : "";
      const key = direction === "outgoing" ? `offensiveInversions${perPokemon}` : `defensiveInversions${perPokemon}`;
      const limit = currentRank >= 2 ? 2 : 1;
      const offensive =
        direction === "outgoing" && (effectiveness < 1 || (effectiveness === 0 && evolution === "reverse-polarity"));
      const defensive = direction === "incoming" && effectiveness > 1;
      if ((!offensive && !defensive) || counter(state, key) >= limit) {
        return result();
      }
      return result(
        [
          command("override-type-effectiveness", {
            effectiveness: effectiveness === 0 ? 1 : direction === "outgoing" ? 2 : 0.5,
            weakerDoctrine: evolution === "inversion-doctrine",
          }),
        ],
        [increment(`counters.${key}`, 1)],
      );
    }
    case "borrowed-future": {
      if (event.kind !== "prebattle-commit") {
        return result();
      }
      const actions = Array.isArray(event.data.committedActions) ? event.data.committedActions : [];
      return result(
        [
          command("lock-enemy-opening-actions", {
            enemyRoster: event.data.enemyRoster ?? [],
            enemyLead: event.data.enemyLead ?? null,
            committedActions: evolution === "parallel-futures" ? actions : actions.slice(0, 1),
            revealLeadDetails: currentRank >= 2 ? (event.data.visibleLeadData ?? null) : null,
            allowPartyReorder: true,
            allowOneLoadoutChange: evolution === "contingency-plan",
          }),
        ],
        [set("values.borrowedFutureCommit", actions)],
      );
    }
    case "pressure-valve": {
      if (event.kind !== "positive-stat-overflow") {
        return result();
      }
      const overflow = Math.max(0, numberValue(event, "overflowStages"));
      const priorOverflow = counter(state, "overflowStages");
      const totalOverflow = priorOverflow + overflow;
      const overpressureCharges = Math.floor(totalOverflow / 3);
      const overflowRemainder = totalOverflow % 3;
      const selected =
        evolution === "multi-valve" ? stringValue(event, "mostUsefulValve") : stringValue(event, "selectedValve");
      const amount =
        selected === "barrier"
          ? overflow * (currentRank >= 2 ? 0.12 : 0.08)
          : selected === "healing"
            ? overflow * (currentRank >= 2 ? 0.1 : 0.06)
            : overflow * (currentRank >= 2 ? 2 : 1);
      return result(
        [
          command("convert-stat-overflow", { pokemonId: stringValue(event, "pokemonId"), valve: selected, amount }),
          ...(evolution === "overpressure" && overpressureCharges > 0
            ? [command("queue-next-move-power", { multiplier: 1.5, charges: overpressureCharges })]
            : []),
        ],
        [set("counters.overflowStages", overflowRemainder)],
      );
    }
    case "negative-space": {
      if (event.kind !== "move-selection-query") {
        return result();
      }
      const sealed = stringArray(event, "sealedMoveIds");
      const moveId = stringValue(event, "moveId");
      const maxSeals = evolution === "void-specialist" ? 3 : currentRank >= 2 ? 2 : 1;
      const activeSeals = sealed.slice(0, maxSeals);
      const perSealDamage = evolution === "void-specialist" ? 0.12 : 0.1;
      const perSealReduction = evolution === "void-specialist" ? 0.08 : 0.06;
      return result([
        command("apply-negative-space", {
          selectable: !activeSeals.includes(moveId),
          damageMultiplier: 1 + activeSeals.length * perSealDamage,
          incomingDamageMultiplier: 1 - activeSeals.length * perSealReduction,
          priorityDelta: evolution === "open-form" && booleanValue(event, "isFirstUsableMove") ? 1 : 0,
          firstMovePowerMultiplier: evolution === "open-form" && booleanValue(event, "isFirstUsableMove") ? 1.25 : 1,
        }),
      ]);
    }
    default:
      return result();
  }
}

function resolveCurse(effectId: string, event: MoodyRuntimeEvent, state: MoodyRuntimeState): MoodyRuntimeResult {
  switch (effectId) {
    case "frayed-supplies":
      return event.kind === "direct-healing-query"
        ? result([
            command("modify-direct-healing", {
              amount: Math.floor(numberValue(event, "amount") * 0.75),
              barriersAndRevivalUnaffected: true,
            }),
          ])
        : result();
    case "thin-wallet":
      return event.kind === "market-price-query"
        ? result([command("set-market-price", { price: Math.ceil(numberValue(event, "price") * 1.3) })])
        : result();
    case "jealous-relics":
      return event.kind === "item-effect-query"
        ? result([
            command("set-item-effect-value", {
              value:
                numberValue(event, "copyIndex") <= 1
                  ? numberValue(event, "effectValue")
                  : numberValue(event, "effectValue") * numberValue(event, "duplicateScale"),
            }),
          ])
        : result();
    case "no-takebacks":
      return event.kind === "reward-replacement-query"
        ? result([
            command("set-reward-replacement-cost", {
              disabled: stringValue(event, "operation") === "reroll",
              cost: numberValue(event, "baseCost") * 2,
              sacrifices: numberValue(event, "baseSacrifices") + 1,
            }),
          ])
        : result();
    case "mortal-wounds": {
      if (event.kind === "biome-transition") {
        return result([], [set("values.mortallyWoundedPokemonIds", [])]);
      }
      return event.kind === "revive-query"
        ? result(
            [
              command("set-revive-allowed", {
                pokemonId: stringValue(event, "pokemonId"),
                allowed: false,
                until: "next-biome-transition",
              }),
            ],
            [set("flags.reviveBlocked", true)],
          )
        : result();
    }
    case "cursed-inventory": {
      if (event.kind === "biome-transition") {
        const ranking = stringArray(event, "usageRanking");
        const stacks = objectValue(event, "eligibleStacksByPokemon");
        const pokemonId = ranking.find(candidate => Array.isArray(stacks[candidate]) && stacks[candidate].length > 0);
        const eligible =
          pokemonId == null
            ? []
            : (stacks[pokemonId] as readonly MoodyRuntimeValue[]).filter(
                (stackId): stackId is string => typeof stackId === "string",
              );
        const itemStackId = choose(event.seed, eligible);
        return result(
          itemStackId == null ? [] : [command("reveal-cursed-stack", { pokemonId: pokemonId!, itemStackId })],
          [
            set("values.cursedInventoryPokemonId", pokemonId ?? null),
            set("values.cursedInventoryStackId", itemStackId ?? null),
          ],
        );
      }
      const disabled =
        event.kind === "item-effect-query"
        && booleanValue(event, "isActive")
        && String(state.values?.cursedInventoryPokemonId ?? "") === stringValue(event, "pokemonId")
        && String(state.values?.cursedInventoryStackId ?? "") === stringValue(event, "itemStackId");
      return disabled
        ? result([command("disable-entire-item-stack", { itemStackId: stringValue(event, "itemStackId") })])
        : result();
    }
    case "elite-pursuit": {
      const wave = numberValue(event, "waveIndex");
      return event.kind === "wave-encounter-query" && !booleanValue(event, "isBossWave") && wave > 0 && wave % 5 === 0
        ? result([command("replace-with-boss-trainer-equivalent", { enhancedBossReward: false })])
        : result();
    }
    case "hollow-victory": {
      if (event.kind === "battle-completed") {
        return result(
          [],
          [
            set(
              "counters.hollowPenalty",
              Math.max(0, counter(state, "hollowPenalty") + (numberValue(event, "alliedFaintCount") > 0 ? 1 : -1)),
            ),
          ],
        );
      }
      return event.kind === "reward-generated" && counter(state, "hollowPenalty") > 0
        ? result([command("apply-pre-luck-rarity-penalty", { tiers: 1 })], [increment("counters.hollowPenalty", -1)])
        : result();
    }
    case "the-long-night": {
      if (event.kind === "biome-heal-query") {
        return result([command("disable-automatic-biome-healing")]);
      }
      return event.kind === "market-price-query" && booleanValue(event, "isHealingItem")
        ? result([command("set-market-price", { price: Math.ceil(numberValue(event, "price") * 2) })])
        : result();
    }
    case "public-enemy": {
      if (event.kind === "trainer-roster-generated" && booleanValue(event, "isEligibleTrainer")) {
        return result(
          [
            command("set-trainer-roster-size", {
              size: Math.min(numberValue(event, "maxRosterSize", 8), 7 + (event.seed & 1)),
              secondAct: booleanValue(event, "isBossTrainer"),
            }),
          ],
          booleanValue(event, "isBossTrainer") ? [set("flags.secondActAvailable", true)] : [],
        );
      }
      if (event.kind === "boss-final-pokemon-fainted" && flag(state, "secondActAvailable")) {
        return result(
          [
            command("revive-with-second-act", {
              pokemonId: stringValue(event, "pokemonId"),
              hpFraction: 1,
              extraHealthSegments: 1,
              allStatStages: 1,
            }),
          ],
          [set("flags.secondActAvailable", false)],
        );
      }
      return result();
    }
    case "mood-swing": {
      if (event.kind !== "ten-wave-boundary") {
        return result();
      }
      const ids = stringArray(event, "activeBoonInstanceIds");
      const count = numberValue(event, "waveIndex") >= 100 ? Math.min(2, ids.length) : Math.min(1, ids.length);
      const selected: string[] = [];
      for (let index = 0; index < count; index++) {
        const selectedId = choose(
          event.seed,
          ids.filter(candidate => !selected.includes(candidate)),
          index,
        );
        if (selectedId != null) {
          selected.push(selectedId);
        }
      }
      return result(
        [
          command("set-dormant-boons", {
            instanceIds: selected,
            preserveProgress: true,
            until: "next-ten-wave-boundary",
          }),
        ],
        [set("values.dormantBoonInstanceIds", selected)],
      );
    }
    case "nemesis-protocol":
      return event.kind === "enemy-boon-generation"
        ? result([
            command("set-counter-weight", {
              value: numberValue(event, "baseCounterWeight") * (booleanValue(event, "isBoss") ? 2 : 1.5),
              targetPokemonId: stringValue(event, "topThreatPokemonId"),
              persistentEnemyOwnership: false,
            }),
          ])
        : result();
    case "blood-moon":
      return event.kind === "boss-roster-defeated" && !flag(state, "bloodMoonUsed")
        ? result(
            [
              command("revive-boss-roster", {
                pokemonIds: event.data.pokemonIds ?? [],
                hpFraction: 0.25,
                clearNegativeStages: true,
                clearMajorStatuses: true,
                restoreConsumedItems: false,
              }),
            ],
            [set("flags.bloodMoonUsed", true)],
          )
        : result();
    case "reverse-snowball": {
      if (event.kind !== "battle-completed") {
        return result();
      }
      const reset = numberValue(event, "alliedFaintCount") > numberValue(event, "partySize") / 2;
      const streak = reset
        ? 0
        : numberValue(event, "alliedFaintCount") === 0
          ? counter(state, "flawlessWinStreak") + 1
          : counter(state, "flawlessWinStreak");
      return result(
        [
          command("set-future-enemy-stat-multiplier", {
            multiplier: 1 + Math.min(numberValue(event, "safetyCap", 0.3), streak * 0.03),
          }),
        ],
        [set("counters.flawlessWinStreak", streak)],
      );
    }
    case "cursed-draft": {
      if (event.kind !== "boon-draft-generated") {
        return result();
      }
      const offer = choose(event.seed, stringArray(event, "offerIds"));
      return result(
        offer == null
          ? []
          : [
              command("hide-beneficial-boon-offer", {
                offerId: offer,
                hideIdentity: true,
                hideRarity: true,
                hideScope: true,
                hideTargetType: true,
              }),
            ],
        [set("values.hiddenOfferId", offer ?? null)],
      );
    }
    case "entropy": {
      if (event.kind !== "biome-transition") {
        return result();
      }
      const partyMoves = objectValue(event, "partyMoves");
      const replacements = objectValue(event, "eligibleReplacementsByMove");
      const assignments = Object.entries(partyMoves).flatMap(([pokemonId, moves], pokemonIndex) =>
        (Array.isArray(moves) ? moves : []).slice(0, 1).map((moveId, moveIndex) => ({
          pokemonId,
          originalMoveId: moveId,
          replacementMoveId:
            choose(
              event.seed,
              Array.isArray(replacements[String(moveId)])
                ? (replacements[String(moveId)] as readonly MoodyRuntimeValue[]).filter(
                    (replacementId): replacementId is string => typeof replacementId === "string",
                  )
                : [],
              pokemonIndex * 8 + moveIndex,
            ) ?? null,
        })),
      );
      return result(
        [
          command("replace-party-moves-until-next-biome", {
            assignments,
            preserveDamagingMove: true,
            excludeStructuralMoves: true,
          }),
        ],
        [set("values.entropyAssignments", assignments)],
      );
    }
    case "feedback-loop": {
      if (event.kind !== "action-boons-resolved") {
        return result();
      }
      const count = stringArray(event, "triggeredBoonIds").length;
      const fraction = count <= 1 ? 0 : 0.04 + (count >= 3 ? 0.06 : 0) + Math.max(0, count - 3) * 0.08;
      const damage = Math.min(
        Math.floor(numberValue(event, "maxHp") * fraction),
        Math.max(0, numberValue(event, "currentHp") - 1),
      );
      return result(
        damage > 0
          ? [
              command("deal-nonlethal-feedback-damage", {
                pokemonId: stringValue(event, "pokemonId"),
                damage,
                triggeredBoonCount: count,
              }),
            ]
          : [],
        [set("counters.lastFeedbackTriggerCount", count), set("counters.lastFeedbackDamage", damage)],
      );
    }
    default:
      return result();
  }
}

export function resolveMoodyRuntimeEffect(
  effectId: string,
  stage: MoodyRuntimeStage,
  event: MoodyRuntimeEvent,
  state: MoodyRuntimeState = {},
): MoodyRuntimeResult {
  const meta = MOODY_RUNTIME_EFFECT_BY_ID.get(effectId);
  if (meta == null) {
    throw new Error(`Unknown Moody runtime effect: ${effectId}`);
  }
  if (meta.status === "blocked") {
    return result([command("effect-blocked", { effectId, reason: "authored-item-sets-required" })]);
  }
  const contract = meta.events.find(candidate => candidate.kind === event.kind);
  if (contract == null) {
    return result();
  }
  const missing = contract.requiredInputs.filter(key => !(key in event.data));
  if (missing.length > 0) {
    throw new Error(`${effectId}:${event.kind} missing inputs: ${missing.join(", ")}`);
  }
  return meta.source === "boon" ? resolveBoon(effectId, stage, event, state) : resolveCurse(effectId, event, state);
}

export function applyMoodyRuntimeStateDeltas(
  state: MoodyRuntimeState,
  deltas: readonly MoodyRuntimeStateDelta[],
): MoodyRuntimeState {
  const next = {
    counters: { ...state.counters },
    flags: { ...state.flags },
    values: { ...state.values },
  };
  for (const delta of deltas) {
    const [section, key] = delta.path.split(".") as ["counters" | "flags" | "values", string];
    if (delta.op === "delete") {
      delete next[section][key];
    } else if (delta.op === "increment") {
      (next.counters as Record<string, number>)[key] = (next.counters[key] ?? 0) + Number(delta.value ?? 0);
    } else {
      (next[section] as Record<string, MoodyRuntimeValue>)[key] = delta.value ?? null;
    }
  }
  return next;
}
