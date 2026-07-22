/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/*
 * Generate `src/data/elite-redux/er-custom-species-weights.ts` — a pokerogueId →
 * body-weight (kg) table for the ~827 ER-custom dump species (ids >= 10000).
 *
 * DEX-AUTHORITATIVE weight source (priority order):
 *   1. ROM (gSpeciesInfo). The ER 2.65 dump carries per-species height/weight in
 *      `species[].dex.hw = [heightDecimetres, weightHectograms]`. weight kg =
 *      hw[1] / 10. 802 of 827 customs have a non-zero ROM weight — extracted here.
 *   2. Canon-derived. 25 ER-original fakemon ship `hw = [0, 0]` (ForwardFeed left
 *      them blank). Where such a mon evolves FROM a canon/ROM species, its weight
 *      is derived from that anchor, adjusted for the sprite's build.
 *   3. Sprite / size-class estimate. The remainder (no evo anchor) are reasoned
 *      from the rendered sprite's apparent mass. Forms/megas inherit their base.
 *
 * The 25 non-ROM weights live in ESTIMATES below (keyed by ER species id) with a
 * per-row provenance note. They are the ONLY hand-entered values; everything else
 * is machine-extracted from ROM, so this file regenerates deterministically.
 *
 * Regenerate: node scripts/elite-redux/build-custom-species-weights.mjs
 * (requires the vendor cache — run `pnpm run er:fetch` first).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SRC = resolve(ROOT, "vendor/elite-redux/v2.65beta.json");
const ID_MAP_TS = resolve(ROOT, "src/data/elite-redux/er-id-map.ts");
const OUT = resolve(ROOT, "src/data/elite-redux/er-custom-species-weights.ts");

const VANILLA_ID_CUTOFF = 10000;

/**
 * Estimated weights (kg) for the 25 ER-original customs whose ROM `hw` is [0, 0],
 * keyed by ER species id. `p` (provenance) tags: "canon" = derived from a canon/ROM
 * pre-evolution anchor; "sprite" = reasoned from the rendered sprite's size class;
 * "form" = inherited from a base custom (alt-forms / megas). Every row is a
 * designer-veto candidate — see the summary in the accompanying report.
 */
const ESTIMATES = {
  // --- canon-derived (evolves from / sibling of a ROM species) ---
  1031: { w: 300, p: "canon", n: "Beartic(260kg) evo — ice-armoured quadruped, heavier" },
  1036: { w: 48, p: "canon", n: "Jynx(40.6kg) evo — regal ice diva" },
  1041: { w: 230, p: "canon", n: "Gyarados-class serpent (Magikarp alt-evo)" },
  1042: { w: 150, p: "canon", n: "Torkoal(80.4kg) evo — stone-temple shell, much heavier" },
  1053: { w: 55, p: "canon", n: "Golduck-class duck (Psyduck line final, leaner/taller)" },
  1054: { w: 30, p: "canon", n: "Psyduck(19.6kg) evo — cloaked mid-stage duck" },
  1058: { w: 150, p: "canon", n: "Dewgong(120kg) evo — larger sea-lion" },
  1059: { w: 200, p: "canon", n: "Crabominable(180kg) evo — heavyweight boxer crab" },
  // --- sprite / size-class estimate (no reliable evo anchor) ---
  1046: { w: 25, p: "sprite", n: "large moth (Corm 3.8kg evo)" },
  1047: { w: 15, p: "sprite", n: "fluffy popcorn puff (Corm 3.8kg evo)" },
  1048: { w: 130, p: "sprite", n: "large ice predator (BST590 standalone)" },
  1049: { w: 120, p: "sprite", n: "Slaking-class sloth (Slaking 130.5kg analogue)" },
  1051: { w: 180, p: "sprite", n: "magma golem (BST580 standalone)" },
  1066: { w: 50, p: "sprite", n: "granite apple-dragon (Appletun 13kg evo, stone-laden)" },
  1067: { w: 15, p: "sprite", n: "winged apple-dragon (Flapple 1kg evo)" },
  1072: { w: 50, p: "sprite", n: "armoured crab-warrior (Crawdaunt 32.8kg analogue, bulkier)" },
  1075: { w: 5, p: "sprite", n: "small electric rodent (Morpeko 3kg analogue)" },
  2572: { w: 90, p: "sprite", n: "metallic beetle-knight (Ledian/Iron paradox)" },
  // --- form / mega — inherit base custom mass ---
  1846: { w: 300, p: "form", n: "Polartic(1031) Bluemoon form" },
  1847: { w: 120, p: "form", n: "Lumber Sloth(1049) Engulfed form" },
  1864: { w: 5, p: "form", n: "Morpekyll(1075) Hangry form (same mass)" },
  2160: { w: 300, p: "form", n: "Gyaradeath(1041) Mega X (+~30% per Gyarados-mega)" },
  2161: { w: 300, p: "form", n: "Gyaradeath(1041) Mega Y" },
  2172: { w: 35, p: "form", n: "Cormoth(1046) Mega" },
  2173: { w: 22, p: "form", n: "Popcorm(1047) Mega" },
};

/** Parse the `species` record out of the committed (generated) er-id-map.ts. */
function parseIdMap(txt) {
  const block = txt.match(/"species":\s*\{([\s\S]*?)\n {2}\},/);
  if (!block) {
    throw new Error("could not locate species block in er-id-map.ts");
  }
  const map = new Map();
  for (const m of block[1].matchAll(/"(-?\d+)":\s*(\d+)/g)) {
    map.set(Number(m[1]), Number(m[2]));
  }
  return map;
}

async function main() {
  const dump = JSON.parse(await readFile(SRC, "utf8"));
  const idMap = parseIdMap(await readFile(ID_MAP_TS, "utf8"));

  // ER species id → ROM hw and name.
  const hwById = new Map();
  const nameById = new Map();
  for (const sp of dump.species ?? []) {
    if (sp.id === undefined) {
      continue;
    }
    hwById.set(sp.id, sp.dex && Array.isArray(sp.dex.hw) ? sp.dex.hw : null);
    nameById.set(sp.id, sp.name ?? sp.NAME ?? String(sp.id));
  }

  // Collect (pokerogueId, weight, provenance) for every custom (prId >= cutoff).
  const rows = [];
  const counts = { rom: 0, canon: 0, sprite: 0, form: 0 };
  const estimatedRows = [];
  for (const [erId, prId] of idMap) {
    if (prId < VANILLA_ID_CUTOFF) {
      continue;
    }
    const name = nameById.get(erId) ?? String(erId);
    const hw = hwById.get(erId);
    const est = ESTIMATES[erId];
    let weight;
    let prov;
    let note;
    if (hw && hw[1] > 0) {
      weight = Math.round(hw[1]) / 10; // hectograms → kg, 1dp
      prov = "rom";
      counts.rom++;
    } else if (est) {
      weight = est.w;
      prov = est.p;
      note = est.n;
      counts[est.p]++;
      estimatedRows.push({ prId, erId, name, weight, prov, note });
    } else {
      // No ROM weight and no estimate authored — should not happen; fail loud so
      // a future dump that adds blank-hw customs is caught rather than silently 30kg.
      throw new Error(`custom er id ${erId} (${name} → ${prId}) has hw=[0,0] and no ESTIMATES entry`);
    }
    rows.push({ prId, erId, name, weight, prov, note });
  }
  rows.sort((a, b) => a.prId - b.prId);
  estimatedRows.sort((a, b) => a.prId - b.prId);

  // Emit.
  const banner = `// =============================================================================
// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Source: vendor/elite-redux/v2.65beta.json  (ROM gSpeciesInfo dex.hw)
// Regenerate with: node scripts/elite-redux/build-custom-species-weights.mjs
// =============================================================================
`;
  const header = `/**
 * Body weight (kg) for every ER-custom dump species (pokerogueId >= ${VANILLA_ID_CUTOFF}),
 * consumed by \`buildCustomSpecies\` (init-elite-redux-custom-species.ts) to feed
 * Heavy Slam / Heat Crash / Grass Knot / Low Kick / Sky Drop and weight-based
 * abilities. Replaces the legacy flat 30.0kg placeholder.
 *
 * Provenance (see the weight-audit report for the full grouped table):
 *   - ${counts.rom} rows: ROM-extracted (gSpeciesInfo dex.hw[1] / 10).
 *   - ${counts.canon} rows: canon-derived (blank ROM hw; anchored to a canon pre-evo).
 *   - ${counts.sprite} rows: sprite/size-class estimate (blank ROM hw; no evo anchor).
 *   - ${counts.form} rows: form/mega inheriting its base custom's mass.
 * The ${counts.canon + counts.sprite + counts.form} non-ROM rows are designer-veto candidates and carry an
 * inline provenance note (\`EST\` marker).
 */`;

  const lines = rows.map(r => {
    const tag = r.prov === "rom" ? "" : `  // EST(${r.prov}): ${r.note}`;
    const label = r.prov === "rom" ? `  // ${r.name}` : "";
    return `  ${r.prId}: ${r.weight.toFixed(1)},${tag || label}`;
  });

  const body = `${header}
export const ER_CUSTOM_SPECIES_WEIGHTS: Readonly<Record<number, number>> = {
${lines.join("\n")}
};
`;

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, banner + "\n" + body, "utf8");

  console.log(`[er:weights] wrote ${rows.length} rows → ${OUT}`);
  console.log(`[er:weights]   rom=${counts.rom} canon=${counts.canon} sprite=${counts.sprite} form=${counts.form}`);
  console.log("[er:weights] estimated (veto) rows:");
  for (const r of estimatedRows) {
    console.log(`  ${r.prId}  ${r.name.padEnd(28)} ${String(r.weight).padStart(6)}kg  [${r.prov}] ${r.note}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
