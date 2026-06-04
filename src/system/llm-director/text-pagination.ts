/**
 * Shared text-pagination helper for LLM-emitted player-facing text.
 *
 * The dialog box in PokéRogue is 2 visible lines wide. PokéRogue's
 * `MessagePhase` auto-paginates on `$` separators (each `$` becomes a
 * new page that requires an Enter press to advance). Without `$`,
 * Phaser's word-wrap silently truncates anything beyond 2 lines —
 * which is the source of every "the text got cut off and I went to the
 * next fight" report.
 *
 * RULE: any LLM-emitted text we pass to `queueMessage` / `showText`
 * MUST go through `paginate` first, so the chain shows everything.
 */

/**
 * Conservative per-page char cap. The dialog box can technically fit
 * ~120 chars on average, but with proper-noun-heavy LLM prose ("Kantonian",
 * "Slateport", "Mossdeep Observatory") the wrap can blow past 2 lines.
 * 60 chars per page virtually guarantees a 2-line fit.
 */
const DEFAULT_PER_PAGE = 60;

/**
 * Insert `$` page-break separators so PokéRogue's `MessagePhase` paginates
 * the text into multi-page chunks the player can advance through.
 *
 * Strategy:
 *  - If text fits in `perPage`, return as-is (no `$`).
 *  - Otherwise iteratively pull a chunk of up to `perPage` chars.
 *  - Prefer cuts at sentence boundaries (`. `, `! `, `? `) within the
 *    last 50% of the chunk — that keeps each page reading naturally.
 *  - Fall back to last word boundary if no sentence ending is in range.
 *  - Last resort: hard-cut at `perPage` (only when there's no whitespace,
 *    e.g., a single 60+ char word — extremely rare in normal prose).
 *  - Empty pages are never produced.
 */
export function paginate(text: string | undefined, perPage = DEFAULT_PER_PAGE): string {
  if (!text) {
    return "";
  }
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return "";
  }
  if (trimmed.length <= perPage) {
    return trimmed;
  }
  const pages: string[] = [];
  let remaining = trimmed;
  while (remaining.length > perPage) {
    const slice = remaining.slice(0, perPage);
    let cut = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    if (cut < perPage * 0.5) {
      cut = slice.lastIndexOf(" ");
      if (cut < perPage * 0.3) {
        cut = perPage;
      }
    } else {
      cut += 1;
    }
    pages.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining.length > 0) {
    pages.push(remaining);
  }
  return pages.join("$");
}

/**
 * Convenience: paginate each entry then join with `$` so the final string
 * is one message-phase chain that walks through all entries plus their
 * own internal pagination.
 */
export function paginateAndJoin(parts: ReadonlyArray<string | undefined | null>): string {
  const cleaned = parts.map(p => (p ?? "").trim()).filter(p => p.length > 0);
  if (cleaned.length === 0) {
    return "";
  }
  return cleaned.map(p => paginate(p)).join("$");
}
