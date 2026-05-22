import { allAbilities } from "#data/data-lists";
import { ChanceStatusOnHitAbAttr } from "#data/elite-redux/archetypes/chance-status-on-hit";
import { EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { FlagDamageBoostAbAttr } from "#data/elite-redux/archetypes/flag-damage-boost";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { ER_ABILITY_ARCHETYPES } from "#data/elite-redux/er-ability-archetypes";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { initEliteReduxCustomAbilities } from "#data/elite-redux/init-elite-redux-custom-abilities";
import { ErAbilityId } from "#enums/er-ability-id";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";
import { describe, expect, it } from "vitest";

const VANILLA_ID_CUTOFF = 5000;

/**
 * Tally how many ER-classified rows currently have at least one AbAttr
 * wired on the registered ability. Iterates `ER_ABILITY_ARCHETYPES` and
 * looks up the registered ability via `ER_ID_MAP`. Extracted as a helper
 * to keep the calling test's cognitive complexity within biome's threshold.
 */
function tallyWiredCounts(): Record<string, number> {
  const wired: Record<string, number> = {};
  for (const entry of Object.values(ER_ABILITY_ARCHETYPES)) {
    const pokerogueId = ER_ID_MAP.abilities[entry.erAbilityId];
    if (pokerogueId === undefined || pokerogueId < VANILLA_ID_CUTOFF) {
      continue;
    }
    const ability = allAbilities.find(a => a.id === pokerogueId);
    if (!ability || ability.attrs.length === 0) {
      continue;
    }
    wired[entry.archetype] = (wired[entry.archetype] ?? 0) + 1;
  }
  return wired;
}

/**
 * B2 test suite: verifies ER-custom ability registration.
 *
 * The test harness already runs initEliteReduxCustomAbilities() during
 * test-file-initialization (via init.ts → initializeGame()), so the customs
 * are present in allAbilities before each test. We exercise:
 *   1. Idempotency: re-running adds 0 new entries.
 *   2. Custom IDs are all ≥ VANILLA_ID_CUTOFF.
 *   3. A known custom (e.g. SCRAPYARD) is registered with valid construction.
 *   4. ErAbilityId enum cardinality (~735 entries).
 *   5. No construction errors on re-init path.
 */
describe("initEliteReduxCustomAbilities (B2)", () => {
  it("is idempotent — re-running adds 0 customs (all already present)", () => {
    const result = initEliteReduxCustomAbilities();
    expect(result.customsAdded).toBe(0);
    expect(result.customsAlreadyPresent).toBeGreaterThan(700);
  });

  it("ErAbilityId enum has ~735 entries (one per ER-custom ability)", () => {
    const entries = Object.entries(ErAbilityId);
    expect(entries.length).toBeGreaterThan(700);
    expect(entries.length).toBeLessThan(800);
    // Every value should be ≥ VANILLA_ID_CUTOFF.
    for (const [, value] of entries) {
      expect(value).toBeGreaterThanOrEqual(VANILLA_ID_CUTOFF);
    }
  });

  it("all ER-custom abilities are in allAbilities with id ≥ 5000", () => {
    const customsInAllAbilities = allAbilities.filter(a => a.id >= VANILLA_ID_CUTOFF);
    expect(customsInAllAbilities.length).toBeGreaterThan(700);
    expect(customsInAllAbilities.length).toBeLessThan(800);
  });

  it("SCRAPYARD custom is registered with sane construction (id, name, description)", () => {
    // Widen via `as number` — ErAbilityId values (e.g. 5137) are not in the
    // declared AbilityId enum range, so TS would otherwise flag the
    // comparison as having no overlap.
    const scrapyardId = ErAbilityId.SCRAPYARD as number;
    expect(scrapyardId).toBeGreaterThanOrEqual(VANILLA_ID_CUTOFF);
    const scrapyard = allAbilities.find(a => a.id === scrapyardId);
    expect(scrapyard).toBeDefined();
    if (!scrapyard) {
      return;
    }
    expect(scrapyard.id).toBe(scrapyardId);
    // Per-instance override of the `name` getter — should return the verbatim
    // ER draft name, not the i18next missing-key placeholder.
    expect(typeof scrapyard.name).toBe("string");
    expect(scrapyard.name.length).toBeGreaterThan(0);
    expect(scrapyard.name).not.toMatch(/^ability:/);
    expect(typeof scrapyard.description).toBe("string");
    expect(scrapyard.description.length).toBeGreaterThan(0);
    // Scrapyard is classified `bespoke` — Phase D3 leaves it as a placeholder
    // (no AbAttrs) until its hand-written wiring lands in the bespoke task.
    expect(scrapyard.attrs).toHaveLength(0);
  });

  it("no construction errors on the test harness's startup run", () => {
    // If initEliteReduxCustomAbilities failed to construct any ability, the
    // re-run would also fail for the same reason. We verify the re-run's
    // errors list is empty (idempotent path; the actual startup error count
    // isn't directly observable from here).
    const result = initEliteReduxCustomAbilities();
    expect(result.errors).toHaveLength(0);
  });
});

/**
 * D3 test suite: verifies archetype-classified abilities get the right
 * `AbAttr` instances wired onto them via the dispatcher.
 *
 * The test harness's startup run already attached the attrs (init.ts calls
 * initEliteReduxCustomAbilities() once during initializeGame()), so we read
 * the registered ability and inspect its `attrs` array. This is a structural
 * check — we verify the right constructor type is present and (for
 * representative cases) the right configuration. End-to-end behavior tests
 * live in the per-archetype test files.
 */
describe("initEliteReduxCustomAbilities (D3): archetype wire-up", () => {
  it("KEEN_EDGE (er id 271, flag-damage-boost) has a FlagDamageBoostAbAttr", () => {
    const id = ER_ID_MAP.abilities[271];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    const attrs = ability.attrs.filter((a): a is FlagDamageBoostAbAttr => a instanceof FlagDamageBoostAbAttr);
    expect(attrs.length).toBe(1);
    const attr = attrs[0];
    expect(attr.getBoostFlag()).toBe(MoveFlags.SLICING_MOVE);
    expect(attr.getHighHpMultiplier()).toBe(1.3);
  });

  it("ELECTROCYTES (er id 281, type-damage-boost) has a TypeDamageBoostAbAttr", () => {
    const id = ER_ID_MAP.abilities[281];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    const attrs = ability.attrs.filter((a): a is TypeDamageBoostAbAttr => a instanceof TypeDamageBoostAbAttr);
    expect(attrs.length).toBe(1);
    const attr = attrs[0];
    expect(attr.getBoostType()).toBe(PokemonType.ELECTRIC);
    expect(attr.getHighHpMultiplier()).toBe(1.25);
    // No `lowHpMultiplier` configured for this entry.
    expect(attr.getLowHpMultiplier()).toBeNull();
  });

  it("SPECTRAL_SHROUD (er id 386, chance-status-on-hit) has a ChanceStatusOnHitAbAttr for TOXIC", () => {
    const id = ER_ID_MAP.abilities[386];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    const attrs = ability.attrs.filter((a): a is ChanceStatusOnHitAbAttr => a instanceof ChanceStatusOnHitAbAttr);
    expect(attrs.length).toBe(1);
    const attr = attrs[0];
    expect(attr.getChance()).toBe(30);
    expect(attr.getEffects()).toEqual([StatusEffect.TOXIC]);
    // onContactOnly: false in the classifier → contactRequired: false.
    expect(attr.requiresContact()).toBe(false);
  });

  it("ELECTRO_SURGE (er id 226, entry-effect set-terrain) has an EntryEffectAbAttr", () => {
    const id = ER_ID_MAP.abilities[226];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    const attrs = ability.attrs.filter((a): a is EntryEffectAbAttr => a instanceof EntryEffectAbAttr);
    expect(attrs.length).toBe(1);
    const effect = attrs[0].getEffect();
    expect(effect.kind).toBe("set-terrain");
  });

  it("bespoke entries (e.g. SCRAPYARD er id 400) have no archetype attrs", () => {
    const id = ER_ID_MAP.abilities[400];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    // ER 400 is classified `bespoke` — dispatcher returns no attrs.
    expect(ability.attrs).toHaveLength(0);
  });

  it("composite entries (e.g. As One er id 266 — Unnerve + Chilling Neigh) wire parts' attrs (D3b)", () => {
    const id = ER_ID_MAP.abilities[266];
    expect(id).toBeDefined();
    const ability = allAbilities.find(a => a.id === id);
    expect(ability).toBeDefined();
    if (!ability) {
      return;
    }
    // ER 266 = "Unnerve + Chilling Neigh". Both parts are vanilla pokerogue
    // abilities — their AbAttrs (PreventBerryUseAbAttr + PostVictoryStatStageChangeAbAttr)
    // should be copied onto this composite. We just check non-empty here;
    // structural assertions live in composite-resolution.test.ts.
    expect(ability.attrs.length).toBeGreaterThanOrEqual(2);
  });

  it("ER ability count by archetype matches the dispatcher's coverage", () => {
    // Sanity bound: the dispatcher should wire attrs on a meaningful fraction
    // of classified rows. The hard targets per archetype:
    //   - type-damage-boost (25 rows): all wire.
    //   - flag-damage-boost (8 rows): all wire (after `lookupMoveFlag` resolution).
    //   - chance-status-on-hit (29 rows): some skip due to non-StatusEffect
    //     statuses (CONFUSION, FLINCH, BLEED, FROSTBITE, INFATUATION, FEAR,
    //     DISABLE) — at least the vanilla-status ones wire.
    //
    // We tally how many rows in each archetype-with-coverage successfully
    // produce attrs (excluding bespoke + composite + unwired archetypes).
    const wiredCounts = tallyWiredCounts();
    // Per-archetype wire counts — these are concrete sanity bounds.
    //   - type-damage-boost (25 rows): every entry has a parseable type + multiplier.
    //   - flag-damage-boost (8 rows): every entry has a parseable flag + multiplier.
    //   - chance-status-on-hit (29 rows): some skip due to non-StatusEffect
    //     statuses (CONFUSION, FLINCH, BLEED, FROSTBITE, INFATUATION, FEAR,
    //     DISABLE). Vanilla statuses (POISON, TOXIC, PARALYSIS, SLEEP, BURN,
    //     FREEZE) wire — about a third of the rows.
    //   - entry-effect (76 rows total but only ~30 wire — the classifier
    //     emits `scripted-move` (23), `set-misc` (11), `misc` (10), and
    //     `lower-foe-stat` (2) which the archetype doesn't yet model).
    expect(wiredCounts["type-damage-boost"] ?? 0).toBeGreaterThanOrEqual(20);
    expect(wiredCounts["flag-damage-boost"] ?? 0).toBeGreaterThanOrEqual(6);
    expect(wiredCounts["chance-status-on-hit"] ?? 0).toBeGreaterThanOrEqual(10);
    expect(wiredCounts["entry-effect"] ?? 0).toBeGreaterThanOrEqual(20);
    // D3b: composite-vanilla-mashup now wires attrs via the resolved-parts side
    // table — at least 100 of the 196 composites should have ≥1 attr each.
    expect(wiredCounts["composite-vanilla-mashup"] ?? 0).toBeGreaterThanOrEqual(100);
    // Phase D bespoke: a small handful of long-tail bespoke ER abilities are
    // now hand-wired via `dispatchBespoke` (see `archetype-dispatcher.ts`).
    // Each lands a constructed AbAttr; the rest of the 258 bespoke rows still
    // skip with `SKIP_BESPOKE`. Bound the wired count loosely so adding more
    // bespoke wirings in follow-up tasks doesn't invalidate this assertion.
    expect(wiredCounts.bespoke ?? 0).toBeGreaterThanOrEqual(5);
    expect(wiredCounts.bespoke ?? 0).toBeLessThanOrEqual(50);
  });

  it("init result reports per-archetype wired counts (fresh run on a clean baseline)", () => {
    // We can't get a fresh-run report on the harness's already-initialized
    // baseline (initEliteReduxCustomAbilities is idempotent — re-runs add 0
    // and report attrsWiredByArchetype as empty). Instead, validate that the
    // result shape is correct and the diagnostic maps exist.
    const result = initEliteReduxCustomAbilities();
    expect(result.customsAdded).toBe(0); // idempotent
    expect(typeof result.totalAttrsAttached).toBe("number");
    expect(result.attrsWiredByArchetype).toBeDefined();
    expect(result.dispatchSkipsByArchetype).toBeDefined();
  });
});
