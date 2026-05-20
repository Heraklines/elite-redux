/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Cluster the ER-custom abilities/moves by normalized description shape.
 *
 * Phase A task A17: this script reads the auto-generated
 * `src/data/elite-redux/er-abilities.ts` and `er-moves.ts`, filters down to
 * entries with `archetype: "unknown"`, normalizes each description (strip
 * numerals/percentages/type names/etc.), groups by the normalized string,
 * and prints a frequency-sorted cluster report to stdout.
 *
 * The output is the raw material for the hand-curated archetype taxonomy
 * doc at `docs/plans/elite-redux-archetype-taxonomy.md`, which Phase C will
 * implement against.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");

const TYPE_NAMES = [
  "fire",
  "water",
  "grass",
  "electric",
  "ice",
  "fighting",
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

// Multi-word forms come first; alternation is left-to-right so the longest
// match wins for shared prefixes (e.g., "special attack" before "attack").
const STAT_NAMES = [
  "special attack",
  "special defense",
  "sp\\. ?atk\\.?",
  "sp\\. ?def\\.?",
  "sp ?atk",
  "sp ?def",
  "spatk",
  "spdef",
  "attack",
  "defense",
  "speed",
  "accuracy",
  "evasion",
  "atk",
  "def",
  "spd",
];

const STATUS_NAMES = [
  "badly poison",
  "badly poisoned",
  "burn",
  "burned",
  "burning",
  "paralyze",
  "paralyzed",
  "paralysis",
  "poison",
  "poisoned",
  "poisoning",
  "sleep",
  "asleep",
  "sleeping",
  "frozen",
  "freeze",
  "confuse",
  "confused",
  "confusion",
  "infatuate",
  "infatuated",
  "infatuation",
  "drowsy",
  "drowse",
  "bleed",
  "bleeding",
  "toxic",
];

const WEATHER_NAMES = [
  "harsh sunlight",
  "sandstorm",
  "sunny",
  "raining",
  "snowing",
  "rain",
  "hail",
  "snow",
  "fog",
  "sun",
];

const TERRAIN_NAMES = [
  "electric terrain",
  "grassy terrain",
  "psychic terrain",
  "misty terrain",
  "toxic terrain",
  "terrain",
];

const HAZARD_NAMES = ["stealth rock", "stealth rocks", "spikes", "toxic spikes", "sticky web", "hazards"];

const TYPE_RE = new RegExp(`\\b(${TYPE_NAMES.join("|")})\\b`, "g");
const STAT_RE = new RegExp(`\\b(${STAT_NAMES.join("|")})\\b`, "g");
const STATUS_RE = new RegExp(`\\b(${STATUS_NAMES.join("|")})\\b`, "g");
const WEATHER_RE = new RegExp(`\\b(${WEATHER_NAMES.join("|")})\\b`, "g");
const TERRAIN_RE = new RegExp(`\\b(${TERRAIN_NAMES.join("|")})\\b`, "g");
const HAZARD_RE = new RegExp(`\\b(${HAZARD_NAMES.join("|")})\\b`, "g");

// Synonymous phrases that should collapse to a single canonical form so
// semantically-equivalent clusters merge. Each pair is `[regex, replacement]`.
// Applied AFTER token-class substitution (TYPE/STAT/etc.) but BEFORE
// whitespace/punctuation cleanup.
const PHRASE_SUBSTITUTIONS = [
  // HP threshold phrasings: "below 1/3 HP", "under 1/3 HP", "at low HP",
  // "when below N/N HP" all express the same trigger.
  [/\b(below|under|at or below|at)\s+(low\s+hp|N\/N\s+hp|N%?\s+hp|hp\s+of\s+N(\/N|%)?)\b/g, "LOW_HP"],
  [/\bat\s+low\s+hp\b/g, "LOW_HP"],
  [/\b(at|when at)\s+max\s+hp\b/g, "MAX_HP"],
  [/\bat\s+full\s+hp\b/g, "MAX_HP"],
  // Boost wording: "boosts the power of", "boosts", "ups", "raises the power of"
  // → BOOSTS (only when followed by a TYPE/MOVE/STAT context).
  [/\b(boosts\s+the\s+power\s+of|raises\s+the\s+power\s+of|powers\s+up|ups\s+the\s+power\s+of)\b/g, "BOOSTS"],
  [/\b(boosts|raises|increases|ups)\b/g, "BOOSTS"],
  // Damage reduction phrasings
  [/\btakes\s+P%\s+less\s+damage\b/g, "TAKES_LESS_DAMAGE"],
  [/\bhalves\s+(damage|dmg)\b/g, "TAKES_LESS_DAMAGE"],
  [/\btakes\s+N\/N\s+(damage|dmg)\b/g, "TAKES_LESS_DAMAGE"],
  // Entry-effect phrasings
  [/\b(on|upon)\s+(entry|switch[- ]?in|switching\s+in)\b/g, "ON_ENTRY"],
  // KO triggers
  [/\b(after\s+a\s+ko|upon\s+a\s+ko|when\s+it\s+kos|kos)\b/g, "ON_KO"],
  // Stat-stage delta wording: "raises STAT by N stage(s)", "by one stage" → +N STAT
  [/\bby\s+one\s+stage\b/g, "by N stage"],
  [/\bby\s+(N|P%)\s+stages?\b/g, "by N stage"],
  [/\b\+N\s+stages?\b/g, "+N stage"],
  // Contact-move wording
  [/\bon\s+contact\b/g, "ON_CONTACT"],
  [/\bcontact\s+moves?\b/g, "CONTACT_MOVE"],
  // Common move-flag categories (will be treated as FLAG groups)
  [
    /\b(punching|biting|slashing|sound|sound-based|sound based|kicking|hammer|hammer-based|pulse|pulse-based|projectile)\s+moves?\b/g,
    "FLAG_moves",
  ],
  // Move/ability proper-noun residue: capitalized words inside quotes etc.
  // Already lowercased above; leave alone.
];

/**
 * Normalize a description string for clustering. Strips numerals, percentages,
 * type names, stat names, status names, weather/terrain references, and
 * collapses synonymous phrasings ("below 1/3 HP" / "under 1/3 HP" / "at low
 * HP" → LOW_HP, etc.). The output is a coarse shape — different abilities
 * with the same parameterized behavior collide on the same key.
 */
function normalizeDescription(desc) {
  if (!desc) {
    return "";
  }
  let s = desc
    .toLowerCase()
    .replace(/\bpokémon\b/g, "pokemon")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\d+(\.\d+)?\s*%/g, "P%") // "30%", "12.5 %" → P%
    .replace(/\d+(\.\d+)?\s*x/g, "Nx") // "1.5x", "2 x" → Nx
    .replace(/\d+\/\d+/g, "N/N") // "1/4", "1/16" → N/N
    .replace(/\b\d+(\.\d+)?\b/g, "N") // bare numerals → N
    .replace(HAZARD_RE, "HAZARD")
    .replace(TERRAIN_RE, "TERRAIN")
    .replace(WEATHER_RE, "WEATHER")
    .replace(STATUS_RE, "STATUS")
    .replace(STAT_RE, "STAT")
    .replace(TYPE_RE, "TYPE")
    .replace(/\b(physical|special)\b/g, "SPLIT");
  for (const [re, repl] of PHRASE_SUBSTITUTIONS) {
    s = s.replace(re, repl);
  }
  return s
    .replace(/[.,!?;:()"']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse a `as const` typed array literal from an ER data module. The auto-
 * generated files use JSON-safe object literals inside the array, so we can
 * locate the `[…]` block by regex and JSON.parse it directly.
 */
function parseEntriesFromGen(text, exportName) {
  const re = new RegExp(`export const ${exportName}[^=]*=\\s*(\\[[\\s\\S]*?\\])\\s*as const;`);
  const m = re.exec(text);
  if (!m) {
    throw new Error(`Couldn't find ${exportName} export`);
  }
  return JSON.parse(m[1]);
}

async function main() {
  const abilitiesText = await readFile(resolve(ROOT, "src/data/elite-redux/er-abilities.ts"), "utf8");
  const movesText = await readFile(resolve(ROOT, "src/data/elite-redux/er-moves.ts"), "utf8");

  const abilities = parseEntriesFromGen(abilitiesText, "ER_ABILITIES");
  const moves = parseEntriesFromGen(movesText, "ER_MOVES");

  /** @type {Map<string, { abilities: any[], moves: any[] }>} */
  const clusters = new Map();

  for (const a of abilities) {
    if (a.archetype !== "unknown") {
      continue;
    }
    const norm = normalizeDescription(a.description);
    if (!norm) {
      continue;
    }
    if (!clusters.has(norm)) {
      clusters.set(norm, { abilities: [], moves: [] });
    }
    clusters.get(norm).abilities.push(a);
  }

  for (const m of moves) {
    if (m.archetype !== "unknown") {
      continue;
    }
    // Moves get longer descriptions; longDescription tends to be more
    // informative (the short `description` is often a UI-cropped fragment).
    const text = m.longDescription || m.description || "";
    const norm = normalizeDescription(text);
    if (!norm) {
      continue;
    }
    if (!clusters.has(norm)) {
      clusters.set(norm, { abilities: [], moves: [] });
    }
    clusters.get(norm).moves.push(m);
  }

  const sorted = [...clusters.entries()]
    .map(([norm, { abilities: a, moves: mv }]) => ({
      norm,
      abilities: a,
      moves: mv,
      total: a.length + mv.length,
    }))
    .sort((p, q) => q.total - p.total);

  // Multi-entry clusters first (these are the archetype candidates); also
  // include the top-N singletons (when --all isn't passed) so reviewers can
  // see what's in the long tail without scrolling through every entry.
  const multis = sorted.filter(c => c.total >= 2);
  const singletons = sorted.filter(c => c.total === 1);
  const topN = multis.length + Math.min(20, singletons.length);
  console.log(`# Cluster report (top ${topN} of ${sorted.length} clusters)\n`);
  for (let i = 0; i < topN; i++) {
    const c = sorted[i];
    console.log(`## Cluster ${i + 1} (size ${c.total}: ${c.abilities.length} abilities + ${c.moves.length} moves)`);
    console.log(`Normalized: ${c.norm.slice(0, 240)}${c.norm.length > 240 ? "…" : ""}`);
    if (c.abilities.length > 0) {
      const sample = c.abilities.slice(0, 6).map(a => `${a.name} — "${a.description}"`);
      console.log("Sample abilities:");
      for (const s of sample) {
        console.log(`  - ${s}`);
      }
    }
    if (c.moves.length > 0) {
      const sample = c.moves.slice(0, 4).map(m => `${m.name} — "${m.longDescription || m.description}"`);
      console.log("Sample moves:");
      for (const s of sample) {
        console.log(`  - ${s}`);
      }
    }
    console.log();
  }

  // Frequency histogram (cluster size → number of clusters at that size).
  const sizeBuckets = new Map();
  for (const c of sorted) {
    sizeBuckets.set(c.total, (sizeBuckets.get(c.total) ?? 0) + 1);
  }
  console.log("# Cluster size histogram");
  for (const size of [...sizeBuckets.keys()].sort((a, b) => b - a)) {
    console.log(`  size ${size}: ${sizeBuckets.get(size)} clusters`);
  }
  console.log();

  // Keyword-bucket pass: most ER customs are unique sentences but they share
  // archetype "family" keywords. Buckets are overlapping (an entity can
  // belong to multiple) and intentionally fuzzy — useful as a hand-curation
  // aid, not as the final archetype assignment.
  //
  // Order matters: each entity is assigned to the FIRST matching bucket so
  // counts add up to roughly the unknown total.
  // Each entity is bucketed into the FIRST regex it matches (order matters —
  // the more specific patterns go first). Buckets that share an archetype
  // are merged in the hand-curated doc.
  const TYPE_RE_SRC =
    "fire|water|grass|electric|ice|fighting|poison|ground|flying|psychic|bug|rock|ghost|dragon|dark|steel|fairy|normal|elec\\.?";
  const WEATHER_RE_SRC = "sun|sunny|rain|hail|snow|sandstorm|fog|harsh sunlight|weather";
  const FLAG_RE_SRC =
    "punching|biting|slashing|sound[- ]?based|sound|kicking|hammer[- ]?based|hammer|pulse[- ]?based|pulse|projectile|aura|wind|dance|ball|bomb|stomping|crit|critical|multihit|iron fist|striker";
  const HAZARD_RE_SRC = "spikes|stealth rock|stealth rocks|toxic spikes|sticky web|hazards?";

  const KEYWORD_BUCKETS = [
    // ── Composite "X + Y" ER signature (overrides most other patterns) ──
    ["composite-vanilla-mashup", /^[^.]+\s+\+\s+[^.]+\.?$/i],

    // ── Entry / hazard / weather / terrain / room setters ──
    [
      "entry-setter-weather",
      new RegExp(
        `\\b(summons|sets|casts)\\b[^.]*?\\b(${WEATHER_RE_SRC})\\b[^.]*?\\b(on\\s+entry|switch[- ]?in|on\\s+switch)`,
        "i",
      ),
    ],
    [
      "entry-setter-terrain",
      /\b(summons|sets|casts)\b[^.]*?\b(electric terrain|grassy terrain|psychic terrain|misty terrain|toxic terrain|terrain)\b[^.]*?\b(on\s+entry|switch[- ]?in|on\s+switch)/i,
    ],
    [
      "entry-setter-hazard",
      new RegExp(
        `\\b(spreads|sets|casts)\\b[^.]*?\\b(${HAZARD_RE_SRC})\\b[^.]*?\\b(on\\s+entry|switch[- ]?in|on\\s+switch)`,
        "i",
      ),
    ],
    [
      "entry-setter-screen-room",
      /\b(sets|casts|summons)\b[^.]*?\b(reflect|light screen|aurora veil|tailwind|trick room|magic room|wonder room|gravity|defense curl|stat boost)\b[^.]*?\b(on\s+entry|switch[- ]?in|on\s+switch|for|lasts)/i,
    ],
    ["entry-add-type", /\badds?\s+\w+\s*type\s+on\s+(entry|switch)/i],
    [
      "entry-stat-boost",
      /\b(\+\d+\s+(?:atk|def|spa(?:tk)?|spd(?:ef)?|speed|attack|defense|sp\.?\s*atk\.?|sp\.?\s*def\.?))\b[^.]*?\b(on\s+entry|switch[- ]?in)/i,
    ],
    ["entry-misc", /\bon\s+(entry|switch[- ]?in|switching\s+in)\b/i],

    // ── Damage-boost families ──
    // "Boosts own X-type moves by …" and "boost X-type moves …" (no hyphen
    // required between word and "type" — handles "Elec.-type", "Dark moves").
    [
      "type-damage-boost",
      new RegExp(
        `\\b(boost|raise|up|increase)s?\\b[^.]*?\\b(${TYPE_RE_SRC})[- ]?(?:type)?\\s+(?:moves?|attacks?)\\b`,
        "i",
      ),
    ],
    [
      "flag-damage-boost",
      new RegExp(`\\b(boost|raise|up|increase)s?\\b[^.]*?\\b(${FLAG_RE_SRC})[- ]?\\s*moves?\\b`, "i"),
    ],
    [
      "stab-or-style-boost",
      /\b(stab|all moves|all attacks|all of its moves|gains? stab)\b[^.]*?\b(\d+(\.\d+)?x|by \d+)/i,
    ],

    // ── Damage reduction / resistance ──
    [
      "type-resist",
      new RegExp(
        `\\b(takes?|halves?|reduces?|negates?)\\b[^.]*?\\b(${TYPE_RE_SRC})[- ]?(?:type)?\\s+(?:moves?|attacks?|damage)`,
        "i",
      ),
    ],
    [
      "split-damage-reduction",
      /\b(takes?|halves?)\b[^.]*?\b(physical|special|contact)\b[^.]*?\b(moves?|attacks?|damage|dmg)/i,
    ],
    ["super-effective-resist", /\b(super[- ]effective|supereffective)\b[^.]*?\bdamage\b/i],
    ["damage-reduction-generic", /\btakes?\s+\d+%?\s*(less|lower)\s+damage\b/i],

    // ── Triggered absorb / heal ──
    [
      "type-absorb-heal",
      new RegExp(`\\bheal(?:s|ed)?\\b[^.]*?\\b(when|if|by|hit by)\\b[^.]*?\\b(${TYPE_RE_SRC})[- ]?(?:type)?`, "i"),
    ],
    ["ko-heal", /\b(ko|kos|knock\s?out|dealing\s+a\s+ko|when\s+it\s+kos|after\s+a\s+ko)\b[^.]*?\bheal/i],

    // ── Stat-trigger on event ──
    [
      "ko-stat-trigger",
      /\b(ko|kos|knock\s?out|after\s+a\s+ko|upon\s+a\s+ko|when\s+it\s+kos)\b[^.]*?\b(raise|boost|up|increase|\+\d)/i,
    ],
    [
      "hit-stat-trigger",
      /\b(when hit|on being hit|on hit|upon being hit|getting hit|if hit by)\b[^.]*?\b(raise|boost|up|increase|\+\d)/i,
    ],

    // ── On-hit / on-contact effects ──
    [
      "status-on-contact",
      /\b(on\s+contact|when\s+hit)\b[^.]*?\b(burn|paralyz|poison|sleep|frozen|confus|infatuat|drowsy|bleed)/i,
    ],
    [
      "chance-status-on-hit",
      /\b\d+%\s+chance\s+to\s+(burn|paralyz|poison|sleep|freeze|confus|infatuat|drowsy|bleed|flinch|badly\s+poison)/i,
    ],

    // ── Type-conversion / move-type modification ──
    [
      "type-conversion",
      new RegExp(
        `\\b(normal moves become|moves become|turns? into|change into|convert)\\b[^.]*?\\b(${TYPE_RE_SRC})\\b`,
        "i",
      ),
    ],
    // Type-flag changes: "Sound moves get a 1.2x boost and become X if Normal"
    ["categorical-type-change", new RegExp(`\\b(${FLAG_RE_SRC})\\s+moves?\\b[^.]*?\\bbecome\\b`, "i")],

    // ── Move replacement ──
    ["move-replacement", /\b[A-Za-z][\w' -]*\s+becomes?\s+[A-Za-z][\w' -]*/i],

    // ── Priority modifiers ──
    ["priority-modifier", /\b\+\d+\s+priority\b/i],

    // ── Weather/terrain stat interactions ──
    [
      "weather-stat-boost",
      new RegExp(`\\b(boost|raise|up|increase)s?\\b[^.]*?\\b(in|during|while)\\b[^.]*?(${WEATHER_RE_SRC})`, "i"),
    ],
    ["terrain-stat-boost", /\b(boost|raise|up|increase)s?\b[^.]*?\b(in|during|while)\b[^.]*?\bterrain\b/i],

    // ── Immunity / status block ──
    ["type-immunity", new RegExp(`\\bimmune\\s+to\\b[^.]*?\\b(${TYPE_RE_SRC})[- ]?type`, "i")],
    [
      "status-immunity",
      /\b(cannot be|immune to)\b[^.]*?\b(burn|paralyz|poison|sleep|frozen|freeze|confus|infatuat|drowsy|bleed|status|intimidate|scare|taunt)/i,
    ],

    // ── Healing / recovery ──
    [
      "passive-recovery",
      /\b(recovers?|heals?|restores?)\b[^.]*?\b(\d+\/\d+|\d+%|max\s+hp|hp)\b[^.]*?\b(end of (each )?turn|each turn|every turn)\b/i,
    ],
    ["damage-deal-heal", /\bheals?\b[^.]*?\b(damage they deal|of damage dealt|of damage done|of the damage)/i],
    ["heal-on-event", /\b(heals?|restores?)\b[^.]*?\b(\d+%|\d+\/\d+|max\s+hp)\b/i],

    // ── Generic stat-modification (broad catch) ──
    [
      "stat-trigger-other",
      /\b(raise|boost|up|increase|double)s?\b[^.]*?\b(atk|def|spa(?:tk)?|spd(?:ef)?|speed|attack|defense|sp\.?\s*atk\.?|sp\.?\s*def\.?|highest)\b/i,
    ],

    // ── Misc behavioural buckets ──
    ["form-change", /\b(forme?|transforms?|changes\s+forme?)\b/i],
    ["pp-tax", /\bpp\b/i],
    ["accuracy-mod", /\baccuracy\b/i],
    ["crit-mod", /\b(critical|crit)\b/i],
  ];

  function bucketize(text) {
    const out = [];
    for (const [name, re] of KEYWORD_BUCKETS) {
      if (re.test(text)) {
        out.push(name);
      }
    }
    return out;
  }

  const bucketCounts = new Map();
  for (const a of abilities) {
    if (a.archetype !== "unknown") {
      continue;
    }
    const labels = bucketize(a.description);
    const label = labels[0] ?? "unbucketed";
    bucketCounts.set(label, (bucketCounts.get(label) ?? 0) + 1);
  }
  for (const m of moves) {
    if (m.archetype !== "unknown") {
      continue;
    }
    const text = m.longDescription || m.description || "";
    const labels = bucketize(text);
    const label = labels[0] ?? "unbucketed";
    bucketCounts.set(label, (bucketCounts.get(label) ?? 0) + 1);
  }

  console.log("# Keyword-bucket counts (first-match-wins, abilities+moves)");
  const bucketsSorted = [...bucketCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [name, count] of bucketsSorted) {
    console.log(`  ${name}: ${count}`);
  }
  console.log();

  // Print 30 sample unbucketed entries so the long-tail texture is visible
  // in the report (useful for adding more buckets later).
  const unbucketedSamples = [];
  for (const a of abilities) {
    if (a.archetype !== "unknown") {
      continue;
    }
    if (bucketize(a.description).length === 0) {
      unbucketedSamples.push(`  - [A] ${a.name}: "${a.description}"`);
    }
  }
  for (const m of moves) {
    if (m.archetype !== "unknown") {
      continue;
    }
    const text = m.longDescription || m.description || "";
    if (bucketize(text).length === 0) {
      unbucketedSamples.push(`  - [M] ${m.name}: "${text}"`);
    }
  }
  console.log("# Sample unbucketed entries (first 40 of " + unbucketedSamples.length + ")");
  const limit = process.argv.includes("--all-unbucketed") ? unbucketedSamples.length : 40;
  for (const s of unbucketedSamples.slice(0, limit)) {
    console.log(s);
  }
  console.log();

  const unknownAbilities = abilities.filter(a => a.archetype === "unknown");
  const unknownMoves = moves.filter(m => m.archetype === "unknown");
  const singletonClusters = sorted.filter(c => c.total === 1).length;
  const top10Coverage = sorted.slice(0, 10).reduce((sum, c) => sum + c.total, 0);
  const top20Coverage = sorted.slice(0, 20).reduce((sum, c) => sum + c.total, 0);
  const top30Coverage = sorted.slice(0, 30).reduce((sum, c) => sum + c.total, 0);
  const totalUnknowns = unknownAbilities.length + unknownMoves.length;

  console.log("# Summary");
  console.log(`Total unknown abilities: ${unknownAbilities.length}`);
  console.log(`Total unknown moves: ${unknownMoves.length}`);
  console.log(`Total clustered entities: ${totalUnknowns}`);
  console.log(`Total clusters: ${sorted.length}`);
  console.log(`Singleton clusters (long-tail candidates): ${singletonClusters}`);
  console.log(
    `Top-10 cluster coverage: ${top10Coverage}/${totalUnknowns} (${((top10Coverage / totalUnknowns) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Top-20 cluster coverage: ${top20Coverage}/${totalUnknowns} (${((top20Coverage / totalUnknowns) * 100).toFixed(1)}%)`,
  );
  console.log(
    `Top-30 cluster coverage: ${top30Coverage}/${totalUnknowns} (${((top30Coverage / totalUnknowns) * 100).toFixed(1)}%)`,
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
