/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { parseFlags } from "./synth-icons.mjs";

describe("synth-icons CLI flags", () => {
  it("parses --verbose", () => {
    expect(parseFlags(["--verbose"])).toEqual({ verbose: true });
  });

  it("parses --limit=N", () => {
    expect(parseFlags(["--limit=5"])).toEqual({ limit: 5 });
  });

  it("parses --slug=NAME", () => {
    expect(parseFlags(["--slug=bulbasaur"])).toEqual({ slugFilter: "bulbasaur" });
  });

  it("combines all flags", () => {
    expect(parseFlags(["--verbose", "--limit=10", "--slug=wyrdeer"])).toEqual({
      verbose: true,
      limit: 10,
      slugFilter: "wyrdeer",
    });
  });

  it("ignores unknown flags", () => {
    expect(parseFlags(["--foo", "bar"])).toEqual({});
  });

  it("returns empty for no flags", () => {
    expect(parseFlags([])).toEqual({});
  });
});
