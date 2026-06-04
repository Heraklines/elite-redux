/*
 * SPDX-FileCopyrightText: 2025-2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Elite Redux Phase C task C2: classify the 736 ER-custom abilities into the
 * 23 archetype primitives implemented in C1.
 *
 * For each ability with `archetype: "unknown"` in
 * `src/data/elite-redux/er-abilities.ts`, this script runs the description
 * through an ordered list of classifiers. The first matching classifier
 * claims the entry; unmatched entries fall through to the `bespoke` bucket.
 *
 * Emits `src/data/elite-redux/er-ability-archetypes.ts` mapping
 * `erAbilityId → { archetype, params }`. The actual wiring into
 * `allAbilities` (constructing `new Ability(...).attr(archetypePrim)`) is
 * deferred to a follow-up task — C2 just builds the data table.
 *
 * Prints a per-archetype coverage report to stdout.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { emitModule } from "./lib/emit.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ABILITIES_PATH = resolve(ROOT, "src/data/elite-redux/er-abilities.ts");
const OUT_PATH = resolve(ROOT, "src/data/elite-redux/er-ability-archetypes.ts");

// =============================================================================
// Domain vocabulary — reused across multiple classifiers below. Keep these in
// sync with cluster-archetypes.mjs (the clustering helper for the taxonomy).
// =============================================================================

const TYPE_NAMES = [
  "fire",
  "water",
  "grass",
  "electric",
  "elec",
  "ice",
  "fighting",
  "fight",
  "poison",
  "ground",
  "flying",
  "psychic",
  "bug",
  "rock",
  "ghost",
  "dragon",
  "dark",
  "steel",
  "fairy",
  "normal",
];
const TYPE_RE_SRC = TYPE_NAMES.join("|");

const STAT_NAME_MAP = {
  attack: "ATK",
  atk: "ATK",
  defense: "DEF",
  def: "DEF",
  "sp. atk": "SPATK",
  "sp.atk": "SPATK",
  "sp atk": "SPATK",
  spatk: "SPATK",
  "special attack": "SPATK",
  "sp. def": "SPDEF",
  "sp.def": "SPDEF",
  "sp def": "SPDEF",
  spdef: "SPDEF",
  "special defense": "SPDEF",
  speed: "SPD",
  spd: "SPD",
  accuracy: "ACC",
  evasion: "EVA",
};

const STATUS_NAME_MAP = {
  burn: "BURN",
  burns: "BURN",
  burned: "BURN",
  burning: "BURN",
  paralyze: "PARALYSIS",
  paralyzes: "PARALYSIS",
  paralyzed: "PARALYSIS",
  paralysis: "PARALYSIS",
  "badly poison": "TOXIC",
  "badly poisoned": "TOXIC",
  toxic: "TOXIC",
  poison: "POISON",
  poisons: "POISON",
  poisoned: "POISON",
  poisoning: "POISON",
  sleep: "SLEEP",
  sleeps: "SLEEP",
  asleep: "SLEEP",
  sleeping: "SLEEP",
  freeze: "FREEZE",
  freezes: "FREEZE",
  frozen: "FREEZE",
  frostbite: "FROSTBITE",
  frostbites: "FROSTBITE",
  frostbitten: "FROSTBITE",
  confuse: "CONFUSION",
  confuses: "CONFUSION",
  confused: "CONFUSION",
  confusion: "CONFUSION",
  infatuate: "INFATUATION",
  infatuates: "INFATUATION",
  infatuated: "INFATUATION",
  infatuation: "INFATUATION",
  drowsy: "DROWSY",
  bleed: "BLEED",
  bleeds: "BLEED",
  bleeding: "BLEED",
  flinch: "FLINCH",
  fear: "FEAR",
};

const WEATHER_NAME_MAP = {
  sun: "SUNNY",
  sunny: "SUNNY",
  "harsh sunlight": "SUNNY",
  rain: "RAIN",
  raining: "RAIN",
  hail: "HAIL",
  snow: "SNOW",
  snowing: "SNOW",
  sandstorm: "SANDSTORM",
  fog: "FOG",
};

const TERRAIN_NAME_MAP = {
  "electric terrain": "ELECTRIC",
  "grassy terrain": "GRASSY",
  "psychic terrain": "PSYCHIC",
  "misty terrain": "MISTY",
  "toxic terrain": "TOXIC",
};

const HAZARD_NAME_MAP = {
  spikes: "SPIKES",
  "toxic spikes": "TOXIC_SPIKES",
  "stealth rock": "STEALTH_ROCK",
  "stealth rocks": "STEALTH_ROCK",
  "sticky web": "STICKY_WEB",
};

const FLAG_NAME_MAP = {
  punching: "PUNCHING_MOVE",
  punch: "PUNCHING_MOVE",
  biting: "BITING_MOVE",
  bite: "BITING_MOVE",
  slashing: "SLICING_MOVE",
  slicing: "SLICING_MOVE",
  sound: "SOUND_BASED",
  "sound-based": "SOUND_BASED",
  pulse: "PULSE_MOVE",
  "pulse-based": "PULSE_MOVE",
  ball: "BALLBOMB_MOVE",
  bomb: "BALLBOMB_MOVE",
  dance: "DANCE_MOVE",
  wind: "WIND_MOVE",
  // ER-specific flags (string-only; downstream wiring resolves to enum values
  // once ER MoveFlags additions land).
  kicking: "KICKING_MOVE",
  kick: "KICKING_MOVE",
  hammer: "HAMMER_BASED",
  "hammer-based": "HAMMER_BASED",
  slamming: "HAMMER_BASED",
  arrow: "ARROW",
  archer: "ARROW",
  "mega launcher": "MEGA_LAUNCHER",
  "keen edge": "KEEN_EDGE",
  horn: "MIGHTY_HORN",
  drill: "MIGHTY_HORN",
  "iron fist": "IRON_FIST",
  "strong jaw": "STRONG_JAW",
  aura: "AURA_BASED",
  air: "AIR_BASED",
  "air-based": "AIR_BASED",
  wing: "AIR_BASED",
  bone: "BONE_BASED",
};

// =============================================================================
// Token-extraction helpers
// =============================================================================

/** @param {string} s */
function normalizeType(s) {
  const key = (s ?? "").toLowerCase().replace(/\.$/, "").trim();
  if (key === "elec" || key === "elec.") {
    return "ELECTRIC";
  }
  if (key === "fight") {
    return "FIGHTING";
  }
  return key.toUpperCase();
}

/** @param {string} s */
function normalizeStat(s) {
  return STAT_NAME_MAP[(s ?? "").toLowerCase().replace(/\.$/, "").trim()] ?? null;
}

/** @param {string} s */
function normalizeStatus(s) {
  return STATUS_NAME_MAP[(s ?? "").toLowerCase().trim()] ?? null;
}

/** @param {string} s */
function normalizeWeather(s) {
  return WEATHER_NAME_MAP[(s ?? "").toLowerCase().trim()] ?? null;
}

/** @param {string} s */
function normalizeTerrain(s) {
  const key = (s ?? "").toLowerCase().trim();
  if (TERRAIN_NAME_MAP[key]) {
    return TERRAIN_NAME_MAP[key];
  }
  // "Electric Terrain" → "ELECTRIC"; tolerate "Electric"-only references
  const stripped = key.replace(/\s+terrain$/, "").trim();
  return TERRAIN_NAME_MAP[`${stripped} terrain`] ?? null;
}

/** @param {string} s */
function normalizeHazard(s) {
  return HAZARD_NAME_MAP[(s ?? "").toLowerCase().trim()] ?? null;
}

/** @param {string} s */
function normalizeFlag(s) {
  return FLAG_NAME_MAP[(s ?? "").toLowerCase().trim()] ?? null;
}

/** Parse "1/3", "1/16", "1/4" → 0.333..., 0.0625, 0.25. */
function parseFraction(s) {
  const m = String(s).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (!m) {
    return null;
  }
  const num = Number(m[1]);
  const den = Number(m[2]);
  return den === 0 ? null : num / den;
}

/** Parse a 'N%' string into a 0-1 fraction. */
function parsePercent(s) {
  const m = String(s).match(/^([\d.]+)\s*%?$/);
  if (!m) {
    return null;
  }
  const v = Number(m[1]);
  return Number.isFinite(v) ? v / 100 : null;
}

// =============================================================================
// Classifiers — ordered list. First matching wins. Each `test` runs against
// the description; if it returns truthy, `extract` builds the params object.
// `extract` returning null/undefined still claims the entry but marks it as
// `paramsParseFailed` so the report flags it for review.
// =============================================================================

/**
 * @typedef {Object} Classifier
 * @property {string} archetype
 * @property {(desc: string, ability: AbilityDraft) => boolean} test
 * @property {(desc: string, ability: AbilityDraft) => Record<string, unknown> | null} extract
 */

/**
 * @typedef {Object} AbilityDraft
 * @property {number} id
 * @property {string} name
 * @property {string} description
 * @property {"vanilla"|"unknown"} archetype
 */

/** @type {Classifier[]} */
const CLASSIFIERS = [
  // ── 1. type-damage-boost ────────────────────────────────────────────────
  // Highest-priority: "Boosts X-type moves by Nx [, or Mx when below 1/3 HP]"
  // and the simpler "Boosts X-type moves by Nx" (Electrocytes, Combustion).
  // Also covers "Boosts Fight.-type moves by 1.2x..." (Fighter — abbreviated type).
  // Also covers "Boosts own X moves by Nx" / "Boosts own X-type moves by Nx".
  {
    archetype: "type-damage-boost",
    test: desc =>
      new RegExp(
        `Boosts?\\s+(?:the\\s+power\\s+of\\s+|own\\s+)?(${TYPE_RE_SRC})\\.?[- ]?(?:type\\s+)?moves?\\s+by\\s+[0-9.]+x`,
        "i",
      ).test(desc) || new RegExp(`Boosts?\\s+(?:own\\s+)?(${TYPE_RE_SRC})\\s+moves?\\s+by\\s+[0-9.]+x`, "i").test(desc),
    extract: desc => {
      const main =
        desc.match(
          new RegExp(
            `Boosts?\\s+(?:the\\s+power\\s+of\\s+|own\\s+)?(${TYPE_RE_SRC})\\.?-type\\s+moves?\\s+by\\s+([0-9.]+)x`,
            "i",
          ),
        ) ?? desc.match(new RegExp(`Boosts?\\s+(?:own\\s+)?(${TYPE_RE_SRC})\\s+moves?\\s+by\\s+([0-9.]+)x`, "i"));
      if (!main) {
        return null;
      }
      const type = normalizeType(main[1]);
      const multiplier = Number(main[2]);
      if (!type || !Number.isFinite(multiplier)) {
        return null;
      }
      const out = { type, multiplier };
      // Optional ", or Mx when [below|under] 1/3 HP"
      const lowHp = desc.match(/or\s+([0-9.]+)x\s+when\s+(?:below|under|at)\s+([\d/]+)\s+HP/i);
      if (lowHp) {
        const m = Number(lowHp[1]);
        const frac = parseFraction(lowHp[2]);
        if (Number.isFinite(m)) {
          out.lowHpMultiplier = m;
        }
        if (frac !== null) {
          out.lowHpThreshold = frac;
        }
      }
      // Optional recoil rider
      const recoil = desc.match(/([\d.]+)\s*%\s+recoil/i);
      if (recoil) {
        const r = parsePercent(recoil[1]);
        if (r !== null) {
          out.recoilPct = r;
        }
      }
      return out;
    },
  },

  // ── 2. type-damage-boost (sub-shape: "X-type moves deal Nx damage but have N% recoil") ──
  {
    archetype: "type-damage-boost",
    test: desc =>
      new RegExp(`(${TYPE_RE_SRC})-type\\s+moves?\\s+(?:are\\s+)?(?:deal|boosted)\\s+`, "i").test(desc)
      && /([\d.]+)\s*%\s+recoil/i.test(desc),
    extract: desc => {
      const m = desc.match(
        new RegExp(`(${TYPE_RE_SRC})-type\\s+moves?\\s+(?:are\\s+boosted\\s+by|deal)\\s+([\\d.]+)\\s*(?:x|%)`, "i"),
      );
      if (!m) {
        return null;
      }
      const type = normalizeType(m[1]);
      let multiplier = Number(m[2]);
      // "boosted by 35%" → 1.35x
      if (/%/.test(m[0])) {
        multiplier = 1 + multiplier / 100;
      }
      const recoilM = desc.match(/([\d.]+)\s*%\s+recoil/i);
      const recoilPct = recoilM ? parsePercent(recoilM[1]) : null;
      return { type, multiplier, ...(recoilPct === null ? {} : { recoilPct }) };
    },
  },

  // ── 3. flag-damage-boost ────────────────────────────────────────────────
  // "Boosts the power of <flag> moves by Nx" / "Boosts <flag> moves by Nx"
  // Also tolerates the "moves" word being absent when the flag is a hyphenated
  // form (e.g. Mighty Horn — "Boosts the power of horn and drill-based by 1.3x").
  {
    archetype: "flag-damage-boost",
    test: desc =>
      /Boosts?\s+(?:the\s+power\s+of\s+)?(?:[\w\s\-,]*\b)?(punching|biting|slashing|slicing|kicking|sound|sound-based|hammer|hammer-based|pulse|pulse-based|ball|bomb|dance|wind|kick|arrow|horn|drill|aura|air|air-based|wing|bone|drill-based)(?:[\w\s\-,]*)\s+by\s+[0-9.]+x/i.test(
        desc,
      ),
    extract: desc => {
      const m = desc.match(/Boosts?\s+(?:the\s+power\s+of\s+)?([\w\s\-,]+?)\s+by\s+([0-9.]+)x/i);
      if (!m) {
        return null;
      }
      // Strip trailing "moves" / "based" from the phrase so token extraction
      // doesn't see them.
      const phrase = m[1]
        .toLowerCase()
        .replace(/\s+moves?$/, "")
        .trim();
      let flag = null;
      // Try multi-word matches first (e.g. "mega launcher", "keen edge").
      for (const key of Object.keys(FLAG_NAME_MAP)) {
        if (key.includes(" ") && phrase.includes(key)) {
          flag = FLAG_NAME_MAP[key];
          break;
        }
      }
      if (!flag) {
        const tokens = phrase.split(/[\s,]+/).filter(Boolean);
        for (const t of tokens) {
          const f = normalizeFlag(t.replace(/-based$/, ""));
          if (f) {
            flag = f;
            break;
          }
        }
      }
      const multiplier = Number(m[2]);
      if (!flag || !Number.isFinite(multiplier)) {
        return null;
      }
      return { flag, multiplier };
    },
  },

  // ── 4. priority-modifier (HP-gated, type-keyed) ─────────────────────────
  // "X-type moves get +N priority at max HP" / "At full HP, gives +N priority to X-type moves"
  {
    archetype: "priority-modifier",
    test: desc =>
      new RegExp(
        `(${TYPE_RE_SRC})-type\\s+moves?\\s+get\\s+\\+\\d+\\s+priority\\s+(?:at\\s+max|at\\s+full)\\s+HP`,
        "i",
      ).test(desc)
      || new RegExp(
        `(?:at\\s+full\\s+HP|max\\s+HP|when\\s+at\\s+max\\s+HP)[^.]*?\\+\\d+\\s+priority[^.]*?(${TYPE_RE_SRC})-?type\\s+moves?`,
        "i",
      ).test(desc),
    extract: desc => {
      // Form A: "X-type moves get +N priority at max HP."
      const a = desc.match(
        new RegExp(
          `(${TYPE_RE_SRC})-type\\s+moves?\\s+get\\s+\\+?(\\d+)\\s+priority\\s+(?:at\\s+max|at\\s+full)\\s+HP`,
          "i",
        ),
      );
      if (a) {
        return {
          condition: { kind: "max-hp" },
          priority: Number(a[2]),
          filter: { type: normalizeType(a[1]) },
        };
      }
      // Form B: "At full HP, gives +N priority to its X-type moves."
      const b = desc.match(
        new RegExp(
          `(?:at\\s+full\\s+HP|max\\s+HP)[^.]*?\\+?(\\d+)\\s+priority[^.]*?(${TYPE_RE_SRC})-?type\\s+moves?`,
          "i",
        ),
      );
      if (b) {
        return {
          condition: { kind: "max-hp" },
          priority: Number(b[1]),
          filter: { type: normalizeType(b[2]) },
        };
      }
      return null;
    },
  },

  // ── 5. priority-modifier (HP-gated, flag-keyed) ─────────────────────────
  // "At full HP, gives +N priority to this Pokémon's punching moves."
  {
    archetype: "priority-modifier",
    test: desc =>
      /(?:at\s+full\s+HP|max\s+HP)[^.]*?\+\d+\s+priority[^.]*?(punching|biting|slashing|slicing|kicking|sound|sound-based|hammer|pulse|dance|wind|arrow|horn|drill|aura|air|wing|bone|keen edge|mega launcher|iron fist)\s+moves?/i.test(
        desc,
      ),
    extract: desc => {
      const m = desc.match(
        /(?:at\s+full\s+HP|max\s+HP)[^.]*?\+?(\d+)\s+priority[^.]*?(punching|biting|slashing|slicing|kicking|sound|sound-based|hammer|pulse|dance|wind|arrow|horn|drill|aura|air|wing|bone|keen edge|mega launcher|iron fist)\s+moves?/i,
      );
      if (!m) {
        return null;
      }
      const flag = normalizeFlag(m[2]);
      if (!flag) {
        return null;
      }
      return { condition: { kind: "max-hp" }, priority: Number(m[1]), filter: { flag } };
    },
  },

  // ── 6. priority-modifier (generic +N priority for FLAG moves) ───────────
  {
    archetype: "priority-modifier",
    test: desc => /\+\d+\s+priority/i.test(desc),
    extract: desc => {
      // "<thing> moves get +N priority" / "+N priority for ..."
      const m = desc.match(/(?:(\w+(?:[- ]\w+)?)\s+moves?\s+get\s+)?\+?(\d+)\s+priority/i);
      if (!m) {
        return null;
      }
      const priority = Number(m[2]);
      const flag = m[1] ? normalizeFlag(m[1]) : null;
      // Try to detect type-keyed too: "Flying moves get +1 Priority"
      const typeM = desc.match(new RegExp(`(${TYPE_RE_SRC})-?type?\\s+moves?\\s+get\\s+\\+\\d+\\s+priority`, "i"));
      const type = typeM ? normalizeType(typeM[1]) : null;
      const out = { priority };
      if (flag) {
        out.filter = { flag };
      } else if (type) {
        out.filter = { type };
      }
      // Detect first-turn condition
      if (/first\s+turn/i.test(desc)) {
        out.condition = { kind: "first-turn" };
      } else if (/first\s+\w+\s+move\s+each\s+entry/i.test(desc)) {
        out.condition = { kind: "first-entry" };
      }
      return out;
    },
  },

  // ── 7. entry-effect — add self type ─────────────────────────────────────
  {
    archetype: "entry-effect",
    test: desc => new RegExp(`Adds?\\s+(${TYPE_RE_SRC})[- ]?type\\s+on\\s+(entry|switch[-\\s]?in)`, "i").test(desc),
    extract: desc => {
      const m = desc.match(new RegExp(`Adds?\\s+(${TYPE_RE_SRC})[- ]?type\\s+on\\s+(entry|switch[-\\s]?in)`, "i"));
      if (!m) {
        return null;
      }
      const type = normalizeType(m[1]);
      return type ? { effect: { kind: "add-self-type", type } } : null;
    },
  },

  // ── 8. entry-effect — set weather ───────────────────────────────────────
  {
    archetype: "entry-effect",
    test: desc =>
      /(?:Summons|Sets|Casts)\s+(?:harsh\s+sunlight|sun|sunny|sandstorm|hail|rain|snow|fog)[^.]*?on\s+entry/i.test(
        desc,
      ),
    extract: desc => {
      const m = desc.match(
        /(?:Summons|Sets|Casts)\s+(harsh\s+sunlight|sun|sunny|sandstorm|hail|rain|snow|fog)[^.]*?on\s+entry(?:[^.]*?(?:Lasts|for)\s+(\d+)\s+turns?)?/i,
      );
      if (!m) {
        return null;
      }
      const weather = normalizeWeather(m[1]);
      const turns = m[2] ? Number(m[2]) : 8;
      return weather ? { effect: { kind: "set-weather", weather, turns } } : null;
    },
  },

  // ── 9. entry-effect — set terrain ───────────────────────────────────────
  {
    archetype: "entry-effect",
    test: desc =>
      /(?:Sets|Casts|Summons)\s+(?:Electric|Grassy|Psychic|Misty|Toxic)\s+Terrain[^.]*?on\s+entry/i.test(desc),
    extract: desc => {
      const m = desc.match(
        /(?:Sets|Casts|Summons)\s+(Electric|Grassy|Psychic|Misty|Toxic)\s+Terrain[^.]*?on\s+entry(?:[^.]*?(?:Lasts|for)\s+(\d+)\s+turns?)?/i,
      );
      if (!m) {
        return null;
      }
      const terrain = normalizeTerrain(`${m[1]} Terrain`);
      const turns = m[2] ? Number(m[2]) : 8;
      return terrain ? { effect: { kind: "set-terrain", terrain, turns } } : null;
    },
  },

  // ── 10. entry-effect — set hazard ───────────────────────────────────────
  {
    archetype: "entry-effect",
    test: desc =>
      /(?:Spreads|Sets|Casts|Deploys)\s+(?:(?:two\s+layers?\s+of\s+|a\s+layer\s+of\s+)?)?(?:Spikes|Stealth\s+Rocks?|Sticky\s+Web|Toxic\s+Spikes)[^.]*?on\s+(?:entry|switch[-\s]?in)/i.test(
        desc,
      ),
    extract: desc => {
      const m = desc.match(
        /(?:Spreads|Sets|Casts|Deploys)\s+(?:(two)\s+layers?\s+of\s+|a\s+layer\s+of\s+)?(Spikes|Stealth\s+Rocks?|Sticky\s+Web|Toxic\s+Spikes)/i,
      );
      if (!m) {
        return null;
      }
      const hazard = normalizeHazard(m[2].replace(/s$/, "").trim()) ?? normalizeHazard(m[2]);
      if (!hazard) {
        return null;
      }
      const layers = m[1] === "two" ? 2 : 1;
      return { effect: { kind: "set-hazard", hazard, layers } };
    },
  },

  // ── 11. entry-effect — set screen/room ──────────────────────────────────
  {
    archetype: "entry-effect",
    test: desc =>
      /(?:Sets|Casts|Summons|sets up|Sets up)\s+(?:up\s+)?(?:Reflect|Light\s+Screen|Aurora\s+Veil|Tailwind|Trick\s+Room|Magic\s+Room|Wonder\s+Room|Gravity|Defense\s+Curl|Inverse\s+Room)[^.]*?on\s+entry/i.test(
        desc,
      ),
    extract: desc => {
      const m = desc.match(
        /(?:Sets|Casts|Summons|sets up|Sets up)\s+(?:up\s+)?(Reflect|Light\s+Screen|Aurora\s+Veil|Tailwind|Trick\s+Room|Magic\s+Room|Wonder\s+Room|Gravity|Defense\s+Curl|Inverse\s+Room)[^.]*?on\s+entry(?:[^.]*?(?:Lasts|for|,\s+lasts)\s+(\d+)\s+turns?)?/i,
      );
      if (!m) {
        return null;
      }
      const tag = m[1].toUpperCase().replace(/\s+/g, "_");
      const turns = m[2] ? Number(m[2]) : null;
      return { effect: { kind: "set-screen-or-room", tag, ...(turns === null ? {} : { turns }) } };
    },
  },

  // ── 12. entry-effect — self stat boost ──────────────────────────────────
  // "+N STAT on entry." / "+N Speed on Entry" / "Ups highest stat by +1 on entry"
  {
    archetype: "entry-effect",
    test: desc => /\+\d+\s+\w+\s+on\s+entry/i.test(desc),
    extract: desc => {
      const m = desc.match(/\+(\d+)\s+([\w.\s]+?)\s+on\s+entry/i);
      if (!m) {
        return null;
      }
      const raw = m[2].trim();
      const stat = normalizeStat(raw) ?? (raw.toLowerCase().includes("highest") ? "HIGHEST" : raw.toUpperCase());
      return {
        effect: {
          kind: "self-stat-boost",
          stat,
          stages: Number(m[1]),
        },
      };
    },
  },

  // ── 13. chance-status-on-hit ────────────────────────────────────────────
  // "N% chance to STATUS on contact" / "N% chance to STATUS the target"
  {
    archetype: "chance-status-on-hit",
    test: desc =>
      /\b\d+\s*%\s+chance\s+to\s+(?:badly\s+poison|burn|paralyz\w+|poison|sleep|freeze|frostbit\w*|confus\w+|infatuat\w+|drowsy|bleed|flinch|fear)/i.test(
        desc,
      ),
    extract: desc => {
      const m = desc.match(
        /(\d+)\s*%\s+chance\s+to\s+(badly\s+poison|burn|paralyz\w+|poison|sleep|freeze|frostbit\w*|confus\w+|infatuat\w+|drowsy|bleed|flinch|fear)/i,
      );
      if (!m) {
        return null;
      }
      const chance = Number(m[1]);
      const status = normalizeStatus(m[2]) ?? m[2].toUpperCase().replace(/\s+/g, "_");
      const onContactOnly = /on\s+contact/i.test(desc);
      return { chance, status, onContactOnly };
    },
  },

  // ── 14. crit-mod — immune to crits ──────────────────────────────────────
  {
    archetype: "crit-mod",
    test: desc => /immune\s+to\s+(?:critical\s+hits|crits)/i.test(desc),
    extract: () => ({ mod: { kind: "immune" } }),
  },

  // ── 15. crit-mod — crit-rate bonus ──────────────────────────────────────
  {
    archetype: "crit-mod",
    test: desc => /\+\d+\s+(?:to\s+)?crit\s+(?:rate|stage)/i.test(desc),
    extract: desc => {
      const m = desc.match(/\+(\d+)\s+(?:to\s+)?crit\s+(?:rate|stage)/i);
      if (!m) {
        return null;
      }
      const bonus = Number(m[1]);
      // Detect flag-keyed: "+1 crit rate for FLAG moves"
      const flagM = desc.match(
        /for\s+(punching|biting|slashing|slicing|kicking|sound|hammer|pulse|dance|wind|arrow|horn|aura|air|wing|bone|keen\s+edge|mega\s+launcher|iron\s+fist)\s+moves?/i,
      );
      const flag = flagM ? normalizeFlag(flagM[1]) : null;
      return { mod: { kind: "rate-bonus", bonus, ...(flag ? { flag } : {}) } };
    },
  },

  // ── 16. crit-mod — crits ignore abilities / 2x damage vs resists ────────
  {
    archetype: "crit-mod",
    test: desc => /Crits?\s+(?:bypass|ignore)\s+abilities/i.test(desc),
    extract: desc => {
      const m = desc.match(/(\d+(?:\.\d+)?)x\s+(?:damage\s+)?vs\s+resists/i);
      const multiplier = m ? Number(m[1]) : null;
      return { mod: { kind: "post-crit-mult", multiplier: multiplier ?? 2, condition: "resists" } };
    },
  },

  // ── 17. damage-reduction-generic — super-effective ──────────────────────
  {
    archetype: "damage-reduction-generic",
    test: desc => /Takes?\s+\d+%\s+less\s+damage\s+from\s+Super[- ]effective/i.test(desc),
    extract: desc => {
      const m = desc.match(/Takes?\s+(\d+)%\s+less\s+damage\s+from\s+Super[- ]effective/i);
      if (!m) {
        return null;
      }
      return { filter: { kind: "super-effective" }, reduction: Number(m[1]) / 100 };
    },
  },

  // ── 18. damage-reduction-generic — flat ─────────────────────────────────
  {
    archetype: "damage-reduction-generic",
    test: desc => /Takes?\s+\d+%\s+(?:less|reduced)\s+damage(?:\s+from\s+attacks)?\.?\s*$/i.test(desc),
    extract: desc => {
      const m = desc.match(/Takes?\s+(\d+)%\s+(?:less|reduced)\s+damage/i);
      if (!m) {
        return null;
      }
      return { filter: { kind: "all" }, reduction: Number(m[1]) / 100 };
    },
  },

  // ── 19. damage-reduction-generic — split (physical/special) ─────────────
  {
    archetype: "damage-reduction-generic",
    test: desc =>
      /Halves\s+(?:dmg|damage)\s+taken\s+by\s+(?:Phys|Special|Spc)/i.test(desc)
      || /Takes?\s+\d+%\s+less\s+(?:from|damage\s+from)\s+(?:Phys|Special|Spc)/i.test(desc)
      || /Takes?\s+\d+%\s+less\s+damage\s+from\s+(?:Special|Physical)\s+attacks/i.test(desc)
      || /Weakens\s+incoming\s+physical\s+and\s+special\s+moves\s+by/i.test(desc),
    extract: desc => {
      const half = desc.match(
        /Halves\s+(?:dmg|damage)\s+taken\s+by\s+(Phys(?:ical)?|Special|Spc)\s+(?:moves|attacks)/i,
      );
      if (half) {
        const kind = /phys/i.test(half[1]) ? "physical" : "special";
        return { filter: { kind }, reduction: 0.5 };
      }
      const pct = desc.match(/Takes?\s+(\d+)%\s+less\s+(?:from|damage)\s+(?:from\s+)?(Phys(?:ical)?\.?|Special|Spc)/i);
      if (pct) {
        const kind = /phys/i.test(pct[2]) ? "physical" : "special";
        return { filter: { kind }, reduction: Number(pct[1]) / 100 };
      }
      const pctAttacks = desc.match(/Takes?\s+(\d+)%\s+less\s+damage\s+from\s+(Special|Physical)\s+attacks/i);
      if (pctAttacks) {
        const kind = /phys/i.test(pctAttacks[2]) ? "physical" : "special";
        return { filter: { kind }, reduction: Number(pctAttacks[1]) / 100 };
      }
      const arctic = desc.match(/Weakens\s+incoming\s+physical\s+and\s+special\s+moves\s+by\s+(\d+)\s*%/i);
      if (arctic) {
        return { filter: { kind: "all" }, reduction: Number(arctic[1]) / 100 };
      }
      return null;
    },
  },

  // ── 20. damage-reduction-generic — contact ──────────────────────────────
  {
    archetype: "damage-reduction-generic",
    test: desc =>
      /(?:Takes?|Halves|Quarters)\s+[\d/. ]*\s*(?:less\s+)?(?:dmg|damage)\s+(?:from|taken\s+by)\s+contact/i.test(desc)
      || /Quarters\s+contact\s+damage/i.test(desc),
    extract: desc => {
      if (/Halves\s+(?:dmg|damage)\s+(?:from|taken\s+by)\s+contact/i.test(desc)) {
        return { filter: { kind: "contact" }, reduction: 0.5 };
      }
      if (/Quarters\s+contact\s+damage/i.test(desc)) {
        return { filter: { kind: "contact" }, reduction: 0.75 };
      }
      const m = desc.match(/Takes?\s+([\d/]+)\s+(?:dmg|damage)\s+from\s+contact/i);
      if (m) {
        const frac = parseFraction(m[1]);
        if (frac !== null) {
          return { filter: { kind: "contact" }, reduction: 1 - frac };
        }
      }
      return null;
    },
  },

  // ── 21. passive-recovery ────────────────────────────────────────────────
  {
    archetype: "passive-recovery",
    test: desc =>
      /(?:Recovers?|Heals?|Restores?)\s+[\d/]+\s+of\s+(?:max\s+)?HP[^.]*?(?:each|every|end\s+of\s+(?:each\s+)?)turn/i.test(
        desc,
      ),
    extract: desc => {
      const m = desc.match(/(?:Recovers?|Heals?|Restores?)\s+([\d/]+)\s+of\s+(?:max\s+)?HP/i);
      if (!m) {
        return null;
      }
      const healFraction = parseFraction(m[1]);
      if (healFraction === null) {
        return null;
      }
      const out = { healFraction };
      if (/if\s+asleep/i.test(desc)) {
        out.condition = { kind: "sleeping" };
      } else if (/in\s+fog/i.test(desc)) {
        out.condition = { kind: "weather", weather: "FOG" };
      }
      return out;
    },
  },

  // ── 22. lifesteal — per-hit deal-heal ───────────────────────────────────
  {
    archetype: "lifesteal",
    test: desc =>
      /Heals?\s+(?:the\s+user\s+for\s+)?[\d/]+\s+of\s+(?:the\s+)?damage\s+(?:they\s+deal|dealt|done)/i.test(desc),
    extract: desc => {
      const m = desc.match(/Heals?\s+(?:the\s+user\s+for\s+)?([\d/]+)\s+of/i);
      if (m) {
        const frac = parseFraction(m[1]);
        if (frac !== null) {
          return { trigger: "on-hit-deal", healFraction: frac };
        }
        const n = Number(m[1]);
        if (Number.isFinite(n)) {
          return { trigger: "on-hit-deal", healFraction: n };
        }
      }
      return null;
    },
  },

  // ── 23. lifesteal — on-KO heal ──────────────────────────────────────────
  {
    archetype: "lifesteal",
    test: desc => /Dealing\s+a\s+KO\s+heals\s+[\d/]+/i.test(desc),
    extract: desc => {
      const m = desc.match(/Dealing\s+a\s+KO\s+heals\s+([\d/]+)/i);
      if (!m) {
        return null;
      }
      const frac = parseFraction(m[1]);
      return { trigger: "on-ko", healFraction: frac ?? Number(m[1]) };
    },
  },

  // ── 24. stat-trigger-on-event — on KO ───────────────────────────────────
  {
    archetype: "stat-trigger-on-event",
    test: desc => /KOs?\s+(?:raise|boost|ups?|increase)\s+\w+\s+by/i.test(desc),
    extract: desc => {
      const m = desc.match(/KOs?\s+(?:raise|boost|ups?|increase)\s+([\w.\s]+?)\s+by\s+(one|\d+)\s+stage/i);
      if (!m) {
        return null;
      }
      const stat = normalizeStat(m[1].trim());
      const stages = m[2] === "one" ? 1 : Number(m[2]);
      if (!stat || !Number.isFinite(stages)) {
        return null;
      }
      return { trigger: "on-ko", stats: [{ stat, stages }] };
    },
  },

  // ── 25. type-conversion — "Normal moves become X[. X moves are empowered]." ─
  // Also handles the truncated form ("Normal moves becomes Bug." without the
  // "X moves are empowered" sentence). The empower clause is optional —
  // when missing we default to multiplier 1.2 (typical ER value).
  {
    archetype: "type-conversion",
    test: desc => new RegExp(`Normal\\s+moves?\\s+become[s]?\\s+(${TYPE_RE_SRC})\\b`, "i").test(desc),
    extract: desc => {
      const becomeM = desc.match(new RegExp(`Normal\\s+moves?\\s+become[s]?\\s+(${TYPE_RE_SRC})`, "i"));
      const empowerM = desc.match(
        new RegExp(`(${TYPE_RE_SRC})\\s+moves?\\s+(?:are\\s+empowered|get\\s+a\\s+([\\d.]+)x\\s+boost)`, "i"),
      );
      if (!becomeM) {
        return null;
      }
      return {
        sourceType: "NORMAL",
        targetType: normalizeType(becomeM[1]),
        ...(empowerM && empowerM[2] ? { multiplier: Number(empowerM[2]) } : { multiplier: 1.2 }),
      };
    },
  },

  // ── 26. type-conversion — "X-type moves become Y and get Nx boost" ──────
  {
    archetype: "type-conversion",
    test: desc =>
      new RegExp(`(${TYPE_RE_SRC})-type\\s+moves?\\s+become\\s+(${TYPE_RE_SRC})\\s+and\\s+get`, "i").test(desc),
    extract: desc => {
      const m = desc.match(
        new RegExp(
          `(${TYPE_RE_SRC})-type\\s+moves?\\s+become\\s+(${TYPE_RE_SRC})\\s+and\\s+get\\s+a\\s+([\\d.]+)x`,
          "i",
        ),
      );
      if (!m) {
        return null;
      }
      return { sourceType: normalizeType(m[1]), targetType: normalizeType(m[2]), multiplier: Number(m[3]) };
    },
  },

  // ── 27. type-conversion — categorical flag-keyed ────────────────────────
  // "Sound moves get a 1.2x boost and become X if Normal."
  {
    archetype: "type-conversion",
    test: desc =>
      /(?:punching|biting|slashing|slicing|sound|hammer|pulse|kicking|kick|dance|wind|arrow|horn|aura|air|wing|bone)\s+moves?\s+get\s+a\s+[\d.]+x\s+boost\s+and\s+become/i.test(
        desc,
      ),
    extract: desc => {
      const m = desc.match(
        new RegExp(
          `(\\w+)\\s+moves?\\s+get\\s+a\\s+([\\d.]+)x\\s+boost\\s+and\\s+become\\s+(${TYPE_RE_SRC})(?:\\s+if\\s+(${TYPE_RE_SRC}))?`,
          "i",
        ),
      );
      if (!m) {
        return null;
      }
      const flag = normalizeFlag(m[1]);
      if (!flag) {
        return null;
      }
      const out = {
        sourceType: m[4] ? normalizeType(m[4]) : "any",
        targetType: normalizeType(m[3]),
        multiplier: Number(m[2]),
        flag,
      };
      return out;
    },
  },

  // ── 28. type-resist (resist by fraction, type-keyed) ────────────────────
  // "Takes 1/2 damage from Fire, Electric and Water-type attacks."
  // (taxonomy maps this to "type-resist-or-absorb"; we use that name)
  {
    archetype: "type-resist-or-absorb",
    test: desc =>
      new RegExp(
        `(?:Takes?|Halves)\\s+(?:[\\d/.]+\\s+)?(?:damage|dmg)\\s+(?:from|taken\\s+by)\\s+(?:[\\w,\\s]+?)(?:${TYPE_RE_SRC})[- ]?type`,
        "i",
      ).test(desc),
    extract: desc => {
      // Capture "1/2", "1/4", "0.5", or "50%" preceding the type list
      const fmatch = desc.match(
        /(?:Takes?|Halves)\s+([\d/.]+)?\s*(?:less\s+)?(?:damage|dmg)\s+(?:from|taken\s+by)\s+/i,
      );
      let multiplier = 0.5;
      if (fmatch && fmatch[1]) {
        const f = parseFraction(fmatch[1]);
        if (f === null) {
          const n = Number(fmatch[1]);
          if (Number.isFinite(n)) {
            multiplier = n;
          }
        } else {
          multiplier = f;
        }
      }
      // Halves doesn't need a fraction
      if (/^Halves/i.test(desc)) {
        multiplier = 0.5;
      }
      // Extract types
      const typeRegex = new RegExp(`(${TYPE_RE_SRC})\\b`, "gi");
      const types = [];
      let m;
      while ((m = typeRegex.exec(desc)) !== null) {
        const t = normalizeType(m[1]);
        if (t && !types.includes(t)) {
          types.push(t);
        }
      }
      if (types.length === 0) {
        return null;
      }
      return {
        type: types.length === 1 ? types[0] : types,
        effect: { kind: "resist", multiplier },
      };
    },
  },

  // ── 29. type-resist-or-absorb — absorb-heal ─────────────────────────────
  // "Redirects TYPE moves. Absorbs them, ..." / "Heals N% when hit by TYPE"
  {
    archetype: "type-resist-or-absorb",
    test: desc =>
      /Redirects\s+\w+\s+moves?[\s.]*Absorbs/i.test(desc) || /Absorbs\s+\w+\s+moves?\s+(?:then|and)\s+ups?/i.test(desc),
    extract: desc => {
      const m =
        desc.match(new RegExp(`Redirects\\s+(${TYPE_RE_SRC})\\s+moves`, "i"))
        ?? desc.match(new RegExp(`Absorbs\\s+(${TYPE_RE_SRC})\\s+moves`, "i"));
      if (!m) {
        return null;
      }
      const type = normalizeType(m[1]);
      const heal = desc.match(/healing\s+(\d+)\s*%/i);
      const stat = desc.match(/ups?\s+(?:highest\s+)?(\w+)/i);
      const effect = { kind: "absorb", redirect: true };
      if (heal) {
        effect.healPct = Number(heal[1]) / 100;
      }
      if (stat) {
        const s = normalizeStat(stat[1]) ?? "HIGHEST";
        effect.statBoost = { stat: s, stages: 1 };
      }
      return { type, effect };
    },
  },

  // ── 30. type-effectiveness-override (deal more + take less) ─────────────
  // "Deals 1.5x damage to X. Takes 0.5x damage from X."
  {
    archetype: "type-effectiveness-override",
    test: desc =>
      new RegExp(
        `Deals\\s+[\\d.]+x\\s+damage\\s+to\\s+(${TYPE_RE_SRC})[^.]*?Takes?\\s+[\\d.]+x\\s+damage\\s+from\\s+(${TYPE_RE_SRC})`,
        "i",
      ).test(desc),
    extract: desc => {
      const m = desc.match(
        new RegExp(
          `Deals\\s+([\\d.]+)x\\s+damage\\s+to\\s+(${TYPE_RE_SRC})[^.]*?Takes?\\s+([\\d.]+)x\\s+damage\\s+from\\s+(${TYPE_RE_SRC})`,
          "i",
        ),
      );
      if (!m) {
        return null;
      }
      return {
        attackerType: "ANY",
        targetType: normalizeType(m[2]),
        offenseMultiplier: Number(m[1]),
        defenseMultiplier: Number(m[3]),
      };
    },
  },

  // ── 31. composite-vanilla-mashup ────────────────────────────────────────
  // Heuristic: "X + Y[. rider]" where the description STARTS with text that
  // looks like an ability name (not a stat-boost phrase like "Boosts X by N%").
  {
    archetype: "composite-vanilla-mashup",
    test: desc => {
      if (!/\s\+\s/.test(desc)) {
        return false;
      }
      // Reject "Boosts STAT by N% + STAT by M%" style stat-trigger descriptions.
      const segs = desc.split(/\s\+\s/);
      const first = segs[0].trim();
      // If the prefix is a stat-boost sentence ending in "by N%", reject.
      if (/by\s+\d+\s*%?$/i.test(first)) {
        return false;
      }
      // If the prefix starts with "Boosts STAT by" and the suffix continues
      // the same pattern, reject.
      if (/^Boosts?\s/i.test(first) && /\bby\s+\d+/i.test(first)) {
        return false;
      }
      return true;
    },
    extract: desc => {
      // Split on " + ", trim, and harvest the first ~3 segments.
      const rawSegs = desc.split(/\s\+\s/).map(s => s.trim());
      // Take the first segment as-is; further segments until we hit a sentence
      // boundary (period followed by capital).
      const parts = [];
      for (const seg of rawSegs) {
        // Strip trailing period
        const cleaned = seg.replace(/[.;](?:\s|$).*$/s, "").trim();
        if (cleaned.length > 0 && cleaned.length <= 40) {
          parts.push(cleaned);
        }
      }
      // Detect rider clause: the part of the description after the last
      // composite reference that introduces a free-text effect.
      let rider = null;
      const lastDot = desc.lastIndexOf(".");
      // If the LAST segment contains a sentence-boundary-then-text, that
      // text is the rider.
      const lastSeg = rawSegs.at(-1);
      const riderMatch = lastSeg.match(/^([^.;]+?)[.;](?:\s+)(.+)$/s);
      if (riderMatch && riderMatch[2].trim().length > 5) {
        rider = riderMatch[2].trim().replace(/[.\s]+$/, "");
      }
      // If first segment looks too long (>40 chars) treat it as a single composite
      // with the rest as rider. (e.g. "Boosts the power of kicking moves by 1.3x + Pixilate")
      if (parts.length === 0 || (rawSegs[0].length > 40 && parts.length < rawSegs.length)) {
        return { parts: rawSegs.map(s => s.replace(/[.;](?:\s|$).*$/s, "").trim()), ...(rider ? { rider } : {}) };
      }
      // ignore lastDot — we only used it earlier as a guard; surface the parts list.
      void lastDot;
      return { parts, ...(rider ? { rider } : {}) };
    },
  },

  // ── 32. weather-or-terrain-interaction — stat boost in weather ──────────
  {
    archetype: "weather-or-terrain-interaction",
    test: desc =>
      /Ups?\s+highest\s+(?:attacking\s+)?stat\s+by\s+[\d.]+x\s+in\s+(sun|sunny|rain|hail|snow|sandstorm|fog)/i.test(
        desc,
      )
      || /(?:gets|gains)\s+a?\s*[\d.]+x\s+Speed\s+boost\s+if\s+(?:Grassy|Electric|Psychic|Misty)\s+Terrain/i.test(desc),
    extract: desc => {
      const w = desc.match(/in\s+(sun|sunny|rain|hail|snow|sandstorm|fog)/i);
      const m = desc.match(/(?:by|gains)\s+([\d.]+)x/i);
      if (w && m) {
        return {
          condition: { weather: normalizeWeather(w[1]) },
          effect: { kind: "stat-boost", stat: "HIGHEST_ATK", multiplier: Number(m[1]) },
        };
      }
      const tm = desc.match(/(?:Grassy|Electric|Psychic|Misty)\s+Terrain/i);
      const sm = desc.match(/([\d.]+)x\s+Speed/i);
      if (tm && sm) {
        return {
          condition: { terrain: normalizeTerrain(tm[0]) },
          effect: { kind: "stat-boost", stat: "SPD", multiplier: Number(sm[1]) },
        };
      }
      return null;
    },
  },

  // ── 33. multi-hit-override ──────────────────────────────────────────────
  {
    archetype: "multi-hit-override",
    test: desc =>
      /\bmoves?\s+(?:hit|hits)\s+(?:twice|\d+\s+times)/i.test(desc) || /\bcan\s+hit\s+\d+-\d+\s+times/i.test(desc),
    extract: desc => {
      const range = desc.match(/\bcan\s+hit\s+(\d+)-(\d+)\s+times/i);
      if (range) {
        return { filter: { kind: "all" }, hits: [Number(range[1]), Number(range[2])] };
      }
      const fixed = desc.match(/\bhits?\s+(twice|\d+\s+times)/i);
      if (!fixed) {
        return null;
      }
      const hits = /twice/i.test(fixed[1]) ? 2 : Number(fixed[1].match(/\d+/)[0]);
      // Flag/type filter
      const fM = desc.match(
        new RegExp(
          `(punching|biting|slashing|slicing|kicking|sound|hammer|dance|arrow|horn|aura|air|wing|bone|keen\\s+edge|mega\\s+launcher|iron\\s+fist|${TYPE_RE_SRC})\\s+(?:moves?|type)`,
          "i",
        ),
      );
      const filter = { kind: "all" };
      if (fM) {
        const flag = normalizeFlag(fM[1]);
        const type = normalizeType(fM[1]);
        if (flag) {
          filter.flag = flag;
          filter.kind = "flag";
        } else if (TYPE_NAMES.includes(fM[1].toLowerCase())) {
          filter.type = type;
          filter.kind = "type";
        }
      }
      // Second-hit multiplier
      const sm = desc.match(/(?:2nd|second)\s+hit\s+(?:at|does)\s+([\d.]+)\s*(?:x|%)/i);
      const out = { filter, hits };
      if (sm) {
        let v = Number(sm[1]);
        if (/%/.test(sm[0])) {
          v /= 100;
        }
        out.secondaryHitMultiplier = v;
      } else {
        const bothAt = desc.match(/both\s+hits?\s+at\s+([\d.]+)\s*%/i);
        if (bothAt) {
          out.allHitsMultiplier = Number(bothAt[1]) / 100;
        }
      }
      return out;
    },
  },

  // ── 34. accuracy-mod ────────────────────────────────────────────────────
  // "X always hits" / "X never misses" / "X moves never miss"
  {
    archetype: "accuracy-mod",
    test: desc => /\b(?:always\s+hit|never\s+miss)/i.test(desc) && !/\bcrit/i.test(desc),
    extract: desc => {
      // Detect filter: by flag or by type or by ALL
      const fm = desc.match(
        /\b(slashing|slicing|punching|biting|kicking|sound|hammer|pulse|dance|arrow|horn|aura|air|wing|bone|kick|keen\s+edge|mega\s+launcher|iron\s+fist)\s+moves?/i,
      );
      const tm = desc.match(new RegExp(`(${TYPE_RE_SRC})-type\\s+moves?`, "i"));
      const filter = {};
      if (fm) {
        const flag = normalizeFlag(fm[1]);
        if (flag) {
          filter.flag = flag;
        }
      } else if (tm) {
        filter.type = normalizeType(tm[1]);
      } else if (/super-effective/i.test(desc)) {
        filter.tag = "super-effective";
      } else if (/status\s+moves/i.test(desc)) {
        filter.tag = "status";
      } else if (/all\s+moves/i.test(desc)) {
        filter.tag = "all";
      }
      return { filter, override: { mode: "set", value: 100 } };
    },
  },

  // ── 35. proc-followup-attack ────────────────────────────────────────────
  // "Triggers <N> BP <Move> after using a <type>-type / <flag> / <kind> move"
  // Also handles the "After using X, follow up with Y" reverse phrasing.
  {
    archetype: "proc-followup-attack",
    test: desc =>
      /Triggers?\s+(?:a\s+)?(?:\d+\s*BP\s+)?[\w\s]+?\s+after\s+using/i.test(desc)
      || /After\s+using\s+[\w\-\s]+,?\s+follow[s]?\s+up\s+with/i.test(desc)
      || /follows?\s+up\s+with\s+\d+\s*BP\s+\w+\s+after\s+using/i.test(desc),
    extract: desc => {
      let m = desc.match(/Triggers?\s+(?:a\s+)?(?:(\d+)\s*BP\s+)?(\w+(?:\s+\w+)?)\s+after\s+using/i);
      let followupBp = null;
      let followup = null;
      if (m) {
        followupBp = m[1] ? Number(m[1]) : null;
        followup = m[2].trim().toUpperCase().replace(/\s+/g, "_");
      } else {
        m = desc.match(
          /After\s+using\s+[\w\-\s]+,?\s+follow[s]?\s+up\s+with\s+(?:a\s+)?(?:(\d+)\s*BP\s+)?(\w+(?:\s+\w+)?)/i,
        );
        if (m) {
          followupBp = m[1] ? Number(m[1]) : null;
          followup = m[2].trim().toUpperCase().replace(/\s+/g, "_");
        }
      }
      if (!followup) {
        return null;
      }
      // Detect trigger
      const tt = desc.match(
        new RegExp(`(?:after\\s+using|after\\s+using\\s+a)\\s+(?:a|an)?\\s*(${TYPE_RE_SRC})-?type\\s+move`, "i"),
      );
      const ft = desc.match(
        /(?:after\s+using|after\s+using\s+a)\s+(?:a|an)?\s*(punching|biting|slashing|sound|hammer|pulse|dance|arrow|horn|aura|air|wing|bone|keen\s+edge|mega\s+launcher|iron\s+fist)\s+move/i,
      );
      const trigger = {};
      if (tt) {
        trigger.type = normalizeType(tt[1]);
      } else if (ft) {
        trigger.flag = normalizeFlag(ft[1]);
      } else if (/damaging\s+move|attack\b/i.test(desc)) {
        trigger.tag = "damaging";
      } else if (/special\s+move/i.test(desc)) {
        trigger.tag = "special";
      }
      return { followup, ...(followupBp === null ? {} : { followupBp }), trigger };
    },
  },

  // ── 36. on-hit-counter-attack ───────────────────────────────────────────
  {
    archetype: "on-hit-counter-attack",
    test: desc =>
      /(?:Counters?|Attacks?\s+with)\s+(?:contact\s+)?(?:moves?\s+)?(?:with\s+)?(?:\d+\s*BP\s+)?\w+/i.test(desc)
      && /(?:Counters?\s+contact|when\s+hit|when\s+(?:struck|attacked)\s+by\s+contact|hit\s+by\s+contact)/i.test(desc),
    extract: desc => {
      const m = desc.match(
        /(?:\d+\s*BP\s+)?(\w+(?:\s+\w+)?)\s+(?:when\s+(?:hit|struck)\s+by|after\s+being\s+hit\s+by|counter[s]?\s+contact\s+with)/i,
      );
      const bpMatch = desc.match(/(\d+)\s*BP/i);
      // Try a more direct pattern: "Counters contact with NBP X"
      const cm = desc.match(/Counters?\s+contact\s+with\s+(?:(\d+)\s*BP\s+)?(\w+(?:\s+\w+)?)/i);
      if (cm) {
        return {
          counterMove: cm[2].trim().toUpperCase().replace(/\s+/g, "_"),
          ...(cm[1] ? { counterBp: Number(cm[1]) } : {}),
          filter: { contact: true },
        };
      }
      // "Attacks with X when hit by contact"
      const am = desc.match(
        /Attacks?\s+with\s+(?:(\d+)\s*BP\s+)?([\w\s]+?)\s+when\s+hit\s+by\s+(?:a\s+)?(?:contact|non[- ]contact)/i,
      );
      if (am) {
        return {
          counterMove: am[2].trim().toUpperCase().replace(/\s+/g, "_"),
          ...(am[1] ? { counterBp: Number(am[1]) } : {}),
          filter: { contact: /\bcontact\b/i.test(am[0]) && !/non[- ]contact/i.test(am[0]) },
        };
      }
      if (m && bpMatch) {
        return {
          counterMove: m[1].trim().toUpperCase().replace(/\s+/g, "_"),
          counterBp: Number(bpMatch[1]),
          filter: { contact: true },
        };
      }
      return null;
    },
  },

  // ── 37. status-immunity ─────────────────────────────────────────────────
  {
    archetype: "status-immunity",
    test: desc =>
      /(?:Cannot\s+be|Can't\s+be|Immune\s+to)\s+(?:burn|paralyz|poison|sleep|freeze|frostbit|confus|infatuat|drowsy|bleed|intimidate|scare|taunt)/i.test(
        desc,
      ),
    extract: desc => {
      const statuses = [];
      const tags = [];
      const statusRe = /\b(burn|paralyz\w*|poison|sleep|freeze|frostbit\w*|confus\w+|infatuat\w+|drowsy|bleed)/gi;
      let sm;
      while ((sm = statusRe.exec(desc)) !== null) {
        const s = normalizeStatus(sm[1]);
        if (s && !statuses.includes(s)) {
          statuses.push(s);
        }
      }
      const tagRe = /\b(intimidat\w*|scare|taunt|curse)/gi;
      let tm;
      while ((tm = tagRe.exec(desc)) !== null) {
        // Normalize to the bare tag name (strip ed/ing suffixes).
        const t = tm[1].toUpperCase().replace(/(?:ED|ING|S)$/, "");
        const canonical = t.startsWith("INTIMIDAT") ? "INTIMIDATE" : t;
        if (!tags.includes(canonical)) {
          tags.push(canonical);
        }
      }
      return { statuses, ...(tags.length > 0 ? { tags } : {}) };
    },
  },

  // ── 38. conditional-damage ──────────────────────────────────────────────
  // "Doubles damage if X is sleeping" / "Deals 2x damage vs confused"
  {
    archetype: "conditional-damage",
    test: desc =>
      /(?:Doubles?\s+damage|Deals?\s+[\d.]+x\s+damage)\s+(?:if|to|vs|against)/i.test(desc)
      || /Does\s+\d+%\s+more\s+damage\s+if/i.test(desc),
    extract: desc => {
      const m = desc.match(
        /(?:Doubles?\s+damage|Deals?\s+([\d.]+)x\s+damage|Does\s+(\d+)%\s+more\s+damage)\s+(?:if|to|vs|against)\s+([^.]+)/i,
      );
      if (!m) {
        return null;
      }
      let multiplier;
      if (m[1]) {
        multiplier = Number(m[1]);
      } else if (m[2]) {
        multiplier = 1 + Number(m[2]) / 100;
      } else {
        multiplier = 2;
      }
      const rest = (m[3] ?? "").toLowerCase();
      let condition;
      if (/sleeping|asleep/.test(rest)) {
        condition = { kind: "target-asleep" };
      } else if (/confused|enraged/.test(rest)) {
        condition = { kind: "target-confused" };
      } else if (/lowered\s+stat/.test(rest)) {
        condition = { kind: "target-has-lowered-stat" };
      } else if (/statused/.test(rest)) {
        condition = { kind: "target-statused" };
      } else if (/low\s+hp/.test(rest)) {
        condition = { kind: "target-low-hp" };
      } else {
        condition = { kind: "other", note: rest.slice(0, 60).trim() };
      }
      return { condition, multiplier };
    },
  },

  // ── 39. form-change ─────────────────────────────────────────────────────
  {
    archetype: "form-change",
    test: desc => /Changes?\s+forms?/i.test(desc),
    extract: desc => {
      // Trigger: "when using or hit by a X-type move" / "based on the move used"
      const typed = desc.match(new RegExp(`(${TYPE_RE_SRC})-type\\s+move`, "i"));
      if (typed) {
        return { trigger: "type-use-or-hit", type: normalizeType(typed[1]) };
      }
      if (/based\s+on\s+the\s+move\s+used/i.test(desc)) {
        return { trigger: "move-used" };
      }
      return { trigger: "other" };
    },
  },

  // ── 41. entry-effect — Lowers foes' STAT on entry ───────────────────────
  // "Lowers foes' Sp. Atk by one stage on entry." / "Terrify - Lowers foes' Sp. Atk by two stages on entry."
  {
    archetype: "entry-effect",
    test: desc => /Lowers?\s+foes?'?\s+[\w.\s]+\s+by\s+(?:one|two|three|\d+)\s+stage[s]?\s+on\s+entry/i.test(desc),
    extract: desc => {
      const m = desc.match(/Lowers?\s+foes?'?\s+([\w.\s]+?)\s+by\s+(one|two|three|\d+)\s+stage[s]?\s+on\s+entry/i);
      if (!m) {
        return null;
      }
      const stat = normalizeStat(m[1].trim());
      const stagesMap = { one: 1, two: 2, three: 3 };
      const stages = stagesMap[m[2].toLowerCase()] ?? Number(m[2]);
      if (!stat || !Number.isFinite(stages)) {
        return null;
      }
      return { effect: { kind: "lower-foe-stat", stat, stages } };
    },
  },

  // ── 42. entry-effect — "Ups highest stat by +N on entry [conditional]" ──
  {
    archetype: "entry-effect",
    test: desc =>
      /(?:Ups?|Raises?|Boosts?)\s+(?:highest|its)\s+(?:calculated\s+)?stat\s+by\s+\+?\d+\s+on\s+entry/i.test(desc),
    extract: desc => {
      const m = desc.match(/by\s+\+?(\d+)\s+on\s+entry(?:\s+(?:when|if|in)\s+(\w+))?/i);
      if (!m) {
        return null;
      }
      const stages = Number(m[1]);
      const condRaw = m[2]?.toLowerCase();
      const cond = condRaw
        ? { when: normalizeWeather(condRaw) ?? normalizeTerrain(condRaw) ?? condRaw.toUpperCase() }
        : null;
      return {
        effect: {
          kind: "self-stat-boost",
          stat: "HIGHEST",
          stages,
          ...(cond ? { condition: cond } : {}),
        },
      };
    },
  },

  // ── 43. entry-effect — "Attacks with MOVE on entry/switch-in" ──────────
  {
    archetype: "entry-effect",
    test: desc => /Attacks?\s+with\s+(?:\d+\s*BP\s+)?[\w\s]+\s+on\s+(?:first\s+)?(?:switch[-\s]?in|entry)/i.test(desc),
    extract: desc => {
      const m = desc.match(
        /Attacks?\s+with\s+(?:(\d+)\s*BP\s+)?([\w\s]+?)\s+on\s+(?:first\s+)?(?:switch[-\s]?in|entry)/i,
      );
      if (!m) {
        return null;
      }
      const move = m[2].trim().toUpperCase().replace(/\s+/g, "_");
      return { effect: { kind: "scripted-move", move, ...(m[1] ? { bp: Number(m[1]) } : {}) } };
    },
  },

  // ── 44. entry-effect — "Uses MOVE on switch-in" (Uses Disable on switch-in) ──
  {
    archetype: "entry-effect",
    test: desc => /Uses?\s+[\w\s]+\s+on\s+(?:first\s+)?(?:switch[-\s]?in|entry)/i.test(desc),
    extract: desc => {
      const m = desc.match(/Uses?\s+([\w\s]+?)\s+on\s+(?:first\s+)?(?:switch[-\s]?in|entry)/i);
      if (!m) {
        return null;
      }
      const move = m[1].trim().toUpperCase().replace(/\s+/g, "_");
      return { effect: { kind: "scripted-move", move } };
    },
  },

  // ── 45. entry-effect — Casts <misc>/Sets <misc> on entry (catch-all) ───
  {
    archetype: "entry-effect",
    test: desc => /(?:Casts|Sets|Sets up|Spreads|Deploys|Summons)\s+[\w\s-]+\s+on\s+entry/i.test(desc),
    extract: desc => {
      const m = desc.match(
        /(?:Casts|Sets|Sets up|Spreads|Deploys|Summons)\s+([\w\s-]+?)\s+on\s+entry(?:[^.]*?(?:for|lasts|,\s*lasts)\s+(\d+)\s+turns?)?/i,
      );
      if (!m) {
        return null;
      }
      return {
        effect: {
          kind: "set-misc",
          target: m[1].trim().toUpperCase().replace(/\s+/g, "_"),
          ...(m[2] ? { turns: Number(m[2]) } : {}),
        },
      };
    },
  },

  // ── 46. entry-effect — generic "On entry, X" pattern (catch-all) ───────
  {
    archetype: "entry-effect",
    test: desc => /\bOn\s+entry,?\s+/i.test(desc) || /\son\s+entry\.?\s*$/i.test(desc.trim()),
    extract: desc => ({
      effect: {
        kind: "misc",
        note: desc
          .replace(/[\s.]+$/, "")
          .trim()
          .slice(0, 80),
      },
    }),
  },

  // ── 47. weather-or-terrain-interaction — type boost in weather ─────────
  // "Boosts X moves by Nx in WEATHER" / "Flourish - Boosts Grass moves by 50% in grassy terrain"
  {
    archetype: "weather-or-terrain-interaction",
    test: desc =>
      new RegExp(
        `Boosts?\\s+(?:own\\s+)?(${TYPE_RE_SRC})[- ]?(?:type)?\\s+moves?\\s+by\\s+[\\d.]+(?:x|%)\\s+in\\s+`,
        "i",
      ).test(desc),
    extract: desc => {
      const m = desc.match(
        new RegExp(
          `Boosts?\\s+(?:own\\s+)?(${TYPE_RE_SRC})[- ]?(?:type)?\\s+moves?\\s+by\\s+([\\d.]+)(x|%)\\s+in\\s+(\\w+(?:\\s+terrain)?)`,
          "i",
        ),
      );
      if (!m) {
        return null;
      }
      let multiplier = Number(m[2]);
      if (m[3] === "%") {
        multiplier = 1 + multiplier / 100;
      }
      const cond4 = m[4].toLowerCase();
      const weather = normalizeWeather(cond4);
      const terrain = normalizeTerrain(cond4);
      return {
        condition: weather ? { weather } : terrain ? { terrain } : { other: cond4 },
        effect: { kind: "type-boost", type: normalizeType(m[1]), multiplier },
      };
    },
  },

  // ── 48. weather-or-terrain-interaction — Speed/etc boost in terrain ────
  {
    archetype: "weather-or-terrain-interaction",
    test: desc =>
      /(?:Speed|Atk|SpAtk|Def|SpDef|highest|attacking\s+stat)\s+(?:gets|gains|boost(?:ed)?|of\s+[\d.]+x)/i.test(desc)
      && /\b(?:in|under|when\s+in)\s+(?:sun|sunny|rain|hail|snow|sandstorm|fog|Grassy|Electric|Psychic|Misty|Toxic)\s+(?:terrain)?/i.test(
        desc,
      ),
    extract: desc => {
      const wm = desc.match(
        /\b(?:in|under|when\s+in)\s+(sun|sunny|rain|hail|snow|sandstorm|fog|Grassy|Electric|Psychic|Misty|Toxic)/i,
      );
      const mm = desc.match(/([\d.]+)\s*x/i);
      if (!wm) {
        return null;
      }
      const cond4 = wm[1].toLowerCase();
      const weather = normalizeWeather(cond4);
      const terrain = normalizeTerrain(cond4);
      return {
        condition: weather ? { weather } : terrain ? { terrain } : { other: cond4 },
        effect: { kind: "stat-boost", note: desc.slice(0, 80).trim(), ...(mm ? { multiplier: Number(mm[1]) } : {}) },
      };
    },
  },

  // ── 49. stat-trigger-on-event — on-hit ─────────────────────────────────
  // "Ups Def and Sp. Def by one stage if hit by Flying or Fire moves."
  {
    archetype: "stat-trigger-on-event",
    test: desc =>
      /(?:Ups?|Boosts?|Raises?)\s+[\w.\s,]+\s+(?:by|when)\s+(?:one|two|\d+)\s+stage[s]?\s+(?:if\s+)?(?:hit\s+by|when\s+hit\s+by)/i.test(
        desc,
      )
      || /When\s+hit\s+by[^.]*?(?:ups?|raises?|boosts?)\s+\w+/i.test(desc)
      || /\+\d+\s+\w+\s+when\s+hit\s+by/i.test(desc),
    extract: desc => {
      // Parse stat list: "Def and Sp. Def" or "Speed" or "highest"
      const m =
        desc.match(/(?:Ups?|Boosts?|Raises?)\s+([\w.\s,]+?)\s+by\s+(one|two|\d+)\s+stage/i)
        ?? desc.match(/\+(\d+)\s+([\w.]+)\s+when\s+hit/i);
      if (!m) {
        return null;
      }
      const stages = m[2] ? (m[2] === "one" ? 1 : m[2] === "two" ? 2 : Number(m[2])) : Number(m[1]);
      const statStr = m[2] ? m[1] : m[2];
      const stats = statStr
        .split(/\s*(?:,|and)\s*/i)
        .map(s => normalizeStat(s.trim()))
        .filter(Boolean)
        .map(stat => ({ stat, stages }));
      // Type filter
      const typeM = desc.match(new RegExp(`(${TYPE_RE_SRC})\\s+(?:or\\s+(${TYPE_RE_SRC})\\s+)?moves?`, "i"));
      const filter = {};
      if (typeM) {
        const t1 = normalizeType(typeM[1]);
        const t2 = typeM[2] ? normalizeType(typeM[2]) : null;
        filter.types = t2 ? [t1, t2] : [t1];
      }
      return {
        trigger: "on-hit",
        stats: stats.length > 0 ? stats : [{ stat: "HIGHEST", stages }],
        ...(typeM ? { filter } : {}),
      };
    },
  },

  // ── 50. stat-trigger-on-event — first-turn ────────────────────────────
  // "Boosts Speed by 50% + Attack by 20% on first turn."
  {
    archetype: "stat-trigger-on-event",
    test: desc =>
      /Boosts?\s+[\w.\s]+\s+by\s+\d+%(?:\s+\+\s+[\w.\s]+\s+by\s+\d+%)?\s+on\s+first\s+turn/i.test(desc)
      || /Doubles?\s+(?:atk|attack|speed|spd|spatk|sp\.\s*atk|spdef|sp\.\s*def)\s+on\s+first\s+turn/i.test(desc),
    extract: desc => {
      const out = { trigger: "first-turn", stats: [] };
      // Parse all "STAT by N%" pairs
      const re = /(\w+(?:\.\s*\w+)?)\s+by\s+(\d+)\s*%/gi;
      let m;
      while ((m = re.exec(desc)) !== null) {
        const stat = normalizeStat(m[1].trim());
        if (stat) {
          out.stats.push({ stat, percentBoost: Number(m[2]) });
        }
      }
      // Doubles ATK case
      if (out.stats.length === 0 && /Doubles?\s+(\w+(?:\.\s*\w+)?)\s+on\s+first/i.test(desc)) {
        const dm = desc.match(/Doubles?\s+(\w+(?:\.\s*\w+)?)\s+on\s+first/i);
        if (dm) {
          const stat = normalizeStat(dm[1].trim());
          if (stat) {
            out.stats.push({ stat, multiplier: 2 });
          }
        }
      }
      return out.stats.length > 0 ? out : null;
    },
  },

  // ── 51. stat-trigger-on-event — on-stat-lowered ────────────────────────
  {
    archetype: "stat-trigger-on-event",
    test: desc =>
      /When\s+a\s+stat\s+is\s+lowered/i.test(desc)
      || /Lowering\s+any\s+stats\s+on\s+its\s+side\s+(?:raises|boosts|ups)\s+\w+/i.test(desc),
    extract: desc => {
      const m = desc.match(/(?:raise|boost|up)s?\s+([\w.\s,]+?)(?:\.|$)/i);
      if (!m) {
        return { trigger: "on-stat-lowered", stats: [{ stat: "HIGHEST", stages: 2 }] };
      }
      const stats = m[1]
        .split(/\s*(?:,|and)\s*/i)
        .map(s => normalizeStat(s.trim()))
        .filter(Boolean)
        .map(stat => ({ stat, stages: /sharply/i.test(desc) ? 2 : 1 }));
      return { trigger: "on-stat-lowered", stats };
    },
  },

  // ── 52. accuracy-mod — "MOVE accuracy is N% / X% accuracy for FLAG" ────
  {
    archetype: "accuracy-mod",
    test: desc => /(?:accuracy\s+is\s+\d+%|\+\d+%?\s+accuracy)/i.test(desc),
    extract: desc => {
      const m1 = desc.match(/([\w\s]+?)\s+accuracy\s+is\s+(\d+)\s*%/i);
      if (m1) {
        return {
          filter: { moveId: m1[1].trim().toUpperCase().replace(/\s+/g, "_") },
          override: { mode: "set", value: Number(m1[2]) },
        };
      }
      const m2 = desc.match(/\+(\d+)\s*%\s+accuracy/i);
      if (m2) {
        return { filter: { tag: "all" }, override: { mode: "delta", value: Number(m2[1]) } };
      }
      return null;
    },
  },

  // ── 53. type-resist-or-absorb — "Halves dmg taken by TYPE moves" ───────
  // Catches "Halves dmg taken by Rock moves." (also handled by #28 but sometimes #28
  // misses single-type captures).
  {
    archetype: "type-resist-or-absorb",
    test: desc =>
      new RegExp(`Halves\\s+(?:dmg|damage)\\s+(?:taken\\s+)?by\\s+(${TYPE_RE_SRC})\\s+moves?`, "i").test(desc),
    extract: desc => {
      const m = desc.match(
        new RegExp(`Halves\\s+(?:dmg|damage)\\s+(?:taken\\s+)?by\\s+(${TYPE_RE_SRC})\\s+moves?`, "i"),
      );
      if (!m) {
        return null;
      }
      return { type: normalizeType(m[1]), effect: { kind: "resist", multiplier: 0.5 } };
    },
  },

  // ── 54. type-resist-or-absorb — Immune to TYPE attacks ─────────────────
  {
    archetype: "type-resist-or-absorb",
    test: desc => new RegExp(`Immune\\s+to\\s+(${TYPE_RE_SRC})[- ]?type\\s+(?:attacks|moves)`, "i").test(desc),
    extract: desc => {
      const m = desc.match(new RegExp(`Immune\\s+to\\s+(${TYPE_RE_SRC})[- ]?type\\s+(?:attacks|moves)`, "i"));
      if (!m) {
        return null;
      }
      return { type: normalizeType(m[1]), effect: { kind: "resist", multiplier: 0 } };
    },
  },

  // ── 55. damage-reduction-generic — weather-conditional ─────────────────
  // "Takes 50% less damage if hail is active."
  {
    archetype: "damage-reduction-generic",
    test: desc => /Takes?\s+\d+%\s+less\s+damage\s+if\s+\w+\s+is\s+active/i.test(desc),
    extract: desc => {
      const m = desc.match(/Takes?\s+(\d+)%\s+less\s+damage\s+if\s+(\w+)\s+is\s+active/i);
      if (!m) {
        return null;
      }
      const weather = normalizeWeather(m[2]);
      return {
        filter: { kind: "weather", ...(weather ? { weather } : { weatherRaw: m[2] }) },
        reduction: Number(m[1]) / 100,
      };
    },
  },

  // ── 56. chance-status-on-hit — "FLAG moves have N% chance to (cause|inflict|STATUS)" ───
  {
    archetype: "chance-status-on-hit",
    test: desc =>
      /\b(?:punching|biting|slashing|slicing|kicking|sound|sound-based|hammer|pulse|dance|wind|arrow|horn|aura|air|wing|bone|keen\s+edge|mega\s+launcher|iron\s+fist|grass|fire|water|electric|ice|fighting|poison|ground|flying|psychic|bug|rock|ghost|dragon|dark|steel|fairy|normal)\s+moves?\s+have\s+(?:a\s+)?\d+\s*%\s+(?:chance\s+to\s+(?:cause|inflict|get\s+\w+ed|\w+))?[^.]*?(?:burn|paralyz|poison|sleep|freez|frostbit|confus|infatuat|drowsy|bleed|flinch|fear|disable|trap)/i.test(
        desc,
      ),
    extract: desc => {
      const m = desc.match(
        /\b(\w+(?:[- ]\w+)?)\s+moves?\s+have\s+(?:a\s+)?(\d+)\s*%\s+(?:chance\s+to\s+(?:cause|inflict|\w+ed)?\s+)?[^.]*?\b(burn|paralyz\w*|poison|sleep|freeze|frostbit\w*|confus\w+|infatuat\w+|drowsy|bleed|flinch|fear|disable|trap)/i,
      );
      if (!m) {
        return null;
      }
      const flag = normalizeFlag(m[1]);
      const type = normalizeType(m[1]);
      const status = normalizeStatus(m[3]) ?? m[3].toUpperCase();
      const out = { chance: Number(m[2]), status };
      if (flag) {
        out.filter = { flag };
      } else if (TYPE_NAMES.includes(m[1].toLowerCase())) {
        out.filter = { type };
      }
      return out;
    },
  },

  // ── 57. chance-status-on-hit — "Contact moves have N% chance" ──────────
  {
    archetype: "chance-status-on-hit",
    test: desc =>
      /Contact\s+moves?\s+have\s+(?:a\s+)?\d+\s*%\s+chance\s+to\s+(?:burn|paralyz|poison|sleep|freez|frostbit|confus|infatuat|drowsy|bleed|flinch|fear|disable|trap)/i.test(
        desc,
      ),
    extract: desc => {
      const m = desc.match(/Contact\s+moves?\s+have\s+(?:a\s+)?(\d+)\s*%\s+chance\s+to\s+(\w+)/i);
      if (!m) {
        return null;
      }
      const status = normalizeStatus(m[2]) ?? m[2].toUpperCase();
      return { chance: Number(m[1]), status, onContactOnly: true };
    },
  },

  // ── 58. chance-status-on-hit — "Burns/Paralyzes/etc. the foe on contact" ─
  // "Daybreak — Burns the foe on contact. Also works on offense."
  {
    archetype: "chance-status-on-hit",
    test: desc =>
      /(?:Burns?|Paralyzes?|Poisons?|Sleeps?|Freezes?|Frostbites?|Confuses?|Infatuates?|Bleeds?)\s+(?:the\s+)?foe\s+on\s+contact/i.test(
        desc,
      ),
    extract: desc => {
      const m = desc.match(
        /(Burns?|Paralyz\w+|Poison\w*|Sleep\w*|Freez\w+|Frostbit\w*|Confus\w+|Infatuat\w+|Bleed\w*)\s+(?:the\s+)?foe\s+on\s+contact/i,
      );
      if (!m) {
        return null;
      }
      const status = normalizeStatus(m[1]) ?? m[1].toUpperCase();
      return { chance: 100, status, onContactOnly: true };
    },
  },

  // ── 59. damage-reduction-generic — "Reduces special damage by N%" ──────
  {
    archetype: "damage-reduction-generic",
    test: desc => /Reduces?\s+(?:special|physical)\s+damage\s+(?:taken\s+)?by\s+\d+%/i.test(desc),
    extract: desc => {
      const m = desc.match(/Reduces?\s+(special|physical)\s+damage\s+(?:taken\s+)?by\s+(\d+)%/i);
      if (!m) {
        return null;
      }
      return { filter: { kind: m[1].toLowerCase() }, reduction: Number(m[2]) / 100 };
    },
  },

  // ── 40. move-replacement ────────────────────────────────────────────────
  // "X is altered drastically" / "X becomes Y" / "X moves now inflict Y"
  {
    archetype: "move-replacement",
    test: desc =>
      /(?:is\s+altered\s+drastically|drastically\s+alters\s+all)/i.test(desc)
      || /(?:Electric|Fire|Water|Grass|Psychic|Dark|Ice|Ghost)\s+(?:type\s+)?moves?\s+now\s+inflict\s+\w+\s+instead\s+of\s+\w+/i.test(
        desc,
      ),
    extract: desc => {
      if (/all\s+of\s+(?:the\s+)?(?:user'?s|its)\s+moves/i.test(desc)) {
        return { mode: "all-moves" };
      }
      const m = desc.match(
        new RegExp(`(${TYPE_RE_SRC})\\s+type\\s+moves?\\s+now\\s+inflict\\s+(\\w+)\\s+instead\\s+of\\s+(\\w+)`, "i"),
      );
      if (m) {
        return {
          mode: "type-status-swap",
          type: normalizeType(m[1]),
          newStatus: m[2].toUpperCase(),
          oldStatus: m[3].toUpperCase(),
        };
      }
      // "Roar of Time is altered drastically"
      const single = desc.match(/^([\w\s]+?)\s+is\s+altered\s+drastically/i);
      if (single) {
        return { mode: "single-move", originalMove: single[1].trim().toUpperCase().replace(/\s+/g, "_") };
      }
      return null;
    },
  },
];

// =============================================================================
// Classify driver
// =============================================================================

/**
 * @param {AbilityDraft} ability
 * @returns {{ archetype: string, params: Record<string, unknown> | null, paramsParseFailed: boolean }}
 */
export function classify(ability) {
  if (!ability || !ability.description) {
    return { archetype: "bespoke", params: null, paramsParseFailed: false };
  }
  // Skip the empty "-------" slot
  if (ability.name === "-------" || ability.description === "Empty ability slot.") {
    return { archetype: "bespoke", params: null, paramsParseFailed: false };
  }
  for (const c of CLASSIFIERS) {
    if (c.test(ability.description, ability)) {
      const params = c.extract(ability.description, ability);
      return { archetype: c.archetype, params, paramsParseFailed: params === null };
    }
  }
  return { archetype: "bespoke", params: null, paramsParseFailed: false };
}

/** All 23 archetype slugs the C1 primitive layer implements + composite + bespoke. */
const ARCHETYPE_SLUGS = [
  "type-damage-boost",
  "flag-damage-boost",
  "priority-modifier",
  "entry-effect",
  "chance-status-on-hit",
  "crit-mod",
  "damage-reduction-generic",
  "passive-recovery",
  "lifesteal",
  "stat-trigger-on-event",
  "type-conversion",
  "type-resist-or-absorb",
  "type-effectiveness-override",
  "composite-vanilla-mashup",
  "weather-or-terrain-interaction",
  "multi-hit-override",
  "accuracy-mod",
  "proc-followup-attack",
  "on-hit-counter-attack",
  "status-immunity",
  "conditional-damage",
  "form-change",
  "move-replacement",
  "bespoke",
];

/**
 * Parse the `ER_ABILITIES` array literal out of er-abilities.ts. The auto-
 * generated body is JSON-safe so we can JSON.parse the `[...]` block directly.
 */
export function parseErAbilities(text) {
  const m = text.match(/export const ER_ABILITIES[^=]*=\s*(\[[\s\S]*?\])\s*as const;/);
  if (!m) {
    throw new Error("classify-abilities: couldn't find ER_ABILITIES export in er-abilities.ts");
  }
  return JSON.parse(m[1]);
}

/**
 * Emit the body of `er-ability-archetypes.ts`. Pure — no IO — so tests can
 * exercise it with synthetic input.
 * @param {{ erAbilityId: number, archetype: string, params: object | null }[]} entries
 */
export function emitArchetypesBody(entries) {
  // Sort by id ascending for stable output.
  const sorted = [...entries].sort((a, b) => a.erAbilityId - b.erAbilityId);
  const unionType = ARCHETYPE_SLUGS.map(s => `  | ${JSON.stringify(s)}`).join("\n");
  const tableEntries = sorted
    .map(e => {
      const params = e.params === null ? "null" : JSON.stringify(e.params);
      return `  ${e.erAbilityId}: { erAbilityId: ${e.erAbilityId}, archetype: ${JSON.stringify(
        e.archetype,
      )}, params: ${params} },`;
    })
    .join("\n");
  return `// Phase C task C2: auto-classified ER abilities → archetype primitives.
//
// This table maps each ER-custom ability id to the archetype primitive that
// implements it, plus a JSON-serializable \`params\` object the wiring step
// will feed to the primitive's constructor. \`archetype: "bespoke"\` means
// the ability didn't match any archetype shape and will need a hand-written
// implementation (the "long tail" of ~280 abilities per the taxonomy doc).
//
// Regenerate with: \`pnpm run er:classify-abilities\`.

export type ErArchetypeKind =
${unionType};

export interface ErAbilityArchetypeEntry {
  readonly erAbilityId: number;
  readonly archetype: ErArchetypeKind;
  readonly params: Record<string, unknown> | null;
}

export const ER_ABILITY_ARCHETYPES: Readonly<Record<number, ErAbilityArchetypeEntry>> = {
${tableEntries}
};
`;
}

async function main() {
  const text = await readFile(ABILITIES_PATH, "utf8");
  const all = parseErAbilities(text);
  // Only auto-classify the unknown-archetype entries. Vanilla abilities aren't
  // included in the output table — they use pokerogue's existing implementations.
  const unknowns = all.filter(a => a.archetype === "unknown");

  const entries = [];
  const counts = Object.fromEntries(ARCHETYPE_SLUGS.map(s => [s, 0]));
  let parseFailed = 0;
  for (const a of unknowns) {
    const result = classify(a);
    counts[result.archetype] = (counts[result.archetype] ?? 0) + 1;
    if (result.paramsParseFailed) {
      parseFailed++;
    }
    entries.push({ erAbilityId: a.id, archetype: result.archetype, params: result.params });
  }

  const total = unknowns.length;
  const bespokeCount = counts.bespoke ?? 0;
  const classified = total - bespokeCount;
  const pct = total === 0 ? 0 : (classified / total) * 100;

  console.log("# C2 classification report");
  console.log(`Total unknown abilities scanned: ${total}`);
  console.log(`Auto-classified into archetypes: ${classified} (${pct.toFixed(1)}%)`);
  console.log(`Bespoke (no match):              ${bespokeCount}`);
  console.log(`Param-parse failures:            ${parseFailed}`);
  console.log();
  console.log("Per-archetype counts:");
  const sortedSlugs = ARCHETYPE_SLUGS.slice().sort((a, b) => counts[b] - counts[a]);
  for (const slug of sortedSlugs) {
    if (counts[slug] > 0) {
      console.log(`  ${slug}: ${counts[slug]}`);
    }
  }

  const body = emitArchetypesBody(entries);
  await emitModule(OUT_PATH, body);
  console.log();
  console.log(`Wrote ${entries.length} entries → ${OUT_PATH}`);
}

const ENTRY = resolve(process.argv[1] ?? "");
const SELF = fileURLToPath(import.meta.url);
if (ENTRY === SELF) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
