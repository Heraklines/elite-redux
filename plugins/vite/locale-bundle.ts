import fs from "node:fs";
import path from "node:path";

export type LocaleBundle = Record<string, unknown>;

/** Build a namespace lookup keyed by each JSON file's locale-relative path. */
export function createLocaleBundle(localeDir: string): LocaleBundle {
  const bundle: LocaleBundle = {};

  const visit = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json") || entry.name === "bundle.json") {
        continue;
      }
      const relativePath = path
        .relative(localeDir, fullPath)
        .replaceAll(path.sep, "/")
        .replace(/\.json$/u, "");
      bundle[relativePath] = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    }
  };

  visit(localeDir);
  return bundle;
}
