import { SESSION_ID_COOKIE_NAME } from "#app/constants";
import { getCookie } from "#utils/cookies";
import type { SetRequired, UndefinedOnPartialDeep } from "type-fest";

type DataType = "json" | "form-urlencoded";

/**
 * Hard ceiling on any single API request. A hung/slow endpoint must never freeze
 * the client: Save & Quit awaits the cloud push, and with no timeout a stalled
 * request left players stuck on the menu until a manual refresh (a regression
 * once the login feature made the quit path await the server). Abort after this
 * so the caller's await rejects, the savedata API's catch returns an error, and
 * saveAll falls back to local-only. Saves are tiny (<<50 KB), so 15s is generous.
 */
const API_REQUEST_TIMEOUT_MS = 15_000;

/**
 * Configuration type for {@linkcode ApiBase.doFetch}.
 * @internal
 */
interface DoFetchConfig extends SetRequired<UndefinedOnPartialDeep<RequestInit>, "method"> {}

export abstract class ApiBase {
  // TODO: Make constant in outer scope
  public readonly ERR_GENERIC: string = "There was an error";

  /** The base URL for HTTP requests. */
  protected readonly base: string;

  constructor(base: string) {
    this.base = base;
  }

  /**
   * Send an HTTP GET request.
   * @param path - The path to send the request to
   */
  protected async doGet(path: string, signal?: AbortSignal): Promise<Response> {
    return this.doFetch(path, { method: "GET", signal });
  }

  /**
   * Send an HTTP POST request.
   * @param path - The path to send the request to
   * @param bodyData - The body-data to send; will be stringified if needed
   * @param dataType - (Default `"json"`) The type of data to send
   */
  protected async doPost(
    path: string,
    bodyData?: Record<string, any> | string,
    dataType?: "json",
    signal?: AbortSignal,
  ): Promise<Response>;
  /**
   * Send an HTTP POST request.
   * @param path - The path to send the request to
   * @param bodyData - The body-data to send; will be stringified if needed
   * @param dataType - (Default `"json"`) The type of data to send
   */
  protected async doPost(
    path: string,
    bodyData: Record<string, any>,
    dataType: "form-urlencoded",
    signal?: AbortSignal,
  ): Promise<Response>;
  protected async doPost(
    path: string,
    bodyData?: Record<string, any> | string,
    dataType: DataType = "json",
    signal?: AbortSignal,
  ): Promise<Response> {
    if (bodyData === undefined) {
      return this.doFetch(path, { method: "POST", signal });
    }

    let body: string;
    const headers: HeadersInit = {};

    switch (dataType) {
      case "json":
        body = typeof bodyData === "string" ? bodyData : JSON.stringify(bodyData);
        headers["Content-Type"] = "application/json";
        break;
      case "form-urlencoded":
        if (typeof bodyData !== "object" || Array.isArray(bodyData) || bodyData === null) {
          console.error(`Incorrect type of bodyData passed to form-urlencoded POST request!\nBodyData:${bodyData}`);
          return Promise.reject("Invalid bodyData for form-urlencoded POST request");
        }

        body = this.toUrlSearchParams(bodyData).toString();
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        break;
      default:
        console.error(`Unsupported data type: ${dataType}`);
        body = String(bodyData);
        headers["Content-Type"] = "text/plain";
        break;
    }
    return await this.doFetch(path, { method: "POST", body, headers, signal });
  }

  /**
   * A generic request helper.
   * @param path - The path to send the request to
   * @param config - The request configuration
   */
  protected async doFetch(path: string, config: DoFetchConfig): Promise<Response> {
    config.headers = {
      ...config.headers,
      Authorization: getCookie(SESSION_ID_COOKIE_NAME),
      "Content-Type": config.headers?.["Content-Type"] ?? "application/json",
    };

    // can't import `isLocal` due to circular import issues
    if (import.meta.env.MODE === "development") {
      console.log(`Sending ${config.method} request to: `, this.base + path, config);
    }

    // Abort a hung/slow request so the await rejects instead of freezing the
    // client (see API_REQUEST_TIMEOUT_MS). A caller-supplied signal is honored
    // in preference to the timeout one.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_REQUEST_TIMEOUT_MS);
    try {
      return await fetch(this.base + path, {
        ...(config as RequestInit),
        signal: config.signal ?? controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Helper to transform data to {@linkcode URLSearchParams}
   * Any key with a value of `undefined` will be ignored.
   * Any key with a value of `null` will be included.
   * @param data the data to transform to {@linkcode URLSearchParams}
   * @returns a {@linkcode URLSearchParams} representaton of {@linkcode data}
   */
  protected toUrlSearchParams(data: Record<string, any>): URLSearchParams {
    const arr = Object.entries(data)
      .map(([key, value]) => [key, value === undefined ? "" : String(value)])
      .filter(([, value]) => value !== "");

    return new URLSearchParams(arr);
  }
}
