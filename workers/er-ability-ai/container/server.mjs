import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import readline from "node:readline";

const port = Number(process.env.PORT || 8080);
const codexHome = process.env.CODEX_HOME || "/var/lib/ability-ai/codex";
const codexBin = process.env.CODEX_BIN || "codex";
const codexCwd = process.env.CODEX_CWD || "/srv/empty";
const authPath = `${codexHome}/auth.json`;
const instanceId = randomUUID();
const codexModel = process.env.CODEX_MODEL || "gpt-5.6-luna";
const codexEffort = process.env.CODEX_EFFORT || "high";
const nimModel = process.env.NVIDIA_NIM_MODEL || "nvidia/nemotron-3-nano-30b-a3b";
const nimFallbackModel = process.env.NVIDIA_NIM_FALLBACK_MODEL || "deepseek-ai/deepseek-v4-flash-0731";
const nimKey = process.env.NVIDIA_NIM_API_KEY || "";
const maxGenerateBodyBytes = 8_388_608;
let activeTurn = null;
let generationBusy = false;

const parameterValueSchema = {
  anyOf: [
    { type: "string" },
    { type: "number" },
    { type: "boolean" },
    { type: "null" },
    { type: "array", items: { type: "string" }, maxItems: 32 },
    { type: "array", items: { type: "number" }, maxItems: 32 },
    { type: "array", items: { type: "boolean" }, maxItems: 32 },
  ],
};

const parameterOverridesSchema = {
  type: "object",
  additionalProperties: parameterValueSchema,
};

const sourceSchema = {
  type: "object",
  properties: {
    abilityId: { type: "integer", minimum: 1 },
    attrIndex: { type: "integer", minimum: 0 },
    attrType: { type: "string", minLength: 2, maxLength: 120 },
    parameterOverrides: parameterOverridesSchema,
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
    parameterOverrides: parameterOverridesSchema,
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
    kind: { type: "string", enum: ["holder-hp", "holder-status", "other-status", "weather", "terrain", "move"] },
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
    kind: {
      type: "string",
      enum: ["stat-stage", "status", "heal-percent", "cure-status", "set-weather", "set-terrain"],
    },
    target: { enum: [null, "holder", "other", "holder-side", "opposing-side"] },
    stat: { enum: [null, "ATK", "DEF", "SPATK", "SPDEF", "SPD", "ACC", "EVA"] },
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
    kind: { type: "string", enum: ["move-power", "received-damage", "stat-multiplier", "priority"] },
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
              trigger: {
                type: "string",
                enum: ["on-entry", "after-attack", "after-hit", "after-ko", "end-turn", "after-faint"],
              },
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

const _catalogSearchPlanSchema = {
  type: "object",
  properties: {
    queries: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["components", "abilities", "moves"] },
          role: { type: "string", enum: ["any", "hook", "condition", "effect", "parameter"] },
          query: { type: "string", minLength: 2, maxLength: 120 },
          limit: { type: "integer", minimum: 1, maximum: 24 },
        },
        required: ["scope", "role", "query", "limit"],
        additionalProperties: false,
      },
    },
  },
  required: ["queries"],
  additionalProperties: false,
};

const componentPartSelectionSchema = {
  type: "object",
  properties: {
    componentId: { type: "string", pattern: "^c[0-9]+$" },
    partIndex: { type: ["integer", "null"], minimum: 0 },
    parameterOverrides: parameterOverridesSchema,
  },
  required: ["componentId", "partIndex", "parameterOverrides"],
  additionalProperties: false,
};

const assemblyPlanSchema = {
  type: "object",
  properties: {
    explanation: { type: "string", minLength: 1, maxLength: 1000 },
    draft: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 2, maxLength: 40 },
        description: { type: "string", minLength: 2, maxLength: 500 },
        generation: { type: "integer", minimum: 1, maximum: 9 },
        includes: { type: "array", items: { type: "integer", minimum: 1 }, maxItems: 12 },
        componentRules: {
          type: "array",
          maxItems: 32,
          items: {
            type: "object",
            properties: {
              key: { type: "string", pattern: "^[a-z0-9-]{1,48}$" },
              prerequisiteHooks: { type: "array", items: componentPartSelectionSchema, maxItems: 7 },
              hook: componentPartSelectionSchema,
              chance: { type: "number", minimum: 1, maximum: 100 },
              conditionLogic: { type: "string", enum: ["all", "any"] },
              conditions: {
                type: "array",
                items: { anyOf: [componentPartSelectionSchema, simpleConditionSchema] },
                maxItems: 16,
              },
              effects: {
                type: "array",
                items: { anyOf: [componentPartSelectionSchema, simpleEffectSchema] },
                minItems: 1,
                maxItems: 8,
              },
            },
            required: ["key", "prerequisiteHooks", "hook", "chance", "conditionLogic", "conditions", "effects"],
            additionalProperties: false,
          },
        },
        rules: outputSchema.properties.blueprint.properties.rules,
        modifiers: outputSchema.properties.blueprint.properties.modifiers,
        flags: outputSchema.properties.blueprint.properties.flags,
      },
      required: ["name", "description", "generation", "includes", "componentRules", "rules", "modifiers", "flags"],
      additionalProperties: false,
    },
  },
  required: ["explanation", "draft"],
  additionalProperties: false,
};

function componentIdsForRole(searchContext, role) {
  return searchContext.components
    .filter(component => {
      if (role === "hook") {
        return component.selectableParts.hook;
      }
      const indexes =
        role === "condition" ? component.selectableParts.conditionIndexes : component.selectableParts.effectIndexes;
      return indexes.length > 0;
    })
    .map(component => component.componentId);
}

function componentSelectionSchemaForRole(searchContext, role) {
  const componentIds = componentIdsForRole(searchContext, role);
  const variants = [];
  for (const component of searchContext.components) {
    if (!componentIds.includes(component.componentId)) {
      continue;
    }
    const schema = structuredClone(componentPartSelectionSchema);
    schema.properties.componentId.enum = [component.componentId];
    schema.properties.partIndex.enum =
      role === "hook"
        ? [null]
        : role === "condition"
          ? component.selectableParts.conditionIndexes
          : component.selectableParts.effectIndexes;
    const parameterProperties = {};
    for (const parameter of component.rule.parameters || []) {
      if (parameter.path) {
        parameterProperties[parameter.path] = parameterValueSchema;
      }
    }
    schema.properties.parameterOverrides = {
      type: "object",
      properties: parameterProperties,
      additionalProperties: false,
    };
    variants.push(schema);
  }
  return variants.length > 0 ? { anyOf: variants } : null;
}

function catalogEnum(values, extras = []) {
  return [...new Set([null, ...extras, ...(values || [])])];
}

function primitiveSchemasForCatalog(catalog) {
  const conditionSchema = structuredClone(simpleConditionSchema);
  conditionSchema.properties.status.enum = catalogEnum(catalog.statuses, ["NONE"]);
  conditionSchema.properties.weather.enum = catalogEnum(catalog.weathers);
  conditionSchema.properties.terrain.enum = catalogEnum(catalog.terrains);
  conditionSchema.properties.filter.properties.type.enum = catalogEnum(catalog.types);
  conditionSchema.properties.filter.properties.category.enum = catalogEnum(catalog.categories);
  conditionSchema.properties.filter.properties.flag.enum = catalogEnum(catalog.moveFlags);

  const effectSchema = structuredClone(simpleEffectSchema);
  effectSchema.properties.status.enum = catalogEnum(catalog.statuses, ["NONE", "ANY"]);
  effectSchema.properties.weather.enum = catalogEnum(catalog.weathers);
  effectSchema.properties.terrain.enum = catalogEnum(catalog.terrains);

  const modifierSchemaForCatalog = structuredClone(modifierSchema);
  modifierSchemaForCatalog.properties.stat.enum = catalogEnum(catalog.statMultiplierStats);
  modifierSchemaForCatalog.properties.filter.properties.type.enum = catalogEnum(catalog.types);
  modifierSchemaForCatalog.properties.filter.properties.category.enum = catalogEnum(catalog.categories);
  modifierSchemaForCatalog.properties.filter.properties.flag.enum = catalogEnum(catalog.moveFlags);
  return { conditionSchema, effectSchema, modifierSchema: modifierSchemaForCatalog };
}

function isPrimitiveStatRuleRequest(payload) {
  const prompt = normalizedSearchText(payload.prompt);
  const namesAbility = (payload.abilityIndex || []).some(ability => {
    const name = normalizedSearchText(ability.name);
    return name.length >= 3 && prompt.includes(name);
  });
  return (
    requestedMoveEntries(payload).length === 0
    && !namesAbility
    && /\b(?:raise|lower|boost|drop|increase|decrease)\b/.test(prompt)
    && /\b(?:attack|defense|special attack|special defense|speed|accuracy|evasion|atk|def|spatk|spdef|spd)\b/.test(
      prompt,
    )
  );
}

function assemblyPlanSchemaForSearch(searchContext, catalog, payload) {
  const schema = structuredClone(assemblyPlanSchema);
  const ruleProperties = schema.properties.draft.properties.componentRules.items.properties;
  const hookSchema = componentSelectionSchemaForRole(searchContext, "hook");
  const componentConditionSchema = componentSelectionSchemaForRole(searchContext, "condition");
  const componentEffectSchema = componentSelectionSchemaForRole(searchContext, "effect");
  const primitiveSchemas = primitiveSchemasForCatalog(catalog);
  ruleProperties.prerequisiteHooks.items = hookSchema || componentPartSelectionSchema;
  ruleProperties.hook = hookSchema || componentPartSelectionSchema;
  ruleProperties.conditions.items.anyOf = componentConditionSchema
    ? [componentConditionSchema, primitiveSchemas.conditionSchema]
    : [primitiveSchemas.conditionSchema];
  ruleProperties.effects.items.anyOf = componentEffectSchema
    ? [componentEffectSchema, primitiveSchemas.effectSchema]
    : [primitiveSchemas.effectSchema];
  const primitiveRuleProperties = schema.properties.draft.properties.rules.items.properties;
  primitiveRuleProperties.conditions.items = primitiveSchemas.conditionSchema;
  primitiveRuleProperties.effects.items = primitiveSchemas.effectSchema;
  schema.properties.draft.properties.modifiers.items = primitiveSchemas.modifierSchema;
  if (isPrimitiveStatRuleRequest(payload)) {
    schema.properties.draft.properties.componentRules = { type: "array", maxItems: 0 };
  }
  return schema;
}

const _blueprintExamples = [
  {
    explanation: "Burn contact targets after attacking.",
    blueprint: {
      version: 1,
      id: 20000,
      name: "Cinder Touch",
      description: "After this Pokemon lands a damaging contact Fire-type move, it burns the target.",
      generation: 9,
      includes: [],
      mechanics: [],
      componentRules: [],
      rules: [
        {
          key: "burn-contact-target",
          trigger: "after-attack",
          chance: 100,
          conditionLogic: "all",
          conditions: [
            {
              kind: "move",
              minPercent: null,
              maxPercent: null,
              status: null,
              weather: null,
              terrain: null,
              filter: { type: "FIRE", category: null, flag: "MAKES_CONTACT", damaging: true },
            },
          ],
          effects: [
            {
              kind: "status",
              target: "other",
              stat: null,
              stages: null,
              status: "BURN",
              percent: null,
              weather: null,
              terrain: null,
            },
          ],
        },
      ],
      modifiers: [],
      flags: { bypassFaint: false, ignorable: false, unsuppressable: false, uncopiable: false, unreplaceable: false },
    },
  },
  {
    explanation: "Arm a scripted Eruption while the holder is at low HP, then use it after attacking.",
    blueprint: {
      version: 1,
      id: 20001,
      name: "Critical Eruption",
      description: "At low HP, this Pokemon follows its attack with a 50 BP Eruption.",
      generation: 9,
      includes: [],
      mechanics: [],
      componentRules: [
        {
          key: "low-hp-eruption",
          prerequisiteHooks: [{ abilityId: 66, attrIndex: 0, attrType: "LowHpMoveTypePowerBoostAbAttr" }],
          hook: { abilityId: 5119, attrIndex: 0, attrType: "PostAttackScriptedMoveAbAttr" },
          chance: 100,
          conditionLogic: "all",
          conditions: [
            {
              abilityId: 66,
              attrIndex: 0,
              attrType: "LowHpMoveTypePowerBoostAbAttr",
              kind: "holder",
              conditionIndex: null,
            },
            {
              abilityId: 5119,
              attrIndex: 0,
              attrType: "PostAttackScriptedMoveAbAttr",
              kind: "event",
              conditionIndex: null,
            },
          ],
          effects: [
            {
              abilityId: 5119,
              attrIndex: 0,
              attrType: "PostAttackScriptedMoveAbAttr",
              parameterOverrides: { "opts.moveId": 284, "opts.power": 50 },
            },
          ],
        },
      ],
      rules: [],
      modifiers: [],
      flags: { bypassFaint: false, ignorable: false, unsuppressable: false, uncopiable: false, unreplaceable: false },
    },
  },
  {
    explanation: "Combine two complete abilities and add a filtered passive modifier.",
    blueprint: {
      version: 1,
      id: 20002,
      name: "Blazing Dancer",
      description: "Has the complete effects of Blaze and Dancer, and further strengthens Fire-type moves.",
      generation: 9,
      includes: [66, 216],
      mechanics: [],
      componentRules: [],
      rules: [],
      modifiers: [
        {
          kind: "move-power",
          multiplier: 1.2,
          stat: null,
          amount: null,
          filter: { type: "FIRE", category: null, flag: null, damaging: true },
        },
      ],
      flags: { bypassFaint: false, ignorable: false, unsuppressable: false, uncopiable: false, unreplaceable: false },
    },
  },
];

function writeJson(response, value, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function readBody(request, limit = maxGenerateBodyBytes) {
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
    this.child = spawn(codexBin, ["app-server"], {
      cwd: codexCwd,
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
      capabilities: { experimentalApi: true },
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

function extractJson(text, source = "primary model", fallback = true) {
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
      try {
        return JSON.parse(trimmed.slice(start, end + 1));
      } catch {}
    }
    const detail = trimmed.length === 0 ? "the response was empty" : "the response was not valid JSON";
    throw Object.assign(new Error(`The ${source} could not produce a valid ability blueprint: ${detail}`), {
      fallback,
    });
  }
}

function messageContentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map(part => {
      if (typeof part === "string") {
        return part;
      }
      if (typeof part?.text === "string") {
        return part.text;
      }
      if (typeof part?.content === "string") {
        return part.content;
      }
      return "";
    })
    .join("");
}

function completedTurnText(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index];
    if (item?.type === "agentMessage" && typeof item.text === "string" && item.text.trim()) {
      return item.text;
    }
  }
  return "";
}

function sourceKey(source) {
  return `${source.abilityId}:${source.attrIndex}:${source.attrType}`;
}

function validateParameterOverrides(source, parameters, payload, label) {
  const overrides = source.parameterOverrides;
  if (overrides === undefined) {
    return;
  }
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new Error(`${label} parameter overrides must be an object`);
  }
  if (Object.keys(overrides).length > 32) {
    throw new Error(`${label} has too many parameter overrides`);
  }
  const definitions = new Map((parameters || []).map(parameter => [parameter.path || parameter.key, parameter]));
  const moveIds = new Set((payload.moveIndex || []).map(move => Number(move.id)));
  for (const [path, value] of Object.entries(overrides)) {
    const parameter = definitions.get(path);
    const options = parameter?.options || payload.componentOptionSets?.[parameter?.optionsRef] || [];
    if (!parameter?.editable) {
      throw new Error(`${label} cannot override ${path}`);
    }
    if (value === null) {
      if (!parameter.optional) {
        throw new Error(`${label} cannot clear ${path}`);
      }
      continue;
    }
    if (parameter.control === "move") {
      if (!Number.isInteger(value) || !moveIds.has(value)) {
        throw new Error(`${label}.${path} is not an available move id`);
      }
    } else if (parameter.control === "move-list") {
      if (!Array.isArray(value) || value.some(item => !Number.isInteger(item) || !moveIds.has(item))) {
        throw new Error(`${label}.${path} contains an unavailable move id`);
      }
    } else if (parameter.control === "number") {
      if (
        typeof value !== "number"
        || !Number.isFinite(value)
        || (parameter.min !== undefined && value < parameter.min)
        || (parameter.max !== undefined && value > parameter.max)
      ) {
        throw new Error(`${label}.${path} is outside its valid range`);
      }
    } else if (parameter.control === "number-list") {
      if (
        !Array.isArray(value)
        || value.length === 0
        || value.some(
          item =>
            typeof item !== "number"
            || !Number.isFinite(item)
            || (parameter.min !== undefined && item < parameter.min)
            || (parameter.max !== undefined && item > parameter.max),
        )
      ) {
        throw new Error(`${label}.${path} contains an invalid number`);
      }
    } else if (parameter.control === "boolean") {
      if (typeof value !== "boolean") {
        throw new Error(`${label}.${path} must be boolean`);
      }
    } else if (parameter.control === "select") {
      if (!options.some(option => option.value === value)) {
        throw new Error(`${label}.${path} is not an available option`);
      }
    } else if (parameter.control === "multi-select") {
      if (!Array.isArray(value) || value.some(item => !options.some(option => option.value === item))) {
        throw new Error(`${label}.${path} contains an unavailable option`);
      }
    } else {
      throw new Error(`${label}.${path} is not safely configurable`);
    }
  }
}

function requireCatalogValue(values, value, label) {
  if (value != null && !values.includes(value)) {
    throw new Error(`${label} is not available`);
  }
}

function validateMoveFilter(filter, catalog, label) {
  if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
    throw new Error(`${label} must define a move filter`);
  }
  requireCatalogValue(catalog.types || [], filter.type, `${label}.type`);
  requireCatalogValue(catalog.categories || [], filter.category, `${label}.category`);
  requireCatalogValue(catalog.moveFlags || [], filter.flag, `${label}.flag`);
  if (filter.damaging != null && typeof filter.damaging !== "boolean") {
    throw new Error(`${label}.damaging must be boolean`);
  }
}

function validateSimpleCondition(condition, catalog, label) {
  requireCatalogValue(catalog.conditionKinds || [], condition.kind, `${label}.kind`);
  if (condition.kind === "move") {
    validateMoveFilter(condition.filter, catalog, `${label}.filter`);
  }
  if ((condition.kind === "holder-status" || condition.kind === "other-status") && condition.status !== "NONE") {
    requireCatalogValue(catalog.statuses || [], condition.status, `${label}.status`);
  }
  if (condition.kind === "weather") {
    requireCatalogValue(catalog.weathers || [], condition.weather, `${label}.weather`);
  }
  if (condition.kind === "terrain") {
    requireCatalogValue(catalog.terrains || [], condition.terrain, `${label}.terrain`);
  }
  for (const key of ["minPercent", "maxPercent"]) {
    if (condition[key] != null && (typeof condition[key] !== "number" || condition[key] < 0 || condition[key] > 100)) {
      throw new Error(`${label}.${key} must be 0-100`);
    }
  }
}

function validateSimpleEffect(effect, catalog, label) {
  requireCatalogValue(catalog.effectKinds || [], effect.kind, `${label}.kind`);
  if (effect.target != null) {
    requireCatalogValue(catalog.targets || [], effect.target, `${label}.target`);
  }
  if (effect.kind === "stat-stage") {
    requireCatalogValue(catalog.stats || [], effect.stat, `${label}.stat`);
    if (!Number.isInteger(effect.stages) || effect.stages === 0 || Math.abs(effect.stages) > 6) {
      throw new Error(`${label}.stages must be a non-zero integer from -6 to 6`);
    }
  } else if (effect.kind === "status") {
    requireCatalogValue(catalog.statuses || [], effect.status, `${label}.status`);
  } else if (effect.kind === "heal-percent") {
    if (typeof effect.percent !== "number" || effect.percent < 1 || effect.percent > 100) {
      throw new Error(`${label}.percent must be 1-100`);
    }
  } else if (effect.kind === "set-weather") {
    requireCatalogValue(catalog.weathers || [], effect.weather, `${label}.weather`);
  } else if (effect.kind === "set-terrain") {
    requireCatalogValue(catalog.terrains || [], effect.terrain, `${label}.terrain`);
  }
}

function validateModifier(modifier, catalog, label) {
  requireCatalogValue(catalog.modifierKinds || [], modifier.kind, `${label}.kind`);
  if (modifier.kind === "move-power" || modifier.kind === "received-damage") {
    if (typeof modifier.multiplier !== "number" || !Number.isFinite(modifier.multiplier)) {
      throw new Error(`${label}.multiplier must be a number`);
    }
    validateMoveFilter(modifier.filter, catalog, `${label}.filter`);
  } else if (modifier.kind === "stat-multiplier") {
    requireCatalogValue(catalog.statMultiplierStats || [], modifier.stat, `${label}.stat`);
    if (typeof modifier.multiplier !== "number" || !Number.isFinite(modifier.multiplier)) {
      throw new Error(`${label}.multiplier must be a number`);
    }
  } else if (modifier.kind === "priority" && !Number.isInteger(modifier.amount)) {
    throw new Error(`${label}.amount must be an integer`);
  }
}

function validateBlueprintShape(result, payload) {
  const blueprint = result?.blueprint;
  const catalog = payload.primitiveCatalog || {};
  if (!blueprint || typeof blueprint !== "object" || Array.isArray(blueprint)) {
    throw new Error("The model did not return an ability blueprint");
  }
  if (typeof result.explanation !== "string" || result.explanation.trim().length === 0) {
    throw new Error("The model did not explain the generated draft");
  }
  if (blueprint.version !== 1 || !Number.isInteger(blueprint.id) || blueprint.id < 20000 || blueprint.id > 29999) {
    throw new Error("The model returned invalid blueprint identity fields");
  }
  if (typeof blueprint.name !== "string" || blueprint.name.trim().length < 2 || blueprint.name.length > 40) {
    throw new Error("The model returned an invalid ability name");
  }
  if (
    typeof blueprint.description !== "string"
    || blueprint.description.trim().length < 2
    || blueprint.description.length > 500
  ) {
    throw new Error("The model returned an invalid ability description");
  }
  const limits = { includes: 12, mechanics: 64, componentRules: 32, rules: 24, modifiers: 24 };
  for (const [key, limit] of Object.entries(limits)) {
    if (!Array.isArray(blueprint[key]) || blueprint[key].length > limit) {
      throw new Error(`The model returned an invalid ${key} list`);
    }
  }
  if (Object.keys(limits).every(key => blueprint[key].length === 0)) {
    throw new Error("The model returned an empty ability blueprint");
  }
  const componentKeys = new Set();
  for (const [index, rule] of blueprint.componentRules.entries()) {
    if (!rule || typeof rule !== "object" || !/^[a-z0-9-]{1,48}$/.test(rule.key) || componentKeys.has(rule.key)) {
      throw new Error(`Component rule ${index + 1} has an invalid key`);
    }
    componentKeys.add(rule.key);
    if (!rule.hook || !Array.isArray(rule.prerequisiteHooks) || !Array.isArray(rule.conditions)) {
      throw new Error(`Component rule ${index + 1} is incomplete`);
    }
    if (!Array.isArray(rule.effects) || rule.effects.length === 0) {
      throw new Error(`Component rule ${index + 1} has no effects`);
    }
    if (rule.chance < 1 || rule.chance > 100 || !["all", "any"].includes(rule.conditionLogic)) {
      throw new Error(`Component rule ${index + 1} has invalid execution settings`);
    }
    for (const [conditionIndex, condition] of rule.conditions.entries()) {
      if (!Number.isInteger(condition.abilityId)) {
        validateSimpleCondition(condition, catalog, `Component rule ${index + 1} condition ${conditionIndex + 1}`);
      }
    }
    for (const [effectIndex, effect] of rule.effects.entries()) {
      if (!Number.isInteger(effect.abilityId)) {
        validateSimpleEffect(effect, catalog, `Component rule ${index + 1} effect ${effectIndex + 1}`);
      }
    }
  }
  const ruleKeys = new Set();
  for (const [index, rule] of blueprint.rules.entries()) {
    if (!rule || typeof rule !== "object" || !/^[a-z0-9-]{1,40}$/.test(rule.key) || ruleKeys.has(rule.key)) {
      throw new Error(`Rule ${index + 1} has an invalid key`);
    }
    ruleKeys.add(rule.key);
    requireCatalogValue(catalog.triggers || [], rule.trigger, `Rule ${index + 1}.trigger`);
    if (rule.chance < 1 || rule.chance > 100 || !["all", "any"].includes(rule.conditionLogic)) {
      throw new Error(`Rule ${index + 1} has invalid execution settings`);
    }
    if (!Array.isArray(rule.conditions) || !Array.isArray(rule.effects) || rule.effects.length === 0) {
      throw new Error(`Rule ${index + 1} is incomplete`);
    }
    rule.conditions.forEach((condition, conditionIndex) =>
      validateSimpleCondition(condition, catalog, `Rule ${index + 1} condition ${conditionIndex + 1}`),
    );
    rule.effects.forEach((effect, effectIndex) =>
      validateSimpleEffect(effect, catalog, `Rule ${index + 1} effect ${effectIndex + 1}`),
    );
  }
  blueprint.modifiers.forEach((modifier, index) => validateModifier(modifier, catalog, `Modifier ${index + 1}`));
}

function validateSources(result, payload) {
  validateBlueprintShape(result, payload);
  const abilityIds = new Set((payload.abilityIndex || []).map(ability => Number(ability.id)));
  const hooks = new Map();
  const conditions = new Map();
  const effects = new Map();
  for (const ability of payload.componentCandidates || []) {
    for (const rule of ability.rules || []) {
      hooks.set(sourceKey(rule.source), { hook: rule.hook, parameters: rule.parameters });
      for (const condition of rule.conditions || []) {
        conditions.set(`${sourceKey(condition.source)}:${condition.kind}:${condition.source.conditionIndex ?? ""}`, {
          condition,
          hook: rule.hook,
          parameters: rule.parameters,
        });
      }
      for (const effect of rule.effects || []) {
        effects.set(sourceKey(effect.source), {
          effect,
          hook: rule.hook,
          parameters: effect.parameters || rule.parameters,
        });
      }
    }
  }
  const blueprint = result.blueprint;
  for (const id of blueprint.includes || []) {
    if (!abilityIds.has(Number(id))) {
      throw new Error(`The model referenced unknown ability #${id}`);
    }
  }
  const componentRuleKeys = new Set((blueprint.componentRules || []).map(rule => rule.key));
  const migratedMechanics = (blueprint.mechanics || []).map((source, index) => {
    const key = sourceKey(source);
    const hook = hooks.get(key);
    const effect = effects.get(key);
    if (!hook || !effect) {
      throw new Error(`The model referenced an unavailable runtime component (${key})`);
    }
    validateParameterOverrides(source, effect.parameters || hook.parameters, payload, `DO ${key}`);
    let ruleKey = `ai-mechanic-${index + 1}`;
    while (componentRuleKeys.has(ruleKey)) {
      ruleKey = `${ruleKey}-migrated`;
    }
    componentRuleKeys.add(ruleKey);
    return {
      key: ruleKey,
      prerequisiteHooks: [],
      hook: {
        abilityId: source.abilityId,
        attrIndex: source.attrIndex,
        attrType: source.attrType,
      },
      chance: 100,
      conditionLogic: "all",
      conditions: [],
      effects: [{ ...source }],
    };
  });
  blueprint.mechanics = [];
  blueprint.componentRules = [...(blueprint.componentRules || []), ...migratedMechanics];
  for (const rule of blueprint.componentRules || []) {
    for (const hook of [...(rule.prerequisiteHooks || []), rule.hook]) {
      const candidate = hooks.get(sourceKey(hook));
      if (!candidate) {
        throw new Error(`The model referenced an unavailable WHEN component (${sourceKey(hook)})`);
      }
      validateParameterOverrides(hook, candidate.parameters, payload, `WHEN ${sourceKey(hook)}`);
    }
    for (const condition of rule.conditions || []) {
      if (!Number.isInteger(condition.abilityId)) {
        continue;
      }
      if (condition.kind && condition.kind !== "ability") {
        condition.conditionIndex = undefined;
      }
      const key = `${sourceKey(condition)}:${condition.kind}:${condition.conditionIndex ?? ""}`;
      const candidate = conditions.get(key);
      if (!candidate) {
        throw new Error(`The model referenced an unavailable IF component (${key})`);
      }
      validateParameterOverrides(condition, candidate.parameters, payload, `IF ${key}`);
    }
    for (const effect of rule.effects || []) {
      if (!Number.isInteger(effect.abilityId)) {
        continue;
      }
      const candidate = effects.get(sourceKey(effect));
      if (!candidate) {
        throw new Error(`The model referenced an unavailable DO component (${sourceKey(effect)})`);
      }
      validateParameterOverrides(effect, candidate.parameters, payload, `DO ${sourceKey(effect)}`);
    }
  }
}

function requestedMoveIds(payload) {
  const prompt = normalizedSearchText(payload.prompt);
  return (payload.moveIndex || [])
    .filter(move => {
      const name = normalizedSearchText(move.name);
      return name.length >= 3 && prompt.includes(name);
    })
    .map(move => Number(move.id));
}

function blueprintMoveIds(result, payload) {
  const parametersBySource = new Map();
  for (const ability of payload.componentCandidates) {
    for (const rule of ability.rules || []) {
      parametersBySource.set(sourceKey(rule.source), rule.parameters || []);
      for (const condition of rule.conditions || []) {
        parametersBySource.set(sourceKey(condition.source), rule.parameters || []);
      }
      for (const effect of rule.effects || []) {
        parametersBySource.set(sourceKey(effect.source), effect.parameters || rule.parameters || []);
      }
    }
  }
  const ids = new Set();
  const collect = source => {
    if (!source) {
      return;
    }
    for (const parameter of parametersBySource.get(sourceKey(source)) || []) {
      if (parameter.control !== "move" && parameter.control !== "move-list") {
        continue;
      }
      const path = parameter.path || parameter.key;
      const value = Object.hasOwn(source.parameterOverrides || {}, path)
        ? source.parameterOverrides[path]
        : Object.hasOwn(parameter, "rawValue")
          ? parameter.rawValue
          : parameter.value;
      for (const moveId of Array.isArray(value) ? value : [value]) {
        if (Number.isInteger(Number(moveId))) {
          ids.add(Number(moveId));
        }
      }
    }
  };
  for (const rule of result.blueprint.componentRules || []) {
    collect(rule.hook);
    rule.conditions?.forEach(collect);
    rule.effects?.forEach(collect);
  }
  return ids;
}

function requestedStatChanges(prompt) {
  const statIds = {
    accuracy: "ACC",
    attack: "ATK",
    defense: "DEF",
    evasion: "EVA",
    "special attack": "SPATK",
    "special defense": "SPDEF",
    speed: "SPD",
  };
  const changes = [];
  const pattern =
    /\b(raise|raises|boost|boosts|increase|increases|lower|lowers|drop|drops)\b([^.;,]{0,60}?)\b(special attack|special defense|attack|defense|speed|accuracy|evasion)\b\s+by\s+(\d+)\s+stages?/gi;
  for (const match of prompt.matchAll(pattern)) {
    const direction = /^(?:lower|lowers|drop|drops)$/i.test(match[1]) ? -1 : 1;
    const target = /\b(?:target|opponent|foe|enemy)\b/i.test(match[2]) ? "other" : "holder";
    changes.push({ target, stat: statIds[match[3].toLowerCase()], stages: direction * Number(match[4]) });
  }
  return changes;
}

function blueprintHasStatChange(result, expected) {
  return (result.blueprint.rules || []).some(rule =>
    (rule.effects || []).some(
      effect =>
        effect.kind === "stat-stage"
        && effect.target === expected.target
        && effect.stat === expected.stat
        && Number(effect.stages) === expected.stages,
    ),
  );
}

function blueprintMovePower(result, moveId) {
  const sources = [];
  for (const rule of result.blueprint.componentRules || []) {
    sources.push(rule.hook, ...(rule.prerequisiteHooks || []), ...(rule.conditions || []), ...(rule.effects || []));
  }
  for (const source of sources) {
    const overrides = source?.parameterOverrides || {};
    const moveEntry = Object.entries(overrides).find(([path]) => /(?:^|\.)(?:move|moveId)$/i.test(path));
    if (Number(moveEntry?.[1]) !== moveId) {
      continue;
    }
    const powerEntry = Object.entries(overrides).find(([path]) => /(?:power|basePower)$/i.test(path));
    if (powerEntry) {
      return Number(powerEntry[1]);
    }
  }
  return null;
}

function validatePromptRequirements(result, payload) {
  const prompt = normalizedSearchText(payload.prompt);
  for (const abilityId of result.blueprint.includes || []) {
    const ability = payload.abilityIndex.find(candidate => Number(candidate.id) === Number(abilityId));
    const name = normalizedSearchText(ability?.name);
    if (!name || !prompt.includes(name)) {
      throw new Error(`Generated draft included unrelated ability ${ability?.name || abilityId}`);
    }
  }
  for (const expected of requestedStatChanges(payload.prompt)) {
    if (!blueprintHasStatChange(result, expected)) {
      throw new Error(
        `Generated draft omitted the requested ${expected.target} ${expected.stat} ${expected.stages > 0 ? "+" : ""}${expected.stages} stage change`,
      );
    }
  }
  const requiredMoves = requestedMoveIds(payload);
  if (requiredMoves.length === 0) {
    return;
  }
  const usedMoves = blueprintMoveIds(result, payload);
  const missingMove = requiredMoves.find(moveId => !usedMoves.has(moveId));
  if (missingMove !== undefined) {
    const move = payload.moveIndex.find(candidate => Number(candidate.id) === missingMove);
    throw new Error(`Generated draft omitted the requested move ${move?.name || missingMove}`);
  }
  const powerMatch = payload.prompt.match(/\b(\d{1,3})\s*(?:BP|base power)\b/i);
  if (powerMatch) {
    const expectedPower = Number(powerMatch[1]);
    const wrongPowerMove = requiredMoves.find(moveId => blueprintMovePower(result, moveId) !== expectedPower);
    if (wrongPowerMove !== undefined) {
      const move = payload.moveIndex.find(candidate => Number(candidate.id) === wrongPowerMove);
      throw new Error(`Generated draft did not set ${move?.name || wrongPowerMove} to ${expectedPower} BP`);
    }
  }
}

function normalizedSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const catalogSearchStopWords = new Set([
  "ability",
  "after",
  "against",
  "also",
  "and",
  "create",
  "does",
  "each",
  "from",
  "holder",
  "into",
  "move",
  "opponent",
  "pokemon",
  "stage",
  "target",
  "that",
  "the",
  "then",
  "this",
  "uses",
  "when",
  "with",
]);

function catalogSearchTerms(value) {
  return [
    ...new Set(
      normalizedSearchText(value)
        .split(" ")
        .filter(term => term.length >= 3 && !catalogSearchStopWords.has(term)),
    ),
  ];
}

function componentRoleValue(rule, role) {
  if (role === "hook") {
    return { label: rule.label, hook: rule.hook, source: rule.source };
  }
  if (role === "condition") {
    return rule.conditions || [];
  }
  if (role === "effect") {
    return { label: rule.label, effects: rule.effects || [], source: rule.source };
  }
  if (role === "parameter") {
    return rule.parameters || [];
  }
  return rule;
}

function componentSearchScore(query, terms, rule, role = "any", requestedMoves = []) {
  const text = normalizedSearchText(JSON.stringify(componentRoleValue(rule, role)));
  if (!text) {
    return 0;
  }
  let score = terms.reduce((total, term) => total + (text.includes(term) ? Math.min(term.length, 8) : 0), 0);
  if (query.length >= 4 && text.includes(query)) {
    score += 80;
  }
  if (/\bon entry\b|\bswitch(?:es|ed|ing)? in\b/.test(query) && /on entry|post summon/.test(text)) {
    score += 40;
  }
  if (/\bafter (?:landing|using)\b|\bafter attack/.test(query) && /after landing|post attack/.test(text)) {
    score += 40;
  }
  if (/\bend of (?:each |the )?turn\b/.test(query) && /end of each turn|post turn/.test(text)) {
    score += 40;
  }
  if (/\bcontact\b/.test(query) && /contact/.test(text)) {
    score += 24;
  }
  if (/\b(?:raise|lower|boost|drop)\b/.test(query) && /stat stage|stage change/.test(text)) {
    score += 24;
  }
  if (requestedMoves.length > 0) {
    const controls = new Set((rule.parameters || []).map(parameter => parameter.control));
    if (controls.has("move")) {
      score += 100;
      if (/scripted move|post summon|post attack/.test(text)) {
        score += 60;
      }
    } else if (controls.has("move-list")) {
      score += 20;
    }
  }
  return score;
}

function requestedMoveEntries(payload) {
  const query = normalizedSearchText(payload.prompt);
  return (payload.moveIndex || []).filter(move => {
    const name = normalizedSearchText(move.name);
    return name.length >= 3 && query.includes(name);
  });
}

function defaultCatalogSearchPlan(payload) {
  const queries = [{ scope: "components", role: "any", query: payload.prompt, limit: 16 }];
  const clauses = payload.prompt
    .split(/[,;]|\b(?:and then|then|additionally|also)\b/gi)
    .map(clause => clause.trim())
    .filter(clause => clause.length >= 4 && clause.length <= 120);
  for (const clause of clauses.slice(0, 6)) {
    queries.push({ scope: "components", role: "any", query: clause, limit: 8 });
  }
  for (const move of requestedMoveEntries(payload)) {
    queries.push({ scope: "moves", role: "any", query: move.name, limit: 4 });
    queries.push({ scope: "components", role: "effect", query: `scripted move ${payload.prompt}`, limit: 10 });
  }
  for (const ability of payload.abilityIndex || []) {
    const name = normalizedSearchText(ability.name);
    if (name.length >= 3 && normalizedSearchText(payload.prompt).includes(name)) {
      queries.push({ scope: "abilities", role: "any", query: ability.name, limit: 4 });
    }
  }
  return { queries: queries.slice(0, 12) };
}

function normalizeCatalogSearchPlan(plan, payload) {
  const combined = [
    ...defaultCatalogSearchPlan(payload).queries,
    ...(Array.isArray(plan?.queries) ? plan.queries : []),
  ];
  const queries = [];
  const seen = new Set();
  for (const raw of combined) {
    const scope = ["components", "abilities", "moves"].includes(raw?.scope) ? raw.scope : "components";
    const role = ["any", "hook", "condition", "effect", "parameter"].includes(raw?.role) ? raw.role : "any";
    const query = String(raw?.query || "")
      .trim()
      .slice(0, 120);
    if (query.length < 2) {
      continue;
    }
    const key = `${scope}:${role}:${normalizedSearchText(query)}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    queries.push({ scope, role, query, limit: Math.max(1, Math.min(24, Number(raw.limit) || 12)) });
  }
  return { queries: queries.slice(0, 20) };
}

function catalogValueScore(query, value) {
  const normalizedQuery = normalizedSearchText(query);
  const text = normalizedSearchText(JSON.stringify(value));
  const terms = catalogSearchTerms(normalizedQuery);
  let score = terms.reduce((total, term) => total + (text.includes(term) ? Math.min(term.length, 8) : 0), 0);
  if (text.includes(normalizedQuery)) {
    score += 80;
  }
  return score;
}

function executeCatalogSearch(payload, rawPlan) {
  const plan = normalizeCatalogSearchPlan(rawPlan, payload);
  const requestedMoves = requestedMoveEntries(payload);
  const components = new Map();
  const abilities = new Map();
  const moves = new Map();
  const searches = [];
  let componentRuleCount = 0;
  for (const ability of payload.componentCandidates || []) {
    componentRuleCount += (ability.rules || []).length;
  }
  for (const search of plan.queries) {
    const query = normalizedSearchText(search.query);
    if (search.scope === "components") {
      const terms = catalogSearchTerms(query);
      const matches = [];
      for (const ability of payload.componentCandidates || []) {
        for (const [ruleIndex, rule] of (ability.rules || []).entries()) {
          const score = componentSearchScore(query, terms, rule, search.role, requestedMoves);
          if (score > 0) {
            matches.push({ ability, rule, ruleIndex, score });
          }
        }
      }
      matches.sort((left, right) => right.score - left.score);
      for (const match of matches.slice(0, search.limit)) {
        const key = `${match.ability.id}:${match.ruleIndex}`;
        components.set(key, {
          ability: {
            id: match.ability.id,
            name: match.ability.name,
            description: match.ability.description,
          },
          rule: match.rule,
        });
      }
      searches.push({ ...search, matches: Math.min(matches.length, search.limit) });
    } else if (search.scope === "abilities") {
      const matches = (payload.abilityIndex || [])
        .map(ability => ({ ability, score: catalogValueScore(query, ability) }))
        .filter(match => match.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, search.limit);
      for (const match of matches) {
        abilities.set(Number(match.ability.id), match.ability);
      }
      searches.push({ ...search, matches: matches.length });
    } else {
      const matches = (payload.moveIndex || [])
        .map(move => ({ move, score: catalogValueScore(query, move) }))
        .filter(match => match.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, search.limit);
      for (const match of matches) {
        moves.set(Number(match.move.id), match.move);
      }
      searches.push({ ...search, matches: matches.length });
    }
  }
  for (const move of requestedMoves) {
    moves.set(Number(move.id), move);
  }
  return {
    catalogCounts: {
      abilities: (payload.abilityIndex || []).length,
      componentRules: componentRuleCount,
      moves: (payload.moveIndex || []).length,
    },
    searches,
    requestedMoves: requestedMoves.map(move => ({
      id: move.id,
      name: move.name,
      type: move.type,
      category: move.category,
      power: move.power,
    })),
    components: [...components.values()].slice(0, 120).map((component, index) => ({
      componentId: `c${index}`,
      selectableParts: {
        hook: Boolean(component.rule.source),
        conditionIndexes: (component.rule.conditions || [])
          .map((condition, conditionIndex) => (condition.source ? conditionIndex : null))
          .filter(conditionIndex => conditionIndex !== null),
        effectIndexes: (component.rule.effects || [])
          .map((effect, effectIndex) => (effect.source ? effectIndex : null))
          .filter(effectIndex => effectIndex !== null),
      },
      ...component,
    })),
    abilities: [...abilities.values()].slice(0, 48),
    moves: [...moves.values()].slice(0, 48),
  };
}

function expandComponentSelection(selection, searchContext, role) {
  const component = searchContext.components.find(candidate => candidate.componentId === selection?.componentId);
  if (!component) {
    throw new Error(`Unknown catalog component ${selection?.componentId || "missing"}`);
  }
  let source;
  let selectedPart;
  if (role === "condition") {
    selectedPart = component.rule.conditions?.[selection.partIndex ?? 0];
    source = selectedPart?.source;
    if (!source && component.selectableParts.conditionIndexes.length === 1) {
      selectedPart = component.rule.conditions[component.selectableParts.conditionIndexes[0]];
      source = selectedPart.source;
    }
  } else if (role === "effect") {
    source = component.rule.effects?.[selection.partIndex ?? 0]?.source;
    if (!source && component.selectableParts.effectIndexes.length === 1) {
      source = component.rule.effects[component.selectableParts.effectIndexes[0]].source;
    }
  } else {
    source = component.rule.source;
  }
  if (!source) {
    throw new Error(`${selection.componentId} has no selectable ${role}`);
  }
  const expanded = { ...source };
  if (role === "condition") {
    expanded.kind = selectedPart.kind;
  }
  if (selection.parameterOverrides && Object.keys(selection.parameterOverrides).length > 0) {
    expanded.parameterOverrides = selection.parameterOverrides;
  }
  return expanded;
}

function expandAssemblyPart(part, searchContext, role) {
  if (part && Object.hasOwn(part, "componentId")) {
    return expandComponentSelection(part, searchContext, role);
  }
  return part;
}

function expandAssemblyPlan(result, searchContext) {
  const draft = result?.draft;
  if (!draft) {
    throw new Error("The model returned an empty ability blueprint");
  }
  return {
    explanation: result.explanation,
    blueprint: {
      version: 1,
      id: 20000,
      name: draft.name,
      description: draft.description,
      generation: draft.generation,
      includes: draft.includes || [],
      mechanics: [],
      componentRules: (draft.componentRules || []).map(rule => ({
        key: rule.key,
        prerequisiteHooks: (rule.prerequisiteHooks || []).map(selection =>
          expandComponentSelection(selection, searchContext, "hook"),
        ),
        hook: expandComponentSelection(rule.hook, searchContext, "hook"),
        chance: rule.chance,
        conditionLogic: rule.conditionLogic,
        conditions: (rule.conditions || []).map(part => expandAssemblyPart(part, searchContext, "condition")),
        effects: (rule.effects || []).map(part => expandAssemblyPart(part, searchContext, "effect")),
      })),
      rules: draft.rules || [],
      modifiers: draft.modifiers || [],
      flags: draft.flags,
    },
  };
}

function normalizedPrimitiveAlias(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizePrimitiveAliases(result) {
  const triggerAliases = {
    "after-landing-a-move": "after-attack",
    "after-landing-a-hit": "after-attack",
    "after-attacking": "after-attack",
    "after-being-hit": "after-hit",
    "on-entry": "on-entry",
    "end-of-turn": "end-turn",
  };
  const conditionAliases = {
    "move-filter": "move",
    "move-condition": "move",
    hp: "holder-hp",
    status: "holder-status",
  };
  const effectAliases = {
    stat: "stat-stage",
    "stat-change": "stat-stage",
    "change-stat-stages": "stat-stage",
    heal: "heal-percent",
    "apply-status": "status",
  };
  const targetAliases = {
    self: "holder",
    user: "holder",
    target: "other",
    opponent: "other",
    foe: "other",
  };
  const statAliases = {
    atk: "ATK",
    attack: "ATK",
    def: "DEF",
    defense: "DEF",
    spatk: "SPATK",
    "special-attack": "SPATK",
    spdef: "SPDEF",
    "special-defense": "SPDEF",
    spd: "SPD",
    speed: "SPD",
    acc: "ACC",
    accuracy: "ACC",
    eva: "EVA",
    evasion: "EVA",
  };
  for (const rule of result.blueprint.rules || []) {
    const triggerKey = normalizedPrimitiveAlias(rule.trigger);
    rule.trigger = triggerAliases[triggerKey] || rule.trigger;
    for (const condition of rule.conditions || []) {
      const kindKey = normalizedPrimitiveAlias(condition.kind);
      condition.kind = conditionAliases[kindKey] || condition.kind;
      if (condition.filter) {
        condition.filter.type = condition.filter.type?.toUpperCase() || condition.filter.type;
        condition.filter.category = condition.filter.category?.toUpperCase() || condition.filter.category;
        condition.filter.flag =
          condition.filter.flag?.toUpperCase().replace(/[^A-Z0-9]+/g, "_") || condition.filter.flag;
      }
    }
    for (const effect of rule.effects || []) {
      const kindKey = normalizedPrimitiveAlias(effect.kind);
      const targetKey = normalizedPrimitiveAlias(effect.target);
      const statKey = normalizedPrimitiveAlias(effect.stat);
      effect.kind = effectAliases[kindKey] || effect.kind;
      effect.target = targetAliases[targetKey] || effect.target;
      effect.stat = statAliases[statKey] || effect.stat;
      effect.status = effect.status?.toUpperCase() || effect.status;
      effect.weather = effect.weather?.toUpperCase() || effect.weather;
      effect.terrain = effect.terrain?.toUpperCase() || effect.terrain;
    }
  }
}

function _catalogSearchPrompt(payload) {
  return `Plan exhaustive searches over a closed Pokemon ability catalog. Return exactly one JSON object matching CATALOG SEARCH PLAN SCHEMA. Request 4-12 focused searches that together cover every clause in the user's request. Search scopes are components, abilities, and moves. Component roles are hook, condition, effect, parameter, or any. Search semantic mechanic terms likely to occur in labels and class names, such as "on entry", "scripted move", "contact", "stat stage", or "weather". Search a named move in moves and search its mechanism separately in components. Search a named complete ability in abilities. Do not create the ability yet.

PRIMITIVE CATALOG:
${JSON.stringify(payload.primitiveCatalog)}

USER REQUEST:
${payload.prompt}

CATALOG SEARCH PLAN SCHEMA:
${JSON.stringify(_catalogSearchPlanSchema)}`;
}

function modelPrompt(payload, searchContext = executeCatalogSearch(payload, null), planSchema = assemblyPlanSchema) {
  return `You assemble Elite Redux Pokemon abilities from a closed catalog. Return exactly one compact assembly plan matching ASSEMBLY PLAN SCHEMA and nothing else: no markdown, commentary, or code fences. Never write code, commands, files, runtime class names, ability ids for runtime components, or unsupported mechanics. The worker expands catalog component IDs into exact runtime objects after your response. Before returning, verify that the draft has at least one include, componentRule, primitive rule, or modifier and that every componentRule has one hook and at least one effect.

Triggers, conditions, and effects are independent. Recombine them freely. componentRules may mix catalog component selections with configurable primitive conditions and effects. Prefer primitive rules whenever PRIMITIVE CATALOG expresses the requested mechanic exactly. Event IF components can be observed under their native dispatcher and consumed by any WHEN hook. Hook-bound DO/THEN components can be armed by any WHEN hook and execute once through their native dispatcher. Use includes only when the user explicitly wants the complete existing ability.

The worker executed every requested search against the complete runtime catalog and expanded the exact matches below. Select a runtime hook, condition, or effect only by its componentId and selectableParts. A component is valid as a hook only when selectableParts.hook is true. A condition or effect partIndex must appear in selectableParts.conditionIndexes or selectableParts.effectIndexes for that role. For hooks set partIndex to null. Use parameterOverrides only with paths advertised by the selected component's parameters. An optionsRef points to the zero-based list in COMPONENT OPTION SETS; choose the option value, never its label. Move parameters must use an id from the move matches in CATALOG SEARCH RESULTS. Leave optional parameters absent unless requested. A trigger's holder is the ability owner, not the move target. Damaging scripted moves normally target an opponent. Chance is 1-100 and defaults to 100 unless requested. Primitive conditions and effects must use PRIMITIVE CATALOG. If the request cannot be represented exactly, create the closest safe draft and state the limitation in explanation. Keep name and description player-facing and precise.

Every requested clause must appear in the mechanics. Distinct WHEN clauses require distinct rules. If CATALOG SEARCH RESULTS lists a requested move, use a runtime component whose editable parameter control is "move" and set its parameterOverrides to that move id; set an advertised power parameter when the request specifies BP. Never approximate a scripted move with a primitive move filter or a move-list status proc. Never add an included ability unless the user explicitly names that complete ability and it appears in the ability matches.
${isPrimitiveStatRuleRequest(payload) ? "This request is fully expressible as a primitive stat-stage rule. Leave componentRules empty and implement it only in draft.rules." : ""}

CURRENT DRAFT (optional reference only):
${JSON.stringify(payload.currentBlueprint || null)}

PRIMITIVE CATALOG:
${JSON.stringify(payload.primitiveCatalog)}

COMPONENT OPTION SETS:
${JSON.stringify(payload.componentOptionSets || [])}

CATALOG SEARCH RESULTS (every component has a short componentId for selection):
${JSON.stringify(searchContext)}

FINAL REQUEST TO IMPLEMENT:
${payload.prompt}

ASSEMBLY PLAN SCHEMA:
${JSON.stringify(planSchema)}

Return exactly one non-empty assembly plan for that request. Use only primitive values and catalog componentIds.`;
}

function promptRequestsSelfTarget(prompt) {
  return /\b(?:target(?:s|ed|ing)?|hit(?:s|ting)?|affect(?:s|ed|ing)?|cast(?:s|ing)?|use(?:s|d|ing)?)\s+(?:the\s+)?(?:holder|user|itself|self)\b|\b(?:on|at)\s+(?:the\s+)?(?:holder|user|itself|self)\b/i.test(
    prompt,
  );
}

function normalizeRuntimeSource(source, candidates) {
  if (!source || !Number.isInteger(source.abilityId)) {
    return;
  }
  const matches = candidates.filter(candidate => candidate.source.attrType === source.attrType);
  if (matches.length === 0) {
    return;
  }
  const candidate =
    candidates.find(match => sourceKey(match.source) === sourceKey(source))
    || matches.find(match => match.source.abilityId === source.abilityId)
    || matches[0];
  source.abilityId = candidate.source.abilityId;
  source.attrIndex = candidate.source.attrIndex;
  source.attrType = candidate.source.attrType;
  if (source.kind && candidate.source.kind) {
    source.kind = candidate.source.kind;
    source.conditionIndex = candidate.source.conditionIndex;
  }
  const allowedPaths = new Set((candidate.parameters || []).map(parameter => parameter.path));
  if (source.parameterOverrides) {
    source.parameterOverrides = Object.fromEntries(
      Object.entries(source.parameterOverrides).map(([path, value]) => {
        if (!allowedPaths.has(path) && allowedPaths.has(`opts.${path}`)) {
          return [`opts.${path}`, value];
        }
        if (!allowedPaths.has(path) && path.startsWith("opts.") && allowedPaths.has(path.slice(5))) {
          return [path.slice(5), value];
        }
        return [path, value];
      }),
    );
  }
}

function normalizeRuntimeSourceReferences(result, payload) {
  const hooks = [];
  const conditions = [];
  const effects = [];
  for (const ability of payload.componentCandidates || []) {
    for (const rule of ability.rules || []) {
      hooks.push({ source: rule.source, parameters: rule.parameters });
      conditions.push(
        ...(rule.conditions || []).map(condition => ({ source: condition.source, parameters: rule.parameters })),
      );
      effects.push(
        ...(rule.effects || []).map(effect => ({
          source: effect.source,
          parameters: effect.parameters || rule.parameters,
        })),
      );
    }
  }
  for (const source of result.blueprint?.mechanics || []) {
    normalizeRuntimeSource(source, effects);
  }
  for (const rule of result.blueprint?.componentRules || []) {
    normalizeRuntimeSource(rule.hook, hooks);
    for (const source of rule.prerequisiteHooks || []) {
      normalizeRuntimeSource(source, hooks);
    }
    for (const source of rule.conditions || []) {
      normalizeRuntimeSource(source, conditions);
    }
    for (const source of rule.effects || []) {
      normalizeRuntimeSource(source, effects);
    }
  }
}

function normalizeComponentRuleHooks(result) {
  for (const rule of result.blueprint?.componentRules || []) {
    const seen = new Set([sourceKey(rule.hook)]);
    rule.prerequisiteHooks = (rule.prerequisiteHooks || []).filter(hook => {
      const key = sourceKey(hook);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
}

function normalizeScriptedMoveTargets(result, payload) {
  if (promptRequestsSelfTarget(payload.prompt)) {
    return;
  }
  const moves = new Map((payload.moveIndex || []).map(move => [Number(move.id), move]));
  const blueprint = result.blueprint || {};
  const sources = [
    ...(blueprint.mechanics || []),
    ...(blueprint.componentRules || []).flatMap(rule => [
      ...(rule.prerequisiteHooks || []),
      rule.hook,
      ...(rule.conditions || []),
      ...(rule.effects || []),
    ]),
  ].filter(Boolean);
  let corrected = false;
  for (const source of sources) {
    const overrides = source.parameterOverrides;
    if (source.attrType !== "PostSummonScriptedMoveAbAttr" || overrides?.["opts.targetsSelf"] !== true) {
      continue;
    }
    const move = moves.get(Number(overrides["opts.moveId"]));
    if (!move || Number(move.power) <= 0) {
      continue;
    }
    source.parameterOverrides = Object.fromEntries(
      Object.entries(overrides).filter(([path]) => path !== "opts.targetsSelf"),
    );
    corrected = true;
  }
  if (corrected) {
    result.explanation =
      "Created a validated ability draft from the available runtime components and requested parameters.";
  }
}

async function _runCodex(payload, emit) {
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
    cwd: codexCwd,
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
    } else if (message.method === "rawResponseItem/completed" && params.item?.role === "assistant") {
      const text = messageContentText(params.item.content);
      if (text.trim()) {
        finalText = text;
      }
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
      const finishedTurn = await Promise.race([
        done,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(Object.assign(new Error("Ability generation timed out"), { fallback: true })),
            45_000,
          ),
        ),
      ]);
      const completedText = completedTurnText(finishedTurn);
      if (completedText.trim()) {
        finalText = completedText;
      }
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
    normalizeRuntimeSourceReferences(result, payload);
    normalizeComponentRuleHooks(result);
    normalizeScriptedMoveTargets(result, payload);
    validateSources(result, payload);
    validatePromptRequirements(result, payload);
    return result;
  } finally {
    activeTurn = null;
    unsubscribe();
    await rpc.request("thread/delete", { threadId }).catch(() => {});
  }
}

async function requestNimJson(model, body, schema, source, timeoutMs, forceGuidedJson = false) {
  let response;
  try {
    response = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${nimKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(
        model === "deepseek-ai/deepseek-v4-flash-0731"
          || model === "moonshotai/kimi-k3"
          || (model.startsWith("nvidia/nemotron-3-") && !forceGuidedJson)
          ? {
              ...body,
              model,
              ...(model === "deepseek-ai/deepseek-v4-flash-0731"
                ? { chat_template_kwargs: { thinking: false } }
                : model.startsWith("nvidia/nemotron-3-")
                  ? { chat_template_kwargs: { enable_thinking: false } }
                  : {}),
            }
          : {
              ...body,
              model,
              guided_json: schema,
              ...(model.startsWith("nvidia/nemotron-3-") ? { chat_template_kwargs: { enable_thinking: false } } : {}),
            },
      ),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`The ${source} timed out`);
  }
  if (!response.ok) {
    const providerError = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 1000);
    throw new Error(
      `The ability builder could not complete the request (${response.status})${providerError ? `: ${providerError}` : ""}`,
    );
  }
  const resultBody = await response.json();
  const choice = resultBody?.choices?.[0];
  const message = choice?.message;
  const contentCandidates = [message?.content, message?.reasoning_content, message?.reasoning]
    .map(messageContentText)
    .filter(Boolean);
  const content = (contentCandidates[0] || "").replace(/<think>[\s\S]*?<\/think>/gi, "");
  try {
    return stripNulls(extractJson(content, source, false));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ability-model-invalid-output",
        model,
        finishReason: choice?.finish_reason,
        contentType: Array.isArray(message?.content) ? "array" : typeof message?.content,
        contentLength: content.length,
        preview: content.slice(0, 400),
        tail: content.slice(-400),
      }),
    );
    throw error;
  }
}

async function runNimModel(model, body, payload, searchContext, planSchema, emit) {
  const generationTimeout = model === "deepseek-ai/deepseek-v4-flash-0731" ? 25_000 : 60_000;
  const forceGuidedJson = model === "nvidia/nemotron-3-nano-30b-a3b" && isPrimitiveStatRuleRequest(payload);
  let plan = await requestNimJson(model, body, planSchema, "ability model", generationTimeout, forceGuidedJson);
  let result;
  try {
    result = expandAssemblyPlan(plan, searchContext);
    normalizePrimitiveAliases(result);
    normalizeRuntimeSourceReferences(result, payload);
    normalizeComponentRuleHooks(result);
    normalizeScriptedMoveTargets(result, payload);
    validateSources(result, payload);
    validatePromptRequirements(result, payload);
    return result;
  } catch (error) {
    emit({ type: "status", message: "Correcting a rejected draft" });
    const repairBody = {
      ...body,
      messages: [
        ...body.messages,
        { role: "assistant", content: JSON.stringify(plan) },
        {
          role: "user",
          content: `The assembly plan was rejected by deterministic validation: ${error.message || String(error)}. Return a corrected complete assembly plan. Use only componentIds from the search results and only advertised parameter paths. Represent stat changes as a separate primitive rule unless the search results advertise an exact stat-change component. Preserve every requested clause.`,
        },
      ],
      temperature: 0,
    };
    plan = await requestNimJson(model, repairBody, planSchema, "ability repair model", 45_000, forceGuidedJson);
    result = expandAssemblyPlan(plan, searchContext);
    normalizePrimitiveAliases(result);
  }
  normalizeRuntimeSourceReferences(result, payload);
  normalizeComponentRuleHooks(result);
  normalizeScriptedMoveTargets(result, payload);
  validateSources(result, payload);
  validatePromptRequirements(result, payload);
  return result;
}

async function runNim(payload, emit) {
  if (!nimKey) {
    throw new Error("The ability builder is temporarily unavailable");
  }
  const models = [...new Set([nimModel, nimFallbackModel].filter(Boolean))];
  emit({ type: "status", message: "Searching the complete ability catalog" });
  const searchContext = executeCatalogSearch(payload, null);
  emit({
    type: "status",
    message: `Building from ${searchContext.components.length} matched runtime mechanics`,
  });
  const planSchema = assemblyPlanSchemaForSearch(searchContext, payload.primitiveCatalog || {}, payload);
  const modelSearchContext = isPrimitiveStatRuleRequest(payload)
    ? { ...searchContext, components: [], abilities: [], moves: [] }
    : searchContext;
  const systemContent =
    "Return only one compact JSON assembly plan matching the requested schema. Do not include markdown or hidden reasoning.";
  const userContent = modelPrompt(payload, modelSearchContext, planSchema);
  const inputCharacters = systemContent.length + userContent.length;
  console.log(JSON.stringify({ event: "ability-model-input", inputCharacters }));
  if (inputCharacters > 1_000_000) {
    throw new Error("The complete ability catalog exceeds the model input limit");
  }
  const body = {
    messages: [
      {
        role: "system",
        content: systemContent,
      },
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
    max_tokens: 3000,
    stream: false,
  };
  let lastError = new Error("The ability builder is temporarily unavailable");
  for (const [modelIndex, model] of models.entries()) {
    if (modelIndex > 0) {
      emit({ type: "status", message: "Trying the backup model" });
    }
    try {
      return await runNimModel(model, body, payload, searchContext, planSchema, emit);
    } catch (error) {
      console.error(JSON.stringify({ event: "ability-model-failed", model, message: error.message || String(error) }));
      emit({ type: "diagnostic", model, message: error.message || String(error) });
      lastError = error;
    }
  }
  throw lastError;
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
  if (!Array.isArray(payload.componentOptionSets)) {
    payload.componentOptionSets = [];
  }
  if (
    payload.abilityIndex.length > 3000
    || payload.componentCandidates.length > 3000
    || payload.componentOptionSets.length > 100
    || (Array.isArray(payload.moveIndex) && payload.moveIndex.length > 5000)
  ) {
    throw Object.assign(new Error("Ability catalog context is too large"), { status: 413 });
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
    const result = await runNim(payload, emit);
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
