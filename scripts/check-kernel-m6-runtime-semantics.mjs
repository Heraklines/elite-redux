#!/usr/bin/env node

import { readFileSync } from "node:fs";

function fail(message) {
  throw new Error(`M6 runtime semantic check: ${message}`);
}

const [runtimePath, semanticPath, rawPath] = process.argv.slice(2);
if (!runtimePath || !semanticPath || !rawPath) fail("usage: <runtime-json> <semantic-json> <raw-json>");
const runtime = JSON.parse(readFileSync(runtimePath, "utf8"));
const semantic = JSON.parse(readFileSync(semanticPath, "utf8"));
const raw = JSON.parse(readFileSync(rawPath, "utf8"));
if (runtime.oracle_sha !== semantic.oracle_sha || runtime.oracle_sha !== raw.oracle_sha) fail("oracle SHA mismatch");

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactValues(label, actual, expected) {
  const left = [...new Set(actual.map(String))].sort(compareText);
  const right = [...new Set(expected.map(String))].sort(compareText);
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    const leftSet = new Set(left);
    const rightSet = new Set(right);
    const missing = right.filter(value => !leftSet.has(value));
    const extra = left.filter(value => !rightSet.has(value));
    fail(`${label} differs: missing=${JSON.stringify(missing.slice(0, 20))} extra=${JSON.stringify(extra.slice(0, 20))}`);
  }
}

function requireSubset(label, actual, expectedSuperset) {
  const expected = new Set(expectedSuperset.map(String));
  const missing = [...new Set(actual.map(String))].filter(value => !expected.has(value)).sort(compareText);
  if (missing.length > 0) fail(`${label} is absent from static catalog: ${JSON.stringify(missing.slice(0, 20))}`);
}

const runtimeSpeciesIds = runtime.species.map(entry => entry.id);
const staticSpeciesIds = raw.species.map(entry => entry.id);
exactValues(
  "vanilla species identities",
  runtimeSpeciesIds.filter(id => id < 10_000),
  staticSpeciesIds.filter(id => id < 10_000),
);
requireSubset("runtime custom species identities", runtimeSpeciesIds.filter(id => id >= 10_000), staticSpeciesIds);
const runtimeMoveIds = runtime.moves.map(entry => entry.id);
const staticMoveIds = raw.moves.map(entry => entry.numeric_id);
exactValues("vanilla move identities", runtimeMoveIds.filter(id => id < 5_000), staticMoveIds.filter(id => id < 5_000));
requireSubset("runtime custom move identities", runtimeMoveIds.filter(id => id >= 5_000), staticMoveIds);
const runtimeAbilityIds = runtime.abilities.map(entry => entry.id);
const staticAbilityIds = raw.abilities.map(entry => entry.numeric_id);
exactValues("vanilla ability identities", runtimeAbilityIds.filter(id => id < 5_000), staticAbilityIds.filter(id => id < 5_000));
requireSubset("runtime custom ability identities", runtimeAbilityIds.filter(id => id >= 5_000), staticAbilityIds);
exactValues("modifier identities", runtime.modifiers.map(entry => entry.key), raw.modifier_types.map(entry => entry.key));
for (const [runtimeKey, rawKey] of [
  ["statuses", "statuses"],
  ["weather", "weather"],
  ["terrain", "terrain"],
  ["battler_tags", "battler_tags"],
  ["arena_tags", "arena_tags"],
  ["positional_tags", "positional_tags"],
]) {
  // Tag enums are string-valued in the oracle; compare canonical member keys.
  exactValues(
    `${runtimeKey} identities`,
    runtime[runtimeKey].map(entry => entry.key),
    raw[rawKey].map(entry => entry.member),
  );
}

function staticUnits(kind, id) {
  return semantic.behavior_units.filter(unit => unit.id.source.kind === kind && unit.id.source.numeric_id === id);
  if (!Array.isArray(definition?.attrs)) return [];
  return definition.attrs
    .map(attribute => attribute?.class)
    .filter(value => typeof value === "string" && value.length > 0);
}

function verifyAttributePresence(label, runtimeEntries, sourceKind, intrinsicKind) {
  for (const entry of runtimeEntries) {
    const units = staticUnits(sourceKind, entry.id).filter(unit => unit.id.unit_kind !== intrinsicKind || unit.id.ordinal !== 0);
    const staticAttributes = new Set(units.map(unit => unit.semantic.effect?.attribute).filter(value => typeof value === "string"));
    for (const attribute of runtimeAttributeClasses(entry.definition)) {
      if (!staticAttributes.has(attribute)) fail(`${label} ${entry.id} runtime attribute ${attribute} is absent from static behavior units`);
    }
  }
}

verifyAttributePresence("move", runtime.moves, "MOVE", "INTRINSIC_MOVE_RULE");
verifyAttributePresence("ability", runtime.abilities, "ACTIVE_ABILITY", "ABILITY_ATTRIBUTE");

for (const entry of runtime.abilities) {
  const conditions = entry.definition?.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) continue;
  const attributes = runtimeAttributeClasses(entry.definition);
  if (attributes.length === 0) continue;
  const units = staticUnits("ACTIVE_ABILITY", entry.id).filter(unit => unit.id.ordinal !== 0);
  if (!units.some(unit => unit.semantic.condition?.kind !== "ALWAYS")) {
    fail(`ability ${entry.id} has runtime builder conditions but only unconditional static behavior units`);
  }
}

console.log(`M6 runtime semantic check: ${runtime.moves.length} moves, ${runtime.abilities.length} abilities, ${runtime.species.length} species, ${runtime.modifiers.length} modifiers`);
