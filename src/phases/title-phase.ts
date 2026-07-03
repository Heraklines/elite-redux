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
import { getCoopBattleStreamer, getCoopController, startLocalCoopSession } from "#data/elite-redux/coop/coop-runtime";
import type { CoopNetcodeMode } from "#data/elite-redux/coop/coop-transport";
import { buildInfernoFeed } from "#data/elite-redux/er-community-challenge-inferno";
import { applyCommunityChallengeToRun } from "#data/elite-redux/er-community-challenge-launch";
import type { CommunityChallengeConfig } from "#data/elite-redux/er-community-challenges";
import { resetCommunityRunState } from "#data/elite-redux/er-community-run-state";
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
import type { OptionSelectConfig, OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { CoopLobbyStage } from "#ui/coop-lobby-stage";
import { SaveSlotUiMode } from "#ui/save-slot-select-ui-handler";
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
  private openCoopLobby(setModeAndEnd: (gameMode: GameModes) => void, netcodeMode: CoopNetcodeMode): void {
    const username = loggedInUser?.username ?? "Player";
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
            startLocalCoopSession({ username, netcodeMode });
            setModeAndEnd(GameModes.COOP);
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
        const partner = runtime.controller.partnerName ?? "Partner";
        stage.setSeat(1, { name: partner, detail: "Connected", dot: "green" });
        stage.setStatus("Connected! Starting co-op...");
        const startNewRun = () => {
          stage.destroy();
          setModeAndEnd(GameModes.COOP);
        };
        // #810 RESUME FLOW: the lobby remembers a saved run with THIS partner.
        // GUEST: arm the offer handler first (the host's offer can arrive any moment).
        if (runtime.controller.role === "guest") {
          runtime.controller.armResumeOfferHandler(wave => {
            globalScene.ui.showText(
              `${partner} wants to resume your saved co-op run (wave ${wave}). Accept?`,
              null,
              () => {
                globalScene.ui.setMode(
                  UiMode.CONFIRM,
                  () => {
                    runtime.controller.replyResume(true);
                    stage.destroy();
                    void this.coopGuestResumeBoot(wave);
                  },
                  () => {
                    runtime.controller.replyResume(false);
                    startNewRun();
                  },
                );
              },
              null,
              true,
            );
          });
        }
        // HOST: if a saved run with this partner exists, offer to resume it.
        const marker = runtime.controller.role === "host" ? readCoopResumeMarker(partner) : null;
        if (marker != null) {
          globalScene.ui.showText(
            `Found a saved co-op run with ${partner} (wave ${marker.wave}). Resume it?`,
            null,
            () => {
              globalScene.ui.setMode(
                UiMode.CONFIRM,
                () => {
                  globalScene.ui.setMode(UiMode.MESSAGE);
                  globalScene.ui.showText(`Waiting for ${partner} to accept...`, null);
                  void runtime.controller.offerResume(marker.wave).then(accepted => {
                    if (accepted) {
                      stage.destroy();
                      void this.loadSaveSlot(marker.slot);
                    } else {
                      globalScene.ui.showText(
                        `${partner} declined. Starting a new run.`,
                        null,
                        startNewRun,
                        null,
                        true,
                      );
                    }
                  });
                },
                startNewRun,
              );
            },
            null,
            true,
          );
          return;
        }
        globalScene.ui.showText("Connected to your partner!\nPress to start co-op.", null, startNewRun, null, true);
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
        && !this.pendingCommunityConfig
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

    globalScene.phaseManager.pushNew("EncounterPhase", this.loaded);

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
