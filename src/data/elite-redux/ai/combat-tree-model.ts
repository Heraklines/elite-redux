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

export interface ErSingleTreeModelArtifact {
  schemaVersion: 1;
  featureSchemaVersion: typeof ER_COMBAT_FEATURE_SCHEMA_VERSION;
  featureCount: number;
  modelName: string;
  modelType: "sklearn_forest" | "sklearn_hist_gradient_boosting" | "lightgbm";
  aggregation: "mean" | "sum_logit" | "sum_raw";
  baseScore: number;
  trees: ErTreeNode[][];
  /** Legacy-v1 human telemetry cannot supervise switches because it did not capture the bench. */
  candidateScope?: "combat-command" | "move-only" | undefined;
}

export interface ErStackedTreeModelArtifact {
  schemaVersion: 2;
  featureSchemaVersion: typeof ER_COMBAT_FEATURE_SCHEMA_VERSION;
  featureCount: number;
  modelName: string;
  modelType: "stacked_tree_ensemble";
  members: ErSingleTreeModelArtifact[];
  memberMeans: number[];
  memberScales: number[];
  weights: number[];
  intercept: number;
  candidateScope?: "combat-command" | "move-only" | undefined;
}

export type ErTreeModelArtifact = ErSingleTreeModelArtifact | ErStackedTreeModelArtifact;

function validateCommonModelShape(model: ErTreeModelArtifact): string[] {
  const errors: string[] = [];
  if (model.featureSchemaVersion !== ER_COMBAT_FEATURE_SCHEMA_VERSION) {
    errors.push(`unsupported feature schema ${model.featureSchemaVersion}`);
  }
  if (model.featureCount !== ER_COMBAT_FEATURE_NAMES.length) {
    errors.push(`feature count ${model.featureCount} does not match runtime ${ER_COMBAT_FEATURE_NAMES.length}`);
  }
  if (
    model.candidateScope !== undefined
    && model.candidateScope !== "combat-command"
    && model.candidateScope !== "move-only"
  ) {
    errors.push(`unsupported candidate scope ${String(model.candidateScope)}`);
  }
  return errors;
}

function validateStackedModel(model: ErStackedTreeModelArtifact): string[] {
  const errors: string[] = [];
  const members = Array.isArray(model.members) ? model.members : [];
  const memberMeans = Array.isArray(model.memberMeans) ? model.memberMeans : [];
  const memberScales = Array.isArray(model.memberScales) ? model.memberScales : [];
  const weights = Array.isArray(model.weights) ? model.weights : [];
  if (!Array.isArray(model.members)) {
    errors.push("stacked tree artifact members must be an array");
  } else if (members.length < 2) {
    errors.push("stacked tree artifact needs at least two members");
  }
  if (!Array.isArray(model.memberMeans)) {
    errors.push("stacked tree artifact member means must be an array");
  }
  if (!Array.isArray(model.memberScales)) {
    errors.push("stacked tree artifact member scales must be an array");
  }
  if (!Array.isArray(model.weights)) {
    errors.push("stacked tree artifact weights must be an array");
  }
  const alignedLengths = [members.length, memberMeans.length, memberScales.length, weights.length];
  if (new Set(alignedLengths).size !== 1) {
    errors.push(`stacked tree artifact arrays are not aligned: ${alignedLengths.join(",")}`);
  }
  if (
    !Number.isFinite(model.intercept)
    || [...memberMeans, ...memberScales, ...weights].some(value => !Number.isFinite(value))
  ) {
    errors.push("stacked tree artifact has non-finite meta-model values");
  }
  if (memberScales.some(value => value <= 0)) {
    errors.push("stacked tree artifact member scales must be positive");
  }
  for (const [index, member] of members.entries()) {
    if (!member || typeof member !== "object") {
      errors.push(`member ${index}: tree artifact must be an object`);
      continue;
    }
    for (const error of validateErTreeModel(member)) {
      errors.push(`member ${index}: ${error}`);
    }
    if (member.featureCount !== model.featureCount) {
      errors.push(
        `member ${index}: feature count ${member.featureCount} does not match ensemble ${model.featureCount}`,
      );
    }
  }
  return errors;
}

export function validateErTreeModel(model: ErTreeModelArtifact): string[] {
  if (!model || typeof model !== "object") {
    return ["tree artifact must be an object"];
  }
  const schemaVersion = Number((model as { schemaVersion?: unknown }).schemaVersion);
  if (schemaVersion !== 1 && schemaVersion !== 2) {
    return [`unsupported tree artifact schema ${String(schemaVersion)}`];
  }
  const errors = validateCommonModelShape(model);
  if (model.schemaVersion === 1) {
    if (!Array.isArray(model.trees) || model.trees.length === 0) {
      errors.push("tree artifact has no trees");
    }
    return errors;
  }
  return errors.concat(validateStackedModel(model));
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
  if (model.schemaVersion === 2) {
    return model.members.reduce(
      (score, member, index) =>
        score
        + model.weights[index]
          * ((scoreErTreeModel(member, features) - model.memberMeans[index]) / model.memberScales[index]),
      model.intercept,
    );
  }
  const scores = model.trees.map(tree => scoreTree(tree, features));
  if (model.aggregation === "mean") {
    return scores.reduce((sum, value) => sum + value, 0) / scores.length;
  }
  return model.baseScore + scores.reduce((sum, value) => sum + value, 0);
}
