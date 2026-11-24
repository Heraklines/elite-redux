/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B17, chunk 1 (spec 2.1): the library form of every Tier B gate of these classes, keyed by
// (abilityId, attrIndex, "gate"). Every line was read by hand from the live class (the `gate` method) and mapped to the
// atom that calls the SAME engine predicate; the L1 differential evaluates the class's own gate and the library form over
// the state grid. A gate that no atom can express stays a written legacy-closure and an entry in requests/B17.md.
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

// Magician (170, attr 0): `!move.doesFlagEffectApply({ MAKES_CONTACT, user: holder, target: foe })`.
// move.flag calls doesFlagEffectApply with the frame's moveUser (the holder after my hit) and target (the foe).
bindCondition(170, 0, { not: { id: "move.flag", flag: "MAKES_CONTACT" } }, "gate");

// Moxibustion (6032, attr 0): `super.canApply(params) && opponent.status?.effect === BURN`.
// super.canApply is PostAttackAbAttr's default attackCondition, `move.category !== STATUS` = move.damaging.
bindCondition(6032, 0, { all: [{ id: "move.damaging" }, { id: "status.has", who: "other", status: "BURN" }] }, "gate");

// Mutual Destruction (6104, attr 0): `!attacker.getAllies().includes(holder)` = the knocker is not an ally of mine.
bindCondition(6104, 0, { not: { id: "side.is", kind: "ally" } }, "gate");

// Metallosis (6049, attr 1): `super.canApply(params) && !!opponent.turnData.attacksReceived[0]?.critical`.
// The first half is move.damaging, but there is no atom for "the hit was a critical hit" (request R5), and both halves
// share one gate slot, so the whole gate stays legacy.
bindLegacyClosure(
  6049,
  1,
  "No atom reads whether the hit was a critical hit (opponent.turnData.attacksReceived[0]?.critical); see request R5 in requests/B17.md",
  "gate",
);

// Lingering Musk (6084, attr 3): the gate is the marker tempSummonData.lingeringMuskFaint that attr 2 sets.
bindLegacyClosure(
  6084,
  3,
  "No atom reads the marker left by a survived knockout hit (tempSummonData.lingeringMuskFaint); see request R3 in requests/B17.md",
  "gate",
);

// Oracle (6047, attrs 1 and 2): the gates read string markers in the ER provenance memory ("oracle:first-entry" in
// battleData, "oracle:guard:N" in summonData). No atom reads that memory yet (request R3).
bindLegacyClosure(
  6047,
  1,
  "No atom reads the ER provenance marker memory (battleData 'oracle:first-entry'); see request R3 in requests/B17.md",
  "gate",
);
bindLegacyClosure(
  6047,
  2,
  "No atom reads the ER provenance marker memory (summonData 'oracle:guard:N'); see request R3 in requests/B17.md",
  "gate",
);

// ---- Chunk 2 (Penta-Punch, Perpetual Motion, Phoenix Foliage). Same method as chunk 1: each line was read by hand from the
// live `gate` method and mapped to the atom that calls the SAME engine predicate.

// Penta-Punch (6015, attr 1): `move.id === ErMoveId.FIVE_STAR_FURY`. move.is-move resolves its name in MoveId and Five-Star Fury
// only exists in ErMoveId, so the atom would throw (request R10).
bindLegacyClosure(
  6015,
  1,
  "No atom can name an Elite Redux move: move.is-move looks the name up in MoveId, and Five-Star Fury only exists in ErMoveId; see request R10 in requests/B17.md",
  "gate",
);

// Perpetual Motion (6022, attr 0): `super.canApply(params) && SUCCESSFUL_HITS.has(hitResult) && !move has the "perpetual-motion" marker`.
// The first clause is move.damaging; the other two have no atom (requests R12 and R13) and share one gate slot.
bindLegacyClosure(
  6022,
  0,
  "No atom reads whether the hit landed (hitResult is Effective, Super effective, Not very effective or One-hit KO) or whether the move is the follow-up this ability queued; see requests R12 and R13 in requests/B17.md",
  "gate",
);

// Perpetual Motion (6022, attr 1): `(pokemon.tempSummonData?.turnCount ?? 0) > 0`. turnCount is an integer, so "> 0" is ">= 1".
bindCondition(6022, 1, { id: "time.turn-count", cmp: "gte", n: 1 }, "gate");

// Perpetual Motion (6022, attr 2): the gate is `pokemon.getLastXMoves(1)[0]?.move === MoveId.ROLLOUT`, which IS the atom
// `{ id: "time.last-move", who: "holder", moveId: "ROLLOUT" }` (proved by hand in test/.../B17/penta-perpetual.test.ts). It stays
// a written legacy-closure only because the shared L1 differential proves a gate through `canApply`, and this class runs its
// gate inside `apply` (the inherited canApply is always true, on purpose) with a trigger, event.my-move-starts, that has no
// engine-parameter builder in harness/world.ts (request R22 to the harness owner). Once R22 exists, replace this line with the
// bindCondition above.
bindLegacyClosure(
  6022,
  2,
  "The gate maps to atom time.last-move (holder, ROLLOUT) but the shared L1 cannot prove a gate that runs inside apply for the my-move-starts trigger: no engine-parameter builder exists in harness/world.ts; see request R22 in requests/B17.md",
  "gate",
);

// Phoenix Foliage (6029, attr 1, after I attack): `!isLiveCurrent(pokemon) && isPhoenixFoliageType(pokemon.getMoveType(move))`.
// mon.in-form reads getFormKey(), which equals `species.forms[formIndex]?.formKey` for a valid index and "" otherwise (never "live-current").
// move.type with effective=true reads moveUser.getMoveType(move); for the after-my-hit trigger moveUser is the holder.
bindCondition(
  6029,
  1,
  {
    all: [
      { not: { id: "mon.in-form", who: "holder", key: "live-current" } },
      {
        any: [
          { id: "move.type", type: "FIRE", effective: true },
          { id: "move.type", type: "ELECTRIC", effective: true },
        ],
      },
    ],
  },
  "gate",
);

// Phoenix Foliage (6029, attr 2, after I am hit): `!isLiveCurrent(pokemon) && isPhoenixFoliageType(opponent.getMoveType(move))`.
// For the after-hit trigger the frame's moveUser is the attacker, which is `opponent` in the class.
bindCondition(
  6029,
  2,
  {
    all: [
      { not: { id: "mon.in-form", who: "holder", key: "live-current" } },
      {
        any: [
          { id: "move.type", type: "FIRE", effective: true },
          { id: "move.type", type: "ELECTRIC", effective: true },
        ],
      },
    ],
  },
  "gate",
);

// ---- Chunk 3 (Push Kick, Sleeping In, Somniloquy, Splash Damage, Split Mind, Starcrossed, Third Eye). Same method as chunks 1 and 2:
// each gate was read by hand from the live `gate` method. Every gate of this chunk contains at least one clause that no atom can express
// yet, and one `gate` slot holds the whole gate, so each stays a written legacy-closure with the missing atoms listed in requests/B17.md.
// Split Mind (6045) and Third Eye (6048) have no gate and no closure, so they need no binding.

// Push Kick (6088, attr 0): `PUSH_KICK_TURN.get(holder) !== waveTurnCount && super.canApply` (damaging, hit landed, first strike, kicking move).
// Atoms exist for the damaging and kicking-move clauses (move.damaging, move.flag); the other three do not (R25, R12, R24).
bindLegacyClosure(
  6088,
  0,
  "No atom reads the class's own once-per-turn-out memory (R25), whether the hit landed (R12) or whether it is the first strike of my move (R24); see requests R25, R12 and R24 in requests/B17.md",
  "gate",
);

// Sleeping In (6056, attr 0): `isSleepInducingMove(move)` (the `accuracy !== -1` clause is a guard). No atom reads whether a move can put its target to sleep.
bindLegacyClosure(
  6056,
  0,
  "No atom reads whether the move can put its target to sleep or make it drowsy (a sleep effect or the drowsy effect among the move's attrs); see request R27 in requests/B17.md",
  "gate",
);

// Somniloquy (6058, attr 0): `turn > 0 && turn % 2 === 0 && !marker("somniloquy:" + turn)` (the `isFainted` clause is the guard not-fainted).
// time.turn-count covers the first clause; "every Nth turn" and a marker whose key contains the turn number have no atom (R26, R3/R23).
bindLegacyClosure(
  6058,
  0,
  "No atom tests 'every Nth turn' (turn % N === 0) or reads a marker whose key contains the turn number; see requests R26 and R3 (with R23) in requests/B17.md",
  "gate",
);

// Splash Damage (6025, attr 0) and Two-Chambered (6086, attr 2): `super.canApply && category !== STATUS && moveTarget in [NEAR_ENEMY, OTHER, NEAR_OTHER]
// && !marker("splash-damage:guard") && foe has a standing neighbour` (the `damage > 0` clause is a guard).
// move.damaging covers the first two; move.target-kind 'single' is a different list (it contains RANDOM_NEAR_ENEMY and lacks NEAR_ENEMY), the
// marker needs R3 and the neighbour test has no atom (R28, R3, R29).
bindLegacyClosure(
  6025,
  0,
  "No exact atom for the single-target move list [Near enemy, Other, Near other] (R28), the turn marker 'splash-damage:guard' (R3) or 'the foe has a standing neighbour' (R29); see requests in requests/B17.md",
  "gate",
);
bindLegacyClosure(
  6086,
  2,
  "No exact atom for the single-target move list [Near enemy, Other, Near other] (R28), the turn marker 'splash-damage:guard' (R3) or 'the foe has a standing neighbour' (R29); see requests in requests/B17.md",
  "gate",
);

// Starcrossed (6017, attr 0): `super.canApply` (move.canBeMultiStrikeEnhanced, empty filter) `&& isStarMove(holder, move)`.
bindLegacyClosure(
  6017,
  0,
  "No atom reads whether the move can be hit more than once by an ability (canBeMultiStrikeEnhanced, R30) or whether the move is Star-based (the Lunar property or the Astral Project marker, R31); see requests in requests/B17.md",
  "gate",
);

// Starcrossed (6017, attr 1): `super.canApply` (always true for the empty filter) `&& isStarMove(holder, move)`.
bindLegacyClosure(
  6017,
  1,
  "No atom reads whether the move is Star-based (the Lunar property or the Astral Project marker); see request R31 in requests/B17.md",
  "gate",
);
