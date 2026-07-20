import { globalScene } from "#app/global-scene";
import { coopMeInProgress, coopMeInteractionStartValue } from "#data/elite-redux/coop/coop-me-pin-state";
import { getCoopController } from "#data/elite-redux/coop/coop-runtime";
import { getPokeballAtlasKey } from "#data/pokeball";
import { Button } from "#enums/buttons";
import { MysteryEncounterOptionMode } from "#enums/mystery-encounter-option-mode";
import { MysteryEncounterTier } from "#enums/mystery-encounter-tier";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { getEncounterText } from "#mystery-encounters/encounter-dialogue-utils";
import type { OptionSelectSettings } from "#mystery-encounters/encounter-phase-utils";
import type { MysteryEncounterOption } from "#mystery-encounters/mystery-encounter-option";
import { allMysteryEncounters } from "#mystery-encounters/mystery-encounters";
// Co-op authoritative non-battle ME (#633 BLOCK-2 / P0 / ADD-1b / ADD-4): on the guest path the
// current phase is CoopReplayMePhase (a guest-owned ME forwards the pick to it), and the host streams
// its authoritative presentation so the handler reads per-option enablement / labels from there
// instead of re-deriving off the guest's diverged party. Solo / host / lockstep => returns null /
// never the CoopReplayMePhase branch. The cast is TYPE-only; the runtime check is the phaseName string.
import type { CoopReplayMePhase } from "#phases/coop-replay-me-phase";
import { getCoopMeHostPresentation } from "#phases/coop-replay-me-phase";
import type { MysteryEncounterPhase } from "#phases/mystery-encounter-phases";
import { PartyUiMode } from "#ui/party-ui-handler";
import { addBBCodeTextObject, getBBCodeFrag } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow, WindowVariant } from "#ui/ui-theme";
import { fixedInt } from "#utils/common";
import i18next from "i18next";
import type BBCodeText from "phaser3-rex-plugins/plugins/bbcodetext";

export class MysteryEncounterUiHandler extends UiHandler {
  private cursorContainer: Phaser.GameObjects.Container;
  private cursorObj?: Phaser.GameObjects.Image | undefined;

  private optionsContainer: Phaser.GameObjects.Container;
  // Length = max number of allowable options (4)
  private optionScrollTweens: (Phaser.Tweens.Tween | null)[] = new Array(4).fill(null);

  private tooltipWindow: Phaser.GameObjects.NineSlice;
  private tooltipContainer: Phaser.GameObjects.Container;
  private tooltipScrollTween?: Phaser.Tweens.Tween | undefined;

  private descriptionWindow: Phaser.GameObjects.NineSlice;
  private descriptionContainer: Phaser.GameObjects.Container;
  private descriptionScrollTween?: Phaser.Tweens.Tween | undefined;
  private rarityBall: Phaser.GameObjects.Sprite;

  private dexProgressWindow: Phaser.GameObjects.NineSlice;
  private dexProgressContainer: Phaser.GameObjects.Container;
  private showDexProgress = false;

  private overrideSettings?: OptionSelectSettings | undefined;
  private encounterOptions: MysteryEncounterOption[] = [];
  // Initialized empty (not left undefined) so a processInput that races a not-yet-rendered selector - e.g. a
  // co-op guest whose ME opened before displayEncounterOptions populated it - reads [] rather than crashing on
  // `optionsMeetsReqs[cursor]` of undefined.
  private optionsMeetsReqs: boolean[] = [];

  protected viewPartyIndex = 0;
  protected viewPartyXPosition = 0;

  protected blockInput = true;

  constructor() {
    super(UiMode.MYSTERY_ENCOUNTER);
  }

  override setup() {
    const ui = this.getUi();

    this.cursorContainer = globalScene.add.container(18, -38.7);
    this.cursorContainer.setVisible(false);
    ui.add(this.cursorContainer);
    this.optionsContainer = globalScene.add.container(12, -38.7);
    this.optionsContainer.setVisible(false);
    ui.add(this.optionsContainer);
    this.dexProgressContainer = globalScene.add.container(214, -43);
    this.dexProgressContainer.setVisible(false);
    ui.add(this.dexProgressContainer);
    this.descriptionContainer = globalScene.add.container(0, -152);
    this.descriptionContainer.setVisible(false);
    ui.add(this.descriptionContainer);
    this.tooltipContainer = globalScene.add.container(210, -48);
    this.tooltipContainer.setVisible(false);
    ui.add(this.tooltipContainer);

    this.setCursor(this.getCursor());

    this.descriptionWindow = addWindow(0, 0, 150, 105, false, false, 0, 0, WindowVariant.THIN);
    this.descriptionContainer.add(this.descriptionWindow);

    this.tooltipWindow = addWindow(0, 0, 110, 48, false, false, 0, 0, WindowVariant.THIN);
    this.tooltipContainer.add(this.tooltipWindow);

    this.dexProgressWindow = addWindow(0, 0, 24, 28, false, false, 0, 0, WindowVariant.THIN);
    this.dexProgressContainer.add(this.dexProgressWindow);

    this.rarityBall = globalScene.add.sprite(141, 9, "pb");
    this.rarityBall.setScale(0.75);
    this.descriptionContainer.add(this.rarityBall);

    const dexProgressIndicator = globalScene.add.sprite(12, 10, "encounter_radar");
    dexProgressIndicator.setScale(0.8);
    this.dexProgressContainer.add(dexProgressIndicator);
    this.dexProgressContainer.setInteractive(new Phaser.Geom.Rectangle(0, 0, 24, 28), Phaser.Geom.Rectangle.Contains);
  }

  override show(args: any[]): boolean {
    super.show(args);

    this.overrideSettings = (args[0] as OptionSelectSettings) ?? {};
    const showDescriptionContainer =
      this.overrideSettings?.hideDescription == null ? true : !this.overrideSettings.hideDescription;
    const slideInDescription =
      this.overrideSettings?.slideInDescription == null ? true : this.overrideSettings.slideInDescription;
    const startingCursorIndex = this.overrideSettings?.startingCursorIndex ?? 0;

    this.cursorContainer.setVisible(true);
    this.descriptionContainer.setVisible(showDescriptionContainer);
    this.optionsContainer.setVisible(true);
    this.dexProgressContainer.setVisible(true);
    this.displayEncounterOptions(slideInDescription);
    const cursor = this.getCursor();
    if (cursor === (this.optionsContainer?.length || 0) - 1) {
      // Always resets cursor on view party button if it was last there
      this.setCursor(cursor);
    } else {
      this.setCursor(startingCursorIndex);
    }
    if (this.blockInput) {
      setTimeout(() => {
        this.unblockInput();
      }, 1000);
    }
    this.displayOptionTooltip();

    return true;
  }

  override processInput(button: Button): boolean {
    const ui = this.getUi();

    // An authoritative guest always renders the host-streamed ME screen, but only the pinned owner may
    // drive it. `show()` releases its short animation lock after one second, so ownership must be a
    // separate permanent gate; otherwise a watcher can originate a stale `me` choice and durable retry
    // while the host has already moved on to the reward/shop boundary.
    const activePhase = globalScene.phaseManager.getCurrentPhase();
    if (activePhase?.phaseName === "CoopReplayMePhase" && !(activePhase as CoopReplayMePhase).canLocalPlayerSelect()) {
      return false;
    }

    let success = false;

    const cursor = this.getCursor();

    if (button === Button.CANCEL || button === Button.ACTION) {
      if (button === Button.ACTION) {
        const selected = this.encounterOptions[cursor];
        if (cursor === this.viewPartyIndex) {
          // Handle view party
          success = true;
          const overrideSettings: OptionSelectSettings = {
            ...this.overrideSettings,
            slideInDescription: false,
          };
          globalScene.ui.setMode(UiMode.PARTY, PartyUiMode.CHECK, -1, () => {
            globalScene.ui.setMode(UiMode.MYSTERY_ENCOUNTER, overrideSettings);
            setTimeout(() => {
              this.setCursor(this.viewPartyIndex);
              this.unblockInput();
            }, 300);
          });
        } else if (
          this.blockInput
          || (!this.optionsMeetsReqs[cursor]
            && (selected.optionMode === MysteryEncounterOptionMode.DISABLED_OR_DEFAULT
              || selected.optionMode === MysteryEncounterOptionMode.DISABLED_OR_SPECIAL))
        ) {
          success = false;
        } else {
          const phase = activePhase;
          if (phase?.phaseName === "CoopReplayMePhase") {
            // Co-op guest-owned ME (#633 BLOCK-3): forward the chosen index to the replay phase (which
            // relays it to the host, the sole engine). No local engine resolution on the guest; the
            // current phase here is CoopReplayMePhase, not MysteryEncounterPhase. View-party stays local
            // (handled above at the viewPartyIndex branch).
            (phase as CoopReplayMePhase).handleGuestOptionSelect(cursor);
            success = true;
          } else if ((phase as MysteryEncounterPhase).handleOptionSelect(selected, cursor)) {
            success = true;
          } else {
            ui.playError();
          }
        }
      } else {
        // TODO: If we need to handle cancel option? Maybe default logic to leave/run from encounter idk
      }
    } else {
      switch (this.optionsContainer.getAll()?.length) {
        // biome-ignore lint/suspicious/useDefaultSwitchClauseLast: Default shares logic with case 3 and it makes more sense for the statements to be ordered by the case value
        default:
        case 3:
          success = this.handleTwoOptionMoveInput(button);
          break;
        case 4:
          success = this.handleThreeOptionMoveInput(button);
          break;
        case 5:
          success = this.handleFourOptionMoveInput(button);
          break;
      }

      this.displayOptionTooltip();
    }

    if (success) {
      ui.playSelect();
    }

    return success;
  }

  private handleTwoOptionMoveInput(button: Button): boolean {
    let success = false;
    const cursor = this.getCursor();
    switch (button) {
      case Button.UP:
        if (cursor < this.viewPartyIndex) {
          success = this.setCursor(this.viewPartyIndex);
        }
        break;
      case Button.DOWN:
        if (cursor === this.viewPartyIndex) {
          success = this.setCursor(1);
        }
        break;
      case Button.LEFT:
        if (cursor > 0) {
          success = this.setCursor(cursor - 1);
        }
        break;
      case Button.RIGHT:
        if (cursor < this.viewPartyIndex) {
          success = this.setCursor(cursor + 1);
        }
        break;
    }

    return success;
  }

  private handleThreeOptionMoveInput(button: Button): boolean {
    let success = false;
    const cursor = this.getCursor();
    switch (button) {
      case Button.UP:
        if (cursor === 2) {
          success = this.setCursor(cursor - 2);
        } else {
          success = this.setCursor(this.viewPartyIndex);
        }
        break;
      case Button.DOWN:
        if (cursor === this.viewPartyIndex) {
          success = this.setCursor(1);
        } else {
          success = this.setCursor(2);
        }
        break;
      case Button.LEFT:
        if (cursor === this.viewPartyIndex) {
          success = this.setCursor(1);
        } else if (cursor === 1) {
          success = this.setCursor(cursor - 1);
        }
        break;
      case Button.RIGHT:
        if (cursor === 1) {
          success = this.setCursor(this.viewPartyIndex);
        } else if (cursor < 1) {
          success = this.setCursor(cursor + 1);
        }
        break;
    }

    return success;
  }

  private handleFourOptionMoveInput(button: Button): boolean {
    let success = false;
    const cursor = this.getCursor();
    switch (button) {
      case Button.UP:
        if (cursor >= 2 && cursor !== this.viewPartyIndex) {
          success = this.setCursor(cursor - 2);
        } else {
          success = this.setCursor(this.viewPartyIndex);
        }
        break;
      case Button.DOWN:
        if (cursor <= 1) {
          success = this.setCursor(cursor + 2);
        } else if (cursor === this.viewPartyIndex) {
          success = this.setCursor(1);
        }
        break;
      case Button.LEFT:
        if (cursor === this.viewPartyIndex) {
          success = this.setCursor(1);
        } else if (cursor % 2 === 1) {
          success = this.setCursor(cursor - 1);
        }
        break;
      case Button.RIGHT:
        if (cursor === 1) {
          success = this.setCursor(this.viewPartyIndex);
        } else if (cursor % 2 === 0 && cursor !== this.viewPartyIndex) {
          success = this.setCursor(cursor + 1);
        }
        break;
    }

    return success;
  }

  /**
   * When ME UI first displays, the option buttons will be disabled temporarily to prevent player accidentally clicking through hastily
   * This method is automatically called after a short delay but can also be called manually
   */
  unblockInput() {
    if (this.blockInput) {
      this.blockInput = false;
      for (let i = 0; i < this.optionsContainer.length - 1; i++) {
        const optionMode = this.encounterOptions[i].optionMode;
        if (
          !this.optionsMeetsReqs[i]
          && (optionMode === MysteryEncounterOptionMode.DISABLED_OR_DEFAULT
            || optionMode === MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
        ) {
          continue;
        }
        (this.optionsContainer.getAt(i) as Phaser.GameObjects.Text).setAlpha(1);
      }
    }
  }

  override isCoopV2InputActionable(): boolean {
    return this.active && !this.blockInput;
  }

  override getCursor(): number {
    return this.cursor ? this.cursor : 0;
  }

  override setCursor(cursor: number): boolean {
    const prevCursor = this.getCursor();
    const changed = prevCursor !== cursor;
    if (changed) {
      this.cursor = cursor;
      // #817 co-op cursor mirror: the ME OWNER's cursor is streamed so the watcher's
      // read-only selector highlights the same option live (like the shop). Cosmetic.
      try {
        if (
          globalScene.gameMode?.isCoop
          && coopMeInProgress()
          && (getCoopController()?.isLocalOwnerAtCounter(coopMeInteractionStartValue()) ?? false)
        ) {
          getCoopController()?.sendMeCursor(cursor);
        }
      } catch {
        /* cosmetic */
      }
    }

    this.viewPartyIndex = this.optionsContainer.getAll()?.length - 1;

    if (!this.cursorObj) {
      this.cursorObj = globalScene.add.image(0, 0, "cursor");
      this.cursorContainer.add(this.cursorObj);
    }

    if (cursor === this.viewPartyIndex) {
      this.cursorObj.setPosition(this.viewPartyXPosition, -17);
    } else if (this.optionsContainer.getAll()?.length === 3) {
      // 2 Options
      this.cursorObj.setPosition(-10.5 + (cursor % 2 === 1 ? 100 : 0), 15);
    } else if (this.optionsContainer.getAll()?.length === 4) {
      // 3 Options
      this.cursorObj.setPosition(-10.5 + (cursor % 2 === 1 ? 100 : 0), 7 + (cursor > 1 ? 16 : 0));
    } else if (this.optionsContainer.getAll()?.length === 5) {
      // 4 Options
      this.cursorObj.setPosition(-10.5 + (cursor % 2 === 1 ? 100 : 0), 7 + (cursor > 1 ? 16 : 0));
    }

    return changed;
  }

  displayEncounterOptions(slideInDescription = true): void {
    this.getUi().clearText();
    // A co-op authoritative guest renders the host's ME with NO local event engine of its own (its own
    // option.meetsRequirements() / dialogue re-derivation would read its DIVERGED party - the exact reason
    // the host streams its authoritative presentation). currentBattle.mysteryEncounter is therefore undefined
    // on the guest BY DESIGN; source the option STRUCTURE + dialogue read-only from the adopted-type registry
    // template so the selector renders instead of crashing on the absent local encounter. The dynamic
    // per-option enablement (`meetsReqs`) + labels still come from the host presentation below, so no
    // requirement is re-derived against the guest's party.
    const mysteryEncounter =
      globalScene.currentBattle.mysteryEncounter
      ?? (globalScene.currentBattle.mysteryEncounterType == null
        ? undefined
        : allMysteryEncounters[globalScene.currentBattle.mysteryEncounterType]);
    if (mysteryEncounter == null) {
      // Neither a live local encounter nor an adopted descriptor: render an empty, non-crashing selector
      // rather than dereferencing an absent encounter (guards processInput's optionsMeetsReqs[cursor] read).
      this.encounterOptions = [];
      this.optionsMeetsReqs = [];
      return;
    }
    this.encounterOptions = this.overrideSettings?.overrideOptions ?? mysteryEncounter.options;
    this.optionsMeetsReqs = [];

    const titleText: string | null = getEncounterText(
      mysteryEncounter.dialogue.encounterOptionsDialogue?.title,
      TextStyle.TOOLTIP_TITLE,
    );
    const descriptionText: string | null = getEncounterText(
      mysteryEncounter.dialogue.encounterOptionsDialogue?.description,
      TextStyle.TOOLTIP_CONTENT,
    );
    const queryText: string | null = getEncounterText(
      mysteryEncounter.dialogue.encounterOptionsDialogue?.query,
      TextStyle.TOOLTIP_CONTENT,
    );

    // Clear options container (except cursor)
    this.optionsContainer.removeAll(true);

    // Options Window
    for (let i = 0; i < this.encounterOptions.length; i++) {
      const option = this.encounterOptions[i];

      let optionText: BBCodeText;
      switch (this.encounterOptions.length) {
        // biome-ignore lint/suspicious/useDefaultSwitchClauseLast: default shares logic with case 2 and it makes more sense for the statements to be ordered by the case number
        default:
        case 2:
          optionText = addBBCodeTextObject(i % 2 === 0 ? 0 : 100, 8, "-", TextStyle.WINDOW, {
            fontSize: "80px",
            lineSpacing: -8,
          });
          break;
        case 3:
          optionText = addBBCodeTextObject(i % 2 === 0 ? 0 : 100, i < 2 ? 0 : 16, "-", TextStyle.WINDOW, {
            fontSize: "80px",
            lineSpacing: -8,
          });
          break;
        case 4:
          optionText = addBBCodeTextObject(i % 2 === 0 ? 0 : 100, i < 2 ? 0 : 16, "-", TextStyle.WINDOW, {
            fontSize: "80px",
            lineSpacing: -8,
          });
          break;
      }

      // Co-op authoritative non-battle ME (#633 BLOCK-2 / P0 / ADD-4): on the guest path the host
      // streams its authoritative per-option enablement + resolved label, because the guest's own
      // option.meetsRequirements() / disabledButtonLabel re-derivation reads its DIVERGED party. When
      // a host presentation is present, use its meetsReqs[i] / labels[i]; else (solo / host-owned /
      // lockstep, or a host stall) fall back to the local re-derivation, byte-identical to before.
      const hostPres = getCoopMeHostPresentation();
      const meets =
        hostPres == null ? option.meetsRequirements() : (hostPres.meetsReqs[i] ?? option.meetsRequirements());
      this.optionsMeetsReqs.push(meets);
      const optionDialogue = option.dialogue!;
      const localLabel =
        !this.optionsMeetsReqs[i] && optionDialogue.disabledButtonLabel
          ? optionDialogue.disabledButtonLabel
          : optionDialogue.buttonLabel;
      const hostLabel = hostPres == null ? undefined : hostPres.labels[i];
      const label = hostLabel ?? localLabel;
      let text: string | null;
      if (
        option.hasRequirements()
        && this.optionsMeetsReqs[i]
        && (option.optionMode === MysteryEncounterOptionMode.DEFAULT_OR_SPECIAL
          || option.optionMode === MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
      ) {
        // Options with special requirements that are met are automatically colored green
        text = getEncounterText(label, TextStyle.ME_OPTION_SPECIAL);
      } else {
        text = getEncounterText(label, optionDialogue.style ? optionDialogue.style : TextStyle.ME_OPTION_DEFAULT);
      }

      if (text) {
        optionText.setText(text);
      }

      if (
        !this.optionsMeetsReqs[i]
        && (option.optionMode === MysteryEncounterOptionMode.DISABLED_OR_DEFAULT
          || option.optionMode === MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
      ) {
        optionText.setAlpha(0.5);
      }
      if (this.blockInput) {
        optionText.setAlpha(0.5);
      }

      // Sets up the mask that hides the option text to give an illusion of scrolling
      const nonScrollWidth = 90;
      const optionTextMaskRect = globalScene.make.graphics({});
      optionTextMaskRect.setScale(6);
      optionTextMaskRect.fillStyle(0xffffff);
      optionTextMaskRect.beginPath();
      optionTextMaskRect.fillRect(optionText.x + 11, optionText.y + 140, nonScrollWidth, 18);

      const optionTextMask = optionTextMaskRect.createGeometryMask();
      optionText.setMask(optionTextMask);

      const optionTextWidth = optionText.displayWidth;

      const tween = this.optionScrollTweens[i];
      if (tween) {
        tween.remove();
        this.optionScrollTweens[i] = null;
      }

      // Animates the option text scrolling sideways
      if (optionTextWidth > nonScrollWidth) {
        this.optionScrollTweens[i] = globalScene.tweens.add({
          targets: optionText,
          delay: fixedInt(2000),
          loop: -1,
          hold: fixedInt(2000),
          duration: fixedInt(((optionTextWidth - nonScrollWidth) / 15) * 2000),
          x: `-=${optionTextWidth - nonScrollWidth}`,
        });
      }

      this.optionsContainer.add(optionText);
    }

    // View Party Button
    const viewPartyText = addBBCodeTextObject(
      globalScene.scaledCanvas.width,
      -24,
      getBBCodeFrag(i18next.t("mysteryEncounterMessages:viewPartyButton"), TextStyle.PARTY),
      TextStyle.PARTY,
    );
    this.optionsContainer.add(viewPartyText);
    viewPartyText.x -= viewPartyText.displayWidth + 16;
    this.viewPartyXPosition = viewPartyText.x - 10;

    // Description Window
    const titleTextObject = addBBCodeTextObject(0, 0, titleText ?? "", TextStyle.TOOLTIP_TITLE, {
      wordWrap: { width: 750 },
      align: "center",
      lineSpacing: -8,
    });
    this.descriptionContainer.add(titleTextObject);
    titleTextObject.setPosition(72 - titleTextObject.displayWidth / 2, 5.5);

    // Rarity of encounter
    const index =
      mysteryEncounter.encounterTier === MysteryEncounterTier.COMMON
        ? 0
        : mysteryEncounter.encounterTier === MysteryEncounterTier.GREAT
          ? 1
          : mysteryEncounter.encounterTier === MysteryEncounterTier.ULTRA
            ? 2
            : mysteryEncounter.encounterTier === MysteryEncounterTier.ROGUE
              ? 3
              : 4;
    const ballType = getPokeballAtlasKey(index);
    this.rarityBall.setTexture("pb", ballType);

    const descriptionTextObject = addBBCodeTextObject(6, 25, descriptionText ?? "", TextStyle.TOOLTIP_CONTENT, {
      wordWrap: { width: 830 },
    });

    // Sets up the mask that hides the description text to give an illusion of scrolling
    const descriptionTextMaskRect = globalScene.make.graphics({});
    descriptionTextMaskRect.setScale(6);
    descriptionTextMaskRect.fillStyle(0xffffff);
    descriptionTextMaskRect.beginPath();
    descriptionTextMaskRect.fillRect(6, 53, 206, 57);

    const abilityDescriptionTextMask = descriptionTextMaskRect.createGeometryMask();

    descriptionTextObject.setMask(abilityDescriptionTextMask);

    const descriptionLineCount = Math.floor(descriptionTextObject.displayHeight / 9.2);

    if (this.descriptionScrollTween) {
      this.descriptionScrollTween.remove();
      this.descriptionScrollTween = undefined;
    }

    // Animates the description text moving upwards
    if (descriptionLineCount > 6) {
      this.descriptionScrollTween = globalScene.tweens.add({
        targets: descriptionTextObject,
        delay: fixedInt(2000),
        loop: -1,
        hold: fixedInt(2000),
        duration: fixedInt((descriptionLineCount - 6) * 2000),
        y: `-=${10 * (descriptionLineCount - 6)}`,
      });
    }

    this.descriptionContainer.add(descriptionTextObject);

    const queryTextObject = addBBCodeTextObject(0, 0, queryText ?? "", TextStyle.TOOLTIP_CONTENT, {
      wordWrap: { width: 830 },
    });
    this.descriptionContainer.add(queryTextObject);
    queryTextObject.setPosition(75 - queryTextObject.displayWidth / 2, 90);

    // Slide in description container
    if (slideInDescription) {
      this.descriptionContainer.x -= 150;
      globalScene.tweens.add({
        targets: this.descriptionContainer,
        x: "+=150",
        ease: "Sine.easeInOut",
        duration: 1000,
      });
    }
  }

  /**
   * Updates and displays the tooltip for a given option
   * The tooltip will auto wrap and scroll if it is too long
   */
  private displayOptionTooltip() {
    const cursor = this.getCursor();
    // Clear tooltip box
    if (this.tooltipContainer.length > 1) {
      this.tooltipContainer.removeBetween(1, this.tooltipContainer.length, true);
    }
    this.tooltipContainer.setVisible(true);

    if (cursor == null || cursor > this.optionsContainer.length - 2) {
      // Ignore hovers on view party button
      // Hide dex progress if visible
      this.showHideDexProgress(false);
      return;
    }

    let text: string | null;
    const cursorOption = this.encounterOptions[cursor];
    const optionDialogue = cursorOption.dialogue!;
    if (
      !this.optionsMeetsReqs[cursor]
      && (cursorOption.optionMode === MysteryEncounterOptionMode.DISABLED_OR_DEFAULT
        || cursorOption.optionMode === MysteryEncounterOptionMode.DISABLED_OR_SPECIAL)
      && optionDialogue.disabledButtonTooltip
    ) {
      text = getEncounterText(optionDialogue.disabledButtonTooltip, TextStyle.TOOLTIP_CONTENT);
    } else {
      text = getEncounterText(optionDialogue.buttonTooltip, TextStyle.TOOLTIP_CONTENT);
    }

    // Auto-color options green/blue for good/bad by looking for (+)/(-)
    if (text) {
      const primaryStyleString = [...text.match(new RegExp(/\[color=[^[]*\]\[shadow=[^[]*\]/i))!][0];
      text = text.replace(
        /(\(\+\)[^([]*)/gi,
        substring =>
          "[/color][/shadow]"
          + getBBCodeFrag(substring, TextStyle.SUMMARY_GREEN)
          + "[/color][/shadow]"
          + primaryStyleString,
      );
      text = text.replace(
        /(\(-\)[^([]*)/gi,
        substring =>
          "[/color][/shadow]"
          + getBBCodeFrag(substring, TextStyle.SUMMARY_BLUE)
          + "[/color][/shadow]"
          + primaryStyleString,
      );
    }

    if (text) {
      const tooltipTextObject = addBBCodeTextObject(6, 7, text, TextStyle.TOOLTIP_CONTENT, {
        wordWrap: { width: 600 },
        fontSize: "72px",
        padding: { top: 8 },
        lineSpacing: 1.25,
      });
      this.tooltipContainer.add(tooltipTextObject);

      // Sets up the mask that hides the description text to give an illusion of scrolling
      const tooltipTextMaskRect = globalScene.make.graphics({});
      tooltipTextMaskRect.setScale(6);
      tooltipTextMaskRect.fillStyle(0xffffff);
      tooltipTextMaskRect.beginPath();
      tooltipTextMaskRect.fillRect(this.tooltipContainer.x, this.tooltipContainer.y + 188.5, 150, 32);

      const textMask = tooltipTextMaskRect.createGeometryMask();
      tooltipTextObject.setMask(textMask);

      const tooltipLineCount = Math.floor(tooltipTextObject.displayHeight / 10.2);

      if (this.tooltipScrollTween) {
        this.tooltipScrollTween.remove();
        this.tooltipScrollTween = undefined;
      }

      // Animates the tooltip text moving upwards
      if (tooltipLineCount > 3) {
        this.tooltipScrollTween = globalScene.tweens.add({
          targets: tooltipTextObject,
          delay: fixedInt(1200),
          loop: -1,
          hold: fixedInt(1200),
          duration: fixedInt((tooltipLineCount - 3) * 1200),
          y: `-=${11.2 * (tooltipLineCount - 3)}`,
        });
      }
    }

    // Dex progress indicator
    if (cursorOption.hasDexProgress && !this.showDexProgress) {
      this.showHideDexProgress(true);
    } else if (!cursorOption.hasDexProgress) {
      this.showHideDexProgress(false);
    }
  }

  override clear(): void {
    super.clear();
    this.overrideSettings = undefined;
    this.optionsContainer.setVisible(false);
    this.optionsContainer.removeAll(true);
    this.dexProgressContainer.setVisible(false);
    this.descriptionContainer.setVisible(false);
    this.tooltipContainer.setVisible(false);
    // Keeps container background and pokeball
    this.descriptionContainer.removeBetween(2, this.descriptionContainer.length, true);
    this.getUi().getMessageHandler().clearText();
    this.eraseCursor();
  }

  private eraseCursor(): void {
    if (this.cursorObj) {
      this.cursorObj.destroy();
    }
    this.cursorObj = undefined;
  }

  /**
   * Will show or hide the Dex progress icon for an option that has dex progress
   * @param show - if true does show, if false does hide
   */
  private showHideDexProgress(show: boolean) {
    if (show && !this.showDexProgress) {
      this.showDexProgress = true;
      globalScene.tweens.killTweensOf(this.dexProgressContainer);
      globalScene.tweens.add({
        targets: this.dexProgressContainer,
        y: -63,
        ease: "Sine.easeInOut",
        duration: 750,
        onComplete: () => {
          this.dexProgressContainer.on("pointerover", () => {
            globalScene.ui.showTooltip("", i18next.t("mysteryEncounterMessages:affectsPokedex"), true);
          });
          this.dexProgressContainer.on("pointerout", () => {
            globalScene.ui.hideTooltip();
          });
        },
      });
    } else if (!show && this.showDexProgress) {
      this.showDexProgress = false;
      globalScene.tweens.killTweensOf(this.dexProgressContainer);
      globalScene.tweens.add({
        targets: this.dexProgressContainer,
        y: -43,
        ease: "Sine.easeInOut",
        duration: 750,
        onComplete: () => {
          this.dexProgressContainer.off("pointerover");
          this.dexProgressContainer.off("pointerout");
        },
      });
    }
  }
}
