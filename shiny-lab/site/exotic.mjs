/* Shiny Lab - EXOTIC multi-sprite effects (v1). Unlike palette/surface/around (per-pixel
 * passes flattened into ONE buffer), an exotic effect draws LAYERED COPIES of the fully
 * composited look around/behind/in front of the mon using 2D canvas transforms + filters.
 * Copies inherit whatever palette/surface/around is equipped (they stamp the rendered look).
 *
 * Contract: EXOTIC[id] = {
 *   label,
 *   replacesBase?  - true = the effect draws the mon itself (pipeline skips the base stamp)
 *   behind(c, env) - draw ops UNDER the mon
 *   front(c, env)  - draw ops OVER the mon
 * }
 * env = {
 *   t        - seconds, master-speed scaled
 *   look     - canvas of the CURRENT composited look (PW x PH)
 *   ring(n)  - canvas of the look ~n*80ms AGO (frame-history; falls back to `look`)
 *   PW, PH   - padded sprite frame size;  ox, oy - where the base look sits on the canvas
 *   EW, EH   - full exotic canvas size (draw anywhere inside)
 *   cx, cy   - silhouette center in look-space pixels;  fy - feet line in look-space px
 *   seed     - deterministic per-mon seed;  compact - true when drawing a small gallery tile
 *   pulse    - seconds since the Pulse button (Infinity if never pressed)
 * }
 * Helpers below keep effects terse. No WebGL; ctx.filter does the tinting/inversion work. */

const EXO_TAU = Math.PI * 2;
const exoRand = (seed, i) => {
  const x = Math.sin(seed * 127.1 + i * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/* stamp(c, env, img, opts): draw a look-sized canvas with a transform.
 * opts: x,y = CENTER on the exotic canvas (default = mon center); sx,sy = scale
 * (negative flips); rot; alpha; filter; comp (composite op); anchorFeet = true
 * anchors y so the copy's FEET sit at opts.y. */
function exoStamp(c, env, img, o) {
  const sx = o.sx ?? o.s ?? 1;
  const sy = o.sy ?? o.s ?? 1;
  const cxA = env.ox + env.cx;
  const cyA = env.oy + env.cy;
  const x = o.x ?? cxA;
  const y = o.y ?? cyA;
  c.save();
  c.imageSmoothingEnabled = false;
  c.globalAlpha = o.alpha ?? 1;
  if (o.comp) c.globalCompositeOperation = o.comp;
  if (o.filter) c.filter = o.filter;
  c.translate(x, y);
  if (o.rot) c.rotate(o.rot);
  if (o.skewX) c.transform(1, 0, o.skewX, 1, 0, 0);
  c.scale(sx, sy);
  const ay = o.anchorFeet ? env.fy : env.cy;
  c.drawImage(img, -env.cx, -ay);
  c.restore();
}

const EXOTIC = {
  /* -- true depth: copies orbit, passing in FRONT low and BEHIND high ------------- */
  carousel: {
    label: "Carousel",
    _pass(c, env, wantFront) {
      const n = 3;
      const R = (env.compact ? 0.3 : 0.4) * env.PW;
      for (let k = 0; k < n; k++) {
        const a = env.t * 0.9 + (k * EXO_TAU) / n;
        const depth = Math.sin(a); // >0 = near/low/front
        if (depth >= 0 !== wantFront) continue;
        exoStamp(c, env, env.ring(2), {
          x: env.ox + env.cx + Math.cos(a) * R,
          y: env.oy + env.cy + depth * 0.16 * env.PH,
          s: 0.26 + 0.09 * depth,
          alpha: 0.75 + 0.2 * depth,
          filter: `brightness(${0.75 + 0.3 * depth})`,
        });
      }
    },
    behind(c, env) {
      this._pass(c, env, false);
    },
    front(c, env) {
      this._pass(c, env, true);
    },
  },

  /* -- frame history: decaying hue-shifted ghosts of past frames ------------------ */
  afterimage: {
    label: "Afterimage Trail",
    behind(c, env) {
      const lags = [4, 8, 12];
      for (let k = lags.length - 1; k >= 0; k--) {
        exoStamp(c, env, env.ring(lags[k]), {
          x: env.ox + env.cx - (k + 1) * 3,
          y: env.oy + env.cy + Math.sin(env.t * 2 + k) * 1.5,
          alpha: [0.4, 0.25, 0.13][k],
          filter: `hue-rotate(${(k + 1) * 45}deg) saturate(1.6)`,
        });
      }
    },
  },

  chorus: {
    label: "Chorus of Selves",
    behind(c, env) {
      const spread = (env.compact ? 0.2 : 0.3) * env.PW;
      for (let k = 0; k < 4; k++) {
        const side = k % 2 === 0 ? -1 : 1;
        const rank = 1 + Math.floor(k / 2);
        exoStamp(c, env, env.ring(3 + k * 5), {
          x: env.ox + env.cx + side * spread * rank * 0.62,
          y: env.oy + env.cy - rank * 2,
          s: 1 - rank * 0.16,
          alpha: 0.42 - rank * 0.13,
          filter: `hue-rotate(${side * rank * 25}deg)`,
        });
      }
    },
  },

  mirrormatch: {
    label: "Mirror Match",
    behind(c, env) {
      exoStamp(c, env, env.ring(4), {
        x: env.ox + env.cx - (env.compact ? 0.22 : 0.3) * env.PW,
        y: env.oy + env.cy - 2,
        sx: -0.92,
        sy: 0.92,
        alpha: 0.8,
        filter: "invert(1) hue-rotate(180deg)",
      });
    },
  },

  shadowpuppet: {
    label: "Shadow Puppet",
    behind(c, env) {
      const stretch = 0.5 + 0.12 * Math.sin(env.t * 0.7);
      exoStamp(c, env, env.ring(3), {
        x: env.ox + env.cx + 0.1 * env.PW,
        y: env.oy + env.fy,
        sx: 1.04,
        sy: -stretch, // flipped upward-drawn = lies along the ground away from the mon
        skewX: -0.9 + 0.1 * Math.sin(env.t * 0.5),
        alpha: 0.5,
        filter: "brightness(0)",
        anchorFeet: true,
      });
    },
  },

  matryoshka: {
    label: "Matryoshka",
    front(c, env) {
      for (const [k, s] of [
        [1, 0.6],
        [2, 0.36],
      ]) {
        exoStamp(c, env, env.ring(k * 3), {
          y: env.oy + env.fy,
          s: s + 0.02 * Math.sin(env.t * 2 + k * 1.7),
          alpha: 0.92,
          filter: `brightness(${1 + k * 0.12})`,
          anchorFeet: true,
        });
      }
    },
  },

  spectralmolt: {
    label: "Spectral Molt",
    front(c, env) {
      const period = 4;
      const p = ((env.t % period) + period) % period / period;
      if (p > 0.75) return; // rest phase between molts
      const q = p / 0.75;
      exoStamp(c, env, env.ring(Math.floor(q * 14) + 2), {
        y: env.oy + env.cy - q * 0.55 * env.PH,
        s: 1 + q * 0.18,
        alpha: (1 - q) * 0.5,
        filter: "hue-rotate(200deg) brightness(1.5) saturate(0.7)",
        comp: "lighter",
      });
    },
  },

  minime: {
    label: "Mini-Me",
    front(c, env) {
      const sway = Math.sin(env.t * 1.2);
      exoStamp(c, env, env.ring(2), {
        x: env.ox + env.cx + sway * (env.compact ? 0.26 : 0.36) * env.PW,
        y: env.oy + env.fy - Math.abs(Math.sin(env.t * 3.1)) * 6,
        sx: 0.3 * (Math.cos(env.t * 1.2) >= 0 ? 1 : -1), // face the walking direction
        sy: 0.3,
        alpha: 1,
        anchorFeet: true,
      });
    },
  },

  personalweather: {
    label: "Personal Weather",
    front(c, env) {
      const cx = env.ox + env.cx;
      const top = env.oy + Math.max(4, env.cy - 0.42 * env.PH);
      c.save();
      c.imageSmoothingEnabled = false;
      // the grump cloud (flash white on seeded lightning beats)
      const beat = Math.floor(env.t * 1.5);
      const boom = exoRand(env.seed, beat) > 0.86 && env.t * 1.5 - beat < 0.18;
      c.fillStyle = boom ? "rgba(255,255,255,0.95)" : "rgba(90,95,110,0.9)";
      for (const [dx, dy, r] of [
        [-8, 0, 6],
        [0, -3, 8],
        [9, 0, 6],
        [3, 2, 7],
      ]) {
        c.beginPath();
        c.arc(cx + dx, top + dy, r, 0, EXO_TAU);
        c.fill();
      }
      // rain: seeded droplets from cloud toward the mon
      c.strokeStyle = "rgba(140,190,255,0.75)";
      c.lineWidth = 1;
      for (let i = 0; i < 12; i++) {
        const rx = cx + (exoRand(env.seed, i) - 0.5) * 26;
        const fall = ((env.t * (1.4 + exoRand(env.seed, i + 50)) + exoRand(env.seed, i + 99)) % 1);
        const ry = top + 8 + fall * (env.cy + env.oy - top);
        c.beginPath();
        c.moveTo(rx, ry);
        c.lineTo(rx - 1, ry + 4);
        c.stroke();
      }
      if (boom) {
        c.strokeStyle = "rgba(255,255,180,0.95)";
        c.beginPath();
        c.moveTo(cx, top + 6);
        c.lineTo(cx - 3, top + 14);
        c.lineTo(cx + 2, top + 15);
        c.lineTo(cx - 2, top + 26);
        c.stroke();
      }
      c.restore();
    },
  },

  /* -- replaces-base family: the effect draws the mon itself ---------------------- */
  paperdoll: {
    label: "Paper Doll",
    replacesBase: true,
    front(c, env) {
      const period = 5;
      const p = ((env.t % period) + period) % period / period;
      const win = 0.22; // flip window
      if (p > win) {
        exoStamp(c, env, env.look, {});
        return;
      }
      const q = p / win;
      const k = Math.cos(q * Math.PI * 2); // 1 -> -1 -> 1 (full spin)
      const backSide = k < 0;
      exoStamp(c, env, env.look, {
        sx: Math.max(0.04, Math.abs(k)) * (backSide ? -1 : 1),
        alpha: 1,
        filter: backSide ? "brightness(0.55) sepia(0.5)" : "none",
      });
    },
  },

  lunarphase: {
    label: "Lunar Phase",
    replacesBase: true,
    front(c, env) {
      const term = env.ox + env.PW * (0.5 + 0.45 * Math.sin(env.t * 0.6)); // terminator x
      c.save();
      c.beginPath();
      c.rect(0, 0, term, env.EH);
      c.clip();
      exoStamp(c, env, env.look, {});
      c.restore();
      c.save();
      c.beginPath();
      c.rect(term, 0, env.EW - term, env.EH);
      c.clip();
      exoStamp(c, env, env.look, { filter: "hue-rotate(150deg) saturate(1.7) brightness(1.2)" });
      c.restore();
      // glowing seam
      c.save();
      c.globalCompositeOperation = "lighter";
      const g = c.createLinearGradient(term - 3, 0, term + 3, 0);
      g.addColorStop(0, "rgba(160,220,255,0)");
      g.addColorStop(0.5, "rgba(200,240,255,0.5)");
      g.addColorStop(1, "rgba(160,220,255,0)");
      c.fillStyle = g;
      c.fillRect(term - 3, env.oy, 6, env.PH);
      c.restore();
    },
  },

  liquefy: {
    label: "Liquefy",
    replacesBase: true,
    front(c, env) {
      const feetY = env.oy + env.fy;
      // solid body above the feet line
      c.save();
      c.beginPath();
      c.rect(0, 0, env.EW, feetY);
      c.clip();
      exoStamp(c, env, env.look, {});
      c.restore();
      // molten reflection: flipped 2px slices with a travelling sine offset
      const depth = Math.min(env.EH - feetY - 1, Math.floor(env.PH * 0.4));
      c.save();
      c.imageSmoothingEnabled = false;
      for (let d = 0; d < depth; d += 2) {
        const srcY = env.fy - d - 1;
        if (srcY < 0) break;
        c.globalAlpha = 0.45 * (1 - d / depth);
        const wob = Math.sin(d * 0.55 + env.t * 3.2) * (1.5 + d * 0.08);
        c.drawImage(env.look, 0, srcY, env.PW, 2, env.ox + wob, feetY + d, env.PW, 2);
      }
      c.restore();
    },
  },

  shatter: {
    label: "Shatter (press Pulse)",
    replacesBase: true,
    front(c, env) {
      const DUR = 1.15;
      if (!(env.pulse >= 0 && env.pulse < DUR)) {
        exoStamp(c, env, env.look, {});
        return;
      }
      const p = env.pulse / DUR;
      const disp = Math.sin(p * Math.PI); // burst out, then reassemble
      const N = 6;
      const cw = env.PW / N;
      const ch = env.PH / N;
      c.save();
      c.imageSmoothingEnabled = false;
      for (let gy = 0; gy < N; gy++) {
        for (let gx = 0; gx < N; gx++) {
          const i = gy * N + gx;
          const vx = (exoRand(env.seed, i) - 0.5) * 46;
          const vy = (exoRand(env.seed, i + 77) - 0.75) * 40;
          const rot = (exoRand(env.seed, i + 154) - 0.5) * 1.6 * disp;
          c.save();
          c.globalAlpha = 1 - 0.25 * disp;
          c.translate(env.ox + gx * cw + cw / 2 + vx * disp, env.oy + gy * ch + ch / 2 + vy * disp + 14 * disp * disp);
          c.rotate(rot);
          c.drawImage(env.look, gx * cw, gy * ch, cw, ch, -cw / 2, -ch / 2, cw, ch);
          c.restore();
        }
      }
      c.restore();
    },
  },
};

const ALL_EXOTIC = Object.keys(EXOTIC);
export { EXOTIC, ALL_EXOTIC };
