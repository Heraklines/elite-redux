# Elite Redux porting — session status

## Coverage

| Layer | Status |
|---|---|
| Bespoke ability wires | **262 WIRED + 16 net empty-fixes this session / 1 EMPTY** (Bad Company by design) |
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
| Bespoke scenario suite | **117/117 passing** (ER_SCENARIO=1, 11 files) |
| FULL-262 battle capture | 261 OK / 1 NO-OB / 1 INIT-FAIL / **0 CRASHED** |

## Scenario test breakdown (117 across 11 files)

| File | Tests | Focus |
|---|---|---|
| `bespoke-battle-capture.test.ts` | 22 | FULL-262 + classifier |
| `bespoke-battle-smoke.test.ts` | 18 | Original smoke |
| `bespoke-scenario-suite.test.ts` | 14 | Original scenarios |
| `bespoke-interactions.test.ts` | 11 | Stat + status + type + bypass |
| `er-bespoke-deep.test.ts` | 11 | Scripted moves + multipliers + tags |
| `er-weird-timings.test.ts` | 9 | Switch-out + weather + Trace + procs |
| `er-doubles-mayhem.test.ts` | 8 | 4-mon doubles + spread moves |
| `er-status-interactions.test.ts` | 7 | Status-immune ability gates |
| `er-full-playthrough.test.ts` | 7 | Multi-turn + terrain + sandstorm |
| `er-damage-sanity.test.ts` | 5 | Numerical damage verification |
| `er-multi-hit-procs.test.ts` | 5 | Bullet Seed + Skill Link |

## v2.65.3b ROM extraction

| Artifact | Status |
|---|---|
| ROM | `vendor/elite-redux/rom-extracted/er-v2.65.3b.gba` (32MB) |
| ASCII strings | 193k extracted to `strings.txt` |
| Pokemon-text strings | 37k extracted to `pkmn-strings.txt` |
| Move name table | Inline @ 0x9c826d (855 entries) → `inline-13byte-table-best.json` |
| LZ77 graphics blocks | **2000 decompressed** (5.4MB) → `graphics/*.4bpp` + `.pgm` atlas |
| RGB555 palette candidates | 5000 found, first 500 saved as `.gpl` → `palettes/` |
| Ghidra import + decomp | Running in background (heap fluctuating 0.8-2.0GB) |

## R55 — Empty-bespoke reduction session (2026-05-23..25)

Took empty-wire count from **116 → 64** (45% reduction) by:
1. Reclassifying flawed archetype entries as `bespoke` so dispatchBespoke handles them
2. Building 1 new archetype: `PostSummonScriptedMoveAbAttr` (switch-in scripted moves)
3. Extending 1 archetype: `PostAttackScriptedMoveAbAttr` with `typeFilter` for type-gated post-attack procs

52 new wires across these primitives:
- AttackTypeImmunityAbAttr: Mountaineer (314)
- PostSummonStatStageChangeAbAttr: Scare (329), Terrify (632)
- WeatherDamageReductionAbAttr: Christmas Spirit (283)
- PostAttackScriptedMoveAbAttr +typeFilter: Volcano Rage (382), Frost Burn (475),
  Lunar Wrath (895), High Tide (503), Frost Dragon (1009), Glacial Rage (788)
- PostAttackScriptedMoveAbAttr +flagFilter: Two Step (517), Blade Dance (732),
  Backflip (977), Chunky Bass Line (641), Break it Down (974), Purple Haze (853)
- PostSummonScriptedMoveAbAttr (NEW): 22 switch-in/cast wires —
  Low Blow, Dust Cloud, Phantom Thief, Wildfire, Jumpscare, Sand Pit,
  Monkey Business, Trickster, Wishmaker, Web Spinner, Draco Morale,
  Dream Whimsy, Tar Toss, Neutralizing Fog, Frosty Presence, Let's Roll,
  Air Blower, Cheap Tactics, Doombringer, Suppress, Change of Heart,
  Telekinetic, Powder Burst, Monster Mash, Poseidon's Dominion,
  Let's Dance, I Am Steve, Foamy Web, Electro Booster, Chilling Presence
- CounterAttackOnHitAbAttr +contactRequired: Cold Rebound (383),
  Clap Trap (531), Ice Downfall (633), Ultra Instinct (660)
- DamageReductionAbAttr (move-type filter): Elemental Aegis (995),
  Aegis Ward (996)

Test coverage: 165 scenario tests across 23 files (was 13 at session start).

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
