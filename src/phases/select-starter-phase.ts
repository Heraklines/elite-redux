import { getSessionDataLocalStorageKey } from "#app/account";
import { consumePendingDevStarters } from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { Phase } from "#app/phase";
import { allMoves, modifierTypes } from "#data/data-lists";
import { applyErBlackShinyKit } from "#data/elite-redux/er-black-shinies";
import { PokemonMove } from "#moves/pokemon-move";

/** Throwaway save slot used by dev test-scenarios so they don't clobber slot 0. */
const DEV_SCENARIO_SLOT = 4;

/**
 * The wave a co-op run launches into (#633 M4). A fresh co-op run always starts at wave 1, so the
 * guest awaits the host's launch snapshot keyed by this wave (the host pushes it from its first
 * EncounterPhase at `currentBattle.waveIndex === 1`). Mid-run resume is a separate flow (loadSession).
 */
const COOP_LAUNCH_WAVE = 1;

import type { CoopRosterEntry } from "#data/elite-redux/coop/coop-roster";
import {
  getCoopBattleStreamer,
  getCoopController,
  getCoopNetcodeMode,
  getCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { coopGuestSessionSlot, coopHostSessionSlot } from "#data/elite-redux/coop/coop-session";
import type { CoopRole, CoopSerializedStarter } from "#data/elite-redux/coop/coop-transport";
import { SpeciesFormChangeMoveLearnedTrigger } from "#data/form-change-triggers";
import { Gender } from "#data/gender";
import { ChallengeType } from "#enums/challenge-type";
import { Nature } from "#enums/nature";
import { UiMode } from "#enums/ui-mode";
import { overrideHeldItems, overrideModifiers } from "#modifiers/modifier";
import type { Starter } from "#types/save-data";
import { SaveSlotUiMode } from "#ui/handlers/save-slot-select-ui-handler";
import { applyChallenges } from "#utils/challenge-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import SoundFade from "phaser3-rex-plugins/plugins/soundfade";

export class SelectStarterPhase extends Phase {
  public readonly phaseName = "SelectStarterPhase";
  start() {
    super.start();

    // Local-only dev tools: a test scenario may have staged a party so we can
    // drop straight into the battle, skipping starter-select. consumePending…
    // returns null in production / on a clean checkout, so this is inert there.
    const devStarters = consumePendingDevStarters();
    if (devStarters && devStarters.length > 0) {
      globalScene.sessionSlotId = DEV_SCENARIO_SLOT;
      // The normal starter-select confirm path sets starting money; the dev
      // path skips that screen, so set it here too. Otherwise money stays at the
      // 0 default and STARTING_MONEY_OVERRIDE (and the 1000 classic default) are
      // both ignored - e.g. the Guessing Booth scenario showed P0 (#439).
      globalScene.money = globalScene.gameMode.getStartingMoney();
      // Dev scenarios hand-pick movesets for TESTING (e.g. Thunder Wave on a
      // Blastoise) — skip the starter-legality validation that silently
      // rejected them and left scenario mons with NO moves.
      this.initBattle(devStarters, true);
      return;
    }

    globalScene.playBgm("menu");

    // Co-op (#633): each player picks their OWN team on their OWN screen; we wait
    // for both to lock in, then the host launches the merged party.
    if (globalScene.gameMode.isCoop && getCoopController()) {
      this.startCoopSelect();
      return;
    }

    globalScene.ui.setMode(UiMode.STARTER_SELECT, (starters: Starter[]) => {
      globalScene.ui.clearText();
      globalScene.ui.setMode(UiMode.SAVE_SLOT, SaveSlotUiMode.SAVE, (slotId: number) => {
        // If clicking cancel, back out to title screen
        if (slotId === -1) {
          globalScene.phaseManager.toTitleScreen();
          this.end();
          return;
        }
        globalScene.sessionSlotId = slotId;
        this.initBattle(starters);
      });
    });
  }

  /**
   * Co-op selection flow (#633). The local player picks on their own
   * starter-select (capped at 5 points / 3 mons by the handler); their roster is
   * mirrored to the partner over the transport. A spoofed partner (local dev)
   * auto-picks + locks in; a real partner takes as long as they take. Once BOTH
   * sides are ready, the host assembles the merged 6-slot party (its own picks +
   * the partner's) and launches the run.
   */
  private startCoopSelect(): void {
    const controller = getCoopController()!;
    console.log(
      `[coop-launch] startCoopSelect role=${controller.role} partnerConnected=${controller.partnerConnected} partnerReady=${controller.partnerReady}`,
    );
    // Stand-in player 2 (local dev): join, pick, lock in. No-op for a real peer.
    getCoopRuntime()?.spoof?.autoComplete();

    let hostStarters: Starter[] = [];
    let launched = false;
    const proceedIfReady = () => {
      console.log(
        `[coop-launch] proceedIfReady launched=${launched} localTeam=${hostStarters.length} bothReady=${controller.bothReady()} role=${controller.role} partnerReady=${controller.partnerReady}`,
      );
      if (launched || hostStarters.length === 0 || !controller.bothReady()) {
        return;
      }
      launched = true;
      // Build the merged launch party INTERLEAVED (host0, guest0, host1, ...) so
      // the two double leads (party[0]/party[1] = field slots 0/1) are the host's
      // and the guest's FIRST mon respectively - each player gets an active mon to
      // control from turn 1 (#633, P2). `owners` tags each launch mon's coopOwner.
      //
      // The merge is keyed by ROLE (not local/partner) so BOTH clients produce the
      // SAME party (#633, LIVE-B): the host's machine and the guest's machine each
      // pass their own local picks + the partner's mirrored picks, and the builder
      // puts the host-role half first regardless of who is local. With the full
      // starter blobs over the wire, the two parties are byte-identical.
      const { starters: merged, owners } = buildCoopMergedStarters(
        hostStarters,
        controller.role,
        controller.partnerEntries(),
      );
      globalScene.ui.clearText();
      this.launchCoopMergedParty(merged, owners, controller.role);
    };
    // Re-check readiness whenever the partner's state changes (real-peer path).
    controller.onChange(() => proceedIfReady());

    globalScene.ui.setMode(UiMode.STARTER_SELECT, (starters: Starter[]) => {
      hostStarters = starters;
      console.log(`[coop-launch] local team locked in: ${starters.length} mons, role=${controller.role}`);
      // Mirror the local team to the partner and lock in. The roster carries the
      // FULL starter blob (#633, LIVE-B) - not just speciesId+cost - so the partner
      // rebuilds our mons EXACTLY (same form / IVs / nature / ability / moves) and
      // both clients' merged launch parties are byte-identical (a prerequisite for
      // the shared-seed lockstep).
      controller.setLocalRoster(
        starters.map<CoopRosterEntry>(s => ({
          speciesId: s.speciesId,
          cost: globalScene.gameData.getSpeciesStarterValue(s.speciesId),
          starter: serializeCoopStarter(s),
        })),
      );
      controller.setLocalReady(true);
      if (controller.bothReady()) {
        // Partner already locked in -> launch straight away.
        proceedIfReady();
      } else {
        // Partner hasn't confirmed their team yet. LEAVE the starter-select screen
        // (else its "Begin with these Pokemon?" confirm keeps re-prompting in a loop -
        // the live bug) and show a WAITING notice. The onChange listener fires
        // proceedIfReady the moment the partner readies, which then launches (host ->
        // SAVE_SLOT, guest -> battle) (#633).
        console.log("[coop-launch] local ready, partner NOT ready -> waiting screen");
        void globalScene.ui.setMode(UiMode.MESSAGE).then(() => {
          // RACE GUARD (#633, live hang): both players lock in within a few ms of
          // each other right after the difficulty pick, so the partner can become
          // READY during this async setMode -> showText gap. If proceedIfReady has
          // already launched (or both are ready now), do NOT paint the waiting notice:
          // it would land ON TOP of the just-launched screen (host SAVE_SLOT picker /
          // guest battle) with a never-advancing callback, leaving BOTH screens stuck
          // on "Waiting for your partner..." over a live battle. The non-race path
          // (partner readies later) still paints + is cleared by proceedIfReady's
          // clearText() before launch.
          if (launched || controller.bothReady()) {
            console.log("[coop-launch] partner readied during setMode gap -> skip stale waiting text");
            return;
          }
          globalScene.ui.showText("Waiting for your partner to choose their team...", null, () => {});
        });
      }
    });
  }

  /**
   * Launch the merged co-op party into the run (#633). NEITHER client runs the
   * interactive SAVE_SLOT picker any more - both AUTO-PICK a slot and drop straight
   * into the merged battle, so co-op starts immediately after the difficulty pick.
   *
   * WHY no picker (the live launch hang, twice over): SAVE_SLOT is an INTERACTIVE
   * modal that runs INDEPENDENTLY on each client - the same class of desync we
   * already removed for the battle-start "switch?" prompt (#633, CheckSwitchPhase)
   * and the host-only challenge screen.
   *   - GUEST: it stalls waiting for a second human to navigate + confirm the
   *     overwrite, or its `deleteSession` overwrite path returns false and triggers
   *     `globalScene.reset()` - both present as the guest never reaching EncounterPhase.
   *   - HOST: its per-slot loads dead-end ("Session not found." on every empty slot),
   *     the picker callback never fires, so `initBattle` never runs and the guest
   *     waits forever. The HOST is the persistence authority, but a human-driven slot
   *     pick mid-launch is not safe to require, so it auto-picks too.
   *
   * The HOST picks a SAFE slot: the FIRST EMPTY slot (so an existing solo/other run is
   * NEVER overwritten), falling back to its current slot only when all 5 are occupied
   * ({@linkcode coopHostSessionSlot}). Emptiness is read from localStorage DIRECTLY (a
   * real LOCAL run is always present there; a cloud round-trip can transiently fail and
   * false-read an occupied slot as empty - which would silently overwrite it). The GUEST
   * reuses its current slot ({@linkcode coopGuestSessionSlot}); its save is
   * non-authoritative (co-op runs persist host-side). `ignoreMovesetValidation` stays
   * true (LIVE-D): the merged party is rebuilt from each player's FULL serialized
   * starter, and the legality pass would strip moves and desync the relay.
   *
   * Guarded by `role`: the SOLO SAVE_SLOT flow (in {@linkcode start}) is byte-for-byte
   * unaffected - only the co-op launch skips the picker.
   */
  async launchCoopMergedParty(merged: Starter[], owners: CoopRole[], role: CoopRole): Promise<void> {
    console.log(
      `[coop-launch] launchCoopMergedParty role=${role} merged=${merged.length} slot=${globalScene.sessionSlotId}`,
    );
    if (role === "guest") {
      globalScene.sessionSlotId = coopGuestSessionSlot(globalScene.sessionSlotId);
      // The guest skips the SAVE_SLOT screen - but on the solo path it is that
      // setMode(SAVE_SLOT) which TEARS DOWN the starter-select UI. Without leaving
      // STARTER_SELECT here, the starter-select handler stays active and re-fires its
      // "Begin with these Pokemon?" confirm in a loop (#633 guest launch-loop). Move
      // to MESSAGE first (as the SAVE_SLOT flow ultimately does), THEN launch.
      console.log("[coop-launch] guest: clearing STARTER_SELECT -> MESSAGE, then launch");
      void globalScene.ui.setMode(UiMode.MESSAGE).then(async () => {
        // #633 M4 push-snapshot launch: the AUTHORITATIVE guest BOOTS from the host's full
        // session snapshot - it rolls no enemy / arena / party of its own, so it can never
        // diverge at launch (the whole point of M4). On timeout / parse failure / legacy
        // lockstep it falls back to building its own launch below, so it can never hang.
        if (getCoopNetcodeMode() === "authoritative" && (await this.tryCoopGuestSnapshotBoot())) {
          return;
        }
        this.initBattle(merged, true, owners);
      });
      return;
    }
    // HOST: auto-pick the first EMPTY slot (never overwrite an existing run); fall back
    // to the current slot only when all 5 are full. Occupancy is read from localStorage
    // DIRECTLY so a transient cloud failure can never false-empty an occupied slot.
    const slot = await coopHostSessionSlot(
      async s => localStorage.getItem(getSessionDataLocalStorageKey(s)) != null,
      globalScene.sessionSlotId,
    );
    const allFull = localStorage.getItem(getSessionDataLocalStorageKey(slot)) != null;
    if (allFull) {
      console.warn(`[coop-launch] host: all 5 save slots full, falling back to current slot ${slot} (will overwrite)`);
    }
    globalScene.sessionSlotId = slot;
    console.log(`[coop-launch] host: auto-picked slot ${slot} (no picker), clearing STARTER_SELECT -> MESSAGE`);
    void globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.initBattle(merged, true, owners));
  }

  /**
   * Co-op GUEST (#633 M4 push-snapshot launch): boot the battle from the host's AUTHORITATIVE launch
   * snapshot instead of rolling our own enemy / arena / party. Awaits the host's push event-driven
   * (NO `requestEnemyParty` poll - the ordered/reliable channel guarantees delivery), applies it via
   * the production-hardened resume machinery ({@linkcode GameData.applyCoopLaunchSession}), then queues
   * the LOADED {@linkcode EncounterPhase} (which renders the applied session and GENERATES NOTHING - its
   * `shouldAdoptCoopEnemyParty` returns false for a loaded phase). Returns false on no-streamer /
   * timeout / unparseable snapshot so the caller falls back to building its own launch (never hangs).
   * This is the whole point of M4: the guest computes NOTHING at launch, so it cannot desync.
   */
  private async tryCoopGuestSnapshotBoot(): Promise<boolean> {
    const streamer = getCoopBattleStreamer();
    if (streamer == null) {
      return false;
    }
    console.log("[coop-launch] guest: awaiting host launch snapshot (push-snapshot boot, no poll)");
    const json = await streamer.awaitLaunchSnapshot(COOP_LAUNCH_WAVE);
    if (json == null) {
      console.warn("[coop-launch] guest: no launch snapshot (timeout), falling back to own launch");
      return false;
    }
    const booted = await globalScene.gameData.applyCoopLaunchSession(json);
    if (!booted) {
      return false;
    }
    console.log("[coop-launch] guest: booted from host snapshot -> LOADED EncounterPhase (no generation)");
    globalScene.phaseManager.pushNew("EncounterPhase", true);
    this.end();
    return true;
  }

  /**
   * Initialize starters before starting the first battle
   * @param starters - Array of {@linkcode Starter}s with which to start the battle
   * @param ignoreMovesetValidation - Skip starter-legality moveset validation (dev scenarios)
   * @param coopOwners - Co-op only (#633, P2): per-launch-mon owner tag, parallel to `starters`.
   *   The merged party is interleaved (host0, guest0, host1, ...), so `coopOwners[i]` is the
   *   owner of `starters[i]`. Omitted / `undefined` for solo and all other modes.
   */
  initBattle(starters: Starter[], ignoreMovesetValidation = false, coopOwners?: CoopRole[]) {
    const party = globalScene.getPlayerParty();
    const loadPokemonAssets: Promise<void>[] = [];
    starters.forEach((starter: Starter, i: number) => {
      if (!i && Overrides.STARTER_SPECIES_OVERRIDE) {
        starter.speciesId = Overrides.STARTER_SPECIES_OVERRIDE;
      }
      const species = getPokemonSpecies(starter.speciesId);
      let starterFormIndex = starter.formIndex;
      if (
        starter.speciesId in Overrides.STARTER_FORM_OVERRIDES
        && Overrides.STARTER_FORM_OVERRIDES[starter.speciesId] != null
        && species.forms[Overrides.STARTER_FORM_OVERRIDES[starter.speciesId]!]
      ) {
        starterFormIndex = Overrides.STARTER_FORM_OVERRIDES[starter.speciesId]!;
      }

      let starterGender =
        species.malePercent === null ? Gender.GENDERLESS : starter.female ? Gender.FEMALE : Gender.MALE;
      if (Overrides.GENDER_OVERRIDE !== null) {
        starterGender = Overrides.GENDER_OVERRIDE;
      }
      const starterPokemon = globalScene.addPlayerPokemon(
        species,
        globalScene.gameMode.getStartingLevel(),
        starter.abilityIndex,
        starterFormIndex,
        starterGender,
        starter.shiny,
        starter.variant,
        starter.ivs,
        starter.nature,
      );
      if (starter.moveset) {
        starterPokemon.tryPopulateMoveset(starter.moveset, ignoreMovesetValidation);
      }
      // ER (community report 2026-06-11): some lines' EARLY learnset is all
      // status moves (Krabby Redux opens Kinesis/Showtime/Meditate/...), so a
      // starter could begin the run with NO damaging move at all. Guarantee
      // one: swap the last slot for the line's earliest damaging level-up
      // move (skipped for dev scenarios, whose movesets are intentional).
      if (!ignoreMovesetValidation) {
        ensureStarterHasDamagingMove(starterPokemon);
      }
      // ER Black Shinies (#349): a starter chosen at the BLACK tier enters the
      // run as a full t4 (epic base + gift kit). One per team is implicit:
      // only one starter can be black since the unlock is per-line and the
      // roll guard caps player teams at one anyway.
      if (starter.erBlackShiny) {
        starterPokemon.shiny = true;
        starterPokemon.variant = 2;
        applyErBlackShinyKit(starterPokemon);
      }
      if (starter.passive) {
        starterPokemon.passive = true;
      }
      starterPokemon.luck = globalScene.gameData.getDexAttrLuck(
        globalScene.gameData.dexData[species.speciesId].caughtAttr,
      );
      if (starter.pokerus) {
        starterPokemon.pokerus = true;
      }

      if (starter.nickname) {
        starterPokemon.nickname = starter.nickname;
      }

      if (starter.teraType == null) {
        starterPokemon.teraType = starterPokemon.species.type1;
      } else {
        starterPokemon.teraType = starter.teraType;
      }

      if (globalScene.gameMode.isSplicedOnly || Overrides.STARTER_FUSION_OVERRIDE) {
        starterPokemon.generateFusionSpecies(true);
      }
      starterPokemon.setVisible(false);
      // Co-op (#633, P2): tag each launch mon's owner from the parallel owners
      // array (the merged party is interleaved, so the tag - not the slot index -
      // is the source of truth). Only in co-op (coopOwners undefined otherwise),
      // so solo modes are untouched.
      if (coopOwners !== undefined && globalScene.gameMode.isCoop) {
        starterPokemon.coopOwner = coopOwners[i];
        // Co-op (#633 Fix #3): thread the owner's innate-unlock + luck snapshot into
        // customPokemonData (which round-trips through serialization), so the battle-time
        // innate gate + getLuck read the OWNER's per-account state, identically on both
        // clients, instead of each deriving it from its own dex/candy unlocks.
        if (starter.coopPassiveAttr !== undefined) {
          starterPokemon.customPokemonData.coopPassiveAttr = [...starter.coopPassiveAttr];
        }
        if (starter.coopLuck !== undefined) {
          starterPokemon.customPokemonData.coopLuck = starter.coopLuck;
        }
      }
      const chalApplied = applyChallenges(ChallengeType.STARTER_MODIFY, starterPokemon);
      party.push(starterPokemon);
      if (chalApplied) {
        // If any challenges modified the starter, it should update
        loadPokemonAssets.push(starterPokemon.updateInfo());
      }
      loadPokemonAssets.push(starterPokemon.loadAssets());
    });
    overrideModifiers();
    overrideHeldItems(party[0]);
    Promise.all(loadPokemonAssets).then(() => {
      // Guard: the menu BGM may not exist (e.g. the AudioContext never started
      // because the browser blocked autoplay). Fading out a null sound throws,
      // which would reject this promise and leave the run stuck on a blank field.
      const menuBgm = globalScene.sound.get("menu");
      if (menuBgm) {
        SoundFade.fadeOut(globalScene, menuBgm, 500, true);
      }
      globalScene.time.delayedCall(500, () => globalScene.playBgm());
      if (globalScene.gameMode.isClassic) {
        globalScene.gameData.gameStats.classicSessionsPlayed++;
      } else {
        globalScene.gameData.gameStats.endlessSessionsPlayed++;
      }
      globalScene.newBattle();
      // ER #439: the biome Map is a DEFAULT item on every run, all difficulties -
      // players can always choose their next biome from the start (daily runs
      // already grant it in TitlePhase; this covers classic/endless/challenge +
      // the ER difficulty modes + dev scenarios, which all route through here).
      globalScene.addModifier(modifierTypes.MAP().withIdFromFunc(modifierTypes.MAP).newModifier(), true);
      globalScene.arena.init();
      globalScene.sessionPlayTime = 0;
      globalScene.lastSavePlayTime = 0;
      // Ensures Keldeo (or any future Pokemon that have this type of form change) starts in the correct form
      globalScene.getPlayerParty().forEach(p => {
        globalScene.triggerPokemonFormChange(p, SpeciesFormChangeMoveLearnedTrigger);
      });
      this.end();
    });
  }
}

/**
 * Serialize an engine {@linkcode Starter} into the wire {@linkcode CoopSerializedStarter}
 * (#633, LIVE-B) so a partner can rebuild it EXACTLY. The shapes are nearly
 * identical; this pins the explicit field set + clones the array fields so the
 * struct that crosses the transport never aliases live engine state.
 */
function serializeCoopStarter(s: Starter): CoopSerializedStarter {
  // Co-op (#633 Fix #3): capture this picker's OWN per-account innate-unlock + luck snapshot
  // so the partner's client gates this shared mon by the OWNER's state, not its own.
  const snap = coopOwnerSnapshot(s);
  return {
    speciesId: s.speciesId,
    shiny: s.shiny,
    variant: s.variant,
    formIndex: s.formIndex,
    female: s.female,
    abilityIndex: s.abilityIndex,
    passive: s.passive,
    nature: s.nature,
    moveset: s.moveset ? [...s.moveset] : undefined,
    pokerus: s.pokerus,
    nickname: s.nickname,
    teraType: s.teraType,
    ivs: [...s.ivs],
    erBlackShiny: s.erBlackShiny,
    coopPassiveAttr: snap.coopPassiveAttr,
    coopLuck: snap.coopLuck,
  };
}

/**
 * Rebuild an engine {@linkcode Starter} from a wire {@linkcode CoopSerializedStarter}
 * (#633, LIVE-B). The inverse of {@linkcode serializeCoopStarter}: produces the
 * EXACT same starter the partner picked, so both clients' merged parties match
 * byte-for-byte. `nature` / `teraType` are stored as plain numbers on the wire and
 * narrowed back to their engine enums here.
 */
function rebuildCoopStarter(blob: CoopSerializedStarter): Starter {
  return {
    speciesId: blob.speciesId,
    shiny: blob.shiny,
    variant: blob.variant as Starter["variant"],
    formIndex: blob.formIndex,
    female: blob.female,
    abilityIndex: blob.abilityIndex,
    passive: blob.passive,
    nature: blob.nature as Nature,
    moveset: blob.moveset ? ([...blob.moveset] as Starter["moveset"]) : undefined,
    pokerus: blob.pokerus,
    nickname: blob.nickname,
    teraType: blob.teraType as Starter["teraType"],
    ivs: [...blob.ivs],
    erBlackShiny: blob.erBlackShiny,
    // Co-op (#633 Fix #3): carry the OWNER's innate-unlock + luck snapshot through so the
    // partner mon is gated by its owner's state (threaded into customPokemonData in initBattle).
    coopPassiveAttr: blob.coopPassiveAttr ? [...blob.coopPassiveAttr] : undefined,
    coopLuck: blob.coopLuck,
  };
}

/** Rebuild a partner roster entry into an engine {@linkcode Starter} (#633, LIVE-B):
 *  use the full blob when present, else fall back to sensible defaults (older
 *  client / mid-select snapshot) so the merge never breaks. */
function partnerEntryToStarter(e: CoopRosterEntry): Starter {
  if (e.starter) {
    return rebuildCoopStarter(e.starter);
  }
  // Back-compat fallback (no full blob): sensible defaults, level-up moveset
  // auto-populates in initBattle.
  return {
    speciesId: e.speciesId,
    shiny: false,
    variant: 0,
    formIndex: 0,
    female: false,
    abilityIndex: 0,
    passive: false,
    nature: Nature.HARDY,
    pokerus: false,
    ivs: [31, 31, 31, 31, 31, 31],
  };
}

/**
 * Co-op (#633 Fix #3): compute the LOCAL player's per-account innate-unlock + luck snapshot
 * for one of its own starters. The merged party gates a shared mon's active innates + total
 * luck by the OWNER's per-account state, so each player captures that for the mons IT picks
 * (the partner's mons carry their owner's snapshot over the wire). Returns `passiveAttr` per
 * ER innate slot (0/1/2 - all from the base species root; a launch mon is never fused) + the
 * canonical luck (the dex-attr luck the starter spawns with, mirroring initBattle's `.luck`).
 */
function coopOwnerSnapshot(s: Starter): { coopPassiveAttr: number[]; coopLuck: number } {
  const species = getPokemonSpecies(s.speciesId);
  const rootId = species.getRootSpeciesId();
  const passiveAttr = globalScene.gameData.starterData[rootId]?.passiveAttr ?? 0;
  const caughtAttr = globalScene.gameData.dexData[species.speciesId]?.caughtAttr ?? 0;
  const luck = globalScene.gameData.getDexAttrLuck(caughtAttr);
  return { coopPassiveAttr: [passiveAttr, passiveAttr, passiveAttr], coopLuck: luck };
}

/** Co-op (#633 Fix #3): attach the local owner's snapshot to each of the local starters,
 *  in place. Called only in co-op for the LOCAL half of the merge (partner mons carry their
 *  own owner's snapshot from the wire blob). */
function attachCoopOwnerSnapshots(starters: Starter[]): void {
  for (const s of starters) {
    const snap = coopOwnerSnapshot(s);
    s.coopPassiveAttr = snap.coopPassiveAttr;
    s.coopLuck = snap.coopLuck;
  }
}

/**
 * Build the merged co-op launch party (#633), INTERLEAVED: host0, guest0, host1,
 * guest1, ... so the two double leads (party[0]/party[1] = field slots 0/1) are
 * each player's FIRST mon - the host commands field 0, the guest field 1, from
 * turn 1.
 *
 * Keyed by ROLE, not by local/partner (#633, LIVE-B): `localStarters` are the
 * local client's own picks, `localRole` says which role that is, and
 * `partnerEntries` are the mirrored partner picks. The builder always lays the
 * HOST-role half into the interleave's first stream and the GUEST-role half into
 * the second - so the host's machine and the guest's machine produce the SAME
 * party order. With the full starter blobs carried over the wire (LIVE-B), each
 * partner mon is rebuilt EXACTLY (same form / IVs / nature / ability / moveset /
 * tera / black-shiny), making the two clients' 6-slot parties byte-identical - the
 * prerequisite for sharing a seed and staying in lockstep. Returns the interleaved
 * `starters` plus a parallel `owners` array so `initBattle` can tag each launch
 * mon's `coopOwner`.
 */
function buildCoopMergedStarters(
  localStarters: Starter[],
  localRole: CoopRole,
  partnerEntries: readonly CoopRosterEntry[],
): { starters: Starter[]; owners: CoopRole[] } {
  const partnerStarters = partnerEntries.map(partnerEntryToStarter);
  // Co-op (#633 Fix #3): the LOCAL half carries no snapshot yet (it's used as raw Starter
  // objects, not round-tripped through the wire), so attach the local owner's snapshot here.
  // The partner half already carries its owner's snapshot from rebuildCoopStarter.
  attachCoopOwnerSnapshots(localStarters);
  // Resolve each role's half from local vs partner so the result is identical on
  // both machines (host half first, guest half second).
  const hostHalf = localRole === "host" ? localStarters : partnerStarters;
  const guestHalf = localRole === "host" ? partnerStarters : localStarters;

  const starters: Starter[] = [];
  const owners: CoopRole[] = [];
  const max = Math.max(hostHalf.length, guestHalf.length);
  for (let i = 0; i < max; i++) {
    if (i < hostHalf.length) {
      starters.push(hostHalf[i]);
      owners.push("host");
    }
    if (i < guestHalf.length) {
      starters.push(guestHalf[i]);
      owners.push("guest");
    }
  }
  return { starters, owners };
}

/**
 * ER: guarantee a freshly created starter has at least ONE damaging move.
 * Some ER learnsets open with nothing but status moves (Krabby Redux), which
 * left the run unwinnable from turn 1. Replaces the last moveset slot (or
 * fills an empty one) with the line's earliest damaging level-up move.
 */
function ensureStarterHasDamagingMove(pokemon: ReturnType<typeof globalScene.addPlayerPokemon>): void {
  const moveset = pokemon.getMoveset();
  if (moveset.some(m => (m?.getMove()?.power ?? 0) > 0)) {
    return;
  }
  const firstDamaging = pokemon
    .getLevelMoves(1, true, false, true)
    .map(lm => lm[1])
    .find(moveId => (allMoves[moveId]?.power ?? 0) > 0);
  if (firstDamaging === undefined) {
    return;
  }
  if (moveset.length < 4) {
    pokemon.moveset.push(new PokemonMove(firstDamaging));
  } else {
    pokemon.moveset[3] = new PokemonMove(firstDamaging);
  }
}
