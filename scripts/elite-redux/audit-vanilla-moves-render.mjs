/*
 * Render TOTAL and MAJOR move audit rows into Markdown tables for the doc.
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const IN = resolve(__dirname, "tmp-move-audit-classified.tsv");
const SIDE = resolve(__dirname, "tmp-move-audit-sidebyside.tsv");

const tsv = await readFile(IN, "utf8");
const sideTsv = await readFile(SIDE, "utf8");

// Build side-by-side index by pgId
const sideHeader = sideTsv.split("\n")[0].split("\t");
const sideRows = {};
for (const ln of sideTsv.split("\n").slice(1)) {
  if (!ln.trim()) {
    continue;
  }
  const f = ln.split("\t");
  const o = {};
  for (let i = 0; i < sideHeader.length; i++) {
    o[sideHeader[i]] = f[i];
  }
  sideRows[Number(o.pgId)] = o;
}

const lines = tsv
  .split("\n")
  .slice(1)
  .filter(l => l.trim());
const rows = lines.map(l => {
  const f = l.split("\t");
  return {
    pgId: Number(f[0]),
    pgName: f[1],
    erId: Number(f[2]),
    pgCat: f[3],
    erSplit: f[4],
    pgType: f[5],
    erType: f[6],
    issues: f[7],
    pgDesc: f[8],
    erDesc: f[9],
  };
});

const total = rows.filter(r => /TOTAL:/.test(r.issues));
const majorOnly = rows.filter(r => !/TOTAL:/.test(r.issues) && /MAJOR:/.test(r.issues));
const flagOnly = rows.filter(r => !/TOTAL:/.test(r.issues) && !/MAJOR:/.test(r.issues) && /MINOR-flag/.test(r.issues));

const summarizeIssues = issues => {
  // Compact human-readable rendering of issue labels
  return issues.replace(/(TOTAL|MAJOR|MINOR-flag):/g, " [$1] ").trim();
};

function buildTable(rows, _type) {
  const out = [];
  out.push("| ID | Move | Vanilla mechanic | ER mechanic | Delta | Suggested wire |");
  out.push("|---|---|---|---|---|---|");
  for (const r of rows.sort((a, b) => a.pgId - b.pgId)) {
    const side = sideRows[r.pgId];
    let vMech = `${r.pgCat} ${r.pgType}`;
    if (side) {
      const attrs = (side.pgEffect_hint || "")
        .split(",")
        .filter(x => x && x !== "attr")
        .slice(0, 3)
        .join("/");
      if (attrs) {
        vMech += ` · ${attrs}`;
      }
    }
    const erMech = r.erDesc.length > 110 ? `${r.erDesc.slice(0, 110)}…` : r.erDesc;
    const delta = summarizeIssues(r.issues);
    out.push(`| ${r.pgId} | ${r.pgName} | ${vMech} | ${erMech.replace(/\|/g, "/")} | ${delta} | TBD |`);
  }
  return out.join("\n");
}

console.log("## TOTAL");
console.log(buildTable(total, "TOTAL"));
console.log("\n## MAJOR");
console.log(buildTable(majorOnly, "MAJOR"));
console.log("\n## MINOR-flag (data-only)");
const flagCounts = {};
for (const r of flagOnly) {
  const flagPart = r.issues.match(/MINOR-flag:(\S+)/);
  if (!flagPart) {
    continue;
  }
  const f = flagPart[1].split("/");
  for (const ff of f) {
    flagCounts[ff] = (flagCounts[ff] || 0) + 1;
  }
}
console.log("Flag tag counts:");
for (const [k, v] of Object.entries(flagCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}
console.log("\nNumber of flag-only moves:", flagOnly.length);
