/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B08 chunk 3, CurseAttackerOnFormBlockDamageAbAttr (Patchwork). The shared L1 grid cannot reach the form check (no grid
// Pokemon is in a form that blocks damage) and the L2 twin only shows the not-triggered case (the default holder is not a
// Mimikyu). A real Mimikyu in its intact form is the stand-in: the original and the rebuild must block the hit, take the same
// recoil and curse the attacker the same way, and a simulated call must change nothing.
import { allMoves } from "#data/data-lists";
import { recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

describe("B08 chunk 3: Patchwork (CurseAttackerOnFormBlockDamageAbAttr)", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("an intact Mimikyu: the original and the rebuild block the hit, take the same recoil and curse the attacker; a simulated call changes nothing; a form that does not block lets the hit through", async () => {
    const world = await startWorld(phaserGame, { holder: SpeciesId.MIMIKYU });
    const { holder, foe } = world;
    const module = declRegistry.get("CurseAttackerOnFormBlockDamageAbAttr")!;
    const site = allAttrSites().find(s => s.className === "CurseAttackerOnFormBlockDamageAbAttr")!;
    expect(site.abilityName).toBe("Patchwork");
    const rebuilt = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex);
    expect(holder.formIndex).toBe(0);
    const run = (attr: typeof site.attr, simulated: boolean) => {
      foe.removeTag(BattlerTagType.CURSED);
      holder.hp = holder.getMaxHp();
      const damage = new NumberHolder(40);
      const params = { pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], damage, simulated };
      const can = attr.canApply(params as never);
      if (can) {
        attr.apply(params as never);
      }
      return {
        can,
        damage: damage.value,
        holderHp: holder.hp,
        cursed: foe.getTag(BattlerTagType.CURSED) !== undefined,
      };
    };
    const original = run(site.attr, false);
    const library = run(rebuilt, false);
    expect(library).toEqual(original);
    // Blocked: no damage, one eighth of the max HP lost, the attacker cursed.
    expect(original).toEqual({
      can: true,
      damage: 0,
      holderHp: holder.getMaxHp() - Math.floor(holder.getMaxHp() / 8),
      cursed: true,
    });
    // Simulated: the same question, nothing mutated, nobody cursed.
    const simulatedOriginal = run(site.attr, true);
    const simulatedLibrary = run(rebuilt, true);
    expect(simulatedLibrary).toEqual(simulatedOriginal);
    expect(simulatedOriginal.cursed).toBe(false);
    expect(simulatedOriginal.holderHp).toBe(holder.getMaxHp());
    // A hit that deals no damage is not blocked (the first clause of the inherited canApply).
    const none = new NumberHolder(0);
    const noDamageParams = {
      pokemon: holder,
      opponent: foe,
      move: allMoves[MoveId.TACKLE],
      damage: none,
      simulated: false,
    };
    expect(site.attr.canApply(noDamageParams as never)).toBe(false);
    expect(rebuilt.canApply(noDamageParams as never)).toBe(false);
  });

  it("the recoil setting reaches the compiled attr, and the condition slot decides the block", async () => {
    const world = await startWorld(phaserGame, { holder: SpeciesId.MIMIKYU });
    const { holder, foe } = world;
    const module = declRegistry.get("CurseAttackerOnFormBlockDamageAbAttr")!;
    const site = allAttrSites().find(s => s.className === "CurseAttackerOnFormBlockDamageAbAttr")!;
    const quarter = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, { params: { recoil: 0.25 } });
    foe.removeTag(BattlerTagType.CURSED);
    holder.hp = holder.getMaxHp();
    const damage = new NumberHolder(40);
    const params = { pokemon: holder, opponent: foe, move: allMoves[MoveId.TACKLE], damage, simulated: false };
    expect(quarter.canApply(params as never)).toBe(true);
    quarter.apply(params as never);
    expect(holder.hp).toBe(holder.getMaxHp() - Math.floor(holder.getMaxHp() / 4));
    // An IF that never holds (a Water move only) stops the block: the Tackle goes through.
    const onlyWater = recomposeAttr(module, site.attr, site.abilityId, site.attrIndex, {
      conds: { "ctor:3": { block: "move.type", params: { type: "WATER", effective: false } } },
    });
    expect(onlyWater.canApply({ ...params, damage: new NumberHolder(40) } as never)).toBe(false);
    expect(
      onlyWater.canApply({ ...params, move: allMoves[MoveId.WATER_GUN], damage: new NumberHolder(40) } as never),
    ).toBe(true);
  });
});
