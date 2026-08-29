#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

function fail(message) {
  throw new Error(`M6 semantic diff: ${message}`);
}

const [expectedRoot, actualRoot] = process.argv.slice(2);
if (!expectedRoot || !actualRoot) fail("usage: expected-root actual-root");

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function files(root) {
  return readdirSync(resolve(root), { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .sort(compareText);
}

function digest(text) {
  return createHash("sha256").update(text).digest("hex");
}

function firstDifference(expected, actual, path = "$") {
  if (Object.is(expected, actual)) return null;
  if (expected === null || actual === null || typeof expected !== "object" || typeof actual !== "object") {
    return { path, expected, actual };
  }
  if (Array.isArray(expected) !== Array.isArray(actual)) return { path, expected, actual };
  if (Array.isArray(expected)) {
    if (expected.length !== actual.length) return { path: `${path}.length`, expected: expected.length, actual: actual.length };
    for (let index = 0; index < expected.length; index += 1) {
      const difference = firstDifference(expected[index], actual[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  const expectedKeys = Object.keys(expected).sort(compareText);
  const actualKeys = Object.keys(actual).sort(compareText);
  if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) return { path: `${path}.__keys`, expected: expectedKeys, actual: actualKeys };
  for (const key of expectedKeys) {
    const difference = firstDifference(expected[key], actual[key], `${path}.${key}`);
    if (difference) return difference;
  }
  return null;
}

const expectedFiles = files(expectedRoot);
const actualFiles = files(actualRoot);
if (JSON.stringify(expectedFiles) !== JSON.stringify(actualFiles)) {
  console.log(`::error title=M6 semantic inventory mismatch::expected=${JSON.stringify(expectedFiles)} actual=${JSON.stringify(actualFiles)}`);
  process.exit(1);
}

for (const name of expectedFiles) {
  const expectedText = readFileSync(resolve(expectedRoot, name), "utf8").replace(/\r\n?/gu, "\n");
  const actualText = readFileSync(resolve(actualRoot, name), "utf8").replace(/\r\n?/gu, "\n");
  if (expectedText === actualText) continue;
  let detail;
  try {
    detail = firstDifference(JSON.parse(expectedText), JSON.parse(actualText));
  } catch (error) {
    detail = { parse_error: error instanceof Error ? error.message : String(error) };
  }
  const message = [
    `file=${basename(name)}`,
    `expected_sha256=${digest(expectedText)}`,
    `actual_sha256=${digest(actualText)}`,
    `first_difference=${JSON.stringify(detail)}`,
  ].join(" ");
  console.log(`::error file=rust/fixtures/m6/${name},line=1,title=M6 semantic catalog mismatch::${message}`);
  process.exit(1);
}

console.log("M6 semantic diff: catalogs match");
