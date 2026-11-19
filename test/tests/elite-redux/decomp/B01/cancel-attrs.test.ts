/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 proof for the attrs that no shared L2 template reaches: BlockRecoilDamageAttr (Rock Head), BlockItemTheftAbAttr
// (Sticky Hold) and PreDefendFullHpEndureAbAttr's lethal-hit case (Sturdy). Each runs the original and its rebuild
// through a real battle with the same pinned seed and compares the traces, and each ALSO runs a mutation: the rebuild
// without the attr must differ, so a vacuous scenario cannot pass.
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { twinRebuild } from "#test/tests/elite-redux/decomp/B01/twin-helpers";
import type { ScenarioSpec } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { TEMPLATES, use } from "#test/tests/elite-redux/decomp/harness/scenarios";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RECOIL: ScenarioSpec = {
  ...TEMPLATES["holder-hits-foe"],
  id: "b01-recoil",
  label: "The holder uses Double-Edge on a sturdy foe",
  holderMoves: [MoveId.DOUBLE_EDGE, MoveId.CELEBRATE, MoveId.TACKLE, MoveId.SWORDS_DANCE],
  turns: [use(MoveId.DOUBLE_EDGE), use(MoveId.DOUBLE_EDGE)],
};

const THEFT: ScenarioSpec = {
  ...TEMPLATES["foe-removes-item"],
  id: "b01-trick",
  label: "The enemy uses Trick on a holder that carries a berry",
  foeMoves: [MoveId.TRICK],
};

// A weak holder (Magikarp) against a strong foe, so the enemy's hit would knock the full-HP holder out.
const LETHAL: ScenarioSpec = {
  ...TEMPLATES["foe-hits-holder"],
  id: "b01-lethal-hit",
  label: "A level 100 Snorlax hits a full-HP Magikarp with a move that would knock it out",
  holder: SpeciesId.MAGIKARP,
  foe: SpeciesId.SNORLAX,
  foeLevel: 100,
  foeMoves: [MoveId.BODY_SLAM],
  holderMoves: [MoveId.CELEBRATE, MoveId.SPLASH, MoveId.TACKLE, MoveId.SWORDS_DANCE],
  turns: [{ move: MoveId.CELEBRATE }],
};

describe("B01 cancel attrs, real battles", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  it("Rock Head: the rebuilt BlockRecoilDamageAttr takes no recoil, exactly like the original", async () => {
    const same = await twinRebuild(phaserGame, AbilityId.ROCK_HEAD, RECOIL, {
      attrs: [{ attrIndex: 0, className: "BlockRecoilDamageAttr" }],
    });
    expect(same.rebuiltAttrs).toContain(0);
    expect(same.report).toBe("");
    // Mutation: without the attr the holder takes recoil, so the traces must differ.
    const mutated = await twinRebuild(phaserGame, AbilityId.ROCK_HEAD, RECOIL, {
      attrs: [],
      drop: [0],
    });
    expect(mutated.outcome.differences.length).toBeGreaterThan(0);
  });

  it("Sticky Hold: the rebuilt BlockItemTheftAbAttr stops Trick, exactly like the original", async () => {
    const same = await twinRebuild(phaserGame, AbilityId.STICKY_HOLD, THEFT, {
      attrs: [{ attrIndex: 0, className: "BlockItemTheftAbAttr" }],
    });
    expect(same.rebuiltAttrs).toContain(0);
    expect(same.report).toBe("");
    const mutated = await twinRebuild(phaserGame, AbilityId.STICKY_HOLD, THEFT, { attrs: [], drop: [0] });
    expect(mutated.outcome.differences.length).toBeGreaterThan(0);
  });

  it("Sturdy: the rebuilt PreDefendFullHpEndureAbAttr leaves 1 HP after a lethal hit, exactly like the original", async () => {
    const same = await twinRebuild(phaserGame, AbilityId.STURDY, LETHAL, {
      attrs: [{ attrIndex: 0, className: "PreDefendFullHpEndureAbAttr" }],
    });
    expect(same.rebuiltAttrs).toContain(0);
    expect(same.report).toBe("");
    const mutated = await twinRebuild(phaserGame, AbilityId.STURDY, LETHAL, { attrs: [], drop: [0] });
    expect(mutated.outcome.differences.length).toBeGreaterThan(0);
  });
});
