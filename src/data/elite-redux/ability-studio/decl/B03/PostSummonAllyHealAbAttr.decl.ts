/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 3. Tier A, event-effect on entry, no constructor closure.
//
//   canApply   at least one ADJACENT ally is active (`pokemon.getAdjacentAllies().some(a => a.isActive(true))`)
//   apply      unless simulated, for EACH active adjacent ally: unshift a PokemonHealPhase healing
//              `toDmgValue(holder.getMaxHp() / healRatio)` with the message "<ally> had its HP restored" (the amount is a
//              share of MY max HP, not of the ally's); `healRatio` is `healRatio || 4`; the animation is skipped unless
//              `showAnim`
//
// `canApply` is effect-side feasibility ("there is an ally to heal"): the library atom `party.ally-exists` asks
// `getAlly()`, which is not the same predicate (adjacent AND active, any ally in a triple), so it is not used and the
// check stays in the class. Both constructor arguments are params.
import { PostSummonAllyHealAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(PostSummonAllyHealAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Heal my ally when I enter",
  summary: params =>
    `When I enter the battle, each active ally next to me is healed by 1/${params.healRatio} of my max HP. Example: 4 heals a quarter of my max HP.`,
  synonyms: [
    "hospitality",
    "heal partner on entry",
    "restore ally hp",
    "ally recovery",
    "heal teammate",
    "butter up",
    "food lovers",
  ],
  examples: ["Heal my ally by a quarter of my max HP when I enter, like Hospitality"],
  params: [
    {
      id: "healRatio",
      ctorIndex: 0,
      path: "healRatio",
      control: "number",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Heal share of my max HP (4 = a quarter, 2 = half)",
      editable: true,
      default: 4,
    },
    {
      id: "showAnim",
      ctorIndex: 1,
      path: "showAnim",
      control: "boolean",
      label: "Play the healing animation",
      editable: true,
      default: false,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "At least one active ally standing next to me must exist, otherwise nothing happens and the ability does not show",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.heal-percent", params: ["healRatio"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 3 attrs of 3 abilities, no closure: Hospitality (301), Butter Up (5389) and Food Lovers (5595), all `(4, true)`: a quarter of MY max HP, with the animation. The library effect `effect.heal-percent` heals a percentage of the TARGET's max HP; this class heals the ALLY by a share of the HOLDER's max HP, so a new effect (or a 'heal by a share of my max HP' option) is requested in requests/B03.md. `healRatio || 4` means a ratio of 0 becomes 4; the param's minimum is 1 so staff cannot hit that. In a triple battle every active adjacent ally is healed (the code comment says the old check missed the second ally). Quirk recorded, not fixed: the heal message always reads 'ally had its HP restored' even when the ally is at full HP (the heal phase prints it anyway).",
});
