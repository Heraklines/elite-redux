#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const SOURCE_SCHEMA = 2;
const SOURCE_FEATURE_COUNT = 4326;
const TARGET_SCHEMA = 4;
const TARGET_FEATURE_COUNT = 4324;
const REMOVED_FEATURES = new Set([1636, 1637]);
const LAST_REMOVED_FEATURE = Math.max(...REMOVED_FEATURES);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function migrateTreeModel(source) {
  if (source.featureSchemaVersion !== SOURCE_SCHEMA || source.featureCount !== SOURCE_FEATURE_COUNT) {
    throw new Error(
      `expected feature schema ${SOURCE_SCHEMA} / ${SOURCE_FEATURE_COUNT}, got `
        + `${source.featureSchemaVersion} / ${source.featureCount}`,
    );
  }

  const migrated = structuredClone(source);
  let shiftedSplits = 0;
  let splitCount = 0;
  const visit = value => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value == null || typeof value !== "object") {
      return;
    }
    if (Number.isInteger(value.feature) && value.feature >= 0) {
      splitCount++;
      if (REMOVED_FEATURES.has(value.feature)) {
        throw new Error(`model uses removed feature ${value.feature}; lossless migration is impossible`);
      }
      if (value.feature > LAST_REMOVED_FEATURE) {
        value.feature -= REMOVED_FEATURES.size;
        shiftedSplits++;
      }
    }
    Object.values(value).forEach(visit);
  };
  visit(migrated.trees);
  visit(migrated.members);

  migrated.featureSchemaVersion = TARGET_SCHEMA;
  migrated.featureCount = TARGET_FEATURE_COUNT;
  migrated.schemaMigration = {
    fromFeatureSchemaVersion: SOURCE_SCHEMA,
    toFeatureSchemaVersion: TARGET_SCHEMA,
    removedUnusedFeatureIndexes: [...REMOVED_FEATURES],
    splitCount,
    shiftedSplits,
  };
  return migrated;
}

function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error("usage: node scripts/ai/migrate-tree-feature-schema-v2-to-v4.mjs INPUT.json OUTPUT.json");
    process.exit(2);
  }
  const sourceBytes = readFileSync(inputPath);
  const migrated = migrateTreeModel(JSON.parse(sourceBytes.toString("utf8")));
  migrated.schemaMigration.sourceSha256 = sha256(sourceBytes);
  writeFileSync(outputPath, `${JSON.stringify(migrated)}\n`);
  console.log(
    `migrated ${inputPath} -> ${outputPath}: ${migrated.schemaMigration.shiftedSplits}`
      + `/${migrated.schemaMigration.splitCount} split indexes shifted`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
