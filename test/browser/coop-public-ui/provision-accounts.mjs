#!/usr/bin/env node
/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const githubEnv = required("GITHUB_ENV");
const runId = required("GITHUB_RUN_ID").replaceAll(/\D/gu, "");
const attempt = (process.env.GITHUB_RUN_ATTEMPT?.replaceAll(/\D/gu, "") || "1").slice(-2);
const suffix = `${runId.slice(-8)}${attempt}`;

function prepare(prefix) {
  // Include a per-invocation random tag so two JOBS in the same workflow run (same
  // GITHUB_RUN_ID) - e.g. the solo-nav and campaign gameplay jobs - never register the
  // SAME username and collide (409, mismatched passwords, auth timeout). The run-id
  // prefix stays for traceability; the random tag guarantees uniqueness.
  const username = `cui${prefix}${suffix}${randomBytes(3).toString("hex")}`;
  const password = `${randomBytes(18).toString("base64url")}A1!`;
  // The browser creates these accounts through the visible registration form. Mask both fields first.
  process.stdout.write(`::add-mask::${username}\n::add-mask::${password}\n`);
  return { username, password };
}

const host = prepare("h");
const guest = prepare("g");
appendFileSync(
  githubEnv,
  [
    `COOP_UI_HOST_USERNAME=${host.username}`,
    `COOP_UI_HOST_PASSWORD=${host.password}`,
    `COOP_UI_GUEST_USERNAME=${guest.username}`,
    `COOP_UI_GUEST_PASSWORD=${guest.password}`,
    "COOP_UI_FIXTURE_PROVISIONING=public-registration-form-v1",
    "",
  ].join("\n"),
);
process.stdout.write("Prepared one masked account pair for visible public-UI registration\n");
