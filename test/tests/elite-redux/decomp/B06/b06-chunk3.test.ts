/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B06 chunk 3: what the shared L1 and L2 suites cannot see. Every test drives the ORIGINAL attr of a real ability and, where the class is
// rebuildable, its REBUILD (recomposeAttr from the declaration and the bindings) side by side. Classes: PreventItemUseAbAttr (a marker read
// by presence), HealFromBerryUseAbAttr, RunSuccessAbAttr, ArenaTrapAbAttr, MaxMultiHitAbAttr, PostBattleLootAbAttr,
// PostFaintUnsuppressedWeatherFormChangeAbAttr (their engine moments are not reached by a shared L2 scenario) and PostFaintFormChangeAbAttr
// (every user is a legacy closure, so only the originals exist).
import type {
  ArenaTrapAbAttr,
  HealFromBerryUseAbAttr,
  MaxMultiHitAbAttr,
  PostBattleLootAbAttr,
  PostFaintFormChangeAbAttr,
  PostFaintUnsuppressedWeatherFormChangeAbAttr,
  PreventItemUseAbAttr,
  RunSuccessAbAttr,
} from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { AbilityId } from "#enums/ability-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { rebuildAbility, registerShadow, unregisterShadows } from "#test/tests/elite-redux/decomp/harness/rebuild";
import { allocateShadowId, liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { setTypesOf } from "#test/tests/elite-redux/decomp/harness/world";
import { BooleanHolder, NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

let phaserGame: Phaser.Game;
beforeAll(() => {
  phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
});
afterEach(() => {
  unregisterShadows();
  vi.restoreAllMocks();
});

function moduleOf(name: string) {
  const module = declRegistry.get(name);
  expect(module, `${name} must be declared`).toBeDefined();
  return module!;
}

const base = (pokemon: unknown, simulated = false) => ({ pokemon, simulated }) as never;

/** The ability rebuilt from its own declarations, registered under a shadow id. */
function shadowOf(abilityId: number): number {
  const shadowId = allocateShadowId();
  const rebuilt = rebuildAbility(liveAbility(abilityId), shadowId, { registry: declRegistry });
  registerShadow(shadowId, rebuilt.ability);
  return shadowId;
}

describe("PreventItemUseAbAttr (Klutz, Unnerve, As One, Crowned King, Voracity)", () => {
  const SITES: readonly (readonly [abilityId: number, attrIndex: number])[] = [
    [103, 1],
    [127, 1],
    [5004, 1],
    [5004, 3],
    [5005, 1],
    [5005, 3],
    [5259, 1],
    [5259, 4],
    [6101, 1],
    [20022, 2],
  ];

  it("every user is a plain marker, and the rebuild is the same class with the same pop-up flag", () => {
    for (const [abilityId, attrIndex] of SITES) {
      const original = liveAbility(abilityId).attrs[attrIndex] as PreventItemUseAbAttr;
      expect(original.constructor.name, `${abilityId} attr ${attrIndex}`).toBe("PreventItemUseAbAttr");
      const rebuilt = recomposeAttr(
        moduleOf("PreventItemUseAbAttr"),
        original,
        abilityId,
        attrIndex,
      ) as PreventItemUseAbAttr;
      expect(rebuilt).not.toBe(original);
      expect(rebuilt.constructor.name).toBe("PreventItemUseAbAttr");
      expect(rebuilt.showAbility).toBe(original.showAbility);
    }
  });

  it("the item code's own question (does an opponent have the marker?) is true for the original and for the rebuilt ability", async () => {
    const { game, holder } = await startWorld(phaserGame);
    const ask = () => holder.getOpponents().some(opp => opp.hasAbilityWithAttr("PreventItemUseAbAttr"));
    game.override.enemyAbility(AbilityId.BALL_FETCH);
    expect(ask(), "no marker").toBe(false);
    for (const abilityId of [103, 127, 5004, 5259, 6101]) {
      game.override.enemyAbility(abilityId as AbilityId);
      expect(ask(), `original ${abilityId}`).toBe(true);
      game.override.enemyAbility(shadowOf(abilityId) as AbilityId);
      expect(ask(), `rebuilt ${abilityId}`).toBe(true);
    }
  });
});

describe("HealFromBerryUseAbAttr (Gluttony, Voracity)", () => {
  const SITES = [
    [82, 1],
    [6101, 3],
  ] as const;

  it("heals a third of max HP rounded down, nothing when simulated, and the rebuild and a moved setting agree", async () => {
    const { holder } = await startWorld(phaserGame);
    const unshift = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
    for (const [abilityId, attrIndex] of SITES) {
      const original = liveAbility(abilityId).attrs[attrIndex] as HealFromBerryUseAbAttr;
      const rebuilt = recomposeAttr(
        moduleOf("HealFromBerryUseAbAttr"),
        original,
        abilityId,
        attrIndex,
      ) as HealFromBerryUseAbAttr;
      expect(rebuilt).not.toBe(original);
      const half = recomposeAttr(moduleOf("HealFromBerryUseAbAttr"), original, abilityId, attrIndex, {
        params: { healShare: 0.5 },
      }) as HealFromBerryUseAbAttr;
      const third = Math.max(Math.floor(holder.getMaxHp() * (1 / 3)), 1);
      const expectations: [HealFromBerryUseAbAttr, number][] = [
        [original, third],
        [rebuilt, third],
        [half, Math.max(Math.floor(holder.getMaxHp() * 0.5), 1)],
      ];
      for (const [attr, amount] of expectations) {
        unshift.mockClear();
        attr.apply(base(holder, true));
        expect(unshift, "simulated").not.toHaveBeenCalled();
        attr.apply(base(holder));
        expect(unshift).toHaveBeenCalledTimes(1);
        const call = unshift.mock.calls[0] as unknown[];
        expect(call[0]).toBe("PokemonHealPhase");
        expect(call[2], `${abilityId} amount`).toBe(amount);
        expect(attr.canApply(base(holder))).toBe(true);
      }
    }
  });

  it("clamps the share to 0..1 like the constructor", async () => {
    const { holder } = await startWorld(phaserGame);
    const unshift = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation((() => {}) as never);
    const original = liveAbility(82).attrs[1] as HealFromBerryUseAbAttr;
    const whole = recomposeAttr(moduleOf("HealFromBerryUseAbAttr"), original, 82, 1, {
      params: { healShare: 1 },
    }) as HealFromBerryUseAbAttr;
    whole.apply(base(holder));
    expect((unshift.mock.calls[0] as unknown[])[2]).toBe(holder.getMaxHp());
  });
});

describe("RunSuccessAbAttr (Run Away and its ER kin)", () => {
  const SITES = [
    [50, 0],
    [155, 3],
    [193, 1],
    [194, 1],
    [5165, 1],
    [5210, 0],
    [5282, 1],
  ] as const;

  it("makes the escape certain whatever the chance was, and the rebuild agrees", async () => {
    const { holder } = await startWorld(phaserGame);
    for (const [abilityId, attrIndex] of SITES) {
      const original = liveAbility(abilityId).attrs[attrIndex] as RunSuccessAbAttr;
      expect(original.constructor.name, `${abilityId}`).toBe("RunSuccessAbAttr");
      const rebuilt = recomposeAttr(moduleOf("RunSuccessAbAttr"), original, abilityId, attrIndex) as RunSuccessAbAttr;
      expect(rebuilt).not.toBe(original);
      for (const attr of [original, rebuilt]) {
        for (const start of [0, 25, 100]) {
          const chance = new NumberHolder(start);
          expect(attr.canApply({ pokemon: holder, chance } as never)).toBe(true);
          attr.apply({ pokemon: holder, chance } as never);
          expect(chance.value, `${abilityId} from ${start}`).toBe(256);
        }
      }
    }
  });
});

describe("ArenaTrapAbAttr (Arena Trap, Salt Circle, and the legacy closures of Shadow Tag and Magnet Pull)", () => {
  const ARENA_TRAP = 71;
  const SALT_CIRCLE = 5273;

  function trapped(attr: ArenaTrapAbAttr, holder: unknown, foe: unknown): boolean {
    const result = new BooleanHolder(false);
    const params = { pokemon: holder, opponent: foe, trapped: result, simulated: false } as never;
    const can = attr.canApply(params);
    if (can) {
      attr.apply(params);
      expect(result.value).toBe(true);
    } else {
      expect(result.value).toBe(false);
    }
    return can;
  }

  it("Arena Trap traps a grounded foe only, Salt Circle every foe; never a Ghost or a foe with Run Away; the rebuild agrees", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const expectations: [number, PokemonType[], boolean][] = [
      [ARENA_TRAP, [PokemonType.WATER], true],
      [ARENA_TRAP, [PokemonType.FLYING], false],
      [ARENA_TRAP, [PokemonType.GHOST], false],
      [SALT_CIRCLE, [PokemonType.WATER], true],
      [SALT_CIRCLE, [PokemonType.FLYING], true],
      [SALT_CIRCLE, [PokemonType.GHOST], false],
    ];
    for (const [abilityId, types, expected] of expectations) {
      const original = liveAbility(abilityId).attrs[0] as ArenaTrapAbAttr;
      const rebuilt = recomposeAttr(moduleOf("ArenaTrapAbAttr"), original, abilityId, 0) as ArenaTrapAbAttr;
      expect(rebuilt).not.toBe(original);
      expect(rebuilt.showAbility).toBe(false);
      setTypesOf(foe, types);
      for (const attr of [original, rebuilt]) {
        expect(trapped(attr, holder, foe), `${abilityId} ${types.join(",")}`).toBe(expected);
      }
    }
    // A foe with Run Away is never trapped, whatever the closure says.
    setTypesOf(foe, [PokemonType.WATER]);
    game.override.enemyAbility(AbilityId.RUN_AWAY);
    for (const abilityId of [ARENA_TRAP, SALT_CIRCLE]) {
      const original = liveAbility(abilityId).attrs[0] as ArenaTrapAbAttr;
      const rebuilt = recomposeAttr(moduleOf("ArenaTrapAbAttr"), original, abilityId, 0) as ArenaTrapAbAttr;
      for (const attr of [original, rebuilt]) {
        expect(trapped(attr, holder, foe), `Run Away vs ${abilityId}`).toBe(false);
      }
    }
  });

  it("the legacy closures answer as read: Magnet Pull traps Steel types, Shadow Tag and Frenzied Phantom everything but Ghosts and Shadow Tag", async () => {
    const { game, holder, foe } = await startWorld(phaserGame);
    const magnet = liveAbility(42).attrs[0] as ArenaTrapAbAttr;
    setTypesOf(foe, [PokemonType.STEEL]);
    expect(trapped(magnet, holder, foe)).toBe(true);
    setTypesOf(foe, [PokemonType.WATER]);
    expect(trapped(magnet, holder, foe)).toBe(false);
    for (const [abilityId, attrIndex] of [
      [23, 0],
      [5491, 2],
    ] as const) {
      const attr = liveAbility(abilityId).attrs[attrIndex] as ArenaTrapAbAttr;
      game.override.enemyAbility(AbilityId.BALL_FETCH);
      setTypesOf(foe, [PokemonType.WATER]);
      expect(trapped(attr, holder, foe), `${abilityId} water foe`).toBe(true);
      setTypesOf(foe, [PokemonType.GHOST]);
      expect(trapped(attr, holder, foe), `${abilityId} ghost foe`).toBe(false);
      setTypesOf(foe, [PokemonType.WATER]);
      game.override.enemyAbility(AbilityId.SHADOW_TAG);
      expect(trapped(attr, holder, foe), `${abilityId} shadow tag foe`).toBe(false);
    }
  });
});

describe("MaxMultiHitAbAttr (Skill Link, Ninja's Blade)", () => {
  it("rewrites the hit roll to 0 (the best roll) and the rebuild agrees", async () => {
    const { holder } = await startWorld(phaserGame);
    for (const [abilityId, attrIndex] of [
      [92, 0],
      [5191, 1],
    ] as const) {
      const original = liveAbility(abilityId).attrs[attrIndex] as MaxMultiHitAbAttr;
      const rebuilt = recomposeAttr(moduleOf("MaxMultiHitAbAttr"), original, abilityId, attrIndex) as MaxMultiHitAbAttr;
      expect(rebuilt).not.toBe(original);
      expect(rebuilt.showAbility).toBe(false);
      for (const attr of [original, rebuilt]) {
        for (const roll of [0, 7, 19]) {
          const hits = new NumberHolder(roll);
          expect(attr.canApply({ pokemon: holder, hits } as never)).toBe(true);
          attr.apply({ pokemon: holder, hits } as never);
          expect(hits.value, `${abilityId} roll ${roll}`).toBe(0);
        }
      }
    }
  });
});

describe("PostBattleLootAbAttr (Pickup)", () => {
  it("needs a won battle with loot left and an item that can be taken; the rebuild agrees clause by clause", async () => {
    const { holder } = await startWorld(phaserGame);
    const original = liveAbility(53).attrs[0] as PostBattleLootAbAttr;
    const rebuilt = recomposeAttr(moduleOf("PostBattleLootAbAttr"), original, 53, 0) as PostBattleLootAbAttr;
    expect(rebuilt).not.toBe(original);
    const stub = { type: { name: "Stub Item" } };
    const battle = globalScene.currentBattle;
    const savedLoot = battle.postBattleLoot;
    try {
      for (const attr of [original, rebuilt]) {
        const canTransfer = vi.spyOn(globalScene, "canTransferHeldItemModifier").mockReturnValue(true);
        const params = (simulated: boolean, victory: boolean) => ({ pokemon: holder, simulated, victory }) as never;
        battle.postBattleLoot = [];
        expect(attr.canApply(params(false, true)), "no loot").toBe(false);
        battle.postBattleLoot = [stub as never];
        expect(attr.canApply(params(true, true)), "simulated").toBe(false);
        expect(attr.canApply(params(false, false)), "lost the battle").toBe(false);
        expect(canTransfer, "no transfer check before the three gates pass").not.toHaveBeenCalled();
        expect(attr.canApply(params(false, true)), "won with loot").toBe(true);
        expect(canTransfer).toHaveBeenCalledTimes(1);
        canTransfer.mockReturnValue(false);
        expect(attr.canApply(params(false, true)), "an item that cannot be taken").toBe(false);

        // apply: the item moves, leaves the loot list and a message is queued
        const transfer = vi.spyOn(globalScene, "tryTransferHeldItemModifier").mockReturnValue(true);
        const message = vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation((() => {}) as never);
        canTransfer.mockReturnValue(true);
        expect(attr.canApply(params(false, true))).toBe(true);
        attr.apply(params(false, true));
        expect(transfer).toHaveBeenCalledTimes(1);
        expect(transfer.mock.calls[0][0]).toBe(stub);
        expect(battle.postBattleLoot).toEqual([]);
        expect(message).toHaveBeenCalledTimes(1);
        vi.restoreAllMocks();
      }
    } finally {
      battle.postBattleLoot = savedLoot;
    }
  });
});

describe("PostFaintUnsuppressedWeatherFormChangeAbAttr (Cloud Nine, Air Lock, In the Clouds)", () => {
  const SITES = [
    [13, 3],
    [76, 3],
    [6020, 4],
  ] as const;

  it("is possible only while a Castform with Forecast is on the field, triggers the weather form change once, and the rebuild agrees", async () => {
    // First a field with no Castform: nothing to refresh, so the attr is not possible.
    const plain = await startWorld(phaserGame);
    for (const [abilityId, attrIndex] of SITES) {
      const original = liveAbility(abilityId).attrs[attrIndex] as PostFaintUnsuppressedWeatherFormChangeAbAttr;
      const rebuilt = recomposeAttr(
        moduleOf("PostFaintUnsuppressedWeatherFormChangeAbAttr"),
        original,
        abilityId,
        attrIndex,
      ) as PostFaintUnsuppressedWeatherFormChangeAbAttr;
      expect(rebuilt).not.toBe(original);
      for (const attr of [original, rebuilt]) {
        expect(attr.canApply(base(plain.holder)), `${abilityId} no Castform`).toBe(false);
      }
    }
    // Then a Castform with Forecast.
    const { game, holder } = await startWorld(phaserGame, { holder: SpeciesId.CASTFORM });
    game.override.ability(AbilityId.FORECAST);
    const trigger = vi.spyOn(globalScene.arena, "triggerWeatherBasedFormChanges").mockImplementation(() => {});
    for (const [abilityId, attrIndex] of SITES) {
      const original = liveAbility(abilityId).attrs[attrIndex] as PostFaintUnsuppressedWeatherFormChangeAbAttr;
      const rebuilt = recomposeAttr(
        moduleOf("PostFaintUnsuppressedWeatherFormChangeAbAttr"),
        original,
        abilityId,
        attrIndex,
      ) as PostFaintUnsuppressedWeatherFormChangeAbAttr;
      expect(rebuilt).not.toBe(original);
      for (const attr of [original, rebuilt]) {
        expect(attr.canApply(base(holder)), `${abilityId} Forecast`).toBe(true);
        trigger.mockClear();
        attr.apply(base(holder, true));
        expect(trigger, "simulated").not.toHaveBeenCalled();
        attr.apply(base(holder));
        expect(trigger).toHaveBeenCalledTimes(1);
      }
    }
  });
});

describe("PostFaintFormChangeAbAttr (Disguise, Battle Bond, Power Construct, Patchwork, Revelation)", () => {
  it("every user is a legacy closure, and the original answers as read: act only when the form function names another form", async () => {
    const { holder } = await startWorld(phaserGame);
    const trigger = vi.spyOn(globalScene, "triggerPokemonFormChange").mockImplementation((() => true) as never);
    const standIn = (formIndex: number) => ({ formIndex, getHpRatio: () => 0 }) as never;
    // Disguise and Patchwork: always form 0; Battle Bond: always form 1; Power Construct: formIndex - 2.
    for (const [abilityId, attrIndex] of [
      [209, 4],
      [5396, 4],
    ] as const) {
      const attr = liveAbility(abilityId).attrs[attrIndex] as PostFaintFormChangeAbAttr;
      expect(attr.constructor.name).toBe("PostFaintFormChangeAbAttr");
      expect(attr.canApply({ pokemon: standIn(0) } as never), `${abilityId} base form`).toBe(false);
      expect(attr.canApply({ pokemon: standIn(1) } as never), `${abilityId} other form`).toBe(true);
    }
    const bond = liveAbility(210).attrs[2] as PostFaintFormChangeAbAttr;
    expect(bond.canApply({ pokemon: standIn(0) } as never)).toBe(true);
    expect(bond.canApply({ pokemon: standIn(1) } as never)).toBe(false);
    const construct = liveAbility(211).attrs[3] as PostFaintFormChangeAbAttr;
    expect(construct.canApply({ pokemon: standIn(4) } as never)).toBe(true);
    // apply only runs the form change when not simulated
    const disguise = liveAbility(209).attrs[4] as PostFaintFormChangeAbAttr;
    disguise.apply({ pokemon: holder, simulated: true } as never);
    expect(trigger).not.toHaveBeenCalled();
    disguise.apply({ pokemon: holder, simulated: false } as never);
    expect(trigger).toHaveBeenCalledTimes(1);
    expect((trigger.mock.calls[0] as unknown[])[0]).toBe(holder);
  });

  it("Battle Bond and Power Construct keep their attr-level conditions", () => {
    const bond = liveAbility(210).attrs[2] as unknown as { extraCondition?: unknown };
    const construct = liveAbility(211).attrs[3] as unknown as { extraCondition?: unknown };
    expect(bond.extraCondition, "Battle Bond condition").toBeTypeOf("function");
    expect(construct.extraCondition, "Power Construct condition").toBeTypeOf("function");
  });
});
