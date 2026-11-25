/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 4, Tier C engine-query. "While I have this, the game treats me as playing a certain role in one of its rules".
//
// Source: ability-studio/runtime-components.ts, AbilityStudioRuntimeCapabilityAbAttr extends AbAttr directly (showAbility false). Constructor
// `(abilityStudioCapability, componentLabel, componentHookId, componentHookLabel)`. It is NEVER dispatched: the game finds it by asking
//   * abilityQuery(pokemon, role) / abilityHasEngineQuery(ability, role)  -> abilityStudioAbilityHasCapability (runtime-capabilities.ts):
//     some attr of the ability has `abilityStudioCapability === role` and abilityStudioRuntimeComponentIsActive(attr, pokemon);
//   * pokemon.hasAbilityStudioCapability(role) for the 19 direct runtime effects (accelerate-charge-skip ... upcycle-poison-boost).
// The class has no canApply and no apply. The only behaviour is `isActiveFor(pokemon)`: always true, unless a composition restricted the attr
// with restrictToTriggeredActivation(), after which it is true only for Pokemon that activateFor() marked (a WeakSet keyed by battleData,
// created per instance, never shared). The four texts are only what the editor shows for the component.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { AbilityStudioRuntimeCapabilityAbAttr } from "#data/elite-redux/ability-studio/runtime-components";
import { rolePickCodec } from "./b18-chunk4-codecs";
import { ROLE_PICKS } from "./b18-chunk4-roles";

export default defineDecl(AbilityStudioRuntimeCapabilityAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "The game treats me as playing a certain role",
  summary: params =>
    `While I have this, the game lets me play this role in its own rules: ${params.capability}. Pick the sentence that says what should happen.`,
  synonyms: [
    "built-in game rule",
    "runtime effect",
    "hidden mechanic",
    "special game rule",
    "like levitate",
    "like klutz",
    "game rule flag",
    "copy a built-in mechanic",
  ],
  examples: [
    "Float above the ground, like Levitate",
    "Make my held item do nothing, like Klutz",
    "Moonlight restores at least 75% of max HP",
  ],
  params: [
    {
      id: "capability",
      ctorIndex: 0,
      path: "abilityStudioCapability",
      control: "select",
      label: "Which game rule I take part in",
      editable: true,
      default: "Skip the charge turn of charging moves",
      options: ROLE_PICKS.map(pick => pick.word),
      codec: rolePickCodec(ROLE_PICKS),
    },
    {
      id: "componentLabel",
      ctorIndex: 1,
      path: "componentLabel",
      control: "text",
      label: "Name shown for this rule in the editor",
      editable: true,
      default: "Direct runtime effect",
    },
    {
      id: "momentId",
      ctorIndex: 2,
      path: "componentHookId",
      control: "text",
      label: "Internal name of the moment this rule is read (set by the game)",
      // Not editable: it is the key the editor groups the component under; a free change would split the component from its siblings.
      editable: false,
      default: "runtime-effect",
    },
    {
      id: "momentLabel",
      ctorIndex: 3,
      path: "componentHookLabel",
      control: "text",
      label: "Sentence shown for the moment this rule is read",
      editable: true,
      default: "While the game checks this rule",
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The game reads this by asking which role a Pokemon plays, so nothing is dispatched and no condition can switch it on or off on its own",
    "When a composed rule restricts it to a trigger, it only counts for Pokemon that the trigger has marked",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The marker is consulted by the game's own rules (abilityQuery and its capability lookups), not by a dispatched moment, so there is no trigger for a twin to evaluate; B18/chunk4.test.ts proves the rebuild answers the same capability question for all 23 users and for every role.",
  probes: [{ name: "a Pokemon with the marker and one without it", axes: {} }],
  status: "decomposed",
  notes:
    "Tier C engine-query (counted apart; the foundation owns abilityQuery routing, this batch does not touch the call sites). The `capability` setting is the role: staff pick one of the 62 sentences in b18-chunk4-roles.ts (the 19 direct runtime effects the Studio builds, then the 43 engine roles the game used to read by ability name), each mapped by hand to its id; a test checks the list against ABILITY_STUDIO_RUNTIME_CAPABILITIES, so a new role makes it fail. Users (23 attrs in 20 abilities): Accelerate (5205 attr 1), Angel's Wrath (5175 attr 0), Aurora Borealis (5029 attr 2), Big Leaves (5111 attr 0), Burn Fatigue (6031 attr 0 and 1), Chloroplast (5006 attr 0), DNA Scramble (5492 attr 0), Deadly Sentencing (6011 attr 0), Minion Control (5299 attr 1), Moon Spirit (5209 attr 2), Moonarch (6074 attr 3), Reap and Sow (6054 attr 2), Relic Stone (5567 attr 1), Sleeping In (6056 attr 1 and 2), Solar Flare (5104 attr 0), Spatial Magic (6052 attr 0), Symbiosis (180 attr 0), Temporal Rupture (5531 attr 1), Titan (5934 attr 2), Upcycle (5969 attr 0 and 1). All 23 use direct runtime effects; no shipped ability uses an engine role, but engine roles are what Studio-built abilities carry (engine-query.test.ts builds them). The WHEN is `while.active` because the class is never dispatched; it is listed among the while-active flag keys (a one-word library edit, request R-B18-0c, same as the chunk 1 markers). The three texts (componentLabel, hook id, hook label) only feed the editor's component list; the hook id is shown but not editable. ODDITIES, not fixed: (1) several abilities carry the same role (Chloroplast, Solar Flare and Big Leaves all carry chloroplast-sun-moves; Relic Stone and Titan both carry relic-stone-stab-suppression; Moon Spirit and Moonarch both carry moon-spirit-moonlight-heal) and each carries it as its own instance; (2) the per-instance activation WeakSet exists only after restrictToTriggeredActivation(), so a rebuilt instance starts unrestricted exactly like the original; (3) hook id and labels are free text in the class, nothing checks them against the role.",
});
