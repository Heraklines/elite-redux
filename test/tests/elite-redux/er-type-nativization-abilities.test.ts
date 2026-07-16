/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER type-nativization (Pass A) — new replacement abilities wiring.
//
// The 13 new abilities are composed from already-tested ER attr primitives
// (hit-multiplier, type-conversion, immunity-with-absorb, damage-reduction,
// attack-stat-substitute) + manual composites (union of constituents' attrs).
// This asserts each is REGISTERED in allAbilities with a name/description and the
// expected attr shape, so a wiring regression (missing id, empty attrs) is caught.
//
// Gated behind ER_SCENARIO=1 (boots init via GameManager).
// =============================================================================

import { allAbilities } from "#data/data-lists";
import {
  ER_ALLURING_SKULL_ABILITY_ID,
  ER_DRAGONFRUIT_ABILITY_ID,
  ER_FORMLESS_FIST_ABILITY_ID,
  ER_FREE_CLIMB_ABILITY_ID,
  ER_GRIEVOUS_SPEAR_ABILITY_ID,
  ER_GRIM_JAB_ABILITY_ID,
  ER_KOMODO_NATIVIZE_ABILITY_ID,
  ER_OMINOUS_SHROUD_ABILITY_ID,
  ER_PRICKLY_ARMOR_ABILITY_ID,
  ER_SAVAGE_SPEAR_ABILITY_ID,
  ER_SPECTACLE_ABILITY_ID,
  ER_VOLTRON_ABILITY_ID,
  ER_WATERBORNE_ABILITY_ID,
} from "#data/elite-redux/abilities/type-nativization-abilities";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const NEW_ABILITY_IDS: [number, string][] = [
  [ER_WATERBORNE_ABILITY_ID, "Waterborne"],
  [ER_DRAGONFRUIT_ABILITY_ID, "Dragonfruit"],
  [ER_KOMODO_NATIVIZE_ABILITY_ID, "Komodo"],
  [ER_VOLTRON_ABILITY_ID, "Voltron"],
  [ER_GRIEVOUS_SPEAR_ABILITY_ID, "Grievous Spear"],
  [ER_SPECTACLE_ABILITY_ID, "Spectacle"],
  [ER_OMINOUS_SHROUD_ABILITY_ID, "Ominous Shroud"],
  [ER_FREE_CLIMB_ABILITY_ID, "Free Climb"],
  [ER_SAVAGE_SPEAR_ABILITY_ID, "Savage Spear"],
  [ER_GRIM_JAB_ABILITY_ID, "Grim Jab"],
  [ER_ALLURING_SKULL_ABILITY_ID, "Alluring Skull"],
  [ER_FORMLESS_FIST_ABILITY_ID, "Formless Fist"],
  [ER_PRICKLY_ARMOR_ABILITY_ID, "Prickly Armor"],
];

describe.skipIf(!RUN)("ER type-nativization new abilities", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    void new GameManager(phaserGame);
  });

  it("all 13 new abilities are registered with the verbatim name + non-empty attrs", () => {
    for (const [id, name] of NEW_ABILITY_IDS) {
      const ability = allAbilities[id];
      expect(ability, `ability ${id} (${name}) registered`).toBeDefined();
      expect(ability.name).toBe(name);
      expect(ability.attrs.length, `${name} has attrs wired`).toBeGreaterThan(0);
    }
  });

  it("bespokes carry the expected attr classes", () => {
    const attrNames = (id: number) => allAbilities[id].attrs.map(a => a.constructor.name);

    // Savage Spear + Formless Fist: multi-hit + power-scale.
    expect(attrNames(ER_SAVAGE_SPEAR_ABILITY_ID)).toEqual(
      expect.arrayContaining(["HitMultiplierAbAttr", "HitMultiplierPowerAbAttr"]),
    );
    expect(attrNames(ER_FORMLESS_FIST_ABILITY_ID)).toEqual(
      expect.arrayContaining(["HitMultiplierAbAttr", "HitMultiplierPowerAbAttr", "AttackStatSubstituteAbAttr"]),
    );
    // Grim Jab: type conversion + power boost.
    expect(attrNames(ER_GRIM_JAB_ABILITY_ID)).toEqual(
      expect.arrayContaining(["TypeConversionAbAttr", "TypeConversionPowerBoostAbAttr"]),
    );
    // Alluring Skull: redirect + absorb-with-highest-atk-boost.
    expect(attrNames(ER_ALLURING_SKULL_ABILITY_ID)).toEqual(
      expect.arrayContaining(["RedirectTypeMoveAbAttr", "TypeAbsorbHighestAttackStatBoostAbAttr"]),
    );
    // Prickly Armor: contact-punish + damage reduction.
    expect(attrNames(ER_PRICKLY_ARMOR_ABILITY_ID)).toEqual(
      expect.arrayContaining(["PostDefendContactDamageAbAttr", "DamageReductionAbAttr"]),
    );
  });
});
