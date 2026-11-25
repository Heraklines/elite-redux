/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 2. Package (Tier C). "For every KO I score, heal my lowest-HP living ally by 10% of its max HP; from the second KO of the turn the heal also cures its status."
//
// Source: src/data/elite-redux/abilities/cleansing-light.ts, class CleansingLightAbAttr (extends PostVictoryAbAttr; showAbility true).
// Clauses, in order:
//   canApply  lowestAlly(pokemon) !== undefined, i.e. pokemon.getAllies() has an ally that isActive(true) and is not fainted   -> feasibility (the effect needs a target)
//   apply     1. if simulated: return                                                                    -> effect-side (respects simulated)
//             2. koCount = bumpKoCount(pokemon): per-holder record { key: "wave:turn", count }, +1 per KO, restarts when the turn changes   -> state (module WeakMap)
//             3. ally = lowestAlly(pokemon) again (the lowest HP wins, the first of equals)
//             4. if the ally is not at full HP: unshift PokemonHealPhase(ally, toDmgValue(maxHp * healFraction), message "postTurnHeal")   -> effect
//             5. if koCount >= cureFromKo and the ally has a status: resetStatus and queue "<name>'s status was cleansed!"                 -> effect rider (a typed param)
// Dispatch: faint-phase.ts applyAbAttrs("PostVictoryAbAttr", { pokemon: defeatSource }) once per KO (WHEN event.on-win). No random draw.
// Constructor change (behaviour-neutral): healFraction (default 0.1) and cureFromKo (default 2) are constructor arguments; the exported constants stay.
import {
  CLEANSING_LIGHT_CURE_FROM_KO,
  CLEANSING_LIGHT_HEAL_FRACTION,
  CleansingLightAbAttr,
} from "#data/elite-redux/abilities/cleansing-light";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";

// Staff think in percent, the class in a fraction: 10 <-> 0.1 (v / 100 gives the same double as the literal).
const percentCodec: ParamCodec = {
  toCtor: value => Number(value) / 100,
  fromInstance: raw => (typeof raw === "number" ? Math.round(raw * 100) : undefined),
};

export default defineDecl(CleansingLightAbAttr, {
  tier: "C",
  kind: "package",
  when: "event.on-win",
  label: "Heal my weakest ally after each knockout",
  summary: params =>
    `Each time I knock out a Pokemon, my ally with the lowest HP heals ${params.healPercent}% of its max HP. From knockout number ${params.cureFromKo} of the turn on, the ally is also cured of its status.`,
  synonyms: [
    "cleansing light",
    "heal ally on ko",
    "ko heal",
    "heal the weakest ally",
    "cure ally status",
    "heal teammate after knocking out",
    "doubles heal",
  ],
  examples: [
    "When I KO a foe, heal my lowest-HP ally by 10%",
    "Second KO in one turn also cures my ally's status, like Cleansing Light",
  ],
  params: [
    {
      id: "healPercent",
      ctorIndex: 0,
      path: "healFraction",
      control: "slider",
      min: 1,
      max: 100,
      step: 1,
      integer: true,
      label: "Heal (% of the ally's max HP)",
      editable: true,
      default: Math.round(CLEANSING_LIGHT_HEAL_FRACTION * 100),
      codec: percentCodec,
    },
    {
      id: "cureFromKo",
      ctorIndex: 1,
      path: "cureFromKo",
      control: "number",
      min: 1,
      max: 9,
      step: 1,
      integer: true,
      label: "Cure the ally's status from this knockout of the turn on (1 = every one, 2 = the second)",
      editable: true,
      default: CLEANSING_LIGHT_CURE_FROM_KO,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "A living ally must be standing on the field (in singles the heal is wasted)",
    "The ally at full HP is not healed, but the status cure can still happen",
    "It does nothing in a preview",
  ],
  effect: { id: "effect.package", params: ["healPercent", "cureFromKo"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [{ name: "the holder knocks out a foe while its ally is hurt", axes: {} }],
  status: "decomposed",
  notes:
    "PACKAGE, justified. 1 attr in 1 ability: Cleansing Light (5912 attr 0). The trigger (WHEN event.on-win, which fires once per KO the holder scores) is a separate swappable block and the class has no condition of its own beyond the living-ally feasibility, which is the effect's target and stays in the class. The effect cannot be split with the current library because (1) the target is 'the ally with the lowest HP' and effect.heal-percent / effect.cure-status can only target the holder, the other Pokemon or a side, and (2) the rider depends on how many KOs the holder scored THIS TURN, a per-turn counter (module WeakMap keyed by holder with a wave:turn key) that the library has no atom for (time.nth-use counts per battle). Requests R-B15-9 (target 'my weakest ally') and R-B15-10 (atom 'KOs I scored this turn') would let it become WHEN + heal-percent + (IF kos >= 2) cure-status. Both numbers (heal share, KO number that starts the cure) are typed params. State: erCleansingLightKoState is read by the AI snapshot (ai/combat-private-state.ts), so the WeakMap stays as it is. Suspected oddities, NOT fixed: (1) the KO counter only runs when canApply found a living ally, so a KO scored while no ally stands does not count toward 'second KO this turn' (and the `if (!ally)` branch after the bump can never be reached); (2) the status cure message is a hard-coded English string, not an i18n key; (3) the heal message reuses the 'postTurnHeal' text.",
});
