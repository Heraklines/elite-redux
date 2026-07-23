/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { PATCH_NOTES_TYPE, patchNotesContentOf } from "#data/elite-redux/er-ghost-notifications";
import type { ErNotification } from "#system/notifications/notification-manager";
import { describe, expect, it } from "vitest";

function notification(data: unknown, type = PATCH_NOTES_TYPE): ErNotification {
  return { id: "patch:test", type, timestamp: 1, read: false, data };
}

describe("patch-notes notifications", () => {
  it("extracts Markdown, image-capable content, and the explicit action", () => {
    expect(
      patchNotesContentOf(
        notification({
          title: "v0.0.6.0",
          body: "Plain-text fallback",
          payload: {
            markdown: "# Full notes\n\n![Logo](https://example.com/logo.png)",
            actionLabel: "Join PokeRogue Redux Discord",
            actionUrl: "https://discord.gg/q8d2jq5dE",
          },
        }),
      ),
    ).toEqual({
      title: "v0.0.6.0",
      markdown: "# Full notes\n\n![Logo](https://example.com/logo.png)",
      actionLabel: "Join PokeRogue Redux Discord",
      actionUrl: "https://discord.gg/q8d2jq5dE",
    });
  });

  it("falls back to body text and rejects unrelated or empty notifications", () => {
    expect(patchNotesContentOf(notification({ title: "Patch", body: "Fallback", payload: null }))).toEqual({
      title: "Patch",
      markdown: "Fallback",
    });
    expect(patchNotesContentOf(notification({ body: "Fallback" }, "system"))).toBeNull();
    expect(patchNotesContentOf(notification({ body: "   " }))).toBeNull();
  });

  it("upgrades a launch announcement persisted as a legacy system notification", () => {
    expect(
      patchNotesContentOf(
        notification(
          {
            title: "PokeRogue Redux v0.0.6.0",
            body: "Open the full v0.0.6.0 patch notes.",
            payload: {
              announcementId: "patch-notes:0.0.6.0",
              markdown: "# Full notes\n\n![Battle](https://example.com/battle.png)",
              actionLabel: "Join PokeRogue Redux Discord",
              actionUrl: "https://discord.gg/q8d2jq5dE",
            },
          },
          "system",
        ),
      ),
    ).toEqual({
      title: "PokeRogue Redux v0.0.6.0",
      markdown: "# Full notes\n\n![Battle](https://example.com/battle.png)",
      actionLabel: "Join PokeRogue Redux Discord",
      actionUrl: "https://discord.gg/q8d2jq5dE",
    });
  });
});
