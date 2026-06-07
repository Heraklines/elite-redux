/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// ER replaces vanilla TM compatibility with each species' `tutorMoves` (ER's
// universal-tutor model; every record ships tmhmMoves: []). The patcher used to
// MERGE tutorMoves on top of vanilla, leaving vanilla-only moves reachable that
// ER never grants — e.g. an enemy Salazzle using Scald. It now REPLACES the set,
// and prunes both the forward (species->moves) and reverse (move->species) maps.

import { tmSpecies } from "#balance/tm-species-map";
import { speciesTmMoves } from "#balance/tms";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { describe, expect, it } from "vitest";

describe("ER TM-compatibility prune", () => {
  const forwardMoveIds = (speciesId: number): number[] =>
    (speciesTmMoves[speciesId] ?? []).map(e => (Array.isArray(e) ? (e[1] as number) : (e as number)));

  it("Salazzle can no longer learn Scald (vanilla TM ER doesn't grant)", () => {
    expect(forwardMoveIds(SpeciesId.SALAZZLE)).not.toContain(MoveId.SCALD);
  });

  it("the reverse map no longer lists Salazzle under Scald", () => {
    const list = (tmSpecies as Record<number, Array<number | unknown[]>>)[MoveId.SCALD] ?? [];
    const hasSalazzle = list.some(e => (Array.isArray(e) ? e[0] === SpeciesId.SALAZZLE : e === SpeciesId.SALAZZLE));
    expect(hasSalazzle).toBe(false);
  });

  it("Salazzle still keeps a comprehensive ER teachable set (not stripped to empty)", () => {
    expect(forwardMoveIds(SpeciesId.SALAZZLE).length).toBeGreaterThan(20);
  });
});
