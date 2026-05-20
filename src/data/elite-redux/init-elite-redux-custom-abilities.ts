// =============================================================================
// Elite Redux — Phase B Task B2: register ER-custom abilities in `allAbilities`.
//
// Reads `er-abilities.ts` and, for every entry whose pokerogue id resolves to
// ≥ VANILLA_ID_CUTOFF (the ER-custom range — see `er-id-map.ts`), constructs
// a fresh `Ability` instance via `AbBuilder.build()` and pushes it onto
// `allAbilities`.
//
// Vanilla abilities (id < VANILLA_ID_CUTOFF) are NOT touched here — that's
// B3's vanilla-rebalance task. ER abilities whose name happens to match a
// vanilla AbilityId (e.g. "Stench") simply get the vanilla id and skip.
//
// Behavior note: Phase B registers placeholder abilities only — they own
// `id`, `name`, `description`, and the framework hooks expected by callers,
// but they ship with NO `AbAttr`s attached. Phase C will wire actual
// per-ability behavior (the `attr(...)` calls in `init-abilities.ts`'s
// style). For now, customs behave as no-op abilities at battle time.
//
// i18n note: pokerogue's `Ability` constructor derives an `i18nKey` from
// `AbilityId[this.id]`. For custom ids (≥ 5000) that reverse-lookup returns
// `undefined`, which would throw inside `toCamelCase`. We work around this
// by installing the enum-key string onto `AbilityId` at runtime before the
// builder runs (the enum is a real JS object), then override the `name` and
// `description` getters on each instance to return the draft text verbatim
// (i18next would otherwise return the missing-key placeholder).
// =============================================================================

import { AbBuilder, type Ability } from "#abilities/ability";
import { allAbilities } from "#data/data-lists";
import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";

/**
 * Numeric cutoff for "vanilla pokerogue" ability ids. ER-custom abilities are
 * assigned fresh ids ≥ 5000 by the id-map builder (see `er-id-map.ts`).
 * Mirrors the value in `scripts/elite-redux/builders/id-map.mjs` and
 * `er-ability-id-enum.mjs`.
 */
const VANILLA_ID_CUTOFF = 5000;

/** Aggregated result of a single `initEliteReduxCustomAbilities()` run. */
export interface InitEliteReduxCustomAbilitiesResult {
  /** Number of ER-custom abilities newly constructed and pushed onto allAbilities. */
  customsAdded: number;
  /** Number of ER-custom abilities skipped because an entry already existed (idempotent re-run). */
  customsAlreadyPresent: number;
  /** Non-fatal issues — e.g. constructor failures with a usable error message. */
  errors: string[];
}

/**
 * Convert an ER ability display name (e.g. `Scrapyard`, `Cold Hearted`) into
 * the runtime enum-key form (e.g. `SCRAPYARD`, `COLD_HEARTED`). Mirrors
 * `abilityNameToEnumKey` in `scripts/elite-redux/builders/er-ability-id-enum.mjs`.
 *
 * @param abilityName - Display name from the ER draft
 * @returns Uppercase enum-key form, with non-alphanumerics collapsed to `_`
 */
function abilityNameToEnumKey(abilityName: string): string {
  return abilityName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Construct `Ability` instances for the ER-custom abilities and push them
 * onto `allAbilities`. Idempotent: a re-run skips abilities that are already
 * present (by id match).
 *
 * Order constraint: must run AFTER `initAbilities()` (so the vanilla
 * baseline is in place) and AFTER `initMoves()` (some `AbAttr` flag checks
 * read move state, though customs currently ship no attrs). Typically called
 * from `init/init.ts:initializeGame()` right after `initEliteReduxCustomSpecies()`.
 */
export function initEliteReduxCustomAbilities(): InitEliteReduxCustomAbilitiesResult {
  const result: InitEliteReduxCustomAbilitiesResult = {
    customsAdded: 0,
    customsAlreadyPresent: 0,
    errors: [],
  };

  // Build a O(1) id → bool lookup for idempotency.
  const existingIds = new Set<number>();
  for (const ability of allAbilities) {
    existingIds.add(ability.id);
  }

  for (const draft of ER_ABILITIES) {
    const pokerogueId = ER_ID_MAP.abilities[draft.id];
    if (pokerogueId === undefined) {
      continue;
    }
    if (pokerogueId < VANILLA_ID_CUTOFF) {
      // Vanilla — already in allAbilities from initAbilities().
      continue;
    }
    if (existingIds.has(pokerogueId)) {
      result.customsAlreadyPresent++;
      continue;
    }

    try {
      const ability = buildCustomAbility(draft, pokerogueId);
      (allAbilities as Ability[]).push(ability);
      existingIds.add(pokerogueId);
      result.customsAdded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to construct ability "${draft.name}" (er id ${draft.id} → ${pokerogueId}): ${msg}`);
    }
  }

  return result;
}

/**
 * Construct a single ER-custom `Ability` from its draft. Generation is fixed
 * at 9 for now — TODO(Phase C): derive from ER archetype taxonomy. No
 * `AbAttr`s are attached at this stage (placeholder ability — Phase C wires
 * behavior).
 *
 * Two side-effects on construction:
 *  1. Installs `AbilityId[pokerogueId] = enumKey` at runtime so the
 *     `Ability` constructor's `toCamelCase(AbilityId[id])` lookup doesn't
 *     throw on ids outside the enum's declared range.
 *  2. Overrides `name`/`description` getters per-instance via
 *     `Object.defineProperty` to return the draft text verbatim — i18next
 *     would otherwise return the missing-key placeholder string.
 *
 * @param draft - ER ability draft from `er-abilities.ts`
 * @param pokerogueId - pokerogue ability id (≥ VANILLA_ID_CUTOFF) from `ER_ID_MAP.abilities`
 */
function buildCustomAbility(draft: { name: string; description: string }, pokerogueId: number): Ability {
  const enumKey = abilityNameToEnumKey(draft.name);
  // Runtime reverse-mapping injection. TypeScript enums compile to JS objects
  // — mutation is supported. Idempotent: setting the same key twice is a no-op.
  // The forward mapping (`AbilityId.SCRAPYARD = 5000`) is NOT installed — code
  // that wants compile-time access uses `ErAbilityId.SCRAPYARD` instead.
  (AbilityId as unknown as Record<number, string>)[pokerogueId] = enumKey;

  // Construct via the canonical AbBuilder path. `id` is typed `AbilityId` —
  // values ≥ 5000 are outside the declared enum range but acceptable at
  // runtime; the cast satisfies the type system without changing behavior.
  const ability = new AbBuilder(pokerogueId as AbilityId, 9).build();

  // Override the prototype-level `name`/`description` getters with verbatim
  // draft text. `configurable: true` lets a later run (e.g. test re-init)
  // overwrite without throwing.
  Object.defineProperty(ability, "name", {
    value: draft.name,
    configurable: true,
    enumerable: true,
    writable: false,
  });
  Object.defineProperty(ability, "description", {
    value: draft.description,
    configurable: true,
    enumerable: true,
    writable: false,
  });

  return ability;
}
