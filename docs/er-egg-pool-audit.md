# ER egg-pool declutter audit (0.0.3.8)

Generated from the live pool dump (dev-logs/egg-pool-audit.json, 279 ER entries).
Criteria (maintainer): battle-only forms never hatch; forms obtainable in vanilla
PokeRogue (as forms of one species or via form-change items) do not get a duplicate
ER species in the pool; cosmetic variants bring nothing new.

## Summary
- Current ER egg-pool entries: 279
- Proposed removals: 161
- Remaining after cleanup: 118

## A. Battle-only forms leaking into eggs (filter gap, plain bug)
- Castform Foggy (RARE)
- Castform Rainy (RARE)
- Castform Sandy (RARE)
- Castform Snowy (RARE)
- Castform Sunny (RARE)
- Cherrim Sunshine (RARE)
- Cramorant Gorging (RARE)
- Cramorant Gulping (RARE)
- Mimikyu Apex Busted (RARE)
- Mimikyu Busted (RARE)
- Xerneas Active (LEGENDARY)
- Zygarde Complete (LEGENDARY)

These should also be added to the battle-form exclusion filter in
init-elite-redux-egg-tiers.ts (tokens: BUSTED, GULPING, GORGING, SUNSHINE,
weather-Castform, COMPLETE, ACTIVE) so they can never come back.

## B. Duplicates of vanilla PokeRogue forms / form-change items

**arceus** - vanilla Arceus changes type via the plates (form-change items)
- Arceus Bug (LEGENDARY)
- Arceus Dark (LEGENDARY)
- Arceus Dragon (LEGENDARY)
- Arceus Electric (LEGENDARY)
- Arceus Fairy (LEGENDARY)
- Arceus Fighting (LEGENDARY)
- Arceus Fire (LEGENDARY)
- Arceus Flying (LEGENDARY)
- Arceus Ghost (LEGENDARY)
- Arceus Grass (LEGENDARY)
- Arceus Ground (LEGENDARY)
- Arceus Ice (LEGENDARY)
- Arceus Poison (LEGENDARY)
- Arceus Psychic (LEGENDARY)
- Arceus Rock (LEGENDARY)
- Arceus Steel (LEGENDARY)
- Arceus Water (LEGENDARY)

**basculin** - vanilla Basculin has all stripe colors
- Basculin Blue (RARE)
- Basculin White (RARE)

**burmy** - vanilla Burmy has all cloaks
- Burmy Eterna (LEGENDARY)
- Burmy Sandy (COMMON)
- Burmy Trash (COMMON)

**calyrex** - vanilla via Icy Reins of Unity
- Calyrex Ice Rider (LEGENDARY)
- Calyrex Shadow Rider (LEGENDARY)

**deerling** - vanilla Deerling has all seasons; pure cosmetics
- Deerling Autumn (COMMON)
- Deerling Summer (COMMON)
- Deerling Winter (COMMON)

**deoxys** - vanilla Deoxys has all 4 formes
- Deoxys Attack (LEGENDARY)
- Deoxys Defense (LEGENDARY)
- Deoxys Speed (LEGENDARY)

**eevee** - vanilla Partner form
- Eevee Partner (COMMON)

**enamorus** - vanilla via Reveal Glass
- Enamorus Therian (RARE)

**flabebe blue** - vanilla Flabebe has all colors; cosmetic
- Flabebe Blue (COMMON)

**flabebe orange** - vanilla Flabebe has all colors; cosmetic
- Flabebe Orange (COMMON)

**flabebe white** - vanilla Flabebe has all colors; cosmetic
- Flabebe White (COMMON)

**flabebe yellow** - vanilla Flabebe has all colors; cosmetic
- Flabebe Yellow (COMMON)

**floette** - vanilla form, and an evolved stage on top
- Floette Eternal Flower (RARE)

**furfrou** - vanilla Furfrou has all trims; pure cosmetics
- Furfrou Dandy (RARE)
- Furfrou Debutante (RARE)
- Furfrou Diamond (RARE)
- Furfrou Heart (RARE)
- Furfrou Kabuki (RARE)
- Furfrou La Reine (RARE)
- Furfrou Matron (RARE)
- Furfrou Pharaoh (RARE)
- Furfrou Star (RARE)

**genesect** - vanilla Genesect swaps drives via form-change items
- Genesect Burn Drive (LEGENDARY)
- Genesect Chill Drive (LEGENDARY)
- Genesect Douse Drive (LEGENDARY)
- Genesect Shock Drive (LEGENDARY)

**gimmighoul** - vanilla form
- Gimmighoul Roaming (COMMON)

**indeedee** - vanilla form
- Indeedee Female (RARE)

**keldeo** - vanilla form; cosmetic
- Keldeo Resolute (LEGENDARY)

**kyurem** - vanilla Kyurem fuses via DNA splicers
- Kyurem Black (LEGENDARY)
- Kyurem White (LEGENDARY)

**landorus** - vanilla via Reveal Glass
- Landorus Therian (LEGENDARY)

**magearna** - vanilla form; cosmetic
- Magearna Original (LEGENDARY)

**meowth** - vanilla form
- Meowth Partner (COMMON)

**ogerpon** - vanilla Ogerpon swaps masks via form-change items
- Ogerpon Cornerstone (EPIC)
- Ogerpon Hearthflame (EPIC)
- Ogerpon Wellspring Mask (EPIC)

**oricorio** - vanilla Oricorio has all 4 styles
- Oricorio Pau (RARE)
- Oricorio Pom Pom (RARE)
- Oricorio Sensu (RARE)

**pichu** - vanilla Spiky-eared form; cosmetic
- Pichu Spiky (COMMON)

**pikachu** - vanilla Pikachu has the cap/cosplay forms; pure cosmetics
- Pikachu Alola (COMMON)
- Pikachu Belle (COMMON)
- Pikachu Cosplay (COMMON)
- Pikachu Hoenn (COMMON)
- Pikachu Kalos (COMMON)
- Pikachu Kanto (COMMON)
- Pikachu Libre (COMMON)
- Pikachu Partner (COMMON)
- Pikachu Partner Cap (COMMON)
- Pikachu Ph D (COMMON)
- Pikachu Pop Star (COMMON)
- Pikachu Rock Star (COMMON)
- Pikachu Sinnoh (COMMON)
- Pikachu Unova (COMMON)
- Pikachu World (COMMON)

**pumpkaboo** - vanilla Pumpkaboo has all sizes
- Pumpkaboo Large (COMMON)
- Pumpkaboo Small (COMMON)
- Pumpkaboo Super (COMMON)

**rockruff** - vanilla form
- Rockruff Own Tempo (COMMON)

**rotom** - vanilla Rotom has all 5 appliance forms
- Rotom Fan (RARE)
- Rotom Frost (RARE)
- Rotom Heat (RARE)
- Rotom Mow (RARE)
- Rotom Wash (RARE)

**shaymin** - vanilla via Gracidea
- Shaymin Sky (LEGENDARY)

**shellos** - vanilla East Sea form; cosmetic
- Shellos East (COMMON)

**silvally** - vanilla Silvally changes type via the memories (form-change items)
- Silvally Bug (EPIC)
- Silvally Dark (EPIC)
- Silvally Dragon (EPIC)
- Silvally Electric (EPIC)
- Silvally Fairy (EPIC)
- Silvally Fighting (EPIC)
- Silvally Fire (EPIC)
- Silvally Flying (EPIC)
- Silvally Ghost (EPIC)
- Silvally Grass (EPIC)
- Silvally Ground (EPIC)
- Silvally Ice (EPIC)
- Silvally Poison (EPIC)
- Silvally Psychic (EPIC)
- Silvally Rock (EPIC)
- Silvally Steel (EPIC)
- Silvally Water (EPIC)

**sinistea** - vanilla form
- Sinistea Antique (COMMON)

**tatsugiri** - vanilla Tatsugiri has all 3 forms
- Tatsugiri Curly (RARE)
- Tatsugiri Droopy (RARE)
- Tatsugiri Stretchy (RARE)

**tauros** - vanilla Paldean Tauros has all 3 breeds
- Tauros Paldean Aqua Breed (RARE)
- Tauros Paldean Blaze Breed (RARE)
- Tauros Paldean Combat Breed (RARE)

**thundurus** - vanilla via Reveal Glass
- Thundurus Therian (EPIC)

**tornadus** - vanilla via Reveal Glass
- Tornadus Therian (EPIC)

**unown** - vanilla Unown has all 28 letter forms
- Unown B (COMMON)
- Unown C (COMMON)
- Unown D (COMMON)
- Unown E (COMMON)
- Unown Emark (COMMON)
- Unown F (COMMON)
- Unown G (COMMON)
- Unown H (COMMON)
- Unown I (COMMON)
- Unown J (COMMON)
- Unown K (COMMON)
- Unown L (COMMON)
- Unown M (COMMON)
- Unown N (COMMON)
- Unown O (COMMON)
- Unown P (COMMON)
- Unown Q (COMMON)
- Unown Qmark (COMMON)
- Unown R (COMMON)
- Unown S (COMMON)
- Unown T (COMMON)
- Unown U (COMMON)
- Unown V (COMMON)
- Unown W (COMMON)
- Unown X (COMMON)
- Unown Y (COMMON)
- Unown Z (COMMON)

**ursaluna** - vanilla has Bloodmoon Ursaluna as its own species, and it is an evolved stage
- Ursaluna Bloodmoon (RARE)

**zarude** - vanilla form; cosmetic
- Zarude Dada (EPIC)

**zygarde** - vanilla Zygarde has the 10%/50% formes
- Zygarde 10 (RARE)
- Zygarde 10 Power Construct (RARE)
- Zygarde 50 Power Construct (LEGENDARY)

## C. Kept (genuine ER content) - 118 entries
All Redux base forms, the new ER lines (Wispywaspy, Wooly Worm, the Iron paradox
series, Blizzard Maw, Corn Tyrant, Crag Hopper, Lumber Sloth (+ Engulfed),
Heracreus, Hippopotato, Kipmodo, Bubbleo, Blocli, Corm, Fogging, Marbeep,
Merrykarp, Kecleong, Solrock System, Polartic Bluemoon, ...), and ER customs
with their own kit that exist NOWHERE in vanilla:
- Unown Revelation (LEGENDARY)
- Mimikyu Apex (RARE)
- Darkrai Nightmare (LEGENDARY)
- Bewear Angry (LEGENDARY)
- Articuno Ex (LEGENDARY)
- Zapdos Ex (LEGENDARY)
- Moltres Ex (LEGENDARY)
- Dragonite Delivery (LEGENDARY)
- Kartana Fallen (LEGENDARY)
- Ash-Greninja (LEGENDARY)
- Clemont-Chesnaught (LEGENDARY)
- Serena-Delphox (LEGENDARY)
- Spectrier Cloud (RARE)
- Calyrex Cloud Rider (LEGENDARY)
- Wigglytuff Apex (RARE)
- Mawile Redux B (RARE)
- Flygon Redux B (EPIC)
- Sinistea Redux (COMMON)

## D. Flags / open questions for the maintainer
- Ash-Greninja: vanilla Greninja DOES have the Battle Bond form, but the ER one is
  part of the Kalos trainer-fusion trio (with Clemont-Chesnaught and Serena-Delphox).
  Kept by default - say the word and it goes with the dupes.
- Grotom + its 5 appliance variants (Drum/Fill/Glass/Kick/Roll, all RARE) are genuine
  ER customs, but each counts as its OWN family so the 6 of them get full weight each.
  Proposal: keep all 6 but make the family down-weighting treat them as one family
  (the family-key only recognizes vanilla name prefixes today).
- Removal scope: drop them from the EGG pool only, but KEEP the starter-cost
  registration for players who already own one (otherwise an owned Pikachu Libre
  vanishes from starter select). New players simply never hatch them again.

## E. Final maintainer decisions (implemented)
- Unown Revelation: REMOVED after all (vanilla Unown carries the schooling ability, so the mechanic stays reachable; only the one true Unown remains).
- Burmy Eterna: KEPT - it is a genuine ER custom legendary (AG cost 11), not a vanilla cloak; only Burmy Sandy/Trash were vanilla dupes.
- Ash-Greninja, Clemont-Chesnaught, Serena-Delphox: KEPT (Kalos fusion trio).
- Grotom family: KEPT, now down-weighted as ONE 6-form family.
- Removal scope: eggs AND starter select; shiny/variant/black-shiny/dex/candy progress compresses onto the vanilla base on save load (purely additive, idempotent, never touches the source save data).
- Final ban list: 161 entries (see er-egg-pool-bans.ts).
