import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import {
  ER_TRANSFORM_MORPH_FILL_MS,
  ER_TRANSFORM_MORPH_MORPH_MS,
  playErTransformMorph,
} from "#sprites/er-form-transform-fx";
import { type Canvas, createCanvas } from "@napi-rs/canvas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * INSTRUMENTED TIMING evidence for the maintainer-reported staging (cold-CDN)
 * late-swap fix, driving the REAL {@linkcode playErTransformMorph} morph instance
 * (not just the pure {@linkcode planErMorphTick}) with REAL napi-canvas textures
 * and pixel readback - the actual canvas-texture MORPH path, which the render
 * harness can only reach on its fail-closed branch and which a real browser run
 * cannot exercise in this worktree (the battle-sprite assets submodule is empty -
 * see the report).
 *
 * It defers the `onSwap` (the target atlas "download") to a controllable elapsed
 * time exactly like a cold CDN, then steps the real per-frame tick over a fake
 * clock and records WHEN the reveal (per-type burst) fires. The reveal-start time
 * is the instrument: on the MORPH path the reveal cannot begin until the real
 * source->target morph has run; on the DEGRADE path it begins as soon as the swap
 * lands. In BOTH cases the glow must never end before the swap (the no-late-pop
 * invariant).
 */

const FILL = ER_TRANSFORM_MORPH_FILL_MS;
const MORPH = ER_TRANSFORM_MORPH_MORPH_MS;

/** Build a real napi-canvas battle-sprite texture whose opaque pixels are `fill(ctx)`. */
function makeSpriteTexture(w: number, h: number, fill: (ctx: ReturnType<Canvas["getContext"]>) => void) {
  const cv = createCanvas(w, h);
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgba(200,200,200,1)";
  fill(ctx);
  const frame = { name: "0", cutX: 0, cutY: 0, cutWidth: w, cutHeight: h, width: w, height: h, x: 0, y: 0 };
  return {
    frames: { "0": frame } as Record<string, unknown>,
    firstFrame: "0",
    getSourceImage: () => cv,
    source: [{ image: cv }],
  };
}

/** A chainable no-op game object (image/particle stub). */
function stubObj(): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const chain = () => obj;
  for (const m of ["setBlendMode", "setScale", "setStrokeStyle", "setAngle", "setDepth", "setOrigin", "setAlpha"]) {
    obj[m] = chain;
  }
  obj.destroy = () => {};
  return obj;
}

interface Rig {
  scene: BattleScene;
  now: { value: number };
  tickTo(elapsedMs: number): void;
  ellipseCount(): number;
  registerTexture(key: string, tex: unknown): void;
}

function installNapiScene(): Rig {
  const now = { value: 0 };
  const texMap = new Map<string, unknown>();
  let loopCb: (() => void) | null = null;
  let ellipses = 0;

  // A napi 2D canvas satisfies both `document.createElement("canvas")` (used by the
  // real pixel reader AND the morph's own scratch canvas) and the texture manager.
  vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
    if (tag === "canvas") {
      return createCanvas(2, 2) as unknown as HTMLElement;
    }
    return {} as HTMLElement;
  });

  const scene = {
    time: {
      get now() {
        return now.value;
      },
      delayedCall: () => ({ remove: () => {} }),
      addEvent: (cfg: { callback: () => void }) => {
        loopCb = cfg.callback;
        return { remove: () => (loopCb = null) };
      },
    },
    field: { add: () => {} },
    add: {
      ellipse: () => {
        ellipses++;
        return stubObj();
      },
      rectangle: () => stubObj(),
      image: () => stubObj(),
    },
    tweens: { add: () => ({ remove: () => {} }), killTweensOf: () => {} },
    textures: {
      exists: (k: string) => texMap.has(k),
      get: (k: string) => texMap.get(k),
      remove: (k: string) => texMap.delete(k),
      createCanvas: (_key: string, w: number, h: number) => {
        const c = createCanvas(w, h);
        return { context: c.getContext("2d") as unknown as CanvasRenderingContext2D, refresh: () => {} };
      },
    },
  } as unknown as BattleScene;

  initGlobalScene(scene);
  return {
    scene,
    now,
    ellipseCount: () => ellipses,
    registerTexture: (key, tex) => texMap.set(key, tex),
    tickTo(elapsedMs: number) {
      now.value = elapsedMs;
      loopCb?.();
    },
  };
}

/** Let the deferred `onSwap` microtask chain (swap -> captureTarget) settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await Promise.resolve();
  }
}

describe("ER transform morph - deferred-swap timing (real morph instance + real pixels)", () => {
  let prevScene: BattleScene | undefined;
  let rig: Rig;
  let runId = 0;

  beforeEach(() => {
    prevScene = globalScene;
    rig = installNapiScene();
  });

  afterEach(() => {
    if (prevScene) {
      initGlobalScene(prevScene);
    }
    vi.restoreAllMocks();
  });

  /**
   * Drive one run. `maskBuilds` registers a readable (different-shape) target
   * texture at the swap; otherwise the swap points at a key with no texture, so the
   * target mask read fails and the sequence must degrade.
   */
  async function run(opts: {
    swapAtMs: number;
    maskBuilds: boolean;
    end: number;
  }): Promise<{ revealAt: number | null; settled: boolean; revealedBeforeSwap: boolean }> {
    const id = ++runId;
    const srcKey = `src-${id}`;
    const tgtKey = `tgt-${id}`;
    // Source: a tall left bar. Target: a wide low bar (a real shape change).
    rig.registerTexture(
      srcKey,
      makeSpriteTexture(16, 16, ctx => ctx.fillRect(4, 4, 4, 8)),
    );
    if (opts.maskBuilds) {
      rig.registerTexture(
        tgtKey,
        makeSpriteTexture(16, 16, ctx => ctx.fillRect(6, 6, 8, 4)),
      );
    }

    const sprite = { x: 0, y: 0, texture: { key: srcKey }, frame: { name: "0" }, setAlpha: () => {} };
    const pokemon = {
      id,
      x: 100,
      y: 200,
      getSprite: () => sprite as unknown as Phaser.GameObjects.Sprite,
      getSpriteScale: () => 1,
    } as unknown as Pokemon;

    let releaseSwap: () => void = () => {};
    const swapGate = new Promise<void>(resolve => (releaseSwap = resolve));

    const seq = playErTransformMorph(pokemon, PokemonType.GRASS, {
      onSwap: async () => {
        await swapGate;
      },
    });
    expect(seq.mode).toBe("morph");

    let settled = false;
    void seq.whenSettled.then(() => (settled = true));

    let revealAt: number | null = null;
    let revealedBeforeSwap = false;
    let swapLanded = false;

    for (let el = 0; el <= opts.end; el += 16) {
      if (!swapLanded && el >= opts.swapAtMs) {
        swapLanded = true;
        // The atlas "download" finished: the real sprite now shows the target key.
        sprite.texture.key = tgtKey;
        rig.now.value = el;
        releaseSwap();
        await flush(); // swap -> captureTarget builds the target mask (or fails)
      }
      const before = rig.ellipseCount();
      rig.tickTo(el);
      if (revealAt === null && rig.ellipseCount() > before) {
        revealAt = el;
        if (!swapLanded) {
          revealedBeforeSwap = true;
        }
      }
      if (settled) {
        break;
      }
    }
    await flush();
    return { revealAt, settled, revealedBeforeSwap };
  }

  it("runs the real source->target MORPH when the atlas lands late but within the stretch (reveal waits for the morph)", async () => {
    // Swap + mask land at 1200ms (< FILL + HOLD = 1980): the morph runs, so the
    // reveal (burst) cannot start until the morph has played (~ready + MORPH).
    const { revealAt, settled, revealedBeforeSwap } = await run({ swapAtMs: 1200, maskBuilds: true, end: 4500 });
    expect(settled).toBe(true);
    expect(revealedBeforeSwap).toBe(false);
    expect(revealAt).not.toBeNull();
    expect(revealAt!).toBeGreaterThanOrEqual(1200 + MORPH - 32);
  });

  it("degrades gracefully (drain reveal, no morph) when the target mask never builds - and still settles", async () => {
    // Swap lands at 1200ms but the target texture is unreadable: no morph, reveal
    // as soon as the swap is under the glow (clearly before a full morph would end).
    const { revealAt, settled, revealedBeforeSwap } = await run({ swapAtMs: 1200, maskBuilds: false, end: 4500 });
    expect(settled).toBe(true);
    expect(revealedBeforeSwap).toBe(false);
    expect(revealAt).not.toBeNull();
    expect(revealAt!).toBeGreaterThanOrEqual(1200);
    expect(revealAt!).toBeLessThan(1200 + MORPH);
  });

  it("HOLDS the glow past the old 1s cap for a slow atlas, never revealing before the swap (no late pop)", async () => {
    // Swap lands at 2400ms - beyond the old 1000ms cap AND the stretch: the glow
    // must keep holding until the swap, then degrade-reveal. Never a pre-swap pop.
    const { revealAt, settled, revealedBeforeSwap } = await run({ swapAtMs: 2400, maskBuilds: false, end: 5500 });
    expect(settled).toBe(true);
    expect(revealedBeforeSwap).toBe(false);
    expect(revealAt).not.toBeNull();
    expect(revealAt!).toBeGreaterThanOrEqual(2400);
    // Proves the fill stretched well past the old FILL + 1000 = 1480ms cap.
    expect(revealAt!).toBeGreaterThan(FILL + 1000);
  });
});
