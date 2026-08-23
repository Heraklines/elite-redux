import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Elite Redux title version", () => {
  it("shows release 0.0.6.0 as the player-facing v0.0.6", () => {
    const source = readFileSync("src/ui/handlers/title-ui-handler.ts", "utf8");

    expect(source).toContain('const displayVersion = ER_VERSION.replace(/\\.0$/, "")');
    expect(source).toContain('this.appVersionText.setText("v" + displayVersion + betaText)');
  });
});
