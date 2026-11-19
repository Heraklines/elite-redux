/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 3. Tier B, event-effect on entry, no random draws.
//
//   canApply (now gate only)  gate: at least one of the listed battle effects is on me (`pokemon.getTag(t)` for any t)
//   apply                     removes EVERY listed battle effect from me (`pokemon.removeTag(t)`); it does NOT look at
//                             `simulated`, and it does not look at which effect was present
//
// The only clause is the yes/no fact "I am affected by one of these battle effects", so it is the replaceable gate
// (an IF staff can swap or drop); there is no guard, no residual and no draw. The list is read twice: by the gate
// (which effects make the ability fire) and by `apply` (which effects it removes). The library has no "affected by any
// of a list" atom, so every user's gate is spelled as an `any` of single-effect atoms and the list param is NOT
// editable on a live ability (moving it would leave the gate behind); `tag.has-any` is requested in requests/B03.md.
//
// A second dispatch exists: `move-end-phase.ts` calls `PostSummonRemoveEffectAbAttr` on every target after a move ends
// ("remove effects set on a Pokemon that removes them on summon, e.g. via Mold Breaker"). The class is dispatched
// there too, but the declaration can state one trigger only; the extra trigger is requested.
import { PostSummonRemoveBattlerTagAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { enumOptions } from "#data/elite-redux/ability-studio/param-codecs";
import { BattlerTagType } from "#enums/battler-tag-type";
import { stringEnumListCodec } from "./codecs";

export default defineDecl(PostSummonRemoveBattlerTagAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Shake off battle effects when I enter",
  summary: params =>
    `When I enter the battle (or gain this ability), I lose these battle effects if I have them: ${params.tags}. Example: Own Tempo removes Confusion.`,
  synonyms: [
    "own tempo",
    "oblivious",
    "cure confusion",
    "remove taunt",
    "cure infatuation",
    "cleanse volatile",
    "shake off",
  ],
  examples: [
    "Remove Confusion from me when I enter or gain this ability",
    "Cure Infatuation and Taunt when I enter the battle",
  ],
  params: [
    {
      id: "tags",
      ctorIndex: 0,
      path: "immuneTags",
      control: "text",
      label: "Battle effects to remove (comma separated names)",
      editable: false,
      default: "CONFUSED",
      options: enumOptions(BattlerTagType),
      codec: stringEnumListCodec(BattlerTagType as unknown as Readonly<Record<string, string>>, "battle effect"),
      spread: true,
    },
  ],
  conditions: [{ slot: "gate", ctx: "params", removable: true, editable: true }],
  guards: [],
  feasibility: [
    "It acts only when I am affected by at least one of the listed battle effects (this is the condition above)",
    "It also works right after a move hits me, not only on entry (the game checks it again at the end of every move)",
  ],
  effect: { id: "effect.remove-tag", params: ["tags"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "ignores" },
  probes: [
    { name: "entry with none of the effects", axes: {} },
    { name: "entry while confused", axes: {} },
  ],
  status: "decomposed",
  notes:
    "Tier B, 2 users, no closure: Oblivious (12 attr 1: Infatuation and Taunt; ER also adds Fear to its immunities, but that lives in another class) and Own Tempo (20 attr 1: Confusion). `canApply` was `immuneTags.some(t => !!pokemon.getTag(t))`, now `gate`; no guards, no residual, no draws. Gate bindings are `any` over `tag.has` (same `getTag(...) !== undefined` test). The `tags` param is editable:false because the gate repeats the list; request `tag.has-any` (list of battle effects) plus a `gateParams` entry would make it editable. Quirks recorded, not fixed: `apply` ignores `simulated` (a preview would remove the effects), and `effect.remove-tag` in the library takes ONE battle effect while this class removes a list. Second dispatch (after any move that targets me, move-end-phase.ts) is not expressible as a WHEN yet (requests/B03.md).",
});
