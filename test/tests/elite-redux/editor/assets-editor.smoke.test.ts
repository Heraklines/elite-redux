/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

interface AssetsHarness {
  renderAssets(root: Element): void;
  setMediaSource(source: string): void;
  onMediaFileChange(input: HTMLInputElement): void;
  uploadMediaFile(): Promise<void>;
  setBgm(value: unknown[]): void;
  setTrainerSprites(value: unknown[]): void;
  upsertTrainerSprite(entry: Record<string, unknown>, assetsCommit?: string): void;
  firstAtlasFrame(atlas: unknown): { crop: unknown; sheet: unknown } | null;
}

const HARNESS_HTML = `<!doctype html><html><body>
  <div id="status"></div>
  <input id="password" value="staff-secret" />
  <div id="content"></div>
</body></html>`;

let win: JSDOM["window"];
let assets: AssetsHarness;

function q<T extends Element>(selector: string): T {
  const found = win.document.querySelector(selector);
  if (!found) {
    throw new Error(`missing ${selector}`);
  }
  return found as T;
}

beforeAll(() => {
  const appSource = readFileSync(resolve(process.cwd(), "editor/app.js"), "utf8");
  const stripped = appSource.replace(/\ninit\(\);\s*$/, "\n");
  const shim = `
    ;window.__assets = {
      renderAssets,
      setMediaSource,
      onMediaFileChange,
      uploadMediaFile,
      setBgm(value) { BGM_LIST = value; },
      setTrainerSprites(value) {
        TRAINER_SPRITES = value;
        trainerSpriteByKey.clear();
        for (const sprite of value) trainerSpriteByKey.set(sprite.key, sprite);
      },
      upsertTrainerSprite,
      firstAtlasFrame,
    };`;
  const dom = new JSDOM(HARNESS_HTML, { runScripts: "outside-only", pretendToBeVisual: true });
  win = dom.window;
  win.eval(stripped + shim);
  assets = win.__assets as AssetsHarness;
});

beforeEach(() => {
  assets.setBgm([]);
  assets.setTrainerSprites([]);
  assets.renderAssets(q("#content"));
});

describe("ER Editor Assets direct media upload", () => {
  it("renders a compact upload mode with media metadata and progress", () => {
    expect(q("[data-media-source='youtube']").classList.contains("active")).toBe(true);
    expect(q<HTMLElement>("[data-media-pane='upload']").hidden).toBe(true);

    assets.setMediaSource("upload");

    expect(q("[data-media-source='upload']").classList.contains("active")).toBe(true);
    expect(q<HTMLElement>("[data-media-pane='youtube']").hidden).toBe(true);
    expect(q<HTMLElement>("[data-media-pane='upload']").hidden).toBe(false);
    expect(q<HTMLInputElement>("#asset-media-file").accept).toContain(".mp4");
    expect(q<HTMLInputElement>("#asset-media-file").accept).toContain("audio/*");
    expect(q<HTMLProgressElement>("#asset-upload-progress").value).toBe(0);
  });

  it("uploads multiple chunks and queues conversion with authored metadata", async () => {
    assets.setMediaSource("upload");
    const partSize = 5 * 1024 * 1024;
    const file = new win.File([new Uint8Array(partSize + 17)], "Leader Theme.mp4", { type: "video/mp4" });
    const fileInput = q<HTMLInputElement>("#asset-media-file");
    Object.defineProperty(fileInput, "files", { configurable: true, value: [file] });
    assets.onMediaFileChange(fileInput);
    expect(q<HTMLInputElement>("#asset-upload-title").value).toBe("Leader Theme");
    expect(q("#asset-media-file-name").textContent).toContain("Leader Theme.mp4");

    q<HTMLInputElement>("#asset-upload-artist").value = "Team Composer";
    q<HTMLSelectElement>("#asset-upload-license").value = "permission";
    q<HTMLInputElement>("#asset-upload-attribution").value = "Used with permission";
    q<HTMLInputElement>("#asset-upload-prefix").value = "trainer_custom";
    q<HTMLInputElement>("#asset-upload-rights").checked = true;

    const requests: { url: string; init?: RequestInit }[] = [];
    const fetchMock = vi.fn(async (urlValue: string | URL | Request, init?: RequestInit) => {
      const url = String(urlValue);
      requests.push({ url, ...(init ? { init } : {}) });
      if (url.endsWith("/media-upload/start")) {
        return Response.json(
          { ok: true, id: "11111111-1111-4111-8111-111111111111", uploadId: "up-1", partSize },
          { status: 201 },
        );
      }
      if (url.includes("/parts/")) {
        const partNumber = Number(url.match(/\/parts\/(\d+)/)?.[1]);
        return Response.json({ ok: true, part: { partNumber, etag: `etag-${partNumber}` } });
      }
      if (url.endsWith("/media-upload/complete")) {
        return Response.json({ ok: true, queued: true, fileName: file.name }, { status: 202 });
      }
      if (url.endsWith("/media-jobs")) {
        return Response.json({ ok: true, runs: [] });
      }
      throw new Error(`unexpected request ${url}`);
    });
    win.fetch = fetchMock as never;

    await assets.uploadMediaFile();

    const partRequests = requests.filter(request => request.url.includes("/parts/"));
    expect(partRequests).toHaveLength(2);
    expect((partRequests[0].init?.body as Blob).size).toBe(partSize);
    expect((partRequests[1].init?.body as Blob).size).toBe(17);
    const complete = requests.find(request => request.url.endsWith("/media-upload/complete"));
    const payload = JSON.parse(String(complete?.init?.body));
    expect(payload).toMatchObject({
      title: "Leader Theme",
      artist: "Team Composer",
      license: "permission",
      attribution: "Used with permission",
      keyPrefix: "trainer_custom",
      rightsConfirmed: true,
      parts: [
        { partNumber: 1, etag: "etag-1" },
        { partNumber: 2, etag: "etag-2" },
      ],
    });
    expect(q<HTMLProgressElement>("#asset-upload-progress").value).toBe(100);
    expect(q("#asset-upload-progress-label").textContent).toBe("Queued for conversion");
  });

  it("rejects incomplete CC BY metadata before uploading the file", async () => {
    assets.setMediaSource("upload");
    const fileInput = q<HTMLInputElement>("#asset-media-file");
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new win.File([new Uint8Array(32)], "CC Theme.mp3", { type: "audio/mpeg" })],
    });
    assets.onMediaFileChange(fileInput);
    q<HTMLSelectElement>("#asset-upload-license").value = "cc-by";
    q<HTMLInputElement>("#asset-upload-rights").checked = true;
    const fetchMock = vi.fn();
    win.fetch = fetchMock as never;

    await expect(assets.uploadMediaFile()).rejects.toThrow("attribution and a public source URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the specific direct-upload failure beside the progress bar", async () => {
    assets.setMediaSource("upload");
    const fileInput = q<HTMLInputElement>("#asset-media-file");
    Object.defineProperty(fileInput, "files", {
      configurable: true,
      value: [new win.File([new Uint8Array(32)], "Theme.mp3", { type: "audio/mpeg" })],
    });
    assets.onMediaFileChange(fileInput);
    q<HTMLInputElement>("#asset-upload-rights").checked = true;
    win.fetch = vi.fn(async () => Response.json({ error: "media storage unavailable" }, { status: 503 })) as never;

    await expect(assets.uploadMediaFile()).rejects.toThrow("media storage unavailable");
    expect(q("#asset-upload-progress-label").textContent).toBe("Upload failed: media storage unavailable");
  });

  it("renders uploaded trainer art thumbnails and accepts the upload atlas format", () => {
    const hashAtlas = {
      frames: { "0001.png": { frame: { x: 0, y: 0, w: 42, h: 64 } } },
      meta: { size: { w: 42, h: 64 } },
    };
    expect(assets.firstAtlasFrame(hashAtlas)).toEqual({
      crop: { x: 0, y: 0, w: 42, h: 64 },
      sheet: { w: 42, h: 64 },
    });

    win.fetch = vi.fn(async () => Response.json(hashAtlas)) as never;
    assets.setTrainerSprites([
      {
        key: "staff_pair",
        spriteKey: "staff_pair",
        label: "Staff Pair",
        genders: true,
        kind: "leader",
        tags: ["staff"],
        author: "Artist",
        license: "permission",
      },
    ]);
    assets.renderAssets(q("#content"));

    const previews = win.document.querySelectorAll("[data-asset-sprite-preview]");
    expect(previews).toHaveLength(2);
    expect(previews[0].getAttribute("data-asset-sprite-preview")).toBe("staff_pair_m");
    expect(previews[1].getAttribute("data-asset-sprite-preview")).toBe("staff_pair_f");
    expect(q(".asset-sprite-track").textContent).toContain("Artist: Artist");
  });

  it("inserts a successful sprite upload into the live catalog immediately", () => {
    assets.upsertTrainerSprite(
      {
        key: "new_staff",
        spriteKey: "new_staff",
        label: "New Staff",
        genders: false,
        kind: "other",
        tags: [],
      },
      "abc123",
    );
    win.fetch = vi.fn(async () =>
      Response.json({
        frames: { "0001.png": { frame: { x: 0, y: 0, w: 32, h: 48 } } },
        meta: { size: { w: 32, h: 48 } },
      }),
    ) as never;
    assets.renderAssets(q("#content"));

    const preview = q<HTMLElement>("[data-asset-sprite-preview='new_staff']");
    expect(preview.dataset.assetSpriteBase).toContain("er-assets@abc123/images/trainer");
    expect(q("[data-asset-sprite='new_staff']")).toBeTruthy();
  });
});
