/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Multi-format battles - the battle ARRANGEMENT model.
//
// The engine has always been binary: `Battle.double: boolean`, a fixed 4-slot
// `BattlerIndex` enum, and "2 per side" baked in as `x % 2` arithmetic. This
// module replaces that with a data-driven FORMAT: an ordered list of sides, each
// with a capacity and an authored base index, plus an adjacency topology. The
// flat integer `BattlerIndex` stays the canonical wire/save/turnCommands key; a
// BattleArrangement maps flat-index <-> {side, position} and answers adjacency.
//
// CRITICAL invariant: the legacy `single`/`double` formats are AUTHORED to
// reproduce today's EXACT indices (enemy base index stays 2). So every binary
// battle is byte-identical and the whole migration is behavior-preserving - new
// index values appear ONLY in triple+ formats. See
// docs/plans/2026-06-30-multi-format-battles-architecture.md.
//
// Future-proof by design: N-per-side (triple, 4v4), >2 sides (battle royale, via
// `team` alliances), and "parallel battles" (a partitioned adjacency matrix) all
// describe as a BattleFormat; nothing here assumes 2 sides or 2 per side.
// =============================================================================

import { BattlerIndex } from "#enums/battler-index";
import { FieldPosition } from "#enums/field-position";

/** Structured battler identity. Used by topology/adjacency/new code only - NEVER as a map key (the flat BattlerIndex stays the key). */
export interface BattlerId {
  /** Side number; index into {@linkcode BattleFormat.sides}. -1 for {@linkcode BattlerIndex.ATTACKER}. */
  side: number;
  /** 0-based position within the side (left to right from that side's own view). -1 for ATTACKER. */
  position: number;
}

/** The role a side plays. PLAYER is the local human side; ALLY_TRAINER shares the player's row (tag battles). */
export enum SideKind {
  PLAYER = 0,
  ENEMY = 1,
  ALLY_TRAINER = 2,
  OTHER = 3,
}

/** Static description of one side of a battle. Immutable; live occupancy is the field arrays, not this. */
export interface BattleSideSpec {
  kind: SideKind;
  /** Max active Pokemon on this side. */
  capacity: number;
  /** Canonical base flat {@linkcode BattlerIndex} of this side's position 0. AUTHORED per format (legacy pins enemy=2). */
  baseIndex: number;
  /**
   * Whether this side's screen lanes run reversed (it faces the player from the opposite row).
   * Player/ally rows: false; enemy/other rows: true. Drives cross-side adjacency mirroring.
   */
  mirrored: boolean;
  /** Sides sharing a team are allies (battle-royale alliances). Defaults to the side's own number (every side its own team). */
  team?: number;
}

/** Positional reachability for "near"/adjacent-only moves. Reflexive/self handled by callers. */
export interface AdjacencyMatrix {
  reaches(a: BattlerId, b: BattlerId): boolean;
}

/** A complete battle format: the sides, who the local player is, and the adjacency topology. */
export interface BattleFormat {
  id: string;
  sides: BattleSideSpec[];
  /** Index into {@linkcode sides} of the local human player's side. */
  localPlayerSide: number;
  adjacency: AdjacencyMatrix;
}

/** The runtime registry: flat-index <-> {side,position} mapping + adjacency/ally queries, derived from a format. */
export interface BattleArrangement {
  readonly format: BattleFormat;
  /** Canonical base flat-index of `side` (authored). */
  sideOffset(side: number): number;
  /**
   * Flat battler index for a structured id. NB the returned index is a plain integer: in
   * triple+ formats it can exceed the {@linkcode BattlerIndex} enum (e.g. 4/5), which only
   * names the binary 0-3 slots.
   */
  indexOf(id: BattlerId): number;
  /** Structured id for a flat index (inverse of {@linkcode indexOf}). ATTACKER/unmapped -> {side:-1,position:-1}. */
  locate(index: number): BattlerId;
  /** The {@linkcode SideKind} owning a flat index (OTHER for ATTACKER/unmapped). */
  ownerOf(index: number): SideKind;
  /** Whether two flat indices are on the same team (allies). False if either is ATTACKER. */
  areAllies(a: number, b: number): boolean;
  /** Whether `a` can reach `b` with an adjacent-only move (per the format's topology). */
  isAdjacent(a: BattlerId, b: BattlerId): boolean;
  /** Capacity of a side. */
  capacityOf(side: number): number;
  /** All occupiable flat indices, in canonical (side, position) order. Use for turnCommands keys / RNG-ordered iteration. */
  activeIndices(): number[];
  /** Convenience: the local player side's capacity (== the legacy "battler count"). */
  readonly playerCapacity: number;
  /** Convenience: the first opposing (enemy-kind) side's capacity. */
  readonly enemyCapacity: number;
  /** Convenience: the base flat-index of the first opposing (enemy-kind) side (== legacy `BattlerIndex.ENEMY`). */
  readonly enemyOffset: number;
}

const ATTACKER_ID: BattlerId = { side: -1, position: -1 };

/**
 * Line-topology adjacency generator (standard mainline rule). Each side is a line of
 * positions on a shared, centered axis; an enemy row is mirrored. Two battlers are
 * adjacent iff their axis coordinates differ by at most one lane.
 *
 * - Triple (line of 3): the center reaches all 3 foes; a wing reaches the opposed foe
 *   + the center, NOT the far diagonal. Allied wings are NOT adjacent to each other.
 * - Double / single: every pair is mutually adjacent (so targeting is identical to today).
 *
 * Axis is scaled by 2 to stay in integers: non-mirrored pos -> `2*pos - (cap-1)`,
 * mirrored pos -> `(cap-1) - 2*pos`; adjacent iff `|axisA - axisB| <= 2`.
 */
export function lineAdjacency(sides: BattleSideSpec[]): AdjacencyMatrix {
  const axisOf = (id: BattlerId): number => {
    const spec = sides[id.side];
    const span = spec.capacity - 1;
    return spec.mirrored ? span - 2 * id.position : 2 * id.position - span;
  };
  return {
    reaches(a: BattlerId, b: BattlerId): boolean {
      if (a.side < 0 || b.side < 0) {
        return false;
      }
      return Math.abs(axisOf(a) - axisOf(b)) <= 2;
    },
  };
}

const teamOf = (sides: BattleSideSpec[], side: number): number => sides[side].team ?? side;

/** Build the runtime arrangement for a format. Pure - safe to memoize per format. */
export function createArrangement(format: BattleFormat): BattleArrangement {
  const { sides, localPlayerSide, adjacency } = format;

  const locate = (index: number): BattlerId => {
    if (index < 0) {
      return ATTACKER_ID;
    }
    for (let side = 0; side < sides.length; side++) {
      const spec = sides[side];
      if (index >= spec.baseIndex && index < spec.baseIndex + spec.capacity) {
        return { side, position: index - spec.baseIndex };
      }
    }
    return ATTACKER_ID;
  };

  const firstEnemySide = sides.findIndex(s => s.kind === SideKind.ENEMY);

  return {
    format,
    sideOffset: (side: number) => sides[side].baseIndex,
    indexOf: (id: BattlerId) => sides[id.side].baseIndex + id.position,
    locate,
    ownerOf: (index: number) => {
      const id = locate(index);
      return id.side < 0 ? SideKind.OTHER : sides[id.side].kind;
    },
    areAllies: (a: number, b: number) => {
      if (a === BattlerIndex.ATTACKER || b === BattlerIndex.ATTACKER) {
        return false;
      }
      const ia = locate(a);
      const ib = locate(b);
      if (ia.side < 0 || ib.side < 0) {
        return false;
      }
      return teamOf(sides, ia.side) === teamOf(sides, ib.side);
    },
    isAdjacent: (a: BattlerId, b: BattlerId) => adjacency.reaches(a, b),
    capacityOf: (side: number) => sides[side].capacity,
    activeIndices: () => {
      const out: number[] = [];
      for (const spec of sides) {
        for (let p = 0; p < spec.capacity; p++) {
          out.push(spec.baseIndex + p);
        }
      }
      return out;
    },
    get playerCapacity() {
      return sides[localPlayerSide].capacity;
    },
    get enemyCapacity() {
      return firstEnemySide >= 0 ? sides[firstEnemySide].capacity : sides[localPlayerSide].capacity;
    },
    get enemyOffset() {
      return firstEnemySide >= 0 ? sides[firstEnemySide].baseIndex : BattlerIndex.ENEMY;
    },
  };
}

// --- Legacy + new formats -----------------------------------------------------
//
// single/double pin the enemy base index to 2 (== BattlerIndex.ENEMY) so binary
// battles are byte-identical. triple shifts the enemy base to 3 (player 0,1,2 /
// enemy 3,4,5) - that shift is the whole point, and only fires in triple+.

function makeFormat(id: string, playerCap: number, enemyCap: number, enemyBase: number): BattleFormat {
  const sides: BattleSideSpec[] = [
    { kind: SideKind.PLAYER, capacity: playerCap, baseIndex: 0, mirrored: false },
    // Enemy is NON-mirrored so the adjacency matches the (non-mirrored) sprite layout: each
    // side's LEFT/CENTER/RIGHT line up as a direct face-off. A wing then reaches the foe on
    // its OWN side (the one "in front") plus the centre, not the far diagonal. (A mirrored
    // enemy made a wing reach the OPPOSITE wing, which read as targeting the wrong two foes.)
    // Adjacency only matters at capacity>=3; single/double have everyone mutually adjacent
    // either way, so this stays byte-identical there.
    { kind: SideKind.ENEMY, capacity: enemyCap, baseIndex: enemyBase, mirrored: false },
  ];
  return { id, sides, localPlayerSide: 0, adjacency: lineAdjacency(sides) };
}

// --- ER TRIPLES ROLL tuning ---------------------------------------------------
//
// Maintainer directive: "abt 20% of ghost battles should be made triples and 5% of
// all battles wild or trainer should be triples." These are 1-in-N rarities consumed
// by the seeded triple roll in BattleScene.resolveBattleFormat.

/** 1-in-N chance a natural WILD or TRAINER battle is upgraded to a triple (20 => ~5%). */
export const TRIPLE_BATTLE_RARITY = 20;
/** 1-in-N chance a GHOST battle (>=3-mon roster) is upgraded to a triple (5 => ~20%). */
export const TRIPLE_BATTLE_GHOST_RARITY = 5;

/** Single battle (1v1). Player @0, enemy @2 - identical to legacy. */
export const SINGLE_FORMAT: BattleFormat = makeFormat("single", 1, 1, BattlerIndex.ENEMY);
/** Double battle (2v2). Player @0,1, enemy @2,3 - identical to legacy. */
export const DOUBLE_FORMAT: BattleFormat = makeFormat("double", 2, 2, BattlerIndex.ENEMY);
/** Triple battle (3v3). Player @0,1,2, enemy @3,4,5. */
export const TRIPLE_FORMAT: BattleFormat = makeFormat("triple", 3, 3, BattlerIndex.ENEMY + 1);

/** The legacy binary formats, by their `double` boolean. */
export function legacyFormat(double: boolean): BattleFormat {
  return double ? DOUBLE_FORMAT : SINGLE_FORMAT;
}

/**
 * Map a 0-based field slot to a {@linkcode FieldPosition} for a side of `capacity`, for
 * sprite layout. 1 -> CENTER; 2 -> LEFT/RIGHT (legacy double); 3 -> LEFT/CENTER/RIGHT.
 * Extra slots clamp to RIGHT for now (the P4 UI pass refines >3-wide spacing).
 */
export function fieldPositionForSlot(slot: number, capacity: number): FieldPosition {
  if (capacity <= 1) {
    return FieldPosition.CENTER;
  }
  if (slot <= 0) {
    return FieldPosition.LEFT;
  }
  if (slot >= capacity - 1) {
    return FieldPosition.RIGHT;
  }
  return FieldPosition.CENTER;
}

/**
 * Per-slot SPRITE pixel offset from a side's centre, by {@linkcode FieldPosition} and the
 * side's capacity. Binary keeps the legacy tight spacing (center 0, wings +/-32). A 3-wide
 * side spreads the wings out and staggers depth. Player wings sit slightly higher than enemy
 * wings so the larger back sprites do not sink into the command bar.
 */
export function fieldSpriteOffset(position: FieldPosition, capacity: number, playerSide = false): [number, number] {
  if (capacity >= 3) {
    switch (position) {
      case FieldPosition.LEFT:
        return [-58, playerSide ? 4 : 10];
      case FieldPosition.RIGHT:
        return [58, playerSide ? 4 : 10];
      default:
        return [0, -8]; // CENTER sits back + up
    }
  }
  switch (position) {
    case FieldPosition.LEFT:
      return [-32, -8];
    case FieldPosition.RIGHT:
      return [32, 0];
    default:
      return [0, 0];
  }
}

/**
 * Per-slot HP/info-BAR pixel shift from the side's slot-0 anchor, so 3 bars stack legibly
 * instead of overlapping. Slot 0 is the anchor; each later slot steps diagonally. `playerSide`
 * mirrors the horizontal step (player bars sit bottom-right, enemy top-left). Binary slot 1
 * reproduces the legacy +/-10 / +27 shift.
 */
export function barSlotOffset(slot: number, playerSide: boolean, capacity = 2): [number, number] {
  const dx = 10 * (playerSide ? 1 : -1);
  if (capacity >= 3) {
    // Triple+: a side's info bars stack AWAY from the screen edge they anchor to, so all
    // three stay on-screen. The PLAYER's bars are anchored at the bottom, so they step UP
    // (into the field); the ENEMY's are anchored at the top, so they step DOWN. A tight
    // 16px step (paired with the triple thin-scale in BattleInfo) keeps three compact bars
    // within the band without reaching into the sprites. Slot 1 no longer matches the binary
    // double offset here, but that only applies at capacity>=3 - single/double are untouched.
    return [dx * slot, (playerSide ? -16 : 16) * slot];
  }
  // Single/double: the legacy diagonal down-step (byte-identical).
  return [dx * slot, 27 * slot];
}

/** Named lookup used by the override / resolver. Unknown id -> null. */
export function formatById(id: string | null | undefined): BattleFormat | null {
  switch (id) {
    case "single":
      return SINGLE_FORMAT;
    case "double":
      return DOUBLE_FORMAT;
    case "triple":
      return TRIPLE_FORMAT;
    default:
      return null;
  }
}
