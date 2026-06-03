// One-off generator (#207): emit ER custom mega-stone enum entries + data module.
import { readFileSync, writeFileSync } from "node:fs";

const GENERIC = "lucarionite";
const rows = readFileSync("docs/plans/er-mega-stones.tsv", "utf8")
  .trim()
  .split("\n")
  .map(l => l.split("\t"));
const custom = rows.filter(r => r[1] === "CUSTOM");

// 1) Append enum entries to form-change-item.ts (idempotent).
const enumLines = custom.map(r => "  " + r[0] + ",").join("\n");
let e = readFileSync("src/enums/form-change-item.ts", "utf8");
const MARK = "// --- Elite Redux custom mega/primal stones";
if (!e.includes(MARK)) {
  e = e.replace(/\n}\s*$/, "\n\n  " + MARK + " (#207) ---\n" + enumLines + "\n}\n");
  writeFileSync("src/enums/form-change-item.ts", e);
}

// 2) Emit the data module.
const defs = custom
  .map(r => {
    const icon = r[2] && r[2].length > 0 ? r[2].toLowerCase() : GENERIC;
    return '  ["' + r[0] + '", "' + icon + '"],';
  })
  .join("\n");

const L = [];
L.push("/*");
L.push(" * SPDX-FileCopyrightText: 2024-2026 Pagefault Games");
L.push(" *");
L.push(" * SPDX-License-Identifier: AGPL-3.0-only");
L.push(" */");
L.push("");
L.push("// =============================================================================");
L.push("// Elite Redux - custom mega/primal stones (#207).");
L.push("//");
L.push("// ER models ~284 megas/primals as SEPARATE species, but the base mon keeps a");
L.push("// vanilla 'mega' form, so a held form-change item triggers it the normal way.");
L.push("// 54 ER stones reuse a vanilla FormChangeItem (already in the engine); the 227");
L.push("// here are ER-only, appended to form-change-item.ts as real enum values so the");
L.push("// reward pool offers them (Mega-Bracelet gated) and holding one triggers the");
L.push("// base mon's mega form.");
L.push("//");
L.push("// Icons: the decomp only ships art for standard + ~9 custom stones, so we REUSE");
L.push("// existing in-atlas item icons - the base vanilla stone for variants of vanilla");
L.push("// megas (e.g. ABOMASITE_S -> abomasite), else a generic stone icon.");
L.push("// =============================================================================");
L.push("");
L.push('import { FormChangeItem } from "#enums/form-change-item";');
L.push("");
L.push("/** [ER stone enum name, existing items-atlas icon frame to reuse]. */");
L.push("const ER_STONE_DEFS: ReadonlyArray<readonly [string, string]> = [");
L.push(defs);
L.push("];");
L.push("");
L.push("type FcRecord = Record<string, number>;");
L.push("");
L.push("/** ER-only FormChangeItem ids (the custom mega/primal stones). */");
L.push("export const ER_MEGA_STONE_ITEMS: ReadonlySet<FormChangeItem> = new Set<FormChangeItem>(");
L.push("  ER_STONE_DEFS.map(([name]) => (FormChangeItem as FcRecord)[name]).filter(");
L.push("    (v): v is FormChangeItem => v !== undefined,");
L.push("  ),");
L.push(");");
L.push("");
L.push("/** ER stone id -> the existing items-atlas icon frame it reuses. */");
L.push("const ER_STONE_ICON_BY_ITEM: ReadonlyMap<FormChangeItem, string> = new Map(");
L.push(
  "  ER_STONE_DEFS.map(([name, icon]) => [(FormChangeItem as FcRecord)[name] as FormChangeItem, icon] as const).filter(",
);
L.push("    ([item]) => item !== undefined,");
L.push("  ),");
L.push(");");
L.push("");
L.push("/** True if the FormChangeItem is one of the ER-only custom stones. */");
L.push("export function isErMegaStone(item: FormChangeItem): boolean {");
L.push("  return ER_MEGA_STONE_ITEMS.has(item);");
L.push("}");
L.push("");
L.push("/** The reused items-atlas icon frame for an ER stone (undefined for vanilla). */");
L.push("export function erMegaStoneIconFrame(item: FormChangeItem): string | undefined {");
L.push("  return ER_STONE_ICON_BY_ITEM.get(item);");
L.push("}");
L.push("");
L.push("/**");
L.push(" * Resolve an ER mega/primal requirement const (ITEM_VENUSAURITE, ITEM_BUTTERFRENITE,");
L.push(" * ...) to its FormChangeItem - the vanilla enum value when the name matches, else");
L.push(" * the appended ER-custom value. Undefined if the stone name is unknown to the enum.");
L.push(" */");
L.push(
  "export function resolveErStoneFormChangeItem(requirement: string | undefined | null): FormChangeItem | undefined {",
);
L.push('  if (!requirement || !requirement.startsWith("ITEM_")) {');
L.push("    return undefined;");
L.push("  }");
L.push('  const name = requirement.slice("ITEM_".length);');
L.push("  const v = (FormChangeItem as FcRecord)[name];");
L.push('  return typeof v === "number" ? (v as FormChangeItem) : undefined;');
L.push("}");
L.push("");
writeFileSync("src/data/elite-redux/er-mega-stones.ts", L.join("\n"));
console.log("WROTE enum entries:", custom.length, "+ er-mega-stones.ts");
