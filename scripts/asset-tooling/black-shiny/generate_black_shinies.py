# =============================================================================
# ER Black Shiny (t4) sprite generator — implements the maintainer's exact
# "Ultra Segmented Black Shiny" + "Balanced Smoke" pipeline.
# See docs/design/black-shiny-sprite-pipeline.md for the authoritative spec.
#
# Usage:
#   python generate_black_shinies.py <atlas.json> [<atlas.json> ...] --out DIR
#
# Each input atlas (TexturePacker json + sibling .png) produces a recolored,
# smoke-haloed atlas pair in DIR, frame geometry expanded by PADDING on each
# side (sourceSize/spriteSourceSize adjusted so center-origin rendering is
# unchanged).
# =============================================================================
import json
import os
import sys
import random
import math
from PIL import Image, ImageFilter
import numpy as np

# --- spec parameters (verbatim) ----------------------------------------------
INTERNAL_SCALE = 4
PADDING = 16
HALO_LAYERS = 5
BASE_RADIUS = 6
STEP_RADIUS = 7
HALO_OPACITY = 0.78
NOISE_THRESHOLD = 0.20
TRAIL_COUNT = 26
TRAIL_LENGTH = (8, 22)
TRAIL_OPACITY = 0.62
GAMMA = 1.30
SHADOW_CRUSH = 0.08
DARKEST_TO_BLACK = 0.15  # darkest 15% of opaque pixels -> pure black

# Ramps: 3-stop gradients indexed by normalized luminance.
OBSIDIAN_RAMP = [(8, 8, 14), (44, 42, 58), (132, 130, 150)]  # cold obsidian
SILVER_RAMP = [(24, 24, 28), (148, 148, 158), (242, 242, 247)]  # bright silver-white
NEUTRAL_RAMP = [(10, 10, 12), (80, 80, 90), (190, 190, 200)]


def lerp_ramp(ramp, t):
    """t in [0,1] -> color along a 3-stop ramp. Vectorized over arrays."""
    t = np.clip(t, 0.0, 1.0)
    lo, mid, hi = (np.array(c, dtype=np.float32) for c in ramp)
    out = np.empty(t.shape + (3,), dtype=np.float32)
    m = t < 0.5
    tt = (t * 2.0)[..., None]
    out[m] = (lo + (mid - lo) * tt[m])
    tt2 = ((t - 0.5) * 2.0)[..., None]
    out[~m] = (mid + (hi - mid) * tt2[~m])
    return out


def rgb_to_hsv_np(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mx = np.max(rgb, axis=-1)
    mn = np.min(rgb, axis=-1)
    diff = mx - mn
    h = np.zeros_like(mx)
    mask = diff > 1e-6
    rm = mask & (mx == r)
    gm = mask & (mx == g) & ~rm
    bm = mask & ~rm & ~gm
    h[rm] = ((g[rm] - b[rm]) / diff[rm]) % 6
    h[gm] = (b[gm] - r[gm]) / diff[gm] + 2
    h[bm] = (r[bm] - g[bm]) / diff[bm] + 4
    h /= 6.0
    s = np.where(mx > 1e-6, diff / np.maximum(mx, 1e-6), 0.0)
    return h, s, mx


def transform_colors(frame_rgba):
    """Hue-aware segmented monochrome remap per the spec. Preserves alpha."""
    arr = frame_rgba.astype(np.float32) / 255.0
    rgb, alpha = arr[..., :3], arr[..., 3]
    opaque = alpha > 0.05
    if not opaque.any():
        return frame_rgba

    h, s, _v = rgb_to_hsv_np(rgb)
    lum = 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]

    # 1. Normalize luminance: 2nd-98th percentile clip.
    lo, hi = np.percentile(lum[opaque], [2, 98])
    ln = np.clip((lum - lo) / max(hi - lo, 1e-6), 0.0, 1.0)
    # 2. Gamma 1.30 + shadow crush 0.08.
    ln = ln ** (1.0 / GAMMA)
    ln = np.clip((ln - SHADOW_CRUSH) / (1.0 - SHADOW_CRUSH), 0.0, 1.0)

    # 3. Hue families -> ramps. Purple/magenta + saturated body hues ->
    #    cold obsidian; yellow/green highlight hues -> bright silver-white;
    #    everything else -> neutral black-silver.
    purple = (h >= 0.66) & (h <= 0.97) & (s > 0.15)
    yellow_green = (h >= 0.10) & (h <= 0.45) & (s > 0.15)

    out = lerp_ramp(NEUTRAL_RAMP, ln)
    out[purple] = lerp_ramp(OBSIDIAN_RAMP, ln)[purple]
    out[yellow_green] = lerp_ramp(SILVER_RAMP, ln)[yellow_green]

    # 4. Force the darkest 15% of opaque pixels to pure black.
    if opaque.sum() > 0:
        cut = np.percentile(ln[opaque], DARKEST_TO_BLACK * 100)
        black_mask = opaque & (ln <= cut)
        out[black_mask] = 0.0

    res = frame_rgba.copy()
    res[..., :3] = np.clip(out, 0, 255).astype(np.uint8)
    return res


def blacken_eye(frame_rgba):
    """Detect the brightest small connected component in the upper-center face
    region and recolor it black."""
    h_px, w_px = frame_rgba.shape[:2]
    alpha = frame_rgba[..., 3]
    lum = frame_rgba[..., :3].astype(np.float32).mean(axis=-1)
    region = np.zeros_like(alpha, dtype=bool)
    region[int(h_px * 0.08): int(h_px * 0.55), int(w_px * 0.25): int(w_px * 0.75)] = True
    cand = region & (alpha > 64) & (lum > 200)
    if not cand.any():
        return frame_rgba
    # Connected components via simple flood fill (4-neighbour).
    labels = np.zeros(cand.shape, dtype=np.int32)
    cur = 0
    comps = []
    idxs = np.argwhere(cand)
    for y, x in idxs:
        if labels[y, x]:
            continue
        cur += 1
        stack = [(y, x)]
        pix = []
        while stack:
            cy, cx = stack.pop()
            if cy < 0 or cx < 0 or cy >= cand.shape[0] or cx >= cand.shape[1]:
                continue
            if not cand[cy, cx] or labels[cy, cx]:
                continue
            labels[cy, cx] = cur
            pix.append((cy, cx))
            stack.extend([(cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)])
        comps.append(pix)
    max_area = max(int(0.04 * h_px * w_px), 12)
    small = [c for c in comps if 1 <= len(c) <= max_area]
    if not small:
        return frame_rgba
    best = max(small, key=lambda c: float(np.mean([lum[y, x] for y, x in c])))
    res = frame_rgba.copy()
    for y, x in best:
        res[y, x, 0:3] = 0
    return res


def make_smoke(alpha_mask, rng):
    """'Balanced Smoke': dilation rings + fractal noise + blur + contour trails.
    alpha_mask: HxW float 0..1 at INTERNAL scale (already padded canvas)."""
    h_px, w_px = alpha_mask.shape
    mask_img = Image.fromarray((alpha_mask * 255).astype(np.uint8))

    smoke = np.zeros((h_px, w_px), dtype=np.float32)
    for layer in range(HALO_LAYERS):
        radius = (BASE_RADIUS + STEP_RADIUS * layer) * INTERNAL_SCALE
        dil = mask_img.filter(ImageFilter.MaxFilter(min(2 * (radius // 2) + 1, 81)))
        ring = np.asarray(dil, dtype=np.float32) / 255.0
        weight = HALO_OPACITY * (1.0 - layer / HALO_LAYERS)
        smoke = np.maximum(smoke, ring * weight)

    # Fractal noise (3 octaves of upsampled random fields).
    noise = np.zeros((h_px, w_px), dtype=np.float32)
    amp_total = 0.0
    for octave, cell in enumerate([24, 12, 6]):
        gh, gw = max(2, h_px // (cell * INTERNAL_SCALE)), max(2, w_px // (cell * INTERNAL_SCALE))
        field = rng.random((gh, gw)).astype(np.float32)
        up = np.asarray(
            Image.fromarray((field * 255).astype(np.uint8)).resize((w_px, h_px), Image.BILINEAR),
            dtype=np.float32,
        ) / 255.0
        amp = 1.0 / (octave + 1)
        noise += up * amp
        amp_total += amp
    noise /= amp_total
    smoke *= np.where(noise > NOISE_THRESHOLD, noise, 0.0)

    # Contour-emitted trails.
    edge = np.asarray(mask_img.filter(ImageFilter.FIND_EDGES), dtype=np.float32) / 255.0
    contour = np.argwhere(edge > 0.2)
    if len(contour) > 0:
        for _ in range(TRAIL_COUNT):
            y0, x0 = contour[rng.integers(len(contour))]
            length = rng.integers(TRAIL_LENGTH[0], TRAIL_LENGTH[1] + 1) * INTERNAL_SCALE
            angle = rng.uniform(-math.pi, 0)  # drift upward-ish
            drift = rng.uniform(-0.4, 0.4)
            for step in range(length):
                t = step / max(length - 1, 1)
                y = int(y0 + math.sin(angle) * step + rng.uniform(-1, 1) * 2)
                x = int(x0 + math.cos(angle) * step * 0.4 + drift * step + rng.uniform(-1, 1) * 2)
                if 0 <= y < h_px and 0 <= x < w_px:
                    val = TRAIL_OPACITY * (1.0 - t)
                    yy, xx = slice(max(0, y - 2), y + 3), slice(max(0, x - 2), x + 3)
                    smoke[yy, xx] = np.maximum(smoke[yy, xx], val * 0.8)

    smoke_img = Image.fromarray((np.clip(smoke, 0, 1) * 255).astype(np.uint8))
    smoke_img = smoke_img.filter(ImageFilter.GaussianBlur(2.5 * INTERNAL_SCALE))
    return np.asarray(smoke_img, dtype=np.float32) / 255.0


def process_frame(frame_rgba, seed):
    """Full per-frame pipeline at internal scale; returns padded RGBA frame."""
    rng = np.random.default_rng(seed)
    fh, fw = frame_rgba.shape[:2]

    # Recolor + eye at native resolution first (pixel-art exactness).
    recolored = blacken_eye(transform_colors(frame_rgba))

    # Padded internal-scale canvas.
    cw, ch = (fw + 2 * PADDING) * INTERNAL_SCALE, (fh + 2 * PADDING) * INTERNAL_SCALE
    canvas = Image.new("RGBA", (cw, ch), (0, 0, 0, 0))
    sprite_big = Image.fromarray(recolored).resize((fw * INTERNAL_SCALE, fh * INTERNAL_SCALE), Image.NEAREST)
    off = PADDING * INTERNAL_SCALE
    canvas.paste(sprite_big, (off, off))

    alpha_mask = np.asarray(canvas, dtype=np.float32)[..., 3] / 255.0
    smoke = make_smoke(alpha_mask, rng)
    # Smoke never covers the sprite body — composite BEHIND.
    smoke_alpha = np.clip(smoke * (1.0 - alpha_mask), 0, 1)

    out = np.zeros((ch, cw, 4), dtype=np.float32)
    out[..., 3] = smoke_alpha  # black smoke: RGB stays 0
    spr = np.asarray(canvas, dtype=np.float32) / 255.0
    sa = spr[..., 3:4]
    out[..., :3] = spr[..., :3] * sa + out[..., :3] * (1 - sa)
    out[..., 3] = np.clip(sa[..., 0] + smoke_alpha * (1 - sa[..., 0]), 0, 1)

    final = Image.fromarray((out * 255).astype(np.uint8)).resize(
        (fw + 2 * PADDING, fh + 2 * PADDING), Image.LANCZOS
    )
    return np.asarray(final)


def process_atlas(json_path, out_dir):
    with open(json_path, encoding="utf-8") as f:
        atlas = json.load(f)
    png_path = os.path.splitext(json_path)[0] + ".png"
    sheet = np.asarray(Image.open(png_path).convert("RGBA"))
    # TexturePacker multi-texture format ({textures:[{frames:[...]}]}) OR the
    # older flat hash format ({frames:{name:{...}} | [...], meta:{...}}) - a
    # large minority of er-assets atlases use the flat one (the full-roster
    # run's KeyError: 'textures').
    if "textures" in atlas:
        tex = atlas["textures"][0]
        frames = tex["frames"]
    else:
        raw = atlas.get("frames", [])
        if isinstance(raw, dict):
            frames = []
            for name, fr in raw.items():
                fr = dict(fr)
                fr.setdefault("filename", name)
                frames.append(fr)
        else:
            frames = list(raw)
        for fr in frames:
            fr.setdefault("rotated", False)
            fr.setdefault("trimmed", False)
            fr.setdefault("sourceSize", {"w": fr["frame"]["w"], "h": fr["frame"]["h"]})
            fr.setdefault("spriteSourceSize", {"x": 0, "y": 0, "w": fr["frame"]["w"], "h": fr["frame"]["h"]})
        tex = {
            "format": "RGBA8888",
            "scale": atlas.get("meta", {}).get("scale", 1),
        }
    if not frames:
        print(f"SKIP {json_path}: no frames")
        return

    processed = []
    for i, fr in enumerate(frames):
        r = fr["frame"]
        sub = sheet[r["y"]: r["y"] + r["h"], r["x"]: r["x"] + r["w"]]
        seed = (hash(os.path.basename(json_path)) & 0xFFFF) * 1000 + i
        processed.append(process_frame(sub, seed))

    # Shelf-pack the padded frames into a new sheet.
    max_w = max(p.shape[1] for p in processed)
    sheet_w = max(512, max_w)
    x = y = shelf_h = 0
    placements = []
    for p in processed:
        ph, pw = p.shape[:2]
        if x + pw > sheet_w:
            x = 0
            y += shelf_h
            shelf_h = 0
        placements.append((x, y))
        shelf_h = max(shelf_h, ph)
        x += pw
    sheet_h = y + shelf_h
    new_sheet = np.zeros((sheet_h, sheet_w, 4), dtype=np.uint8)
    new_frames = []
    for fr, p, (px, py) in zip(frames, processed, placements):
        ph, pw = p.shape[:2]
        new_sheet[py: py + ph, px: px + pw] = p
        nf = json.loads(json.dumps(fr))
        nf["frame"] = {"x": px, "y": py, "w": pw, "h": ph}
        nf["rotated"] = False
        nf["trimmed"] = True
        nf["sourceSize"] = {"w": fr["sourceSize"]["w"] + 2 * PADDING, "h": fr["sourceSize"]["h"] + 2 * PADDING}
        nf["spriteSourceSize"] = {
            "x": fr["spriteSourceSize"]["x"],
            "y": fr["spriteSourceSize"]["y"],
            "w": pw,
            "h": ph,
        }
        new_frames.append(nf)

    base = os.path.basename(os.path.splitext(json_path)[0])
    rel_back = "back" + os.sep if os.sep + "back" + os.sep in json_path or "/back/" in json_path.replace("\\", "/") else ""
    out_sub = os.path.join(out_dir, rel_back)
    os.makedirs(out_sub, exist_ok=True)
    Image.fromarray(new_sheet).save(os.path.join(out_sub, base + ".png"), optimize=True)
    out_atlas = {
        "textures": [
            {
                "image": base + ".png",
                "format": tex.get("format", "RGBA8888"),
                "size": {"w": sheet_w, "h": sheet_h},
                "scale": tex.get("scale", 1),
                "frames": new_frames,
            }
        ],
        "meta": atlas.get("meta", {}),
    }
    with open(os.path.join(out_sub, base + ".json"), "w", encoding="utf-8") as f:
        json.dump(out_atlas, f, separators=(",", ":"))
    print(f"OK {rel_back}{base}: {len(frames)} frames -> {sheet_w}x{sheet_h}")


if __name__ == "__main__":
    args = sys.argv[1:]
    out = "black-out"
    if "--out" in args:
        i = args.index("--out")
        out = args[i + 1]
        del args[i: i + 2]
    for path in args:
        process_atlas(path, out)
