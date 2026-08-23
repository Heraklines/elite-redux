import { MOODY_BOONS, MOODY_CURSES } from "#data/elite-redux/moody/moody-catalog.generated";
import type { MoodyBoonInstance, MoodyCurseInstance } from "#data/elite-redux/moody/moody-types";

export const MOODY_RUNTIME_FIELD_BOON_IDS = [
  "prismatic-opening",
  "elemental-dividend",
  "chromatic-relay",
  "microclimate",
  "eye-of-the-storm",
  "climate-contrarian",
  "terrain-weaver",
  "four-seasons",
  "battlefield-memory",
  "weather-wake",
  "adrenal-condition",
  "burning-resolve",
  "toxic-bloom",
  "insomniac-dreams",
  "frostbound-time",
  "shared-antibodies",
  "status-bank",
  "misery-loves-company",
  "volatile-memory",
  "purge-pulse",
  "aftercare",
  "overflow-ward",
  "shared-cup",
  "damage-ceiling",
  "layered-armor",
  "emergency-shell",
  "guarded-setup",
  "rest-cycle",
  "last-rites",
  "no-one-left-behind",
  "phoenix-clause",
  "dead-man-s-action",
  "glass-memory",
  "deferred-pain",
] as const;

export const MOODY_RUNTIME_FIELD_CURSE_IDS = [
  "restless-lead",
  "type-tax",
  "slow-to-warm",
  "fading-momentum",
  "exposed-flank",
  "accumulated-fatigue",
  "shared-pain",
  "no-retreat",
  "fog-of-war",
  "withering-pp",
  "brittle-weakness",
  "oathbound",
  "sweeper-s-tax",
  "public-enemy",
  "mood-swing",
  "nemesis-protocol",
  "blood-moon",
  "reverse-snowball",
  "cursed-draft",
  "entropy",
  "feedback-loop",
] as const;

export type MoodyRuntimeFieldBoonId = (typeof MOODY_RUNTIME_FIELD_BOON_IDS)[number];
export type MoodyRuntimeFieldCurseId = (typeof MOODY_RUNTIME_FIELD_CURSE_IDS)[number];
export type MoodyRuntimeSide = "player" | "enemy";
export type MoodyRuntimeStatus = "burn" | "poison" | "toxic" | "paralysis" | "sleep" | "frostbite";
export type MoodyRuntimeWeather = "clear" | "sun" | "rain" | "sand" | "snow" | "fog";
export type MoodyRuntimeTerrain = "none" | "electric" | "grassy" | "misty" | "psychic";
export type MoodyRuntimeMoveCategory = "physical" | "special" | "status";

type Scalar = string | number | boolean;

export interface MoodyRuntimeFieldState {
  readonly numbers: Readonly<Record<string, number>>;
  readonly values: Readonly<Record<string, Scalar>>;
  readonly lists: Readonly<Record<string, readonly string[]>>;
}

export type MoodyRuntimeStateDelta =
  | { readonly op: "set-number"; readonly key: string; readonly value: number }
  | { readonly op: "set-value"; readonly key: string; readonly value: Scalar }
  | {
      readonly op: "set-list";
      readonly key: string;
      readonly value: readonly string[];
    }
  | { readonly op: "delete"; readonly key: string };

export interface MoodyRuntimePokemonSnapshot {
  readonly id: number;
  readonly side: MoodyRuntimeSide;
  readonly partySlot: number;
  readonly currentHp: number;
  readonly maxHp: number;
  readonly fainted?: boolean;
  readonly status?: MoodyRuntimeStatus;
  readonly grounded?: boolean;
  readonly moveCount?: number;
  readonly moveIds?: readonly string[];
  readonly eligibleMoveIds?: readonly string[];
  readonly compatibleAbilityIds?: readonly string[];
  readonly types?: readonly string[];
}

interface EventBase {
  readonly battleId: string;
  readonly waveIndex: number;
  readonly turn: number;
  readonly seed: number;
}

export type MoodyRuntimeFieldEvent =
  | (EventBase & {
      readonly kind: "battle-start";
      readonly isBoss: boolean;
      readonly isTrainer: boolean;
      readonly activePokemonId: number;
      readonly party: readonly MoodyRuntimePokemonSnapshot[];
      readonly carriedField?: readonly MoodyRuntimeFieldSnapshot[];
    })
  | (EventBase & {
      readonly kind: "battle-end";
      readonly won: boolean;
      readonly party: readonly MoodyRuntimePokemonSnapshot[];
      readonly enteredPokemonIds: readonly number[];
      readonly field?: readonly MoodyRuntimeFieldSnapshot[];
    })
  | (EventBase & {
      readonly kind: "entry";
      readonly pokemon: MoodyRuntimePokemonSnapshot;
      readonly activePokemonIds: readonly number[];
      readonly isReentry: boolean;
      readonly afterAllyFaint?: boolean;
      readonly weatherOptions?: readonly MoodyRuntimeWeather[];
      readonly terrainOptions?: readonly MoodyRuntimeTerrain[];
    })
  | (EventBase & {
      readonly kind: "before-move";
      readonly user: MoodyRuntimePokemonSnapshot;
      readonly target?: MoodyRuntimePokemonSnapshot;
      readonly moveId: string;
      readonly moveType: string;
      readonly category: MoodyRuntimeMoveCategory;
      readonly damaging: boolean;
      readonly raisesStats?: boolean;
      readonly asleep?: boolean;
      readonly dreamTagged?: boolean;
      readonly weatherWeakens?: boolean;
      readonly legalBestType?: string;
      readonly weaknessMultiplier?: number;
      readonly actionId: string;
    })
  | (EventBase & {
      readonly kind: "move-resolved";
      readonly user: MoodyRuntimePokemonSnapshot;
      readonly target?: MoodyRuntimePokemonSnapshot;
      readonly moveId: string;
      readonly moveType: string;
      readonly category: MoodyRuntimeMoveCategory;
      readonly damaging: boolean;
      readonly landed: boolean;
      readonly dealtDirectDamage: boolean;
      readonly weaknessMultiplier?: number;
      readonly actionId: string;
    })
  | (EventBase & {
      readonly kind: "before-damage";
      readonly source?: MoodyRuntimePokemonSnapshot;
      readonly target: MoodyRuntimePokemonSnapshot;
      readonly amount: number;
      readonly direct: boolean;
      readonly category?: Exclude<MoodyRuntimeMoveCategory, "status">;
      readonly superEffective?: boolean;
      readonly poisonDamage?: boolean;
      readonly hitIndex?: number;
      readonly sameOriginatingAction?: boolean;
    })
  | (EventBase & {
      readonly kind: "after-damage";
      readonly source?: MoodyRuntimePokemonSnapshot;
      readonly target: MoodyRuntimePokemonSnapshot;
      readonly direct: boolean;
      readonly amount: number;
      readonly barrierAbsorbed: number;
      readonly hpAfter: number;
      readonly crossedQuarterHp?: boolean;
    })
  | (EventBase & {
      readonly kind: "heal";
      readonly target: MoodyRuntimePokemonSnapshot;
      readonly amount: number;
      readonly effectiveAmount: number;
      readonly benchedAllies: readonly MoodyRuntimePokemonSnapshot[];
    })
  | (EventBase & {
      readonly kind: "status-attempt";
      readonly source?: MoodyRuntimePokemonSnapshot;
      readonly target: MoodyRuntimePokemonSnapshot;
      readonly status: MoodyRuntimeStatus;
      readonly legalOnSource?: boolean;
    })
  | (EventBase & {
      readonly kind: "status-applied";
      readonly target: MoodyRuntimePokemonSnapshot;
      readonly status: MoodyRuntimeStatus;
    })
  | (EventBase & {
      readonly kind: "status-cured";
      readonly target: MoodyRuntimePokemonSnapshot;
      readonly status: MoodyRuntimeStatus;
      readonly adjacentAllies?: readonly MoodyRuntimePokemonSnapshot[];
    })
  | (EventBase & {
      readonly kind: "volatile-attempt";
      readonly target: MoodyRuntimePokemonSnapshot;
      readonly volatile: string;
    })
  | (EventBase & {
      readonly kind: "volatile-applied";
      readonly target: MoodyRuntimePokemonSnapshot;
      readonly volatile: string;
    })
  | (EventBase & {
      readonly kind: "weather-transition";
      readonly previous: MoodyRuntimeWeather;
      readonly next: MoodyRuntimeWeather;
      readonly naturalOrReplacement: boolean;
      readonly activePokemon: MoodyRuntimePokemonSnapshot;
      readonly lowestHpBenchedAlly?: MoodyRuntimePokemonSnapshot;
    })
  | (EventBase & {
      readonly kind: "barrier-ended";
      readonly target: MoodyRuntimePokemonSnapshot;
      readonly broke: boolean;
      readonly barrierTag?: string;
    })
  | (EventBase & {
      readonly kind: "turn-start";
      readonly activePokemonIds: readonly number[];
    })
  | (EventBase & {
      readonly kind: "turn-end";
      readonly activePokemonIds: readonly number[];
    })
  | (EventBase & {
      readonly kind: "action-resolved";
      readonly actor: MoodyRuntimePokemonSnapshot;
      readonly target?: MoodyRuntimePokemonSnapshot;
      readonly actionId: string;
      readonly boonTriggerCount: number;
      readonly removableNegativeCount: number;
    })
  | (EventBase & {
      readonly kind: "faint";
      readonly isBoss?: boolean;
      readonly pokemon: MoodyRuntimePokemonSnapshot;
      readonly committedMove?: {
        readonly moveId: string;
        readonly category: MoodyRuntimeMoveCategory;
        readonly eligible: boolean;
      };
      readonly otherConsciousAllies: readonly MoodyRuntimePokemonSnapshot[];
      readonly activeEnemy?: MoodyRuntimePokemonSnapshot;
      readonly finalEnemyPokemon?: boolean;
    })
  | (EventBase & {
      readonly kind: "ko";
      readonly actor: MoodyRuntimePokemonSnapshot;
      readonly defeated: MoodyRuntimePokemonSnapshot;
      readonly replacementEnemy?: MoodyRuntimePokemonSnapshot;
    })
  | (EventBase & {
      readonly kind: "switch-attempt";
      readonly pokemon: MoodyRuntimePokemonSnapshot;
      readonly voluntary: boolean;
    })
  | (EventBase & {
      readonly kind: "lead-selection";
      readonly pokemonId: number;
    })
  | (EventBase & {
      readonly kind: "battle-won";
      readonly party: readonly MoodyRuntimePokemonSnapshot[];
      readonly selectedReviveIds?: readonly number[];
      readonly alliedFaints: number;
    })
  | (EventBase & {
      readonly kind: "biome-transition";
      readonly party: readonly MoodyRuntimePokemonSnapshot[];
      readonly replacementMoveCandidates: Readonly<Record<number, readonly string[]>>;
    })
  | (EventBase & {
      readonly kind: "encounter-generate";
      readonly isBoss: boolean;
      readonly isTrainer?: boolean;
      readonly baseRosterSize: number;
      readonly playerThreatPokemonId?: number;
      readonly noFaintWinStreak: number;
    })
  | (EventBase & {
      readonly kind: "boon-draft";
      readonly offerIds: readonly string[];
    });

export interface MoodyRuntimeFieldSnapshot {
  readonly kind: "weather" | "terrain" | "hazard" | "side-condition";
  readonly id: string;
  readonly ownerSide?: MoodyRuntimeSide;
  readonly beneficialToOwner?: boolean;
  readonly persistent: boolean;
  readonly scripted?: boolean;
}

export type MoodyRuntimeCommandKind =
  | "modify-damage"
  | "cap-damage"
  | "split-damage"
  | "set-move-type"
  | "ignore-weather-penalty"
  | "treat-as-weather-boosted"
  | "modify-priority"
  | "modify-speed"
  | "modify-stat"
  | "ignore-burn-attack-penalty"
  | "modify-burn-damage"
  | "allow-move-while-asleep"
  | "shorten-status"
  | "prevent-status"
  | "apply-status"
  | "cure-status"
  | "prevent-volatile"
  | "shorten-volatile"
  | "clear-negative-stages"
  | "clear-volatiles"
  | "apply-barrier"
  | "decay-barrier"
  | "heal"
  | "restore-pp"
  | "consume-extra-pp"
  | "typeless-damage"
  | "nonlethal-damage"
  | "request-weather-choice"
  | "request-terrain-choice"
  | "set-weather"
  | "apply-directional-screen"
  | "carry-field-state"
  | "modify-field-strength"
  | "guarantee-secondary-effect"
  | "increase-secondary-chance"
  | "ignore-defense-fraction"
  | "grant-temporary-move"
  | "request-temporary-move-choice"
  | "grant-temporary-ability"
  | "execute-committed-move"
  | "revive"
  | "lock-switching"
  | "prevent-switch"
  | "invalidate-lead"
  | "hide-enemy-information"
  | "set-enemy-roster-size"
  | "set-counter-weight"
  | "apply-enemy-stat-multiplier"
  | "set-boon-dormancy"
  | "conceal-boon-offer"
  | "replace-move-temporarily"
  | "reset-toxic-counter"
  | "schedule-damage-debt"
  | "collect-damage-debt"
  | "queue-next-move-power"
  | "mark-trigger";

export interface MoodyRuntimeCommand {
  readonly kind: MoodyRuntimeCommandKind;
  readonly effectId: MoodyRuntimeFieldBoonId | MoodyRuntimeFieldCurseId;
  readonly instanceId?: string;
  readonly subjectId?: number;
  readonly targetIds?: readonly number[];
  readonly amount?: number;
  readonly fraction?: number;
  readonly multiplier?: number;
  readonly durationTurns?: number;
  readonly value?: string | number | boolean;
  readonly options?: readonly string[];
  readonly data?: Readonly<Record<string, Scalar | readonly string[] | readonly number[]>>;
}

export interface MoodyRuntimeFieldInput {
  readonly ownerSide: MoodyRuntimeSide;
  readonly boons: readonly MoodyBoonInstance[];
  readonly curses: readonly MoodyCurseInstance[];
  readonly state: MoodyRuntimeFieldState;
  readonly event: MoodyRuntimeFieldEvent;
}

export interface MoodyRuntimeFieldResult {
  readonly state: MoodyRuntimeFieldState;
  readonly deltas: readonly MoodyRuntimeStateDelta[];
  readonly commands: readonly MoodyRuntimeCommand[];
  readonly triggeredEffectIds: readonly (MoodyRuntimeFieldBoonId | MoodyRuntimeFieldCurseId)[];
}

const FIELD_BOON_ID_SET: ReadonlySet<string> = new Set(MOODY_RUNTIME_FIELD_BOON_IDS);
const FIELD_CURSE_ID_SET: ReadonlySet<string> = new Set(MOODY_RUNTIME_FIELD_CURSE_IDS);

export const MOODY_RUNTIME_FIELD_VARIANTS = Object.freeze(
  Object.fromEntries(
    MOODY_BOONS.filter(definition => FIELD_BOON_ID_SET.has(definition.id)).map(definition => [
      definition.id,
      {
        base: true,
        rankTwo: true,
        evolutionIds: definition.evolutions.map(evolution => evolution.id),
      },
    ]),
  ),
) as unknown as Readonly<
  Record<MoodyRuntimeFieldBoonId, { base: true; rankTwo: true; evolutionIds: readonly string[] }>
>;

export const MOODY_RUNTIME_FIELD_COVERAGE = Object.freeze({
  boonNumbers: Object.freeze(Array.from({ length: 34 }, (_, index) => index + 38)),
  boonIds: MOODY_RUNTIME_FIELD_BOON_IDS,
  curseNumbers: Object.freeze([3, 4, 6, 7, 9, 10, 12, 13, 14, 15, 16, 20, 22, 23, 24, 25, 26, 27, 28, 29, 30]),
  curseIds: MOODY_RUNTIME_FIELD_CURSE_IDS,
  variants: MOODY_RUNTIME_FIELD_VARIANTS,
});

export function createMoodyRuntimeFieldState(): MoodyRuntimeFieldState {
  return { numbers: {}, values: {}, lists: {} };
}

function numberAt(state: MoodyRuntimeFieldState, key: string): number {
  return state.numbers[key] ?? 0;
}

function valueAt<T extends Scalar>(state: MoodyRuntimeFieldState, key: string, fallback: T): T {
  return (state.values[key] as T | undefined) ?? fallback;
}

function listAt(state: MoodyRuntimeFieldState, key: string): readonly string[] {
  return state.lists[key] ?? [];
}

function appliesToPokemon(boon: MoodyBoonInstance, pokemon: MoodyRuntimePokemonSnapshot, doctrineId?: string): boolean {
  if (boon.dormant) {
    return false;
  }
  if (doctrineId && boon.evolutionId === doctrineId) {
    return pokemon.side === "player";
  }
  const ids = boon.target?.pokemonIds;
  return ids == null || ids.length === 0 || ids.includes(pokemon.id);
}

function appliesToSlot(boon: MoodyBoonInstance, pokemon: MoodyRuntimePokemonSnapshot, doctrineId?: string): boolean {
  if (boon.dormant) {
    return false;
  }
  if (doctrineId && boon.evolutionId === doctrineId) {
    return pokemon.side === "player";
  }
  const slots = boon.target?.partySlots;
  return slots == null || slots.length === 0 || slots.includes(pokemon.partySlot);
}

function rankTwo(boon: MoodyBoonInstance): boolean {
  return boon.rank >= 2;
}

function deterministicIndex(seed: number, salt: string, length: number): number {
  let hash = seed | 0;
  for (let index = 0; index < salt.length; index++) {
    hash = Math.imul(hash ^ salt.charCodeAt(index), 16777619);
  }
  return length ? (hash >>> 0) % length : 0;
}

export function resolveMoodyRuntimeField(input: MoodyRuntimeFieldInput): MoodyRuntimeFieldResult {
  const deltas: MoodyRuntimeStateDelta[] = [];
  const commands: MoodyRuntimeCommand[] = [];
  const triggered: (MoodyRuntimeFieldBoonId | MoodyRuntimeFieldCurseId)[] = [];
  const numbers = { ...input.state.numbers };
  const values = { ...input.state.values };
  const lists = { ...input.state.lists };

  const setNumber = (key: string, value: number): void => {
    numbers[key] = value;
    deltas.push({ op: "set-number", key, value });
  };
  const setValue = (key: string, value: Scalar): void => {
    values[key] = value;
    deltas.push({ op: "set-value", key, value });
  };
  const setList = (key: string, value: readonly string[]): void => {
    lists[key] = [...value];
    deltas.push({ op: "set-list", key, value: [...value] });
  };
  const currentState = (): MoodyRuntimeFieldState => ({
    numbers,
    values,
    lists,
  });
  const emit = (command: MoodyRuntimeCommand): void => {
    commands.push(command);
    if (!triggered.includes(command.effectId)) {
      triggered.push(command.effectId);
    }
  };
  const event = input.event;
  const battleKey = (effectId: string, suffix: string): string => `${event.battleId}:${effectId}:${suffix}`;
  const pokemonKey = (effectId: string, pokemonId: number, suffix: string): string =>
    `${event.battleId}:${effectId}:pokemon:${pokemonId}:${suffix}`;

  for (const rawBoon of input.boons) {
    if (!FIELD_BOON_ID_SET.has(rawBoon.boonId) || rawBoon.dormant) {
      continue;
    }
    const boon = rawBoon as MoodyBoonInstance & {
      boonId: MoodyRuntimeFieldBoonId;
    };
    const id = boon.boonId;
    const baseCommand = (
      kind: MoodyRuntimeCommandKind,
      extra: Omit<MoodyRuntimeCommand, "kind" | "effectId" | "instanceId"> = {},
    ): void => emit({ kind, effectId: id, instanceId: boon.instanceId, ...extra });

    switch (id) {
      case "prismatic-opening": {
        if (
          event.kind !== "before-move"
          || !event.damaging
          || !event.legalBestType
          || event.user.side !== input.ownerSide
        ) {
          break;
        }
        if (!appliesToPokemon(boon, event.user, "prismatic-doctrine")) {
          break;
        }
        const key = pokemonKey(id, event.user.id, "used");
        if (valueAt(currentState(), key, false)) {
          break;
        }
        baseCommand("set-move-type", {
          subjectId: event.user.id,
          value: event.legalBestType,
        });
        const penalty =
          boon.evolutionId === "perfect-refraction"
            ? 1
            : boon.evolutionId === "prismatic-doctrine"
              ? 0.65
              : rankTwo(boon)
                ? 0.8
                : 0.7;
        baseCommand("modify-damage", {
          subjectId: event.user.id,
          multiplier: penalty,
        });
        setValue(key, true);
        break;
      }
      case "elemental-dividend": {
        if (
          event.kind !== "move-resolved"
          || event.user.side !== input.ownerSide
          || !event.dealtDirectDamage
          || (event.weaknessMultiplier ?? 1) <= 1
        ) {
          break;
        }
        const typeKey = pokemonKey(id, event.user.id, "types");
        const usedTypes = listAt(currentState(), typeKey);
        const mayRepeat = boon.evolutionId === "diversified-portfolio" && !usedTypes.includes(event.moveType);
        if (usedTypes.length > 0 && !mayRepeat) {
          break;
        }
        const barrier = (event.weaknessMultiplier ?? 1) >= 4 ? (rankTwo(boon) ? 0.5 : 0.4) : rankTwo(boon) ? 0.25 : 0.2;
        baseCommand("apply-barrier", {
          subjectId: event.user.id,
          fraction: barrier,
          data: {
            overflowToHealingAndPower: boon.evolutionId === "compound-elements",
          },
        });
        setList(typeKey, [...usedTypes, event.moveType]);
        break;
      }
      case "chromatic-relay": {
        if (event.kind !== "before-move" || event.user.side !== input.ownerSide || !event.damaging) {
          break;
        }
        const chain = listAt(currentState(), battleKey(id, "types"));
        if (chain.includes(event.moveType)) {
          setList(battleKey(id, "types"), [event.moveType]);
          baseCommand("mark-trigger", { value: "chain-reset" });
        } else {
          const nextLength = chain.length + 1;
          const multiplier = nextLength === 2 ? 1.15 : nextLength === 3 ? 1.4 : nextLength >= 4 ? 1.9 : 1;
          if (multiplier > 1) {
            baseCommand("modify-damage", {
              subjectId: event.user.id,
              multiplier,
            });
          } else {
            baseCommand("mark-trigger", {
              subjectId: event.user.id,
              value: "chain-started",
            });
          }
          if (boon.evolutionId === "spectrum-break" && nextLength === 4) {
            baseCommand("ignore-defense-fraction", {
              subjectId: event.user.id,
              fraction: 0.25,
            });
            baseCommand("guarantee-secondary-effect", {
              subjectId: event.user.id,
            });
          }
          if (boon.evolutionId === "endless-spectrum" && nextLength > 4) {
            baseCommand("heal", { subjectId: event.user.id, fraction: 0.1 });
          }
          setList(battleKey(id, "types"), [...chain, event.moveType]);
        }
        break;
      }
      case "microclimate": {
        if (event.kind !== "entry" || event.pokemon.side !== input.ownerSide || !appliesToSlot(boon, event.pokemon)) {
          break;
        }
        const countKey = battleKey(id, `slot:${event.pokemon.partySlot}:uses`);
        const uses = numberAt(currentState(), countKey);
        const maxUses = boon.evolutionId === "mobile-front" ? 2 : 1;
        if (uses >= maxUses || (uses > 0 && !event.isReentry)) {
          break;
        }
        const allOptions = event.weatherOptions ?? [];
        const optionCount = boon.evolutionId === "stormglass-heart" ? allOptions.length : rankTwo(boon) ? 4 : 3;
        const duration =
          boon.evolutionId === "stormglass-heart" ? 5 : boon.evolutionId === "mobile-front" ? 3 : rankTwo(boon) ? 4 : 3;
        baseCommand("request-weather-choice", {
          subjectId: event.pokemon.id,
          options: allOptions.slice(0, optionCount),
          durationTurns: duration,
        });
        setNumber(countKey, uses + 1);
        break;
      }
      case "eye-of-the-storm": {
        if (
          event.kind !== "weather-transition"
          || !event.naturalOrReplacement
          || event.activePokemon.side !== input.ownerSide
        ) {
          break;
        }
        const useKey = battleKey(id, "uses");
        const uses = numberAt(currentState(), useKey);
        if (uses >= (boon.evolutionId === "storm-communion" ? 2 : 1)) {
          break;
        }
        baseCommand("heal", {
          subjectId: event.activePokemon.id,
          fraction: rankTwo(boon) ? 0.4 : 0.3,
        });
        baseCommand("restore-pp", {
          subjectId: event.activePokemon.id,
          amount: rankTwo(boon) ? 8 : 5,
          data: { distribution: "most-depleted" },
        });
        if (boon.evolutionId === "calm-center") {
          baseCommand("apply-barrier", {
            subjectId: event.activePokemon.id,
            fraction: 0.25,
          });
        }
        if (boon.evolutionId === "storm-communion" && event.lowestHpBenchedAlly) {
          baseCommand("heal", {
            subjectId: event.lowestHpBenchedAlly.id,
            fraction: 0.15,
          });
        }
        setNumber(useKey, uses + 1);
        break;
      }
      case "climate-contrarian": {
        if (
          event.kind !== "before-move"
          || event.user.side !== input.ownerSide
          || !event.weatherWeakens
          || !appliesToPokemon(boon, event.user, "contrarian-doctrine")
        ) {
          break;
        }
        baseCommand("ignore-weather-penalty", { subjectId: event.user.id });
        baseCommand("modify-damage", {
          subjectId: event.user.id,
          multiplier: boon.evolutionId === "contrarian-doctrine" ? 1.1 : rankTwo(boon) ? 1.2 : 1.1,
        });
        if (boon.evolutionId === "perverse-climate") {
          baseCommand("treat-as-weather-boosted", { subjectId: event.user.id });
        }
        break;
      }
      case "terrain-weaver": {
        if (
          event.kind !== "entry"
          || event.pokemon.side !== input.ownerSide
          || !event.pokemon.grounded
          || !appliesToSlot(boon, event.pokemon)
        ) {
          break;
        }
        const countKey = battleKey(id, `slot:${event.pokemon.partySlot}:uses`);
        const uses = numberAt(currentState(), countKey);
        if (uses >= (boon.evolutionId === "landshaper" ? 2 : 1)) {
          break;
        }
        const allOptions = event.terrainOptions ?? [];
        baseCommand("request-terrain-choice", {
          subjectId: event.pokemon.id,
          options: rankTwo(boon) ? allOptions : allOptions.slice(0, 3),
          durationTurns: rankTwo(boon) ? 4 : 3,
          data: {
            ownerStrengthMultiplier: boon.evolutionId === "territorial-claim" ? 1.25 : 1,
          },
        });
        setNumber(countKey, uses + 1);
        break;
      }
      case "four-seasons": {
        if (event.kind !== "turn-start" || event.activePokemonIds.length === 0) {
          break;
        }
        const period = rankTwo(boon) ? 3 : 4;
        const seasons =
          boon.evolutionId === "five-seasons"
            ? ["sun", "rain", "sand", "snow", "fog"]
            : ["sun", "rain", "sand", "snow"];
        const cycleTurn = event.turn % period;
        if (cycleTurn === period - 1) {
          baseCommand("mark-trigger", {
            value: "season-warning",
            data: {
              nextWeather: seasons[Math.floor(event.turn / period) % seasons.length],
            },
          });
        }
        if (cycleTurn === 0) {
          const next = seasons[(Math.floor(event.turn / period) - 1 + seasons.length) % seasons.length];
          baseCommand("set-weather", { value: next, durationTurns: period });
          for (const pokemonId of event.activePokemonIds) {
            baseCommand("heal", {
              subjectId: pokemonId,
              fraction: rankTwo(boon) ? 0.08 : 0.05,
            });
          }
          if (boon.evolutionId === "five-seasons") {
            baseCommand("mark-trigger", { value: `transition:${next}` });
          }
          if (boon.evolutionId === "seasonal-memory") {
            baseCommand("mark-trigger", {
              value: "retain-outgoing-weather",
              durationTurns: 1,
            });
          }
        }
        break;
      }
      case "battlefield-memory": {
        if (event.kind === "battle-end" && event.field) {
          const eligible = event.field.filter(
            field =>
              field.persistent
              && !field.scripted
              && !(
                boon.evolutionId === "selective-memory"
                && field.ownerSide === input.ownerSide
                && field.beneficialToOwner === false
              ),
          );
          setList(
            `persistent:${id}:field`,
            eligible.map(field => JSON.stringify(field)),
          );
          baseCommand("mark-trigger", {
            value: "field-captured",
            amount: eligible.length,
          });
        } else if (event.kind === "battle-start" && event.isTrainer) {
          const carried = listAt(currentState(), `persistent:${id}:field`);
          if (carried.length > 0) {
            baseCommand("carry-field-state", {
              durationTurns: rankTwo(boon) ? 2 : 1,
              options: carried,
              data: {
                ownerStrengthMultiplier: boon.evolutionId === "home-field-memory" ? 1.25 : 1,
              },
            });
          }
        }
        break;
      }
      case "weather-wake": {
        if (
          event.kind !== "weather-transition"
          || !event.naturalOrReplacement
          || event.activePokemon.side !== input.ownerSide
          || event.previous === "clear"
        ) {
          break;
        }
        const strength = rankTwo(boon) ? 4 / 3 : 1;
        const duration = boon.evolutionId === "lingering-wake" ? 2 : 1;
        const targets = [event.activePokemon.id];
        if (event.previous === "sun") {
          baseCommand("queue-next-move-power", {
            targetIds: targets,
            multiplier: 1 + 0.3 * strength,
            durationTurns: duration,
            value: "fire",
          });
        }
        if (event.previous === "rain") {
          for (const targetId of targets) {
            baseCommand("heal", {
              subjectId: targetId,
              fraction: 0.15 * strength,
            });
          }
        }
        if (event.previous === "sand" || event.previous === "snow") {
          baseCommand("apply-directional-screen", {
            targetIds: targets,
            multiplier: 1 - 0.25 * strength,
            durationTurns: duration,
            value: event.previous === "sand" ? "physical" : "special",
          });
        }
        if (event.previous === "fog") {
          for (const targetId of targets) {
            baseCommand("modify-stat", {
              subjectId: targetId,
              amount: 1,
              value: "accuracy",
            });
          }
          baseCommand("increase-secondary-chance", {
            targetIds: targets,
            amount: 20 * strength,
            durationTurns: duration,
          });
        }
        break;
      }
      case "adrenal-condition": {
        if (
          event.kind !== "status-applied"
          || event.target.side !== input.ownerSide
          || !appliesToPokemon(boon, event.target, "adrenal-doctrine")
        ) {
          break;
        }
        const statusKey = pokemonKey(
          id,
          event.target.id,
          boon.evolutionId === "conditioned-athlete" ? `status:${event.status}` : "triggered",
        );
        if (valueAt(currentState(), statusKey, false)) {
          break;
        }
        baseCommand("modify-stat", {
          subjectId: event.target.id,
          amount: 1,
          value: "speed",
        });
        baseCommand("modify-damage", {
          subjectId: event.target.id,
          multiplier: boon.evolutionId === "adrenal-doctrine" ? 1.1 : 1.15,
          data: { whileStatusRemains: true },
        });
        if (rankTwo(boon) && boon.evolutionId !== "adrenal-doctrine") {
          baseCommand("modify-stat", {
            subjectId: event.target.id,
            amount: 1,
            value: "highest-offense",
          });
        }
        setValue(statusKey, true);
        break;
      }
      case "burning-resolve": {
        if (
          event.kind === "before-move"
          && event.user.status === "burn"
          && event.user.side === input.ownerSide
          && appliesToPokemon(boon, event.user, "burning-doctrine")
        ) {
          baseCommand("ignore-burn-attack-penalty", {
            subjectId: event.user.id,
          });
          if (rankTwo(boon) && boon.evolutionId !== "burning-doctrine") {
            baseCommand("modify-damage", {
              subjectId: event.user.id,
              multiplier: 1.2,
              data: { stat: "attack" },
            });
          }
        } else if (
          event.kind === "move-resolved"
          && event.user.status === "burn"
          && event.user.side === input.ownerSide
          && event.landed
          && event.dealtDirectDamage
          && boon.evolutionId === "cauterized"
          && appliesToPokemon(boon, event.user, "burning-doctrine")
        ) {
          baseCommand("heal", {
            subjectId: event.user.id,
            fraction: 0.05,
          });
        } else if (
          event.kind === "before-damage"
          && event.poisonDamage === false
          && event.target.status === "burn"
          && event.target.side === input.ownerSide
          && appliesToPokemon(boon, event.target, "burning-doctrine")
        ) {
          baseCommand("modify-damage", {
            subjectId: event.target.id,
            multiplier: 0.8,
            data: { stat: "special-defense" },
          });
        } else if (
          event.kind === "before-damage"
          && event.target.status === "burn"
          && !event.direct
          && boon.evolutionId === "cauterized"
          && appliesToPokemon(boon, event.target)
        ) {
          baseCommand("modify-burn-damage", {
            subjectId: event.target.id,
            multiplier: 0.5,
          });
        }
        break;
      }
      case "toxic-bloom": {
        if (
          event.kind === "before-move"
          && (event.user.status === "poison" || event.user.status === "toxic")
          && event.user.side === input.ownerSide
          && event.damaging
        ) {
          baseCommand("modify-damage", {
            subjectId: event.user.id,
            multiplier: rankTwo(boon) ? 1.35 : 1.25,
          });
        } else if (event.kind === "before-damage" && event.poisonDamage && event.target.side === input.ownerSide) {
          baseCommand("cap-damage", {
            subjectId: event.target.id,
            amount: Math.max(0, event.target.currentHp - 1),
          });
          if (boon.evolutionId === "toxic-renewal") {
            baseCommand("apply-barrier", {
              subjectId: event.target.id,
              amount: event.amount * 0.5,
              data: { afterDamage: true },
            });
          }
        } else if (
          event.kind === "ko"
          && event.actor.side === input.ownerSide
          && (event.actor.status === "poison" || event.actor.status === "toxic")
        ) {
          baseCommand("reset-toxic-counter", {
            subjectId: event.actor.id,
            amount: 1,
          });
          if (boon.evolutionId === "venom-garden" && event.replacementEnemy) {
            baseCommand("apply-status", {
              subjectId: event.replacementEnemy.id,
              value: "poison",
            });
          }
        }
        break;
      }
      case "insomniac-dreams": {
        if (event.kind === "move-resolved") {
          const actionKey = `${battleKey(id, "shared-dream-action")}:${event.actionId}`;
          if (boon.evolutionId === "shared-dream" && event.landed && valueAt(currentState(), actionKey, false)) {
            baseCommand("modify-stat", {
              amount: 1,
              value: "seeded-random",
              data: { target: "lowest-hp-other-ally", excludePokemonId: event.user.id },
            });
          }
          setValue(actionKey, false);
          break;
        }
        if (
          event.kind !== "before-move"
          || event.user.side !== input.ownerSide
          || !event.asleep
          || !appliesToPokemon(boon, event.user)
        ) {
          break;
        }
        const allowedStatus = event.category === "status";
        const allowedDream =
          boon.evolutionId === "lucid-dreamer"
          && event.damaging
          && (event.dreamTagged || event.moveType === "psychic" || event.moveType === "ghost");
        if (!allowedStatus && !allowedDream) {
          break;
        }
        baseCommand("allow-move-while-asleep", { subjectId: event.user.id });
        baseCommand("modify-priority", {
          subjectId: event.user.id,
          amount: allowedStatus && !rankTwo(boon) ? -1 : 0,
        });
        baseCommand("shorten-status", {
          subjectId: event.user.id,
          amount: 1,
          value: "sleep",
        });
        if (allowedDream) {
          baseCommand("modify-damage", {
            subjectId: event.user.id,
            multiplier: 0.5,
          });
        }
        if (boon.evolutionId === "shared-dream") {
          setValue(`${battleKey(id, "shared-dream-action")}:${event.actionId}`, true);
        }
        break;
      }
      case "frostbound-time": {
        if (
          event.kind === "status-applied"
          && event.status === "frostbite"
          && event.target.side === input.ownerSide
          && appliesToPokemon(boon, event.target)
        ) {
          const key = pokemonKey(id, event.target.id, "used");
          if (valueAt(currentState(), key, false)) {
            break;
          }
          baseCommand("apply-barrier", {
            subjectId: event.target.id,
            fraction: rankTwo(boon) ? 0.35 : 0.25,
            durationTurns: rankTwo(boon) ? 3 : 2,
            value: "frostbound",
          });
          baseCommand("mark-trigger", {
            subjectId: event.target.id,
            value: "suppress-frostbite-penalties",
          });
          setValue(key, true);
        } else if (
          event.kind === "before-move"
          && event.user.status === "frostbite"
          && event.category === "special"
          && boon.evolutionId === "permafrost-engine"
          && appliesToPokemon(boon, event.user)
        ) {
          baseCommand("modify-damage", {
            subjectId: event.user.id,
            multiplier: 1.25,
          });
        } else if (
          event.kind === "barrier-ended"
          && event.barrierTag === "frostbound"
          && appliesToPokemon(boon, event.target)
        ) {
          baseCommand("cure-status", {
            subjectId: event.target.id,
            value: "frostbite",
          });
          if (boon.evolutionId === "thaw-burst") {
            baseCommand("heal", { subjectId: event.target.id, fraction: 0.2 });
            baseCommand("guarantee-secondary-effect", {
              subjectId: event.target.id,
              data: { nextMove: true },
            });
          }
        }
        break;
      }
      case "shared-antibodies": {
        if (event.kind === "status-cured" && event.target.side === input.ownerSide) {
          const expiry = event.turn + (rankTwo(boon) ? 5 : 3);
          setNumber(battleKey(id, `immunity:${event.status}`), expiry);
          baseCommand("mark-trigger", {
            value: `immunity:${event.status}`,
            durationTurns: rankTwo(boon) ? 5 : 3,
          });
          if (boon.evolutionId === "herd-immunity") {
            baseCommand("heal", {
              targetIds: [event.target.id, ...(event.adjacentAllies?.map(ally => ally.id) ?? [])],
              fraction: 0.1,
            });
          }
        } else if (
          event.kind === "status-attempt"
          && event.target.side === input.ownerSide
          && numberAt(currentState(), battleKey(id, `immunity:${event.status}`)) >= event.turn
        ) {
          baseCommand("prevent-status", {
            subjectId: event.target.id,
            value: event.status,
          });
          if (boon.evolutionId === "adaptive-serum" && event.source && event.legalOnSource) {
            baseCommand("apply-status", {
              subjectId: event.source.id,
              value: event.status,
            });
          }
        }
        break;
      }
      case "status-bank": {
        if (event.kind === "status-attempt" && event.target.side === input.ownerSide) {
          const bankKey = battleKey(id, "stored");
          const stored = listAt(currentState(), bankKey);
          const capacity = rankTwo(boon) || boon.evolutionId === "joint-account" ? 2 : 1;
          if (stored.length < capacity) {
            baseCommand("prevent-status", {
              subjectId: event.target.id,
              value: event.status,
            });
            setList(bankKey, [...stored, `${event.status}@${event.turn}`]);
          }
        } else if (
          event.kind === "move-resolved"
          && event.user.side === input.ownerSide
          && event.dealtDirectDamage
          && event.target
        ) {
          const bankKey = battleKey(id, "stored");
          const stored = listAt(currentState(), bankKey);
          if (stored.length === 0) {
            break;
          }
          const [statusWithTurn, ...remaining] = stored;
          const [status, storedTurn] = statusWithTurn.split("@");
          const appliedStatus =
            boon.evolutionId === "interest-bearing-status" && status === "poison" && event.turn > Number(storedTurn)
              ? "toxic"
              : status;
          baseCommand("apply-status", {
            subjectId: event.target.id,
            value: appliedStatus,
          });
          setList(bankKey, remaining);
        }
        break;
      }
      case "misery-loves-company": {
        if (
          event.kind === "before-damage"
          && event.target.side === input.ownerSide
          && event.target.status
          && !event.source?.status
        ) {
          baseCommand("modify-damage", {
            subjectId: event.target.id,
            multiplier: rankTwo(boon) ? 0.8 : 0.85,
          });
        } else if (
          event.kind === "before-move"
          && event.user.side === input.ownerSide
          && event.user.status
          && event.category === "status"
        ) {
          baseCommand("modify-priority", {
            subjectId: event.user.id,
            amount: 1,
          });
        } else if (
          event.kind === "before-move"
          && event.user.side === input.ownerSide
          && event.user.status
          && !event.target?.status
          && boon.evolutionId === "schadenfreude"
        ) {
          baseCommand("modify-damage", {
            subjectId: event.user.id,
            multiplier: 1.2,
          });
        } else if (
          event.kind === "status-applied"
          && event.target.side === input.ownerSide
          && boon.evolutionId === "shared-misery"
        ) {
          baseCommand("apply-barrier", {
            targetIds: [],
            fraction: 0.15,
            data: { target: "lowest-hp-other-ally" },
          });
        }
        break;
      }
      case "volatile-memory": {
        if (event.kind === "volatile-attempt" && event.target.side === input.ownerSide) {
          const persistentKey = `persistent:${id}:pokemon:${event.target.id}:volatiles`;
          const battleList = listAt(currentState(), pokemonKey(id, event.target.id, "volatiles"));
          const teamList = listAt(currentState(), battleKey(id, "team-volatiles"));
          if (
            battleList.includes(event.volatile)
            || teamList.includes(event.volatile)
            || listAt(currentState(), persistentKey).includes(event.volatile)
          ) {
            baseCommand("prevent-volatile", {
              subjectId: event.target.id,
              value: event.volatile,
            });
          }
        } else if (
          event.kind === "volatile-applied"
          && event.target.side === input.ownerSide
          && appliesToPokemon(boon, event.target)
        ) {
          const key = pokemonKey(id, event.target.id, "volatiles");
          setList(key, [...new Set([...listAt(currentState(), key), event.volatile])]);
          if (rankTwo(boon)) {
            baseCommand("shorten-volatile", {
              subjectId: event.target.id,
              amount: 1,
              value: event.volatile,
            });
          }
          if (boon.evolutionId === "long-memory") {
            setList(`persistent:${id}:pokemon:${event.target.id}:volatiles`, [event.volatile]);
          }
          if (boon.evolutionId === "collective-memory") {
            setList(battleKey(id, "team-volatiles"), [event.volatile]);
          }
          baseCommand("mark-trigger", {
            subjectId: event.target.id,
            value: `remember:${event.volatile}`,
          });
        }
        break;
      }
      case "purge-pulse": {
        if (event.kind !== "action-resolved" || event.actor.side !== input.ownerSide) {
          break;
        }
        const key = battleKey(id, "actions");
        const count = numberAt(currentState(), key) + 1;
        setNumber(key, count);
        const cadence = rankTwo(boon) ? 4 : 5;
        if (count % cadence !== 0) {
          break;
        }
        baseCommand("clear-negative-stages", {
          subjectId: event.actor.id,
          amount: boon.evolutionId === "purifying-wave" ? event.removableNegativeCount : 1,
          data: { categoryChoice: boon.evolutionId === "purifying-wave" },
        });
        baseCommand("typeless-damage", {
          targetIds: event.target ? [event.target.id] : [],
          amount: boon.evolutionId === "contaminant-burst" ? Math.max(1, event.removableNegativeCount) : 1,
        });
        break;
      }
      case "aftercare": {
        if (event.kind === "turn-end" && boon.evolutionId === "community-care") {
          const prefix = `${event.battleId}:${id}:temporary-stat:`;
          for (const [key, amount] of Object.entries(currentState().numbers)) {
            if (!key.startsWith(prefix) || key.endsWith(":expires") || amount <= 0) {
              continue;
            }
            if (event.turn < numberAt(currentState(), `${key}:expires`)) {
              continue;
            }
            const [pokemonId, stat] = key.slice(prefix.length).split(":");
            baseCommand("modify-stat", {
              subjectId: Number(pokemonId),
              amount: -amount,
              value: stat,
            });
            setNumber(key, 0);
            setNumber(`${key}:expires`, 0);
          }
          break;
        }
        if (
          event.kind !== "status-cured"
          || event.target.side !== input.ownerSide
          || !appliesToPokemon(boon, event.target)
        ) {
          break;
        }
        const triggerKey = pokemonKey(
          id,
          event.target.id,
          boon.evolutionId === "rehabilitation" ? `status:${event.status}` : "used",
        );
        if (valueAt(currentState(), triggerKey, false)) {
          break;
        }
        const adjacentIds =
          boon.evolutionId === "community-care" ? (event.adjacentAllies?.map(ally => ally.id) ?? []) : [];
        const recipients = [event.target.id, ...adjacentIds];
        const addStatRebound = (stat: "attack" | "speed"): void => {
          baseCommand("modify-stat", { subjectId: event.target.id, amount: 1, value: stat });
          for (const pokemonId of adjacentIds) {
            baseCommand("modify-stat", { subjectId: pokemonId, amount: 1, value: stat, durationTurns: 1 });
            const key = `${event.battleId}:${id}:temporary-stat:${pokemonId}:${stat}`;
            setNumber(key, numberAt(currentState(), key) + 1);
            setNumber(`${key}:expires`, Math.max(numberAt(currentState(), `${key}:expires`), event.turn + 1));
          }
        };
        if (event.status === "burn") {
          addStatRebound("attack");
        }
        if (event.status === "poison" || event.status === "toxic") {
          baseCommand("heal", {
            subjectId: event.target.id,
            fraction: rankTwo(boon) ? 0.25 : 0.2,
          });
          if (adjacentIds.length > 0) {
            baseCommand("heal", {
              targetIds: adjacentIds,
              fraction: (rankTwo(boon) ? 0.25 : 0.2) * 0.5,
            });
          }
        }
        if (event.status === "paralysis") {
          addStatRebound("speed");
        }
        if (event.status === "sleep") {
          baseCommand("modify-priority", {
            targetIds: recipients,
            amount: 1,
            data: { nextAction: true },
          });
        }
        if (event.status === "frostbite") {
          baseCommand("apply-barrier", {
            subjectId: event.target.id,
            fraction: rankTwo(boon) ? 0.35 : 0.25,
          });
          if (adjacentIds.length > 0) {
            baseCommand("apply-barrier", {
              targetIds: adjacentIds,
              fraction: (rankTwo(boon) ? 0.35 : 0.25) * 0.5,
            });
          }
        }
        setValue(triggerKey, true);
        break;
      }
      case "overflow-ward": {
        if (
          event.kind === "heal"
          && event.target.side === input.ownerSide
          && appliesToPokemon(boon, event.target, "overflow-doctrine")
        ) {
          const excess = Math.max(0, event.amount - event.effectiveAmount);
          if (!excess) {
            break;
          }
          const cap =
            boon.evolutionId === "reservoir"
              ? 0.6
              : boon.evolutionId === "overflow-doctrine"
                ? 0.2
                : rankTwo(boon)
                  ? 0.4
                  : 0.25;
          baseCommand("apply-barrier", {
            subjectId: event.target.id,
            amount: excess,
            data: { capMaxHpFraction: cap },
          });
        } else if (event.kind === "turn-end" && boon.evolutionId === "reservoir") {
          for (const pokemonId of event.activePokemonIds) {
            baseCommand("decay-barrier", {
              subjectId: pokemonId,
              fraction: 0.1,
              data: { onlyAboveMaxHpFraction: 0.4 },
            });
          }
        }
        break;
      }
      case "shared-cup": {
        if (event.kind !== "heal" || event.target.side !== input.ownerSide) {
          break;
        }
        const excess = Math.max(0, event.amount - event.effectiveAmount);
        if (!excess || event.benchedAllies.length === 0) {
          break;
        }
        const amount = excess * (rankTwo(boon) ? 0.75 : 0.5);
        const recipients =
          boon.evolutionId === "communion"
            ? event.benchedAllies.filter(ally => ally.currentHp < ally.maxHp)
            : [
                event.benchedAllies.reduce((lowest, ally) =>
                  ally.currentHp / ally.maxHp < lowest.currentHp / lowest.maxHp ? ally : lowest,
                ),
              ];
        baseCommand("heal", {
          targetIds: recipients.map(recipient => recipient.id),
          amount,
          data: { distributeEvenly: boon.evolutionId === "communion" },
        });
        if (boon.evolutionId === "overflow-vintage") {
          const overflow = Math.max(0, amount - (recipients[0].maxHp - recipients[0].currentHp));
          if (overflow <= 0) {
            break;
          }
          baseCommand("apply-barrier", {
            targetIds: recipients.map(recipient => recipient.id),
            amount: overflow,
          });
        }
        break;
      }
      case "damage-ceiling": {
        if (
          event.kind !== "before-damage"
          || !event.direct
          || event.target.side !== input.ownerSide
          || !appliesToSlot(boon, event.target, "ceiling-doctrine")
        ) {
          break;
        }
        const key = pokemonKey(id, event.target.id, "used");
        if (valueAt(currentState(), key, false)) {
          break;
        }
        const cap = boon.evolutionId === "ceiling-doctrine" ? 0.7 : rankTwo(boon) ? 0.5 : 0.6;
        if (event.amount <= event.target.maxHp * cap) {
          break;
        }
        baseCommand("cap-damage", {
          subjectId: event.target.id,
          amount: event.target.maxHp * cap,
          fraction: cap,
        });
        setValue(key, true);
        break;
      }
      case "layered-armor": {
        if (
          event.kind !== "before-damage"
          || !event.direct
          || event.target.side !== input.ownerSide
          || (event.hitIndex ?? 1) < 2
          || !appliesToPokemon(boon, event.target, "layered-doctrine")
        ) {
          break;
        }
        if (event.sameOriginatingAction === false && boon.evolutionId !== "ablative-layers") {
          break;
        }
        const perHit = boon.evolutionId === "layered-doctrine" ? 0.15 : rankTwo(boon) ? 0.3 : 0.2;
        baseCommand("modify-damage", {
          subjectId: event.target.id,
          multiplier: (1 - perHit) ** ((event.hitIndex ?? 1) - 1),
        });
        break;
      }
      case "emergency-shell": {
        if (event.kind !== "after-damage" || event.target.side !== input.ownerSide || !event.crossedQuarterHp) {
          break;
        }
        const key =
          boon.evolutionId === "emergency-protocol" ? pokemonKey(id, event.target.id, "used") : battleKey(id, "used");
        if (valueAt(currentState(), key, false)) {
          break;
        }
        baseCommand("clear-negative-stages", { subjectId: event.target.id });
        baseCommand("apply-barrier", {
          subjectId: event.target.id,
          fraction: rankTwo(boon) ? 0.3 : 0.2,
        });
        if (rankTwo(boon)) {
          baseCommand("clear-volatiles", { subjectId: event.target.id });
        }
        if (boon.evolutionId === "counter-shell") {
          baseCommand("queue-next-move-power", {
            subjectId: event.target.id,
            multiplier: 1.5,
          });
        }
        setValue(key, true);
        break;
      }
      case "guarded-setup": {
        if (event.kind !== "before-move" || event.user.side !== input.ownerSide || event.category !== "status") {
          break;
        }
        const key = pokemonKey(id, event.user.id, "used");
        if (valueAt(currentState(), key, false)) {
          break;
        }
        baseCommand("apply-barrier", {
          subjectId: event.user.id,
          fraction: rankTwo(boon) ? 0.25 : 0.15,
          data: { blocksNextStatus: boon.evolutionId === "safe-preparation" },
        });
        if (event.raisesStats && boon.evolutionId === "offensive-guard") {
          baseCommand("queue-next-move-power", {
            subjectId: event.user.id,
            multiplier: 1.2,
          });
        }
        setValue(key, true);
        break;
      }
      case "rest-cycle": {
        if (event.kind === "battle-end") {
          const entered = new Set(event.enteredPokemonIds);
          for (const pokemon of event.party.filter(candidate => !candidate.fainted && !entered.has(candidate.id))) {
            baseCommand("heal", {
              subjectId: pokemon.id,
              fraction: rankTwo(boon) ? 0.1 : 0.05,
            });
            baseCommand("restore-pp", {
              subjectId: pokemon.id,
              amount: rankTwo(boon) ? 2 : 1,
              data: { everyMove: true },
            });
            if (boon.evolutionId === "deep-rest") {
              baseCommand("cure-status", {
                subjectId: pokemon.id,
                value: "all-major",
              });
              baseCommand("clear-volatiles", { subjectId: pokemon.id });
            }
            if (boon.evolutionId === "rotation-plan") {
              setValue(`persistent:${id}:pokemon:${pokemon.id}:ready`, true);
            }
          }
        } else if (
          event.kind === "entry"
          && boon.evolutionId === "rotation-plan"
          && valueAt(currentState(), `persistent:${id}:pokemon:${event.pokemon.id}:ready`, false)
        ) {
          baseCommand("modify-stat", {
            subjectId: event.pokemon.id,
            amount: 1,
            value: "highest",
          });
          setValue(`persistent:${id}:pokemon:${event.pokemon.id}:ready`, false);
        }
        break;
      }
      case "last-rites": {
        const eligibleMoveIds = event.kind === "faint" ? event.pokemon.eligibleMoveIds : undefined;
        if (
          event.kind === "faint"
          && event.pokemon.side === input.ownerSide
          && eligibleMoveIds != null
          && eligibleMoveIds.length > 0
        ) {
          setList(battleKey(id, "fallen-moves"), eligibleMoveIds);
          setList(battleKey(id, "fallen-abilities"), event.pokemon.compatibleAbilityIds ?? []);
          baseCommand("mark-trigger", {
            subjectId: event.pokemon.id,
            value: "inheritance-queued",
          });
        } else if (
          event.kind === "entry"
          && event.pokemon.side === input.ownerSide
          && (event.pokemon.moveCount ?? 0) < 8
        ) {
          const moves = listAt(currentState(), battleKey(id, "fallen-moves"));
          if (moves.length === 0) {
            break;
          }
          const rolled = [...moves]
            .sort()
            .slice(deterministicIndex(event.seed, `${id}:${event.pokemon.id}`, moves.length))
            .concat([...moves].sort())
            .slice(0, boon.evolutionId === "inheritance" ? 3 : 1);
          if (boon.evolutionId === "inheritance") {
            baseCommand("request-temporary-move-choice", {
              subjectId: event.pokemon.id,
              options: [...new Set(rolled)],
              amount: rankTwo(boon) ? 2 : 1,
            });
          } else {
            baseCommand("grant-temporary-move", {
              subjectId: event.pokemon.id,
              value: rolled[0],
              amount: rankTwo(boon) ? 2 : 1,
            });
          }
          if (boon.evolutionId === "final-testament") {
            const abilities = listAt(currentState(), battleKey(id, "fallen-abilities"));
            if (abilities.length > 0) {
              baseCommand("grant-temporary-ability", {
                subjectId: event.pokemon.id,
                value: abilities[deterministicIndex(event.seed, id, abilities.length)],
                durationTurns: 1,
              });
            }
          }
          setList(battleKey(id, "fallen-moves"), []);
        }
        break;
      }
      case "no-one-left-behind": {
        if (event.kind !== "battle-won" || event.party.filter(pokemon => !pokemon.fainted).length !== 1) {
          break;
        }
        const segment = Math.floor(event.waveIndex / 10);
        const key = `segment:${segment}:${id}:used`;
        if (valueAt(currentState(), key, false)) {
          break;
        }
        const fainted = event.party
          .filter(pokemon => pokemon.fainted)
          .map(pokemon => pokemon.id)
          .sort((a, b) => a - b);
        let targetIds: readonly number[] = fainted.slice(0, rankTwo(boon) ? 3 : 2);
        let fraction = rankTwo(boon) ? 0.35 : 0.25;
        if (boon.evolutionId === "rally") {
          targetIds = fainted;
        }
        if (boon.evolutionId === "chosen-rescue") {
          targetIds = (event.selectedReviveIds ?? fainted).slice(0, 2);
          fraction = 0.5;
        }
        if (targetIds.length > 0) {
          baseCommand("revive", { targetIds, fraction });
        }
        setValue(key, true);
        break;
      }
      case "phoenix-clause": {
        if (event.kind === "turn-end" && boon.evolutionId === "ashen-return") {
          const expiresKey = battleKey(id, "ashen-expires");
          const expires = numberAt(currentState(), expiresKey);
          const revivedPokemonId = numberAt(currentState(), battleKey(id, "ashen-pokemon"));
          if (expires > 0 && event.turn >= expires && revivedPokemonId > 0) {
            baseCommand("modify-stat", {
              subjectId: revivedPokemonId,
              amount: -1,
              value: "all",
            });
            setNumber(expiresKey, 0);
            setNumber(battleKey(id, "ashen-pokemon"), 0);
          }
          break;
        }
        if (
          event.kind !== "faint"
          || event.pokemon.side !== input.ownerSide
          || !appliesToPokemon(boon, event.pokemon)
        ) {
          break;
        }
        const scope =
          boon.evolutionId === "eternal-ember" && event.waveIndex % 10 === 0
            ? `boss:${event.battleId}`
            : `segment:${Math.floor(event.waveIndex / 10)}`;
        const key = `${scope}:${id}:pokemon:${event.pokemon.id}:used`;
        if (valueAt(currentState(), key, false)) {
          break;
        }
        baseCommand("revive", {
          subjectId: event.pokemon.id,
          fraction: boon.evolutionId === "ashen-return" ? 0.25 : rankTwo(boon) ? 0.4 : 0.25,
          data: {
            clearStatusAndNegativeStages: rankTwo(boon),
            allStats: boon.evolutionId === "ashen-return" ? 1 : 0,
            statDuration: boon.evolutionId === "ashen-return" ? 3 : 0,
          },
        });
        if (boon.evolutionId === "ashen-return") {
          setNumber(battleKey(id, "ashen-pokemon"), event.pokemon.id);
          setNumber(battleKey(id, "ashen-expires"), event.turn + 3);
        }
        setValue(key, true);
        break;
      }
      case "dead-man-s-action": {
        if (
          event.kind !== "faint"
          || event.pokemon.side !== input.ownerSide
          || !appliesToPokemon(boon, event.pokemon)
          || !event.committedMove?.eligible
        ) {
          break;
        }
        const allowed = event.committedMove.category !== "status" || boon.evolutionId === "posthumous-support";
        if (!allowed) {
          break;
        }
        const multiplier = boon.evolutionId === "last-word" ? 1 : rankTwo(boon) ? 0.75 : 0.5;
        baseCommand("execute-committed-move", {
          subjectId: event.pokemon.id,
          value: event.committedMove.moveId,
          multiplier,
          data: { retainSecondaryEffects: boon.evolutionId === "last-word" },
        });
        break;
      }
      case "glass-memory": {
        if (
          event.kind === "after-damage"
          && event.target.side === input.ownerSide
          && event.barrierAbsorbed > 0
          && appliesToPokemon(boon, event.target)
        ) {
          const key = pokemonKey(id, event.target.id, "stored");
          setNumber(key, numberAt(currentState(), key) + event.barrierAbsorbed);
          baseCommand("mark-trigger", {
            subjectId: event.target.id,
            amount: event.barrierAbsorbed,
            value: "barrier-damage-recorded",
          });
        } else if (event.kind === "barrier-ended" && appliesToPokemon(boon, event.target)) {
          const key = pokemonKey(id, event.target.id, "stored");
          const stored = numberAt(currentState(), key);
          if (!stored) {
            break;
          }
          if (event.broke) {
            const conversion = rankTwo(boon) ? 0.75 : 0.5;
            baseCommand("queue-next-move-power", {
              subjectId: event.target.id,
              amount: Math.min(stored * conversion, event.target.maxHp * conversion),
              data: {
                typelessBonusDamage: true,
                allEnemiesReduced: boon.evolutionId === "shattered-retort",
              },
            });
          } else if (boon.evolutionId === "tempered-glass") {
            baseCommand("heal", {
              subjectId: event.target.id,
              amount: stored * 0.5,
            });
            baseCommand("restore-pp", {
              subjectId: event.target.id,
              amount: Math.max(1, Math.floor(stored / Math.max(1, event.target.maxHp * 0.1))),
            });
          }
          setNumber(key, 0);
        }
        break;
      }
      case "deferred-pain": {
        const debtKeyFor = (pokemonId: number): string => `persistent:${id}:pokemon:${pokemonId}:debt`;
        const erasedKeyFor = (pokemonId: number): string => `persistent:${id}:pokemon:${pokemonId}:erased`;
        if (
          event.kind === "before-damage"
          && event.direct
          && event.target.side === input.ownerSide
          && appliesToPokemon(boon, event.target)
        ) {
          const deferredFraction = rankTwo(boon) ? 0.5 : 0.35;
          const debtKey = debtKeyFor(event.target.id);
          const currentDebt = numberAt(currentState(), debtKey);
          const addedDebt = Math.min(
            event.amount * deferredFraction,
            Math.max(0, event.target.maxHp * 0.5 - currentDebt),
          );
          baseCommand("split-damage", {
            subjectId: event.target.id,
            fraction: 1 - deferredFraction,
            data: { deferredFraction },
          });
          baseCommand("schedule-damage-debt", {
            subjectId: event.target.id,
            amount: addedDebt,
            data: { dueTurn: event.turn + 1 },
          });
          setNumber(debtKey, currentDebt + addedDebt);
          setNumber(`persistent:${id}:pokemon:${event.target.id}:due`, event.turn + 1);
        } else if (event.kind === "heal" && appliesToPokemon(boon, event.target)) {
          const debtKey = debtKeyFor(event.target.id);
          const debt = numberAt(currentState(), debtKey);
          const erased = Math.min(debt, event.amount);
          if (!erased) {
            break;
          }
          setNumber(debtKey, debt - erased);
          setNumber(erasedKeyFor(event.target.id), numberAt(currentState(), erasedKeyFor(event.target.id)) + erased);
          baseCommand("mark-trigger", {
            subjectId: event.target.id,
            amount: erased,
            value: "debt-erased",
          });
          if (debt === erased && boon.evolutionId === "collection-notice") {
            baseCommand("queue-next-move-power", {
              subjectId: event.target.id,
              amount: numberAt(currentState(), erasedKeyFor(event.target.id)),
              data: { basedOnDebtErased: true, typelessBonusDamage: true },
            });
          }
        } else if (event.kind === "turn-end") {
          for (const pokemonId of event.activePokemonIds) {
            const debt = numberAt(currentState(), debtKeyFor(pokemonId));
            const due = numberAt(currentState(), `persistent:${id}:pokemon:${pokemonId}:due`);
            if (debt > 0 && due <= event.turn) {
              baseCommand("collect-damage-debt", {
                subjectId: pokemonId,
                amount: debt,
                data: {
                  barriersMayAbsorb: boon.evolutionId === "debt-restructuring",
                },
              });
              setNumber(debtKeyFor(pokemonId), 0);
              setNumber(erasedKeyFor(pokemonId), 0);
            }
          }
        }
        break;
      }
    }
  }

  for (const rawCurse of input.curses) {
    if (!FIELD_CURSE_ID_SET.has(rawCurse.curseId)) {
      continue;
    }
    const curse = rawCurse as MoodyCurseInstance & {
      curseId: MoodyRuntimeFieldCurseId;
    };
    const id = curse.curseId;
    const curseCommand = (
      kind: MoodyRuntimeCommandKind,
      extra: Omit<MoodyRuntimeCommand, "kind" | "effectId"> = {},
    ): void => emit({ kind, effectId: id, ...extra });

    switch (id) {
      case "restless-lead":
        if (event.kind === "lead-selection") {
          const previousLead = valueAt(currentState(), `persistent:${id}:last-lead`, -1);
          if (previousLead === event.pokemonId) {
            curseCommand("invalidate-lead", { subjectId: event.pokemonId });
          } else {
            setValue(`persistent:${id}:last-lead`, event.pokemonId);
            curseCommand("mark-trigger", {
              subjectId: event.pokemonId,
              value: "lead-recorded",
            });
          }
        }
        break;
      case "type-tax":
        if (event.kind === "before-move" && event.user.side === input.ownerSide && event.damaging) {
          const duplicateCount = numberAt(currentState(), `persistent:${id}:type:${event.moveType}:duplicates`);
          if (duplicateCount > 0) {
            curseCommand("modify-damage", {
              subjectId: event.user.id,
              multiplier: Math.max(0, 1 - duplicateCount * 0.04),
            });
          }
        }
        break;
      case "slow-to-warm":
        if (
          event.kind === "before-move"
          && event.user.side === input.ownerSide
          && event.damaging
          && !valueAt(currentState(), pokemonKey(id, event.user.id, "used"), false)
        ) {
          curseCommand("modify-damage", {
            subjectId: event.user.id,
            multiplier: 0.85,
          });
          curseCommand("modify-speed", {
            subjectId: event.user.id,
            multiplier: 0.85,
          });
          setValue(pokemonKey(id, event.user.id, "used"), true);
        }
        break;
      case "fading-momentum":
        if (event.kind === "turn-end" && event.turn % 3 === 0) {
          for (const pokemonId of event.activePokemonIds) {
            curseCommand("modify-stat", {
              subjectId: pokemonId,
              amount: -1,
              value: "seeded-positive-stage",
            });
          }
        }
        break;
      case "exposed-flank":
        if (
          event.kind === "before-damage"
          && event.direct
          && event.target.side === input.ownerSide
          && !valueAt(currentState(), pokemonKey(id, event.target.id, "used"), false)
        ) {
          curseCommand("modify-damage", {
            subjectId: event.target.id,
            multiplier: 1.15,
          });
          setValue(pokemonKey(id, event.target.id, "used"), true);
        }
        break;
      case "accumulated-fatigue":
        if (event.kind === "battle-end") {
          const entered = new Set(event.enteredPokemonIds);
          for (const pokemon of event.party) {
            const key = `persistent:${id}:pokemon:${pokemon.id}:waves`;
            setNumber(key, entered.has(pokemon.id) ? numberAt(currentState(), key) + 1 : 0);
          }
          curseCommand("mark-trigger", { value: "fatigue-updated" });
        } else if (
          event.kind === "before-move"
          && event.user.side === input.ownerSide
          && numberAt(currentState(), `persistent:${id}:pokemon:${event.user.id}:waves`) >= 3
        ) {
          curseCommand("modify-damage", {
            subjectId: event.user.id,
            multiplier: 0.85,
          });
        }
        break;
      case "shared-pain":
        if (event.kind === "after-damage" && event.direct && event.target.side === input.ownerSide) {
          curseCommand("nonlethal-damage", {
            amount: event.amount * 0.1,
            data: { target: "lowest-hp-benched-ally", minimumHp: 1 },
          });
        }
        break;
      case "no-retreat":
        if (event.kind === "move-resolved" && event.user.side === input.ownerSide && event.damaging) {
          setNumber(pokemonKey(id, event.user.id, "until-turn"), event.turn + 3);
          curseCommand("lock-switching", {
            subjectId: event.user.id,
            durationTurns: 3,
          });
        } else if (
          event.kind === "switch-attempt"
          && event.voluntary
          && numberAt(currentState(), pokemonKey(id, event.pokemon.id, "until-turn")) > event.turn
        ) {
          curseCommand("prevent-switch", { subjectId: event.pokemon.id });
        } else if (event.kind === "faint") {
          setNumber(battleKey(id, "faint-turn"), event.turn);
          curseCommand("mark-trigger", {
            value: "switch-locks-cleared-by-faint",
          });
        }
        break;
      case "fog-of-war":
        if (event.kind === "encounter-generate") {
          curseCommand("hide-enemy-information", {
            data: { fields: ["moves", "abilities", "items", "boon-targets"] },
          });
        }
        break;
      case "withering-pp":
        if (event.kind === "move-resolved" && event.user.side === input.ownerSide) {
          const key = battleKey(id, "uses");
          const uses = numberAt(currentState(), key) + 1;
          setNumber(key, uses);
          if (uses % 4 === 0) {
            curseCommand("consume-extra-pp", {
              subjectId: event.user.id,
              amount: 1,
            });
          }
        }
        break;
      case "brittle-weakness":
        if (event.kind === "before-damage" && event.target.side === input.ownerSide && event.superEffective) {
          curseCommand("modify-damage", {
            subjectId: event.target.id,
            multiplier: 1.2,
          });
        }
        break;
      case "oathbound":
        if (event.kind === "faint" && curse.target?.pokemonIds?.includes(event.pokemon.id)) {
          for (const ally of event.otherConsciousAllies) {
            curseCommand("nonlethal-damage", {
              subjectId: ally.id,
              fraction: 0.2,
              data: { basis: "current-hp" },
            });
          }
          if (event.activeEnemy) {
            curseCommand("modify-stat", {
              subjectId: event.activeEnemy.id,
              amount: 1,
              value: "speed",
            });
          }
        }
        break;
      case "sweeper-s-tax":
        if (event.kind === "ko" && event.actor.side === input.ownerSide) {
          const actorKey = battleKey(id, "actor");
          const countKey = battleKey(id, "count");
          const sameActor = valueAt(currentState(), actorKey, -1) === event.actor.id;
          const count = sameActor ? numberAt(currentState(), countKey) + 1 : 1;
          setValue(actorKey, event.actor.id);
          setNumber(countKey, count);
          curseCommand("nonlethal-damage", {
            subjectId: event.actor.id,
            fraction: 0.15 * count,
            data: { basis: "max-hp" },
          });
          if (count >= 2) {
            curseCommand("modify-stat", {
              subjectId: event.actor.id,
              amount: -1,
              value: "speed",
            });
          }
        }
        break;
      case "public-enemy":
        if (event.kind === "encounter-generate" && event.isTrainer) {
          curseCommand("set-enemy-roster-size", {
            amount: Math.max(event.baseRosterSize, 7 + deterministicIndex(event.seed, id, 2)),
          });
        }
        if (
          event.kind === "faint"
          && event.isBoss
          && event.finalEnemyPokemon
          && event.pokemon.side !== input.ownerSide
          && !valueAt(currentState(), battleKey(id, "second-act-used"), false)
        ) {
          curseCommand("revive", {
            subjectId: event.pokemon.id,
            fraction: 1,
            data: { healthSegments: 1, allStats: 1 },
          });
          setValue(battleKey(id, "second-act-used"), true);
        }
        break;
      case "mood-swing":
        if (event.kind === "battle-start" && event.waveIndex % 10 === 0) {
          const count = event.waveIndex >= 100 ? 2 : 1;
          const available = input.boons
            .filter(boon => !boon.dormant)
            .map(boon => boon.instanceId)
            .sort();
          const start = deterministicIndex(event.seed, id, Math.max(available.length, 1));
          const selected = available.concat(available).slice(start, start + Math.min(count, available.length));
          curseCommand("set-boon-dormancy", { options: selected, value: true });
          setList(`persistent:${id}:dormant`, selected);
        }
        break;
      case "nemesis-protocol":
        if (event.kind === "encounter-generate") {
          curseCommand("set-counter-weight", {
            multiplier: event.isBoss ? 2 : 1.5,
            ...(event.playerThreatPokemonId == null ? {} : { subjectId: event.playerThreatPokemonId }),
          });
        }
        break;
      case "blood-moon":
        if (
          event.kind === "battle-won"
          && event.party.length > 0
          && event.party.every(pokemon => pokemon.side !== input.ownerSide && pokemon.fainted)
          && !valueAt(currentState(), battleKey(id, "used"), false)
        ) {
          curseCommand("revive", {
            targetIds: event.party.map(pokemon => pokemon.id),
            fraction: 0.25,
            data: {
              clearNegativeStages: true,
              clearMajorStatus: true,
              restoreItems: false,
            },
          });
          setValue(battleKey(id, "used"), true);
        }
        break;
      case "reverse-snowball":
        if (event.kind === "encounter-generate") {
          curseCommand("apply-enemy-stat-multiplier", {
            multiplier: Math.min(1.3, 1 + event.noFaintWinStreak * 0.03),
          });
        }
        if (event.kind === "battle-won") {
          const reset = event.alliedFaints > event.party.length / 2;
          const currentStreak = numberAt(currentState(), `persistent:${id}:streak`);
          const nextStreak = reset ? 0 : event.alliedFaints === 0 ? currentStreak + 1 : currentStreak;
          setNumber(`persistent:${id}:streak`, nextStreak);
          curseCommand("mark-trigger", {
            value: reset ? "streak-reset" : event.alliedFaints === 0 ? "streak-increased" : "streak-held",
          });
        }
        break;
      case "cursed-draft":
        if (event.kind === "boon-draft" && event.offerIds.length > 0) {
          curseCommand("conceal-boon-offer", {
            value: event.offerIds[deterministicIndex(event.seed, id, event.offerIds.length)],
          });
        }
        break;
      case "entropy":
        if (event.kind === "biome-transition") {
          for (const pokemon of event.party) {
            const candidates = event.replacementMoveCandidates[pokemon.id] ?? [];
            const moveIds = pokemon.moveIds;
            if (candidates.length === 0 || moveIds == null || moveIds.length === 0) {
              continue;
            }
            const moveIndex = deterministicIndex(event.seed, `${id}:move:${pokemon.id}`, moveIds.length);
            const replacementIndex = deterministicIndex(
              event.seed,
              `${id}:replacement:${pokemon.id}`,
              candidates.length,
            );
            curseCommand("replace-move-temporarily", {
              subjectId: pokemon.id,
              value: moveIds[moveIndex],
              data: {
                replacementMoveId: candidates[replacementIndex],
                untilNextBiome: true,
              },
            });
          }
        }
        break;
      case "feedback-loop":
        if (event.kind === "action-resolved" && event.actor.side === input.ownerSide && event.boonTriggerCount > 1) {
          const count = event.boonTriggerCount;
          const fraction = count >= 2 ? 0.04 + (count >= 3 ? 0.06 : 0) + Math.max(0, count - 3) * 0.08 : 0;
          curseCommand("nonlethal-damage", {
            subjectId: event.actor.id,
            fraction,
            data: { basis: "max-hp", minimumHp: 1, triggerCount: count },
          });
        }
        break;
    }
  }

  return {
    state: { numbers, values, lists },
    deltas,
    commands,
    triggeredEffectIds: triggered,
  };
}

export function assertMoodyRuntimeFieldCoverage(): void {
  const catalogBoonIds = MOODY_BOONS.filter(definition => definition.number >= 38 && definition.number <= 71).map(
    definition => definition.id,
  );
  const requestedCurseNumbers = new Set(MOODY_RUNTIME_FIELD_COVERAGE.curseNumbers);
  const catalogCurseIds = MOODY_CURSES.filter(definition => requestedCurseNumbers.has(definition.number)).map(
    definition => definition.id,
  );
  if (catalogBoonIds.join("|") !== MOODY_RUNTIME_FIELD_BOON_IDS.join("|")) {
    throw new Error(`Moody runtime field boon coverage drift: ${catalogBoonIds.join(",")}`);
  }
  if (catalogCurseIds.join("|") !== MOODY_RUNTIME_FIELD_CURSE_IDS.join("|")) {
    throw new Error(`Moody runtime field curse coverage drift: ${catalogCurseIds.join(",")}`);
  }
  for (const boonId of MOODY_RUNTIME_FIELD_BOON_IDS) {
    const variants = MOODY_RUNTIME_FIELD_VARIANTS[boonId];
    if (
      !variants?.base
      || !variants.rankTwo
      || variants.evolutionIds.length === 0
      || variants.evolutionIds.length > 2
    ) {
      throw new Error(`Moody runtime field variant coverage incomplete: ${boonId}`);
    }
  }
}

assertMoodyRuntimeFieldCoverage();
