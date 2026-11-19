/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 3 / calc modifier, Tier A (constructor closure at ctor:3). See ../PRECEDENTS.md.
//
// "While the game calculates the damage I take, IF I am in my intact form and <closure>, the hit does no damage, I may take recoil, and I
// break into my other form". A subclass of ReceivedMoveDamageMultiplierAbAttr (multiplier 0, so `apply` is replaced), dispatched through the
// same key. Constructor `(formIndex, i18nKey, recoil, condition = () => true)`; the parent gets `(condition, 0)` and keeps showAbility false.
// Clauses of canApply, in the ORIGINAL order (all stay in the class, the class is NOT edited):
//   1. `damage.value > 0`                        feasibility: nothing to block when there is no damage.
//   2. `pokemon.formIndex === this.formIndex`    the form the block works in, a SETTING (param `formNumber`, ctor 0).
//   3. `this.condition(pokemon, opponent, move)` the CONSTRUCTOR CLOSURE (ctor:3, `defend` shape: target, user, move), the CONDITION.
//   4. `!move.hitsSubstitute(opponent, pokemon)` feasibility: a hit that lands on my substitute is not blocked.
//   5. `canBreakForm(pokemon)`                   feasibility: the species has a form change triggered by an ability that can happen now
//                                                 (without it Disguise on a custom fusion would block every hit forever).
// apply (not simulated): damage = 0 and marked as nullified, then recoil `toDmgValue(maxHp * recoil)` as INDIRECT damage without a faint
// phase when recoil > 0, then `triggerPokemonFormChange(SpeciesFormChangeAbilityTrigger)`. The trigger message is the i18n key (ctor 1).
// The three effects (block, recoil, change form) happen in one `apply` with the form edge registered per species, so the effect is shown as one piece.
import { FormBlockDamageAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";

const MESSAGE_DISGUISE = "Say its disguise was busted";
const MESSAGE_AVOIDED = "Say it avoided the damage with its ability";

const MESSAGE_KEYS: Readonly<Record<string, string>> = {
  [MESSAGE_DISGUISE]: "abilityTriggers:disguiseAvoidedDamage",
  [MESSAGE_AVOIDED]: "abilityTriggers:iceFaceAvoidedDamage",
};

/** The two locale keys the game passes, shown as the sentence staff would read. Any other key reads back as "not representable". */
const messageCodec: ParamCodec = {
  toCtor: value => {
    const key = MESSAGE_KEYS[String(value)];
    if (key === undefined) {
      throw new Error(`"${String(value)}" is not one of the two messages (${MESSAGE_DISGUISE}; ${MESSAGE_AVOIDED})`);
    }
    return key;
  },
  fromInstance: raw => Object.keys(MESSAGE_KEYS).find(name => MESSAGE_KEYS[name] === raw),
};

/** The class stores a fraction of max HP (0.125); staff read a percent (12.5). */
const percentOfMaxHpCodec: ParamCodec = {
  toCtor: value => Number((Number(value) / 100).toPrecision(12)),
  fromInstance: raw => (typeof raw === "number" ? Number((raw * 100).toPrecision(12)) : undefined),
};

export default defineDecl(FormBlockDamageAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "calc.damage-taken",
  label: "Block a hit while in my intact form, then break form",
  summary: params =>
    `While I am in form number ${params.formNumber}, a hit that meets your rule does no damage, I take ${params.recoil}% of my max HP as recoil, and I change form. Example: Disguise, Ice Face.`,
  synonyms: ["disguise", "ice face", "mimikyu", "eiscue", "block the first hit", "free hit", "decoy", "busted form"],
  examples: ["Take no damage from the first hit, then change to my busted form, like Disguise"],
  params: [
    {
      id: "formNumber",
      ctorIndex: 0,
      path: "formIndex",
      control: "number",
      label: "Form number that blocks hits (0 = my first form)",
      editable: true,
      default: 0,
      min: 0,
      max: 20,
      step: 1,
      integer: true,
    },
    {
      id: "message",
      ctorIndex: 1,
      path: "i18nKey",
      control: "select",
      label: "Message shown when it blocks",
      editable: true,
      default: MESSAGE_DISGUISE,
      options: [MESSAGE_DISGUISE, MESSAGE_AVOIDED],
      codec: messageCodec,
    },
    {
      id: "recoil",
      ctorIndex: 2,
      path: "recoil",
      control: "number",
      label: "Damage I take after blocking (% of max HP, 0 = none)",
      editable: true,
      default: 12.5,
      min: 0,
      max: 100,
      step: 0.5,
      codec: percentOfMaxHpCodec,
    },
  ],
  conditions: [
    // The parent's protected `condition` field holds it. Disguise uses the constructor default `() => true`, Ice Face a physical-move test.
    { slot: "ctor:3", ctx: "defend", path: "condition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Only when the hit would really do damage",
    "Does not work against a hit that lands on my substitute",
    "Only when my species has a form to break into that can change right now (otherwise it would block every hit)",
    "Nothing changes in a simulated preview",
  ],
  // The block, the recoil and the form change are one `apply`; no library effect covers it, request R-B07-9 (effect.block-hit-and-break-form).
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a physical and a special hit against the intact form",
      axes: { foeMove: ["TACKLE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier A. Users (live dump, 2 attrs): Disguise (209, attr 2): form 0, message disguiseAvoidedDamage, recoil 0.125 (12.5%), closure `() => true`; Ice Face (248, attr 4): form 0, message iceFaceAvoidedDamage, recoil 0, closure `(_target, _user, move) => move.category === PHYSICAL`. showAbility is false for both (set by the parent call, not a constructor argument). The archetype CurseAttackerOnFormBlockDamageAbAttr (another batch) extends this class and is swapped into one ER ability by archetype-dispatcher.ts; it is a separate class with its own declaration. ENGINE QUERY ASPECT: init-abilities.ts line 2054 and the ER custom form-change setup look for this class by NAME / presence, so a rebuilt attr must keep the class name. SUSPECTED GAME QUIRK (not fixed, a TODO in the source): the class assumes the intact form is the species' base form and the broken form is the next one. Round trip note: a message key other than the two above has no staff wording and reads back as not representable.",
});
