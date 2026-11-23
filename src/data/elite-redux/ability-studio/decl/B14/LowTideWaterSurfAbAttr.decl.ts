/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B14 chunk 3. Tier B, event-effect. "When a damaging Water move hits me, I answer with a free 50 power Surf."
//
// Source: fakemon-pitch-mechanics.ts LowTideWaterSurfAbAttr (extends PostDefendAbAttr; dispatched as PostDefendAbAttr after a hit).
// canApply, original clause order, now `guards && gate`:
//   guard  1. !simulated                                          nothing is started while the game only previews a hit
//   gate   2. move.category !== STATUS                            the hit was a damaging move   -> library move.damaging
//          3. opponent.getMoveType(move) === WATER                the attacker's move is Water type AFTER ability type changes
//                                                                 -> library move.type { WATER, effective: true }
//                                                                 (for this WHEN the move user is the attacker = `opponent`)
// Nothing is random, nothing is remembered. Clause 1 is a guard: it is not a rule staff would tune, it is the "does nothing in a
// preview" safety rule (the library guard `not-simulated` is requested in requests/B14.md; until it exists it is listed as
// feasibility text). Clauses 2 and 3 are the conditions staff may change ("any damaging move", "only Fire moves", ...).
//
// apply: simulated returns first. Otherwise `getMoveTargets(holder, moveId).targets` (the targets the free move would have if I
// used it) and, when there is at least one, unshift a MovePhase of the scripted copy (`scriptedPokemonMove(moveId, power)`,
// MoveUseMode.INDIRECT). The move (Surf) and its power (50) were literals; they are now constructor arguments 0 and 1 with the
// same defaults and editable params.
import { LowTideWaterSurfAbAttr } from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { MoveId } from "#enums/move-id";

/** "Surf", "surf", "Steam Eruption", "STEAM_ERUPTION" all name a move; the class wants the move id. */
function moveKey(name: string): string {
  return name
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_");
}

function titleOf(key: string): string {
  const words = key.toLowerCase().split("_");
  return words.map((word, index) => (index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word)).join(" ");
}

const moveNameCodec: ParamCodec = {
  toCtor: value => {
    const resolved = (MoveId as unknown as Record<string, string | number>)[moveKey(String(value))];
    if (typeof resolved !== "number" || resolved === MoveId.NONE) {
      throw new Error(`"${String(value)}" is not a known move name`);
    }
    return resolved;
  },
  fromInstance: raw => {
    if (typeof raw !== "number") {
      return;
    }
    const key = Object.keys(MoveId).find(name => Number.isNaN(Number(name)) && (MoveId as never)[name] === raw);
    return key === undefined ? undefined : titleOf(key);
  },
};

export default defineDecl(LowTideWaterSurfAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.after-hit",
  label: "Answer a hit by using a free move of my own",
  summary: params =>
    `After I am hit, I use ${params.moveId} at ${params.power} power on the targets that move would normally have, for free. Example: a damaging Water move hits me and a 50 power Surf comes back.`,
  synonyms: [
    "low tide",
    "counter attack",
    "retaliate",
    "free move",
    "answer with a move",
    "surf back",
    "follow up attack",
    "water absorb counter",
  ],
  examples: ["When a damaging Water move hits me, I answer with a 50 power Surf"],
  params: [
    {
      id: "moveId",
      ctorIndex: 0,
      path: "moveId",
      control: "text",
      label: "Move to use (its name, for example Surf)",
      editable: true,
      default: "Surf",
      codec: moveNameCodec,
      gateIndependent: true,
    },
    {
      id: "power",
      ctorIndex: 1,
      path: "power",
      control: "number",
      min: 1,
      max: 250,
      step: 1,
      integer: true,
      label: "Power of the free move",
      editable: true,
      default: 50,
      gateIndependent: true,
    },
  ],
  conditions: [
    // Gate = [the move deals damage, the move is Water type after ability changes], in that order. Removable.
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "Does nothing while the game is only previewing a hit",
    "The chosen move needs at least one target; with none, nothing is used",
  ],
  effect: { id: "effect.scripted-move", params: ["moveId", "power"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [
    {
      // Water Gun (Water, damaging), Tackle (damaging, not Water), Growl (status).
      name: "a Water move, a non-Water move and a status move",
      axes: { foeMove: ["WATER_GUN", "TACKLE", "GROWL"] },
    },
  ],
  status: "decomposed",
  notes:
    "Tier B. Users (1): Low Tide (6071) attr 2; its attrs 0 and 1 (RedirectTypeMoveAbAttr WATER, TypeImmunityAbAttr WATER) belong to the ab-attrs batches. The move (Surf) and power (50) were literals, now constructor arguments 0 and 1 (defaults unchanged) and editable params; the Water type test lives only in the gate binding (all[move.damaging, move.type WATER with ability changes]). The effect uses the library effect scripted-move: the follow-up is started as an indirect MovePhase, exactly what that effect says. Oddities, not fixed: (1) SUSPECTED BUG: the same ability also makes the holder immune to Water (attr 1) and the engine ends an absorbed hit before the after-hit moment, so the answer never runs for a Water move that is absorbed; it only runs when the immunity is bypassed (a foe with Mold Breaker). Proved in B14/chunk3.test.ts: an absorbed Water Gun gets no answer, the same Water Gun from a Mold Breaker foe gets the Surf. The ability text says it absorbs and answers; (2) nothing stops two Low Tide holders in a double battle from answering each other's free Surf (the free move is an indirect move, and the class does not look at that), not reproduced in a test; (3) the guard not-simulated is requested, so it is feasibility text for now.",
});
