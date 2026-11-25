/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B19 (librarian): every atom, guard and effect added after the batch requests, checked against the formula that was
// lifted from the cited source line. Numeric atoms get boundary tests (hp-math style), the rest get a yes and a no.
import { initGlobalScene } from "#app/global-scene";
import { compileConditionBlock, moveIdOf } from "#data/elite-redux/ability-studio/vocabulary/evaluate/conditions";
import { compileEffect } from "#data/elite-redux/ability-studio/vocabulary/evaluate/effects";
import { type Frame, frameFromAttrParams } from "#data/elite-redux/ability-studio/vocabulary/evaluate/frame";
import { evaluateGuard } from "#data/elite-redux/ability-studio/vocabulary/evaluate/guards";
import {
  hpAtLeast,
  hpAtMost,
  hpCrossedBelowRounded,
  hpRatioRounded,
} from "#data/elite-redux/ability-studio/vocabulary/hp-math";
import { validateComposition } from "#data/elite-redux/ability-studio/vocabulary/validate-composition";
import { TerrainType } from "#data/terrain";
import { BattlerTagType } from "#enums/battler-tag-type";
import { HitResult } from "#enums/hit-result";
import { MoveId } from "#enums/move-id";
import { MoveResult } from "#enums/move-result";
import { MoveTarget } from "#enums/move-target";
import { MoveUseMode } from "#enums/move-use-mode";
import { StatusEffect } from "#enums/status-effect";
import { WeatherType } from "#enums/weather-type";
import { describe, expect, it, vi } from "vitest";

interface FakeMon {
  [key: string]: unknown;
}

function mon(over: FakeMon = {}): FakeMon {
  const base: FakeMon = {
    hp: 100,
    level: 50,
    formIndex: 0,
    id: 1,
    status: null,
    isTerastallized: false,
    getMaxHp: () => 100,
    isFainted: () => false,
    isOnField: () => true,
    isActive: () => true,
    isPlayer: () => true,
    getAlly: () => undefined,
    getOpponents: () => [],
    getTag: () => undefined,
    getLastXMoves: () => [],
    hasAbilityWithAttr: () => false,
    getAbilitySources: () => [],
    battleData: { erAbilityProvenance: [] },
    summonData: { erAbilityProvenance: [] },
    tempSummonData: { turnCount: 0, waveTurnCount: 1 },
    turnData: {
      hitCount: 1,
      hitsLeft: 1,
      switchedInThisTurn: false,
      failedRunAway: false,
      erAbilityProvenance: [],
      attacksReceived: [],
    },
  };
  return Object.assign(base, over);
}

const frame = (holder: FakeMon, extra: Partial<Frame> = {}): Frame => ({
  holder: holder as never,
  simulated: false,
  ...extra,
});

const atom = (block: string, params: Record<string, string | number | boolean> = {}) =>
  compileConditionBlock({ block, params });

describe("HP roundings added for the batch requests (boundary tests)", () => {
  it("rounded-ratio reads getHpRatio(): two decimals, so 334 of 1000 is 0.33 and 335 is 0.34", () => {
    expect(hpRatioRounded(334, 1000)).toBe(0.33);
    expect(hpRatioRounded(335, 1000)).toBe(0.34);
    expect(hpAtMost(334, 1000, 33, "rounded-ratio")).toBe(true);
    expect(hpAtMost(335, 1000, 33, "rounded-ratio")).toBe(false);
    // The exact form disagrees at 334: that is why the roundings are separate.
    expect(hpAtMost(334, 1000, 33, "exact")).toBe(false);
    expect(hpAtLeast(335, 1000, 34, "rounded-ratio")).toBe(true);
    expect(hpAtLeast(334, 1000, 34, "rounded-ratio")).toBe(false);
  });

  it("rounded-ratio agrees with the original expression on every HP of several max HPs", () => {
    for (const max of [1, 2, 3, 7, 25, 100, 101, 333, 700, 999, 1000]) {
      for (let hp = 0; hp <= max; hp++) {
        for (const pct of [25, 33, 50, 75]) {
          const original = Math.round((hp / max) * 100) / 100 <= pct / 100;
          expect(hpAtMost(hp, max, pct, "rounded-ratio"), `${hp}/${max} <= ${pct}%`).toBe(original);
          const originalAbove = Math.round((hp / max) * 100) / 100 >= pct / 100;
          expect(hpAtLeast(hp, max, pct, "rounded-ratio"), `${hp}/${max} >= ${pct}%`).toBe(originalAbove);
        }
      }
    }
  });

  it("rounded-ratio at max HP 700: HP 351 is 50.14% but reads as 0.50, so it counts as at most 50%", () => {
    expect(hpAtMost(351, 700, 50, "rounded-ratio")).toBe(true);
    expect(hpAtMost(351, 700, 50, "exact")).toBe(false);
  });

  it("damage-value is floor-half with a line of at least 1 HP (Anger Shell)", () => {
    // maxHp 100, ratio 0.5: line 50. Crossing means hp <= 50 and hp + damage > 50.
    expect(hpCrossedBelowRounded(50, 100, 1, 0.5, "damage-value", 0)).toBe(true);
    expect(hpCrossedBelowRounded(51, 100, 5, 0.5, "damage-value", 0)).toBe(false);
    expect(hpCrossedBelowRounded(50, 100, 0, 0.5, "damage-value", 0)).toBe(false);
    // maxHp 101: floor(50.5) = 50.
    expect(hpCrossedBelowRounded(50, 101, 1, 0.5, "damage-value", 0)).toBe(true);
    // A 1 HP Pokemon: toDmgValue gives line 1 where floor-half gives line 0, so the two disagree on both sides.
    expect(hpCrossedBelowRounded(1, 1, 1, 0.5, "damage-value", 0)).toBe(true);
    expect(hpCrossedBelowRounded(1, 1, 1, 0.5, "floor-half", 0)).toBe(false);
    expect(hpCrossedBelowRounded(0, 1, 1, 0.5, "damage-value", 0)).toBe(false);
    expect(hpCrossedBelowRounded(0, 1, 1, 0.5, "floor-half", 0)).toBe(true);
    // The Shell Bell term belongs to the exact form only.
    expect(hpCrossedBelowRounded(50, 100, 1, 0.5, "damage-value", 99)).toBe(true);
  });

  it("the HP atoms accept any foe: true when at least one opponent matches", () => {
    const low = mon({ hp: 10 });
    const high = mon({ hp: 100 });
    const holder = mon({ getOpponents: () => [high, low] });
    const atMost = atom("hp.at-most", { who: "any-foe", pct: 50, rounding: "rounded-ratio" });
    expect(atMost(frame(holder))).toBe(true);
    expect(atMost(frame(mon({ getOpponents: () => [high] })))).toBe(false);
    expect(atMost(frame(mon({ getOpponents: () => [] })))).toBe(false);
    // The original closure answered false on any error.
    expect(
      atMost(
        frame(
          mon({
            getOpponents: () => {
              throw new Error("no battle");
            },
          }),
        ),
      ),
    ).toBe(false);
  });

  it("hp.crossed-below runs the damage-value rounding through the atom", () => {
    const shedinja = mon({ hp: 1, getMaxHp: () => 1 });
    const crossed = atom("hp.crossed-below", { who: "holder", ratio: 0.5, rounding: "damage-value" });
    expect(crossed(frame(shedinja, { damage: 1 }))).toBe(true);
    expect(
      atom("hp.crossed-below", { who: "holder", ratio: 0.5, rounding: "floor-half" })(frame(shedinja, { damage: 1 })),
    ).toBe(false);
    expect(crossed(frame(mon({ hp: 40 }), { damage: 15 }))).toBe(true);
  });
});

describe("hit and damage atoms", () => {
  it("hit.dealt-damage is damage > 0 (zero and a missing damage are no)", () => {
    const dealt = atom("hit.dealt-damage");
    const h = mon();
    expect(dealt(frame(h, { damage: 1 }))).toBe(true);
    expect(dealt(frame(h, { damage: 0 }))).toBe(false);
    expect(dealt(frame(h))).toBe(false);
  });

  it("hit.would-knock-out: damage >= hp, and the 1 max HP variant keeps the NaN behaviour of the class", () => {
    const plain = atom("hit.would-knock-out", { who: "holder", ignoreOneHpMax: false });
    const holder = mon({ hp: 30 });
    expect(plain(frame(holder, { damage: 30 }))).toBe(true);
    expect(plain(frame(holder, { damage: 29 }))).toBe(false);
    expect(plain(frame(holder, { damage: Number.NaN }))).toBe(false);
    const aftermath = atom("hit.would-knock-out", { who: "holder", ignoreOneHpMax: true });
    expect(aftermath(frame(holder, { damage: 30 }))).toBe(true);
    expect(aftermath(frame(holder, { damage: 29 }))).toBe(false);
    // `!(maxHp <= 1 || damage < hp)`: a 1 max HP Pokemon never counts, a NaN damage does (as the class writes it).
    expect(aftermath(frame(mon({ hp: 1, getMaxHp: () => 1 }), { damage: 99 }))).toBe(false);
    expect(aftermath(frame(holder, { damage: Number.NaN }))).toBe(true);
    expect(aftermath(frame(holder))).toBe(false);
  });

  it("hit.first-strike is hitCount === hitsLeft of the moving Pokemon", () => {
    const first = atom("hit.first-strike", { who: "holder" });
    expect(first(frame(mon({ turnData: { hitCount: 3, hitsLeft: 3 } })))).toBe(true);
    expect(first(frame(mon({ turnData: { hitCount: 3, hitsLeft: 2 } })))).toBe(false);
    const other = atom("hit.first-strike", { who: "other" });
    expect(other(frame(mon(), { other: mon({ turnData: { hitCount: 2, hitsLeft: 2 } }) as never }))).toBe(true);
    expect(other(frame(mon()))).toBe(false);
  });

  it("hit.critical reads the attacks received of the chosen Pokemon (default: the other one)", () => {
    const crit = { turnData: { attacksReceived: [{ critical: true }] } };
    const plain = { turnData: { attacksReceived: [{ critical: false }] } };
    expect(atom("hit.critical")(frame(mon(), { other: mon(crit) as never }))).toBe(true);
    expect(atom("hit.critical")(frame(mon(crit), { other: mon(plain) as never }))).toBe(false);
    expect(atom("hit.critical", { who: "holder" })(frame(mon(crit), { other: mon(plain) as never }))).toBe(true);
    expect(atom("hit.critical", { who: "holder" })(frame(mon()))).toBe(false);
  });
});

describe("move atoms", () => {
  const moveWith = (over: object = {}) =>
    ({
      id: MoveId.TACKLE,
      moveTarget: MoveTarget.NEAR_OTHER,
      is: (kind: string) => kind === "AttackMove",
      hasAttr: (name: string) => name === "FlinchAttr",
      getAttrs: () => [],
      getPriority: () => 0,
      hitsSubstitute: () => false,
      ...over,
    }) as never;

  it("move.is-attack-move is the AttackMove class test", () => {
    const check = atom("move.is-attack-move");
    expect(check(frame(mon(), { move: moveWith() }))).toBe(true);
    expect(check(frame(mon(), { move: moveWith({ is: () => false }) }))).toBe(false);
    expect(check(frame(mon()))).toBe(false);
  });

  it("move.targets-whole-side is exactly BOTH_SIDES, ENEMY_SIDE and USER_SIDE", () => {
    const check = atom("move.targets-whole-side");
    for (const target of [MoveTarget.BOTH_SIDES, MoveTarget.ENEMY_SIDE, MoveTarget.USER_SIDE]) {
      expect(check(frame(mon(), { move: moveWith({ moveTarget: target }) }))).toBe(true);
    }
    // ALL and PARTY are not in the list (the existing field kind would have included them).
    for (const target of [MoveTarget.ALL, MoveTarget.PARTY, MoveTarget.ALL_ENEMIES, MoveTarget.NEAR_OTHER]) {
      expect(check(frame(mon(), { move: moveWith({ moveTarget: target }) }))).toBe(false);
    }
  });

  it("move.effective-priority asks getPriority of the attacker (move user, else the other Pokemon)", () => {
    const check = atom("move.effective-priority", { cmp: "gt", n: 0 });
    const user = mon();
    const prankster = moveWith({ getPriority: (who: unknown) => (who === user ? 1 : 0) });
    expect(check(frame(mon(), { move: prankster, moveUser: user as never }))).toBe(true);
    expect(check(frame(mon(), { move: prankster, moveUser: mon() as never }))).toBe(false);
    // calc.move-immunity (Queenly Majesty, Dazzling) names no move user: the attacker is the other Pokemon.
    expect(check(frame(mon(), { move: prankster, other: user as never }))).toBe(true);
    expect(check(frame(mon(), { move: prankster }))).toBe(false);
  });

  it("move.effective-priority cannot be put on calc.priority (getPriority would run the rule again)", () => {
    const rule = (when: string) => ({
      key: "priority-probe",
      when: { block: when },
      if: [{ block: "move.effective-priority", params: { cmp: "gt", n: 0 } }],
      do: [{ block: when === "calc.priority" ? "effect.change-priority" : "effect.immune-to-type", params: {} }],
      chance: 100,
    });
    expect(validateComposition([rule("calc.priority")])).toEqual([
      'composition[0].if[0]: "move.effective-priority" needs the other pokemon, but the trigger "While the game calculates my move\'s priority" does not provide it',
    ]);
    expect(validateComposition([rule("calc.move-immunity")])).toEqual([]);
  });

  it("move.has-flinch-effect and move.hits-substitute call the move's own methods", () => {
    expect(atom("move.has-flinch-effect")(frame(mon(), { move: moveWith() }))).toBe(true);
    expect(atom("move.has-flinch-effect")(frame(mon(), { move: moveWith({ hasAttr: () => false }) }))).toBe(false);
    const attacker = mon();
    const defender = mon();
    const hits = vi.fn(() => true);
    const move = moveWith({ hitsSubstitute: hits });
    expect(
      atom("move.hits-substitute")(frame(attacker, { move, moveUser: attacker as never, other: defender as never })),
    ).toBe(true);
    expect(hits).toHaveBeenCalledWith(attacker, defender);
    // Defending frame: the move user is the other Pokemon, the defender is the holder.
    expect(
      atom("move.hits-substitute")(frame(defender, { move, moveUser: attacker as never, other: attacker as never })),
    ).toBe(true);
    expect(hits).toHaveBeenLastCalledWith(attacker, defender);
  });

  it("move.type-chart-effectiveness compares the chart only, with the defender and the move type", () => {
    const attacker = mon({ getMoveType: () => 10 });
    const seen: unknown[] = [];
    const defender = mon({
      getAttackTypeEffectiveness: (type: number, options: unknown) => {
        seen.push([type, options]);
        return 2;
      },
    });
    const move = moveWith();
    const superEffective = atom("move.type-chart-effectiveness", { cmp: "gt", n: 1 });
    expect(superEffective(frame(attacker, { move, moveUser: attacker as never, other: defender as never }))).toBe(true);
    expect(seen[0]).toEqual([10, { source: attacker, move }]);
    expect(
      atom("move.type-chart-effectiveness", { cmp: "lt", n: 1 })(
        frame(attacker, { move, moveUser: attacker as never, other: defender as never }),
      ),
    ).toBe(false);
  });

  it("move.inflicts-status checks the move's status parts, and frostbite counts for FREEZE only", () => {
    const burnMove = moveWith({
      getAttrs: (name: string) => (name === "StatusEffectAttr" ? [{ effect: StatusEffect.BURN }] : []),
    });
    const frostMove = moveWith({
      getAttrs: (name: string) => (name === "AddBattlerTagAttr" ? [{ tagType: BattlerTagType.ER_FROSTBITE }] : []),
    });
    expect(atom("move.inflicts-status", { status: "BURN" })(frame(mon(), { move: burnMove }))).toBe(true);
    expect(atom("move.inflicts-status", { status: "PARALYSIS" })(frame(mon(), { move: burnMove }))).toBe(false);
    expect(atom("move.inflicts-status", { status: "FREEZE" })(frame(mon(), { move: frostMove }))).toBe(true);
    expect(atom("move.inflicts-status", { status: "BURN" })(frame(mon(), { move: frostMove }))).toBe(false);
  });

  it("move.ability-can-change-type uses the engine's own set of fixed-type moves", () => {
    const check = atom("move.ability-can-change-type");
    expect(check(frame(mon(), { move: moveWith({ id: MoveId.TACKLE }) }))).toBe(true);
    expect(check(frame(mon(), { move: moveWith({ id: MoveId.WEATHER_BALL }) }))).toBe(false);
    expect(check(frame(mon(), { move: moveWith({ id: MoveId.JUDGMENT }) }))).toBe(false);
    expect(check(frame(mon(), { move: moveWith({ id: MoveId.HIDDEN_POWER }) }))).toBe(false);
  });

  it("move.type-multiplier reads the running multiplier of the frame, and the frame builder fills it", () => {
    const check = atom("move.type-multiplier", { cmp: "lt", n: 2 });
    expect(check(frame(mon(), { typeMultiplier: 1 }))).toBe(true);
    expect(check(frame(mon(), { typeMultiplier: 2 }))).toBe(false);
    expect(check(frame(mon()))).toBe(false);
    const built = frameFromAttrParams("calc.move-immunity", {
      pokemon: mon(),
      attacker: mon(),
      typeMultiplier: { value: 4 },
    });
    expect(built.typeMultiplier).toBe(4);
  });

  it("move.is-move accepts Elite Redux custom moves as well as vanilla ones", () => {
    expect(moveIdOf("TACKLE")).toBe(MoveId.TACKLE);
    expect(moveIdOf("FIVE_STAR_FURY")).toBe(5156);
    expect(() => moveIdOf("NOT_A_MOVE")).toThrow("not a known move");
    expect(() => moveIdOf("toString")).toThrow("not a known move");
    expect(() => moveIdOf("33")).toThrow("not a known move");
    expect(moveIdOf("Five star fury")).toBe(5156);
    const fury = atom("move.is-move", { moveId: "FIVE_STAR_FURY" });
    expect(fury(frame(mon(), { move: moveWith({ id: 5156 }) }))).toBe(true);
    expect(fury(frame(mon(), { move: moveWith({ id: MoveId.TACKLE }) }))).toBe(false);
  });

  it("mon.is-first-ally is holder.getAlly() === other", () => {
    const partner = mon();
    const holder = mon({ getAlly: () => partner });
    expect(atom("mon.is-first-ally")(frame(holder, { other: partner as never }))).toBe(true);
    expect(atom("mon.is-first-ally")(frame(holder, { other: mon() as never }))).toBe(false);
    expect(atom("mon.is-first-ally")(frame(holder))).toBe(false);
  });
});

describe("field atoms", () => {
  function scene(options: { weather?: object | undefined; terrain?: object | undefined; battlers?: number }) {
    const arena = {
      weather: options.weather,
      terrain: options.terrain,
      weatherType: options.weather === undefined ? 0 : (options.weather as { weatherType: number }).weatherType,
    };
    initGlobalScene({
      arena,
      getField: () => [],
      currentBattle: { getBattlerCount: () => options.battlers ?? 1 },
    } as never);
  }
  const weather = (weatherType: WeatherType, extra: object = {}) => ({
    weatherType,
    isEffectSuppressed: () => false,
    isImmutable: () => false,
    ...extra,
  });

  it("field.weather-in-effect: in the list, not suppressed", () => {
    const check = atom("field.weather-in-effect", { weathers: "RAIN,HEAVY_RAIN", reapAndSow: false });
    scene({ weather: weather(WeatherType.RAIN) });
    expect(check(frame(mon()))).toBe(true);
    scene({ weather: weather(WeatherType.HEAVY_RAIN) });
    expect(check(frame(mon()))).toBe(true);
    scene({ weather: weather(WeatherType.SUNNY) });
    expect(check(frame(mon()))).toBe(false);
    scene({ weather: weather(WeatherType.RAIN, { isEffectSuppressed: () => true }) });
    expect(check(frame(mon()))).toBe(false);
    scene({});
    expect(check(frame(mon()))).toBe(false);
    expect(() => atom("field.weather-in-effect", { weathers: "RAINY", reapAndSow: false })).toThrow(
      "not a known weather",
    );
  });

  it("field.weather-in-effect with Reap and Sow is the game's own weather condition", () => {
    const check = atom("field.weather-in-effect", { weathers: "SUNNY,HARSH_SUN", reapAndSow: true });
    scene({ weather: weather(WeatherType.SUNNY) });
    expect(check(frame(mon()))).toBe(true);
    scene({ weather: weather(WeatherType.RAIN) });
    expect(check(frame(mon()))).toBe(false);
    scene({ weather: weather(WeatherType.SUNNY, { isEffectSuppressed: () => true }) });
    expect(check(frame(mon()))).toBe(false);
  });

  it("field.weather-lasting and field.weather-fog", () => {
    const lasting = atom("field.weather-lasting");
    scene({ weather: weather(WeatherType.HEAVY_RAIN, { isImmutable: () => true }) });
    expect(lasting(frame(mon()))).toBe(true);
    scene({ weather: weather(WeatherType.RAIN) });
    expect(lasting(frame(mon()))).toBe(false);
    scene({});
    expect(lasting(frame(mon()))).toBe(false);
    const fog = atom("field.weather-fog");
    scene({ weather: weather(WeatherType.FOG) });
    expect(fog(frame(mon()))).toBe(true);
    scene({ weather: weather(WeatherType.EERIE_FOG) });
    expect(fog(frame(mon()))).toBe(true);
    scene({ weather: weather(WeatherType.RAIN) });
    expect(fog(frame(mon()))).toBe(false);
  });

  it("field.terrain-unhidden reads the raw terrain object; field.terrain-just-set reads the terrain of the trigger", () => {
    const unhidden = atom("field.terrain-unhidden", { terrains: "GRASSY" });
    scene({ terrain: { terrainType: TerrainType.GRASSY } });
    expect(unhidden(frame(mon()))).toBe(true);
    scene({ terrain: { terrainType: TerrainType.MISTY } });
    expect(unhidden(frame(mon()))).toBe(false);
    scene({});
    expect(unhidden(frame(mon()))).toBe(false);
    const justSet = atom("field.terrain-just-set", { terrains: "ELECTRIC,GRASSY" });
    expect(justSet(frame(mon(), { terrain: TerrainType.ELECTRIC }))).toBe(true);
    expect(justSet(frame(mon(), { terrain: TerrainType.MISTY }))).toBe(false);
    expect(justSet(frame(mon()))).toBe(false);
    // The class used `!!list.find(...)`: a listed NONE (0) is found but falsy, so it never counts.
    expect(atom("field.terrain-just-set", { terrains: "NONE" })(frame(mon(), { terrain: TerrainType.NONE }))).toBe(
      false,
    );
  });

  it("party.multi-battle counts battlers per side (a triple battle is not 'doubles')", () => {
    const check = atom("party.multi-battle");
    scene({ battlers: 1 });
    expect(check(frame(mon()))).toBe(false);
    scene({ battlers: 2 });
    expect(check(frame(mon()))).toBe(true);
    scene({ battlers: 3 });
    expect(check(frame(mon()))).toBe(true);
  });
});

describe("status, tag, pokemon and party atoms", () => {
  it("status.has-any: an empty list means any status problem", () => {
    const any = atom("status.has-any", { who: "holder", statuses: "" });
    const burned = mon({ status: { effect: StatusEffect.BURN } });
    expect(any(frame(burned))).toBe(true);
    expect(any(frame(mon()))).toBe(false);
    const listed = atom("status.has-any", { who: "holder", statuses: "POISON, TOXIC" });
    expect(listed(frame(burned))).toBe(false);
    expect(listed(frame(mon({ status: { effect: StatusEffect.TOXIC } })))).toBe(true);
  });

  it("tag.has-any: at least one listed battle effect", () => {
    const check = atom("tag.has-any", { who: "holder", tags: "CONFUSED,INFATUATED" });
    const confused = mon({ getTag: (tag: unknown) => (tag === BattlerTagType.CONFUSED ? {} : undefined) });
    expect(check(frame(confused))).toBe(true);
    expect(check(frame(mon()))).toBe(false);
  });

  it("status.just-set reads the status the trigger passed, not the current one", () => {
    const check = atom("status.just-set", { statuses: "BURN,PARALYSIS,POISON,TOXIC" });
    expect(check(frame(mon(), { status: StatusEffect.BURN }))).toBe(true);
    expect(check(frame(mon(), { status: StatusEffect.SLEEP }))).toBe(false);
    expect(check(frame(mon({ status: { effect: StatusEffect.BURN } })))).toBe(false);
  });

  it("mon.level, mon.form-number compare with every operator at the boundary", () => {
    const level = (cmp: string, n: number) => atom("mon.level", { who: "holder", cmp, n });
    const holder = mon({ level: 20 });
    expect(level("lt", 20)(frame(holder))).toBe(false);
    expect(level("lte", 20)(frame(holder))).toBe(true);
    expect(level("eq", 20)(frame(holder))).toBe(true);
    expect(level("gte", 21)(frame(holder))).toBe(false);
    expect(level("gt", 19)(frame(holder))).toBe(true);
    const form = (cmp: string, n: number) => atom("mon.form-number", { who: "holder", cmp, n });
    expect(form("gte", 7)(frame(mon({ formIndex: 7 })))).toBe(true);
    expect(form("gte", 7)(frame(mon({ formIndex: 6 })))).toBe(false);
    expect(form("eq", 0)(frame(mon()))).toBe(true);
  });

  it("mon.fainted and mon.terastallized", () => {
    expect(
      atom("mon.fainted", { who: "other" })(frame(mon(), { other: mon({ isFainted: () => true }) as never })),
    ).toBe(true);
    expect(atom("mon.fainted", { who: "other" })(frame(mon()))).toBe(false);
    expect(atom("mon.terastallized", { who: "holder" })(frame(mon({ isTerastallized: true })))).toBe(true);
    expect(atom("mon.terastallized", { who: "holder" })(frame(mon()))).toBe(false);
  });

  it("party.ally-active needs an ally that can fight, party.bench-count counts healthy members off the field", () => {
    const active = mon({ isActive: () => true });
    const down = mon({ isActive: () => false });
    expect(atom("party.ally-active")(frame(mon({ getAlly: () => active })))).toBe(true);
    expect(atom("party.ally-active")(frame(mon({ getAlly: () => down })))).toBe(false);
    expect(atom("party.ally-active")(frame(mon()))).toBe(false);
    const bench = (n: number, cmp = "gte") => atom("party.bench-count", { cmp, n });
    initGlobalScene({
      getPlayerParty: () => [
        mon(),
        mon({ isOnField: () => false }),
        mon({ isOnField: () => false, isFainted: () => true }),
        mon({ isOnField: () => false }),
      ],
      getEnemyParty: () => [],
    } as never);
    expect(bench(2)(frame(mon()))).toBe(true);
    expect(bench(3)(frame(mon()))).toBe(false);
    expect(bench(2, "eq")(frame(mon()))).toBe(true);
  });
});

describe("time, memory and chance atoms", () => {
  it("time.turn-count-multiple: every Nth turn out, never turn 0", () => {
    const every2 = atom("time.turn-count-multiple", { n: 2 });
    const at = (turnCount: number) => frame(mon({ tempSummonData: { turnCount } }));
    expect(every2(at(0))).toBe(false);
    expect(every2(at(1))).toBe(false);
    expect(every2(at(2))).toBe(true);
    expect(every2(at(3))).toBe(false);
    expect(every2(at(4))).toBe(true);
    expect(atom("time.turn-count-multiple", { n: 1 })(at(1))).toBe(true);
  });

  it("time.switched-in-this-turn and time.failed-run-away read the turn data flags", () => {
    expect(
      atom("time.switched-in-this-turn", { who: "holder" })(frame(mon({ turnData: { switchedInThisTurn: true } }))),
    ).toBe(true);
    expect(atom("time.switched-in-this-turn", { who: "holder" })(frame(mon()))).toBe(false);
    expect(atom("time.failed-run-away", { who: "holder" })(frame(mon({ turnData: { failedRunAway: true } })))).toBe(
      true,
    );
    expect(atom("time.failed-run-away", { who: "holder" })(frame(mon()))).toBe(false);
  });

  it("time.last-move-result and time.last-move-was-follow-up read the last move record", () => {
    const last = (record: object) => frame(mon({ getLastXMoves: () => [record] }));
    const worked = atom("time.last-move-result", { who: "holder", result: "SUCCESS", negate: false });
    expect(worked(last({ result: MoveResult.SUCCESS }))).toBe(true);
    expect(worked(last({ result: MoveResult.FAIL }))).toBe(false);
    const notWorked = atom("time.last-move-result", { who: "holder", result: "SUCCESS", negate: true });
    expect(notWorked(last({ result: MoveResult.FAIL }))).toBe(true);
    expect(notWorked(last({ result: MoveResult.SUCCESS }))).toBe(false);
    const followUp = atom("time.last-move-was-follow-up", { who: "holder" });
    expect(followUp(last({ useMode: MoveUseMode.INDIRECT }))).toBe(true);
    expect(followUp(last({ useMode: MoveUseMode.NORMAL }))).toBe(false);
    expect(followUp(frame(mon()))).toBe(false);
  });

  it("time.marker-set reads the marker memory of the chosen scope without writing", () => {
    const data = { erAbilityProvenance: ["oracle:guard:3"] };
    const holder = mon({
      battleData: data,
      summonData: { erAbilityProvenance: [] },
      turnData: { erAbilityProvenance: ["x"] },
    });
    const exact = (scope: string, key: string, match = "exact") =>
      atom("time.marker-set", { who: "holder", scope, key, match })(frame(holder));
    expect(exact("battle", "oracle:guard:3")).toBe(true);
    expect(exact("battle", "oracle:guard:")).toBe(false);
    expect(exact("battle", "oracle:guard:", "prefix")).toBe(true);
    expect(exact("switch-in", "oracle:guard:3")).toBe(false);
    expect(exact("turn", "x")).toBe(true);
    expect(data.erAbilityProvenance).toEqual(["oracle:guard:3"]);
  });

  it("rng.chance alwaysRoll draws even at 100 percent; rng.chance-float always draws one float", () => {
    const draws = vi.fn(() => 0);
    const holder = mon({ randBattleSeedInt: draws });
    expect(atom("rng.chance", { pct: 100, alwaysRoll: false })(frame(holder))).toBe(true);
    expect(draws).not.toHaveBeenCalled();
    expect(atom("rng.chance", { pct: 100, alwaysRoll: true })(frame(holder))).toBe(true);
    expect(draws).toHaveBeenCalledTimes(1);
    // A simulated call never draws.
    expect(atom("rng.chance", { pct: 50, alwaysRoll: true })({ ...frame(holder), simulated: true })).toBe(true);
    expect(draws).toHaveBeenCalledTimes(1);
    // The roll boundary: draw 49 passes a 50 percent chance, 50 does not.
    expect(atom("rng.chance", { pct: 50, alwaysRoll: false })(frame(mon({ randBattleSeedInt: () => 49 })))).toBe(true);
    expect(atom("rng.chance", { pct: 50, alwaysRoll: false })(frame(mon({ randBattleSeedInt: () => 50 })))).toBe(false);

    // The draw is `Phaser.Math.RND.frac()`; the seeded generator does not exist in a unit test, so give it a stand-in.
    const math = Phaser.Math as unknown as { RND: unknown };
    const originalRnd = math.RND;
    const float = vi.fn(() => 0.5);
    math.RND = { frac: float };
    expect(atom("rng.chance-float", { pct: 50 })(frame(mon()))).toBe(true); // pct / 100 >= draw
    float.mockReturnValue(0.5000001);
    expect(atom("rng.chance-float", { pct: 50 })(frame(mon()))).toBe(false);
    float.mockReturnValue(0.99);
    expect(atom("rng.chance-float", { pct: 100 })(frame(mon()))).toBe(true);
    expect(float).toHaveBeenCalledTimes(3); // one draw per call, even at 100
    math.RND = originalRnd;
  });
});

describe("safety rules added by the librarian", () => {
  const guard = (id: string, f: Frame) => evaluateGuard(id, f);

  it("target and status guards", () => {
    const holder = mon();
    const other = mon({ hasAbilityWithAttr: (name: string) => name === "IgnoreMoveEffectsAbAttr" });
    expect(guard("not-blocked-by-effect-shield", frame(holder, { other: other as never }))).toBe(false);
    expect(guard("not-blocked-by-effect-shield", frame(holder, { other: mon() as never }))).toBe(true);
    expect(guard("not-self-target", frame(holder, { other: holder as never }))).toBe(false);
    expect(guard("not-self-target", frame(holder, { other: other as never }))).toBe(true);
    expect(guard("status-set-by-a-pokemon", frame(holder))).toBe(false);
    expect(guard("status-set-by-a-pokemon", frame(holder, { other: other as never }))).toBe(true);
  });

  it("hit guards", () => {
    const holder = mon();
    const foe = mon();
    for (const [result, connects] of [
      [HitResult.EFFECTIVE, true],
      [HitResult.SUPER_EFFECTIVE, true],
      [HitResult.NOT_VERY_EFFECTIVE, true],
      [HitResult.ONE_HIT_KO, true],
      [HitResult.NO_EFFECT, false],
      [HitResult.MISS, false],
    ] as const) {
      expect(guard("hit-connected", frame(holder, { hitResult: result })), String(result)).toBe(connects);
      expect(guard("hit-connected-on-another-pokemon", frame(holder, { other: foe as never, hitResult: result }))).toBe(
        connects,
      );
    }
    expect(guard("hit-connected", frame(holder))).toBe(false);
    expect(
      guard(
        "hit-connected-on-another-pokemon",
        frame(holder, { other: holder as never, hitResult: HitResult.EFFECTIVE }),
      ),
    ).toBe(false);
    expect(guard("hit-dealt-damage", frame(holder, { damage: 1 }))).toBe(true);
    expect(guard("hit-dealt-damage", frame(holder, { damage: 0 }))).toBe(false);
    expect(guard("hit-on-another-living-target", frame(holder, { other: foe as never, damage: 5 }))).toBe(true);
    expect(
      guard(
        "hit-on-another-living-target",
        frame(holder, { other: mon({ isFainted: () => true }) as never, damage: 5 }),
      ),
    ).toBe(false);
    expect(guard("hit-on-another-living-target", frame(holder, { other: holder as never, damage: 5 }))).toBe(false);
    expect(guard("hit-on-another-living-target", frame(holder, { other: foe as never, damage: 0 }))).toBe(false);
  });

  it("after-my-final-hit reads the holder's own counter", () => {
    expect(guard("after-my-final-hit", frame(mon({ turnData: { hitsLeft: 2 } })))).toBe(false);
    expect(guard("after-my-final-hit", frame(mon({ turnData: { hitsLeft: 1 } })))).toBe(true);
    expect(guard("after-my-final-hit", frame(mon({ turnData: { hitsLeft: 0 } })))).toBe(true);
  });

  it("knock-out reaction guards", () => {
    const holder = mon();
    const attacker = mon();
    const move = {} as never;
    expect(guard("knocked-out-by-a-move", frame(holder, { other: attacker as never, move }))).toBe(true);
    expect(guard("knocked-out-by-a-move", frame(holder, { other: attacker as never }))).toBe(false);
    expect(guard("knocked-out-by-a-move", frame(holder, { move }))).toBe(false);
    expect(guard("attacker-still-standing", frame(holder, { other: attacker as never }))).toBe(true);
    expect(guard("attacker-still-standing", frame(holder, { other: mon({ isFainted: () => true }) as never }))).toBe(
      false,
    );
    const victim = mon({ turnData: { attacksReceived: [{ sourceId: 7 }] } });
    expect(guard("credited-with-the-knock-out", frame(mon({ id: 7 }), { other: victim as never }))).toBe(true);
    expect(guard("credited-with-the-knock-out", frame(mon({ id: 8 }), { other: victim as never }))).toBe(false);
    expect(guard("credited-with-the-knock-out", frame(mon({ id: 7 }), { other: mon() as never }))).toBe(false);
  });

  it("not-protected-from-indirect-damage asks for the Magic Guard style attr", () => {
    expect(guard("not-protected-from-indirect-damage", frame(mon()))).toBe(true);
    const magicGuard = mon({ hasAbilityWithAttr: (name: string) => name === "BlockNonDirectDamageAbAttr" });
    expect(guard("not-protected-from-indirect-damage", frame(magicGuard))).toBe(false);
  });
});

describe("calc effects with the arithmetic of their classes", () => {
  const run = (block: string, params: Record<string, number>, holders: Record<string, { value: number }>, f: Frame) => {
    const compiled = compileEffect({ block, params });
    const context = { frame: f, params: holders };
    const allowed = compiled.feasible === undefined || compiled.feasible(context);
    if (allowed) {
      compiled.run(context);
    }
    return allowed;
  };

  it("effect.raise-crit-stage adds the stages", () => {
    const critStage = { value: 1 };
    run("effect.raise-crit-stage", { stages: 2 }, { critStage }, frame(mon()));
    expect(critStage.value).toBe(3);
  });

  it("effect.multiply-crit-damage only changes critical hits (multiplier above 1)", () => {
    const crit = { value: 1.5 };
    expect(run("effect.multiply-crit-damage", { multiplier: 1.5 }, { critMult: crit }, frame(mon()))).toBe(true);
    expect(crit.value).toBeCloseTo(2.25, 10);
    const plain = { value: 1 };
    expect(run("effect.multiply-crit-damage", { multiplier: 1.5 }, { critMult: plain }, frame(mon()))).toBe(false);
    expect(plain.value).toBe(1);
  });

  it("effect.multiply-effect-chance caps at 100 and skips a zero chance, Order Up and Electro Shot", () => {
    const f = (id: MoveId) => frame(mon(), { move: { id } as never });
    const sixty = { value: 60 };
    expect(run("effect.multiply-effect-chance", { multiplier: 2 }, { chance: sixty }, f(MoveId.TACKLE))).toBe(true);
    expect(sixty.value).toBe(100);
    const thirty = { value: 30 };
    run("effect.multiply-effect-chance", { multiplier: 2 }, { chance: thirty }, f(MoveId.TACKLE));
    expect(thirty.value).toBe(60);
    const none = { value: 0 };
    expect(run("effect.multiply-effect-chance", { multiplier: 2 }, { chance: none }, f(MoveId.TACKLE))).toBe(false);
    for (const id of [MoveId.ORDER_UP, MoveId.ELECTRO_SHOT]) {
      const chance = { value: 30 };
      expect(run("effect.multiply-effect-chance", { multiplier: 2 }, { chance }, f(id))).toBe(false);
      expect(chance.value).toBe(30);
    }
    const zero = { value: 40 };
    run("effect.multiply-effect-chance", { multiplier: 0 }, { chance: zero }, f(MoveId.TACKLE));
    expect(zero.value).toBe(0);
  });
});
