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

const apiOrigin = new URL(required("COOP_UI_API_ORIGIN"));
if (apiOrigin.protocol !== "https:" || apiOrigin.hostname === "api.pokerogue.net") {
  throw new Error("public-UI fixtures may be provisioned only on a non-production HTTPS API");
}
const githubEnv = required("GITHUB_ENV");
const runId = required("GITHUB_RUN_ID").replaceAll(/\D/gu, "");
const attempt = (process.env.GITHUB_RUN_ATTEMPT?.replaceAll(/\D/gu, "") || "1").slice(-2);
const suffix = `${runId.slice(-8)}${attempt}`;

async function provision(prefix) {
  const username = `cui${prefix}${suffix}`;
  const password = `${randomBytes(18).toString("base64url")}A1!`;
  const response = await fetch(new URL("/account/register", apiOrigin), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username, password }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const reason = (await response.text()).trim().slice(0, 160);
    throw new Error(`beta account fixture registration failed (${response.status}): ${reason || response.statusText}`);
  }
  // These accounts exist only for this beta journey. Mask both identity and password before exporting them.
  process.stdout.write(`::add-mask::${username}\n::add-mask::${password}\n`);
  return { username, password };
}

const host = await provision("h");
await new Promise(resolveDelay => setTimeout(resolveDelay, 500));
const guest = await provision("g");
appendFileSync(
  githubEnv,
  [
    `COOP_UI_HOST_USERNAME=${host.username}`,
    `COOP_UI_HOST_PASSWORD=${host.password}`,
    `COOP_UI_GUEST_USERNAME=${guest.username}`,
    `COOP_UI_GUEST_PASSWORD=${guest.password}`,
    "COOP_UI_FIXTURE_PROVISIONING=beta-account-register-v1",
    "",
  ].join("\n"),
);
process.stdout.write("Provisioned one isolated non-production account pair for the public-UI journey\n");
