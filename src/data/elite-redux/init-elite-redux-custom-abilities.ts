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

import { type AbAttr, ConditionalCritAbAttr, PostFaintAbAttr, RedirectTypeMoveAbAttr } from "#abilities/ab-attrs";
import { AbBuilder, type Ability } from "#abilities/ability";
import { allAbilities, allMoves } from "#data/data-lists";
import { BadSpliceAbAttr, ER_BAD_SPLICE_ABILITY_ID } from "#data/elite-redux/abilities/bad-splice";
import {
  BorrowedTimeDecayAbAttr,
  BorrowedTimeSummonAbAttr,
  ER_BORROWED_TIME_ABILITY_ID,
} from "#data/elite-redux/abilities/borrowed-time";
import { ChivalryAbAttr, ER_CHIVALRY_ABILITY_ID } from "#data/elite-redux/abilities/chivalry";
import { CleansingLightAbAttr, ER_CLEANSING_LIGHT_ABILITY_ID } from "#data/elite-redux/abilities/cleansing-light";
import { CommonRootAbAttr, ER_COMMON_ROOT_ABILITY_ID } from "#data/elite-redux/abilities/common-root";
import { MANUAL_COMPOSITE_PARTS } from "#data/elite-redux/abilities/composite-newcomers";
import {
  CrosscutPowerAbAttr,
  CrosscutSecondStrikeAbAttr,
  ER_CROSSCUT_ABILITY_ID,
} from "#data/elite-redux/abilities/crosscut";
import { DandelionBurstAbAttr, ER_DANDELION_BURST_ABILITY_ID } from "#data/elite-redux/abilities/dandelion-burst";
import { DraconicVoodooAbAttr, ER_DRACONIC_VOODOO_ABILITY_ID } from "#data/elite-redux/abilities/draconic-voodoo";
import {
  CapacitorBankAbsorbAbAttr,
  CapacitorBankGainAbAttr,
  ER_CAPACITOR_BANK_ABILITY_ID,
  ER_FAULT_CURRENT_ABILITY_ID,
  ER_OVERLOADED_ABILITY_ID,
  FaultCurrentAbAttr,
  OverloadedChipAbAttr,
  OverloadedPowerAbAttr,
  OverloadedPriorityAbAttr,
} from "#data/elite-redux/abilities/electivire";
import { ER_GENESIS_SUPERNOVA_ABILITY_ID, GenesisSupernovaAbAttr } from "#data/elite-redux/abilities/genesis-supernova";
import { ER_HEARTBREAK_ABILITY_ID, HeartbreakAbAttr } from "#data/elite-redux/abilities/heartbreak";
import { ER_HYDRAPEX_ABILITY_ID, HydrapexAbAttr } from "#data/elite-redux/abilities/hydrapex";
import { ER_KNIGHTS_HONOR_ABILITY_ID, knightsHonorAttrs } from "#data/elite-redux/abilities/knights-honor";
import { ER_LAST_HOST_ABILITY_ID, LastHostAbAttr } from "#data/elite-redux/abilities/last-host";
import { ER_LIBRARY_ABILITY_ID, LibraryAbAttr } from "#data/elite-redux/abilities/library";
import { ER_LIFE_PRESERVER_ABILITY_ID, LifePreserverAbAttr } from "#data/elite-redux/abilities/life-preserver";
import { ER_MYCELIAL_NETWORK_ABILITY_ID, MycelialNetworkAbAttr } from "#data/elite-redux/abilities/mycelial-network";
import { ER_OMNIFORM_ABILITY_ID, OmniformAbAttr } from "#data/elite-redux/abilities/omniform";
import {
  ClosedCircuitAbAttr,
  ER_CLOSED_CIRCUIT_ABILITY_ID,
  ER_NEGATIVE_FEEDBACK_ABILITY_ID,
  ER_POSITIVE_FEEDBACK_ABILITY_ID,
  ER_SYNCHRONIZED_CURRENT_ABILITY_ID,
  NegativeFeedbackAbAttr,
  PositiveFeedbackAbAttr,
  PositiveFeedbackPowerAbAttr,
  SynchronizedCurrentAbAttr,
} from "#data/elite-redux/abilities/plusle-minun";
import { ER_PRESSURE_VESSEL_ABILITY_ID, PressureVesselAbAttr } from "#data/elite-redux/abilities/pressure-vessel";
import { ER_PUPPET_STRINGS_ABILITY_ID, PuppetStringsAbAttr } from "#data/elite-redux/abilities/puppet-strings";
import { ER_QUICKENING_GRACE_ABILITY_ID, QuickeningGraceAbAttr } from "#data/elite-redux/abilities/quickening-grace";
import { ER_RAIN_PUMP_ABILITY_ID, RainPumpAbAttr } from "#data/elite-redux/abilities/rain-pump";
import {
  ER_RELATIVITY_ABILITY_ID,
  RelativityAbAttr,
  RelativityDefenseReductionAbAttr,
} from "#data/elite-redux/abilities/relativity";
import { ER_RENDEZVOUS_ABILITY_ID, RendezvousAbAttr } from "#data/elite-redux/abilities/rendezvous";
import { ER_SILKEN_DECREE_ABILITY_ID, SilkenDecreeAbAttr } from "#data/elite-redux/abilities/silken-decree";
import { ER_SOULMATE_ABILITY_ID, SoulmateAbAttr } from "#data/elite-redux/abilities/soulmate";
import { ER_SPORE_BED_ABILITY_ID } from "#data/elite-redux/abilities/spore-bed";
import { ER_TANGLED_SEED_ABILITY_ID, TangledSeedAbAttr } from "#data/elite-redux/abilities/tangled-seed";
import {
  ER_WORLD_IN_PIECES_ABILITY_ID,
  WorldInPiecesRemoveTypeAbAttr,
  WorldInPiecesRestoreAbAttr,
  WorldInPiecesSpeedAbAttr,
  WorldInPiecesSummonAbAttr,
} from "#data/elite-redux/abilities/world-in-pieces";
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
    {
      draft: {
        id: ER_LIFE_PRESERVER_ABILITY_ID,
        name: "Life Preserver",
        description:
          "Once per battle, when this Pokemon's ally would faint from a direct attack, the ally survives at 1 HP and the attacker becomes Drenched. Water-type attackers are unaffected.",
        archetype: "unknown",
      },
      pokerogueId: ER_LIFE_PRESERVER_ABILITY_ID,
    },
    {
      draft: {
        id: ER_RELATIVITY_ABILITY_ID,
        name: "Relativity",
        description:
          "When this Pokemon acts before its target, its damaging moves use its Speed instead of Attack or Sp. Atk. When it acts after its target, it takes 25% less damage from that target. Based on move order, not speed.",
        archetype: "unknown",
      },
      pokerogueId: ER_RELATIVITY_ABILITY_ID,
    },
    {
      draft: {
        id: ER_BORROWED_TIME_ABILITY_ID,
        name: "Borrowed Time",
        description:
          "On entry, this Pokemon swaps its raw Speed with the fastest opposing Pokemon for 3 turns. Each turn, one third of the original difference returns to each side until both are back to normal.",
        archetype: "unknown",
      },
      pokerogueId: ER_BORROWED_TIME_ABILITY_ID,
    },
    {
      draft: {
        id: ER_CROSSCUT_ABILITY_ID,
        name: "Crosscut",
        description:
          "This Pokemon's single-hit slicing and pulse moves strike twice at 70% power each: once with the move's own category and once with the opposite, using the matching offense and defense. Multi-hit moves are unaffected.",
        archetype: "unknown",
      },
      pokerogueId: ER_CROSSCUT_ABILITY_ID,
    },
    {
      draft: {
        id: ER_CHIVALRY_ABILITY_ID,
        name: "Chivalry",
        description:
          "In doubles, this Pokemon takes 50% of the direct damage aimed at its ally as a raw, unmitigated hit. In singles, when it voluntarily switches out, the incoming Pokemon sends 25% of the direct damage it takes to the off-field holder until the end of its next turn.",
        archetype: "unknown",
      },
      pokerogueId: ER_CHIVALRY_ABILITY_ID,
    },
    {
      draft: {
        id: ER_WORLD_IN_PIECES_ABILITY_ID,
        name: "World in Pieces",
        description:
          "This Pokemon is Normal/Rock/Ice/Steel/Electric/Dragon. The first direct hit each turn strips one non-Normal type after it lands; each missing type grants +20% Speed. Every KO it scores restores one type.",
        archetype: "unknown",
      },
      pokerogueId: ER_WORLD_IN_PIECES_ABILITY_ID,
    },
    {
      draft: {
        id: ER_SOULMATE_ABILITY_ID,
        name: "Soulmate",
        description:
          "On entry this Pokemon links to a nearby ally. 25% of the direct damage the linked ally takes is redirected to this Pokemon as raw HP, and 50% of the direct healing this Pokemon receives is copied to the linked ally.",
        archetype: "unknown",
      },
      pokerogueId: ER_SOULMATE_ABILITY_ID,
    },
    {
      draft: {
        id: ER_RENDEZVOUS_ABILITY_ID,
        name: "Rendezvous",
        description:
          "On entry this Pokemon links to a nearby ally. If both linked Pokemon target the same opponent in one turn, the second move dealt gains 20% power and both restore 5% of their max HP.",
        archetype: "unknown",
      },
      pokerogueId: ER_RENDEZVOUS_ABILITY_ID,
    },
    {
      draft: {
        id: ER_HEARTBREAK_ABILITY_ID,
        name: "Heartbreak",
        description:
          "On entry this Pokemon links to a nearby ally. When that ally faints, this Pokemon gains +1 Speed and +1 in its higher attacking stat, and loses 1 stage of Defense and Sp. Def.",
        archetype: "unknown",
      },
      pokerogueId: ER_HEARTBREAK_ABILITY_ID,
    },
    {
      draft: {
        id: ER_SYNCHRONIZED_CURRENT_ABILITY_ID,
        name: "Synchronized Current",
        description:
          "If this Pokemon and an allied Plus- or Minus-aligned Pokemon both damage the same target in one turn, that target is paralyzed after both attacks resolve. Normal paralysis immunities apply.",
        archetype: "unknown",
      },
      pokerogueId: ER_SYNCHRONIZED_CURRENT_ABILITY_ID,
    },
    {
      draft: {
        id: ER_POSITIVE_FEEDBACK_ABILITY_ID,
        name: "Positive Feedback",
        description:
          "When this Pokemon damages a paralyzed target, it consumes the paralysis, the attack gains 25% power, and the target's higher defensive stat drops one stage.",
        archetype: "unknown",
      },
      pokerogueId: ER_POSITIVE_FEEDBACK_ABILITY_ID,
    },
    {
      draft: {
        id: ER_NEGATIVE_FEEDBACK_ABILITY_ID,
        name: "Negative Feedback",
        description:
          "When this Pokemon damages a paralyzed target, it consumes the paralysis, gains +1 Speed, suppresses one of the target's held items until the end of the following turn, and its own next physical move becomes Electric/Fairy dual-type.",
        archetype: "unknown",
      },
      pokerogueId: ER_NEGATIVE_FEEDBACK_ABILITY_ID,
    },
    {
      draft: {
        id: ER_CLOSED_CIRCUIT_ABILITY_ID,
        name: "Closed Circuit",
        description:
          "If this Pokemon and an ally target the same opponent in one turn, whichever acts second launches an extra 25-power Electric/Fairy attack at that opponent after both moves resolve.",
        archetype: "unknown",
      },
      pokerogueId: ER_CLOSED_CIRCUIT_ABILITY_ID,
    },
    {
      draft: {
        id: ER_CAPACITOR_BANK_ABILITY_ID,
        name: "Capacitor Bank",
        description:
          "This Pokemon builds up to 4 charges: +1 when it lands an attack, +1 when it is hit by a damaging move, and it absorbs Electric moves for +1 (redirecting them to itself in doubles). Its own Electric moves spend one charge each. Multi-hit moves grant one charge.",
        archetype: "unknown",
      },
      pokerogueId: ER_CAPACITOR_BANK_ABILITY_ID,
    },
    {
      draft: {
        id: ER_FAULT_CURRENT_ABILITY_ID,
        name: "Fault Current",
        description:
          "Every second turn this Pokemon stays on the field, it discharges all of its charges as a spread Electric attack on all opponents, dealing 15 power per charge spent. The counter resets when it switches out.",
        archetype: "unknown",
      },
      pokerogueId: ER_FAULT_CURRENT_ABILITY_ID,
    },
    {
      draft: {
        id: ER_OVERLOADED_ABILITY_ID,
        name: "Overloaded",
        description:
          "While at 4 charges, this Pokemon's Electric moves gain 25% power and +1 priority and it cannot switch out. If it ends a turn still at 4 charges, it loses 1/8 of its max HP.",
        archetype: "unknown",
      },
      pokerogueId: ER_OVERLOADED_ABILITY_ID,
    },
    {
      draft: {
        id: ER_LIBRARY_ABILITY_ID,
        name: "Library",
        description:
          "The first move each opposing Pokemon uses is recorded (up to 3, newest kept). A repeated recorded move deals 15% less damage to this Pokemon's side. From the fight menu this Pokemon can cast recorded moves, twice per battle total, using its Sp. Atk.",
        archetype: "unknown",
      },
      pokerogueId: ER_LIBRARY_ABILITY_ID,
    },
    {
      draft: {
        id: ER_OMNIFORM_ABILITY_ID,
        name: "Omniform",
        description:
          "When this Pokemon uses a move whose type is mapped for its current form, it adapts mega-style into the mapped form before the move resolves: its stats and speed are recalculated and its other moves are replaced by the new form's set. The transform can chain and reverts after battle.",
        archetype: "unknown",
      },
      pokerogueId: ER_OMNIFORM_ABILITY_ID,
    },
    {
      draft: {
        id: ER_DRACONIC_VOODOO_ABILITY_ID,
        name: "Draconic Voodoo",
        description:
          "On entry, the opposing Pokemon directly across gains Dragon as an additional type for the rest of the battle. Whenever this Pokemon damages a target with a biting or Dragon-type move, that target also gains Dragon. Never removes existing types.",
        archetype: "unknown",
      },
      pokerogueId: ER_DRACONIC_VOODOO_ABILITY_ID,
    },
    {
      draft: {
        id: ER_HYDRAPEX_ABILITY_ID,
        name: "Hydrapex",
        description:
          "When this Pokemon uses a single-target biting or Dragon-type move, two side heads each strike another Dragon-typed opponent at 35% power with no added effects. Inert when no other Dragon-typed opponent is present.",
        archetype: "unknown",
      },
      pokerogueId: ER_HYDRAPEX_ABILITY_ID,
    },
    {
      draft: {
        id: ER_BAD_SPLICE_ABILITY_ID,
        name: "Bad Splice",
        description:
          "While this Pokemon is active, each opposing Pokemon is spliced with the types of one random living member of its own party, gaining them as additional types. The splice is removed when this Pokemon leaves the field.",
        archetype: "unknown",
      },
      pokerogueId: ER_BAD_SPLICE_ABILITY_ID,
    },
    // Newcomer-patch bespoke abilities (composites are registered below from
    // MANUAL_COMPOSITE_PARTS; their attrs are filled by
    // wireEliteReduxManualComposites in a post-init pass).
    {
      draft: {
        id: ER_GENESIS_SUPERNOVA_ABILITY_ID,
        name: "Genesis Supernova",
        description: "This Pokemon's Psychic-type moves summon Psychic Terrain.",
        archetype: "unknown",
      },
      pokerogueId: ER_GENESIS_SUPERNOVA_ABILITY_ID,
    },
    {
      draft: {
        id: ER_KNIGHTS_HONOR_ABILITY_ID,
        name: "Knight's Honor",
        description: "Lowering any stats on its side raises Def and Sp. Def.",
        archetype: "unknown",
      },
      pokerogueId: ER_KNIGHTS_HONOR_ABILITY_ID,
    },
  ];
  // Newcomer-patch composite abilities (5933+). Registered as placeholders here
  // (the ability instance + AbilityId reverse-map key + verbatim description);
  // their constituent AbAttrs are attached later by
  // wireEliteReduxManualComposites (init.ts, after the composite refresh) so
  // every constituent — ER-custom and rebalance-patched vanilla — is final.
  for (const def of Object.values(MANUAL_COMPOSITE_PARTS)) {
    manualDrafts.push({
      draft: { id: def.id, name: def.name, description: def.description, archetype: "unknown" },
      pokerogueId: def.id,
    });
  }
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

  if (pokerogueId === ER_LIFE_PRESERVER_ABILITY_ID) {
    builder.attr(LifePreserverAbAttr);
  }

  if (pokerogueId === ER_RELATIVITY_ABILITY_ID) {
    builder.attr(RelativityAbAttr);
    builder.attr(RelativityDefenseReductionAbAttr);
  }

  if (pokerogueId === ER_BORROWED_TIME_ABILITY_ID) {
    builder.attr(BorrowedTimeSummonAbAttr);
    builder.attr(BorrowedTimeDecayAbAttr);
  }

  if (pokerogueId === ER_CROSSCUT_ABILITY_ID) {
    builder.attr(CrosscutSecondStrikeAbAttr);
    builder.attr(CrosscutPowerAbAttr);
  }

  if (pokerogueId === ER_CHIVALRY_ABILITY_ID) {
    builder.attr(ChivalryAbAttr);
  }

  if (pokerogueId === ER_WORLD_IN_PIECES_ABILITY_ID) {
    builder.attr(WorldInPiecesSummonAbAttr);
    builder.attr(WorldInPiecesRemoveTypeAbAttr);
    builder.attr(WorldInPiecesSpeedAbAttr);
    builder.attr(WorldInPiecesRestoreAbAttr);
  }

  if (pokerogueId === ER_SOULMATE_ABILITY_ID) {
    builder.attr(SoulmateAbAttr);
  }

  if (pokerogueId === ER_RENDEZVOUS_ABILITY_ID) {
    builder.attr(RendezvousAbAttr);
  }

  if (pokerogueId === ER_HEARTBREAK_ABILITY_ID) {
    builder.attr(HeartbreakAbAttr);
  }

  if (pokerogueId === ER_SYNCHRONIZED_CURRENT_ABILITY_ID) {
    builder.attr(SynchronizedCurrentAbAttr);
  }

  if (pokerogueId === ER_POSITIVE_FEEDBACK_ABILITY_ID) {
    builder.attr(PositiveFeedbackPowerAbAttr);
    builder.attr(PositiveFeedbackAbAttr);
  }

  if (pokerogueId === ER_NEGATIVE_FEEDBACK_ABILITY_ID) {
    builder.attr(NegativeFeedbackAbAttr);
  }

  if (pokerogueId === ER_CLOSED_CIRCUIT_ABILITY_ID) {
    builder.attr(ClosedCircuitAbAttr);
  }

  if (pokerogueId === ER_CAPACITOR_BANK_ABILITY_ID) {
    builder.attr(CapacitorBankGainAbAttr);
    builder.attr(CapacitorBankAbsorbAbAttr);
    builder.attr(RedirectTypeMoveAbAttr, PokemonType.ELECTRIC);
  }

  if (pokerogueId === ER_FAULT_CURRENT_ABILITY_ID) {
    builder.attr(FaultCurrentAbAttr);
  }

  if (pokerogueId === ER_OVERLOADED_ABILITY_ID) {
    builder.attr(OverloadedPowerAbAttr);
    builder.attr(OverloadedPriorityAbAttr);
    builder.attr(OverloadedChipAbAttr);
  }

  if (pokerogueId === ER_LIBRARY_ABILITY_ID) {
    builder.attr(LibraryAbAttr);
  }

  if (pokerogueId === ER_OMNIFORM_ABILITY_ID) {
    builder.attr(OmniformAbAttr);
  }

  if (pokerogueId === ER_DRACONIC_VOODOO_ABILITY_ID) {
    builder.attr(DraconicVoodooAbAttr);
  }

  if (pokerogueId === ER_HYDRAPEX_ABILITY_ID) {
    builder.attr(HydrapexAbAttr);
  }

  if (pokerogueId === ER_BAD_SPLICE_ABILITY_ID) {
    builder.attr(BadSpliceAbAttr);
  }

  if (pokerogueId === ER_GENESIS_SUPERNOVA_ABILITY_ID) {
    builder.attr(GenesisSupernovaAbAttr);
  }

  if (pokerogueId === ER_KNIGHTS_HONOR_ABILITY_ID) {
    for (const attr of knightsHonorAttrs()) {
      builder.attrs.push(attr);
    }
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
