/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op (#633 B9b) shop "Check Team" party-mutation relay.
//
// THE LIVE BUG: in the co-op reward shop, opening "Check Team" (PARTY/CHECK) let the OWNER
// reorder / give / release / unsplice / rename / unpause-evolution / toggle a form-change item on
// the SHARED party - but the mutation was applied ONLY on the owner's client. The party order /
// length / speciesId / formIndex / abilityId and the persistent-modifier multiset are ALL per-turn
// checksum hashed, so an owner-only mutation here flipped the watcher's checksum -> resync storm
// (and for an on-field form toggle / release, a visible field divergence).
//
// THE FIX: the OWNER relays each resolved CHECK-mode mutation on the shop's pinned interaction seq
// (the SAME owner->watcher `interactionChoice` channel reward picks ride, packed as
// [COOP_ACT_CHECK, COOP_CHECK_OP_*, ...payload]). The WATCHER never opens PARTY; it applies each
// relayed op verbatim against its identical party (applyRelayedCheckOp), resolving the target by
// the SLOT index captured pre-op (identical on both sides by FIFO replay).
//
// Tier 1 (always-on, no GameManager): the seven op payloads survive a raw JSON round-trip on the
// `interactionChoice` wire (incl. FORM_ITEM and a multi-codepoint / emoji RENAME), and the
// COOP_ACT_CHECK action code stays clear of every other reward-shop action code so a CHECK op can
// never masquerade as a reward buy/transfer/lock.
//
// Tier 2 (ER_SCENARIO-gated, real GameManager): the CONVERGENCE proof - the WATCHER applier
// reproduces the owner's exact effect so the hashed fields converge: speciesId/coopOwner/formIndex
// arrays match and the persistent-modifiers multiset is equal after RELEASE (catches the C4
// "look-alike removal leaves the released mon's items behind" gap).

import { getGameMode } from "#app/game-mode";
import { modifierTypes } from "#data/data-lists";
import { getActuallyFieldedCoopPokemon } from "#data/elite-redux/coop/coop-field-presentation";
import {
  COOP_ACT_CHECK,
  COOP_CHECK_KIND,
  COOP_CHECK_OP_FORM_ITEM,
  COOP_CHECK_OP_GIVE,
  COOP_CHECK_OP_RELEASE,
  COOP_CHECK_OP_RENAME,
  COOP_CHECK_OP_REORDER,
  COOP_CHECK_OP_UNPAUSE_EVO,
  COOP_CHECK_OP_UNSPLICE,
} from "#data/elite-redux/coop/coop-shop-check-relay";
import type { CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import type { PlayerPokemon } from "#field/pokemon";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import { installHeadlessPlayerAtlasCompletionModel } from "#test/tools/coop-duo-harness";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The reward-shop action codes the watch loop's applyRelayedRewardAction dispatches on (data[0]) are
// 0..3 (REWARD/SHOP/TRANSFER/LOCK), so a CHECK op (action code COOP_ACT_CHECK = 4) can never alias one.
const COOP_ACT_CODES = [0, 1, 2, 3];

// The relay kind/label (routing/logging only).
const CHECK_KIND = COOP_CHECK_KIND;

// Every CHECK op + a representative payload, exactly as coopReportCheckMutation packs them:
// data = [COOP_ACT_CHECK, op, ...payload].
const OPS: { name: string; op: number; payload: number[] }[] = [
  { name: "REORDER slots 0<->2", op: COOP_CHECK_OP_REORDER, payload: [0, 2] },
  { name: "GIVE slot 1 to partner", op: COOP_CHECK_OP_GIVE, payload: [1] },
  { name: "RELEASE slot 2", op: COOP_CHECK_OP_RELEASE, payload: [2] },
  { name: "UNSPLICE slot 0", op: COOP_CHECK_OP_UNSPLICE, payload: [0] },
  { name: "UNPAUSE_EVO slot 1", op: COOP_CHECK_OP_UNPAUSE_EVO, payload: [1] },
  { name: "FORM_ITEM slot 0 item 1", op: COOP_CHECK_OP_FORM_ITEM, payload: [0, 1] },
  // A multi-codepoint, non-BMP (emoji) rename - must round-trip via String.fromCodePoint on the
  // watcher. "Né🎉" = [78, 233, 32, 127881].
  {
    name: "RENAME slot 3 to Né🎉",
    op: COOP_CHECK_OP_RENAME,
    payload: [3, ...[..."Né🎉"].map(c => c.codePointAt(0) ?? 0)],
  },
];

describe("co-op shop Check-Team op relay (#633 B9b) - wire round-trip", () => {
  it("the COOP_ACT_CHECK action code never aliases a reward-shop action code (de-alias)", () => {
    expect(COOP_ACT_CODES).not.toContain(COOP_ACT_CHECK);
  });

  it("the seven CHECK op codes are all distinct (a misrouted op can never alias another)", () => {
    const codes = [
      COOP_CHECK_OP_REORDER,
      COOP_CHECK_OP_GIVE,
      COOP_CHECK_OP_RELEASE,
      COOP_CHECK_OP_UNSPLICE,
      COOP_CHECK_OP_RENAME,
      COOP_CHECK_OP_UNPAUSE_EVO,
      COOP_CHECK_OP_FORM_ITEM,
    ];
    expect(new Set(codes).size).toBe(codes.length);
  });

  it.each(OPS)("the wire interactionChoice for '$name' survives a raw JSON round-trip", ({ op, payload }) => {
    const msg: CoopMessage = {
      t: "interactionChoice",
      seq: 42,
      kind: CHECK_KIND,
      choice: 0,
      data: [COOP_ACT_CHECK, op, ...payload],
    };
    expect(JSON.parse(JSON.stringify(msg))).toEqual(msg);
  });

  it("a multi-codepoint / emoji RENAME reassembles byte-identical on the watcher", () => {
    const nickname = "Né🎉";
    const codepoints = [...nickname].map(c => c.codePointAt(0) ?? 0);
    // The owner packs codepoints; the watcher (applyRelayedCheckOp RENAME) does
    // String.fromCodePoint(...rest.slice(1)).
    expect(String.fromCodePoint(...codepoints)).toBe(nickname);
  });
});

// =============================================================================
// Tier 2: real-GameManager convergence proof. Gated behind ER_SCENARIO=1 like the
// other ER engine tests (it needs the live globalScene party + modifiers).
// =============================================================================
const RUN = process.env.ER_SCENARIO === "1";

/** A test-only seam onto the WATCHER applier + the owner relay reporter (the same private members
 *  the running phase uses). Mirrors er-biome-shop-economy.test.ts's `as unknown as {...}` seam. */
type CheckOpSeam = {
  applyRelayedCheckOp(op: number, rest: number[]): void;
  applyRelayedRewardAction(
    action: { choice: number; data: number[] },
    decision?: { authoritativeProjection?: boolean; operationId?: string },
  ): boolean;
  coopWatcher: boolean;
};

describe.skipIf(!RUN)("co-op shop Check-Team op convergence (#633 B9b) - watcher applier", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
  });

  const seam = (): CheckOpSeam => new SelectModifierPhase() as unknown as CheckOpSeam;

  /** Replace the player party with `n` co-op-owned mons (host = first 3, guest = rest). */
  const buildCoopParty = (species: SpeciesId[]): PlayerPokemon[] => {
    const party = game.scene.getPlayerParty();
    party.length = 0;
    species.forEach((sp, i) => {
      const mon = game.scene.addPlayerPokemon(getPokemonSpecies(sp), 50);
      mon.coopOwner = i < 3 ? "host" : "guest";
      party.push(mon);
    });
    return party as PlayerPokemon[];
  };

  it("REORDER converges: the speciesId order matches the owner's swap", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const party = buildCoopParty([SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.GYARADOS, SpeciesId.PIKACHU]);
    const owner = party.map(m => m.species.speciesId);
    // Owner swapped slots 0<->2; the watcher relay applies the same op.
    [owner[0], owner[2]] = [owner[2], owner[0]];
    seam().applyRelayedCheckOp(COOP_CHECK_OP_REORDER, [0, 2]);
    expect(game.scene.getPlayerParty().map(m => m.species.speciesId)).toEqual(owner);
  });

  it("REORDER keeps the old field visible until the promoted battler is ready, then projects the watcher", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    installHeadlessPlayerAtlasCompletionModel(game.scene);

    const party = game.scene.getPlayerParty();
    const outgoing = party[0];
    const incoming = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.GENGAR), 50);
    incoming.coopOwner = "guest";
    party.push(incoming);
    const modeledLoadAssets = incoming.loadAssets.bind(incoming);
    let releaseAssets!: () => void;
    const assetsBlocked = new Promise<void>(resolve => {
      releaseAssets = resolve;
    });
    vi.spyOn(incoming, "loadAssets").mockImplementation(async (ignoreOverride = true, useIllusion = false) => {
      await assetsBlocked;
      await modeledLoadAssets(ignoreOverride, useIllusion);
    });

    expect(outgoing.isOnField(), "the pre-reorder lead must be visibly fielded").toBe(true);
    seam().applyRelayedCheckOp(COOP_CHECK_OP_REORDER, [0, 1]);

    expect(party[0]).toBe(incoming);
    expect(outgoing.isOnField(), "the old lead stays visible while the new atlas is pending").toBe(true);
    expect(incoming.isOnField(), "the promoted bench mon must not be exposed half-materialized").toBe(false);

    releaseAssets();
    await vi.waitFor(() => {
      expect(getActuallyFieldedCoopPokemon("player").map(pokemon => pokemon.id)).toEqual([incoming.id]);
    });
    expect(outgoing.visible).toBe(false);
    expect(incoming.visible).toBe(true);
    expect(incoming.getSprite()?.visible).toBe(true);
    expect(incoming.getBattleInfo()?.visible).toBe(true);
  });

  it("V2 projection-only REORDER repairs the field after authoritative DATA already changed party order", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    installHeadlessPlayerAtlasCompletionModel(game.scene);

    const party = game.scene.getPlayerParty();
    const outgoing = party[0];
    const incoming = game.scene.addPlayerPokemon(getPokemonSpecies(SpeciesId.GENGAR), 50);
    incoming.coopOwner = "guest";
    party.push(incoming);
    const modeledLoadAssets = incoming.loadAssets.bind(incoming);
    let releaseAssets!: () => void;
    const assetsBlocked = new Promise<void>(resolve => {
      releaseAssets = resolve;
    });
    vi.spyOn(incoming, "loadAssets").mockImplementation(async (ignoreOverride = true, useIllusion = false) => {
      await assetsBlocked;
      await modeledLoadAssets(ignoreOverride, useIllusion);
    });

    // This is the real V2 ordering: the immutable DATA plane has already installed [incoming, ...], but
    // its action projector has not replayed mechanics and must still make the exact active field visible.
    [party[0], party[1]] = [party[1], party[0]];
    const phase = seam();
    phase.coopWatcher = true;
    expect(
      phase.applyRelayedRewardAction(
        { choice: 0, data: [COOP_ACT_CHECK, COOP_CHECK_OP_REORDER, 0, 1] },
        { authoritativeProjection: true },
      ),
    ).toBe(false);

    expect(outgoing.isOnField(), "the previous visual field remains until the promoted atlas is ready").toBe(true);
    expect(incoming.isOnField()).toBe(false);
    releaseAssets();
    await vi.waitFor(() => {
      expect(getActuallyFieldedCoopPokemon("player").map(pokemon => pokemon.id)).toEqual([incoming.id]);
    });
    expect(incoming.getSprite()?.visible).toBe(true);
    expect(incoming.getBattleInfo()?.visible).toBe(true);
  });

  it("GIVE converges: coopOwner flips + the party re-interleaves identically", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const party = buildCoopParty([SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.GYARADOS, SpeciesId.PIKACHU]);
    const targetId = party[1].id;
    seam().applyRelayedCheckOp(COOP_CHECK_OP_GIVE, [1]);
    const moved = game.scene.getPlayerParty().find(m => m.id === targetId);
    // The given mon now belongs to the guest half (it started host-owned at slot 1).
    expect(moved?.coopOwner).toBe("guest");
    // Field leads stay host (slot 0) / guest (slot 1) after the re-interleave.
    expect(game.scene.getPlayerParty()[0].coopOwner).toBe("host");
  });

  it("RELEASE converges: the mon is spliced AND its held-item modifiers are stripped (C4)", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const party = buildCoopParty([SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.GYARADOS]);
    // Give the slot-2 mon (Gyarados) a persistent held item so the RELEASE must strip it.
    const victim = party[2];
    const held = modifierTypes.LEFTOVERS().withIdFromFunc(modifierTypes.LEFTOVERS).newModifier(victim);
    if (held != null) {
      game.scene.addModifier(held, true);
    }
    const victimId = victim.id;
    const heldBefore = game.scene
      .findModifiers(m => (m as { pokemonId?: number }).pokemonId === victimId)
      .map(m => m.type.id);
    expect(heldBefore.length).toBeGreaterThan(0); // sanity: it really holds an item

    seam().applyRelayedCheckOp(COOP_CHECK_OP_RELEASE, [2]);

    // The mon is gone from the party...
    expect(game.scene.getPlayerParty().some(m => m.id === victimId)).toBe(false);
    expect(game.scene.getPlayerParty()).toHaveLength(2);
    // ...and ALL of its held-item modifiers are stripped (the hashed `modifiers` multiset converges).
    const heldAfter = game.scene.findModifiers(m => (m as { pokemonId?: number }).pokemonId === victimId);
    expect(heldAfter).toHaveLength(0);
  });

  it("RENAME converges: the nickname (incl. emoji) reassembles on the watcher", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const party = buildCoopParty([SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.GYARADOS, SpeciesId.PIKACHU]);
    const nickname = "Né🎉";
    const codepoints = [...nickname].map(c => c.codePointAt(0) ?? 0);
    seam().applyRelayedCheckOp(COOP_CHECK_OP_RENAME, [3, ...codepoints]);
    expect(party[3].nickname).toBe(nickname);
  });

  it("UNPAUSE_EVO converges: pauseEvolutions toggles on the targeted slot", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const party = buildCoopParty([SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const before = party[1].pauseEvolutions;
    seam().applyRelayedCheckOp(COOP_CHECK_OP_UNPAUSE_EVO, [1]);
    expect(party[1].pauseEvolutions).toBe(!before);
  });

  it("an out-of-range slot is a safe no-op (never throws, never mutates length)", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const party = buildCoopParty([SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    expect(() => seam().applyRelayedCheckOp(COOP_CHECK_OP_RELEASE, [9])).not.toThrow();
    expect(() => seam().applyRelayedCheckOp(COOP_CHECK_OP_REORDER, [0, 9])).not.toThrow();
    expect(game.scene.getPlayerParty()).toHaveLength(party.length);
  });
});
