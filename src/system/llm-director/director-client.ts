/**
 * NanoGPT chat-completions client. Thin wrapper over `fetch` with timeout,
 * exponential-backoff retry on 5xx/network failures, and per-call latency +
 * token telemetry. Speaks the OpenAI-compatible v1 chat-completions API.
 *
 * Successful completions are mirrored into the in-memory telemetry ring
 * buffer so the debug overlay (Task 23) can show recent activity without
 * touching save data.
 */

import { recordTelemetry } from "#system/llm-director/telemetry";

export interface DirectorClientOptions {
  apiKey: string;
  baseUrl: string;
  /** Default 2 (i.e., 3 attempts total). */
  maxRetries?: number;
  /** Base delay in ms; doubled per attempt. Default 500. */
  retryDelayMs?: number;
  /** Default per-call timeout if not overridden. Default 30000. */
  timeoutMs?: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  /** Override the client default for this call. */
  timeoutMs?: number;
  /** Forwarded as `response_format` for JSON-mode hints. */
  responseFormat?: "text" | "json_object";
  temperature?: number;
}

export interface CompletionResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  attempts: number;
}

interface OpenAiChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_TIMEOUT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export class DirectorClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly defaultTimeoutMs: number;

  public constructor(opts: DirectorClientOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl.replace(/\/$/, "");
    this.maxRetries = opts.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.defaultTimeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * POST one chat completion. Throws on timeout, persistent 5xx, or 4xx.
   */
  public async complete(req: CompletionRequest): Promise<CompletionResult> {
    const url = `${this.baseUrl}/chat/completions`;
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;

    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
    };
    if (req.responseFormat === "json_object") {
      body.response_format = { type: "json_object" };
    }
    if (typeof req.temperature === "number") {
      body.temperature = req.temperature;
    }

    const t0 = performance.now();
    let attempts = 0;
    let lastErrorMessage = "";
    while (attempts <= this.maxRetries) {
      attempts++;
      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        clearTimeout(timeoutHandle);
        if (res.status >= 200 && res.status < 300) {
          const json = (await res.json()) as OpenAiChatResponse;
          const content = json.choices?.[0]?.message?.content ?? "";
          const latencyMs = performance.now() - t0;
          const inputTokens = json.usage?.prompt_tokens ?? 0;
          const outputTokens = json.usage?.completion_tokens ?? 0;
          recordTelemetry({
            model: req.model,
            inputTokens,
            outputTokens,
            latencyMs,
            status: attempts > 1 ? "retry" : "ok",
            timestampMs: Date.now(),
          });
          return {
            content,
            inputTokens,
            outputTokens,
            latencyMs,
            attempts,
          };
        }
        // 4xx: do not retry — surface the error.
        if (res.status >= 400 && res.status < 500) {
          throw new Error(`DirectorClient: ${res.status} ${res.statusText || "client error"}`);
        }
        // 5xx: retry with backoff.
        lastErrorMessage = `${res.status} ${res.statusText || "server error"}`;
      } catch (err) {
        clearTimeout(timeoutHandle);
        if (err instanceof DOMException && err.name === "AbortError") {
          // Timeout: surface immediately, do not retry. This makes upstream
          // budgets predictable: the queue can decide to fall back to filler
          // beats rather than burn the whole 3-wave budget on retries.
          throw new Error(`DirectorClient: timeout after ${timeoutMs}ms`);
        }
        // 4xx errors thrown above bubble up here too — preserve them as-is.
        if (err instanceof Error && /^DirectorClient: \d{3}/.test(err.message)) {
          throw err;
        }
        // Network or unknown error: retryable.
        lastErrorMessage = err instanceof Error ? err.message : String(err);
      }
      if (attempts <= this.maxRetries) {
        await sleep(this.retryDelayMs * 2 ** (attempts - 1));
      }
    }
    throw new Error(`DirectorClient: ${lastErrorMessage} (after ${attempts} attempts)`);
  }
}
