/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 / Tier A calc-modifier ("cancel" check) whose effect is a package: bounce a foe's stat drop back (Mirror Armor,
// Crystalline Armor, In the Rough).
//
// Dispatch (stat-stage-change-phase.ts:206-221) happens only inside the OTHER-source drop branch: not a self-drop,
// `stages < 0`, abilities not ignored, `opponentPokemon` is known, the holder is not under Octolock and the drop is not
// itself a reflected one (`comingFromMirrorArmorUser`). Those are call-site rules of the game, kept outside the class.
//
// Clause classification (ReflectStatStageChangeAbAttr), in the original order:
//   canApply  `!!source && !cancelled.value`
//             - `!!source`: the drop has a foe behind it -> FEASIBILITY (call-site rule: self-drops, Octolock and an
//               already reflected drop never reach the class with a source). It cannot be a swappable IF: there is no
//               one to bounce the drop to without it.
//             - `!cancelled.value`: an earlier ability (Clear Body, Mist, ...) already blocked the drop -> the engine's
//               own cancel-chain convention, shared by every "cancel" class (not a game rule staff would change).
//   apply     (not simulated) unshift StatStageChangePhase(source, ... [stat], stages, selfTarget=false, showMessage,
//             ignoreAbilities=true ...) -> the EFFECT, the same stat and the same number of stages on the foe, and the
//             reflection ignores the foe's stat-drop immunities (ER). Always (even simulated) sets `reflectedStat = stat`
//             and `cancelled.value = true`.
// No RNG, no constructor closure, no binding.
import { ReflectStatStageChangeAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(ReflectStatStageChangeAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.stat-reflect",
  label: "Bounce stat drops back at the Pokemon that caused them",
  summary: () =>
    "When another Pokemon tries to lower one of my stats, the drop is blocked and the same drop lands on that Pokemon instead, even through its own stat protection.",
  synonyms: [
    "mirror armor",
    "reflect stat drops",
    "bounce back intimidate",
    "send stat drops back",
    "reverse stat drop",
    "stat drop reflection",
  ],
  examples: ["Send Intimidate and Growl back at the foe, like Mirror Armor"],
  params: [],
  noParamsReason:
    "Nothing to choose: the stat and the number of stages are copied from the drop that is being bounced back.",
  conditions: [],
  guards: [],
  feasibility: [
    "A foe must be behind the drop (my own drops, Octolock and drops that were already bounced are never reflected)",
    "A drop that another ability or effect already blocked is left alone",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      name: "a foe lowers my Attack (Growl)",
      axes: { foeMove: ["GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Users: Mirror Armor (attr 0), Crystalline Armor (attr 1), In the Rough (attr 1). Crystalline Armor and In the Rough are composed ER abilities: archetype-dispatcher.ts:5767 builds [CritImmunityAbAttr, ReflectStatStageChangeAbAttr]. Package reason: the class does not just negate, it queues a NEW StatStageChangePhase on the source with the SAME stat and stages read from the drop, with ignoreAbilities=true so the foe's Clear Body / Mist cannot stop the bounce, and a custom trigger message. The library 'Change a stat' effect needs a fixed stat and number of stages, and 'Block it' alone would drop the bounce; neither can take the stat and stages of the incoming drop (slots `stat` and `stages`). Requested: effect.reflect-stat-drop (requests/B04.md). The trigger and the (call-site) conditions are separate. Shared state: the per-instance field `reflectedStat` is written by apply (also when simulated) and read only by getTriggerMessage; it is message text only, but a rebuilt instance has its own copy.",
});
