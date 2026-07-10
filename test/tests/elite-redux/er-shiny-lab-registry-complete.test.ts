import { ER_SHINY_LAB_DEFAULT_PARAMS, ER_SHINY_LAB_EFFECTS_BY_CATEGORY } from "#data/elite-redux/er-shiny-lab-effects";
import { AROUND, AURA, PALETTE } from "#data/elite-redux/er-shiny-lab-fx";
import { renderErShinyLabLook } from "#data/elite-redux/er-shiny-lab-renderer";
import { describe, expect, it } from "vitest";

// The renderer looks each equipped id up in the PALETTE / AURA / AROUND tables
// (er-shiny-lab-fx). An id that lives in a registry array but is ABSENT from its
// table silently renders nothing. These tests make that class of gap impossible:
// every registry id MUST resolve to a renderer entry, and each new effect must
// actually change the pixels it is composited onto.

const TABLE_FOR_CATEGORY: Record<string, Record<string, unknown>> = {
  palette: PALETTE,
  surface: AURA,
  around: AROUND,
};

describe("ER Shiny Lab registry completeness", () => {
  for (const category of ["palette", "surface", "around"] as const) {
    it(`every ${category} id has a renderer table entry`, () => {
      const table = TABLE_FOR_CATEGORY[category];
      const missing = ER_SHINY_LAB_EFFECTS_BY_CATEGORY[category]
        .map(def => def.id)
        .filter(id => typeof table[id] !== "function");
      expect(missing, `${category} ids without a renderer entry: ${missing.join(", ")}`).toEqual([]);
    });
  }
});

// A fully-opaque but spatially-VARYING block: palettes + surfaces both apply, and
// it is padded enough that an "around" aura has off-sprite space to draw into. The
// colour must vary across the sprite so displacement / neighbour-sampling surfaces
// (ripple, pixelpulse) actually move pixels instead of resampling one flat colour.
// A small filled DISC with a dark outline ring inside a 16x16 frame: this gives a
// non-rectangular silhouette (top-facing surfaces for snowcap), transparent corners
// (off-sprite space + edges for aura / rim FX), near-black outline pixels (so
// alpha-only FX like No Outline actually change something) and a varied interior
// (so displacement / neighbour-sampling FX move real colour). A flat rectangle no-ops
// a whole class of region/edge/silhouette effects even though they render fine on a
// real Pokemon sprite.
function source() {
  const w = 24;
  const h = 24;
  const data = new Uint8ClampedArray(w * h * 4);
  const cx = 11.5;
  const cy = 11.5;
  const rad = 9.5;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.hypot(x - cx, y - cy);
      if (d > rad) {
        data[i + 3] = 0;
        continue;
      }
      if (d > rad - 1.6) {
        // dark outline ring
        data[i] = 20;
        data[i + 1] = 18;
        data[i + 2] = 30;
      } else {
        // varied, wide-luma body (near-black shadow bottom-left -> bright top-right)
        data[i] = 20 + x * 9;
        data[i + 1] = 30 + y * 8;
        data[i + 2] = 220 - x * 7;
      }
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function renderedBytes(category: "palette" | "surface" | "around", id: string): Uint8ClampedArray | null {
  const slots = {
    palette: category === "palette" ? id : null,
    surface: category === "surface" ? id : null,
    around: category === "around" ? id : null,
  };
  // A couple of non-zero frames so time-driven effects have a chance to differ.
  const out = renderErShinyLabLook(source(), slots, { ...ER_SHINY_LAB_DEFAULT_PARAMS }, 3.5, { pad: 10 });
  return out?.data ?? null;
}

// The unmodified source, expanded to the same padded buffer, is the reference the
// port must differ from (otherwise it is a no-op / missing implementation).
function baselineBytes(): Uint8ClampedArray | null {
  const out = renderErShinyLabLook(
    source(),
    { palette: null, surface: null, around: null },
    { ...ER_SHINY_LAB_DEFAULT_PARAMS },
    3.5,
    { pad: 10 },
  );
  return out?.data ?? null;
}

function differs(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) {
    return true;
  }
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      return true;
    }
  }
  return false;
}

describe("ER Shiny Lab effect smoke render", () => {
  const baseline = baselineBytes();

  for (const category of ["palette", "surface", "around"] as const) {
    for (const def of ER_SHINY_LAB_EFFECTS_BY_CATEGORY[category]) {
      it(`${category}:${def.id} renders non-empty pixels distinct from the source`, () => {
        expect(baseline).not.toBeNull();
        const bytes = renderedBytes(category, def.id);
        expect(bytes, `${category}:${def.id} produced no output`).not.toBeNull();
        expect(differs(bytes as Uint8ClampedArray, baseline as Uint8ClampedArray)).toBe(true);
      });
    }
  }
});
