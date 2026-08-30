import { resolve } from "node:path";
import { expect, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
let cloudBytes = Buffer.alloc(0);
let cloudRevision = 0;

const html = `<!doctype html><html><body><div id="mobile"><button data-rust-physical-key="Space">Action</button></div><script type="module">
import { ProductionIndexedDbAdapterV1 } from "/src/rust-browser/adapters/indexeddb-adapter.ts";
import { CloudSaveAdapterV1 } from "/src/rust-browser/adapters/cloud-save-adapter.ts";
import { installAtomicReleaseCache, loadAtomicReleaseCache } from "/src/rust-browser/adapters/release-cache.ts";
import { MobileInputAdapterV1 } from "/src/rust-browser/adapters/mobile-input-adapter.ts";
import { RustBrowserTransportAdapterV1 } from "/src/rust-browser/adapters/transport-adapter.ts";
const identity = { browser_worker_protocol: 1, frame_envelope_version: 1, authority_protocol: "er-coop-47", release_id: "m8-test", compatible_releases: [], mechanical_identity: "m1", content_hash: "c1", material_schema: 5, save_schema: 1, browser_kernel_abi: 1, active_model_identity: "model-1", authority_runtime: "RUST" };
const leftFrameKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
const rightFrameKeys = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
const leftFramePublic = Array.from(new Uint8Array(await crypto.subtle.exportKey("raw", leftFrameKeys.publicKey)));
const rightFramePublic = Array.from(new Uint8Array(await crypto.subtle.exportKey("raw", rightFrameKeys.publicKey)));
function frameContexts(connectionGeneration) {
  const binding = { schema_version: 1, binding_id: "binding-" + connectionGeneration, party_id: "party-1", session_id: "session-1", release_id: "m8-test", authority_protocol: "er-coop-47", authority_seat_id: 0, participants: [{ participant_id: "left", seat_id: 0, frame_public_key: leftFramePublic, connection_generation: connectionGeneration }, { participant_id: "right", seat_id: 1, frame_public_key: rightFramePublic, connection_generation: connectionGeneration }], issued_at: 1, expires_at: Number.MAX_SAFE_INTEGER };
  return { left: { binding, local_participant_id: "left", peer_participant_id: "right", local_private_key: leftFrameKeys.privateKey }, right: { binding, local_participant_id: "right", peer_participant_id: "left", local_private_key: rightFrameKeys.privateKey } };
}
async function waitUntil(predicate) {
  const { promise, resolve, reject } = Promise.withResolvers();
  let frames = 0;
  const tick = () => {
    if (predicate()) { resolve(); return; }
    frames += 1;
    if (frames > 600) { reject(new Error("browser adapter condition did not settle")); return; }
    requestAnimationFrame(tick);
  };
  tick();
  return promise;
}
function waitIce(connection) {
  if (connection.iceGatheringState === "complete") return Promise.resolve();
  const { promise, resolve } = Promise.withResolvers();
  connection.addEventListener("icegatheringstatechange", () => {
    if (connection.iceGatheringState === "complete") resolve();
  });
  return promise;
}
async function rtcPair(left, right, leftEvents, rightEvents, connectionGeneration) {
  const leftConnected = leftEvents.filter(event => event.kind === "TRANSPORT_CHANGED" && event.value.connected).length;
  const rightConnected = rightEvents.filter(event => event.kind === "TRANSPORT_CHANGED" && event.value.connected).length;
  const a = new RTCPeerConnection(); const b = new RTCPeerConnection();
  const contexts = frameContexts(connectionGeneration);
  b.ondatachannel = event => right.attach(event.channel, contexts.right);
  const channel = a.createDataChannel("rust-kernel", { ordered: true });
  const generation = left.attach(channel, contexts.left);
  await a.setLocalDescription(await a.createOffer()); await waitIce(a);
  await b.setRemoteDescription(a.localDescription);
  await b.setLocalDescription(await b.createAnswer()); await waitIce(b);
  await a.setRemoteDescription(b.localDescription);
  await waitUntil(() => leftEvents.filter(event => event.kind === "TRANSPORT_CHANGED" && event.value.connected).length > leftConnected && rightEvents.filter(event => event.kind === "TRANSPORT_CHANGED" && event.value.connected).length > rightConnected);
  return { a, b, generation };
}
(async () => {
  const indexed = new ProductionIndexedDbAdapterV1({ releaseIdentity: "m8-test", executionIdentity: "exec", contentIdentity: "content" });
  const revision = await indexed.save("slot", null, new Uint8Array([1,2,3]));
  const loaded = await indexed.load("slot");
  let conflict = false; try { await indexed.save("slot", null, new Uint8Array([4])); } catch { conflict = true; }

  const cloud = new CloudSaveAdapterV1({ endpoint: new URL("/p33-save", location.href), allowedOrigin: location.origin, releaseIdentity: "m8-test" });
  const cloudRevision = await cloud.compareAndSwap("slot", null, new Uint8Array([5,6]));
  const cloudLoaded = await cloud.load("slot");

  const asset = new Uint8Array([9,8,7]);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", asset))).map(value => value.toString(16).padStart(2,"0")).join("");
  await installAtomicReleaseCache(caches, { schema_version: 1, release_id: "m8-test", browser_sha: "b2ed1a6eb050a18d5f335ec826e01b7b425ce311", rust_sha: "ea57c3cedd5dbc5856baf3748c0f03a7dc2c9273", assets: [{ url: new URL("/asset.bin", location.href).href, sha256: digest }] });
  const cached = await loadAtomicReleaseCache(caches, "m8-test");

  const inputEvents = []; const mobile = new MobileInputAdapterV1({ root: document.querySelector("#mobile"), emit: event => inputEvents.push(event) }); mobile.start();
  const button = document.querySelector("[data-rust-physical-key]");
  button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
  button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1 }));

  const leftEvents = []; const rightEvents = [];
  const left = new RustBrowserTransportAdapterV1({ compatibility: identity, emit: event => leftEvents.push(event) });
  const right = new RustBrowserTransportAdapterV1({ compatibility: identity, emit: event => rightEvents.push(event) });
  const first = await rtcPair(left, right, leftEvents, rightEvents, 1);
  await left.send(first.generation, new Uint8Array([7,8]));
  await waitUntil(() => rightEvents.some(event => event.kind === "NETWORK_FRAME"));
  first.a.close(); first.b.close();
  const second = await rtcPair(left, right, leftEvents, rightEvents, 2);
  let staleRejected = false; try { await left.send(first.generation, new Uint8Array([1])); } catch { staleRejected = true; }

  globalThis.__m8PlatformResult = { revision, loaded: Array.from(loaded.bytes), conflict, cloudRevision, cloudLoaded: Array.from(cloudLoaded.bytes), cachedRelease: cached.manifest.release_id, inputKinds: inputEvents.map(event => event.value?.kind), frame: rightEvents.findLast(event => event.kind === "NETWORK_FRAME")?.value.bytes, staleRejected, rejoinGeneration: second.generation };
  second.a.close(); second.b.close(); left.dispose(); right.dispose(); mobile.dispose(); cloud.dispose(); await indexed.dispose();
})().catch(error => { globalThis.__m8PlatformError = String(error?.stack ?? error); });
</script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m8-platform-fixture",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url === "/m8-platform.html") {
              response.setHeader("content-type", "text/html; charset=utf-8");
              response.end(html);
              return;
            }
            if (request.url === "/asset.bin") {
              response.end(Buffer.from([9, 8, 7]));
              return;
            }
            if (request.url?.startsWith("/p33-save")) {
              response.setHeader("etag", String(cloudRevision));
              if (request.method === "GET") {
                if (cloudRevision === 0) {
                  response.statusCode = 404;
                  response.end();
                } else {
                  response.end(cloudBytes);
                }
                return;
              }
              if (request.method === "PUT") {
                const expected = request.headers["if-match"];
                if (
                  (expected === "*" && cloudRevision !== 0)
                  || (expected !== "*" && expected !== String(cloudRevision))
                ) {
                  response.statusCode = 412;
                  response.end();
                  return;
                }
                const chunks: Buffer[] = [];
                request.on("data", chunk => chunks.push(chunk));
                request.on("end", () => {
                  cloudBytes = Buffer.concat(chunks);
                  cloudRevision += 1;
                  response.setHeader("etag", String(cloudRevision));
                  response.end();
                });
                return;
              }
            }
            next();
          });
        },
      },
    ],
  });
  await server.listen();
});

test.afterAll(async () => server.close());

test("IndexedDB cloud cache mobile and WebRTC adapters remain opaque and generation-fenced", async ({ page }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish platform fixture");
  }
  await page.goto(new URL("m8-platform.html", address).href);
  await page.waitForFunction(() => "__m8PlatformResult" in globalThis || "__m8PlatformError" in globalThis, undefined, {
    timeout: 30_000,
  });
  const state = await page.evaluate(() => ({
    result: globalThis.__m8PlatformResult,
    error: globalThis.__m8PlatformError,
  }));
  expect(state.error).toBeUndefined();
  expect(state.result).toMatchObject({
    revision: 1,
    loaded: [1, 2, 3],
    conflict: true,
    cloudLoaded: [5, 6],
    cachedRelease: "m8-test",
    inputKinds: ["KEY_DOWN", "KEY_UP"],
    frame: [7, 8],
    staleRejected: true,
    rejoinGeneration: 2,
  });
});
