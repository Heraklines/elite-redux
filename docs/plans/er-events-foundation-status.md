# ER Biome-Overhaul — Foundation status + build plan (2026-06-17)

Companion to `er-events-reconciliation.md` (the ratified spec). This tracks what
is BUILT, what is BUILT-WRONG, the shared plumbing that already exists, and the
groundwork still needed. Two background audits (2026-06-17) feed this.

## 1. Reward / item plumbing — WHAT ALREADY EXISTS (reuse it)

- **Variable reward-option count is already supported.** `SelectModifierPhase.getModifierCount()`
  (`src/phases/select-modifier-phase.ts:419`) starts at 3 and SUMS:
  `ExtraModifierModifier` (+1/stack, permanent), `TempExtraModifierModifier`
  (+1, lapsing), and `erScrapMagnetExtraRewards()`. The reward UI already lays out
  N options (the Scrap Magnet relic proves +N works in-game). **No new UI needed
  for "+N reward options."**
- **Golden Ball = the existing `GOLDEN_POKEBALL`** (`modifier-type.ts:2507`) =
  `ExtraModifierModifier` = +1 reward option, permanent. Events award
  `modifierTypes.GOLDEN_POKEBALL`.
- **Greater Golden Ball = BUILT (this batch)** `modifierTypes.ER_GREATER_GOLDEN_BALL`
  (`modifier-type.ts`, seeds `ExtraModifierModifier` at stack 2 → +2 options).
  Shares the extra-option pool, capped at 3 stacks total (so max +3 options).
  Unit test: `test/tests/elite-redux/er-greater-golden-ball.test.ts`.
- **Event reward control:** `setEncounterRewards({ guaranteedModifierTiers: [...],
  guaranteedModifierTypeFuncs: [...], fillRemaining })` — an event can already
  hand out N options at chosen tiers + specific items/relics. Most pending events
  need NO new items: map their rewards to existing tiers + the 14 `ER_RELIC_*`
  relics + Golden Balls.
- **Relics that exist:** FIELD_MEDIC, WARM_INCUBATOR, COIN_PURSE, MYSTERY_CHARM,
  MORALE_BANNER, SECOND_WIND, TWIN_LINK, ANCHOR, SCRAP_MAGNET, WEATHERVANE,
  BONDED_CHARM, COLLECTORS_ALBUM, QUARTERMASTER, LOOKOUT.
- **Delve substrate exists:** `er-press-your-luck.ts` + `guardianForDepth()`
  (`er-delve-guardians.ts`) + `applyErGuardianTokens()` + mineral/loot helpers.
  Buried City / Into the Caldera clone this (need their own loot pools, not the
  cave mineral pool — see unique-pool rule).

## 2. Items the maintainer named that DON'T exist yet (need a decision)

Each pending event below references an item that has no modifier type. Options:
author it as a real new modifier (sprite + effect + save type) OR map to an
existing relic/tier stand-in. AWAITING maintainer call.

- **Pharaoh's Ankh** (Desert Buried City, on-win) — no item.
- **Molten Core** relic + **Magma Ball** byproduct (Volcano Caldera/Forge) — none.
- **Capacitor relic** (Power Plant Reactor Meltdown) — none.
- **Ancient Glyph** team-wide move-type-boost relic (Ruins Unown Cipher) — currently
  generic tier picks.
- **Pixie Charm** (Fairy's Boon) / **Forager's Pack** (Woodland Forager) — generic picks.

## 3. BUILT-WRONG (confirmed by audit — fix these)

1. **Overcharge the Core** (`overcharge-core-encounter.ts`) — currently a generic
   Electric guardian BOSS FIGHT awarding relics. Spec (transcript 124175 / design
   §59) = a press-your-luck **PERMANENT STAT SURGE**: each surge +~5% SpAtk OR Spd
   permanent on a chosen mon, cap ~20%; short-circuit = chip + lose the session's
   banked surge; ALSO recharges Power Herb / Ward Stones (+1 capacity); LIMITED to
   ~2 targets. **This is the "recharge a Pokemon and permanently increase stats"
   event the maintainer flagged.** Needs full rewrite onto `er-press-your-luck` +
   a reusable permanent-stat-boost subroutine. (Reactor Meltdown is the OTHER
   power-plant event — pick the correct-stat mon → Capacitor relic — and is NOT
   about recharging; do not conflate.)
2. **Salvage Yard** (`salvage-yard-encounter.ts`) — a plain held-item market.
   Spec = **Fabricator** (item-icon quiz → copy-item relic) + **Smelter** (combine
   items → higher-rarity craft). Maintainer rejected the market style.
3. **Import Bazaar** (`import-bazaar-encounter.ts`) — a plain held-item market.
   Spec = **Regional Emissary**: fight a trainer fielding only Redux/regional
   forms; win → keep one of their mons (the home for obtaining regional forms).
4. **Abyssal Vent** — pool violation: draws from the shared cave `er-mineral-loot`.
   Needs its own seabed pool (unique-per-event rule, transcript 131009).

UNDER-BUILT (missing branches, several Phase-D-gated, lower urgency): Ultra
Wormhole (random travel vs chosen + Ultra Beast boss), The Storm (random node vs
specific + weather carry), Informant (fragment vs guaranteed-rarity-drop-in-N),
Lake Spirit (only Knowledge path; missing Emotion + Willpower), Frozen Shapes
(catch/free-for-relic collapsed to tiered cache).

## 4. 7th party member — blast-radius map (groundwork before building the reward)

SAFE (no change): session save/load (`game-data.ts` is size-agnostic), the cloud
worker + D1 schema (opaque blob), the ghost-pool BAN filters (length-agnostic),
biome heal, summary screen. Starter select MUST stay at 6.

Plan: add `getMaxPartySize()` (base `PLAYER_PARTY_MAX_SIZE` 6 + per-run bonus) and
swap these sites off the constant/literal:
- Capture/add: `field/pokemon.ts:8507,8526`; `attempt-capture-phase.ts:322,386`;
  `encounter-pokemon-utils.ts:716,780`; `pokemon-evolutions.ts:212`.
- Switch/revive: `switch-phase.ts:74`; `field/pokemon.ts:7239`; `revival-blessing-phase.ts:27`.
- Item transfer: `select-modifier-phase.ts:250,251,341,342,394`.
- **Party UI cursor rewrite (biggest, own task):** `party-ui-handler.ts` uses
  index 6 = CANCEL, 7 = item-toggle; a real 7th slot at index 6 collides. Derive
  CANCEL/toggle from `partySlots.length` at `:1079,1118,1140,1177-1218,1244-1250,1273-1286,1356`;
  re-space slot Y at `:1989,1995`.
- Ghost capture: `er-ghost-teams.ts:103,439,889` `MAX_PARTY=6` silently `slice(0,6)`
  → the 7th vanishes from run history. Decide: capture 7 (and review fielding a
  7-mon ghost trainer) or keep ghosts at 6.
- Behavioral: shiny-party achievement checks `=== 6` in 3 spots — keep or scale.

## 5. Build order (current)

DONE: Fortune Teller (#500), The Mirage (#511), Cleansing Font (#515), Greater
Golden Ball item. Next, no-new-item events: High Noon, Mountain Sage, Wishing
Crystal, Bog Witch, Sinking Mire, Scavenger's Pact, Fight Club, Frozen in Time,
Unfinished Business. Then: fix Overcharge the Core (+ stat-surge subroutine),
getMaxPartySize groundwork, then item-dependent events once the §2 decision lands,
then the Salvage Yard / Import Bazaar reworks.
