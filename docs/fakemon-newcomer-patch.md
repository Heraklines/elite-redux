# Fakemon forms/mons implementation spec (maintainer message 2026-07-15)

## MAINTAINER DECISIONS (2026-07-15 follow-up):
- Name = **Tentalect** (one L; not Tentaking/Tentallect; rename asset keys accordingly).
- Skarmory mega letter = **Y** confirmed.
- **Discupid = Luvdisc evolution at Lv 50** (Luvdisc -> Discupid).
- Mega Jumpluff: innates = Tangled Seed / Common Root / Dandelion Burst (as implemented); ACTIVE = **Gale Bloom** (NEW composite: Air Blower + Harukaze) — add to new-composites list.
- **Mega Minun + Mega Plusle: UN-HELD (kits delivered 2026-07-15)** — implement them:
  - Mega Minun: Active Transistor / Closed Circuit (5924) / Lightning Rod. Innates: Minus, Synchronized Current (5921), Negative Feedback (5923). Electric/Fairy, 60/125/95/55/85/125, stone Minunite.
  - Mega Plusle: Active Pretty Privilege / Closed Circuit (5924) / Friend Guard. Innates: Plus, Synchronized Current (5921), Positive Feedback (5922). Electric/Fairy, 60/55/95/115/105/115, stone Plusleite.
  - Verify Transistor + Pretty Privilege exist in the codebase (report if missing).
  - SYNCHRONIZED CURRENT ADDITION (2026-07-15): keep the paralysis effect (Plus/Minus-aligned ally condition) AND add, alignment-UNRELATED (any ally): if holder + ally BOTH attack in a turn, both attacks +25%; if NEITHER attacks, both heal 1/4 max HP at end of turn. Description + detailed description must reflect all three clauses.
- Regitube animated front+back sprites come from the NDS ROM hack "Pokemon - Regitube Version" (by RetroNC), extracted at scratchpad/regitube-rar/ (password used: iwatchedthevideo; base game Pokemon Black IRBO). Extract via the #433 BW pipeline.

Source: maintainer Discord paste. Implement AFTER ability Batch 4 completes, on feat/fakemon-abilities.
General rules: evolutions evolve at LEVEL 50 from the stated pre-evo (unless a level is given inline);
megas reachable via mega stones found like other mega forms (#207/#318/#359 infra); form items for primals.
Assets at C:\Users\Hafida\Downloads\assets (37 files) — animate what has animation frames, wire shinies where provided.

## 1. Mega Hydreigon X — "Brutal Pokemon"
- Typing: Dark/Dragon. Stats 92/165/123/115/90/115.
- Active: Strong Jaw. Innates: Hydrapex (5931), Draconic Voodoo (5930), First Serpent (NEW composite: Sidewinder + World Serpent).
- Stone: Hydreigonite X. Asset: Mega_hydreigon_x_sheet.webp (slice).

## 2. Regitube — "Inflatable Pokemon"
- Typing: Water. Stats 200/50/100/80/100/50.
- Active: Sea Guardian / Drizzle / Aftermath. Innates: Pressure Vessel (5914; maintainer: "ranges could be altered a bit" — keep linear scale, tunable), Rain Pump (5915), Life Preserver (5916).
- Evolution line: NOT STATED (standalone new species? Regi legendary?) — FLAGGED to maintainer.
- Asset: regitube_front.webp ONLY (no back/icon/shiny) — FLAGGED.

## 3. Primal Regigigas — "Gargantuan Pokemon"
- Typing: Normal/Rock/Ice/Steel/Electric/Dragon (SIX types — N-type substrate from B2). (Water was removed per maintainer directive 2026-07-22 — no longer native.) This is the N-type UI stress case, and each non-Normal type is a REMOVABLE type for World in Pieces (five removable types here; every non-Normal type is removable).
- Stats 140/170/145/70/145/100.
- Active: Predator / Stall / Raging Boxer. Innates: Titan (NEW composite: Impenetrable + Relic Stone), World in Pieces (5917), Self Repair.
- Reachable: Regigigas + Planetary Orb (NEW item, primal-reversion style).
- Asset: primal_regigigas_front_back_sheet_plusshinyvariations.webp (slice, shiny variants included).

## 4. Mega Xerneas
- Typing: Fairy. Stats 126/151/125/151/128/99.
- Active: Limber. Innates: Quickening Grace (5913), Cleansing Light (5912), Pure Good (NEW composite: Fairy Aura + Soul-Heart).
- Stone: Xerneasite. Asset: mega_xerneas_sheet.webp (slice).

## 5. Mega Shuckle Y — "Mold Pokemon"
- Typing: Bug/Psychic. Stats 50/50/200/130/200/20.
- Active: Battle Armor / Coward / Self Repair. Innates: Borrowed Time (5910), Relativity (5911), Slime Mold.
- Stone: Shucklite Y. Asset: mega_shuckle_y_sheet.webp (slice).

## 6. Primal Mew — "New Species Pokemon"
- Typing: Psychic. Stats 100/110/130/110/130/120.
- Active: Bad Splice (5932). Innates: Shattered Psyche (PARKED — not implemented; leave slot empty or placeholder per maintainer confirm), Brain Food (NEW composite: Arcane Force + Soul Eater), Genesis Supernova (NEW bespoke: Psychic moves summon Psychic Surge/psychic terrain).
- Reachable: Mew + Embryonic Orb (NEW item).
- Asset: primal_mew_sheet_front_back_shinyvariation.webp (slice, shiny included).

## 7. Mega Dragonite Z — "Dragon Pokemon"
- Typing: Dragon/Flying/Steel (triple). Stats 91/144/144/110/110/101.
- Active: Chivalry (5909) / Mega Drill / Stamina. Innates: Weighted Scales (NEW composite: Steelworker + Multiscale), Knight's Honor (NEW: Def/SpDef version of King's Wrath), Power Core.
- Stone: Dragonite Z stone (naming per existing X/Y stone convention). Asset: mega_dragonite_z_{front,back,icon}.webp.

## 8. Astoot — "Wise Owl Pokemon" (alternate Hoothoot evo)
- Typing: Psychic/Flying. Stats 105/60/52/110/140/65.
- Evolution: Hoothoot (Lv 20) -> Noctowl (Lv 50) -> Astoot (BRANCHED evo on Noctowl at 50; branched-evo picker #240 infra).
- Active: Mystic Power / Headstrong / Air Blower. Innates: Library (5928), Brainpower (NEW composite: Emanate + Insomnia), Familiar (NEW composite: Majestic Bird + Archmage).
- SIDE CHANGE: Remove Emanate from Phantowl, replace with Spectralize.
- Asset: astoot_back.webp, Astoot_front.webp, astoot_icon.webp (no shiny — FLAGGED).

## 9. Mega Skarmory Y (kit heading said "Z" but stats block "Mega scamory Y" + assets "mega_scam_y_*" → Y; FLAGGED) — "Armor Bird Pokemon"
- Typing: Steel/Flying/Dragon (triple). Stats 75/135/70/135/70/110.
- Active: Light Metal / Power Edge / Keen Edge. Innates: Crosscut (5908), Elude, Puncture (NEW composite: Deep Cuts + Pinnacle Blade).
- Stone: Skarmorite Y. Assets: mega_scam_y_{front,back,icon}.webp.

## 10. Mega Parasect
- Typing: Bug/Grass/Ghost (triple). Stats 80/120/145/80/170/20.
- Active: Spore Bed (5902) / Shadow Tag / On the Prowl. Innates: Decomposer, Mycelial Network (5905), Last Host (5906).
- ALSO: give it Leaf Blade (learnset addition).
- Stone: Parasectite. Assets: mega_parasect_{front,back,icon}.webp.

## 11. Mega Electivire X — "Thunderbolt Pokemon"
- Typing: Electric/Dark/Ground (triple; "(Ground)" in stats block). Stats 95/163/107/85/130/60.
- Active: Gorilla Tactics / Raging Boxer / Stygian Rush. Innates: Overloaded (5927), Capacitor Bank (5925), Fault Current (5926).
- Stone: Electivirite X. Assets: "Electivire Mega X_*" front/back/icon + shiny front (png!) + shiny icon + back shiny.

## 12. Tentaking (kit said "Tentallect/Tentaking"; assets say tentaking → Tentaking; FLAGGED) — "Poisoned Mind Pokemon"
- Typing: Water/Poison/Psychic (triple). Stats 110/70/75/110/130/105.
- Evolution: Tentacool (Lv 30) -> Tentacruel (Lv 50) -> Tentaking.
- Active: Corrosion / Predator / Toxic Chain. Innates: Puppet Strings (5901), Minion Control, Corrupted Mind.
- Assets: tentaking_480x480.gif (ANIMATED, needs downscale to sprite res), tentaking_back_64x64.webp, tentaking_icon_32x64.webp, tentaking_cry.wav (CRY — wire it).

## 13. Mega Minun — "Cheering Pokemon"
- Typing: Electric/Fairy. Stats 60/125/95/55/85/125 (physical attacker).
- Stone: Minunite. Kit (from ability pitch): innates Synchronized Current (5921) + Negative Feedback (5923); choice/active Closed Circuit (5924). FULL active pool NOT stated — FLAGGED (default: keep base Minun actives + Closed Circuit).
- Asset: Mega_minun_and_plusle_front_back_icon_sheet.webp (shared sheet, slice).

## 14. Mega Plusle — "Cheering Pokemon"
- Typing: Electric/Fairy. Stats 60/55/95/115/105/115 (special attacker).
- Stone: Plusleite. Innates: Synchronized Current (5921) + Positive Feedback (5922); Closed Circuit (5924) active. Same FLAG as Minun.
- Asset: shared sheet above.

## 15. Mega Jumpluff (Blizzard's concept)
- Typing: Grass/Flying/Fairy (triple). Stats 75/115/90/100/105/150.
- Innates: Tangled Seed (5903), Common Root (5904), Dandelion Burst (5907) (from ability pitch). Active pool NOT stated — FLAGGED (default: inherit Jumpluff actives).
- Stone: Jumpluffite. Assets: mega_jumpluff_animated.gif (ANIMATED front), mega_jumpluff_back_animated.gif, mega_jumpluff_icon.webp.

## 16. Discupid — "Rendezvous Pokemon"
- Typing: Water/Fairy. Stats 90/70/80/90/75/122 (BST 527).
- Active: Power Spot / Rainbow Fish (NEW composite: Swift Swim + Marvel Scale) / Friend Guard. Innates: Soulmate (5918), Rendezvous (5919), Heartbreak (5920).
- Evolution line: NOT STATED (standalone new species?) — FLAGGED.
- Assets: discupid_{front,back,icon}.webp + discupid_front_shiny.webp + discupid_shiny_back.webp.

## 17. PARTNER EEVEE + PARTNER EEVEELUTIONS (maintainer directive 2026-07-15, CORRECTED):
- Create PARTNER variants of Eevee's eeveelutions (distinct from base eeveelutions, which must be COMPLETELY unaffected).
- Each partner eeveelution keeps the EXACT same ability kit as its base eeveelution — NO innate is removed. Omniform (5929) is GRAFTED ON TOP of one existing innate: that innate becomes a COMPOSITE of [original innate + Omniform] via the composite-ability infra (constituents both fully active, constituent detailed descriptions shown). One-delta clones where the delta is the graft, not a swap.
- This requires deduping/cloning the eeveelution ability sets so partner variants can carry a distinct innate list.
- Partner Eevee itself also carries Omniform. Register the production Omniform mappings: partner Eevee + each partner eeveelution -> { move type -> the matching partner eeveelution } so the omniform chains across the whole partner family (Water->partner Vaporeon, Electric->partner Jolteon, Fire->partner Flareon, Psychic->partner Espeon, Dark->partner Umbreon, Grass->partner Leafeon, Ice->partner Glaceon, Fairy->partner Sylveon).
- Movesets per form: auto-derived level-appropriate sets (Omniform default) until the curation UI lands.

## NEW composites/bespokes to build (ability work remaining beyond batches 1-4):
First Serpent (Sidewinder+World Serpent), Titan (Impenetrable+Relic Stone), Pure Good (Fairy Aura+Soul-Heart),
Brain Food (Arcane Force+Soul Eater), Genesis Supernova (Psychic moves summon Psychic Surge — bespoke),
Weighted Scales (Steelworker+Multiscale), Knight's Honor (Def/SpDef King's Wrath variant),
Brainpower (Emanate+Insomnia), Familiar (Majestic Bird+Archmage), Puncture (Deep Cuts+Pinnacle Blade),
Rainbow Fish (Swift Swim+Marvel Scale). Composite infra: #130/#127 constituent-invoking pattern.
Verify existence of: Sea Guardian, Mega Drill, Power Core, Slime Mold, Coward, Self Repair, Predator, Stall,
Elude, Power Edge, Mystic Power, Headstrong, Corrupted Mind, Spectralize, On the Prowl, Decomposer, Stygian Rush.

## NEW items: Planetary Orb (Regigigas primal), Embryonic Orb (Mew primal), mega stones:
Hydreigonite X, Xerneasite, Shucklite Y, Dragonite-Z stone, Skarmorite Y, Parasectite, Electivirite X,
Minunite, Plusleite, Jumpluffite. All must spawn/be findable like other mega stones (#207/#318/#359).

## Asset gaps flagged to maintainer:
- Regitube: front only (no back, icon, shiny).
- Astoot: no shiny.
- Tentaking front is a 480x480 gif (needs downscale); has a CRY wav (wire cries).
- Several sheets need slicing (hydreigon, shuckle, xerneas, mew, regigigas, minun+plusle shared).
