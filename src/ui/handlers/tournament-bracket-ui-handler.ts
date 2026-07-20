/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENTS — THE BOARD (Showdown Tournament P1.5). The showpiece: a
// Pokemon World Tournament bracket board over the worker's authoritative bracket.
//   - real CONNECTING LINES (semis -> final -> champion slot), drawn in the game's
//     chrome language (thin gold/navy rects), scaling 4/8/16 cleanly.
//   - each slot carries the entrant's GHOST-TRAINER ICON (their authored ghost
//     identity: sprite key + name + seed chip), with a neutral fallback avatar for
//     old registrations that carry no summary.
//   - YOUR next fight is gold-highlighted with a VS marker; the d-pad browses every
//     match (each surfaces its pairing card); A on YOUR playable match enters the
//     constrained tournament lobby; B returns to the list.
//   - the bottom card is the OPPONENT card for your fight (ghost portrait + custom
//     title + deadline countdown + presence line) or the browsed match's pairing.
//   - RESOLUTION visuals: the winner's icon advances along the line into the next
//     slot (server-fed), the loser's slot dims with an X; an eliminated player keeps
//     a read-only spectator view; the CHAMPION state renders the winner's trainer
//     art center-stage with "CHAMPION - <name>".
//   - the board POLLS the worker (live refresh) and pings presence while open.
// Pure presentation over the worker's authoritative bracket; no derived state.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  type BracketMatchView,
  formatDeadline,
  formatLastSeen,
  isBracketComplete,
  isPresent,
  nextMatchFor,
  opponentOf,
  roundLabel,
  type TournamentView,
} from "#data/elite-redux/showdown/tournament-types";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";

const GOLD = 0xf8d030;
const NEXT = 0x48c8f8;
const TODO = 0x8a93b4;
const BOARD = 0x0b1838;
const BYE = 0x5a6488;
const DUE_SOON = 0xf85040;
const LINE_DIM = 0x394874;
const CELL_FILL = 0x111a38;
const WHITE = 0xffffff;
const PRESENT_GREEN = 0x78e08a;
const ELIM_RED = 0xf85040;

/** Poll cadence for the live board refresh (ms). */
const POLL_INTERVAL_MS = 6000;

/** Config the caller passes to render the board. */
export interface TournamentBracketConfig {
  tournament: TournamentView;
  /** The viewer's account username. */
  ownParticipant: string;
  /** Epoch ms for the deadline / last-seen countdowns. */
  now: number;
  /** Enter the constrained tournament lobby for a playable own match. */
  onPlayMatch: (matchId: string, opponent: string) => void;
  /** Leave the board (back to the list). */
  onBack: () => void;
  /** P1.5 live refresh: re-fetch the tournament view; null on failure. Absent = no polling. */
  onPoll?: () => Promise<TournamentView | null>;
  /** P1.5 presence: ping the worker while the board is open. */
  onPing?: () => void;
  /** Optional forced starting browse cursor (render goldens / realpath tests). */
  initialBrowse?: { round: number; slot: number };
}

/** A guaranteed-DARK navy content panel with a gold border (legible in-game AND headless). */
function darkPanel(
  x: number,
  y: number,
  w: number,
  h: number,
  color = CELL_FILL,
  alpha = 0.94,
): Phaser.GameObjects.Rectangle {
  const r = globalScene.add.rectangle(x, y, w, h, color, alpha).setOrigin(0, 0);
  r.setStrokeStyle(1, GOLD, 0.7);
  return r;
}

/** Optional PWT 9-slice chrome (border only) when the CDN texture is present. */
function pwtFrame(x: number, y: number, w: number, h: number): Phaser.GameObjects.NineSlice | null {
  if (globalScene.textures.exists("er_pwt_panel")) {
    const n = globalScene.add.nineslice(x, y, "er_pwt_panel", undefined, w, h, 4, 4, 4, 4);
    n.setOrigin(0, 0);
    return n;
  }
  return null;
}

/** 2D browse cursor over the bracket matches. */
interface BrowseCursor {
  round: number;
  slot: number;
}

export class TournamentBracketUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private board: Phaser.GameObjects.Rectangle;
  private frame: Phaser.GameObjects.NineSlice | null = null;
  private title: Phaser.GameObjects.Text;
  private cardPanel: Phaser.GameObjects.Rectangle;
  private cardTitle: Phaser.GameObjects.Text;
  private cardBody: Phaser.GameObjects.Text;
  private cardHint: Phaser.GameObjects.Text;
  private nodes: Phaser.GameObjects.GameObject[] = [];
  private cardNodes: Phaser.GameObjects.GameObject[] = [];

  private config: TournamentBracketConfig | null = null;
  private browse: BrowseCursor = { round: 0, slot: 0 };
  /** The match the browse cursor sits on (its pairing card is shown). */
  private browsedMatch: BracketMatchView | null = null;
  /** Set when the browsed match is YOUR playable match (A enters the lobby). */
  private playableOpponent: string | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private requestedAtlases = new Set<string>();

  constructor() {
    super(UiMode.TOURNAMENT_BRACKET);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    this.board = globalScene.add.rectangle(0, 0, w, h, BOARD, 1).setOrigin(0);
    this.board.setStrokeStyle(2, GOLD, 0.8);
    this.container.add(this.board);
    this.frame = pwtFrame(0, 0, w, h);
    if (this.frame) {
      this.container.add(this.frame);
    }

    this.title = addTextObject(w / 2, 3, "", TextStyle.WINDOW, { fontSize: "38px" });
    this.title.setOrigin(0.5, 0);
    this.title.setTint(GOLD);
    this.container.add(this.title);

    // Bottom pairing / opponent card.
    const cardH = 34;
    const cardY = h - cardH - 3;
    this.cardPanel = darkPanel(6, cardY, w - 12, cardH, 0x0a1230);
    this.container.add(this.cardPanel);
    this.cardTitle = addTextObject(11, cardY + 3, "", TextStyle.WINDOW, { fontSize: "32px" });
    this.cardTitle.setOrigin(0, 0);
    this.cardTitle.setTint(NEXT);
    this.container.add(this.cardTitle);
    this.cardBody = addTextObject(11, cardY + 12, "", TextStyle.PARTY, { fontSize: "30px" });
    this.cardBody.setOrigin(0, 0);
    this.cardBody.setTint(WHITE);
    this.container.add(this.cardBody);
    this.cardHint = addTextObject(w - 11, cardY + 3, "", TextStyle.PARTY, { fontSize: "30px" });
    this.cardHint.setOrigin(1, 0);
    this.cardHint.setTint(GOLD);
    this.container.add(this.cardHint);
  }

  show(args: any[]): boolean {
    if (!(args.length > 0 && args[0] != null)) {
      return false;
    }
    this.config = args[0] as TournamentBracketConfig;
    this.title.setText(this.config.tournament.name);
    this.resetBrowseToOwnMatch();
    const forced = this.config.initialBrowse;
    const rounds = this.config.tournament.bracket?.rounds;
    if (forced != null && rounds != null) {
      const round = Phaser.Math.Clamp(forced.round, 0, rounds.length - 1);
      const slot = Phaser.Math.Clamp(forced.slot, 0, (rounds[round]?.length ?? 1) - 1);
      this.browse = { round, slot };
    }
    this.layout();
    this.container.setVisible(true);
    this.active = true;
    this.startPolling();
    return true;
  }

  // #region entrant / seed lookups

  private seedOf(participant: string | null): number | null {
    if (participant == null || this.config == null) {
      return null;
    }
    return this.config.tournament.entrants.find(e => e.participant === participant)?.seed ?? null;
  }

  private entrantOf(participant: string | null) {
    if (participant == null || this.config == null) {
      return null;
    }
    return this.config.tournament.entrants.find(e => e.participant === participant) ?? null;
  }

  private displayName(participant: string | null): string {
    if (participant == null) {
      return "";
    }
    return this.entrantOf(participant)?.ghost?.name ?? participant;
  }

  // #endregion
  // #region browse cursor

  /** Default the browse cursor onto the viewer's next match (their live front), else the first match. */
  private resetBrowseToOwnMatch(): void {
    const bracket = this.config?.tournament.bracket;
    if (bracket == null) {
      this.browse = { round: 0, slot: 0 };
      return;
    }
    const mine = nextMatchFor(bracket, this.config?.ownParticipant ?? "");
    this.browse = mine ? { round: mine.round, slot: mine.slot } : { round: 0, slot: 0 };
  }

  private matchAt(round: number, slot: number): BracketMatchView | null {
    const rounds = this.config?.tournament.bracket?.rounds;
    return rounds?.[round]?.[slot] ?? null;
  }

  // #endregion
  // #region layout

  private layout(): void {
    for (const n of this.nodes) {
      n.destroy();
    }
    this.nodes = [];
    const cfg = this.config;
    const bracket = cfg?.tournament.bracket;
    if (cfg == null || bracket == null) {
      this.layoutCard();
      return;
    }

    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const rounds = bracket.rounds.length;
    const cols = rounds + 1; // +1 for the champion slot column
    const marginX = 6;
    const gapX = 6;
    const areaTop = 26;
    const areaBottom = h - 34 - 8;
    const areaH = areaBottom - areaTop;
    const colW = (w - 2 * marginX) / cols;
    const cellW = colW - gapX;
    const cellLeft = (c: number) => marginX + c * colW + gapX / 2;
    const cellRight = (c: number) => cellLeft(c) + cellW;
    const centerY = (m: number, count: number) => areaTop + ((m + 0.5) * areaH) / count;

    const own = cfg.ownParticipant;
    const yourMatch = nextMatchFor(bracket, own);

    // round headers
    for (let r = 0; r < rounds; r++) {
      const rl = addTextObject(cellLeft(r) + cellW / 2, 16, roundLabel(r, rounds), TextStyle.PARTY, {
        fontSize: "24px",
      });
      rl.setOrigin(0.5, 0);
      rl.setTint(TODO);
      this.container.add(rl);
      this.nodes.push(rl);
    }
    const champHeader = addTextObject(cellLeft(cols - 1) + cellW / 2, 16, "Champion", TextStyle.PARTY, {
      fontSize: "24px",
    });
    champHeader.setOrigin(0.5, 0);
    champHeader.setTint(GOLD);
    this.container.add(champHeader);
    this.nodes.push(champHeader);

    // --- CONNECTING LINES (drawn beneath the cells) ---
    for (let r = 0; r < rounds; r++) {
      const matches = bracket.rounds[r];
      const count = matches.length;
      for (let m = 0; m < count; m++) {
        const childY = centerY(m, count);
        const decided = matches[m].winner !== null;
        const lineColor = decided ? GOLD : LINE_DIM;
        // target: parent match (next round) or the champion slot (after the final)
        const targetCol = r + 1;
        const targetCount = r + 1 < rounds ? bracket.rounds[r + 1].length : 1;
        const targetSlot = Math.floor(m / 2);
        const targetY = centerY(targetSlot, targetCount);
        this.drawConnector(cellRight(r), childY, cellLeft(targetCol), targetY, lineColor, decided);
      }
    }

    // --- MATCH CELLS ---
    for (let r = 0; r < rounds; r++) {
      const matches = bracket.rounds[r];
      const count = matches.length;
      const cellH = Math.max(11, Math.min(24, areaH / count - 3));
      for (let m = 0; m < count; m++) {
        const cy = centerY(m, count);
        const match = matches[m];
        const isYour = yourMatch != null && match.id === yourMatch.id;
        const isBrowsed = this.browse.round === r && this.browse.slot === m;
        this.drawMatchCell(match, cellLeft(r), cy - cellH / 2, cellW, cellH, own, isYour, isBrowsed);
      }
    }

    // --- CHAMPION SLOT (far-right column) ---
    this.drawChampionSlot(cellLeft(cols - 1), centerY(0, 1), cellW, own);

    // record the browsed match for the card + input
    this.browsedMatch = this.matchAt(this.browse.round, this.browse.slot);

    // champion celebration overlay (over the dimmed bracket)
    if (isBracketComplete(bracket)) {
      this.drawChampionOverlay(cfg.tournament.champion ?? null, own);
    }

    this.layoutCard();
  }

  /** A bracket elbow connector: child stub -> mid vertical -> parent stub. Thin rects. */
  private drawConnector(
    childRight: number,
    childY: number,
    parentLeft: number,
    parentY: number,
    color: number,
    strong: boolean,
  ): void {
    const midX = (childRight + parentLeft) / 2;
    const th = strong ? 1.4 : 1;
    const alpha = strong ? 0.95 : 0.55;
    const add = (x: number, y: number, ww: number, hh: number) => {
      const r = globalScene.add.rectangle(x, y, ww, hh, color, alpha).setOrigin(0, 0.5);
      this.container.add(r);
      this.nodes.push(r);
    };
    // horizontal stub out of the child
    add(childRight, childY, Math.max(1, midX - childRight), th);
    // vertical segment at the mid column
    const y0 = Math.min(childY, parentY);
    const y1 = Math.max(childY, parentY);
    const v = globalScene.add.rectangle(midX - th / 2, y0, th, Math.max(1, y1 - y0), color, alpha).setOrigin(0, 0);
    this.container.add(v);
    this.nodes.push(v);
    // horizontal stub into the parent
    add(midX, parentY, Math.max(1, parentLeft - midX), th);
  }

  private drawMatchCell(
    match: BracketMatchView,
    x: number,
    y: number,
    cw: number,
    ch: number,
    own: string,
    isYour: boolean,
    isBrowsed: boolean,
  ): void {
    const panel = darkPanel(x, y, cw, ch);
    this.container.add(panel);
    this.nodes.push(panel);

    // YOUR next fight: persistent gold glow border + VS marker.
    if (isYour) {
      const glow = globalScene.add.rectangle(x - 1, y - 1, cw + 2, ch + 2, WHITE, 0).setOrigin(0, 0);
      glow.setStrokeStyle(1.6, GOLD, 1);
      this.container.add(glow);
      this.nodes.push(glow);
    }
    // Browse cursor: a distinct cyan ring around the currently-inspected match.
    if (isBrowsed) {
      const cur = globalScene.add.rectangle(x - 2, y - 2, cw + 4, ch + 4, WHITE, 0).setOrigin(0, 0);
      cur.setStrokeStyle(1, NEXT, 1);
      this.container.add(cur);
      this.nodes.push(cur);
    }

    const half = ch / 2;
    const emptyLabel = match.round === 0 ? "bye" : "TBD";
    const aLoser = match.winner !== null && match.a !== null && match.a !== match.winner;
    const bLoser = match.winner !== null && match.b !== null && match.b !== match.winner;
    this.drawSlot(match.a, match.winner, own, x, y, half, emptyLabel, aLoser);
    this.drawSlot(match.b, match.winner, own, x, y + half, half, emptyLabel, bLoser);

    // VS marker centered between the two slots of your fight (or the browsed one).
    if (isYour || isBrowsed) {
      const vs = addTextObject(x + cw - 2, y + half, "VS", TextStyle.WINDOW, { fontSize: "22px" });
      vs.setOrigin(1, 0.5);
      vs.setTint(isYour ? GOLD : NEXT);
      this.container.add(vs);
      this.nodes.push(vs);
    }
  }

  private drawSlot(
    participant: string | null,
    winner: string | null,
    own: string,
    x: number,
    y: number,
    sh: number,
    emptyLabel: string,
    isLoser: boolean,
  ): void {
    const isEmpty = participant === null;
    const isWinner = participant !== null && participant === winner;
    const isOwn = participant === own;
    const iconH = Math.max(7, Math.min(sh - 1, 15));
    const iconCx = x + 1 + iconH * 0.42;
    const iconTop = y + (sh - iconH) / 2;

    // ghost-trainer icon (or fallback avatar), dimmed when this slot lost.
    const spriteKey = isEmpty ? null : (this.entrantOf(participant)?.ghost?.spriteKey ?? null);
    this.drawTrainerIcon(iconCx, iconTop + iconH, iconH, spriteKey, { dim: isLoser, empty: isEmpty });

    const textX = x + 2 + iconH * 0.9;
    const seed = this.seedOf(participant);
    const nm = isEmpty ? emptyLabel : this.displayName(participant);
    const label = isEmpty ? emptyLabel : `${seed == null ? "" : `${seed}. `}${nm}`;
    const t = addTextObject(textX, y + sh / 2, label, TextStyle.WINDOW, { fontSize: "26px" });
    t.setOrigin(0, 0.5);
    t.setTint(isWinner ? GOLD : isEmpty ? BYE : isLoser ? BYE : isOwn ? NEXT : WHITE);
    if (isLoser) {
      t.setAlpha(0.5);
    }
    this.container.add(t);
    this.nodes.push(t);

    // eliminated: a red X over the icon.
    if (isLoser) {
      const cross = addTextObject(iconCx, y + sh / 2, "x", TextStyle.WINDOW, { fontSize: "34px" });
      cross.setOrigin(0.5, 0.5);
      cross.setTint(ELIM_RED);
      this.container.add(cross);
      this.nodes.push(cross);
    }
  }

  /** The far-right champion slot: the trophy pedestal + (once decided) the champion's icon. */
  private drawChampionSlot(x: number, cy: number, cw: number, own: string): void {
    const bracket = this.config?.tournament.bracket;
    const champ = bracket ? (isBracketComplete(bracket) ? (this.config?.tournament.champion ?? null) : null) : null;
    const slotH = 20;
    const y = cy - slotH / 2;
    const panel = darkPanel(x, y, cw, slotH, 0x1a1330, 0.96);
    panel.setStrokeStyle(1.4, GOLD, 1);
    this.container.add(panel);
    this.nodes.push(panel);

    const iconH = 15;
    const spriteKey = champ ? (this.entrantOf(champ)?.ghost?.spriteKey ?? null) : null;
    this.drawTrainerIcon(x + 2 + iconH * 0.42, y + (slotH - iconH) / 2 + iconH, iconH, spriteKey, {
      dim: false,
      empty: champ === null,
    });
    const label = champ ? this.displayName(champ) : "TBD";
    const t = addTextObject(x + 2 + iconH, cy, label, TextStyle.WINDOW, { fontSize: "26px" });
    t.setOrigin(0, 0.5);
    t.setTint(champ ? GOLD : TODO);
    if (champ === own) {
      t.setText(`${label}`);
    }
    this.container.add(t);
    this.nodes.push(t);
  }

  /**
   * Draw a small trainer icon at (cx, feetY) of the given height, or a neutral fallback
   * avatar. Two-pass-harness friendly: `add.sprite(key)` is called even when the texture is
   * missing so pass 1 RECORDS the key for injection; if it stays unresolved we drop the probe
   * and draw the fallback (real trainers appear on pass 2 / after the on-demand atlas load).
   */
  private drawTrainerIcon(
    cx: number,
    feetY: number,
    iconH: number,
    spriteKey: string | null,
    opts: { dim: boolean; empty: boolean },
  ): void {
    if (spriteKey) {
      const probe = globalScene.add.sprite(cx, feetY, spriteKey);
      if (globalScene.textures.exists(spriteKey)) {
        probe.setFrame(0);
        const fh = probe.height || 64;
        probe.setOrigin(0.5, 1);
        probe.setScale(iconH / fh);
        if (opts.dim) {
          probe.setTintFill(0x2a3352);
          probe.setAlpha(0.7);
        }
        this.container.add(probe);
        this.nodes.push(probe);
        return;
      }
      probe.destroy();
      this.ensureTrainerAtlas(spriteKey);
    }
    // fallback neutral avatar: a filled disc + ring (always renders, no texture needed).
    const cyMid = feetY - iconH / 2;
    const disc = globalScene.add.ellipse(cx, cyMid, iconH * 0.8, iconH * 0.9, opts.empty ? 0x2a3352 : 0x394874, 1);
    disc.setStrokeStyle(1, opts.dim ? BYE : GOLD, opts.dim ? 0.5 : 0.85);
    disc.setOrigin(0.5, 0.5);
    if (opts.dim) {
      disc.setAlpha(0.6);
    }
    this.container.add(disc);
    this.nodes.push(disc);
  }

  /** On-demand trainer atlas load; a completed load re-renders so the icon appears live. */
  private ensureTrainerAtlas(spriteKey: string): void {
    if (this.requestedAtlases.has(spriteKey) || globalScene.textures.exists(spriteKey)) {
      return;
    }
    this.requestedAtlases.add(spriteKey);
    try {
      globalScene.loadAtlas(spriteKey, "trainer");
      globalScene.load.once(Phaser.Loader.Events.COMPLETE, () => {
        if (this.active) {
          this.layout();
        }
      });
      if (!globalScene.load.isLoading()) {
        globalScene.load.start();
      }
    } catch {
      // Loader unavailable (headless probe pass) — the two-pass injector handles the key.
    }
  }

  /** The champion celebration: dim the bracket, drop the winner's trainer art center-stage. */
  private drawChampionOverlay(champion: string | null, _own: string): void {
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const scrim = globalScene.add.rectangle(0, 0, w, h - 40, 0x05091c, 0.62).setOrigin(0, 0);
    this.container.add(scrim);
    this.nodes.push(scrim);

    const spriteKey = champion ? (this.entrantOf(champion)?.ghost?.spriteKey ?? null) : null;
    const artH = 84;
    const cx = w / 2;
    const feetY = 30 + artH;
    // big center-stage art (probe + fallback, same two-pass discipline)
    if (spriteKey) {
      const probe = globalScene.add.sprite(cx, feetY, spriteKey);
      if (globalScene.textures.exists(spriteKey)) {
        probe.setFrame(0);
        const fh = probe.height || 64;
        probe.setOrigin(0.5, 1);
        probe.setScale(artH / fh);
        this.container.add(probe);
        this.nodes.push(probe);
      } else {
        probe.destroy();
        this.ensureTrainerAtlas(spriteKey);
        this.drawChampionFallbackArt(cx, feetY, artH);
      }
    } else {
      this.drawChampionFallbackArt(cx, feetY, artH);
    }

    if (globalScene.textures.exists("er_pwt_trophy")) {
      const trophy = globalScene.add.image(cx, 24, "er_pwt_trophy");
      trophy.setOrigin(0.5, 0);
      trophy.setScale(0.14);
      this.container.add(trophy);
      this.nodes.push(trophy);
    }

    const banner = addTextObject(cx, feetY + 4, `CHAMPION - ${this.displayName(champion)}`, TextStyle.WINDOW, {
      fontSize: "44px",
    });
    banner.setOrigin(0.5, 0);
    banner.setTint(GOLD);
    this.container.add(banner);
    this.nodes.push(banner);
  }

  private drawChampionFallbackArt(cx: number, feetY: number, artH: number): void {
    const disc = globalScene.add.ellipse(cx, feetY - artH / 2, artH * 0.7, artH, 0x394874, 1);
    disc.setStrokeStyle(2, GOLD, 1);
    disc.setOrigin(0.5, 0.5);
    this.container.add(disc);
    this.nodes.push(disc);
  }

  // #endregion
  // #region the bottom card

  /** Fill the pairing / opponent card for the browsed match + record the actionable match. */
  private layoutCard(): void {
    for (const n of this.cardNodes) {
      n.destroy();
    }
    this.cardNodes = [];
    const cfg = this.config;
    this.playableOpponent = null;
    if (cfg == null || cfg.tournament.bracket == null) {
      this.cardTitle.setText("");
      this.cardBody.setText("");
      this.cardHint.setText("B: Back");
      return;
    }
    const bracket = cfg.tournament.bracket;
    const own = cfg.ownParticipant;

    // CHAMPION state: the card is the champion banner (no fight card).
    if (isBracketComplete(bracket)) {
      const champ = cfg.tournament.champion;
      this.cardTitle.setTint(GOLD);
      this.cardTitle.setText(champ === own ? "YOU ARE THE CHAMPION" : "TOURNAMENT COMPLETE");
      this.cardBody.setTint(WHITE);
      this.cardBody.setText(champ ? `${this.displayName(champ)} wins the ${cfg.tournament.name}!` : "Complete.");
      this.cardHint.setText("B: Back");
      return;
    }

    const match = this.browsedMatch;
    const yourMatch = nextMatchFor(bracket, own);
    const entered = cfg.tournament.entrants.some(e => e.participant === own);

    // Is the browsed match YOUR playable fight?
    const isYourBrowsed = match != null && yourMatch != null && match.id === yourMatch.id;
    const opponent = isYourBrowsed ? opponentOf(match, own) : null;

    if (isYourBrowsed && opponent != null) {
      // OPPONENT CARD: portrait + title + deadline + presence.
      this.drawOpponentCard(match, opponent);
      return;
    }

    if (isYourBrowsed && opponent == null) {
      this.cardTitle.setTint(NEXT);
      this.cardTitle.setText("YOUR NEXT MATCH");
      this.cardBody.setTint(WHITE);
      this.cardBody.setText(`Waiting for your opponent    ${formatDeadline(match?.deadline ?? null, cfg.now)}`);
      this.cardHint.setText("B: Back");
      return;
    }

    // Browsing another match (or you are eliminated / not entered): show its pairing, read-only.
    if (match != null) {
      this.drawPairingCard(match, entered, yourMatch != null);
      return;
    }

    this.cardTitle.setTint(TODO);
    this.cardTitle.setText("BRACKET");
    this.cardBody.setText("Browse matches with the d-pad.");
    this.cardHint.setText("B: Back");
  }

  private drawOpponentCard(match: BracketMatchView, opponent: string): void {
    const cfg = this.config;
    if (cfg == null) {
      return;
    }
    const h = globalScene.scaledCanvas.height;
    const cardY = h - 34 - 3;
    const ent = this.entrantOf(opponent);
    const seed = ent?.seed ?? null;
    const oppName = ent?.ghost?.name ?? opponent;
    const oppTitle = ent?.ghost?.title;

    // opponent portrait on the card's right side
    const spriteKey = ent?.ghost?.spriteKey ?? null;
    this.drawCardPortrait(spriteKey);

    this.cardTitle.setTint(NEXT);
    this.cardTitle.setText(`YOUR MATCH  vs ${seed == null ? "" : `#${seed} `}${oppName}`);

    const dueSoon = match.deadline != null && match.deadline - cfg.now <= 3_600_000;
    const countdown = formatDeadline(match.deadline, cfg.now);
    const present = isPresent(ent?.lastSeen, cfg.now);
    const presence = present ? "In lobby now" : `Last seen ${formatLastSeen(ent?.lastSeen, cfg.now)}`;
    this.cardBody.setTint(dueSoon ? DUE_SOON : WHITE);
    const titlePart = oppTitle ? `${oppTitle}   ` : "";
    this.cardBody.setText(`${titlePart}${countdown}   ${presence}`);

    // presence chip line just above the hint
    const chip = addTextObject(
      globalScene.scaledCanvas.width - 11,
      cardY + 12,
      present ? "ONLINE" : "OFFLINE",
      TextStyle.PARTY,
      {
        fontSize: "26px",
      },
    );
    chip.setOrigin(1, 0);
    chip.setTint(present ? PRESENT_GREEN : TODO);
    this.container.add(chip);
    this.cardNodes.push(chip);

    this.playableOpponent = opponent;
    this.cardHint.setText(present ? "A: FIGHT    B: Back" : "A: FIGHT    B: Back");
  }

  private drawPairingCard(match: BracketMatchView, entered: boolean, hasUpcoming: boolean): void {
    const cfg = this.config;
    if (cfg == null) {
      return;
    }
    const a = match.a;
    const b = match.b;
    const label = (p: string | null, empty: string) =>
      p == null ? empty : `${this.seedOf(p) == null ? "" : `#${this.seedOf(p)} `}${this.displayName(p)}`;
    const emptyLabel = match.round === 0 ? "bye" : "TBD";

    if (entered && !hasUpcoming) {
      this.cardTitle.setTint(ELIM_RED);
      this.cardTitle.setText("ELIMINATED - SPECTATING");
    } else if (entered) {
      this.cardTitle.setTint(TODO);
      this.cardTitle.setText(`${roundLabel(match.round, cfg.tournament.bracket?.rounds.length ?? 1)} MATCH`);
    } else {
      this.cardTitle.setTint(TODO);
      this.cardTitle.setText("SPECTATING");
    }

    this.cardBody.setTint(WHITE);
    let status: string;
    if (match.winner != null) {
      status = `Winner: ${this.displayName(match.winner)}`;
    } else if (match.a != null && match.b != null) {
      status = `In progress   ${formatDeadline(match.deadline, cfg.now)}`;
    } else {
      status = "Awaiting entrants";
    }
    this.cardBody.setText(`${label(a, emptyLabel)}  vs  ${label(b, emptyLabel)}    ${status}`);
    this.cardHint.setText("B: Back");
  }

  /** A small opponent portrait on the card (right side), probe + fallback discipline. */
  private drawCardPortrait(spriteKey: string | null): void {
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const cardY = h - 34 - 3;
    const cx = w - 60;
    const artH = 30;
    const feetY = cardY + 33;
    if (spriteKey) {
      const probe = globalScene.add.sprite(cx, feetY, spriteKey);
      if (globalScene.textures.exists(spriteKey)) {
        probe.setFrame(0);
        const fh = probe.height || 64;
        probe.setOrigin(0.5, 1);
        probe.setScale(artH / fh);
        this.container.add(probe);
        this.cardNodes.push(probe);
        return;
      }
      probe.destroy();
      this.ensureTrainerAtlas(spriteKey);
    }
    const disc = globalScene.add.ellipse(cx, feetY - artH / 2, artH * 0.7, artH * 0.9, 0x394874, 1);
    disc.setStrokeStyle(1, GOLD, 0.85);
    disc.setOrigin(0.5, 0.5);
    this.container.add(disc);
    this.cardNodes.push(disc);
  }

  // #endregion
  // #region polling

  private startPolling(): void {
    this.stopPolling();
    const cfg = this.config;
    if (cfg?.onPoll == null) {
      return;
    }
    cfg.onPing?.();
    this.pollTimer = setInterval(() => void this.doPoll(), POLL_INTERVAL_MS);
  }

  private async doPoll(): Promise<void> {
    const cfg = this.config;
    if (cfg?.onPoll == null || !this.active) {
      return;
    }
    cfg.onPing?.();
    const fresh = await cfg.onPoll();
    if (fresh != null && this.active && this.config != null) {
      this.config.tournament = fresh;
      this.config.now = Date.now();
      // keep the browse cursor in-bounds against the (possibly advanced) bracket
      const rounds = fresh.bracket?.rounds;
      if (rounds != null) {
        this.browse.round = Math.min(this.browse.round, rounds.length - 1);
        this.browse.slot = Math.min(this.browse.slot, (rounds[this.browse.round]?.length ?? 1) - 1);
      }
      this.title.setText(fresh.name);
      this.layout();
    }
  }

  private stopPolling(): void {
    if (this.pollTimer != null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  // #endregion
  // #region input

  processInput(button: Button): boolean {
    const cfg = this.config;
    const bracket = cfg?.tournament.bracket;
    if (cfg == null) {
      return false;
    }
    switch (button) {
      case Button.ACTION:
        if (this.playableOpponent != null && this.browsedMatch != null) {
          globalScene.ui.playSelect();
          this.stopPolling();
          cfg.onPlayMatch(this.browsedMatch.id, this.playableOpponent);
          return true;
        }
        return false;
      case Button.CANCEL:
        globalScene.ui.playSelect();
        this.stopPolling();
        cfg.onBack();
        return true;
      case Button.UP:
      case Button.DOWN:
      case Button.LEFT:
      case Button.RIGHT:
        if (bracket != null && !isBracketComplete(bracket)) {
          return this.moveBrowse(button, bracket.rounds);
        }
        return false;
    }
    return false;
  }

  /** d-pad browse: LEFT/RIGHT change round (column), UP/DOWN change slot within the round. */
  private moveBrowse(button: Button, rounds: BracketMatchView[][]): boolean {
    let { round, slot } = this.browse;
    if (button === Button.LEFT || button === Button.RIGHT) {
      round = Phaser.Math.Clamp(round + (button === Button.RIGHT ? 1 : -1), 0, rounds.length - 1);
      slot = Phaser.Math.Clamp(slot, 0, rounds[round].length - 1);
    } else {
      const dir = button === Button.DOWN ? 1 : -1;
      slot = Phaser.Math.Clamp(slot + dir, 0, rounds[round].length - 1);
    }
    if (round === this.browse.round && slot === this.browse.slot) {
      return false;
    }
    this.browse = { round, slot };
    globalScene.ui.playSelect();
    this.layout();
    return true;
  }

  // #endregion

  clear(): void {
    super.clear();
    this.stopPolling();
    this.container.setVisible(false);
    for (const n of this.nodes) {
      n.destroy();
    }
    for (const n of this.cardNodes) {
      n.destroy();
    }
    this.nodes = [];
    this.cardNodes = [];
    this.config = null;
  }
}

// =============================================================================
// Demo config builders for the render harness (golden-gated board states). Each
// entrant carries a real trainer-atlas ghost icon (resolved via trainerConfigs,
// the two-pass injector then loads it) + name/title, so the goldens show the real
// PWT board — connecting lines, ghost-trainer slot icons, VS marker, resolution
// dims, and the champion center-stage.
// =============================================================================

import { resolveGhostSpriteKey } from "#data/elite-redux/showdown/tournament-ghost-icon";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { TrainerType } from "#enums/trainer-type";

interface DemoOpts {
  size: 4 | 8 | 16;
  /** Settle this many full early rounds (top seed wins) — legacy coarse control. */
  advancedRounds?: number;
  /** Force a bye field (odd count). */
  byes?: boolean;
  /** The bottom-card state to surface. */
  card?: "playable" | "waiting" | "dueSoon" | "champion" | "none";
  /** Put the browse cursor on a match that is NOT the viewer's (pairing-card golden). */
  browseOther?: boolean;
  /** The viewer loses their round-0 match (eliminated read-only view). */
  eliminated?: boolean;
  /** 4-field: settle only the OTHER semifinal (mid-round: advanced icon + dimmed loser). */
  resolvedSemi?: boolean;
}

/** A spread of PWT trainer classes for the demo ghost icons (resolved to real atlas keys). */
const DEMO_TRAINER_TYPES: TrainerType[] = [
  TrainerType.ACE_TRAINER,
  TrainerType.VETERAN,
  TrainerType.BLACK_BELT,
  TrainerType.PSYCHIC,
  TrainerType.HIKER,
  TrainerType.CYCLIST,
  TrainerType.SWIMMER,
  TrainerType.GUITARIST,
  TrainerType.YOUNGSTER,
  TrainerType.SCIENTIST,
  TrainerType.BREEDER,
  TrainerType.RICH_KID,
  TrainerType.SCHOOL_KID,
  TrainerType.PARASOL_LADY,
  TrainerType.POKEFAN,
];
const DEMO_TITLES = ["The Bold", "Storm Caller", "Iron Will", "Trick Master", "", "Old Guard", "", ""];

function demoSpriteKey(i: number): string {
  const type = DEMO_TRAINER_TYPES[i % DEMO_TRAINER_TYPES.length];
  return trainerConfigs[type]?.getSpriteKey(false, false) ?? resolveGhostSpriteKey(null);
}

function makeBracketView(opts: DemoOpts, own: string, now: number): TournamentView {
  const n = opts.byes ? (opts.size === 8 ? 5 : opts.size === 16 ? 11 : 3) : opts.size;
  const names = [
    "carla",
    "ash",
    "misty",
    "brock",
    "gary",
    "may",
    "dawn",
    "iris",
    "cyrus",
    "cynthia",
    "lance",
    "steven",
    "wallace",
    "red",
    "blue",
    "leaf",
  ];
  const entrants = Array.from({ length: n }, (_, i) => ({
    participant: names[i],
    name: names[i],
    seed: i + 1,
    ghost: {
      spriteKey: demoSpriteKey(i),
      name: names[i].charAt(0).toUpperCase() + names[i].slice(1),
      ...(DEMO_TITLES[i] ? { title: DEMO_TITLES[i] } : {}),
    },
    lastSeen: null as number | null,
  }));

  let size = 2;
  while (size < n) {
    size *= 2;
  }
  const roundsCount = Math.log2(size);
  const seedOrder = (sz: number): number[] => {
    let order = [1];
    while (order.length < sz) {
      const len = order.length * 2;
      const nxt: number[] = [];
      for (const s of order) {
        nxt.push(s, len + 1 - s);
      }
      order = nxt;
    }
    return order;
  };
  const order = seedOrder(size);
  const bySeed = new Map<number, string>(entrants.map(e => [e.seed as number, e.participant]));
  const slot = order.map(s => bySeed.get(s) ?? null);

  const rounds: BracketMatchView[][] = [];
  for (let r = 0; r < roundsCount; r++) {
    const count = size / 2 ** (r + 1);
    const rm: BracketMatchView[] = [];
    for (let m = 0; m < count; m++) {
      rm.push({
        id: `demo-r${r}-m${m}`,
        round: r,
        slot: m,
        a: r === 0 ? slot[m * 2] : null,
        b: r === 0 ? slot[m * 2 + 1] : null,
        winner: null,
        resolution: "pending",
        deadline: now + (r + 1) * 24 * 3_600_000,
        disputed: false,
      });
    }
    rounds.push(rm);
  }
  const feed = (r: number, m: number, wnr: string, res: BracketMatchView["resolution"]) => {
    const match = rounds[r][m];
    match.winner = wnr;
    match.resolution = res;
    if (r + 1 < roundsCount) {
      const parent = rounds[r + 1][Math.floor(m / 2)];
      if (m % 2 === 0) {
        parent.a = wnr;
      } else {
        parent.b = wnr;
      }
    }
  };
  // resolve byes
  for (const match of rounds[0]) {
    const aReal = match.a !== null;
    const bReal = match.b !== null;
    if (aReal !== bReal) {
      feed(0, match.slot, (aReal ? match.a : match.b) as string, "bye");
    }
  }
  const seedOf = (p: string) => entrants.find(e => e.participant === p)?.seed ?? 99;

  // legacy: settle N full early rounds (lower seed wins)
  const advance = opts.advancedRounds ?? 0;
  for (let r = 0; r < advance; r++) {
    for (const match of rounds[r]) {
      if (match.winner === null && match.a && match.b) {
        feed(r, match.slot, seedOf(match.a) <= seedOf(match.b) ? (match.a as string) : (match.b as string), "reported");
      }
    }
  }

  // 4-field mid-round: settle the semifinal that does NOT contain `own`.
  if (opts.resolvedSemi) {
    for (const match of rounds[0]) {
      if (match.winner === null && match.a && match.b && match.a !== own && match.b !== own) {
        feed(0, match.slot, seedOf(match.a) <= seedOf(match.b) ? (match.a as string) : (match.b as string), "reported");
      }
    }
  }

  // eliminated: `own` loses their round-0 match.
  if (opts.eliminated) {
    const mineM = rounds[0].find(m => m.a === own || m.b === own);
    if (mineM && mineM.a && mineM.b) {
      feed(0, mineM.slot, mineM.a === own ? (mineM.b as string) : (mineM.a as string), "reported");
    }
  }

  const champion = opts.card === "champion" ? own : null;
  if (opts.card === "champion") {
    for (let r = 0; r < roundsCount; r++) {
      for (const match of rounds[r]) {
        if (match.winner === null && match.a && match.b) {
          feed(r, match.slot, match.a === own || match.b === own ? own : (match.a as string), "reported");
        }
      }
    }
  }

  // presence: mark the viewer's live opponent ONLINE for the opponent card.
  const mine = rounds.flat().find(m => m.winner === null && (m.a === own || m.b === own));
  const oppName = mine ? (mine.a === own ? mine.b : mine.a) : null;
  const opp = oppName ? entrants.find(e => e.participant === oppName) : null;
  if (opp) {
    opp.lastSeen = opts.card === "dueSoon" ? now - 8 * 60_000 : now - 15_000;
  }

  return {
    id: "demo",
    name: opts.size === 16 ? "Champions League" : opts.size === 4 ? "Sample Cup" : "Spring Showdown Cup",
    organizer: "maintainer",
    state: opts.card === "champion" ? "complete" : "in_progress",
    roundWindowMs: 24 * 3_600_000,
    maxEntrants: opts.size,
    createdAt: now,
    startedAt: now,
    champion,
    entrantCount: n,
    entrants,
    bracket: { size, rounds },
  };
}

export function buildTournamentBracketDemoConfig(
  opts: DemoOpts = { size: 8, advancedRounds: 1, card: "playable" },
): TournamentBracketConfig {
  const own = "carla";
  const now = 1_700_000_000_000;
  const tournament = makeBracketView(opts, own, now);
  let renderNow = now;
  if (opts.card === "dueSoon") {
    const mine = tournament.bracket ? nextMatchFor(tournament.bracket, own) : null;
    if (mine?.deadline != null) {
      renderNow = mine.deadline - 30 * 60_000; // 30 min left
    }
  }
  // browse-other: put the cursor on a match that isn't the viewer's front.
  let initialBrowse: { round: number; slot: number } | undefined;
  if (opts.browseOther && tournament.bracket) {
    const mine = nextMatchFor(tournament.bracket, own);
    outer: for (let r = 0; r < tournament.bracket.rounds.length; r++) {
      for (let m = 0; m < tournament.bracket.rounds[r].length; m++) {
        const match = tournament.bracket.rounds[r][m];
        if (match.a && match.b && (mine == null || match.id !== mine.id)) {
          initialBrowse = { round: r, slot: m };
          break outer;
        }
      }
    }
  }
  return {
    tournament,
    ownParticipant: own,
    now: renderNow,
    onPlayMatch: () => {},
    onBack: () => {},
    ...(initialBrowse ? { initialBrowse } : {}),
  };
}
