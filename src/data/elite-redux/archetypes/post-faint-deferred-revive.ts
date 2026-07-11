/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — `post-faint-deferred-revive` primitive (TRUE deferred revive).
//
// A genuine {@linkcode PostFaintAbAttr}: the holder ACTUALLY faints (leaves the
// field, triggers every faint interaction), and is flagged for a deferred
// revive. When the holder's side next SENDS OUT a party member
// ({@linkcode SummonPhase.onEnd} → {@linkcode erApplyPendingRevives}), the
// flagged fainted holder is restored to `hpFraction` of its max HP as a living
// bench reserve (HP restored + FAINT status cleared). One-shot per battle,
// gated on the environment (weather or terrain) that was active AT FAINT TIME.
//
// Wires:
//   - 629 Shallow Grave — "After fainting while fog is active, the user revives
//     at 25% max HP when sending out your next party member. This still
//     activates when the user faints on the last turn of fog." → 25%, fog gate.
//   - 899 Backup Power — "Revives at 25% HP once after fainting in Electric
//     Terrain." → 25%, Electric-terrain gate.
//
// Why a deferred party-revive and NOT the old PreDefend endure-clamp
// -----------------------------------------------------------------
// The prior {@linkcode PostFaintReviveAbAttr} CLAMPED the lethal hit to 1 HP and
// healed the SAME turn — so the mon never actually fainted, never left the
// field, and could not represent "revives when you send out your next party
// member" (nor a status/weather KO). Here the mon dies for real; the revive is
// applied to the OFF-FIELD party member at the next send-out, matching the dex.
// The revive restores a usable RESERVE (it is not force-summoned back onto the
// field — the next party member keeps the slot it was sent into).
// =============================================================================

import { PostFaintAbAttr, type PostFaintAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { TerrainType } from "#data/terrain";
import type { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";

export interface PostFaintDeferredReviveOptions {
  /** Fraction of max HP restored on revive (in `(0, 1]`). */
  readonly hpFraction: number;
  /** If set, only arms while one of these weathers is active at faint time. */
  readonly requireWeather?: readonly WeatherType[];
  /** If set, only arms while one of these terrains is active at faint time. */
  readonly requireTerrain?: readonly TerrainType[];
}

/**
 * Per-Pokemon deferred-revive record. Set when a flagged holder faints under its
 * gate; consumed at the next send-out on its side. A `WeakMap` is GC-safe and
 * keeps this transient battle state off the serialized Pokemon.
 */
const PENDING_REVIVE = new WeakMap<Pokemon, number>();

/** Per-Pokemon once-per-battle latch — the revive arms at most once per battle. */
const USED_THIS_BATTLE = new WeakMap<Pokemon, boolean>();

export class PostFaintDeferredReviveAbAttr extends PostFaintAbAttr {
  private readonly hpFraction: number;
  private readonly requireWeather: readonly WeatherType[] | null;
  private readonly requireTerrain: readonly TerrainType[] | null;

  constructor(options: PostFaintDeferredReviveOptions) {
    if (options.hpFraction <= 0 || options.hpFraction > 1) {
      throw new Error("[PostFaintDeferredReviveAbAttr] hpFraction must be in (0, 1]");
    }
    super(true);
    this.hpFraction = options.hpFraction;
    this.requireWeather = options.requireWeather ?? null;
    this.requireTerrain = options.requireTerrain ?? null;
  }

  /** Read-only accessor for the revive fraction. */
  public getHpFraction(): number {
    return this.hpFraction;
  }

  override canApply({ pokemon }: PostFaintAbAttrParams): boolean {
    if (USED_THIS_BATTLE.get(pokemon)) {
      return false;
    }
    if (this.requireWeather !== null) {
      const w = globalScene.arena.weather?.weatherType;
      if (w === undefined || !this.requireWeather.includes(w)) {
        return false;
      }
    }
    if (this.requireTerrain !== null) {
      const t = globalScene.arena.terrain?.terrainType ?? TerrainType.NONE;
      if (!this.requireTerrain.includes(t)) {
        return false;
      }
    }
    return true;
  }

  override apply({ pokemon, simulated }: PostFaintAbAttrParams): void {
    if (simulated) {
      return;
    }
    // Arm the deferred revive. The actual HP/status restore happens at the next
    // send-out on this side (see erApplyPendingRevives).
    USED_THIS_BATTLE.set(pokemon, true);
    PENDING_REVIVE.set(pokemon, this.hpFraction);
  }
}

/**
 * Revive any flagged, fainted party member on `isPlayer`'s side to its stored
 * HP fraction as a living reserve. Called from {@linkcode SummonPhase.onEnd}
 * after a Pokemon is sent out. Restores HP directly and clears the FAINT status
 * (the mon is off-field, so no field HealPhase applies), then queues a message.
 *
 * @param isPlayer - Whether the side that just sent out a Pokemon is the player.
 */
export function erApplyPendingRevives(isPlayer: boolean): void {
  const party = isPlayer ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
  for (const member of party) {
    if (!member?.isFainted()) {
      continue;
    }
    const fraction = PENDING_REVIVE.get(member);
    if (fraction === undefined) {
      continue;
    }
    PENDING_REVIVE.delete(member);
    member.hp = Math.max(1, Math.floor(member.getMaxHp() * fraction));
    // asPhase=false: apply immediately (the mon is off-field; a ResetStatusPhase
    // would resolve too late and out of the summon's control flow).
    member.resetStatus(true, false, false, false);
    member.updateInfo();
    globalScene.phaseManager.queueMessage(
      `${getPokemonNameWithAffix(member)} was revived and returned to the party!`,
      null,
      true,
    );
  }
}
