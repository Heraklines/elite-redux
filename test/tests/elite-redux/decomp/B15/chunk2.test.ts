/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B15 chunk 2 probes: what the shared L1 and L2 suites cannot see.
//   - Genesis Supernova: the "someone else used the move" half of the gate, and a rebuilt rule with another type and terrain;
//   - Dandelion Burst: the float crossing test equals the library floor-half form for every HP, the once-per memory, the typed params;
//   - Crosscut: both eligibility halves (gate and residual), a rebuilt rule with another gate, the category flip of strike two, the constructor name;
//   - Cleansing Light, Heartbreak, Draconic Voodoo: the typed params really drive the class (doubles are stood in for by the foe, the doubles
//     fixtures of the old scenario tests do not start two player Pokemon on this branch, see the notes of the declarations);
//   - Common Root: the marker keeps the name the Leech Seed tag looks for.
import { globalScene } from "#app/global-scene";
import { allMoves } from "#data/data-lists";
import type { CleansingLightAbAttr } from "#data/elite-redux/abilities/cleansing-light";
import { CommonRootAbAttr } from "#data/elite-redux/abilities/common-root";
import type { CrosscutPowerAbAttr, CrosscutSecondStrikeAbAttr } from "#data/elite-redux/abilities/crosscut";
import {
  DANDELION_BURST_THRESHOLD,
  DandelionBurstAbAttr,
  erDandelionBurstUsedWave,
} from "#data/elite-redux/abilities/dandelion-burst";
import { DraconicVoodooAbAttr, erDraconicVoodooOnHit } from "#data/elite-redux/abilities/draconic-voodoo";
import type { GenesisSupernovaAbAttr } from "#data/elite-redux/abilities/genesis-supernova";
import { erHeartbreakOnAllyFaint, HeartbreakAbAttr } from "#data/elite-redux/abilities/heartbreak";
import { formLink, getLinkedAlly } from "#data/elite-redux/abilities/link";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { hpCrossedBelowRounded } from "#data/elite-redux/ability-studio/vocabulary/hp-math";
import { PokemonMove } from "#data/moves/pokemon-move";
import { TerrainType } from "#data/terrain";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveCategory } from "#enums/move-category";
import { MoveFlags } from "#enums/move-flags";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { Stat } from "#enums/stat";
import { StatusEffect } from "#enums/status-effect";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const COMMON_ROOT = 5904;
const DANDELION_BURST = 5907;
const CROSSCUT = 5908;
const CLEANSING_LIGHT = 5912;
const HEARTBREAK = 5920;
const DRACONIC_VOODOO = 5930;
const GENESIS_SUPERNOVA = 5937;

function declared(className: string) {
  const module = declRegistry.get(className);
  expect(module, `${className} must be declared`).toBeDefined();
  return module!;
}

describe("B15 chunk 2", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  describe("Genesis Supernova", () => {
    it("fires for the holder own Psychic move only, and a rebuilt rule with Water and Grassy Terrain follows the params", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(GENESIS_SUPERNOVA).attrs[0] as GenesisSupernovaAbAttr;
      const params = (source: typeof holder, move: MoveId) =>
        ({ pokemon: holder, source, move: new PokemonMove(move), targets: [], simulated: false }) as never;
      expect(original.canApply(params(holder, MoveId.PSYCHIC))).toBe(true);
      expect(original.canApply(params(holder, MoveId.WATER_GUN))).toBe(false);
      // A foe that used a Psychic move is not "me".
      expect(original.canApply(params(foe, MoveId.PSYCHIC))).toBe(false);
      // A status Psychic move counts too (PostMoveUsed fires for every move).
      expect(original.canApply(params(holder, MoveId.CALM_MIND))).toBe(true);

      game.scene.arena.trySetTerrain(TerrainType.NONE, true);
      original.apply(params(holder, MoveId.PSYCHIC));
      expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.PSYCHIC);
      game.scene.arena.trySetTerrain(TerrainType.NONE, true);
      original.apply({ ...(params(holder, MoveId.PSYCHIC) as object), simulated: true } as never);
      expect(game.scene.arena.terrain?.terrainType ?? TerrainType.NONE).toBe(TerrainType.NONE);

      const rebuilt = recomposeAttr(declared("GenesisSupernovaAbAttr"), original, GENESIS_SUPERNOVA, 0, {
        params: { moveType: "WATER", terrain: "GRASSY" },
      }) as GenesisSupernovaAbAttr;
      expect(rebuilt.constructor.name).toBe("GenesisSupernovaAbAttr");
      expect(rebuilt.canApply(params(holder, MoveId.WATER_GUN))).toBe(true);
      expect(rebuilt.canApply(params(holder, MoveId.PSYCHIC))).toBe(false);
      expect(rebuilt.canApply(params(foe, MoveId.WATER_GUN))).toBe(false);
      rebuilt.apply(params(holder, MoveId.WATER_GUN));
      expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.GRASSY);
    });
  });

  describe("Dandelion Burst", () => {
    it("the class float crossing test is the library floor-half crossing for every HP, several max HP and several lines", () => {
      let checked = 0;
      for (const ratio of [0.5, 0.35, 0.33, 0.25, 0.1, 0.99]) {
        const attr = new DandelionBurstAbAttr(ratio);
        for (let max = 1; max <= 260; max++) {
          for (const damage of [1, 2, 7, Math.max(1, Math.floor(max / 3)), max]) {
            for (let hp = 1; hp <= max; hp++) {
              const pokemon = { hp, getMaxHp: () => max };
              const fromClass = attr.gate({ pokemon, damage } as never);
              const fromLibrary = hpCrossedBelowRounded(hp, max, damage, ratio, "floor-half", 0);
              if (fromClass !== fromLibrary) {
                throw new Error(
                  `hp ${hp}/${max} damage ${damage} ratio ${ratio}: class ${fromClass}, library ${fromLibrary}`,
                );
              }
              checked++;
            }
          }
        }
      }
      expect(checked).toBeGreaterThan(1_000_000);
    });

    it("fires once per wave on the crossing hit, seeds every foe, and a rebuilt rule uses its own line, stat and stages", async () => {
      const { game, holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(DANDELION_BURST).attrs[0] as DandelionBurstAbAttr;
      expect(original.hpRatio).toBe(DANDELION_BURST_THRESHOLD);
      const max = holder.getMaxHp();
      const line = Math.floor(max * 0.5);
      const hit = (damage: number, simulated = false) => ({ pokemon: holder, source: foe, damage, simulated }) as never;

      holder.hp = line + 1; // above the line after a 0 point event: no crossing
      expect(original.canApply(hit(0))).toBe(false);
      holder.hp = line; // on the line after a 5 point hit: it was above before
      expect(original.canApply(hit(5))).toBe(true);
      holder.hp = line + 1; // above the line after the hit: no crossing
      expect(original.canApply(hit(5))).toBe(false);
      holder.hp = 0;
      expect(original.canApply(hit(50))).toBe(false);

      holder.hp = line;
      const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew");
      original.apply(hit(5, true));
      expect(foe.getTag(BattlerTagType.SEEDED)).toBeUndefined();
      expect(erDandelionBurstUsedWave(holder)).toBeUndefined();
      expect(original.canApply(hit(5))).toBe(true);
      original.apply(hit(5));
      expect(foe.getTag(BattlerTagType.SEEDED)).toBeDefined();
      expect(spy).toHaveBeenCalledWith("StatStageChangePhase", foe.getBattlerIndex(), false, [Stat.SPD], -2);
      expect(erDandelionBurstUsedWave(holder)).toBe(game.scene.currentBattle.waveIndex);
      // Once per wave: the same crossing no longer fires.
      expect(original.canApply(hit(5))).toBe(false);
      spy.mockRestore();

      const rebuilt = recomposeAttr(declared("DandelionBurstAbAttr"), original, DANDELION_BURST, 0, {
        params: { hpRatio: 0.25, stat: "ATK", stages: -1 },
      }) as DandelionBurstAbAttr;
      expect(rebuilt.hpRatio).toBe(0.25);
      expect(rebuilt.stat).toBe(Stat.ATK);
      expect(rebuilt.stages).toBe(-1);
      const quarter = Math.floor(max * 0.25);
      holder.hp = quarter;
      // The rebuilt instance has its own gate but shares the module once-per memory with the original: the holder already used it this wave.
      expect(rebuilt.canApply(hit(5))).toBe(false);
      holder.hp = quarter + 6;
      expect(rebuilt.gate(hit(5))).toBe(false);
      holder.hp = quarter;
      expect(rebuilt.gate(hit(5))).toBe(true);
    });
  });

  describe("Dandelion Burst phase order", () => {
    it("with two foes the queue is [seeded message, stat phase] per foe, which a split into all seeds then all stat drops would change", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const attr = liveAbility(DANDELION_BURST).attrs[0] as DandelionBurstAbAttr;
      const foe2 = Object.create(foe) as typeof foe;
      foe2.isActive = () => true;
      foe2.getBattlerIndex = () => 3 as never;
      // SeedTag.onAdd (battler-tags.ts) queues its message exactly like this; the real foe does it through the real tag.
      foe2.addTag = (() => {
        globalScene.phaseManager.queueMessage("seeded-foe2");
        return true;
      }) as never;
      vi.spyOn(holder, "getOpponents").mockReturnValue([foe, foe2]);
      const trace: string[] = [];
      const queueSpy = vi.spyOn(globalScene.phaseManager, "queueMessage").mockImplementation(((message: string) => {
        trace.push(`message:${message === "seeded-foe2" ? "foe2" : "foe1"}`);
      }) as never);
      const unshiftSpy = vi.spyOn(globalScene.phaseManager, "unshiftNew").mockImplementation(((
        phase: string,
        index: number,
      ) => {
        trace.push(`${phase}:${index === 3 ? "foe2" : "foe1"}`);
      }) as never);
      attr.apply({ pokemon: holder, source: foe, damage: 5, simulated: false } as never);
      queueSpy.mockRestore();
      unshiftSpy.mockRestore();
      vi.restoreAllMocks();
      expect(trace).toEqual(["message:foe1", "StatStageChangePhase:foe1", "message:foe2", "StatStageChangePhase:foe2"]);
      // A split (all seeds, then all stat drops) would queue the two messages first, a different order.
      const split = [...trace.filter(t => t.startsWith("message")), ...trace.filter(t => !t.startsWith("message"))];
      expect(split).not.toEqual(trace);
    });
  });

  describe("Crosscut", () => {
    it("the second strike needs a single hit, a damaging slicing or pulse move and a splittable move; the residual stays in the class", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const second = liveAbility(CROSSCUT).attrs[0] as CrosscutSecondStrikeAbAttr;
      const power = liveAbility(CROSSCUT).attrs[1] as CrosscutPowerAbAttr;
      const strike = (move: MoveId, hits = 1) =>
        ({
          pokemon: holder,
          opponent: foe,
          move: allMoves[move],
          hitCount: new NumberHolder(hits),
          simulated: false,
        }) as never;
      expect(second.canApply(strike(MoveId.NIGHT_SLASH))).toBe(true);
      expect(second.canApply(strike(MoveId.WATER_PULSE))).toBe(true);
      expect(second.canApply(strike(MoveId.TACKLE))).toBe(false);
      // A pulse move that deals no damage is not a damaging move.
      expect(allMoves[MoveId.HEAL_PULSE].hasFlag(MoveFlags.PULSE_MOVE)).toBe(true);
      expect(second.canApply(strike(MoveId.HEAL_PULSE))).toBe(false);
      // The move already hits more than once.
      expect(second.canApply(strike(MoveId.NIGHT_SLASH, 2))).toBe(false);
      const params = strike(MoveId.NIGHT_SLASH) as unknown as { hitCount: NumberHolder };
      second.apply(params as never);
      expect(params.hitCount.value).toBe(2);

      // Gate true but residual false: a slicing or pulse damaging move that cannot be split into strikes.
      const unsplittable = allMoves.find(
        move =>
          move !== undefined
          && move.category !== MoveCategory.STATUS
          && (move.hasFlag(MoveFlags.SLICING_MOVE) || move.hasFlag(MoveFlags.PULSE_MOVE))
          && !move.canBeMultiStrikeEnhanced(holder, true, foe),
      );
      expect(unsplittable, "the probe needs a slicing or pulse move that cannot be split").toBeDefined();
      const unsplittableParams = {
        pokemon: holder,
        opponent: foe,
        move: unsplittable,
        hitCount: new NumberHolder(1),
        simulated: false,
      } as never;
      expect(second.gate(unsplittableParams)).toBe(true);
      expect(second.residual(unsplittableParams)).toBe(false);
      expect(second.canApply(unsplittableParams)).toBe(false);

      const powerOf = (move: MoveId, attr: CrosscutPowerAbAttr) => {
        const p = {
          pokemon: holder,
          opponent: foe,
          move: allMoves[move],
          power: new NumberHolder(100),
          simulated: false,
        };
        if (!attr.canApply(p as never)) {
          return 100;
        }
        attr.apply(p as never);
        return p.power.value;
      };
      expect(powerOf(MoveId.NIGHT_SLASH, power)).toBeCloseTo(70, 10);
      expect(powerOf(MoveId.TACKLE, power)).toBe(100);
      const rebuiltPower = recomposeAttr(declared("CrosscutPowerAbAttr"), power, CROSSCUT, 1, {
        params: { multiplier: 0.5 },
        conds: { gate: { block: "move.damaging", params: {} } },
      }) as CrosscutPowerAbAttr;
      expect(rebuiltPower.constructor.name).toBe("CrosscutPowerAbAttr");
      expect(powerOf(MoveId.NIGHT_SLASH, rebuiltPower)).toBe(50);
      // The new gate no longer asks for the flag, so a plain damaging move that can be split is boosted too.
      expect(powerOf(MoveId.TACKLE, rebuiltPower)).toBe(50);
    });

    it("a rebuilt second strike with a Water gate adds the strike for Water moves, and the category flip belongs to strike two only", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const second = liveAbility(CROSSCUT).attrs[0] as CrosscutSecondStrikeAbAttr;
      const rebuilt = recomposeAttr(declared("CrosscutSecondStrikeAbAttr"), second, CROSSCUT, 0, {
        conds: { gate: { block: "move.type", params: { type: "WATER", effective: false } } },
      }) as CrosscutSecondStrikeAbAttr;
      expect(rebuilt.constructor.name).toBe("CrosscutSecondStrikeAbAttr");
      const strike = (move: MoveId) =>
        ({
          pokemon: holder,
          opponent: foe,
          move: allMoves[move],
          hitCount: new NumberHolder(1),
          simulated: false,
        }) as never;
      expect(rebuilt.canApply(strike(MoveId.WATER_GUN))).toBe(true);
      expect(rebuilt.canApply(strike(MoveId.NIGHT_SLASH))).toBe(false);

      // resolveSecondStrikeCategory: the engine scans it by name; strike index = hitCount - hitsLeft.
      const slash = allMoves[MoveId.NIGHT_SLASH];
      holder.turnData.hitCount = 2;
      holder.turnData.hitsLeft = 2;
      expect(second.resolveSecondStrikeCategory(slash, holder, foe)).toBeNull(); // first strike keeps its category
      holder.turnData.hitsLeft = 1;
      expect(second.resolveSecondStrikeCategory(slash, holder, foe)).toBe(
        slash.category === MoveCategory.PHYSICAL ? MoveCategory.SPECIAL : MoveCategory.PHYSICAL,
      );
      expect(second.resolveSecondStrikeCategory(allMoves[MoveId.TACKLE], holder, foe)).toBeNull();
    });
  });

  describe("Cleansing Light", () => {
    it("heals the lowest-HP living ally by the typed share, cures from the typed knockout of the turn on, and a rebuilt rule follows the params", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      // The foe stands in for the ally (the doubles fixtures do not start two player Pokemon on this branch).
      vi.spyOn(holder, "getAllies").mockReturnValue([foe]);
      const original = liveAbility(CLEANSING_LIGHT).attrs[0] as CleansingLightAbAttr;
      expect(original.healFraction).toBe(0.1);
      expect(original.cureFromKo).toBe(2);
      const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew");
      const ko = { pokemon: holder, simulated: false } as never;
      foe.hp = Math.floor(foe.getMaxHp() / 2);
      expect(original.canApply(ko)).toBe(true);
      foe.doSetStatus(StatusEffect.POISON);
      const cure = vi.spyOn(foe, "resetStatus").mockImplementation(() => {});
      // First knockout of the turn: heals, no cure. Second: the status is cured (resetStatus is queued as a phase, so it is spied on).
      original.apply(ko);
      const heal = spy.mock.calls.find(call => call[0] === "PokemonHealPhase");
      expect(heal?.[2]).toBe(Math.max(1, Math.floor(foe.getMaxHp() * 0.1)));
      expect(cure).not.toHaveBeenCalled();
      original.apply(ko);
      expect(cure).toHaveBeenCalledTimes(1);
      // Simulated calls change nothing and do not count.
      original.apply({ pokemon: holder, simulated: true } as never);
      expect(cure).toHaveBeenCalledTimes(1);
      spy.mockRestore();

      const rebuilt = recomposeAttr(declared("CleansingLightAbAttr"), original, CLEANSING_LIGHT, 0, {
        params: { healPercent: 25, cureFromKo: 1 },
      }) as CleansingLightAbAttr;
      expect(rebuilt.healFraction).toBe(0.25);
      expect(rebuilt.cureFromKo).toBe(1);
      const spy2 = vi.spyOn(globalScene.phaseManager, "unshiftNew");
      foe.hp = Math.floor(foe.getMaxHp() / 2);
      cure.mockClear();
      rebuilt.apply(ko);
      expect(cure).toHaveBeenCalledTimes(1);
      const heal2 = spy2.mock.calls.find(call => call[0] === "PokemonHealPhase");
      expect(heal2?.[2]).toBe(Math.max(1, Math.floor(foe.getMaxHp() * 0.25)));
      spy2.mockRestore();
    });

    it("with no living ally the effect is not applied", async () => {
      const { holder } = await startWorld(phaserGame);
      const original = liveAbility(CLEANSING_LIGHT).attrs[0] as CleansingLightAbAttr;
      expect(original.canApply({ pokemon: holder, simulated: false } as never)).toBe(false);
    });
  });

  describe("Heartbreak", () => {
    it("links on entry; when the linked ally faints the holder gains and loses the typed number of stages, found by name", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      // The foe stands in for the doubles partner.
      vi.spyOn(holder, "getAdjacentAllies").mockReturnValue([foe]);
      const original = liveAbility(HEARTBREAK).attrs[0] as HeartbreakAbAttr;
      expect(original.boostStages).toBe(1);
      expect(original.dropStages).toBe(1);
      original.apply({ pokemon: holder, simulated: true } as never);
      expect(getLinkedAlly(holder)).toBeUndefined();
      original.apply({ pokemon: holder, simulated: false } as never);
      expect(formLink(holder)).toBe(foe);

      const carried = new HeartbreakAbAttr(2, 3);
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([carried]);
      const spy = vi.spyOn(globalScene.phaseManager, "unshiftNew");
      erHeartbreakOnAllyFaint(foe);
      const higherAttack = holder.getStat(Stat.ATK) >= holder.getStat(Stat.SPATK) ? Stat.ATK : Stat.SPATK;
      expect(spy).toHaveBeenCalledWith(
        "StatStageChangePhase",
        holder.getBattlerIndex(),
        true,
        [Stat.SPD, higherAttack],
        2,
      );
      expect(spy).toHaveBeenCalledWith(
        "StatStageChangePhase",
        holder.getBattlerIndex(),
        true,
        [Stat.DEF, Stat.SPDEF],
        -3,
      );
      // The link is broken afterwards, so a second faint does nothing.
      spy.mockClear();
      erHeartbreakOnAllyFaint(foe);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();

      const rebuilt = recomposeAttr(declared("HeartbreakAbAttr"), original, HEARTBREAK, 0, {
        params: { boostStages: 2, dropStages: 1 },
      }) as HeartbreakAbAttr;
      expect(rebuilt.boostStages).toBe(2);
      expect(rebuilt.dropStages).toBe(1);
      expect(rebuilt.constructor.name).toBe("HeartbreakAbAttr");
    });
  });

  describe("Draconic Voodoo", () => {
    it("on entry the foe across gains the typed type, and a preview changes nothing", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(DRACONIC_VOODOO).attrs[0] as DraconicVoodooAbAttr;
      expect(original.graftedType).toBe(PokemonType.DRAGON);
      expect(foe.isOfType(PokemonType.DRAGON)).toBe(false);
      original.apply({ pokemon: holder, simulated: true } as never);
      expect(foe.isOfType(PokemonType.DRAGON)).toBe(false);
      original.apply({ pokemon: holder, simulated: false } as never);
      expect(foe.isOfType(PokemonType.DRAGON)).toBe(true);
    });

    it("a rebuilt rule with another type grafts that type on entry", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const original = liveAbility(DRACONIC_VOODOO).attrs[0] as DraconicVoodooAbAttr;
      const rebuilt = recomposeAttr(declared("DraconicVoodooAbAttr"), original, DRACONIC_VOODOO, 0, {
        params: { type: "FIRE" },
      }) as DraconicVoodooAbAttr;
      expect(rebuilt.graftedType).toBe(PokemonType.FIRE);
      rebuilt.apply({ pokemon: holder, simulated: false } as never);
      expect(foe.isOfType(PokemonType.FIRE)).toBe(true);
      expect(foe.isOfType(PokemonType.DRAGON)).toBe(false);
    });

    it("the on-hit half reads the type from the holder live attr: a damaging biting or same-type hit only", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const carried = new DraconicVoodooAbAttr(PokemonType.FIRE);
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([carried]);
      expect(foe.isOfType(PokemonType.FIRE)).toBe(false);
      erDraconicVoodooOnHit(holder, foe, allMoves[MoveId.TACKLE], true); // neither biting nor Fire
      expect(foe.isOfType(PokemonType.FIRE)).toBe(false);
      erDraconicVoodooOnHit(holder, foe, allMoves[MoveId.EMBER], false); // no damage dealt
      expect(foe.isOfType(PokemonType.FIRE)).toBe(false);
      erDraconicVoodooOnHit(holder, foe, allMoves[MoveId.EMBER], true);
      expect(foe.isOfType(PokemonType.FIRE)).toBe(true);
    });

    it("a biting move grafts the type even when it is not of that type", async () => {
      const { holder, foe } = await startWorld(phaserGame);
      const carried = new DraconicVoodooAbAttr(PokemonType.FIRE);
      vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([carried]);
      expect(allMoves[MoveId.BITE].hasFlag(MoveFlags.BITING_MOVE)).toBe(true);
      erDraconicVoodooOnHit(holder, foe, allMoves[MoveId.BITE], true);
      expect(foe.isOfType(PokemonType.FIRE)).toBe(true);
    });
  });

  describe("Common Root", () => {
    it("is a silent presence marker that keeps the name the Leech Seed tag looks for", () => {
      const attr = liveAbility(COMMON_ROOT).attrs[0];
      expect(attr).toBeInstanceOf(CommonRootAbAttr);
      expect(attr.constructor.name).toBe("CommonRootAbAttr");
      expect(attr.showAbility).toBe(false);
    });
  });
});
