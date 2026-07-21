/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// CO-OP AUTHORITY V2 - NON-MECHANICAL PROPOSAL ADMISSION.
//
// A remote human input is not an authority-log entry. It may be retransmitted
// until the authority publishes the matching immutable result, so the authority
// must deduplicate the proposal identity before any phase can execute it.
//
// This ledger never allocates a revision, installs control, or applies material.
// It only proves that one stable proposal ID always names one stable fingerprint
// for the lifetime of a session epoch.
// =============================================================================

export interface CoopV2ProposalIdentity {
  readonly operationId: string;
  readonly fingerprint: string;
}

export type CoopV2ProposalAdmission = "admitted" | "duplicate" | "conflict" | "invalid" | "capacity-exhausted";

const DEFAULT_PROPOSAL_CAPACITY = 8_192;

export class CoopV2ProposalAdmissionLedger {
  private readonly fingerprints = new Map<string, string>();

  constructor(private readonly capacity = DEFAULT_PROPOSAL_CAPACITY) {}

  admit(proposal: CoopV2ProposalIdentity): CoopV2ProposalAdmission {
    if (
      typeof proposal.operationId !== "string"
      || proposal.operationId.length === 0
      || typeof proposal.fingerprint !== "string"
      || proposal.fingerprint.length === 0
      || !Number.isSafeInteger(this.capacity)
      || this.capacity <= 0
    ) {
      return "invalid";
    }
    const existing = this.fingerprints.get(proposal.operationId);
    if (existing != null) {
      return existing === proposal.fingerprint ? "duplicate" : "conflict";
    }
    if (this.fingerprints.size >= this.capacity) {
      // Eviction would make a sufficiently late retry executable again. Fail
      // closed instead; a normal run remains far below this defensive ceiling.
      return "capacity-exhausted";
    }
    this.fingerprints.set(proposal.operationId, proposal.fingerprint);
    return "admitted";
  }

  reset(): void {
    this.fingerprints.clear();
  }

  get size(): number {
    return this.fingerprints.size;
  }
}
