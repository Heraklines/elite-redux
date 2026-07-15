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

import { type AbAttr, ConditionalCritAbAttr, PostFaintAbAttr } from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import { allAbilities, allMoves } from "#data/data-lists";
import { CleansingLightAbAttr, ER_CLEANSING_LIGHT_ABILITY_ID } from "#data/elite-redux/abilities/cleansing-light";
import { CommonRootAbAttr, ER_COMMON_ROOT_ABILITY_ID } from "#data/elite-redux/abilities/common-root";
import { DandelionBurstAbAttr, ER_DANDELION_BURST_ABILITY_ID } from "#data/elite-redux/abilities/dandelion-burst";
import { ER_LAST_HOST_ABILITY_ID, LastHostAbAttr } from "#data/elite-redux/abilities/last-host";
import { ER_MYCELIAL_NETWORK_ABILITY_ID, MycelialNetworkAbAttr } from "#data/elite-redux/abilities/mycelial-network";
import { ER_PRESSURE_VESSEL_ABILITY_ID, PressureVesselAbAttr } from "#data/elite-redux/abilities/pressure-vessel";
import { ER_PUPPET_STRINGS_ABILITY_ID, PuppetStringsAbAttr } from "#data/elite-redux/abilities/puppet-strings";
import { ER_QUICKENING_GRACE_ABILITY_ID, QuickeningGraceAbAttr } from "#data/elite-redux/abilities/quickening-grace";
import { ER_RAIN_PUMP_ABILITY_ID, RainPumpAbAttr } from "#data/elite-redux/abilities/rain-pump";
import { ER_SILKEN_DECREE_ABILITY_ID, SilkenDecreeAbAttr } from "#data/elite-redux/abilities/silken-decree";
import { ER_SPORE_BED_ABILITY_ID } from "#data/elite-redux/abilities/spore-bed";
import { ER_TANGLED_SEED_ABILITY_ID, TangledSeedAbAttr } from "#data/elite-redux/abilities/tangled-seed";
import { dispatchArchetype } from "#data/elite-redux/archetype-dispatcher";
import { ConditionalAlwaysHitAbAttr } from "#data/elite-redux/archetypes/conditional-always-hit";
import { EntryTrapOnFoeSideAbAttr } from "#data/elite-redux/archetypes/entry-trap-on-foe-side";
import { SpeedBonusToStatAbAttr } from "#data/elite-redux/archetypes/speed-bonus-to-stat";
import { ER_ABILITIES, type ErAbilityDraft } from "#data/elite-redux/er-abilities";
import { ER_ABILITY_ARCHETYPES, type ErArchetypeKind } from "#data/elite-redux/er-ability-archetypes";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { failIfRadianceOnFieldCondition } from "#moves/move-condition";

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
  // allAbilities is now sparse (id-indexed for ER customs). Skip undefined gaps.
  for (const ability of allAbilities) {
    if (!ability) {
      continue;
    }
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
      // CRITICAL: index by ID, not push. Pokerogue's PokemonSpeciesForm.getPassiveAbilities()
      // resolves slots via `allAbilities[id]` (id-indexed lookup, NOT array-position).
      // ER customs use ids ≥5000 but vanilla pokerogue only has ~311 entries —
      // a push would land them at index 311+, making `allAbilities[5082]` return
      // undefined and crash the apply-ab-attrs dispatcher in the first PostSummonPhase.
      // Sparse array assignment fills the gap (intermediate slots remain undefined,
      // which is fine because lookups go through species-defined slot ids only).
      (allAbilities as Ability[])[pokerogueId] = ability;
      existingIds.add(pokerogueId);
      result.customsAdded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to construct ability "${draft.name}" (er id ${draft.id} → ${pokerogueId}): ${msg}`);
    }
  }

  // ER id-resync drift: the four "Embody Aspect" variants collapsed to a single
  // id (795) in the auto-generated ER_ABILITIES, so only the Speed variant gets
  // a draft and is built above. The Attack/Defense/SpDef variants (er 796-798 →
  // pokerogue 5497-5499) have no draft, so we construct them here from synthetic
  // drafts — registering their AbilityId reverse-map keys (otherwise a species
  // using ability 5497 throws `enumValueToKey`) and wiring the entry-effect
  // stat boost via their ER_ABILITY_ARCHETYPES rows. Idempotent.
  const embodyDriftDrafts: { draft: ErAbilityDraft; pokerogueId: number }[] = [
    {
      draft: { id: 796, name: "Embody Aspect", description: "+1 Attack on Entry.", archetype: "unknown" },
      pokerogueId: ER_ID_MAP.abilities[796],
    },
    {
      draft: { id: 797, name: "Embody Aspect", description: "+1 Defense on Entry.", archetype: "unknown" },
      pokerogueId: ER_ID_MAP.abilities[797],
    },
    {
      draft: { id: 798, name: "Embody Aspect", description: "+1 Sp. Def on Entry.", archetype: "unknown" },
      pokerogueId: ER_ID_MAP.abilities[798],
    },
  ];
  for (const { draft, pokerogueId } of embodyDriftDrafts) {
    if (pokerogueId === undefined || pokerogueId < VANILLA_ID_CUTOFF || existingIds.has(pokerogueId)) {
      continue;
    }
    try {
      const ability = buildCustomAbility(draft, pokerogueId, result);
      (allAbilities as Ability[])[pokerogueId] = ability;
      existingIds.add(pokerogueId);
      result.customsAdded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to construct Embody Aspect (er id ${draft.id} → ${pokerogueId}): ${msg}`);
    }
  }

  const manualDrafts: { draft: ErAbilityDraft; pokerogueId: number }[] = [
    {
      draft: {
        id: ER_SILKEN_DECREE_ABILITY_ID,
        name: "Silken Decree",
        description: "At the end of each turn, randomly seals up to two opposing moves for one turn.",
        archetype: "unknown",
      },
      pokerogueId: ER_SILKEN_DECREE_ABILITY_ID,
    },
    {
      draft: {
        id: ER_PUPPET_STRINGS_ABILITY_ID,
        name: "Puppet Strings",
        description:
          "When this Pokemon damages a poisoned foe with a Psychic-type move, that foe becomes Commanded: its next action is hijacked (it strikes an ally in doubles, or itself in singles; a status move fails). Once per foe's switch-in.",
        archetype: "unknown",
      },
      pokerogueId: ER_PUPPET_STRINGS_ABILITY_ID,
    },
    {
      draft: {
        id: ER_SPORE_BED_ABILITY_ID,
        name: "Spore Bed",
        description:
          "On entry, lays a one-use Infestation trap on the opposing side. The next grounded foe to switch in is trapped by Infestation for its ordinary duration.",
        archetype: "unknown",
      },
      pokerogueId: ER_SPORE_BED_ABILITY_ID,
    },
    {
      draft: {
        id: ER_TANGLED_SEED_ABILITY_ID,
        name: "Tangled Seed",
        description:
          "When this Pokemon applies Leech Seed, the seeded target cannot voluntarily switch out until the end of the following turn. Forced switches still work.",
        archetype: "unknown",
      },
      pokerogueId: ER_TANGLED_SEED_ABILITY_ID,
    },
    {
      draft: {
        id: ER_COMMON_ROOT_ABILITY_ID,
        name: "Common Root",
        description:
          "Whenever a foe loses HP to Leech Seed, every active Pokemon on this Pokemon's side recovers the ordinary Leech Seed amount, not just the seeder.",
        archetype: "unknown",
      },
      pokerogueId: ER_COMMON_ROOT_ABILITY_ID,
    },
    {
      draft: {
        id: ER_MYCELIAL_NETWORK_ABILITY_ID,
        name: "Mycelial Network",
        description:
          "Whenever a foe loses HP to Infestation, this Pokemon heals half that amount. If it is at full HP, the overflow heals its lowest-HP ally (doubles and triples only).",
        archetype: "unknown",
      },
      pokerogueId: ER_MYCELIAL_NETWORK_ABILITY_ID,
    },
    {
      draft: {
        id: ER_LAST_HOST_ABILITY_ID,
        name: "Last Host",
        description:
          "Once per battle, if this Pokemon would faint while a foe is affected by Infestation, it survives at 1 HP: it consumes the Infestation on the highest-HP affected foe, which then loses 25% of its max HP.",
        archetype: "unknown",
      },
      pokerogueId: ER_LAST_HOST_ABILITY_ID,
    },
    {
      draft: {
        id: ER_DANDELION_BURST_ABILITY_ID,
        name: "Dandelion Burst",
        description:
          "Once per battle, when this Pokemon falls to half HP or lower, it applies Leech Seed to all foes and uses Cotton Spore against the opposing side. Normal immunities apply.",
        archetype: "unknown",
      },
      pokerogueId: ER_DANDELION_BURST_ABILITY_ID,
    },
    {
      draft: {
        id: ER_CLEANSING_LIGHT_ABILITY_ID,
        name: "Cleansing Light",
        description:
          "For every direct KO this Pokemon scores, its lowest-HP living ally heals 10% of its max HP. A second KO in the same turn also cures that ally's status.",
        archetype: "unknown",
      },
      pokerogueId: ER_CLEANSING_LIGHT_ABILITY_ID,
    },
    {
      draft: {
        id: ER_PRESSURE_VESSEL_ABILITY_ID,
        name: "Pressure Vessel",
        description:
          "This Pokemon's Defense and Sp. Def scale with its remaining PP: 1.5x at full PP across its moveset, down to 1.0x when empty (1.25x at half).",
        archetype: "unknown",
      },
      pokerogueId: ER_PRESSURE_VESSEL_ABILITY_ID,
    },
    {
      draft: {
        id: ER_RAIN_PUMP_ABILITY_ID,
        name: "Rain Pump",
        description: "At the end of each turn in rain, every one of this Pokemon's moves recovers 1 PP.",
        archetype: "unknown",
      },
      pokerogueId: ER_RAIN_PUMP_ABILITY_ID,
    },
    {
      draft: {
        id: ER_QUICKENING_GRACE_ABILITY_ID,
        name: "Quickening Grace",
        description:
          "Once per turn, the first attacking two-turn charge move selected by an ally executes immediately, skipping its charge turn. Does not affect Geomancy, status moves, or recharge moves.",
        archetype: "unknown",
      },
      pokerogueId: ER_QUICKENING_GRACE_ABILITY_ID,
    },
  ];
  for (const { draft, pokerogueId } of manualDrafts) {
    if (pokerogueId < VANILLA_ID_CUTOFF || existingIds.has(pokerogueId)) {
      continue;
    }
    try {
      const ability = buildCustomAbility(draft, pokerogueId, result);
      (allAbilities as Ability[])[pokerogueId] = ability;
      existingIds.add(pokerogueId);
      result.customsAdded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to construct manual ability "${draft.name}" (${pokerogueId}): ${msg}`);
    }
  }

  patchDarkMovesForRadiance();

  return result;
}

/**
 * ER Radiance (2.65 dex): "Dark moves fail when user is present." Attach the
 * field-wide fail condition to EVERY Dark-type move dynamically (so future Dark
 * moves are covered without per-move wiring). Idempotent across the re-runs this
 * init sees in tests. The +20% accuracy half lives in the archetype dispatcher.
 */
let radianceDarkMovesPatched = false;
function patchDarkMovesForRadiance(): void {
  if (radianceDarkMovesPatched) {
    return;
  }
  radianceDarkMovesPatched = true;
  for (const move of allMoves) {
    if (move?.type === PokemonType.DARK) {
      move.condition(failIfRadianceOnFieldCondition, 3);
    }
  }
}

/** Aggregated result of a single `refreshEliteReduxComposites()` run. */
export interface RefreshEliteReduxCompositesResult {
  /** Number of composite abilities whose attrs were re-resolved. */
  refreshed: number;
  /** Non-fatal errors encountered while re-dispatching. */
  errors: string[];
}

/**
 * Re-resolve every `composite-vanilla-mashup` ability AFTER the vanilla
 * rebalance and C-source corrections have run.
 *
 * Why this exists
 * ---------------
 * Composites are first built in {@linkcode initEliteReduxCustomAbilities}
 * (init.ts step ~71), which snapshots each part ability's `attrs` at that
 * moment. But the vanilla rebalance (init.ts ~92) and C-source corrections
 * (~104) run LATER and may REPLACE a vanilla part's attrs entirely — e.g.
 * `patchAftermath` swaps Aftermath's `PostFaintContactDamageAbAttr` for the ER
 * detonation, `patchForewarn`/`patchPastelVeil` swap their attrs for scripted
 * moves, etc. Any composite embedding such a part (e.g. 614 Balloon Bomb =
 * "Aftermath + Inflatable") therefore froze the STALE pre-patch behavior.
 *
 * The fix is order-independent and idempotent: re-dispatch each composite from
 * its archetype row. The dispatcher rebuilds the whole attr list from the
 * CURRENT (patched) state of every sub-part — vanilla parts now copy their
 * patched attrs, ER and nested-composite parts re-resolve recursively — so a
 * single pass per composite picks up every upstream patch regardless of which
 * order the composites are visited in. Must run AFTER both rebalance and
 * C-source corrections.
 *
 * Composites get their attrs EXCLUSIVELY from the dispatcher
 * ({@linkcode buildCustomAbility} adds no hand-wired attrs beyond the archetype
 * dispatch — only builder flags), so replacing the attr list wholesale is safe.
 */
export function refreshEliteReduxComposites(): RefreshEliteReduxCompositesResult {
  const result: RefreshEliteReduxCompositesResult = { refreshed: 0, errors: [] };
  for (const draft of ER_ABILITIES) {
    const row = ER_ABILITY_ARCHETYPES[draft.id];
    if (row === undefined || row.archetype !== "composite-vanilla-mashup") {
      continue;
    }
    const pokerogueId = ER_ID_MAP.abilities[draft.id];
    if (pokerogueId === undefined || pokerogueId < VANILLA_ID_CUTOFF) {
      continue;
    }
    const ability = allAbilities[pokerogueId];
    if (!ability) {
      continue;
    }
    try {
      const dispatched = dispatchArchetype(row.archetype, row.params, draft.id);
      // Only overwrite when the re-dispatch produced something; a now-empty
      // result means "still unresolvable", and we keep whatever was there.
      if (dispatched.attrs.length === 0) {
        continue;
      }
      const attrs = (ability as unknown as { attrs: AbAttr[] }).attrs;
      attrs.length = 0;
      for (const attr of dispatched.attrs) {
        attrs.push(attr);
      }
      result.refreshed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Composite refresh failed for er ability ${draft.id} → ${pokerogueId}: ${msg}`);
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

  // Phase D3 / D3b: wire archetype-classified attrs via the dispatcher. We
  // look up the archetype row by the ER-side id (not the pokerogue id) since
  // the classifier keys on ER's source numbering. The ER id is also forwarded
  // to the dispatcher so composite-vanilla-mashup rows can find their
  // resolved-parts entry in `ER_COMPOSITE_PARTS`.
  const archetypeRow = ER_ABILITY_ARCHETYPES[draft.id];
  if (archetypeRow !== undefined) {
    wireArchetypeAttrs(builder, draft.id, archetypeRow.archetype, archetypeRow.params, result);
  }

  // ER abilities whose ROM text marks them uncopiable / unsuppressable. Keyed by
  // ER source id (draft.id).
  if (draft.id === 669) {
    // Flammable Coat — "Cannot be copied or suppressed."
    builder.unsuppressable().uncopiable().unreplaceable();
  }

  // Bespoke ER abilities whose behavior is two-part or otherwise not a single
  // archetype shape, so the dispatcher leaves them empty (classified "bespoke").
  // Wire their attrs by hand here. Keyed by ER source id (draft.id).
  if (draft.id === 340) {
    // Fatal Precision — "Super-effective moves never miss and always crit."
    // Never-miss reuses the conditional-always-hit primitive's superEffective
    // gate; always-crit adds a ConditionalCrit gated on the same SE check.
    builder.attr(ConditionalAlwaysHitAbAttr, { superEffective: true });
    builder.attr(
      ConditionalCritAbAttr,
      (user, target, move) => !!target && target.getMoveEffectiveness(user, move) > 1,
    );
  }
  if (draft.id === 355) {
    // Speed Force — "Contact moves use 20% of its Speed stat additionally."
    // Adds 20% of the holder's Speed onto its Attack for contact moves.
    builder.attr(SpeedBonusToStatAbAttr, { stat: Stat.ATK, speedFraction: 0.2, filter: { contact: "only" } });
  }

  if (pokerogueId === ER_SILKEN_DECREE_ABILITY_ID) {
    builder.attr(SilkenDecreeAbAttr);
  }

  if (pokerogueId === ER_PUPPET_STRINGS_ABILITY_ID) {
    builder.attr(PuppetStringsAbAttr);
  }

  if (pokerogueId === ER_SPORE_BED_ABILITY_ID) {
    builder.attr(EntryTrapOnFoeSideAbAttr, BattlerTagType.INFESTATION, "foe");
  }

  if (pokerogueId === ER_TANGLED_SEED_ABILITY_ID) {
    builder.attr(TangledSeedAbAttr);
  }

  if (pokerogueId === ER_COMMON_ROOT_ABILITY_ID) {
    builder.attr(CommonRootAbAttr);
  }

  if (pokerogueId === ER_MYCELIAL_NETWORK_ABILITY_ID) {
    builder.attr(MycelialNetworkAbAttr);
  }

  if (pokerogueId === ER_LAST_HOST_ABILITY_ID) {
    builder.attr(LastHostAbAttr);
  }

  if (pokerogueId === ER_DANDELION_BURST_ABILITY_ID) {
    builder.attr(DandelionBurstAbAttr);
  }

  if (pokerogueId === ER_CLEANSING_LIGHT_ABILITY_ID) {
    builder.attr(CleansingLightAbAttr);
  }

  if (pokerogueId === ER_PRESSURE_VESSEL_ABILITY_ID) {
    builder.attr(PressureVesselAbAttr);
  }

  if (pokerogueId === ER_RAIN_PUMP_ABILITY_ID) {
    builder.attr(RainPumpAbAttr);
  }

  if (pokerogueId === ER_QUICKENING_GRACE_ABILITY_ID) {
    builder.attr(QuickeningGraceAbAttr);
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
  erAbilityId: number,
  archetype: ErArchetypeKind,
  params: Record<string, unknown> | null,
  result: InitEliteReduxCustomAbilitiesResult,
): void {
  let dispatched: ReturnType<typeof dispatchArchetype>;
  try {
    dispatched = dispatchArchetype(archetype, params, erAbilityId);
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
  // A PostFaint attr (Haunted Spirit / Vengeful Spirit curse, on-faint weather /
  // hazard, Guilt Trip) only fires if the ability BYPASSES the faint gate in
  // canApplyAbility (hp>0 || bypassFaint). Vanilla Aftermath sets this via
  // `.bypassFaint()`; ER's archetype wiring must do the same or the effect
  // silently never runs on the holder's KO.
  if (dispatched.attrs.some(attr => attr instanceof PostFaintAbAttr)) {
    builder.bypassFaint();
  }
  result.attrsWiredByArchetype[archetype] = (result.attrsWiredByArchetype[archetype] ?? 0) + 1;
  result.totalAttrsAttached += dispatched.attrs.length;
}
