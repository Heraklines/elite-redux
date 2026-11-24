/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A calc-modifier, one setting (which stat), no closure (Evaporate).
//
// The class body is EMPTY: `class UserFieldSelfStatDropImmunityAbAttr extends SelfStatDropImmunityAbAttr {}`. Its whole
// behaviour is the parent's canApply / apply / message (see SelfStatDropImmunityAbAttr.decl.ts, clause by clause). What
// the subclass adds is only WHO is asked: stat-stage-change-phase.ts:259 asks every holder of the base class about its OWN
// drops (a subclass instance matches by `instanceof`), and then lines 268-278 ask holders of THIS exact class about their
// DOUBLES PARTNER's self-drop. So an Evaporate holder is protected from its own drops AND shields its partner from the
// partner's own drops.
//
// Clause classification: identical to the parent (cancelled-chain convention, `stages < 0`, the `stat` setting).
// The ability-level condition of the only user (Evaporate) is NOT a constructor argument but an attr condition added by the
// archetype dispatcher (`attr.addCondition`, archetype-dispatcher.ts:7425): "my side has Mist up" =
// `!!arena.getTagOnSide(MIST, own side)`. It maps one to one onto the library condition `field.arena-tag{ MIST, holder-side }`
// (`getTagOnSide(tag, sideOf(holder, "holder-side"))`), but the declaration contract has no slot for attr-level conditions
// (requests/B04.md); the rebuild copies it unchanged (recomposeAttr copies `extraCondition`).
// No RNG, no closure, no binding.
import { UserFieldSelfStatDropImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { EVERY_STAT, oneStatOrEveryCodec, STAT_CHOICES, statWords } from "./shared-codecs";

export default defineDecl(UserFieldSelfStatDropImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.stat-protect",
  label: "Protect me and my partner from their own stat drops",
  summary: params =>
    `Neither I nor my partner lose ${
      statWords(params.stat) === "every stat" ? "any stat" : `${statWords(params.stat)}`
    } from our own moves, like Overheat. Foes can still lower stats.`,
  synonyms: [
    "evaporate",
    "protect partner from self drops",
    "ally no recoil stat drops",
    "team self drop immunity",
    "doubles partner overheat",
    "shield ally stat drops",
  ],
  examples: ["My partner's Overheat and Close Combat stop lowering its stats, like Evaporate under Mist"],
  params: [
    {
      id: "stat",
      ctorIndex: 0,
      path: "protectedStat",
      control: "select",
      label: "Which stat is protected (or all stats)",
      editable: true,
      default: EVERY_STAT,
      options: [EVERY_STAT, ...STAT_CHOICES],
      codec: oneStatOrEveryCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "Only stat drops are blocked (a boost always lands)",
    "Only drops that the Pokemon causes itself are checked (a drop from a foe is the job of the other stat-protection block)",
    "In a double battle the same block also covers my partner's own drops",
    "A drop that another ability or effect already blocked is left alone",
  ],
  effect: { id: "effect.negate", params: ["stat"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The L2 template for this trigger makes the FOE lower the holder's stat, which never reaches the self-drop branch (and the Mist condition of its only user is never true in it). The self-drop and partner paths are proven by b04-chunk2.test.ts: a double battle with an Evaporate holder under Mist, the partner and the holder use Superpower, original against rebuild.",
  probes: [
    {
      name: "a foe lowers my Attack (Growl), which is not a self drop",
      axes: { foeMove: ["GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "User: Evaporate (id 5180, attr 1; attr 0 is TypedImmunityWithArenaTagAbAttr, a later batch). Built by archetype-dispatcher.ts:7425 `new UserFieldSelfStatDropImmunityAbAttr()` then addCondition(Mist on own side). The class has an empty body, so there is no bug to note in it, but the L1 identity check must show the ability-level condition carried over. Oddity: because the base pass matches by instanceof, an Evaporate holder is also protected from its OWN drops, with the same Mist condition (`getCondition` runs for it too).",
});
