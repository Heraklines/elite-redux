/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 3. Tier C, engine-query (a presence marker). "Once per battle, when an attack would knock out my ally, it stays at 1 HP and the attacker is Drenched for 2 turns."
//
// Source: src/data/elite-redux/abilities/life-preserver.ts, class LifePreserverAbAttr (extends AbAttr; constructor passes showAbility false; apply is empty, there is no canApply of its own).
// The effect is erTryLifePreserver(defender, source), called from Pokemon.damageAndUpdate (src/field/pokemon.ts) only for DIRECT damage with a source:
//   `!isIndirectDamage && source && damage > 0 && this.hp - damage <= 0 && erTryLifePreserver(this, source)`, then damage = hp - 1. In order:
//   1. !source || defender.hp < 1 -> false                                  -> guard
//   2. holder = the FIRST ally of the defender that has an active LifePreserverAbAttr (by constructor name) and LIFE_PRESERVER_USED.get(ally) !== wave
//        -> conditions: the holder is my ALLY (not the one hit), once per battle (module WeakMap holder -> wave index; read by the AI via erLifePreserverUsedWave)
//   3. write the wave; queue the message; source.addTag(ER_DRENCHED, turns, NONE, holder.id)  (Water types and drench-immune attackers are filtered by the tag's own canAdd)
// Constructor change (behaviour-neutral): the Drench turns (default 2) are a constructor argument; the seam reads them from the holder's live attr.
// No random draw.
import { LifePreserverAbAttr } from "#data/elite-redux/abilities/life-preserver";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(LifePreserverAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Keep my ally alive at 1 HP and Drench the attacker",
  summary: params =>
    `Once per battle, when an attack would knock out my ally, it stays at 1 HP and the attacker is Drenched for ${params.drenchTurns} turns (it moves last in its priority bracket).`,
  synonyms: [
    "life preserver",
    "save my ally",
    "protect partner",
    "endure for ally",
    "lifeguard",
    "doubles bodyguard",
    "slow the attacker",
  ],
  examples: ["Once per battle my partner survives a lethal attack at 1 HP and the attacker is slowed"],
  params: [
    {
      id: "drenchTurns",
      ctorIndex: 0,
      path: "drenchTurns",
      control: "number",
      min: 1,
      max: 5,
      step: 1,
      integer: true,
      label: "Turns the attacker stays Drenched",
      editable: true,
      default: 2,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "It protects my ally, not me, so it needs a living ally on the field (doubles)",
    "It works only against a direct attack, not poison, weather or recoil",
    "It can be used only once per battle",
    "Water-type attackers and attackers that resist Drench are not Drenched, but the ally still survives",
    "It is built into the game's damage handling and is not part of this block",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "battle", simulated: "ignores" },
  l2StaticReason:
    "The marker is consulted by the damage handling when an attack would knock the ally out, which is not a dispatched moment (and needs a doubles ally); the twin compares whole battles of the one user instead.",
  probes: [{ name: "an attack that would knock my ally out", axes: { foeMove: ["TACKLE"] } }],
  status: "decomposed",
  notes:
    "Engine-query (presence marker read by erTryLifePreserver by constructor name), counted apart from the decomposed classes; the foundation owns any abilityQuery routing. 1 attr in 1 ability: Life Preserver (5916 attr 0). The class has no condition of its own; the ally test, the once-per-battle memory and the effect live in the engine seam and are requested as library blocks: R-B15-16 (the moment 'when I or my ally would be knocked out' with the effect 'stay at 1 HP') and R-B15-18 (effect 'apply a battle effect to the attacker for N turns'; effect.apply-tag exists but is not implemented). The only number is typed (Drench turns). Suspected oddities, NOT fixed: (1) the survival message is hard-coded English; (2) the holder is the first ally found with an unspent charge, so with two holders in triples only the first is used up; (3) like Last Host the once-per-battle memory is keyed by the WAVE index, so a re-fought wave re-arms it; (4) the clamp runs in a fixed chain with the other ER survive hooks (Eclipse Wing, Cracked Vessel) after it, so which one fires first depends on that order.",
});
