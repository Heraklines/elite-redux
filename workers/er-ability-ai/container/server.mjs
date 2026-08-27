import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import readline from "node:readline";

const port = Number(process.env.PORT || 8080);
const codexHome = process.env.CODEX_HOME || "/var/lib/ability-ai/codex";
const authPath = `${codexHome}/auth.json`;
const instanceId = randomUUID();
const codexModel = process.env.CODEX_MODEL || "gpt-5.6-luna";
const codexEffort = process.env.CODEX_EFFORT || "high";
const nimModel = process.env.NVIDIA_NIM_MODEL || "qwen/qwen3-coder-480b-a35b-instruct";
const nimKey = process.env.NVIDIA_NIM_API_KEY || "";
let activeTurn = null;
let generationBusy = false;

const sourceSchema = {
  type: "object",
  properties: {
    abilityId: { type: "integer", minimum: 1 },
    attrIndex: { type: "integer", minimum: 0 },
    attrType: { type: "string", minLength: 2, maxLength: 120 },
  },
  required: ["abilityId", "attrIndex", "attrType"],
  additionalProperties: false,
};

const conditionReferenceSchema = {
  type: "object",
  properties: {
    abilityId: { type: "integer", minimum: 1 },
    attrIndex: { type: "integer", minimum: 0 },
    attrType: { type: "string", minLength: 2, maxLength: 120 },
    kind: { type: "string", enum: ["ability", "holder", "event"] },
    conditionIndex: { type: ["integer", "null"], minimum: 0 },
  },
  required: ["abilityId", "attrIndex", "attrType", "kind", "conditionIndex"],
  additionalProperties: false,
};

const filterSchema = {
  type: "object",
  properties: {
    type: { type: ["string", "null"] },
    category: { type: ["string", "null"] },
    flag: { type: ["string", "null"] },
    damaging: { type: ["boolean", "null"] },
  },
  required: ["type", "category", "flag", "damaging"],
  additionalProperties: false,
};

const simpleConditionSchema = {
  type: "object",
  properties: {
    kind: { type: "string" },
    minPercent: { type: ["number", "null"] },
    maxPercent: { type: ["number", "null"] },
    status: { type: ["string", "null"] },
    weather: { type: ["string", "null"] },
    terrain: { type: ["string", "null"] },
    filter: filterSchema,
  },
  required: ["kind", "minPercent", "maxPercent", "status", "weather", "terrain", "filter"],
  additionalProperties: false,
};

const simpleEffectSchema = {
  type: "object",
  properties: {
    kind: { type: "string" },
    target: { type: ["string", "null"] },
    stat: { type: ["string", "null"] },
    stages: { type: ["integer", "null"] },
    status: { type: ["string", "null"] },
    percent: { type: ["number", "null"] },
    weather: { type: ["string", "null"] },
    terrain: { type: ["string", "null"] },
  },
  required: ["kind", "target", "stat", "stages", "status", "percent", "weather", "terrain"],
  additionalProperties: false,
};

const modifierSchema = {
  type: "object",
  properties: {
    kind: { type: "string" },
    multiplier: { type: ["number", "null"] },
    stat: { type: ["string", "null"] },
    amount: { type: ["integer", "null"] },
    filter: filterSchema,
  },
  required: ["kind", "multiplier", "stat", "amount", "filter"],
  additionalProperties: false,
};

const outputSchema = {
  type: "object",
  properties: {
    explanation: { type: "string", minLength: 1, maxLength: 1000 },
    blueprint: {
      type: "object",
      properties: {
        version: { type: "integer", enum: [1] },
        id: { type: "integer", minimum: 20000, maximum: 29999 },
        name: { type: "string", minLength: 2, maxLength: 40 },
        description: { type: "string", minLength: 2, maxLength: 500 },
        generation: { type: "integer", minimum: 1, maximum: 9 },
        includes: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 12 },
        mechanics: { type: "array", items: sourceSchema, maxItems: 64 },
        componentRules: {
          type: "array",
          maxItems: 32,
          items: {
            type: "object",
            properties: {
              key: { type: "string", pattern: "^[a-z0-9-]{1,48}$" },
              prerequisiteHooks: { type: "array", items: sourceSchema, maxItems: 7 },
              hook: sourceSchema,
              chance: { type: "number", minimum: 1, maximum: 100 },
              conditionLogic: { type: "string", enum: ["all", "any"] },
              conditions: {
                type: "array",
                items: { anyOf: [conditionReferenceSchema, simpleConditionSchema] },
                maxItems: 16,
              },
              effects: {
                type: "array",
                items: { anyOf: [sourceSchema, simpleEffectSchema] },
                minItems: 1,
                maxItems: 8,
              },
            },
            required: ["key", "prerequisiteHooks", "hook", "chance", "conditionLogic", "conditions", "effects"],
            additionalProperties: false,
          },
        },
        rules: {
          type: "array",
          maxItems: 24,
          items: {
            type: "object",
            properties: {
              key: { type: "string", pattern: "^[a-z0-9-]{1,40}$" },
              trigger: { type: "string" },
              chance: { type: "number", minimum: 1, maximum: 100 },
              conditionLogic: { type: "string", enum: ["all", "any"] },
              conditions: { type: "array", items: simpleConditionSchema, maxItems: 8 },
              effects: { type: "array", items: simpleEffectSchema, minItems: 1, maxItems: 8 },
            },
            required: ["key", "trigger", "chance", "conditionLogic", "conditions", "effects"],
            additionalProperties: false,
          },
        },
        modifiers: { type: "array", items: modifierSchema, maxItems: 24 },
        flags: {
          type: "object",
          properties: {
            bypassFaint: { type: "boolean" },
            ignorable: { type: "boolean" },
            unsuppressable: { type: "boolean" },
            uncopiable: { type: "boolean" },
            unreplaceable: { type: "boolean" },
          },
          required: ["bypassFaint", "ignorable", "unsuppressable", "uncopiable", "unreplaceable"],
          additionalProperties: false,
        },
      },
      required: [
        "version",
        "id",
        "name",
        "description",
        "generation",
        "includes",
        "mechanics",
        "componentRules",
        "rules",
        "modifiers",
        "flags",
      ],
      additionalProperties: false,
    },
  },
  required: ["explanation", "blueprint"],
  additionalProperties: false,
};

function writeJson(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readBody(request, limit = 524_288) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > limit) {
      throw Object.assign(new Error("Request is too large"), { status: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function ndjson(response, value) {
  response.write(`${JSON.stringify(value)}\n`);
}

function errorInfo(error) {
  const value = error?.codexErrorInfo || error?.error?.codexErrorInfo || {};
  return {
    message: error?.message || error?.error?.message || String(error),
    type: typeof value === "string" ? value : value.type || Object.keys(value)[0] || "Other",
  };
}

class CodexRpc {
  child = null;
  pending = new Map();
  listeners = new Set();
  nextId = 1;
  starting = null;

  async start() {
    if (this.starting) {
      return this.starting;
    }
    if (this.child && !this.child.killed) {
      return;
    }
    this.starting = this.startProcess();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async startProcess() {
    await mkdir(codexHome, { recursive: true });
    this.child = spawn("codex", ["app-server"], {
      cwd: "/srv/empty",
      env: { ...process.env, CODEX_HOME: codexHome, HOME: process.env.HOME || "/var/lib/ability-ai" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    const lines = readline.createInterface({ input: this.child.stdout });
    lines.on("line", line => this.receive(line));
    this.child.stderr.on("data", chunk => process.stderr.write(chunk));
    this.child.once("exit", (code, signal) => {
      const error = new Error(`Codex App Server exited (${code ?? signal ?? "unknown"})`);
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
      this.child = null;
    });
    await new Promise((resolve, reject) => {
      this.child.once("spawn", resolve);
      this.child.once("error", reject);
    });
    await this.request("initialize", {
      clientInfo: { name: "er_ability_studio", title: "ER Ability Studio", version: "1.0.0" },
    });
    this.notify("initialized", {});
  }

  receive(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id !== undefined && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(Object.assign(new Error(message.error.message || "Codex request failed"), message.error));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.id !== undefined && message.method) {
      this.send({ id: message.id, result: { decision: "decline" } });
      return;
    }
    for (const listener of this.listeners) {
      listener(message);
    }
  }

  send(message) {
    if (!this.child?.stdin.writable) {
      throw new Error("Codex App Server is unavailable");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  notify(method, params) {
    this.send({ method, params });
  }

  async request(method, params = {}, timeoutMs = 30_000) {
    if (method !== "initialize") {
      await this.start();
    }
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: error => {
          clearTimeout(timeout);
          reject(error);
        },
      });
    });
    this.send({ method, id, params });
    return promise;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

const rpc = new CodexRpc();

function stripNulls(value) {
  if (Array.isArray(value)) {
    return value.map(stripNulls);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== null) {
      result[key] = stripNulls(item);
    }
  }
  return result;
}

function extractJson(text) {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error("The model did not return a valid ability blueprint");
  }
}

function sourceKey(source) {
  return `${source.abilityId}:${source.attrIndex}:${source.attrType}`;
}

function validateSources(result, payload) {
  const abilityIds = new Set((payload.abilityIndex || []).map(ability => Number(ability.id)));
  const hooks = new Map();
  const conditions = new Map();
  const effects = new Map();
  for (const ability of payload.componentCandidates || []) {
    for (const rule of ability.rules || []) {
      hooks.set(sourceKey(rule.source), rule.hook);
      for (const condition of rule.conditions || []) {
        conditions.set(`${sourceKey(condition.source)}:${condition.kind}:${condition.source.conditionIndex ?? ""}`, {
          condition,
          hook: rule.hook,
        });
      }
      for (const effect of rule.effects || []) {
        effects.set(sourceKey(effect.source), { effect, hook: rule.hook });
      }
    }
  }
  const blueprint = result.blueprint;
  for (const id of blueprint.includes || []) {
    if (!abilityIds.has(Number(id))) {
      throw new Error(`The model referenced unknown ability #${id}`);
    }
  }
  for (const rule of blueprint.componentRules || []) {
    for (const hook of [...(rule.prerequisiteHooks || []), rule.hook]) {
      if (!hooks.has(sourceKey(hook))) {
        throw new Error(`The model referenced an unavailable WHEN component (${sourceKey(hook)})`);
      }
    }
    for (const condition of rule.conditions || []) {
      if (!Number.isInteger(condition.abilityId)) {
        continue;
      }
      const key = `${sourceKey(condition)}:${condition.kind}:${condition.conditionIndex ?? ""}`;
      const candidate = conditions.get(key);
      if (!candidate) {
        throw new Error(`The model referenced an unavailable IF component (${key})`);
      }
    }
    for (const effect of rule.effects || []) {
      if (!Number.isInteger(effect.abilityId)) {
        continue;
      }
      const candidate = effects.get(sourceKey(effect));
      if (!candidate) {
        throw new Error(`The model referenced an unavailable DO component (${sourceKey(effect)})`);
      }
    }
  }
}

function modelPrompt(payload) {
  return `You assemble Elite Redux Pokemon abilities from a closed catalog. Do not write code, commands, files, or unsupported mechanics. Build exactly one Ability Studio blueprint. Triggers, conditions, and effects are independent: componentRules may mix runtime component references with configurable primitive conditions and effects. Prefer componentRules when a supplied runtime trigger is needed. Recombine configurable primitives freely. Event IF components can be observed under their native dispatcher and consumed by any WHEN hook. Hook-bound DO/THEN components can be armed by any WHEN hook and execute once through their native dispatcher, preserving their real runtime arguments and eligibility checks. Direct-engine capability packages can be activated by any WHEN hook for the rest of the battle. Use includes only when the user explicitly wants the whole existing ability. Every runtime component source object must be copied exactly from componentCandidates. Primitive conditions and effects must use the primitive catalog. If the request cannot be represented exactly, build the closest safe draft and state the limitation in explanation. Keep the ability description player-facing and precise.\n\nREQUEST:\n${payload.prompt}\n\nCURRENT DRAFT (optional reference only):\n${JSON.stringify(payload.currentBlueprint || null)}\n\nPRIMITIVE CATALOG:\n${JSON.stringify(payload.primitiveCatalog)}\n\nABILITY INDEX:\n${JSON.stringify(payload.abilityIndex)}\n\nRELEVANT RUNTIME COMPONENTS:\n${JSON.stringify(payload.componentCandidates)}`;
}

async function runCodex(payload, emit) {
  await rpc.start();
  const account = await rpc.request("account/read", { refreshToken: true });
  if (!account?.account || account.account.type !== "chatgpt") {
    throw Object.assign(new Error("The ability builder is temporarily unavailable"), { fallback: true });
  }
  const limits = await rpc.request("account/rateLimits/read").catch(() => null);
  if (limits?.rateLimits?.rateLimitReachedType || limits?.rateLimits?.primary?.usedPercent >= 100) {
    throw Object.assign(new Error("The ability builder is temporarily at its usage limit"), { fallback: true });
  }
  emit({ type: "status", message: "Preparing the requested ability" });
  const threadResult = await rpc.request("thread/start", {
    model: codexModel,
    cwd: "/srv/empty",
    approvalPolicy: "never",
    sandbox: "read-only",
    serviceName: "er_ability_studio",
    ephemeral: true,
  });
  const threadId = threadResult.thread.id;
  let turnId = "";
  let finalText = "";
  let turnError = null;
  let completed;
  const done = new Promise(resolve => {
    completed = resolve;
  });
  const unsubscribe = rpc.subscribe(message => {
    const params = message.params || {};
    if (params.threadId && params.threadId !== threadId) {
      return;
    }
    if (message.method === "item/reasoning/summaryTextDelta" && params.delta) {
      emit({ type: "reasoning", delta: params.delta });
    } else if (message.method === "item/agentMessage/delta" && params.delta) {
      finalText += params.delta;
    } else if (message.method === "item/completed" && params.item?.type === "agentMessage" && params.item.text) {
      finalText = params.item.text;
    } else if (message.method === "thread/tokenUsage/updated") {
      emit({ type: "usage", usage: params.tokenUsage || params.usage || params });
    } else if (message.method === "error") {
      turnError = params.error || params;
    } else if (message.method === "turn/completed" && (!turnId || params.turn?.id === turnId)) {
      if (params.turn?.error) {
        turnError = params.turn.error;
      }
      completed(params.turn);
    }
  });
  try {
    const started = await rpc.request("turn/start", {
      threadId,
      input: [{ type: "text", text: modelPrompt(payload), text_elements: [] }],
      model: codexModel,
      effort: codexEffort,
      summary: "concise",
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "readOnly",
        networkAccess: false,
      },
      outputSchema,
    });
    turnId = started.turn.id;
    activeTurn = { requestId: payload.requestId, threadId, turnId };
    try {
      await Promise.race([
        done,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Object.assign(new Error("Ability generation timed out"), { fallback: true })),
            120_000,
          ),
        ),
      ]);
    } catch (error) {
      await rpc.request("turn/interrupt", { threadId, turnId }).catch(() => {});
      throw error;
    }
    if (turnError) {
      const info = errorInfo(turnError);
      const fallbackMessage = /network|connection|timed out|temporarily unavailable/i.test(info.message);
      throw Object.assign(new Error(info.message), {
        fallback:
          fallbackMessage
          || ["UsageLimitExceeded", "Unauthorized", "HttpConnectionFailed", "ResponseStreamConnectionFailed"].includes(
            info.type,
          ),
        reauthRequired: info.type === "Unauthorized",
      });
    }
    const result = stripNulls(extractJson(finalText));
    validateSources(result, payload);
    return result;
  } finally {
    activeTurn = null;
    unsubscribe();
    await rpc.request("thread/delete", { threadId }).catch(() => {});
  }
}

async function runNim(payload, emit) {
  if (!nimKey) {
    throw new Error("The ability builder is temporarily unavailable");
  }
  emit({ type: "status", message: "Retrying the request" });
  const response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${nimKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
    },
    body: JSON.stringify({
      model: nimModel,
      messages: [
        {
          role: "system",
          content:
            "Return only one JSON object matching the requested schema. Do not include markdown or hidden reasoning.",
        },
        { role: "user", content: `${modelPrompt(payload)}\n\nOUTPUT JSON SCHEMA:\n${JSON.stringify(outputSchema)}` },
      ],
      temperature: 0.1,
      max_tokens: 6000,
      stream: true,
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`The ability builder could not complete the request (${response.status})`);
  }
  const reader = response.body.getReader();
  const textDecoder = new TextDecoder();
  let buffer = "";
  let content = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += textDecoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, "");
      if (!data || data === "[DONE]") {
        continue;
      }
      try {
        const event = JSON.parse(data);
        content += event.choices?.[0]?.delta?.content || "";
      } catch {}
    }
  }
  const result = stripNulls(extractJson(content.replace(/<think>[\s\S]*?<\/think>/gi, "")));
  validateSources(result, payload);
  return result;
}

function validateGeneratePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw Object.assign(new Error("Invalid request"), { status: 400 });
  }
  if (typeof payload.prompt !== "string" || payload.prompt.trim().length < 3 || payload.prompt.length > 4000) {
    throw Object.assign(new Error("Describe the ability in 3-4000 characters"), { status: 400 });
  }
  if (!Array.isArray(payload.abilityIndex) || !Array.isArray(payload.componentCandidates)) {
    throw Object.assign(new Error("Ability catalog context is missing"), { status: 400 });
  }
  payload.prompt = payload.prompt.trim();
  payload.requestId = typeof payload.requestId === "string" ? payload.requestId : randomUUID();
  return payload;
}

async function generate(request, response) {
  if (generationBusy) {
    return writeJson(response, { error: "Another ability is currently being generated" }, 409);
  }
  const payload = validateGeneratePayload(JSON.parse(await readBody(request)));
  if (generationBusy) {
    return writeJson(response, { error: "Another ability is currently being generated" }, 409);
  }
  generationBusy = true;
  response.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Accel-Buffering": "no",
  });
  const emit = event => ndjson(response, event);
  try {
    emit({ type: "status", message: "Matching the request to available ability components" });
    let result;
    try {
      result = await runCodex(payload, emit);
    } catch (error) {
      if (error.fallback && nimKey) {
        result = await runNim(payload, emit);
      } else {
        throw error;
      }
    }
    emit({ type: "result", ...result });
  } catch (error) {
    emit({
      type: "error",
      message: error.message || String(error),
    });
  } finally {
    generationBusy = false;
    response.end();
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  try {
    if (request.method === "GET" && url.pathname === "/internal/instance") {
      response.writeHead(200, { "Content-Type": "text/plain", "Cache-Control": "no-store" });
      return response.end(instanceId);
    }
    if (request.method === "POST" && url.pathname === "/internal/auth/restore") {
      const auth = await readBody(request, 1_048_576);
      await mkdir(codexHome, { recursive: true });
      if (auth) {
        JSON.parse(auth);
        const temporaryPath = `${authPath}.${randomUUID()}.tmp`;
        await writeFile(temporaryPath, auth, { mode: 0o600 });
        await rename(temporaryPath, authPath);
      }
      return writeJson(response, { restored: Boolean(auth) });
    }
    if (request.method === "GET" && url.pathname === "/internal/auth/export") {
      try {
        const auth = await readFile(authPath, "utf8");
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        return response.end(auth);
      } catch (error) {
        if (error.code === "ENOENT") {
          response.writeHead(204, { "Cache-Control": "no-store" });
          return response.end();
        }
        throw error;
      }
    }
    if (request.method === "POST" && url.pathname === "/generate") {
      return await generate(request, response);
    }
    if (request.method === "POST" && url.pathname === "/cancel") {
      const payload = JSON.parse((await readBody(request, 16_384)) || "{}");
      if (activeTurn && (!payload.requestId || payload.requestId === activeTurn.requestId)) {
        await rpc
          .request("turn/interrupt", { threadId: activeTurn.threadId, turnId: activeTurn.turnId })
          .catch(() => {});
      }
      return writeJson(response, { cancelled: true });
    }
    writeJson(response, { error: "Not found" }, 404);
  } catch (error) {
    writeJson(response, { error: error.message || String(error) }, error.status || 500);
  }
});

server.listen(port, "0.0.0.0");

process.on("SIGTERM", async () => {
  try {
    await unlink(`${authPath}.tmp`);
  } catch {}
  server.close(() => process.exit(0));
});
