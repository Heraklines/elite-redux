/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op per-player 3-mon cap (#633, P1g). The shared 6-slot party is split
// between two players (host + guest), each owning up to COOP_SLOTS_PER_PLAYER.
// The maintainer's rule: "no one can suddenly have a team of six if they start
// with three" - a player at 3 can NEVER reach 4 via catching / evolution /
// trade / ME rewards.
//
// Two tiers:
//   1. The pure ownership predicate (coopOwnedCount / coopHalfIsFull /
//      coopAttributeNewMon) - engine-free, always runs.
//   2. The runtime chokepoint (PlayerPokemon.addToParty) + the coopOwner save
//      round-trip (PokemonData serialize -> deserialize) - needs the real
//      GameManager, so gated behind ER_SCENARIO=1 like the other ER engine tests.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import {
  COOP_SLOTS_PER_PLAYER,
  type CoopOwnedMon,
  coopAttributeNewMon,
  coopGiveToPartner,
  coopHalfIsFull,
  coopInterleaveOrder,
  coopOwnedCount,
  setCoopCatchThrowerHint,
} from "#data/elite-redux/coop/coop-session";
import { GameModes } from "#enums/game-modes";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const host = (): CoopOwnedMon => ({ coopOwner: "host" });
const guest = (): CoopOwnedMon => ({ coopOwner: "guest" });
const untagged = (): CoopOwnedMon => ({});

describe("co-op per-player party cap (#633, P1g) - pure predicate", () => {
  it("counts only the mons owned by the given side (untagged mons never count)", () => {
    const party: CoopOwnedMon[] = [host(), host(), guest(), untagged()];
    expect(coopOwnedCount(party, "host")).toBe(2);
    expect(coopOwnedCount(party, "guest")).toBe(1);
    expect(coopOwnedCount([], "host")).toBe(0);
  });

  it("coopHalfIsFull flips exactly at COOP_SLOTS_PER_PLAYER", () => {
    expect(COOP_SLOTS_PER_PLAYER).toBe(3);
    const two: CoopOwnedMon[] = [host(), host()];
    expect(coopHalfIsFull(two, "host")).toBe(false);
    const three: CoopOwnedMon[] = [host(), host(), host()];
    expect(coopHalfIsFull(three, "host")).toBe(true);
    // The other half is unaffected by a full host half.
    expect(coopHalfIsFull(three, "guest")).toBe(false);
  });

  it("attribution: empty halves prefer host, then balance, then the half with room", () => {
    expect(coopAttributeNewMon([])).toBe("host"); // ties -> host
    expect(coopAttributeNewMon([host()])).toBe("guest"); // host ahead -> give to guest
    expect(coopAttributeNewMon([host(), guest()])).toBe("host"); // even -> host
    // Host full, guest has room -> guest.
    expect(coopAttributeNewMon([host(), host(), host()])).toBe("guest");
    // Guest full, host has room -> host.
    expect(coopAttributeNewMon([guest(), guest(), guest()])).toBe("host");
  });

  it("attribution returns null only when BOTH halves are full (the hard block)", () => {
    const full: CoopOwnedMon[] = [host(), host(), host(), guest(), guest(), guest()];
    expect(coopAttributeNewMon(full)).toBeNull();
  });

  it("attribution: the BALL-THROWER hint wins while their half has room (#800 'my Dracovish counted as the host's')", () => {
    try {
      // Balance alone would give this catch to the emptier HOST half - but the GUEST threw the ball.
      setCoopCatchThrowerHint("guest");
      expect(coopAttributeNewMon([host(), guest()])).toBe("guest");
      expect(coopAttributeNewMon([])).toBe("guest");
      // The thrower's half being FULL falls back to the balance rule (host has room).
      expect(coopAttributeNewMon([guest(), guest(), guest()])).toBe("host");
      // Both full still hard-blocks.
      expect(coopAttributeNewMon([host(), host(), host(), guest(), guest(), guest()])).toBeNull();
      // Hint cleared -> pure balance again.
      setCoopCatchThrowerHint(null);
      expect(coopAttributeNewMon([host(), guest()])).toBe("host");
    } finally {
      setCoopCatchThrowerHint(null);
    }
  });
});

describe("co-op give-to-partner + interleave (#633, P3) - pure", () => {
  it("allows a give when the giver has a spare mon and the partner has room", () => {
    // Both sides hold 2 (a spare each) -> either may give to the other.
    const party: CoopOwnedMon[] = [host(), host(), guest(), guest()];
    expect(coopGiveToPartner(party, "host")).toEqual({ ok: true });
    expect(coopGiveToPartner(party, "guest")).toEqual({ ok: true });
  });

  it("rejects giving the giver's LAST mon (each player must keep at least one)", () => {
    const party: CoopOwnedMon[] = [host(), guest(), guest()];
    expect(coopGiveToPartner(party, "host")).toEqual({ ok: false, reason: "last-mon" });
  });

  it("rejects a give when the partner's half is already full", () => {
    // host has 2 (a spare), but guest is at the 3-cap -> no room to receive.
    const party: CoopOwnedMon[] = [host(), host(), guest(), guest(), guest()];
    expect(coopGiveToPartner(party, "host")).toEqual({ ok: false, reason: "partner-full" });
  });

  it("rejects giving an untagged (non-co-op) mon", () => {
    expect(coopGiveToPartner([host(), host()], undefined)).toEqual({ ok: false, reason: "not-owned" });
  });

  it("interleaves into host0, guest0, host1, ... so the two leads are one of each", () => {
    // Label mons so we can assert order survives the interleave.
    const h0 = { coopOwner: "host" as const, id: "h0" };
    const h1 = { coopOwner: "host" as const, id: "h1" };
    const h2 = { coopOwner: "host" as const, id: "h2" };
    const g0 = { coopOwner: "guest" as const, id: "g0" };
    const g1 = { coopOwner: "guest" as const, id: "g1" };
    // Deliberately host-first (the un-interleaved launch order).
    const order = coopInterleaveOrder([h0, h1, h2, g0, g1]);
    expect(order.map(m => m.id)).toEqual(["h0", "g0", "h1", "g1", "h2"]);
    // The two field leads (index 0/1) are one host and one guest.
    expect(order[0].coopOwner).toBe("host");
    expect(order[1].coopOwner).toBe("guest");
  });

  it("interleave keeps untagged mons (never silently dropped), appended last", () => {
    const h0 = { coopOwner: "host" as const, id: "h0" };
    const g0 = { coopOwner: "guest" as const, id: "g0" };
    const u = { id: "u" } as CoopOwnedMon & { id: string };
    const order = coopInterleaveOrder([h0, u, g0]);
    expect(order.map(m => m.id)).toEqual(["h0", "g0", "u"]);
  });
});

describe.skipIf(!RUN)("co-op per-player party cap (#633, P1g) - runtime + save round-trip", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  /** Replace the player party with `n` host-owned mons (the "started with 3" setup). */
  const fillHostParty = (n: number): void => {
    const party = game.scene.getPlayerParty();
    party.length = 0;
    for (let i = 0; i < n; i++) {
      const mon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 5);
      mon.coopOwner = "host";
      party.push(mon);
    }
  };

  it("a HOST half at 3 can never grow to 4: catches divert to the guest, then block", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    expect(game.scene.gameMode.isCoop).toBe(true);

    fillHostParty(COOP_SLOTS_PER_PLAYER); // host = 3, guest = 0
    expect(coopOwnedCount(game.scene.getPlayerParty(), "host")).toBe(3);

    const enemy = game.field.getEnemyPokemon();

    // 1st extra catch with the host half full -> diverted to the GUEST, NOT a 4th
    // host mon. The host's half is the hard wall the maintainer asked for.
    const first = enemy.addToParty(PokeballType.POKEBALL);
    expect(first).not.toBeNull();
    expect(first?.coopOwner).toBe("guest");
    expect(coopOwnedCount(game.scene.getPlayerParty(), "host")).toBe(3); // still 3, never 4

    // Fill the guest half too (catch twice more) -> guest reaches its own cap.
    enemy.addToParty(PokeballType.POKEBALL);
    enemy.addToParty(PokeballType.POKEBALL);
    expect(coopOwnedCount(game.scene.getPlayerParty(), "guest")).toBe(3);
    expect(game.scene.getPlayerParty()).toHaveLength(6);

    // Both halves now full -> the next catch is hard-blocked (no 7th, host still 3).
    const blocked = enemy.addToParty(PokeballType.POKEBALL);
    expect(blocked).toBeNull();
    expect(game.scene.getPlayerParty()).toHaveLength(6);
    expect(coopOwnedCount(game.scene.getPlayerParty(), "host")).toBe(3);
  });

  it("solo mode is unaffected: a 6th catch still adds (per-owner cap never applies)", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    // gameMode stays CLASSIC (not co-op): isCoop is falsy.
    expect(game.scene.gameMode.isCoop).toBeFalsy();

    const party = game.scene.getPlayerParty();
    party.length = 0;
    for (let i = 0; i < 5; i++) {
      party.push(game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 5));
    }
    expect(party).toHaveLength(5);

    const enemy = game.field.getEnemyPokemon();
    const added = enemy.addToParty(PokeballType.POKEBALL);

    expect(added).not.toBeNull();
    expect(added?.coopOwner).toBeUndefined(); // never tagged outside co-op
    expect(game.scene.getPlayerParty()).toHaveLength(6);
  });

  it("coopOwner survives a PokemonData serialize -> deserialize round-trip", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const guestMon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.BULBASAUR), 5);
    guestMon.coopOwner = "guest";

    // Serialize through the real save path: PlayerPokemon -> PokemonData -> JSON.
    const json = JSON.parse(JSON.stringify(new PokemonData(guestMon)));
    expect(json.coopOwner).toBe("guest");

    // Deserialize: JSON -> PokemonData -> PlayerPokemon. The tag must come back.
    const restoredData = new PokemonData(json);
    expect(restoredData.coopOwner).toBe("guest");
    const restored = restoredData.toPokemon();
    expect(restored.isPlayer()).toBe(true);
    expect((restored as { coopOwner?: string }).coopOwner).toBe("guest");

    // A non-co-op mon stays undefined and is dropped from the JSON (no bloat).
    const plainMon = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.CHARMANDER), 5);
    const plainJson = JSON.parse(JSON.stringify(new PokemonData(plainMon)));
    expect("coopOwner" in plainJson).toBe(false);
  });
});
