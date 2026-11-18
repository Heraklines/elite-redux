/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { compileCompositionRule } from "#data/elite-redux/ability-studio/vocabulary/evaluate/compile-composition";
import {
  asAttackCondition,
  asDefendCondition,
  asHolderCondition,
  compileCondition,
  compileConditionBlock,
  compileConditionList,
  crossedBelow,
} from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import {
  effectiveDamageAfterMultiHit,
  type Frame,
  frameFromAttrParams,
} from "#data/elite-redux/ability-studio/vocabulary/evaluate/frame";
import { evaluateGuard, guardsPass } from "#data/elite-redux/ability-studio/vocabulary/evaluate/guards";
import { HitResult } from "#enums/hit-result";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { describe, expect, it, vi } from "vitest";

interface FakeMon {
  hp: number;
  getMaxHp: () => number;
  isFullHp: () => boolean;
  status: { effect: StatusEffect } | null;
  getStatStage: (stat: Stat) => number;
  getHeldItems: () => unknown[];
  isPlayer: () => boolean;
  getAlly: () => FakeMon | undefined;
  isOfType: (type: PokemonType) => boolean;
  getMoveType: (move: { type: PokemonType }) => PokemonType;
  getLastXMoves: () => { move: MoveId; result?: MoveResult }[];
  hasAbility: (id: number) => boolean;
  battleData: { lostItems: unknown[]; berriesEaten: unknown[] };
  tempSummonData: { turnCount: number; waveTurnCount: number };
  randBattleSeedInt: (n: number) => number;
  turnData: { hitsLeft: number; hitCount: number; damageTaken: number };
  getTag: () => undefined;
  isGrounded: () => boolean;
  getFormKey: () => string;
}

function mon(over: Partial<FakeMon> = {}): FakeMon {
  const hp = over.hp ?? 100;
  const base: FakeMon = {
    hp,
    getMaxHp: () => 100,
    isFullHp: () => base.hp >= base.getMaxHp(),
    status: null,
    getStatStage: () => 0,
    getHeldItems: () => [],
    isPlayer: () => true,
    getAlly: () => undefined,
    isOfType: () => false,
    getMoveType: move => move.type,
    getLastXMoves: () => [],
    hasAbility: () => false,
    battleData: { lostItems: [], berriesEaten: [] },
    tempSummonData: { turnCount: 1, waveTurnCount: 1 },
    randBattleSeedInt: () => 0,
    turnData: { hitsLeft: -1, hitCount: 0, damageTaken: 0 },
    getTag: () => undefined,
    isGrounded: () => true,
    getFormKey: () => "",
  };
  return Object.assign(base, over);
}

const frame = (holder: FakeMon, extra: Partial<Frame> = {}): Frame => ({
  holder: holder as never,
  simulated: false,
  ...extra,
});
const move = (over: object = {}) =>
  ({
    type: PokemonType.FIRE,
    category: MoveCategory.SPECIAL,
    power: 90,
    priority: 0,
    chance: -1,
    id: MoveId.EMBER,
    ...over,
  }) as never;

describe("compiled conditions (same engine predicates)", () => {
  it("hp.full is isFullHp(), not an HP ratio: 99.6% HP is not full", () => {
    const condition = compileConditionBlock({ block: "hp.full", params: { who: "holder" } });
    const spy = vi.fn(() => true);
    expect(condition(frame(mon({ isFullHp: spy })))).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const nearlyFull = mon({ hp: 996 });
    nearlyFull.getMaxHp = () => 1000;
    nearlyFull.isFullHp = () => nearlyFull.hp >= nearlyFull.getMaxHp();
    expect(condition(frame(nearlyFull))).toBe(false);
  });

  it("hp.at-most / at-least / between use integer math with an explicit rounding", () => {
    const max = (value: number) => {
      const m = mon({ hp: value });
      m.getMaxHp = () => 101;
      return frame(m);
    };
    const atMost = (rounding: string) =>
      compileConditionBlock({ block: "hp.at-most", params: { who: "holder", pct: 50, rounding } });
    expect(atMost("exact")(max(50))).toBe(true);
    expect(atMost("exact")(max(51))).toBe(false);
    const atLeast = (rounding: string) =>
      compileConditionBlock({ block: "hp.at-least", params: { who: "holder", pct: 50, rounding } });
    expect(atLeast("exact")(max(50))).toBe(false);
    expect(atLeast("floor-half")(max(50))).toBe(true);
    const between = compileConditionBlock({
      block: "hp.between",
      params: { who: "holder", minPct: 25, maxPct: 50, rounding: "exact" },
    });
    expect(between(max(30))).toBe(true);
    expect(between(max(60))).toBe(false);
  });

  it("hp.crossed-below needs the effective damage and keeps both roundings separate", () => {
    const holder = mon({ hp: 49 });
    const exact = compileConditionBlock({
      block: "hp.crossed-below",
      params: { who: "holder", ratio: 0.5, rounding: "exact" },
    });
    expect(exact(frame(holder, { damage: 2 }))).toBe(true);
    expect(exact(frame(holder))).toBe(false); // no damage slot: cannot have crossed
    expect(exact(frame(mon({ hp: 50 }), { damage: 1 }))).toBe(false);
    expect(crossedBelow(holder as never, 2, 0.5, "floor-half")).toBe(true);
    const odd = mon({ hp: 50 });
    odd.getMaxHp = () => 101;
    expect(crossedBelow(odd as never, 1, 0.5, "floor-half")).toBe(true);
    expect(crossedBelow(odd as never, 1, 0.5, "exact")).toBe(true);
    const odd2 = mon({ hp: 51 });
    odd2.getMaxHp = () => 101;
    // 51 + 1 >= 50.5 and 51 < 50.5 is false: not crossed under exact; floor-half: 51 <= 50 false.
    expect(crossedBelow(odd2 as never, 1, 0.5, "exact")).toBe(false);
  });

  it("move atoms read the move through the move user, not the holder", () => {
    const user = mon({ getMoveType: () => PokemonType.WATER });
    const f = frame(mon(), { move: move(), moveUser: user as never });
    // effective type (after ability changes) is WATER even though the move says FIRE
    expect(compileConditionBlock({ block: "move.type", params: { type: "WATER", effective: true } })(f)).toBe(true);
    expect(compileConditionBlock({ block: "move.type", params: { type: "WATER", effective: false } })(f)).toBe(false);
    expect(compileConditionBlock({ block: "move.type", params: { type: "FIRE", effective: false } })(f)).toBe(true);
    expect(compileConditionBlock({ block: "move.category", params: { category: "SPECIAL" } })(f)).toBe(true);
    expect(compileConditionBlock({ block: "move.damaging" })(f)).toBe(true);
    expect(compileConditionBlock({ block: "move.power", params: { cmp: "gte", n: 90 } })(f)).toBe(true);
    expect(compileConditionBlock({ block: "move.power", params: { cmp: "gt", n: 90 } })(f)).toBe(false);
    expect(compileConditionBlock({ block: "move.priority", params: { cmp: "eq", n: 0 } })(f)).toBe(true);
    expect(
      compileConditionBlock({ block: "move.has-effect-chance" })(frame(mon(), { move: move({ chance: 30 }) })),
    ).toBe(true);
    expect(compileConditionBlock({ block: "move.has-effect-chance" })(f)).toBe(false);
    expect(compileConditionBlock({ block: "move.is-move", params: { moveId: "EMBER" } })(f)).toBe(true);
    expect(compileConditionBlock({ block: "move.is-move", params: { moveId: "SPLASH" } })(f)).toBe(false);
    // A frame without a move never matches a move atom.
    expect(compileConditionBlock({ block: "move.damaging" })(frame(mon()))).toBe(false);
  });

  it("move.flag asks the move through doesFlagEffectApply with the right user and target", () => {
    const calls: unknown[] = [];
    const flagged = {
      ...(move() as object),
      doesFlagEffectApply: (args: { flag: MoveFlags; user: unknown; target: unknown }) => {
        calls.push(args);
        return args.flag === MoveFlags.MAKES_CONTACT;
      },
    } as never;
    const holder = mon();
    const attacker = mon();
    const condition = compileConditionBlock({ block: "move.flag", params: { flag: "MAKES_CONTACT" } });
    expect(condition(frame(holder, { move: flagged, moveUser: attacker as never, other: attacker as never }))).toBe(
      true,
    );
    expect(calls[0]).toMatchObject({ flag: MoveFlags.MAKES_CONTACT, user: attacker, target: holder });
    expect(
      compileConditionBlock({ block: "move.flag", params: { flag: "SOUND_BASED" } })(
        frame(holder, { move: flagged, moveUser: attacker as never }),
      ),
    ).toBe(false);
  });

  it("status, stage, item, side, time and party atoms", () => {
    const burnt = mon({ status: { effect: StatusEffect.BURN } });
    expect(
      compileConditionBlock({ block: "status.has", params: { who: "holder", status: "BURN" } })(frame(burnt)),
    ).toBe(true);
    expect(compileConditionBlock({ block: "status.has", params: { who: "holder", status: "ANY" } })(frame(burnt))).toBe(
      true,
    );
    expect(
      compileConditionBlock({ block: "status.has", params: { who: "holder", status: "NONE" } })(frame(burnt)),
    ).toBe(false);
    expect(
      compileConditionBlock({ block: "status.has", params: { who: "other", status: "NONE" } })(
        frame(burnt, { other: mon() as never }),
      ),
    ).toBe(true);
    // A missing other never satisfies an "other" atom.
    expect(compileConditionBlock({ block: "status.has", params: { who: "other", status: "NONE" } })(frame(burnt))).toBe(
      false,
    );

    const boosted = mon({ getStatStage: stat => (stat === Stat.ATK ? 2 : 0) });
    expect(
      compileConditionBlock({ block: "stage.compare", params: { who: "holder", stat: "ATK", cmp: "gte", n: 2 } })(
        frame(boosted),
      ),
    ).toBe(true);
    expect(
      compileConditionBlock({ block: "stage.compare", params: { who: "holder", stat: "ANY", cmp: "gt", n: 1 } })(
        frame(boosted),
      ),
    ).toBe(true);
    expect(
      compileConditionBlock({ block: "stage.compare", params: { who: "holder", stat: "DEF", cmp: "gt", n: 1 } })(
        frame(boosted),
      ),
    ).toBe(false);
    const dropped = frame(mon(), { stat: Stat.ATK, stages: -1 });
    expect(compileConditionBlock({ block: "stage.just-changed", params: { direction: "lowered" } })(dropped)).toBe(
      true,
    );
    expect(compileConditionBlock({ block: "stage.just-changed", params: { direction: "raised" } })(dropped)).toBe(
      false,
    );

    expect(compileConditionBlock({ block: "item.none", params: { who: "holder" } })(frame(mon()))).toBe(true);
    expect(
      compileConditionBlock({ block: "item.holds", params: { who: "holder", kind: "any" } })(
        frame(mon({ getHeldItems: () => [{}] })),
      ),
    ).toBe(true);
    expect(
      compileConditionBlock({ block: "item.lost", params: { who: "holder" } })(
        frame(mon({ battleData: { lostItems: [], berriesEaten: [{}] } })),
      ),
    ).toBe(true);

    expect(
      compileConditionBlock({ block: "side.is", params: { kind: "foe" } })(
        frame(mon(), { other: mon({ isPlayer: () => false }) as never }),
      ),
    ).toBe(true);
    expect(compileConditionBlock({ block: "side.is", params: { kind: "self" } })(frame(mon()))).toBe(false);

    expect(compileConditionBlock({ block: "time.first-turn" })(frame(mon()))).toBe(true);
    expect(
      compileConditionBlock({ block: "time.first-turn" })(
        frame(mon({ tempSummonData: { turnCount: 3, waveTurnCount: 3 } })),
      ),
    ).toBe(false);
    expect(
      compileConditionBlock({ block: "time.turn-count", params: { cmp: "gte", n: 3 } })(
        frame(mon({ tempSummonData: { turnCount: 3, waveTurnCount: 3 } })),
      ),
    ).toBe(true);
    expect(
      compileConditionBlock({ block: "time.last-move", params: { who: "holder", moveId: "EMBER" } })(
        frame(mon({ getLastXMoves: () => [{ move: MoveId.EMBER }] })),
      ),
    ).toBe(true);

    expect(compileConditionBlock({ block: "party.ally-exists" })(frame(mon()))).toBe(false);
    expect(compileConditionBlock({ block: "party.ally-exists" })(frame(mon({ getAlly: () => mon() })))).toBe(true);
    expect(
      compileConditionBlock({ block: "mon.has-type", params: { who: "holder", type: "WATER" } })(
        frame(mon({ isOfType: t => t === PokemonType.WATER })),
      ),
    ).toBe(true);
    expect(
      compileConditionBlock({ block: "mon.grounded", params: { who: "holder" } })(
        frame(mon({ isGrounded: () => false })),
      ),
    ).toBe(false);
    expect(
      compileConditionBlock({ block: "mon.in-form", params: { who: "holder", key: "ape" } })(
        frame(mon({ getFormKey: () => "ape" })),
      ),
    ).toBe(true);
  });

  it("reads the ally slot lazily, only when an atom asks for it", () => {
    const ally = mon({ hp: 10 });
    const getAlly = vi.fn(() => ally);
    const holder = mon({ getAlly });
    const built = frameFromAttrParams("event.after-hit", { pokemon: holder, opponent: mon(), damage: 5, hitResult: 0 });
    expect(getAlly).not.toHaveBeenCalled();
    expect(
      compileConditionBlock({ block: "hp.at-most", params: { who: "ally", pct: 50, rounding: "exact" } })(built),
    ).toBe(true);
    expect(getAlly).toHaveBeenCalledTimes(1);
  });

  it("groups: all, any, not; and a rule's IF list is an ordered AND", () => {
    const f = frame(mon({ hp: 40 }));
    const low = { block: "hp.at-most", params: { who: "holder", pct: 50, rounding: "exact" } };
    const full = { block: "hp.full", params: { who: "holder" } };
    expect(compileCondition({ all: [low, { not: full }] })(f)).toBe(true);
    expect(compileCondition({ any: [full, low] })(f)).toBe(true);
    expect(compileCondition({ all: [full, low] })(f)).toBe(false);
    expect(compileCondition({ not: low })(f)).toBe(false);
    expect(compileConditionList([low, { not: full }])(f)).toBe(true);
  });

  it("compiles once: building the closure does the lookups, calling it does not re-interpret", () => {
    const tree = { all: [{ block: "hp.full", params: { who: "holder" } }, { block: "move.damaging" }] };
    const compiled = compileCondition(tree);
    const spy = vi.spyOn(Object, "entries");
    for (let i = 0; i < 50; i++) {
      compiled(frame(mon(), { move: move(), moveUser: mon() as never }));
    }
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("rng.chance rolls at its own position in the IF list and never when simulated or when an earlier IF failed", () => {
    let draws = 0;
    const roller = (roll: number) =>
      mon({
        randBattleSeedInt: () => {
          draws++;
          return roll;
        },
      });
    const chance = { block: "rng.chance", params: { pct: 30 } };
    const full = { block: "hp.full", params: { who: "holder" } };
    const chanceFirst = compileConditionList([chance, full]);
    const fullFirst = compileConditionList([full, chance]);
    const hurt = (roll: number) => {
      const holder = roller(roll);
      holder.hp = 50;
      holder.isFullHp = () => false;
      return frame(holder);
    };
    draws = 0;
    expect(chanceFirst(hurt(0))).toBe(false);
    expect(draws).toBe(1); // original order: the draw happened before the failing HP test
    draws = 0;
    expect(fullFirst(hurt(0))).toBe(false);
    expect(draws).toBe(0); // HP test failed first: no draw
    draws = 0;
    expect(chanceFirst({ ...hurt(99), simulated: true })).toBe(false);
    expect(draws).toBe(0);
  });

  it("time.once-per keeps its memory per battleData, marks only when not simulated, and never leaks between holders", () => {
    const once = compileConditionBlock({ block: "time.once-per", params: { scope: "battle", key: "k" } });
    const a = mon();
    const b = mon();
    expect(once(frame(a, { simulated: true }))).toBe(true);
    expect(once(frame(a, { simulated: true }))).toBe(true); // simulated calls mark nothing
    expect(once(frame(a))).toBe(true);
    expect(once(frame(a))).toBe(false);
    expect(once(frame(b))).toBe(true);
    const nth = compileConditionBlock({ block: "time.nth-use", params: { n: 2, key: "u" } });
    expect(nth(frame(a))).toBe(false);
    expect(nth(frame(a))).toBe(true);
    expect(nth(frame(a))).toBe(false);
  });

  it("time.first-turn is exactly waveTurnCount === 1 (a command switch-in leaves 0)", () => {
    const firstTurn = compileConditionBlock({ block: "time.first-turn" });
    const at = (waveTurnCount: number) => frame(mon({ tempSummonData: { turnCount: 1, waveTurnCount } }));
    expect(firstTurn(at(0))).toBe(false);
    expect(firstTurn(at(1))).toBe(true);
    expect(firstTurn(at(2))).toBe(false);
  });

  describe("once-per / nth-use commit only when the rule applies", () => {
    const rule = (extra: object[], chance = 100) =>
      ({
        key: "berserk-like",
        when: { block: "event.after-hit" },
        if: [...extra, { block: "hp.at-most", params: { who: "holder", pct: 50, rounding: "exact" } }],
        do: [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } }],
        chance,
      }) as never;
    const run = (carrier: ReturnType<typeof compileCompositionRule>, holder: FakeMon): boolean => {
      const params = {
        pokemon: holder,
        opponent: mon(),
        move: move(),
        damage: 10,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      };
      const can = (carrier as unknown as { canApply: (p: object) => boolean }).canApply(params);
      if (can) {
        try {
          (carrier as unknown as { apply: (p: object) => void }).apply(params);
        } catch {
          // The stat effect needs a real battle; the memory commit runs before the effects.
        }
      }
      return can;
    };
    const oncePer = { block: "time.once-per", params: { scope: "battle", key: "k" } };

    it("a failing later IF does not use up once-per", () => {
      const carrier = compileCompositionRule(rule([oncePer]));
      const holder = mon({ hp: 100 });
      expect(run(carrier, holder)).toBe(false); // 100% HP: hp.at-most fails
      holder.hp = 40;
      expect(run(carrier, holder)).toBe(true); // still unused, fires now
      expect(run(carrier, holder)).toBe(false); // used up after applying
    });

    it("a failed chance roll does not use up once-per", () => {
      const carrier = compileCompositionRule(rule([oncePer], 50));
      const holder = mon({ hp: 40, randBattleSeedInt: () => 99 });
      expect(run(carrier, holder)).toBe(false);
      holder.randBattleSeedInt = () => 0;
      expect(run(carrier, holder)).toBe(true);
      expect(run(carrier, holder)).toBe(false);
    });

    it("nth-use counts only applications", () => {
      const carrier = compileCompositionRule(rule([{ block: "time.nth-use", params: { n: 2, key: "u" } }]));
      const holder = mon({ hp: 100 });
      expect(run(carrier, holder)).toBe(false); // fails hp, counts nothing
      holder.hp = 40;
      expect(run(carrier, holder)).toBe(false); // first real use
      expect(run(carrier, holder)).toBe(true); // second real use
    });
  });

  describe("chance and memory atoms inside the IF list (two-pass evaluation)", () => {
    const ruleOf = (ifs: object[], chance = 100) =>
      ({
        key: "pass-test",
        when: { block: "event.after-hit" },
        if: ifs,
        do: [{ block: "effect.stat-stage", params: { target: "holder", stat: "ATK", stages: 1 } }],
        chance,
      }) as never;
    const canApply = (carrier: ReturnType<typeof compileCompositionRule>, holder: FakeMon): boolean =>
      (carrier as unknown as { canApply: (p: object) => boolean }).canApply({
        pokemon: holder,
        opponent: mon(),
        move: move(),
        damage: 10,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      });

    it("rng.chance in the IF list draws exactly once per canApply", () => {
      const draw = vi.fn(() => 0);
      const holder = mon({ hp: 40, randBattleSeedInt: draw });
      const carrier = compileCompositionRule(ruleOf([{ block: "rng.chance", params: { pct: 30 } }]));
      expect(canApply(carrier, holder)).toBe(true);
      expect(draw).toHaveBeenCalledTimes(1);
    });

    it("rng.chance passes with probability p, not p squared", () => {
      const holder = mon({ hp: 40, randBattleSeedInt: () => 25 });
      const carrier = compileCompositionRule(ruleOf([{ block: "rng.chance", params: { pct: 30 } }]));
      expect(canApply(carrier, holder)).toBe(true); // 25 < 30 on the single draw
      holder.randBattleSeedInt = () => 30;
      expect(canApply(carrier, holder)).toBe(false);
    });

    it("rng.chance in the IF list plus a rule chance draws once each, in order", () => {
      const draw = vi.fn(() => 0);
      const holder = mon({ hp: 40, randBattleSeedInt: draw });
      const carrier = compileCompositionRule(ruleOf([{ block: "rng.chance", params: { pct: 30 } }], 50));
      expect(canApply(carrier, holder)).toBe(true);
      expect(draw).toHaveBeenCalledTimes(2);
    });

    it("a not-group around nth-use can fire", () => {
      const carrier = compileCompositionRule(ruleOf([{ not: { block: "time.nth-use", params: { n: 2, key: "u" } } }]));
      const holder = mon({ hp: 40 });
      expect(canApply(carrier, holder)).toBe(true); // first occasion is not the 2nd
      expect(canApply(carrier, holder)).toBe(false); // second occasion is the 2nd
    });

    it("a not-group around once-per answers by the real decision, not the eligibility placeholder", () => {
      const carrier = compileCompositionRule(
        ruleOf([{ not: { block: "time.once-per", params: { scope: "battle", key: "k" } } }]),
      );
      // On a fresh holder once-per would fire, so "not once-per" is correctly false (decision pass).
      expect(canApply(carrier, mon({ hp: 40 }))).toBe(false);
      // Once it was used (a plain once-per rule applied), "not once-per" is true.
      const plain = compileCompositionRule(ruleOf([{ block: "time.once-per", params: { scope: "battle", key: "k" } }]));
      const holder = mon({ hp: 40 });
      const params = {
        pokemon: holder,
        opponent: mon(),
        move: move(),
        damage: 10,
        hitResult: HitResult.EFFECTIVE,
        simulated: false,
      };
      const p = plain as unknown as { canApply: (x: object) => boolean; apply: (x: object) => void };
      expect(p.canApply(params)).toBe(true);
      try {
        p.apply(params);
      } catch {
        // The stat effect needs a real battle; the memory commit runs first.
      }
      expect(canApply(carrier, holder)).toBe(true);
    });

    it("a not-group around rng.chance does not roll in the eligibility pass", () => {
      const draw = vi.fn(() => 99);
      const holder = mon({ hp: 40, randBattleSeedInt: draw });
      const carrier = compileCompositionRule(ruleOf([{ not: { block: "rng.chance", params: { pct: 30 } } }]));
      expect(canApply(carrier, holder)).toBe(true); // roll 99 fails the chance, so not(...) holds
      expect(draw).toHaveBeenCalledTimes(1);
    });

    it("an any-group with a memory atom stays eligible, and its real answer decides", () => {
      const carrier = compileCompositionRule(
        ruleOf([
          {
            any: [
              { block: "time.nth-use", params: { n: 2, key: "u" } },
              { block: "hp.at-most", params: { who: "holder", pct: 50, rounding: "exact" } },
            ],
          },
        ]),
      );
      expect(canApply(carrier, mon({ hp: 40 }))).toBe(true); // hp branch
      expect(canApply(carrier, mon({ hp: 100 }))).toBe(false); // nth is 1st use, hp fails
    });
  });

  it("refuses unknown ids and the hand-added escape hatch in plain language", () => {
    expect(() => compileConditionBlock({ block: "hp.nope" })).toThrow(/there is no condition called/);
    expect(() => compileConditionBlock({ block: "escape.legacy-closure" })).toThrow(/cannot be built from settings/);
    expect(() => compileConditionBlock({ block: "move.type", params: { type: "NOPE" } })).toThrow(/not a known type/);
  });
});

describe("engine signature adapters", () => {
  it("map holder / attack / defend closures onto the frame", () => {
    const full = compileConditionBlock({ block: "hp.full", params: { who: "holder" } });
    expect(asHolderCondition(full)(mon() as never)).toBe(true);
    const power = compileConditionBlock({ block: "move.type", params: { type: "FIRE", effective: true } });
    expect(asAttackCondition(power)(mon() as never, mon() as never, move())).toBe(true);
    expect(
      asDefendCondition(power)(mon() as never, mon({ getMoveType: () => PokemonType.WATER }) as never, move()),
    ).toBe(false);
    const effective = compileConditionBlock({
      block: "hp.at-most",
      params: { who: "other", pct: 50, rounding: "exact" },
    });
    expect(asDefendCondition(effective)(mon() as never, mon({ hp: 10 }) as never, move())).toBe(true);
  });
});

describe("frames and guards", () => {
  it("builds the frame from engine params and applies the multi-hit damage rewrite once, in the frame", () => {
    const holder = mon({ turnData: { hitsLeft: 0, hitCount: 0, damageTaken: 77 } });
    const source = mon({
      getLastXMoves: () => [{ move: MoveId.DOUBLE_HIT }],
      turnData: { hitsLeft: 0, hitCount: 2, damageTaken: 0 },
    });
    expect(effectiveDamageAfterMultiHit(holder as never, source as never, 20)).toBe(77);
    expect(effectiveDamageAfterMultiHit(holder as never, undefined, 20)).toBe(20);
    const single = mon({
      getLastXMoves: () => [{ move: MoveId.TACKLE }],
      turnData: { hitsLeft: 0, hitCount: 1, damageTaken: 0 },
    });
    expect(effectiveDamageAfterMultiHit(holder as never, single as never, 20)).toBe(20);
    const noMove = mon({ turnData: { hitsLeft: 0, hitCount: 2, damageTaken: 0 } });
    expect(effectiveDamageAfterMultiHit(holder as never, noMove as never, 20)).toBe(20);
    const built = frameFromAttrParams("event.after-taking-damage", {
      pokemon: holder,
      damage: 20,
      source,
      simulated: true,
    });
    expect(built.damage).toBe(77);
    expect(built.other).toBe(source);
    expect(built.simulated).toBe(true);
    expect(built.moveUser).toBeUndefined();
  });

  it("evaluates the four PostDamage guards in the original clause order and nesting", () => {
    const f = (
      holderMove: MoveId | undefined,
      sourceMove: { move: MoveId; result?: MoveResult } | undefined,
      hitsLeft = -1,
    ) =>
      frame(mon({ getLastXMoves: () => (holderMove === undefined ? [] : [{ move: holderMove }]) }), {
        other: mon({
          getLastXMoves: () => (sourceMove === undefined ? [] : [sourceMove]),
          turnData: { hitsLeft, hitCount: 0, damageTaken: 0 },
        }) as never,
      });
    expect(evaluateGuard("not-own-hp-cost-move", f(MoveId.BELLY_DRUM, undefined))).toBe(false);
    expect(evaluateGuard("not-own-hp-cost-move", f(MoveId.TACKLE, undefined))).toBe(true);
    expect(evaluateGuard("not-already-forced-out", f(undefined, { move: MoveId.DRAGON_TAIL }))).toBe(false);
    expect(
      evaluateGuard("not-already-forced-out", f(undefined, { move: MoveId.SKY_DROP, result: MoveResult.OTHER })),
    ).toBe(false);
    expect(
      evaluateGuard("not-already-forced-out", f(undefined, { move: MoveId.SKY_DROP, result: MoveResult.SUCCESS })),
    ).toBe(true);
    expect(evaluateGuard("not-already-forced-out", f(undefined, undefined))).toBe(true);
    expect(evaluateGuard("after-final-hit", f(undefined, { move: MoveId.TACKLE }, 2))).toBe(false);
    expect(evaluateGuard("after-final-hit", f(undefined, { move: MoveId.TACKLE }, 0))).toBe(true);
    // The source's checks sit inside "if the source has a last move": without one they all pass.
    expect(evaluateGuard("after-final-hit", f(undefined, undefined, 5))).toBe(true);
    expect(guardsPass(["not-own-hp-cost-move", "after-final-hit"], f(MoveId.CURSE, { move: MoveId.TACKLE }, 3))).toBe(
      false,
    );
    expect(() => evaluateGuard("nope", f(undefined, undefined))).toThrow(/no safety rule called/);
  });

  it("an engine-guard atom runs the registered guard and cannot name an unknown one", () => {
    const guarded = compileConditionBlock({ block: "escape.engine-guard", params: { name: "after-final-hit" } });
    expect(
      guarded(
        frame(mon(), {
          other: mon({
            getLastXMoves: () => [{ move: MoveId.TACKLE }],
            turnData: { hitsLeft: 3, hitCount: 0, damageTaken: 0 },
          }) as never,
        }),
      ),
    ).toBe(false);
    expect(() => compileConditionBlock({ block: "escape.engine-guard", params: { name: "nope" } })).toThrow(
      /not a known safety rule/,
    );
  });
});
