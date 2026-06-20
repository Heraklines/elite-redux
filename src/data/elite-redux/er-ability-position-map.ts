/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER ability reference: array-POSITION -> dex id-FIELD translation.
//
// The ER 2.65 dex (`vendor/elite-redux/v2.65beta.json`) stores its abilities as
// an array whose ENTRIES carry their own `id` field - and for 81 abilities that
// `id` does NOT equal the array position (the abilities array was reordered after
// ids were assigned). The dex/game resolves a species' `abis`/`inns` references by
// ARRAY POSITION (verified against the live ER-nextdex: e.g. Hydreigon Mega's
// ability 930 renders as the entry at position 930, "Wings of Pestilence", not the
// entry whose id-field is 930, "Ice Picks").
//
// `er-species.ts` copies those `abis`/`inns` verbatim, so its ability refs are
// POSITIONS. But the ER ability ENGINE (ER_ABILITIES / er-ability-id / archetypes /
// ER_ID_MAP) was resynced (#commit 609e0c2c0) to key everything by the dex id-FIELD.
// So feeding a species' position ref straight into the id-field-keyed `ER_ID_MAP`
// mismatched for those 81 abilities, which is why mega/primal forms showed the
// WRONG ability (Hydreigon Mega -> Ice Picks instead of Wings of Pestilence;
// Excadrill Mega -> Overcast instead of Mega Drill). The engine itself is correct;
// the missing piece was translating the species' POSITION ref to the dex id-FIELD
// before the lookup - which `mapAbilityId` now does via `dexAbilityId`.
//
// This map lists ONLY the 81 drifted positions (position -> id-field); every other
// position equals its id-field, so `dexAbilityId` is the identity there. The
// er-ability-position-map.test regenerates this from the vendor dex and fails if it
// drifts, so a future dex bump can't silently desync it.
// =============================================================================

/** The 81 ER ability positions whose dex id-field differs from the array index. */
export const ER_ABILITY_POSITION_TO_ID: Readonly<Record<number, number>> = {
  386: 393, 387: 386, 388: 387, 389: 388, 390: 389, 391: 390, 392: 391, 393: 392,
  869: 871, 870: 873, 871: 869, 872: 870, 873: 872, 907: 910, 908: 911, 909: 908,
  910: 909, 911: 912, 912: 907, 919: 920, 920: 919, 922: 945, 923: 946, 924: 922,
  925: 923, 926: 925, 927: 924, 928: 926, 929: 928, 930: 927, 931: 929, 932: 930,
  933: 931, 945: 947, 946: 948, 947: 949, 948: 950, 949: 951, 950: 952, 951: 953,
  952: 954, 953: 955, 954: 956, 955: 957, 956: 958, 957: 959, 958: 960, 959: 987,
  960: 961, 961: 962, 962: 963, 963: 965, 964: 966, 965: 967, 966: 968, 967: 969,
  968: 970, 969: 971, 970: 972, 971: 973, 972: 974, 973: 975, 974: 976, 975: 977,
  976: 978, 977: 979, 978: 980, 979: 981, 980: 983, 981: 982, 982: 984, 983: 985,
  984: 986, 985: 964, 986: 988, 987: 989, 988: 990, 989: 932, 990: 933, 1025: 1026,
  1026: 1025,
};

/**
 * Translate a species' ER ability reference (an array POSITION, as stored in
 * `er-species.ts` `abilities`/`innates`) to the dex id-FIELD that the ER ability
 * engine / {@linkcode ER_ID_MAP} is keyed on. Identity for all but the 81 drifted
 * positions. Pass the result to `ER_ID_MAP.abilities` / `ER_ABILITY_ID_REMAP`.
 */
export function dexAbilityId(positionRef: number): number {
  return ER_ABILITY_POSITION_TO_ID[positionRef] ?? positionRef;
}
