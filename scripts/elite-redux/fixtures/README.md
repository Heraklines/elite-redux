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
- To distinguish vanilla vs. ER-custom, **compute the boundary at build time**
  by name-matching the v2.65 ability names against pokerogue's enum
  (`src/enums/ability-id.ts`). DO NOT assume an id range — the boundary is not
  contiguous: ids in the 220-268 range mix vanilla rebalances, naming variants
  ("Electric Surge" vs. "Electro Surge"), and a handful of genuine ER customs.
  Empirically, id 268 (`Chloroplast` in ER, would be `LINGERING_AROMA` if
  naively id-aligned) is the first id where the ER and pokerogue enums diverge
  in concept (not just spelling). Beyond id 268, the abilities are largely ER
  originals with no pokerogue counterpart.

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
