import { pokerogueApi } from "#api/api";
import { loggedInUser } from "#app/account";
import { FAKE_TITLE_LOGO_CHANCE } from "#app/constants";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { isBeta, isDev } from "#constants/app-constants";
import { GHOST_NOTIF_SETTING_KEY, initErNotifications } from "#data/elite-redux/er-ghost-notifications";
import { getSplashMessages } from "#data/splash-messages";
import { Button } from "#enums/buttons";
import { PlayerGender } from "#enums/player-gender";
import type { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { version } from "#package.json";
import { type ErNotification, notificationManager } from "#system/notifications/notification-manager";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { TimedEventDisplay } from "#ui/event-display";
import { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import { addTextObject } from "#ui/text";
import { fixedInt, randInt, randItem } from "#utils/common";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

export class TitleUiHandler extends OptionSelectUiHandler {
  /** If the stats can not be retrieved, use this fallback value */
  private static readonly BATTLES_WON_FALLBACK: number = -1;

  private titleContainer: Phaser.GameObjects.Container;
  private usernameLabel: Phaser.GameObjects.Text;
  private playerCountLabel: Phaser.GameObjects.Text;
  private splashMessage: string;
  private splashMessageText: Phaser.GameObjects.Text;
  private eventDisplay: TimedEventDisplay;
  private appVersionText: Phaser.GameObjects.Text;

  // ER notification inbox: a small mail icon at top-right. Press UP from the top
  // menu option to highlight it, then ACTION to open the inbox window.
  private inboxIcon: Phaser.GameObjects.Container;
  private inboxBadge: Phaser.GameObjects.Ellipse;
  private inboxHighlight: Phaser.GameObjects.Rectangle;
  private inboxFocused = false;

  private titleStatsTimer: NodeJS.Timeout | null;

  /** Bridges a notification type's settingKey to the live scene toggle. */
  private readonly notifEnabled = (key: string): boolean =>
    key === GHOST_NOTIF_SETTING_KEY ? globalScene.ghostNotifications !== false : true;

  /**
   * Returns the username of logged in user. If the username is hidden, the trainer name based on gender will be displayed.
   * @returns The username of logged in user
   */
  private getUsername(): string {
    const usernameReplacement = i18next.t(
      globalScene.gameData.gender === PlayerGender.FEMALE ? "trainerNames:playerF" : "trainerNames:playerM",
    );

    const displayName = globalScene.hideUsername
      ? usernameReplacement
      : (loggedInUser?.username ?? i18next.t("common:guest"));

    return i18next.t("menu:loggedInAs", { username: displayName });
  }

  updateUsername() {
    this.usernameLabel.setText(this.getUsername());
  }

  constructor(mode: UiMode = UiMode.TITLE) {
    super(mode);
  }

  setup() {
    super.setup();

    const ui = this.getUi();

    const scaledHeight = globalScene.scaledCanvas.height;
    const scaledWidth = globalScene.scaledCanvas.width;

    this.titleContainer = globalScene.add
      .container(0, -scaledHeight) // formatting
      .setName("title")
      .setAlpha(0);
    ui.add(this.titleContainer);

    const logo = globalScene.add
      .image(scaledWidth / 2, 8, this.getLogo()) // formatting
      .setOrigin(0.5, 0);

    if (timedEventManager.isEventActive()) {
      this.eventDisplay = new TimedEventDisplay(0, 0, timedEventManager.activeEvent());
      this.eventDisplay.setup();
      this.titleContainer.add(this.eventDisplay);
    }

    const labelPosX = scaledWidth - 2;
    // Actual y positions will be determined after the title menu has been populated with options
    this.usernameLabel = addTextObject(labelPosX, 0, this.getUsername(), TextStyle.MESSAGE, { fontSize: "54px" }) // formatting
      .setOrigin(1, 0);

    this.playerCountLabel = addTextObject(labelPosX, 0, `? ${i18next.t("menu:playersOnline")}`, TextStyle.MESSAGE, {
      // formatting
      fontSize: "54px",
    }).setOrigin(1, 0);

    const logoX = logo.x;
    const logoHeight = logo.y + logo.displayHeight;

    this.splashMessageText = addTextObject(logoX + 64, logoHeight - 8, "", TextStyle.MONEY, { fontSize: "54px" })
      .setOrigin()
      .setAngle(-20);

    globalScene.tweens.add({
      targets: this.splashMessageText,
      duration: fixedInt(350),
      scale: "*=1.25",
      loop: -1,
      yoyo: true,
    });

    this.appVersionText = addTextObject(logoX - 60, logoHeight + 4, "", TextStyle.MONEY, { fontSize: "54px" }) // formatting
      .setOrigin();

    this.titleContainer.add([
      logo,
      this.usernameLabel,
      this.playerCountLabel,
      this.splashMessageText,
      this.appVersionText,
    ]);

    // Build the small inbox mail icon (types/sources + welcome are registered in
    // show(), once the player is logged in, so notifications land in their bucket).
    this.buildInboxIcon(scaledWidth);
  }

  /** A small envelope icon (drawn with shapes, asset-free) + an unread dot. */
  private buildInboxIcon(scaledWidth: number): void {
    const w = 13;
    const h = 9;
    this.inboxIcon = globalScene.add.container(scaledWidth - 4, 30);
    // Focus highlight: a yellow outline shown while the icon is selected.
    this.inboxHighlight = globalScene.add
      .rectangle(-w / 2, 0, w + 6, h + 6, 0x000000, 0)
      .setStrokeStyle(1, 0xffe066, 1)
      .setVisible(false);
    const env = globalScene.add.graphics();
    env.fillStyle(0x303048, 0.95);
    env.fillRect(-w, -h / 2, w, h);
    env.lineStyle(1, 0xe8ecff, 1);
    env.strokeRect(-w, -h / 2, w, h);
    // The envelope flap: a "V" from the two top corners to the centre.
    env.beginPath();
    env.moveTo(-w, -h / 2);
    env.lineTo(-w / 2, 0);
    env.lineTo(0, -h / 2);
    env.strokePath();
    // Unread dot at the top-right corner (hidden when nothing is unread).
    this.inboxBadge = globalScene.add.ellipse(0, -h / 2, 5, 5, 0xff5555).setVisible(false);
    this.inboxIcon.add([this.inboxHighlight, env, this.inboxBadge]);
    this.titleContainer.add(this.inboxIcon);
    this.redrawInbox();
  }

  /** Re-pull sources (background) + redraw the badge. */
  private refreshInbox(): void {
    notificationManager
      .refresh(this.notifEnabled)
      .then(() => this.redrawInbox())
      .catch(() => {
        /* manager isolates its own source errors */
      });
    this.redrawInbox();
  }

  /** Show/hide the unread dot from the current unread count. */
  private redrawInbox(): void {
    this.inboxBadge?.setVisible(notificationManager.unreadCount(this.notifEnabled) > 0);
  }

  private setInboxFocused(focused: boolean): void {
    this.inboxFocused = focused;
    this.inboxHighlight?.setVisible(focused);
  }

  override processInput(button: Button): boolean {
    // While the inbox icon is focused, ACTION opens it; DOWN/CANCEL drops back to
    // the menu; everything else is swallowed so the menu cursor doesn't move.
    if (this.inboxFocused) {
      switch (button) {
        case Button.ACTION:
        case Button.SUBMIT:
          this.setInboxFocused(false);
          this.openInbox();
          return true;
        case Button.DOWN:
        case Button.CANCEL:
          this.setInboxFocused(false);
          this.getUi().playSelect();
          return true;
        default:
          return true;
      }
    }
    // Pressing UP from the top menu option jumps focus up to the inbox icon
    // (instead of wrapping to the bottom of the menu).
    if (button === Button.UP && this.fullCursor === 0) {
      this.setInboxFocused(true);
      this.getUi().playSelect();
      return true;
    }
    return super.processInput(button);
  }

  /**
   * Open the inbox as a small navigable window (option-select overlay). Selecting
   * an entry marks it read and shows its detail; "Mark all read" clears the
   * badge; B / Close returns to the title. Re-entrant (reading reopens the list).
   */
  private openInbox(): void {
    const list = notificationManager.list(this.notifEnabled);
    const options: OptionSelectItem[] = [];
    if (list.length === 0) {
      options.push({ label: "No notifications yet", handler: () => false, skip: true });
    }
    for (const n of list) {
      const def = notificationManager.getType(n.type);
      const summary = def ? def.summary(n) : n.type;
      options.push({
        label: `${n.read ? "  " : "* "}${this.clipInbox(summary, 32)}`,
        handler: () => {
          notificationManager.markRead(n.id);
          this.redrawInbox();
          globalScene.ui.revertMode().then(() => this.showInboxDetail(n));
          return true;
        },
        keepOpen: true,
      });
    }
    if (list.some(n => !n.read)) {
      options.push({
        label: "Mark all read",
        handler: () => {
          notificationManager.markAllRead();
          this.redrawInbox();
          globalScene.ui.revertMode().then(() => this.openInbox());
          return true;
        },
        keepOpen: true,
      });
    }
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        globalScene.ui.revertMode();
        return true;
      },
      keepOpen: true,
    });
    globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, { options, maxOptions: 8 });
  }

  /** Show one notification's detail as a read-only, navigable window (Back returns to the list). */
  private showInboxDetail(n: ErNotification): void {
    const def = notificationManager.getType(n.type);
    const detail = def?.detail?.(n);
    const summary = def ? def.summary(n) : n.type;
    const title = detail?.title ?? summary;
    const body = detail?.body ?? "";
    const text = body ? `${title}\n\n${body}` : title;
    const options: OptionSelectItem[] = text.split("\n").map(line => ({
      // Empty lines render as a blank spacer row; all body rows are non-selectable.
      label: line.length > 0 ? line : " ",
      handler: () => false,
      skip: true,
    }));
    options.push({
      label: i18next.t("menu:cancel"),
      handler: () => {
        globalScene.ui.revertMode().then(() => this.openInbox());
        return true;
      },
      keepOpen: true,
    });
    globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, { options, maxOptions: 14 });
  }

  private clipInbox(s: string, max: number): string {
    return s.length > max ? `${s.slice(0, max - 1)}…` : s;
  }

  updateTitleStats(): void {
    pokerogueApi
      .getGameTitleStats()
      .then(stats => {
        if (stats == null) {
          return;
        }
        this.playerCountLabel.setText(`${stats.playerCount} ${i18next.t("menu:playersOnline")}`);
        const splashMessage = this.splashMessage;
        if (splashMessage === "splashMessages:battlesWon") {
          this.splashMessageText.setText(i18next.t(splashMessage, { count: stats.battleCount }));
        }
      })
      .catch(err => {
        if (!isDev) {
          console.error("Failed to fetch title stats:\n", err);
        }
      });
  }

  /** Used solely to display a random Pokémon name in a splash message. */
  randomPokemon(): void {
    const rand = randInt(1025, 1);
    const pokemon = getPokemonSpecies(rand as SpeciesId);
    const splashMessage = this.splashMessage;
    if (
      this.splashMessage === "splashMessages:underratedPokemon"
      || this.splashMessage === "splashMessages:dontTalkAboutThePokemonIncident"
      || this.splashMessage === "splashMessages:aWildPokemonAppeared"
      || this.splashMessage === "splashMessages:aprilFools.removedPokemon"
    ) {
      this.splashMessageText.setText(i18next.t(splashMessage, { pokemonName: pokemon.name }));
    }
  }

  /** Used for a specific April Fools splash message. */
  genderSplash(): void {
    const splashMessage = this.splashMessage;
    if (this.splashMessage === "splashMessages:aprilFools.helloKyleAmber") {
      const splashMessageText = this.splashMessageText;
      const text = globalScene.gameData.gender === PlayerGender.MALE ? "trainerNames:playerM" : "trainerNames:playerF";
      splashMessageText.setText(i18next.t(splashMessage, { name: i18next.t(text) }));
    }
  }

  show(args: any[]): boolean {
    const ret = super.show(args);

    if (!ret) {
      return false;
    }

    const scaledHeight = globalScene.scaledCanvas.height;
    const windowHeight = this.getWindowHeight();

    this.updateUsername();
    // Register types/sources + seed welcome/demo notifications now (logged in), so
    // they land in this user's bucket, then refresh the badge.
    initErNotifications();
    this.setInboxFocused(false);
    this.refreshInbox(); // re-pull notification sources each time the title appears

    // Moving username and player count to top of the menu
    // and sorting it, to display the shorter one on top
    const UPPER_LABEL = scaledHeight - 23 - windowHeight;
    const LOWER_LABEL = scaledHeight - 13 - windowHeight;

    if (this.usernameLabel.width < this.playerCountLabel.width) {
      this.usernameLabel.setY(UPPER_LABEL);
      this.playerCountLabel.setY(LOWER_LABEL);
    } else {
      this.usernameLabel.setY(LOWER_LABEL);
      this.playerCountLabel.setY(UPPER_LABEL);
    }

    this.splashMessage = randItem(getSplashMessages());
    this.splashMessageText.setText(
      i18next.t(this.splashMessage, {
        count: TitleUiHandler.BATTLES_WON_FALLBACK,
        cycleCountNoOrdinal: 5643853 + globalScene.gameData.gameStats.classicSessionsPlayed, // for `splashMessages:itsBeenTotalRuns`
      }),
    );

    const betaText = isBeta || isDev ? " (Beta)" : "";
    // ER: surface the per-build id (baked in by build-id-plugin, the same value
    // logged as "[ER] build <id>") on the title screen so testers can verify at a
    // glance whether they're on a fresh bundle BEFORE reporting a bug - stale
    // cached builds have repeatedly produced "ghost" reports of already-fixed
    // issues. `typeof` guard mirrors init-update-checker (define may be absent).
    const buildId = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "";
    this.appVersionText.setText("v" + version + betaText + (buildId ? "  build " + buildId : ""));

    const ui = this.getUi();

    if (timedEventManager.isEventActive()) {
      this.eventDisplay.setWidth(globalScene.scaledCanvas.width - this.optionSelectBg.width - this.optionSelectBg.x);
      this.eventDisplay.show();
    }

    const now = new Date();
    if (now.getMonth() === 11 || (now.getMonth() === 0 && now.getDate() <= 15)) {
      this.getSnow();
    }

    this.randomPokemon();
    this.genderSplash();

    this.updateTitleStats();

    this.titleStatsTimer = setInterval(() => {
      this.updateTitleStats();
    }, 60000);

    globalScene.tweens.add({
      targets: [this.titleContainer, ui.getMessageHandler().bg],
      duration: fixedInt(325),
      alpha: (target: any) => (target === this.titleContainer ? 1 : 0),
      ease: "Sine.easeInOut",
    });

    return true;
  }

  clear(): void {
    super.clear();

    const ui = this.getUi();

    this.eventDisplay?.clear();

    this.titleStatsTimer && clearInterval(this.titleStatsTimer);
    this.titleStatsTimer = null;

    globalScene.tweens.add({
      targets: [this.titleContainer, ui.getMessageHandler().bg],
      duration: fixedInt(325),
      alpha: (target: any) => (target === this.titleContainer ? 0 : 1),
      ease: "Sine.easeInOut",
    });
  }

  /**
   * Get the logo file path to load, with a 0.1% chance to use the fake logo instead.
   * @returns The path to the image.
   */
  private getLogo(): string {
    // Invert spawn chances on april fools
    const aprilFools = timedEventManager.isAprilFoolsActive();
    return aprilFools === !!randInt(FAKE_TITLE_LOGO_CHANCE) ? "logo_fake" : "logo";
  }

  private snow: Phaser.GameObjects.TileSprite;

  /** Adds a snow effect on the title screen during the winter season. */
  private getSnow(): void {
    const width = globalScene.scaledCanvas.width;
    const height = globalScene.scaledCanvas.height;
    this.snow?.destroy(); // Ensures no duplicate snow layers
    this.snow = globalScene.add.tileSprite(width, height, width, height, "snow");
    this.snow.setOrigin(1, 1);

    globalScene.tweens.add({
      targets: this.snow,
      tilePositionX: { from: 0, to: -512 },
      tilePositionY: { from: 0, to: -512 },
      duration: 100000,
      repeat: -1,
      yoyo: false,
      ease: "Linear",
      onUpdate: () => {
        if (this.snow) {
          this.snow.tilePositionX -= 0.5;
          this.snow.tilePositionY -= 0.5;
        }
      },
    });
    this.titleContainer.addAt(this.snow, 0);
  }
}
