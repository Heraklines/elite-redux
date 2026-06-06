// =============================================================================
// Elite Redux — chroma-key opaque backgrounds out of ER-custom sprite atlases.
//
// A handful of ER-custom sprites (e.g. Noibat Redux) shipped without an alpha
// channel: the source PNG has a flat opaque background baked in, so the mon
// renders inside a coloured box on the field. The proper fix is re-exporting the
// art with transparency, but those assets live outside this repo, so we key the
// background out at load time instead.
//
// Approach (deliberately conservative — it must NEVER mangle a correctly-authored
// sprite or crash the loader):
//   1. Only runs for ER-custom atlas keys (those containing `er__`).
//   2. Samples each frame's top-left pixel; if they're already transparent the
//      sprite has proper alpha → no-op.
//   3. If the sampled corners agree on a single opaque colour, that colour is
//      treated as the background and every opaque pixel matching it (within a
//      small tolerance) is made transparent. Disagreeing corners → no-op (we
//      can't be confident there's a flat background, so we leave it alone).
//   4. The keyed image replaces the texture, re-registering the original atlas
//      frames so animations/lookups are unaffected.
// Everything is wrapped so any failure degrades to "sprite unchanged".
// =============================================================================

/** Per-channel tolerance when matching the sampled background colour. */
const BG_MATCH_TOLERANCE = 16;

interface FrameRect {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Chroma-key the flat opaque background out of an ER-custom sprite atlas, in
 * place (replacing the texture under the same key, preserving its frames).
 * Safe to call on any key — it returns early for non-ER keys, already-transparent
 * sprites, ambiguous backgrounds, and any error.
 */
export function chromaKeyErSpriteTexture(scene: Phaser.Scene, key: string): void {
  try {
    if (!key.includes("er__") || !scene.textures.exists(key)) {
      return;
    }
    const tex = scene.textures.get(key);
    const src = tex.getSourceImage() as CanvasImageSource & { width?: number; height?: number };
    const width = typeof src.width === "number" ? src.width : 0;
    const height = typeof src.height === "number" ? src.height : 0;
    if (width <= 0 || height <= 0) {
      return;
    }

    const frames: FrameRect[] = tex
      .getFrameNames()
      .map(name => {
        const f = tex.frames[name];
        return { name, x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight };
      })
      .filter(f => f.w > 0 && f.h > 0);
    if (frames.length === 0) {
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.drawImage(src, 0, 0);
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;

    const pixelAt = (x: number, y: number): [number, number, number, number] => {
      const i = (y * width + x) * 4;
      return [data[i], data[i + 1], data[i + 2], data[i + 3]];
    };

    // Sample each frame's top-left corner; require unanimous, opaque agreement.
    let bg: [number, number, number] | null = null;
    for (const f of frames) {
      const [r, g, b, a] = pixelAt(f.x, f.y);
      if (a < 255) {
        return; // a transparent corner → sprite already has alpha; leave it.
      }
      if (bg === null) {
        bg = [r, g, b];
      } else if (Math.abs(bg[0] - r) > BG_MATCH_TOLERANCE || Math.abs(bg[1] - g) > BG_MATCH_TOLERANCE || Math.abs(bg[2] - b) > BG_MATCH_TOLERANCE) {
        return; // corners disagree → not a confident flat background.
      }
    }
    if (bg === null) {
      return;
    }

    let changed = false;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) {
        continue;
      }
      if (
        Math.abs(data[i] - bg[0]) <= BG_MATCH_TOLERANCE &&
        Math.abs(data[i + 1] - bg[1]) <= BG_MATCH_TOLERANCE &&
        Math.abs(data[i + 2] - bg[2]) <= BG_MATCH_TOLERANCE
      ) {
        data[i + 3] = 0;
        changed = true;
      }
    }
    if (!changed) {
      return;
    }
    ctx.putImageData(imageData, 0, 0);

    scene.textures.remove(key);
    const newTex = scene.textures.addCanvas(key, canvas);
    if (newTex) {
      for (const f of frames) {
        newTex.add(f.name, 0, f.x, f.y, f.w, f.h);
      }
    }
  } catch (err) {
    console.warn(`[er-chroma-key] skipped ${key}:`, err);
  }
}
