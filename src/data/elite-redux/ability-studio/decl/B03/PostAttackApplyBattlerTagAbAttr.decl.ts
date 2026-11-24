/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03. Tier B, RNG inside canApply. Read the class before changing this file.
//
//   canApply (now guards && gate, original clause order kept for everything impure):
//     guards  the target's ability must not ignore move effects (Shield Dust style) and the target is not the user
//     gate    the move deals damage  &&  (contact, only when `contactRequired`)  &&  the chance roll
//     (no residual: the class never asks whether the battler tag can be added)
//   apply     adds the tag (respects `simulated`); with several effects it draws once more to pick one
//
// The chance is a CLOSURE `(user, target, move) => percent` in the constructor. Most users return a constant
// (`() => 50`), some return "10 if I am a Water type using a Water move, otherwise 0". Either way the original draws
// `randBattleSeedInt(100)` BEFORE it reads the closure, so the draw happens even when the closure answers 0. The library
// form therefore puts `rng.chance` first and the closure's yes/no part after it: draw d, true when d < N and the
// condition holds, the same answer and the same number of draws.
//
// The library gate replaces the whole gate, so constructor argument 1 (the chance closure) and the `contactRequired`
// flag are not read by a rebuilt instance: the chance is the `rng.chance` atom in the gate and contact is a
// `move.flag` atom. A rebuild still passes the original `contactRequired` value (so the fingerprint matches) and a
// placeholder closure at index 1 that nothing calls.
import { PostAttackApplyBattlerTagAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { BattlerTagType } from "#enums/battler-tag-type";

const TAGS = BattlerTagType as unknown as Readonly<Record<string, string>>;

/** BattlerTagType is a STRING enum, so the number-based list codec of param-codecs.ts cannot be used. */
const battleEffectListCodec: ParamCodec = {
  toCtor: value =>
    String(value)
      .split(",")
      .map(part => part.trim())
      .filter(part => part.length > 0)
      .map(part => {
        const resolved = TAGS[part];
        if (typeof resolved !== "string") {
          throw new Error(`"${part}" is not a known battle effect`);
        }
        return resolved;
      }),
  fromInstance: raw => {
    if (!Array.isArray(raw) || !raw.every(item => typeof item === "string")) {
      return;
    }
    return raw.map(item => Object.keys(TAGS).find(key => TAGS[key] === item) ?? String(item)).join(",");
  },
};

/** Never called: the library gate that every rebuilt instance carries decides the chance. */
const supersededChance = (): number => 0;

export default defineDecl(PostAttackApplyBattlerTagAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Sometimes inflict a battle effect on the target after I hit",
  summary: params =>
    `After my damaging attack lands, a chance roll can put ${params.effects} on the target. Set the chance and any extra conditions in the conditions list.`,
  synonyms: [
    "chance to flinch",
    "chance to confuse",
    "chance to infatuate",
    "bleed on hit",
    "frostbite on hit",
    "cute charm",
    "stench",
    "poison touch",
    "extra effect on hit",
  ],
  examples: [
    "20% chance to confuse the target when my move makes contact",
    "10% chance to make the target flinch with my damaging moves",
  ],
  params: [
    {
      id: "contactRequired",
      ctorIndex: 0,
      path: "contactRequired",
      control: "boolean",
      label: "Needs contact (shown only; the contact condition in the conditions list decides)",
      editable: false,
      default: false,
    },
    {
      id: "effects",
      ctorIndex: 2,
      path: "effects",
      control: "text",
      label: "Battle effects (comma separated; one is picked at random when there are several)",
      editable: true,
      gateIndependent: true,
      default: "CONFUSED",
      options: enumOptions(BattlerTagType),
      codec: battleEffectListCodec,
      spread: true,
    },
  ],
  fixedCtorArgs: { 1: supersededChance },
  conditions: [
    // The gate is the group [move.damaging, move.flag MAKES_CONTACT (only if contact is needed), rng.chance, then the
    // yes/no part of the original chance closure], in that order. The chance roll stays after every cheap check.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  // The two safety rules below are guards in spirit. They are not in the guard registry yet (see requests/B03.md), so
  // they are written as "also requires" lines; they live in `guards()` of the class and cannot be removed.
  guards: [],
  feasibility: [
    "The target's ability must not ignore the extra effects of attacks (like Shield Dust does)",
    "The target must not be the user itself",
  ],
  effect: { id: "effect.apply-tag", params: ["effects"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: {
    rng: "both",
    rngOrder: [
      "canApply gate: randBattleSeedInt(100) < chance, drawn only after the damaging-move and contact checks passed, and drawn even when the chance is 0 or 100",
      "apply: pick one of the effects (only when there are several; every user has exactly one)",
    ],
    state: "none",
    simulated: "ignores",
  },
  probes: [
    {
      // The L2 scenario hits twice (Tackle, then the multi-hit Double Slap), both contact moves. The non-contact and status-move
      // paths are proven by test/tests/elite-redux/decomp/B03/gate-refactor.test.ts (every roll 0 to 99, every clause).
      name: "contact (Tackle) and multi-hit contact (Double Slap) attacks",
      axes: {},
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. 24 attrs of 23 ability ids (13 bound, 11 legacy). Gate bindings: constant chance (Oblivious 20, Cute Charm, Prim and Proper, Pure Love, Tender Affection 50 with contact; Wings of Pestilence 20 and 10 without) and 'chance if my type and my move type match' (Hydrate, Waterborne x2, Spectralize, Deviate, Mob Boss, Two-Faced). Legacy gates (Spectralize: no L2 scenario reaches a Ghost move because the harness foe is Normal), each waiting for a library request (requests/B03.md): Stench and Pungency (flinch attribute and substitute test), Balloon Bomb, Hollow Ice Zone and Wrestle Showman (a chance of 100 still draws, `rng.chance` does not), Frostmaw, Deep Cuts, Puncture, Sharp Talons and Icicle Fist (raw `move.hasFlag`, which ignores flag-injecting abilities, while `move.flag` honours them). Quirks recorded, not fixed: the class ignores `simulated` in canApply (it draws and rolls even for a simulated call, `rng.chance` answers true without a draw); the extra clauses guards() now run before the damaging-move test (all pure, so the draw count is unchanged); a chance of 0 still consumes a draw.",
});
