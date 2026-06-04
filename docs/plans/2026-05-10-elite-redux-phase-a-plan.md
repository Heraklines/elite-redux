# Elite Redux v2.65 Port — Phase A (Foundation) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the data-extraction pipeline (ER JSON → draft TS modules), extend pokerogue's runtime schema to support 3 passives per species, and enumerate the ability/move archetype taxonomy that Phase C will implement against.

**Architecture:** Out-of-tree scripts (`scripts/elite-redux/*.mjs`) read the v2.65 JSON dump from `ForwardFeed/ER-nextdex` and emit TypeScript modules into `src/data/elite-redux/`. The emitted modules are NOT wired into the game yet — that's Phase B. We also widen `Passive` from a 2-bit single-slot bitmask to a 6-bit 3-slot bitmask, extend `PokemonSpeciesForm` with a `passives[]` accessor, and update `apply-ab-attrs.ts` to iterate the three passive slots in addition to the active ability.

**Tech Stack:** Node 20 (existing pokerogue toolchain), TypeScript 5, AJV for JSON-shape validation, jq-style hand-rolled selectors for the transform. No new runtime dependencies — all ER work uses existing pokerogue libraries (`ts-node` via `tsx` for typecheck, `vitest` for tests).

**Worktree:** `C:\Users\Hafida\pokerogue\.worktrees\elite-redux` on branch `feat/elite-redux-port`. Baseline typecheck is clean.

---

## Task index

1.  Vendor cache + `.gitignore` for ER source data
2.  `fetch-source.mjs` — pinned-SHA download of `gameDataV2.65beta.json`
3.  Vendor manifest + fixture extraction for unit tests
4.  `build-pokerogue-data.mjs` scaffold with CLI + run-modes
5.  Species transformer — emit `er-species.ts`
6.  Abilities transformer — emit `er-abilities.ts` (data-only)
7.  Moves transformer — emit `er-moves.ts` (data-only)
8.  Trainers transformer — emit `er-trainers.ts` across 3 difficulty tiers
9.  ID-map generator — emit `er-id-map.ts`
10. Sprite manifest generator — emit `er-sprite-manifest.ts`
11. `fetch-sprites.mjs` — sparse-checkout of the public ER sprite repo
12. Schema: widen `Passive` enum to 6-bit, 3-slot
13. Schema: add `passives: AbilityId[]` + `getPassiveAbilities()` to `PokemonSpeciesForm`
14. Runtime: update `apply-ab-attrs.ts` to iterate all 3 passives
15. Save migration for the widened `passiveAttr`
16. Starter-select UI — 3 passive unlock checkboxes
17. Archetype taxonomy doc + clustering script

Phase complete when:
- `pnpm exec tsc --noEmit -p tsconfig.json` exits 0
- `pnpm test --run` exits 0 (no regressions vs baseline)
- `pnpm run er:build` emits all 6 draft TS modules under `src/data/elite-redux/`
- `docs/plans/elite-redux-archetype-taxonomy.md` lists ~20-30 archetypes with example abilities

---

### Task 1: Vendor cache + `.gitignore`

**Files:**
- Modify: `.gitignore`
- Create: `vendor/elite-redux/README.md` (small note explaining the cache contract)

**Step 1: Add vendor cache to `.gitignore`**

Add this section to `.gitignore`:

```
# Elite Redux source data — fetched at build time, not redistributed.
vendor/elite-redux/*.json
vendor/elite-redux/sprites/
```

**Step 2: Add the README**

```markdown
# Elite Redux Vendor Cache

Populated by `pnpm run er:fetch` and `pnpm run er:fetch-sprites`.
Source: https://github.com/ForwardFeed/ER-nextdex (data)
Source: https://github.com/Elite-Redux/eliteredux (sprites — sparse `graphics/pokemon/`)

DO NOT COMMIT contents of this directory. The pinned source SHA lives in
`scripts/elite-redux/sources.json`; rerun the fetch scripts to repopulate.
```

**Step 3: Verify**

Run: `git status`
Expected: `vendor/elite-redux/README.md` is the only new tracked file; nothing under `vendor/elite-redux/*.json` or `vendor/elite-redux/sprites/` would be tracked even if present.

**Step 4: Commit**

```bash
git add .gitignore vendor/elite-redux/README.md
git commit -m "chore(er): vendor-cache contract for elite-redux source data"
```

---

### Task 2: `fetch-source.mjs` — pinned-SHA download

**Files:**
- Create: `scripts/elite-redux/sources.json`
- Create: `scripts/elite-redux/fetch-source.mjs`
- Modify: `package.json` — add `er:fetch` script

**Step 1: Pin the source SHA**

Write `scripts/elite-redux/sources.json`:

```json
{
  "gameData": {
    "repo": "ForwardFeed/ER-nextdex",
    "ref": "main",
    "path": "static/js/data/gameDataV2.65beta.json",
    "expectedSizeBytes": 3870000,
    "comment": "v2.65 beta data dump — verified via spot-check of species/ability/move counts"
  }
}
```

**Step 2: Write the fetcher**

`scripts/elite-redux/fetch-source.mjs`:

```javascript
#!/usr/bin/env node
import { mkdir, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SRC = JSON.parse(await (await import("node:fs/promises")).readFile(resolve(__dirname, "sources.json"), "utf8"));
const VENDOR_DIR = resolve(ROOT, "vendor/elite-redux");
const OUT_PATH = resolve(VENDOR_DIR, "v2.65beta.json");

async function main() {
  await mkdir(VENDOR_DIR, { recursive: true });
  if (existsSync(OUT_PATH) && !process.argv.includes("--force")) {
    const s = await stat(OUT_PATH);
    console.log(`[er:fetch] cache hit (${s.size} bytes) — pass --force to refetch`);
    return;
  }
  const { repo, ref, path } = SRC.gameData;
  const url = `https://raw.githubusercontent.com/${repo}/${ref}/${path}`;
  console.log(`[er:fetch] GET ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(OUT_PATH, buf);
  console.log(`[er:fetch] wrote ${buf.length} bytes to ${OUT_PATH}`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 3: Wire `er:fetch` into `package.json`**

In the `"scripts"` block of `package.json`, add:

```json
"er:fetch": "node scripts/elite-redux/fetch-source.mjs"
```

**Step 4: Smoke test**

Run: `pnpm run er:fetch`
Expected: writes `vendor/elite-redux/v2.65beta.json` (~3.7 MB). Second run logs "cache hit".

**Step 5: Sanity-check the JSON**

Run (PowerShell-friendly):
```powershell
node -e "const j=require('./vendor/elite-redux/v2.65beta.json'); console.log({species:j.species.length, abilities:j.abilities.length, moves:j.moves.length, trainers:j.trainers.length});"
```
Expected: `{ species: 1907, abilities: 1034, moves: 1032, trainers: 895 }`

**Step 6: Commit**

```bash
git add scripts/elite-redux/sources.json scripts/elite-redux/fetch-source.mjs package.json
git commit -m "feat(er): pinned-SHA fetcher for v2.65beta source dump"
```

---

### Task 3: Vendor manifest + fixtures

**Files:**
- Create: `scripts/elite-redux/__fixtures__/sample-species.json`
- Create: `scripts/elite-redux/__fixtures__/sample-ability.json`
- Create: `scripts/elite-redux/__fixtures__/sample-move.json`
- Create: `scripts/elite-redux/__fixtures__/sample-trainer.json`

**Rationale:** Phase A's transforms need fast TDD. The full 3.8 MB JSON is too large for vitest runs; instead, extract small representative slices once and commit those as fixtures.

**Step 1: Write a one-shot extractor**

`scripts/elite-redux/extract-fixtures.mjs`:

```javascript
#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../../vendor/elite-redux/v2.65beta.json");
const OUT_DIR = resolve(__dirname, "__fixtures__");

async function main() {
  const j = JSON.parse(await readFile(SRC, "utf8"));
  await mkdir(OUT_DIR, { recursive: true });

  // One vanilla + one ER-custom species. Pick by stable names so the fixture is reproducible.
  const sampleSpecies = {
    bulbasaur: j.species.find(s => /bulbasaur/i.test(s.NAME ?? s.name ?? "")),
    erCustom: j.species.find(s => s.NAME?.startsWith?.("MEGA_") || /CUSTOM|REDUX/.test(JSON.stringify(s))),
  };
  await writeFile(resolve(OUT_DIR, "sample-species.json"), JSON.stringify(sampleSpecies, null, 2));

  // Same pattern for abilities/moves/trainers — pick one vanilla + one ER-custom.
  const sampleAbility = {
    vanilla: j.abilities.find(a => /OVERGROW/i.test(a.NAME ?? a.name ?? "")),
    erCustom: j.abilities[400], // mid-range custom, stable index
  };
  await writeFile(resolve(OUT_DIR, "sample-ability.json"), JSON.stringify(sampleAbility, null, 2));

  const sampleMove = {
    vanilla: j.moves.find(m => /TACKLE/i.test(m.NAME ?? m.name ?? "")),
    erCustom: j.moves[950],
  };
  await writeFile(resolve(OUT_DIR, "sample-move.json"), JSON.stringify(sampleMove, null, 2));

  const sampleTrainer = j.trainers[0];
  await writeFile(resolve(OUT_DIR, "sample-trainer.json"), JSON.stringify(sampleTrainer, null, 2));

  console.log("[er:fixtures] wrote 4 fixture files");
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 2: Run + verify**

Run: `node scripts/elite-redux/extract-fixtures.mjs`
Expected: four small JSON files under `__fixtures__/`.

Then open each fixture (`code scripts/elite-redux/__fixtures__/sample-species.json`) and verify the shape is recognizable — species has `stats`, `abis`, `inns`, `evos` arrays etc.

**Step 3: Commit**

```bash
git add scripts/elite-redux/extract-fixtures.mjs scripts/elite-redux/__fixtures__/
git commit -m "test(er): vendor sample fixtures for transform TDD"
```

---

### Task 4: `build-pokerogue-data.mjs` scaffold

**Files:**
- Create: `scripts/elite-redux/build-pokerogue-data.mjs`
- Create: `scripts/elite-redux/lib/emit.mjs` (shared writer + header banner)
- Create: `scripts/elite-redux/lib/parse-flags.mjs`
- Modify: `package.json` — add `er:build` script

**Step 1: Write the parse-flags helper**

`scripts/elite-redux/lib/parse-flags.mjs`:

```javascript
export function parseFlags(argv) {
  const flags = { only: null, force: false, dryRun: false };
  for (const arg of argv.slice(2)) {
    if (arg === "--force") flags.force = true;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg.startsWith("--only=")) flags.only = arg.slice("--only=".length).split(",");
  }
  return flags;
}
```

**Step 2: Write the shared emit helper**

`scripts/elite-redux/lib/emit.mjs`:

```javascript
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

const BANNER = `// =============================================================================
// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Source: vendor/elite-redux/v2.65beta.json
// Regenerate with: pnpm run er:build
// =============================================================================
`;

export async function emitModule(outPath, body) {
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, BANNER + "\n" + body, "utf8");
  console.log(`[er:emit] wrote ${outPath}`);
}
```

**Step 3: Write the build orchestrator**

`scripts/elite-redux/build-pokerogue-data.mjs`:

```javascript
#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags } from "./lib/parse-flags.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SRC = resolve(ROOT, "vendor/elite-redux/v2.65beta.json");
const OUT_DIR = resolve(ROOT, "src/data/elite-redux");

const BUILDERS = {
  species: () => import("./builders/species.mjs"),
  abilities: () => import("./builders/abilities.mjs"),
  moves: () => import("./builders/moves.mjs"),
  trainers: () => import("./builders/trainers.mjs"),
  idmap: () => import("./builders/id-map.mjs"),
  sprites: () => import("./builders/sprite-manifest.mjs"),
};

async function main() {
  const flags = parseFlags(process.argv);
  const dump = JSON.parse(await readFile(SRC, "utf8"));
  const keys = flags.only ?? Object.keys(BUILDERS);
  for (const key of keys) {
    if (!BUILDERS[key]) {
      console.warn(`[er:build] unknown builder "${key}" — skipping`);
      continue;
    }
    const { build } = await BUILDERS[key]();
    await build({ dump, outDir: OUT_DIR, flags });
  }
  console.log("[er:build] done.");
}

main().catch(err => { console.error(err); process.exit(1); });
```

**Step 4: Wire into `package.json`**

Add to the `"scripts"` block:

```json
"er:build": "node scripts/elite-redux/build-pokerogue-data.mjs",
"er:fixtures": "node scripts/elite-redux/extract-fixtures.mjs"
```

**Step 5: Smoke test the scaffold**

Run: `pnpm run er:build --only=idmap`
Expected: ERROR — `Cannot find module './builders/id-map.mjs'`. That's fine; we'll add builders next.

**Step 6: Commit**

```bash
git add scripts/elite-redux/build-pokerogue-data.mjs scripts/elite-redux/lib/ package.json
git commit -m "feat(er): build orchestrator scaffold with --only/--dry-run flags"
```

---

### Task 5: Species transformer

**Files:**
- Create: `scripts/elite-redux/builders/species.mjs`
- Create: `scripts/elite-redux/builders/__tests__/species.test.ts`
- Create: `src/data/elite-redux/er-species.ts` (emitted output)

ER species shape (verified from fixture): `{ NAME, types, stats: [hp, atk, def, spa, spd, spe], abis: [ability_constant_name × 3], inns: [innate_constant_name × 3], evos: [{from, kind, target, args}], baseExp, growthRate, height, weight, color, ... }`.

PokeRogue species shape: `{ speciesId: SpeciesId, name: string, type1: PokemonType, type2?: PokemonType, baseStats: [hp, atk, def, spa, spd, spe], ability1: AbilityId, ability2: AbilityId, abilityHidden: AbilityId, passives: AbilityId[3], baseExp, growthRate, ... }`.

Mapping:
- ER `abis[0..2]` → `ability1`, `ability2`, `abilityHidden` (fill with `AbilityId.NONE` if shorter)
- ER `inns[0..2]` → new `passives` triple, fill with `AbilityId.NONE` if shorter
- ER `stats[]` → pokerogue's stat tuple in the same order (verify: ER uses GBA order hp/atk/def/spa/spd/spe; pokerogue uses the same)
- ER `NAME` (`SPECIES_BULBASAUR`) → look up in `SpeciesId` enum; mons not in vanilla get IDs assigned by Task 9 (`er-id-map.ts`)

**Step 1: Write the failing test**

`scripts/elite-redux/builders/__tests__/species.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildSpeciesEntry } from "../species.mjs";

const FIX = resolve(__dirname, "../../__fixtures__/sample-species.json");

describe("species transformer", () => {
  it("maps a vanilla species shape", async () => {
    const fix = JSON.parse(await readFile(FIX, "utf8"));
    const entry = buildSpeciesEntry(fix.bulbasaur, { erIdForName: () => null });
    expect(entry.name).toBe("Bulbasaur");
    expect(entry.baseStats).toHaveLength(6);
    expect(entry.ability1).toBeTypeOf("string");
    expect(entry.passives).toHaveLength(3);
  });

  it("fills missing inns with NONE", () => {
    const sparse = { NAME: "SPECIES_RATTATA", stats: [30,56,35,25,35,72], abis: ["RUN_AWAY"], inns: ["GUTS"], evos: [] };
    const entry = buildSpeciesEntry(sparse, { erIdForName: () => null });
    expect(entry.passives).toEqual(["GUTS", "NONE", "NONE"]);
  });
});
```

**Step 2: Run + verify it fails**

Run: `pnpm exec vitest run scripts/elite-redux/builders/__tests__/species.test.ts`
Expected: `Cannot find module '../species.mjs'`

**Step 3: Implement `species.mjs`**

`scripts/elite-redux/builders/species.mjs`:

```javascript
import { resolve } from "node:path";
import { emitModule } from "../lib/emit.mjs";

const ABILITY_NONE = "NONE";

/** Strip "SPECIES_" prefix; convert to Title Case for display name. */
function nameFromConst(constName) {
  const stripped = (constName ?? "").replace(/^SPECIES_/, "");
  return stripped
    .toLowerCase()
    .split("_")
    .map(w => w.length ? w[0].toUpperCase() + w.slice(1) : w)
    .join(" ")
    .trim() || "Unknown";
}

/** "ABILITY_FOO_BAR" → "FOO_BAR" so we can match the pokerogue AbilityId enum. */
function abilityIdFromConst(constName) {
  return (constName ?? "").replace(/^ABILITY_/, "").trim() || ABILITY_NONE;
}

/** Map ER species' types[] (numbers or strings) to pokerogue PokemonType keys. */
function mapTypes(types, typeTable) {
  if (!Array.isArray(types) || types.length === 0) return ["NORMAL", null];
  const a = typeof types[0] === "number" ? typeTable[types[0]] : String(types[0]);
  const b = types.length > 1 ? (typeof types[1] === "number" ? typeTable[types[1]] : String(types[1])) : null;
  return [a, b === a ? null : b];
}

export function buildSpeciesEntry(raw, { erIdForName, typeTable = [] }) {
  const [type1, type2] = mapTypes(raw.types, typeTable);
  const abis = raw.abis ?? [];
  const inns = raw.inns ?? [];
  return {
    erId: erIdForName(raw.NAME),
    speciesConst: raw.NAME,
    name: nameFromConst(raw.NAME),
    type1,
    type2,
    baseStats: Array.isArray(raw.stats) && raw.stats.length === 6 ? raw.stats : [50,50,50,50,50,50],
    ability1: abilityIdFromConst(abis[0]),
    ability2: abilityIdFromConst(abis[1] ?? ABILITY_NONE),
    abilityHidden: abilityIdFromConst(abis[2] ?? ABILITY_NONE),
    passives: [
      abilityIdFromConst(inns[0] ?? ABILITY_NONE),
      abilityIdFromConst(inns[1] ?? ABILITY_NONE),
      abilityIdFromConst(inns[2] ?? ABILITY_NONE),
    ],
    baseExp: raw.baseExp ?? 50,
    growthRate: raw.growthRate ?? "Medium Slow",
    height: raw.height ?? 0,
    weight: raw.weight ?? 0,
  };
}

export async function build({ dump, outDir, flags }) {
  const typeTable = dump.typeT ?? [];
  const entries = (dump.species ?? []).map(raw =>
    buildSpeciesEntry(raw, { erIdForName: name => name ?? null, typeTable }),
  );
  const body = `import type { AbilityId } from "#enums/ability-id";
import type { PokemonType } from "#enums/pokemon-type";

export interface ErSpeciesDraft {
  readonly speciesConst: string;
  readonly name: string;
  readonly type1: keyof typeof PokemonType;
  readonly type2: keyof typeof PokemonType | null;
  readonly baseStats: readonly [number, number, number, number, number, number];
  readonly ability1: keyof typeof AbilityId;
  readonly ability2: keyof typeof AbilityId;
  readonly abilityHidden: keyof typeof AbilityId;
  readonly passives: readonly [keyof typeof AbilityId, keyof typeof AbilityId, keyof typeof AbilityId];
  readonly baseExp: number;
  readonly growthRate: string;
  readonly height: number;
  readonly weight: number;
}

export const ER_SPECIES: readonly ErSpeciesDraft[] = ${JSON.stringify(entries, null, 2)} as const;
`;
  if (flags.dryRun) {
    console.log(`[er:species] would emit ${entries.length} entries`);
    return;
  }
  await emitModule(resolve(outDir, "er-species.ts"), body);
  console.log(`[er:species] emitted ${entries.length} species`);
}
```

**Step 4: Verify test passes**

Run: `pnpm exec vitest run scripts/elite-redux/builders/__tests__/species.test.ts`
Expected: 2 passing.

**Step 5: Run the builder end-to-end**

Run: `pnpm run er:build -- --only=species`
Expected: `[er:species] emitted 1907 species` + `src/data/elite-redux/er-species.ts` created (~1-2 MB).

**Step 6: Typecheck the emitted file**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: 0 errors. If `keyof typeof AbilityId` fails because ER abilities reference IDs that don't exist in pokerogue's `AbilityId` enum yet — that's expected. Defer the typecheck-clean target to after Task 6 (abilities) extends `AbilityId`.

**Step 7: Commit**

```bash
git add scripts/elite-redux/builders/species.mjs scripts/elite-redux/builders/__tests__/species.test.ts src/data/elite-redux/er-species.ts
git commit -m "feat(er): species transformer — emit er-species.ts (1907 entries)"
```

---

### Task 6: Abilities transformer

**Files:**
- Create: `scripts/elite-redux/builders/abilities.mjs`
- Create: `scripts/elite-redux/builders/__tests__/abilities.test.ts`
- Create: `src/data/elite-redux/er-abilities.ts`

ER ability shape: `{ NAME: "ABILITY_OVERGROW", desc: "...", isInternal: false, customMechanics: {...} | undefined }`. The behavior of customs isn't encoded in the JSON — it's in C source. For Phase A we emit *data only* (name + description + an `archetype: "unknown"` placeholder that Phase C will rewrite via clustering analysis).

**Step 1: Write the failing test**

`scripts/elite-redux/builders/__tests__/abilities.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildAbilityEntry } from "../abilities.mjs";

const FIX = resolve(__dirname, "../../__fixtures__/sample-ability.json");

describe("abilities transformer", () => {
  it("maps vanilla ability", async () => {
    const fix = JSON.parse(await readFile(FIX, "utf8"));
    const entry = buildAbilityEntry(fix.vanilla);
    expect(entry.abilityConst).toMatch(/^ABILITY_/);
    expect(entry.name).toBe("Overgrow");
    expect(entry.archetype).toBe("vanilla");
  });

  it("flags ER-custom abilities", async () => {
    const fix = JSON.parse(await readFile(FIX, "utf8"));
    const entry = buildAbilityEntry(fix.erCustom);
    expect(entry.archetype).toBe("unknown"); // Phase C will reclassify
  });
});
```

**Step 2: Verify failing**

Run: `pnpm exec vitest run scripts/elite-redux/builders/__tests__/abilities.test.ts`
Expected: import-not-found.

**Step 3: Implement abilities.mjs**

`scripts/elite-redux/builders/abilities.mjs`:

```javascript
import { resolve } from "node:path";
import { emitModule } from "../lib/emit.mjs";

const VANILLA_ABILITIES = new Set([
  // Sourced by enumerating pokerogue's existing AbilityId enum at build time
  // (loaded from src/enums/ability-id.ts at run time). See helper below.
]);

function nameFromConst(constName) {
  return (constName ?? "ABILITY_NONE")
    .replace(/^ABILITY_/, "")
    .toLowerCase()
    .split("_")
    .map(w => w.length ? w[0].toUpperCase() + w.slice(1) : w)
    .join(" ");
}

export function buildAbilityEntry(raw) {
  const constName = raw.NAME ?? "ABILITY_NONE";
  const isVanilla = VANILLA_ABILITIES.has(constName);
  return {
    abilityConst: constName,
    name: nameFromConst(constName),
    description: raw.desc ?? raw.description ?? "",
    isInternal: !!raw.isInternal,
    archetype: isVanilla ? "vanilla" : "unknown",
  };
}

async function loadVanillaAbilitiesFromEnum() {
  // Read pokerogue's enum at build-time, populate VANILLA_ABILITIES.
  const { readFile } = await import("node:fs/promises");
  const path = resolve(import.meta.dirname, "../../../src/enums/ability-id.ts");
  const src = await readFile(path, "utf8");
  const re = /^\s*(\w+)\s*=/gm;
  let m;
  while ((m = re.exec(src))) {
    VANILLA_ABILITIES.add(`ABILITY_${m[1]}`);
  }
}

export async function build({ dump, outDir, flags }) {
  await loadVanillaAbilitiesFromEnum();
  const entries = (dump.abilities ?? []).map(buildAbilityEntry);
  const body = `export interface ErAbilityDraft {
  readonly abilityConst: string;
  readonly name: string;
  readonly description: string;
  readonly isInternal: boolean;
  readonly archetype: string;
}

export const ER_ABILITIES: readonly ErAbilityDraft[] = ${JSON.stringify(entries, null, 2)} as const;
`;
  if (flags.dryRun) {
    console.log(`[er:abilities] would emit ${entries.length} entries (${entries.filter(e=>e.archetype==="vanilla").length} vanilla)`);
    return;
  }
  await emitModule(resolve(outDir, "er-abilities.ts"), body);
  console.log(`[er:abilities] emitted ${entries.length} abilities`);
}
```

**Step 4: Verify test passes + run builder**

Run: `pnpm exec vitest run scripts/elite-redux/builders/__tests__/abilities.test.ts`
Expected: 2 passing.

Run: `pnpm run er:build -- --only=abilities`
Expected: `[er:abilities] emitted 1034 abilities` and ~320 are classified as `vanilla`.

**Step 5: Spot check the output**

Run: `node -e "const x=require('./src/data/elite-redux/er-abilities.ts'.replace('.ts','')); console.log(x.ER_ABILITIES.length);"` — actually this won't work for a `.ts` file. Use:

```powershell
Select-String -Path src\data\elite-redux\er-abilities.ts -Pattern "abilityConst" | Measure-Object | Select-Object -ExpandProperty Count
```
Expected: 1034.

**Step 6: Commit**

```bash
git add scripts/elite-redux/builders/abilities.mjs scripts/elite-redux/builders/__tests__/abilities.test.ts src/data/elite-redux/er-abilities.ts
git commit -m "feat(er): abilities transformer — emit er-abilities.ts (data only)"
```

---

### Task 7: Moves transformer

Same shape as Task 6 but for moves. ER move shape: `{ NAME: "MOVE_TACKLE", type, power, pp, accuracy, priority, target, effect, flags: ["FLAG_MAKES_CONTACT", ...], desc, ... }`.

**Files:**
- Create: `scripts/elite-redux/builders/moves.mjs`
- Create: `scripts/elite-redux/builders/__tests__/moves.test.ts`
- Create: `src/data/elite-redux/er-moves.ts`

**Step 1: Failing test**

```typescript
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { buildMoveEntry } from "../moves.mjs";

const FIX = resolve(__dirname, "../../__fixtures__/sample-move.json");

describe("moves transformer", () => {
  it("maps a vanilla move", async () => {
    const fix = JSON.parse(await readFile(FIX, "utf8"));
    const e = buildMoveEntry(fix.vanilla);
    expect(e.moveConst).toBe("MOVE_TACKLE");
    expect(e.power).toBeGreaterThan(0);
    expect(Array.isArray(e.flags)).toBe(true);
  });

  it("retains custom flags like HAMMER_BASED for ER moves", async () => {
    const fix = JSON.parse(await readFile(FIX, "utf8"));
    const e = buildMoveEntry(fix.erCustom);
    expect(e.archetype).toBe("unknown");
  });
});
```

**Step 2: Run + verify fails. Step 3: Implement.**

`scripts/elite-redux/builders/moves.mjs`:

```javascript
import { resolve } from "node:path";
import { emitModule } from "../lib/emit.mjs";

const VANILLA_MOVES = new Set();

function nameFromConst(constName) {
  return (constName ?? "MOVE_NONE")
    .replace(/^MOVE_/, "")
    .toLowerCase()
    .split("_")
    .map(w => w.length ? w[0].toUpperCase() + w.slice(1) : w)
    .join(" ");
}

export function buildMoveEntry(raw) {
  const constName = raw.NAME ?? "MOVE_NONE";
  return {
    moveConst: constName,
    name: nameFromConst(constName),
    type: raw.type ?? "NORMAL",
    power: raw.power ?? 0,
    pp: raw.pp ?? 0,
    accuracy: raw.accuracy ?? 100,
    priority: raw.priority ?? 0,
    target: raw.target ?? "SELECTED_TARGET",
    effect: raw.effect ?? "HIT",
    flags: Array.isArray(raw.flags) ? raw.flags.slice() : [],
    description: raw.desc ?? raw.description ?? "",
    archetype: VANILLA_MOVES.has(constName) ? "vanilla" : "unknown",
  };
}

async function loadVanillaMovesFromEnum() {
  const { readFile } = await import("node:fs/promises");
  const path = resolve(import.meta.dirname, "../../../src/enums/move-id.ts");
  const src = await readFile(path, "utf8");
  const re = /^\s*(\w+)\s*=/gm;
  let m;
  while ((m = re.exec(src))) VANILLA_MOVES.add(`MOVE_${m[1]}`);
}

export async function build({ dump, outDir, flags }) {
  await loadVanillaMovesFromEnum();
  const entries = (dump.moves ?? []).map(buildMoveEntry);
  const body = `export interface ErMoveDraft {
  readonly moveConst: string;
  readonly name: string;
  readonly type: string;
  readonly power: number;
  readonly pp: number;
  readonly accuracy: number;
  readonly priority: number;
  readonly target: string;
  readonly effect: string;
  readonly flags: readonly string[];
  readonly description: string;
  readonly archetype: string;
}

export const ER_MOVES: readonly ErMoveDraft[] = ${JSON.stringify(entries, null, 2)} as const;
`;
  if (flags.dryRun) {
    console.log(`[er:moves] would emit ${entries.length} entries`);
    return;
  }
  await emitModule(resolve(outDir, "er-moves.ts"), body);
}
```

**Step 4: Run tests + builder.** Step 5: Commit.

```bash
git add scripts/elite-redux/builders/moves.mjs scripts/elite-redux/builders/__tests__/moves.test.ts src/data/elite-redux/er-moves.ts
git commit -m "feat(er): moves transformer — emit er-moves.ts (data only)"
```

---

### Task 8: Trainers transformer

ER trainer shape: `{ NAME, party, insane, hell }` where each tier is an array of `{ species, level, item, ability, moves, nature, evs, ivs }` per slot.

**Files:**
- Create: `scripts/elite-redux/builders/trainers.mjs`
- Create: `scripts/elite-redux/builders/__tests__/trainers.test.ts`
- Create: `src/data/elite-redux/er-trainers.ts`

**Step 1-5:** Same pattern. Test: fixture trainer has `party` array length > 0, both `insane`/`hell` tiers are optional but present if defined.

Builder body — emit:

```typescript
export interface ErTrainerSlot {
  readonly species: string;     // "SPECIES_PIKACHU"
  readonly level: number;
  readonly item: string | null; // "ITEM_LEFTOVERS"
  readonly ability: string | null;
  readonly moves: readonly string[];
  readonly nature: string | null;
  readonly evs: readonly [number, number, number, number, number, number] | null;
  readonly ivs: readonly [number, number, number, number, number, number] | null;
}

export interface ErTrainerDraft {
  readonly trainerConst: string;
  readonly name: string;
  readonly trainerClass: string;
  readonly party: readonly ErTrainerSlot[];
  readonly insaneParty: readonly ErTrainerSlot[] | null;
  readonly hellParty: readonly ErTrainerSlot[] | null;
}

export const ER_TRAINERS: readonly ErTrainerDraft[] = [...];
```

**Step 6: Commit.**

```bash
git add scripts/elite-redux/builders/trainers.mjs scripts/elite-redux/builders/__tests__/trainers.test.ts src/data/elite-redux/er-trainers.ts
git commit -m "feat(er): trainers transformer — emit er-trainers.ts across 3 tiers"
```

---

### Task 9: ID-map generator

`er-id-map.ts` is the source of truth for ER-const ↔ pokerogue-`SpeciesId`/`AbilityId`/`MoveId` mapping. Vanilla mons get their existing pokerogue IDs; ER customs get fresh IDs starting at 10000 (species), 5000 (abilities), 5000 (moves).

**Files:**
- Create: `scripts/elite-redux/builders/id-map.mjs`
- Create: `scripts/elite-redux/builders/__tests__/id-map.test.ts`
- Create: `src/data/elite-redux/er-id-map.ts`

**Step 1: Failing test**

```typescript
import { buildIdMap } from "../id-map.mjs";

it("preserves vanilla IDs", () => {
  const m = buildIdMap({
    species: [{ NAME: "SPECIES_BULBASAUR" }, { NAME: "SPECIES_CUSTOM_THING" }],
    vanillaSpecies: { SPECIES_BULBASAUR: 1 },
    nextCustomId: 10000,
  });
  expect(m.species["SPECIES_BULBASAUR"]).toBe(1);
  expect(m.species["SPECIES_CUSTOM_THING"]).toBe(10000);
});
```

**Step 2: Implement**

`id-map.mjs`:

```javascript
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import { emitModule } from "../lib/emit.mjs";

function parseEnum(path, prefix) {
  return readFile(path, "utf8").then(src => {
    const out = {};
    const re = /^\s*(\w+)\s*=\s*(\d+)/gm;
    let m;
    while ((m = re.exec(src))) out[`${prefix}${m[1]}`] = Number(m[2]);
    return out;
  });
}

export function buildIdMap({ species, vanillaSpecies, nextCustomId }) {
  const out = { species: {} };
  let next = nextCustomId;
  for (const sp of species) {
    out.species[sp.NAME] = vanillaSpecies[sp.NAME] ?? next++;
  }
  return out;
}

export async function build({ dump, outDir, flags }) {
  const vanillaSpecies = await parseEnum(
    resolve(import.meta.dirname, "../../../src/enums/species-id.ts"),
    "SPECIES_",
  );
  const vanillaAbilities = await parseEnum(
    resolve(import.meta.dirname, "../../../src/enums/ability-id.ts"),
    "ABILITY_",
  );
  const vanillaMoves = await parseEnum(
    resolve(import.meta.dirname, "../../../src/enums/move-id.ts"),
    "MOVE_",
  );
  const speciesMap = buildIdMap({ species: dump.species, vanillaSpecies, nextCustomId: 10000 });
  // ... abilities + moves analogous, starting at 5000 each
  const body = `export const ER_ID_MAP = ${JSON.stringify({ species: speciesMap.species }, null, 2)} as const;`;
  if (flags.dryRun) return;
  await emitModule(resolve(outDir, "er-id-map.ts"), body);
}
```

**Step 3-5: Run + commit.**

### A9 — Trainer-class aliasing note

ER's 64 `tclassT` entries only exact-match 21 of pokerogue's `TrainerType` enum
(33% coverage). The other 43 need hand-curated aliasing. Examples:

- `Pkmn Breeder` → `BREEDER`
- `Pkmn Ranger` → `RANGER`
- `Swimmer M` / `Swimmer F` → `SWIMMER`
- `Pkmn Trainer 1` / `2` / `3` / `4` → `ACE_TRAINER` (or per-region splits)
- `Cooltrainer` → `ACE_TRAINER`
- `Team Aqua` / `Team Magma` → faction-specific (probably new pokerogue enum entries)
- `Champion`, `Leader`, `Elite Four` → existing pokerogue equivalents

A9 should emit `er-trainer-class-aliases.ts` with an explicit alias map (~50 entries)
and document any unresolvable cases (e.g., faction-specific ER classes that have
no pokerogue equivalent).

---

### Task 10: Sprite manifest generator

Just emits a static mapping from ER species name → expected sprite path. Sprite files are downloaded by Task 11.

**Files:**
- Create: `scripts/elite-redux/builders/sprite-manifest.mjs`
- Create: `src/data/elite-redux/er-sprite-manifest.ts`

Body:

```typescript
export const ER_SPRITE_MANIFEST: Record<string, { front: string; back: string; icon: string; shinyFront: string; shinyBack: string }> = {...};
```

Path scheme: `assets/images/pokemon/elite-redux/<sanitized-name>.png`. The transform just enumerates the species list and emits the expected paths — actual file existence is checked by Task 11's downloader.

Commit. Same TDD shape, no new pattern.

---

### Task 11: `fetch-sprites.mjs` — sparse-checkout

**Files:**
- Create: `scripts/elite-redux/fetch-sprites.mjs`
- Modify: `package.json` — add `er:fetch-sprites` script

Use `git sparse-checkout` against `https://github.com/Elite-Redux/eliteredux.git`, fetch only `graphics/pokemon/`, copy PNGs into `assets/images/pokemon/elite-redux/<sanitized-name>.png`. Idempotent — if `vendor/elite-redux/sprites/.fetched` marker exists, skip the clone.

```javascript
#!/usr/bin/env node
import { mkdir, cp, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const VENDOR = resolve(ROOT, "vendor/elite-redux/sprites");
const ASSET_DIR = resolve(ROOT, "assets/images/pokemon/elite-redux");
const MARKER = resolve(VENDOR, ".fetched");

function run(...args) {
  console.log("$", args.join(" "));
  execFileSync(args[0], args.slice(1), { stdio: "inherit", cwd: VENDOR });
}

async function main() {
  if (existsSync(MARKER) && !process.argv.includes("--force")) {
    console.log("[er:fetch-sprites] cache hit — pass --force to re-clone");
    return;
  }
  await mkdir(VENDOR, { recursive: true });
  run("git", "init");
  run("git", "remote", "add", "-f", "origin", "https://github.com/Elite-Redux/eliteredux.git");
  run("git", "config", "core.sparseCheckout", "true");
  await writeFile(resolve(VENDOR, ".git/info/sparse-checkout"), "graphics/pokemon/\n");
  run("git", "pull", "--depth=1", "origin", "master");

  // Mirror PNGs into assets/images/pokemon/elite-redux/
  await mkdir(ASSET_DIR, { recursive: true });
  const src = resolve(VENDOR, "graphics/pokemon");
  await mirror(src, ASSET_DIR);
  await writeFile(MARKER, new Date().toISOString());
  console.log("[er:fetch-sprites] done.");
}

async function mirror(src, dst) {
  for (const ent of await readdir(src, { withFileTypes: true })) {
    const s = join(src, ent.name);
    const d = join(dst, ent.name);
    if (ent.isDirectory()) {
      await mkdir(d, { recursive: true });
      await mirror(s, d);
    } else if (ent.isFile() && ent.name.endsWith(".png")) {
      await cp(s, d);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

`package.json`:

```json
"er:fetch-sprites": "node scripts/elite-redux/fetch-sprites.mjs"
```

Run + verify a known sprite landed (e.g., `assets/images/pokemon/elite-redux/front/bulbasaur.png` exists). Commit.

---

### Task 12: Widen `Passive` enum to 6 bits, 3 slots

**Files:**
- Modify: `src/enums/passive.ts`
- Test: `src/enums/__tests__/passive.test.ts` (new)

Current shape (only 1 slot today):
```typescript
export enum Passive {
  UNLOCKED = 1,
  ENABLED = 2,
}
```

Widen to:
```typescript
export enum Passive {
  // Slot 1 (cheap unlock)
  UNLOCKED_1 = 1 << 0,
  ENABLED_1 = 1 << 1,
  // Slot 2 (medium unlock)
  UNLOCKED_2 = 1 << 2,
  ENABLED_2 = 1 << 3,
  // Slot 3 (expensive unlock)
  UNLOCKED_3 = 1 << 4,
  ENABLED_3 = 1 << 5,

  // Back-compat aliases for the existing single-slot callsites.
  // The legacy code paths use `UNLOCKED`/`ENABLED` to refer to slot 1.
  UNLOCKED = UNLOCKED_1,
  ENABLED = ENABLED_1,
}
```

**Step 1: Test**

```typescript
import { describe, it, expect } from "vitest";
import { Passive } from "#enums/passive";

describe("Passive bitmask", () => {
  it("legacy UNLOCKED/ENABLED map to slot 1", () => {
    expect(Passive.UNLOCKED).toBe(Passive.UNLOCKED_1);
    expect(Passive.ENABLED).toBe(Passive.ENABLED_1);
  });
  it("slots are independent bits", () => {
    expect(Passive.UNLOCKED_1 | Passive.UNLOCKED_2).toBe(0b101);
    expect(Passive.UNLOCKED_1 & Passive.UNLOCKED_2).toBe(0);
  });
});
```

**Step 2-4:** Implement the widened enum, run test, run full `pnpm test --run` to confirm no regression.

**Step 5: Commit.**

```bash
git add src/enums/passive.ts src/enums/__tests__/passive.test.ts
git commit -m "feat(er): widen Passive bitmask to 6 bits across 3 slots"
```

---

### Task 13: Add `passives[]` to `PokemonSpeciesForm`

**Files:**
- Modify: `src/data/pokemon-species.ts` (constructor + fields + new accessor)
- Modify: `src/data/balance/passive-data.ts` (add aliased 3-passive table — or create new `starterPassiveAbilities3` if existing one stays for back-compat)
- Test: `src/data/__tests__/pokemon-species-passives.test.ts` (new)

**Schema change at `src/data/pokemon-species.ts:91-93`:**

Add a new private field `_passives?: readonly [AbilityId, AbilityId, AbilityId]` and a new method:

```typescript
getPassiveAbilities(formIndex = this.formIndex): readonly [AbilityId, AbilityId, AbilityId] {
  // Legacy single-passive lookup remains via getPassiveAbility() (slot 1 only).
  // ER species set passives explicitly via setPassives() during init.
  return this._passives ?? [this.getPassiveAbility(formIndex), AbilityId.NONE, AbilityId.NONE];
}

setPassives(passives: readonly [AbilityId, AbilityId, AbilityId]): void {
  this._passives = passives;
}
```

`getPassiveAbility()` stays untouched (back-compat — returns slot 1).

**Step 1: Test that vanilla mons return single passive in slot 1 only**
**Step 2: Test that a mon with explicit `setPassives([X, Y, Z])` returns all three**
**Step 3: Implement, run, commit.**

---

### Task 14: Update `apply-ab-attrs.ts` to iterate all 3 passives

**File:** `src/data/abilities/apply-ab-attrs.ts:97-100`

Current:
```typescript
for (const passive of [false, true]) {
  params.passive = passive;
  applySingleAbAttrs(attrType, params, config);
}
```

New: introduce an `AbilitySource` discriminator that supports `{ kind: "active" } | { kind: "passive"; slot: 0 | 1 | 2 }`. Update `applySingleAbAttrs` to consume it; update the resolution at line 32 to use the source kind:

```typescript
const source = params.abilitySource ?? { kind: "active" };
const ability = source.kind === "active"
  ? pokemon.getAbility()
  : pokemon.getPassiveAbilitiesEnabled()[source.slot];
if (!ability || ability.id === AbilityId.NONE) return;
```

Loop in `applyAbAttrsInternal`:
```typescript
for (const source of [{ kind: "active" }, { kind: "passive", slot: 0 }, { kind: "passive", slot: 1 }, { kind: "passive", slot: 2 }] as const) {
  params.abilitySource = source;
  applySingleAbAttrs(attrType, params, config);
}
params.abilitySource = undefined;
```

Add `getPassiveAbilitiesEnabled()` on the Pokemon class (existing `Pokemon`, not `PokemonSpeciesForm`) — returns `[Ability, Ability, Ability]` with disabled slots replaced by a sentinel "no-op ability" so the rest of the pipeline doesn't break.

**Step 1-5:** TDD as usual. Run `pnpm test --run` after to confirm no regression.

**Step 6: Commit.**

---

### Task 15: Save migration

`src/system/game-data.ts:1551` currently sets `passiveAttr: 0` for new starters — that already works under the widened bitmask (slot 1 is bit 0, just like before, so legacy semantics carry over). What we need to do:

1. **Bump the save schema version** in `src/@types/save-data.ts` (or wherever `SYSTEM_DATA_VERSION` lives) so the load code knows whether the save predates the widened bitmask.
2. **In the loader,** if `passiveAttr` is from an older save, keep the value as-is — the legacy meaning (slot 1) is preserved by our aliasing in Task 12.
3. **No data loss:** existing players who unlocked their passive still have `Passive.ENABLED | Passive.UNLOCKED` set, which equals `Passive.ENABLED_1 | Passive.UNLOCKED_1`. Working as intended.

**Test:** load a v1 save (pre-widening) → assert `passiveAttr & Passive.UNLOCKED_1` matches the old meaning.

---

### Task 16: Starter-select UI — 3 passive checkboxes

**File:** `src/ui/handlers/starter-select-ui-handler.ts` (lines 2164-2261 are the existing single-passive logic).

This is the largest UI change. We add a sub-panel that shows three passive rows; each row has its own unlock-cost text + checkbox to enable. Spec:

- Row 1: cost = current candy cost (smallest)
- Row 2: cost = 2× row-1 cost
- Row 3: cost = 4× row-1 cost
- Sort order: render in `passives[]` array order from `PokemonSpeciesForm.getPassiveAbilities()`
- Display ability name + description tooltip for each
- Toggle = `passiveAttr ^= Passive.ENABLED_<slot>`
- Unlock = `passiveAttr |= Passive.UNLOCKED_<slot> | Passive.ENABLED_<slot>`, deducts candy

Plan a careful refactor: extract a `PassiveRow` Phaser component that takes `slot: 0 | 1 | 2`. Existing single-passive code at lines 2164-2261 becomes 3 calls to this component.

**Step 1-N:** Build the component first (with snapshot test), then refactor the handler.

**Step 6: Commit.**

```bash
git add src/ui/handlers/starter-select-ui-handler.ts src/ui/components/passive-row.ts src/ui/components/__tests__/passive-row.test.ts
git commit -m "feat(er): 3-slot passive unlock UI in starter-select"
```

---

### Task 17: Archetype taxonomy doc

**File:** `docs/plans/elite-redux-archetype-taxonomy.md`

Source: read all 1034 ER abilities + 1032 moves from the emitted draft modules, cluster by description shape, write the doc.

**Step 1: Write a one-shot clustering script**

`scripts/elite-redux/cluster-archetypes.mjs`:

```javascript
import { ER_ABILITIES } from "../../src/data/elite-redux/er-abilities.ts";
// ... use a dynamic import + ts-node to load the draft module
// For each ability, normalize the description (lowercase, strip numbers/punctuation),
// then group by stem-similarity. Emit clusters sorted by size.
```

Output a Markdown doc shaped like:

```markdown
# Elite Redux Ability/Move Archetypes (v2.65)

## 1. type-damage-boost (~120 abilities, ~30 moves)
Description shape: "Boosts damage of {TYPE}-type moves by {N}%"
Example abilities: BLAZE_BOOST, FROST_BOOST, ...
Example moves: BLAST_BURN, HYDRO_CANNON, ...

## 2. flag-damage-boost (~80 abilities, ~12 moves)
Description shape: "{N}% damage when using {FLAG}-flag moves" (FLAG ∈ Hammer-Based, Sound-Based, Bullet, Dance, Arrow)

## 3. stat-trigger-on-event (~95 abilities)
Description shape: "{STAT} {DIRECTION} on {EVENT}"
EVENT ∈ {KO an opponent, take damage, switch in, hit foe with super-effective, ...}

...

(15-30 sections total)

## Long tail (~50 abilities, ~20 moves)
Genuinely novel — get bespoke implementations in Phase C.
```

**Step 2-4:** Run, hand-verify clusters (some auto-clusters will be wrong — manually merge/split for ~15 min), commit doc.

**Step 5: Commit.**

```bash
git add docs/plans/elite-redux-archetype-taxonomy.md scripts/elite-redux/cluster-archetypes.mjs
git commit -m "docs(er): archetype taxonomy from v2.65 description clustering"
```

---

## Phase A exit gate

Run all of these from the worktree root; each must succeed:

```powershell
pnpm run er:fetch
pnpm run er:fetch-sprites
pnpm run er:build
pnpm exec tsc --noEmit -p tsconfig.json
pnpm test --run
```

Expected:
- `vendor/elite-redux/v2.65beta.json` exists (~3.7 MB)
- `assets/images/pokemon/elite-redux/` populated with PNGs
- `src/data/elite-redux/{er-species,er-abilities,er-moves,er-trainers,er-id-map,er-sprite-manifest}.ts` all present and typecheck-clean (after the schema work)
- Full test suite passes
- `docs/plans/elite-redux-archetype-taxonomy.md` enumerates 15-30 archetypes

**Phase A complete → ready for Phase B (data wire-up).**
