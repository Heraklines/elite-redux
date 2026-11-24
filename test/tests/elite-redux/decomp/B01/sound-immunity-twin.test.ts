/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 proof for the sound-move users of MoveImmunityAbAttr (Soundproof and Parroting). The shared probe of the class
// cannot contain a sound move: Parroting copies every sound move back at the foe, and the shared template's foe is a
// level 30 Magikarp, so the copy knocks it out, the battle ends and the L2 "all" run soft-locks at the reward screen.
// Here the foe is a level 100 Snorlax that survives the copy, and each user runs with a mutation (the rebuild without
// the immunity attr must differ, because the original blocks the sound move and the rebuild would take its damage).
import { MoveImmunityAbAttr } from "#abilities/ab-attrs";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { twinRebuild } from "#test/tests/elite-redux/decomp/B01/twin-helpers";
import type { ScenarioSpec } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { TEMPLATES } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const SOUND_HIT: ScenarioSpec = {
  ...TEMPLATES["foe-hits-holder"],
  id: "b01-sound-hit",
  label: "A level 100 Snorlax uses Hyper Voice on the holder",
  foe: SpeciesId.SNORLAX,
  foeLevel: 100,
  foeMoves: [MoveId.HYPER_VOICE],
};

/** Soundproof, and Parroting (ER id 5272). */
const SOUND_USERS: readonly number[] = [AbilityId.SOUNDPROOF, 5272];

describe("B01 sound immunity (MoveImmunityAbAttr), real battles", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  for (const id of SOUND_USERS) {
    it(`ability ${id}: the rebuilt immunity blocks Hyper Voice exactly like the original`, async () => {
      const ability = liveAbility(id);
      const attrIndex = ability.attrs.findIndex(attr => attr instanceof MoveImmunityAbAttr);
      expect(attrIndex, `${ability.name} has a MoveImmunityAbAttr`).toBeGreaterThanOrEqual(0);
      const attrs = [{ attrIndex, className: "MoveImmunityAbAttr" }];
      const same = await twinRebuild(phaserGame, id, SOUND_HIT, { attrs });
      expect(same.rebuiltAttrs).toContain(attrIndex);
      expect(same.report).toBe("");
      const mutated = await twinRebuild(phaserGame, id, SOUND_HIT, { attrs: [], drop: [attrIndex] });
      expect(mutated.outcome.differences.length, `${ability.name} without the attr`).toBeGreaterThan(0);
    });
  }
});
