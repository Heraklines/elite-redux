import { pokerogueApi } from "#api/api";
import { loggedInUser } from "#app/account";
import { FAKE_TITLE_LOGO_CHANCE } from "#app/constants";
import { timedEventManager } from "#app/global-event-manager";
import { globalScene } from "#app/global-scene";
import { ER_VERSION, isBeta, isDev } from "#constants/app-constants";
import {
  GHOST_NOTIF_SETTING_KEY,
  initErNotifications,
  patchNotesContentOf,
} from "#data/elite-redux/er-ghost-notifications";
import {
  initTournamentNotifications,
  openTournamentDeepLink,
  tournamentDeepLinkOf,
} from "#data/elite-redux/showdown/tournament-notifications";
import { getSplashMessages } from "#data/splash-messages";
import { Button } from "#enums/buttons";
import { PlayerGender } from "#enums/player-gender";
import type { SpeciesId } from "#enums/species-id";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { type ErNotification, notificationManager } from "#system/notifications/notification-manager";
import type { OptionSelectItem } from "#ui/abstract-option-select-ui-handler";
import { TimedEventDisplay } from "#ui/event-display";
import { OptionSelectUiHandler } from "#ui/option-select-ui-handler";
import { type RichNotificationContent, RichNotificationViewer } from "#ui/rich-notification-viewer";
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
  private inboxCount: Phaser.GameObjects.Text;
  private inboxHighlight: Phaser.GameObjects.Rectangle;
  private inboxFocused = false;
  private inboxDetail: Phaser.GameObjects.Container | undefined;
  private detailOpen = false;
  private richInboxDetail: RichNotificationViewer | undefined;
  /** The notification whose detail panel is currently open (for deep-link on ACTION). */
  private detailNotif: ErNotification | undefined;

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
    // Unread dot at the top-right corner + a bright count to the left of the
    // envelope, both hidden when nothing is unread.
    this.inboxBadge = globalScene.add.ellipse(0, -h / 2, 6, 6, 0xff4444).setVisible(false);
    this.inboxCount = addTextObject(-w - 4, -1, "", TextStyle.MONEY, { fontSize: "64px" }).setOrigin(1, 0.5);
    this.inboxCount.setColor("#ffe066");
    this.inboxIcon.add([this.inboxHighlight, env, this.inboxBadge, this.inboxCount]);
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

  /** Show/hide the unread dot + count from the current unread count. */
  private redrawInbox(): void {
    const unread = notificationManager.unreadCount(this.notifEnabled);
    this.inboxBadge?.setVisible(unread > 0);
    this.inboxCount?.setText(unread > 0 ? String(unread) : "").setVisible(unread > 0);
  }

  private setInboxFocused(focused: boolean): void {
    this.inboxFocused = focused;
    this.inboxHighlight?.setVisible(focused);
  }

  override processInput(button: Button): boolean {
    if (this.richInboxDetail) {
      return this.processRichInboxInput(button);
    }
    // While a notification detail panel is up: ACTION/SUBMIT on a deep-linkable notification
    // (a tournament challenge) opens its board on the match; otherwise confirm/cancel closes
    // it back to the inbox list. All other input is swallowed.
    if (this.detailOpen) {
      if (button === Button.ACTION || button === Button.SUBMIT) {
        const link = this.detailNotif ? tournamentDeepLinkOf(this.detailNotif) : null;
        if (link != null) {
          this.getUi().playSelect();
          this.closeInboxDetail();
          if (openTournamentDeepLink(link)) {
            return true;
          }
        }
        this.closeInboxDetail();
        this.openInbox();
      } else if (button === Button.CANCEL) {
        this.closeInboxDetail();
        this.openInbox();
      }
      return true;
    }
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

  /** Mirror the DOM viewer's controls for gamepads while Phaser owns input. */
  private processRichInboxInput(button: Button): boolean {
    switch (button) {
      case Button.UP:
        this.richInboxDetail?.scrollBy(-90);
        break;
      case Button.DOWN:
        this.richInboxDetail?.scrollBy(90);
        break;
      case Button.LEFT:
        this.richInboxDetail?.scrollBy(-360);
        break;
      case Button.RIGHT:
        this.richInboxDetail?.scrollBy(360);
        break;
      case Button.ACTION:
      case Button.SUBMIT:
        this.richInboxDetail?.activateAction();
        break;
      case Button.CANCEL:
        this.richInboxDetail?.close();
        break;
    }
    return true;
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
          globalScene.ui.revertMode().then(() => {
            const richContent = patchNotesContentOf(n);
            if (richContent) {
              this.openRichInboxDetail(richContent);
            } else {
              this.openInboxDetail(n);
            }
          });
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
    if (list.length > 0) {
      options.push({
        label: "Clear all",
        handler: () => {
          notificationManager.clear();
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
    // Cap the visible rows so a tall inbox scrolls instead of overflowing.
    globalScene.ui.setOverlayMode(UiMode.OPTION_SELECT, { options, maxOptions: 6 });
  }

  /**
   * Show one notification's detail as a compact custom panel. Ghost-battle alerts
   * render the two teams as Pokemon party icons (yours vs theirs); other types
   * show wrapped text. B / confirm returns to the inbox list. The panel sits in
   * the empty left area so it never collides with the right-side title menu, and
   * lives in titleContainer (the title's reliable, visible render layer).
   */
  private openInboxDetail(n: ErNotification): void {
    this.closeInboxDetail();
    this.detailNotif = n;
    const def = notificationManager.getType(n.type);
    const detail = def?.detail?.(n);
    const summary = def ? def.summary(n) : n.type;
    const title = this.clipInbox(detail?.title ?? summary, 36);
    const isGhost = detail?.customView === "ghost-battle";
    const isReward = detail?.customView === "reward";
    const isTournament = detail?.customView === "tournament" && tournamentDeepLinkOf(n) != null;

    const w = 150;
    const h = isGhost ? 104 : isReward ? 96 : 74;
    // Centre in the open left region (the title menu occupies the right side).
    const cx = Math.round(globalScene.scaledCanvas.width * 0.33);
    const cy = Math.round(globalScene.scaledCanvas.height * 0.52);
    const panel = globalScene.add.container(cx, cy);
    const bg = globalScene.add.rectangle(0, 0, w, h, 0x16161f, 0.96).setOrigin(0.5);
    bg.setStrokeStyle(1, 0x6c8cff, 0.95);
    panel.add(bg);

    const left = -w / 2 + 8;
    let y = -h / 2 + 6;
    const titleText = addTextObject(left, y, title, TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(0, 0);
    titleText.setColor("#ffe066");
    panel.add(titleText);
    y += 13;

    if (isGhost) {
      const d = n.data as { beaten?: number; ghostTeam?: unknown; victimTeam?: unknown };
      const downed = typeof d.beaten === "number" ? d.beaten : 0;
      panel.add(
        addTextObject(left, y, `Downed ${downed} of their Pokemon.`, TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(
          0,
          0,
        ),
      );
      y += 14;
      panel.add(addTextObject(left, y, "Your ghost", TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(0, 0));
      y += 11;
      this.renderTeamIcons(d.ghostTeam, left + 4, y + 7, panel);
      y += 18;
      panel.add(addTextObject(left, y, "Their team", TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(0, 0));
      y += 11;
      this.renderTeamIcons(d.victimTeam, left + 4, y + 7, panel);
    } else if (isReward) {
      // Server-pushed reward (e.g. a black-shiny grant): ONE large mon icon
      // centred under the title, then the wrapped body text below it.
      const payload = (n.data as { payload?: unknown }).payload as
        | { species?: number; shiny?: boolean; variant?: number }
        | undefined;
      this.renderRewardIcon(payload, 0, y + 16, panel);
      y += 36;
      const body = detail?.body ?? "";
      const bodyText = addTextObject(left, y, body, TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(0, 0);
      bodyText.setWordWrapWidth((w - 16) * 6);
      panel.add(bodyText);
    } else {
      // Text-only detail (welcome / system): wrapped text inside the panel.
      const body = detail?.body ?? "";
      const bodyText = addTextObject(left, y, body, TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(0, 0);
      bodyText.setWordWrapWidth((w - 16) * 6);
      panel.add(bodyText);
    }

    const footer = isTournament ? "A: Open bracket    B: Back" : "B: Back";
    panel.add(addTextObject(0, h / 2 - 9, footer, TextStyle.WINDOW, { fontSize: "54px" }).setOrigin(0.5, 0));
    this.titleContainer.add(panel);
    this.titleContainer.bringToTop(panel);
    this.inboxDetail = panel;
    this.detailOpen = true;
  }

  private openRichInboxDetail(content: RichNotificationContent): void {
    this.closeRichInboxDetail();
    this.richInboxDetail = new RichNotificationViewer(content, () => {
      this.richInboxDetail = undefined;
      this.openInbox();
    });
  }

  /** Remove a rich viewer without reopening the inbox (used during mode cleanup). */
  private closeRichInboxDetail(): void {
    this.richInboxDetail?.destroy();
    this.richInboxDetail = undefined;
  }

  /** Render up to 6 party icons for a serialised team at (x, yCentre) into a panel. */
  private renderTeamIcons(team: unknown, x: number, yCentre: number, container: Phaser.GameObjects.Container): void {
    if (!Array.isArray(team)) {
      return;
    }
    const spacing = 18;
    team.slice(0, 6).forEach((m, i) => {
      const o = m as { speciesId?: number; formIndex?: number; gender?: number; shiny?: boolean; variant?: number };
      if (typeof o?.speciesId !== "number") {
        return;
      }
      try {
        const species = getPokemonSpecies(o.speciesId as SpeciesId);
        const female = o.gender === 1; // Gender.FEMALE
        const form = typeof o.formIndex === "number" ? o.formIndex : 0;
        const shiny = o.shiny === true;
        const variant = typeof o.variant === "number" ? o.variant : 0;
        const icon = globalScene.add.sprite(x + i * spacing, yCentre, species.getIconAtlasKey(form, shiny, variant));
        icon.setFrame(species.getIconId(female, form, shiny, variant));
        icon.setOrigin(0, 0.5).setScale(0.5);
        container.add(icon);
      } catch {
        // Unknown species id / missing icon frame - skip this slot.
      }
    });
  }

  /** Render ONE large mon icon (a server-pushed reward) centred at (xCentre, yCentre). */
  private renderRewardIcon(
    payload: { species?: number; shiny?: boolean; variant?: number } | undefined,
    xCentre: number,
    yCentre: number,
    container: Phaser.GameObjects.Container,
  ): void {
    if (typeof payload?.species !== "number") {
      return;
    }
    try {
      const sp = getPokemonSpecies(payload.species as SpeciesId);
      const shiny = payload.shiny === true;
      const variant = typeof payload.variant === "number" ? payload.variant : 0;
      const atlas = sp.getIconAtlasKey(0, shiny, variant);
      const frame = sp.getIconId(false, 0, shiny, variant);
      const icon = globalScene.add.sprite(xCentre, yCentre, atlas);
      icon.setFrame(frame);
      icon.setOrigin(0.5, 0.5).setScale(1);
      container.add(icon);
    } catch {
      // Unknown species id / missing icon frame - render nothing (body text remains).
    }
  }

  private closeInboxDetail(): void {
    this.inboxDetail?.destroy();
    this.inboxDetail = undefined;
    this.detailOpen = false;
    this.detailNotif = undefined;
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
    initTournamentNotifications();
    this.closeRichInboxDetail();
    this.closeInboxDetail();
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
    // ER: show the Elite Redux mod version (not the upstream package.json version).
    this.appVersionText.setText("v" + ER_VERSION + betaText);

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
      // Bounded background poll (title/menu-scoped, 60s): re-pull notification sources so a
      // tournament CHALLENGE (bracket advanced / opponent now present) surfaces while the
      // player idles at the title, without navigating. Never runs mid-battle (title-only).
      this.refreshInbox();
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

    this.closeRichInboxDetail();
    this.closeInboxDetail();
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
