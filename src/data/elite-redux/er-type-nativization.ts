/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Type-nativization sweep (Pass A).
//
// The ER "type-grant" ability family (Aquatic/Grounded/Ice Age/Half Drake/
// Metallic/Phantom/Fairy Tale/Lightning Born/Bruiser/Rocky Exterior, each "adds
// X type on entry") is REMOVED from every holder. Instead each holder gains the
// granted type NATIVELY as a 3rd/extra type (the N-type `setExtraTypes` model),
// and the vacated ability slot is replaced by the per-mon ability in the
// maintainer's list (or, for holders with no list entry, the most sensible
// existing ability — flagged NEEDS-MAINTAINER-ENTRY, documented in
// docs/type-nativization-holders.md).
//
// This runs as an init pass AFTER `applyErPokedexOverrides` (the editor's ability
// overrides), so it is authoritative. It operates on the LIVE species/form
// objects (mutating ability slots + the ER `_passives` triple + `setExtraTypes`)
// and is idempotent: re-running finds the grant already swapped and no-ops.
//
// Battle-correctness: the removed entry-effect ability wrote the granted type to
// `summonData.types` on switch-in (a 3-slot model); `getBaseTypes()` folds the
// native extra type identically, so effectiveness / STAB / immunities are
// unchanged in battle. See test/tests/elite-redux/er-type-nativization*.test.ts.
//
// NOTE: `Dragonfly` (5050) and other rider-bearing type-granters are OUT of scope
// (not among the 10 named categories; nativizing their type alone would drop a
// bundled rider) — see the holder report's "Out of sweep scope" section.
// =============================================================================

import { allSpecies } from "#data/data-lists";
import {
  ER_ALLURING_SKULL_ABILITY_ID,
  ER_FORMLESS_FIST_ABILITY_ID,
  ER_FREE_CLIMB_ABILITY_ID,
  ER_GRIEVOUS_SPEAR_ABILITY_ID,
  ER_GRIM_JAB_ABILITY_ID,
  ER_PRICKLY_ARMOR_ABILITY_ID,
  ER_SPECTACLE_ABILITY_ID,
} from "#data/elite-redux/abilities/type-nativization-abilities";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { PokemonSpeciesForm } from "#data/pokemon-species";

/** One type-grant holder: remove `grant`, add `grantedType` natively, put
 * `replacement` in the freed slot (+ an optional secondary ability swap). */
export interface TypeNativizationEntry {
  /** speciesConst key (as in er-species.ts); mega entries carry the `_MEGA` const. */
  readonly species: string;
  /** The live type-grant ability id to remove (ErAbilityId.*). */
  readonly grant: number;
  /** The type the holder gains natively (dedup-safe against its base types). */
  readonly grantedType: PokemonType;
  /** The live ability id put in the vacated slot. */
  readonly replacement: number;
  /** When set, the holder is reached as a `mega`/`primal` FORM on its base species. */
  readonly isMega?: boolean;
  /** Extra base speciesConst to also scan (for RENAMED redux mons whose live form
   * lives on a vanilla base that the const name does not encode, e.g. Rexcadrill =
   * Excadrill's `redux` form). Grant-gated, so unrelated forms stay untouched. */
  readonly baseSpecies?: string;
  /** A second, independent ability swap on the same holder (e.g. Selenumbra Levitate->Spectacle). */
  readonly extraSwap?: { readonly from: number; readonly to: number };
  /** No maintainer list entry — a sensible existing ability was picked (documented). */
  readonly needsMaintainerEntry?: boolean;
  /** Free-text derivation note (surfaced in the holder report). */
  readonly note?: string;
}

/** A pure ability swap with NO type nativization (the SMALL CHANGES section). */
export interface AbilitySwapEntry {
  readonly species: string;
  readonly from: number;
  readonly to: number;
  /** Maintainer marked this "possibly" — cheap to revert. */
  readonly tentative?: boolean;
  readonly note?: string;
}

// The complete derived holder list (see docs/type-nativization-holders.md).
export const ER_TYPE_NATIVIZATION: readonly TypeNativizationEntry[] = [
  { species: "SPECIES_DRAGALGE", grant: ErAbilityId.AQUATIC, grantedType: PokemonType.WATER, replacement: ErAbilityId.HYDRATE },
  { species: "SPECIES_TYNAMO", grant: ErAbilityId.AQUATIC, grantedType: PokemonType.WATER, replacement: AbilityId.LEVITATE, needsMaintainerEntry: true, note: "Eelektross-line signature ability." },
  { species: "SPECIES_EELEKTRIK", grant: ErAbilityId.AQUATIC, grantedType: PokemonType.WATER, replacement: AbilityId.LEVITATE, needsMaintainerEntry: true, note: "Eelektross-line signature ability." },
  { species: "SPECIES_STUNFISK", grant: ErAbilityId.AQUATIC, grantedType: PokemonType.WATER, replacement: AbilityId.STATIC, needsMaintainerEntry: true, note: "Stunfisk native ability." },
  { species: "SPECIES_DODRIO", grant: ErAbilityId.GROUNDED, grantedType: PokemonType.GROUND, replacement: ErAbilityId.BRUISER, note: "[?] resolved to first option." },
  { species: "SPECIES_DODUO", grant: ErAbilityId.GROUNDED, grantedType: PokemonType.GROUND, replacement: ErAbilityId.FIGHTER, note: "[?] resolved to first option." },
  { species: "SPECIES_ARCHEN", grant: ErAbilityId.GROUNDED, grantedType: PokemonType.GROUND, replacement: AbilityId.AERILATE, note: "SMALL CHANGES supersedes Tectonize." },
  { species: "SPECIES_KILOZUNA", grant: ErAbilityId.GROUNDED, grantedType: PokemonType.GROUND, replacement: ErAbilityId.FIGHTING_SPIRIT, note: "Kilozuna + Hariyama." },
  { species: "SPECIES_KILOZUNA_MEGA", grant: ErAbilityId.GROUNDED, grantedType: PokemonType.GROUND, replacement: ErAbilityId.FIGHTING_SPIRIT, isMega: true, note: "Mega of Kilozuna." },
  { species: "SPECIES_HARIYAMA_REDUX", grant: ErAbilityId.GROUNDED, grantedType: PokemonType.GROUND, replacement: ErAbilityId.FIGHTING_SPIRIT, note: "Kilozuna + Hariyama." },
  { species: "SPECIES_TURTWIG", grant: ErAbilityId.GROUNDED, grantedType: PokemonType.GROUND, replacement: AbilityId.SHELL_ARMOR, needsMaintainerEntry: true, note: "Turtwig line." },
  { species: "SPECIES_GROTLE", grant: ErAbilityId.GROUNDED, grantedType: PokemonType.GROUND, replacement: AbilityId.SHELL_ARMOR, needsMaintainerEntry: true, note: "Turtwig line." },
  { species: "SPECIES_SKORUPI", grant: ErAbilityId.GROUNDED, grantedType: PokemonType.GROUND, replacement: AbilityId.BATTLE_ARMOR, needsMaintainerEntry: true, note: "Skorupi native ability." },
  { species: "SPECIES_ORTHWORM", grant: ErAbilityId.GROUNDED, grantedType: PokemonType.GROUND, replacement: AbilityId.SAND_VEIL, needsMaintainerEntry: true, note: "Orthworm hidden ability." },
  { species: "SPECIES_CLAWITZER_REDUX", grant: ErAbilityId.ICE_AGE, grantedType: PokemonType.ICE, replacement: ErAbilityId.OVERZEALOUS_N, note: "Clawtificer = Clawitzer Redux; [?] first option." },
  { species: "SPECIES_SALAZZLE", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: ErAbilityId.MINION_CONTROL },
  { species: "SPECIES_SALAZARUS", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: AbilityId.CORROSION },
  { species: "SPECIES_HERACREUS", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: ErAbilityId.DRACONIZE },
  { species: "SPECIES_DODUO_REDUX", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: AbilityId.TANGLED_FEET, note: "Doduo R." },
  { species: "SPECIES_DODRIO_REDUX", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: AbilityId.TANGLED_FEET, note: "Dodrio R." },
  { species: "SPECIES_SCIZOR_REDUX", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: ErAbilityId.DRACONIZE, note: "Scizor R (Mega -> Komodo tracked)." },
  { species: "SPECIES_SCYTHER_REDUX", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: ErAbilityId.DRACONIZE, note: "Scyther R (Mega -> Komodo tracked)." },
  { species: "SPECIES_KLEAVOR_REDUX", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: ErAbilityId.DRACONIZE, note: "Kleavor R (Mega -> Komodo tracked)." },
  { species: "SPECIES_SKRELP", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: ErAbilityId.HYDRATE, needsMaintainerEntry: true, note: "Dragalge pre-evo; matches Dragalge." },
  { species: "SPECIES_SALANDIT", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: ErAbilityId.MINION_CONTROL, needsMaintainerEntry: true, note: "Salazzle pre-evo; matches Salazzle." },
  { species: "SPECIES_CHARMANDER", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: AbilityId.SOLAR_POWER, needsMaintainerEntry: true, note: "Charizard line hidden ability." },
  { species: "SPECIES_CHARMELEON", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: AbilityId.SOLAR_POWER, needsMaintainerEntry: true, note: "Charizard line hidden ability." },
  { species: "SPECIES_BURMY_ETERNA", grant: ErAbilityId.HALF_DRAKE, grantedType: PokemonType.DRAGON, replacement: AbilityId.PRESSURE, needsMaintainerEntry: true, note: "Pre-evo of tracked-only Eternaburm; Pressure matches evo intent." },
  { species: "SPECIES_DHELMISE", grant: ErAbilityId.METALLIC, grantedType: PokemonType.STEEL, replacement: ErAbilityId.HYDRATE },
  { species: "SPECIES_PLUNDERTOW", grant: ErAbilityId.METALLIC, grantedType: PokemonType.STEEL, replacement: ErAbilityId.AQUATIC, note: "KEEPS a type-grant (Water) per maintainer; flagged." },
  { species: "SPECIES_DREADNAUT", grant: ErAbilityId.METALLIC, grantedType: PokemonType.STEEL, replacement: AbilityId.STEELWORKER },
  { species: "SPECIES_NECROZMA", grant: ErAbilityId.METALLIC, grantedType: PokemonType.STEEL, replacement: ErAbilityId.SOUL_EATER },
  { species: "SPECIES_TOXTRICITY_REDUX", grant: ErAbilityId.METALLIC, grantedType: PokemonType.STEEL, replacement: ErAbilityId.LOUD_BANG, note: "Toxtricity R Male; [?] first option." },
  { species: "SPECIES_TOXTRICITY_REDUX_MEGA", grant: ErAbilityId.METALLIC, grantedType: PokemonType.STEEL, replacement: ErAbilityId.LOUD_BANG, isMega: true, note: "Mega of Toxtricity R Male." },
  { species: "SPECIES_FALINKS", grant: ErAbilityId.METALLIC, grantedType: PokemonType.STEEL, replacement: AbilityId.BATTLE_ARMOR, needsMaintainerEntry: true, note: "Base Falinks; spec only addresses Falinks Mega -> Voltron." },
  { species: "SPECIES_GURDURR", grant: ErAbilityId.METALLIC, grantedType: PokemonType.STEEL, replacement: AbilityId.IRON_FIST, needsMaintainerEntry: true, note: "Gurdurr native ability." },
  { species: "SPECIES_GIMMIGHOUL", grant: ErAbilityId.METALLIC, grantedType: PokemonType.STEEL, replacement: AbilityId.RUN_AWAY, needsMaintainerEntry: true, note: "Gimmighoul (chest)." },
  { species: "SPECIES_GIMMIGHOUL_ROAMING", grant: ErAbilityId.METALLIC, grantedType: PokemonType.STEEL, replacement: AbilityId.RUN_AWAY, needsMaintainerEntry: true, note: "Gimmighoul (roaming)." },
  { species: "SPECIES_CHINGLING", grant: ErAbilityId.METALLIC, grantedType: PokemonType.STEEL, replacement: AbilityId.LEVITATE, needsMaintainerEntry: true, note: "Chimecho line signature." },
  { species: "SPECIES_WOOLY_WORM", grant: ErAbilityId.METALLIC, grantedType: PokemonType.STEEL, replacement: AbilityId.SHIELD_DUST, needsMaintainerEntry: true, note: "Larva flavour." },
  { species: "SPECIES_PARASECT", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: ErAbilityId.JUMPSCARE },
  { species: "SPECIES_GARDEVOIR_REDUX", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: ER_GRIM_JAB_ABILITY_ID, note: "Gardevoir R." },
  { species: "SPECIES_GARDEVOIR_REDUX_MEGA", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: ER_GRIEVOUS_SPEAR_ABILITY_ID, isMega: true, note: "Gardevoir R Mega." },
  { species: "SPECIES_SELENUMBRA", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: ErAbilityId.LUNAR_AFFINITY, extraSwap: { from: AbilityId.LEVITATE, to: ER_SPECTACLE_ABILITY_ID }, note: "Sheer Force holder; maintainer 2026-07-17: Lunar Affinity (was Serene Grace, which conflicts with Sheer Force). Also swaps Levitate -> Spectacle (NEW)." },
  { species: "SPECIES_TOXTRICITY_REDUX_FUZZ", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: AbilityId.HEAVY_METAL, note: "Toxtricity R Female." },
  { species: "SPECIES_TOXTRICITY_REDUX_FUZZ_MEGA", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: AbilityId.HEAVY_METAL, isMega: true, note: "Mega of Toxtricity R Female." },
  { species: "SPECIES_PHANFERNAL", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: ER_ALLURING_SKULL_ABILITY_ID },
  { species: "SPECIES_ROTOM_HEAT", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: ErAbilityId.OVERCHARGE, note: "Rotom appliance form." },
  { species: "SPECIES_ROTOM_WASH", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: ErAbilityId.OVERCHARGE, note: "Rotom appliance form." },
  { species: "SPECIES_ROTOM_FROST", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: ErAbilityId.OVERCHARGE, note: "Rotom appliance form." },
  { species: "SPECIES_ROTOM_FAN", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: ErAbilityId.OVERCHARGE, note: "Rotom appliance form." },
  { species: "SPECIES_ROTOM_MOW", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: ErAbilityId.OVERCHARGE, note: "Rotom appliance form." },
  { species: "SPECIES_SOLROCK_SYSTEM", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: AbilityId.LEVITATE, needsMaintainerEntry: true, note: "Solrock signature." },
  { species: "SPECIES_LARVESTA_REDUX", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: AbilityId.FLAME_BODY, needsMaintainerEntry: true, note: "Larvesta line." },
  { species: "SPECIES_VOLCARONA_REDUX", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: AbilityId.SERENE_GRACE, note: "Volcarona R; maintainer 2026-07-17: Serene Grace (was Flame Body)." },
  { species: "SPECIES_BELLSPROUT_REDUX", grant: ErAbilityId.PHANTOM, grantedType: PokemonType.GHOST, replacement: AbilityId.CHLOROPHYLL, needsMaintainerEntry: true, note: "Bellsprout line." },
  { species: "SPECIES_IRON_VOCA", grant: ErAbilityId.FAIRY_TALE, grantedType: PokemonType.FAIRY, replacement: ErAbilityId.STEEL_BARREL, note: "Rock Head/Steel Barrel -> Steel Barrel (Rock Head alt noted)." },
  { species: "SPECIES_BREEZING", grant: ErAbilityId.LIGHTNING_BORN, grantedType: PokemonType.ELECTRIC, replacement: ErAbilityId.GENERATOR, needsMaintainerEntry: true, note: "Weezing R line -> Generator per maintainer intent." },
  { species: "SPECIES_STORMING", grant: ErAbilityId.LIGHTNING_BORN, grantedType: PokemonType.ELECTRIC, replacement: ErAbilityId.GENERATOR, needsMaintainerEntry: true, note: "Weezing R line -> Generator per maintainer intent." },
  { species: "SPECIES_SPINDAZE", grant: ErAbilityId.BRUISER, grantedType: PokemonType.FIGHTING, replacement: ER_FORMLESS_FIST_ABILITY_ID },
  { species: "SPECIES_SNEASLER_MEGA", grant: ErAbilityId.ROCKY_EXTERIOR, grantedType: PokemonType.ROCK, replacement: ER_FREE_CLIMB_ABILITY_ID, isMega: true },
  { species: "SPECIES_REXCADRILL", grant: ErAbilityId.ROCK_ARMOR, grantedType: PokemonType.ROCK, replacement: ER_PRICKLY_ARMOR_ABILITY_ID, note: "Rock Armor reworked into Prickly Armor (Sharp Edge + 10% reduction); Rock nativized." },
  // Excadrill Redux carries Rocky Exterior (a distinct species from Rexcadrill,
  // which carries Rock Armor). Not in the maintainer list -> NEEDS-MAINTAINER;
  // given Prickly Armor to match the Rexcadrill rework flavour. The _REDUX strip
  // also reaches Excadrill's live `redux` form.
  { species: "SPECIES_EXCADRILL_REDUX", grant: ErAbilityId.ROCKY_EXTERIOR, grantedType: PokemonType.ROCK, replacement: ER_PRICKLY_ARMOR_ABILITY_ID, needsMaintainerEntry: true, note: "Excadrill Redux (distinct from Rexcadrill); Prickly Armor to match the rework." },
];

// SMALL CHANGES: pure ability swaps (no type-grant involved).
// NOTE (Marowak): the maintainer asked to replace "Ill Will" with Alluring Skull,
// but in current data Marowak carries "Bone Zone" (5091), NOT Ill Will (5285) — the
// named ability is absent, so the swap is TRACKED-ONLY (not applied) pending a
// maintainer clarification (did they mean Bone Zone, or a specific form?). See the
// holder report's tracked section.
export const ER_ABILITY_SWAPS: readonly AbilitySwapEntry[] = [
  { species: "SPECIES_DUSKULL", from: AbilityId.PICKPOCKET, to: ER_ALLURING_SKULL_ABILITY_ID, tentative: true, note: "Maintainer said possibly; tentative." },
  { species: "SPECIES_DUSKNOIR", from: AbilityId.IRON_FIST, to: ER_ALLURING_SKULL_ABILITY_ID, tentative: true, note: "Maintainer tentative." },
];

/** Aggregated result of an {@linkcode applyErTypeNativization} run. */
export interface TypeNativizationResult {
  /** Holders that received the native extra type. */
  extraTypesSet: number;
  /** Ability slots/innates swapped (grant->replacement, extraSwap, small-change swaps). */
  abilitiesSwapped: number;
  /** Entries whose species could not be resolved to a live species (tracked). */
  unresolved: string[];
  /** Entries whose grant/`from` ability was not found on the resolved target (tracked). */
  notFound: string[];
}

/** Mutable view of a species/form's active ability slots. */
interface MutableActiveSlots {
  ability1: number;
  ability2: number;
  abilityHidden: number;
}

/** The passive triple as the GAME reads it (handles the _passives triple AND the
 * legacy single-passive fallback for standalone ER species with no _passives). */
function readPassives(target: PokemonSpeciesForm): readonly number[] {
  return target.getPassiveAbilities() as readonly number[];
}

/** Replace every occurrence of `from` with `to` across the target's active
 * slots and its ER passive triple. Returns whether anything changed. Writes
 * passives via `setPassives` so a legacy single-passive holder is materialized
 * into a real _passives triple (which then takes precedence when read). */
function swapAbility(target: PokemonSpeciesForm, from: number, to: number): boolean {
  const t = target as unknown as MutableActiveSlots;
  let changed = false;
  if (t.ability1 === from) {
    t.ability1 = to;
    changed = true;
  }
  if (t.ability2 === from) {
    t.ability2 = to;
    changed = true;
  }
  if (t.abilityHidden === from) {
    t.abilityHidden = to;
    changed = true;
  }
  const passives = readPassives(target);
  if (passives.includes(from)) {
    target.setPassives(passives.map(p => (p === from ? to : p)) as [AbilityId, AbilityId, AbilityId]);
    changed = true;
  }
  return changed;
}

/** Whether the target currently carries `abilityId` in any slot or passive. */
function holderHasAbility(target: PokemonSpeciesForm, abilityId: number): boolean {
  const t = target as unknown as MutableActiveSlots;
  return (
    t.ability1 === abilityId
    || t.ability2 === abilityId
    || t.abilityHidden === abilityId
    || readPassives(target).includes(abilityId)
  );
}

/** Resolve a speciesConst to a live species id (vanilla enum or ER id-map). */
export function resolveErSpeciesConstId(speciesConst: string): number | undefined {
  return resolveSpeciesId(speciesConst);
}

function resolveSpeciesId(speciesConst: string): number | undefined {
  const draftId = ER_DRAFT_ID_BY_CONST.get(speciesConst);
  if (draftId === undefined) {
    const id = (SpeciesId as unknown as Record<string, number | undefined>)[speciesConst.replace(/^SPECIES_/, "")];
    return typeof id === "number" ? id : undefined;
  }
  return ER_ID_MAP.species[draftId];
}

const ER_DRAFT_ID_BY_CONST: ReadonlyMap<string, number> = new Map(
  ER_SPECIES.map(d => [d.speciesConst, d.id] as const),
);

/** The set of live type-grant ability ids the sweep removes (for the integrity check). */
export const ER_TYPE_GRANT_ABILITY_IDS: readonly number[] = [
  ErAbilityId.AQUATIC,
  ErAbilityId.GROUNDED,
  ErAbilityId.ICE_AGE,
  ErAbilityId.HALF_DRAKE,
  ErAbilityId.METALLIC,
  ErAbilityId.PHANTOM,
  ErAbilityId.FAIRY_TALE,
  ErAbilityId.LIGHTNING_BORN,
  ErAbilityId.BRUISER,
  ErAbilityId.ROCKY_EXTERIOR,
];

/** Add a native extra type to a species/form (dedup-safe). */
function addNativeType(target: PokemonSpeciesForm, type: PokemonType): void {
  const existing = target.getExtraTypes();
  target.setExtraTypes([...existing, type]);
}

/** Add a speciesConst's live species object AND all of its forms to `targets`. */
function collectSpeciesTargets(speciesConst: string, targets: Set<PokemonSpeciesForm>): void {
  const speciesId = resolveSpeciesId(speciesConst);
  const species = speciesId === undefined ? undefined : allSpecies.find(s => s.speciesId === speciesId);
  if (!species) {
    return;
  }
  targets.add(species as unknown as PokemonSpeciesForm);
  for (const form of species.forms) {
    targets.add(form as unknown as PokemonSpeciesForm);
  }
}

/**
 * The candidate species/form targets for an entry. LIBERAL by design: it adds
 * the resolved species + all its forms, and (for ER form-injected holders whose
 * `_REDUX`/`_MEGA`/appliance draft lives as a FORM on a base species) the base
 * species + all its forms. Correctness comes from the per-target GATE on the
 * specific `grant` id in {@linkcode applyErTypeNativization}: no two entries
 * share a (base species, grant) pair with different replacements, so a form only
 * ever matches the one entry whose grant it carries.
 */
function resolveTargets(entry: TypeNativizationEntry): PokemonSpeciesForm[] {
  const targets = new Set<PokemonSpeciesForm>();
  collectSpeciesTargets(entry.species, targets);
  // Form-injected holders: reach the base species (the form's home).
  const base = entry.species.replace(/(_MEGA|_PRIMAL|_REDUX|_FUZZ)+$/, "");
  if (base !== entry.species) {
    collectSpeciesTargets(base, targets);
  }
  // Rotom appliance forms (SPECIES_ROTOM_<HEAT|WASH|...>) live on SPECIES_ROTOM.
  if (/^SPECIES_ROTOM_/.test(entry.species)) {
    collectSpeciesTargets("SPECIES_ROTOM", targets);
  }
  // Renamed redux mons whose live form lives on a vanilla base the const doesn't encode.
  if (entry.baseSpecies) {
    collectSpeciesTargets(entry.baseSpecies, targets);
  }
  return [...targets];
}

/**
 * Apply the whole type-nativization sweep to the live species tables. Fail-safe:
 * an unresolved species or an already-swapped grant is recorded, never thrown.
 * Idempotent. Call once, after `applyErPokedexOverrides`.
 */
export function applyErTypeNativization(): TypeNativizationResult {
  const result: TypeNativizationResult = { extraTypesSet: 0, abilitiesSwapped: 0, unresolved: [], notFound: [] };

  for (const entry of ER_TYPE_NATIVIZATION) {
    const targets = resolveTargets(entry);
    if (targets.length === 0) {
      result.unresolved.push(entry.species);
      continue;
    }
    let anySwapped = false;
    for (const target of targets) {
      // GATE: only touch a target that actually carries THIS entry's grant, so a
      // shared base species' other forms (a different holder's grant) are untouched.
      if (!holderHasAbility(target, entry.grant)) {
        continue;
      }
      addNativeType(target, entry.grantedType);
      result.extraTypesSet++;
      if (swapAbility(target, entry.grant, entry.replacement)) {
        result.abilitiesSwapped++;
        anySwapped = true;
      }
      if (entry.extraSwap && swapAbility(target, entry.extraSwap.from, entry.extraSwap.to)) {
        result.abilitiesSwapped++;
      }
    }
    if (!anySwapped) {
      result.notFound.push(entry.species);
    }
  }

  for (const swap of ER_ABILITY_SWAPS) {
    const targets = new Set<PokemonSpeciesForm>();
    collectSpeciesTargets(swap.species, targets);
    if (targets.size === 0) {
      result.unresolved.push(swap.species);
      continue;
    }
    let swapped = false;
    for (const target of targets) {
      if (swapAbility(target, swap.from, swap.to)) {
        result.abilitiesSwapped++;
        swapped = true;
      }
    }
    if (!swapped) {
      result.notFound.push(swap.species);
    }
  }

  return result;
}
