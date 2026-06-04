/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1f: tests for the `composite-vanilla-mashup`
// archetype helper.
//
// The helper is intentionally minimal — its job is to validate part count and
// preserve order. Tests exercise both happy paths (2 + 3 parts) and rejection
// paths (0 + 1 parts). The AbAttr instances are opaque to the helper, so we
// use stub objects rather than real AbAttr subclasses (which require base-class
// construction state).
// =============================================================================

import type { AbAttr } from "#abilities/ab-attrs";
import { composeAbAttrs } from "#data/elite-redux/archetypes/composite";
import { describe, expect, it } from "vitest";

/** Build an opaque AbAttr-shaped stub; the helper never reads its fields. */
function makeStubAttr(tag = ""): AbAttr {
  return { __stub: tag } as unknown as AbAttr;
}

describe("composeAbAttrs archetype (C1f)", () => {
  it("returns the parts list verbatim when given 2 parts", () => {
    const a = makeStubAttr("a");
    const b = makeStubAttr("b");
    const result = composeAbAttrs({ parts: [a, b] });
    expect(result.length).toBe(2);
    expect(result[0]).toBe(a);
    expect(result[1]).toBe(b);
  });

  it("supports 3-part composites (As One x 2 variants, Embody Aspect x 4 variants)", () => {
    const a = makeStubAttr("a");
    const b = makeStubAttr("b");
    const c = makeStubAttr("c");
    const result = composeAbAttrs({ parts: [a, b, c] });
    expect(result.length).toBe(3);
    expect(result[0]).toBe(a);
    expect(result[1]).toBe(b);
    expect(result[2]).toBe(c);
  });

  it("supports >= 4 parts (rare ER edge cases)", () => {
    const parts = [makeStubAttr("a"), makeStubAttr("b"), makeStubAttr("c"), makeStubAttr("d")];
    const result = composeAbAttrs({ parts });
    expect(result.length).toBe(4);
    for (let i = 0; i < parts.length; i++) {
      expect(result[i]).toBe(parts[i]);
    }
  });

  it("rejects an empty parts list", () => {
    expect(() => composeAbAttrs({ parts: [] })).toThrow(/>= 2 parts/);
  });

  it("rejects a single-part composite (use the part directly instead)", () => {
    const a = makeStubAttr("a");
    expect(() => composeAbAttrs({ parts: [a] })).toThrow(/>= 2 parts/);
  });

  it("preserves order of parts (canonical dispatch order matters for some abilities)", () => {
    const first = makeStubAttr("first");
    const second = makeStubAttr("second");
    const result = composeAbAttrs({ parts: [first, second] });
    expect(result[0]).toBe(first);
    expect(result[1]).toBe(second);
  });

  it("flattens nested composites when the caller spreads inner results", () => {
    const a1 = makeStubAttr("a1");
    const a2 = makeStubAttr("a2");
    const b1 = makeStubAttr("b1");
    const b2 = makeStubAttr("b2");
    const innerA = composeAbAttrs({ parts: [a1, a2] });
    const innerB = composeAbAttrs({ parts: [b1, b2] });
    const outer = composeAbAttrs({ parts: [...innerA, ...innerB] });
    expect(outer.length).toBe(4);
    expect(outer[0]).toBe(a1);
    expect(outer[1]).toBe(a2);
    expect(outer[2]).toBe(b1);
    expect(outer[3]).toBe(b2);
  });
});
