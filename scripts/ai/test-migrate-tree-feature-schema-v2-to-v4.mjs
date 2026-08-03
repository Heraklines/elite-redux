#!/usr/bin/env node
import assert from "node:assert/strict";
import test from "node:test";
import { migrateTreeModel } from "./migrate-tree-feature-schema-v2-to-v4.mjs";

function modelWithFeatures(...features) {
  return {
    featureSchemaVersion: 2,
    featureCount: 4326,
    trees: [
      features.map(feature => ({
        feature,
        threshold: 0,
        left: -1,
        right: -1,
      })),
    ],
  };
}

test("migrates split indexes after the two removed unused features", () => {
  const source = modelWithFeatures(1635, 1638, 4325);
  const migrated = migrateTreeModel(source);

  assert.deepEqual(
    migrated.trees[0].map(node => node.feature),
    [1635, 1636, 4323],
  );
  assert.equal(migrated.featureSchemaVersion, 4);
  assert.equal(migrated.featureCount, 4324);
  assert.equal(migrated.schemaMigration.splitCount, 3);
  assert.equal(migrated.schemaMigration.shiftedSplits, 2);
  assert.deepEqual(
    source.trees[0].map(node => node.feature),
    [1635, 1638, 4325],
  );
});

test("refuses a model that split on either removed feature", () => {
  assert.throws(() => migrateTreeModel(modelWithFeatures(1636)), /lossless migration is impossible/);
  assert.throws(() => migrateTreeModel(modelWithFeatures(1637)), /lossless migration is impossible/);
});

test("refuses an unexpected source schema", () => {
  assert.throws(
    () => migrateTreeModel({ ...modelWithFeatures(1), featureSchemaVersion: 3 }),
    /expected feature schema 2/,
  );
});
