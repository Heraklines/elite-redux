/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  FILTER_CHOICES,
  MOVE_NAMES,
  moveFilterCodec,
  moveNamesCodec,
  NO_FILTER,
  optionalStatusCodec,
  optionalTagCodec,
  STATUS_NAMES,
  TAG_NAMES,
  tagNamesCodec,
  turnRangeCodec,
  zeroMeansDefaultCodec,
} from "#data/elite-redux/ability-studio/decl/B08/tag-choices";
// B08 chunk 2 / event-effect, Tier B with RNG in the gate. Read from the source (archetypes/chance-status-on-hit.ts) and from
// the live instances of all 66 attrs (Radio Jam carries a per-hit chance function, see notes). canApply is now:
//
//   guards   1. the target has IgnoreMoveEffectsAbAttr (Shield Dust) or is the holder itself                        -> false
//   gate     2. matchesMove: the move is a damaging move (the old parent check; the default closure) or, when the user
//               lists move ids, one of them (the old parent closure AND the old list test are now this one clause)  -> false
//               contactExcluded and the move INHERENTLY makes contact (move.hasFlag, Long Reach ignored)           -> false
//               contactRequired and !move.doesFlagEffectApply(MAKES_CONTACT, user: holder, target)                  -> false
//               filter (a move flag via move.hasFlag, or the move's own type: move.type)                           -> false
//            3. matchesTarget: the target must carry targetHasTag, have targetHasStatus, be hit critically (when set) -> false
//            4. passesChance: chance (or firstTurnChance on the holder's first turn, or the per-hit chance function)
//               chance === 100 || holder.randBattleSeedInt(100) < chance                                          <- RANDOM DRAW 1
//   residual 5. pick one tag (randBattleSeedInt(n), only with several tags)                                      <- RANDOM DRAW 2
//            6. target.canAddTag(tag)                                                                              (feasibility)
//   apply    re-picks (RANDOM DRAW 3), then addTag(tag, turns); the turns are rolled with randBattleSeedIntRange for
//            confusion (2 to 5) and for a turn range (Grip Pincer style); skipped when simulated.
//
// The parent's attack check (PostAttackAbAttr.attackCondition) used to run BEFORE the guards and the gate and could not be
// seen or removed. It is now the first clause of the gate (the library atoms move.damaging, or move.is-move for a user with a
// list of moves), and the class hands the parent a neutral closure. It is pure, so asking it after the guards changes no answer
// and no random draw.
//
// Unlike ChanceStatusOnAttackAbAttr this class has NO `simulated` shortcut: canApply rolls even for a simulated call.
// The compiled gate differs there: the library atom rng.chance answers true without a draw when `simulated`, while the class
// rolls. It is not reachable today (PostAttack is only dispatched with simulated false), see the notes.
// The contact settings, the move filter, the move list, the target requirements, the critical-hit setting and the
// first-turn chance decide the SHAPE of the gate, so they are not editable (each user's binding spells its shape out).
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import {
  ChanceBattlerTagOnAttackAbAttr,
  radioJamChanceResolver,
} from "#data/elite-redux/archetypes/chance-status-on-hit";

/** "" <-> undefined (no move list: every damaging move counts); otherwise the comma separated move names ("Focus blast, Hypnosis"). */
const optionalMoveListCodec: ParamCodec = {
  toCtor: value => (String(value).trim() === "" ? undefined : moveNamesCodec.toCtor(value)),
  fromInstance: raw => (raw === undefined || raw === null ? "" : moveNamesCodec.fromInstance(raw)),
};

/** "Off" <-> no function; "On" <-> the per-hit chance function of the one user that has one (100% after a foe's sound move, else the chance). */
const chanceBoostCodec: ParamCodec = {
  toCtor: value => (value === "On" ? radioJamChanceResolver : undefined),
  fromInstance: raw => (raw === undefined || raw === null ? "Off" : raw === radioJamChanceResolver ? "On" : undefined),
};

export default defineDecl(ChanceBattlerTagOnAttackAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Chance to confuse, bleed or flinch the target of my attack",
  summary: params => {
    const which =
      String(params.moveIds) === ""
        ? params.filter === NO_FILTER
          ? params.contactExcluded === true
            ? "one of my moves that does not make contact hits"
            : params.contactRequired === true
              ? "one of my moves that makes contact hits"
              : "one of my moves hits"
          : `one of my ${String(params.filter).toLowerCase()} hits`
        : `I use ${params.moveIds}`;
    const crit = params.critRequired === true ? " critically" : "";
    const needs =
      (params.targetHasTag === "None" ? "" : ` and the target is ${String(params.targetHasTag).toLowerCase()}`)
      + (params.targetHasStatus === "None" ? "" : ` and the target is ${String(params.targetHasStatus).toLowerCase()}`);
    const boost =
      params.chanceBoost === "On"
        ? " The chance is 100% after the foe has already moved this turn with a sound move."
        : "";
    return `When ${which}${crit}${needs}, there is a ${params.chance}% chance the target becomes ${params.tags}.${boost}`;
  },
  synonyms: [
    "loud bang",
    "haunting frenzy",
    "radio jam",
    "razor sharp",
    "venoblaze pincers",
    "flinch chance",
    "confusion chance",
    "bleed chance",
    "trap chance",
    "secondary effect",
  ],
  examples: [
    "50% chance to confuse the target when I hit with a sound move",
    "20% chance to make the target flinch when I hit it",
    "100% chance to make the target bleed when my attack is a critical hit",
  ],
  params: [
    {
      id: "chance",
      ctorIndex: 0,
      ctorOption: "chance",
      path: "chance",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Chance (%)",
      editable: true,
      default: 30,
    },
    {
      id: "tags",
      ctorIndex: 0,
      ctorOption: "tags",
      path: "tags",
      control: "text",
      label: "What the target becomes (comma separated; one is picked at random when there are several)",
      editable: true,
      gateIndependent: true,
      default: "Confused",
      options: TAG_NAMES,
      codec: tagNamesCodec,
    },
    {
      id: "contactRequired",
      ctorIndex: 0,
      ctorOption: "contactRequired",
      path: "contactRequired",
      control: "boolean",
      label: "The move must make contact (set by the conditions)",
      // Decides the SHAPE of the gate (each user's binding spells it out).
      editable: false,
      default: true,
    },
    {
      id: "contactExcluded",
      ctorIndex: 0,
      ctorOption: "contactExcluded",
      path: "contactExcluded",
      control: "boolean",
      label: "Only moves that do not make contact (set by the conditions)",
      editable: false,
      default: false,
    },
    {
      id: "turns",
      ctorIndex: 0,
      ctorOption: "turns",
      path: "turns",
      control: "number",
      min: 0,
      max: 10,
      step: 1,
      integer: true,
      label: "Number of turns the effect lasts (0 = the game's usual length)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: zeroMeansDefaultCodec,
    },
    {
      id: "turnRange",
      ctorIndex: 0,
      ctorOption: "turnRange",
      path: "turnRange",
      control: "text",
      label: "Random number of turns, from-to (for example 4-5; leave empty when you set the number of turns)",
      editable: true,
      gateIndependent: true,
      default: "",
      codec: turnRangeCodec,
    },
    {
      id: "damageDenominator",
      ctorIndex: 0,
      ctorOption: "damageDenominator",
      path: "damageDenominator",
      control: "number",
      min: 0,
      max: 32,
      step: 1,
      integer: true,
      label: "Damage each turn as 1 divided by this number of max HP (0 = the effect's own amount)",
      editable: true,
      gateIndependent: true,
      default: 0,
      codec: zeroMeansDefaultCodec,
    },
    {
      id: "filter",
      ctorIndex: 0,
      ctorOption: "filter",
      path: "filter",
      control: "select",
      label: "Only for these moves (set by the conditions)",
      // One atom in the gate (a move property or the move's own type): the choice decides the SHAPE of the gate.
      editable: false,
      default: NO_FILTER,
      options: FILTER_CHOICES,
      codec: moveFilterCodec,
    },
    {
      id: "moveIds",
      ctorIndex: 0,
      ctorOption: "moveIds",
      path: "moveIds",
      control: "text",
      label: "Only when I use one of these moves (comma separated, empty = any damaging move) (set by the conditions)",
      editable: false,
      default: "",
      options: MOVE_NAMES,
      codec: optionalMoveListCodec,
    },
    {
      id: "targetHasTag",
      ctorIndex: 0,
      ctorOption: "targetHasTag",
      path: "targetHasTag",
      control: "select",
      label: "Only when the target already has this lasting effect (set by the conditions)",
      editable: false,
      default: "None",
      options: ["None", ...TAG_NAMES],
      codec: optionalTagCodec,
    },
    {
      id: "targetHasStatus",
      ctorIndex: 0,
      ctorOption: "targetHasStatus",
      path: "targetHasStatus",
      control: "select",
      label: "Only when the target already has this status (set by the conditions)",
      editable: false,
      default: "None",
      options: ["None", ...STATUS_NAMES],
      codec: optionalStatusCodec,
    },
    {
      id: "critRequired",
      ctorIndex: 0,
      ctorOption: "critRequired",
      path: "critRequired",
      control: "boolean",
      label: "Only when my attack was a critical hit (set by the conditions)",
      editable: false,
      default: false,
    },
    {
      id: "chanceBoost",
      ctorIndex: 0,
      ctorOption: "chanceResolver",
      path: "chanceResolver",
      control: "select",
      label:
        "The chance becomes 100% when the foe has already moved this turn with a sound move (set by the conditions)",
      // Decides the SHAPE of the gate (an "any" in front of the roll).
      editable: false,
      default: "Off",
      options: ["Off", "On"],
      codec: chanceBoostCodec,
    },
    {
      id: "firstTurnChance",
      ctorIndex: 0,
      ctorOption: "firstTurnChance",
      path: "firstTurnChance",
      control: "number",
      min: 0,
      max: 100,
      step: 1,
      integer: true,
      label: "Chance (%) on my first turn after entering (0 = the same chance as always) (set by the conditions)",
      // Decides the SHAPE of the gate (an "on my first turn" alternative in front of the roll).
      editable: false,
      default: 0,
      codec: zeroMeansDefaultCodec,
    },
  ],
  gateParams: [{ param: "chance", block: "rng.chance", field: "pct" }],
  conditions: [
    // The gate is a group of atoms per user shape, in the original order (bindings.ts):
    //   [move.damaging] (or [move.is-move ...] for a user with a list of moves), [not move.inherent-flag MAKES_CONTACT] or [move.flag MAKES_CONTACT], [move.inherent-flag F] or [move.type T],
    //   [tag.has other T], [status.has other S], [hit.critical], then rng.chance LAST (in front of it any[...] for a first-turn or per-hit chance).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The target must be another Pokemon and must not be protected from added effects (like Shield Dust)",
    "The target must be able to receive the lasting effect (nothing blocks it and it does not already have it)",
  ],
  effect: { id: "effect.apply-tag", params: ["tags", "turns", "turnRange", "damageDenominator"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "both",
    rngOrder: [
      "canApply gate: the chance roll (skipped at 100%, or on my first turn when a first-turn chance is 100), only after the move, target and critical-hit checks passed",
      "canApply residual: pick one lasting effect (only when there are several)",
      "apply: pick the effect that is applied (independent of the first pick), then roll the number of turns for confusion (2 to 5) or for a turn range",
    ],
    state: "none",
    simulated: "ignores",
  },
  probes: [
    {
      // A contact move, a non-contact move, a sound move and a status move: the roll must only be drawn when the gate's cheap checks pass.
      name: "contact, non-contact, sound and status move",
      axes: { foeMove: ["TACKLE", "WATER_GUN", "HYPER_VOICE", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand: canApply = guards && gate && residual (a pure move of the original clauses; the parent's attack check moved into the gate as its first clause; matchesMove, matchesTarget and passesChance are the gate, in that order; the tag pick is a random draw AFTER the chance roll, so it is in the residual). Unlike ChanceStatusOnAttackAbAttr there is NO simulated shortcut, so canApply rolls even when simulated (`simulated: ignores`). The parent's attack check (PostAttackAbAttr.attackCondition) used to run before the guards and the gate, out of reach of staff, and for a user with a list of moves it duplicated the list test of the gate (so removing the list atom in the editor would have done nothing). It is now ONE clause of the gate: move.damaging for every user without a list, move.is-move for the one user with a list (Hypnotic Trance rides on Hypnosis, a status move), and the class hands the parent a neutral closure. Removing or changing that atom now really changes the ability. SIMULATED: the class rolls even when simulated while the compiled gate's rng.chance answers true without a draw, so a compiled rule differs on a simulated call; PostAttack is only dispatched with simulated false (move-effect-phase.ts), so there is no live difference. Users (66 attrs): contact tier Grip Pincer (WRAP), Fungal Infection, Fearmonger, Freezing Point/Cryo Proficiency/Cryogenesis (the contact half), Yuki Onna, Spike Armor, Dead Power, Parasitic Spores, Decomposer, Fragrant Daze, Menacing Situation, Venoblaze Pincers (WRAP), Blood Stain, Talon Trap (first-turn chance 100), World Serpent, First Serpent; non-contact tier is the second attr of Freezing Point, Cryo Proficiency and Cryogenesis; sound moves Loud Bang, Radio Jam, Beautiful Music, Resonance, Piercing Solo, Grass Flute; biting Foreboding Fangs; horn Impaler; by the move's own type Magical Dust, Elemental Charge, Archmage x6, Familiar x6, Refrigerate, Pixilate x2, Unicorn, Twinkle Toes, Fae Heart; the target must already have a lasting effect Entrance (confusion), Blood Bath and Bloodlust (bleeding), Frostbind and Cryostasis (frostbite); the target must have a status Set Ablaze (burn); critical hits Razor Sharp, To The Bone; moves by id Hypnotic Trance; no setting at all Haunted Spirit, Haunting Frenzy, Tentalock, Serpent Bind, Grappler, Chokehold, Grip Pincer BIND. Pixilate, Refrigerate, Unicorn, Twinkle Toes and Fae Heart also carry an ability-level condition (the holder is of the type) added with addCondition; recompose copies it. RADIO JAM (5303) passes a per-hit chance FUNCTION (`chanceResolver`): 100 when the foe has already moved this turn and its last move was a sound move, else 30. The function moved (unchanged) from init-elite-redux-ability-upgrades.ts to archetypes/chance-status-on-hit.ts as radioJamChanceResolver, and the param `chanceBoost` (Off or On, not editable) passes it again on a rebuild. Its library form is any[ all[foe has moved, foe's last move was a sound move], rng.chance 30 ], which draws the same numbers (the 100 branch draws nothing, exactly like `chance === 100`). Siblings (ChanceBattlerTagOnHitAbAttr, ChanceStatusOnAttackAbAttr) are separate classes.",
});
