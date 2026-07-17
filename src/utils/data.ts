import { loggedInUser } from "#app/account";
import { saveKey } from "#app/constants";
import type { Starter, StarterAttributes } from "#types/save-data";
import { AES, enc } from "crypto-js";
import { compressToBase64, decompressFromBase64 } from "lz-string";

/**
 * Marker prefixing a COMPRESSED save payload (#629/#631). The client used to
 * write the save to localStorage uncompressed (AES- or base64-encoded JSON, which
 * INFLATES it), while the cloud worker gzips ~12x - so big saves (large egg
 * backlogs) blew the ~5MB localStorage quota ("save too large, e.g. too many
 * eggs"). We now LZ-compress the JSON before the existing transport (AES for
 * logged-in, base64 for guest). The marker lets {@linkcode decrypt} tell a
 * compressed payload from a legacy plaintext one, so existing saves keep loading
 * and only re-compress on their next write. ":" is not a base64 character, so a
 * legacy base64/AES blob can never begin with this prefix.
 */
const SAVE_COMPRESS_PREFIX = "LZ1:";

/**
 * Perform a deep copy of an object.
 * @param values - The object to be deep copied.
 * @returns A new object that is a deep copy of the input.
 */
export function deepCopy<T extends object>(values: T): T {
  // Convert the object to a JSON string and parse it back to an object to perform a deep copy
  return JSON.parse(JSON.stringify(values));
}

/**
 * Deeply merge two JSON objects' common properties together.
 * This copies all values from `source` that match properties inside `dest`,
 * checking recursively for non-null nested objects.

 * If a property in `source` does not exist in `dest` or its `typeof` evaluates differently, it is skipped.
 * If it is a non-array object, its properties are recursed into and checked in turn.
 * All other values are copied verbatim.
 * @param dest - The object to merge values into
 * @param source - The object to source merged values from
 * @remarks Do not use for regular objects; this is specifically made for JSON copying.
 */
export function deepMergeSpriteData(dest: object, source: object) {
  for (const key of Object.keys(source)) {
    if (
      !(key in dest)
      || typeof source[key] !== typeof dest[key]
      || Array.isArray(source[key]) !== Array.isArray(dest[key])
    ) {
      continue;
    }

    // Pure objects get recursed into; everything else gets overwritten
    if (typeof source[key] !== "object" || source[key] === null || Array.isArray(source[key])) {
      dest[key] = source[key];
    } else {
      deepMergeSpriteData(dest[key], source[key]);
    }
  }
}

export function encrypt(data: string, bypassLogin: boolean): string {
  // Compress the JSON first (huge for big saves), then apply the existing
  // transport. The compressed payload is ASCII base64, safe through both btoa and
  // crypto-js's UTF-8 AES.
  const payload = SAVE_COMPRESS_PREFIX + compressToBase64(data);
  if (bypassLogin) {
    return payload;
  }
  return AES.encrypt(payload, saveKey).toString();
}

/**
 * Thrown when a stored save payload cannot be DECODED - a corrupt or truncated
 * localStorage blob, a wrong-codec guest/AES mix, or a failed decompression.
 *
 * The underlying codecs raise BARE, unclassifiable errors: crypto-js throws
 * `Error: Malformed UTF-8 data` when an AES blob decrypts to invalid UTF-8 bytes
 * (the exact error a live save-loss report showed ESCAPING UNCAUGHT during
 * save-load, attributed to the dynamically-imported chunk that happens to bundle
 * crypto-js), and the guest path's `atob`/`decodeURIComponent` throw
 * `URIError: URI malformed`. Wrapping both at this single decode boundary means
 * callers can tell "these bytes are corrupt" from any other failure, and the raw
 * codec error is LOGGED here instead of surfacing alone with no context.
 */
export class SaveDecodeError extends Error {
  constructor(cause: unknown) {
    super(`Save data could not be decoded: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "SaveDecodeError";
    // Preserve the original codec error for anyone inspecting the chain.
    (this as { cause?: unknown }).cause = cause;
  }
}

export function decrypt(data: string, bypassLogin: boolean): string {
  try {
    if (bypassLogin) {
      // New (compressed) guest saves are stored as the bare marked payload; legacy
      // guest saves are btoa(encodeURIComponent(json)).
      return data.startsWith(SAVE_COMPRESS_PREFIX)
        ? (decompressFromBase64(data.slice(SAVE_COMPRESS_PREFIX.length)) ?? "")
        : decodeURIComponent(atob(data));
    }
    const plain = AES.decrypt(data, saveKey).toString(enc.Utf8);
    // Legacy AES saves decrypt straight to JSON; new ones to the marked payload.
    return plain.startsWith(SAVE_COMPRESS_PREFIX)
      ? (decompressFromBase64(plain.slice(SAVE_COMPRESS_PREFIX.length)) ?? "")
      : plain;
  } catch (err) {
    // A corrupt / truncated / wrong-codec blob makes crypto-js throw "Malformed
    // UTF-8 data" (AES path) or atob/decodeURIComponent throw "URI malformed"
    // (guest path). Classify + LOG the corruption here so no raw, unattributable
    // codec error escapes the save/boot path, then rethrow a TYPED error so every
    // caller keeps the SAME throw-contract. We deliberately do NOT swallow this
    // and return "" - a caller that mistook empty for "no save" could overwrite
    // good local data. Preserving the throw keeps corrupt bytes untouched.
    console.error("[save] decrypt failed - corrupt or wrong-codec save payload:", err);
    throw new SaveDecodeError(err);
  }
}

/**
 * Check if an object has no properties of its own (its shape is `{}`). An empty array is considered a bare object.
 * @param obj - Object to check
 * @returns - Whether the object is bare
 */
export function isBareObject(obj: any): boolean {
  if (typeof obj !== "object") {
    return false;
  }
  // biome-ignore lint/suspicious/useGuardForIn: Checking a bare object should include prototype chain
  for (const _ in obj) {
    return false;
  }
  return true;
}

// the latest data saved/loaded for the Starter Preferences. Required to reduce read/writes. Initialize as "{}", since this is the default value and no data needs to be stored if present.
// if they ever add private static variables, move this into StarterPrefs
const StarterPrefers_DEFAULT: string = "{}";
let StarterPrefers_private_latest: string = StarterPrefers_DEFAULT;

export interface StarterPreferences {
  [key: number]: StarterAttributes | undefined;
}
// called on starter selection show once

export function loadStarterPreferences(): StarterPreferences {
  return JSON.parse(
    (StarterPrefers_private_latest =
      localStorage.getItem(`starterPrefs_${loggedInUser?.username}`) || StarterPrefers_DEFAULT),
  );
}

export function saveStarterPreferences(prefs: StarterPreferences): void {
  // Fastest way to check if an object has any properties (does no allocation)
  if (isBareObject(prefs)) {
    console.warn("Refusing to save empty starter preferences");
    return;
  }
  // no reason to store `{}` (for starters not customized)
  const pStr: string = JSON.stringify(prefs, (_, value) => (isBareObject(value) ? undefined : value));
  if (pStr !== StarterPrefers_private_latest) {
    console.log("%cSaving starter preferences", "color: blue");
    // something changed, store the update
    localStorage.setItem(`starterPrefs_${loggedInUser?.username}`, pStr);
    // update the latest prefs
    StarterPrefers_private_latest = pStr;
  }
}

// =============================================================================
// ER "last team" persistence — remembers the exact Starter[] from the player's
// previous run so starter-select can offer a one-tap "use my last team" action.
// User-namespaced raw JSON in localStorage, mirroring the starterPrefs pattern.
// =============================================================================

function lastTeamKey(): string {
  return `lastTeam_${loggedInUser?.username}`;
}

/** Returns the player's previously-used team, or `null` if none is stored / it is malformed. */
export function loadLastTeam(): Starter[] | null {
  const raw = localStorage.getItem(lastTeamKey());
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as Starter[]) : null;
  } catch {
    return null;
  }
}

/** Persist the finalized {@linkcode Starter} array used to start a run. */
export function saveLastTeam(starters: Starter[]): void {
  if (!Array.isArray(starters) || starters.length === 0) {
    return;
  }
  localStorage.setItem(lastTeamKey(), JSON.stringify(starters));
}

// =============================================================================
// ER (#382): last-used challenge configuration, per account. Saved when a
// challenge run actually starts; the challenge screen re-applies it with R.
// =============================================================================

interface SavedChallenge {
  id: number;
  value: number;
  severity: number;
}

function lastChallengesKey(): string {
  return `lastChallenges_${loggedInUser?.username}`;
}

/** The last challenge configuration the player started a run with, or null. */
export function loadLastChallenges(): SavedChallenge[] | null {
  const raw = localStorage.getItem(lastChallengesKey());
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as SavedChallenge[]) : null;
  } catch {
    return null;
  }
}

/** Persist the challenge configuration a run is starting with. */
export function saveLastChallenges(challenges: readonly { id: number; value: number; severity: number }[]): void {
  const active = challenges.filter(c => c.value !== 0).map(({ id, value, severity }) => ({ id, value, severity }));
  if (active.length === 0) {
    return;
  }
  localStorage.setItem(lastChallengesKey(), JSON.stringify(active));
}
