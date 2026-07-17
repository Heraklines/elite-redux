# Type-nativization holder report (Pass A, derived)

Data-driven enumeration of every species/form carrying an ER type-grant ability
(the 10 sweep categories + the Rock Armor rework), the native 3rd type it receives,
and the replacement ability applied to the vacated slot. Derived from `er-species.ts`
base data (abilities + innates + forms). None of these holders are overridden in
`er-species-abilities.json`, so base data == live holder set.

Legend: **[spec]** = maintainer's explicit list; **[NM]** = NEEDS-MAINTAINER-ENTRY
(no list entry; sensible existing ability picked + documented); **(NEW)** = ability
built in this project.

Counts: 63 type-grant holders swept across 11 categories; 25 NEEDS-MAINTAINER; 2 small-change swaps.


## Aquatic  (grant `AQUATIC` -> native `WATER`)

| Species / form | Native type | Replacement | Source |
|---|---|---|---|
| `SPECIES_DRAGALGE` | Water | Hydrate | [spec]  |
| `SPECIES_TYNAMO` | Water | Levitate | [NM] Eelektross-line signature ability. |
| `SPECIES_EELEKTRIK` | Water | Levitate | [NM] Eelektross-line signature ability. |
| `SPECIES_STUNFISK` | Water | Static | [NM] Stunfisk native ability. |

## Grounded  (grant `GROUNDED` -> native `GROUND`)

| Species / form | Native type | Replacement | Source |
|---|---|---|---|
| `SPECIES_DODRIO` | Ground | Bruiser | [spec] [?] resolved to first option. |
| `SPECIES_DODUO` | Ground | Fighter | [spec] [?] resolved to first option. |
| `SPECIES_ARCHEN` | Ground | Aerilate | [spec] SMALL CHANGES supersedes Tectonize. |
| `SPECIES_KILOZUNA` | Ground | Fighting Spirit | [spec] Kilozuna + Hariyama. |
| `SPECIES_KILOZUNA_MEGA` (mega form) | Ground | Fighting Spirit | [spec] Mega of Kilozuna. |
| `SPECIES_HARIYAMA_REDUX` | Ground | Fighting Spirit | [spec] Kilozuna + Hariyama. |
| `SPECIES_TURTWIG` | Ground | Shell Armor | [NM] Turtwig line. |
| `SPECIES_GROTLE` | Ground | Shell Armor | [NM] Turtwig line. |
| `SPECIES_SKORUPI` | Ground | Battle Armor | [NM] Skorupi native ability. |
| `SPECIES_ORTHWORM` | Ground | Sand Veil | [NM] Orthworm hidden ability. |

## Ice Age  (grant `ICE_AGE` -> native `ICE`)

| Species / form | Native type | Replacement | Source |
|---|---|---|---|
| `SPECIES_CLAWITZER_REDUX` | Ice | Overzealous | [spec] Clawtificer = Clawitzer Redux; [?] first option. |

## Half Drake  (grant `HALF_DRAKE` -> native `DRAGON`)

| Species / form | Native type | Replacement | Source |
|---|---|---|---|
| `SPECIES_SALAZZLE` | Dragon | Minion Control | [spec]  |
| `SPECIES_SALAZARUS` | Dragon | Corrosion | [spec]  |
| `SPECIES_HERACREUS` | Dragon | Draconize | [spec]  |
| `SPECIES_DODUO_REDUX` | Dragon | Tangled Feet | [spec] Doduo R. |
| `SPECIES_DODRIO_REDUX` | Dragon | Tangled Feet | [spec] Dodrio R. |
| `SPECIES_SCIZOR_REDUX` | Dragon | Draconize | [spec] Scizor R (Mega -> Komodo tracked). |
| `SPECIES_SCYTHER_REDUX` | Dragon | Draconize | [spec] Scyther R (Mega -> Komodo tracked). |
| `SPECIES_KLEAVOR_REDUX` | Dragon | Draconize | [spec] Kleavor R (Mega -> Komodo tracked). |
| `SPECIES_SKRELP` | Dragon | Hydrate | [NM] Dragalge pre-evo; matches Dragalge. |
| `SPECIES_SALANDIT` | Dragon | Minion Control | [NM] Salazzle pre-evo; matches Salazzle. |
| `SPECIES_CHARMANDER` | Dragon | Solar Power | [NM] Charizard line hidden ability. |
| `SPECIES_CHARMELEON` | Dragon | Solar Power | [NM] Charizard line hidden ability. |
| `SPECIES_BURMY_ETERNA` | Dragon | Pressure | [NM] Pre-evo of tracked-only Eternaburm; Pressure matches evo intent. |

## Metallic  (grant `METALLIC` -> native `STEEL`)

| Species / form | Native type | Replacement | Source |
|---|---|---|---|
| `SPECIES_DHELMISE` | Steel | Hydrate | [spec]  |
| `SPECIES_PLUNDERTOW` | Steel | Aquatic | [spec] KEEPS a type-grant (Water) per maintainer; flagged. |
| `SPECIES_DREADNAUT` | Steel | Steelworker | [spec]  |
| `SPECIES_NECROZMA` | Steel | Soul Eater | [spec]  |
| `SPECIES_TOXTRICITY_REDUX` | Steel | Loud Bang | [spec] Toxtricity R Male; [?] first option. |
| `SPECIES_TOXTRICITY_REDUX_MEGA` (mega form) | Steel | Loud Bang | [spec] Mega of Toxtricity R Male. |
| `SPECIES_FALINKS` | Steel | Battle Armor | [NM] Base Falinks; spec only addresses Falinks Mega -> Voltron. |
| `SPECIES_GURDURR` | Steel | Iron Fist | [NM] Gurdurr native ability. |
| `SPECIES_GIMMIGHOUL` | Steel | Run Away | [NM] Gimmighoul (chest). |
| `SPECIES_GIMMIGHOUL_ROAMING` | Steel | Run Away | [NM] Gimmighoul (roaming). |
| `SPECIES_CHINGLING` | Steel | Levitate | [NM] Chimecho line signature. |
| `SPECIES_WOOLY_WORM` | Steel | Shield Dust | [NM] Larva flavour. |

## Phantom  (grant `PHANTOM` -> native `GHOST`)

| Species / form | Native type | Replacement | Source |
|---|---|---|---|
| `SPECIES_PARASECT` | Ghost | Jumpscare | [spec]  |
| `SPECIES_GARDEVOIR_REDUX` | Ghost | Grim Jab (NEW) | [spec] Gardevoir R. |
| `SPECIES_GARDEVOIR_REDUX_MEGA` (mega form) | Ghost | Grievous Spear (NEW) | [spec] Gardevoir R Mega. |
| `SPECIES_SELENUMBRA` | Ghost | Lunar Affinity | [spec] Maintainer 2026-07-17: Lunar Affinity (was Serene Grace; Selenumbra already carries Sheer Force, which conflicts with Serene Grace). Also Levitate -> Spectacle. |
| `SPECIES_TOXTRICITY_REDUX_FUZZ` | Ghost | Heavy Metal | [spec] Toxtricity R Female. |
| `SPECIES_TOXTRICITY_REDUX_FUZZ_MEGA` (mega form) | Ghost | Heavy Metal | [spec] Mega of Toxtricity R Female. |
| `SPECIES_PHANFERNAL` | Ghost | Alluring Skull (NEW) | [spec]  |
| `SPECIES_ROTOM_HEAT` | Ghost | Overcharge | [spec] Rotom appliance form. |
| `SPECIES_ROTOM_WASH` | Ghost | Overcharge | [spec] Rotom appliance form. |
| `SPECIES_ROTOM_FROST` | Ghost | Overcharge | [spec] Rotom appliance form. |
| `SPECIES_ROTOM_FAN` | Ghost | Overcharge | [spec] Rotom appliance form. |
| `SPECIES_ROTOM_MOW` | Ghost | Overcharge | [spec] Rotom appliance form. |
| `SPECIES_SOLROCK_SYSTEM` | Ghost | Levitate | [NM] Solrock signature. |
| `SPECIES_LARVESTA_REDUX` | Ghost | Flame Body | [NM] Larvesta line. |
| `SPECIES_VOLCARONA_REDUX` | Ghost | Serene Grace | [spec] Maintainer 2026-07-17: Serene Grace (was Flame Body). |
| `SPECIES_BELLSPROUT_REDUX` | Ghost | Chlorophyll | [NM] Bellsprout line. |

## Fairy Tale  (grant `FAIRY_TALE` -> native `FAIRY`)

| Species / form | Native type | Replacement | Source |
|---|---|---|---|
| `SPECIES_IRON_VOCA` | Fairy | Steel Barrel | [spec] Rock Head/Steel Barrel -> Steel Barrel (Rock Head alt noted). |

## Lightning Born  (grant `LIGHTNING_BORN` -> native `ELECTRIC`)

| Species / form | Native type | Replacement | Source |
|---|---|---|---|
| `SPECIES_BREEZING` | Electric | Generator | [NM] Weezing R line -> Generator per maintainer intent. |
| `SPECIES_STORMING` | Electric | Generator | [NM] Weezing R line -> Generator per maintainer intent. |

## Bruiser  (grant `BRUISER` -> native `FIGHTING`)

| Species / form | Native type | Replacement | Source |
|---|---|---|---|
| `SPECIES_SPINDAZE` | Fighting | Formless Fist (NEW) | [spec]  |

## Rocky Exterior  (grant `ROCKY_EXTERIOR` -> native `ROCK`)

| Species / form | Native type | Replacement | Source |
|---|---|---|---|
| `SPECIES_SNEASLER_MEGA` (mega form) | Rock | Free Climb (NEW) | [spec] Maintainer 2026-07-17: Free Climb ("Free Form") = Unburden + Mountaineer (was Unburden + Hyper Aggressive); the freed Mountaineer innate slot (innate 3) becomes Hyper Aggressive. Net: Mountaineer and Hyper Aggressive swap between the composite and innate 3. |
| `SPECIES_EXCADRILL_REDUX` | Rock | Prickly Armor (NEW) | [NM] Excadrill Redux (distinct from Rexcadrill; carries Rocky Exterior); Prickly Armor to match rework. Position-remap parse initially missed it - found by the sweep-integrity test. |

## Rock Armor rework  (grant `ROCK_ARMOR` -> native `ROCK`)

| Species / form | Native type | Replacement | Source |
|---|---|---|---|
| `SPECIES_REXCADRILL` | Rock | Prickly Armor (NEW) | [spec] Rock Armor reworked into Prickly Armor; Rock nativized. |

## SMALL CHANGES (pure ability swaps, no type nativization)

| Species | Swap | Source |
|---|---|---|
| `SPECIES_DUSKULL` | Pickpocket -> Alluring Skull | [tentative] Maintainer said possibly; tentative. |
| `SPECIES_DUSKNOIR` | Iron Fist -> Alluring Skull | [tentative] Maintainer tentative. |

## Out of sweep scope (documented)

- **Dragonfly (ErAbilityId `DRAGONFLY`, id 5050)** grants Dragon type BUT is NOT one of
  the 10 sweep categories: it bundles a Ground-immunity + Float rider. Holders
  (Vibrava, Flygon, Flygon Mega, Vibrava R, Flygon R, Flygon R Mega) are LEFT INTACT.
  Nativizing the type alone would silently drop the Ground-immunity rider. Pending a
  maintainer decision (a lost-rider case).
- **Type-grant abilities with riders that also add a type** (Aquatic Dweller/Water x1.5,
  Hover, Fey Flight, Komodo id 851, Dead Bark, Lightsaber) are ALSO left intact for the
  same reason; none are among the maintainer's 10 named categories.

## Tracked-only (future mons / no current holder)

- **Eternaburm -> Pressure**: not a registered species (flavor comment only). Its
  existing pre-evo Burmy Eterna is swept (see Half Drake, applied Pressure).
- **Dragalge Mega -> Waterborne**, **Heracreus Mega -> Dragonfruit**, **Scizor/Scyther/
  Kleavor R Mega -> Komodo**, **Falinks Mega -> Voltron**, **Mega Krookodile -> Steely
  Spirit**, **Crobat Mega -> Ominous Shroud**: mega forms not present as type-grant
  holders at sweep time; the abilities ARE built and ready. Applied when the mons land.
  - **Maintainer 2026-07-17 constituent corrections (BEHAVIOR + description, DONE).**
    The mega forms carry the DRAFT composite abilities in their innate slots (Heracreus
    Mega = draft Dragonfruit id 918/live 5619; Scizor/Scyther/Kleavor R Mega = draft
    Komodo id 851/live 5552; Crobat Mega = draft Ominous Shroud 822/5523; Dragalge Mega
    = draft Waterborne 990/5689). Those draft composites still type-granted (Aquatic/
    Half-Drake/Phantom) at the ATTR level, which violated the epic. Nativized in place so
    every holder is fixed uniformly:
    - `er-composite-parts.ts` `composite-vanilla-mashup` rows: 990 Aquatic(294)->Hydrate(315),
      918 Half-Drake(310)->Draconize(413), 822 Phantom(324)->Foggy Eye(967).
    - `archetype-dispatcher.ts` bespoke case 851 (Komodo): the `EntryEffectAbAttr`
      `add-self-type DRAGON` (Half-Drake) replaced by Draconize's TypeConversion + Dragon
      STAB + Dragon-vs-Fairy override; the poison kept (aligned to regular Poison/Envenom).
    Final composition (behavior AND display now match): Waterborne = **Hydrate** +
    Adaptability, Dragonfruit = **Draconize** + Rough Skin, Komodo = **Draconize** +
    Envenom, Ominous Shroud = **Foggy Eye** + Shadow Shield. Verified via attr probe:
    NO `add-self-type` `EntryEffectAbAttr` is reachable from any of the six live mega
    holders (Dragalge/Heracreus/Scizor/Scyther/Kleavor/Crobat Mega). The separate MANUAL
    composites (5955/5956/5957/5961) already encoded the same and remain as ready spares.
- **Cacjack -> Ominous Shroud**: Cacjack carries NO type-grant in current data; tracked.
- **Marowak: Ill Will -> Alluring Skull**: Marowak carries "Bone Zone" (5091), NOT "Ill Will" (5285)
  in current data - the named ability is absent, so NOT applied (tracked pending maintainer clarification).
