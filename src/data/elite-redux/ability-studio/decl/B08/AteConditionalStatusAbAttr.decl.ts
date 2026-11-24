/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 / event-effect, Tier B with branches and RNG in the gate. Read from the source (archetypes/ate-conditional.ts) and
// from the 13 live users. canApply is now `guards && gate && residual`:
//
//   guards   damaging move (the parent's fixed attackCondition) && holder !== target && hitResult < NO_EFFECT, and for
//            a status or tag outcome: the target does not have IgnoreMoveEffectsAbAttr (Shield Dust)
//   gate     holder.isOfType(newType) && holder.getMoveType(move) === newType, then (status and tag outcomes only) the
//            chance roll `chance === 100 || randBattleSeedInt(100) < chance`            <- the ONE random draw
//   residual heal: damage > 0 && !holder.isFullHp();  status: target.canSetStatus(effect, true, false, holder);
//            tag: target.canAddTag(tag)
//
// The original put the Shield Dust check AFTER the type test. It is a pure read, so moving it into `guards` (before the
// type test) changes neither the result nor the draws: the roll is still reached only when every earlier check passed.
//
// Three outcomes are three branches of the same class: a status, a lasting effect (confusion, bleeding, frostbite) and a
// deterministic heal of a share of the damage dealt (Fertilize). The heal never rolls, so its gate has no chance atom.
// The outcome decides the SHAPE of the gate (roll or no roll), so it is not editable; the chance is kept equal to the
// gate's `rng.chance` through gateParams.
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { TYPE_OPTIONS } from "#data/elite-redux/ability-studio/vocabulary/enums";
import { AteConditionalStatusAbAttr } from "#data/elite-redux/archetypes/ate-conditional";
import { BattlerTagType } from "#enums/battler-tag-type";
import { PokemonType } from "#enums/pokemon-type";
import { StatusEffect } from "#enums/status-effect";

type Outcome =
  | { kind: "status"; effect: StatusEffect }
  | { kind: "tag"; tag: BattlerTagType }
  | { kind: "heal"; fraction: number };

/** What staff pick, and the options object the class wants for it. */
const OUTCOMES: readonly (readonly [name: string, outcome: Outcome])[] = [
  ["Poisoned", { kind: "status", effect: StatusEffect.POISON }],
  ["Badly poisoned", { kind: "status", effect: StatusEffect.TOXIC }],
  ["Paralyzed", { kind: "status", effect: StatusEffect.PARALYSIS }],
  ["Asleep", { kind: "status", effect: StatusEffect.SLEEP }],
  ["Frozen", { kind: "status", effect: StatusEffect.FREEZE }],
  ["Burned", { kind: "status", effect: StatusEffect.BURN }],
  ["Confused", { kind: "tag", tag: BattlerTagType.CONFUSED }],
  ["Bleeding", { kind: "tag", tag: BattlerTagType.ER_BLEED }],
  ["Frostbitten", { kind: "tag", tag: BattlerTagType.ER_FROSTBITE }],
  ["Heal 10% of the damage dealt", { kind: "heal", fraction: 0.1 }],
  ["Heal 25% of the damage dealt", { kind: "heal", fraction: 0.25 }],
  ["Heal 50% of the damage dealt", { kind: "heal", fraction: 0.5 }],
];

const outcomeCodec: ParamCodec = {
  toCtor: value => {
    const entry = OUTCOMES.find(([name]) => name === String(value));
    if (entry === undefined) {
      throw new Error(`"${String(value)}" is not a known outcome`);
    }
    return { ...entry[1] };
  },
  fromInstance: raw => {
    const outcome = raw as Outcome | undefined;
    if (outcome === undefined || outcome === null) {
      return;
    }
    return OUTCOMES.find(([, candidate]) => JSON.stringify(candidate) === JSON.stringify(outcome))?.[0];
  },
};

export default defineDecl(AteConditionalStatusAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Add a bonus effect to my attacks of my own type",
  summary: params => {
    const type = String(params.newType);
    const outcome = String(params.outcome);
    return outcome.startsWith("Heal")
      ? `If I am ${type} type, my ${type} attacks that hit also let me ${outcome.charAt(0).toLowerCase()}${outcome.slice(1)}.`
      : `If I am ${type} type, each of my ${type} attacks that hits has a ${params.chance}% chance to leave the target ${outcome.toLowerCase()}.`;
  },
  synonyms: [
    "secondary effect",
    "bonus effect on own type",
    "chance to burn",
    "chance to poison",
    "chance to confuse",
    "intoxicate",
    "immolate",
    "fertilize",
    "mineralize",
  ],
  examples: ["If I am Fire type, my Fire moves have a 10% chance to burn the target"],
  params: [
    {
      id: "newType",
      ctorIndex: 0,
      ctorOption: "newType",
      path: "newType",
      control: "select",
      label: "Type (I must be this type, and so must the move)",
      editable: true,
      default: "FIRE",
      options: TYPE_OPTIONS,
      codec: enumCodec(PokemonType, "type"),
    },
    {
      id: "outcome",
      ctorIndex: 0,
      ctorOption: "outcome",
      path: "outcome",
      control: "select",
      label: "What the hit does",
      // A heal never rolls and a status or lasting effect does, so the choice decides the SHAPE of the gate.
      editable: false,
      default: "Burned",
      options: OUTCOMES.map(([name]) => name),
      codec: outcomeCodec,
    },
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
      label: "Chance (%) (not used by the heal)",
      editable: true,
      default: 10,
    },
  ],
  gateParams: [
    { param: "newType", block: "mon.has-type", field: "type" },
    { param: "newType", block: "move.type", field: "type" },
    { param: "chance", block: "rng.chance", field: "pct" },
  ],
  conditions: [
    // all[ mon.has-type holder <type>, move.type <type> (after ability changes), rng.chance ] ; the heal has no chance atom.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must be a damaging hit that connected on another Pokemon",
    "The target must not be protected from added effects (like Shield Dust), except for the heal",
    "The target must be able to receive the status or lasting effect",
    "The heal needs damage dealt and missing HP",
  ],
  branches: [
    {
      label: "Leave the target with a status condition",
      conditions: ["mon.has-type (holder)", "move.type", "rng.chance"],
      effect: { id: "effect.inflict-status", params: ["outcome"] },
    },
    {
      label: "Leave the target confused, bleeding or frostbitten",
      conditions: ["mon.has-type (holder)", "move.type", "rng.chance"],
      effect: { id: "effect.apply-tag", params: ["outcome"] },
    },
    {
      label: "Heal me by a share of the damage dealt",
      conditions: ["mon.has-type (holder)", "move.type"],
      effect: { id: "effect.drain", params: ["outcome"] },
    },
  ],
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "both",
    rngOrder: [
      "canApply gate: the chance roll (status and lasting-effect outcomes only, skipped at 100%), after the type checks",
      "apply: confusion rolls its 2 to 5 turns with randBattleSeedIntRange (confusion outcome only)",
    ],
    state: "none",
    simulated: "ignores",
  },
  probes: [
    {
      // The heal needs missing HP: full HP and one below it.
      name: "holder HP for the heal",
      axes: { hp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B split by hand (guards, gate, residual); the Shield Dust read moved ahead of the type test, which is safe because both are pure and the single random draw (the chance roll) is reached only after both passed. Users (13): Immolate, Solar Flare, Blaze Release (Fire, burn); Intoxicate, Sludgy Mix (Poison); Mineralize, Molten Coat, Lead Claws (Rock, bleed); Emanate, Enlightened, Brainpower, Nucleus (Psychic, confusion); Fertilize (Grass, heal 10%, never rolls: its `chance` param is unused). The paired TypeConversionAbAttr and StabAddAbAttr are separate classes. The status test `damaging move` is the parent's fixed closure; the library has no guard for 'hit connected on another Pokemon' (R-B08-6). canApply ignores `simulated` (it rolls even when simulated); apply returns early when simulated.",
});
