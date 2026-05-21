# Elite Redux — Phase C Coverage Snapshot

> Auto-generated. Regenerate: `pnpm run er:audit-archetype-coverage`.
>
> Last regenerated: 2026-05-21T14:24:30.783Z.

Snapshot of Phase C structural work. Captures the per-bucket distribution of
ER abilities + moves across:

- **Vanilla** — direct pokerogue equivalents, wired via the ER → pokerogue id
  map (`ER_ID_MAP`).
- **Archetype-classified** — ER-custom entries that the C2/C3 classifier slotted
  into a Phase C archetype primitive. Wire-up reads the per-row `params`
  object and constructs the matching AbAttr / MoveAttr.
- **Bespoke long-tail** — ER-custom entries the classifier couldn't generalize.
  Needs hand-written implementations in the Phase D wire-up layer. See
  `elite-redux-bespoke-inventory.md` for the canonical list.

Coverage is **% wired** — `(vanilla + archetype-classified) / total`. The
bespoke fraction is the remaining hand-write backlog Phase D has to clear.

## Abilities

- Total ER abilities: **1034**
- Vanilla (pokerogue equivalent): **298**
- Archetype-classified: **478** (across 22 archetype kinds — breakdown below)
- Bespoke long-tail: **258** (needs hand implementation)
- **Coverage: 75.0% wired**

### Ability archetype breakdown

| Archetype | Count |
|---|---|
| `composite-vanilla-mashup` | 196 |
| `entry-effect` | 76 |
| `chance-status-on-hit` | 29 |
| `type-damage-boost` | 25 |
| `damage-reduction-generic` | 18 |
| `type-conversion` | 18 |
| `priority-modifier` | 16 |
| `accuracy-mod` | 13 |
| `proc-followup-attack` | 13 |
| `stat-trigger-on-event` | 11 |
| `conditional-damage` | 8 |
| `flag-damage-boost` | 8 |
| `multi-hit-override` | 8 |
| `lifesteal` | 7 |
| `type-resist-or-absorb` | 7 |
| `weather-or-terrain-interaction` | 6 |
| `crit-mod` | 5 |
| `on-hit-counter-attack` | 4 |
| `status-immunity` | 4 |
| `move-replacement` | 3 |
| `form-change` | 2 |
| `passive-recovery` | 1 |

## Moves

- Total ER moves: **1032**
- Vanilla (pokerogue equivalent): **845**
- Archetype-classified: **130** (across 5 archetype kinds — breakdown below)
- Bespoke long-tail: **57** (needs hand implementation)
- **Coverage: 94.5% wired**

### Move archetype breakdown

| Archetype | Count |
|---|---|
| `flag-tagged-move` | 100 |
| `chance-status-on-hit` | 20 |
| `recoil-or-drain` | 7 |
| `type-conversion` | 2 |
| `conditional-damage` | 1 |

## Methodology

- "Total" counts include the ER `0 / NONE` sentinel slots and any unfilled ER
  ids; this matches what `ER_ABILITIES`/`ER_MOVES` export.
- "Vanilla" is the count of `archetype: "vanilla"` rows from the raw drafts
  (`er-abilities.ts` / `er-moves.ts`) — pokerogue-equivalent entries the
  fixture builder identified directly.
- "Archetype-classified" is the count of non-`bespoke` rows in the C2/C3
  classifier output (`er-ability-archetypes.ts` / `er-move-archetypes.ts`).
- "Bespoke" is the count of `archetype: "bespoke"` rows in the same files.

## Next steps

- Phase D will wire archetype-classified rows into runtime by constructing
  the per-row AbAttr / MoveAttr from `params`.
- The bespoke long-tail will be hand-written in Phase D, sequenced by
  taxonomy-hint clusters (see `elite-redux-bespoke-inventory.md`).
- The C0 battle harness's full golden-replay validation suite is deferred to
  Phase D — it requires the wire-up to be plugged into runtime battle flow.
