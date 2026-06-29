// =============================================================================
// Elite Redux — Phase B Task B5: register ER's mega evolutions, primal
// reversions, move-triggered megas, and gender-split level evolutions in a
// dedicated in-memory registry.
//
// Why a dedicated registry instead of `pokemonFormChanges`?
//
// Pokerogue treats megas/primals as FORM CHANGES on the source species —
// Mega Venusaur is form-key "mega" on `SpeciesId.VENUSAUR`, not a separate
// `SpeciesId.VENUSAUR_MEGA`. The trigger is a held item from a closed
// `FormChangeItem` enum (~70 entries: VENUSAURITE, BLUE_ORB, REVEAL_GLASS,
// MAX_MUSHROOMS, etc.) and the target form key comes from
// `SpeciesFormKey` (mega / mega-x / mega-y / primal / origin / etc.).
//
// ER models the same data structurally differently:
//   - Mega Venusaur is its OWN species (ER dump id 1501,
//     `SPECIES_VENUSAUR_MEGA`) registered separately in `allSpecies` as
//     pokerogue id ≥10000 (an ER custom).
//   - Mega stones are raw ER item id strings ("ITEM_VENUSAURITE",
//     "ITEM_VENUSAURITE_X", "ITEM_ABOMASITE_S", etc.) — ~284 distinct,
//     most of which have no `FormChangeItem` enum equivalent.
//   - The "form change" target is a different species ID, not a form key
//     on the same species.
//
// Wiring 287 megas + 18 primals into `pokemonFormChanges` would require:
//   (a) inventing ~230 new `FormChangeItem` enum values, or breaking the
//       item-trigger abstraction entirely (this is what B5 should avoid),
//   (b) fabricating `SpeciesFormKey` values for every ER mega target
//       species (mega-2nd, mega-z, etc.), and
//   (c) re-architecting the form-change path so the species swaps to a
//       wholly different species id at change time (today, form changes
//       only swap the form index on the same species).
//
// SOLUTION (B5 scope, mirroring B4): keep ER form changes in a SEPARATE
// registry keyed by source pokerogue species id. Each entry carries the
// kind (mega / primal / move-mega / level-gender), the canonical
// requirement (mega-stone item const, move const, or level string), and
// the resolved target species id. The battle layer reads from this
// registry when an ER-aware encounter fires — that wiring is deferred to
// Phase B7 / Phase C.
//
// =============================================================================
//
// DATA-LAYOUT NOTE (subtle but load-bearing):
//
// In the upstream v2.65 dump, `evolutions[*].in` is an INDEX into
// `dump.species[]`, NOT a species id. For vanilla mons (id ≤1068) the
// values coincide, but ER mega/primal targets sit at high indices (e.g.
// `SPECIES_VENUSAUR_MEGA` is dump.species[1119] with actual id 1501).
//
// The builder that produced `ER_SPECIES` preserves the dump's array order
// 1:1, so `ER_SPECIES[evo.into]` is the correct lookup. We then translate
// `ER_SPECIES[evo.into].id` (the actual species id) through `ER_ID_MAP.species`
// to get the pokerogue id.
//
// Caveats:
//   - The same dump-data ambiguity affects level evolutions too — but B5
//     focuses on form changes (mega/primal/move-mega). Level evolutions
//     are out of scope (pokerogue's evolution system already covers them
//     for vanilla, and ER-customs aren't yet wired into the evolution
//     registry — deferred to a later phase).
//   - Out-of-range / negative `evo.into` values are skipped as drift.
//
// =============================================================================

import { allSpecies } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MEGA_FORMS } from "#data/elite-redux/er-mega-forms";
import { resolveErStoneFormChangeItem } from "#data/elite-redux/er-mega-stones";
import { ER_SPECIES, type ErEvolutionDraft } from "#data/elite-redux/er-species";
import { pokemonFormChanges, SpeciesFormChange } from "#data/pokemon-forms";
import { SpeciesFormChangeItemTrigger } from "#data/pokemon-forms/form-change-triggers";
import { FormChangeItem } from "#enums/form-change-item";
import { SpeciesFormKey } from "#enums/species-form-key";

/**
 * Decoded form-change kind. Mirrors the `evoKindT` table from the v2.65
 * dump. Only the subset relevant to form changes is enumerated here —
 * level evolutions (kind 0 / 3 / 4) are tagged `LEVEL` and routed to a
 * separate registry (gender-split level evos), and the unknown sentinel
 * catches any future dump entries we don't recognize.
 */
export const ER_FORM_CHANGE_KIND = {
  /** Standard level-up evolution (kind 0). Not a form change. */
  LEVEL: "level",
  /** Mega evolution via held mega stone (kind 1, ~287 entries). */
  MEGA: "mega",
  /** Primal reversion via held orb (kind 2, ~18 entries). */
  PRIMAL: "primal",
  /** Gender-locked level evolution — male (kind 3, ~15 entries). */
  LEVEL_MALE: "level-male",
  /** Gender-locked level evolution — female (kind 4, ~15 entries). */
  LEVEL_FEMALE: "level-female",
  /** Mega triggered by holding a specific move (kind 5, Rayquaza only). */
  MOVE_MEGA: "move-mega",
  /** Sentinel for unrecognized dump entries. */
  UNKNOWN: "unknown",
} as const;

export type ErFormChangeKindLabel = (typeof ER_FORM_CHANGE_KIND)[keyof typeof ER_FORM_CHANGE_KIND];

/**
 * Raw numeric → label table for the v2.65 evoKindT enum. Used at
 * registration time to tag each entry's `kind`.
 *
 * Mirrors `vendor/elite-redux/v2.65beta.json` `evoKindT`:
 *   0: EVO_LEVEL                    → LEVEL
 *   1: EVO_MEGA_EVOLUTION           → MEGA
 *   2: EVO_PRIMAL_REVERSION         → PRIMAL
 *   3: EVO_LEVEL_MALE               → LEVEL_MALE
 *   4: EVO_LEVEL_FEMALE             → LEVEL_FEMALE
 *   5: EVO_MOVE_MEGA_EVOLUTION      → MOVE_MEGA
 */
const KIND_BY_NUMERIC: readonly ErFormChangeKindLabel[] = [
  ER_FORM_CHANGE_KIND.LEVEL,
  ER_FORM_CHANGE_KIND.MEGA,
  ER_FORM_CHANGE_KIND.PRIMAL,
  ER_FORM_CHANGE_KIND.LEVEL_MALE,
  ER_FORM_CHANGE_KIND.LEVEL_FEMALE,
  ER_FORM_CHANGE_KIND.MOVE_MEGA,
];

function decodeKind(raw: number): ErFormChangeKindLabel {
  return KIND_BY_NUMERIC[raw] ?? ER_FORM_CHANGE_KIND.UNKNOWN;
}

/** Numeric `kind` values that represent FORM CHANGES (not species-level evos). */
const FORM_CHANGE_KIND_LABELS: ReadonlySet<ErFormChangeKindLabel> = new Set([
  ER_FORM_CHANGE_KIND.MEGA,
  ER_FORM_CHANGE_KIND.PRIMAL,
  ER_FORM_CHANGE_KIND.MOVE_MEGA,
]);

/**
 * One ER form change with all id translations applied. Both
 * `sourceSpeciesId` and `targetSpeciesId` are pokerogue ids (vanilla
 * < 10000, ER-custom ≥ 10000).
 *
 * `requirement` is the canonical trigger string from ER's dump:
 *   - For MEGA / PRIMAL kinds: an ITEM_* constant ("ITEM_VENUSAURITE",
 *     "ITEM_BLUE_ORB", "ITEM_SNORLAX_ORB", etc.).
 *   - For MOVE_MEGA kind: a MOVE_* constant ("MOVE_DRAGON_ASCENT").
 *
 * The requirement is NOT mapped to pokerogue's `FormChangeItem` /
 * `MoveId` enums at this layer — most ER mega-stone items don't have
 * pokerogue equivalents. Downstream consumers (Phase B7/C) decide how to
 * surface the trigger to the player (e.g. fabricate a virtual item, gate
 * on session-flag, etc.).
 */
export interface ErFormChangeRegistryEntry {
  /** Pokerogue species id of the source mon (e.g. SpeciesId.VENUSAUR = 3). */
  readonly sourceSpeciesId: number;
  /** Pokerogue species id of the target form mon (typically an ER-custom ≥ 10000). */
  readonly targetSpeciesId: number;
  /** Decoded kind label (mega / primal / move-mega). */
  readonly kind: ErFormChangeKindLabel;
  /** Raw `kind` value as it appears in the v2.65 dump (0-5). */
  readonly kindNumeric: number;
  /** Trigger: ITEM_* const (MEGA/PRIMAL), MOVE_* const (MOVE_MEGA). */
  readonly requirement: string;
  /** Source species const name from the ER dump (for diagnostics / lookup). */
  readonly sourceSpeciesConst: string;
  /** Target species const name from the ER dump (for diagnostics / lookup). */
  readonly targetSpeciesConst: string;
}

/**
 * Per-call summary of `initEliteReduxFormChanges()`. Mirrors the shape of
 * earlier B-phase initializers.
 */
export interface InitEliteReduxFormChangesResult {
  /** Number of MEGA-kind entries newly inserted on this call. */
  megaRegistered: number;
  /** Number of PRIMAL-kind entries newly inserted on this call. */
  primalRegistered: number;
  /** Number of MOVE_MEGA-kind entries newly inserted on this call. */
  moveMegaRegistered: number;
  /**
   * Total form-change entries newly inserted (mega + primal + move-mega).
   * Convenience alias mirroring the B4 `trainersRegistered` field name.
   */
  formChangesRegistered: number;
  /**
   * Entries skipped because their `(source, target, requirement)` triple is
   * already in the registry (idempotent re-run path).
   */
  skipped: number;
  /**
   * Entries dropped because either the source or target species id has no
   * `ER_ID_MAP.species` entry, OR `evo.into` is out of range for
   * `ER_SPECIES`. Pre-existing ER-data drift — counted separately from
   * `errors` so the test surface stays stable as the dump evolves.
   *
   * TODO(infra): triage the missing-species set with the ER source dumps
   * and extend `er-species.ts` / `er-id-map.ts` upstream to cover the gap.
   */
  droppedMissingSpecies: number;
  /** Non-fatal real issues (currently unused — kept for symmetry with B4). */
  errors: string[];
}

/**
 * In-memory registry of all ER form changes (mega + primal + move-mega).
 * Populated by `initEliteReduxFormChanges()`. Insertion-ordered: each
 * source species' edges appear in the same order as in the v2.65 dump.
 * Consumers should treat this as read-only after initialization completes.
 */
export const ER_FORM_CHANGE_REGISTRY: ErFormChangeRegistryEntry[] = [];

/**
 * O(1) lookup of form-change entries by source pokerogue species id.
 * Multiple entries can share a source (e.g. Venusaur has MEGA + MEGA_X
 * via two different stones). Insertion-ordered within each bucket.
 */
export const ER_FORM_CHANGES_BY_SOURCE: Map<number, ErFormChangeRegistryEntry[]> = new Map();

/**
 * Internal de-duplication index. Key shape:
 *   `${sourceSpeciesId}|${targetSpeciesId}|${requirement}`
 * A (source, target, requirement) triple is unique enough — ER never
 * ships two distinct form changes that share all three.
 */
const SEEN_KEYS: Set<string> = new Set();

/**
 * Build the ER form-change registry. Idempotent — entries already present
 * in the registry (deduped by `(source, target, requirement)`) are
 * silently skipped on re-run.
 *
 * Pipeline per ER species:
 *   1. Resolve source pokerogue id via `ER_ID_MAP.species[draft.id]`. If
 *      missing → skip the whole species' form changes (data drift).
 *   2. For each evolution edge:
 *      a. Decode `kind` via `KIND_BY_NUMERIC`.
 *      b. Skip non-form-change kinds (level / level-gender) — those are
 *         out of scope for B5.
 *      c. Resolve target via `ER_SPECIES[evo.into]` → look up
 *         `ER_ID_MAP.species[targetSpecies.id]`. Drift → drop.
 *      d. Build registry entry; dedupe; push to array + per-source map.
 *
 * @returns A summary of entries registered, skipped, and any errors.
 */
export function initEliteReduxFormChanges(): InitEliteReduxFormChangesResult {
  const result: InitEliteReduxFormChangesResult = {
    megaRegistered: 0,
    primalRegistered: 0,
    moveMegaRegistered: 0,
    formChangesRegistered: 0,
    skipped: 0,
    droppedMissingSpecies: 0,
    errors: [],
  };

  for (const draft of ER_SPECIES) {
    if (draft.evolutions.length === 0) {
      continue;
    }
    const sourceSpeciesId = ER_ID_MAP.species[draft.id];
    if (sourceSpeciesId === undefined) {
      // Source species has no pokerogue mapping — drift. Drop all of its
      // form changes in one shot.
      for (const evo of draft.evolutions) {
        if (FORM_CHANGE_KIND_LABELS.has(decodeKind(evo.kind))) {
          result.droppedMissingSpecies++;
        }
      }
      continue;
    }

    for (const evo of draft.evolutions) {
      const kind = decodeKind(evo.kind);
      if (!FORM_CHANGE_KIND_LABELS.has(kind)) {
        // Level / level-gender / unknown — out of scope for B5.
        continue;
      }
      const entry = tryBuildEntry(draft.id, draft.speciesConst, sourceSpeciesId, evo, kind);
      if (entry === null) {
        result.droppedMissingSpecies++;
        continue;
      }
      const dedupeKey = `${entry.sourceSpeciesId}|${entry.targetSpeciesId}|${entry.requirement}`;
      if (SEEN_KEYS.has(dedupeKey)) {
        result.skipped++;
        continue;
      }
      SEEN_KEYS.add(dedupeKey);
      ER_FORM_CHANGE_REGISTRY.push(entry);
      pushToBucket(entry);
      bumpKindCounter(result, kind);
      result.formChangesRegistered++;

      // Bridge into pokerogue's `pokemonFormChanges` so the dex Evolutions
      // menu picks up the form change. The Phase B1a form-injection step
      // ensures the corresponding `SpeciesFormKey` form exists on the
      // source species (e.g. Meganium has a "mega" formKey injected). The
      // trigger here uses FormChangeItem.NONE since ER's mega-stone items
      // (~284 of them) mostly have no FormChangeItem enum equivalent —
      // the registry above still carries the authoritative requirement
      // string for battle-layer use.
      bridgeEntryToPokerogueFormChanges(entry);
    }
  }

  return result;
}

/**
 * Map an ER target species-const suffix to the pokerogue `SpeciesFormKey`
 * value the form-injection step seeds onto the source species. Returns
 * `null` for targets that don't match any known suffix — those stay in
 * the ER-only registry but won't surface in the dex Evolutions menu.
 */
function targetFormKey(targetSpeciesConst: string, sourceSpeciesConst: string): string | null {
  if (!targetSpeciesConst.startsWith(`${sourceSpeciesConst}_`)) {
    return null;
  }
  const suffix = targetSpeciesConst.slice(sourceSpeciesConst.length);
  // Order matters — longest match wins (e.g. "_MEGA_X" before "_MEGA").
  if (suffix === "_MEGA_X" || suffix === "_MEGA_X_REDUX") {
    return SpeciesFormKey.MEGA_X;
  }
  if (suffix === "_MEGA_Y" || suffix === "_MEGA_Y_REDUX") {
    return SpeciesFormKey.MEGA_Y;
  }
  if (suffix === "_PRIMAL" || suffix === "_PRIMAL_REDUX") {
    return SpeciesFormKey.PRIMAL;
  }
  if (suffix === "_ORIGIN" || suffix === "_ORIGIN_REDUX") {
    return SpeciesFormKey.ORIGIN;
  }
  if (suffix === "_MEGA" || suffix === "_MEGA_REDUX" || suffix === "_REDUX_MEGA") {
    return SpeciesFormKey.MEGA;
  }
  return null;
}

/**
 * Form-change TARGETS that exist only for boss encounters and must never be
 * obtainable by players. No player-facing item edge is bridged for these, so
 * their stones never enter the reward pool. (#351: the Purple Orb was being
 * offered to a party Cascoon, letting players unlock PRIMAL CASCOON — the
 * Elite/Hell final boss form.)
 */
const BOSS_ONLY_FORM_TARGETS: ReadonlySet<string> = new Set(["SPECIES_CASCOON_PRIMAL"]);

/**
 * Source species whose ER mega/primal resting form is reached through the TERA
 * mechanic, NOT a held mega stone. The player's "Tera Orb" is a run-wide
 * {@linkcode TerastallizeAccessModifier} (the Tera-button unlock), not a held
 * {@linkcode PokemonFormChangeItemModifier}, so the generic item-trigger edge
 * the bridge would push is permanently dead — it also COLLIDES with the
 * authoritative Tera-driven edge defined in `pokemon-forms.ts` (a second base→form
 * path plus a bogus revert entry auto-generated by `initPokemonForms()`). Their
 * forward change is wired by a `SpeciesFormChangeTeraTrigger` edge instead, fired
 * from `TeraPhase.end`, so the bridge must skip them entirely.
 *
 * Currently only Terapagos: base "" → "primal" on Terastallize (the maintainer's
 * permanent-Primal model, chosen over the vanilla transient Stellar chain).
 */
const TERA_DRIVEN_FORM_SOURCES: ReadonlySet<string> = new Set(["SPECIES_TERAPAGOS"]);

/**
 * AUTHORITATIVE (source, target) → injected formKey map, built from
 * ER_MEGA_FORMS — the same data the form-injection step uses. #359: the bridge
 * used to GUESS the form key from the target's name suffix, which broke two
 * ways: (a) for multi-mega species the suffix said "mega" while the injected
 * form is "mega-y" (the guess then collided with vanilla's "mega" edge and the
 * real form never got an edge — the #318 "second mega unreachable" class), and
 * (b) for regional/cap/style megas (alola-mega, galar-mega, hisui-mega,
 * Pikachu caps, Oricorio styles, …) it registered edges pointing at forms that
 * don't exist. Keying by the SAME pair the injector used removes the guesswork.
 */
let formKeyByPair: Map<string, string> | null = null;

function authoritativeFormKey(sourceConst: string, targetConst: string): string | null {
  if (formKeyByPair === null) {
    const constByErId = new Map(ER_SPECIES.map(d => [d.id, d.speciesConst]));
    formKeyByPair = new Map();
    for (const e of ER_MEGA_FORMS) {
      const s = constByErId.get(e.baseErId);
      const t = constByErId.get(e.targetErId);
      if (s && t) {
        formKeyByPair.set(`${s}>${t}`, e.formKey);
      }
    }
  }
  return formKeyByPair.get(`${sourceConst}>${targetConst}`) ?? null;
}

/** Lazy species-by-id view for the does-this-form-exist guard. */
let speciesByIdCache: Map<number, (typeof allSpecies)[number]> | null = null;
function speciesById(id: number): (typeof allSpecies)[number] | undefined {
  if (speciesByIdCache === null) {
    speciesByIdCache = new Map(allSpecies.map(s => [s.speciesId as number, s]));
  }
  return speciesByIdCache.get(id);
}

/**
 * Push a `SpeciesFormChange` into pokerogue's `pokemonFormChanges` table
 * so the source species's dex page surfaces the mega/primal in its
 * Evolutions menu.
 */
function bridgeEntryToPokerogueFormChanges(entry: ErFormChangeRegistryEntry): void {
  // BOSS-ONLY forms must never get a player-facing ITEM edge: bridging one puts
  // its stone into the reward pool (a party Cascoon offered the Purple Orb →
  // players could field PRIMAL CASCOON, the Elite/Hell final boss). The boss's
  // own transform uses a separate MANUAL-trigger edge (er-final-boss.ts), so
  // skipping here does not affect the boss fight.
  if (BOSS_ONLY_FORM_TARGETS.has(entry.targetSpeciesConst)) {
    return;
  }
  // TERA-driven resting forms (Terapagos → Primal) are wired by a Tera-trigger
  // edge in pokemon-forms.ts, not a held mega stone. Skip them so the dead/
  // colliding item edge (and its auto-generated revert) is never registered.
  if (TERA_DRIVEN_FORM_SOURCES.has(entry.sourceSpeciesConst)) {
    return;
  }
  // Authoritative form key first (same data the injector used); the legacy
  // suffix derivation only as fallback for pairs ER_MEGA_FORMS doesn't carry.
  const formKey =
    authoritativeFormKey(entry.sourceSpeciesConst, entry.targetSpeciesConst)
    ?? targetFormKey(entry.targetSpeciesConst, entry.sourceSpeciesConst);
  if (formKey === null) {
    return;
  }
  // Never register an edge to a form that does not actually exist on the
  // source species — such an edge would offer a stone that can't transform.
  const source = speciesById(entry.sourceSpeciesId);
  if (!source || !source.forms.some(f => f.formKey === formKey)) {
    return;
  }
  // Use the real mega/primal stone as the trigger (vanilla FormChangeItem where
  // the name matches, else the ER-custom enum value) so the reward pool offers
  // it and holding it triggers the base mon's mega form. Falls back to NONE only
  // for stones the enum doesn't know (dex-display only, as before).
  const stone = resolveErStoneFormChangeItem((entry as { requirement?: string }).requirement) ?? FormChangeItem.NONE;
  const change = new SpeciesFormChange(
    entry.sourceSpeciesId,
    "", // preFormKey: from base form
    formKey,
    new SpeciesFormChangeItemTrigger(stone),
  );
  if (!pokemonFormChanges[entry.sourceSpeciesId]) {
    pokemonFormChanges[entry.sourceSpeciesId] = [];
  }
  // Update-or-push (#359): if a same-(preFormKey, formKey) ITEM edge already
  // exists — typically a VANILLA edge — and ER's authoritative stone differs,
  // REPLACE it. Example: ER re-stats Lucario's vanilla "mega" form as Mega Z
  // (stone LUCARIONITE_Z) and gives Mega X the plain LUCARIONITE; the stale
  // vanilla mega←LUCARIONITE edge would otherwise collide with Mega X's stone
  // and leave Mega Z unreachable. Non-item edges (manual/ability triggers) are
  // left untouched.
  const list = pokemonFormChanges[entry.sourceSpeciesId] as SpeciesFormChange[];
  const existingIdx = list.findIndex(
    fc => fc.preFormKey === "" && fc.formKey === formKey && fc.findTrigger(SpeciesFormChangeItemTrigger),
  );
  if (existingIdx >= 0) {
    const existingTrigger = list[existingIdx].findTrigger(SpeciesFormChangeItemTrigger) as
      | { item?: FormChangeItem }
      | undefined;
    if (stone !== FormChangeItem.NONE && existingTrigger?.item !== stone) {
      list[existingIdx] = change; // ER stone is authoritative
    }
    return;
  }
  // No ITEM edge for this form yet — push ours. Non-item edges (manual/ability
  // triggers, e.g. the Eternatus boss transform) may coexist, mirroring
  // vanilla's manual+item Eternamax pattern.
  list.push(change);
}

/**
 * Resolve one ER evolution edge into a registry entry, or `null` if the
 * target species can't be resolved (drift). Throws are reserved for
 * programmer errors — id-map / data-shape failures degrade gracefully.
 */
function tryBuildEntry(
  sourceErId: number,
  sourceSpeciesConst: string,
  sourceSpeciesId: number,
  evo: ErEvolutionDraft,
  kind: ErFormChangeKindLabel,
): ErFormChangeRegistryEntry | null {
  // `evo.into` is an array INDEX into the dump's `species[]`, mirrored
  // into `ER_SPECIES`. See file header for the rationale.
  if (evo.into < 0 || evo.into >= ER_SPECIES.length) {
    return null;
  }
  const targetDraft = ER_SPECIES[evo.into];
  if (!targetDraft) {
    return null;
  }
  const targetSpeciesId = ER_ID_MAP.species[targetDraft.id];
  if (targetSpeciesId === undefined) {
    return null;
  }
  // sourceErId is captured for symmetry with other initializers' error
  // messages even though we don't currently surface it on the entry. The
  // entry's `sourceSpeciesConst` already uniquely identifies the source.
  void sourceErId;
  return {
    sourceSpeciesId,
    targetSpeciesId,
    kind,
    kindNumeric: evo.kind,
    requirement: evo.requirement,
    sourceSpeciesConst,
    targetSpeciesConst: targetDraft.speciesConst,
  };
}

function pushToBucket(entry: ErFormChangeRegistryEntry): void {
  const bucket = ER_FORM_CHANGES_BY_SOURCE.get(entry.sourceSpeciesId);
  if (bucket === undefined) {
    ER_FORM_CHANGES_BY_SOURCE.set(entry.sourceSpeciesId, [entry]);
  } else {
    bucket.push(entry);
  }
}

function bumpKindCounter(result: InitEliteReduxFormChangesResult, kind: ErFormChangeKindLabel): void {
  if (kind === ER_FORM_CHANGE_KIND.MEGA) {
    result.megaRegistered++;
  } else if (kind === ER_FORM_CHANGE_KIND.PRIMAL) {
    result.primalRegistered++;
  } else if (kind === ER_FORM_CHANGE_KIND.MOVE_MEGA) {
    result.moveMegaRegistered++;
  }
}
