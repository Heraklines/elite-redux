/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Frozen references for the ability decomposition work (spec section 5).
//
//  1. golden-attr-order.json lists `ability.attrs[i].constructor.name` for every registered
//     ability after the full init chain. Reordering, splitting, adding, removing or renaming an
//     attr fails this test. A rename needs an alias table, never a silent golden rewrite.
//  2. golden-saved-fingerprints.json holds the L1 fingerprint of each of the 24 saved
//     editor-authored abilities (src/data/elite-redux/er-custom-abilities.json), compiled fresh.
//
// Regenerate (only with a reviewed reason) with:
//   ER_WRITE_GOLDEN=1 npx vitest run test/tests/elite-redux/decomp/golden-order.test.ts
import type { Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import {
  type AbilityStudioBlueprintV1,
  validateAbilityStudioBlueprints,
} from "#data/elite-redux/ability-studio/ability-blueprint";
import { compileAbilityStudioBlueprint } from "#data/elite-redux/ability-studio/compile-ability-blueprint";
import { abilityFingerprint } from "#test/tests/elite-redux/decomp/fingerprint";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const FIXTURE_DIR = resolve(process.cwd(), "test/fixtures/elite-redux/ability-studio");
const ORDER_FILE = resolve(FIXTURE_DIR, "golden-attr-order.json");
const FINGERPRINT_FILE = resolve(FIXTURE_DIR, "golden-saved-fingerprints.json");
const SAVED_FILE = resolve(process.cwd(), "src/data/elite-redux/er-custom-abilities.json");
const WRITE = process.env.ER_WRITE_GOLDEN === "1";

function currentAttrOrder(): Record<string, string[]> {
  const order: Record<string, string[]> = {};
  for (const ability of allAbilities) {
    if (ability === undefined) {
      continue;
    }
    order[String(ability.id)] = ability.attrs.map(attr => attr.constructor.name);
  }
  return order;
}

function serializeOrder(order: Record<string, string[]>): string {
  // One ability per line keeps diffs reviewable.
  const keys = Object.keys(order).sort((a, b) => Number(a) - Number(b));
  return `{\n${keys.map(key => `  "${key}": ${JSON.stringify(order[key])}`).join(",\n")}\n}\n`;
}

function savedFingerprints(): Record<string, unknown> {
  const validated = validateAbilityStudioBlueprints(JSON.parse(readFileSync(SAVED_FILE, "utf8")));
  expect(validated.errors).toEqual([]);
  const blueprints = Object.entries(validated.blueprints) as [string, AbilityStudioBlueprintV1][];
  const byId = new Map(blueprints.map(([, blueprint]) => [blueprint.id, blueprint]));
  const compiled = new Map<number, Ability>();
  const compile = (id: number): Ability | undefined => {
    const ready = compiled.get(id);
    if (ready !== undefined) {
      return ready;
    }
    const blueprint = byId.get(id);
    if (blueprint === undefined) {
      return allAbilities[id];
    }
    const ability = compileAbilityStudioBlueprint(blueprint, compile);
    compiled.set(id, ability);
    return ability;
  };
  const result: Record<string, unknown> = {};
  for (const [key, blueprint] of [...blueprints].sort(([a], [b]) => a.localeCompare(b))) {
    const ability = compile(blueprint.id);
    if (ability === undefined) {
      throw new Error(`saved ability ${key} did not compile`);
    }
    result[key] = abilityFingerprint(ability);
  }
  return result;
}

describe("ability decomposition frozen references", () => {
  it("keeps (abilityId, attrIndex, attr.constructor.name) identical for every registered ability", () => {
    const current = currentAttrOrder();
    if (WRITE) {
      writeFileSync(ORDER_FILE, serializeOrder(current), "utf8");
    }
    const golden = JSON.parse(readFileSync(ORDER_FILE, "utf8")) as Record<string, string[]>;
    const diffs: string[] = [];
    for (const id of new Set([...Object.keys(golden), ...Object.keys(current)])) {
      if (JSON.stringify(golden[id]) !== JSON.stringify(current[id])) {
        diffs.push(`${id}: golden=${JSON.stringify(golden[id])} current=${JSON.stringify(current[id])}`);
      }
    }
    expect(diffs.slice(0, 20)).toEqual([]);
    expect(Object.keys(golden).length).toBeGreaterThan(1200);
  });

  it("keeps the L1 fingerprints of the 24 saved abilities identical", () => {
    const current = savedFingerprints();
    expect(Object.keys(current)).toHaveLength(24);
    if (WRITE) {
      writeFileSync(FINGERPRINT_FILE, `${JSON.stringify(current, null, 2)}\n`, "utf8");
    }
    const golden = JSON.parse(readFileSync(FINGERPRINT_FILE, "utf8")) as Record<string, unknown>;
    expect(current).toEqual(golden);
  });
});
