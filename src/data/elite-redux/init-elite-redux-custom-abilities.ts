// =============================================================================
// Elite Redux — Phase B Task B2 / Phase D Task D3:
//   - B2: register ER-custom abilities in `allAbilities`.
//   - D3: wire archetype-classified abilities' AbAttrs onto each registered
//     ability via the archetype dispatcher.
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
// Behavior note (Phase D3): archetype-classified abilities get their
// archetype-primitive AbAttrs attached via the dispatcher (see
// `archetype-dispatcher.ts`). `bespoke`, `composite-vanilla-mashup`, and
// classifier rows whose params shape doesn't yet have a wired archetype
// primitive remain as placeholder no-op abilities — they're tracked in the
// init result's `dispatchSkipsByArchetype` map for diagnostics.
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
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { ER_ABILITIES, type ErAbilityDraft } from "#data/elite-redux/er-abilities";
import { ER_ABILITY_ARCHETYPES, type ErArchetypeKind } from "#data/elite-redux/er-ability-archetypes";
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
  /**
   * Per-archetype count of how many abilities got at least one AbAttr wired
   * via the dispatcher this run. Only counts NEW additions (idempotent
   * re-run sees zero). Bespoke/composite/missing-shape rows don't appear in
   * this map.
   */
  attrsWiredByArchetype: Record<string, number>;
  /**
   * Per-archetype count of how many rows the dispatcher skipped this run
   * (because the params shape didn't have a wired translation). Surfaces
   * coverage gaps without failing the build.
   */
  dispatchSkipsByArchetype: Record<string, number>;
  /**
   * Total number of archetype-primitive AbAttr instances attached this run
   * across every ability. A single ability with N parts contributes N.
   */
  totalAttrsAttached: number;
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
    attrsWiredByArchetype: {},
    dispatchSkipsByArchetype: {},
    totalAttrsAttached: 0,
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
      const ability = buildCustomAbility(draft, pokerogueId, result);
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
 * at 9 for now — TODO(Phase D): derive from ER archetype taxonomy.
 *
 * Phase D3 behavior: when the ER ability's archetype row in
 * `ER_ABILITY_ARCHETYPES` is non-bespoke and the dispatcher produces one or
 * more `AbAttr` instances, those are pushed onto the builder's attrs list
 * before `.build()`. `bespoke`, `composite-vanilla-mashup`, and shapes the
 * dispatcher can't yet translate produce no attrs (placeholder behavior
 * unchanged from B2).
 *
 * Two side-effects on construction:
 *  1. Installs `AbilityId[pokerogueId] = enumKey` at runtime so the
 *     `Ability` constructor's `toCamelCase(AbilityId[id])` lookup doesn't
 *     throw on ids outside the enum's declared range.
 *  2. Overrides `name`/`description` getters per-instance via
 *     `Object.defineProperty` to return the draft text verbatim — i18next
 *     would otherwise return the missing-key placeholder string.
 *
 * @param draft        - ER ability draft from `er-abilities.ts`
 * @param pokerogueId  - pokerogue ability id (≥ VANILLA_ID_CUTOFF) from `ER_ID_MAP.abilities`
 * @param result       - aggregate result object — mutated to record per-archetype attr counts
 */
function buildCustomAbility(
  draft: ErAbilityDraft,
  pokerogueId: number,
  result: InitEliteReduxCustomAbilitiesResult,
): Ability {
  const enumKey = abilityNameToEnumKey(draft.name);
  // Runtime reverse-mapping injection. TypeScript enums compile to JS objects
  // — mutation is supported. Idempotent: setting the same key twice is a no-op.
  // The forward mapping (`AbilityId.SCRAPYARD = 5000`) is NOT installed — code
  // that wants compile-time access uses `ErAbilityId.SCRAPYARD` instead.
  (AbilityId as unknown as Record<number, string>)[pokerogueId] = enumKey;

  // Construct via the canonical AbBuilder path. `id` is typed `AbilityId` —
  // values ≥ 5000 are outside the declared enum range but acceptable at
  // runtime; the cast satisfies the type system without changing behavior.
  const builder = new AbBuilder(pokerogueId as AbilityId, 9);

  // Phase D3: wire archetype-classified attrs via the dispatcher. We look up
  // the archetype row by the ER-side id (not the pokerogue id) since the
  // classifier keys on ER's source numbering.
  const archetypeRow = ER_ABILITY_ARCHETYPES[draft.id];
  if (archetypeRow !== undefined) {
    wireArchetypeAttrs(builder, archetypeRow.archetype, archetypeRow.params, result);
  }

  const ability = builder.build();

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

/**
 * Dispatch the archetype row through the dispatcher and push the produced
 * AbAttrs onto the builder. Records per-archetype wired/skip counts in
 * `result` for diagnostics.
 *
 * `builder.attrs` is `public readonly` at the TS level — meaning the *binding*
 * is readonly, but the array itself is mutable. We push pre-built attr
 * instances directly because the canonical `builder.attr(Cls, ...args)` API
 * takes a constructor + ctor-args; here we have already-constructed instances
 * (the dispatcher builds them so it can structure-translate classifier params
 * into the archetype's typed options shape).
 *
 * Any throw from the dispatcher (e.g. an archetype primitive's invariant
 * check) is caught here and recorded in `result.errors`, then the ability
 * proceeds without those attrs — better to register the ability as a
 * placeholder than to fail the whole init pass.
 */
function wireArchetypeAttrs(
  builder: AbBuilder,
  archetype: ErArchetypeKind,
  params: Record<string, unknown> | null,
  result: InitEliteReduxCustomAbilitiesResult,
): void {
  let dispatched: ReturnType<typeof dispatchArchetype>;
  try {
    dispatched = dispatchArchetype(archetype, params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Archetype ${archetype} dispatch threw for ability id ${builder.id}: ${msg}`);
    return;
  }
  if (dispatched.attrs.length === 0) {
    // Skipped — either composite/bespoke (expected) or shape-mismatch (logged).
    if (dispatched.skipReason !== null) {
      result.dispatchSkipsByArchetype[archetype] = (result.dispatchSkipsByArchetype[archetype] ?? 0) + 1;
    }
    return;
  }
  // Push every produced attr onto the builder. The builder's `attrs` array is
  // mutable; `Ability` snapshots it at construction time.
  for (const attr of dispatched.attrs) {
    builder.attrs.push(attr);
  }
  result.attrsWiredByArchetype[archetype] = (result.attrsWiredByArchetype[archetype] ?? 0) + 1;
  result.totalAttrsAttached += dispatched.attrs.length;
}
