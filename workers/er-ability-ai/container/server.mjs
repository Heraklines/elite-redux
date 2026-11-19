import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import readline from "node:readline";
import { pathToFileURL } from "node:url";

const port = Number(process.env.PORT || 8080);
const codexHome = process.env.CODEX_HOME || "/var/lib/ability-ai/codex";
const codexBin = process.env.CODEX_BIN || "codex";
const codexCwd = process.env.CODEX_CWD || "/srv/empty";
const authPath = `${codexHome}/auth.json`;
const instanceId = randomUUID();
const codexModel = process.env.CODEX_MODEL || "gpt-5.6-luna";
const codexEffort = process.env.CODEX_EFFORT || "high";
const nimModel = process.env.NVIDIA_NIM_MODEL || "moonshotai/kimi-k3";
const nimFallbackModel = process.env.NVIDIA_NIM_FALLBACK_MODEL || "deepseek-ai/deepseek-v4-flash-0731";
const nimKey = process.env.NVIDIA_NIM_API_KEY || "";
const openaiKey = process.env.OPENAI_API_KEY || "";
const openaiModel = process.env.OPENAI_MODEL || "gpt-6.1-terra";
const openaiEffort = process.env.OPENAI_REASONING_EFFORT || "medium";
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
        parameterProperties[parameter.path] = { $ref: "#/$defs/parameterValue" };
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
    return name.length >= 3 && containsCatalogName(prompt, name);
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
  schema.$defs = {
    parameterValue: parameterValueSchema,
    hook: hookSchema || componentPartSelectionSchema,
    condition: primitiveSchemas.conditionSchema,
    effect: primitiveSchemas.effectSchema,
  };
  ruleProperties.prerequisiteHooks.items = { $ref: "#/$defs/hook" };
  ruleProperties.hook = { $ref: "#/$defs/hook" };
  schema.$defs.componentCondition = componentConditionSchema
    ? componentConditionSchema
    : primitiveSchemas.conditionSchema;
  schema.$defs.componentEffect = componentEffectSchema ? componentEffectSchema : primitiveSchemas.effectSchema;
  ruleProperties.conditions.items.anyOf = componentConditionSchema
    ? [{ $ref: "#/$defs/componentCondition" }, { $ref: "#/$defs/condition" }]
    : [{ $ref: "#/$defs/condition" }];
  ruleProperties.effects.items.anyOf = componentEffectSchema
    ? [{ $ref: "#/$defs/componentEffect" }, { $ref: "#/$defs/effect" }]
    : [{ $ref: "#/$defs/effect" }];
  const primitiveRuleProperties = schema.properties.draft.properties.rules.items.properties;
  primitiveRuleProperties.conditions.items = { $ref: "#/$defs/condition" };
  primitiveRuleProperties.effects.items = { $ref: "#/$defs/effect" };
  schema.properties.draft.properties.modifiers.items = primitiveSchemas.modifierSchema;
  if (isPrimitiveStatRuleRequest(payload)) {
    schema.properties.draft.properties.componentRules = { type: "array", maxItems: 0 };
  }
  if (searchContext.vocabulary) {
    const composition = compositionSchemaFor(searchContext.vocabulary);
    Object.assign(schema.$defs, composition.defs);
    schema.properties.draft.properties.composition = composition.property;
    schema.properties.draft.required.push("composition");
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
  const abilityIds = new Set((payload.abilityIndex || []).map(ability => Number(ability.id)));
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
    if (parameter.control === "ability") {
      if (!Number.isInteger(value) || !abilityIds.has(value)) {
        throw new Error(`${label}.${path} is not an available ability id`);
      }
    } else if (parameter.control === "move") {
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
    } else if (parameter.control === "text") {
      if (typeof value !== "string" || value.length > 500) {
        throw new Error(`${label}.${path} must be text`);
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
  if (
    (blueprint.version !== 1 && blueprint.version !== 2)
    || !Number.isInteger(blueprint.id)
    || blueprint.id < 20000
    || blueprint.id > 29999
  ) {
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
  if (
    blueprint.composition !== undefined
    && (!Array.isArray(blueprint.composition) || blueprint.composition.length > 32)
  ) {
    throw new Error("The model returned an invalid composition list");
  }
  if (Object.keys(limits).every(key => blueprint[key].length === 0) && blueprint.composition?.length === 0) {
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
  validateCompositionBlueprint(result);
}

function requestedMoveIds(payload) {
  return requestedMoveEntries(payload).map(move => Number(move.id));
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
  for (const moveId of compositionMoveIds(result.blueprint, payload)) {
    ids.add(moveId);
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
  return (
    compositionHasStatChange(result.blueprint, expected)
    || (result.blueprint.rules || []).some(rule =>
      (rule.effects || []).some(
        effect =>
          effect.kind === "stat-stage"
          && effect.target === expected.target
          && effect.stat === expected.stat
          && Number(effect.stages) === expected.stages,
      ),
    )
  );
}

function blueprintMovePower(result, moveId, payload = {}) {
  const composed = compositionMovePower(result.blueprint, payload, moveId);
  if (composed !== null) {
    return composed;
  }
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
    if (!name || !containsCatalogName(prompt, name)) {
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
    const wrongPowerMove = requiredMoves.find(moveId => blueprintMovePower(result, moveId, payload) !== expectedPower);
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

function containsCatalogName(text, name) {
  return ` ${normalizedSearchText(text)} `.includes(` ${normalizedSearchText(name)} `);
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
    return name.length >= 3 && containsCatalogName(query, name);
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
    if (name.length >= 3 && containsCatalogName(payload.prompt, name)) {
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

function executeCatalogSearch(payload, rawPlan, assets = activeVocabularyAssets) {
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
      enumName: moveEnumName(move.name),
    })),
    vocabulary: assets ? vocabularyContextFor(assets, payload.prompt) : undefined,
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
  const composition = Array.isArray(draft.composition) ? draft.composition : [];
  return {
    explanation: result.explanation,
    blueprint: {
      // Version 2 only means the blueprint carries `composition`; everything else stays a version 1 blueprint.
      version: composition.length > 0 ? 2 : 1,
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
      ...(composition.length > 0
        ? {
            composition: composition.map(rule => ({
              key: rule.key,
              when: { block: rule.when?.block },
              if: rule.if || [],
              do: rule.do || [],
              chance: rule.chance ?? 100,
            })),
          }
        : {}),
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
  normalizeCompositionParams(result);
  for (const rule of [...(result.blueprint.rules || []), ...(result.blueprint.componentRules || [])]) {
    const triggerKey = normalizedPrimitiveAlias(rule.trigger);
    if (rule.trigger != null) {
      rule.trigger = triggerAliases[triggerKey] || rule.trigger;
    }
    for (const condition of rule.conditions || []) {
      if (Number.isInteger(condition.abilityId)) {
        continue;
      }
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
      if (Number.isInteger(effect.abilityId)) {
        continue;
      }
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

// ---------------------------------------------------------------------------------------------
// Vocabulary-first search and composition (spec section 5, AI server).
//
// The container ships three generated files next to this script (written by the catalog writer,
// test/tests/elite-redux/tools/catalog-writer.ts): vocabulary.json (WHEN, IF, DO, guards, slots),
// blocks.json (one entry per class declaration: label, synonyms, examples) and validate-composition.mjs (the
// game's own validator, bundled). The request is searched against them FIRST, by label, synonyms and examples.
// Whole-attr components (componentCandidates) stay as the fallback for mechanics the vocabulary cannot build.
// The plan schema's enums and the composition rules come from the same data, so a vocabulary change needs no
// change here (the AI regression set gates vocabulary changes).

const assetDirectory =
  process.env.ABILITY_AI_ASSET_DIR
  || (typeof process.argv?.[1] === "string" ? process.argv[1].replace(/[\\/][^\\/]*$/, "") : "")
  || "/app";

let vocabularyAssetsPromise;
// The assets of the request being generated (one request runs at a time), read by validateSources.
let activeVocabularyAssets = null;

function setActiveVocabularyAssets(assets) {
  activeVocabularyAssets = assets;
}

const vocabularyStopWords = new Set([
  "a",
  "ability",
  "after",
  "all",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "for",
  "from",
  "get",
  "gets",
  "has",
  "have",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "make",
  "makes",
  "me",
  "my",
  "of",
  "on",
  "or",
  "pokemon",
  "so",
  "that",
  "the",
  "then",
  "this",
  "to",
  "up",
  "when",
  "whenever",
  "while",
  "with",
]);

function vocabStem(word) {
  let stem = word;
  if (stem.length > 4 && stem.endsWith("ies")) {
    stem = `${stem.slice(0, -3)}y`;
  } else if (stem.length > 5 && stem.endsWith("ing")) {
    stem = stem.slice(0, -3);
  } else if (stem.length > 4 && stem.endsWith("ed")) {
    stem = stem.slice(0, -2);
  } else if (stem.length > 3 && stem.endsWith("s") && !stem.endsWith("ss")) {
    stem = stem.slice(0, -1);
  }
  if (stem.length > 3 && stem.at(-1) === stem.at(-2) && !/[aeiouls]/.test(stem.at(-1))) {
    stem = stem.slice(0, -1);
  }
  return stem;
}

function vocabWords(value) {
  return normalizedSearchText(String(value ?? "").replace(/\{[^}]*\}/g, " "))
    .split(" ")
    .filter(word => word.length >= 2 && !vocabularyStopWords.has(word))
    .map(vocabStem);
}

function vocabPhrase(value) {
  const words = vocabWords(value);
  return words.length === 0 ? "" : ` ${words.join(" ")} `;
}

function paramWords(params) {
  return (params || []).flatMap(param => [param.label, param.id]);
}

function vocabularyEntry(kind, def, extra = {}) {
  const field = values => new Set(values.flatMap(value => vocabWords(value)));
  const synonyms = def.synonyms || [];
  const examples = def.examples || [];
  const entry = {
    kind,
    id: def.id,
    def,
    usable: extra.usable !== false,
    labelTerms: field([def.label]),
    synonymTerms: field(synonyms),
    exampleTerms: field(examples),
    idTerms: field([def.id.replace(/[._-]+/g, " ")]),
    otherTerms: field([def.group, def.summary, def.whenLabel, ...(extra.other || []), ...paramWords(def.params)]),
    synonymPhrases: synonyms.map(vocabPhrase).filter(Boolean),
    examplePhrases: examples.map(vocabPhrase).filter(Boolean),
    labelPhrase: vocabPhrase(def.label),
    optionTerms: new Set(
      (def.params || []).flatMap(param =>
        Array.isArray(param.options)
          ? param.options.flatMap(option => vocabWords(String(option).replace(/_/g, " ")))
          : [],
      ),
    ),
  };
  entry.allTerms = new Set([
    ...entry.labelTerms,
    ...entry.synonymTerms,
    ...entry.exampleTerms,
    ...entry.idTerms,
    ...entry.otherTerms,
  ]);
  return entry;
}

const vocabularyIndexes = new WeakMap();

/** Entries for every trigger, condition, effect and block, plus the inverse document frequency of every word. */
function buildVocabularyIndex(vocabulary, blocks) {
  const cached = vocabularyIndexes.get(vocabulary);
  if (cached && cached.blocks === blocks) {
    return cached;
  }
  const entries = [];
  for (const when of vocabulary.whens) {
    entries.push(vocabularyEntry("when", when, { usable: when.composable === true && when.kind !== "while-active" }));
  }
  for (const condition of vocabulary.conditions) {
    entries.push(vocabularyEntry("condition", condition, { usable: condition.escapeHatch !== true }));
  }
  for (const effect of vocabulary.effects) {
    entries.push(
      vocabularyEntry("effect", effect, { usable: effect.implemented === true && effect.kind !== "package" }),
    );
  }
  for (const block of blocks || []) {
    entries.push(vocabularyEntry("block", block, { other: [block.kind] }));
  }
  const documentFrequency = new Map();
  for (const entry of entries) {
    for (const term of entry.allTerms) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }
  const index = { vocabulary, blocks, entries, documentFrequency };
  vocabularyIndexes.set(vocabulary, index);
  return index;
}

function scoreVocabularyEntry(index, entry, query) {
  let score = 0;
  const total = index.entries.length;
  for (const term of query.terms) {
    const weight = Math.log(1 + total / (index.documentFrequency.get(term) || total));
    if (entry.labelTerms.has(term)) {
      score += 6 * weight;
    }
    if (entry.synonymTerms.has(term)) {
      score += 5 * weight;
    }
    if (entry.exampleTerms.has(term)) {
      score += 3 * weight;
    }
    if (entry.idTerms.has(term)) {
      score += 3 * weight;
    }
    if (entry.otherTerms.has(term)) {
      score += weight;
    }
    if (entry.optionTerms.has(term)) {
      score += 3 * weight;
    }
  }
  for (const phrase of entry.synonymPhrases) {
    if ((phrase.trim().includes(" ") || phrase.length >= 7) && query.phrase.includes(phrase)) {
      score += 25;
    }
  }
  for (const phrase of entry.examplePhrases) {
    if (query.phrase.includes(phrase)) {
      score += 40;
    }
  }
  if (entry.labelPhrase && query.phrase.includes(entry.labelPhrase)) {
    score += 20;
  }
  return score;
}

const vocabularyResultLimits = { when: 16, condition: 24, effect: 16, block: 10, notBuildable: 6 };

/**
 * Ranks the vocabulary against a request. Blocks (whole-class declarations) are searched too, and what a
 * matching block is built from (its trigger, its effect, its condition atoms) is boosted, so "wimp out" finds
 * the force-switch effect and the after-taking-damage trigger even though those words are not in their labels.
 */
function searchVocabulary(vocabulary, blocks, prompt) {
  const index = buildVocabularyIndex(vocabulary, blocks);
  const query = { terms: new Set(vocabWords(prompt)), phrase: vocabPhrase(prompt) };
  const scored = new Map(
    index.entries.map(entry => [
      `${entry.kind}:${entry.id}`,
      { entry, score: scoreVocabularyEntry(index, entry, query) },
    ]),
  );
  const blockHits = [...scored.values()]
    .filter(hit => hit.entry.kind === "block" && hit.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, vocabularyResultLimits.block);
  for (const { entry, score } of blockHits) {
    const block = entry.def;
    const boosts = [
      ["when", block.when],
      ["effect", block.effect?.id],
      ...(block.conditions || []).map(condition => ["condition", condition.lib]),
    ];
    for (const [kind, id] of boosts) {
      const target = id ? scored.get(`${kind}:${id}`) : undefined;
      if (target) {
        target.score += score * 0.6;
      }
    }
  }
  const ranked = kind =>
    [...scored.values()]
      .filter(hit => hit.entry.kind === kind && hit.score > 0)
      .sort((left, right) => right.score - left.score || (left.entry.id < right.entry.id ? -1 : 1));
  const usable = kind => ranked(kind).filter(hit => hit.entry.usable);
  // Every buildable trigger is offered (there are few, and "reduce damage" does not name its trigger); the
  // ranking only decides the order and which ones survive the cap.
  const everyUsableWhen = [...scored.values()]
    .filter(hit => hit.entry.kind === "when" && hit.entry.usable)
    .sort((left, right) => right.score - left.score || (left.entry.id < right.entry.id ? -1 : 1));
  return {
    whens: everyUsableWhen.slice(0, vocabularyResultLimits.when),
    conditions: usable("condition").slice(0, vocabularyResultLimits.condition),
    effects: usable("effect").slice(0, vocabularyResultLimits.effect),
    blocks: blockHits,
    notBuildable: ["when", "effect"]
      .flatMap(kind =>
        ranked(kind)
          .filter(hit => !hit.entry.usable)
          .slice(0, vocabularyResultLimits.notBuildable),
      )
      .sort((left, right) => right.score - left.score)
      .slice(0, vocabularyResultLimits.notBuildable),
  };
}

function compactParam(param) {
  const card = { id: param.id, label: param.label };
  if (param.control === "select") {
    card.type = "select";
    card.options = param.options;
  } else if (param.control === "boolean") {
    card.type = "boolean";
  } else if (param.control === "text") {
    card.type = "text";
  } else {
    card.type = param.integer === true ? "integer" : "number";
    card.min = param.min;
    card.max = param.max;
  }
  card.default = param.default;
  return card;
}

function whenCard(when) {
  return {
    id: when.id,
    label: when.label,
    kind: when.kind,
    provides: when.provides,
    ...(when.modifies === undefined ? {} : { modifies: when.modifies }),
  };
}

function conditionCard(condition) {
  return {
    id: condition.id,
    label: condition.label,
    requires: condition.requires,
    ...(condition.whoParam === undefined ? {} : { whoParam: condition.whoParam }),
    ...(condition.pure === false ? { rollsDice: true } : {}),
    params: (condition.params || []).map(compactParam),
  };
}

function effectCard(effect) {
  return {
    id: effect.id,
    label: effect.label,
    kind: effect.kind,
    ...(effect.modifies === undefined ? {} : { modifies: effect.modifies }),
    requires: effect.requires,
    params: (effect.params || []).map(compactParam),
    ...(effect.guards?.length > 0 ? { lockedSafetyRules: effect.guards } : {}),
    ...(effect.feasibility?.length > 0 ? { alsoRequires: effect.feasibility } : {}),
  };
}

function recipeCard(block) {
  return {
    id: block.id,
    label: block.label,
    summary: block.summary,
    when: block.when,
    ...(block.effect ? { effect: block.effect.id } : {}),
    conditions: (block.conditions || []).map(condition => condition.lib).filter(Boolean),
    examples: block.examples,
  };
}

/** Can `effect` run under `when` (slots, kind and the calculated value)? Mirrors validateEffect of the shared validator. */
function effectFitsWhen(effect, when) {
  if (!(effect.requires || []).every(slot => when.provides.includes(slot))) {
    return false;
  }
  if (effect.kind === "calc") {
    return when.kind === "calc" && when.modifies === effect.modifies;
  }
  return effect.kind === "event" && when.kind === "event";
}

function conditionFitsWhen(condition, when) {
  if (!(condition.requires || []).every(slot => when.provides.includes(slot))) {
    return false;
  }
  return (
    when.kind !== "calc" || (condition.rollsDice !== true && !["time.once-per", "time.nth-use"].includes(condition.id))
  );
}

/** The plain-language composition rules, derived from the vocabulary actually offered to the model. */
function compositionRuleLines(cards) {
  const limits = activeVocabularyAssets?.limits || {
    rules: 32,
    conditionsPerRule: 16,
    effectsPerRule: 8,
    groupDepth: 4,
  };
  const lines = [
    "A composition rule is WHEN (the trigger) + IF (a list of conditions that must ALL hold) + DO (a list of effects) + chance (1-100, default 100, rolled after every IF).",
    "Reference triggers, conditions and effects only by the ids listed in VOCABULARY. Triggers take no settings. Give a condition or effect only the settings it advertises; leave a setting out to take its default.",
    "A block can be used only when everything it requires is provided by the trigger (requires is a subset of provides). The schema lists only compatible ids per trigger.",
    'Triggers of kind calc ("While the game calculates ...") change a value in the middle of a calculation: they accept only effects of kind calc whose modifies equals the trigger\'s modifies, only conditions that never roll dice or remember things (no rng.chance, time.once-per, time.nth-use), and chance must be 100. Triggers of kind event accept effects of kind event only.',
    'Conditions can only make a rule fire less often. For OR use {"any": [...]}, for NOT use {"not": condition}, for AND list them or use {"all": [...]}. Do not recreate a locked safety rule (lockedSafetyRules) as a condition; it always runs.',
    `Limits: ${limits.rules} rules, ${limits.conditionsPerRule} conditions per rule, ${limits.effectsPerRule} effects per rule, groups nested at most ${limits.groupDepth} deep. Distinct WHEN clauses need distinct rules.`,
    "Effects under notBuildableYet are listed so they can be named but cannot run. If the request needs one, build the closest safe composition and say what is missing in explanation.",
  ];
  for (const when of cards.whens) {
    const effects = cards.effects.filter(effect => effectFitsWhen(effect, when)).map(effect => effect.id);
    lines.push(
      `${when.id} (${when.kind}${when.modifies ? `, changes ${when.modifies}` : ""}) provides ${when.provides.join(", ")}; effects: ${effects.join(", ") || "none offered"}`,
    );
  }
  return lines;
}

/** The vocabulary part of the search context: cards for the best matches, recipes, and the composition rules. */
function vocabularyContextFor(assets, prompt) {
  const hits = searchVocabulary(assets.vocabulary, assets.blocks, prompt);
  const cards = {
    whens: hits.whens.map(hit => whenCard(hit.entry.def)),
    conditions: hits.conditions.map(hit => conditionCard(hit.entry.def)),
    effects: hits.effects.map(hit => effectCard(hit.entry.def)),
  };
  // An effect that fits none of the offered triggers is useless, and a trigger without a fitting effect cannot
  // build a rule: pull in the best compatible partner so every offered trigger can end in at least one effect.
  const everyWhen = assets.vocabulary.whens.filter(when => when.composable === true);
  for (const when of everyWhen) {
    if (cards.whens.some(card => card.id === when.id) && !cards.effects.some(effect => effectFitsWhen(effect, when))) {
      const partner = assets.vocabulary.effects.find(
        effect => effect.implemented === true && effectFitsWhen(effect, when),
      );
      if (partner) {
        cards.effects.push(effectCard(partner));
      }
    }
  }
  return {
    hash: assets.vocabulary.hash,
    whens: cards.whens,
    conditions: cards.conditions,
    effects: cards.effects,
    recipes: hits.blocks.map(hit => recipeCard(hit.entry.def)),
    notBuildableYet: hits.notBuildable.map(hit => ({ id: hit.entry.id, label: hit.entry.def.label })),
    rules: compositionRuleLines(cards),
  };
}

function sanitizedDefName(prefix, id) {
  return `${prefix}_${id.replace(/[^A-Za-z0-9_]+/g, "_")}`;
}

function vocabularyParamSchema(param) {
  switch (param.type) {
    case "select":
      return { enum: param.options };
    case "boolean":
      return { type: "boolean" };
    case "text":
      return { type: "string", maxLength: 120 };
    default:
      return {
        type: param.type === "integer" ? "integer" : "number",
        ...(typeof param.min === "number" ? { minimum: param.min } : {}),
        ...(typeof param.max === "number" ? { maximum: param.max } : {}),
      };
  }
}

function vocabularyBlockSchema(card) {
  return {
    type: "object",
    properties: {
      block: { const: card.id },
      params: {
        type: "object",
        properties: Object.fromEntries((card.params || []).map(param => [param.id, vocabularyParamSchema(param)])),
        additionalProperties: false,
      },
    },
    required: ["block"],
    additionalProperties: false,
  };
}

/**
 * The `composition` part of the assembly plan schema, built from the vocabulary cards: the trigger enum, and per
 * group of triggers that provide the same things, enums of the conditions and effects that can run there. Each block
 * has ONE definition (typed params with their enums and ranges) shared by every group.
 */
function compositionSchemaFor(vocabularyContext) {
  const defs = {};
  const blockRef = (prefix, card) => {
    const name = sanitizedDefName(prefix, card.id);
    defs[name] = vocabularyBlockSchema(card);
    return { $ref: `#/$defs/${name}` };
  };
  const groups = new Map();
  for (const when of vocabularyContext.whens) {
    const key = `${when.kind}|${when.modifies || ""}|${[...when.provides].sort().join(",")}`;
    const group = groups.get(key) || { whens: [], sample: when };
    group.whens.push(when);
    groups.set(key, group);
  }
  const ruleVariants = [];
  let groupNumber = 0;
  for (const group of groups.values()) {
    const conditions = vocabularyContext.conditions.filter(card => conditionFitsWhen(card, group.sample));
    const effects = vocabularyContext.effects.filter(card => effectFitsWhen(card, group.sample));
    if (effects.length === 0) {
      continue;
    }
    groupNumber++;
    const nodeName = `conditionNode_${groupNumber}`;
    const node = { $ref: `#/$defs/${nodeName}` };
    const variants = conditions.map(card => blockRef("condition", card));
    variants.push(
      {
        type: "object",
        properties: { all: { type: "array", items: node, minItems: 1, maxItems: 16 } },
        required: ["all"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: { any: { type: "array", items: node, minItems: 1, maxItems: 16 } },
        required: ["any"],
        additionalProperties: false,
      },
      { type: "object", properties: { not: node }, required: ["not"], additionalProperties: false },
    );
    defs[nodeName] = { anyOf: variants };
    ruleVariants.push({
      type: "object",
      properties: {
        key: { type: "string", pattern: "^[a-z0-9-]{2,48}$" },
        when: {
          type: "object",
          properties: { block: { enum: group.whens.map(when => when.id) } },
          required: ["block"],
          additionalProperties: false,
        },
        if: { type: "array", items: node, maxItems: 16 },
        do: {
          type: "array",
          items: { anyOf: effects.map(card => blockRef("effect", card)) },
          minItems: 1,
          maxItems: 8,
        },
        chance:
          group.sample.kind === "calc"
            ? { type: "integer", enum: [100] }
            : { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["key", "when", "if", "do", "chance"],
      additionalProperties: false,
    });
  }
  return {
    defs,
    property: { type: "array", maxItems: 32, items: ruleVariants.length > 0 ? { anyOf: ruleVariants } : { not: {} } },
  };
}

async function readVocabularyAssets() {
  const read = async name => JSON.parse(await readFile(`${assetDirectory}/${name}`, "utf8"));
  const vocabulary = await read("vocabulary.json");
  const catalog = await read("blocks.json");
  const validator = await import(pathToFileURL(`${assetDirectory}/validate-composition.mjs`).href);
  if (typeof validator.validateCompositionWith !== "function") {
    throw new Error("validate-composition.mjs does not export validateCompositionWith");
  }
  // blocks.json carries the hash of the vocabulary it was generated with; a stale one is ignored, not trusted.
  const blocks = catalog.vocabularyHash === vocabulary.hash ? catalog.blocks : [];
  return {
    vocabulary,
    blocks,
    validate: (rules, path) => validator.validateCompositionWith(rules, vocabulary, path),
    limits: validator.VALIDATOR_LIMITS,
  };
}

/** The vocabulary assets of this container, or null when they are missing (the older component-only flow then runs). */
function loadVocabularyAssets() {
  vocabularyAssetsPromise ??= readVocabularyAssets().catch(error => {
    console.error(JSON.stringify({ event: "ability-vocabulary-unavailable", message: error.message || String(error) }));
    return null;
  });
  return vocabularyAssetsPromise;
}

/** Plain-language problems the shared validator finds in the composition the model produced; throws so the repair loop sees them. */
function validateCompositionBlueprint(result, assets = activeVocabularyAssets) {
  const rules = result.blueprint?.composition;
  if (!Array.isArray(rules) || rules.length === 0) {
    return;
  }
  if (!assets) {
    throw new Error("The ability builder cannot check compositions right now");
  }
  const problems = assets.validate(rules, "composition");
  if (problems.length > 0) {
    throw new Error(`The composition was rejected: ${problems.slice(0, 6).join("; ")}`);
  }
}

/**
 * Models write "fire" for FIRE and "Steam Eruption" for STEAM_ERUPTION. A select value that matches an option
 * ignoring case and punctuation is corrected before validation; a text move id becomes the enum name.
 */
function normalizeCompositionParams(result) {
  const assets = activeVocabularyAssets;
  if (!assets || !Array.isArray(result.blueprint?.composition)) {
    return;
  }
  const defs = new Map([...assets.vocabulary.conditions, ...assets.vocabulary.effects].map(def => [def.id, def]));
  const loose = value =>
    String(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  for (const rule of result.blueprint.composition) {
    if (typeof rule.when?.block === "string") {
      rule.when.block = rule.when.block.trim().toLowerCase();
    }
    for (const ref of [...(rule.if || []).flatMap(node => conditionBlockRefs(node)), ...(rule.do || [])]) {
      const def = defs.get(ref.block);
      if (!def || !ref.params) {
        continue;
      }
      for (const param of def.params || []) {
        const value = ref.params[param.id];
        if (typeof value !== "string") {
          continue;
        }
        if (param.control === "select") {
          const option = (param.options || []).find(candidate => loose(candidate) === loose(value));
          if (option !== undefined) {
            ref.params[param.id] = option;
          }
        } else if (param.control === "text" && param.id === "moveId") {
          ref.params[param.id] = moveEnumName(value);
        }
      }
    }
  }
}

function conditionBlockRefs(node, found = []) {
  if (!node || typeof node !== "object") {
    return found;
  }
  if (typeof node.block === "string") {
    found.push(node);
  }
  for (const child of [...(node.all || []), ...(node.any || []), ...(node.not ? [node.not] : [])]) {
    conditionBlockRefs(child, found);
  }
  return found;
}

/** Every effect and condition reference of the composition rules, in order. */
function compositionBlockRefs(blueprint) {
  return (blueprint.composition || []).flatMap(rule => [
    ...(rule.if || []).flatMap(node => conditionBlockRefs(node)),
    ...(rule.do || []),
  ]);
}

function moveEnumName(name) {
  return String(name || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Moves a composition mentions (a scripted follow-up, an is-move or last-move condition), by move id. */
function compositionMoveIds(blueprint, payload) {
  const ids = new Set();
  for (const ref of compositionBlockRefs(blueprint)) {
    const moveName = ref.params?.moveId;
    if (typeof moveName !== "string") {
      continue;
    }
    const move = (payload.moveIndex || []).find(candidate => moveEnumName(candidate.name) === moveEnumName(moveName));
    if (move) {
      ids.add(Number(move.id));
    }
  }
  return ids;
}

function compositionMovePower(blueprint, payload, moveId) {
  for (const ref of compositionBlockRefs(blueprint)) {
    if (ref.block !== "effect.scripted-move") {
      continue;
    }
    const move = (payload.moveIndex || []).find(
      candidate => moveEnumName(candidate.name) === moveEnumName(ref.params?.moveId),
    );
    if (move && Number(move.id) === moveId) {
      return Number(ref.params?.power ?? 50);
    }
  }
  return null;
}

function compositionHasStatChange(blueprint, expected) {
  return (blueprint.composition || []).some(rule =>
    (rule.do || []).some(
      effect =>
        effect.block === "effect.stat-stage"
        && (effect.params?.target ?? "holder") === expected.target
        && (effect.params?.stat ?? "ATK") === expected.stat
        && Number(effect.params?.stages ?? 1) === expected.stages,
    ),
  );
}

function modelPrompt(payload, searchContext = executeCatalogSearch(payload, null), planSchema = assemblyPlanSchema) {
  const { vocabulary, ...contextWithoutVocabulary } = searchContext;
  const vocabularyGuidance = vocabulary
    ? `
VOCABULARY FIRST: the worker searched the ability vocabulary (triggers, conditions, effects, and the known recipes that use them) for this request. Build the ability as draft.composition rules from VOCABULARY whenever it can express a clause: set when.block to a trigger id, if[] to condition blocks, do[] to effect blocks, each as {"block": id, "params": {...}} with only advertised settings. Follow COMPOSITION RULES exactly. Use draft.componentRules (whole runtime components), primitive rules or modifiers only for clauses VOCABULARY cannot express, and never express the same clause twice. Compositions are checked by the same validator the game uses; a rejected block id, a setting out of range, or a block the trigger cannot provide comes back to you as plain-language feedback. For effect.scripted-move set moveId to the move's enumName from requestedMoves and power to the requested BP. "After a Fire or Water move" is ONE condition: {"any": [{"block": "move.type", "params": {"type": "FIRE"}}, {"block": "move.type", "params": {"type": "WATER"}}]}. Recipes show how known abilities are built; reuse their trigger and effect ids, never their names.`
    : "";
  const vocabularySections = vocabulary
    ? `VOCABULARY (ranked by the search; hash ${vocabulary.hash}):
${JSON.stringify({ whens: vocabulary.whens, conditions: vocabulary.conditions, effects: vocabulary.effects, recipes: vocabulary.recipes, notBuildableYet: vocabulary.notBuildableYet })}

COMPOSITION RULES:
${vocabulary.rules.map(line => `- ${line}`).join("\n")}

`
    : "";
  return `You assemble Elite Redux Pokemon abilities from a closed catalog. Return exactly one compact assembly plan matching ASSEMBLY PLAN SCHEMA and nothing else: no markdown, commentary, or code fences. Never write code, commands, files, runtime class names, ability ids for runtime components, or unsupported mechanics. The worker expands catalog component IDs into exact runtime objects after your response. Before returning, verify that the draft has at least one include, componentRule, primitive rule, or modifier and that every componentRule has one hook and at least one effect.

Triggers, conditions, and effects are independent. Recombine them freely. componentRules may mix catalog component selections with configurable primitive conditions and effects. Prefer primitive rules whenever PRIMITIVE CATALOG expresses the requested mechanic exactly. Event IF components can be observed under their native dispatcher and consumed by any WHEN hook. Hook-bound DO/THEN components can be armed by any WHEN hook and execute once through their native dispatcher. Use includes only when the user explicitly wants the complete existing ability.

The worker executed every requested search against the complete runtime catalog and expanded the exact matches below. Select a runtime hook, condition, or effect only by its componentId and selectableParts. A component is valid as a hook only when selectableParts.hook is true. A condition or effect partIndex must appear in selectableParts.conditionIndexes or selectableParts.effectIndexes for that role. For hooks set partIndex to null. Use parameterOverrides only with paths advertised by the selected component's parameters. An optionsRef points to the zero-based list in COMPONENT OPTION SETS; choose the option value, never its label. Move parameters must use an id from the move matches in CATALOG SEARCH RESULTS. Ability parameters must use an id from the ability matches in CATALOG SEARCH RESULTS. Leave optional parameters absent unless requested. A trigger's holder is the ability owner, not the move target. Damaging scripted moves normally target an opponent. Chance is 1-100 and defaults to 100 unless requested. Primitive conditions and effects must use PRIMITIVE CATALOG. If the request cannot be represented exactly, create the closest safe draft and state the limitation in explanation. Keep name and description player-facing and precise.

Every requested clause must appear in the mechanics. Distinct WHEN clauses require distinct rules. A component may be reused in multiple IF or DO/THEN entries with separate parameterOverrides. For "after a Fire or Water move", use conditionLogic:"any" with conditions:[{"kind":"move","filter":{"type":"FIRE"}},{"kind":"move","filter":{"type":"WATER"}}]. Do not invent a condition kind for OR or put several types into filter.type. If CATALOG SEARCH RESULTS lists a requested move, use a runtime component whose editable parameter control is "move" and set its parameterOverrides to that move id; set an advertised power parameter when the request specifies BP. Never approximate a scripted move with a primitive move filter or a move-list status proc. Never add an included ability unless the user explicitly names that complete ability and it appears in the ability matches.
${isPrimitiveStatRuleRequest(payload) ? "This request is fully expressible as a primitive stat-stage rule. Leave componentRules empty and implement it only in draft.rules." : ""}${vocabularyGuidance}

${vocabularySections}PRIMITIVE CATALOG:
${JSON.stringify(payload.primitiveCatalog)}

COMPONENT OPTION SETS:
${JSON.stringify(payload.componentOptionSets || [])}

CATALOG SEARCH RESULTS (every component has a short componentId for selection):
${JSON.stringify(contextWithoutVocabulary)}

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

async function requestOpenAiJson(body, schema, source, timeoutMs) {
  let response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: openaiModel,
        input: body.messages,
        max_output_tokens: 16_000,
        reasoning: { effort: openaiEffort },
        store: false,
        text: { format: { type: "json_schema", name: "ability_assembly_plan", strict: false, schema } },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new Error(`The ${source} timed out`, { cause: error });
    }
    throw new Error(`Could not connect to the ${source}. Please retry.`, { cause: error });
  }
  if (!response.ok) {
    // Provider error bodies stay in the server log; the browser only sees the status.
    const providerError = (await response.text().catch(() => "")).replace(/\s+/g, " ").trim().slice(0, 1000);
    console.error(JSON.stringify({ event: "ability-model-http-error", status: response.status, providerError }));
    throw new Error(`The ability builder could not complete the request (${response.status}). Please retry.`);
  }
  const resultBody = await response.json();
  const content = (resultBody?.output ?? [])
    .filter(item => item?.type === "message")
    .flatMap(item => item.content ?? [])
    .filter(part => part?.type === "output_text")
    .map(part => part.text)
    .join("");
  console.log(JSON.stringify({ event: "ability-model-usage", model: openaiModel, usage: resultBody?.usage }));
  try {
    return stripNulls(extractJson(content, source, false));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "ability-model-invalid-output",
        model: openaiModel,
        status: resultBody?.status,
        contentLength: content.length,
        preview: content.slice(0, 400),
      }),
    );
    throw error;
  }
}

async function requestNimJson(model, body, schema, source, timeoutMs, forceGuidedJson = false) {
  if (openaiKey && model === openaiModel) {
    return await requestOpenAiJson(body, schema, source, Math.max(timeoutMs, 150_000));
  }
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
  } catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") {
      throw new Error(`The ${source} timed out`, { cause: error });
    }
    throw new Error(`Could not connect to the ${source}. Please retry.`, { cause: error });
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
  if (!openaiKey && !nimKey) {
    throw new Error("The ability builder is temporarily unavailable");
  }
  const models = openaiKey ? [openaiModel] : [...new Set([nimModel, nimFallbackModel].filter(Boolean))];
  setActiveVocabularyAssets(await loadVocabularyAssets());
  emit({
    type: "status",
    message: activeVocabularyAssets
      ? "Searching the ability vocabulary, then the complete ability catalog"
      : "Searching the complete ability catalog",
  });
  const searchContext = executeCatalogSearch(payload, null);
  emit({
    type: "status",
    message: `Building from ${searchContext.vocabulary ? `${searchContext.vocabulary.effects.length} matched effects and ` : ""}${searchContext.components.length} matched runtime mechanics`,
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
