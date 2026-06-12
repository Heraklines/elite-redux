/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// RDX mono-gen challenge (#408): the mono-generation challenge offers value 10
// ("RDX"), gating the run to Elite Redux customs (speciesId >= 10000). Gens
// 1-9 must NOT admit customs (they nominally carry generation 9), and the RDX
// value must keep the default fixed battles (no per-gen evil-team tables).
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { SingleGenerationChallenge } from "#data/challenge";
import { allSpecies } from "#data/data-lists";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { BooleanHolder } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER RDX mono-gen challenge (#408)", () => {
  let phaserGame: Phaser.Game;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    void new GameManager(phaserGame);
  });

  const erCustom = () => allSpecies.find(sp => sp.speciesId >= 10000 && sp.name === "Wooly Worm")!;

  it("offers RDX as value 10 and labels it", () => {
    const challenge = new SingleGenerationChallenge();
    expect(challenge.maxValue).toBe(10);
    challenge.value = 10;
    expect(challenge.getValue()).toBe("RDX");
  });

  it("RDX admits ER customs and rejects vanilla; gen 9 rejects ER customs", () => {
    const challenge = new SingleGenerationChallenge();
    challenge.value = 10;
    const valid = new BooleanHolder(true);
    challenge.applyStarterChoice(erCustom(), valid);
    expect(valid.value).toBe(true);
    challenge.applyStarterChoice(getPokemonSpecies(SpeciesId.SPRIGATITO), valid); // gen 9 vanilla
    expect(valid.value).toBe(false);

    challenge.value = 9;
    const valid9 = new BooleanHolder(true);
    challenge.applyStarterChoice(erCustom(), valid9);
    expect(valid9.value).toBe(false);
  });

  it("RDX keeps the default fixed battles (no out-of-range evil-team table reads)", () => {
    const challenge = new SingleGenerationChallenge();
    challenge.value = 10;
    // Any fixed wave: the challenge must decline to override (return false)
    // rather than index a 9-entry table at [9].
    expect(challenge.applyFixedBattle(115, {} as never)).toBe(false);
  });
});
