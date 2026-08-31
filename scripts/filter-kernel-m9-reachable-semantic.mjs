#!/usr/bin/env node

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  args.set(process.argv[index], process.argv[index + 1]);
}
const starterPath = args.get("--starter-oracle");
const semanticRoot = args.get("--semantic-root");
const outputRoot = args.get("--output-root");
if (starterPath == null || semanticRoot == null || outputRoot == null) {
  throw new Error(
    "usage: filter-kernel-m9-reachable-semantic --starter-oracle <path> --semantic-root <path> --output-root <path>",
  );
}
const readJson = path => JSON.parse(readFileSync(resolve(path), "utf8"));
const starter = readJson(starterPath);
const semantic = readJson(resolve(semanticRoot, "semantic-catalog-v1.json"));
const bespoke = readJson(resolve(semanticRoot, "bespoke-clusters-v1.json"));
if (starter.oracle_sha !== semantic.oracle_sha || starter.oracle_sha !== bespoke.oracle_sha) {
  throw new Error("starter and semantic oracle identities differ");
}
const moveIds = new Set(starter.reachable_moves.map(move => move.id));
const activeAbilityIds = new Set(starter.reachable_species.map(species => species.selected_active_ability_id));
const passiveAbilityIds = new Set(
  starter.reachable_species.flatMap(species => (species.passive_enabled ? species.passive_ability_ids : [])),
);
const speciesIds = new Set(starter.reachable_species.map(species => species.species_id));
const sourceWanted = source => {
  switch (source.kind) {
    case "MOVE":
      return moveIds.has(source.numeric_id);
    case "ACTIVE_ABILITY":
      return activeAbilityIds.has(source.numeric_id);
    case "PASSIVE_ABILITY":
      return passiveAbilityIds.has(source.numeric_id);
    case "SPECIES":
      return speciesIds.has(source.numeric_id);
    default:
      return false;
  }
};
const sources = semantic.sources.filter(entry => sourceWanted(entry.source));
const behaviorUnits = semantic.behavior_units.filter(unit => sourceWanted(unit.id.source));
const unitIds = new Set(behaviorUnits.map(unit => JSON.stringify(unit.id)));
const rngSites = semantic.rng_sites.filter(site => unitIds.has(JSON.stringify(site.owner)));
const clusters = bespoke.clusters
  .map(cluster => ({
    ...cluster,
    behavior_units: cluster.behavior_units.filter(unit => unitIds.has(JSON.stringify(unit))),
  }))
  .filter(cluster => cluster.behavior_units.length > 0);
const output = {
  ...semantic,
  sources,
  behavior_units: behaviorUnits,
  rng_sites: rngSites,
};
const resolutions = Object.fromEntries(
  [...new Set(behaviorUnits.map(unit => unit.semantic.resolution))]
    .sort()
    .map(resolution => [resolution, behaviorUnits.filter(unit => unit.semantic.resolution === resolution).length]),
);
const manifest = {
  schema_version: 1,
  oracle_sha: starter.oracle_sha,
  source_count: sources.length,
  behavior_unit_count: behaviorUnits.length,
  rng_site_count: rngSites.length,
  bespoke_cluster_count: clusters.length,
  resolutions,
  reachable_species: [...speciesIds].sort((left, right) => left - right),
  reachable_moves: [...moveIds].sort((left, right) => left - right),
  reachable_active_abilities: [...activeAbilityIds].sort((left, right) => left - right),
  reachable_passive_abilities: [...passiveAbilityIds].sort((left, right) => left - right),
};
const root = resolve(outputRoot);
mkdirSync(root, { recursive: true });
writeFileSync(resolve(root, "semantic-catalog-v1.json"), `${JSON.stringify(output)}\n`);
writeFileSync(
  resolve(root, "bespoke-clusters-v1.json"),
  `${JSON.stringify({ schema_version: 1, oracle_sha: starter.oracle_sha, clusters })}\n`,
);
writeFileSync(resolve(root, "reachable-semantic-manifest-v1.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `M9 reachable semantic closure: ${sources.length} sources, ${behaviorUnits.length} units, ${rngSites.length} RNG sites`,
);
