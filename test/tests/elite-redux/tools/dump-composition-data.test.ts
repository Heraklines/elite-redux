/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// One-off generator (NOT a real test): dumps the block data the Ability Studio composition builder reads.
// Run with:
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-composition-data.test.ts
// Output (all small, committed):
// (vocabulary.json and blocks.json come from dump-catalog.test.ts; this writes only the Unpack table)
//   editor/data/gates.json      - per (abilityId, attrIndex): the library form of the attr's gate, used by "Unpack"
// This only READS the declarations and bindings that humans wrote; it never invents one.
import { allAbilities } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { readDeclParams } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclGateParam } from "#data/elite-redux/ability-studio/define-decl";
import { getVocabularyJson } from "#data/elite-redux/ability-studio/vocabulary/vocabulary-json";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Json = Record<string, unknown>;

/** The same patching recomposeAttr does, so the unpacked gate equals the compiled one. */
function applyGateParams(
  spec: unknown,
  gateParams: readonly DeclGateParam[],
  params: Record<string, unknown>,
  seen: Map<string, number> = new Map(),
): unknown {
  if (typeof spec !== "object" || spec === null) {
    return spec;
  }
  const node = spec as Json;
  for (const key of ["all", "any"] as const) {
    if (Array.isArray(node[key])) {
      return { [key]: (node[key] as unknown[]).map(child => applyGateParams(child, gateParams, params, seen)) };
    }
  }
  if ("not" in node) {
    return { not: applyGateParams(node.not, gateParams, params, seen) };
  }
  const patched = { ...((node.params as Json | undefined) ?? {}) };
  const nth = seen.get(String(node.block)) ?? 0;
  seen.set(String(node.block), nth + 1);
  for (const entry of gateParams) {
    const value = params[entry.param];
    if (node.block !== entry.block || (entry.occurrence !== undefined && entry.occurrence !== nth)) {
      continue;
    }
    if (entry.unusedValue !== undefined && value === entry.unusedValue) {
      return { any: [] };
    }
    if (typeof value === "number") {
      patched[entry.field] = Number((value * (entry.scale ?? 1)).toPrecision(12));
    } else if (typeof value === "string") {
      patched[entry.field] = value;
    }
  }
  return { ...node, params: patched };
}

function isEmptyAll(node: unknown): boolean {
  return (
    typeof node === "object"
    && node !== null
    && Array.isArray((node as Json).all)
    && ((node as Json).all as unknown[]).length === 0
  );
}

describe("tools - dump composition builder data", () => {
  it.skipIf(process.env.ER_SCENARIO !== "1")("writes editor/data/gates.json", () => {
    const vocabulary = getVocabularyJson();
    const effectsById = new Map(vocabulary.effects.map(effect => [effect.id, effect]));
    const whensById = new Map(vocabulary.whens.map(when => [when.id, when]));

    const gates: Record<string, Json> = {};
    for (const site of allAttrSites()) {
      const module = declRegistry.get(site.className);
      if (module === undefined || module.decl.effect === undefined || module.decl.branches !== undefined) {
        continue;
      }
      const { decl } = module;
      const declEffect = decl.effect;
      if (declEffect === undefined) {
        continue;
      }
      const effectDef = effectsById.get(declEffect.id);
      const whenDef = whensById.get(decl.when);
      if (effectDef === undefined || whenDef === undefined) {
        continue;
      }
      const key = `${site.abilityId}:${site.attrIndex}`;
      const base: Json = {
        abilityId: site.abilityId,
        attrIndex: site.attrIndex,
        className: site.className,
        when: decl.when,
        effect: declEffect.id,
      };
      if (whenDef.composable !== true || effectDef.implemented !== true) {
        gates[key] = {
          ...base,
          unpackable: false,
          reason: "its trigger or its effect is not wired into the block builder yet",
        };
        continue;
      }
      const attrLevel = (site.attr as unknown as { extraCondition?: unknown }).extraCondition !== undefined;
      const abilityLevel = allAbilities[site.abilityId]?.conditions.length ?? 0;
      if (attrLevel || abilityLevel > 0) {
        gates[key] = {
          ...base,
          unpackable: false,
          reason: "the ability also has a condition of its own that blocks cannot express yet",
        };
        continue;
      }
      const params = readDeclParams(module, site.attr) as Record<string, unknown>;
      const ifList: unknown[] = [];
      let legacy: string | undefined;
      for (const slot of decl.conditions) {
        const binding = getBinding(site.abilityId, site.attrIndex, slot.slot);
        if (binding === undefined) {
          continue; // an absent optional closure
        }
        if (binding.spec === undefined) {
          legacy = binding.legacyClosure?.reason ?? "an unmapped condition";
          break;
        }
        const spec =
          slot.slot === "gate" && decl.gateParams !== undefined
            ? applyGateParams(binding.spec, decl.gateParams, params)
            : binding.spec;
        if (!isEmptyAll(spec)) {
          ifList.push(spec);
        }
      }
      if (legacy !== undefined) {
        gates[key] = { ...base, unpackable: false, reason: `a condition has no block yet: ${legacy}` };
        continue;
      }
      const doParams: Json = {};
      for (const id of declEffect.params) {
        if (params[id] !== undefined) {
          doParams[id] = params[id];
        }
      }
      // A declaration that hands the block class settings it does not have (e.g. `message`, `berryOnly`) would be refused
      // by the editor's validator anyway; say why here instead of offering an Unpack that cannot work.
      const blockSettings = new Set(effectDef.params.map(param => param.id));
      const unknown = Object.keys(doParams).filter(id => !blockSettings.has(id));
      if (unknown.length > 0) {
        gates[key] = {
          ...base,
          unpackable: false,
          reason: `the block has no setting for ${unknown.join(", ")} yet`,
        };
        continue;
      }
      gates[key] = {
        ...base,
        unpackable: true,
        if: ifList,
        do: [{ block: declEffect.id, ...(Object.keys(doParams).length > 0 ? { params: doParams } : {}) }],
        guards: decl.guards,
        params,
        paramPaths: Object.fromEntries(decl.params.filter(p => p.path !== undefined).map(p => [p.id, p.path])),
      };
    }

    writeFileSync(
      "editor/data/gates.json",
      `${JSON.stringify({ schemaVersion: 1, vocabularyHash: vocabulary.hash, gates }, null, 1)}\n`,
    );
    expect(Object.keys(gates).length).toBeGreaterThan(0);
  });
});
