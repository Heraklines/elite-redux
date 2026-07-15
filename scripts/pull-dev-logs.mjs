// Sync REMOTE Send Logs captures down to this PC.
//
// Testers on the staging site press "Send Logs"; the full capture is committed
// to the repo's `dev-logs` branch by the er-editor-api worker. This script
// pulls every log file from that branch into the local (gitignored) dev-logs/
// folder, mirroring the existing capture conventions:
//
//   dev-logs/remote/<YYYY-MM-DD>/<timestamp>__<scenario>__<tester>.log
//
// Run: node scripts/pull-dev-logs.mjs        (one shot; only new files download)
// Downloads use a bounded worker pool and request deadline. Each log is first
// written to a `.partial` twin and atomically renamed, so an interrupted pull
// resumes without treating a truncated local file as complete.
// Authentication is selected, in order, from GH_TOKEN, GITHUB_TOKEN, then the
// documented github_token.txt file on the current user's Desktop.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const REPO = "Heraklines/elite-redux";
const BRANCH = "dev-logs";
const OUT_ROOT = "dev-logs";
const DEFAULT_CONCURRENCY = 8;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_PROGRESS_STEPS = 20;

const api = path => `https://api.github.com/repos/${REPO}/${path}`;

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function defaultTokenFiles(env, homeDir) {
  return unique([
    join(homeDir, "Desktop", "github_token.txt"),
    env.USERPROFILE ? join(env.USERPROFILE, "Desktop", "github_token.txt") : null,
    env.OneDrive ? join(env.OneDrive, "Desktop", "github_token.txt") : null,
  ]);
}

/**
 * Select the first documented GitHub credential without ever logging its value.
 * Dependencies are injectable so source precedence can be tested without
 * reading a developer's real environment or filesystem.
 */
export function selectGithubCredential({
  env = process.env,
  homeDir = homedir(),
  tokenFiles = defaultTokenFiles(env, homeDir),
  fileExists = existsSync,
  readFile = path => readFileSync(path, "utf8"),
} = {}) {
  for (const envName of ["GH_TOKEN", "GITHUB_TOKEN"]) {
    const token = env[envName]?.trim();
    if (token) {
      return { token, source: envName };
    }
  }

  for (const tokenFile of tokenFiles) {
    if (!fileExists(tokenFile)) {
      continue;
    }
    let token;
    try {
      token = readFile(tokenFile).trim();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Could not read GitHub credential file ${tokenFile}: ${redactSecrets(detail)}`);
    }
    if (token) {
      return { token, source: `token file ${tokenFile}` };
    }
  }

  return null;
}

export function buildGithubHeaders(credential) {
  const headers = {
    "User-Agent": "er-pull-dev-logs",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (credential?.token) {
    headers.Authorization = `Bearer ${credential.token}`;
  }
  return headers;
}

export function redactSecrets(value, secrets = []) {
  let redacted = String(value ?? "");
  const knownSecrets = unique(secrets.map(secret => String(secret).trim()).filter(secret => secret.length >= 4)).sort(
    (left, right) => right.length - left.length,
  );
  for (const secret of knownSecrets) {
    redacted = redacted.split(secret).join("<redacted>");
  }
  return redacted
    .replace(/\b(Bearer|token)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 <redacted>")
    .replace(/([?&](?:access_token|auth|authorization|token)=)[^&\s]+/gi, "$1<redacted>")
    .replace(/("(?:access_token|auth|authorization|token)"\s*:\s*")[^"]*(")/gi, "$1<redacted>$2");
}

function responseHeader(response, name) {
  return response.headers?.get?.(name) ?? null;
}

function requirePositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer; received ${String(value)}`);
  }
  return value;
}

function githubTimeoutError({ stage, credential, timeoutMs }) {
  const authSource = credential?.source ?? "none";
  const error = new Error(
    `GitHub request timed out after ${timeoutMs}ms while ${stage} (credential source: ${authSource}).`,
  );
  error.name = "GithubRequestTimeoutError";
  error.stage = stage;
  error.authSource = authSource;
  error.timeoutMs = timeoutMs;
  return error;
}

async function responseExcerpt(response, secrets) {
  try {
    const body = await response.text();
    return redactSecrets(body, secrets).replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "";
  }
}

export async function classifyGithubHttpError(response, { stage, credential } = {}) {
  const status = Number(response.status);
  const authSource = credential?.source ?? "none";
  const secrets = credential?.token ? [credential.token] : [];
  const excerpt = await responseExcerpt(response, secrets);
  const rateRemaining = responseHeader(response, "x-ratelimit-remaining");
  const resetRaw = responseHeader(response, "x-ratelimit-reset");
  const bodySaysRateLimit = /rate limit/i.test(excerpt);
  const rateLimited = status === 403 && (rateRemaining === "0" || bodySaysRateLimit);
  const resetSeconds = resetRaw == null ? Number.NaN : Number(resetRaw);
  const reset = Number.isFinite(resetSeconds) ? new Date(resetSeconds * 1000).toISOString() : null;

  let message;
  if (status === 401) {
    message = `GitHub rejected authentication while ${stage} (HTTP 401; credential source: ${authSource}).`;
  } else if (rateLimited) {
    message = `GitHub API rate limit exhausted while ${stage} (HTTP 403; credential source: ${authSource})${
      reset ? `; resets at ${reset}` : ""
    }.`;
  } else if (status === 403 && !credential) {
    message =
      `GitHub denied the unauthenticated request while ${stage} (HTTP 403). `
      + "Set GH_TOKEN or GITHUB_TOKEN, or place github_token.txt on the current user's Desktop.";
  } else if (status === 403) {
    message =
      `GitHub denied access while ${stage} (HTTP 403; credential source: ${authSource}). `
      + "Verify that the credential can read Heraklines/elite-redux and its dev-logs branch.";
  } else {
    message = `GitHub request failed while ${stage} (HTTP ${status}; credential source: ${authSource}).`;
  }
  if (excerpt) {
    message += ` GitHub response: ${excerpt}`;
  }

  const error = new Error(redactSecrets(message, secrets));
  error.name = "GithubRequestError";
  error.status = status;
  error.stage = stage;
  error.authSource = authSource;
  error.rateLimited = rateLimited;
  return error;
}

async function fetchGithubResponse(
  fetchImpl,
  url,
  { headers, credential, stage, signal, allowNotFound, readResponse, timeoutError, didTimeOut },
) {
  let response;
  try {
    response = await fetchImpl(url, { headers, signal });
  } catch (error) {
    if (signal.aborted && didTimeOut()) {
      throw timeoutError;
    }
    const detail = error instanceof Error ? error.message : String(error);
    const secrets = credential?.token ? [credential.token] : [];
    throw new Error(`Network failure while ${stage}: ${redactSecrets(detail, secrets)}`);
  }
  if (!response.ok && !(allowNotFound && response.status === 404)) {
    throw await classifyGithubHttpError(response, { stage, credential });
  }
  return { status: response.status, body: await readResponse(response) };
}

async function checkedFetch(
  fetchImpl,
  url,
  { headers, credential, stage, requestTimeoutMs, allowNotFound = false, readResponse = response => response },
) {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutId;
  const timeoutError = githubTimeoutError({ stage, credential, timeoutMs: requestTimeoutMs });

  try {
    return await Promise.race([
      fetchGithubResponse(fetchImpl, url, {
        headers,
        credential,
        stage,
        signal: controller.signal,
        allowNotFound,
        readResponse,
        timeoutError,
        didTimeOut: () => timedOut,
      }),
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(timeoutError);
        }, requestTimeoutMs);
      }),
    ]);
  } catch (error) {
    if (timedOut) {
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function runBounded(items, concurrency, worker, onOrderedOutcome) {
  const outcomes = new Array(items.length);
  let cursor = 0;
  let nextOutcome = 0;
  let stopReporting = false;
  let stopScheduling = false;

  const flushOrderedOutcomes = () => {
    if (stopReporting) {
      return;
    }
    while (nextOutcome < outcomes.length && outcomes[nextOutcome] != null) {
      const outcome = outcomes[nextOutcome];
      onOrderedOutcome(outcome, nextOutcome);
      nextOutcome++;
      if (!outcome.ok) {
        stopReporting = true;
        return;
      }
    }
  };

  const runWorker = async () => {
    while (!stopScheduling) {
      const index = cursor++;
      if (index >= items.length) {
        return;
      }
      try {
        outcomes[index] = { ok: true, value: await worker(items[index], index) };
      } catch (error) {
        outcomes[index] = { ok: false, error };
        stopScheduling = true;
      }
      flushOrderedOutcomes();
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker()));
  flushOrderedOutcomes();
  const failure = outcomes.find(outcome => outcome?.ok === false);
  if (failure) {
    throw failure.error;
  }
}

export async function pullDevLogs({
  fetchImpl = fetch,
  credential = selectGithubCredential(),
  outRoot = OUT_ROOT,
  concurrency = DEFAULT_CONCURRENCY,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  progressSteps = DEFAULT_PROGRESS_STEPS,
  fileExists = existsSync,
  makeDirectory = path => mkdirSync(path, { recursive: true }),
  writeFile = (path, contents) => writeFileSync(path, contents, "utf8"),
  renameFile = renameSync,
  log = console.log,
} = {}) {
  requirePositiveInteger(concurrency, "concurrency");
  requirePositiveInteger(requestTimeoutMs, "requestTimeoutMs");
  requirePositiveInteger(progressSteps, "progressSteps");
  const headers = buildGithubHeaders(credential);
  const refRes = await checkedFetch(fetchImpl, api(`git/ref/heads/${BRANCH}`), {
    headers,
    credential,
    stage: "reading the dev-logs branch reference",
    requestTimeoutMs,
    allowNotFound: true,
    readResponse: async response => (response.status === 404 ? null : response.json()),
  });
  if (refRes.status === 404) {
    log("No dev-logs branch yet - no remote logs have been sent.");
    return { downloaded: 0, total: 0, credentialSource: credential?.source ?? "none" };
  }

  const ref = refRes.body;
  const treeRes = await checkedFetch(fetchImpl, api(`git/trees/${ref.object.sha}?recursive=1`), {
    headers,
    credential,
    stage: "reading the dev-logs tree",
    requestTimeoutMs,
    readResponse: response => response.json(),
  });
  const tree = treeRes.body;
  if (tree.truncated === true) {
    throw new Error("GitHub returned a truncated dev-logs tree; refusing to report an incomplete pull.");
  }
  const logs = tree.tree
    .filter(entry => entry.type === "blob" && entry.path.startsWith("remote/") && entry.path.endsWith(".log"))
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
  const pending = [];
  for (const entry of logs) {
    const outPath = join(outRoot, entry.path);
    // Skip already-pulled files. A triaged report is marked "done" by renaming it
    // to `<name>.DONE.log` (in place); treat that twin as present so a done log is
    // never re-downloaded back into the folder.
    const donePath = outPath.replace(/\.log$/, ".DONE.log");
    if (fileExists(outPath) || fileExists(donePath)) {
      continue;
    }
    pending.push({ entry, outPath });
  }

  if (pending.length === 0) {
    log(`0 new log(s), ${logs.length} total on the branch.`);
    return { downloaded: 0, total: logs.length, credentialSource: credential?.source ?? "none" };
  }

  const effectiveConcurrency = Math.min(concurrency, pending.length);
  const progressEvery = Math.max(1, Math.ceil(pending.length / progressSteps));
  log(
    `${pending.length} new log(s) queued from ${logs.length} total; downloading with concurrency ${effectiveConcurrency}.`,
  );
  let downloaded = 0;
  await runBounded(
    pending,
    effectiveConcurrency,
    async ({ entry, outPath }) => {
      const raw = await checkedFetch(fetchImpl, `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${entry.path}`, {
        headers,
        credential,
        stage: `downloading ${entry.path}`,
        requestTimeoutMs,
        readResponse: response => response.text(),
      });
      makeDirectory(dirname(outPath));
      const partialPath = `${outPath}.partial`;
      writeFile(partialPath, raw.body);
      renameFile(partialPath, outPath);
      return outPath;
    },
    outcome => {
      if (!outcome.ok) {
        return;
      }
      downloaded++;
      if (downloaded % progressEvery === 0 || downloaded === pending.length) {
        log(`Progress: ${downloaded}/${pending.length} new log(s) downloaded through ${outcome.value}.`);
      }
    },
  );
  log(`${downloaded} new log(s), ${logs.length} total on the branch.`);
  return { downloaded, total: logs.length, credentialSource: credential?.source ?? "none" };
}

export async function main() {
  const credential = selectGithubCredential();
  await pullDevLogs({ credential });
}

function isDirectInvocation() {
  const scriptPath = process.argv[1];
  return Boolean(scriptPath) && import.meta.url === pathToFileURL(resolve(scriptPath)).href;
}

if (isDirectInvocation()) {
  main().catch(error => {
    const credential = (() => {
      try {
        return selectGithubCredential();
      } catch {
        return null;
      }
    })();
    console.error(
      redactSecrets(
        error instanceof Error ? error.message : String(error),
        credential?.token ? [credential.token] : [],
      ),
    );
    process.exitCode = 1;
  });
}
