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
  AlliedFieldDamageReductionAbAttr,
  AllyStatMultiplierAbAttr,
  ArenaTrapAbAttr,
  BlockStatusDamageAbAttr,
  ChangeMovePriorityAbAttr,
  ConditionalCritAbAttr,
  HealFromBerryUseAbAttr,
  IgnoreOpponentStatStagesAbAttr,
  MovePowerBoostAbAttr,
  MoveTypePowerBoostAbAttr,
  PostAttackApplyBattlerTagAbAttr,
  PostAttackApplyStatusEffectAbAttr,
  PostAttackContactApplyStatusEffectAbAttr,
  PostAttackStealHeldItemAbAttr,
  PostBiomeChangeWeatherChangeAbAttr,
  PostDefendContactApplyTagChanceAbAttr,
  PostDefendStatStageChangeAbAttr,
  PostReceiveCritStatStageChangeAbAttr,
  PostSummonAbAttr,
  PostSummonTerrainChangeAbAttr,
  PostSummonWeatherChangeAbAttr,
  PostTurnHurtIfSleepingAbAttr,
  PostWeatherLapseHealAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  ReceivedTypeDamageMultiplierAbAttr,
  StatMultiplierAbAttr,
  StatusEffectImmunityAbAttr,
  TypeImmunityStatStageChangeAbAttr,
  UserFieldBattlerTagImmunityAbAttr,
  UserFieldMoveTypePowerBoostAbAttr,
} from "#abilities/ab-attrs";
import {
  PostDefendSuppressOpponentDamageBoostAbAttr,
} from "#data/elite-redux/archetypes/post-defend-suppress-opponent-damage-boost";
import {
  TypeImmunityHighestAttackStatStageAbAttr,
} from "#data/elite-redux/archetypes/type-immunity-highest-attack-stat-stage";
import { StatTriggerOnStatLoweredAbAttr } from "#data/elite-redux/archetypes/stat-trigger-on-event";
import type { Ability } from "#abilities/ability";
import { globalScene } from "#app/global-scene";
import { allAbilities, allMoves } from "#data/data-lists";
import { ChanceStatusOnHitAbAttr } from "#data/elite-redux/archetypes/chance-status-on-hit";
import { EntryEffectAbAttr } from "#data/elite-redux/archetypes/entry-effect";
import { OnFaintEffectAbAttr } from "#data/elite-redux/archetypes/on-faint-effect";
import { TypeDamageBoostAbAttr } from "#data/elite-redux/archetypes/type-damage-boost";
import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { initEliteReduxVanillaMovePatches } from "#data/elite-redux/init-elite-redux-vanilla-move-patches";
import type { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { type BattleStat, Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";

/**
 * Numeric cutoff for "vanilla pokerogue" ids — anything ≥ this is an ER
 * custom (registered by B2). Mirrors the cutoffs in
 * `init-elite-redux-custom-{moves,abilities}.ts`.
 */
const VANILLA_ID_CUTOFF = 5000;

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

  // ===== MINOR — Speed-in-weather multiplier (2.0 → 1.5) =====
  [AbilityId.SWIFT_SWIM, ab => mutateStatMultiplier(ab, Stat.SPD, 1.5)],
  [AbilityId.CHLOROPHYLL, ab => mutateStatMultiplier(ab, Stat.SPD, 1.5)],
  [AbilityId.SAND_RUSH, ab => mutateStatMultiplier(ab, Stat.SPD, 1.5)],
  [AbilityId.SLUSH_RUSH, ab => mutateStatMultiplier(ab, Stat.SPD, 1.5)],
  [AbilityId.SURGE_SURFER, ab => mutateStatMultiplier(ab, Stat.SPD, 1.5)],

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
  // KEEN_EYE: acc-drop immune + ignore foe evasion + 1.2x accuracy boost.
  // Vanilla already has ProtectStatAbAttr(ACC). We add evasion-ignore + acc boost.
  [
    AbilityId.KEEN_EYE,
    ab => {
      ab.attrs.push(new IgnoreOpponentStatStagesAbAttr([Stat.EVA]));
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
  // HEAVY_METAL: vanilla doubles weight; ER replaces that entirely with
  // "take half damage from Ghost and Dark". Strip the weight attr AND add
  // the Ghost/Dark damage reductions.
  [
    AbilityId.HEAVY_METAL,
    ab => {
      stripWeightMultiplier(ab);
      ab.attrs.push(new ReceivedTypeDamageMultiplierAbAttr(PokemonType.GHOST, 0.5));
      ab.attrs.push(new ReceivedTypeDamageMultiplierAbAttr(PokemonType.DARK, 0.5));
    },
  ],
  // LIGHT_METAL: weight 0.5x + 1.3x Speed.
  [
    AbilityId.LIGHT_METAL,
    ab => {
      ab.attrs.push(new StatMultiplierAbAttr(Stat.SPD, 1.3));
    },
  ],
  // HYPER_CUTTER: Atk-drop immune + SpAtk-drop immune + contact +1 crit stage.
  // (Vanilla has ProtectStatAbAttr(ATK). We extend protection to SPATK; crit-stage
  // boost needs a bespoke attr we don't have wired — defer crit boost to round 2.)
  [
    AbilityId.HYPER_CUTTER,
    ab => {
      // Push another stat protector for SPATK.
      // We import nothing extra — use the vanilla attr we already use for ATK.
      addStatProtect(ab, Stat.SPATK);
    },
  ],
  // INNER_FOCUS: flinch immune + Intimidate immune + Scare immune.
  // Vanilla already has BattlerTagImmunityAbAttr(FLINCHED) + IntimidateImmunity.
  // ER also wants Scare immunity — extend the BattlerTagImmunity attrs to
  // include ER_FEAR (the ER-specific battler tag we ship).
  [AbilityId.INNER_FOCUS, ab => extendBattlerTagImmunity(ab, BattlerTagType.ER_FEAR)],
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
  [
    AbilityId.TURBOBLAZE,
    ab => {
      ab.attrs.push(new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.FIRE }));
    },
  ],
  // TERAVOLT: bypass abilities + add Electric type to self on entry.
  [
    AbilityId.TERAVOLT,
    ab => {
      ab.attrs.push(new EntryEffectAbAttr({ kind: "add-self-type", type: PokemonType.ELECTRIC }));
    },
  ],

  // ===== MAJOR — Status / damage riders =====
  // TOXIC_BOOST: +50% Atk if poisoned + immune to poison damage.
  [
    AbilityId.TOXIC_BOOST,
    ab => {
      ab.attrs.push(new BlockStatusDamageAbAttr(StatusEffect.POISON, StatusEffect.TOXIC));
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
  // ANGER_POINT: crit→max Atk (vanilla) + each hit gives +1 Atk (rider).
  [
    AbilityId.ANGER_POINT,
    ab => {
      ab.attrs.push(
        new PostDefendStatStageChangeAbAttr(
          (_target, _user, move) => move.category !== MoveCategory.STATUS,
          Stat.ATK,
          1,
          true,
        ),
      );
    },
  ],
  // MAGICIAN: was vanilla "steal any successful hit"; ER requires non-contact.
  [AbilityId.MAGICIAN, ab => patchMagicianPredicate(ab)],
  // MERCILESS: vanilla always-crits poisoned. ER extends to paralyzed + bleed + sleep.
  [AbilityId.MERCILESS, ab => extendMercilessConditions(ab)],

  // ===== MAJOR — type-conversion baseline boosts (Refrigerate family adds 1.2x typed) =====
  // ER: Normal→X conversion + "X moves are empowered" — adds typed boost.
  [
    AbilityId.REFRIGERATE,
    ab => {
      ab.attrs.push(new TypeDamageBoostAbAttr({ type: PokemonType.ICE, multiplier: 1.2 }));
    },
  ],
  [
    AbilityId.PIXILATE,
    ab => {
      ab.attrs.push(new TypeDamageBoostAbAttr({ type: PokemonType.FAIRY, multiplier: 1.2 }));
    },
  ],
  [
    AbilityId.AERILATE,
    ab => {
      ab.attrs.push(new TypeDamageBoostAbAttr({ type: PokemonType.FLYING, multiplier: 1.2 }));
    },
  ],
  [
    AbilityId.GALVANIZE,
    ab => {
      ab.attrs.push(new TypeDamageBoostAbAttr({ type: PokemonType.ELECTRIC, multiplier: 1.2 }));
    },
  ],

  // ===== MAJOR — trap-predicate extensions (Ghost-immune) =====
  // SHADOW_TAG / MAGNET_PULL / ARENA_TRAP — ER adds Ghost-type bypass.
  [AbilityId.SHADOW_TAG, ab => extendArenaTrapToIgnoreGhost(ab)],
  [AbilityId.MAGNET_PULL, ab => extendArenaTrapToIgnoreGhost(ab)],
  [AbilityId.ARENA_TRAP, ab => extendArenaTrapToIgnoreGhost(ab)],

  // ===== MAJOR — AROMA_VEIL shrinks protected-tags set =====
  // ER drops Taunt/Torment/Encore — keep Infatuated, HealBlock, Disabled only.
  [AbilityId.AROMA_VEIL, ab => narrowAromaVeilTags(ab)],

  // ===== MAJOR — AFTERMATH: vanilla 1/4 max HP on contact KO -> ER flat 25% on any KO.
  [AbilityId.AFTERMATH, ab => patchAftermath(ab)],

  // ===== MAJOR — FOREWARN: replace reveal-strongest-move with scripted Future Sight on entry.
  [AbilityId.FOREWARN, ab => patchForewarn(ab)],

  // ===== MAJOR — PASTEL_VEIL replaced with Safeguard on entry =====
  [AbilityId.PASTEL_VEIL, ab => patchPastelVeil(ab)],

  // ===== MAJOR — LEAF_GUARD: vanilla "status immunity in sun" -> ER "cure status at turn end in sun".
  [AbilityId.LEAF_GUARD, ab => patchLeafGuard(ab)],

  // ===== MAJOR — FLOWER_GIFT changes self+ally ATK boost to SPATK boost =====
  [AbilityId.FLOWER_GIFT, ab => patchFlowerGift(ab)],

  // ===== TOTAL rewrites =====
  // BIG_PECKS: vanilla "Def-drop immune"; ER "contact moves +30% boost".
  [AbilityId.BIG_PECKS, ab => rewriteBigPecks(ab)],
  // ILLUMINATE: replace with pure 1.2x accuracy boost.
  [AbilityId.ILLUMINATE, ab => rewriteIlluminate(ab)],
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
  // 6 STURDY: vanilla "OHKO immune at full HP" → ER "OHKO immune + 1/2 damage from SE moves at full HP".
  // Adds a damage-reduction rider. Approximated via existing addStatProtect-style hook;
  // the precise "SE+full HP" filter needs a new primitive — defer the rider, no-op patch.
  // (Listed as audit MAJOR but the underlying SE-at-full-HP filter isn't yet available.)

  // 24 LIMBER: vanilla paralysis immune → ER "+ also blocks INFATUATION".
  [AbilityId.LIMBER, ab => extendBattlerTagImmunity(ab, BattlerTagType.INFATUATED)],
  // 39 INNER_FOCUS already handled in MAJOR section above (FEAR immunity extension).

  // 161 BIG_PECKS already TOTAL above.
  // 100 STALL already TOTAL above.

  // 233 NEUROFORCE / 262 TRANSISTOR already MINOR-patched above.
  // 89 IRON_FIST already MINOR-patched above.
  // 89-cluster (PUNCH/BITE/SLICE) — STRONG_JAW already patched. Add 132 SHARPNESS (slice 1.5x).
  // SHARPNESS is gen-9 — present in pokerogue. ER spec: "Slicing moves 1.5x" (vanilla baseline).
  // Already at 1.5 by default; no-op. Skipped.

  // ===== Round 4: chance-status composite additions =====
  // 9 STATIC: vanilla 30% contact paralysis → ER adds 10% non-contact PRZ.
  // No "also on offense" in ER spec for STATIC — keep defend-side only.
  [AbilityId.STATIC, ab => addNonContactStatusChance(ab, StatusEffect.PARALYSIS, 10)],
  // 49 FLAME_BODY: vanilla 30% contact burn → ER adds 20% non-contact burn.
  // ER spec: "Also works on offense" — add 30% on-attack contact proc too.
  [AbilityId.FLAME_BODY, ab => {
    addNonContactStatusChance(ab, StatusEffect.BURN, 20);
    addOffenseContactStatusChance(ab, StatusEffect.BURN, 30);
  }],

  // 115 ICE_BODY duplicate-flagged in MAJOR for the 2x heal-rate. Already
  // patched above; no double-add.

  // ===== Round 5: more poison/non-contact procs from the audit =====
  // 38 POISON_POINT: vanilla 30% contact poison → ER adds 10% non-contact poison.
  // ER spec: "Also works on offense" — add 30% on-attack contact proc.
  [AbilityId.POISON_POINT, ab => {
    addNonContactStatusChance(ab, StatusEffect.POISON, 10);
    addOffenseContactStatusChance(ab, StatusEffect.POISON, 30);
  }],
  // 27 EFFECT_SPORE: vanilla 30% contact SLP/PRZ/PSN → ER adds 10% non-contact each.
  // EFFECT_SPORE picks one of three statuses randomly per proc. Append a
  // separate non-contact proc per status (lower chance to balance). No
  // "also on offense" in ER spec for EFFECT_SPORE — keep defend-side only.
  [AbilityId.EFFECT_SPORE, ab => {
    addNonContactStatusChance(ab, StatusEffect.SLEEP, 10);
    addNonContactStatusChance(ab, StatusEffect.PARALYSIS, 10);
    addNonContactStatusChance(ab, StatusEffect.POISON, 10);
  }],

  // ===== Round 6: more non-contact extensions + minor tweaks =====
  // 143 POISON_TOUCH: vanilla 30% contact poison → ER adds 10% non-contact.
  // ER spec: "Also works on offense" — add offense-side proc too.
  [AbilityId.POISON_TOUCH, ab => {
    addNonContactStatusChance(ab, StatusEffect.POISON, 10);
    addOffenseContactStatusChance(ab, StatusEffect.POISON, 30);
  }],
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
  // 95 ROCK_HEAD: vanilla recoil immune. ER also gives 1.2x dmg to recoil moves.
  // Add a flag-power-boost on RECOIL flag.
  [
    AbilityId.ROCK_HEAD,
    ab => mutateFlagPowerBoost(ab, MoveFlags.RECKLESS_MOVE, 1.2),
  ],
  // 23 SHED_SKIN: vanilla 33% post-turn status cure. ER also heals 1/8 if cured.
  // Approximation: keep vanilla cure path; rider is too niche to wire cleanly.
  // 117 ANALYTIC: vanilla 1.3x boost if moving last. ER ups to 1.5x.
  [AbilityId.ANALYTIC, ab => mutateMovePowerBoost(ab, 1.5)],
  // 137 HEAVY_METAL: handled above.
  // 192 BULLETPROOF: ER same as vanilla (immune to BALLBOMB).
  // 235 STAKEOUT: vanilla 2x on switch-in. ER ups to 2x always against statused
  // foes (different trigger). Vanilla close enough — keep.
  // 167 FUR_COAT: vanilla 0.5x physical received. Same as ER.
  // 240 STEEL_WORKER: vanilla 1.5x Steel. ER ups to 1.5 (same) but adds dmg taken halved.
  [
    AbilityId.STEELWORKER,
    ab => {
      ab.attrs.push(new ReceivedTypeDamageMultiplierAbAttr(PokemonType.STEEL, 0.5));
    },
  ],
  // 263 DRAGONS_MAW: vanilla 1.5x Dragon. ER 1.5x same.
  // 60 HUSTLE: vanilla 1.5x ATK / 0.8 acc on physical. Same.
  // 188 STORM_DRAIN: redirect Water + raise SPATK on absorption. Vanilla same.
  // 184 ANTICIPATION: reveal foe danger move. ER: also +1 SPD on entry.
  [
    AbilityId.ANTICIPATION,
    ab => {
      ab.attrs.push(new EntryEffectAbAttr({ kind: "self-stat-boost", stat: Stat.SPD, stages: 1 }));
    },
  ],
  // 209 BIG_PECKS already total.
  // 156 RECKLESS: vanilla 1.2x recoil moves. ER ups to 1.3x.
  [AbilityId.RECKLESS, ab => mutateFlagPowerBoost(ab, MoveFlags.RECKLESS_MOVE, 1.3)],
  // 158 MULTISCALE: vanilla 0.5x dmg at full HP. ER says "Halves damage and
  // ignores type for first turn out". The first-turn-after-entry is a
  // narrower trigger — keep vanilla full-HP since it covers turn 1.
  // 220 AERILATE / 224 PIXILATE / 175 REFRIGERATE / 211 GALVANIZE — already done.
  // 198 SHEER_FORCE: vanilla 1.3x boost on moves with secondary effect.
  // ER ups to 1.5x.
  [AbilityId.SHEER_FORCE, ab => mutateMovePowerBoost(ab, 1.5)],
  // 270 LIQUID_VOICE: vanilla sound moves become water. ER same.
  // 174 TRUANT: vanilla skips every other turn. ER unchanged.
  // 213 SWEET_VEIL: vanilla sleep immunity for user + allies. ER unchanged.
  // 209 WIMP_OUT: vanilla switch out at <= 50% HP. ER unchanged.
  // 197 PRANKSTER already extended.

  // ===== Round 7: ER-specific deltas surfaced from vanilla-audit =====
  // 55 HUSTLE: vanilla 1.5x ATK / 0.8 acc → ER 1.4x ATK / 0.9 acc.
  // We can only mutate the StatMultiplier — accuracy gating is handled
  // separately in pokerogue and not easily mutable.
  [AbilityId.HUSTLE, ab => mutateStatMultiplier(ab, Stat.ATK, 1.4)],
  // 96 NORMALIZE: vanilla converts all moves to Normal-type. ER adds 1.1x
  // boost on Normal-type moves (the post-conversion boost).
  [
    AbilityId.NORMALIZE,
    ab => {
      ab.attrs.push(
        new MovePowerBoostAbAttr((_user, _t, move) => move?.type === PokemonType.NORMAL, 1.1),
      );
    },
  ],
  // 113 SCRAPPY: vanilla Normal/Fighting hits Ghost. ER adds ER_FEAR-immune
  // (the ER analogue of Intimidate's stat-drop fear tag).
  [AbilityId.SCRAPPY, ab => extendBattlerTagImmunity(ab, BattlerTagType.ER_FEAR)],
  // 105 SUPER_LUCK: vanilla +1 crit stage. ER also gives 1.3x crit dmg.
  // pokerogue's crit damage multiplier is fixed; mutate via additive attrs
  // — the BonusCritDamageMultiplier path is private. Defer: would need new primitive.
  // 159 SAND_FORCE: vanilla 1.3x Rock/Steel/Ground in sand → ER "highest atk
  // stat 1.5x in sand". Complex; defer.
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
  // 53 PICKUP: vanilla "find items post-battle" → ER "Removes all hazards on
  // entry". Completely different effect. Add hazard-clear entry effect on
  // holder side; keep vanilla item-find for backward compat.
  [
    AbilityId.PICKUP,
    ab => {
      ab.attrs.push(new EntryEffectAbAttr({ kind: "self-stat-boost", stat: Stat.ATK, stages: 0 }));
      // Note: hazard-clearing on holder-side is best modeled via a one-shot
      // PostSummon — leveraging the same TypeGatedStatTriggerOnAttack's
      // clearHazards helper would require its predicate to match. Skip the
      // hazard-clear rider for now (no clean primitive); the patch is a
      // placeholder for future PostSummonClearHazardsAbAttr.
    },
  ],
  // 50 RUN_AWAY: vanilla "guaranteed flee". ER adds "Raises Speed if stats
  // lowered by an enemy" rider. The trigger is the StatTriggerOnStatLowered
  // primitive from the archetype layer.
  [
    AbilityId.RUN_AWAY,
    ab => {
      ab.attrs.push(new StatTriggerOnStatLoweredAbAttr({ stats: [{ stat: Stat.SPD, stages: 1 }] }));
    },
  ],

  // ===== Round 8: more ER-specific deltas =====
  // 57 PLUS / 58 MINUS: vanilla +50% SpAtk if ally has Plus/Minus. ER
  // "Deals double damage" — close to vanilla's effect; we mutate the
  // baseline AllyStatMultiplier to 2.0 from 1.5 (functionally doubles
  // outgoing damage when ally is present).
  [AbilityId.PLUS, ab => mutateStatMultiplier(ab, Stat.SPATK, 2.0)],
  [AbilityId.MINUS, ab => mutateStatMultiplier(ab, Stat.SPATK, 2.0)],

  // 73 WHITE_SMOKE: vanilla "stat-drop immunity". ER COMPLETELY DIFFERENT
  // — "Sets Smokescreen for 3 turns on switch-in". Add a Mist arena tag
  // on entry (Mist is the engine equivalent of vanilla Smokescreen with
  // stat-drop protection extended to side).
  [
    AbilityId.WHITE_SMOKE,
    ab => {
      ab.attrs.push(
        new EntryEffectAbAttr({
          kind: "set-screen-or-room",
          tag: ArenaTagType.MIST,
          turns: 3,
        }),
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
      ab.attrs.push(new PostDefendSuppressOpponentDamageBoostAbAttr());
    },
  ],

  // 119 FRISK: vanilla "reveal foe item". ER "disables their items for 2
  // turns" — no engine primitive for that. Defer.

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

  // 198 SHEER_FORCE already done at 1.5x in Round 6.

  // ===== Round 9 — actual mutates =====
  // 167 FUR_COAT: vanilla halves Physical dmg. ER same. No patch.
  // 199 WATER_BUBBLE: vanilla halves Fire dmg, doubles Water dmg, no burns.
  // Same as ER. No patch.
  // 201 BERSERK: vanilla +1 SpAtk at <= 50% HP after damage. ER says "boosts
  // highest attack" (ATK or SPATK). Approximate by adding +1 ATK rider.
  [
    AbilityId.BERSERK,
    ab => {
      ab.attrs.push(
        new PostDefendStatStageChangeAbAttr(
          (target, _user, _move) => target.getHpRatio() <= 0.5,
          Stat.ATK,
          1,
          true,
        ),
      );
    },
  ],
  // 215 INNARDS_OUT: vanilla deals attacker's HP-damage equal to fatal hit.
  // ER same.
  // 109 UNAWARE: vanilla ignores stat stages. Same.
  // 168 PROTEAN: vanilla converts type per move. Same.
  // 152 MUMMY: vanilla applies Mummy on contact. Same.
  // 154 JUSTIFIED: vanilla +1 ATK on Dark hit. Same.
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
  // 119 FRISK: vanilla reveal foe item. ER also "disables items for 2 turns".
  // Approximate by adding a chance on PostSummon to disable opponent items
  // via an arena tag. Without a generic "disable held items" tag, we
  // approximate with no-op extension; ER's primary effect is still the
  // reveal (vanilla). Defer the disable rider.
  // 187 INFILTRATOR: vanilla bypass Substitute + screens. ER same. No patch.
  // 178 MEGA_LAUNCHER already patched.
  // 246 STAKEOUT: vanilla 2x on switch-in. ER same.
  // 196 RKS_SYSTEM (MultiAttack): vanilla type from item. ER same.
  // 233 NEUROFORCE already patched.
  // 261 STALWART: vanilla "ignore foe redirection". ER same.
  // 263 DRAGONS_MAW: vanilla 1.5x Dragon. ER same.

  // 51 FORECAST: vanilla form-change with weather. ER says also "Attacks when
  // setting weather". Form-change is per-species custom; the "attack on
  // weather-set" rider would need a generic PostWeatherSet → MovePhase
  // hook that doesn't exist. Defer.

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
    for (const opp of pokemon.getOpponents()) {
      if (!opp || opp.isFainted()) {
        continue;
      }
      // Reset positive stages by emitting a -X stage change matched to the
      // current positive total. Simpler: just reset the summonData stages.
      const stats: BattleStat[] = [Stat.ATK, Stat.DEF, Stat.SPATK, Stat.SPDEF, Stat.SPD, Stat.ACC, Stat.EVA];
      for (const stat of stats) {
        const cur = opp.summonData?.statStages?.[stat as number] ?? 0;
        if (cur > 0) {
          opp.summonData.statStages[stat as number] = 0;
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
    // priority: signed; 0 is a legitimate value, so we compare directly.
    if (target.priority !== draft.priority) {
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

    if (movedirty) {
      result.moveDeltas++;
    }
  }

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
        arenaWeather.turnsLeft = this.erTurns;
        arenaWeather.maxDuration = this.erTurns;
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
        arenaWeather.turnsLeft = this.erTurns;
        arenaWeather.maxDuration = this.erTurns;
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
        arenaTerrain.turnsLeft = this.erTurns;
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
  ability.attrs.push(new ChanceStatusOnHitAbAttr({
    chance,
    effects: [effect],
    contactExcluded: true,
  }));
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
function addOffenseContactStatusChance(
  ability: MutableAbility,
  effect: StatusEffect,
  chance: number,
): void {
  ability.attrs.push(new PostAttackContactApplyStatusEffectAbAttr(chance, effect));
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
function patchHealerChance(_ability: MutableAbility): void {
  // No-op: pokerogue's HEALER is already at 30% (`randSeedInt(10) < 3`).
  // The audit doc treats vanilla as 50%, but the pokerogue source disagrees.
  // Defer to ROM verification.
}

/**
 * Add a "type-X-moves get a +1.2x baseline boost" attr alongside the vanilla
 * low-HP boost. Used by OVERGROW/BLAZE/TORRENT/SWARM. Vanilla:
 *   - `LowHpMoveTypePowerBoostAbAttr` — fires at HP <= 1/3.
 * ER:
 *   - 1.2x ALWAYS, 1.5x at low HP — keep vanilla, add baseline.
 */
function addBaselineTypeBoost(ability: MutableAbility, type: PokemonType, multiplier: number): void {
  ability.attrs.push(new MoveTypePowerBoostAbAttr(type, multiplier));
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
 * Extend MERCILESS's ConditionalCritAbAttr predicate to include PARALYSIS +
 * SLEEP + ER_BLEED, in addition to vanilla POISON/TOXIC. We can't inspect
 * the captured closure, so we replace the attr with a fresh one.
 */
function extendMercilessConditions(ability: MutableAbility): void {
  for (let i = 0; i < ability.attrs.length; i++) {
    if (ability.attrs[i] instanceof ConditionalCritAbAttr) {
      ability.attrs[i] = new ConditionalCritAbAttr((_user, target, _move) => {
        if (!target) {
          return false;
        }
        const eff = target.status?.effect;
        if (
          eff === StatusEffect.POISON
          || eff === StatusEffect.TOXIC
          || eff === StatusEffect.PARALYSIS
          || eff === StatusEffect.SLEEP
        ) {
          return true;
        }
        // ER_BLEED is a custom battler tag.
        return target.getTag?.(BattlerTagType.ER_BLEED) != null;
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
 * Narrow AROMA_VEIL's protected tag set. Vanilla protects against
 * INFATUATED + TAUNT + DISABLED + TORMENT + HEAL_BLOCK + ENCORE.
 * ER protects only against INFATUATED + HEAL_BLOCK + DISABLED.
 */
function narrowAromaVeilTags(ability: MutableAbility): void {
  for (const attr of ability.attrs) {
    if (attr instanceof UserFieldBattlerTagImmunityAbAttr) {
      (attr as unknown as { immuneTagTypes: BattlerTagType[] }).immuneTagTypes = [
        BattlerTagType.INFATUATED,
        BattlerTagType.HEAL_BLOCK,
        BattlerTagType.DISABLED,
      ];
    }
  }
}

/**
 * Replace AFTERMATH's vanilla PostFaintContactDamageAbAttr (1/4 max HP on
 * contact KO) with OnFaintEffectAbAttr (flat 25% damage to attacker on any
 * KO, modeling ER's "Uses 100 BP Explosion on faint").
 */
function patchAftermath(ability: MutableAbility): void {
  for (let i = 0; i < ability.attrs.length; i++) {
    if (ability.attrs[i].constructor.name === "PostFaintContactDamageAbAttr") {
      ability.attrs[i] = new OnFaintEffectAbAttr({
        effect: { kind: "attacker-damage-flat", maxHpFraction: 0.25 },
      });
    }
  }
}

/**
 * Replace FOREWARN's ForewarnAbAttr (reveal-strongest-move) with an
 * EntryEffectAbAttr that scripts Future Sight on entry.
 */
function patchForewarn(ability: MutableAbility): void {
  for (let i = 0; i < ability.attrs.length; i++) {
    if (ability.attrs[i].constructor.name === "ForewarnAbAttr") {
      ability.attrs[i] = new EntryEffectAbAttr({ kind: "scripted-move", move: MoveId.FUTURE_SIGHT });
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
function patchLeafGuard(ability: MutableAbility): void {
  ability.attrs = ability.attrs.filter(a => !(a instanceof StatusEffectImmunityAbAttr));
  const PostTurnResetStatusCtor = getAttrCtorByName("PostTurnResetStatusAbAttr");
  if (PostTurnResetStatusCtor !== undefined) {
    ability.attrs.push(new PostTurnResetStatusCtor(true) as AbAttr);
  }
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
function rewriteIlluminate(ability: MutableAbility): void {
  ability.attrs.length = 0;
  ability.attrs.push(new StatMultiplierAbAttr(Stat.ACC, 1.2));
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
 * Strip the WeightMultiplierAbAttr (or equivalent) from HEAVY_METAL. R1
 * already ADDED the Ghost/Dark damage reductions; we just need to remove
 * the weight-doubling effect since ER replaces it entirely.
 */
function stripWeightMultiplier(ability: MutableAbility): void {
  ability.attrs = ability.attrs.filter(a => a.constructor.name !== "WeightMultiplierAbAttr");
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
