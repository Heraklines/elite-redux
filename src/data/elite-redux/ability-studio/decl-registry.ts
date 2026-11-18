/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Collects every `decl/**/*.decl.ts` sidecar (spec 2.1). `import.meta.glob` is resolved by Vite at
// build time and by vitest at transform time; scripts/decomp/verify-glob-build.mjs and
// test/tests/elite-redux/decomp/decl-machinery.test.ts prove both. Bindings files
// (`decl/**/bindings.ts`) are imported for their side effect of calling `bindCondition`.

import type { DeclModule } from "./define-decl";

export interface DeclRegistry {
  get(className: string): DeclModule | undefined;
  has(className: string): boolean;
  all(): readonly DeclModule[];
}

/** Builds a registry; two declarations for one class are an error (the registry test relies on it). */
export function createDeclRegistry(modules: Iterable<DeclModule>): DeclRegistry {
  const byName = new Map<string, DeclModule>();
  for (const module of modules) {
    if (byName.has(module.className)) {
      throw new Error(`${module.className} has more than one declaration`);
    }
    byName.set(module.className, module);
  }
  return {
    get: className => byName.get(className),
    has: className => byName.has(className),
    all: () => [...byName.values()],
  };
}

const declFiles = import.meta.glob<{ default: DeclModule }>("./decl/**/*.decl.ts", { eager: true });
import.meta.glob("./decl/**/bindings.ts", { eager: true });

/** The live registry: every declaration committed under `decl/`. */
export const declRegistry: DeclRegistry = createDeclRegistry(
  Object.entries(declFiles).map(([path, file]) => {
    if (file.default === undefined) {
      throw new Error(`${path} must default-export defineDecl(...)`);
    }
    return file.default;
  }),
);
