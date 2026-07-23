/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  RichNotificationViewer,
  renderRichNotificationMarkdown,
  safeRichNotificationUrl,
} from "#ui/rich-notification-viewer";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("rich notification viewer", () => {
  afterEach(() => {
    document.querySelectorAll(".er-rich-notification-backdrop").forEach(node => node.remove());
    vi.restoreAllMocks();
  });

  it("renders useful Markdown and strips unsafe HTML and URLs", () => {
    const html = renderRichNotificationMarkdown(`
# Patch Notes

- One
- Two

![Logo](https://example.com/logo.png)
[Community](https://discord.gg/example)
[Unsafe](javascript:alert(1))
<img src=x onerror=alert(1)>
`);

    expect(html).toContain("<h1>Patch Notes</h1>");
    expect(html).toContain("<li>One</li>");
    expect(html).toContain('src="https://example.com/logo.png"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toMatch(/href=["']javascript:|<img[^>]+onerror|<script/iu);
  });

  it("accepts HTTPS and local development URLs only", () => {
    expect(safeRichNotificationUrl("https://discord.gg/example")).toBe("https://discord.gg/example");
    expect(safeRichNotificationUrl("/images/logo.png", "https://elite-redux.pages.dev/")).toBe(
      "https://elite-redux.pages.dev/images/logo.png",
    );
    expect(safeRichNotificationUrl("http://localhost:8000/notes")).toBe("http://localhost:8000/notes");
    expect(safeRichNotificationUrl("javascript:alert(1)")).toBeNull();
    expect(safeRichNotificationUrl("http://example.com/notes")).toBeNull();
  });

  it("builds a scrollable dialog and opens its explicit action", () => {
    const onClose = vi.fn();
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    const viewer = new RichNotificationViewer(
      {
        title: "v0.0.6.0",
        markdown: "# Update\n\nFull notes",
        actionLabel: "Join Discord",
        actionUrl: "https://discord.gg/q8d2jq5dE",
      },
      onClose,
    );

    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector(".er-rich-notification-content")?.innerHTML).toContain("Full notes");
    expect(viewer.activateAction()).toBe(true);
    expect(open).toHaveBeenCalledWith("https://discord.gg/q8d2jq5dE", "_blank", "noopener,noreferrer");

    viewer.close();
    viewer.close();
    expect(onClose).toHaveBeenCalledOnce();
    expect(document.querySelector(".er-rich-notification-backdrop")).toBeNull();
  });
});
