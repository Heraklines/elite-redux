/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 3: Two-Faced Unleashed recoil (5977 attr 1), Ring General (5987), Setlist (5989), Fan Favorite (5990).
// The shared L1 and L2 suites cannot reach the private memories of these classes (the other face, the move pattern, the
// entry turn, the recoil record) or a bench of a chosen size, so the probes here drive them through the real helpers and
// compare each original attr with its rebuild. They also prove that the old literals are the defaults of the new
// constructor arguments, that a different argument really changes the effect, and that a gate swap does not drop the
// clauses that stay in the class.
import type { AbAttr } from "#abilities/ab-attrs";
import { allMoves } from "#data/data-lists";
import {
  type FanFavoriteAccuracyAbAttr,
  type FanFavoritePowerAbAttr,
  finishSetlistMove,
  prepareTwoFacedMove,
  RingGeneralEntryAbAttr,
  type RingGeneralTrapAbAttr,
  type SetlistAccuracyAbAttr,
  type SetlistPowerAbAttr,
  type SetlistResetAbAttr,
  type TwoFacedPowerAbAttr,
  type TwoFacedRecoilAbAttr,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattlerIndex } from "#enums/battler-index";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { BooleanHolder, NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const TWO_FACED = 5977;
const RING_GENERAL = 5987;
const SETLIST = 5989;
const FAN_FAVORITE = 5990;

function module(name: string) {
  const found = declRegistry.get(name);
  expect(found, `${name} must be declared`).toBeDefined();
  return found!;
}

const damaging = { block: "move.damaging", params: {} } as never;
const sameGate = (attr: { gate(p: never): boolean }): never => ((p: never) => attr.gate(p)) as never;

describe("B13 chunk 3", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  function holderUses(holder: Pokemon, move = MoveId.TACKLE): void {
    holder.pushMoveHistory({
      move,
      targets: [BattlerIndex.ENEMY],
      useMode: MoveUseMode.NORMAL,
      result: MoveResult.SUCCESS,
    });
  }

  it("the shipped instances carry the old literals, the others are the defaults of the new arguments", () => {
    const tf = liveAbility(TWO_FACED).attrs as [TwoFacedPowerAbAttr, TwoFacedRecoilAbAttr];
    expect(tf[1].recoilPercent).toBe(15);
    const sl = liveAbility(SETLIST).attrs as [SetlistResetAbAttr, SetlistPowerAbAttr, SetlistAccuracyAbAttr];
    expect([sl[1].bonusPercentPerStep, sl[2].bonusPercentPerStep]).toEqual([20, 10]);
    const ff = liveAbility(FAN_FAVORITE).attrs as [FanFavoritePowerAbAttr, FanFavoriteAccuracyAbAttr];
    expect([ff[0].bonusPercentPerBenched, ff[0].maxBenched]).toEqual([5, 5]);
    expect([ff[1].bonusPercentPerBenched, ff[1].maxBenched]).toEqual([5, 5]);
    // The percent / 100 forms are the very same doubles as the old literals.
    expect(15 / 100).toBe(0.15);
    expect(20 / 100).toBe(0.2);
    expect(10 / 100).toBe(0.1);
    expect(5 / 100).toBe(0.05);
  });

  describe("Two-Faced Unleashed recoil", () => {
    const params = (holder: Pokemon, foe: Pokemon, moveId = MoveId.TACKLE, damage = 10, simulated = false): never =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[moveId],
        damage,
        hitResult: HitResult.EFFECTIVE,
        simulated,
      }) as never;

    it("needs the face out, damage, a damaging move and a move not counted yet; costs 15% of max HP and never faints; no draw", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(TWO_FACED).attrs[1] as TwoFacedRecoilAbAttr;
      const rebuilt = buildAttr(
        module("TwoFacedRecoilAbAttr"),
        {},
        { "ctor:0": damaging, gate: sameGate(original) },
      ) as AbAttr;
      expect(rebuilt).not.toBe(original);
      const both = (...args: Parameters<typeof params>): [boolean, boolean] => [
        original.canApply(params(...args)),
        rebuilt.canApply(params(...args)),
      ];
      const draws = vi.spyOn(game.scene, "randBattleSeedInt");

      holderUses(holder);
      expect(both(holder, foe)).toEqual([false, false]); // the face is not out
      const spy = vi
        .spyOn(holder, "getAllActiveAbilityAttrs")
        .mockReturnValue([liveAbility(TWO_FACED).attrs[0]] as never);
      prepareTwoFacedMove(holder, allMoves[MoveId.TACKLE]);
      expect(both(holder, foe)).toEqual([true, true]);
      expect(both(holder, foe, MoveId.SWORDS_DANCE)).toEqual([false, false]); // clause 1, the base attack condition
      expect(both(holder, foe, MoveId.TACKLE, 0)).toEqual([false, false]); // clause 2, no damage

      const max = holder.getMaxHp();
      const hpBefore = holder.hp;
      original.apply(params(holder, foe));
      expect(hpBefore - holder.hp).toBe(Math.floor(max * 0.15));
      // The record of this move is spent; a new move of mine is a new chance.
      expect(both(holder, foe)).toEqual([false, false]);
      holderUses(holder);
      expect(both(holder, foe)).toEqual([true, true]);

      // Never below 1 HP: at 3 HP the recoil is capped at 2.
      holder.hp = 3;
      rebuilt.apply(params(holder, foe));
      expect(holder.hp).toBe(1);
      holderUses(holder);
      rebuilt.apply(params(holder, foe));
      expect(holder.hp).toBe(1);

      // A simulated call changes no HP but spends the once-per-move memory (oddity in the notes).
      holder.hp = max;
      holderUses(holder);
      original.apply(params(holder, foe, MoveId.TACKLE, 10, true));
      expect(holder.hp).toBe(max);
      expect(both(holder, foe)).toEqual([false, false]);
      expect(draws).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("the recoil percent is a param, and a swapped gate does not drop the clauses that stay in the class", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const custom = buildAttr(
        module("TwoFacedRecoilAbAttr"),
        { recoilPercent: 50 },
        { "ctor:0": damaging, gate: () => true },
      ) as TwoFacedRecoilAbAttr;
      expect(custom.recoilPercent).toBe(50);
      // gate swapped to always true: the face need not be out, but the guards and the residual still apply.
      expect(custom.canApply(params(holder, foe))).toBe(false); // no move record yet (residual)
      holderUses(holder);
      expect(custom.canApply(params(holder, foe))).toBe(true);
      expect(custom.canApply(params(holder, foe, MoveId.TACKLE, 0))).toBe(false); // guard: damage
      expect(custom.canApply(params(holder, foe, MoveId.SWORDS_DANCE))).toBe(false); // guard: attack condition
      const max = holder.getMaxHp();
      custom.apply(params(holder, foe));
      expect(max - holder.hp).toBe(Math.floor(max * 0.5));
    });
  });

  describe("Setlist", () => {
    const power = (holder: Pokemon, foe: Pokemon, moveId: MoveId): never =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[moveId],
        power: new NumberHolder(100),
        simulated: false,
      }) as never;
    const accuracy = (holder: Pokemon, moveId: MoveId, value = 100): never =>
      ({ pokemon: holder, move: allMoves[moveId], accuracy: new NumberHolder(value), simulated: false }) as never;
    const powerOut = (attr: AbAttr, holder: Pokemon, foe: Pokemon, moveId: MoveId): number | undefined => {
      const p = power(holder, foe, moveId);
      if (!attr.canApply(p)) {
        return;
      }
      attr.apply(p);
      return (p as { power: NumberHolder }).power.value;
    };
    const accuracyOut = (attr: AbAttr, holder: Pokemon, moveId: MoveId, value = 100): number | undefined => {
      const p = accuracy(holder, moveId, value);
      if (!attr.canApply(p)) {
        return;
      }
      attr.apply(p);
      return (p as { accuracy: NumberHolder }).accuracy.value;
    };

    it("records two moves, expects them in turn, builds the crescendo up to step 2, and a wrong move resets it; original equals rebuild", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const [reset, originalPower, originalAccuracy] = liveAbility(SETLIST).attrs as [
        SetlistResetAbAttr,
        SetlistPowerAbAttr,
        SetlistAccuracyAbAttr,
      ];
      const rebuiltPower = buildAttr(module("SetlistPowerAbAttr"), {}, { gate: sameGate(originalPower) }) as AbAttr;
      const rebuiltAccuracy = buildAttr(
        module("SetlistAccuracyAbAttr"),
        {},
        { gate: sameGate(originalAccuracy) },
      ) as AbAttr;
      const spy = vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([originalPower] as never);
      const outs = (moveId: MoveId): unknown[] => [
        powerOut(originalPower, holder, foe, moveId),
        powerOut(rebuiltPower, holder, foe, moveId),
        accuracyOut(originalAccuracy, holder, moveId),
        accuracyOut(rebuiltAccuracy, holder, moveId),
      ];

      reset.apply({ pokemon: holder, simulated: false } as never);
      // Nothing recorded: no boost for anything.
      expect(outs(MoveId.TACKLE)).toEqual([undefined, undefined, undefined, undefined]);
      finishSetlistMove(holder, allMoves[MoveId.TACKLE]); // records Tackle
      finishSetlistMove(holder, allMoves[MoveId.SWORDS_DANCE]); // a status move is skipped
      expect(outs(MoveId.TACKLE)).toEqual([undefined, undefined, undefined, undefined]);
      finishSetlistMove(holder, allMoves[MoveId.EMBER]); // records Ember, Tackle is expected
      // Step 1: Tackle is expected, Ember is not.
      expect(outs(MoveId.TACKLE)).toEqual([
        100 * (1 + 1 * 0.2),
        100 * (1 + 1 * 0.2),
        100 * (1 + 1 * 0.1),
        100 * (1 + 1 * 0.1),
      ]);
      expect(outs(MoveId.EMBER)).toEqual([undefined, undefined, undefined, undefined]);
      // Never-miss and zero accuracy are left alone by the accuracy part (first clause).
      expect(accuracyOut(originalAccuracy, holder, MoveId.TACKLE, -1)).toBeUndefined();
      expect(accuracyOut(rebuiltAccuracy, holder, MoveId.TACKLE, 0)).toBeUndefined();
      // The expected move succeeds: crescendo 1, Ember is next at step 2.
      finishSetlistMove(holder, allMoves[MoveId.TACKLE]);
      expect(outs(MoveId.EMBER)).toEqual([
        100 * (1 + 2 * 0.2),
        100 * (1 + 2 * 0.2),
        100 * (1 + 2 * 0.1),
        100 * (1 + 2 * 0.1),
      ]);
      finishSetlistMove(holder, allMoves[MoveId.EMBER]); // crescendo 2, Tackle next, still step 2 (the cap)
      expect(outs(MoveId.TACKLE)).toEqual([
        100 * (1 + 2 * 0.2),
        100 * (1 + 2 * 0.2),
        100 * (1 + 2 * 0.1),
        100 * (1 + 2 * 0.1),
      ]);
      // A wrong move resets the crescendo to step 1 with Tackle next.
      finishSetlistMove(holder, allMoves[MoveId.WATER_GUN]);
      expect(outs(MoveId.TACKLE)).toEqual([
        100 * (1 + 1 * 0.2),
        100 * (1 + 1 * 0.2),
        100 * (1 + 1 * 0.1),
        100 * (1 + 1 * 0.1),
      ]);
      // Entering again forgets everything.
      reset.apply({ pokemon: holder, simulated: false } as never);
      expect(outs(MoveId.TACKLE)).toEqual([undefined, undefined, undefined, undefined]);
      spy.mockRestore();
    });

    it("the bonus per step is a param for both attrs", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const [reset, originalPower, originalAccuracy] = liveAbility(SETLIST).attrs as [
        SetlistResetAbAttr,
        SetlistPowerAbAttr,
        SetlistAccuracyAbAttr,
      ];
      const spy = vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([originalPower] as never);
      reset.apply({ pokemon: holder, simulated: false } as never);
      finishSetlistMove(holder, allMoves[MoveId.TACKLE]);
      finishSetlistMove(holder, allMoves[MoveId.EMBER]);
      const power = buildAttr(
        module("SetlistPowerAbAttr"),
        { bonusPercentPerStep: 50 },
        { gate: sameGate(originalPower) },
      ) as AbAttr;
      const accuracy = buildAttr(
        module("SetlistAccuracyAbAttr"),
        { bonusPercentPerStep: 30 },
        { gate: sameGate(originalAccuracy) },
      ) as AbAttr;
      expect(powerOut(power, holder, foe, MoveId.TACKLE)).toBe(100 * (1 + 1 * 0.5));
      expect(accuracyOut(accuracy, holder, MoveId.TACKLE, 80)).toBe(80 * (1 + 1 * 0.3));
      // A swapped gate (always true) does not drop the accuracy guard.
      const anyMove = buildAttr(module("SetlistAccuracyAbAttr"), {}, { gate: () => true }) as AbAttr;
      // The gate now lets Ember through, but the effect still reads the pattern memory: step 0 for a move that is not expected.
      expect(accuracyOut(anyMove, holder, MoveId.EMBER, 80)).toBe(80);
      expect(accuracyOut(anyMove, holder, MoveId.TACKLE, 80)).toBe(80 * (1 + 1 * 0.1));
      expect(accuracyOut(anyMove, holder, MoveId.EMBER, -1)).toBeUndefined();
      spy.mockRestore();
    });
  });

  describe("Fan Favorite", () => {
    const fakeParty = (holder: Pokemon, benched: number, fainted = 0, onField = 0): never =>
      [
        holder,
        ...Array.from({ length: benched }, () => ({ isFainted: () => false, isOnField: () => false })),
        ...Array.from({ length: fainted }, () => ({ isFainted: () => true, isOnField: () => false })),
        ...Array.from({ length: onField }, () => ({ isFainted: () => false, isOnField: () => true })),
      ] as never;
    const power = (holder: Pokemon, foe: Pokemon, moveId: MoveId): never =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[moveId],
        power: new NumberHolder(100),
        simulated: false,
      }) as never;
    const accuracy = (holder: Pokemon, value = 100): never =>
      ({
        pokemon: holder,
        move: allMoves[MoveId.TACKLE],
        accuracy: new NumberHolder(value),
        simulated: false,
      }) as never;

    it("special moves gain 5% per healthy benched teammate (up to 5); the accuracy part counts for every move; original equals rebuild", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const [originalPower, originalAccuracy] = liveAbility(FAN_FAVORITE).attrs as [
        FanFavoritePowerAbAttr,
        FanFavoriteAccuracyAbAttr,
      ];
      const rebuiltPower = recomposeAttr(module("FanFavoritePowerAbAttr"), originalPower, FAN_FAVORITE, 0) as AbAttr;
      const rebuiltAccuracy = buildAttr(
        module("FanFavoriteAccuracyAbAttr"),
        {},
        { gate: sameGate(originalAccuracy) },
      ) as AbAttr;
      const powerOf = (attr: AbAttr, moveId: MoveId): number | undefined => {
        const p = power(holder, foe, moveId);
        if (!attr.canApply(p)) {
          return;
        }
        attr.apply(p);
        return (p as { power: NumberHolder }).power.value;
      };
      const accuracyOf = (attr: AbAttr, value = 100): number | undefined => {
        const p = accuracy(holder, value);
        if (!attr.canApply(p)) {
          return;
        }
        attr.apply(p);
        return (p as { accuracy: NumberHolder }).accuracy.value;
      };
      const cases: [number, number, number, number | undefined][] = [
        // [benched, fainted, on the field, expected multiplier steps (undefined = no boost)]
        [0, 0, 0, undefined],
        [0, 3, 2, undefined], // fainted and on-field members never count
        [1, 0, 0, 1],
        [3, 2, 1, 3],
        [5, 0, 0, 5],
        [6, 0, 0, 5], // capped at 5
      ];
      for (const [benched, fainted, onField, steps] of cases) {
        vi.spyOn(game.scene, "getPlayerParty").mockReturnValue(fakeParty(holder, benched, fainted, onField));
        const label = `benched ${benched}, fainted ${fainted}, on the field ${onField}`;
        const expectedPower = steps === undefined ? undefined : 100 * (1 + steps * 0.05);
        const expectedAccuracy = steps === undefined ? undefined : 100 * (1 + steps * 0.05);
        expect([label, powerOf(originalPower, MoveId.EMBER), powerOf(rebuiltPower, MoveId.EMBER)]).toEqual([
          label,
          expectedPower,
          expectedPower,
        ]);
        expect([label, accuracyOf(originalAccuracy), accuracyOf(rebuiltAccuracy)]).toEqual([
          label,
          expectedAccuracy,
          expectedAccuracy,
        ]);
        // A physical move gets no power bonus (clause 1) but still gets the accuracy bonus.
        expect(powerOf(originalPower, MoveId.TACKLE)).toBeUndefined();
        expect(powerOf(rebuiltPower, MoveId.TACKLE)).toBeUndefined();
      }
      // Never-miss and zero accuracy are left alone.
      vi.spyOn(game.scene, "getPlayerParty").mockReturnValue(fakeParty(holder, 2));
      expect(accuracyOf(originalAccuracy, -1)).toBeUndefined();
      expect(accuracyOf(rebuiltAccuracy, 0)).toBeUndefined();
    });

    it("the bonus and the cap are params, and a swapped gate does not drop the bench rule", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const custom = buildAttr(
        module("FanFavoritePowerAbAttr"),
        { bonusPercentPerBenched: 10, maxBenched: 2 },
        { gate: () => true },
      ) as AbAttr;
      vi.spyOn(game.scene, "getPlayerParty").mockReturnValue(fakeParty(holder, 4));
      const p = power(holder, foe, MoveId.TACKLE); // any move: the gate is swapped
      expect(custom.canApply(p)).toBe(true);
      custom.apply(p);
      expect((p as { power: NumberHolder }).power.value).toBe(100 * (1 + 2 * 0.1)); // capped at 2
      vi.spyOn(game.scene, "getPlayerParty").mockReturnValue(fakeParty(holder, 0));
      expect(custom.canApply(power(holder, foe, MoveId.TACKLE))).toBe(false); // the residual stays
    });
  });

  describe("Ring General", () => {
    const params = (holder: Pokemon, foe: Pokemon): never =>
      ({ pokemon: holder, opponent: foe, trapped: new BooleanHolder(false), simulated: true }) as never;

    it("traps while above half HP (counted in whole percents), not on the entry turn, never a Ghost; original equals rebuild", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const [entry, trap] = liveAbility(RING_GENERAL).attrs as [RingGeneralEntryAbAttr, RingGeneralTrapAbAttr];
      expect(entry).toBeInstanceOf(RingGeneralEntryAbAttr);
      const rebuilt = recomposeAttr(module("RingGeneralTrapAbAttr"), trap, RING_GENERAL, 1) as AbAttr;
      const both = (): [boolean, boolean] => [
        trap.canApply(params(holder, foe)),
        rebuilt.canApply(params(holder, foe)),
      ];

      holder.hp = holder.getMaxHp();
      expect(both()).toEqual([true, true]);

      // The HP rule is the ROUNDED ratio: find the lowest HP that still passes and check both sides of it.
      const max = holder.getMaxHp();
      let lowest = max;
      while (lowest > 1 && Math.round(((lowest - 1) / max) * 100) / 100 > 0.5) {
        lowest--;
      }
      holder.hp = lowest;
      expect(both()).toEqual([true, true]);
      holder.hp = lowest - 1;
      expect(both()).toEqual([false, false]);
      // Oddity (notes): one HP above exactly half already rounds to 50% and does NOT trap, when max HP is large.
      expect(max).toBeGreaterThan(200);
      holder.hp = Math.floor(max / 2) + 1;
      expect(holder.getHpRatio()).toBe(0.5);
      expect(both()).toEqual([false, false]);
      holder.hp = max;

      // Entry turn: the entry part notes the turn, the trap waits until the next turn.
      entry.apply({ pokemon: holder, simulated: false } as never);
      expect(both()).toEqual([false, false]);
      game.scene.currentBattle.turn += 1;
      expect(both()).toEqual([true, true]);

      // The gate (the foe is not a Ghost) is swappable; the engine's own rules stay in the residual.
      const never = buildAttr(module("RingGeneralTrapAbAttr"), {}, { gate: () => false }) as AbAttr;
      expect(never.canApply(params(holder, foe))).toBe(false);
      const always = buildAttr(module("RingGeneralTrapAbAttr"), {}, { gate: () => true }) as AbAttr;
      expect(always.canApply(params(holder, foe))).toBe(true);
      // ...and a swapped gate does not drop the clauses kept in the class: low HP still frees the foe.
      holder.hp = 1;
      expect(always.canApply(params(holder, foe))).toBe(false);
    });

    it("a Ghost foe is never held", async () => {
      const { holder, foe } = await startWorld(phaserGame, { foe: SpeciesId.GASTLY });
      const [, trap] = liveAbility(RING_GENERAL).attrs as [RingGeneralEntryAbAttr, RingGeneralTrapAbAttr];
      const rebuilt = recomposeAttr(module("RingGeneralTrapAbAttr"), trap, RING_GENERAL, 1) as AbAttr;
      holder.hp = holder.getMaxHp();
      expect([trap.canApply(params(holder, foe)), rebuilt.canApply(params(holder, foe))]).toEqual([false, false]);
      // Even with the gate swapped to always true, the engine's own Ghost rule in the residual still frees it.
      const always = buildAttr(module("RingGeneralTrapAbAttr"), {}, { gate: () => true }) as AbAttr;
      expect(always.canApply(params(holder, foe))).toBe(false);
    });
  });
});
