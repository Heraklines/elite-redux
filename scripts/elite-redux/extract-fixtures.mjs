/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "../../vendor/elite-redux/v2.65beta.json");
const OUT_DIR = resolve(__dirname, "fixtures");

async function main() {
  const j = JSON.parse(await readFile(SRC, "utf8"));
  await mkdir(OUT_DIR, { recursive: true });

  // One vanilla + one ER-custom species. Pick by stable names so the fixture is reproducible.
  const sampleSpecies = {
    bulbasaur: j.species.find(s => /bulbasaur/i.test(s.NAME ?? s.name ?? "")),
    erCustom: j.species.find(s => s.NAME?.startsWith?.("MEGA_") || /CUSTOM|REDUX/.test(JSON.stringify(s))),
  };
  await writeFile(resolve(OUT_DIR, "sample-species.json"), `${JSON.stringify(sampleSpecies, null, 2)}\n`);

  const sampleAbility = {
    vanilla: j.abilities.find(a => /OVERGROW/i.test(a.NAME ?? a.name ?? "")),
    erCustom: j.abilities[400], // mid-range custom, stable index
  };
  await writeFile(resolve(OUT_DIR, "sample-ability.json"), `${JSON.stringify(sampleAbility, null, 2)}\n`);

  const sampleMove = {
    vanilla: j.moves.find(m => /TACKLE/i.test(m.NAME ?? m.name ?? "")),
    erCustom: j.moves[950],
  };
  await writeFile(resolve(OUT_DIR, "sample-move.json"), `${JSON.stringify(sampleMove, null, 2)}\n`);

  const sampleTrainer = j.trainers[0];
  await writeFile(resolve(OUT_DIR, "sample-trainer.json"), `${JSON.stringify(sampleTrainer, null, 2)}\n`);

  console.log("[er:fixtures] wrote 4 fixture files");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
