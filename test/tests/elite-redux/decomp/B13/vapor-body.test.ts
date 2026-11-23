/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B13 chunk 2: Vapor Body (5981). The engine finds the marker by class name inside applyVaporBodyAccuracy, so these
// probes call that helper with the original attr and with its rebuild standing in as the target's attr.
import { allMoves } from "#data/data-lists";
import {
  applyVaporBodyAccuracy,
  type VaporBodyAccuracyAbAttr,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { buildAttr, recomposeAttr } from "#data/elite-redux/ability-studio/build-attr";
import { declRegistry } from "#data/elite-redux/ability-studio/decl-registry";
import { MoveId } from "#enums/move-id";
import { startWorld } from "#test/tests/elite-redux/decomp/harness/game";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, describe, expect, it, vi } from "vitest";

const VAPOR_BODY = 5981;

function module(name: string) {
  const found = declRegistry.get(name);
  expect(found, `${name} must be declared`).toBeDefined();
  return found!;
}

describe("B13 Vapor Body", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("contact moves aimed at the holder have 0.7x accuracy, other moves and never-miss values are untouched; the rebuild agrees", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const original = liveAbility(VAPOR_BODY).attrs[0] as VaporBodyAccuracyAbAttr;
    expect(original.accuracyMultiplier).toBe(0.7);
    const rebuilt = recomposeAttr(
      module("VaporBodyAccuracyAbAttr"),
      original,
      VAPOR_BODY,
      0,
    ) as VaporBodyAccuracyAbAttr;
    expect(rebuilt).not.toBe(original);
    const accuracyWith = (attr: VaporBodyAccuracyAbAttr | undefined, moveId: MoveId, start = 100): number => {
      const spy = vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue((attr ? [attr] : []) as never);
      const accuracy = new NumberHolder(start);
      applyVaporBodyAccuracy(foe, holder, allMoves[moveId], accuracy);
      spy.mockRestore();
      return accuracy.value;
    };
    for (const attr of [original, rebuilt]) {
      expect(accuracyWith(attr, MoveId.TACKLE)).toBe(100 * 0.7);
      expect(accuracyWith(attr, MoveId.WATER_GUN)).toBe(100);
      expect(accuracyWith(attr, MoveId.TACKLE, 0)).toBe(0);
      expect(accuracyWith(attr, MoveId.TACKLE, -1)).toBe(-1);
    }
    // Without the attr nothing changes.
    expect(accuracyWith(undefined, MoveId.TACKLE)).toBe(100);
  });

  it("the multiplier and the condition are replaceable (another multiplier, any move instead of contact)", async () => {
    const { holder, foe } = await startWorld(phaserGame);
    const custom = buildAttr(
      module("VaporBodyAccuracyAbAttr"),
      { accuracyMultiplier: 0.5 },
      { "ctor:0": () => true },
    ) as VaporBodyAccuracyAbAttr;
    const spy = vi.spyOn(holder, "getAllActiveAbilityAttrs").mockReturnValue([custom] as never);
    const contact = new NumberHolder(100);
    const noContact = new NumberHolder(100);
    applyVaporBodyAccuracy(foe, holder, allMoves[MoveId.TACKLE], contact);
    applyVaporBodyAccuracy(foe, holder, allMoves[MoveId.WATER_GUN], noContact);
    spy.mockRestore();
    expect(contact.value).toBe(50);
    expect(noContact.value).toBe(50);
  });
});
