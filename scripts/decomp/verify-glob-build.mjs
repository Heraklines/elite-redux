/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Proves that the exact `import.meta.glob` patterns of src/data/elite-redux/ability-studio/
// decl-registry.ts are resolved by the real Vite build (the vitest side is proven by
// test/tests/elite-redux/decomp/decl-registry.test.ts). It copies the patterns out of the source
// file, builds a throwaway project that has declaration and bindings files, and checks that every
// file ended up in the bundle.
//
//   node scripts/decomp/verify-glob-build.mjs
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "vite";

const registrySource = readFileSync(
  resolve(process.cwd(), "src/data/elite-redux/ability-studio/decl-registry.ts"),
  "utf8",
);
const patterns = [...registrySource.matchAll(/import\.meta\.glob(?:<[^(]*>)?\(\s*"([^"]+)"/g)].map(match => match[1]);
if (patterns.length !== 2) {
  throw new Error(`expected 2 import.meta.glob patterns in decl-registry.ts, found ${patterns.length}`);
}

const root = mkdtempSync(join(tmpdir(), "er-glob-build-"));
try {
  mkdirSync(join(root, "decl", "B01"), { recursive: true });
  mkdirSync(join(root, "decl", "B02", "deep"), { recursive: true });
  writeFileSync(join(root, "decl", "B01", "AlphaAbAttr.decl.ts"), 'export default { className: "MARK_ALPHA" };\n');
  writeFileSync(
    join(root, "decl", "B02", "deep", "BetaAbAttr.decl.ts"),
    'export default { className: "MARK_BETA" };\n',
  );
  writeFileSync(join(root, "decl", "B01", "bindings.ts"), 'globalThis.__bindingsLoaded = "MARK_BINDINGS";\n');
  writeFileSync(
    join(root, "entry.ts"),
    [
      `export const decls = import.meta.glob("${patterns[0]}", { eager: true });`,
      `import.meta.glob("${patterns[1]}", { eager: true });`,
      "",
    ].join("\n"),
  );
  const result = await build({
    configFile: false,
    root,
    logLevel: "silent",
    build: { write: false, minify: false, lib: { entry: "entry.ts", formats: ["es"], fileName: "out" } },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
  const code = outputs.map(output => ("code" in output ? output.code : "")).join("\n");
  for (const mark of ["MARK_ALPHA", "MARK_BETA", "MARK_BINDINGS"]) {
    if (!code.includes(mark)) {
      throw new Error(`the Vite build lost ${mark}; the glob patterns ${patterns.join(" , ")} do not work in a build`);
    }
  }
  if (code.includes("import.meta.glob")) {
    throw new Error("import.meta.glob was left unresolved in the build output");
  }
  console.log(
    `OK: Vite ${(await import("vite")).version} resolved ${patterns.join(" and ")} (decl, nested decl, bindings)`,
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
