/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. The guard registry (spec section 1.5).
//
// A guard is a named, reusable, NON-removable correctness rule. Removing it would cause a bug
// rather than change the ability's design. The editor shows guards as locked "Safety rule" lines;
// they are never toggles and they carry no editable params.

import type { SlotId } from "./slots";

export interface GuardDef {
  readonly id: string;
  /** The plain-language "Safety rule" line shown in the editor. */
  readonly label: string;
  /** Why it is a guard and not a condition. */
  readonly why: string;
  readonly requires: readonly SlotId[];
  /** Exact expression and where it was lifted from. */
  readonly formula: { readonly expr: string; readonly source: string };
  readonly synonyms: readonly string[];
}

export const GUARD_REGISTRY: readonly GuardDef[] = [
  {
    id: "not-own-hp-cost-move",
    label: "Does not trigger when my own move (Belly Drum, Substitute, Curse, Pain Split) cost the HP",
    why: "Self-inflicted HP costs are not damage taken from a foe; triggering would be a bug.",
    requires: [],
    formula: {
      expr: "![BELLY_DRUM, SUBSTITUTE, CURSE, PAIN_SPLIT].includes(holder.getLastXMoves()[0]?.move)",
      source: "src/data/abilities/ab-attrs.ts PostDamageForceSwitchAbAttr.canApply (forbiddenAttackingMoves)",
    },
    synonyms: ["self damage", "hp cost move", "belly drum"],
  },
  {
    id: "not-already-forced-out",
    label: "Does not trigger when the attacker's move already forces a switch (Dragon Tail, Circle Throw, Sky Drop)",
    why: "The move switches the Pokemon out itself before the ability would act.",
    requires: ["other"],
    formula: {
      expr: "other has a last move AND it is not [DRAGON_TAIL, CIRCLE_THROW] AND not (SKY_DROP with result OTHER)",
      source: "src/data/abilities/ab-attrs.ts PostDamageForceSwitchAbAttr.canApply (forbiddenDefendingMoves)",
    },
    synonyms: ["dragon tail", "circle throw", "sky drop", "phazing"],
  },
  {
    id: "sheer-force-negates",
    label: "Does not trigger when the attacker's move is boosted by Sheer Force",
    why: "Sheer Force removes secondary effects, and this effect counts as one.",
    requires: ["other"],
    formula: {
      expr: "!(allMoves[other.lastMove].chance >= 0 && other.hasAbility(SHEER_FORCE))",
      source: "src/data/abilities/ab-attrs.ts PostDamageForceSwitchAbAttr.canApply (Sheer Force TODO)",
    },
    synonyms: ["sheer force", "secondary effect removed"],
  },
  {
    id: "after-final-hit",
    label: "Only triggers after the final hit of a multi-hit move",
    why: "Reacting to every strike of a multi-hit move would trigger early and repeatedly.",
    requires: ["other"],
    formula: {
      expr: "!(other.turnData.hitsLeft > 1)",
      source: "src/data/abilities/ab-attrs.ts PostDamageForceSwitchAbAttr.canApply (hitsLeft)",
    },
    synonyms: ["multi hit", "last strike", "final hit"],
  },
  {
    id: "not-fainted",
    label: "Does not trigger once I have fainted",
    why: "A fainted Pokemon cannot change form or act; triggering would be a bug, not a design choice.",
    requires: [],
    formula: {
      expr: "!holder.isFainted()",
      source: "src/data/elite-redux/archetypes/hp-threshold-form-change.ts HpThresholdFormChangeAbAttr.canApply",
    },
    synonyms: ["fainted", "knocked out", "alive"],
  },
  {
    id: "weather-form-species-only",
    label: "Only works for Castform with Forecast and Cherrim with Flower Gift",
    why: "The weather forms exist only on those two species; on any other Pokemon there is no form to change to.",
    requires: [],
    formula: {
      expr: "(species === CASTFORM && ability === FORECAST) || (species === CHERRIM && ability === FLOWER_GIFT)",
      source: "src/data/abilities/ab-attrs.ts PostWeatherChangeFormChangeAbAttr.guards",
    },
    synonyms: ["castform", "cherrim", "forecast", "flower gift"],
  },
];

const BY_ID: ReadonlyMap<string, GuardDef> = new Map(GUARD_REGISTRY.map(def => [def.id, def]));

export function getGuard(id: string): GuardDef | undefined {
  return BY_ID.get(id);
}
