import { ApiBase } from "#api/api-base";
import type {
  ClearSessionSavedataRequest,
  ClearSessionSavedataResponse,
  CoopCasDeleteSessionSavedataRequest,
  CoopCasFailureKind,
  CoopCasMutationResult,
  CoopCasSessionGetResult,
  CoopCasSessionSavedataRequest,
  CoopDuplicateExactDeleteSessionSavedataRequest,
  CoopRunStatus,
  CoopRunStatusRequest,
  CoopRunStatusResult,
  DeleteSessionSavedataRequest,
  GetSessionSavedataRequest,
  LegacyCoopExactDeleteSessionSavedataRequest,
  NewClearSessionSavedataRequest,
  OpaqueExactDeleteSessionSavedataRequest,
  UpdateSessionSavedataRequest,
} from "#types/api";
import type { SessionSaveData } from "#types/save-data";

function classifyCoopCasFailure(status: number): CoopCasFailureKind {
  if (status === 409) {
    return "conflict";
  }
  if (status === 401 || status === 403) {
    return "unauthorized";
  }
  if (status === 404 || status === 405 || status === 501) {
    return "unsupported";
  }
  if (status === 413) {
    return "too-large";
  }
  if (status >= 400 && status < 500 && status !== 408 && status !== 425 && status !== 429) {
    return "invalid";
  }
  return "transient";
}

async function coopCasResult(response: Response): Promise<CoopCasMutationResult> {
  if (response.ok) {
    return { ok: true, status: response.status, error: "", failureKind: null };
  }
  let body = "";
  try {
    body = await response.text();
  } catch {
    return {
      ok: false,
      status: response.status,
      error: `Co-op session mutation response body failed with HTTP ${response.status}.`,
      failureKind: "transient",
    };
  }
  return {
    ok: false,
    status: response.status,
    error: body || `Co-op session mutation failed with HTTP ${response.status}.`,
    failureKind: classifyCoopCasFailure(response.status),
  };
}

function coopCasTransportFailure(): CoopCasMutationResult {
  return { ok: false, status: null, error: "Unknown Error!", failureKind: "transient" };
}

function isCoopRunStatus(value: unknown, expectedRunId: string): value is CoopRunStatus {
  if (value == null || typeof value !== "object") {
    return false;
  }
  const status = value as {
    state?: unknown;
    runId?: unknown;
    slot?: unknown;
    checkpointRevision?: unknown;
    digest?: unknown;
  };
  if (
    typeof status.runId !== "string"
    || status.runId !== expectedRunId
    || !/^[A-Za-z0-9_-]{16,128}$/u.test(status.runId)
  ) {
    return false;
  }
  if (status.state === "missing") {
    return (
      !Object.hasOwn(status, "slot") && !Object.hasOwn(status, "checkpointRevision") && !Object.hasOwn(status, "digest")
    );
  }
  return (
    (status.state === "active" || status.state === "tombstoned")
    && typeof status.slot === "number"
    && Number.isInteger(status.slot)
    && status.slot >= 0
    && status.slot <= 4
    && typeof status.checkpointRevision === "number"
    && Number.isSafeInteger(status.checkpointRevision)
    && status.checkpointRevision >= 0
    && typeof status.digest === "string"
    && /^[0-9a-f]{64}$/u.test(status.digest)
  );
}

/** A wrapper for PokéRogue session savedata API requests. */
export class PokerogueSessionSavedataApi extends ApiBase {
  /**
   * Mark a session as cleared aka "newclear". \
   * _This is **NOT** the same as {@linkcode clear | clear()}._
   * @param params The {@linkcode NewClearSessionSavedataRequest} to send
   * @returns The raw savedata as `string`.
   * @throws Error if the request fails
   */
  public async newclear(params: NewClearSessionSavedataRequest): Promise<boolean> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);
      const response = await this.doGet(`/savedata/session/newclear?${urlSearchParams}`);
      const json = await response.json();
      if (response.ok) {
        return Boolean(json);
      }
      throw new Error("Could not newclear session!");
    } catch (err) {
      console.warn("Could not newclear session!", err);
      throw new Error("Could not newclear session!");
    }
  }

  /**
   * Get a session savedata.
   * @param params The {@linkcode GetSessionSavedataRequest} to send
   * @returns The session as `string`
   */
  public async get(params: GetSessionSavedataRequest): Promise<string | null> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);
      const response = await this.doGet(`/savedata/session/get?${urlSearchParams}`);

      return await response.text();
    } catch (err) {
      console.warn("Could not get session savedata!", err);
      return null;
    }
  }

  /**
   * Status-preserving session read for co-op CAS reconciliation. Unlike the legacy `get`, an HTTP
   * error body can never be mistaken for savedata and a missing row is a machine-readable state.
   */
  public async getCoopCas(params: GetSessionSavedataRequest): Promise<CoopCasSessionGetResult> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);
      const response = await this.doGet(`/savedata/session/get?${urlSearchParams}`);
      if (!response.ok) {
        let body = "";
        try {
          body = await response.text();
        } catch {
          return {
            ok: false,
            status: response.status,
            error: `Co-op session read response body failed with HTTP ${response.status}.`,
            failureKind: "transient",
          };
        }
        return {
          ok: false,
          status: response.status,
          error: body || `Co-op session read failed with HTTP ${response.status}.`,
          failureKind: response.status === 404 ? "missing" : classifyCoopCasFailure(response.status),
        };
      }
      try {
        return { ok: true, status: response.status, rawSavedata: await response.text() };
      } catch {
        return {
          ok: false,
          status: response.status,
          error: `Co-op session read response body failed with HTTP ${response.status}.`,
          failureKind: "transient",
        };
      }
    } catch (err) {
      console.warn("Could not read co-op session savedata!", err);
      return { ok: false, status: null, error: "Unknown Error!", failureKind: "transient" };
    }
  }

  /**
   * Update a session savedata.
   * @param params - The request to send
   * @param rawSavedata - The raw, unencrypted savedata
   * @returns An error message if something went wrong
   */
  public async update(params: UpdateSessionSavedataRequest, rawSavedata: string): Promise<string> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);

      const response = await this.doPost(`/savedata/session/update?${urlSearchParams}`, rawSavedata);
      return await response.text();
    } catch (err) {
      console.warn("Could not update session savedata!", err);
    }

    return "Unknown Error!";
  }

  /**
   * Conditional co-op session write on a dedicated endpoint. An older Worker returns 404 for this
   * path instead of ignoring unknown query parameters and performing an unsafe unconditional upsert.
   */
  public async updateCoopCas(
    params: CoopCasSessionSavedataRequest,
    rawSavedata: string,
  ): Promise<CoopCasMutationResult> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);
      const response = await this.doPost(`/savedata/session/coop-cas-update?${urlSearchParams}`, rawSavedata);
      return await coopCasResult(response);
    } catch (err) {
      console.warn("Could not conditionally update co-op session savedata!", err);
      return coopCasTransportFailure();
    }
  }

  /** Delete exactly one co-op checkpoint and permanently tombstone its run identity. */
  public async deleteCoopCas(params: CoopCasDeleteSessionSavedataRequest): Promise<CoopCasMutationResult> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);
      const response = await this.doPost(`/savedata/session/coop-cas-delete?${urlSearchParams}`, "");
      return await coopCasResult(response);
    } catch (err) {
      console.warn("Could not conditionally delete co-op session savedata!", err);
      return coopCasTransportFailure();
    }
  }

  /** Remove one exact duplicate only while the exact same-run survivor is still live. */
  public async deleteCoopDuplicateExact(
    params: CoopDuplicateExactDeleteSessionSavedataRequest,
  ): Promise<CoopCasMutationResult> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);
      const response = await this.doPost(`/savedata/session/coop-duplicate-exact-delete?${urlSearchParams}`, "");
      return await coopCasResult(response);
    } catch (err) {
      console.warn("Could not converge duplicate co-op session savedata!", err);
      return coopCasTransportFailure();
    }
  }

  /** Read account-scoped authoritative proof that one co-op run is live, deleted, or absent. */
  public async getCoopRunStatus(params: CoopRunStatusRequest): Promise<CoopRunStatusResult> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);
      const response = await this.doGet(`/savedata/session/coop-run-status?${urlSearchParams}`);
      if (!response.ok) {
        const failure = await coopCasResult(response);
        return failure.ok
          ? { ok: false, status: response.status, error: "Invalid status response.", failureKind: "invalid" }
          : failure;
      }
      let value: unknown;
      try {
        value = JSON.parse(await response.text()) as unknown;
      } catch {
        return {
          ok: false,
          status: response.status,
          error: "Co-op run status response was not valid JSON.",
          failureKind: "invalid",
        };
      }
      if (!isCoopRunStatus(value, params.coopRunId)) {
        return {
          ok: false,
          status: response.status,
          error: "Co-op run status response was invalid.",
          failureKind: "invalid",
        };
      }
      return { ok: true, status: response.status, value };
    } catch (err) {
      console.warn("Could not read co-op run status!", err);
      return { ok: false, status: null, error: "Unknown Error!", failureKind: "transient" };
    }
  }

  /** Exact recovery deletion for an opaque row; classified co-op/solo JSON is rejected server-side. */
  public async deleteOpaqueExact(params: OpaqueExactDeleteSessionSavedataRequest): Promise<CoopCasMutationResult> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);
      const response = await this.doPost(`/savedata/session/opaque-exact-delete?${urlSearchParams}`, "");
      return await coopCasResult(response);
    } catch (err) {
      console.warn("Could not exactly delete opaque session savedata!", err);
      return coopCasTransportFailure();
    }
  }

  /** Exact removal for a protected pre-run-id/malformed co-op-like row that cannot enter CAS. */
  public async deleteLegacyCoopExact(
    params: LegacyCoopExactDeleteSessionSavedataRequest,
  ): Promise<CoopCasMutationResult> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);
      const response = await this.doPost(`/savedata/session/legacy-coop-exact-delete?${urlSearchParams}`, "");
      return await coopCasResult(response);
    } catch (err) {
      console.warn("Could not exactly delete legacy co-op session savedata!", err);
      return coopCasTransportFailure();
    }
  }

  /**
   * Delete a session savedata slot.
   * @param params The {@linkcode DeleteSessionSavedataRequest} to send
   * @returns An error message if something went wrong
   */
  public async delete(params: DeleteSessionSavedataRequest): Promise<string | null> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);
      const response = await this.doGet(`/savedata/session/delete?${urlSearchParams}`);
      console.debug("%cSending a request to delete session in slot %d", "color: blue", params.slot);

      if (response.ok) {
        return null;
      }
      return await response.text();
    } catch (err) {
      console.warn("Could not delete session savedata!", err);
      return "Unknown error";
    }
  }

  /**
   * Clears the session savedata of the given slot. \
   * _This is **NOT** the same as {@linkcode newclear | newclear()}._
   * @param params The {@linkcode ClearSessionSavedataRequest} to send
   * @param sessionData The {@linkcode SessionSaveData} object
   */
  public async clear(
    params: ClearSessionSavedataRequest,
    sessionData: SessionSaveData,
  ): Promise<ClearSessionSavedataResponse> {
    try {
      const urlSearchParams = this.toUrlSearchParams(params);
      const response = await this.doPost(`/savedata/session/clear?${urlSearchParams}`, sessionData);

      return (await response.json()) as ClearSessionSavedataResponse;
    } catch (err) {
      console.warn("Could not clear session savedata!", err);
    }

    return {
      error: "Unknown error",
      success: false,
    } as ClearSessionSavedataResponse;
  }
}
