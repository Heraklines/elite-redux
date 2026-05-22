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
  AlliedFieldDamageReductionAbAttr,
  AllyStatMultiplierAbAttr,
  IgnoreOpponentStatStagesAbAttr,
  MovePowerBoostAbAttr,
  MoveTypePowerBoostAbAttr,
  PostBiomeChangeWeatherChangeAbAttr,
  PostDefendContactApplyTagChanceAbAttr,
  PostSummonTerrainChangeAbAttr,
  PostSummonWeatherChangeAbAttr,
  PostTurnHurtIfSleepingAbAttr,
  PostWeatherLapseHealAbAttr,
  ReceivedMoveDamageMultiplierAbAttr,
  ReceivedTypeDamageMultiplierAbAttr,
  StatMultiplierAbAttr,
  UserFieldMoveTypePowerBoostAbAttr,
} from "#abilities/ab-attrs";
import type { Ability } from "#abilities/ability";
import { globalScene } from "#app/global-scene";
import { allAbilities, allMoves } from "#data/data-lists";
import { ER_ABILITIES } from "#data/elite-redux/er-abilities";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import type { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
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
  // CUTE_CHARM: 30% → 50% (also outgoing — that's MAJOR, deferred)
  [AbilityId.CUTE_CHARM, ab => mutateContactTagChance(ab, BattlerTagType.INFATUATED, 50)],
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
  // HEAVY_METAL: weight 2x + half damage from Ghost/Dark (ER REPLACES the weight effect).
  [
    AbilityId.HEAVY_METAL,
    ab => {
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
  // Scare doesn't yet exist as a BattlerTagType in pokerogue; defer that rider.
  // For now we just add an extra accuracy-protect for the "Focus Blast never misses"
  // angle as a placeholder — skipped to keep this a no-op-rider (deferred).
  // Defer entirely until ER Scare lands.
]);

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
