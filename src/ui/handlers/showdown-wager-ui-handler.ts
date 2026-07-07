/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 PvP (D3): the pre-battle WAGER screen. A SINGLE screen shown to BOTH
// players AFTER the team exchange (C2 negotiate) and BEFORE the battle boots. The ante is
// bet with full knowledge of the matchup, so this screen shows:
//
//   - BOTH teams previewed (your 6 + the opponent's 6) as species icons with a held-item
//     mini-icon and a mega badge; the opponent's display name + title (from their C7 ghost
//     profile) head their row.
//   - A STAKE picker: "Friendly (no stakes)" always offered, plus one stake option per team
//     mon (its tier per showdown-stakes rules). The chosen offer is synced over the wire
//     (`showdownStakeOffer`) so each side sees the opponent's offer + a tier-MATCH indicator.
//   - Two LOCK lamps (yours + theirs). Locking the FRIENDLY option crosses the reciprocal
//     `showdown-wager-commit` rendezvous; once BOTH have crossed, the screen proceeds to battle.
//
// WAVE-1 ESCROW GATE (D3): locking an ACTUAL stake is DISABLED behind the escrow (wave 2). The
// stake UI works fully through offer + tier-match, but the lock button for a staked offer
// surfaces "Escrow not yet available - Friendly only". D1 plugs the POST /showdown/match escrow
// call in at the ONE clearly-marked seam (`commitStakedMatch`).
//
// LOCAL-ONLY (coop-ui-registry): each player drives its OWN copy; only offers + the commit
// rendezvous sync (mirroring the SHOWDOWN_COMMAND precedent). The transport + rendezvous are
// injected via {@linkcode ShowdownWagerArgs}; both are null in the render harness (offline
// preview), where the screen still renders and the local lock lamp still lights.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { modifierTypes } from "#data/data-lists";
import type { CoopRendezvous } from "#data/elite-redux/coop/coop-rendezvous";
import type {
  CoopMessage,
  CoopRole,
  CoopTransport,
  ShowdownStakeOfferWire,
} from "#data/elite-redux/coop/coop-transport";
import type { GhostTrainerProfile } from "#data/elite-redux/er-ghost-profile";
import { isMegaStage } from "#data/elite-redux/showdown/showdown-evolutions";
import type { ShowdownItemKey } from "#data/elite-redux/showdown/showdown-item-pool";
import { SHOWDOWN_WAGER_COMMIT_POINT } from "#data/elite-redux/showdown/showdown-session";
import { type StakeOffer, type StakeVariant, stakesMatch, stakeTier } from "#data/elite-redux/showdown/showdown-stakes";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";
import { getModifierType } from "#utils/modifier-utils";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import i18next from "i18next";

/** Args passed to {@linkcode ShowdownWagerUiHandler.show}. */
export interface ShowdownWagerArgs {
  /** THIS client's own team (previewed on the top row). */
  ownTeam: ShowdownMonManifest[];
  /** The opponent's validated team (previewed on the bottom row). */
  opponentTeam: ShowdownMonManifest[];
  /** The opponent's authored ghost-trainer presentation (name/title), or null. */
  opponentProfile: GhostTrainerProfile | null;
  /** This client's role (lamp labels + the eventual stake-lock tier cross-check). */
  role: CoopRole;
  /** Live transport for offer/lock sync; null in the render harness (offline preview). */
  transport: CoopTransport | null;
  /** The shared reciprocal rendezvous for the commit barrier; null in the render harness. */
  rendezvous: CoopRendezvous | null;
  /** Called ONCE both players have committed the friendly match. Proceeds to battle. */
  onCommit: () => void;
}

/** A row in the stake picker: an offer plus its display label. `offer === null` is Friendly. */
interface StakeChoice {
  offer: StakeOffer | null;
  label: string;
}

/** The wire sentinel for a "friendly / no stake" offer (a real mon never has cost 0). */
const FRIENDLY_WIRE: ShowdownStakeOfferWire = {
  speciesId: 0,
  shiny: false,
  variant: 0,
  erBlackShiny: false,
  cost: 0,
};

/** Whether a received wire offer is the friendly sentinel (no stake). */
function isFriendlyWire(o: ShowdownStakeOfferWire): boolean {
  return o.speciesId === 0 && o.cost === 0 && !o.shiny && !o.erBlackShiny;
}

/** Turn a team mon into the stake offer it represents (root line + shiny/variant/cost). */
function manifestToStakeOffer(m: ShowdownMonManifest): StakeOffer {
  return {
    speciesId: m.rootSpeciesId,
    shiny: m.shiny,
    variant: (m.variant as StakeVariant) ?? 0,
    erBlackShiny: m.erBlackShiny,
    cost: m.baseCost,
  };
}

/** A short, human tier label for an offer (or "Friendly" for null). */
function tierLabel(offer: StakeOffer | null): string {
  if (offer == null) {
    return i18next.t("battle:showdownWagerFriendly", { defaultValue: "Friendly" });
  }
  if (offer.erBlackShiny) {
    return i18next.t("battle:showdownWagerBlackShiny", { defaultValue: "Black Shiny" });
  }
  if (offer.shiny) {
    return i18next.t("battle:showdownWagerShiny", {
      variant: offer.variant + 1,
      defaultValue: `Shiny T${offer.variant + 1}`,
    });
  }
  return i18next.t("battle:showdownWagerCost", { cost: offer.cost, defaultValue: `Cost ${offer.cost}` });
}

export class ShowdownWagerUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  /** Transient children (icons, texts, lamps) torn down + rebuilt on every render. */
  private dynamic: Phaser.GameObjects.GameObject[] = [];
  private cursorObj: Phaser.GameObjects.Image | null = null;
  private offMessage: (() => void) | null = null;

  private args: ShowdownWagerArgs | null = null;
  private choices: StakeChoice[] = [];
  /** The opponent's most recent offer, or undefined until one arrives (`null` = friendly). */
  private opponentOffer: StakeOffer | null | undefined = undefined;
  private ownLocked = false;
  private opponentLocked = false;
  /** Guards the one-shot commit so both-locked can't fire {@linkcode ShowdownWagerArgs.onCommit} twice. */
  private committed = false;

  constructor() {
    super(UiMode.SHOWDOWN_WAGER);
  }

  setup(): void {
    const ui = this.getUi();
    // Full-screen handlers root their container at (0, -scaledCanvas.height) so child coordinates in
    // the 0..180 logical band map to the visible screen (mirrors ErBargain / CommunityChallenges).
    this.container = globalScene.add.container(0, -globalScene.scaledCanvas.height).setName("showdown-wager");
    this.container.setVisible(false);
    ui.add(this.container);
  }

  override show(args: any[]): boolean {
    super.show(args);
    const params = (args?.[0] ?? null) as ShowdownWagerArgs | null;
    if (params == null) {
      return false;
    }
    this.args = params;
    this.opponentOffer = undefined;
    this.ownLocked = false;
    this.opponentLocked = false;
    this.committed = false;
    this.cursor = 0;
    this.choices = this.buildChoices(params.ownTeam);

    // Wire: listen for the opponent's offer (tier-match display) + their commit arrival (lock lamp).
    this.offMessage?.();
    this.offMessage = params.transport?.onMessage(msg => this.handleWire(msg)) ?? null;
    // Broadcast our INITIAL offer (Friendly by default) so the opponent's screen shows it immediately.
    this.broadcastOffer();

    this.container.setVisible(true);
    this.render();
    return true;
  }

  /** How many staked options to list beneath Friendly (kept short so the picker never overflows). */
  private static readonly MAX_STAKE_OPTIONS = 4;

  /** Build the stake picker rows: Friendly first, then the team's highest DISTINCT-tier stakes. */
  private buildChoices(team: ShowdownMonManifest[]): StakeChoice[] {
    const rows: StakeChoice[] = [
      { offer: null, label: i18next.t("battle:showdownWagerNoStake", { defaultValue: "Friendly (no stakes)" }) },
    ];
    // Wave-2 seam: the stake pool should widen to the player's FULL owned-shinies / eligible-unlocks
    // collection (design). This wave derives representative offers from the built team (deduped by tier,
    // highest first) so the tier + tier-match wire path is fully exercised while real staking is gated.
    const byTier = new Map<number, StakeOffer>();
    for (const mon of team) {
      const offer = manifestToStakeOffer(mon);
      if (!byTier.has(stakeTier(offer))) {
        byTier.set(stakeTier(offer), offer);
      }
    }
    const top = [...byTier.values()]
      .sort((a, b) => stakeTier(b) - stakeTier(a))
      .slice(0, ShowdownWagerUiHandler.MAX_STAKE_OPTIONS);
    for (const offer of top) {
      const species = getPokemonSpecies(offer.speciesId);
      rows.push({ offer, label: `${species?.name ?? `#${offer.speciesId}`} - ${tierLabel(offer)}` });
    }
    return rows;
  }

  private handleWire(msg: CoopMessage): void {
    if (msg.t === "showdownStakeOffer") {
      this.opponentOffer = isFriendlyWire(msg.offer)
        ? null
        : { ...msg.offer, variant: msg.offer.variant as StakeVariant };
      this.render();
    } else if (msg.t === "rendezvous" && msg.point === SHOWDOWN_WAGER_COMMIT_POINT) {
      // The opponent committed the friendly match: light their lock lamp (their rendezvous arrival).
      this.opponentLocked = true;
      this.render();
    }
  }

  /** Send THIS client's currently-selected offer over the wire (Friendly sentinel when null). */
  private broadcastOffer(): void {
    const offer = this.selectedOffer();
    const wire: ShowdownStakeOfferWire =
      offer == null
        ? { ...FRIENDLY_WIRE }
        : {
            speciesId: offer.speciesId,
            shiny: offer.shiny,
            variant: offer.variant,
            erBlackShiny: offer.erBlackShiny,
            cost: offer.cost,
          };
    this.args?.transport?.send({ t: "showdownStakeOffer", offer: wire });
  }

  private selectedOffer(): StakeOffer | null {
    return this.choices[this.cursor]?.offer ?? null;
  }

  processInput(button: Button): boolean {
    let success = false;
    switch (button) {
      case Button.UP:
        success = this.moveCursor(-1);
        break;
      case Button.DOWN:
        success = this.moveCursor(1);
        break;
      case Button.ACTION:
        success = this.confirmLock();
        break;
    }
    if (success) {
      this.getUi().playSelect();
    }
    return success;
  }

  private moveCursor(dir: number): boolean {
    if (this.ownLocked) {
      return false; // locked in - the pick is frozen until both proceed
    }
    const n = this.choices.length;
    if (n === 0) {
      return false;
    }
    this.cursor = (this.cursor + dir + n) % n;
    this.broadcastOffer();
    this.render();
    return true;
  }

  /** Confirm the highlighted stake: commit friendly, or refuse a staked lock (escrow gated). */
  private confirmLock(): boolean {
    if (this.ownLocked) {
      return false;
    }
    const offer = this.selectedOffer();
    if (offer != null) {
      // ---- WAVE-2 ESCROW SEAM (D1) ----------------------------------------------------------------
      // A real staked match locks HERE: POST /showdown/match to register the escrow hold, then on the
      // server's matchId send `showdownStakeLock{matchId, tier}` and gate the commit on both locks +
      // the server's confirmation. Until D1 wires the escrow endpoint, staked play is disabled and only
      // the friendly path proceeds. Do NOT proceed to battle on a staked lock in this wave.
      // ---------------------------------------------------------------------------------------------
      this.commitStakedMatch(offer);
      return true;
    }
    // FRIENDLY commit: light our lamp + cross the reciprocal commit barrier. When BOTH have crossed
    // (or the anti-hang timeout fires), proceed to battle exactly once.
    this.ownLocked = true;
    this.render();
    const rv = this.args?.rendezvous;
    if (rv == null) {
      // Offline preview (render harness) / no runtime: nothing to sync against; just light the lamp.
      return true;
    }
    void rv.rendezvous(SHOWDOWN_WAGER_COMMIT_POINT).then(() => {
      this.opponentLocked = true;
      this.render();
      this.proceed();
    });
    return true;
  }

  /**
   * WAVE-1 escrow gate: a staked lock is not yet available (escrow is D1/wave-2). Surface the honest
   * message and leave the pick unlocked so the player can fall back to Friendly. This is the ONE seam
   * D1 replaces with the POST /showdown/match escrow registration.
   */
  private commitStakedMatch(_offer: StakeOffer): void {
    globalScene.ui.playError();
    // A brief, self-clearing notice under the panel; the screen stays open on Friendly-only.
    this.flash(
      i18next.t("battle:showdownWagerEscrowUnavailable", {
        defaultValue: "Escrow not yet available - Friendly only",
      }),
    );
  }

  private proceed(): void {
    if (this.committed) {
      return;
    }
    this.committed = true;
    this.args?.onCommit();
  }

  // ---- rendering ---------------------------------------------------------------------------------

  private clearDynamic(): void {
    for (const o of this.dynamic) {
      o.destroy();
    }
    this.dynamic = [];
  }

  private add<T extends Phaser.GameObjects.GameObject>(obj: T): T {
    this.container.add(obj);
    this.dynamic.push(obj);
    return obj;
  }

  private render(): void {
    if (this.args == null) {
      return;
    }
    this.clearDynamic();

    // Dim full-screen backdrop so the two team rows + stake panel read as one composed screen.
    const backdrop = globalScene.add.rectangle(0, 0, 320, 180, 0x040814, 0.9).setOrigin(0, 0);
    this.add(backdrop);

    // Title bar.
    this.add(addWindow(0, 0, 320, 14));
    const title = addTextObject(
      160,
      2,
      i18next.t("battle:showdownWagerTitle", { defaultValue: "SHOWDOWN - WAGER" }),
      TextStyle.SUMMARY_GOLD,
    );
    title.setOrigin(0.5, 0);
    this.add(title);

    // Team rows.
    this.renderTeamRow(
      i18next.t("battle:showdownWagerYourTeam", { defaultValue: "YOUR TEAM" }),
      this.args.ownTeam,
      16,
      TextStyle.SUMMARY_GREEN,
    );
    this.renderTeamRow(this.opponentHeader(), this.args.opponentTeam, 49, TextStyle.SUMMARY_RED);

    // Stake panel + instructions.
    this.renderStakePanel();

    this.renderCursor();
  }

  private opponentHeader(): string {
    const p = this.args?.opponentProfile;
    const name = p?.displayName?.trim() || i18next.t("battle:showdownWagerOpponent", { defaultValue: "Opponent" });
    const title = p?.title?.trim();
    return title ? `${name} - ${title}` : name;
  }

  /** Draw a "label + six mon icons" row starting at pixel `y`. */
  private renderTeamRow(label: string, team: ShowdownMonManifest[], y: number, labelStyle: TextStyle): void {
    const labelText = addTextObject(10, y, label, labelStyle);
    labelText.setOrigin(0, 0);
    this.add(labelText);

    const startX = 30;
    const stepX = 33;
    const iconY = y + 10;
    for (let i = 0; i < 6; i++) {
      const mon = team[i];
      const x = startX + i * stepX;
      if (mon == null) {
        continue;
      }
      this.renderMonIcon(mon, x, iconY);
    }
  }

  /** A single mon: species icon (shiny/variant frame) + held-item mini-icon + mega badge. */
  private renderMonIcon(mon: ShowdownMonManifest, x: number, y: number): void {
    const mega = isMegaStage(mon.speciesId, mon.formIndex);
    // Mega/primal forms use ER-custom icon frames that don't render reliably in a compact strip; show
    // the ROOT line's base icon and let the "M" badge convey the mega. Non-megas use their own icon.
    const iconSpeciesId = mega ? mon.rootSpeciesId : mon.speciesId;
    const iconFormIndex = mega ? 0 : mon.formIndex;
    const species = getPokemonSpecies(iconSpeciesId);
    if (species != null) {
      // Integer 0.5 scale (matches the party/starter team-icon strip) avoids atlas-frame bleed.
      const wantId = species.getIconId(false, iconFormIndex, mon.shiny, mon.variant);
      const icon = globalScene.add
        .sprite(x, y, species.getIconAtlasKey(iconFormIndex, mon.shiny, mon.variant))
        .setOrigin(0.5, 0)
        .setScale(0.5);
      icon.setFrame(wantId);
      // A missing variant icon leaves setFrame on the wrong frame; fall back to the base frame
      // (mirrors BattleScene.addPokemonIcon's variant-missing guard).
      if (icon.frame.name !== wantId) {
        const baseId = species.getIconId(false, iconFormIndex, false, 0);
        if (icon.texture.has(baseId)) {
          icon.setFrame(baseId);
        }
      }
      this.add(icon);
    }

    // Held-item mini-icon (bottom-right of the icon). The mega slot carries no item modifier.
    if (mon.item !== "MEGA_STONE") {
      const modType = modifierTypes[mon.item as ShowdownItemKey];
      const iconImage = modType == null ? undefined : getModifierType(modType).iconImage;
      if (iconImage) {
        const itemIcon = globalScene.add
          .sprite(x + 8, y + 13, "items", iconImage)
          .setOrigin(0.5, 0.5)
          .setScale(0.32);
        this.add(itemIcon);
      }
    }

    // Mega badge (a small gold "M" at the icon's top-left) when fielded in a mega/primal form. No
    // setScale on the text object - it misrenders hugely in the 2D render harness; the base font size
    // is already the compact team-strip size.
    if (mega) {
      const badge = addTextObject(x - 11, y - 4, "M", TextStyle.SUMMARY_GOLD);
      badge.setOrigin(0.5, 0);
      this.add(badge);
    }
  }

  /** Y of the stake panel + its picker rows (shared with the cursor placement). */
  private static readonly PANEL_Y = 82;
  private static readonly PICKER_ROW_Y = ShowdownWagerUiHandler.PANEL_Y + 16;
  private static readonly PICKER_ROW_H = 12;

  /** The stake panel: your picker (left) + the offer/tier-match/lock-lamp summary (right). */
  private renderStakePanel(): void {
    const panelY = ShowdownWagerUiHandler.PANEL_Y;
    const panelH = 82;
    this.add(addWindow(0, panelY, 320, panelH));

    // Left column: the stake picker rows.
    const pickerX = 10;
    const rowH = ShowdownWagerUiHandler.PICKER_ROW_H;
    this.add(
      addTextObject(
        pickerX,
        panelY + 3,
        i18next.t("battle:showdownWagerYourStake", { defaultValue: "YOUR STAKE" }),
        TextStyle.SUMMARY_HEADER,
      ),
    );
    this.choices.forEach((choice, i) => {
      const rowText = addTextObject(
        pickerX + 8,
        ShowdownWagerUiHandler.PICKER_ROW_Y + i * rowH,
        choice.label,
        this.ownLocked && i !== this.cursor ? TextStyle.SHADOW_TEXT : TextStyle.WINDOW,
      );
      this.add(rowText);
    });

    // Right column: offers + tier-match + lock lamps.
    const rightX = 176;
    let ry = panelY + 3;
    this.add(
      addTextObject(
        rightX,
        ry,
        i18next.t("battle:showdownWagerStakes", { defaultValue: "STAKES" }),
        TextStyle.SUMMARY_HEADER,
      ),
    );
    ry += 13;
    const ownOffer = this.selectedOffer();
    this.add(
      addTextObject(
        rightX,
        ry,
        `${i18next.t("battle:showdownWagerYouOffer", { defaultValue: "You" })}: ${tierLabel(ownOffer)}`,
        TextStyle.WINDOW,
      ),
    );
    ry += 11;
    const theirLabel =
      this.opponentOffer === undefined
        ? i18next.t("battle:showdownWagerWaiting", { defaultValue: "..." })
        : tierLabel(this.opponentOffer);
    this.add(
      addTextObject(
        rightX,
        ry,
        `${i18next.t("battle:showdownWagerThemOffer", { defaultValue: "Them" })}: ${theirLabel}`,
        TextStyle.WINDOW,
      ),
    );
    ry += 13;

    // Tier-match indicator.
    this.add(addTextObject(rightX, ry, this.tierMatchText(ownOffer), this.tierMatchStyle(ownOffer)));
    ry += 14;

    // Lock lamps.
    this.add(
      addTextObject(
        rightX,
        ry,
        this.lampText(i18next.t("battle:showdownWagerYouLamp", { defaultValue: "You" }), this.ownLocked),
        this.ownLocked ? TextStyle.SUMMARY_GREEN : TextStyle.SUMMARY_GRAY,
      ),
    );
    ry += 11;
    this.add(
      addTextObject(
        rightX,
        ry,
        this.lampText(i18next.t("battle:showdownWagerThemLamp", { defaultValue: "Them" }), this.opponentLocked),
        this.opponentLocked ? TextStyle.SUMMARY_GREEN : TextStyle.SUMMARY_GRAY,
      ),
    );

    // Instructions on the backdrop strip BELOW the panel window (clear of both columns).
    const help = addTextObject(
      160,
      panelY + panelH + 2,
      i18next.t("battle:showdownWagerHelp", { defaultValue: "UP / DOWN: choose stake      ACTION: lock in" }),
      TextStyle.INSTRUCTIONS_TEXT,
    );
    help.setOrigin(0.5, 0);
    this.add(help);
  }

  private lampText(who: string, on: boolean): string {
    const dot = on
      ? i18next.t("battle:showdownWagerLampReady", { defaultValue: "READY" })
      : i18next.t("battle:showdownWagerLampWaiting", { defaultValue: "waiting" });
    return `${who}: ${dot}`;
  }

  private tierMatchText(own: StakeOffer | null): string {
    if (this.opponentOffer === undefined) {
      return i18next.t("battle:showdownWagerNoOffer", { defaultValue: "Awaiting their offer" });
    }
    if (own == null || this.opponentOffer == null) {
      return i18next.t("battle:showdownWagerFriendlyMatch", { defaultValue: "Friendly match" });
    }
    if (stakesMatch(own, this.opponentOffer)) {
      return i18next.t("battle:showdownWagerMatched", { defaultValue: "Stakes matched!" });
    }
    const cmp =
      stakeTier(own) > stakeTier(this.opponentOffer)
        ? i18next.t("battle:showdownWagerYouOver", { defaultValue: "Your stake is higher" })
        : i18next.t("battle:showdownWagerThemOver", { defaultValue: "Their stake is higher" });
    return `${i18next.t("battle:showdownWagerMismatch", { defaultValue: "Mismatch" })}: ${cmp}`;
  }

  private tierMatchStyle(own: StakeOffer | null): TextStyle {
    if (this.opponentOffer === undefined || own == null || this.opponentOffer == null) {
      return TextStyle.SUMMARY_GRAY;
    }
    return stakesMatch(own, this.opponentOffer) ? TextStyle.SUMMARY_GREEN : TextStyle.SUMMARY_RED;
  }

  private renderCursor(): void {
    if (!this.cursorObj) {
      this.cursorObj = globalScene.add.image(0, 0, "cursor");
      this.container.add(this.cursorObj);
    }
    this.cursorObj.setPosition(
      10,
      ShowdownWagerUiHandler.PICKER_ROW_Y + this.cursor * ShowdownWagerUiHandler.PICKER_ROW_H + 3,
    );
    this.cursorObj.setVisible(this.choices.length > 0 && !this.ownLocked);
  }

  /** A transient, self-clearing notice line (escrow-unavailable). */
  private flash(text: string): void {
    const notice = addTextObject(178, ShowdownWagerUiHandler.PANEL_Y + 60, text, TextStyle.SUMMARY_RED);
    this.container.add(notice);
    globalScene.time?.delayedCall?.(1600, () => notice.destroy());
  }

  clear(): void {
    super.clear();
    this.offMessage?.();
    this.offMessage = null;
    this.clearDynamic();
    if (this.cursorObj) {
      this.cursorObj.destroy();
      this.cursorObj = null;
    }
    this.container.setVisible(false);
    this.args = null;
    this.committed = false;
  }
}
