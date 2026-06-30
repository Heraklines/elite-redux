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
import { buildInfernoFeed, buildMergedCommunityFeed } from "#data/elite-redux/er-community-challenge-inferno";
import {
  buildDemoChallengesConfig,
  type CommunityChallengeConfig,
  type CommunityChallengeEntry,
  type CommunityChallengeFeed,
  fetchCommunityBookmarks,
  fetchCommunityFeed,
  recordCommunityAttempt,
} from "#data/elite-redux/er-community-challenges";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { addPokemonIcon, buildChallengeCardArt, buildChallengeEmblem } from "#ui/community-challenge-card";
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
  /** Frame in the (boot-loaded) `items` atlas; falls back to a drawn rune if absent. */
  readonly icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { key: "community", label: "COMMUNITY", icon: "soothe_bell" },
  { key: "featured", label: "FEATURED", icon: "relic_gold" },
  { key: "browse", label: "BROWSE", icon: "map" },
  { key: "mine", label: "MY", icon: "scope_lens" },
  { key: "create", label: "CREATE", icon: "rare_candy" },
  { key: "bookmarks", label: "SAVED", icon: "lock_capsule" },
  { key: "history", label: "HISTORY", icon: "exp_charm" },
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

  // ACTION on a focused card plays it; CREATE's publish reuses this too. The
  // config-based launch callback supplied by the opener (TitlePhase's submenu),
  // or null when the screen is opened standalone.
  private onLaunch: ((config: CommunityChallengeConfig) => void) | null = null;
  // CANCEL returns here: the opener supplies a back callback (TitlePhase ->
  // toTitleScreen) because we were opened via the deferred pattern (resetModeChain),
  // so revertMode() alone would land on an empty MESSAGE box. null = standalone
  // (render harness), where revertMode() is the correct fallback.
  private onBack: (() => void) | null = null;
  // Set true in clear() so an in-flight async section fetch never rebuilds a
  // torn-down container after the browser is closed (onPlay launch / back-out).
  private disposed = false;
  // Which region ACTION acts on: the card row or the sidebar nav.
  private focus: "nav" | "cards" = "cards";

  // The active sidebar SECTION (NAV_ITEMS[].key). Drives which feed `rebuild()`
  // renders; switched by ACTION on a nav item (activateNav -> loadSection).
  private section = "featured";
  // The merged featured/community feed handed in at open(); reused by the
  // FEATURED/COMMUNITY sections so switching back is instant + offline-safe.
  private baseFeed: CommunityChallengeFeed | null = null;
  // Sections with no client feed yet (MY / HISTORY) render the "coming soon"
  // empty copy instead of the genuine "be the first" empty state.
  private comingSoon = false;
  // Sidebar label Text refs, recolored gold/dim as the nav cursor moves.
  private navLabels: Phaser.GameObjects.Text[] = [];
  // The top-bar eyebrow above CHALLENGES; retitled to the active section.
  private eyebrow!: Phaser.GameObjects.Text;

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

    this.navLabels = [];
    NAV_ITEMS.forEach((item, i) => {
      const y = 24 + i * 19;
      this.addNavIcon(11, y + 3, item.icon);
      const t = addTextObject(20, y, item.label, TextStyle.WINDOW, { fontSize: "30px" });
      t.setOrigin(0, 0).setColor(i === this.navCursor ? GOLD : DIM);
      this.container.add(t);
      this.navLabels.push(t);
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

  /** A nav glyph: the boot-loaded `items` atlas icon, or a drawn rune if absent. */
  private addNavIcon(x: number, y: number, frame: string): void {
    const tex = globalScene.textures.exists("items") ? globalScene.textures.get("items") : null;
    if (tex && tex.key !== "__MISSING" && tex.has(frame)) {
      const icon = globalScene.add.sprite(x, y, "items", frame);
      icon.setOrigin(0.5, 0.5).setScale(0.42);
      this.container.add(icon);
      return;
    }
    this.container.add(globalScene.add.rectangle(x, y, 6, 6, 0xc8a24a, 1).setAngle(45).setOrigin(0.5));
  }

  private buildTopBar(): void {
    this.eyebrow = addTextObject(CONTENT_X, TOP_Y, "COMMUNITY", TextStyle.WINDOW, { fontSize: "30px" });
    this.eyebrow.setOrigin(0, 0).setColor(GOLD_DIM);
    this.container.add(this.eyebrow);

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
    // Hover updates: the detail + stats follow the focused card.
    const focused = feed.featured[this.cardCursor] ?? feed.selected ?? feed.featured[0];
    this.buildFeaturedRow(feed.featured);
    this.buildDetail(focused);
    this.buildStats(focused);
  }

  // --- Featured row ---

  private featuredCardGeometry(count = 4): { x: number; w: number }[] {
    const totalW = SCREEN_W - CONTENT_X - STATS_W - 6;
    const unit = (totalW - FEAT_GAP * 3) / 4; // one quarter-row card width
    const slots = Math.min(4, Math.max(1, count));
    // A lone card (e.g. the single real Inferno feed) reads as a hero plate at
    // ~2 units, left-aligned; otherwise the cards split the row evenly.
    const w = slots === 1 ? unit * 2 + FEAT_GAP : (totalW - FEAT_GAP * (slots - 1)) / slots;
    return Array.from({ length: slots }, (_, i) => ({ x: CONTENT_X + i * (w + FEAT_GAP), w }));
  }

  private buildFeaturedRow(featured: CommunityChallengeEntry[]): void {
    const geom = this.featuredCardGeometry(featured.length);
    geom.forEach((g, i) => {
      const e = featured[i];
      if (!e) {
        return;
      }
      const win = addWindow(g.x, FEAT_Y, g.w, FEAT_H);
      win.setTint(PANEL_TINT);
      this.dynamic.add(win);
      const selected = i === this.cardCursor;
      // Trial Plate: type-tinted black-silhouette card art fills the card.
      this.dynamic.add(
        buildChallengeCardArt(e, g.x + 1, FEAT_Y + 1, g.w - 2, FEAT_H - 2, selected ? 0x3890f8 : 0xa040c0),
      );
      // Scrims under the title + foot keep overlaid text readable on the art.
      this.dynamic.add(globalScene.add.rectangle(g.x + 1, FEAT_Y + 1, g.w - 2, 15, 0x0a0a12, 0.5).setOrigin(0));
      this.dynamic.add(
        globalScene.add.rectangle(g.x + 1, FEAT_Y + FEAT_H - 11, g.w - 2, 10, 0x0a0a12, 0.6).setOrigin(0),
      );

      const name = addTextObject(g.x + 4, FEAT_Y + 3, e.config.name.toUpperCase(), TextStyle.WINDOW, {
        fontSize: "32px",
      });
      name.setOrigin(0, 0).setColor(GOLD);
      this.dynamic.add(name);
      const sub = addTextObject(g.x + 4, FEAT_Y + 10, e.config.subtitle.toUpperCase(), TextStyle.WINDOW, {
        fontSize: "22px",
      });
      sub.setOrigin(0, 0).setColor(GOLD_DIM);
      this.dynamic.add(sub);
      const rate = addTextObject(g.x + 4, FEAT_Y + FEAT_H - 10, `${this.clearRatePct(e)}%`, TextStyle.WINDOW, {
        fontSize: "30px",
      });
      rate.setOrigin(0, 0).setColor(CYAN);
      this.dynamic.add(rate);
      const att = addTextObject(g.x + g.w - 4, FEAT_Y + FEAT_H - 10, this.kFmt(e.stats.attempts), TextStyle.WINDOW, {
        fontSize: "28px",
        align: "right",
      });
      att.setOrigin(1, 0).setColor(INK);
      this.dynamic.add(att);

      // Selection frame on top.
      if (selected) {
        const selFrame = globalScene.add.rectangle(g.x, FEAT_Y, g.w, FEAT_H, 0, 0).setOrigin(0);
        selFrame.setStrokeStyle(1, 0xffd27a, 0.95);
        this.dynamic.add(selFrame);
      }
    });
  }

  private buildFeaturedEmpty(): void {
    const geom = this.featuredCardGeometry();
    const lead = this.comingSoon ? "COMING SOON" : "BE THE FIRST";
    geom.forEach((g, i) => {
      const win = addWindow(g.x, FEAT_Y, g.w, FEAT_H);
      win.setTint(0x14121c);
      this.dynamic.add(win);
      const label = i === 0 ? lead : "NO CHALLENGE";
      const t = addTextObject(g.x + g.w / 2, FEAT_Y + FEAT_H / 2 - 8, label, TextStyle.WINDOW, {
        fontSize: "28px",
        align: "center",
      });
      t.setOrigin(0.5, 0).setColor(i === 0 ? GOLD : DIM);
      this.dynamic.add(t);
      // The "+" forge affordance only reads for the genuinely-empty CREATE prompt,
      // not for a section that simply has no data yet.
      if (i === 0 && !this.comingSoon) {
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

    // Wax-seal crest (type-tinted disc + hero silhouette / charge).
    this.dynamic.add(buildChallengeEmblem(e, CONTENT_X + 15, DETAIL_Y + 15, 12));

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

    // Two columns: RULES (the active base challenges) | ALLOWED POKEMON. Tags +
    // the RESTRICTIONS column were removed (redundant - restrictions are just more
    // base-challenge rules), giving the rules + the allowed icon grid more room.
    const colY = DETAIL_Y + 30;
    this.buildColumnHeader(CONTENT_X + 6, colY, "RULES");
    e.rules.slice(0, 6).forEach((r, i) => {
      const t = addTextObject(CONTENT_X + 6, colY + 8 + i * 7, `- ${r.text}`, TextStyle.WINDOW, { fontSize: "22px" });
      t.setOrigin(0, 0).setColor(INK);
      this.dynamic.add(t);
    });

    const allowX = CONTENT_X + 6 + (w - 12) * 0.46;
    this.buildColumnHeader(allowX, colY, "ALLOWED POKEMON");
    // The first ~10 allowed species as real party icons (placeholder squares offline).
    const cols = 5;
    const cell = 14;
    e.allowedPreview.slice(0, 10).forEach((sp, i) => {
      const gx = allowX + (i % cols) * cell;
      const gy = colY + 8 + Math.floor(i / cols) * cell;
      addPokemonIcon(this.dynamic, sp, gx, gy, cell - 1);
    });
    if (e.allowedCount > e.allowedPreview.length) {
      const more = addTextObject(
        allowX,
        colY + 8 + 2 * cell + 1,
        `+${e.allowedCount - e.allowedPreview.length} MORE`,
        TextStyle.WINDOW,
        { fontSize: "22px" },
      );
      more.setOrigin(0, 0).setColor(DIM);
      this.dynamic.add(more);
    }
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
    const msg = this.comingSoon ? "This section is coming soon." : "Be the first to forge a community challenge.";
    const t = addTextObject(CONTENT_X + 52, DETAIL_Y + DETAIL_H / 2 - 4, msg, TextStyle.WINDOW, {
      fontSize: "30px",
    });
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
    // The demo feed passes a NEGATIVE relative offset ("2h ago"); real entries
    // (the Inferno card) pass an absolute epoch (ms). Render the latter as a fixed
    // UTC date so the value doesn't drift with the wall clock (golden-render safe).
    const EPOCH_FLOOR = 1_000_000_000_000; // ~2001-09; larger magnitudes are absolute epochs
    if (Math.abs(at) >= EPOCH_FLOOR) {
      const d = new Date(at);
      const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
      return `${d.getUTCDate()} ${mon}`;
    }
    const ms = Math.abs(at);
    const h = Math.round(ms / 3600_000);
    return h >= 24 ? `${Math.round(h / 24)}d ago` : `${h}h ago`;
  }

  // ---- Lifecycle ----------------------------------------------------------

  show(args: any[]): boolean {
    super.show(args);
    this.feed =
      args.length > 0 && this.isFeed(args[0]) ? (args[0] as CommunityChallengeFeed) : buildDemoChallengesConfig();
    this.onLaunch = typeof args[1] === "function" ? (args[1] as (config: CommunityChallengeConfig) => void) : null;
    this.onBack = typeof args[2] === "function" ? (args[2] as () => void) : null;
    this.disposed = false;
    this.navCursor = 1;
    this.cardCursor = 0;
    this.focus = "cards";
    // Open on FEATURED; the merged feed handed in is the featured/community source.
    this.section = "featured";
    this.baseFeed = this.feed;
    this.comingSoon = false;
    this.updateSectionHeader();
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
    this.navLabels.forEach((t, i) => t.setColor(i === this.navCursor ? GOLD : DIM));
  }

  /** Retitle the top-bar eyebrow to the active section (defaults to its nav label). */
  private updateSectionHeader(): void {
    const item = NAV_ITEMS.find(n => n.key === this.section);
    this.eyebrow.setText(item ? item.label : this.section.toUpperCase());
  }

  processInput(button: Button): boolean {
    switch (button) {
      case Button.CANCEL:
        globalScene.ui.playSelect();
        // We were opened via the deferred pattern (resetModeChain), so the mode
        // chain is just [MESSAGE] - revertMode() alone would strand the player on
        // an empty message box. The opener supplies onBack (-> title screen).
        if (this.onBack) {
          this.onBack();
        } else {
          globalScene.ui.revertMode();
        }
        return true;
      case Button.LEFT:
      case Button.RIGHT: {
        this.focus = "cards";
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
        this.focus = "nav";
        this.navCursor = (this.navCursor + (button === Button.DOWN ? 1 : NAV_ITEMS.length - 1)) % NAV_ITEMS.length;
        this.positionNavHighlight();
        globalScene.ui.playSelect();
        return true;
      case Button.ACTION:
      case Button.SUBMIT:
        globalScene.ui.playSelect();
        if (this.focus === "nav") {
          this.activateNav(NAV_ITEMS[this.navCursor]);
        } else {
          this.playFocusedCard();
        }
        return true;
      default:
        return false;
    }
  }

  /** Play the currently-focused card via the opener's launch callback (no-op standalone). */
  private playFocusedCard(): void {
    const e = this.feed?.featured[this.cardCursor];
    if (e && this.onLaunch) {
      // Record a normal attempt for published cards (built-in er-* / demo cards have
      // no worker row), then teardown-launch the run (setModeAndEnd clears this handler).
      if (!/^(er-|demo-)/.test(e.config.id)) {
        void recordCommunityAttempt(e.config.id);
      }
      this.onLaunch(e.config);
    }
  }

  /** Activate a sidebar nav item: switch the active SECTION (and feed), or open CREATE. */
  private activateNav(item: NavItem): void {
    if (item.key === "create") {
      this.openCreate();
      return;
    }
    this.section = item.key;
    this.cardCursor = 0; // clamp before rebuild (rebuild reads featured[cardCursor])
    this.focus = "cards";
    this.updateSectionHeader();
    this.loadSection(item.key);
  }

  /**
   * Load the feed for a section + rebuild. Sync sections (FEATURED/COMMUNITY) render
   * immediately; async sections render the empty state first, then fill on resolve
   * (guarded by `this.section === key` so a fast switch never clobbers a newer one).
   * MY / HISTORY have no client feed yet -> the "coming soon" empty copy.
   */
  private loadSection(key: string): void {
    this.comingSoon = false;
    switch (key) {
      case "featured":
      case "community":
        // Render the cached/Inferno-only feed instantly (offline-safe, no loading flash),
        // then async-upgrade to the merged feed (Inferno pinned first + the backend's
        // player-authored cards). Guarded by `this.section === key` so a fast nav switch
        // away never clobbers a newer section; the merged result is cached as `baseFeed`
        // so switching back is instant.
        this.feed = this.baseFeed ?? buildInfernoFeed();
        this.rebuild();
        void buildMergedCommunityFeed({ sort: "trending" }).then(f => {
          if (!this.disposed && this.section === key) {
            this.baseFeed = f;
            this.feed = f;
            this.cardCursor = 0;
            this.rebuild();
          }
        });
        break;
      case "browse":
        this.feed = this.emptyFeed();
        this.rebuild();
        void fetchCommunityFeed({ sort: "newest" }).then(f => {
          if (!this.disposed && this.section === key) {
            this.feed = f;
            this.cardCursor = 0;
            this.rebuild();
          }
        });
        break;
      case "bookmarks":
        this.feed = this.emptyFeed();
        this.rebuild();
        void fetchCommunityBookmarks().then(items => {
          if (!this.disposed && this.section === key) {
            this.feed = { featured: items, selected: items[0] ?? null, totalCount: items.length };
            this.cardCursor = 0;
            this.rebuild();
          }
        });
        break;
      default:
        // "mine" / "history" - no client feed yet.
        this.feed = this.emptyFeed();
        this.comingSoon = true;
        this.rebuild();
        break;
    }
  }

  /** Open the challenge designer over the browser (PATTERN 1: browser stays underneath).
   *  Hands the launch callback down so CREATE can drop the founder straight into their
   *  qualifying run after publishing (args[0]=null = no seed; args[1]=the launch cb). */
  private openCreate(): void {
    globalScene.ui.setOverlayMode(UiMode.COMMUNITY_CHALLENGE_CREATE, null, this.onLaunch);
  }

  private emptyFeed(): CommunityChallengeFeed {
    return { featured: [], selected: null, totalCount: 0 };
  }

  clear(): void {
    super.clear();
    this.disposed = true;
    this.container.setVisible(false);
    this.dynamic.removeAll(true);
    this.feed = null;
  }
}
