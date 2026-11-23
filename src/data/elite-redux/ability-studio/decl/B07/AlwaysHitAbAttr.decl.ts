/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B07 chunk 4 / engine query (No Guard), Tier C. Copy of the FloatAbAttr shape. See ../PRECEDENTS.md.
//
// Read from src/data/abilities/ab-attrs.ts: `AlwaysHitAbAttr extends AiMovegenMoveStatsAbAttr` and its constructor passes the closure
// `({ accMult }) => { accMult.value = Number.POSITIVE_INFINITY; }` (no argument; the effect closure is fixed, showAbility false).
// Inherited clauses: `canApply = globalScene.movesetGenInProgress`, `apply = this.effect(params)`. That AI-only half (the enemy moveset
// generator treats the holder's moves as never missing) is dispatched under the parent key AiMovegenMoveStatsAbAttr, which is declared
// separately (parked, see ../B07/pending/AiMovegenMoveStatsAbAttr.decl.pending.ts).
//
// The battle rule is NOT dispatched. `MoveEffectPhase.checkBypassAccAndInvuln(target)` (src/phases/move-effect-phase.ts) asks
//   `user.hasAbilityWithAttr("AlwaysHitAbAttr") || target.hasAbilityWithAttr("AlwaysHitAbAttr")`
// unless the field normalises ability accuracy (`requestedFieldNormalizesAbilityAccuracy()`, the ER Dust Cloud field effect), and returns
// true. That answer skips the semi-invulnerable check (Fly, Dig, Dive...) AND the accuracy roll in `hitCheck`, so a move that is made by me
// or aimed at me always lands. It is therefore an ENGINE QUERY by presence, exactly like FloatAbAttr: the whole rule lives in the engine
// check, and no dispatched trigger, condition or effect exists to take apart.
import { AlwaysHitAbAttr } from "#abilities/ab-attrs";
import { defineDecl } from "#data/elite-redux/ability-studio/define-decl";

export default defineDecl(AlwaysHitAbAttr, {
  tier: "C",
  kind: "engine-query",
  when: "while.active",
  label: "Moves I use and moves aimed at me never miss",
  summary: () =>
    "While I have this, my moves never miss and foes' moves aimed at me never miss, even against a foe that is flying or underground. Example: Thunder always hits.",
  synonyms: [
    "no guard",
    "never miss",
    "perfect accuracy",
    "always hit",
    "100 percent accuracy",
    "sure hit",
    "cannot dodge",
  ],
  examples: ["Every move that involves me always hits, like No Guard"],
  params: [],
  noParamsReason:
    "A presence flag read by the engine's hit check (checkBypassAccAndInvuln); the constructor takes no argument and the effect closure is fixed, so there is nothing to configure.",
  conditions: [],
  guards: [],
  feasibility: [
    "Does nothing while a field effect that restores normal accuracy is active (the ER Dust Cloud field effect)",
  ],
  reusableAlone: { when: true, if: false, do: true },
  flags: { rng: "none", state: "none", simulated: "respects" },
  l2StaticReason:
    "The flag is consulted by MoveEffectPhase.checkBypassAccAndInvuln, which is not a dispatched moment; the twin compares whole battles of the five users instead.",
  probes: [{ name: "a move aimed at the holder and a move used by the holder", axes: {} }],
  status: "decomposed",
  notes:
    "Engine-query, Tier C, no closure to bind (the only closure is fixed and belongs to the AI half). Read by presence in MoveEffectPhase.checkBypassAccAndInvuln for BOTH the user and the target of the move, which is why the label says 'used by me and aimed at me'. Users (live dump): No Guard (99, attr 0), Sighting System (5106, attr 0), Iron Barrage (5132, attr 1), Brawling Wyvern (5307, attr 0), Qigong (5463, attr 1). The sibling ER class PerMoveAlwaysHitAbAttr (archetypes/per-move-accuracy-override.ts, another batch) extends this class and is matched by the same presence check, so its holders always hit with EVERY move at runtime although only the moveset generator is move-filtered (its own header says so: a known gap, not fixed here). The inherited AI half (AiMovegenMoveStatsAbAttr, accMult set to infinity) is the parked parent declaration, so a rebuilt attr must keep the class for the presence check and the generator. simulated: the engine query ignores it.",
});
