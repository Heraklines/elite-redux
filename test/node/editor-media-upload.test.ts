/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../../workers/er-editor-api/src/index";

interface StoredObject {
  bytes: Uint8Array;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

class MockR2Bucket {
  readonly objects = new Map<string, StoredObject>();
  private readonly sessions = new Map<
    string,
    {
      key: string;
      options?: {
        httpMetadata?: { contentType?: string };
        customMetadata?: Record<string, string>;
      };
      parts: Map<number, Uint8Array>;
    }
  >();

  async createMultipartUpload(
    key: string,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ) {
    const uploadId = `upload-${this.sessions.size + 1}`;
    this.sessions.set(uploadId, {
      key,
      ...(options ? { options } : {}),
      parts: new Map<number, Uint8Array>(),
    });
    return this.multipart(key, uploadId);
  }

  resumeMultipartUpload(key: string, uploadId: string) {
    return this.multipart(key, uploadId);
  }

  async get(key: string) {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }
    return {
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(object.bytes);
          controller.close();
        },
      }),
      size: object.bytes.byteLength,
      httpEtag: '"mock-etag"',
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
    };
  }

  async head(key: string) {
    const object = this.objects.get(key);
    if (!object) {
      return null;
    }
    return {
      size: object.bytes.byteLength,
      httpEtag: '"mock-etag"',
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
    };
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  private multipart(key: string, uploadId: string) {
    return {
      uploadId,
      uploadPart: async (partNumber: number, stream: ReadableStream) => {
        const session = this.sessions.get(uploadId);
        if (!session || session.key !== key) {
          throw new Error("unknown upload");
        }
        session.parts.set(partNumber, new Uint8Array(await new Response(stream).arrayBuffer()));
        return { partNumber, etag: `etag-${partNumber}` };
      },
      complete: async (parts: { partNumber: number; etag: string }[]) => {
        const session = this.sessions.get(uploadId);
        if (!session || session.key !== key) {
          throw new Error("unknown upload");
        }
        const length = parts.reduce((total, part) => total + (session.parts.get(part.partNumber)?.byteLength || 0), 0);
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const part of parts) {
          const value = session.parts.get(part.partNumber);
          if (!value) {
            throw new Error("missing part");
          }
          bytes.set(value, offset);
          offset += value.byteLength;
        }
        const stored: StoredObject = { bytes };
        if (session.options?.httpMetadata) {
          stored.httpMetadata = session.options.httpMetadata;
        }
        if (session.options?.customMetadata) {
          stored.customMetadata = session.options.customMetadata;
        }
        this.objects.set(key, stored);
        this.sessions.delete(uploadId);
      },
      abort: async () => {
        this.sessions.delete(uploadId);
      },
    };
  }
}

function env(bucket: MockR2Bucket) {
  return {
    GITHUB_TOKEN: "token",
    GITHUB_REPO: "Heraklines/elite-redux",
    GITHUB_BRANCH: "feat/elite-redux-port",
    GITHUB_WORKFLOW_FILE: "deploy-staging.yml",
    MEDIA_IMPORT_WORKFLOW_FILE: "deploy-staging.yml",
    EDITOR_PASSWORD: "staff-secret",
    ALLOWED_ORIGIN: "*",
    MEDIA_UPLOADS: bucket,
  };
}

async function call(request: Request, bucket: MockR2Bucket) {
  return worker.fetch(request, env(bucket) as never);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ER Editor direct media upload Worker", () => {
  it("advertises the multipart password header through CORS", async () => {
    const response = await call(
      new Request("https://editor-api.example/media-upload/start", { method: "OPTIONS" }),
      new MockR2Bucket(),
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toContain("X-Editor-Password");
    expect(response.headers.get("Access-Control-Allow-Methods")).toContain("DELETE");
  });

  it("rejects unsupported direct-upload extensions before opening R2", async () => {
    const response = await call(
      new Request("https://editor-api.example/media-upload/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "staff-secret",
          fileName: "notes.txt",
          fileSize: 10,
          contentType: "text/plain",
        }),
      }),
      new MockR2Bucket(),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("supported") });
  });

  it("requires attribution and a source URL for CC BY uploads", async () => {
    const response = await call(
      new Request("https://editor-api.example/media-upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "staff-secret",
          keyPrefix: "trainer_custom",
          title: "Trainer Theme",
          license: "cc-by",
          rightsConfirmed: true,
        }),
      }),
      new MockR2Bucket(),
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining("attribution") });
  });

  it("rejects a completed object that differs from the declared file size", async () => {
    const bucket = new MockR2Bucket();
    const dispatch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", dispatch);

    const start = await call(
      new Request("https://editor-api.example/media-upload/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "staff-secret",
          fileName: "Trainer Theme.mp4",
          fileSize: 5,
          contentType: "video/mp4",
        }),
      }),
      bucket,
    );
    const session = (await start.json()) as { id: string; uploadId: string };
    const part = await call(
      new Request(`https://editor-api.example/media-upload/${session.id}/parts/1?uploadId=${session.uploadId}`, {
        method: "POST",
        headers: { "X-Editor-Password": "staff-secret" },
        body: new Uint8Array([1, 2, 3, 4]),
      }),
      bucket,
    );
    const partResult = (await part.json()) as { part: { partNumber: number; etag: string } };

    const complete = await call(
      new Request("https://editor-api.example/media-upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "staff-secret",
          id: session.id,
          uploadId: session.uploadId,
          parts: [partResult.part],
          keyPrefix: "trainer_custom",
          title: "Trainer Theme",
          license: "permission",
          rightsConfirmed: true,
        }),
      }),
      bucket,
    );
    expect(complete.status).toBe(400);
    expect(dispatch).not.toHaveBeenCalled();
    expect(bucket.objects.size).toBe(0);
  });

  it("uploads, dispatches, serves, and deletes a private media object", async () => {
    const bucket = new MockR2Bucket();
    const dispatches: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        dispatches.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 204 });
      }),
    );

    const start = await call(
      new Request("https://editor-api.example/media-upload/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "staff-secret",
          fileName: "Trainer Theme.mp4",
          fileSize: 4,
          contentType: "video/mp4",
        }),
      }),
      bucket,
    );
    expect(start.status).toBe(201);
    const session = (await start.json()) as { id: string; uploadId: string };

    const part = await call(
      new Request(`https://editor-api.example/media-upload/${session.id}/parts/1?uploadId=${session.uploadId}`, {
        method: "POST",
        headers: { "X-Editor-Password": "staff-secret" },
        body: new Uint8Array([1, 2, 3, 4]),
      }),
      bucket,
    );
    expect(part.status).toBe(200);
    const partResult = (await part.json()) as { part: { partNumber: number; etag: string } };

    const complete = await call(
      new Request("https://editor-api.example/media-upload/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: "staff-secret",
          id: session.id,
          uploadId: session.uploadId,
          parts: [partResult.part],
          keyPrefix: "trainer_custom",
          title: "Trainer Theme",
          artist: "Staff Composer",
          license: "permission",
          attribution: "Used with permission",
          deployStaging: true,
          rightsConfirmed: true,
        }),
      }),
      bucket,
    );
    expect(complete.status).toBe(202);
    expect(dispatches).toHaveLength(1);
    const dispatch = dispatches[0] as {
      ref: string;
      inputs: Record<string, string>;
    };
    expect(dispatch.ref).toBe("feat/elite-redux-port");
    expect(dispatch.inputs.upload_name).toBe("Trainer Theme.mp4");
    expect(dispatch.inputs.upload_title).toBe("Trainer Theme");
    expect(dispatch.inputs.upload_license).toBe("permission");
    expect(dispatch.inputs.deploy_staging).toBe("true");

    const download = await call(new Request(dispatch.inputs.upload_url), bucket);
    expect(download.status).toBe(200);
    expect([...new Uint8Array(await download.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    expect(download.headers.get("Content-Type")).toBe("video/mp4");

    const cleanup = await call(new Request(dispatch.inputs.upload_url, { method: "DELETE" }), bucket);
    expect(cleanup.status).toBe(200);
    expect(bucket.objects.size).toBe(0);
  });
});
