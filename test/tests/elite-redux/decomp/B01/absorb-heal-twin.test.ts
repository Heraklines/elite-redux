/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B01 proof for the Water absorbers of TypeImmunityHealAbAttr. The shared probe of the class cannot contain Water Gun:
// one of the nine users, Desolate Sun (Ground absorber), makes the harsh sun fizzle every Water move before the attr is
// evaluated, so the L2 reach check of "all" mode would fail for it. The five Water users are therefore twinned here, in
// a real battle where a half-HP holder is hit by Water Gun, each with a mutation (the rebuild without the attr must
// differ, because the original heals and the foe's move does nothing).
import { TypeImmunityHealAbAttr } from "#abilities/ab-attrs";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { twinRebuild } from "#test/tests/elite-redux/decomp/B01/twin-helpers";
import type { ScenarioSpec } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { TEMPLATES } from "#test/tests/elite-redux/decomp/harness/scenarios";
import { liveAbility } from "#test/tests/elite-redux/decomp/harness/twin";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const WATER_HIT: ScenarioSpec = {
  ...TEMPLATES["foe-hits-holder"],
  id: "b01-water-hit",
  label: "The enemy uses Water Gun on a half-HP holder",
  foeMoves: [MoveId.WATER_GUN],
};

/** Water absorbers: Water Absorb, Dry Skin, Elemental Vortex, Reservoir, Old Ocean Relic. */
const WATER_USERS: readonly number[] = [AbilityId.WATER_ABSORB, AbilityId.DRY_SKIN, 5369, 5450, 20009];

describe("B01 Water absorbers (TypeImmunityHealAbAttr), real battles", () => {
  let phaserGame: Phaser.Game;
  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  for (const id of WATER_USERS) {
    it(`ability ${id}: the rebuilt absorber heals from Water Gun exactly like the original`, async () => {
      const ability = liveAbility(id);
      const attrIndex = ability.attrs.findIndex(
        attr => attr instanceof TypeImmunityHealAbAttr && attr.getImmuneType() === PokemonType.WATER,
      );
      expect(attrIndex, `${ability.name} has a Water absorber`).toBeGreaterThanOrEqual(0);
      const attrs = [{ attrIndex, className: "TypeImmunityHealAbAttr" }];
      const same = await twinRebuild(phaserGame, id, WATER_HIT, { attrs, axes: { hp: "50%" } });
      expect(same.rebuiltAttrs).toContain(attrIndex);
      expect(same.report).toBe("");
      const mutated = await twinRebuild(phaserGame, id, WATER_HIT, {
        attrs: [],
        drop: [attrIndex],
        axes: { hp: "50%" },
      });
      expect(mutated.outcome.differences.length, `${ability.name} without the attr`).toBeGreaterThan(0);
    });
  }
});
