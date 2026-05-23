/*
 * One-shot audit: detect mechanic differences between vanilla pokerogue moves
 * and ER's v2.65 version of the same moves. Numeric-only changes are skipped
 * (already handled by init-elite-redux-vanilla-rebalance.ts).
 *
 * Emits a side-by-side TSV to scripts/elite-redux/tmp-move-audit-sidebyside.tsv
 * and a summary classification to stdout.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const JSON_PATH = resolve(ROOT, "vendor/elite-redux/v2.65beta.json");
const MOVE_TS = resolve(ROOT, "src/data/moves/move.ts");
const MOVE_LOCALE = resolve(ROOT, "locales/en/move.json");
const MOVE_ID_TS = resolve(ROOT, "src/enums/move-id.ts");
const ID_MAP = resolve(ROOT, "src/data/elite-redux/er-id-map.ts");
const OUT_TSV = resolve(__dirname, "tmp-move-audit-sidebyside.tsv");

// === Load ER JSON ===
const erBlob = JSON.parse(await readFile(JSON_PATH, "utf8"));
const erMoves = erBlob.moves;
const splitT = erBlob.splitT; // PHYSICAL, SPECIAL, STATUS, USE_HIGHEST_OFFENSE, HITS_DEF, USE_HIGHEST_DAMAGE, HITS_SPDEF
const targetT = erBlob.targetT;
const effT = erBlob.effT;
const flagsT = erBlob.flagsT;
const typeT = erBlob.typeT;

// === Load id map (for reference only — we re-derive by NAME below) ===
const idMapSrc = await readFile(ID_MAP, "utf8");
const movesSection = idMapSrc.match(/"moves":\s*\{([\s\S]*?)\n {2}\}/);
const erIdToPgIdViaMap = {};
if (movesSection) {
  const re = /"(\d+)":\s*(\d+)/g;
  let m;
  while ((m = re.exec(movesSection[1])) !== null) {
    erIdToPgIdViaMap[Number(m[1])] = Number(m[2]);
  }
}

// === Load MoveId enum to map enum-index to canonical name ===
const enumSrc = await readFile(MOVE_ID_TS, "utf8");
const enumNames = [];
const enumLineRe = /^\s+([A-Z][A-Z0-9_]*),?\s*$/gm;
let em;
while ((em = enumLineRe.exec(enumSrc)) !== null) {
  enumNames.push(em[1]);
}
// First entry is NONE -> id 0
const pgIdToName = {};
const pgNameToId = {};
enumNames.forEach((n, i) => {
  pgIdToName[i] = n;
  pgNameToId[n] = i;
});

// === Load pokerogue locale (for canonical descriptions) ===
const localeBlob = JSON.parse(await readFile(MOVE_LOCALE, "utf8"));

function constToCamel(c) {
  return c
    .toLowerCase()
    .split("_")
    .map((p, i) => (i === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join("");
}

// === Parse move.ts initMoves() block ===
// Extract: name token, category, power, accuracy, pp, chance, priority, target chain, attrs.
const moveTsSrc = await readFile(MOVE_TS, "utf8");
const initStart = moveTsSrc.indexOf("export function initMoves()");
const initBody = moveTsSrc.slice(initStart);
const initEnd = initBody.indexOf("\n}\n");
const initBlock = initBody.slice(0, initEnd);

// We need to find each `new <X>Move(MoveId.NAME, ...)` and the chain that follows.
// The chain is the consecutive `.foo(...)` calls until the next `,\n    new ` or `)\n  );` end.
// Easiest: split on `\n    new ` boundaries.

// Replace newlines inside each block to make parsing easier
const lines = initBlock.split("\n");
// reconstruct entries by scanning
const entries = [];
let current = null;
for (const ln of lines) {
  if (/^ {4}new (AttackMove|StatusMove|SelfStatusMove|ChargingAttackMove|ChargingSelfStatusMove)\(/.test(ln)) {
    if (current) {
      entries.push(current);
    }
    current = { text: ln + "\n", startLine: ln };
  } else if (current) {
    current.text += ln + "\n";
  }
}
if (current) {
  entries.push(current);
}

// Parse each entry
const pgMoves = {}; // by name (POUND etc.)
for (const ent of entries) {
  const headRe =
    /new (AttackMove|StatusMove|SelfStatusMove|ChargingAttackMove|ChargingSelfStatusMove)\(MoveId\.([A-Z0-9_]+),\s*PokemonType\.([A-Z0-9_]+),(?:\s*MoveCategory\.([A-Z]+),)?\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(\d+)/;
  const m = ent.text.match(headRe);
  if (!m) {
    // Try the StatusMove signature (no category - implicit STATUS)
    const headRe2 =
      /new (AttackMove|StatusMove|SelfStatusMove|ChargingAttackMove|ChargingSelfStatusMove)\(MoveId\.([A-Z0-9_]+),\s*PokemonType\.([A-Z0-9_]+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(\d+)/;
    const m2 = ent.text.match(headRe2);
    if (!m2) {
      // skip - parsing failure (some entries have multi-line ctor args)
      // Try ANY pattern: capture class + name only
      const nm = ent.text.match(
        /new (AttackMove|StatusMove|SelfStatusMove|ChargingAttackMove|ChargingSelfStatusMove)\(MoveId\.([A-Z0-9_]+)/,
      );
      if (!nm) {
        continue;
      }
      pgMoves[nm[2]] = {
        cls: nm[1],
        name: nm[2],
        type: null,
        category: null,
        power: null,
        accuracy: null,
        pp: null,
        chance: null,
        priority: null,
        gen: null,
        attrs: [],
        target: null,
        text: ent.text,
      };
      // still record attrs
      const klass = nm[1];
      pgMoves[nm[2]].cls = klass;
      pgMoves[nm[2]].attrs = extractAttrs(ent.text);
      pgMoves[nm[2]].target = extractTarget(ent.text);
      continue;
    }
    pgMoves[m2[2]] = {
      cls: m2[1],
      name: m2[2],
      type: m2[3],
      category: m2[1] === "StatusMove" || m2[1] === "SelfStatusMove" ? "STATUS" : "?",
      power: Number(m2[1] === "StatusMove" || m2[1] === "SelfStatusMove" ? -1 : m2[4]),
      accuracy: Number(m2[4]),
      pp: Number(m2[5]),
      chance: Number(m2[6]),
      priority: Number(m2[7]),
      gen: Number(m2[8]),
      attrs: extractAttrs(ent.text),
      target: extractTarget(ent.text),
      text: ent.text,
    };
    continue;
  }
  pgMoves[m[2]] = {
    cls: m[1],
    name: m[2],
    type: m[3],
    category: m[4] || (m[1] === "StatusMove" || m[1] === "SelfStatusMove" ? "STATUS" : "?"),
    power: Number(m[5]),
    accuracy: Number(m[6]),
    pp: Number(m[7]),
    chance: Number(m[8]),
    priority: Number(m[9]),
    gen: Number(m[10]),
    attrs: extractAttrs(ent.text),
    target: extractTarget(ent.text),
    text: ent.text,
  };
}

function extractAttrs(text) {
  // Find all `.method(args)` calls. For .attr() returns the first arg class name.
  const out = [];
  // Match generic methods first
  const re = /\.([a-zA-Z][a-zA-Z0-9]*)\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
  }
  // Then specifically extract .attr(ClassName,...)
  const attrRe = /\.attr\(\s*([A-Z][A-Za-z0-9_]*)/g;
  while ((m = attrRe.exec(text)) !== null) {
    out.push(m[1]);
  }
  // Track StatStageChangeAttr with stat list and stages
  const statRe = /\.attr\(\s*StatStageChangeAttr,\s*\[\s*Stat\.([A-Z_]+)/g;
  while ((m = statRe.exec(text)) !== null) {
    out.push(`StatChange:${m[1]}`);
  }
  // Track status effect attrs
  const statusRe = /\.attr\(\s*StatusEffectAttr,\s*StatusEffect\.([A-Z_]+)/g;
  while ((m = statusRe.exec(text)) !== null) {
    out.push(`Status:${m[1]}`);
  }
  return out;
}
function extractTarget(text) {
  const m = text.match(/MoveTarget\.([A-Z_]+)/);
  return m ? m[1] : null;
}

// ER split index -> name
const erSplitName = i => splitT[i] || `SPLIT_${i}`;
const erTargetName = i => targetT[i] || `TARGET_${i}`;
const erEffectName = i => effT[i] || `EFFECT_${i}`;

// === Walk ER moves; re-match by NAME (the existing id-map has drift for Gen 9 entries) ===
const VANILLA_CUTOFF = 5000;
const audit = [];
const nameMatched = { matched: 0, drifted: 0, missing: 0 };
for (const erMove of erMoves) {
  if (!erMove || typeof erMove.id !== "number") {
    continue;
  }
  // Derive the canonical pokerogue MoveId name by stripping MOVE_ prefix.
  const erConst = erMove.NAME || "";
  if (!erConst.startsWith("MOVE_")) {
    continue;
  }
  const erBareName = erConst.slice(5);
  const pgId = pgNameToId[erBareName];
  if (pgId === undefined) {
    continue; // ER move with no vanilla counterpart
  }
  if (pgId === 0) {
    continue;
  }
  const pgName = erBareName;
  // Bookkeep drift between map and name
  const mappedTo = erIdToPgIdViaMap[erMove.id];
  if (mappedTo === pgId) {
    nameMatched.matched++;
  } else if (mappedTo !== undefined && mappedTo < VANILLA_CUTOFF) {
    nameMatched.drifted++;
  } else {
    nameMatched.missing++;
  }
  const pg = pgMoves[pgName];
  const localeKey = constToCamel(pgName);
  const localeDesc = localeBlob[localeKey]?.effect || "";

  audit.push({
    pgId,
    pgName,
    erId: erMove.id,
    erName: erMove.name,
    erConst: erMove.NAME,
    pgCategory: pg?.category || "?",
    erSplit: erSplitName(erMove.split),
    pgTarget: pg?.target || "?",
    erTarget: erTargetName(erMove.target),
    pgType: pg?.type || "?",
    erType: typeT[erMove.types?.[0] ?? 0] || "?",
    erType2: erMove.types?.length > 1 ? typeT[erMove.types[1]] : null,
    pgAttrs: pg?.attrs || [],
    pgFlagBuilders: extractFlagBuilders(pg?.attrs || []),
    erEffect: erEffectName(erMove.eff),
    pgChance: pg?.chance ?? -1,
    erChance: erMove.chance ?? 0,
    pgPriority: pg?.priority ?? 0,
    erPriority: erMove.prio ?? 0,
    erFlags: (erMove.flags || []).map(f => flagsT[f] || `F${f}`),
    pgDesc: localeDesc,
    erDesc: erMove.desc,
    erLongDesc: erMove.lDesc,
  });
}

// Pokerogue uses builder methods to set flags. Extract the ones we care about:
function extractFlagBuilders(attrs) {
  const flagSet = new Set();
  const map = {
    makesContact: "MAKES_CONTACT",
    punchingMove: "PUNCHING",
    bitingMove: "BITING",
    pulseMove: "PULSE",
    slicingMove: "SLICING",
    soundBased: "SOUND",
    windMove: "WIND",
    danceMove: "DANCE",
    ballBombMove: "BALL_BOMB",
    bullet: "BULLET",
    powderMove: "POWDER",
    triageMove: "TRIAGE",
    recklessMove: "RECKLESS",
    bypassesProtect: "BYPASS_PROTECT",
    ignoresSubstitute: "IGNORES_SUB",
    affectedByGravity: "GRAVITY",
  };
  for (const a of attrs) {
    if (map[a]) {
      flagSet.add(map[a]);
    }
  }
  return [...flagSet];
}

console.log(`Audited ${audit.length} moves.`);
console.log(
  `Name-match vs id-map: matched=${nameMatched.matched}, drifted=${nameMatched.drifted}, missing=${nameMatched.missing}`,
);

// === Write side-by-side TSV ===
const header = [
  "pgId",
  "pgName",
  "erId",
  "erConst",
  "pgCategory",
  "erSplit",
  "categoryDelta",
  "pgTarget",
  "erTarget",
  "targetDelta",
  "pgType",
  "erType",
  "typeDelta",
  "pgEffect_hint",
  "erEffect",
  "effectDelta",
  "pgPriority",
  "erPriority",
  "priorityDelta",
  "pgChance",
  "erChance",
  "chanceDelta",
  "pgFlags",
  "erFlags",
  "flagsDelta",
  "pgDesc",
  "erDesc",
].join("\t");
const rows = [header];

let categoryChanges = 0;
let targetChanges = 0;
let splitTypeChanges = 0;

for (const a of audit) {
  // Category comparison: ER split 0,1,2 = physical/special/status; 3-6 are special
  const erIsPhysical = a.erSplit === "PHYSICAL";
  const erIsSpecial = a.erSplit === "SPECIAL";
  const erIsStatus = a.erSplit === "STATUS";
  const erIsCustom = !erIsPhysical && !erIsSpecial && !erIsStatus;
  let catDelta = "";
  if (erIsCustom) {
    catDelta = `pg=${a.pgCategory} -> er=${a.erSplit}`;
  } else if (a.pgCategory === "PHYSICAL" && !erIsPhysical) {
    catDelta = `PHY->${a.erSplit}`;
  } else if (a.pgCategory === "SPECIAL" && !erIsSpecial) {
    catDelta = `SPC->${a.erSplit}`;
  } else if (a.pgCategory === "STATUS" && !erIsStatus) {
    catDelta = `STA->${a.erSplit}`;
  }
  if (catDelta) {
    categoryChanges++;
  }

  let targetDelta = "";
  // pokerogue MoveTarget names: NEAR_OTHER, NEAR_ENEMY, ALL_NEAR_ENEMIES, ALL_NEAR_OTHERS, ALL_ENEMIES, USER, ALL, ALL_OTHERS, NEAR_ALLY, ALLY, ENEMY_SIDE, USER_SIDE, USER_AND_ALLIES, USER_OR_NEAR_ALLY, RANDOM_NEAR_ENEMY, ATTACKER, BOTH_SIDES
  // ER targetT: SELECTED, BOTH, USER, RANDOM, FOES_AND_ALLY, DEPENDS, ALL_BATTLERS, OPPONENTS_FIELD, ALLY, USER_OR_ALLY
  const erT = a.erTarget;
  const pgT = a.pgTarget;
  // crude equivalence
  const targetEquivalent = (pgT, erT) => {
    if (!pgT && (erT === "SELECTED" || erT === "DEPENDS")) {
      return true;
    }
    if (pgT === "NEAR_OTHER" && (erT === "SELECTED" || erT === "DEPENDS")) {
      return true;
    }
    if (pgT === "NEAR_ENEMY" && erT === "SELECTED") {
      return true;
    }
    if (pgT === "ALL_NEAR_ENEMIES" && erT === "BOTH") {
      return true;
    }
    if (pgT === "ALL_NEAR_OTHERS" && erT === "FOES_AND_ALLY") {
      return true;
    }
    if (pgT === "ALL_ENEMIES" && (erT === "BOTH" || erT === "OPPONENTS_FIELD")) {
      return true;
    }
    if (pgT === "ALL_OTHERS" && erT === "FOES_AND_ALLY") {
      return true;
    }
    if (pgT === "ALL" && erT === "ALL_BATTLERS") {
      return true;
    }
    if (pgT === "USER" && erT === "USER") {
      return true;
    }
    if (pgT === "ALLY" && erT === "ALLY") {
      return true;
    }
    if (pgT === "USER_OR_NEAR_ALLY" && erT === "USER_OR_ALLY") {
      return true;
    }
    if (pgT === "RANDOM_NEAR_ENEMY" && erT === "RANDOM") {
      return true;
    }
    if (pgT === "ENEMY_SIDE" && erT === "OPPONENTS_FIELD") {
      return true;
    }
    return false;
  };
  if (pgT && erT && !targetEquivalent(pgT, erT)) {
    targetDelta = `${pgT} -> ${erT}`;
    targetChanges++;
  }

  let typeDelta = "";
  if (
    a.pgType
    && a.erType
    && a.pgType !== a.erType.toUpperCase()
    && a.erType.toUpperCase() !== "NONE"
    && a.erType.toUpperCase() !== "MYSTERY"
  ) {
    typeDelta = `${a.pgType} -> ${a.erType.toUpperCase()}`;
    splitTypeChanges++;
  }

  // Effect comparison: best signal is the eff index name.
  // pokerogue equivalence: look at attrs.
  // We'll output erEffect verbatim and try to flag known deltas later.
  const effectDelta = "";
  const erEff = a.erEffect;
  const pgAttrs = a.pgAttrs.join(",");
  // Heuristic comparison: check if ER says "Multi Hit" and pg lacks MultiHitAttr
  function pgHasAttr(name) {
    return a.pgAttrs.includes(name);
  }
  const erEffectLower = erEff.toLowerCase();
  if (erEffectLower === "multi hit" && !pgHasAttr("attr")) {
    /* attr() with MultiHitAttr; can't easily inline */
  }

  let priorityDelta = "";
  if ((a.pgPriority ?? 0) !== (a.erPriority ?? 0)) {
    priorityDelta = `${a.pgPriority} -> ${a.erPriority}`;
  }

  let chanceDelta = "";
  const pgC = a.pgChance > 0 ? a.pgChance : 0;
  const erC = a.erChance > 0 ? a.erChance : 0;
  if (pgC !== erC) {
    chanceDelta = `${pgC} -> ${erC}`;
  }

  const flagsDelta = "";
  const pgFlags = new Set(a.pgFlagBuilders);
  const erFlags = new Set(a.erFlags || []);
  const flagNameMap = {
    "Makes Contact": "MAKES_CONTACT",
    "High Crit Rate": "KEEN_EDGE",
    "Air/Wing Based": "WIND",
    "Dance Move": "DANCE",
    "Always Crits": "ALWAYS_CRIT",
    "Field Based": "FIELD",
    "Hammer Based": "HAMMER",
    "Kick Based": "KICK",
    "Causes Recoil": "RECOIL",
    "Horn Based": "HORN",
    "Drill Based": "DRILL",
    "Sound Based": "SOUND",
    "Bullet Move": "BULLET",
    "Weather Based": "WEATHER",
    "Throw Based": "THROW",
    "Bone Based": "BONE",
    "Lunar Move": "LUNAR",
    "Arrow Based": "ARROW",
  };
  const erFlagsCanon = new Set([...erFlags].map(f => flagNameMap[f] || f));
  // Most ER flags map to abilities, not move flags. We only care about MAKES_CONTACT change.
  // pokerogue: by default attack moves make contact unless `.makesContact(false)`.
  // We can't reliably extract this. Skip.

  rows.push(
    [
      a.pgId,
      a.pgName,
      a.erId,
      a.erConst,
      a.pgCategory,
      a.erSplit,
      catDelta,
      a.pgTarget,
      a.erTarget,
      targetDelta,
      a.pgType,
      a.erType,
      typeDelta,
      pgAttrs,
      erEff,
      effectDelta,
      a.pgPriority,
      a.erPriority,
      priorityDelta,
      pgC,
      erC,
      chanceDelta,
      [...pgFlags].join("|"),
      [...erFlagsCanon].join("|"),
      flagsDelta,
      (a.pgDesc || "").replace(/\t/g, " "),
      (a.erDesc || "").replace(/\t/g, " ") + " || " + (a.erLongDesc || "").replace(/\t/g, " "),
    ].join("\t"),
  );
}

await writeFile(OUT_TSV, rows.join("\n"), "utf8");
console.log(`Wrote ${OUT_TSV} (${rows.length - 1} rows)`);
console.log("Counts:");
console.log(`  category changes: ${categoryChanges}`);
console.log(`  target changes:   ${targetChanges}`);
console.log(`  type changes:     ${splitTypeChanges}`);
