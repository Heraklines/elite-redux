// =============================================================================
// AUTO-GENERATED FILE — DO NOT EDIT BY HAND.
// Source: vendor/elite-redux/v2.65beta.json  (ROM gSpeciesInfo dex.hw)
// Regenerate with: node scripts/elite-redux/build-custom-species-weights.mjs
// =============================================================================

/**
 * Body weight (kg) for every ER-custom dump species (pokerogueId >= 10000),
 * consumed by `buildCustomSpecies` (init-elite-redux-custom-species.ts) to feed
 * Heavy Slam / Heat Crash / Grass Knot / Low Kick / Sky Drop and weight-based
 * abilities. Replaces the legacy flat 30.0kg placeholder.
 *
 * Provenance (see the weight-audit report for the full grouped table):
 *   - 802 rows: ROM-extracted (gSpeciesInfo dex.hw[1] / 10).
 *   - 8 rows: canon-derived (blank ROM hw; anchored to a canon pre-evo).
 *   - 10 rows: sprite/size-class estimate (blank ROM hw; no evo anchor).
 *   - 7 rows: form/mega inheriting its base custom's mass.
 * The 25 non-ROM rows are designer-veto candidates and carry an
 * inline provenance note (`EST` marker).
 */
export const ER_CUSTOM_SPECIES_WEIGHTS: Readonly<Record<number, number>> = {
  10000: 63.8,  // Phantowl
  10001: 10.0,  // Duelumber
  10002: 10.0,  // Escarginite
  10003: 47.0,  // Arachtres
  10004: 27.0,  // Flairgrance
  10005: 300.0,  // EST(canon): Beartic(260kg) evo — ice-armoured quadruped, heavier
  10006: 7.4,  // Arashinne
  10007: 700.0,  // Dreadnaut
  10008: 106.0,  // Boarlock
  10009: 51.0,  // Heliomodo
  10010: 48.0,  // EST(canon): Jynx(40.6kg) evo — regal ice diva
  10011: 100.0,  // Beefender
  10012: 48.9,  // Salazarus
  10013: 46.0,  // Gooschase
  10014: 40.0,  // Lepastry
  10015: 230.0,  // EST(canon): Gyarados-class serpent (Magikarp alt-evo)
  10016: 150.0,  // EST(canon): Torkoal(80.4kg) evo — stone-temple shell, much heavier
  10017: 281.0,  // Brontonana
  10018: 500.0,  // Dredwood
  10019: 3.8,  // Corm
  10020: 25.0,  // EST(sprite): large moth (Corm 3.8kg evo)
  10021: 15.0,  // EST(sprite): fluffy popcorn puff (Corm 3.8kg evo)
  10022: 130.0,  // EST(sprite): large ice predator (BST590 standalone)
  10023: 120.0,  // EST(sprite): Slaking-class sloth (Slaking 130.5kg analogue)
  10024: 59.0,  // Iron Carapace
  10025: 180.0,  // EST(sprite): magma golem (BST580 standalone)
  10026: 92.0,  // Kaiosea
  10027: 55.0,  // EST(canon): Golduck-class duck (Psyduck line final, leaner/taller)
  10028: 30.0,  // EST(canon): Psyduck(19.6kg) evo — cloaked mid-stage duck
  10029: 2.3,  // Marbeep
  10030: 9.0,  // Fluffbee
  10031: 38.7,  // Amphybuzz
  10032: 150.0,  // EST(canon): Dewgong(120kg) evo — larger sea-lion
  10033: 200.0,  // EST(canon): Crabominable(180kg) evo — heavyweight boxer crab
  10034: 68.0,  // Phanfernal
  10035: 165.0,  // Skulberus
  10036: 13.8,  // Velozel
  10037: 6.9,  // Bewarden Redux
  10038: 20.0,  // Bubbleo
  10039: 54.0,  // Hydroar
  10040: 50.0,  // EST(sprite): granite apple-dragon (Appletun 13kg evo, stone-laden)
  10041: 15.0,  // EST(sprite): winged apple-dragon (Flapple 1kg evo)
  10042: 3.4,  // Burmy Eterna
  10043: 6.0,  // Sagaracas
  10044: 45.0,  // Lucineon
  10045: 50.0,  // EST(sprite): armoured crab-warrior (Crawdaunt 32.8kg analogue, bulkier)
  10046: 62.0,  // Scrafster
  10047: 22.6,  // Iron Voca
  10048: 5.0,  // EST(sprite): small electric rodent (Morpeko 3kg analogue)
  10049: 180.0,  // Frostula
  10050: 770.0,  // Dududunsparce
  10051: 770.0,  // Dududunsparce Mega
  10052: 39.8,  // Ogerpon Mega
  10053: 39.8,  // Ogerpon Hearthflame Mega
  10054: 39.8,  // Ogerpon Cornerstone Mega
  10055: 39.8,  // Ogerpon Wellspring
  10056: 27.0,  // Seerkat
  10057: 55.0,  // Tentagrewl
  10058: 77.4,  // Cacjack
  10059: 14.3,  // Tyranjoula
  10060: 42.4,  // Crag Hopper
  10061: 16.0,  // Dedelibird
  10062: 16.0,  // Krampird
  10063: 22.0,  // Iron Palette
  10064: 210.0,  // Carbonix
  10065: 0.3,  // Wispywaspy
  10066: 6.9,  // Iron Scythe
  10067: 6.9,  // Wooly Worm
  10068: 6.9,  // Heracreus
  10069: 0.3,  // Grotom
  10070: 6.9,  // Orchestot
  10071: 6.9,  // Queengambit
  10072: 6.9,  // Pentadug
  10073: 180.0,  // Crabominable Mega
  10074: 6.9,  // Abyssand
  10075: 6.9,  // Pentawug
  10076: 6.9,  // Ratiking
  10077: 6.9,  // Ratfioso
  10078: 6.9,  // Guardozel
  10079: 6.9,  // Beniccino
  10080: 6.9,  // Bewarden
  10081: 6.9,  // Torrentula
  10082: 6.9,  // Spindaze
  10083: 6.9,  // Blocli
  10084: 6.9,  // Bloxtack
  10085: 6.9,  // Gargablox
  10086: 6.9,  // Hippopotato
  10087: 6.9,  // Hippotaton
  10088: 6.9,  // Corn Tyrant
  10089: 6.9,  // Iron Spirals
  10090: 6.9,  // Iron Saber
  10091: 6.9,  // Hypnocroak
  10092: 700.0,  // Plundertow
  10093: 100.0,  // Venusaur Mega Y
  10094: 90.5,  // Charizard Mega X
  10095: 90.5,  // Charizard Mega Y
  10096: 85.5,  // Blastoise Mega Y
  10097: 29.5,  // Beedrill Mega
  10098: 39.5,  // Pidgeot Mega
  10099: 48.0,  // Alakazam Mega
  10100: 78.5,  // Slowbro Mega
  10101: 40.5,  // Gengar Mega Y
  10102: 80.0,  // Kangaskhan Mega
  10103: 55.0,  // Pinsir Mega
  10104: 235.0,  // Gyarados Mega X
  10105: 59.0,  // Aerodactyl Mega
  10106: 122.0,  // Mewtwo Mega X
  10107: 122.0,  // Mewtwo Mega Y
  10108: 61.5,  // Ampharos Mega
  10109: 400.0,  // Steelix Mega
  10110: 118.0,  // Scizor Mega
  10111: 54.0,  // Heracross Mega
  10112: 35.0,  // Houndoom Mega
  10113: 202.0,  // Tyranitar Mega
  10114: 52.2,  // Sceptile Mega
  10115: 52.0,  // Blaziken Mega
  10116: 81.9,  // Swampert Mega
  10117: 48.4,  // Gardevoir Mega
  10118: 11.0,  // Sableye Mega
  10119: 11.5,  // Mawile Mega
  10120: 360.0,  // Aggron Mega
  10121: 31.5,  // Medicham Mega
  10122: 40.2,  // Manectric Mega
  10123: 88.8,  // Sharpedo Mega
  10124: 220.0,  // Camerupt Mega
  10125: 20.6,  // Altaria Mega
  10126: 12.5,  // Banette Mega
  10127: 47.0,  // Absol Mega
  10128: 256.5,  // Glalie Mega
  10129: 102.6,  // Salamence Mega
  10130: 550.0,  // Metagross Mega
  10131: 40.0,  // Latias Mega
  10132: 60.0,  // Latios Mega
  10133: 33.3,  // Lopunny Mega
  10134: 95.0,  // Garchomp Mega
  10135: 54.0,  // Lucario Mega X
  10136: 135.5,  // Abomasnow Mega
  10137: 52.0,  // Gallade Mega
  10138: 31.0,  // Audino Mega
  10139: 8.8,  // Diancie Mega
  10140: 206.5,  // Rayquaza Mega
  10141: 352.0,  // Kyogre Primal
  10142: 950.0,  // Groudon Primal
  10180: 6.0,  // Pikachu Cosplay
  10181: 6.0,  // Pikachu Rock Star
  10182: 6.0,  // Pikachu Belle
  10183: 6.0,  // Pikachu Pop Star
  10184: 6.0,  // Pikachu Ph D
  10185: 6.0,  // Pikachu Libre
  10186: 6.0,  // Pikachu Kanto
  10187: 6.0,  // Pikachu Hoenn
  10188: 6.0,  // Pikachu Sinnoh
  10189: 6.0,  // Pikachu Unova
  10190: 6.0,  // Pikachu Kalos
  10191: 6.0,  // Pikachu Alola
  10192: 6.0,  // Pikachu Partner Cap
  10193: 6.0,  // Pikachu World
  10194: 2.0,  // Pichu Spiky
  10195: 5.0,  // Unown B
  10196: 5.0,  // Unown C
  10197: 5.0,  // Unown D
  10198: 5.0,  // Unown E
  10199: 5.0,  // Unown F
  10200: 5.0,  // Unown G
  10201: 5.0,  // Unown H
  10202: 5.0,  // Unown I
  10203: 5.0,  // Unown J
  10204: 5.0,  // Unown K
  10205: 5.0,  // Unown L
  10206: 5.0,  // Unown M
  10207: 5.0,  // Unown N
  10208: 5.0,  // Unown O
  10209: 5.0,  // Unown P
  10210: 5.0,  // Unown Q
  10211: 5.0,  // Unown R
  10212: 5.0,  // Unown S
  10213: 5.0,  // Unown T
  10214: 5.0,  // Unown U
  10215: 5.0,  // Unown V
  10216: 5.0,  // Unown W
  10217: 5.0,  // Unown X
  10218: 5.0,  // Unown Y
  10219: 5.0,  // Unown Z
  10220: 5.0,  // Unown Emark
  10221: 5.0,  // Unown Qmark
  10222: 0.8,  // Castform Sunny
  10223: 0.8,  // Castform Rainy
  10224: 0.8,  // Castform Snowy
  10225: 60.8,  // Deoxys Attack
  10226: 60.8,  // Deoxys Defense
  10227: 60.8,  // Deoxys Speed
  10228: 3.4,  // Burmy Sandy
  10229: 3.4,  // Burmy Trash
  10230: 6.5,  // Wormadam Sandy
  10231: 6.5,  // Wormadam Trash
  10232: 9.3,  // Cherrim Sunshine
  10233: 6.3,  // Shellos East
  10234: 29.9,  // Gastrodon East
  10235: 0.3,  // Rotom Heat
  10236: 0.3,  // Rotom Wash
  10237: 0.3,  // Rotom Frost
  10238: 0.3,  // Rotom Fan
  10239: 0.3,  // Rotom Mow
  10240: 750.0,  // Giratina Origin
  10241: 2.1,  // Shaymin Sky
  10242: 320.0,  // Arceus Fighting
  10243: 320.0,  // Arceus Flying
  10244: 320.0,  // Arceus Poison
  10245: 320.0,  // Arceus Ground
  10246: 320.0,  // Arceus Rock
  10247: 320.0,  // Arceus Bug
  10248: 320.0,  // Arceus Ghost
  10249: 320.0,  // Arceus Steel
  10250: 320.0,  // Arceus Fire
  10251: 320.0,  // Arceus Water
  10252: 320.0,  // Arceus Grass
  10253: 320.0,  // Arceus Electric
  10254: 320.0,  // Arceus Psychic
  10255: 320.0,  // Arceus Ice
  10256: 320.0,  // Arceus Dragon
  10257: 320.0,  // Arceus Dark
  10258: 320.0,  // Arceus Fairy
  10259: 18.0,  // Basculin Blue
  10260: 92.9,  // Darmanitan Zen
  10261: 92.9,  // Darmanitan Zen Mode Galarian
  10262: 19.5,  // Deerling Summer
  10263: 19.5,  // Deerling Autumn
  10264: 19.5,  // Deerling Winter
  10265: 92.5,  // Sawsbuck Summer
  10266: 92.5,  // Sawsbuck Autumn
  10267: 92.5,  // Sawsbuck Winter
  10268: 63.0,  // Tornadus Therian
  10269: 61.0,  // Thundurus Therian
  10270: 68.0,  // Landorus Therian
  10271: 325.0,  // Kyurem White
  10272: 325.0,  // Kyurem Black
  10273: 48.5,  // Keldeo Resolute
  10274: 6.5,  // Meloetta Pirouette
  10275: 82.5,  // Genesect Douse Drive
  10276: 82.5,  // Genesect Shock Drive
  10277: 82.5,  // Genesect Burn Drive
  10278: 82.5,  // Genesect Chill Drive
  10279: 40.0,  // Greninja Battle Bond
  10280: 40.0,  // Ash-Greninja
  10281: 17.0,  // Vivillon Polar
  10282: 17.0,  // Vivillon Tundra
  10283: 17.0,  // Vivillon Continental
  10284: 17.0,  // Vivillon Gardens
  10285: 17.0,  // Vivillon Elegant
  10286: 17.0,  // Vivillon Meadow
  10287: 17.0,  // Vivillon Modern
  10288: 17.0,  // Vivillon Marine
  10289: 17.0,  // Vivillon Archipelago
  10290: 17.0,  // Vivillon High Plains
  10291: 17.0,  // Vivillon Sandstorm
  10292: 17.0,  // Vivillon River
  10293: 17.0,  // Vivillon Monsoon
  10294: 17.0,  // Vivillon Savanna
  10295: 17.0,  // Vivillon Sun
  10296: 17.0,  // Vivillon Ocean
  10297: 17.0,  // Vivillon Jungle
  10298: 17.0,  // Vivillon Fancy
  10299: 17.0,  // Vivillon Pokéball
  10300: 0.1,  // Flabebe Yellow
  10301: 0.1,  // Flabebe Orange
  10302: 0.1,  // Flabebe Blue
  10303: 0.1,  // Flabebe White
  10304: 0.9,  // Floette Yellow
  10305: 0.9,  // Floette Orange
  10306: 0.9,  // Floette Blue
  10307: 0.9,  // Floette White
  10308: 0.9,  // Floette Eternal Flower
  10309: 10.0,  // Florges Yellow
  10310: 10.0,  // Florges Orange
  10311: 10.0,  // Florges Blue
  10312: 10.0,  // Florges White
  10313: 28.0,  // Furfrou Heart
  10314: 28.0,  // Furfrou Star
  10315: 28.0,  // Furfrou Diamond
  10316: 28.0,  // Furfrou Debutante
  10317: 28.0,  // Furfrou Matron
  10318: 28.0,  // Furfrou Dandy
  10319: 28.0,  // Furfrou La Reine
  10320: 28.0,  // Furfrou Kabuki
  10321: 28.0,  // Furfrou Pharaoh
  10322: 8.5,  // Meowstic Female
  10323: 53.0,  // Aegislash Blade
  10324: 5.0,  // Pumpkaboo Small
  10325: 5.0,  // Pumpkaboo Large
  10326: 5.0,  // Pumpkaboo Super
  10327: 12.5,  // Gourgeist Small
  10328: 12.5,  // Gourgeist Large
  10329: 12.5,  // Gourgeist Super
  10330: 215.0,  // Xerneas Active
  10331: 305.0,  // Zygarde 10
  10332: 305.0,  // Zygarde 10 Power Construct
  10333: 305.0,  // Zygarde 50 Power Construct
  10334: 305.0,  // Zygarde Complete
  10335: 9.0,  // Hoopa Unbound
  10336: 3.4,  // Oricorio Pom Pom
  10337: 3.4,  // Oricorio Pau
  10338: 3.4,  // Oricorio Sensu
  10339: 9.2,  // Rockruff Own Tempo
  10340: 25.0,  // Lycanroc Midnight
  10341: 25.0,  // Lycanroc Dusk
  10342: 0.3,  // Wishiwashi School
  10343: 100.5,  // Silvally Fighting
  10344: 100.5,  // Silvally Flying
  10345: 100.5,  // Silvally Poison
  10346: 100.5,  // Silvally Ground
  10347: 100.5,  // Silvally Rock
  10348: 100.5,  // Silvally Bug
  10349: 100.5,  // Silvally Ghost
  10350: 100.5,  // Silvally Steel
  10351: 100.5,  // Silvally Fire
  10352: 100.5,  // Silvally Water
  10353: 100.5,  // Silvally Grass
  10354: 100.5,  // Silvally Electric
  10355: 100.5,  // Silvally Psychic
  10356: 100.5,  // Silvally Ice
  10357: 100.5,  // Silvally Dragon
  10358: 100.5,  // Silvally Dark
  10359: 100.5,  // Silvally Fairy
  10360: 40.0,  // Minior Orange
  10361: 40.0,  // Minior Yellow
  10362: 40.0,  // Minior Green
  10363: 40.0,  // Minior Blue
  10364: 40.0,  // Minior Indigo
  10365: 40.0,  // Minior Violet
  10366: 40.0,  // Minior Core Red
  10367: 40.0,  // Minior Core Orange
  10368: 40.0,  // Minior Core Yellow
  10369: 40.0,  // Minior Core Green
  10370: 40.0,  // Minior Core Blue
  10371: 40.0,  // Minior Core Indigo
  10372: 40.0,  // Minior Core Violet
  10373: 0.7,  // Mimikyu Busted
  10374: 230.0,  // Dusk Mane
  10375: 230.0,  // Dawn Wings
  10376: 230.0,  // Necrozma Ultra
  10377: 80.5,  // Magearna Original
  10378: 18.0,  // Cramorant Gulping
  10379: 18.0,  // Cramorant Gorging
  10380: 40.0,  // Toxtricity Low Key
  10381: 0.2,  // Sinistea Antique
  10382: 0.4,  // Polteageist Antique
  10383: 0.5,  // Alcremie Ruby
  10384: 0.5,  // Alcremie Matcha
  10385: 0.5,  // Alcremie Mint
  10386: 0.5,  // Alcremie Lemon
  10387: 0.5,  // Alcremie Salted
  10388: 0.5,  // Alcremie Ruby Swirl
  10389: 0.5,  // Alcremie Caramel
  10390: 0.5,  // Alcremie Rainbow
  10391: 89.0,  // Eiscue Noice Face
  10392: 28.0,  // Indeedee Female
  10393: 3.0,  // Morpeko Hangry
  10394: 110.0,  // Zacian Crowned
  10395: 210.0,  // Zamazenta Crowned
  10396: 950.0,  // Eternatus Primal
  10397: 105.0,  // Urshifu Rapid Strike Style
  10398: 70.0,  // Zarude Dada
  10399: 7.7,  // Calyrex Ice Rider
  10400: 7.7,  // Calyrex Shadow Rider
  10417: 88.4,  // Tauros Paldean Aqua Breed
  10418: 88.4,  // Tauros Paldean Blaze Breed
  10419: 88.4,  // Tauros Paldean Combat Breed
  10420: 290.0,  // Ursaluna Bloodmoon
  10421: 60.2,  // Palafin Hero
  10422: 39.2,  // Dudunsparce Three
  10423: 2.3,  // Maushold Four
  10424: 8.0,  // Tatsugiri Curly
  10425: 8.0,  // Tatsugiri Stretchy
  10426: 8.0,  // Tatsugiri Droopy
  10427: 2.4,  // Squawkabilly Green Plumage
  10428: 2.4,  // Squawkabilly Blue
  10429: 2.4,  // Squawkabilly Yellow
  10430: 2.4,  // Squawkabilly White
  10431: 39.8,  // Ogerpon Wellspring Mask
  10432: 39.8,  // Ogerpon Hearthflame
  10433: 39.8,  // Ogerpon Cornerstone
  10434: 683.0,  // Dialga Origin
  10435: 336.0,  // Palkia Origin
  10436: 48.0,  // Enamorus Therian
  10437: 0.8,  // Castform Sandy
  10438: 300.0,  // EST(form): Polartic(1031) Bluemoon form
  10439: 120.0,  // EST(form): Lumber Sloth(1049) Engulfed form
  10440: 5.0,  // Gimmighoul Roaming
  10441: 110.0,  // Basculegion F
  10442: 10.0,  // Terapagos Primal
  10443: 54.0,  // Hydroar F
  10444: 6.0,  // Pikachu Partner
  10445: 6.5,  // Eevee Partner
  10446: 4.2,  // Meowth Partner
  10447: 0.7,  // Mimikyu Primal
  10448: 130.5,  // Slaking Mega Ape Shift
  10449: 30.0,  // Raichu Mega Y
  10450: 0.8,  // Castform Foggy
  10451: 90.0,  // Chesnaught Battle Bond
  10452: 90.0,  // Clemont-Chesnaught
  10453: 39.0,  // Delphox Battle Bond
  10454: 39.0,  // Serena-Delphox
  10455: 5.0,  // EST(form): Morpekyll(1075) Hangry form (same mass)
  10456: 5.0,  // Unown Revelation
  10457: 25.0,  // Lycanroc Eclipse
  10458: 25.0,  // Lycanroc Twilight
  10459: 30.0,  // Scrafty Mega
  10460: 62.0,  // Falinks Mega
  10461: 81.5,  // Pyroar Mega
  10462: 90.0,  // Chesnaught Mega
  10463: 39.0,  // Delphox Mega
  10464: 40.0,  // Greninja Mega
  10465: 80.5,  // Eelektross Mega
  10466: 47.0,  // Malamar Mega
  10467: 15.5,  // Victreebel Mega
  10468: 81.5,  // Dragalge Mega
  10469: 21.5,  // Hawlucha Mega
  10470: 40.0,  // Clefable Mega Y
  10471: 210.0,  // Dragonite Mega Y
  10472: 40.4,  // Excadrill Mega
  10473: 200.5,  // Scolipede Mega
  10474: 34.3,  // Chandelure Mega Y
  10475: 0.9,  // Floette Mega
  10476: 305.0,  // Zygarde Mega
  10477: 96.0,  // Barbaracle Mega
  10478: 185.0,  // Drampa Mega
  10479: 80.0,  // Starmie Mega
  10480: 50.5,  // Skarmory Mega Y
  10481: 26.6,  // Froslass Mega Y
  10482: 162.0,  // Milotic Mega
  10483: 32.0,  // Butterfree Mega
  10484: 130.0,  // Machamp Mega
  10485: 60.0,  // Kingler Mega
  10486: 220.0,  // Lapras Mega Y
  10487: 82.0,  // Flygon Mega
  10488: 152.0,  // Kingdra Mega X
  10489: 120.0,  // Dewgong Mega
  10490: 50.2,  // Hitmonchan Mega
  10491: 49.8,  // Hitmonlee Mega
  10492: 48.0,  // Hitmontop Mega
  10493: 75.0,  // Crobat Mega
  10494: 50.5,  // Skarmory Mega X
  10495: 310.0,  // Torterra Mega
  10496: 55.0,  // Infernape Mega
  10497: 84.5,  // Empoleon Mega
  10498: 20.5,  // Shuckle Mega
  10499: 23.4,  // Relicanth Mega
  10500: 26.0,  // Toucannon Mega
  10501: 210.0,  // Dragonite Mega
  10502: 39.2,  // Breloom Mega
  10503: 130.5,  // Slaking Mega
  10504: 88.8,  // Feraligatr Mega X
  10505: 88.8,  // Feraligatr Mega Y
  10506: 48.7,  // Granbull Mega
  10507: 75.0,  // Quagsire Mega
  10508: 235.0,  // Gyarados Mega Y
  10509: 105.5,  // Haxorus Mega
  10510: 100.5,  // Meganium Mega
  10511: 42.0,  // Luxray Mega
  10512: 62.0,  // Nidoking Mega
  10513: 60.0,  // Nidoqueen Mega
  10514: 29.5,  // Sandslash Mega
  10515: 79.5,  // Typhlosion Mega
  10516: 96.3,  // Krookodile Mega
  10517: 180.0,  // Magnezone Mega
  10518: 1.2,  // Shedinja Mega
  10519: 80.0,  // Swalot Mega
  10520: 22.5,  // Lanturn Mega
  10521: 220.0,  // Lapras Mega X
  10522: 79.5,  // Slowking Mega
  10523: 0.5,  // Ribombee Mega
  10524: 48.0,  // Alakazam Mega Redux
  10525: 29.5,  // Beedrill Mega Redux
  10526: 130.0,  // Machamp Mega Redux
  10527: 50.5,  // Skarmory Mega
  10528: 155.0,  // Arcanine Mega
  10529: 95.0,  // Garchomp Mega Redux
  10530: 11.5,  // Mawile Mega Redux
  10531: 11.0,  // Sableye Mega Redux
  10532: 35.0,  // Houndoom Mega Redux
  10533: 26.6,  // Froslass Mega X
  10534: 12.0,  // Wigglytuff Mega X
  10535: 11.5,  // Cascoon Primal
  10536: 12.0,  // Wigglytuff Mega Y
  10537: 54.0,  // Lucario Mega Z
  10538: 300.0,  // EST(form): Gyaradeath(1041) Mega X (+~30% per Gyarados-mega)
  10539: 300.0,  // EST(form): Gyaradeath(1041) Mega Y
  10540: 65.0,  // Arbok Mega
  10541: 120.0,  // Kingambit Mega
  10542: 108.0,  // Golisopod Mega Y
  10543: 95.0,  // Rapidash Mega
  10544: 95.0,  // Rapidash Mega Galarian
  10545: 3.4,  // Oricorio Mega
  10546: 53.0,  // Aegislash Mega
  10547: 53.0,  // Aegislash Blade Redux Mega
  10548: 20.1,  // Reuniclus Mega
  10549: 160.0,  // Hydreigon Mega
  10550: 35.0,  // EST(form): Cormoth(1046) Mega
  10551: 22.0,  // EST(form): Popcorm(1047) Mega
  10552: 310.0,  // Torterra Redux Mega
  10553: 55.0,  // Infernape Redux Mega
  10554: 84.5,  // Empoleon Redux Mega
  10555: 21.4,  // Tsareena Mega
  10556: 40.0,  // Toxtricity Mega
  10557: 40.0,  // Toxtricity Redux Fuzz Mega
  10558: 82.0,  // Flygon Redux Mega
  10559: 40.0,  // Clefable Mega
  10560: 256.5,  // Glalie Redux Mega
  10561: 26.6,  // Froslass Mega
  10562: 38.7,  // Amphybuzz Mega
  10563: 105.0,  // Urshifu Mega
  10564: 105.0,  // Urshifu Rapid Strike Style Mega
  10565: 80.0,  // Melmetal Mega
  10566: 100.0,  // Venusaur Mega X
  10567: 85.5,  // Blastoise Mega X
  10568: 40.5,  // Gengar Mega X
  10569: 90.5,  // Charizard Mega Z
  10570: 460.0,  // Snorlax Mega
  10571: 90.0,  // Rillaboom Mega
  10572: 33.0,  // Cinderace Mega
  10573: 45.2,  // Inteleon Mega
  10574: 75.0,  // Corviknight Mega
  10575: 115.5,  // Drednaw Mega
  10576: 310.5,  // Coalossal Mega
  10577: 65.5,  // Sandaconda Mega
  10578: 650.0,  // Copperajah Mega
  10579: 5.1,  // Hatterene Mega
  10580: 107.3,  // Garbodor Mega
  10581: 40.8,  // Orbeetle Mega
  10582: 61.0,  // Grimmsnarl Mega
  10583: 120.0,  // Centiskorch Mega
  10584: 0.5,  // Alcremie Mega
  10585: 40.0,  // Toxtricity Mega
  10586: 6.0,  // Pikachu Mega
  10587: 6.5,  // Eevee Mega
  10588: 4.2,  // Meowth Mega
  10589: 34.0,  // Weavile Mega
  10590: 63.0,  // Serperior Mega
  10591: 150.0,  // Emboar Mega
  10592: 94.6,  // Samurott Mega
  10593: 36.6,  // Decidueye Mega
  10594: 36.6,  // Decidueye Hisuian Mega
  10595: 83.0,  // Incineroar Mega
  10596: 31.2,  // Meowscarada Mega
  10597: 44.0,  // Primarina Mega
  10598: 61.9,  // Quaquaval Mega
  10599: 94.6,  // Samurott Hisuian Mega
  10600: 326.5,  // Skeledirge Mega
  10601: 79.5,  // Typhlosion Hisuian Mega
  10602: 35.5,  // Mienshao Mega
  10603: 155.0,  // Arcanine Mega
  10604: 150.5,  // Goodra Mega
  10605: 78.5,  // Slowbro Mega Galarian
  10606: 79.5,  // Slowking Mega Galarian
  10607: 14.5,  // Roserade Mega
  10608: 223.0,  // Clodsire Mega
  10609: 44.0,  // Gothitelle Mega
  10610: 155.0,  // Arcanine Hisuian Mega
  10611: 20.1,  // Reuniclus Mega
  10612: 7.6,  // Kipmodo
  10613: 28.0,  // Marshmodo
  10614: 81.9,  // Swampage
  10615: 81.9,  // Swampage Mega
  10616: 34.3,  // Chandelure Mega X
  10617: 52.6,  // Zapdos Mega
  10618: 55.4,  // Articuno Mega
  10619: 60.0,  // Moltres Mega
  10620: 52.6,  // Zapdos Ex
  10621: 55.4,  // Articuno Ex
  10622: 60.0,  // Moltres Ex
  10623: 5.8,  // Minccino Redux
  10624: 7.5,  // Cinccino Redux
  10625: 7.5,  // Frostuccino
  10626: 0.2,  // Sinistea Redux
  10627: 0.4,  // Polteageist Redux
  10628: 15.0,  // Cetoddle Redux
  10629: 700.0,  // Cetitan Redux
  10630: 24.5,  // Talonflame Mega
  10631: 210.0,  // Carbonix Mega
  10632: 0.3,  // Grotom Glass
  10633: 0.3,  // Grotom Roll
  10634: 0.3,  // Grotom Drum
  10635: 0.3,  // Grotom Kick
  10636: 0.3,  // Grotom Fill
  10637: 6.9,  // Heracreus Mega
  10638: 0.3,  // Wispywaspy Hivemind
  10639: 50.0,  // Dragapult Mega
  10640: 29.5,  // Sandslash Alolan Mega
  10641: 10.0,  // Kleavor Mega
  10642: 56.0,  // Scyther Mega
  10643: 160.0,  // Hydreigon Mega
  10644: 57.5,  // Vanilluxe Mega
  10645: 6.9,  // Pentadug Alolan
  10646: 3.5,  // Rattata Redux
  10647: 18.5,  // Raticate Redux
  10648: 5.7,  // Vanillite Redux
  10649: 41.0,  // Vanillish Redux
  10650: 57.5,  // Vanilluxe Redux
  10651: 57.5,  // Vanilluxe Redux Mega
  10652: 3.1,  // Litwick Redux
  10653: 13.0,  // Lampent Redux
  10654: 34.3,  // Chandelure Redux
  10655: 34.3,  // Chandelure Mega
  10656: 8.5,  // Drilbur Redux
  10657: 40.4,  // Excadrill Redux
  10658: 6.9,  // Rexcadrill
  10659: 6.5,  // Swinub Redux
  10660: 55.8,  // Piloswine Redux
  10661: 291.0,  // Mamoswine Redux
  10662: 291.0,  // Mamoswine Mega
  10663: 6.9,  // Selenumbra
  10664: 28.8,  // Larvesta Redux
  10665: 46.0,  // Volcarona Redux
  10666: 3.0,  // Klefki Redux
  10667: 4.0,  // Bellsprout Redux
  10668: 6.4,  // Weepinbell Redux
  10669: 15.5,  // Victreebel Redux
  10670: 51.0,  // Sawk Redux
  10671: 55.5,  // Throh Redux
  10672: 43.0,  // Sneasler Mega
  10673: 40.0,  // Clefable Mega
  10674: 21.4,  // Tsareena Mega
  10675: 150.5,  // Goodra Hisuian Mega
  10676: 253.8,  // Hariyama Mega
  10677: 1.2,  // Swablu Redux
  10678: 20.6,  // Altaria Redux
  10679: 20.6,  // Altaria Redux Mega
  10680: 6.9,  // Eraticate
  10681: 2.5,  // Exeggcute Redux
  10682: 120.0,  // Exeggutor Redux
  10683: 42.0,  // Luxzero Mega
  10684: 120.0,  // Kecleong
  10685: 55.0,  // Infernape Redux B
  10686: 8.0,  // Noibat Redux
  10687: 85.0,  // Noivern Redux
  10688: 42.0,  // Luxzero
  10689: 35.3,  // Clawtificer
  10690: 2.0,  // Honedge Redux
  10691: 4.5,  // Doublade Redux
  10692: 53.0,  // Aegislash Redux
  10693: 53.0,  // Aegislash Blade Redux
  10694: 19.5,  // Abra Redux
  10695: 56.5,  // Kadabra Redux
  10696: 48.0,  // Alakazam Redux
  10697: 3.2,  // Weedle Redux
  10698: 10.0,  // Kakuna Redux
  10699: 29.5,  // Beedrill Redux
  10700: 6.8,  // Stufful Redux
  10701: 135.0,  // Bewear Redux
  10702: 13.5,  // Panpour Redux
  10703: 29.0,  // Simipour Redux
  10704: 10.5,  // Pansage Redux
  10705: 30.5,  // Simisage Redux
  10706: 11.0,  // Pansear Redux
  10707: 28.0,  // Simisear Redux
  10708: 35.0,  // Slugma Redux
  10709: 55.0,  // Magcargo Redux
  10710: 29.5,  // Buizel Redux
  10711: 33.5,  // Floatzel Redux
  10712: 0.3,  // Azelf Redux
  10713: 0.3,  // Mesprit Redux
  10714: 0.3,  // Uxie Redux
  10715: 19.5,  // Machop Redux
  10716: 70.5,  // Machoke Redux
  10717: 130.0,  // Machamp Redux
  10718: 1.0,  // Solosis Redux
  10719: 8.0,  // Duosion Redux
  10720: 20.1,  // Reuniclus Redux
  10721: 50.5,  // Skarmory Redux
  10722: 19.0,  // Growlithe Redux
  10723: 155.0,  // Arcanine Redux
  10724: 16.3,  // Whismur Redux
  10725: 40.5,  // Loudred Redux
  10726: 84.0,  // Exploud Redux
  10727: 20.5,  // Gible Redux
  10728: 56.0,  // Gabite Redux
  10729: 95.0,  // Garchomp Redux
  10730: 17.3,  // Deino Redux
  10731: 50.0,  // Zweilous Redux
  10732: 160.0,  // Hydreigon Redux
  10733: 10.2,  // Pawniard Redux
  10734: 70.0,  // Bisharp Redux
  10735: 11.5,  // Mawile Redux
  10736: 11.0,  // Sableye Redux
  10737: 10.8,  // Houndour Redux
  10738: 35.0,  // Houndoom Redux
  10739: 39.2,  // Doduo Redux
  10740: 85.2,  // Dodrio Redux
  10741: 120.0,  // Kingambit Redux
  10742: 72.0,  // Larvitar Redux
  10743: 152.0,  // Pupitar Redux
  10744: 202.0,  // Tyranitar Redux
  10745: 202.0,  // Tyranitar Mega Redux
  10746: 290.0,  // Ursaluna Mega
  10747: 97.0,  // Iron Exo
  10748: 118.0,  // Scizor Redux
  10750: 18.0,  // Basculin White
  10751: 10.0,  // Escarginite Redux
  10752: 210.0,  // Dragonite Delivery
  10753: 152.2,  // Chien Pao Mega
  10754: 215.0,  // Dracovish Mega
  10755: 90.0,  // EST(sprite): metallic beetle-knight (Ledian/Iron paradox)
  10756: 460.0,  // Snorlax Primal
  10757: 4.0,  // Victini Primal
  10758: 12.0,  // Wigglytuff Primal
  10759: 82.0,  // Flygon Redux B
  10760: 82.0,  // Flygon Redux B Mega
  10761: 0.5,  // Ribombee Redux
  10762: 0.5,  // Ribombee Redux Mega
  10763: 34.0,  // Weavile Redux
  10764: 34.0,  // Weavile Redux Mega
  10765: 135.5,  // Abomasnow Santa
  10766: 135.0,  // Bewear Angry
  10767: 0.7,  // Mimikyu Rayquaza
  10768: 26.5,  // Espeon Primal
  10769: 50.5,  // Darkrai Nightmare
  10770: 154.0,  // Solrock System
  10771: 44.5,  // Spectrier Cloud
  10772: 7.7,  // Calyrex Cloud Rider
  10773: 11.5,  // Mawile Redux B
  10774: 11.5,  // Mawile Redux B Mega
  10775: 12.0,  // Wigglytuff Apex
  10776: 203.0,  // Yveltal Mega
  10777: 0.1,  // Kartana Fallen
  10778: 112.8,  // Tinkaton Mega
  10779: 10.2,  // Turtwig Redux
  10780: 97.0,  // Grotle Redux
  10781: 310.0,  // Torterra Redux
  10782: 6.2,  // Chimchar Redux
  10783: 22.0,  // Monferno Redux
  10784: 55.0,  // Infernape Redux
  10785: 5.2,  // Piplup Redux
  10786: 23.0,  // Prinplup Redux
  10787: 84.5,  // Empoleon Redux
  10788: 3.2,  // Bounsweet Redux
  10789: 8.2,  // Steenee Redux
  10790: 21.4,  // Tsareena Redux
  10791: 11.0,  // Toxel Redux
  10792: 40.0,  // Toxtricity Redux
  10793: 40.0,  // Toxtricity Redux Fuzz
  10794: 15.0,  // Trapinch Redux
  10795: 15.3,  // Vibrava Redux
  10796: 82.0,  // Flygon Redux
  10797: 7.0,  // Crabrawler Redux
  10798: 180.0,  // Crabominable Redux
  10799: 3.0,  // Cleffa Redux
  10800: 7.5,  // Clefairy Redux
  10801: 40.0,  // Clefable Redux
  10802: 64.8,  // Gligar Redux
  10803: 42.5,  // Gliscor Redux
  10804: 19.6,  // Psyduck Redux
  10805: 90.0,  // Seel Redux
  10806: 120.0,  // Dewgong Redux
  10807: 16.8,  // Snorunt Redux
  10808: 256.5,  // Glalie Redux
  10809: 26.6,  // Froslass Redux
  10810: 37.5,  // Darumaka Redux
  10811: 92.9,  // Darmanitan Redux
  10812: 92.9,  // Darmanitan Aura
  10813: 92.9,  // Darmanitan Redux Bond
  10814: 24.4,  // Happiny Redux
  10815: 34.6,  // Chansey Redux
  10816: 46.8,  // Blissey Redux
  10817: 108.0,  // Spiritomb Redux
  10818: 92.9,  // Blunder-Darmanitan
  10819: 4.0,  // Dewpider Redux
  10820: 82.0,  // Araquanid Redux
  10821: 0.7,  // Mimikyu Apex
  10822: 0.7,  // Mimikyu Apex Busted
  10823: 8.9,  // Tinkatink Redux
  10824: 59.1,  // Tinkatuff Redux
  10825: 112.8,  // Tinkaton Redux
  10826: 112.8,  // Tinkaton Redux Mega
  10827: 56.0,  // Scyther Redux
  10828: 56.0,  // Scyther Redux Mega
  10829: 118.0,  // Scizor Redux Mega
  10830: 10.0,  // Kleavor Redux
  10831: 10.0,  // Kleavor Redux Mega
  10832: 6.5,  // Krabby Redux
  10833: 60.0,  // Kingler Redux
  10834: 60.0,  // Kingler Redux Mega
  10835: 9.5,  // Shinx Redux
  10836: 30.5,  // Luxio Redux
  10837: 42.0,  // Luxray Redux
  10838: 42.0,  // Luxray Redux Mega
  10839: 60.0,  // Aron Redux
  10840: 120.0,  // Lairon Redux
  10841: 360.0,  // Aggron Redux
  10842: 360.0,  // Aggron Redux Mega
  10843: 86.4,  // Makuhita Redux
  10844: 253.8,  // Hariyama Redux
  10845: 253.8,  // Kilozuna
  10846: 253.8,  // Kilozuna Mega
  10847: 1.0,  // Fogging
  10848: 9.5,  // Breezing
  10849: 9.5,  // Storming
  10850: 6.6,  // Ralts Redux
  10851: 20.2,  // Kirlia Redux
  10852: 48.4,  // Gardevoir Redux
  10853: 52.0,  // Gallade Redux
  10854: 48.4,  // Gardevoir Redux Mega
  10855: 52.0,  // Gallade Redux Mega
  10856: 10.0,  // Merrykarp
  10857: 235.0,  // Gyarevelry
  10858: 105.0,  // Munchlax Redux
  10859: 460.0,  // Snorlax Redux
  10860: 460.0,  // Snorlax Redux Mega
  10861: 30.0,  // Raichu Mega X
  10862: 1.0,  // Chimecho Mega
  10863: 47.0,  // Absol Mega Z
  10864: 24.9,  // Staraptor Mega
  10865: 95.0,  // Garchomp Mega Z
  10866: 430.0,  // Heatran Mega
  10867: 50.5,  // Darkrai Mega
  10868: 330.0,  // Golurk Mega
  10869: 8.5,  // Meowstic Mega
  10870: 108.0,  // Golisopod Mega
  10871: 80.5,  // Magearna Mega
  10872: 44.5,  // Zeraora Mega
  10873: 15.0,  // Scovillain Mega
  10874: 45.0,  // Glimmora Mega
  10875: 8.0,  // Tatsugiri Mega
  10876: 210.0,  // Baxcalibur Mega
  10877: 2.0,  // Spearow Redux
  10878: 38.0,  // Fearow Redux
  10879: 6.9,  // Terrow
  10880: 6.9,  // Slate
};
