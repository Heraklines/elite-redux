/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op battle CHECKSUM (#633, TRACK-2). The PURE core of the per-turn state
// fingerprint: a deterministic 64-bit hash of the FULL authoritative battle state.
// The host stamps its hash on each turn/checkpoint; the guest recomputes the same
// hash over its own state and, on a MISMATCH, requests + adopts a full authoritative
// `stateSync` snapshot so it can never drift unnoticed.
//
// Deliberately engine-FREE (no `globalScene` / `Pokemon` import) so the hashing +
// canonicalization is unit-testable headlessly. The thin engine adapter that READS a
// live field/arena/party/money/modifiers into the `CoopChecksumState` view lives in
// `coop-battle-engine.ts`; this module is just the canonical-string + hash transform,
// so the determinism guarantees are verifiable without booting the game.
//
// DETERMINISM RULES (the whole point - break one and two correct engines mismatch):
//   - Object keys are ALWAYS emitted in sorted order, NEVER `Object.keys` insertion
//     order. The `canonicalize` walker enforces this.
//   - The state type carries NO optionals: every field is a concrete value (an absent
//     ability/form resolves to 0 at read time), so `undefined` can never reach the
//     stringifier and `exactOptionalPropertyTypes` ambiguity is sidestepped entirely.
//   - Turn/duration COUNTERS (weather/terrain `turnsLeft`, per-tag `turnCount`) are
//     EXCLUDED: they decrement on tick and legitimately differ by one between two
//     correct engines depending on exactly when each side reads. Only TYPE / IDENTITY
//     is hashed. Adding a counter back to the hashed shape re-introduces false desyncs.
// =============================================================================

/** One field mon's full deterministic state for the checksum (NO optionals). */
export interface CoopChecksumMon {
  /** Battler index (0 host lead, 1 guest lead, 2/3 enemies). */
  bi: number;
  /**
   * STABLE party-slot identity (#633, enemy-switch mirror): the host's `getEnemyParty().indexOf`
   * (player: `getPlayerParty().indexOf`). For an on-field mon this equals its field slot, so it
   * does not by itself detect a switch; {@linkcode speciesId} below is the detectable identity.
   */
  partyIndex: number;
  /**
   * `species.speciesId` (#633, enemy-switch mirror). Hashing it is INTENDED: a host enemy switch
   * keeps the same `bi` but swaps in a different SPECIES, so without this the checksum could miss a
   * switch between two mons of identical hp/stats. A switch now changes the checksum (detectable)
   * and re-converges once the guest mirrors the switch.
   */
  speciesId: number;
  hp: number;
  maxHp: number;
  /** `StatusEffect` enum value (0 = none). */
  status: number;
  /** The 7 stat stages (ATK..ACC/EVA). */
  statStages: number[];
  fainted: boolean;
  /** Active ability id (`AbilityId`); 0 when unknown/absent. */
  abilityId: number;
  /** Current form index; 0 when absent. */
  formIndex: number;
  /**
   * Whether this mon is Terastallized (#633 GAP 7). Hashing it is INTENDED: a Tera command the
   * guest dropped changes the mon's type/STAB on the host but not the guest, so without this the
   * checksum could miss a Tera divergence. A drop now changes the checksum (detectable) and
   * re-converges once the guest's snapshot apply forces the host's tera state.
   */
  isTerastallized: boolean;
  /** Tera type (`PokemonType` enum); 0 when not relevant. Carried so a wrong-type Tera is detected. */
  teraType: number;
  /**
   * Boss segment COUNT (#633, A/BLOCKING-2); 0 = not a boss. Hashing it makes a missing-boss guest
   * (bossSegments=0 vs host=N) detectable - without it a missing-boss guest with a matching maxHp is
   * invisible to the checksum, so the bars silently never render and no resync is ever triggered.
   */
  bossSegments: number;
  /**
   * Boss segment INDEX (#633, A/BLOCKING-2): how many shields are still up. The shield dividers render
   * from THIS, not the count, and the host decrements it as segments break while the guest's HP-drain
   * replay sets hp by direct assignment (never via `damage()`), so the index can diverge with a
   * matching count. Hashing it makes that divergence detectable + re-convergeable on resync.
   */
  bossSegmentIndex: number;
  /** Each move slot as `[moveId, ppUsed]`, in moveset slot order (NOT sorted). */
  moves: [number, number][];
  /** Sorted ascending list of the battler-tag TYPE ids present (identity only, no counters). */
  tags: number[];
}

/**
 * The full authoritative battle state hashed each turn. Every field is concrete (no
 * optionals); arrays whose ORDER is meaningful (party order, move slots) are kept in
 * order, while identity-only sets (tags, modifiers) are pre-sorted by the adapter so
 * the hash is order-stable regardless of engine iteration order.
 */
export interface CoopChecksumState {
  /** Every occupied field mon, sorted ascending by `bi`. */
  field: CoopChecksumMon[];
  /** `WeatherType` enum value (0 = none). Turn counter is intentionally excluded. */
  weather: number;
  /** `TerrainType` enum value (0 = none). Turn counter is intentionally excluded. */
  terrain: number;
  /** Arena tag identities as `[tagType, side]`, sorted. Turn counts are excluded. */
  arenaTags: [number, number][];
  /** Player party `speciesId`s in slot order (order is meaningful - do NOT sort). */
  party: number[];
  /**
   * Player party LEVELS in slot order (#633 B4): detects BENCH-mon level drift the speciesId-only
   * `party` list misses - e.g. a bench mon REVIVED / level-changed in the shop on the host but not
   * the guest (the live revive desync), or a pre-evolution level-boundary divergence. Integer, slot
   * order, settled at the CommandPhase boundary (the host's B5 exp delivery lands in BattleEndPhase,
   * many phases before the next wave's checksum), so it is deterministic and never a false-resync.
   */
  partyLevels: number[];
  money: number;
  /** Persistent modifiers as `[typeId, stackCount]`, sorted by `typeId`. */
  modifiers: [string, number][];
}

/** A read-failure sentinel digest. Both sides agree to SKIP the comparison on it. */
export const COOP_CHECKSUM_SENTINEL = "0000000000000000";

/**
 * Deterministic stringifier: object keys ALWAYS emitted in sorted order (never
 * insertion order), arrays in their given order, numbers normalized so `1`, `1.0`,
 * and `-0` hash equal, and `undefined` impossible (the state type forbids it). This
 * is the ONLY stringifier the hash ever sees.
 */
export function canonicalize(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "number") {
    return canonNumber(value);
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
  }
  // undefined / function / symbol must never reach here - the state type forbids them.
  return "null";
}

/** Normalize a number so `1`, `1.0`, `-0`, and non-finite values hash stably. */
function canonNumber(n: number): string {
  if (!Number.isFinite(n)) {
    // NaN / Infinity can't legitimately appear in battle state; neutralize them.
    return "0";
  }
  if (n === 0) {
    // Collapse -0 and 0.
    return "0";
  }
  if (Number.isInteger(n)) {
    return n.toString();
  }
  // Stable float formatting (battle-state numbers are integers anyway; this guards a
  // stray fractional value from formatting differently across engines).
  return n.toPrecision(12);
}

// FNV-1a 64-bit. BigInt (not two 32-bit halves): exactOptionalPropertyTypes-neutral,
// no manual carry/overflow bugs, and it runs once per turn over a ~1KB string, so the
// BigInt cost is irrelevant. The pure-core boundary lets this swap to a halves impl
// behind the same signature if a hot path ever needs it.
const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/** FNV-1a 64-bit over the UTF-16 code units of `s`, returned as a 16-char hex string. */
export function fnv1a64(s: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
}

/** Hash a canonical battle state into its stable 64-bit hex digest. */
export function checksumState(state: CoopChecksumState): string {
  return fnv1a64(canonicalize(state));
}
