/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  COOP_OPERATION_SURFACES,
  COOP_OPERATION_UI_CONTRACTS,
} from "#data/elite-redux/coop/coop-operation-surface-registry";
import { COOP_UI_AUTHORITATIVE_COMMIT_MODES } from "#data/elite-redux/coop/coop-ui-registry";
import { UiMode } from "#enums/ui-mode";
import { describe, expect, it } from "vitest";

describe("co-op authoritative operation public-UI contracts", () => {
  it("totally maps every operation class", () => {
    expect(Object.keys(COOP_OPERATION_UI_CONTRACTS).sort()).toEqual([...COOP_OPERATION_SURFACES].sort());
  });

  it("maps player-driven operations only to reviewed authoritative UI modes", () => {
    for (const cls of COOP_OPERATION_SURFACES) {
      const contract = COOP_OPERATION_UI_CONTRACTS[cls];
      expect(new Set(contract.uiModes).size, `${cls} repeats a UI mode`).toBe(contract.uiModes.length);
      expect(new Set(contract.phaseNames).size, `${cls} repeats a public phase name`).toBe(contract.phaseNames.length);
      if (contract.uiModes.length === 0) {
        expect(contract.phaseNames, `${cls} cannot name public phases without public UI modes`).toEqual([]);
        expect(
          "systemOnlyReason" in contract ? contract.systemOnlyReason.trim().length : 0,
          `${cls} needs a system-only reason`,
        ).toBeGreaterThan(0);
        continue;
      }
      expect("systemOnlyReason" in contract, `${cls} cannot be both player-driven and system-only`).toBe(false);
      expect(contract.phaseNames.length, `${cls} needs at least one exact public phase proof`).toBeGreaterThan(0);
      for (const phaseName of contract.phaseNames) {
        expect(phaseName.endsWith("Phase"), `${cls} names a non-phase proof token: ${phaseName}`).toBe(true);
      }
      for (const mode of contract.uiModes) {
        expect(
          COOP_UI_AUTHORITATIVE_COMMIT_MODES.has(mode),
          `${cls} names ${UiMode[mode]}, which is absent from the authoritative UI commit registry`,
        ).toBe(true);
      }
    }
  });
});
