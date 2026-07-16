import { getSessionDataLocalStorageKey } from "#app/account";
import {
  consumePendingDevCustomTrainerForce,
  consumePendingDevPartySetup,
  consumePendingDevStarters,
} from "#app/dev-tools/registry";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { Phase } from "#app/phase";
import { allMoves, modifierTypes } from "#data/data-lists";
import { applyErBlackShinyKit } from "#data/elite-redux/er-black-shinies";
import { isErCustomTrainerDevForceArmed, setErCustomTrainerDevForce } from "#data/elite-redux/er-custom-trainers";
import { PokemonMove } from "#moves/pokemon-move";
import { installErCustomTrainerForCurrentWave } from "#phases/er-custom-trainer-install";

/** Throwaway save slot used by dev test-scenarios so they don't clobber slot 0. */
const DEV_SCENARIO_SLOT = 4;

/**
 * The wave a co-op run launches into (#633 M4). A fresh co-op run always starts at wave 1, so the
 * guest awaits the host's launch snapshot keyed by this wave (the host pushes it from its first
 * EncounterPhase at `currentBattle.waveIndex === 1`). Mid-run resume is a separate flow (loadSession).
 */
const COOP_LAUNCH_WAVE = 1;

import { coopLog } from "#data/elite-redux/coop/coop-debug";
import type { CoopRosterEntry } from "#data/elite-redux/coop/coop-roster";
import {
  clearCoopRuntime,
  getCoopBattleStreamer,
  getCoopController,
  getCoopNetcodeMode,
  getCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { coopGuestSessionSlot, coopHostSessionSlot } from "#data/elite-redux/coop/coop-session";
import type { CoopRole, CoopSerializedStarter } from "#data/elite-redux/coop/coop-transport";
import { sanitizeGhostProfile } from "#data/elite-redux/er-ghost-profile";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import {
  beginShowdownBattle,
  consumePendingShowdownPresetStarters,
  disposePendingShowdownRelay,
  disposePendingShowdownSession,
  endShowdownBattle,
  getShowdownOwnManifest,
  setPendingShowdownRelay,
  setPendingShowdownSession,
} from "#data/elite-redux/showdown/showdown-battle-state";
import { ShowdownCommandRelay } from "#data/elite-redux/showdown/showdown-command-relay";
import { buildShowdownHeldItem } from "#data/elite-redux/showdown/showdown-enemy-build";
import { reportShowdownBattleEntered } from "#data/elite-redux/showdown/showdown-escrow-client";
import { starterToManifest } from "#data/elite-redux/showdown/showdown-manifest";
import {
  ShowdownNegotiationError,
  type ShowdownNegotiationResult,
  ShowdownSession,
} from "#data/elite-redux/showdown/showdown-session";
import { buildShowdownStakePool } from "#data/elite-redux/showdown/showdown-stake-pool";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { beginShowdownTelemetry } from "#data/elite-redux/showdown/showdown-telemetry";
import {
  clearTournamentMatchContext,
  getTournamentMatchContext,
  isTournamentPeerAllowed,
} from "#data/elite-redux/showdown/tournament-match-context";
import { SpeciesFormChangeMoveLearnedTrigger } from "#data/form-change-triggers";
import { Gender } from "#data/gender";
import { ChallengeType } from "#enums/challenge-type";
import { Nature } from "#enums/nature";
import { UiMode } from "#enums/ui-mode";
import { overrideHeldItems, overrideModifiers } from "#modifiers/modifier";
import { getErShinyLabEquippedNameForSpecies, getErShinyLabSavedLookForSpecies } from "#sprites/er-shiny-lab-sprite-fx";
import type { Starter } from "#types/save-data";
import { SaveSlotUiMode } from "#ui/handlers/save-slot-select-ui-handler";
import type { ShowdownWagerArgs } from "#ui/showdown-wager-ui-handler";
import { applyChallenges } from "#utils/challenge-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";
import SoundFade from "phaser3-rex-plugins/plugins/soundfade";

export class SelectStarterPhase extends Phase {
  public readonly phaseName = "SelectStarterPhase";

  /**
   * B7 item 8: whenever this phase ends - including the player BACKING OUT of starter select to the
   * title (`tryExit` -> `toTitleScreen` -> `getCurrentPhase().end()`), which never runs the versus
   * flow's own cleanup - dispose any still-pending showdown session + relay so their transport
   * listeners are torn down. No-op in every other mode / after the flow already disposed them (both
   * are idempotent), so the normal launch path is unaffected.
   */
  end(): void {
    disposePendingShowdownSession();
    disposePendingShowdownRelay();
    super.end();
  }

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

    // Showdown 1v1 (D0): each player builds their OWN team, exchanges + validates it with the
    // opponent (negotiate), then wagers; the HOST launches its team as the player side (the opponent
    // is fielded as the enemy trainer, built from its manifest in newBattle) and the GUEST boots from
    // the host's launch snapshot (its player side IS the host's team). Teams do NOT merge - distinct
    // from co-op. Only versus (a live/vs-CPU showdown session) takes this branch.
    if (globalScene.gameMode.isShowdown && getCoopController()) {
      this.startShowdownSelect();
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
    // #868 self-healing lobby: while we are locally READY but the partner isn't yet, drive a periodic
    // lobby resync so a lost lock-in frame (a rosterSync dropped on a channel flap, or sent while the
    // transport was momentarily down) can never strand the run forever. `resyncLobbyState` re-broadcasts
    // OUR roster+ready AND re-requests the partner's, so the strand heals in whichever direction lost a
    // frame - the answering side of the handshake, not a blind resend (the live "partner got kicked, no
    // players showing" host stall + the guest "stuck at starter-select" both reduce to a lost lobby frame
    // with nothing re-answerable). Cleared the moment we launch or both sides are ready.
    let lobbyResyncTimer: ReturnType<typeof setInterval> | null = null;
    const stopLobbyResync = () => {
      if (lobbyResyncTimer != null) {
        clearInterval(lobbyResyncTimer);
        lobbyResyncTimer = null;
      }
    };
    const startLobbyResync = () => {
      if (lobbyResyncTimer != null) {
        return;
      }
      lobbyResyncTimer = setInterval(() => {
        if (launched || controller.bothReady()) {
          stopLobbyResync();
          return;
        }
        console.log(`[coop-launch] lobby resync tick (waiting for partner) role=${controller.role} (#868)`);
        controller.resyncLobbyState();
      }, 2000);
    };
    const proceedIfReady = () => {
      console.log(
        `[coop-launch] proceedIfReady launched=${launched} localTeam=${hostStarters.length} bothReady=${controller.bothReady()} role=${controller.role} partnerReady=${controller.partnerReady}`,
      );
      if (launched || hostStarters.length === 0 || !controller.bothReady()) {
        return;
      }
      launched = true;
      stopLobbyResync();
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
        // #868: begin the self-healing lobby resync loop so a lost lock-in can't strand us here forever.
        startLobbyResync();
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
        // session snapshot - it rolls no enemy / arena / party of its own. An authoritative
        // guest must FAIL CLOSED if that boundary cannot be adopted; generating a local launch
        // here creates two valid-looking but different runs and guarantees a later desync.
        if (getCoopNetcodeMode() === "authoritative") {
          if (!(await this.tryCoopGuestSnapshotBoot())) {
            globalScene.ui.showText(
              "Could not recover the host's co-op launch state. Reconnect and try again.",
              null,
              null,
              null,
              true,
            );
          }
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
   * timeout / unparseable snapshot so the caller can stop at an explicit recovery screen.
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
      console.warn("[coop-launch] guest: no launch snapshot (timeout), failing closed");
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
   * Showdown 1v1 (D0): drive the versus team-build starter-select, then run the post-teambuild
   * handshake (negotiate -> wager -> battle) once the player locks in their team.
   */
  private startShowdownSelect(): void {
    const controller = getCoopController()!;
    const runtime = getCoopRuntime();
    if (runtime == null) {
      this.abortShowdown("Lost the versus connection.");
      return;
    }
    // B7 item 8 (CRITICAL): construct the ShowdownSession + enemy-command relay NOW, BEFORE
    // starter select opens. The session registers its transport listener in its constructor and
    // BUFFERS the opponent's `showdownTeam`/`showdownReady`, so if the peer finishes teambuild
    // FIRST its team is captured instead of arriving at a transport with no session listener and
    // being dropped forever (the live "flow dead-ends to the title, no wager screen" bug: negotiate
    // then awaited a message already gone and timed out at 60s). A stale session/relay from a prior
    // aborted flow is superseded (disposed) by the setPending* calls. The SAME instances are threaded
    // into runShowdownFlow so negotiate() consumes the buffered peer team.
    const session = new ShowdownSession(runtime.localTransport, { rendezvous: runtime.rendezvous });
    const relay = new ShowdownCommandRelay(runtime.localTransport);
    setPendingShowdownSession(session);
    setPendingShowdownRelay(relay);
    // Team Menu (Phase D): teams are now built + selected BEFORE pairing. Entering the lobby ALWAYS
    // stashes the chosen preset's reconstructed starters (title-phase `onEnterLobby` is the sole versus
    // lobby entry - the announcer AND the accepter both go through it), so BOTH clients arrive with a
    // pending team and pairing leads near-immediately to the wager (no 10-minute in-lobby pick wait).
    const presetStarters = consumePendingShowdownPresetStarters();
    if (presetStarters != null) {
      void this.runShowdownFlow(presetStarters, controller.role, session, relay);
      return;
    }
    // No pending preset = a client reached the versus flow WITHOUT a team (a stale/legacy path: a
    // reconnect after the single-use stash was consumed, or any old direct-lobby wiring). The old code
    // fell through to the interactive STARTER_SELECT grid here - exactly the "sent to pick another team"
    // the maintainer flagged. HARD-FAIL instead with a clear message + clean back-out (abortShowdown
    // disposes the just-built session/relay so nothing strands), never the grid. Both clients build
    // their team in the Team Menu now, so this branch is only ever a fault condition.
    console.warn("[showdown] startShowdownSelect: no pending preset - aborting (team must be picked in the Team Menu)");
    this.abortShowdown("No team was carried into this match. Pick a team in the Showdown menu, then enter the lobby.");
  }

  /**
   * Showdown 1v1 (D0): build this client's manifests, NEGOTIATE them with the opponent (team exchange
   * + mutual FORMAT validation + the `showdown-ready` barrier), then open the WAGER screen (D3). On the
   * wager's both-locked commit it stashes the match ({@linkcode beginShowdownBattle}, with the live
   * enemy-command relay) and launches the battle. A negotiation rejection aborts cleanly to the title.
   */
  private async runShowdownFlow(
    starters: Starter[],
    role: CoopRole,
    session: ShowdownSession,
    relay: ShowdownCommandRelay,
  ): Promise<void> {
    const runtime = getCoopRuntime();
    if (runtime == null) {
      this.abortShowdown("Lost the versus connection.");
      return;
    }
    const manifests = starters.map(s => starterToManifest(s, globalScene.gameData));
    // B7 item 8: the session + relay were constructed at flow START (startShowdownSelect) so the
    // session's listener has been BUFFERING the opponent's team while THIS client built its own.
    // negotiate() below consumes whatever the peer already sent. The pending-slot lifetimes (set in
    // startShowdownSelect) mean EVERY non-commit exit disposes both; the wager commit adopts the relay.
    const ownProfile = sanitizeGhostProfile(globalScene.gameData.ghostProfile);

    // The handshake can take a moment (real peer) or fail (drop). Show a waiting notice during the await
    // so the player is never staring at a blank screen with no escape (mirrors the guest command handler).
    // AWAITED (staging bug, 2026-07-07): for the SECOND confirmer the negotiate below resolves
    // INSTANTLY (both teams already exchanged) - a fire-and-forget setMode(MESSAGE) here would still
    // be mid-transition when the flow opens SHOWDOWN_WAGER, and its completion then CLOBBERS the
    // wager screen (the deterministic "second player never gets the wager" one-sided lock).
    await globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.showText(
      i18next.t("battle:showdownWaitingForOpponent", { defaultValue: "Waiting for opponent..." }),
      null,
      () => {},
      null,
      true,
    );

    let result: ShowdownNegotiationResult;
    try {
      result = await session.negotiate(manifests, ownProfile);
    } catch (err) {
      disposePendingShowdownSession();
      disposePendingShowdownRelay();
      this.abortShowdown(
        err instanceof ShowdownNegotiationError ? showdownRejectMessage(err) : "The versus match could not start.",
      );
      return;
    }
    // TOURNAMENT constrained pairing: a tournament match may ONLY be played against the bracket
    // opponent. BOTH clients run this flow, so both verify the negotiated peer identity and reject a
    // mismatch (a stray lobby pairing / spoof can never start a tournament match against the wrong
    // person). Prize-only: a tournament match never touches escrow (see the empty stake pool below).
    const tournamentCtx = getTournamentMatchContext();
    if (tournamentCtx != null && !isTournamentPeerAllowed(runtime.controller.partnerName ?? "")) {
      disposePendingShowdownSession();
      disposePendingShowdownRelay();
      this.abortShowdown(
        `This is not your tournament opponent. You can only play ${tournamentCtx.expectedOpponent} in this match.`,
      );
      return;
    }

    // Keep the shared rendezvous alive (ownsRendezvous=false) for the wager-commit barrier; drop the
    // session's own team/ready listeners (their job is done) via the pending slot.
    disposePendingShowdownSession();

    const wagerArgs: ShowdownWagerArgs = {
      ownTeam: manifests,
      opponentTeam: result.opponentManifest,
      opponentProfile: result.opponentProfile,
      role,
      transport: runtime.localTransport,
      rendezvous: runtime.rendezvous,
      // D3b: the FULL wagerable collection + the two players' account identities (escrow participants).
      // TOURNAMENT (prize-only): an EMPTY stake pool makes the wager screen Friendly-only — it renders
      // as team-preview + confirm, the player can only commit Friendly, matchId stays null, and every
      // escrow call site no-ops. Nobody's collection is at risk in a tournament match.
      stakePool: tournamentCtx == null ? buildShowdownStakePool(globalScene.gameData) : [],
      ownUsername: runtime.controller.localName(),
      opponentUsername: runtime.controller.partnerName ?? "",
      onCommit: (matchId: string | null, ranked) => {
        beginShowdownBattle(manifests, result.opponentManifest, relay, result.opponentProfile, matchId, ranked);
        // D5: begin the HOST-side battle telemetry record (no-op for the guest). hostTeam is the
        // host's own team; guestTeam the opponent's - correct because begin only records for the host.
        beginShowdownTelemetry({
          role,
          matchId,
          hostUid: runtime.controller.localName(),
          guestUid: runtime.controller.partnerName ?? "",
          hostTeam: manifests,
          guestTeam: result.opponentManifest,
        });
        void this.launchShowdownBattle(starters, role, matchId, manifests);
      },
    };
    // Await so no later UI transition can silently displace the wager screen; both players must
    // sit on it until the commit rendezvous (10-minute human-deliberation class).
    await globalScene.ui.setMode(UiMode.SHOWDOWN_WAGER, wagerArgs);
  }

  /**
   * Showdown 1v1 (D0): launch the negotiated match. The HOST fields its OWN team as the player side
   * (the enemy trainer is built from the stashed opponent manifest in `newBattle`); the GUEST boots
   * from the host's authoritative launch snapshot (its player side IS the host's team) - there is no
   * correct local fallback for the guest, so a missed snapshot aborts cleanly.
   */
  private async launchShowdownBattle(
    starters: Starter[],
    role: CoopRole,
    matchId: string | null,
    ownManifests?: ShowdownMonManifest[],
  ): Promise<void> {
    // B7 item 11: the run launch is DEFERRED to here (post wager-commit), so it can't race the wager
    // screen the way item-4's team-confirm `startRun` did. Pin the neutral run difficulty ("ace", the
    // module default) on BOTH clients: a versus battle is a manifest-built level-100 6v6, so difficulty
    // is cosmetic (item 4) - but a PRIOR run left as "hell" would otherwise leak hell enemy-level
    // scaling into the match, so it MUST be reset. No runConfig broadcast is needed (showdown clients
    // run independent battles: host authoritative, guest snapshot-boot; `kind=versus` is pinned at
    // session connect, not via runConfig), and no ER per-run reset matters (the enemy is manifest-built,
    // bypassing the ER roster/ghost/map machinery entirely).
    setErDifficulty("ace");
    // D1/D2: for a STAKED match, ping the escrow that the battle started (both clients). This sets the
    // server's `battlePhaseEntered` flag that gates a lone survivor's forfeit/timeout settlement.
    // Best-effort + fire-and-forget — it never blocks the launch.
    if (matchId != null) {
      void reportShowdownBattleEntered(matchId).catch(() => {});
    }
    if (role === "guest") {
      globalScene.sessionSlotId = coopGuestSessionSlot(globalScene.sessionSlotId);
      void globalScene.ui.setMode(UiMode.MESSAGE).then(async () => {
        if (await this.tryCoopGuestSnapshotBoot()) {
          return;
        }
        this.abortShowdown("Did not receive the match from the host.");
      });
      return;
    }
    // HOST: pick a SAFE save slot (first empty; never overwrite an existing run). Showdown never
    // persists (the result phase never saves), but newBattle still needs a valid slot id.
    const slot = await coopHostSessionSlot(
      async s => localStorage.getItem(getSessionDataLocalStorageKey(s)) != null,
      globalScene.sessionSlotId,
    );
    globalScene.sessionSlotId = slot;
    // ignoreMovesetValidation: the showdown team was assembled with explicit movesets - keep them
    // verbatim (the legality pass would strip them and desync the relayed enemy commands).
    void globalScene.ui.setMode(UiMode.MESSAGE).then(() => this.initBattle(starters, true, undefined, ownManifests));
  }

  /** Showdown 1v1 (D0): tear the versus session down and return to the title with a message. */
  private abortShowdown(message: string): void {
    endShowdownBattle();
    // A tournament match that aborts must not leak its context into a later plain match.
    clearTournamentMatchContext();
    // Dispose a still-pending pre-battle session + relay (a negotiate-window abort never fired onCommit,
    // so neither was adopted into the match state - endShowdownBattle can't have reached them). B7 item 8:
    // the session's transport listener MUST be torn down or it keeps buffering on a dead flow.
    disposePendingShowdownSession();
    disposePendingShowdownRelay();
    clearCoopRuntime();
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.showText(
      message,
      null,
      () => {
        globalScene.phaseManager.toTitleScreen();
        this.end();
      },
      null,
      true,
    );
  }

  /**
   * Initialize starters before starting the first battle
   * @param starters - Array of {@linkcode Starter}s with which to start the battle
   * @param ignoreMovesetValidation - Skip starter-legality moveset validation (dev scenarios)
   * @param coopOwners - Co-op only (#633, P2): per-launch-mon owner tag, parallel to `starters`.
   *   The merged party is interleaved (host0, guest0, host1, ...), so `coopOwners[i]` is the
   *   owner of `starters[i]`. Omitted / `undefined` for solo and all other modes.
   */
  initBattle(
    starters: Starter[],
    ignoreMovesetValidation = false,
    coopOwners?: CoopRole[],
    showdownManifests?: ShowdownMonManifest[],
  ) {
    const party = globalScene.getPlayerParty();
    const loadPokemonAssets: Promise<void>[] = [];
    // Showdown 1v1 (staging fix 2026-07-07): the HOST's OWN party must be fielded from the
    // MANIFEST (the validated fielded stage/mega + level-100 identity the opponent also builds
    // from), not the raw grid Starter whose speciesId is the LINE ROOT. Without this the player
    // fielded base forms (Charmander) while the opponent correctly saw the picked stage
    // (Mega Charizard) built from the same manifest - an asymmetric, wrong battle.
    // Threaded EXPLICITLY (not read from the showdown-battle-state global): the two-engine duo
    // harness runs both clients in one process, where a global read here poisons the host's
    // party with the guest's stash (caught by showdown-duo.test.ts).
    const ownManifests = globalScene.gameMode.isShowdown ? (showdownManifests ?? null) : null;
    starters.forEach((starter: Starter, i: number) => {
      if (!i && Overrides.STARTER_SPECIES_OVERRIDE) {
        starter.speciesId = Overrides.STARTER_SPECIES_OVERRIDE;
      }
      const showdownMon = ownManifests?.[i] ?? null;
      const species = getPokemonSpecies(showdownMon?.speciesId ?? starter.speciesId);
      let starterFormIndex = showdownMon?.formIndex ?? starter.formIndex;
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
      // Showdown fairness (2026-07-10): a manifest-built mon (host's OWN party) fields the manifest's
      // FREE nature and has its IVs FORCED to a perfect [31 x6]. The opponent party is built with the
      // SAME forcing (buildShowdownEnemy), and the guest boots the host's post-build session snapshot,
      // so the forced values flow to the guest verbatim — both engines recalculate identical stats,
      // keeping the turn checksum in parity. Non-showdown paths (showdownMon == null) are unchanged.
      const starterIvs = showdownMon ? [31, 31, 31, 31, 31, 31] : starter.ivs;
      const starterNature = (showdownMon?.nature as Nature | undefined) ?? starter.nature;
      const starterPokemon = globalScene.addPlayerPokemon(
        species,
        globalScene.gameMode.getStartingLevel(),
        starter.abilityIndex,
        starterFormIndex,
        starterGender,
        starter.shiny,
        starter.variant,
        starterIvs,
        starterNature,
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
        // Co-op (#785): carry the OWNER'S Shiny Lab look onto the mon (customPokemonData
        // round-trips through serialization, and the FX lookup prefers a carried look). A
        // SHINY mon whose owner carried NO look suppresses the LOCAL per-species lookup, so
        // this client's own preset for the species never leaks onto the partner's plain shiny.
        if (starter.erShinyLab !== undefined) {
          starterPokemon.customPokemonData.erShinyLab = starter.erShinyLab;
          if (starter.erShinyLabName) {
            starterPokemon.customPokemonData.erShinyLabName = starter.erShinyLabName;
          }
        } else if (coopOwners[i] === getCoopController()?.role) {
          // #785 v3 (live "partner never sees MY effects"): OUR OWN picks never cross the wire
          // on this client, so their Starter carries no blob look - stamp OUR locally-equipped
          // look straight from the save onto customPokemonData, which rides the launch snapshot
          // to the partner. Without this, only wire-rebuilt (partner) mons ever carried looks
          // and each side saw the other's mons as default shinies.
          const ownLook = getErShinyLabSavedLookForSpecies(starterPokemon.species.speciesId, starterPokemon.shiny);
          if (ownLook !== undefined) {
            starterPokemon.customPokemonData.erShinyLab = ownLook;
            const ownName = getErShinyLabEquippedNameForSpecies(starterPokemon.species.speciesId, starterPokemon.shiny);
            if (ownName) {
              starterPokemon.customPokemonData.erShinyLabName = ownName;
            }
          }
        } else if (starterPokemon.shiny) {
          // Suppress the LOCAL per-species lookup ONLY for the PARTNER'S bare shiny (their look
          // decision is authoritative; absence = default shiny). NEVER for OUR OWN mons: the
          // local Starter never went through the wire rebuild, so its erShinyLab field is
          // legitimately undefined here - suppressing killed the owner's own effects (live
          // "all the shiny lab effects are gone, even from the host screen" regression).
          starterPokemon.customPokemonData.erShinyLabSuppressLocal = true;
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
    // Dev scenarios can restore per-mon state that the Starter handoff cannot
    // represent (notably held items). Apply it before newBattle() so the first
    // battle frame and item bars see the final party state.
    consumePendingDevPartySetup()?.();
    // Showdown 1v1 (B7 item 6): attach each OWN mon's manifest held item to the PLAYER party -
    // the SAME mapping (buildShowdownHeldItem) the opponent's client fields for you, so both
    // sides field a byte-equal held-item set. MEGA_STONE / unset -> no runtime modifier. The
    // host is the only client that runs initBattle for showdown (the guest boots from the host's
    // launch snapshot, which carries these modifiers; the authoritative turn stream then relays
    // them each turn), and the party is built in the same order as the stashed own manifest.
    if (globalScene.gameMode.isShowdown) {
      const ownManifest = getShowdownOwnManifest();
      if (ownManifest != null) {
        party.forEach((pokemon, i) => {
          const heldMon = ownManifest[i];
          if (heldMon == null) {
            return;
          }
          const held = buildShowdownHeldItem(pokemon, heldMon);
          if (held != null) {
            globalScene.addModifier(held, true);
          }
        });
      }
    }
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
      // Restart rebuilds the title screen, which clears old custom-trainer
      // forces. Arm the staged force at the last possible point so Reset always
      // recreates this trainer battle instead of falling through to a wild wave.
      const pendingCustomTrainerForce = consumePendingDevCustomTrainerForce();
      if (pendingCustomTrainerForce) {
        setErCustomTrainerDevForce(pendingCustomTrainerForce);
      }
      globalScene.newBattle();
      // ER (dev-tools only): a staff tester picking a custom trainer from the
      // in-game Dev Scenarios picker arms a one-shot dev force. The FIRST wave of a
      // run never runs NewBattlePhase (which normally installs custom trainers), so
      // install here too when a force is armed - otherwise the forced pick would
      // drop into a normal wild/trainer battle instead of the chosen trainer. Inert
      // in prod (the force read is gated to dev tools) and on any un-forced run.
      if (isErCustomTrainerDevForceArmed()) {
        installErCustomTrainerForCurrentWave();
      }
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

/** Showdown 1v1 (D0): a player-facing reason line for a rejected negotiation. */
function showdownRejectMessage(err: ShowdownNegotiationError): string {
  switch (err.reason) {
    case "illegalTeam":
      return "The opponent's team was rejected (illegal team).";
    case "hashMismatch":
      return "The opponent's team failed the anti-tamper check.";
    case "timeout":
      return "The opponent did not respond in time.";
    case "protoMismatch":
      // B7 item 11: a stale cached bundle on one side. Tell BOTH players to hard-refresh.
      return "Your game versions differ - hard-refresh (Ctrl+Shift+R) both clients and retry.";
    default:
      return "The versus match was cancelled.";
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
    // Co-op (#785): carry the OWNER'S locally-equipped Shiny Lab look (+ preset name) so the
    // partner's client renders this mon's custom shiny effects instead of the default shiny.
    erShinyLab: coopLogShinyLabCarry(s.speciesId, getErShinyLabSavedLookForSpecies(s.speciesId, s.shiny)),
    erShinyLabName: getErShinyLabEquippedNameForSpecies(s.speciesId, s.shiny) || undefined,
  };
}

/** #785 diagnostics: prove in the session log whether a pick's look attached at lock-in. */
function coopLogShinyLabCarry<T>(speciesId: number, look: T): T {
  coopLog("session", `roster carry shinyLab speciesId=${speciesId} -> ${look === undefined ? "none" : "ATTACHED"}`);
  return look;
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
    // Co-op (#785): the owner's carried Shiny Lab look (threaded into customPokemonData below).
    erShinyLab: blob.erShinyLab,
    erShinyLabName: blob.erShinyLabName,
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
