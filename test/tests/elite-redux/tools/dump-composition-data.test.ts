/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// One-off generator (NOT a real test): dumps the block data the Ability Studio composition builder reads.
// Run with:
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-composition-data.test.ts
// Output (all small, committed):
//   editor/data/vocabulary.json - the pure vocabulary (whens, conditions, effects, guards, slots) with its hash
//   editor/data/blocks.json     - one entry per class declaration (label, params, guards, package flag, ...)
//   editor/data/gates.json      - per (abilityId, attrIndex): the library form of the attr's gate, used by "Unpack"
// This only READS the declarations and bindings that humans wrote; it never invents one.
import { allAbilities } from "#data/data-lists";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { readDeclParams } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import type { DeclGateParam, DeclModule } from "#data/elite-redux/ability-studio/define-decl";
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
): unknown {
  if (typeof spec !== "object" || spec === null) {
    return spec;
  }
  const node = spec as Json;
  for (const key of ["all", "any"] as const) {
    if (Array.isArray(node[key])) {
      return { [key]: (node[key] as unknown[]).map(child => applyGateParams(child, gateParams, params)) };
    }
  }
  if ("not" in node) {
    return { not: applyGateParams(node.not, gateParams, params) };
  }
  const patched = { ...((node.params as Json | undefined) ?? {}) };
  for (const entry of gateParams) {
    const value = params[entry.param];
    if (node.block !== entry.block) {
      continue;
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
    typeof node === "object" && node !== null && Array.isArray((node as Json).all) && (node as Json).all.length === 0
  );
}

function blockEntry(module: DeclModule): Json {
  const { decl } = module;
  const defaults = Object.fromEntries(decl.params.map(param => [param.id, param.default]));
  let summary = "";
  try {
    summary = decl.summary(defaults);
  } catch {
    summary = decl.label;
  }
  return {
    id: module.className,
    label: decl.label,
    summary,
    when: decl.when,
    kind: decl.kind,
    tier: decl.tier,
    status: decl.status,
    package: decl.kind === "package",
    synonyms: decl.synonyms,
    examples: decl.examples,
    params: decl.params.map(param => ({
      id: param.id,
      label: param.label,
      control: param.control,
      editable: param.editable,
      default: param.default,
      ...(param.min === undefined ? {} : { min: param.min }),
      ...(param.max === undefined ? {} : { max: param.max }),
      ...(param.step === undefined ? {} : { step: param.step }),
      ...(param.options === undefined ? {} : { options: param.options }),
      ...(param.integer === undefined ? {} : { integer: param.integer }),
    })),
    guards: decl.guards,
    feasibility: decl.feasibility,
    ...(decl.effect === undefined ? {} : { effect: decl.effect }),
    reusableAlone: decl.reusableAlone,
    // A package must say why it cannot be split; the editor shows this in the "Works as one piece" popover.
    ...(decl.kind === "package" ? { reason: decl.notes } : {}),
  };
}

describe("tools - dump composition builder data", () => {
  it.skipIf(process.env.ER_SCENARIO !== "1")("writes editor/data/{vocabulary,blocks,gates}.json", () => {
    const vocabulary = getVocabularyJson();
    const effectsById = new Map(vocabulary.effects.map(effect => [effect.id, effect]));
    const whensById = new Map(vocabulary.whens.map(when => [when.id, when]));

    const blocks = declRegistry
      .all()
      .map(blockEntry)
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));

    const gates: Record<string, Json> = {};
    for (const site of allAttrSites()) {
      const module = declRegistry.get(site.className);
      if (module === undefined || module.decl.effect === undefined || module.decl.branches !== undefined) {
        continue;
      }
      const { decl } = module;
      const effectDef = effectsById.get(decl.effect.id);
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
        effect: decl.effect.id,
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
      for (const id of decl.effect.params) {
        if (params[id] !== undefined) {
          doParams[id] = params[id];
        }
      }
      gates[key] = {
        ...base,
        unpackable: true,
        if: ifList,
        do: [{ block: decl.effect.id, ...(Object.keys(doParams).length > 0 ? { params: doParams } : {}) }],
        guards: decl.guards,
        params,
        paramPaths: Object.fromEntries(decl.params.filter(p => p.path !== undefined).map(p => [p.id, p.path])),
      };
    }

    writeFileSync("editor/data/vocabulary.json", `${JSON.stringify(vocabulary, null, 1)}\n`);
    writeFileSync(
      "editor/data/blocks.json",
      `${JSON.stringify({ schemaVersion: 1, vocabularyHash: vocabulary.hash, blocks }, null, 1)}\n`,
    );
    writeFileSync(
      "editor/data/gates.json",
      `${JSON.stringify({ schemaVersion: 1, vocabularyHash: vocabulary.hash, gates }, null, 1)}\n`,
    );
    expect(blocks.length).toBeGreaterThan(0);
  });
});
