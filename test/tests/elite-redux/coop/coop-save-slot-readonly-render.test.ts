/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "src/ui/handlers/save-slot-select-ui-handler.ts"), "utf8");
const sessionSlotStart = source.indexOf("class SessionSlot extends");
const setupStart = source.indexOf("  setupWithData(data: SessionSaveData) {", sessionSlotStart);
const loadStart = source.indexOf("\n  load(): Promise<boolean>", setupStart);

describe("save-slot read-only rendering contract", () => {
  it("shows an unnamed slot synchronously without racing Delete or Overwrite with a hidden rename", () => {
    expect(sessionSlotStart).toBeGreaterThanOrEqual(0);
    expect(setupStart).toBeGreaterThan(sessionSlotStart);
    expect(loadStart).toBeGreaterThan(setupStart);

    const sessionSlotSource = source.slice(sessionSlotStart);
    const setupSource = source.slice(setupStart, loadStart);

    expect(setupSource).toContain("const displayName = data.name || this.decideFallback(data);");
    expect(setupSource).not.toMatch(/\b(?:async|await)\b/u);
    expect(sessionSlotSource).not.toContain(".renameSession(");
  });
});
