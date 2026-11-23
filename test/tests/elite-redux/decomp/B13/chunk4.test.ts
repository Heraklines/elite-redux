/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 4: Deadeye Draw (5984), Center of Attention (5993), Eclipse Wing turn end (5971), Spirit Punch (5983) and the
// Encore Set reset (5988). The shared L1 and L2 suites cannot make a pulse, arrow or punching move, a marked foe, a counter
// target, an ally pair or a remembered move, so the probes here drive those states through the real helpers and compare each
// original attr with its rebuild. They also prove the old literals are the defaults of the new constructor arguments, that a
// different argument changes the effect, and that a swapped gate does not drop the clauses that stay in the class.
import type { AbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import {
  applyCenterOfAttentionPenalty,
  type CenterOfAttentionAbAttr,
  type CenterSpreadReductionAbAttr,
  clearDeadeyeMarksFor,
  type DeadeyeCritAbAttr,
  type DeadeyeMarkAbAttr,
  type EclipseWingTurnEndAbAttr,
  type EncoreSetAbAttr,
  type EncoreSetResetAbAttr,
  type SpiritPunchAbAttr,
  shouldDeadeyeUseLowerDefense,
  tryEclipseWing,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattlerIndex } from "#enums/battler-index";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { BooleanHolder, NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const ECLIPSE_WING = 5971;
const SPIRIT_PUNCH = 5983;
const DEADEYE_DRAW = 5984;
const ENCORE_SET = 5988;
const CENTER_OF_ATTENTION = 5993;

function module(name: string) {
  const found = declRegistry.get(name);
  expect(found, `${name} must be declared`).toBeDefined();
  return found!;
}

const damaging = { block: "move.damaging", params: {} } as never;
const sameGate = (attr: { gate(p: never): boolean }): never => ((p: never) => attr.gate(p)) as never;
const firstMove = (flag: MoveFlags, not?: MoveFlags) =>
  allMoves.find(
    m =>
      m.id !== MoveId.NONE
      && m.category !== MoveCategory.STATUS
      && m.hasFlag(flag)
      && (not === undefined || !m.hasFlag(not)),
  )!;

describe("B13 chunk 4", () => {
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

  it("the shipped instances carry the old literals, which are the defaults of the new constructor arguments", () => {
    const sp = liveAbility(SPIRIT_PUNCH).attrs[0] as SpiritPunchAbAttr;
    expect([sp.echoPercent, sp.bonusEchoPercent, sp.echoType, sp.bonusType]).toEqual([
      30,
      50,
      PokemonType.GHOST,
      PokemonType.GHOST,
    ]);
    expect(30 / 100).toBe(0.3);
    expect(50 / 100).toBe(0.5);
    const spread = liveAbility(CENTER_OF_ATTENTION).attrs[0] as unknown as { damageMultiplier: number };
    expect(spread.damageMultiplier).toBe(0.75);
    const marker = liveAbility(CENTER_OF_ATTENTION).attrs[1] as CenterOfAttentionAbAttr;
    expect([marker.penaltyStat, marker.penaltyStages]).toEqual([Stat.SPATK, -1]);
  });

  describe("Deadeye Draw", () => {
    // The move lists are filled by the global test setup, so look the moves up when the tests start.
    let pulse: Move;
    let arrow: Move;
    beforeAll(() => {
      pulse = firstMove(MoveFlags.PULSE_MOVE, MoveFlags.ARROW_BASED);
      arrow = firstMove(MoveFlags.ARROW_BASED, MoveFlags.PULSE_MOVE);
    });
    const hit = (holder: Pokemon, foe: Pokemon, move = pulse.id, damage = 10, hitResult = HitResult.EFFECTIVE): never =>
      ({ pokemon: holder, opponent: foe, move: allMoves[move], damage, hitResult, simulated: false }) as never;
    const crit = (holder: Pokemon, foe: Pokemon, move = pulse.id, already = false): never =>
      ({ pokemon: holder, target: foe, move: allMoves[move], isCritical: new BooleanHolder(already) }) as never;

    it("marks the foe I damaged with an arrow or pulse move; original equals rebuild; a swapped gate keeps the guards", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      expect(pulse, "a pulse-only move exists").toBeDefined();
      expect(arrow, "an arrow-only move exists").toBeDefined();
      const original = liveAbility(DEADEYE_DRAW).attrs[0] as DeadeyeMarkAbAttr;
      const rebuilt = buildAttr(
        module("DeadeyeMarkAbAttr"),
        {},
        { "ctor:0": damaging, gate: sameGate(original) },
      ) as AbAttr;
      const both = (...args: Parameters<typeof hit>): [boolean, boolean] => [
        original.canApply(hit(...args)),
        rebuilt.canApply(hit(...args)),
      ];
      expect(both(holder, foe, pulse.id)).toEqual([true, true]);
      expect(both(holder, foe, arrow.id)).toEqual([true, true]);
      expect(both(holder, foe, MoveId.TACKLE)).toEqual([false, false]); // the gate
      expect(both(holder, foe, MoveId.SWORDS_DANCE)).toEqual([false, false]); // clause 1, the base attack condition
      expect(both(holder, foe, pulse.id, 0)).toEqual([false, false]); // clause 2, no damage
      const custom = buildAttr(module("DeadeyeMarkAbAttr"), {}, { "ctor:0": damaging, gate: () => true }) as AbAttr;
      expect(custom.canApply(hit(holder, foe, MoveId.TACKLE))).toBe(true); // the gate is swappable
      expect(custom.canApply(hit(holder, foe, MoveId.TACKLE, 0))).toBe(false); // the guards stay
      expect(custom.canApply(hit(holder, foe, MoveId.SWORDS_DANCE))).toBe(false);
    });

    it("the crit rule needs the mark, a pulse move, a target on the field and no crit yet; the weaker defence follows the same rule", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const mark = liveAbility(DEADEYE_DRAW).attrs[0] as DeadeyeMarkAbAttr;
      const original = liveAbility(DEADEYE_DRAW).attrs[1] as DeadeyeCritAbAttr;
      const rebuilt = buildAttr(module("DeadeyeCritAbAttr"), {}, { gate: sameGate(original) }) as AbAttr;
      const both = (...args: Parameters<typeof crit>): [boolean, boolean] => [
        original.canApply(crit(...args)),
        rebuilt.canApply(crit(...args)),
      ];
      const marker = vi
        .spyOn(holder, "getAllActiveAbilityAttrs")
        .mockReturnValue([liveAbility(DEADEYE_DRAW).attrs[2]] as never);
      expect(both(holder, foe)).toEqual([false, false]); // nothing marked
      mark.apply(hit(holder, foe, arrow.id));
      expect(both(holder, foe)).toEqual([true, true]);
      expect(shouldDeadeyeUseLowerDefense(holder, foe, pulse)).toBe(true);
      expect(both(holder, foe, arrow.id)).toEqual([false, false]); // an arrow move marks but never crits
      expect(shouldDeadeyeUseLowerDefense(holder, foe, arrow)).toBe(false);
      expect(both(holder, foe, MoveId.TACKLE)).toEqual([false, false]);
      expect(both(holder, foe, pulse.id, true)).toEqual([false, false]); // already a crit
      expect(both(holder, holder)).toEqual([false, false]); // not the marked foe
      const swapped = buildAttr(module("DeadeyeCritAbAttr"), {}, { gate: () => true }) as AbAttr;
      expect(swapped.canApply(crit(holder, foe, MoveId.TACKLE))).toBe(true); // the pulse rule is swappable
      clearDeadeyeMarksFor(foe); // either Pokemon leaving the field wipes the mark
      expect(both(holder, foe)).toEqual([false, false]);
      expect(swapped.canApply(crit(holder, foe, MoveId.TACKLE))).toBe(false); // the mark rule stays in the class
      mark.apply(hit(holder, foe));
      const forced = crit(holder, foe);
      original.apply(forced);
      expect((forced as { isCritical: BooleanHolder }).isCritical.value).toBe(true);
      clearDeadeyeMarksFor(holder);
      expect(both(holder, foe)).toEqual([false, false]);
      marker.mockRestore();
    });
  });

  describe("Center of Attention", () => {
    const damage = (holder: Pokemon, foe: Pokemon, move: MoveId): never =>
      ({
        pokemon: holder,
        opponent: foe,
        move: allMoves[move],
        damage: new NumberHolder(100),
        simulated: false,
      }) as never;
    const out = (attr: AbAttr, holder: Pokemon, foe: Pokemon, move: MoveId): number | undefined => {
      const p = damage(holder, foe, move);
      if (!attr.canApply(p)) {
        return;
      }
      attr.apply(p);
      return (p as { damage: NumberHolder }).damage.value;
    };

    it("spread moves deal the multiplier, single-target moves do not; original equals rebuild; the multiplier is a param", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(CENTER_OF_ATTENTION).attrs[0] as CenterSpreadReductionAbAttr;
      const rebuilt = buildAttr(module("CenterSpreadReductionAbAttr"), {}, { gate: sameGate(original) }) as AbAttr;
      for (const move of [MoveId.EARTHQUAKE, MoveId.SURF, MoveId.RAIN_DANCE, MoveId.TACKLE, MoveId.SWORDS_DANCE]) {
        expect(out(rebuilt, holder, foe, move), allMoves[move].name).toBe(out(original, holder, foe, move));
      }
      expect(out(original, holder, foe, MoveId.EARTHQUAKE)).toBe(75);
      expect(out(original, holder, foe, MoveId.TACKLE)).toBeUndefined();
      const half = buildAttr(
        module("CenterSpreadReductionAbAttr"),
        { multiplier: 0.5 },
        { gate: sameGate(original) },
      ) as AbAttr;
      expect(out(half, holder, foe, MoveId.EARTHQUAKE)).toBe(50);
      const swapped = buildAttr(module("CenterSpreadReductionAbAttr"), {}, { gate: () => true }) as AbAttr;
      expect(out(swapped, holder, foe, MoveId.TACKLE)).toBe(75); // the spread rule is swappable
    });

    it("a foe that hits my ally instead of me loses the stat once per move; the stat and stages are params", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const queued = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const protector = (marker: CenterOfAttentionAbAttr) =>
        ({
          getAllActiveAbilityAttrs: () => [marker],
          getNameToRender: () => "Protector",
          getBattlerIndex: () => BattlerIndex.PLAYER_2,
        }) as never;
      const marker = liveAbility(CENTER_OF_ATTENTION).attrs[1] as CenterOfAttentionAbAttr;
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([] as never);
      vi.spyOn(holder, "getAllies").mockReturnValue([protector(marker)]);
      vi.spyOn(foe, "getLastXMoves").mockReturnValue([] as never); // no record: nothing to compare
      applyCenterOfAttentionPenalty(foe, holder, allMoves[MoveId.TACKLE], 0);
      applyCenterOfAttentionPenalty(foe, holder, allMoves[MoveId.SWORDS_DANCE], 10);
      expect(queued).not.toHaveBeenCalled(); // no damage, or a status move
      applyCenterOfAttentionPenalty(foe, holder, allMoves[MoveId.TACKLE], 10);
      expect(queued).toHaveBeenCalledWith("StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.SPATK], -1);
      const custom = buildAttr(
        module("CenterOfAttentionAbAttr"),
        { stat: "Speed", stages: -2 },
        {},
      ) as CenterOfAttentionAbAttr;
      expect([custom.penaltyStat, custom.penaltyStages]).toEqual([Stat.SPD, -2]);
      vi.spyOn(holder, "getAllies").mockReturnValue([protector(custom)]);
      applyCenterOfAttentionPenalty(foe, holder, allMoves[MoveId.TACKLE], 10);
      expect(queued).toHaveBeenLastCalledWith("StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.SPD], -2);
      vi.restoreAllMocks();
    });
  });

  describe("Eclipse Wing turn end", () => {
    const base = (holder: Pokemon): never => ({ pokemon: holder, simulated: false }) as never;

    it("faints me once the foe my counter-strike aimed at has fainted; original equals rebuild; the memory is cleared", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const attrs = liveAbility(ECLIPSE_WING).attrs;
      const original = attrs[1] as EclipseWingTurnEndAbAttr;
      const rebuilt = buildAttr(module("EclipseWingTurnEndAbAttr"), {}, { gate: sameGate(original) }) as AbAttr;
      const both = (): [boolean, boolean] => [original.canApply(base(holder)), rebuilt.canApply(base(holder))];
      vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue(attrs as never);
      expect(both()).toEqual([false, false]); // no counter-strike yet
      holder.hp = holder.getMaxHp();
      expect(tryEclipseWing(holder, foe)).toBe(true); // survive at 1 HP and strike back: remembers the foe
      expect(both()).toEqual([false, false]); // the foe is still standing
      const fainted = vi.spyOn(foe, "isFainted").mockReturnValue(true);
      expect(both()).toEqual([true, true]);
      const holderFainted = vi.spyOn(holder, "isFainted").mockReturnValue(true);
      expect(both()).toEqual([false, false]); // the shared safety rule: not once I have fainted
      holderFainted.mockRestore();
      const damage = vi.spyOn(holder, "damageAndUpdate").mockImplementation(() => 0);
      original.apply({ pokemon: holder, simulated: true } as never); // simulated: no damage, but the memory is spent
      expect(damage).not.toHaveBeenCalled();
      expect(both()).toEqual([false, false]);
      fainted.mockRestore();
      // Not simulated: the one who struck back loses all its remaining HP (the roles are swapped, the foe is the holder now).
      vi.spyOn(foe, "getAllActiveAbilityAttrs").mockReturnValue(attrs as never);
      foe.hp = foe.getMaxHp();
      expect(tryEclipseWing(foe, holder)).toBe(true);
      vi.spyOn(holder, "isFainted").mockReturnValue(true);
      expect([original.canApply(base(foe)), rebuilt.canApply(base(foe))]).toEqual([true, true]);
      const foeDamage = vi.spyOn(foe, "damageAndUpdate").mockImplementation(() => 0);
      rebuilt.apply(base(foe));
      expect(foeDamage).toHaveBeenCalledWith(foe.hp, { result: HitResult.INDIRECT });
      expect(rebuilt.canApply(base(foe))).toBe(false); // the memory was cleared
      vi.restoreAllMocks();
    });
  });

  describe("Spirit Punch", () => {
    let punch: Move;
    beforeAll(() => {
      punch = firstMove(MoveFlags.PUNCHING_MOVE);
    });
    const hit = (
      holder: Pokemon,
      foe: Pokemon,
      move = punch.id,
      damage = 10,
      hitResult = HitResult.EFFECTIVE,
      simulated = false,
    ): never => ({ pokemon: holder, opponent: foe, move: allMoves[move], damage, hitResult, simulated }) as never;

    it("needs a damaging, landed, single-hit punch with a move not echoed yet; original equals rebuild; a swapped gate keeps the rest", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(SPIRIT_PUNCH).attrs[0] as SpiritPunchAbAttr;
      const rebuilt = buildAttr(
        module("SpiritPunchAbAttr"),
        {},
        { "ctor:0": damaging, gate: sameGate(original) },
      ) as AbAttr;
      const both = (...args: Parameters<typeof hit>): [boolean, boolean] => [
        original.canApply(hit(...args)),
        rebuilt.canApply(hit(...args)),
      ];
      expect(both(holder, foe)).toEqual([false, false]); // no move record of mine yet
      holderUses(holder, punch.id);
      expect(both(holder, foe)).toEqual([true, true]);
      expect(both(holder, foe, MoveId.TACKLE)).toEqual([false, false]); // the gate: not a punch
      expect(both(holder, foe, MoveId.SWORDS_DANCE)).toEqual([false, false]); // clause 1, the base attack condition
      expect(both(holder, foe, punch.id, 0)).toEqual([false, false]); // clause 2, no damage
      expect(both(holder, foe, punch.id, 10, HitResult.NO_EFFECT)).toEqual([false, false]); // clause 3, blocked
      holder.turnData.hitCount = 2;
      expect(both(holder, foe)).toEqual([false, false]); // a multi-hit move
      holder.turnData.hitCount = 1;
      const custom = buildAttr(module("SpiritPunchAbAttr"), {}, { "ctor:0": damaging, gate: () => true }) as AbAttr;
      expect(custom.canApply(hit(holder, foe, MoveId.TACKLE))).toBe(true); // the punching rule is swappable
      expect(custom.canApply(hit(holder, foe, MoveId.TACKLE, 0))).toBe(false); // the guards stay
      holder.turnData.hitCount = 3;
      expect(custom.canApply(hit(holder, foe, MoveId.TACKLE))).toBe(false); // so does the residual
    });

    it("echoes the same move at 30% power as a Ghost hit, 50% when I am Ghost; once per move; params change it; simulated spends the record", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const queued = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const original = liveAbility(SPIRIT_PUNCH).attrs[0] as SpiritPunchAbAttr;
      const echo = (call = queued.mock.calls.length - 1) => {
        const move = (
          queued.mock.calls[call]?.[3] as { getMove(): { id: number; power: number; type: number; category: number } }
        ).getMove();
        return { id: move.id, power: move.power, type: move.type, category: move.category };
      };
      holderUses(holder, punch.id);
      original.apply(hit(holder, foe));
      expect(queued).toHaveBeenCalledWith("ErSignatureFollowupPhase", holder, foe, expect.anything());
      expect(echo()).toEqual({
        id: punch.id,
        power: Math.floor(punch.power * 0.3),
        type: PokemonType.GHOST,
        category: punch.category,
      });
      expect(original.canApply(hit(holder, foe))).toBe(false); // this move is spent
      holderUses(holder, punch.id);
      expect(original.canApply(hit(holder, foe))).toBe(true);
      vi.spyOn(holder, "isOfType").mockImplementation(type => type === PokemonType.GHOST);
      original.apply(hit(holder, foe));
      expect(echo().power).toBe(Math.floor(punch.power * 0.5));
      const custom = buildAttr(
        module("SpiritPunchAbAttr"),
        { echoPercent: 60, bonusEchoPercent: 80, echoType: "Fire", bonusType: "Water" },
        { "ctor:0": damaging, gate: sameGate(original) },
      ) as SpiritPunchAbAttr;
      holderUses(holder, punch.id);
      custom.apply(hit(holder, foe));
      expect(echo()).toMatchObject({ power: Math.floor(punch.power * 0.6), type: PokemonType.FIRE }); // holder is not Water
      const before = queued.mock.calls.length;
      holderUses(holder, punch.id);
      original.apply(hit(holder, foe, punch.id, 10, HitResult.EFFECTIVE, true));
      expect(queued.mock.calls.length).toBe(before); // simulated: nothing is queued
      expect(original.canApply(hit(holder, foe))).toBe(false); // but the record is spent (oddity in the notes)
      vi.restoreAllMocks();
    });
  });

  describe("Encore Set reset", () => {
    it("forgets the move played before, so the first move after entering has nothing to echo", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const queued = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(() => undefined as never);
      vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(() => undefined);
      const [reset, replay] = liveAbility(ENCORE_SET).attrs as [EncoreSetResetAbAttr, EncoreSetAbAttr];
      const used = (move: MoveId): void => {
        holderUses(holder, move);
        replay.apply({
          pokemon: holder,
          opponent: foe,
          move: allMoves[move],
          damage: 10,
          hitResult: HitResult.EFFECTIVE,
          simulated: false,
        } as never);
      };
      reset.apply({ pokemon: holder, simulated: false } as never);
      used(MoveId.TACKLE); // remembers Tackle
      used(MoveId.EMBER); // a different move: Tackle is echoed
      expect(queued).toHaveBeenCalledTimes(1);
      reset.apply({ pokemon: holder, simulated: false } as never); // entering again forgets Ember
      used(MoveId.WATER_GUN);
      expect(queued).toHaveBeenCalledTimes(1); // nothing to echo
      used(MoveId.TACKLE); // Water Gun is remembered now
      expect(queued).toHaveBeenCalledTimes(2);
      vi.restoreAllMocks();
    });
  });

  describe("the library bindings equal the old rules", () => {
    it("every bound gate agrees with the original attr for pulse, arrow, punching, sound and plain moves", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const moves = [
        firstMove(MoveFlags.PULSE_MOVE, MoveFlags.ARROW_BASED),
        firstMove(MoveFlags.ARROW_BASED, MoveFlags.PULSE_MOVE),
        firstMove(MoveFlags.PUNCHING_MOVE),
        firstMove(MoveFlags.SOUND_BASED),
        allMoves[MoveId.TACKLE],
        allMoves[MoveId.SWORDS_DANCE],
        allMoves[MoveId.EARTHQUAKE],
      ];
      const hit = (move: Move, damage = 10): never =>
        ({ pokemon: holder, opponent: foe, move, damage, hitResult: HitResult.EFFECTIVE, simulated: false }) as never;
      const crit = (move: Move): never =>
        ({ pokemon: holder, target: foe, move, isCritical: new BooleanHolder(false) }) as never;
      holderUses(holder, MoveId.TACKLE);
      const mark = liveAbility(DEADEYE_DRAW).attrs[0] as DeadeyeMarkAbAttr;
      for (const [name, ability, index, params] of [
        ["DeadeyeMarkAbAttr", DEADEYE_DRAW, 0, hit],
        ["SpiritPunchAbAttr", SPIRIT_PUNCH, 0, hit],
        ["DeadeyeCritAbAttr", DEADEYE_DRAW, 1, crit],
      ] as const) {
        const original = liveAbility(ability).attrs[index];
        const rebuilt = recomposeAttr(module(name), original, ability, index);
        mark.apply(hit(moves[0]));
        for (const move of moves) {
          expect(rebuilt.canApply(params(move) as never), `${name} with ${move.name}`).toBe(
            original.canApply(params(move) as never),
          );
        }
        clearDeadeyeMarksFor(foe);
      }
    });
  });
});
