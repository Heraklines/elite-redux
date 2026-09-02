import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "editor/app.js"), "utf8");
const html = readFileSync(resolve(process.cwd(), "editor/index.html"), "utf8");
const paletteCss = [...html.matchAll(/\.pal-move(?:\[hidden\])?\s*\{[^}]*\}/g)].map(match => match[0]).join("\n");
const filter = source.slice(source.indexOf("function filterPalette()"), source.indexOf("function evoChipHtml("));
const input = source.slice(source.indexOf("function onPokedexInput("), source.indexOf("function onInput("));

describe.each(["learnsets", "tms"])("%s move palette", tab => {
  it("visibly filters names as text is entered and restores moves when cleared", () => {
    const dom = new JSDOM(
      `<style>${paletteCss}</style><input id="pal-search"><div id="pal"><button class="pal-move" data-hay="ice beam ice special">Ice Beam</button><button class="pal-move" data-hay="absorb grass special">Absorb</button></div>`,
      {
        runScripts: "outside-only",
      },
    );
    try {
      const { window } = dom;
      window.eval(
        `let palQuery = ""; const activeTab = ${JSON.stringify(tab)}; ${filter}\n${input}\ndocument.getElementById("pal-search").addEventListener("input", event => onPokedexInput(event.target));`,
      );
      const search = window.document.querySelector<HTMLInputElement>("#pal-search");
      const buttons = window.document.querySelectorAll<HTMLButtonElement>(".pal-move");
      if (!search) {
        throw new Error("missing palette search");
      }
      search.focus();
      search.value = "ICE be";
      search.dispatchEvent(new window.Event("input", { bubbles: true }));
      expect(window.getComputedStyle(buttons[0]).display).toBe("flex");
      expect(window.getComputedStyle(buttons[1]).display).toBe("none");
      expect(window.document.activeElement).toBe(search);
      search.value = "not-a-move";
      search.dispatchEvent(new window.Event("input", { bubbles: true }));
      expect([...buttons].every(button => window.getComputedStyle(button).display === "none")).toBe(true);
      search.value = "";
      search.dispatchEvent(new window.Event("input", { bubbles: true }));
      expect([...buttons].every(button => window.getComputedStyle(button).display === "flex")).toBe(true);
    } finally {
      dom.window.close();
    }
  });
});
