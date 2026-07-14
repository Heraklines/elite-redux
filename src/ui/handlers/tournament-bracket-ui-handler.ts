/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown TOURNAMENTS — the BRACKET screen (Showdown Tournament P1). PWT-themed:
// the single-elimination tree (columns per round; mini avatar + name + seed chip
// per slot; byes and TBD marked; the winner of each match highlighted gold) plus
// the YOUR-NEXT-MATCH card (opponent, deadline countdown, a last-seen placeholder
// for P2) and, when the final is decided, a champion banner. ACTION on a playable
// own match enters the constrained tournament lobby against the bracket opponent.
// Pure presentation over the worker's authoritative bracket; no derived state.
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  type BracketMatchView,
  formatDeadline,
  isBracketComplete,
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
import { addWindow } from "#ui/ui-theme";

const GOLD = 0xf8d030;
const NEXT = 0x48c8f8;
const TODO = 0x8a93b4;
const BOARD = 0x0b1838;
const BYE = 0x5a6488;
const DUE_SOON = 0xf85040;

/** Config the caller passes to render the bracket. */
export interface TournamentBracketConfig {
  tournament: TournamentView;
  /** The viewer's account username. */
  ownParticipant: string;
  /** Epoch ms for the deadline countdown. */
  now: number;
  /** Enter the constrained tournament lobby for a playable own match. */
  onPlayMatch: (matchId: string, opponent: string) => void;
  /** Leave the bracket screen. */
  onBack: () => void;
}

function pwtPanel(x: number, y: number, w: number, h: number, button = false): Phaser.GameObjects.NineSlice {
  const key = button ? "er_pwt_button" : "er_pwt_panel";
  if (globalScene.textures.exists(key)) {
    const n = globalScene.add.nineslice(x, y, key, undefined, w, h, 4, 4, 4, 4);
    n.setOrigin(0, 0);
    return n;
  }
  return addWindow(x, y, w, h);
}

/**
 * A guaranteed-DARK navy content panel with a gold border. Used for the match cells
 * and the card so light text always contrasts — both in-game (navy chrome) and in the
 * headless render harness (where the CDN pwt chrome is absent and pwtPanel would fall
 * back to a LIGHT engine window that washes out white text).
 */
function darkPanel(x: number, y: number, w: number, h: number, color = 0x111a38): Phaser.GameObjects.Rectangle {
  const r = globalScene.add.rectangle(x, y, w, h, color, 0.94).setOrigin(0, 0);
  r.setStrokeStyle(1, GOLD, 0.7);
  return r;
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

  private config: TournamentBracketConfig | null = null;
  private playableMatch: BracketMatchView | null = null;
  private playableOpponent: string | null = null;

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
    // Optional PWT chrome overlay (border only) when the CDN texture is present.
    if (globalScene.textures.exists("er_pwt_panel")) {
      this.frame = pwtPanel(0, 0, w, h);
      this.container.add(this.frame);
    }

    this.title = addTextObject(10, 4, "", TextStyle.WINDOW, { fontSize: "38px" });
    this.title.setOrigin(0, 0);
    this.title.setTint(GOLD);
    this.container.add(this.title);

    // Bottom your-next-match card.
    const cardH = 34;
    const cardY = h - cardH - 4;
    this.cardPanel = darkPanel(7, cardY, w - 14, cardH, 0x0a1230);
    this.container.add(this.cardPanel);
    this.cardTitle = addTextObject(12, cardY + 3, "", TextStyle.WINDOW, { fontSize: "32px" });
    this.cardTitle.setOrigin(0, 0);
    this.cardTitle.setTint(NEXT);
    this.container.add(this.cardTitle);
    this.cardBody = addTextObject(12, cardY + 12, "", TextStyle.PARTY, { fontSize: "30px" });
    this.cardBody.setOrigin(0, 0);
    this.cardBody.setTint(0xffffff);
    this.container.add(this.cardBody);
    this.cardHint = addTextObject(w - 12, cardY + 3, "", TextStyle.PARTY, { fontSize: "30px" });
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
    this.layoutTree();
    this.layoutCard();
    this.container.setVisible(true);
    this.active = true;
    return true;
  }

  private seedOf(participant: string | null): number | null {
    if (participant == null || this.config == null) {
      return null;
    }
    return this.config.tournament.entrants.find(e => e.participant === participant)?.seed ?? null;
  }

  /** Draw the single-elimination tree: one column per round, matches spread evenly. */
  private layoutTree(): void {
    for (const n of this.nodes) {
      n.destroy();
    }
    this.nodes = [];
    const cfg = this.config;
    if (cfg == null || cfg.tournament.bracket == null) {
      return;
    }
    const bracket = cfg.tournament.bracket;
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const treeTop = 27;
    const treeBottom = h - 44;
    const treeH = treeBottom - treeTop;
    const rounds = bracket.rounds.length;
    const colW = (w - 14) / rounds;

    for (let r = 0; r < rounds; r++) {
      const matches = bracket.rounds[r];
      const count = matches.length;
      const x = 8 + r * colW;

      // round header (below the title band)
      const rl = addTextObject(x + colW / 2, 18, roundLabel(r, rounds), TextStyle.PARTY, { fontSize: "26px" });
      rl.setOrigin(0.5, 0);
      rl.setTint(TODO);
      this.container.add(rl);
      this.nodes.push(rl);

      const cellH = Math.min(20, treeH / count - 2);
      for (let m = 0; m < count; m++) {
        const centerY = treeTop + ((m + 0.5) * treeH) / count;
        this.drawMatchCell(matches[m], x + 2, centerY - cellH / 2, colW - 6, cellH, cfg.ownParticipant);
      }
    }
  }

  private drawMatchCell(match: BracketMatchView, x: number, y: number, cw: number, ch: number, own: string): void {
    const panel = darkPanel(x, y, cw, ch);
    this.container.add(panel);
    this.nodes.push(panel);
    const half = ch / 2;
    // A null slot is a BYE only in round 0 (top-seed auto-advance); in later rounds it is TBD.
    const emptyLabel = match.round === 0 ? "(bye)" : "TBD";
    this.drawSlot(match.a, match.winner, own, x + 2, y + 1, half - 1, emptyLabel);
    this.drawSlot(match.b, match.winner, own, x + 2, y + half, half - 1, emptyLabel);
  }

  private drawSlot(
    participant: string | null,
    winner: string | null,
    own: string,
    x: number,
    y: number,
    sh: number,
    emptyLabel: string,
  ): void {
    // mini avatar placeholder (P2: real team mini icon / last-seen)
    const isEmpty = participant === null;
    const dotColor = isEmpty ? BYE : participant === own ? NEXT : 0x9aa4c8;
    const dot = globalScene.add.rectangle(x + 3, y + sh / 2, 4, 4, dotColor, 1).setOrigin(0.5);
    this.container.add(dot);
    this.nodes.push(dot);

    const seed = this.seedOf(participant);
    const label = isEmpty ? emptyLabel : `${seed == null ? "" : `#${seed} `}${participant}`;
    const isWinner = participant !== null && participant === winner;
    const t = addTextObject(x + 8, y, label, TextStyle.WINDOW, { fontSize: "28px" });
    t.setOrigin(0, 0);
    t.setTint(isWinner ? GOLD : isEmpty ? BYE : participant === own ? NEXT : 0xffffff);
    this.container.add(t);
    this.nodes.push(t);
  }

  /** Fill the your-next-match card + record the actionable match. */
  private layoutCard(): void {
    const cfg = this.config;
    this.playableMatch = null;
    this.playableOpponent = null;
    if (cfg == null || cfg.tournament.bracket == null) {
      this.cardTitle.setText("");
      this.cardBody.setText("");
      this.cardHint.setText("B: Back");
      return;
    }
    const bracket = cfg.tournament.bracket;

    if (isBracketComplete(bracket)) {
      const champ = cfg.tournament.champion;
      this.cardTitle.setTint(GOLD);
      this.cardTitle.setText("CHAMPION");
      this.cardBody.setText(champ ? `${champ} wins the tournament!` : "Tournament complete.");
      this.cardHint.setText("B: Back");
      return;
    }

    const next = nextMatchFor(bracket, cfg.ownParticipant);
    if (next == null) {
      this.cardTitle.setTint(TODO);
      this.cardTitle.setText("NO UPCOMING MATCH");
      this.cardBody.setText(
        cfg.tournament.entrants.some(e => e.participant === cfg.ownParticipant)
          ? "You are out of this tournament."
          : "You are not entered in this tournament.",
      );
      this.cardHint.setText("B: Back");
      return;
    }

    const opponent = opponentOf(next, cfg.ownParticipant);
    const countdown = formatDeadline(next.deadline, cfg.now);
    const dueSoon = next.deadline != null && next.deadline - cfg.now <= 3_600_000;
    this.cardTitle.setTint(NEXT);
    this.cardTitle.setText("YOUR NEXT MATCH");

    if (opponent == null) {
      // opponent not yet known (feeder undecided)
      this.cardBody.setText(`Waiting for your opponent    ${countdown}`);
      this.cardHint.setText("B: Back");
      return;
    }

    const seed = this.seedOf(opponent);
    this.cardBody.setTint(dueSoon ? DUE_SOON : 0xffffff);
    this.cardBody.setText(`vs ${seed == null ? "" : `#${seed} `}${opponent}   Last seen: --   ${countdown}`);
    this.playableMatch = next;
    this.playableOpponent = opponent;
    this.cardHint.setText("A: Play match    B: Back");
  }

  processInput(button: Button): boolean {
    const cfg = this.config;
    if (cfg == null) {
      return false;
    }
    switch (button) {
      case Button.ACTION:
        if (this.playableMatch != null && this.playableOpponent != null) {
          globalScene.ui.playSelect();
          cfg.onPlayMatch(this.playableMatch.id, this.playableOpponent);
          return true;
        }
        return false;
      case Button.CANCEL:
        globalScene.ui.playSelect();
        cfg.onBack();
        return true;
    }
    return false;
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    for (const n of this.nodes) {
      n.destroy();
    }
    this.nodes = [];
    this.config = null;
  }
}

// =============================================================================
// Demo config builders for the render harness (golden-gated states).
// =============================================================================

interface DemoOpts {
  size: 8 | 16;
  /** How far the bracket has progressed (rounds fully settled). */
  advancedRounds?: number;
  /** Force a bye field (odd count). */
  byes?: boolean;
  /** The your-next-match card state to surface. */
  card?: "playable" | "waiting" | "dueSoon" | "champion" | "none";
}

function makeBracketView(opts: DemoOpts, own: string): TournamentView {
  const n = opts.byes ? (opts.size === 8 ? 5 : 11) : opts.size;
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
  const entrants = Array.from({ length: n }, (_, i) => ({ participant: names[i], name: names[i], seed: i + 1 }));

  // Build a bracket structurally mirroring the worker engine (size rounds, byes to top seeds).
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
        deadline: 1_700_000_000_000 + (r + 1) * 24 * 3_600_000,
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
  // advance settled rounds (top seed wins each), leaving one own match live per card option
  const advance = opts.advancedRounds ?? 0;
  for (let r = 0; r < advance; r++) {
    for (const match of rounds[r]) {
      if (match.winner === null && match.a && match.b) {
        // lower seed (better) wins
        const sa = entrants.find(e => e.participant === match.a)?.seed ?? 99;
        const sb = entrants.find(e => e.participant === match.b)?.seed ?? 99;
        feed(r, match.slot, sa <= sb ? (match.a as string) : (match.b as string), "reported");
      }
    }
  }

  const champion = opts.card === "champion" ? own : null;
  if (opts.card === "champion") {
    // settle everything, own wins out
    for (let r = 0; r < roundsCount; r++) {
      for (const match of rounds[r]) {
        if (match.winner === null && match.a && match.b) {
          feed(r, match.slot, match.a === own || match.b === own ? own : (match.a as string), "reported");
        }
      }
    }
  }

  return {
    id: "demo",
    name: opts.size === 16 ? "Champions League" : "Spring Showdown Cup",
    organizer: "maintainer",
    state: opts.card === "champion" ? "complete" : "in_progress",
    roundWindowMs: 24 * 3_600_000,
    maxEntrants: opts.size,
    createdAt: 1_700_000_000_000,
    startedAt: 1_700_000_000_000,
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
  const tournament = makeBracketView(opts, own);
  // for dueSoon, set now near a live own-match deadline
  let now = 1_700_000_000_000;
  if (opts.card === "dueSoon") {
    const bracket = tournament.bracket!;
    const mine = nextMatchFor(bracket, own);
    if (mine?.deadline != null) {
      now = mine.deadline - 30 * 60_000; // 30 min left
    }
  }
  return { tournament, ownParticipant: own, now, onPlayMatch: () => {}, onBack: () => {} };
}
