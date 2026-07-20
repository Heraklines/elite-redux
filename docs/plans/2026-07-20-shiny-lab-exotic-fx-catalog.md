# Shiny Lab exotic FX: Phase A catalog analysis + mechanism inventory

Date: 2026-07-20. Branch: feat/shiny-lab-exotic-fx. Author: VFX engineer (autonomous).

## 1. What the catalog already saturates (rejected-equivalent territory)

Read of all ~270 production effects (PALETTE 124 / AURA 126 / AROUND 106 ids)
groups the catalog into these families:

| Family | Existing members (representative) | Verdict |
|---|---|---|
| Hue cycling / gradient reskins | rainbow, hueglide, iridescent, oilspill, most duo/tri/quad/penta cluster palettes | BANNED (brief) |
| Weather / particle fall | snow, rain, petals, embers, feathers, leaves, confetti, meteors, starfall, glyphs, coins, cards, bubbles, butterflies, bats, lanterns | BANNED as primary idea |
| Elemental coats | flame, frostbite, molten, electric, poison, spiritflame, smolder, firecreep, snowcap, frostcore | BANNED (flame/electric named) |
| Rotating rings / orbiters | rings, orbit, atomrings, helix, planets, starcircle, cometorbit, runeorbit, orbitdebris, magiccircle, firering, eventhorizon, whirlpool, vortex | BANNED (ring/orbit named) |
| Fog / mist / smoke | mistveil, mistfeet, lowmist, smoke, fogbank, smokerings, creepingshadow | BANNED (fog named) |
| Stars / space / constellations | galaxy, cosmos, starmap, constellation, hdstars, galaxyspiral, moonrise, sinistersun | BANNED (galaxy/constellation named) |
| Tech / glitch / scans | glitch, circuit, coderain, datacorrupt, tron, neonwire, scansweep, synthscan, binarybody, tvstatic, vhs, tvbars, revealscan, blueprintscan, radarsweep, lasershow, lockon, equalizer, hologram, kaleido | BANNED (circuit/glitch/hologram named) |
| Cracks / shatter / damage | lavacracks, shatter, kintsugi, crackleglaze, sundered, pixelsort, meltdown, paperburn | BANNED (kintsugi/cracks named) |
| Halos / glows / rays / outlines | halo, outline, goldenglow, shadowaura, rainbowoutline, holyrays, topbeam, sideaura, underlight, luminous, radiant, rimlight, gildededges, bloom, spotlight(s), guardianwings | BANNED (halo/glow named) |
| Stained glass / facets / gems | stainedglass, crystalfacets, gemplate, discoball | BANNED (named) |
| Auroras / veils / ribbons | aurora, auroraveil, aurorawings, windribbons, ribbonloop | BANNED (aurora named) |
| Materials (static) | chrome, mercury, marble, brushedmetal, carbonweave, honeyplate, goldleaf, rust, petrified, mossgrow, slimecoat, bubblewrap, origami, papercut, stitchwork, mosaictile, inkwash, watercolor, porcelain | CROWDED - only impossible/living materials allowed |
| Print / retro | halftone, cmykprint, popart, gameboy, retro, genone, demake, poster, cga, virtualboy, phosphor, oldfilm | crowded; not luxury |
| Body modifiers | unlined, xray, dissolve, livingshadow, doubleexposure, astral, spectral, phantom, glassbody, activecamo | xray/astral adjacent - new body mechanics must transform, not tint |
| Ground phenomena | footfrost, waterline, geyser, quick ground props | crowded |

What this means: nearly everything is either a 2D overlay pattern, a
screenspace texture, or a particle emitter. Almost NOTHING in the catalog:

1. **rearranges the mon's own pixels through a continuous map** (only prismatic
   channel split + glitch slices + ripple/glasswarp offsets do, and all are
   small constant offsets, not geometry),
2. **uses the mon's TOPOLOGY** (inside-distance, medial axis, normals) - the
   renderer only exposes a rim `e` and an outside distance `df`; nothing knows
   how deep inside the body a pixel is or which direction the surface faces,
3. **uses OTHER FRAMES of the animation** - every effect is a pure function of
   the CURRENT frame; the other 29-67 frames of the idle loop are untouched
   information,
4. **simulates optics** (refraction, dispersion, interference) - "oilfilm /
   soapswirl / pearl" are hue-shift patterns, not actual thin-film physics
   driven by geometry,
5. **has state / events** - every effect loops uniformly; nothing idles for a
   minute then does a one-second beat,
6. **uses the animation's stable identity across frames** - per-frame centroid
   anchoring (the wobble bug fixed in this branch) proves the system never
   thought about cross-frame structure at all.

## 2. Extension-enabled opportunity map

New cached prep fields (dev-lab `shiny-lab-lab.ts`, graduating to production):

- `sdf` (inside distance, px) - depth inside the body
- `voro` (interior Voronoi border / medial-axis strength) - the mon's skeleton
- `nx, ny` (outward normal), `tx, ty` (tangent) - surface orientation
- `matcapZ` (relief sphere z from sdf) - fake 3D form
- `pixId` (deterministic per-pixel hash) - stable identity
- `stableCx/Cy/Fy` + `frameCx/Cy/Fy` - wobble-free vs body-following anchors
- `frameSample(i, x, y)` + `frameCount/frameIndex` - other animation frames
- alpha-aware sampler is the existing `sa`

| Mechanism family unlocked | Fields used |
|---|---|
| Internal depth materials (cores, chambers, embers under skin) | sdf, pixId |
| Skeleton-riding ornament (filigree, meridians, circuitry that follows BONES not screen) | voro, sdf, tx/ty |
| Relief-lit materials (matcap metals, carved stone, subsurface) | matcapZ, nx/ny |
| True refraction through the body | sa + sdf + nx/ny (ray march to far side) |
| Temporal composites (echoes, frame windows, shutter) | frameSample, frameIndex |
| Wobble-free landmarks (portals, sigils, pins) | stableCx/Cy/Fy |
| Per-pixel stable micro-structure (nacre, fibers, enamel grain) | pixId, sdf |
| Optics (thin-film by angle & depth, dispersion by normal) | nx/ny, sdf, matcapZ |

## 3. Phase A mechanism inventory (22)

Every entry: the visual MECHANISM first (what the eye actually sees), why it is
not an existing catalog family, and the fields it needs. Names are working
titles, not final labels.

1. **Internal Core** - a slow-breathing glow that lives DEEP in the body
   (sdf-normalized depth), visible through a "skin window" near the silhouette;
   the body reads as translucent flesh over an ember. No existing effect
   separates "skin" from "depth" - this is the first subdermal material.
   Fields: sdf, pixId. Surface.

2. **Medial Filigree** - luminous engraved tracery that follows the mon's
   actual skeleton (voro midlines), fading toward the silhouette like inlaid
   gold wire under lacquer. Topology-aware ornament: on Articuno it traces the
   wing spars and tail fan; on a quadruped the spine and legs. Nothing in the
   catalog knows where the mon's "bones" are. Fields: voro, sdf. Surface.

3. **Matcap Relief** - the sprite re-lit as a solid 3D relief (normals from
   sdf gradient shaded by a fixed key light), turning flat pixel art into
   carved gemstone / cast metal while staying 100% the mon's silhouette and
   colors. Existing "HD Lighting"/softshade is a vertical gradient; this is
   per-normal lighting. Fields: matcapZ, nx, ny. Surface.

4. **Temporal Echo** - the previous and next animation frames ghosted behind
   the current one at low alpha, offset-free: the mon drags its own recent
   past like a slow shutter. The catalog has echoes/triecho (static copies at
   fixed offsets); this uses REAL frame data, so wings smear along their
   actual motion path. Fields: frameSample, frameIndex. Surface.

5. **Frozen Shutter** - one frozen reference frame (frame 0) rendered faintly
   UNDER the live sprite, inside the silhouette only: the body becomes a glass
   case containing its own "specimen" pose while the live pose moves over it.
   A taxidermy/museum impossibility. Fields: frameSample. Surface.

6. **Through-Body Refraction** - each body pixel ray-marched THROUGH the
   silhouette along the local normal: you see the warped far-side of the
   background/pad through the mon, with dispersion fringes at grazing normals.
   The body becomes a lens, not a hologram. Fields: sdf, nx/ny, sa. Surface.

7. **Droste Window** - a bounded region (the chest area, found from stable
   anchors + sdf, not hardcoded) contains a recursively scaled copy of the
   whole sprite, 2 levels deep, like a portal medallion: the mon carries a
   miniature of itself inside itself. Recursive sprite-space sampling - the
   "nested portal" the brief asks about, bounded and readable. Fields: sa,
   stable anchors, sdf. Surface.

8. **Skeleton Meridian Pulse** - slow luminous packets traveling ALONG the
   voro midlines (parameterized by distance along skeleton from the feet),
   like blood-light in channels. Differs from medial filigree (static inlay)
   by being a directional flow field on the skeleton. Fields: voro, sdf,
   tx/ty. Surface.

9. **Per-Region Clockwork** - contiguous body regions (Voronoi seeds of the
   interior field) tick like escapements: each region's brightness advances in
   discrete steps at its own phase, so the body reads as dozens of meshing
   gears' faces, edges darkened (voro borders as gear seams). Machinery UNDER
   the skin, not cogs floating around. Fields: voro cells, pixId. Surface.

10. **Opal Fire (real thin-film)** - play-of-color computed as thin-film
    interference: hue = f(incidence angle from nx/ny + optical depth from
    sdf), so color flashes move when the POSE changes (different pixels catch
    the angle), exactly like opal/labradorite. Existing "opal" palette is a
    static luma->hue ramp. Fields: nx/ny, sdf. Surface.

11. **Nacre Layers** - stacked sine interference bands (pearl nacre physics:
    optical thickness varies with sdf) producing pearlescent depth-band
    shimmer that reveals the body's layered relief, with pixId jitter so it
    reads as organic grain, not screen stripes. Fields: sdf, pixId. Surface.

12. **Event Horizon Lens** (sprite-space) - background pixels near the
    silhouette sample the SOURCE sprite uv pulled toward a point just outside
    the body, as if a small black hole orbits at the mon's shoulder: space
    (and faint copies of the mon itself) visibly bends. The existing
    eventhorizon AROUND is a dark disc + ring; this actually LENSES pixels.
    Fields: spr-style sampler, stable anchors. Around.

13. **Impossible Staircase Shadow** - a second "cast shadow" of the sprite
    (alpha silhouette, dark) that is flipped, offset to the stable feet line,
    and slowly walks its offset around the contact point like a sundial: the
    shadow disagrees with the light. No existing effect casts a shadow from
    actual alpha. Fields: frame alpha via spr sampler, stableFy. Around.

14. **Pinned Stitch Constellation** - a small set of pixId-seeded "pin" points
    INSIDE the body (stable across frames because pixId is pixel-stable and
    body-advected) connected by faint taut threads that cross the silhouette;
    as the pose changes the pins ride the body and the threads re-stretch: a
    rigged-puppet x-ray. Different from starmap (screen-space dots): points
    are nailed to flesh. Fields: pixId, sdf. Surface.

15. **Breathing Chambers** - internal cavities (sdf > threshold) subdivided by
    voro borders into "rooms"; each room slowly fills and drains with light in
    a peristaltic order from feet to head - the body as a living building with
    lit windows seen through translucent walls. Fields: sdf, voro. Surface.

16. **Frame-Window Collage** - a coarse pixel mosaic over the body where each
    mosaic CELL shows the current pose sampled from a DIFFERENT animation
    frame (cell index picks frame index): the mon's surface becomes a quilt of
    its own motion, flicker-free because cells are stable (pixId-quantized).
    Fields: frameSample, pixId. Surface.

17. **Depth Fog Interior** - inverse of atmospheric fog: a depth-graded
    luminance falloff INSIDE the body (bright silhouette rim grading to dim
    core) with subtle cool hue shift, making the flat sprite read as a figure
    carved from glowing mist densest at its edges. Uses inside distance the
    way fog uses screen depth. Fields: sdf. Surface.

18. **Tornado Paper** - the sprite's pixels are sampled through a slowly
    time-varying polar swirl centered on the stable anchor, amplitude
    weighted by sdf (rim still, core twisting): the mon's interior churns like
    a whirlpool trapped under glass while the outline stays perfectly still.
    No geometry wobble (rim weight 0) - an interior liquid clock. Fields: sa,
    sdf, stable anchors. Surface.

19. **Amber Inclusion** - the body becomes fossil amber: warm depth-graded
    transmission (sdf), plus 1-3 tiny dark "inclusions" (seeded stable blobs
    of silhouette from a scaled-down OTHER frame, like trapped insects)
    suspended at fixed depth positions. Luxury material + narrative. Fields:
    sdf, frameSample, pixId. Surface.

20. **Anisotropic Brushed Gem** - specular bands swept along the TANGENT
    direction field (tx/ty): light appears to run around the mon's contours
    like brushed metal following the form, not screen-space diagonal streaks.
    Fields: tx/ty, nx/ny, matcapZ. Surface.

21. **Second Face (parallax cameo)** - a dim, scaled, vertically mirrored
    copy of the sprite lives in the pad area BELOW the feet line, blurred by
    df, like a reflection in dark water; it uses the REAL other frames so the
    reflection animates slightly out of phase (frames sampled at t-delta).
    Existing waterline is a horizontal shimmer line; this is a living
    reflection. Fields: frameSample, stableFy. Around.

22. **Gravity Lens Echo** - 2-3 faint copies of the silhouette refracted into
    an Einstein ring ONLY where df < few px, pulled from spr samples along the
    ring normal: the mon is ringed by lensed fragments of itself (not an
    orbit - a relativistic image). Fields: spr sampler, df, stable anchors.
    Around.

## 4. Early elimination (before prototyping)

- 12, 21, 22 overlap (all are "mon's own image outside the body"); prototype
  all three but expect at most ONE survivor.
- 1 and 15 are cousins (depth glow vs room fill); keep both, likely merge.
- 17 risks reading as "just a vignette" - lowest priority for prototyping;
  include only if pipeline is fast.
- 10 and 11 are both interference physics; keep both (different math and
  look: opal flashes vs nacre bands).
- 3 and 20 are both normal-driven lighting; keep both (relief vs anisotropy).

Prototype list for Phase B (12): 1, 2, 3, 4, 5, 6, 7, 9, 10, 12, 18, 19
(with 15 as stretch, 21/22 as the around candidates if 12 fails review).
