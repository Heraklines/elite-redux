import { getDirectorRuntime, resetDirectorRuntimeForTests } from "#system/llm-director/director-runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("DirectorRuntime", () => {
  const originalKey = import.meta.env.VITE_NANOGPT_API_KEY ?? "";
  const originalUrl = import.meta.env.VITE_NANOGPT_BASE_URL ?? "";

  beforeEach(() => {
    resetDirectorRuntimeForTests();
  });

  afterEach(() => {
    import.meta.env.VITE_NANOGPT_API_KEY = originalKey;
    import.meta.env.VITE_NANOGPT_BASE_URL = originalUrl;
    resetDirectorRuntimeForTests();
  });

  it("returns null when API key is missing", () => {
    import.meta.env.VITE_NANOGPT_API_KEY = "";
    import.meta.env.VITE_NANOGPT_BASE_URL = "https://example/api/v1";
    expect(getDirectorRuntime()).toBeNull();
  });

  it("returns a singleton client+queue when env vars are set", () => {
    import.meta.env.VITE_NANOGPT_API_KEY = "test-key";
    import.meta.env.VITE_NANOGPT_BASE_URL = "https://example/api/v1";
    const a = getDirectorRuntime();
    const b = getDirectorRuntime();
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a?.client).toBeDefined();
    expect(a?.queue).toBeDefined();
  });

  it("does not log the api key when warning about missing config", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    import.meta.env.VITE_NANOGPT_API_KEY = "secret-do-not-leak";
    import.meta.env.VITE_NANOGPT_BASE_URL = "";
    expect(getDirectorRuntime()).toBeNull();
    for (const call of warn.mock.calls) {
      const joined = call.map(String).join(" ");
      expect(joined).not.toContain("secret-do-not-leak");
    }
    warn.mockRestore();
  });
});
