/*
 * Pass 2: classify moves by mechanic deltas based on description keywords.
 * Looks for ER additions: multi-hit, priority +N, recoil, drain, contact,
 * stat-changes-on-hit, flag-tagged-move boosts, etc.
 *
 * Reads tmp-move-audit-sidebyside.tsv produced by audit-vanilla-moves.mjs.
 * Emits a classification TSV.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN = resolve(__dirname, "tmp-move-audit-sidebyside.tsv");
const OUT = resolve(__dirname, "tmp-move-audit-classified.tsv");

const tsv = await readFile(IN, "utf8");
const lines = tsv.split("\n");
const header = lines[0].split("\t");
const colIdx = name => header.indexOf(name);
const COL = {
  pgId: colIdx("pgId"),
  pgName: colIdx("pgName"),
  erId: colIdx("erId"),
  erConst: colIdx("erConst"),
  pgCategory: colIdx("pgCategory"),
  erSplit: colIdx("erSplit"),
  categoryDelta: colIdx("categoryDelta"),
  pgType: colIdx("pgType"),
  erType: colIdx("erType"),
  typeDelta: colIdx("typeDelta"),
  pgAttrs: colIdx("pgEffect_hint"),
  erEffect: colIdx("erEffect"),
  pgPriority: colIdx("pgPriority"),
  erPriority: colIdx("erPriority"),
  pgChance: colIdx("pgChance"),
  erChance: colIdx("erChance"),
  pgFlags: colIdx("pgFlags"),
  erFlags: colIdx("erFlags"),
  pgDesc: colIdx("pgDesc"),
  erDesc: colIdx("erDesc"),
};

// ER ability-tied flag boosts vocabulary
const FLAG_BOOSTS = [
  "iron fist",
  "strong jaw",
  "mega launcher",
  "keen edge",
  "sharpness",
  "tough claws",
  "punk rock",
  "sound boost",
  "striker",
  "kick boost",
  "kick-based",
  "hammer",
  "mighty horn",
  "horn boost",
  "drill",
  "claw",
  "fang",
  "rock head",
  "reckless",
  "arrow",
  "arrow-based",
  "arrows boost",
  "bone",
  "bone boost",
  "throw",
  "throw based",
  "field-based",
  "field based",
  "long reach",
  "wind",
  "wind-based",
  "wind based",
  "ground-based",
  "long-distance",
  "lunar",
  "bullet",
  "ballistic",
  "snap",
  "freeze",
  "snap boost",
];

const classifications = [];

for (let i = 1; i < lines.length; i++) {
  const ln = lines[i];
  if (!ln.trim()) {
    continue;
  }
  const f = ln.split("\t");
  const o = {
    pgId: Number(f[COL.pgId]),
    pgName: f[COL.pgName],
    erId: Number(f[COL.erId]),
    erConst: f[COL.erConst],
    pgCat: f[COL.pgCategory],
    erSplit: f[COL.erSplit],
    catDelta: f[COL.categoryDelta],
    pgType: f[COL.pgType],
    erType: f[COL.erType],
    typeDelta: f[COL.typeDelta],
    pgAttrs: (f[COL.pgAttrs] || "").split(","),
    erEffect: f[COL.erEffect],
    pgPrio: Number(f[COL.pgPriority]),
    erPrio: Number(f[COL.erPriority]),
    pgChance: Number(f[COL.pgChance]),
    erChance: Number(f[COL.erChance]),
    pgFlags: (f[COL.pgFlags] || "").split("|").filter(Boolean),
    erFlags: (f[COL.erFlags] || "").split("|").filter(Boolean),
    pgDesc: (f[COL.pgDesc] || "").toLowerCase(),
    erDesc: (f[COL.erDesc] || "").toLowerCase(),
  };

  const issues = [];

  // Category change is MAJOR or TOTAL
  if (o.catDelta) {
    if (o.erSplit === "USE_HIGHEST_OFFENSE" || o.erSplit === "USE_HIGHEST_DAMAGE") {
      issues.push(`MAJOR:category-uses-highest-offense (${o.catDelta})`);
    } else if (o.erSplit === "HITS_DEF") {
      // Skip if pokerogue already implements via DefDefAttr (hits Def stat)
      if (!o.pgAttrs.some(a => /DefDefAttr/i.test(a))) {
        issues.push(`MAJOR:hits-def-instead-of-spdef (${o.catDelta})`);
      }
    } else if (o.erSplit === "HITS_SPDEF") {
      issues.push(`MAJOR:hits-spdef-instead-of-def (${o.catDelta})`);
    } else if (o.catDelta.includes("STA->")) {
      issues.push(`TOTAL:status-to-damaging (${o.catDelta})`);
    } else if (o.catDelta.includes("->STATUS")) {
      issues.push(`TOTAL:damaging-to-status (${o.catDelta})`);
    } else {
      issues.push(`MAJOR:phys-spec-swap (${o.catDelta})`);
    }
  }
  // Type change
  if (o.typeDelta) {
    issues.push(`TOTAL:type-change (${o.typeDelta})`);
  }
  // Priority delta (numeric patcher handles this BUT may indicate a redesign)
  // Only flag if priority delta exceeds vanilla's range or jumps category.
  // (Already numerically patched, so skip.)

  // ER adds multi-hit when pokerogue doesn't
  const erMulti = /(hits?\s+\d|hits?\s+(?:two|three|four|five|2-5|2 to 5|twice|three times|2 ?- ?5))/i.test(o.erDesc);
  const pgMulti =
    o.pgAttrs.some(a => /MultiHit|TWO/.test(a))
    || /two\s*to\s*five|2\s*to\s*5|hits 2-5|hits two to five|two to five times/i.test(o.pgDesc);
  if (erMulti && !pgMulti) {
    issues.push("MAJOR:multi-hit-added");
  }

  // Priority is numeric-patched by init-elite-redux-vanilla-rebalance.ts.

  // ER adds recoil
  const recoilRe = /\d+%\s*recoil|takes? \d+%\s*(damage|recoil)|recoil( damage)?|hurts? on miss|hurts? user/i;
  const pgHasRecoil =
    o.pgAttrs.some(a => /Recoil|MissEffectAttr|recklessMove/.test(a))
    || /recoil|hurts.*user|hurts.*itself|takes\s+\d+%\s+damage/i.test(o.pgDesc);
  if (recoilRe.test(o.erDesc) && !pgHasRecoil) {
    issues.push("MAJOR:recoil-added");
  }

  // ER adds drain/heal on an attacking move (not a self-heal status move)
  const erIsAttack = o.erSplit !== "STATUS";
  const drainRe =
    /drain|absorb (some|hp|damage)|hits to heal|heal\w*\s+(?:\d+%|half|some|hp dealt|damage dealt|user)|heals \d+% (?:of )?(?:damage|hp dealt)/i;
  const pgHasDrain =
    o.pgAttrs.some(a => /HitHealAttr|absorbAttr/i.test(a)) || /drain|absorb|hp drained/i.test(o.pgDesc);
  if (erIsAttack && drainRe.test(o.erDesc) && !pgHasDrain) {
    issues.push("MAJOR:drain-added");
  }

  // ER status-chance changes (chance %) are numeric-patched. The status-on-hit
  // detection below catches the case where ER ADDS a status proc pokerogue lacks.

  // Stat changes on hit not in vanilla
  const erStatChangeOnHit =
    /(lower|raise|drop|boost)s?\s+(its|own|the|foe.?s|target.?s)?\s*(atk|attack|def|defense|sp\.? ?atk|sp\.? ?def|spd|speed|accuracy|evasion)/i;
  const pgHasStatChange = o.pgAttrs.some(a => /StatStageChange|StatChange:|Stat.*Change/i.test(a));
  if (erStatChangeOnHit.test(o.erDesc) && !pgHasStatChange && o.erSplit !== "STATUS") {
    issues.push("MAJOR:stat-change-on-hit-added");
  }

  // Status on hit added (where pokerogue has no status/flinch/etc attr)
  const pgHasStatus = o.pgAttrs.some(a =>
    /^Status:|StatusEffectAttr|StatusIfBoostedAttr|MultiStatusEffectAttr|FlinchAttr|ConfuseAttr|InfatuateAttr|AddBattlerTagAttr/.test(
      a,
    ),
  );
  // Extract concrete status keywords from ER desc to make per-status comparison
  const erStatusKws = [];
  if (/burn/i.test(o.erDesc)) {
    erStatusKws.push("burn");
  }
  if (/paralyz/i.test(o.erDesc)) {
    erStatusKws.push("paralysis");
  }
  if (/poison|toxic/i.test(o.erDesc)) {
    erStatusKws.push("poison");
  }
  if (/sleep|drowsi/i.test(o.erDesc)) {
    erStatusKws.push("sleep");
  }
  if (/freez|frostbit/i.test(o.erDesc)) {
    erStatusKws.push("freeze");
  }
  if (/bleed/i.test(o.erDesc)) {
    erStatusKws.push("bleed");
  }
  if (/confus/i.test(o.erDesc)) {
    erStatusKws.push("confuse");
  }
  if (/flinch/i.test(o.erDesc)) {
    erStatusKws.push("flinch");
  }
  // Only flag if ER mentions a numeric/explicit chance AND pokerogue has zero attached effects
  const erStatusOnHit =
    /(\b\d+\s*%\s*(?:chance|to)?\s*(?:burn|paralyz|poison|sleep|freez|frostbit|bleed|confus|flinch|drowsi))/i;
  if (
    erStatusKws.length > 0
    && erStatusOnHit.test(o.erDesc)
    && !pgHasStatus
    && o.erSplit !== "STATUS"
    && o.pgCat !== "STATUS"
  ) {
    issues.push(`MAJOR:status-on-hit-added(${erStatusKws.join("/")})`);
  }

  // Flag-tagged ER boost on a vanilla move (this binds the move to ER ability flags)
  const flagHits = FLAG_BOOSTS.filter(kw => o.erDesc.includes(kw));
  if (flagHits.length > 0) {
    issues.push(`MINOR-flag:${flagHits.slice(0, 3).join("/")}`);
  }

  // ER says "Hits both targets" or "Hits all foes" or "Spread move"
  const spreadKw = /hits both|hits all|both foes|all foes|spread move|hits both targets/i;
  if (spreadKw.test(o.erDesc)) {
    issues.push("MAJOR:target-spread");
  }

  // ER adds protect-bypass
  if (
    /hits? through protect|bypass(?:es)? protect|ignore.* protect/i.test(o.erDesc)
    && !o.pgAttrs.some(a => /IgnoreProtectAttr|bypassesProtect/i.test(a))
  ) {
    issues.push("MAJOR:bypasses-protect-added");
  }

  // ER adds contact
  if (/makes contact|contact based/i.test(o.erDesc) && !o.pgFlags.includes("MAKES_CONTACT")) {
    issues.push("MAJOR:contact-flag-added");
  }

  // ER removes contact
  if (/doesn'?t (make|cause) contact|non.contact/i.test(o.erDesc) && o.pgFlags.includes("MAKES_CONTACT")) {
    issues.push("MAJOR:contact-flag-removed");
  }

  // ER adds field-clear (terrain/weather/hazards)
  if (/remove.*(terrain|weather|hazard)|clears? (terrain|weather|hazard)|destroys? terrain/i.test(o.erDesc)) {
    issues.push("MAJOR:field-clear-added");
  }

  // ER adds hazard. Don't flag if ER says "removes" or "frees from" hazards.
  if (
    /applies spikes|hurts? foes on switch|sets? spikes|sets? toxic spikes|sets? stealth|sets? sticky web/i.test(
      o.erDesc,
    )
    && o.erSplit !== "STATUS"
    && !o.pgAttrs.some(a => /Spikes|StealthRock|StickyWeb|HazardArenaTag|AddArenaTagAttr/i.test(a))
  ) {
    issues.push("MAJOR:hazard-on-hit-added");
  }

  // ER changes target (likely most are not real changes — we'll only catch egregious cases)

  // ER OHKO/instant-death removed (vanilla OHKO -> ER regular damage)
  if (o.pgAttrs.some(a => /OneHitKO/i.test(a)) && !/(faint|instant|guarantee|knock out|knocks out)/i.test(o.erDesc)) {
    issues.push("TOTAL:ohko-removed");
  }

  // Stash classification
  classifications.push({ ...o, issues });
}

// Compute summary
const summary = {
  TOTAL: 0,
  MAJOR: 0,
  MINOR_flag: 0,
  NONE: 0,
};
for (const c of classifications) {
  const hasTotal = c.issues.some(i => i.startsWith("TOTAL"));
  const hasMajor = c.issues.some(i => i.startsWith("MAJOR"));
  const hasFlag = c.issues.some(i => i.startsWith("MINOR-flag"));
  if (hasTotal) {
    summary.TOTAL++;
  } else if (hasMajor) {
    summary.MAJOR++;
  } else if (hasFlag) {
    summary.MINOR_flag++;
  } else {
    summary.NONE++;
  }
}
console.log("Classification summary:", summary);

// Emit TSV
const rows = ["pgId\tpgName\terId\tpgCat\terSplit\tpgType\terType\tissues\tpgDesc\terDesc"];
for (const c of classifications) {
  if (c.issues.length === 0) {
    continue;
  }
  rows.push(
    [
      c.pgId,
      c.pgName,
      c.erId,
      c.pgCat,
      c.erSplit,
      c.pgType,
      c.erType,
      c.issues.join(";"),
      c.pgDesc.slice(0, 80),
      c.erDesc.slice(0, 200),
    ].join("\t"),
  );
}
await writeFile(OUT, rows.join("\n"), "utf8");
console.log(`Wrote ${OUT} (${rows.length - 1} rows)`);

// Also print the per-issue histogram
const issueHist = {};
for (const c of classifications) {
  for (const issue of c.issues) {
    const k = issue.split(":")[1] ?? issue;
    issueHist[k] = (issueHist[k] || 0) + 1;
  }
}
console.log("\nIssue histogram:");
for (const [k, v] of Object.entries(issueHist).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}
