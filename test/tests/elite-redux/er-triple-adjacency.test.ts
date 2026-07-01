/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Multi-format battles - POSITIONAL ADJACENCY in triple move targeting (the
// defining triple mechanic). In a 3v3, a WING reaches only the foe opposite it +
// the centre, NOT the far diagonal; the CENTRE reaches every foe. Two bypass
// classes hit the whole field regardless of position: FLYING-type moves and
// PULSE moves. Spread NEAR moves are likewise limited to the adjacent foes.
//
// Player slots 0(L)/1(C)/2(R) -> flat 0/1/2; enemy 0/1/2 -> flat 3/4/5. The rows
// are a direct (non-mirrored) face-off, so player-left (0) reaches the foe IN FRONT
// of it, enemy-left(3), + the centre(4), but NOT the far enemy-right(5). ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { getMoveTargets } from "#data/moves/move-utils";
import { AbilityId } from "#enums/ability-id";
import { FieldPosition } from "#enums/field-position";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER triple battles - positional adjacency in move targeting", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("triple")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .startingLevel(50)
      .enemyLevel(50);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a wing can't hit the far diagonal; the centre hits all foes; flying/spread obey the rules", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);

    const players = globalScene.getPlayerField();
    const wing = players[0]; // flat index 0 (LEFT)
    const centre = players[1]; // flat index 1 (CENTRE)
    expect(wing.getBattlerIndex()).toBe(0);
    expect(centre.getBattlerIndex()).toBe(1);

    // Sanity: the enemy side is flat 3/4/5.
    const enemies = globalScene.getEnemyField();
    expect(enemies.map(e => e.getBattlerIndex())).toEqual([3, 4, 5]);

    // (1) Wing single-target (Tackle = NEAR_OTHER, Normal): reaches the foe IN FRONT,
    // enemy-left(3), + centre(4) but NOT the far enemy-right(5).
    const wingTackle = getMoveTargets(wing, MoveId.TACKLE).targets;
    expect(wingTackle).toContain(3);
    expect(wingTackle).toContain(4);
    expect(wingTackle).not.toContain(5);

    // (2) Centre single-target: reaches ALL three foes.
    const centreTackle = getMoveTargets(centre, MoveId.TACKLE).targets;
    expect(centreTackle).toContain(3);
    expect(centreTackle).toContain(4);
    expect(centreTackle).toContain(5);

    // (3) Wing FLYING move (Gust) bypasses adjacency -> the far foe is now reachable.
    const wingGust = getMoveTargets(wing, MoveId.GUST).targets;
    expect(wingGust).toContain(3);
    expect(wingGust).toContain(4);
    expect(wingGust).toContain(5);

    // (4) Wing SPREAD move (Rock Slide = ALL_NEAR_ENEMIES, Rock) is limited to adjacent
    // foes - it hits the foe in front(3) + centre(4), NOT the far diagonal(5).
    const wingRockSlide = getMoveTargets(wing, MoveId.ROCK_SLIDE);
    expect(wingRockSlide.multiple).toBe(true);
    expect(wingRockSlide.targets).toContain(3);
    expect(wingRockSlide.targets).toContain(4);
    expect(wingRockSlide.targets).not.toContain(5);

    // (5) Centre SPREAD move hits all three foes.
    const centreRockSlide = getMoveTargets(centre, MoveId.ROCK_SLIDE).targets;
    expect(centreRockSlide).toEqual(expect.arrayContaining([3, 4, 5]));
  });

  it("the player sprites sit at LEFT/CENTRE/RIGHT matching their battler index", async () => {
    // Regression: the summon positioned the player mons with a binary `fieldIndex===1?RIGHT`
    // rule, so a triple mis-slotted them (flat 1 -> RIGHT, flat 0/2 -> CENTRE). The SPRITES
    // then no longer matched the index-based targeting adjacency, so a spread move looked like
    // it hit the wrong ally. The three field slots must line up with battler index 0/1/2.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);
    const players = globalScene.getPlayerField();
    expect(players.map(p => p.getBattlerIndex())).toEqual([0, 1, 2]);
    expect(players[0].fieldPosition).toBe(FieldPosition.LEFT);
    expect(players[1].fieldPosition).toBe(FieldPosition.CENTER);
    expect(players[2].fieldPosition).toBe(FieldPosition.RIGHT);
  });

  it("getAdjacentOpponents / getAdjacentAllies respect triple placement (the ability-fix foundation)", async () => {
    // These helpers back every placement-dependent ability fix (Intimidate-family, Cotton Down,
    // Download, Trace, Battery/Power Spot, ...). A wing reaches the foe in front + centre, not
    // the far foe; the centre reaches all. Ally-side: a wing is adjacent to the centre only.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU, SpeciesId.EEVEE);
    const players = globalScene.getPlayerField();
    const bi = (arr: { getBattlerIndex: () => number }[]) => arr.map(p => p.getBattlerIndex()).sort((a, b) => a - b);

    expect(bi(players[0].getAdjacentOpponents())).toEqual([3, 4]); // LEFT wing -> front + centre
    expect(bi(players[1].getAdjacentOpponents())).toEqual([3, 4, 5]); // centre -> all foes
    expect(bi(players[2].getAdjacentOpponents())).toEqual([4, 5]); // RIGHT wing -> centre + front

    expect(bi(players[0].getAdjacentAllies())).toEqual([1]); // LEFT wing <-> centre only
    expect(bi(players[1].getAdjacentAllies())).toEqual([0, 2]); // centre <-> both wings
    expect(bi(players[2].getAdjacentAllies())).toEqual([1]); // RIGHT wing <-> centre only

    // The enemy side mirrors it (both sides use the same arrangement): a foe wing reaches the
    // player in front + centre and is adjacent only to the centre foe; the centre foe reaches all.
    const foes = globalScene.getEnemyField();
    expect(bi(foes[0].getAdjacentOpponents())).toEqual([0, 1]); // enemy LEFT -> player LEFT + centre
    expect(bi(foes[1].getAdjacentOpponents())).toEqual([0, 1, 2]); // enemy centre -> all players
    expect(bi(foes[2].getAdjacentOpponents())).toEqual([1, 2]); // enemy RIGHT -> player centre + RIGHT
    expect(bi(foes[0].getAdjacentAllies())).toEqual([4]); // enemy LEFT <-> enemy centre
    expect(bi(foes[1].getAdjacentAllies())).toEqual([3, 5]); // enemy centre <-> both enemy wings
    expect(bi(foes[2].getAdjacentAllies())).toEqual([4]); // enemy RIGHT <-> enemy centre
  });
});
