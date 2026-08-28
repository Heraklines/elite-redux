import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it } from "vitest";

interface AbilityStudioHarness {
  init(options: Record<string, unknown>): void;
  renderContent(root: Element): void;
  handleInput(element: HTMLInputElement): boolean;
  handleClick(event: { target: Element }): boolean;
  buildDelta(): { delta: Record<string, unknown>; errors: string[] };
  getAbilityCatalog(): Array<{ id: number; name: string }>;
  refreshSavedBlueprints(force?: boolean): Promise<boolean>;
}

const primitiveCatalog = JSON.parse(
  readFileSync(resolve(process.cwd(), "editor/data/ability-primitives.json"), "utf8"),
);
const studioSource = readFileSync(resolve(process.cwd(), "editor/ability-studio.js"), "utf8");

function blueprint(id: number, name: string): Record<string, unknown> {
  return {
    version: 1,
    id,
    name,
    description: `${name} description.`,
    generation: 9,
    includes: [],
    mechanics: [],
    componentRules: [],
    rules: [
      {
        key: "entry-boost",
        trigger: "on-entry",
        chance: 100,
        conditions: [],
        effects: [{ kind: "stat-stage", target: "holder", stat: "ATK", stages: 1 }],
      },
    ],
    modifiers: [],
    flags: {},
  };
}

let window: JSDOM["window"];
let studio: AbilityStudioHarness;

beforeEach(() => {
  const dom = new JSDOM("<!doctype html><html><body><div id='root'></div></body></html>", {
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  window = dom.window;
  window.eval(studioSource);
  studio = window.erAbilityStudio as AbilityStudioHarness;
});

describe("Ability Studio saved packages", () => {
  it("refreshes and includes a branch-saved ability without a Pages deployment", async () => {
    const local = blueprint(20001, "Local Draft");
    const saved = blueprint(20002, "Saved Package");
    studio.init({
      catalog: primitiveCatalog,
      abilities: [],
      moves: [],
      mechanics: [],
      components: [],
      blueprints: { "local-draft": local },
      loadSavedBlueprints: async () => ({ "local-draft": local, "saved-package": saved }),
      callbacks: {},
    });

    expect(studio.getAbilityCatalog().some(ability => ability.id === 20002)).toBe(false);
    expect(await studio.refreshSavedBlueprints(true)).toBe(true);
    expect(studio.getAbilityCatalog()).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 20002, name: "Saved Package" })]),
    );

    const root = window.document.querySelector("#root");
    if (!root) {
      throw new Error("missing editor root");
    }
    studio.renderContent(root);
    const input = root.querySelector<HTMLInputElement>("[data-as-include-search]");
    if (!input) {
      throw new Error("missing package search");
    }
    input.value = "Saved Package";
    studio.handleInput(input);
    const option = root.querySelector<HTMLElement>("[data-as-action='choose-include'][data-as-id='20002']");
    if (!option) {
      throw new Error("missing saved package option");
    }
    studio.handleClick({ target: option });

    const result = studio.buildDelta();
    expect(result.errors).toEqual([]);
    expect(result.delta["local-draft"]).toEqual(expect.objectContaining({ includes: [20002] }));
  });
});
