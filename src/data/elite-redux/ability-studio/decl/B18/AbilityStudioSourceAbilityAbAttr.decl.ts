/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B18 chunk 5, Tier C engine-query. "Whenever a game rule asks whether I have <built-in ability>, the answer is yes".
//
// Source: ability-studio/runtime-components.ts, AbilityStudioSourceAbilityAbAttr extends AbAttr directly (showAbility false). Constructor
// `(sourceAbilityId, abilityName)`; the name only feeds two texts (`componentLabel` "<name> linked runtime behavior", `componentHookLabel`
// "Whenever a game system checks for <name>"), the hook id is the fixed text "source-ability-runtime-check". The class has no canApply and
// no apply and is NEVER dispatched. It is installed by installAbilityStudioSourceAbilityComponents (init.ts) on each of the 40 abilities
// the engine reads by identity (ABILITY_STUDIO_DIRECT_SOURCE_ABILITY_IDS) and the game finds it only through
//   * Pokemon.hasAbility(id) (pokemon.ts:3858): `source.ability.id === id || abilityStudioAbilityReferencesSource(source.ability, id, pokemon)`,
//     which is true when some attr of an ability the Pokemon has carries `abilityStudioSourceAbilityId === id` and
//     abilityStudioRuntimeComponentIsActive(attr, pokemon);
//   * abilityQuery / abilityHasEngineQuery / abilityIsById (runtime-capabilities.ts), which read the same reference first.
// The only behaviour is `isActiveFor(pokemon)`: always true, unless a composition restricted the attr with restrictToTriggeredActivation(),
// after which it is true only for Pokemon that activateFor() marked (a WeakSet keyed by battleData, created per instance, never shared).
//
// Why Tier C and not split further: the "effect" is an identity, not a rule. About a hundred engine sites ask "is this Pokemon X?" and each
// does something different (float, trap, boost, form change ...). Those rules are not in this class at all, so there is nothing left to
// factor out of it. What CAN be separated is already separate: the per-rule roles are AbilityStudioRuntimeCapabilityAbAttr (chunk 4, picked
// by sentence), and the notes below list which roles each of the 40 identities stands for, so staff who only want one rule use that block
// instead of the whole identity. There is no trigger and no condition to separate: the marker is a flag the game reads.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { AbilityStudioSourceAbilityAbAttr } from "#data/elite-redux/ability-studio/runtime-components";
import { SOURCE_ABILITY_OPTIONS, shownNameCodec, sourceAbilityCodec } from "./b18-chunk5-codecs";

export default defineDecl(AbilityStudioSourceAbilityAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Count as a built-in ability in the game's own rules",
  summary: () =>
    "While I have this, every game rule that checks for the ability you pick treats me as having it. Example: pick Levitate and I float and dodge Ground moves where the game checks.",
  synonyms: [
    "act like levitate",
    "count as guts",
    "copy all rules of an ability",
    "hidden built-in mechanics",
    "engine integration",
    "identity of an ability",
    "behave as the original ability",
    "full ability behaviour",
  ],
  examples: [
    "Count as Levitate everywhere the game checks for Levitate",
    "Be treated like Shadow Tag for trapping rules",
    "Keep every hidden rule of Truant",
  ],
  params: [
    {
      id: "source",
      ctorIndex: 0,
      path: "abilityStudioSourceAbilityId",
      control: "select",
      label: "Which built-in ability the game should think I have",
      editable: true,
      default: "Levitate",
      options: SOURCE_ABILITY_OPTIONS,
      codec: sourceAbilityCodec,
    },
    {
      id: "shownName",
      ctorIndex: 1,
      path: "componentLabel",
      control: "text",
      label: "Name shown for it in the editor (type the same ability name)",
      editable: true,
      default: "Levitate",
      codec: shownNameCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "The game reads this by asking whether a Pokemon has the ability, so nothing is dispatched and no condition can switch it on or off on its own",
    "When a composed rule restricts it to a trigger, it only counts for Pokemon that the trigger has marked",
    "Only the 40 abilities the game checks by name do anything: another pick would have no rule to answer",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The marker is consulted by Pokemon.hasAbility and the capability lookups, not by a dispatched moment, so there is no trigger for a twin to evaluate; B18/chunk5.test.ts proves the rebuild answers the same hasAbility and role questions for all 42 users, and engine-query.test.ts already runs original-against-carrier battles.",
  probes: [
    { name: "a Pokemon with the marker against a foe without contact damage", axes: { foeAbility: ["BALL_FETCH"] } },
  ],
  status: "decomposed",
  notes:
    "Tier C engine-query (counted apart; the foundation owns abilityQuery routing, this batch does not touch the call sites). `source` is the identity: staff pick one of the 40 ability names in b18-chunk5-codecs.ts, each mapped by hand to its id; a test checks the list against ABILITY_STUDIO_DIRECT_SOURCE_ABILITY_IDS. `shownName` only feeds the two editor texts (componentLabel and componentHookLabel); the class never checks it against the id. Users: 42 attrs, one per ability, installed by init.ts and not by init-abilities: Stench, Shadow Tag, Wonder Guard, Levitate, Illuminate, Truant, Plus, Minus, Forecast, Guts, Unburden, Poison Heal, Solar Power, Klutz, Snow Warning, Multitype, Flower Gift, Sheer Force, Heavy Metal, Overcoat, Prankster, Sand Force, Stance Change, Dark Aura, Fairy Aura, Aura Break, Berserk, Battle Bond, Comatose, RKS System, Gulp Missile, Ice Face, Mimicry, Wandering Spirit, Quick Draw, Wind Rider, Wind Power, Commander, Protosynthesis, Quark Drive, plus Dreadful Winds (20001) and Fairy Wings (20013). ROLES each identity stands for (the AbilityStudioRuntimeCapabilityAbAttr roles from ABILITY_STUDIO_ENGINE_QUERY_SOURCES, so a staff rule can take one rule instead of the whole identity): Aura Break aura-break-inversion; Battle Bond battle-bond-form; Berserk berserk-volatile-boost; Comatose comatose-sleep; Commander commander-hosting; Dark Aura dark-aura-field; Fairy Aura fairy-aura-field; Flower Gift flower-gift-form; Forecast forecast-form; Gulp Missile gulp-missile-form; Guts guts-status-boost; Heavy Metal heavy-metal-weight; Ice Face ice-face-form; Illuminate illuminate-dark-accuracy; Klutz klutz-item-suppression; Levitate levitate-float; Mimicry mimicry-terrain-type; Minus minus-pairing; Multitype multitype-plate-forms and multitype-type-lock; Overcoat overcoat-powder-immunity; Plus plus-pairing; Poison Heal poison-heal-recovery; Prankster prankster-dark-immunity; Protosynthesis protosynthesis-booster; Quark Drive quark-drive-booster; Quick Draw quick-draw-target; RKS System rks-system-memory-forms and rks-system-type-lock; Sand Force sand-force-moveset; Shadow Tag shadow-tag-trap-immunity; Sheer Force sheer-force-secondary-effects; Snow Warning snow-warning-moveset; Solar Power solar-power-moveset; Stance Change stance-change-forms; Stench stench-toxic-terrain; Truant truant-loafing; Unburden unburden-speed; Wandering Spirit wandering-spirit-swap; Wind Power wind-power-charge; Wind Rider wind-rider-boost; Wonder Guard wonder-guard-boss-catch and wonder-guard-single-hp. No ability's usage is left uncovered: every one of the 42 is the same two constructor arguments. ODDITIES, not fixed: (1) Dreadful Winds and Fairy Wings carry the Dark Aura and Fairy Aura marker (source ids 186 and 187, label text still says Dark Aura and Fairy Aura), so a Pokemon with either answers hasAbility(DARK_AURA) or hasAbility(FAIRY_AURA) yes: probably meant (they are Aura copies) but it also makes every Dark Aura identity check count them; (2) a Studio ability built only from role blocks does not answer hasAbility(X), only abilityQuery(role), so the few engine sites that still call hasAbility directly see only this marker; (3) the installer skips an ability that already has a marker, which is why the 42 attrs are exactly one per ability; (4) the per-instance activation WeakSet exists only after restrictToTriggeredActivation(), so a rebuilt instance starts unrestricted exactly like the original; (5) the hook id and both texts are free text built from the name, nothing checks them against the id.",
});
