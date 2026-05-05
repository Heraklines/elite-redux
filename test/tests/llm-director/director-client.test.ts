import { DirectorClient } from "#system/llm-director/director-client";
import { beforeEach, describe, expect, it, vi } from "vitest";

describe("DirectorClient", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("calls the OpenAI-compatible chat completions endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const client = new DirectorClient({ apiKey: "test", baseUrl: "https://x/api/v1" });
    const r = await client.complete({ model: "TEE/kimi-k2.6", messages: [{ role: "user", content: "hi" }] });
    expect(r.content).toBe('{"ok":true}');
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
    expect(r.inputTokens).toBe(100);
    expect(r.outputTokens).toBe(50);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://x/api/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer test" }),
      }),
    );
  });

  it("times out after timeoutMs", async () => {
    const fetchMock = vi.fn().mockImplementation((_url, init: RequestInit | undefined) => {
      return new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        if (signal) {
          signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new DirectorClient({ apiKey: "test", baseUrl: "https://x/api/v1" });
    await expect(client.complete({ model: "x", messages: [], timeoutMs: 50 })).rejects.toThrow(/timeout/i);
  });

  it("retries on 5xx up to maxRetries times", async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls++;
      if (calls < 3) {
        return Promise.resolve(new Response("err", { status: 503 }));
      }
      return Promise.resolve(
        new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }], usage: {} }), { status: 200 }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new DirectorClient({
      apiKey: "test",
      baseUrl: "https://x/api/v1",
      maxRetries: 3,
      retryDelayMs: 1,
    });
    const r = await client.complete({ model: "x", messages: [] });
    expect(r.content).toBe("ok");
    expect(calls).toBe(3);
  });

  it("throws after maxRetries 5xx attempts", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("err", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new DirectorClient({
      apiKey: "test",
      baseUrl: "https://x/api/v1",
      maxRetries: 2,
      retryDelayMs: 1,
    });
    await expect(client.complete({ model: "x", messages: [] })).rejects.toThrow(/503|server/i);
  });

  it("does not retry on 4xx (auth/bad request)", async () => {
    let calls = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      calls++;
      return Promise.resolve(new Response("unauthorized", { status: 401 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = new DirectorClient({
      apiKey: "test",
      baseUrl: "https://x/api/v1",
      maxRetries: 3,
      retryDelayMs: 1,
    });
    await expect(client.complete({ model: "x", messages: [] })).rejects.toThrow(/401/);
    expect(calls).toBe(1);
  });
});
