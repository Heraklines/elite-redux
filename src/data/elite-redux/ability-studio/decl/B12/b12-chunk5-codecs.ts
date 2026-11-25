/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// B12 chunk 5. Codecs of the four weather classes (a helper, not a declaration: the registry only collects `*.decl.ts` and
// `bindings.ts`). Staff read and write plain weather names; the classes take weather numbers.
//
//   requiredWeatherListCodec  "Hail, Snow" <-> [HAIL, SNOW]   (at least one weather: an empty list would never fire, and the
//                                                              three options-object classes refuse it)
//
// The word list itself (Sun, Rain, Sandstorm, Hail, Snow, Fog, ...) is chunk 3's, so the two chunks cannot disagree.
import type { ParamCodec } from "#data/elite-redux/ability-studio/define-decl";
import { formatWeatherList, parseWeatherList, WEATHER_LIST_WORDS } from "./b12-chunk3-codecs";

/** A list of weathers that must not be empty. */
export const requiredWeatherListCodec: ParamCodec = {
  toCtor: value => {
    const list = parseWeatherList(String(value));
    if (list.length === 0) {
      throw new Error(`pick at least one weather, for example ${WEATHER_LIST_WORDS.slice(0, 3).join(", ")}`);
    }
    return list;
  },
  fromInstance: raw => {
    const text = formatWeatherList(raw);
    // The helper reads a missing list as "" (no weather needed); here a missing list is not a value staff can see.
    return text === undefined || text === "" ? undefined : text;
  },
};
