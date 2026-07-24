/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("Showdown set editor touch controls", () => {
  it("exposes a mode-gated SUBMIT/Done control for mobile", () => {
    const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
    const css = readFileSync(resolve(process.cwd(), "index.css"), "utf8");

    expect(html).toContain('id="apadSubmit"');
    expect(html).toContain('data-key="SUBMIT"');
    expect(html).toContain('<span class="apad-label">Done</span>');
    expect(css).toContain(':not([data-ui-mode="SHOWDOWN_SET_EDITOR"]) #apadSubmit');
  });
});
