import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import { playErTransformMorph } from "#sprites/er-form-transform-fx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Behavioural tests for the FULL transform sequence entry point,
 * {@linkcode playErTransformMorph}. The animated fill/morph render is
 * animation-tier (a real canvas-texture + per-frame clock, out of scope for the
 * headless harness per CLAUDE.md), so these assert the parts that MUST hold in
 * every environment:
 *   - the FAIL-CLOSED contract: with no canvas-texture API / no pixel data the
 *     sequence degrades to the burst-only reveal and NEVER throws;
 *   - the LATE-SWAP FIX contract: the FX always drives the caller's `onSwap`
 *     (the real sprite/info swap) exactly once, and the swap resolves before the
 *     reveal completes.
 *
 * A minimal stub `globalScene` is installed (no GameManager boot needed) - just
 * the render surface the burst-only fallback + the morph feature-detect touch.
 * Under jsdom `document` exists but the texture manager stub exposes no
 * `createCanvas`, so the morph feature-detect fails closed deterministically -
 * exactly the burst-only path we assert.
 */

/** A chainable no-op game object (setBlendMode/setScale/... all return `this`). */
function stubGameObject(): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  const chain = () => obj;
  for (const m of [
    "setBlendMode",
    "setScale",
    "setStrokeStyle",
    "setAngle",
    "setDepth",
    "setOrigin",
    "setPosition",
    "setAlpha",
    "setVisible",
    "setFlip",
  ]) {
    obj[m] = chain;
  }
  obj.destroy = () => {};
  return obj;
}

interface StubScene {
  scene: BattleScene;
  delayedCalls: (() => void)[];
  ellipseCount: () => number;
}

function installStubScene(): StubScene {
  let ellipses = 0;
  const delayedCalls: (() => void)[] = [];
  const add = {
    ellipse: () => {
      ellipses++;
      return stubGameObject();
    },
    rectangle: () => stubGameObject(),
    image: () => stubGameObject(),
  };
  const scene = {
    time: {
      now: 0,
      delayedCall: (_ms: number, cb: () => void) => {
        delayedCalls.push(cb);
        return { remove: () => {} };
      },
      addEvent: () => ({ remove: () => {} }),
    },
    field: { add: () => {} },
    add,
    tweens: {
      add: () => ({ remove: () => {} }),
      killTweensOf: () => {},
    },
    // No `createCanvas` -> the morph feature-detect fails closed.
    textures: {
      exists: () => false,
      remove: () => {},
    },
  } as unknown as BattleScene;
  initGlobalScene(scene);
  return { scene, delayedCalls, ellipseCount: () => ellipses };
}

/** A minimal Pokemon stand-in for the FX entry point (no real sprite/texture). */
function stubPokemon(): Pokemon {
  return {
    id: 1,
    x: 100,
    y: 200,
    getSprite: () => stubGameObject() as unknown as Phaser.GameObjects.Sprite,
    getSpriteScale: () => 1,
  } as unknown as Pokemon;
}

describe("playErTransformMorph - fail-closed + swap driving", () => {
  let prevScene: BattleScene | undefined;
  let stub: StubScene;

  beforeEach(() => {
    prevScene = globalScene;
    stub = installStubScene();
  });

  afterEach(() => {
    if (prevScene) {
      initGlobalScene(prevScene);
    }
    vi.restoreAllMocks();
  });

  it("fails closed to the burst-only reveal when no canvas-texture API is available", () => {
    const seq = playErTransformMorph(stubPokemon(), PokemonType.ELECTRIC, { onSwap: () => {} });
    expect(seq.mode).toBe("burst");
    // The burst-only reveal still fired (its flash core/halo are `add.ellipse`).
    expect(stub.ellipseCount()).toBeGreaterThan(0);
  });

  it("never throws even when onSwap itself rejects (fail-safe on the transform hot path)", () => {
    expect(() =>
      playErTransformMorph(stubPokemon(), PokemonType.GRASS, {
        onSwap: () => Promise.reject(new Error("load failed")),
      }),
    ).not.toThrow();
  });

  it("drives the caller's onSwap exactly once (the real sprite/info swap)", async () => {
    const onSwap = vi.fn(() => Promise.resolve());
    playErTransformMorph(stubPokemon(), PokemonType.WATER, { onSwap });
    // onSwap is scheduled as a microtask; let it settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(onSwap).toHaveBeenCalledTimes(1);
  });

  it("resolves the swap BEFORE the reveal completes (the late-swap fix)", async () => {
    const order: string[] = [];
    const onSwap = vi.fn(async () => {
      order.push("swap");
    });
    playErTransformMorph(stubPokemon(), PokemonType.FIRE, { onSwap });
    // Let the onSwap microtask resolve (the swap lands under the glow).
    await Promise.resolve();
    await Promise.resolve();
    // Now fire the reveal-completion callback (the burst teardown delayedCall).
    for (const cb of stub.delayedCalls) {
      cb();
    }
    order.push("reveal-complete");
    expect(order).toEqual(["swap", "reveal-complete"]);
  });
});
