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

export interface InterBeatOverride {
  atWaveOffset: 1 | 2;
  trainerOverride?: { speciesSwaps?: number[]; levelDelta?: number };
  biomeFlavorText?: string;
}

export interface ConsequenceItem {
  modifierType: string;
  qty: number;
}

export interface NpcMemory {
  disposition?: string;
  notes?: string;
}

export interface Consequence {
  alignment?: number;
  factionRep?: Record<string, number>;
  items?: ConsequenceItem[];
  money?: number;
  flags?: Record<string, boolean>;
  npcMemoryUpdate?: Record<string, Partial<NpcMemory>>;
  queuedBeats?: Array<{ atWaveOffset: number; tag: string }>;
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
  speaker?: { name: string; memoryKey?: string };
  options: DialogueChoiceOption[];
}

export interface TrainerBattleBeat extends BeatBase {
  type: "trainer_battle";
  trainerName: string;
  trainerType: number;
  speciesSwaps?: number[];
  levelDelta?: number;
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

const interBeatOverrideSchema = {
  type: "object",
  required: ["atWaveOffset"],
  properties: {
    atWaveOffset: { type: "integer", enum: [1, 2] },
    trainerOverride: {
      type: "object",
      properties: {
        speciesSwaps: { type: "array", items: { type: "integer" } },
        levelDelta: { type: "integer" },
      },
      additionalProperties: false,
    },
    biomeFlavorText: { type: "string" },
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
    /** 1-2 sentences explaining who the player is in this story. Max ~200 chars. */
    playerIntro: { type: "string", minLength: 1, maxLength: 300 },
    /** 1-2 sentences setting the opening scene for wave 1. Max ~200 chars. */
    openingScene: { type: "string", minLength: 1, maxLength: 300 },
    tonalKeywords: { type: "array", items: { type: "string" }, minItems: 1 },
    acts: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        required: ["name", "waveStart", "waveEnd", "summary"],
        properties: {
          name: { type: "string" },
          waveStart: { type: "integer" },
          waveEnd: { type: "integer" },
          summary: { type: "string" },
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
  acts: Array<{ name: string; waveStart: number; waveEnd: number; summary: string }>;
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
