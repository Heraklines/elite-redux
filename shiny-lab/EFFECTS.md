# Shiny Lab - effect catalog (v7.2)

**Live for the team: https://shiny-lab.pages.dev** (Cloudflare Pages). Also
`articuno-shiny-lab.html` on the Desktop (self-contained except sprites).

**369 effects** in three **combinable** slots - pick one of each and they stack live:
**138 Palettes + 125 Surface FX + 106 Around FX** (v6 Discord-brainstorm batch + the v7
mega-expansion doubled every catalog; v7.1 quality pass reworked the weak ones after
zoomed per-frame triage - see `gen-zoom.mjs`, the per-effect multi-frame review tool).

## Effects lab (2026-07-17) - in-game effect previews, category based

A SECOND view sits behind the **Effects** button above the shiny options (top of the
page). It is a category based lab for previewing in-game effect bursts, kept separate
from the shiny palette/surface/around tools. The categories live in a small registry
(`FX_CATEGORIES` in `site/effects.mjs`), so adding a future category (ability effects,
move effects) is ONE new entry, not a new page.

- **Transformation Effects** (first category): previews the in-game per-type transform
  burst on each partner Eeveelution. Pick any partner (Partner Eevee base + the 8
  partner eeveelutions), flip the FRONT / BACK sprite, and PLAY / REPLAY the burst over
  the sprite on a canvas. It auto-plays when you change partner or flip the sprite; a
  Replay button re-fires it.
- The burst is a faithful canvas-2D port of `src/sprites/er-form-transform-fx.ts`: the
  same per-type tint colours (`getTypeRgb`), the same shape/motion vocabulary (grass/bug
  leaves-sway, fire embers-rise, water droplets-fall, ice/rock/steel/ground shards,
  electric sparks-burst, motes fallback), the ~950ms duration, the <=20 particle cap,
  and the tinted flash (bright core + soft halo + expanding ring) plus a brief on-sprite
  type-coloured tint. Each partner previews with ITS OWN primary type (Flareon fire,
  Leafeon grass, Vaporeon water, ..., Partner Eevee base = normal).
- Partner sprites alias their base eeveelution's vanilla art (numeric dex stem, or the
  Eevee `partner` form stem for the family head), streamed from the er-assets CDN exactly
  like the shiny tools. No new assets. Source: `ER_PARTNER_FAMILY` in
  `src/data/elite-redux/er-newcomer-species.ts`.
- Files: `site/effects.mjs` (registry + FX port + view), styles appended to
  `site/style.css`, wired into the bundle by `build-site.mjs`.

## v7.2 - Psiell's feedback round (2026-07-06)
- **Box-edge falloff**: around FX no longer hard-clip at the sprite-box edge - every
  off-sprite aura fades out over the last ~9px (`edgeFalloff` in fx.mjs; fixes fog /
  Manga Burst / rain / big auras cutting off at the box in battle). Canvas pad 22->28.
- **Fog Bank** got a second FRONT layer that covers the mon and thickens toward the
  bottom of the box (fogbank is an overlay effect now).
- **Starfall** direction fixed - stars fall down-left with the trail behind (was
  drifting up trail-first, "going backwards").
- **Lavender Ghost** rebuilt without hard luma cuts - no more banding seams / black-blob
  mons (the "ghost is wonky sometimes" report).
- **NEW Lightning Zaps** (around): one or two jagged bolts snap off the body in a random
  direction, briefly, not too often.
- **NEW Sakura Blossoms** (around): five-petal blossoms drifting down with a lazy sway,
  loose petals fluttering between them.
- **Per-layer sliders**: Surface FX and Around FX each get their OWN Speed / Seed /
  Texture noise / Color (Default-Palette-Custom) controls, plus the master speed.
- **GBC colors** checkbox: snaps all FX colors to the GBC-displayable gamut (RGB555).
- **NEW Astral Form** (surface): the living-constellation star chart. Flat night-sky
  body with soft nebula patches; the sprite's OWN linework stays lit as dim pale
  strands (local-contrast detection, so it follows any sprite's shape), and BIG
  glowing constellation stars - round core, soft halo, 4-point flare, slow pulse -
  sit anchored on those strands, joined to each other by them. A shimmer travels
  along the lines. (Iterated with the team: the earlier blinking variant and the
  "Astral Form II" A/B candidate were folded into this final version.)
- **Feet-line anchoring**: the distance field now exports `fy` (the silhouette's
  bottom), and the ground FX center on it instead of hanging a half-ring below the
  mon (tester: "the top of the circle was matched to the feet instead of the
  middle"). Realigned: Ring of Fire, Whirlpool, Magic Circle, Geyser, Equalizer,
  Creeping Shadow, Foot Frost, Underglow, Ground Mist.
- **NEW Double Team Tri** (around): Double Team's better-dressed sibling - the two
  after-images are SOLID colours forming a complementary triad with the mon's own
  dominant colour (e.g. orange Charizard gets a green echo and a purple echo).
  The original Double Team stays.
- **Lightning Zaps upgrades**: random bolt length (0.5x-1.5x); every fired bolt
  chains a fresh 20% roll for one more in the same instant (recursive, hard cap
  10) for rare overcharged bursts; and each bolt rolls a DEPTH - ~45% arc in
  FRONT of the sprite (overlay pass), the rest stay behind it.
- **NEW Gen 1** (surface): the mon as a Red/Blue sprite - chunky half-res pixels
  with hard alpha, GREYSCALE 4-tone biased bright (Gen 1 bodies are mostly
  white/light grey - matched against the real R/B sprite sheet), black silhouette
  outline PLUS the sprite's own internal line art re-inked in black (local-contrast
  detection), and selective 50% checkerboard dithering on midtones. Texture-noise
  slider = chunk size; FX color modes re-tint the ramp (DMG green / Super Game Boy).

## v7.1 quality pass (zoom-triage driven)
Every v6/v7 effect was rendered at 3x with 4 animation frames (`gen-zoom.mjs`) and
judged; ~35 got rebuilt. Replaced outright: Tiger Stripes + Leopard Print -> **Ember
Motes** and **Fairy Dust** (plus new **Glitter Storm**, **Firefly Glade**, **Soul
Siphon** replacing Bubble Wrap, **Hypno Rings** replacing Moire). New particle auras:
**Comet Orbit**, **Ember Spiral**, **Rune Orbit** (all 3D front/behind), **Petal
Vortex**, **Prism Rain**. All square "particle" cells across the aura set became soft
round glowing dots (Nuclear Winter, Moonrise/Snow Globe stars, Geyser droplet arcs,
Confetti, Zero-G Lift). Chained now draws real alternating links; Wind Ribbons hug the
body instead of smearing the frame. Nine samey palettes became structurally distinct
mappings: Patina Bronze (two materials), Sandstone (hard strata bands), Heat Mirage
(hue shimmer), Twilight Neon / Frozen Abyss / Ultra Grape (highlight snap-to-accent),
Tidepool (3-zone split), Sunlit Grove (green/gold split-tone), Velvet Noir (crushed
film grade).
**Species picker**: search any of ~992 Pokemon (top of the page); sprites stream from
the er-assets CDN (jsDelivr, pinned sha) exactly like the game. Static previews:
`contact-palette.png`, `contact-surface.png`, `contact-around.png`, `contact-combo.png`,
`contact-cluster.png`, `contact-cluster-algos.png`, `contact-hd.png`.

## Clustering selector (new)
The **Clustering** dropdown picks how the cluster palettes segment the sprite's colors:
- **K-means RGB** (default) - the original: k-means on pixel colors, luma-sorted.
- **Balanced distinct-colors** - sqrt-weighted k-means over the sprite's DISTINCT colors,
  so a big body region can't swallow small-but-distinct ones (eyes, gems).
- **Hue regions** - k-means in a hue/chroma cone: regions split by COLOR, a region's
  shading ramp stays together.
- **IEC-style** - modeled on the decompiled Inclement Emerald Customizer: neutrals
  (outlines / whites / grays, sat < 0.05) get their own protected cluster, chromatic
  colors group by single-linkage circular hue distance (variable K). Cleanest on
  multi-hue mons; keeps outlines dark.
- **Luma bands** - plain brightness quantiles (the old-ramp behavior, hue ignored).
A/B them on `contact-cluster-algos.png` (rows = algo, cols = cluster palettes).

## v6 - the Discord brainstorm batch
Palettes: Blueprint, Who's That...?, Lavender Ghost, Overexposed, Hyperpigment, Pop Art.
Surface: Neon Sign, Mist Veil, Rising Mist, Bloom, HD Lighting, Glass Warp, No Outline,
Pulled Apart, Living Shadow. Around: Energy Helix + Atomic Orbit (the first **3D
front/behind** effects - near arcs pass OVER the mon), Nuclear Winter, Sinister Sun,
HD Stars, Double Team (sprite-sampling after-images), Ground Mist.

## v7 - the mega-expansion (doubled everything)
- **+69 palettes**: 30 material/world ramps (Platinum, Lapis, Eclipse, Peacock,
  Cyberpunk, Porcelain, Voidfire, Arctic Night...), 17 technique transforms
  (Complement, Teal & Orange split-tone, Noir, CGA, Virtual Boy, Glass/Phantom
  translucents, Heat Map, Hue Glide, Stencil...), 14 new cluster combos (Bumblebee,
  Tri Nebula, Quad Cyber, Penta Galaxy...).
- **+62 surface FX**: Waterline reflection, VHS Tape, Pixel Sort, Code Rain, Honeycomb
  Plate, Knitted, Kintsugi, Gem Plate, Paper Burn, Meltdown, Sequins, Reveal Scan,
  Spotlight, Demake, Phosphor, CMYK Print, Origami, Watercolor, Inner Storm...
- **+49 around FX**: Meteor Shower, Thunderstorm, Rainbow Arc, Moonrise, Whirlpool,
  Blade Flurry, Clockwork, Fireworks, Chained / Cage of Light / Wind Ribbons / Ribbon
  Dancer / Tiny Planets / Star Ring / Orbit Debris / Hex Barrier (all 3D front/behind),
  Event Horizon, Hell Sigil, Portal, Personal Raincloud, Snow Globe, Manga Burst,
  Shock Pulse (silhouette-shaped energy echoes), Paper Lanterns...

## Cluster palettes (the fix for "monotone" recolors)
The old palettes are single-axis (luma ramp or hue shift), which collapses distinct
regions into one gradient. The 12 **cluster palettes** instead run **k-means on the
sprite's real colors** (auto, per species), sort clusters by luma, and recolor each
cluster separately -> genuine **two-tone / multi-tone** that respects regions
(body vs beak vs shadow). Duo Ink/Neon/Mono/Blood/Mint/Sunset/Mecha (2-tone), Tri
Sunset/Forest (3), Quad Vapor (4), Penta Candy/Jewel (5). Still crossplay-safe: in-game
it is the same clustering on the 11 base colors -> the 32-slot swap.

## Hyperpixel HD (surface)
Subdivides each pixel at a real 3x supersample (bilinear + slight noise) so the sprite
reads as higher-resolution. Composes with any palette + around aura.

**Three slots (mix and match):**
1. **Palette (33)** - a pure function of color. In-game = the *existing* 32-slot variant
   palette swap (apply the transform to Articuno's 11 base colors). **Crossplay-safe**:
   ~5 bytes in a ghost snapshot, identical on every client. No atlas, no shader edit.
2. **Surface FX (35)** - an animated shader *on the sprite* (aurora, galaxy, holo, etc.).
   Local overlay, composites over the palette. Several are **partial** (edges/wings/creep).
3. **Around FX (16)** - an aura in the space *around* the mon, rendered via a silhouette
   distance field: glow, flames, frost, electric field, orbiting sparks, energy rings,
   aurora curtains, holy rays, a cosmic backdrop, embers, snow, bubbles. Local cosmetic
   (or server-keyed to a player id).

Use the three dropdowns or click tiles. **Speed / Intensity** sliders, backdrops,
**Surprise me** (random combo), **Clear**. The featured bird floats.

## Palette (33)
Glacier, Aurum, Obsidian, Chrome, Amethyst, Inferno, Toxic, Rose Quartz, Verdigris,
Spectral, Negative, Void Bloom, Shadowflame, Iridescent, Thermal, Daguerreotype, Copper,
Emerald, Sapphire, Cel/Comic, Synthwave, Onyx Gold, Ultraviolet, Acid, Bubblegum, Blood,
Abyss, Antique, Frostfire, Camo, Jade, Rose Gold, Monochrome.

## Surface FX (35)
Rainbow Cycle, Aurora, Holo Foil, Prismatic, Frostbite, Datamosh, Hologram, Galaxy,
Plasma, Molten, Electric, Dissolve, Mercury, Lava Cracks, Frozen, Crystal, Stained Glass,
Marble, Bioluminescent, Constellation, Aurora Wings, Gilded Edges, Rim Light, Vaporwave,
Halftone, Starlit, Lightning Veins, Dripping Gold, Prism Split, Ripple, Circuit,
Iridescent Scales, TV Static, Scan Sweep, Toxic Bubbles.

## Around FX (16)  <- the new "aura around the Pokemon" category
Outline Glow, Soft Halo, Flame Aura, Shadow Fire, Frost Aura, Electric Field, Energy
Rings, Orbiting Sparks, Aurora Veil, Holy Light, Cosmic Backdrop, Smoke, Radiant Burst,
Ember Swarm, Snowfall, Bubble Aura.

## Combos worth trying (see contact-combo.png)
- Obsidian + Flame Aura
- Aurum + Holo Foil + Holy Light  (god-tier gold)
- Galaxy + Cosmic Backdrop  (a starfield bird in space)
- Sapphire + Frostbite + Frost Aura  (full ice)
- Shadowflame + Shadow Fire  (cursed purple flame)

## In-game mapping / collector hook (design doc)
Palette is the crossplay layer (the 32-slot swap). Surface + Around are local overlays.
Special form nests under the black-shiny roll (epic -> black 1/50 -> special 1/N).
A reroll mutates a separate persisted `erFormSeed` (never `pokemon.id`).

## Next ideas
- Seeded *variants* of one kind (8 Galaxy color schemes from one seed) - the reroll loop.
- Save/share a combo as a short code (palette+surface+around ids) so testers can swap looks.
- Per-species tuned palettes (Articuno leans cold; a fire mon gets a hotter ramp).
