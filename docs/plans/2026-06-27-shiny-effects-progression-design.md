# Shiny Effects — Progression, Economy & In-Game UX (design)

Companion to `2026-06-27-special-form-shinies-design.md` (the rendering/crossplay spec).
This doc is the **progression / unlock / economy / UI** layer. Decisions confirmed by the
maintainer 2026-06-27. Status: design, not yet implemented. Plugs into the EXISTING
achievement reward-grant rail (`validateAchv` + the reward hook, the 76 reward-mapped
achievements, the black-shiny-on-Inferno grant).

The three effect layers come from the Shiny Lab (`shiny-lab/`, live at shiny-lab.pages.dev):
**Palette** (crossplay-safe recolor), **Surface FX** (on-sprite), **Around FX** (aura).

## 0. Decisions locked
- **Per-species** unlocks (in `starterData`), NOT per-individual. Unlock Galaxy on Articuno
  and it's on Articuno forever, not on Pikachu.
- **Tier gate lives on the MON, not the account.** That specific mon must BE the tier to
  equip the category. You grind the shiny to earn the *slot*; candy fills it.
- Built **on top of the existing variant + black-shiny ladder** (extend, not replace).
- **No effect is free.** Every effect costs candy (or is granted). Some are double-locked
  behind an achievement/challenge/quest before candy can even be spent.
- **Pure cosmetic** (for now; gameplay tie-ins maybe later).

## 1. Tier -> category (the slot you earn)
Proposed binding (confirm the tier<->variant mapping):

| Tier | Existing shiny | Unlocks (cumulative) |
|---|---|---|
| T1 | standard shiny (variant 0) | Palettes |
| T2 | rare shiny (variant 1) | Palettes |
| T3 | epic shiny (variant 2) | + Surface FX |
| T4 | black shiny | + Around FX (auras) |
| T5 | (future special-form) | TBD (combos / signatures / animated shader) |

Higher tier includes lower. To put a Surface FX on your Articuno, that Articuno must be an
**epic (T3+) shiny**; to wear an aura it must be a **black (T4) shiny**. Brutal on purpose -
the grind is the point. T5 is parked; we build T1-T4 now.

## 2. The 3-gate unlock resolver
`canEquip(species, effect)` = `tierOK && availableOK && ownedOK`:
- **tierOK** - the species' best earned shiny tier >= `effect.category.minTier`.
- **availableOK** - the effect is not achievement/challenge/quest-locked, OR its gate is
  completed. (Global, stored once in `systemData`, not per species.)
- **ownedOK** - the effect is in the species' owned-bitset (bought with candy, caught wild,
  or granted). Owning is **per species**; nothing is owned by default.

## 3. Candy economy
Per-category base + **additive** ramp (all knobs):

| Category | Cheapest | Ramp / step (additive) |
|---|---|---|
| Palette (T1-2) | 100 candy | ~ +40 each |
| Surface (T3) | 500 candy | ~ +120 each |
| Around (T4) | 1000 candy | ~ +200 each |

The Nth unlock in a category for a species costs `base + (owned_in_category) * step`.

- **Random discount assortment** = "every mon gets a few cheaper effects." On first dex
  registration, seed-roll (seeded by species id, stable) ~3 of the candy-purchasable
  (non-achievement) effects per category to a discount (e.g. -40%). It does NOT bypass the
  achievement gate - it only lowers gate-3 (candy) for those few.
- **Achievement/challenge-unlocked effects** still cost candy per species (so a global
  unlock doesn't flood everyone), but at a **reduced rate** (proposed: ~50% of ramp price).
  The achievement makes it *buyable everywhere*; candy makes it *owned per species*.

## 4. Persistence (save-efficient - bitsets from day one)
Per species in `starterData`:
- `ownedEffects` - a **bitset per category** (palette / surface / around), ~ceil(N/8) bytes.
- `loadout` - `{ paletteId, surfaceId, aroundId }` + params `{ palAmt, surfAmt, aroAmt,
  scale, seed, tintMode }`, all **quantized to bytes**.
- `presets[0..4]` - 5 saved loadouts (same shape).

Global (once, in `systemData`): the set of achievement/challenge-unlocked "available"
effects. Budget = bitsets + byte-quantized params, ~tens of bytes/species.

## 5. Wild spawns (the hunt)
A wild shiny gets a **nested sub-roll** for a special effect (mirrors epic->black nesting):
- ~40% of shinies also roll a **palette** (T1).
- rarer: a **surface** (epic-gated wild). rarest: an **aura** (black-gated wild).
- The KIND is **random** (no specific targeting in v1; biome/weather targeting = back
  burner, parked - needs per-effect curation).
- Catching it unlocks that effect for the **species** (+ the shiny tier if new). You can
  hunt "a palette," not a specific one (for now).
- **Rarity labels** (common / rare / epic / legendary) drive both the wild appearance
  weights and the menu prestige badge.

## 6. In-game Shiny Lab (Starter Select -> Shiny Lab)
A stylish in-game menu (NOT the web tool), big animated mon preview:
- Browse effects by category; **locked ones shown with their unlock condition** (collection
  + achievement-hunt driver).
- **Per-layer intensity sliders + texture scale + seed** (with a reroll-seed button). NO
  color picker for players - only the tint-to-palette toggle. (The color picker stays a
  maintainer-only tool in the web lab.)
- Spend candy to unlock; equip; save up to **5 presets** (global presets allowed, but a
  preset only applies effects the target species actually owns).
- **Shiny-dex completion**: % effects unlocked per species/category, with a reward at 100%.

## 7. Crossplay (ghosts) - so a ghost's mon shows the owner's exact design
- The loadout + params serialize into `GhostMember` (~10 bytes/mon): 3 effect ids + 3
  intensity + scale + seed + tintMode. **No RGB** - players have no color picker, so the
  aura color is palette-derived and crossplay-clean.
- `applyErGhostOverride`: set on `customPokemonData`, **CLAMP every id to the registry**
  (the D1 blob is untrusted -> out-of-range degrades to plain, never throws), then re-seed
  the shader/overlay (the rendering doc flags this exact hook).
- So a specific ghost trainer's specific Pokemon plays the owner's exact effect for everyone.

## 8. Rendering (ties to the rendering doc)
- **Palette** -> the engine's existing 32-slot variant palette-swap shader (exact, crossplay,
  no new atlas). Applying any palette **replaces** the default shiny recolor (operates on the
  vanilla base colors); the black-shiny default aura is replaced by the chosen one.
- **Surface + Around** -> port the lab's `fx.mjs` to a Phaser sprite post-FX (GLSL) + an
  overlay handler (the rendering doc's Layer-2 aura handler). The lab is the canonical
  reference; CI can prove palette determinism, the rest is eyeballed in-browser per CLAUDE.md.

## 9. Name signatures + nameplate FX
- Specific **palette+aura combos earn a named title / nameplate flair** (the GoldenCharizard
  / GlitterRayquaza style). A small `combo -> name` registry.
- (Stretch, Phase 4) apply the effect to the battle **nameplate** itself (tint/animate the
  name window + text), not just the sprite.

## 10. Achievement / challenge -> reward mapping
Principle: **reward prestige scales with effort**; effects sit ~T1-2 shiny reward rarity, so
trivial achievements never grant them. **Most gates require ACE mode or higher** (not
Youngster). To avoid clogging the achievement UI, prefer **challenge-completion grants** over
new achievement entries where possible (the reward hook already fires on challenge complete;
e.g. color/mono challenges with modifiers -> matching palettes weighted by difficulty).

New achievements (confirmed, with suggested reward):

| Achievement | Condition | Reward |
|---|---|---|
| Prism Break | Win a run with a different type on every team member | Prism Split (surface) |
| Eclipse | Win a Ghost-Trainers run with zero faints | Cosmic Backdrop / Shadow Aura (prestige) |
| Midas | Win Classic (Ace+) with the whole team holding no items | Aurum / Golden Glow |
| Untouchable | Reach wave 50 without taking any damage | Rainbow Outline (top prestige) |
| Cold Open | KO 3 mons via indirect Frostbite/freeze in one battle | Frostbite / Frost Aura |
| Going Nuclear | Win Hell on a Mono-Poison team | Toxic / Toxic Bubbles |

TODO (follow-up table): audit the existing 76 achievements + the challenge set and assign
which unlock which effect (which are achievement-locked vs challenge-grant vs plain candy).

## 11. Phasing
- **P1** - schema (per-species owned bitsets + loadout + 5 presets) + the 3-gate resolver +
  candy spend + the in-game Shiny Lab menu (palettes / T1-2 only) + palette render via the
  variant swap.
- **P2** - Surface FX (T3): GLSL port of the lab surface effects + overlay handler +
  crossplay serialization on `GhostMember` + clamp/re-seed in `applyErGhostOverride`.
- **P3** - Around FX (T4) + the wild special-spawn nested roll + rarity labels + shiny-dex
  completion.
- **P4** - name signatures + nameplate FX + reroll-seed tokens + (later) T5 / quests /
  seasonal limited-time unlocks.

## Open micro-decisions
1. Confirm the tier<->variant binding in section 1 (esp. T3=epic, T4=black).
2. Achievement-unlock candy discount rate (proposed ~50% of ramp).
3. OK to prefer challenge-completion grants over new achievement entries for the bulk of
   unlocks (UI-clog mitigation)?
4. Nameplate FX (section 9) - Phase 4 stretch, or cut?
