import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("ER World Map mobile control", () => {
  it("provides a named R-action touch button and scopes it to the command screen", () => {
    const root = process.cwd();
    const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
    const css = fs.readFileSync(path.join(root, "index.css"), "utf8");
    const inputs = fs.readFileSync(path.join(root, "src/ui-inputs.ts"), "utf8");

    expect(html).toContain('id="apadMap"');
    expect(html).toMatch(/id="apadMap"[^>]+data-key="CYCLE_SHINY"/u);
    expect(html).toMatch(/id="apadMap"[\s\S]*?<span class="apad-label">Map<\/span>/u);
    expect(css).toContain(':not([data-ui-mode="COMMAND"]) #apadMap');
    expect(inputs).toMatch(
      /button === Button\.CYCLE_SHINY && globalScene\.ui\?\.getMode\(\) === UiMode\.COMMAND[\s\S]*?openErMapOverlay\(\)/u,
    );
  });
});
