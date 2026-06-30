/* Fusion Lab strategy - APPROACH 3: SILHOUETTE MORPH (warp-blend).
 *
 * The experimental "coolest" rung: instead of grafting A's head onto B's body
 * (a swap/paste), we establish a point-to-point correspondence between the two
 * sprites' OUTLINES and warp-blend them into a GENUINELY NEW silhouette - an
 * interpolated meld that draws its shape AND its colour from both donors.
 *
 * Pipeline (pragmatic / rough-but-real):
 *   1. NORMALIZE   each sprite into a shared square canvas: translate centroid to
 *                  center, rotate the PCA major axis to vertical (head-up flip
 *                  heuristic), scale to a common radius.  -> normA, normB aligned.
 *   2. CONTOURS    Moore-trace the outer boundary of each normalized mask, then
 *                  resample to N points by arc length starting from the topmost
 *                  point.  Index i gives the (approximate!) correspondence Ai<->Bi.
 *   3. MEAN SHAPE  Mi = lerp(Ai, Bi, t)  -> a NEW outline; scanline-fill to mask Mt.
 *   4. WARP+BLEND  for each pixel inside Mt, inverse-distance-weight the mean
 *                  control points to map back into each source, sample both
 *                  (nearest), and blend their colours by t in OKLab.
 *   5. CRISP-UP    quantize the blend to a unified OKLab palette + nearest-snap so
 *                  it stays pixel-art crisp (no smeared anti-aliasing).
 *   6. OUTLINE     re-synthesize one 1px dark keyline from Mt's alpha.
 *
 * NEVER THROWS: the whole body is wrapped in try/catch and every degenerate path
 * (empty / single-pixel / un-traceable mask) returns B unchanged with
 * meta:{rung:'fallback', reason}. DOM-free: rgba Uint8ClampedArray in/out.
 *
 * BUILD NOTE: the whole strategy is wrapped in an IIFE so that NONE of its many
 * private helpers leak to module/global top level. build-site.mjs strips the
 * single-line import + the leading `export ` and inlines this file at top level
 * AFTER fusion.mjs; an unwrapped `function maskBBox(){}` here would collide with
 * fusion.mjs's own top-level helper. Only `morphStrategy` escapes the IIFE. */

import { STRATEGIES, maskOf, components, srgbToOklab, oklabToSrgb, quantizeOklab, edt, skeletonize, detectSockets, reconstructFrame } from "../fusion.mjs";

export const morphStrategy = (() => {
  // ---- tiny utils -------------------------------------------------------
  const clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const blank = (w, h) => new Uint8ClampedArray(w * h * 4);
  const px = (buf, w, h, x, y, r, g, b, a) => {
    x |= 0;
    y |= 0;
    if (x < 0 || y < 0 || x >= w || y >= h) {
      return;
    }
    const i = (y * w + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
    buf[i + 3] = a;
  };
  const dimCopy = rgba => {
    const o = Uint8ClampedArray.from(rgba);
    for (let i = 0; i < o.length; i += 4) {
      o[i] = (o[i] * 0.34) | 0;
      o[i + 1] = (o[i + 1] * 0.34) | 0;
      o[i + 2] = (o[i + 2] * 0.34) | 0;
    }
    return o;
  };
  // Bresenham line (debug layers)
  const line = (buf, w, h, x0, y0, x1, y1, col) => {
    x0 |= 0;
    y0 |= 0;
    x1 |= 0;
    y1 |= 0;
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let guard = 0;
    while (guard++ < 4096) {
      px(buf, w, h, x0, y0, col[0], col[1], col[2], col[3]);
      if (x0 === x1 && y0 === y1) {
        break;
      }
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  };
  const maskLayer = (mask, w, h, col) => {
    const out = blank(w, h);
    for (let p = 0; p < w * h; p++) {
      if (mask[p]) {
        out[p * 4] = col[0];
        out[p * 4 + 1] = col[1];
        out[p * 4 + 2] = col[2];
        out[p * 4 + 3] = 255;
      }
    }
    return out;
  };

  // ---- step 1: normalize (centroid + PCA + scale) -----------------------

  /* maskStats - centroid, PCA major-axis angle, RMS + max radius, area. */
  function maskStats(mask, w, h) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) {
          sx += x;
          sy += y;
          n++;
        }
      }
    }
    if (n === 0) {
      return { count: 0 };
    }
    const cx = sx / n;
    const cy = sy / n;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    let rms = 0;
    let maxR = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) {
          const dx = x - cx;
          const dy = y - cy;
          sxx += dx * dx;
          syy += dy * dy;
          sxy += dx * dy;
          const r2 = dx * dx + dy * dy;
          rms += r2;
          if (r2 > maxR) {
            maxR = r2;
          }
        }
      }
    }
    sxx /= n;
    syy /= n;
    sxy /= n;
    rms = Math.sqrt(rms / n);
    maxR = Math.sqrt(maxR);
    // major-axis angle of the covariance matrix
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    return { count: n, cx, cy, theta, rms, maxR };
  }

  /* decideFlip - head-up heuristic. In the PCA frame project points onto the
   * major axis (u) + minor axis (v); compare perpendicular spread of the
   * low-u end vs the high-u end. We want the NARROWER end up (small Y). The
   * base rotation maps +major to +Y (down), so the low-u end lands at the top.
   * Flip (add PI) when the top end is the wider one. CRUDE: meaningless for
   * round / non-elongated shapes (no clear narrow end). */
  function decideFlip(mask, w, h, st) {
    const c = Math.cos(st.theta);
    const s = Math.sin(st.theta);
    const us = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[y * w + x]) {
          const dx = x - st.cx;
          const dy = y - st.cy;
          us.push({ u: dx * c + dy * s, v: -dx * s + dy * c });
        }
      }
    }
    if (us.length < 6) {
      return false;
    }
    us.sort((p, q) => p.u - q.u);
    const k = Math.max(1, Math.floor(us.length * 0.25));
    const spread = arr => {
      let m = 0;
      for (const e of arr) {
        m += e.v;
      }
      m /= arr.length;
      let s2 = 0;
      for (const e of arr) {
        s2 += (e.v - m) * (e.v - m);
      }
      return Math.sqrt(s2 / arr.length);
    };
    const lowEnd = us.slice(0, k); // -> top after base rotation
    const highEnd = us.slice(us.length - k);
    return spread(lowEnd) > spread(highEnd); // top wider -> flip narrow end up
  }

  /* renderNormalized - inverse-sample `src` into an S x S canvas using the
   * centroid/PCA/scale transform. Returns { rgba, mask }. */
  function renderNormalized(src, st, doFlip, scale, S) {
    const phi = Math.PI / 2 - st.theta + (doFlip ? Math.PI : 0);
    const c = Math.cos(phi);
    const s = Math.sin(phi);
    const w = src.width;
    const h = src.height;
    const out = blank(S, S);
    const half = S / 2;
    for (let Y = 0; Y < S; Y++) {
      for (let X = 0; X < S; X++) {
        const rx = (X + 0.5 - half) / scale;
        const ry = (Y + 0.5 - half) / scale;
        // inverse rotation R(-phi)
        const dx = rx * c + ry * s;
        const dy = -rx * s + ry * c;
        const xi = Math.round(st.cx + dx);
        const yi = Math.round(st.cy + dy);
        if (xi < 0 || yi < 0 || xi >= w || yi >= h) {
          continue;
        }
        const si = (yi * w + xi) * 4;
        if (src.rgba[si + 3] <= 24) {
          continue;
        }
        const di = (Y * S + X) * 4;
        out[di] = src.rgba[si];
        out[di + 1] = src.rgba[si + 1];
        out[di + 2] = src.rgba[si + 2];
        out[di + 3] = 255;
      }
    }
    return { rgba: out, mask: maskOf(out, S, S) };
  }

  // ---- step 2: contour trace + arc-length resample ----------------------

  function largestComponentMask(mask, w, h) {
    const { labels, areasDesc } = components(mask, w, h, 4);
    if (!areasDesc.length) {
      return null;
    }
    const top = areasDesc[0].label;
    const out = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) {
      out[p] = labels[p] === top ? 1 : 0;
    }
    return out;
  }

  /* traceContour - Moore-neighbour boundary tracing (clockwise) of the outer
   * boundary, with Jacob-ish stopping (return to start) + an iteration guard so
   * it can never spin. CRUDE: a single trace of the first foreground pixel's
   * component; deep concavities / thin spurs can be under-sampled. */
  function traceContour(mask, w, h) {
    let start = -1;
    for (let p = 0; p < w * h; p++) {
      if (mask[p]) {
        start = p;
        break;
      }
    }
    if (start < 0) {
      return null;
    }
    // clockwise neighbour offsets (image coords, y-down), starting East
    const off = [
      [1, 0],
      [1, 1],
      [0, 1],
      [-1, 1],
      [-1, 0],
      [-1, -1],
      [0, -1],
      [1, -1],
    ];
    const idxOf = (dx, dy) => {
      for (let i = 0; i < 8; i++) {
        if (off[i][0] === dx && off[i][1] === dy) {
          return i;
        }
      }
      return 0;
    };
    const fg = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;
    const sx = start % w;
    const sy = (start - sx) / w;
    const boundary = [[sx, sy]];
    let bx = sx - 1;
    let by = sy; // backtrack: west neighbour (background, since start is first in scan)
    let cx = sx;
    let cy = sy;
    const maxIter = 8 * w * h + 32;
    let iter = 0;
    while (iter++ < maxIter) {
      const bIdx = idxOf(bx - cx, by - cy);
      let found = null;
      let prevBgX = bx;
      let prevBgY = by;
      for (let k = 1; k <= 8; k++) {
        const j = (bIdx + k) % 8;
        const nx = cx + off[j][0];
        const ny = cy + off[j][1];
        if (fg(nx, ny)) {
          found = [nx, ny];
          break;
        }
        prevBgX = nx;
        prevBgY = ny;
      }
      if (!found) {
        break; // isolated pixel
      }
      bx = prevBgX;
      by = prevBgY;
      cx = found[0];
      cy = found[1];
      if (cx === sx && cy === sy) {
        break; // closed the loop
      }
      boundary.push([cx, cy]);
    }
    return boundary.length >= 3 ? boundary : null;
  }

  /* resampleArc - rotate the closed contour to start at its topmost point, then
   * resample to N equally-arc-spaced points. Returns Array<[x,y]> length N. */
  function resampleArc(contour, N) {
    let ti = 0;
    for (let i = 1; i < contour.length; i++) {
      if (
        contour[i][1] < contour[ti][1] ||
        (contour[i][1] === contour[ti][1] && contour[i][0] < contour[ti][0])
      ) {
        ti = i;
      }
    }
    const pts = [];
    for (let i = 0; i < contour.length; i++) {
      pts.push(contour[(ti + i) % contour.length]);
    }
    pts.push(pts[0]); // close
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    const total = cum[cum.length - 1];
    if (total <= 0) {
      return null;
    }
    const out = [];
    let j = 1;
    for (let k = 0; k < N; k++) {
      const target = (k / N) * total;
      while (j < cum.length && cum[j] < target) {
        j++;
      }
      if (j >= cum.length) {
        j = cum.length - 1;
      }
      const t0 = cum[j - 1];
      const t1 = cum[j];
      const f = t1 > t0 ? (target - t0) / (t1 - t0) : 0;
      out.push([
        pts[j - 1][0] + f * (pts[j][0] - pts[j - 1][0]),
        pts[j - 1][1] + f * (pts[j][1] - pts[j - 1][1]),
      ]);
    }
    return out;
  }

  // ---- step 3: mean polygon + scanline fill -----------------------------

  function meanPolygon(A, B, t) {
    const N = A.length;
    const out = new Array(N);
    for (let i = 0; i < N; i++) {
      out[i] = [A[i][0] + t * (B[i][0] - A[i][0]), A[i][1] + t * (B[i][1] - A[i][1])];
    }
    return out;
  }

  function fillPolygon(poly, W, H) {
    const m = new Uint8Array(W * H);
    let minY = H;
    let maxY = -1;
    for (const p of poly) {
      if (p[1] < minY) {
        minY = Math.floor(p[1]);
      }
      if (p[1] > maxY) {
        maxY = Math.ceil(p[1]);
      }
    }
    minY = Math.max(0, minY);
    maxY = Math.min(H - 1, maxY);
    const n = poly.length;
    const xs = [];
    for (let y = minY; y <= maxY; y++) {
      const yc = y + 0.5;
      xs.length = 0;
      for (let i = 0; i < n; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % n];
        const y1 = a[1];
        const y2 = b[1];
        if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) {
          const f = (yc - y1) / (y2 - y1);
          xs.push(a[0] + f * (b[0] - a[0]));
        }
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xa = Math.max(0, Math.ceil(xs[i] - 0.5));
        const xb = Math.min(W - 1, Math.floor(xs[i + 1] - 0.5));
        for (let x = xa; x <= xb; x++) {
          m[y * W + x] = 1;
        }
      }
    }
    return m;
  }

  // ---- step 4: IDW warp + OKLab blend -----------------------------------

  const sampleRGB = (buf, W, H, x, y) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= W || iy >= H) {
      return null;
    }
    const i = (iy * W + ix) * 4;
    return buf[i + 3] <= 24 ? null : [buf[i], buf[i + 1], buf[i + 2]];
  };

  function meanFillColor(normA, normB, S, t) {
    const acc = (buf, out) => {
      let n = 0;
      const L = [0, 0, 0];
      for (let p = 0; p < S * S; p++) {
        if (buf[p * 4 + 3] > 24) {
          const lab = srgbToOklab([buf[p * 4], buf[p * 4 + 1], buf[p * 4 + 2]]);
          L[0] += lab[0];
          L[1] += lab[1];
          L[2] += lab[2];
          n++;
        }
      }
      if (n === 0) {
        return null;
      }
      out[0] = L[0] / n;
      out[1] = L[1] / n;
      out[2] = L[2] / n;
      return out;
    };
    const la = acc(normA, [0, 0, 0]);
    const lb = acc(normB, [0, 0, 0]);
    let lab;
    if (la && lb) {
      lab = [la[0] + t * (lb[0] - la[0]), la[1] + t * (lb[1] - la[1]), la[2] + t * (lb[2] - la[2])];
    } else {
      lab = la || lb;
    }
    if (!lab) {
      return [120, 120, 120];
    }
    return oklabToSrgb(lab);
  }

  /* warpBlend - the core morph. For each pixel inside Mt, inverse-distance-weight
   * the mean control points M_i (+ a centroid anchor) to compute its pre-image in
   * each source (-> srcA, srcB), sample both (nearest), blend in OKLab by t.
   * Returns { blended, warpedA, warpedB }. CRUDE: boundary-only IDW (power 2)
   * "balls up" toward the nearest control point near concavities and can fold;
   * the centroid anchor only damps it. */
  function warpBlend(Mt, mean, A, B, normA, normB, S, t, fillCol) {
    const N = mean.length;
    const blended = blank(S, S);
    const warpedA = blank(S, S);
    const warpedB = blank(S, S);
    let mcx = 0;
    let mcy = 0;
    for (const m of mean) {
      mcx += m[0];
      mcy += m[1];
    }
    mcx /= N;
    mcy /= N;
    const anchorW = 0.04 * N; // centroid anchor relative weight
    const eps = 1e-3;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (!Mt[y * S + x]) {
          continue;
        }
        let sw = 0;
        let ax = 0;
        let ay = 0;
        let bxp = 0;
        let byp = 0;
        for (let i = 0; i < N; i++) {
          const dx = x + 0.5 - mean[i][0];
          const dy = y + 0.5 - mean[i][1];
          const wgt = 1 / (dx * dx + dy * dy + eps); // IDW power 2
          sw += wgt;
          ax += wgt * A[i][0];
          ay += wgt * A[i][1];
          bxp += wgt * B[i][0];
          byp += wgt * B[i][1];
        }
        // centroid anchor: center -> center in both sources (both normalized)
        {
          const dx = x + 0.5 - mcx;
          const dy = y + 0.5 - mcy;
          const wgt = anchorW / (dx * dx + dy * dy + eps);
          sw += wgt;
          ax += wgt * (S / 2);
          ay += wgt * (S / 2);
          bxp += wgt * (S / 2);
          byp += wgt * (S / 2);
        }
        ax /= sw;
        ay /= sw;
        bxp /= sw;
        byp /= sw;
        const ca = sampleRGB(normA, S, S, ax, ay);
        const cb = sampleRGB(normB, S, S, bxp, byp);
        const di = (y * S + x) * 4;
        if (ca) {
          warpedA[di] = ca[0];
          warpedA[di + 1] = ca[1];
          warpedA[di + 2] = ca[2];
          warpedA[di + 3] = 255;
        }
        if (cb) {
          warpedB[di] = cb[0];
          warpedB[di + 1] = cb[1];
          warpedB[di + 2] = cb[2];
          warpedB[di + 3] = 255;
        }
        let rgb;
        if (ca && cb) {
          const la = srgbToOklab(ca);
          const lb = srgbToOklab(cb);
          rgb = oklabToSrgb([
            la[0] + t * (lb[0] - la[0]),
            la[1] + t * (lb[1] - la[1]),
            la[2] + t * (lb[2] - la[2]),
          ]);
        } else if (ca) {
          rgb = ca;
        } else if (cb) {
          rgb = cb;
        } else {
          rgb = fillCol; // hole inside Mt -> neutral meld fill (keeps silhouette solid)
        }
        blended[di] = rgb[0];
        blended[di + 1] = rgb[1];
        blended[di + 2] = rgb[2];
        blended[di + 3] = 255;
      }
    }
    return { blended, warpedA, warpedB };
  }

  // ---- step 5/6: crisp-up + outline -------------------------------------

  function erode4(mask, w, h) {
    const out = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (mask[p] && mask[p - 1] && mask[p + 1] && mask[p - w] && mask[p + w]) {
          out[p] = 1;
        }
      }
    }
    return out;
  }

  /* crispAndOutline - quantize the blend to a unified OKLab palette and nearest-
   * snap each pixel toward its palette colour by `crisp` (1 = fully crisp pixel
   * art, 0 = keep the smooth blend), then stamp one 1px dark keyline from Mt. */
  function crispAndOutline(blended, Mt, S, crisp) {
    const out = Uint8ClampedArray.from(blended);
    if (crisp > 0) {
      const q = quantizeOklab(blended, S, S);
      if (q.palette.length) {
        for (let p = 0; p < S * S; p++) {
          const k = q.indexMap[p];
          if (k === 255) {
            continue;
          }
          const snap = oklabToSrgb(q.palette[k]);
          const i = p * 4;
          out[i] = out[i] + crisp * (snap[0] - out[i]);
          out[i + 1] = out[i + 1] + crisp * (snap[1] - out[i + 1]);
          out[i + 2] = out[i + 2] + crisp * (snap[2] - out[i + 2]);
        }
      }
    }
    const er = erode4(Mt, S, S);
    for (let p = 0; p < S * S; p++) {
      if (Mt[p] && !er[p]) {
        out[p * 4] = 26;
        out[p * 4 + 1] = 22;
        out[p * 4 + 2] = 34;
        out[p * 4 + 3] = 255;
      }
    }
    return out;
  }

  // ---- debug-layer painters --------------------------------------------

  function contourLayer(norm, pts, S, col) {
    const out = dimCopy(norm);
    for (let i = 0; i < pts.length; i++) {
      px(out, S, S, Math.round(pts[i][0]), Math.round(pts[i][1]), col[0], col[1], col[2], 255);
    }
    return out;
  }

  function correspondenceLayer(A, B, S) {
    const out = blank(S, S);
    const colA = [255, 120, 120, 255];
    const colB = [120, 180, 255, 255];
    const colLink = [120, 120, 120, 200];
    // a handful of connecting lines A_i <-> B_i
    const N = A.length;
    const stepL = Math.max(1, Math.floor(N / 12));
    for (let i = 0; i < N; i += stepL) {
      line(out, S, S, A[i][0], A[i][1], B[i][0], B[i][1], colLink);
    }
    for (let i = 0; i < N; i++) {
      px(out, S, S, Math.round(A[i][0]), Math.round(A[i][1]), colA[0], colA[1], colA[2], 255);
      px(out, S, S, Math.round(B[i][0]), Math.round(B[i][1]), colB[0], colB[1], colB[2], 255);
    }
    return out;
  }

  function countOpaque(rgba) {
    let n = 0;
    for (let i = 3; i < rgba.length; i += 4) {
      if (rgba[i] > 24) {
        n++;
      }
    }
    return n;
  }

  // ---- the strategy -----------------------------------------------------

  function fuse(a, b, params) {
    const t = clampN(params && params.blend != null ? params.blend : 0.5, 0, 1);
    let N = Math.round(params && params.nPoints != null ? params.nPoints : 128);
    N = clampN(N, 16, 256) | 0;
    const crisp = clampN(params && params.crisp != null ? params.crisp : 1, 0, 1);

    const fallback = reason => {
      const rgba = Uint8ClampedArray.from(b.rgba);
      return {
        width: b.width,
        height: b.height,
        rgba,
        layers: [{ label: "fallback (B)", width: b.width, height: b.height, rgba: Uint8ClampedArray.from(b.rgba) }],
        meta: { rung: "fallback", reason },
      };
    };

    try {
      // shared square canvas
      const S = Math.max(8, a.width, a.height, b.width, b.height);

      const maskA = maskOf(a.rgba, a.width, a.height);
      const maskB = maskOf(b.rgba, b.width, b.height);
      const stA = maskStats(maskA, a.width, a.height);
      const stB = maskStats(maskB, b.width, b.height);
      if (!stA.count || stA.count < 8 || !stB.count || stB.count < 8) {
        return fallback("degenerate-mask");
      }
      if (stA.maxR < 1e-6 || stB.maxR < 1e-6 || stA.rms < 1e-6 || stB.rms < 1e-6) {
        return fallback("zero-extent");
      }

      // scale: common RMS radius, capped so rotation can't clip the canvas
      const scaleOf = st => Math.min((0.3 * S) / st.rms, (0.47 * S) / st.maxR);
      const scaleA = scaleOf(stA);
      const scaleB = scaleOf(stB);
      const flipA = decideFlip(maskA, a.width, a.height, stA);
      const flipB = decideFlip(maskB, b.width, b.height, stB);

      const normA = renderNormalized(a, stA, flipA, scaleA, S);
      const normB = renderNormalized(b, stB, flipB, scaleB, S);

      // contours from the largest component of each normalized mask
      const lcA = largestComponentMask(normA.mask, S, S);
      const lcB = largestComponentMask(normB.mask, S, S);
      if (!lcA || !lcB) {
        return fallback("no-component");
      }
      const cA = traceContour(lcA, S, S);
      const cB = traceContour(lcB, S, S);
      if (!cA || !cB) {
        return fallback("no-contour");
      }
      const rA = resampleArc(cA, N);
      const rB = resampleArc(cB, N);
      if (!rA || !rB) {
        return fallback("no-resample");
      }

      // mean shape + raster
      const mean = meanPolygon(rA, rB, t);
      const Mt = fillPolygon(mean, S, S);
      let mtArea = 0;
      for (let p = 0; p < S * S; p++) {
        mtArea += Mt[p];
      }
      if (mtArea < 8) {
        return fallback("empty-mean-shape");
      }

      // warp + blend interior
      const fillCol = meanFillColor(normA.rgba, normB.rgba, S, t);
      const { blended, warpedA, warpedB } = warpBlend(Mt, mean, rA, rB, normA.rgba, normB.rgba, S, t, fillCol);

      // crisp-up + outline
      const finalRgba = crispAndOutline(blended, Mt, S, crisp);

      if (countOpaque(finalRgba) < 4) {
        return fallback("empty-result");
      }

      const layers = [
        { label: "contourA", width: S, height: S, rgba: contourLayer(normA.rgba, rA, S, [255, 120, 120]) },
        { label: "contourB", width: S, height: S, rgba: contourLayer(normB.rgba, rB, S, [120, 180, 255]) },
        { label: "correspondence", width: S, height: S, rgba: correspondenceLayer(rA, rB, S) },
        { label: "meanShape", width: S, height: S, rgba: maskLayer(Mt, S, S, [228, 230, 244]) },
        { label: "warpedA", width: S, height: S, rgba: warpedA },
        { label: "warpedB", width: S, height: S, rgba: warpedB },
        { label: "final", width: S, height: S, rgba: Uint8ClampedArray.from(finalRgba) },
      ];

      return {
        width: S,
        height: S,
        rgba: finalRgba,
        layers,
        meta: { rung: "morph", blend: t, nPoints: N },
      };
    } catch (err) {
      return fallback(`exception:${err && err.message ? err.message : err}`);
    }
  }

  // NOTE: reconstructFrame / edt / skeletonize / detectSockets are imported as
  // part of the contract surface but this pragmatic morph does not need them
  // (it works off contours + IDW warp, not skeleton sockets). Unused imports are
  // legal JS and the build strips the whole import line, so they cost nothing.

  return {
    id: "morph",
    label: "Silhouette morph",
    params: [
      { key: "blend", label: "Blend A->B", min: 0, max: 1, step: 0.05, default: 0.5 },
      { key: "nPoints", label: "Contour pts", min: 32, max: 256, step: 16, default: 128 },
      { key: "crisp", label: "Crispness", min: 0, max: 1, step: 0.05, default: 1 },
    ],
    fuse,
  };
})();

STRATEGIES.push(morphStrategy);
