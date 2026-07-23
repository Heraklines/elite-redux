/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C1e: `lifesteal` archetype primitive.
//
// Implements taxonomy entry #15 (~10 abilities). Parameterized AbAttr family
// covering "heal off damage you deal" (Energy-Siphon-style per-hit lifesteal)
// AND "heal off KOs" (Soul-Eater-style on-knock-out heal). Two trigger surfaces,
// two sibling subclasses, one archetype.
//
// Base classes:
//   - `LifestealOnHitAbAttr`  extends pokerogue's {@linkcode PostAttackAbAttr}
//     (fires post-damage on every successful hit). Heals `damage * healFraction`,
//     optionally gated by a move filter (type / flag).
//   - `LifestealOnKoAbAttr`   extends pokerogue's {@linkcode PostKnockOutAbAttr}
//     (fires after a KO). Heals `maxHp * healFraction` (a *fraction of max HP*,
//     not damage). The taxonomy cluster lists this as the
//     `Soul Eater`/`Scavenger`/`Predator`/`Looter` shape.
//
// Why two classes? They live on different trigger surfaces — pokerogue routes
// PostAttack (per-hit damage hook) and PostKnockOut (after a faint resolves)
// through separate dispatcher keys. A single mega-class would have to extend
// both at once, which TypeScript doesn't allow. The split matches what
// pokerogue does upstream (`ReverseDrainAbAttr` for the on-hit side,
// `PostKnockOutStatStageChangeAbAttr` for the on-KO side).
//
// Sub-shapes covered:
//   - **Per-hit damage-fraction heal** (Energy Siphon / Energy Tap):
//     `LifestealOnHitAbAttr { healFraction: 1/4 | 1/8 }`
//   - **Per-hit damage-fraction heal, type-filtered** (Hydro Circuit Water
//     piece): `LifestealOnHitAbAttr { healFraction: 0.25, filter: { type: WATER } }`
//   - **Per-hit damage-fraction heal, flag-filtered** (rare ER customs):
//     `LifestealOnHitAbAttr { healFraction: 0.25, filter: { flag: ... } }`
//   - **On-KO max-HP-fraction heal** (Soul Eater / Scavenger / Predator /
//     Looter): `LifestealOnKoAbAttr { healFraction: 1/4 }`
//
// Sub-shapes intentionally NOT in this primitive (deferred):
//   - **Passive-drain over time** (Life Steal "Steals 1/10 HP from foes each
//     turn"): different trigger surface (PostTurn, with per-foe enumeration).
//     Belongs in a `passive-drain` follow-up primitive — folding it here would
//     require a third class and the taxonomy lists only one user. Tracked
//     as C1f / long-tail candidate.
//   - **Stat-conditional heal** (e.g. heal only at low HP, heal proportional
//     to missing HP): not in the canonical taxonomy cluster — bespoke wiring
//     for the abilities that need it.
//
// Examples (per taxonomy):
//   - `Energy Siphon` — `new LifestealOnHitAbAttr({ healFraction: 0.25 })`
//   - `Energy Tap`    — `new LifestealOnHitAbAttr({ healFraction: 0.125 })`
//   - `Soul Eater`    — `new LifestealOnKoAbAttr({ healFraction: 0.25 })`
// =============================================================================

import type { PostKnockOutAbAttrParams } from "#abilities/ab-attrs";
import { PostAttackAbAttr, PostKnockOutAbAttr } from "#abilities/ab-attrs";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { allMoves } from "#data/data-lists";
import type { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import type { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import { PokemonHeldItemModifier } from "#modifiers/modifier";
import type { Move } from "#moves/move";
import { BooleanHolder, toDmgValue } from "#utils/common";
import i18next from "i18next";

/**
 * True when `params.pokemon` is the Pokémon that landed the knockout on
 * `params.victim` with a DIRECT hit this turn. The faint phase fans
 * `PostKnockOutAbAttr` out to BOTH sides of the field, so on-KO rewards
 * (heal / loot) must gate on this — otherwise they fire for bystanders and on
 * indirect KOs (weather / status / hazards, which leave no `attacksReceived`).
 */
function koLandedByDirectHit(params: PostKnockOutAbAttrParams): boolean {
  const lastAttack = params.victim.turnData.attacksReceived?.[0];
  return !!lastAttack && lastAttack.sourceId === params.pokemon.id;
}

/**
 * Applies an ability-driven drain payout, reversing it into indirect damage
 * when the drained Pokemon has Liquid Ooze. Held-item healing such as Shell
 * Bell never calls this helper and is therefore deliberately unaffected.
 */
export function applyAbilityDrainRecovery(
  drainer: Pokemon,
  drainedPokemon: Pokemon,
  amount: number,
  message: string,
  simulated = false,
): void {
  if (simulated || amount <= 0) {
    return;
  }

  const reversesDrain = drainedPokemon
    .getPostBattleAbilitySources()
    .some(source => source.ability.hasAttr("ReverseDrainAbAttr"));
  if (reversesDrain) {
    const cancelled = new BooleanHolder(false);
    applyAbAttrs("BlockNonDirectDamageAbAttr", { pokemon: drainer, cancelled });
    if (!cancelled.value) {
      drainer.damageAndUpdate(amount, { result: HitResult.INDIRECT });
      drainer.turnData.damageTaken += amount;
    }
    return;
  }

  globalScene.phaseManager.unshiftNew("PokemonHealPhase", drainer.getBattlerIndex(), amount, message, true);
}

/**
 * Filter narrowing which outgoing moves trigger the per-hit lifesteal heal.
 * Exactly one of {@linkcode type} or {@linkcode flag} should be provided in
 * practice; if both are present, BOTH must match. An empty filter (`{}`)
 * matches every damaging move — used for unfiltered Energy-Siphon-style
 * abilities.
 */
export interface LifestealFilter {
  /** Move type that triggers the lifesteal heal. Omit to accept any type. */
  readonly type?: PokemonType;
  /** Move flag(s) that triggers the lifesteal heal. Omit to accept any flags. */
  readonly flag?: MoveFlags;
  /**
   * Optional gate on the TARGET carrying a battler tag (e.g.
   * {@linkcode BattlerTagType.INFATUATED} for `Pure Love` — "heal vs
   * infatuated"). Omit to ignore the target's tags. Checked in the attack
   * condition closure (which has the target), not in {@linkcode matchesFilter}.
   */
  readonly targetTag?: BattlerTagType;
}

// -----------------------------------------------------------------------------
// LifestealOnHitAbAttr — Energy-Siphon parity (per-hit damage fraction heal).
// -----------------------------------------------------------------------------

/** Construction options for {@linkcode LifestealOnHitAbAttr}. */
export interface LifestealOnHitOptions {
  /**
   * Fraction of damage dealt to heal the user. Typical values:
   *   - `0.25` → 1/4 of damage dealt (Energy Siphon)
   *   - `0.125` → 1/8 of damage dealt (Energy Tap)
   * Must be in `(0, 1]`.
   */
  readonly healFraction: number;
  /**
   * Optional move filter. Omit to heal off every damaging move (Energy-Siphon-
   * style). When set, only moves matching the filter trigger the heal.
   */
  readonly filter?: LifestealFilter;
  /** Optional target types that replace the base fraction with a larger one. */
  readonly boostedTargetTypes?: readonly PokemonType[];
  /** Recovery fraction used when the target matches {@linkcode boostedTargetTypes}. */
  readonly boostedHealFraction?: number;
}

/**
 * Parameterized `AbAttr` implementing the per-hit lifesteal sub-shape of the
 * `lifesteal` archetype.
 *
 * Used (or will be used) by ER abilities such as `Energy Siphon`
 * (1/4 damage), `Energy Tap` (1/8 damage), `Hydro Circuit`'s Water piece
 * (1/4 damage on Water moves), and similar damage-fraction-to-heal abilities.
 *
 * @remarks
 * Extends pokerogue's {@linkcode PostAttackAbAttr}. The parent's `canApply`
 * runs the configured attackCondition (we wire ours via the filter), and the
 * parent's apply is a no-op — we override it to enqueue a heal phase.
 *
 * The parent's default attackCondition requires `move.category !==
 * MoveCategory.STATUS`, which is what we want (status moves don't deal
 * damage). We extend that with the typed filter.
 *
 * Note: the heal-phase shift is skipped under `simulated: true` (matches the
 * convention in `PostTurnHealAbAttr` and friends — tests use simulated=true
 * to verify canApply without exercising the phase manager).
 */
export class LifestealOnHitAbAttr extends PostAttackAbAttr {
  private readonly hitHealFraction: number;
  private readonly hitFilter: LifestealFilter;
  private readonly boostedTargetTypes: readonly PokemonType[];
  private readonly boostedHealFraction: number | null;

  constructor(opts: LifestealOnHitOptions) {
    if (!(opts.healFraction > 0 && opts.healFraction <= 1)) {
      throw new Error(`[LifestealOnHitAbAttr] healFraction must be in (0, 1]; got ${opts.healFraction}`);
    }
    if (opts.filter?.flag === MoveFlags.NONE) {
      throw new Error("[LifestealOnHitAbAttr] filter.flag must be a non-NONE MoveFlags bit when set");
    }
    if (
      opts.boostedHealFraction !== undefined
      && (!(opts.boostedHealFraction > 0 && opts.boostedHealFraction <= 1) || opts.boostedTargetTypes?.length === 0)
    ) {
      throw new Error("[LifestealOnHitAbAttr] boostedHealFraction requires target types and must be in (0, 1]");
    }
    const filter = opts.filter ?? {};
    super((user, target, move) => {
      if (move.category === MoveCategory.STATUS) {
        return false;
      }
      // target may be null in pokerogue's PostAttack signature — defensive.
      if (target === null) {
        return false;
      }
      // Optional target-tag gate (e.g. heal only vs an INFATUATED target).
      if (filter.targetTag !== undefined && target.getTag(filter.targetTag) === undefined) {
        return false;
      }
      return LifestealOnHitAbAttr.matchesFilter(filter, user, move);
    });
    this.hitHealFraction = opts.healFraction;
    this.hitFilter = filter;
    this.boostedTargetTypes = opts.boostedTargetTypes ?? [];
    this.boostedHealFraction = opts.boostedHealFraction ?? null;
  }

  /** Read-only accessor for the configured heal fraction. */
  public getHealFraction(): number {
    return this.hitHealFraction;
  }

  /** Read-only accessor for the configured move filter. */
  public getFilter(): LifestealFilter {
    return this.hitFilter;
  }

  /**
   * canApply: inherits the parent's attackCondition predicate (which wraps our
   * filter), then layers a "damage > 0" gate — there's no point healing from
   * a 0-damage hit (immune target, sub-blocked, etc.).
   */
  public override canApply(params: Parameters<PostAttackAbAttr["canApply"]>[0]): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    return params.damage > 0;
  }

  /**
   * Apply: heal the user by `damage * healFraction`, enqueued as a regular
   * PokemonHealPhase so it respects standard heal limits (max HP cap,
   * Magic-Guard-style blockers, etc.).
   */
  public override apply(params: Parameters<PostAttackAbAttr["apply"]>[0]): void {
    const { simulated, pokemon, damage } = params;
    if (simulated) {
      return;
    }
    const fraction =
      this.boostedHealFraction !== null
      && params.opponent.getTypes().some(type => this.boostedTargetTypes.includes(type))
        ? this.boostedHealFraction
        : this.hitHealFraction;
    const healAmount = toDmgValue(damage * fraction);
    if (healAmount <= 0) {
      return;
    }
    const abilityName = pokemon.getAbility()?.name ?? "";
    applyAbilityDrainRecovery(
      pokemon,
      params.opponent,
      healAmount,
      i18next.t("abilityTriggers:postAttackHeal", {
        pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
        abilityName,
      }),
      simulated,
    );
  }

  /**
   * Evaluate the filter against a candidate move. Both `type` and `flag`
   * (when present) must match; an empty filter matches every move.
   *
   * Exposed as a static so tests can verify the predicate in isolation and
   * composite archetypes can reuse it.
   */
  public static matchesFilter(filter: LifestealFilter, pokemon: Pokemon, move: Move): boolean {
    if (filter.type !== undefined && pokemon.getMoveType(move) !== filter.type) {
      return false;
    }
    if (filter.flag !== undefined && !move.hasFlag(filter.flag)) {
      return false;
    }
    return true;
  }
}

// -----------------------------------------------------------------------------
// LifestealOnKoAbAttr — Soul-Eater parity (KO heals fraction of max HP).
// -----------------------------------------------------------------------------

/** Construction options for {@linkcode LifestealOnKoAbAttr}. */
export interface LifestealOnKoOptions {
  /**
   * Fraction of the user's MAX HP to heal on a KO (NOT a fraction of damage —
   * the KO heal is independent of the damage dealt). Typical value: `0.25`
   * (Soul Eater / Scavenger / Predator / Looter cluster). Must be in `(0, 1]`.
   */
  readonly healFraction: number;
  /**
   * Optional move-flag-gated bonus fraction: when the KOing move carries
   * `flag`, heal `fraction` of max HP instead of {@linkcode healFraction}.
   * Models Hungry Maws 861 ("50% on biting KOs, 25% otherwise" →
   * `healFraction: 0.25, flagBonus: { flag: BITING_MOVE, fraction: 0.5 }`).
   */
  readonly flagBonus?: { readonly flag: MoveFlags; readonly fraction: number };
}

/**
 * Parameterized `AbAttr` implementing the on-KO heal sub-shape of the
 * `lifesteal` archetype.
 *
 * Used (or will be used) by ER abilities such as `Soul Eater`, `Scavenger`,
 * `Predator`, `Looter` (taxonomy 4-cluster: "Dealing a KO heals 1/4 of this
 * Pokémon's max HP"), and similar on-knockout heal abilities.
 *
 * @remarks
 * Extends pokerogue's {@linkcode PostKnockOutAbAttr}. The parent's `canApply`
 * defaults to `true`; we tighten it to "user is alive AND not at full HP"
 * since healing a fainted Pokemon or one at max HP is wasted. The apply
 * enqueues a standard PokemonHealPhase scaled to the configured fraction of
 * max HP.
 */
export class LifestealOnKoAbAttr extends PostKnockOutAbAttr {
  private readonly koHealFraction: number;
  private readonly flagBonus: { readonly flag: MoveFlags; readonly fraction: number } | undefined;

  constructor(opts: LifestealOnKoOptions) {
    if (!(opts.healFraction > 0 && opts.healFraction <= 1)) {
      throw new Error(`[LifestealOnKoAbAttr] healFraction must be in (0, 1]; got ${opts.healFraction}`);
    }
    if (opts.flagBonus && !(opts.flagBonus.fraction > 0 && opts.flagBonus.fraction <= 1)) {
      throw new Error(`[LifestealOnKoAbAttr] flagBonus.fraction must be in (0, 1]; got ${opts.flagBonus.fraction}`);
    }
    super();
    this.koHealFraction = opts.healFraction;
    this.flagBonus = opts.flagBonus;
  }

  /** Read-only accessor for the configured heal fraction. */
  public getHealFraction(): number {
    return this.koHealFraction;
  }

  /**
   * canApply: only fire if the user is still alive AND can still benefit from
   * healing (not at full HP). Avoids a no-op phase shift on KOs by the
   * Pokemon's allies / self-faint paths.
   */
  public override canApply(params: PostKnockOutAbAttrParams): boolean {
    if (!super.canApply(params)) {
      return false;
    }
    // ER: only the Pokémon that actually landed the KNOCKOUT (with a direct hit)
    // benefits — NOT every Pokémon on the field whenever any KO happens. The
    // faint phase applies PostKnockOut to BOTH sides, so we gate on "this holder
    // dealt the last (direct) attack to the victim". An indirect KO (weather,
    // status, hazards — no attacksReceived) credits nobody.
    if (!koLandedByDirectHit(params)) {
      return false;
    }
    return !params.pokemon.isFainted() && !params.pokemon.isFullHp();
  }

  /**
   * Apply: heal by `maxHp * healFraction` (NOT damage-derived — this is a
   * fixed-fraction reward for getting the KO).
   */
  public override apply(params: PostKnockOutAbAttrParams): void {
    const { simulated, pokemon } = params;
    if (simulated) {
      return;
    }
    // If a flag-bonus is configured and the KOing move carries that flag, heal
    // the larger fraction (e.g. Hungry Maws: 50% on a biting KO, 25% otherwise).
    let fraction = this.koHealFraction;
    if (this.flagBonus !== undefined) {
      const koMoveId = params.victim.turnData.attacksReceived?.[0]?.move;
      if (koMoveId !== undefined && allMoves[koMoveId]?.hasFlag(this.flagBonus.flag)) {
        fraction = this.flagBonus.fraction;
      }
    }
    const healAmount = toDmgValue(pokemon.getMaxHp() * fraction);
    if (healAmount <= 0) {
      return;
    }
    const abilityName = pokemon.getAbility()?.name ?? "";
    applyAbilityDrainRecovery(
      pokemon,
      params.victim,
      healAmount,
      i18next.t("abilityTriggers:postAttackHeal", {
        pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
        abilityName,
      }),
      simulated,
    );
  }
}

// -----------------------------------------------------------------------------
// ScavengerLootAbAttr — Scavenger's "loot a held item on KO" sub-shape.
// -----------------------------------------------------------------------------

/** Construction options for {@linkcode ScavengerLootAbAttr}. */
export interface ScavengerLootOptions {
  /** Probability in `(0, 1]` to loot a random held item on a direct-hit KO. */
  readonly chance: number;
}

/**
 * On a direct-hit knockout, has a {@linkcode chance} to steal one random
 * transferable held item from the defeated Pokémon (ER `Scavenger`). Gated to
 * the Pokémon that actually landed the KO (see {@linkcode koLandedByDirectHit})
 * so it never loots from bystander/indirect faints.
 */
export class ScavengerLootAbAttr extends PostKnockOutAbAttr {
  private readonly lootChance: number;
  private lootItem?: PokemonHeldItemModifier;

  constructor(opts: ScavengerLootOptions) {
    if (!(opts.chance > 0 && opts.chance <= 1)) {
      throw new Error(`[ScavengerLootAbAttr] chance must be in (0, 1]; got ${opts.chance}`);
    }
    super();
    this.lootChance = opts.chance;
  }

  /** Read-only accessor for the configured loot chance. */
  public getChance(): number {
    return this.lootChance;
  }

  public override canApply(params: PostKnockOutAbAttrParams): boolean {
    this.lootItem = undefined;
    if (!super.canApply(params) || params.simulated) {
      return false;
    }
    const { pokemon, victim } = params;
    if (pokemon.isFainted() || !koLandedByDirectHit(params)) {
      return false;
    }
    if (pokemon.randBattleSeedInt(100) >= Math.round(this.lootChance * 100)) {
      return false; // failed the loot roll
    }
    const transferable = (
      globalScene.findModifiers(
        m => m instanceof PokemonHeldItemModifier && m.pokemonId === victim.id,
        victim.isPlayer(),
      ) as PokemonHeldItemModifier[]
    ).filter(i => i.isTransferable);
    if (transferable.length === 0) {
      return false;
    }
    this.lootItem = transferable[pokemon.randBattleSeedInt(transferable.length)];
    return globalScene.canTransferHeldItemModifier(this.lootItem, pokemon);
  }

  public override apply(params: PostKnockOutAbAttrParams): void {
    const { simulated, pokemon, victim } = params;
    if (simulated || !this.lootItem) {
      this.lootItem = undefined;
      return;
    }
    if (globalScene.tryTransferHeldItemModifier(this.lootItem, pokemon, false)) {
      globalScene.phaseManager.queueMessage(
        i18next.t("abilityTriggers:postAttackStealHeldItem", {
          pokemonNameWithAffix: getPokemonNameWithAffix(pokemon),
          defenderName: victim.name,
          stolenItemType: this.lootItem.type.name,
        }),
      );
    }
    this.lootItem = undefined;
  }
}

/**
 * Marker type — useful for the wire-up layer to refer to either subclass
 * generically.
 */
export type Lifesteal = LifestealOnHitAbAttr | LifestealOnKoAbAttr;
