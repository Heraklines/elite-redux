import type { SessionSaveData, SystemSaveData } from "#types/save-data";

export interface UserInfo {
  /** Opaque immutable server identity; absent only in local/bypass compatibility flows. */
  accountId?: string;
  username: string;
  lastSessionSlot: number;
  discordId: string;
  googleId: string;
  hasAdminRole: boolean;
}

export interface TitleStatsResponse {
  playerCount: number;
  battleCount: number;
}

// #region Account API

export interface AccountInfoResponse extends UserInfo {
  accountId: string;
}

export interface CoopIdentityTicketResponse {
  ticket: string;
  identity: {
    version: 1;
    accountId: string;
    displayName: string;
    canonicalUsername: string;
  };
  expiresAt: number;
}

export interface AccountLoginRequest {
  username: string;
  password: string;
}

export interface AccountLoginResponse {
  token: string;
}

export interface AccountRegisterRequest {
  username: string;
  password: string;
}

export interface AccountChangePwRequest {
  password: string;
}
export interface AccountChangePwResponse {
  success: boolean;
}

// #endregion
// #region Admin API

export interface SearchAccountRequest {
  username: string;
}

export interface DiscordRequest extends SearchAccountRequest {
  discordId: string;
}

export interface GoogleRequest extends SearchAccountRequest {
  googleId: string;
}

export interface SearchAccountResponse {
  username: string;
  discordId: string;
  googleId: string;
  lastLoggedIn: string;
  registered: string;
  systemData?: SystemSaveData;
}

/** Third party login services */
export type AdminUiHandlerService = "discord" | "google";
/** Mode for the admin UI handler */
export type AdminUiHandlerServiceMode = "Link" | "Unlink";

export interface PokerogueAdminApiParams extends Record<AdminUiHandlerService, SearchAccountRequest> {
  discord: DiscordRequest;
  google: GoogleRequest;
}

// #endregion

export interface UpdateAllSavedataRequest {
  system: SystemSaveData;
  /** Null when the session row was already committed through an exact first-save CAS. */
  session: SessionSaveData | null;
  sessionSlotId: number;
  clientSessionId: string;
}

// #region Session Save API

export interface UpdateSessionSavedataRequest {
  slot: number;
  trainerId: number;
  secretId: number;
  clientSessionId: string;
  /** Optional staging-safe compare-and-swap guard for a co-op checkpoint mirror. */
  coopCasMode?: "empty" | "existing";
  coopCasRunId?: string;
  coopCasCheckpointRevision?: number;
  coopCasDigest?: string;
}

export type CoopCasSessionSavedataRequest =
  | (UpdateSessionSavedataRequest & {
      coopCasMode: "empty";
      coopCasRunId?: never;
      coopCasCheckpointRevision?: never;
      coopCasDigest?: never;
    })
  | (UpdateSessionSavedataRequest & {
      coopCasMode: "existing";
      coopCasRunId: string;
      coopCasCheckpointRevision: number;
      coopCasDigest: string;
    });

/** Stable machine-readable classification for a dedicated co-op save mutation. */
export type CoopCasFailureKind = "conflict" | "invalid" | "unauthorized" | "unsupported" | "too-large" | "transient";

/**
 * Dedicated co-op session mutations preserve HTTP status and never infer success from an empty
 * non-2xx body. `status=null` is reserved for a transport failure before a response was received.
 */
export type CoopCasMutationResult =
  | { ok: true; status: number; error: ""; failureKind: null }
  | { ok: false; status: number | null; error: string; failureKind: CoopCasFailureKind };

/** This is **NOT** related to {@linkcode ClearSessionSavedataRequest}  */
export interface NewClearSessionSavedataRequest {
  slot: number;
  isVictory: boolean;
  clientSessionId: string;
}

export interface GetSessionSavedataRequest {
  slot: number;
  clientSessionId: string;
}

export interface DeleteSessionSavedataRequest {
  slot: number;
  clientSessionId: string;
}

export interface CoopCasDeleteSessionSavedataRequest extends DeleteSessionSavedataRequest {
  coopCasRunId: string;
  coopCasCheckpointRevision: number;
  coopCasDigest: string;
}

/** Exact convergence of a pre-existing duplicate while retaining one exact live copy. */
export interface CoopDuplicateExactDeleteSessionSavedataRequest extends CoopCasDeleteSessionSavedataRequest {
  survivorSlot: number;
  survivorCheckpointRevision: number;
  survivorDigest: string;
}

export type CoopCasSessionGetResult =
  | { ok: true; status: number; rawSavedata: string }
  | {
      ok: false;
      status: number | null;
      error: string;
      failureKind: CoopCasFailureKind | "missing";
    };

/** Recovery-only exact deletion commitment for an unparsable/non-object session row. */
export interface OpaqueExactDeleteSessionSavedataRequest extends DeleteSessionSavedataRequest {
  exactDigest: string;
}

/** Exact deletion commitment for a pre-run-id or otherwise invalid co-op-like session row. */
export interface LegacyCoopExactDeleteSessionSavedataRequest extends DeleteSessionSavedataRequest {
  exactDigest: string;
}

export interface CoopRunStatusRequest {
  clientSessionId: string;
  coopRunId: string;
  /** Optional caller context only; status lookup remains account-wide and returns the actual slot. */
  slot?: number;
}

export type CoopRunStatus =
  | {
      state: "active" | "tombstoned";
      runId: string;
      slot: number;
      checkpointRevision: number;
      digest: string;
    }
  | { state: "missing"; runId: string };

export type CoopRunStatusResult =
  | { ok: true; status: number; value: CoopRunStatus }
  | { ok: false; status: number | null; error: string; failureKind: CoopCasFailureKind };

/** This is **NOT** related to {@linkcode NewClearSessionSavedataRequest} */
export interface ClearSessionSavedataRequest {
  slot: number;
  trainerId: number;
  clientSessionId: string;
}

/** Pokerogue API response for path: `/savedata/session/clear` */
// TODO: Why can these be nullish?
export interface ClearSessionSavedataResponse {
  /** Contains the error message if any occured */
  error?: string;
  /** Is `true` if the request was successfully processed */
  success?: boolean;
}

// #endregion
// #region System Save API

export interface GetSystemSavedataRequest {
  clientSessionId: string;
}

export interface UpdateSystemSavedataRequest {
  clientSessionId: string;
  trainerId?: number;
  secretId?: number;
}

export interface VerifySystemSavedataRequest {
  clientSessionId: string;
}

export interface VerifySystemSavedataResponse {
  valid: boolean;
  systemData: SystemSaveData;
}

// #endregion
