/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// L0 (static lint) for Step 0: every dispatch key must have a hand-assigned WHEN or an explicit
// unexposed reason. The key list comes from the worklist script, which emits a WORKLIST only.
import { AbilityAttrs } from "#abilities/ab-attrs";
import {
  ABILITY_STUDIO_RUNTIME_HOOK_CONTEXTS,
  ABILITY_STUDIO_RUNTIME_HOOK_TYPES,
} from "#data/elite-redux/ability-studio/runtime-components";
import {
  DISPATCHED_THROUGH,
  LEGACY_CONTEXT_STRING_TO_SLOT,
  SLOT_IDS,
  UNEXPOSED_DISPATCH_KEYS,
  WHEN_REGISTRY,
  whenForDispatchKey,
} from "#data/elite-redux/ability-studio/vocabulary/index";
import { describe, expect, it } from "vitest";
import { scanDispatchKeys } from "../../../../scripts/decomp/dispatch-scan.mjs";

const scan = scanDispatchKeys(process.cwd());
const classChain = (key: string): string[] => {
  const chain: string[] = [];
  let ctor: unknown = (AbilityAttrs as Record<string, unknown>)[key];
  while (typeof ctor === "function" && (ctor as { name: string }).name) {
    chain.push((ctor as { name: string }).name);
    ctor = Object.getPrototypeOf(ctor);
  }
  return chain;
};

const throughOwner = new Map<string, string>();
for (const [ancestor, leaves] of Object.entries(DISPATCHED_THROUGH)) {
  for (const leaf of leaves) {
    throughOwner.set(leaf, ancestor);
  }
}

function accounted(key: string): boolean {
  return (
    whenForDispatchKey(key) !== undefined
    || key in UNEXPOSED_DISPATCH_KEYS
    || (throughOwner.has(key)
      && (whenForDispatchKey(throughOwner.get(key)!) !== undefined
        || throughOwner.get(key)! in UNEXPOSED_DISPATCH_KEYS))
  );
}

describe("L0 dispatch keys (Step 0 worklist)", () => {
  it("scans every literal applyAbAttrs / applyFilteredAbAttrs key and the whole AbilityAttrs map", () => {
    const mapKeys = Object.keys(AbilityAttrs);
    const scanned = new Set(scan.keys.map(entry => entry.key));
    for (const key of mapKeys) {
      expect(scanned.has(key), `${key} missing from the worklist`).toBe(true);
    }
    // Every literal call-site key is a real AbilityAttrs key (the types enforce it, the scan proves it).
    expect(scan.keys.filter(entry => entry.callSites.length > 0 && !entry.inAbilityAttrs)).toEqual([]);
    expect(scan.keys.filter(entry => entry.callSites.length > 0).length).toBeGreaterThanOrEqual(100);
  });

  it("the only non-literal dispatch site is the dev harness, whose triggers are AbilityAttrs keys", () => {
    expect(scan.dynamic.map(site => `${site.file}:${site.expr}`)).toEqual([
      "src/data/elite-redux/harness/battle-harness.ts:spec.trigger",
    ]);
  });

  it("every key has a WHEN, an unexposed reason, or a dispatched-through ancestor", () => {
    const missing = scan.keys.map(entry => entry.key).filter(key => !accounted(key));
    expect(missing, `keys with neither a WHEN nor an unexposed reason: ${missing.join(", ")}`).toEqual([]);
  });

  it("no key is both exposed and unexposed, and unexposed reasons are real sentences", () => {
    const scanned = new Set(scan.keys.map(entry => entry.key));
    for (const [key, reason] of Object.entries(UNEXPOSED_DISPATCH_KEYS)) {
      expect(scanned.has(key), `${key} is unexposed but not in the worklist`).toBe(true);
      expect(whenForDispatchKey(key), `${key} has both a WHEN and an unexposed reason`).toBeUndefined();
      expect(reason.length, `${key} needs a written reason`).toBeGreaterThan(40);
    }
  });

  it("dispatched-through leaves really descend from the named ancestor", () => {
    for (const [ancestor, leaves] of Object.entries(DISPATCHED_THROUGH)) {
      expect(
        whenForDispatchKey(ancestor) !== undefined || ancestor in UNEXPOSED_DISPATCH_KEYS,
        `${ancestor} must itself be accounted for`,
      ).toBe(true);
      for (const leaf of leaves) {
        expect(classChain(leaf).slice(1), `${leaf} does not descend from ${ancestor}`).toContain(ancestor);
        expect(whenForDispatchKey(leaf), `${leaf} is both dispatched-through and a WHEN key`).toBeUndefined();
        expect(leaf in UNEXPOSED_DISPATCH_KEYS, `${leaf} is both dispatched-through and unexposed`).toBe(false);
      }
    }
  });
});

/**
 * Elite Redux marker classes (they extend AbAttr directly and are not in the AbilityAttrs map). They are flag keys of
 * while.active so that L0 finds them as the WHEN's class.
 */
const ER_MARKER_FLAG_KEYS: ReadonlySet<string> = new Set([
  "AbilityStudioRuntimeCapabilityAbAttr",
  "BallRecoveryAbAttr",
  "BiomeRevealBonusAbAttr",
  "ExperienceGainMultiplierAbAttr",
  "MoneyGainMultiplierAbAttr",
  "MoveHpCostModifierAbAttr",
]);

describe("L0 WHEN registry", () => {
  it("has unique ids and no dispatch key claimed by two WHENs", () => {
    expect(new Set(WHEN_REGISTRY.map(when => when.id)).size).toBe(WHEN_REGISTRY.length);
    const seen = new Map<string, string>();
    for (const when of WHEN_REGISTRY) {
      for (const key of [when.dispatchKey, ...(when.alsoDispatchKeys ?? []), ...(when.flagKeys ?? [])]) {
        if (key === null) {
          continue;
        }
        expect(seen.get(key), `${key} claimed by ${seen.get(key)} and ${when.id}`).toBeUndefined();
        seen.set(key, when.id);
      }
    }
  });

  it("every dispatch key of a WHEN is a real class; only base-class legacy hooks may be missing from AbilityAttrs", () => {
    const mapKeys = new Set(Object.keys(AbilityAttrs));
    for (const when of WHEN_REGISTRY) {
      const keys = [when.dispatchKey, ...(when.alsoDispatchKeys ?? []), ...(when.flagKeys ?? [])].filter(
        (key): key is string => key !== null,
      );
      for (const key of keys) {
        if (when.baseClassOnly === true && key === when.dispatchKey) {
          continue;
        }
        if (when.kind === "while-active" && ER_MARKER_FLAG_KEYS.has(key)) {
          continue;
        }
        expect(mapKeys.has(key), `${when.id}: ${key} is not an AbilityAttrs key`).toBe(true);
      }
      if (when.kind === "while-active") {
        expect(when.dispatchKey, `${when.id}: flags are never dispatched`).toBeNull();
        expect(when.flagKeys?.length ?? 0).toBeGreaterThan(0);
      } else {
        expect(when.dispatchKey, `${when.id} needs a dispatch key`).not.toBeNull();
        for (const also of when.alsoDispatchKeys ?? []) {
          // `also` keys fire at the same moment: they share a dispatch family with the primary key or sit beside it.
          expect(also).not.toBe(when.dispatchKey);
        }
      }
      if (when.kind === "calc") {
        expect(when.modifies, `${when.id} is calc and needs modifies`).toBeTruthy();
      }
    }
  });

  it("provides only real slots, always includes the holder, and keeps the label free of class names", () => {
    for (const when of WHEN_REGISTRY) {
      for (const slot of when.provides) {
        expect(SLOT_IDS as readonly string[], `${when.id}: unknown slot ${slot}`).toContain(slot);
      }
      expect(when.provides).toContain("holder");
      expect(when.label).not.toMatch(/AbAttr|Attr\b/);
    }
  });

  it("seeds the 32 existing V1 hooks (plus PostDamage) one-to-one through legacyHookId", () => {
    const legacy = WHEN_REGISTRY.flatMap(when => (when.legacyHookId === undefined ? [] : [when.legacyHookId]));
    expect(new Set(legacy).size).toBe(legacy.length);
    expect([...ABILITY_STUDIO_RUNTIME_HOOK_TYPES].sort()).toEqual([...legacy].sort());
    expect(ABILITY_STUDIO_RUNTIME_HOOK_TYPES.size).toBe(33);
    for (const when of WHEN_REGISTRY) {
      if (when.legacyHookId !== undefined) {
        expect(when.legacyHookId, `${when.id}: legacy hook id is the dispatch key`).toBe(when.dispatchKey);
      }
    }
  });

  it("covers the V1 hook contexts: every V1 context string maps to a slot the WHEN provides", () => {
    // The V1 tables over-claim in a few places (they list a slot the engine call site never passes).
    // Those are listed here on purpose; every other V1 context string must be covered by the WHEN.
    const v1Overclaims: Readonly<Record<string, readonly string[]>> = {
      PostVictoryAbAttr: ["defeated Pokemon"],
    };
    for (const when of WHEN_REGISTRY) {
      if (when.legacyHookId === undefined) {
        continue;
      }
      const context = ABILITY_STUDIO_RUNTIME_HOOK_CONTEXTS[when.legacyHookId];
      expect(context, `${when.legacyHookId} has no V1 context`).toBeDefined();
      for (const entry of context) {
        expect(entry in LEGACY_CONTEXT_STRING_TO_SLOT, `unmapped V1 context string "${entry}"`).toBe(true);
        const slot = LEGACY_CONTEXT_STRING_TO_SLOT[entry];
        if (slot === null || (v1Overclaims[when.legacyHookId] ?? []).includes(entry)) {
          continue;
        }
        expect(when.provides, `${when.id} does not provide ${slot} (V1 "${entry}")`).toContain(slot);
      }
    }
  });

  it("registers PostDamageAbAttr as event.after-taking-damage with holder, other, damage, simulated", () => {
    const when = whenForDispatchKey("PostDamageAbAttr");
    expect(when?.id).toBe("event.after-taking-damage");
    expect(when?.kind).toBe("event");
    expect([...(when?.provides ?? [])].sort()).toEqual(["damage", "holder", "other", "simulated"]);
    expect(ABILITY_STUDIO_RUNTIME_HOOK_TYPES.has("PostDamageAbAttr")).toBe(true);
    expect(ABILITY_STUDIO_RUNTIME_HOOK_CONTEXTS.PostDamageAbAttr).toContain("damage dealt");
  });
});
