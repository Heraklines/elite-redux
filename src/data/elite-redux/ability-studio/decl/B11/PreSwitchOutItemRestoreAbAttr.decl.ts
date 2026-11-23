/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B11 chunk 2 / event-effect (Tier B: the "something to give back" test is the gate inside canApply).
//
// Read by hand from archetypes/pre-switch-out-item-restore.ts. PreSwitchOut hook (WHEN "when I switch out", dispatched by
// SwitchSummonPhase for the Pokemon leaving the field), constructor with no arguments (`super(true)`: shows the ability banner).
//   canApply is now `guards && gate`, in the ORIGINAL clause order (nothing stays behind as a residual):
//     1. guard: `pokemon.isFainted()` -> false                      (a fainted holder gets nothing back; the engine never dispatches
//                                                                    this hook on a faint, so it is a belt-and-braces rule)
//     2. gate, CONDITION: `ateBerry || canRestoreItem`
//          ateBerry        = `summonData.berriesEatenLast.length > 0`   (a berry was eaten and is still recorded)
//          canRestoreItem  = `getHeldItems().length === 0 && memory.length > 0`   (empty-handed AND something was remembered on entry)
//   apply: not when simulated. Then, in this order: `summonData.berriesEatenLast = []` (eaten berries count as uneaten), and only when
//     the holder holds nothing now and the memory is not empty: each remembered item is cloned back onto the holder
//     (`pokemonId` set, `globalScene.addModifier(restored, true)`) and `updateModifiers` runs once. No random draw.
//
// Clause 1 is a guard (restoring items to a fainted Pokemon would be a bug). Clause 2 is the condition staff would change ("also when
// I took damage", "only when I lost my item"). Both of its halves have no library atom yet: "a berry was eaten and is still recorded"
// (request R-B11-C2-04) and "I remember items from when I entered" (request R-B11-C2-05); the empty-handed half is the atom item.none.
// One gate slot holds one binding, so the whole gate is a legacy closure for now (reusable as a whole, counted as undecomposed). The
// moment both atoms exist it is `any [ I-ate-a-berry, all [ item.none, I-remember-items ] ]`.
//
// The effect is one piece: the memory is the module-private WeakMap of the paired snapshot attr (PostSummonRetrieverSnapshotAbAttr)
// and the library has neither "forget my eaten berries" nor "give back the remembered items" (request R-B11-C2-06). Both halves of
// `apply` are described in the summary; the second only runs when the holder is empty-handed (an effect-side check, see feasibility).
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { PreSwitchOutItemRestoreAbAttr } from "#data/elite-redux/archetypes/pre-switch-out-item-restore";

export default defineDecl(PreSwitchOutItemRestoreAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.switch-out",
  label: "Give back the items I remembered",
  summary: () =>
    "When I switch out after eating a berry, or while empty-handed, my eaten berries count as uneaten and I get back the items I remembered entering with.",
  synonyms: [
    "retriever",
    "get my item back",
    "restore held item",
    "keep my item after knock off",
    "berry comes back",
    "item returns on switch",
  ],
  examples: ["Get my item back when I switch out after it was knocked off, like Retriever"],
  params: [],
  noParamsReason:
    "The class has no constructor arguments: it always gives back every item the paired memory holds and always forgets the eaten berries. There is no number, type, stat or status to set. The condition (something to give back) is its own block.",
  conditions: [
    // "A berry was eaten, or I am empty-handed and remember items" (a legacy closure for now, see the header).
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: ["not-fainted"],
  feasibility: [
    "Items only come back when I hold nothing at that moment (eaten berries are forgotten either way)",
    "Gives back copies of the remembered items, each marked as mine, so the memory survives another strip and switch",
    "Never in a preview",
  ],
  effect: { id: "effect.package", params: [] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      name: "switching out at full HP and at half HP",
      axes: { hp: ["max", "50%"] },
    },
  ],
  l2StaticReason:
    "The shipped gate is a legacy closure (the berry test and the remembered-items test have no library atoms, requests R-B11-C2-04 and R-B11-C2-05), so the shared twin cannot rebuild it, and no L2 scenario strips the holder's item or makes it eat a berry. test/tests/elite-redux/decomp/B11/chunk2.test.ts drives the original and the rebuild (with the shipped gate handed in) with a remembered item, an empty and a full hand, and an eaten berry.",
  status: "decomposed",
  notes:
    "Tier B, justified in the header. Only user: Retriever (5244, attr 1), paired with PostSummonRetrieverSnapshotAbAttr (attr 0). The gate is bound as one legacy closure. Oddity, NOT fixed: `berriesEatenLast` is the berry record that Cud Chew writes at the end of each turn (`berriesEatenLast = turnData.berriesEaten`), so the berry half of the gate means 'I ate a berry on the previous turn', not 'I ate a berry since I came in'; it is cleared here, so a berry eaten and not yet recorded is not affected. Oddity, NOT fixed: clearing that record does not give a consumed berry back to the Pokemon (the apply comment says the persistence layer rebuilds berries at battle start), so the berry half only changes what Cud Chew would regurgitate and what this gate reads next time. The restore keeps working across repeated strips because it adds CLONES of the remembered items. Shared state: the module-level WeakMap of the snapshot attr.",
});
