/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Gen-9 moves (Aqua Cutter, Ivy Cudgel, …) were build-mapped to empty pkrg
// slots; the c-source correction repoints ER ids to the real MoveId by name.
import { allMoves } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { ER_MOVES } from "#data/elite-redux/er-moves";
import { initEliteReduxCSourceCorrections } from "#data/elite-redux/init-elite-redux-c-source-corrections";
import { beforeAll, describe, expect, it } from "vitest";

describe("ER Gen-9 move id remapping", () => {
  // The Gen-9 remap (repointing ER ids to the real `MoveId` by name) is applied
  // at startup by `initEliteReduxCSourceCorrections`, mutating the module-level
  // `ER_ID_MAP.moves`. Under the full suite, vitest reuses a worker across many
  // files and module state is shared within it — a sibling file that re-runs a
  // move-init pass can leave `ER_ID_MAP.moves` / `allMoves` in a transient
  // state. Re-running the (idempotent) correction here re-establishes the
  // remap so this file doesn't depend on cross-file execution order.
  beforeAll(() => {
    initEliteReduxCSourceCorrections();
  });

  const erMoveByName = (name: string) => ER_MOVES.find(m => m.name === name);

  it.each([
    "Aqua Cutter",
    "Ivy Cudgel",
    "Gigaton Hammer",
    "Tera Starstorm",
    "Upper Hand",
    "Malignant Chain",
    "Dragon Cheer",
    "Matcha Gotcha",
  ])("%s resolves to a real, built pokerogue move", name => {
    const drf = erMoveByName(name);
    expect(drf, `ER move "${name}" should exist`).toBeDefined();
    const pkrgId = ER_ID_MAP.moves[drf!.id];
    expect(pkrgId, `${name} should be mapped`).toBeDefined();
    const move = allMoves[pkrgId];
    expect(move, `${name} should resolve to a built move`).toBeDefined();
    expect(move.name).toBe(name);
  });

  it("no ER move with a vanilla pkrg id (<5000) points at an empty slot", () => {
    const broken = ER_MOVES.filter(m => {
      if (!m.name || m.name === "-") {
        return false;
      }
      const pkrgId = ER_ID_MAP.moves[m.id];
      return pkrgId !== undefined && pkrgId < 5000 && allMoves[pkrgId] === undefined;
    }).map(m => m.name);
    expect(broken, `unresolved vanilla-mapped moves: ${broken.join(", ")}`).toHaveLength(0);
  });
});
