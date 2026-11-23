/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14. Tier B. "After a drill move of mine hits, lay Drill Bits on the opposing side."
//
// canApply, original clause order, now `guards && gate`:
//   guards  1. !simulated                          not while the game only previews a hit
//           2. damage > 0                          the hit dealt damage
//           3. hitResult < HitResult.NO_EFFECT     it was a real hit (EFFECTIVE .. ONE_HIT_KO), not a block
//   gate    4. move.hasFlag(DRILL_BASED)           the move's OWN drill flag (not doesFlagEffectApply)
// Nothing is random. Clauses 1 to 3 are guards (without them the hazard would be laid by a move that did nothing);
// they are not registered yet (requested in requests/B14.md) and are listed under feasibility meanwhile.
//
// apply (`!simulated` again, a no-op duplicate of clause 1):
//   globalScene.arena.addTag(ER_DRILL_BITS, 0 turns = no limit, move.id, holder.id, the OPPOSING side of the holder)
//
// The effect is expressible with an existing effect block (`effect.arena-tag`, "Set a field effect on a side"), so this
// is not a package. The block is still `implemented: false` in the library and lacks a duration and the source
// holder (requested as a clarification). The class has no constructor argument, so the field effect and the side are
// fixed in it.
//
// The gate binding is LEGACY: clause 4 uses `move.hasFlag`, which differs from the library atom `move.flag`
// (doesFlagEffectApply also counts flags that abilities inject). An atom `move.has-own-flag` is requested.
import { BitterDrillAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { ArenaTagType } from "#enums/arena-tag-type";

// Staff pick player words; the class wants the engine ids. A codec is the only place the two meet.
function wordsCodec(table: Readonly<Record<string, unknown>>, what: string): ParamCodec {
  return {
    toCtor: value => {
      if (!Object.hasOwn(table, String(value))) {
        throw new Error(`"${String(value)}" is not a known ${what}`);
      }
      return table[String(value)];
    },
    fromInstance: raw => Object.keys(table).find(key => table[key] === raw),
  };
}

const FIELD_EFFECT_WORDS = {
  "Drill Bits": ArenaTagType.ER_DRILL_BITS,
  Spikes: ArenaTagType.SPIKES,
  "Toxic Spikes": ArenaTagType.TOXIC_SPIKES,
  "Stealth Rock": ArenaTagType.STEALTH_ROCK,
  "Sticky Web": ArenaTagType.STICKY_WEB,
} as const;

const SIDE_WORDS = {
  "The foes' side": "opposing-side",
  "My side": "holder-side",
  "Both sides": "both",
} as const;

export default defineDecl(BitterDrillAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-my-hit",
  label: "Lay Drill Bits on the foes' side after my drill move",
  summary: params =>
    `After a drill move of mine hits, I lay ${params.tag} on ${String(params.side).toLowerCase()}${
      Number(params.duration) > 0 ? `, lasting ${params.duration} turns` : ", until it is removed"
    }. Example: Drill Bits on the foes' side.`,
  synonyms: ["bitter drill", "entry hazard", "set a hazard", "drill hazard", "spikes", "field effect after hit"],
  examples: ["After a drill move hits, leave a hazard on the opposing side"],
  params: [
    {
      id: "tag",
      ctorIndex: 0,
      path: "tag",
      control: "select",
      label: "Field effect to lay",
      editable: true,
      default: "Drill Bits",
      options: Object.keys(FIELD_EFFECT_WORDS),
      codec: wordsCodec(FIELD_EFFECT_WORDS, "field effect"),
      gateIndependent: true,
    },
    {
      id: "side",
      ctorIndex: 1,
      path: "side",
      control: "select",
      label: "Which side gets it",
      editable: true,
      default: "The foes' side",
      options: Object.keys(SIDE_WORDS),
      codec: wordsCodec(SIDE_WORDS, "side"),
      gateIndependent: true,
    },
    {
      id: "duration",
      ctorIndex: 2,
      path: "duration",
      control: "number",
      min: 0,
      max: 20,
      step: 1,
      integer: true,
      label: "Turns it lasts (0 = until removed)",
      editable: true,
      default: 0,
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [move has its own DRILL_BASED flag]. Removable: "after any hit" is a valid design.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The move must really have hurt the target (it dealt damage and was not blocked), and the game must not be only previewing",
    "Only one set of Drill Bits can be on a side at a time",
  ],
  effect: { id: "effect.arena-tag", params: ["tag", "side"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "the holder attacks", axes: {} }],
  l2StaticReason:
    "The gate binding is a legacy closure (no atom for a move's own flag yet), so the twin has no rebuilt attr to compare; the Tier B split is proven by test/tests/elite-redux/decomp/B14/gate-split.test.ts instead.",
  status: "decomposed",
  notes:
    "Event-effect, Tier B. The field effect, its side and its duration are constructor arguments (defaults Drill Bits, opposing side, 0 = until removed; behaviour identical) and editable params; the drill-flag test is the editable gate slot itself, so it is not repeated as a param. The duration param is not in the library effect.arena-tag yet (requested). Users (1): Bitter Drill (6044) attr 0; attr 1 is BitterDrillDamageAbAttr (doubles drill move power against an Embedded foe), declared in a later chunk. Gate legacy-closure pending move.has-own-flag; guards pending not-simulated and hit-dealt-damage; the effect maps to effect.arena-tag, which the librarian must extend with a duration and a source. The inherited attackCondition (constructor argument 0, default `move.category !== STATUS`) is never read: this canApply does not call super. The tag's side is `holder.isPlayer() ? ENEMY : PLAYER`. Oddity, not fixed: the drill flag test is the move's own flag, so a move that only gains the drill flag from an injecting ability does not trigger it (no shipped ability injects DRILL_BASED).",
});
