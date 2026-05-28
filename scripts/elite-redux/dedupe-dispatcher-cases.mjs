// One-off: remove biome-flagged within-switch duplicate `case` blocks in
// archetype-dispatcher.ts. Each flagged line is a LATER (shadowed/dead)
// occurrence of a case label within a switch; deleting it is behavior-preserving
// (the first occurrence wins at runtime). Dry-run by default; pass --apply to write.
//
// Usage: node scripts/elite-redux/dedupe-dispatcher-cases.mjs [--apply]
import { readFileSync, writeFileSync } from "node:fs";

const FILE = "src/data/elite-redux/archetype-dispatcher.ts";
// biome noDuplicateCase lines (1-indexed) — the dead later occurrences.
const FLAGGED = [
  3015, 3616, 3683, 3745, 3825, 3955, 3987, 4001, 4006, 4163, 4168, 4176, 4205, 4209, 4418, 4458, 4475, 4489, 4519,
  4550, 4557, 4563, 5314, 5428,
];
const APPLY = process.argv.includes("--apply");

const lines = readFileSync(FILE, "utf8").split("\n");

// A case block at 4-space indent ends just before the next `    case `/
// `    default:` (same indent) or the switch's closing `  }` (2-indent). We then
// trim back any trailing comment-only/blank lines (section headers/separators)
// so they stay attached to the FOLLOWING case rather than being deleted. This
// also keeps a block-scoped case's closing `}` (not a comment) inside the block.
function blockEnd(startIdx) {
  let i = startIdx + 1;
  for (; i < lines.length; i++) {
    if (/^ {4}(case .+:|default:)/.test(lines[i]) || /^ {2}\}/.test(lines[i])) {
      break;
    }
  }
  if (i >= lines.length) {
    throw new Error(`no block end found from line ${startIdx + 1}`);
  }
  let end = i;
  while (end - 1 > startIdx && /^\s*(\/\/.*)?$/.test(lines[end - 1])) {
    end--;
  }
  return end; // exclusive
}

const ranges = [];
for (const ln of FLAGGED) {
  const startIdx = ln - 1;
  if (!/^ {4}case \d+:/.test(lines[startIdx])) {
    throw new Error(`line ${ln} is not a 4-indent case: ${JSON.stringify(lines[startIdx])}`);
  }
  const endIdx = blockEnd(startIdx);
  ranges.push({ ln, startIdx, endIdx, caseLine: lines[startIdx].trim() });
}

// Print each block for review.
for (const r of ranges) {
  console.log(`\n--- delete lines ${r.startIdx + 1}..${r.endIdx} (${r.caseLine}) ---`);
  console.log(
    lines
      .slice(r.startIdx, r.endIdx)
      .map(l => "  " + l)
      .join("\n"),
  );
}
console.log(
  `\nTotal blocks: ${ranges.length}. Lines removed: ${ranges.reduce((a, r) => a + (r.endIdx - r.startIdx), 0)}`,
);

if (APPLY) {
  // Remove bottom-up so earlier indices stay valid.
  const sorted = [...ranges].sort((a, b) => b.startIdx - a.startIdx);
  for (const r of sorted) {
    lines.splice(r.startIdx, r.endIdx - r.startIdx);
  }
  writeFileSync(FILE, lines.join("\n"), "utf8");
  console.log("\nAPPLIED.");
} else {
  console.log("\nDRY RUN (pass --apply to write).");
}
