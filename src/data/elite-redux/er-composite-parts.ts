// =============================================================================
// AUTO-GENERATED then HAND-MAINTAINED. Source: vendor/elite-redux/v2.65beta.json
//
// ⚠️  RE-KEYED to current er-abilities draft ids after commit cfd9c8d realigned
//     81 draft ids to the v2.65 JSON positions. BOTH the row keys (+`erAbilityId`
//     field) AND the nested `{ kind: "er", erAbilityId }` part references were
//     remapped, so they match `er-abilities.ts`/`er-id-map.ts`. A naive
//     `pnpm run er:classify-composites` would re-key only against the (now
//     correct) draft ids — verify against the er-composite-riders harness tests
//     after any regeneration.
// =============================================================================

// Phase D task D3b: per-composite resolved part references.
//
// For each ER ability whose archetype is `composite-vanilla-mashup`, this
// table records the constructable parts — either a vanilla pokerogue
// `AbilityId` (whose AbAttrs the dispatcher copies verbatim) or another
// ER `erAbilityId` (which the dispatcher recursively resolves through its
// own archetype row). Free-text riders ("triggers hail when hit") and ability
// names we couldn't match against the lookup tables surface in
// `unresolvedParts` for diagnostic surface.
//
// Regenerate with: `pnpm run er:classify-composites`.

/**
 * A single resolved part within a composite ability.
 *
 * Tagged-union shape: `kind: "pokerogue"` references a vanilla pokerogue
 * ability whose AbAttrs the dispatcher copies; `kind: "er"` references
 * another ER ability whose archetype row the dispatcher recursively
 * dispatches.
 */
export type ErCompositePartRef =
  | { readonly kind: "pokerogue"; readonly abilityId: number }
  | { readonly kind: "er"; readonly erAbilityId: number };

/**
 * One composite ability's resolved parts + diagnostic metadata.
 */
export interface ErCompositeEntry {
  /** ER ability id (the key under which this entry is registered). */
  readonly erAbilityId: number;
  /** Resolved part references. Each contributes its own AbAttrs to the composite. */
  readonly parts: readonly ErCompositePartRef[];
  /**
   * Part names from the classifier's `parts` array that we couldn't resolve
   * to either a pokerogue or ER ability. Usually free-text effect riders
   * ("triggers hail when hit"). The dispatcher logs these for triage; the
   * composite still wires up the resolved subset.
   */
  readonly unresolvedParts?: readonly string[];
  /** True when the composite has either a typed rider or any unresolved part. */
  readonly hasRider: boolean;
  /** The classifier-emitted rider sentence, if any. */
  readonly riderText?: string;
}

export const ER_COMPOSITE_PARTS: Readonly<Record<number, ErCompositeEntry>> = {
  266: { erAbilityId: 266, parts: [{ kind: "pokerogue", abilityId: 127 }, { kind: "pokerogue", abilityId: 264 }], hasRider: false },
  267: { erAbilityId: 267, parts: [{ kind: "pokerogue", abilityId: 127 }, { kind: "pokerogue", abilityId: 265 }], hasRider: false },
  366: { erAbilityId: 366, parts: [{ kind: "er", erAbilityId: 268 }, { kind: "er", erAbilityId: 279 }], hasRider: false },
  374: { erAbilityId: 374, parts: [{ kind: "er", erAbilityId: 268 }, { kind: "pokerogue", abilityId: 34 }, { kind: "pokerogue", abilityId: 102 }, { kind: "pokerogue", abilityId: 139 }, { kind: "pokerogue", abilityId: 94 }], hasRider: false },
  389: { erAbilityId: 389, parts: [{ kind: "pokerogue", abilityId: 151 }], unresolvedParts: ["50% more damage to Water-types"], hasRider: true },
  395: { erAbilityId: 395, parts: [{ kind: "pokerogue", abilityId: 178 }, { kind: "er", erAbilityId: 368 }], hasRider: false },
  415: { erAbilityId: 415, parts: [{ kind: "er", erAbilityId: 307 }, { kind: "pokerogue", abilityId: 30 }], hasRider: false },
  416: { erAbilityId: 416, parts: [{ kind: "pokerogue", abilityId: 280 }, { kind: "pokerogue", abilityId: 206 }], hasRider: false },
  440: { erAbilityId: 440, parts: [{ kind: "pokerogue", abilityId: 16 }, { kind: "pokerogue", abilityId: 168 }, { kind: "pokerogue", abilityId: 169 }, { kind: "pokerogue", abilityId: 246 }], hasRider: false },
  460: { erAbilityId: 460, parts: [{ kind: "pokerogue", abilityId: 101 }, { kind: "pokerogue", abilityId: 92 }], hasRider: false },
  467: { erAbilityId: 467, parts: [{ kind: "er", erAbilityId: 363 }, { kind: "er", erAbilityId: 357 }], hasRider: false },
  469: { erAbilityId: 469, parts: [{ kind: "pokerogue", abilityId: 89 }], unresolvedParts: ["Water moves function normally under sun"], hasRider: true },
  480: { erAbilityId: 480, parts: [{ kind: "er", erAbilityId: 488 }, { kind: "er", erAbilityId: 275 }], hasRider: false },
  483: { erAbilityId: 483, parts: [{ kind: "pokerogue", abilityId: 30 }, { kind: "pokerogue", abilityId: 144 }], hasRider: false },
  486: { erAbilityId: 486, parts: [{ kind: "pokerogue", abilityId: 147 }, { kind: "pokerogue", abilityId: 56 }], hasRider: false },
  489: { erAbilityId: 489, parts: [{ kind: "er", erAbilityId: 459 }, { kind: "pokerogue", abilityId: 39 }], hasRider: false },
  490: { erAbilityId: 490, parts: [{ kind: "er", erAbilityId: 333 }, { kind: "er", erAbilityId: 307 }], hasRider: false },
  493: { erAbilityId: 493, parts: [{ kind: "er", erAbilityId: 492 }], unresolvedParts: ["triggers hail when hit"], hasRider: true },
  499: { erAbilityId: 499, parts: [{ kind: "pokerogue", abilityId: 111 }, { kind: "pokerogue", abilityId: 35 }], hasRider: false },
  501: { erAbilityId: 501, parts: [{ kind: "pokerogue", abilityId: 93 }, { kind: "pokerogue", abilityId: 41 }], hasRider: false },
  502: { erAbilityId: 502, parts: [{ kind: "pokerogue", abilityId: 2 }, { kind: "pokerogue", abilityId: 33 }], hasRider: false },
  508: { erAbilityId: 508, parts: [{ kind: "pokerogue", abilityId: 56 }], unresolvedParts: ["heal 25% damage vs infatuated"], hasRider: true },
  513: { erAbilityId: 513, parts: [{ kind: "er", erAbilityId: 271 }, { kind: "er", erAbilityId: 505 }], hasRider: false },
  520: { erAbilityId: 520, parts: [{ kind: "pokerogue", abilityId: 173 }, { kind: "er", erAbilityId: 420 }], hasRider: false },
  524: { erAbilityId: 524, parts: [{ kind: "er", erAbilityId: 378 }, { kind: "pokerogue", abilityId: 244 }], hasRider: false },
  527: { erAbilityId: 527, parts: [{ kind: "pokerogue", abilityId: 234 }, { kind: "pokerogue", abilityId: 83 }], hasRider: false },
  528: { erAbilityId: 528, parts: [{ kind: "pokerogue", abilityId: 235 }, { kind: "pokerogue", abilityId: 192 }], hasRider: false },
  530: { erAbilityId: 530, parts: [{ kind: "pokerogue", abilityId: 127 }, { kind: "pokerogue", abilityId: 265 }, { kind: "pokerogue", abilityId: 264 }], hasRider: false },
  542: { erAbilityId: 542, parts: [{ kind: "er", erAbilityId: 435 }, { kind: "er", erAbilityId: 350 }], hasRider: false },
  590: { erAbilityId: 590, parts: [{ kind: "er", erAbilityId: 421 }, { kind: "er", erAbilityId: 271 }], hasRider: false },
  600: { erAbilityId: 600, parts: [{ kind: "pokerogue", abilityId: 99 }], unresolvedParts: ["Dragon type moves become punching moves"], hasRider: true },
  605: { erAbilityId: 605, parts: [{ kind: "pokerogue", abilityId: 109 }, { kind: "pokerogue", abilityId: 128 }], hasRider: false },
  606: { erAbilityId: 606, parts: [{ kind: "pokerogue", abilityId: 26 }, { kind: "er", erAbilityId: 359 }], hasRider: false },
  613: { erAbilityId: 613, parts: [{ kind: "pokerogue", abilityId: 169 }, { kind: "pokerogue", abilityId: 98 }], hasRider: false },
  614: { erAbilityId: 614, parts: [{ kind: "pokerogue", abilityId: 106 }, { kind: "er", erAbilityId: 290 }], hasRider: false },
  615: { erAbilityId: 615, parts: [{ kind: "pokerogue", abilityId: 173 }, { kind: "er", erAbilityId: 525 }], hasRider: false },
  620: { erAbilityId: 620, parts: [{ kind: "er", erAbilityId: 342 }], unresolvedParts: ["Water STAB"], hasRider: true },
  635: { erAbilityId: 635, parts: [{ kind: "er", erAbilityId: 357 }, { kind: "pokerogue", abilityId: 212 }], hasRider: false },
  638: { erAbilityId: 638, parts: [{ kind: "er", erAbilityId: 636 }, { kind: "er", erAbilityId: 331 }], hasRider: false },
  647: { erAbilityId: 647, parts: [{ kind: "er", erAbilityId: 390 }, { kind: "pokerogue", abilityId: 182 }], hasRider: false },
  651: { erAbilityId: 651, parts: [{ kind: "er", erAbilityId: 591 }, { kind: "pokerogue", abilityId: 144 }], hasRider: false },
  652: { erAbilityId: 652, parts: [{ kind: "pokerogue", abilityId: 84 }, { kind: "pokerogue", abilityId: 247 }], hasRider: false },
  654: { erAbilityId: 654, parts: [{ kind: "pokerogue", abilityId: 9 }], unresolvedParts: ["Rest in Peace"], hasRider: true },
  661: { erAbilityId: 661, parts: [{ kind: "pokerogue", abilityId: 39 }, { kind: "pokerogue", abilityId: 201 }], hasRider: false },
  664: { erAbilityId: 664, parts: [{ kind: "pokerogue", abilityId: 199 }, { kind: "er", erAbilityId: 351 }], hasRider: false },
  665: { erAbilityId: 665, parts: [{ kind: "pokerogue", abilityId: 18 }, { kind: "pokerogue", abilityId: 11 }], hasRider: false },
  // 666 Snowy Wrath reclassified composite -> bespoke (Snow Warning's plain HAIL
  // lacks the +50% Ice Defense the 2.65 dex requires). Its vestigial parts entry is
  // removed so the side-table count stays in lockstep with the archetype config; the
  // live wire (SNOWY_WRATH weather summon + Cryomancy frostbite) is in dispatchBespoke.
  667: { erAbilityId: 667, parts: [{ kind: "pokerogue", abilityId: 168 }, { kind: "pokerogue", abilityId: 61 }], hasRider: false },
  675: { erAbilityId: 675, parts: [{ kind: "pokerogue", abilityId: 3 }, { kind: "er", erAbilityId: 695 }], hasRider: false },
  679: { erAbilityId: 679, parts: [{ kind: "pokerogue", abilityId: 39 }, { kind: "er", erAbilityId: 375 }], hasRider: false },
  680: { erAbilityId: 680, parts: [{ kind: "er", erAbilityId: 649 }, { kind: "pokerogue", abilityId: 33 }], hasRider: false },
  681: { erAbilityId: 681, parts: [{ kind: "pokerogue", abilityId: 89 }], unresolvedParts: ["30% Steel type damage"], hasRider: true },
  682: { erAbilityId: 682, parts: [{ kind: "pokerogue", abilityId: 85 }, { kind: "er", erAbilityId: 321 }], hasRider: false },
  683: { erAbilityId: 683, parts: [{ kind: "pokerogue", abilityId: 178 }, { kind: "er", erAbilityId: 275 }], hasRider: false },
  684: { erAbilityId: 684, parts: [{ kind: "pokerogue", abilityId: 260 }, { kind: "er", erAbilityId: 340 }], hasRider: false },
  686: { erAbilityId: 686, parts: [{ kind: "pokerogue", abilityId: 301 }, { kind: "er", erAbilityId: 485 }], hasRider: false },
  688: { erAbilityId: 688, parts: [{ kind: "er", erAbilityId: 371 }, { kind: "pokerogue", abilityId: 26 }], hasRider: false },
  689: { erAbilityId: 689, parts: [{ kind: "pokerogue", abilityId: 109 }], unresolvedParts: ["Sword of Ruin"], hasRider: true },
  693: { erAbilityId: 693, parts: [{ kind: "pokerogue", abilityId: 209 }], hasRider: false },
  694: { erAbilityId: 694, parts: [{ kind: "pokerogue", abilityId: 113 }, { kind: "pokerogue", abilityId: 104 }], hasRider: false },
  696: { erAbilityId: 696, parts: [{ kind: "pokerogue", abilityId: 181 }, { kind: "er", erAbilityId: 363 }], hasRider: false },
  701: { erAbilityId: 701, parts: [{ kind: "er", erAbilityId: 319 }, { kind: "er", erAbilityId: 381 }], hasRider: false },
  706: { erAbilityId: 706, parts: [{ kind: "pokerogue", abilityId: 173 }], unresolvedParts: ["Bite moves have 50% paralysis chance"], hasRider: true },
  707: { erAbilityId: 707, parts: [{ kind: "pokerogue", abilityId: 119 }, { kind: "er", erAbilityId: 329 }], hasRider: false },
  714: { erAbilityId: 714, parts: [{ kind: "er", erAbilityId: 307 }, { kind: "pokerogue", abilityId: 247 }], hasRider: false },
  716: { erAbilityId: 716, parts: [{ kind: "pokerogue", abilityId: 196 }, { kind: "er", erAbilityId: 349 }], hasRider: false },
  721: { erAbilityId: 721, parts: [{ kind: "er", erAbilityId: 275 }, { kind: "er", erAbilityId: 358 }], hasRider: false },
  725: { erAbilityId: 725, parts: [{ kind: "pokerogue", abilityId: 212 }, { kind: "er", erAbilityId: 411 }], hasRider: false },
  726: { erAbilityId: 726, parts: [{ kind: "er", erAbilityId: 325 }, { kind: "pokerogue", abilityId: 244 }], hasRider: false },
  727: { erAbilityId: 727, parts: [{ kind: "pokerogue", abilityId: 198 }], unresolvedParts: ["On the Prowl"], hasRider: true },
  741: { erAbilityId: 741, parts: [{ kind: "pokerogue", abilityId: 33 }, { kind: "pokerogue", abilityId: 100 }], hasRider: false },
  744: { erAbilityId: 744, parts: [{ kind: "pokerogue", abilityId: 45 }, { kind: "pokerogue", abilityId: 159 }], hasRider: false },
  746: { erAbilityId: 746, parts: [{ kind: "pokerogue", abilityId: 190 }, { kind: "pokerogue", abilityId: 297 }], hasRider: false },
  749: { erAbilityId: 749, parts: [{ kind: "pokerogue", abilityId: 11 }, { kind: "pokerogue", abilityId: 114 }], hasRider: false },
  755: { erAbilityId: 755, parts: [{ kind: "er", erAbilityId: 290 }, { kind: "er", erAbilityId: 358 }], hasRider: false },
  758: { erAbilityId: 758, parts: [{ kind: "pokerogue", abilityId: 69 }, { kind: "pokerogue", abilityId: 120 }], hasRider: false },
  759: { erAbilityId: 759, parts: [{ kind: "pokerogue", abilityId: 75 }], unresolvedParts: ["50BP Thunder Cage when hit by contact"], hasRider: true },
  760: { erAbilityId: 760, parts: [{ kind: "pokerogue", abilityId: 212 }], unresolvedParts: ["Poison STAB"], hasRider: true },
  762: { erAbilityId: 762, parts: [{ kind: "er", erAbilityId: 275 }], unresolvedParts: ["Always hits"], hasRider: true },
  763: { erAbilityId: 763, parts: [{ kind: "pokerogue", abilityId: 98 }, { kind: "pokerogue", abilityId: 156 }], hasRider: false },
  765: { erAbilityId: 765, parts: [{ kind: "er", erAbilityId: 331 }, { kind: "er", erAbilityId: 457 }], hasRider: false },
  766: { erAbilityId: 766, parts: [{ kind: "pokerogue", abilityId: 22 }, { kind: "er", erAbilityId: 350 }], hasRider: false },
  768: { erAbilityId: 768, parts: [{ kind: "er", erAbilityId: 361 }, { kind: "pokerogue", abilityId: 216 }], hasRider: false },
  772: { erAbilityId: 772, parts: [{ kind: "er", erAbilityId: 284 }, { kind: "pokerogue", abilityId: 196 }], hasRider: false },
  776: { erAbilityId: 776, parts: [{ kind: "er", erAbilityId: 287 }], hasRider: false },
  777: { erAbilityId: 777, parts: [{ kind: "pokerogue", abilityId: 178 }, { kind: "er", erAbilityId: 377 }], hasRider: false },
  778: { erAbilityId: 778, parts: [{ kind: "pokerogue", abilityId: 38 }, { kind: "er", erAbilityId: 390 }], hasRider: false },
  779: { erAbilityId: 779, parts: [{ kind: "pokerogue", abilityId: 136 }, { kind: "pokerogue", abilityId: 38 }], hasRider: false },
  780: { erAbilityId: 780, parts: [{ kind: "pokerogue", abilityId: 178 }], unresolvedParts: ["Status moves are Mega Launcher moves"], hasRider: true },
  781: { erAbilityId: 781, parts: [{ kind: "er", erAbilityId: 435 }, { kind: "er", erAbilityId: 376 }], hasRider: false },
  783: { erAbilityId: 783, parts: [{ kind: "pokerogue", abilityId: 131 }, { kind: "pokerogue", abilityId: 132 }], hasRider: false },
  785: { erAbilityId: 785, parts: [{ kind: "pokerogue", abilityId: 258 }], unresolvedParts: ["Elec and Dark deal 1.35x with 10% recoil"], hasRider: true },
  789: { erAbilityId: 789, parts: [{ kind: "er", erAbilityId: 326 }, { kind: "pokerogue", abilityId: 5 }], hasRider: false },
  790: { erAbilityId: 790, parts: [{ kind: "er", erAbilityId: 358 }, { kind: "pokerogue", abilityId: 23 }], hasRider: false },
  792: { erAbilityId: 792, parts: [{ kind: "er", erAbilityId: 316 }, { kind: "er", erAbilityId: 420 }], hasRider: false },
  793: { erAbilityId: 793, parts: [{ kind: "pokerogue", abilityId: 148 }, { kind: "pokerogue", abilityId: 233 }], hasRider: false },
  801: { erAbilityId: 801, parts: [{ kind: "pokerogue", abilityId: 102 }, { kind: "pokerogue", abilityId: 139 }], hasRider: false },
  802: { erAbilityId: 802, parts: [{ kind: "pokerogue", abilityId: 34 }, { kind: "pokerogue", abilityId: 94 }], hasRider: false },
  805: { erAbilityId: 805, parts: [{ kind: "pokerogue", abilityId: 110 }, { kind: "er", erAbilityId: 482 }], hasRider: false },
  806: { erAbilityId: 806, parts: [{ kind: "pokerogue", abilityId: 97 }], hasRider: false },
  811: { erAbilityId: 811, parts: [{ kind: "pokerogue", abilityId: 110 }, { kind: "er", erAbilityId: 275 }], hasRider: false },
  818: { erAbilityId: 818, parts: [{ kind: "er", erAbilityId: 523 }, { kind: "er", erAbilityId: 819 }], hasRider: false },
  821: { erAbilityId: 821, parts: [{ kind: "er", erAbilityId: 329 }, { kind: "er", erAbilityId: 334 }], hasRider: false },
  // Ominous Shroud. Maintainer 2026-07-17: nativized — Phantom (324, type-grant) -> Foggy Eye (967).
  822: { erAbilityId: 822, parts: [{ kind: "er", erAbilityId: 967 }, { kind: "pokerogue", abilityId: 231 }], hasRider: false },
  825: { erAbilityId: 825, parts: [{ kind: "pokerogue", abilityId: 202 }, { kind: "pokerogue", abilityId: 81 }], hasRider: false },
  826: { erAbilityId: 826, parts: [{ kind: "pokerogue", abilityId: 56 }], unresolvedParts: ["Fairy STAB"], hasRider: true },
  827: { erAbilityId: 827, parts: [{ kind: "pokerogue", abilityId: 61 }, { kind: "pokerogue", abilityId: 147 }], hasRider: false },
  829: { erAbilityId: 829, parts: [{ kind: "er", erAbilityId: 341 }, { kind: "pokerogue", abilityId: 200 }], hasRider: false },
  835: { erAbilityId: 835, parts: [{ kind: "er", erAbilityId: 713 }, { kind: "pokerogue", abilityId: 33 }], hasRider: false },
  840: { erAbilityId: 840, parts: [{ kind: "pokerogue", abilityId: 24 }, { kind: "pokerogue", abilityId: 38 }], hasRider: false },
  841: { erAbilityId: 841, parts: [{ kind: "er", erAbilityId: 413 }, { kind: "er", erAbilityId: 310 }], hasRider: false },
  844: { erAbilityId: 844, parts: [{ kind: "er", erAbilityId: 505 }], unresolvedParts: ["use 20% of spdef during moves"], hasRider: true },
  845: { erAbilityId: 845, parts: [{ kind: "er", erAbilityId: 390 }], unresolvedParts: ["30% Bleed chance on horn moves"], hasRider: true },
  846: { erAbilityId: 846, parts: [{ kind: "er", erAbilityId: 433 }, { kind: "er", erAbilityId: 844 }], hasRider: false },
  848: { erAbilityId: 848, parts: [{ kind: "pokerogue", abilityId: 80 }], unresolvedParts: ["blocks phasing moves"], hasRider: true },
  // 849 World Serpent reclassified composite -> bespoke (the Long Reach + Grip
  // Pincer resolution was WRONG per the 2.65 dex); its vestigial parts entry is
  // removed so the side-table count stays in lockstep with the archetype config.
  850: { erAbilityId: 850, parts: [{ kind: "pokerogue", abilityId: 32 }, { kind: "er", erAbilityId: 371 }], hasRider: false },
  854: { erAbilityId: 854, parts: [{ kind: "pokerogue", abilityId: 178 }, { kind: "er", erAbilityId: 568 }], hasRider: false },
  856: { erAbilityId: 856, parts: [{ kind: "er", erAbilityId: 404 }], unresolvedParts: ["Rock moves have 50% burn chance"], hasRider: true },
  857: { erAbilityId: 857, parts: [{ kind: "pokerogue", abilityId: 214 }], unresolvedParts: ["Glare on entry once per battle"], hasRider: true },
  859: { erAbilityId: 859, parts: [{ kind: "pokerogue", abilityId: 213 }, { kind: "er", erAbilityId: 305 }], unresolvedParts: ["Deal 20% more damage"], hasRider: true },
  860: { erAbilityId: 860, parts: [{ kind: "pokerogue", abilityId: 100 }, { kind: "pokerogue", abilityId: 148 }], hasRider: false },
  861: { erAbilityId: 861, parts: [{ kind: "pokerogue", abilityId: 173 }], unresolvedParts: ["Jaws of Carnage"], hasRider: true },
  863: { erAbilityId: 863, parts: [{ kind: "er", erAbilityId: 270 }, { kind: "er", erAbilityId: 456 }], hasRider: false },
  867: { erAbilityId: 867, parts: [{ kind: "pokerogue", abilityId: 2 }, { kind: "er", erAbilityId: 226 }], hasRider: false },
  // 869-873 cluster re-key (was cross-wired — see er-ability-archetypes.ts).
  // 869 Blistering Sun is now bespoke (no composite entry). 872 Aurora's Gale is
  // now damage-reduction-generic (no composite entry).
  // 870 Molten Core = er323 Majestic Bird (SpAtk x1.5) + er348 North Wind (Aurora Veil + Hail immunity).
  870: { erAbilityId: 870, parts: [{ kind: "er", erAbilityId: 323 }, { kind: "er", erAbilityId: 348 }], hasRider: false },
  // 871 Fire Aspect = Desolate Land (190) + er320 Air Blower (3-turn Tailwind) + "double allies' Speed" rider.
  871: { erAbilityId: 871, parts: [{ kind: "pokerogue", abilityId: 190 }, { kind: "er", erAbilityId: 320 }], unresolvedParts: ["Doubles all allies' Speed"], hasRider: true },
  // 873 Ice Plumes = er447 Furnace (+2 Speed on Rock hit / SR-present entry) + Rock/SR-absorb+heal rider.
  873: { erAbilityId: 873, parts: [{ kind: "er", erAbilityId: 447 }], unresolvedParts: ["Absorbs Rock-moves/Stealth Rocks"], hasRider: true },
  881: { erAbilityId: 881, parts: [{ kind: "er", erAbilityId: 303 }], unresolvedParts: ["Rock moves ignore abilities"], hasRider: true },
  894: { erAbilityId: 894, parts: [{ kind: "pokerogue", abilityId: 301 }, { kind: "pokerogue", abilityId: 132 }], hasRider: false },
  900: { erAbilityId: 900, parts: [{ kind: "pokerogue", abilityId: 159 }, { kind: "er", erAbilityId: 482 }], hasRider: false },
  901: { erAbilityId: 901, parts: [{ kind: "pokerogue", abilityId: 221 }, { kind: "pokerogue", abilityId: 192 }], hasRider: false },
  902: { erAbilityId: 902, parts: [{ kind: "er", erAbilityId: 360 }, { kind: "pokerogue", abilityId: 35 }], hasRider: false },
  903: { erAbilityId: 903, parts: [{ kind: "er", erAbilityId: 412 }, { kind: "er", erAbilityId: 307 }], hasRider: false },
  // Dragonfruit. Maintainer 2026-07-17: nativized — Half Drake (310, type-grant) -> Draconize (413).
  918: { erAbilityId: 918, parts: [{ kind: "er", erAbilityId: 413 }, { kind: "pokerogue", abilityId: 24 }], hasRider: false },
  919: { erAbilityId: 919, parts: [{ kind: "pokerogue", abilityId: 181 }, { kind: "er", erAbilityId: 404 }], hasRider: false },
  922: { erAbilityId: 922, parts: [{ kind: "pokerogue", abilityId: 214 }, { kind: "pokerogue", abilityId: 79 }], hasRider: false },
  925: { erAbilityId: 925, parts: [{ kind: "er", erAbilityId: 571 }, { kind: "er", erAbilityId: 924 }], hasRider: false },
  928: { erAbilityId: 928, parts: [{ kind: "er", erAbilityId: 347 }, { kind: "er", erAbilityId: 533 }], hasRider: false },
  929: { erAbilityId: 929, parts: [{ kind: "pokerogue", abilityId: 117 }, { kind: "pokerogue", abilityId: 115 }], hasRider: false },
  930: { erAbilityId: 930, parts: [{ kind: "pokerogue", abilityId: 181 }, { kind: "pokerogue", abilityId: 202 }], hasRider: false },
  934: { erAbilityId: 934, parts: [{ kind: "er", erAbilityId: 794 }, { kind: "er", erAbilityId: 695 }], hasRider: false },
  936: { erAbilityId: 936, parts: [{ kind: "er", erAbilityId: 321 }, { kind: "pokerogue", abilityId: 47 }], hasRider: false },
  939: { erAbilityId: 939, parts: [{ kind: "pokerogue", abilityId: 98 }, { kind: "er", erAbilityId: 534 }], hasRider: false },
  948: { erAbilityId: 948, parts: [{ kind: "pokerogue", abilityId: 221 }, { kind: "pokerogue", abilityId: 218 }], hasRider: false },
  950: { erAbilityId: 950, parts: [{ kind: "er", erAbilityId: 735 }, { kind: "er", erAbilityId: 523 }], hasRider: false },
  954: { erAbilityId: 954, parts: [{ kind: "pokerogue", abilityId: 47 }, { kind: "pokerogue", abilityId: 212 }], hasRider: false },
  958: { erAbilityId: 958, parts: [{ kind: "er", erAbilityId: 326 }, { kind: "pokerogue", abilityId: 171 }], hasRider: false },
  959: { erAbilityId: 959, parts: [{ kind: "er", erAbilityId: 271 }], unresolvedParts: ["Grass moves become Keen Edge boosted"], hasRider: true },
  961: { erAbilityId: 961, parts: [{ kind: "er", erAbilityId: 358 }, { kind: "er", erAbilityId: 715 }], hasRider: false },
  962: { erAbilityId: 962, parts: [{ kind: "er", erAbilityId: 272 }], unresolvedParts: ["Huge Wings"], hasRider: true },
  965: { erAbilityId: 965, parts: [{ kind: "er", erAbilityId: 409 }, { kind: "er", erAbilityId: 712 }], hasRider: false },
  966: { erAbilityId: 966, parts: [{ kind: "pokerogue", abilityId: 35 }, { kind: "er", erAbilityId: 270 }], hasRider: false },
  968: { erAbilityId: 968, parts: [{ kind: "pokerogue", abilityId: 75 }, { kind: "pokerogue", abilityId: 38 }], hasRider: false },
  969: { erAbilityId: 969, parts: [{ kind: "er", erAbilityId: 347 }], unresolvedParts: ["Water STAB"], hasRider: true },
  970: { erAbilityId: 970, parts: [{ kind: "er", erAbilityId: 316 }, { kind: "pokerogue", abilityId: 4 }], hasRider: false },
  971: { erAbilityId: 971, parts: [{ kind: "pokerogue", abilityId: 22 }, { kind: "er", erAbilityId: 329 }], hasRider: true, riderText: "10% burn chance on non contact moves" },
  972: { erAbilityId: 972, parts: [{ kind: "er", erAbilityId: 409 }, { kind: "er", erAbilityId: 410 }], hasRider: false },
  973: { erAbilityId: 973, parts: [{ kind: "pokerogue", abilityId: 68 }, { kind: "pokerogue", abilityId: 109 }], hasRider: false },
  976: { erAbilityId: 976, parts: [{ kind: "er", erAbilityId: 361 }], hasRider: false },
  978: { erAbilityId: 978, parts: [{ kind: "pokerogue", abilityId: 173 }], hasRider: false },
  980: { erAbilityId: 980, parts: [{ kind: "pokerogue", abilityId: 188 }, { kind: "pokerogue", abilityId: 178 }], hasRider: false },
  982: { erAbilityId: 982, parts: [{ kind: "er", erAbilityId: 456 }], unresolvedParts: ["Frostbite causes flinching"], hasRider: true },
  985: { erAbilityId: 985, parts: [{ kind: "er", erAbilityId: 390 }], unresolvedParts: ["all Drill moves are 30% stronger"], hasRider: true },
  986: { erAbilityId: 986, parts: [{ kind: "pokerogue", abilityId: 183 }], unresolvedParts: ["Takes 30% less damage from attacks"], hasRider: true },
  964: { erAbilityId: 964, parts: [{ kind: "pokerogue", abilityId: 219 }, { kind: "pokerogue", abilityId: 128 }], hasRider: false },
  988: { erAbilityId: 988, parts: [{ kind: "er", erAbilityId: 293 }, { kind: "er", erAbilityId: 302 }], hasRider: false },
  // Waterborne. Maintainer 2026-07-17: nativized — Aquatic (294, type-grant) -> Hydrate (315).
  990: { erAbilityId: 990, parts: [{ kind: "er", erAbilityId: 315 }, { kind: "pokerogue", abilityId: 91 }], hasRider: false },
  992: { erAbilityId: 992, parts: [{ kind: "pokerogue", abilityId: 201 }, { kind: "er", erAbilityId: 275 }], hasRider: false },
  997: { erAbilityId: 997, parts: [{ kind: "pokerogue", abilityId: 4 }, { kind: "er", erAbilityId: 400 }], hasRider: false },
  999: { erAbilityId: 999, parts: [{ kind: "er", erAbilityId: 358 }, { kind: "er", erAbilityId: 331 }], hasRider: false },
  1001: { erAbilityId: 1001, parts: [{ kind: "er", erAbilityId: 345 }, { kind: "pokerogue", abilityId: 101 }], hasRider: false },
  1002: { erAbilityId: 1002, parts: [{ kind: "pokerogue", abilityId: 111 }, { kind: "pokerogue", abilityId: 75 }], hasRider: false },
  1003: { erAbilityId: 1003, parts: [{ kind: "pokerogue", abilityId: 145 }, { kind: "pokerogue", abilityId: 113 }], hasRider: false },
  1007: { erAbilityId: 1007, parts: [{ kind: "pokerogue", abilityId: 120 }, { kind: "er", erAbilityId: 388 }], hasRider: false },
  1010: { erAbilityId: 1010, parts: [{ kind: "pokerogue", abilityId: 270 }, { kind: "pokerogue", abilityId: 85 }], hasRider: false },
  1011: { erAbilityId: 1011, parts: [{ kind: "er", erAbilityId: 505 }], unresolvedParts: ["Keen Edge moves lower SpDef"], hasRider: true },
  1013: { erAbilityId: 1013, parts: [{ kind: "er", erAbilityId: 632 }, { kind: "er", erAbilityId: 800 }], hasRider: false },
  1015: { erAbilityId: 1015, parts: [{ kind: "pokerogue", abilityId: 85 }, { kind: "pokerogue", abilityId: 75 }], hasRider: false },
  1016: { erAbilityId: 1016, parts: [{ kind: "er", erAbilityId: 347 }, { kind: "er", erAbilityId: 418 }], hasRider: false },
  1017: { erAbilityId: 1017, parts: [{ kind: "pokerogue", abilityId: 89 }], hasRider: false },
  1019: { erAbilityId: 1019, parts: [{ kind: "er", erAbilityId: 378 }], unresolvedParts: ["attacks with 30 BP Hyper Voice when hit"], hasRider: true },
  1020: { erAbilityId: 1020, parts: [{ kind: "er", erAbilityId: 367 }, { kind: "pokerogue", abilityId: 106 }], hasRider: false },
  1024: { erAbilityId: 1024, parts: [{ kind: "pokerogue", abilityId: 151 }, { kind: "pokerogue", abilityId: 172 }], hasRider: false },
  1026: { erAbilityId: 1026, parts: [{ kind: "pokerogue", abilityId: 181 }, { kind: "er", erAbilityId: 1025 }], hasRider: false },
  1029: { erAbilityId: 1029, parts: [{ kind: "er", erAbilityId: 390 }, { kind: "er", erAbilityId: 300 }], hasRider: false },
  1032: { erAbilityId: 1032, parts: [{ kind: "er", erAbilityId: 337 }, { kind: "pokerogue", abilityId: 49 }], hasRider: false },
  1033: { erAbilityId: 1033, parts: [{ kind: "pokerogue", abilityId: 60 }, { kind: "pokerogue", abilityId: 183 }], hasRider: false },
  // 267 stripped (id-resync orphan; archetype entry removed in commit 6803b22).
  // 1028 (King of the Jungle) was flipped from composite-vanilla-mashup to
  // bespoke in round 11 — the dispatcher's bespoke branch wires Infiltrator's
  // attrs + an OffensiveTypeMultiplier(GRASS, 1.5) for the unresolved rider.
  // The side-table entry was removed to keep the per-archetype count balance.
};
