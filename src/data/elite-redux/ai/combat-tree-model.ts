/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { ER_COMBAT_FEATURE_NAMES, ER_COMBAT_FEATURE_SCHEMA_VERSION } from "./combat-features";

export interface ErTreeNode {
  feature: number;
  threshold: number;
  left: number;
  right: number;
  value?: number | undefined;
  defaultLeft?: boolean | undefined;
}

export interface ErTreeModelArtifact {
  schemaVersion: 1;
  featureSchemaVersion: typeof ER_COMBAT_FEATURE_SCHEMA_VERSION;
  featureCount: number;
  modelName: string;
  modelType: "sklearn_forest" | "sklearn_hist_gradient_boosting" | "lightgbm";
  aggregation: "mean" | "sum_logit" | "sum_raw";
  baseScore: number;
  trees: ErTreeNode[][];
}

export function validateErTreeModel(model: ErTreeModelArtifact): string[] {
  const errors: string[] = [];
  if (model.schemaVersion !== 1) {
    errors.push(`unsupported tree artifact schema ${model.schemaVersion}`);
  }
  if (model.featureSchemaVersion !== ER_COMBAT_FEATURE_SCHEMA_VERSION) {
    errors.push(`unsupported feature schema ${model.featureSchemaVersion}`);
  }
  if (model.featureCount !== ER_COMBAT_FEATURE_NAMES.length) {
    errors.push(`feature count ${model.featureCount} does not match runtime ${ER_COMBAT_FEATURE_NAMES.length}`);
  }
  if (!Array.isArray(model.trees) || model.trees.length === 0) {
    errors.push("tree artifact has no trees");
  }
  return errors;
}

function scoreTree(tree: readonly ErTreeNode[], features: readonly number[]): number {
  let index = 0;
  for (let depth = 0; depth <= tree.length; depth++) {
    const node = tree[index];
    if (!node) {
      throw new Error(`tree references missing node ${index}`);
    }
    if (node.value !== undefined) {
      return node.value;
    }
    const value = features[node.feature];
    const goLeft = Number.isNaN(value) ? node.defaultLeft !== false : value <= node.threshold;
    index = goLeft ? node.left : node.right;
  }
  throw new Error("tree traversal exceeded node count");
}

export function scoreErTreeModel(model: ErTreeModelArtifact, features: readonly number[]): number {
  if (features.length !== model.featureCount) {
    throw new Error(`model expected ${model.featureCount} features, received ${features.length}`);
  }
  const scores = model.trees.map(tree => scoreTree(tree, features));
  if (model.aggregation === "mean") {
    return scores.reduce((sum, value) => sum + value, 0) / scores.length;
  }
  return model.baseScore + scores.reduce((sum, value) => sum + value, 0);
}
