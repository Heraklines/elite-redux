/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B03 chunk 2. Tier A, event-effect on entry, no condition slot.
//
//   canApply   none of its own (PostSummonAbAttr answers true)
//   apply      unless simulated: queue the message `messageFunc(holder)`
//
// The one constructor argument is a FUNCTION `(pokemon) => string`, not a yes/no closure. Every shipped user passes the
// same shape: one translation key of the "abilityTriggers" file filled with the holder's name (and, for the four
// Ruin abilities, the name of the lowered stat). So the param is a CHOICE of the built-in announcements, and the
// codec rebuilds the very same translation call (see codecs.ts). The announcement is read back from a live instance by
// the translation key that appears in the function's source.
//
// Not rebuildable: Zero to Hero's function also writes a per-battle memory (a module-private WeakMap of init-abilities.ts
// that its attr-level condition reads), so a rebuilt function could not keep the "once per battle" behaviour. Its live
// value reads back as ZERO_TO_HERO_TRANSFORMATION, which is listed as a choice (the catalog must be able to describe the
// live attr) but whose codec refuses to build it, so the rebuild fails honestly with a plain message and the attr is
// counted as undecomposed until requests/B03.md is answered. Staff can see it in the picker but cannot compile it.
//
// Attr-level conditions (AbAttr.addCondition, not constructor arguments) sit on Anticipation, Telepathy, Aura Break,
// Nihil Blaster and Zero to Hero. They are carried over by the rebuild, not bound (no binding slot exists for them);
// see requests/B03.md.
import { PostSummonMessageAbAttr } from "#abilities/ab-attrs";
import { defineDecl, type ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { ANNOUNCEMENTS, ZERO_TO_HERO } from "./codecs";

/** Functions this file built, so a rebuilt instance reads back the same choice without parsing source text. */
const BUILT = new WeakMap<object, string>();

const KEY_PATTERN = /abilityTriggers:(postSummon\w+)/;

const announcementCodec: ParamCodec = {
  toCtor: value => {
    if (String(value) === ZERO_TO_HERO) {
      throw new Error(
        "The Zero to Hero announcement cannot be built from blocks yet: it keeps a once-per-battle memory that only the ability file can write",
      );
    }
    const entry = ANNOUNCEMENTS[String(value)];
    if (entry === undefined) {
      throw new Error(`"${String(value)}" is not one of the built-in announcements`);
    }
    const built = entry.build();
    BUILT.set(built, String(value));
    return built;
  },
  fromInstance: raw => {
    if (typeof raw !== "function") {
      return;
    }
    const known = BUILT.get(raw);
    if (known !== undefined) {
      return known;
    }
    const key = KEY_PATTERN.exec(Function.prototype.toString.call(raw))?.[1];
    if (key === undefined) {
      return;
    }
    if (key === "postSummonZeroToHero") {
      return ZERO_TO_HERO;
    }
    return Object.keys(ANNOUNCEMENTS).find(name => ANNOUNCEMENTS[name]?.key === key);
  },
};

export default defineDecl(PostSummonMessageAbAttr, {
  tier: "A",
  kind: "event-effect",
  when: "event.on-entry",
  label: "Show a built-in announcement with my name when I enter",
  summary: params =>
    `When I enter the battle, show the "${params.message}" announcement with my name. Example: Pressure shows "<my name> is exerting its Pressure!".`,
  synonyms: [
    "pressure message",
    "mold breaker message",
    "aura message",
    "entry announcement",
    "show text on entry",
    "ability announcement",
    "shuddered",
  ],
  examples: ["Show the Pressure announcement when I enter", "Announce that I am radiating a Dark Aura when I enter"],
  params: [
    {
      id: "message",
      ctorIndex: 0,
      path: "messageFunc",
      control: "select",
      label: "Which announcement to show",
      editable: true,
      default: "PRESSURE",
      options: [...Object.keys(ANNOUNCEMENTS), ZERO_TO_HERO],
      codec: announcementCodec,
    },
  ],
  conditions: [],
  guards: [],
  feasibility: ["It does nothing in a preview"],
  effect: { id: "effect.message", params: ["message"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "entry with the default field", axes: {} }],
  status: "decomposed",
  notes:
    "Tier A, 23 attrs of 23 abilities: Pressure (46), Mold Breaker (104), Anticipation (107) and Telepathy (140, an Anticipation copy; its condition is attr-level), Turboblaze (163), Teravolt (164), Dark Aura (186), Fairy Aura (187), Aura Break (188), As One Glastrier (266) and Spectrier (267), Zero to Hero (278 attr 4), the four Ruin abilities (284 Vessel SPATK, 285 Sword DEF, 286 Tablets ATK, 287 Beads SPDEF), Sword of Damnation (5392 attr 3, Sword key), Blind Rage (5397 attr 2, Mold Breaker key), Nihil Blaster (5679 attr 2, Aura Break key), Pure Good (5935, Fairy Aura key), Sword's Nature (6023 attr 2, Sword key), Dreadful Winds (20001, Dark Aura key) and Fairy Wings (20013, Fairy Aura key). Not rebuildable: Zero to Hero (stateful function, see top comment; listed as the last choice but refused with a plain message), counted as undecomposed. The effect block `effect.message` takes free text, while this class takes a translation key: requests/B03.md asks for a 'built-in announcement' variant. Quirk recorded, not fixed: Telepathy's entry announcement is Anticipation's 'shuddered!' and is gated by the same 'a foe has a super-effective or one-hit-knock-out move' condition, which looks like a copy-paste of Anticipation rather than an intended Telepathy effect.",
});
