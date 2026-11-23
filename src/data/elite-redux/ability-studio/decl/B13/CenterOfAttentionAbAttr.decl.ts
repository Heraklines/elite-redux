/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Center of Attention, part 2 of 2 (Tier C, package). "A foe that hits my ally instead of me loses Sp. Atk."
//
// Source: abilities/newcomer-signature-mechanics.ts, CenterOfAttentionAbAttr (extends AbAttr directly; apply is empty).
// A MARKER that the engine looks for by name. The constructor now takes the stat and the stage change (defaults = the
// old literals Sp. Atk and -1). The rule is applyCenterOfAttentionPenalty(attacker, target, move, damage), called from
// phases/move-effect-phase.ts:1129 after every damage dealing hit, in this order (all pure until the last step):
//   1. damage <= 0, or the move is a status move, or the TARGET itself carries the marker: stop
//   2. protectingAlly = the first ally of the target that carries the marker; none: stop
//   3. the attacker's last move record exists AND its targets include the protecting ally: stop (it did aim at me)
//   4. a record exists AND it is the record already penalised (CENTER_PENALTY_RECORD[attacker]): stop
//   5. remember the record, queue "<me> drew the attacker's attention!", and the attacker's stat changes by the stages
// No RNG. The penalty is read from the protector's own marker attr (penaltyStat, penaltyStages), else Sp. Atk and -1.
import { CenterOfAttentionAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { Stat } from "#enums/stat";

// Player-facing stat names (never the enum constants).
const STAT_CHOICES: Record<string, Stat> = {
  Attack: Stat.ATK,
  Defense: Stat.DEF,
  "Sp. Atk": Stat.SPATK,
  "Sp. Def": Stat.SPDEF,
  Speed: Stat.SPD,
};

export default defineDecl(CenterOfAttentionAbAttr, {
  tier: "C",
  kind: "package",
  when: "while.active",
  label: "Punish a foe that hits my ally instead of me",
  summary: params =>
    `When a foe damages one of my allies instead of me, that foe's ${params.stat} changes by ${params.stages} stage after the move. It works once per move the foe used.`,
  synonyms: [
    "lower the attacker's stat",
    "protect my ally",
    "draw attention",
    "follow me penalty",
    "guard duty",
    "center of attention",
  ],
  examples: ["A foe that hits my partner instead of me loses 1 Sp. Atk"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "penaltyStat",
      control: "select",
      label: "Stat that is changed on the foe",
      editable: true,
      default: "Sp. Atk",
      options: Object.keys(STAT_CHOICES),
      codec: {
        toCtor: value => {
          const resolved = STAT_CHOICES[String(value)];
          if (resolved === undefined) {
            throw new Error(`"${String(value)}" is not a stat that can be changed`);
          }
          return resolved;
        },
        fromInstance: raw => Object.keys(STAT_CHOICES).find(name => STAT_CHOICES[name] === raw),
      },
    },
    {
      id: "stages",
      ctorIndex: 1,
      path: "penaltyStages",
      control: "number",
      label: "Stage change (negative lowers, -6 to 6)",
      editable: true,
      default: -1,
      min: -6,
      max: 6,
      step: 1,
      integer: true,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The foe's move must have dealt damage and must not be a status move",
    "Only when the foe hit my ally and not me, and I am not the one being hit myself",
    "Not when the foe's last move was aimed at me (its target list includes me)",
    "Once per move the foe used (a private record inside the class)",
    "The change always goes to the foe that attacked, never to me (fixed in the class)",
  ],
  effect: { id: "effect.package", params: ["stat", "stages"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  l2StaticReason:
    "The class is a marker found by name (applyCenterOfAttentionPenalty, called from move-effect-phase.ts) and never dispatched, and the WHEN used here is the always-on placeholder; B13/center-of-attention.test.ts drives the rule with an ally pair.",
  probes: [{ name: "plain battle against a single foe", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE for the whole rule, justified: the moment and every condition live in one engine function (applyCenterOfAttentionPenalty) that move-effect-phase.ts calls by name for EVERY damaging hit and that looks for this marker on the TARGET'S ALLY (and not on the holder). No dispatched hook exists for 'a foe damaged my ally', and the conditions read the foe's last move record and a once-per-move record, so a rebuilt attr cannot carry them. Requested: a WHEN 'When a foe damages my ally' with the slots holder (me), other (the foe), ally (the one hit), move and damage, plus the atoms 'the foe's move did not target me' and 'not yet penalised for this move' (R-B13-41), and the flag-key entry for while.active (R-B13-19; the minimal entry was added like the earlier chunks). Review of the numbers: the stat (Sp. Atk) and the change (-1) were literals, now constructor arguments 0 and 1 with the old values as defaults; applyCenterOfAttentionPenalty reads them from the protector's own marker attr, and uses Sp. Atk and -1 when none is found (same as before). Users: Center of Attention (5993, attr 1). ODDITIES (not fixed): (1) the function ignores `simulated`; (2) in a double battle with two marker holders the FIRST ally found in field order is the protector; (3) if the foe has no last move record the once-per-move check is skipped, so the penalty can repeat; (4) a spread move that hits both me and my ally is excluded only through the target list of the record.",
});
