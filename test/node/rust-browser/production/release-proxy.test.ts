import { describe, expect, it } from "vitest";
import { handleM9ReleaseObject } from "../../../../workers/er-save-api/src/m9-production";

interface StoredObject {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

describe("M9 content-addressed release proxy", () => {
  it("serves only digest-matching immutable artifacts", async () => {
    const bytes = Uint8Array.of(1, 2, 3);
    const digest = await sha256(bytes);
    const objects = new Map<string, StoredObject>([[`release-1/${digest}/kernel.wasm`, stored(bytes)]]);
    const url = new URL(`https://save.example/__m9_releases/release-1/${digest}/kernel.wasm`);
    const response = await handleM9ReleaseObject(new Request(url), url, environment(objects), {
      "access-control-allow-origin": "https://game.example",
    });
    if (response == null) {
      throw new Error("release artifact route was not admitted");
    }
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/wasm");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);

    const corrupt = new URL(`https://save.example/__m9_releases/release-1/${"0".repeat(64)}/kernel.wasm`);
    objects.set(`release-1/${"0".repeat(64)}/kernel.wasm`, stored(bytes));
    await expect(handleM9ReleaseObject(new Request(corrupt), corrupt, environment(objects), {})).resolves.toMatchObject(
      { status: 502 },
    );
  });

  it("rejects unsigned manifests and ignores unrelated paths", async () => {
    const objects = new Map<string, StoredObject>([
      ["manifests/release-1.json", stored(new TextEncoder().encode(JSON.stringify({ payload: {} })))],
    ]);
    const manifest = new URL("https://save.example/__m9_manifests/release-1.json");
    await expect(
      handleM9ReleaseObject(new Request(manifest), manifest, environment(objects), {}),
    ).resolves.toMatchObject({ status: 502 });
    const unrelated = new URL("https://save.example/account/info");
    await expect(
      handleM9ReleaseObject(new Request(unrelated), unrelated, environment(objects), {}),
    ).resolves.toBeNull();
  });
});

function environment(objects: Map<string, StoredObject>) {
  return {
    DB: {} as D1Database,
    M9_RELEASES: {
      async get(key: string) {
        return objects.get(key) ?? null;
      },
    },
    M9_RELEASE_SIGNING_PRIVATE_KEY: "unused",
  };
}

function stored(bytes: Uint8Array): StoredObject {
  const immutable = Uint8Array.from(bytes);
  return {
    async arrayBuffer() {
      return Uint8Array.from(immutable).buffer;
    },
    async text() {
      return new TextDecoder().decode(immutable);
    },
  };
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
