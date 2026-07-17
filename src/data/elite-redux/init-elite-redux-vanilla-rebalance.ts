// =============================================================================
// Elite Redux — Phase B Task B3: vanilla rebalance pass.
//
// ER ships its own balance pass on the vanilla pokerogue moves + abilities —
// different `power`, `pp`, `accuracy`, `priority`, `chance` (effectChance) on
// moves and reworked descriptions on abilities.
//
// For every ER entry whose pokerogue id resolves to < VANILLA_ID_CUTOFF (i.e.
// it shadows a real pokerogue move/ability — see `er-id-map.ts`), we PATCH
// the live `Move`/`Ability` instance in `allMoves` / `allAbilities` to match
// ER's numeric stats.
//
// This is a runtime patch step (like B1a's `_passives` overwrite). We do NOT
// modify pokerogue's source data files (`src/data/moves/move.ts`,
// `src/data/abilities/init-abilities.ts`) — that would create a huge diff and
// fight every future upstream merge. Instead we let pokerogue construct the
// baseline values normally, then mutate the mutable public fields.
//
// Mutability boundary (verified by reading the upstream classes):
//   - `Move`:    `power`, `accuracy`, `pp`, `priority`, `chance` are all
//                declared `public` non-readonly (move.ts:160-166). Safe to
//                assign directly. We do NOT patch `name`/`effect` here —
//                pokerogue derives those from i18next at construction time,
//                and ER's display strings live in the upcoming ER locale pack
//                (Phase C). Patching here would diverge from the i18n source.
//   - `Ability`: `description` is a `get` accessor backed by i18next
//                (ability.ts:69-74). No setter exists. We cannot rewrite the
//                vanilla ability descriptions at runtime without overriding
//                the getter per-instance (which would break i18n switching).
//                We deliberately do NOT patch descriptions — see Phase C ER
//                locale pack. However, the `attrs` array on Ability is a
//                read-only BINDING to a MUTABLE array (the type system blocks
//                the binding swap, not array mutations). The AbAttr instances
//                themselves also have private fields we can mutate via narrow
//                casts since the `readonly` modifier in TS is structural.
//                That gives us the lever we need to apply ER's MINOR (single-
//                knob retunes) and MAJOR (composite riders) ability deltas
//                without touching pokerogue's `init-abilities.ts`.
//
// Order constraint: must run AFTER `initMoves()` / `initAbilities()` (so the
// baseline values are in place) and AFTER `initEliteReduxCustomAbilities()` /
// `initEliteReduxCustomMoves()` (so we know whether a given id is custom).
// Vanilla customs are skipped — their values come from the ER draft directly
// in B2.
// =============================================================================

import {
  type AbAttr,
  type AbAttrBaseParams,
  AiMovegenMoveStatsAbAttr,
  type AiMovegenMoveStatsAbAttrParams,
  AlliedFieldDamageReductionAbAttr,
  AllyStatMultiplierAbAttr,
  ArenaTrapAbAttr,
  BlockCritAbAttr,
  BlockItemTheftAbAttr,
  BlockStatusDamageAbAttr,
  BlockWeatherDamageAttr,
  BypassBurnDamageReductionAbAttr,
  ChangeMovePriorityAbAttr,
  ConditionalCritAbAttr,
  DefensiveStatSubstituteAbAttr,
  FlinchStatStageChangeAbAttr,
  FogRestoreDisguiseFormChangeAbAttr,
  FullBurnDamageImmunityAbAttr,
  FullHpResistTypeAbAttr,
  getWeatherCondition,
  HealFromBerryUseAbAttr,
  IgnoreTypeStatusEffectImmunityAbAttr,
  MoveImmunityAbAttr,
  MovePowerBoostAbAttr,
  MoveTypeChangeAbAttr,
  MoveTypePowerBoostAbAttr,
  PokemonTypeChangeAbAttr,
  PostAttackApplyBattlerTagAbAttr,
  PostAttackContactApplyStatusEffectAbAttr,
  PostAttackRemoveTargetTypeAbAttr,
  PostAttackStealHeldItemAbAttr,
  PostBiomeChangeWeatherChangeAbAttr,
  PostDefendApplyArenaTrapTagAbAttr,
  PostDefendApplyBattlerTagAbAttr,
  PostDefendContactApplyTagChanceAbAttr,
  PostDefendPartyStatusHealAbAttr,
  PostDefendStatStageChangeAbAttr,
  PostIntimidateStatStageChangeAbAttr,
  PostReceiveCritStatStageChangeAbAttr,
  PostSummonAbAttr,
  PostSummonFogRestoreDisguiseAbAttr,
  PostSummonRemoveArenaTagAbAttr,
  PostSummonTerrainChangeAbAttr,
  PostSummonWeatherChangeAbAttr,
  PostTurnHurtIfSleepingAbAttr,
  PostTurnResetStatusAbAttr,
  PostWeatherLapseDamageAbAttr,
  PostWeatherLapseHealAbAttr,
  PreHitResistTypeChangeAbAttr,
  PreserveBaseStatAbilitiesAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  ReceivedTypeDamageMultiplierAbAttr,
  ReduceBurnDamageAbAttr,
  SelfStatDropImmunityAbAttr,
  StabBoostAbAttr,
  StatMultiplierAbAttr,
  StatusEffectImmunityAbAttr,
  TypeImmunityStatStageChangeAbAttr,
  UserFieldBattlerTagImmunityAbAttr,
  UserFieldMoveTypePowerBoostAbAttr,
} from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { allAbilities, allMoves } from "#data/data-lists";
import { BerserkOnThresholdAbAttr } from "#data/elite-redux/archetypes/berserk-on-threshold";
import {
  ChanceBattlerTagOnAttackAbAttr,
  ChanceStatusOnAttackAbAttr,
  ChanceStatusOnHitAbAttr,
} from "#data/elite-redux/archetypes/chance-status-on-hit";
import { ConditionalAlwaysHitAbAttr } from "#data/elite-redux/archetypes/conditional-always-hit";
import { CritStageBonusAbAttr } from "#data/elite-redux/archetypes/crit-mod";
import {
  DisableFoeItemsOnEntryAbAttr,
  DisableTargetItemOnContactAbAttr,
} from "#data/elite-redux/archetypes/disable-foe-items-on-entry";
import { DodgeFirstSuperEffectiveAbAttr } from "#data/elite-redux/archetypes/dodge-first-super-effective";
import { EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { EntryHazardImmunityAbAttr } from "#data/elite-redux/archetypes/entry-hazard-immunity";
import { EntryTailwindClearWeatherAbAttr } from "#data/elite-redux/archetypes/entry-tailwind-clear-weather";
import {
  FlareBoostSelfBurnOnSummonAbAttr,
  FlareBoostSelfBurnOnWeatherChangeAbAttr,
} from "#data/elite-redux/archetypes/flare-boost-fog-self-burn";
import { HealStatusOnMoveTypeAbAttr } from "#data/elite-redux/archetypes/heal-status-on-move-type";
import { IgnoreResistancesAbAttr } from "#data/elite-redux/archetypes/offensive-type-chart-override";
import { PostAttackChangeTargetTypeAbAttr } from "#data/elite-redux/archetypes/post-attack-change-target-type";
import { PostDefendChangeAttackerTypeAbAttr } from "#data/elite-redux/archetypes/post-defend-change-attacker-type";
import { PostDefendSuppressOpponentDamageBoostAbAttr } from "#data/elite-redux/archetypes/post-defend-suppress-opponent-damage-boost";
import { PostFaintDetonateAbAttr } from "#data/elite-redux/archetypes/post-faint-detonate";
import { RecoilDamageMultiplierAbAttr } from "#data/elite-redux/archetypes/recoil-damage-multiplier";
import { SelfHighestStatMultiplierAbAttr } from "#data/elite-redux/archetypes/self-highest-stat-multiplier";
import {
  StatTriggerOnHitAbAttr,
  StatTriggerOnStatLoweredAbAttr,
} from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { StatusMoveTypeImmunityBypassAbAttr } from "#data/elite-redux/archetypes/status-move-type-bypass";
import {
  ToxicTerrainSelfPoisonOnSummonAbAttr,
  ToxicTerrainSelfPoisonOnTerrainChangeAbAttr,
} from "#data/elite-redux/archetypes/toxic-terrain-self-poison";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { TypeImmunityHighestAttackStatStageAbAttr } from "#data/elite-redux/archetypes/type-immunity-highest-attack-stat-stage";
import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import { getErAbilityDescription, getErAbilityRomDescription } from "#data/elite-redux/er-ability-descriptions";
import { enAbilityName } from "#data/elite-redux/er-canonical-names";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { initEliteReduxVanillaMovePatches } from "#data/elite-redux/init-elite-redux-vanilla-move-patches";
import { Gender } from "#data/gender";
import type { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { PokemonType } from "#enums/pokemon-type";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import { BerryModifier, FieldEffectModifier } from "#modifiers/modifier";
import type { Move } from "#moves/move";
import { NumberHolder, randSeedInt } from "#utils/common";
import i18next from "i18next";

/**
 * Numeric cutoff for "vanilla pokerogue" ids — anything ≥ this is an ER
 * custom (registered by B2). Mirrors the cutoffs in
 * `init-elite-redux-custom-{moves,abilities}.ts`.
 */
const VANILLA_ID_CUTOFF = 5000;

/**
 * Dedicated internal move id for FOREWARN's delayed strike. Sits well above both
 * the vanilla range (≤ ~950) and the ER-custom range (5000–5186), so it can
 * never collide with a real move. NOT part of the MoveId enum — it is an
 * ability-internal move constructed at ER init (see {@linkcode registerForewarnFutureSight}).
 */
export const FOREWARN_FUTURE_SIGHT_ID = 9500 as MoveId;

/**
 * ER 2.65 Forewarn: "Casts an 80 BP Future Sight on the opposing Pokemon when
 * switching in. … The attack cannot miss once initiated and ignores accuracy
 * checks. This cannot target the same Pokemon twice."
 *
 * The delayed hit resolves via `allMoves[sourceMove]` (see `DelayedAttackTag`),
 * so a per-cast power clone can't reach it — Forewarn needs a DISTINCT registered
 * move. We shallow-clone the real 120-BP Future Sight (preserving its prototype
 * and attrs, incl. `DelayedAttackAttr`) into {@linkcode FOREWARN_FUTURE_SIGHT_ID}
 * with `power = 80` and `accuracy = -1` (bypasses the accuracy check → always
 * connects). The shared `attrs`/`conditions` are read-only at execution, so the
 * real Future Sight move is never mutated. The "cannot target the same Pokemon
 * twice" clause is honored by the DelayedAttack slot guard (`canAddTag` refuses a
 * second pending strike on an occupied slot). Idempotent.
 */
function registerForewarnFutureSight(): void {
  if (allMoves[FOREWARN_FUTURE_SIGHT_ID]) {
    return;
  }
  const base = allMoves[MoveId.FUTURE_SIGHT];
  if (!base) {
    return;
  }
  const clone = Object.assign(Object.create(Object.getPrototypeOf(base)), base) as Move;
  const w = clone as unknown as { id: number; power: number; accuracy: number };
  w.id = FOREWARN_FUTURE_SIGHT_ID;
  w.power = 80;
  w.accuracy = -1;
  // `Move.localize()` derives its i18n key from `MoveId[this.id]`; id 9500 has no
  // MoveId enum entry, so the language-reload re-localize pass in battle-scene.ts
  // would blank the clone's name to ".name" (the same reason ER custom moves
  // override localize()). Mirror the REAL Future Sight's localized name/effect
  // instead — set it now and on every re-localize.
  const relocalize = (): void => {
    const fs = allMoves[MoveId.FUTURE_SIGHT];
    const cw = clone as unknown as { name: string; effect: string };
    cw.name = fs?.name ?? "Future Sight";
    cw.effect = (fs as unknown as { effect?: string })?.effect ?? cw.name;
  };
  relocalize();
  (clone as unknown as { localize: () => void }).localize = relocalize;
  // `allMoves` is typed `readonly Move[]`; ER registers by index-write via the
  // same cast the custom-moves initializer uses.
  (allMoves as Move[])[FOREWARN_FUTURE_SIGHT_ID] = clone;
}

/**
 * Per-move target overrides for vanilla moves whose ER dump `target` field is
 * STALE vs the actual ROM behavior (#415). Flash is "natively multi-target" in
 * ER (live report; its ER description reads "a blast of light" hitting the
 * field) but the dump ships target 0 (SELECTED), so the data-driven spread
 * pass below can't catch it.
 */
const ER_VANILLA_TARGET_OVERRIDES: ReadonlyMap<number, MoveTarget> = new Map([
  [MoveId.FLASH as number, MoveTarget.ALL_NEAR_ENEMIES],
  // Tera Starstorm — ER dex #961 "Strikes both foes." Vanilla keeps a native
  // VariableTargetAttr that only widens to ALL_NEAR_ENEMIES when the user is a
  // terastallized Terapagos; ER always hits both foes. Force the spread target.
  [MoveId.TERA_STARSTORM as number, MoveTarget.ALL_NEAR_ENEMIES],
]);

/** Aggregated result of a single `initEliteReduxVanillaRebalance()` run. */
export interface VanillaRebalanceResult {
  /** Count of vanilla moves whose stat fields were updated. */
  moveDeltas: number;
  /** Count of individual move field assignments performed (a single move may bump 2+ fields). */
  moveFieldWrites: number;
  /**
   * Count of vanilla moves whose battle MECHANICS (type, category, attrs,
   * flags, target) were patched via the move-patcher dispatch table in
   * `init-elite-redux-vanilla-move-patches.ts`. Separate from `moveDeltas`
   * because numeric field writes and mechanic patches are independent —
   * a move may receive both, neither, or only one.
   */
  moveMechanicDeltas: number;
  /**
   * Count of vanilla abilities whose live `attrs`/AbAttr fields were mutated
   * to match ER's mechanic deltas. Counts each ability ONCE per run, even if
   * the patcher touched multiple of its attrs. Idempotent — a re-run sees the
   * patched marker and reports 0.
   */
  abilityDeltas: number;
  /**
   * Count of vanilla move/ability ids the ER id-map points to that don't exist
   * in pokerogue's runtime tables. These are NOT bugs — they're pre-existing
   * id-map drift from `scripts/elite-redux/builders/id-map.mjs`'s parser not
   * stripping block comments in `move-id.ts` (e.g. the commented-out G_MAX
   * block at lines 1705-1737 inflates the parser's id counter by 32). The
   * patcher cannot fix the live state for these — pokerogue simply does not
   * construct a Move for those slots.
   *
   * TODO(infra): fix id-map.mjs's `loadEnumValues` to strip block comments
   *              before regex-matching, which will eliminate this drift.
   */
  moveMissing: number;
  abilityMissing: number;
  /** Non-fatal real errors (currently unused — kept for API stability). */
  moveErrors: string[];
  abilityErrors: string[];
}

/**
 * Sentinel marker we install on each Ability instance we patch, so re-runs
 * can detect "already patched" and report `abilityDeltas: 0`. Stored as a
 * non-enumerable property to avoid polluting Object.keys / for-in loops.
 */
const PATCHED_MARKER = Symbol.for("er-vanilla-rebalance/patched");

/** Convenience type for casting an Ability to allow mutation of its `attrs` array. */
type MutableAbility = Ability & { attrs: AbAttr[]; [PATCHED_MARKER]?: true };

/**
 * Per-ability patcher dispatch table. The key is the pokerogue {@linkcode AbilityId},
 * and the value is the function that mutates the live `Ability` instance in
 * place. Each function should be self-contained — failures are caught at the
 * call site and reported via `result.abilityErrors`.
 *
 * Severity buckets (per the audit `docs/plans/elite-redux-vanilla-ability-audit.md`):
 *   - **MINOR**: single-knob numeric retune. Mutates an existing attr's
 *     private numeric field via a narrow cast.
 *   - **MAJOR**: composite rider — adds one or two new AbAttrs to the
 *     ability's `attrs` array alongside the vanilla ones.
 *   - **TOTAL**: complete rewrite. Replaces the entire attrs array.
 *
 * The dispatch table is the SINGLE source of truth for "which vanilla
 * abilities does ER rebalance". Adding a new entry = one row + one test.
 */
const ABILITY_PATCHERS: ReadonlyMap<AbilityId, (ability: MutableAbility) => void> = new Map([
  // ===== MINOR — Weather summoner duration (5 → 8 turns) =====
  // Subclass the PostSummonWeatherChangeAbAttr to set 8 turns after summoning.
  // (`globalScene.arena.weather.turnsLeft` is mutable; we patch it post-call.)
  [AbilityId.DRIZZLE, ab => patchWeatherSummoner(ab, WeatherType.RAIN, 8)],
  [AbilityId.SAND_STREAM, ab => patchWeatherSummoner(ab, WeatherType.SANDSTORM, 8)],
  [AbilityId.DROUGHT, ab => patchWeatherSummoner(ab, WeatherType.SUNNY, 8)],
  // SNOW_WARNING: ER uses HAIL (not SNOW) and 8-turn duration.
  [AbilityId.SNOW_WARNING, ab => patchWeatherSummoner(ab, WeatherType.HAIL, 8)],

  // ===== MINOR — Terrain summoner duration (5 → 8 turns) =====
  [AbilityId.PSYCHIC_SURGE, ab => patchTerrainSummoner(ab, 8)],
  [AbilityId.MISTY_SURGE, ab => patchTerrainSummoner(ab, 8)],
  [AbilityId.GRASSY_SURGE, ab => patchTerrainSummoner(ab, 8)],

  // Orichalcum Pulse (584) / Hadron Engine (587): ER dex sets sun / electric
  // terrain on entry for 8 turns (12 with Heat Rock / Terrain Extender, via the
  // FieldEffectModifier extension the ER summoner helpers re-apply). Vanilla
  // defaults to 5. The +33% ATK/SpAtk-in-field StatMultiplier attrs are left
  // untouched (already correct); only the summon duration is patched.
  [AbilityId.ORICHALCUM_PULSE, ab => patchWeatherSummoner(ab, WeatherType.SUNNY, 8)],
  [AbilityId.HADRON_ENGINE, ab => patchTerrainSummoner(ab, 8)],

  // ===== MINOR — Speed-in-weather multiplier (2.0 → 1.5) =====
  [AbilityId.SWIFT_SWIM, ab => mutateStatMultiplier(ab, Stat.SPD, 1.5)],
  [AbilityId.CHLOROPHYLL, ab => mutateStatMultiplier(ab, Stat.SPD, 1.5)],
  [AbilityId.SAND_RUSH, ab => mutateStatMultiplier(ab, Stat.SPD, 1.5)],
  // Slush Rush: ER spec is "1.5x Speed in hail/snow AND immune to hail damage".
  // Vanilla pokerogue only grants the speed boost, so add the hail/snow damage
  // block to match the description.
  [
    AbilityId.SLUSH_RUSH,
    ab => {
      mutateStatMultiplier(ab, Stat.SPD, 1.5);
      if (!ab.attrs.some(a => a instanceof BlockWeatherDamageAttr)) {
        ab.attrs.push(new BlockWeatherDamageAttr(WeatherType.HAIL, WeatherType.SNOW));
      }
    },
  ],
  [AbilityId.SURGE_SURFER, ab => mutateStatMultiplier(ab, Stat.SPD, 1.5)],

  // Seed Sower (869): ER dex adds "Also heals all party Pokemon's status
  // conditions" on top of vanilla's Grassy-Terrain-on-direct-hit. Append a
  // party-status-heal on the SAME PostDefend (direct-hit) trigger. The ability's
  // .bypassFaint() lets both halves still fire when the hit KOs the holder.
  [
    AbilityId.SEED_SOWER,
    ab => {
      if (!ab.attrs.some(a => a instanceof PostDefendPartyStatusHealAbAttr)) {
        ab.attrs.push(new PostDefendPartyStatusHealAbAttr());
      }
    },
  ],

  // Teraform Zero (739): ER spec is "Tera Shell + clears weather and terrain on
  // first entry". Vanilla pokerogue only wired the weather/terrain clear, so add
  // the Tera Shell full-HP resist (FullHpResistTypeAbAttr) on top.
  [
    AbilityId.TERAFORM_ZERO,
    ab => {
      if (!ab.attrs.some(a => a instanceof FullHpResistTypeAbAttr)) {
        ab.attrs.push(new FullHpResistTypeAbAttr());
      }
    },
  ],

  // Mycelium Might (510): ER spec adds "Status moves bypass all immunities and
  // type resistances" on top of vanilla's move-last + ignore-abilities. Two
  // riders: (1) a marker consumed in getMoveEffectiveness making the holder's
  // STATUS-category moves ignore TYPE-based immunity (Thunder Wave vs Ground,
  // powder vs Grass); (2) an IgnoreTypeStatusEffectImmunityAbAttr covering the
  // status-application type immunities (Toxic vs Steel, Will-O-Wisp vs Fire) —
  // the same primitive Corrosion uses.
  [
    AbilityId.MYCELIUM_MIGHT,
    ab => {
      if (!ab.attrs.some(a => a instanceof StatusMoveTypeImmunityBypassAbAttr)) {
        ab.attrs.push(new StatusMoveTypeImmunityBypassAbAttr());
      }
      if (!ab.attrs.some(a => a instanceof IgnoreTypeStatusEffectImmunityAbAttr)) {
        ab.attrs.push(
          // statusMoveOnly=true: only a STATUS move (Toxic vs Steel, Will-O-Wisp
          // vs Fire) pierces the type immunity — a damaging move's secondary
          // poison/burn does not (unlike Corrosion, which is any-move).
          new IgnoreTypeStatusEffectImmunityAbAttr(
            [StatusEffect.POISON, StatusEffect.TOXIC, StatusEffect.BURN],
            [PokemonType.STEEL, PokemonType.POISON, PokemonType.FIRE],
            true,
          ),
        );
      }
    },
  ],

  // ===== MINOR — HP-regen fractions (1/16 → 1/8) =====
  // PostWeatherLapseHealAbAttr healFactor: vanilla=1 (→ 1/16), ER=2 (→ 1/8).
  [AbilityId.RAIN_DISH, ab => mutateHealFactor(ab, 2)],
  [AbilityId.ICE_BODY, ab => mutateHealFactor(ab, 2)],

  // ===== MINOR — Status proc chance =====
  // CUTE_CHARM: 30% → 50% on defend + ER's "Also works on offense" — wire
  // the PostAttack contact-tag-apply for the offense direction. The defend
  // side stays on the original PostDefendContactApplyTagChance attr.
  [
    AbilityId.CUTE_CHARM,
    ab => {
      mutateContactTagChance(ab, BattlerTagType.INFATUATED, 50);
      ab.attrs.push(new PostAttackApplyBattlerTagAbAttr(true, () => 50, BattlerTagType.INFATUATED));
    },
  ],
  // HEALER: 50% → 30% (also extends target to self — minor variant, just the chance for now)
  [AbilityId.HEALER, ab => patchHealerChance(ab)],

  // ===== MINOR — Damage fractions =====
  // BAD_DREAMS: 1/8 → 1/4 foe HP loss.
  [AbilityId.BAD_DREAMS, ab => patchBadDreams(ab)],

  // ===== MINOR — Move power multipliers =====
  // IRON_FIST: 1.2 → 1.3.
  [AbilityId.IRON_FIST, ab => mutateFlagPowerBoost(ab, MoveFlags.PUNCHING_MOVE, 1.3)],
  // STRONG_JAW: 1.5 → 1.3 (yes, ER REDUCES this).
  [AbilityId.STRONG_JAW, ab => mutateFlagPowerBoost(ab, MoveFlags.BITING_MOVE, 1.3)],
  // NEUROFORCE: SE outgoing 1.25 → 1.35.
  [AbilityId.NEUROFORCE, ab => mutateMovePowerBoost(ab, 1.35)],
  // STEELY_SPIRIT: Steel-type self+ally 1.5 → 1.3.
  [AbilityId.STEELY_SPIRIT, ab => mutateUserFieldTypeBoost(ab, 1.3)],
  // TRANSISTOR: Electric 1.3 → 1.5.
  [AbilityId.TRANSISTOR, ab => mutateTypePowerBoost(ab, 1.5)],

  // ===== MINOR — Stat multipliers =====
  // VICTORY_STAR: 1.1 → 1.2 (acc for self and ally).
  [AbilityId.VICTORY_STAR, ab => mutateAllAccBoosts(ab, 1.2)],

  // ===== MINOR — Damage taken multipliers (SE 0.75 → 0.65) =====
  [AbilityId.FILTER, ab => mutateReceivedDamageMultiplier(ab, 0.65)],
  [AbilityId.SOLID_ROCK, ab => mutateReceivedDamageMultiplier(ab, 0.65)],
  [AbilityId.PRISM_ARMOR, ab => mutateReceivedDamageMultiplier(ab, 0.65)],

  // ===== MINOR — Friend Guard: -25% ally damage → -50% =====
  [AbilityId.FRIEND_GUARD, ab => mutateAlliedFieldReduction(ab, 0.5)],

  // ===== MINOR — Defeatist threshold 0.5 → 0.333 =====
  [AbilityId.DEFEATIST, ab => patchDefeatistThreshold(ab)],

  // ===== MINOR — OVERGROW / BLAZE / TORRENT / SWARM: add 1.2x baseline =====
  // ER ships these as "1.2x always + 1.5x at low HP" — add the always-on 1.2x.
  [AbilityId.OVERGROW, ab => addBaselineTypeBoost(ab, PokemonType.GRASS, 1.2)],
  [AbilityId.BLAZE, ab => addBaselineTypeBoost(ab, PokemonType.FIRE, 1.2)],
  [AbilityId.TORRENT, ab => addBaselineTypeBoost(ab, PokemonType.WATER, 1.2)],
  [AbilityId.SWARM, ab => addBaselineTypeBoost(ab, PokemonType.BUG, 1.2)],

  // ===== MAJOR composites — add a rider attr alongside the vanilla one. =====
  // BATTLE_ARMOR: crit immune + 20% damage reduction from all attacks.
  [
    AbilityId.BATTLE_ARMOR,
    ab => {
      ab.attrs.push(new ReceivedMoveDamageMultiplierAbAttr(() => true, 0.8));
    },
  ],
  // SHELL_ARMOR (75): ER spec "Immune to critical hits. Takes 20% less
  // damage from attacks." Same rider as BATTLE_ARMOR.
  [
    AbilityId.SHELL_ARMOR,
    ab => {
      ab.attrs.push(new ReceivedMoveDamageMultiplierAbAttr(() => true, 0.8));
    },
  ],
  // VITAL_SPIRIT (72): ER spec "Can't fall asleep. Fighting-type moves heal
  // status." Vanilla just blocks sleep; the HealStatusOnMoveType primitive adds
  // the cure-on-Fighting-attack rider (PostAttack hook), curing the holder's
  // primary status immediately after a Fighting-type move connects.
  [
    AbilityId.VITAL_SPIRIT,
    ab => {
      ab.attrs.push(new HealStatusOnMoveTypeAbAttr(PokemonType.FIGHTING));
    },
  ],
  // AIR_LOCK (76): ER spec "Cloud Nine + Air Blower." Cloud Nine (weather
  // suppression while on field) is the vanilla base ability. The Air Blower half
  // — set Tailwind 3 turns + clear current (mutable) weather on entry — is added
  // by the EntryTailwindClearWeather PostSummon primitive.
  [
    AbilityId.AIR_LOCK,
    ab => {
      ab.attrs.push(new EntryTailwindClearWeatherAbAttr());
    },
  ],
  // STENCH (1): ER spec ALLEGEDLY says "Toxic terrain is permanent" but ER
  // C source (vendor/elite-redux/source/src/battle_util.c:9801) implements
  // ONLY the 10% flinch — same as vanilla pokerogue. NO PATCH NEEDED.
  // DAMP (6): ER spec ALLEGEDLY adds "Makes foe Water-type on contact"
  // but ER C source only implements explosion-block (matches vanilla).
  // NO PATCH NEEDED.
  // IMMUNITY: poison immune + halves damage taken from Poison-type moves.
  [
    AbilityId.IMMUNITY,
    ab => {
      ab.attrs.push(new ReceivedTypeDamageMultiplierAbAttr(PokemonType.POISON, 0.5));
    },
  ],
  // MAGMA_ARMOR: freeze immune + 30% damage reduction from Water/Ice moves.
  [
    AbilityId.MAGMA_ARMOR,
    ab => {
      ab.attrs.push(new ReceivedTypeDamageMultiplierAbAttr(PokemonType.WATER, 0.7));
      ab.attrs.push(new ReceivedTypeDamageMultiplierAbAttr(PokemonType.ICE, 0.7));
    },
  ],
  // OVERCOAT: weather/powder immunity + 20% reduction on special damage.
  // Vanilla is ignorable + has BlockWeatherDamageAttr + MoveImmunityAbAttr(POWDER).
  // We add a ReceivedMoveDamageMultiplierAbAttr that fires on special moves.
  [
    AbilityId.OVERCOAT,
    ab => {
      ab.attrs.push(
        new ReceivedMoveDamageMultiplierAbAttr((_target, _user, move) => move.category === MoveCategory.SPECIAL, 0.8),
      );
    },
  ],
  // WATER_COMPACTION: hit by water → +2 Def + 50% damage reduction from water.
  [
    AbilityId.WATER_COMPACTION,
    ab => {
      ab.attrs.push(new ReceivedTypeDamageMultiplierAbAttr(PokemonType.WATER, 0.5));
    },
  ],
  // KEEN_EYE: ER spec is "Immune to accuracy drops. Grants a 1.2x accuracy
  // boost." Vanilla already has ProtectStatAbAttr(ACC) for the immunity.
  // Audit-fix: prior wire pushed IgnoreOpponentStatStages([EVA]) — NOT in
  // the ER spec. Removed; only the 1.2x ACC multiplier is added.
  [
    AbilityId.KEEN_EYE,
    ab => {
      ab.attrs.push(new StatMultiplierAbAttr(Stat.ACC, 1.2));
    },
  ],
  // LONG_REACH: no contact + 1.2x physical damage.
  [
    AbilityId.LONG_REACH,
    ab => {
      ab.attrs.push(new MovePowerBoostAbAttr((_user, _target, move) => move.category === MoveCategory.PHYSICAL, 1.2));
    },
  ],
  // HEAVY_METAL: ER dex is "takes half damage from Ghost and Dark AND doubles
  // weight" — the weight-doubling is KEPT (the dex still lists it), only the
  // Ghost/Dark resist is ADDED on top of vanilla's WeightMultiplierAbAttr(2).
  [
    AbilityId.HEAVY_METAL,
    ab => {
      ab.attrs.push(new ReceivedTypeDamageMultiplierAbAttr(PokemonType.GHOST, 0.5));
      ab.attrs.push(new ReceivedTypeDamageMultiplierAbAttr(PokemonType.DARK, 0.5));
    },
  ],
  // ROCKY_PAYLOAD: ER dex is "boosts Rock-type AND throwing-based moves by 50%".
  // Vanilla already gives the Rock-type +50%; add the throwing-move (THROW_BASED)
  // +50% on top (Fling, Egg Bomb, Rock Throw/Slide/Tomb/Wrecker, Grav Apple, ...).
  [
    AbilityId.ROCKY_PAYLOAD,
    ab => {
      ab.attrs.push(new MovePowerBoostAbAttr((_user, _target, move) => move.hasFlag(MoveFlags.THROW_BASED), 1.5));
    },
  ],
  // LIGHT_METAL: weight 0.5x + 1.3x Speed.
  [
    AbilityId.LIGHT_METAL,
    ab => {
      ab.attrs.push(new StatMultiplierAbAttr(Stat.SPD, 1.3));
    },
  ],
  // HYPER_CUTTER: ER spec is "Enemies can't lower Atk/SpAtk. Contact moves
  // get +1 Crit." Vanilla has ProtectStatAbAttr(ATK); we extend to SPATK
  // and now ALSO add CritStageBonusAbAttr({bonus:1, filter:MAKES_CONTACT})
  // (audit-fix: was deferred to "round 2"; round-2 lands here).
  [
    AbilityId.HYPER_CUTTER,
    ab => {
      addStatProtect(ab, Stat.SPATK);
      ab.attrs.push(new CritStageBonusAbAttr({ bonus: 1, filter: { flag: MoveFlags.MAKES_CONTACT } }));
    },
  ],
  // INNER_FOCUS: flinch immune + Intimidate immune + Scare immune + "Focus
  // Blast never misses". Vanilla already has BattlerTagImmunityAbAttr(FLINCHED)
  // + IntimidateImmunity. ER also wants Scare immunity (extend BattlerTagImmunity
  // to ER_FEAR) AND the ER "Focus Blast never misses" clause. The latter
  // cascades to the composites that embed Inner Focus (489 Enlightened, 661
  // Unlocked Potential, 679 Way of Precision) since they copy its attrs.
  [
    AbilityId.INNER_FOCUS,
    ab => {
      extendBattlerTagImmunity(ab, BattlerTagType.ER_FEAR);
      if (!ab.attrs.some(a => a instanceof ConditionalAlwaysHitAbAttr)) {
        ab.attrs.push(new ConditionalAlwaysHitAbAttr({ moveIds: [MoveId.FOCUS_BLAST] }));
      }
    },
  ],
  // ANGER_SHELL: ER spec (abbr "applies Shell Smash" + full "by 2 stages each")
  // is FULL Shell Smash on dropping below 1/2 HP — +2 ATK/SpAtk/Spd, -1 Def/SpDef.
  // Vanilla pokerogue wires the offensive boost at +1; bump the positive
  // PostDefendHpGated rider to +2 (the -1 defensive rider is already correct).
  [
    AbilityId.ANGER_SHELL,
    ab => {
      for (const a of ab.attrs) {
        if (a.constructor.name === "PostDefendHpGatedStatStageChangeAbAttr") {
          const gated = a as unknown as { stages: number };
          if (gated.stages === 1) {
            gated.stages = 2;
          }
        }
      }
    },
  ],
  // TANGLED_FEET: ER spec "uses Speed as defensive stat when confused or enraged"
  // (FULL: "uses its Speed stat instead of Defense or Special Defense for damage
  // calculations"). Vanilla pokerogue wired the unrelated Gen-IV behaviour
  // (confusion-gated evasion ×2) — strip it and add the defensive-stat substitute,
  // gated on the CONFUSED tag or the ER_ENRAGE status (the enrage recoil status).
  [
    AbilityId.TANGLED_FEET,
    ab => {
      ab.attrs = ab.attrs.filter(a => !(a instanceof StatMultiplierAbAttr && a.stat === Stat.EVA));
      const sub = new DefensiveStatSubstituteAbAttr(Stat.SPD);
      sub.addCondition(
        pokemon => !!pokemon.getTag(BattlerTagType.CONFUSED) || !!pokemon.getTag(BattlerTagType.ER_ENRAGE),
      );
      ab.attrs.push(sub);
    },
  ],
  // OBLIVIOUS: infatuation/taunt/intimidate immune + Scare immune.
  [AbilityId.OBLIVIOUS, ab => extendBattlerTagImmunity(ab, BattlerTagType.ER_FEAR)],
  // OWN_TEMPO: confusion/intimidate immune + Scare immune.
  [AbilityId.OWN_TEMPO, ab => extendBattlerTagImmunity(ab, BattlerTagType.ER_FEAR)],

  // ===== MAJOR — Entry-effect riders =====
  // WATER_VEIL: burn immune + Aqua Ring on entry.
  [
    AbilityId.WATER_VEIL,
    ab => {
      ab.attrs.push(new EntryEffectAbAttr({ kind: "scripted-move", move: MoveId.AQUA_RING }));
    },
  ],
  // TURBOBLAZE: bypass abilities + add Fire type to self on entry.
  // ER 2.65 dex: does NOT bypass abilities that modify base stats (Grass Pelt,
  // Fur Coat, etc.) — PreserveBaseStatAbilitiesAbAttr keeps those active through
  // the ability-bypass (mirrors Blind Rage 694).
  [
    AbilityId.TURBOBLAZE,
    ab => {
      ab.attrs.push(new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.FIRE }));
      ab.attrs.push(new PreserveBaseStatAbilitiesAbAttr());
    },
  ],
  // TERAVOLT: bypass abilities + add Electric type to self on entry.
  // Same base-stat-ability preservation clause as Turboblaze (see above).
  [
    AbilityId.TERAVOLT,
    ab => {
      ab.attrs.push(new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.ELECTRIC }));
      ab.attrs.push(new PreserveBaseStatAbilitiesAbAttr());
    },
  ],

  // ===== MAJOR — Status / damage riders =====
  // TOXIC_BOOST: +50% Atk if poisoned (vanilla) + immune to poison damage +
  // self-poisons in Toxic Terrain regardless of grounding (ER dex).
  [
    AbilityId.TOXIC_BOOST,
    ab => {
      ab.attrs.push(new BlockStatusDamageAbAttr(StatusEffect.POISON, StatusEffect.TOXIC));
      ab.attrs.push(new ToxicTerrainSelfPoisonOnSummonAbAttr());
      ab.attrs.push(new ToxicTerrainSelfPoisonOnTerrainChangeAbAttr());
    },
  ],
  // WEAK_ARMOR: was vanilla "physical hit"; ER says "contact hit".
  // Mutate the predicate of vanilla's PostDefendStatStageChangeAbAttr instances
  // to use a MAKES_CONTACT check rather than category === PHYSICAL.
  [AbilityId.WEAK_ARMOR, ab => mutateWeakArmorPredicate(ab)],
  // STAMINA: +1 Def on hit (vanilla) + maximize Def on crit (rider).
  [
    AbilityId.STAMINA,
    ab => {
      ab.attrs.push(new PostReceiveCritStatStageChangeAbAttr(Stat.DEF, 12));
    },
  ],
  // ANGER_POINT: ER spec (ability 83) is "Getting hit raises Atk by +1.
  // Critical hits maximize Attack." — i.e. +1 on EVERY damaging hit, max on crit
  // (mirrors Tipping Point/Fortitude). The base crit→max-Atk piece lives in
  // init-abilities; here we add the +1-on-any-damaging-hit rider via the clean
  // `StatTriggerOnHitAbAttr` primitive (gated to connected damaging moves, any
  // category — NOT physical-only, NOT crit-only). A prior rider was removed under
  // #224 ("triggers when it shouldn't"), but that contradicted the ER spec and
  // left non-crit hits doing nothing (the reported "+0 and it didn't activate").
  [
    AbilityId.ANGER_POINT,
    ab => {
      ab.attrs.push(new StatTriggerOnHitAbAttr({ stats: [{ stat: Stat.ATK, stages: 1 }] }));
    },
  ],
  // MAGICIAN: was vanilla "steal any successful hit"; ER requires non-contact.
  [AbilityId.MAGICIAN, ab => patchMagicianPredicate(ab)],
  // MERCILESS: vanilla always-crits poisoned. ER extends to paralyzed + bleed + sleep.
  [AbilityId.MERCILESS, ab => extendMercilessConditions(ab)],

  // ===== MAJOR — type-conversion "-ate" family (two mutually-exclusive branches) =====
  // ER 2.65 dex: each converts Normal→X and then, IF the user is X-type, its X
  // moves gain a 10% secondary; OTHERWISE it gains X STAB. The typed damage boost
  // is gated to NON-X users (the "gains STAB" branch, kept at the prior 1.2x
  // approximation to avoid a damage regression); the type-user branch adds the
  // 10% secondary status/tag on X moves.
  // 174 REFRIGERATE — Ice user: 10% frostbite; else: Ice boost.
  [
    AbilityId.REFRIGERATE,
    ab => {
      ab.attrs.push(
        new TypeDamageBoostAbAttr({ type: PokemonType.ICE, multiplier: 1.2 }).addCondition(
          p => !p.isOfType(PokemonType.ICE),
        ),
      );
      ab.attrs.push(
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 10,
          tags: [BattlerTagType.ER_FROSTBITE],
          filter: { type: PokemonType.ICE },
        }).addCondition(p => p.isOfType(PokemonType.ICE)),
      );
    },
  ],
  // 182 PIXILATE — Fairy user: 10% infatuate; else: Fairy boost.
  [
    AbilityId.PIXILATE,
    ab => {
      ab.attrs.push(
        new TypeDamageBoostAbAttr({ type: PokemonType.FAIRY, multiplier: 1.2 }).addCondition(
          p => !p.isOfType(PokemonType.FAIRY),
        ),
      );
      ab.attrs.push(
        new ChanceBattlerTagOnAttackAbAttr({
          chance: 10,
          tags: [BattlerTagType.INFATUATED],
          filter: { type: PokemonType.FAIRY },
        }).addCondition(p => p.isOfType(PokemonType.FAIRY)),
      );
    },
  ],
  // 184 AERILATE — dex: "Changes Normal moves to Flying. If the user is
  // Flying-type its Flying moves are 10% faster, otherwise it gains Flying STAB."
  // The ER ROM (battle_util.c) implements the "10% faster" clause as a flat 1.1×
  // DAMAGE modifier on the ate-converted Flying move (identical to every sibling
  // -ate ability: Refrigerate/Pixilate/Galvanize all `MulModifier(1.1)`), NOT a
  // speed/priority effect — the dex "faster" wording is garbled flavor, and a
  // per-move-type speed boost can't reach turn order here (SPD is queried with
  // MoveId.NONE at ordering time). So:
  //   • non-Flying user → 1.2× Flying-move boost (approximates the missing STAB).
  //   • Flying user     → 1.1× Flying-move boost (the ROM's ate bonus), on top of
  //     the natural 1.5× Flying STAB the engine already grants a Flying user.
  [
    AbilityId.AERILATE,
    ab => {
      ab.attrs.push(
        new TypeDamageBoostAbAttr({ type: PokemonType.FLYING, multiplier: 1.2 }).addCondition(
          p => !p.isOfType(PokemonType.FLYING),
        ),
      );
      ab.attrs.push(
        new TypeDamageBoostAbAttr({ type: PokemonType.FLYING, multiplier: 1.1 }).addCondition(p =>
          p.isOfType(PokemonType.FLYING),
        ),
      );
    },
  ],
  // 206 GALVANIZE — Electric user: 10% paralyze; else: Electric boost.
  [
    AbilityId.GALVANIZE,
    ab => {
      ab.attrs.push(
        new TypeDamageBoostAbAttr({ type: PokemonType.ELECTRIC, multiplier: 1.2 }).addCondition(
          p => !p.isOfType(PokemonType.ELECTRIC),
        ),
      );
      ab.attrs.push(
        new ChanceStatusOnAttackAbAttr({
          chance: 10,
          effects: [StatusEffect.PARALYSIS],
          filter: { type: PokemonType.ELECTRIC },
        }).addCondition(p => p.isOfType(PokemonType.ELECTRIC)),
      );
    },
  ],

  // ===== MAJOR — trap-predicate extensions (Ghost-immune) =====
  // SHADOW_TAG / MAGNET_PULL / ARENA_TRAP — ER adds Ghost-type bypass.
  [AbilityId.SHADOW_TAG, ab => extendArenaTrapToIgnoreGhost(ab)],
  [AbilityId.MAGNET_PULL, ab => extendArenaTrapToIgnoreGhost(ab)],
  [AbilityId.ARENA_TRAP, ab => extendArenaTrapToIgnoreGhost(ab)],

  // AROMA_VEIL: ER 2.65 dex mandates protection from infatuation, heal block, AND
  // the disabling moves "including Disable, Taunt, Encore, and Torment" — the full
  // vanilla six-tag set. No patcher: the vanilla UserFieldBattlerTagImmunityAbAttr
  // (INFATUATED/TAUNT/DISABLED/TORMENT/HEAL_BLOCK/ENCORE) already matches the dex.

  // ===== MAJOR — DAMP: ER repurposes it from "prevent explosions" to "makes the
  // attacker Water-type on contact" (offense+defense). Code had kept vanilla Damp.
  [AbilityId.DAMP, ab => patchDamp(ab)],

  // ===== MAJOR — AFTERMATH: vanilla 1/4 max HP on contact KO -> ER flat 25% on any KO.
  [AbilityId.AFTERMATH, ab => patchAftermath(ab)],

  // ===== MAJOR — COLOR_CHANGE: vanilla post-hit "become the move's type" -> ER
  // pre-hit "become a type that resists/negates the move" (applied before damage).
  [AbilityId.COLOR_CHANGE, ab => patchColorChange(ab)],

  // ===== MAJOR — FOREWARN: replace reveal-strongest-move with scripted Future Sight on entry.
  [AbilityId.FOREWARN, ab => patchForewarn(ab)],

  // ===== MAJOR — PASTEL_VEIL replaced with Safeguard on entry =====
  [AbilityId.PASTEL_VEIL, ab => patchPastelVeil(ab)],

  // ===== MAJOR — LEAF_GUARD: vanilla "status immunity in sun" -> ER "cure status at turn end in sun".
  [AbilityId.LEAF_GUARD, ab => patchLeafGuard(ab)],

  // ===== MAJOR — FLOWER_GIFT changes self+ally ATK boost to SPATK boost =====
  [AbilityId.FLOWER_GIFT, ab => patchFlowerGift(ab)],

  // ===== MAJOR — SOLAR_POWER drops the in-sun self-damage =====
  // ER spec (er-abilities.ts id 94 / er-ability-rom-descriptions.ts:
  // "Boosts the Pokemon's highest attacking stat by 50% during sun.") is a
  // PURE Sp.Atk boost in sun — it does NOT chip 1/8 max HP each turn the way
  // vanilla pokerogue Solar Power does. Strip the PostWeatherLapseDamageAbAttr
  // and keep the StatMultiplier(SPATK, 1.5).
  [AbilityId.SOLAR_POWER, ab => patchSolarPower(ab)],

  // ===== TOTAL rewrites =====
  // BIG_PECKS: vanilla "Def-drop immune"; ER "contact moves +30% boost".
  [AbilityId.BIG_PECKS, ab => rewriteBigPecks(ab)],
  // ILLUMINATE: replace with pure 1.2x accuracy boost.
  [AbilityId.ILLUMINATE, ab => rewriteIlluminate(ab)],
  [AbilityId.RIVALRY, ab => rewriteRivalry(ab)],
  // CHEEK_POUCH: nulled in ER — clear attrs.
  [AbilityId.CHEEK_POUCH, ab => rewriteCheekPouch(ab)],
  // STALL: replace move-last priority with "30% less damage if hasn't moved yet".
  [AbilityId.STALL, ab => rewriteStall(ab)],
  // HEAVY_METAL handled above in the MAJOR section (TOTAL upgrade integrated).
  // OPPORTUNIST: replace stat-copy with priority +1 vs foes below 1/2 HP.
  [AbilityId.OPPORTUNIST, ab => rewriteOpportunist(ab)],

  // ===== Round 3: more MINOR / MAJOR patches from the audit =====
  // 178 MEGA_LAUNCHER: pulse moves 1.5x → 1.3x (audit MINOR retune).
  [AbilityId.MEGA_LAUNCHER, ab => mutateMovePowerBoost(ab, 1.3)],
  // 6 STURDY: ER 2.65 dex — "At full HP, cannot be KO in one hit, stays at 1 HP
  // instead." The survive-at-1-HP clause is vanilla pokerogue Sturdy's
  // PreDefendFullHpEndureAbAttr (already wired), so no rider is needed. The other
  // vanilla-Sturdy clause (BlockOneHitKOAbAttr, which makes OHKO moves FAIL) is
  // DEAD in ER: all four OHKO moves (Guillotine/Horn Drill/Fissure/Sheer Cold) are
  // converted to regular damaging moves in init-elite-redux-vanilla-move-patches.ts
  // (OneHitKOAttr stripped), so nothing ever triggers the block. The community
  // "Guillotine fails on Sturdy" report is STALE - it predates that OHKO->regular
  // conversion; ER Guillotine is now a 120-BP Bug move with no Sturdy interaction.

  // 7 LIMBER: ER spec is "Para immune, takes half recoil, immune to self
  // stat drops." Vanilla pokerogue Limber covers paralysis immunity; ER
  // adds (a) ProtectStatAbAttr for the self-stat-drop guard (Clear-Body
  // parity) and (b) half recoil — the latter needs engine support that
  // doesn't yet exist (BlockRecoilDamageAttr is binary all-or-nothing),
  // so we wire the stat-protect piece and leave half-recoil as a partial.
  // Prior code mistakenly extended INFATUATED-immunity which is NOT in
  // the ER 7 spec; that rider is removed by overwriting the attrs in
  // patchLimber() rather than appending.
  [AbilityId.LIMBER, ab => patchLimber(ab)],
  // 29 CLEAR_BODY / 230 FULL_METAL_BODY: ER 2.65 dex - "immunity to all stat
  // reductions from moves and abilities. Includes self stat drops from moves like
  // Overheat." The vanilla ProtectStatAbAttr (already wired in init-abilities) only
  // blocks INCOMING drops; add SelfStatDropImmunityAbAttr so the holder's OWN
  // Overheat / Draco Meteor / Close Combat drops are negated too (reported: Flygon
  // Redux + Draco Meteor still lost SpAtk through Clear Body). White Smoke is a
  // DIFFERENT ability in ER (Smokescreen on entry), so it is deliberately excluded.
  [AbilityId.CLEAR_BODY, ab => patchSelfStatDropImmunity(ab)],
  [AbilityId.FULL_METAL_BODY, ab => patchSelfStatDropImmunity(ab)],
  // 39 INNER_FOCUS already handled in MAJOR section above (FEAR immunity extension).

  // 161 BIG_PECKS already TOTAL above.
  // 100 STALL already TOTAL above.

  // 233 NEUROFORCE / 262 TRANSISTOR already MINOR-patched above.
  // 89 IRON_FIST already MINOR-patched above.
  // 89-cluster (PUNCH/BITE/SLICE) — STRONG_JAW already patched. Add 132 SHARPNESS (slice 1.5x).
  // SHARPNESS is gen-9 — present in pokerogue. ER spec: "Slicing moves 1.5x" (vanilla baseline).
  // Already at 1.5 by default; no-op. Skipped.

  // ===== Round 4: chance-status composite additions =====
  // 9 STATIC: ER 2.65 dex — "chance to paralyze when attacking OR when hit by a
  // move: 30% on contact attacks, 10% on non-contact attacks" (bidirectional).
  // Defense side: vanilla 30% contact PRZ + a 10% non-contact tier. Offense side:
  // mirror FLAME_BODY — 30% on-contact + 10% non-contact procs against the target.
  [
    AbilityId.STATIC,
    ab => {
      addNonContactStatusChance(ab, StatusEffect.PARALYSIS, 10);
      addOffenseContactStatusChance(ab, StatusEffect.PARALYSIS, 30);
      addOffenseNonContactStatusChance(ab, StatusEffect.PARALYSIS, 10);
    },
  ],
  // 49 FLAME_BODY: vanilla 30% contact burn → ER adds 20% non-contact burn.
  // ER spec: "Also works on offense" — add 30% on-attack contact proc too.
  [
    AbilityId.FLAME_BODY,
    ab => {
      addNonContactStatusChance(ab, StatusEffect.BURN, 20);
      addOffenseContactStatusChance(ab, StatusEffect.BURN, 30);
      addOffenseNonContactStatusChance(ab, StatusEffect.BURN, 20);
    },
  ],

  // 115 ICE_BODY duplicate-flagged in MAJOR for the 2x heal-rate. Already
  // patched above; no double-add.

  // ===== Round 5: more poison/non-contact procs from the audit =====
  // 38 POISON_POINT: vanilla 30% contact poison. ER ROM text: "Has a 30% chance
  // to inflict poison on CONTACT MOVES, both when attacking and being attacked."
  // → contact-only on BOTH sides; NO non-contact tier (unlike Static/Flame Body).
  // Prior code added a 10% non-contact poison tier, which made ranged moves
  // (Water Gun, Ember, …) poison the holder — a regression vs the ROM spec.
  // Keep only the offense-side contact proc ("also works on offense").
  [AbilityId.POISON_POINT, ab => addOffenseContactStatusChance(ab, StatusEffect.POISON, 30)],
  // 27 EFFECT_SPORE: ER ROM spec is CONTACT-only (SLP/PRZ/PSN on contact).
  // The earlier ER patch added a 10% non-contact tier per status, which made
  // ranged moves proc Effect Spore — a regression vs the ROM spec (same class
  // of bug as the Poison Point non-contact tier above). Removed entirely so
  // only the vanilla contact proc (EffectSporeAbAttr) remains.

  // ===== Round 6: more non-contact extensions + minor tweaks =====
  // 143 POISON_TOUCH: ER spec is CONTACT-only ("also works on offense"). The
  // earlier ER patch added a 10% NON-contact poison tier, which made ranged
  // moves proc Poison Touch on defense — a regression vs the ROM spec (same
  // class of bug as Poison Point / Effect Spore). Removed the non-contact line;
  // kept the offense-side contact proc.
  [
    AbilityId.POISON_TOUCH,
    ab => {
      addOffenseContactStatusChance(ab, StatusEffect.POISON, 30);
      // ER 2.65 dex: "30% chance to poison on contact moves, both when attacking
      // AND being attacked." Vanilla only wires the offense side; add the
      // defense-side contact proc (contact-only, no non-contact tier).
      ab.attrs.push(
        new ChanceStatusOnHitAbAttr({
          chance: 30,
          effects: [StatusEffect.POISON],
          contactRequired: true,
        }),
      );
    },
  ],
  // 85 HEATPROOF: ER 2.65 dex — "Immune to burn damage and Attack drops from
  // burn status." Vanilla only HALVES burn tick (ReduceBurnDamageAbAttr 0.5).
  // Swap to FULL burn immunity + BypassBurnDamageReductionAbAttr so the burned
  // holder keeps full physical damage (no burn Attack cut). The Fire-move 0.5x
  // stays untouched.
  [
    AbilityId.HEATPROOF,
    ab => {
      // Drop the vanilla 0.5 burn-damage reducer, keep everything else.
      ab.attrs = ab.attrs.filter(a => !(a instanceof ReduceBurnDamageAbAttr));
      ab.attrs.push(new FullBurnDamageImmunityAbAttr());
      ab.attrs.push(new BypassBurnDamageReductionAbAttr());
    },
  ],
  // 19 SHIELD_DUST: ER 2.65 dex — three clauses: (1) block secondary effects of
  // damaging moves (vanilla IgnoreMoveEffectsAbAttr, already wired), (2) immunity
  // to ALL entry hazards, (3) immunity to ALL powder moves. Add clauses 2 & 3.
  [
    AbilityId.SHIELD_DUST,
    ab => {
      ab.attrs.push(
        new MoveImmunityAbAttr(
          (pokemon, attacker, move) => pokemon !== attacker && move.hasFlag(MoveFlags.POWDER_MOVE),
        ),
      );
      ab.attrs.push(new EntryHazardImmunityAbAttr());
    },
  ],
  // 155 RATTLED: ER 2.65 dex — "+1 Speed when hit by a Bug/Dark/Ghost move OR when
  // the user flinches." Base wires the type-hit trigger; vanilla also carries an
  // off-dex Intimidate reaction. Add the flinch trigger (same attr Steadfast uses).
  [
    AbilityId.RATTLED,
    ab => {
      ab.attrs.push(new FlinchStatStageChangeAbAttr([Stat.SPD], 1));
    },
  ],
  // 138 FLARE_BOOST: ER 2.65 dex — +50% SpAtk when burned (vanilla) AND "Negates
  // burn damage. Immediately applies burn to self in fog." The burn-damage block
  // plus the fog self-ignite (mirrors Toxic Boost's Toxic-Terrain self-poison):
  // self-burn on switch-in under active fog AND the instant fog is set on-field.
  [
    AbilityId.FLARE_BOOST,
    ab => {
      ab.attrs.push(new BlockStatusDamageAbAttr(StatusEffect.BURN));
      ab.attrs.push(new FlareBoostSelfBurnOnSummonAbAttr());
      ab.attrs.push(new FlareBoostSelfBurnOnWeatherChangeAbAttr());
    },
  ],
  // 61 SHED_SKIN: ER 2.65 dex — "30% chance to cure status at end of turn."
  // Vanilla uses a 1/3 (~33.3%) gate; retune to an exact 30% roll. Strip the
  // vanilla-conditioned PostTurnResetStatusAbAttr and re-push with a 30% gate.
  [
    AbilityId.SHED_SKIN,
    ab => {
      ab.attrs = ab.attrs.filter(a => !(a instanceof PostTurnResetStatusAbAttr));
      ab.attrs.push(new PostTurnResetStatusAbAttr().addCondition(_pokemon => randSeedInt(100) < 30));
    },
  ],
  // 101 TECHNICIAN: ER 2.65 dex — "Does not boost moves with 60 BP or less if they
  // POTENTIALLY can have more than 60 BP, such as Revenge or Venoshock." Vanilla
  // gates on the CURRENT computed power ≤ 60, so an untriggered Revenge/Payback/
  // Assurance (sitting at base 60) wrongly gets boosted. Replace the condition:
  // boost only fixed-power moves ≤ 60 — any move carrying a VariablePowerAttr
  // (whose power can climb above 60) is excluded regardless of its momentary value.
  [
    AbilityId.TECHNICIAN,
    ab => {
      ab.attrs = ab.attrs.filter(a => a.constructor.name !== "MovePowerBoostAbAttr");
      ab.attrs.push(
        new MovePowerBoostAbAttr((_user, _target, move) => move.power <= 60 && !move.hasAttr("VariablePowerAttr"), 1.5),
      );
    },
  ],
  // 234 PRANKSTER: vanilla status moves +1 priority. ER also adds Dark-immune
  // protection. Add a Dark-type defense check via TypeMultiplier rider.
  [
    AbilityId.PRANKSTER,
    ab => {
      ab.attrs.push(new ReceivedTypeDamageMultiplierAbAttr(PokemonType.DARK, 1.0));
    },
  ],
  // 142 BIG_PECKS already TOTAL.
  // 169 STRONG_JAW already MINOR.
  // 105 SUPER_LUCK: vanilla +1 crit stage. ER also gives 1.3x dmg to crits.
  // Approximated via CritDamageMultiplier; that's in archetypes/crit-mod.
  // Deferred — vanilla pokerogue doesn't expose easy hook for "boost own crit damage".
  // 23 SHED_SKIN: vanilla 33% post-turn status cure. ER also heals 1/8 if cured.
  // Approximation: keep vanilla cure path; rider is too niche to wire cleanly.
  [AbilityId.ANALYTIC, ab => mutateMovePowerBoost(ab, 1.3)],
  // 137 HEAVY_METAL: handled above.
  // 192 BULLETPROOF: ER same as vanilla (immune to BALLBOMB).
  // 235 STAKEOUT: vanilla 2x on switch-in. ER ups to 2x always against statused
  // foes (different trigger). Vanilla close enough — keep.
  // 167 FUR_COAT: vanilla 0.5x physical received. Same as ER.
  // 200 STEELWORKER: ER 2.65 dex — "Normal moves become Steel, and if the user is
  // Steel-type it RESISTS Ghost and Dark, OTHERWISE it gains Steel STAB." Two
  // mutually-exclusive branches gated on the holder's own typing:
  //  - MoveTypeChangeAbAttr (Normal → Steel) — always
  //  - Steel user: ReceivedTypeDamageMultiplier (Ghost 0.5) + (Dark 0.5)
  //  - non-Steel user: TypeDamageBoost (Steel 1.5) STAB-equivalent
  //  - Strip the spurious vanilla Steel power-boost
  [
    AbilityId.STEELWORKER,
    ab => {
      ab.attrs = ab.attrs.filter(a => a.constructor.name !== "MoveTypePowerBoostAbAttr");
      ab.attrs.push(
        new MoveTypeChangeAbAttr(PokemonType.STEEL, (_user, _t, move) => !!move && move.type === PokemonType.NORMAL),
      );
      ab.attrs.push(
        new ReceivedTypeDamageMultiplierAbAttr(PokemonType.GHOST, 0.5).addCondition(p => p.isOfType(PokemonType.STEEL)),
      );
      ab.attrs.push(
        new ReceivedTypeDamageMultiplierAbAttr(PokemonType.DARK, 0.5).addCondition(p => p.isOfType(PokemonType.STEEL)),
      );
      ab.attrs.push(
        new TypeDamageBoostAbAttr({ type: PokemonType.STEEL, multiplier: 1.5 }).addCondition(
          p => !p.isOfType(PokemonType.STEEL),
        ),
      );
    },
  ],
  // 263 DRAGONS_MAW: vanilla 1.5x Dragon. ER 1.5x same.
  // 188 STORM_DRAIN: redirect Water + raise SPATK on absorption. Vanilla same.
  // 184 ANTICIPATION: ER spec is "Senses Super-effective moves. Dodges one
  // Super-effective hit." The vanilla base already does the sense/shudder on
  // entry. The DodgeFirstSuperEffective primitive adds the dodge rider: the
  // first super-effective hit received each battle is nullified (once-per-battle
  // charge tracked on battleData.anticipationDodgeUsed). The previous "+1 SPD on
  // entry" rider was NOT in the spec (a wrong approximation) — stays removed.
  [
    AbilityId.ANTICIPATION,
    ab => {
      ab.attrs.push(new DodgeFirstSuperEffectiveAbAttr());
    },
  ],
  // 209 BIG_PECKS already total.
  [AbilityId.RECKLESS, ab => mutateFlagPowerBoost(ab, MoveFlags.RECKLESS_MOVE, 1.2)],
  // 158 MULTISCALE: vanilla 0.5x dmg at full HP. ER says "Halves damage and
  // ignores type for first turn out". The first-turn-after-entry is a
  // narrower trigger — keep vanilla full-HP since it covers turn 1.
  // 220 AERILATE / 224 PIXILATE / 175 REFRIGERATE / 211 GALVANIZE — already done.
  [AbilityId.SHEER_FORCE, ab => mutateMovePowerBoost(ab, 1.3)],
  // 270 LIQUID_VOICE: vanilla sound moves become water. ER same.
  // 174 TRUANT: vanilla skips every other turn. ER unchanged.
  // 213 SWEET_VEIL: vanilla sleep immunity for user + allies. ER unchanged.
  // 209 WIMP_OUT: vanilla switch out at <= 50% HP. ER unchanged.
  // 197 PRANKSTER already extended.

  // ===== Round 7: ER-specific deltas surfaced from vanilla-audit =====
  [
    AbilityId.HUSTLE,
    ab => {
      ab.attrs = ab.attrs.filter(
        attr =>
          !(attr instanceof StatMultiplierAbAttr && (attr.stat === Stat.ATK || attr.stat === Stat.ACC))
          && !(attr instanceof AiMovegenMoveStatsAbAttr),
      );
      const attacksOnly = (_user: Pokemon, _target: Pokemon | null, move: Move) =>
        move.category !== MoveCategory.STATUS;
      ab.attrs.push(new MovePowerBoostAbAttr(attacksOnly, 1.4));
      ab.attrs.push(new StatMultiplierAbAttr(Stat.ACC, 0.9, attacksOnly));
      ab.attrs.push(
        new AiMovegenMoveStatsAbAttr(({ move, accMult }: AiMovegenMoveStatsAbAttrParams) => {
          if (move.category !== MoveCategory.STATUS) {
            accMult.value *= 0.9;
          }
        }),
      );
    },
  ],
  [AbilityId.SAND_VEIL, ab => mutateStatMultiplier(ab, Stat.EVA, 1.25)],
  [AbilityId.SNOW_CLOAK, ab => mutateStatMultiplier(ab, Stat.EVA, 1.25)],
  // 96 NORMALIZE: vanilla converts all moves to Normal-type. ER adds a 1.1x
  // boost on Normal-type moves AND makes those moves IGNORE the target's
  // resistances (but not immunities) — the IgnoreResistancesAbAttr marker is
  // read by Pokemon.getAttackTypeEffectiveness.
  // The vanilla ability (init-abilities) already carries an always-true 1.2x
  // MovePowerBoostAbAttr (every move is Normal post-conversion, so it always
  // fires). ER's dex value is "10% power boost" (×1.1), NOT ×1.32 — so STRIP the
  // vanilla 1.2x boost before adding our 1.1x, or the two stack. (constructor.name
  // === "MovePowerBoostAbAttr" targets exactly the base-class instance; the
  // MoveTypeChangeAbAttr conversion attr is a different class and is preserved.)
  [
    AbilityId.NORMALIZE,
    ab => {
      ab.attrs = ab.attrs.filter(attr => attr.constructor.name !== "MovePowerBoostAbAttr");
      ab.attrs.push(new MovePowerBoostAbAttr((_user, _t, move) => move?.type === PokemonType.NORMAL, 1.1));
      ab.attrs.push(new IgnoreResistancesAbAttr());
    },
  ],
  // 113 SCRAPPY: vanilla Normal/Fighting hits Ghost. ER adds ER_FEAR-immune
  // (the ER analogue of Intimidate's stat-drop fear tag).
  [AbilityId.SCRAPPY, ab => extendBattlerTagImmunity(ab, BattlerTagType.ER_FEAR)],
  // 105 SUPER_LUCK: vanilla +1 crit stage. ER also gives 1.3x crit dmg.
  // pokerogue's crit damage multiplier is fixed; mutate via additive attrs
  // — the BonusCritDamageMultiplier path is private. Defer: would need new primitive.
  [
    AbilityId.SAND_FORCE,
    ab => {
      ab.attrs = ab.attrs.filter(attr => attr.constructor.name !== "MoveTypePowerBoostAbAttr");
      ab.attrs.push(
        new SelfHighestStatMultiplierAbAttr({
          candidates: [Stat.ATK, Stat.SPATK],
          multiplier: 1.5,
          weathers: [WeatherType.SANDSTORM],
        }),
      );
    },
  ],
  // 85 HEATPROOF: vanilla 0.5x Fire dmg + no burn damage. Same as ER.
  // 47 THICK_FAT: vanilla 0.5x Fire/Ice dmg. Same as ER.
  // 91 ADAPTABILITY: vanilla 2x STAB. Same as ER.
  // 119 SOUL_HEART (cluster) already MAJOR'd.
  // 88 DOWNLOAD: vanilla +1 ATK/SPATK on entry depending on opponent. Same.
  // 78 MOTOR_DRIVE: vanilla absorb Electric → +1 Speed. Same as ER.
  // 80 STEADFAST: vanilla +1 Speed on flinch. Same as ER.
  // 81 SNOW_CLOAK: vanilla 1.25x evasion in hail. Same as ER.
  // 8 SAND_VEIL: vanilla 1.25x evasion in sand. Same as ER.
  // 84 UNBURDEN: vanilla 2x speed on item consumption. Same as ER.

  // ===== Round 7 (cont.) — MAJOR rider additions =====
  // 46 PRESSURE: vanilla 2x foe PP usage + "clear stat buffs on entry" rider.
  // Approximate via PostSummon (clear positive stages on all opponents).
  [
    AbilityId.PRESSURE,
    ab => {
      ab.attrs.push(new ClearOpponentStatBuffsOnSummonAbAttr());
    },
  ],
  // 53 PICKUP: vanilla "find items post-battle" → ER "Clears all entry hazards
  // from YOUR side of the field" on switch-in. ownSideOnly=true so it strips only
  // the holder's own hazards, NOT hazards it set on the opponent (dex: own side).
  [
    AbilityId.PICKUP,
    ab => {
      ab.attrs.push(
        new PostSummonRemoveArenaTagAbAttr(
          [ArenaTagType.SPIKES, ArenaTagType.TOXIC_SPIKES, ArenaTagType.STEALTH_ROCK, ArenaTagType.STICKY_WEB],
          true,
        ),
      );
    },
  ],
  // 50 RUN_AWAY: vanilla "guaranteed flee". ER adds "Raises Speed if stats
  // lowered by an enemy" rider. The trigger is the StatTriggerOnStatLowered
  // primitive from the archetype layer.
  [
    AbilityId.RUN_AWAY,
    ab => {
      ab.attrs.push(new StatTriggerOnStatLoweredAbAttr({ stats: [{ stat: Stat.SPD, stages: 2 }] }));
    },
  ],

  // 225 RKS_SYSTEM (MultiAttack / Silvally): vanilla only carries the
  // NoFusionAbilityAbAttr form-marker (memory disc determines type). ER spec
  // adds two more clauses: Protean (the holder's type becomes the type of the
  // move it is about to use) and Adaptability (STAB rises from 1.5x to 2.0x).
  // Wire both vanilla attrs so the description matches.
  [
    AbilityId.RKS_SYSTEM,
    ab => {
      if (!ab.attrs.some(a => a instanceof PokemonTypeChangeAbAttr)) {
        ab.attrs.push(new PokemonTypeChangeAbAttr());
      }
      if (!ab.attrs.some(a => a instanceof StabBoostAbAttr)) {
        ab.attrs.push(new StabBoostAbAttr());
      }
    },
  ],

  // 239 PROPELLER_TAIL: ER spec is "Swift Swim + Redirection Immunity". Vanilla
  // pokerogue only wires the BlockRedirect half, so add the rain Speed boost
  // (1.5x in rain/heavy rain, matching ER's reduced Swift Swim multiplier). The
  // boost is gated per-attr on weather so the redirection immunity stays
  // unconditional.
  [
    AbilityId.PROPELLER_TAIL,
    ab => {
      if (!ab.attrs.some(a => a instanceof StatMultiplierAbAttr)) {
        ab.attrs.push(
          new StatMultiplierAbAttr(Stat.SPD, 1.5, getWeatherCondition(WeatherType.RAIN, WeatherType.HEAVY_RAIN)),
        );
      }
    },
  ],

  // 242 STALWART: ER spec is "isn't affected by redirection, crits, or ability
  // suppression (Mold Breaker, Gastro Acid, Neutralizing Gas, Mycelium Might)".
  // Vanilla pokerogue wires only BlockRedirect; the builder does NOT set the
  // suppression flags (the old comment claimed it did). Add crit immunity AND
  // mark the ability unsuppressable/uncopiable/unreplaceable so Gastro Acid /
  // Neutralizing Gas / Trace / Simple Beam can't touch it. Mold-Breaker /
  // Mycelium-Might immunity is already correct — Stalwart is not `ignorable`, so
  // arena.ignoreAbilities can't bypass it (pokemon.ts canApplyAbility).
  [
    AbilityId.STALWART,
    ab => {
      if (!ab.attrs.some(a => a instanceof BlockCritAbAttr)) {
        ab.attrs.push(new BlockCritAbAttr());
      }
      ab.makeImmutableToAbilityEffects();
    },
  ],

  // 402 TOXIC_DEBRIS: ER dex/short_desc = "Sets Toxic Spikes when hit by CONTACT
  // moves." Vanilla pokerogue triggers on move.category===PHYSICAL (so it wrongly
  // fires on physical non-contact moves like Earthquake and misses special
  // contact moves). Swap the predicate to MAKES_CONTACT so it matches the dex and
  // its siblings Loose Quills (401) / Loose Rocks (405).
  [
    AbilityId.TOXIC_DEBRIS,
    ab => {
      const idx = ab.attrs.findIndex(a => a instanceof PostDefendApplyArenaTrapTagAbAttr);
      if (idx !== -1) {
        ab.attrs[idx] = new PostDefendApplyArenaTrapTagAbAttr(
          (_target, _user, move) => move.hasFlag(MoveFlags.MAKES_CONTACT),
          ArenaTagType.TOXIC_SPIKES,
        );
      }
    },
  ],

  // 553 GUARD_DOG: ER dex adds "or Scare ... raises the stat instead of lowering
  // it". Vanilla Guard Dog's Intimidate-reaction hardcodes ATK +1, so a Scare
  // (SpAtk -1, routed through the intimidate reaction) wrongly bumped ATK instead
  // of SpAtk. Swap to the mirror-incoming variant so the RAISED stat matches the
  // stat the effect would lower (ATK for Intimidate, SpAtk for Scare/Terrify).
  [
    AbilityId.GUARD_DOG,
    ab => {
      const idx = ab.attrs.findIndex(a => a instanceof PostIntimidateStatStageChangeAbAttr);
      if (idx !== -1) {
        ab.attrs[idx] = new PostIntimidateStatStageChangeAbAttr([Stat.ATK], 1, true, true);
      }
    },
  ],

  // ===== Round 8: more ER-specific deltas =====
  // 57 PLUS / 58 MINUS: ER "Doubles the damage this Pokemon deals, if and only if
  // a Pokemon with the COMPLEMENTARY ability is on the field (Plus needs a Minus,
  // Minus needs a Plus)." This is general OUTGOING damage (physical AND special),
  // not the vanilla SpAtk-only +50% stat boost. Drop the vanilla conditional
  // StatMultiplier and add a x2 move-power boost gated on a complementary ally.
  [
    AbilityId.PLUS,
    ab => {
      ab.attrs = ab.attrs.filter(a => !(a instanceof StatMultiplierAbAttr));
      ab.attrs.push(new MovePowerBoostAbAttr(user => user.getAllies().some(a => a.hasAbility(AbilityId.MINUS)), 2));
    },
  ],
  [
    AbilityId.MINUS,
    ab => {
      ab.attrs = ab.attrs.filter(a => !(a instanceof StatMultiplierAbAttr));
      ab.attrs.push(new MovePowerBoostAbAttr(user => user.getAllies().some(a => a.hasAbility(AbilityId.PLUS)), 2));
    },
  ],

  // 73 WHITE_SMOKE: vanilla "stat-drop immunity". ER COMPLETELY DIFFERENT
  // — "Sets Smokescreen for 3 turns on switch-in; Smokescreen raises the party's
  // evasiveness by 25%". Use the ER_SMOKESCREEN arena tag (which grants the +25%
  // side evasion), NOT Mist (Mist only blocks stat drops and gives no evasion).
  [
    AbilityId.WHITE_SMOKE,
    ab => {
      ab.attrs.push(
        new EntryEffectAbAttr({
          kind: "set-screen-or-room",
          tag: ArenaTagType.ER_SMOKESCREEN,
          turns: 3,
        }),
      );
    },
  ],

  // 209 DISGUISE: ER adds "In fog, the disguise is restored immediately once per
  // switch in, or when fog is set again." Vanilla DISGUISE has no fog logic; wire
  // the two fog-restore primitives (also used by Patchwork 693). Busted form is
  // index 1 for every Disguise holder (disguised=0, busted=1).
  [
    AbilityId.DISGUISE,
    ab => {
      if (!ab.attrs.some(a => a instanceof FogRestoreDisguiseFormChangeAbAttr)) {
        ab.attrs.push(new FogRestoreDisguiseFormChangeAbAttr(1), new PostSummonFogRestoreDisguiseAbAttr(1));
      }
    },
  ],

  // 448 ELECTROMORPHOSIS: ER dex is "when hit by ANY move, becomes charged"
  // (vanilla charges only on a damaging hit). Replace the damaging-only CHARGED
  // proc with an any-move one.
  [
    AbilityId.ELECTROMORPHOSIS,
    ab => {
      ab.attrs = ab.attrs.filter(a => !(a instanceof PostDefendApplyBattlerTagAbAttr));
      ab.attrs.push(new PostDefendApplyBattlerTagAbAttr(() => true, BattlerTagType.CHARGED));
    },
  ],

  // 251 SCREEN_CLEANER: ER dex removes Smokescreen too (vanilla only clears
  // Reflect / Light Screen / Aurora Veil). Swap the removal attr for one that
  // also clears ER_SMOKESCREEN. (The dex's "may re-set a screen while active"
  // clause is a separate screen-set interaction, not covered here.)
  [
    AbilityId.SCREEN_CLEANER,
    ab => {
      ab.attrs = ab.attrs.filter(a => !(a instanceof PostSummonRemoveArenaTagAbAttr));
      ab.attrs.push(
        new PostSummonRemoveArenaTagAbAttr([
          ArenaTagType.AURORA_VEIL,
          ArenaTagType.LIGHT_SCREEN,
          ArenaTagType.REFLECT,
          ArenaTagType.ER_SMOKESCREEN,
        ]),
      );
    },
  ],

  // 147 WONDER_SKIN: vanilla "status moves 50% acc on user". ER COMPLETELY
  // DIFFERENT — "Blocks most damage boosting and multihit abilities". The
  // audit flagged the prior 0.77x blanket damage reduction as wrong-shape:
  // it fires on every hit, including non-boosted ones. Replace with the
  // PostDefendSuppressOpponentDamageBoostAbAttr primitive (used for Fort
  // Knox) which is the correct surface for "suppress opponent boosts".
  [
    AbilityId.WONDER_SKIN,
    ab => {
      ab.attrs = ab.attrs.filter(attr => attr.constructor.name !== "WonderSkinAbAttr");
      ab.attrs.push(new PostDefendSuppressOpponentDamageBoostAbAttr());
    },
  ],

  // 119 FRISK: vanilla "reveal foe item". ER adds "disables their items for 2
  // turns" via the DisableFoeItemsOnEntry PostSummon rider (applies the
  // ER_ITEM_DISABLED tag to each foe; Mega Stones unaffected). See also the
  // duplicate note in Round 10 below.
  [
    AbilityId.FRISK,
    ab => {
      ab.attrs.push(new DisableFoeItemsOnEntryAbAttr());
    },
  ],

  // 112 SLOW_START: vanilla halves ATK + SPD for 5 turns. ER also halves
  // SPATK — add the missing offense slow. Approximated as additional
  // StatMultiplier on SPATK that's gated on a turn counter — pokerogue's
  // existing implementation uses a SlowStartTag with turn-based decay.
  // The easiest correct path: layer a second StatMultiplier on SPATK
  // that mirrors the ATK one.
  [AbilityId.SLOW_START, ab => mutateStatMultiplier(ab, Stat.SPATK, 0.5)],

  // 215 INNARDS_OUT: vanilla deals fatal-hit damage on KO. Same as ER.
  // Add an extra ATK +1 rider via existing OnFaintEffect path is overkill;
  // vanilla covers the gameplay-essential effect.

  // 82 GLUTTONY: vanilla eats berries early (<= 50% HP). ER adds 1/3 HP
  // heal on berry consumption. The HealFromBerryUseAbAttr exists in vanilla
  // — patch its heal factor to 1/3.
  [
    AbilityId.GLUTTONY,
    ab => {
      ab.attrs.push(new HealFromBerryUseAbAttr(1 / 3));
    },
  ],

  // ===== Round 9: more ER deltas =====
  // 153 MOXIE: vanilla +1 ATK on KO. ER says same. No patch needed.
  // 224 BEAST_BOOST: vanilla +1 highest stat on KO. Same.
  // 80 STEADFAST: vanilla +1 SPD on flinch. Same.
  // 81 SNOW_CLOAK / 8 SAND_VEIL: vanilla 1.25x evasion. Same.
  // 84 UNBURDEN: vanilla 2x SPD on item loss. Same.
  // 220 SOULHEART: vanilla +1 SPATK on any KO. Same.
  // 220 SOULHEART exists at id 220 (SOUL_HEART) — already in vanilla pokerogue.
  // 226 ELECTRO_SURGE: ER 8 turns (already patched in MINOR section).
  // 234 INTREPID_SWORD: vanilla +1 ATK on entry. ER same.
  // 235 DAUNTLESS_SHIELD: vanilla +1 DEF on entry. ER same.

  // 138 FLARE_BOOST: vanilla 1.5x SpAtk if burned. ER same. No patch.
  // 90 POISON_HEAL: vanilla 1/8 hp heal if poisoned. ER same. No patch.

  // ===== Round 9 — actual mutates =====
  // 167 FUR_COAT: vanilla halves Physical dmg. ER same. No patch.
  // 199 WATER_BUBBLE: vanilla halves Fire dmg, doubles Water dmg, no burns.
  // Same as ER. No patch.
  // 201 BERSERK: vanilla +1 SpAtk at <= 50% HP after damage. ER says "boosts
  // highest attack" (ATK or SPATK). Approximate by adding +1 ATK rider.
  [
    AbilityId.BERSERK,
    ab => {
      ab.attrs = ab.attrs.filter(
        attr =>
          attr.constructor.name !== "PostDefendHpGatedStatStageChangeAbAttr"
          && attr.constructor.name !== "PostDefendStatStageChangeAbAttr",
      );
      ab.attrs.push(new BerserkOnThresholdAbAttr());
    },
  ],
  // 215 INNARDS_OUT: vanilla deals attacker's HP-damage equal to fatal hit.
  // ER same.
  // 109 UNAWARE: vanilla ignores stat stages. Same.
  // 168 PROTEAN: vanilla converts type per move. Same.
  // 152 MUMMY: vanilla applies Mummy on contact. Same.
  // 154 JUSTIFIED (#397): ER "Boosts Attack INSTEAD OF being hit by Dark-type
  // moves" - a Sap-Sipper-style absorb, not vanilla's hit-then-boost. Replace
  // the PostDefend boost with full Dark immunity + the +1 ATK.
  [
    AbilityId.JUSTIFIED,
    ab => {
      ab.attrs = ab.attrs.filter(a => a.constructor.name !== "PostDefendStatStageChangeAbAttr");
      ab.attrs.push(new TypeImmunityStatStageChangeAbAttr(PokemonType.DARK, Stat.ATK, 1));
    },
  ],
  // 223 POWER_OF_ALCHEMY (#429): vanilla copies a fainted ally's ability; ER
  // REDEFINES it as item transmutation ("transmutes berries on entry..."). The
  // patcher pin also fixes the description (it showed the ER ROM text while
  // the EFFECT was still the vanilla copy - effect and text now agree).
  [
    AbilityId.POWER_OF_ALCHEMY,
    ab => {
      ab.attrs = ab.attrs.filter(a => a.constructor.name !== "CopyFaintedAllyAbilityAbAttr");
      ab.attrs.push(new ErTransmuteOpposingBerriesAbAttr());
    },
  ],
  // 155 RATTLED: vanilla +1 SPD on Bug/Dark/Ghost hit. Same.
  // 156 MAGIC_BOUNCE: vanilla reflects status. Same.
  // 169 FUR_COAT: vanilla 0.5x Phys. Same.

  // 12 OBLIVIOUS: vanilla immune to infatuation + Intimidate + Taunt.
  // ER says "Immune to infatuation, Scare, Intimidate and Taunt" — adds
  // ER_FEAR (Scare) immunity.
  [AbilityId.OBLIVIOUS, ab => extendBattlerTagImmunity(ab, BattlerTagType.ER_FEAR)],
  // 20 OWN_TEMPO: vanilla immune to confusion + Intimidate. ER adds Scare.
  [AbilityId.OWN_TEMPO, ab => extendBattlerTagImmunity(ab, BattlerTagType.ER_FEAR)],
  // 39 INNER_FOCUS: vanilla immune to flinch + Intimidate. ER adds Scare.
  // (already patched in MAJOR section — duplicate-add is benign, the map
  // overwrites prior entry. Re-add anyway for explicit visibility.)
  // 12 OBLIVIOUS already added.

  // ===== Round 54 — ER deltas vs vanilla pokerogue (audit-found) =====
  // 74 PURE_POWER: vanilla doubles ATK. ER spec says SP.ATK instead.
  // We strip the vanilla ATK ×2 attr and add SPATK ×2. The vanilla ability also
  // carries an AI moveset-gen/scoring hint that doubles a move's effective power
  // for PHYSICAL moves; since ER's Pure Power now boosts SP.ATK, that hint must
  // favor SPECIAL moves instead (otherwise the AI still builds/picks physical
  // movesets for a special-attacking ability). Strip it and re-add for SPECIAL.
  [
    AbilityId.PURE_POWER,
    ab => {
      ab.attrs = ab.attrs.filter(
        a =>
          !(a instanceof StatMultiplierAbAttr && a.stat === Stat.ATK && a.multiplier === 2)
          && !(a instanceof AiMovegenMoveStatsAbAttr),
      );
      ab.attrs.push(new StatMultiplierAbAttr(Stat.SPATK, 2));
      ab.attrs.push(
        new AiMovegenMoveStatsAbAttr(({ move, powerMult }) => {
          if (move.category === MoveCategory.SPECIAL) {
            powerMult.value *= 2;
          }
        }),
      );
    },
  ],

  // 300 SUPERSWEET_SYRUP: vanilla pokerogue lowers the foe's evasion on entry.
  // ER repurposes it as "Sticky Hold + disable the foe's item for 2 turns on
  // contact." Strip the entry evasion-drop, add BlockItemTheft (item can't be
  // removed/stolen) + the on-contact item-disable.
  [
    AbilityId.SUPERSWEET_SYRUP,
    ab => {
      ab.attrs = ab.attrs.filter(a => a.constructor.name !== "PostSummonStatStageChangeAbAttr");
      ab.attrs.push(new BlockItemTheftAbAttr());
      ab.attrs.push(new DisableTargetItemOnContactAbAttr());
    },
  ],

  // 26 LEVITATE: vanilla Ground immunity. ER adds "Ups own Flying moves
  // by 1.25x" rider.
  [
    AbilityId.LEVITATE,
    ab => {
      ab.attrs.push(new MoveTypePowerBoostAbAttr(PokemonType.FLYING, 1.25));
    },
  ],

  // 204 LIQUID_VOICE: the Normal-sound->Water conversion AND the 1.2x sound-move
  // boost are BOTH already wired in init-abilities.ts (with the same user-aware
  // SOUND_BASED check, so ER Festivities' dance->sound moves are covered). A rider
  // here re-pushed a SECOND 1.2x, stacking to 1.44x — removed.

  // ===== Round 11: TypeImmunity-with-highest-Atk rewrites =====
  // Vanilla Lightning Rod / Storm Drain / Sap Sipper redirect their type
  // and boost ONLY SPATK by +1 on absorb. ER text changes this to "ups
  // highest Atk" — whichever of ATK or SPATK is higher.
  // We swap the vanilla TypeImmunityStatStageChangeAbAttr (SPATK) for the
  // new TypeImmunityHighestAttackStatStageAbAttr primitive.
  [
    AbilityId.LIGHTNING_ROD,
    ab => {
      patchTypeImmunityHighestAtk(ab, PokemonType.ELECTRIC);
    },
  ],
  [
    AbilityId.STORM_DRAIN,
    ab => {
      patchTypeImmunityHighestAtk(ab, PokemonType.WATER);
    },
  ],
  [
    AbilityId.SAP_SIPPER,
    ab => {
      patchTypeImmunityHighestAtk(ab, PokemonType.GRASS);
    },
  ],

  // ===== Round 10: more ER deltas (mostly +5 wires) =====
  // 119 FRISK: the "disable foe items 2 turns" rider is wired above via
  // DisableFoeItemsOnEntryAbAttr + the ER_ITEM_DISABLED battler tag (gated in
  // PokemonHeldItemModifier.shouldApply). No longer deferred.
  // 187 INFILTRATOR: vanilla bypass Substitute + screens. ER same. No patch.
  // 178 MEGA_LAUNCHER already patched.
  // 246 STAKEOUT: vanilla 2x on switch-in. ER same.
  // 196 RKS_SYSTEM (MultiAttack): vanilla type from item. ER same.
  // 233 NEUROFORCE already patched.
  // 261 STALWART: vanilla "ignore foe redirection". ER same.
  // 263 DRAGONS_MAW: vanilla 1.5x Dragon. ER same.

  // 51 FORECAST: vanilla form-change with weather. ER also: "when USING a
  // weather-setting move, follow up with a 100 BP Weather Ball", plus
  // unsuppressable. Now WIRED in init-abilities.ts via the PostMoveUsed surface
  // (PostWeatherMoveFollowUpAbAttr — the same hook Dancer uses) + .unsuppressable().
  // No longer deferred.

  // 50 PICKUP: already added (placeholder).
  // 64 HUSTLE: already added.
  // 87 DRY_SKIN: vanilla absorbs water heal + fire damage. ER same. No patch.
  // 96 NORMALIZE: already added.
  // 168 PROTEAN: vanilla type-change per move. ER same.
  // 116 SOLID_ROCK: already MINOR'd (0.65).

  // 230 SLUSH_RUSH: vanilla 1.5x SPD in hail. ER same (already MINOR'd above).
  // 145 ICE_BODY: already MINOR'd.
  // 246 STAKEOUT: vanilla 2x switch-in. ER "Deals double damage to opponents
  // being switched in" — same.

  // 36 TRACE: vanilla copies foe ability. ER notes "Does not copy innates" —
  // vanilla pokerogue's TRACE only copies the ACTIVE ability, not passives.
  // So this is already correct. No patch.

  // 162 PROTOSYNTHESIS / 163 QUARK_DRIVE: vanilla raise highest stat in sun/
  // electric terrain. ER same. No patch.
]);

/**
 * MAJOR rider for PRESSURE — clear all positive stat stages on opponents
 * when this ability's holder is summoned (entry effect).
 */
// ER Power of Alchemy (#429): the ER ability is "Upon entry, transmutes all
// opposing Berries into Black Sludge. When any Pokemon loses an item during
// battle, it gets replaced by Black Sludge. If Black Sludge is removed, it
// gets replaced by Big Nugget." pokerogue has no held Black Sludge or Big
// Nugget items, so we port the part that matters in a roguelite: ON ENTRY the
// holder destroys every Berry held by opposing Pokemon (to almost any holder
// a Black Sludge is a dead item anyway). The two lose-an-item clauses have no
// pokerogue equivalent and are deliberately skipped.
class ErTransmuteOpposingBerriesAbAttr extends PostSummonAbAttr {
  constructor() {
    super(true);
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return pokemon.getOpponents().length > 0;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    // Triple: a placement-dependent foe effect only reaches ADJACENT foes (binary: all foes).
    for (const opp of pokemon.getAdjacentOpponents()) {
      if (!opp || opp.isFainted()) {
        continue;
      }
      const berries = globalScene.findModifiers(
        m => m instanceof BerryModifier && m.pokemonId === opp.id,
        opp.isPlayer(),
      ) as BerryModifier[];
      if (berries.length === 0) {
        continue;
      }
      for (const berry of berries) {
        // Drain the whole stack - the ER text transmutes ALL berries.
        let guard = 99;
        while (berry.stackCount > 0 && guard-- > 0) {
          opp.loseHeldItem(berry);
        }
      }
      globalScene.updateModifiers(opp.isPlayer());
      globalScene.phaseManager.queueMessage(
        i18next.t("abilityTriggers:erTransmutedBerries", {
          pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
          targetName: getPokemonNameWithAffix(opp),
        }),
      );
    }
  }
}

class ClearOpponentStatBuffsOnSummonAbAttr extends PostSummonAbAttr {
  constructor() {
    super(true);
  }

  override canApply({ pokemon }: AbAttrBaseParams): boolean {
    return pokemon.getOpponents().length > 0;
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    // Triple: a placement-dependent foe effect only reaches ADJACENT foes (binary: all foes).
    for (const opp of pokemon.getAdjacentOpponents()) {
      if (!opp || opp.isFainted()) {
        continue;
      }
      // Clear every POSITIVE stat stage (leave debuffs alone). Use the canonical
      // accessors — `summonData.statStages` is indexed by `stat - 1`, so writing
      // `statStages[stat]` (as the old code did) hit the wrong slot and never
      // actually cleared ATK/etc.
      const stats: BattleStat[] = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA];
      for (const stat of stats) {
        if (opp.getStatStage(stat) > 0) {
          opp.setStatStage(stat, 0);
        }
      }
      opp.updateInfo();
    }
  }
}

/**
 * Apply ER's stat rebalances to vanilla pokerogue moves and abilities.
 *
 * Idempotent: a second invocation observes the already-patched state (via the
 * `PATCHED_MARKER` sentinel on each touched Ability) and reports
 * `abilityDeltas: 0`. Likewise for moves (the field-compare gates ensure
 * a no-op write when the value already matches).
 *
 * @returns A summary of how many moves/abilities were touched and any
 *          non-fatal errors encountered.
 */
export function initEliteReduxVanillaRebalance(): VanillaRebalanceResult {
  const result: VanillaRebalanceResult = {
    moveDeltas: 0,
    moveFieldWrites: 0,
    moveMechanicDeltas: 0,
    abilityDeltas: 0,
    moveMissing: 0,
    abilityMissing: 0,
    moveErrors: [],
    abilityErrors: [],
  };

  // Index allMoves / allAbilities by id for O(1) lookup. allMoves and
  // allAbilities are arrays; we don't assume the index equals the id.
  const moveById = new Map<number, (typeof allMoves)[number]>();
  for (const move of allMoves) {
    // `allMoves` is sparse (custom moves are id-indexed ≥5000); skip the holes
    // (same as the allAbilities handling below).
    if (!move) {
      continue;
    }
    moveById.set(move.id, move);
  }
  const abilityById = new Map<number, (typeof allAbilities)[number]>();
  // allAbilities is sparse — ER custom abilities are assigned to positions
  // ≥5000 by id. Iterate via Object.values to skip the gap (undefined entries).
  for (const ability of allAbilities) {
    if (!ability) {
      continue;
    }
    abilityById.set(ability.id, ability);
  }

  // === MOVES ===
  for (const draft of ER_MOVES) {
    const pokerogueId = ER_ID_MAP.moves[draft.id];
    if (pokerogueId === undefined) {
      // ER entry has no id-map row — usually means the move couldn't be
      // resolved during the build. Skip silently; the build script emits the
      // diagnostic.
      continue;
    }
    if (pokerogueId >= VANILLA_ID_CUTOFF) {
      // ER-custom — already constructed with the right values in B2.
      continue;
    }
    if (draft.archetype !== "vanilla") {
      // Defensive: only rebalance entries the build flagged as vanilla.
      // (An entry with a < 5000 id but archetype "unknown" would be a bug.)
      continue;
    }

    const move = moveById.get(pokerogueId);
    if (!move) {
      // Known pre-existing id-map drift — see VanillaRebalanceResult.moveMissing
      // for the root cause. Silently bookkeep; the patcher can't construct a
      // missing Move (that's the responsibility of pokerogue's initMoves).
      result.moveMissing++;
      continue;
    }

    // Patch each numeric field independently. We accept the cast through
    // a narrow shape — Move declares these fields `public` non-readonly, so
    // the write is safe at runtime even though TS sees `Move` as the
    // declared type. (See header for why we do this here rather than at
    // construction time.)
    let movedirty = false;
    const target = move as {
      power: number;
      accuracy: number;
      pp: number;
      priority: number;
      chance: number;
    };

    // power: skip when ER ships 0 (placeholder / status moves where ER's 0 is
    // semantically "no power", not "patch to 0").
    if (draft.power > 0 && target.power !== draft.power) {
      target.power = draft.power;
      result.moveFieldWrites++;
      movedirty = true;
    }
    // accuracy: ER's 0 means "always hits" (status); pokerogue stores -1 for
    // that. Don't blindly overwrite a -1 with 0 — only patch when ER has a
    // positive accuracy value that differs.
    if (draft.accuracy > 0 && target.accuracy !== draft.accuracy) {
      target.accuracy = draft.accuracy;
      result.moveFieldWrites++;
      movedirty = true;
    }
    // pp: must be positive on pokerogue side too. ER ships pp 0 for placeholder
    // entries — we don't want to zero out a real move.
    if (draft.pp > 0 && target.pp !== draft.pp) {
      target.pp = draft.pp;
      result.moveFieldWrites++;
      movedirty = true;
    }
    // priority: signed; 0 is a legitimate value, so we can't use a `> 0` guard
    // like the other fields. But we MUST guard against a non-finite draft value
    // (undefined / NaN): writing that leaves `target.priority` coerced back to a
    // number, so a bare `!==` comparison would re-fire every run (a spurious,
    // non-idempotent delta on ~56 moves whose ER draft omits priority).
    if (Number.isFinite(draft.priority) && target.priority !== draft.priority) {
      target.priority = draft.priority;
      result.moveFieldWrites++;
      movedirty = true;
    }
    // chance / effectChance: pokerogue uses -1 for "no secondary effect",
    // ER uses 0 (or absent). Only patch when ER specifies a positive value.
    if (draft.effectChance > 0 && target.chance !== draft.effectChance) {
      target.chance = draft.effectChance;
      result.moveFieldWrites++;
      movedirty = true;
    }

    // target (#415): per-move target overrides only. A data-driven sweep of
    // ER's foe-spread target classes flagged 19 vanilla moves whose targeting
    // disagrees (Avalanche/Round/Ominous Wind/Photon Geyser/Tera Starstorm...)
    // but blanket-applying them broke target-coordination mechanics in the
    // vanilla suites (Round's follow-up chain, Tera Starstorm's form-variable
    // targeting), so each needs individual verification before widening - the
    // overrides map is where verified ones go. Flash is the live report: it is
    // multi-target in the ROM but the dump ships target 0 (stale field).
    const desiredTarget = ER_VANILLA_TARGET_OVERRIDES.get(pokerogueId) ?? null;
    if (desiredTarget !== null && move.moveTarget !== desiredTarget) {
      move.target(desiredTarget);
      result.moveFieldWrites++;
      movedirty = true;
    }

    if (movedirty) {
      result.moveDeltas++;
    }
  }

  // Register FOREWARN's dedicated 80-BP always-hit Future Sight variant BEFORE
  // the ability loop (its entry-effect casts this move id — see patchForewarn).
  registerForewarnFutureSight();

  // === ABILITIES ===
  // Driven by the ABILITY_PATCHERS dispatch table at the top of this file.
  // Each patcher mutates the live Ability's `attrs` array and/or its AbAttrs'
  // private fields. Idempotent via the PATCHED_MARKER sentinel — re-runs skip
  // already-touched abilities.
  //
  // We still walk `ER_ABILITIES` to keep parity with the moves loop and to
  // surface id-map drift counts via `abilityMissing`, but the actual delta
  // application is gated on whether ABILITY_PATCHERS has a row for that id.
  for (const draft of ER_ABILITIES) {
    const pokerogueId = ER_ID_MAP.abilities[draft.id];
    if (pokerogueId === undefined) {
      continue;
    }
    if (pokerogueId >= VANILLA_ID_CUTOFF) {
      continue;
    }
    if (draft.archetype !== "vanilla") {
      continue;
    }

    const ability = abilityById.get(pokerogueId);
    if (!ability) {
      // Same id-map-drift handling as moves above.
      result.abilityMissing++;
      continue;
    }

    const patcher = ABILITY_PATCHERS.get(pokerogueId as AbilityId);
    if (patcher === undefined) {
      // No rebalance row for this ability — leave it at vanilla mechanics.
      continue;
    }

    const mutableAbility = ability as MutableAbility;
    if (mutableAbility[PATCHED_MARKER]) {
      // Idempotency: already patched on a previous run.
      continue;
    }

    try {
      patcher(mutableAbility);
      // ER rewrote this ability's MECHANICS — its i18n description still describes
      // the vanilla behavior. Pin the ER description so every surface that reads
      // `ability.description` (battle popups, info panels, Battle Info) is correct.
      // Prefer the expanded ROM text; fall back to the short ER summary.
      const erDescription =
        getErAbilityRomDescription(enAbilityName(mutableAbility)) ?? getErAbilityDescription(pokerogueId as AbilityId);
      if (erDescription) {
        mutableAbility.descriptionOverride = erDescription;
      }
      // Install the sentinel as a non-enumerable property so the marker
      // doesn't leak into for-in loops or JSON serialization.
      Object.defineProperty(mutableAbility, PATCHED_MARKER, {
        value: true,
        enumerable: false,
        configurable: false,
        writable: false,
      });
      result.abilityDeltas++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.abilityErrors.push(`Patcher for ability id ${pokerogueId} threw: ${msg}`);
    }
  }

  // === MOVE MECHANIC PATCHES ===
  // The numeric retunes in the moves loop above only touch power/accuracy/pp/
  // priority/chance. ER additionally rewires the mechanic of ~111 vanilla
  // moves (type swaps, category swaps, status-on-hit additions, OHKO removals,
  // flag bits). Those edits live in a sibling dispatch table for legibility.
  const moveMechPatches = initEliteReduxVanillaMovePatches();
  result.moveMechanicDeltas = moveMechPatches.moveDeltas;
  result.moveMissing += moveMechPatches.moveMissing;
  result.moveErrors.push(...moveMechPatches.moveErrors);

  return result;
}

// =============================================================================
// Helper functions
// =============================================================================

/**
 * Replace the vanilla `PostSummonWeatherChangeAbAttr` on the ability with a
 * subclass that sets the requested weather AND patches the resulting weather's
 * `turnsLeft` to a custom duration (ER convention: 8 turns).
 *
 * Why subclass and replace instead of mutating? The vanilla attr only stores
 * the WeatherType (no turn count — duration is determined by the arena's
 * `trySetWeather` which hard-codes 5). Subclassing lets us override `apply` to
 * call `trySetWeather` and then bump `globalScene.arena.weather.turnsLeft` to
 * the ER value. The arena's `weather` field is freshly constructed inside
 * `trySetWeather`, so this post-call patch survives.
 *
 * For SNOW_WARNING we also change the weather type from SNOW to HAIL (ER uses
 * the older hail naming, not pokerogue's snow).
 */
function patchWeatherSummoner(ability: MutableAbility, weather: WeatherType, turns: number): void {
  // Replace the PostSummonWeatherChangeAbAttr instance(s).
  const attrs = ability.attrs;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (attr instanceof PostSummonWeatherChangeAbAttr) {
      attrs[i] = new ErWeatherSummonAbAttr(weather, turns);
    } else if (attr instanceof PostBiomeChangeWeatherChangeAbAttr) {
      // PostBiomeChangeWeatherChangeAbAttr fires when the biome changes — we
      // mirror the weather change there too so the new biome retains ER's weather.
      attrs[i] = new ErBiomeChangeWeatherAbAttr(weather, turns);
    }
  }
}

/**
 * Subclass that wraps the vanilla weather summoner with a post-call patch to
 * bump the resulting weather's `turnsLeft` to the configured ER duration.
 * Carries the new weather type so we can also change SNOW → HAIL for ER's
 * SNOW_WARNING.
 */
/**
 * ER's weather/terrain summoners hard-set the duration to a flat ER value, which DISCARDED
 * the Mystical Rock (FieldEffectModifier, +2 turns/stack) extension that the base
 * `super.apply()` -> `trySetWeather` had already added. Reported: Drought didn't gain turns
 * from Mystical Rock. Re-apply the extender on top of ER's base so the bonus is preserved
 * (mirrors arena.trySetWeather's own FieldEffectModifier hook). No-op without the item.
 */
function erFieldTurnsWithItems(pokemon: Pokemon, baseTurns: number): number {
  const dur = new NumberHolder(baseTurns);
  globalScene.applyModifier(FieldEffectModifier, pokemon.isPlayer(), pokemon, dur);
  return dur.value;
}

class ErWeatherSummonAbAttr extends PostSummonWeatherChangeAbAttr {
  private readonly erTurns: number;

  constructor(weather: WeatherType, turns: number) {
    super(weather);
    this.erTurns = turns;
  }

  public override apply(params: Parameters<PostSummonWeatherChangeAbAttr["apply"]>[0]): void {
    super.apply(params);
    if (!params.simulated) {
      const arenaWeather = globalScene.arena.weather;
      if (arenaWeather && arenaWeather.weatherType === this.weatherType && arenaWeather.turnsLeft > 0) {
        const turns = erFieldTurnsWithItems(params.pokemon, this.erTurns);
        arenaWeather.turnsLeft = turns;
        arenaWeather.maxDuration = turns;
      }
    }
  }
}

/** Same as ErWeatherSummonAbAttr but for the post-biome-change weather setter. */
class ErBiomeChangeWeatherAbAttr extends PostBiomeChangeWeatherChangeAbAttr {
  private readonly erTurns: number;

  constructor(weather: WeatherType, turns: number) {
    super(weather);
    this.erTurns = turns;
  }

  public override apply(params: Parameters<PostBiomeChangeWeatherChangeAbAttr["apply"]>[0]): void {
    super.apply(params);
    if (!params.simulated) {
      const arenaWeather = globalScene.arena.weather;
      if (arenaWeather && arenaWeather.turnsLeft > 0) {
        const turns = erFieldTurnsWithItems(params.pokemon, this.erTurns);
        arenaWeather.turnsLeft = turns;
        arenaWeather.maxDuration = turns;
      }
    }
  }
}

/**
 * Replace the vanilla `PostSummonTerrainChangeAbAttr` on the ability with one
 * that patches the resulting terrain's `turnsLeft` to ER's 8 turns.
 */
function patchTerrainSummoner(ability: MutableAbility, turns: number): void {
  const attrs = ability.attrs;
  for (let i = 0; i < attrs.length; i++) {
    const attr = attrs[i];
    if (attr instanceof PostSummonTerrainChangeAbAttr) {
      // PostSummonTerrainChangeAbAttr stores the terrain type as a private field
      // — read it via a narrow cast then build the subclass instance.
      const terrainType = (attr as unknown as { terrainType: TerrainType }).terrainType;
      attrs[i] = new ErTerrainSummonAbAttr(terrainType, turns);
    }
  }
}

class ErTerrainSummonAbAttr extends PostSummonTerrainChangeAbAttr {
  private readonly erTurns: number;

  constructor(terrain: TerrainType, turns: number) {
    // The base class private field is `terrainType` — we re-pass via super().
    super(terrain);
    this.erTurns = turns;
  }

  public override apply(params: Parameters<PostSummonTerrainChangeAbAttr["apply"]>[0]): void {
    super.apply(params);
    if (!params.simulated) {
      const arenaTerrain = globalScene.arena.terrain;
      if (arenaTerrain && arenaTerrain.turnsLeft > 0) {
        arenaTerrain.turnsLeft = erFieldTurnsWithItems(params.pokemon, this.erTurns);
      }
    }
  }
}

/**
 * Add a non-contact ChanceStatusOnHit proc to a vanilla ability that
 * already has the contact-only proc (e.g. Static, Flame Body). ER's twist
 * is "also fires on non-contact at a lower rate"; this appends a fresh
 * ChanceStatusOnHitAbAttr instance with contactRequired:false. Idempotent
 * via the PATCHED_MARKER on the parent ability.
 */
function addNonContactStatusChance(ability: MutableAbility, effect: StatusEffect, chance: number): void {
  // IMPORTANT: must use contactExcluded (not contactRequired:false) so the
  // proc fires ONLY on non-contact moves. Otherwise the new layer would
  // stack with the pre-existing contact-only vanilla proc on contact moves
  // — user-reported as "Flame Body burns nearly 100% of the time" during
  // testing (1 - 0.7*0.8 = 44% on contact when stacking, vs the spec's
  // intended 30% contact + 20% non-contact disjoint procs).
  ability.attrs.push(
    new ChanceStatusOnHitAbAttr({
      chance,
      effects: [effect],
      contactExcluded: true,
    }),
  );
}

/**
 * Add a PostAttack (offense-side) version of the status proc — ER's "Also
 * works on offense" rider on Flame Body / Poison Point / Static / Cute
 * Charm / etc. When the holder uses a contact move against an opponent,
 * the proc rolls against THEM (mirrors vanilla's defend-side proc but in
 * the opposite direction).
 *
 * Pokerogue exposes PostAttackContactApplyStatusEffectAbAttr — same
 * mechanic, same RNG path.
 */
function addOffenseContactStatusChance(ability: MutableAbility, effect: StatusEffect, chance: number): void {
  if (!ability.attrs.some(attr => attr instanceof PostAttackContactApplyStatusEffectAbAttr)) {
    ability.attrs.push(new PostAttackContactApplyStatusEffectAbAttr(chance, effect));
  }
}

function addOffenseNonContactStatusChance(ability: MutableAbility, effect: StatusEffect, chance: number): void {
  ability.attrs.push(
    new ChanceStatusOnAttackAbAttr({
      chance,
      effects: [effect],
      contactExcluded: true,
    }),
  );
}

/**
 * Replace vanilla's fixed-SPATK TypeImmunityStatStageChange with the ER
 * "highest Atk" variant (whichever of ATK/SPATK is higher gets +1). Used
 * by Lightning Rod / Storm Drain / Sap Sipper per ER v2.65 text.
 */
function patchTypeImmunityHighestAtk(ability: MutableAbility, immuneType: PokemonType): void {
  // Strip the vanilla SPATK-only entry.
  const filtered = ability.attrs.filter(a => !(a instanceof TypeImmunityStatStageChangeAbAttr));
  // Mutate in place — `attrs` is a public readonly binding but the array
  // contents are mutable. Use splice + push to preserve the binding.
  ability.attrs.splice(0, ability.attrs.length, ...filtered);
  ability.attrs.push(new TypeImmunityHighestAttackStatStageAbAttr({ immuneType, stages: 1 }));
}

/**
 * Mutate the `multiplier` field on a `StatMultiplierAbAttr` of the given stat.
 * The field is declared `readonly` at the TS level but is a plain JS property
 * — the readonly modifier is structural, not enforced at runtime. Used by the
 * weather-speed family (Swift Swim et al).
 */
function mutateStatMultiplier(ability: MutableAbility, stat: Stat, multiplier: number): void {
  for (const attr of ability.attrs) {
    if (attr instanceof StatMultiplierAbAttr && attr.stat === stat) {
      (attr as unknown as { multiplier: number }).multiplier = multiplier;
    }
  }
}

/**
 * Mutate the `healFactor` field on a `PostWeatherLapseHealAbAttr`. Used by
 * Rain Dish and Ice Body (1/16 → 1/8, achieved via healFactor 1 → 2).
 */
function mutateHealFactor(ability: MutableAbility, healFactor: number): void {
  for (const attr of ability.attrs) {
    if (attr instanceof PostWeatherLapseHealAbAttr) {
      (attr as unknown as { healFactor: number }).healFactor = healFactor;
    }
  }
}

/**
 * Mutate the `chance` field on a `PostDefendContactApplyTagChanceAbAttr`. Used
 * by Cute Charm (30 → 50).
 */
function mutateContactTagChance(ability: MutableAbility, tagType: BattlerTagType, chance: number): void {
  for (const attr of ability.attrs) {
    if (attr instanceof PostDefendContactApplyTagChanceAbAttr) {
      const tagged = attr as unknown as { tagType: BattlerTagType; chance: number };
      if (tagged.tagType === tagType) {
        tagged.chance = chance;
      }
    }
  }
}

/**
 * Replace BAD_DREAMS's vanilla `PostTurnHurtIfSleepingAbAttr` (1/8 max HP) with
 * an ER-tuned version that does 1/4 max HP.
 */
function patchBadDreams(ability: MutableAbility): void {
  const attrs = ability.attrs;
  for (let i = 0; i < attrs.length; i++) {
    if (attrs[i] instanceof PostTurnHurtIfSleepingAbAttr) {
      attrs[i] = new ErBadDreamsAbAttr();
    }
  }
}

/** ER Bad Dreams: 1/4 max HP per turn instead of vanilla's 1/8. */
class ErBadDreamsAbAttr extends PostTurnHurtIfSleepingAbAttr {
  public override apply(params: Parameters<PostTurnHurtIfSleepingAbAttr["apply"]>[0]): void {
    if (params.simulated) {
      return;
    }
    const pokemon = params.pokemon;
    for (const opp of pokemon.getOpponentsGenerator()) {
      const isAsleep = opp.status?.effect === StatusEffect.SLEEP || opp.hasAbility(AbilityId.COMATOSE);
      if (!isAsleep || opp.switchOutStatus) {
        continue;
      }
      if (opp.hasAbilityWithAttr("BlockNonDirectDamageAbAttr")) {
        continue;
      }
      // 1/4 max HP (ER) instead of vanilla's 1/8.
      const damage = Math.max(1, Math.floor(opp.getMaxHp() / 4));
      opp.damageAndUpdate(damage, { result: HitResult.INDIRECT });
    }
  }
}

/**
 * Mutate the `powerMultiplier` field on a `MovePowerBoostAbAttr` whose
 * underlying condition includes the configured `flag`. Used by Iron Fist (1.2
 * → 1.3) and Strong Jaw (1.5 → 1.3).
 *
 * We can't introspect the closure to verify which flag it gates on (no
 * structured filter), so we simply mutate the multiplier on ALL
 * MovePowerBoostAbAttr instances in the ability — vanilla flag-boosters ship a
 * single such attr. The `flag` argument is kept in the signature for
 * documentation / future-proofing.
 */
function mutateFlagPowerBoost(ability: MutableAbility, _flag: MoveFlags, multiplier: number): void {
  for (const attr of ability.attrs) {
    // Iron Fist & Strong Jaw ship a MovePowerBoostAbAttr that's NOT a subclass
    // (i.e. exact class match), so we narrow accordingly.
    if (attr.constructor === MovePowerBoostAbAttr) {
      (attr as unknown as { powerMultiplier: number }).powerMultiplier = multiplier;
    }
  }
}

/** Mutate the `powerMultiplier` on a MovePowerBoostAbAttr (used by Neuroforce). */
function mutateMovePowerBoost(ability: MutableAbility, multiplier: number): void {
  for (const attr of ability.attrs) {
    if (attr.constructor === MovePowerBoostAbAttr) {
      (attr as unknown as { powerMultiplier: number }).powerMultiplier = multiplier;
    }
  }
}

/** Mutate the `powerMultiplier` on a MoveTypePowerBoostAbAttr (used by Transistor). */
function mutateTypePowerBoost(ability: MutableAbility, multiplier: number): void {
  for (const attr of ability.attrs) {
    if (attr instanceof MoveTypePowerBoostAbAttr) {
      (attr as unknown as { powerMultiplier: number }).powerMultiplier = multiplier;
    }
  }
}

/** Mutate the `powerMultiplier` on a UserFieldMoveTypePowerBoostAbAttr (used by Steely Spirit). */
function mutateUserFieldTypeBoost(ability: MutableAbility, multiplier: number): void {
  for (const attr of ability.attrs) {
    if (attr instanceof UserFieldMoveTypePowerBoostAbAttr) {
      (attr as unknown as { powerMultiplier: number }).powerMultiplier = multiplier;
    }
  }
}

/**
 * Mutate the multiplier on all StatMultiplierAbAttr and AllyStatMultiplierAbAttr
 * instances of the ACC stat in this ability (used by VICTORY_STAR).
 */
function mutateAllAccBoosts(ability: MutableAbility, multiplier: number): void {
  for (const attr of ability.attrs) {
    if (attr instanceof StatMultiplierAbAttr && attr.stat === Stat.ACC) {
      (attr as unknown as { multiplier: number }).multiplier = multiplier;
    }
    if (attr instanceof AllyStatMultiplierAbAttr) {
      (attr as unknown as { multiplier: number }).multiplier = multiplier;
    }
  }
}

/**
 * Mutate the `damageMultiplier` field on a `ReceivedMoveDamageMultiplierAbAttr`.
 * Used by FILTER / SOLID_ROCK / PRISM_ARMOR (0.75 → 0.65).
 */
function mutateReceivedDamageMultiplier(ability: MutableAbility, multiplier: number): void {
  for (const attr of ability.attrs) {
    if (attr instanceof ReceivedMoveDamageMultiplierAbAttr) {
      (attr as unknown as { damageMultiplier: number }).damageMultiplier = multiplier;
    }
  }
}

/**
 * Mutate the `damageMultiplier` field on an `AlliedFieldDamageReductionAbAttr`.
 * Used by FRIEND_GUARD (0.75 → 0.5 — ER takes 50% off ally damage instead of 25%).
 */
function mutateAlliedFieldReduction(ability: MutableAbility, multiplier: number): void {
  for (const attr of ability.attrs) {
    if (attr instanceof AlliedFieldDamageReductionAbAttr) {
      (attr as unknown as { damageMultiplier: number }).damageMultiplier = multiplier;
    }
  }
}

/**
 * Replace the DEFEATIST condition to trigger at HP <= 1/3 instead of vanilla's
 * 1/2. DEFEATIST has TWO StatMultiplierAbAttrs (ATK and SPATK) gated on the
 * ability-level condition (set via `.condition()` on the builder). We can't
 * easily mutate the closure stored in `ability.conditions[]`, so we replace
 * the attrs with condition-per-attr versions.
 */
function patchDefeatistThreshold(ability: MutableAbility): void {
  // Approach: leave the ability-level condition alone (it still gates at <=0.5),
  // and instead replace the stat multiplier attrs with subclasses that re-check
  // <= 1/3 inside canApply. The effective gate is the AND of the two.
  for (let i = 0; i < ability.attrs.length; i++) {
    const attr = ability.attrs[i];
    if (attr instanceof StatMultiplierAbAttr) {
      const stat = attr.stat;
      const multiplier = (attr as unknown as { multiplier: number }).multiplier;
      ability.attrs[i] = new ErDefeatistStatMultiplierAbAttr(stat, multiplier);
    }
  }
  // Replace the ability-level condition with the tighter ER threshold by
  // mutating the conditions array (readonly binding, mutable contents).
  const conditions = ability.conditions as Array<(p: { getHpRatio: () => number }) => boolean>;
  conditions.length = 0;
  conditions.push(p => p.getHpRatio() <= 1 / 3);
}

class ErDefeatistStatMultiplierAbAttr extends StatMultiplierAbAttr {
  public override canApply(params: Parameters<StatMultiplierAbAttr["canApply"]>[0]): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    return params.pokemon.getHpRatio() <= 1 / 3;
  }
}

/**
 * Replace HEALER's conditional 50% chance with 30% (ER convention). Uses the
 * same `conditionalAttr` pattern as vanilla but with the tighter chance.
 *
 * NOTE: The vanilla HEALER uses `randSeedInt(10) < 3` (30%) wait — actually
 * vanilla `init-abilities.ts:910` says `randSeedInt(10) < 3` which is already
 * 30%. The audit doc lists it as "50% → 30%" but vanilla is ALREADY 30% in
 * pokerogue. Skipping the patch — see audit notes. (Defensive: this function
 * is a no-op.)
 */
function patchHealerChance(ability: MutableAbility): void {
  // pokerogue's HEALER is already at 30% (`randSeedInt(10) < 3`) for the ALLY
  // cure. ER 2.65 dex additionally cures the USER's own status with an
  // INDEPENDENT 30% check ("cures status for both the user AND their ally.
  // Makes 2 separate checks for each Pokemon."). Add the self-cure branch with
  // its own roll — the ally branch stays as the vanilla attr.
  ability.attrs.push(new PostTurnResetStatusAbAttr(false).addCondition(_pokemon => randSeedInt(10) < 3));
}

/**
 * Add a "type-X-moves get a +1.2x baseline boost" attr alongside the vanilla
 * low-HP boost. Used by OVERGROW/BLAZE/TORRENT/SWARM.
 *
 * ER C-source (battle_util.c) is MUTUALLY EXCLUSIVE: `HP <= 1/3 ? 1.5 : 1.2`.
 * The vanilla `LowHpMoveTypePowerBoostAbAttr` already supplies the ×1.5 at
 * HP <= 1/3, so the baseline ×1.2 must be gated to HP > 1/3 — otherwise both
 * fire below 1/3 HP and stack to 1.2×1.5 = 1.8× (bug). Gating makes the two
 * boosts exclusive, exactly matching the dex if/else.
 */
function addBaselineTypeBoost(ability: MutableAbility, type: PokemonType, multiplier: number): void {
  ability.attrs.push(
    new MoveTypePowerBoostAbAttr(type, multiplier).addCondition(pokemon => pokemon.getHpRatio() > 0.33),
  );
}

/**
 * Add a StatusEffectImmunity-like attr for a stat other than ATK. Used by
 * HYPER_CUTTER to extend stat protection from ATK to SPATK. (We reuse the
 * stat-immune attr signature by adapting from the existing ProtectStat.)
 */
function addStatProtect(ability: MutableAbility, stat: Stat): void {
  // We can't easily import ProtectStatAbAttr here without breaking the import
  // header alphabetization. Walk the existing attrs for the ATK-protect and
  // clone it with the SPATK stat by setting the protectedStat field directly.
  for (const attr of ability.attrs) {
    // ProtectStatAbAttr's first attr is the ATK protect — find its constructor name.
    if (attr.constructor.name === "ProtectStatAbAttr") {
      // Build a sibling instance via the same constructor with the new stat.
      const Ctor = attr.constructor as new (stat?: Stat) => AbAttr;
      ability.attrs.push(new Ctor(stat));
      return;
    }
  }
}

// =============================================================================
// Round 2 helpers
// =============================================================================

/**
 * Extend the BattlerTagImmunity attrs on the given ability to include an
 * additional immune tag (e.g. ER_FEAR). Mutates the private `immuneTagTypes`
 * array in-place on every BattlerTagImmunityAbAttr-subclass attr in the chain.
 *
 * Used by INNER_FOCUS / OBLIVIOUS / OWN_TEMPO to add ER's "Scare" immunity.
 */
function extendBattlerTagImmunity(ability: MutableAbility, additional: BattlerTagType): void {
  for (const attr of ability.attrs) {
    // BattlerTagImmunityAbAttr and UserFieldBattlerTagImmunityAbAttr both extend
    // BaseBattlerTagImmunityAbAttr which has the `immuneTagTypes` private array.
    if (attr.constructor.name === "BattlerTagImmunityAbAttr" || attr instanceof UserFieldBattlerTagImmunityAbAttr) {
      const tagged = attr as unknown as { immuneTagTypes: BattlerTagType[] };
      if (Array.isArray(tagged.immuneTagTypes) && !tagged.immuneTagTypes.includes(additional)) {
        tagged.immuneTagTypes.push(additional);
      }
    }
  }
}

/**
 * Replace WEAK_ARMOR's "physical move" gate with a "contact move" gate.
 * Vanilla has TWO PostDefendStatStageChangeAbAttr instances — both share the
 * physical predicate. We mutate the private `condition` closure on each.
 */
function mutateWeakArmorPredicate(ability: MutableAbility): void {
  for (const attr of ability.attrs) {
    if (attr instanceof PostDefendStatStageChangeAbAttr) {
      const tagged = attr as unknown as {
        condition: (
          target: import("#field/pokemon").Pokemon,
          user: import("#field/pokemon").Pokemon,
          move: import("#moves/move").Move,
        ) => boolean;
      };
      tagged.condition = (target, user, move) =>
        move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user, target });
    }
  }
}

/**
 * Patch MAGICIAN to only proc on non-contact moves. Vanilla unconditionally
 * steals; we replace with a subclass that gates the proc on `!MAKES_CONTACT`.
 */
function patchMagicianPredicate(ability: MutableAbility): void {
  for (let i = 0; i < ability.attrs.length; i++) {
    if (ability.attrs[i] instanceof PostAttackStealHeldItemAbAttr) {
      ability.attrs[i] = new ErMagicianStealAbAttr();
    }
  }
}

class ErMagicianStealAbAttr extends PostAttackStealHeldItemAbAttr {
  public override canApply(params: Parameters<PostAttackStealHeldItemAbAttr["canApply"]>[0]): boolean {
    // Require the move to NOT make contact (ER convention).
    if (
      params.move.doesFlagEffectApply({
        flag: MoveFlags.MAKES_CONTACT,
        user: params.pokemon,
        target: params.opponent,
      })
    ) {
      return false;
    }
    return super.canApply(params);
  }
}

/**
 * Extend MERCILESS's ConditionalCritAbAttr predicate to the ER 2.65 spec:
 * "Guarantees critical hits against targets who are poisoned, paralyzed,
 * bleeding, or have their speed lowered." (Vanilla only covers POISON/TOXIC;
 * ER adds PARALYSIS, ER_BLEED, and speed-lowered — and does NOT include SLEEP.)
 * We can't inspect the captured closure, so we replace the attr with a fresh one.
 */
function extendMercilessConditions(ability: MutableAbility): void {
  for (let i = 0; i < ability.attrs.length; i++) {
    if (ability.attrs[i] instanceof ConditionalCritAbAttr) {
      ability.attrs[i] = new ConditionalCritAbAttr((_user, target, _move) => {
        if (!target) {
          return false;
        }
        const eff = target.status?.effect;
        if (eff === StatusEffect.POISON || eff === StatusEffect.TOXIC || eff === StatusEffect.PARALYSIS) {
          return true;
        }
        // Bleeding (custom battler tag) or speed-lowered.
        return target.getTag?.(BattlerTagType.ER_BLEED) != null || target.getStatStage(Stat.SPD) < 0;
      });
    }
  }
}

/**
 * Extend SHADOW_TAG / MAGNET_PULL / ARENA_TRAP's ArenaTrapAbAttr predicate to
 * skip Ghost-type targets (ER convention).
 */
function extendArenaTrapToIgnoreGhost(ability: MutableAbility): void {
  for (let i = 0; i < ability.attrs.length; i++) {
    const attr = ability.attrs[i];
    if (attr instanceof ArenaTrapAbAttr) {
      const oldPred = (
        attr as unknown as {
          arenaTrapCondition: (
            user: import("#field/pokemon").Pokemon,
            target: import("#field/pokemon").Pokemon,
          ) => boolean;
        }
      ).arenaTrapCondition;
      ability.attrs[i] = new ArenaTrapAbAttr((user, target) => {
        if (target.isOfType(PokemonType.GHOST)) {
          return false;
        }
        return oldPred ? oldPred(user, target) : true;
      });
    }
  }
}

/**
 * Replace DAMP's vanilla `FieldPreventExplosiveMovesAbAttr` (block Explosion/
 * Self-Destruct) with ER's repurposed behavior: when an opponent makes contact
 * with the holder, the attacker's type becomes pure Water
 * ({@linkcode PostDefendChangeAttackerTypeAbAttr}). The "also works on offense"
 * (holder's contact move turns the TARGET Water) clause needs a post-attack
 * add-type-to-target primitive that doesn't exist yet — deferred. ER drops
 * explosion-blocking entirely, so nothing else carries that attr afterward.
 */
function patchDamp(ability: MutableAbility): void {
  for (let i = 0; i < ability.attrs.length; i++) {
    if (ability.attrs[i].constructor.name === "FieldPreventExplosiveMovesAbAttr") {
      ability.attrs[i] = new PostDefendChangeAttackerTypeAbAttr({
        type: PokemonType.WATER,
        contactOnly: true,
        side: "attacker",
      });
    }
  }
  // ER Damp is "Makes foe Water-type on contact, offense & defense." The loop
  // above wires the defensive half (holder is hit by contact → attacker becomes
  // Water); add the offensive half (holder hits with contact → target becomes
  // Water).
  if (!ability.attrs.some(a => a instanceof PostAttackChangeTargetTypeAbAttr)) {
    ability.attrs.push(new PostAttackChangeTargetTypeAbAttr({ type: PokemonType.WATER, contactOnly: true }));
  }
}

/**
 * Replace AFTERMATH's vanilla PostFaintContactDamageAbAttr (1/4 max HP on
 * contact KO) with the ER faithful behavior: on a lethal damaging hit the
 * holder uses a 100 BP Explosion (physical) / Outburst (special) that hits all
 * adjacent Pokemon (including its own ally in doubles), always flinches, plays
 * the explosion animation, and self-KOs. See {@linkcode PostFaintDetonateAbAttr}
 * for why this is a PreDefend clamp rather than a post-faint hook (a fainted
 * Pokemon cannot run a move).
 */
function patchAftermath(ability: MutableAbility): void {
  for (let i = 0; i < ability.attrs.length; i++) {
    if (ability.attrs[i].constructor.name === "PostFaintContactDamageAbAttr") {
      ability.attrs[i] = new PostFaintDetonateAbAttr({ power: 100, flinch: true });
    }
  }
}

/**
 * ER reworks COLOR_CHANGE: vanilla swaps the holder's type to the move's type
 * AFTER being hit (`PostDefendTypeChangeAbAttr`). ER instead changes the holder's
 * type to one that RESISTS / is immune to the move BEFORE the hit lands, so the
 * swap actually reduces the damage (ROM: "Changes type to a resist or an immunity
 * before getting hit"). Swap the post-hit attr for the pre-hit
 * {@linkcode PreHitResistTypeChangeAbAttr}; the swap itself is applied from
 * move-effect-phase before effectiveness is computed. The Sheer-Force-disable
 * condition on the ability is preserved.
 */
function patchColorChange(ability: MutableAbility): void {
  let replaced = false;
  for (let i = 0; i < ability.attrs.length; i++) {
    if (ability.attrs[i].constructor.name === "PostDefendTypeChangeAbAttr") {
      ability.attrs[i] = new PreHitResistTypeChangeAbAttr();
      replaced = true;
    }
  }
  // Defensive: if the vanilla attr layout ever changes, still guarantee the
  // pre-hit resist attr is present.
  if (!replaced && !ability.attrs.some(a => a.constructor.name === "PreHitResistTypeChangeAbAttr")) {
    ability.attrs.push(new PreHitResistTypeChangeAbAttr());
  }
}

/**
 * Replace FOREWARN's ForewarnAbAttr (reveal-strongest-move) with an
 * EntryEffectAbAttr that scripts the dedicated 80-BP always-hit Future Sight
 * variant ({@linkcode FOREWARN_FUTURE_SIGHT_ID}) on entry — NOT the real 120-BP
 * move. The variant is registered by {@linkcode registerForewarnFutureSight}.
 */
function patchForewarn(ability: MutableAbility): void {
  for (let i = 0; i < ability.attrs.length; i++) {
    if (ability.attrs[i].constructor.name === "ForewarnAbAttr") {
      ability.attrs[i] = new EntryEffectAbAttr({ kind: "scripted-move", move: FOREWARN_FUTURE_SIGHT_ID });
    }
  }
}

/**
 * Replace PASTEL_VEIL's status-immunity attrs with a Safeguard-on-entry
 * scripted move. ER nukes the team poison-immunity in favor of a one-shot
 * Safeguard at entry time.
 */
function patchPastelVeil(ability: MutableAbility): void {
  ability.attrs.length = 0;
  ability.attrs.push(new EntryEffectAbAttr({ kind: "scripted-move", move: MoveId.SAFEGUARD }));
}

/**
 * Replace LEAF_GUARD's "status immunity in sun" with "cures status at turn end
 * in sun". We strip the immunity attr (ER explicitly removes the immunity)
 * and replace with PostTurnResetStatusAbAttr — looked up lazily from the
 * global attr registry to avoid an additional import.
 */
/**
 * Patch LIMBER per ER 7 spec: paralysis-immune (kept from vanilla) +
 * SELF-stat-drop immunity (SelfStatDropImmunityAbAttr — blocks the holder's own
 * Overheat / Close Combat drops, NOT incoming Growl / Intimidate) + half recoil.
 * A prior pass used ProtectStatAbAttr, which is the inverse (blocks incoming
 * drops, never self) and wrongly let Growl/Intimidate be shrugged off.
 */
function patchLimber(ability: MutableAbility): void {
  // Add the self-stat-drop guard. ER Limber is "immune to SELF stat drops"
  // (Overheat / Close Combat / Draco Meteor) — NOT incoming drops. The prior
  // code used ProtectStatAbAttr (Clear Body), which is the opposite: it blocked
  // Growl / Intimidate but never self-drops. SelfStatDropImmunityAbAttr fires in
  // the stat-change phase's self-target branch instead.
  ability.attrs.push(new SelfStatDropImmunityAbAttr());
  // Add half-recoil via the new RecoilDamageMultiplierAbAttr primitive
  // (move.ts:RecoilAttr.apply scans for this constructor name and
  // applies the factor before computing recoil damage).
  ability.attrs.push(new RecoilDamageMultiplierAbAttr({ factor: 0.5 }));
  // Remove any prior INFATUATED-immunity extension that an earlier helper
  // may have added (defensive — if extendBattlerTagImmunity ran before this
  // patcher in a prior session it may have left behind an extra entry on
  // the vanilla UserFieldBattlerTagImmunity. Use a string-name probe to
  // avoid binding to a specific class reference here).
  ability.attrs = ability.attrs.filter(a => {
    if (a.constructor.name !== "UserFieldBattlerTagImmunityAbAttr") {
      return true;
    }
    // Drop the field-wide INFATUATED-immunity that ER didn't ask for.
    const tagSet = (a as unknown as { immuneTagTypes?: unknown }).immuneTagTypes;
    if (Array.isArray(tagSet) && tagSet.length === 1 && tagSet[0] === BattlerTagType.INFATUATED) {
      return false;
    }
    return true;
  });
}

/**
 * ER Clear Body / Full Metal Body (2.65 dex): each "gives immunity to all stat
 * reductions from moves and abilities. Includes self stat drops from moves like
 * Overheat." Vanilla and the prior port wired only ProtectStatAbAttr, which
 * blocks INCOMING drops (Growl, Intimidate) but never the holder's OWN drops -
 * so an Overheat / Draco Meteor / Close Combat user still lost the stat (the
 * reported Flygon Redux + Draco Meteor dropping SpAtk through Clear Body). Keep
 * ProtectStatAbAttr and ADD SelfStatDropImmunityAbAttr (which fires in the
 * stat-change phase's self-target branch), so both incoming AND self drops are
 * negated. Idempotent. White Smoke is intentionally NOT included: ER reworks it
 * into a Smokescreen-on-entry evasion ability, not a stat protector.
 */
function patchSelfStatDropImmunity(ability: MutableAbility): void {
  if (!ability.attrs.some(a => a.constructor.name === "SelfStatDropImmunityAbAttr")) {
    ability.attrs.push(new SelfStatDropImmunityAbAttr());
  }
}

function patchLeafGuard(ability: MutableAbility): void {
  ability.attrs = ability.attrs.filter(a => !(a instanceof StatusEffectImmunityAbAttr));
  const PostTurnResetStatusCtor = getAttrCtorByName("PostTurnResetStatusAbAttr");
  if (PostTurnResetStatusCtor !== undefined) {
    // allyTarget=false → cures the HOLDER's own status (Leaf Guard / Sun's Bounty
    // are self-protective per their text: "cures all status conditions at the end
    // of the turn"). Previously passed `true`, which cured the ally instead — so
    // the holder never cured itself (and Sun's Bounty 801, which composites this,
    // inherited the same bug).
    ability.attrs.push(new PostTurnResetStatusCtor(false) as AbAttr);
  }
  // ER spec adds an "in sun" gate. The cure should ONLY fire while sun is
  // active. ability.conditions is a mutable array — pushing onto it gates
  // the entire ability via pokemon.ts:2424's condition.find check, which
  // is fine here because vanilla Leaf Guard does nothing outside sun
  // anyway (the immunity it would grant is also weather-gated).
  const conditions = ability.conditions as Array<(p: Pokemon) => boolean>;
  conditions.push((_p: Pokemon) => {
    const w = globalScene.arena.weather?.weatherType;
    return w === WeatherType.SUNNY || w === WeatherType.HARSH_SUN;
  });
}

/**
 * Look up an AbAttr constructor by string name from the live `allAbilities`
 * table. Used for a small handful of conditional patches where the import
 * surface would be disproportionately large.
 */
function getAttrCtorByName(name: string): (new (...args: unknown[]) => AbAttr) | undefined {
  for (const ability of allAbilities) {
    if (!ability) {
      continue;
    }
    for (const attr of ability.attrs) {
      if (attr.constructor.name === name) {
        return attr.constructor as new (
          ...args: unknown[]
        ) => AbAttr;
      }
    }
  }
  return;
}

/**
 * Patch FLOWER_GIFT: vanilla boosts ATK + SPDEF in sun; ER boosts SPATK + SPDEF.
 * Mutate the `stat` field on the ATK multipliers to SPATK.
 */
function patchFlowerGift(ability: MutableAbility): void {
  for (const attr of ability.attrs) {
    if (attr instanceof StatMultiplierAbAttr && attr.stat === Stat.ATK) {
      (attr as unknown as { stat: Stat }).stat = Stat.SPATK;
    }
    if (attr instanceof AllyStatMultiplierAbAttr) {
      const tagged = attr as unknown as { stat: Stat };
      if (tagged.stat === Stat.ATK) {
        tagged.stat = Stat.SPATK;
      }
    }
  }
}

/**
 * Patch SOLAR_POWER: ER drops the vanilla in-sun self-damage entirely and boosts
 * the holder's HIGHEST attacking stat (not just Sp.Atk). Vanilla pokerogue wires
 * both a `PostWeatherLapseDamageAbAttr` (lose 1/8 max HP each turn in sun) and a
 * `StatMultiplierAbAttr(SPATK, 1.5)`. ER's ROM text ("Boosts the Pokemon's
 * highest attacking stat by 50% during sun.") has no HP cost, so strip the damage
 * attr and swap the SpAtk-only multiplier for the ATK/SpAtk-highest primitive
 * (mirrors the Big Leaves 374 composite) so a physical attacker also benefits.
 */
function patchSolarPower(ability: MutableAbility): void {
  ability.attrs = ability.attrs.filter(
    a => !(a instanceof PostWeatherLapseDamageAbAttr) && !(a instanceof StatMultiplierAbAttr && a.stat === Stat.SPATK),
  );
  ability.attrs.push(
    new SelfHighestStatMultiplierAbAttr({
      candidates: [Stat.ATK, Stat.SPATK],
      multiplier: 1.5,
      weathers: [WeatherType.SUNNY, WeatherType.HARSH_SUN],
    }),
  );
}

/**
 * Rewrite BIG_PECKS: replace Def-drop immunity with a 1.3x contact damage
 * power boost.
 */
function rewriteBigPecks(ability: MutableAbility): void {
  ability.attrs.length = 0;
  ability.attrs.push(new MovePowerBoostAbAttr((_user, _target, move) => move.hasFlag(MoveFlags.MAKES_CONTACT), 1.3));
}

/**
 * Rewrite ILLUMINATE: replace lure/acc-immune attrs with pure 1.2x accuracy
 * multiplier.
 */
/**
 * Rewrite RIVALRY to the ER 2.65 spec: "Boosts the user's damage by 25% against
 * same-gender Pokemon and reduces damage TAKEN by 25% from opposite-gender
 * Pokemon." Vanilla's opposite-gender clause reduces damage DEALT (an outgoing
 * MovePowerBoost 0.75x); ER makes it an INCOMING reduction instead. This also
 * corrects every ER ability that composes Rivalry (e.g. Empress).
 */
function rewriteRivalry(ability: MutableAbility): void {
  ability.attrs.length = 0;
  ability.attrs.push(
    new MovePowerBoostAbAttr(
      (user, target) =>
        user.gender !== Gender.GENDERLESS && target?.gender !== Gender.GENDERLESS && user.gender === target?.gender,
      1.25,
    ),
  );
  ability.attrs.push(
    new ReceivedMoveDamageMultiplierAbAttr(
      (defender, attacker) =>
        defender.gender !== Gender.GENDERLESS
        && attacker.gender !== Gender.GENDERLESS
        && defender.gender !== attacker.gender,
      0.75,
    ),
  );
}

function rewriteIlluminate(ability: MutableAbility): void {
  // ER Illuminate: "Boosts the user's accuracy by 1.2x. Removes Ghost-typing on
  // the target when landing an attack." (Both Refrigerator and Chandelier compose
  // this rewritten Illuminate, so they inherit the Ghost-strip too.)
  ability.attrs.length = 0;
  ability.attrs.push(new StatMultiplierAbAttr(Stat.ACC, 1.2));
  ability.attrs.push(new PostAttackRemoveTargetTypeAbAttr(PokemonType.GHOST));
}

/**
 * Rewrite CHEEK_POUCH: ER explicitly nullifies the ability. Clear all attrs.
 * The HealFromBerryUseAbAttr import keeps the type-check graph honest — we
 * verify vanilla shipped the heal-on-berry attr before zeroing.
 */
function rewriteCheekPouch(ability: MutableAbility): void {
  // Defensive: confirm vanilla shipped HealFromBerryUseAbAttr — informational only.
  const _hadHealAttr = ability.attrs.some(a => a instanceof HealFromBerryUseAbAttr);
  void _hadHealAttr;
  ability.attrs.length = 0;
}

/**
 * Rewrite STALL: replace vanilla "move last in priority bracket" with
 * "takes 30% less damage if it hasn't moved yet this turn".
 *
 * Modeled via a ReceivedMoveDamageMultiplierAbAttr gated on `!hasMovedThisTurn`.
 * The pokemon's `turnData.acted` (set true after acting) is the source of
 * truth.
 */
function rewriteStall(ability: MutableAbility): void {
  ability.attrs.length = 0;
  ability.attrs.push(
    new ReceivedMoveDamageMultiplierAbAttr((target, _user, _move) => {
      const td = (target as unknown as { turnData?: { acted?: boolean } }).turnData;
      return !(td?.acted ?? false);
    }, 0.7),
  );
}

/**
 * Rewrite OPPORTUNIST: replace StatStageChangeCopyAbAttr with a priority
 * modifier that grants +1 priority vs foes below 1/2 HP.
 *
 * PriorityModifierAbAttr only checks user state; here we need target-side
 * gating, so use pokerogue's ChangeMovePriorityAbAttr directly with a
 * target-aware predicate.
 */
function rewriteOpportunist(ability: MutableAbility): void {
  ability.attrs.length = 0;
  ability.attrs.push(
    new ChangeMovePriorityAbAttr((pokemon, _move) => {
      try {
        for (const opp of pokemon.getOpponents?.() ?? []) {
          if (opp.getHpRatio() <= 0.5) {
            return true;
          }
        }
      } catch {
        return false;
      }
      return false;
    }, 1),
  );
}
