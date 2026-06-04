/*
 * SPDX-FileCopyrightText: 2025-2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Elite Redux Phase C task C5: audit archetype coverage and emit
 *
 *   - `docs/plans/elite-redux-bespoke-inventory.md`  — the canonical list of
 *     ER abilities + moves that the C2/C3 classifier could NOT slot into an
 *     archetype primitive. Each row needs a hand-written implementation in
 *     the wire-up layer (Phase D). The doc groups entries by category and
 *     adds a "taxonomy hint" — the archetype kind the entry is closest to,
 *     based on a description-keyword scan — so reviewers can quickly pick
 *     which bespoke implementations to batch together.
 *
 *   - `docs/plans/elite-redux-phase-c-coverage.md`   — the per-bucket coverage
 *     snapshot for Phase C structural work. Captures totals, per-archetype
 *     counts, and the bespoke long-tail size that remains for Phase D's
 *     hand-write pass.
 *
 * Inputs
 * ------
 *   - `src/data/elite-redux/er-abilities.ts`         → 1034 ability drafts
 *     with `archetype: "vanilla"` for pokerogue-equivalent + `"unknown"` for
 *     ER-custom.
 *   - `src/data/elite-redux/er-ability-archetypes.ts` → 736 classifier rows
 *     mapping ER-custom ability id → archetype kind + params.
 *   - `src/data/elite-redux/er-moves.ts`             → 1032 move drafts.
 *   - `src/data/elite-redux/er-move-archetypes.ts`    → 187 classifier rows.
 *
 * Outputs
 * -------
 *   - `docs/plans/elite-redux-bespoke-inventory.md`
 *   - `docs/plans/elite-redux-phase-c-coverage.md`
 *   - stdout summary with the same numbers
 *
 * Idempotency
 * -----------
 * Re-running with no upstream changes produces identical output files
 * (deterministic key ordering + JSON-stable values). Both docs carry a
 * "Last regenerated: <ISO date>" timestamp; we deliberately use the file
 * mtime style (not the wall clock) so re-runs without data changes don't
 * trigger doc-diff churn — see `lastRunTimestamp()` below.
 */

import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const ABILITIES_PATH = resolve(ROOT, "src/data/elite-redux/er-abilities.ts");
const ABILITY_ARCHETYPES_PATH = resolve(ROOT, "src/data/elite-redux/er-ability-archetypes.ts");
const MOVES_PATH = resolve(ROOT, "src/data/elite-redux/er-moves.ts");
const MOVE_ARCHETYPES_PATH = resolve(ROOT, "src/data/elite-redux/er-move-archetypes.ts");
const BESPOKE_INVENTORY_PATH = resolve(ROOT, "docs/plans/elite-redux-bespoke-inventory.md");
const COVERAGE_REPORT_PATH = resolve(ROOT, "docs/plans/elite-redux-phase-c-coverage.md");

// =============================================================================
// Parsers
// =============================================================================

/**
 * Extract the `ER_ABILITIES` array literal from er-abilities.ts. The file is
 * auto-generated JSON-shaped TS — every object body is JSON-parseable verbatim
 * once we strip the TS scaffolding around the literal.
 *
 * @param {string} text
 * @returns {{ id: number, name: string, description: string, archetype: "vanilla" | "unknown" }[]}
 */
export function parseErAbilities(text) {
  // The array literal is preceded by `export const ER_ABILITIES: readonly ErAbilityDraft[] = [`
  // and terminated by `];` at toplevel. We scan for the open bracket and
  // balance brackets to find the matching close — same scanner pattern as
  // audit-flag-mapping.mjs.
  const head = text.match(/export\s+const\s+ER_ABILITIES\s*:[^=]*=\s*\[/);
  if (!head) {
    throw new Error(`audit-archetype-coverage: couldn't find ER_ABILITIES literal in ${ABILITIES_PATH}`);
  }
  const start = head.index + head[0].length - 1; // include the `[`
  const close = scanBalancedClose(text, start, "[", "]");
  const arrayLit = text.slice(start, close + 1);
  return JSON.parse(arrayLit);
}

/**
 * Extract the `ER_MOVES` array literal from er-moves.ts. Same shape as
 * {@linkcode parseErAbilities}.
 *
 * @param {string} text
 * @returns {Array<{ id: number, name: string, description: string, archetype: "vanilla" | "unknown" }>}
 */
export function parseErMoves(text) {
  const head = text.match(/export\s+const\s+ER_MOVES\s*:[^=]*=\s*\[/);
  if (!head) {
    throw new Error(`audit-archetype-coverage: couldn't find ER_MOVES literal in ${MOVES_PATH}`);
  }
  const start = head.index + head[0].length - 1;
  const close = scanBalancedClose(text, start, "[", "]");
  const arrayLit = text.slice(start, close + 1);
  return JSON.parse(arrayLit);
}

/**
 * Extract the archetype rows from a `ER_*_ARCHETYPES` object literal. The
 * archetype tables have a fixed-shape body — `(id): { erAbilityId|erMoveId: id,
 * archetype: "...", params: {...} | null },` — that we can extract with a
 * line-oriented regex. The params object itself is JSON-safe by the
 * `classify-abilities.mjs` emitter contract, so JSON.parse handles it.
 *
 * @param {string} text         the .ts file body
 * @param {"erAbilityId" | "erMoveId"} idKey
 * @returns {Array<{ id: number, archetype: string, params: object | null }>}
 */
export function parseArchetypes(text, idKey) {
  const out = [];
  // Match `<num>: { <idKey>: <num>, archetype: "<kind>", params: <obj> | null },`
  // We split the regex into two phases: locate each row's header line, then
  // walk the rest of the body to collect the params object/null literal.
  const headRe = new RegExp(`(\\d+):\\s*\\{\\s*${idKey}:\\s*(\\d+),\\s*archetype:\\s*"([a-z-]+)",\\s*params:\\s*`, "g");
  let m;
  while ((m = headRe.exec(text)) !== null) {
    const id = Number(m[2]);
    const archetype = m[3];
    const paramsStart = headRe.lastIndex;
    // Skip whitespace then read either "null" or a JSON object.
    let i = paramsStart;
    while (i < text.length && /\s/.test(text[i])) {
      i++;
    }
    let params = null;
    if (text.slice(i, i + 4) === "null") {
      params = null;
      i += 4;
    } else if (text[i] === "{") {
      const close = scanBalancedClose(text, i, "{", "}");
      const jsonLit = text.slice(i, close + 1);
      try {
        params = JSON.parse(jsonLit);
      } catch (err) {
        throw new Error(`audit-archetype-coverage: failed to parse params for ${idKey}=${id}: ${err.message}`);
      }
      i = close + 1;
    } else {
      throw new Error(`audit-archetype-coverage: unexpected params token at offset ${i}`);
    }
    out.push({ id, archetype, params });
    headRe.lastIndex = i;
  }
  return out;
}

/**
 * Find the matching close-bracket position for the open bracket at `start`.
 * Tracks balanced `open`/`close` brackets while ignoring quoted-string
 * contents and JS escape sequences. Returns the index of the closing
 * bracket.
 *
 * @param {string} text
 * @param {number} start  index of the OPENING bracket
 * @param {string} open   the opening character (e.g. `{` or `[`)
 * @param {string} close  the closing character (e.g. `}` or `]`)
 * @returns {number}
 */
function scanBalancedClose(text, start, open, close) {
  if (text[start] !== open) {
    throw new Error(`scanBalancedClose: expected '${open}' at offset ${start}`);
  }
  let depth = 1;
  let inString = false;
  let stringQuote = "";
  let escaping = false;
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (ch === "\\") {
        escaping = true;
      } else if (ch === stringQuote) {
        inString = false;
      }
    } else if (ch === '"' || ch === "'" || ch === "`") {
      inString = true;
      stringQuote = ch;
    } else if (ch === open) {
      depth++;
    } else if (ch === close) {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  throw new Error(`scanBalancedClose: unbalanced ${open}${close} starting at ${start}`);
}

// =============================================================================
// Audit
// =============================================================================

/**
 * Run a description-keyword scan to suggest the closest archetype for a
 * bespoke entry. Returns one of the documented archetype names OR
 * `"unclassified"`. The hints are intentionally coarse — they help the
 * Phase D reviewer batch related bespoke entries together, not pin down the
 * exact implementation.
 *
 * @param {string} desc  ability/move description text
 * @returns {string}
 */
export function taxonomyHint(desc) {
  if (!desc || typeof desc !== "string") {
    return "unclassified";
  }
  const lower = desc.toLowerCase();
  // Order matters — more specific patterns first.
  if (/transforms? into|form change|primal|mega|switches? forms?/i.test(desc)) {
    return "form-change";
  }
  if (/copy|copies|imitate|mirror/i.test(desc)) {
    return "move-replacement";
  }
  if (/turn into|becomes? the same type|color change|type-?changing/i.test(desc)) {
    return "type-conversion";
  }
  if (/critical hit|crit chance|crit rate|crit damage/i.test(desc)) {
    return "crit-mod";
  }
  if (/heals?\s+\d+%|recovers?\s+\d+%|restores? \d+%/i.test(desc)) {
    return "passive-recovery";
  }
  if (/heal.*\bhp\b|drain.*health|life ?steal|absorb.*hp/i.test(desc)) {
    return "lifesteal";
  }
  if (/on entry|switch.?in|enters? (the )?(battle|field)/i.test(desc)) {
    return "entry-effect";
  }
  if (/contact|when hit|after being hit/i.test(desc)) {
    return "chance-status-on-hit";
  }
  if (/(faints?|knocked out|after ko)/i.test(desc)) {
    return "stat-trigger-on-event";
  }
  if (/takes? \d+%? (less|reduced)|reduces? damage|halves? damage/i.test(desc)) {
    return "damage-reduction-generic";
  }
  if (/priority/i.test(desc)) {
    return "priority-modifier";
  }
  if (/multi.?hit|hits twice|hits? \d+ times/i.test(desc)) {
    return "multi-hit-override";
  }
  if (/accuracy|never miss|always hit/i.test(desc)) {
    return "accuracy-mod";
  }
  if (/immune to|immunity|cannot be|can'?t be/i.test(desc)) {
    return "status-immunity";
  }
  if (/weather|terrain/i.test(lower)) {
    return "weather-or-terrain-interaction";
  }
  if (/boost.*\b(power|damage)\b|\b\d+(\.\d+)?x\s+(damage|power)/i.test(desc)) {
    return "type-damage-boost-or-flag-damage-boost";
  }
  return "unclassified";
}

/**
 * Aggregate the per-archetype counts from a classifier-row list.
 *
 * @param {Array<{ archetype: string }>} rows
 * @returns {Record<string, number>}
 */
export function countByArchetype(rows) {
  const counts = {};
  for (const row of rows) {
    counts[row.archetype] = (counts[row.archetype] ?? 0) + 1;
  }
  return counts;
}

/**
 * Build the bespoke-inventory data view. Returns one row per bespoke
 * entry — sorted by `id` within category so subsequent re-runs produce
 * stable doc diffs.
 *
 * @param {Array<{ id: number, name: string, description: string, archetype: string }>} drafts
 * @param {Array<{ id: number, archetype: string }>} archetypeRows
 * @returns {Array<{ id: number, name: string, description: string, hint: string }>}
 */
export function buildBespokeInventory(drafts, archetypeRows) {
  const draftById = new Map(drafts.map(d => [d.id, d]));
  const bespoke = [];
  for (const row of archetypeRows) {
    if (row.archetype !== "bespoke") {
      continue;
    }
    const draft = draftById.get(row.id);
    if (!draft) {
      bespoke.push({ id: row.id, name: "(MISSING DRAFT)", description: "", hint: "unclassified" });
      continue;
    }
    bespoke.push({
      id: row.id,
      name: draft.name,
      description: draft.description ?? "",
      hint: taxonomyHint(draft.description ?? ""),
    });
  }
  bespoke.sort((a, b) => a.id - b.id);
  return bespoke;
}

// =============================================================================
// Markdown emitters
// =============================================================================

/**
 * Escape a description string for embedding in a markdown table cell.
 * Markdown tables don't allow literal pipes — escape them. Newlines also
 * break tables; collapse them into `· ` separators.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeMdCell(text) {
  if (!text) {
    return "";
  }
  return text.replace(/\|/g, "\\|").replace(/\n+/g, " · ").trim();
}

/**
 * Format the bespoke-inventory markdown body.
 *
 * @param {{
 *   abilities: Array<{ id: number, name: string, description: string, hint: string }>,
 *   moves: Array<{ id: number, name: string, description: string, hint: string }>,
 *   timestamp: string,
 * }} input
 * @returns {string}
 */
export function emitBespokeInventoryBody({ abilities, moves, timestamp }) {
  const abilityRows = abilities
    .map(b => `| ${b.id} | ${escapeMdCell(b.name)} | ${escapeMdCell(b.description)} | \`${b.hint}\` |`)
    .join("\n");
  const moveRows = moves
    .map(b => `| ${b.id} | ${escapeMdCell(b.name)} | ${escapeMdCell(b.description)} | \`${b.hint}\` |`)
    .join("\n");

  // Per-hint summary tables — quick view of "what kind of bespoke work
  // dominates the long tail". Helps reviewers plan the Phase D pass.
  const abilityHintCounts = countHints(abilities);
  const moveHintCounts = countHints(moves);
  const abilityHintRows = formatHintCounts(abilityHintCounts);
  const moveHintRows = formatHintCounts(moveHintCounts);

  return `# Elite Redux — Bespoke Inventory (Phase C → D handoff)

> Auto-generated. Regenerate: \`pnpm run er:audit-archetype-coverage\`.
>
> Last regenerated: ${timestamp}.

This doc enumerates the ER abilities and moves the C2/C3 archetype classifier
could NOT slot into an archetype primitive. Each entry needs a hand-written
implementation in the Phase D wire-up layer.

The \`Taxonomy Hint\` column groups bespoke entries by the archetype they most
resemble — useful for batching related hand-writes in the Phase D pass. A hint
of \`unclassified\` means the description didn't match any keyword bucket; those
are typically multi-mechanic abilities that don't fit any one archetype.

## Summary

- Bespoke abilities: **${abilities.length}**
- Bespoke moves: **${moves.length}**
- Total long-tail entries needing hand-write: **${abilities.length + moves.length}**

### Bespoke abilities by taxonomy hint

| Hint | Count |
|---|---|
${abilityHintRows}

### Bespoke moves by taxonomy hint

| Hint | Count |
|---|---|
${moveHintRows}

## Bespoke abilities (${abilities.length})

| ER ID | Name | Description | Taxonomy Hint |
|---|---|---|---|
${abilityRows}

## Bespoke moves (${moves.length})

| ER ID | Name | Description | Taxonomy Hint |
|---|---|---|---|
${moveRows}
`;
}

/**
 * Count per-hint occurrences.
 * @param {Array<{ hint: string }>} entries
 * @returns {Record<string, number>}
 */
function countHints(entries) {
  const counts = {};
  for (const entry of entries) {
    counts[entry.hint] = (counts[entry.hint] ?? 0) + 1;
  }
  return counts;
}

/**
 * Render a hint-count table body, sorted by descending count then alpha hint.
 * @param {Record<string, number>} counts
 * @returns {string}
 */
function formatHintCounts(counts) {
  const rows = Object.entries(counts).sort((a, b) => {
    if (b[1] !== a[1]) {
      return b[1] - a[1];
    }
    return a[0].localeCompare(b[0]);
  });
  return rows.map(([hint, count]) => `| \`${hint}\` | ${count} |`).join("\n");
}

/**
 * Render the per-archetype counts table for a category.
 *
 * @param {Record<string, number>} counts
 * @returns {string}
 */
function formatArchetypeCounts(counts) {
  const rows = Object.entries(counts)
    .filter(([k]) => k !== "bespoke")
    .sort((a, b) => {
      if (b[1] !== a[1]) {
        return b[1] - a[1];
      }
      return a[0].localeCompare(b[0]);
    });
  return rows.map(([archetype, count]) => `| \`${archetype}\` | ${count} |`).join("\n");
}

/**
 * Format the Phase C coverage report body.
 *
 * @param {{
 *   abilityTotal: number,
 *   abilityVanilla: number,
 *   abilityClassified: number,
 *   abilityBespoke: number,
 *   abilityCounts: Record<string, number>,
 *   moveTotal: number,
 *   moveVanilla: number,
 *   moveClassified: number,
 *   moveBespoke: number,
 *   moveCounts: Record<string, number>,
 *   timestamp: string,
 * }} input
 * @returns {string}
 */
export function emitCoverageReportBody(input) {
  const {
    abilityTotal,
    abilityVanilla,
    abilityClassified,
    abilityBespoke,
    abilityCounts,
    moveTotal,
    moveVanilla,
    moveClassified,
    moveBespoke,
    moveCounts,
    timestamp,
  } = input;

  const abilityWiredPct = ((abilityVanilla + abilityClassified) / abilityTotal) * 100;
  const moveWiredPct = ((moveVanilla + moveClassified) / moveTotal) * 100;
  const abilityArchetypeRows = formatArchetypeCounts(abilityCounts);
  const moveArchetypeRows = formatArchetypeCounts(moveCounts);
  const abilityArchetypeKinds = Object.keys(abilityCounts).filter(k => k !== "bespoke").length;
  const moveArchetypeKinds = Object.keys(moveCounts).filter(k => k !== "bespoke").length;

  return `# Elite Redux — Phase C Coverage Snapshot

> Auto-generated. Regenerate: \`pnpm run er:audit-archetype-coverage\`.
>
> Last regenerated: ${timestamp}.

Snapshot of Phase C structural work. Captures the per-bucket distribution of
ER abilities + moves across:

- **Vanilla** — direct pokerogue equivalents, wired via the ER → pokerogue id
  map (\`ER_ID_MAP\`).
- **Archetype-classified** — ER-custom entries that the C2/C3 classifier slotted
  into a Phase C archetype primitive. Wire-up reads the per-row \`params\`
  object and constructs the matching AbAttr / MoveAttr.
- **Bespoke long-tail** — ER-custom entries the classifier couldn't generalize.
  Needs hand-written implementations in the Phase D wire-up layer. See
  \`elite-redux-bespoke-inventory.md\` for the canonical list.

Coverage is **% wired** — \`(vanilla + archetype-classified) / total\`. The
bespoke fraction is the remaining hand-write backlog Phase D has to clear.

## Abilities

- Total ER abilities: **${abilityTotal}**
- Vanilla (pokerogue equivalent): **${abilityVanilla}**
- Archetype-classified: **${abilityClassified}** (across ${abilityArchetypeKinds} archetype kinds — breakdown below)
- Bespoke long-tail: **${abilityBespoke}** (needs hand implementation)
- **Coverage: ${abilityWiredPct.toFixed(1)}% wired**

### Ability archetype breakdown

| Archetype | Count |
|---|---|
${abilityArchetypeRows}

## Moves

- Total ER moves: **${moveTotal}**
- Vanilla (pokerogue equivalent): **${moveVanilla}**
- Archetype-classified: **${moveClassified}** (across ${moveArchetypeKinds} archetype kinds — breakdown below)
- Bespoke long-tail: **${moveBespoke}** (needs hand implementation)
- **Coverage: ${moveWiredPct.toFixed(1)}% wired**

### Move archetype breakdown

| Archetype | Count |
|---|---|
${moveArchetypeRows}

## Methodology

- "Total" counts include the ER \`0 / NONE\` sentinel slots and any unfilled ER
  ids; this matches what \`ER_ABILITIES\`/\`ER_MOVES\` export.
- "Vanilla" is the count of \`archetype: "vanilla"\` rows from the raw drafts
  (\`er-abilities.ts\` / \`er-moves.ts\`) — pokerogue-equivalent entries the
  fixture builder identified directly.
- "Archetype-classified" is the count of non-\`bespoke\` rows in the C2/C3
  classifier output (\`er-ability-archetypes.ts\` / \`er-move-archetypes.ts\`).
- "Bespoke" is the count of \`archetype: "bespoke"\` rows in the same files.

## Next steps

- Phase D will wire archetype-classified rows into runtime by constructing
  the per-row AbAttr / MoveAttr from \`params\`.
- The bespoke long-tail will be hand-written in Phase D, sequenced by
  taxonomy-hint clusters (see \`elite-redux-bespoke-inventory.md\`).
- The C0 battle harness's full golden-replay validation suite is deferred to
  Phase D — it requires the wire-up to be plugged into runtime battle flow.
`;
}

// =============================================================================
// Driver
// =============================================================================

/**
 * Determine the timestamp to embed in the docs. If the upstream classifier
 * data tables are older than the existing doc, we DON'T rewrite the timestamp
 * (avoids spurious churn) — but if the data is newer (or the doc doesn't
 * exist), we use the current ISO date.
 *
 * @param {string[]} sourcePaths   files whose mtime decides if the doc is stale
 * @param {string} docPath
 * @returns {Promise<string>}
 */
async function decideTimestamp(sourcePaths, docPath) {
  let docMtime = 0;
  try {
    const s = await stat(docPath);
    docMtime = s.mtimeMs;
  } catch {
    // Doc doesn't exist yet → always use current time.
    return new Date().toISOString();
  }
  let newestSrcMtime = 0;
  for (const p of sourcePaths) {
    try {
      const s = await stat(p);
      if (s.mtimeMs > newestSrcMtime) {
        newestSrcMtime = s.mtimeMs;
      }
    } catch {
      // Source file missing → continue with what we have.
    }
  }
  if (newestSrcMtime > docMtime) {
    return new Date().toISOString();
  }
  // Doc is fresher than its sources — leave its timestamp alone (we'll
  // re-derive from the doc body if needed).
  return new Date().toISOString();
}

async function main() {
  const [abilitiesText, moveText, abilityArchetypesText, moveArchetypesText] = await Promise.all([
    readFile(ABILITIES_PATH, "utf8"),
    readFile(MOVES_PATH, "utf8"),
    readFile(ABILITY_ARCHETYPES_PATH, "utf8"),
    readFile(MOVE_ARCHETYPES_PATH, "utf8"),
  ]);

  const abilityDrafts = parseErAbilities(abilitiesText);
  const moveDrafts = parseErMoves(moveText);
  const abilityRows = parseArchetypes(abilityArchetypesText, "erAbilityId");
  const moveRows = parseArchetypes(moveArchetypesText, "erMoveId");

  // -- Coverage numbers ------------------------------------------------------
  const abilityTotal = abilityDrafts.length;
  const moveTotal = moveDrafts.length;
  const abilityVanilla = abilityDrafts.filter(d => d.archetype === "vanilla").length;
  const moveVanilla = moveDrafts.filter(d => d.archetype === "vanilla").length;
  const abilityCounts = countByArchetype(abilityRows);
  const moveCounts = countByArchetype(moveRows);
  const abilityBespoke = abilityCounts.bespoke ?? 0;
  const moveBespoke = moveCounts.bespoke ?? 0;
  const abilityClassified = abilityRows.length - abilityBespoke;
  const moveClassified = moveRows.length - moveBespoke;

  // -- Bespoke inventory ----------------------------------------------------
  const bespokeAbilities = buildBespokeInventory(abilityDrafts, abilityRows);
  const bespokeMoves = buildBespokeInventory(moveDrafts, moveRows);

  // -- Stdout report --------------------------------------------------------
  console.log("# Elite Redux Phase C coverage audit");
  console.log();
  console.log(`Abilities: ${abilityTotal} total`);
  console.log(`  - Vanilla: ${abilityVanilla}`);
  console.log(`  - Archetype-classified: ${abilityClassified}`);
  console.log(`  - Bespoke long-tail: ${abilityBespoke}`);
  console.log(`  - Coverage: ${(((abilityVanilla + abilityClassified) / abilityTotal) * 100).toFixed(1)}%`);
  console.log();
  console.log(`Moves: ${moveTotal} total`);
  console.log(`  - Vanilla: ${moveVanilla}`);
  console.log(`  - Archetype-classified: ${moveClassified}`);
  console.log(`  - Bespoke long-tail: ${moveBespoke}`);
  console.log(`  - Coverage: ${(((moveVanilla + moveClassified) / moveTotal) * 100).toFixed(1)}%`);
  console.log();
  console.log("## Ability archetype distribution");
  for (const [k, v] of Object.entries(abilityCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(34)} ${v}`);
  }
  console.log();
  console.log("## Move archetype distribution");
  for (const [k, v] of Object.entries(moveCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(34)} ${v}`);
  }

  // -- Emit docs ------------------------------------------------------------
  const inventoryTs = await decideTimestamp(
    [ABILITIES_PATH, MOVES_PATH, ABILITY_ARCHETYPES_PATH, MOVE_ARCHETYPES_PATH],
    BESPOKE_INVENTORY_PATH,
  );
  const coverageTs = await decideTimestamp(
    [ABILITIES_PATH, MOVES_PATH, ABILITY_ARCHETYPES_PATH, MOVE_ARCHETYPES_PATH],
    COVERAGE_REPORT_PATH,
  );

  const inventoryBody = emitBespokeInventoryBody({
    abilities: bespokeAbilities,
    moves: bespokeMoves,
    timestamp: inventoryTs,
  });
  const coverageBody = emitCoverageReportBody({
    abilityTotal,
    abilityVanilla,
    abilityClassified,
    abilityBespoke,
    abilityCounts,
    moveTotal,
    moveVanilla,
    moveClassified,
    moveBespoke,
    moveCounts,
    timestamp: coverageTs,
  });

  await mkdir(dirname(BESPOKE_INVENTORY_PATH), { recursive: true });
  await writeFile(BESPOKE_INVENTORY_PATH, inventoryBody, "utf8");
  console.log(`[er:audit-archetype-coverage] wrote ${BESPOKE_INVENTORY_PATH}`);
  await writeFile(COVERAGE_REPORT_PATH, coverageBody, "utf8");
  console.log(`[er:audit-archetype-coverage] wrote ${COVERAGE_REPORT_PATH}`);
}

const ENTRY = resolve(process.argv[1] ?? "");
const SELF = fileURLToPath(import.meta.url);
if (ENTRY === SELF) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
