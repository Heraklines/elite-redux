/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 3 (Push Kick, Sleeping In, Somniloquy, Splash Damage, Split Mind, Starcrossed, Third Eye): what the shared L1 grid and the
// L2 twins cannot see. Every gate of this chunk is a written legacy-closure (an atom is missing, see requests/B17.md), so the shared L1
// skips these attrs ("notRebuilt") and nothing else would prove the Tier B split. Each test therefore compares the class (after its
// gate/residual split) with an independent oracle written from the PRE-split source, over every state the grid cannot reach: hit results,
// hit counters, turn counters, markers, neighbours, accuracy values. Each also builds a fresh attr from the declaration with the typed
// settings and a replaced gate, and shows that the guards stay when the gate is replaced.
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import type { PushKickAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import {
  AstralProjectStarMarkerAbAttr,
  type PostSummonScreensAbAttr,
  type SleepingInAccuracyAbAttr,
  type SomniloquyPostTurnAbAttr,
  type SplashDamageAbAttr,
  type StarHitMultiplierAbAttr,
  type StarHitPowerAbAttr,
  type ThirdEyeAbAttr,
} from "#data/elite-redux/abilities/fakemon-pitch-mechanics";
import { getBinding } from "#data/elite-redux/ability-studio/bindings";
import { buildAttr, readDeclParams } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveTarget } from "#enums/move-target";
import { MoveUseMode } from "#enums/move-use-mode";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import type { Pokemon } from "#field/pokemon";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { setTypesOf } from "#test/tests/elite-redux/decomp/harness/world";
import { NumberHolder, toDmgValue } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const SPLIT_MIND = 6045;
const STARCROSSED = 6017;
const SPLASH_DAMAGE = 6025;
const THIRD_EYE = 6048;
const SLEEPING_IN = 6056;
const SOMNILOQUY = 6058;
const TWO_CHAMBERED = 6086;
const PUSH_KICK = 6088;

function site(abilityId: number, className: string) {
  const found = allAttrSites().find(s => s.abilityId === abilityId && s.className === className);
  if (found === undefined) {
    throw new Error(`${className} is not an attr of ability ${abilityId}`);
  }
  return found;
}

function moduleOf(className: string) {
  const module = declRegistry.get(className);
  expect(module, `${className} has a declaration`).toBeDefined();
  return module!;
}

/** Queues what `unshiftNew` is asked for instead of running it. */
function captureQueue() {
  const queued: unknown[][] = [];
  vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((...args: unknown[]) => {
    queued.push(args);
  }) as never);
  return queued;
}

const alwaysTrue = () => true;
const alwaysFalse = () => false;

describe("B17 chunk 3: the gates are legacy-closures, written down for every user", () => {
  it("every user of the eight classes has a gate binding that is a written legacy-closure (or needs none)", () => {
    const gated: [number, number][] = [
      [PUSH_KICK, 0],
      [SLEEPING_IN, 0],
      [SOMNILOQUY, 0],
      [SPLASH_DAMAGE, 0],
      [TWO_CHAMBERED, 2],
      [STARCROSSED, 0],
      [STARCROSSED, 1],
    ];
    for (const [abilityId, attrIndex] of gated) {
      const binding = getBinding(abilityId, attrIndex, "gate");
      expect(binding?.legacyClosure?.reason.length ?? 0, `ability ${abilityId} attr ${attrIndex}`).toBeGreaterThan(30);
      expect(binding?.spec).toBeUndefined();
    }
    // Split Mind and Third Eye have no gate at all.
    expect(moduleOf("PostSummonScreensAbAttr").decl.conditions).toEqual([]);
    expect(moduleOf("ThirdEyeAbAttr").decl.conditions).toEqual([]);
    for (const className of [
      "PushKickAbAttr",
      "SleepingInAccuracyAbAttr",
      "SomniloquyPostTurnAbAttr",
      "SplashDamageAbAttr",
      "PostSummonScreensAbAttr",
      "StarHitMultiplierAbAttr",
      "StarHitPowerAbAttr",
      "ThirdEyeAbAttr",
    ]) {
      expect(moduleOf(className).decl.status).toBe("decomposed");
    }
  });

  it("the shipped abilities read back the default settings of the declarations", () => {
    expect(readDeclParams(moduleOf("PushKickAbAttr"), site(PUSH_KICK, "PushKickAbAttr").attr)).toEqual({
      flag: "KICKING_MOVE",
      stat: "DEF",
      stages: -1,
    });
    expect(
      readDeclParams(moduleOf("SleepingInAccuracyAbAttr"), site(SLEEPING_IN, "SleepingInAccuracyAbAttr").attr),
    ).toEqual({
      accuracy: 100,
    });
    expect(
      readDeclParams(moduleOf("SomniloquyPostTurnAbAttr"), site(SOMNILOQUY, "SomniloquyPostTurnAbAttr").attr),
    ).toEqual({
      everyTurns: 2,
      moveId: "SLEEP_TALK",
    });
    for (const abilityId of [SPLASH_DAMAGE, TWO_CHAMBERED]) {
      expect(
        readDeclParams(
          moduleOf("SplashDamageAbAttr"),
          allAttrSites().find(s => s.abilityId === abilityId && s.className === "SplashDamageAbAttr")!.attr,
        ),
      ).toEqual({ powerPercent: 50 });
    }
    expect(
      readDeclParams(moduleOf("PostSummonScreensAbAttr"), site(SPLIT_MIND, "PostSummonScreensAbAttr").attr),
    ).toEqual({
      turns: 3,
    });
    expect(
      readDeclParams(moduleOf("StarHitMultiplierAbAttr"), site(STARCROSSED, "StarHitMultiplierAbAttr").attr),
    ).toEqual({
      extraStrikes: 1,
    });
    expect(readDeclParams(moduleOf("StarHitPowerAbAttr"), site(STARCROSSED, "StarHitPowerAbAttr").attr)).toEqual({
      multiplier: 0.7,
    });
  });
});

describe("B17 chunk 3: Push Kick, Sleeping In, Somniloquy, Splash Damage", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Push Kick: old canApply (not used this turn out, damaging, hit landed, first strike, kicking move) over every state, then apply", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const queued = captureQueue();
    const kicks = allMoves.filter(m => m !== undefined && m.hasFlag(MoveFlags.KICKING_MOVE)).slice(0, 3);
    expect(kicks.length, "the game has kicking moves").toBeGreaterThan(0);
    const moves = [...kicks, allMoves[MoveId.TACKLE], allMoves[MoveId.SPLASH], allMoves[MoveId.SWORDS_DANCE]];
    const results = [
      HitResult.EFFECTIVE,
      HitResult.SUPER_EFFECTIVE,
      HitResult.NOT_VERY_EFFECTIVE,
      HitResult.ONE_HIT_KO,
      HitResult.NO_EFFECT,
      HitResult.STATUS,
      HitResult.MISS,
      HitResult.INDIRECT,
    ];
    const strikes: [number, number][] = [
      [1, 1],
      [2, 2],
      [2, 1],
      [3, 1],
    ];
    const attr = new (site(PUSH_KICK, "PushKickAbAttr").attr.constructor as new () => PushKickAbAttr)();
    holder.tempSummonData.waveTurnCount = 3;
    let fires = 0;
    for (const move of moves) {
      for (const hitResult of results) {
        for (const [hitCount, hitsLeft] of strikes) {
          holder.turnData.hitCount = hitCount;
          holder.turnData.hitsLeft = hitsLeft;
          const frame = { pokemon: holder, opponent: foe, move, damage: 7, hitResult, simulated: false };
          // The OLD canApply with a fresh memory: damaging, hit landed (result < NO_EFFECT), first strike, kicking move.
          const expected =
            move.category !== MoveCategory.STATUS
            && hitResult < HitResult.NO_EFFECT
            && hitCount === hitsLeft
            && move.doesFlagEffectApply({ flag: MoveFlags.KICKING_MOVE, user: holder, target: foe });
          fires += expected ? 1 : 0;
          expect(
            attr.canApply(frame as never),
            `${move.name}, result ${HitResult[hitResult]}, strike ${hitCount}/${hitsLeft}`,
          ).toBe(expected);
        }
      }
    }
    expect(fires, "some state fires").toBeGreaterThan(0);

    // apply: preview does nothing and does not use the turn up; a real hit queues -1 Defense on the foe and uses the turn up.
    holder.turnData.hitCount = 1;
    holder.turnData.hitsLeft = 1;
    const kick = kicks[0];
    const frame = (simulated: boolean) => ({
      pokemon: holder,
      opponent: foe,
      move: kick,
      damage: 7,
      hitResult: HitResult.EFFECTIVE,
      simulated,
    });
    expect(attr.canApply(frame(false) as never)).toBe(true);
    attr.apply(frame(true) as never);
    expect(queued, "a preview queues no stat change").toEqual([]);
    // Suspected game bug, recorded not fixed: apply writes the turn marker BEFORE it looks at `simulated`, so a preview already
    // uses the turn up (the base class then returns without a stat change).
    expect(attr.canApply(frame(false) as never)).toBe(false);
    holder.tempSummonData.waveTurnCount = 5;
    expect(attr.canApply(frame(false) as never)).toBe(true);
    attr.apply(frame(false) as never);
    expect(queued).toEqual([["StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.DEF], -1]]);
    // The turn is used up for the same turn counter, and free for any other number (only the last turn number is remembered).
    expect(attr.canApply(frame(false) as never)).toBe(false);
    holder.tempSummonData.waveTurnCount = 4;
    expect(attr.canApply(frame(false) as never)).toBe(true);
    // Suspected game bug, recorded not fixed: the memory is the holder's own turn-out counter, which restarts at 1 on a new
    // switch-in, so the same number blocks again after switching out and back in.
    holder.tempSummonData.waveTurnCount = 5;
    expect(attr.canApply(frame(false) as never)).toBe(false);
  });

  it("Push Kick: the typed settings build a fresh attr, and a replaced gate leaves nothing else behind", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const queued = captureQueue();
    const module = moduleOf("PushKickAbAttr");
    const built = buildAttr(
      module,
      { flag: "BITING_MOVE", stat: "SPD", stages: -2 },
      { gate: alwaysTrue },
    ) as PushKickAbAttr;
    expect(readDeclParams(module, built)).toEqual({ flag: "BITING_MOVE", stat: "SPD", stages: -2 });
    const frame = {
      pokemon: holder,
      opponent: foe,
      move: allMoves[MoveId.SPLASH],
      damage: 0,
      hitResult: HitResult.MISS,
      simulated: false,
    };
    // The replaced gate is the WHOLE condition: a status move that missed still passes it, because Push Kick has no guards.
    expect(built.canApply(frame as never)).toBe(true);
    built.apply(frame as never);
    expect(queued).toEqual([["StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.SPD], -2]]);
    expect((buildAttr(module, {}, { gate: alwaysFalse }) as PushKickAbAttr).canApply(frame as never)).toBe(false);
    // The class still refuses a stage change of 0.
    expect(() => buildAttr(module, { stages: 0 }, { gate: alwaysTrue })).toThrow();
  });

  it("Sleeping In: old canApply (accuracy is not -1, the move can put its target to sleep) and apply, over accuracies and moves", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = site(SLEEPING_IN, "SleepingInAccuracyAbAttr").attr as SleepingInAccuracyAbAttr;
    const sleepy = [
      MoveId.HYPNOSIS,
      MoveId.SPORE,
      MoveId.SLEEP_POWDER,
      MoveId.DARK_VOID,
      MoveId.YAWN,
      MoveId.LOVELY_KISS,
    ];
    const plain = [MoveId.TACKLE, MoveId.SPLASH, MoveId.EMBER, MoveId.SWORDS_DANCE];
    let fires = 0;
    for (const id of [...sleepy, ...plain]) {
      const move = allMoves[id];
      for (const accuracy of [-1, 30, 60, 100, 120]) {
        const holderValue = new NumberHolder(accuracy);
        const frame = { pokemon: holder, simulated: false, move, accuracy: holderValue };
        // The OLD canApply: `accuracy.value !== -1 && isSleepInducingMove(move)`, written out from the move's own attrs.
        const putsToSleep = move.attrs.some(a => {
          const x = a as unknown as { effect?: StatusEffect; tagType?: BattlerTagType };
          return x.effect === StatusEffect.SLEEP || x.tagType === BattlerTagType.DROWSY;
        });
        const expected = accuracy !== -1 && putsToSleep;
        fires += expected ? 1 : 0;
        expect(attr.canApply(frame as never), `${move.name} at accuracy ${accuracy}`).toBe(expected);
        if (expected) {
          attr.apply(frame as never);
          expect(holderValue.value, "apply sets exactly 100").toBe(100);
        }
      }
    }
    expect(fires).toBeGreaterThan(0);
    // Anchors so the oracle is not only a copy: Hypnosis puts to sleep, Tackle does not.
    const gate = (id: MoveId) =>
      attr.canApply({ pokemon: holder, simulated: false, move: allMoves[id], accuracy: new NumberHolder(60) } as never);
    expect(gate(MoveId.HYPNOSIS)).toBe(true);
    expect(gate(MoveId.TACKLE)).toBe(false);
  });

  it("Sleeping In: the accuracy is a typed setting, and the never-miss guard stays when the gate is replaced", async () => {
    const { holder } = await startWorld(phaserGame);
    const module = moduleOf("SleepingInAccuracyAbAttr");
    const built = buildAttr(module, { accuracy: 90 }, { gate: alwaysTrue }) as SleepingInAccuracyAbAttr;
    expect(readDeclParams(module, built)).toEqual({ accuracy: 90 });
    const move = allMoves[MoveId.TACKLE];
    const make = (value: number) => ({ pokemon: holder, simulated: false, move, accuracy: new NumberHolder(value) });
    const normal = make(50);
    expect(built.canApply(normal as never)).toBe(true);
    built.apply(normal as never);
    expect(normal.accuracy.value).toBe(90);
    // A move that never misses (-1) is refused by the guard, whatever the replaced gate says.
    expect(built.canApply(make(-1) as never)).toBe(false);
    expect((buildAttr(module, {}, { gate: alwaysFalse }) as SleepingInAccuracyAbAttr).canApply(make(50) as never)).toBe(
      false,
    );
    // The old class also set 100 for a move that is above 100 (it does not only raise): kept as it was.
    const high = make(120);
    const shipped = site(SLEEPING_IN, "SleepingInAccuracyAbAttr").attr as SleepingInAccuracyAbAttr;
    expect(shipped.canApply({ ...high, move: allMoves[MoveId.HYPNOSIS] } as never)).toBe(true);
  });

  it("Somniloquy: old canApply (alive, out for a turn or more, every 2nd turn, not already done) over turns, faint and marker; then apply", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const queued = captureQueue();
    const attr = site(SOMNILOQUY, "SomniloquyPostTurnAbAttr").attr as SomniloquyPostTurnAbAttr;
    let fires = 0;
    for (const turn of [0, 1, 2, 3, 4, 5, 6, 7, 8]) {
      for (const fainted of [false, true]) {
        for (const marked of [false, true]) {
          holder.tempSummonData.turnCount = turn;
          holder.summonData.erAbilityProvenance = marked ? [`somniloquy:${turn}`] : [`somniloquy:${turn + 100}`];
          vi.spyOn(holder, "isFainted").mockReturnValue(fainted);
          const expected = !fainted && turn > 0 && turn % 2 === 0 && !marked;
          fires += expected ? 1 : 0;
          expect(
            attr.canApply({ pokemon: holder, simulated: false } as never),
            `turn ${turn}, fainted ${fainted}, marked ${marked}`,
          ).toBe(expected);
        }
      }
    }
    expect(fires).toBe(4);
    vi.spyOn(holder, "isFainted").mockReturnValue(false);

    // apply: a preview writes nothing; a real turn writes the marker and queues Sleep Talk at the first standing foe, indirectly.
    holder.tempSummonData.turnCount = 4;
    holder.summonData.erAbilityProvenance = [];
    attr.apply({ pokemon: holder, simulated: true } as never);
    expect(holder.summonData.erAbilityProvenance).toEqual([]);
    expect(queued).toEqual([]);
    attr.apply({ pokemon: holder, simulated: false } as never);
    expect(holder.summonData.erAbilityProvenance).toEqual(["somniloquy:4"]);
    expect(queued).toHaveLength(1);
    const [name, user, targets, move, useMode] = queued[0] as [
      string,
      Pokemon,
      number[],
      { moveId: MoveId },
      MoveUseMode,
    ];
    expect(name).toBe("MovePhase");
    expect(user).toBe(holder);
    expect(targets).toEqual([foe.getBattlerIndex()]);
    expect(move.moveId).toBe(MoveId.SLEEP_TALK);
    expect(useMode).toBe(MoveUseMode.INDIRECT);
    expect(attr.canApply({ pokemon: holder, simulated: false } as never), "the same turn is not done twice").toBe(
      false,
    );
    // With no foe left the marker is still written and nothing is queued.
    holder.tempSummonData.turnCount = 6;
    vi.spyOn(holder, "getOpponents").mockReturnValue([]);
    queued.length = 0;
    attr.apply({ pokemon: holder, simulated: false } as never);
    expect(holder.summonData.erAbilityProvenance).toContain("somniloquy:6");
    expect(queued).toEqual([]);
  });

  it("Somniloquy: the two typed settings build a fresh attr (the move may be typed the way players write it), the guard stays", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const queued = captureQueue();
    const module = moduleOf("SomniloquyPostTurnAbAttr");
    const built = buildAttr(
      module,
      { everyTurns: 3, moveId: "Rest" },
      { gate: alwaysTrue },
    ) as SomniloquyPostTurnAbAttr;
    expect(readDeclParams(module, built)).toEqual({ everyTurns: 3, moveId: "REST" });
    expect(buildAttr(module, { moveId: "Sleep Talk" }, { gate: alwaysTrue }) as SomniloquyPostTurnAbAttr).toBeDefined();
    holder.tempSummonData.turnCount = 3;
    holder.summonData.erAbilityProvenance = [];
    vi.spyOn(holder, "isFainted").mockReturnValue(false);
    expect(built.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
    built.apply({ pokemon: holder, simulated: false } as never);
    expect((queued[0] as [string, Pokemon, number[], { moveId: MoveId }])[3].moveId).toBe(MoveId.REST);
    expect((queued[0] as [string, Pokemon, number[]])[2]).toEqual([foe.getBattlerIndex()]);
    // The gate may be replaced, the "still standing" guard may not.
    vi.spyOn(holder, "isFainted").mockReturnValue(true);
    expect(built.canApply({ pokemon: holder, simulated: false } as never)).toBe(false);
    // Every 3rd turn: the shipped rule (every 2nd) is not the built rule when the gate is the class's own.
    const own = buildAttr(
      module,
      { everyTurns: 3 },
      { gate: (p: { pokemon: Pokemon }) => (built as unknown as { gate: (q: unknown) => boolean }).gate(p) },
    );
    vi.spyOn(holder, "isFainted").mockReturnValue(false);
    holder.summonData.erAbilityProvenance = [];
    for (const [turn, expected] of [
      [1, false],
      [2, false],
      [3, true],
      [4, false],
      [6, true],
    ] as const) {
      holder.tempSummonData.turnCount = turn;
      expect(own.canApply({ pokemon: holder, simulated: false } as never), `turn ${turn}`).toBe(expected);
    }
  });

  it("Splash Damage: old canApply (damaging, damage, single-target list, no marker, standing neighbour) over states; apply and the power floor", async () => {
    const { holder } = await startWorld(phaserGame);
    const queued = captureQueue();
    const attr = site(SPLASH_DAMAGE, "SplashDamageAbAttr").attr as SplashDamageAbAttr;
    const twoChambered = allAttrSites().find(
      s => s.abilityId === TWO_CHAMBERED && s.className === "SplashDamageAbAttr",
    )!.attr as SplashDamageAbAttr;
    const neighbour = { isFainted: () => false, getBattlerIndex: () => 3 } as unknown as Pokemon;
    const fainted = { isFainted: () => true, getBattlerIndex: () => 9 } as unknown as Pokemon;
    const foeWith = (allies: Pokemon[]) =>
      ({ getAdjacentAllies: () => allies, getBattlerIndex: () => 1 }) as unknown as Pokemon;
    const moves = [
      allMoves[MoveId.TACKLE],
      allMoves[MoveId.WATER_GUN],
      allMoves[MoveId.EARTHQUAKE],
      allMoves[MoveId.SURF],
      allMoves[MoveId.RAZOR_LEAF],
      allMoves[MoveId.SWORDS_DANCE],
      allMoves[MoveId.SPLASH],
    ];
    const targets = new Set<MoveTarget>([MoveTarget.NEAR_ENEMY, MoveTarget.OTHER, MoveTarget.NEAR_OTHER]);
    let fires = 0;
    for (const subject of [attr, twoChambered]) {
      for (const move of moves) {
        for (const damage of [0, 1, 25]) {
          for (const marked of [false, true]) {
            for (const [label, allies] of [
              ["no neighbour", []],
              ["a fainted neighbour", [fainted]],
              ["a standing neighbour", [neighbour]],
              ["a fainted then a standing neighbour", [fainted, neighbour]],
            ] as const) {
              holder.turnData.erAbilityProvenance = marked ? ["splash-damage:guard"] : [];
              const frame = {
                pokemon: holder,
                opponent: foeWith([...allies]),
                move,
                damage,
                hitResult: HitResult.EFFECTIVE,
                simulated: false,
              };
              const expected =
                move.category !== MoveCategory.STATUS
                && damage > 0
                && targets.has(move.moveTarget)
                && !marked
                && allies.some(a => !a.isFainted());
              fires += expected ? 1 : 0;
              expect(
                subject.canApply(frame as never),
                `${move.name}, damage ${damage}, marked ${marked}, ${label}`,
              ).toBe(expected);
            }
          }
        }
      }
    }
    expect(fires, "some state fires").toBeGreaterThan(0);

    // apply: preview and "no standing neighbour" leave everything alone; a real one writes the marker and queues the same move.
    const power = (value: number) =>
      ({ id: MoveId.TACKLE, power: value, category: MoveCategory.PHYSICAL, moveTarget: MoveTarget.OTHER }) as never;
    const run = (subject: SplashDamageAbAttr, value: number, allies: Pokemon[], simulated = false) =>
      subject.apply({
        pokemon: holder,
        opponent: foeWith(allies),
        move: power(value),
        damage: 10,
        hitResult: HitResult.EFFECTIVE,
        simulated,
      } as never);
    holder.turnData.erAbilityProvenance = [];
    run(attr, 95, [neighbour], true);
    run(attr, 95, []);
    run(attr, 95, [fainted]);
    expect(queued).toEqual([]);
    expect(holder.turnData.erAbilityProvenance).toEqual([]);
    const seen: [number, number][] = [];
    for (const [value, expectedPower] of [
      [95, 47],
      [40, 20],
      [1, 1],
      [0, 1],
      [-1, 1],
    ] as const) {
      holder.turnData.erAbilityProvenance = [];
      queued.length = 0;
      run(attr, value, [fainted, neighbour]);
      expect(holder.turnData.erAbilityProvenance).toEqual(["splash-damage:guard"]);
      expect(queued).toHaveLength(1);
      const [name, user, targetsList, move, useMode] = queued[0] as [
        string,
        Pokemon,
        number[],
        { moveId: MoveId; getMove: () => { power: number } },
        MoveUseMode,
      ];
      expect(name).toBe("MovePhase");
      expect(user).toBe(holder);
      expect(targetsList).toEqual([3]);
      expect(move.moveId).toBe(MoveId.TACKLE);
      expect(useMode).toBe(MoveUseMode.INDIRECT);
      seen.push([value, move.getMove().power]);
      expect(move.getMove().power, `power ${value}`).toBe(expectedPower);
    }
    expect(seen).toHaveLength(5);
    // The whole-percent setting equals the old literal 0.5 for every power a move can have.
    for (let p = 1; p <= 250; p++) {
      expect(Math.floor(p * (50 / 100))).toBe(Math.floor(p * 0.5));
    }
  });

  it("Splash Damage: the power setting builds a fresh attr, and the damage guard stays when the gate is replaced", async () => {
    const { holder } = await startWorld(phaserGame);
    const queued = captureQueue();
    const module = moduleOf("SplashDamageAbAttr");
    const built = buildAttr(module, { powerPercent: 25 }, { gate: alwaysTrue }) as SplashDamageAbAttr;
    expect(readDeclParams(module, built)).toEqual({ powerPercent: 25 });
    const neighbour = { isFainted: () => false, getBattlerIndex: () => 2 } as unknown as Pokemon;
    const foeWith = { getAdjacentAllies: () => [neighbour], getBattlerIndex: () => 1 } as unknown as Pokemon;
    const move = {
      id: MoveId.TACKLE,
      power: 95,
      category: MoveCategory.PHYSICAL,
      moveTarget: MoveTarget.OTHER,
    } as never;
    holder.turnData.erAbilityProvenance = [];
    expect(
      built.canApply({
        pokemon: holder,
        opponent: foeWith,
        move,
        damage: 0,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      } as never),
    ).toBe(false);
    expect(
      built.canApply({
        pokemon: holder,
        opponent: foeWith,
        move,
        damage: 5,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      } as never),
    ).toBe(true);
    built.apply({
      pokemon: holder,
      opponent: foeWith,
      move,
      damage: 5,
      hitResult: HitResult.EFFECTIVE,
      simulated: false,
    } as never);
    expect((queued[0] as [string, Pokemon, number[], { getMove: () => { power: number } }])[3].getMove().power).toBe(
      23,
    );
  });
});

describe("B17 chunk 3: Split Mind, Starcrossed, Third Eye", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Split Mind: both screens, in order, on the holder's own side for the typed number of turns; nothing for a preview", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const add = vi.spyOn(globalScene.arena, "addTag").mockImplementation((() => true) as never);
    const attr = site(SPLIT_MIND, "PostSummonScreensAbAttr").attr as PostSummonScreensAbAttr;
    attr.apply({ pokemon: holder, simulated: true } as never);
    expect(add).not.toHaveBeenCalled();
    attr.apply({ pokemon: holder, simulated: false } as never);
    expect(add.mock.calls).toEqual([
      [ArenaTagType.REFLECT, 3, MoveId.REFLECT, holder.id, ArenaTagSide.PLAYER],
      [ArenaTagType.LIGHT_SCREEN, 3, MoveId.LIGHT_SCREEN, holder.id, ArenaTagSide.PLAYER],
    ]);
    add.mockClear();
    attr.apply({ pokemon: foe, simulated: false } as never);
    expect(add.mock.calls.map(call => call[4])).toEqual([ArenaTagSide.ENEMY, ArenaTagSide.ENEMY]);
    // The typed number of turns.
    const module = moduleOf("PostSummonScreensAbAttr");
    const built = buildAttr(module, { turns: 5 }) as PostSummonScreensAbAttr;
    expect(readDeclParams(module, built)).toEqual({ turns: 5 });
    add.mockClear();
    built.apply({ pokemon: holder, simulated: false } as never);
    expect(add.mock.calls.map(call => [call[0], call[1]])).toEqual([
      [ArenaTagType.REFLECT, 5],
      [ArenaTagType.LIGHT_SCREEN, 5],
    ]);
    // Always applicable, as the inherited canApply was.
    expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
  });

  it("Starcrossed extra strikes: old canApply (can be hit more than once, Lunar move or Astral Project marker) over moves and marker; apply adds", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const attr = site(STARCROSSED, "StarHitMultiplierAbAttr").attr as StarHitMultiplierAbAttr;
    const lunar = allMoves.filter(m => m !== undefined && m.hasFlag(MoveFlags.LUNAR_MOVE)).slice(0, 3);
    expect(lunar.length, "the game has Lunar moves").toBeGreaterThan(0);
    const moves = [
      ...lunar,
      allMoves[MoveId.TACKLE],
      allMoves[MoveId.WATER_GUN],
      allMoves[MoveId.SWORDS_DANCE],
      allMoves[MoveId.DOUBLE_KICK],
    ];
    let fires = 0;
    let firesWithoutMarker = 0;
    for (const marked of [false, true]) {
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue(marked ? [new AstralProjectStarMarkerAbAttr()] : []);
      for (const move of moves) {
        const frame = { pokemon: holder, opponent: foe, move, hitCount: new NumberHolder(1) };
        // The OLD canApply: the base class's multi-strike test, then `move.hasFlag(LUNAR_MOVE) || the holder has the marker`.
        const expected =
          move.canBeMultiStrikeEnhanced(holder, true, foe) && (move.hasFlag(MoveFlags.LUNAR_MOVE) || marked);
        fires += expected ? 1 : 0;
        firesWithoutMarker += expected && !marked ? 1 : 0;
        expect(attr.canApply(frame as never), `${move.name}, marker ${marked}`).toBe(expected);
        if (expected) {
          attr.apply(frame as never);
          expect(frame.hitCount.value).toBe(2);
        }
      }
    }
    expect(fires).toBeGreaterThan(0);
    expect(firesWithoutMarker, "a Lunar move fires without the marker").toBeGreaterThan(0);
    vi.restoreAllMocks();
  });

  it("Starcrossed damage: old canApply (Lunar move or Astral Project marker) and apply toDmgValue(damage * 0.7); typed settings; the gate is replaceable", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const attr = site(STARCROSSED, "StarHitPowerAbAttr").attr as StarHitPowerAbAttr;
    const lunar = allMoves.filter(m => m !== undefined && m.hasFlag(MoveFlags.LUNAR_MOVE)).slice(0, 3);
    const moves = [...lunar, allMoves[MoveId.TACKLE], allMoves[MoveId.EMBER], allMoves[MoveId.SPLASH]];
    let fires = 0;
    for (const marked of [false, true]) {
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue(marked ? [new AstralProjectStarMarkerAbAttr()] : []);
      for (const move of moves) {
        const frame = { pokemon: holder, opponent: foe, move, damage: new NumberHolder(100) };
        // The base closure is always true here (empty filter, not extra-strikes-only), then the Star test.
        const expected = move.hasFlag(MoveFlags.LUNAR_MOVE) || marked;
        fires += expected ? 1 : 0;
        expect(attr.canApply(frame as never), `${move.name}, marker ${marked}`).toBe(expected);
        if (expected) {
          attr.apply(frame as never);
          expect(frame.damage.value).toBe(toDmgValue(100 * 0.7));
        }
      }
    }
    expect(fires).toBeGreaterThan(0);
    vi.restoreAllMocks();
    const module = moduleOf("StarHitPowerAbAttr");
    const built = buildAttr(module, { multiplier: 0.5 }, { gate: alwaysTrue }) as StarHitPowerAbAttr;
    expect(readDeclParams(module, built)).toEqual({ multiplier: 0.5 });
    const frame = { pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], damage: new NumberHolder(100) };
    expect(built.canApply(frame as never)).toBe(true);
    built.apply(frame as never);
    expect(frame.damage.value).toBe(50);
    expect((buildAttr(module, {}, { gate: alwaysFalse }) as StarHitPowerAbAttr).canApply(frame as never)).toBe(false);
    // The class refuses a multiplier above 1 (it only scales damage down).
    expect(() => buildAttr(module, { multiplier: 2 }, { gate: alwaysTrue })).toThrow();

    const multiplierModule = moduleOf("StarHitMultiplierAbAttr");
    const strikes = buildAttr(multiplierModule, { extraStrikes: 2 }, { gate: alwaysTrue }) as StarHitMultiplierAbAttr;
    expect(readDeclParams(multiplierModule, strikes)).toEqual({ extraStrikes: 2 });
    const hit = { pokemon: holder, opponent: foe, move: allMoves[MoveId.SPLASH], hitCount: new NumberHolder(1) };
    expect(strikes.canApply(hit as never)).toBe(true);
    strikes.apply(hit as never);
    expect(hit.hitCount.value).toBe(3);
  });

  it("Third Eye: only Dark-type foes get the exposure, with Miracle Eye as the source; nothing for a preview", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = site(THIRD_EYE, "ThirdEyeAbAttr").attr as ThirdEyeAbAttr;
    const foeOf = (types: PokemonType[]) => {
      const addTag = vi.fn();
      return {
        mon: { isOfType: (type: PokemonType) => types.includes(type), addTag } as unknown as Pokemon,
        addTag,
      };
    };
    const dark = foeOf([PokemonType.DARK]);
    const darkFlying = foeOf([PokemonType.DARK, PokemonType.FLYING]);
    const normal = foeOf([PokemonType.NORMAL]);
    vi.spyOn(holder, "getOpponents").mockReturnValue([dark.mon, normal.mon, darkFlying.mon]);
    attr.apply({ pokemon: holder, simulated: true } as never);
    expect(dark.addTag).not.toHaveBeenCalled();
    attr.apply({ pokemon: holder, simulated: false } as never);
    expect(dark.addTag).toHaveBeenCalledWith(BattlerTagType.IGNORE_DARK, 0, MoveId.MIRACLE_EYE, holder.id);
    expect(darkFlying.addTag).toHaveBeenCalledWith(BattlerTagType.IGNORE_DARK, 0, MoveId.MIRACLE_EYE, holder.id);
    expect(normal.addTag).not.toHaveBeenCalled();
    // Always applicable, as the inherited canApply was.
    expect(attr.canApply({ pokemon: holder, simulated: false } as never)).toBe(true);
    vi.restoreAllMocks();
  });

  it("Third Eye in a real battle: a real Dark foe is exposed on entry (Psychic moves can hit it)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const attr = site(THIRD_EYE, "ThirdEyeAbAttr").attr as ThirdEyeAbAttr;
    setTypesOf(foe, [PokemonType.DARK]);
    expect(foe.isOfType(PokemonType.DARK)).toBe(true);
    expect(foe.getTag(BattlerTagType.IGNORE_DARK)).toBeUndefined();
    attr.apply({ pokemon: holder, simulated: false } as never);
    expect(foe.getTag(BattlerTagType.IGNORE_DARK)).toBeDefined();
  });
});
