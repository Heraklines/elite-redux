/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Encore Set, part 2 of 2 (Tier A, package effect). "After a damaging move, the previous different move is replayed as a weaker echo."
//
// Source: abilities/newcomer-signature-mechanics.ts, EncoreSetAbAttr (PostAttackAbAttr; the base class's two arguments
// (attackCondition, showAbility) are constructor arguments 0 and 1, the replay power is now argument 2).
//   canApply, ORIGINAL order, five pure clauses, no RNG (unchanged, still one expression):
//     1. super.canApply: the base attack condition, by default `move.category !== STATUS`  -> constructor slot "ctor:0"
//     2. params.damage > 0
//     3. !isSignatureFollowup(move)                       (the move is not itself an echo or counter)
//     4. my last move record exists
//     5. ENCORE_SET[holder].lastRecord !== that record     (this move use was not counted yet)
//   apply: state.lastRecord = my last move record; state.previous = the move just used        (even when simulated)
//          simulated, no previous move, the SAME move as the previous one, or the foe fainted: stop
//          message "<me>'s Encore Set replayed <move>!", then the scripted follow-up phase: the PREVIOUS move's id, power
//          prior.power * replayPercent / 100 (at least 1), its own type and category, always hits.
// The memory (previous move, last counted record) is emptied on entry by EncoreSetResetAbAttr (chunk 4).
import { EncoreSetAbAttr } from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(EncoreSetAbAttr, {
  tier: "A",
  kind: "package",
  when: "event.after-my-hit",
  label: "Replay my previous move as a weaker echo",
  summary: params =>
    `After my damaging move hurts the target, my previous different damaging move is replayed against it at ${params.replayPercent}% of its power. Example: a 100 power move echoes as ${params.replayPercent}.`,
  synonyms: [
    "echo the last move",
    "replay old move",
    "double strike",
    "combo follow up",
    "repeat previous attack",
    "second hit",
    "encore set",
  ],
  examples: ["After I use a new attack, my last attack is replayed at 40% power, like Encore Set"],
  params: [
    // Constructor arguments 0 (attack condition) and 1 (show ability) are the base class's: 0 is the ctor:0 condition
    // slot below, 1 stays undefined for every user (base default).
    {
      id: "replayPercent",
      ctorIndex: 2,
      path: "replayPercent",
      control: "number",
      label: "Echo power (percent of the replayed move's power)",
      editable: true,
      default: 40,
      min: 1,
      max: 200,
      step: 5,
    },
  ],
  conditions: [
    // Clause 1: the base class's attack condition (a real constructor argument). Every user takes the default.
    { slot: "ctor:0", ctx: "attack", lib: "move.damaging", path: "attackCondition", removable: true, editable: true },
  ],
  guards: [],
  feasibility: [
    "The hit must deal damage",
    "The move must not itself be an echo, so an echo never starts another echo",
    "Each move I use is remembered only once, so one move never replays itself",
    "Nothing is replayed the first time, when the previous move is the same move, or when the target has already fainted",
    "The echo is my previous move with its own type and category, and it always hits; this cannot be changed here",
  ],
  effect: { id: "effect.package", params: ["replayPercent"] },
  reusableAlone: { when: true, if: true, do: true },
  flags: { rng: "none", state: "battle", simulated: "respects" },
  probes: [
    {
      // A plain damaging hit: the memory is filled but nothing is replayed the first time; the replay itself is driven by B13/chunk5.test.ts.
      name: "damaging hit and the foe's HP",
      axes: { foeMove: ["TACKLE"], foeHp: ["max", "max-1"] },
    },
  ],
  status: "decomposed",
  notes:
    "PACKAGE for the EFFECT, Tier A because the only editable condition is the base class's attack condition (ctor:0, library atom move.damaging, bound in bindings.ts). The other four clauses are NOT gates a rule could drop: clauses 4 and 5 are the bookkeeping that stops one move use from being counted twice (removing them would make a single move replay itself and corrupt the memory), clause 3 is a correctness rule (R-B13-37, the guard `not-a-scripted-follow-up`) and clause 2 is R-B13-3 (`hit.dealt-damage`). They stay in canApply untouched and are listed as 'also requires'. Why the effect cannot be split with today's blocks: it replays the PREVIOUS move of a private per-Pokemon memory (move id, power, type and category) as a scripted follow-up with fixed flags; `effect.scripted-move` takes a fixed move id and power (requested as R-B13-43 `effect.replay-previous-move`, a relative of R-B13-40 `effect.echo-move`). The 40% was the literal 0.4, now constructor argument 2 with default 40 (40 / 100 is the very double 0.4). Users: Encore Set (5988, attr 1; attr 0 is the entry reset). ODDITIES (not fixed): (1) apply stores the move record and the previous move BEFORE its simulated, same-move and fainted-target checks, so a simulated call or a KO still spends the memory; (2) a previous move with variable power (-1) or 0 echoes at power max(1, floor(...)) because the helper clamps it; (3) a status move never updates `previous` (clause 1 stops it), so the replayed move is always the last DAMAGING move; (4) the ability text says the echo cannot crit or trigger Encore Set; this class only keeps echoes from starting echoes (clause 3), the rest is not enforced here.",
});
