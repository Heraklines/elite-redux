/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// AUTO-GENERATED — DO NOT EDIT BY HAND.
// Source: vendor/elite-redux/v2.65beta.json — every mega/primal/origin/move-mega
// evolution entry (evoKind 1/2/5). Each row says: base ER species id ->
// target ER species id (the mega form's own ER species record, which carries
// its stats/types/abilities/innates) + the pokerogue formKey to inject.
// This DATA-DRIVEN table replaces the fragile name-suffix guessing so all ER
// megas get a form, including ER-custom (Redux) megas. 294 forms.
// =============================================================================

export interface ErMegaFormEntry {
  /** Base ER species id (member.species / ER_ID_MAP key). */
  readonly baseErId: number;
  /** ER species id of the mega form record (its stats/abilities live here). */
  readonly targetErId: number;
  /** Pokerogue form key to inject onto the base species. */
  readonly formKey: string;
  /** Display name for the injected form. */
  readonly formName: string;
}

export const ER_MEGA_FORMS: readonly ErMegaFormEntry[] = [
  { baseErId: 3, targetErId: 1501, formKey: "mega-y", formName: "Mega Y" }, // Venusaur -> Venusaur Mega Y
  { baseErId: 3, targetErId: 2188, formKey: "mega-x", formName: "Mega X" }, // Venusaur -> Venusaur Mega X
  { baseErId: 6, targetErId: 1502, formKey: "mega-x", formName: "Mega X" }, // Charizard -> Charizard Mega X
  { baseErId: 6, targetErId: 1503, formKey: "mega-y", formName: "Mega Y" }, // Charizard -> Charizard Mega Y
  { baseErId: 6, targetErId: 2191, formKey: "mega", formName: "Mega" }, // Charizard -> Charizard Mega Z
  { baseErId: 9, targetErId: 1504, formKey: "mega-y", formName: "Mega Y" }, // Blastoise -> Blastoise Mega Y
  { baseErId: 9, targetErId: 2189, formKey: "mega-x", formName: "Mega X" }, // Blastoise -> Blastoise Mega X
  { baseErId: 12, targetErId: 2102, formKey: "mega", formName: "Mega" }, // Butterfree -> Butterfree Mega
  { baseErId: 15, targetErId: 1505, formKey: "mega", formName: "Mega" }, // Beedrill -> Beedrill Mega
  { baseErId: 18, targetErId: 1506, formKey: "mega", formName: "Mega" }, // Pidgeot -> Pidgeot Mega
  { baseErId: 24, targetErId: 2162, formKey: "mega", formName: "Mega" }, // Arbok -> Arbok Mega
  { baseErId: 26, targetErId: 1857, formKey: "mega-y", formName: "Mega Y" }, // Raichu -> Raichu Mega Y
  { baseErId: 26, targetErId: 1891, formKey: "mega-x", formName: "Mega X" }, // Raichu -> Raichu Mega X
  { baseErId: 28, targetErId: 2136, formKey: "mega", formName: "Mega" }, // Sandslash -> Sandslash Mega
  { baseErId: 31, targetErId: 2135, formKey: "mega", formName: "Mega" }, // Nidoqueen -> Nidoqueen Mega
  { baseErId: 34, targetErId: 2134, formKey: "mega", formName: "Mega" }, // Nidoking -> Nidoking Mega
  { baseErId: 36, targetErId: 1879, formKey: "mega-y", formName: "Mega Y" }, // Clefable -> Clefable Mega Y
  { baseErId: 36, targetErId: 2297, formKey: "mega", formName: "Mega" }, // Clefable -> Clefable Mega
  { baseErId: 40, targetErId: 2156, formKey: "mega-x", formName: "Mega X" }, // Wigglytuff -> Wigglytuff Mega X
  { baseErId: 40, targetErId: 2158, formKey: "mega-y", formName: "Mega Y" }, // Wigglytuff -> Wigglytuff Mega Y
  { baseErId: 59, targetErId: 2227, formKey: "mega", formName: "Mega" }, // Arcanine -> Arcanine Mega
  { baseErId: 65, targetErId: 1507, formKey: "mega", formName: "Mega" }, // Alakazam -> Alakazam Mega
  { baseErId: 68, targetErId: 2103, formKey: "mega", formName: "Mega" }, // Machamp -> Machamp Mega
  { baseErId: 71, targetErId: 1876, formKey: "mega", formName: "Mega" }, // Victreebel -> Victreebel Mega
  { baseErId: 78, targetErId: 2165, formKey: "mega", formName: "Mega" }, // Rapidash -> Rapidash Mega
  { baseErId: 80, targetErId: 1508, formKey: "mega", formName: "Mega" }, // Slowbro -> Slowbro Mega
  { baseErId: 87, targetErId: 2108, formKey: "mega", formName: "Mega" }, // Dewgong -> Dewgong Mega
  { baseErId: 94, targetErId: 1509, formKey: "mega-y", formName: "Mega Y" }, // Gengar -> Gengar Mega Y
  { baseErId: 94, targetErId: 2190, formKey: "mega-x", formName: "Mega X" }, // Gengar -> Gengar Mega X
  { baseErId: 99, targetErId: 2104, formKey: "mega", formName: "Mega" }, // Kingler -> Kingler Mega
  { baseErId: 106, targetErId: 2110, formKey: "mega", formName: "Mega" }, // Hitmonlee -> Hitmonlee Mega
  { baseErId: 107, targetErId: 2109, formKey: "mega", formName: "Mega" }, // Hitmonchan -> Hitmonchan Mega
  { baseErId: 115, targetErId: 1510, formKey: "mega", formName: "Mega" }, // Kangaskhan -> Kangaskhan Mega
  { baseErId: 121, targetErId: 1888, formKey: "mega", formName: "Mega" }, // Starmie -> Starmie Mega
  { baseErId: 123, targetErId: 2266, formKey: "mega", formName: "Mega" }, // Scyther -> Scyther Mega
  { baseErId: 127, targetErId: 1511, formKey: "mega", formName: "Mega" }, // Pinsir -> Pinsir Mega
  { baseErId: 130, targetErId: 1512, formKey: "mega-x", formName: "Mega X" }, // Gyarados -> Gyarados Mega X
  { baseErId: 130, targetErId: 2129, formKey: "mega-y", formName: "Mega Y" }, // Gyarados -> Gyarados Mega Y
  { baseErId: 131, targetErId: 2105, formKey: "mega-y", formName: "Mega Y" }, // Lapras -> Lapras Mega Y
  { baseErId: 131, targetErId: 2143, formKey: "mega-x", formName: "Mega X" }, // Lapras -> Lapras Mega X
  { baseErId: 142, targetErId: 1513, formKey: "mega", formName: "Mega" }, // Aerodactyl -> Aerodactyl Mega
  { baseErId: 143, targetErId: 2192, formKey: "mega", formName: "Mega" }, // Snorlax -> Snorlax Mega
  { baseErId: 143, targetErId: 2573, formKey: "primal", formName: "Primal" }, // Snorlax -> Snorlax Primal
  { baseErId: 149, targetErId: 1880, formKey: "mega-y", formName: "Mega Y" }, // Dragonite -> Dragonite Mega Y
  { baseErId: 149, targetErId: 2121, formKey: "mega", formName: "Mega" }, // Dragonite -> Dragonite Mega
  { baseErId: 150, targetErId: 1514, formKey: "mega-x", formName: "Mega X" }, // Mewtwo -> Mewtwo Mega X
  { baseErId: 150, targetErId: 1515, formKey: "mega-y", formName: "Mega Y" }, // Mewtwo -> Mewtwo Mega Y
  { baseErId: 154, targetErId: 2132, formKey: "mega", formName: "Mega" }, // Meganium -> Meganium Mega
  { baseErId: 157, targetErId: 2137, formKey: "mega", formName: "Mega" }, // Typhlosion -> Typhlosion Mega
  { baseErId: 160, targetErId: 2124, formKey: "mega-x", formName: "Mega X" }, // Feraligatr -> Feraligatr Mega X
  { baseErId: 160, targetErId: 2125, formKey: "mega-y", formName: "Mega Y" }, // Feraligatr -> Feraligatr Mega Y
  { baseErId: 169, targetErId: 2112, formKey: "mega", formName: "Mega" }, // Crobat -> Crobat Mega
  { baseErId: 171, targetErId: 2142, formKey: "mega", formName: "Mega" }, // Lanturn -> Lanturn Mega
  { baseErId: 181, targetErId: 1516, formKey: "mega", formName: "Mega" }, // Ampharos -> Ampharos Mega
  { baseErId: 195, targetErId: 2128, formKey: "mega", formName: "Mega" }, // Quagsire -> Quagsire Mega
  { baseErId: 196, targetErId: 2585, formKey: "primal", formName: "Primal" }, // Espeon -> Espeon Primal
  { baseErId: 199, targetErId: 2144, formKey: "mega", formName: "Mega" }, // Slowking -> Slowking Mega
  { baseErId: 208, targetErId: 1517, formKey: "mega", formName: "Mega" }, // Steelix -> Steelix Mega
  { baseErId: 210, targetErId: 2126, formKey: "mega", formName: "Mega" }, // Granbull -> Granbull Mega
  { baseErId: 212, targetErId: 1518, formKey: "mega", formName: "Mega" }, // Scizor -> Scizor Mega
  { baseErId: 213, targetErId: 2118, formKey: "mega", formName: "Mega" }, // Shuckle -> Shuckle Mega
  { baseErId: 214, targetErId: 1519, formKey: "mega", formName: "Mega" }, // Heracross -> Heracross Mega
  { baseErId: 227, targetErId: 1889, formKey: "mega-y", formName: "Mega Y" }, // Skarmory -> Skarmory Mega Y
  { baseErId: 227, targetErId: 2113, formKey: "mega-x", formName: "Mega X" }, // Skarmory -> Skarmory Mega X
  { baseErId: 229, targetErId: 1520, formKey: "mega", formName: "Mega" }, // Houndoom -> Houndoom Mega
  { baseErId: 230, targetErId: 2107, formKey: "mega-x", formName: "Mega X" }, // Kingdra -> Kingdra Mega X
  { baseErId: 237, targetErId: 2111, formKey: "mega", formName: "Mega" }, // Hitmontop -> Hitmontop Mega
  { baseErId: 248, targetErId: 1521, formKey: "mega", formName: "Mega" }, // Tyranitar -> Tyranitar Mega
  { baseErId: 254, targetErId: 1522, formKey: "mega", formName: "Mega" }, // Sceptile -> Sceptile Mega
  { baseErId: 257, targetErId: 1523, formKey: "mega", formName: "Mega" }, // Blaziken -> Blaziken Mega
  { baseErId: 260, targetErId: 1524, formKey: "mega", formName: "Mega" }, // Swampert -> Swampert Mega
  { baseErId: 268, targetErId: 2157, formKey: "primal", formName: "Primal" }, // Cascoon -> Cascoon Primal
  { baseErId: 282, targetErId: 1525, formKey: "mega", formName: "Mega" }, // Gardevoir -> Gardevoir Mega
  { baseErId: 286, targetErId: 2122, formKey: "mega", formName: "Mega" }, // Breloom -> Breloom Mega
  { baseErId: 289, targetErId: 2123, formKey: "mega", formName: "Mega" }, // Slaking -> Slaking Mega
  { baseErId: 292, targetErId: 2140, formKey: "mega", formName: "Mega" }, // Shedinja -> Shedinja Mega
  { baseErId: 297, targetErId: 2300, formKey: "mega", formName: "Mega" }, // Hariyama -> Hariyama Mega
  { baseErId: 302, targetErId: 1526, formKey: "mega", formName: "Mega" }, // Sableye -> Sableye Mega
  { baseErId: 303, targetErId: 1527, formKey: "mega", formName: "Mega" }, // Mawile -> Mawile Mega
  { baseErId: 306, targetErId: 1528, formKey: "mega", formName: "Mega" }, // Aggron -> Aggron Mega
  { baseErId: 308, targetErId: 1529, formKey: "mega", formName: "Mega" }, // Medicham -> Medicham Mega
  { baseErId: 310, targetErId: 1530, formKey: "mega", formName: "Mega" }, // Manectric -> Manectric Mega
  { baseErId: 317, targetErId: 2141, formKey: "mega", formName: "Mega" }, // Swalot -> Swalot Mega
  { baseErId: 319, targetErId: 1531, formKey: "mega", formName: "Mega" }, // Sharpedo -> Sharpedo Mega
  { baseErId: 323, targetErId: 1532, formKey: "mega", formName: "Mega" }, // Camerupt -> Camerupt Mega
  { baseErId: 330, targetErId: 2106, formKey: "mega", formName: "Mega" }, // Flygon -> Flygon Mega
  { baseErId: 334, targetErId: 1533, formKey: "mega", formName: "Mega" }, // Altaria -> Altaria Mega
  { baseErId: 350, targetErId: 2101, formKey: "mega", formName: "Mega" }, // Milotic -> Milotic Mega
  { baseErId: 354, targetErId: 1534, formKey: "mega", formName: "Mega" }, // Banette -> Banette Mega
  { baseErId: 358, targetErId: 1906, formKey: "mega", formName: "Mega" }, // Chimecho -> Chimecho Mega
  { baseErId: 359, targetErId: 1535, formKey: "mega", formName: "Mega" }, // Absol -> Absol Mega
  { baseErId: 362, targetErId: 1536, formKey: "mega", formName: "Mega" }, // Glalie -> Glalie Mega
  { baseErId: 369, targetErId: 2119, formKey: "mega", formName: "Mega" }, // Relicanth -> Relicanth Mega
  { baseErId: 373, targetErId: 1537, formKey: "mega", formName: "Mega" }, // Salamence -> Salamence Mega
  { baseErId: 376, targetErId: 1538, formKey: "mega", formName: "Mega" }, // Metagross -> Metagross Mega
  { baseErId: 380, targetErId: 1539, formKey: "mega", formName: "Mega" }, // Latias -> Latias Mega
  { baseErId: 381, targetErId: 1540, formKey: "mega", formName: "Mega" }, // Latios -> Latios Mega
  { baseErId: 382, targetErId: 1549, formKey: "primal", formName: "Primal" }, // Kyogre -> Kyogre Primal
  { baseErId: 383, targetErId: 1550, formKey: "primal", formName: "Primal" }, // Groudon -> Groudon Primal
  { baseErId: 384, targetErId: 1548, formKey: "mega", formName: "Mega" }, // Rayquaza -> Rayquaza Mega
  { baseErId: 389, targetErId: 2115, formKey: "mega", formName: "Mega" }, // Torterra -> Torterra Mega
  { baseErId: 392, targetErId: 2116, formKey: "mega", formName: "Mega" }, // Infernape -> Infernape Mega
  { baseErId: 395, targetErId: 2117, formKey: "mega", formName: "Mega" }, // Empoleon -> Empoleon Mega
  { baseErId: 398, targetErId: 1893, formKey: "mega", formName: "Mega" }, // Staraptor -> Staraptor Mega
  { baseErId: 405, targetErId: 2133, formKey: "mega", formName: "Mega" }, // Luxray -> Luxray Mega
  { baseErId: 407, targetErId: 2231, formKey: "mega", formName: "Mega" }, // Roserade -> Roserade Mega
  { baseErId: 428, targetErId: 1541, formKey: "mega", formName: "Mega" }, // Lopunny -> Lopunny Mega
  { baseErId: 445, targetErId: 1542, formKey: "mega", formName: "Mega" }, // Garchomp -> Garchomp Mega
  { baseErId: 448, targetErId: 1543, formKey: "mega-x", formName: "Mega X" }, // Lucario -> Lucario Mega X
  { baseErId: 448, targetErId: 2159, formKey: "mega", formName: "Mega" }, // Lucario -> Lucario Mega Z
  { baseErId: 460, targetErId: 1544, formKey: "mega", formName: "Mega" }, // Abomasnow -> Abomasnow Mega
  { baseErId: 461, targetErId: 2213, formKey: "mega", formName: "Mega" }, // Weavile -> Weavile Mega
  { baseErId: 462, targetErId: 2139, formKey: "mega", formName: "Mega" }, // Magnezone -> Magnezone Mega
  { baseErId: 475, targetErId: 1545, formKey: "mega", formName: "Mega" }, // Gallade -> Gallade Mega
  { baseErId: 478, targetErId: 1890, formKey: "mega-y", formName: "Mega Y" }, // Froslass -> Froslass Mega Y
  { baseErId: 478, targetErId: 2155, formKey: "mega-x", formName: "Mega X" }, // Froslass -> Froslass Mega X
  { baseErId: 483, targetErId: 1842, formKey: "origin", formName: "Origin" }, // Dialga -> Dialga Origin
  { baseErId: 484, targetErId: 1843, formKey: "origin", formName: "Origin" }, // Palkia -> Palkia Origin
  { baseErId: 485, targetErId: 1895, formKey: "mega", formName: "Mega" }, // Heatran -> Heatran Mega
  { baseErId: 487, targetErId: 1648, formKey: "origin", formName: "Origin" }, // Giratina -> Giratina Origin
  { baseErId: 491, targetErId: 1896, formKey: "mega", formName: "Mega" }, // Darkrai -> Darkrai Mega
  { baseErId: 494, targetErId: 2574, formKey: "primal", formName: "Primal" }, // Victini -> Victini Primal
  { baseErId: 497, targetErId: 2214, formKey: "mega", formName: "Mega" }, // Serperior -> Serperior Mega
  { baseErId: 500, targetErId: 2215, formKey: "mega", formName: "Mega" }, // Emboar -> Emboar Mega
  { baseErId: 503, targetErId: 2216, formKey: "mega", formName: "Mega" }, // Samurott -> Samurott Mega
  { baseErId: 530, targetErId: 1881, formKey: "mega", formName: "Mega" }, // Excadrill -> Excadrill Mega
  { baseErId: 531, targetErId: 1546, formKey: "mega", formName: "Mega" }, // Audino -> Audino Mega
  { baseErId: 545, targetErId: 1882, formKey: "mega", formName: "Mega" }, // Scolipede -> Scolipede Mega
  { baseErId: 553, targetErId: 2138, formKey: "mega", formName: "Mega" }, // Krookodile -> Krookodile Mega
  { baseErId: 560, targetErId: 1868, formKey: "mega", formName: "Mega" }, // Scrafty -> Scrafty Mega
  { baseErId: 569, targetErId: 2202, formKey: "mega", formName: "Mega" }, // Garbodor -> Garbodor Mega
  { baseErId: 576, targetErId: 2233, formKey: "mega", formName: "Mega" }, // Gothitelle -> Gothitelle Mega
  { baseErId: 579, targetErId: 2235, formKey: "mega", formName: "Mega" }, // Reuniclus -> Reuniclus Mega
  { baseErId: 584, targetErId: 2268, formKey: "mega", formName: "Mega" }, // Vanilluxe -> Vanilluxe Mega
  { baseErId: 604, targetErId: 1874, formKey: "mega", formName: "Mega" }, // Eelektross -> Eelektross Mega
  { baseErId: 609, targetErId: 1883, formKey: "mega-y", formName: "Mega Y" }, // Chandelure -> Chandelure Mega Y
  { baseErId: 609, targetErId: 2240, formKey: "mega-x", formName: "Mega X" }, // Chandelure -> Chandelure Mega X
  { baseErId: 612, targetErId: 2130, formKey: "mega", formName: "Mega" }, // Haxorus -> Haxorus Mega
  { baseErId: 620, targetErId: 2226, formKey: "mega", formName: "Mega" }, // Mienshao -> Mienshao Mega
  { baseErId: 623, targetErId: 1897, formKey: "mega", formName: "Mega" }, // Golurk -> Golurk Mega
  { baseErId: 635, targetErId: 2267, formKey: "mega", formName: "Mega" }, // Hydreigon -> Hydreigon Mega
  { baseErId: 652, targetErId: 1871, formKey: "mega", formName: "Mega" }, // Chesnaught -> Chesnaught Mega
  { baseErId: 655, targetErId: 1872, formKey: "mega", formName: "Mega" }, // Delphox -> Delphox Mega
  { baseErId: 658, targetErId: 1873, formKey: "mega", formName: "Mega" }, // Greninja -> Greninja Mega
  { baseErId: 663, targetErId: 2254, formKey: "mega", formName: "Mega" }, // Talonflame -> Talonflame Mega
  { baseErId: 668, targetErId: 1870, formKey: "mega", formName: "Mega" }, // Pyroar -> Pyroar Mega
  { baseErId: 678, targetErId: 1898, formKey: "mega", formName: "Mega" }, // Meowstic -> Meowstic Mega
  { baseErId: 687, targetErId: 1875, formKey: "mega", formName: "Mega" }, // Malamar -> Malamar Mega
  { baseErId: 689, targetErId: 1886, formKey: "mega", formName: "Mega" }, // Barbaracle -> Barbaracle Mega
  { baseErId: 691, targetErId: 1877, formKey: "mega", formName: "Mega" }, // Dragalge -> Dragalge Mega
  { baseErId: 701, targetErId: 1878, formKey: "mega", formName: "Mega" }, // Hawlucha -> Hawlucha Mega
  { baseErId: 706, targetErId: 2228, formKey: "mega", formName: "Mega" }, // Goodra -> Goodra Mega
  { baseErId: 717, targetErId: 2593, formKey: "mega", formName: "Mega" }, // Yveltal -> Yveltal Mega
  { baseErId: 719, targetErId: 1547, formKey: "mega", formName: "Mega" }, // Diancie -> Diancie Mega
  { baseErId: 724, targetErId: 2217, formKey: "mega", formName: "Mega" }, // Decidueye -> Decidueye Mega
  { baseErId: 727, targetErId: 2219, formKey: "mega", formName: "Mega" }, // Incineroar -> Incineroar Mega
  { baseErId: 730, targetErId: 2221, formKey: "mega", formName: "Mega" }, // Primarina -> Primarina Mega
  { baseErId: 733, targetErId: 2120, formKey: "mega", formName: "Mega" }, // Toucannon -> Toucannon Mega
  { baseErId: 740, targetErId: 1899, formKey: "mega", formName: "Mega" }, // Crabominable -> Crabominable Mega
  { baseErId: 741, targetErId: 2167, formKey: "mega", formName: "Mega" }, // Oricorio -> Oricorio Mega
  { baseErId: 743, targetErId: 2145, formKey: "mega", formName: "Mega" }, // Ribombee -> Ribombee Mega
  { baseErId: 763, targetErId: 2298, formKey: "mega", formName: "Mega" }, // Tsareena -> Tsareena Mega
  { baseErId: 768, targetErId: 1900, formKey: "mega-y", formName: "Mega Y" }, // Golisopod -> Golisopod Mega Y
  { baseErId: 768, targetErId: 2164, formKey: "mega", formName: "Mega" }, // Golisopod -> Golisopod Mega
  { baseErId: 780, targetErId: 1887, formKey: "mega", formName: "Mega" }, // Drampa -> Drampa Mega
  { baseErId: 801, targetErId: 1901, formKey: "mega", formName: "Mega" }, // Magearna -> Magearna Mega
  { baseErId: 807, targetErId: 1902, formKey: "mega", formName: "Mega" }, // Zeraora -> Zeraora Mega
  { baseErId: 809, targetErId: 2187, formKey: "mega", formName: "Mega" }, // Melmetal -> Melmetal Mega
  { baseErId: 812, targetErId: 2193, formKey: "mega", formName: "Mega" }, // Rillaboom -> Rillaboom Mega
  { baseErId: 815, targetErId: 2194, formKey: "mega", formName: "Mega" }, // Cinderace -> Cinderace Mega
  { baseErId: 818, targetErId: 2195, formKey: "mega", formName: "Mega" }, // Inteleon -> Inteleon Mega
  { baseErId: 823, targetErId: 2196, formKey: "mega", formName: "Mega" }, // Corviknight -> Corviknight Mega
  { baseErId: 826, targetErId: 2203, formKey: "mega", formName: "Mega" }, // Orbeetle -> Orbeetle Mega
  { baseErId: 834, targetErId: 2197, formKey: "mega", formName: "Mega" }, // Drednaw -> Drednaw Mega
  { baseErId: 839, targetErId: 2198, formKey: "mega", formName: "Mega" }, // Coalossal -> Coalossal Mega
  { baseErId: 844, targetErId: 2199, formKey: "mega", formName: "Mega" }, // Sandaconda -> Sandaconda Mega
  { baseErId: 849, targetErId: 2207, formKey: "mega", formName: "Mega" }, // Toxtricity -> Toxtricity Mega
  { baseErId: 851, targetErId: 2205, formKey: "mega", formName: "Mega" }, // Centiskorch -> Centiskorch Mega
  { baseErId: 858, targetErId: 2201, formKey: "mega", formName: "Mega" }, // Hatterene -> Hatterene Mega
  { baseErId: 861, targetErId: 2204, formKey: "mega", formName: "Mega" }, // Grimmsnarl -> Grimmsnarl Mega
  { baseErId: 869, targetErId: 2206, formKey: "mega", formName: "Mega" }, // Alcremie -> Alcremie Mega
  { baseErId: 870, targetErId: 1869, formKey: "mega", formName: "Mega" }, // Falinks -> Falinks Mega
  { baseErId: 879, targetErId: 2200, formKey: "mega", formName: "Mega" }, // Copperajah -> Copperajah Mega
  { baseErId: 882, targetErId: 2571, formKey: "mega", formName: "Mega" }, // Dracovish -> Dracovish Mega
  { baseErId: 887, targetErId: 2263, formKey: "mega", formName: "Mega" }, // Dragapult -> Dragapult Mega
  { baseErId: 890, targetErId: 1804, formKey: "primal", formName: "Primal" }, // Eternatus -> Eternatus Primal
  { baseErId: 892, targetErId: 2185, formKey: "mega", formName: "Mega" }, // Urshifu -> Urshifu Mega
  { baseErId: 900, targetErId: 2265, formKey: "mega", formName: "Mega" }, // Kleavor -> Kleavor Mega
  { baseErId: 901, targetErId: 2563, formKey: "mega", formName: "Mega" }, // Ursaluna -> Ursaluna Mega
  { baseErId: 903, targetErId: 2296, formKey: "mega", formName: "Mega" }, // Sneasler -> Sneasler Mega
  { baseErId: 908, targetErId: 2220, formKey: "mega", formName: "Mega" }, // Meowscarada -> Meowscarada Mega
  { baseErId: 911, targetErId: 2224, formKey: "mega", formName: "Mega" }, // Skeledirge -> Skeledirge Mega
  { baseErId: 914, targetErId: 2222, formKey: "mega", formName: "Mega" }, // Quaquaval -> Quaquaval Mega
  { baseErId: 952, targetErId: 1903, formKey: "mega", formName: "Mega" }, // Scovillain -> Scovillain Mega
  { baseErId: 959, targetErId: 2595, formKey: "mega", formName: "Mega" }, // Tinkaton -> Tinkaton Mega
  { baseErId: 970, targetErId: 1907, formKey: "mega", formName: "Mega" }, // Glimmora -> Glimmora Mega
  { baseErId: 978, targetErId: 1904, formKey: "mega", formName: "Mega" }, // Tatsugiri -> Tatsugiri Mega
  { baseErId: 980, targetErId: 2232, formKey: "mega", formName: "Mega" }, // Clodsire -> Clodsire Mega
  { baseErId: 998, targetErId: 1905, formKey: "mega", formName: "Mega" }, // Baxcalibur -> Baxcalibur Mega
  { baseErId: 1002, targetErId: 2570, formKey: "mega", formName: "Mega" }, // Chien Pao -> Chien Pao Mega
  { baseErId: 1017, targetErId: 1080, formKey: "mega", formName: "Mega" }, // Ogerpon -> Ogerpon Mega
  { baseErId: 1024, targetErId: 1850, formKey: "primal", formName: "Primal" }, // Terapagos -> Terapagos Primal
  { baseErId: 1041, targetErId: 2160, formKey: "mega-x", formName: "Mega X" }, // Gyaradeath -> Gyaradeath Mega X
  { baseErId: 1041, targetErId: 2161, formKey: "mega-y", formName: "Mega Y" }, // Gyaradeath -> Gyaradeath Mega Y
  { baseErId: 1046, targetErId: 2172, formKey: "mega", formName: "Mega" }, // Cormoth -> Cormoth Mega
  { baseErId: 1047, targetErId: 2173, formKey: "mega", formName: "Mega" }, // Popcorm -> Popcorm Mega
  { baseErId: 1057, targetErId: 2184, formKey: "mega", formName: "Mega" }, // Amphybuzz -> Amphybuzz Mega
  { baseErId: 1078, targetErId: 1079, formKey: "mega", formName: "Mega" }, // Dududunsparce -> Dududunsparce Mega
  { baseErId: 1092, targetErId: 2255, formKey: "mega", formName: "Mega" }, // Carbonix -> Carbonix Mega
  { baseErId: 1096, targetErId: 2261, formKey: "mega", formName: "Mega" }, // Heracreus -> Heracreus Mega
  { baseErId: 1555, targetErId: 2264, formKey: "alola-mega", formName: "Alolan Mega" }, // Sandslash Alolan -> Sandslash Alolan Mega
  { baseErId: 1571, targetErId: 2166, formKey: "galar-mega", formName: "Galarian Mega" }, // Rapidash Galarian -> Rapidash Mega Galarian
  { baseErId: 1573, targetErId: 2229, formKey: "galar-mega", formName: "Galarian Mega" }, // Slowbro Galarian -> Slowbro Mega Galarian
  { baseErId: 1580, targetErId: 2230, formKey: "galar-mega", formName: "Galarian Mega" }, // Slowking Galarian -> Slowking Mega Galarian
  { baseErId: 1594, targetErId: 2208, formKey: "mega", formName: "Mega" }, // Pikachu Kanto -> Pikachu Mega
  { baseErId: 1595, targetErId: 2208, formKey: "mega", formName: "Mega" }, // Pikachu Hoenn -> Pikachu Mega
  { baseErId: 1596, targetErId: 2208, formKey: "mega", formName: "Mega" }, // Pikachu Sinnoh -> Pikachu Mega
  { baseErId: 1597, targetErId: 2208, formKey: "mega", formName: "Mega" }, // Pikachu Unova -> Pikachu Mega
  { baseErId: 1598, targetErId: 2208, formKey: "mega", formName: "Mega" }, // Pikachu Kalos -> Pikachu Mega
  { baseErId: 1599, targetErId: 2208, formKey: "mega", formName: "Mega" }, // Pikachu Alola -> Pikachu Mega
  { baseErId: 1600, targetErId: 2208, formKey: "mega", formName: "Mega" }, // Pikachu Partner Cap -> Pikachu Mega
  { baseErId: 1601, targetErId: 2208, formKey: "mega", formName: "Mega" }, // Pikachu World -> Pikachu Mega
  { baseErId: 1716, targetErId: 1884, formKey: "mega", formName: "Mega" }, // Floette Eternal Flower -> Floette Mega
  { baseErId: 1730, targetErId: 1898, formKey: "mega", formName: "Mega" }, // Meowstic Female -> Meowstic Mega
  { baseErId: 1742, targetErId: 1885, formKey: "mega", formName: "Mega" }, // Zygarde Complete -> Zygarde Mega
  { baseErId: 1744, targetErId: 2167, formKey: "mega", formName: "Mega" }, // Oricorio Pom Pom -> Oricorio Mega
  { baseErId: 1745, targetErId: 2167, formKey: "mega", formName: "Mega" }, // Oricorio Pau -> Oricorio Mega
  { baseErId: 1746, targetErId: 2167, formKey: "mega", formName: "Mega" }, // Oricorio Sensu -> Oricorio Mega
  { baseErId: 1785, targetErId: 1901, formKey: "mega", formName: "Mega" }, // Magearna Original -> Magearna Mega
  { baseErId: 1788, targetErId: 2207, formKey: "mega", formName: "Mega" }, // Toxtricity Low Key -> Toxtricity Mega
  { baseErId: 1805, targetErId: 2186, formKey: "mega", formName: "Mega" }, // Urshifu Rapid Strike Style -> Urshifu Rapid Strike Style Mega
  { baseErId: 1811, targetErId: 2234, formKey: "hisui-mega", formName: "Hisuian Mega" }, // Arcanine Hisuian -> Arcanine Hisuian Mega
  { baseErId: 1814, targetErId: 2225, formKey: "hisui-mega", formName: "Hisuian Mega" }, // Typhlosion Hisuian -> Typhlosion Hisuian Mega
  { baseErId: 1816, targetErId: 2223, formKey: "hisui-mega", formName: "Hisuian Mega" }, // Samurott Hisuian -> Samurott Hisuian Mega
  { baseErId: 1820, targetErId: 2299, formKey: "hisui-mega", formName: "Hisuian Mega" }, // Goodra Hisuian -> Goodra Hisuian Mega
  { baseErId: 1822, targetErId: 2218, formKey: "hisui-mega", formName: "Hisuian Mega" }, // Decidueye Hisuian -> Decidueye Hisuian Mega
  { baseErId: 1833, targetErId: 1904, formKey: "mega", formName: "Mega" }, // Tatsugiri Stretchy -> Tatsugiri Mega
  { baseErId: 1834, targetErId: 1904, formKey: "mega", formName: "Mega" }, // Tatsugiri Droopy -> Tatsugiri Mega
  { baseErId: 1840, targetErId: 1081, formKey: "mega", formName: "Mega" }, // Ogerpon Hearthflame -> Ogerpon Hearthflame Mega
  { baseErId: 1841, targetErId: 1082, formKey: "mega", formName: "Mega" }, // Ogerpon Cornerstone -> Ogerpon Cornerstone Mega
  { baseErId: 1852, targetErId: 2208, formKey: "mega", formName: "Mega" }, // Pikachu Partner -> Pikachu Mega
  { baseErId: 1853, targetErId: 2209, formKey: "mega", formName: "Mega" }, // Eevee Partner -> Eevee Mega
  { baseErId: 1854, targetErId: 2210, formKey: "mega", formName: "Mega" }, // Meowth Partner -> Meowth Mega
  { baseErId: 2238, targetErId: 2239, formKey: "mega", formName: "Mega" }, // Swampage -> Swampage Mega
  { baseErId: 2244, targetErId: 2241, formKey: "mega", formName: "Mega" }, // Zapdos Ex -> Zapdos Mega
  { baseErId: 2245, targetErId: 2242, formKey: "mega", formName: "Mega" }, // Articuno Ex -> Articuno Mega
  { baseErId: 2246, targetErId: 2243, formKey: "mega", formName: "Mega" }, // Moltres Ex -> Moltres Mega
  { baseErId: 2274, targetErId: 2275, formKey: "mega", formName: "Mega" }, // Vanilluxe Redux -> Vanilluxe Redux Mega
  { baseErId: 2278, targetErId: 2279, formKey: "mega", formName: "Mega" }, // Chandelure Redux -> Chandelure Mega
  { baseErId: 2285, targetErId: 2286, formKey: "mega", formName: "Mega" }, // Mamoswine Redux -> Mamoswine Mega
  { baseErId: 2302, targetErId: 2303, formKey: "mega", formName: "Mega" }, // Altaria Redux -> Altaria Redux Mega
  { baseErId: 2505, targetErId: 2307, formKey: "mega", formName: "Mega" }, // Luxzero -> Luxzero Mega
  { baseErId: 2509, targetErId: 2168, formKey: "mega", formName: "Mega" }, // Aegislash Redux -> Aegislash Mega
  { baseErId: 2510, targetErId: 2169, formKey: "mega", formName: "Mega" }, // Aegislash Blade Redux -> Aegislash Blade Redux Mega
  { baseErId: 2513, targetErId: 2146, formKey: "mega", formName: "Mega" }, // Alakazam Redux -> Alakazam Mega Redux
  { baseErId: 2516, targetErId: 2147, formKey: "mega", formName: "Mega" }, // Beedrill Redux -> Beedrill Mega Redux
  { baseErId: 2534, targetErId: 2148, formKey: "mega", formName: "Mega" }, // Machamp Redux -> Machamp Mega Redux
  { baseErId: 2537, targetErId: 2170, formKey: "mega", formName: "Mega" }, // Reuniclus Redux -> Reuniclus Mega
  { baseErId: 2538, targetErId: 2149, formKey: "mega", formName: "Mega" }, // Skarmory Redux -> Skarmory Mega
  { baseErId: 2540, targetErId: 2150, formKey: "mega", formName: "Mega" }, // Arcanine Redux -> Arcanine Mega
  { baseErId: 2546, targetErId: 2151, formKey: "mega", formName: "Mega" }, // Garchomp Redux -> Garchomp Mega Redux
  { baseErId: 2549, targetErId: 2171, formKey: "mega", formName: "Mega" }, // Hydreigon Redux -> Hydreigon Mega
  { baseErId: 2552, targetErId: 2152, formKey: "mega", formName: "Mega" }, // Mawile Redux -> Mawile Mega Redux
  { baseErId: 2553, targetErId: 2153, formKey: "mega", formName: "Mega" }, // Sableye Redux -> Sableye Mega Redux
  { baseErId: 2555, targetErId: 2154, formKey: "mega", formName: "Mega" }, // Houndoom Redux -> Houndoom Mega Redux
  { baseErId: 2558, targetErId: 2163, formKey: "mega", formName: "Mega" }, // Kingambit Redux -> Kingambit Mega
  { baseErId: 2561, targetErId: 2562, formKey: "mega", formName: "Mega" }, // Tyranitar Redux -> Tyranitar Mega Redux
  { baseErId: 2565, targetErId: 2647, formKey: "mega", formName: "Mega" }, // Scizor Redux -> Scizor Redux Mega
  { baseErId: 2576, targetErId: 2577, formKey: "mega", formName: "Mega" }, // Flygon Redux B -> Flygon Redux B Mega
  { baseErId: 2578, targetErId: 2579, formKey: "mega", formName: "Mega" }, // Ribombee Redux -> Ribombee Redux Mega
  { baseErId: 2580, targetErId: 2581, formKey: "mega", formName: "Mega" }, // Weavile Redux -> Weavile Redux Mega
  { baseErId: 2590, targetErId: 2591, formKey: "mega", formName: "Mega" }, // Mawile Redux B -> Mawile Redux B Mega
  { baseErId: 2592, targetErId: 2575, formKey: "primal", formName: "Primal" }, // Wigglytuff Apex -> Wigglytuff Primal
  { baseErId: 2598, targetErId: 2174, formKey: "mega", formName: "Mega" }, // Torterra Redux -> Torterra Redux Mega
  { baseErId: 2601, targetErId: 2175, formKey: "mega", formName: "Mega" }, // Infernape Redux -> Infernape Redux Mega
  { baseErId: 2604, targetErId: 2176, formKey: "mega", formName: "Mega" }, // Empoleon Redux -> Empoleon Redux Mega
  { baseErId: 2607, targetErId: 2177, formKey: "mega", formName: "Mega" }, // Tsareena Redux -> Tsareena Mega
  { baseErId: 2609, targetErId: 2178, formKey: "mega", formName: "Mega" }, // Toxtricity Redux -> Toxtricity Mega
  { baseErId: 2610, targetErId: 2179, formKey: "mega", formName: "Mega" }, // Toxtricity Redux Fuzz -> Toxtricity Redux Fuzz Mega
  { baseErId: 2613, targetErId: 2180, formKey: "mega", formName: "Mega" }, // Flygon Redux -> Flygon Redux Mega
  { baseErId: 2618, targetErId: 2181, formKey: "mega", formName: "Mega" }, // Clefable Redux -> Clefable Mega
  { baseErId: 2625, targetErId: 2182, formKey: "mega", formName: "Mega" }, // Glalie Redux -> Glalie Redux Mega
  { baseErId: 2626, targetErId: 2183, formKey: "mega", formName: "Mega" }, // Froslass Redux -> Froslass Mega
  { baseErId: 2639, targetErId: 1855, formKey: "primal", formName: "Primal" }, // Mimikyu Apex Busted -> Mimikyu Primal
  { baseErId: 2642, targetErId: 2643, formKey: "mega", formName: "Mega" }, // Tinkaton Redux -> Tinkaton Redux Mega
  { baseErId: 2645, targetErId: 2646, formKey: "mega", formName: "Mega" }, // Scyther Redux -> Scyther Redux Mega
  { baseErId: 2648, targetErId: 2649, formKey: "mega", formName: "Mega" }, // Kleavor Redux -> Kleavor Redux Mega
  { baseErId: 2651, targetErId: 2652, formKey: "mega", formName: "Mega" }, // Kingler Redux -> Kingler Redux Mega
  { baseErId: 2655, targetErId: 2656, formKey: "mega", formName: "Mega" }, // Luxray Redux -> Luxray Redux Mega
  { baseErId: 2659, targetErId: 2660, formKey: "mega", formName: "Mega" }, // Aggron Redux -> Aggron Redux Mega
  { baseErId: 2663, targetErId: 2664, formKey: "mega", formName: "Mega" }, // Kilozuna -> Kilozuna Mega
  { baseErId: 2670, targetErId: 2672, formKey: "mega", formName: "Mega" }, // Gardevoir Redux -> Gardevoir Redux Mega
  { baseErId: 2671, targetErId: 2673, formKey: "mega", formName: "Mega" }, // Gallade Redux -> Gallade Redux Mega
  { baseErId: 2677, targetErId: 2678, formKey: "mega", formName: "Mega" }, // Snorlax Redux -> Snorlax Redux Mega
];
