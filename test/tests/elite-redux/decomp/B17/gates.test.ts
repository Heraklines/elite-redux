/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 1: what the shared L1 grid cannot see. The grid only changes the HOLDER's status, never the foe's, and it
// never sets a critical hit, a foe item or a same-side attacker, so a wrong status or side in a gate binding would
// pass it (checked by mutation: BURN -> POISON in the Moxibustion binding stayed green). These tests drive the real
// classes through those states and compare three things:
//   1. the class after the gate/residual split against a copy of its OLD canApply (the refactor changed nothing),
//   2. the rebuilt attr (library gate from bindings.ts) against the original attr,
//   3. a deliberately wrong gate against the original (the proof can fail).
import { allMoves } from "#data/data-lists";
import {
  MetallosisPoisonAbAttr,
  type MoxibustionAbAttr,
  OracleEntryAbAttr,
  type OracleGuardTickAbAttr,
} from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { RngProbe } from "#test/tests/elite-redux/decomp/harness/differential";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setStatusOf } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const MOXIBUSTION = 6032;
const MAGICIAN = 170;
const METALLOSIS = 6049;
const ORACLE = 6047;
const LINGERING_MUSK = 6084;
const MUTUAL_DESTRUCTION = 6104;

const ALL_STATUSES = [
  StatusEffect.NONE,
  StatusEffect.POISON,
  StatusEffect.TOXIC,
  StatusEffect.PARALYSIS,
  StatusEffect.SLEEP,
  StatusEffect.FREEZE,
  StatusEffect.BURN,
];
// Contact and non-contact, damaging and status moves.
const MOVES = [MoveId.TACKLE, MoveId.WATER_GUN, MoveId.EMBER, MoveId.SPLASH, MoveId.SWORDS_DANCE, MoveId.DOUBLE_SLAP];

function site(abilityId: number, className: string) {
  const found = allAttrSites().find(s => s.abilityId === abilityId && s.className === className);
  if (found === undefined) {
    throw new Error(`${className} is not an attr of ability ${abilityId}`);
  }
  return found;
}

function rebuildOf(abilityId: number, className: string) {
  const s = site(abilityId, className);
  const module = declRegistry.get(className);
  expect(module, `${className} has a declaration`).toBeDefined();
  return { original: s.attr, rebuilt: recomposeAttr(module!, s.attr, abilityId, s.attrIndex), module: module! };
}

describe("B17 gates: refactor and bindings against the old canApply, over states the grid lacks", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Moxibustion: burned target, damaging move, damage above 0 (old canApply, refactor, rebuild, and a wrong gate)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const { original, rebuilt, module } = rebuildOf(MOXIBUSTION, "MoxibustionAbAttr");
    const wrong = buildAttr(
      module,
      { healPercent: 75 },
      {
        gate: {
          all: [{ block: "move.damaging" }, { block: "status.has", params: { who: "other", status: "POISON" } }],
        },
      },
    );
    // The OLD canApply: super.canApply (move is not a status move) && damage > 0 && target burned.
    const oldCanApply = (move: MoveId, damage: number): boolean =>
      allMoves[move].category !== 2 && damage > 0 && foe.status?.effect === StatusEffect.BURN;
    let trueCount = 0;
    let wrongDiffers = false;
    for (const status of ALL_STATUSES) {
      setStatusOf(foe, status);
      for (const move of MOVES) {
        for (const damage of [0, 1, 9]) {
          const params = {
            pokemon: holder,
            opponent: foe,
            move: allMoves[move],
            damage,
            hitResult: HitResult.EFFECTIVE,
            simulated: false,
          };
          const expected = oldCanApply(move, damage);
          if (expected) {
            trueCount++;
          }
          const label = `${StatusEffect[status]} ${MoveId[move]} damage ${damage}`;
          expect(original.canApply(params as never), `refactored class, ${label}`).toBe(expected);
          expect(rebuilt.canApply(params as never), `rebuilt from the library gate, ${label}`).toBe(expected);
          wrongDiffers ||= wrong.canApply(params as never) !== expected;
        }
      }
    }
    expect(trueCount, "the grid really reaches the firing case").toBeGreaterThan(0);
    expect(wrongDiffers, "a gate for the wrong status is caught by this test").toBe(true);
  });

  it("Moxibustion: the heal share is a typed setting and the shipped value is unchanged", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    setStatusOf(foe, StatusEffect.BURN);
    const module = declRegistry.get("MoxibustionAbAttr")!;
    const shipped = site(MOXIBUSTION, "MoxibustionAbAttr").attr as MoxibustionAbAttr;
    expect(shipped.healShare).toBe(0.75);
    const half = buildAttr(
      module,
      { healPercent: 50 },
      { gate: { all: [{ block: "move.damaging" }] } },
    ) as MoxibustionAbAttr;
    expect(half.healShare).toBe(0.5);
    const healed: number[] = [];
    vi.spyOn(game.scene.phaseManager, "unshiftNew").mockImplementation(((
      name: string,
      _index: number,
      amount: number,
    ) => {
      if (name === "PokemonHealPhase") {
        healed.push(amount);
      }
    }) as never);
    const apply = (attr: MoxibustionAbAttr, damage: number, simulated = false): void =>
      attr.apply({
        pokemon: holder,
        opponent: foe,
        move: allMoves[MoveId.TACKLE],
        damage,
        hitResult: HitResult.EFFECTIVE,
        simulated,
      } as never);
    apply(shipped, 9); // floor(6.75) = 6
    apply(shipped, 1); // floor(0.75) = 0, raised to the minimum 1
    apply(half, 9); // floor(4.5) = 4
    apply(shipped, 9, true); // a preview heals nothing
    expect(healed).toEqual([6, 1, 4]);
  });

  it("Metallosis: damage above 0, damaging move, critical hit on the target, target can take the status", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = site(METALLOSIS, "MetallosisPoisonAbAttr").attr as MetallosisPoisonAbAttr;
    expect(original.status).toBe(StatusEffect.POISON);
    const critical = (value: boolean): void => {
      foe.turnData.attacksReceived = [
        { move: MoveId.TACKLE, result: HitResult.EFFECTIVE, damage: 5, critical: value, sourceId: holder.id },
      ] as never;
    };
    // The OLD canApply: super.canApply && damage > 0 && critical && canSetStatus(POISON, true, false, holder).
    const oldCanApply = (move: MoveId, damage: number): boolean =>
      allMoves[move].category !== 2
      && damage > 0
      && !!foe.turnData.attacksReceived[0]?.critical
      && foe.canSetStatus(StatusEffect.POISON, true, false, holder);
    let trueCount = 0;
    for (const crit of [false, true]) {
      critical(crit);
      for (const status of ALL_STATUSES) {
        setStatusOf(foe, status);
        for (const move of MOVES) {
          for (const damage of [0, 3]) {
            const params = {
              pokemon: holder,
              opponent: foe,
              move: allMoves[move],
              damage,
              hitResult: HitResult.EFFECTIVE,
              simulated: false,
            };
            const expected = oldCanApply(move, damage);
            trueCount += expected ? 1 : 0;
            expect(
              original.canApply(params as never),
              `crit ${crit}, ${StatusEffect[status]}, ${MoveId[move]}, damage ${damage}`,
            ).toBe(expected);
          }
        }
      }
    }
    expect(trueCount).toBeGreaterThan(0);
    // The status is a typed setting: another status is given when the class is built with it.
    expect(new MetallosisPoisonAbAttr(StatusEffect.BURN).status).toBe(StatusEffect.BURN);
  });

  it("Magician: a contact hit never draws, a non-contact hit draws once; refactor, rebuild and a wrong gate agree with the old rule", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const { getModifierType } = await import("#utils/modifier-utils");
    const { modifierTypes } = await import("#data/data-lists");
    game.scene.addEnemyModifier(getModifierType(modifierTypes.LEFTOVERS).newModifier(foe), true, true);
    const { original, rebuilt, module } = rebuildOf(MAGICIAN, "ErMagicianStealAbAttr");
    const wrong = buildAttr(module, {}, { gate: { block: "move.flag", params: { flag: "MAKES_CONTACT" } } });
    const rng = new RngProbe(game);
    const run = (attr: typeof original, params: object): [boolean, number] => {
      rng.reset();
      const result = attr.canApply(params as never);
      return [result, rng.count];
    };
    let nonContactTrue = 0;
    let wrongDiffers = false;
    try {
      for (const move of MOVES) {
        for (const hitResult of [HitResult.EFFECTIVE, HitResult.NO_EFFECT]) {
          for (const simulated of [false, true]) {
            const params = { pokemon: holder, opponent: foe, move: allMoves[move], damage: 5, hitResult, simulated };
            const [a, aDraws] = run(original, params);
            const [b, bDraws] = run(rebuilt, params);
            const [c] = run(wrong, params);
            const label = `${MoveId[move]} ${HitResult[hitResult]} simulated ${simulated}`;
            expect(b, `rebuild result, ${label}`).toBe(a);
            expect(bDraws, `rebuild draws, ${label}`).toBe(aDraws);
            wrongDiffers ||= c !== a;
            if (a) {
              nonContactTrue++;
              expect(aDraws, `a steal that fires draws exactly once, ${label}`).toBe(1);
            }
          }
        }
      }
    } finally {
      rng.restore();
    }
    expect(nonContactTrue, "a non-contact damaging hit on an item holder fires").toBeGreaterThan(0);
    expect(wrongDiffers, "the un-negated contact gate is caught by this test").toBe(true);
    // Contact (Tackle): false and no draw at all. Non-contact (Water Gun): true.
    const rng2 = new RngProbe(game);
    try {
      rng2.reset();
      expect(
        original.canApply({
          pokemon: holder,
          opponent: foe,
          move: allMoves[MoveId.TACKLE],
          damage: 5,
          hitResult: HitResult.EFFECTIVE,
          simulated: false,
        } as never),
      ).toBe(false);
      expect(rng2.count).toBe(0);
      rng2.reset();
      expect(
        original.canApply({
          pokemon: holder,
          opponent: foe,
          move: allMoves[MoveId.WATER_GUN],
          damage: 5,
          hitResult: HitResult.EFFECTIVE,
          simulated: false,
        } as never),
      ).toBe(true);
      expect(rng2.count).toBe(1);
    } finally {
      rng2.restore();
    }
  });

  it("Mutual Destruction: a move, a known and standing attacker, not on my side (foe, ally stand-in, self)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const { original, rebuilt, module } = rebuildOf(MUTUAL_DESTRUCTION, "MutualDestructionPostFaintAbAttr");
    const wrong = buildAttr(module, {}, { gate: { block: "side.is", params: { kind: "foe" } } });
    // Stand-ins model what the gate reads: isPlayer(), isFainted() and getAllies() (the other ACTIVE battlers of the attacker's side).
    const standIn = (sameSide: boolean, fainted: boolean, alliesIncludeHolder: boolean): Pokemon =>
      ({
        isFainted: () => fainted,
        isPlayer: () => (sameSide ? holder.isPlayer() : !holder.isPlayer()),
        getAllies: () => (alliesIncludeHolder ? [holder] : []),
      }) as unknown as Pokemon;
    const attackers: { label: string; attacker: Pokemon | undefined }[] = [
      { label: "real foe", attacker: foe },
      { label: "no attacker", attacker: undefined },
      { label: "fainted foe", attacker: standIn(false, true, false) },
      { label: "ally (same side, lists me)", attacker: standIn(true, false, true) },
      { label: "fainted ally", attacker: standIn(true, true, true) },
      { label: "the holder itself", attacker: holder },
    ];
    let wrongDiffers = false;
    let fires = 0;
    for (const move of [undefined, allMoves[MoveId.TACKLE]]) {
      for (const { label, attacker } of attackers) {
        const params = { pokemon: holder, attacker, move, simulated: false };
        // The OLD canApply.
        const expected = !!move && !!attacker && !attacker.isFainted() && !attacker.getAllies().includes(holder);
        fires += expected ? 1 : 0;
        const text = `${label}, move ${move === undefined ? "none" : "Tackle"}`;
        expect(original.canApply(params as never), `refactored class, ${text}`).toBe(expected);
        expect(rebuilt.canApply(params as never), `rebuilt from the library gate, ${text}`).toBe(expected);
        wrongDiffers ||= wrong.canApply(params as never) !== expected;
      }
    }
    expect(fires).toBeGreaterThan(0);
    expect(wrongDiffers, "a gate for the wrong side is caught by this test").toBe(true);
    // apply: all of the attacker's HP, nothing when simulated.
    const damage = vi.spyOn(foe, "damageAndUpdate").mockImplementation((() => 0) as never);
    original.apply({ pokemon: holder, attacker: foe, move: allMoves[MoveId.TACKLE], simulated: true } as never);
    expect(damage).not.toHaveBeenCalled();
    original.apply({ pokemon: holder, attacker: foe, move: allMoves[MoveId.TACKLE], simulated: false } as never);
    expect(damage).toHaveBeenCalledWith(foe.hp, expect.objectContaining({ result: HitResult.INDIRECT }));
  });

  it("Lingering Musk: the survival marker, the end-of-turn faint, and the marker set by a preview (suspected bug, recorded)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const endure = site(LINGERING_MUSK, "LingeringMuskEndureAbAttr").attr;
    const tick = site(LINGERING_MUSK, "LingeringMuskPostTurnAbAttr").attr;
    const marker = (): unknown =>
      (holder.tempSummonData as unknown as { lingeringMuskFaint?: boolean }).lingeringMuskFaint;
    const frame = (damage: number, simulated: boolean) => ({
      pokemon: holder,
      opponent: foe,
      move: allMoves[MoveId.TACKLE],
      damage: new NumberHolder(damage),
      simulated,
    });
    expect(tick.canApply({ pokemon: holder, simulated: false } as never), "no marker yet").toBe(false);
    holder.hp = 10;
    expect(endure.canApply(frame(5, false) as never), "a hit that does not knock me out").toBe(false);
    expect(endure.canApply(frame(10, false) as never), "a knockout hit").toBe(true);
    // A preview applies too (the engine passes the caller's simulated flag): the tag is skipped, the marker is not.
    endure.apply(frame(10, true) as never);
    expect(marker(), "SUSPECTED BUG recorded: a previewed knockout sets the marker").toBe(true);
    expect(holder.getTag(BattlerTagType.STURDY), "the survival tag is skipped for a preview").toBeUndefined();
    expect(tick.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
    // Reset and do it for real.
    (holder.tempSummonData as unknown as { lingeringMuskFaint?: boolean }).lingeringMuskFaint = undefined;
    endure.apply(frame(10, false) as never);
    expect(marker()).toBe(true);
    const faintDamage = vi.spyOn(holder, "damageAndUpdate").mockImplementation((() => 0) as never);
    tick.apply({ pokemon: holder, simulated: true } as never);
    expect(faintDamage).not.toHaveBeenCalled();
    tick.apply({ pokemon: holder, simulated: false } as never);
    expect(faintDamage).toHaveBeenCalledWith(holder.hp, expect.objectContaining({ result: HitResult.INDIRECT }));
  });

  it("Oracle: the first entry starts the guard once, the tick counts it down, and guardTurns is a typed setting", async () => {
    const { holder } = await startWorld(phaserGame);
    const entry = site(ORACLE, "OracleEntryAbAttr").attr as OracleEntryAbAttr;
    const tick = site(ORACLE, "OracleGuardTickAbAttr").attr as OracleGuardTickAbAttr;
    expect(entry.guardTurns).toBe(3);
    const guard = (): string[] => holder.summonData.erAbilityProvenance.filter(v => v.startsWith("oracle:guard:"));
    const frame = (simulated = false) => ({ pokemon: holder, simulated }) as never;
    entry.apply(frame(true));
    expect(guard(), "a preview starts nothing").toEqual([]);
    entry.apply(frame());
    expect(guard()).toEqual(["oracle:guard:3"]);
    expect(holder.battleData.erAbilityProvenance).toContain("oracle:first-entry");
    // The tick: 3 -> 2 -> 1 -> gone, nothing when simulated, nothing without a guard.
    tick.apply(frame(true));
    expect(guard()).toEqual(["oracle:guard:3"]);
    tick.apply(frame());
    expect(guard()).toEqual(["oracle:guard:2"]);
    tick.apply(frame());
    expect(guard()).toEqual(["oracle:guard:1"]);
    tick.apply(frame());
    expect(guard()).toEqual([]);
    tick.apply(frame());
    expect(guard()).toEqual([]);
    // A second entry in the same battle starts nothing (the first-entry memory blocks it).
    entry.apply(frame());
    expect(guard()).toEqual([]);
    // A fresh Pokemon memory and a longer guard.
    holder.battleData.erAbilityProvenance = holder.battleData.erAbilityProvenance.filter(
      v => v !== "oracle:first-entry",
    );
    new OracleEntryAbAttr(5).apply(frame());
    expect(guard()).toEqual(["oracle:guard:5"]);
  });
});
