/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `counter-attack-on-hit` archetype.
//
// When the holder is hit by a damaging move, enqueue a free follow-up attack
// on the opponent using a configured pokerogue MoveId. Wires the ER cluster
// of abilities that retaliate with a scripted move:
//
//   - Chilling Pellets (879)  → Icicle Spear
//   - Acid Reflux (998)        → Acid
//   - Thunder Clouds (993)     → Thunderbolt (gated on user-was-special)
//   - Sludge Spit (876)        → Venom Bolt (post-attack rather than post-hit)
//   - Aftershock (491)         → Magnitude 4-7
//   - Retribution Blow (407)   → Hyper Beam (gated on foe stat boost)
//
// The follow-up uses `MoveUseMode.INDIRECT` so it ignores PP and isn't
// recorded in move history (matches vanilla Color Change / Magma Armor /
// other automatic ability triggers).
// =============================================================================

import { PostDefendAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { scriptedPokemonMove } from "#data/elite-redux/archetypes/scripted-move-util";
import type { MoveCategory } from "#enums/move-category";
import type { MoveFlags } from "#enums/move-flags";
import type { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import type { PostMoveInteractionAbAttrParams } from "#types/ability-types";

/** Optional gate over the incoming move that triggers the counter. */
export interface CounterAttackFilter {
  /**
   * When set, the counter only fires if the incoming move's category matches.
   * Used by Thunder Clouds (special-attack-only trigger).
   */
  readonly category?: "physical" | "special";
  /**
   * When set, the counter only fires when the holder makes contact (default).
   * Used by Chilling Pellets (contact-only).
   * @defaultValue `false` — counters fire on any damaging hit.
   */
  readonly contactRequired?: boolean;
  /** When set, only moves with this flag trigger the counter. */
  readonly flag?: MoveFlags;
}

/** Construction options for {@linkcode CounterAttackOnHitAbAttr}. */
export interface CounterAttackOnHitOptions {
  /** The pokerogue MoveId of the counter-attack move. */
  readonly moveId: MoveId;
  /**
   * Optional ER-specified base-power override (e.g. Clap Trap's "50 BP Snap
   * Trap"). Omit to use the move's registered full power.
   */
  readonly power?: number;
  /** Optional roll chance `[0..100]`. Defaults to 100 (always fires). */
  readonly chance?: number;
  /** Optional filter restricting which incoming moves trigger the counter. */
  readonly filter?: CounterAttackFilter;
  /** Optional battle-only category override for the scripted counter. */
  readonly category?: MoveCategory;
  /** Optional healing multiplier for scripted healing/status counters. */
  readonly healMultiplier?: number;
}

/**
 * Parameterized AbAttr implementing the `counter-attack-on-hit` archetype.
 *
 * Extends pokerogue's PostDefendAbAttr (fires after the holder is hit by a
 * damaging move). On apply, enqueues a MovePhase for the holder targeting
 * the opponent with the configured moveId in INDIRECT mode (ignores PP,
 * not in move history).
 */
export class CounterAttackOnHitAbAttr extends PostDefendAbAttr {
  private readonly moveId: MoveId;
  private readonly power: number | undefined;
  private readonly chance: number;
  private readonly filter: CounterAttackFilter;
  private readonly category: MoveCategory | undefined;
  private readonly healMultiplier: number | undefined;

  constructor(options: CounterAttackOnHitOptions) {
    // showAbility = true (default): the counter is a discrete, player-visible
    // triggered action, so its ability banner must flash when it fires — matching
    // vanilla convention (stat-change / status / retaliation abilities announce
    // themselves). A prior `super(false)` suppressed the popup for Ultra Instinct
    // (er-660) and Deflect (er-1022, Mega Lucario Z's innate), so the Vacuum Wave
    // counter fired silently with no on-screen ability flash (maintainer report).
    super();
    this.moveId = options.moveId;
    this.power = options.power;
    this.chance = options.chance ?? 100;
    this.filter = options.filter ?? {};
    this.category = options.category;
    this.healMultiplier = options.healMultiplier;
    if (!(this.chance >= 0 && this.chance <= 100)) {
      throw new Error(`[CounterAttackOnHitAbAttr] chance must be in [0..100]; got ${this.chance}`);
    }
  }

  /** Read-only accessor: the counter move id. */
  public getMoveId(): MoveId {
    return this.moveId;
  }

  /** Read-only accessor: the configured power override, or `undefined` for natural power. */
  public getPower(): number | undefined {
    return this.power;
  }

  override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { pokemon, opponent, move } = params;
    if (!opponent || opponent.isFainted() || pokemon.isFainted()) {
      return false;
    }
    // Only retaliate against a damaging move from an ACTUAL opponent. Without
    // these guards a self-targeted status move (e.g. Cosmic Power) registered
    // the holder as its own "attacker", so the counter fired at itself, whose
    // hit re-triggered the counter → an infinite self-Hyper-Voice loop
    // (user-reported: "Cosmic Power made Mega Chimecho hit itself repeatedly").
    if (opponent === pokemon || !move.is("AttackMove")) {
      return false;
    }
    if (this.filter.contactRequired && !move.hasFlag(1 /* MoveFlags.MAKES_CONTACT */)) {
      return false;
    }
    if (this.filter.flag !== undefined && !move.hasFlag(this.filter.flag)) {
      return false;
    }
    if (this.filter.category === "physical" && !move.is("AttackMove")) {
      return false;
    }
    if (this.filter.category === "special" && !move.is("AttackMove")) {
      return false;
    }
    // Roll chance — use the pokerogue battle RNG for determinism in tests.
    if (this.chance < 100) {
      const roll = pokemon.randBattleSeedInt(100);
      if (roll >= this.chance) {
        return false;
      }
    }
    return true;
  }

  override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon, opponent } = params;
    if (!opponent) {
      return;
    }
    // Unshift a MovePhase for the holder using the counter move targeted at
    // the opponent. INDIRECT mode prevents PP consumption and history
    // recording (matches vanilla Color Change behaviour for automatic
    // ability-driven moves).
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      [opponent.getBattlerIndex()],
      scriptedPokemonMove(this.moveId, this.power, {
        ...(this.category === undefined ? {} : { category: this.category }),
        ...(this.healMultiplier === undefined ? {} : { healMultiplier: this.healMultiplier }),
      }),
      MoveUseMode.INDIRECT,
    );
  }
}
