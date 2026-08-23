import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dataDir = resolve(process.argv[2] ?? "editor/data");
const failures = [];

function readJson(name) {
  try {
    return JSON.parse(readFileSync(join(dataDir, name), "utf8"));
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    return;
  }
}

function requireArray(name, minimum) {
  const value = readJson(name);
  if (!Array.isArray(value)) {
    failures.push(`${name}: expected an array`);
    return [];
  }
  if (value.length < minimum) {
    failures.push(`${name}: expected at least ${minimum} rows, found ${value.length}`);
  }
  return value;
}

function requireObject(name, minimum) {
  const value = readJson(name);
  if (!value || Array.isArray(value) || typeof value !== "object") {
    failures.push(`${name}: expected an object`);
    return {};
  }
  const count = Object.keys(value).length;
  if (count < minimum) {
    failures.push(`${name}: expected at least ${minimum} keys, found ${count}`);
  }
  return value;
}

function uniqueIndex(rows, field, name) {
  const index = new Map();
  for (const row of rows) {
    const value = row?.[field];
    if (value === undefined || value === null || value === "") {
      failures.push(`${name}: row is missing ${field}`);
      continue;
    }
    if (index.has(value)) {
      failures.push(`${name}: duplicate ${field} ${JSON.stringify(value)}`);
      continue;
    }
    index.set(value, row);
  }
  return index;
}

function assertKnownIds(ids, known, context, allowZero = false) {
  for (const rawId of ids) {
    const id = Number(rawId);
    if (allowZero && id === 0) {
      continue;
    }
    if (!Number.isInteger(id) || !known.has(id)) {
      failures.push(`${context}: unknown id ${JSON.stringify(rawId)}`);
    }
  }
}

const starters = requireArray("species.json", 600);
const allSpecies = requireArray("all-species.json", 1_500);
const forms = requireArray("species-forms.json", 1);
const moves = requireArray("moves-rich.json", 1_000);
const abilities = requireArray("abilities-rich.json", 1_000);
const learnsets = requireObject("learnsets.json", 1_500);
const tmLearnsets = requireObject("tm-learnsets.json", 1_500);
const speciesAbilities = requireObject("species-abilities.json", 1_500);
const evolutions = requireObject("evolutions.json", 500);

const speciesById = uniqueIndex(allSpecies, "id", "all-species.json");
const speciesByConst = uniqueIndex(allSpecies, "const", "all-species.json");
const moveById = uniqueIndex(moves, "id", "moves-rich.json");
const abilityById = uniqueIndex(abilities, "id", "abilities-rich.json");
uniqueIndex(starters, "id", "species.json");
uniqueIndex(forms, "const", "species-forms.json");

for (const starter of starters) {
  if (!speciesById.has(starter.id)) {
    failures.push(`species.json: starter ${starter.name} (${starter.id}) is absent from all-species.json`);
  }
}

for (const form of forms) {
  if (!speciesByConst.has(form.baseConst)) {
    failures.push(`species-forms.json: ${form.name} has unknown baseConst ${form.baseConst}`);
  }
  const slots = form.abilities
    ? [form.abilities.ability1, form.abilities.ability2, form.abilities.hidden, ...(form.abilities.innates ?? [])]
    : [];
  assertKnownIds(slots, abilityById, `species-forms.json: ${form.name}`, true);
}

for (const species of allSpecies) {
  const id = String(species.id);
  if (Array.isArray(learnsets[id])) {
    assertKnownIds(
      learnsets[id].map(entry => entry?.[1]),
      moveById,
      `learnsets.json: ${species.name}`,
    );
  } else {
    failures.push(`learnsets.json: missing species ${species.name} (${id})`);
  }
  if (Array.isArray(tmLearnsets[id])) {
    assertKnownIds(tmLearnsets[id], moveById, `tm-learnsets.json: ${species.name}`);
  } else {
    failures.push(`tm-learnsets.json: missing species ${species.name} (${id})`);
  }
  const slots = speciesAbilities[id];
  if (!slots || typeof slots !== "object") {
    failures.push(`species-abilities.json: missing species ${species.name} (${id})`);
  } else {
    assertKnownIds(
      [slots.ability1, slots.ability2, slots.hidden, ...(slots.innates ?? [])],
      abilityById,
      `species-abilities.json: ${species.name}`,
      true,
    );
  }
}

for (const [speciesId, links] of Object.entries(evolutions)) {
  assertKnownIds(
    [speciesId, ...(links?.to ?? []), ...(links?.from ?? [])],
    speciesById,
    `evolutions.json: ${speciesId}`,
  );
}

for (const ability of abilities) {
  if (!ability.name || /(?:^|\.)name$/i.test(ability.name) || /^[a-z_]+\.[a-z_]+$/i.test(ability.name)) {
    failures.push(
      `abilities-rich.json: unresolved display name for ability ${ability.id}: ${JSON.stringify(ability.name)}`,
    );
  }
  if (typeof ability.description !== "string") {
    failures.push(`abilities-rich.json: ability ${ability.id} has no description string`);
  }
}

if (failures.length > 0) {
  console.error(`Editor catalog validation failed with ${failures.length} issue(s):`);
  for (const failure of failures.slice(0, 200)) {
    console.error(`- ${failure}`);
  }
  if (failures.length > 200) {
    console.error(`- ...and ${failures.length - 200} more`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `Editor catalogs valid: ${starters.length} starters, ${allSpecies.length} species, ${forms.length} forms, ${moves.length} moves, ${abilities.length} abilities.`,
  );
}
