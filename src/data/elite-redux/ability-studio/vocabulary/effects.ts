/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// PURE vocabulary file: no game imports. The effect (DO) registry, spec section 1.4.
//
// `implemented` is the honesty flag: it is true only when evaluate/effects.ts has a runnable
// implementation. Planned effects are listed so the editor and AI can already name them, but
// composition validation rejects them with a plain-language message until a class agent wires them
// to the real class code ("factor, don't re-implement").

import { STAT_OPTIONS, STATUS_OPTIONS, TARGET_OPTIONS, TERRAIN_OPTIONS, TYPE_OPTIONS, WEATHER_OPTIONS } from "./enums";
import { booleanParam, numberParam, type ParamDef, selectParam, sliderParam, textParam } from "./params";
import type { SlotId } from "./slots";

export type EffectKind = "calc" | "event" | "package";

export interface EffectDef {
  readonly id: string;
  readonly kind: EffectKind;
  readonly label: string;
  readonly requires: readonly SlotId[];
  readonly params: readonly ParamDef[];
  /** Calc effects: the frame value this effect changes; must equal the WHEN's `modifies`. */
  readonly modifies?: string;
  /** Event effects that reuse a V1 effect kind of ability-blueprint.ts. */
  readonly v1Kind?: "stat-stage" | "status" | "heal-percent" | "cure-status" | "set-weather" | "set-terrain";
  /**
   * Safety rules (guard registry ids) that always run before the rule's IF list, in this order. Locked in
   * the editor: staff cannot remove them (spec 1.5). An effect that bundles guards needs the slots they read.
   */
  readonly guards?: readonly string[];
  /** "Also requires" lines for checks the effect itself keeps (spec 1.5 feasibility); shown locked, never toggles. */
  readonly feasibility?: readonly string[];
  readonly implemented: boolean;
  readonly synonyms: readonly string[];
  readonly examples: readonly string[];
}

const TARGET = (): ParamDef => selectParam("target", "Who", TARGET_OPTIONS, "holder");

export const EFFECT_REGISTRY: readonly EffectDef[] = [
  // ---- Calc effects ---------------------------------------------------------------------
  {
    id: "effect.multiply-power",
    kind: "calc",
    label: "Multiply the move's power by {multiplier}",
    requires: [],
    params: [numberParam("multiplier", "Multiplier", 1.5, 0, 8, 0.05)],
    modifies: "power",
    implemented: true,
    synonyms: ["boost power", "power up", "stronger moves", "base power"],
    examples: ["Boost Fire moves by 1.5x"],
  },
  {
    id: "effect.multiply-damage-taken",
    kind: "calc",
    label: "Multiply damage I take by {multiplier}",
    requires: [],
    params: [
      numberParam("multiplier", "Multiplier", 0.5, 0, 4, 0.05),
      booleanParam("affectsFixedDamage", "Also affects fixed damage", false),
    ],
    modifies: "damage",
    implemented: true,
    synonyms: ["resist", "half damage", "damage reduction", "tank"],
    examples: ["Halve damage at full HP"],
  },
  {
    id: "effect.multiply-damage-dealt",
    kind: "calc",
    label: "Multiply damage I deal by {multiplier}",
    requires: [],
    params: [numberParam("multiplier", "Multiplier", 1.3, 0, 8, 0.05)],
    modifies: "damage",
    implemented: true,
    synonyms: ["deal more damage", "damage boost", "stronger hits"],
    examples: ["Deal 30% more damage to burned foes"],
  },
  {
    id: "effect.add-damage",
    kind: "calc",
    label: "Add {amount} damage",
    requires: [],
    params: [numberParam("amount", "Damage", 10, -9999, 9999, 1, true)],
    modifies: "damage",
    implemented: false,
    synonyms: ["extra damage", "flat damage", "bonus damage"],
    examples: ["Deal 10 extra damage"],
  },
  {
    id: "effect.cap-damage",
    kind: "calc",
    label: "Never take more than {maxPct}% of max HP",
    requires: [],
    params: [sliderParam("maxPct", "Max percent", 50, 1, 100, 1, true)],
    modifies: "damage",
    implemented: false,
    synonyms: ["damage cap", "limit damage", "survive", "endure"],
    examples: ["Cap each hit at 50% of max HP"],
  },
  {
    id: "effect.negate",
    kind: "calc",
    label: "Block it",
    requires: [],
    params: [],
    modifies: "cancelled",
    implemented: false,
    synonyms: ["immune", "prevent", "cancel", "block", "no effect"],
    examples: ["Block stat drops"],
  },
  {
    id: "effect.change-move-type",
    kind: "calc",
    label: "Change the move's type to {type}",
    requires: [],
    params: [selectParam("type", "Type", TYPE_OPTIONS, "FLYING")],
    modifies: "moveType",
    implemented: false,
    synonyms: ["aerilate", "pixilate", "convert type", "normalize"],
    examples: ["Normal moves become Flying"],
  },
  {
    id: "effect.grant-stab",
    kind: "calc",
    label: "Treat the move as same-type (x{multiplier})",
    requires: [],
    params: [numberParam("multiplier", "Multiplier", 1.5, 1, 3, 0.05)],
    modifies: "stab",
    implemented: false,
    synonyms: ["stab", "adaptability", "same type bonus"],
    examples: ["Always get the same-type bonus"],
  },
  {
    id: "effect.multiply-stat",
    kind: "calc",
    label: "Multiply {stat} by {multiplier}",
    requires: [],
    params: [
      selectParam("stat", "Stat", STAT_OPTIONS, "ATK"),
      numberParam("multiplier", "Multiplier", 1.5, 0, 8, 0.05),
    ],
    modifies: "statValue",
    implemented: false,
    synonyms: ["stat boost", "attack up", "speed up", "huge power"],
    examples: ["Double Attack"],
  },
  {
    id: "effect.change-priority",
    kind: "calc",
    label: "Change the move's priority by {amount}",
    requires: [],
    params: [numberParam("amount", "Priority", 1, -7, 7, 1, true)],
    modifies: "priority",
    implemented: true,
    synonyms: ["go first", "gale wings", "prankster", "priority"],
    examples: ["Give Flying moves +1 priority"],
  },
  {
    id: "effect.lift-slow-move-priority",
    kind: "calc",
    label: "Make slow moves normal speed and give other moves +1 priority",
    requires: [],
    params: [],
    modifies: "priority",
    implemented: false,
    synonyms: ["cancel slow moves", "no negative priority", "go first", "overwatch", "on the prowl"],
    examples: ["On my first turn a move with -5 priority becomes normal, and every other move gets +1 priority"],
  },
  {
    id: "effect.always-hit",
    kind: "calc",
    label: "Never miss",
    requires: [],
    params: [],
    modifies: "accuracy",
    implemented: false,
    synonyms: ["no guard", "never miss", "perfect accuracy"],
    examples: ["Moves never miss"],
  },
  {
    id: "effect.force-crit",
    kind: "calc",
    label: "Always land a critical hit",
    requires: [],
    params: [],
    modifies: "isCritical",
    implemented: false,
    synonyms: ["always crit", "guaranteed crit", "merciless"],
    examples: ["Always crit against poisoned foes"],
  },
  {
    id: "effect.hit-n-times",
    kind: "calc",
    label: "Hit {count} times",
    requires: [],
    params: [numberParam("count", "Hits", 2, 1, 10, 1, true)],
    modifies: "hitCount",
    implemented: false,
    synonyms: ["multi hit", "parental bond", "extra strike"],
    examples: ["Hit twice"],
  },
  {
    id: "effect.immune-to-type",
    kind: "calc",
    label: "Be immune to {type} moves",
    requires: [],
    params: [selectParam("type", "Type", TYPE_OPTIONS, "GROUND")],
    modifies: "cancelled",
    feasibility: [
      "Does not block status moves or moves that treat Flying types neutrally (the same rule as Levitate)",
      "Does not block moves that hit every Pokemon, or my own side",
    ],
    implemented: true,
    synonyms: ["immunity", "levitate", "volt absorb", "water absorb", "ground immune"],
    examples: ["Immune to Ground moves"],
  },

  // ---- Event effects (V1 reuse) ---------------------------------------------------------
  {
    id: "effect.stat-stage",
    kind: "event",
    label: "Change {target}'s {stat} by {stages} stages",
    requires: [],
    params: [
      TARGET(),
      selectParam("stat", "Stat", STAT_OPTIONS, "ATK"),
      numberParam("stages", "Stages", 1, -6, 6, 1, true),
    ],
    v1Kind: "stat-stage",
    implemented: true,
    synonyms: ["raise stat", "lower stat", "boost", "drop", "intimidate", "stat stage"],
    examples: ["Raise Speed by 1 stage"],
  },
  {
    id: "effect.inflict-status",
    kind: "event",
    label: "Give {target} {status}",
    requires: [],
    params: [TARGET(), selectParam("status", "Status", STATUS_OPTIONS, "POISON")],
    v1Kind: "status",
    implemented: true,
    synonyms: ["poison", "burn", "paralyze", "put to sleep", "freeze", "inflict status"],
    examples: ["Burn the attacker"],
  },
  {
    id: "effect.cure-status",
    kind: "event",
    label: "Cure {target}'s {status}",
    requires: [],
    params: [TARGET(), selectParam("status", "Status", ["ANY", ...STATUS_OPTIONS], "ANY")],
    v1Kind: "cure-status",
    implemented: true,
    synonyms: ["heal status", "remove burn", "cleanse", "cure"],
    examples: ["Cure my own status"],
  },
  {
    id: "effect.heal-percent",
    kind: "event",
    label: "Heal {target} by {percent}% of max HP",
    requires: [],
    params: [TARGET(), sliderParam("percent", "Percent", 25, 1, 100, 1, true)],
    v1Kind: "heal-percent",
    implemented: true,
    synonyms: ["restore hp", "recover", "heal", "regenerate"],
    examples: ["Heal 1/8 of max HP"],
  },
  {
    id: "effect.set-weather",
    kind: "event",
    label: "Set the weather to {weather}",
    requires: [],
    params: [selectParam("weather", "Weather", WEATHER_OPTIONS, "RAIN")],
    v1Kind: "set-weather",
    implemented: true,
    synonyms: ["summon rain", "drizzle", "drought", "sand stream", "snow warning"],
    examples: ["Summon rain"],
  },
  {
    id: "effect.set-terrain",
    kind: "event",
    label: "Set the terrain to {terrain}",
    requires: [],
    params: [selectParam("terrain", "Terrain", TERRAIN_OPTIONS, "ELECTRIC")],
    v1Kind: "set-terrain",
    implemented: true,
    synonyms: ["surge", "electric surge", "grassy surge", "terrain"],
    examples: ["Set Electric Terrain"],
  },

  // ---- Event effects (planned) ----------------------------------------------------------
  {
    id: "effect.apply-tag",
    kind: "event",
    label: "Apply {tag} to {target}",
    requires: [],
    params: [TARGET(), textParam("tag", "Battle effect (BattlerTagType name)", "TAUNT")],
    implemented: false,
    synonyms: ["taunt", "confuse", "leech seed", "apply volatile"],
    examples: ["Confuse the attacker"],
  },
  {
    id: "effect.remove-tag",
    kind: "event",
    label: "Remove {tag} from {target}",
    requires: [],
    params: [TARGET(), textParam("tag", "Battle effect (BattlerTagType name)", "TAUNT")],
    implemented: false,
    synonyms: ["cleanse tag", "remove volatile", "cure confusion"],
    examples: ["Remove Leech Seed"],
  },
  {
    id: "effect.recoil",
    kind: "event",
    label: "Take {percent}% of the damage as recoil",
    requires: ["damage"],
    params: [sliderParam("percent", "Percent", 10, 1, 100, 1, true)],
    implemented: false,
    synonyms: ["recoil", "self damage", "life orb"],
    examples: ["Take 10% recoil"],
  },
  {
    id: "effect.drain",
    kind: "event",
    label: "Heal {percent}% of the damage dealt",
    requires: ["damage"],
    params: [sliderParam("percent", "Percent", 25, 1, 100, 1, true)],
    implemented: false,
    synonyms: ["lifesteal", "drain", "leech", "absorb hp"],
    examples: ["Heal 25% of damage dealt"],
  },
  {
    id: "effect.arena-tag",
    kind: "event",
    label: "Set {tag} on {side}",
    requires: [],
    params: [
      textParam("tag", "Field effect (ArenaTagType name)", "REFLECT"),
      selectParam("side", "Side", ["holder-side", "opposing-side", "both"], "holder-side"),
    ],
    implemented: false,
    synonyms: ["set hazard", "tailwind", "screen", "field effect"],
    examples: ["Set Tailwind"],
  },
  {
    id: "effect.force-switch-out",
    kind: "event",
    label: "Switch out",
    requires: [],
    params: [],
    guards: ["not-own-hp-cost-move", "not-already-forced-out", "sheer-force-negates", "after-final-hit"],
    feasibility: ["A switch must be possible against every foe (nothing traps me or blocks it)"],
    implemented: true,
    synonyms: ["eject", "wimp out", "emergency exit", "pivot", "retreat"],
    examples: ["Switch out when HP drops below 35%"],
  },
  {
    id: "effect.scripted-move",
    kind: "event",
    label: "Use {moveId} with {power} power",
    requires: ["other"],
    params: [
      textParam("moveId", "Move id (enum name)", "STEAM_ERUPTION"),
      numberParam("power", "Power", 50, 1, 250, 1, true),
    ],
    feasibility: [
      "Both I and the foe must still be standing",
      "Never starts from an indirect move, so a follow-up cannot trigger another follow-up",
    ],
    implemented: true,
    synonyms: ["follow up move", "extra move", "free move", "steam eruption"],
    examples: ["50 power Steam Eruption after a Fire or Water move"],
  },
  {
    id: "effect.change-form",
    kind: "event",
    label: "Change to the {key} form",
    requires: [],
    params: [textParam("key", "Form key", ""), booleanParam("cureStatus", "Cure status when changing", false)],
    implemented: false,
    synonyms: ["transform", "form change", "shift form", "ape shift"],
    examples: ["Change form below half HP"],
  },
  {
    id: "effect.return-base-form",
    kind: "event",
    label: "Return to the base form",
    requires: [],
    params: [],
    implemented: false,
    synonyms: ["revert", "base form", "undo transform"],
    examples: ["Revert above half HP"],
  },
  {
    id: "effect.remove-item",
    kind: "event",
    label: "Remove {target}'s item",
    requires: [],
    params: [TARGET()],
    implemented: false,
    synonyms: ["knock off", "remove held item", "destroy item"],
    examples: ["Knock off the attacker's item"],
  },
  {
    id: "effect.steal-item",
    kind: "event",
    label: "Steal {target}'s item",
    requires: ["other"],
    params: [TARGET()],
    implemented: false,
    synonyms: ["thief", "magician", "pickpocket", "take item"],
    examples: ["Steal the foe's item"],
  },
  {
    id: "effect.use-item",
    kind: "event",
    label: "Use my held item now",
    requires: [],
    params: [],
    implemented: false,
    synonyms: ["eat berry", "consume item", "trigger item"],
    examples: ["Eat my berry immediately"],
  },
  {
    id: "effect.message",
    kind: "event",
    label: 'Show the message "{text}"',
    requires: [],
    params: [textParam("text", "Message", "")],
    implemented: false,
    synonyms: ["text", "announce", "flavour text", "say"],
    examples: ["Show a short announcement"],
  },
  {
    id: "effect.arm-effect",
    kind: "event",
    label: "Arm another effect for later",
    requires: [],
    params: [textParam("armKey", "Effect key", "")],
    implemented: false,
    synonyms: ["delayed effect", "queue effect", "next time"],
    examples: ["Arm a boost for the next move"],
  },
  {
    id: "effect.spend-first-move-bonus",
    kind: "event",
    label: "Use up my first-move bonus",
    requires: [],
    params: [],
    implemented: false,
    synonyms: ["spend priority", "lose the bonus", "used up", "one shot bonus", "cutthroat"],
    examples: ["After my slicing move lands, my +1 priority bonus is gone until it comes back"],
  },
  {
    id: "effect.restore-first-move-bonus",
    kind: "event",
    label: "Give me my first-move bonus back",
    requires: [],
    params: [],
    implemented: false,
    synonyms: ["refill priority", "bonus comes back", "reset priority", "re-arm", "edgelord"],
    examples: ["When I use Sharpen, my +1 priority bonus is ready again"],
  },

  // ---- Package --------------------------------------------------------------------------
  {
    id: "effect.package",
    kind: "package",
    label: "Works as one piece: {block}",
    requires: [],
    params: [textParam("block", "Class declaration (block id)", "")],
    implemented: false,
    synonyms: ["one piece", "whole mechanic", "package", "built in mechanic"],
    examples: ["A single-use mechanic that cannot be split"],
  },
];

const BY_ID: ReadonlyMap<string, EffectDef> = new Map(EFFECT_REGISTRY.map(def => [def.id, def]));

export function getEffect(id: string): EffectDef | undefined {
  return BY_ID.get(id);
}
