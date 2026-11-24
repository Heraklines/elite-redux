/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { enumListCodec } from "#data/elite-redux/ability-studio/param-codecs";
import { StatusEffect } from "#enums/status-effect";
import { describe, expect, it } from "vitest";

const table = StatusEffect as unknown as Readonly<Record<string, number>>;
const names = { POISON: "Poison", TOXIC: "Bad poison", SLEEP: "Sleep" };

describe("enumListCodec with player names", () => {
  const codec = enumListCodec(table, "status problem", names);

  it("accepts player words in any case, member names and spaced spellings", () => {
    expect(codec.toCtor("Sleep, bad poison")).toEqual([StatusEffect.SLEEP, StatusEffect.TOXIC]);
    expect(codec.toCtor("POISON,TOXIC,sleep")).toEqual([StatusEffect.POISON, StatusEffect.TOXIC, StatusEffect.SLEEP]);
    expect(codec.toCtor("bad_poison")).toEqual([StatusEffect.TOXIC]);
    expect(codec.toCtor("")).toEqual([]);
  });

  it("rejects unknown words and shows player words back", () => {
    expect(() => codec.toCtor("Sleepy")).toThrow(/not a known status problem/);
    expect(codec.fromInstance([StatusEffect.POISON, StatusEffect.TOXIC])).toBe("Poison, Bad poison");
  });

  it("keeps the old strict behaviour without player names", () => {
    const strict = enumListCodec(table, "status problem");
    expect(strict.toCtor("SLEEP")).toEqual([StatusEffect.SLEEP]);
    expect(() => strict.toCtor("Sleep")).toThrow();
    expect(strict.fromInstance([StatusEffect.POISON, StatusEffect.TOXIC])).toBe("POISON,TOXIC");
  });
});
