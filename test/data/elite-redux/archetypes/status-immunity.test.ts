/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1c: tests for the `status-immunity` archetype.
//
// Covers the three sibling subclasses:
//   - StatusEffectImmunityAbAttrEr (PreSetStatus surface)
//   - BattlerTagImmunityAbAttrEr (PreApplyBattlerTag surface)
//   - IntimidateImmunityAbAttrEr (CancelInteraction surface)
//
// Tests focus on construction validation, configured-options accessors, and
// the inherited canApply / apply behavior at the unit level. Full integration
// against the battle dispatcher (which depends on globalScene) is deferred to
// later C tasks.
// =============================================================================

import {
  BattlerTagImmunityAbAttrEr,
  IntimidateImmunityAbAttrEr,
  StatusEffectImmunityAbAttrEr,
} from "#data/elite-redux/archetypes/status-immunity";
import { BattlerTagType } from "#enums/battler-tag-type";
import { StatusEffect } from "#enums/status-effect";
import { describe, expect, it } from "vitest";

describe("StatusEffectImmunityAbAttrEr", () => {
  it("constructs with a single blocked status", () => {
    const attr = new StatusEffectImmunityAbAttrEr({ statuses: [StatusEffect.PARALYSIS] });
    expect(attr.getStatuses()).toEqual([StatusEffect.PARALYSIS]);
  });

  it("constructs with multiple blocked statuses (Limber + Insomnia composite)", () => {
    const attr = new StatusEffectImmunityAbAttrEr({
      statuses: [StatusEffect.PARALYSIS, StatusEffect.SLEEP, StatusEffect.POISON],
    });
    expect(attr.getStatuses()).toHaveLength(3);
    expect(attr.getStatuses()).toContain(StatusEffect.PARALYSIS);
    expect(attr.getStatuses()).toContain(StatusEffect.SLEEP);
    expect(attr.getStatuses()).toContain(StatusEffect.POISON);
  });

  it("constructs with empty list (block-all-non-FAINT convention)", () => {
    const attr = new StatusEffectImmunityAbAttrEr({ statuses: [] });
    expect(attr.getStatuses()).toEqual([]);
  });

  it("rejects StatusEffect.FAINT", () => {
    // Note: unplugin-inline-enum replaces `StatusEffect.FAINT` inside string
    // literals with its numeric value (7), so the error message at runtime
    // reads "[...] 7 cannot be blocked" rather than the source's
    // "[...] StatusEffect.FAINT cannot be blocked".
    expect(() => new StatusEffectImmunityAbAttrEr({ statuses: [StatusEffect.FAINT] })).toThrow(/cannot be blocked/);
  });

  it("rejects StatusEffect.NONE", () => {
    expect(() => new StatusEffectImmunityAbAttrEr({ statuses: [StatusEffect.NONE] })).toThrow(/is not a valid/);
  });

  it("rejects FAINT even when mixed with valid statuses", () => {
    expect(() => new StatusEffectImmunityAbAttrEr({ statuses: [StatusEffect.PARALYSIS, StatusEffect.FAINT] })).toThrow(
      /cannot be blocked/,
    );
  });
});

describe("BattlerTagImmunityAbAttrEr", () => {
  it("constructs with a single blocked tag (Own Tempo style)", () => {
    const attr = new BattlerTagImmunityAbAttrEr({ tags: [BattlerTagType.CONFUSED] });
    expect(attr.getTags()).toEqual([BattlerTagType.CONFUSED]);
  });

  it("constructs with multiple blocked tags (Oblivious-ER style)", () => {
    const attr = new BattlerTagImmunityAbAttrEr({
      tags: [BattlerTagType.INFATUATED, BattlerTagType.TAUNT],
    });
    expect(attr.getTags()).toHaveLength(2);
    expect(attr.getTags()).toContain(BattlerTagType.INFATUATED);
    expect(attr.getTags()).toContain(BattlerTagType.TAUNT);
  });

  it("rejects empty tag list", () => {
    expect(() => new BattlerTagImmunityAbAttrEr({ tags: [] })).toThrow(/at least one BattlerTagType/);
  });
});

describe("IntimidateImmunityAbAttrEr", () => {
  it("constructs without options (parameterless)", () => {
    const attr = new IntimidateImmunityAbAttrEr();
    expect(attr).toBeInstanceOf(IntimidateImmunityAbAttrEr);
  });

  it("multiple instances are independent objects", () => {
    const a = new IntimidateImmunityAbAttrEr();
    const b = new IntimidateImmunityAbAttrEr();
    expect(a).not.toBe(b);
  });
});
