/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Game-side builders of blocks.json and instances.json (spec section 5, catalog generator). They only
// SERIALISE what the hand-written declarations and bindings already say; nothing is derived or guessed
// here. The pure shapes live in vocabulary/blocks.ts so the editor, worker and AI server can read them.

import type { AbAttr } from "#abilities/ab-attrs";
import { getBinding } from "./bindings";
import { readDeclParams } from "./build-attr";
import type { DeclRegistry } from "./decl-registry";
import { type DeclModule, isAbsentOptional } from "./define-decl";
import {
  type BlockJson,
  type BlockParamJson,
  type BlocksJson,
  blockCategoryFor,
  blockIdForClass,
  CATALOG_SCHEMA_VERSION,
  getVocabularyJson,
  hashText,
  type InstanceJson,
  type InstancesJson,
  type ParamValue,
  type ParamValues,
  stableStringify,
  type VocabularyJson,
} from "./vocabulary/index";

export interface CatalogSite {
  readonly abilityId: number;
  readonly attrIndex: number;
  readonly className: string;
  readonly attr: AbAttr;
}

function withDefaults(module: DeclModule, values: ParamValues): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const param of module.decl.params) {
    out[param.id] = values[param.id] ?? param.default;
  }
  return out;
}

function paramJson(param: DeclModule["decl"]["params"][number]): BlockParamJson {
  return {
    id: param.id,
    label: param.label,
    control: param.control,
    default: param.default,
    editable: param.editable,
    ...(param.min === undefined ? {} : { min: param.min }),
    ...(param.max === undefined ? {} : { max: param.max }),
    ...(param.step === undefined ? {} : { step: param.step }),
    ...(param.options === undefined ? {} : { options: param.options }),
    ...(param.integer === undefined ? {} : { integer: param.integer }),
    ...(param.gateIndependent === undefined ? {} : { gateIndependent: param.gateIndependent }),
  };
}

export function blockFor(module: DeclModule, uses: number, vocabulary: VocabularyJson): BlockJson {
  const { decl, className } = module;
  const when = vocabulary.whens.find(entry => entry.id === decl.when);
  if (when === undefined) {
    throw new Error(`${className} hangs on the unknown trigger "${decl.when}"`);
  }
  const defaults = withDefaults(module, {});
  const describesPackage = decl.kind === "package" || decl.status === "exempt";
  return {
    id: blockIdForClass(className),
    className,
    label: decl.label,
    summary: decl.summary(defaults),
    tier: decl.tier,
    kind: decl.kind,
    status: decl.status,
    category: blockCategoryFor(className) ?? "Other",
    when: decl.when,
    whenLabel: when.label,
    synonyms: decl.synonyms,
    examples: decl.examples,
    params: decl.params.map(paramJson),
    conditions: decl.conditions.map(condition => ({
      slot: condition.slot,
      ...(condition.lib === undefined ? {} : { lib: condition.lib }),
      removable: condition.removable,
      editable: condition.editable,
      optional: condition.optional === true,
    })),
    guards: decl.guards,
    feasibility: decl.feasibility,
    ...(decl.gateParams === undefined
      ? {}
      : {
          gateParams: decl.gateParams.map(entry => ({
            param: entry.param,
            block: entry.block,
            field: entry.field,
            ...(entry.scale === undefined ? {} : { scale: entry.scale }),
            ...(entry.occurrence === undefined ? {} : { occurrence: entry.occurrence }),
            ...(entry.unusedValue === undefined ? {} : { unusedValue: entry.unusedValue }),
          })),
        }),
    ...(decl.effect === undefined ? {} : { effect: { id: decl.effect.id, params: decl.effect.params } }),
    ...(decl.branches === undefined
      ? {}
      : {
          branches: decl.branches.map(branch => ({
            label: branch.label,
            conditions: branch.conditions,
            effect: { id: branch.effect.id, params: branch.effect.params },
          })),
        }),
    reusableAlone: decl.reusableAlone,
    ...(decl.provides === undefined ? {} : { provides: decl.provides }),
    ...(decl.requires === undefined ? {} : { requires: decl.requires }),
    ...(describesPackage ? { packageReason: decl.notes } : {}),
    uses,
  };
}

/** One entry per class declaration, sorted by id. Two classes may not share a block id. */
export function buildBlocksJson(
  registry: DeclRegistry,
  usesByClassName: ReadonlyMap<string, number>,
  vocabulary: VocabularyJson = getVocabularyJson(),
): BlocksJson {
  const blocks = registry
    .all()
    .map(module => blockFor(module, usesByClassName.get(module.className) ?? 0, vocabulary))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let index = 1; index < blocks.length; index++) {
    if (blocks[index].id === blocks[index - 1].id) {
      throw new Error(
        `${blocks[index].className} and ${blocks[index - 1].className} share the block id ${blocks[index].id}`,
      );
    }
  }
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    vocabularyHash: vocabulary.hash,
    hash: hashText(stableStringify(blocks)),
    blocks,
  };
}

export function instanceFor(module: DeclModule, site: CatalogSite, bucket: string): InstanceJson {
  const params = withDefaults(module, readDeclParams(module, site.attr));
  const conditions: Record<string, unknown> = {};
  const legacyClosures: Record<string, string> = {};
  for (const slot of module.decl.conditions) {
    if (isAbsentOptional(site.attr, slot)) {
      continue;
    }
    const binding = getBinding(site.abilityId, site.attrIndex, slot.slot);
    if (binding?.spec !== undefined) {
      conditions[slot.slot] = binding.spec;
    } else if (binding?.legacyClosure !== undefined) {
      legacyClosures[slot.slot] = binding.legacyClosure.reason;
    }
  }
  return {
    abilityId: site.abilityId,
    attrIndex: site.attrIndex,
    block: blockIdForClass(module.className),
    params,
    conditions,
    legacyClosures,
    summary: module.decl.summary(params),
    bucket,
  };
}

/**
 * `(abilityId, attrIndex, blockId, paramValues)` for every attr whose class is declared, plus a report of the
 * classes that are not (yet). `classify` is the coverage gate's bucket function (test harness).
 */
export function buildInstancesJson(
  sites: readonly CatalogSite[],
  registry: DeclRegistry,
  blocks: BlocksJson,
  classify: (site: CatalogSite, module: DeclModule | undefined) => string,
  vocabulary: VocabularyJson = getVocabularyJson(),
): InstancesJson {
  const instances: InstanceJson[] = [];
  const undeclared = new Map<string, number>();
  const coverage: Record<string, number> = {};
  for (const site of sites) {
    const module = registry.get(site.className);
    const bucket = classify(site, module);
    coverage[bucket] = (coverage[bucket] ?? 0) + 1;
    if (module === undefined) {
      undeclared.set(site.className, (undeclared.get(site.className) ?? 0) + 1);
      continue;
    }
    instances.push(instanceFor(module, site, bucket));
  }
  instances.sort((a, b) => a.abilityId - b.abilityId || a.attrIndex - b.attrIndex);
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    vocabularyHash: vocabulary.hash,
    blocksHash: blocks.hash,
    coverage,
    undeclared: {
      classCount: undeclared.size,
      attrCount: [...undeclared.values()].reduce((total, count) => total + count, 0),
      classes: [...undeclared.entries()]
        .map(([className, uses]) => ({ className, uses }))
        .sort((a, b) => b.uses - a.uses || (a.className < b.className ? -1 : 1)),
    },
    instances,
  };
}

/** Class name -> number of attr sites using it. */
export function usesByClass(sites: readonly CatalogSite[]): Map<string, number> {
  const uses = new Map<string, number>();
  for (const site of sites) {
    uses.set(site.className, (uses.get(site.className) ?? 0) + 1);
  }
  return uses;
}
