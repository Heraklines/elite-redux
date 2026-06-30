/* Fusion Lab - strategy plugin TEMPLATE + proof.
 *
 * Each new fusion strategy lives in its OWN file at fusion-lab/strategies/<id>.mjs
 * (so strategies can be developed in parallel without ever editing fusion.mjs) and
 * follows this CONTRACT (real one-line ESM import of STRATEGIES + any primitives
 * from the sibling module ../fusion.mjs - see the live import at the bottom of
 * this file):
 *
 *   import { STRATEGIES, maskOf, edt, quantizeOklab, oklabToSrgb } from ../fusion.mjs
 *   export const <id>Strategy = {
 *     id: "<id>",
 *     label: "<Label>",
 *     params: [{ key, label, min, max, step, default }],   // numeric sliders (may be [])
 *     fuse(a, b, params) {
 *       // a = head donor, b = body donor (SpriteData: {dex,name,width,height,rgba})
 *       return { width, height, rgba, layers: [{ label, width, height, rgba }], meta };
 *     },
 *   };
 *   STRATEGIES.push(<id>Strategy);
 *
 * The REAL `import` + `export` make the file node-testable standalone (`node --test`).
 * At BUILD time build-site.mjs strips the `import ... from ...` line(s) and the
 * leading `export ` keyword, then inlines the body AFTER fusion.mjs (so every
 * primitive + the STRATEGIES global already exist) and BEFORE site/app.js (which
 * reads STRATEGIES). So your `STRATEGIES.push(...)` runs at exactly the right time.
 *
 * GOTCHAS for strategy authors:
 *  - Keep each `import` on ONE line - the build inliner removes import lines with a
 *    single-line regex (a multi-line import would be only partially stripped).
 *  - Importable from ../fusion.mjs: the STRATEGIES registry plus the primitives
 *    maskOf, components, srgbToOklab, oklabToSrgb, quantizeOklab, edt, skeletonize,
 *    detectSockets, reconstructFrame. (Only these are exported; helpers internal to
 *    fusion.mjs are not - re-implement or compose the exported primitives.)
 *  - Stay DOM-free (no ImageData / canvas / document): operate on plain rgba
 *    Uint8ClampedArray buffers so the strategy unit-tests headlessly.
 *
 * passthroughB below is the trivial proof of the wiring: it returns B's pixels
 * untouched with a single debug layer. Copy this file to strategies/<id>.mjs as a
 * starting point for a real strategy. */

import { STRATEGIES } from "../fusion.mjs";

export const passthroughBStrategy = {
  id: "passthroughB",
  label: "Passthrough B (template)",
  params: [],
  fuse(a, b) {
    return {
      width: b.width,
      height: b.height,
      rgba: new Uint8ClampedArray(b.rgba),
      layers: [{ label: "b", width: b.width, height: b.height, rgba: new Uint8ClampedArray(b.rgba) }],
      meta: { rung: "passthrough" },
    };
  },
};

STRATEGIES.push(passthroughBStrategy);
