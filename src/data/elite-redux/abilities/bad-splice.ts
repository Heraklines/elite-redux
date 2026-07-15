/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Bad Splice` (Batch 4, item 5).
//
// GENERAL ability (works on ANY holder). While the holder is active, each
// opposing ACTIVE Pokemon is temporarily spliced with additional types drawn
// from OTHER living members of its OWN party.
//
// DEFAULT implementation (documented — the maintainer is still workshopping the
// final shape, so this is kept cleanly parameterized):
//   - Splice source: ONE seeded-random OTHER living party member of the
//     opponent's party (`randBattleSeedInt`, co-op deterministic).
//   - What is grafted: that member's types the opponent does NOT already have,
//     as ADDITIONAL types (via the Batch-4 type-graft substrate — never
//     replaces existing types).
//   - When: on the holder's ENTRY (all current opposing actives) and on each
//     opposing SWITCH-IN while the holder remains active.
//   - Removal: when the holder LEAVES the field (switch or faint) the splice is
//     removed and each opponent's EXACT prior typing is restored — Bad Splice
//     un-grafts precisely the types it added (tracked per holder→foe), so a
//     type an opponent gained from another source is left intact.
//
// Parameterization knobs live in `BAD_SPLICE_CONFIG` so the maintainer can flip
// "one random member" to "all members" / "adjacent only" without touching the
// wiring.
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { getPokemonNameWithAffix } from "#app/messages";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import type { AbAttrBaseParams } from "#types/ability-types";
import { toCamelCase } from "#utils/strings";
import i18next from "i18next";
import { graftTypes, ungraftType } from "./type-graft";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_BAD_SPLICE_ABILITY_ID = 5932;

/** Tunable defaults — the maintainer can flip these without touching the wiring. */
export const BAD_SPLICE_CONFIG = {
  /** How many OTHER living party members contribute their types (DEFAULT: 1, seeded). */
  sourceMemberCount: 1,
} as const;

/**
 * Per-holder ledger of exactly which types Bad Splice grafted onto each foe, so
 * the holder can restore the foe's exact prior typing when it leaves the field.
 */
const SPLICE_LEDGER = new WeakMap<Pokemon, Map<Pokemon, Set<PokemonType>>>();

function ledgerFor(holder: Pokemon): Map<Pokemon, Set<PokemonType>> {
  let map = SPLICE_LEDGER.get(holder);
  if (!map) {
    map = new Map();
    SPLICE_LEDGER.set(holder, map);
  }
  return map;
}

/** Whether `pokemon` carries an unsuppressed, active Bad Splice. */
function hasBadSplice(pokemon: Pokemon): boolean {
  return (
    pokemon.isActive(true) && pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "BadSpliceAbAttr")
  );
}

/** The opponent's OWN living party members other than the opponent itself. */
function otherLivingPartyMembers(foe: Pokemon): Pokemon[] {
  const party: Pokemon[] = foe.isPlayer() ? globalScene.getPlayerParty() : globalScene.getEnemyParty();
  return party.filter(p => p !== foe && p.isAllowedInBattle());
}

/**
 * Splice `foe` from its own party per `BAD_SPLICE_CONFIG`, recording the grafted
 * types under `holder` so they can be undone precisely on the holder's exit.
 */
function spliceFoe(holder: Pokemon, foe: Pokemon): void {
  const candidates = otherLivingPartyMembers(foe);
  if (candidates.length === 0) {
    return;
  }
  // Pick `sourceMemberCount` distinct seeded-random members (DEFAULT 1).
  const pool = [...candidates];
  const donors: Pokemon[] = [];
  const wanted = Math.min(BAD_SPLICE_CONFIG.sourceMemberCount, pool.length);
  for (let i = 0; i < wanted; i++) {
    const idx = globalScene.randBattleSeedInt(pool.length);
    donors.push(pool.splice(idx, 1)[0]);
  }

  const donorTypes = new Set<PokemonType>();
  for (const donor of donors) {
    for (const type of donor.getTypes(false, false)) {
      if (type !== PokemonType.UNKNOWN) {
        donorTypes.add(type);
      }
    }
  }
  // Only types the foe does not already carry (native / added / already grafted).
  const toGraft = [...donorTypes].filter(t => !foe.isOfType(t));
  if (toGraft.length === 0) {
    return;
  }
  const added = graftTypes(foe, toGraft);
  if (added.length === 0) {
    return;
  }
  const record = ledgerFor(holder);
  const set = record.get(foe) ?? new Set<PokemonType>();
  for (const type of added) {
    set.add(type);
  }
  record.set(foe, set);
  for (const type of added) {
    globalScene.phaseManager.queueMessage(
      i18next.t("moveTriggers:addType", {
        typeName: i18next.t(`pokemonInfo:type.${toCamelCase(PokemonType[type])}`),
        pokemonName: getPokemonNameWithAffix(foe),
      }),
    );
  }
}

/** PostSummon half: on entry, splice every currently-active opponent. */
export class BadSpliceAbAttr extends PostSummonAbAttr {
  constructor() {
    super(false);
  }

  override apply({ pokemon, simulated }: AbAttrBaseParams): void {
    if (simulated) {
      return;
    }
    for (const foe of pokemon.getOpponents()) {
      spliceFoe(pokemon, foe);
    }
  }
}

/**
 * Driven from `PostSummonPhase` for a just-summoned `foe`: if an opposing active
 * Bad Splice holder exists, splice the incoming foe from its own party.
 */
export function erBadSpliceOnOpponentSummon(foe: Pokemon): void {
  for (const holder of foe.getOpponents()) {
    if (hasBadSplice(holder)) {
      spliceFoe(holder, foe);
    }
  }
}

/**
 * Driven from `Pokemon.leaveField`: when a Bad Splice holder leaves, un-graft
 * exactly the types it added to each foe, restoring their exact prior typing.
 */
export function erBadSpliceOnLeaveField(holder: Pokemon): void {
  const record = SPLICE_LEDGER.get(holder);
  if (!record) {
    return;
  }
  for (const [foe, types] of record) {
    for (const type of types) {
      ungraftType(foe, type);
    }
  }
  SPLICE_LEDGER.delete(holder);
}
