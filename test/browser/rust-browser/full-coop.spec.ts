import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

const fixtureRoot = process.env.M8_RUST_BROWSER_FIXTURE_DIR;
if (fixtureRoot == null) {
  throw new Error("M8_RUST_BROWSER_FIXTURE_DIR is required");
}
const fixture = resolve(fixtureRoot);
const expectedDigest = readFileSync(resolve(fixture, "expected-terminal-digest.txt"), "utf8").trim();
let server: ViteDevServer;
const html = `<!doctype html><html><body><script type="module">
import { RustBrowserHost } from "/src/rust-browser/host/rust-browser-host.ts";
import { BrowserExecutionModeV1 } from "/src/rust-browser/contracts/browser-contracts.ts";
import { BrowserRawInputAdapter } from "/src/rust-browser/adapters/input-adapter.ts";
import { RustBrowserTransportAdapterV1 } from "/src/rust-browser/adapters/transport-adapter.ts";
const role = new URLSearchParams(location.search).get("role"); const manifest = await (await fetch("/m8-assets/m8-web-assets.json")).json();
const identityBytes = new Uint8Array(await (await fetch("/m8-assets/execution-identity.bin")).arrayBuffer());
const session = new Uint8Array(await (await fetch(role === "authority" ? "/m8-assets/session-authority.json" : "/m8-assets/session-replica.json")).arrayBuffer());
const worker = new URL("/src/rust-browser/worker/rust-kernel-worker.ts", location.href); worker.searchParams.set("wasm", "/m8-assets/er_web.wasm"); worker.searchParams.set("wasm_sha256", manifest.assets["er_web.wasm"].sha256); worker.searchParams.set("content", "/m8-assets/content-pack.json"); worker.searchParams.set("content_sha256", manifest.assets["content-pack.json"].sha256);
const host = await RustBrowserHost.create({ workerUrl: worker, initialize: { kind: "INITIALIZE", value: { mode: BrowserExecutionModeV1.RUST_STAGING_AUTHORITY, execution_identity_bytes: Array.from(identityBytes), session_start_bytes: Array.from(session), maximum_pending_requests: 64 } } });
const compatibility = { browser_worker_protocol: 1, authority_protocol: "er-coop-47", mechanical_identity: "m1", content_hash: manifest.assets["content-pack.json"].sha256, material_schema: 5, save_schema: 1, browser_kernel_abi: 1, active_model_identity: "model-1", authority_runtime: "RUST" };
let work = Promise.resolve(); let received = 0; let pc; let generation = 0; let transportConnected = false;
async function handle(responses) { for (const envelope of responses) if (envelope.response.kind === "EFFECTS") for (const effect of envelope.response.value.effects) if (effect.kind === "SEND_NETWORK_FRAME") transport.send(effect.value.generation, new Uint8Array(effect.value.bytes)); }
function enqueue(request) {
  if (request.kind === "NETWORK_FRAME") received += 1;
  if (request.kind === "TRANSPORT_CHANGED") transportConnected = request.value.connected;
  work = work.then(async () => {
    try {
      await handle(await host.dispatch(request));
    } catch (error) {
      throw new Error(role + ":" + request.kind + ":" + String(error));
    }
  });
}
const transport = new RustBrowserTransportAdapterV1({ compatibility, emit: enqueue }); const input = new BrowserRawInputAdapter({ emit: enqueue }); if (role === "authority") input.start();
function waitIce(connection) { if (connection.iceGatheringState === "complete") return Promise.resolve(); const { promise, resolve } = Promise.withResolvers(); connection.addEventListener("icegatheringstatechange", () => { if (connection.iceGatheringState === "complete") resolve(); }); return promise; }
function waitUntil(predicate) { const { promise, resolve, reject } = Promise.withResolvers(); let frames = 0; const tick = () => { if (predicate()) { resolve(); return; } if (++frames > 600) { reject(new Error("co-op condition did not settle")); return; } requestAnimationFrame(tick); }; tick(); return promise; }
async function offer() { pc = new RTCPeerConnection(); const channel = pc.createDataChannel("rust-authority", { ordered: true }); generation = transport.attach(channel); await pc.setLocalDescription(await pc.createOffer()); await waitIce(pc); return pc.localDescription.sdp; }
async function answer(sdp) { pc = new RTCPeerConnection(); pc.ondatachannel = event => { generation = transport.attach(event.channel); }; await pc.setRemoteDescription({ type: "offer", sdp }); await pc.setLocalDescription(await pc.createAnswer()); await waitIce(pc); return pc.localDescription.sdp; }
async function accept(sdp) { await pc.setRemoteDescription({ type: "answer", sdp }); }
async function connected() { await waitUntil(() => generation > 0 && transportConnected); return generation; }
function rechannel() { transportConnected = false; const channel = pc.createDataChannel("rust-rejoin", { ordered: true }); generation = transport.attach(channel); return generation; }
async function digest() { await work; const responses = await host.dispatch({ kind: "OBSERVE", value: { profile: "COOP_DIGEST" } }); await handle(responses); return responses.at(-1).after_mechanical_digest; }
async function waitFrame() { await waitUntil(() => received > 0); await work; return received; }
async function close() { input.dispose(); transport.dispose(); pc?.close(); await work.catch(() => undefined); await host.dispose(); }
globalThis.__coop = { offer, answer, accept, connected, rechannel, digest, waitFrame, close };
</script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m8-full-coop",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url?.startsWith("/m8-assets/")) {
              const name = request.url.slice(11);
              response.setHeader(
                "content-type",
                name.endsWith(".js")
                  ? "text/javascript"
                  : name.endsWith(".wasm")
                    ? "application/wasm"
                    : name.endsWith(".json")
                      ? "application/json"
                      : "application/octet-stream",
              );
              try {
                response.end(readFileSync(resolve(fixture, name)));
              } catch {
                response.statusCode = 404;
                response.end();
              }
              return;
            }
            if (request.url?.startsWith("/m8-full-coop.html")) {
              response.setHeader("content-type", "text/html; charset=utf-8");
              response.end(html);
              return;
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
async function connect(authority: Page, replica: Page) {
  const offer = await authority.evaluate(() => globalThis.__coop.offer());
  const answer = await replica.evaluate(value => globalThis.__coop.answer(value), offer);
  await authority.evaluate(value => globalThis.__coop.accept(value), answer);
  return Promise.all([
    authority.evaluate(() => globalThis.__coop.connected()),
    replica.evaluate(() => globalThis.__coop.connected()),
  ]);
}

test("one Rust authority commits and a second-browser replica applies the same material", async ({ browser }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish co-op fixture");
  }
  const authorityContext = await browser.newContext();
  const replicaContext = await browser.newContext();
  const authority = await authorityContext.newPage();
  const replica = await replicaContext.newPage();
  await Promise.all([
    authority.goto(new URL("m8-full-coop.html?role=authority", address).href),
    replica.goto(new URL("m8-full-coop.html?role=replica", address).href),
  ]);
  await Promise.all([
    authority.waitForFunction(() => "__coop" in globalThis),
    replica.waitForFunction(() => "__coop" in globalThis),
  ]);
  const [firstGeneration] = await connect(authority, replica);
  await authority.keyboard.press("Space");
  expect(await authority.evaluate(() => globalThis.__coop.digest())).toBe(expectedDigest);
  expect(await replica.evaluate(() => globalThis.__coop.waitFrame())).toBeGreaterThan(0);
  expect(await replica.evaluate(() => globalThis.__coop.digest())).toBe(expectedDigest);
  const secondGeneration = await authority.evaluate(() => globalThis.__coop.rechannel());
  expect(secondGeneration).toBe(firstGeneration + 1);
  await Promise.all([
    authority.evaluate(() => globalThis.__coop.close()),
    replica.evaluate(() => globalThis.__coop.close()),
  ]);
  await authorityContext.close();
  await replicaContext.close();
});
