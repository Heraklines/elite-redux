#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const RESIST_BERRIES = {
  BUG: "Tanga Berry",
  DARK: "Colbur Berry",
  DRAGON: "Haban Berry",
  ELECTRIC: "Wacan Berry",
  FAIRY: "Roseli Berry",
  FIGHTING: "Chople Berry",
  FIRE: "Occa Berry",
  FLYING: "Coba Berry",
  GHOST: "Kasib Berry",
  GRASS: "Rindo Berry",
  GROUND: "Shuca Berry",
  ICE: "Yache Berry",
  NORMAL: "Chilan Berry",
  POISON: "Kebia Berry",
  PSYCHIC: "Payapa Berry",
  ROCK: "Charti Berry",
  STEEL: "Babiri Berry",
  WATER: "Passho Berry",
};

const WARD_STONES = {
  GREATER: "Greater Ward Stone",
  MINOR: "Minor Ward Stone",
  PRIME: "Prime Ward Stone",
};

function entry(id, name, className) {
  return { id, name, description: "", group: "", tier: null, className };
}

export function buildRuntimeItemDictionarySupplement(dictionaryPath) {
  const raw = readFileSync(dictionaryPath);
  const dictionary = JSON.parse(raw);
  const existing = new Set(Object.keys(dictionary.items ?? {}));
  const items = {};
  for (const [type, name] of Object.entries(RESIST_BERRIES)) {
    const id = `ER_RESIST_BERRY_${type}`;
    if (!existing.has(id) && type !== "FAIRY") {
      items[id] = entry(id, name, "PokemonHeldItemModifierType");
    }
  }
  for (const [tier, name] of Object.entries(WARD_STONES)) {
    const id = `ER_WARD_STONE_${tier}`;
    if (!existing.has(id)) {
      items[id] = entry(id, name, "PokemonHeldItemModifierType");
    }
  }
  return {
    schemaVersion: 1,
    baseDictionarySha256: createHash("sha256").update(raw).digest("hex"),
    source: "runtime-generated-item-compatibility",
    items,
    modifiers: { ...items },
  };
}

if (process.argv.length === 4) {
  const supplement = buildRuntimeItemDictionarySupplement(resolve(process.argv[2]));
  writeFileSync(resolve(process.argv[3]), `${JSON.stringify(supplement, null, 2)}\n`);
  console.log(
    JSON.stringify({
      baseDictionarySha256: supplement.baseDictionarySha256,
      items: Object.keys(supplement.items).length,
    }),
  );
} else {
  console.error("Usage: node scripts/ai/build-runtime-item-dictionary-supplement.mjs BASE_DICTIONARY OUTPUT_JSON");
  process.exitCode = 2;
}
