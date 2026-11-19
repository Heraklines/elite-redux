// Test-only preload (node --import): answers the container server's OpenAI Responses call from a canned file, so
// the whole /generate pipeline (search, schema, prompt, model call, expansion, validation, repair) runs offline.
// Nothing leaves the machine: every other fetch is refused. Used by ai-server-flow.test.ts.
//
//   ER_FAKE_PLANS  path of a JSON file: { "<exact phrase>": [firstAnswer, repairAnswer?, ...] }
//   ER_FAKE_LOG    path of a JSONL file the preload appends one line per model call to

import { appendFileSync, readFileSync } from "node:fs";

const plans = JSON.parse(readFileSync(process.env.ER_FAKE_PLANS, "utf8"));
const attempts = new Map();

globalThis.fetch = async (url, init) => {
  if (String(url) !== "https://api.openai.com/v1/responses") {
    throw new Error(`the offline test refuses to call ${String(url)}`);
  }
  const body = JSON.parse(init.body);
  const text = body.input.map(message => message.content).join("\n");
  const phrase = Object.keys(plans).find(candidate => text.includes(`FINAL REQUEST TO IMPLEMENT:\n${candidate}\n`));
  if (phrase === undefined) {
    return new Response("no canned answer for this request", { status: 500 });
  }
  const attempt = attempts.get(phrase) ?? 0;
  attempts.set(phrase, attempt + 1);
  const answers = plans[phrase];
  const answer = answers[Math.min(attempt, answers.length - 1)];
  const rejection = text.match(/rejected by deterministic validation: ([^\n]*?)\. Return a corrected/s);
  appendFileSync(
    process.env.ER_FAKE_LOG,
    `${JSON.stringify({
      phrase,
      attempt,
      model: body.model,
      authorization: String(init.headers?.Authorization ?? "").startsWith("Bearer "),
      format: body.text?.format?.type,
      strict: body.text?.format?.strict,
      reasoning: body.reasoning?.effort,
      hasComposition: Boolean(body.text?.format?.schema?.properties?.draft?.properties?.composition),
      promptHasRules: text.includes("COMPOSITION RULES"),
      promptHasVocabulary: text.includes("VOCABULARY (ranked"),
      rejection: rejection?.[1] ?? null,
    })}\n`,
  );
  return new Response(
    JSON.stringify({
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(answer) }] }],
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
