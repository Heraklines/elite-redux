# ER v2.65 Sample Fixtures

These small fixtures are carved from `vendor/elite-redux/v2.65beta.json` by
`scripts/elite-redux/extract-fixtures.mjs` (run via `pnpm run er:fixtures`).
They feed the per-transformer tests for Tasks A5-A9.

## Schema findings vs. the Phase A plan

The plan was authored from PokeRogue-side assumptions and contained several
inaccurate guesses. The fixtures exposed the real shape:

### Species (`sample-species.json`)
- Top-level keys: `name, NAME, stats, evolutions, eggMoves, levelUpMoves, TMHMMoves, tutor, forms, SEnc, dex, id` (12 fields)
- **`abis` and `inns` live inside `stats`, NOT at top-level.**
- **`abis` and `inns` are arrays of NUMERIC ability IDs** (e.g. `[268, 257, 34]`),
  NOT strings like `"ABILITY_OVERGROW"`. Transformers must resolve IDs → names
  via a lookup table (e.g., index into `dump.abilities[]`).
- Top-level evolution key is `evolutions` (not `evos`).
- `evolutions[].rs` is a STRING (e.g. `"16"`), not a number — parse with `Number(rs)`
  for level-up evolutions.
- `stats.types` is an array of numeric type IDs.
- `forms[]` is non-empty for ~41 species.

### Abilities (`sample-ability.json`)
- **Only `name`, `desc`, `id` — NO `NAME` field.** Cannot filter by NAME-prefix.
- To distinguish vanilla vs. ER-custom, cross-reference pokerogue's
  `src/enums/ability-id.ts` enum (vanilla IDs are 1-298 in pokerogue; ER customs
  in the v2.65 dump start at id ≈ 299 onwards but the boundary should be
  computed at build time, not assumed).

### Moves (`sample-move.json`)
- 18 top-level keys including `name`, `NAME`, `eff`, `pwr`, `acc`, `pp`,
  `chance`, `target`, `prio`, `split`, `types[]`, `flags[]`, `arg`, `desc`,
  `lDesc`, `id`, `usesHpType`, `sName`.
- `types` and `flags` are ALWAYS arrays (possibly empty), even for single-type moves.
- Move `flags[]` is an array of numeric flag IDs, not strings.

### Trainers (`sample-trainer.json` and `sample-trainer-tiered.json`)
- 8 top-level keys: `name, tclass, db, party, insane, hell, rem, map`.
- Party member shape (8 fields): `spc, abi, ivs, evs, item, nature, moves, hpType`.
- All references (species, ability, item, moves) are by NUMERIC ID.
- `insane[]` and `hell[]` are higher-difficulty parties; may be empty.

## Fixture inventory

- `sample-species.json` — Bulbasaur (simple vanilla) + the first ER-custom (currently Crabruiser/SPECIES_CRABRUISER_REDUX)
- `sample-species-rich.json` — Venusaur (multi-evolution + multi-mega) + an ER mega-custom for richer coverage
- `sample-ability.json` — Overgrow (vanilla id 65) + Scrapyard (ER-custom id 400)
- `sample-move.json` — Tackle (vanilla id 33) + Eerie Fog (ER-custom id 950)
- `sample-trainer.json` — trainers[0]: 2-member party, empty insane/hell (smoke test)
- `sample-trainer-tiered.json` — the first trainer with all 3 tiers populated (full-coverage test)
