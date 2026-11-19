/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 2. Tier A, event-effect on entry, no condition slot.
//
//   canApply   arena.hasTag(arenaTags)      "at least one of the listed field effects is on EITHER side"
//   apply      unless simulated: arena.removeTagsOnSide(arenaTags, side)
//              side = "own" -> the holder's side, "opponent" -> the other side, "both" -> both sides
//
// `canApply` is effect-side feasibility ("there is something to remove"): without it the ability would flash its name
// for nothing. It stays in the class. Both constructor arguments are params; the second one is stored as a word
// (own / opponent / both) even when a user passed the old boolean form, so the live value always reads back.
//
// No existing effect block removes FIELD effects (`effect.remove-tag` removes a battle effect from a Pokemon), so the
// DO block is requested in requests/B03.md (`effect.remove-field-effect`) and `effect` is left out here.
import { PostSummonRemoveArenaTagAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { ArenaTagType } from "#enums/arena-tag-type";
import { stringEnumListCodec } from "./codecs";

const SIDE_NAMES = ["OWN_SIDE", "FOE_SIDE", "BOTH_SIDES"] as const;
const SIDE_TO_CTOR: Readonly<Record<string, string>> = { OWN_SIDE: "own", FOE_SIDE: "opponent", BOTH_SIDES: "both" };

const sideCodec: ParamCodec = {
  toCtor: value => {
    const resolved = SIDE_TO_CTOR[String(value)];
    if (resolved === undefined) {
      throw new Error(`"${String(value)}" is not a side (own side, foe side or both sides)`);
    }
    return resolved;
  },
  fromInstance: raw => SIDE_NAMES.find(name => SIDE_TO_CTOR[name] === raw),
};

/** The class accepts any field effect; the editor lists every real one. */
const FIELD_EFFECT_OPTIONS = Object.keys(ArenaTagType).filter(name => name !== "NONE");

export default defineDecl(PostSummonRemoveArenaTagAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Clear field effects when I enter",
  summary: params =>
    `When I enter the battle, remove ${params.arenaTags} from ${params.side}. Example: Screen Cleaner clears Reflect, Light Screen and Aurora Veil.`,
  synonyms: [
    "screen cleaner",
    "remove hazards",
    "clear spikes",
    "remove screens",
    "defog on entry",
    "clear reflect",
    "pickup",
  ],
  examples: [
    "Remove Reflect, Light Screen and Aurora Veil from the foe's side when I enter",
    "Clear Spikes and Stealth Rock from my side when I enter",
  ],
  params: [
    {
      id: "arenaTags",
      ctorIndex: 0,
      path: "arenaTags",
      control: "text",
      label: "Field effects to remove (comma separated names)",
      editable: true,
      default: "REFLECT,LIGHT_SCREEN,AURORA_VEIL",
      options: FIELD_EFFECT_OPTIONS,
      codec: stringEnumListCodec(ArenaTagType as unknown as Readonly<Record<string, string>>, "field effect"),
    },
    {
      id: "side",
      ctorIndex: 1,
      path: "sideMode",
      control: "select",
      label: "Which side to clear",
      editable: true,
      default: "BOTH_SIDES",
      options: [...SIDE_NAMES],
      codec: sideCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: [
    "At least one of the listed field effects must be active on either side, otherwise nothing happens and the ability does not show",
    "It does nothing in a preview",
  ],
  reusableAlone: { when: true, if: true, do: false },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 3 attrs of 3 abilities, no closure: Pickup (53 attr 1: Spikes, Toxic Spikes, Stealth Rock, Sticky Web from my own side), Screen Cleaner (251: Aurora Veil, Light Screen, Reflect and ER Smokescreen from the foe's side) and Demolitionist (5320 attr 2: Reflect, Light Screen, Aurora Veil on both sides). Pending request for the missing DO block 'remove field effects' (requests/B03.md). Quirk recorded, not fixed: `canApply` asks `arena.hasTag` on BOTH sides, while `apply` removes only from the chosen side, so Pickup shows its ability name when only the FOE's side has a hazard and then removes nothing. The old boolean second argument (true = own, false = both) is still accepted by the class; the stored field is always the word.",
});
