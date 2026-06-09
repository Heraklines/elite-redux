/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#361) — Oricorio styles must carry their OWN ER ability kits.
// Pokerogue's form key for Pom-Pom is "pompom" while ER's species const is
// SPECIES_ORICORIO_POM_POM; the underscore mismatch made the per-form record
// lookup miss, so Pom-Pom (and only Pom-Pom) inherited Baile's kit — players
// fought an Electric/Flying dancer with Baile's FLASH FIRE innate instead of
// its own LIGHTNING ROD.
//
// ER v2.65 innate triples (vendor JSON):
//   Baile:   Serene Grace / Flash Fire    / Flock
//   Pom-Pom: Serene Grace / Lightning Rod / Flock
//   Pa'u:    Serene Grace / Psychic Mind  / Flock
//   Sensu:   Serene Grace / Phantom Pain  / Flock
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { AbilityId } from "#enums/ability-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Oricorio style abilities (#361)", () => {
  let phaserGame: Phaser.Game;
  // biome-ignore lint/correctness/noUnusedVariables: side-effectful full init
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  const passivesOf = (formKey: string): readonly AbilityId[] => {
    const form = getPokemonSpecies(SpeciesId.ORICORIO).forms.find(f => f.formKey === formKey);
    expect(form, `form ${formKey} exists`).toBeDefined();
    return (form as unknown as { _passives: readonly AbilityId[] | null })._passives ?? [];
  };

  it("Pom-Pom carries Lightning Rod (NOT Baile's Flash Fire)", () => {
    const passives = passivesOf("pompom");
    expect(passives).toContain(AbilityId.LIGHTNING_ROD);
    expect(passives).not.toContain(AbilityId.FLASH_FIRE);
  });

  it("Baile keeps Flash Fire; each style's middle innate is distinct", () => {
    expect(passivesOf("baile")).toContain(AbilityId.FLASH_FIRE);
    const middles = ["baile", "pompom", "pau", "sensu"].map(k => passivesOf(k)[1]);
    expect(new Set(middles).size).toBe(4);
  });
});
