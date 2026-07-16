# Type-nativization project (maintainer directive 2026-07-16) — START ONLY AFTER the fakemon branch is pushed to feat AND deployed to staging

## Core directive
1. Enumerate ALL Pokemon carrying a TYPE-GRANTING ability (the ER type-grant family: Aquatic, Grounded, Ice Age, Half Drake, Metallic, Phantom — and any other ability whose effect is "adds/becomes X type").
2. REMOVE the type-granting ability from each and instead give the mon the granted type NATIVELY (third type via the N-type static model from the fakemon branch).
3. The vacated ability slot is REPLACED by the per-mon ability in the maintainer's list below.
4. UI: types must display properly EVERYWHERE (starter select, pokedex/pokedex-page, summary, battle info, any type-rendering surface): triple + quadruple + up to SIX types must fit (six = current max, Primal Regigigas); design should degrade sanely toward a theoretical 18. Approach preference per maintainer: probably just shrink the icons so they fit; alternative compact representations acceptable if shrinking fails. MUST verify visually with render captures on ALL screens for 3/4/6-type mons (the static dex/starter 2-icon gap flagged in the fakemon branch gets closed by this).

## Replacement list (maintainer, verbatim intent; [?] = maintainer has NOT decided — flag, don't guess)
### Aquatic
- Dragalge -> Hydrate
- Dragalge Mega -> Waterborne (NEW composite: Hydrate + Adaptability)
### Grounded
- Dodrio -> Bruiser [?]
- Doduo -> Fighter [?]
- Archen -> Tectonize
- Kilozuna + Hariyama -> Fighting Spirit or Steelworker [?]
### Ice Age
- Clawtificer -> Overzealous or Fatal Precision [?]
### Half Drake
- Salazzle -> Minion Control
- Salazarus -> Corrosion
- Eternaburm -> UNDECIDED [?] ("man idk")
- Heracreus -> Draconize
- Heracreus Mega -> Dragonfruit (NEW composite: Draconize + Rough Skin)
- Dodrio R -> Tangled Feet
- Doduo R -> Tangled Feet
- Scizor R -> Draconize; Scizor R Mega -> Komodo (NEW composite: Draconize + Toxic/Envenom)
- Scyther R -> Draconize; Scyther R Mega -> Komodo
- Kleavor R -> Draconize; Kleavor R Mega -> Komodo
### Metallic
- Dhelmise -> Hydrate
- Plundertow -> Aquatic (note: keeps a type-grant? verify intent when mon lands)
- Dreadnaut -> Steelworker
- Necrozma -> Soul Eater
- Falinks Mega -> Voltron (NEW composite: Steely Spirit + Battle Armor)
- Toxtricity R Male -> Loud Bang or Steely Spirit [?]
- Mega Krookodile -> Steely Spirit or Magnet Pull [?]
### Phantom
- Parasect -> Jumpscare
- Gardevoir R -> Grim Jab (NEW bespoke: Normal-type Drill moves become Ghost, 1.2x boost)
- Gardevoir R Mega -> Grievous Spear (NEW composite: Grim Jab + Savage Spear [NEW bespoke: Horn moves hit twice, 1x then 0.4x])
- Selenumbra + pre-evos -> Serene Grace; Selenumbra only: Levitate -> Spectacle (NEW composite: Levitate + Illuminate)
- Toxtricity R Female -> Heavy Metal
- Phanfernal -> Alluring Skull (NEW bespoke: draws in + immune to Ghost moves, raises highest Atk +1 — Lightning-Rod-for-Ghost shape)
- Rotoms -> Overcharge
- Crobat Mega -> Ominous Shroud (NEW composite: Shadow Shield + Foggy Eye)
- Cacjack -> Ominous Shroud

### Fairy Tale
- Iron Voca -> Rock Head/Steel Barrel (POSSIBLY trade it for Pixie Power to make Pixie Power the Innate) [? maintainer leaning noted, confirm before applying]
### Lightning Born
- Weezing R -> Generator or Electromorphosis [?]
### Bruiser (the type-grant "Bruiser" category; distinct from the Dodrio "Bruiser?" entry above)
- Spindaze -> Formless Fist (NEW: Raging Boxer but using the holder's highest Atk stat)
### Rocky Exterior
- Rexcadrill -> Rock Armor REWORKED into Prickly Armor (NEW composite/bespoke: Sharp Edge + 10% damage reduction)
- Sneasler Mega -> Free Climb (NEW composite: Unburden + Mountaineer), THEN replace the Mountaineer constituent with Hyper Aggressive (i.e. final Free Climb = Unburden + Hyper Aggressive)

(Maintainer: "the rest btw" — this completes the list.)

## RESOLUTIONS (maintainer 2026-07-16 follow-up)
- ALL [?] entries resolved: give the FIRST/named option. Dodrio -> Bruiser; Doduo -> Fighter; Kilozuna + Hariyama -> Fighting Spirit; Clawtificer -> Overzealous; **Eternaburm -> Pressure** (explicit); Toxtricity R Male -> Loud Bang; Mega Krookodile -> Steely Spirit; Iron Voca -> Rock Head/Steel Barrel (no Pixie Power trade); Weezing R -> Generator.
- EXISTENCE VERIFIED in er-species.ts: Kilozuna, Selenumbra, Salazarus, Heracreus, Phanfernal, Plundertow, Dreadnaut, Cacjack, Spindaze, Rexcadrill, Clawtificer ALL EXIST. "R" forms = Redux forms (exist). Rotom forms exist. ONLY Eternaburm is NOT a registered species (appears only as a flavor comment in overgrown-temple-encounter.ts:109) — its Pressure entry stays tracked until the mon exists or the maintainer supplies its dex name.
- The sweep therefore applies to (nearly) the WHOLE list now, not a subset.
- UI mandate reiterated: must be rendered + visually verified on every screen; no overflow/awkward layouts; scale well but stay readable; be creative to make all types visible.
- Regitube icon: downscaled front sprite is the FINAL approach (Redux-mon precedent), not a temporary placeholder.

## SMALL CHANGES (maintainer 2026-07-16, second follow-up)
- **Archen -> Aerilate** (supersedes the earlier Tectonize entry).
- **Marowak: replace Ill Will with Alluring Skull** (kit change; flavor fit).
- **Duskull: replace Pickpocket with Alluring Skull** (maintainer said "possibly" — apply, mark as tentative in the report so it's cheap to revert).
- **Dusknoir: replace Iron Fist with Alluring Skull** (same tentative-apply treatment).
(Alluring Skull = the NEW bespoke from the Phantom section: draws in + immune to Ghost moves, +1 highest Atk on absorb — Lightning-Rod-for-Ghost shape; now carried by Phanfernal, Marowak, tentatively Duskull + Dusknoir.)

## Notes
- Many list entries are FUTURE newcomer mons not yet in the game (Kilozuna, Clawtificer, Salazarus, Eternaburm, Heracreus, Selenumbra, Phanfernal, Plundertow, Dreadnaut, Cacjack, the R-forms, Falinks/Crobat/Krookodile megas, Toxtricity R M/F): their entries apply when those mons land; for the type-nativization sweep, apply to mons that EXIST at sweep time and keep the rest as a tracked table.
- NEW composites/bespokes to build in this project: Waterborne, Dragonfruit, Komodo, Voltron, Grim Jab, Grievous Spear (+ Savage Spear), Spectacle, Alluring Skull, Ominous Shroud.
- The sweep must be data-driven: derive the affected-mon list from the ability definitions (which mons carry the type-grant family), not hand-enumeration; convert granted type -> native extraTypes; replace slot per list; flag every mon that has a type-grant ability but NO list entry.
