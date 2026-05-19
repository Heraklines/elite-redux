/*
 * SPDX-FileCopyrightText: 2025 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { parseFlags } from "./parse-flags.mjs";

// argv layout: [nodeBin, scriptPath, ...userArgs]
const ARGV0 = ["node", "build-pokerogue-data.mjs"];

describe("parseFlags", () => {
  it("defaults to {only:null, force:false, dryRun:false} with no args", () => {
    expect(parseFlags(ARGV0)).toEqual({ only: null, force: false, dryRun: false });
  });

  it("parses --force", () => {
    expect(parseFlags([...ARGV0, "--force"]).force).toBe(true);
  });

  it("parses --dry-run", () => {
    expect(parseFlags([...ARGV0, "--dry-run"]).dryRun).toBe(true);
  });

  it("parses --only=species,abilities into an array", () => {
    expect(parseFlags([...ARGV0, "--only=species,abilities"]).only).toEqual(["species", "abilities"]);
  });

  it('returns an empty array for --only= (empty value), not [""]', () => {
    expect(parseFlags([...ARGV0, "--only="]).only).toEqual([]);
  });

  it("filters empty strings out of --only=a,,b", () => {
    expect(parseFlags([...ARGV0, "--only=a,,b"]).only).toEqual(["a", "b"]);
  });

  it("--only=a --only=b: last-wins (current behavior)", () => {
    expect(parseFlags([...ARGV0, "--only=a", "--only=b"]).only).toEqual(["b"]);
  });

  it("--force --force is idempotent", () => {
    expect(parseFlags([...ARGV0, "--force", "--force"]).force).toBe(true);
  });

  it("ignores unknown flags silently", () => {
    expect(parseFlags([...ARGV0, "--verbose"])).toEqual({ only: null, force: false, dryRun: false });
  });
});
