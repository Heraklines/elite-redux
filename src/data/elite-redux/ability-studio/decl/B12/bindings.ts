/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Instance bindings of batch B12 (spec 2.1): the library form of every Tier B gate of the classes declared here, keyed by
// (abilityId, attrIndex, "gate"). Every line was read by hand from the live attr (the dump of its fields in the running game, not
// the source text: the vanilla-rebalance patcher pushes some attrs after construction) and mapped to the atom that reads the SAME
// engine value. The L1 differential then compares the class's own `gate` with the library form over the state grid.
//
// Reading guide: "attr N" is the position in `ability.attrs`. Ability ids are numbers because this file may be loaded before the
// ability list is.
//
// Classes of chunk 1 and what they bind:
//   FaintCountTriggerAbAttr            gate  not side.is { self }
//   StatTriggerOnKoAbAttr              gate  empty group (any faint) for Forsaken Heart; legacy for the nine "credited with the knock out" users
//   StatTriggerOnHitAbAttr             gate  empty group, an `any` of move.type, or legacy (plain contact flag)
//   StatTriggerOnStatLoweredAbAttr     gate  stage.just-changed { lowered }
//   StatTriggerOnAllyStatLoweredAbAttr gate  stage.just-changed { lowered }
//   StatusCascadeAbAttr                gate  status.has { other, Poison }
//   PerFaintStatMultiplierAbAttr, StatTriggerOnEntryAbAttr: nothing to bind (no closure, no gate)
import { bindCondition, bindLegacyClosure } from "#data/elite-redux/ability-studio/bindings";

type Site = readonly [abilityId: number, attrIndex: number, name: string];

function bindEach(spec: unknown, sites: readonly Site[]): void {
  for (const [abilityId, attrIndex] of sites) {
    bindCondition(abilityId, attrIndex, spec, "gate");
  }
}

function legacyEach(reason: string, sites: readonly Site[]): void {
  for (const [abilityId, attrIndex] of sites) {
    bindLegacyClosure(abilityId, attrIndex, reason, "gate");
  }
}

// =============================================================================================
// FaintCountTriggerAbAttr (1 attr). `victim.id !== pokemon.id`: the faint is not my own.
// =============================================================================================
bindEach({ not: { id: "side.is", kind: "self" } }, [[5589, 0, "Soul Harvest"]]);

// =============================================================================================
// StatTriggerOnKoAbAttr (10 attrs).
// =============================================================================================

// `triggerOnAnyFaint` true: the gate is `true` before any other clause. An empty group is always true.
bindEach({ all: [] }, [[5472, 0, "Forsaken Heart"]]);

// `victim !== pokemon && victim.turnData?.attacksReceived?.[0]?.sourceId === pokemon.id`. The first half is
// not(side.is self); the second half ("I am credited with the knock out") has no atom: request R-B12-01.
legacyEach(
  "needs an atom for 'I am the Pokemon credited with the knock out' (victim.turnData.attacksReceived[0].sourceId === holder.id); request R-B12-01",
  [
    [5003, 0, "Chilling Neigh"],
    [5185, 0, "Adrenaline Rush"],
    [5217, 0, "Super Strain"],
    [5262, 0, "Hubris"],
    [5301, 1, "Haunting Frenzy"],
    [5400, 0, "Dragon's Ritual"],
    [5559, 0, "Breezy Neigh"],
    [5630, 1, "Hydra"],
    [20022, 0, "As One"],
  ],
);

// =============================================================================================
// StatTriggerOnHitAbAttr (13 attrs). The class `guards` (hit landed) stays in the class; the gate is the filter.
// =============================================================================================

// `filter === null`: no limit, the gate is always true.
bindEach({ all: [] }, [
  [83, 1, "Anger Point"],
  [5211, 0, "Berserker Rage"],
  [5218, 0, "Tipping Point"],
  [5248, 0, "Fortitude"],
  [5256, 3, "Crowned Sword"],
  [5713, 1, "Petal Shield (second attr)"],
]);

// `filter.types = [FLYING, FIRE]`: `opponent.getMoveType(move)` is one of them (no flags list). move.type asks
// `moveUser.getMoveType(move)` and the moveUser of "after I am hit" is the attacker, the same Pokemon.
bindEach(
  {
    any: [
      { id: "move.type", type: "FLYING", effective: true },
      { id: "move.type", type: "FIRE", effective: true },
    ],
  },
  [
    [5028, 0, "Inflatable"],
    [5318, 0, "Balloon Bomb"],
    [5456, 0, "Balloon Blitz"],
  ],
);

// `filter.types = [ROCK]`
bindEach({ id: "move.type", type: "ROCK", effective: true }, [
  [5182, 0, "Furnace"],
  [5571, 0, "Ice Plumes"],
]);

// `filter.types = [WATER, ICE]`
bindEach(
  {
    any: [
      { id: "move.type", type: "WATER", effective: true },
      { id: "move.type", type: "ICE", effective: true },
    ],
  },
  [[5488, 0, "Cryo Architect"]],
);

// `filter.flags = [MAKES_CONTACT]`: `move.hasFlag(MAKES_CONTACT)`, the plain flag. The library move.flag atom asks
// doesFlagEffectApply, which is false for an attacker with Long Reach, for Punching Glove and for a substitute.
legacyEach(
  "reads the plain move flag move.hasFlag(MAKES_CONTACT); the library move.flag atom asks doesFlagEffectApply (Long Reach, Punching Glove, substitutes), a different answer; request R-B12-04",
  [[5199, 1, "Super Hot Goo"]],
);

// =============================================================================================
// StatTriggerOnStatLoweredAbAttr (13 attrs) and StatTriggerOnAllyStatLoweredAbAttr (6 attrs).
// Gate: `stages < 0` = stage.just-changed { lowered }. The residual `!selfTarget` stays in the class (R-B12-05).
// =============================================================================================
const LOWERED = { id: "stage.just-changed", direction: "lowered" };

bindEach(LOWERED, [
  // scope "self": +2 Speed, once per drop
  [50, 1, "Run Away"],
  [155, 4, "Rattled"],
  [193, 2, "Wimp Out"],
  [194, 2, "Emergency Exit"],
  [5165, 2, "Coward"],
  [5210, 1, "Dust Cloud"],
  [5282, 2, "Tactical Retreat"],
  // scope "side": once for each stat lowered
  [5145, 0, "King's Wrath"],
  [5146, 0, "Queen's Mourning"],
  [5664, 0, "Fire Ruler"],
  [5671, 0, "Emperor's Wrath (Attack and Defense)"],
  [5671, 2, "Emperor's Wrath (Sp. Atk and Sp. Def)"],
  [5939, 0, "Knight's Honor"],
  // the ally halves
  [5145, 1, "King's Wrath (ally half)"],
  [5146, 1, "Queen's Mourning (ally half)"],
  [5664, 1, "Fire Ruler (ally half)"],
  [5671, 1, "Emperor's Wrath (ally half, Attack and Defense)"],
  [5671, 3, "Emperor's Wrath (ally half, Sp. Atk and Sp. Def)"],
  [5939, 1, "Knight's Honor (ally half)"],
]);

// =============================================================================================
// StatusCascadeAbAttr (1 attr). `opponent.status?.effect === trigger` with trigger POISON.
// =============================================================================================
bindEach({ id: "status.has", who: "other", status: "POISON" }, [[5451, 0, "Neurotoxin"]]);
