/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1c: `status-immunity` archetype primitive.
//
// Implements taxonomy entry #24 (~20 abilities counting vanilla + ER customs).
// Parameterized AbAttr family providing immunity to:
//   - Status effects (paralysis, sleep, poison, burn, freeze, frostbite, …)
//   - Battler tags (confused, infatuated, taunt, cursed, …)
//   - Intimidate-style stat-drop interactions
//
// Because pokerogue's existing immunity classes are split across three trigger
// surfaces, we follow the same split with three sibling subclasses:
//
//   - `StatusEffectImmunityAbAttrEr`   extends `StatusEffectImmunityAbAttr`
//     (PreSetStatus surface). Parameterized list of `StatusEffect` to block.
//     An empty list means "block all non-FAINT statuses" (matches pokerogue's
//     existing convention — used by e.g. Comatose).
//
//   - `BattlerTagImmunityAbAttrEr`     extends `BattlerTagImmunityAbAttr`
//     (PreApplyBattlerTag surface). Parameterized list of `BattlerTagType`
//     to block. Covers Oblivious-style "can't be infatuated", Inner Focus-
//     style "can't flinch", Own Tempo-style "can't be confused".
//
//   - `IntimidateImmunityAbAttrEr`     extends `IntimidateImmunityAbAttr`
//     (CancelInteraction surface). No payload — flat immunity to Intimidate
//     and ER's Scare. Wraps pokerogue's existing class for symmetry with the
//     archetype layer's typed-options pattern.
//
// Why three classes? The dispatcher routes via different keys
// (`PreSetStatusEffectImmunityAbAttr`, `PreApplyBattlerTagImmunityAbAttr`,
// `IntimidateImmunityAbAttr`). A single mega-class would have to live in all
// three subclass hierarchies at once, which TypeScript doesn't allow. Splitting
// matches what pokerogue does upstream and lets composite abilities (e.g.
// `Discipline`'s "no confuse + no intimidate") wire two instances naturally.
//
// Sub-shapes intentionally NOT covered (deferred to follow-up tasks):
//   - **Conditional / field-side immunity** (e.g. weather-gated `Desert Cloak`):
//     overlaps with `weather-or-terrain-interaction` (archetype #23) — a
//     `StatusEffectImmunityAbAttrEr` instance gated on weather active. Will
//     compose via `CompositeAbAttr` once both archetypes exist.
//   - **Self-stat-drop immunity** (e.g. `Limber`'s "immune to self stat
//     drops" piece): pokerogue has `ProtectStatAbAttr` (PreStatStageChange
//     surface). Belongs in a separate archetype once we need it; the
//     `Limber`-style composite splits into Para immunity here + stat-drop
//     protection in that archetype.
//
// Examples (per taxonomy entry #24):
//   - `Limber`-paralysis-piece — `new StatusEffectImmunityAbAttrEr({
//       statuses: [StatusEffect.PARALYSIS] })`
//   - `Insomnia` — `new StatusEffectImmunityAbAttrEr({
//       statuses: [StatusEffect.SLEEP] })`
//   - `Own Tempo` — `new BattlerTagImmunityAbAttrEr({
//       tags: [BattlerTagType.CONFUSED] })`
//   - `Oblivious`-ER — `new BattlerTagImmunityAbAttrEr({
//       tags: [BattlerTagType.INFATUATED, BattlerTagType.TAUNT] }) +
//       new IntimidateImmunityAbAttrEr()`
// =============================================================================

import { BattlerTagImmunityAbAttr, IntimidateImmunityAbAttr, StatusEffectImmunityAbAttr } from "#abilities/ab-attrs";
import type { BattlerTagType } from "#enums/battler-tag-type";
import { StatusEffect } from "#enums/status-effect";

/** Construction options for {@linkcode StatusEffectImmunityAbAttrEr}. */
export interface StatusEffectImmunityOptions {
  /**
   * Which status effects this ability blocks. Passing an empty array (the
   * pokerogue convention) blocks **every** non-FAINT status, matching abilities
   * like Comatose. Specific status filtering is the common case.
   */
  readonly statuses: readonly StatusEffect[];
}

/**
 * Parameterized `AbAttr` implementing the status-effect immunity sub-shape of
 * the `status-immunity` archetype.
 *
 * Used (or will be used) by vanilla `Limber` (paralysis), `Insomnia` (sleep),
 * `Immunity` (poison), `Water Veil` (burn), `Magma Armor` (freeze), and ER
 * customs that block specific status effects.
 *
 * @remarks
 * Extends pokerogue's {@linkcode StatusEffectImmunityAbAttr}, which already
 * handles the canApply (status in blocked list) + apply (cancel the
 * application) logic. We add a typed-options constructor for parity with the
 * rest of the archetype layer and add input validation: passing
 * {@linkcode StatusEffect.FAINT} explicitly is rejected (it's meaningless to
 * block since FAINT is special-cased everywhere).
 */
export class StatusEffectImmunityAbAttrEr extends StatusEffectImmunityAbAttr {
  private readonly configuredStatuses: readonly StatusEffect[];

  constructor(opts: StatusEffectImmunityOptions) {
    if (opts.statuses.includes(StatusEffect.FAINT)) {
      throw new Error("[StatusEffectImmunityAbAttrEr] StatusEffect.FAINT cannot be blocked");
    }
    if (opts.statuses.includes(StatusEffect.NONE)) {
      throw new Error("[StatusEffectImmunityAbAttrEr] StatusEffect.NONE is not a valid block target");
    }
    // Pokerogue's parent takes statuses as variadic args; we spread our list.
    super(...opts.statuses);
    this.configuredStatuses = opts.statuses;
  }

  /** Read-only accessor for the configured blocked-statuses list. */
  public getStatuses(): readonly StatusEffect[] {
    return this.configuredStatuses;
  }
}

/** Construction options for {@linkcode BattlerTagImmunityAbAttrEr}. */
export interface BattlerTagImmunityOptions {
  /**
   * Which battler tags this ability blocks. Common values:
   * {@linkcode BattlerTagType.CONFUSED}, {@linkcode BattlerTagType.INFATUATED},
   * {@linkcode BattlerTagType.FLINCHED}, {@linkcode BattlerTagType.TAUNT}.
   * Must include at least one tag — empty config is meaningless.
   */
  readonly tags: readonly BattlerTagType[];
}

/**
 * Parameterized `AbAttr` implementing the battler-tag immunity sub-shape of
 * the `status-immunity` archetype.
 *
 * Used (or will be used) by vanilla `Own Tempo` (confusion immunity), `Inner
 * Focus` (flinch immunity), `Oblivious` (infatuation immunity), and ER customs
 * like `Discipline` (confusion + intimidation composite) or `Oblivious`-ER's
 * extended tag set.
 *
 * @remarks
 * Extends pokerogue's {@linkcode BattlerTagImmunityAbAttr}. The parent's
 * constructor takes a single tag OR an array; we always pass our configured
 * array. canApply/apply are inherited intact — they check whether the
 * incoming tag is in {@linkcode immuneTagTypes} and cancel the application.
 */
export class BattlerTagImmunityAbAttrEr extends BattlerTagImmunityAbAttr {
  private readonly configuredTags: readonly BattlerTagType[];

  constructor(opts: BattlerTagImmunityOptions) {
    if (opts.tags.length === 0) {
      throw new Error("[BattlerTagImmunityAbAttrEr] tags must include at least one BattlerTagType");
    }
    super([...opts.tags]);
    this.configuredTags = opts.tags;
  }

  /** Read-only accessor for the configured blocked-tags list. */
  public getTags(): readonly BattlerTagType[] {
    return this.configuredTags;
  }
}

/**
 * Parameterized `AbAttr` implementing the Intimidate immunity sub-shape of the
 * `status-immunity` archetype.
 *
 * Used by vanilla `Inner Focus` (composite — also blocks flinch via the
 * battler-tag flavor), `Oblivious`-ER, `Discipline`, and any ER custom that
 * blocks Intimidate-style attack-dropping interactions.
 *
 * @remarks
 * Thin parameterless wrapper around pokerogue's
 * {@linkcode IntimidateImmunityAbAttr}. We export it from the archetype layer
 * so the wire-up can construct it via the same `new ArchetypeAbAttr(opts)`
 * pattern as every other primitive — even though there are no options here,
 * the construction style is intentionally symmetric.
 */
export class IntimidateImmunityAbAttrEr extends IntimidateImmunityAbAttr {}

/**
 * Marker type — useful for the wire-up layer to refer to any subclass of this
 * archetype generically. Mirrors the pattern in `weather-terrain-interaction`.
 */
export type StatusImmunity = StatusEffectImmunityAbAttrEr | BattlerTagImmunityAbAttrEr | IntimidateImmunityAbAttrEr;
