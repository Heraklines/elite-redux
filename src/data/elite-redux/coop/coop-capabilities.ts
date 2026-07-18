/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op CAPABILITY negotiation (task #896 W2e-R2: negotiated capability-bit handshake).
// See docs/plans/2026-07-10-coop-authoritative-run-state-migration.md §5.2 (version gating)
// and §6.2/§6.3 (the fail-closed discipline).
//
// THE PROBLEM (external reviewer, "unnegotiated protocol"): feature activation for the new
// operation surfaces (biome / ME / reward adapters) is today hard-gated only by the coarse
// COOP_PROTOCOL_VERSION string plus a LOCAL flag. A version string is a WHOLE-BUILD stamp - it
// cannot express "this build has surface X enabled but not surface Y". So a flag-flip or a mixed
// build silently activates a surface on ONE peer only, which is exactly the host/guest divergence
// this architecture exists to kill.
//
// THE CURE: each peer ADVERTISES a string-keyed capability SET during the pairing handshake
// (carried additively on `hello` + `rosterSync`). The effective session capabilities are the
// INTERSECTION of both peers' advertised sets, computed IDENTICALLY on both sides (a pure function
// of the two sets), and frozen for the session. A surface activates only if its capability is in
// the negotiated set - so local-flag ON + peer-lacks-capability => the surface stays OFF on BOTH
// sides. FAIL CLOSED.
//
// TIMING (§1.4 / §4.4 rejoin semantics):
//   - Negotiated at pairing, when the peer's advertised set first arrives on `hello`/`rosterSync`.
//   - HOT REJOIN re-runs the handshake (the controller re-announces its `hello`, the peer re-sends
//     its own): the intersection is recomputed from the same two sets, so it is IDENTICAL - a bare
//     wireGeneration bump never clears it (nothing calls clearNegotiatedCoopCapabilities on a flap).
//   - A GENUINE RE-PAIR (a fresh runtime assembly) clears the set first, then renegotiates from the
//     new peer's `hello`.
//
// This module is ENGINE-FREE and dependency-light on purpose: the negotiation MATH must be unit-
// testable without a BattleScene, and it must import nothing from the surface adapters (the adapters
// consult the negotiated set, never the reverse - no cycle).
// =============================================================================

import { coopLog, coopWarn } from "#data/elite-redux/coop/coop-debug";

/**
 * A co-op capability is a stable string key (namespaced `<domain>.<feature>`). String-keyed - not an
 * enum - so an OLDER peer forwards keys it does not itself understand verbatim and a NEWER peer that
 * introduces a key still intersects cleanly (an unknown key simply fails to intersect and drops out).
 */
export type CoopCapabilityKey = string;

// -----------------------------------------------------------------------------
// The known capability keys THIS build reasons about. New surfaces add a key here.
// -----------------------------------------------------------------------------

/** The migrated biome-travel operation surface (coop-biome-operation.ts, §2.5 item 1). */
export const COOP_CAP_OP_BIOME: CoopCapabilityKey = "opSurface.biome";
/** The migrated mystery-encounter operation surface (coop-me-operation.ts, §2.5 item 2). */
export const COOP_CAP_OP_ME: CoopCapabilityKey = "opSurface.me.v2";
/** The migrated reward-shop operation surface (coop-reward-operation.ts, §2.5 item 3). */
export const COOP_CAP_OP_REWARD: CoopCapabilityKey = "opSurface.reward";
/** The migrated post-battle wave-advance operation surface - THE KEYSTONE (coop-wave-operation.ts, §2.5 item 4). */
export const COOP_CAP_OP_WAVE: CoopCapabilityKey = "opSurface.wave";
/** The migrated Giratina bargain terminal operation (§2.5 item 5). */
export const COOP_CAP_OP_BARGAIN: CoopCapabilityKey = "opSurface.bargain";
/** The migrated multi-round colosseum board/pick stream (§2.5 item 5). */
export const COOP_CAP_OP_COLOSSEUM: CoopCapabilityKey = "opSurface.colosseum";
/** The migrated ER ability consumable picker outcome (§2.5 item 5). */
export const COOP_CAP_OP_ABILITY: CoopCapabilityKey = "opSurface.abilityPicker";
/** The migrated owner-resolved faint replacement intent (§2.5 item 6). */
export const COOP_CAP_OP_FAINT_SWITCH: CoopCapabilityKey = "opSurface.faintSwitch";
/** The migrated Revival Blessing prompt + owner-resolved target stream. */
export const COOP_CAP_OP_REVIVAL: CoopCapabilityKey = "opSurface.revival";
/** The migrated per-move and batch move-learning control stream. */
export const COOP_CAP_OP_LEARN_MOVE: CoopCapabilityKey = "opSurface.learnMove";
/** The migrated wild-catch full-party keep/release control stream. */
export const COOP_CAP_OP_CATCH_FULL: CoopCapabilityKey = "opSurface.catchFull";
/** The migrated one-time Stormglass weather choice. */
export const COOP_CAP_OP_STORMGLASS: CoopCapabilityKey = "opSurface.stormglass";
/** The application-level durability journal (§4, coop-durability.ts / coop-operation-journal.ts). */
export const COOP_CAP_DURABILITY_JOURNAL: CoopCapabilityKey = "durability.journal";
/**
 * The renderer ALLOWLIST-ENFORCE flip (§3): the guest neutralizes any phase outside §3.1∪§3.2 instead
 * of warn-only. This flip MUST only happen when BOTH peers advertise it (a one-sided enforce would
 * neutralize a phase the other peer still runs -> a hang on one side only). This negotiation is the
 * PREREQUISITE for that flip; the flip itself gates on isCoopCapabilityNegotiated(this key).
 */
export const COOP_CAP_RENDERER_ALLOWLIST_ENFORCE: CoopCapabilityKey = "renderer.allowlistEnforce";
/**
 * The authority-v2 SHADOW harness (src/data/elite-redux/coop/authority-v2/shadow.ts). When BOTH peers
 * negotiate it, each independently runs the v2 foundation + adapters ALONGSIDE the live legacy netcode -
 * computing the authoritative progression, exchanging v2 frames, and logging parity - WITHOUT authorizing
 * any progression (legacy controls all mechanics). A one-sided build never activates it (the intersection
 * gates it), so a mixed build can never emit v2 frames a peer that lacks the harness would receive.
 */
export const COOP_CAP_AUTHORITY_V2_SHADOW: CoopCapabilityKey = "authority.v2shadow";

// -----------------------------------------------------------------------------
// The pure negotiation math (unit-tested engine-free).
// -----------------------------------------------------------------------------

/**
 * Compute the effective session capabilities = the INTERSECTION of the two peers' advertised sets.
 * Pure + symmetric: `negotiateCoopCapabilities(a, b)` and `negotiateCoopCapabilities(b, a)` yield the
 * SAME set, so both peers arrive at an identical result independently (the core correctness property).
 *
 * `peer === undefined` models an OLDER peer that sent NO capability field: it is treated as the EMPTY
 * set, so the intersection is empty and every negotiated feature is off (legacy paths engaged). The
 * result is deduped and sorted for a deterministic, comparable ordering.
 */
export function negotiateCoopCapabilities(
  local: Iterable<CoopCapabilityKey>,
  peer: Iterable<CoopCapabilityKey> | undefined,
): CoopCapabilityKey[] {
  const peerSet = new Set(peer ?? []);
  const result = new Set<CoopCapabilityKey>();
  for (const key of local) {
    if (peerSet.has(key)) {
      result.add(key);
    }
  }
  return [...result].sort();
}

// -----------------------------------------------------------------------------
// Session-scoped frozen negotiated set (the single source of truth surfaces consult).
// -----------------------------------------------------------------------------

/**
 * The frozen negotiated capability set for the LIVE session, or `null` when no negotiation has run yet
 * (pre-handshake, single-player, or a bare test that never paired). The `null` state is load-bearing:
 *   - `isCoopCapabilityNegotiated` FAILS CLOSED on `null` (an un-negotiated capability is never active).
 *   - `isCoopSurfaceCapabilityBlocked` treats `null` as "do NOT block" so a surface's LOCAL flag keeps
 *     its meaning until a real handshake has actually delivered a negotiated set.
 */
let negotiated: ReadonlySet<CoopCapabilityKey> | null = null;

/**
 * Negotiate + FREEZE the session capabilities from the two advertised sets, storing the result as the
 * live session set and returning it. Idempotent for identical inputs (a hot-rejoin re-handshake yields
 * the same frozen set). Logs the negotiated set and any LOCAL capability the peer did NOT advertise -
 * one clear line per dropped capability, so a surface silently disabled by the peer is diagnosable.
 */
export function setNegotiatedCoopCapabilities(
  local: Iterable<CoopCapabilityKey>,
  peer: Iterable<CoopCapabilityKey> | undefined,
): ReadonlySet<CoopCapabilityKey> {
  const localSet = new Set(local);
  const effective = negotiateCoopCapabilities(localSet, peer);
  if (negotiated !== null) {
    const frozenCurrent = negotiated;
    const unchanged = effective.length === frozenCurrent.size && effective.every(key => frozenCurrent.has(key));
    if (!unchanged) {
      coopWarn(
        "session",
        `capabilities MUTATION REFUSED frozen=[${[...frozenCurrent].sort().join(",")}] `
          + `later=[${effective.join(",")}] - a live session cannot change feature semantics`,
      );
    }
    return frozenCurrent;
  }
  const frozen: ReadonlySet<CoopCapabilityKey> = new Set(effective);
  negotiated = frozen;
  coopLog(
    "session",
    `capabilities NEGOTIATED local=[${[...localSet].sort().join(",")}] `
      + `peer=[${peer === undefined ? "<none>" : [...new Set(peer)].sort().join(",")}] `
      + `-> effective=[${effective.join(",")}]`,
  );
  for (const key of [...localSet].sort()) {
    if (!frozen.has(key)) {
      // Local advertised this capability but the peer did not -> the surface stays OFF on BOTH peers
      // (they compute the same intersection). Fail closed, and say WHICH capability was missing.
      coopWarn("session", `capability "${key}" advertised locally but NOT by peer -> surface disabled (fail-closed)`);
    }
  }
  return frozen;
}

/** The live negotiated set, or `null` if no handshake has produced one yet. */
export function getNegotiatedCoopCapabilities(): ReadonlySet<CoopCapabilityKey> | null {
  return negotiated;
}

/** True once a negotiated set exists (a real capability handshake has completed this session). */
export function hasNegotiatedCoopCapabilities(): boolean {
  return negotiated !== null;
}

/**
 * True iff `key` is in the frozen negotiated set. FAILS CLOSED when no set exists yet (`null` -> false),
 * so a capability is never treated as active until BOTH peers have provably advertised it. This is the
 * predicate the renderer-allowlist ENFORCE flip (§3) and any future both-peers-required gate consult.
 */
export function isCoopCapabilityNegotiated(key: CoopCapabilityKey): boolean {
  return negotiated !== null && negotiated.has(key);
}

/**
 * True iff a surface keyed on `key` must be BLOCKED by capability negotiation: a set exists AND it does
 * NOT contain the key. Returns FALSE when no set exists (pre-handshake) so a surface's local flag keeps
 * its standalone meaning until a real negotiation lands. A surface's effective activation is therefore
 * `localFlag && !isCoopSurfaceCapabilityBlocked(key)` - local flag ON + peer lacks capability => OFF.
 */
export function isCoopSurfaceCapabilityBlocked(key: CoopCapabilityKey): boolean {
  return negotiated !== null && !negotiated.has(key);
}

/**
 * Drop the negotiated set (a genuine re-pair / fresh control-plane assembly, §1.4). The NEXT handshake
 * re-negotiates. NEVER called on a hot rejoin (that keeps the same runtime + re-handshakes to the same
 * result); calling it on a bare wireGeneration flap would wrongly clear a still-valid negotiation.
 */
export function clearNegotiatedCoopCapabilities(): void {
  negotiated = null;
}
