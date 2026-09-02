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

function database(changes = 1) {
  const run = vi.fn(async () => ({ meta: { changes } }));
  const bind = vi.fn((..._values: (string | number)[]) => ({ run }));
  const prepare = vi.fn((_query: string) => ({ bind }));
  return { prepare, bind, run };
}

describe("editor suggestion approval", () => {
  it("only approves the matching open suggestion without calling the save API or GitHub", async () => {
    const db = database();
    const external = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", external);
    const response = await worker.fetch(request("/suggestions/approve", { id: "review-test" }), {
      ...env,
      SUGGESTIONS_DB: db,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, id: "review-test", status: "approved" });
    expect(db.prepare).toHaveBeenCalledExactlyOnceWith(
      "UPDATE community_editor_suggestions SET status = 'approved', reviewer_note = '', reviewed_at = ?1, updated_at = ?1 WHERE id = ?2 AND status = 'open'",
    );
    expect(db.bind).toHaveBeenCalledExactlyOnceWith(expect.any(Number), "review-test");
    expect(db.run).toHaveBeenCalledTimes(1);
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
    const db = database();
    const response = await worker.fetch(request("/suggestions/approve", body), {
      ...env,
      SUGGESTIONS_DB: db,
    });
    expect([400, 413]).toContain(response.status);
    expect(db.prepare).not.toHaveBeenCalled();
  });

  it("reports a stale suggestion without staging another approval", async () => {
    const response = await worker.fetch(request("/suggestions/approve", { id: "review-test" }), {
      ...env,
      SUGGESTIONS_DB: database(0),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Suggestion is no longer in a reviewable state." });
  });

  it("fails closed without a database binding", async () => {
    const response = await worker.fetch(request("/suggestions/approve", { id: "review-test" }), env);
    expect(response.status).toBe(503);
  });

  it("reports database failures without exposing internal details", async () => {
    const db = database();
    db.run.mockRejectedValueOnce(new Error("private database detail"));
    const response = await worker.fetch(request("/suggestions/approve", { id: "review-test" }), {
      ...env,
      SUGGESTIONS_DB: db,
    });
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private database detail");
  });

  it.each(["/save", "/deploy"])("leaves %s password-protected", async path => {
    const external = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", external);
    const response = await worker.fetch(request(path, { file: "egg-moves", delta: {} }), env);
    expect(response.status).toBe(401);
    expect(external).not.toHaveBeenCalled();
  });
});
