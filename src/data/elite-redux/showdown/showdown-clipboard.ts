/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown teambuilder - a guarded clipboard write for Export (set / team text).
//
// Uses the async Clipboard API where available (secure contexts) and falls back to the legacy
// `document.execCommand("copy")` via a transient off-screen textarea for older / insecure contexts.
// Every path is wrapped so a headless / permission-denied environment is a silent no-op (the Export
// confirmation banner is shown by the handler regardless; the copy is best-effort).
// =============================================================================

/** Best-effort copy of `text` to the system clipboard. Never throws. */
export function copyTextToClipboard(text: string): void {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
      return;
    }
    fallbackCopy(text);
  } catch {
    /* clipboard unavailable (headless / denied) - best-effort, the export banner still shows */
  }
}

/** Legacy fallback: a hidden textarea + `execCommand("copy")`. No-op when there is no DOM. */
function fallbackCopy(text: string): void {
  try {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    document.execCommand("copy");
    document.body.removeChild(area);
  } catch {
    /* no-op */
  }
}
