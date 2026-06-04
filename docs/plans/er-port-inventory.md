# Elite Redux v2.65.3b → Pokerogue Port Inventory

Generated: 2026-05-25. Audits everything ER provides vs what's ported.

## Source-of-truth: do we have all the ROM data?

**YES — 99.5%+ coverage.** Three independent sources cover everything needed:

| Source | What's in it | Coverage |
|---|---|---|
| `vendor/elite-redux/v2.65beta.json` | Structured dump of every ER table (1907 species, 1034 abilities, 1032 moves, 929 items, 895 trainers, 569 maps, 64 trainer classes, 25 natures, 21 types, 413 move effects, every level-up/TM/HM/tutor learnset, every evolution) | Authoritative — has STRUCT |
| `vendor/elite-redux/source/src/` | Full pret/pokeemerald-style C source (battle_ai_main.c, battle_ai_util.c, all battle anim files, every data table at `data/pokemon/`) — **163k lines of headers alone** | Full — has CODE |
| `vendor/elite-redux/rom-extracted/` | 193k ASCII strings + 37k Pokémon-text strings + 2000 LZ77 graphics + 500 palettes + inline name table @ 0x9c826d | Coverage check — 1029/1034 abilities + 1028/1032 moves matched in ROM, JSON is correct |

Decompiled C from Ghidra would have given us **nothing new** — we already have human-written C source.

---

## Port status by ER system

Legend: ✅ done · 🟡 partial · ⬜ not started · ⛔ N/A (pokerogue is roguelike, system doesn't apply)

### 1. Pokemon species data

| ER System | Records | Port status | Notes |
|---|---|---|---|
| Species drafts (incl. forms) | 1907 | ✅ extracted (`er-species.ts`) | All 1907 |
| Base stats (BST, types, abilities, innates) | 1907 | ✅ wired (`init-elite-redux-species.ts` + `init-elite-redux-custom-species.ts`) | Innates installed on vanilla pokerogue PokemonSpecies + custom species |
| Level-up movesets | 1905 | ✅ wired (`init-elite-redux-movesets.ts`) | Replaces vanilla level-up lists |
| Evolutions | 931 | ✅ wired (`init-elite-redux-evolutions.ts`) | Level-up + gender-locked; mega/primal as form changes |
| Form change tables | 41 species | ✅ wired (`init-elite-redux-form-changes.ts`) | Mega/primal/origin-form mapping |
| TM/HM learnsets | 1907 × 100ish | 🟡 extracted, **not used** in init-movesets | TM availability shouldn't matter for roguelike but blocks egg-move pulls |
| Tutor learnsets | 1907 × N | 🟡 extracted, **not used** | Similar — would matter for move-tutor scenes |
| Egg moves (per species) | 0 in JSON dump | ⬜ ER doesn't publish per-species egg-moves in this JSON | (ER does have them in source/src/data/pokemon/egg_moves.h — 4678 lines — but they're flat without species grouping in the JSON dump.) Would need re-extraction. |
| Pokedex entries (lore text) | 1907 | ⬜ not extracted | Source at `pokedex_entries.h` + `pokedex_text.h` |
| Experience tables | 6 growth curves | ⬜ not extracted | At `experience_tables.h`. Pokerogue uses its own curves — probably ⛔ |

### 2. Abilities

| ER System | Records | Port status | Notes |
|---|---|---|---|
| Bespoke ability mechanics | 262 wired / 64 empty / 1 deliberately empty (Bad Company) | 🟡 ~80% wired | 64 remaining are complex (highest-stat detection, multi-form, first-turn boosters, arena-tag with custom semantics) |
| Vanilla rebalances (modified pokerogue abilities) | ~150 candidates | 🟡 69 patched in `init-elite-redux-vanilla-rebalance.ts` | Most remaining match vanilla pokerogue exactly |
| Ability descriptions/names | 1034 | ✅ extracted (`er-abilities.ts`) | UI shows them in starter select |
| 4-ability UI | 1 active + 3 innates | ✅ working | Starter / pokedex / summary screens |
| Innate-aware AI scoring | — | ✅ partial | Engine respects innates in damage/ability checks |
| Ability suppression interactions | Mold Breaker / Teravolt | ✅ vanilla behavior preserved | Verified in scenario tests |

### 3. Moves

| ER System | Records | Port status | Notes |
|---|---|---|---|
| Bespoke move mechanics | 57 / 57 cases wired (53 OK + 3 SKIP + 1 OTHER per dispatcher count) | ✅ 100% wire coverage (a few partial-effect shapes) | |
| Move drafts (name/pwr/acc/type/flags) | 1032 | ✅ extracted (`er-moves.ts`) | |
| Vanilla move patches | 71 / 111 MAJOR+TOTAL patches | 🟡 wired (`init-elite-redux-vanilla-move-patches.ts`) | Some deferred |
| ER-only splits (4 of 7) | USE_HIGHEST_OFFENSE (26), HITS_DEF (4), USE_HIGHEST_DAMAGE (1), HITS_SPDEF (1) | 🟡 partial | USE_HIGHEST_OFFENSE → VariableAttackCategoryAttr (works). HITS_DEF/HITS_SPDEF/USE_HIGHEST_DAMAGE collapsed to PHYSICAL — defense-stat-swap primitive exists (R51 audit-fix) but only wired for specific named moves (Power Fists / Soul Crusher / Power Edge). Other moves with these splits silently fall back to PHYSICAL. |
| Move target tables | 10 ER targets | ✅ extracted (`targetT`) | Mapped via target-overlay |
| Move flags (BITING/PUNCH/HAMMER/etc.) | 18 flags | ✅ wired (`er-flag-mapping.ts`) | Pokerogue MoveFlags extended with ER-only bits |

### 4. Trainers / battle setup

| ER System | Records | Port status | Notes |
|---|---|---|---|
| Trainer drafts (party, IVs, EVs, items, natures, moves) | 895 | ✅ extracted (`er-trainers.ts`) | |
| Trainer classes | 64 | ✅ extracted + alias-mapped (`er-trainer-class-aliases.ts`) | |
| Trainer overlay (replace pokerogue rosters) | — | ✅ runtime hook (`er-trainer-runtime-hook.ts` + `er-trainer-overlay.ts`) | |
| Insane/Hell party variants | per trainer | 🟡 extracted (`insaneParty` field) | Selection logic for difficulty tiers exists but coverage of when "insane" fires is partial |
| Trainer spreads / dialog | `trainer_spreads.h` | ⬜ not extracted | Per-trainer move-pool weighting |
| Trainer parties (full C tables) | `trainer_parties.h` (42k lines) | ⛔ pokerogue uses its own gym-leader/elite-4 system; ER overlay swaps party lists where it makes sense |

### 5. Items

| ER System | Records | Port status | Notes |
|---|---|---|---|
| Items (full list) | 929 | ⬜ **not extracted/wired** | No `er-items.ts` exists |
| Item effects (held-item gameplay effects) | `item_effects.h` | ⬜ not extracted | E.g. ER-specific berries, Z-crystals, mega stones (mega stones have a partial wire via FormChangeItem) |
| Mega stones / form-change items | ~70 in `FormChangeItem` enum | ✅ form-change overlay maps them | Working — Mega Evos fire |
| Custom held items / berries | TBD | ⬜ not extracted | E.g. "Toxic Orb +" with ER spec rewrites? |
| Held-item move-power riders (Charcoal, Mystic Water, etc.) | vanilla | ⛔ vanilla pokerogue handles | |

### 6. Battle engine specifics

| ER System | Port status | Notes |
|---|---|---|
| 1 active + 3 innate abilities active simultaneously | ✅ | Working — multi-ability holders verified in 165 scenario tests |
| Engine hooks added (OnOpponentSwitchOut, RecoilDamageMultiplier, PersistentFieldAura) | ✅ | Specific to ER mechanics |
| FOG weather as 7th weather type | ✅ | WeatherType.FOG = 6; Fog Machine sets it on-hit; Ectoplasm/Ethereal Rush/Surprise!/etc. read it |
| ER scripted-move primitives (PostAttack scripted move, PostSummon scripted move, CounterAttackOnHit) | ✅ | This session: built PostSummonScriptedMoveAbAttr + typeFilter/flagFilter for PostAttack |
| Damage formula tweaks (defense-stat swap, etc.) | 🟡 | Specific moves wired; general HITS_DEF split not auto-applied |
| Status interactions (Bleed/Fear/Curse as battler tags) | 🟡 | ER_BLEED tag exists. Bleed-immunity rider needed for `Blood Bath` etc. |
| Inverse type chart (per-ability) | ⬜ | `Inversion (473)` wire is empty — would need arena-tag with type-chart override |

### 7. UI / gameplay flow

| Item | Status | Notes |
|---|---|---|
| 4-ability layout (active + 3 lock-icon innates) | ✅ | Starter select / pokedex / summary |
| ER customs in egg hatching | ✅ | BST-based tier (init-elite-redux-egg-tiers.ts) |
| Dev cheat: 999 vouchers | ✅ | Click any voucher icon on egg gacha |
| Trainer overlay in classic mode | ✅ | Replaces pokerogue rosters where ER has them |
| ER pokedex art / sprites | 🟡 | Sprite manifest exists (`er-sprite-manifest.ts`); 2000 LZ77 graphics extracted from ROM but **not yet mapped to species** (raw `.4bpp` + greyscale `.pgm` atlases only) |
| Map data / encounter tables | ⛔ | Pokerogue is roguelike — ER maps don't apply |
| Trainer dialog / story text | ⛔ | Pokerogue has no overworld dialog |

### 8. Audio / cosmetics

| Item | Status | Notes |
|---|---|---|
| Battle BGM | ⛔ | Pokerogue uses its own music |
| Battle animation frames (BG, sparkles) | ⛔ | Pokerogue uses its own anims |
| Pokémon sprite art | 🟡 | Vanilla pokerogue art used; ER-specific sprite art for **ER-custom species** still needs to be ported from `vendor/elite-redux/sprites/` |

### 9. Data we have but haven't used yet

| Field | Source | Why unused |
|---|---|---|
| `tmhmMoves` per species | `er-species.ts` | Pokerogue has no TM/HM scene; **could enable as "starter has access to these moves via egg-move-like pool"** |
| `tutorMoves` per species | `er-species.ts` | Same as TM |
| `pokedex_entries.h` / `pokedex_text.h` | ER source mirror | Not extracted to JSON — pokedex UI shows ER names but vanilla lore text |
| `experience_tables.h` (6 curves) | ER source mirror | Pokerogue uses its own |
| `item_effects.h` | ER source mirror | No item extraction done — biggest gap |
| `trainer_spreads.h` | ER source mirror | Move-set weighting per trainer for variety |
| Per-map encounter rates | ER source mirror | ⛔ pokerogue roguelike |
| Item icons | `vendor/elite-redux/sprites/` | Not mapped — would unlock visual ER items |

---

## What's left to port — prioritized

### P0 — Block real ER feel
1. **Items system** (`er-items.ts` + `init-elite-redux-items.ts`) — 929 items, zero ported. **Biggest gap.** Berries, mega stones, ER-specific held items.
2. **64 remaining empty ability wires** — see `er-audit-fix-verification.test.ts` for the live list. Categorized:
   - 11 "highest stat" detectors (Whiteout, Majestic Moth, Greater Spirit, Sun Worship, Sea Guardian, etc.)
   - 6 first-turn boosters (Violent Rush, Readied Action, Rapid Response, On the Prowl, etc.)
   - ~8 form-change abilities (DNA Scramble, Flammable Coat, Komodo)
   - ~6 arena-tag custom (Inversion, Salt Circle, Telekinesis-extended)
   - ~4 highest-stat-vs-condition (Lightning Aspect, Turf War)
   - remainder: complex multi-effect bespokes (Berserk DNA, Demolitionist, Petrify)
3. **ER-only splits** — HITS_DEF / HITS_SPDEF / USE_HIGHEST_DAMAGE: 6 affected moves silently fall back to PHYSICAL.

### P1 — Quality
4. **TM/Tutor move pools** — wire as starter-egg-move-like pools so ER's intended move pools matter.
5. **40 vanilla move patches** still deferred (out of 111 MAJOR+TOTAL).
6. **80 vanilla ability rebalances** deferred (most match vanilla; a handful are real diffs).
7. **ER sprite mapping** — link extracted LZ77 graphics blocks to ER species names.

### P2 — Polish / nice-to-have
8. **Pokedex lore text** — port ER's pokedex entries.
9. **Trainer spreads** (move-set variety) — moves trainers can mix-and-match.
10. **Custom items icons** — for inventory rendering.

### Won't port
- Maps / overworld encounters / story dialog (pokerogue is roguelike)
- Battle animations / BGM (pokerogue has its own)
- Experience curves (pokerogue has its own)

---

## Bottom line

**We have the data.** Three independent sources (JSON dump, C source mirror, ROM extraction) cross-validate. The blockers are now ENGINEERING (wire what we already have), not RESEARCH (extract more from the ROM).

Biggest single missing piece: **items** (P0 #1). Second-biggest: **64 ability wires + ER-only damage splits** (P0 #2+#3).
