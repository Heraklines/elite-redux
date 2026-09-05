import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const maximumCapsuleBytes = 2 << 20;
const maximumStdoutBytes = 4 << 20;
const maximumStderrBytes = 64 << 10;
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: Buffer;
  stderr: Buffer;
}

interface CapsuleSummary {
  value: Record<string, unknown>;
  attempts: Record<string, unknown>[];
  basePosition: number;
  finalPosition: number;
  snapshotDigest: string;
  omittedIndex: number;
}

export interface CurrentReproCliBridgeEvidence {
  source_sha: string;
  executable_sha256: string;
  positive_replay: true;
  time_omission_rejected: true;
  base_position: number;
  final_position: number;
  processed_attempts: number;
  snapshot_digest: string;
  negative_divergence_position: number;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  assert(value != null && value.length > 0, `${name} is required for the browser/native capsule witness`);
  return value;
}

function object(value: unknown, label: string): Record<string, unknown> {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  return value as Record<string, unknown>;
}

function position(value: unknown, label: string): number {
  assert(typeof value === "number" && Number.isSafeInteger(value) && value >= 0, `${label} must be a safe position`);
  return value;
}

function inspectCapsule(bytes: Buffer): CapsuleSummary {
  assert(bytes.length > 0 && bytes.length <= maximumCapsuleBytes, "browser capsule must fit the shared 2 MiB limit");
  const value = object(JSON.parse(bytes.toString("utf8")), "capsule");
  assert.equal(value.schema_version, 1);
  assert.equal(object(value.checkpoint, "checkpoint").schema_version, 7);
  const transport = object(value.browser_transport, "browser transport context");
  assert(position(transport.base_generation, "base generation") > 0);
  assert(position(transport.final_generation, "final generation") > 0);
  const basePosition = position(value.base_position, "base_position");
  const finalPosition = position(value.final_position, "final_position");
  assert(Array.isArray(value.attempts) && value.attempts.length > 1 && value.attempts.length <= 256);
  const attempts = value.attempts.map((attempt, index) => {
    const record = object(attempt, `attempt ${index}`);
    assert.equal(position(record.position, "attempt position"), basePosition + index + 1);
    object(record.event, "event");
    object(record.outcome, "outcome");
    return record;
  });
  assert.equal(finalPosition, basePosition + attempts.length);
  assert(typeof value.final_snapshot_digest === "string" && /^blake3-v1:[a-f0-9]{64}$/u.test(value.final_snapshot_digest));
  // Keep a later recorded outcome so removing time is caught at the removed
  // position even after repairing ordinal metadata, rather than by a count check.
  const omittedIndex = attempts.findIndex((attempt, index) => {
    const event = object(attempt.event, "event");
    return index < attempts.length - 1 && event.kind === "ADVANCE_TIME"
      && typeof event.milliseconds === "number" && event.milliseconds > 0
      && object(attempt.outcome, "outcome").kind === "APPLIED";
  });
  assert(omittedIndex >= 0, "export must retain an applied non-key time event followed by another recorded attempt");
  return { value, attempts, basePosition, finalPosition, snapshotDigest: value.final_snapshot_digest, omittedIndex };
}

function runBounded(executable: string, args: readonly string[], timeoutMs: number, stdoutLimit = maximumStdoutBytes): Promise<ProcessResult> {
  return new Promise((resolveResult, rejectResult) => {
    const child = spawn(executable, args, { cwd: sourceRoot, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: Error | undefined;
    let completed = false;
    let reapTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result?: ProcessResult) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      if (reapTimer !== undefined) clearTimeout(reapTimer);
      if (failure !== undefined) rejectResult(failure);
      else if (result !== undefined) resolveResult(result);
      else rejectResult(new Error("child exited without a result"));
    };
    const stop = (reason: string) => {
      if (failure !== undefined || completed) return;
      failure = new Error(reason);
      child.kill("SIGKILL");
      // Successful runs always await close/reaping. If the OS never reports it,
      // fail explicitly after cleanup's own bound instead of hanging the suite.
      reapTimer = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        failure = new Error(`${reason}; child did not close within the 5-second reap bound`);
        finish();
      }, 5_000);
    };
    const timer = setTimeout(() => stop(`child exceeded ${timeoutMs}ms timeout`), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > stdoutLimit) stop(`child stdout exceeded ${stdoutLimit} bytes`);
      else if (failure === undefined) stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maximumStderrBytes) stop(`child stderr exceeded ${maximumStderrBytes} bytes`);
      else if (failure === undefined) stderr.push(chunk);
    });
    child.once("error", error => {
      if (child.pid === undefined) {
        failure = error;
        finish();
      } else stop(`child process error: ${error.message}`);
    });
    child.once("close", (code, signal) => finish({ code, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(path);
  const timer = setTimeout(() => stream.destroy(new Error("CLI SHA256 read exceeded 30 seconds")), 30_000);
  try {
    for await (const chunk of stream) hash.update(chunk);
    return hash.digest("hex");
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
}

async function verifiedExecutable(): Promise<{ executable: string; expectedHash: string; expectedSource: string }> {
  const executable = await realpath(requiredEnvironment("ER_M9E_CLI_EXECUTABLE"));
  const root = await realpath(requiredEnvironment("ER_M9E_CLI_ROOT"));
  const expectedHash = requiredEnvironment("ER_M9E_CLI_SHA256");
  const expectedSource = requiredEnvironment("ER_M9E_CLI_SOURCE_SHA");
  assert(/^[a-f0-9]{64}$/u.test(expectedHash), "CLI SHA256 binding must be lowercase hexadecimal");
  assert(/^[a-f0-9]{40}$/u.test(expectedSource), "CLI source binding must be a full lowercase Git SHA");
  const withinRoot = relative(root, executable);
  assert(withinRoot.length > 0 && !isAbsolute(withinRoot) && withinRoot.split(sep)[0] !== "..", "CLI escaped its allowed artifact root");
  assert((await stat(root)).isDirectory());
  assert((await stat(executable)).isFile());
  assert(["er-cli", "er-cli.exe"].includes(basename(executable)), "bridge requires the normal non-test CLI binary");
  const head = await runBounded("git", ["rev-parse", "HEAD"], 10_000, 4_096);
  assert.equal(head.code, 0, `source checkout lookup failed: ${head.stderr.toString("utf8")}`);
  assert.equal(head.signal, null);
  assert.equal(head.stdout.toString("utf8").trim(), expectedSource, "CLI artifact source binding differs from the browser source checkout");
  assert.equal(await sha256(executable), expectedHash, "CLI artifact bytes differ from the CI binding");
  // Source association comes from the required CI Cargo-artifact binding. A
  // SHA256 plus checkout check is not independent executable attestation.
  return { executable, expectedHash, expectedSource };
}

/** Actual Chromium-produced capsule -> normal native CLI. No renderer/transport simulation. */
export async function assertCurrentReproCliBridge(
  capsuleBytes: Uint8Array | readonly number[],
  browserSnapshot: unknown,
  contentPath: string,
): Promise<CurrentReproCliBridgeEvidence> {
  assert(capsuleBytes.length > 0 && capsuleBytes.length <= maximumCapsuleBytes);
  if (!(capsuleBytes instanceof Uint8Array)) {
    assert(capsuleBytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255));
  }
  const bytes = Buffer.from(capsuleBytes);
  const capsule = inspectCapsule(bytes);
  const snapshot = object(browserSnapshot, "browser snapshot");
  assert.equal(snapshot.schema_version, 7);
  const { executable, expectedHash, expectedSource } = await verifiedExecutable();
  const content = await realpath(contentPath);
  assert((await stat(content)).isFile());
  const temporary = await mkdtemp(join(tmpdir(), "m9e-current-repro-bridge-"));
  try {
    const positivePath = join(temporary, "browser-capsule.json");
    await writeFile(positivePath, bytes, { flag: "wx" });
    const positive = await runBounded(executable, ["replay", "--content", content, "--capsule", positivePath], 120_000);
    assert.equal(positive.signal, null);
    assert.equal(positive.code, 0, `normal current replay failed: ${positive.stderr.toString("utf8")}`);
    assert.equal(positive.stderr.length, 0, "successful replay emitted unexpected stderr");
    const result = object(JSON.parse(positive.stdout.toString("utf8")), "CLI replay result");
    assert.equal(result.kernel_version, 7);
    assert.equal(result.processed_attempts, capsule.attempts.length);
    assert.equal(result.base_position, capsule.basePosition);
    assert.equal(result.final_position, capsule.finalPosition);
    assert.equal(result.snapshot_digest, capsule.snapshotDigest);
    assert(isDeepStrictEqual(result.snapshot, browserSnapshot), "normal CLI replay full snapshot differs from the browser snapshot");
    const finalOutcome = object(capsule.attempts[capsule.attempts.length - 1].outcome, "final outcome");
    assert(isDeepStrictEqual(result.observation, finalOutcome.observation), "normal CLI replay observation differs from recorded evidence");

    const tampered = structuredClone(capsule.value);
    const attempts = tampered.attempts as Record<string, unknown>[];
    const omittedPosition = position(attempts[capsule.omittedIndex].position, "omitted position");
    attempts.splice(capsule.omittedIndex, 1);
    for (let index = capsule.omittedIndex; index < attempts.length; index++) {
      attempts[index].position = position(attempts[index].position, "retained position") - 1;
    }
    tampered.final_position = capsule.finalPosition - 1;
    const negativeBytes = Buffer.from(JSON.stringify(tampered));
    assert(negativeBytes.length <= maximumCapsuleBytes);
    const negativePath = join(temporary, "omitted-time-capsule.json");
    await writeFile(negativePath, negativeBytes, { flag: "wx" });
    assert.equal(await sha256(executable), expectedHash, "CLI artifact changed between replay witnesses");
    const negative = await runBounded(executable, ["replay", "--content", content, "--capsule", negativePath], 120_000);
    assert.equal(negative.signal, null, "tampered capsule must be rejected normally, not killed");
    assert(negative.code !== null && negative.code !== 0, "omitting a causal time event unexpectedly replayed successfully");
    assert.equal(negative.stdout.length, 0, "rejected replay must not return a successful result");
    const failure = negative.stderr.toString("utf8");
    const debugDivergence = /Divergence\s*\{\s*position:\s*(\d+),\s*field:\s*"(step|observation|snapshot_digest|outcome|rejection)"\s*\}/u.exec(failure);
    const displayDivergence = /current replay diverged at attempt (\d+): (step|observation|snapshot_digest|outcome|rejection)/u.exec(failure);
    const divergence = debugDivergence ?? displayDivergence;
    assert(divergence !== null, `negative replay failed without causal divergence evidence: ${failure}`);
    assert.equal(Number(divergence[1]), omittedPosition, `negative replay diverged at the wrong attempt: ${failure}`);
    return {
      source_sha: expectedSource,
      executable_sha256: expectedHash,
      positive_replay: true,
      time_omission_rejected: true,
      base_position: capsule.basePosition,
      final_position: capsule.finalPosition,
      processed_attempts: capsule.attempts.length,
      snapshot_digest: capsule.snapshotDigest,
      negative_divergence_position: Number(divergence[1]),
    };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
