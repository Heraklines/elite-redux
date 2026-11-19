/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// The whole container server, offline: it is started as a real process with its OpenAI call (gpt-6.1-terra via
// OPENAI_API_KEY) answered by fake-openai.mjs, which returns the canned plans of the AI regression set. This proves
// the pipeline around the model: vocabulary search, plan schema, prompt, the unchanged OpenAI request, expansion into
// a blueprint, validation with the game's validator, and the repair round with a plain-language reason. The key below
// is a literal placeholder for the fake; nothing is sent anywhere.

import { allAbilities } from "#data/data-lists";
import { validateAbilityStudioBlueprints } from "#data/elite-redux/ability-studio/ability-blueprint";
import { compileAbilityStudioBlueprint } from "#data/elite-redux/ability-studio/compile-ability-blueprint";
import { AI_CASES } from "#test/tests/elite-redux/decomp/ai/ai-regression-cases";
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CONTAINER = resolve(ROOT, "workers/er-ability-ai/container");
const FAKE = resolve(ROOT, "test/tests/elite-redux/decomp/ai/fake-openai.mjs");
const primitiveCatalog = JSON.parse(readFileSync(resolve(ROOT, "editor/data/ability-primitives.json"), "utf8"));
const MOVES = [{ id: 1001, name: "Steam Eruption", type: "WATER", category: "SPECIAL", power: 110 }];
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const FLAGS = { bypassFaint: false, ignorable: false, unsuppressable: false, uncopiable: false, unreplaceable: false };
const draft = (composition: unknown[]) => ({
  explanation: "Built from the vocabulary.",
  draft: {
    name: "Flow Probe",
    description: "Built by the offline server flow test.",
    generation: 9,
    includes: [],
    componentRules: [],
    rules: [],
    modifiers: [],
    flags: FLAGS,
    composition,
  },
});

interface Started {
  readonly port: number;
  readonly child: ChildProcess;
  readonly log: string;
}

const workDir = mkdtempSync(join(tmpdir(), "er-ai-flow-"));

// The test setup installs MSW, which refuses every real request made from the test process (fetch and node:http
// alike). The requests to the local server therefore go through a small child node process.
const REQUEST_SCRIPT = `
const { request } = require("node:http");
const [port, method, path, body] = process.argv.slice(1);
const req = request({ host: "127.0.0.1", port: Number(port), method, path }, response => {
  const chunks = [];
  response.on("data", chunk => chunks.push(chunk));
  response.on("end", () => process.stdout.write(JSON.stringify({ status: response.statusCode, text: Buffer.concat(chunks).toString("utf8") })));
});
req.on("error", error => { process.stderr.write(String(error)); process.exit(2); });
req.end(body || undefined);
`;

function http(port: number, method: string, path: string, body?: string): Promise<{ status: number; text: string }> {
  return new Promise((done, fail) => {
    execFile(
      process.execPath,
      ["-e", REQUEST_SCRIPT, String(port), method, path, body ?? ""],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? fail(new Error(stderr || String(error))) : done(JSON.parse(stdout))),
    );
  });
}

async function startServer(name: string, plans: Record<string, unknown[]>, assetDir: string): Promise<Started> {
  const dir = join(workDir, name);
  mkdirSync(dir, { recursive: true });
  const plansPath = join(dir, "plans.json");
  const log = join(dir, "calls.jsonl");
  writeFileSync(plansPath, JSON.stringify(plans));
  writeFileSync(log, "");
  const port = 19000 + Math.floor(Math.random() * 900);
  const output = openSync(join(dir, "server.log"), "w");
  const child = spawn(process.execPath, ["--import", pathToFileURL(FAKE).href, join(CONTAINER, "server.mjs")], {
    env: {
      PATH: process.env.PATH ?? "",
      PORT: String(port),
      ABILITY_AI_ASSET_DIR: assetDir,
      OPENAI_API_KEY: "offline-placeholder-not-a-real-key",
      ER_FAKE_PLANS: plansPath,
      ER_FAKE_LOG: log,
    },
    stdio: ["ignore", output, output],
  });
  closeSync(output);
  let lastError = "";
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await http(port, "GET", "/internal/instance")).status === 200) {
        return { port, child, log };
      }
    } catch (error) {
      lastError = String(error);
    }
    await new Promise(done => setTimeout(done, 100));
  }
  const exitCode = child.exitCode;
  child.kill();
  throw new Error(
    `the container server ${name} did not start (exit ${exitCode}, port ${port}, ${lastError}): ${readFileSync(join(dir, "server.log"), "utf8").slice(0, 600)}`,
  );
}

interface Event {
  type: string;
  message?: string;
  blueprint?: Record<string, unknown>;
  explanation?: string;
}

async function generate(started: Started, phrase: string): Promise<Event[]> {
  const response = await http(
    started.port,
    "POST",
    "/generate",
    JSON.stringify({
      prompt: phrase,
      abilityIndex: [],
      componentCandidates: [],
      componentOptionSets: [],
      moveIndex: MOVES,
      primitiveCatalog,
    }),
  );
  return response.text
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as Event);
}

const calls = (started: Started): Record<string, unknown>[] =>
  readFileSync(started.log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map(line => JSON.parse(line) as Record<string, unknown>);

const buildable = AI_CASES.filter(entry => entry.plan.length > 0);
const servers: Started[] = [];
afterAll(() => {
  for (const started of servers) {
    started.child.kill();
  }
});

describe("container server flow (offline, OpenAI answered by a fake)", () => {
  let main: Started;
  beforeAll(async () => {
    const plans: Record<string, unknown[]> = {};
    for (const entry of buildable) {
      plans[entry.phrase] = [draft(clone(entry.plan) as unknown[])];
    }
    main = await startServer("main", plans, CONTAINER);
    servers.push(main);
  }, 30_000);

  for (const entry of buildable) {
    it(`${entry.id}: search, schema, model call, expansion and validation produce a compilable blueprint`, async () => {
      const events = await generate(main, entry.phrase);
      const error = events.find(event => event.type === "error");
      expect(error?.message, "the server reported an error").toBeUndefined();
      const result = events.find(event => event.type === "result");
      expect(result?.blueprint).toBeDefined();
      const blueprint = clone(result?.blueprint) as Record<string, unknown>;
      expect(blueprint.version).toBe(2);
      expect((blueprint.composition as { key: string }[]).map(rule => rule.key)).toEqual(
        entry.plan.map(rule => rule.key),
      );
      const validated = validateAbilityStudioBlueprints({ probe: blueprint as never });
      expect(validated.errors).toEqual([]);
      const ability = compileAbilityStudioBlueprint(validated.blueprints.probe, id => allAbilities[id]);
      expect(ability.attrs.length).toBe(entry.plan.length);
    }, 30_000);
  }

  it("sent the unchanged OpenAI request: gpt-6.1-terra, bearer key, JSON schema, medium reasoning", () => {
    const sent = calls(main);
    expect(sent.length).toBe(buildable.length);
    for (const call of sent) {
      expect(call).toMatchObject({
        model: "gpt-6.1-terra",
        authorization: true,
        format: "json_schema",
        strict: false,
        reasoning: "medium",
        hasComposition: true,
        promptHasRules: true,
        promptHasVocabulary: true,
      });
    }
  });
});

describe("container server flow: repair, rejection and fallback", () => {
  it("returns the validator's plain-language reason to the model and accepts the corrected plan", async () => {
    const phrase = "heal 25% of my max HP at the end of every turn";
    const good = AI_CASES.find(entry => entry.phrase === phrase)?.plan ?? [];
    const bad = [
      {
        key: "heal-each-turn",
        if: [],
        when: { block: "event.end-of-turn" },
        do: [{ block: "effect.heal-everyone", params: { percent: 25 } }],
        chance: 100,
      },
    ];
    const started = await startServer("repair", { [phrase]: [draft(bad), draft(clone(good) as unknown[])] }, CONTAINER);
    servers.push(started);
    const events = await generate(started, phrase);
    expect(events.find(event => event.type === "error")?.message).toBeUndefined();
    expect(
      events.some(event => event.type === "status" && /Correcting a rejected draft/.test(event.message ?? "")),
    ).toBe(true);
    const sent = calls(started);
    expect(sent.map(call => call.attempt)).toEqual([0, 1]);
    expect(String(sent[1].rejection)).toContain("The composition was rejected");
    expect(String(sent[1].rejection)).toContain('there is no effect called "effect.heal-everyone"');
    expect(String(sent[1].rejection)).not.toMatch(/AbAttr|undefined|\[object|at Object/);
    const result = events.find(event => event.type === "result");
    expect((result?.blueprint?.composition as { do: { block: string }[] }[])[0].do[0].block).toBe(
      "effect.heal-percent",
    );
  }, 30_000);

  it("refuses a block that is only planned and says so in plain words", async () => {
    const phrase = "turn my Normal moves into Flying moves";
    const wishful = [
      {
        key: "retype",
        if: [],
        when: { block: "calc.move-power" },
        do: [{ block: "effect.change-move-type", params: { type: "FLYING" } }],
        chance: 100,
      },
    ];
    const started = await startServer("planned", { [phrase]: [draft(wishful)] }, CONTAINER);
    servers.push(started);
    const events = await generate(started, phrase);
    const error = events.find(event => event.type === "error");
    expect(error?.message).toContain("cannot run yet");
    expect(error?.message).not.toMatch(/AbAttr|undefined|\[object|at Object/);
    expect(events.some(event => event.type === "result")).toBe(false);
  }, 30_000);

  it("corrects the case of a select value and the spelling of a move before checking it", async () => {
    const phrase = "after I use a Fire or Water move, follow up with a 50 power Steam Eruption";
    const sloppy = [
      {
        key: "steam-follow-up",
        if: [
          {
            any: [
              { block: "move.type", params: { type: "fire" } },
              { block: "move.type", params: { type: "Water" } },
            ],
          },
        ],
        when: { block: "event.after-my-hit" },
        do: [{ block: "effect.scripted-move", params: { moveId: "Steam Eruption", power: 50 } }],
        chance: 100,
      },
    ];
    const started = await startServer("sloppy", { [phrase]: [draft(sloppy)] }, CONTAINER);
    servers.push(started);
    const events = await generate(started, phrase);
    expect(events.find(event => event.type === "error")?.message).toBeUndefined();
    const composition = events.find(event => event.type === "result")?.blueprint?.composition as {
      do: { params: Record<string, unknown> }[];
    }[];
    expect(composition[0].do[0].params.moveId).toBe("STEAM_ERUPTION");
    expect(calls(started).length).toBe(1);
  }, 30_000);

  it("falls back to the component-only flow, unchanged, when the vocabulary files are missing", async () => {
    const phrase = "raise my Attack by one stage when I enter the battle";
    const legacy = {
      explanation: "A primitive rule.",
      draft: {
        name: "Legacy Probe",
        description: "Built without the vocabulary.",
        generation: 9,
        includes: [],
        componentRules: [],
        rules: [
          {
            key: "atk-entry",
            trigger: "on-entry",
            chance: 100,
            conditionLogic: "all",
            conditions: [],
            effects: [
              {
                kind: "stat-stage",
                target: "holder",
                stat: "ATK",
                stages: 1,
                status: null,
                percent: null,
                weather: null,
                terrain: null,
              },
            ],
          },
        ],
        modifiers: [],
        flags: FLAGS,
      },
    };
    const empty = join(workDir, "no-assets");
    mkdirSync(empty, { recursive: true });
    const started = await startServer("fallback", { [phrase]: [legacy] }, empty);
    servers.push(started);
    const events = await generate(started, phrase);
    expect(events.find(event => event.type === "error")?.message).toBeUndefined();
    const blueprint = events.find(event => event.type === "result")?.blueprint as Record<string, unknown>;
    expect(blueprint.version).toBe(1);
    expect(blueprint).not.toHaveProperty("composition");
    const sent = calls(started);
    expect(sent[0]).toMatchObject({ model: "gpt-6.1-terra", hasComposition: false, promptHasRules: false });
  }, 30_000);
});
