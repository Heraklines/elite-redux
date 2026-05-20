/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseFlags } from "./lib/parse-flags.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../..");
const SRC = resolve(ROOT, "vendor/elite-redux/v2.65beta.json");
const OUT_DIR = resolve(ROOT, "src/data/elite-redux");

// Each value is a thunk that dynamically imports the builder. Builders are not
// yet implemented — Tasks A5-A10 add them one at a time. The orchestrator
// remains functional with --only=<existing-builder> in the meantime.
const BUILDERS = {
  species: () => import("./builders/species.mjs"),
  abilities: () => import("./builders/abilities.mjs"),
  moves: () => import("./builders/moves.mjs"),
  trainers: () => import("./builders/trainers.mjs"),
  idmap: () => import("./builders/id-map.mjs"),
  sprites: () => import("./builders/sprite-manifest.mjs"),
  // B1b: depends on id-map's name-matching algorithm; runs after species/idmap
  // but reads the same dump so it stays decoupled from their emitted output.
  erSpeciesIdEnum: () => import("./builders/er-species-id-enum.mjs"),
  // B2: ER-custom ability + move enum companions. Same id-assignment logic
  // as idmap (custom IDs start at 5000), emitted to src/enums/.
  erAbilityIdEnum: () => import("./builders/er-ability-id-enum.mjs"),
  erMoveIdEnum: () => import("./builders/er-move-id-enum.mjs"),
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
    try {
      const { build } = await BUILDERS[key]();
      await build({ dump, outDir: OUT_DIR, flags });
    } catch (err) {
      // ERR_MODULE_NOT_FOUND from the dynamic import is expected for builders
      // not yet written (A5-A10). Other errors should surface — distinguish.
      if (err && typeof err === "object" && /** @type {{code?: string}} */ (err).code === "ERR_MODULE_NOT_FOUND") {
        console.warn(`[er:build] builder "${key}" not implemented yet — skipping`);
        continue;
      }
      throw err;
    }
  }
  console.log("[er:build] done.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
