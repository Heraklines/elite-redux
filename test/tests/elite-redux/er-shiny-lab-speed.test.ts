import { ER_SHINY_LAB_DEFAULT_PARAMS } from "#data/elite-redux/er-shiny-lab-effects";
import { renderErShinyLabLook } from "#data/elite-redux/er-shiny-lab-renderer";
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
