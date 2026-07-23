/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — the newcomer signature batch (5971-5998) introduces two per-side
// field effects that a tester found INVISIBLE in the battle info flyout:
//   - Sediment Bloom (5976): drains the enemy's HP each turn.
//   - Grave Marker   (Boot Hill 5985): a one-use entry marker on the foe's side.
// They were stored in module-level Maps, so they never dispatched a TAG_ADDED
// event and never reached the flyout (and were lost on a mid-battle save). They
// are now real, per-side, serializable ArenaTags. This proves:
//   1. the flyout naming seam (`getFieldEffectText`) resolves each to a proper
//      label (not blank / not a raw i18n key), and
//   2. the planting paths create a real ArenaTag on the correct side and fire a
//      TAG_ADDED event (which is exactly what the flyout listens to).
// =============================================================================

import {
  ER_CRACKED_VESSEL_ABILITY_ID,
  ER_SEDIMENT_BLOOM_ABILITY_ID,
} from "#data/elite-redux/abilities/newcomer-signature-abilities";
import {
  applyGraveMarkerOnEntry,
  notifyHazardRemovedBy,
  processSedimentBlooms,
} from "#data/elite-redux/abilities/newcomer-signature-mechanics";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { WeatherType } from "#enums/weather-type";
import { ArenaEventType, TagAddedEvent } from "#events/arena";
import { GameManager } from "#test/framework/game-manager";
import { getFieldEffectText } from "#ui/containers/arena-flyout";
import "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe("ER - signature arena-tag flyout display (naming seam)", () => {
  it("resolves Sediment Bloom to a proper flyout label, not blank or a raw key", () => {
    const name = getFieldEffectText(ArenaTagType.SEDIMENT_BLOOM);
    expect(name).toBe("Sediment Bloom");
    expect(name).not.toContain("arenaFlyout:");
  });

  it("resolves Grave Marker to a proper flyout label, not blank or a raw key", () => {
    const name = getFieldEffectText(ArenaTagType.GRAVE_MARKER);
    expect(name).toBe("Grave Marker");
    expect(name).not.toContain("arenaFlyout:");
  });

  it("resolves Inverse Room to a proper flyout label, not the raw camelCase key", () => {
    // Inverse Room is a field-wide tag set by signature ability 5998 (and the
    // move 844); it had no flyout entry, so it rendered as the raw key.
    const name = getFieldEffectText(ArenaTagType.INVERSE_ROOM);
    expect(name).toBe("Inverse Room");
    expect(name).not.toBe("inverseRoom");
  });

  it("resolves Eerie Fog to a proper flyout label, not the raw camelCase key", () => {
    // Eerie Fog is a pre-existing ER weather (Cracked Vessel, Final Season, Fog
    // Machine, ...) that had no flyout entry, so it rendered as the raw key.
    const name = getFieldEffectText(WeatherType[WeatherType.EERIE_FOG]);
    expect(name).toBe("Eerie Fog");
    expect(name).not.toBe("eerieFog");
  });
});

describe.skipIf(!RUN)("ER - signature arena-tag flyout display (behavior)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  it("Glam Rock's hazard consumption plants a real, flyout-visible Sediment Bloom on the enemy side", async () => {
    // The tester's Twinkletuff carries Sediment Bloom: when it consumes/removes an
    // entry hazard from its own side (Glam Rock's per-turn consume calls exactly this
    // seam), a Bloom is planted on the opposing side.
    game.override.ability(ER_SEDIMENT_BLOOM_ABILITY_ID as unknown as AbilityId);
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // No Bloom before, and capture the exact event the flyout subscribes to.
    expect(game.scene.arena.getTagOnSide(ArenaTagType.SEDIMENT_BLOOM, ArenaTagSide.ENEMY)).toBeUndefined();
    let addedForBloom = false;
    game.scene.arena.eventTarget.addEventListener(ArenaEventType.TAG_ADDED, (e: Event) => {
      if (e instanceof TagAddedEvent && e.arenaTagType === ArenaTagType.SEDIMENT_BLOOM) {
        addedForBloom = true;
      }
    });

    // Drive the Glam-Rock-equivalent removal seam.
    notifyHazardRemovedBy(player);

    const bloom = game.scene.arena.getTagOnSide(ArenaTagType.SEDIMENT_BLOOM, ArenaTagSide.ENEMY);
    expect(bloom, "a real Sediment Bloom arena tag must sit on the enemy side").toBeDefined();
    expect(addedForBloom, "the flyout's TAG_ADDED event must fire for the Bloom").toBe(true);
    // The flyout would render this exact label in the Enemy column.
    expect(getFieldEffectText(ArenaTagType.SEDIMENT_BLOOM)).toBe("Sediment Bloom");

    // And it still does its job: drains the enemy each turn.
    const before = enemy.hp;
    processSedimentBlooms();
    expect(enemy.hp).toBeLessThan(before);
  });

  it("a Grave Marker on the foe side is a real, flyout-visible tag and strikes the next entrant", async () => {
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA);

    const player = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    // Boot Hill plants the marker on the opposing side exactly like this.
    game.scene.arena.addTag(ArenaTagType.GRAVE_MARKER, 0, undefined, player.id, ArenaTagSide.ENEMY, true);
    const marker = game.scene.arena.getTagOnSide(ArenaTagType.GRAVE_MARKER, ArenaTagSide.ENEMY);
    expect(marker, "a real Grave Marker arena tag must sit on the enemy side").toBeDefined();
    expect(getFieldEffectText(ArenaTagType.GRAVE_MARKER)).toBe("Grave Marker");

    // The next foe entering that side is struck, and the one-use marker is spent.
    const before = enemy.hp;
    applyGraveMarkerOnEntry(enemy);
    expect(enemy.hp).toBeLessThan(before);
    expect(game.scene.arena.getTagOnSide(ArenaTagType.GRAVE_MARKER, ArenaTagSide.ENEMY)).toBeUndefined();
  });

  it("Cracked Vessel survives a lethal hit and raises the (now flyout-labeled) Eerie Fog", async () => {
    // Mechanic check: the signature-batch trigger (a direct hit that would KO)
    // must survive at 1 HP and set the ER-custom Eerie Fog weather.
    game.override.ability(ER_CRACKED_VESSEL_ABILITY_ID as unknown as AbilityId).enemyMoveset(MoveId.TACKLE);
    await game.classicMode.startBattle(SpeciesId.MIGHTYENA);

    const player = game.field.getPlayerPokemon();
    // Any direct hit is now lethal, forcing the once-per-battle trigger.
    player.hp = 5;

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(player.hp, "Cracked Vessel must survive the lethal hit at 1 HP").toBe(1);
    expect(game.scene.arena.weatherType, "Cracked Vessel must raise Eerie Fog").toBe(WeatherType.EERIE_FOG);
    // And the flyout resolves that weather to a proper label in the Field column.
    expect(getFieldEffectText(WeatherType[WeatherType.EERIE_FOG])).toBe("Eerie Fog");
  });
});
