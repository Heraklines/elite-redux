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
import { globalScene } from "#app/global-scene";
import { isShowdownGuestFlipGated } from "#data/elite-redux/coop/coop-authoritative-gate";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopAuthoritativeFieldSeat,
  CoopBattleCheckpoint,
  CoopBattleEvent,
  CoopFullBattleSnapshot,
  CoopFullMonSnapshot,
  CoopPresentationActorRef,
  CoopSerializedArenaTag,
} from "#data/elite-redux/coop/coop-transport";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { BattlerIndex } from "#enums/battler-index";

/**
 * The DEFAULT offset between a player seat and the mirrored enemy seat in the legacy binary field
 * arrangement (single/doubles): `BattlerIndex.ENEMY` (== 2). Player slots occupy 0..enemyBase-1 and
 * the enemy slots begin at `enemyBase`. TRIPLES shift the enemy base to 3 (player 0,1,2 / enemy
 * 3,4,5), so every bi-level swap takes an `enemyBase`; it DEFAULTS to {@linkcode liveEnemyBase} so a
 * caller that does not pass one picks up the live field width.
 */
const SIDE_OFFSET = BattlerIndex.ENEMY;

/**
 * The LIVE player<->enemy seat offset for the versus-guest flip: the guest's current battle
 * arrangement enemy base (singles/doubles 2, triples 3). Every bi-level swap DEFAULTS its
 * `enemyBase` to this, so the versus-guest ingress/egress swap sites (in coop-battle-engine /
 * coop-presentation / coop-replay-turn-phase) get the correct field width WITHOUT threading it
 * through every call - those sites already run under the guest's own scene, so
 * `globalScene.currentBattle.arrangement` is the guest's field.
 *
 * GATED on {@linkcode isShowdownGuestFlipGated}: only a LIVE versus guest reads the live width. Every
 * OTHER context - solo/co-op/host (which never call these swaps) AND the pure-logic unit tests (no
 * versus runtime) - gets the binary {@linkcode SIDE_OFFSET} (2), so singles/doubles behavior + the
 * involution tests are byte-identical and deterministic (never reading a leaked scene's arrangement).
 */
function liveEnemyBase(): number {
  if (!isShowdownGuestFlipGated()) {
    return SIDE_OFFSET;
  }
  return globalScene?.currentBattle?.arrangement?.enemyOffset ?? SIDE_OFFSET;
}

/**
 * Reflect a battler index across the side boundary for a field whose enemy side begins at
 * `enemyBase`: a player seat `p` (0..enemyBase-1) maps to enemy seat `enemyBase + p`, and back. Any
 * other value (the `ATTACKER` -1 sentinel, an out-of-range index) passes through unchanged so a
 * malformed payload can never map to a bogus seat. Defaults to the binary offset (2), which
 * reproduces the legacy PLAYER<->ENEMY (0<->2) / PLAYER_2<->ENEMY_2 (1<->3) mapping exactly;
 * triples pass `enemyBase = 3` so 0<->3, 1<->4, 2<->5. Its own inverse for symmetric formats.
 */
export function swapBi(bi: number, enemyBase: number = liveEnemyBase()): number {
  if (bi >= 0 && bi < enemyBase) {
    return bi + enemyBase; // player seat -> mirrored enemy seat
  }
  if (bi >= enemyBase && bi < enemyBase * 2) {
    return bi - enemyBase; // enemy seat -> mirrored player seat
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
function swapFieldSeat(seat: CoopAuthoritativeFieldSeat, enemyBase: number): CoopAuthoritativeFieldSeat {
  return { ...seat, side: swapSeatSide(seat.side), bi: swapBi(seat.bi, enemyBase) };
}

/**
 * Reflect a per-turn {@linkcode CoopAuthoritativeBattleStateV1}: the two party rosters and the two
 * modifier stacks trade sides (parties by reference so ORDER is preserved; modifiers re-flagged),
 * every field seat is mirrored (side + bi), and arena-tag sides flip. Money / score / weather /
 * terrain / seeds / substrates are side-agnostic and pass through untouched.
 */
export function swapAuthoritativeState(
  state: CoopAuthoritativeBattleStateV1,
  enemyBase: number = liveEnemyBase(),
): CoopAuthoritativeBattleStateV1 {
  return {
    ...state,
    playerParty: state.enemyParty,
    enemyParty: state.playerParty,
    playerModifiers: reflagModifierBlobs(state.enemyModifiers, true),
    enemyModifiers: reflagModifierBlobs(state.playerModifiers, false),
    field: state.field.map(seat => swapFieldSeat(seat, enemyBase)),
    arenaTags: state.arenaTags.map(swapArenaTag),
  };
}

/**
 * Reflect one {@linkcode CoopBattleEvent} so the replay phases animate the correct sprites. Every
 * bi-bearing member is remapped (moveUsed carries a user `bi` AND a `targets` list); the side-free
 * members (message / weather / terrain) pass through.
 */
export function swapBattleEvent(event: CoopBattleEvent, enemyBase: number = liveEnemyBase()): CoopBattleEvent {
  const swapActor = (actor: CoopPresentationActorRef): CoopPresentationActorRef => ({
    pokemonId: actor.pokemonId,
    side: actor.side === "player" ? "enemy" : "player",
  });
  switch (event.k) {
    case "moveUsed":
      return {
        ...event,
        bi: swapBi(event.bi, enemyBase),
        targets: event.targets.map(t => swapBi(t, enemyBase)),
        ...(event.actor === undefined ? {} : { actor: swapActor(event.actor) }),
        ...(event.targetActors === undefined ? {} : { targetActors: event.targetActors.map(swapActor) }),
      };
    case "hp":
      return event.actor === undefined
        ? { ...event, bi: swapBi(event.bi, enemyBase) }
        : { ...event, bi: swapBi(event.bi, enemyBase), actor: swapActor(event.actor) };
    case "faint":
      return event.actor === undefined
        ? { ...event, bi: swapBi(event.bi, enemyBase) }
        : { ...event, bi: swapBi(event.bi, enemyBase), actor: swapActor(event.actor) };
    case "statStage":
      return event.actor === undefined
        ? { ...event, bi: swapBi(event.bi, enemyBase) }
        : { ...event, bi: swapBi(event.bi, enemyBase), actor: swapActor(event.actor) };
    case "status":
      return event.actor === undefined
        ? { ...event, bi: swapBi(event.bi, enemyBase) }
        : { ...event, bi: swapBi(event.bi, enemyBase), actor: swapActor(event.actor) };
    case "showAbility":
      return event.actor === undefined
        ? { ...event, bi: swapBi(event.bi, enemyBase) }
        : { ...event, bi: swapBi(event.bi, enemyBase), actor: swapActor(event.actor) };
    case "tera":
      return event.actor === undefined
        ? { ...event, bi: swapBi(event.bi, enemyBase) }
        : { ...event, bi: swapBi(event.bi, enemyBase), actor: swapActor(event.actor) };
    case "switch":
      return event.actor === undefined
        ? { ...event, bi: swapBi(event.bi, enemyBase) }
        : { ...event, bi: swapBi(event.bi, enemyBase), actor: swapActor(event.actor) };
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
export function swapCheckpoint(cp: CoopBattleCheckpoint, enemyBase: number = liveEnemyBase()): CoopBattleCheckpoint {
  return {
    ...cp,
    field: cp.field.map(mon => ({ ...mon, bi: swapBi(mon.bi, enemyBase) })),
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
export function swapFullField(
  field: readonly CoopFullMonSnapshot[],
  enemyBase: number = liveEnemyBase(),
): CoopFullMonSnapshot[] {
  return field.map(mon => ({ ...mon, bi: swapBi(mon.bi, enemyBase) }));
}

/**
 * Reflect the {@linkcode CoopFullBattleSnapshot} resync (stateSync). The heavy lifting is the
 * embedded id-keyed {@linkcode CoopAuthoritativeBattleStateV1} (the modern unified path the guest
 * actually adopts), which is recursed. The legacy field/arena-tag seating is mirrored too so an
 * older-host fallback stays coherent; the legacy player-only `party`/`modifiers`/`benchParty`
 * fields have no enemy counterpart to trade with and are left as-is (ignored whenever
 * `authoritativeState` is present, which the showdown host always sends).
 */
export function swapFullSnapshot(
  snap: CoopFullBattleSnapshot,
  enemyBase: number = liveEnemyBase(),
): CoopFullBattleSnapshot {
  return {
    ...snap,
    field: swapFullField(snap.field, enemyBase),
    arenaTags: snap.arenaTags.map(swapArenaTag),
    ...(snap.authoritativeState === undefined
      ? {}
      : { authoritativeState: swapAuthoritativeState(snap.authoritativeState, enemyBase) }),
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
