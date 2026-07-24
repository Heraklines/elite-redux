/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENTS — THE BOARD (Showdown Tournament P1.5). The showpiece: a
// Pokemon World Tournament bracket board over the worker's authoritative bracket.
//   - BW2 PWT identity: the gold crest header band, a subtle stadium backdrop, the
//     gold trophy, and navy/gold beveled plates throughout (the same chrome language
//     as the Colosseum + tournament LIST screens).
//   - each match is a styled CARD: two entrant plates with a framed GHOST-TRAINER
//     ICON, a gold SEED chip, the real player USERNAME, win/loss colour language,
//     and a styled VS badge. Names truncate with an ellipsis at the 16-field scale;
//     the browsed match's card + the opponent card always show the full name.
//   - real CONNECTING LINES: elbow segments with clean joins, bright gold along
//     RESOLVED paths, dim along pending ones — scaling 4 / 8 / 16 cleanly.
//   - YOUR next fight is gold-highlighted with the VS badge; A marks the exact pairing
//     ready, then changes to JOIN after both entrants are ready. Menu offers dropout;
//     B returns to the list.
//   - the bottom OPPONENT card frames the opponent portrait, their custom TITLE as
//     flavor, the deadline countdown + a live presence chip, and the FIGHT prompt.
//   - RESOLUTION visuals: the winner's icon advances into the next slot (server-fed),
//     the loser's slot dims with an X; the CHAMPION state renders the winner's
//     trainer art center-stage over a gold banner, "CHAMPION - <name>".
//   - the board POLLS the worker (live refresh) and pings presence while open.
// Pure presentation over the worker's authoritative bracket; no derived state.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  autoResolutionLabel,
  type BracketMatchView,
  type BracketView,
  formatDeadline,
  formatLastSeen,
  isBracketComplete,
  isEntrantReadyForMatch,
  isKickedParticipant,
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

// --- PWT navy/gold palette --------------------------------------------------
const GOLD = 0xf8d030;
const GOLD_DEEP = 0xc79a1e;
const NEXT = 0x48c8f8; // browse cursor / your-turn cyan
const SUBTLE = 0xc0c8e0; // soft off-white for secondary text
const WHITE = 0xffffff;
const BOARD = 0x0a1430; // deep navy backdrop
const PLATE = 0x142248; // card plate fill
const PLATE_HI = 0x2a3d76; // bevel highlight
const PLATE_LO = 0x070c22; // bevel shadow
const HEADER_FILL = 0x101d40;
const TODO = 0x8a93b4; // not-yet-decided text
const BYE = 0x5a6488;
const DUE_SOON = 0xf85040;
const LINE_DIM = 0x35406e;
const PRESENT_GREEN = 0x78e08a;
const ELIM_RED = 0xf85040;
const CHIP_NAVY = 0x0a1430;

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
  /** Mark or clear readiness for an exact match. */
  onReadyChange?: (matchId: string, ready: boolean) => void;
  /** Leave the tournament, with confirmation handled by the flow owner. */
  onDropOut?: () => void;
  /** Leave the board (back to the list). */
  onBack: () => void;
  /** P1.5 live refresh: re-fetch the tournament view; null on failure. Absent = no polling. */
  onPoll?: () => Promise<TournamentView | null>;
  /** P1.5 presence: ping the worker while the board is open. */
  onPing?: () => void;
  /** Optional forced starting browse cursor (render goldens / realpath tests). */
  initialBrowse?: { round: number; slot: number };
}

/** 2D browse cursor over the bracket matches. */
interface BrowseCursor {
  round: number;
  slot: number;
}

const BOTTOM_CARD_H = 40;

export class TournamentBracketUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private board: Phaser.GameObjects.Rectangle;
  private title: Phaser.GameObjects.Text;
  private headerStatus: Phaser.GameObjects.Text;
  private cardTitle: Phaser.GameObjects.Text;
  private cardBody: Phaser.GameObjects.Text;
  private cardHint: Phaser.GameObjects.Text;
  /** Persistent chrome (backdrop, header band, bottom panel) built once in setup(). */
  private chrome: Phaser.GameObjects.GameObject[] = [];
  private nodes: Phaser.GameObjects.GameObject[] = [];
  private cardNodes: Phaser.GameObjects.GameObject[] = [];

  private config: TournamentBracketConfig | null = null;
  private browse: BrowseCursor = { round: 0, slot: 0 };
  /** P3 pagination: the current bracket SECTION page (0-based); 0 for the single-tree (<=16) path. */
  private section = 0;
  /** The match the browse cursor sits on (its pairing card is shown). */
  private browsedMatch: BracketMatchView | null = null;
  /** Set when a playable YOUR match is actionable (A enters the lobby). */
  private playableOpponent: string | null = null;
  /** The match id A acts on (the pinned your-match; may differ from the browsed cell when paginated). */
  private playableMatchId: string | null = null;
  private playableAction: "ready" | "unready" | "join" | null = null;
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

    // --- backdrop: deep navy + subtle PWT stadium texture + gold frame -----
    this.board = globalScene.add.rectangle(0, 0, w, h, BOARD, 1).setOrigin(0);
    this.container.add(this.board);
    if (globalScene.textures.exists("er_colosseum_bg")) {
      const bg = globalScene.add.image(0, 0, "er_colosseum_bg").setOrigin(0, 0);
      bg.setDisplaySize(w, h);
      bg.setAlpha(0.12);
      bg.setTint(0x3a5a9a);
      this.container.add(bg);
    }
    // gold double frame around the whole board
    const frame = globalScene.add.rectangle(1, 1, w - 2, h - 2, WHITE, 0).setOrigin(0);
    frame.setStrokeStyle(1.5, GOLD, 0.85);
    this.container.add(frame);
    if (globalScene.textures.exists("er_pwt_panel")) {
      const n = globalScene.add.nineslice(0, 0, "er_pwt_panel", undefined, w, h, 4, 4, 4, 4).setOrigin(0, 0);
      n.setAlpha(0.85);
      this.container.add(n);
    }

    // --- header band: crest + tournament name + status --------------------
    this.buildHeaderBand(w);

    // --- bottom opponent / pairing panel (persistent plate) ---------------
    const cardY = h - BOTTOM_CARD_H - 2;
    this.buildBottomPanel(w, cardY);

    this.cardTitle = addTextObject(12, cardY + 4, "", TextStyle.WINDOW, { fontSize: "36px" });
    this.cardTitle.setOrigin(0, 0);
    this.cardTitle.setTint(NEXT);
    this.container.add(this.cardTitle);
    this.cardBody = addTextObject(12, cardY + 16, "", TextStyle.PARTY, { fontSize: "32px" });
    this.cardBody.setOrigin(0, 0);
    this.cardBody.setTint(WHITE);
    this.container.add(this.cardBody);
    this.cardHint = addTextObject(w - 12, cardY + 4, "", TextStyle.PARTY, { fontSize: "32px" });
    this.cardHint.setOrigin(1, 0);
    this.cardHint.setTint(GOLD);
    this.container.add(this.cardHint);
  }

  /** The gold crest header band across the top. */
  private buildHeaderBand(w: number): void {
    const bandH = 20;
    this.plate(this.chrome, 4, 2, w - 8, bandH, { fill: HEADER_FILL, border: GOLD, borderW: 1.4 });
    // a thin gold underline rule under the band
    const rule = globalScene.add.rectangle(6, 2 + bandH, w - 12, 1, GOLD, 0.5).setOrigin(0, 0);
    this.container.add(rule);
    this.chrome.push(rule);

    if (globalScene.textures.exists("er_pwt_crest")) {
      const crestL = globalScene.add
        .image(16, 3, "er_pwt_crest")
        .setOrigin(0.5, 0)
        .setScale(17 / 123);
      const crestR = globalScene.add
        .image(w - 16, 3, "er_pwt_crest")
        .setOrigin(0.5, 0)
        .setScale(17 / 123);
      this.container.add(crestL);
      this.container.add(crestR);
      this.chrome.push(crestL, crestR);
    }

    this.title = addTextObject(w / 2, 4, "", TextStyle.WINDOW, { fontSize: "44px" });
    this.title.setOrigin(0.5, 0);
    this.title.setTint(GOLD);
    this.container.add(this.title);
    this.headerStatus = addTextObject(w / 2, 15, "Pokemon World Tournament", TextStyle.PARTY, { fontSize: "24px" });
    this.headerStatus.setOrigin(0.5, 0);
    this.headerStatus.setTint(SUBTLE);
    this.container.add(this.headerStatus);
  }

  /** The persistent bottom panel plate (contents filled per-state in layoutCard). */
  private buildBottomPanel(w: number, cardY: number): void {
    this.plate(this.chrome, 4, cardY, w - 8, BOTTOM_CARD_H, { fill: 0x0d1836, border: GOLD, borderW: 1.4 });
    // gold accent strip down the left edge of the panel
    const accent = globalScene.add.rectangle(4, cardY, 2, BOTTOM_CARD_H, GOLD, 0.85).setOrigin(0, 0);
    this.container.add(accent);
    this.chrome.push(accent);
  }

  /**
   * A navy/gold BEVELED plate (fill + border + a 1px highlight top / shadow bottom). Rendered
   * with pure primitives so it looks identical in-game AND in the headless golden harness.
   * Pushes every piece to `sink` (chrome for persistent, nodes for per-layout) + the container.
   */
  private plate(
    sink: Phaser.GameObjects.GameObject[],
    x: number,
    y: number,
    ww: number,
    hh: number,
    opts: { fill?: number; alpha?: number; border?: number; borderW?: number; borderAlpha?: number } = {},
  ): Phaser.GameObjects.Rectangle {
    const fill = opts.fill ?? PLATE;
    const base = globalScene.add.rectangle(x, y, ww, hh, fill, opts.alpha ?? 1).setOrigin(0, 0);
    base.setStrokeStyle(opts.borderW ?? 1, opts.border ?? GOLD_DEEP, opts.borderAlpha ?? 0.85);
    this.container.add(base);
    sink.push(base);
    const hi = globalScene.add.rectangle(x + 1, y + 1, ww - 2, 1, PLATE_HI, 0.55).setOrigin(0, 0);
    const lo = globalScene.add.rectangle(x + 1, y + hh - 2, ww - 2, 1, PLATE_LO, 0.7).setOrigin(0, 0);
    this.container.add(hi);
    this.container.add(lo);
    sink.push(hi, lo);
    return base;
  }

  show(args: any[]): boolean {
    if (!(args.length > 0 && args[0] != null)) {
      return false;
    }
    this.config = args[0] as TournamentBracketConfig;
    this.title.setText(this.config.tournament.name);
    this.updateHeaderStatus();
    this.resetBrowseToOwnMatch();
    const forced = this.config.initialBrowse;
    const rounds = this.config.tournament.bracket?.rounds;
    if (forced != null && rounds != null) {
      const round = Phaser.Math.Clamp(forced.round, 0, rounds.length - 1);
      const slot = Phaser.Math.Clamp(forced.slot, 0, (rounds[round]?.length ?? 1) - 1);
      this.browse = { round, slot };
      // P3: keep the section page in sync with a forced browse cursor (render goldens / realpath).
      this.section = this.sectionOfMatch(round, slot);
    }
    this.layout();
    this.container.setVisible(true);
    this.active = true;
    this.startPolling();
    return true;
  }

  private updateHeaderStatus(): void {
    const cfg = this.config;
    if (cfg == null) {
      return;
    }
    const t = cfg.tournament;
    if (t.state === "cancelled") {
      this.headerStatus.setText("Cancelled");
      this.headerStatus.setTint(ELIM_RED);
      return;
    }
    if (isBracketComplete(t.bracket ?? { size: 0, rounds: [] })) {
      this.headerStatus.setText("Champion crowned");
      this.headerStatus.setTint(GOLD);
      return;
    }
    this.headerStatus.setTint(SUBTLE);
    const hasOpenMatch = t.bracket != null && nextMatchFor(t.bracket, cfg.ownParticipant) != null;
    const canDropOut =
      (t.state === "registration" || (t.state === "in_progress" && hasOpenMatch))
      && t.entrants.some(e => e.participant === cfg.ownParticipant)
      && !isKickedParticipant(t.bracket ?? { size: 0, rounds: [] }, cfg.ownParticipant);
    this.headerStatus.setText(
      canDropOut
        ? `${t.entrantCount} entrants  •  MENU: DROP OUT`
        : `${t.entrantCount} entrants  •  Pokemon World Tournament`,
    );
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

  /**
   * The name shown on a slot / card is the REAL player USERNAME (the `participant`), never the
   * authored ghost name — that keeps identity unambiguous across the board. The worker mirrors
   * the username into `entrant.name`, so prefer that (identical to `participant`); the ghost
   * NAME/TITLE are flavor surfaced only on the opponent card ({@linkcode ghostTitleOf}).
   */
  private displayName(participant: string | null): string {
    if (participant == null) {
      return "";
    }
    return this.entrantOf(participant)?.name ?? participant;
  }

  /** The opponent's authored ghost TITLE (flavor only), or null. */
  private ghostTitleOf(participant: string | null): string | null {
    return this.entrantOf(participant)?.ghost?.title ?? null;
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
    // P3: default the section page to the one containing the viewer's match (else page 0).
    this.section = mine ? this.sectionOfMatch(mine.round, mine.slot) : 0;
  }

  private matchAt(round: number, slot: number): BracketMatchView | null {
    const rounds = this.config?.tournament.bracket?.rounds;
    return rounds?.[round]?.[slot] ?? null;
  }

  // #endregion
  // #region pagination geometry (P3 — 32/64 bracket sections)

  /**
   * How many SECTION pages the board splits into: 1 for <=16 (single tree), 2 (HALVES) for a
   * 32-slot field, 4 (QUADRANTS) for 64. Round-of-32/64 columns never render all on one screen.
   */
  private sectionCount(): number {
    const size = this.config?.tournament.bracket?.size ?? 0;
    if (size <= 16) {
      return 1;
    }
    return size === 32 ? 2 : 4;
  }

  /** Round-0 matches per section page (8 for both 32-halves and 64-quadrants — the readable density). */
  private perSectionRound0(): number {
    const size = this.config?.tournament.bracket?.size ?? 2;
    return size / 2 / this.sectionCount();
  }

  /** The last round a section OWNS on its page (its convergence match); downstream rounds are shared. */
  private convergeRound(): number {
    return Math.round(Math.log2(Math.max(1, this.perSectionRound0())));
  }

  /** The [lo, hi] GLOBAL slot range a section owns at `round` (inclusive). */
  private sectionSlotRange(section: number, round: number): { lo: number; hi: number } {
    const per = this.perSectionRound0() >> round;
    const lo = section * per;
    return { lo, hi: lo + per - 1 };
  }

  /** Which section page a (round, slot) belongs to (rounds beyond convergence map to section 0). */
  private sectionOfMatch(round: number, slot: number): number {
    if (round > this.convergeRound()) {
      return 0;
    }
    const per = this.perSectionRound0() >> round;
    return Math.floor(slot / Math.max(1, per));
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
    if (cfg == null) {
      this.layoutCard();
      return;
    }
    if (bracket == null) {
      this.layoutRegistration(cfg);
      this.layoutCard();
      return;
    }

    // P3: 32/64 fields paginate into bracket sections; <=16 keeps the single tree.
    if (this.sectionCount() > 1) {
      this.layoutPaginated(cfg, bracket);
      return;
    }

    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const rounds = bracket.rounds.length;
    const cols = rounds + 1; // +1 for the champion slot column
    const marginX = 5;
    const areaTop = 32;
    const areaBottom = h - BOTTOM_CARD_H - 6;
    const areaH = areaBottom - areaTop;
    const colW = (w - 2 * marginX) / cols;
    const cellW = colW - 6;
    const cellLeft = (c: number) => marginX + c * colW + 3;
    const cellRight = (c: number) => cellLeft(c) + cellW;
    const centerY = (m: number, count: number) => areaTop + ((m + 0.5) * areaH) / count;

    // A fixed comfortable cell height (derived from round 0), so later rounds do NOT balloon
    // into giant empty boxes (the old dead-space problem) — the tree stays evenly rhythmed.
    const n0 = bracket.rounds[0]?.length ?? 1;
    const cellH = Phaser.Math.Clamp(areaH / n0 - 3, 13, 22);

    const own = cfg.ownParticipant;
    const yourMatch = nextMatchFor(bracket, own);

    // round header banners
    for (let r = 0; r < rounds; r++) {
      this.drawRoundBanner(cellLeft(r), cellW, roundLabel(r, rounds), false);
    }
    this.drawRoundBanner(cellLeft(cols - 1), cellW, "Champion", true);

    // --- CONNECTING LINES (drawn beneath the cells) ---
    for (let r = 0; r < rounds; r++) {
      const matches = bracket.rounds[r];
      const count = matches.length;
      for (let m = 0; m < count; m++) {
        const childY = centerY(m, count);
        const decided = matches[m].winner !== null;
        const targetCol = r + 1;
        const targetCount = r + 1 < rounds ? bracket.rounds[r + 1].length : 1;
        const targetSlot = Math.floor(m / 2);
        const targetY = centerY(targetSlot, targetCount);
        this.drawConnector(cellRight(r), childY, cellLeft(targetCol), targetY, decided);
      }
    }

    // --- MATCH CELLS ---
    for (let r = 0; r < rounds; r++) {
      const matches = bracket.rounds[r];
      const count = matches.length;
      for (let m = 0; m < count; m++) {
        const cy = centerY(m, count);
        const match = matches[m];
        const isYour = yourMatch != null && match.id === yourMatch.id;
        const isBrowsed = this.browse.round === r && this.browse.slot === m;
        this.drawMatchCell(match, cellLeft(r), cy - cellH / 2, cellW, cellH, own, isYour, isBrowsed);
      }
    }

    // --- CHAMPION SLOT (far-right column) ---
    this.drawChampionPedestal(cellLeft(cols - 1), centerY(0, 1), cellW, own);

    // record the browsed match for the card + input
    this.browsedMatch = this.matchAt(this.browse.round, this.browse.slot);

    // champion celebration overlay (over the dimmed bracket)
    if (isBracketComplete(bracket)) {
      this.drawChampionOverlay(cfg.tournament.champion ?? null, own);
    }

    this.layoutCard();
  }

  /** Registration has no bracket yet; show its entrants instead of an empty board. */
  private layoutRegistration(cfg: TournamentBracketConfig): void {
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const t = cfg.tournament;
    const panelX = 12;
    const panelY = 34;
    const panelW = w - panelX * 2;
    const panelH = h - BOTTOM_CARD_H - panelY - 7;
    this.plate(this.nodes, panelX, panelY, panelW, panelH, { fill: 0x0d1836, border: GOLD, borderW: 1.4 });

    const heading = addTextObject(w / 2, panelY + 7, "REGISTRATION OPEN", TextStyle.WINDOW, { fontSize: "40px" });
    heading.setOrigin(0.5, 0);
    heading.setTint(GOLD);
    this.container.add(heading);
    this.nodes.push(heading);

    const count = addTextObject(
      w / 2,
      panelY + 19,
      `${t.entrantCount}/${t.maxEntrants} players registered`,
      TextStyle.PARTY,
      { fontSize: "30px" },
    );
    count.setOrigin(0.5, 0);
    count.setTint(SUBTLE);
    this.container.add(count);
    this.nodes.push(count);

    const schedule =
      t.closeAt == null
        ? "Bracket starts when registration closes."
        : `Registration closes ${formatDeadline(t.closeAt, cfg.now)}.`;
    const scheduleText = addTextObject(w / 2, panelY + 29, schedule, TextStyle.PARTY, { fontSize: "26px" });
    scheduleText.setOrigin(0.5, 0);
    scheduleText.setTint(TODO);
    this.container.add(scheduleText);
    this.nodes.push(scheduleText);

    const visibleEntrants = t.entrants.slice(0, 8);
    const columns = 2;
    const gap = 6;
    const rowH = 12;
    const colW = (panelW - 12 - gap) / columns;
    const listY = panelY + 41;
    visibleEntrants.forEach((entrant, index) => {
      const col = index % columns;
      const row = Math.floor(index / columns);
      const x = panelX + 6 + col * (colW + gap);
      const y = listY + row * rowH;
      const own = entrant.participant === cfg.ownParticipant;
      this.plate(this.nodes, x, y, colW, rowH - 1, {
        fill: own ? 0x203768 : PLATE,
        border: own ? NEXT : GOLD_DEEP,
        borderAlpha: own ? 1 : 0.65,
      });
      this.drawTrainerIcon(x + 7, y + rowH - 2, rowH - 3, entrant.ghost?.spriteKey ?? null, {
        dim: false,
        empty: false,
      });
      const name = addTextObject(x + 15, y + (rowH - 1) / 2, entrant.name, TextStyle.WINDOW, { fontSize: "27px" });
      name.setOrigin(0, 0.5);
      name.setTint(own ? NEXT : WHITE);
      this.container.add(name);
      this.nodes.push(name);
      this.fitText(name, colW - 19);
    });

    if (t.entrants.length > visibleEntrants.length) {
      const more = addTextObject(
        w / 2,
        panelY + panelH - 8,
        `+${t.entrants.length - visibleEntrants.length} more registered`,
        TextStyle.PARTY,
        { fontSize: "24px" },
      );
      more.setOrigin(0.5, 0);
      more.setTint(TODO);
      this.container.add(more);
      this.nodes.push(more);
    }
  }

  /**
   * P3 PAGINATED layout (32/64 fields). Renders ONE bracket SECTION (half for 32, quadrant for 64):
   * its round-0..convergence columns at the readable single-tree density, plus a compact FINALS
   * column (the shared downstream rounds + champion), a mini-overview strip showing the current
   * section, and the your-match card pinned at the bottom regardless of page.
   */
  private layoutPaginated(cfg: TournamentBracketConfig, bracket: BracketView): void {
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const sectionCount = this.sectionCount();
    const convRound = this.convergeRound();
    const cols = convRound + 2; // section rounds 0..convRound + the finals/champion column
    const marginX = 5;
    const areaTop = 43;
    const areaBottom = h - BOTTOM_CARD_H - 6;
    const areaH = areaBottom - areaTop;
    const colW = (w - 2 * marginX) / cols;
    const cellW = colW - 6;
    const cellLeft = (c: number) => marginX + c * colW + 3;
    const cellRight = (c: number) => cellLeft(c) + cellW;
    const n0 = this.perSectionRound0();
    const centerY = (localM: number, count: number) => areaTop + ((localM + 0.5) * areaH) / count;
    const cellH = Phaser.Math.Clamp(areaH / n0 - 3, 13, 22);

    const own = cfg.ownParticipant;
    const yourMatch = nextMatchFor(bracket, own);

    // mini-overview strip (which section you are viewing + L/R hint + your-section marker)
    this.drawSectionStrip(w, sectionCount, yourMatch);

    // round-column banners for the section, then the Finals column
    for (let r = 0; r <= convRound; r++) {
      this.drawRoundBanner(cellLeft(r), cellW, roundLabel(r, bracket.rounds.length), false, 33);
    }
    this.drawRoundBanner(cellLeft(cols - 1), cellW, "Finals", true, 33);

    // connecting lines within the section (elbow joins), converging into the Finals column
    for (let r = 0; r <= convRound; r++) {
      const { lo } = this.sectionSlotRange(this.section, r);
      const count = n0 >> r;
      for (let localM = 0; localM < count; localM++) {
        const match = bracket.rounds[r][lo + localM];
        const childY = centerY(localM, count);
        const decided = match.winner !== null;
        if (r < convRound) {
          const targetY = centerY(Math.floor(localM / 2), count / 2);
          this.drawConnector(cellRight(r), childY, cellLeft(r + 1), targetY, decided);
        } else {
          this.drawConnector(cellRight(r), childY, cellLeft(cols - 1), centerY(0, 1), decided);
        }
      }
    }

    // section match cells
    this.browsedMatch = null;
    for (let r = 0; r <= convRound; r++) {
      const { lo } = this.sectionSlotRange(this.section, r);
      const count = n0 >> r;
      for (let localM = 0; localM < count; localM++) {
        const gSlot = lo + localM;
        const match = bracket.rounds[r][gSlot];
        const cy = centerY(localM, count);
        const isYour = yourMatch != null && match.id === yourMatch.id;
        const isBrowsed = this.browse.round === r && this.browse.slot === gSlot;
        if (isBrowsed) {
          this.browsedMatch = match;
        }
        this.drawMatchCell(match, cellLeft(r), cy - cellH / 2, cellW, cellH, own, isYour, isBrowsed);
      }
    }

    // the compact FINALS column (shared downstream rounds + champion pedestal)
    this.drawFinalsColumn(cellLeft(cols - 1), cellW, bracket, convRound, own, yourMatch);

    if (this.browsedMatch == null) {
      this.browsedMatch = this.matchAt(this.browse.round, this.browse.slot);
    }

    if (isBracketComplete(bracket)) {
      this.drawChampionOverlay(cfg.tournament.champion ?? null, own);
    }

    this.layoutCard();
  }

  /** The mini-overview strip: one segment per section, current gold-lit, your section star-marked. */
  private drawSectionStrip(w: number, sectionCount: number, yourMatch: BracketMatchView | null): void {
    const y = 24;
    const stripH = 8;
    const segW = 22;
    const gap = 3;
    const total = sectionCount * segW + (sectionCount - 1) * gap;
    const startX = (w - total) / 2;
    const yourSection = yourMatch == null ? -1 : this.sectionOfMatch(yourMatch.round, yourMatch.slot);
    const sectionName = (i: number): string => (sectionCount === 2 ? (i === 0 ? "TOP" : "BOT") : `Q${i + 1}`);
    for (let i = 0; i < sectionCount; i++) {
      const x = startX + i * (segW + gap);
      const cur = i === this.section;
      this.plate(this.nodes, x, y, segW, stripH, {
        fill: cur ? 0x2a2410 : HEADER_FILL,
        border: cur ? GOLD : GOLD_DEEP,
        borderW: cur ? 1.3 : 0.8,
        borderAlpha: cur ? 1 : 0.6,
      });
      const label = `${sectionName(i)}${i === yourSection ? "*" : ""}`;
      const t = addTextObject(x + segW / 2, y + 1, label, TextStyle.PARTY, { fontSize: "20px" });
      t.setOrigin(0.5, 0);
      t.setTint(cur ? GOLD : i === yourSection ? NEXT : SUBTLE);
      this.container.add(t);
      this.nodes.push(t);
    }
    // L / R page hints flanking the strip
    const lh = addTextObject(startX - 5, y + 1, "◄L", TextStyle.PARTY, { fontSize: "20px" });
    lh.setOrigin(1, 0);
    lh.setTint(this.section > 0 ? GOLD : LINE_DIM);
    const rh = addTextObject(startX + total + 5, y + 1, "R►", TextStyle.PARTY, { fontSize: "20px" });
    rh.setOrigin(0, 0);
    rh.setTint(this.section < sectionCount - 1 ? GOLD : LINE_DIM);
    this.container.add(lh);
    this.container.add(rh);
    this.nodes.push(lh, rh);
  }

  /** True if `section`'s convergence winner feeds the downstream match at (round dr, slot m). */
  private downstreamFedBySection(dr: number, m: number, section: number, convRound: number): boolean {
    return Math.floor(section / 2 ** (dr - convRound)) === m;
  }

  /** The compact Finals column: shared downstream rounds (semis/final) stacked + champion pedestal. */
  private drawFinalsColumn(
    x: number,
    cw: number,
    bracket: BracketView,
    convRound: number,
    own: string,
    yourMatch: BracketMatchView | null,
  ): void {
    const h = globalScene.scaledCanvas.height;
    const areaTop = 43;
    const areaBottom = h - BOTTOM_CARD_H - 6;
    const champH = 30;
    const dsTop = areaTop;
    const dsBottom = areaBottom - champH - 4;
    const items: { dr: number; m: number }[] = [];
    for (let dr = convRound + 1; dr < bracket.rounds.length; dr++) {
      for (let m = 0; m < bracket.rounds[dr].length; m++) {
        items.push({ dr, m });
      }
    }
    const ch = 16;
    const slotGap = items.length > 0 ? (dsBottom - dsTop - items.length * ch) / (items.length + 1) : 0;
    let yy = dsTop + Math.max(0, slotGap);
    for (const it of items) {
      const match = bracket.rounds[it.dr][it.m];
      const isYour = yourMatch != null && match.id === yourMatch.id;
      this.drawMatchCell(match, x, yy, cw, ch, own, isYour, false);
      // ring only the IMMEDIATE downstream match this section feeds (its convergence target),
      // so the viewer sees where their half/quadrant lands without over-marking the whole path.
      if (it.dr === convRound + 1 && this.downstreamFedBySection(it.dr, it.m, this.section, convRound)) {
        const ring = globalScene.add.rectangle(x - 1.5, yy - 1.5, cw + 3, ch + 3, WHITE, 0).setOrigin(0, 0);
        ring.setStrokeStyle(1, NEXT, 0.85);
        this.container.add(ring);
        this.nodes.push(ring);
      }
      yy += ch + slotGap;
    }
    this.drawChampionPedestal(x, areaBottom - champH / 2, cw, own);
  }

  /** A small gold-accented banner over a round column. */
  private drawRoundBanner(x: number, cw: number, label: string, champion: boolean, yOverride?: number): void {
    const y = yOverride ?? 23;
    const bw = Math.min(cw, 58);
    const bx = x + (cw - bw) / 2;
    this.plate(this.nodes, bx, y, bw, 8, {
      fill: champion ? 0x2a2410 : HEADER_FILL,
      border: champion ? GOLD : GOLD_DEEP,
      borderW: champion ? 1.2 : 0.9,
      borderAlpha: champion ? 1 : 0.7,
    });
    const t = addTextObject(x + cw / 2, y + 1.5, label, TextStyle.PARTY, { fontSize: "22px" });
    t.setOrigin(0.5, 0);
    t.setTint(champion ? GOLD : SUBTLE);
    this.container.add(t);
    this.nodes.push(t);
  }

  /** A bracket elbow connector: child stub -> mid vertical -> parent stub, with clean joins. */
  private drawConnector(
    childRight: number,
    childY: number,
    parentLeft: number,
    parentY: number,
    strong: boolean,
  ): void {
    const color = strong ? GOLD : LINE_DIM;
    const midX = Math.round((childRight + parentLeft) / 2);
    const th = strong ? 1.6 : 1.1;
    const alpha = strong ? 0.95 : 0.6;
    const add = (x: number, y: number, ww: number, hh: number) => {
      const r = globalScene.add.rectangle(x, y, Math.max(1, ww), Math.max(1, hh), color, alpha).setOrigin(0, 0.5);
      this.container.add(r);
      this.nodes.push(r);
      return r;
    };
    // horizontal stub out of the child
    add(childRight, childY, midX - childRight, th);
    // vertical riser at the mid column
    const y0 = Math.min(childY, parentY);
    const y1 = Math.max(childY, parentY);
    const v = globalScene.add.rectangle(midX - th / 2, y0, th, Math.max(1, y1 - y0), color, alpha).setOrigin(0, 0);
    this.container.add(v);
    this.nodes.push(v);
    // horizontal stub into the parent
    add(midX, parentY, parentLeft - midX, th);
    // join dots (a small square where the stub meets the riser + enters the parent)
    const dot = (cx: number, cy: number) => {
      const d = globalScene.add.rectangle(cx, cy, th + 1.4, th + 1.4, color, alpha).setOrigin(0.5, 0.5);
      this.container.add(d);
      this.nodes.push(d);
    };
    dot(midX, childY);
    dot(parentLeft, parentY);
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
    // the plate
    this.plate(this.nodes, x, y, cw, ch, {
      fill: isYour ? 0x1a2c5e : PLATE,
      border: isYour ? GOLD : GOLD_DEEP,
      borderW: isYour ? 1.3 : 0.9,
      borderAlpha: isYour ? 1 : 0.75,
    });

    // YOUR next fight: persistent gold glow border.
    if (isYour) {
      const glow = globalScene.add.rectangle(x - 1.5, y - 1.5, cw + 3, ch + 3, WHITE, 0).setOrigin(0, 0);
      glow.setStrokeStyle(1, GOLD, 0.9);
      this.container.add(glow);
      this.nodes.push(glow);
    }
    // Browse cursor: a cyan ring around the currently-inspected match.
    if (isBrowsed) {
      const cur = globalScene.add.rectangle(x - 2.5, y - 2.5, cw + 5, ch + 5, WHITE, 0).setOrigin(0, 0);
      cur.setStrokeStyle(1, NEXT, 1);
      this.container.add(cur);
      this.nodes.push(cur);
    }

    const half = ch / 2;
    // divider between the two slots
    const div = globalScene.add.rectangle(x + 2, y + half, cw - 4, 0.8, GOLD_DEEP, 0.4).setOrigin(0, 0.5);
    this.container.add(div);
    this.nodes.push(div);

    const emptyLabel = match.round === 0 ? "bye" : "TBD";
    // P3: a KICKED entrant renders as eliminated (dim + X) even while their match is still pending
    // (waiting for a not-yet-decided opponent) — folded into the loser rendering path.
    const bracket = this.config?.tournament.bracket;
    const aKicked = bracket != null && match.a !== match.winner && isKickedParticipant(bracket, match.a);
    const bKicked = bracket != null && match.b !== match.winner && isKickedParticipant(bracket, match.b);
    const aLoser = (match.winner !== null && match.a !== null && match.a !== match.winner) || aKicked;
    const bLoser = (match.winner !== null && match.b !== null && match.b !== match.winner) || bKicked;
    const full = isYour || isBrowsed;
    this.drawSlot(match.a, match.winner, own, x, y, cw, half, emptyLabel, aLoser, full);
    this.drawSlot(match.b, match.winner, own, x, y + half, cw, half, emptyLabel, bLoser, full);

    // VS badge on the right edge — only for a LIVE pairing (both present, undecided).
    if ((isYour || isBrowsed) && match.a != null && match.b != null && match.winner == null) {
      this.drawVsBadge(x + cw - 1, y + half, isYour);
    }
  }

  /** A small gold/cyan VS badge (a bordered navy pill) anchored at (rightX, cy). */
  private drawVsBadge(rightX: number, cy: number, gold: boolean): void {
    const col = gold ? GOLD : NEXT;
    const bw = 12;
    const bh = 8;
    const bx = rightX - bw + 2;
    const by = cy - bh / 2;
    const badge = globalScene.add.rectangle(bx, by, bw, bh, CHIP_NAVY, 1).setOrigin(0, 0);
    badge.setStrokeStyle(1, col, 1);
    this.container.add(badge);
    this.nodes.push(badge);
    const t = addTextObject(bx + bw / 2, cy, "VS", TextStyle.WINDOW, { fontSize: "20px" });
    t.setOrigin(0.5, 0.5);
    t.setTint(col);
    this.container.add(t);
    this.nodes.push(t);
  }

  private drawSlot(
    participant: string | null,
    winner: string | null,
    own: string,
    x: number,
    y: number,
    cw: number,
    sh: number,
    emptyLabel: string,
    isLoser: boolean,
    full: boolean,
  ): void {
    const isEmpty = participant === null;
    const isWinner = participant !== null && participant === winner;
    const isOwn = participant === own;

    // winner accent bar down the slot's left edge
    if (isWinner) {
      const bar = globalScene.add.rectangle(x + 1, y + 1, 1.6, sh - 2, GOLD, 0.9).setOrigin(0, 0);
      this.container.add(bar);
      this.nodes.push(bar);
    }

    const iconH = Math.max(7, Math.min(sh - 1, 14));
    const iconCx = x + 4 + iconH * 0.42;
    const iconTop = y + (sh - iconH) / 2;
    const spriteKey = isEmpty ? null : (this.entrantOf(participant)?.ghost?.spriteKey ?? null);
    this.drawTrainerIcon(iconCx, iconTop + iconH, iconH, spriteKey, { dim: isLoser, empty: isEmpty });

    const seed = this.seedOf(participant);
    let textX = x + 5 + iconH * 0.9;
    // gold SEED chip
    if (!isEmpty && seed != null) {
      const chipW = seed >= 10 ? 11 : 8;
      const chipH = Math.min(7, sh - 2);
      const chipY = y + (sh - chipH) / 2;
      const chip = globalScene.add.rectangle(textX, chipY, chipW, chipH, isLoser ? BYE : GOLD, 1).setOrigin(0, 0);
      chip.setStrokeStyle(0.6, GOLD_DEEP, 0.9);
      this.container.add(chip);
      this.nodes.push(chip);
      const st = addTextObject(textX + chipW / 2, y + sh / 2, String(seed), TextStyle.WINDOW, { fontSize: "20px" });
      st.setOrigin(0.5, 0.5);
      st.setTint(CHIP_NAVY);
      this.container.add(st);
      this.nodes.push(st);
      textX += chipW + 2;
    }

    const nm = isEmpty ? emptyLabel : this.displayName(participant);
    const t = addTextObject(textX, y + sh / 2, nm, TextStyle.WINDOW, { fontSize: "26px" });
    t.setOrigin(0, 0.5);
    t.setTint(isWinner ? GOLD : isEmpty ? BYE : isLoser ? BYE : isOwn ? NEXT : WHITE);
    if (isLoser) {
      t.setAlpha(0.55);
    }
    this.container.add(t);
    this.nodes.push(t);
    // truncate the name to the plate; the browsed/your card shows a bit more room
    const maxNameW = x + cw - 3 - textX - (full ? 12 : 3);
    this.fitText(t, maxNameW);

    // eliminated: a red X over the icon.
    if (isLoser) {
      const cross = addTextObject(iconCx, y + sh / 2, "x", TextStyle.WINDOW, { fontSize: "30px" });
      cross.setOrigin(0.5, 0.5);
      cross.setTint(ELIM_RED);
      this.container.add(cross);
      this.nodes.push(cross);
    }
  }

  /** Trim a text object with an ellipsis until it fits `maxW` logical px. */
  private fitText(t: Phaser.GameObjects.Text, maxW: number): void {
    if (maxW <= 0 || t.displayWidth <= maxW) {
      return;
    }
    const full = t.text;
    let s = full;
    while (s.length > 1 && t.displayWidth > maxW) {
      s = s.slice(0, -1);
      t.setText(`${s}…`);
    }
  }

  /** The far-right champion pedestal: the gold trophy over a plinth + (once decided) the champ. */
  private drawChampionPedestal(x: number, cy: number, cw: number, _own: string): void {
    const bracket = this.config?.tournament.bracket;
    const champ = bracket ? (isBracketComplete(bracket) ? (this.config?.tournament.champion ?? null) : null) : null;
    const plinthH = 30;
    const y = cy - plinthH / 2;
    this.plate(this.nodes, x, y, cw, plinthH, { fill: 0x201a34, border: GOLD, borderW: 1.4 });

    // trophy at the top of the plinth
    if (globalScene.textures.exists("er_pwt_trophy")) {
      const trophy = globalScene.add
        .image(x + cw / 2, y + 3, "er_pwt_trophy")
        .setOrigin(0.5, 0)
        .setScale(12 / 62);
      this.container.add(trophy);
      this.nodes.push(trophy);
    } else {
      const cup = globalScene.add.ellipse(x + cw / 2, y + 8, 10, 8, GOLD, 1).setOrigin(0.5, 0.5);
      this.container.add(cup);
      this.nodes.push(cup);
    }

    // champion identity row (icon + name) or TBD
    const iconH = 12;
    const rowY = y + plinthH - 10;
    const spriteKey = champ ? (this.entrantOf(champ)?.ghost?.spriteKey ?? null) : null;
    if (champ != null) {
      this.drawTrainerIcon(x + 4 + iconH * 0.42, rowY + iconH / 2, iconH, spriteKey, { dim: false, empty: false });
    }
    const label = champ ? this.displayName(champ) : "TBD";
    const t = addTextObject(champ ? x + 4 + iconH : x + cw / 2, rowY, label, TextStyle.WINDOW, { fontSize: "24px" });
    t.setOrigin(champ ? 0 : 0.5, 0);
    t.setTint(champ ? GOLD : TODO);
    this.container.add(t);
    this.nodes.push(t);
    if (champ != null) {
      this.fitText(t, x + cw - 3 - (x + 4 + iconH));
    }
  }

  /**
   * Draw a small trainer icon at (cx, feetY) of the given height, or a neutral framed fallback
   * avatar. Two-pass-harness friendly: `add.sprite(key)` is called even when the texture is
   * missing so pass 1 RECORDS the key for injection; if it stays unresolved we drop the probe
   * and draw the fallback disc.
   */
  private drawTrainerIcon(
    cx: number,
    feetY: number,
    iconH: number,
    spriteKey: string | null,
    opts: { dim: boolean; empty: boolean },
  ): void {
    // framed disc behind the icon (navy well + gold ring) — reads as a portrait mount.
    const cyMid = feetY - iconH / 2;
    const well = globalScene.add.ellipse(cx, cyMid, iconH * 0.95, iconH * 1.02, 0x0c1738, 0.9);
    well.setStrokeStyle(0.8, opts.dim ? BYE : GOLD_DEEP, opts.dim ? 0.5 : 0.85);
    well.setOrigin(0.5, 0.5);
    if (opts.dim) {
      well.setAlpha(0.55);
    }
    this.container.add(well);
    this.nodes.push(well);

    if (spriteKey) {
      const probe = globalScene.add.sprite(cx, feetY, spriteKey);
      if (globalScene.textures.exists(spriteKey)) {
        probe.setFrame(0);
        const fh = probe.height || 64;
        probe.setOrigin(0.5, 1);
        probe.setScale((iconH * 1.05) / fh);
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
    // fallback: a filled inner disc (empty slots read dimmer).
    const disc = globalScene.add.ellipse(cx, cyMid, iconH * 0.6, iconH * 0.7, opts.empty ? 0x2a3352 : 0x3a4a7a, 1);
    disc.setOrigin(0.5, 0.5);
    if (opts.dim) {
      disc.setAlpha(0.5);
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
    const scrim = globalScene.add.rectangle(0, 22, w, h - 22 - BOTTOM_CARD_H - 4, 0x040814, 0.72).setOrigin(0, 0);
    this.container.add(scrim);
    this.nodes.push(scrim);

    const spriteKey = champion ? (this.entrantOf(champion)?.ghost?.spriteKey ?? null) : null;
    const artH = 80;
    const cx = w / 2;
    const feetY = 34 + artH;

    // twin crests flanking the trophy
    if (globalScene.textures.exists("er_pwt_trophy")) {
      const trophy = globalScene.add
        .image(cx, 26, "er_pwt_trophy")
        .setOrigin(0.5, 0)
        .setScale(20 / 62);
      this.container.add(trophy);
      this.nodes.push(trophy);
    }

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

    // gold banner plate with the champion name
    const bannerW = 150;
    const bannerY = feetY + 3;
    this.plate(this.nodes, cx - bannerW / 2, bannerY, bannerW, 15, { fill: 0x241d0a, border: GOLD, borderW: 1.6 });
    const banner = addTextObject(cx, bannerY + 3, `CHAMPION - ${this.displayName(champion)}`, TextStyle.WINDOW, {
      fontSize: "40px",
    });
    banner.setOrigin(0.5, 0);
    banner.setTint(GOLD);
    this.container.add(banner);
    this.nodes.push(banner);
    this.fitText(banner, bannerW - 8);
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
    this.playableMatchId = null;
    this.playableAction = null;
    // Default the hint to the far-right edge; the opponent card (which frames a portrait
    // there) shifts it left so it never collides with the portrait + presence chip.
    this.cardHint.setX(globalScene.scaledCanvas.width - 12);
    // CANCELLED state (P3 scenario 4): the board reads cancelled regardless of any bracket.
    if (cfg != null && cfg.tournament.state === "cancelled") {
      this.cardTitle.setTint(ELIM_RED);
      this.cardTitle.setText("TOURNAMENT CANCELLED");
      this.cardBody.setTint(SUBTLE);
      this.cardBody.setText("This tournament was cancelled by the organizer.");
      this.cardHint.setText("B: Back");
      return;
    }
    if (cfg == null) {
      this.cardTitle.setText("");
      this.cardBody.setText("");
      this.cardHint.setText("B: Back");
      return;
    }
    if (cfg.tournament.bracket == null) {
      const registration = cfg.tournament.state === "registration";
      this.cardTitle.setTint(registration ? GOLD : TODO);
      this.cardTitle.setText(registration ? "REGISTRATION OPEN" : "BRACKET PENDING");
      this.cardBody.setTint(SUBTLE);
      this.cardBody.setText(
        registration
          ? `${cfg.tournament.entrantCount}/${cfg.tournament.maxEntrants} entered. Bracket starts when registration closes.`
          : "The bracket is being prepared.",
      );
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

    // P3 PAGINATED: the your-match card is PINNED regardless of which section page you browse.
    if (this.sectionCount() > 1 && yourMatch != null) {
      const pinnedOpp = opponentOf(yourMatch, own);
      if (pinnedOpp == null) {
        this.cardTitle.setTint(NEXT);
        this.cardTitle.setText("YOUR NEXT MATCH");
        this.cardBody.setTint(WHITE);
        this.cardBody.setText(`Waiting for your opponent    ${formatDeadline(yourMatch.deadline, cfg.now)}`);
        this.cardHint.setText("B: Back");
      } else {
        this.drawOpponentCard(yourMatch, pinnedOpp);
      }
      return;
    }

    const isYourBrowsed = match != null && yourMatch != null && match.id === yourMatch.id;
    const opponent = isYourBrowsed ? opponentOf(match, own) : null;

    if (isYourBrowsed && opponent != null) {
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
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const cardY = h - BOTTOM_CARD_H - 2;
    const ent = this.entrantOf(opponent);
    const ownEnt = this.entrantOf(cfg.ownParticipant);
    const seed = ent?.seed ?? null;
    const oppName = this.displayName(opponent);
    const oppTitle = this.ghostTitleOf(opponent);

    // framed opponent portrait pinned to the far-right of the panel
    const spriteKey = ent?.ghost?.spriteKey ?? null;
    const portraitCx = w - 24;
    this.drawCardPortrait(spriteKey, portraitCx, cardY);

    this.cardTitle.setTint(NEXT);
    this.cardTitle.setText(`YOUR MATCH   vs ${seed == null ? "" : `#${seed} `}${oppName}`);

    const dueSoon = match.deadline != null && match.deadline - cfg.now <= 3_600_000;
    const countdown = formatDeadline(match.deadline, cfg.now);
    const present = isPresent(ent?.lastSeen, cfg.now);
    const ownReady = isEntrantReadyForMatch(ownEnt, match.id, opponent);
    const opponentReady = isEntrantReadyForMatch(ent, match.id, cfg.ownParticipant);
    const presence = opponentReady
      ? `${oppName} is ready`
      : present
        ? "Online now"
        : `Last seen ${formatLastSeen(ent?.lastSeen, cfg.now)}`;
    this.cardBody.setTint(dueSoon ? DUE_SOON : WHITE);
    const titlePart = oppTitle ? `"${oppTitle}"   ` : "";
    this.cardBody.setText(`${titlePart}${countdown}   ${presence}`);

    // presence chip above the portrait
    const chip = globalScene.add.rectangle(portraitCx, cardY + 2, 30, 8, CHIP_NAVY, 1).setOrigin(0.5, 0);
    chip.setStrokeStyle(1, opponentReady || present ? PRESENT_GREEN : TODO, 1);
    this.container.add(chip);
    this.cardNodes.push(chip);
    const chipT = addTextObject(
      portraitCx,
      cardY + 3.5,
      opponentReady ? "READY" : present ? "ONLINE" : "OFFLINE",
      TextStyle.PARTY,
      { fontSize: "22px" },
    );
    chipT.setOrigin(0.5, 0);
    chipT.setTint(opponentReady || present ? PRESENT_GREEN : TODO);
    this.container.add(chipT);
    this.cardNodes.push(chipT);

    this.playableOpponent = opponent;
    this.playableMatchId = match.id;
    this.playableAction = ownReady && opponentReady ? "join" : ownReady ? "unready" : "ready";
    // Match action prompt, shifted LEFT of the portrait so nothing overlaps.
    this.cardHint.setX(portraitCx - 24);
    this.cardHint.setTint(this.playableAction === "join" ? GOLD : NEXT);
    this.cardHint.setText(
      this.playableAction === "join"
        ? "A: JOIN   B: Back"
        : this.playableAction === "unready"
          ? "A: NOT READY   B: Back"
          : "A: I'M READY   B: Back",
    );
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
      // P2/P3: annotate an advance that happened WITHOUT a played match (walkover / activity / seed / bye).
      const auto = autoResolutionLabel(match.resolution);
      status =
        auto == null
          ? `Winner: ${this.displayName(match.winner)}`
          : `Winner: ${this.displayName(match.winner)} (${auto})`;
    } else if (match.a != null && match.b != null) {
      status = `In progress   ${formatDeadline(match.deadline, cfg.now)}`;
    } else {
      status = "Awaiting entrants";
    }
    this.cardBody.setText(`${label(a, emptyLabel)}  vs  ${label(b, emptyLabel)}    ${status}`);
    this.cardHint.setTint(GOLD);
    this.cardHint.setText("B: Back");
  }

  /** A framed opponent portrait on the card (right side), probe + fallback discipline. */
  private drawCardPortrait(spriteKey: string | null, cx: number, cardY: number): void {
    const artH = 26;
    const feetY = cardY + BOTTOM_CARD_H - 3;
    const cyMid = feetY - artH / 2;
    // portrait well
    const well = globalScene.add.ellipse(cx, cyMid + 2, artH * 0.95, artH * 1.05, 0x0c1738, 0.95);
    well.setStrokeStyle(1, GOLD, 0.85);
    well.setOrigin(0.5, 0.5);
    this.container.add(well);
    this.cardNodes.push(well);
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
    const disc = globalScene.add.ellipse(cx, cyMid + 2, artH * 0.55, artH * 0.65, 0x394874, 1);
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
      const rounds = fresh.bracket?.rounds;
      if (rounds != null) {
        this.browse.round = Math.min(this.browse.round, rounds.length - 1);
        this.browse.slot = Math.min(this.browse.slot, (rounds[this.browse.round]?.length ?? 1) - 1);
      }
      this.title.setText(fresh.name);
      this.updateHeaderStatus();
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
        if (this.playableOpponent != null && this.playableMatchId != null) {
          if (this.playableAction === "join") {
            globalScene.ui.playSelect();
            this.stopPolling();
            cfg.onPlayMatch(this.playableMatchId, this.playableOpponent);
            return true;
          }
          if (this.playableAction != null && cfg.onReadyChange != null) {
            globalScene.ui.playSelect();
            this.stopPolling();
            cfg.onReadyChange(this.playableMatchId, this.playableAction === "ready");
            return true;
          }
        }
        return false;
      case Button.MENU: {
        const hasOpenMatch =
          cfg.tournament.bracket != null && nextMatchFor(cfg.tournament.bracket, cfg.ownParticipant) != null;
        if (
          cfg.onDropOut != null
          && (cfg.tournament.state === "registration" || (cfg.tournament.state === "in_progress" && hasOpenMatch))
          && cfg.tournament.entrants.some(e => e.participant === cfg.ownParticipant)
          && !isKickedParticipant(cfg.tournament.bracket ?? { size: 0, rounds: [] }, cfg.ownParticipant)
        ) {
          globalScene.ui.playSelect();
          this.stopPolling();
          cfg.onDropOut();
          return true;
        }
        return false;
      }
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
    if (this.sectionCount() > 1) {
      return this.moveBrowsePaginated(button);
    }
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

  /**
   * Paginated browse (P3): UP/DOWN move slots within the current section column; LEFT/RIGHT move
   * between the section's round columns and, at the section's horizontal edges, PAGE to the
   * previous/next section (L/R pages between sections, per the spec).
   */
  private moveBrowsePaginated(button: Button): boolean {
    const convRound = this.convergeRound();
    const sectionCount = this.sectionCount();
    let { round, slot } = this.browse;
    let section = this.section;
    const clampToSection = (r: number): { lo: number; hi: number } => this.sectionSlotRange(section, r);

    if (button === Button.UP || button === Button.DOWN) {
      const { lo, hi } = clampToSection(round);
      slot = Phaser.Math.Clamp(slot + (button === Button.DOWN ? 1 : -1), lo, hi);
    } else if (button === Button.RIGHT) {
      if (round < convRound) {
        round++;
      } else if (section < sectionCount - 1) {
        section++;
        round = 0;
      } else {
        return false;
      }
      slot = clampToSection(round).lo;
    } else {
      // LEFT
      if (round > 0) {
        round--;
      } else if (section > 0) {
        section--;
        round = 0;
      } else {
        return false;
      }
      slot = clampToSection(round).lo;
    }
    if (round === this.browse.round && slot === this.browse.slot && section === this.section) {
      return false;
    }
    this.browse = { round, slot };
    this.section = section;
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
// the two-pass injector then loads it), plus HONEST field mapping that mirrors the
// live worker row: `participant`/`name` is the account USERNAME (what the board
// shows), while the ghost summary carries a DISTINCT authored name + title (flavor
// only, surfaced on the opponent card). This keeps the goldens honest about the
// name path — the board must render the username, never the ghost name.
// =============================================================================

import { resolveGhostSpriteKey } from "#data/elite-redux/showdown/tournament-ghost-icon";
import { trainerConfigs } from "#data/trainers/trainer-config";
import { TrainerType } from "#enums/trainer-type";

interface DemoOpts {
  size: 4 | 8 | 16 | 32 | 64;
  /** Settle this many full early rounds (top seed wins) — legacy coarse control. */
  advancedRounds?: number;
  /** Force a bye field (odd count). */
  byes?: boolean;
  /** The bottom-card state to surface. */
  card?: "playable" | "waiting" | "dueSoon" | "champion" | "none";
  /** Put the browse cursor on a match that is NOT the viewer's (pairing-card golden). */
  browseOther?: boolean;
  /** P3: force the initial section page (32/64 pagination goldens). */
  browseSection?: number;
  /** The viewer loses their round-0 match (eliminated read-only view). */
  eliminated?: boolean;
  /** 4-field: settle only the OTHER semifinal (mid-round: advanced icon + dimmed loser). */
  resolvedSemi?: boolean;
  /** P2: settle the OTHER semifinal via a deadline ACTIVITY win (present player advances; pairing-card label). */
  activityWin?: boolean;
  /** P3: kick a non-viewer entrant mid-tournament (WALKOVER — opponent advances, kicked shown). */
  kick?: boolean;
  /** P3: render the tournament in the CANCELLED state (board shows cancelled). */
  cancelled?: boolean;
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
// Account USERNAMES (what the board renders) — realistic mixed-case handles.
const DEMO_USERNAMES = [
  "Carla",
  "AshK",
  "MistyW",
  "BrockH",
  "GaryO",
  "MayB",
  "DawnP",
  "IrisU",
  "CyrusT",
  "Cynthia",
  "LanceD",
  "StevenS",
  "WallaceM",
  "RedT",
  "BlueO",
  "LeafG",
];
// DISTINCT authored ghost display names (flavor; NOT shown as identity) + titles.
const DEMO_GHOST_NAMES = [
  "Sky Warden",
  "Emberfist",
  "Tidecaller",
  "Stoneheart",
  "Nightblade",
  "Petalstorm",
  "Frostpin",
  "Voltcrest",
  "Voidwalker",
  "Dragonsong",
  "Skyfury",
  "Ironclad",
  "Wavecrest",
  "Crimson",
  "Azure",
  "Verdant",
];
const DEMO_TITLES = ["The Bold", "Storm Caller", "Iron Will", "Trick Master", "", "Old Guard", "", "The Swift"];

function demoSpriteKey(i: number): string {
  const type = DEMO_TRAINER_TYPES[i % DEMO_TRAINER_TYPES.length];
  return trainerConfigs[type]?.getSpriteKey(false, false) ?? resolveGhostSpriteKey(null);
}

function makeBracketView(opts: DemoOpts, own: string, now: number): TournamentView {
  const n = opts.byes ? (opts.size === 8 ? 5 : opts.size === 16 ? 11 : 3) : opts.size;
  // Usernames + ghost names cycle synthetic handles past the 16 authored ones (32/64 fields).
  const username = (i: number): string => (i === 0 ? own : (DEMO_USERNAMES[i] ?? `Player${i + 1}`));
  const ghostName = (i: number): string => DEMO_GHOST_NAMES[i % DEMO_GHOST_NAMES.length];
  const entrants = Array.from({ length: n }, (_, i) => ({
    participant: username(i),
    // worker mirrors the account username into `name` — the board renders THIS.
    name: username(i),
    seed: i + 1,
    ghost: {
      spriteKey: demoSpriteKey(i),
      // DISTINCT authored ghost name (flavor only, never used as identity on the board).
      name: ghostName(i),
      ...(DEMO_TITLES[i % DEMO_TITLES.length] ? { title: DEMO_TITLES[i % DEMO_TITLES.length] } : {}),
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

  // P2 activity win: settle the NON-viewer semifinal via a deadline activity win (present player advances).
  if (opts.activityWin) {
    for (const match of rounds[0]) {
      if (match.winner === null && match.a && match.b && match.a !== own && match.b !== own) {
        // the LOWER seed advances "by activity" (they were present; presence beats seed) — the label is the point.
        feed(0, match.slot, seedOf(match.a) >= seedOf(match.b) ? (match.a as string) : (match.b as string), "activity");
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

  // P3 KICK (walkover): kick a non-viewer entrant whose round-0 match is unplayed — the opponent
  // advances by "walkover" and the kicked player is flagged for the board (rendered eliminated).
  const kicked: string[] = [];
  if (opts.kick) {
    const victimMatch = rounds[0].find(m => m.winner === null && m.a && m.b && m.a !== own && m.b !== own);
    if (victimMatch?.a && victimMatch.b) {
      const victim = victimMatch.b as string;
      const survivor = victimMatch.a as string;
      kicked.push(victim);
      victimMatch.winner = survivor;
      victimMatch.resolution = "walkover";
      if (victimMatch.round + 1 < roundsCount) {
        const parent = rounds[victimMatch.round + 1][Math.floor(victimMatch.slot / 2)];
        if (victimMatch.slot % 2 === 0) {
          parent.a = survivor;
        } else {
          parent.b = survivor;
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
    name:
      opts.size === 64
        ? "World Grand Prix"
        : opts.size === 32
          ? "Continental Masters"
          : opts.size === 16
            ? "Champions League"
            : opts.size === 4
              ? "Sample Cup"
              : "Spring Showdown Cup",
    organizer: "maintainer",
    state: opts.cancelled ? "cancelled" : opts.card === "champion" ? "complete" : "in_progress",
    roundWindowMs: 24 * 3_600_000,
    maxEntrants: opts.size,
    createdAt: now,
    startedAt: now,
    champion,
    entrantCount: n,
    entrants,
    bracket: { size, rounds, ...(kicked.length > 0 ? { kicked } : {}) },
  };
}

export function buildTournamentBracketDemoConfig(
  opts: DemoOpts = { size: 8, advancedRounds: 1, card: "playable" },
): TournamentBracketConfig {
  const own = "Carla";
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
  // P3: force a specific SECTION page (32/64 pagination goldens) — land on its first round-0 slot.
  if (opts.browseSection != null && tournament.bracket) {
    const perSection = tournament.bracket.size / 2 / (tournament.bracket.size === 32 ? 2 : 4);
    initialBrowse = { round: 0, slot: opts.browseSection * perSection };
  }
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
