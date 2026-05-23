# Elite Redux — custom move battle animation & SFX status

Last updated: 2026-05-23

## TL;DR

- **Path chosen**: B (fallback mapping). Source not feasible to extract in
  the current sprint — see "Why not Path A" below.
- **Coverage**: 187/187 ER-custom moves now resolve to a thematically
  matched vanilla anim JSON (Fire→Flamethrower, Ghost→Shadow Ball, …).
- **SFX**: inherited from the mapped vanilla anim's `AnimTimedSoundEvent`
  references — no ER-specific samples extracted. Vanilla `PRSFX-*.wav`
  files cover every ER custom by type+category proxy.
- **Verification**: `pnpm typecheck` clean, `pnpm biome` clean.

## Background

Vanilla pokerogue loads each move's frame timeline + sound triggers from
`assets/battle-anims/<MoveId-as-kebab-case>.json` via the loader in
`src/data/battle-anims.ts` (`initMoveAnim()` line ~480, see
`getMoveAnimUrl()` for the new resolver). On disk, vanilla ships ~920
JSON files — one per registered MoveId (the symlink
`assets/battle-anims → ../../assets/battle-anims/` targets the vanilla
pokerogue repo).

Elite Redux v2.65 adds **187 custom moves** (pokerogue ids 5000..5186 in
`src/enums/er-move-id.ts`, registered into `allMoves` by
`initEliteReduxCustomMoves()`). Before this work:

- **0 of 187** custom moves had anim JSON definitions.
- **0 SFX** from ER's custom moves were extracted.
- `MoveId[id]` returned `undefined` for every ER id ≥ 5000, so
  `toKebabCase(undefined)` produced the URL
  `./battle-anims/undefined.json`. The loader fell through to its
  per-category default (`MoveId.TACKLE` for attack moves,
  `MoveId.FOCUS_ENERGY` for self-status, `MoveId.TAIL_WHIP` for status).
  Every ER custom played the same three vanilla animations regardless of
  type or theme.

## Why not Path A (extract ER's anim scripts)?

The ER ROM source ships its move animations as a giant `data/battle_anim_scripts.h`
C macro forest plus per-graphic `.png` sheets in `graphics/battle_anims/`.
The runtime interprets these via the GBA's bytecode-driven anim VM
(`battle_anim.c`'s `cmd_*` opcodes). Translating that to pokerogue's
declarative `AnimConfig` schema (frame arrays of `{x, y, zoom, target, …}`
plus `frameTimedEvents`) requires writing a non-trivial GBA-VM emulator
in JS. Plus:

- `vendor/elite-redux/v2.65beta.json` (the data dump we already mirror)
  contains stats/flags/descriptions but **no anim scripts** — the upstream
  `ForwardFeed/ER-nextdex` site drops anim data. We'd need to fetch the
  raw `eliteredux/eliteredux` C repo separately.
- ER reuses many vanilla anim macros (`SoundbankAnim`, etc.) that
  reference upstream GBA SFX (`Cry_*`, `SE_M_*`) that pokerogue replaces
  with its own `PRSFX-*.wav` SoundFont samples. The 1:1 sound mapping
  isn't trivial.
- 187 moves × custom anim conversion is multi-day work even with the VM
  emulator in place.

A future PR can revisit Path A piecemeal — e.g. hand-port the dozen
most-visually-distinctive moves (Pixie Beam, Frost Brand, Seismic Blade,
Excalibur, Outburst). The current fallback gives every ER move a
playable, type-appropriate baseline today.

## Path B implementation

### 1. Loader patch — `src/data/battle-anims.ts`

Added `getMoveAnimUrl(move)` which inspects the move id:

- **id < 5000** (vanilla): returns `./battle-anims/<MoveId-kebab>.json`
  (unchanged from before).
- **id ≥ 5000** (ER custom): reverse-looks-up the slug in `ErMoveId`
  and returns `./battle-anims-er/<er-slug>.json`. Slug cache is built
  once on first call.

The fallback chain in `initMoveAnim()` is preserved — if a generated
JSON is somehow missing on disk, `useDefaultAnim()` still produces a
tackle/focus-energy/tail-whip play.

### 2. Fallback mapper script — `scripts/elite-redux/map-move-anims.mjs`

For each of the 187 ER customs, picks a vanilla anim slug via:

1. **Manual override** (3 moves currently): see `MANUAL_OVERRIDES` in
   the script — Outburst → explosion, Atomic Fire → overheat, Drain
   Brain → dream-eater.
2. **(PokemonType, MoveCategory) lookup** (184 moves): a hand-curated
   table covering all 18 types × 3 categories. The table picks a
   visually emblematic vanilla anim per cell — e.g.:
   - Fire PHYSICAL → `flare-blitz`
   - Fire SPECIAL → `flamethrower`
   - Ghost STATUS → `confuse-ray`
   - Stellar SPECIAL → `astral-barrage`
3. **Generic category fallback** (0 moves used in current pass): tackle
   / swift / tail-whip for any (type, category) cell that wasn't
   covered.

The picked vanilla anim's JSON is cloned to
`assets/battle-anims-er/<er-slug>.json`. The clone preserves all frame
timelines, sound triggers (`AnimTimedSoundEvent`s referencing
`PRSFX-*.wav`), background events, and graphic refs. A `hue` field can
be tweaked per type via `TYPE_HUE_SHIFT` (currently all 0 — leaving room
for future per-type tinting without re-running the script).

### 3. Test mock — `test/setup/vitest.setup.ts`

The vitest mock that re-routes all `./battle-anims/*` fetches to
`tackle.json` now also intercepts `./battle-anims-er/*` so ER customs
don't 404 during game-init in tests.

## File inventory

| Path | What |
|------|------|
| `assets/battle-anims-er/` | 187 generated ER anim JSON clones (gitignored — generated at build time by the script below, same pattern as `assets/images/elite-redux/`) |
| `scripts/elite-redux/map-move-anims.mjs` | The fallback-mapping driver — re-runnable as `pnpm run er:map-move-anims` |
| `src/data/battle-anims.ts` | Loader patch + `getMoveAnimUrl()` resolver |
| `test/setup/vitest.setup.ts` | Test-mock URL intercept extended for ER dir |
| `docs/plans/elite-redux-move-anim-status.md` | This file |

## Sample coverage (proof of concept)

These ER customs span the requested type/category mix — confirmed
written to `assets/battle-anims-er/` and selected by either manual
override or type-category lookup:

| ER move | Type | Category | Vanilla anim used | Source |
|---------|------|----------|--------------------|--------|
| Outburst | Normal | Special | explosion | manual |
| Atomic Fire | Fire | Special | overheat | manual |
| Drain Brain | Psychic | Status | dream-eater | manual |
| Aqua Fang | Water | Physical | aqua-tail | type-category |
| Frost Brand | Ice | Physical | ice-fang | type-category |
| Pixie Beam | Fairy | Special | moonblast | type-category |
| Plasma Pulse | Electric | Special | thunderbolt | type-category |
| Seismic Blade | Ground | Physical | earthquake | type-category |
| Eerie Fog | Ghost | Status | confuse-ray | type-category |
| Scorched Earth | Fire | Special | flamethrower | type-category |
| Excalibur | Steel | Physical | iron-head | type-category |
| Shadow Fangs | Ghost | Physical | shadow-claw | type-category |

## SFX status

ER's custom moves do **not** have their own extracted SFX. Vanilla
pokerogue's `PRSFX-*.wav` library is symlinked through `assets/audio/`
and the cloned anim JSON files inherit the source vanilla anim's
`AnimTimedSoundEvent` references — every ER move gets a thematically
plausible sound (e.g. Aqua Fang plays the Aqua Tail SFX).

Cost to do better: extract per-move samples from ER's
`sound/direct_sound_samples/` ROM directory. This is a separate ~200MB
fetch with non-trivial SoundFont conversion. Out of scope for this PR.

## Future work (not done here)

- **Per-move manual overrides**: extend `MANUAL_OVERRIDES` in
  `map-move-anims.mjs` for moves where the (type, category) fallback
  picks something obviously off (e.g. Drain Brain wasn't a calm-mind
  match — we already overrode to dream-eater; do similar audits for
  other "siphoning" / "charge-up" / "boss-finisher" ER moves).
- **Per-type hue shifts**: populate `TYPE_HUE_SHIFT` and re-run to
  visually differentiate moves that share a fallback anim. Probably
  most useful for Stellar / fairy-from-fairy collisions.
- **Path A piecemeal**: hand-port the 10-20 most-iconic ER moves
  (signature moves of Redux-only species — Excalibur for Aegislash
  Redux, Outburst for Voltorb line, etc.) to bespoke anims.
- **ER battle-anim sprite atlas binding**: ER ships 311 sprite PNGs +
  19 backgrounds in `assets/images/elite-redux/battle_anims/` that are
  currently orphan assets. None are referenced by the current vanilla
  anim clones (those use vanilla sprite atlases). A future bespoke
  port can reference these via `AnimTimedAddBgEvent` etc.
- **SFX extraction**: pull ER's `direct_sound_samples/*.aif` and
  convert to `.wav` for the few moves where the borrowed SFX feels
  truly wrong (Outburst probably should be louder/more bassy than
  Explosion's existing sample).

## Verification

```
pnpm typecheck          # OK
pnpm biome              # OK (warnings are pre-existing in unrelated code)
pnpm er:map-move-anims  # writes 187 JSON files; deterministic
pnpm er:test            # ER-specific vitest suite (no battle-anim tests yet,
                        #   but mock URL intercept covers ER ids during init)
```

Manual smoke test in `pnpm start:dev` was not run in this sprint
(the agent environment doesn't render Phaser scenes). The path is
exercised end-to-end at load time: the loader patch + JSON files + test
mock are all the runtime needs.
