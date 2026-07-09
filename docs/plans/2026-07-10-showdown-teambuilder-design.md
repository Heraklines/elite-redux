# Showdown Teambuilder v2 — Design (validated 2026-07-10)

Replaces the current showdown team-select UX outright. Co-op / normal starter select
are untouched. Decisions below were locked with the maintainer in the 2026-07-10
workshop; do not relitigate them.

## Locked decisions

| Decision | Choice |
|---|---|
| Species entry | The existing collection GRID stays as-is. The transformation happens on CONFIRMING a mon: full-screen Set Editor takeover. |
| Fairness | FREE nature (picker in editor) + IVs forced to 31 for both players. Collection still gates species / stages / shinies / ability slots / egg moves (the stakes). No EV system (ER has none) — the stats surface is nature-only. |
| Presets v1 | Per-species saved sets (+ auto-remember last used), named TEAM presets, PS-format text import/export with ER extensions. All in v1. |
| Preset storage | localStorage only in v1. Import/export text covers cross-device. Server sync later (er-saves D1 near 500MB cap — do NOT add server storage now). |
| Rollout | Replace outright: the new editor IS showdown team select from its first staging deploy. |

## Screen architecture

### Layer 1 — persistent micro team strip (top)
Always visible in the editor: 6 slot icons (item mini-icon overlay, cost badge),
live validity chips (team size 1-6, mega count 0-1/1, cost caps: black shiny +
cost>=10 unfieldable, max one 8-9), the 10-min pick-window countdown, partner
ready status, and the WAGER PREVIEW (each mon's stake contribution; edits update
the preview before commit — a thing Pokemon Showdown structurally cannot have).
L/R (Q/E) cycles the editor between team mons directly.

### Layer 2 — species entry (unchanged)
The collection grid as today. Confirming a mon opens Layer 3.

### Layer 3 — the Set Editor (new UiMode + handler, full-screen)

LEFT COLUMN (~1/3), identity:
- Big ANIMATED sprite following stage/shiny/variant selection live.
- STAGE STRIP: the whole evolution line as icons (base -> mid -> final ->
  mega/regional variants). Cursor switches the fielded stage; sprite, icon,
  abilities, movepool ALL follow ("everything follows the stage" — the already-
  shipped rule, now visualized). The mega stage shows the team mega budget
  (greyed + reason when the team's 1 mega is already spent elsewhere).
- SHINY/VARIANT chips: only owned tiers selectable; black shiny visible but
  marked unfieldable (stake-only) with the reason.
- LIVE STAT BARS with nature +/- coloring: changing/hovering a nature recolors
  bars and updates numbers in real time. Level 100 fixed. IVs shown as 31 flat.
- Cost badge + stake tier chip.

RIGHT COLUMN (~2/3), the set — focusable rows, each showing current value AND a
one-line description inline:
1. ABILITY: current ability + effect line. Expanded pane lists the 3 actives
   (locked slots GRAYED WITH THE UNLOCK REASON, never hidden) and, below, the 3
   INNATES with full descriptions (informational — always active, not picked).
   Innate visibility at pick time is the flagship ER-specific feature.
2. ITEM: icon + name + effect line. Pane = searchable item list (typeahead),
   full showdown item pool. Mega stage picked => mega stone AUTO-FORCED into the
   slot, row locked with explanation.
3. MOVES x4: rows show name, type icon, category icon, BP/Acc. Pane = move
   table: Name | Type | Cat | BP | Acc | PP | effect snippet. Typeahead filters
   live. Legality tags per row (Level/TM/Tutor free; EGG moves gated by unlocks
   — grayed with reason). Sort: alphabetical v1; telemetry-driven viable-first
   is Phase 3.
4. NATURE: name + (+stat/-stat) summary. Pane = nature list/grid with live
   stat-bar preview on hover/highlight. Free pick (fairness decision).

BOTTOM — the SHARED SEARCH PANE. One pane; the focused field determines its
contents. This is the core Showdown pattern being adopted and it is also the
input-model answer (below). A footer line shows the full description of the
highlighted entry.

Buttons: Save set (named), Load set (this species' saved sets), Export set
(clipboard), Import set (paste), Done (back to grid/team view).

## Input model (one focus graph, three input worlds)

- Everything is a focus target: grid -> editor field rows -> pane rows.
- KEYBOARD: type-anywhere filters the open pane (fuzzy prefix match); arrows
  move focus; Enter selects; Esc backs out.
- CONTROLLER: d-pad moves field focus; A expands/selects; B backs; shoulders
  page the pane + alpha fast-jump; L/R cycles team mons; Start = Done.
- MOBILE: tapping a searchable field focuses it AND raises the NATIVE keyboard
  through a hidden DOM input (same infra as the login/nickname inputs). No
  custom on-screen keyboard is built. All rows are tap targets.

## Presets + import/export (v1)

- Canonical set format = PS-compatible text + ER extension tags:

```
Garchomp @ Life Orb  [Stage: Mega] [Shiny: 1]
Ability: Sand Veil
Nature: Jolly
- Earthquake
- Outrage
- Swords Dance
- Stone Edge
```

  Parser is TOLERANT (unknown lines ignored, PS fields we lack — EVs, level,
  happiness — skipped silently). Export always writes the ER tags.
- Team preset = named list of sets. Import of a full team = paste the multi-set
  text (blank-line separated, PS convention).
- Import VALIDATES against the local collection + showdown rules and reports
  PRECISE per-mon errors ("Shiny tier 2 Garchomp not owned", "second mega —
  team already has one", "egg move X locked"). Player chooses: fix-up (invalid
  parts dropped/downgraded, listed) or cancel.
- Auto-remember: confirming a mon stores its set as the species' last-used;
  next pick pre-fills instantly.
- Storage: localStorage keys `er:showdown:sets:<speciesId>` (array of named
  sets + lastUsed) and `er:showdown:teams` (named team presets). Versioned
  envelope for future migration.

## Data-model / engine changes (the sharp edges)

- `ShowdownMonManifest` gains `nature` (and optionally `setName` for telemetry).
  RULE (learned the hard way — the erShinyLab:undefined anti-tamper void): new
  OPTIONAL manifest fields must be OMITTED when absent, never carried as
  undefined; the transport-canonical team hash JSON-round-trips, and both
  clients must hash identical wire shapes. Add the field to the canonicalizer
  test.
- Battle build: BOTH engines (host initBattle + guest via swapped session)
  apply manifest nature and FORCE IVs to [31 x6] deterministically. The duo
  harness must assert nature/IV parity in the turn-1 checksum.
- Server/escrow: untouched (manifest hash covers nature automatically once in
  the manifest).
- Legality: nature is NOT validated against collection (free); IVs ignored on
  the wire (forced at build).

## What we adopt / adapt / beat from Pokemon Showdown

- Adopt: shared search pane per focused field; metadata-rich typeahead rows;
  text import/export as the preset backbone; named teams; live format
  validation with per-error naming.
- Adapt: stage/form strip as a first-class identity control; innates panel;
  locked-but-visible collection gating with reasons; wager preview in the
  validity strip.
- Skip: EV sliders/spread tools (no EV system), tier filters (no tiers).
- Phase 3 (later, telemetry-driven — we record every fight): viable-first move
  sorting, "popular sets" per species, usage stats columns. Folders for teams,
  search operators ("type:fire", "bp>90").

## Phasing

- P1 — Editor core, replacing the current flow: new UiMode + handler, layout
  (team strip / identity column / field rows / shared pane), stage strip,
  ability+innates pane, item pane, move typeahead pane, nature pane, validity
  strip + wager preview, Done wiring into the existing negotiate/wager flow.
  Manifest nature + IV forcing + hash/duo coverage land here (engine change is
  small and gates the editor's nature row being real).
- P2 — Presets: per-species sets, team presets, import/export + validation UX.
- P3 — Polish: telemetry-driven sorting/suggestions, folders, operators,
  animations.

## Testing (standing rules apply)

- New screen => render-harness RECIPES for every editor state: editor-overview,
  editor-move-pane (typeahead mid-filter), editor-ability-pane (locked slot +
  innates), editor-nature-pane, editor-import-error. Golden baselines committed.
- Duo harness: manifest nature/IV parity turn-1 (checksum), import/export
  round-trip unit tests, hash canonicalization with the new field present and
  absent.
- In-game dev test-suite `(note)` entries for the two-client flows; solo-
  expressible pieces (editor rendering) get scenarios where drivable.
- Gates: tsc 301, showdown suite green, coop dir unchanged, biome.
