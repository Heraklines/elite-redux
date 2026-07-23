/**
 * SHOWDOWN (versus) DATA-LEVEL PERSPECTIVE FLIP (Task F1).
 *
 * The versus HOST runs the only engine, in its OWN orientation: the host's team is the
 * authoritative PLAYER side (battler indices 0/1, `getPlayerParty`) and the opponent's
 * (the guest's) team is the authoritative ENEMY side (2/3, `getEnemyParty`). A pure-renderer
 * guest that adopted that world verbatim would show ITS OWN team on TOP as "enemies".
 *
 * This module is the ONE place the guest's world is re-oriented. Every AUTHORITATIVE payload
 * the versus guest INGESTS (launch session, per-turn authoritative state, live/batched battle
 * events, the legacy checkpoint + full-snapshot resync safety net) is mapped from the host's
 * orientation into the guest's LOCAL orientation - the guest's own team becomes its local
 * PLAYER party (`PlayerPokemon`, bottom of the screen), the opponent its local ENEMY party.
 * On the EGRESS side (checksum / save-data digest) the guest maps its LOCAL state BACK to the
 * authoritative orientation so host and guest hash the SAME world (see coop-battle-engine's
 * `captureVersusGuestChecksumState`).
 *
 * PURE + engine-free: type-only imports plus two enums (`BattlerIndex`, `ArenaTagSide`). Every
 * exported swap is its own INVERSE - `swap(swap(x)) === x` structurally (unit-tested) - because a
 * perspective flip is an involution. Party ORDER is deliberately PRESERVED (arrays are swapped by
 * reference, never reordered), so the guest's local party indices line up 1:1 with the host-side
 * enemy-party validation (switch cursors, party-slot identities).
 *
 * Gating lives at the call sites (`isShowdownGuestFlipGated()` / `isShowdownGuestFlip()`): these
 * functions are only ever invoked on the versus GUEST, so solo/co-op/host paths are byte-identical.
 */

import type { SessionSaveData } from "#app/@types/save-data";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopAuthoritativeFieldSeat,
  CoopBattleCheckpoint,
  CoopBattleEvent,
  CoopFullBattleSnapshot,
  CoopFullMonSnapshot,
  CoopSerializedArenaTag,
} from "#data/elite-redux/coop/coop-transport";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { BattlerIndex } from "#enums/battler-index";

/**
 * The width of one battle side in the standard field arrangement (PLAYER, PLAYER_2 | ENEMY,
 * ENEMY_2). `BattlerIndex.ENEMY` (== 2) is the offset between a player seat and the mirrored
 * enemy seat, DERIVED from the enum rather than hardcoded so the 1v1 (PLAYER<->ENEMY) and the
 * doubles (PLAYER_2<->ENEMY_2) shapes both fall out of the same arithmetic.
 */
const SIDE_OFFSET = BattlerIndex.ENEMY;

/**
 * Reflect a battler index across the side boundary: PLAYER<->ENEMY (0<->2), PLAYER_2<->ENEMY_2
 * (1<->3). Any other value (the `ATTACKER` -1 sentinel, an unexpected index) passes through
 * unchanged so a malformed payload can never map to a bogus seat.
 */
export function swapBi(bi: number): number {
  if (bi === BattlerIndex.PLAYER || bi === BattlerIndex.PLAYER_2) {
    return bi + SIDE_OFFSET;
  }
  if (bi === BattlerIndex.ENEMY || bi === BattlerIndex.ENEMY_2) {
    return bi - SIDE_OFFSET;
  }
  return bi;
}

/** Reflect an {@linkcode ArenaTagSide}: PLAYER<->ENEMY; BOTH is side-symmetric and unchanged. */
export function swapArenaTagSide(side: number): number {
  if (side === ArenaTagSide.PLAYER) {
    return ArenaTagSide.ENEMY;
  }
  if (side === ArenaTagSide.ENEMY) {
    return ArenaTagSide.PLAYER;
  }
  return side;
}

/** Reflect the string side tag of an authoritative field seat. */
function swapSeatSide(side: "player" | "enemy"): "player" | "enemy" {
  return side === "player" ? "enemy" : "player";
}

/**
 * Re-flag a list of wire modifier blobs onto the given side. The blobs are shallow-cloned with
 * their `player` field set (never mutated in place). The blob's OTHER fields (typeId / args /
 * stackCount, incl. a held item's `pokemonId` arg) are untouched: mon identities are keyed by the
 * shared `Pokemon.id` across clients, so a held item follows its mon across the side swap by id.
 */
function reflagModifierBlobs(blobs: Record<string, unknown>[] | undefined, player: boolean): Record<string, unknown>[] {
  if (!Array.isArray(blobs)) {
    return [];
  }
  return blobs.map(blob => ({ ...blob, player }));
}

/** Reflect one wire arena-tag's side. */
function swapArenaTag(tag: CoopSerializedArenaTag): CoopSerializedArenaTag {
  return { ...tag, side: swapArenaTagSide(tag.side) };
}

/** Reflect one authoritative field seat: side + bi cross the boundary; identity + order preserved. */
function swapFieldSeat(seat: CoopAuthoritativeFieldSeat): CoopAuthoritativeFieldSeat {
  return { ...seat, side: swapSeatSide(seat.side), bi: swapBi(seat.bi) };
}

/**
 * Reflect a per-turn {@linkcode CoopAuthoritativeBattleStateV1}: the two party rosters and the two
 * modifier stacks trade sides (parties by reference so ORDER is preserved; modifiers re-flagged),
 * every field seat is mirrored (side + bi), and arena-tag sides flip. Money / score / weather /
 * terrain / seeds / substrates are side-agnostic and pass through untouched.
 */
export function swapAuthoritativeState(state: CoopAuthoritativeBattleStateV1): CoopAuthoritativeBattleStateV1 {
  return {
    ...state,
    playerParty: state.enemyParty,
    enemyParty: state.playerParty,
    playerModifiers: reflagModifierBlobs(state.enemyModifiers, true),
    enemyModifiers: reflagModifierBlobs(state.playerModifiers, false),
    field: state.field.map(swapFieldSeat),
    arenaTags: state.arenaTags.map(swapArenaTag),
  };
}

/**
 * Reflect one {@linkcode CoopBattleEvent} so the replay phases animate the correct sprites. Every
 * bi-bearing member is remapped (moveUsed carries a user `bi` AND a `targets` list); the side-free
 * members (message / weather / terrain) pass through.
 */
export function swapBattleEvent(event: CoopBattleEvent): CoopBattleEvent {
  switch (event.k) {
    case "moveUsed":
      return { ...event, bi: swapBi(event.bi), targets: event.targets.map(swapBi) };
    case "hp":
    case "faint":
    case "statStage":
    case "status":
    case "showAbility":
    case "switch":
      return { ...event, bi: swapBi(event.bi) };
    default:
      // message / weather / terrain carry no side.
      return event;
  }
}

/**
 * Reflect the legacy numeric {@linkcode CoopBattleCheckpoint} (the per-turn safety net): each field
 * mon's `bi` crosses the boundary and arena-tag sides flip. `partyIndex` is left as-is - it is the
 * mon's slot in its OWNING party, and because party order is preserved that slot value is identical
 * on both sides of the swap (an on-field mon's slot tracks its field position, which the bi swap
 * already carries). Weather / terrain / money pass through.
 */
export function swapCheckpoint(cp: CoopBattleCheckpoint): CoopBattleCheckpoint {
  return {
    ...cp,
    field: cp.field.map(mon => ({ ...mon, bi: swapBi(mon.bi) })),
    ...(cp.arenaTags === undefined ? {} : { arenaTags: cp.arenaTags.map(swapArenaTag) }),
  };
}

/**
 * Reflect the rich per-mon companion carried beside a checkpoint / turn result. This carrier has
 * its own battler indices and is applied independently from both the numeric checkpoint and the
 * id-keyed authoritative state, so it must cross the Showdown perspective boundary independently
 * too. Keeping the transform here prevents a future ingress path from swapping two of the three
 * carriers while silently writing HP, PP, tags, or held items onto the opposite local side.
 */
export function swapFullField(field: readonly CoopFullMonSnapshot[]): CoopFullMonSnapshot[] {
  return field.map(mon => ({ ...mon, bi: swapBi(mon.bi) }));
}

/**
 * Reflect the {@linkcode CoopFullBattleSnapshot} resync (stateSync). The heavy lifting is the
 * embedded id-keyed {@linkcode CoopAuthoritativeBattleStateV1} (the modern unified path the guest
 * actually adopts), which is recursed. The legacy field/arena-tag seating is mirrored too so an
 * older-host fallback stays coherent; the legacy player-only `party`/`modifiers`/`benchParty`
 * fields have no enemy counterpart to trade with and are left as-is (ignored whenever
 * `authoritativeState` is present, which the showdown host always sends).
 */
export function swapFullSnapshot(snap: CoopFullBattleSnapshot): CoopFullBattleSnapshot {
  return {
    ...snap,
    field: swapFullField(snap.field),
    arenaTags: snap.arenaTags.map(swapArenaTag),
    ...(snap.authoritativeState === undefined
      ? {}
      : { authoritativeState: swapAuthoritativeState(snap.authoritativeState) }),
  };
}

/**
 * Reflect a parsed {@linkcode SessionSaveData} at the guest's launch/resume boundary: the player
 * and enemy rosters trade places (by reference - ORDER preserved), the two persistent-modifier
 * lists trade places WITH their `player` flag re-set (so a guest-team held item reconstructs
 * against the LOCAL player party in `ModifierData.toModifier`), and every arena tag's side flips.
 * Mutates + returns the SAME object (the caller owns this freshly-parsed session).
 */
export function swapSessionData(session: SessionSaveData): SessionSaveData {
  const { party, enemyParty } = session;
  // The rosters trade sides AND each mon's `player` flag flips, so PokemonData.toPokemon reconstructs
  // the correct SUBCLASS on the guest: the guest's own team (authored as the host's ENEMY roster) must
  // rebuild as PlayerPokemon (its local player side), and the opponent (host PLAYER roster) as
  // EnemyPokemon. Without this the guest's player party rebuilds as EnemyPokemon, whose getBattlerIndex
  // looks in the ENEMY field and returns -1, so every getField()[bi] round-trip in the launch chain
  // (PostSummonPhasePriorityQueue.queueAbilityPhase etc.) dereferences undefined and crashes. Mirrors
  // the modifier-list `player` re-flag below; flipping each mon twice keeps `swap∘swap` an involution.
  for (const p of enemyParty ?? []) {
    (p as { player?: boolean }).player = true;
  }
  for (const p of party ?? []) {
    (p as { player?: boolean }).player = false;
  }
  session.party = enemyParty;
  session.enemyParty = party;

  const { modifiers, enemyModifiers } = session;
  for (const m of enemyModifiers ?? []) {
    (m as { player?: boolean }).player = true;
  }
  for (const m of modifiers ?? []) {
    (m as { player?: boolean }).player = false;
  }
  session.modifiers = enemyModifiers;
  session.enemyModifiers = modifiers;

  const tags = session.arena?.tags;
  if (Array.isArray(tags)) {
    for (const tag of tags) {
      const t = tag as { side?: number };
      if (typeof t.side === "number") {
        t.side = swapArenaTagSide(t.side);
      }
    }
  }
  return session;
}
