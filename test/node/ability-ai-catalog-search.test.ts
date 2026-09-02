import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

interface SearchRuntime {
  requestedMoveIds(payload: { prompt: string; moveIndex: Array<{ id: number; name: string }> }): number[];
  containsCatalogName(text: string, name: string): boolean;
  assemblyPlanSchemaForSearch(search: unknown, catalog: unknown, payload: unknown): Record<string, unknown>;
  normalizePrimitiveAliases(result: unknown): void;
  validateBlueprintShape(result: unknown, payload: unknown): void;
}

const source = readFileSync(resolve(process.cwd(), "workers/er-ability-ai/container/server.mjs"), "utf8");
const runtime: SearchRuntime = runInNewContext(
  `${source.slice(0, source.indexOf("const server = createServer")).replace(/^import .*;\r?\n/gm, "")}\n({ requestedMoveIds, containsCatalogName, assemblyPlanSchemaForSearch, normalizePrimitiveAliases, validateBlueprintShape })`,
  { randomUUID, process: { env: {} }, structuredClone },
);
const moves = [
  { id: 47, name: "Sing" },
  { id: 220, name: "Pain Split" },
  { id: 53, name: "Flamethrower" },
];

describe("ability builder catalog search", () => {
  it("does not demand Sing just because the request says opposing", () => {
    expect(
      runtime.requestedMoveIds({ prompt: "On entry, use Pain Split on an opposing Pokemon.", moveIndex: moves }),
    ).toEqual([220]);
  });

  it("matches complete move names across punctuation and case", () => {
    expect(runtime.requestedMoveIds({ prompt: "Use PAIN-SPLIT, then Sing!", moveIndex: moves })).toEqual([47, 220]);
    expect(runtime.containsCatalogName("keep increasing power", "Sing")).toBe(false);
  });

  it("shares schema definitions while retaining every advertised parameter", () => {
    const catalog = JSON.parse(readFileSync(resolve(process.cwd(), "editor/data/ability-primitives.json"), "utf8"));
    const schema = runtime.assemblyPlanSchemaForSearch(
      {
        components: [
          {
            componentId: "c0",
            selectableParts: { hook: true, conditionIndexes: [], effectIndexes: [0] },
            rule: { parameters: [{ path: "opts.moveId" }, { path: "opts.power" }] },
          },
        ],
      },
      catalog,
      { prompt: "Use Pain Split", moveIndex: moves, abilityIndex: [] },
    );
    expect(JSON.stringify(schema)).toContain('"opts.moveId":{"$ref":"#/$defs/parameterValue"}');
    expect(JSON.stringify(schema)).toContain('"opts.power":{"$ref":"#/$defs/parameterValue"}');
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") {
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === "$ref" && typeof value === "string") {
          let target: unknown = schema;
          for (const part of value.slice(2).split("/")) {
            expect(target).toHaveProperty(part);
            target = (target as Record<string, unknown>)[part];
          }
        } else {
          visit(value);
        }
      }
    };
    visit(schema);
  });

  it("normalizes primitive IF and THEN aliases inside component rules without changing runtime references", () => {
    const component = { abilityId: 5164, attrIndex: 0, attrType: "PostAttackScriptedMoveAbAttr" };
    const runtimeCondition = { ...component, kind: "event", parameterOverrides: { "opts.power": 50 } };
    const result = {
      explanation: "Use a move after Fire or Water attacks.",
      blueprint: {
        version: 1,
        id: 20001,
        name: "Steam Followup",
        description: "Use Steam Eruption after Fire or Water moves.",
        includes: [],
        mechanics: [],
        modifiers: [],
        rules: [],
        componentRules: [
          {
            key: "steam",
            hook: component,
            prerequisiteHooks: [],
            chance: 100,
            conditionLogic: "any",
            conditions: [
              { kind: "move-filter", filter: { type: "fire" } },
              { kind: "move-condition", filter: { type: "water" } },
              runtimeCondition,
            ],
            effects: [component, { kind: "stat-change", target: "self", stat: "speed", stages: 1 }],
          },
        ],
      },
    };
    runtime.normalizePrimitiveAliases(result);
    const rule = result.blueprint.componentRules[0];
    expect(rule.conditions.slice(0, 2)).toEqual([
      { kind: "move", filter: { type: "FIRE" } },
      { kind: "move", filter: { type: "WATER" } },
    ]);
    expect(runtimeCondition).toEqual({ ...component, kind: "event", parameterOverrides: { "opts.power": 50 } });
    expect(rule.effects[1]).toMatchObject({ kind: "stat-stage", target: "holder", stat: "SPD", stages: 1 });
    const catalog = JSON.parse(readFileSync(resolve(process.cwd(), "editor/data/ability-primitives.json"), "utf8"));
    expect(() => runtime.validateBlueprintShape(result, { primitiveCatalog: catalog })).not.toThrow();
    rule.conditions[0].kind = "invented-condition";
    expect(() => runtime.validateBlueprintShape(result, { primitiveCatalog: catalog })).toThrow(
      ".kind is not available",
    );
  });
});
