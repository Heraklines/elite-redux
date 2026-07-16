import { pokerogueApi } from "#api/api";
import { loggedInUser } from "#app/account";
import { getDevMenuItems } from "#app/dev-tools/registry";
import { GameMode, getGameMode } from "#app/game-mode";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { Phase } from "#app/phase";
import { bypassLogin, isBeta, isDev } from "#constants/app-constants";
import { getDailyRunStarters, startDailyEventChallenges } from "#data/daily-seed/daily-run";
import { modifierTypes } from "#data/data-lists";
import { CoopLobbyController, type LobbyPlayer } from "#data/elite-redux/coop/coop-lobby";
import {
  type CoopResumeCandidate,
  coopResumeBlockMessage,
  coopSeatMapMatches,
  findCoopResumeCandidate,
} from "#data/elite-redux/coop/coop-resume-marker";
import {
  type CoopRuntime,
  clearCoopRuntime,
  coopSessionGeneration,
  getCoopController,
  getCoopRuntime,
  isVersusSession,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopNetcodeMode, CoopResumeCommitment, CoopSessionKind } from "#data/elite-redux/coop/coop-transport";
import { buildInfernoFeed } from "#data/elite-redux/er-community-challenge-inferno";
import { applyCommunityChallengeToRun } from "#data/elite-redux/er-community-challenge-launch";
import type { CommunityChallengeConfig } from "#data/elite-redux/er-community-challenges";
import { resetCommunityRunState } from "#data/elite-redux/er-community-run-state";
import { setPendingShowdownPresetStarters } from "#data/elite-redux/showdown/showdown-battle-state";
import { copyTextToClipboard } from "#data/elite-redux/showdown/showdown-clipboard";
import { syncShowdownPendingSettlements } from "#data/elite-redux/showdown/showdown-escrow-client";
import { isMegaStage } from "#data/elite-redux/showdown/showdown-evolutions";
import {
  buildUnlockSnapshot,
  manifestToStarter,
  starterToManifest,
} from "#data/elite-redux/showdown/showdown-manifest";
import { validateShowdownTeam } from "#data/elite-redux/showdown/showdown-team";
import { buildTeamMenuPresetViews, runShowdownPresetBuild } from "#data/elite-redux/showdown/showdown-team-menu-flow";
import {
  getTournamentBracket,
  listTournaments,
  registerForTournament,
} from "#data/elite-redux/showdown/tournament-client";
import { setTournamentMatchContext } from "#data/elite-redux/showdown/tournament-match-context";
import { Gender } from "#data/gender";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { ModifierPoolType } from "#enums/modifier-pool-type";
import { UiMode } from "#enums/ui-mode";
import { Unlockables } from "#enums/unlockables";
import { getBiomeKey } from "#field/arena";
import type { Modifier } from "#modifiers/modifier";
import { getDailyRunStarterModifiers, regenerateModifierPoolThresholds } from "#modifiers/modifier-type";
import { vouchers } from "#system/voucher";
import type { Starter } from "#types/save-data";
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { CoopLobbyStage } from "#ui/coop-lobby-stage";
import { SaveSlotUiMode } from "#ui/save-slot-select-ui-handler";
import { DomShowdownEditorTextInput, DomShowdownPasteInput } from "#ui/showdown-editor-text-input";
import type { ShowdownTeamMenuConfig, ShowdownTeamMenuUiHandler } from "#ui/showdown-team-menu-ui-handler";
import { isLocalServerConnected } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

const NO_SAVE_SLOT = -1;

export class TitlePhase extends Phase {
  public readonly phaseName = "TitlePhase";
  private loaded = false;
  // TODO: Make `end` take a `GameModes` as a parameter rather than storing it on the class itself
  public gameMode: GameModes;
  // ER Community Challenge: the config of the community card being played, stashed
  // by the browser's onPlay closure and consumed in end() (after the CHALLENGE
  // gameMode is rebuilt). null for every non-community launch.
  private pendingCommunityConfig: CommunityChallengeConfig | null = null;

  private isExactCoopSession(runtime: CoopRuntime, controller: CoopRuntime["controller"], generation: number): boolean {
    return getCoopRuntime() === runtime && getCoopController() === controller && coopSessionGeneration() === generation;
  }

  private clearExactCoopSession(runtime: CoopRuntime, controller: CoopRuntime["controller"], generation: number): void {
    if (this.isExactCoopSession(runtime, controller, generation)) {
      clearCoopRuntime();
    }
  }

  async start(): Promise<void> {
    super.start();

    // ER Community Challenge: clear any forced difficulty / species whitelist a
    // previous community card may have set, so returning to the title never leaks
    // it into a normal Custom Challenge run.
    resetCommunityRunState();

    globalScene.ui.clearText();
    globalScene.ui.fadeIn(250);

    const now = new Date();
    if (now.getMonth() === 11 || (now.getMonth() === 0 && now.getDate() <= 15)) {
      globalScene.playBgm("winter_title", true);
    } else {
      globalScene.playBgm("title", true);
    }

    // Showdown escrow (D2): self-apply any settlements a staked match resolved while this
    // device was offline. Fire-and-forget + best-effort — a failure/absent endpoint is a no-op,
    // and it never blocks the title. Only when logged in (the pending queue is per-account).
    if (loggedInUser != null) {
      void syncShowdownPendingSettlements(globalScene.gameData).catch(() => {});
    }

    const lastSlot = await this.checkLastSaveSlot();
    await this.showOptions(lastSlot);
  }

  /**
   * If a user is logged in, check the last save slot they loaded and adjust various variables
   * to account for it.
   * @returns A Promise that resolves with the last loaded session's slot ID.
   * Returns `NO_SAVE_SLOT` if not logged in or no session was found.
   */
  private async checkLastSaveSlot(): Promise<number> {
    if (loggedInUser == null) {
      return NO_SAVE_SLOT;
    }
    try {
      const sessionData = await globalScene.gameData.getSession(loggedInUser.lastSessionSlot);
      if (!sessionData) {
        return NO_SAVE_SLOT;
      }

      globalScene.sessionSlotId = loggedInUser.lastSessionSlot;
      // Set the BG texture to the last save's current biome
      const biomeKey = getBiomeKey(sessionData.arena.biome);
      const bgTexture = `${biomeKey}_bg`;
      globalScene.arenaBg.setTexture(bgTexture);
      return loggedInUser.lastSessionSlot;
    } catch (err) {
      console.error(err);
      return NO_SAVE_SLOT;
    }
  }

  private async showOptions(lastSessionSlot: number): Promise<void> {
    const options: OptionSelectItem[] = [];
    // Add a "continue" menu if the session slot ID is >-1
    if (lastSessionSlot > NO_SAVE_SLOT) {
      options.push({
        semanticId: "continue",
        label: i18next.t("continue", { ns: "menu" }),
        handler: () => {
          this.loadSaveSlot(lastSessionSlot);
          return true;
        },
      });
    }
    options.push(
      {
        semanticId: "new-game",
        label: i18next.t("menu:newGame"),
        handler: () => {
          const setModeAndEnd = (gameMode: GameModes) => {
            this.gameMode = gameMode;
            globalScene.ui.setMode(UiMode.MESSAGE);
            globalScene.ui.clearText();
            this.end();
          };
          const { gameData } = globalScene;
          const options: OptionSelectItem[] = [];
          options.push({
            semanticId: "classic",
            label: GameMode.getModeName(GameModes.CLASSIC),
            handler: () => {
              setModeAndEnd(GameModes.CLASSIC);
              return true;
            },
          });
          // Story Mode (the LLM "Director") is hidden for now — it crowded the
          // mode menu. Re-add the block here when bringing it back.
          // Co-op (#633): a 2-player shared run. Shown only where dev tools appear
          // (local + staging), never in a production build, until it is flipped on.
          // VITE_DEV_TOOLS is set on the staging build (mirrors the dev-tools
          // registry gate); cast since it's not in the typed ImportMetaEnv.
          const devToolsEnabled =
            (import.meta.env as unknown as Record<string, string | undefined>).VITE_DEV_TOOLS === "1";
          if (isDev || isBeta || devToolsEnabled) {
            // Co-op is AUTHORITATIVE-ONLY (#633 M3): the HOST is the sole engine and the
            // guest is a pure renderer (it runs no combat + no mystery-encounter engine, so
            // it can never desync by construction). The old "lockstep" dual-engine mode + its
            // A/B toggle are retired - authoritative is the one and only co-op netcode. Same
            // dev/beta/devTools gate.
            options.push({
              semanticId: "co-op",
              label: GameMode.getModeName(GameModes.COOP),
              handler: () => {
                this.openCoopLobby(setModeAndEnd, "authoritative");
                return true;
              },
            });
            // Showdown (C1): a 1v1 PvP "versus" match. Entry flow is INVERTED (addendum 2026-07-11):
            // clicking Showdown opens the TEAM PRESET MENU first (build/select a team BEFORE pairing),
            // not the lobby. "Enter lobby with this team" then routes into the SAME lobby/pairing flow
            // carrying the chosen preset, so both clients arrive pre-built and pairing leads
            // near-immediately to the wager (no 10-minute in-lobby pick wait).
            options.push({
              label: GameMode.getModeName(GameModes.SHOWDOWN),
              handler: () => {
                this.openShowdownTeamMenu(setModeAndEnd);
                return true;
              },
            });
            // Showdown TOURNAMENTS (beside the Team Menu path): async single-elim brackets. Opens the
            // tournament LIST (worker-backed); register / view bracket / play a bracket match from there.
            options.push({
              label: "Showdown Tournaments",
              handler: () => {
                this.openShowdownTournaments(setModeAndEnd);
                return true;
              },
            });
          }
          options.push({
            semanticId: "daily-run",
            label: i18next.t("menu:dailyRun"),
            handler: () => {
              this.initDailyRun();
              return true;
            },
          });
          if (gameData.isUnlocked(Unlockables.ENDLESS_MODE)) {
            options.push({
              label: GameMode.getModeName(GameModes.CHALLENGE),
              handler: () => {
                // ER Community Challenges: split Challenge into {Custom, Community}.
                // Enabled in ALL builds now (the worker backend is ready for prod). The
                // browser shows the live Inferno card today and merges player-authored
                // challenges once /community/* responds, degrading gracefully to the
                // built-in card when the worker is unreachable. NOTE: Co-op (above) stays
                // dev/staging-gated; only this Community split is ungated.
                // Opening a NESTED OPTION_SELECT (or any overlay) from inside an
                // option handler must be DEFERRED: returning true here makes the
                // current select clear() itself, which would clobber a synchronous
                // setOverlayMode. setMode(MESSAGE)+resetModeChain()+showText(callback)
                // is the proven pattern (mirrors the game-mode menu + the co-op lobby).
                globalScene.ui.setMode(UiMode.MESSAGE);
                globalScene.ui.resetModeChain();
                globalScene.ui.showText("Select a challenge type.", null, () =>
                  globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, {
                    options: [
                      {
                        label: "Custom Challenge",
                        handler: () => {
                          setModeAndEnd(GameModes.CHALLENGE);
                          return true;
                        },
                      },
                      {
                        label: "Community Challenges",
                        handler: () => {
                          // For now the feed shows the single REAL Inferno card (live NU
                          // pool + real achievement-completion count). TODO(P1-A): merge in
                          // fetchCommunityFeed() player-authored challenges once /community/*
                          // is deployed. Defer the open the same way (clobber-safe).
                          globalScene.ui.setMode(UiMode.MESSAGE);
                          globalScene.ui.resetModeChain();
                          globalScene.ui.showText("", null, () =>
                            globalScene.ui.setOverlayMode(
                              UiMode.COMMUNITY_CHALLENGES,
                              buildInfernoFeed(),
                              // onLaunch: stash a config + tear the browser down into the
                              // run. setModeAndEnd begins with setMode(MESSAGE) (clears the
                              // browser) then end(), which rebuilds the CHALLENGE gameMode and
                              // applies the config. Used for BOTH card-play and the founder's
                              // post-create qualifying run (the caller does the attempt /
                              // founder bookkeeping before invoking this). Launch the mode the
                              // config declares so the rebuilt gameMode matches the config key.
                              (config: CommunityChallengeConfig) => {
                                console.log("[community-launch] onLaunch -> setModeAndEnd", {
                                  gameMode: GameModes[config.gameModeId],
                                  mode: UiMode[globalScene.ui.getMode()],
                                });
                                this.pendingCommunityConfig = config;
                                setModeAndEnd(config.gameModeId);
                              },
                              // onBack: CANCEL returns to the title. We opened via the
                              // deferred pattern (resetModeChain), so revertMode alone
                              // would strand on an empty MESSAGE - reset to a fresh title.
                              () => {
                                globalScene.phaseManager.toTitleScreen();
                                super.end();
                              },
                            ),
                          );
                          return true;
                        },
                      },
                      {
                        label: i18next.t("menu:cancel"),
                        handler: () => {
                          globalScene.phaseManager.toTitleScreen();
                          super.end();
                          return true;
                        },
                      },
                    ],
                  }),
                );
                return true;
              },
            });
            options.push({
              label: GameMode.getModeName(GameModes.ENDLESS),
              handler: () => {
                setModeAndEnd(GameModes.ENDLESS);
                return true;
              },
            });
            if (gameData.isUnlocked(Unlockables.SPLICED_ENDLESS_MODE)) {
              options.push({
                label: GameMode.getModeName(GameModes.SPLICED_ENDLESS),
                handler: () => {
                  setModeAndEnd(GameModes.SPLICED_ENDLESS);
                  return true;
                },
              });
            }
          }
          // Cancel button = back to title
          options.push({
            semanticId: "cancel",
            label: i18next.t("menu:cancel"),
            handler: () => {
              globalScene.phaseManager.toTitleScreen();
              super.end();
              return true;
            },
          });
          globalScene.ui.showText(i18next.t("menu:selectGameMode"), null, () =>
            globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, {
              options,
            }),
          );
          return true;
        },
      },
      {
        semanticId: "load-game",
        label: i18next.t("menu:loadGame"),
        handler: () => {
          globalScene.ui.setOverlayMode(UiMode.SAVE_SLOT, SaveSlotUiMode.LOAD, (slotId: number) => {
            if (slotId === NO_SAVE_SLOT) {
              console.warn("Attempted to load save slot of -1 through load game menu!");
              return this.showOptions(slotId);
            }
            this.loadSaveSlot(slotId);
          });
          return true;
        },
      },
      {
        // ER Profile hub: replaces the old top-level Run History entry. Run History now
        // lives as a tab INSIDE the Profile hub (alongside the Ghost Trainer Editor).
        label: "Profile",
        handler: () => {
          this.openProfileHub();
          return true;
        },
      },
      {
        label: i18next.t("menu:settings"),
        handler: () => {
          globalScene.ui.setOverlayMode(UiMode.SETTINGS);
          return true;
        },
        keepOpen: true,
      },
    );
    // Local-only dev tools (gitignored test-scenario harness). On a clean
    // checkout / production build getDevMenuItems() returns [] so nothing
    // appears here. The ctx lets a scenario launch a run like "New Game".
    const startRunWithMode = (gameMode: GameModes) => {
      this.gameMode = gameMode;
      globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.ui.clearText();
      this.end();
    };
    options.push(...getDevMenuItems({ startRunWithMode }));
    const config: OptionSelectConfig = {
      options,
      noCancel: true,
      yOffset: 47,
    };
    await globalScene.ui.setMode(UiMode.TITLE, config);
  }

  /**
   * ER Profile hub: open the side-nav hub screen (UiMode.PROFILE). Its tabs open the
   * Ghost Trainer Editor and the existing Run History screen; more tabs can be added
   * later in the hub handler. Opened via the DEFERRED pattern (mirrors the Community
   * Challenges entry): returning true from an option handler clears the select, which
   * would clobber a synchronous setOverlayMode, so setMode(MESSAGE)+resetModeChain()+
   * showText(callback) is mandatory. On exit `backToTitle` revertModes() to unwind the
   * hub AND any tab overlay stacked on it (running each handler's clear() so no ghost
   * container is left behind) before starting a fresh TitlePhase.
   */
  private openProfileHub(): void {
    const backToTitle = () => {
      // Unwind the PROFILE hub AND any tab overlay stacked on top of it (e.g. the
      // Ghost Trainer Editor, which stays on the chain when you PUBLISH) so each
      // handler's clear() runs and hides its container BEFORE the fresh title shows.
      // Without this, the overlay containers stay layered over the title / battle /
      // starter-select screens (a full-screen ghost of the Profile screen).
      void globalScene.ui.revertModes().then(() => {
        globalScene.phaseManager.toTitleScreen();
        super.end();
      });
    };
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.resetModeChain();
    globalScene.ui.showText("", null, () => globalScene.ui.setOverlayMode(UiMode.PROFILE, backToTitle));
  }

  // ===========================================================================================
  // OFFLINE TEAM-BUILD MODE GRAPH (audited 2026-07-11). Every edge in the offline build's screen
  // graph, its transition kind, who hides the source container, and what re-shows the destination.
  // The whole offline graph is now FADE-FREE (SHOWDOWN_SET_EDITOR + SHOWDOWN_TEAM_MENU are both
  // noTransitionModes in ui.ts), so no edge can strand the black fade overlay opaque.
  //
  //  title game-mode select --("Showdown")--> TEAM MENU
  //     kind: instant. openShowdownTeamMenu: setMode(MESSAGE)+resetModeChain()+showText("",cb) then
  //     setMode(SHOWDOWN_TEAM_MENU). MESSAGE->menu is not a transition pair, so no fade. The empty-text
  //     showText runs on the TITLE-context MessageUiHandler (which DOES fire its empty-text callback -
  //     unlike the grid-context one, see fix #3 below), the clobber-safe deferral for a nested open.
  //  TEAM MENU --("Create"/"Edit")--> GRID (STARTER_SELECT)
  //     kind: single AWAITED fade (MESSAGE->STARTER_SELECT; STARTER_SELECT is a transitionMode). menu
  //     hidden by setMode(MESSAGE) clearing it. openStarterSelect awaits setMode(MESSAGE); resetModeChain;
  //     awaits setMode(STARTER_SELECT,{seed,onCancel}). NO empty-text showText hop (grid-context handler
  //     never fires it - live fix #3). EDIT seeds the party strip via seedTeamFromStarters.
  //  GRID --(confirm an eligible line / "Edit Set")--> SET EDITOR
  //     kind: instant OVERLAY (setOverlayMode; SHOWDOWN_SET_EDITOR is noTransition). Grid is NOT cleared
  //     - it stays alive under the editor's opaque backdrop. openShowdownEditor.
  //  SET EDITOR --(cycle G / V / shoulder to a sibling team mon)--> SET EDITOR (same mode)
  //     kind: instant IN-PLACE re-render. openShowdownEditor detects mode===editor and calls
  //     editor.show([config]) directly (render() clears its dynamic children first). It CANNOT go through
  //     setOverlayMode - that no-ops on this.mode===mode (the dead-G/V bug). No chain churn, no fade.
  //  SET EDITOR --(Done / Cancel / Esc)--> GRID
  //     kind: instant revertMode (lastMode SHOWDOWN_SET_EDITOR is noTransition). editor.clear() hides its
  //     container; the grid was never hidden, so it is simply revealed. commitShowdownEditor / onCancel.
  //  GRID --(top-level Cancel -> confirmExit CONFIRM -> Yes)--> TEAM MENU
  //     kind: instant. The CONFIRM is an UNCHAINED overlay (setModeWithoutClear) over the still-visible
  //     grid, so revertMode can't restore it; the grid is hidden by an EXPLICIT this.clear() in the Yes
  //     handler (fix this round - it used to strand the grid visible), then settle()->showMenu()->
  //     setMode(SHOWDOWN_TEAM_MENU) shows the menu (instant, noTransition).
  //  GRID --(lock-in Start -> confirm -> name modal -> saved)--> TEAM MENU
  //     kind: instant. tryStart's showdown branch setMode(STARTER_SELECT) restores the grid as active,
  //     onLockIn opens the COMMUNITY_CHALLENGE_TEXT name modal (setOverlayMode, noTransition); its
  //     revertMode returns to the grid; settle()->showMenu()->setMode(SHOWDOWN_TEAM_MENU) clears the grid
  //     (getHandler()==grid) and shows the menu. Name-cancel takes the same terminal without saving.
  //  TEAM MENU --("Enter lobby")--> versus pairing (leaves the offline graph); --(Exit)--> title
  //     (revertModes()+toTitleScreen()). Menu-internal overlays (rename text, delete/enter CONFIRM) all
  //     revert instantly back to the menu (lastMode noTransition).
  // ===========================================================================================
  /**
   * Showdown 1v1 (Team Menu, addendum): open the TEAM PRESET MENU - the new pre-pairing entry screen.
   * Teams are built + selected here, BEFORE the lobby. The menu's callbacks:
   *   - onEnterLobby: reconstruct the chosen preset's starters and stash them, then open the EXISTING
   *     pairing lobby carrying the versus session (the pre-built team skips the in-lobby teambuild).
   *   - onCreate / onEdit: run the OFFLINE build (starter-select + editor, no session), then save.
   *   - onRename / onDelete: persist to the account save (the handler updates its own view live).
   *   - onExit: unwind back to the title.
   * Opened via the DEFERRED pattern (setMode(MESSAGE)+resetModeChain()+showText callback) so returning
   * true from the option handler cannot clobber the setMode - mirrors {@linkcode openProfileHub}.
   */
  private openShowdownTeamMenu(setModeAndEnd: (gameMode: GameModes) => void): void {
    const { gameData } = globalScene;
    const showMenu = (): void => {
      const config: ShowdownTeamMenuConfig = {
        presets: buildTeamMenuPresetViews(gameData),
        onExit: () => {
          void globalScene.ui.revertModes().then(() => {
            globalScene.phaseManager.toTitleScreen();
            super.end();
          });
        },
        onRename: (idx, name) => gameData.renameShowdownTeamPreset(idx, name),
        onDelete: idx => gameData.deleteShowdownTeamPreset(idx),
        onCreate: () => this.openShowdownPresetBuild(undefined, showMenu),
        onEdit: idx => this.openShowdownPresetBuild(idx, showMenu),
        // EXPORT (V): copy the hovered team's PS text to the clipboard (the handler shows the banner).
        copyToClipboard: text => copyTextToClipboard(text),
        // IMPORT validation: the SAME shared rule engine the editor's Done + the menu's render use, over
        // the LIVE collection snapshot, so an imported team is gated exactly like a hand-built one.
        validateTeam: mons => validateShowdownTeam(mons, buildUnlockSnapshot(gameData), isMegaStage),
        // IMPORT save: persist the imported team as a new account-save preset (the handler appends its view).
        onImportSave: (name, mons) => gameData.saveShowdownTeamPreset(name, mons),
        onEnterLobby: idx => {
          const preset = gameData.listShowdownTeamPresets()[idx];
          if (preset == null) {
            showMenu();
            return;
          }
          // Reconstruct the engine starters from the saved wire manifests and stash them; the versus
          // launch (SelectStarterPhase.startShowdownSelect) consumes them + skips the grid teambuild.
          setPendingShowdownPresetStarters(preset.mons.map(manifestToStarter));
          this.openCoopLobby(setModeAndEnd, "authoritative", "versus", GameModes.SHOWDOWN);
        },
      };
      // Inject the mobile/desktop native-keyboard bridge for the rename overlay (single-line) AND the
      // import paste modal (multiline), on the registered handler BEFORE show - mirrors the editor.
      const handler = globalScene.ui.handlers[UiMode.SHOWDOWN_TEAM_MENU] as ShowdownTeamMenuUiHandler | undefined;
      handler?.setTextInput(new DomShowdownEditorTextInput());
      handler?.setPasteInput(new DomShowdownPasteInput());
      void globalScene.ui.setMode(UiMode.SHOWDOWN_TEAM_MENU, config);
    };
    // Clobber-safe deferral (reachable from the game-mode OPTION_SELECT handler, which returns true and
    // clears the select): AWAIT setMode(MESSAGE) to tear the select down first, then open the menu
    // DIRECTLY. No empty-text `showText("", ...)` hop - its callback is unreliable on a grid-context
    // MessageUiHandler (the "menu never opens" / stuck-at-MESSAGE flake, exposed once the offline flow's
    // fade timing shifted), and no unawaited setMode racing the open. Mirrors the openStarterSelect
    // deferral (live fix #3) which uses this same awaited-MESSAGE pattern.
    void (async () => {
      await globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.ui.resetModeChain();
      showMenu();
    })();
  }

  /**
   * Showdown TOURNAMENTS (P1): the worker-backed tournament LIST -> BRACKET -> play flow. Opened via the
   * SAME clobber-safe deferral as the Team Menu (await setMode(MESSAGE) + resetModeChain, then open the
   * screen directly - no unreliable empty-text hop). List/bracket are no-transition full-screen modes, so
   * the inter-screen hops are instant. A worker fetch failure (offline / unconfigured endpoint) drops to a
   * message and back to the title - it never strands a blank screen.
   */
  private openShowdownTournaments(setModeAndEnd: (gameMode: GameModes) => void): void {
    const { gameData } = globalScene;
    const ownName = loggedInUser?.username ?? "Player";

    const backToTitle = (): void => {
      void globalScene.ui.revertModes().then(() => {
        globalScene.phaseManager.toTitleScreen();
        super.end();
      });
    };

    // A message hop that returns to a follow-up (used for offline / no-preset notices).
    const notice = (message: string, then: () => void): void => {
      void (async () => {
        await globalScene.ui.setMode(UiMode.MESSAGE);
        globalScene.ui.resetModeChain();
        globalScene.ui.showText(message, null, then, null, true);
      })();
    };

    const enterMatch = (tournamentId: string, matchId: string, opponent: string): void => {
      const presets = gameData.listShowdownTeamPresets();
      if (presets.length === 0) {
        // A saved team preset is REQUIRED - route to the Team Menu to build one.
        notice("You need a saved team preset first. Build one in the Showdown menu.", () => backToTitle());
        return;
      }
      // P1: field the first saved preset (P2 adds a per-match preset picker). The registered team is not
      // locked - the player may re-pick presets per match.
      setPendingShowdownPresetStarters(presets[0].mons.map(manifestToStarter));
      setTournamentMatchContext({ tournamentId, matchId, expectedOpponent: opponent });
      this.openCoopLobby(setModeAndEnd, "authoritative", "versus", GameModes.SHOWDOWN);
    };

    const openBracket = async (id: string): Promise<void> => {
      const res = await getTournamentBracket(id);
      if (!res.ok) {
        notice(res.error, () => void showList());
        return;
      }
      const t = res.data.tournament;
      void globalScene.ui.setMode(UiMode.TOURNAMENT_BRACKET, {
        tournament: t,
        ownParticipant: ownName,
        now: Date.now(),
        onPlayMatch: (matchId: string, opponent: string) => enterMatch(t.id, matchId, opponent),
        onBack: () => void showList(),
      });
    };

    const register = (id: string): void => {
      const presets = gameData.listShowdownTeamPresets();
      if (presets.length === 0) {
        notice("You need a saved team preset to register. Build one in the Showdown menu.", () => void showList());
        return;
      }
      void registerForTournament(id, presets[0].name).then(res => {
        if (res.ok) {
          void showList();
        } else {
          notice(res.error, () => void showList());
        }
      });
    };

    const showList = async (): Promise<void> => {
      const res = await listTournaments();
      if (!res.ok) {
        notice(res.error, () => backToTitle());
        return;
      }
      void globalScene.ui.setMode(UiMode.TOURNAMENT_LIST, {
        tournaments: res.data.tournaments,
        ownParticipant: ownName,
        now: Date.now(),
        onOpen: (id: string) => void openBracket(id),
        onRegister: (id: string) => register(id),
        onExit: () => backToTitle(),
      });
    };

    void (async () => {
      await globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.ui.resetModeChain();
      await showList();
    })();
  }

  /**
   * Showdown 1v1 (Team Menu, Phase C): the OFFLINE create/edit build. Drives the SAME starter-select +
   * Set Editor showdown teambuild the versus flow uses, but with NO live session (no pairing / ready
   * barrier / countdown) - only `gameMode.isShowdown` gates the teambuild UI, so a local gameMode swap
   * is enough. On a confirmed full team it names + saves the preset (in place when `editIndex` is set),
   * then returns to the menu via `onSettled`. The name modal reuses the shared DOM-input text modal.
   */
  private openShowdownPresetBuild(editIndex: number | undefined, onSettled: () => void): void {
    const { gameData } = globalScene;
    // Live fix #5 (2026-07-10, "naming my team doesn't advance"): capture the LIVE gameMode OBJECT.
    // The previous capture used `this.gameMode` (a GameModes id the TitlePhase only carries when
    // launching a real run - undefined while sitting in title menus), so settle() restored
    // getGameMode(undefined) -> undefined and EVERY subsequent setMode crashed reading
    // gameMode.isCoop (and the grid's shiny-lab timer crashed reading gameMode.challenges).
    // The realpath test masked it by stamping phase.gameMode manually.
    const prevGameMode = globalScene.gameMode;
    globalScene.gameMode = getGameMode(GameModes.SHOWDOWN);
    const editing = editIndex === undefined ? undefined : gameData.listShowdownTeamPresets()[editIndex];
    const defaultName = editing?.name ?? "Team";
    // EDIT (addendum): pre-seed the grid with the preset's mons so the player edits IN PLACE, rather than
    // rebuilding from an empty grid. Each mon is reconstructed with its saved stage/shiny/item/moves/
    // nature/ability via `manifestToStarter` and fed into starter-select's show args (seedStarters), which
    // seeds the party + team strip. CREATE seeds nothing. Rules stay enforced (Done re-validates as usual).
    const seedStarters: Starter[] = editing == null ? [] : editing.mons.map(manifestToStarter);
    // Both the SAVE path and every CANCEL path funnel through this settle: restore the borrowed gameMode
    // (the offline build only borrowed SHOWDOWN to drive the teambuild UI) and reopen the Team Menu. This
    // makes the cancel-to-menu path clean (no reliance on next-launch self-healing to restore the gameMode).
    const settle = () => {
      globalScene.gameMode = prevGameMode;
      onSettled();
    };
    runShowdownPresetBuild(
      editIndex,
      defaultName,
      {
        openStarterSelect: (onLockIn, onCancel, seed) => {
          // Live fix #3 (2026-07-10): NO showText hop. Fix #2's awaited-MESSAGE chain logged
          // "MESSAGE settled" live and then went silent - `showText("", ...)` on the real
          // MessageUiHandler never invoked its callback for empty text, so openGrid() never ran.
          // (The Team Menu's identical-looking bounce works only because ITS showText runs on the
          // title-context handler, which does fire.) The hop added nothing but that risk: open the
          // grid DIRECTLY with awaited transitions and a breadcrumb at every step, so any residual
          // live failure names its exact step in the console instead of a silent no-op.
          void (async () => {
            try {
              await globalScene.ui.setMode(UiMode.MESSAGE);
              globalScene.ui.resetModeChain();
              console.log(`[showdown-build] MESSAGE settled -> opening starter-select (seed=${seed.length})`);
              await globalScene.ui.setMode(
                UiMode.STARTER_SELECT,
                (starters: Starter[]) => {
                  globalScene.ui.clearText();
                  onLockIn(starters);
                },
                undefined,
                {
                  seedStarters: seed,
                  // Grid top-level back-out routes here (not to the title): return to the Team Menu.
                  onCancel: () => {
                    globalScene.ui.clearText();
                    onCancel();
                  },
                },
              );
              console.log("[showdown-build] starter-select OPEN");
            } catch (err) {
              console.error("[showdown-build] starter-select open failed", err);
            }
          })();
        },
        promptName: (def, onName) => {
          globalScene.ui.setOverlayMode(
            UiMode.COMMUNITY_CHALLENGE_TEXT,
            {
              buttonActions: [
                (value: string) => globalScene.ui.revertMode().then(() => onName(value)),
                () => globalScene.ui.revertMode().then(() => onName(null)),
              ],
            },
            { title: "Name your team", fieldLabel: "Team name", initial: def },
          );
        },
        toManifest: (starter: Starter) => starterToManifest(starter, gameData),
        save: (name, mons, index) => gameData.saveShowdownTeamPreset(name, mons, index),
        onSettled: settle,
      },
      seedStarters,
    );
  }

  /**
   * Co-op matchmaking lobby (#633). Announce into the worker lobby and show the
   * live list of OTHER waiting players in a blue OPTION_SELECT panel; picking one
   * connects (the WORKER silently assigns host/guest - irrelevant to players).
   * "Play vs CPU" runs a local spoof partner; Cancel backs out to the title.
   * `setModeAndEnd` is the newGame helper that launches the chosen GameMode.
   *
   * `netcodeMode` (#633, selectable A/B) is the co-op netcode the HOST picked from
   * the mode menu ("lockstep" | "authoritative"); it is threaded into both the local
   * spoof session and the real-match host controller so the guest adopts it.
   */
  /**
   * Open the pairing lobby for a co-op OR showdown session. `sessionKind` + `launchMode`
   * default to the classic co-op path (byte-identical); Showdown (C1) passes
   * `("versus", GameModes.SHOWDOWN)` to launch a 1v1 match on the SAME lobby/pairing flow.
   * The kind rides into the session via {@linkcode startLocalCoopSession}/the controller so
   * the guest adopts it off the host's runConfig.
   */
  private openCoopLobby(
    setModeAndEnd: (gameMode: GameModes) => void,
    netcodeMode: CoopNetcodeMode,
    sessionKind: CoopSessionKind = "coop",
    launchMode: GameModes = GameModes.COOP,
  ): void {
    const username = loggedInUser?.username ?? "Player";
    // #810 barrier: how long the GUEST waits for the host's Resume/New Game decision before
    // an anti-hang fallback to NEW GAME. Comfortably longer than the host's own 60s resume
    // offer timeout, so a slow-but-alive human host never trips it; only a dead peer does.
    const COOP_RESUME_GUEST_WAIT_MS = 120_000;
    let listSig: string | null = null;
    let controller: CoopLobbyController | null = null;
    let lastPlayers: LobbyPlayer[] = [];
    /** The incoming join request currently on screen (Accept/Decline panel showing). */
    let incoming: { id: string; name: string } | null = null;
    // The aesthetic stage (backdrop + two seat cards + status strip); the option
    // panel below is the INPUT. Torn down on every exit path.
    const stage = new CoopLobbyStage(username);
    let lobbyTerminated = false;
    let lobbyCompleted = false;
    let flowRuntime: CoopRuntime | null = null;
    let flowController: CoopRuntime["controller"] | null = null;
    let flowGeneration: number | null = null;
    // Lobby polling may reorder the live player list while a human is moving from
    // a highlighted row to ACTION. Preserve the highlighted player by identity,
    // never by its transient array index.
    let selectedLobbyOptionId: string | null = null;
    // When an Accept/Decline takeover disappears, a submit key may already be queued from the
    // old panel. Make the first row inert until a fresh navigation/hover proves the player has
    // selected an action from the new generation.
    let lobbyActionRequiresReselection = false;
    let panelGeneration = 0;

    const isCurrentFlow = (): boolean =>
      !lobbyTerminated
      && !lobbyCompleted
      && flowRuntime != null
      && flowController != null
      && flowGeneration != null
      && this.isExactCoopSession(flowRuntime, flowController, flowGeneration);

    /**
     * Single terminal lobby/resume abort seam. Runtime teardown bumps the co-op session
     * generation and closes transport/watchdogs/hooks, invalidating every late continuation
     * before a replacement TitlePhase can be entered.
     */
    const terminateLobby = () => {
      if (lobbyTerminated) {
        return;
      }
      lobbyTerminated = true;
      stage.destroy();
      controller?.cancel();
      if (flowRuntime != null && flowController != null && flowGeneration != null) {
        this.clearExactCoopSession(flowRuntime, flowController, flowGeneration);
      }
    };

    const backToTitle = () => {
      terminateLobby();
      globalScene.phaseManager.toTitleScreen();
      super.end();
    };

    const terminalFailure = (message: string) => {
      if (lobbyTerminated) {
        return;
      }
      terminateLobby();
      globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.ui.resetModeChain();
      globalScene.ui.showText(message, null, backToTitle, null, true);
    };

    // Render (or re-render) the current INPUT panel as a blue OPTION_SELECT.
    // resetModeChain() clears the previous overlay first, so re-rendering on a
    // state change REPLACES the panel rather than stacking a new one. An incoming
    // join request takes over the panel (Accept / Decline) until it is answered.
    const renderPanel = () => {
      const generation = ++panelGeneration;
      const opts: OptionSelectItem[] = [];
      let initialCursor = 0;
      if (incoming) {
        selectedLobbyOptionId = null;
        const from = incoming;
        opts.push(
          {
            semanticId: `accept:${from.name}`,
            label: `Accept ${from.name}`,
            handler: () => {
              incoming = null;
              void controller?.respond(true);
              return true;
            },
          },
          {
            semanticId: "decline",
            label: "Decline",
            handler: () => {
              incoming = null;
              stage.setSeat(1, { name: null, detail: "Searching...", dot: "amber" });
              stage.setStatus("Looking for other players...");
              void controller?.respond(false);
              renderPanel();
              return true;
            },
          },
        );
      } else {
        if (lobbyActionRequiresReselection) {
          opts.push({
            label: "Lobby updated - choose again",
            handler: () => false,
          });
        }
        const selectedPlayerId = selectedLobbyOptionId?.startsWith("player:")
          ? selectedLobbyOptionId.slice("player:".length)
          : null;
        const selectedPlayerStillPresent = selectedPlayerId == null || lastPlayers.some(p => p.id === selectedPlayerId);
        if (!selectedPlayerStillPresent) {
          opts.push({
            label: "That player left - choose again",
            handler: () => false,
            onHover: () => {
              selectedLobbyOptionId = null;
            },
          });
        }
        for (const p of lastPlayers) {
          const optionIndex = opts.length;
          if (!lobbyActionRequiresReselection && `player:${p.id}` === selectedLobbyOptionId) {
            initialCursor = optionIndex;
          }
          opts.push({
            semanticId: `ask:${p.name}`,
            label: `Ask ${p.name} to play`,
            onHover: () => {
              lobbyActionRequiresReselection = false;
              selectedLobbyOptionId = `player:${p.id}`;
            },
            handler: () => {
              // The player can disappear during the final input frame. Do not let
              // a stale row request somebody else or fall through to Cancel.
              if (!lastPlayers.some(player => player.id === p.id)) {
                renderPanel();
                return false;
              }
              void controller?.request(p.id, p.name);
              return true;
            },
          });
        }
        if (!lobbyActionRequiresReselection && selectedLobbyOptionId === "cpu") {
          initialCursor = opts.length;
        }
        opts.push({
          label: "Play vs CPU",
          onHover: () => {
            lobbyActionRequiresReselection = false;
            selectedLobbyOptionId = "cpu";
          },
          handler: () => {
            stage.destroy();
            controller?.cancel();
            startLocalCoopSession({ username, netcodeMode, kind: sessionKind });
            setModeAndEnd(launchMode);
            return true;
          },
        });
      }
      if (!lobbyActionRequiresReselection && selectedLobbyOptionId === "cancel") {
        initialCursor = opts.length;
      }
      opts.push({
        semanticId: "cancel",
        label: i18next.t("menu:cancel"),
        onHover: () => {
          lobbyActionRequiresReselection = false;
          selectedLobbyOptionId = "cancel";
        },
        handler: () => {
          backToTitle();
          return true;
        },
      });
      globalScene.ui.setMode(UiMode.MESSAGE);
      globalScene.ui.resetModeChain();
      // The panel is right-edge anchored and grows up-left; yOffset 40 drops its bottom to
      // 8px above the screen edge so it sits INSIDE the stage's ACTIONS dock (no overlap
      // with the seat cards), xOffset 2 gives it a right margin, maxOptions bounds a busy
      // lobby to a scrolling list instead of a screen-tall tower.
      globalScene.ui.showText("", null, () => {
        if (generation !== panelGeneration || lobbyTerminated || lobbyCompleted) {
          return;
        }
        globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, {
          options: opts,
          maxOptions: 6,
          xOffset: 2,
          yOffset: 40,
          initialCursor,
          supportHover: true,
          // Swallow a key that was already in flight when polling repainted the
          // menu. This is short enough to be imperceptible but closes the exact
          // select-then-Cancel race seen by real browsers and humans.
          delay: 150,
        });
      });
    };

    controller = new CoopLobbyController(username, {
      onPlayers: players => {
        lastPlayers = players;
        stage.setStatus(
          incoming
            ? `${incoming.name} wants to join your run!`
            : controller?.isRequestPending()
              ? "Waiting for their answer..."
              : players.length > 0
                ? "Pick a player below to send a request."
                : "Looking for other players...",
        );
        const sig = players.map(p => p.id).join(",") + (incoming ? `|req:${incoming.id}` : "");
        if (sig !== listSig) {
          listSig = sig;
          if (!incoming) {
            renderPanel();
          }
        }
      },
      // Lobby v2: someone asked to join US - take over the panel with Accept/Decline.
      onRequest: from => {
        lobbyActionRequiresReselection = false;
        incoming = { id: from.id, name: from.name };
        stage.setSeat(1, { name: from.name, detail: "Wants to join!", dot: "red" });
        stage.setStatus(`${from.name} wants to join your run!`);
        renderPanel();
      },
      onRequestGone: () => {
        incoming = null;
        lobbyActionRequiresReselection = true;
        stage.setSeat(1, { name: null, detail: "Searching...", dot: "amber" });
        stage.setStatus("They withdrew. Looking for other players...");
        renderPanel();
      },
      onRequestPending: targetName => {
        stage.setSeat(1, { name: targetName, detail: "Asked to join", dot: "amber" });
        stage.setStatus(`Request sent to ${targetName}. Waiting for their answer...`);
      },
      onDeclined: name => {
        stage.setSeat(1, { name: null, detail: "Searching...", dot: "amber" });
        stage.setStatus(`${name} declined. Pick another player.`);
        renderPanel();
      },
      onTransientError: message => {
        incoming = null;
        lobbyActionRequiresReselection = true;
        stage.setSeat(1, { name: null, detail: "Lobby changed", dot: "amber" });
        stage.setStatus(`${message} Choose a player again.`);
        renderPanel();
      },
      onConnecting: () => {
        stage.setSeat(1, { name: null, detail: "Connecting...", dot: "amber" });
        stage.setStatus("Connecting to your partner...");
        globalScene.ui.setMode(UiMode.MESSAGE);
        globalScene.ui.resetModeChain();
        globalScene.ui.showText("Connecting to your partner...", null);
      },
      onConnected: runtime => {
        if (lobbyTerminated || getCoopRuntime() !== runtime) {
          return;
        }
        const controller = runtime.controller;
        const sessionGeneration = coopSessionGeneration();
        flowRuntime = runtime;
        flowController = controller;
        flowGeneration = sessionGeneration;
        const isCurrentSession = (): boolean =>
          !lobbyTerminated && !lobbyCompleted && this.isExactCoopSession(runtime, controller, sessionGeneration);
        // Co-op is authoritative-only (#633 M6c); pinning the mode here is a no-op
        // kept for the wire config's back-compat field.
        if (runtime.controller.role === "host") {
          runtime.controller.setNetcodeMode(netcodeMode);
        }
        // Showdown 1v1 (staging fix 2026-07-07): pin the session kind on BOTH roles. Both clients
        // entered this lobby through the same menu entry, so the kind is local knowledge. The old
        // host-only pin relied on broadcastRunConfig to carry it to the guest - that broadcast was
        // removed with the deferred run launch (B7 item 11), which silently left the GUEST on
        // "coop" and disabled every versus gate (perspective flip, showdown command menu, pure-
        // renderer divert): the guest then ran a full live engine on the host's snapshot.
        runtime.controller.setSessionKind(sessionKind);
        // The data channel is open, but peer identity and the functional-build fingerprint may
        // still be in flight. Resume discovery is pair-keyed and then deserializes a full save,
        // so hold both clients until the complete compatibility contract has settled.
        stage.setSeat(1, { name: null, detail: "Verifying...", dot: "amber" });
        stage.setStatus("Connected! Verifying your partner...");
        globalScene.ui.setMode(UiMode.MESSAGE);
        globalScene.ui.resetModeChain();
        globalScene.ui.showText("Connected! Verifying your partner and co-op saves...", null);
        const startNewRun = () => {
          if (!isCurrentSession()) {
            return;
          }
          lobbyCompleted = true;
          stage.destroy();
          setModeAndEnd(launchMode);
        };

        // Showdown 1v1 (B7 item 5): a versus match is EPHEMERAL - it never saves, never resumes,
        // and never picks a save slot. The co-op RESUME / NEW-GAME barrier below (readCoopResumeMarker,
        // the guest resume-decision wait, loadSaveSlot) is a co-op-only feature; running it for versus
        // surfaced an unselectable "wait for the partner to resume or start a new game?" prompt that
        // HARD SOFT-LOCKED both clients post-pairing. Skip the entire barrier for versus on BOTH roles
        // and go straight into the versus teambuild (the negotiate step is the real sync point).
        if (sessionKind === "versus") {
          startNewRun();
          return;
        }

        void controller
          .awaitPartnerCompatibility()
          .then(async identity => {
            if (!isCurrentSession()) {
              return;
            }
            if (identity == null || identity.partnerName == null) {
              console.warn(
                "[coop-resume] peer compatibility barrier failed; keeping lobby closed (no unilateral start)",
              );
              stage.setSeat(1, { name: null, detail: "Reconnect needed", dot: "red" });
              stage.setStatus("Could not verify a compatible partner build. Reconnect and try again.");
              terminalFailure(
                "Could not verify your co-op partner's build. Both players should refresh, reconnect, and try again.",
              );
              return;
            }
            const partner = identity.partnerName;
            stage.setSeat(1, { name: partner, detail: "Connected", dot: "green" });
            stage.setStatus("Connected! Checking for a co-op save...");
            if (identity.localRole === "guest") {
              globalScene.gameData.armCoopResumeCheckpointPersistence();
            }

            // #810 RESUME FLOW (maintainer directive): after the ACCEPT handshake, decide RESUME
            // vs NEW GAME BEFORE anyone advances into starter-select. The HOST owns the decision
            // (it holds the authoritative save + its own resume marker, which BOTH clients now
            // record); the GUEST mirrors a waiting state. BARRIER: neither side calls startNewRun
            // until the choice resolves. Identity is gated by the marker's exact (self, partner)
            // account pair, so a save is never offered/loaded with a different partner.
            if (identity.localRole === "guest") {
              // GUEST: block on the host's decision. Show a mirrored "waiting" state - NO "press to
              // start" (that was the barrier hole: the guest could start a new run while the host
              // was still deciding to resume). Release on EITHER the resume OFFER or the START-NEW
              // signal. If the host goes silent, fail closed to reconnect instead of authorizing a
              // unilateral new run that would split the clients across different states.
              stage.setStatus(`Connected! Waiting for ${partner}...`);
              globalScene.ui.setMode(UiMode.MESSAGE);
              globalScene.ui.resetModeChain();
              globalScene.ui.showText(`Connected! Waiting for ${partner} to choose Resume or New Game...`, null);

              let settled = false;
              /** Claim the single decision; returns true only for the first caller. */
              const claim = (): boolean => {
                if (settled) {
                  return false;
                }
                settled = true;
                return true;
              };
              const guestWaitTimer = setTimeout(() => {
                if (isCurrentSession() && claim()) {
                  console.warn(
                    `[coop-resume] guest: no Resume/New Game from ${partner} in ${COOP_RESUME_GUEST_WAIT_MS}ms -> reconnect (fail-closed)`,
                  );
                  stage.setStatus("Partner decision timed out. Reconnect and try again.");
                  terminalFailure(
                    "Your partner did not finish the co-op save decision. Please reconnect and try again.",
                  );
                }
              }, COOP_RESUME_GUEST_WAIT_MS);

              // Host chose New Game (or had no save / we declined / the offer timed out): release.
              controller.armResumeStartNewHandler(() => {
                clearTimeout(guestWaitTimer);
                if (isCurrentSession() && claim()) {
                  startNewRun();
                }
              });
              controller.armResumeBlockedHandler((reason, wave) => {
                clearTimeout(guestWaitTimer);
                if (!isCurrentSession() || !claim()) {
                  return;
                }
                const message =
                  reason === "unsafe-role-reversal"
                    ? `A co-op save was found at wave ${wave}, but the host/guest seats are reversed. Reconnect with the same player accepting the invite as in the saved run, then choose Continue.`
                    : reason === "legacy-unmappable"
                      ? `A legacy co-op save was found at wave ${wave}, but it has no safe player-seat mapping. This save cannot be resumed without risking swapped Pokemon ownership.`
                      : `A co-op save exists at wave ${wave}, but this account had no verified free save slot for its resume copy (slots were occupied or cloud status was unavailable). Free a slot if needed, then reconnect with this partner; a new game was not started.`;
                terminalFailure(message);
              });
              // Host offers to resume: surface accept/decline. Keep the start-new handler live (the
              // host can still time out and release us). Accept claims Resume; Decline remains behind
              // the barrier until the host durably commits New Game.
              controller.armResumeOfferHandler(commitment => {
                clearTimeout(guestWaitTimer);
                if (settled || !isCurrentSession()) {
                  return;
                }
                if (
                  commitment.gameMode !== GameModes.COOP
                  || !coopSeatMapMatches(
                    { version: 1, players: commitment.participants, seats: commitment.seats },
                    controller.localName(),
                    partner,
                    controller.role,
                  )
                ) {
                  terminalFailure("The co-op resume offer did not match this exact session. Reconnect and try again.");
                  return;
                }
                globalScene.ui.showText(
                  `${partner} wants to resume your saved co-op run (wave ${commitment.wave}). Accept?`,
                  null,
                  () => {
                    if (!isCurrentSession()) {
                      return;
                    }
                    globalScene.ui.setMode(
                      UiMode.CONFIRM,
                      () => {
                        if (isCurrentSession() && claim()) {
                          globalScene.ui.setMode(UiMode.MESSAGE);
                          globalScene.ui.showText(`Waiting for ${partner} to commit the resume...`, null);
                          void controller
                            .replyResume(true)
                            .then(committed => {
                              if (!isCurrentSession()) {
                                return;
                              }
                              if (!committed) {
                                terminalFailure("The resume decision could not be committed. Reconnect and try again.");
                                return;
                              }
                              lobbyCompleted = true;
                              stage.destroy();
                              void this.coopGuestResumeBoot(
                                commitment,
                                runtime,
                                controller,
                                sessionGeneration,
                                terminalFailure,
                              );
                            })
                            .catch(error => {
                              if (!isCurrentSession()) {
                                return;
                              }
                              console.error("[coop-resume] guest resume commit failed", error);
                              terminalFailure("The resume decision could not be committed. Reconnect and try again.");
                            });
                        }
                      },
                      () => {
                        if (!settled && isCurrentSession()) {
                          controller
                            .replyResume(false)
                            .catch(error => console.warn("[coop-resume] failed to relay decline", error));
                          // Stay behind the barrier until the host commits and durably broadcasts
                          // resumeStartNew. Advancing here put the guest in team select while the
                          // host was still showing a message/confirmation screen.
                          globalScene.ui.setMode(UiMode.MESSAGE);
                          globalScene.ui.showText(`Waiting for ${partner} to start a new run...`, null);
                        }
                      },
                    );
                  },
                  null,
                  true,
                );
              });
              return;
            }

            // Every host non-resume path relays the release so the waiting guest never hangs.
            const hostStartNew = () => {
              if (!isCurrentSession()) {
                return;
              }
              globalScene.ui.setMode(UiMode.MESSAGE);
              globalScene.ui.showText(`Waiting for ${partner} to enter team selection...`, null);
              void controller
                .sendResumeStartNew()
                .then(acknowledged => {
                  if (!isCurrentSession()) {
                    return;
                  }
                  if (acknowledged) {
                    startNewRun();
                  } else {
                    terminalFailure("Could not commit the new co-op run. Reconnect and try again.");
                  }
                })
                .catch(error => {
                  if (!isCurrentSession()) {
                    return;
                  }
                  console.error("[coop-resume] start-new commit failed", error);
                  terminalFailure("Could not commit the new co-op run. Reconnect and try again.");
                });
            };

            // HOST: is there a saved run with EXACTLY this partner (self+partner account pair)?
            // Keep failures attached to their slots. A corrupt/ambiguous slot must not hide a valid
            // candidate elsewhere or tear down an otherwise healthy paired transport.
            const resumeSnapshot = await globalScene.gameData.getCoopResumeLobbySnapshot();
            const discovery = await findCoopResumeCandidate(
              controller.localName(),
              partner,
              controller.role,
              async slot => {
                const failure = resumeSnapshot.failures.get(slot);
                if (failure != null) {
                  throw failure;
                }
                return resumeSnapshot.sessions.get(slot);
              },
            );
            if (!isCurrentSession()) {
              return;
            }
            const blockedMessage = coopResumeBlockMessage(discovery);
            if (blockedMessage != null && discovery.kind !== "candidate" && discovery.kind !== "no-save") {
              if (discovery.kind !== "replica-unavailable") {
                // A fresh run is safe even when an old slot is quarantined: SelectStarterPhase
                // independently proves a different slot empty in both local and cloud storage,
                // fences it across the launch, and wins the backend empty-slot CAS before release.
                // Require an explicit press so an ambiguous/legacy save is never silently ignored.
                stage.setStatus("A save conflict was isolated. Start a separate run?");
                globalScene.ui.setMode(UiMode.MESSAGE);
                globalScene.ui.showText(
                  `${blockedMessage}\n\nPress to start a separate co-op run. Existing saves will not be overwritten.`,
                  null,
                  hostStartNew,
                  null,
                  true,
                );
                return;
              }
              const acknowledged = await controller.sendResumeBlocked(discovery.kind, discovery.wave);
              if (!isCurrentSession()) {
                return;
              }
              if (!acknowledged) {
                console.warn(`[coop-resume] guest did not ACK blocked-save reason=${discovery.kind}`);
              }
              terminalFailure(blockedMessage);
              return;
            }
            const marker = discovery.kind === "candidate" ? discovery.candidate : null;
            if (marker == null) {
              // Release the guest only when the host actually presses Start. Sending this before
              // the prompt caused the live split: guest in team select, host still in the lobby.
              globalScene.ui.showText(
                "Connected to your partner!\nPress to start co-op.",
                null,
                hostStartNew,
                null,
                true,
              );
              return;
            }
            // Offer the HOST a real RESUME / NEW GAME choice.
            globalScene.ui.showText(
              `Found a saved co-op run with ${partner} (wave ${marker.wave}). Resume it?`,
              null,
              () => {
                if (!isCurrentSession()) {
                  return;
                }
                globalScene.ui.setMode(
                  UiMode.CONFIRM,
                  () => {
                    if (!isCurrentSession()) {
                      return;
                    }
                    // RESUME: relay the offer; both proceed identically on accept. offerResume has
                    // its own 60s no-reply timeout -> resolves false -> we fall to NEW GAME (and
                    // release the guest), so the barrier can never hang on an unresponsive guest.
                    globalScene.ui.setMode(UiMode.MESSAGE);
                    globalScene.ui.showText(`Waiting for ${partner} to accept...`, null);
                    void controller
                      .offerResume(marker.commitment)
                      .then(accepted => {
                        if (!isCurrentSession()) {
                          return;
                        }
                        if (accepted) {
                          lobbyCompleted = true;
                          stage.destroy();
                          void this.loadCoopResumeSlot(marker, runtime, controller, sessionGeneration, terminalFailure);
                        } else {
                          // The guest remains behind the barrier after declining; this single durable
                          // release moves both clients into team select together.
                          hostStartNew();
                        }
                      })
                      .catch(error => {
                        if (!isCurrentSession()) {
                          return;
                        }
                        console.error("[coop-resume] resume offer failed", error);
                        terminalFailure("Could not commit the co-op resume. Reconnect and try again.");
                      });
                  },
                  // NEW GAME: release the guest and start fresh.
                  hostStartNew,
                );
              },
              null,
              true,
            );
          })
          .catch(error => {
            if (!isCurrentSession()) {
              return;
            }
            console.error("[coop-resume] identity/resume decision failed", error);
            terminalFailure("Could not check co-op saves. Please reconnect and try again.");
          });
      },
      onError: e => {
        if (flowRuntime == null || isCurrentFlow()) {
          terminalFailure(`Co-op error:\n${e}`);
        }
      },
    });

    // Enter the lobby: clear the mode menu and show the stage while we announce.
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.resetModeChain();
    globalScene.ui.showText("Finding co-op players...", null);
    void controller.start();
  }

  /**
   * #810 GUEST resume boot: the host is loading its save and its EncounterPhase pushes the
   * full session snapshot for the resumed wave (the same machinery as every co-op hard
   * transition). Await it, apply it, and enter the run as a LOADED encounter - the guest
   * computes nothing, so a resumed run cannot diverge at boot.
   */
  private async coopGuestResumeBoot(
    commitment: CoopResumeCommitment,
    runtime: CoopRuntime,
    controller: CoopRuntime["controller"],
    generation: number,
    terminalFailure: (message: string) => void,
  ): Promise<void> {
    if (!this.isExactCoopSession(runtime, controller, generation)) {
      return;
    }
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.resetModeChain();
    globalScene.ui.showText("Resuming co-op run...", null);
    this.gameMode = GameModes.COOP;
    globalScene.gameMode = getGameMode(GameModes.COOP);
    let booted = false;
    let resumeJson: string | null = null;
    try {
      const json = await runtime.battleStream.awaitLaunchSnapshot(commitment.wave);
      if (!this.isExactCoopSession(runtime, controller, generation)) {
        return;
      }
      resumeJson = json;
      booted = json != null && (await globalScene.gameData.applyCoopLaunchSession(json, commitment));
      if (!this.isExactCoopSession(runtime, controller, generation)) {
        return;
      }
    } catch (error) {
      // A parsed snapshot can still fail during asset/session materialization. Convert every such
      // failure into the explicit negative half of the two-phase resume transaction so the host
      // never waits for its long timeout while this client has already fallen out of the flow.
      if (!this.isExactCoopSession(runtime, controller, generation)) {
        return;
      }
      console.error(`[coop-resume] guest: resume materialization threw for wave=${commitment.wave}`, error);
      booted = false;
    }
    if (!booted) {
      const acknowledged = await controller.reportResumeApplied(false);
      if (!this.isExactCoopSession(runtime, controller, generation)) {
        return;
      }
      console.warn(
        `[coop-resume] guest: no/unusable resume snapshot for wave=${commitment.wave} ack=${acknowledged} -> fail closed`,
      );
      terminalFailure("Could not apply the shared co-op save. Reconnect and try again.");
      return;
    }
    const persisted =
      resumeJson == null
        ? { success: false as const, reason: "invalid-checkpoint" as const }
        : await globalScene.gameData.persistCurrentCoopResumeCheckpoint(resumeJson, commitment, true);
    if (!this.isExactCoopSession(runtime, controller, generation)) {
      return;
    }
    if (!persisted.success) {
      const acknowledged = await controller.reportResumeApplied(false);
      if (this.isExactCoopSession(runtime, controller, generation)) {
        console.warn(
          `[coop-resume] guest: exact resume persistence failed reason=${persisted.reason ?? "unknown"} ack=${acknowledged}`,
        );
        terminalFailure("Could not durably store the shared co-op save. Reconnect and try again.");
      }
      return;
    }
    const acknowledged = await controller.reportResumeApplied(true);
    if (!this.isExactCoopSession(runtime, controller, generation)) {
      return;
    }
    if (!acknowledged) {
      terminalFailure("Your partner did not confirm the resumed state. Reconnect and try again.");
      return;
    }
    if (!(await controller.awaitResumeGameplayRelease())) {
      if (this.isExactCoopSession(runtime, controller, generation)) {
        terminalFailure("The final co-op resume barrier did not complete. Reconnect and try again.");
      }
      return;
    }
    if (!this.isExactCoopSession(runtime, controller, generation)) {
      return;
    }
    console.log(`[coop-resume] guest: booted from resume snapshot wave=${commitment.wave} -> LOADED EncounterPhase`);
    this.loaded = true;
    this.end();
  }

  /**
   * HOST half of the two-phase resume transaction. Load the save, push its coherent snapshot immediately,
   * then remain at the lobby boundary until the guest reports successful materialization. This removes the
   * former split where a reply meant "accepted" but either client could enter gameplay before the other had
   * actually loaded the same state.
   */
  private async loadCoopResumeSlot(
    candidate: CoopResumeCandidate,
    runtime: CoopRuntime,
    controller: CoopRuntime["controller"],
    generation: number,
    terminalFailure: (message: string) => void,
  ): Promise<void> {
    if (!this.isExactCoopSession(runtime, controller, generation)) {
      return;
    }
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.resetModeChain();
    globalScene.sessionSlotId = candidate.slot;
    try {
      // Apply the exact bytes validated during discovery. Never re-read the mutable slot after
      // the human and guest have committed to its digest (closes the scan->load TOCTOU seam).
      const success = await globalScene.gameData.applyCoopLaunchSession(candidate.sessionJson, candidate.commitment);
      if (!this.isExactCoopSession(runtime, controller, generation)) {
        return;
      }
      if (!success) {
        terminalFailure("Could not load the shared co-op save. Reconnect and try again.");
        return;
      }
      runtime.battleStream.sendLaunchSnapshot(candidate.commitment.wave, candidate.sessionJson);
      globalScene.ui.showText("Waiting for your partner to apply the shared save...", null);
      if (!(await controller.awaitResumeApplied())) {
        if (!this.isExactCoopSession(runtime, controller, generation)) {
          return;
        }
        terminalFailure("Your partner could not apply the shared co-op save. Reconnect and try again.");
        return;
      }
      if (!this.isExactCoopSession(runtime, controller, generation)) {
        return;
      }
      if (!(await controller.releaseResumeGameplay())) {
        if (this.isExactCoopSession(runtime, controller, generation)) {
          terminalFailure("The final co-op resume barrier did not complete. Reconnect and try again.");
        }
        return;
      }
      if (!this.isExactCoopSession(runtime, controller, generation)) {
        return;
      }
      this.loaded = true;
      globalScene.ui.showText(i18next.t("menu:sessionSuccess"), null);
      this.end();
    } catch (err) {
      if (!this.isExactCoopSession(runtime, controller, generation)) {
        return;
      }
      console.error(err);
      terminalFailure(i18next.t("menu:failedToLoadSession"));
    }
  }

  // TODO: Make callers actually wait for the save slot to load
  private async loadSaveSlot(slotId: number): Promise<void> {
    // TODO: Do we need to `await` this?
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.resetModeChain();
    globalScene.sessionSlotId = slotId;
    try {
      const success = await globalScene.gameData.loadSession(slotId);
      if (success) {
        this.loaded = true;
        globalScene.ui.showText(i18next.t("menu:sessionSuccess"), null, () => this.end());
      } else {
        this.returnToTitleAfterSaveLoadFailure();
      }
    } catch (err) {
      console.error(err);
      this.returnToTitleAfterSaveLoadFailure();
    }
  }

  private returnToTitleAfterSaveLoadFailure(): void {
    this.loaded = false;
    globalScene.ui.showText(
      `${i18next.t("menu:failedToLoadSession")} If this is a co-op save, choose New Game > Co-op and connect to the exact saved partner before continuing.`,
      null,
      () => {
        void this.showOptions(NO_SAVE_SLOT);
      },
      null,
      true,
    );
  }

  initDailyRun(): void {
    globalScene.ui.clearText();
    globalScene.ui.setMode(UiMode.SAVE_SLOT, SaveSlotUiMode.SAVE, (slotId: number) => {
      if (slotId === -1) {
        globalScene.phaseManager.toTitleScreen();
        super.end();
        return;
      }
      globalScene.phaseManager.clearPhaseQueue();
      globalScene.sessionSlotId = slotId;

      const generateDaily = (seed: string) => {
        globalScene.gameMode = getGameMode(GameModes.DAILY);

        seed = globalScene.gameMode.trySetCustomDailyConfig(seed);

        // Daily runs don't support all challenges yet (starter select restrictions aren't considered)
        startDailyEventChallenges();

        globalScene.setSeed(seed);
        globalScene.resetSeed();

        globalScene.money = globalScene.gameMode.getStartingMoney();

        const starters = getDailyRunStarters();
        const startingLevel = globalScene.gameMode.getStartingLevel();

        // TODO: Dedupe this
        const party = globalScene.getPlayerParty();
        const loadPokemonAssets: Promise<void>[] = [];
        for (const [index, starter] of starters.entries()) {
          const species = getPokemonSpecies(starter.speciesId);
          const starterFormIndex = starter.formIndex;
          const starterGender =
            species.malePercent === null ? Gender.GENDERLESS : starter.female ? Gender.FEMALE : Gender.MALE;
          const starterPokemon = globalScene.addPlayerPokemon(
            species,
            startingLevel,
            starter.abilityIndex,
            starterFormIndex,
            starterGender,
            starter.shiny,
            starter.variant,
            starter.ivs,
            starter.nature,
          );
          starterPokemon.setVisible(false);
          if (starter.moveset) {
            // avoid validating daily run starter movesets which are pre-populated already
            starterPokemon.tryPopulateMoveset(starter.moveset, true);
          }

          const customStarterConfig = globalScene.gameMode.dailyConfig?.starters?.[index];
          if (customStarterConfig?.ability != null) {
            starterPokemon.customPokemonData.ability = customStarterConfig.ability;
          }
          if (customStarterConfig?.passive != null) {
            starterPokemon.customPokemonData.passive = customStarterConfig.passive;
          }

          party.push(starterPokemon);
          loadPokemonAssets.push(starterPokemon.loadAssets());
        }

        regenerateModifierPoolThresholds(party, ModifierPoolType.DAILY_STARTER);

        const modifiers: Modifier[] = new Array(3)
          .fill(null)
          .map(() => modifierTypes.EXP_SHARE().withIdFromFunc(modifierTypes.EXP_SHARE).newModifier())
          .concat(
            new Array(3)
              .fill(null)
              .map(() => modifierTypes.GOLDEN_EXP_CHARM().withIdFromFunc(modifierTypes.GOLDEN_EXP_CHARM).newModifier()),
          )
          .concat([modifierTypes.MAP().withIdFromFunc(modifierTypes.MAP).newModifier()])
          .concat([modifierTypes.ABILITY_CHARM().withIdFromFunc(modifierTypes.ABILITY_CHARM).newModifier()])
          .concat([modifierTypes.SHINY_CHARM().withIdFromFunc(modifierTypes.SHINY_CHARM).newModifier()])
          .concat(getDailyRunStarterModifiers(party))
          .filter(m => m !== null);

        for (const m of modifiers) {
          globalScene.addModifier(m, true, false, false, true);
        }
        for (const m of timedEventManager.getEventDailyStartingItems()) {
          globalScene.addModifier(
            modifierTypes[m]().withIdFromFunc(modifierTypes[m]).newModifier(),
            true,
            false,
            false,
            true,
          );
        }
        globalScene.updateModifiers(true, true);

        Promise.all(loadPokemonAssets).then(() => {
          globalScene.time.delayedCall(500, () => globalScene.playBgm());
          globalScene.gameData.gameStats.dailyRunSessionsPlayed++;
          globalScene.newArena(globalScene.gameMode.getStartingBiome());
          globalScene.newBattle();
          globalScene.arena.init();
          globalScene.sessionPlayTime = 0;
          globalScene.lastSavePlayTime = 0;
          this.end();
        });
      };

      // If Online, calls seed fetch from db to generate daily run. If Offline, generates a daily run based on current date.
      if (!bypassLogin || isLocalServerConnected) {
        pokerogueApi.daily
          .getSeed()
          .then(seed => {
            if (seed) {
              generateDaily(seed);
            } else {
              throw new Error("Daily run seed is null!");
            }
          })
          .catch(err => {
            console.error("Failed to load daily run:\n", err);
          });
      } else {
        // Grab first 10 chars of ISO date format (YYYY-MM-DD) and convert to base64.
        // toISOString() is UTC, so two players normally agree - but at the UTC-midnight
        // rollover one client can land on the next day, producing a DIFFERENT daily seed
        // and desyncing the co-op run from wave 1.
        let seed: string = btoa(new Date().toISOString().slice(0, 10));
        // Co-op (#633 Fix #4i): the GUEST adopts the HOST's authoritative run seed (mirrored
        // via runConfig) for the offline daily, so both clients share ONE date string even
        // across the rollover edge. Falls back to the local UTC date when no host seed is
        // available yet. Solo / host keep the local-date path unchanged.
        const coopHostSeed = getCoopController()?.runConfig()?.seed;
        if (coopHostSeed != null && getCoopController()?.role === "guest") {
          seed = coopHostSeed;
        }
        if (Overrides.DAILY_RUN_SEED_OVERRIDE != null) {
          seed =
            typeof Overrides.DAILY_RUN_SEED_OVERRIDE === "string"
              ? Overrides.DAILY_RUN_SEED_OVERRIDE
              : JSON.stringify(Overrides.DAILY_RUN_SEED_OVERRIDE);
        }
        generateDaily(seed);
      }
    });
  }

  // TODO: Refactor this
  end(): void {
    if (!this.loaded && !globalScene.gameMode.isDaily) {
      globalScene.loadBgm(globalScene.arena.bgm);
      globalScene.gameMode = getGameMode(this.gameMode);
      // ER Community Challenge: getGameMode just re-cloned every challenge at value
      // 0, so apply the community config (baseChallenges + difficulty + seed +
      // species whitelist) onto the freshly-rebuilt gameMode now, before any phase
      // reads it. Verbatim with the config (the worker config-match anti-cheat key).
      if (this.pendingCommunityConfig) {
        applyCommunityChallengeToRun(this.pendingCommunityConfig);
        console.log("[community-launch] end(): config applied, pushing SelectStarterPhase", {
          gameMode: GameModes[this.gameMode],
        });
      }
      // For LLM Director mode: kick off bible generation in the BACKGROUND
      // before starter select so the LLM call runs in parallel with the
      // player picking starters. The bible is awaited (or no-op if already
      // resolved) by LLMDirectorBiblePhase pushed after starter select.
      if (this.gameMode === GameModes.LLM_DIRECTOR) {
        globalScene.phaseManager.pushNew("LLMDirectorStartPhase");
      }
      // Co-op (#633): only the HOST picks challenges; the GUEST skips the
      // challenge-select screen entirely and mirrors the host's choice via the
      // runConfig sync (the host's Start broadcasts difficulty + challenges). Without
      // this the guest also saw + picked its own challenges, which was incoherent.
      const isCoopGuest = this.gameMode === GameModes.COOP && getCoopController()?.role === "guest";
      if (this.gameMode === GameModes.COOP) {
        console.log(
          `[coop-launch] title challenge-gate: role=${getCoopController()?.role ?? "NO-CONTROLLER"} isCoopGuest=${isCoopGuest} -> ${
            isCoopGuest ? "SelectStarterPhase" : "SelectChallengePhase"
          }`,
        );
      }
      // ER Community Challenge: a community card already carries its full ruleset
      // (applied above), so skip the challenge-select screen and go straight to
      // starter-select - just like a coop guest mirroring the host's config.
      if (
        (this.gameMode === GameModes.CHALLENGE || this.gameMode === GameModes.COOP)
        && !isCoopGuest
        && !this.pendingCommunityConfig // B7 item 14a: a VERSUS (showdown) session goes Title/lobby -> SelectStarterPhase directly, never // the challenge picker. A correctly-launched versus run has gameMode SHOWDOWN (already excluded // here), but guard on the session KIND too so a versus run can never surface the picker even if // its gameMode were ever misread as COOP. Co-op (kind "coop") is unaffected.
        && !isVersusSession()
      ) {
        globalScene.phaseManager.pushNew("SelectChallengePhase");
      } else {
        globalScene.phaseManager.pushNew("SelectStarterPhase");
      }
      if (this.gameMode === GameModes.LLM_DIRECTOR) {
        globalScene.phaseManager.pushNew("LLMDirectorBiblePhase");
      }
      globalScene.newArena(globalScene.gameMode.getStartingBiome());
    } else {
      globalScene.playBgm();
    }

    // Showdown 1v1 (staging fix 2026-07-08): the versus GUEST's battle launches ONLY from the
    // post-wager snapshot boot (tryCoopGuestSnapshotBoot pushes its own LOADED EncounterPhase).
    // The standard new-run EncounterPhase queued here ran FIRST as an UNLOADED encounter -
    // adopting the UNSWAPPED coop enemy payload and generating a second world on top of the
    // swapped snapshot (the log-confirmed double-launch: two EncounterPhases, three summons,
    // dangling queue entries). The HOST keeps this phase - its initBattle feeds it.
    const isVersusGuestLaunch = this.gameMode === GameModes.SHOWDOWN && getCoopController()?.role === "guest";
    if (!isVersusGuestLaunch) {
      globalScene.phaseManager.pushNew("EncounterPhase", this.loaded);
    }

    // RESUME: a saved LLM Director run rehydrates llmDirectorState (bible,
    // beat history, factionRep, alignment, flags) but the runtime queue's
    // generator is process-scoped — its placeholder throws until BiblePhase
    // calls setGenerator. Without re-running BiblePhase on load, beats
    // never generate and the player sees no story. BiblePhase's resume
    // path takes the persisted bible, skips regeneration + intro narration,
    // and just rewires the queue. The 2nd ctor arg (isResume=true)
    // explicitly flags this so the phase doesn't try to detect resume
    // from state alone (which can mis-trigger on a fresh run that
    // inherits leftover state from a previous in-process run).
    if (this.loaded && globalScene.gameMode.modeId === GameModes.LLM_DIRECTOR) {
      globalScene.phaseManager.pushNew("LLMDirectorBiblePhase", 1, true);
    }

    if (this.loaded) {
      const availablePartyMembers = globalScene.getPokemonAllowedInBattle().length;

      globalScene.phaseManager.pushNew("SummonPhase", 0, true, true);
      if (globalScene.currentBattle.double && availablePartyMembers > 1) {
        globalScene.phaseManager.pushNew("SummonPhase", 1, true, true);
      }

      if (
        globalScene.currentBattle.battleType !== BattleType.TRAINER
        && (globalScene.currentBattle.waveIndex > 1 || !globalScene.gameMode.isDaily)
      ) {
        // Format-capacity, not `double ? 2 : 1` (a loaded TRIPLE got one prompt max):
        // a switch prompt per field slot whenever a benched spare exists.
        const battlerCount = globalScene.currentBattle.getBattlerCount();
        if (availablePartyMembers > battlerCount) {
          for (let i = 0; i < battlerCount; i++) {
            globalScene.phaseManager.pushNew("CheckSwitchPhase", i, battlerCount > 1);
          }
        }
      }
    }

    // TODO: Move this to a migrate script instead of running it on save slot load
    for (const achv of Object.keys(globalScene.gameData.achvUnlocks)) {
      if (Object.hasOwn(vouchers, achv) && achv !== "CLASSIC_VICTORY") {
        globalScene.validateVoucher(vouchers[achv]);
      }
    }

    super.end();
  }
}
