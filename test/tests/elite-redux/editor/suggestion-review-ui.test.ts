import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { afterEach, describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(process.cwd(), "editor/suggestions.js"), "utf8");
const windows: JSDOM["window"][] = [];

async function setupReview(response: () => Promise<Response>) {
  const dom = new JSDOM('<input id="password"><main id="root"></main>', {
    url: "https://er-editor.pages.dev/",
    runScripts: "outside-only",
  });
  const window = dom.window;
  windows.push(window);
  const root = window.document.getElementById("root");
  const applyChanges = vi.fn();
  const fetch = vi.fn(async (url: string) =>
    url.endsWith("/staff/list")
      ? new Response(
          JSON.stringify({
            items: [
              {
                id: "review-test",
                entityLabel: "Abra",
                author: "Tester",
                status: "open",
                changes: { "egg-moves": { SPECIES_ABRA: ["ICE_BEAM"] } },
                baseline: { "egg-moves": { SPECIES_ABRA: ["TACKLE"] } },
              },
            ],
          }),
        )
      : response(),
  );
  window.fetch = fetch;
  window.AbortSignal.timeout = AbortSignal.timeout;
  window.erAppBridge = { activeTab: () => "suggestions", applyChanges, catalogs: () => ({}) };
  window.eval(source);
  window.communitySuggestions.render(root);
  await vi.waitFor(() => expect(root?.querySelector('[data-sug-action="approve"]')).not.toBeNull());
  return { window, root, fetch, applyChanges };
}

afterEach(() => {
  windows.splice(0).forEach(window => window.close());
});

describe("suggestion review controls", () => {
  it("shows a password error even while the queue contains suggestions", async () => {
    const { root, fetch, applyChanges } = await setupReview(async () => new Response("{}"));
    root?.querySelector<HTMLButtonElement>('[data-sug-action="approve"]')?.click();
    await vi.waitFor(() =>
      expect(root?.querySelector('[role="alert"]')?.textContent).toContain("Enter the editor password"),
    );
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/staff/review"))).toHaveLength(0);
    expect(applyChanges).not.toHaveBeenCalled();
  });

  it("surfaces server errors and re-enables retry without staging anything", async () => {
    const { window, root, applyChanges } = await setupReview(
      async () => new Response(JSON.stringify({ error: "Invalid editor password." }), { status: 401 }),
    );
    const password = window.document.querySelector<HTMLInputElement>("#password");
    if (password) {
      password.value = "test-password";
    }
    root?.querySelector<HTMLButtonElement>('[data-sug-action="approve"]')?.click();
    await vi.waitFor(() =>
      expect(root?.querySelector('[role="alert"]')?.textContent).toContain("Invalid editor password."),
    );
    expect(root?.querySelector<HTMLButtonElement>('[data-sug-action="approve"]')?.disabled).toBe(false);
    expect(applyChanges).not.toHaveBeenCalled();
  });

  it("stages a successful review once and blocks double submissions", async () => {
    let finish: (response: Response) => void = () => {};
    const { window, root, fetch, applyChanges } = await setupReview(
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const password = window.document.querySelector<HTMLInputElement>("#password");
    if (password) {
      password.value = "test-password";
    }
    const button = root?.querySelector<HTMLButtonElement>('[data-sug-action="approve"]');
    button?.click();
    button?.click();
    expect(button?.disabled).toBe(true);
    finish(new Response(JSON.stringify({ ok: true })));
    await vi.waitFor(() => expect(applyChanges).toHaveBeenCalledTimes(1));
    expect(fetch.mock.calls.filter(([url]) => url.endsWith("/staff/review"))).toHaveLength(1);
    expect(applyChanges).toHaveBeenCalledWith({ "egg-moves": { SPECIES_ABRA: ["ICE_BEAM"] } });
    expect(root?.querySelector('[data-sug-action="approve"]')).toBeNull();
  });
});
