/* Fusion Lab - fusion strategy engine. Each STRATEGIES entry is a pluggable
 * sprite-fusion algorithm: { id, label, params, fuse(a, b, p) -> { image, layers, meta } }
 * where A is the head donor and B is the body donor. Image primitives + the strategy
 * registry live here (kept dependency-free so they unit-test under `node --test`).
 * Stub for now - the algorithm lands in a later unit. */

export const STRATEGIES = [];

/* reconstructFrame - PURE frame reconstruction from a TexturePacker atlas.
 *
 * Sprites ship as trimmed atlas frames: a frame's atlas sub-rect (`frame.{x,y,w,h}`)
 * is only the non-transparent bounding box, and `spriteSourceSize.{x,y}` says where
 * that box sits inside the full, untrimmed sprite of size `sourceSize.{w,h}`. This
 * rebuilds the full sprite: a transparent `sourceSize` buffer with the atlas sub-rect
 * blitted in at the trim offset.
 *
 * Operates entirely on typed arrays - NO DOM / canvas - so it unit-tests headlessly
 * and is reused by the fusion algorithm in a later unit. The browser loader
 * (`loadSpecies` in app.js) feeds it the full atlas RGBA from a one-shot getImageData.
 *
 * @param {Uint8ClampedArray} atlasRGBA  full atlas pixels, length atlasW*atlasH*4
 * @param {number} atlasW                atlas width in px
 * @param {number} atlasH                atlas height in px
 * @param {{x:number,y:number,w:number,h:number}} frame          sub-rect inside the atlas
 * @param {{x:number,y:number}} spriteSourceSize                 trim offset into the full sprite
 * @param {{w:number,h:number}} sourceSize                       full (untrimmed) sprite size
 * @returns {{width:number,height:number,rgba:Uint8ClampedArray}}
 */
export function reconstructFrame(atlasRGBA, atlasW, atlasH, frame, spriteSourceSize, sourceSize) {
  const width = sourceSize.w;
  const height = sourceSize.h;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const offX = (spriteSourceSize && spriteSourceSize.x) || 0;
  const offY = (spriteSourceSize && spriteSourceSize.y) || 0;
  for (let yy = 0; yy < frame.h; yy++) {
    for (let xx = 0; xx < frame.w; xx++) {
      const sx = frame.x + xx;
      const sy = frame.y + yy;
      if (sx < 0 || sy < 0 || sx >= atlasW || sy >= atlasH) {
        continue;
      }
      const dx = offX + xx;
      const dy = offY + yy;
      if (dx < 0 || dy < 0 || dx >= width || dy >= height) {
        continue;
      }
      const si = (sy * atlasW + sx) * 4;
      const di = (dy * width + dx) * 4;
      rgba[di] = atlasRGBA[si];
      rgba[di + 1] = atlasRGBA[si + 1];
      rgba[di + 2] = atlasRGBA[si + 2];
      rgba[di + 3] = atlasRGBA[si + 3];
    }
  }
  return { width, height, rgba };
}
