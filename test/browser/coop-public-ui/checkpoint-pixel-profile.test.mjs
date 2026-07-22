/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Per-profile checkpoint capture trim (branch coop/fix-replay-pacing): the DEPTH lane
// (animations-skipped-depth) captures DOM-only checkpoints (no ~9s per-checkpoint pixel PNG);
// the SURFACE + mystery lanes keep the pixel oracle. Config-driven + overridable, and the
// DOM/cookie/canvas isolation proof still runs on EVERY checkpoint (no evidence-class weakening).

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadConfig } from "./config.mjs";
import { EvidenceSink } from "./evidence.mjs";

const REQUIRED_ENV = {
  COOP_UI_BASE_URL: "https://example.test",
  COOP_UI_HOST_USERNAME: "host",
  COOP_UI_HOST_PASSWORD: "host-pw",
  COOP_UI_GUEST_USERNAME: "guest",
  COOP_UI_GUEST_PASSWORD: "guest-pw",
};

function withEnv(overrides, callback) {
  const keys = [
    ...Object.keys(REQUIRED_ENV),
    ...Object.keys(overrides),
    "COOP_UI_RENDER_PROFILE",
    "COOP_UI_CHECKPOINT_PIXEL",
  ];
  const previous = new Map(keys.map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries({ ...REQUIRED_ENV, ...overrides })) {
      process.env[key] = value;
    }
    return callback();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value == null) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("config: the depth profile defaults to DOM-only checkpoints, surface/unset keep pixel capture", () => {
  withEnv({ COOP_UI_RENDER_PROFILE: "animations-skipped-depth" }, () => {
    assert.equal(loadConfig().checkpointPixelCapture, false, "depth lane is DOM-only by default");
  });
  withEnv({ COOP_UI_RENDER_PROFILE: "animations-on-surface" }, () => {
    assert.equal(loadConfig().checkpointPixelCapture, true, "surface lane keeps the pixel oracle");
  });
  withEnv({}, () => {
    delete process.env.COOP_UI_RENDER_PROFILE;
    assert.equal(loadConfig().checkpointPixelCapture, true, "unset profile keeps the pixel oracle");
  });
});

test("config: COOP_UI_CHECKPOINT_PIXEL overrides the profile default in both directions", () => {
  withEnv({ COOP_UI_RENDER_PROFILE: "animations-skipped-depth", COOP_UI_CHECKPOINT_PIXEL: "1" }, () => {
    assert.equal(loadConfig().checkpointPixelCapture, true, "explicit on wins over the depth default");
  });
  withEnv({ COOP_UI_RENDER_PROFILE: "animations-on-surface", COOP_UI_CHECKPOINT_PIXEL: "0" }, () => {
    assert.equal(loadConfig().checkpointPixelCapture, false, "explicit off wins over the surface default");
  });
});

test("EvidenceSink: the pixel-capture flag defaults to true and honours an explicit value", () => {
  assert.equal(new EvidenceSink("a", ".").pixelCheckpointCapture, true, "default is pixel capture on");
  assert.equal(new EvidenceSink("b", ".", [], 0, false, false).pixelCheckpointCapture, false, "false = DOM-only");
  assert.equal(new EvidenceSink("c", ".", [], 0, false, true).pixelCheckpointCapture, true, "true = pixel capture");
});

function domPage(canvases = [{ width: 480, height: 270, clientWidth: 480, clientHeight: 270 }]) {
  return {
    bringToFront: async () => {},
    evaluate: async () => ({
      title: "Elite Redux",
      url: "https://example.test/",
      bodyText: "battle",
      canvases,
      inputs: [],
      storage: [],
    }),
  };
}

const noCookies = { cookies: async () => [] };

test("checkpoint: a DOM-only seat records a deliberate pixel skip and NEVER a pixel-integrity capture", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coop-ff-dom-"));
  try {
    const sink = new EvidenceSink("seat", dir, [], 0, false, false);
    await sink.init();
    const dom = await sink.checkpoint(domPage(), noCookies, "wave-1-cleared");

    assert.ok(dom.canvases.length > 0, "the DOM/canvas capture still ran");
    const kinds = sink.events.map(event => event.kind);
    assert.ok(kinds.includes("checkpoint-pixel-skipped"), "the deliberate profile skip was recorded");
    const skip = sink.events.find(event => event.kind === "checkpoint-pixel-skipped");
    assert.equal(skip.reason, "profile-dom-only");
    assert.ok(!kinds.includes("checkpoint-pixel-integrity"), "no pixel-integrity PNG was captured");
    assert.ok(kinds.includes("checkpoint"), "the checkpoint (DOM/cookie) evidence was still emitted");
    await sink.flush();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("checkpoint: the DOM-only path STILL enforces the non-zero game canvas isolation proof", async () => {
  const dir = await mkdtemp(join(tmpdir(), "coop-ff-canvas-"));
  try {
    const sink = new EvidenceSink("seat", dir, [], 0, false, false);
    await sink.init();
    await assert.rejects(
      () => sink.checkpoint(domPage([]), noCookies, "wave-2-cleared"),
      /no non-zero game canvas/u,
      "a blank/zero canvas still fails closed even in DOM-only mode",
    );
    await sink.flush();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
