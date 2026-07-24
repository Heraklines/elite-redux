import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createLocaleBundle } from "../../plugins/vite/locale-bundle";

const englishLocaleDir = fileURLToPath(new URL("../../locales/en", import.meta.url));

describe("locale bundle", () => {
  it("preserves root and nested namespace JSON", () => {
    const bundle = createLocaleBundle(englishLocaleDir);
    const menu = JSON.parse(fs.readFileSync(new URL("../../locales/en/menu.json", import.meta.url), "utf8"));
    const mystery = JSON.parse(
      fs.readFileSync(
        new URL("../../locales/en/mystery-encounters/a-trainers-test-dialogue.json", import.meta.url),
        "utf8",
      ),
    );

    expect(Object.keys(bundle).length).toBeGreaterThan(100);
    expect(bundle.menu).toEqual(menu);
    expect(bundle["mystery-encounters/a-trainers-test-dialogue"]).toEqual(mystery);
  });
});
