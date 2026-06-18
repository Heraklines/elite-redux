/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Quiz/Minigame engine (#439 biome overhaul) - DATA layer.
//
// One reusable question bank powers a whole family of knowledge events (the Town
// Guessing Booth, the Professor's Scrambled Pokedex, the Snowy Forest footprint
// hunt, etc.). Question kinds:
//   - "silhouette": render a Pokemon sprite as a black silhouette (the UI does
//                   the tint); the player names it from the choices.
//   - "dex":        show the Pokedex flavor text (from er-dex-flavor.json, with
//                   the species' own name already redacted at bake time); the
//                   player names it from the choices.
//   - "footprint":  show the species' FOOTPRINT sprite (er-assets, per slug); the
//                   player names whose tracks they are. Falls back to a silhouette
//                   in the UI when a species ships no footprint art.
//
// Candidate pool = the species that ship with dex flavor text (national dex
// 1..898, clean vanilla names + loadable sprites). Questions are generated with
// the run RNG so they're deterministic within a seed.
// =============================================================================

import { modifierTypes } from "#data/data-lists";
import { randSeedInt, randSeedItem, randSeedShuffle } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import erDexFlavorRaw from "./er-dex-flavor.json";
import erFootprintIdsRaw from "./er-footprint-species.json";

const ER_DEX_FLAVOR = erDexFlavorRaw as Record<string, string>;

/**
 * National-dex ids that ship a bundled footprint sprite (public/footprints/<id>.png,
 * extracted from the decomp by scripts/elite-redux/copy-footprints.mjs). Footprint
 * art only exists for the Gen 1-5-era roster, so this list IS the footprint-quiz
 * candidate pool - a species without one can never be asked or offered.
 */
const ER_FOOTPRINT_IDS = new Set<number>(erFootprintIdsRaw as number[]);

//   - "cipher":     the Unown Cipher (Ruins / Sealed Door). A WORD is spelled out
//                   in Unown letters (Unown forms A-Z); the player decodes it and
//                   picks the matching word from the choices. Answer + options are
//                   WORDS (not species), and the figure is a row of Unown icons.
//   - "braille":    the Dormant Guardian seal (Ruins). The same short word bank as
//                   "cipher", but spelled in raised Unicode BRAILLE dot-cells in
//                   the text prompt (no glyph sprites); the player reads it and
//                   picks the matching word. Answer + options are WORDS.
//   - "item":       the Salvage Yard scrap heap (Factory). A held ITEM is shown as
//                   a black silhouette (its icon from the boot-loaded "items"
//                   atlas, tinted by the UI); the player names the part from the
//                   choices. Answer + options are ITEM names; each question carries
//                   the item's modifierTypes key so the encounter can grant the
//                   parts the player correctly identifies.
export type ErQuizKind = "silhouette" | "dex" | "footprint" | "cipher" | "braille" | "item";

export interface ErQuizQuestion {
  kind: ErQuizKind;
  /** National-dex id of the correct answer (sprite/dex kinds); -1 for "cipher". */
  answerId: number;
  /** The answer + distractors species ids, already shuffled (empty for "cipher"). */
  options: number[];
  /** Dex flavor text for "dex" questions; empty for the other kinds. */
  prompt: string;
  /** "cipher" only: the answer WORD spelled out in Unown letters. */
  cipherWord?: string;
  /** "cipher" only: the shuffled word options (answer + distractors) = the labels. */
  cipherOptions?: string[];
  /** "item" only: the correct item's icon frame in the boot-loaded "items" atlas. */
  itemIconFrame?: string;
  /** "item" only: the correct item's localized display name (the answer label). */
  itemName?: string;
  /** "item" only: the correct item's modifierTypes key (so the encounter can grant it). */
  itemId?: string;
  /** "item" only: the shuffled item-name options (answer + distractors) = the labels. */
  itemOptions?: string[];
}

/**
 * The Unown Cipher word bank: A-Z-only words (4-7 letters) that read as ancient-
 * ruins inscriptions. Every letter maps to an Unown form (A=0..Z=25), so the word
 * renders cleanly as a row of Unown glyph icons. Grouped loosely by length so a
 * question can draw SAME-LENGTH distractors (otherwise the odd-length-out option
 * gives the answer away). Kept large for variety so a run rarely repeats.
 */
const ER_CIPHER_WORDS: readonly string[] = [
  // 4 letters
  "RUNE", "OMEN", "TOMB", "GOLD", "KING", "VOID", "SAGE", "WING", "FANG", "RITE",
  "OATH", "DUSK", "SOUL", "WARD", "TOME", "IDOL", "SEAL", "PACT", "BANE", "DOOM",
  "GATE", "HALL", "MASK", "JADE", "ONYX", "RUST", "DUST", "MOSS", "VINE", "TIDE",
  "GALE", "WISP", "HUSK", "MAZE", "VEIL", "HORN", "CLAW", "ROAR", "HOWL", "ICON",
  // 5 letters
  "POWER", "RELIC", "VAULT", "RUINS", "GLYPH", "CURSE", "CRYPT", "GHOST", "EMBER",
  "FROST", "STORM", "TITAN", "MAGMA", "STONE", "QUEEN", "BEAST", "VENOM", "FLAME",
  "LIGHT", "ABYSS", "CHARM", "GRAVE", "CROWN", "THORN", "BLOOD", "SLATE", "AMBER",
  "CORAL", "PEARL", "TOTEM", "VIGIL", "HAVEN", "WRATH", "SCALE", "TALON", "ASHEN",
  "RUNES", "OMENS", "IDOLS",
  // 6 letters
  "SHRINE", "TEMPLE", "SPIRIT", "LEGEND", "MYSTIC", "ORACLE", "SEALED", "DRAGON",
  "WRAITH", "CIPHER", "SECRET", "SACRED", "HOLLOW", "MARROW", "CAVERN", "TUNDRA",
  "GEYSER", "BASALT", "WARDEN", "SCROLL", "RELICS", "CRYPTS", "TITANS", "EMBERS",
  // 7 letters
  "OBELISK", "PHANTOM", "TEMPEST", "ANCIENT", "CRYSTAL", "SERPENT", "WARLOCK", "SCEPTER",
];

/** A loaded-asset descriptor for a species' footprint sprite. */
export interface ErFootprintAsset {
  /** Phaser texture key the phase/UI use for this footprint image. */
  key: string;
  /** Cache-busted runtime URL of the footprint PNG. */
  url: string;
}

/**
 * The footprint texture key + runtime URL for a species, or undefined if no
 * footprint sprite is bundled for it. The URL is `images/footprints/<id>.png`,
 * which the deploy redirects to the er-assets CDN (jsDelivr) like every other
 * sprite - so footprints are served off-Cloudflare (no bandwidth-quota cost),
 * NOT bundled into the app. (Requires the er-assets pin to include them.)
 */
export function getErFootprintAsset(speciesId: number): ErFootprintAsset | undefined {
  if (!ER_FOOTPRINT_IDS.has(speciesId)) {
    return undefined;
  }
  return { key: `er_footprint__${speciesId}`, url: `images/footprints/${speciesId}.png` };
}

/**
 * The species the quiz can ask about: those with shipped dex flavor text,
 * filtered to ids that resolve to a real species. Computed LAZILY and memoized -
 * this module is imported during early init (encounters/scenarios) BEFORE the
 * species data is registered, so building the pool at module-load time would
 * filter everything out (getPokemonSpecies not ready) and yield an empty quiz.
 */
let cachedQuizSpeciesIds: number[] | null = null;
function quizSpeciesIds(): number[] {
  if (cachedQuizSpeciesIds === null) {
    cachedQuizSpeciesIds = Object.keys(ER_DEX_FLAVOR)
      .map(Number)
      .filter(id => {
        try {
          return !!getPokemonSpecies(id);
        } catch {
          return false;
        }
      });
  }
  return cachedQuizSpeciesIds;
}

/**
 * The species a FOOTPRINT question can ask about: those that ship a bundled
 * footprint sprite AND resolve to a real, vanilla-named species (national dex
 * 1..1025, so option labels stay clean). Memoized for the same early-init reason
 * as {@linkcode quizSpeciesIds}.
 */
/** Footprint sprites are canon only through Gen 5 (#649, Genesect); Gen 6+ never
 * had them, and the decomp only auto-generated placeholder prints for those. Cap
 * the pool here so every answer and distractor is a real Gen 1-5 footprint. */
const LAST_FOOTPRINT_DEX_ID = 649;
let cachedFootprintSpeciesIds: number[] | null = null;
function footprintSpeciesIds(): number[] {
  if (cachedFootprintSpeciesIds === null) {
    cachedFootprintSpeciesIds = [...ER_FOOTPRINT_IDS].filter(id => {
      if (id > LAST_FOOTPRINT_DEX_ID) {
        return false;
      }
      try {
        return !!getPokemonSpecies(id);
      } catch {
        return false;
      }
    });
  }
  return cachedFootprintSpeciesIds;
}

/** The candidate species pool for a question kind. */
function quizPool(kind: ErQuizKind): number[] {
  return kind === "footprint" ? footprintSpeciesIds() : quizSpeciesIds();
}

/** Dex flavor text for a species, or undefined if none shipped. */
export function getErDexFlavor(speciesId: number): string | undefined {
  return ER_DEX_FLAVOR[String(speciesId)];
}

/**
 * Build one quiz question of the given kind, run-seeded. `optionCount` is the
 * total number of choices (the answer + N-1 distractors); defaults to 4, clamped
 * to 2..4 (the footprint hunt uses 3).
 */
/**
 * Build one Unown Cipher question: an answer WORD spelled in Unown letters plus
 * `optionCount-1` distractor words, all shuffled. answerId is unused (-1).
 */
function buildErCipherQuestion(optionCount: number, usePhrase = false): ErQuizQuestion {
  const distractorTarget = Math.max(1, Math.min(3, optionCount - 1));
  if (usePhrase) {
    // A longer FINAL puzzle: a two-word phrase. Distractors are other distinct
    // phrases (no same-length constraint - phrases vary in shape by design).
    const answer = randSeedItem([...ER_CIPHER_PHRASES]);
    const distractors = randSeedShuffle(ER_CIPHER_PHRASES.filter(p => p !== answer)).slice(0, distractorTarget);
    const cipherOptions = randSeedShuffle([answer, ...distractors]);
    return { kind: "cipher", answerId: -1, options: [], prompt: "", cipherWord: answer, cipherOptions };
  }
  const answer = randSeedItem(ER_CIPHER_WORDS);
  // Distractors MUST be the same length as the answer - otherwise the odd-one-out
  // length gives the answer away without reading the glyphs at all. Fall back to
  // any other word only if a length somehow lacks enough peers.
  const sameLength = ER_CIPHER_WORDS.filter(w => w.length === answer.length && w !== answer);
  const pool = sameLength.length >= distractorTarget ? sameLength : ER_CIPHER_WORDS.filter(w => w !== answer);
  const distractors = randSeedShuffle([...pool]).slice(0, distractorTarget);
  const cipherOptions = randSeedShuffle([answer, ...distractors]);
  return { kind: "cipher", answerId: -1, options: [], prompt: "", cipherWord: answer, cipherOptions };
}

/** Standard Braille letter cells A-Z (Unicode U+2801..), index 0='A'..25='Z'. */
const BRAILLE_CELLS = "⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵";

/**
 * Spell a word/phrase in spaced Unicode Braille cells. Spaces between words become
 * a wider gap (a triple space) so multi-word phrases read as separate words; any
 * other non-letter becomes a blank cell.
 */
function brailleEncode(text: string): string {
  return text
    .toUpperCase()
    .split(" ")
    .map(word =>
      [...word]
        .map(ch => {
          const i = ch.charCodeAt(0) - 65;
          return i >= 0 && i < 26 ? BRAILLE_CELLS[i] : "⠿";
        })
        .join(" "),
    )
    .join("   ");
}

/**
 * The A-Z Braille reference key, as 13 two-column lines ("A⠁ N⠝"), rendered beside
 * the Braille seal so the player can actually decode it (#542 - braille legend).
 */
export function getErBrailleLegendText(): string {
  const lines: string[] = [];
  for (let i = 0; i < 13; i++) {
    const left = String.fromCharCode(65 + i) + BRAILLE_CELLS[i];
    const right = String.fromCharCode(65 + 13 + i) + BRAILLE_CELLS[13 + i];
    lines.push(`${left} ${right}`);
  }
  return lines.join("\n");
}

/**
 * The Unown Cipher / Braille PHRASE bank: short two-word ruins inscriptions, each
 * word A-Z and <=7 letters so it renders as one tidy glyph row (and fits an answer
 * button). The LAST question of a round draws from here for a longer final puzzle.
 */
const ER_CIPHER_PHRASES: readonly string[] = [
  "ANCIENT TOMB",
  "SEALED VAULT",
  "STONE WARDEN",
  "HOLLOW CRYPT",
  "SACRED RELIC",
  "FROST CURSE",
  "DRAGON SOUL",
  "GOLDEN IDOL",
  "SHADOW PACT",
  "BURIED KING",
  "TITAN BANE",
  "BONE THRONE",
  "RUNED DOOR",
  "DARK OMEN",
  "LOST CROWN",
  "GHOST GATE",
];

/**
 * Build one Braille seal question: the same word bank as the Unown Cipher, but the
 * answer word is rendered as raised Braille dot-cells in the prompt (no sprites).
 */
function buildErBrailleQuestion(optionCount: number, usePhrase = false): ErQuizQuestion {
  const q = buildErCipherQuestion(optionCount, usePhrase);
  return { ...q, kind: "braille", prompt: brailleEncode(q.cipherWord ?? "") };
}

/**
 * The Salvage Yard scrap-heap item pool: recognizable held items that read as
 * distinct silhouettes AND are worth reclaiming. Each entry is a modifierTypes
 * key so the encounter can map a correctly-named part back to its reward func.
 */
const ER_ITEM_QUIZ_IDS: readonly string[] = [
  "QUICK_CLAW",
  "GRIP_CLAW",
  "WIDE_LENS",
  "SCOPE_LENS",
  "MULTI_LENS",
  "KINGS_ROCK",
  "LEFTOVERS",
  "SHELL_BELL",
  "FOCUS_BAND",
  "REVIVER_SEED",
  "SOOTHE_BELL",
  "GOLDEN_PUNCH",
  "BATON",
  "EVIOLITE",
  "MYSTICAL_ROCK",
];

/** A baked item descriptor for the item quiz: key + icon frame + display name. */
interface ErItemDescriptor {
  id: string;
  frame: string;
  name: string;
}

/**
 * The item-quiz pool, resolved to {id, frame, name} descriptors. Memoized and
 * built LAZILY for the same early-init reason as {@linkcode quizSpeciesIds}: the
 * modifier factories and i18n must be ready, which they are by quiz time but not
 * at module load. Any id that fails to resolve is skipped (never asked/offered).
 */
let cachedItemBank: ErItemDescriptor[] | null = null;
function itemBank(): ErItemDescriptor[] {
  if (cachedItemBank === null) {
    cachedItemBank = [];
    for (const id of ER_ITEM_QUIZ_IDS) {
      try {
        const func = (modifierTypes as Record<string, () => { iconImage: string; name: string }>)[id];
        if (!func) {
          continue;
        }
        const type = func();
        if (type?.iconImage && type.name) {
          cachedItemBank.push({ id, frame: type.iconImage, name: type.name });
        }
      } catch {
        // Skip any item whose factory throws (keeps the rest of the quiz usable).
      }
    }
  }
  return cachedItemBank;
}

/**
 * Build one Salvage Yard item question: the answer item (shown as a silhouette)
 * plus `optionCount-1` distinct distractor items, all name-labels shuffled.
 * answerId is unused (-1); the figure is the item's icon frame.
 */
function buildErItemQuestion(optionCount: number): ErQuizQuestion {
  const bank = itemBank();
  const answer = randSeedItem([...bank]);
  const distractorTarget = Math.max(1, Math.min(3, optionCount - 1));
  const distractors = randSeedShuffle(bank.filter(it => it.id !== answer.id)).slice(0, distractorTarget);
  const itemOptions = randSeedShuffle([answer.name, ...distractors.map(it => it.name)]);
  return {
    kind: "item",
    answerId: -1,
    options: [],
    prompt: "",
    itemIconFrame: answer.frame,
    itemName: answer.name,
    itemId: answer.id,
    itemOptions,
  };
}

/** The modifierTypes key for a quiz option name, or undefined if not a known item. */
export function erItemIdForName(name: string): string | undefined {
  return itemBank().find(it => it.name === name)?.id;
}

export function buildErQuizQuestion(kind: ErQuizKind, optionCount = 4, usePhrase = false): ErQuizQuestion {
  if (kind === "cipher") {
    return buildErCipherQuestion(optionCount, usePhrase);
  }
  if (kind === "braille") {
    return buildErBrailleQuestion(optionCount, usePhrase);
  }
  if (kind === "item") {
    return buildErItemQuestion(optionCount);
  }
  const pool = quizPool(kind);
  const answerId = pool[randSeedInt(pool.length)];

  const distractorTarget = Math.max(1, Math.min(3, optionCount - 1));
  const distractors = new Set<number>();
  // Guard the loop in case the pool is unexpectedly tiny.
  let guard = 0;
  while (distractors.size < distractorTarget && guard++ < 100) {
    const d = pool[randSeedInt(pool.length)];
    if (d !== answerId) {
      distractors.add(d);
    }
  }

  const options = randSeedShuffle([answerId, ...distractors]);
  const prompt = kind === "dex" ? (getErDexFlavor(answerId) ?? "") : "";
  return { kind, answerId, options, prompt };
}

/**
 * Build a sequence of `count` distinct-answer questions (no repeated answer
 * species within the round). Falls back to allowing repeats only if the pool is
 * somehow exhausted. `optionCount` is forwarded to each question.
 */
export function buildErQuizRound(kind: ErQuizKind, count: number, optionCount = 4): ErQuizQuestion[] {
  const out: ErQuizQuestion[] = [];
  // Dedup key: the WORD for cipher questions (answerId is always -1 there), else
  // the answer species id - so a round never repeats the same answer.
  const usedAnswers = new Set<string>();
  let guard = 0;
  while (out.length < count && guard++ < count * 50) {
    // The LAST question of a cipher/braille round is a longer two-word PHRASE for a
    // tougher finale (#542); earlier questions stay single words.
    const usePhrase = (kind === "cipher" || kind === "braille") && out.length === count - 1;
    const q = buildErQuizQuestion(kind, optionCount, usePhrase);
    const key =
      q.kind === "cipher" || q.kind === "braille"
        ? (q.cipherWord ?? "")
        : q.kind === "item"
          ? (q.itemId ?? "")
          : String(q.answerId);
    if (usedAnswers.has(key)) {
      continue;
    }
    usedAnswers.add(key);
    out.push(q);
  }
  return out;
}

/** The display name for a quiz option (species id -> localized name). */
export function erQuizOptionName(speciesId: number): string {
  try {
    return getPokemonSpecies(speciesId).getName();
  } catch {
    return "???";
  }
}
