import Ajv, { type ValidateFunction } from "ajv";

/**
 * Beat schema for LLM Director outputs.
 *
 * Mirrors the design doc § "Beat types (discriminated union)". Every LLM beat
 * response is validated against this schema; on failure the generator retries
 * with the validation error in the prompt, then falls back to a `narrative_only`
 * beat.
 */

export type BeatType = "narrative_only" | "dialogue_choice" | "trainer_battle" | "biome_transition" | "item_event";

/**
 * One LLM-authored Pokémon entry. Used in both `TrainerBattleBeat.enemyTeam`
 * (the beat's own trainer fight) and `InterBeatOverride.trainerOverride.enemyTeam`
 * (the in-between vanilla waves). Lets the LLM fully spec a trainer team:
 * species, level, ability, moves, held items.
 *
 * - speciesId: from gameBalanceCard.speciesCatalog (positive integer)
 * - level: optional override; defaults to the wave-curve level
 * - abilityId: optional, from gameBalanceCard.abilityCatalog
 * - moveIds: 0-4 entries from gameBalanceCard.moveCatalog
 * - heldItemKeys: 0-6 string keys (e.g., "LEFTOVERS", "FOCUS_BAND"); unknown
 *   keys are silently dropped at apply time. We use string keys (not ids)
 *   because PokéRogue's modifier system identifies held items by string.
 * - isBoss: enables segmented HP bars
 * - shiny / nickname: cosmetic flair for narrative consistency
 */
export interface AuthoredPokemon {
  speciesId: number;
  level?: number;
  abilityId?: number;
  moveIds?: number[];
  heldItemKeys?: string[];
  isBoss?: boolean;
  shiny?: boolean;
  nickname?: string;
}

export interface InterBeatOverride {
  atWaveOffset: 1 | 2;
  trainerOverride?: {
    /** Trainer-class id from gameBalanceCard.trainerTypeCatalog. Picks the
     * SPRITE for this wave. Use whenever the story implies a specific
     * faction/role (RANGER for "Concordat Ranger", BIKER for "street gang",
     * HEX_MANIAC for "cultist"). */
    trainerType?: number;
    speciesSwaps?: number[];
    levelDelta?: number;
    /** Full LLM-authored team for the upcoming trainer wave (1-6 entries). */
    enemyTeam?: AuthoredPokemon[];
  };
  biomeFlavorText?: string;
  /** Story-themed line spoken just before the battle starts. Max ~240 chars. */
  preBattleText?: string;
  /** Story-themed line shown after winning this wave. Max ~240 chars. */
  postWinText?: string;
  /** Story-themed line shown if the player loses this wave. Max ~240 chars. */
  postLossText?: string;
  /** Optional per-trainer name override for narrative consistency. */
  trainerName?: string;
  /** Items granted on victory (besides vanilla rewards). For caches, loot
   * drops, plot-relevant pickups. */
  victoryRewards?: ConsequenceItem[];
  /** Effects applied on victory — heal party, give XP, lose status, etc. */
  victoryEffects?: ConsequenceEffect[];
  /** Effects applied on defeat. */
  defeatEffects?: ConsequenceEffect[];
}

export interface ConsequenceItem {
  modifierType: string;
  qty: number;
}

export interface NpcMemory {
  disposition?: string;
  notes?: string;
}

/**
 * Targets a subset of the player's party for an effect.
 * - "all" (default for many effects): every party member
 * - "random": one randomly chosen party member (uses seeded RNG)
 * - { partyIndex }: 0-5 slot
 * - { species }: first match by species id
 */
export type TargetSpec = "all" | "random" | { partyIndex: number } | { species: number };

export type StatKey = "ATK" | "DEF" | "SPATK" | "SPDEF" | "SPD" | "ACC" | "EVA";
export type PermStatKey = "HP" | "ATK" | "DEF" | "SPATK" | "SPDEF" | "SPD";
export type StatusKey = "POISON" | "BURN" | "PARALYSIS" | "SLEEP" | "FREEZE" | "TOXIC";
export type WeatherKey = "RAIN" | "SUNNY" | "SANDSTORM" | "HAIL" | "FOG" | "HEAVY_RAIN" | "HARSH_SUN" | "STRONG_WINDS";
export type FieldEffectKey =
  | "TRICK_ROOM"
  | "LIGHT_SCREEN"
  | "REFLECT"
  | "TAILWIND"
  | "GRASSY_TERRAIN"
  | "ELECTRIC_TERRAIN"
  | "PSYCHIC_TERRAIN"
  | "MISTY_TERRAIN";
export type DurationKind = "next_battle" | "n_waves";
export type EggTierKey = "common" | "rare" | "epic" | "legendary";
export type VoucherKey = "REGULAR" | "PLUS" | "PREMIUM" | "GOLDEN";
export type BuffKind = "money_multiplier" | "exp_multiplier" | "item_drop_rate" | "shiny_rate";
export type DebuffKind = "money_multiplier" | "exp_multiplier" | "item_drop_rate";

/**
 * Discriminated union of every consequence effect the LLM can author. Each
 * variant is tagged by `type`. Some effects are applied end-to-end; others are
 * stubbed (logged + no-op) in v1 but exposed in the schema so the LLM has a
 * wide menu and the player still sees the narrative consequence via
 * `epilogueText` and `custom`-effect descriptions. See
 * `src/system/llm-director/beat-applier.ts` and
 * `src/phases/llm-director-beat-phase.ts#applyEffects`.
 */
export type ConsequenceEffect =
  // Heal / restore (positive)
  | { type: "heal_party_hp"; target?: TargetSpec; percentMaxHp: number }
  | { type: "heal_party_status"; target?: TargetSpec }
  | { type: "heal_party_pp"; target?: TargetSpec; percent: number }
  | { type: "heal_party_full"; target?: TargetSpec }
  | { type: "revive"; target?: TargetSpec; percentMaxHp?: number }
  | { type: "revive_all" }
  // Stat / progression (positive)
  | { type: "stat_boost_temp"; target?: TargetSpec; stat: StatKey; stages: number }
  | { type: "stat_boost_permanent"; target?: TargetSpec; stat: PermStatKey; stacks: number }
  | { type: "level_up"; target?: TargetSpec; levels: number }
  | { type: "give_xp"; target?: TargetSpec; amount: number }
  | { type: "evolve"; target?: TargetSpec }
  | { type: "friendship_boost"; target?: TargetSpec; amount: number }
  // Pokémon mechanics (mixed)
  | { type: "learn_move"; target?: TargetSpec; moveId: number; replaceIndex?: number }
  | { type: "forget_move"; target?: TargetSpec; moveSlot: number }
  | { type: "change_ability"; target?: TargetSpec; abilityId: number }
  | { type: "change_type"; target?: TargetSpec; type1: number; type2?: number }
  | { type: "change_form"; target?: TargetSpec; formIndex: number }
  | { type: "give_held_item"; target?: TargetSpec; modifierType: string }
  | { type: "remove_held_item"; target?: TargetSpec; modifierType?: string }
  | { type: "tera_change"; target?: TargetSpec; teraType: number }
  | { type: "shiny_unlock"; target?: TargetSpec }
  // Inventory / economy
  | { type: "give_item"; modifierType: string; qty?: number }
  | { type: "remove_item"; modifierType: string; qty?: number }
  | { type: "give_money"; amount: number }
  | { type: "lose_money"; amount: number }
  | { type: "give_egg"; tier: EggTierKey }
  | { type: "lose_egg" }
  | { type: "give_voucher"; voucherType: VoucherKey }
  // Damage / status (negative)
  | { type: "status_inflict"; target?: TargetSpec; status: StatusKey }
  | { type: "damage_party"; target?: TargetSpec; percentMaxHp: number }
  | { type: "faint"; target: TargetSpec }
  | { type: "release_pokemon"; target: TargetSpec }
  | { type: "level_down"; target?: TargetSpec; levels: number }
  // Battle / encounter
  | {
      type: "trigger_battle";
      trainerType?: number;
      trainerName?: string;
      enemyTeam?: AuthoredPokemon[];
      preBattleText?: string;
      postWinText?: string;
      postLossText?: string;
      isDouble?: boolean;
    }
  | { type: "trigger_boss_battle"; enemyTeam: AuthoredPokemon[]; preBattleText?: string }
  | { type: "skip_wave"; count: number }
  | { type: "force_capture_chance"; target: TargetSpec }
  // Field / world
  | { type: "set_biome"; biomeId: number; flavorText?: string }
  | { type: "weather_change"; weather: WeatherKey; duration: DurationKind; waves?: number }
  | { type: "field_effect"; effect: FieldEffectKey; duration: DurationKind; waves?: number }
  | { type: "reveal_map_ahead"; waves: number }
  // Long-term modifiers
  | { type: "buff_persistent"; kind: BuffKind; multiplier: number; waves: number }
  | { type: "debuff_persistent"; kind: DebuffKind; multiplier: number; waves: number }
  // Custom (escape hatch)
  | { type: "custom"; description: string; severity?: "minor" | "major"; positive?: boolean };

export interface Consequence {
  alignment?: number;
  factionRep?: Record<string, number>;
  /**
   * Legacy item-grant shorthand. Equivalent to a single `give_item` effect.
   * Kept for backwards compatibility with existing beats. Prefer
   * `effects: [{ type: "give_item", ... }]` for new content.
   */
  items?: ConsequenceItem[];
  /**
   * Legacy money-multiplier shorthand. Equivalent to a single `give_money`
   * effect at wave-curve scaling. Prefer `effects: [{ type: "give_money" }]`.
   */
  money?: number;
  flags?: Record<string, boolean>;
  npcMemoryUpdate?: Record<string, Partial<NpcMemory>>;
  queuedBeats?: Array<{ atWaveOffset: number; tag: string }>;
  /**
   * The MAIN extension point in v2. Chain multiple effects per consequence so
   * the run feels rich (e.g., "drank the cursed potion" =
   * `[heal_party_full, status_inflict TOXIC, lose_money 500]`). Effects fire
   * in array order. Unknown / stubbed types log + no-op; `custom` surfaces
   * its description as a story message.
   */
  effects?: ConsequenceEffect[];
  epilogueText?: string;
  runEnd?: { reason: string; epilogueText: string };
}

export interface BeatBase {
  beatId: string;
  type: BeatType;
  introText: string;
  interBeatOverrides?: InterBeatOverride[];
}

export interface NarrativeOnlyBeat extends BeatBase {
  type: "narrative_only";
  bodyText: string;
}

export interface DialogueChoiceOption {
  label: string;
  consequence: Consequence;
}

export interface DialogueChoiceBeat extends BeatBase {
  type: "dialogue_choice";
  /**
   * Speaker for the encounter. `trainerType` is the numeric `TrainerType` enum
   * value (e.g. 13 for HARLEQUIN, 24 for RICH_KID). It drives the sprite shown
   * in the proper MysteryEncounter UI; if omitted we fall back to a generic
   * BACKPACKER sprite.
   */
  speaker?: { name: string; memoryKey?: string; trainerType?: number };
  options: DialogueChoiceOption[];
}

export interface TrainerBattleBeat extends BeatBase {
  type: "trainer_battle";
  trainerName: string;
  trainerType: number;
  speciesSwaps?: number[];
  levelDelta?: number;
  /** Full LLM-authored team for THIS beat's trainer encounter (1-6 entries).
   * Applied to the next wave's trainer encounter via the inter-beat override
   * pipeline. */
  enemyTeam?: AuthoredPokemon[];
  difficultyTag?: "easy" | "normal" | "hard" | "brutal";
  preBattleText: string;
  postWinText: string;
  postLossText?: string;
  rewardOverride?: { tier: string; modifierType?: string };
}

export interface BiomeTransitionOption {
  biomeId: number;
  flavorText: string;
  consequence?: Consequence;
}

export interface BiomeTransitionBeat extends BeatBase {
  type: "biome_transition";
  options: BiomeTransitionOption[];
}

export interface ItemEventBeat extends BeatBase {
  type: "item_event";
  consequence: Consequence;
}

export type Beat = NarrativeOnlyBeat | DialogueChoiceBeat | TrainerBattleBeat | BiomeTransitionBeat | ItemEventBeat;

// AuthoredPokemon and enemyTeam schemas are referenced from a few effect
// variants below (`trigger_battle`, `trigger_boss_battle`). Forward-declared
// before consequenceSchema so the references resolve at compile time of the
// AJV schema; the actual AJV schema objects are defined further down.
const targetSpecSchema = {
  oneOf: [
    { type: "string", enum: ["all", "random"] },
    {
      type: "object",
      required: ["partyIndex"],
      properties: { partyIndex: { type: "integer", minimum: 0, maximum: 5 } },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["species"],
      properties: { species: { type: "integer", minimum: 1 } },
      additionalProperties: false,
    },
  ],
} as const;

const STAT_KEYS = ["ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"] as const;
const PERM_STAT_KEYS = ["HP", "ATK", "DEF", "SPATK", "SPDEF", "SPD"] as const;
const STATUS_KEYS = ["POISON", "BURN", "PARALYSIS", "SLEEP", "FREEZE", "TOXIC"] as const;
const WEATHER_KEYS = ["RAIN", "SUNNY", "SANDSTORM", "HAIL", "FOG", "HEAVY_RAIN", "HARSH_SUN", "STRONG_WINDS"] as const;
const FIELD_EFFECT_KEYS = [
  "TRICK_ROOM",
  "LIGHT_SCREEN",
  "REFLECT",
  "TAILWIND",
  "GRASSY_TERRAIN",
  "ELECTRIC_TERRAIN",
  "PSYCHIC_TERRAIN",
  "MISTY_TERRAIN",
] as const;
const DURATION_KINDS = ["next_battle", "n_waves"] as const;
const EGG_TIERS = ["common", "rare", "epic", "legendary"] as const;
const VOUCHER_KEYS = ["REGULAR", "PLUS", "PREMIUM", "GOLDEN"] as const;
const BUFF_KINDS = ["money_multiplier", "exp_multiplier", "item_drop_rate", "shiny_rate"] as const;
const DEBUFF_KINDS = ["money_multiplier", "exp_multiplier", "item_drop_rate"] as const;

/** AJV schema for ConsequenceEffect — one branch per effect type. */
const consequenceEffectSchema = {
  oneOf: [
    // Heal / restore
    {
      type: "object",
      required: ["type", "percentMaxHp"],
      properties: {
        type: { const: "heal_party_hp" },
        target: targetSpecSchema,
        percentMaxHp: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type"],
      properties: {
        type: { const: "heal_party_status" },
        target: targetSpecSchema,
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "percent"],
      properties: {
        type: { const: "heal_party_pp" },
        target: targetSpecSchema,
        percent: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type"],
      properties: {
        type: { const: "heal_party_full" },
        target: targetSpecSchema,
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type"],
      properties: {
        type: { const: "revive" },
        target: targetSpecSchema,
        percentMaxHp: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type"],
      properties: { type: { const: "revive_all" } },
      additionalProperties: false,
    },
    // Stat / progression
    {
      type: "object",
      required: ["type", "stat", "stages"],
      properties: {
        type: { const: "stat_boost_temp" },
        target: targetSpecSchema,
        stat: { type: "string", enum: STAT_KEYS },
        stages: { type: "integer", minimum: 1, maximum: 6 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "stat", "stacks"],
      properties: {
        type: { const: "stat_boost_permanent" },
        target: targetSpecSchema,
        stat: { type: "string", enum: PERM_STAT_KEYS },
        stacks: { type: "integer", minimum: 1, maximum: 10 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "levels"],
      properties: {
        type: { const: "level_up" },
        target: targetSpecSchema,
        levels: { type: "integer", minimum: 1, maximum: 20 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "amount"],
      properties: {
        type: { const: "give_xp" },
        target: targetSpecSchema,
        amount: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type"],
      properties: {
        type: { const: "evolve" },
        target: targetSpecSchema,
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "amount"],
      properties: {
        type: { const: "friendship_boost" },
        target: targetSpecSchema,
        amount: { type: "integer", minimum: 1, maximum: 200 },
      },
      additionalProperties: false,
    },
    // Pokémon mechanics
    {
      type: "object",
      required: ["type", "moveId"],
      properties: {
        type: { const: "learn_move" },
        target: targetSpecSchema,
        moveId: { type: "integer", minimum: 0 },
        replaceIndex: { type: "integer", minimum: 0, maximum: 3 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "moveSlot"],
      properties: {
        type: { const: "forget_move" },
        target: targetSpecSchema,
        moveSlot: { type: "integer", minimum: 0, maximum: 3 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "abilityId"],
      properties: {
        type: { const: "change_ability" },
        target: targetSpecSchema,
        abilityId: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "type1"],
      properties: {
        type: { const: "change_type" },
        target: targetSpecSchema,
        type1: { type: "integer", minimum: 0 },
        type2: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "formIndex"],
      properties: {
        type: { const: "change_form" },
        target: targetSpecSchema,
        formIndex: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "modifierType"],
      properties: {
        type: { const: "give_held_item" },
        target: targetSpecSchema,
        modifierType: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type"],
      properties: {
        type: { const: "remove_held_item" },
        target: targetSpecSchema,
        modifierType: { type: "string", minLength: 1 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "teraType"],
      properties: {
        type: { const: "tera_change" },
        target: targetSpecSchema,
        teraType: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type"],
      properties: {
        type: { const: "shiny_unlock" },
        target: targetSpecSchema,
      },
      additionalProperties: false,
    },
    // Inventory / economy
    {
      type: "object",
      required: ["type", "modifierType"],
      properties: {
        type: { const: "give_item" },
        modifierType: { type: "string", minLength: 1 },
        qty: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "modifierType"],
      properties: {
        type: { const: "remove_item" },
        modifierType: { type: "string", minLength: 1 },
        qty: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "amount"],
      properties: {
        type: { const: "give_money" },
        amount: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "amount"],
      properties: {
        type: { const: "lose_money" },
        amount: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "tier"],
      properties: {
        type: { const: "give_egg" },
        tier: { type: "string", enum: EGG_TIERS },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type"],
      properties: { type: { const: "lose_egg" } },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "voucherType"],
      properties: {
        type: { const: "give_voucher" },
        voucherType: { type: "string", enum: VOUCHER_KEYS },
      },
      additionalProperties: false,
    },
    // Damage / status
    {
      type: "object",
      required: ["type", "status"],
      properties: {
        type: { const: "status_inflict" },
        target: targetSpecSchema,
        status: { type: "string", enum: STATUS_KEYS },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "percentMaxHp"],
      properties: {
        type: { const: "damage_party" },
        target: targetSpecSchema,
        percentMaxHp: { type: "integer", minimum: 1, maximum: 100 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "target"],
      properties: {
        type: { const: "faint" },
        target: targetSpecSchema,
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "target"],
      properties: {
        type: { const: "release_pokemon" },
        target: targetSpecSchema,
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "levels"],
      properties: {
        type: { const: "level_down" },
        target: targetSpecSchema,
        levels: { type: "integer", minimum: 1, maximum: 10 },
      },
      additionalProperties: false,
    },
    // Battle / encounter
    {
      type: "object",
      required: ["type"],
      properties: {
        type: { const: "trigger_battle" },
        trainerType: { type: "integer" },
        trainerName: { type: "string" },
        // enemyTeam shape inlined (matches authoredPokemonSchema below).
        enemyTeam: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: {
            type: "object",
            required: ["speciesId"],
            properties: {
              speciesId: { type: "integer", minimum: 1 },
              level: { type: "integer", minimum: 1, maximum: 200 },
              abilityId: { type: "integer", minimum: 0 },
              moveIds: { type: "array", maxItems: 4, items: { type: "integer", minimum: 0 } },
              heldItemKeys: { type: "array", maxItems: 6, items: { type: "string", minLength: 1 } },
              isBoss: { type: "boolean" },
              shiny: { type: "boolean" },
              nickname: { type: "string", maxLength: 20 },
            },
            additionalProperties: false,
          },
        },
        preBattleText: { type: "string", maxLength: 240 },
        postWinText: { type: "string", maxLength: 240 },
        postLossText: { type: "string", maxLength: 240 },
        isDouble: { type: "boolean" },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "enemyTeam"],
      properties: {
        type: { const: "trigger_boss_battle" },
        enemyTeam: {
          type: "array",
          minItems: 1,
          maxItems: 6,
          items: {
            type: "object",
            required: ["speciesId"],
            properties: {
              speciesId: { type: "integer", minimum: 1 },
              level: { type: "integer", minimum: 1, maximum: 200 },
              abilityId: { type: "integer", minimum: 0 },
              moveIds: { type: "array", maxItems: 4, items: { type: "integer", minimum: 0 } },
              heldItemKeys: { type: "array", maxItems: 6, items: { type: "string", minLength: 1 } },
              isBoss: { type: "boolean" },
              shiny: { type: "boolean" },
              nickname: { type: "string", maxLength: 20 },
            },
            additionalProperties: false,
          },
        },
        preBattleText: { type: "string", maxLength: 240 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "count"],
      properties: {
        type: { const: "skip_wave" },
        count: { type: "integer", minimum: 1, maximum: 5 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "target"],
      properties: {
        type: { const: "force_capture_chance" },
        target: targetSpecSchema,
      },
      additionalProperties: false,
    },
    // Field / world
    {
      type: "object",
      required: ["type", "biomeId"],
      properties: {
        type: { const: "set_biome" },
        biomeId: { type: "integer", minimum: 0 },
        flavorText: { type: "string", maxLength: 240 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "weather", "duration"],
      properties: {
        type: { const: "weather_change" },
        weather: { type: "string", enum: WEATHER_KEYS },
        duration: { type: "string", enum: DURATION_KINDS },
        waves: { type: "integer", minimum: 1, maximum: 30 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "effect", "duration"],
      properties: {
        type: { const: "field_effect" },
        effect: { type: "string", enum: FIELD_EFFECT_KEYS },
        duration: { type: "string", enum: DURATION_KINDS },
        waves: { type: "integer", minimum: 1, maximum: 30 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "waves"],
      properties: {
        type: { const: "reveal_map_ahead" },
        waves: { type: "integer", minimum: 1, maximum: 10 },
      },
      additionalProperties: false,
    },
    // Long-term modifiers
    {
      type: "object",
      required: ["type", "kind", "multiplier", "waves"],
      properties: {
        type: { const: "buff_persistent" },
        kind: { type: "string", enum: BUFF_KINDS },
        multiplier: { type: "number", minimum: 1.1, maximum: 3 },
        waves: { type: "integer", minimum: 1, maximum: 30 },
      },
      additionalProperties: false,
    },
    {
      type: "object",
      required: ["type", "kind", "multiplier", "waves"],
      properties: {
        type: { const: "debuff_persistent" },
        kind: { type: "string", enum: DEBUFF_KINDS },
        multiplier: { type: "number", minimum: 0.1, maximum: 0.9 },
        waves: { type: "integer", minimum: 1, maximum: 30 },
      },
      additionalProperties: false,
    },
    // Custom (escape hatch)
    {
      type: "object",
      required: ["type", "description"],
      properties: {
        type: { const: "custom" },
        description: { type: "string", minLength: 1, maxLength: 240 },
        severity: { type: "string", enum: ["minor", "major"] },
        positive: { type: "boolean" },
      },
      additionalProperties: false,
    },
  ],
} as const;

const consequenceSchema = {
  type: "object",
  properties: {
    alignment: { type: "integer", minimum: -10, maximum: 10 },
    factionRep: { type: "object", additionalProperties: { type: "integer" } },
    items: {
      type: "array",
      items: {
        type: "object",
        required: ["modifierType", "qty"],
        properties: {
          modifierType: { type: "string" },
          qty: { type: "integer" },
        },
        additionalProperties: false,
      },
    },
    money: { type: "integer" },
    flags: { type: "object", additionalProperties: { type: "boolean" } },
    npcMemoryUpdate: {
      type: "object",
      additionalProperties: {
        type: "object",
        properties: {
          disposition: { type: "string" },
          notes: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    queuedBeats: {
      type: "array",
      items: {
        type: "object",
        required: ["atWaveOffset", "tag"],
        properties: {
          atWaveOffset: { type: "integer" },
          tag: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    effects: {
      type: "array",
      maxItems: 12,
      items: consequenceEffectSchema,
    },
    epilogueText: { type: "string" },
    runEnd: {
      type: "object",
      required: ["reason", "epilogueText"],
      properties: {
        reason: { type: "string" },
        epilogueText: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const authoredPokemonSchema = {
  type: "object",
  required: ["speciesId"],
  properties: {
    speciesId: { type: "integer", minimum: 1 },
    level: { type: "integer", minimum: 1, maximum: 200 },
    abilityId: { type: "integer", minimum: 0 },
    moveIds: { type: "array", maxItems: 4, items: { type: "integer", minimum: 0 } },
    heldItemKeys: { type: "array", maxItems: 6, items: { type: "string", minLength: 1 } },
    isBoss: { type: "boolean" },
    shiny: { type: "boolean" },
    nickname: { type: "string", maxLength: 20 },
  },
  additionalProperties: false,
} as const;

const enemyTeamSchema = {
  type: "array",
  minItems: 1,
  maxItems: 6,
  items: authoredPokemonSchema,
} as const;

const consequenceItemSchema = {
  type: "object",
  required: ["modifierType", "qty"],
  properties: {
    modifierType: { type: "string", minLength: 1 },
    qty: { type: "integer", minimum: 1, maximum: 99 },
  },
  additionalProperties: false,
} as const;

const interBeatOverrideSchema = {
  type: "object",
  required: ["atWaveOffset"],
  properties: {
    atWaveOffset: { type: "integer", enum: [1, 2] },
    trainerOverride: {
      type: "object",
      properties: {
        trainerType: { type: "integer", minimum: 0 },
        speciesSwaps: { type: "array", items: { type: "integer" } },
        levelDelta: { type: "integer" },
        enemyTeam: enemyTeamSchema,
      },
      additionalProperties: false,
    },
    biomeFlavorText: { type: "string", maxLength: 240 },
    preBattleText: { type: "string", maxLength: 240 },
    postWinText: { type: "string", maxLength: 240 },
    postLossText: { type: "string", maxLength: 240 },
    trainerName: { type: "string", maxLength: 40 },
    victoryRewards: { type: "array", maxItems: 6, items: consequenceItemSchema },
    victoryEffects: { type: "array", maxItems: 6, items: consequenceEffectSchema },
    defeatEffects: { type: "array", maxItems: 6, items: consequenceEffectSchema },
  },
  additionalProperties: false,
} as const;

const baseProperties = {
  beatId: { type: "string", minLength: 1 },
  introText: { type: "string", minLength: 1 },
  interBeatOverrides: { type: "array", items: interBeatOverrideSchema },
} as const;

const narrativeOnlySchema = {
  type: "object",
  required: ["beatId", "type", "introText", "bodyText"],
  properties: {
    ...baseProperties,
    type: { const: "narrative_only" },
    bodyText: { type: "string", minLength: 1 },
  },
  additionalProperties: false,
} as const;

const dialogueChoiceSchema = {
  type: "object",
  required: ["beatId", "type", "introText", "options"],
  properties: {
    ...baseProperties,
    type: { const: "dialogue_choice" },
    speaker: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        memoryKey: { type: "string" },
        trainerType: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    options: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        required: ["label", "consequence"],
        properties: {
          label: { type: "string", minLength: 1 },
          consequence: consequenceSchema,
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

const trainerBattleSchema = {
  type: "object",
  required: ["beatId", "type", "introText", "trainerName", "trainerType", "preBattleText", "postWinText"],
  properties: {
    ...baseProperties,
    type: { const: "trainer_battle" },
    trainerName: { type: "string", minLength: 1 },
    trainerType: { type: "integer" },
    speciesSwaps: { type: "array", items: { type: "integer" } },
    levelDelta: { type: "integer" },
    enemyTeam: enemyTeamSchema,
    difficultyTag: { type: "string", enum: ["easy", "normal", "hard", "brutal"] },
    preBattleText: { type: "string", minLength: 1 },
    postWinText: { type: "string", minLength: 1 },
    postLossText: { type: "string" },
    rewardOverride: {
      type: "object",
      required: ["tier"],
      properties: {
        tier: { type: "string" },
        modifierType: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const biomeTransitionSchema = {
  type: "object",
  required: ["beatId", "type", "introText", "options"],
  properties: {
    ...baseProperties,
    type: { const: "biome_transition" },
    options: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      items: {
        type: "object",
        required: ["biomeId", "flavorText"],
        properties: {
          biomeId: { type: "integer" },
          flavorText: { type: "string", minLength: 1 },
          consequence: consequenceSchema,
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

const itemEventSchema = {
  type: "object",
  required: ["beatId", "type", "introText", "consequence"],
  properties: {
    ...baseProperties,
    type: { const: "item_event" },
    consequence: consequenceSchema,
  },
  additionalProperties: false,
} as const;

const beatSchema = {
  oneOf: [narrativeOnlySchema, dialogueChoiceSchema, trainerBattleSchema, biomeTransitionSchema, itemEventSchema],
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
const compiledBeatValidator: ValidateFunction = ajv.compile(beatSchema);

/**
 * Story bible schema (used by Task 8's generator). Defined here to keep all
 * Director schemas centralized.
 */
const storyBibleSchema = {
  type: "object",
  required: [
    "themeName",
    "blurb",
    "tonalKeywords",
    "acts",
    "factions",
    "recurringNPCs",
    "moralSpectrum",
    "playerIntro",
    "openingScene",
  ],
  properties: {
    themeName: { type: "string", minLength: 1 },
    blurb: { type: "string", minLength: 1 },
    /** ONE short sentence explaining who the player is. Max 100 chars (must fit one dialog page). */
    playerIntro: { type: "string", minLength: 1, maxLength: 110 },
    /** ONE short sentence setting the opening scene. Max 100 chars (must fit one dialog page). */
    openingScene: { type: "string", minLength: 1, maxLength: 110 },
    tonalKeywords: { type: "array", items: { type: "string" }, minItems: 1 },
    acts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["name", "waveStart", "waveEnd", "summary", "biomeId"],
        properties: {
          name: { type: "string" },
          waveStart: { type: "integer" },
          waveEnd: { type: "integer" },
          summary: { type: "string" },
          /** Biome the act takes place in (id from gameBalanceCard.biomeCatalog).
           * Game auto-switches to this biome when the act starts. */
          biomeId: { type: "integer", minimum: 0 },
        },
        additionalProperties: false,
      },
    },
    factions: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "description", "initialRep"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          initialRep: { type: "integer", minimum: -100, maximum: 100 },
        },
        additionalProperties: false,
      },
    },
    recurringNPCs: {
      type: "array",
      items: {
        type: "object",
        required: ["memoryKey", "name", "role", "initialDisposition"],
        properties: {
          memoryKey: { type: "string" },
          name: { type: "string" },
          role: { type: "string" },
          initialDisposition: { type: "string" },
        },
        additionalProperties: false,
      },
    },
    moralSpectrum: {
      type: "object",
      required: ["goodLabel", "evilLabel"],
      properties: {
        goodLabel: { type: "string" },
        evilLabel: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

const compiledStoryBibleValidator: ValidateFunction = ajv.compile(storyBibleSchema);

export interface StoryBible {
  themeName: string;
  blurb: string;
  /** 1-2 sentences explaining who the player is in this story. Shown at wave 1. */
  playerIntro: string;
  /** 1-2 sentences setting the opening scene. Shown at wave 1 right after playerIntro. */
  openingScene: string;
  tonalKeywords: string[];
  acts: Array<{ name: string; waveStart: number; waveEnd: number; summary: string; biomeId: number }>;
  factions: Array<{ name: string; description: string; initialRep: number }>;
  recurringNPCs: Array<{ memoryKey: string; name: string; role: string; initialDisposition: string }>;
  moralSpectrum: { goodLabel: string; evilLabel: string };
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

function formatErrors(validator: ValidateFunction): string {
  if (!validator.errors || validator.errors.length === 0) {
    return "unknown validation error";
  }
  return validator.errors
    .map(e => {
      const path = e.instancePath || "(root)";
      return `${path} ${e.message ?? ""}`.trim();
    })
    .join("; ");
}

/**
 * Validate an unknown payload against the beat discriminated union.
 *
 * The validator is permissive about unknown beat types: those will simply fail
 * `oneOf`. Required-field omissions surface as "must have required property X"
 * errors which the test suite matches via /required|missing/i.
 */
export function validateBeat(beat: unknown): ValidationResult {
  if (compiledBeatValidator(beat)) {
    return { ok: true };
  }
  return { ok: false, error: formatErrors(compiledBeatValidator) };
}

/**
 * Validate an unknown payload against the story bible schema.
 */
export function validateStoryBible(bible: unknown): ValidationResult {
  if (compiledStoryBibleValidator(bible)) {
    return { ok: true };
  }
  return { ok: false, error: formatErrors(compiledStoryBibleValidator) };
}
