# Item-economy tuning: tiered mega-stone rarity + tactical-item redistribution

**Date:** 2026-07-22
**Scope:** two maintainer mandates on the item economy.
**Status:** implemented + tested (see "Implementation sites" and "Tests").

This doc is the **vetoable design surface**. Every tuning number lives in a data
table you can edit; the tables below say what each decision is and why. Change a
line, re-run the named test, ship.

---

## Mandate 1 - tiered mega-stone rarity

> "some megas are much stronger than others and need to be properly rare"

### Current state (before this change)

- Mega/primal stones are `FormChangeItem` modifiers offered through
  `FormChangeItemModifierTypeGenerator` (`modifier-type.ts`). The generator
  gathers every stone the party can currently use (Mega-Bracelet-gated) and
  picked **one uniformly at random** (`formChangeItemPool[randSeedInt(len)]`).
  There was **no strength weighting at all** - a Primal-orb legendary was exactly
  as likely as a gimmick move-mega.
- The reward-pool slot is a single `FORM_CHANGE_ITEM` entry in the **ULTRA**
  bucket (`init-modifier-pools.ts:386`, wave-scaled weight 6->24). `RARE_FORM_
  CHANGE_ITEM` + `MEGA_BRACELET` sit in **ROGUE**.
- Biome shops surface stones via the `EVO` category (`FORM_CHANGE_ITEM`). Price +
  stock were resolved from the **pool slot's** tier (ULTRA) via
  `getOrInferTier()` - so **every** stone priced the same, regardless of strength.
- Mystery-encounter / mining loot (`er-mineral-loot.rollMegaStone`, used by
  Glittering Vein, Overgrown Temple, Abyssal Vent, Tide Pools, Into the Caldera)
  picked a party-line stone with `randSeedItem` - again uniform.

Net: a run built around Mega Xerneas got its stone as easily as one built around
Mega Butterfree, and shops sold both for the same price.

### Design: a strength tier per stone, applied to all three channels

Each obtainable stone is scored to one of the five reward tiers
(`COMMON < GREAT < ULTRA < ROGUE < MASTER`). The score is **BST of the mega form
the stone triggers**, mapped through editable bands, then a **hand-curated
override** wins for the "kit >> BST" and "must-be-elite" cases. The tier drives
three channels **consistently**:

1. **Reward-roll selection** - the generator now does a **weighted** pick
   (weight = the tier's gen weight), so when several stones compete the strong
   ones almost never win.
2. **Biome-shop price + stock** - a stone prices + stocks by **its own** tier
   (`ER_SHOP_ITEM_TIER_FACTOR` / `ER_SHOP_STOCK_BY_TIER`), so a MASTER stone is
   masterball-tier expensive and stocks 1, a COMMON stone is cheap and plentiful.
3. **ME / mining loot** - the same weighted pick, so a masterball-tier stone is a
   very-low-chance find.

**Reachability is never broken:** every stone keeps weight >= 1, so a mono-mega
party still obtains its stone - it is just rare + expensive, not gated out. (The
`er-mega-reachability-audit` invariant is untouched.)

#### Table 1a - BST -> default tier bands  (`MEGA_BST_THRESHOLDS`)

The bulk knob. Edit these to re-band everything at once. Values are the mega
FORM's base-stat total (read live from the injected form).

| Mega-form BST | Default tier | Rationale |
|---|---|---|
| <= 470 | COMMON | weak / gimmick / early move-megas - abundant filler |
| 471-530 | GREAT | modest megas |
| 531-590 | ULTRA | solid mid-tier megas (the bulk of vanilla megas) |
| 591-660 | ROGUE | strong megas |
| >= 661 | MASTER | the 700+ powerhouses |

Distribution sanity (from the ER 2.65 mega set, ~230 BST-scored + the legendary
overrides): p50 BST ~520 (ULTRA), p90 ~680, p99 ~780. So the *default* bands put
the median mega at ULTRA and reserve MASTER for the genuine top of the curve -
before overrides.

#### Table 1b - per-stone OVERRIDES  (`ER_MEGA_TIER_OVERRIDES`)

The line-item veto surface. An entry **wins over the BST band**. Unknown stone
names are harmless no-ops (safe to over-list). Two intents:

**-> MASTER (genuinely rare, masterball-tier): box legendaries, creation/primal
orbs, and the "-Z / -X ultra" super-mega class the mandate calls out.**

| Stone | Why MASTER |
|---|---|
| RED_ORB / BLUE_ORB | Primal Groudon / Kyogre |
| ADAMANT_ORB / LUSTROUS_ORB / GRISEOUS_ORB | Dialga / Palkia / Giratina |
| GALACTIC_ORB / PLANETARY_ORB / EMBRYONIC_ORB / VICTINI_ORB | creation / event orbs |
| MEWTWONITE_X / MEWTWONITE_Y | Mega Mewtwo |
| XERNEASITE / YVELTALITE / ZYGARDITE | box legendaries (named in the mandate) |
| LATIASITE / LATIOSITE / DIANCITE / HEATRANITE / DARKRANITE / ZERAORITE / MAGEARNITE / CHIEN_PAOITE | legendary / mythical megas |
| ULTRANECROZIUM_P / PHANTOM_METEOR | ultra / cosmic |
| LUCARIONITE_Z / CHARIZARDITE_Z / GARCHOMPITE_Z / ABSOLITE_Z / DRAGONINITE_Z / SKARMORITE_Z | the "-Z" ultra-mega class |
| GYARADEATHITE_X / GYARADEATHITE_Y / KILOZUNITE | ER-custom apex megas |

**-> ROGUE (kit far exceeds BST - the ability makes them run-defining):**

| Stone | Why ROGUE (kit) |
|---|---|
| KANGASKHANITE | Parental Bond |
| MAWILITE | Huge Power |
| MEDICHAMITE | Pure Power |
| BLAZIKENITE | Speed Boost |
| SALAMENCITE | Aerilate |
| GARDEVOIRITE | Pixilate |
| SCIZORITE | Technician |
| LOPUNNITE | Scrappy + High Jump Kick |
| AGGRONITE | Filter + 230 Def |
| GENGARITE / LUCARIONITE / METAGROSSITE / GARCHOMPITE / TYRANITARITE / GALLADITE | classic top-of-format megas |

*Everything not listed here takes its BST band from Table 1a.* To pull a specific
mega up/down, add a line here - it needs no code change.

#### Table 1c - roll weight per tier  (`TIER_GEN_WEIGHT`)

How rare each tier is when it competes for a single roll. A MASTER stone is ~64x
less likely than a COMMON one in the same eligible pool.

| Tier | Gen weight |
|---|---|
| COMMON | 64 |
| GREAT | 32 |
| ULTRA | 12 |
| ROGUE | 4 |
| MASTER | 1 |

Shop price factor per tier (existing `ER_SHOP_ITEM_TIER_FACTOR`, wave-income
units) that a stone now inherits: COMMON 0.35x, GREAT 1.0x, ULTRA 2.6x, ROGUE 6x,
**MASTER 12x**; shop stock (`ER_SHOP_STOCK_BY_TIER`): COMMON 5 ... ROGUE 1,
**MASTER 1**. So a masterball-tier stone in a biome shop is ~12 waves of income
and one-in-stock - "very low chance, rare + expensive" per the mandate.

#### Table 1d - ABSOLUTE appearance rate per tier  (`TIER_APPEARANCE_RATE`)

> maintainer directive 2026-07-23: "a master tier item should be genuinely rare
> even if it's the only mon on the team."

`TIER_GEN_WEIGHT` (Table 1c) is the COMPETITIVE knob: it only decides WHICH stone
wins when several are eligible. It does nothing when a strong mega is a party's
ONLY mega-capable mon - then its stone is the sole candidate (weight-1-of-1) and
the weighted pick returns it every time, so a mono-elite party got its masterball
stone in effectively EVERY form-change slot. Table 1d is the fix: an **absolute**
per-tier gate applied AFTER the competitive pick. Once a stone is chosen, its tier
is rolled against this rate to decide whether it MATERIALIZES AT ALL. This is
orthogonal to the weighting - the weighting picks the stone, the gate decides if
that stone appears.

| Tier | Appearance rate | Meaning |
|---|---|---|
| COMMON | 1.00 | abundant filler - always materializes |
| GREAT | 0.72 | usually appears |
| ULTRA | 0.40 | appears less than half the time |
| ROGUE | 0.12 | rare |
| MASTER | 0.02 | ~2% - box legendaries / primal orbs / '-Z' ultra megas: genuinely rare |

On a gate MISS the form-change slot yields nothing: the post-battle REWARD roll
re-rolls a normal (non-form-change) in-tier item; the BIOME-SHOP form-change slot
is skipped; a MINING dig turns up no stone. It never crashes an empty slot, and
every rate is > 0 so a mono-master party can still eventually obtain its stone -
just genuinely rarely, not gated out.

**Scope - RANDOM channels only.** The gate applies to the three random circulation
channels (reward-pool roll `getNewModifierTypeOption`, biome-shop random slot in
`getPlayerShopModifierTypeOptionsForWave`, and mining `rollMegaStone`). It does
NOT apply to GUARANTEED / forced stones (dev-suite `shopItems: [FORM_CHANGE_ITEM]`,
ME-guaranteed rewards, or a pregen-specified stone) - those resolve through the
generator's forced path and always appear, since forcing a specific stone is an
explicit design decision, not a random roll. Verified:
`test/tests/elite-redux/er-mega-tiers.test.ts` (rate ladder strictly ordered,
MASTER materializes <=3% + red-proof that the pre-gate pick is 100%, COMMON near-
certain).

---

## Mandate 2 - redistribute the 27 tactical items

> most leave (or are heavily down-weighted in) the post-battle reward pool; each
> lands in biome shop pools + ME pools where it thematically fits.

### Current state (before this change)

All 27 are **ER-only** modifier keys (`ER_<NAME>`); none exist as vanilla keys.
Every one was in the **player post-battle reward pool** (`init-modifier-pools.ts`):
8 in GREAT, 17 in ULTRA, 2 in ROGUE (Red Card was already player-unobtainable -
enemy-only). Seven had thematic biome-shop signatures already (Safety Goggles/
Desert, Mental Herb/Meadow, Covert Cloak/Graveyard+Slum, Expert Belt+Muscle Band/
Dojo, Wise Glasses/Ruins, Heavy-Duty Boots/Construction, Smoke Ball/Slum). **No**
ME granted any of them.

Note also a pre-existing contradiction: `er-biome-economy.ts` said Covert Cloak
was "SHOP-ONLY for players ... never enters the random reward pools", yet it was
in the ULTRA reward pool. This change resolves it in favor of the stated intent
(Covert Cloak -> weight 0 in rewards, shop-only).

### Design: verdict + thematic home per item

Seams used (no new systems):
- **Reward pool:** `er-item-tuning.json` (the editor-managed weight/tier seam).
  `weight: 0` = removed from reward rolls, `weight: 1` = a rare reward.
- **Biome shops:** `ER_BIOME_ECONOMY[biome].signature` (always-stocked, priced by
  the item's own rarity tier x the biome discount).
- **MEs:** `setEncounterRewards({ guaranteedModifierTypeFuncs })` (the lazy-func
  pattern). High Noon is wired this batch; the rest are design targets (below).

#### Table 2 - the 27-item distribution matrix

`Reward` column: **remove** = weight 0, **down** = weight 1, **keep** = untouched
(broadly-useful staple stays a normal reward). `Shop` = biome signature home(s).

| Item | Reward | Shop biome(s) | ME | Rationale |
|---|---|---|---|---|
| Expert Belt | keep | Dojo | - | universal damage staple; martial-hall fit |
| Muscle Band | keep | Dojo | - | universal physical staple; martial-hall fit |
| Wise Glasses | keep | Ruins | - | universal special staple; arcane-focus fit |
| Punching Glove | keep | Dojo | - | offense staple; martial fit |
| Metronome | keep | Factory | - | ramping offense; rhythmic-machinery fit |
| Booster Energy | keep* | Space | - | paradox-mon payoff; keep party-gated in pool, sell where paradox mons drift |
| Safety Goggles | down | Desert, Forest | - | sandstorm + spore/powder biomes |
| Heavy-Duty Boots | down | Construction, Cave | - | entry-hazard biomes |
| Air Balloon | down | Power Plant | - | manufactured gadget (also enemy-flavor there) |
| Clear Amulet | down | Fairy Cave | - | protective charm vs stat-lowering hexes |
| Ability Shield | down | Temple | - | ward that no hex can strip |
| Float Stone | down | Space | HN | zero-g lightness; speed prize |
| Mental Herb | down | Meadow | - | calm-meadow flavor (unchanged home) |
| Zoom Lens | down | Laboratory | - | precision optics |
| Covert Cloak | remove | Graveyard, Slum | - | shop-only per maintainer; enemy-useful |
| Eject Button | remove | Power Plant | - | escape tech gadget |
| Eject Pack | remove | Construction | - | safety eject at the work site |
| Red Card | (enemy-only) | - | - | maintainer directive: enemy pools only |
| Room Service | remove | Ruins | - | Trick Room / psychic-space theme |
| Iron Ball | remove | Factory | - | dead-weight machinery (also enemy-flavor Construction) |
| Sticky Barb | remove | Jungle | - | jungle thorns (also enemy-flavor there) |
| Smoke Ball | remove | Slum | - | back-alley escape (unchanged home) |
| Shed Shell | remove | Swamp | - | slip free of the trapping mire |
| Blunder Policy | remove | Slum | HN | back-alley gamble; speed-on-miss prize |
| Adrenaline Orb | remove | Mountain | HN | intimidating apex predators; speed prize |
| Throat Spray | remove | Cave | - | reads off the cave echo (sound) |
| Utility Umbrella | remove | Sea | - | neutralizes the rain-biome weather swings |

\* Booster Energy keeps its **party-gated** reward weight (Protosynthesis/Quark
Drive only) untouched - flattening it to a constant would lose that smart gate,
and it is already self-rare. It gains a thematic shop home.

**Invariant:** every item pulled from the reward pool has at least one biome-shop
home (asserted by test), except Red Card which is enemy-only by directive.

`HN` = wired into the High Noon ME this batch (speed-duel prize, one of Adrenaline
Orb / Blunder Policy / Float Stone). Other thematic ME homes are **design targets**
for a follow-up batch (kept out of this change to hold the file surface tight):
Bog Witch (swamp escape - Shed Shell / Smoke Ball), Dragon's Hoard / Scavenger's
Pact (Wasteland salvage - Clear Amulet / Ability Shield), Fight Club (Slum brawl -
Punching Glove / Muscle Band). Add via the same `guaranteedModifierTypeFuncs`
lazy-func pattern.

---

## Implementation sites

**Mandate 1**
- `src/data/elite-redux/er-mega-tiers.ts` **(new)** - the tier tables
  (`MEGA_BST_THRESHOLDS`, `ER_MEGA_TIER_OVERRIDES`, `TIER_GEN_WEIGHT`), the lazy
  form-BST resolver, and `erMegaStoneTier` / `erMegaStoneGenWeight` /
  `pickErMegaStoneWeighted`.
- `src/modifier/modifier-type.ts` - generator uses `pickErMegaStoneWeighted`;
  the biome-shop tier resolution uses `erMegaStoneTier` for
  `FormChangeItemModifierType` slots.
- `src/data/elite-redux/er-mineral-loot.ts` - `rollMegaStone` uses the weighted
  pick + tags the option with its true tier.

**Mandate 2**
- `src/data/elite-redux/er-item-tuning.json` - reward-pool verdicts (weight 0/1).
- `src/data/elite-redux/er-biome-economy.ts` - thematic biome signatures.
- `src/data/mystery-encounters/encounters/high-noon-encounter.ts` - speed-duel
  tactical prize.

## Tests

- `test/tests/elite-redux/er-mega-tiers.test.ts` - legendaries/orbs/-Z are MASTER,
  a plain mega is below MASTER, weights strictly ordered, the weighted pick biases
  hard toward the lower tier, single-stone reachability, shop price scales by tier.
- `test/tests/elite-redux/er-tactical-distribution.test.ts` - removed = weight 0,
  down = weight 1, kept staples untouched, every pulled item has a biome-shop home
  (Red Card excepted), named placements landed.
- Existing green + unchanged: `er-tactical-items.test.ts` (behavior),
  `er-biome-market.test.ts`, `er-mega-reachability-audit.test.ts`,
  `er-mega-stone-reward-gating.test.ts`, `er-item-tuning.test.ts`.

## Dev-suite

Shop-visible changes are staged via the `shopItems` scenario mechanism. `(note)`
entries added to `scenarios.ts` pointing testers at: the biome-shop signature
homes (buy the redistributed item in-theme) and the High Noon speed prize.
