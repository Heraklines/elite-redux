/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Comprehensive REAL-PAGE render harness core (no browser, no full-game boot).
//
// Renders ANY real UiHandler page to a PNG for visual/layout bug reproduction.
// Strategy:
//   1. Boot a normal headless GameManager -> full game DATA (species, gameData,
//      i18n) + every UI handler registered on `globalScene` (game.scene).
//   2. Boot a SECOND, real Phaser CANVAS scene backed by @napi-rs/canvas - the
//      only thing that can actually rasterize pixels (the GameManager scene is
//      HEADLESS + mock factories and renders nothing).
//   3. Re-point `globalScene`'s RENDER members (add/textures/anims/tweens/time/
//      cameras/ui + loadPokemonAtlas) at the CANVAS scene, keeping all DATA.
//      Now any handler built against globalScene renders real pixels.
//   4. Auto-inject assets in two passes: run the handler once to RECORD every
//      texture key it asks for (Phaser tolerates missing textures), resolve those
//      keys to local er-assets files, inject them, then render for real.
//
// This makes adding a page a small recipe (which handler + how to build show()
// args); the asset wiring configures itself. See PAGE_RECIPES below.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { ER_NEWCOMER_FRONT_ICON_SLUGS } from "#data/elite-redux/er-newcomer-species";
import { UiTheme } from "#enums/ui-theme";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { createCanvas, GlobalFonts, loadImage, Image as NapiImage } from "@napi-rs/canvas";
import Phaser from "phaser";

const ASSET_ROOTS = ["../er-assets", "public"];

// Loads whose texture KEY differs from the file BASENAME (loadImage(key, folder, filename)).
// Pure key==basename loads resolve automatically via the index; these few are renamed.
const KEY_FILE_OVERRIDES: Record<string, string> = {
  er_bargain_giratina: "images/elite-redux/the-bargain/giratina.png",
  // Shiny sparkle icons load as loadImage("shiny_star*", "ui", "shiny*.png") - key != basename.
  shiny_star: "images/ui/shiny.png",
  shiny_star_1: "images/ui/shiny_1.png",
  shiny_star_2: "images/ui/shiny_2.png",
  shiny_star_small: "images/ui/shiny_small.png",
  shiny_star_small_1: "images/ui/shiny_small_1.png",
  shiny_star_small_2: "images/ui/shiny_small_2.png",
};

// ---------------------------------------------------------------------------
// DOM + font shims (sidestep vitest-canvas-mock; give Phaser a real canvas/Image)
// ---------------------------------------------------------------------------

let domPatched = false;
export function patchDom(): void {
  if (domPatched) {
    return;
  }
  domPatched = true;
  const realCreate = document.createElement.bind(document);
  (document as any).createElement = (tag: string, ...rest: any[]) => {
    if (String(tag).toLowerCase() === "canvas") {
      const c: any = createCanvas(1, 1);
      c.style = {};
      c.setAttribute = () => {};
      c.addEventListener = () => {};
      c.removeEventListener = () => {};
      c.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        top: 0,
        left: 0,
        width: c.width,
        height: c.height,
        right: c.width,
        bottom: c.height,
      });
      return c;
    }
    return realCreate(tag, ...rest);
  };
  const realAppend = document.body.appendChild.bind(document.body);
  (document.body as any).appendChild = (node: any) => {
    try {
      return realAppend(node);
    } catch {
      return node;
    }
  };
  const ctxClass = createCanvas(1, 1).getContext("2d").constructor;
  (globalThis as any).CanvasRenderingContext2D = ctxClass;
  (globalThis as any).Image = NapiImage;
  (globalThis as any).HTMLImageElement = NapiImage;
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) => setTimeout(() => cb(performance.now()), 16);
  (globalThis as any).cancelAnimationFrame = (id: any) => clearTimeout(id);
}

// Phaser's NineSlice has NO canvas renderer (renderCanvas === NOOP); it is WebGL-only.
// The game runs WebGL in-browser (so window frames render there), but this harness uses
// a 2D @napi-rs canvas. Without this, every windowed panel (addWindow -> NineSlice) is
// invisible. Provide a faithful 9-slice canvas renderer so panels render.
let nineSlicePatched = false;
function patchNineSliceCanvas(): void {
  if (nineSlicePatched) {
    return;
  }
  nineSlicePatched = true;
  const proto: any = (Phaser.GameObjects as any).NineSlice?.prototype;
  if (!proto) {
    return;
  }
  proto.renderCanvas = (renderer: any, src: any) => {
    const w = Math.ceil(src.width);
    const h = Math.ceil(src.height);
    if (w <= 0 || h <= 0) {
      return;
    }
    const frame = src.frame;
    const img = frame?.source?.image;
    if (!img) {
      return;
    }
    const sx = frame.cutX;
    const sy = frame.cutY;
    const sw = frame.cutWidth;
    const sh = frame.cutHeight;
    const L = src.leftWidth;
    const R = src.rightWidth;
    const T = src.topHeight;
    const B = src.bottomHeight;
    const cw = sw - L - R; // center source width
    const ch = sh - T - B; // center source height
    const dw = w - L - R; // center dest width
    const dh = h - T - B; // center dest height
    // Build the 9-slice on an isolated offscreen (local space), so the optional tint
    // multiply clips to the panel's own alpha and never bleeds onto the backdrop.
    const off = createCanvas(w, h);
    const octx: any = off.getContext("2d");
    const slice = (oc: any) => {
      const d = (a: number, b: number, c: number, dd: number, e: number, f: number, g: number, hh: number) => {
        if (c <= 0 || dd <= 0 || g <= 0 || hh <= 0) {
          return;
        }
        oc.drawImage(img, a, b, c, dd, e, f, g, hh);
      };
      d(sx, sy, L, T, 0, 0, L, T);
      d(sx + sw - R, sy, R, T, w - R, 0, R, T);
      d(sx, sy + sh - B, L, B, 0, h - B, L, B);
      d(sx + sw - R, sy + sh - B, R, B, w - R, h - B, R, B);
      d(sx + L, sy, cw, T, L, 0, dw, T);
      d(sx + L, sy + sh - B, cw, B, L, h - B, dw, B);
      d(sx, sy + T, L, ch, 0, T, L, dh);
      d(sx + sw - R, sy + T, R, ch, w - R, T, R, dh);
      d(sx + L, sy + T, cw, ch, L, T, dw, dh);
    };
    slice(octx);
    // NineSlice has its own single `tint` property (it lacks the multi-vertex Tint component).
    const tint = src.tint;
    if (typeof tint === "number" && tint !== 0xffffff) {
      octx.globalCompositeOperation = "multiply";
      octx.fillStyle = `rgb(${(tint >> 16) & 0xff},${(tint >> 8) & 0xff},${tint & 0xff})`;
      octx.fillRect(0, 0, w, h);
      octx.globalCompositeOperation = "destination-in"; // clip tint back to the panel alpha
      slice(octx);
      octx.globalCompositeOperation = "source-over";
    }
    const ctx = renderer.currentContext || renderer.gameContext;
    const m = src.getWorldTransformMatrix();
    ctx.save();
    ctx.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
    ctx.globalAlpha = src.alpha;
    ctx.drawImage(off, -src.displayOriginX, -src.displayOriginY);
    ctx.restore();
  };
}

// Some game objects can reach render with a null/destroyed frame (e.g. a sprite mid
// texture-swap, or a key that never resolved). Phaser's canvas batchSprite then throws
// on `frame.canvasData`, blanking the WHOLE page. Guard it: skip the offending object
// (logging its texture key once per key) so the rest of the page still renders.
let canvasRendererPatched = false;
const loggedNullFrame = new Set<string>();
function patchCanvasRenderer(): void {
  if (canvasRendererPatched) {
    return;
  }
  canvasRendererPatched = true;
  const proto: any = (Phaser.Renderer as any)?.Canvas?.CanvasRenderer?.prototype;
  if (!proto?.batchSprite) {
    return;
  }
  const orig = proto.batchSprite;
  proto.batchSprite = function (sprite: any, frame: any, camera: any, parentTransformMatrix: any) {
    // A frame can reach here truthy but not fully initialized: missing `canvasData`
    // (the cropped source rect Phaser reads at CanvasRenderer.js:718) when its texture
    // was never injected, or `source.image` when the atlas resolved to no bitmap. Either
    // crashes batchSprite and blanks the whole page (notably during pass 1, BEFORE the
    // two-pass injector can resolve the key). Skip the offending object instead - the
    // key is still recorded by the add.* wrapper, so pass 2 injects and renders it.
    if (!frame || !frame.canvasData || !frame.source?.image) {
      const key = sprite?.texture?.key ?? sprite?.type ?? "?";
      if (!loggedNullFrame.has(key)) {
        loggedNullFrame.add(key);
        // biome-ignore lint/suspicious/noConsole: harness diagnostics
        console.log(`[render-harness] skipped uninitialized-frame object (texture key: ${key})`);
      }
      return;
    }
    return orig.call(this, sprite, frame, camera, parentTransformMatrix);
  };
}

// Neutralize animation across ALL tween managers (prototype level) + guard shape geom.
// Containers built via globalScene.add are bound to the render scene and call
// `this.scene.tweens.add/addCounter` directly; per-instance overrides miss managers
// created elsewhere. We run each tween's onUpdate ONCE at the final value then
// onComplete, so animated end-states (the IV stats hexagon, fade-ins) are faithful in
// the still snapshot without stepping half-built objects across frames.
let tweensPatched = false;
function patchTweensAndShapes(): void {
  if (tweensPatched) {
    return;
  }
  tweensPatched = true;
  const doneTween = { remove() {}, stop() {}, destroy() {}, isPlaying: () => false, getValue: () => 1 };
  const finalTween = { getValue: () => 1, totalProgress: 1, progress: 1, t: 1, getValueAt: () => 1 };
  const complete = (cfg: any) => {
    try {
      cfg?.onUpdate?.(finalTween, cfg?.targets);
    } catch {
      /* onUpdate signature mismatch - skip */
    }
    try {
      cfg?.onComplete?.();
    } catch {
      /* ignore */
    }
    return doneTween;
  };
  const TM: any = (Phaser.Tweens as any)?.TweenManager?.prototype;
  if (TM) {
    TM.add = (cfg: any) => complete(cfg);
    TM.addCounter = (cfg: any) => complete(cfg);
    TM.chain = (cfg: any) => {
      for (const t of cfg?.tweens ?? []) {
        complete(t);
      }
      return complete(cfg);
    };
  }
  // A mock/partially-built Polygon (null geom) must not crash the whole page on setTo.
  const Poly: any = (Phaser.GameObjects as any)?.Polygon?.prototype;
  if (Poly?.setTo) {
    const origSetTo = Poly.setTo;
    Poly.setTo = function (points: any) {
      if (!this.geom) {
        return this;
      }
      return origSetTo.call(this, points);
    };
  }
}

// The test framework's MockSprite (test/mocks/mocks-container/mock-sprite.ts) overwrites
// `Phaser.GameObjects.Sprite.prototype.setTexture/setFrame/setSizeToFrame` with no-ops on
// every MockSprite construction (during GameManager boot). That is process-wide, so in our
// real CANVAS render scene `sprite.setTexture(key)` silently does nothing - any sprite NOT
// textured via `.play()` (animations) renders blank (e.g. every pokemon_icons grid icon, the
// starter grid, shiny stars). Restore the genuine Phaser implementations from the component
// mixins (which the mock never touched). Must run AFTER boot, BEFORE rendering; idempotent.
function restoreSpriteTextureMethods(missing?: Set<string>): void {
  const components: any = (Phaser.GameObjects as any).Components;
  const proto: any = (Phaser.GameObjects as any).Sprite?.prototype;
  if (!components || !proto) {
    return;
  }
  if (typeof components.TextureCrop?.setTexture === "function") {
    proto.setTexture = components.TextureCrop.setTexture;
    // Post-creation setTexture(key) is an UNWRAPPED path the two-pass injector cannot
    // see through the add.* factory wrappers (e.g. BattleInfo.setMini swaps the box to
    // `pbinfo_*_mini` after construction). Record the miss so pass 2 injects it.
    if (missing) {
      const real = proto.setTexture;
      proto.setTexture = function (key: any, ...rest: any[]) {
        if (typeof key === "string" && key && this.scene?.textures && !this.scene.textures.exists(key)) {
          missing.add(key);
        }
        return real.call(this, key, ...rest);
      };
    }
  }
  if (typeof components.TextureCrop?.setFrame === "function") {
    proto.setFrame = components.TextureCrop.setFrame;
  }
  if (typeof components.Size?.setSizeToFrame === "function") {
    proto.setSizeToFrame = components.Size.setSizeToFrame;
  }
}

let fontsRegistered = false;
export function registerFonts(): void {
  if (fontsRegistered) {
    return;
  }
  fontsRegistered = true;
  for (const [rel, family] of [
    ["fonts/pokemon-bw.ttf", "emerald"],
    ["fonts/pokemon-emerald-pro.ttf", "pkmnems"],
  ] as [string, string][]) {
    const p = assetPath(rel);
    if (p) {
      GlobalFonts.registerFromPath(p, family);
    }
  }
}

let bitmapFontsRegistered = false;
/**
 * Register the "item-count" bitmap font (the stack-count / charge numerals drawn on
 * held-item icons) into the CANVAS scene's cache. The live game loads it with
 * `this.load.bitmapFont("item-count", ...)` in loading-scene; the harness has no
 * Phaser file loader, so parse the .xml + .png by hand (jsdom supplies DOMParser).
 * Without it every page that draws a STACKABLE held-item icon (the summary items
 * row, the reward shop, the battle modifier bar) throws "Invalid BitmapText key:
 * item-count" and blanks. Idempotent + safe to call each render.
 */
export async function registerBitmapFonts(scene: Phaser.Scene): Promise<void> {
  if (bitmapFontsRegistered || scene.cache.bitmapFont.has("item-count")) {
    bitmapFontsRegistered = true;
    return;
  }
  const png = assetPath("fonts/item-count.png");
  const xmlPath = assetPath("fonts/item-count.xml");
  if (!png || !xmlPath) {
    return;
  }
  if (!scene.textures.exists("item-count")) {
    const img = await loadImage(png);
    scene.textures.addImage("item-count", img as any);
  }
  const texture = scene.textures.get("item-count");
  const xml = new DOMParser().parseFromString(readFileSync(xmlPath, "utf8"), "text/xml");
  const data = (Phaser.GameObjects.BitmapText as any).ParseXMLBitmapFont(xml, texture.get(), 0, 0, texture);
  scene.cache.bitmapFont.add("item-count", { data, texture: "item-count", frame: null });
  bitmapFontsRegistered = true;
}

// ---------------------------------------------------------------------------
// Asset resolution: basename -> file index over the UI-ish asset dirs
// ---------------------------------------------------------------------------

function assetPath(rel: string): string | null {
  for (const root of ASSET_ROOTS) {
    const p = join(root, rel);
    if (existsSync(p)) {
      return p;
    }
  }
  return null;
}

let assetIndex: Map<string, string> | null = null;
/** Build a basename(no-ext) -> absolute-png-path index over UI asset dirs (not the pokemon mass). */
function buildAssetIndex(): Map<string, string> {
  if (assetIndex) {
    return assetIndex;
  }
  const index = new Map<string, string>();
  // Walk the WHOLE images/ tree by basename (first-wins) so any UI/icon/effect/egg/trainer
  // asset a handler asks for resolves automatically - keeps the harness comprehensive for
  // new screens without per-key wiring. Skip only the massive images/pokemon mass (battle
  // sprites; those load by atlasPath via loadPokemonAtlas, never by bare basename) for speed.
  const SKIP_DIRS = new Set(["pokemon"]);
  const walk = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(e)) {
          walk(full);
        }
      } else if (extname(e).toLowerCase() === ".png") {
        const base = e.slice(0, -4);
        if (!index.has(base)) {
          index.set(base, full);
        }
      }
    }
  };
  for (const root of ASSET_ROOTS) {
    // images/ui FIRST so ui chrome keys resolve to the real ui asset even when an
    // unrelated screen ships a same-named file (e.g. elite-redux/dexnav/cursor.png
    // must not shadow ui/cursor.png - the game's loadImage defaults to the ui dir).
    walk(join(root, "images", "ui"));
    walk(join(root, "images"));
  }
  assetIndex = index;
  return index;
}

/** Resolve a texture KEY to a local PNG path (override map -> er-icon rule -> basename index). */
function resolveTextureFile(key: string): string | null {
  const override = KEY_FILE_OVERRIDES[key];
  if (override) {
    return assetPath(override);
  }
  // ER custom species icons load as loadAtlas(`er_icon__${slug}`, `pokemon/elite-redux/${slug}`,
  // "icon") - see loading-scene.ts. Mirror that key->file rule (it lives under images/pokemon,
  // which the basename index deliberately skips). Black-shiny variants fall back to the base.
  const erIcon = /^er_icon__(.+)$/.exec(key);
  if (erIcon) {
    const slug = erIcon[1];
    // Icon-from-front species (e.g. Regitube) load their FRONT atlas under the
    // icon key at runtime (loading-scene.ts) - mirror that here so the harness
    // renders the same downscaled front frame the game shows.
    if (ER_NEWCOMER_FRONT_ICON_SLUGS.has(slug)) {
      return assetPath(`images/pokemon/elite-redux/${slug}/front.png`);
    }
    return (
      assetPath(`images/pokemon/elite-redux/${slug}/icon.png`)
      ?? assetPath(`images/pokemon/black/elite-redux/${slug}/icon.png`)
    );
  }
  return buildAssetIndex().get(key) ?? null;
}

/**
 * Register a parsed atlas JSON's frames on a texture. Handles BOTH TexturePacker output
 * shapes the assets use: the ARRAY form (`{textures:[{frames:[{filename,frame,...}]}]}`
 * or `{frames:[...]}` - pokemon battle atlases) and the HASH form
 * (`{frames:{"C.png":{frame,...}}}` - ui atlases like keyboard/button_tera/types).
 * Applies trim data so trimmed frames draw at their in-game offsets.
 */
function addAtlasFrames(tex: Phaser.Textures.Texture, atlas: any): void {
  const framesNode = atlas?.textures?.[0]?.frames ?? atlas?.frames;
  if (!framesNode) {
    return;
  }
  const entries: [string, any][] = Array.isArray(framesNode)
    ? framesNode.filter((f: any) => f?.filename && f?.frame).map((f: any) => [f.filename, f])
    : Object.entries(framesNode).filter(([, f]: [string, any]) => f?.frame);
  // Mirror Phaser's JSONHash/JSONArray parsers: copy every non-frames top-level JSON
  // key onto the texture's customData, so authored metadata (e.g. an `animation`
  // cadence block for multi-frame ER "GIF" atlases) is readable exactly as in-game.
  (tex as any).customData ??= {};
  const cd = (tex as any).customData as Record<string, any>;
  for (const key of Object.keys(atlas)) {
    if (key === "frames" || key === "textures") {
      continue;
    }
    cd[key] = atlas[key];
  }
  for (const [name, f] of entries) {
    const fr = tex.add(name, 0, f.frame.x, f.frame.y, f.frame.w, f.frame.h);
    if (fr && f.trimmed && f.sourceSize && f.spriteSourceSize) {
      fr.setTrim(
        f.sourceSize.w,
        f.sourceSize.h,
        f.spriteSourceSize.x,
        f.spriteSourceSize.y,
        f.spriteSourceSize.w,
        f.spriteSourceSize.h,
      );
    }
  }
}

/** Inject `key`'s PNG (+ sibling .json atlas frames, if present) into the live TextureManager. */
async function injectTextureByKey(scene: Phaser.Scene, key: string): Promise<boolean> {
  if (scene.textures.exists(key)) {
    return true;
  }
  const png = resolveTextureFile(key);
  if (!png) {
    return false;
  }
  const img = await loadImage(png);
  const tex = scene.textures.addImage(key, img as any);
  if (!tex) {
    return false;
  }
  const jsonPath = `${png.slice(0, -4)}.json`;
  if (existsSync(jsonPath)) {
    try {
      addAtlasFrames(tex, JSON.parse(readFileSync(jsonPath, "utf8")));
    } catch {
      /* leave as a single __BASE-frame texture */
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Render scene + globalScene re-pointing
// ---------------------------------------------------------------------------

export interface RenderContext {
  game: Phaser.Game;
  scene: Phaser.Scene;
  /** Texture keys requested via add.* that were missing (collected each pass). */
  missing: Set<string>;
  /** UI nesting target the handler container is parented into. */
  uiInner: Phaser.GameObjects.Container;
  /**
   * Scene-root layer the BATTLEFIELD renders into (arena bg + bases, pokemon sprites,
   * trainer, HP bars). Sits BELOW the ui layer, mirroring the game's field(0)/fieldUI(1)/
   * ui(2) depth order. Populated by `renderBattlefield`; cleared each two-pass run.
   */
  fieldRoot: Phaser.GameObjects.Container;
  snapshot(outPath: string): { nonBlankPx: number };
  step(): void;
}

const W = 1920;
const H = 1080;

/** Boot a real CANVAS scene and resolve once it is running. */
export function createRenderScene(): Promise<RenderContext> {
  patchDom();
  registerFonts();
  patchNineSliceCanvas();
  patchCanvasRenderer();
  patchTweensAndShapes();
  return new Promise<RenderContext>(resolve => {
    let game: Phaser.Game;
    const missing = new Set<string>();
    game = new Phaser.Game({
      type: Phaser.CANVAS,
      width: W,
      height: H,
      audio: { noAudio: true },
      banner: false,
      scene: {
        create(this: Phaser.Scene) {
          // Auto-complete this scene's tweens (jump to the end, never step onUpdate).
          // Containers built via globalScene.add are bound to THIS scene, so they call
          // `this.scene.tweens.add` directly - real stepping crashes half-built objects
          // (e.g. the stats-hexagon Polygon onUpdate) and leaves fade-ins at frame 0.
          const tw: any = this.tweens;
          const doneTween = { remove() {}, stop() {}, destroy() {}, isPlaying: () => false };
          tw.add = (cfg: any) => {
            cfg?.onComplete?.();
            return doneTween;
          };
          tw.addCounter = (cfg: any) => {
            cfg?.onComplete?.();
            return doneTween;
          };
          tw.chain = (cfg: any) => {
            for (const t of cfg?.tweens ?? []) {
              t?.onComplete?.();
            }
            cfg?.onComplete?.();
            return doneTween;
          };

          // Battlefield layer FIRST so it draws beneath the ui layer (game depth
          // order: field(0) / fieldUI(1) / ui(2)). renderBattlefield fills it.
          const fieldRoot = this.add.container(0, 0);

          // x6 logical->screen nesting: uiLayer(scale 6) -> uiInner(0,180) so a
          // handler container at (0,-180) maps child (0,0) to screen (0,0).
          const uiLayer = this.add.container(0, 0).setScale(6);
          const uiInner = this.add.container(0, 180);
          uiLayer.add(uiInner);

          // Wrap the factory to RECORD requested-but-missing texture keys (pass 1).
          for (const fn of ["image", "sprite", "nineslice"] as const) {
            const orig = (this.add as any)[fn].bind(this.add);
            (this.add as any)[fn] = (...args: any[]) => {
              const key = args[2];
              if (typeof key === "string" && key && !this.textures.exists(key)) {
                missing.add(key);
              }
              return orig(...args);
            };
          }

          // Step with a VIRTUAL, fixed-delta clock (not performance.now()) so the render is
          // deterministic run-to-run: a given step COUNT always lands sprite animations on the
          // same frame, which is what makes golden-image pixel diffing stable.
          let vclock = 0;
          const step = () => {
            vclock += 16;
            game.step(vclock, 16);
          };
          const snapshot = (outPath: string) => {
            const canvas: any = game.canvas;
            const ctx = canvas.getContext("2d");
            const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
            let nonBlank = 0;
            for (let i = 0; i < data.length; i += 4) {
              if (data[i] || data[i + 1] || data[i + 2]) {
                nonBlank++;
              }
            }
            mkdirSync(dirname(outPath), { recursive: true });
            writeFileSync(outPath, canvas.toBuffer("image/png"));
            return { nonBlankPx: nonBlank };
          };
          resolve({ game, scene: this, missing, uiInner, fieldRoot, snapshot, step });
        },
      },
    });
  });
}

/**
 * Build the `globalScene.ui` surface the handlers attach to and drive input through.
 * It is stateful so input driving works UNIVERSALLY for any screen/menu: it tracks the
 * currently-active handler (`getHandler`) and, when an input handler calls `setMode(...)`
 * to hand off to another screen (a confirm dialog, an option select, a sub-menu), it
 * builds a FRESH instance of that target handler, `setup()`s + `show()`s it into the same
 * render container, and makes it active - so subsequent input routes there and it renders.
 * `originalUi` is the REAL `globalScene.ui` captured before we overwrite it (its `.handlers`
 * registry gives us each mode's handler class to construct fresh from).
 */
function makeUiSurface(ctx: RenderContext, originalUi: any): any {
  const handlersReg: any = originalUi?.handlers ?? {};
  const cache = new Map<any, any>(); // mode -> fresh handler instance (built on demand)
  const stack: any[] = []; // mode history, for revertMode()
  let active: any = null;
  // Universal no-op: returns itself for any property access AND is callable, so handlers that
  // poke at the message handler's display members (e.g. CommandUiHandler does
  // `getMessageHandler().bg.setVisible(true)`, `.message.setWordWrapWidth(...)`) degrade to
  // no-ops instead of crashing on `undefined`. (The message bar/battlefield are scene-level,
  // not part of the rendered handler container, so they are no-ops here by design.)
  const noopChain: any = new Proxy(() => {}, {
    get: () => noopChain,
    apply: () => noopChain,
  });
  const msg = noopChain;

  // Construct a fresh handler for a mode (the registered instance's children are MockSprites
  // from GameManager boot, so we mirror the primary-page approach and build a new one).
  const buildFresh = (mode: any): any => {
    if (cache.has(mode)) {
      return cache.get(mode);
    }
    const reg = handlersReg[mode];
    const Ctor = reg?.constructor;
    if (!Ctor) {
      return null;
    }
    let h: any;
    try {
      h = new Ctor();
    } catch {
      h = reg; // some handlers need ctor args - fall back to the registered instance
    }
    // Let setup() throw: an input-triggered transition that crashes a sub-handler IS the
    // bug we want to reproduce, so it must propagate (-> the test's stepCrash / renderError),
    // not be silently swallowed. (Per Codex review.)
    h.setup?.(); // parents its container into uiInner via ui.add
    cache.set(mode, h);
    return h;
  };

  const ui: any = {
    handlers: handlersReg,
    add: (c: any) => ctx.uiInner.add(c),
    bringToTop: (c: any) => {
      try {
        ctx.uiInner.bringToTop(c);
      } catch {
        /* not a direct child - ignore */
      }
    },
    playSelect: () => {},
    playError: () => {},
    showText: () => {},
    showDialogue: () => {},
    clearText: () => {},
    showTooltip: () => {},
    hideTooltip: () => {},
    getMessageHandler: () => msg,
    getHandler: () => active ?? undefined,
    // Some handlers branch on the current mode during render (e.g. the OPTION_SELECT
    // handler widens for AUTO_COMPLETE). Report the active handler's mode so that
    // check resolves correctly; undefined for the base/no-handler case.
    getMode: () => active?.mode ?? undefined,
    // --- harness hooks (not part of the real UI surface) ---
    setActiveHandler: (h: any) => {
      active = h;
    },
    resetHandlers: () => {
      cache.clear();
      stack.length = 0;
      active = null;
    },
    // --- real UI surface input handlers use to swap screens ---
    setMode: (mode: any, ...args: any[]) => {
      const h = buildFresh(mode);
      if (h) {
        if (active && active !== h) {
          stack.push(active);
        }
        active = h;
        // Let show() throw too - a transition crash must surface, not be hidden (Codex review).
        h.show?.(args);
      }
      return Promise.resolve();
    },
    revertMode: () => {
      try {
        active?.clear?.();
      } catch {
        /* ignore */
      }
      active = stack.pop() ?? active;
      return Promise.resolve();
    },
  };
  ui.setModeWithoutClear = (mode: any, ...args: any[]) => ui.setMode(mode, ...args);
  ui.setModeForceTransition = (mode: any, ...args: any[]) => ui.setMode(mode, ...args);
  ui.setOverlayMode = (mode: any, ...args: any[]) => ui.setMode(mode, ...args);
  ui.revertModes = () => {
    while (stack.length > 0) {
      ui.revertMode();
    }
    return Promise.resolve();
  };
  return ui;
}

/** Re-point `globalScene` (the GameManager mock BattleScene) render members at the CANVAS scene. */
export function repointGlobalScene(gs: any, ctx: RenderContext): void {
  // Undo the MockSprite prototype clobbering now that boot is done and we render for real.
  restoreSpriteTextureMethods(ctx.missing);
  // Stash the REAL render members once, so a batch run can restore them before constructing
  // the NEXT page's GameManager (which re-instruments the real UI, e.g. spies setModeInternal -
  // that fails against our mock `ui`). See `restoreGlobalScene`.
  if (!gs.__erOrigRender) {
    gs.__erOrigRender = {
      add: gs.add,
      make: gs.make,
      textures: gs.textures,
      anims: gs.anims,
      cameras: gs.cameras,
      sys: gs.sys,
      ui: gs.ui,
      uiTheme: gs.uiTheme,
      windowType: gs.windowType,
      loadPokemonAtlas: gs.loadPokemonAtlas,
    };
  }
  const renderScene = ctx.scene as any;
  gs.add = renderScene.add;
  gs.make = renderScene.make;
  gs.textures = renderScene.textures;
  gs.anims = renderScene.anims;
  gs.cameras = renderScene.cameras;
  gs.sys = renderScene.sys;
  // Deliberately NOT re-pointing `tweens`/`time`: the GameManager mocks auto-complete
  // tweens (jump to the final state) and no-op timers, which is exactly what a static
  // snapshot wants - real tweens would step half-built objects (e.g. the stats-hexagon
  // Polygon onUpdate) and crash, and would leave fade-ins stuck at frame 0.
  // Default theme + a window type that has a real asset (game sets this via settings).
  gs.uiTheme = UiTheme.DEFAULT;
  gs.windowType = 1;
  // UI surface the handler containers attach to (renders into the x6 nesting). Capture the
  // REAL ui (its `.handlers` registry) BEFORE overwriting, so the surface can build fresh
  // sub-handlers on `setMode` for universal input driving.
  gs.ui = makeUiSurface(ctx, gs.ui);
  // Pokemon battle/portrait sprites load on demand through here; inject from local files.
  // ER_SIMULATE_MISSING=1 makes this a no-op to reproduce "atlas never reaches the
  // client" bugs (e.g. the staging Giratina-Origin battle sprite that wouldn't load).
  const simulateMissing = process.env.ER_SIMULATE_MISSING === "1";
  gs.loadPokemonAtlas = (key: string, atlasPath: string) => {
    // atlasPath e.g. "elite-redux/giratina_origin/front" or "487-origin".
    if (simulateMissing) {
      return;
    }
    void injectAtlasByPath(renderScene, key, atlasPath);
  };
}

/**
 * Restore the scene's real render members (saved by the first `repointGlobalScene`). Call this
 * before constructing the next page's GameManager in a batch run, so the test framework re-spies
 * the genuine UI rather than our render mock.
 */
export function restoreGlobalScene(gs: any): void {
  if (gs?.__erOrigRender) {
    Object.assign(gs, gs.__erOrigRender);
  }
}

/** Inject a pokemon atlas (key, atlasPath under images/pokemon) into the render TextureManager. */
async function injectAtlasByPath(scene: Phaser.Scene, key: string, atlasPath: string): Promise<boolean> {
  if (scene.textures.exists(key)) {
    return true;
  }
  const png = assetPath(`images/pokemon/${atlasPath}.png`) ?? assetPath(`images/pokemon/variant/${atlasPath}.png`);
  if (!png) {
    return false;
  }
  const img = await loadImage(png);
  const tex = scene.textures.addImage(key, img as any);
  if (tex) {
    const jsonPath = `${png.slice(0, -4)}.json`;
    if (existsSync(jsonPath)) {
      try {
        addAtlasFrames(tex, JSON.parse(readFileSync(jsonPath, "utf8")));
      } catch {
        /* single frame */
      }
    }
  }
  return !!tex;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * Resolve + inject every texture key currently recorded in `ctx.missing` (then clear it).
 * Used by `renderTwoPass` and by per-step input driving (a freshly opened sub-menu requests
 * its own textures, which must be injected before it can render).
 */
export async function injectMissing(ctx: RenderContext): Promise<{ injected: string[]; unresolved: string[] }> {
  const keys = [...ctx.missing];
  ctx.missing.clear();
  const results = await Promise.all(keys.map(async k => ({ k, ok: await injectTextureByKey(ctx.scene, k) })));
  return {
    injected: results.filter(r => r.ok).map(r => r.k),
    unresolved: results.filter(r => !r.ok).map(r => r.k),
  };
}

/**
 * Pin every playing sprite animation under `root` to its first frame and pause it, so the
 * snapshot is deterministic (idle anims otherwise land on a different frame each run, which
 * makes golden-image diffing flag the sprite every time). Walk the container tree.
 */
export function freezeAnimations(root: any, depth = 0): void {
  if (!root || depth > 16) {
    return;
  }
  const anims = root.anims;
  if (anims?.currentAnim && typeof anims.setProgress === "function") {
    try {
      anims.setProgress(0);
      anims.pause?.();
    } catch {
      /* not animating - ignore */
    }
  }
  for (const c of root.list ?? []) {
    freezeAnimations(c, depth + 1);
  }
}

/**
 * Pixel-compare two PNGs (the current render vs a committed golden baseline). A pixel counts
 * as changed if any RGB channel differs by more than `channelTol` (ignores trivial AA noise).
 * Mismatched dimensions count the whole frame as changed. If `diffOut` is given, writes a diff
 * PNG: changed pixels in solid red over a dimmed copy of the current image. Dependency-free.
 */
export async function pixelDiff(
  currentPath: string,
  baselinePath: string,
  diffOut?: string,
  channelTol = 12,
): Promise<{ changed: number; total: number; dimsMatch: boolean }> {
  const [cur, base] = await Promise.all([loadImage(currentPath), loadImage(baselinePath)]);
  const w = cur.width;
  const h = cur.height;
  const dimsMatch = cur.width === base.width && cur.height === base.height;
  const read = (img: any, iw: number, ih: number) => {
    const c = createCanvas(iw, ih);
    const cx: any = c.getContext("2d");
    cx.drawImage(img, 0, 0);
    return cx.getImageData(0, 0, iw, ih).data as Uint8ClampedArray;
  };
  const a = read(cur, w, h);
  const total = w * h;
  if (!dimsMatch) {
    return { changed: total, total, dimsMatch: false };
  }
  const b = read(base, base.width, base.height);
  let changed = 0;
  let diffData: Uint8ClampedArray | null = null;
  let dctx: any = null;
  let diffCanvas: any = null;
  if (diffOut) {
    diffCanvas = createCanvas(w, h);
    dctx = diffCanvas.getContext("2d");
    diffData = dctx.createImageData(w, h).data;
  }
  for (let i = 0; i < a.length; i += 4) {
    const dr = Math.abs(a[i] - b[i]);
    const dg = Math.abs(a[i + 1] - b[i + 1]);
    const db = Math.abs(a[i + 2] - b[i + 2]);
    const isDiff = dr > channelTol || dg > channelTol || db > channelTol;
    if (isDiff) {
      changed++;
    }
    if (diffData) {
      if (isDiff) {
        diffData[i] = 255;
        diffData[i + 1] = 0;
        diffData[i + 2] = 0;
        diffData[i + 3] = 255;
      } else {
        // dimmed current pixel for context
        diffData[i] = a[i] >> 2;
        diffData[i + 1] = a[i + 1] >> 2;
        diffData[i + 2] = a[i + 2] >> 2;
        diffData[i + 3] = 255;
      }
    }
  }
  if (diffOut && dctx && diffCanvas) {
    const id = dctx.createImageData(w, h);
    id.data.set(diffData as Uint8ClampedArray);
    dctx.putImageData(id, 0, 0);
    mkdirSync(dirname(diffOut), { recursive: true });
    writeFileSync(diffOut, diffCanvas.toBuffer("image/png"));
  }
  return { changed, total, dimsMatch: true };
}

// ---------------------------------------------------------------------------
// Battlefield rendering (the combat gap)
// ---------------------------------------------------------------------------
//
// The battle FIELD is scene-level, not a UiHandler: `field` container (arena bases,
// pokemon sprites, trainer) + `fieldUI` (BattleInfo HP bars) + the scene-level
// `arenaBg`. In a headless GameManager all of it exists but was built with MOCK
// factories, so it rasterizes nothing. This rebuilds it on the render scene from
// LIVE game state:
//   - visibility/existence mirror the live scene graph (a lingering trainer sprite
//     or a still-visible fainted mon reproduces faithfully),
//   - texture keys are RE-DERIVED via the real game code paths
//     (getBattleSpriteKey/AtlasPath, arena.getBgTextureKey, getBiomeKey()_a/_b,
//     trainer.getKey) because the mocks no-op setTexture()/play(),
//   - layout positions are the real constants + the real offset code
//     (fieldSpriteOffset via getFieldPositionOffset, barSlotOffset via
//     setSlotOffset/applyTripleThin) because the framework's tween mock only fires
//     onComplete and never applies tweened values, so live x/y hold base coords.
// Known residuals (documented in CLAUDE.md): no fusion second-sprite, no
// weather/fog overlays, field scale fixed at x6, tween-final positions lost.

/** One rebuilt battlefield element, for diagnostics. */
interface FieldElement {
  kind: string;
  key?: string;
  error?: string;
}

/** Read live transform state off a real GO or a MockSprite (inner phaserSprite). */
function liveState(node: any): { x: number; y: number; visible: boolean; alpha: number } {
  const inner = node?.phaserSprite ?? node;
  return {
    x: Number(inner?.x ?? 0),
    y: Number(inner?.y ?? 0),
    visible: inner?.visible !== false,
    alpha: typeof inner?.alpha === "number" ? inner.alpha : 1,
  };
}

/** Pin a freshly-created atlas sprite to its first real frame (not the __BASE sheet). */
function setFirstAtlasFrame(scene: Phaser.Scene, spr: any, key: string): void {
  try {
    if (!scene.textures.exists(key)) {
      return;
    }
    const names: string[] = scene.textures.get(key).getFrameNames?.() ?? [];
    if (names.length > 0) {
      spr.setFrame([...names].sort()[0]);
    }
  } catch {
    /* single-frame texture - fine as-is */
  }
}

/**
 * Rebuild the battlefield from live game state into `ctx.fieldRoot`. Call inside the
 * `run()` of `renderTwoPass` (AFTER `repointGlobalScene`), before the page handler is
 * built, so the two-pass injector resolves the chrome textures (pbinfo_*, overlay_*,
 * numbers, {biome}_a/_b/_bg) and the pokemon atlases inject inline here.
 */
export async function renderBattlefield(
  gs: any,
  ctx: RenderContext,
  opts: { modifierBars?: boolean } = {},
): Promise<FieldElement[]> {
  const scene: any = ctx.scene;
  const built: FieldElement[] = [];
  const simulateMissing = process.env.ER_SIMULATE_MISSING === "1";
  // Dynamic import: keeps render-harness loadable without dragging the arena module
  // graph in at module-init time (it is only needed for field renders).
  const { getBiomeHasProps, getBiomeKey } = await import("#field/arena");
  const biomeId = gs.arena?.biomeId;
  const biomeKey = biomeId == null ? "plains" : getBiomeKey(biomeId);

  const addSprite = (parent: any, x: number, y: number, key: string, ox = 0.5, oy = 1) => {
    const spr = scene.add.sprite(x, y, key); // wrapped factory records missing keys
    spr.setOrigin(ox, oy);
    setFirstAtlasFrame(scene, spr, key);
    parent.add(spr);
    return spr;
  };

  // --- 1. Arena background (scene-level in the game: origin 0, scale 6).
  const bgState = liveState(gs.arenaBg);
  if (gs.arenaBg && bgState.visible) {
    const bgKey = gs.arena?.getBgTextureKey?.() ?? `${biomeKey}_bg`;
    addSprite(ctx.fieldRoot, 0, 0, bgKey, 0, 0).setScale(6).setAlpha(bgState.alpha);
    built.push({ kind: "arena-bg", key: bgKey });
  }

  // --- 2. The `field` container (x6): arena bases, trainers, pokemon.
  const fieldC = scene.add.container(0, 0).setScale(6);
  ctx.fieldRoot.add(fieldC);

  // Arena bases: player platform ({biome}_a at (300,0)) + enemy platform ({biome}_b at
  // (-280,0), plus seeded props). ArenaBase is a REAL container headlessly, so its
  // x/y/visible/propValue are live; only its mock sprite children lost their textures.
  for (const [baseObj, isPlayerBase] of [
    [gs.arenaPlayer, true],
    [gs.arenaEnemy, false],
  ] as const) {
    if (!baseObj || baseObj.visible === false) {
      continue;
    }
    const baseKey = `${biomeKey}_${isPlayerBase ? "a" : "b"}`;
    const cont = scene.add.container(baseObj.x ?? 0, baseObj.y ?? 0);
    fieldC.add(cont);
    addSprite(cont, 0, 0, baseKey, 0, 0);
    built.push({ kind: isPlayerBase ? "arena-player" : "arena-enemy", key: baseKey });
    if (!isPlayerBase && biomeId != null && getBiomeHasProps(biomeId)) {
      const propValue = Number(baseObj.propValue ?? 0);
      for (let p = 0; p < 3; p++) {
        if (propValue & (1 << p)) {
          addSprite(cont, 0, 0, `${biomeKey}_b_${p + 1}`, 0, 0);
          built.push({ kind: "arena-prop", key: `${biomeKey}_b_${p + 1}` });
        }
      }
    }
  }

  // Player trainer back sprite (MockSprite: transforms live on the inner phaserSprite;
  // texture key frozen at construction - which is also what the game would show).
  const trainerState = liveState(gs.trainer);
  if (gs.trainer && trainerState.visible) {
    const key = gs.trainer.texture?.key || "trainer_m_back";
    addSprite(fieldC, trainerState.x, trainerState.y, key, 0.5, 1).setAlpha(trainerState.alpha);
    built.push({ kind: "trainer-player", key });
  }

  // Enemy trainer (a REAL container with mock sprite children): rebuild via getKey().
  const enemyTrainer = gs.currentBattle?.trainer;
  if (enemyTrainer && enemyTrainer.visible !== false && typeof enemyTrainer.getKey === "function") {
    try {
      const cont = scene.add.container(enemyTrainer.x ?? 0, enemyTrainer.y ?? 0);
      cont.setScale(enemyTrainer.scaleX ?? 1, enemyTrainer.scaleY ?? 1);
      fieldC.add(cont);
      const isDouble = !!enemyTrainer.isDouble?.() && !enemyTrainer.config?.doubleOnly;
      addSprite(cont, isDouble ? -4 : 0, 0, enemyTrainer.getKey(), 0.5, 1);
      built.push({ kind: "trainer-enemy", key: enemyTrainer.getKey() });
      if (isDouble) {
        addSprite(cont, 28, 0, enemyTrainer.getKey(true), 0.5, 1);
        built.push({ kind: "trainer-enemy-partner", key: enemyTrainer.getKey(true) });
      }
    } catch (e) {
      built.push({ kind: "trainer-enemy", error: String(e) });
    }
  }

  // Pokemon: walk the LIVE field container children in order (so an object that
  // should have left the field but did not still shows up - that IS the bug class).
  // Positions are the CANONICAL side bases + the real slot-offset code, NOT live x/y:
  // the framework's tween mock only fires onComplete and never applies tweened values,
  // so live coords hold whatever pre-animation offset the intro slide left behind.
  const fieldChildren: any[] = gs.field?.list ?? [];
  for (const mon of fieldChildren) {
    if (typeof mon?.getBattleSpriteKey !== "function" || mon.visible === false) {
      continue;
    }
    try {
      const key = mon.getBattleSpriteKey();
      const atlasPath = mon.getBattleSpriteAtlasPath();
      if (!simulateMissing) {
        await injectAtlasByPath(scene, key, atlasPath);
      }
      const isPlayerMon = !!mon.isPlayer?.();
      const [baseX, baseY] = isPlayerMon ? [106, 148] : [236, 84];
      const off: [number, number] = mon.getFieldPositionOffset?.() ?? [0, 0];
      const cont = scene.add.container(baseX + off[0], baseY + off[1]);
      cont.setScale(mon.getSpriteScale?.() ?? 1);
      cont.setAlpha(typeof mon.alpha === "number" ? mon.alpha : 1);
      fieldC.add(cont);
      addSprite(cont, 0, 0, key, 0.5, 1);
      built.push({ kind: isPlayerMon ? "pokemon-player" : "pokemon-enemy", key });
    } catch (e) {
      built.push({ kind: "pokemon", error: String(e) });
    }
  }

  // --- 3. `fieldUI` (x6, anchored at the canvas bottom): fresh BattleInfo per live one.
  // The live instances hold live DATA but mock children; a fresh instance built against
  // the re-pointed factories renders real pixels, and the real slot-offset methods
  // reproduce double/triple bar stacking (they are direct sets, not tweens).
  const fieldUiC = scene.add.container(0, Number(scene.game.config.height)).setScale(6);
  ctx.fieldRoot.add(fieldUiC);
  const arrangement = gs.currentBattle?.arrangement;
  for (const mon of fieldChildren) {
    if (typeof mon?.getBattleSpriteKey !== "function") {
      continue;
    }
    const liveInfo = mon.battleInfo;
    if (!liveInfo || liveInfo.visible === false) {
      continue;
    }
    try {
      const Ctor: any = liveInfo.constructor;
      const fresh: any = new Ctor();
      fresh.initInfo(mon);
      if (typeof fresh.updateBossSegments === "function" && mon.isBoss?.()) {
        fresh.updateBossSegments(mon);
      }
      const isPlayerMon = !!mon.isPlayer?.();
      const capacity = arrangement ? (isPlayerMon ? arrangement.playerCapacity : arrangement.enemyCapacity) : 1;
      if (capacity > 1) {
        const slot = Math.max(0, Number(mon.getFieldIndex?.() ?? 0));
        fresh.setMini?.(true);
        fresh.setSlotOffset?.(slot, capacity);
        fresh.applyTripleThin?.(capacity, isPlayerMon);
      }
      fresh.setVisible(true);
      fieldUiC.add(fresh);
      built.push({ kind: isPlayerMon ? "battle-info-player" : "battle-info-enemy" });
    } catch (e) {
      built.push({ kind: "battle-info", error: String(e) });
    }
  }

  // --- 3.5 (opt-in): the top-of-screen MODIFIER BARS (held-item icon rows). Fresh
  // ModifierBar instances against the re-pointed factories, exactly like the fresh
  // BattleInfo above - so a new held item's icon (holder mini-icon + item sprite)
  // is verifiable in pixels on BOTH the ally and the enemy bar. Opt-in per recipe:
  // the pre-existing battle goldens were captured without bars.
  if (opts.modifierBars) {
    try {
      const { ModifierBar, PersistentModifier } = await import("#modifiers/modifier");
      const barsC = scene.add.container(0, 0).setScale(6);
      ctx.fieldRoot.add(barsC);
      for (const player of [true, false]) {
        const mods = ((player ? gs.modifiers : gs.enemyModifiers) ?? []).filter(
          (m: any) => m instanceof PersistentModifier,
        );
        const bar: any = new ModifierBar(!player);
        bar.updateModifiers(mods);
        bar.setVisible(true);
        barsC.add(bar);
        built.push({ kind: player ? "modifier-bar-player" : "modifier-bar-enemy", key: `${mods.length} modifiers` });
      }
    } catch (e) {
      built.push({ kind: "modifier-bars", error: String(e) });
    }
  }

  for (const el of built) {
    if (el.error) {
      // biome-ignore lint/suspicious/noConsole: harness diagnostics
      console.log(`[render-harness] battlefield element ${el.kind} failed: ${el.error}`);
    }
  }
  return built;
}

/**
 * Diagnostic: walk the render scene's display tree and report sprites that would draw
 * wrong pixels - texture "__MISSING" (created through an unwrapped path, e.g. make.* or
 * a post-creation setTexture, so the two-pass injector never saw the key) and sprites
 * stuck on the __BASE frame of a MULTI-frame atlas (a setFrame(name) that failed, which
 * renders the whole spritesheet). Returns human-readable lines; log them per page.
 */
export function findSuspectSprites(ctx: RenderContext): string[] {
  const suspects: string[] = [];
  const dumpAll = process.env.ER_RENDER_DUMP === "1";
  const walk = (node: any, path: string, depth: number): void => {
    // Invisible subtrees draw nothing - a hidden __MISSING is noise, not a defect.
    if (!node || depth > 14 || node.visible === false) {
      return;
    }
    const tex = node.texture;
    if (dumpAll && tex && node.visible !== false) {
      const m = node.getWorldTransformMatrix?.();
      const wx = m ? Math.round(m.getX(0, 0)) : Math.round(node.x);
      const wy = m ? Math.round(m.getY(0, 0)) : Math.round(node.y);
      // biome-ignore lint/suspicious/noConsole: harness diagnostics (env-gated)
      console.log(`[dump] ${path} tex="${tex.key}" frame="${node.frame?.name}" world=(${wx},${wy})`);
    }
    if (tex?.key === "__MISSING") {
      suspects.push(`__MISSING texture: ${path} at (${Math.round(node.x)},${Math.round(node.y)})`);
    } else if (tex && tex.frameTotal > 1 && node.frame?.name === "__BASE") {
      suspects.push(
        `whole-sheet render (__BASE of ${tex.frameTotal - 1}-frame atlas "${tex.key}"): ${path} at (${Math.round(node.x)},${Math.round(node.y)})`,
      );
    }
    const children: any[] = node.list ?? [];
    for (let i = 0; i < children.length; i++) {
      const c = children[i];
      walk(c, `${path}/${c?.name || c?.texture?.key || c?.type || i}`, depth + 1);
    }
  };
  walk({ list: (ctx.scene as any).children?.list ?? [] }, "scene", 0);
  return suspects;
}

/**
 * Purge every pending timer event on the GameManager scene's clock. Handlers that own an
 * ErShinyLabNameFx schedule a LOOPING frame-swap timer there; the harness renders throwaway
 * handlers it never destroy()s, so those timers leak and keep firing (the MockClock's setInterval
 * never stops) - crashing once their overlay sprite is destroyed. A static snapshot needs no
 * running timer, so clearing them is safe and renders nothing.
 */
export function purgeSceneTimers(): void {
  (globalScene as any)?.time?.removeAllEvents?.();
}

/**
 * Render a handler page in two passes: pass 1 records the texture keys it asks
 * for, we inject them, pass 2 renders for real. `run` should (re)build the page:
 * call handler.setup() + handler.show(args) against the re-pointed globalScene.
 */
export async function renderTwoPass(
  ctx: RenderContext,
  run: () => void | Promise<void>,
): Promise<{ injected: string[]; unresolved: string[] }> {
  // Pass 1: collect requested texture keys.
  await registerBitmapFonts(ctx.scene);
  purgeSceneTimers();
  ctx.uiInner.removeAll(true);
  ctx.fieldRoot.removeAll(true);
  ctx.missing.clear();
  await run();
  ctx.step();
  await sleep(30);
  // Inject everything pass 1 asked for that we can resolve locally.
  const { injected, unresolved } = await injectMissing(ctx);
  // Pass 2: rebuild now that textures exist (clear pass-1 objects first), then settle.
  // Purge the GameManager scene's clock BEFORE destroying pass-1's display objects: a page that
  // owns an ErShinyLabNameFx scheduled a LOOPING timer there (never destroy()'d - the harness
  // abandons pass-1's throwaway handler), and once removeAll(true) destroys the FX overlay sprite,
  // the orphaned timer's next tick() would setTexture on a destroyed sprite (scene undefined) and
  // throw. No render depends on that timer (the snapshot is a frozen still), so this changes no pixels.
  purgeSceneTimers();
  ctx.uiInner.removeAll(true);
  ctx.fieldRoot.removeAll(true);
  ctx.missing.clear();
  await run();
  for (let i = 0; i < 4; i++) {
    ctx.step();
    await sleep(20);
  }
  return { injected, unresolved };
}
