/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B04 chunk 3 / Tier A calc-modifier, one list setting plus ONE constructor closure that does not map yet (Flower Veil,
// Jungle's Guard).
//
// Dispatch: pokemon.ts canSetStatus (the same loop as UserFieldStatusEffectImmunityAbAttr): after the target's OWN ability
// pass, `for (const pokemon of this.getAlliesGenerator())` asks every ALLY of the target (never the target itself) with
// `{ pokemon: ally, effect, cancelled, target, source: sourcePokemon }`. So the holder protects its partner, not itself.
// The class is found by the dispatch key of its parent (vocabulary/dispatch-keys.ts lists it as an alias).
//
// Constructor `(condition, ...immuneEffects)`. Clause classification (ConditionalUserFieldStatusEffectImmunityAbAttr), in the
// ORIGINAL order of `canApply = !cancelled.value && this.condition(target, source) && super.canApply(params)`:
//   1. `!cancelled.value`            the engine's cancel-chain convention (every "cancel" class starts with it) -> not a rule
//                                    staff would change; kept inside the class, not a guard id.
//   2. `condition(target, source)`   constructor closure ctor:0. Both users pass
//                                    `!!source && target.id !== source.id && target.isOfType(GRASS, true, true)`:
//                                      a. `!!source`                 a Pokemon is behind the status (no held item or terrain)
//                                      b. `target.id !== source.id`  the target did not give it to itself
//                                      c. `target.isOfType(GRASS, true, true)`  the protected Pokemon is a Grass type, where the
//                                         third argument (returnOriginalTypesIfStellar = true) means a Stellar Tera Pokemon still
//                                         counts with its ORIGINAL types.
//                                    It maps to NO library atom today: `mon.has-type` calls `isOfType(type)` (third argument
//                                    false, so a Stellar Tera Pokemon would stop being Grass), and no atom reads the source of the
//                                    status (the frame's `other` is the TARGET, there is no slot for the source). Both are
//                                    requested in requests/B04.md, so the closure is a legacy closure for now (bindings.ts).
//   3. `super.canApply(params)`      = `(!cancelled.value && immuneEffects.length === 0 && effect !== FAINT) || immuneEffects.includes(effect)`
//                                    -> the SETTING "which statuses" (constructor rest argument from index 1). The precedence slip of
//                                    the parent (see UserFieldStatusEffectImmunityAbAttr) cannot show here, because clauses 1 and
//                                    2 already ran first.
//   apply     inherited `cancelled.value = true` -> the EFFECT (library "Block it"). It never reads `simulated`.
// No RNG. getTriggerMessage is not overridden.
import { ConditionalUserFieldStatusEffectImmunityAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { STATUS_CHOICES, statusListCodec, statusWords } from "./shared-codecs";

export default defineDecl(ConditionalUserFieldStatusEffectImmunityAbAttr, {
  tier: "A",
  kind: "calc-modifier",
  when: "cancel.status-immunity-field",
  label: "Protect a qualifying partner from status conditions",
  summary: params =>
    `My partner cannot get ${statusWords(params.statuses)} from another Pokemon while it passes the check (Flower Veil: it is a Grass type).`,
  synonyms: [
    "flower veil",
    "jungle's guard",
    "protect grass partner from status",
    "partner status immunity",
    "grass partner cannot be burned",
    "ally status shield",
    "team status protection",
  ],
  examples: ["My Grass-type partner cannot be burned, poisoned or put to sleep, like Flower Veil"],
  params: [
    {
      id: "statuses",
      ctorIndex: 1,
      path: "immuneEffects",
      control: "text",
      label: "Status conditions my partner is immune to (comma separated; leave empty for every status)",
      editable: true,
      default: "Sleep",
      options: STATUS_CHOICES,
      codec: statusListCodec,
      spread: true,
    },
  ],
  conditions: [
    {
      // The check on the protected Pokemon and on who caused the status (see the header). Not swappable yet.
      slot: "ctor:0",
      ctx: "none",
      path: "condition",
      removable: false,
      editable: false,
    },
  ],
  guards: [],
  feasibility: [
    "Only my partner is protected, never myself (my own immunity is a separate block)",
    "Only a status that another Pokemon causes is blocked (not one the target gives itself, and not one with no Pokemon behind it)",
    "A status that another ability or effect already blocked is left alone",
    "Leaving the list empty blocks every status condition except fainting",
  ],
  effect: { id: "effect.negate", params: ["statuses"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The partner pass needs a double battle in which the holder's partner is hit by a status move, and no L2 scenario template does that for this trigger. Its only users keep a legacy closure, so the shared twin has nothing to rebuild. b04-chunk3.test.ts rebuilds the attr with the original closure and drives every status, cancelled yes/no and source/target case against the original, then runs a real double battle.",
  probes: [
    {
      name: "the foe paralyses (Glare) and burns (Will-O-Wisp) the Pokemon next to me",
      axes: { foeMove: ["GLARE", "WILL_O_WISP"] },
    },
  ],
  status: "decomposed",
  notes:
    "legacy-closure-pending-request. Users (live dump): Flower Veil (id 166, attr 0) and Jungle's Guard (id 5194, attr 0, built in archetype-dispatcher.ts case 463), both with an EMPTY list (every status except fainting) and the same closure; each also has the Grass-type battle-effect block (attr 1) and the Grass-type stat protection (attr 2). The closure of both users is bound as a legacy closure (bindings.ts) because it needs two atoms that do not exist (a type check that keeps the original types of a Stellar Tera Pokemon, and 'a Pokemon other than the target caused the status'); recomposeAttr therefore throws for these attrs and L1/L2 leave them out. The setting, label and dispatch are fully declared; only the check is opaque. Oddities, not fixed: the holder itself is NEVER protected by this attr (the engine asks only the target's allies), so a lone Flower Veil Grass Pokemon can still be burned, unlike the real games; the sibling SandStatusImmunityAbAttr (archetypes/sand-cloak.ts) extends this class with a different closure and is another batch's class.",
});
