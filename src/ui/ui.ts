import { globalScene } from "#app/global-scene";
// #789: registers the co-op controller name tag with the ui-mirror session hook (side effect).
import "#ui/coop-controller-tag";
import { coopLog, coopWarn, isCoopDebug } from "#data/elite-redux/coop/coop-debug";
import { isCoopLocalPresentationInputSurface } from "#data/elite-redux/coop/coop-local-presentation-input";
import {
  coopMeBespokeHostDrives,
  coopMeHandoffBattleStarted,
  coopMeInProgress,
  coopMeInteractionStartValue,
} from "#data/elite-redux/coop/coop-me-pin-state";
import {
  notifyCoopOperationAuthorityContinuationSurface,
  notifyCoopOperationContinuationSurface,
} from "#data/elite-redux/coop/coop-operation-journal";
import {
  coopGuestAcknowledgeMeNarration,
  coopHostEngineDialogueMessageAdvanceAllowed,
  coopHostMeNarrationAwaitingGuestAck,
  coopHostStreamMeMessage,
  coopMePostBattleContinuationActive,
  getCoopBattleStreamer,
  getCoopController,
  getCoopMePump,
  getCoopNetcodeMode,
  getCoopUiMirror,
  isCoopAuthoritativeGuest,
  isCoopV2InteractionHumanInputFrozen,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopUiMirrorEngine } from "#data/elite-redux/coop/coop-ui-mirror";
// #840: the total UiMode co-op classification + the unmirrored-screen tripwire decision.
import {
  coopAuthorityContinuationSurface,
  coopLocalOverlayInputAllowed,
  coopUiClassOf,
  coopUnmirroredTripwireReason,
} from "#data/elite-redux/coop/coop-ui-registry";
import { beginCoopUiRelayInput, endCoopUiRelayInput } from "#data/elite-redux/coop/coop-ui-relay-trace";
import { type ErEndlessActiveRift, getErEndlessRiftDefinition } from "#data/elite-redux/er-endless-continuation";
import { type MoodyEffectFlyoutCue, shouldShowMoodyEffectFlyout } from "#data/elite-redux/moody/moody-effect-flyout";
import { getMoodyModeState, MOODY_CURSE_BY_ID } from "#data/elite-redux/moody/moody-state";
import type { MoodyCurseInstance } from "#data/elite-redux/moody/moody-types";
import type { Button } from "#enums/buttons";
import { Device } from "#enums/devices";
import { PlayerGender } from "#enums/player-gender";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { AchvBar } from "#ui/achv-bar";
import { AchvsUiHandler } from "#ui/achvs-ui-handler";
import { AutoEggRestockUiHandler } from "#ui/auto-egg-restock-ui-handler";
import { AutoCompleteUiHandler } from "#ui/autocomplete-ui-handler";
import { AwaitableUiHandler } from "#ui/awaitable-ui-handler";
import { BallUiHandler } from "#ui/ball-ui-handler";
import { BattleMessageUiHandler } from "#ui/battle-message-ui-handler";
import type { BgmBar } from "#ui/bgm-bar";
import { BiomeShopUiHandler } from "#ui/biome-shop-ui-handler";
import { BugReportFormUiHandler } from "#ui/bug-report-form-ui-handler";
import { GameChallengesUiHandler } from "#ui/challenges-select-ui-handler";
import { ChangePasswordFormUiHandler } from "#ui/change-password-form-ui-handler";
import { ColosseumUiHandler } from "#ui/colosseum-ui-handler";
import { CommandUiHandler } from "#ui/command-ui-handler";
import { CommunityChallengeCreateUiHandler } from "#ui/community-challenge-create-ui-handler";
import { CommunityChallengesUiHandler } from "#ui/community-challenges-ui-handler";
import { ConfirmUiHandler } from "#ui/confirm-ui-handler";
import { EggGachaUiHandler } from "#ui/egg-gacha-ui-handler";
import { EggHatchSceneUiHandler } from "#ui/egg-hatch-scene-ui-handler";
import { EggListUiHandler } from "#ui/egg-list-ui-handler";
import { EggSummaryUiHandler } from "#ui/egg-summary-ui-handler";
import { EndlessRiftLedgerUiHandler } from "#ui/endless-rift-ledger-ui-handler";
import { ErBargainUiHandler } from "#ui/er-bargain-ui-handler";
import { ErChallengeTextInputUiHandler } from "#ui/er-challenge-text-input-ui-handler";
import { ErMapPickerUiHandler } from "#ui/er-map-picker-ui-handler";
import { ErMapUiHandler } from "#ui/er-map-ui-handler";
import { ErQuizUiHandler } from "#ui/er-quiz-ui-handler";
import { ErShinyLabUiHandler } from "#ui/er-shiny-lab-ui-handler";
import { EvolutionSceneUiHandler } from "#ui/evolution-scene-ui-handler";
import { FightUiHandler } from "#ui/fight-ui-handler";
import { FunModeSelectUiHandler } from "#ui/fun-mode-select-ui-handler";
import { GameStatsUiHandler } from "#ui/game-stats-ui-handler";
import { GamepadBindingUiHandler } from "#ui/gamepad-binding-ui-handler";
import { GhostTrainerEditorUiHandler } from "#ui/ghost-trainer-editor-ui-handler";
import { FunAbilityReviewUiHandler } from "#ui/handlers/fun-ability-review-ui-handler";
import { KeyboardBindingUiHandler } from "#ui/keyboard-binding-ui-handler";
import { LearnMoveBatchUiHandler } from "#ui/learn-move-batch-ui-handler";
import { LlmDirectorThemePickerUiHandler } from "#ui/llm-director-theme-picker-ui-handler";
import { LoadingModalUiHandler } from "#ui/loading-modal-ui-handler";
import { LoginFormUiHandler } from "#ui/login-form-ui-handler";
import { LoginOrRegisterUiHandler } from "#ui/login-or-register-ui-handler";
import { MenuUiHandler } from "#ui/menu-ui-handler";
import { MessageUiHandler } from "#ui/message-ui-handler";
import { ModifierSelectUiHandler } from "#ui/modifier-select-ui-handler";
import type { MoodyBattleHudModel } from "#ui/moody/moody-battle-hud";
import { MoodyChoiceUiHandler } from "#ui/moody/moody-choice-ui-handler";
import { MoodyCurseSelectUiHandler } from "#ui/moody/moody-curse-select-ui-handler";
import { MoodyEnemyPanelUiHandler } from "#ui/moody/moody-enemy-panel-ui-handler";
import {
  buildMoodyDetailedRecapSections,
  getMoodyLivePresentationSnapshot,
  type MoodyLivePresentationSnapshot,
  setMoodyLivePresentationSnapshot,
} from "#ui/moody/moody-live-presentation";
import type { MoodyOperationModel, MoodyOperationResult } from "#ui/moody/moody-operation";
import {
  buildMoodyRecapRows,
  MOODY_DREAD_LABEL,
  type MoodyChoicePanelModel,
  type MoodyTargetPickerModel,
  type MoodyTransitionSection,
} from "#ui/moody/moody-presentation";
import { MoodyRuntimeUi } from "#ui/moody/moody-runtime-ui";
import type { MoodySectionReportConfig } from "#ui/moody/moody-section-report-ui-handler";
import { MoodySectionReportUiHandler } from "#ui/moody/moody-section-report-ui-handler";
import { MoodyTargetPickerUiHandler } from "#ui/moody/moody-target-picker-ui-handler";
import { MoodyBoonSelectUiHandler } from "#ui/moody-boon-select-ui-handler";
import { MoodyLedgerUiHandler } from "#ui/moody-ledger-ui-handler";
import { MysteryEncounterUiHandler } from "#ui/mystery-encounter-ui-handler";
import { NavigationManager } from "#ui/navigation-menu";
import { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import { PartyUiHandler } from "#ui/party-ui-handler";
import { PokedexPageUiHandler } from "#ui/pokedex-page-ui-handler";
import { PokedexScanUiHandler } from "#ui/pokedex-scan-ui-handler";
import { PokedexUiHandler } from "#ui/pokedex-ui-handler";
import { ProfileUiHandler } from "#ui/profile-ui-handler";
import { RegistrationFormUiHandler } from "#ui/registration-form-ui-handler";
import { RenameFormUiHandler } from "#ui/rename-form-ui-handler";
import { RunHistoryUiHandler } from "#ui/run-history-ui-handler";
import { RunInfoUiHandler } from "#ui/run-info-ui-handler";
import { SaveSlotSelectUiHandler } from "#ui/save-slot-select-ui-handler";
import { SavingIconContainer } from "#ui/saving-icon-handler";
import { SessionReloadModalUiHandler } from "#ui/session-reload-modal-ui-handler";
import { SettingsAudioUiHandler } from "#ui/settings-audio-ui-handler";
import { SettingsDisplayUiHandler } from "#ui/settings-display-ui-handler";
import { SettingsGamepadUiHandler } from "#ui/settings-gamepad-ui-handler";
import { SettingsKeyboardUiHandler } from "#ui/settings-keyboard-ui-handler";
import { SettingsUiHandler } from "#ui/settings-ui-handler";
import { ShowdownSetEditorUiHandler } from "#ui/showdown-set-editor-ui-handler";
import { ShowdownSyncCommandUiHandler } from "#ui/showdown-sync-command-ui-handler";
import { ShowdownTeamMenuUiHandler } from "#ui/showdown-team-menu-ui-handler";
import { ShowdownWagerUiHandler } from "#ui/showdown-wager-ui-handler";
import { StarterSelectUiHandler } from "#ui/starter-select-ui-handler";
import { SummaryUiHandler } from "#ui/summary-ui-handler";
import { TargetSelectUiHandler } from "#ui/target-select-ui-handler";
import { TestDialogueUiHandler } from "#ui/test-dialogue-ui-handler";
import { addTextObject } from "#ui/text";
import { TitleUiHandler } from "#ui/title-ui-handler";
import { TournamentBracketUiHandler } from "#ui/tournament-bracket-ui-handler";
import { TournamentListUiHandler } from "#ui/tournament-list-ui-handler";
import type { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { UnavailableModalUiHandler } from "#ui/unavailable-modal-ui-handler";
import i18next from "i18next";
import { AdminUiHandler } from "./handlers/admin-ui-handler";
import { RenameRunFormUiHandler } from "./handlers/rename-run-ui-handler";

const transitionModes = [
  UiMode.SAVE_SLOT,
  UiMode.PARTY,
  UiMode.SUMMARY,
  UiMode.STARTER_SELECT,
  UiMode.EVOLUTION_SCENE,
  UiMode.EGG_HATCH_SCENE,
  UiMode.EGG_LIST,
  UiMode.EGG_GACHA,
  UiMode.POKEDEX,
  UiMode.POKEDEX_PAGE,
  UiMode.CHALLENGE_SELECT,
  UiMode.FUN_MODE_SELECT,
  UiMode.FUN_ABILITY_REVIEW,
  UiMode.ENDLESS_RIFT_LEDGER,
  UiMode.RUN_HISTORY,
  // Moody Mode screens are full-screen reward/ledger surfaces: fade in/out like the
  // other full-screen transition modes.
  UiMode.MOODY_BOON_SELECT,
  UiMode.MOODY_LEDGER,
  UiMode.MOODY_CURSE_SELECT,
  UiMode.MOODY_ENEMY_PANEL,
  UiMode.MOODY_SECTION_REPORT,
];

const noTransitionModes = [
  UiMode.TITLE,
  UiMode.CONFIRM,
  UiMode.OPTION_SELECT,
  UiMode.MENU,
  UiMode.MENU_OPTION_SELECT,
  UiMode.GAMEPAD_BINDING,
  UiMode.KEYBOARD_BINDING,
  UiMode.SETTINGS,
  UiMode.SETTINGS_AUDIO,
  UiMode.SETTINGS_DISPLAY,
  UiMode.SETTINGS_GAMEPAD,
  UiMode.SETTINGS_KEYBOARD,
  UiMode.ACHIEVEMENTS,
  UiMode.GAME_STATS,
  UiMode.POKEDEX_SCAN,
  UiMode.LOGIN_FORM,
  UiMode.REGISTRATION_FORM,
  UiMode.LOADING,
  UiMode.SESSION_RELOAD,
  UiMode.UNAVAILABLE,
  UiMode.RENAME_POKEMON,
  UiMode.RENAME_RUN,
  UiMode.TEST_DIALOGUE,
  UiMode.AUTO_COMPLETE,
  UiMode.ADMIN,
  UiMode.MYSTERY_ENCOUNTER,
  UiMode.RUN_INFO,
  UiMode.CHANGE_PASSWORD_FORM,
  UiMode.BUG_REPORT_FORM,
  UiMode.COMMUNITY_CHALLENGE_TEXT,
  // Showdown Set Editor opens as an OVERLAY over the (transition-mode) STARTER_SELECT grid, so without
  // this its open + its Cancel revert both run the fade path. In the OFFLINE build flow (reset mode-chain
  // + MESSAGE hop before the grid) that fade could leave the black overlay stuck OPAQUE over the grid on
  // the live client: mode was STARTER_SELECT (the grid took input - the tester heard cursor sounds) but
  // the screen never repainted ("frozen at starter select"). An INSTANT editor swap (no fade) removes the
  // race entirely - snappy is also the right feel for a teambuilder set editor.
  UiMode.SHOWDOWN_SET_EDITOR,
  // Showdown Team Menu (offline build). SAME fade-strand class as the editor above: the menu is entered
  // FROM the transition-mode STARTER_SELECT grid (grid-cancel exit + lock-in->name->menu both run
  // `setMode(SHOWDOWN_TEAM_MENU)` while `this.mode` is STARTER_SELECT, and the grid open/exit sequence
  // resets the mode chain), so without this the grid->menu hop runs `fadeOut(250)+delayedCall(100)+
  // fadeIn(250)` and can overlap the grid's own in-flight fade - `fadeIn`'s `!overlayActive` guard then
  // returns early and STRANDS the black overlay opaque over the menu ("stuck getting out of the custom
  // starter select"). An instant menu swap removes the race; the menu is a full-screen panel, so a fade
  // added nothing anyway. Every OTHER offline-flow edge is already instant (editor overlay + revert;
  // COMMUNITY_CHALLENGE_TEXT name modal), so the whole offline screen graph is now fade-free.
  UiMode.SHOWDOWN_TEAM_MENU,
  // Showdown Tournament screens (list + bracket). Entered FROM the Team Menu (itself a
  // no-transition full-screen panel over the STARTER_SELECT grid), and the bracket <-> list
  // hop is between two full-screen panels — an instant swap keeps the offline screen graph
  // fade-free and avoids the same stuck-black-overlay strand class as the two modes above.
  UiMode.TOURNAMENT_LIST,
  UiMode.TOURNAMENT_BRACKET,
];

// biome-ignore lint/style/useNamingConvention: a unique case (only 2 letters)
export class UI extends Phaser.GameObjects.Container {
  private mode: UiMode;
  private modeChain: UiMode[];
  public handlers: UiHandler[];
  private overlay: Phaser.GameObjects.Rectangle;
  public achvBar: AchvBar;
  public bgmBar: BgmBar;
  public savingIcon: SavingIconContainer;
  private moodyRuntimeUi: MoodyRuntimeUi | null = null;
  private readonly refreshMoodyRuntime = () => this.moodyRuntimeUi?.refresh(this.mode);
  private readonly moodyChoiceQueue: {
    model: MoodyChoicePanelModel;
    resolve: (optionId: string | null) => void;
  }[] = [];
  private moodyChoiceOpen = false;

  private tooltipContainer: Phaser.GameObjects.Container;
  private tooltipBg: Phaser.GameObjects.NineSlice;
  private tooltipTitle: Phaser.GameObjects.Text;
  private tooltipContent: Phaser.GameObjects.Text;

  private overlayActive: boolean;
  /** Invalidates late fade/delayed callbacks when a newer or bounded mode transition supersedes them. */
  private modeTransitionGeneration = 0;
  /** Releases a killed overlay tween so superseded setMode promises cannot remain pending forever. */
  private overlayTransitionRelease: (() => void) | null = null;

  /** Co-op (#633): cached engine surface for the live-cursor UI mirror (lazily built). */
  private _coopMirrorEngine: CoopUiMirrorEngine | null = null;

  constructor() {
    super(globalScene, 0, globalScene.scaledCanvas.height);

    this.mode = UiMode.MESSAGE;
    this.modeChain = [];
    this.handlers = [
      new BattleMessageUiHandler(),
      new TitleUiHandler(),
      new CommandUiHandler(),
      new FightUiHandler(),
      new BallUiHandler(),
      new TargetSelectUiHandler(),
      new ModifierSelectUiHandler(),
      new SaveSlotSelectUiHandler(),
      new PartyUiHandler(),
      new SummaryUiHandler(),
      new StarterSelectUiHandler(),
      new EvolutionSceneUiHandler(),
      new EggHatchSceneUiHandler(),
      new EggSummaryUiHandler(),
      new ConfirmUiHandler(),
      new OptionSelectUiHandler(),
      new MenuUiHandler(),
      new OptionSelectUiHandler(UiMode.MENU_OPTION_SELECT),
      // settings
      new SettingsUiHandler(),
      new SettingsDisplayUiHandler(),
      new SettingsAudioUiHandler(),
      new SettingsGamepadUiHandler(),
      new GamepadBindingUiHandler(),
      new SettingsKeyboardUiHandler(),
      new KeyboardBindingUiHandler(),
      new AchvsUiHandler(),
      new GameStatsUiHandler(),
      new EggListUiHandler(),
      new EggGachaUiHandler(),
      new AutoEggRestockUiHandler(),
      new PokedexUiHandler(),
      new PokedexScanUiHandler(UiMode.TEST_DIALOGUE),
      new PokedexPageUiHandler(),
      new LoginOrRegisterUiHandler(),
      new LoginFormUiHandler(),
      new RegistrationFormUiHandler(),
      new LoadingModalUiHandler(),
      new SessionReloadModalUiHandler(),
      new UnavailableModalUiHandler(),
      new GameChallengesUiHandler(),
      new RenameFormUiHandler(),
      new RenameRunFormUiHandler(),
      new RunHistoryUiHandler(),
      new RunInfoUiHandler(),
      new TestDialogueUiHandler(UiMode.TEST_DIALOGUE),
      new AutoCompleteUiHandler(),
      new AdminUiHandler(),
      new MysteryEncounterUiHandler(),
      new ChangePasswordFormUiHandler(),
      new LlmDirectorThemePickerUiHandler(),
      new BugReportFormUiHandler(),
      new BiomeShopUiHandler(),
      new ColosseumUiHandler(),
      new ErQuizUiHandler(),
      new ErMapUiHandler(),
      new ErMapPickerUiHandler(),
      new LearnMoveBatchUiHandler(),
      new ErBargainUiHandler(),
      new ErShinyLabUiHandler(),
      new CommunityChallengesUiHandler(),
      new CommunityChallengeCreateUiHandler(),
      new ErChallengeTextInputUiHandler(),
      new ProfileUiHandler(),
      new GhostTrainerEditorUiHandler(),
      new ShowdownWagerUiHandler(),
      new ShowdownSetEditorUiHandler(),
      new ShowdownTeamMenuUiHandler(),
      new TournamentListUiHandler(),
      new TournamentBracketUiHandler(),
      new ShowdownSyncCommandUiHandler(),
      new FunModeSelectUiHandler(),
      new FunAbilityReviewUiHandler(),
      new EndlessRiftLedgerUiHandler(),
      new MoodyBoonSelectUiHandler(),
      new MoodyLedgerUiHandler(),
      new MoodyCurseSelectUiHandler(),
      new MoodyTargetPickerUiHandler(),
      new MoodyChoiceUiHandler(),
      new MoodyEnemyPanelUiHandler(),
      new MoodySectionReportUiHandler(),
    ];
  }

  setup(): void {
    this.setName(`ui-${UiMode[this.mode]}`);
    for (const handler of this.handlers) {
      handler.setup();
    }
    this.overlay = globalScene.add.rectangle(0, 0, globalScene.scaledCanvas.width, globalScene.scaledCanvas.height, 0);
    this.overlay.setName("rect-ui-overlay");
    this.overlay.setOrigin(0, 0);
    globalScene.uiContainer.add(this.overlay);
    this.overlay.setVisible(false);
    this.setupTooltip();

    this.achvBar = new AchvBar();
    this.achvBar.setup();

    globalScene.uiContainer.add(this.achvBar);

    this.savingIcon = new SavingIconContainer();
    this.savingIcon.setup();

    globalScene.uiContainer.add(this.savingIcon);

    this.moodyRuntimeUi = new MoodyRuntimeUi();
    globalScene.events.on(Phaser.Scenes.Events.UPDATE, this.refreshMoodyRuntime);
  }

  /** Push one ordered, non-modal Moody activation row into the live battle feed. */
  public pushMoodyTrigger(label: string, cue?: MoodyEffectFlyoutCue): void {
    this.moodyRuntimeUi?.pushTrigger(label);
    if (cue != null && shouldShowMoodyEffectFlyout(cue.effectId)) {
      globalScene.phaseManager.queueMoodyEffectDisplay(cue);
    }
  }

  /** Keyboard/controller/mobile callers share the same expansion state as tapping the feed. */
  public toggleMoodyTriggerFeed(): void {
    this.moodyRuntimeUi?.toggleTriggerFeed();
  }

  /** Open the mirrored current-enemy boon drawer from the command grid or its touch tab. */
  public toggleMoodyEnemyFeed(): void {
    this.moodyRuntimeUi?.toggleEnemyFeed();
  }

  /** Mechanics-owned decisions may provide exact rule/tracker/HP state here. */
  public setMoodyBattleHudModel(model: MoodyBattleHudModel | null): void {
    this.moodyRuntimeUi?.setModel(model);
    this.moodyRuntimeUi?.refresh(this.mode);
  }

  /** Replace the mechanics-owned presentation projection consumed by all Moody UI surfaces. */
  public setMoodyLivePresentation(snapshot: MoodyLivePresentationSnapshot | null): void {
    setMoodyLivePresentationSnapshot(snapshot);
    this.moodyRuntimeUi?.refresh(this.mode);
  }

  /**
   * Queue a mechanics-owned contextual decision. Only one modal is opened at a
   * time; the next decision is presented after the prior handler has reverted.
   */
  public requestMoodyChoice(model: MoodyChoicePanelModel): Promise<string | null> {
    return new Promise(resolve => {
      this.moodyChoiceQueue.push({ model, resolve });
      this.openNextMoodyChoice();
    });
  }

  private openNextMoodyChoice(): void {
    if (this.moodyChoiceOpen) {
      return;
    }
    const request = this.moodyChoiceQueue.shift();
    if (request == null) {
      return;
    }
    this.moodyChoiceOpen = true;
    void this.setOverlayMode(UiMode.MOODY_CHOICE, request.model, (optionId: string | null) => {
      this.moodyChoiceOpen = false;
      request.resolve(optionId);
      this.openNextMoodyChoice();
    });
  }

  /** Open the reusable binding picker against live mechanics-supplied targets. */
  public requestMoodyTarget(model: MoodyTargetPickerModel): Promise<number | string | null> {
    return new Promise(resolve => {
      void this.setOverlayMode(UiMode.MOODY_TARGET_PICKER, model, resolve);
    });
  }

  /** Production entry point for interactive Moody reward, contract, market, inheritance, and planning flows. */
  public requestMoodyOperation(model: MoodyOperationModel): Promise<MoodyOperationResult> {
    return new Promise(resolve => {
      void this.setOverlayMode(UiMode.MOODY_CHOICE, model, resolve);
    });
  }

  public requestMoodyRecycler(model: MoodyOperationModel): Promise<MoodyOperationResult> {
    return this.requestMoodyOperation({ ...model, kind: "recycler" });
  }

  public requestMoodyLegacySlot(model: MoodyOperationModel): Promise<MoodyOperationResult> {
    return this.requestMoodyOperation({ ...model, kind: "legacy" });
  }

  public requestMoodyBloodMarket(model: MoodyOperationModel): Promise<MoodyOperationResult> {
    return this.requestMoodyOperation({ ...model, kind: "blood-market" });
  }

  public requestMoodyPressureValve(model: MoodyOperationModel): Promise<MoodyOperationResult> {
    return this.requestMoodyOperation({ ...model, kind: "pressure-valve" });
  }

  public requestMoodyItemStackAttachment(model: MoodyOperationModel): Promise<MoodyOperationResult> {
    return this.requestMoodyOperation({ ...model, kind: "item-stack" });
  }

  /** Open a paged report and resolve after the player confirms or closes it. */
  public showMoodyReport(config: Omit<MoodySectionReportConfig, "onAction">): Promise<"confirm" | "cancel"> {
    return new Promise(resolve => {
      void this.setOverlayMode(UiMode.MOODY_SECTION_REPORT, { ...config, onAction: resolve }).catch(() =>
        resolve("cancel"),
      );
    });
  }

  /** Reveal the deterministic post-draft curse before battle flow resumes. */
  public showMoodyCurseReceived(curse: MoodyCurseInstance): Promise<"confirm" | "cancel"> {
    const definition = MOODY_CURSE_BY_ID.get(curse.curseId);
    const targetSlot = curse.target?.partySlots?.[0];
    const lines = [
      definition?.description ?? "No description available.",
      ...(targetSlot == null ? [] : [`Bound to party slot ${targetSlot + 1}.`]),
    ];
    return this.showMoodyReport({
      title: "CURSE RECEIVED",
      sections: [
        {
          title: `${definition == null ? "DREAD ?" : MOODY_DREAD_LABEL[definition.dread]} - ${definition?.name ?? curse.curseId}`,
          lines,
        },
      ],
      confirmLabel: "CONTINUE",
      requireConfirm: true,
    });
  }

  /** Reuse the curse-received report surface for a newly acquired Endless Rift. */
  public showEndlessRiftReceived(rift: ErEndlessActiveRift): Promise<"confirm" | "cancel"> {
    const definition = getErEndlessRiftDefinition(rift.id);
    return this.showMoodyReport({
      title: "RIFT RECEIVED",
      sections: [
        {
          title: `${definition?.category === "pressure" ? "PRESSURE" : "MUTATION"} - ${definition?.name ?? rift.id}`,
          lines: [
            definition?.description ?? "No description available.",
            `Duration: ${rift.pulsesRemaining} Rift pulse${rift.pulsesRemaining === 1 ? "" : "s"}.`,
          ],
        },
      ],
      confirmLabel: "CONTINUE",
      requireConfirm: true,
    });
  }

  public showMoodyBorrowedFuture(model: MoodyOperationModel): Promise<MoodyOperationResult> {
    return this.requestMoodyOperation({ ...model, kind: "borrowed-future", reorderable: true });
  }

  public showMoodyBountyBoard(model: MoodyOperationModel): Promise<MoodyOperationResult> {
    return this.requestMoodyOperation({ ...model, kind: "bounty" });
  }

  public showMoodyBiomeReport(sections: readonly MoodyTransitionSection[]): Promise<"confirm" | "cancel"> {
    return this.showMoodyReport({ title: "BIOME REPORT", sections });
  }

  /** End-run entry point; mechanics provides the final seed label at GameOver. */
  public showMoodyRunRecap(seedLabel: string): Promise<"confirm" | "cancel"> {
    const state = getMoodyModeState();
    const rows = state == null ? [] : buildMoodyRecapRows(state, seedLabel);
    const baseSections: MoodyTransitionSection[] = [{ title: "Final build", lines: rows.map(row => row.label) }];
    return this.showMoodyReport({
      title: "MOODY RUN RECAP",
      sections: buildMoodyDetailedRecapSections(baseSections, getMoodyLivePresentationSnapshot()?.recap),
      footer: "UP DOWN page   A continue",
    });
  }

  private setupTooltip() {
    this.tooltipContainer = globalScene.add.container(0, 0);
    this.tooltipContainer.setName("tooltip");
    this.tooltipContainer.setVisible(false);

    this.tooltipBg = addWindow(0, 0, 128, 31);
    this.tooltipBg.setName("window-tooltip-bg");
    this.tooltipBg.setOrigin(0, 0);

    this.tooltipTitle = addTextObject(64, 4, "", TextStyle.TOOLTIP_TITLE);
    this.tooltipTitle.setName("text-tooltip-title");
    this.tooltipTitle.setOrigin(0.5, 0);

    this.tooltipContent = addTextObject(6, 16, "", TextStyle.TOOLTIP_CONTENT);
    this.tooltipContent.setName("text-tooltip-content");
    this.tooltipContent.setWordWrapWidth(850);

    this.tooltipContainer.add(this.tooltipBg);
    this.tooltipContainer.add(this.tooltipTitle);
    this.tooltipContainer.add(this.tooltipContent);

    globalScene.uiContainer.add(this.tooltipContainer);
  }

  getHandler<H extends UiHandler = UiHandler>(): H {
    return this.handlers[this.mode] as H;
  }

  getMessageHandler(): BattleMessageUiHandler {
    return this.handlers[UiMode.MESSAGE] as BattleMessageUiHandler;
  }

  processInfoButton(pressed: boolean) {
    if (this.overlayActive) {
      return false;
    }

    if ([UiMode.CONFIRM, UiMode.COMMAND, UiMode.FIGHT, UiMode.MESSAGE, UiMode.TARGET_SELECT].includes(this.mode)) {
      globalScene?.processInfoButton(pressed);
      return true;
    }
    globalScene?.processInfoButton(false);
    return true;
  }

  /**
   * Process a player input of a button (delivering it to the current UI handler for processing)
   * @param button The {@linkcode Button} being inputted
   * @returns true if the input attempt succeeds
   */
  processInput(button: Button): boolean {
    this.moodyRuntimeUi?.refresh(this.mode);
    const coopUiInputId = beginCoopUiRelayInput(this.mode);
    try {
      return this.processInputCoopAware(button);
    } finally {
      endCoopUiRelayInput(coopUiInputId);
    }
  }

  /** Co-op-aware dispatch body, wrapped by {@linkcode processInput}'s UI-to-relay evidence scope. */
  private processInputCoopAware(button: Button): boolean {
    // Co-op (#633): on a SHARED interaction screen the live-cursor mirror governs input -
    // the WATCHER's local presses are blocked, and the OWNER's presses are relayed for the
    // partner to replay so the cursor mirrors live. HARD no-op everywhere else: `isCoop`
    // short-circuits in solo, and `isActive(this.mode)` is false on any non-shared screen
    // (incl. the battle command menu), so the dispatch below is byte-for-byte unchanged.
    if (globalScene.gameMode.isCoop) {
      // Co-op (#633): inside a MYSTERY-ENCOUNTER interactive phase, the input PUMP governs
      // input AUTHORITATIVELY - the WATCHER's local presses are blocked, and the OWNER relays
      // every handler-READY press (never a scroll-skip) for the partner to replay in lockstep,
      // so the whole encounter (options, sub-choices, quiz answers, dialogue, cursor) + its
      // rewards stay identical. Gated on the ME-interactive phase set, so embedded battles +
      // the end-of-ME reward shop fall through to their own owners.
      const mePump = getCoopMePump();
      const authoritativeGuestReplayActive =
        globalScene.phaseManager.getCurrentPhase()?.phaseName === "CoopReplayMePhase"
        && getCoopNetcodeMode() === "authoritative";
      // The legacy pump session ends as soon as the selected ME option is accepted. Authority V2 can
      // legitimately retain the same CoopReplayMePhase for one or more address-exact narration prompts
      // after that point. Requiring legacy liveness here makes those real consumed presses fall through to
      // UiMirror, which only resends the already-committed ME_PICK and can never release the host's ME_BUTTON
      // acknowledgement fence (campaign 30234239664). The current V2 replay phase is its own control lease.
      const meInteractiveSurfaceActive =
        mePump != null && (mePump.isSessionActive() || authoritativeGuestReplayActive) && this.coopMeInteractivePhase();
      // Authority V2 grants a shared interaction to one exact phase/handler generation. An ordered successor
      // wait, stale handler, wrong owner, or merely queued phase is not a human-input lease. Programmatic peer
      // replay uses processInputInner and therefore remains able to drive the watcher after authenticated input.
      // #816 CARVE-OUT (run 29933294323 mystery lane): the freeze governs the guest-owned CHOICE surfaces, but
      // the authoritative host must still advance its OWN engine MESSAGE dialogue on a guest-owned ME (pure
      // text-advance) - else the post-pick narration parks forever and the guest never reaches the next round.
      // The bypass mirrors the #816 branch below exactly, so only that case slips the freeze; every CHOICE
      // surface (never MESSAGE) stays frozen. It also covers ordinary MessagePhase effects after the
      // Mystery selector phase has ended; those are still presentation owned by the sole host engine.
      const hostEngineDialogueAdvance = coopHostEngineDialogueMessageAdvanceAllowed({
        localRole: getCoopController()?.role ?? "guest",
        isMessageMode: this.getMode() === UiMode.MESSAGE,
        netcodeMode: getCoopNetcodeMode(),
        meInProgress: coopMeInProgress(),
        meHandoffBattleStarted: coopMeHandoffBattleStarted(),
        mePostBattleContinuationActive: coopMePostBattleContinuationActive(),
        meBespokeHostDrives: coopMeBespokeHostDrives(),
      });
      // Registered presentation prompts belong to each browser independently. They do not choose
      // shared mechanics or emit an intent, so the ordered interaction freeze must not turn a visible
      // local prompt into an unpressable session-wide softlock. Mode-specific entries keep mechanically
      // shared overlays in the same phase (for example a branched evolution picker) frozen.
      const localPresentationInput = isCoopLocalPresentationInputSurface(
        globalScene.phaseManager.getCurrentPhase()?.phaseName,
        UiMode[this.mode],
      );
      // Pause/settings are per-client overlays: they neither choose nor release the exact shared control
      // underneath them. Keep those inputs local and actionable, but require MENU ancestry for nested generic
      // chrome so a mechanically authoritative CONFIRM/OPTION_SELECT cannot inherit this exemption by mode.
      const localOverlayInput = coopLocalOverlayInputAllowed(this.mode, this.modeChain);
      if (
        isCoopV2InteractionHumanInputFrozen()
        && !hostEngineDialogueAdvance
        && !localPresentationInput
        && !localOverlayInput
      ) {
        return false;
      }
      // The exact narration lease owns every host MESSAGE surface until the remote owner dismisses
      // it, including ordinary MessagePhase instances queued after MysteryEncounterPhase has ended.
      // The authenticated acknowledgement path advances through advanceCoopHostMeNarrationFromGuest,
      // so blocking public input here cannot block the rightful owner.
      if (hostEngineDialogueAdvance && coopHostMeNarrationAwaitingGuestAck()) {
        coopLog("me", "ui: host blocks local narration press while exact guest acknowledgement is pending");
        return false;
      }
      if (meInteractiveSurfaceActive) {
        // Co-op AUTHORITATIVE host on a GUEST-OWNED ME (#633, ADD-2): the host runs the sole engine
        // (beginOwner, never a watcher in authoritative mode), but the GUEST makes the pick - the
        // host applies the relayed index PROGRAMMATICALLY (mystery-encounter-phases coopHostAwaitGuestIndex).
        // So the local host's own presses must NOT also select. Hard-gated to authoritative host on a
        // guest-owned ME; solo / lockstep / host-owned fall through BYTE-IDENTICAL.
        if (
          getCoopNetcodeMode() === "authoritative"
          && coopMeInProgress()
          && !coopMeHandoffBattleStarted() // #817: the spawned battle uses the NORMAL battle input path
          && !coopMeBespokeHostDrives() // #823: the host must be able to play the bespoke mini-game
          && !(getCoopController()?.isLocalOwnerAtCounter(coopMeInteractionStartValue()) ?? true)
        ) {
          // #816 (live BOTH-frozen): the engine's own dialogue ("that Unown will do
          // nicely!") runs on the HOST and needs a press to advance - blocking it parked
          // the encounter forever (no terminal -> the owner waited forever). MESSAGE mode
          // is pure text-advance with no choice semantics, so let it through; every
          // CHOICE screen (options / party / secondary) stays blocked.
          if (this.getMode() === UiMode.MESSAGE) {
            coopLog("me", "ui: host ADVANCES engine dialogue on guest-owned ME (#816)", { button });
            return this.processInputInner(button);
          }
          if (isCoopDebug()) {
            coopLog("me", "ui: host blocks local press on guest-owned ME (applies relayed index)", { button });
          }
          return false; // the guest owns this ME; the host applies the relayed index programmatically
        }
        const modeBefore = this.getMode();
        const wasReady = this.coopMeReady(); // only relay presses the handler will ACT on
        const result = this.processInputInner(button);
        if (wasReady) {
          if (isCoopDebug()) {
            coopLog("me", "ui: owner press consumed + relayed", { button });
          }
          // Under Authority V2, a guest-owned narration prompt is a dedicated address-exact presentation
          // lease. Acknowledge only after the real local handler consumed the press; all other Mystery
          // input keeps the legacy pump behavior (which V2 itself suppresses for retired raw buttons).
          if (!(result && modeBefore === UiMode.MESSAGE && coopGuestAcknowledgeMeNarration(button))) {
            mePump.relayOwnerButton(button);
          }
        } else if (isCoopDebug()) {
          coopLog("me", "ui: owner scroll-skip press NOT relayed (handler not ready)", { button });
        }
        return result;
      }
      const mirror = getCoopUiMirror();
      if (mirror != null && mirror.isActive(this.mode)) {
        if (mirror.isWatcher()) {
          return false; // the partner drives this screen; ignore the watcher's local input
        }
        // #633 ("cursor slightly off sync"): sample the mode BEFORE the press is processed.
        // processInputInner -> handler.processInput may setMode/revertMode synchronously, so reading
        // this.mode AFTER would relay the POST-press mode; on a mode-changing press (confirm reward,
        // open a sub-menu) the watcher's resync barrier then compares it against its still-pre-press
        // mode, sees a mismatch, and DROPS the valid button as "cursor drift". relayOwnerButton's 2nd
        // arg is the watcher's resync barrier and must be the PRE-press mode.
        const modeBefore = this.mode;
        const result = this.processInputInner(button); // OWNER: drive locally...
        // A button rejected while the owner's handler is still animating changed no local cursor.
        // Relaying it anyway would make the watcher apply an action the owner never consumed.
        if (result) {
          mirror.relayOwnerButton(button, modeBefore); // ...then relay the consumed cursor for the partner
        }
        return result;
      }
    }
    return this.processInputInner(button);
  }

  /**
   * Co-op (#633): whether the CURRENT phase is a mystery-encounter INTERACTIVE phase the input
   * pump should drive. Excludes the embedded battle ({@linkcode MysteryEncounterBattlePhase}) and
   * the end-of-ME reward shop ({@linkcode SelectModifierPhase}) - those keep their own co-op
   * owners (battle command relay / shop relay), so the pump auto-suspends for them.
   */
  private coopMeInteractivePhase(): boolean {
    const phaseName = globalScene.phaseManager.getCurrentPhase()?.phaseName;
    // Authority V2 gives the guest owner an address-exact human-input lease while its retained
    // replay phase renders host-streamed narration. Route that phase through the ready-press path
    // so a consumed MESSAGE action calls coopGuestAcknowledgeMeNarration instead of emitting an
    // obsolete generic interactionChoice (public Mystery campaign 30232043330).
    const authoritativeGuestReplay = phaseName === "CoopReplayMePhase" && getCoopNetcodeMode() === "authoritative";
    return (
      phaseName === "MysteryEncounterPhase"
      || phaseName === "MysteryEncounterOptionSelectedPhase"
      || phaseName === "MysteryEncounterRewardsPhase"
      || phaseName === "PostMysteryEncounterPhase" // ER quiz (#633 Fix #4b): the quiz answer is an interactive choice that must be relayed, // else each client answers independently -> different rewards. Route it through the same // owner-drives / watcher-mirrors pump as the ME screens.
      || phaseName === "ErQuizPhase"
      || authoritativeGuestReplay
    );
  }

  /**
   * Co-op (#633): whether the active handler will ACT on a button NOW (a menu, or a message whose
   * text has finished scrolling + prompt is up). The OWNER relays only ready presses (so a
   * scroll-skip stays owner-local), and the WATCHER applies a relayed press only when ready - so
   * both perform exactly one advance per press and the lockstep never drifts.
   */
  private coopMeReady(): boolean {
    const handler = this.getHandler();
    if (handler instanceof MessageUiHandler) {
      return handler.isAwaitingPromptAction();
    }
    return true;
  }

  /**
   * Runtime-owned sink for one authenticated guest narration acknowledgement. It can touch only the
   * host's live, handler-ready Mystery MESSAGE surface; an early acknowledgement is retried by the runtime
   * and a stale/wrong-mode acknowledgement returns false without consuming any later prompt.
   */
  advanceCoopHostMeNarrationFromGuest(button: number): boolean {
    if (
      !Number.isSafeInteger(button)
      || !coopHostEngineDialogueMessageAdvanceAllowed({
        localRole: getCoopController()?.role ?? "guest",
        isMessageMode: this.getMode() === UiMode.MESSAGE,
        netcodeMode: getCoopNetcodeMode(),
        meInProgress: coopMeInProgress(),
        meHandoffBattleStarted: coopMeHandoffBattleStarted(),
        mePostBattleContinuationActive: coopMePostBattleContinuationActive(),
        meBespokeHostDrives: coopMeBespokeHostDrives(),
      })
      || !this.coopMeReady()
    ) {
      return false;
    }
    return this.processInputInner(button as Button);
  }

  /** The original input dispatch, reused by the co-op mirror's owner + replay paths (#633). */
  private processInputInner(button: Button): boolean {
    if (this.overlayActive) {
      return false;
    }

    if (this.moodyRuntimeUi?.processInput(button, this.mode)) {
      return true;
    }

    const handler = this.getHandler();

    if (handler instanceof AwaitableUiHandler && handler.tutorialActive) {
      return handler.processTutorialInput(button);
    }

    return handler.processInput(button);
  }

  /** Stable engine surface handed to the co-op UI mirror (created once, reused) (#633). */
  private coopMirrorEngine(): CoopUiMirrorEngine {
    if (this._coopMirrorEngine == null) {
      this._coopMirrorEngine = {
        getMode: () => this.mode,
        // Preserve the handler's readiness verdict. A CPU-dilated watcher can still be rendering
        // the reward animation after the owner becomes actionable; the mirror retains and retries
        // that exact cosmetic FIFO input instead of permanently losing the cursor edge.
        applyButton: (b: Button) => this.processInputInner(b),
        captureState: () => {
          const handler = this.getHandler();
          return handler instanceof ModifierSelectUiHandler ? handler.getCoopMirrorCursorState() : null;
        },
        applyState: state => {
          const handler = this.getHandler();
          return handler instanceof ModifierSelectUiHandler ? handler.applyCoopMirrorCursorState(state) : true;
        },
      };
    }
    return this._coopMirrorEngine;
  }

  showTextPromise(text: string, callbackDelay = 0, prompt = true, promptDelay?: number | null): Promise<void> {
    return new Promise<void>(resolve => {
      this.showText(text ?? "", null, () => resolve(), callbackDelay, prompt, promptDelay);
    });
  }

  showText(
    text: string,
    delay?: number | null,
    callback?: (() => void) | null,
    callbackDelay?: number | null,
    prompt?: boolean | null,
    promptDelay?: number | null,
  ): void {
    const pokename: string[] = [];
    const repname = ["#POKEMON1", "#POKEMON2"];
    for (let p = 0; p < globalScene.getPlayerField().length; p++) {
      pokename.push(globalScene.getPlayerField()[p].getNameToRender());
      text = text.split(pokename[p]).join(repname[p]);
    }
    if (prompt && text.indexOf("$") > -1) {
      const messagePages = text.split(/\$/g).map(m => m.trim());
      let showMessageAndCallback = () => callback?.();
      for (let p = messagePages.length - 1; p >= 0; p--) {
        const originalFunc = showMessageAndCallback;
        messagePages[p] = messagePages[p].split(repname[0]).join(pokename[0]);
        messagePages[p] = messagePages[p].split(repname[1]).join(pokename[1]);
        showMessageAndCallback = () => this.showText(messagePages[p], null, originalFunc, null, true);
      }
      showMessageAndCallback();
    } else {
      const handler = this.getHandler();
      for (let p = 0; p < globalScene.getPlayerField().length; p++) {
        text = text.split(repname[p]).join(pokename[p]);
      }
      // Co-op AUTHORITATIVE host (#633, ADD-3): stream the resolved ME narration line so the guest's
      // CoopReplayMePhase renders it. Hard-gated (coopMeInProgress() false in solo / outside an ME;
      // coopHostStreamMeMessage no-ops off the live authoritative host), so solo / lockstep / guest
      // are byte-identical. Streamed at the terminal render (not the `$`-page-split recursion above).
      if (
        globalScene.gameMode.isCoop
        && coopMeInProgress()
        && (!coopMeHandoffBattleStarted() || coopMePostBattleContinuationActive())
      ) {
        if (isCoopDebug()) {
          coopLog("me", "ui: host streams ME narration (showText)", { len: text.length, preview: text.slice(0, 40) });
        }
        coopHostStreamMeMessage(text, prompt !== false);
      }
      if (handler instanceof MessageUiHandler) {
        (handler as MessageUiHandler).showText(text, delay, callback, callbackDelay, prompt, promptDelay);
      } else {
        this.getMessageHandler().showText(text, delay, callback, callbackDelay, prompt, promptDelay);
      }
    }
  }

  showDialogue(
    keyOrText: string,
    name: string | undefined,
    delay: number | null = 0,
    callback: () => void,
    callbackDelay?: number,
    promptDelay?: number,
  ): void {
    // Get localized dialogue (if available)
    let hasi18n = false;
    let text = keyOrText;
    const genderIndex = globalScene.gameData.gender ?? PlayerGender.UNSET;
    const genderStr = PlayerGender[genderIndex].toLowerCase();

    if (i18next.exists(keyOrText)) {
      const i18nKey = keyOrText;
      hasi18n = true;

      text = i18next.t(i18nKey, { context: genderStr }); // override text with translation

      // Skip dialogue if the player has enabled the option and the dialogue has been already seen
      if (this.shouldSkipDialogue(i18nKey)) {
        console.log(`Dialogue ${i18nKey} skipped`);
        callback();
        return;
      }
    }
    let showMessageAndCallback = () => {
      hasi18n && globalScene.gameData.saveSeenDialogue(keyOrText);
      callback();
    };
    if (text.indexOf("$") > -1) {
      const messagePages = text.split(/\$/g).map(m => m.trim());
      for (let p = messagePages.length - 1; p >= 0; p--) {
        const originalFunc = showMessageAndCallback;
        showMessageAndCallback = () => this.showDialogue(messagePages[p], name, null, originalFunc);
      }
      showMessageAndCallback();
    } else {
      const handler = this.getHandler();
      // Co-op AUTHORITATIVE host (#633, ADD-3): stream the resolved ME dialogue line to the guest.
      // Same hard gate as showText - byte-identical in solo / lockstep / off the authoritative host.
      if (
        globalScene.gameMode.isCoop
        && coopMeInProgress()
        && (!coopMeHandoffBattleStarted() || coopMePostBattleContinuationActive())
      ) {
        if (isCoopDebug()) {
          coopLog("me", "ui: host streams ME narration (showDialogue)", {
            len: text.length,
            preview: text.slice(0, 40),
          });
        }
        coopHostStreamMeMessage(text, true);
      }
      if (handler instanceof MessageUiHandler) {
        (handler as MessageUiHandler).showDialogue(
          text,
          name,
          delay,
          showMessageAndCallback,
          callbackDelay,
          true,
          promptDelay,
        );
      } else {
        this.getMessageHandler().showDialogue(
          text,
          name,
          delay,
          showMessageAndCallback,
          callbackDelay,
          true,
          promptDelay,
        );
      }
    }
  }

  shouldSkipDialogue(i18nKey: string): boolean {
    if (
      i18next.exists(i18nKey)
      && globalScene.skipSeenDialogues
      && globalScene.gameData.getSeenDialogues()[i18nKey] === true
    ) {
      return true;
    }
    return false;
  }

  getTooltip(): { visible: boolean; title: string; content: string } {
    return {
      visible: this.tooltipContainer.visible,
      title: this.tooltipTitle.text,
      content: this.tooltipContent.text,
    };
  }

  showTooltip(title: string, content: string, overlap?: boolean): void {
    this.tooltipContainer.setVisible(true);
    this.editTooltip(title, content);
    if (overlap) {
      globalScene.uiContainer.moveAbove(this.tooltipContainer, this);
    } else {
      globalScene.uiContainer.moveBelow(this.tooltipContainer, this);
    }
  }

  editTooltip(title: string, content: string): void {
    this.tooltipTitle.setText(title || "");
    const wrappedContent = this.tooltipContent.runWordWrap(content);
    this.tooltipContent.setText(wrappedContent);
    this.tooltipContent.y = title ? 16 : 4;
    this.tooltipBg.width = Math.min(
      Math.max(this.tooltipTitle.displayWidth, this.tooltipContent.displayWidth) + 12,
      838,
    );
    this.tooltipBg.height = (title ? 31 : 19) + 10.5 * (wrappedContent.split("\n").length - 1);
    this.tooltipTitle.x = this.tooltipBg.width / 2;
  }

  hideTooltip(): void {
    this.tooltipContainer.setVisible(false);
    this.tooltipTitle.clearTint();
  }

  update(): void {
    if (this.tooltipContainer.visible) {
      const isTouch = globalScene.inputMethod === "touch";
      const pointerX = globalScene.game.input.activePointer.x;
      const pointerY = globalScene.game.input.activePointer.y;
      const tooltipWidth = this.tooltipBg.width;
      const tooltipHeight = this.tooltipBg.height;
      const padding = 2;

      // Default placement is top left corner of the screen on mobile. Otherwise below the cursor, to the right
      let x = isTouch ? padding : pointerX / 6 + padding;
      let y = isTouch ? padding : pointerY / 6 + padding;

      if (isTouch) {
        // If we are in the top left quadrant on mobile, move the tooltip to the top right corner
        if (pointerX <= globalScene.game.canvas.width / 2 && pointerY <= globalScene.game.canvas.height / 2) {
          x = globalScene.scaledCanvas.width - tooltipWidth - padding;
        }
      } else {
        // If the tooltip would go offscreen on the right, or is close to it, move to the left of the cursor
        if (x + tooltipWidth + padding > globalScene.scaledCanvas.width) {
          x = Math.max(padding, pointerX / 6 - tooltipWidth - padding);
        }
        // If the tooltip would go offscreen at the bottom, or is close to it, move above the cursor
        if (y + tooltipHeight + padding > globalScene.scaledCanvas.height) {
          y = Math.max(padding, pointerY / 6 - tooltipHeight - padding);
        }
      }

      this.tooltipContainer.setPosition(x, y);
    }
  }

  clearText(): void {
    const handler = this.getHandler();
    if (handler instanceof MessageUiHandler) {
      (handler as MessageUiHandler).clearText();
    } else {
      this.getMessageHandler().clearText();
    }
  }

  setCursor(cursor: number): boolean {
    const changed = this.getHandler().setCursor(cursor);
    if (changed) {
      this.playSelect();
    }

    return changed;
  }

  playSelect(): void {
    globalScene.playSound("ui/select");
  }

  playError(): void {
    globalScene.playSound("ui/error");
  }

  fadeOut(duration: number): Promise<void> {
    return new Promise(resolve => {
      this.cancelOverlayTransitionTween();
      if (this.overlayActive) {
        return resolve();
      }
      this.overlayActive = true;
      this.overlay.setAlpha(0);
      this.overlay.setVisible(true);
      const finish = (): void => {
        if (this.overlayTransitionRelease === finish) {
          this.overlayTransitionRelease = null;
        }
        resolve();
      };
      this.overlayTransitionRelease = finish;
      globalScene.tweens.add({
        targets: this.overlay,
        alpha: 1,
        duration,
        ease: "Sine.easeOut",
        onComplete: finish,
      });
    });
  }

  fadeIn(duration: number): Promise<void> {
    return new Promise(resolve => {
      this.cancelOverlayTransitionTween();
      if (!this.overlayActive) {
        return resolve();
      }
      const finish = (): void => {
        if (this.overlayTransitionRelease === finish) {
          this.overlayTransitionRelease = null;
          this.overlay.setVisible(false);
        }
        resolve();
      };
      this.overlayTransitionRelease = finish;
      globalScene.tweens.add({
        targets: this.overlay,
        alpha: 0,
        duration,
        ease: "Sine.easeIn",
        onComplete: finish,
      });
      this.overlayActive = false;
    });
  }

  private setModeInternal(
    this: UI,
    mode: UiMode,
    clear: boolean,
    forceTransition: boolean,
    chainMode: boolean,
    args: any[],
    isCurrent?: () => boolean,
  ): Promise<void> {
    // A bounded caller can arrive after its phase/session was replaced. Reject it before claiming a new
    // transition generation or reading scene-owned state: teardown may already have removed gameMode, and
    // a stale attempt must not supersede the replacement screen's legitimate transition.
    if (isCurrent?.() === false) {
      return Promise.resolve();
    }
    const transitionGeneration = ++this.modeTransitionGeneration;
    const attemptCurrent = (): boolean =>
      transitionGeneration === this.modeTransitionGeneration && (isCurrent?.() ?? true);
    const abortCurrentAttempt = (): void => {
      if (transitionGeneration === this.modeTransitionGeneration) {
        ++this.modeTransitionGeneration;
        this.normalizeTransitionOverlay();
      }
    };
    // Co-op (#633): keep the live-cursor mirror's engine surface attached so the WATCHER
    // can replay the owner's relayed buttons even while the local human is idle (its screen
    // opens via setMode, not via local input). Cheap + idempotent; hard no-op in solo.
    if (globalScene.gameMode?.isCoop === true) {
      getCoopUiMirror()?.attach(this.coopMirrorEngine());
      // #840 unmirrored-screen tripwire. DEV/staging only (coopWarn is silenced in prod), zero
      // behavior change: surface a non-mirrored interactive screen opening on this client while the
      // PARTNER owns a live shared interaction - the pattern by which a new screen silently defaults
      // to host-only in co-op. See coopUnmirroredTripwire.
      if (isCoopDebug() && getCoopNetcodeMode() === "authoritative") {
        this.coopUnmirroredTripwire(mode);
      }
    }
    return new Promise(resolve => {
      if (!attemptCurrent()) {
        abortCurrentAttempt();
        resolve();
        return;
      }
      if (this.mode === mode && !forceTransition) {
        // A newer same-mode winner must still clear an opaque fade left by the superseded attempt.
        this.normalizeTransitionOverlay();
        // Mode identity alone is not a public surface. A prior clear/teardown can leave the selected
        // handler inactive; bounded callers must be able to re-open that exact same mode instead of
        // reporting a false completion that can strand a retained co-op continuation.
        const handler = this.getHandler();
        if (!handler.active) {
          handler.show(args);
        }
        this.coopAuthoritySurfaceReady(mode);
        resolve();
        return;
      }
      const doSetMode = (normalizeOverlay: boolean) => {
        if (!attemptCurrent()) {
          abortCurrentAttempt();
          resolve();
          return;
        }
        if (normalizeOverlay) {
          // Direct/no-transition winners own the screen now; normalize any older fade globally.
          this.normalizeTransitionOverlay();
        }
        if (this.mode !== mode) {
          if (clear) {
            this.getHandler().clear();
          }
          if (chainMode && !clear) {
            this.modeChain.push(this.mode);
            globalScene.updateGameInfo();
          }
          this.mode = mode;
          const touchControls = typeof document === "undefined" ? null : document.getElementById("touchControls");
          if (touchControls) {
            touchControls.dataset.uiMode = UiMode[mode];
          }
          this.getHandler().show(args);
          this.coopAuthoritySurfaceReady(mode);
        }
        resolve();
      };
      if (
        (!chainMode
          && (transitionModes.indexOf(this.mode) > -1 || transitionModes.indexOf(mode) > -1)
          && noTransitionModes.indexOf(this.mode) === -1
          && noTransitionModes.indexOf(mode) === -1)
        || (chainMode && noTransitionModes.indexOf(mode) === -1)
      ) {
        if (!attemptCurrent()) {
          abortCurrentAttempt();
          resolve();
          return;
        }
        // Cancel any prior fadeIn/fadeOut owner before starting this generation's fade.
        this.normalizeTransitionOverlay();
        this.fadeOut(250).then(() => {
          if (!attemptCurrent()) {
            abortCurrentAttempt();
            resolve();
            return;
          }
          globalScene.time.delayedCall(100, () => {
            if (!attemptCurrent()) {
              abortCurrentAttempt();
              resolve();
              return;
            }
            doSetMode(false);
            if (attemptCurrent()) {
              this.fadeIn(250);
            }
          });
        });
      } else {
        doSetMode(true);
      }
    });
  }

  /**
   * #840 unmirrored-screen tripwire (DEV/staging only). Called at the single setMode chokepoint for
   * an authoritative co-op session. Logs a coopWarn (never blocks - zero behavior change) when the
   * mode about to open is NOT a mirrored, co-op-wired screen and the PARTNER currently owns a live
   * shared interaction (an in-progress ME this client does not own, or a shop/screen this client is
   * only WATCHING). That combination is the fingerprint of a new interactive screen leaking in
   * host-only. A brand-new UiMode with no registry entry is a COMPILE error, so the undefined branch
   * is only a defensive runtime out-of-range guard.
   */
  private coopUnmirroredTripwire(mode: UiMode): void {
    if (coopUiClassOf(mode) === undefined) {
      coopWarn("ui", `setMode(${UiMode[mode]}) has NO co-op UI classification (registry miss) - classify it`);
      return;
    }
    const meCounter = coopMeInteractionStartValue();
    const partnerOwnsMe = coopMeInProgress() && getCoopController()?.isLocalOwnerAtCounter(meCounter) === false;
    const partnerOwnsMirror = getCoopUiMirror()?.isWatcher() === true;
    const reason = coopUnmirroredTripwireReason(mode, partnerOwnsMe || partnerOwnsMirror);
    if (reason != null) {
      coopWarn("ui", reason);
    }
  }

  /** Publish protocol-33 continuation evidence only after this UI has actually committed its public mode. */
  private coopAuthoritySurfaceReady(mode: UiMode): void {
    // The netcode predicate intentionally includes Showdown, which rides this authoritative substrate even
    // though its game mode is not classic co-op. Both roles report through this post-commit chokepoint: the
    // guest publishes ordered evidence, while the host can rearm one bounded peer-convergence stage.
    if (!this.getHandler().active) {
      return;
    }
    const surface = coopAuthorityContinuationSurface(mode);
    if (surface != null) {
      const controller = getCoopController();
      const battle = globalScene.currentBattle;
      if (controller != null && battle != null) {
        const address = {
          epoch: controller.sessionEpoch,
          wave: battle.waveIndex,
          turn: battle.turn,
        };
        if (isCoopAuthoritativeGuest()) {
          getCoopBattleStreamer()?.notifyContinuationSurface(surface);
          notifyCoopOperationContinuationSurface(surface, address);
        } else if (controller.role === "host") {
          notifyCoopOperationAuthorityContinuationSurface(surface, address);
        }
      }
    }
  }

  getMode(): UiMode {
    return this.mode;
  }

  setMode(mode: UiMode, ...args: any[]): Promise<void> {
    return this.setModeInternal(mode, true, false, false, args);
  }

  /** Clear only the transition-black overlay; generation owners call this before committing their screen. */
  private normalizeTransitionOverlay(): void {
    this.cancelOverlayTransitionTween();
    this.overlayActive = false;
    this.overlay.setAlpha(0);
    this.overlay.setVisible(false);
  }

  private cancelOverlayTransitionTween(): void {
    const release = this.overlayTransitionRelease;
    this.overlayTransitionRelease = null;
    try {
      globalScene.tweens.killTweensOf(this.overlay);
    } catch {
      // Teardown may already have destroyed the scene/tween manager; the local flags still normalize.
    }
    release?.();
  }

  /**
   * Co-op boundary seam: a lost fade/delayed callback cannot hold a shared transition forever. Timeout
   * invalidates every callback from that attempt, clears the old handler, and commits the target mode
   * synchronously; a later transition wins and reports `superseded` instead of being overwritten.
   */
  setModeBounded(mode: UiMode, timeoutMs = 2_000, ...args: any[]): Promise<"completed" | "forced" | "superseded"> {
    return this.setModeBoundedWhen(mode, timeoutMs, undefined, ...args);
  }

  /** Bounded co-op mode transition whose mutations are aborted when its exact phase/session fence expires. */
  setModeBoundedWhen(
    mode: UiMode,
    timeoutMs: number,
    isCurrent: (() => boolean) | undefined,
    ...args: any[]
  ): Promise<"completed" | "forced" | "superseded"> {
    return this.setModeBoundedInternal(mode, true, timeoutMs, isCurrent, args);
  }

  /**
   * Bounded form of {@linkcode setModeWithoutClear}. Nested reward/party overlays must preserve the
   * underlying shop handler, but they still need the same lost-fade deadline and generation fence as
   * every other authoritative co-op surface.
   */
  setModeWithoutClearBoundedWhen(
    mode: UiMode,
    timeoutMs: number,
    isCurrent: (() => boolean) | undefined,
    ...args: any[]
  ): Promise<"completed" | "forced" | "superseded"> {
    return this.setModeBoundedInternal(mode, false, timeoutMs, isCurrent, args);
  }

  private setModeBoundedInternal(
    mode: UiMode,
    clear: boolean,
    timeoutMs: number,
    isCurrent: (() => boolean) | undefined,
    args: any[],
  ): Promise<"completed" | "forced" | "superseded"> {
    // A projector may construct and start an exact successor before PhaseManager publishes it as the
    // current phase. setModeInternal deliberately performs no mutation when that caller fence is false,
    // but its resolved void promise cannot distinguish that refusal from a completed transition. Preserve
    // the stronger bounded contract here: a transition that never started is superseded, so the owning
    // phase can retry after its atomic installation instead of falsely publishing a missing UI surface.
    if (isCurrent?.() === false) {
      return Promise.resolve("superseded");
    }
    const transition = this.setModeInternal(mode, clear, false, false, args, isCurrent);
    const generation = this.modeTransitionGeneration;
    return new Promise(resolve => {
      let settled = false;
      const finish = (result: "completed" | "forced" | "superseded"): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(
        () => {
          if (generation !== this.modeTransitionGeneration || !(isCurrent?.() ?? true)) {
            if (generation === this.modeTransitionGeneration) {
              ++this.modeTransitionGeneration;
              this.normalizeTransitionOverlay();
            }
            finish("superseded");
            return;
          }
          ++this.modeTransitionGeneration;
          try {
            this.normalizeTransitionOverlay();
            if (clear) {
              this.getHandler().clear();
            }
            this.mode = mode;
            const touchControls = typeof document === "undefined" ? null : document.getElementById("touchControls");
            if (touchControls) {
              touchControls.dataset.uiMode = UiMode[mode];
            }
            this.getHandler().show(args);
            this.coopAuthoritySurfaceReady(mode);
            finish("forced");
          } catch {
            // The caller's exact phase/operation fence decides whether it may proceed after a failed force.
            finish("superseded");
          }
        },
        Math.max(1, Math.trunc(timeoutMs)),
      );
      transition.then(
        () => finish(generation === this.modeTransitionGeneration ? "completed" : "superseded"),
        () => finish("superseded"),
      );
    });
  }

  setModeForceTransition(mode: UiMode, ...args: any[]): Promise<void> {
    return this.setModeInternal(mode, true, true, false, args);
  }

  /**
   * Synchronously retire one presentation-owned mode without publishing a new authoritative control surface.
   *
   * A destructively replaced co-op presentation cannot wait for the ordinary fade/revert promise: that
   * promise may never settle, and its detached callback could later pop a successor UI. The owning phase
   * calls this only while its exact scene/runtime and phase identity are still installed. Invalidating the
   * transition generation first also makes a pending `setModeInternal` attempt inert before the phase shifts.
   *
   * @returns `true` when the expected mode was active and was synchronously removed. A pending transition is
   * still cancelled when this returns `false`.
   */
  retirePresentationMode(expectedMode: UiMode, fallbackMode: UiMode): boolean {
    ++this.modeTransitionGeneration;
    this.normalizeTransitionOverlay();
    if (this.mode !== expectedMode) {
      return false;
    }

    this.getHandler().clear();
    this.mode = this.modeChain.pop() ?? fallbackMode;
    const touchControls = typeof document === "undefined" ? null : document.getElementById("touchControls");
    if (touchControls) {
      touchControls.dataset.uiMode = UiMode[this.mode];
    }
    const restoredHandler = this.getHandler();
    if (!restoredHandler.active) {
      restoredHandler.show([]);
    }
    return true;
  }

  setModeWithoutClear(mode: UiMode, ...args: any[]): Promise<void> {
    return this.setModeInternal(mode, false, false, false, args);
  }

  setOverlayMode(mode: UiMode, ...args: any[]): Promise<void> {
    return this.setModeInternal(mode, false, false, true, args);
  }

  resetModeChain(): void {
    this.modeChain = [];
    globalScene.updateGameInfo();
  }

  revertMode(): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      if (this?.modeChain?.length === 0) {
        return resolve(false);
      }

      const lastMode = this.mode;

      const doRevertMode = () => {
        this.getHandler().clear();
        this.mode = this.modeChain.pop()!; // TODO: is this bang correct?
        globalScene.updateGameInfo();
        const touchControls = document.getElementById("touchControls");
        if (touchControls) {
          touchControls.dataset.uiMode = UiMode[this.mode];
        }
        this.coopAuthoritySurfaceReady(this.mode);
        resolve(true);
      };

      if (noTransitionModes.indexOf(lastMode) === -1) {
        this.fadeOut(250).then(() => {
          globalScene.time.delayedCall(100, () => {
            doRevertMode();
            this.fadeIn(250);
          });
        });
      } else {
        doRevertMode();
      }
    });
  }

  async revertModes(): Promise<void> {
    while (this.modeChain.length > 0) {
      if (!(await this.revertMode())) {
        break;
      }
    }
  }

  public getModeChain(): UiMode[] {
    return this.modeChain;
  }

  /**
   * getGamepadType - returns the type of gamepad being used
   * inputMethod could be "keyboard" or "touch" or "gamepad"
   * if inputMethod is "keyboard" or "touch", then the inputMethod is returned
   * if inputMethod is "gamepad", then the gamepad type is returned it could be "xbox" or "dualshock"
   * @returns gamepad type
   */
  public getGamepadType(): string {
    if (globalScene.inputMethod === "gamepad") {
      // TODO: is this bang correct?
      return globalScene.inputController.getConfig(globalScene.inputController.selectedDevice[Device.GAMEPAD]!).padType;
    }
    return globalScene.inputMethod;
  }

  /**
   * Attempts to free memory held by UI handlers
   * and clears menus from {@linkcode NavigationManager} to prepare for reset
   */
  public freeUIData(): void {
    globalScene.events.off(Phaser.Scenes.Events.UPDATE, this.refreshMoodyRuntime);
    this.moodyRuntimeUi?.destroy();
    this.moodyRuntimeUi = null;
    this.moodyChoiceQueue.splice(0);
    this.moodyChoiceOpen = false;
    this.handlers.forEach(h => h.destroy());
    this.handlers = [];
    NavigationManager.getInstance().clearNavigationMenus();
  }
}
