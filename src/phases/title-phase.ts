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
import { readCoopResumeMarker } from "#data/elite-redux/coop/coop-resume-marker";
import {
  getCoopBattleStreamer,
  getCoopController,
  isVersusSession,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopNetcodeMode, CoopSessionKind } from "#data/elite-redux/coop/coop-transport";
import { buildInfernoFeed } from "#data/elite-redux/er-community-challenge-inferno";
import { applyCommunityChallengeToRun } from "#data/elite-redux/er-community-challenge-launch";
import type { CommunityChallengeConfig } from "#data/elite-redux/er-community-challenges";
import { resetCommunityRunState } from "#data/elite-redux/er-community-run-state";
import { setPendingShowdownPresetStarters } from "#data/elite-redux/showdown/showdown-battle-state";
import { syncShowdownPendingSettlements } from "#data/elite-redux/showdown/showdown-escrow-client";
import { manifestToStarter, starterToManifest } from "#data/elite-redux/showdown/showdown-manifest";
import { buildTeamMenuPresetViews, runShowdownPresetBuild } from "#data/elite-redux/showdown/showdown-team-menu-flow";
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
import { DomShowdownEditorTextInput } from "#ui/showdown-editor-text-input";
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
        label: i18next.t("continue", { ns: "menu" }),
        handler: () => {
          this.loadSaveSlot(lastSessionSlot);
          return true;
        },
      });
    }
    options.push(
      {
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
          }
          options.push({
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
      void globalScene.ui.setMode(UiMode.SHOWDOWN_TEAM_MENU, config).then(() => {
        const handler = globalScene.ui.getHandler();
        (handler as ShowdownTeamMenuUiHandler).setTextInput?.(new DomShowdownEditorTextInput());
      });
    };
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.resetModeChain();
    globalScene.ui.showText("", null, () => showMenu());
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
    const prevGameMode = this.gameMode;
    globalScene.gameMode = getGameMode(GameModes.SHOWDOWN);
    const defaultName =
      editIndex === undefined ? "Team" : (gameData.listShowdownTeamPresets()[editIndex]?.name ?? "Team");
    runShowdownPresetBuild(editIndex, defaultName, {
      openStarterSelect: onLockIn => {
        void globalScene.ui.setMode(UiMode.STARTER_SELECT, (starters: Starter[]) => {
          globalScene.ui.clearText();
          onLockIn(starters);
        });
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
      onSettled: () => {
        // Restore the pre-build gameMode (the offline build only borrowed SHOWDOWN to drive the
        // teambuild UI - no run was launched) and reopen the Team Menu with the saved team shown.
        globalScene.gameMode = getGameMode(prevGameMode);
        onSettled();
      },
    });
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

    const backToTitle = () => {
      stage.destroy();
      controller?.cancel();
      globalScene.phaseManager.toTitleScreen();
      super.end();
    };

    // Render (or re-render) the current INPUT panel as a blue OPTION_SELECT.
    // resetModeChain() clears the previous overlay first, so re-rendering on a
    // state change REPLACES the panel rather than stacking a new one. An incoming
    // join request takes over the panel (Accept / Decline) until it is answered.
    const renderPanel = () => {
      const opts: OptionSelectItem[] = [];
      if (incoming) {
        const from = incoming;
        opts.push(
          {
            label: `Accept ${from.name}`,
            handler: () => {
              incoming = null;
              void controller?.respond(true);
              return true;
            },
          },
          {
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
        for (const p of lastPlayers) {
          opts.push({
            label: `Ask ${p.name} to play`,
            handler: () => {
              void controller?.request(p.id, p.name);
              return true;
            },
          });
        }
        opts.push({
          label: "Play vs CPU",
          handler: () => {
            stage.destroy();
            controller?.cancel();
            startLocalCoopSession({ username, netcodeMode, kind: sessionKind });
            setModeAndEnd(launchMode);
            return true;
          },
        });
      }
      opts.push({
        label: i18next.t("menu:cancel"),
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
      globalScene.ui.showText("", null, () =>
        globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, { options: opts, maxOptions: 6, xOffset: 2, yOffset: 40 }),
      );
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
        incoming = { id: from.id, name: from.name };
        stage.setSeat(1, { name: from.name, detail: "Wants to join!", dot: "red" });
        stage.setStatus(`${from.name} wants to join your run!`);
        renderPanel();
      },
      onRequestGone: () => {
        incoming = null;
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
      },
      onConnecting: () => {
        stage.setSeat(1, { name: null, detail: "Connecting...", dot: "amber" });
        stage.setStatus("Connecting to your partner...");
        globalScene.ui.setMode(UiMode.MESSAGE);
        globalScene.ui.resetModeChain();
        globalScene.ui.showText("Connecting to your partner...", null);
      },
      onConnected: runtime => {
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
        const controller = runtime.controller;
        const partner = controller.partnerName ?? "Partner";
        stage.setSeat(1, { name: partner, detail: "Connected", dot: "green" });
        stage.setStatus("Connected! Starting co-op...");
        const startNewRun = () => {
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

        // #810 RESUME FLOW (maintainer directive): after the ACCEPT handshake, decide RESUME
        // vs NEW GAME BEFORE anyone advances into starter-select. The HOST owns the decision
        // (it holds the authoritative save + its own resume marker, which BOTH clients now
        // record); the GUEST mirrors a waiting state. BARRIER: neither side calls startNewRun
        // until the choice resolves. Identity is gated by the marker's exact (self, partner)
        // account pair, so a save is never offered/loaded with a different partner.
        if (controller.role === "guest") {
          // GUEST: block on the host's decision. Show a mirrored "waiting" state - NO "press to
          // start" (that was the barrier hole: the guest could start a new run while the host
          // was still deciding to resume). Release on EITHER the resume OFFER or the START-NEW
          // signal; an anti-hang timeout falls back to NEW GAME with a loud warn if the host
          // goes silent (dropped signal / dead peer).
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
            if (claim()) {
              console.warn(
                `[coop-resume] guest: no Resume/New Game from ${partner} in ${COOP_RESUME_GUEST_WAIT_MS}ms -> NEW GAME (anti-hang)`,
              );
              startNewRun();
            }
          }, COOP_RESUME_GUEST_WAIT_MS);

          // Host chose New Game (or had no save / we declined / the offer timed out): release.
          controller.armResumeStartNewHandler(() => {
            clearTimeout(guestWaitTimer);
            if (claim()) {
              startNewRun();
            }
          });
          // Host offers to resume: surface accept/decline. Keep the start-new handler live (the
          // host can still time out and release us); only a user answer here claims the decision.
          controller.armResumeOfferHandler(wave => {
            clearTimeout(guestWaitTimer);
            if (settled) {
              return;
            }
            globalScene.ui.showText(
              `${partner} wants to resume your saved co-op run (wave ${wave}). Accept?`,
              null,
              () => {
                globalScene.ui.setMode(
                  UiMode.CONFIRM,
                  () => {
                    if (claim()) {
                      controller.replyResume(true);
                      stage.destroy();
                      void this.coopGuestResumeBoot(wave);
                    }
                  },
                  () => {
                    if (claim()) {
                      controller.replyResume(false);
                      startNewRun();
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

        // HOST: is there a saved run with EXACTLY this partner (self+partner account pair)?
        const marker = readCoopResumeMarker(controller.localName(), controller.partnerName);
        // Every host non-resume path relays the release so the waiting guest never hangs.
        const hostStartNew = () => {
          controller.sendResumeStartNew();
          startNewRun();
        };
        if (marker == null) {
          controller.sendResumeStartNew();
          globalScene.ui.showText("Connected to your partner!\nPress to start co-op.", null, startNewRun, null, true);
          return;
        }
        // Offer the HOST a real RESUME / NEW GAME choice.
        globalScene.ui.showText(
          `Found a saved co-op run with ${partner} (wave ${marker.wave}). Resume it?`,
          null,
          () => {
            globalScene.ui.setMode(
              UiMode.CONFIRM,
              () => {
                // RESUME: relay the offer; both proceed identically on accept. offerResume has
                // its own 60s no-reply timeout -> resolves false -> we fall to NEW GAME (and
                // release the guest), so the barrier can never hang on an unresponsive guest.
                globalScene.ui.setMode(UiMode.MESSAGE);
                globalScene.ui.showText(`Waiting for ${partner} to accept...`, null);
                void controller.offerResume(marker.wave).then(accepted => {
                  if (accepted) {
                    stage.destroy();
                    void this.loadSaveSlot(marker.slot);
                  } else {
                    globalScene.ui.showText(`${partner} declined. Starting a new run.`, null, hostStartNew, null, true);
                  }
                });
              },
              // NEW GAME: release the guest and start fresh.
              hostStartNew,
            );
          },
          null,
          true,
        );
      },
      onError: e => {
        globalScene.ui.showText(`Co-op error:\n${e}`, null, backToTitle, null, true);
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
  private async coopGuestResumeBoot(wave: number): Promise<void> {
    globalScene.ui.setMode(UiMode.MESSAGE);
    globalScene.ui.resetModeChain();
    globalScene.ui.showText("Resuming co-op run...", null);
    this.gameMode = GameModes.COOP;
    globalScene.gameMode = getGameMode(GameModes.COOP);
    const streamer = getCoopBattleStreamer();
    const json = streamer == null ? null : await streamer.awaitLaunchSnapshot(wave);
    if (json == null || !(await globalScene.gameData.applyCoopLaunchSession(json))) {
      console.warn(`[coop-resume] guest: no/unusable resume snapshot for wave=${wave} -> new run instead`);
      globalScene.ui.showText("Could not resume the run. Starting a new one.", null, () => this.end(), null, true);
      return;
    }
    console.log(`[coop-resume] guest: booted from resume snapshot wave=${wave} -> LOADED EncounterPhase`);
    this.loaded = true;
    this.end();
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
        this.end();
      }
    } catch (err) {
      console.error(err);
      globalScene.ui.showText(i18next.t("menu:failedToLoadSession"), null);
    }
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
