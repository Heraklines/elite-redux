/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase B Task B3 round 3: vanilla move mechanic patches.
//
// Numeric retunes (power/accuracy/PP/chance/priority) are already applied to
// every vanilla pokerogue move with an ER counterpart by
// `init-elite-redux-vanilla-rebalance.ts`. That covers the 577 NONE-bucket
// moves entirely, but leaves 111 MAJOR + TOTAL moves with stale battle
// mechanics, plus ~32 MINOR-flag moves silently missing ER ability-boost flag
// bits.
//
// This file applies the MECHANIC deltas — type swaps, category swaps, target
// widenings, status-on-hit additions, OHKO→regular conversions, and so on —
// via a dispatch table identical in shape to the ABILITY_PATCHERS table in
// the sibling file. Each entry receives the live `Move` instance and mutates
// it in place.
//
// Mutability surface (verified by reading `src/data/moves/move.ts`):
//   - `Move.power/accuracy/pp/priority/chance/moveTarget`: declared `public`
//     non-readonly. Safe direct assignment.
//   - `Move._type/_category`: declared `private readonly`. At runtime these
//     are plain JS properties — `readonly` is structural-only. We cast via
//     `Move & { _type, _category }` to mutate. ER's audit explicitly requires
//     this for the 25 type-swap entries and the 5 category swaps.
//   - `Move.flags`: declared `private` with a private `setFlag()` helper.
//     OR'd directly via a narrow cast — same pattern as
//     `init-elite-redux-custom-moves.ts::applyErArchetypeToMove`.
//   - `Move.attrs`: declared `public` MoveAttr[]. Push/splice freely.
//
// Idempotency: a `PATCHED_MARKER` symbol is installed on each patched Move so
// re-running the init is a no-op (same pattern as the ability patcher).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import { ER_FLAG_NAMES_LIST } from "#data/elite-redux/er-flag-mapping";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { type ErPledgeRule, ErPledgeWeatherEffectAttr } from "#data/elite-redux/er-pledge-weather-effect";
import {
  AddArenaTagAttr,
  AddBattlerTagAttr,
  CompareWeightPowerAttr,
  ConfuseAttr,
  ConsecutiveUseDoublePowerAttr,
  CritOnlyAttr,
  DefDefAttr,
  ErCritBelowHalfHpAttr,
  ErDecorateSideBoostAttr,
  ErSuperEffectiveVsTypeAttr,
  FlinchAttr,
  HealStatusEffectAttr,
  HiddenPowerTypeAttr,
  HighCritAttr,
  HitHealAttr,
  IgnoreOpponentStatStagesAttr,
  IncrementMovePriorityAttr,
  type Move,
  type MoveAttr,
  type MoveConditionFunc,
  MovePowerMultiplierAttr,
  MultiHitAttr,
  MultiHitPowerIncrementAttr,
  OneHitKOAccuracyAttr,
  OneHitKOAttr,
  PhotonGeyserCategoryAttr,
  RecoilAttr,
  RemoveHeldItemAttr,
  SetBasePowerAttr,
  SheerColdAccuracyAttr,
  StatStageChangeAttr,
  StatusEffectAttr,
  TerrainChangeAttr,
  VariableMoveTypeAttr,
  WeatherChangeAttr,
} from "#data/moves/move";
import { consecutiveUseRestriction, FirstMoveCondition } from "#data/moves/move-condition";
import { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { MultiHitType } from "#enums/multi-hit-type";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";

/** Numeric cutoff: anything ≥ this is an ER custom (registered by B2). */
const VANILLA_ID_CUTOFF = 5000;

/** Sentinel marker installed on each patched Move so re-runs are no-ops. */
const MOVE_PATCHED_MARKER = Symbol.for("er-vanilla-rebalance/move-patched");

/**
 * Result of applying the move-mechanic patches. Mirrors the ability side of
 * the rebalance result.
 */
export interface VanillaMovePatchResult {
  /** Count of vanilla moves whose mechanics were mutated. */
  moveDeltas: number;
  /** Count of vanilla move ids the patcher table targets that aren't in `allMoves`. */
  moveMissing: number;
  /** Non-fatal patcher errors (one entry per failed patch). */
  moveErrors: string[];
}

/**
 * Per-move patcher dispatch table. Key: pokerogue {@linkcode MoveId}. Value:
 * function that mutates the live `Move` instance to ER's mechanics.
 *
 * Categories follow the audit at `docs/plans/elite-redux-vanilla-move-audit.md`:
 *   - **TOTAL**: complete rewrite (OHKO removal, STATUS→damaging, both type
 *     AND category change).
 *   - **MAJOR**: add or replace a single `MoveAttr` (status-on-hit,
 *     UseHighestOffense, target widening, etc).
 *   - **MINOR-flag**: pure flag bit OR (no MoveAttr changes).
 */
/**
 * ER Pledge patcher. The numeric retune (90 BP / 15 PP) is already applied by
 * the rebalance; here we (1) keep the highest-attack category, (2) strip the
 * vanilla two-Pledge *combine* machinery (ER Pledges are single-cast), (3)
 * attach the single-cast weather/terrain field effect, and (4) rewrite the
 * tooltip to match ER behaviour.
 */
function patchErPledge(move: MutableMove, rules: readonly ErPledgeRule[], description: string): void {
  addAttrUnique(move, new PhotonGeyserCategoryAttr());
  removeAttrsByName(move, [
    "AwaitCombinedPledgeAttr",
    "CombinedPledgeTypeAttr",
    "CombinedPledgePowerAttr",
    "CombinedPledgeStabBoostAttr",
    "AddPledgeEffectAttr",
    "BypassRedirectAttr",
  ]);
  addAttrUnique(move, new ErPledgeWeatherEffectAttr(rules) as MoveAttr);
  // Set both the live text and the override: `descriptionOverride` makes the ER
  // tooltip survive re-localization (language change re-runs Move.localize()).
  move.descriptionOverride = description;
  move.effect = description;
}

const MOVE_PATCHERS: ReadonlyMap<MoveId, (move: MutableMove) => void> = new Map([
  // =====================================================================
  // TOTAL rewrites — 4 OHKO nerfs
  // =====================================================================
  // GUILLOTINE: vanilla OHKO Normal → ER Bug 120bp/80acc, high crit, slicing.
  [
    MoveId.GUILLOTINE,
    move => {
      retypeMove(move, PokemonType.BUG);
      removeAttrsByCtor(move, [OneHitKOAttr, OneHitKOAccuracyAttr]);
      orFlag(move, MoveFlags.SLICING_MOVE);
      addAttrUnique(move, new HighCritAttr());
    },
  ],
  // HORN_DRILL: vanilla OHKO → ER Normal 95bp, high-crit, ignores abilities/stat changes.
  [
    MoveId.HORN_DRILL,
    move => {
      removeAttrsByCtor(move, [OneHitKOAttr, OneHitKOAccuracyAttr]);
      orFlag(move, MoveFlags.IGNORE_ABILITIES);
      orFlag(move, MoveFlags.HORN_BASED);
      addAttrUnique(move, new HighCritAttr());
      addAttrUnique(move, new IgnoreOpponentStatStagesAttr());
    },
  ],
  // FISSURE: vanilla OHKO Ground → ER Ground 120bp spread (hits both foes).
  [
    MoveId.FISSURE,
    move => {
      removeAttrsByCtor(move, [OneHitKOAttr, OneHitKOAccuracyAttr]);
      move.moveTarget = MoveTarget.ALL_NEAR_ENEMIES;
    },
  ],
  // SHEER_COLD: vanilla OHKO Ice → ER Ice 100bp regular damage + 20% frostbite.
  [
    MoveId.SHEER_COLD,
    move => {
      removeAttrsByCtor(move, [OneHitKOAttr, OneHitKOAccuracyAttr, SheerColdAccuracyAttr]);
      // ER's frostbite is wired via the ER FREEZE-status remap in B2 (status-effect
      // pathway). We add the StatusEffectAttr; the chance is the existing
      // `move.chance` patched by the numeric pass.
      addAttrUnique(move, new StatusEffectAttr(StatusEffect.FREEZE));
    },
  ],

  // =====================================================================
  // TOTAL rewrites — STATUS → damaging conversions
  // =====================================================================
  // WHIRLWIND: vanilla force-switch → ER Special Flying damaging wind move.
  [
    MoveId.WHIRLWIND,
    move => {
      // Clear vanilla force-switch attr by name (avoids importing
      // ForceSwitchOutAttr, which would expand the import surface).
      removeAttrsByName(move, ["ForceSwitchOutAttr"]);
      setCategory(move, MoveCategory.SPECIAL);
      retypeMove(move, PokemonType.FLYING);
      orFlag(move, MoveFlags.WIND_MOVE);
    },
  ],
  // GROWL: vanilla status (Atk -1) → ER Special Normal sound damaging move
  // that also drops Atk.
  [
    MoveId.GROWL,
    move => {
      setCategory(move, MoveCategory.SPECIAL);
      // Vanilla GROWL already has a StatStageChange(ATK, -1) attr. Keep it.
      orFlag(move, MoveFlags.SOUND_BASED);
    },
  ],
  // POISON_GAS: vanilla status (poison) → ER Special Poison damaging, spread.
  [
    MoveId.POISON_GAS,
    move => {
      setCategory(move, MoveCategory.SPECIAL);
      move.moveTarget = MoveTarget.ALL_NEAR_ENEMIES;
      // Keep StatusEffectAttr(POISON) — vanilla wires it. ER adds 30% chance
      // (numeric-patched) on top.
    },
  ],
  // DRAGON_RAGE: vanilla fixed 40 damage → ER regular damaging Dragon move.
  // Vanilla ships power -1 + FixedDamageAttr(40), so it always deals a flat 40
  // regardless of stats/STAB/type. ER (er-moves.ts id 82) makes it a normal
  // 80-BP Dragon attack. We strip FixedDamageAttr so the standard damage formula
  // (stats/STAB/type chart/crits) applies. NOTE: the c-source correction
  // (`MOVE_DRAGON_RAGE` → power:1) runs AFTER this patcher and overwrites the
  // `.power` scalar back to 1 (its ROM dummy value, left over from the
  // fixed-damage era). To make ER's 80 BP survive that late scalar clobber we
  // pin the base power via a `SetBasePowerAttr` (attrs are not touched by the
  // c-source pass) instead of relying on the scalar.
  [
    MoveId.DRAGON_RAGE,
    move => {
      removeAttrsByName(move, ["FixedDamageAttr"]);
      addAttrUnique(move, new SetBasePowerAttr(80));
      // ER clause: "shock waves that can damage FAIRY mons" — Dragon is normally
      // 0× into Fairy. Override Fairy's type-chart contribution to 1× (neutral);
      // a dual-type's other type still combines with its own chart value.
      addAttrUnique(move, new ErSuperEffectiveVsTypeAttr(PokemonType.FAIRY, 1));
    },
  ],
  // FLASH: vanilla status (accuracy -1) → ER Special Electric damaging, ACC drop.
  [
    MoveId.FLASH,
    move => {
      setCategory(move, MoveCategory.SPECIAL);
      retypeMove(move, PokemonType.ELECTRIC);
      orFlag(move, MoveFlags.FIELD_BASED);
      // Vanilla FLASH already has StatStageChange(ACC, -1); keep.
    },
  ],
  // NIGHTMARE: vanilla status (NightmareTag) → ER Special Ghost damaging.
  [
    MoveId.NIGHTMARE,
    move => {
      removeAttrsByName(move, ["AddBattlerTagAttr"]); // strips NightmareTag attr
      setCategory(move, MoveCategory.SPECIAL);
    },
  ],
  // OCTOLOCK: vanilla status (OctolockTag) → ER Physical damaging.
  // Vanilla wires OctolockTag via AddBattlerTagAttr — keep it (provides
  // Def/SpDef drain + trap). We just need to change category to damaging.
  [
    MoveId.OCTOLOCK,
    move => {
      setCategory(move, MoveCategory.PHYSICAL);
    },
  ],
  // DECORATE: vanilla status (ally Atk/SpAtk +2, ally-targeted, no power) → ER
  // Special Fairy DAMAGING move (80 BP) that also raises the USER's Atk/SpAtk.
  // The old patch only flipped the category, leaving power = -1, the
  // `targetsAllyDefault` target, and the ally-targeted StatStageChange — so it
  // chip-damaged your OWN ally and buffed the wrong side. Aim it at the foe and
  // redirect the +2 boost to self.
  [
    MoveId.DECORATE,
    move => {
      setCategory(move, MoveCategory.SPECIAL);
      move.power = 80;
      move.accuracy = 100;
      // NEAR_ENEMY (a single adjacent FOE), NOT NEAR_OTHER — NEAR_OTHER also lets
      // you pick your own ally, so in doubles Decorate could be aimed at (and
      // damage) your partner. The dex move "Damages foes"; it must never target an
      // ally. (Reported: "decorate on my ally damages my ally AND buffs them".)
      move.moveTarget = MoveTarget.NEAR_ENEMY;
      orFlag(move, MoveFlags.MAKES_CONTACT);
      // Vanilla Decorate was an ally-buff flagged `.ignoresProtect()`. Now that it is a
      // DAMAGING foe-move, that leftover IGNORE_PROTECT let it punch through the target's
      // Protect (reported: "Decorate hit Sobble through Protect in doubles"). Clear it so
      // Protect blocks Decorate like any other attack.
      clearFlag(move, MoveFlags.IGNORE_PROTECT);
      removeAttrsByName(move, ["StatStageChangeAttr"]);
      // ER Decorate (dex #705): "Damages foes. Raises ALLIES' Attack, Special Attack,
      // and Crit by 2 stages." Apply the +2 Atk/SpAtk + the Focus-Energy CRIT_BOOST to
      // the user's ALLY only (never the user itself - boosting the whole side was way too
      // strong). In singles, with no ally, Decorate is purely a damaging move.
      addAttrUnique(move, new ErDecorateSideBoostAttr());
    },
  ],
  // CAPTIVATE: vanilla status (SpAtk -2 opposite-gender) → ER Special Fairy damaging.
  [
    MoveId.CAPTIVATE,
    move => {
      setCategory(move, MoveCategory.SPECIAL);
      retypeMove(move, PokemonType.FAIRY);
    },
  ],

  // =====================================================================
  // TOTAL rewrites — type/category swaps
  // =====================================================================
  [MoveId.VISE_GRIP, move => retypeMove(move, PokemonType.BUG)],
  [
    MoveId.CUT,
    move => {
      retypeMove(move, PokemonType.STEEL);
      orFlag(move, MoveFlags.FIELD_BASED);
      // ER (#353): always crits + 10% bleed (numbers/chance via c-source pass).
      addAttrUnique(move, new CritOnlyAttr());
      addAttrUnique(move, new AddBattlerTagAttr(BattlerTagType.ER_BLEED, false, false, 4, 6));
    },
  ],
  [
    MoveId.SLASH,
    move => {
      // ER (#353): 60 BP / 100% / 10 PP (c-source pass), always crits, 20% bleed.
      addAttrUnique(move, new CritOnlyAttr());
      addAttrUnique(move, new AddBattlerTagAttr(BattlerTagType.ER_BLEED, false, false, 4, 6));
    },
  ],
  [
    MoveId.RAZOR_WIND,
    move => {
      retypeMove(move, PokemonType.FLYING);
      // ER (community batch 2026-06-11): NO charge turn - hits immediately.
      // The vanilla instance is a ChargingAttackMove (class-level), so shadow
      // its type-guard per instance; MovePhase then never enters the charging
      // branch. SE-vs-Rock rider comes from ER_ID_SUPER_EFFECTIVE_VS_TYPE.
      Object.defineProperty(move, "isChargingMove", { value: () => false });
      // ER dex: "+1 priority in tailwind." Same mechanism as Grassy Glide's terrain
      // priority (IncrementMovePriorityAttr, read in Move.getPriority with target=null,
      // so the condition only reads `user`). Grant +1 while the user's side has Tailwind.
      addAttrUnique(
        move,
        new IncrementMovePriorityAttr(
          user =>
            !!globalScene.arena.getTagOnSide(
              ArenaTagType.TAILWIND,
              user.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY,
            ),
          1,
        ),
      );
    },
  ],
  [
    MoveId.TAKE_DOWN,
    move => {
      retypeMove(move, PokemonType.FIGHTING);
      addAttrUnique(move, new StatStageChangeAttr([Stat.SPD], -1, false, { effectChanceOverride: 20 }) as MoveAttr);
    },
  ],
  [
    MoveId.STRENGTH,
    move => {
      retypeMove(move, PokemonType.ROCK);
      orFlag(move, MoveFlags.FIELD_BASED);
      // ER (community batch): "Lowers the user's defenses" - Close Combat
      // effect (the numeric pass pins 110 BP / 5 PP / chance 100).
      addAttrUnique(move, new StatStageChangeAttr([Stat.DEF, Stat.SPDEF], -1, true));
    },
  ],
  [
    MoveId.EGG_BOMB,
    move => {
      retypeMove(move, PokemonType.FIRE);
      orFlag(move, MoveFlags.THROW_BASED);
      addAttrUnique(move, new StatusEffectAttr(StatusEffect.BURN));
      // Fire-typed moves cure freeze on target — AttackMove constructor adds
      // HealStatusEffectAttr(FREEZE) only when constructed as Fire. Add it
      // manually since we re-typed post-construction.
      addAttrUnique(move, new HealStatusEffectAttr(false, StatusEffect.FREEZE));
    },
  ],
  [
    MoveId.SPIKE_CANNON,
    move => {
      retypeMove(move, PokemonType.WATER);
      orFlag(move, MoveFlags.PULSE_MOVE);
    },
  ],
  [MoveId.BARRAGE, move => retypeMove(move, PokemonType.STEEL)],
  [MoveId.RAGE, move => retypeMove(move, PokemonType.FIGHTING)],
  [MoveId.MIND_READER, move => retypeMove(move, PokemonType.PSYCHIC)],
  [MoveId.FRUSTRATION, move => retypeMove(move, PokemonType.DARK)],
  [MoveId.SMELLING_SALTS, move => retypeMove(move, PokemonType.FIGHTING)],
  // MUDDY_WATER: ER's dual-type Water+Ground requires a bespoke
  // type-resolution attr — deferred. The accuracy-drop rider is already in
  // vanilla and the numeric pass handles power/accuracy/PP.
  [
    MoveId.ROCK_CLIMB,
    move => {
      retypeMove(move, PokemonType.ROCK);
      orFlag(move, MoveFlags.FIELD_BASED);
    },
  ],
  [MoveId.QUASH, move => retypeMove(move, PokemonType.PSYCHIC)],
  [MoveId.HYPERSPACE_HOLE, move => retypeMove(move, PokemonType.GHOST)],
  [
    MoveId.HOLD_BACK,
    move => {
      retypeMove(move, PokemonType.FIGHTING);
      addAttrUnique(move, new ConfuseAttr(false));
    },
  ],
  [MoveId.JAW_LOCK, move => retypeMove(move, PokemonType.FIGHTING)],
  [MoveId.SNAP_TRAP, move => retypeMove(move, PokemonType.STEEL)],
  [
    MoveId.AXE_KICK,
    move => {
      retypeMove(move, PokemonType.DARK);
      addAttrUnique(move, new ConfuseAttr(false));
    },
  ],

  // =====================================================================
  // MAJOR — UseHighestOffenseAttr (reuse PhotonGeyserCategoryAttr)
  // =====================================================================
  // ER's USE_HIGHEST_OFFENSE category-derivation matches pokerogue's
  // PhotonGeyserCategoryAttr semantics exactly (set category to PHYSICAL if
  // user's Atk > SpAtk). Re-use that attr on all ER USE_HIGHEST_OFFENSE moves.
  // BLAST_BURN / HYDRO_CANNON / FRENZY_PLANT / PRISMATIC_LASER: the ER dex says these
  // "can't be used next turn" - the MOVE is locked for one turn but the user STILL
  // ACTS that turn (the Gigaton Hammer model, consecutiveUseRestriction). This is NOT
  // the vanilla recharge that makes the user "immobile / rest" next turn - Hyper Beam,
  // Giga Impact, Rock Wrecker and Eternabeam say exactly that and keep RechargeAttr.
  // So swap RechargeAttr for the consecutive-use restriction on these four.
  [
    MoveId.BLAST_BURN,
    move => {
      addAttrUnique(move, new PhotonGeyserCategoryAttr());
      removeAttrsByName(move, ["RechargeAttr"]);
      (move as unknown as { restrictions: (typeof consecutiveUseRestriction)[] }).restrictions.push(
        consecutiveUseRestriction,
      );
    },
  ],
  [
    MoveId.HYDRO_CANNON,
    move => {
      addAttrUnique(move, new PhotonGeyserCategoryAttr());
      removeAttrsByName(move, ["RechargeAttr"]);
      (move as unknown as { restrictions: (typeof consecutiveUseRestriction)[] }).restrictions.push(
        consecutiveUseRestriction,
      );
    },
  ],
  [
    MoveId.FRENZY_PLANT,
    move => {
      addAttrUnique(move, new PhotonGeyserCategoryAttr());
      removeAttrsByName(move, ["RechargeAttr"]);
      (move as unknown as { restrictions: (typeof consecutiveUseRestriction)[] }).restrictions.push(
        consecutiveUseRestriction,
      );
    },
  ],
  [MoveId.TRI_ATTACK, move => addAttrUnique(move, new PhotonGeyserCategoryAttr())],
  [MoveId.ATTACK_ORDER, move => addAttrUnique(move, new PhotonGeyserCategoryAttr())],
  [
    MoveId.ROCK_WRECKER,
    move => {
      addAttrUnique(move, new PhotonGeyserCategoryAttr());
      orFlag(move, MoveFlags.THROW_BASED);
    },
  ],
  [MoveId.MULTI_ATTACK, move => addAttrUnique(move, new PhotonGeyserCategoryAttr())],
  [MoveId.PIKA_PAPOW, move => addAttrUnique(move, new PhotonGeyserCategoryAttr())],
  [MoveId.VEEVEE_VOLLEY, move => addAttrUnique(move, new PhotonGeyserCategoryAttr())],
  [MoveId.RELIC_SONG, move => addAttrUnique(move, new PhotonGeyserCategoryAttr())],
  [
    MoveId.PRISMATIC_LASER,
    move => {
      addAttrUnique(move, new PhotonGeyserCategoryAttr());
      orFlag(move, MoveFlags.PULSE_MOVE);
      // ER dex: "can't be used next turn" (user still acts) - see the recharge note above.
      removeAttrsByName(move, ["RechargeAttr"]);
      (move as unknown as { restrictions: (typeof consecutiveUseRestriction)[] }).restrictions.push(
        consecutiveUseRestriction,
      );
    },
  ],
  // ER Pledges: highest-attack 90 BP, single-cast field effects keyed to weather
  // /terrain (no combining). Rainbow → user's side; swamp / sea of fire → foe.
  [
    MoveId.WATER_PLEDGE,
    move =>
      patchErPledge(
        move,
        [
          { when: "sun", tag: ArenaTagType.WATER_FIRE_PLEDGE, selfSide: true }, // rainbow
          { when: "grassy-terrain", tag: ArenaTagType.GRASS_WATER_PLEDGE, selfSide: false }, // swamp
        ],
        "Uses the higher of Atk/SpAtk. In harsh sunlight it makes a rainbow on your side (doubles added effects); on Grassy Terrain it makes a swamp under the foe (quarters Speed).",
      ),
  ],
  [
    MoveId.FIRE_PLEDGE,
    move =>
      patchErPledge(
        move,
        [
          { when: "rain", tag: ArenaTagType.WATER_FIRE_PLEDGE, selfSide: true }, // rainbow
          { when: "grassy-terrain", tag: ArenaTagType.FIRE_GRASS_PLEDGE, selfSide: false }, // sea of fire
        ],
        "Uses the higher of Atk/SpAtk. In rain it makes a rainbow on your side (doubles added effects); on Grassy Terrain it sets a sea of fire under the foe (chips HP each turn).",
      ),
  ],
  [
    MoveId.GRASS_PLEDGE,
    move =>
      patchErPledge(
        move,
        [
          { when: "rain", tag: ArenaTagType.GRASS_WATER_PLEDGE, selfSide: false }, // swamp
          { when: "sun", tag: ArenaTagType.FIRE_GRASS_PLEDGE, selfSide: false }, // sea of fire
        ],
        "Uses the higher of Atk/SpAtk. In rain it makes a swamp under the foe (quarters Speed); in harsh sunlight it sets a sea of fire under the foe (chips HP each turn).",
      ),
  ],
  // ER (#366): the genie-Storm quartet sets a FIELD effect per ER ("Sets
  // tailwind/rain/sandstorm/fairy terrain") instead of vanilla's chance-based
  // stat-drop/status secondaries — user report: "Bleakwind Storm says it sets
  // tailwind but didn't". chance = -1 so the rider fires on every use.
  [
    MoveId.SPRINGTIDE_STORM,
    move => {
      addAttrUnique(move, new PhotonGeyserCategoryAttr());
      removeAttrsByName(move, ["StatStageChangeAttr"]);
      addAttrUnique(move, new ErTerrainRiderNoFailAttr(TerrainType.MISTY));
      move.chance = -1;
    },
  ],
  [MoveId.MYSTICAL_POWER, move => addAttrUnique(move, new PhotonGeyserCategoryAttr())],
  [
    MoveId.BLEAKWIND_STORM,
    move => {
      addAttrUnique(move, new PhotonGeyserCategoryAttr());
      removeAttrsByName(move, ["StatStageChangeAttr"]);
      addAttrUnique(move, new AddArenaTagAttr(ArenaTagType.TAILWIND, 4, false, true));
      move.chance = -1;
    },
  ],
  [
    MoveId.WILDBOLT_STORM,
    move => {
      addAttrUnique(move, new PhotonGeyserCategoryAttr());
      removeAttrsByName(move, ["StatusEffectAttr"]);
      addAttrUnique(move, new ErWeatherRiderNoFailAttr(WeatherType.RAIN));
      move.chance = -1;
    },
  ],
  [
    MoveId.SANDSEAR_STORM,
    move => {
      addAttrUnique(move, new PhotonGeyserCategoryAttr());
      removeAttrsByName(move, ["StatusEffectAttr"]);
      addAttrUnique(move, new ErWeatherRiderNoFailAttr(WeatherType.SANDSTORM));
      move.chance = -1;
    },
  ],
  [MoveId.TACHYON_CUTTER, move => addAttrUnique(move, new PhotonGeyserCategoryAttr())],
  [MoveId.MALIGNANT_CHAIN, move => addAttrUnique(move, new PhotonGeyserCategoryAttr())],
  [MoveId.TERA_STARSTORM, move => addAttrUnique(move, new PhotonGeyserCategoryAttr())],

  // =====================================================================
  // MAJOR — status-on-hit / stat-on-hit additions
  // =====================================================================
  // DOUBLE_SLAP: 10% confuse chance after 2nd hit (approximated as ConfuseAttr).
  [MoveId.DOUBLE_SLAP, move => addAttrUnique(move, new ConfuseAttr(false))],
  // VINE_WHIP: 30% flinch chance (numeric-patched on top).
  [MoveId.VINE_WHIP, move => addAttrUnique(move, new FlinchAttr())],
  // MEGA_DRAIN: ER drains 75% of the damage dealt (vanilla 50%).
  [
    MoveId.MEGA_DRAIN,
    move => {
      removeAttrsByName(move, ["HitHealAttr"]);
      addAttrUnique(move, new HitHealAttr(0.75));
    },
  ],
  // SYNCHRONOISE: ER - "an odd shock wave that MATCHES the user's second
  // type" and hits anything (vanilla only damaged targets sharing a type).
  [
    MoveId.SYNCHRONOISE,
    move => {
      removeAttrsByName(move, ["HitsSameTypeAttr"]);
      addAttrUnique(move, new ErMatchUserSecondTypeAttr());
    },
  ],
  // STEEL_ROLLER: ER - usable WITHOUT terrain; still clears one when present
  // (numeric pass pins 80 BP / 15 PP). Drop the vanilla "fails unless terrain is
  // active" condition. That condition is registered at SEQUENCE 3
  // (`.condition(() => !!arena.terrain, 3)` -> conditionsSeq3), so clearing only the
  // default `conditions` (sequence 4) left it in place and the move still missed
  // off-terrain. Clear every condition sequence so it truly fires without terrain.
  [
    MoveId.STEEL_ROLLER,
    move => {
      const m = move as unknown as { conditions: unknown[]; conditionsSeq2: unknown[]; conditionsSeq3: unknown[] };
      m.conditions.length = 0;
      m.conditionsSeq2.length = 0;
      m.conditionsSeq3.length = 0;
    },
  ],
  // GEAR_UP: ER dex - a SELF buff ("The user rotates its gears, raising its SpAtk and
  // sharply raising its Speed"), NOT the vanilla Plus/Minus team buff. The port still ran
  // vanilla (raise Atk/SpAtk of Plus/Minus allies, fail if nobody has Plus/Minus), so on a
  // normal mon it did nothing useful ("gear up isnt changed to er version"). Strip the
  // Plus/Minus stat attr + the field-wide Plus/Minus gate, retarget to the user, and apply
  // SpAtk +1 / Speed +2 to self. Two attrs (different magnitudes) added directly, since
  // addAttrUnique would dedupe the second StatStageChangeAttr.
  [
    MoveId.GEAR_UP,
    move => {
      removeAttrsByName(move, ["StatStageChangeAttr"]);
      const m = move as unknown as { conditions: unknown[]; conditionsSeq2: unknown[]; conditionsSeq3: unknown[] };
      m.conditions.length = 0;
      m.conditionsSeq2.length = 0;
      m.conditionsSeq3.length = 0;
      move.moveTarget = MoveTarget.USER;
      move.addAttr(new StatStageChangeAttr([Stat.SPATK], 1, true));
      move.addAttr(new StatStageChangeAttr([Stat.SPD], 2, true));
    },
  ],
  // PSYBEAM: lowers SpAtk on hit (chance patched separately).
  [MoveId.PSYBEAM, move => addAttrUnique(move, new StatStageChangeAttr([Stat.SPATK], -1, false))],
  // PSYWAVE: ER makes it a normal 40-BP special move (+1 priority, 10% confuse),
  // NOT vanilla's level-based fixed damage. Vanilla's RandomLevelDamageAttr
  // (extends FixedDamageAttr) HARD-OVERWRITES the damage with `level * rand(50-150)%`,
  // ignoring power/stats/STAB — which is why a +2 SpA attacker chipped ~9 dmg.
  // Strip the fixed-damage attr so the 40-BP scalar drives the standard formula.
  [
    MoveId.PSYWAVE,
    move => {
      removeAttrsByName(move, ["FixedDamageAttr"]);
      addAttrUnique(move, new ConfuseAttr(false));
    },
  ],
  // ROUND: 20% flinch chance.
  [MoveId.ROUND, move => addAttrUnique(move, new FlinchAttr())],
  // CHIP_AWAY: 40% chance to lower Atk and/or Def on hit.
  [
    MoveId.CHIP_AWAY,
    move => {
      addAttrUnique(move, new StatStageChangeAttr([Stat.ATK, Stat.DEF], -1, false));
    },
  ],
  // DRAGON_RUSH: now 33% recoil.
  [MoveId.DRAGON_RUSH, move => addAttrUnique(move, new RecoilAttr(false, 0.33))],
  // CROSS_POISON: hits twice (multi-hit type TWO).
  [MoveId.CROSS_POISON, move => addAttrUnique(move, new MultiHitAttr(MultiHitType.TWO))],
  // BOOMBURST: 50% recoil after.
  [MoveId.BOOMBURST, move => addAttrUnique(move, new RecoilAttr(false, 0.5))],
  // WILD_CHARGE: 10% paralyze chance.
  [MoveId.WILD_CHARGE, move => addAttrUnique(move, new StatusEffectAttr(StatusEffect.PARALYSIS))],
  // BEAK_BLAST: direct burn proc (not just the header).
  [MoveId.BEAK_BLAST, move => addAttrUnique(move, new StatusEffectAttr(StatusEffect.BURN))],
  // CHILLING_WATER: ER re-specs this to "Fires ice-cold water at the foe. 30%
  // chance to inflict Frostbite." (75 power Water — power set by rebalance). The
  // ER move (id 847) shares the vanilla name, so the c-source name-remap pins it
  // to vanilla CHILLING_WATER, which keeps vanilla's GUARANTEED Attack drop. Drop
  // that StatStageChangeAttr and graft the 30% ER_FROSTBITE secondary (gated by
  // move.chance, same shape as every other ER frostbite move).
  [
    MoveId.CHILLING_WATER,
    move => {
      removeAttrsByName(move, ["StatStageChangeAttr"]);
      move.chance = 30;
      addAttrUnique(move, new AddBattlerTagAttr(BattlerTagType.ER_FROSTBITE, false));
    },
  ],
  // STEEL_BEAM: ER replaces HalfSacrificial with flat 50% recoil.
  [
    MoveId.STEEL_BEAM,
    move => {
      removeAttrsByName(move, ["HalfSacrificialAttr"]);
      addAttrUnique(move, new RecoilAttr(false, 0.5));
    },
  ],
  // GLITZY_GLOW: also lowers foe SpAtk on hit.
  [MoveId.GLITZY_GLOW, move => addAttrUnique(move, new StatStageChangeAttr([Stat.SPATK], -1, false))],
  // BADDY_BAD: also lowers foe Atk on hit.
  [MoveId.BADDY_BAD, move => addAttrUnique(move, new StatStageChangeAttr([Stat.ATK], -1, false))],
  // PECK: now multi-hit (2-5).
  [
    MoveId.PECK,
    move => {
      addAttrUnique(move, new MultiHitAttr());
      orFlag(move, MoveFlags.HORN_BASED);
    },
  ],
  // ESPER_WING: adds 50% drain.
  [MoveId.ESPER_WING, move => addAttrUnique(move, new HitHealAttr(0.5))],
  // STOMP: now also destroys terrain (omit — bespoke ClearTerrainAttr, deferred).

  // =====================================================================
  // MAJOR — spread-target widenings
  // =====================================================================
  [MoveId.ACID, move => (move.moveTarget = MoveTarget.ALL_NEAR_ENEMIES)],
  [MoveId.BUBBLE, move => (move.moveTarget = MoveTarget.ALL_NEAR_ENEMIES)],
  [MoveId.BULLDOZE, move => (move.moveTarget = MoveTarget.ALL_NEAR_ENEMIES)],
  [MoveId.PLAY_NICE, move => (move.moveTarget = MoveTarget.ALL_NEAR_ENEMIES)],
  [
    MoveId.MOUNTAIN_GALE,
    move => {
      move.moveTarget = MoveTarget.ALL_NEAR_ENEMIES;
      orFlag(move, MoveFlags.AIR_BASED);
    },
  ],

  // =====================================================================
  // MAJOR — category swaps
  // =====================================================================
  [MoveId.BIND, move => setCategory(move, MoveCategory.SPECIAL)],
  [MoveId.PRESENT, move => setCategory(move, MoveCategory.SPECIAL)],
  [MoveId.AIR_CUTTER, move => setCategory(move, MoveCategory.PHYSICAL)],
  [MoveId.MAGNET_BOMB, move => setCategory(move, MoveCategory.SPECIAL)],
  [MoveId.DIAMOND_STORM, move => setCategory(move, MoveCategory.SPECIAL)],
  [MoveId.CORE_ENFORCER, move => setCategory(move, MoveCategory.PHYSICAL)],
  [MoveId.SKITTER_SMACK, move => setCategory(move, MoveCategory.SPECIAL)],
  [MoveId.MORTAL_SPIN, move => setCategory(move, MoveCategory.SPECIAL)],

  // =====================================================================
  // MAJOR — defender-stat selector / always-crit / bypass-abilities riders
  // =====================================================================
  // MAGICAL_LEAF: hits Def (Body Press-style).
  [MoveId.MAGICAL_LEAF, move => addAttrUnique(move, new DefDefAttr())],
  // RAZOR_LEAF: always crits.
  [
    MoveId.RAZOR_LEAF,
    move => {
      // No AlwaysCritAttr in pokerogue. The closest available is HighCritAttr
      // (boosts crit ratio by 1 stage). Apply it to bring crit rate to high
      // tier; ER's "always crits" can be approximated this way until a
      // bespoke attr is added.
      addAttrUnique(move, new HighCritAttr());
    },
  ],

  // =====================================================================
  // MINOR-flag fixes — silently-uncovered flag bits
  // =====================================================================
  // FIELD_BASED entries (per audit — only the gap-uncovered moves)
  [MoveId.EARTHQUAKE, move => orFlag(move, MoveFlags.FIELD_BASED)],
  [MoveId.MAGNITUDE, move => orFlag(move, MoveFlags.FIELD_BASED)],
  [MoveId.DIG, move => orFlag(move, MoveFlags.FIELD_BASED)],
  [MoveId.MUD_SHOT, move => orFlag(move, MoveFlags.FIELD_BASED)],
  // ICE_SPINNER already field-based per audit; verify
  [MoveId.ICE_SPINNER, move => orFlag(move, MoveFlags.FIELD_BASED)],

  // THROW_BASED + BONE_BASED composite entries (bone moves are also throws).
  [MoveId.BEAT_UP, move => orFlag(move, MoveFlags.THROW_BASED)],
  [
    MoveId.BONEMERANG,
    move => {
      orFlag(move, MoveFlags.THROW_BASED);
      orFlag(move, MoveFlags.BONE_BASED);
    },
  ],
  [
    MoveId.BONE_CLUB,
    move => {
      orFlag(move, MoveFlags.THROW_BASED);
      orFlag(move, MoveFlags.BONE_BASED);
    },
  ],
  [
    MoveId.BONE_RUSH,
    move => {
      orFlag(move, MoveFlags.THROW_BASED);
      orFlag(move, MoveFlags.BONE_BASED);
    },
  ],
  [MoveId.SHADOW_BONE, move => orFlag(move, MoveFlags.BONE_BASED)],

  // MIGHTY_HORN entries (HORN_BASED for already-horn moves not auto-flagged)
  [MoveId.MEGAHORN, move => orFlag(move, MoveFlags.HORN_BASED)],
  [MoveId.HORN_ATTACK, move => orFlag(move, MoveFlags.HORN_BASED)],
  [MoveId.HORN_LEECH, move => orFlag(move, MoveFlags.HORN_BASED)],
  [MoveId.SMART_STRIKE, move => orFlag(move, MoveFlags.HORN_BASED)],

  // HAMMER_BASED entries (per audit ~5 moves)
  [MoveId.WOOD_HAMMER, move => orFlag(move, MoveFlags.HAMMER_BASED)],
  [MoveId.HAMMER_ARM, move => orFlag(move, MoveFlags.HAMMER_BASED)],
  [MoveId.ICE_HAMMER, move => orFlag(move, MoveFlags.HAMMER_BASED)],

  // ARROW_BASED entries (rare — Pin Missile is dart-like in ER)
  [MoveId.PIN_MISSILE, move => orFlag(move, MoveFlags.ARROW_BASED)],

  // =====================================================================
  // MULTI-HIT additions — vanilla single-hit moves that ER turned into 2-5x
  // =====================================================================
  // PECK: ER description: "Hits 2-5x with a horn or beak. Mighty Horn boost."
  // Vanilla pokerogue Peck is single-hit; ER bumps it to 2-5 hits and adds
  // the HORN_BASED flag for Mighty Horn ability scaling. User-reported: a
  // Fletchling 3-shot the player's mon with three Peck hits in a single
  // turn — exactly the multi-hit shape.
  [
    MoveId.PECK,
    move => {
      addAttrUnique(move, new MultiHitAttr(MultiHitType.TWO_TO_FIVE));
      orFlag(move, MoveFlags.HORN_BASED);
    },
  ],

  // =====================================================================
  // R57 — Effect-chance restorations
  //
  // Discovered via er-move-diff-audit: pokerogue had `move.chance = 0`
  // for these moves while ER spec gives them non-zero secondary chance.
  // Each entry sets `move.chance` to the ER value so the secondary
  // effect rolls at the right rate.
  // =====================================================================
  [
    MoveId.ROLLING_KICK,
    move => {
      move.chance = 30;
    },
  ],
  [
    MoveId.BUBBLE_BEAM,
    move => {
      // ER: 25-power Water pulse that strikes 2–5 times (Mega Launcher–boosted),
      // NOT vanilla's 65-power single hit with a 10% Speed drop. Power (25) and
      // the PULSE_MOVE flag are set by the c-source corrections; here we drop the
      // Speed-drop secondary and graft the 2–5 multi-hit.
      removeAttrsByName(move, ["StatStageChangeAttr"]);
      move.chance = -1;
      addAttrUnique(move, new MultiHitAttr(MultiHitType.TWO_TO_FIVE));
    },
  ],
  [
    MoveId.SKY_ATTACK,
    move => {
      move.chance = 30;
      // ER: Sky Attack raises the user's Attack on the CHARGE turn (turn 1),
      // then strikes on turn 2 — "Raises its Attack on the first turn, then
      // makes a brutal strike on the second." Vanilla only charges + flinches.
      // The boost is a charge-turn attr (like Skull Bash's Defense raise), so it
      // applies during the charge, not on the hit. Idempotent.
      if (move.chargeAttrs && !move.chargeAttrs.some(a => a instanceof StatStageChangeAttr)) {
        move.chargeAttrs.push(new StatStageChangeAttr([Stat.ATK], 1, true));
      }
    },
  ],
  // FLAME_WHEEL: ER Rollout clone - "rolls into a wheel to strike with
  // rising intensity". 40 BP ramp, NO burn rider (numeric pass pins
  // 40 BP / 10 PP / chance 0). Community batch 2026-06-11.
  [
    MoveId.FLAME_WHEEL,
    move => {
      removeAttrsByName(move, ["StatusEffectAttr"]);
      addAttrUnique(move, new ConsecutiveUseDoublePowerAttr(5, true, true, MoveId.DEFENSE_CURL));
      move.chance = -1;
    },
  ],
  [
    MoveId.MUD_SLAP,
    move => {
      // ER (#354): 25 BP / 100% / 10 PP (c-source pass), hits 2-5 times, and
      // does NOT drop accuracy — strip the vanilla guaranteed ACC drop.
      removeAttrsByName(move, ["StatStageChangeAttr"]);
      addAttrUnique(move, new MultiHitAttr());
      move.chance = -1;
    },
  ],
  [
    MoveId.FURY_CUTTER,
    move => {
      // ER (#360): 20 BP / 90% / 10 PP (c-source pass) with Triple Kick's
      // effect — 3 strikes ramping 20/40/60, each checking accuracy. Strip the
      // vanilla consecutive-use doubling.
      removeAttrsByName(move, ["ConsecutiveUseDoublePowerAttr"]);
      addAttrUnique(move, new MultiHitAttr(MultiHitType.THREE));
      addAttrUnique(move, new MultiHitPowerIncrementAttr(3));
      orFlag(move, MoveFlags.CHECK_ALL_HITS);
    },
  ],
  [
    MoveId.ECHOED_VOICE,
    move => {
      // ER (#360): 20 BP / 90% / 15 PP (c-source pass) with Triple Kick's
      // effect, like Fury Cutter above. Strip the vanilla repeat-use ramp.
      removeAttrsByName(move, ["ConsecutiveUseMultiBasePowerAttr"]);
      addAttrUnique(move, new MultiHitAttr(MultiHitType.THREE));
      addAttrUnique(move, new MultiHitPowerIncrementAttr(3));
      orFlag(move, MoveFlags.CHECK_ALL_HITS);
    },
  ],
  [
    MoveId.RAPID_SPIN,
    move => {
      move.chance = 100;
    },
  ],
  [
    MoveId.SECRET_POWER,
    move => {
      // ER (#355): "Physical Hidden Power" — 80 BP (c-source pass), type varies
      // with the user; drop the vanilla terrain-dependent secondary entirely.
      removeAttrsByName(move, ["SecretPowerAttr"]);
      addAttrUnique(move, new HiddenPowerTypeAttr());
      move.chance = -1;
    },
  ],
  [
    MoveId.TECHNO_BLAST,
    move => {
      // ER (#355): works like Hidden Power (type varies with the user) at
      // 120 BP / 5 PP (vanilla numbers already match); drop the Drive-item attr.
      removeAttrsByName(move, ["TechnoBlastTypeAttr"]);
      addAttrUnique(move, new HiddenPowerTypeAttr());
    },
  ],
  [
    MoveId.POWER_SWAP,
    move => {
      move.chance = 100;
    },
  ],
  [
    MoveId.GUARD_SWAP,
    move => {
      move.chance = 100;
    },
  ],
  [
    MoveId.STRUGGLE_BUG,
    move => {
      // ER (#367): "A desperate attack that deals critical damage when the
      // user is below 50% HP" — 80 BP (c-source pass), NO SpAtk drop. The old
      // patch made vanilla's SpAtk drop a 100% rider, the opposite of ER.
      removeAttrsByName(move, ["StatStageChangeAttr"]);
      addAttrUnique(move, new ErCritBelowHalfHpAttr());
      move.chance = -1;
    },
  ],
  [
    MoveId.STEAMROLLER,
    move => {
      move.chance = 30;
    },
  ],
  [
    MoveId.NIGHT_DAZE,
    move => {
      move.chance = 40;
    },
  ],
  [
    MoveId.THROAT_CHOP,
    move => {
      move.chance = 100;
    },
  ],
  [
    MoveId.EERIE_SPELL,
    move => {
      move.chance = 100;
    },
  ],
  // KINESIS: vanilla status (accuracy -1) → ER "Causes the foe's item to fly
  // away, removing it and flinching the target." +1 priority (numeric-patched).
  // Drop the vanilla accuracy-drop; add Knock-Off-style item removal + flinch.
  // FIRST-TURN ONLY (Fake Out / Astonish #221 behavior): a repeatable +1-priority
  // guaranteed-flinch move let the AI perma-flinch the player — gate it so it can
  // only be used on the user's first turn after switch-in.
  [
    MoveId.KINESIS,
    move => {
      removeAttrsByCtor(move, [StatStageChangeAttr]);
      addAttrUnique(move, new RemoveHeldItemAttr(false));
      addAttrUnique(move, new FlinchAttr());
      move.condition(new FirstMoveCondition(), 3);
    },
  ],
  // Tachyon Cutter — ER's authored description says "Never misses". Keyed by
  // the MoveId enum here (in addition to the ER-id pass below) because this
  // move sits in the #151 id-map collision zone where the static ER_ID_MAP row
  // and the runtime-resolved id diverge; patching both targets ensures the
  // move the battle engine actually uses gets the never-miss sentinel.
  [
    MoveId.TACHYON_CUTTER,
    move => {
      move.accuracy = -1;
    },
  ],
  // Gigaton Hammer — ER ABBR "Super effective vs Steel." Same #151 collision
  // zone as Tachyon Cutter, so key by the MoveId enum here (the ER-id SE pass
  // below targets the diverging static id). x2 power vs Steel.
  [
    MoveId.GIGATON_HAMMER,
    move => {
      addAttrUnique(move, new MovePowerMultiplierAttr((_u, target) => (target.isOfType(PokemonType.STEEL) ? 2 : 1)));
    },
  ],
  // Dynamax Cannon - ER dex #690 "Deals 2x damage to Mega foes." (No Dynamax in
  // ER; the clause lands on Mega-evolved targets.) Vanilla ships it as a plain
  // 100 BP Dragon special with no such multiplier.
  [
    MoveId.DYNAMAX_CANNON,
    move => {
      addAttrUnique(move, new MovePowerMultiplierAttr((_u, target) => (target.isMega() ? 2 : 1)));
    },
  ],
  // Ominous Wind — ER "Deals double damage in fog." (keeps its vanilla 60 BP
  // Ghost-special + 10% all-stats raise.)
  [
    MoveId.OMINOUS_WIND,
    move => {
      addAttrUnique(
        move,
        new MovePowerMultiplierAttr(() => {
          const w = globalScene.arena.weather;
          return w?.weatherType === WeatherType.FOG && !w.isEffectSuppressed() ? 2 : 1;
        }),
      );
    },
  ],
  // FLOWER_TRICK — ER ABBR "Can't miss. Always crits." (#151 collision zone, so
  // keyed by MoveId.) Never-miss (accuracy -1) + guaranteed crit.
  [
    MoveId.FLOWER_TRICK,
    move => {
      move.accuracy = -1;
      removeAttrsByCtor(move, [HighCritAttr]);
      addAttrUnique(move, new CritOnlyAttr());
    },
  ],
  // BITTER_MALICE — ER reworks the vanilla 100%-Atk-drop Ghost move into a
  // "30% frostbite chance, +50% damage if the target is statused" attack.
  // (#151 collision zone — keyed by MoveId.) Drop the vanilla Atk-drop; add
  // frostbite (chance-gated by the numeric-patched move.chance) + the conditional
  // power boost vs a statused target.
  [
    MoveId.BITTER_MALICE,
    move => {
      removeAttrsByCtor(move, [StatStageChangeAttr]);
      addAttrUnique(move, new AddBattlerTagAttr(BattlerTagType.ER_FROSTBITE, false, false, 4, 6));
      addAttrUnique(
        move,
        new MovePowerMultiplierAttr((_u, target) => (target.status && target.status.effect ? 1.5 : 1)),
      );
    },
  ],
  // SPLASH: in Elite Redux, Splash is NOT the vanilla "nothing happens" status
  // move — it's a WATER-type PHYSICAL attack whose power scales with how much
  // the user outweighs the foe (Heavy-Slam curve), 100% accuracy, targeting the
  // opponent. (ER move id 150: type Water, split physical, "Does more damage if
  // the user outweighs the foe.") Convert the SelfStatusMove in-place:
  //  - retype Normal → Water, category Status → Physical
  //  - retarget USER → the opposing Pokémon, set 100% accuracy
  //  - strip the do-nothing "But nothing happened!" MessageAttr
  //  - add the weight-ratio power attr (base power -1 is computed by it)
  // NOTE: ER also gives Splash a 20% "drench" chance, but DRENCH is an
  // ER-specific status that isn't yet implemented anywhere in this fork
  // (resolveStatusName returns null for it, so every DRENCH move currently
  // skips that piece). The drench rider is intentionally omitted until the
  // status exists; the move's core identity (Water physical weight attack) is
  // faithful.
  [
    MoveId.SPLASH,
    move => {
      retypeMove(move, PokemonType.WATER);
      setCategory(move, MoveCategory.PHYSICAL);
      move.moveTarget = MoveTarget.NEAR_OTHER;
      move.accuracy = 100;
      removeAttrsByName(move, ["MessageAttr"]);
      addAttrUnique(move, new CompareWeightPowerAttr());
    },
  ],
]);

/**
 * Per-ER-id mechanic patches, keyed by the ER move id (NOT the pokerogue
 * MoveId). Resolved through `ER_ID_MAP.moves[erId]` so the patch lands on the
 * exact Move the game (and the audit worktable) treats as that ER move — this
 * is robust to the handful of vanilla id-map collisions (#151) where the ER id
 * maps to a pokerogue id whose `MoveId` enum constant differs (e.g. ER 868
 * "Kowtow Cleave" -> pk 901). Applied alongside the systemic crit pass below,
 * which uses the same keying.
 */
const ER_ID_MECHANIC_PATCHERS: ReadonlyMap<number, (move: MutableMove) => void> = new Map([
  // Secondary-effect swap: ER replaced the vanilla paralyze-on-hit with a
  // flinch chance (ROM effect 12, 30% — descriptions read "30% flinch chance").
  // Drop the inherited StatusEffectAttr(paralysis); move.chance (30) gates Flinch.
  [
    84, // Thunder Shock
    (move: MutableMove) => {
      removeAttrsByName(move, ["StatusEffectAttr"]);
      addAttrUnique(move, new FlinchAttr());
    },
  ],
  [
    122, // Lick
    (move: MutableMove) => {
      removeAttrsByName(move, ["StatusEffectAttr"]);
      addAttrUnique(move, new FlinchAttr());
    },
  ],
  // Absolute never-miss: ER's authored long-description states the move "Never
  // misses" / "Can't miss" unconditionally. pokerogue models never-miss as
  // accuracy = -1, but the numeric rebalance overwrote it with ER's nominal ROM
  // accuracy. Restore the sentinel. (Crit attrs come from the systemic crit pass.)
  [326, (move: MutableMove) => (move.accuracy = -1)], // Extrasensory
  [868, (move: MutableMove) => (move.accuracy = -1)], // Kowtow Cleave
  [905, (move: MutableMove) => (move.accuracy = -1)], // Tachyon Cutter
]);

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convenience type: a shape that exposes the otherwise-private mutable fields
 * on `Move` for ER's rebalance. We can't `Move & { _type: … }` because TS
 * sees the `_type` field as private on Move and the intersection collapses
 * to `never`. Instead we declare a fresh shape that includes only the
 * surface we touch, plus a passthrough for everything else via index access.
 *
 * All writes performed via this shape are runtime-safe — the `private`
 * modifier in TS is a compile-time check only, and the fields are plain
 * JS properties at runtime.
 */
interface MutableMove {
  _type: PokemonType;
  _category: MoveCategory;
  flags: number;
  power: number;
  accuracy: number;
  chance: number;
  attrs: MoveAttr[];
  /** Present only on charge moves (ChargingAttackMove); attrs applied on the charge turn. */
  chargeAttrs?: MoveAttr[];
  moveTarget: MoveTarget;
  addAttr(attr: MoveAttr): Move;
  [MOVE_PATCHED_MARKER]?: true;
}

/** Re-type the move (mutates the private `_type` field). */
function retypeMove(move: MutableMove, type: PokemonType): void {
  move._type = type;
}

/** Swap the move's category (mutates the private `_category` field). */
function setCategory(move: MutableMove, category: MoveCategory): void {
  move._category = category;
}

/** OR a {@linkcode MoveFlags} bit into the move's private `flags` bitmask. */
function orFlag(move: MutableMove, flag: MoveFlags): void {
  move.flags |= flag;
}

function clearFlag(move: MutableMove, flag: MoveFlags): void {
  move.flags &= ~flag;
}

/**
 * Add a pre-built `MoveAttr` to the move's attrs array, unless an attr of the
 * same exact constructor is already present (idempotency safeguard for
 * re-runs / overlapping audits).
 */
// ER (community batch 2026-06-11): field-setting RIDERS on damaging moves
// must never fail the move. Vanilla TerrainChangeAttr/WeatherChangeAttr
// attach a "not already active" MoveCondition, which made the genie Storms
// fail outright when their field was already up (Springtide Storm "always
// fails" ON misty terrain). These variants always pass the condition and
// treat an already-active field as a no-op.
class ErTerrainRiderNoFailAttr extends TerrainChangeAttr {
  override apply(user: Pokemon, target: Pokemon, move: Move, args: any[]): boolean {
    super.apply(user, target, move, args);
    return true;
  }
  override getCondition(): MoveConditionFunc {
    return () => true;
  }
}

class ErWeatherRiderNoFailAttr extends WeatherChangeAttr {
  override apply(user: Pokemon, target: Pokemon, move: Move, args: any[]): boolean {
    super.apply(user, target, move, args);
    return true;
  }
  override getCondition(): MoveConditionFunc {
    return () => true;
  }
}

// ER Synchronoise: the move's TYPE becomes the user's SECOND type (falls back
// to the first type for monotype users).
class ErMatchUserSecondTypeAttr extends VariableMoveTypeAttr {
  override apply(user: Pokemon, _target: Pokemon, _move: Move, args: any[]): boolean {
    const moveType = args[0] as { value: PokemonType };
    const types = user.getTypes(true, true);
    const second = types.at(-1);
    if (second === undefined) {
      return false;
    }
    moveType.value = second;
    return true;
  }
}

function addAttrUnique(move: MutableMove, attr: MoveAttr): void {
  const ctor = attr.constructor;
  for (const existing of move.attrs) {
    if (existing.constructor === ctor) {
      return;
    }
  }
  move.addAttr(attr);
}

/**
 * Remove all attrs whose constructor matches one of the provided constructors.
 * Used by TOTAL rewrites that strip vanilla mechanics (e.g. OHKO removal).
 */
function removeAttrsByCtor(move: MutableMove, ctors: ReadonlyArray<new (...args: never[]) => MoveAttr>): void {
  move.attrs = move.attrs.filter(a => !ctors.some(c => a.constructor === c));
}

/**
 * Remove all attrs whose constructor name matches one of the provided names.
 * String-based to avoid an import for every attr we strip (e.g.
 * ForceSwitchOutAttr, HalfSacrificialAttr) — only the constructor's runtime
 * `name` property is consulted.
 */
function removeAttrsByName(move: MutableMove, names: readonly string[]): void {
  move.attrs = move.attrs.filter(a => !names.includes(a.constructor.name));
}

/**
 * Apply ER's mechanic deltas to every vanilla pokerogue move with an entry
 * in {@linkcode MOVE_PATCHERS}. Idempotent via {@linkcode MOVE_PATCHED_MARKER}.
 *
 * Invoked from `initEliteReduxVanillaRebalance()` after the numeric retunes
 * have run, so the numeric values are already in place by the time the
 * mechanic patcher sees the Move.
 */
export function initEliteReduxVanillaMovePatches(): VanillaMovePatchResult {
  const result: VanillaMovePatchResult = {
    moveDeltas: 0,
    moveMissing: 0,
    moveErrors: [],
  };

  const moveById = new Map<number, Move>();
  for (const move of allMoves) {
    // `allMoves` is sparse (custom moves are id-indexed ≥5000); skip the holes.
    if (move === undefined) {
      continue;
    }
    moveById.set(move.id, move);
  }

  // Defensive: also collect the set of MoveIds that have ER vanilla entries,
  // so we can spot patchers that target ids ER doesn't ship. (Currently we
  // patch unconditionally — the dispatch table only lists ER-shipped vanilla
  // ids per the audit.)
  const erVanillaIds = new Set<number>();
  // ER's per-move text, keyed by pokerogue move id. When ER rewrites a vanilla
  // move's MECHANICS, its i18n description still describes the vanilla behavior
  // (e.g. Dragon Rush gained 33% recoil + 20% flinch but read like vanilla).
  // We pin `descriptionOverride` from the ER draft so every patched move reads
  // correctly. Prefer the detailed `longDescription` (states the actual mechanic),
  // fall back to the short `description`.
  const erMoveDescByPokerogueId = new Map<number, string>();
  for (const draft of ER_MOVES) {
    const pokerogueId = ER_ID_MAP.moves[draft.id];
    if (pokerogueId !== undefined && pokerogueId < VANILLA_ID_CUTOFF && draft.archetype === "vanilla") {
      erVanillaIds.add(pokerogueId);
      const desc = (draft.longDescription || draft.description || "").trim();
      if (desc) {
        erMoveDescByPokerogueId.set(pokerogueId, desc);
      }
    }
  }
  // Pin the ER description on a patched move, unless a patcher already set a
  // bespoke override (e.g. the Pledge moves) — never clobber that.
  const applyErMoveDescription = (mutable: MutableMove, pokerogueId: number): void => {
    if (mutable.descriptionOverride !== undefined) {
      return;
    }
    const desc = erMoveDescByPokerogueId.get(pokerogueId);
    if (desc) {
      // Set BOTH like the Pledge patch: `descriptionOverride` survives a future
      // re-localize (language change), while `effect` is the live text the UI
      // reads right now — `localize()` already ran at init, before this patch.
      mutable.descriptionOverride = desc;
      mutable.effect = desc;
    }
  };

  for (const [moveId, patcher] of MOVE_PATCHERS) {
    const move = moveById.get(moveId);
    if (!move) {
      result.moveMissing++;
      continue;
    }
    const mutable = move as unknown as MutableMove;
    if (mutable[MOVE_PATCHED_MARKER]) {
      continue;
    }
    try {
      patcher(mutable);
      applyErMoveDescription(mutable, moveId);
      Object.defineProperty(mutable, MOVE_PATCHED_MARKER, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
      });
      result.moveDeltas++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.moveErrors.push(`Patcher for move ${MoveId[moveId] ?? moveId} threw: ${msg}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Systemic ability-boost-note pass (#415): ER's authored move text tags every
  // move boosted by an ER ability with a trailing "<Ability> boost." sentence
  // (Striker for kicks, Keen Edge for slices, Iron Fist for punches, Strong Jaw
  // for bites, Mighty Horn, Mega Launcher - 85 vanilla moves). Only moves with
  // a MOVE_PATCHERS row got their ER description pinned, so unpatched moves
  // (High Jump Kick - live report) still read the vanilla text with no boost
  // note. APPEND the note(s) to the live description instead of replacing it,
  // keeping pokerogue's richer text for mechanically-unchanged moves.
  const BOOST_NOTE_RE = /[A-Z][A-Za-z' ]*? boost\./g;
  for (const draft of ER_MOVES) {
    const pokerogueId = ER_ID_MAP.moves[draft.id];
    if (pokerogueId === undefined || pokerogueId >= VANILLA_ID_CUTOFF || draft.archetype !== "vanilla") {
      continue;
    }
    const move = moveById.get(pokerogueId);
    if (!move) {
      continue;
    }
    const notes = ((draft.longDescription || "").match(BOOST_NOTE_RE) ?? []).map(n => n.trim());
    if (notes.length === 0) {
      continue;
    }
    const mutable = move as unknown as { descriptionOverride?: string; effect: string };
    const current = String(mutable.descriptionOverride ?? mutable.effect ?? "");
    const missing = notes.filter(n => !current.toLowerCase().includes(n.toLowerCase()));
    if (missing.length === 0) {
      continue;
    }
    const appended = `${current.trim()} ${missing.join(" ")}`.trim();
    mutable.descriptionOverride = appended;
    mutable.effect = appended;
    result.moveDeltas++;
  }

  // ---------------------------------------------------------------------------
  // Systemic crit pass — ER encodes "High Crit Rate" and "Always Crits" as ROM
  // flag bits (indices into ER_FLAG_NAMES_LIST), but pokerogue models them as
  // MoveAttrs (HighCritAttr / CritOnlyAttr), so the numeric rebalance loop never
  // applies them. Walk every ER vanilla move and graft the matching crit attr
  // from its ROM flags. This catches the whole class at once (Cut/Slash/Aerial
  // Ace -> always-crit; Horn Attack/Aqua Tail/X-Scissor/etc -> high-crit) instead
  // of hand-listing each move in MOVE_PATCHERS. Idempotent via addAttrUnique.
  // ---------------------------------------------------------------------------
  const ALWAYS_CRIT_FLAG = ER_FLAG_NAMES_LIST.indexOf("Always Crits");
  const HIGH_CRIT_FLAG = ER_FLAG_NAMES_LIST.indexOf("High Crit Rate");
  for (const draft of ER_MOVES) {
    const pokerogueId = ER_ID_MAP.moves[draft.id];
    if (pokerogueId === undefined || pokerogueId >= VANILLA_ID_CUTOFF || draft.archetype !== "vanilla") {
      continue;
    }
    const flags = draft.flags;
    if (!Array.isArray(flags)) {
      continue;
    }
    const move = moveById.get(pokerogueId);
    if (!move) {
      continue;
    }
    const mutable = move as unknown as MutableMove;
    if (ALWAYS_CRIT_FLAG >= 0 && flags.includes(ALWAYS_CRIT_FLAG)) {
      // Always-crit supersedes high-crit; drop the now-redundant HighCritAttr.
      const hadCrit = mutable.attrs.some(a => a.constructor === CritOnlyAttr);
      removeAttrsByCtor(mutable, [HighCritAttr]);
      addAttrUnique(mutable, new CritOnlyAttr());
      if (!hadCrit) {
        result.moveDeltas++;
      }
    } else if (HIGH_CRIT_FLAG >= 0 && flags.includes(HIGH_CRIT_FLAG)) {
      const hadCrit = mutable.attrs.some(a => a.constructor === HighCritAttr || a.constructor === CritOnlyAttr);
      addAttrUnique(mutable, new HighCritAttr());
      if (!hadCrit) {
        result.moveDeltas++;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Per-ER-id mechanic patches (flinch swaps, absolute never-miss). Keyed by ER
  // id and resolved via ER_ID_MAP so they land on the same Move the game treats
  // as that ER move, robust to the #151 id-map collisions.
  // ---------------------------------------------------------------------------
  for (const [erId, patcher] of ER_ID_MECHANIC_PATCHERS) {
    const pokerogueId = ER_ID_MAP.moves[erId];
    if (pokerogueId === undefined || pokerogueId >= VANILLA_ID_CUTOFF) {
      continue;
    }
    const move = moveById.get(pokerogueId);
    if (!move) {
      result.moveMissing++;
      continue;
    }
    const mutable = move as unknown as MutableMove;
    // Snapshot so re-runs (the patchers are idempotent in effect) don't inflate
    // the delta counter — the idempotency test asserts moveDeltas is 0 on re-run.
    const accBefore = mutable.accuracy;
    const sigBefore = mutable.attrs.map(a => a.constructor.name).join(",");
    try {
      patcher(mutable);
      const changed =
        mutable.accuracy !== accBefore || mutable.attrs.map(a => a.constructor.name).join(",") !== sigBefore;
      if (changed) {
        result.moveDeltas++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.moveErrors.push(`ER-id mechanic patcher for er ${erId} threw: ${msg}`);
    }
  }

  // ---------------------------------------------------------------------------
  // "Super effective vs <Type>" boosts. Several ER vanilla moves gained a
  // type-targeted super-effectiveness (e.g. Poison Gas vs Flying, Acid vs
  // Steel). We override the type-effectiveness multiplier itself (not the power)
  // so the game shows "It's super effective!", colours the hit, and the boost
  // can override a resistance/immunity (e.g. Acid is normally 0× vs Steel). A
  // silent power multiplier did none of that and players reported it as "doesn't
  // do 2× vs <type>". Keyed by ER id (resolved through ER_ID_MAP) so it lands on
  // the move the game uses, robust to #151 id-map collisions. Idempotent via
  // addAttrUnique. (Sonic Boom is excluded — it deals fixed damage.)
  // ---------------------------------------------------------------------------
  for (const [erId, targetType] of ER_ID_SUPER_EFFECTIVE_VS_TYPE) {
    const pokerogueId = ER_ID_MAP.moves[erId];
    if (pokerogueId === undefined || pokerogueId >= VANILLA_ID_CUTOFF) {
      continue;
    }
    const move = moveById.get(pokerogueId);
    if (!move) {
      result.moveMissing++;
      continue;
    }
    const mutable = move as unknown as MutableMove;
    const had = mutable.attrs.some(a => a.constructor === ErSuperEffectiveVsTypeAttr);
    addAttrUnique(mutable, new ErSuperEffectiveVsTypeAttr(targetType));
    // Pin the ER dex description too (e.g. Brine "Deals Super Effective damage vs
    // Water") - this loop is separate from MOVE_PATCHERS, so without this the mechanic
    // applied but the in-game text stayed vanilla (community report 2026-07-02:
    // "Brine doesn't say it's super effective vs Water"). Idempotent: no-op if a
    // bespoke override already pinned it.
    applyErMoveDescription(mutable, pokerogueId);
    if (!had) {
      result.moveDeltas++;
    }
  }

  return result;
}

/**
 * ER vanilla moves with a "super effective vs <Type>" clause, keyed by ER id.
 * Modeled as a x2 power multiplier vs the listed type (see the pass above).
 */
const ER_ID_SUPER_EFFECTIVE_VS_TYPE: ReadonlyMap<number, PokemonType> = new Map<number, PokemonType>([
  [13, PokemonType.ROCK], // Razor Wind
  [51, PokemonType.STEEL], // Acid
  [124, PokemonType.WATER], // Sludge
  [139, PokemonType.FLYING], // Poison Gas
  [329, PokemonType.WATER], // Sheer Cold
  [362, PokemonType.WATER], // Brine (#374)
  [443, PokemonType.STEEL], // Magnet Bomb
  [859, PokemonType.STEEL], // Gigaton Hammer
]);

/** Exported for tests: which move ids does the patcher table touch? */
export function getPatchedMoveIds(): readonly MoveId[] {
  return Array.from(MOVE_PATCHERS.keys());
}
