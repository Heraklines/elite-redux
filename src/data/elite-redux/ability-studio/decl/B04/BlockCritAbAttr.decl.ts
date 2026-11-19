/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 3 / Tier A calc-modifier, no setting, no closure (Battle Armor, Shell Armor, Stalwart, Toxic Shell, Fortress, ...).
//
// Class (ab-attrs.ts:4227): `constructor() { super(false) }` (the ability is never shown in the flyout) and one override:
//   apply      `blockCrit.value = true` -> the EFFECT. There is NO canApply override: the AbAttr default answers true, so the
//              class has no clause at all (no condition, no guard, no `!cancelled` check: the holder is a fresh BooleanHolder).
//              It never reads `simulated`, and the call site does not pass one.
// Dispatch: pokemon.ts:6449 in `getAttackDamage` (and only there): `applyAbAttrs("BlockCritAbAttr", { pokemon: this, blockCrit })`
// with `this` the DEFENDER, right after the crit roll. The NoCritTag arena effect (Lucky Chant) is checked the same way
// through the same holder, and `isCritical &&= !blockCrit.value` decides.
// RNG: the crit roll `globalScene.randBattleSeedInt(critChance)` happens BEFORE this block, so blocking a crit consumes the
// same random numbers as not blocking it. The class itself draws nothing.
// The subclass CritImmunityAbAttr (archetypes/crit-mod.ts) is another batch's class.
import { BlockCritAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(BlockCritAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.crit",
  label: "Be immune to critical hits",
  summary: () =>
    "Attacks against me can never be critical hits. Example: a hit that would have been critical does normal damage instead.",
  synonyms: [
    "battle armor",
    "shell armor",
    "no crits",
    "cannot be critically hit",
    "crit immunity",
    "block critical hits",
    "lucky chant",
  ],
  examples: ["Critical hits never land on me, like Battle Armor"],
  params: [],
  noParamsReason:
    "The block has no settings: it always stops every critical hit against its holder. What can change is when it works, which comes from the trigger and from conditions added on top, not from a number or a choice inside the block.",
  conditions: [],
  guards: [],
  feasibility: [],
  // "Stop critical hits against me" is the library effect that changes `blockCrit`, the value this trigger lets staff change
  // (the general "Block it" changes `cancelled`, which would not match).
  effect: { id: "effect.block-crit", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a foe hits me with a physical and a special move that always crit",
      axes: { foeMove: ["BITE", "WATER_GUN"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users (live dump, 16 attrs of 15 abilities): Battle Armor, Shell Armor, Stalwart (attr 1, added by the ER rebalance patch), Faraday Cage, Toxic Shell, Voltron (attr 1 under two ids), Shattered Armor, Fortress, Droideka, Exosuit, Exo Armor, Thunder Gods Vessel, Malicious Empathy, Old Ocean Relic, Spin To Win. Whether Mold Breaker style effects bypass a user is an ability-level flag (`ignorable`), not part of this block (Stalwart is deliberately not ignorable, see init-elite-redux-vanilla-rebalance.ts:1495). The L2 template makes the foe crit (`crits: true`), and the class is evaluated at that moment. The matching library effect `effect.block-crit` (modifies `blockCrit`) was added with this chunk, so a staff-built rule 'When the game checks if I can be critically hit, then Stop critical hits against me' passes the composition validator.",
});
