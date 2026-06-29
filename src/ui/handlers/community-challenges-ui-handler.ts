/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux - Community Challenges browser (UiMode.COMMUNITY_CHALLENGES).
//
// Browse / inspect / play player-authored challenge runs. Dark-fantasy /
// ancient-map theme (the World Map parchment kit skinned onto the Colosseum dark
// board). Layout (matches the maintainer concept art):
//   left sidebar nav | top bar | featured-card row | detail panel | stats panel
//   | bottom button-hint bar.
//
// This is the P1 layout pass: regions are laid out + bound to the feed data, with
// the ZERO-at-launch empty state ("vacant standards"). Card art (the Trial Plates
// silhouettes) + full directional nav land in P1-F / P1-E. Drive it headlessly
// via the render harness recipe `community-challenges` (and `-empty`).
// =============================================================================

import { globalScene } from "#app/global-scene";
import {
  buildDemoChallengesConfig,
  type CommunityChallengeEntry,
  type CommunityChallengeFeed,
} from "#data/elite-redux/er-community-challenges";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { addWindow } from "#ui/ui-theme";

const SCREEN_W = 320;
const SCREEN_H = 180;

// --- Theme palette (World Map gold-on-dark + Colosseum board) ---
const VOID = 0x080912;
const BAND = 0x10131f;
const PANEL_TINT = 0x1a1f33;
const GOLD = "#ffd27a";
const GOLD_DIM = "#b9924a";
const INK = "#d8c9a8";
const DIM = "#8a8470";
const CYAN = "#7fd8f5";
const ACTIVE_RED = 0xd8542a;

// --- Region geometry ---
const NAV_W = 46;
const CONTENT_X = NAV_W + 4;
const TOP_Y = 3;
const FEAT_Y = 36;
const FEAT_H = 44;
const FEAT_GAP = 3;
const DETAIL_Y = FEAT_Y + FEAT_H + 3;
const DETAIL_H = SCREEN_H - DETAIL_Y - 13;
const STATS_W = 92;
const HINT_Y = SCREEN_H - 9;

interface NavItem {
  readonly key: string;
  readonly label: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "community", label: "COMMUNITY" },
  { key: "featured", label: "FEATURED" },
  { key: "browse", label: "BROWSE" },
  { key: "mine", label: "MY" },
  { key: "create", label: "CREATE" },
  { key: "bookmarks", label: "SAVED" },
  { key: "history", label: "HISTORY" },
];

export class CommunityChallengesUiHandler extends UiHandler {
  private container!: Phaser.GameObjects.Container;
  private feed: CommunityChallengeFeed | null = null;

  // Region containers (rebuilt on each show()).
  private dynamic!: Phaser.GameObjects.Container;

  // Nav cursor highlight.
  private navHighlight!: Phaser.GameObjects.Rectangle;
  private navCursor = 1; // FEATURED active by default
  private cardCursor = 0;

  constructor() {
    super(UiMode.COMMUNITY_CHALLENGES);
  }

  setup(): void {
    const ui = this.getUi();
    const h = globalScene.scaledCanvas.height;

    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    // Opaque void backdrop.
    this.container.add(globalScene.add.rectangle(0, 0, SCREEN_W, SCREEN_H, VOID, 1).setOrigin(0));

    this.buildSidebar();
    this.buildTopBar();
    this.buildHintBar();

    // Everything data-driven lives in `dynamic`, rebuilt per show().
    this.dynamic = globalScene.add.container(0, 0);
    this.container.add(this.dynamic);
  }

  // ---- Static chrome ------------------------------------------------------

  private buildSidebar(): void {
    this.container.add(globalScene.add.rectangle(0, 0, NAV_W, SCREEN_H, BAND, 1).setOrigin(0));
    this.container.add(globalScene.add.rectangle(NAV_W, 0, 1, SCREEN_H, 0x2a2417, 1).setOrigin(0));

    // Active-item highlight bar (moved by the cursor).
    this.navHighlight = globalScene.add.rectangle(0, 0, NAV_W, 18, ACTIVE_RED, 0.22).setOrigin(0);
    this.navHighlight.setStrokeStyle(1, ACTIVE_RED, 0.9);
    this.container.add(this.navHighlight);

    NAV_ITEMS.forEach((item, i) => {
      const y = 24 + i * 19;
      // A small drawn glyph (rotated square) stands in for the icon until er_icon__ui_* art lands.
      const glyph = globalScene.add
        .rectangle(11, y + 3, 6, 6, 0xc8a24a, 1)
        .setAngle(45)
        .setOrigin(0.5);
      this.container.add(glyph);
      const t = addTextObject(20, y, item.label, TextStyle.WINDOW, { fontSize: "30px" });
      t.setOrigin(0, 0).setColor(i === this.navCursor ? GOLD : DIM);
      this.container.add(t);
    });

    // Player crest stub (bottom).
    this.container.add(globalScene.add.rectangle(NAV_W / 2, SCREEN_H - 16, 18, 18, 0x241a30, 1).setAngle(45));
    const rival = addTextObject(NAV_W / 2, SCREEN_H - 5, "RIVAL", TextStyle.WINDOW, {
      fontSize: "26px",
      align: "center",
    });
    rival.setOrigin(0.5, 0).setColor(DIM);
    this.container.add(rival);
  }

  private buildTopBar(): void {
    const eyebrow = addTextObject(CONTENT_X, TOP_Y, "COMMUNITY", TextStyle.WINDOW, { fontSize: "30px" });
    eyebrow.setOrigin(0, 0).setColor(GOLD_DIM);
    this.container.add(eyebrow);

    const title = addTextObject(CONTENT_X, TOP_Y + 7, "CHALLENGES", TextStyle.WINDOW, { fontSize: "72px" });
    title.setOrigin(0, 0).setColor(GOLD);
    this.container.add(title);

    const sub = addTextObject(
      CONTENT_X,
      TOP_Y + 26,
      "Take on unique runs created by trainers around the world.",
      TextStyle.WINDOW,
      {
        fontSize: "30px",
      },
    );
    sub.setOrigin(0, 0).setColor(DIM);
    this.container.add(sub);

    // TRENDING dropdown + paging + VIEW ALL (cosmetic stubs in P1).
    const trend = addWindow(SCREEN_W - 78, TOP_Y + 2, 50, 12);
    trend.setTint(PANEL_TINT);
    this.container.add(trend);
    const trendT = addTextObject(SCREEN_W - 74, TOP_Y + 4, "TRENDING", TextStyle.WINDOW, { fontSize: "28px" });
    trendT.setOrigin(0, 0).setColor(INK);
    this.container.add(trendT);
    const viewAll = addWindow(SCREEN_W - 26, TOP_Y + 2, 24, 12);
    viewAll.setTint(PANEL_TINT);
    this.container.add(viewAll);
    const viewAllT = addTextObject(SCREEN_W - 14, TOP_Y + 5, "ALL", TextStyle.WINDOW, {
      fontSize: "26px",
      align: "center",
    });
    viewAllT.setOrigin(0.5, 0).setColor(GOLD);
    this.container.add(viewAllT);
  }

  private buildHintBar(): void {
    this.container.add(globalScene.add.rectangle(0, SCREEN_H - 12, SCREEN_W, 12, BAND, 1).setOrigin(0));
    const hint = addTextObject(
      SCREEN_W / 2,
      HINT_Y,
      "A  View    X  Filters    Y  Create    B  Back",
      TextStyle.WINDOW,
      {
        fontSize: "28px",
        align: "center",
      },
    );
    hint.setOrigin(0.5, 0).setColor(DIM);
    this.container.add(hint);
  }

  // ---- Dynamic (data-bound) regions ---------------------------------------

  private rebuild(): void {
    this.dynamic.removeAll(true);
    const feed = this.feed;
    if (!feed || feed.featured.length === 0) {
      this.buildFeaturedEmpty();
      this.buildDetailEmpty();
      this.buildStatsEmpty();
      return;
    }
    this.buildFeaturedRow(feed.featured);
    this.buildDetail(feed.selected ?? feed.featured[0]);
    this.buildStats(feed.selected ?? feed.featured[0]);
  }

  // --- Featured row ---

  private featuredCardGeometry(): { x: number; w: number }[] {
    const totalW = SCREEN_W - CONTENT_X - STATS_W - 6;
    const w = (totalW - FEAT_GAP * 3) / 4;
    return [0, 1, 2, 3].map(i => ({ x: CONTENT_X + i * (w + FEAT_GAP), w }));
  }

  private buildFeaturedRow(featured: CommunityChallengeEntry[]): void {
    const geom = this.featuredCardGeometry();
    geom.forEach((g, i) => {
      const e = featured[i];
      const win = addWindow(g.x, FEAT_Y, g.w, FEAT_H);
      win.setTint(PANEL_TINT);
      this.dynamic.add(win);
      if (i === this.cardCursor) {
        const sel = globalScene.add.rectangle(g.x, FEAT_Y, g.w, FEAT_H, 0, 0).setOrigin(0);
        sel.setStrokeStyle(1, 0xffd27a, 0.95);
        this.dynamic.add(sel);
      }
      if (!e) {
        return;
      }
      // Card-art placeholder (the Trial Plates silhouette compositor lands in P1-F).
      const art = globalScene.add.rectangle(g.x + 2, FEAT_Y + 2, g.w - 4, FEAT_H - 18, 0x141019, 1).setOrigin(0);
      this.dynamic.add(art);
      const name = addTextObject(g.x + 4, FEAT_Y + 4, e.config.name.toUpperCase(), TextStyle.WINDOW, {
        fontSize: "32px",
      });
      name.setOrigin(0, 0).setColor(GOLD);
      this.dynamic.add(name);
      const sub = addTextObject(g.x + 4, FEAT_Y + 12, e.config.subtitle.toUpperCase(), TextStyle.WINDOW, {
        fontSize: "24px",
      });
      sub.setOrigin(0, 0).setColor(GOLD_DIM);
      this.dynamic.add(sub);
      const rate = addTextObject(g.x + 4, FEAT_Y + FEAT_H - 12, `${this.clearRatePct(e)}%`, TextStyle.WINDOW, {
        fontSize: "32px",
      });
      rate.setOrigin(0, 0).setColor(CYAN);
      this.dynamic.add(rate);
      const att = addTextObject(g.x + g.w - 4, FEAT_Y + FEAT_H - 12, this.kFmt(e.stats.attempts), TextStyle.WINDOW, {
        fontSize: "30px",
        align: "right",
      });
      att.setOrigin(1, 0).setColor(INK);
      this.dynamic.add(att);
    });
  }

  private buildFeaturedEmpty(): void {
    const geom = this.featuredCardGeometry();
    geom.forEach((g, i) => {
      const win = addWindow(g.x, FEAT_Y, g.w, FEAT_H);
      win.setTint(0x14121c);
      this.dynamic.add(win);
      const label = i === 0 ? "BE THE FIRST" : "NO CHALLENGE";
      const t = addTextObject(g.x + g.w / 2, FEAT_Y + FEAT_H / 2 - 8, label, TextStyle.WINDOW, {
        fontSize: "28px",
        align: "center",
      });
      t.setOrigin(0.5, 0).setColor(i === 0 ? GOLD : DIM);
      this.dynamic.add(t);
      if (i === 0) {
        const plus = addTextObject(g.x + g.w / 2, FEAT_Y + 8, "+", TextStyle.WINDOW, {
          fontSize: "60px",
          align: "center",
        });
        plus.setOrigin(0.5, 0).setColor(GOLD);
        this.dynamic.add(plus);
      }
    });
  }

  // --- Detail panel ---

  private buildDetail(e: CommunityChallengeEntry): void {
    const w = SCREEN_W - CONTENT_X - STATS_W - 6;
    const win = addWindow(CONTENT_X, DETAIL_Y, w, DETAIL_H);
    win.setTint(PANEL_TINT);
    this.dynamic.add(win);

    // Emblem placeholder (the wax-seal crest lands in P1-F).
    this.dynamic.add(globalScene.add.circle(CONTENT_X + 15, DETAIL_Y + 14, 11, 0x241a30, 1));
    this.dynamic.add(globalScene.add.circle(CONTENT_X + 15, DETAIL_Y + 14, 11).setStrokeStyle(1, 0xc8a24a, 0.9));

    const title = addTextObject(
      CONTENT_X + 30,
      DETAIL_Y + 3,
      `${e.config.name.toUpperCase()}: ${e.config.subtitle.toUpperCase()}`,
      TextStyle.WINDOW,
      { fontSize: "36px" },
    );
    title.setOrigin(0, 0).setColor(GOLD);
    this.dynamic.add(title);

    const by = addTextObject(CONTENT_X + 30, DETAIL_Y + 11, `Created by ${e.config.author}`, TextStyle.WINDOW, {
      fontSize: "22px",
    });
    by.setOrigin(0, 0).setColor(DIM);
    this.dynamic.add(by);
    if (e.stats.firstClearUser) {
      const fc = addTextObject(
        CONTENT_X + 86,
        DETAIL_Y + 11,
        `First Clear by ${e.stats.firstClearUser}`,
        TextStyle.WINDOW,
        {
          fontSize: "22px",
        },
      );
      fc.setOrigin(0, 0).setColor(DIM);
      this.dynamic.add(fc);
    }

    const desc = addTextObject(CONTENT_X + 30, DETAIL_Y + 18, e.config.description, TextStyle.WINDOW, {
      fontSize: "22px",
      wordWrap: { width: (w - 36) * 6 },
    });
    desc.setOrigin(0, 0).setColor(INK);
    this.dynamic.add(desc);

    // Tag chips.
    let tx = CONTENT_X + 6;
    const ty = DETAIL_Y + 31;
    for (const tag of e.config.tags) {
      const cw = 7 + tag.length * 4;
      const chip = addWindow(tx, ty, cw, 8);
      chip.setTint(0x2a2238);
      this.dynamic.add(chip);
      const ct = addTextObject(tx + cw / 2, ty + 1, tag, TextStyle.WINDOW, { fontSize: "22px", align: "center" });
      ct.setOrigin(0.5, 0).setColor(CYAN);
      this.dynamic.add(ct);
      tx += cw + 3;
    }

    // Three columns: RULES | ALLOWED | RESTRICTIONS.
    const colY = DETAIL_Y + 42;
    this.buildColumnHeader(CONTENT_X + 6, colY, "RULES");
    e.rules.slice(0, 5).forEach((r, i) => {
      const t = addTextObject(CONTENT_X + 6, colY + 8 + i * 7, `- ${r.text}`, TextStyle.WINDOW, { fontSize: "22px" });
      t.setOrigin(0, 0).setColor(INK);
      this.dynamic.add(t);
    });

    const allowX = CONTENT_X + 6 + (w - 12) * 0.37;
    this.buildColumnHeader(allowX, colY, "ALLOWED POKEMON");
    // Icon grid placeholder (real icons land in P1-E/F).
    const cols = 5;
    e.allowedPreview.slice(0, 10).forEach((_sp, i) => {
      const gx = allowX + (i % cols) * 11;
      const gy = colY + 8 + Math.floor(i / cols) * 11;
      this.dynamic.add(globalScene.add.rectangle(gx, gy, 10, 10, 0x1c2236, 1).setOrigin(0));
    });
    if (e.allowedCount > e.allowedPreview.length) {
      const more = addTextObject(
        allowX,
        colY + 31,
        `+${e.allowedCount - e.allowedPreview.length} MORE`,
        TextStyle.WINDOW,
        {
          fontSize: "22px",
        },
      );
      more.setOrigin(0, 0).setColor(DIM);
      this.dynamic.add(more);
    }

    const restX = CONTENT_X + 6 + (w - 12) * 0.72;
    this.buildColumnHeader(restX, colY, "RESTRICTIONS");
    this.restrictionLines(e)
      .slice(0, 5)
      .forEach((line, i) => {
        const t = addTextObject(restX, colY + 8 + i * 7, `x ${line}`, TextStyle.WINDOW, { fontSize: "22px" });
        t.setOrigin(0, 0).setColor(INK);
        this.dynamic.add(t);
      });
  }

  private buildColumnHeader(x: number, y: number, label: string): void {
    const t = addTextObject(x, y, label, TextStyle.WINDOW, { fontSize: "26px" });
    t.setOrigin(0, 0).setColor(GOLD_DIM);
    this.dynamic.add(t);
  }

  private buildDetailEmpty(): void {
    const w = SCREEN_W - CONTENT_X - STATS_W - 6;
    const win = addWindow(CONTENT_X, DETAIL_Y, w, DETAIL_H);
    win.setTint(0x14121c);
    this.dynamic.add(win);
    this.dynamic.add(globalScene.add.circle(CONTENT_X + 24, DETAIL_Y + DETAIL_H / 2, 18, 0x1a1622, 1));
    this.dynamic.add(
      globalScene.add.circle(CONTENT_X + 24, DETAIL_Y + DETAIL_H / 2, 18).setStrokeStyle(1, 0x7a6a3a, 0.8),
    );
    const t = addTextObject(
      CONTENT_X + 52,
      DETAIL_Y + DETAIL_H / 2 - 4,
      "Be the first to forge a community challenge.",
      TextStyle.WINDOW,
      {
        fontSize: "30px",
      },
    );
    t.setOrigin(0, 0).setColor(DIM);
    this.dynamic.add(t);
  }

  // --- Community Stats panel ---

  private buildStats(e: CommunityChallengeEntry): void {
    const x = SCREEN_W - STATS_W - 2;
    const win = addWindow(x, DETAIL_Y, STATS_W, DETAIL_H);
    win.setTint(PANEL_TINT);
    this.dynamic.add(win);
    const head = addTextObject(x + 5, DETAIL_Y + 4, "COMMUNITY STATS", TextStyle.WINDOW, { fontSize: "28px" });
    head.setOrigin(0, 0).setColor(GOLD);
    this.dynamic.add(head);

    // Donut placeholder (the arc renderer lands in P1-E).
    const cx = x + 22;
    const cy = DETAIL_Y + 30;
    this.dynamic.add(globalScene.add.circle(cx, cy, 14, 0x223052, 1));
    this.dynamic.add(globalScene.add.circle(cx, cy, 8, PANEL_TINT, 1));
    const kt = addTextObject(cx, cy - 3, this.kFmt(e.stats.attempts), TextStyle.WINDOW, {
      fontSize: "24px",
      align: "center",
    });
    kt.setOrigin(0.5, 0).setColor(INK);
    this.dynamic.add(kt);

    const legend: [string, string, string][] = [
      ["CLEARED", `${this.clearRatePct(e)}%`, "#5fd38a"],
      ["IN PROGRESS", `${this.pct(e.stats.inProgress, e.stats.attempts)}%`, "#5aa0e8"],
      ["FAILED", `${this.pct(e.stats.failed, e.stats.attempts)}%`, "#e06a6a"],
    ];
    legend.forEach(([label, val, col], i) => {
      const ly = DETAIL_Y + 18 + i * 8;
      const l = addTextObject(x + 40, ly, label, TextStyle.WINDOW, { fontSize: "22px" });
      l.setOrigin(0, 0).setColor(col);
      this.dynamic.add(l);
      const v = addTextObject(x + STATS_W - 4, ly, val, TextStyle.WINDOW, { fontSize: "22px", align: "right" });
      v.setOrigin(1, 0).setColor(col);
      this.dynamic.add(v);
    });

    const rh = addTextObject(x + 5, DETAIL_Y + 46, "RECENT COMPLETIONS", TextStyle.WINDOW, { fontSize: "24px" });
    rh.setOrigin(0, 0).setColor(GOLD_DIM);
    this.dynamic.add(rh);
    e.stats.recent.slice(0, 5).forEach((c, i) => {
      const ry = DETAIL_Y + 54 + i * 8;
      const n = addTextObject(x + 5, ry, c.user, TextStyle.WINDOW, { fontSize: "22px" });
      n.setOrigin(0, 0).setColor(INK);
      this.dynamic.add(n);
      const ago = addTextObject(x + STATS_W - 4, ry, this.ago(c.at), TextStyle.WINDOW, {
        fontSize: "22px",
        align: "right",
      });
      ago.setOrigin(1, 0).setColor(DIM);
      this.dynamic.add(ago);
    });
  }

  private buildStatsEmpty(): void {
    const x = SCREEN_W - STATS_W - 2;
    const win = addWindow(x, DETAIL_Y, STATS_W, DETAIL_H);
    win.setTint(0x14121c);
    this.dynamic.add(win);
    const head = addTextObject(x + 5, DETAIL_Y + 4, "COMMUNITY STATS", TextStyle.WINDOW, { fontSize: "28px" });
    head.setOrigin(0, 0).setColor(GOLD_DIM);
    this.dynamic.add(head);
    this.dynamic.add(globalScene.add.circle(x + 22, DETAIL_Y + 30, 14).setStrokeStyle(2, 0x3a3a44, 1));
    const t = addTextObject(x + 5, DETAIL_Y + 50, "No attempts yet.", TextStyle.WINDOW, { fontSize: "24px" });
    t.setOrigin(0, 0).setColor(DIM);
    this.dynamic.add(t);
  }

  // ---- Formatting helpers -------------------------------------------------

  private clearRatePct(e: CommunityChallengeEntry): string {
    return this.pct(e.stats.cleared, e.stats.attempts);
  }

  private pct(n: number, total: number): string {
    if (total <= 0) {
      return "0.0";
    }
    return ((n / total) * 100).toFixed(1);
  }

  private kFmt(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
  }

  private ago(at: number): string {
    const ms = Math.abs(at);
    const h = Math.round(ms / 3600_000);
    return h >= 24 ? `${Math.round(h / 24)}d ago` : `${h}h ago`;
  }

  private restrictionLines(e: CommunityChallengeEntry): string[] {
    const r = e.config.restrictions;
    const out: string[] = [];
    if (r.noLegendary) {
      out.push("No Legendary Pokemon");
    }
    if (r.noMythical) {
      out.push("No Mythical Pokemon");
    }
    if (r.noUltraBeasts) {
      out.push("No Ultra Beasts");
    }
    if (r.noRepeats) {
      out.push("No repeats");
    }
    if (r.starterNotGuaranteed) {
      out.push("Starter is not guaranteed");
    }
    return out;
  }

  // ---- Lifecycle ----------------------------------------------------------

  show(args: any[]): boolean {
    super.show(args);
    this.feed =
      args.length > 0 && this.isFeed(args[0]) ? (args[0] as CommunityChallengeFeed) : buildDemoChallengesConfig();
    this.navCursor = 1;
    this.cardCursor = 0;
    this.positionNavHighlight();
    this.rebuild();
    this.container.setVisible(true);
    return true;
  }

  private isFeed(arg: unknown): arg is CommunityChallengeFeed {
    return typeof arg === "object" && arg !== null && Array.isArray((arg as CommunityChallengeFeed).featured);
  }

  private positionNavHighlight(): void {
    this.navHighlight.setPosition(0, 22 + this.navCursor * 19);
  }

  processInput(button: Button): boolean {
    switch (button) {
      case Button.CANCEL:
        globalScene.ui.playSelect();
        globalScene.ui.revertMode();
        return true;
      case Button.LEFT:
      case Button.RIGHT: {
        const feat = this.feed?.featured ?? [];
        if (feat.length > 0) {
          this.cardCursor = (this.cardCursor + (button === Button.RIGHT ? 1 : feat.length - 1)) % feat.length;
          globalScene.ui.playSelect();
          this.rebuild();
        }
        return true;
      }
      case Button.UP:
      case Button.DOWN:
        this.navCursor = (this.navCursor + (button === Button.DOWN ? 1 : NAV_ITEMS.length - 1)) % NAV_ITEMS.length;
        this.positionNavHighlight();
        globalScene.ui.playSelect();
        return true;
      default:
        return false;
    }
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    this.dynamic.removeAll(true);
    this.feed = null;
  }
}
