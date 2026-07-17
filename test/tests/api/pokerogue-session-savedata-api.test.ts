import { PokerogueSessionSavedataApi } from "#api/session-savedata-api";
import { initServerForApiTests } from "#test/setup/test-file-initialization";
import { getApiBaseUrl } from "#test/utils/test-utils";
import type {
  ClearSessionSavedataRequest,
  ClearSessionSavedataResponse,
  CoopCasDeleteSessionSavedataRequest,
  CoopCasSessionSavedataRequest,
  CoopDuplicateExactDeleteSessionSavedataRequest,
  CoopRunStatusRequest,
  DeleteSessionSavedataRequest,
  GetSessionSavedataRequest,
  LegacyCoopExactDeleteSessionSavedataRequest,
  NewClearSessionSavedataRequest,
  OpaqueExactDeleteSessionSavedataRequest,
  UpdateSessionSavedataRequest,
} from "#types/api";
import type { SessionSaveData } from "#types/save-data";
import { HttpResponse, http } from "msw";
import type { SetupServer } from "msw/node";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const apiBase = getApiBaseUrl();
const sessionSavedataApi = new PokerogueSessionSavedataApi(apiBase);

let server: SetupServer;
beforeAll(async () => {
  server = await initServerForApiTests();
});

afterEach(() => {
  server.resetHandlers();
});

describe("Pokerogue Session Savedata API", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn");
  });

  describe("Newclear", () => {
    const params: NewClearSessionSavedataRequest = {
      clientSessionId: "test-session-id",
      isVictory: true,
      slot: 3,
    };

    it("should return true on SUCCESS", async () => {
      server.use(http.get(`${apiBase}/savedata/session/newclear`, () => HttpResponse.json(true)));

      const success = await sessionSavedataApi.newclear(params);

      expect(success).toBe(true);
    });

    it("should return false on FAILURE", async () => {
      server.use(http.get(`${apiBase}/savedata/session/newclear`, () => HttpResponse.json(false)));

      const success = await sessionSavedataApi.newclear(params);

      expect(success).toBe(false);
    });

    it("should return false and report a warning on ERROR", async () => {
      server.use(http.get(`${apiBase}/savedata/session/newclear`, () => HttpResponse.error()));

      await expect(sessionSavedataApi.newclear(params)).rejects.toThrow("Could not newclear session!");
      expect(console.warn).toHaveBeenCalledWith("Could not newclear session!", expect.any(Error));
    });
  });

  describe("Get ", () => {
    const params: GetSessionSavedataRequest = {
      clientSessionId: "test-session-id",
      slot: 3,
    };

    it("should return session-savedata string on SUCCESS", async () => {
      server.use(http.get(`${apiBase}/savedata/session/get`, () => HttpResponse.text("TEST SESSION SAVEDATA")));

      const savedata = await sessionSavedataApi.get(params);

      expect(savedata).toBe("TEST SESSION SAVEDATA");
    });

    it("should return null and report a warning on ERROR", async () => {
      server.use(http.get(`${apiBase}/savedata/session/get`, () => HttpResponse.error()));

      const savedata = await sessionSavedataApi.get(params);

      expect(savedata).toBeNull();
      expect(console.warn).toHaveBeenCalledWith("Could not get session savedata!", expect.any(Error));
    });
  });

  describe("Update", () => {
    const params: UpdateSessionSavedataRequest = {
      clientSessionId: "test-session-id",
      slot: 3,
      secretId: 9876543321,
      trainerId: 123456789,
    };

    it("should return an empty string on SUCCESS", async () => {
      server.use(http.post(`${apiBase}/savedata/session/update`, () => HttpResponse.text(null)));

      const error = await sessionSavedataApi.update(params, "UPDATED SESSION SAVEDATA");

      expect(error).toBe("");
    });

    it("should return an error string on FAILURE", async () => {
      server.use(http.post(`${apiBase}/savedata/session/update`, () => HttpResponse.text("Failed to update!")));

      const error = await sessionSavedataApi.update(params, "UPDATED SESSION SAVEDATA");

      expect(error).toBe("Failed to update!");
    });

    it("should return 'Unknown Error!' and report a warning on ERROR", async () => {
      server.use(http.post(`${apiBase}/savedata/session/update`, () => HttpResponse.error()));

      const error = await sessionSavedataApi.update(params, "UPDATED SESSION SAVEDATA");

      expect(error).toBe("Unknown Error!");
      expect(console.warn).toHaveBeenCalledWith("Could not update session savedata!", expect.any(Error));
    });
  });

  describe("Delete", () => {
    const params: DeleteSessionSavedataRequest = {
      clientSessionId: "test-session-id",
      slot: 3,
    };

    it("should return null on SUCCESS", async () => {
      server.use(http.get(`${apiBase}/savedata/session/delete`, () => HttpResponse.text(null)));

      const error = await sessionSavedataApi.delete(params);

      expect(error).toBeNull();
    });

    it("should return an error string on FAILURE", async () => {
      server.use(
        http.get(`${apiBase}/savedata/session/delete`, () => new HttpResponse("Failed to delete!", { status: 400 })),
      );

      const error = await sessionSavedataApi.delete(params);

      expect(error).toBe("Failed to delete!");
    });

    it("should return 'Unknown error' and report a warning on ERROR", async () => {
      server.use(http.get(`${apiBase}/savedata/session/delete`, () => HttpResponse.error()));

      const error = await sessionSavedataApi.delete(params);

      expect(error).toBe("Unknown error");
      expect(console.warn).toHaveBeenCalledWith("Could not delete session savedata!", expect.any(Error));
    });
  });

  describe("Co-op CAS update", () => {
    const params: CoopCasSessionSavedataRequest = {
      clientSessionId: "test-session-id",
      slot: 3,
      secretId: 9876543321,
      trainerId: 123456789,
      coopCasMode: "existing",
      coopCasRunId: "run-protected-123456789",
      coopCasCheckpointRevision: 7,
      coopCasDigest: "a".repeat(64),
    };

    it("preserves successful HTTP status", async () => {
      server.use(http.post(`${apiBase}/savedata/session/coop-cas-update`, () => HttpResponse.text(null)));

      await expect(sessionSavedataApi.updateCoopCas(params, "{}")).resolves.toEqual({
        ok: true,
        status: 200,
        error: "",
        failureKind: null,
      });
    });

    it.each([
      [409, "Session CAS conflict", "conflict"],
      [413, "Save data too large.", "too-large"],
      [404, "Not found.", "unsupported"],
      [401, "Unauthorized.", "unauthorized"],
    ] as const)("classifies HTTP %i without relying on message regexes", async (status, message, failureKind) => {
      server.use(http.post(`${apiBase}/savedata/session/coop-cas-update`, () => new HttpResponse(message, { status })));

      await expect(sessionSavedataApi.updateCoopCas(params, "{}")).resolves.toEqual({
        ok: false,
        status,
        error: message,
        failureKind,
      });
    });

    it("never turns an empty non-2xx response into success", async () => {
      server.use(
        http.post(`${apiBase}/savedata/session/coop-cas-update`, () => new HttpResponse(null, { status: 503 })),
      );

      await expect(sessionSavedataApi.updateCoopCas(params, "{}")).resolves.toEqual({
        ok: false,
        status: 503,
        error: "Co-op session mutation failed with HTTP 503.",
        failureKind: "transient",
      });
    });
  });

  describe("Typed co-op CAS read", () => {
    const params: GetSessionSavedataRequest = { clientSessionId: "test-session-id", slot: 3 };

    it("returns successful bytes without discarding the HTTP status", async () => {
      server.use(http.get(`${apiBase}/savedata/session/get`, () => HttpResponse.text('{"waveIndex":10}')));
      await expect(sessionSavedataApi.getCoopCas(params)).resolves.toEqual({
        ok: true,
        status: 200,
        rawSavedata: '{"waveIndex":10}',
      });
    });

    it("classifies a missing row without exposing its error body as savedata", async () => {
      server.use(
        http.get(`${apiBase}/savedata/session/get`, () => new HttpResponse("Session not found.", { status: 404 })),
      );
      await expect(sessionSavedataApi.getCoopCas(params)).resolves.toEqual({
        ok: false,
        status: 404,
        error: "Session not found.",
        failureKind: "missing",
      });
    });

    it("preserves a non-missing backend failure as a typed status", async () => {
      server.use(http.get(`${apiBase}/savedata/session/get`, () => new HttpResponse(null, { status: 503 })));
      await expect(sessionSavedataApi.getCoopCas(params)).resolves.toEqual({
        ok: false,
        status: 503,
        error: "Co-op session read failed with HTTP 503.",
        failureKind: "transient",
      });
    });
  });

  describe("Co-op CAS delete", () => {
    const params: CoopCasDeleteSessionSavedataRequest = {
      clientSessionId: "test-session-id",
      slot: 3,
      coopCasRunId: "run-protected-123456789",
      coopCasCheckpointRevision: 7,
      coopCasDigest: "a".repeat(64),
    };

    it("uses the dedicated fail-closed endpoint and returns null on success", async () => {
      let requestedUrl = "";
      server.use(
        http.post(`${apiBase}/savedata/session/coop-cas-delete`, ({ request }) => {
          requestedUrl = request.url;
          return HttpResponse.text(null);
        }),
      );

      await expect(sessionSavedataApi.deleteCoopCas(params)).resolves.toEqual({
        ok: true,
        status: 200,
        error: "",
        failureKind: null,
      });
      expect(requestedUrl).toContain("coopCasRunId=run-protected-123456789");
      expect(requestedUrl).toContain("coopCasCheckpointRevision=7");
    });

    it("returns the worker conflict without falling back to legacy delete", async () => {
      server.use(
        http.post(
          `${apiBase}/savedata/session/coop-cas-delete`,
          () => new HttpResponse("Session CAS conflict", { status: 409 }),
        ),
      );

      await expect(sessionSavedataApi.deleteCoopCas(params)).resolves.toEqual({
        ok: false,
        status: 409,
        error: "Session CAS conflict",
        failureKind: "conflict",
      });
    });
  });

  describe("Co-op duplicate exact delete", () => {
    const params: CoopDuplicateExactDeleteSessionSavedataRequest = {
      clientSessionId: "test-session-id",
      slot: 1,
      coopCasRunId: "run-duplicate-123456789",
      coopCasCheckpointRevision: 4,
      coopCasDigest: "a".repeat(64),
      survivorSlot: 3,
      survivorCheckpointRevision: 5,
      survivorDigest: "b".repeat(64),
    };

    it("sends both exact row commitments to the dedicated recovery endpoint", async () => {
      let requestedUrl = "";
      server.use(
        http.post(`${apiBase}/savedata/session/coop-duplicate-exact-delete`, ({ request }) => {
          requestedUrl = request.url;
          return HttpResponse.text(null);
        }),
      );
      await expect(sessionSavedataApi.deleteCoopDuplicateExact(params)).resolves.toMatchObject({ ok: true });
      expect(requestedUrl).toContain("slot=1");
      expect(requestedUrl).toContain("survivorSlot=3");
      expect(requestedUrl).toContain("survivorCheckpointRevision=5");
      expect(requestedUrl).toContain(`survivorDigest=${"b".repeat(64)}`);
    });
  });

  describe("Co-op run status", () => {
    const params: CoopRunStatusRequest = {
      clientSessionId: "test-session-id",
      coopRunId: "run-protected-123456789",
      slot: 3,
    };

    it.each(["active", "tombstoned"] as const)("validates exact %s proof metadata", async state => {
      server.use(
        http.get(`${apiBase}/savedata/session/coop-run-status`, () =>
          HttpResponse.json({
            state,
            runId: params.coopRunId,
            slot: 3,
            checkpointRevision: 7,
            digest: "a".repeat(64),
          }),
        ),
      );

      await expect(sessionSavedataApi.getCoopRunStatus(params)).resolves.toMatchObject({
        ok: true,
        value: { state, runId: params.coopRunId, slot: 3 },
      });
    });

    it("accepts an account-wide missing proof", async () => {
      server.use(
        http.get(`${apiBase}/savedata/session/coop-run-status`, () =>
          HttpResponse.json({ state: "missing", runId: params.coopRunId }),
        ),
      );

      await expect(sessionSavedataApi.getCoopRunStatus(params)).resolves.toEqual({
        ok: true,
        status: 200,
        value: { state: "missing", runId: params.coopRunId },
      });
    });

    it("rejects a missing proof carrying contradictory active/tombstone metadata", async () => {
      server.use(
        http.get(`${apiBase}/savedata/session/coop-run-status`, () =>
          HttpResponse.json({
            state: "missing",
            runId: params.coopRunId,
            slot: 3,
            checkpointRevision: 7,
            digest: "a".repeat(64),
          }),
        ),
      );

      await expect(sessionSavedataApi.getCoopRunStatus(params)).resolves.toMatchObject({
        ok: false,
        status: 200,
        failureKind: "invalid",
      });
    });

    it("rejects status metadata for another run or an invalid commitment", async () => {
      server.use(
        http.get(`${apiBase}/savedata/session/coop-run-status`, () =>
          HttpResponse.json({
            state: "tombstoned",
            runId: "run-other-123456789",
            slot: 9,
            checkpointRevision: -1,
            digest: "bad",
          }),
        ),
      );

      await expect(sessionSavedataApi.getCoopRunStatus(params)).resolves.toMatchObject({
        ok: false,
        failureKind: "invalid",
      });
    });
  });

  describe("Opaque exact delete", () => {
    const params: OpaqueExactDeleteSessionSavedataRequest = {
      clientSessionId: "test-session-id",
      slot: 3,
      exactDigest: "b".repeat(64),
    };

    it("uses only the dedicated recovery endpoint", async () => {
      let requestedUrl = "";
      server.use(
        http.post(`${apiBase}/savedata/session/opaque-exact-delete`, ({ request }) => {
          requestedUrl = request.url;
          return HttpResponse.text(null);
        }),
      );

      await expect(sessionSavedataApi.deleteOpaqueExact(params)).resolves.toMatchObject({ ok: true });
      expect(requestedUrl).toContain(`exactDigest=${"b".repeat(64)}`);
    });
  });

  describe("Legacy co-op exact delete", () => {
    const params: LegacyCoopExactDeleteSessionSavedataRequest = {
      clientSessionId: "test-session-id",
      slot: 4,
      exactDigest: "c".repeat(64),
    };

    it("uses the dedicated pre-run-id recovery endpoint", async () => {
      let requestedUrl = "";
      server.use(
        http.post(`${apiBase}/savedata/session/legacy-coop-exact-delete`, ({ request }) => {
          requestedUrl = request.url;
          return HttpResponse.text(null);
        }),
      );

      await expect(sessionSavedataApi.deleteLegacyCoopExact(params)).resolves.toMatchObject({ ok: true });
      expect(requestedUrl).toContain(`exactDigest=${"c".repeat(64)}`);
    });
  });

  describe("Clear", () => {
    const params: ClearSessionSavedataRequest = {
      clientSessionId: "test-session-id",
      slot: 3,
      trainerId: 123456789,
    };

    it("should return sucess=true on SUCCESS", async () => {
      server.use(
        http.post(`${apiBase}/savedata/session/clear`, () =>
          HttpResponse.json<ClearSessionSavedataResponse>({
            success: true,
          }),
        ),
      );

      const { success, error } = await sessionSavedataApi.clear(params, {} as SessionSaveData);

      expect(success).toBe(true);
      expect(error).toBeUndefined();
    });

    it("should return sucess=false & an error string on FAILURE", async () => {
      server.use(
        http.post(`${apiBase}/savedata/session/clear`, () =>
          HttpResponse.json<ClearSessionSavedataResponse>({
            success: false,
            error: "Failed to clear!",
          }),
        ),
      );

      const { success, error } = await sessionSavedataApi.clear(params, {} as SessionSaveData);

      expect(error).toBe("Failed to clear!");
      expect(success).toBe(false);
    });

    it("should return success=false & error='Unknown error' and report a warning on ERROR", async () => {
      server.use(http.post(`${apiBase}/savedata/session/clear`, () => HttpResponse.error()));

      const { success, error } = await sessionSavedataApi.clear(params, {} as SessionSaveData);

      expect(error).toBe("Unknown error");
      expect(success).toBe(false);
    });
  });
});
