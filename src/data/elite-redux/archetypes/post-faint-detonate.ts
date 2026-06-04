/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-faint-detonate` archetype primitive.
//
// Models ER's "Aftermath" cluster: "After fainting, the holder uses a 100 BP
// Explosion (physical) or Outburst (special) — whichever does more damage —
// hitting all adjacent Pokemon (including its own ally in doubles), with the
// explosion animation, and the hits always Flinch the target."
//
//   - 106 Aftermath          — base ability.
//   - 614 Balloon Bomb       — "Aftermath + Inflatable" (the explosion half).
//
// Why this is a PreDefend clamp and NOT a PostFaint hook
// ------------------------------------------------------
// A fainted Pokemon cannot run a move: `MovePhase.start()` bails at
// `if (!user.isActive(true)) { this.end(); return; }` (move-phase.ts:123). By
// the time `PostFaintAbAttr` fires (faint-phase.ts) the holder is already at
// 0 HP, so any MovePhase we queue there is silently discarded — no animation,
// no spread, no flinch. That is exactly the broken behavior players saw.
//
// Instead we hook the lethal damaging hit BEFORE the holder reaches 0 HP, reuse
// the Sturdy damage-clamp to leave it at 1 HP, then have it actually USE an
// Explosion-class move while briefly alive. The move engine then provides the
// animation, the all-adjacent spread (Explosion's `ALL_NEAR_OTHERS` target,
// which includes the ally and excludes the user), type effectiveness, the
// flinch rider, and — via `SacrificialAttr` — the self-KO that re-faints the
// holder. We get all of it for free without re-implementing the move engine.
//
// Power override (true 100 BP, not the registered 250)
// ----------------------------------------------------
// The registered Explosion/Outburst moves are 250 BP. ER's Aftermath casts a
// reduced 100 BP version. Rather than mutate the shared global Move (races) or
// register new move ids (no animation asset), we hand `MovePhase` a tiny
// `PokemonMove` subclass whose `getMove()` returns a freshly-built 100 BP
// `AttackMove` that KEEPS `MoveId.EXPLOSION` as its id (so the animation and
// name still resolve to the real Explosion). `MovePhase`/`MoveEffectPhase`
// read everything through `this.move.getMove()` (move-phase.ts:198, passed on
// to MoveEffectPhase at move-phase.ts:893), so the 100 BP, the category, and
// the always-flinch rider all take effect for this one cast only.
//
// Scope / known limits (intentional for v1)
// -----------------------------------------
//   - Fires only on damaging-move KOs (the PreDefend surface). Status / weather
//     / recoil KOs do not detonate. This is actually MORE faithful than vanilla
//     Aftermath, which only ever triggered on *contact* KOs.
//   - Blocked by Damp (`FieldPreventExplosiveMovesAbAttr`): when a Damp-class
//     ability is on the field we do NOT clamp — the holder dies normally from
//     the original hit and no explosion plays (matching "Damp blocks
//     explosions"). The cancel-condition is intentionally NOT copied onto the
//     clone, so once we commit to detonating the self-KO is guaranteed.
//   - KO credit: because the holder survives the lethal hit at 1 HP and then
//     self-KOs via the explosion, the faint is attributed to the explosion
//     (INDIRECT), not the original attacker. Acceptable for an Aftermath
//     holder; flagged for the rare Destiny Bond / Grudge interaction.
// =============================================================================

import { PreDefendFullHpEndureAbAttr, type PreDefendModifyDamageAbAttrParams } from "#abilities/ab-attrs";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { globalScene } from "#app/global-scene";
import { PokemonMove } from "#data/moves/pokemon-move";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import { AttackMove, FlinchAttr, type Move, SacrificialAttr } from "#moves/move";
import { getMoveTargets } from "#moves/move-utils";
import { BooleanHolder } from "#utils/common";

/** Construction options for {@linkcode PostFaintDetonateAbAttr}. */
export interface PostFaintDetonateOptions {
  /**
   * Base power of the detonation. ER Aftermath uses 100.
   * @defaultValue `100`
   */
  readonly power?: number;
  /**
   * Whether the blast always flinches every target it hits.
   * @defaultValue `true`
   */
  readonly flinch?: boolean;
  /**
   * Elemental type of the blast. ER Aftermath/Balloon Bomb are Normal
   * (Explosion/Outburst); Victory Bomb is Fire.
   * @defaultValue {@linkcode PokemonType.NORMAL}
   */
  readonly type?: PokemonType;
}

/**
 * One-shot guard: a holder that has already armed its detonation this lifetime
 * must not re-arm. The STURDY clamp (which we reuse to survive the lethal hit)
 * lapses per-hit (pokemon.ts:4479), so without this a multi-hit move would
 * re-trigger the clamp AND queue a fresh explosion on every lethal sub-hit.
 *
 * A WeakSet keyed by the Pokemon object is GC-safe (entries drop with the
 * Pokemon) and survives across the sub-hits of a single multi-hit move.
 */
const DETONATED = new WeakSet<Pokemon>();

/**
 * Build the detonation Move for one cast. We keep {@linkcode MoveId.EXPLOSION}
 * as the id (so the animation + name resolve to the real Explosion) but rebuild
 * the move with the reduced power, the chosen category, the all-adjacent
 * spread, the self-KO, the always-flinch rider, and no contact. We deliberately
 * omit Explosion's Damp cancel-condition — Damp is handled up-front in
 * {@linkcode PostFaintDetonateAbAttr.canApply}.
 *
 * Built per-cast (cheap) rather than at module load to avoid import-order
 * coupling with the move/ability tables.
 */
function buildDetonationMove(power: number, category: MoveCategory, flinch: boolean, type: PokemonType): Move {
  // chance 100 → the FlinchAttr secondary always applies (Fake Out parity,
  // move.ts FAKE_OUT uses chance 100 + FlinchAttr).
  const chance = flinch ? 100 : -1;
  const move = new AttackMove(MoveId.EXPLOSION, type, category, power, 100, 5, chance, 0, 1)
    .attr(SacrificialAttr)
    .makesContact(false)
    .target(MoveTarget.ALL_NEAR_OTHERS);
  if (flinch) {
    move.attr(FlinchAttr);
  }
  return move;
}

/**
 * A {@linkcode PokemonMove} whose {@linkcode getMove} returns a prebuilt one-off
 * Move object instead of looking it up in `allMoves`. This is how the reduced
 * 100 BP power + chosen category reach the damage pipeline without touching the
 * shared global Explosion move.
 */
class DetonationPokemonMove extends PokemonMove {
  private readonly builtMove: Move;

  constructor(builtMove: Move) {
    super(MoveId.EXPLOSION);
    this.builtMove = builtMove;
  }

  public override getMove(): Move {
    return this.builtMove;
  }
}

/**
 * Parameterized `AbAttr` implementing the `post-faint-detonate` archetype.
 *
 * Extends pokerogue's {@linkcode PreDefendFullHpEndureAbAttr} (the Sturdy
 * damage-clamp). We override `canApply` to fire on ANY lethal damaging hit
 * (not just full-HP) so the holder survives at 1 HP, then `apply` clamps and
 * queues the explosion the holder uses as its dying act.
 */
export class PostFaintDetonateAbAttr extends PreDefendFullHpEndureAbAttr {
  private readonly power: number;
  private readonly flinch: boolean;
  private readonly type: PokemonType;

  constructor(opts: PostFaintDetonateOptions = {}) {
    super();
    this.power = opts.power ?? 100;
    this.flinch = opts.flinch ?? true;
    this.type = opts.type ?? PokemonType.NORMAL;
    if (!(this.power > 0)) {
      throw new Error(`[PostFaintDetonateAbAttr] power must be positive; got ${this.power}`);
    }
  }

  /** Read-only accessor for the configured base power. */
  public getPower(): number {
    return this.power;
  }

  /** Read-only accessor for the always-flinch flag. */
  public getFlinch(): boolean {
    return this.flinch;
  }

  /** Read-only accessor for the configured blast type. */
  public getType(): PokemonType {
    return this.type;
  }

  public override canApply(params: PreDefendModifyDamageAbAttrParams): boolean {
    const { pokemon, damage } = params;
    // Lethal damaging hit only; >1 max HP (so the 1 HP clamp is meaningful);
    // STURDY tag absent (per-hit re-arm guard, shared with vanilla Sturdy).
    if (pokemon.getMaxHp() <= 1 || damage.value < pokemon.hp || pokemon.getTag(BattlerTagType.STURDY)) {
      return false;
    }
    // One-shot guard across the sub-hits of a multi-hit move.
    if (DETONATED.has(pokemon)) {
      return false;
    }
    // Damp blocks explosions: if any field Pokemon prevents explosive moves we
    // do NOT clamp — the holder dies normally and nothing detonates.
    return !PostFaintDetonateAbAttr.isExplosionBlocked();
  }

  public override apply(params: PreDefendModifyDamageAbAttrParams): void {
    // super.apply adds the STURDY tag so the damage pipeline clamps this lethal
    // hit to leave the holder at 1 HP (pokemon.ts:4478).
    super.apply(params);
    const { pokemon, simulated } = params;
    if (simulated) {
      return;
    }
    DETONATED.add(pokemon);
    const category =
      pokemon.getEffectiveStat(Stat.SPATK) > pokemon.getEffectiveStat(Stat.ATK)
        ? MoveCategory.SPECIAL
        : MoveCategory.PHYSICAL;
    const move = buildDetonationMove(this.power, category, this.flinch, this.type);
    const targets = getMoveTargets(pokemon, MoveId.EXPLOSION).targets;
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      targets,
      new DetonationPokemonMove(move),
      MoveUseMode.INDIRECT,
    );
  }

  /**
   * True when a Damp-class ability (`FieldPreventExplosiveMovesAbAttr`) is
   * active on any field Pokemon. Mirrors the move engine's own Damp check
   * (move.ts ~4989) so we keep the holder dead rather than stranding it at
   * 1 HP when the explosion would be cancelled.
   */
  private static isExplosionBlocked(): boolean {
    const cancelled = new BooleanHolder(false);
    for (const p of globalScene.getField(true)) {
      applyAbAttrs("FieldPreventExplosiveMovesAbAttr", { pokemon: p, cancelled });
      if (cancelled.value) {
        return true;
      }
    }
    return false;
  }
}
