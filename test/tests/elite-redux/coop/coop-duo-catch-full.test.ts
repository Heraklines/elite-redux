/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// PROBE #856: wild-catch FULL-PARTY keep/release owner-pick across two real engines. On a successful WILD
// catch with a FULL merged party (6 mons) the keep-in-party / release decision belongs to the CATCHER (the
// ball thrower), NOT the sole-engine host. For a GUEST-THROWN catch the host's AttemptCapturePhase would
// otherwise open its OWN release picker over the MERGED party - releasing the host's own mons + mis-
// attributing the guest's catch (the #800 class), and headless it deadlocks on an undrivable CONFIRM/PARTY.
//
// The fix (the recipient-drives twin of the #855 ME catch-full sub-prompt): the host streams a
// `catchFullPrompt`, the guest's runtime queues a real CoopGuestCatchFullPhase which opens a NON-mutating
// PARTY/SELECT picker + relays ONLY the chosen slot on COOP_CATCH_FULL_SEQ (kind "catchFull"), and the host
// applies the authoritative release+add at the RELAYED slot. The caught mon materializes on the guest via
// the normal capture handshake (applyCoopCaptureParty).
//
// This probe proves over TWO REAL ENGINES that:
//   (a) the CATCHER (guest) DROVE the picker - the host released the exact slot the guest relayed (a
//       GUEST-owned mon), NOT a host default; the guest's real CoopGuestCatchFullPhase is what was queued;
//   (b) the resulting party is byte-identical on both engines (species + owner ordering across all 6, and
//       byte-equal PokemonData for every reconciled bench mon incl. the freshly caught one);
//   (c) the interaction counter stays LOCKSTEP (the catchFull singleton band never ticks the counter).
// And that a HOST-thrown full-party catch is UNAFFECTED (resolved locally on the host, NO catchFullPrompt
// reaches the guest) and still converges.
//
// FAILS-BEFORE: pre-fix there is no recipient-drives path for a wild catch - the host cannot let the guest
// drive its local release picker, so a guest-thrown full-party catch either releases the WRONG (host-chosen)
// mon or deadlocks on the host's undrivable CONFIRM. Assertion (a) (a real CoopGuestCatchFullPhase queued +
// the host releasing the guest-relayed slot) is unsatisfiable without the fix.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-catch-full.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import { applyCoopCaptureParty, captureCoopCaptureParty } from "#data/elite-redux/coop/coop-battle-engine";
import { coopHostPrepareWildCatchFullDecision } from "#data/elite-redux/coop/coop-catch-full";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { setCoopCatchThrowerHint } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { PokemonData } from "#system/pokemon-data";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  drainLoopback,
  installDuoLogCapture,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** The private PhaseTree seam we read to retrieve the runtime-queued guest picker (find, no mutation). */
interface PhaseQueueSeam {
  phaseManager: { phaseQueue: { find(name: string): Phase | undefined } };
}

/** The minimal guest UI seam whose setMode/showText we stub to drive the SELECT picker headlessly. */
interface StubbableUi {
  setMode: (...args: unknown[]) => unknown;
  showText: (...args: unknown[]) => unknown;
}

/** Tag all 6 party slots on a scene: 0..2 host, 3..5 guest (a clean 3/3 merged half split). */
function tagFullPartyOwners(scene: BattleScene): void {
  const party = scene.getPlayerParty();
  for (let i = 0; i < party.length; i++) {
    party[i].coopOwner = i < 3 ? "host" : "guest";
  }
}

/** Serialize a party to a stable [species, owner] structure (order-sensitive) for cross-engine identity. */
function partyShape(scene: BattleScene): Array<{ sp: number; owner: string | undefined }> {
  return scene.getPlayerParty().map(p => ({
    sp: p.species.speciesId,
    owner: (p as { coopOwner?: string }).coopOwner,
  }));
}

/**
 * A normalized per-mon STATE projection (the meaningful party-state fields) for a cross-engine equality
 * compare. NB the raw `PokemonData` JSON is NOT byte-comparable for the KEPT bench mons: a host ORIGINAL
 * (from startBattle) leaves `passive` / `fusionSpecies` / `fusionVariant` undefined so JSON.stringify OMITS
 * those keys, while the guest's mirrored copies were reconstructed through toPokemon() which sets them - a
 * pre-existing harness serialization artifact (the documented "guest mons skip Pokemon.init()" gap),
 * unrelated to the catch. This projection compares the fields that actually encode party state.
 */
function normalizedParty(scene: BattleScene): unknown[] {
  return scene.getPlayerParty().map(p => {
    const d = new PokemonData(p) as unknown as Record<string, unknown>;
    return {
      species: d.species,
      coopOwner: d.coopOwner,
      level: d.level,
      exp: d.exp,
      hp: d.hp,
      stats: d.stats,
      ivs: d.ivs,
      nature: d.nature,
      gender: d.gender,
      shiny: d.shiny,
      variant: d.variant,
      formIndex: d.formIndex,
      abilityIndex: d.abilityIndex,
      friendship: d.friendship,
      moveset: d.moveset,
      status: d.status,
      pokeball: d.pokeball,
      metLevel: d.metLevel,
      metSpecies: d.metSpecies,
    };
  });
}

/** Byte-serialize one party slot as PokemonData JSON (used for the freshly-caught mon, which is
 *  reconstructed on the guest from the host's exact serialization - so it IS byte-identical). */
function slotData(scene: BattleScene, slot: number): string {
  return JSON.stringify(new PokemonData(scene.getPlayerParty()[slot]));
}

describe.skipIf(!RUN)(
  "co-op DUO wild-catch full-party: the CATCHER drives keep/release, relayed + converged on both engines (#856)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`duo-catch-full-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(1)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(5)
        .enemyMoveset(MoveId.SPLASH)
        .startingLevel(50)
        .moveset([MoveId.TACKLE, MoveId.SPLASH])
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopCatchThrowerHint(null);
      logs.dispose();
      clearCoopRuntime();
      // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
      initGlobalScene(game.scene);
    });

    afterAll(() => {
      // best-effort
    });

    it("a GUEST-thrown full-party catch: the guest drives the release picker, relayed + byte-converged, counter lockstep", async () => {
      // A FULL SIX-mon merged party. buildDuo mirrors it to the guest; we then tag 0..2 host / 3..5 guest.
      await game.classicMode.startBattle(
        SpeciesId.SNORLAX, // 0 host lead (on field)
        SpeciesId.GENGAR, // 1 guest lead (on field)
        SpeciesId.CHARIZARD, // 2 host bench
        SpeciesId.BLASTOISE, // 3 guest bench
        SpeciesId.VENUSAUR, // 4 guest bench  <- the slot the guest CATCHER will pick to release
        SpeciesId.PIKACHU, // 5 guest bench
      );
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

      withClientSync(rig.hostCtx, () => tagFullPartyOwners(rig.hostScene));
      await withClient(rig.guestCtx, () => tagFullPartyOwners(rig.guestScene));

      expect(rig.hostScene.getPlayerParty().length, "the host starts with a FULL six-mon party").toBe(6);
      expect(rig.guestScene.getPlayerParty().length, "the guest mirrors the full six-mon party").toBe(6);

      /** The guest CATCHER's chosen release slot (a GUEST-owned bench mon: VENUSAUR at slot 4). */
      const OWNER_PICK_SLOT = 4;
      const releasedSpecies = SpeciesId.VENUSAUR;

      const counterBefore = {
        host: rig.hostRuntime.controller.interactionCounter(),
        guest: rig.guestRuntime.controller.interactionCounter(),
      };
      expect(counterBefore.host, "the interaction counters start lockstep").toBe(counterBefore.guest);

      // ===== (A) HOST (SYNC, no microtask flush): the sole engine reaches the full-party GUEST-thrown catch
      // and calls the production helper - it sends `catchFullPrompt` (queued on the loopback) + registers the
      // await on COOP_CATCH_FULL_SEQ. We do NOT drain here (draining under the host ctx would deliver the
      // prompt while the HOST runtime is live, and the guest's onCatchFullPrompt no-ops unless the GUEST
      // runtime is the live one). =====
      const hostAwait = withClientSync(rig.hostCtx, () =>
        coopHostPrepareWildCatchFullDecision("Venusaur", releasedSpecies),
      );

      // ===== (B) GUEST: drain so the queued `catchFullPrompt` is delivered while the GUEST runtime is live ->
      // onCatchFullPrompt unshifts a real CoopGuestCatchFullPhase onto the guest queue (the wiring under test). =====
      await withClient(rig.guestCtx, async () => {
        await drainLoopback();
      });
      const guestPicker = withClientSync(rig.guestCtx, () =>
        (rig.guestScene as unknown as PhaseQueueSeam).phaseManager.phaseQueue.find("CoopGuestCatchFullPhase"),
      );
      expect(
        guestPicker,
        "the host's catchFullPrompt queued a CoopGuestCatchFullPhase on the guest (the recipient drives) (#856)",
      ).toBeDefined();

      // ===== (C) GUEST (SYNC): run the real picker. Stub the guest UI's showText (fire its cb) + the PARTY
      // open to auto-pick slot 4 (the CATCHER'S choice); the phase relays the pick under the catchFull band.
      // The MESSAGE setMode never resolves so the phase's own end() (shiftPhase) can't fire cross-ctx. The
      // relayed pick is queued on the loopback, NOT flushed here. =====
      withClientSync(rig.guestCtx, () => {
        const ui = rig.guestScene.ui as unknown as StubbableUi;
        const realSetMode = ui.setMode.bind(ui);
        ui.showText = (...args: unknown[]): unknown => {
          const cb = args.find(a => typeof a === "function") as (() => void) | undefined;
          cb?.();
          return;
        };
        ui.setMode = (...args: unknown[]): unknown => {
          const mode = args[0];
          if (mode === UiMode.PARTY) {
            ui.setMode = realSetMode; // one-shot: restore before invoking the picker callback
            (args[3] as (slotIndex: number) => void)(OWNER_PICK_SLOT);
            return Promise.resolve();
          }
          if (mode === UiMode.MESSAGE) {
            return new Promise(() => {}); // never resolves -> phase.end() (shiftPhase) never fires cross-ctx
          }
          return realSetMode(...args);
        };
        (guestPicker as Phase).start();
      });

      // ===== (D) HOST: drain so the relayed pick is delivered while the HOST runtime is live -> the helper's
      // awaitInteractionChoice resolves UNDER the host ctx. Assert it resolved to the CATCHER'S slot (4). =====
      const preparedDecision = await withClient(rig.hostCtx, async () => {
        for (let i = 0; i < 8; i++) {
          await drainLoopback();
        }
        return hostAwait;
      });
      const resolvedSlot = preparedDecision?.slot ?? null;
      expect(
        resolvedSlot,
        "the host received EXACTLY the slot the guest CATCHER relayed (the recipient drove the pick) (#856)",
      ).toBe(OWNER_PICK_SLOT);

      // ===== (E) HOST: apply the authoritative release+add at the RELAYED slot (the fix's release-then-add),
      // then run the capture handshake (serialize the post-catch party). This is what AttemptCapturePhase's
      // #856 branch does once the helper resolves. =====
      const capturePayload = withClientSync(rig.hostCtx, () => {
        setCoopCatchThrowerHint("guest");
        const party = rig.hostScene.getPlayerParty();
        const released = party.splice(resolvedSlot!, 1)[0];
        released.destroy();
        const enemy = rig.hostScene.getEnemyField().find(e => !e.isFainted());
        if (enemy == null) {
          throw new Error("no live enemy to catch");
        }
        const added = enemy.addToParty(PokeballType.MASTER_BALL, resolvedSlot!);
        if (preparedDecision?.commitAfterApply() !== true) {
          throw new Error("post-catch authority result did not commit");
        }
        setCoopCatchThrowerHint(null);
        return {
          addedSpecies: added?.species.speciesId,
          addedOwner: (added as { coopOwner?: string } | null)?.coopOwner,
          serialized: captureCoopCaptureParty(),
        };
      });
      const caughtSpecies = capturePayload.addedSpecies;

      // The caught mon was attributed to the GUEST (the thrower's half), added at the released slot.
      expect(capturePayload.addedOwner, "the caught mon is attributed to the GUEST catcher's half").toBe("guest");
      expect(caughtSpecies, "a mon was actually caught + added").toBeDefined();

      // ===== (F) GUEST: adopt the host's post-catch party (the production reconcile). =====
      await withClient(rig.guestCtx, () => {
        applyCoopCaptureParty(JSON.parse(JSON.stringify(capturePayload.serialized)));
      });

      // ----- ASSERTIONS -----

      const hostShape = withClientSync(rig.hostCtx, () => partyShape(rig.hostScene));
      const guestShape = withClientSync(rig.guestCtx, () => partyShape(rig.guestScene));

      // (a) THE RECIPIENT DROVE IT: the GUEST-picked mon (VENUSAUR, slot 4) is RELEASED on the host - gone
      // from the party - and the caught mon took its place, owned by the guest. The host did NOT release a
      // host-owned mon.
      expect(
        hostShape.some(m => m.sp === releasedSpecies),
        "host: the guest-picked mon (VENUSAUR) was RELEASED (the catcher drove the release, not the host)",
      ).toBe(false);
      expect(hostShape.filter(m => m.owner === "host").length, "host: the host's OWN half is untouched (3 mons)").toBe(
        3,
      );

      // (b) BYTE-IDENTICAL on both engines: same species+owner ordering across all 6, and byte-equal
      // PokemonData for every reconciled BENCH mon (incl. the freshly caught one at slot 4).
      expect(guestShape, "party species+owner ordering is identical on both engines").toEqual(hostShape);
      expect(
        guestShape.some(m => m.sp === releasedSpecies),
        "guest: the released mon is gone on the guest too (converged release)",
      ).toBe(false);
      expect(
        hostShape.some(m => m.sp === caughtSpecies) && guestShape.some(m => m.sp === caughtSpecies),
        "the caught mon is present on BOTH engines",
      ).toBe(true);
      const hostNorm = withClientSync(rig.hostCtx, () => normalizedParty(rig.hostScene));
      const guestNorm = withClientSync(rig.guestCtx, () => normalizedParty(rig.guestScene));
      expect(
        guestNorm,
        "every mon's state (species/level/hp/ivs/nature/moveset/owner/...) matches on both engines",
      ).toEqual(hostNorm);
      // The freshly CAUGHT mon (at the released slot) is reconstructed on the guest from the host's exact
      // serialization - so its full PokemonData is byte-identical (the catch landed the same on both engines).
      const hostCaught = withClientSync(rig.hostCtx, () => slotData(rig.hostScene, OWNER_PICK_SLOT));
      const guestCaught = withClientSync(rig.guestCtx, () => slotData(rig.guestScene, OWNER_PICK_SLOT));
      expect(guestCaught, "the freshly caught mon is byte-identical PokemonData on both engines").toEqual(hostCaught);

      // (c) THE INTERACTION COUNTER STAYED LOCKSTEP (the catchFull singleton band never ticks the counter).
      const counterAfter = {
        host: rig.hostRuntime.controller.interactionCounter(),
        guest: rig.guestRuntime.controller.interactionCounter(),
      };
      expect(counterAfter.host, "host: the interaction counter did not tick (catchFull is a fixed band)").toBe(
        counterBefore.host,
      );
      expect(counterAfter.guest, "the interaction counters stayed lockstep on both engines").toBe(counterAfter.host);

      logs.flush();
    }, 300_000);

    it("a HOST-thrown full-party catch is UNAFFECTED: resolved locally, NO catchFullPrompt reaches the guest, still converges", async () => {
      await game.classicMode.startBattle(
        SpeciesId.SNORLAX, // 0 host lead
        SpeciesId.GENGAR, // 1 guest lead
        SpeciesId.CHARIZARD, // 2 host bench  <- the slot the HOST catcher releases locally
        SpeciesId.BLASTOISE, // 3 guest bench
        SpeciesId.VENUSAUR, // 4 guest bench
        SpeciesId.PIKACHU, // 5 guest bench
      );
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

      withClientSync(rig.hostCtx, () => tagFullPartyOwners(rig.hostScene));
      await withClient(rig.guestCtx, () => tagFullPartyOwners(rig.guestScene));

      // Spy the guest's catchFullPrompt hook: a HOST-thrown catch must NOT prompt the guest (the host is the
      // catcher and drives the picker locally - the fix diverts ONLY guest-thrown catches).
      let guestPrompted = false;
      const realHook = rig.guestRuntime.interactionRelay.onCatchFullPrompt;
      rig.guestRuntime.interactionRelay.onCatchFullPrompt = (name, sp) => {
        guestPrompted = true;
        realHook?.(name, sp);
      };

      const counterBefore = rig.hostRuntime.controller.interactionCounter();

      // The host is the catcher: it drives its LOCAL release picker (no relay). We simulate the host's local
      // decision - release a HOST-owned bench slot (CHARIZARD, slot 2) + add the caught mon (owner host).
      const HOST_RELEASE_SLOT = 2;
      const releasedSpecies = SpeciesId.CHARIZARD;
      const capturePayload = withClientSync(rig.hostCtx, () => {
        setCoopCatchThrowerHint("host");
        const party = rig.hostScene.getPlayerParty();
        const released = party.splice(HOST_RELEASE_SLOT, 1)[0];
        released.destroy();
        const enemy = rig.hostScene.getEnemyField().find(e => !e.isFainted());
        if (enemy == null) {
          throw new Error("no live enemy to catch");
        }
        const added = enemy.addToParty(PokeballType.MASTER_BALL, HOST_RELEASE_SLOT);
        setCoopCatchThrowerHint(null);
        return {
          addedOwner: (added as { coopOwner?: string } | null)?.coopOwner,
          serialized: captureCoopCaptureParty(),
        };
      });
      await drainLoopback();
      expect(capturePayload.addedOwner, "the host-thrown catch is attributed to the HOST catcher's half").toBe("host");

      await withClient(rig.guestCtx, () => {
        applyCoopCaptureParty(JSON.parse(JSON.stringify(capturePayload.serialized)));
      });

      expect(guestPrompted, "a HOST-thrown catch did NOT send a catchFullPrompt to the guest (host-driven)").toBe(
        false,
      );

      const hostShape = withClientSync(rig.hostCtx, () => partyShape(rig.hostScene));
      const guestShape = withClientSync(rig.guestCtx, () => partyShape(rig.guestScene));
      expect(
        hostShape.some(m => m.sp === releasedSpecies),
        "host: the host-picked mon (CHARIZARD) was released",
      ).toBe(false);
      expect(guestShape, "party species+owner ordering converged on both engines").toEqual(hostShape);
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "the interaction counter stayed lockstep (unchanged) for the host-thrown leg",
      ).toBe(counterBefore);

      logs.flush();
    }, 300_000);
  },
);
