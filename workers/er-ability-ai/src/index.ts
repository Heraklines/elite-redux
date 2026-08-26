import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  ABILITY_AI: DurableObjectNamespace<AbilityAiContainer>;
  AUTH_ENCRYPTION_KEY: string;
  NVIDIA_NIM_API_KEY?: string;
  ALLOWED_ORIGINS: string;
  CODEX_MODEL: string;
  CODEX_EFFORT: string;
  NVIDIA_NIM_MODEL: string;
}

interface StoredAuth {
  version: 1;
  iv: string;
  data: string;
}

interface RateWindow {
  start: number;
  count: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const publicPaths = new Set(["/auth/start", "/auth/status", "/generate", "/cancel"]);

function base64(bytes: Uint8Array): string {
  let value = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    value += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(value);
}

function unbase64(value: string): Uint8Array {
  const decoded = atob(value);
  const bytes = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index++) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return bytes;
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encrypt(value: string, secret: string): Promise<StoredAuth> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(secret), encoder.encode(value));
  return { version: 1, iv: base64(iv), data: base64(new Uint8Array(data)) };
}

async function decrypt(value: StoredAuth, secret: string): Promise<string> {
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: unbase64(value.iv) },
    await encryptionKey(secret),
    unbase64(value.data),
  );
  return decoder.decode(data);
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {}
}

export class AbilityAiContainer extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "2m";
  enableInternet = true;
  envVars: Record<string, string>;
  private restoredInstance = "";
  private readonly runtimeEnv: Env;

  constructor(ctx: DurableObjectState<Record<string, never>>, runtimeEnv: Env) {
    super(ctx, runtimeEnv);
    this.runtimeEnv = runtimeEnv;
    this.envVars = {
      CODEX_MODEL: runtimeEnv.CODEX_MODEL,
      CODEX_EFFORT: runtimeEnv.CODEX_EFFORT,
      NVIDIA_NIM_API_KEY: runtimeEnv.NVIDIA_NIM_API_KEY ?? "",
      NVIDIA_NIM_MODEL: runtimeEnv.NVIDIA_NIM_MODEL,
    };
  }

  private async restoreAuth(): Promise<Response | undefined> {
    const instanceResponse = await this.containerFetch("http://localhost/internal/instance");
    if (!instanceResponse.ok) {
      return json({ error: "The ability builder container did not start" }, 503);
    }
    const instance = await instanceResponse.text();
    if (instance === this.restoredInstance) {
      return;
    }
    const stored = await this.ctx.storage.get<StoredAuth>("codex-auth");
    let auth = "";
    if (stored) {
      try {
        auth = await decrypt(stored, this.runtimeEnv.AUTH_ENCRYPTION_KEY);
      } catch {
        return json({ error: "The saved Codex login could not be decrypted" }, 500);
      }
    }
    const response = await this.containerFetch("http://localhost/internal/auth/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: auth,
    });
    if (!response.ok) {
      return json({ error: "The saved Codex login could not be restored" }, 500);
    }
    this.restoredInstance = instance;
    return;
  }

  private async persistAuth(): Promise<void> {
    const response = await this.containerFetch("http://localhost/internal/auth/export");
    if (response.status === 204) {
      await this.ctx.storage.delete("codex-auth");
      return;
    }
    if (!response.ok) {
      return;
    }
    const auth = await response.text();
    if (auth.length > 0) {
      await this.ctx.storage.put("codex-auth", await encrypt(auth, this.runtimeEnv.AUTH_ENCRYPTION_KEY));
    }
  }

  private async takeRateSlot(): Promise<boolean> {
    const now = Date.now();
    const current = (await this.ctx.storage.get<RateWindow>("rate-window")) ?? { start: now, count: 0 };
    const window = now - current.start >= 60_000 ? { start: now, count: 0 } : current;
    if (window.count >= 12) {
      return false;
    }
    window.count++;
    await this.ctx.storage.put("rate-window", window);
    return true;
  }

  override async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (!publicPaths.has(path)) {
      return json({ error: "Not found" }, 404);
    }
    if (path === "/generate" && !(await this.takeRateSlot())) {
      return json({ error: "The ability builder is limited to 12 requests per minute" }, 429);
    }
    const restoreError = await this.restoreAuth();
    if (restoreError) {
      return restoreError;
    }
    const response = await this.containerFetch(request);
    if (!response.body) {
      this.ctx.waitUntil(this.persistAuth());
      return response;
    }
    const [clientBody, observedBody] = response.body.tee();
    this.ctx.waitUntil(drain(observedBody).then(() => this.persistAuth()));
    return new Response(clientBody, response);
  }

  override async onActivityExpired(): Promise<void> {
    await this.persistAuth();
    await this.stop();
  }
}

function allowedOrigins(env: Env): Set<string> {
  return new Set(
    env.ALLOWED_ORIGINS.split(",")
      .map(origin => origin.trim())
      .filter(Boolean),
  );
}

function withCors(response: Response, origin: string | null, env: Env): Response {
  const headers = new Headers(response.headers);
  if (origin && allowedOrigins(env).has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Headers", "Content-Type, X-Editor-Password");
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get("Origin");
    if (origin && !allowedOrigins(env).has(origin)) {
      return json({ error: "Origin not allowed" }, 403);
    }
    if (request.method === "OPTIONS") {
      return withCors(new Response(null, { status: 204 }), origin, env);
    }
    const path = new URL(request.url).pathname;
    if (path === "/health" && request.method === "GET") {
      return withCors(json({ ok: true }), origin, env);
    }
    if (request.method !== "POST" || !publicPaths.has(path)) {
      return withCors(json({ error: "Not found" }, 404), origin, env);
    }
    if (!env.AUTH_ENCRYPTION_KEY) {
      return withCors(json({ error: "Ability builder secrets are not configured" }, 503), origin, env);
    }
    const suppliedPassword = request.headers.get("X-Editor-Password") ?? "";
    const authResponse = await fetch("https://er-editor-api.heraklines.workers.dev/auth-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: suppliedPassword }),
    });
    if (!authResponse.ok) {
      const status = authResponse.status === 401 ? 401 : 503;
      const error = status === 401 ? "Invalid editor password" : "Editor authentication is unavailable";
      return withCors(json({ error }, status), origin, env);
    }
    const contentLength = Number(request.headers.get("Content-Length") ?? 0);
    if (contentLength > 524_288) {
      return withCors(json({ error: "Ability builder request is too large" }, 413), origin, env);
    }
    const headers = new Headers(request.headers);
    headers.delete("X-Editor-Password");
    headers.delete("Cookie");
    const internalRequest = new Request(request, { headers });
    const response = await getContainer(env.ABILITY_AI, "editor-primary").fetch(internalRequest);
    return withCors(response, origin, env);
  },
} satisfies ExportedHandler<Env>;
