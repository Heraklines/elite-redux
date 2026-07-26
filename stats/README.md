# Pokerogue Redux Pokedex and Statistics

`https://er-stats.pages.dev/` is a read-only static site backed by generated game catalogs and anonymized telemetry aggregates.

## Sources

| Output | Source |
|---|---|
| `data/dex.json` | Starter-selectable lines from the fully initialized game runtime |
| `data/dex-detail.json` | Every runtime species, form, move, ability, innate, type, learnset, TM and egg move |
| `data/species-extra.json` | Runtime species and form display data |
| `data/species-stats.json` | Rolling 30-day production run and Showdown aggregates |

The runtime catalog is exported by:

```bash
ER_SCENARIO=1 pnpm exec vitest run test/tests/elite-redux/tools/dump-stats-dex.test.ts
```

That export runs after the complete Elite Redux initialization chain. It therefore includes injected forms and abilities without requiring a second hand-maintained list.

## Telemetry privacy

`stats/dump-cloudflare-data.mjs` reads only the fields needed for aggregate statistics. Real account IDs are replaced in memory with temporary anonymous keys before the local dump is written. Usernames are never queried.

The public payload contains no account identifiers, raw teams, individual matches, or individual run histories. Build and item breakdowns require at least five observations. Every evolved Pokemon and form is projected back to its starter-selectable line before usage and performance are calculated.

The temporary files below are gitignored and must never be deployed:

- `data/_runs.json`
- `data/_showdown.json`

The clean deploy directory contains a `{"note":"not public"}` placeholder at both paths. `validate-stats-data.mjs` rejects a deploy directory that does not contain those placeholders.

## Refresh and deploy

`.github/workflows/stats-nightly.yml` runs daily at 04:30 UTC. The workflow is installed on the repository's default branch so GitHub schedules it, then explicitly checks out the latest `feat/elite-redux-port` source before generating data.

Each refresh:

1. Initializes the current game and regenerates all catalogs.
2. Reads the rolling 30-day production run and Showdown telemetry windows.
3. Generates starter-line aggregates and usage tiers.
4. Validates freshness, source revision, catalog completeness, minimum samples, and forbidden public fields.
5. Builds a clean directory and deploys only the public files to the `er-stats` Pages project.

Manual local generation requires `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` in the environment:

```bash
export STATS_SOURCE_SHA=$(git rev-parse HEAD)
ER_SCENARIO=1 pnpm exec vitest run test/tests/elite-redux/tools/dump-stats-dex.test.ts
node stats/dump-cloudflare-data.mjs
node stats/gen-real-stats.mjs
node stats/gen-usage-tiers.mjs stats/data/usage-tiers.json
node stats/apply-m5cap-tiers.mjs
node stats/validate-stats-data.mjs
```

## Public statistics

Run aggregates include pick rate, distinct-player usage, wins, difficulty slices, average wave, final moves, selected active abilities, final forms, relics, teammates, modes, challenges, and ghost battle threats.

Showdown aggregates include appearances, wins, items, forms, match outcomes, average turn count, and average duration. Run and Showdown values remain separately labeled and are never combined into one win rate.

The site displays the generation date. Data older than 48 hours is visibly marked as old, and automation rejects output older than 12 hours during deployment.
