/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 1. "When I knock a Pokemon out, change some of my stats" (Chilling Neigh, Hubris, Adrenaline Rush, Forsaken Heart...).
//
// Source: src/data/elite-redux/archetypes/stat-trigger-on-event.ts, StatTriggerOnKoAbAttr (extends PostKnockOutAbAttr).
// Dispatched by faint-phase.ts:269 for EVERY Pokemon on the field once any Pokemon faints, `victim` = the one that fainted.
// Constructor: one options object `{ stats, triggerOnAnyFaint? }`; it throws for an empty list or a zero stage change.
// Clauses, in the original order (the whole of `canApply`, now the Tier B gate; there is no guard and no residual):
//   1. `triggerOnAnyFaint`                         -> true at once (Forsaken Heart: any faint on the field)
//   2. `victim === pokemon`                        -> false (my own faint never counts)             = not side.is { self }
//   3. `victim.turnData?.attacksReceived?.[0]?.sourceId === pokemon.id`   I am the one credited with the knock out
//      (Moxie semantics: the victim's most recent attacker is me)                                   = NO ATOM YET (R-B12-01)
// apply: skipped when `simulated`; one StatStageChangePhase per entry of `stats` (holder, selfTarget true, that stat, those
// stages). No random draw. The phase clamps at +6 / -6 and shows its own messages.
//
// Binding rule: clause 1 decides the SHAPE of the gate, so `triggerOnAnyFaint` is not an editable setting. Forsaken Heart's gate
// is the empty (always true) group and is fully bound. The nine other users need clause 3, which has no library atom, so their
// gate is a legacy-closure with that reason until the librarian adds it.
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";
import { StatTriggerOnKoAbAttr } from "#data/elite-redux/archetypes/stat-trigger-on-event";
import { statChangesCodec } from "./b12-chunk1-codecs";

/** Every setting lives inside the one options object; `ctorOption` names the key. */
const IN_PAYLOAD = { ctorIndex: 0 } as const;

export default defineDecl(StatTriggerOnKoAbAttr, {
  tier: "B",
  kind: "event-effect",
  when: "event.on-ko",
  label: "Change my stats when I knock a Pokemon out",
  summary: params =>
    params.triggerOnAnyFaint === true
      ? `Whenever any Pokemon on the field faints, my stats change: ${params.stats}. Example: Attack +1, like Forsaken Heart.`
      : `When I knock a Pokemon out, my stats change: ${params.stats}. Example: Attack +1, like Chilling Neigh.`,
  synonyms: [
    "moxie",
    "chilling neigh",
    "beast boost",
    "boost after a knock out",
    "snowball",
    "kill boost",
    "hubris",
    "adrenaline rush",
    "forsaken heart",
  ],
  examples: [
    "Raise Attack by one stage after I knock a Pokemon out, like Chilling Neigh",
    "Raise Attack and Speed by one stage each after a knock out, like Dragon's Ritual",
    "Lower my Attack by one stage after a knock out, like Super Strain",
  ],
  params: [
    {
      id: "stats",
      ...IN_PAYLOAD,
      ctorOption: "stats",
      path: "stats",
      control: "text",
      label: "Stat changes, like 'Attack +1, Speed +2' (stages -6 to 6; the game stops at 6, so 12 acts like 6)",
      editable: true,
      gateIndependent: true,
      default: "Attack +1",
      codec: statChangesCodec,
    },
    {
      id: "triggerOnAnyFaint",
      ...IN_PAYLOAD,
      ctorOption: "triggerOnAnyFaint",
      path: "triggerOnAnyFaint",
      control: "boolean",
      label: "React to every faint on the field, not only knock outs I caused (yes or no)",
      // It decides the shape of the gate (clauses 1 to 3 above), so it is not a slider staff can move.
      editable: false,
      default: false,
    },
  ],
  conditions: [
    // The gate: [not side.is self, credited with the knock out] for the default rule, an empty group for "any faint".
    { slot: "gate", ctx: "params", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "A stat that is already at its limit does not move further",
    "Nothing happens when the game only previews the move",
  ],
  effect: { id: "effect.stat-stage", params: ["stats"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  probes: [{ name: "a foe faints after my hit", axes: {} }],
  status: "decomposed",
  notes:
    "legacy-closure-pending-request for 9 of 10 users. Tier B, 10 attrs: Chilling Neigh (5003 Attack +1), Adrenaline Rush (5185 Speed +1), Super Strain (5217 Attack -1), Hubris (5262 Sp. Atk +1), Haunting Frenzy (5301 attr 1 Speed +1), Dragon's Ritual (5400 Attack +1 and Speed +1), Breezy Neigh (5559 Speed +1), Hydra (5630 attr 1 Sp. Atk +1), As One (20022 Speed +1) and Forsaken Heart (5472, Attack +1, triggerOnAnyFaint true). Forsaken Heart's gate is bound as the empty group. The other nine need 'I am credited with the knock out' (the victim's latest received attack came from me), which has no library atom: request R-B12-01 (same predicate as R-B09-32); until then their gate is a legacy-closure. The first clause `victim === pokemon` maps to not(side.is self). Every effect is the library effect stat-stage (holder), one per listed stat; the class queues one phase per stat in list order. Oddities, not fixed: (a) PostKnockOutAbAttr also reaches an ally and the fainted Pokemon itself, which is why the gate exists; (b) the credit test reads only attacksReceived[0], the victim's latest attack, so a poison or weather faint after an earlier hit by me still credits me; (c) the stage numbers are not capped to 6 (a +12 is accepted and the phase clamps it).",
});
