/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — reusable LINK primitive (Batch 3).
//
// A generic "soul-link" between the holder and ONE allied active Pokemon,
// formed on entry and torn down when EITHER end leaves the field. Built as a
// standalone mechanic so the maintainer can reuse it on other upcoming mons
// (the link-driven trio — Soulmate / Rendezvous / Heartbreak — is the first
// consumer).
//
// DEFAULTS (documented in the batch report):
//   - Partner pick: the holder's NEAREST living ally, i.e. an *adjacent* ally
//     (`getAdjacentAllies`). In doubles that is the sole ally; in triples a
//     wing links to the centre and the centre picks between its two adjacent
//     allies with a SEEDED roll (`randBattleSeedInt`, co-op deterministic).
//   - Teardown: LAZY. `getLinkedAlly` returns the partner only while BOTH ends
//     are still active on the field and still mutually linked; the moment
//     either switches out or faints the accessor returns `undefined` and the
//     stale entry is cleared. This makes "ends when either leaves the field"
//     hold for switches AND faints without extra phase hooks. (Heartbreak's
//     on-faint reaction is an EVENT and is driven separately from the faint
//     flow — see `heartbreak.ts` + the `faint-phase.ts` hook.)
//
// SINGLES: with no ally there is nothing to link to, so every link-driven
// innate is inert by design.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";

/** Bidirectional link table: holder → its linked ally (and vice-versa). */
const LINKS = new WeakMap<Pokemon, Pokemon>();

/** Whether `a` and `b` are a live, active, mutually-linked pair on the field. */
function isLivePair(a: Pokemon, b: Pokemon): boolean {
  return a.isActive(true) && b.isActive(true) && LINKS.get(a) === b && LINKS.get(b) === a;
}

/**
 * Form (or keep) the holder's link to a nearest living ally. Idempotent: if the
 * holder already has a live link, it is preserved (so a mon carrying several
 * link-driven innates only forms ONE link). Returns the linked ally, or
 * `undefined` when there is no eligible ally (singles).
 */
export function formLink(holder: Pokemon): Pokemon | undefined {
  const existing = LINKS.get(holder);
  if (existing && isLivePair(holder, existing)) {
    return existing;
  }
  // Candidate allies: adjacent (nearest) living ones not already linked elsewhere.
  const candidates = holder.getAdjacentAllies().filter(a => a?.isActive(true) && !hasLiveLink(a));
  if (candidates.length === 0) {
    return;
  }
  const ally = candidates.length === 1 ? candidates[0] : candidates[globalScene.randBattleSeedInt(candidates.length)];
  LINKS.set(holder, ally);
  LINKS.set(ally, holder);
  return ally;
}

/** Whether `pokemon` currently holds a live link (used to avoid double-linking). */
function hasLiveLink(pokemon: Pokemon): boolean {
  const partner = LINKS.get(pokemon);
  return !!partner && isLivePair(pokemon, partner);
}

/**
 * The holder's linked ally, or `undefined`. Enforces LAZY teardown: a partner
 * that has left the field (switch/faint) or whose back-link no longer matches
 * is cleared and treated as unlinked.
 */
export function getLinkedAlly(holder: Pokemon): Pokemon | undefined {
  const partner = LINKS.get(holder);
  if (!partner) {
    return;
  }
  if (!isLivePair(holder, partner)) {
    // Stale — one end left the field. Clear both directions.
    LINKS.delete(holder);
    if (LINKS.get(partner) === holder) {
      LINKS.delete(partner);
    }
    return;
  }
  return partner;
}

/**
 * The partner `linked` is currently linked to, WITHOUT the "both on field"
 * liveness gate — used by on-faint reactions (Heartbreak), which run while the
 * fainting ally is mid-teardown and would otherwise already read as inactive.
 * Returns the recorded partner only if the back-link still matches.
 */
export function getRawLinkPartner(pokemon: Pokemon): Pokemon | undefined {
  const partner = LINKS.get(pokemon);
  if (partner && LINKS.get(partner) === pokemon) {
    return partner;
  }
  return;
}

/** Break the link on both ends (idempotent). */
export function breakLink(pokemon: Pokemon): void {
  const partner = LINKS.get(pokemon);
  LINKS.delete(pokemon);
  if (partner && LINKS.get(partner) === pokemon) {
    LINKS.delete(partner);
  }
}

/** Test helper: whether these two are currently a live linked pair. */
export function areLinked(a: Pokemon, b: Pokemon): boolean {
  return isLivePair(a, b);
}
