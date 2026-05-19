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

  // --- Species: simple smoke-test pair (Bulbasaur + first `_REDUX` custom). ---
  // ER's mega-customs use a `_MEGA_REDUX` suffix; plain customs use `_REDUX`.
  // Matching `_REDUX$` deterministically catches both families ordered by the
  // vendor's own array (currently Crabruiser is the first hit).
  const sampleSpecies = {
    bulbasaur: j.species.find(s => /bulbasaur/i.test(s.NAME ?? s.name ?? "")),
    erCustom: j.species.find(s => /_REDUX$/.test(s.NAME ?? "")),
  };
  await writeFile(resolve(OUT_DIR, "sample-species.json"), `${JSON.stringify(sampleSpecies, null, 2)}\n`);

  // --- Species (rich): Venusaur (has 2 megas + 1 evolution chain) + first ER
  // mega-custom. Exercises multi-evolution, multi-mega, and ER mega handling
  // that the smoke fixture above doesn't cover.
  const sampleSpeciesRich = {
    venusaur: j.species.find(s => s.NAME === "SPECIES_VENUSAUR"),
    erMega: j.species.find(s => /_MEGA_REDUX$/.test(s.NAME ?? "")),
  };
  await writeFile(resolve(OUT_DIR, "sample-species-rich.json"), `${JSON.stringify(sampleSpeciesRich, null, 2)}\n`);

  // --- Abilities: id-based lookup is stable across array reorders. ---
  const sampleAbility = {
    vanilla: j.abilities.find(a => /OVERGROW/i.test(a.NAME ?? a.name ?? "")),
    erCustom: j.abilities.find(a => a.id === 400), // Scrapyard
  };
  await writeFile(resolve(OUT_DIR, "sample-ability.json"), `${JSON.stringify(sampleAbility, null, 2)}\n`);

  // --- Moves: id-based lookup is stable across array reorders. ---
  const sampleMove = {
    vanilla: j.moves.find(m => /TACKLE/i.test(m.NAME ?? m.name ?? "")),
    erCustom: j.moves.find(m => m.id === 950), // Eerie Fog
  };
  await writeFile(resolve(OUT_DIR, "sample-move.json"), `${JSON.stringify(sampleMove, null, 2)}\n`);

  // --- Trainers: simple smoke (first trainer, likely empty insane/hell). ---
  const sampleTrainer = j.trainers[0];
  await writeFile(resolve(OUT_DIR, "sample-trainer.json"), `${JSON.stringify(sampleTrainer, null, 2)}\n`);

  // --- Trainers (tiered): first trainer with all 3 difficulty tiers filled. ---
  // Exercises the difficulty-tier transformer path that the smoke trainer skips.
  const sampleTrainerTiered = j.trainers.find(t => t.party?.length > 0 && t.insane?.length > 0 && t.hell?.length > 0);
  await writeFile(resolve(OUT_DIR, "sample-trainer-tiered.json"), `${JSON.stringify(sampleTrainerTiered, null, 2)}\n`);

  console.log(
    `[er:fixtures] species: ${sampleSpecies.bulbasaur?.NAME} (id ${sampleSpecies.bulbasaur?.id}) + erCustom: ${sampleSpecies.erCustom?.NAME ?? "<none>"} (id ${sampleSpecies.erCustom?.id ?? "?"})`,
  );
  console.log(
    `[er:fixtures] speciesRich: ${sampleSpeciesRich.venusaur?.NAME} (id ${sampleSpeciesRich.venusaur?.id}) + erMega: ${sampleSpeciesRich.erMega?.NAME ?? "<none>"} (id ${sampleSpeciesRich.erMega?.id ?? "?"})`,
  );
  console.log(
    `[er:fixtures] ability vanilla: ${sampleAbility.vanilla?.name} (id ${sampleAbility.vanilla?.id}) + erCustom: ${sampleAbility.erCustom?.name ?? "<none>"} (id ${sampleAbility.erCustom?.id ?? "?"})`,
  );
  console.log(
    `[er:fixtures] move vanilla: ${sampleMove.vanilla?.name} (id ${sampleMove.vanilla?.id}) + erCustom: ${sampleMove.erCustom?.name ?? "<none>"} (id ${sampleMove.erCustom?.id ?? "?"})`,
  );
  console.log(
    `[er:fixtures] trainer simple: ${sampleTrainer.name} (party=${sampleTrainer.party?.length}, insane=${sampleTrainer.insane?.length}, hell=${sampleTrainer.hell?.length})`,
  );
  console.log(
    `[er:fixtures] trainer tiered: ${sampleTrainerTiered?.name ?? "<NONE FOUND>"} (party=${sampleTrainerTiered?.party?.length}, insane=${sampleTrainerTiered?.insane?.length}, hell=${sampleTrainerTiered?.hell?.length})`,
  );
  console.log("[er:fixtures] wrote 6 fixture files to scripts/elite-redux/fixtures/");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
