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
// STAKED LOCK (D3b, wave 2): locking a staked offer runs the real escrow handshake. The HOST is the
// registrar (POST /showdown/match via {@linkcode registerShowdownMatch}); it re-broadcasts
// `showdownStakeLock{matchId, tier}` with the confirmed id, and both-locked crosses into battle. A
// registration failure un-locks + re-offers so the Friendly path stays available (escrow may be offline).
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
import { erRecordShowdownStakeCommit } from "#data/elite-redux/er-social-achievement-tracker";
import {
  addShowdownRejoinResender,
  type ShowdownRankedContext,
} from "#data/elite-redux/showdown/showdown-battle-state";
import { registerShowdownMatch } from "#data/elite-redux/showdown/showdown-escrow-client";
import { isMegaStage } from "#data/elite-redux/showdown/showdown-evolutions";
import type { ShowdownItemKey } from "#data/elite-redux/showdown/showdown-item-pool";
import { fetchMyShowdownRank, isRankServerConfigured } from "#data/elite-redux/showdown/showdown-rank-client";
import type { ShowdownRankState } from "#data/elite-redux/showdown/showdown-rank-types";
import { getShowdownPickWaitMs, SHOWDOWN_WAGER_COMMIT_POINT } from "#data/elite-redux/showdown/showdown-session";
import { type StakeOffer, type StakeVariant, stakesMatch, stakeTier } from "#data/elite-redux/showdown/showdown-stakes";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { buildShowdownRankCard } from "#ui/handlers/showdown-rank-card";
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
  /**
   * D3b: THIS player's full wagerable collection (owned shinies / eligible unlocks, tier-sorted),
   * built via {@linkcode buildShowdownStakePool}. When omitted (render harness), the picker derives
   * a representative pool from the built team so the screen still renders offline.
   */
  stakePool?: StakeOffer[];
  /** D3b: this player's account username (the escrow participant identity). Empty in the harness. */
  ownUsername?: string;
  /** D3b: the opponent's account username (the escrow participant identity). Empty in the harness. */
  opponentUsername?: string;
  /**
   * Called ONCE both players have committed. `matchId` is the escrow server's id for a STAKED
   * match, or null for a FRIENDLY (no-escrow) match. `ranked` is the ranked reporting context when
   * BOTH players opted into ranked (else null — casual). Proceeds to battle.
   */
  onCommit: (matchId: string | null, ranked: ShowdownRankedContext | null) => void;
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
  /** B7 item 14b: unregisters this handler's rejoin re-sender (mirrors {@linkcode offMessage}'s lifetime). */
  private offRejoin: (() => void) | null = null;

  private args: ShowdownWagerArgs | null = null;
  private choices: StakeChoice[] = [];
  /** The opponent's most recent offer, or undefined until one arrives (`null` = friendly). */
  private opponentOffer: StakeOffer | null | undefined = undefined;
  private ownLocked = false;
  private opponentLocked = false;
  /** Guards the one-shot commit so both-locked can't fire {@linkcode ShowdownWagerArgs.onCommit} twice. */
  private committed = false;
  // ---- D3b staked-escrow state -------------------------------------------------------------------
  /** The escrow server's match id once registered (host) / adopted (guest); null until then. */
  private serverMatchId: string | null = null;
  /** The opponent's locked tier (from their `showdownStakeLock`), for the both-locked cross-check. */
  private opponentLockedTier: number | null = null;
  /** Guards the async escrow registration against a double-fire. */
  private escrowBusy = false;
  /** First visible picker row (scroll window offset) — the pool can be hundreds of entries. */
  private scrollTop = 0;
  // ---- ranked ladder opt-in ----------------------------------------------------------------------
  /** Whether the ranked server is reachable/configured (the toggle is disabled + hinted when not). */
  private rankAvailable = false;
  /** THIS player's ranked opt-in (toggled with R). Ranked counts only when BOTH opt in. */
  private ownRankedOptIn = false;
  /** The opponent's ranked opt-in (synced via `showdownRankedOptIn`). */
  private opponentRankedOptIn = false;
  /** The ranked-match id: the HOST mints one on opt-in and broadcasts it; the guest adopts it. */
  private rankedMatchId: string | null = null;
  /** THIS player's current ranked state for the rank card, fetched at show (null = offline/unranked). */
  private myRank: ShowdownRankState | null = null;

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
    this.serverMatchId = null;
    this.opponentLockedTier = null;
    this.escrowBusy = false;
    this.scrollTop = 0;
    this.cursor = 0;
    this.ownRankedOptIn = false;
    this.opponentRankedOptIn = false;
    this.rankedMatchId = null;
    this.myRank = null;
    // Ranked is only offered when the server is configured; a real match also needs both usernames
    // (the render-harness preview has neither). Disabled -> the toggle shows a hint, casual is unaffected.
    this.rankAvailable = isRankServerConfigured() && !!params.ownUsername && !!params.opponentUsername;
    this.choices = this.buildChoices(params);
    // Fetch this player's rank for the card (best-effort, async). Re-render when it lands.
    if (this.rankAvailable) {
      void fetchMyShowdownRank().then(rank => {
        this.myRank = rank;
        if (this.args != null) {
          this.render();
        }
      });
    }

    // Wire: listen for the opponent's offer (tier-match display) + their commit arrival (lock lamp).
    this.offMessage?.();
    this.offMessage = params.transport?.onMessage(msg => this.handleWire(msg)) ?? null;
    // B7 item 14b: register a rejoin re-sender so a WebRTC drop on the wager screen re-ships our offer /
    // lock / commit-arrival the opponent missed while dark (the transport listener above survives the
    // rejoin; only the in-flight frames are lost). Mirrors the offMessage lifetime.
    this.offRejoin?.();
    this.offRejoin = addShowdownRejoinResender(() => this.resendState());
    // Broadcast our INITIAL offer (Friendly by default) so the opponent's screen shows it immediately.
    this.broadcastOffer();

    this.container.setVisible(true);
    this.render();
    return true;
  }

  /** How many picker rows are visible at once (the rest scroll under the window). */
  private static readonly VISIBLE_ROWS = 5;

  /**
   * Build the stake picker rows: Friendly first, then the player's FULL wagerable collection
   * (D3b — owned shinies / eligible unlocks, tier-sorted highest first via {@linkcode buildShowdownStakePool}).
   * The pool can be hundreds of entries, so the render windows it (see {@linkcode scrollTop}).
   * When no `stakePool` is provided (render harness), derives a representative pool from the built
   * team so the screen still renders offline.
   */
  private buildChoices(params: ShowdownWagerArgs): StakeChoice[] {
    const rows: StakeChoice[] = [
      { offer: null, label: i18next.t("battle:showdownWagerNoStake", { defaultValue: "Friendly (no stakes)" }) },
    ];
    const pool = params.stakePool ?? this.teamDerivedPool(params.ownTeam);
    for (const offer of pool) {
      const species = getPokemonSpecies(offer.speciesId);
      rows.push({ offer, label: `${species?.name ?? `#${offer.speciesId}`} - ${tierLabel(offer)}` });
    }
    return rows;
  }

  /** Harness/offline fallback: a representative pool derived from the built team (deduped by tier). */
  private teamDerivedPool(team: ShowdownMonManifest[]): StakeOffer[] {
    const byTier = new Map<number, StakeOffer>();
    for (const mon of team) {
      const offer = manifestToStakeOffer(mon);
      if (!byTier.has(stakeTier(offer))) {
        byTier.set(stakeTier(offer), offer);
      }
    }
    return [...byTier.values()].sort((a, b) => stakeTier(b) - stakeTier(a));
  }

  private handleWire(msg: CoopMessage): void {
    if (msg.t === "showdownStakeOffer") {
      this.opponentOffer = isFriendlyWire(msg.offer)
        ? null
        : { ...msg.offer, variant: msg.offer.variant as StakeVariant };
      // An offer (not a lock) means the peer is NOT locked in: clear their staked-lock state so a
      // host registration-failure re-offer visibly un-lights their lamp.
      this.opponentLocked = false;
      this.opponentLockedTier = null;
      this.render();
    } else if (msg.t === "showdownStakeLock") {
      // The opponent locked a STAKED offer. matchId != "" is the HOST's confirmed escrow id (adopted
      // by the guest). Light their lamp + try to cross the commit once both are locked.
      this.opponentLocked = true;
      this.opponentLockedTier = msg.tier;
      if (msg.matchId) {
        this.serverMatchId = msg.matchId;
      }
      this.render();
      this.tryStakedCommit();
    } else if (msg.t === "showdownRankedOptIn") {
      // The opponent toggled ranked. Adopt the HOST-minted ranked-match id when present.
      this.opponentRankedOptIn = msg.optIn;
      if (msg.rankedMatchId) {
        this.rankedMatchId = msg.rankedMatchId;
      }
      this.render();
    } else if (msg.t === "rendezvous" && msg.point === SHOWDOWN_WAGER_COMMIT_POINT) {
      // The opponent committed the FRIENDLY match: light their lock lamp (their rendezvous arrival).
      this.opponentLocked = true;
      this.render();
    }
  }

  /** Whether ranked is in effect for this match (BOTH players opted in AND the server is available). */
  private isRanked(): boolean {
    return this.rankAvailable && this.ownRankedOptIn && this.opponentRankedOptIn;
  }

  /** Toggle THIS player's ranked opt-in (R). The HOST mints the shared ranked-match id on opt-in. */
  private toggleRanked(): boolean {
    if (!this.rankAvailable) {
      globalScene.ui.playError();
      this.flash(i18next.t("battle:showdownRankedUnavailable", { defaultValue: "Ranked unavailable - casual only" }));
      return false;
    }
    if (this.ownLocked) {
      return false; // the opt-in is frozen once locked in
    }
    this.ownRankedOptIn = !this.ownRankedOptIn;
    // The HOST mints the shared ranked-match id the first time it opts in (the guest adopts it).
    if (this.ownRankedOptIn && this.args?.role === "host" && this.rankedMatchId == null) {
      this.rankedMatchId = `rk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
    this.broadcastRankedOptIn();
    this.render();
    return true;
  }

  /** Send THIS player's ranked opt-in (carrying the host-minted id when we are the host). */
  private broadcastRankedOptIn(): void {
    this.args?.transport?.send({
      t: "showdownRankedOptIn",
      optIn: this.ownRankedOptIn,
      rankedMatchId: this.args.role === "host" ? (this.rankedMatchId ?? "") : "",
    });
  }

  /**
   * B7 item 14b: re-ship this client's wager state after a WebRTC rejoin (the opponent missed our
   * frames while the channel was dark). Idempotent: re-broadcasts our current offer (their tier-match
   * display recovers), re-sends our stake lock if we locked a staked offer (their lock lamp re-lights),
   * and replays our wager-commit rendezvous arrival if we crossed it. All receivers dedupe.
   */
  private resendState(): void {
    this.broadcastOffer();
    this.broadcastRankedOptIn();
    const offer = this.selectedOffer();
    if (this.ownLocked && offer != null) {
      this.args?.transport?.send({ t: "showdownStakeLock", matchId: this.serverMatchId ?? "", tier: stakeTier(offer) });
    }
    this.args?.rendezvous?.resendArrivals();
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
      case Button.CYCLE_SHINY:
        success = this.toggleRanked();
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
    this.ensureCursorVisible();
    this.broadcastOffer();
    this.render();
    return true;
  }

  /** Keep the highlighted row inside the scroll window (the pool can be hundreds of entries). */
  private ensureCursorVisible(): void {
    const visible = ShowdownWagerUiHandler.VISIBLE_ROWS;
    if (this.cursor < this.scrollTop) {
      this.scrollTop = this.cursor;
    } else if (this.cursor >= this.scrollTop + visible) {
      this.scrollTop = this.cursor - visible + 1;
    }
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, Math.max(0, this.choices.length - visible)));
  }

  /** Confirm the highlighted stake: lock a staked wager (escrow) or commit friendly. */
  private confirmLock(): boolean {
    if (this.ownLocked || this.escrowBusy) {
      return false;
    }
    const offer = this.selectedOffer();
    if (offer != null) {
      return this.lockStakedOffer(offer);
    }
    // FRIENDLY commit: light our lamp + cross the reciprocal commit barrier. Proceed exactly once only
    // after BOTH have crossed; bounded recovery exhaustion leaves this boundary closed.
    this.ownLocked = true;
    this.render();
    const rv = this.args?.rendezvous;
    if (rv == null) {
      // Offline preview (render harness) / no runtime: nothing to sync against; just light the lamp.
      return true;
    }
    // Human-deliberation wait: the peer may browse stakes for minutes after we lock (maintainer:
    // the pre-battle pipeline allows >= 10 minutes; the 60s rendezvous default is a pacing class).
    void rv.rendezvous(SHOWDOWN_WAGER_COMMIT_POINT, getShowdownPickWaitMs()).then(result => {
      if (result.timedOut) {
        return;
      }
      this.opponentLocked = true;
      this.render();
      this.proceed(null);
    });
    return true;
  }

  /**
   * D3b: lock a STAKED offer. Refuses when the opponent hasn't offered a matching-tier stake yet
   * (keeps the pick unlocked so the player can adjust or fall back to Friendly). Otherwise lights the
   * lamp, broadcasts `showdownStakeLock`, and tries to cross the commit once both are locked.
   */
  private lockStakedOffer(offer: StakeOffer): boolean {
    if (this.opponentOffer == null || !stakesMatch(offer, this.opponentOffer)) {
      globalScene.ui.playError();
      this.flash(
        i18next.t("battle:showdownWagerNeedMatch", {
          defaultValue: "Stakes must match tier to lock - or pick Friendly",
        }),
      );
      return false;
    }
    this.ownLocked = true;
    this.render();
    // Broadcast our lock (carrying the confirmed escrow id once WE are the registrar and have it).
    this.args?.transport?.send({
      t: "showdownStakeLock",
      matchId: this.serverMatchId ?? "",
      tier: stakeTier(offer),
    });
    this.tryStakedCommit();
    return true;
  }

  /**
   * D3b: when BOTH players have locked matching stakes, cross into battle. The HOST is the escrow
   * registrar: it POSTs /showdown/match, then re-broadcasts `showdownStakeLock` carrying the confirmed
   * matchId and proceeds. The GUEST waits for that confirmed id, then proceeds. A registration failure
   * un-locks the host and re-offers (the friendly path stays available). No-op until both are locked.
   */
  private tryStakedCommit(): void {
    if (!this.ownLocked || !this.opponentLocked || this.committed) {
      return;
    }
    const offer = this.selectedOffer();
    const opp = this.opponentOffer;
    if (offer == null || opp == null || !stakesMatch(offer, opp)) {
      return; // tiers drifted apart — wait for a fresh matching lock
    }
    if (this.args?.role === "guest") {
      // The guest never registers; it proceeds once the host's confirmed id has arrived.
      if (this.serverMatchId != null) {
        this.proceed(this.serverMatchId);
      }
      return;
    }
    // HOST: register the escrow hold exactly once.
    if (this.serverMatchId != null) {
      this.proceed(this.serverMatchId);
      return;
    }
    if (this.escrowBusy) {
      return;
    }
    void this.registerAsHost(offer, opp);
  }

  /** HOST-side escrow registration (async). On success, confirm the lock to the guest and proceed. */
  private async registerAsHost(hostStake: StakeOffer, guestStake: StakeOffer): Promise<void> {
    const args = this.args;
    if (args == null) {
      return;
    }
    this.escrowBusy = true;
    const matchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const result = await registerShowdownMatch({
      matchId,
      hostUid: args.ownUsername ?? "",
      guestUid: args.opponentUsername ?? "",
      hostStake,
      guestStake,
    });
    this.escrowBusy = false;
    if (!result.ok) {
      // Escrow unreachable / rejected: fall back cleanly. Un-lock + re-offer so the guest's lamp
      // clears, and tell the player. Friendly remains available.
      this.ownLocked = false;
      globalScene.ui.playError();
      this.flash(
        i18next.t("battle:showdownWagerEscrowFailed", {
          defaultValue: "Escrow unavailable - Friendly only",
        }),
      );
      this.broadcastOffer();
      this.render();
      return;
    }
    this.serverMatchId = result.matchId;
    // Re-broadcast the lock WITH the confirmed id so the guest adopts it and proceeds.
    args.transport?.send({ t: "showdownStakeLock", matchId: result.matchId, tier: stakeTier(hostStake) });
    this.proceed(result.matchId);
  }

  private proceed(matchId: string | null): void {
    if (this.committed) {
      return;
    }
    this.committed = true;
    // #900: stash this match's stake so the terminal result phase can award High Roller /
    // All In (win/loss isn't known yet). A real escrow match id means it is staked; a shiny
    // offer means the stake is a shiny. Pure local observer - records nothing over the wire.
    const offer = this.selectedOffer();
    erRecordShowdownStakeCommit(matchId != null, !!offer?.shiny);
    this.args?.onCommit(matchId, this.buildRankedContext(matchId));
  }

  /**
   * Build the ranked reporting context when BOTH players opted in, else null (casual). The reported
   * id prefers the escrow match id (staked matches share it already), falling back to the host-minted
   * ranked id (friendly-ranked). host/guest usernames are mapped from THIS client's role so both
   * clients agree on the same identity. Null when either side declined or the id never synced.
   */
  private buildRankedContext(matchId: string | null): ShowdownRankedContext | null {
    if (!this.isRanked()) {
      return null;
    }
    const args = this.args;
    if (args == null) {
      return null;
    }
    const rankedMatchId = matchId ?? this.rankedMatchId;
    if (!rankedMatchId || !args.ownUsername || !args.opponentUsername) {
      return null; // no shared id / missing identity — fall back to casual (never blocks the match)
    }
    const hostUid = args.role === "host" ? args.ownUsername : args.opponentUsername;
    const guestUid = args.role === "host" ? args.opponentUsername : args.ownUsername;
    return { rankedMatchId, hostUid, guestUid };
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

    // Ranked rank card (top-right, narrow to clear the team-icon strip).
    if (this.rankAvailable) {
      const card = buildShowdownRankCard(this.myRank, 210, 15, 106);
      this.add(card);
    }

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
    // B7 item 14c: the wager is the MATCHUP preview, so show the FIELDED form - the manifest's own
    // species + formIndex (evolved OR mega icon). The base-form rule is teambuilder-only (item 12);
    // here the "M" badge still marks a mega for a quick read on top of the mega icon.
    const iconSpeciesId = mon.speciesId;
    const iconFormIndex = mon.formIndex;
    const species = getPokemonSpecies(iconSpeciesId);
    if (species != null) {
      // Integer 0.5 scale (matches the party/starter team-icon strip) avoids atlas-frame bleed. The
      // atlas key is set on the sprite ctor UNCONDITIONALLY (so the boot-loaded sheet is used, and the
      // render harness's texture injector records + resolves it) - do NOT gate on textures.exists(),
      // which would leave the key unrequested and blank every icon.
      const wantId = species.getIconId(false, iconFormIndex, mon.shiny, mon.variant);
      const icon = globalScene.add
        .sprite(x, y, species.getIconAtlasKey(iconFormIndex, mon.shiny, mon.variant))
        .setOrigin(0.5, 0)
        .setScale(0.5);
      icon.setFrame(wantId);
      // B7 item 14c: a missing frame/atlas leaves setFrame on the wrong frame. Fall back to the fielded
      // species' NON-SHINY base frame (variant-missing guard, mirrors BattleScene.addPokemonIcon), then -
      // if the whole fielded sheet is absent (an ER-custom form icon that never loaded) - to the ROOT
      // line's base icon (a boot-loaded starter sheet) so a slot is never a broken box.
      if (icon.frame.name !== wantId) {
        const baseId = species.getIconId(false, iconFormIndex, false, 0);
        if (icon.texture.has(baseId)) {
          icon.setFrame(baseId);
        } else {
          const rootSpecies = getPokemonSpecies(mon.rootSpeciesId);
          const rootFrame = rootSpecies?.getIconId(false, 0, false, 0);
          if (rootSpecies != null && rootFrame != null) {
            icon.setTexture(rootSpecies.getIconAtlasKey(0, false, 0));
          }
          // Last resort (even the root sheet absent): the neutral placeholder, never a broken box.
          if (rootFrame != null && icon.texture.has(rootFrame)) {
            icon.setFrame(rootFrame);
          } else {
            icon.setTexture("pokemon_icons_0").setFrame("unknown");
          }
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
    // Window the picker: only VISIBLE_ROWS rows show at once (the pool can be hundreds of entries).
    const visible = ShowdownWagerUiHandler.VISIBLE_ROWS;
    const end = Math.min(this.scrollTop + visible, this.choices.length);
    for (let i = this.scrollTop; i < end; i++) {
      const choice = this.choices[i];
      const rowText = addTextObject(
        pickerX + 8,
        ShowdownWagerUiHandler.PICKER_ROW_Y + (i - this.scrollTop) * rowH,
        choice.label,
        this.ownLocked && i !== this.cursor ? TextStyle.SHADOW_TEXT : TextStyle.WINDOW,
      );
      this.add(rowText);
    }
    // Scroll affordance: "+N more" below when the pool overflows the window.
    if (this.choices.length > end) {
      this.add(
        addTextObject(
          pickerX + 8,
          ShowdownWagerUiHandler.PICKER_ROW_Y + visible * rowH,
          i18next.t("battle:showdownWagerMore", {
            count: this.choices.length - end,
            defaultValue: `▼ +${this.choices.length - end} more`,
          }),
          TextStyle.SHADOW_TEXT,
        ),
      );
    }

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

    // Ranked opt-in status (both must opt in for the match to count; R toggles).
    ry += 13;
    this.add(addTextObject(rightX, ry, this.rankedStatusText(), this.rankedStatusStyle()));

    // Instructions on the backdrop strip BELOW the panel window (clear of both columns).
    const help = addTextObject(
      160,
      panelY + panelH + 2,
      i18next.t("battle:showdownWagerHelp", {
        defaultValue: "UP / DOWN: choose stake   ACTION: lock in   R: ranked",
      }),
      TextStyle.INSTRUCTIONS_TEXT,
    );
    help.setOrigin(0.5, 0);
    this.add(help);
  }

  /** One-line ranked status: unavailable / off / you-only / both-in (counts). */
  private rankedStatusText(): string {
    if (!this.rankAvailable) {
      return i18next.t("battle:showdownRankedOff", { defaultValue: "Ranked: unavailable" });
    }
    if (this.isRanked()) {
      return i18next.t("battle:showdownRankedBoth", { defaultValue: "Ranked: ON (both)" });
    }
    if (this.ownRankedOptIn) {
      return i18next.t("battle:showdownRankedYouOnly", { defaultValue: "Ranked: you (awaiting them)" });
    }
    if (this.opponentRankedOptIn) {
      return i18next.t("battle:showdownRankedThemOnly", { defaultValue: "Ranked: them (press R)" });
    }
    return i18next.t("battle:showdownRankedNone", { defaultValue: "Ranked: off" });
  }

  private rankedStatusStyle(): TextStyle {
    if (!this.rankAvailable) {
      return TextStyle.SHADOW_TEXT;
    }
    return this.isRanked() ? TextStyle.SUMMARY_GREEN : TextStyle.SUMMARY_GRAY;
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
      ShowdownWagerUiHandler.PICKER_ROW_Y + (this.cursor - this.scrollTop) * ShowdownWagerUiHandler.PICKER_ROW_H + 3,
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
    // B7 item 14b: drop the rejoin re-sender so a later (in-battle) rejoin doesn't re-broadcast a stale offer.
    this.offRejoin?.();
    this.offRejoin = null;
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
