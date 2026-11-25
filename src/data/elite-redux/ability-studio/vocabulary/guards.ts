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
import { type BrowseCategory, withVocabularyText } from "./texts";

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
  /** One short sentence with a concrete example (spec 8.2), written by hand in texts-effects.ts. */
  readonly summary: string;
  /** The browse category of spec 8.4. */
  readonly category: BrowseCategory;
}

/** A guard as written in the registry; its summary and category come from texts-effects.ts. */
export type GuardBase = Omit<GuardDef, "summary" | "category">;

const BASE_GUARDS: readonly GuardBase[] = [
  {
    id: "not-own-hp-cost-move",
    label: "Not when my own move paid the HP",
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
    label: "Not when the attacker's move already forces a switch",
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
    label: "Not when Sheer Force removed the move's extra effects",
    why: "Sheer Force removes secondary effects, and this effect counts as one.",
    requires: ["other"],
    formula: {
      expr: "!(allMoves[other.lastMove].chance >= 0 && other.hasAbility(SHEER_FORCE))",
      source: "src/data/abilities/ab-attrs.ts PostDamageForceSwitchAbAttr.canApply (Sheer Force TODO)",
    },
    synonyms: ["sheer force", "secondary effect removed", "no extra effects"],
  },
  {
    id: "after-final-hit",
    label: "Only after the last hit of a multi-hit move",
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
    label: "Not once I have fainted",
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
    label: "Only for Castform (Forecast) and Cherrim (Flower Gift)",
    why: "The weather forms exist only on those two species; on any other Pokemon there is no form to change to.",
    requires: [],
    formula: {
      expr: "(species === CASTFORM && ability === FORECAST) || (species === CHERRIM && ability === FLOWER_GIFT)",
      source: "src/data/abilities/ab-attrs.ts PostWeatherChangeFormChangeAbAttr.guards",
    },
    synonyms: ["castform", "cherrim", "forecast", "flower gift"],
  },
  // ---- Librarian pass (B19): safety rules requested by the batch agents -----------------------
  {
    id: "not-blocked-by-effect-shield",
    label: "Not when the target ignores extra effects (Shield Dust)",
    why: "Adding an effect to a Pokemon the game promises is immune to extra effects would be a bug, not a design choice.",
    requires: ["other"],
    formula: {
      expr: '!other.hasAbilityWithAttr("IgnoreMoveEffectsAbAttr")',
      source:
        "src/data/abilities/ab-attrs.ts PostAttackApplyBattlerTagAbAttr.guards; archetypes/chance-status-on-hit.ts",
    },
    synonyms: ["shield dust", "effect shield", "immune to extra effects", "covert cloak"],
  },
  {
    id: "not-self-target",
    label: "Not when the target is the user itself",
    why: "An effect meant for an opponent must never land on the user; that would be a bug.",
    requires: ["other"],
    formula: {
      expr: "holder !== other",
      source:
        "src/data/abilities/ab-attrs.ts PostAttackApplyBattlerTagAbAttr.guards, PostAttackAbilityGiveAbAttr.guards",
    },
    synonyms: ["self target", "not myself", "another pokemon", "different target"],
  },
  {
    id: "status-set-by-a-pokemon",
    label: "Only when a Pokemon caused the status",
    why: "There is nobody to pass the status back to; running the effect would be a bug.",
    requires: ["other"],
    formula: {
      expr: "Boolean(other)  (the source Pokemon of the status)",
      source: "src/data/abilities/ab-attrs.ts SynchronizeStatusAbAttr.guards",
    },
    synonyms: ["caused by a pokemon", "status source", "not from weather", "not from hazards"],
  },
  {
    id: "hit-connected",
    label: "Only when the hit connected",
    why: "A move that missed or was blocked did nothing to react to; reacting would be a bug.",
    requires: ["hitResult"],
    formula: {
      expr: "hitResult < HitResult.NO_EFFECT  (EFFECTIVE, SUPER_EFFECTIVE, NOT_VERY_EFFECTIVE or ONE_HIT_KO)",
      source:
        "src/data/elite-redux/archetypes/post-attack-set-field-by-type.ts landedDamagingHit; MoveEffectPhase dealsDamage",
    },
    synonyms: ["hit landed", "not a miss", "not blocked", "not immune", "move connected"],
  },
  {
    id: "hit-connected-on-another-pokemon",
    label: "Only when the hit connected on a different Pokemon",
    why: "A miss, a block or a hit on the user itself is not an attack on a foe; reacting would be a bug.",
    requires: ["other", "hitResult"],
    formula: {
      expr: "holder !== other && hitResult < HitResult.NO_EFFECT",
      source: "src/data/elite-redux/archetypes/ate-conditional.ts guards",
    },
    synonyms: ["hit another", "connected on a foe", "not self hit", "real hit"],
  },
  {
    id: "hit-dealt-damage",
    label: "Only when the hit took away more than 0 HP",
    why: "Reacting to a hit that did no damage (a block, a Substitute, a status move) would be a bug.",
    requires: ["damage"],
    formula: {
      expr: "damage > 0",
      source:
        "src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts BallasterAbAttr.guards clause 1; newcomer-signature-mechanics.ts:263",
    },
    synonyms: ["real damage", "took damage", "damage above zero", "hurt"],
  },
  {
    id: "hit-on-another-living-target",
    label: "Only when a different, standing Pokemon was hurt",
    why: "Reacting to damage on the user itself or on a Pokemon that already fainted would be a bug.",
    requires: ["other", "damage"],
    formula: {
      expr: "holder !== other && !other.isFainted() && damage > 0",
      source: "src/data/elite-redux/abilities/puppet-strings.ts PuppetStringsAbAttr.guards",
    },
    synonyms: ["hurt another", "target still standing", "not fainted", "living target"],
  },
  {
    id: "after-my-final-hit",
    label: "Only after the last hit of my own multi-hit move",
    why: "Reacting to every strike of my own multi-hit move would trigger early and repeatedly.",
    requires: ["holder"],
    formula: {
      expr: "!(holder.turnData.hitsLeft > 1)  (the holder is the attacker for an after-my-attack trigger)",
      source:
        "src/data/elite-redux/abilities/newcomer-signature-mechanics.ts SkyhookAbAttr.guards; fakemon-pitch-mechanics.ts PhoenixFoliageUseFormChangeAbAttr.guards",
    },
    synonyms: ["last strike", "final hit", "multi hit", "my last hit"],
  },
  {
    id: "knocked-out-by-a-move",
    label: "Only when a Pokemon's move knocked me out",
    why: "The faint can also come from poison, weather or recoil, with no attacker to react to; triggering would be a bug.",
    requires: ["other", "move"],
    formula: {
      expr: "!!attacker && !!move",
      source:
        "src/phases/faint-phase.ts:256 (dispatches without attacker and move after indirect damage); bernerd-roster-mechanics.ts MutualDestructionPostFaintAbAttr.guards",
    },
    synonyms: ["killed by a move", "direct knock out", "not indirect", "faint by attack"],
  },
  {
    id: "attacker-still-standing",
    label: "Not when the attacker has already fainted",
    why: "Retaliating against a Pokemon that is already out of the fight would be a bug.",
    requires: ["other"],
    formula: {
      expr: "!attacker.isFainted()",
      source:
        "src/data/elite-redux/abilities/bernerd-roster-mechanics.ts:419 MutualDestructionPostFaintAbAttr.guards clause 3",
    },
    synonyms: ["attacker alive", "foe not fainted", "attacker standing", "not already fainted"],
  },
  {
    id: "credited-with-the-knock-out",
    label: "Only when I knocked the fainted Pokemon out myself",
    why: "The game tells every Pokemon on the field when something faints; without this rule bystanders would heal and loot.",
    requires: ["other"],
    formula: {
      expr: "victim.turnData.attacksReceived?.[0]?.sourceId === holder.id",
      source: "src/data/elite-redux/archetypes/lifesteal.ts:82 koLandedByDirectHit",
    },
    synonyms: ["my knock out", "I fainted it", "kill credit", "direct knock out", "not a bystander"],
  },
  {
    id: "not-protected-from-indirect-damage",
    label: "Not when I am protected from indirect damage",
    why: "Chip damage must never get through an ability that promises to block all of it; that would be a bug.",
    requires: ["holder"],
    formula: {
      expr: '!holder.hasAbilityWithAttr("BlockNonDirectDamageAbAttr")',
      source: "src/data/abilities/ab-attrs.ts PostWeatherLapseDamageAbAttr.canApply",
    },
    synonyms: ["magic guard", "no chip damage", "indirect damage block", "weather damage block"],
  },
  // ---- Library completion pass (wave B) ------------------------------------------------------
  {
    id: "not-simulated",
    label: "Not while the game is only previewing",
    why: "A preview must never change the battle; acting during one would roll dice or write memory for nothing.",
    requires: ["simulated"],
    formula: {
      expr: "!simulated",
      source:
        "src/data/elite-redux/abilities/fakemon-pitch-mechanics.ts:1812 (SouthernCrossPunch guards), 1890, 2136, 2176, 2220, 2263; src/data/abilities/ab-attrs.ts:7906 (BypassSpeedChanceAbAttr.canApply)",
    },
    synonyms: ["not a preview", "real battle only", "not simulated", "not while previewing"],
  },
  {
    id: "another-holder-keeps-weather",
    label: "Not while another Pokemon on the field keeps this weather up",
    why: "Ending an extreme weather that another Pokemon on the field still holds up would be a bug.",
    requires: ["holder"],
    formula: {
      expr: '!getField(true).some(p => p !== holder && p.getAbilityAttrs("PreLeaveFieldClearWeatherAbAttr").some(a => a.weatherType === arena.weatherType))',
      source:
        "src/data/abilities/ab-attrs.ts:4203-4210 PreLeaveFieldClearWeatherAbAttr.canApply (the class's own weather equals the current weather once its first clause passed)",
    },
    synonyms: ["delta stream", "primordial sea", "desolate land", "weather keeper", "other holder"],
  },
  {
    id: "foe-can-be-trapped",
    label: "Not when the foe is a Ghost type or can always run away",
    why: "Ghost types and Run Away users can never be trapped; trapping them would be a bug.",
    requires: ["other"],
    formula: {
      expr: '!other.isOfType(GHOST, true, true) && !other.hasAbilityWithAttr("RunSuccessAbAttr")',
      source: "src/data/abilities/ab-attrs.ts:6871-6875 ArenaTrapAbAttr.canApply clauses 2 and 3",
    },
    synonyms: ["ghost escapes", "run away", "cannot be trapped", "trap immunity", "shadow tag"],
  },
];

export const GUARD_REGISTRY: readonly GuardDef[] = BASE_GUARDS.map(def => withVocabularyText(def));

const BY_ID: ReadonlyMap<string, GuardDef> = new Map(GUARD_REGISTRY.map(def => [def.id, def]));

export function getGuard(id: string): GuardDef | undefined {
  return BY_ID.get(id);
}
