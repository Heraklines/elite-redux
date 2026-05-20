/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — Phase C Task C0: pre-built harness scenarios.
//
// Tests should NOT hand-roll a `HarnessSpec` for common cases like "subject
// switches in" or "subject KOs opponent". This module exposes a small library
// of factory functions that produce ready-to-run specs for those patterns.
//
// Each factory accepts the minimal data the scenario needs (e.g. ability ids,
// trigger-specific params) and returns a `HarnessSpec` suitable for
// `runHarness()`.
//
// What's here in C0 (extensible — C1+ will add more as new triggers come on):
//   - entryScenario             — PostSummonAbAttr (on-switch-in)
//   - postBattleInitScenario    — PostBattleInitAbAttr (battle start)
//   - betweenTurnsScenario      — PostTurnAbAttr (end-of-turn ticks)
//   - postFaintScenario         — PostFaintAbAttr (subject faints)
//   - statStageChangeScenario   — PostStatStageChangeAbAttr
//   - entryWithOpponentScenario — PostSummonAbAttr with both sides
//   - suppressedActiveScenario  — entry with active ability suppressed
//   - triplePassiveScenario     — entry with subject holding 3 distinct passives
// =============================================================================

import type { AbilityId } from "#enums/ability-id";
import type { HarnessPokemonSpec, HarnessSpec } from "./battle-harness";

/**
 * Helper: build a minimal {@linkcode HarnessPokemonSpec} from an active
 * ability id (and optional 3 passives). Most scenarios accept either an
 * `AbilityId` directly or a pre-built `HarnessPokemonSpec`.
 */
export function pokemonSpec(
  activeAbilityId: AbilityId,
  passives?: readonly [AbilityId, AbilityId, AbilityId],
): HarnessPokemonSpec {
  return passives === undefined ? { activeAbilityId } : { activeAbilityId, passiveAbilityIds: passives };
}

type SpecOrId = AbilityId | HarnessPokemonSpec;

function toSpec(input: SpecOrId): HarnessPokemonSpec {
  return typeof input === "number" ? { activeAbilityId: input } : input;
}

/**
 * Scenario: a Pokemon switches in. Triggers `PostSummonAbAttr` for the
 * subject only (the most common ER ability trigger — Intimidate, Drought,
 * Sand Stream, etc.).
 */
export function entryScenario(subject: SpecOrId): HarnessSpec {
  return { subject: toSpec(subject), trigger: "PostSummonAbAttr" };
}

/**
 * Scenario: both sides switch in. Triggers `PostSummonAbAttr` for each.
 * Used for "subject's Intimidate drops opponent's Attack" style assertions.
 */
export function entryWithOpponentScenario(subject: SpecOrId, opponent: SpecOrId): HarnessSpec {
  return {
    subject: toSpec(subject),
    opponent: toSpec(opponent),
    trigger: "PostSummonAbAttr",
  };
}

/**
 * Scenario: battle starts. Triggers `PostBattleInitAbAttr` (Mega Tyranitar's
 * Sand Stream, Boltund's Strong Jaw, etc.).
 */
export function postBattleInitScenario(subject: SpecOrId): HarnessSpec {
  return { subject: toSpec(subject), trigger: "PostBattleInitAbAttr" };
}

/**
 * Scenario: end-of-turn tick. Triggers `PostTurnAbAttr` (Speed Boost, Bad
 * Dreams, Harvest, etc.).
 */
export function betweenTurnsScenario(subject: SpecOrId): HarnessSpec {
  return { subject: toSpec(subject), trigger: "PostTurnAbAttr" };
}

/**
 * Scenario: subject faints. Triggers `PostFaintAbAttr` (Innards Out,
 * Aftermath, etc.).
 */
export function postFaintScenario(subject: SpecOrId): HarnessSpec {
  return { subject: toSpec(subject), trigger: "PostFaintAbAttr" };
}

/**
 * Scenario: a stat stage change just happened. Triggers
 * `PostStatStageChangeAbAttr` (Competitive, Defiant, etc.).
 */
export function statStageChangeScenario(subject: SpecOrId): HarnessSpec {
  return { subject: toSpec(subject), trigger: "PostStatStageChangeAbAttr" };
}

/**
 * Scenario: subject's active ability is suppressed (Gastro Acid / Neutralizing
 * Gas). The passive slots, if any, still fire. Useful for verifying that
 * suppression routes correctly and doesn't bleed across slots.
 */
export function suppressedActiveScenario(
  activeAbilityId: AbilityId,
  passives?: readonly [AbilityId, AbilityId, AbilityId],
): HarnessSpec {
  const subject: HarnessPokemonSpec =
    passives === undefined
      ? { activeAbilityId, suppressActive: true }
      : { activeAbilityId, passiveAbilityIds: passives, suppressActive: true };
  return { subject, trigger: "PostSummonAbAttr" };
}

/**
 * Scenario: subject holds 3 distinct passives (Elite Redux's headline 3-passive
 * feature). All four slots (active + 3 passives) should fire on entry.
 */
export function triplePassiveScenario(
  activeAbilityId: AbilityId,
  passives: readonly [AbilityId, AbilityId, AbilityId],
): HarnessSpec {
  return {
    subject: { activeAbilityId, passiveAbilityIds: passives },
    trigger: "PostSummonAbAttr",
  };
}
