import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../workers/er-editor-api/src/index";

const env = {
  GITHUB_TOKEN: "test-github-token",
  GITHUB_REPO: "Heraklines/elite-redux",
  GITHUB_BRANCH: "feat/elite-redux-port",
  EDITOR_PASSWORD: "server-only-test-password",
  ALLOWED_ORIGIN: "*",
};

function request(path: string, body: unknown) {
  return new Request(`https://er-editor-api.test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("editor suggestion approval", () => {
  it("accepts only the id and authenticates the fixed approval action server-side", async () => {
    const upstream = vi.fn<typeof fetch>(async input => {
      const forwarded = new Request(input);
      expect(forwarded.url).toBe(
        "https://er-save-api.heraklines.workers.dev/community/editor-suggestions/staff/review",
      );
      expect(await forwarded.json()).toEqual({ id: "review-test", action: "approve", password: env.EDITOR_PASSWORD });
      return new Response(JSON.stringify({ ok: true }));
    });
    const external = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", external);
    const response = await worker.fetch(request("/suggestions/approve", { id: "review-test" }), {
      ...env,
      SUGGESTION_API: { fetch: upstream },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: "review-test", status: "approved" });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(external).not.toHaveBeenCalled();
  });

  it.each([
    { id: "review-test", action: "applied" },
    { id: "review-test", action: "dismiss" },
    { id: "review-test", deploy: true },
    { id: "review-test", password: "anything" },
    { id: "../save" },
    { id: "x".repeat(2049) },
  ])("rejects extra authority or invalid input: %j", async body => {
    const upstream = vi.fn<typeof fetch>();
    const response = await worker.fetch(request("/suggestions/approve", body), {
      ...env,
      SUGGESTION_API: { fetch: upstream },
    });
    expect([400, 413]).toContain(response.status);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("reports a stale suggestion without staging another approval", async () => {
    const response = await worker.fetch(request("/suggestions/approve", { id: "review-test" }), {
      ...env,
      SUGGESTION_API: { fetch: vi.fn<typeof fetch>().mockResolvedValue(new Response("{}", { status: 409 })) },
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Suggestion is no longer in a reviewable state." });
  });

  it.each(["/save", "/deploy"])("leaves %s password-protected", async path => {
    const external = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", external);
    const response = await worker.fetch(request(path, { file: "egg-moves", delta: {} }), env);
    expect(response.status).toBe(401);
    expect(external).not.toHaveBeenCalled();
  });
});
