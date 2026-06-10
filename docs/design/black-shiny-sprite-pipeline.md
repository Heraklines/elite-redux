# Black Shiny sprite pipeline — maintainer spec (verbatim, June 10 2026)

> Recorded permanently here because the original message was once lost to a
> context compaction. This is the AUTHORITATIVE generation recipe for all t4
> (Black Shiny) sprites. Do not paraphrase away the parameters.

Apply an **"Ultra Segmented Black Shiny"** transformation to every Pokémon
sprite using hue-aware segmented monochrome palette remapping. Preserve alpha.

1. Normalize luminance using **2nd–98th percentile clipping**, apply
   **gamma 1.30** and **shadow_crush 0.08**, then remap color families into
   black/silver/white ramps.
2. Force the **darkest 15%** of opaque pixels to **pure black**.
3. **Purple/magenta/body hues** → a **cold obsidian ramp**;
   **yellow/green/highlight hues** → a **brighter silver-white ramp**.
4. **Auto-blacken the eye**: detect the brightest small connected component in
   the upper-center face region and recolor it black.
5. Add **"Balanced Smoke"**: generate a procedural black smoke aura from the
   sprite alpha mask using dilation rings, fractal noise, Gaussian blur, and
   contour-emitted trails. Composite the smoke **behind** the sprite.

Smoke parameters:

| param            | value    |
| ---------------- | -------- |
| `internal_scale` | 4        |
| `padding`        | 16       |
| `halo_layers`    | 5        |
| `base_radius`    | 6        |
| `step_radius`    | 7        |
| `halo_opacity`   | 0.78     |
| `noise_threshold`| 0.20     |
| `trail_count`    | 26       |
| `trail_length`   | (8, 22)  |
| `trail_opacity`  | 0.62     |

Additional standing requirements (same spec):

- Apply the technique to get ALL the t4 black shinies — **front AND back**
  battle sprites.
- The shiny **icon** for t4 is **BLACK** (not blue, red or golden).
- Generated assets are committed to **Heraklines/er-assets** (served via
  jsDelivr — zero Cloudflare quota) and the immutable commit SHA in
  `deploy/cloudflare/_redirects` is bumped.
