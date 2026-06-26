/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER World Map overlay (#439 / #486 Phase D). A read-only modal that draws the
// run's JOURNEY as a visual chain of biome thumbnails (the biomes you've travelled
// through, oldest -> newest, the current one ringed gold), with the REVEALED
// onward routes shown as a branch row beneath it ("where you can go next"). Plus
// the Treasure-Map fragment count.
//
// Biome thumbnails reuse the boot-loaded `${biomeKey}_bg` arena backgrounds, so no
// extra asset load is needed. Left/Right scrub the journey when it is longer than
// the visible window; ACTION/CANCEL closes. Opened with the "J" hotkey from the
// in-battle command screen. Purely informational - it never mutates run state.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { getErBiomeEffectLines } from "#data/elite-redux/er-biome-effects-display";
import type { ErRouteNode } from "#data/elite-redux/er-biome-routing";
import { getErPendingNodes } from "#data/elite-redux/er-biome-routing";
import { getErBiomeHistory, getTreasureFragments, TREASURE_FRAGMENTS_FOR_REWARD } from "#data/elite-redux/er-map-nodes";
import { erCartographersLensExtraNodes } from "#data/elite-redux/er-relics";
import type { BiomeId } from "#enums/biome-id";
import { Button } from "#enums/buttons";
import { TextStyle } from "#enums/text-style";
import { UiMode } from "#enums/ui-mode";
import { getBiomeKey } from "#field/arena";
import { addTextObject } from "#ui/text";
import { UiHandler } from "#ui/ui-handler";
import { getBiomeName } from "#utils/common";

/** Optional callback fired when the overlay is dismissed. */
export type ErMapCloseCallback = () => void;

const PANEL_W = 284;
// Sized to FIT the 180-tall logical screen (scaledCanvas.height) with the journey
// row, the onward row AND the Conditions footer (#129) all visible. An earlier 221
// overflowed the screen and clipped the header (top) and the hint bar (bottom); the
// dead band that used to sit between the journey and routes rows is reclaimed instead.
const PANEL_H = 178;
// --- Ancient treasure-map palette (aged parchment + sepia ink) -------------
const PARCH_BASE = 0xe2d2ab; // aged paper
const FRAME_DARK = 0x4a3217; // leather map border
const FRAME_MID = 0x6e4d28; // inner rule + tile frames
const INK = "#33240f"; // body text (dark sepia) - text FILL colour, set directly
const INK_HEAD = "#7a3410"; // section headings (burnt sienna ink)
const DIM = "#8a7044"; // faint sepia (hints / older-biomes arrow)
const MAP_RED = 0xb23320; // current biome + hovered route - tile BORDERS (numeric)
const MAP_RED_HEX = "#b23320"; // ... and the matching current/hovered NAME colour
const ROUTE = 0x946127; // traveled path + a base onward path (brown trail)
/** Onward-route node colours by source (muted so they read as map ink). */
const GREEN = 0x4a7a2a; // a route a Map Upgrade revealed
const BLUE = 0x2f5f93; // a route a mystery event (e.g. Fortune Teller) foretold

/** Colour for an onward route by why it is shown. */
function routeColor(source?: string): number {
  return source === "event" ? BLUE : source === "upgrade" ? GREEN : ROUTE;
}

/** Thumbnail tile size (keeps the 320:180 arena aspect, scaled tiny). */
const TILE_W = 38;
const TILE_H = 22;
const TILE_GAP = 8;

/** Conditions footer (#129): a full-width panel listing the highlighted biome's
 *  special rules, filling the band under the onward-routes row. */
const FOOTER_Y = 107;
const FOOTER_H = 58;
const FOOTER_PAD = 6;
/** First Conditions line baseline + per-line step (6 lines fit the footer body). */
const COND_FIRST_Y = FOOTER_Y + 9;
const COND_LINE_H = 8;

/** Draw a faded compass-rose watermark (an 8-point star + two rings). */
function drawErCompass(
  g: Phaser.GameObjects.Graphics,
  cx: number,
  cy: number,
  r: number,
  color: number,
  alpha: number,
): void {
  g.lineStyle(1, color, alpha);
  g.strokeCircle(cx, cy, r);
  g.strokeCircle(cx, cy, r * 0.6);
  g.fillStyle(color, alpha);
  const spoke = (len: number, dirs: [number, number][]): void => {
    const wbase = r * 0.14;
    for (const [dx, dy] of dirs) {
      const tipX = cx + dx * len;
      const tipY = cy + dy * len;
      const px = -dy * wbase;
      const py = dx * wbase;
      g.fillTriangle(tipX, tipY, cx + px, cy + py, cx, cy);
      g.fillTriangle(tipX, tipY, cx - px, cy - py, cx, cy);
    }
  };
  spoke(r, [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ]); // long cardinal points
  const d = 0.707;
  spoke(r * 0.5, [
    [d, -d],
    [d, d],
    [-d, d],
    [-d, -d],
  ]); // short diagonal points
  g.fillCircle(cx, cy, r * 0.1);
}

/** Draw the parchment panel: aged paper, leather frame, corner ticks, a compass
 *  watermark, and the inset Conditions cartouche. Static chrome (drawn once). */
function drawErParchment(g: Phaser.GameObjects.Graphics): void {
  g.clear();
  // Aged paper, lighter toward the top, darker toward the worn bottom edge.
  g.fillStyle(PARCH_BASE, 1);
  g.fillRect(0, 0, PANEL_W, PANEL_H);
  g.fillStyle(0xefe4c6, 0.45);
  g.fillRect(5, 5, PANEL_W - 10, 48);
  g.fillStyle(0xc2aa76, 0.4);
  g.fillRect(5, PANEL_H - 56, PANEL_W - 10, 51);
  g.lineStyle(7, 0xab9061, 0.13); // soft edge vignette
  g.strokeRect(4, 4, PANEL_W - 8, PANEL_H - 8);
  drawErCompass(g, PANEL_W / 2, 64, 38, FRAME_MID, 0.1); // faint watermark behind the map
  // Leather map frame: a heavy outer border + a fine inner rule.
  g.lineStyle(4, FRAME_DARK, 1);
  g.strokeRect(2, 2, PANEL_W - 4, PANEL_H - 4);
  g.lineStyle(1, FRAME_MID, 0.9);
  g.strokeRect(7, 7, PANEL_W - 14, PANEL_H - 14);
  // Corner ticks.
  g.lineStyle(2, FRAME_DARK, 1);
  const m = 7;
  const c = 10;
  for (const [ox, sx] of [
    [m, 1],
    [PANEL_W - m, -1],
  ] as [number, number][]) {
    for (const [oy, sy] of [
      [m, 1],
      [PANEL_H - m, -1],
    ] as [number, number][]) {
      g.lineBetween(ox, oy + sy * c, ox, oy);
      g.lineBetween(ox, oy, ox + sx * c, oy);
    }
  }
  // Conditions cartouche (the inset footer box).
  const fw = PANEL_W - FOOTER_PAD * 2;
  g.fillStyle(0xd7c48d, 1);
  g.fillRect(FOOTER_PAD, FOOTER_Y, fw, FOOTER_H);
  g.lineStyle(2, FRAME_MID, 1);
  g.strokeRect(FOOTER_PAD, FOOTER_Y, fw, FOOTER_H);
  g.lineStyle(1, FRAME_DARK, 0.45);
  g.strokeRect(FOOTER_PAD + 2, FOOTER_Y + 2, fw - 4, FOOTER_H - 4);
}

/** Create a parchment text label. The colour is set as the FILL directly (NOT via
 *  setTint - which also darkens the WINDOW drop-shadow, doubling each glyph on the
 *  light paper), and the drop-shadow is removed so the ink reads crisp. */
function erInkText(
  x: number,
  y: number,
  content: string,
  color: string,
  fontSize: string,
  align: "left" | "center" = "left",
): Phaser.GameObjects.Text {
  const t = addTextObject(x, y, content, TextStyle.WINDOW, { fontSize, align, color });
  t.setShadow(0, 0, "rgba(0,0,0,0)", 0, false, false);
  return t;
}

export class ErMapUiHandler extends UiHandler {
  private container: Phaser.GameObjects.Container;
  private card: Phaser.GameObjects.Container;
  private parchment: Phaser.GameObjects.Graphics;
  private headerText: Phaser.GameObjects.Text;
  private fragmentText: Phaser.GameObjects.Text;
  private journeyLabel: Phaser.GameObjects.Text;
  private routesLabel: Phaser.GameObjects.Text;
  private emptyText: Phaser.GameObjects.Text;
  private hintText: Phaser.GameObjects.Text;
  private graphics: Phaser.GameObjects.Graphics;
  /** Conditions cartouche (#129) label; the inset box itself is drawn on the parchment. */
  private footerLabel: Phaser.GameObjects.Text;
  /** Per-render tiles / labels destroyed on refresh + clear. */
  private transient: Phaser.GameObjects.GameObject[] = [];
  /** The Conditions text lines (#129), rebuilt for the highlighted biome on
   *  refresh + on pick-cursor move (kept apart from {@linkcode transient} so a
   *  cursor move can re-list conditions without rebuilding the whole map). */
  private condLines: Phaser.GameObjects.GameObject[] = [];
  /** The biome the footer is currently describing (avoids a needless rebuild). */
  private condBiome: BiomeId | undefined;

  private onClose: ErMapCloseCallback | null = null;
  private resolved = false;

  private history: readonly BiomeId[] = [];
  private onward: readonly ErRouteNode[] = [];
  /** Left index of the visible journey window (scrolls when history overflows). */
  private scroll = 0;

  // --- Pick mode (the biome-transition route chooser) ---------------------
  /** True when opened as the LEAVE-biome route picker (selectable), not the
   * read-only J overlay. */
  private pickMode = false;
  /** Fired with the chosen onward biome when the player confirms (pick mode). */
  private onPick: ((biome: BiomeId) => void) | null = null;
  /** Cursor index into {@linkcode onward} while picking. */
  private pickCursor = 0;
  /** Screen-x of each drawn onward tile (parallel to the visible onward slice). */
  private onwardTileX: number[] = [];
  /** Screen-y of the onward tile row (set during refresh). */
  private onwardRowY = 0;
  /** The cursored onward tile is marked by reddening its OWN border + name (pick
   * mode), so these per-render arrays are recolored on cursor move - no extra box. */
  private onwardBorders: Phaser.GameObjects.Rectangle[] = [];
  private onwardNames: Phaser.GameObjects.Text[] = [];
  private onwardColors: number[] = [];

  /** How many journey tiles fit across the panel. */
  private static readonly VISIBLE = Math.floor((PANEL_W - 20) / (TILE_W + TILE_GAP));
  private static readonly JOURNEY_Y = 44;
  private static readonly ROUTES_Y = 84;

  constructor() {
    super(UiMode.ER_MAP);
  }

  setup(): void {
    const ui = this.getUi();
    const w = globalScene.scaledCanvas.width;
    const h = globalScene.scaledCanvas.height;
    const px = (w - PANEL_W) / 2;
    const py = (h - PANEL_H) / 2;

    this.container = globalScene.add.container(0, -h);
    this.container.setVisible(false);
    ui.add(this.container);

    // Warm, parchment-friendly dim behind the modal.
    const dim = globalScene.add.rectangle(0, 0, w, h, 0x140d06, 0.62).setOrigin(0, 0);
    this.container.add(dim);

    this.card = globalScene.add.container(px, py);
    this.container.add(this.card);

    // The aged-parchment panel, leather frame, compass watermark + Conditions
    // cartouche, all drawn once with Graphics (so the ancient-map look is ours,
    // not the default window theme).
    this.parchment = globalScene.add.graphics();
    drawErParchment(this.parchment);
    this.card.add(this.parchment);

    this.headerText = erInkText(PANEL_W / 2, 6, "World Map", INK_HEAD, "60px", "center");
    this.headerText.setOrigin(0.5, 0);
    this.card.add(this.headerText);

    this.fragmentText = erInkText(PANEL_W / 2, 18, "", INK, "38px", "center");
    this.fragmentText.setOrigin(0.5, 0);
    this.card.add(this.fragmentText);

    // Connector graphics sit UNDER the tiles (added before the transient sprites).
    this.graphics = globalScene.add.graphics();
    this.card.add(this.graphics);

    this.journeyLabel = erInkText(11, 30, "Your journey", INK_HEAD, "38px");
    this.journeyLabel.setOrigin(0, 0);
    this.card.add(this.journeyLabel);

    this.routesLabel = erInkText(11, 67, "Routes ahead", INK_HEAD, "38px");
    this.routesLabel.setOrigin(0, 0);
    this.card.add(this.routesLabel);

    // Conditions cartouche label (the inset box itself is drawn on the parchment).
    this.footerLabel = erInkText(FOOTER_PAD + 6, FOOTER_Y + 3, "Conditions", INK_HEAD, "38px");
    this.footerLabel.setOrigin(0, 0);
    this.card.add(this.footerLabel);

    this.emptyText = erInkText(PANEL_W / 2, ErMapUiHandler.ROUTES_Y, "", DIM, "38px", "center");
    this.emptyText.setOrigin(0.5, 0.5);
    this.emptyText.setVisible(false);
    this.card.add(this.emptyText);

    this.hintText = erInkText(PANEL_W / 2, PANEL_H - 12, "< > Scroll    B: Close", DIM, "36px", "center");
    this.hintText.setOrigin(0.5, 0);
    this.card.add(this.hintText);

    installErMapHotkey();
  }

  show(args: any[]): boolean {
    super.show(args);
    this.resolved = false;
    this.pickCursor = 0;

    const arg0 = args.length > 0 ? args[0] : null;
    const pickCfg =
      arg0 && typeof arg0 === "object" && typeof arg0.onSelect === "function"
        ? (arg0 as { nodes?: ErRouteNode[]; onSelect: (biome: BiomeId) => void })
        : null;

    this.history = getErBiomeHistory();
    if (pickCfg) {
      // PICK MODE: the leave-biome route chooser. Same visual map, but the onward
      // tiles are selectable (you pick where to travel next).
      this.pickMode = true;
      this.onPick = pickCfg.onSelect;
      this.onClose = null;
      this.onward = (pickCfg.nodes ?? []).filter(n => n.revealed);
      this.headerText.setText("Choose your route");
      this.hintText.setText("< > Choose    A: Travel");
    } else {
      // VIEW MODE: the read-only J overlay.
      this.pickMode = false;
      this.onPick = null;
      this.onClose = typeof arg0 === "function" ? (arg0 as ErMapCloseCallback) : null;
      // Onward routes = the revealed next-biome nodes the routing graph rolled for
      // this biome (the SAME set the picker offers); drawn as dashed branches.
      this.onward = getErPendingNodes().filter(n => n.revealed);
      this.headerText.setText("World Map");
      this.hintText.setText("< > Scroll    B: Close");
    }

    const frags = getTreasureFragments();
    this.fragmentText.setText(`Treasure-Map Fragments: ${frags} / ${TREASURE_FRAGMENTS_FOR_REWARD}`);

    // Default the journey window to the most recent biomes (current at the end).
    this.scroll = Math.max(0, this.history.length - ErMapUiHandler.VISIBLE);

    this.refresh();

    this.container.setVisible(true);
    this.container.parentContainer?.bringToTop(this.container);
    this.active = true;
    return true;
  }

  /** Build one biome thumbnail tile (bg image if loaded, else a dim placeholder). */
  private makeTile(biome: BiomeId, cx: number, cy: number, highlight: boolean): void {
    const key = `${getBiomeKey(biome)}_bg`;
    if (globalScene.textures.exists(key)) {
      const tile = globalScene.add.sprite(cx, cy, key);
      tile.setOrigin(0.5, 0.5);
      tile.setDisplaySize(TILE_W, TILE_H);
      this.card.add(tile);
      this.transient.push(tile);
    } else {
      const ph = globalScene.add.rectangle(cx, cy, TILE_W, TILE_H, 0x7a663f).setOrigin(0.5);
      this.card.add(ph);
      this.transient.push(ph);
    }
    // Tile frame: a red "you are here" border for the current biome, a thin brown
    // map frame otherwise.
    const border = globalScene.add.rectangle(cx, cy, TILE_W + 2, TILE_H + 2, 0xffffff, 0).setOrigin(0.5);
    border.setStrokeStyle(highlight ? 2 : 1, highlight ? MAP_RED : FRAME_MID);
    this.card.add(border);
    this.transient.push(border);

    const name = erInkText(
      cx,
      cy + TILE_H / 2 + 1,
      getBiomeName(biome),
      highlight ? MAP_RED_HEX : INK,
      "32px",
      "center",
    );
    name.setOrigin(0.5, 0);
    this.card.add(name);
    this.transient.push(name);
    // The current biome reads as current from its red frame + red name (and, in pick
    // mode, the red route cursor sits in the routes row below) - no extra "HERE" tag,
    // which would crowd the now-compact top band.
  }

  /** Draw a dashed line on the connector graphics (for not-yet-taken routes). */
  private drawDashedLine(x1: number, y1: number, x2: number, y2: number, color: number, alpha: number): void {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len === 0) {
      return;
    }
    const dash = 3;
    const gap = 3;
    const ux = dx / len;
    const uy = dy / len;
    this.graphics.lineStyle(2, color, alpha);
    for (let d = 0; d < len; d += dash + gap) {
      const segEnd = Math.min(d + dash, len);
      this.graphics.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * segEnd, y1 + uy * segEnd);
    }
  }

  /** Render the journey chain + onward routes for the current scroll position. */
  private refresh(): void {
    for (const o of this.transient) {
      o.destroy();
    }
    this.transient = [];
    this.graphics.clear();
    this.onwardBorders = [];
    this.onwardNames = [];
    this.onwardColors = [];

    const total = this.history.length;
    const currentBiome = total > 0 ? this.history[total - 1] : globalScene.arena?.biomeId;

    // --- Journey row: the visible window of visited biomes, connected L->R. ---
    const count = Math.min(ErMapUiHandler.VISIBLE, total);
    const rowW = count * TILE_W + Math.max(0, count - 1) * TILE_GAP;
    const startX = (PANEL_W - rowW) / 2 + TILE_W / 2;
    const cy = ErMapUiHandler.JOURNEY_Y;
    const tileX: number[] = [];
    for (let i = 0; i < count; i++) {
      const cx = startX + i * (TILE_W + TILE_GAP);
      tileX.push(cx);
      const histIndex = this.scroll + i;
      const biome = this.history[histIndex];
      if (biome === undefined) {
        continue;
      }
      // Connector from the previous tile.
      if (i > 0) {
        this.graphics.lineStyle(2, ROUTE, 1);
        this.graphics.lineBetween(tileX[i - 1] + TILE_W / 2, cy, cx - TILE_W / 2, cy);
      }
      this.makeTile(biome, cx, cy, histIndex === total - 1);
    }
    // "older biomes" hint when the window is scrolled off the start.
    if (this.scroll > 0 && count > 0) {
      const more = erInkText(4, cy, "<", DIM, "44px");
      more.setOrigin(0, 0.5);
      this.card.add(more);
      this.transient.push(more);
    }

    // --- Routes-ahead row: the revealed onward biome routes (branch from now). ---
    // These are paths you HAVEN'T taken yet, so they are drawn as DASHED branches
    // fanning out from below the current biome, and each tile is coloured by why
    // it is shown (gold = normal, green = Map-Upgrade route, blue = a foretold
    // mystery-event route).
    // Cap the drawn onward row at 5, but raise it by the Cartographer's Lens relic's
    // extra-node reveal so the extra onward node it reveals (#439) isn't truncated.
    const onwardCount = Math.min(5 + erCartographersLensExtraNodes(), this.onward.length);
    if (onwardCount > 0 && currentBiome !== undefined) {
      const oRowW = onwardCount * TILE_W + Math.max(0, onwardCount - 1) * TILE_GAP;
      const oStartX = (PANEL_W - oRowW) / 2 + TILE_W / 2;
      const oy = ErMapUiHandler.ROUTES_Y;
      this.onwardRowY = oy;
      this.onwardTileX = [];
      // Branch hub: a point just below the current journey tile that the dashed
      // routes fan out from.
      const hubX = tileX.at(-1) ?? PANEL_W / 2;
      const hubY = cy + TILE_H / 2 + 6;
      for (let i = 0; i < onwardCount; i++) {
        const cx = oStartX + i * (TILE_W + TILE_GAP);
        this.onwardTileX.push(cx);
        const node = this.onward[i];
        const color = routeColor(node.source);
        // Dashed branch from the hub to this onward tile (a not-yet-taken path).
        this.drawDashedLine(hubX, hubY, cx, oy - TILE_H / 2 - 2, color, 0.8);
        const key = `${getBiomeKey(node.biome)}_bg`;
        if (globalScene.textures.exists(key)) {
          const tile = globalScene.add.sprite(cx, oy, key);
          tile.setOrigin(0.5, 0.5);
          tile.setDisplaySize(TILE_W, TILE_H);
          tile.setAlpha(0.85); // slightly faded: a place you have not been yet
          this.card.add(tile);
          this.transient.push(tile);
        } else {
          const ph = globalScene.add.rectangle(cx, oy, TILE_W, TILE_H, 0x7a663f).setOrigin(0.5);
          this.card.add(ph);
          this.transient.push(ph);
        }
        const border = globalScene.add.rectangle(cx, oy, TILE_W + 2, TILE_H + 2, 0xffffff, 0).setOrigin(0.5);
        border.setStrokeStyle(1, color);
        this.card.add(border);
        this.transient.push(border);
        const name = erInkText(cx, oy + TILE_H / 2 + 1, getBiomeName(node.biome), INK, "32px", "center");
        name.setOrigin(0.5, 0);
        this.card.add(name);
        this.transient.push(name);
        // Track this tile's frame + name + base colour so the pick cursor can redden
        // the hovered option's OWN border (no separate moving box).
        this.onwardBorders.push(border);
        this.onwardNames.push(name);
        this.onwardColors.push(color);
      }
      this.routesLabel.setVisible(true);
      if (this.pickMode) {
        this.placePickCursor();
      }
    } else {
      this.routesLabel.setVisible(false);
    }

    // Empty state: a brand-new run with nothing to show yet.
    const nothing = total === 0 && onwardCount === 0;
    this.emptyText.setVisible(nothing);
    if (nothing) {
      this.emptyText.setText("Your journey begins...");
    }

    // Conditions footer (#129): describe the HIGHLIGHTED biome - in pick mode the
    // onward node under the cursor (placePickCursor above already listed it when
    // there are onward tiles; fall back to the cursor's biome here so a full
    // refresh always repaints the footer), otherwise the current biome (the
    // J-overlay "HERE" tile).
    this.renderConditions(this.pickMode ? this.onward[this.pickCursor]?.biome : currentBiome, true);
  }

  /**
   * Rebuild the Conditions footer (#129) for `biome`: its special mechanical
   * effect lines (or "No special conditions" when there are none). Only rebuilds
   * when the biome actually changed (cheap to call on every cursor move), unless
   * `force` (a fresh refresh()) is set.
   */
  private renderConditions(biome: BiomeId | undefined, force = false): void {
    if (!force && biome === this.condBiome) {
      return;
    }
    this.condBiome = biome;
    for (const o of this.condLines) {
      o.destroy();
    }
    this.condLines = [];

    const lines = biome === undefined ? [] : getErBiomeEffectLines(biome);
    if (lines.length === 0) {
      const none = erInkText(FOOTER_PAD + 6, COND_FIRST_Y, "No special conditions", DIM, "34px");
      none.setOrigin(0, 0);
      this.card.add(none);
      this.condLines.push(none);
      return;
    }
    for (let i = 0; i < lines.length; i++) {
      const line = erInkText(FOOTER_PAD + 6, COND_FIRST_Y + i * COND_LINE_H, lines[i], INK, "34px");
      line.setOrigin(0, 0);
      this.card.add(line);
      this.condLines.push(line);
    }

    // (Cartographer's Lens's "lookahead" is delivered by revealing one EXTRA onward
    // route node above, whose Conditions the player reads by cursoring it - NOT by a
    // speculative two-hop preview. Previewing biomes two hops out would call
    // rollErNextBiomeNodes for an un-rolled biome, consuming the seeded route RNG and
    // mutating event-reveal state, which DESYNCS the real route roll - the #616-class
    // hazard. Do not re-add a two-hop preview here without a pure, side-effect-free peek.)
  }

  /** Mark the cursored onward tile by reddening its OWN border + name (pick mode);
   *  every other tile reverts to its base route colour. No separate selection box. */
  private placePickCursor(): void {
    const count = this.onwardBorders.length;
    if (count === 0) {
      return;
    }
    this.pickCursor = Math.max(0, Math.min(this.pickCursor, count - 1));
    for (let i = 0; i < count; i++) {
      const sel = i === this.pickCursor;
      this.onwardBorders[i].setStrokeStyle(sel ? 2 : 1, sel ? MAP_RED : (this.onwardColors[i] ?? FRAME_MID));
      this.onwardNames[i]?.setColor(sel ? MAP_RED_HEX : INK);
    }
    // Pick mode (#129): the footer follows the cursor - list the conditions of the
    // onward biome the cursor is over (so the player compares routes by their rules).
    this.renderConditions(this.onward[this.pickCursor]?.biome);
  }

  processInput(button: Button): boolean {
    if (this.resolved) {
      return false;
    }
    // PICK MODE: Left/Right move the route cursor; ACTION travels; no cancel.
    if (this.pickMode) {
      switch (button) {
        case Button.LEFT:
          if (this.pickCursor > 0) {
            this.pickCursor--;
            this.placePickCursor();
            globalScene.ui.playSelect();
          }
          return true;
        case Button.RIGHT:
          if (this.pickCursor < this.onwardTileX.length - 1) {
            this.pickCursor++;
            this.placePickCursor();
            globalScene.ui.playSelect();
          }
          return true;
        case Button.ACTION: {
          const node = this.onward[this.pickCursor];
          if (node) {
            this.confirmPick(node.biome);
          }
          return true;
        }
        case Button.CANCEL:
          // No backing out - the run needs a next biome.
          return true;
      }
      return false;
    }
    // VIEW MODE: Left/Right scroll the journey; ACTION/CANCEL close.
    switch (button) {
      case Button.LEFT:
        if (this.scroll > 0) {
          this.scroll--;
          this.refresh();
          globalScene.ui.playSelect();
          return true;
        }
        return false;
      case Button.RIGHT:
        if (this.scroll + ErMapUiHandler.VISIBLE < this.history.length) {
          this.scroll++;
          this.refresh();
          globalScene.ui.playSelect();
          return true;
        }
        return false;
      case Button.ACTION:
      case Button.CANCEL:
        this.close();
        return true;
    }
    return false;
  }

  /** Confirm the chosen onward biome (pick mode) and hand control back. */
  private confirmPick(biome: BiomeId): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.active = false;
    globalScene.ui.playSelect();
    const cb = this.onPick;
    this.onPick = null;
    // Return the UI to MESSAGE before the biome-switch flow runs, then deliver.
    globalScene.ui.setMode(UiMode.MESSAGE);
    cb?.(biome);
  }

  private close(): void {
    if (this.resolved) {
      return;
    }
    this.resolved = true;
    this.active = false;
    globalScene.ui.playSelect();
    const cb = this.onClose;
    this.onClose = null;
    globalScene.ui.revertMode();
    cb?.();
  }

  clear(): void {
    super.clear();
    this.container.setVisible(false);
    for (const o of this.transient) {
      o.destroy();
    }
    this.transient = [];
    for (const o of this.condLines) {
      o.destroy();
    }
    this.condLines = [];
    this.condBiome = undefined;
    this.graphics.clear();
    this.onClose = null;
    this.onPick = null;
    this.pickMode = false;
    this.resolved = false;
    this.history = [];
    this.onward = [];
    this.onwardTileX = [];
    this.onwardBorders = [];
    this.onwardNames = [];
    this.onwardColors = [];
  }
}

/** Open the World Map overlay over the current screen. Optional close callback. */
export function openErMapOverlay(onClose?: ErMapCloseCallback): void {
  globalScene.ui.setOverlayMode(UiMode.ER_MAP, onClose);
}

let mapHotkeyInstalled = false;

/**
 * Install the global "J" hotkey that opens the World Map during a run. Registered
 * once (idempotent). Conservative: only from the in-battle COMMAND screen, never
 * while a text field is focused, never outside a run, never over another overlay.
 *
 * "J" is UNASSIGNED in the keyboard config (maps to -1), so it can't collide.
 */
export function installErMapHotkey(): void {
  if (mapHotkeyInstalled || typeof window === "undefined") {
    return;
  }
  mapHotkeyInstalled = true;
  window.addEventListener("keydown", (ev: KeyboardEvent) => {
    if (ev.key !== "j" && ev.key !== "J") {
      return;
    }
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      return;
    }
    if (!globalScene?.currentBattle || globalScene.ui?.getMode() !== UiMode.COMMAND) {
      return;
    }
    ev.preventDefault();
    openErMapOverlay();
  });
}
