/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Writes the ability-vocabulary catalog (spec section 5, catalog generator). Shared by
//   - dump-editor-data.test.ts  (the CI editor refresh; writes it together with the rest of editor/data), and
//   - dump-catalog.test.ts      (batch agents and the merge captain: only the catalog, nothing else in editor/data).
//
// It only SERIALISES the hand-written declarations and bindings. Classes without a declaration are REPORTED, never an
// error: the 18 batches are still declaring them (the ratchet lives in L0).

import { allAbilities } from "#data/data-lists";
import {
  buildBlocksJson,
  buildInstancesJson,
  type CatalogSite,
  usesByClass,
} from "#data/elite-redux/ability-studio/catalog";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import {
  type BlocksJson,
  getVocabularyJson,
  type InstancesJson,
  type VocabularyJson,
} from "#data/elite-redux/ability-studio/vocabulary/index";
import { classifyAttr } from "#test/tests/elite-redux/decomp/harness/coverage";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { writeFileSync } from "node:fs";
import { AI_CONTAINER_FILES, bundleValidator, EDITOR_FILES } from "./validator-bundle";

export interface CatalogWritten {
  readonly vocabulary: VocabularyJson;
  readonly blocks: BlocksJson;
  readonly instances: InstancesJson;
}

export function writeCatalog(): CatalogWritten {
  const vocabulary = getVocabularyJson();
  const sites: CatalogSite[] = allAttrSites().map(site => ({
    abilityId: site.abilityId,
    attrIndex: site.attrIndex,
    className: site.className,
    attr: site.attr,
  }));
  const blocks = buildBlocksJson(declRegistry, usesByClass(sites), vocabulary);
  const instances = buildInstancesJson(
    sites,
    declRegistry,
    blocks,
    (site, module) => classifyAttr({ ...site, abilityName: allAbilities[site.abilityId]?.name ?? "" }, module).bucket,
    vocabulary,
  );
  const vocabularyText = `${JSON.stringify(vocabulary, null, 2)}\n`;
  const blocksText = `${JSON.stringify(blocks, null, 2)}\n`;
  writeFileSync(EDITOR_FILES.vocabulary, vocabularyText, "utf8");
  writeFileSync(EDITOR_FILES.blocks, blocksText, "utf8");
  writeFileSync(EDITOR_FILES.instances, `${JSON.stringify(instances)}\n`, "utf8");
  // The AI container's Docker context is workers/er-ability-ai, so it gets its own copies.
  writeFileSync(AI_CONTAINER_FILES.vocabulary, vocabularyText, "utf8");
  writeFileSync(AI_CONTAINER_FILES.blocks, blocksText, "utf8");
  writeFileSync(AI_CONTAINER_FILES.validator, bundleValidator(), "utf8");
  return { vocabulary, blocks, instances };
}

export function describeCatalog(written: CatalogWritten): string {
  const { vocabulary, blocks, instances } = written;
  const top = instances.undeclared.classes
    .slice(0, 8)
    .map(entry => `${entry.className} x${entry.uses}`)
    .join(", ");
  return (
    `WROTE catalog: vocabulary ${vocabulary.hash} (${vocabulary.whens.length} whens, ${vocabulary.conditions.length} conditions, `
    + `${vocabulary.effects.length} effects, ${vocabulary.guards.length} guards); ${blocks.blocks.length} blocks; `
    + `${instances.instances.length} instances; coverage ${JSON.stringify(instances.coverage)}; `
    + `UNDECLARED ${instances.undeclared.classCount} classes covering ${instances.undeclared.attrCount} attrs (top: ${top})`
  );
}
