# Elite Redux porting — session status

## Coverage

| Layer | Status |
|---|---|
| Bespoke ability wires | **262 WIRED / 0 SKIP / 1 EMPTY** (Bad Company by design) |
| Vanilla ability rebalance | 69 of ~150 patches (most remaining match vanilla pokerogue) |
| Bespoke move wires | 57 / 57 (100%) |
| Vanilla move rebalance | 71 of 111 MAJOR+TOTAL patches |
| ER 4-ability UI | Working (starter / pokedex / summary) |
| ER customs in egg hatching | Wired (BST-based tier) |
| Dev cheat: 999 vouchers | Click any voucher icon on egg gacha |

## Test suite

| Suite | Result |
|---|---|
| ER data tests | **1047/1047 passing** |
| Bespoke battle smoke | 13/13 passing |
| Bespoke scenario suite | **13/13 passing** (ER_SCENARIO=1) |
| FULL-262 battle capture | 261 OK / 1 NO-OB / 1 INIT-FAIL / **0 CRASHED** |

## Audit fix rounds (R48–R54)

50+ ability bugs fixed across audit rounds. Major categories:
- 14 CRITICAL mis-wires (ID drift in dump array index, R49)
- 11 direction-reversed (defense → offense, R50)
- Defense-stat swap primitive (Power Fists / Soul Crusher / Power Edge, R51)
- True per-hit dodge primitive (Olé, R51)
- contactExcluded gate auto-disables contactRequired default (Flame Body class bugfix, R52)
- Fog wires (Fog Machine / Foggy Eye / Madness Enhancement, R53)
- Engine hooks: OnOpponentSwitchOut / RecoilDamageMultiplier / PersistentFieldAura
- Zero SKIPs remaining (R54)

## ROM decomp

- **ROM**: `vendor/elite-redux/rom-extracted/er-v2.65.3b.gba` (32 MB, gitignored)
- **Ghidra 11.0.3** installed at `vendor/elite-redux/tools/ghidra_11.0.3_PUBLIC/` (gitignored)
- Headless analyze running in background (auto-analysis takes ~45-60 min on 32MB ROM)
- ASCII + Pokémon-text strings extracted: 1026/1030 abilities + 1029/1032 moves found in ROM — JSON dump essentially complete for v2.65.3b
- After Ghidra completes, will dump per-ability code refs + function table via `scripts/elite-redux/ghidra-dump-strings.py` post-script

## Tools

| Script | Purpose |
|---|---|
| `scripts/elite-redux/inspect-ability.mjs` | Quick spec + wire-status for a single ability |
| `scripts/elite-redux/extract-ability-source.mjs` | Grep ER C decomp by ability name |
| `scripts/elite-redux/decomp-rom.py` | ROM string + header extraction |
| `scripts/elite-redux/diff-rom-vs-dump.py` | Compare ROM strings vs JSON dump |
| `scripts/elite-redux/extract-rom-tiles.py` | Dump 4bpp tile atlases from ROM regions |
| `scripts/elite-redux/battle-capture-all.mjs` | Run FULL-262 battle capture (CSV report) |
| `scripts/elite-redux/analyze-battle-capture.mjs` | Bucket-analyze battle capture CSV |
| `scripts/elite-redux/ghidra-dump-strings.py` | Ghidra post-script for string + function dump |
| `scripts/elite-redux/screenshot-er.mjs` | Headless puppeteer captures of ER UI |

## Browser dev server

- Vite at `http://localhost:5173/` (also reachable on LAN: `http://10.47.152.216:5173/`)
- HMR enabled — refresh to pick up changes
- ER customs hatch from eggs (Phantowl + Tauros Reduxes etc.)
- 4-ability layout visible in starter select (active + 3 passives with lock icons)
