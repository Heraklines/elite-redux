/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. Hand-written (spec section 1.2, Step 0).
//
// WHEN_REGISTRY replaces the HOOK_TYPES set of runtime-components.ts. It is seeded with the 32
// existing hooks (`legacyHookId`) plus a WHEN for every dispatch key a human assigned in
// dispatch-keys.ts. `dispatchKey` is the exact class string passed to applyAbAttrs /
// applyFilteredAbAttrs; `alsoDispatchKeys` lists further keys that fire at the very same moment
// with the very same parameter shape.

import type { SlotId } from "./slots";

export type WhenKind = "event" | "calc" | "while-active";

export interface WhenDef {
  readonly id: string;
  readonly kind: WhenKind;
  /** The class string handed to applyAbAttrs; `null` only for while-active flags (never dispatched). */
  readonly dispatchKey: string | null;
  /** Further dispatch keys with the identical moment and parameter shape. */
  readonly alsoDispatchKeys?: readonly string[];
  /** while-active only: the flag classes that are checked by presence (instanceof / hasAttr). */
  readonly flagKeys?: readonly string[];
  readonly provides: readonly SlotId[];
  readonly label: string;
  readonly group: string;
  /** Calc triggers: the frame value the attr may change. */
  readonly modifies?: string;
  /** The V1 hook id this WHEN replaces (the class name `abilityStudioRuntimeHookId` returns). */
  readonly legacyHookId?: string;
  /** True when the key is only an ancestor class that the engine never dispatches directly. */
  readonly baseClassOnly?: boolean;
  readonly synonyms?: readonly string[];
  /**
   * True when evaluate/compile-composition.ts can hang a `composition` rule on this WHEN. The other
   * WHENs are listed so staff and the AI can already name them; composition validation rejects them
   * with a plain-language message until a class agent verifies the engine parameter shape.
   */
  readonly composable?: boolean;
}

type Slots = readonly SlotId[];

const H: SlotId = "holder";
const O: SlotId = "other";
const M: SlotId = "move";
const MU: SlotId = "moveUser";
const D: SlotId = "damage";
const HR: SlotId = "hitResult";
const ST: SlotId = "stat";
const SG: SlotId = "stages";
const W: SlotId = "weather";
const T: SlotId = "terrain";
const S: SlotId = "status";
const TG: SlotId = "tag";
const A: SlotId = "ally";
const SIM: SlotId = "simulated";
const HITS: SlotId = "hits";

function event(
  id: string,
  dispatchKey: string,
  provides: Slots,
  label: string,
  group: string,
  extra: Partial<WhenDef> = {},
): WhenDef {
  return { id, kind: "event", dispatchKey, provides, label, group, ...extra };
}

function calc(
  id: string,
  dispatchKey: string,
  provides: Slots,
  label: string,
  group: string,
  modifies: string,
  extra: Partial<WhenDef> = {},
): WhenDef {
  return { id, kind: "calc", dispatchKey, provides, label, group, modifies, ...extra };
}

export const WHEN_REGISTRY: readonly WhenDef[] = [
  // ---- Entry and exit -------------------------------------------------------------------
  event("event.on-entry", "PostSummonAbAttr", [H, SIM], "When I enter the battle", "Entry and exit", {
    legacyHookId: "PostSummonAbAttr",
    synonyms: ["switch in", "send out", "on summon"],

    composable: true,
  }),
  event(
    "event.ally-entered",
    "CommanderAbAttr",
    [H, A, SIM],
    "When an ally enters the battle or is revived",
    "Entry and exit",
    { synonyms: ["ally switch in", "partner arrives", "ally sent out", "ally revived"] },
  ),
  event(
    "event.foe-enters",
    "MudballReactiveAbAttr",
    [H, O, SIM],
    "When a foe enters the field",
    "Entry and exit",
    { synonyms: ["foe switches in", "enemy sent out", "opponent arrives", "when the foe appears"] },
  ),
  event("event.before-entry", "PreSummonAbAttr", [H], "Just before I enter the battle", "Entry and exit", {
    legacyHookId: "PreSummonAbAttr",
  }),
  event("event.battle-start", "PostBattleInitAbAttr", [H], "When a battle begins", "Entry and exit", {
    legacyHookId: "PostBattleInitAbAttr",
    synonyms: ["start of battle", "battle init"],
  }),
  event("event.after-battle", "PostBattleAbAttr", [H], "After the battle ends", "Entry and exit", {
    legacyHookId: "PostBattleAbAttr",
    synonyms: ["end of battle", "post battle"],
  }),
  event("event.switch-out", "PreSwitchOutAbAttr", [H, SIM], "When I switch out", "Entry and exit", {
    legacyHookId: "PreSwitchOutAbAttr",
    synonyms: ["recall", "withdraw"],
  }),
  event("event.leave-field", "PreLeaveFieldAbAttr", [H, SIM], "When I leave the field", "Entry and exit", {
    legacyHookId: "PreLeaveFieldAbAttr",
    synonyms: ["leave battle", "flee", "faint or switch"],
  }),
  event("event.faint", "PostFaintAbAttr", [H, O, M, MU, HR, SIM], "When I faint", "Entry and exit", {
    legacyHookId: "PostFaintAbAttr",
    synonyms: ["knocked out", "die", "last words"],

    composable: true,
  }),

  // ---- Turn -----------------------------------------------------------------------------
  event("event.end-of-turn", "PostTurnAbAttr", [H, SIM], "At the end of every turn", "Turn", {
    legacyHookId: "PostTurnAbAttr",
    synonyms: ["each turn", "end turn", "residual"],

    composable: true,
  }),
  event(
    "event.turn-start",
    "PreemptivePriorityCounterAbAttr",
    [H],
    "At the start of the turn, before anyone moves",
    "Turn",
    {
      synonyms: ["start of turn", "turn begins", "before moves", "after commands are chosen", "surprise"],
    },
  ),
  event("event.wake-up", "PostWakeUpAbAttr", [H], "When I wake up", "Turn", { legacyHookId: "PostWakeUpAbAttr" }),
  event("event.flinched", "FlinchEffectAbAttr", [H, SIM], "When I flinch", "Turn", {
    legacyHookId: "FlinchEffectAbAttr",
  }),
  event(
    "event.berry-phase-end",
    "CudChewConsumeBerryAbAttr",
    [H],
    "When the berries of the turn have been eaten",
    "Turn",
    {
      synonyms: ["after berry phase", "berry meal ends", "cud chew moment"],
    },
  ),
  event("event.berry-eaten", "HealFromBerryUseAbAttr", [H], "After I eat a berry", "Turn", {
    synonyms: ["berry consumed", "nom"],
  }),

  // ---- Attacking ------------------------------------------------------------------------
  event("event.before-i-use-move", "PokemonTypeChangeAbAttr", [H, O, M, MU], "Just before I use a move", "Attacking", {
    synonyms: ["move starts", "before attacking"],
  }),
  event("event.my-move-starts", "ExecutedMoveAbAttr", [H], "When my move starts to execute", "Attacking"),
  event("event.after-my-hit", "PostAttackAbAttr", [H, O, M, MU, D, HR, SIM], "After my attack lands", "Attacking", {
    legacyHookId: "PostAttackAbAttr",
    synonyms: ["on hit", "after attacking", "after damaging", "when I hit"],

    composable: true,
  }),
  event("event.on-ko", "PostKnockOutAbAttr", [H, O, SIM], "When I knock out a Pokemon", "Attacking", {
    legacyHookId: "PostKnockOutAbAttr",
    synonyms: ["kill", "ko", "defeat a foe"],

    composable: true,
  }),
  event("event.on-win", "PostVictoryAbAttr", [H, SIM], "When I win the fight", "Attacking", {
    legacyHookId: "PostVictoryAbAttr",
    synonyms: ["victory", "battle won"],
  }),
  event("event.after-any-move", "PostMoveUsedAbAttr", [H, O, M, MU, SIM], "After anyone uses a move", "Attacking", {
    legacyHookId: "PostMoveUsedAbAttr",
    synonyms: ["any move", "after a move"],
  }),
  event(
    "event.after-inflicting-status",
    "ConfusionOnStatusEffectAbAttr",
    [H, O, S],
    "After I inflict a status",
    "Attacking",
    {
      synonyms: ["status landed", "after poisoning", "after burning"],
    },
  ),

  // ---- Being hit ------------------------------------------------------------------------
  event("event.after-hit", "PostDefendAbAttr", [H, O, M, MU, D, HR, SIM], "After I am hit", "Being hit", {
    legacyHookId: "PostDefendAbAttr",
    synonyms: ["when hit", "on being hit", "after defending", "contact"],

    composable: true,
  }),
  event("event.after-taking-damage", "PostDamageAbAttr", [H, O, D, SIM], "After I take any damage", "Being hit", {
    legacyHookId: "PostDamageAbAttr",
    synonyms: ["hp dropped", "lose hp", "damaged", "below half", "wimp out"],

    composable: true,
  }),
  event(
    "event.after-crit-taken",
    "PostReceiveCritStatStageChangeAbAttr",
    [H, O, M, MU, D, HR, SIM],
    "When I take a critical hit",
    "Being hit",
    { synonyms: ["crit received", "struck by a crit"] },
  ),
  event(
    "event.before-hit-lands",
    "PreHitResistTypeChangeAbAttr",
    [H, O, M, MU],
    "Just before a hit lands on me",
    "Being hit",
  ),
  event("event.got-status", "PostSetStatusAbAttr", [H, O, S, SIM], "When I get a status condition", "Being hit", {
    legacyHookId: "PostSetStatusAbAttr",
    synonyms: ["afflicted", "poisoned", "burned", "paralyzed"],
  }),
  event("event.item-lost", "PostItemLostAbAttr", [H, O], "When I lose my held item", "Being hit", {
    legacyHookId: "PostItemLostAbAttr",
    synonyms: ["item stolen", "item knocked off", "item consumed"],
  }),
  event(
    "event.intimidated",
    "PostIntimidateStatStageChangeAbAttr",
    [H, ST, SG, SIM],
    "When Intimidate hits me",
    "Being hit",
    {
      synonyms: ["scared", "intimidate reaction"],
    },
  ),

  // ---- Field ----------------------------------------------------------------------------
  event("event.weather-changed", "PostWeatherChangeAbAttr", [H, W, SIM], "When the weather changes", "Field", {
    legacyHookId: "PostWeatherChangeAbAttr",
  }),
  event(
    "event.weather-each-turn",
    "PostWeatherLapseAbAttr",
    [H, W, SIM],
    "Each turn while weather is active",
    "Field",
    {
      legacyHookId: "PostWeatherLapseAbAttr",
    },
  ),
  event("event.terrain-changed", "PostTerrainChangeAbAttr", [H, T, SIM], "When the terrain changes", "Field", {
    alsoDispatchKeys: ["TerrainEventTypeChangeAbAttr"],
    legacyHookId: "PostTerrainChangeAbAttr",
  }),
  event("event.biome-changed", "PostBiomeChangeAbAttr", [H, SIM], "When the biome changes", "Field", {
    legacyHookId: "PostBiomeChangeAbAttr",
  }),

  // ---- Stat stages ----------------------------------------------------------------------
  event(
    "event.stat-changed",
    "PostStatStageChangeAbAttr",
    [H, O, ST, SG, SIM],
    "When one of my stats changes",
    "Stat stages",
    {
      legacyHookId: "PostStatStageChangeAbAttr",
      synonyms: ["stat boosted", "stat dropped", "stat stage"],
    },
  ),
  event(
    "event.ally-stat-changed",
    "PostAllyStatStageChangeAbAttr",
    [H, A, ST, SG, SIM],
    "When my ally's stat changes",
    "Stat stages",
    {
      legacyHookId: "PostAllyStatStageChangeAbAttr",
    },
  ),
  event("event.foe-raised-stat", "StatStageChangeCopyAbAttr", [H, ST, SG], "When a foe raises a stat", "Stat stages", {
    synonyms: ["opportunist", "copy boost", "foe boosted"],
  }),
  event("event.foe-switches-out", "OnOpponentSwitchOutAbAttr", [H, O], "When a foe switches out", "Entry and exit", {
    synonyms: ["pursuit", "foe leaves the field", "opponent withdraws", "punish switching", "tag"],
  }),

  // ---- Move flow ------------------------------------------------------------------------
  calc(
    "calc.redirect-move",
    "RedirectMoveAbAttr",
    [H, O, M, MU],
    "While the game picks who a move targets",
    "Move flow",
    "targetIndex",
    {
      legacyHookId: "RedirectMoveAbAttr",
      synonyms: ["redirect", "lightning rod", "storm drain", "draw attacks"],
    },
  ),
  calc(
    "calc.priority",
    "ChangeMovePriorityAbAttr",
    [H, M, MU],
    "While the game calculates my move's priority",
    "Move flow",
    "priority",
    {
      alsoDispatchKeys: ["ChangeMovePriorityInBracketAbAttr"],
      synonyms: ["gale wings", "prankster", "go first"],

      composable: true,
    },
  ),
  calc(
    "calc.speed-bypass",
    "BypassSpeedChanceAbAttr",
    [H],
    "While the game decides if I jump the turn order",
    "Move flow",
    "bypass",
    {
      alsoDispatchKeys: ["PreventBypassSpeedChanceAbAttr"],
      synonyms: ["quick claw", "quick draw"],
    },
  ),
  calc(
    "calc.trap-check",
    "CheckTrappedAbAttr",
    [H, O],
    "While the game checks if a foe can escape",
    "Move flow",
    "trapped",
    {
      synonyms: ["shadow tag", "arena trap", "magnet pull", "trap"],
    },
  ),
  calc("calc.run-chance", "RunSuccessAbAttr", [H], "While the game rolls my chance to run away", "Move flow", "chance"),
  calc(
    "calc.double-battle-chance",
    "DoubleBattleChanceAbAttr",
    [H],
    "While the game rolls the chance of a double battle",
    "Move flow",
    "chance",
    { synonyms: ["double battle", "wild double encounter", "encounter chance"] },
  ),
  calc("calc.weight", "WeightMultiplierAbAttr", [H], "While the game calculates my weight", "Move flow", "weight", {
    synonyms: ["heavy metal", "light metal"],
  }),
  calc(
    "calc.burn-damage",
    "ReduceBurnDamageAbAttr",
    [H],
    "While the game calculates burn damage on me",
    "Move flow",
    "burnDamage",
  ),
  calc(
    "cancel.burn-attack-cut",
    "BypassBurnDamageReductionAbAttr",
    [H, SIM],
    "While the game checks if my burn or frostbite weakens my attacks",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["guts", "rage point", "burn attack drop", "ignore burn"],
    },
  ),
  calc(
    "calc.status-duration",
    "ReduceStatusEffectDurationAbAttr",
    [H, S],
    "While the game calculates how long my status lasts",
    "Move flow",
    "duration",
    {
      synonyms: ["early bird", "shorter sleep"],
    },
  ),
  calc(
    "calc.berry-effect",
    "DoubleBerryEffectAbAttr",
    [H],
    "While the game calculates a berry's healing",
    "Move flow",
    "effectValue",
    {
      synonyms: ["ripen", "double berry"],
    },
  ),
  calc(
    "calc.berry-threshold",
    "ReduceBerryUseThresholdAbAttr",
    [H],
    "While the game checks if my berry should be eaten",
    "Move flow",
    "hpRatioRequired",
    {
      synonyms: ["gluttony", "eat berry earlier"],
    },
  ),

  // ---- Damage and power -----------------------------------------------------------------
  calc(
    "calc.move-power",
    "MovePowerBoostAbAttr",
    [H, O, M, MU, SIM],
    "While the game calculates a move's power",
    "Damage and power",
    "power",
    {
      alsoDispatchKeys: [
        "VariableMovePowerAbAttr",
        "FieldMoveTypePowerBoostAbAttr",
        "UserFieldMoveTypePowerBoostAbAttr",
        "AllyMoveCategoryPowerBoostAbAttr",
      ],
      synonyms: ["base power", "boost moves", "power up"],

      composable: true,
    },
  ),
  calc(
    "calc.damage-dealt",
    "MoveDamageBoostAbAttr",
    [H, O, M, MU, D, SIM],
    "While the game calculates damage I deal",
    "Damage and power",
    "damage",
    {
      synonyms: ["damage output", "deal more damage"],

      composable: true,
    },
  ),
  calc(
    "calc.damage-taken",
    "ReceivedMoveDamageMultiplierAbAttr",
    [H, O, M, MU, D, SIM],
    "While the game calculates damage I take",
    "Damage and power",
    "damage",
    {
      alsoDispatchKeys: ["AlliedFieldDamageReductionAbAttr", "PreDefendFullHpEndureAbAttr"],
      synonyms: ["resist", "damage reduction", "half damage", "tank"],

      composable: true,
    },
  ),
  calc(
    "calc.stab",
    "StabBoostAbAttr",
    [H, SIM],
    "While the game calculates same-type attack bonus",
    "Damage and power",
    "stab",
    {
      synonyms: ["stab", "same type bonus"],
    },
  ),
  calc(
    "calc.crit-stage",
    "BonusCritAbAttr",
    [H],
    "While the game calculates critical hit stage",
    "Damage and power",
    "critStage",
  ),
  calc(
    "calc.crit-multiplier",
    "MultCritAbAttr",
    [H, SIM],
    "While the game calculates critical hit damage",
    "Damage and power",
    "critMultiplier",
  ),
  calc(
    "calc.crit-roll",
    "ConditionalCritAbAttr",
    [H, O, M, MU],
    "While the game decides if a hit is critical",
    "Damage and power",
    "isCritical",
    {
      synonyms: ["always crit", "guaranteed crit"],
    },
  ),
  calc(
    "calc.hit-count",
    "AddSecondStrikeAbAttr",
    [H, O, M, MU, HITS],
    "While the game decides how many times a move hits",
    "Damage and power",
    "hitCount",
    {
      alsoDispatchKeys: ["AllAttacksMultiHitAbAttr"],
      synonyms: ["multi hit", "extra strike", "parental bond", "hit twice"],
    },
  ),
  calc(
    "calc.max-multi-hit",
    "MaxMultiHitAbAttr",
    [H],
    "While the game rolls how many hits a multi-hit move gets",
    "Damage and power",
    "hits",
    {
      synonyms: ["skill link", "always max hits"],
    },
  ),
  calc(
    "calc.accuracy",
    "SetMoveAccuracyAbAttr",
    [H, M, MU],
    "While the game calculates my move's accuracy",
    "Damage and power",
    "accuracy",
    {
      synonyms: ["always hit", "no guard", "accuracy boost"],
    },
  ),
  calc(
    "calc.incoming-accuracy",
    "WonderSkinAbAttr",
    [H, M],
    "While the game calculates accuracy against me",
    "Damage and power",
    "accuracy",
    {
      synonyms: ["evasion", "wonder skin"],
    },
  ),
  calc(
    "calc.effect-chance",
    "MoveEffectChanceMultiplierAbAttr",
    [H, M],
    "While the game calculates my move's effect chance",
    "Damage and power",
    "effectChance",
    {
      synonyms: ["serene grace", "secondary effect chance"],
    },
  ),
  calc(
    "calc.incoming-effect-chance",
    "IgnoreMoveEffectsAbAttr",
    [H, M],
    "While the game calculates effect chance against me",
    "Damage and power",
    "effectChance",
    {
      alsoDispatchKeys: ["UserFieldIgnoreMoveEffectsAbAttr"],
      synonyms: ["shield dust", "block secondary effects"],
    },
  ),
  calc(
    "calc.damage-roll",
    "EnemyMinDamageRollAbAttr",
    [H, SIM],
    "While the game rolls the random damage spread",
    "Damage and power",
    "rollMultiplier",
  ),
  calc(
    "calc.weather-type-debuff",
    "IgnoreWeatherTypeDebuffAbAttr",
    [H, M],
    "While the game applies weather damage changes to my move",
    "Damage and power",
    "weatherMultiplier",
  ),

  // ---- Stats ----------------------------------------------------------------------------
  calc(
    "calc.stat-value",
    "StatMultiplierAbAttr",
    [H, M, ST],
    "While the game calculates one of my stats",
    "Stats",
    "statValue",
    {
      alsoDispatchKeys: ["AllyStatMultiplierAbAttr"],
      synonyms: ["stat boost", "attack up", "speed up", "defense up"],
    },
  ),
  calc(
    "calc.foe-stat-value",
    "FieldMultiplyStatAbAttr",
    [H, O, ST],
    "While the game calculates a foe's stat",
    "Stats",
    "statValue",
    {
      synonyms: ["lower foe stat", "aura"],
    },
  ),
  calc(
    "calc.ally-stat-aura",
    "PersistentFieldAuraAbAttr",
    [H, O, ST],
    "While the game calculates a stat of a Pokemon on my side",
    "Stats",
    "statValue",
    {
      synonyms: ["ally aura", "team stat boost", "boost my allies", "party aura", "field aura", "rat king"],
    },
  ),
  calc(
    "calc.recoil-taken",
    "RecoilDamageMultiplierAbAttr",
    [H],
    "While the game calculates the recoil I take",
    "Damage and power",
    "recoilMultiplier",
    {
      synonyms: ["recoil", "crash damage", "recoil damage", "jump kick crash", "rock head"],
    },
  ),
  calc(
    "calc.ignore-stat-stages",
    "IgnoreOpponentStatStagesAbAttr",
    [H, O, ST],
    "While the game applies the foe's stat stages",
    "Stats",
    "ignored",
    {
      synonyms: ["unaware", "ignore boosts"],
    },
  ),
  calc(
    "calc.attack-stat",
    "AttackStatSubstituteAbAttr",
    [H, O, M, MU],
    "While the game picks the stat my attack uses",
    "Stats",
    "statValue",
    {
      alsoDispatchKeys: ["GritAttackStatAbAttr"],
      baseClassOnly: true,
      synonyms: ["body press", "attack with another stat", "swap attack stat", "which stat hits"],
    },
  ),
  calc(
    "calc.move-category",
    "LowerOffenseMoveCategoryAbAttr",
    [H, M, MU],
    "While the game decides if my move is physical or special",
    "Damage and power",
    "moveCategory",
    { synonyms: ["physical or special", "move category", "change category", "use the other category", "subversion"] },
  ),
  calc(
    "calc.my-attack-matchup",
    "BoneMoveTypeChartAbAttr",
    [H, O, M, MU],
    "While the game calculates how well my attack matches the target's types",
    "Type",
    "typeMultiplier",
    {
      alsoDispatchKeys: ["MiracleBladeTypeChartAbAttr", "WeatherGroundAirborneAbAttr"],
      baseClassOnly: true,
      synonyms: ["bone zone", "my type matchup", "immunity ignored", "resisted hits hit harder"],
    },
  ),
  calc(
    "calc.always-hit-check",
    "ConditionalAlwaysHitAbAttr",
    [H, O, M, MU],
    "While the game checks whether my move can miss",
    "Damage and power",
    "accuracy",
    {
      baseClassOnly: true,
      synonyms: ["never miss", "no guard", "sure hit", "perfect accuracy on", "cannot miss"],
    },
  ),
  calc(
    "calc.defensive-stat-substitute",
    "DefensiveStatSubstituteAbAttr",
    [H],
    "While the game picks my defensive stat",
    "Stats",
    "statValue",
  ),
  calc(
    "calc.defensive-stat-pick",
    "CritUseLowerDefensiveStatAbAttr",
    [H, O],
    "While the game picks the foe's defensive stat",
    "Stats",
    "statValue",
    {
      alsoDispatchKeys: ["LowerDefensiveStatVsStatusedFoeAbAttr"],
    },
  ),
  calc(
    "calc.stage-change-amount",
    "StatStageChangeMultiplierAbAttr",
    [H],
    "While the game calculates how far my stats move",
    "Stats",
    "numStages",
    {
      synonyms: ["simple", "contrary", "double stat changes"],
    },
  ),

  // ---- Type -----------------------------------------------------------------------------
  calc(
    "calc.move-type",
    "MoveTypeChangeAbAttr",
    [H, O, M, MU],
    "While the game decides a move's type",
    "Type",
    "moveType",
    {
      synonyms: ["aerilate", "pixilate", "change move type", "normalize"],
    },
  ),
  calc(
    "calc.type-matchup",
    "FullHpResistTypeAbAttr",
    [H, O, M],
    "While the game calculates type matchup against me",
    "Type",
    "typeMultiplier",
    {
      synonyms: ["resist type", "tera shell", "filter"],
    },
  ),
  calc(
    "calc.move-immunity",
    "TypeImmunityAbAttr",
    [H, O, M],
    "While the game checks whether a move can hit me",
    "Type",
    "cancelled",
    {
      alsoDispatchKeys: ["MoveImmunityAbAttr", "FieldPriorityMoveImmunityAbAttr"],
      synonyms: ["immune", "immunity", "absorb", "levitate", "ground immune", "volt absorb"],

      composable: true,
    },
  ),
  calc(
    "calc.ignore-type-immunity",
    "IgnoreTypeImmunityAbAttr",
    [H],
    "While the game checks the foe's type immunity",
    "Type",
    "cancelled",
    {
      synonyms: ["scrappy", "hit ghost types", "ignore immunity"],
    },
  ),
  calc(
    "calc.my-type-chart-override",
    "OffensiveTypeChartOverrideAbAttr",
    [H],
    "While the game works out how well my attacks match the target's types",
    "Type",
    "typeMultiplier",
    {
      synonyms: ["super effective against", "hit immune types", "change type matchup", "corrosion", "molten down"],
    },
  ),
  calc(
    "calc.ability-bypass",
    "MoveAbilityBypassAbAttr",
    [H, M],
    "While the game decides whether my move ignores abilities",
    "Type",
    "cancelled",
    {
      synonyms: ["mold breaker", "ignore abilities"],
    },
  ),

  // ---- Cancel checks --------------------------------------------------------------------
  calc(
    "cancel.stat-drop",
    "PreStatStageChangeAbAttr",
    [H, ST, SG, O],
    "While the game checks if a stat drop can land on me",
    "Cancel checks",
    "cancelled",
    {
      legacyHookId: "PreStatStageChangeAbAttr",
      baseClassOnly: true,
      synonyms: ["clear body", "hyper cutter", "block stat drop"],
    },
  ),
  calc(
    "cancel.stat-protect",
    "ProtectStatAbAttr",
    [H, ST, SG],
    "While the game checks if my stat is protected",
    "Cancel checks",
    "cancelled",
    {
      alsoDispatchKeys: ["SelfStatDropImmunityAbAttr", "UserFieldSelfStatDropImmunityAbAttr"],
      synonyms: ["keen eye", "big pecks", "stat protection"],
    },
  ),
  calc(
    "cancel.stat-protect-field",
    "ConditionalUserFieldProtectStatAbAttr",
    [H, ST],
    "While the game checks if my side's stat is protected",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["flower veil", "side protection"],
    },
  ),
  calc(
    "cancel.stat-reflect",
    "ReflectStatStageChangeAbAttr",
    [H, ST, SG, O],
    "While the game checks if a stat drop is reflected",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["mirror armor", "reflect stat drop"],
    },
  ),
  calc(
    "cancel.intimidate",
    "IntimidateImmunityAbAttr",
    [H, ST, SG, SIM],
    "While the game checks if Intimidate lands on me",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["inner focus", "own tempo", "oblivious", "scrappy"],
    },
  ),
  calc(
    "cancel.status",
    "PreSetStatusAbAttr",
    [H, S, O],
    "While the game checks if a status can land on me",
    "Cancel checks",
    "cancelled",
    {
      legacyHookId: "PreSetStatusAbAttr",
      baseClassOnly: true,
      synonyms: ["status immunity", "limber", "insomnia"],
    },
  ),
  calc(
    "cancel.status-immunity",
    "StatusEffectImmunityAbAttr",
    [H, S],
    "While the game checks my status immunity",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["immune to burn", "immune to poison", "immune to sleep"],
    },
  ),
  calc(
    "cancel.status-immunity-field",
    "UserFieldStatusEffectImmunityAbAttr",
    [H, S, O],
    "While the game checks my side's status immunity",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["sweet veil", "pastel veil", "ally status immunity"],
    },
  ),
  calc(
    "cancel.status-type-immunity",
    "IgnoreTypeStatusEffectImmunityAbAttr",
    [H, S],
    "While the game checks type-based status immunity",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["corrosion", "poison steel types"],
    },
  ),
  calc(
    "cancel.battle-effect",
    "PreApplyBattlerTagAbAttr",
    [H, TG, O],
    "While the game checks if a battle effect can land on me",
    "Cancel checks",
    "cancelled",
    {
      legacyHookId: "PreApplyBattlerTagAbAttr",
      baseClassOnly: true,
      synonyms: ["confusion immunity", "volatile immunity", "flinch immunity"],
    },
  ),
  calc(
    "cancel.battle-effect-immunity",
    "BattlerTagImmunityAbAttr",
    [H, TG],
    "While the game checks my battle-effect immunity",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["immune to confusion", "immune to infatuation", "oblivious"],
    },
  ),
  calc(
    "cancel.battle-effect-immunity-field",
    "UserFieldBattlerTagImmunityAbAttr",
    [H, TG, O],
    "While the game checks my side's battle-effect immunity",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["aroma veil", "ally effect immunity"],
    },
  ),
  calc(
    "cancel.weather-damage",
    "PreWeatherDamageAbAttr",
    [H, W],
    "While the game checks if weather damage hurts me",
    "Cancel checks",
    "cancelled",
    {
      legacyHookId: "PreWeatherDamageAbAttr",
      synonyms: ["sand veil", "magic guard", "overcoat", "weather immunity"],
    },
  ),
  calc(
    "cancel.weather-effect",
    "PreWeatherEffectAbAttr",
    [H, W],
    "While the game checks if weather affects me",
    "Cancel checks",
    "cancelled",
    {
      legacyHookId: "PreWeatherEffectAbAttr",
      baseClassOnly: true,
    },
  ),
  calc(
    "cancel.weather-suppress",
    "SuppressWeatherEffectAbAttr",
    [H, W],
    "While the game checks if weather is suppressed",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["cloud nine", "air lock"],
    },
  ),
  calc(
    "cancel.interaction",
    "CancelInteractionAbAttr",
    [H],
    "While the game checks if an interaction is blocked",
    "Cancel checks",
    "cancelled",
    {
      legacyHookId: "CancelInteractionAbAttr",
      baseClassOnly: true,
    },
  ),
  calc(
    "cancel.crit",
    "BlockCritAbAttr",
    [H],
    "While the game checks if I can be critically hit",
    "Cancel checks",
    "blockCrit",
    {
      synonyms: ["battle armor", "shell armor", "no crits"],
    },
  ),
  calc(
    "cancel.item-theft",
    "BlockItemTheftAbAttr",
    [H],
    "While the game checks if my item can be stolen",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["sticky hold", "item lock"],
    },
  ),
  calc(
    "cancel.indirect-damage",
    "BlockNonDirectDamageAbAttr",
    [H],
    "While the game checks if indirect damage hurts me",
    "Cancel checks",
    "cancelled",
    {
      alsoDispatchKeys: ["BlockRecoilDamageAttr", "BlockStatusDamageAbAttr"],
      synonyms: ["magic guard", "rock head", "no recoil"],
    },
  ),
  calc(
    "cancel.one-hit-ko",
    "BlockOneHitKOAbAttr",
    [H],
    "While the game checks if a one-hit KO works on me",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["sturdy", "ohko immunity"],
    },
  ),
  calc(
    "cancel.forced-switch",
    "ForceSwitchOutImmunityAbAttr",
    [H],
    "While the game checks if I can be forced out",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["suction cups", "anchor", "no phazing"],
    },
  ),
  calc(
    "cancel.explosive-moves",
    "FieldPreventExplosiveMovesAbAttr",
    [H, SIM],
    "While the game checks if explosive moves are blocked",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["damp", "no explosions"],
    },
  ),
  calc(
    "cancel.berry-use",
    "PreventBerryUseAbAttr",
    [H],
    "While the game checks if a berry can be eaten",
    "Cancel checks",
    "cancelled",
    {
      synonyms: ["unnerve", "block berries"],
    },
  ),
  calc(
    "cancel.reflect-status-move",
    "ReflectStatusMoveAbAttr",
    [H, O, M],
    "While the game checks if a status move is bounced back",
    "Cancel checks",
    "reflected",
    {
      synonyms: ["magic bounce", "bounce"],
    },
  ),
  calc(
    "cancel.infiltrate",
    "InfiltratorAbAttr",
    [H, SIM],
    "While the game checks if my move bypasses screens",
    "Cancel checks",
    "bypassed",
    {
      synonyms: ["infiltrator", "ignore screens", "bypass substitute"],
    },
  ),

  // ---- Legacy base-class hooks of V1 (never dispatched directly; kept for the V1 bridge) -
  calc(
    "calc.incoming-move",
    "PreDefendAbAttr",
    [H, O, M, MU, D, SIM],
    "Before I take a hit",
    "Damage and power",
    "damage",
    {
      legacyHookId: "PreDefendAbAttr",
      baseClassOnly: true,
    },
  ),
  calc("calc.outgoing-move", "PreAttackAbAttr", [H, O, M, MU, SIM], "Before I attack", "Damage and power", "power", {
    legacyHookId: "PreAttackAbAttr",
    baseClassOnly: true,
  }),

  // ---- While active (pure flags, never dispatched) --------------------------------------
  {
    id: "while.active",
    kind: "while-active",
    dispatchKey: null,
    flagKeys: [
      "MonkFocusPunchAbAttr",
      "FreeAimAbAttr",
      "SynchronizedCurrentAbAttr",
      "SpiritualSaberNoContactAbAttr",
      "CranisphereSkullBashAbAttr",
      "AmaterasuMarkerAbAttr",
      "RagingFistAbAttr",
      "ManifestContactAbAttr",
      "SeaSpecterAbAttr",
      "ClosedCircuitAbAttr",
      "ReductionRuneAbAttr",
      "StatusMoveTypeImmunityBypassAbAttr",
      "AddMoveFlagAbAttr",
      "IgnoreProtectFirstTurnAbAttr",
      "IncreasePpAbAttr",
      "NoFusionAbilityAbAttr",
      "NoTransformAbilityAbAttr",
      "PreserveBaseStatAbilitiesAbAttr",
      "AbilityStudioRuntimeCapabilityAbAttr",
      "AbilityStudioSourceAbilityAbAttr",
      "AlwaysHitAbAttr",
      "BadDreamsImmunityAbAttr",
      "BallRecoveryAbAttr",
      "BiomeRevealBonusAbAttr",
      "BlockRedirectAbAttr",
      "BugPowderImmunityAbAttr",
      "CenterOfAttentionAbAttr",
      "CrackedVesselMarkerAbAttr",
      "DeadeyeMarkerAbAttr",
      "ChivalryAbAttr",
      "CommonRootAbAttr",
      "DoubleSelfInflictedDamageAbAttr",
      "DrenchImmunityAbAttr",
      "EntryHazardImmunityAbAttr",
      "FieldCritBoostAbAttr",
      "EclipseWingMarkerAbAttr",
      "ExperienceGainMultiplierAbAttr",
      "FloatAbAttr",
      "GroundEntryHazardImmunityAbAttr",
      "GroundedEntryHazardImmunityAbAttr",
      "HydrapexAbAttr",
      "IgnoreContactAbAttr",
      "IgnoreGenderInfatuationAbAttr",
      "IgnoreProtectByFlagAbAttr",
      "IgnoreProtectOnContactAbAttr",
      "MoveCategoryOverrideAbAttr",
      "MoveFlagInjectionAbAttr",
      "OverrideMultiHitCountAbAttr",
      "IgnoreResistancesAbAttr",
      "MoneyGainMultiplierAbAttr",
      "MoveHpCostModifierAbAttr",
      "OverruleCritAbAttr",
      "PostDefendSuppressOpponentDamageBoostAbAttr",
      "LivingChromeMarkerAbAttr",
      "SedimentBloomMarkerAbAttr",
      "LastHostAbAttr",
      "LibraryAbAttr",
      "LifePreserverAbAttr",
      "MycelialNetworkAbAttr",
      "OmniformAbAttr",
      "QuickeningGraceAbAttr",
      "RapierFlagInjectionAbAttr",
      "RelativityAbAttr",
      "ShatteredPsycheAbAttr",
      "SpreadTargetByFlagAbAttr",
      "StealthRockImmunityAbAttr",
      "SuperegoMarkerAbAttr",
      "SuppressFieldAbilitiesWhenEnragedAbAttr",
      "SuppressFieldEffectsAbAttr",
      "SwitchWhileRampagingAbAttr",
      "VaporBodyAccuracyAbAttr",
      "TangledSeedAbAttr",
    ],
    provides: [H],
    label: "While the ability is active",
    group: "Always on",
    synonyms: ["always", "passive", "permanent", "flag"],
  },
];

const BY_ID: ReadonlyMap<string, WhenDef> = new Map(WHEN_REGISTRY.map(when => [when.id, when]));
const BY_DISPATCH_KEY: ReadonlyMap<string, WhenDef> = (() => {
  const map = new Map<string, WhenDef>();
  for (const when of WHEN_REGISTRY) {
    for (const key of [when.dispatchKey, ...(when.alsoDispatchKeys ?? []), ...(when.flagKeys ?? [])]) {
      if (key !== null) {
        map.set(key, when);
      }
    }
  }
  return map;
})();
const BY_LEGACY_HOOK: ReadonlyMap<string, WhenDef> = new Map(
  WHEN_REGISTRY.flatMap(when => (when.legacyHookId === undefined ? [] : [[when.legacyHookId, when] as const])),
);

export function getWhen(id: string): WhenDef | undefined {
  return BY_ID.get(id);
}

export function whenForDispatchKey(key: string): WhenDef | undefined {
  return BY_DISPATCH_KEY.get(key);
}

export function whenForLegacyHook(hookId: string): WhenDef | undefined {
  return BY_LEGACY_HOOK.get(hookId);
}

/**
 * Whose type, category and flags the `moveUser` slot reads, for every WHEN that provides it.
 * (Defending hooks read the attacker; attacking hooks read the holder.)
 */
export const WHEN_MOVE_USER: Readonly<Record<string, "holder" | "other">> = {
  "event.faint": "other",
  "event.before-i-use-move": "holder",
  "event.after-my-hit": "holder",
  "event.after-any-move": "other",
  "event.after-hit": "other",
  "event.after-crit-taken": "other",
  "event.before-hit-lands": "other",
  "calc.redirect-move": "other",
  "calc.move-power": "holder",
  "calc.damage-dealt": "holder",
  "calc.damage-taken": "other",
  "calc.crit-roll": "holder",
  "calc.hit-count": "holder",
  "calc.accuracy": "holder",
  "calc.priority": "holder",
  "calc.move-type": "holder",
  "calc.incoming-move": "other",
  "calc.outgoing-move": "holder",
  "calc.attack-stat": "holder",
  "calc.my-attack-matchup": "holder",
  "calc.always-hit-check": "holder",
};
