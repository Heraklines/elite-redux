/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — reusable TURN ATTACK LEDGER primitive (Batch 3).
//
// Records, per turn, which attacker hit which target and whether the hit dealt
// direct damage, in resolution order. Lets "same-turn, same-target, second
// actor" abilities (Rendezvous, Synchronized Current, Closed Circuit) ask:
//   - did my linked ally already act on this target THIS turn?  (→ I am second)
//   - did both of us deal DIRECT damage to it?                  (→ combined proc)
//
// Recorded once per (attacker, target, move) from `MoveEffectPhase`'s
// `applyOnTargetEffects`, AFTER the target's own `PostAttackAbAttr`s run — so a
// second actor's PostAttack sees the FIRST actor's already-recorded hit but not
// (yet) its own, giving a clean "the partner went before me" test. The ledger
// self-clears when the turn number advances.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";

/** One recorded hit this turn. */
interface AttackRecord {
  readonly attacker: Pokemon;
  readonly target: Pokemon;
  /** Whether the hit dealt direct damage (vs a 0-damage / immune / status connect). */
  readonly damaging: boolean;
}

let ledgerKey = "";
let records: AttackRecord[] = [];

/** Stable identity for "this turn of this battle" (wave + turn number). */
function currentTurnKey(): string {
  const battle = globalScene.currentBattle;
  return `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}`;
}

/** Reset the ledger when the turn advances. */
function ensureCurrentTurn(): void {
  const key = currentTurnKey();
  if (key !== ledgerKey) {
    ledgerKey = key;
    records = [];
  }
}

/** Record that `attacker` hit `target` this turn (call once per move per target). */
export function recordTurnAttack(attacker: Pokemon, target: Pokemon, damaging: boolean): void {
  ensureCurrentTurn();
  records.push({ attacker, target, damaging });
}

/**
 * Whether `ally` already hit `target` earlier this turn (before the current
 * caller's own hit was recorded). When `requireDamage` is set, only
 * damage-dealing hits count.
 */
export function allyHitTargetThisTurn(ally: Pokemon, target: Pokemon, requireDamage = false): boolean {
  ensureCurrentTurn();
  return records.some(r => r.attacker === ally && r.target === target && (!requireDamage || r.damaging));
}

/** Test/inspection helper: number of recorded hits this turn. */
export function turnAttackCount(): number {
  ensureCurrentTurn();
  return records.length;
}

/** Test helper: forget everything recorded (used to isolate ledger state in tests). */
export function resetTurnAttackLedger(): void {
  ledgerKey = "";
  records = [];
}
