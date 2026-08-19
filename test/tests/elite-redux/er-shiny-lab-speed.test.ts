import { ER_SHINY_LAB_DEFAULT_PARAMS } from "#data/elite-redux/er-shiny-lab-effects";
import { renderErShinyLabLook } from "#data/elite-redux/er-shiny-lab-renderer";
import {
  getErShinyLabBattleFxFrameMs,
  getErShinyLabBattleFxInitialDelayMs,
  getErShinyLabSourceFrameGeometry,
} from "#sprites/er-shiny-lab-sprite-fx";
import { describe, expect, it } from "vitest";

function source() {
  // 8x8 fully-opaque mid-grey so palette + surface both apply.
  const w = 8;
  const h = 8;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 120;
    data[i + 1] = 130;
    data[i + 2] = 140;
    data[i + 3] = 255;
  }
  return { width: w, height: h, data };
}

function bytes(time: number, speed: number): number[] {
  const params = { ...ER_SHINY_LAB_DEFAULT_PARAMS, speed };
  const r = renderErShinyLabLook(source(), { palette: "glacier", surface: "rainbow", around: null }, params, time, {
    pad: 0,
  });
  return Array.from(r?.data ?? []);
}

describe("ER Shiny Lab effect speed scaling", () => {
  it("speed changes the rendered frame at a fixed clock (2x != 1x at same time)", () => {
    const a = bytes(5, 1);
    const b = bytes(5, 2);
    expect(a.length).toBeGreaterThan(0);
    expect(b).not.toEqual(a);
  });

  it("speed S at time T equals speed 1 at time T*S (the scaling identity)", () => {
    // render(time * speed) means render at (5, speed=2) should equal render at (10, speed=1).
    expect(bytes(5, 2)).toEqual(bytes(10, 1));
    expect(bytes(8, 0.5)).toEqual(bytes(4, 1));
  });
});

describe("ER Shiny Lab battle render pacing", () => {
  it("keeps singles and doubles immediate while spreading all six triple slots", () => {
    expect(getErShinyLabBattleFxInitialDelayMs(1, 0)).toBe(0);
    expect(getErShinyLabBattleFxInitialDelayMs(2, 3)).toBe(0);
    expect(Array.from({ length: 6 }, (_, index) => getErShinyLabBattleFxInitialDelayMs(3, index))).toEqual([
      0, 24, 48, 72, 96, 120,
    ]);
  });

  it("retains the existing animation cadence after the initial triple stagger", () => {
    expect(getErShinyLabBattleFxFrameMs(1)).toBe(125);
    expect(getErShinyLabBattleFxFrameMs(2)).toBe(250);
    expect(getErShinyLabBattleFxFrameMs(3)).toBe(500);
  });

  it("keeps authored Black Shiny animation frames at their native 10 FPS in every format", () => {
    expect(getErShinyLabBattleFxFrameMs(1, true)).toBe(100);
    expect(getErShinyLabBattleFxFrameMs(2, true)).toBe(100);
    expect(getErShinyLabBattleFxFrameMs(3, true)).toBe(100);
  });

  it("preserves a padded Black atlas frame's negative trim and original anchor box", () => {
    const geometry = getErShinyLabSourceFrameGeometry({
      cutWidth: 114,
      cutHeight: 106,
      width: 114,
      height: 106,
      realWidth: 82,
      realHeight: 80,
      x: -16,
      y: -10,
    });

    expect(geometry).toEqual({
      width: 114,
      height: 106,
      drawX: 0,
      drawY: 0,
      sourceBoxX: 16,
      sourceBoxY: 10,
      sourceBoxWidth: 82,
      sourceBoxHeight: 80,
    });
    expect(geometry.sourceBoxY + geometry.sourceBoxHeight).toBe(90);
  });

  it("leaves ordinary positive-trim atlas geometry unchanged", () => {
    expect(
      getErShinyLabSourceFrameGeometry({
        cutWidth: 74,
        cutHeight: 77,
        width: 74,
        height: 77,
        realWidth: 82,
        realHeight: 80,
        x: 0,
        y: 3,
      }),
    ).toEqual({
      width: 82,
      height: 80,
      drawX: 0,
      drawY: 3,
      sourceBoxX: 0,
      sourceBoxY: 0,
      sourceBoxWidth: 82,
      sourceBoxHeight: 80,
    });
  });
});
