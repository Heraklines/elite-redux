# Elite Redux — Pokédex & Usage

A public, read-only static dashboard that shows, for every starter-selectable
species, its competitive **tier badge** plus **run statistics** (win / pick /
usage / lift / average wave) and **build insights** (top abilities, moves, held
items, common teammates) — so players can quickly size up a pick and build a
team.

It is a plain static SPA (vanilla JS + CSS, no framework, no build step), a
sibling of `editor/`, **live on Cloudflare Pages at https://er-stats.pages.dev**
(project `er-stats`, production branch `main`). See "Deploy" below.

```
stats/
├── index.html              # markup: sticky bar / filters / table / detail page / login modal shells
├── styles.css              # the dark dashboard theme
├── app.js                  # all behaviour (grid + per-Pokemon detail page + login)
├── gen-real-stats.mjs      # builds data/species-stats.json from a prod runs dump
├── gen-sample-stats.mjs    # builds the deterministic SAMPLE fallback (data/stats.sample.json)
├── gen-dex-detail.mjs      # builds data/dex-detail.json from editor/data (READ-ONLY)
├── data/
│   ├── dex.json            # generated dex (types / base stats / abilities / egg tier / cost)
│   ├── species-stats.json  # REAL run-derived metrics (what the page ships)
│   ├── dex-detail.json     # learnsets / TMs / abilities+text / evolutions (from the editor)
│   ├── species-extra.json  # types + base stats for EVERY species incl. evolved forms (one-time game dump)
│   └── stats.sample.json   # deterministic sample fallback (no longer the default)
└── README.md
```

## 🔴 External tool only: never touches the game or the editor

This site is a standalone external tool. It **does not read or write the game
source (`src/`, `test/`) and never modifies the editor or `editor/data/`.** The
team's editor is the single source of truth for learnsets, TMs, abilities, etc.;
this tool only *consumes* the editor's exported JSON read-only (see the detail
page below). All generated output lands under `stats/` only.

## Per-Pokemon detail: quick drawer + full deck page

Clicking a row opens a **quick side drawer** (`#<slug>`): base stats + percentile
hints, run performance, common teammates, the abilities (with full ER text), and
a **"View full details"** button. The button (or `#mon/<slug>`) opens the full
**deck page**: a single scrolling, multi-column layout with NO tabs, so every
section is visible at once: base stats, type matchups (weak / resist / immune +
attacking move types), run performance, **abilities** (each with its ER
description), **moves** (level-up and TM/tutor in two side-by-side tables with a
live filter and STAB highlighting), **evolution** (clickable line), and **forms**
(alternate dex forms). Evolution-only relatives (e.g. Cradily, Charizard) are
reachable and show base stats, type matchups (with STAB), abilities, moves and
evolution too; only run performance is absent for them (only starter-selectable
species are tracked).

Evolved forms aren't in `dex.json` (the starter grid), and the editor exports no
types, so their base stats + types come from `data/species-extra.json` — a static
file dumped READ-ONLY from the live runtime species table (the same mechanism that
produced `dex.json`) by `test/tests/elite-redux/tools/dump-stats-species-extra.test.ts`:

```bash
ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-stats-species-extra.test.ts
```

Re-run that only when the game's species types / base stats change. It is loaded
in parallel with `dex-detail.json` on first detail open and is best-effort (the
page still works without it, just without matchups/stats for evolved forms).

Moves and abilities cross-link: click a move for `#move/<id>` (every starter that
learns it, and how) or an ability for `#ability/<id>` (every starter with it).
The header **Moves** / **Abilities** links open browsable indexes (`#moves`,
`#abilities`).

The data comes from `data/dex-detail.json`, built by `gen-dex-detail.mjs` from
the editor's exports (`editor/data/{learnsets,tm-learnsets,species-abilities,
abilities-rich,moves-rich,evolutions,all-species}.json`) READ-ONLY. It is
lazy-loaded on first detail open, so the grid stays fast. **Not included** (the
editor does not export them): move descriptions and egg moves.

Regenerate after the team edits in the editor:

```bash
node stats/gen-dex-detail.mjs   # reads editor/data, writes stats/data/dex-detail.json
```

## The stats are REAL run data

`data/species-stats.json` is computed from **real finished runs** in the prod
`er-saves` `runs` table. `app.js` loads it via `STATS_URL = "./data/species-stats.json"`;
it sets `"_sample": false`, so the page shows a green **"Live run data"** pill (no
sample warning). Win / pick / usage / lift / average wave / common teammates all
come from those runs. Average wave excludes endless runs (wave > 200) so a single
wave-9999 run can't skew it.

**Tiers come from the live game feed:** the page fetches the same nightly
`usage-tiers.json` from er-assets the game reads and computes each tier exactly as
the game/editor does (`tier = min(usageBand(usagePct), eggBand(eggTier))`, egg
tier acting as a floor). So the tier badges match what is live in-game. If that
fetch fails it falls back to the tier baked into `species-stats.json`.

## Optional login (filter to owned species)

A **Log in** button lets a player log in with their Elite Redux account to filter
the dex to the Pokémon they own. It is entirely client-side and quota-free for us:
the login + save fetch go to the game's own save API
(`https://er-save-api.heraklines.workers.dev`: `POST /account/login` → token, then
`GET /savedata/system/get` with `Authorization: Bearer <token>`). The system save
is plain JSON (the client uploads it unencrypted; we also AES-decrypt as a fallback
with the in-game `saveKey`). We read `dexData` entries with a non-zero `caughtAttr`
into the owned-id set, keyed by species id (matches `dex.json` `id`). Only that
id list + the username are kept in `localStorage` (key `erStatsOwnedV1`) — never
the password or token. Redux-form rows (id > 10000) are best-effort. crypto-js is
loaded from jsDelivr (not Cloudflare).

## Deploy

`wrangler pages deploy` does **not** honour `.assetsignore`, so deploy from a clean
dir (`_stats_deploy/`, gitignored) that contains only publishable files — never the
raw `data/_runs.json` prod dump (it has `user_id`s). The dir ships a 20-byte
placeholder `data/_runs.json` (`{"note":"not public"}`) plus a `_headers` file that
sets `/data/*` to `max-age=0, must-revalidate` so a stale dump can't linger in the
edge cache.

```bash
cd stats
rm -rf _stats_deploy && mkdir -p _stats_deploy/data
cp index.html app.js styles.css _stats_deploy/
cp data/dex.json data/species-stats.json data/dex-detail.json data/species-extra.json _stats_deploy/data/
printf '%s' '{"note":"not public"}' > _stats_deploy/data/_runs.json
printf '%s\n' '/data/*' '  Cache-Control: public, max-age=0, must-revalidate' > _stats_deploy/_headers

# creds from C:\Users\Hafida\Desktop\cloudflare tokens.txt (token + account id) — never print them
export CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=…
npx wrangler pages deploy _stats_deploy --project-name=er-stats --branch=main --commit-dirty=true
```

`--branch=main` targets the production alias (er-stats.pages.dev). After deploying,
verify `https://er-stats.pages.dev/data/_runs.json` returns the placeholder, not a
real dump.

### Expected metrics shape (per species, keyed by sprite slug)

#### Expected shape (per species, keyed by sprite slug)

```jsonc
{
  "tier": "RU",                     // OU | UU | RU | PU | NU (overridden by the real usage feed when present)
  "usagePct": 0.82,                 // % of distinct players who picked the line
  "pickPct": 2.23,                  // % of teams that drafted it when offered
  "winPct": { "all": 42.6, "ace": 48.1, "elite": 43.4, "hell": 30.7 },
  "lift": -14.5,                    // performance vs stratum baseline (pp), -15..+20
  "avgWave": 42,                    // average wave reached with this mon on the team
  "sample": 841,                    // player-picks behind the numbers
  "topAbilities": [{ "name": "Trace", "pct": 34.1 }],   // x3, from the mon's own abilities
  "topMoves":     [{ "name": "Roost", "pct": 21.3 }],   // x4
  "topItems":     [{ "name": "Leftovers", "pct": 46 }], // x3
  "topTeammates": [{ "slug": "rayquaza", "name": "Rayquaza", "pct": 29.1 }] // x5
}
```

## Data sources

| File | Source | How it's produced |
|---|---|---|
| `data/dex.json` | the **live game tables** after the full `initializeGame()` chain | `test/tests/elite-redux/tools/dump-stats-dex.test.ts` |
| `data/stats.sample.json` | `data/dex.json` | `stats/gen-sample-stats.mjs` (deterministic) |
| Sprites | `Heraklines/er-assets` via jsDelivr | `…/images/pokemon/elite-redux/<slug>/front.png` (`image-rendering: pixelated`, lazy-loaded, hidden on 404) |
| Real tiers/usage | `Heraklines/er-assets` via jsDelivr | `usage-tiers.json` — the same nightly feed the game reads (see `src/data/elite-redux/er-usage-tiers.ts`) |

`dex.json` is the richer superset of `editor/data/species.json`: same
starter-selectable roster (vanilla starters + the ER customs the init chain
leaves in the grid, minus evolved/battle-only/banned forms), plus types, base
stats (`[hp, atk, def, spatk, spdef, spd]`), BST, ability display names, egg tier
and starter cost — all read straight from the runtime `getPokemonSpecies(id)`.

> Note: this is **Elite Redux 2.65** data, so values can differ from vanilla
> (e.g. ER-rebalanced types, base stats, and ER-custom abilities/innates).

## Regenerating the data

```bash
# 1) dex.json — dumped from the LIVE runtime tables after the full init chain
#    (~40s; vitest strips types, so the repo's pre-existing tsc errors don't block it):
ER_SCENARIO=1 npx vitest run test/tests/elite-redux/tools/dump-stats-dex.test.ts

# 2) stats.sample.json — regenerate the deterministic SAMPLE metrics from dex.json:
node stats/gen-sample-stats.mjs
```

Re-run #1 when the species roster / stats / abilities change materially, then #2
to refresh the sample placeholders. (Once the real feed is wired up, #2 is no
longer needed.)

## Run it locally

```bash
python -m http.server 8137 --directory stats
# then open http://localhost:8137/
```

## The page

- **Sticky top bar:** title, live (debounced) name search, type / tier / egg-tier
  filters, and a difficulty segmented toggle (All / Ace / Elite / Hell) that
  switches the win-rate column and the drawer. Quick type + tier chip rows below.
- **Dense sortable table** (desktop): sprite · name + type chips · tier badge ·
  usage% · pick% · win% · lift · avg wave · BST. Click any header to sort
  (▲/▼); numeric cells show the value plus a thin inline bar (win% red→amber→green,
  usage/pick a neutral/accent bar); lift is green/red. Rows highlight on hover.
- On screens **< 820px** the table is replaced by cards.
- **Detail drawer** (click a row): large sprite, name, dex #, egg tier + cost,
  type chips, tier badge, the 6 base-stat bars + BST, run-performance tiles
  (win / pick / lift + sample size), a by-difficulty win-rate mini bar chart,
  build-insight chips (abilities / moves / items), and a row of common-teammate
  sprite chips (click one to jump). Esc, the ×, or the scrim closes it.

## Screenshots

`_preview-grid.png` (the table) and `_preview-detail.png` (a drawer open) are
desktop captures (~1440px) produced by the Puppeteer script used during
development; regenerate them by serving the site and re-running that script.
