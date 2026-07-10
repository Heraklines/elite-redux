import { ER_SHINY_LAB_DEFAULT_PARAMS, ER_SHINY_LAB_EFFECTS_BY_CATEGORY } from "#data/elite-redux/er-shiny-lab-effects";
import { renderErShinyLabLook } from "#data/elite-redux/er-shiny-lab-renderer";
import { describe, expect, it } from "vitest";

// Coarse performance guard: a ported effect must render in the SAME cost class as the
// pre-existing effects - the port must not be accidentally quadratic (or otherwise
// asymptotically heavier) in the single-buffer renderer. This is a guard, not a
// micro-benchmark: median-of-3 per effect, a generous multiple of the pre-existing
// median, warm cache primed first. Skippable under heavy/parallel CI load.

// The 155 effects that shipped BEFORE the v6/v7 port - the cost-class baseline.
const PREEXISTING = new Set<string>([
  // palettes (63)
  "glacier",
  "aurum",
  "obsidian",
  "chrome",
  "amethyst",
  "inferno",
  "toxic",
  "rosequartz",
  "verdigris",
  "spectral",
  "negative",
  "void",
  "shadowflame",
  "iridescent",
  "thermal",
  "sepia",
  "copper",
  "emerald",
  "sapphire",
  "comic",
  "synthwave",
  "onyxgold",
  "ultraviolet",
  "acid",
  "bubblegum",
  "blood",
  "abyss",
  "antique",
  "frostfire",
  "camo",
  "jade",
  "rosegold",
  "mono",
  "prismarine",
  "nebula",
  "venom",
  "solarflare",
  "royal",
  "deepsea",
  "sakura",
  "mythril",
  "cursed",
  "pearl",
  "rust",
  "moonstone",
  "oilspill",
  "plasmatic",
  "duoink",
  "duoneon",
  "duomono",
  "duoblood",
  "duomint",
  "duosunset",
  "duomecha",
  "trisunset",
  "triforest",
  "quadvapor",
  "pentacandy",
  "pentajewel",
  "synthwavesun",
  "sunset",
  "gameboy",
  "retro",
  // surfaces (50)
  "rainbow",
  "aurora",
  "holofoil",
  "prismatic",
  "frostbite",
  "glitch",
  "hologram",
  "galaxy",
  "plasma",
  "molten",
  "electric",
  "dissolve",
  "mercury",
  "lavacracks",
  "frozenice",
  "crystalfacets",
  "stainedglass",
  "marble",
  "bioluminescent",
  "constellation",
  "aurorawings",
  "gildededges",
  "rimlight",
  "vaporwave",
  "halftone",
  "sparkle",
  "lightningveins",
  "dripgold",
  "spectrumsplit",
  "ripple",
  "circuit",
  "scales",
  "tvstatic",
  "scansweep",
  "poison",
  "kaleido",
  "fractalflow",
  "wormhole",
  "shatter",
  "heatshimmer",
  "caustics",
  "oilfilm",
  "pixelpulse",
  "neonwire",
  "starmap",
  "synthscan",
  "rainbowedge",
  "sunsetsun",
  "crosshatch",
  "tron",
  // arounds (42)
  "outline",
  "halo",
  "flame",
  "shadowfire",
  "frost",
  "efield",
  "rings",
  "orbit",
  "auroraveil",
  "holyrays",
  "cosmos",
  "smoke",
  "radiant",
  "embers",
  "snow",
  "bubbles",
  "wingflame",
  "footfrost",
  "crown",
  "underlight",
  "uprising",
  "topbeam",
  "sideaura",
  "magiccircle",
  "vortex",
  "galaxyspiral",
  "fireflies",
  "petals",
  "rain",
  "sparkstorm",
  "prismburst",
  "icespikes",
  "rainbowglitter",
  "luminous",
  "cursedaura",
  "goldenglow",
  "shadowaura",
  "rainbowoutline",
  "triangles",
  "hexagons",
  "hearts",
  "staticfield",
]);

// A representative filled disc (~real-sprite size) so per-pixel cost is realistic.
function source() {
  const w = 56;
  const h = 56;
  const data = new Uint8ClampedArray(w * h * 4);
  const cx = 27.5;
  const cy = 27.5;
  const rad = 24;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (Math.hypot(x - cx, y - cy) > rad) {
        data[i + 3] = 0;
        continue;
      }
      data[i] = 20 + ((x * 4) % 200);
      data[i + 1] = 30 + ((y * 4) % 200);
      data[i + 2] = 210 - ((x * 3) % 190);
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function slotsFor(category: "palette" | "surface" | "around", id: string) {
  return {
    palette: category === "palette" ? id : null,
    surface: category === "surface" ? id : null,
    around: category === "around" ? id : null,
  };
}

// Compared PER CATEGORY: palettes run per sprite pixel, surfaces per sprite pixel with a
// sampler, arounds per PADDED-canvas pixel and often loop over particles - structurally
// different cost classes, so a new around must be judged against the pre-existing AROUNDS,
// not against the cheap palette median. A new effect passes if it is within a generous
// multiple of its category's pre-existing median OR within 2.5x its category's heaviest
// pre-existing effect. An accidentally-quadratic port is 20-100x and trips either bound.
const PERF_MULT = 6;
const MAX_MULT = 2.5;
// Timing is meaningless under a loaded/slow shared runner; skip there.
const SKIP_PERF = process.env.ER_SKIP_PERF === "1";

describe.skipIf(SKIP_PERF)("ER Shiny Lab effect performance", () => {
  it("no effect renders asymptotically slower than its category's pre-existing effects", () => {
    const src = source();
    const measure = (category: "palette" | "surface" | "around", id: string): number => {
      const slots = slotsFor(category, id);
      // warm the per-source prep cache (edge/dist/clusters) so we time the effect, not setup
      renderErShinyLabLook(src, slots, { ...ER_SHINY_LAB_DEFAULT_PARAMS }, 1.0, { pad: 22 });
      const samples: number[] = [];
      for (let k = 0; k < 5; k++) {
        const t0 = performance.now();
        renderErShinyLabLook(src, slots, { ...ER_SHINY_LAB_DEFAULT_PARAMS }, 2.0 + k, { pad: 22 });
        samples.push(performance.now() - t0);
      }
      return median(samples);
    };

    const times: Record<string, { id: string; ms: number; isNew: boolean }[]> = {
      palette: [],
      surface: [],
      around: [],
    };
    for (const category of ["palette", "surface", "around"] as const) {
      for (const def of ER_SHINY_LAB_EFFECTS_BY_CATEGORY[category]) {
        times[category].push({ id: def.id, ms: measure(category, def.id), isNew: !PREEXISTING.has(def.id) });
      }
    }

    const offenders: string[] = [];
    for (const category of ["palette", "surface", "around"] as const) {
      const pre = times[category].filter(t => !t.isNew).map(t => t.ms);
      const preMedian = median(pre);
      const preMax = Math.max(...pre);
      const ceiling = Math.max(preMedian * PERF_MULT, preMax * MAX_MULT, 4);
      const slowestNew = [...times[category]]
        .filter(t => t.isNew)
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 3);
      // eslint-disable-next-line no-console
      console.log(
        `[shiny-lab perf] ${category}: pre median=${preMedian.toFixed(2)}ms max=${preMax.toFixed(2)}ms `
          + `ceiling=${ceiling.toFixed(2)}ms | slowest new: `
          + slowestNew.map(s => `${s.id}=${s.ms.toFixed(2)}ms`).join(", "),
      );
      for (const t of times[category]) {
        if (t.ms > ceiling) {
          offenders.push(`${category}:${t.id}=${t.ms.toFixed(2)}ms (ceiling ${ceiling.toFixed(2)}ms)`);
        }
      }
    }

    expect(offenders, `effects over their category cost ceiling: ${offenders.join(", ")}`).toEqual([]);
  });
});
