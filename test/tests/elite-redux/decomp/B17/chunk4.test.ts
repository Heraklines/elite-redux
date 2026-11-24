/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B17 chunk 4 (Void): what the shared L1 grid cannot see, because the grid foe holds no items. The class has no gate, so the
// test compares canApply and apply with an oracle written from the source over the states that matter: a preview, no item to take,
// an item to take, an item that cannot be carried, and the single seeded draw.
import { globalScene } from "#app/global-scene";
import type { VoidPostTurnStealAbAttr } from "#data/elite-redux/abilities/bernerd-roster-mechanics";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { allAttrSites } from "#test/tests/elite-redux/decomp/harness/sites";
import Phaser from "phaser";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const VOID = 6102;

function voidAttr(): VoidPostTurnStealAbAttr {
  const found = allAttrSites().find(s => s.abilityId === VOID && s.className === "VoidPostTurnStealAbAttr");
  if (found === undefined) {
    throw new Error("Void has no VoidPostTurnStealAbAttr");
  }
  return found.attr as VoidPostTurnStealAbAttr;
}

describe("B17 chunk 4: Void", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("the declaration is a package with the end-of-turn trigger, no condition and no setting", () => {
    const module = declRegistry.get("VoidPostTurnStealAbAttr");
    expect(module).toBeDefined();
    expect(module!.decl.when).toBe("event.end-of-turn");
    expect(module!.decl.status).toBe("decomposed");
    expect(module!.decl.conditions).toEqual([]);
    expect(module!.decl.params).toEqual([]);
    expect(module!.decl.notes?.length ?? 0).toBeGreaterThan(200);
  });

  it("canApply: a preview always passes; otherwise it needs a takeable foe item (oracle from the source)", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = voidAttr();
    const items = [{ isTransferable: true, pokemonId: -1 }];
    const find = vi.spyOn(globalScene, "findModifiers");
    const canTransfer = vi.spyOn(globalScene, "canTransferHeldItemModifier");

    for (const simulated of [true, false]) {
      for (const found of [[], items]) {
        for (const carry of [true, false]) {
          find.mockReturnValue(found as never);
          canTransfer.mockReturnValue(carry);
          const hasFoe = holder.getOpponents().length > 0;
          // Oracle: simulated || (some foe yields a transferable item that I can carry).
          const expected = simulated || (hasFoe && found.length > 0 && carry);
          expect(attr.canApply({ pokemon: holder, simulated }), `simulated=${simulated} items=${found.length} carry=${carry}`).toBe(
            expected,
          );
        }
      }
    }
  });

  it("apply: nothing for a preview or an empty list; otherwise exactly one draw over the list and one transfer", async () => {
    const { holder } = await startWorld(phaserGame);
    const attr = voidAttr();
    const itemA = { id: "a" };
    const itemB = { id: "b" };
    const find = vi.spyOn(globalScene, "findModifiers");
    vi.spyOn(globalScene, "canTransferHeldItemModifier").mockReturnValue(true);
    const transfer = vi.spyOn(globalScene, "tryTransferHeldItemModifier").mockReturnValue(true as never);
    const draw = vi.spyOn(holder, "randBattleSeedInt");

    // Preview: no draw, no transfer.
    find.mockReturnValue([] as never);
    attr.apply({ pokemon: holder, simulated: true });
    expect(draw).not.toHaveBeenCalled();
    expect(transfer).not.toHaveBeenCalled();

    // Empty list: no draw, no transfer.
    attr.apply({ pokemon: holder, simulated: false });
    expect(draw).not.toHaveBeenCalled();
    expect(transfer).not.toHaveBeenCalled();

    // Items: the draw covers the whole list (one entry per foe that yields the mocked list) and picks the item at that index.
    const foes = holder.getOpponents().length;
    // The mocked search yields the same two items for every foe, so the list is the two items once per foe, in foe order.
    find.mockImplementation((() => [itemA, itemB]) as never);
    draw.mockReturnValue(1);
    attr.apply({ pokemon: holder, simulated: false });
    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledWith(2 * foes);
    expect(transfer).toHaveBeenCalledTimes(1);
    expect(transfer.mock.calls[0][1]).toBe(holder);
    expect(transfer.mock.calls[0][2]).toBe(false);
    expect(transfer.mock.calls[0][0]).toBe(foes > 0 ? [itemA, itemB, itemA, itemB].slice(0, 2 * foes)[1] : undefined);
  });
});
