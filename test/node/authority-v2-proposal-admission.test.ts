/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { CoopV2ProposalAdmissionLedger } from "#data/elite-redux/coop/authority-v2/proposal-admission";
import { describe, expect, it } from "vitest";

describe("Authority V2 proposal admission", () => {
  it("admits one identity once and treats same-fingerprint retries as non-mechanical duplicates", () => {
    const ledger = new CoopV2ProposalAdmissionLedger();
    const proposal = { operationId: "OP/1/1/10/REWARD", fingerprint: '[10,"reward",0]' };

    expect(ledger.admit(proposal)).toBe("admitted");
    expect(ledger.admit(proposal)).toBe("duplicate");
    expect(ledger.admit(proposal)).toBe("duplicate");
    expect(ledger.size).toBe(1);
  });

  it("rejects identity reuse with different material and never evicts at capacity", () => {
    const ledger = new CoopV2ProposalAdmissionLedger(1);

    expect(ledger.admit({ operationId: "OP/1/1/10/REWARD", fingerprint: "buy" })).toBe("admitted");
    expect(ledger.admit({ operationId: "OP/1/1/10/REWARD", fingerprint: "reroll" })).toBe("conflict");
    expect(ledger.admit({ operationId: "OP/1/1/11/REWARD", fingerprint: "leave" })).toBe("capacity-exhausted");
    expect(ledger.size).toBe(1);
  });

  it("resets only at an explicit session boundary", () => {
    const ledger = new CoopV2ProposalAdmissionLedger();
    const proposal = { operationId: "OP/1/1/10/REWARD", fingerprint: "buy" };

    expect(ledger.admit(proposal)).toBe("admitted");
    ledger.reset();
    expect(ledger.admit(proposal)).toBe("admitted");
  });
});
