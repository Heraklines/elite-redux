import { saveKey } from "#app/constants";
import { decrypt, encrypt, SaveDecodeError } from "#utils/data";
import { AES, enc } from "crypto-js";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Guardrail (a) - the save-load decode path must CATCH, LOG, and CLASSIFY a
 * malformed cached/fetched blob instead of letting a raw "Malformed UTF-8 data"
 * escape as an uncaught error during boot/save-load (the live save-loss report).
 */
describe("Unit Tests - data.ts decrypt() malformed-payload guardrail", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("round-trips a real payload (logged-in AES transport)", () => {
    const json = JSON.stringify({ hello: "world", eggs: [1, 2, 3] });
    expect(decrypt(encrypt(json, false), false)).toBe(json);
  });

  it("round-trips a real payload (guest transport)", () => {
    const json = JSON.stringify({ hello: "world" });
    expect(decrypt(encrypt(json, true), true)).toBe(json);
  });

  it("throws a classified SaveDecodeError (not a raw crypto error) on a corrupt AES blob", () => {
    // Captured corrupt ciphertext: this exact blob makes crypto-js's
    // enc.Utf8.stringify throw "Malformed UTF-8 data" - the uncaught error in
    // the report. Fed through decrypt() it must surface as a TYPED, logged error.
    const corrupt = "U2FsdGVkX1+GcAK/CaN8AAAAAAAAAAAAAAAAAAAADBoo760XaM8Buhl4MaGGrrps";
    // Precondition: prove the raw codec really throws the bare error we are guarding.
    expect(() => AES.decrypt(corrupt, saveKey).toString(enc.Utf8)).toThrow(/Malformed UTF-8/);

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => decrypt(corrupt, false)).toThrow(SaveDecodeError);
    // The corruption is LOGGED at the decode boundary (never a silent swallow).
    expect(errorSpy).toHaveBeenCalledWith(
      "[save] decrypt failed - corrupt or wrong-codec save payload:",
      expect.anything(),
    );
  });

  it("throws a classified SaveDecodeError on a malformed guest blob", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // "%" is an invalid percent-escape -> decodeURIComponent throws "URI malformed".
    const badGuest = btoa("%E0%A4%A");
    expect(() => decrypt(badGuest, true)).toThrow(SaveDecodeError);
  });

  it("does NOT throw on the benign empty-decrypt case (returns empty string)", () => {
    // crypto-js returns an EMPTY string (no throw) when a blob decrypts to no
    // bytes; decrypt() must preserve that contract so this stays distinct from
    // the corrupt-bytes case above.
    expect(decrypt("not-a-real-ciphertext-@@@", false)).toBe("");
  });
});
