/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — hand-audited egg moves for ER-custom species.
//
// PokeRogue's `speciesEggMoves` only covers vanilla species, so the ~331
// egg-able ER-custom BASE species (id >= 10000; evolutions inherit from their
// base) had no egg moves at all. This table supplies 4 per species, picked the
// way PokeRogue's own CD egg moves are: STRONG moves that fit (or meaningfully
// expand) the species' role and that it CANNOT already learn — judged per
// species from its typing, base-stat spread, abilities + ER innates, evolution,
// and existing movepool. See `docs/plans/er-egg-moves-worktable.md` for the kit
// of every species; the one-line rationale on each entry records the reasoning.
//
// Keyed by ER `speciesConst`; resolved to the pokerogue species id at init by
// `init-elite-redux-egg-moves.ts`. Standard PokeRogue moves are used by default,
// with the occasional ER custom move when it clearly fits.
// =============================================================================

import { MoveId } from "#enums/move-id";

/** ER base species (by speciesConst) → its 4 hand-audited egg moves. */
export const ER_EGG_MOVES: Readonly<Record<string, readonly [MoveId, MoveId, MoveId, MoveId]>> = {
  // --- Batch 1 ---------------------------------------------------------------

  // Corm — Grass pre-evo (→ Cormoth the moth / Popcorm), Chlorophyll + Harvest +
  // Grass Pelt. Quiver Dance turns the moth line into a special sweeper; Spore is
  // the premier powder; Strength Sap leans on its bulk; Leaf Storm is the nuke.
  SPECIES_CORM: [MoveId.QUIVER_DANCE, MoveId.SPORE, MoveId.STRENGTH_SAP, MoveId.LEAF_STORM],

  // Blizzard Maw — bulky physical Ice/Dark biter with Growing Tooth (Strong Jaw).
  // Psychic/Fire Fang give boosted biting coverage, Swords Dance sets up the slow
  // breaker, Slack Off gives the recovery its bulk wants (it only had Rest).
  SPECIES_BLIZZARD_MAW: [MoveId.SWORDS_DANCE, MoveId.PSYCHIC_FANGS, MoveId.FIRE_FANG, MoveId.SLACK_OFF],

  // Lumber Sloth — bulky physical Fire/Grass with Tough Claws (contact boost).
  // Horn Leech + Drain Punch are recovery contact STAB/coverage, Bulk Up suits its
  // defenses, Knock Off is utility coverage (it already has Swords Dance).
  SPECIES_LUMBERING_SLOTH: [MoveId.HORN_LEECH, MoveId.DRAIN_PUNCH, MoveId.BULK_UP, MoveId.KNOCK_OFF],

  // Iron Carapace — fast special Electric/Steel with Megabite (biting moves use
  // SpAtk). Tail Glow is the special setup; Earth Power + Aura Sphere cover the
  // Steels/Ground that wall it; Psychic Fangs is special-via-Megabite coverage.
  SPECIES_IRON_CARAPACE: [MoveId.TAIL_GLOW, MoveId.EARTH_POWER, MoveId.AURA_SPHERE, MoveId.PSYCHIC_FANGS],

  // Marbeep — Bug pre-evo (→ Fluffbee, Bug/Fairy) with Compound Eyes. Quiver Dance
  // is the line's setup, Sleep Powder is 100%-accurate via Compound Eyes, Tail Glow
  // is an alt special boost, Air Slash is reliable flinch coverage.
  SPECIES_MARBEEP: [MoveId.QUIVER_DANCE, MoveId.SLEEP_POWDER, MoveId.TAIL_GLOW, MoveId.AIR_SLASH],

  // Bubbleo — physical Water/Poison pre-evo (→ Hydroar) with Moxie/Accelerate.
  // Gunk Shot + Liquidation are stronger STABs than its Poison Jab/Wave Crash,
  // Aqua Jet is the priority a snowballing sweeper wants, Spikes adds hazard utility.
  SPECIES_BUBBLEO: [MoveId.GUNK_SHOT, MoveId.LIQUIDATION, MoveId.AQUA_JET, MoveId.SPIKES],

  // Burmy Eterna — huge slow special Bug/Poison/Dragon tank (BST 1040) with
  // Dragon's Maw. Draco Meteor is a Maw-boosted nuke, Quiver Dance / Trick Room
  // are two ways to leverage its bulk+power, Earth Power is coverage.
  SPECIES_BURMY_ETERNA: [MoveId.DRACO_METEOR, MoveId.QUIVER_DANCE, MoveId.TRICK_ROOM, MoveId.EARTH_POWER],

  // Iron Voca — special sound attacker with Punk Rock + Amplifier. Boomburst is the
  // signature sound nuke; Sparkling Aria + Clanging Scales are boosted sound coverage;
  // Earth Power is its non-sound answer to Steels.
  SPECIES_IRON_VOCA: [MoveId.BOOMBURST, MoveId.SPARKLING_ARIA, MoveId.CLANGING_SCALES, MoveId.EARTH_POWER],

  // Crag Hopper — bulky slow physical Rock/Ground. Swords Dance + Trick Room are
  // the two setup routes for a slow tank, Body Press weaponises its high Def,
  // Stealth Rock is the hazard utility a Rock-type should carry.
  SPECIES_JAGGED_CHUNGULIS: [MoveId.SWORDS_DANCE, MoveId.BODY_PRESS, MoveId.STEALTH_ROCK, MoveId.TRICK_ROOM],

  // Iron Palette — slow special Normal/Psychic with Mega Launcher (pulse boost).
  // Aura Sphere / Dark Pulse / Dragon Pulse are all Launcher-boosted coverage pulses;
  // Trick Room turns its low Speed into an asset.
  SPECIES_IRON_PALETTE: [MoveId.AURA_SPHERE, MoveId.DARK_PULSE, MoveId.DRAGON_PULSE, MoveId.TRICK_ROOM],

  // --- Batch 2 ---------------------------------------------------------------

  // Wispywaspy — frail Bug/Ghost annoyer with Shadow Shield (full-HP guard).
  // A pure disruption kit: Destiny Bond + Will-O-Wisp punish switch-ins, while
  // Pain Split + Strength Sap keep it topped up to keep Shadow Shield online.
  SPECIES_WISPYWASPY: [MoveId.DESTINY_BOND, MoveId.WILL_O_WISP, MoveId.PAIN_SPLIT, MoveId.STRENGTH_SAP],

  // Iron Scythe — physical Poison/Ghost slasher with slicing-boost (Sweeping Edge /
  // Power Edge). All four are blades: Ceaseless Edge stacks Spikes, Sacred Sword
  // ignores boosts + hits Steel/Dark, Bitter Blade heals its frail Def, Shadow
  // Sneak is the priority a 98-Speed slasher wants.
  SPECIES_IRON_SCYTHE: [MoveId.CEASELESS_EDGE, MoveId.SACRED_SWORD, MoveId.BITTER_BLADE, MoveId.SHADOW_SNEAK],

  // Wooly Worm — huge bulky special Grass/Bug that sets its own sun (Drought).
  // Spore enables its slow setup; Weather Ball becomes a Fire nuke under its sun;
  // Earth Power answers the Fire/Steel/Poison that wall it; Strength Sap is bulk
  // recovery + an Atk drop (it already has Quiver Dance / Calm Mind).
  SPECIES_WOOLY_WORM: [MoveId.SPORE, MoveId.WEATHER_BALL, MoveId.EARTH_POWER, MoveId.STRENGTH_SAP],

  // Heracreus — physical Grass/Fairy horn-beetle with Serene Grace + Mighty Horn.
  // Iron Head + Zen Headbutt weaponise Serene Grace (flinch hax) AND cover Steel/
  // Poison; Dragon Dance leans on Half Drake for speed; Close Combat is the hard
  // coverage vs Steel (it already has Swords Dance / Megahorn / Horn Leech).
  SPECIES_HERACREUS: [MoveId.IRON_HEAD, MoveId.ZEN_HEADBUTT, MoveId.DRAGON_DANCE, MoveId.CLOSE_COMBAT],

  // Grotom — fast physical Poison (Spe 136) with Corrosion + Speed Force.
  // Swords Dance sweeps, Sucker Punch + First Impression give it priority off that
  // speed, Coil patches Gunk Shot's accuracy while adding bulk (it has Bulk Up but
  // not the accuracy boost). Corrosion already lets its Poison hit Steel.
  SPECIES_GROTOM: [MoveId.SWORDS_DANCE, MoveId.SUCKER_PUNCH, MoveId.FIRST_IMPRESSION, MoveId.COIL],

  // Blocli — slow defensive Normal block-wall (→ Bloxtack) with Friend Guard.
  // Iron Defense turns its Body Press into a real attack; Curse is the slow-tank
  // setup; Stealth Rock is hazard utility; Wish leverages its supportive Friend
  // Guard identity to keep the team alive.
  SPECIES_BLOCLI: [MoveId.IRON_DEFENSE, MoveId.CURSE, MoveId.STEALTH_ROCK, MoveId.WISH],

  // Hippopotato — bulky Grass/Ground Regenerator pivot (→ Hippotaton). Spore +
  // Knock Off + Stealth Rock make it a disruptive utility pivot, while Wood Hammer
  // is the payoff for the Belly Drum it already learns.
  SPECIES_HIPPOPOTATO: [MoveId.SPORE, MoveId.KNOCK_OFF, MoveId.STEALTH_ROCK, MoveId.WOOD_HAMMER],

  // Corn Tyrant — slow bulky physical Grass/Dragon (Atk/Def/HP 135). Earthquake is
  // the missing coverage vs Steel/Fire/Poison; Trick Room + Curse are two ways to
  // turn its dreadful Speed into a win condition; Horn Leech is recovery STAB
  // (it only had recoil Wood Hammer + Dragon Dance / Bulk Up).
  SPECIES_HARVESTING_TYRANT: [MoveId.EARTHQUAKE, MoveId.TRICK_ROOM, MoveId.CURSE, MoveId.HORN_LEECH],

  // Iron Spirals — bulky special Ground/Psychic tank. Calm Mind suits its twin
  // 114 defenses better than its native Nasty Plot, Stored Power becomes a snowball
  // win-con off those boosts, Recover gives longevity, Stealth Rock is utility.
  SPECIES_IRON_SPIRALS: [MoveId.CALM_MIND, MoveId.STORED_POWER, MoveId.RECOVER, MoveId.STEALTH_ROCK],

  // Iron Saber — bulky physical Grass/Electric dual-blade with Intimidate + slicing
  // boost (Dual Wield). Sacred Sword / Bitter Blade / Ceaseless Edge are all boosted
  // blades giving Fighting/Fire coverage + recovery + Spikes; Knock Off is utility
  // (it already has Swords Dance + Recover + priority Thunderclap).
  SPECIES_IRON_SABER: [MoveId.SACRED_SWORD, MoveId.BITTER_BLADE, MoveId.CEASELESS_EDGE, MoveId.KNOCK_OFF],

  // Pikachu Cosplay — fast Electric/Normal with Normalize (everything turns Normal).
  // Boomburst is the Normalize-friendly special nuke, Extreme Speed is strong Normal
  // priority, Belly Drum + ExtremeSpeed is a physical win-con, Tidy Up adds Atk+Spe
  // plus hazard control.
  SPECIES_PIKACHU_COSPLAY: [MoveId.BOOMBURST, MoveId.EXTREME_SPEED, MoveId.BELLY_DRUM, MoveId.TIDY_UP],

  // Pikachu Rock Star — fast mixed Electric/Steel with Steely Spirit (Steel boost) +
  // Rhythmic (sound). Steel Beam + Gigaton Hammer are Steely-Spirit-boosted nukes
  // (special / physical), Boomburst is the sound option, Extreme Speed is priority.
  SPECIES_PIKACHU_ROCK_STAR: [MoveId.STEEL_BEAM, MoveId.GIGATON_HAMMER, MoveId.BOOMBURST, MoveId.EXTREME_SPEED],

  // --- Batch 3: Pikachu cosplay / cap line ----------------------------------

  // Pikachu Belle — Electric/Ice with Refrigerate (Normal moves → boosted Ice).
  // Boomburst + Extreme Speed become an Ice nuke / Ice priority; Belly Drum sets up
  // the physical sweep; Tidy Up adds Atk+Spe and clears hazards.
  SPECIES_PIKACHU_BELLE: [MoveId.BOOMBURST, MoveId.EXTREME_SPEED, MoveId.BELLY_DRUM, MoveId.TIDY_UP],

  // Pikachu Pop Star — Electric/Fairy with Pixilate (Normal → boosted Fairy) +
  // Serene Grace. Boomburst + Extreme Speed turn into a Fairy nuke / Fairy priority,
  // Belly Drum enables the sweep, Air Slash abuses Serene Grace flinch + covers Grass/
  // Fighting.
  SPECIES_PIKACHU_POP_STAR: [MoveId.BOOMBURST, MoveId.EXTREME_SPEED, MoveId.BELLY_DRUM, MoveId.AIR_SLASH],

  // Pikachu PhD — Electric/Psychic special attacker with Tinted Lens (resisted hits
  // still bite). Tail Glow is the setup, Aura Sphere is reliable coverage that Tinted
  // Lens keeps relevant vs Dark, Stored Power is the boosted win-con, Earth Power
  // covers Steel/Electric.
  SPECIES_PIKACHU_PH_D: [MoveId.TAIL_GLOW, MoveId.AURA_SPHERE, MoveId.STORED_POWER, MoveId.EARTH_POWER],

  // Pikachu Libre — Electric/Fighting with No Guard. The whole kit weaponises it:
  // Dynamic Punch (guaranteed confuse), Thunder + Stone Edge (now 100% accurate),
  // plus Swords Dance to set up the physical sweep.
  SPECIES_PIKACHU_LIBRE: [MoveId.DYNAMIC_PUNCH, MoveId.THUNDER, MoveId.STONE_EDGE, MoveId.SWORDS_DANCE],

  // Pikachu caps (Kanto … World) — identical fast pure-Electric sweepers. Tail Glow
  // (special) and Belly Drum (physical, → Extreme Speed it already has) are the two
  // setup routes; Plasma Fists is a strong physical Electric STAB; Earth Power covers
  // the Electric/Steel/Ground matchups its STAB can't.
  SPECIES_PIKACHU_ORIGINAL_CAP: [MoveId.TAIL_GLOW, MoveId.BELLY_DRUM, MoveId.PLASMA_FISTS, MoveId.EARTH_POWER],
  SPECIES_PIKACHU_HOENN_CAP: [MoveId.TAIL_GLOW, MoveId.BELLY_DRUM, MoveId.PLASMA_FISTS, MoveId.EARTH_POWER],
  SPECIES_PIKACHU_SINNOH_CAP: [MoveId.TAIL_GLOW, MoveId.BELLY_DRUM, MoveId.PLASMA_FISTS, MoveId.EARTH_POWER],
  SPECIES_PIKACHU_UNOVA_CAP: [MoveId.TAIL_GLOW, MoveId.BELLY_DRUM, MoveId.PLASMA_FISTS, MoveId.EARTH_POWER],
  SPECIES_PIKACHU_KALOS_CAP: [MoveId.TAIL_GLOW, MoveId.BELLY_DRUM, MoveId.PLASMA_FISTS, MoveId.EARTH_POWER],
  SPECIES_PIKACHU_ALOLA_CAP: [MoveId.TAIL_GLOW, MoveId.BELLY_DRUM, MoveId.PLASMA_FISTS, MoveId.EARTH_POWER],
  SPECIES_PIKACHU_PARTNER_CAP: [MoveId.TAIL_GLOW, MoveId.BELLY_DRUM, MoveId.PLASMA_FISTS, MoveId.EARTH_POWER],
  SPECIES_PIKACHU_WORLD_CAP: [MoveId.TAIL_GLOW, MoveId.BELLY_DRUM, MoveId.PLASMA_FISTS, MoveId.EARTH_POWER],

  // --- Batch 4: Pichu Spiky + Unown forms -----------------------------------

  // Pichu Spiky-Eared — Pikachu pre-evo; same fast Electric line, so it shares the
  // cap-Pikachu kit (two setup routes + strong Electric STAB + Ground coverage).
  SPECIES_PICHU_SPIKY_EARED: [MoveId.TAIL_GLOW, MoveId.BELLY_DRUM, MoveId.PLASMA_FISTS, MoveId.EARTH_POWER],

  // Unown letter-forms (all identical: frail Psychic with Magic Guard + a built-in
  // Calm Mind / Cosmic Power / Stored Power core). Shell Smash is the explosive
  // setup a Magic-Guard Stored-Power abuser dreams of (no recoil to fear); Photon
  // Geyser is the nuke STAB; Aura Sphere + Earth Power are the coverage vs the
  // Dark/Steel/Poison that wall Psychic. (Shared tuple — see UNOWN_LETTER_EGG.)
  ...Object.fromEntries(
    [
      "SPECIES_UNOWN_B", "SPECIES_UNOWN_C", "SPECIES_UNOWN_D", "SPECIES_UNOWN_E", "SPECIES_UNOWN_F",
      "SPECIES_UNOWN_G", "SPECIES_UNOWN_H", "SPECIES_UNOWN_I", "SPECIES_UNOWN_J", "SPECIES_UNOWN_K",
      "SPECIES_UNOWN_L", "SPECIES_UNOWN_M", "SPECIES_UNOWN_N", "SPECIES_UNOWN_O", "SPECIES_UNOWN_P",
      "SPECIES_UNOWN_Q", "SPECIES_UNOWN_R", "SPECIES_UNOWN_S", "SPECIES_UNOWN_T", "SPECIES_UNOWN_U",
      "SPECIES_UNOWN_V", "SPECIES_UNOWN_W", "SPECIES_UNOWN_X", "SPECIES_UNOWN_Y", "SPECIES_UNOWN_Z",
      "SPECIES_UNOWN_EMARK", "SPECIES_UNOWN_QMARK",
    ].map(k => [k, [MoveId.SHELL_SMASH, MoveId.PHOTON_GEYSER, MoveId.AURA_SPHERE, MoveId.EARTH_POWER] as const]),
  ),

  // Unown Revelation — the bulky slow mixed Unown (BST 630, Atk/SpA 138, twin 133
  // defenses, Magic Bounce) and a natural Trick Room nuke (it already has Trick
  // Room + the Stored Power core). Photon Geyser fires off whichever attack stat is
  // higher; Body Press weaponises its 133 Def; Aura Sphere + Earth Power are coverage.
  SPECIES_UNOWN_REVELATION: [MoveId.PHOTON_GEYSER, MoveId.BODY_PRESS, MoveId.AURA_SPHERE, MoveId.EARTH_POWER],

  // --- Batch 5: Castform / Deoxys / Burmy / Cherrim / Shellos / Rotom forms --

  // Castform Sunny — fast special Fire with Adaptability + Solar Power. Nasty Plot
  // sets up, Fiery Dance is STAB that also raises SpA, Eruption is a full-HP nuke,
  // Aura Sphere covers the Rock/Steel that wall Fire. (Earth Power is native.)
  SPECIES_CASTFORM_SUNNY: [MoveId.NASTY_PLOT, MoveId.FIERY_DANCE, MoveId.ERUPTION, MoveId.AURA_SPHERE],

  // Castform Rainy — fast special Water with Adaptability + Swift Swim. Nasty Plot +
  // Steam Eruption (STAB nuke + burn), Flip Turn keeps Swift-Swim momentum, Aura
  // Sphere covers Dark/Rock/Ferroseed-likes.
  SPECIES_CASTFORM_RAINY: [MoveId.NASTY_PLOT, MoveId.STEAM_ERUPTION, MoveId.FLIP_TURN, MoveId.AURA_SPHERE],

  // Castform Snowy — fast special Ice with Adaptability + Slush Rush. Nasty Plot,
  // Freeze-Dry (hits the Water that resists Ice), Aurora Veil off its own snow, and
  // Aura Sphere for the Steel/Rock that wall Ice.
  SPECIES_CASTFORM_SNOWY: [MoveId.NASTY_PLOT, MoveId.FREEZE_DRY, MoveId.AURORA_VEIL, MoveId.AURA_SPHERE],

  // Deoxys Attack — frail hyper-offensive mixed nuke (Atk/SpA 180, Spe 150). Photon
  // Geyser fires off the higher attack with no drop; Swords Dance opens the physical
  // side; Close Combat is a cleaner Fighting nuke than its Superpower; Bullet Punch
  // adds priority to mop up faster threats.
  SPECIES_DEOXYS_ATTACK: [MoveId.PHOTON_GEYSER, MoveId.SWORDS_DANCE, MoveId.CLOSE_COMBAT, MoveId.BULLET_PUNCH],

  // Deoxys Defense — twin-160 wall. Body Press weaponises that Def (with its native
  // Cosmic Power), Stored Power snowballs off Calm Mind/Cosmic Power, Wish gives team
  // support, Toxic... it has Toxic Spikes — instead Haze resets sweepers it walls.
  SPECIES_DEOXYS_DEFENSE: [MoveId.BODY_PRESS, MoveId.STORED_POWER, MoveId.WISH, MoveId.HAZE],

  // Deoxys Speed — Spe-180 utility lead/pivot with Regenerator. Parting Shot pivots
  // while debuffing (Regen heals it back), Memento offers a sac-for-setup, Court
  // Change flips hazards/screens, Photon Geyser is its offensive option.
  SPECIES_DEOXYS_SPEED: [MoveId.PARTING_SHOT, MoveId.MEMENTO, MoveId.COURT_CHANGE, MoveId.PHOTON_GEYSER],

  // Burmy Sandy / Trash — Bug pre-evos splitting into Wormadam or Mothim. A kit that
  // serves both branches: Quiver Dance (special setup), Bug Buzz (special STAB),
  // Sleep Powder (utility), Earth Power (Wormadam coverage vs the Fire/Steel/Rock
  // that threaten Bug).
  SPECIES_BURMY_SANDY_CLOAK: [MoveId.QUIVER_DANCE, MoveId.BUG_BUZZ, MoveId.SLEEP_POWDER, MoveId.EARTH_POWER],
  SPECIES_BURMY_TRASH_CLOAK: [MoveId.QUIVER_DANCE, MoveId.BUG_BUZZ, MoveId.SLEEP_POWDER, MoveId.EARTH_POWER],

  // Cherrim Sunshine — mixed Grass/Fire sun sweeper (Flower Gift + Chlorophyll).
  // Flower Trick is an always-crit physical Grass STAB, Fiery Dance is special Fire
  // STAB + SpA boost, Sludge Bomb hits the Fairy/Grass that wall it, Earth Power adds
  // Fire/Rock/Steel coverage (it already has Swords Dance + Growth to set up).
  SPECIES_CHERRIM_SUNSHINE: [MoveId.FLOWER_TRICK, MoveId.FIERY_DANCE, MoveId.SLUDGE_BOMB, MoveId.EARTH_POWER],

  // Shellos East — bulky Water (→ Gastrodon, Water/Ground) Regenerator wall. Stealth
  // Rock is the hazard, Scald is burn-spreading STAB, Calm Mind turns it into a
  // special tank, Haze keeps it from being setup bait.
  SPECIES_SHELLOS_EAST_SEA: [MoveId.STEALTH_ROCK, MoveId.SCALD, MoveId.CALM_MIND, MoveId.HAZE],

  // Rotom Heat — bulky special Electric/Fire pivot. Calm Mind is the bulky setup it
  // lacks (it has Nasty Plot), Earth Power + Aura Sphere + Dazzling Gleam round out
  // coverage vs Rock/Ground/Dark/Dragon that its STABs miss.
  SPECIES_ROTOM_HEAT: [MoveId.CALM_MIND, MoveId.EARTH_POWER, MoveId.AURA_SPHERE, MoveId.DAZZLING_GLEAM],

  // Rotom Wash — bulky special Electric/Water pivot (same Rotom chassis). Calm Mind
  // setup plus Earth Power / Aura Sphere / Dazzling Gleam coverage.
  SPECIES_ROTOM_WASH: [MoveId.CALM_MIND, MoveId.EARTH_POWER, MoveId.AURA_SPHERE, MoveId.DAZZLING_GLEAM],

  // --- Batch 6: remaining Rotom forms / Shaymin Sky / Arceus plates ----------

  // Rotom Frost / Fan / Mow — same bulky special Rotom chassis (Electric + Ice /
  // Flying / Grass). Calm Mind setup + Earth Power / Aura Sphere / Dazzling Gleam
  // coverage, as with Heat/Wash.
  SPECIES_ROTOM_FROST: [MoveId.CALM_MIND, MoveId.EARTH_POWER, MoveId.AURA_SPHERE, MoveId.DAZZLING_GLEAM],
  SPECIES_ROTOM_FAN: [MoveId.CALM_MIND, MoveId.EARTH_POWER, MoveId.AURA_SPHERE, MoveId.DAZZLING_GLEAM],
  SPECIES_ROTOM_MOW: [MoveId.CALM_MIND, MoveId.EARTH_POWER, MoveId.AURA_SPHERE, MoveId.DAZZLING_GLEAM],

  // Shaymin Sky — fast special Grass/Flying with Serene Grace + Speed Boost. Quiver
  // Dance stacks with Speed Boost into an unstoppable sweep; Bleakwind Storm + Sludge
  // Bomb abuse Serene Grace (guaranteed speed drop / 60% poison) while covering its
  // weaknesses; Earth Power answers Steel/Fire/Rock.
  SPECIES_SHAYMIN_SKY: [MoveId.QUIVER_DANCE, MoveId.BLEAKWIND_STORM, MoveId.SLUDGE_BOMB, MoveId.EARTH_POWER],

  // Arceus plates — the 720-BST god already learns ~everything (incl. Judgment STAB,
  // Recover, and every coverage move), so its egg moves are the four major SETUP
  // archetypes it's missing: Shell Smash (all-out), Shift Gear (physical speed),
  // Quiver Dance (special bulk+speed), Tidy Up (Atk+Spe + hazard clear). Type-
  // agnostic, so every plate shares the set.
  ...Object.fromEntries(
    [
      "SPECIES_ARCEUS_FIGHTING", "SPECIES_ARCEUS_FLYING", "SPECIES_ARCEUS_POISON", "SPECIES_ARCEUS_GROUND",
      "SPECIES_ARCEUS_ROCK", "SPECIES_ARCEUS_BUG", "SPECIES_ARCEUS_GHOST", "SPECIES_ARCEUS_STEEL",
      "SPECIES_ARCEUS_FIRE", "SPECIES_ARCEUS_WATER", "SPECIES_ARCEUS_GRASS", "SPECIES_ARCEUS_ELECTRIC",
      "SPECIES_ARCEUS_PSYCHIC", "SPECIES_ARCEUS_ICE", "SPECIES_ARCEUS_DRAGON", "SPECIES_ARCEUS_DARK",
      "SPECIES_ARCEUS_FAIRY",
    ].map(k => [k, [MoveId.SHELL_SMASH, MoveId.SHIFT_GEAR, MoveId.QUIVER_DANCE, MoveId.TIDY_UP] as const]),
  ),

  // --- Batch 7: Basculin / Darmanitan / Deerling / Therian genies -----------

  // Basculin Blue — fast physical Water (→ Basculegion, Water/Ghost) with Strong
  // Jaw + Adaptability. Fishious Rend is a huge fast-mover Water nuke; Last Respects
  // + Poltergeist are the Basculegion Ghost STABs; Psychic Fangs is Strong-Jaw
  // coverage.
  SPECIES_BASCULIN_BLUE_STRIPED: [MoveId.FISHIOUS_REND, MoveId.LAST_RESPECTS, MoveId.POLTERGEIST, MoveId.PSYCHIC_FANGS],

  // Darmanitan Zen — bulky slow special Fire/Psychic with Sheer Force. Psyshock is
  // STAB that beats special walls; Earth Power is Sheer-Force coverage; Dazzling
  // Gleam answers the Dark that's immune to its Psychic; Stored Power snowballs off
  // its native Calm Mind.
  SPECIES_DARMANITAN_ZEN_MODE: [MoveId.PSYSHOCK, MoveId.EARTH_POWER, MoveId.DAZZLING_GLEAM, MoveId.STORED_POWER],

  // Darmanitan Zen Galarian — fast physical Ice/Fire with Gorilla Tactics + Iron
  // Fist. The whole kit is Iron-Fist punches: Thunder Punch covers its Water
  // weakness, Drain Punch heals + hits Steel/Rock, Bullet Punch is priority, and
  // Earthquake rounds out coverage vs Rock/Steel.
  SPECIES_DARMANITAN_ZEN_MODE_GALARIAN: [MoveId.THUNDER_PUNCH, MoveId.DRAIN_PUNCH, MoveId.BULLET_PUNCH, MoveId.EARTHQUAKE],

  // Deerling (Summer/Autumn/Winter) — Normal/Grass (→ Sawsbuck) Chlorophyll sun
  // sweeper with Adaptability. Swords Dance sets up; Body Slam is no-recoil
  // Adaptability STAB (+ para); Earthquake covers Steel/Fire/Rock/Poison; Sappy Seed
  // adds Grass STAB + Leech Seed chip.
  SPECIES_DEERLING_SUMMER: [MoveId.SWORDS_DANCE, MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.SAPPY_SEED],
  SPECIES_DEERLING_AUTUMN: [MoveId.SWORDS_DANCE, MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.SAPPY_SEED],
  SPECIES_DEERLING_WINTER: [MoveId.SWORDS_DANCE, MoveId.BODY_SLAM, MoveId.EARTHQUAKE, MoveId.SAPPY_SEED],

  // Tornadus Therian — fast special Flying with Regenerator + Speed Boost. Nasty Plot
  // sets up; U-turn pivots and triggers Regenerator; Earth Power + Grass Knot cover
  // the Electric/Rock/Steel that threaten or wall it.
  SPECIES_TORNADUS_THERIAN: [MoveId.NASTY_PLOT, MoveId.U_TURN, MoveId.EARTH_POWER, MoveId.GRASS_KNOT],

  // Thundurus Therian — special Electric/Flying nuke with Transistor. Hurricane is
  // the Flying STAB it lacks; Earth Power + Sludge Wave cover Rock/Steel/Grass/Fairy;
  // Weather Ball flexes off its Weather Control. (It already has Nasty Plot.)
  SPECIES_THUNDURUS_THERIAN: [MoveId.HURRICANE, MoveId.EARTH_POWER, MoveId.SLUDGE_WAVE, MoveId.WEATHER_BALL],

  // Landorus Therian — physical Ground/Flying with Sheer Force + Sand Stream/
  // Intimidate. Iron Head / Fire Punch / Thunder Punch are Sheer-Force-boosted
  // coverage that notably patches its Water + Ice weaknesses; Knock Off is utility
  // (it already has Acrobatics, Earthquake, Swords Dance).
  SPECIES_LANDORUS_THERIAN: [MoveId.IRON_HEAD, MoveId.FIRE_PUNCH, MoveId.THUNDER_PUNCH, MoveId.KNOCK_OFF],

  // --- Batch 8: Kyurem / Keldeo / Meloetta / Genesect / Greninja / Vivillon --

  // Kyurem White — special Dragon/Ice nuke (SpA 170) with Refrigerate + Beast Boost.
  // Boomburst becomes a Refrigerate Ice nuke feeding Beast Boost; Sludge Wave covers
  // its Fairy weakness; Aura Sphere covers Steel/Rock; Nasty Plot is a faster boost
  // than its native Calm Mind.
  SPECIES_KYUREM_WHITE: [MoveId.BOOMBURST, MoveId.SLUDGE_WAVE, MoveId.AURA_SPHERE, MoveId.NASTY_PLOT],

  // Kyurem Black — physical Dragon/Ice nuke (Atk 170) with Refrigerate + Multiscale +
  // Beast Boost. Extreme Speed is Refrigerate Ice priority; Glacial Lance is the
  // physical Ice nuke; Close Combat covers Steel/Rock; Swords Dance maxes the sweep.
  SPECIES_KYUREM_BLACK: [MoveId.EXTREME_SPEED, MoveId.GLACIAL_LANCE, MoveId.CLOSE_COMBAT, MoveId.SWORDS_DANCE],

  // Keldeo Resolute — fast special Water/Fighting swordsman (Blade's Essence boosts
  // slicing). Calm Mind sets up; Bitter Blade is a slicing STAB-coverage move with
  // recovery; Sludge Bomb covers its Fairy weakness; Vacuum Wave is special Fighting
  // priority.
  SPECIES_KELDEO_RESOLUTE: [MoveId.CALM_MIND, MoveId.BITTER_BLADE, MoveId.SLUDGE_BOMB, MoveId.VACUUM_WAVE],

  // Meloetta Pirouette — fast physical Normal/Fighting with Serene Grace. Body Slam +
  // Iron Head abuse Serene Grace (para / flinch) while Iron Head also covers its
  // Fairy weakness; Extreme Speed adds priority; Swords Dance maxes the sweep.
  SPECIES_MELOETTA_PIROUETTE: [MoveId.BODY_SLAM, MoveId.IRON_HEAD, MoveId.EXTREME_SPEED, MoveId.SWORDS_DANCE],

  // Genesect drives — mixed Bug/Steel paradox-bot with Mega Launcher + Download. Lean
  // into the pulses: Aura Sphere / Dark Pulse / Dragon Pulse are all Launcher-boosted
  // coverage, and Earth Power answers the Fire that threatens Bug/Steel.
  ...Object.fromEntries(
    [
      "SPECIES_GENESECT_DOUSE_DRIVE", "SPECIES_GENESECT_SHOCK_DRIVE",
      "SPECIES_GENESECT_BURN_DRIVE", "SPECIES_GENESECT_CHILL_DRIVE",
    ].map(k => [k, [MoveId.AURA_SPHERE, MoveId.DARK_PULSE, MoveId.DRAGON_PULSE, MoveId.EARTH_POWER] as const]),
  ),

  // Greninja Battle Bond / Ash-Greninja — fast Water/Dark with Skill Link + Battle
  // Bond. Nasty Plot sets up; Rock Blast / Triple Axel / Bullet Seed are Skill-Link
  // multi-hit coverage (Fire/Flying/Ice/Rock/Water/Ground) that also break Substitute/
  // Focus Sash — exactly what Skill Link wants.
  SPECIES_GRENINJA_BATTLE_BOND: [MoveId.NASTY_PLOT, MoveId.ROCK_BLAST, MoveId.TRIPLE_AXEL, MoveId.BULLET_SEED],
  SPECIES_GRENINJA_ASH: [MoveId.NASTY_PLOT, MoveId.ROCK_BLAST, MoveId.TRIPLE_AXEL, MoveId.BULLET_SEED],

  // Vivillon patterns (all identical: special Bug/Flying QD sweeper with Tinted Lens +
  // Compound Eyes). It already has Quiver Dance + Sleep Powder + Hurricane; the egg
  // moves are coverage Tinted Lens makes always-relevant — Earth Power (Rock/Electric/
  // Fire), Sludge Bomb (Fairy/Grass), Psychic (Poison/Fighting) — plus Tail Glow for a
  // bigger one-turn boost.
  ...Object.fromEntries(
    [
      "SPECIES_VIVILLON_POLAR", "SPECIES_VIVILLON_TUNDRA", "SPECIES_VIVILLON_CONTINENTAL",
      "SPECIES_VIVILLON_GARDEN", "SPECIES_VIVILLON_ELEGANT", "SPECIES_VIVILLON_MEADOW",
      "SPECIES_VIVILLON_MODERN", "SPECIES_VIVILLON_MARINE", "SPECIES_VIVILLON_ARCHIPELAGO",
      "SPECIES_VIVILLON_HIGH_PLAINS", "SPECIES_VIVILLON_SANDSTORM", "SPECIES_VIVILLON_RIVER",
      "SPECIES_VIVILLON_MONSOON", "SPECIES_VIVILLON_SAVANNA", "SPECIES_VIVILLON_SUN",
      "SPECIES_VIVILLON_OCEAN", "SPECIES_VIVILLON_JUNGLE", "SPECIES_VIVILLON_FANCY",
      "SPECIES_VIVILLON_POKE_BALL",
    ].map(k => [k, [MoveId.EARTH_POWER, MoveId.SLUDGE_BOMB, MoveId.PSYCHIC, MoveId.TAIL_GLOW] as const]),
  ),

  // --- Batch 9: Flabebe / Floette Eternal / Furfrou -------------------------

  // Flabebe colors (→ Florges) — bulky defensive Fairy cleric. Aromatherapy makes it
  // a true cleric, Strength Sap is recovery + an Atk drop, Stored Power snowballs off
  // its native Calm Mind, Earth Power answers the Steel/Poison/Fire that wall Fairy.
  ...Object.fromEntries(
    [
      "SPECIES_FLABEBE_YELLOW_FLOWER", "SPECIES_FLABEBE_ORANGE_FLOWER",
      "SPECIES_FLABEBE_BLUE_FLOWER", "SPECIES_FLABEBE_WHITE_FLOWER",
    ].map(k => [k, [MoveId.AROMATHERAPY, MoveId.STRENGTH_SAP, MoveId.STORED_POWER, MoveId.EARTH_POWER] as const]),
  ),

  // Floette Eternal Flower — bulky special Fairy with Magic Guard + Fairy Aura. Quiver
  // Dance is the bulky-sweeper setup; Stored Power is the snowball win-con (Magic Guard
  // means it fears no recoil); Aura Sphere + Sludge Bomb cover the Steel/Poison that
  // wall Fairy. (It already has Earth Power + Light of Ruin.)
  SPECIES_FLOETTE_ETERNAL_FLOWER: [MoveId.QUIVER_DANCE, MoveId.STORED_POWER, MoveId.AURA_SPHERE, MoveId.SLUDGE_BOMB],

  // Furfrou trims (all identical role: fast Normal physical wall with Fur Coat). Iron
  // Defense turns its Body Press + Cotton Guard into real offense; Wish gives the
  // recovery the line otherwise lacks; Stealth Rock + Knock Off make it a disruptive
  // utility wall.
  ...Object.fromEntries(
    [
      "SPECIES_FURFROU_HEART_TRIM", "SPECIES_FURFROU_STAR_TRIM", "SPECIES_FURFROU_DIAMOND_TRIM",
      "SPECIES_FURFROU_DEBUTANTE_TRIM", "SPECIES_FURFROU_MATRON_TRIM", "SPECIES_FURFROU_DANDY_TRIM",
      "SPECIES_FURFROU_LA_REINE_TRIM", "SPECIES_FURFROU_KABUKI_TRIM", "SPECIES_FURFROU_PHARAOH_TRIM",
    ].map(k => [k, [MoveId.IRON_DEFENSE, MoveId.WISH, MoveId.STEALTH_ROCK, MoveId.KNOCK_OFF] as const]),
  ),

  // --- Batch 10: Aegislash / Pumpkaboo / box legends / Oricorio / etc. -------

  // Aegislash Blade — mixed Steel/Ghost with Keen Edge (slicing) + Stance Change.
  // It already has SD/Nasty Plot + STAB; the egg moves are slicing-synergy + the
  // recovery it lacks: Ceaseless Edge (slice + Spikes), Bitter Blade (slice + heal),
  // Recover, and Bullet Punch for Steel priority.
  SPECIES_AEGISLASH_BLADE: [MoveId.CEASELESS_EDGE, MoveId.BITTER_BLADE, MoveId.RECOVER, MoveId.BULLET_PUNCH],

  // Pumpkaboo (Small/Large/Super → Gourgeist) — defensive Ghost/Grass staller. Synthesis
  // + Strength Sap give the recovery it lacks; Spiky Shield stacks with its Leech Seed;
  // Stealth Rock adds hazard utility.
  ...Object.fromEntries(
    ["SPECIES_PUMPKABOO_SMALL", "SPECIES_PUMPKABOO_LARGE", "SPECIES_PUMPKABOO_SUPER"].map(k => [
      k,
      [MoveId.SYNTHESIS, MoveId.SPIKY_SHIELD, MoveId.STRENGTH_SAP, MoveId.STEALTH_ROCK] as const,
    ]),
  ),

  // Xerneas Active — mixed Fairy god with Geomancy + Pixilate + Fairy Aura. Stored
  // Power snowballs off Geomancy/Calm Mind; Thunderbolt / Sludge Wave / Flamethrower
  // are the coverage its huge movepool still lacks (Water/Flying, Grass/Fairy, Steel).
  SPECIES_XERNEAS_ACTIVE: [MoveId.STORED_POWER, MoveId.THUNDERBOLT, MoveId.SLUDGE_WAVE, MoveId.FLAMETHROWER],

  // Zygarde forms (10 / 10-PC / 50-PC / Complete) — physical Dragon/Ground with the
  // Thousand Arrows core. Clangorous Soul + Scale Shot are the missing setup/STAB,
  // Extreme Speed adds priority, Iron Head covers the Fairy/Ice that threaten it.
  ...Object.fromEntries(
    [
      "SPECIES_ZYGARDE_10", "SPECIES_ZYGARDE_10_POWER_CONSTRUCT",
      "SPECIES_ZYGARDE_50_POWER_CONSTRUCT", "SPECIES_ZYGARDE_COMPLETE",
    ].map(k => [k, [MoveId.CLANGOROUS_SOUL, MoveId.SCALE_SHOT, MoveId.EXTREME_SPEED, MoveId.IRON_HEAD] as const]),
  ),

  // Hoopa Unbound — mixed Psychic/Dark nuke (Atk 170 / SpA 160) with Hyperspace Fury.
  // Gunk Shot + Sludge Bomb answer its Fairy weakness from either side; Drain Punch
  // gives Fighting coverage + recovery for its frail Def; Earth Power covers Steel/
  // Poison.
  SPECIES_HOOPA_UNBOUND: [MoveId.GUNK_SHOT, MoveId.SLUDGE_BOMB, MoveId.DRAIN_PUNCH, MoveId.EARTH_POWER],

  // Oricorio (Pom-Pom/Pau/Sensu) — special Flying dancer with Quiver Dance + Serene
  // Grace. It already has QD + Revelation Dance; egg moves are coverage + an extra
  // boost: Earth Power (Rock/Electric), Sludge Bomb (Serene-Grace poison + Fairy/Grass),
  // Dazzling Gleam (Dragon/Dark), Tail Glow.
  ...Object.fromEntries(
    ["SPECIES_ORICORIO_POM_POM", "SPECIES_ORICORIO_PAU", "SPECIES_ORICORIO_SENSU"].map(k => [
      k,
      [MoveId.EARTH_POWER, MoveId.SLUDGE_BOMB, MoveId.DAZZLING_GLEAM, MoveId.TAIL_GLOW] as const,
    ]),
  ),

  // Rockruff Own Tempo (→ Lycanroc Dusk, Tough Claws) — fast physical Rock. Swords
  // Dance sets up; Close Combat / Psychic Fangs / Earthquake are the contact coverage
  // (Steel/Ice, Fighting/Poison, Steel/Fire/Electric) it can't otherwise reach.
  SPECIES_ROCKRUFF_OWN_TEMPO: [MoveId.SWORDS_DANCE, MoveId.CLOSE_COMBAT, MoveId.PSYCHIC_FANGS, MoveId.EARTHQUAKE],

  // Wishiwashi School — slow bulky mixed Water (BST 620, Spe 30) with Schooling +
  // Regenerator. Trick Room turns it into a nuke; Scald is burn-spreading STAB; Earth
  // Power answers its Electric weakness; Stealth Rock is hazard utility.
  SPECIES_WISHIWASHI_SCHOOL: [MoveId.TRICK_ROOM, MoveId.SCALD, MoveId.EARTH_POWER, MoveId.STEALTH_ROCK],

  // --- Batch 11: Silvally type-forms ----------------------------------------

  // Silvally (all RKS-System type-forms; balanced 95-across physical pivot whose
  // Multi-Attack adapts to its type). The non-STAB pool is deliberately shallow, so
  // a strong UNIVERSAL kit fits every form: Swords Dance (sets up Multi-Attack +
  // Extreme Speed it already has), U-turn (offensive pivot to pair with Parting Shot),
  // Knock Off (universal utility/coverage), Rapid Spin (hazard control + a Speed boost).
  ...Object.fromEntries(
    [
      "SPECIES_SILVALLY_FIGHTING", "SPECIES_SILVALLY_FLYING", "SPECIES_SILVALLY_POISON",
      "SPECIES_SILVALLY_GROUND", "SPECIES_SILVALLY_ROCK", "SPECIES_SILVALLY_BUG",
      "SPECIES_SILVALLY_GHOST", "SPECIES_SILVALLY_STEEL", "SPECIES_SILVALLY_FIRE",
      "SPECIES_SILVALLY_WATER", "SPECIES_SILVALLY_GRASS", "SPECIES_SILVALLY_ELECTRIC",
      "SPECIES_SILVALLY_PSYCHIC", "SPECIES_SILVALLY_ICE", "SPECIES_SILVALLY_DRAGON",
      "SPECIES_SILVALLY_DARK", "SPECIES_SILVALLY_FAIRY",
    ].map(k => [k, [MoveId.SWORDS_DANCE, MoveId.U_TURN, MoveId.KNOCK_OFF, MoveId.RAPID_SPIN] as const]),
  ),

  // --- Batch 12: Minior / Mimikyu / Magearna / Cramorant / Sinistea ---------

  // Minior (Meteor + Core colors) — Rock/Flying Shields-Down Shell-Smash sweeper. It
  // already has Shell Smash + STAB + coverage; the egg moves serve both the offensive
  // Core (Extreme Speed priority post-Smash) and the defensive Meteor/Regenerator
  // (Roost recovery, U-turn pivot), plus universal Knock Off utility.
  ...Object.fromEntries(
    [
      "SPECIES_MINIOR_METEOR_ORANGE", "SPECIES_MINIOR_METEOR_YELLOW", "SPECIES_MINIOR_METEOR_GREEN",
      "SPECIES_MINIOR_METEOR_BLUE", "SPECIES_MINIOR_METEOR_INDIGO", "SPECIES_MINIOR_METEOR_VIOLET",
      "SPECIES_MINIOR_CORE_RED", "SPECIES_MINIOR_CORE_ORANGE", "SPECIES_MINIOR_CORE_YELLOW",
      "SPECIES_MINIOR_CORE_GREEN", "SPECIES_MINIOR_CORE_BLUE", "SPECIES_MINIOR_CORE_INDIGO",
      "SPECIES_MINIOR_CORE_VIOLET",
    ].map(k => [k, [MoveId.EXTREME_SPEED, MoveId.ROOST, MoveId.U_TURN, MoveId.KNOCK_OFF] as const]),
  ),

  // Mimikyu Busted — physical Ghost/Fairy with Disguise + Keen Edge (slicing). Ceaseless
  // Edge (slice + Spikes), Sacred Sword + Bitter Blade are slicing coverage that beats
  // the Steel walling its STAB (plus Bitter Blade healing); Knock Off is utility (it
  // already has Swords Dance + Shadow Sneak).
  SPECIES_MIMIKYU_BUSTED: [MoveId.CEASELESS_EDGE, MoveId.SACRED_SWORD, MoveId.BITTER_BLADE, MoveId.KNOCK_OFF],

  // Magearna Original — bulky special Steel/Fairy with Soul-Heart. Stored Power
  // snowballs off Calm Mind + Soul-Heart KOs; Tail Glow is a faster boost; Earth Power
  // + Mystical Fire cover the Fire/Steel/Ground matchups (Mystical Fire also drops SpA).
  SPECIES_MAGEARNA_ORIGINAL_COLOR: [MoveId.STORED_POWER, MoveId.TAIL_GLOW, MoveId.EARTH_POWER, MoveId.MYSTICAL_FIRE],

  // Cramorant Gulping / Gorging — mixed Flying/Water with Gulp Missile. Nasty Plot sets
  // up the special side, Brave Bird is the physical Flying STAB it lacks, Scald is
  // burn-spreading STAB, Knock Off is utility (it already has Surf/Dive to fire Gulp
  // Missile + Bolt Beak).
  SPECIES_CRAMORANT_GULPING: [MoveId.NASTY_PLOT, MoveId.BRAVE_BIRD, MoveId.SCALD, MoveId.KNOCK_OFF],
  SPECIES_CRAMORANT_GORGING: [MoveId.NASTY_PLOT, MoveId.BRAVE_BIRD, MoveId.SCALD, MoveId.KNOCK_OFF],

  // Sinistea Antique (→ Polteageist) — frail special Ghost Shell-Smash sweeper. Stored
  // Power is the post-Smash win-con, Giga Drain is coverage + recovery, Dazzling Gleam
  // answers the Dark that's immune to Ghost, Earth Power hits the Steel that resists it.
  SPECIES_SINISTEA_ANTIQUE: [MoveId.STORED_POWER, MoveId.GIGA_DRAIN, MoveId.DAZZLING_GLEAM, MoveId.EARTH_POWER],

  // --- Batch 13: Gen 8/9 forms + box legends --------------------------------

  // Eiscue Noice Face — fast physical Ice Belly-Drum/SD sweeper. Close Combat +
  // Earthquake + Zen Headbutt cover the Steel/Rock/Fighting/Poison that threaten it;
  // Knock Off is utility (it already has Aqua Jet/Ice Shard priority).
  SPECIES_EISCUE_NOICE_FACE: [MoveId.CLOSE_COMBAT, MoveId.EARTHQUAKE, MoveId.ZEN_HEADBUTT, MoveId.KNOCK_OFF],

  // Indeedee Female — special Psychic/Normal support with Psychic Surge + Hospitality.
  // Wish gives repeatable team recovery; Aura Sphere / Earth Power / Mystical Fire cover
  // the Dark/Steel that wall its STAB (Mystical Fire also chips SpA).
  SPECIES_INDEEDEE_FEMALE: [MoveId.WISH, MoveId.AURA_SPHERE, MoveId.EARTH_POWER, MoveId.MYSTICAL_FIRE],

  // Morpeko Hangry — fast physical Electric/Dark with Aura Wheel. Close Combat / Gunk
  // Shot / Triple Axel patch its Fairy + Ground + Fighting weaknesses; U-turn pivots
  // (it already has Swords Dance + Sucker Punch).
  SPECIES_MORPEKO_HANGRY: [MoveId.CLOSE_COMBAT, MoveId.GUNK_SHOT, MoveId.TRIPLE_AXEL, MoveId.U_TURN],

  // Zarude Dada — physical Fairy/Grass bruiser with Parental Bond + Grassy Surge. Iron
  // Head / Fire Punch / Thunder Punch / Triple Axel are all Parental-Bond-doubled
  // coverage answering its many weaknesses (Steel/Fire/Ice/Flying/Fairy) — it already
  // has Power Whip + Play Rough + Grassy Glide + Swords Dance.
  SPECIES_ZARUDE_DADA: [MoveId.IRON_HEAD, MoveId.FIRE_PUNCH, MoveId.THUNDER_PUNCH, MoveId.TRIPLE_AXEL],

  // Calyrex Ice Rider — slow physical Psychic/Ice tank (As One). Curse turns its huge
  // Def into Body-Press offense + Atk; Iron Head covers Fairy/Rock; Bullet Punch gives
  // the slow tank priority; Knock Off is utility (it already has Glacial Lance + SD +
  // Trick Room).
  SPECIES_CALYREX_ICE_RIDER: [MoveId.CURSE, MoveId.IRON_HEAD, MoveId.BULLET_PUNCH, MoveId.KNOCK_OFF],

  // Calyrex Shadow Rider — fast special Psychic/Ghost nuke (As One / Grim Neigh). Nasty
  // Plot is a faster boost; Stored Power snowballs off boosts + Grim Neigh; Dark Pulse +
  // Earth Power cover other Ghosts/Steels (it already has Astral Barrage + Aura Sphere).
  SPECIES_CALYREX_SHADOW_RIDER: [MoveId.NASTY_PLOT, MoveId.STORED_POWER, MoveId.DARK_PULSE, MoveId.EARTH_POWER],

  // Paldean Tauros (Aqua/Blaze/Combat) — physical Fighting bruisers with Rock Head +
  // Anger Point. Universal kit (each already has its type STAB): Swords Dance, Body
  // Press (off its 105 Def), Drain Punch (Fighting + recovery), Knock Off (utility).
  ...Object.fromEntries(
    [
      "SPECIES_TAUROS_PALDEAN_AQUA_BREED", "SPECIES_TAUROS_PALDEAN_BLAZE_BREED",
      "SPECIES_TAUROS_PALDEAN_COMBAT_BREED",
    ].map(k => [k, [MoveId.SWORDS_DANCE, MoveId.BODY_PRESS, MoveId.DRAIN_PUNCH, MoveId.KNOCK_OFF] as const]),
  ),

  // Ursaluna Bloodmoon — slow special Ground/Normal tank with Blood Moon. Trick Room
  // turns its low Speed into a win condition; Stored Power snowballs off Calm Mind;
  // Fire Blast + Grass Knot cover the Grass/Ice/Steel + Water that threaten it.
  SPECIES_URSALUNA_BLOODMOON: [MoveId.TRICK_ROOM, MoveId.STORED_POWER, MoveId.FIRE_BLAST, MoveId.GRASS_KNOT],

  // Palafin Hero — physical Water nuke (Atk 160) with Adaptability + Jet Punch priority.
  // Swords Dance maxes the sweep; Zen Headbutt covers its Grass weakness; Knock Off +
  // Throat Chop are utility/Dark coverage (it already has Close Combat + Jet Punch).
  SPECIES_PALAFIN_HERO: [MoveId.SWORDS_DANCE, MoveId.ZEN_HEADBUTT, MoveId.KNOCK_OFF, MoveId.THROAT_CHOP],

  // Tatsugiri (Curly/Stretchy/Droopy) — special Dragon/Water glass cannon. Sludge Wave
  // covers BOTH its Fairy and Grass weaknesses; Earth Power covers Electric/Steel; Calm
  // Mind is an alt setup; Steam Eruption is a burn-spreading Water STAB.
  ...Object.fromEntries(
    ["SPECIES_TATSUGIRI_CURLY", "SPECIES_TATSUGIRI_STRETCHY", "SPECIES_TATSUGIRI_DROOPY"].map(k => [
      k,
      [MoveId.SLUDGE_WAVE, MoveId.EARTH_POWER, MoveId.CALM_MIND, MoveId.STEAM_ERUPTION] as const,
    ]),
  ),

  // Squawkabilly Green Plumage — mixed Normal/Flying with Intimidate. Nasty Plot sets up
  // its Boomburst/Hurricane; Heat Wave + Focus Blast cover Steel/Rock/Ice; Knock Off is
  // utility (it already pivots with U-turn/Parting Shot).
  SPECIES_SQUAWKABILLY_GREEN_PLUMAGE: [MoveId.NASTY_PLOT, MoveId.HEAT_WAVE, MoveId.FOCUS_BLAST, MoveId.KNOCK_OFF],

  // --- Batch 14: Gen-9 masks, EX birds, Battle Bond forms + Redux lines ------

  // Squawkabilly Blue/Yellow/White Plumage — mechanically identical to Green (same
  // stats/abilities), so they share the same Nasty-Plot coverage kit.
  ...Object.fromEntries(
    [
      "SPECIES_SQUAWKABILLY_BLUE_PLUMAGE", "SPECIES_SQUAWKABILLY_YELLOW_PLUMAGE",
      "SPECIES_SQUAWKABILLY_WHITE_PLUMAGE",
    ].map(k => [k, [MoveId.NASTY_PLOT, MoveId.HEAT_WAVE, MoveId.FOCUS_BLAST, MoveId.KNOCK_OFF] as const]),
  ),

  // Ogerpon Wellspring Mask — bulky physical Grass/Water (Water Veil) with Long Reach.
  // Liquidation gives a real Water STAB; Stone Edge covers its Flying/Bug/Fire weaks;
  // Flip Turn pivots; Bulk Up sets up (it already has Ivy Cudgel + SD + Power Whip).
  SPECIES_OGERPON_WELLSPRING_MASK: [MoveId.LIQUIDATION, MoveId.STONE_EDGE, MoveId.FLIP_TURN, MoveId.BULK_UP],

  // Ogerpon Hearthflame Mask — physical Grass/Fire with Mold Breaker (bypasses abilities).
  // Flare Blitz is a strong Fire STAB; Stone Edge covers Flying/Rock; Sucker Punch is
  // priority; Bulk Up sets up (it already has Ivy Cudgel + SD + Power Whip + Knock Off).
  SPECIES_OGERPON_HEARTHFLAME_MASK: [MoveId.FLARE_BLITZ, MoveId.STONE_EDGE, MoveId.SUCKER_PUNCH, MoveId.BULK_UP],

  // Ogerpon Cornerstone Mask — defensive physical Grass/Rock (Sturdy / Impenetrable).
  // Body Press weaponizes its huge Def; Earthquake + Sucker Punch add coverage; Stealth
  // Rock fits its Loose-Rocks hazard identity (it already has Ivy Cudgel + Iron Defense).
  SPECIES_OGERPON_CORNERSTONE_MASK: [MoveId.BODY_PRESS, MoveId.EARTHQUAKE, MoveId.SUCKER_PUNCH, MoveId.STEALTH_ROCK],

  // Enamorus Therian — slow special Fairy/Flying with Contrary. Overheat becomes a +SpA
  // boost under Contrary; Hyper Voice is Pixilate-boosted Fairy STAB; Earth Power covers
  // Steel/Poison/Fire; Trick Room flips its low Speed (it already has Moonblast + NP).
  SPECIES_ENAMORUS_THERIAN: [MoveId.OVERHEAT, MoveId.HYPER_VOICE, MoveId.EARTH_POWER, MoveId.TRICK_ROOM],

  // Castform Sandy — special Rock with Weather Ball + Adaptability under sand. Nasty Plot
  // sets up; Freeze-Dry / Giga Drain / Flash Cannon cover the Water/Ground/Fighting that
  // threaten a Rock attacker (it already has Power Gem + Earth Power + Weather Ball).
  SPECIES_CASTFORM_SANDY: [MoveId.NASTY_PLOT, MoveId.FREEZE_DRY, MoveId.GIGA_DRAIN, MoveId.FLASH_CANNON],

  // Castform Foggy — special Ghost with Adaptability. Nasty Plot sets up; Giga Drain /
  // Mystical Fire / Dazzling Gleam cover the Dark + Steel + other Ghosts that wall it
  // (it already has Shadow Ball + Hex + Dark Pulse).
  SPECIES_CASTFORM_FOGGY: [MoveId.NASTY_PLOT, MoveId.GIGA_DRAIN, MoveId.MYSTICAL_FIRE, MoveId.DAZZLING_GLEAM],

  // Polartic Bluemoon — bulky physical Ice/Fighting with Sheer Force. Play Rough is
  // Sheer-Force-boosted and covers Dark/Dragon; Earthquake hits Steel/Fire/Poison; Heavy
  // Slam answers Fairy; Bulk Up sets up (it already has Close Combat + Triple Axel + SD).
  SPECIES_POLARTIC_BLUEMOON: [MoveId.PLAY_ROUGH, MoveId.EARTHQUAKE, MoveId.HEAVY_SLAM, MoveId.BULK_UP],

  // Lumbering Sloth Engulfed — fast physical Fire/Grass with Tough Claws. Close Combat +
  // Stone Edge patch its Rock/Flying weaks; Knock Off is utility; U-turn pivots (it
  // already has Flare Blitz + Wood Hammer + Earthquake + Swords Dance).
  SPECIES_LUMBERING_SLOTH_ENGULFED: [MoveId.CLOSE_COMBAT, MoveId.STONE_EDGE, MoveId.KNOCK_OFF, MoveId.U_TURN],

  // Gimmighoul Roaming → Gholdengo — special Steel/Ghost (Good as Gold). Thunderbolt /
  // Energy Ball / Mystical Fire give the coverage Gholdengo lacks (Water/Flying, Ground/
  // Rock, opposing Steel); Trick cripples walls (it already has Make-It-Rain-tier STAB).
  SPECIES_GIMMIGHOUL_ROAMING: [MoveId.THUNDERBOLT, MoveId.ENERGY_BALL, MoveId.MYSTICAL_FIRE, MoveId.TRICK],

  // Pikachu Partner — fast Electric with priority via Overcharge. Ice Punch / Grass Knot
  // answer the Ground types that wall Electric; Extreme Speed is extra priority; Knock
  // Off is utility (it already has Volt Tackle + Nuzzle + Surf).
  SPECIES_PIKACHU_PARTNER: [MoveId.ICE_PUNCH, MoveId.GRASS_KNOT, MoveId.EXTREME_SPEED, MoveId.KNOCK_OFF],

  // Eevee Partner — Normal support with Simple + Adaptability. Calm Mind (doubled by
  // Simple) feeds Stored Power; Wish gives recovery; Extreme Speed is Adaptability-boosted
  // priority (it already has Baton Pass + Last Resort + SD).
  SPECIES_EEVEE_PARTNER: [MoveId.CALM_MIND, MoveId.STORED_POWER, MoveId.WISH, MoveId.EXTREME_SPEED],

  // Meowth Partner — fast Normal with Skill Link. Bullet Seed / Rock Blast / Icicle Spear /
  // Triple Axel are all multi-hit moves that Skill Link maxes to 5 (or 3) hits, giving
  // broad coverage off its 90 Atk (it already has Fake Out + U-turn + SD).
  SPECIES_MEOWTH_PARTNER: [MoveId.BULLET_SEED, MoveId.ROCK_BLAST, MoveId.ICICLE_SPEAR, MoveId.TRIPLE_AXEL],

  // Chesnaught Battle Bond — defensive physical Grass/Fighting. Curse weaponizes its huge
  // Def (with Body Press); Stone Edge / Ice Punch / Knock Off cover Flying/Fire/Ice/Psychic
  // (it already has Spiky Shield + Spikes + Body Press + Drain Punch).
  SPECIES_CHESNAUGHT_BATTLE_BOND: [MoveId.CURSE, MoveId.STONE_EDGE, MoveId.ICE_PUNCH, MoveId.KNOCK_OFF],

  // Chesnaught Clemont — physical Grass/Fighting with Galvanize (Normal → Electric). Extreme
  // Speed becomes Electric-type priority STAB; Stone Edge / Ice Punch / Knock Off cover its
  // weaks (it already has Body Press + Bulk Up + Wood Hammer).
  SPECIES_CHESNAUGHT_CLEMONT: [MoveId.EXTREME_SPEED, MoveId.STONE_EDGE, MoveId.ICE_PUNCH, MoveId.KNOCK_OFF],

  // Delphox Battle Bond / Serena — special Fire/Psychic with Adaptability + Battle Bond.
  // Earth Power / Dark Pulse / Giga Drain / Aura Sphere cover the Rock/Ghost/Water/Dark
  // that wall it (both already have Mystical Fire + Psyshock + Calm Mind + Nasty Plot).
  ...Object.fromEntries(
    ["SPECIES_DELPHOX_BATTLE_BOND", "SPECIES_DELPHOX_SERENA"].map(k => [
      k,
      [MoveId.EARTH_POWER, MoveId.DARK_PULSE, MoveId.GIGA_DRAIN, MoveId.AURA_SPHERE] as const,
    ]),
  ),

  // Morpekyll Hangry — fast physical Electric/Dark (Unburden / Magic Bounce). Close Combat /
  // Gunk Shot / Ice Punch / Play Rough patch its Fighting/Fairy/Ground weaks (it already
  // has Aura Wheel + Sucker Punch + Swords Dance + Knock Off).
  SPECIES_MORPEKYLL_HANGRY: [MoveId.CLOSE_COMBAT, MoveId.GUNK_SHOT, MoveId.ICE_PUNCH, MoveId.PLAY_ROUGH],

  // Kipmodo → Marshmodo — physical Dragon/Poison with Dragon's Maw + Merciless. Earthquake /
  // Iron Head / Fire Punch cover Steel/Fairy/Ice; Sucker Punch answers the Psychic it dreads
  // (it already has Dragon Dance + Gunk Shot + Outrage).
  SPECIES_KIPMODO: [MoveId.EARTHQUAKE, MoveId.IRON_HEAD, MoveId.SUCKER_PUNCH, MoveId.FIRE_PUNCH],

  // Zapdos Ex — special Electric/Flying with Drizzle + Weather Ball synergy. Nasty Plot
  // sets up; Ice Beam / Earth Power / Dazzling Gleam cover the Rock/Ground + Dark/Dragon
  // that threaten it (it already has Thunderbolt + Hurricane + Volt Switch).
  SPECIES_ZAPDOS_EX: [MoveId.NASTY_PLOT, MoveId.ICE_BEAM, MoveId.EARTH_POWER, MoveId.DAZZLING_GLEAM],

  // Articuno Ex — bulky special Ice/Flying (Ice Scales) and a Calm Mind + Stored Power
  // wincon. Stored Power snowballs; Earth Power / Focus Blast cover the Rock/Steel/Electric
  // that wall it; Nasty Plot is a faster setup (it already has Aurora Veil + Calm Mind + Roost).
  SPECIES_ARTICUNO_EX: [MoveId.STORED_POWER, MoveId.EARTH_POWER, MoveId.FOCUS_BLAST, MoveId.NASTY_PLOT],

  // Moltres Ex — special Fire/Flying with Drought (Solar Beam synergy). Nasty Plot sets up;
  // Focus Blast / Giga Drain / Mystical Fire cover the Rock/Water/Electric + opposing Fire
  // that threaten it (it already has Fire Blast + Hurricane + Scorching Sands).
  SPECIES_MOLTRES_EX: [MoveId.NASTY_PLOT, MoveId.FOCUS_BLAST, MoveId.GIGA_DRAIN, MoveId.MYSTICAL_FIRE],

  // Minccino Redux → Cinccino Redux — special Ice/Fairy with Serene Grace. Air Slash gets
  // a 60% flinch under Serene Grace; Moonblast / Freeze-Dry are STAB; Nasty Plot sets up
  // (it already has Dazzling Gleam + Icicle Crash + Play Rough).
  SPECIES_MINCCINO_REDUX: [MoveId.AIR_SLASH, MoveId.MOONBLAST, MoveId.FREEZE_DRY, MoveId.NASTY_PLOT],

  // Sinistea Redux → Polteageist Redux — physical Ghost/Dragon Shell-Smash sweeper. Play
  // Rough / Earthquake / Sucker Punch cover Dark/Dragon/Fairy/Steel + give priority; Dragon
  // Dance is an alt setup (it already has Shell Smash + Poltergeist + Phantom Force).
  SPECIES_SINISTEA_REDUX: [MoveId.PLAY_ROUGH, MoveId.EARTHQUAKE, MoveId.SUCKER_PUNCH, MoveId.DRAGON_DANCE],

  // Cetoddle Redux → Cetitan Redux — physical Steel with Steelworker. Swords Dance sets up;
  // Earthquake / Icicle Crash / Stone Edge cover Fire/Fighting/Flying and keep the Ice flavor
  // (it already has Heavy Slam + Gear Grind + Iron Fangs).
  SPECIES_CETODDLE_REDUX: [MoveId.SWORDS_DANCE, MoveId.EARTHQUAKE, MoveId.ICICLE_CRASH, MoveId.STONE_EDGE],

  // Grotom Glass (Poison/Rock, Unburden) — physical breaker. Swords Dance sets up; Body
  // Press weaponizes its 107 Def; Knock Off + Gunk Shot are STAB/utility (it already has
  // Cross Poison + Stone Edge + Accelerock).
  SPECIES_GROTOM_GLASS: [MoveId.SWORDS_DANCE, MoveId.BODY_PRESS, MoveId.KNOCK_OFF, MoveId.GUNK_SHOT],

  // Grotom Roll (Poison/Ground, Speed Boost) — snowballing sweeper. Swords Dance + Speed
  // Boost is the win condition; Ice Punch / Body Press / Knock Off add coverage (it already
  // has Earthquake + Poison Jab + Stone Edge).
  SPECIES_GROTOM_ROLL: [MoveId.SWORDS_DANCE, MoveId.ICE_PUNCH, MoveId.BODY_PRESS, MoveId.KNOCK_OFF],

  // Grotom Drum (Poison/Steel, Fort Knox / Full Metal Body) — defensive wall. Body Press +
  // its 107 Def; Heavy Slam is Steel STAB; Knock Off is utility; Pain Split is recovery for
  // a Pokémon with no reliable heal (it already has Iron Defense + Iron Head).
  SPECIES_GROTOM_DRUM: [MoveId.BODY_PRESS, MoveId.HEAVY_SLAM, MoveId.KNOCK_OFF, MoveId.PAIN_SPLIT],

  // Grotom Kick (Poison/Fighting, Roundhouse / Striker) — physical fighter. Close Combat is
  // its Fighting nuke; Sucker Punch answers the Psychic/Flying it dreads; Ice Punch covers
  // Flying/Ground; Knock Off is utility (it already has High Jump Kick + Mighty Cleave).
  SPECIES_GROTOM_KICK: [MoveId.CLOSE_COMBAT, MoveId.SUCKER_PUNCH, MoveId.ICE_PUNCH, MoveId.KNOCK_OFF],

  // Grotom Fill (Poison/Dark, Innards Out / Gluttony) — physical wallbreaker. Swords Dance
  // sets up; Sucker Punch / Knock Off are Dark priority/utility; Gunk Shot is the Poison
  // nuke (it already has Darkest Lariat + Stone Edge + Earthquake).
  SPECIES_GROTOM_FILL: [MoveId.SWORDS_DANCE, MoveId.SUCKER_PUNCH, MoveId.KNOCK_OFF, MoveId.GUNK_SHOT],

  // Wispywaspy Hivemind — huge mixed Bug/Ghost (130/130) with a barren movepool. Bug Buzz /
  // Shadow Ball are dual STAB; Sludge Bomb covers the Fairy/Grass it fears; Nasty Plot sets
  // up — this finally gives it a real special kit.
  SPECIES_WISPYWASPY_HIVEMIND: [MoveId.BUG_BUZZ, MoveId.SHADOW_BALL, MoveId.SLUDGE_BOMB, MoveId.NASTY_PLOT],

  // Rattata Redux → Raticate Redux — physical Poison with Hustle + Scrappy. Swords Dance
  // sets up; Sucker Punch / Crunch answer the Psychic it dreads; Fire Fang covers Steel/Grass
  // (it already has Gunk Shot + Cross Poison + Knock Off).
  SPECIES_RATTATA_REDUX: [MoveId.SWORDS_DANCE, MoveId.SUCKER_PUNCH, MoveId.CRUNCH, MoveId.FIRE_FANG],

  // Vanillite Redux → Vanillish Redux — special Ice/Fire (Flash Fire / Molten Down). Nasty
  // Plot sets up; Freeze-Dry flips its Water weakness into a OHKO; Earth Power / Flash Cannon
  // cover Rock/Fire/Steel (it already has Ice Beam + Flamethrower + Weather Ball).
  SPECIES_VANILLITE_REDUX: [MoveId.NASTY_PLOT, MoveId.FREEZE_DRY, MoveId.EARTH_POWER, MoveId.FLASH_CANNON],

  // Litwick Redux → Lampent Redux — special Ghost/Electric. Calm Mind sets up; Giga Drain
  // covers the Ground it dreads (+ recovery); Dazzling Gleam answers Dark; Energy Ball adds
  // Rock/Water coverage (it already has Shadow Ball + Thunderbolt + Nasty Plot).
  SPECIES_LITWICK_REDUX: [MoveId.CALM_MIND, MoveId.GIGA_DRAIN, MoveId.DAZZLING_GLEAM, MoveId.ENERGY_BALL],

  // Drilbur Redux → Excadrill Redux — physical Dragon/Ground. Swords Dance + Dragon Dance
  // are setup; Iron Head covers the Fairy/Ice it dreads; Stone Edge adds coverage (it
  // already has Dragon Claw + High Horsepower + Earth Power + Stealth Rock).
  SPECIES_DRILBUR_REDUX: [MoveId.SWORDS_DANCE, MoveId.DRAGON_DANCE, MoveId.IRON_HEAD, MoveId.STONE_EDGE],

  // Swinub Redux → Piloswine Redux — bulky Ground/Grass with Harvest. Earthquake / Stone
  // Edge are coverage answering Fire/Flying/Ice/Bug; Knock Off is utility; Body Press uses
  // its bulk (it already has High Horsepower + Leech Seed + Strength Sap + Stealth Rock).
  SPECIES_SWINUB_REDUX: [MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.KNOCK_OFF, MoveId.BODY_PRESS],

  // Larvesta Redux → Volcarona Redux — special Bug/Dark. Quiver Dance is the iconic setup;
  // Bug Buzz is STAB; Sludge Bomb covers the Fairy it dreads; Psychic adds coverage (it
  // already has Dark Pulse + Giga Drain + Shadow Ball).
  SPECIES_LARVESTA_REDUX: [MoveId.QUIVER_DANCE, MoveId.BUG_BUZZ, MoveId.SLUDGE_BOMB, MoveId.PSYCHIC],

  // Klefki Redux — special/support Electric/Poison with Levitate (no Ground weak). Spikes
  // fits its key-ring hazard identity; Nasty Plot sets up; Dazzling Gleam answers Dark;
  // Energy Ball covers Ground/Rock/Water (it already has Thunderbolt + Gunk Shot + Thunder Wave).
  SPECIES_KLEFKI_REDUX: [MoveId.SPIKES, MoveId.NASTY_PLOT, MoveId.DAZZLING_GLEAM, MoveId.ENERGY_BALL],

  // Bellsprout Redux → Weepinbell Redux — frail special Grass/Ice. Earth Power covers four
  // of its weaks (Fire/Poison/Rock/Steel); Sludge Bomb hits Fairy/Grass; Nasty Plot sets up;
  // Strength Sap is recovery (it already has Giga Drain + Freeze-Dry + Leaf Storm).
  SPECIES_BELLSPROUT_REDUX: [MoveId.EARTH_POWER, MoveId.SLUDGE_BOMB, MoveId.NASTY_PLOT, MoveId.STRENGTH_SAP],

  // Sawk Redux — pure Normal with Normalize + Scrappy. Extreme Speed becomes a strong STAB
  // priority (Normalize) that hits Ghosts (Scrappy); Bulk Up sets up; Drain Punch gives
  // recovery; Body Slam adds paralysis (it already has Megaton Hammer + Relentless Clobber).
  SPECIES_SAWK_REDUX: [MoveId.EXTREME_SPEED, MoveId.BULK_UP, MoveId.DRAIN_PUNCH, MoveId.BODY_SLAM],

  // --- Batch 15: more Redux evolution lines + Redux legends -----------------

  // Throh Redux — bulky physical Normal with Skill Link + Rocky Payload. Bullet Seed /
  // Icicle Spear / Triple Axel are Skill-Link multi-hits for coverage; Body Press uses
  // its 100 Def (it already has Arm Thrust + Rock Blast + Bulk Up).
  SPECIES_THROH_REDUX: [MoveId.BULLET_SEED, MoveId.ICICLE_SPEAR, MoveId.TRIPLE_AXEL, MoveId.BODY_PRESS],

  // Swablu Redux → Altaria Redux — special Fire/Water (Levitate) with Catastrophe. Calm
  // Mind sets up; Earth Power answers the Rock/Electric it dreads; Ice Beam + Giga Drain
  // add coverage + recovery (it already has Fire Blast + Hydro Pump + Scald).
  SPECIES_SWABLU_REDUX: [MoveId.CALM_MIND, MoveId.EARTH_POWER, MoveId.ICE_BEAM, MoveId.GIGA_DRAIN],

  // Exeggcute Redux → Exeggutor Redux — slow special Grass/Normal (Grassy Surge). Trick
  // Room flips its Spe 20; Nasty Plot sets up; Earth Power / Sludge Bomb cover the
  // Fire/Poison/Steel that wall it (it already has Psychic + Energy Ball + Grassy Glide).
  SPECIES_EXEGGCUTE_REDUX: [MoveId.TRICK_ROOM, MoveId.NASTY_PLOT, MoveId.EARTH_POWER, MoveId.SLUDGE_BOMB],

  // Kecleong — bulky mixed Ice/Normal (SpD 120) with Prismatic Fur. Calm Mind + Stored
  // Power is a wincon off its special bulk; Earth Power / Freeze-Dry cover the Fire/Rock/
  // Steel/Water that threaten it (it already has Ice Beam + Body Press + Knock Off).
  SPECIES_KECLEONG: [MoveId.CALM_MIND, MoveId.STORED_POWER, MoveId.EARTH_POWER, MoveId.FREEZE_DRY],

  // Noibat Redux → Noivern Redux — fast physical Rock/Ghost (Levitate / Rock Head). Play
  // Rough answers the Dark it dreads; Earthquake covers Steel; Fire Fang / Ice Fang cover
  // Grass/Flying (it already has Head Smash + Crunch + Poltergeist + Dragon Dance).
  SPECIES_NOIBAT_REDUX: [MoveId.PLAY_ROUGH, MoveId.EARTHQUAKE, MoveId.FIRE_FANG, MoveId.ICE_FANG],

  // Honedge Redux → Doublade Redux — physical Fighting/Ghost. Iron Head answers the Fairy
  // it dreads; Stone Edge covers Flying; Sucker Punch is priority vs Psychic; Bulk Up sets
  // up (it already has Close Combat + Sacred Sword + Shadow Sneak + Swords Dance).
  SPECIES_HONEDGE_REDUX: [MoveId.IRON_HEAD, MoveId.STONE_EDGE, MoveId.SUCKER_PUNCH, MoveId.BULK_UP],

  // Aegislash Blade Redux — special Fighting/Ghost (SpA 140) with Stance Change. Flash
  // Cannon answers the Fairy it dreads; Earth Power / Giga Drain add coverage + recovery;
  // Calm Mind sets up (it already has Aura Sphere + Shadow Ball + Nasty Plot).
  SPECIES_AEGISLASH_BLADE_REDUX: [MoveId.FLASH_CANNON, MoveId.EARTH_POWER, MoveId.GIGA_DRAIN, MoveId.CALM_MIND],

  // Abra Redux → Kadabra Redux — fast special Dark (Intimidate / Merciless). Sludge Bomb
  // answers the Fairy it dreads; Thunderbolt / Energy Ball add coverage; Psyshock hits
  // special walls (it already has Dark Pulse + Nasty Plot + Focus Blast).
  SPECIES_ABRA_REDUX: [MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.ENERGY_BALL, MoveId.PSYSHOCK],

  // Weedle Redux → Kakuna Redux — special Ice/Poison with Ice Scales + Compound Eyes.
  // Quiver Dance sets up off its special bulk; Bug Buzz is STAB; Earth Power / Freeze-Dry
  // cover the Fire/Rock/Steel + Water that threaten it (it already has Sludge Bomb + Ice Beam).
  SPECIES_WEEDLE_REDUX: [MoveId.QUIVER_DANCE, MoveId.BUG_BUZZ, MoveId.EARTH_POWER, MoveId.FREEZE_DRY],

  // Stufful Redux → Bewear Redux — physical Normal/Fairy with Sheer Force + Guts. Earthquake
  // answers the Steel/Poison it dreads; Ice Punch / Fire Punch are Sheer-Force-boosted
  // coverage; Swords Dance sets up (it already has Drain Punch + Superpower + Play Rough).
  SPECIES_STUFFUL_REDUX: [MoveId.EARTHQUAKE, MoveId.ICE_PUNCH, MoveId.FIRE_PUNCH, MoveId.SWORDS_DANCE],

  // Panpour Redux → Simipour Redux — special Psychic with Magic Bounce. Aura Sphere answers
  // the Dark it dreads; Shadow Ball covers Ghost; Energy Ball / Ice Beam add coverage (it
  // already has Psychic + Calm Mind + Nasty Plot).
  SPECIES_PANPOUR_REDUX: [MoveId.AURA_SPHERE, MoveId.SHADOW_BALL, MoveId.ENERGY_BALL, MoveId.ICE_BEAM],

  // Pansage Redux → Simisage Redux — physical Fighting with Competitive / Defiant. Swords
  // Dance sets up; Knock Off / Ice Punch / Gunk Shot answer all three of its weaks
  // (Psychic, Flying, Fairy) — it already has Close Combat + No Retreat + Seed Bomb.
  SPECIES_PANSAGE_REDUX: [MoveId.SWORDS_DANCE, MoveId.KNOCK_OFF, MoveId.ICE_PUNCH, MoveId.GUNK_SHOT],

  // Pansear Redux → Simisear Redux — physical Dark with Prankster + Low Blow. Swords Dance
  // sets up; Gunk Shot answers the Fairy it dreads; Knock Off is STAB/utility; Earthquake
  // adds coverage (it already has Sucker Punch + Night Slash + Fire Punch + Bulk Up).
  SPECIES_PANSEAR_REDUX: [MoveId.SWORDS_DANCE, MoveId.GUNK_SHOT, MoveId.KNOCK_OFF, MoveId.EARTHQUAKE],

  // Slugma Redux → Magcargo Redux — slow special Grass (Simple) Shell-Smash sweeper. Trick
  // Room is an alt for its Spe 15; Stored Power snowballs off Simple-doubled boosts; Sludge
  // Bomb / Flash Cannon cover Fairy/Steel (it already has Energy Ball + Earth Power + Shell Smash).
  SPECIES_SLUGMA_REDUX: [MoveId.TRICK_ROOM, MoveId.STORED_POWER, MoveId.SLUDGE_BOMB, MoveId.FLASH_CANNON],

  // Buizel Redux → Floatzel Redux — fast physical Flying with Aerilate + Technician. Extreme
  // Speed becomes Aerilate Flying priority; Low Kick (Technician on light foes) answers
  // Rock/Ice/Steel; Knock Off is utility; Bulk Up sets up (it already has Brave Bird + SD).
  SPECIES_BUIZEL_REDUX: [MoveId.EXTREME_SPEED, MoveId.LOW_KICK, MoveId.KNOCK_OFF, MoveId.BULK_UP],

  // Azelf Redux — fast mixed Dark/Fairy (Dark Aura) glass cannon. Gunk Shot answers the
  // Fairy it dreads; Earthquake covers the Steel/Poison weaks; Knock Off is Dark-Aura STAB;
  // Ice Punch adds coverage (it already has Moonblast + Sucker Punch + Nasty Plot + SD).
  SPECIES_AZELF_REDUX: [MoveId.KNOCK_OFF, MoveId.GUNK_SHOT, MoveId.EARTHQUAKE, MoveId.ICE_PUNCH],

  // Mesprit Redux — bulky mixed Dark/Fairy with Tinted Lens. Calm Mind sets up; Sludge Bomb
  // answers the Fairy it dreads; Thunderbolt / Ice Beam are Tinted-Lens-amplified coverage
  // (it already has Dark Pulse + Moonblast + Earth Power + Nasty Plot).
  SPECIES_MESPRIT_REDUX: [MoveId.CALM_MIND, MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.ICE_BEAM],

  // Uxie Redux — defensive Dark/Fairy wall (Def/SpD 130, Unaware). Body Press weaponizes
  // its huge Def (with Iron Defense); Sludge Bomb / Earth Power answer the Fairy/Steel/Poison
  // it dreads; Thunder Wave is utility (it already has Calm Mind + Cosmic Power + Recover).
  SPECIES_UXIE_REDUX: [MoveId.BODY_PRESS, MoveId.SLUDGE_BOMB, MoveId.EARTH_POWER, MoveId.THUNDER_WAVE],

  // Machop Redux → Machoke Redux — physical Fighting/Dragon with No Guard + Iron Fist. The
  // elemental punches are all Iron-Fist-boosted and never miss (No Guard); Thunder Punch
  // answers the Flying it dreads; Swords Dance sets up (it already has Dynamic Punch + DClaw).
  SPECIES_MACHOP_REDUX: [MoveId.THUNDER_PUNCH, MoveId.ICE_PUNCH, MoveId.FIRE_PUNCH, MoveId.SWORDS_DANCE],

  // Solosis Redux → Duosion Redux — slow special Fire/Water with Adaptability. Trick Room
  // flips its Spe 20; Calm Mind sets up; Earth Power answers the Rock/Electric it dreads;
  // Ice Beam adds coverage (it already has Flamethrower + Scald + Mystical Fire + Recover).
  SPECIES_SOLOSIS_REDUX: [MoveId.TRICK_ROOM, MoveId.CALM_MIND, MoveId.EARTH_POWER, MoveId.ICE_BEAM],

  // Skarmory Redux — fast offensive Steel/Fire flier (Levitate). Iron Head is a reliable
  // Steel STAB; Stone Edge covers Fire/Flying/Bug; Bulk Up sets up; Knock Off is utility
  // (it already has Brave Bird + Heavy Slam + V-create + Swords Dance).
  SPECIES_SKARMORY_REDUX: [MoveId.IRON_HEAD, MoveId.STONE_EDGE, MoveId.BULK_UP, MoveId.KNOCK_OFF],

  // Growlithe Redux → Arcanine Redux — physical Fire/Grass with Tough Claws. Extreme Speed
  // is the iconic Arcanine priority; Stone Edge / Close Combat answer the Flying/Rock it
  // dreads; Swords Dance sets up (it already has Flare Blitz + Wood Hammer + Earthquake).
  SPECIES_GROWLITHE_REDUX: [MoveId.EXTREME_SPEED, MoveId.STONE_EDGE, MoveId.CLOSE_COMBAT, MoveId.SWORDS_DANCE],

  // Whismur Redux → Loudred Redux — special Ghost/Electric with Galvanize + Amplifier.
  // Boomburst becomes a colossal Amplifier-boosted Electric STAB (Galvanize); Giga Drain
  // answers the Ground it dreads (+ heal); Nasty Plot sets up; Earth Power adds coverage.
  SPECIES_WHISMUR_REDUX: [MoveId.BOOMBURST, MoveId.GIGA_DRAIN, MoveId.NASTY_PLOT, MoveId.EARTH_POWER],

  // Gible Redux → Gabite Redux — physical Water/Ghost. Earthquake covers Steel/Rock/Poison;
  // Ice Punch answers the Grass it dreads; Sucker Punch is priority vs the Ghosts it fears;
  // Stone Edge adds coverage (it already has Wave Crash + Shadow Claw + Dragon Dance + SD).
  SPECIES_GIBLE_REDUX: [MoveId.EARTHQUAKE, MoveId.ICE_PUNCH, MoveId.SUCKER_PUNCH, MoveId.STONE_EDGE],

  // Deino Redux → Zweilous Redux — special Fairy/Dragon with Mega Launcher + Pixilate.
  // Hyper Voice becomes a Pixilate-boosted Fairy STAB; Flamethrower / Earth Power answer
  // the Steel/Ice/Poison it dreads; Nasty Plot sets up (it already has Aura Sphere + Moonblast).
  SPECIES_DEINO_REDUX: [MoveId.HYPER_VOICE, MoveId.FLAMETHROWER, MoveId.EARTH_POWER, MoveId.NASTY_PLOT],

  // --- Batch 16: Redux starters/legends + Paradox & box-legend riders -------

  // Pawniard Redux → Bisharp Redux — physical Fighting/Steel (Defiant). Iron Head answers
  // the Fairy it dreads; Sucker Punch is priority; Stone Edge adds coverage; Bulk Up sets
  // up (it already has Sacred Sword + Knock Off + Swords Dance + Bullet Punch).
  SPECIES_PAWNIARD_REDUX: [MoveId.IRON_HEAD, MoveId.SUCKER_PUNCH, MoveId.STONE_EDGE, MoveId.BULK_UP],

  // Mawile Redux — physical Dark/Ghost with Strong Jaw + Adaptability. The elemental fangs
  // are all Strong-Jaw-boosted coverage (Steel/Grass, Flying/Ground, Water); Swords Dance
  // sets up (it already has Crunch + Sucker Punch + Play Rough + Knock Off).
  SPECIES_MAWILE_REDUX: [MoveId.FIRE_FANG, MoveId.ICE_FANG, MoveId.THUNDER_FANG, MoveId.SWORDS_DANCE],

  // Sableye Redux — bulky Steel/Fairy with Magic Guard. Stored Power snowballs off Calm
  // Mind; Earth Power answers the Fire it dreads; Body Press uses its Def; Knock Off is
  // utility (it already has Iron Head + Moonblast + Calm Mind + Nasty Plot).
  SPECIES_SABLEYE_REDUX: [MoveId.STORED_POWER, MoveId.EARTH_POWER, MoveId.BODY_PRESS, MoveId.KNOCK_OFF],

  // Houndour Redux → Houndoom Redux — special Ghost with Flare Boost. Calm Mind sets up;
  // Dazzling Gleam answers the Dark it dreads; Earth Power / Energy Ball add coverage (it
  // already has Shadow Ball + Flamethrower + Mystical Fire + Nasty Plot).
  SPECIES_HOUNDOUR_REDUX: [MoveId.CALM_MIND, MoveId.DAZZLING_GLEAM, MoveId.EARTH_POWER, MoveId.ENERGY_BALL],

  // Doduo Redux → Dodrio Redux — fast physical Poison/Dark with Dragon's Maw. Dragon Dance
  // sets up; Earthquake / Iron Head / Fire Fang cover the Steel/Fairy/Grass that wall it
  // (it already has Gunk Shot + Crunch + Sucker Punch + Dragon Claw).
  SPECIES_DODUO_REDUX: [MoveId.DRAGON_DANCE, MoveId.EARTHQUAKE, MoveId.IRON_HEAD, MoveId.FIRE_FANG],

  // Larvitar Redux → Pupitar Redux — special Rock/Fire with Solar Power. Calm Mind sets up;
  // Giga Drain answers the Water/Ground/Rock it dreads (+ heal); Power Gem is special Rock
  // STAB; Solar Beam is a sun nuke (it already has Earth Power + Flamethrower + Stealth Rock).
  SPECIES_LARVITAR_REDUX: [MoveId.CALM_MIND, MoveId.GIGA_DRAIN, MoveId.POWER_GEM, MoveId.SOLAR_BEAM],

  // Iron Exo — special Ghost/Electric (Quark Drive) with SpA 140. Nasty Plot sets up; Energy
  // Ball answers the Ground it dreads; Dazzling Gleam answers Dark; Flash Cannon adds
  // coverage (it already has Thunderbolt + Shadow Ball + Plasma Fists + Moongeist Beam).
  SPECIES_IRON_EXO: [MoveId.NASTY_PLOT, MoveId.ENERGY_BALL, MoveId.DAZZLING_GLEAM, MoveId.FLASH_CANNON],

  // Basculin Whitestriped → Basculegion — fast physical Water (Adaptability). Shadow Claw /
  // Shadow Sneak give the Ghost STAB + priority Basculegion wants; Earthquake / Zen Headbutt
  // add coverage (it already has Wave Crash + Liquidation + Aqua Jet + Swords Dance).
  SPECIES_BASCULIN_WHITESTRIPED: [MoveId.SHADOW_CLAW, MoveId.SHADOW_SNEAK, MoveId.EARTHQUAKE, MoveId.ZEN_HEADBUTT],

  // Dragonite Delivery — physical Dragon/Flying nuke (Atk 159) with Multiscale. Iron Head /
  // Play Rough together cover ALL four of its weaks (Ice/Rock/Fairy/Dragon); Thunder Punch
  // adds coverage; Swords Dance sets up (it already has Outrage + Earthquake + Extreme Speed).
  SPECIES_DRAGONITE_DELIVERY: [MoveId.IRON_HEAD, MoveId.PLAY_ROUGH, MoveId.THUNDER_PUNCH, MoveId.SWORDS_DANCE],

  // Iron Heart (Ledian Paradox) — physical Steel/Bug with Iron Fist + Quark Drive. Ice Punch /
  // Fire Punch are Iron-Fist-boosted coverage; Swords Dance sets up; Knock Off is utility
  // (it already has Double Iron Bash + Mach Punch + Plasma Fists + Extreme Speed).
  SPECIES_LEDIAN_PARADOX: [MoveId.ICE_PUNCH, MoveId.FIRE_PUNCH, MoveId.SWORDS_DANCE, MoveId.KNOCK_OFF],

  // Bewear Angry — physical Normal/Fighting nuke with Parental Bond + Fur Coat. Earthquake /
  // Ice Punch / Gunk Shot are all Parental-Bond-doubled and cover the Flying/Fairy it dreads;
  // Bulk Up sets up (it already has Close Combat + Extreme Speed + Swords Dance + Knock Off).
  SPECIES_BEWEAR_ANGRY: [MoveId.EARTHQUAKE, MoveId.ICE_PUNCH, MoveId.GUNK_SHOT, MoveId.BULK_UP],

  // Darkrai Nightmare — special Dark nuke (SpA 170) with Bad Dreams + Dark Aura. Sludge Bomb
  // answers the Fairy it dreads; Thunderbolt / Flamethrower / Energy Ball give broad coverage
  // (it already has Dark Pulse + Shadow Ball + Focus Blast + Nasty Plot).
  SPECIES_DARKRAI_NIGHTMARE: [MoveId.SLUDGE_BOMB, MoveId.THUNDERBOLT, MoveId.FLAMETHROWER, MoveId.ENERGY_BALL],

  // Solrock System — mixed Rock/Psychic (Desolate Land) bruiser. Swords Dance sets up;
  // Close Combat / Knock Off / Ice Punch answer the Steel/Dark/Ghost/Ground that wall it
  // (it already has Earthquake + Stone Edge + Zen Headbutt + Shell Smash + V-create).
  SPECIES_SOLROCK_SYSTEM: [MoveId.SWORDS_DANCE, MoveId.CLOSE_COMBAT, MoveId.KNOCK_OFF, MoveId.ICE_PUNCH],

  // Spectrier Cloud — fast special Flying (Adrenaline Rush). Nasty Plot sets up; Earth Power
  // answers the Rock/Electric it dreads; Focus Blast covers Rock/Steel; Ice Beam adds
  // coverage (it already has Hurricane + Bleakwind Storm + Thunderbolt + Weather Ball).
  SPECIES_SPECTRIER_CLOUD: [MoveId.NASTY_PLOT, MoveId.EARTH_POWER, MoveId.FOCUS_BLAST, MoveId.ICE_BEAM],

  // Calyrex Cloud Rider — hyper-fast special Psychic/Flying. Shadow Ball / Earth Power /
  // Focus Blast answer the Ghost/Electric/Rock/Dark that threaten it; Ice Beam adds coverage
  // (it already has Psychic + Hurricane + Calm Mind + Nasty Plot + Expanding Force).
  SPECIES_CALYREX_CLOUD_RIDER: [MoveId.SHADOW_BALL, MoveId.EARTH_POWER, MoveId.FOCUS_BLAST, MoveId.ICE_BEAM],

  // Mawile Redux B — mixed Grass/Poison with Strong Jaw + Chloroplast. Earthquake answers
  // the Fire/Steel/Poison it dreads; Ice Fang / Thunder Fang are Strong-Jaw coverage (Flying/
  // Water); Swords Dance sets up (it already has Power Whip + Sludge Bomb + Leaf Storm + SD).
  SPECIES_MAWILE_REDUX_B: [MoveId.EARTHQUAKE, MoveId.ICE_FANG, MoveId.THUNDER_FANG, MoveId.SWORDS_DANCE],

  // Wigglytuff Apex — special Normal/Fairy tank with Magic Guard. Stored Power snowballs off
  // Calm Mind; Earth Power answers the Poison/Steel it dreads; Psyshock hits special walls;
  // Giga Drain adds recovery (it already has Boomburst + Moonblast + Calm Mind + Wish).
  SPECIES_WIGGLYTUFF_APEX: [MoveId.STORED_POWER, MoveId.EARTH_POWER, MoveId.PSYSHOCK, MoveId.GIGA_DRAIN],

  // Kartana Fallen — physical Grass/Steel nuke (Atk 181) with Beast Boost + Blademaster.
  // Knock Off / Stone Edge / Triple Axel / Throat Chop give the Ghost/Fire/Flying/Psychic
  // coverage its dual STAB lacks (it already has Leaf Blade + Sacred Sword + Swords Dance).
  SPECIES_KARTANA_FALLEN: [MoveId.KNOCK_OFF, MoveId.STONE_EDGE, MoveId.TRIPLE_AXEL, MoveId.THROAT_CHOP],

  // Turtwig Redux → Grotle Redux — very slow bulky Flying/Fairy (Spe 11, Impenetrable).
  // Trick Room flips its Speed; Body Press weaponizes its Def; Earthquake answers the
  // Poison/Rock/Steel/Electric it dreads; Knock Off is utility (it already has Moonblast + SS).
  SPECIES_TURTWIG_REDUX: [MoveId.TRICK_ROOM, MoveId.BODY_PRESS, MoveId.EARTHQUAKE, MoveId.KNOCK_OFF],

  // Chimchar Redux → Monferno Redux — physical Water with Iron Fist + Torrent. Fire Punch
  // answers the Grass it dreads; Thunder Punch covers other Water; Drain Punch is Iron-Fist
  // recovery; Bulk Up sets up (it already has Jet Punch + Ice Punch + Liquidation + Flip Turn).
  SPECIES_CHIMCHAR_REDUX: [MoveId.FIRE_PUNCH, MoveId.THUNDER_PUNCH, MoveId.DRAIN_PUNCH, MoveId.BULK_UP],

  // Piplup Redux → Prinplup Redux — special Fire/Ice (Flash Fire / Solar Power). Calm Mind
  // sets up; Giga Drain answers the Water/Ground/Rock it dreads (+ heal); Earth Power covers
  // Rock/Steel; Flash Cannon adds coverage (it already has Fire Blast + Ice Beam + Freeze-Dry).
  SPECIES_PIPLUP_REDUX: [MoveId.CALM_MIND, MoveId.GIGA_DRAIN, MoveId.EARTH_POWER, MoveId.FLASH_CANNON],

  // Bounsweet Redux → Steenee Redux — special Psychic/Fairy with Water Bubble + Magic Guard.
  // Scald is a Water-Bubble-doubled coverage move; Calm Mind + Stored Power is the wincon;
  // Earth Power answers the Poison/Steel it dreads (it already has Psychic + Pixie Beam + NP).
  SPECIES_BOUNSWEET_REDUX: [MoveId.CALM_MIND, MoveId.STORED_POWER, MoveId.SCALD, MoveId.EARTH_POWER],

  // Toxel Redux → Toxtricity Redux — special Electric/Dark with Loud Bang. Nasty Plot sets
  // up; Giga Drain answers the Ground it dreads (+ heal); Sludge Wave answers Fairy; Focus
  // Blast adds coverage (it already has Boomburst + Overdrive + Thunderbolt + Dark Pulse).
  SPECIES_TOXEL_REDUX: [MoveId.NASTY_PLOT, MoveId.GIGA_DRAIN, MoveId.SLUDGE_WAVE, MoveId.FOCUS_BLAST],

  // Trapinch Redux → Vibrava Redux — physical Ice/Bug (Atk 110) with Strong Jaw + Refrigerate.
  // Swords Dance sets up; Earthquake answers the Fire/Rock/Steel it dreads; Thunder Fang is
  // Strong-Jaw coverage; Stone Edge covers Fire/Flying (it already has Ice Hammer + First Impression).
  SPECIES_TRAPINCH_REDUX: [MoveId.SWORDS_DANCE, MoveId.EARTHQUAKE, MoveId.THUNDER_FANG, MoveId.STONE_EDGE],

  // Crabrawler Redux → Crabominable Redux — physical Fighting/Dark. Swords Dance sets up;
  // Ice Punch answers the Flying it dreads; Earthquake / Stone Edge add coverage (it already
  // has Close Combat + Knock Off + Mach Punch + Bulk Up + Superpower).
  SPECIES_CRABRAWLER_REDUX: [MoveId.SWORDS_DANCE, MoveId.ICE_PUNCH, MoveId.EARTHQUAKE, MoveId.STONE_EDGE],

  // --- Batch 17 (final): remaining Redux lines + the last ER customs --------

  // Cleffa Redux → Clefairy Redux — slow special Rock with Magic Guard. Stored Power
  // snowballs off Calm Mind; Earth Power answers the Steel/Fire it dreads; Trick Room
  // flips its Spe 15 (it already has Power Gem + Dazzling Gleam + Nasty Plot + Moonlight).
  SPECIES_CLEFFA_REDUX: [MoveId.CALM_MIND, MoveId.STORED_POWER, MoveId.EARTH_POWER, MoveId.TRICK_ROOM],

  // Gligar Redux → Gliscor Redux — fast physical Poison/Fire. Earthquake / Stone Edge add
  // coverage; Sucker Punch answers the Psychic it dreads; Knock Off is utility (it already
  // has Cross Poison + Fire Fang + Acrobatics + Swords Dance + U-turn).
  SPECIES_GLIGAR_REDUX: [MoveId.EARTHQUAKE, MoveId.SUCKER_PUNCH, MoveId.STONE_EDGE, MoveId.KNOCK_OFF],

  // Psyduck Redux → Shyduck — physical Dark with Intimidate + Fur Coat. Swords Dance sets
  // up; Sucker Punch is priority; Gunk Shot answers the Fairy it dreads; Earthquake adds
  // coverage (it already has Knock Off + Foul Play + Throat Chop + Nasty Plot).
  SPECIES_PSYDUCK_REDUX: [MoveId.SWORDS_DANCE, MoveId.SUCKER_PUNCH, MoveId.GUNK_SHOT, MoveId.EARTHQUAKE],

  // Seel Redux → Dewgong Redux — special Ice/Dragon (Marvel Scale). Calm Mind sets up;
  // Flamethrower answers the Steel it dreads; Earth Power covers Steel/Rock; Draco Meteor
  // is a Dragon nuke (it already has Ice Beam + Freeze-Dry + Dragon Pulse + Liquidation).
  SPECIES_SEEL_REDUX: [MoveId.CALM_MIND, MoveId.FLAMETHROWER, MoveId.EARTH_POWER, MoveId.DRACO_METEOR],

  // Snorunt Redux → Glalie/Froslass Redux — physical Dark with Prankster + Fur Coat. Swords
  // Dance sets up; Ice Punch keeps the Ice flavor; Gunk Shot answers the Fairy it dreads;
  // Play Rough covers Fighting/Dragon (it already has Crunch + Sucker Punch + Earthquake).
  SPECIES_SNORUNT_REDUX: [MoveId.SWORDS_DANCE, MoveId.ICE_PUNCH, MoveId.GUNK_SHOT, MoveId.PLAY_ROUGH],

  // Darumaka Redux → Darmanitan Redux — physical Ground/Fighting with Sheer Force. Swords
  // Dance sets up; Ice Punch / Gunk Shot are Sheer-Force coverage answering Flying/Fairy/Grass;
  // Knock Off answers Psychic (it already has Close Combat + Earthquake + Fire Punch + Stone Edge).
  SPECIES_DARUMAKA_REDUX: [MoveId.SWORDS_DANCE, MoveId.ICE_PUNCH, MoveId.GUNK_SHOT, MoveId.KNOCK_OFF],

  // Darmanitan Aura — special Rock/Fighting (SpA 150) with Sage Power + Sheer Force. Nasty
  // Plot sets up; Giga Drain answers the Water/Ground it dreads (+ heal); Ice Beam covers
  // Flying/Grass; Sludge Bomb covers Fairy/Grass (it already has Aura Sphere + Earth Power).
  SPECIES_DARMANITAN_REDUX_AURA: [MoveId.NASTY_PLOT, MoveId.GIGA_DRAIN, MoveId.ICE_BEAM, MoveId.SLUDGE_BOMB],

  // Darmanitan Redux Bond — physical Ground/Fighting with Iron Fist + Battle Bond. Swords
  // Dance sets up; Ice Punch is Iron-Fist coverage vs Flying; Gunk Shot answers Fairy/Grass;
  // Knock Off answers Psychic (it already has Fire Punch + Close Combat + Earthquake + Plasma Fists).
  SPECIES_DARMANITAN_REDUX_BOND: [MoveId.SWORDS_DANCE, MoveId.ICE_PUNCH, MoveId.GUNK_SHOT, MoveId.KNOCK_OFF],

  // Blunder-Darmanitan — the apex Ground/Fighting nuke (Atk 170) with Iron Fist + Berserk
  // DNA. Same Iron-Fist coverage as its kin — Swords Dance, Ice Punch, Gunk Shot, Knock Off
  // cover the Flying/Fairy/Grass/Psychic that wall its dual STAB.
  SPECIES_DARMANITAN_REDUX_BLUNDER: [MoveId.SWORDS_DANCE, MoveId.ICE_PUNCH, MoveId.GUNK_SHOT, MoveId.KNOCK_OFF],

  // Happiny Redux → Chansey Redux — fast frail Fighting (Def 5!) with Iron Fist + Long Reach.
  // Drain Punch is Iron-Fist recovery (vital at Def 5); Ice/Thunder Punch are Iron-Fist coverage
  // vs the Flying it dreads; Bulk Up sets up (it already has Dynamic Punch + Aura Sphere).
  SPECIES_HAPPINY_REDUX: [MoveId.DRAIN_PUNCH, MoveId.ICE_PUNCH, MoveId.THUNDER_PUNCH, MoveId.BULK_UP],

  // Spiritomb Redux — bulky special Ghost/Poison (SpD 120) with Toxic Surge. Calm Mind sets
  // up off its bulk; Giga Drain / Energy Ball answer the Ground it dreads (+ heal); Earth
  // Power covers Steel/Rock (it already has Shadow Ball + Sludge Wave + Dazzling Gleam + Recover).
  SPECIES_SPIRITOMB_REDUX: [MoveId.CALM_MIND, MoveId.GIGA_DRAIN, MoveId.EARTH_POWER, MoveId.ENERGY_BALL],

  // Dewpider Redux → Araquanid Redux — bulky physical Ice/Bug. Swords Dance sets up;
  // Earthquake answers the Fire/Rock/Steel it dreads; Ice Shard is priority; Knock Off is
  // utility (it already has Liquidation + Leech Life + Icicle Crash + Sticky Web).
  SPECIES_DEWPIDER_REDUX: [MoveId.SWORDS_DANCE, MoveId.EARTHQUAKE, MoveId.ICE_SHARD, MoveId.KNOCK_OFF],

  // Mimikyu Apex / Apex Busted — physical Ghost/Fairy with Disguise. Drain Punch + Earthquake
  // answer the Steel it dreads (Drain Punch also heals); Knock Off hits Ghosts; Ice Punch adds
  // coverage (both already have Shadow Claw + Play Rough + Swords Dance + Shadow Sneak).
  ...Object.fromEntries(
    ["SPECIES_MIMIKYU_APEX", "SPECIES_MIMIKYU_APEX_BUSTED"].map(k => [
      k,
      [MoveId.DRAIN_PUNCH, MoveId.EARTHQUAKE, MoveId.KNOCK_OFF, MoveId.ICE_PUNCH] as const,
    ]),
  ),

  // Tinkatink Redux → Tinkatuff Redux — physical Water/Poison. Sucker Punch answers the
  // Psychic it dreads; Earthquake / Ice Punch add coverage; Gunk Shot is a stronger Poison
  // STAB (it already has Liquidation + Play Rough + Knock Off + Swords Dance + Tsunami Hammer).
  SPECIES_TINKATINK_REDUX: [MoveId.SUCKER_PUNCH, MoveId.EARTHQUAKE, MoveId.ICE_PUNCH, MoveId.GUNK_SHOT],

  // Scyther Redux → Scizor/Kleavor Redux — mixed Poison/Ground with Speed Boost. U-turn
  // pivots on the speed boost; Iron Head answers the Ice/Fairy it dreads; Knock Off answers
  // Psychic; Ice Spinner adds coverage (it already has Gunk Shot + Earthquake + Swords Dance).
  SPECIES_SCYTHER_REDUX: [MoveId.U_TURN, MoveId.IRON_HEAD, MoveId.KNOCK_OFF, MoveId.ICE_SPINNER],

  // Krabby Redux → Kingler Redux — special Psychic with Serene Grace + Magic Guard. Nasty
  // Plot sets up; Shadow Ball (Serene-Grace SpD drop) answers the Ghost it dreads; Aura
  // Sphere answers Dark; Energy Ball adds coverage (it already has Psyshock + Calm Mind + Stored Power).
  SPECIES_KRABBY_REDUX: [MoveId.NASTY_PLOT, MoveId.SHADOW_BALL, MoveId.AURA_SPHERE, MoveId.ENERGY_BALL],

  // Shinx Redux → Luxio Redux — physical Grass with Guts + Intimidate. Swords Dance sets up;
  // Stone Edge answers four of its weaks (Flying/Fire/Ice/Bug); Knock Off is utility; Sucker
  // Punch is priority (it already has Wood Hammer + Seed Bomb + Play Rough + Giga Drain).
  SPECIES_SHINX_REDUX: [MoveId.SWORDS_DANCE, MoveId.STONE_EDGE, MoveId.KNOCK_OFF, MoveId.SUCKER_PUNCH],

  // Aron Redux → Lairon Redux — slow bulky physical Water/Rock. Curse weaponizes its Def +
  // Spe 26; Body Press uses its Def; Earthquake / Iron Head answer the Electric/Steel/Fairy
  // that threaten it (it already has Liquidation + Stone Edge + Stealth Rock + Spikes).
  SPECIES_ARON_REDUX: [MoveId.CURSE, MoveId.BODY_PRESS, MoveId.EARTHQUAKE, MoveId.IRON_HEAD],

  // Makuhita Redux → Hariyama Redux — slow heavy physical Fire/Steel. Curse sets up off its
  // Spe 23 + bulk; Earthquake answers the Fire/Rock/Steel foes; Stone Edge adds coverage;
  // Bullet Punch is priority (it already has Close Combat + Heavy Slam + Fire Punch + Belly Drum).
  SPECIES_MAKUHITA_REDUX: [MoveId.CURSE, MoveId.EARTHQUAKE, MoveId.STONE_EDGE, MoveId.BULLET_PUNCH],

  // Fogging → Breezing — special Water/Flying with Drizzle. Calm Mind sets up; Earth Power
  // answers the Electric/Rock it dreads; Ice Beam / Giga Drain add coverage + recovery (it
  // already has Hurricane + Hydro Pump + Weather Ball + Nasty Plot).
  SPECIES_FOGGING: [MoveId.CALM_MIND, MoveId.EARTH_POWER, MoveId.ICE_BEAM, MoveId.GIGA_DRAIN],

  // Ralts Redux → Kirlia Redux — special Water with Torrent. Calm Mind sets up; Ice Beam
  // answers the Grass it dreads; Earth Power answers Electric; Scald is a burn-spreading
  // STAB (it already has Liquidation + Brine + Hyper Voice + Nasty Plot + Flip Turn).
  SPECIES_RALTS_REDUX: [MoveId.CALM_MIND, MoveId.ICE_BEAM, MoveId.EARTH_POWER, MoveId.SCALD],

  // Merrykarp → Gyarevelry — special Fire/Fairy (Levitate) with a tiny base movepool.
  // Flamethrower / Moonblast are dual STAB; Earth Power answers the Rock/Steel/Poison it
  // dreads; Nasty Plot sets up — this finally gives the line a real special kit.
  SPECIES_MERRYKARP: [MoveId.FLAMETHROWER, MoveId.MOONBLAST, MoveId.EARTH_POWER, MoveId.NASTY_PLOT],

  // Munchlax Redux → Snorlax Redux — bulky special Water (HP 100, Immunity). Calm Mind sets
  // up; Ice Beam answers the Grass it dreads; Earth Power answers Electric; Giga Drain adds
  // recovery (it already has Hydro Pump + Water Spout + Sludge Bomb + Flash Cannon).
  SPECIES_MUNCHLAX_REDUX: [MoveId.CALM_MIND, MoveId.ICE_BEAM, MoveId.EARTH_POWER, MoveId.GIGA_DRAIN],

  // Spearow Redux → Fearow Redux — fast physical Fighting (Defiant / Sharp Talons). Swords
  // Dance sets up; Sucker Punch / Gunk Shot / Stone Edge answer all three of its weaks
  // (Psychic, Fairy, Flying) — it already has Axe Kick + Knock Off + Acrobatics.
  SPECIES_SPEAROW_REDUX: [MoveId.SWORDS_DANCE, MoveId.SUCKER_PUNCH, MoveId.GUNK_SHOT, MoveId.STONE_EDGE],

  // Slate — fast physical Normal with Skill Link + Technician and a tiny base movepool.
  // Swords Dance sets up; Bullet Seed / Rock Blast / Tail Slap are all Skill-Link-maxed
  // multi-hits (Tail Slap is a Technician-boosted Normal STAB) for broad coverage.
  SPECIES_SLATE: [MoveId.SWORDS_DANCE, MoveId.BULLET_SEED, MoveId.ROCK_BLAST, MoveId.TAIL_SLAP],
};
