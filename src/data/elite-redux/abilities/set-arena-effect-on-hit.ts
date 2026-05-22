/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase D bespoke: "set arena tag / terrain when hit" cluster.
//
// Covers a small family of ER bespoke abilities that, when this Pokemon is hit
// by a damaging move, deploy an arena tag (hazard / screen / room) OR set a
// terrain on the field. The trigger surface is `PostDefendAbAttr` (same as
// vanilla Static / Effect Spore), but the effect is field-state rather than a
// status proc — so we can't reuse `ChanceStatusOnHitAbAttr` and instead model
// this as two sibling AbAttr classes here.
//
// Sibling classes:
//   - `SetArenaTagOnHitAbAttr` — places an `ArenaTagType` (Spikes, Stealth
//     Rock, Sticky Web, screens, rooms) on the configured side when hit.
//   - `SetTerrainOnHitAbAttr` — calls `globalScene.arena.trySetTerrain` to
//     swap the terrain.
//
// Each accepts an optional `contactRequired` flag mirroring the convention from
// `ChanceStatusOnHitAbAttr` (defaults to true for the "Static-style" abilities
// in this cluster, false for the wider "any damaging hit" variants).
//
// ER abilities currently wired through these primitives:
//   - 906 Drop Blocks — Spikes on attacker side, any contact hit.
//   - 909 Loose Thorns — Creeping Thorns (ER-specific arena tag, not
//     yet modeled in pokerogue's enum) — wired via `SetArenaTagOnHitAbAttr`
//     using `SPIKES` as a stand-in until the ER tag lands. Documented mismatch.
//   - 956 Brain Overload — set Psychic Terrain on hit.
//   - 898 Power Leak — set Electric Terrain on hit.
//
// Abilities deferred (referenced by Phase D inventory but missing the runtime
// hook in pokerogue's enums):
//   - 905 Fog Machine — needs ER-specific `EERIE_FOG` arena tag; not in vanilla
//     `ArenaTagType`. Deferred until ER arena-tag layer lands.
// =============================================================================

import { PostDefendAbAttr, type PostMoveInteractionAbAttrParams } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import type { TerrainType } from "#data/terrain";
import { ArenaTagSide } from "#enums/arena-tag-side";
import type { ArenaTagType } from "#enums/arena-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveFlags } from "#enums/move-flags";

/**
 * Construction options for {@linkcode SetArenaTagOnHitAbAttr}.
 */
export interface SetArenaTagOnHitOptions {
  /**
   * The {@linkcode ArenaTagType} to add to the chosen side when the proc fires.
   * Hazards (`SPIKES`, `STEALTH_ROCK`, `STICKY_WEB`, `TOXIC_SPIKES`) are the
   * common case for this cluster; screens / rooms are also valid via the
   * `turns` option below.
   */
  readonly tagType: ArenaTagType;
  /**
   * How many turns the tag persists. Pass `0` for hazards (which use 0 to
   * mean "until cleared"). Defaults to `0` (hazard semantics).
   * @defaultValue `0`
   */
  readonly turns?: number;
  /**
   * Which side the tag attaches to. Defaults to "the side opposite the user"
   * — i.e. when this Pokemon is hit, the tag goes on the attacker's side,
   * matching Spikes-on-attacker behaviour for `Drop Blocks` / `Loose Thorns`.
   * @defaultValue `"attacker"`
   */
  readonly side?: "self" | "attacker" | "both";
  /**
   * When true, the proc only fires on contact moves. When false (default),
   * any damaging move triggers the deploy.
   * @defaultValue `false`
   */
  readonly contactRequired?: boolean;
}

/**
 * Parameterized `AbAttr` placing an arena tag on the chosen side when this
 * Pokemon takes a damaging hit. Models ER's "spike-on-hit" / "deploy hazard
 * defensively" cluster.
 *
 * @remarks
 * Extends {@linkcode PostDefendAbAttr}. The proc fires from pokerogue's
 * existing post-defend dispatch — the only thing we add is a contact-required
 * gate (off by default) and the deploy logic. We DO NOT check whether the
 * hazard "can be added" (e.g. SPIKES has a layer cap); the arena layer's
 * `addTag` is idempotent past the cap, so a no-op on the third call is fine.
 */
export class SetArenaTagOnHitAbAttr extends PostDefendAbAttr {
  private readonly tagType: ArenaTagType;
  private readonly turns: number;
  private readonly side: "self" | "attacker" | "both";
  private readonly contactRequired: boolean;

  constructor(opts: SetArenaTagOnHitOptions) {
    super();
    this.tagType = opts.tagType;
    this.turns = opts.turns ?? 0;
    this.side = opts.side ?? "attacker";
    this.contactRequired = opts.contactRequired ?? false;
  }

  /** Read-only accessor: the arena tag the proc deploys. */
  public getTagType(): ArenaTagType {
    return this.tagType;
  }

  /** Read-only accessor: the turn count passed to the arena layer. */
  public getTurns(): number {
    return this.turns;
  }

  /** Read-only accessor: which side the tag deploys to. */
  public getSide(): "self" | "attacker" | "both" {
    return this.side;
  }

  /** Read-only accessor: whether the proc requires contact. */
  public requiresContact(): boolean {
    return this.contactRequired;
  }

  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { move, opponent: attacker, pokemon, hitResult } = params;
    // Must be a damaging move that actually landed.
    if (hitResult >= HitResult.NO_EFFECT) {
      return false;
    }
    if (
      this.contactRequired
      && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })
    ) {
      return false;
    }
    return true;
  }

  public override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    const { pokemon } = params;
    const sourceId = pokemon.id;
    // Map our "self/attacker/both" friendlier vocab onto pokerogue's
    // `ArenaTagSide` (`PLAYER` / `ENEMY` / `BOTH`). For "attacker" we use the
    // side opposite the defender (this Pokemon).
    const defenderIsPlayer = pokemon.isPlayer();
    let targetSide: ArenaTagSide;
    switch (this.side) {
      case "self":
        targetSide = defenderIsPlayer ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
        break;
      case "attacker":
        targetSide = defenderIsPlayer ? ArenaTagSide.ENEMY : ArenaTagSide.PLAYER;
        break;
      case "both":
        targetSide = ArenaTagSide.BOTH;
        break;
    }
    globalScene.arena.addTag(this.tagType, this.turns, undefined, sourceId, targetSide);
  }
}

/**
 * Construction options for {@linkcode SetTerrainOnHitAbAttr}.
 */
export interface SetTerrainOnHitOptions {
  /** The {@linkcode TerrainType} to set when the proc fires. */
  readonly terrain: TerrainType;
  /**
   * When true, the proc only fires on contact moves.
   * @defaultValue `false`
   */
  readonly contactRequired?: boolean;
}

/**
 * Parameterized `AbAttr` setting a terrain when this Pokemon takes a damaging
 * hit. Models ER's "deploy terrain reactively" cluster.
 *
 * @remarks
 * Extends {@linkcode PostDefendAbAttr}. Calls `globalScene.arena.trySetTerrain`
 * with `force = false` so terrain priority rules apply (existing terrain isn't
 * overwritten by a lower-priority one). `trySetTerrain` already silently
 * no-ops when the requested state is already active.
 */
export class SetTerrainOnHitAbAttr extends PostDefendAbAttr {
  private readonly terrain: TerrainType;
  private readonly contactRequired: boolean;

  constructor(opts: SetTerrainOnHitOptions) {
    super();
    this.terrain = opts.terrain;
    this.contactRequired = opts.contactRequired ?? false;
  }

  /** Read-only accessor: the terrain the proc deploys. */
  public getTerrain(): TerrainType {
    return this.terrain;
  }

  /** Read-only accessor: whether the proc requires contact. */
  public requiresContact(): boolean {
    return this.contactRequired;
  }

  public override canApply(params: PostMoveInteractionAbAttrParams): boolean {
    const { move, opponent: attacker, pokemon, hitResult } = params;
    if (hitResult >= HitResult.NO_EFFECT) {
      return false;
    }
    if (
      this.contactRequired
      && !move.doesFlagEffectApply({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: pokemon })
    ) {
      return false;
    }
    return true;
  }

  public override apply(params: PostMoveInteractionAbAttrParams): void {
    if (params.simulated) {
      return;
    }
    globalScene.arena.trySetTerrain(this.terrain, false, params.pokemon);
  }
}
