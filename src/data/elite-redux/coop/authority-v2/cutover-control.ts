/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type {
  CoopCommandOpenMaterialV2,
  CoopInteractionOpenMaterialV2,
} from "#data/elite-redux/coop/authority-v2/adapters/control-open";
import type { CoopAuthorityEntry, CoopNextControl } from "#data/elite-redux/coop/authority-v2/contract";
import type { CoopAuthorityV2Shadow, CoopV2AuthorityFrontier } from "#data/elite-redux/coop/authority-v2/shadow";

/**
 * Switchboard for the explicit control-open boundary. It is installed only
 * once turn, wave, and interaction authority all share the same V2 log.
 */
export class CoopV2ControlCutover {
  private disposed = false;

  constructor(private readonly harness: CoopAuthorityV2Shadow) {}

  authorityFrontier(): CoopV2AuthorityFrontier | null {
    return this.disposed ? null : this.harness.authorityFrontier();
  }

  commitHostCommandOpen(input: {
    readonly operationId: string;
    readonly material: CoopCommandOpenMaterialV2;
    readonly command: Extract<CoopNextControl, { kind: "COMMAND_FRONTIER" }>;
  }): CoopAuthorityEntry | null {
    if (this.disposed) {
      return null;
    }
    return this.harness.tapCommandOpen(input);
  }

  commitHostInteractionOpen(input: {
    readonly operationId: string;
    readonly material: CoopInteractionOpenMaterialV2;
  }): CoopAuthorityEntry | null {
    if (this.disposed) {
      return null;
    }
    return this.harness.tapInteractionOpen(input);
  }

  dispose(): void {
    this.disposed = true;
  }
}
