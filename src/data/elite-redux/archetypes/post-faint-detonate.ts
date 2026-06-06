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
import { MovePhaseTimingModifier } from "#enums/move-phase-timing-modifier";
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
 * Per-holder arming record: the turn-key (`wave:turn`) on which the holder armed
 * its detonation. The STURDY clamp we reuse lapses per-hit, so without this a
 * multi-hit move would re-trigger the clamp AND queue a fresh explosion on every
 * lethal sub-hit. We must therefore keep enduring the *remaining sub-hits of the
 * arming move*, which all resolve within the same turn.
 *
 * It is keyed by turn (not a permanent flag) so the endure window is BOUNDED:
 * if the queued explosion fizzles (e.g. the holder KO'd the last foe with its
 * own move, so the blast has no target and `SacrificialAttr` never self-KOs it),
 * the holder is left alive at 1 HP — but the stale arming record is dropped on
 * the next turn, so it is NOT permanently invincible. A WeakMap is GC-safe.
 */
const ARMED_TURN = new WeakMap<Pokemon, string>();

/** Turn-scoped key for the current battle turn (`wave:turn`); arming is valid only within the same key. */
function currentArmingKey(): string {
  const battle = globalScene.currentBattle;
  return `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}`;
}

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
    // Only lethal damaging hits matter, and only when a 1-HP clamp is meaningful.
    if (pokemon.getMaxHp() <= 1 || damage.value < pokemon.hp) {
      return false;
    }
    // Already armed THIS turn: a multi-hit move keeps striking after the arming
    // hit clamped the holder to 1 HP, and EVERY remaining lethal sub-hit must be
    // endured — otherwise one of them re-kills the holder before the queued
    // explosion casts, and the cast bails (a fainted Pokemon cannot move). So we
    // keep clamping, bypassing the STURDY guard below: that guard exists only to
    // avoid double-arming, but our own STURDY tag from the arming hit lingers
    // into these sub-hits and would otherwise (wrongly) block the endure. At
    // 1 HP the STURDY damage-clamp itself can't fire (it needs hp > 1), so
    // `apply()` clamps the sub-hit's damage directly.
    const armedKey = ARMED_TURN.get(pokemon);
    if (armedKey !== undefined) {
      if (armedKey === currentArmingKey()) {
        return true;
      }
      // Stale arming from an earlier turn (the previous detonation fizzled and
      // left the holder alive at 1 HP). Drop it so this hit is handled normally —
      // the holder must NOT keep enduring forever (the "invincible Aftermath" bug).
      ARMED_TURN.delete(pokemon);
    }
    // Arming hit: a pre-existing STURDY tag (vanilla Sturdy / Focus Sash) means
    // this hit is already being survived elsewhere — don't arm on top of it.
    if (pokemon.getTag(BattlerTagType.STURDY)) {
      return false;
    }
    // Damp blocks explosions: if any field Pokemon prevents explosive moves we
    // do NOT clamp — the holder dies normally and nothing detonates.
    return !PostFaintDetonateAbAttr.isExplosionBlocked();
  }

  public override apply(params: PreDefendModifyDamageAbAttrParams): void {
    // super.apply adds the STURDY tag so the damage pipeline clamps this lethal
    // hit to leave the holder at 1 HP (pokemon.ts:4478).
    const { pokemon, simulated, damage } = params;

    // Subsequent lethal sub-hits of a multi-hit move (after the arming hit
    // already clamped the holder to 1 HP): survive them so the holder is still
    // alive when the queued explosion casts, but do NOT queue a second blast.
    // The holder is at exactly 1 HP here, where the STURDY tag's clamp (hp > 1)
    // no longer applies — so clamp this sub-hit's damage directly to leave it at
    // 1 HP. (ENDURING is the Endure-move tag and would spam an "enduring!"
    // message per sub-hit.)
    if (ARMED_TURN.get(pokemon) === currentArmingKey()) {
      if (!simulated) {
        damage.value = Math.max(0, pokemon.hp - 1);
      }
      return;
    }

    // First (arming) hit: STURDY's clamp leaves the >1-HP holder at 1 HP.
    super.apply(params);
    if (simulated) {
      return;
    }
    ARMED_TURN.set(pokemon, currentArmingKey());
    const category =
      pokemon.getEffectiveStat(Stat.SPATK) > pokemon.getEffectiveStat(Stat.ATK)
        ? MoveCategory.SPECIAL
        : MoveCategory.PHYSICAL;
    const move = buildDetonationMove(this.power, category, this.flinch, this.type);
    const targets = getMoveTargets(pokemon, MoveId.EXPLOSION).targets;
    // MovePhase is a *dynamic* phase: a plain `unshiftNew("MovePhase", ...)` is
    // routed into the speed-sorted MovePhasePriorityQueue, NOT to the immediate
    // front of execution. When the holder is KO'd by a FASTER attacker it is now
    // clamped to 1 HP (alive) and STILL has its own (slower) move queued for this
    // turn. Without forcing the timing, the holder's queued move could resolve
    // BEFORE this explosion — the reported "it still attacks before it explodes",
    // an illegitimate extra action. `MovePhaseTimingModifier.FIRST` forces the
    // detonation ahead of any remaining queued move, so it resolves immediately
    // on faint; the SacrificialAttr self-KO then re-faints the holder and its
    // pending move is skipped (a fainted Pokemon cannot run a move).
    globalScene.phaseManager.unshiftNew(
      "MovePhase",
      pokemon,
      targets,
      new DetonationPokemonMove(move),
      MoveUseMode.INDIRECT,
      MovePhaseTimingModifier.FIRST,
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
