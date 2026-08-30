import { resolve } from "node:path";
import { expect, type Page, test } from "playwright/test";
import { createServer, type ViteDevServer } from "vite";

let server: ViteDevServer;
const html = `<!doctype html><html><body><script type="module">
import { RustBrowserTransportAdapterV1 } from "/src/rust-browser/adapters/transport-adapter.ts";
const identity = { browser_worker_protocol: 1, authority_protocol: "er-coop-47", release_id: "m8-test", compatible_releases: [], mechanical_identity: "m1", content_hash: "c1", material_schema: 5, save_schema: 1, browser_kernel_abi: 1, active_model_identity: "model-1", authority_runtime: new URLSearchParams(location.search).get("runtime") === "typescript" ? "TYPESCRIPT" : "RUST" };
const events = []; const adapter = new RustBrowserTransportAdapterV1({ compatibility: identity, emit: event => events.push(event) }); let pc; let generation = 0;
function waitIce(connection) { if (connection.iceGatheringState === "complete") return Promise.resolve(); const { promise, resolve } = Promise.withResolvers(); connection.addEventListener("icegatheringstatechange", () => { if (connection.iceGatheringState === "complete") resolve(); }); return promise; }
function waitUntil(predicate) { const { promise, resolve, reject } = Promise.withResolvers(); let frames = 0; const tick = () => { if (predicate()) { resolve(); return; } if (++frames > 600) { reject(new Error("RTC condition did not settle")); return; } requestAnimationFrame(tick); }; tick(); return promise; }
async function offer() { pc?.close(); pc = new RTCPeerConnection(); const channel = pc.createDataChannel("rust", { ordered: true }); generation = adapter.attach(channel); await pc.setLocalDescription(await pc.createOffer()); await waitIce(pc); return pc.localDescription.sdp; }
async function answer(sdp) { pc?.close(); pc = new RTCPeerConnection(); pc.ondatachannel = event => { generation = adapter.attach(event.channel); }; await pc.setRemoteDescription({ type: "offer", sdp }); await pc.setLocalDescription(await pc.createAnswer()); await waitIce(pc); return pc.localDescription.sdp; }
async function accept(sdp) { await pc.setRemoteDescription({ type: "answer", sdp }); }
function rechannel() { const channel = pc.createDataChannel("rust-rejoin", { ordered: true }); generation = adapter.attach(channel); return generation; }
async function connected() { await waitUntil(() => events.some(event => event.kind === "TRANSPORT_CHANGED" && event.value.connected)); return generation; }
async function frame() { await waitUntil(() => events.some(event => event.kind === "NETWORK_FRAME")); return events.findLast(event => event.kind === "NETWORK_FRAME").value.bytes; }
async function failed() { await waitUntil(() => events.some(event => event.kind === "TRANSPORT_CHANGED" && !event.value.connected)); return true; }
globalThis.__rtc = { offer, answer, accept, rechannel, connected, failed, frame, send: bytes => adapter.send(generation, new Uint8Array(bytes)), sendGeneration: (value, bytes) => { try { adapter.send(value, new Uint8Array(bytes)); return true; } catch { return false; } }, clear: () => events.splice(0), close: () => { pc?.close(); adapter.dispose(); } };
</script></body></html>`;

test.beforeAll(async () => {
  server = await createServer({
    root: resolve(import.meta.dirname, "../../../.."),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "m8-two-browser-rtc",
        configureServer(devServer) {
          devServer.middlewares.use((request, response, next) => {
            if (request.url?.startsWith("/m8-rtc.html")) {
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

async function negotiate(left: Page, right: Page): Promise<void> {
  const offer = await left.evaluate(() => globalThis.__rtc.offer());
  const answer = await right.evaluate(sdp => globalThis.__rtc.answer(sdp), offer);
  await left.evaluate(sdp => globalThis.__rtc.accept(sdp), answer);
}

async function connect(left: Page, right: Page): Promise<[number, number]> {
  await negotiate(left, right);
  return Promise.all([
    left.evaluate(() => globalThis.__rtc.connected()),
    right.evaluate(() => globalThis.__rtc.connected()),
  ]);
}

test("two isolated browser contexts exchange and hot-rejoin Rust frames", async ({ browser }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish RTC fixture");
  }
  const leftContext = await browser.newContext();
  const rightContext = await browser.newContext();
  const left = await leftContext.newPage();
  const right = await rightContext.newPage();
  await Promise.all([
    left.goto(new URL("m8-rtc.html", address).href),
    right.goto(new URL("m8-rtc.html", address).href),
  ]);
  await Promise.all([
    left.waitForFunction(() => "__rtc" in globalThis),
    right.waitForFunction(() => "__rtc" in globalThis),
  ]);
  const [firstGeneration] = await connect(left, right);
  await left.evaluate(() => globalThis.__rtc.send([7, 8]));
  await expect.poll(() => right.evaluate(() => globalThis.__rtc.frame())).toEqual([7, 8]);
  await Promise.all([left.evaluate(() => globalThis.__rtc.clear()), right.evaluate(() => globalThis.__rtc.clear())]);
  const secondGeneration = await left.evaluate(() => globalThis.__rtc.rechannel());
  const [confirmedLeftGeneration, confirmedRightGeneration] = await Promise.all([
    left.evaluate(() => globalThis.__rtc.connected()),
    right.evaluate(() => globalThis.__rtc.connected()),
  ]);
  expect(confirmedLeftGeneration).toBe(secondGeneration);
  expect(confirmedRightGeneration).toBe(secondGeneration);
  expect(secondGeneration).toBe(firstGeneration + 1);
  expect(await left.evaluate(old => globalThis.__rtc.sendGeneration(old, [1]), firstGeneration)).toBe(false);
  await left.evaluate(() => globalThis.__rtc.send([9]));
  await expect.poll(() => right.evaluate(() => globalThis.__rtc.frame())).toEqual([9]);
  await Promise.all([left.evaluate(() => globalThis.__rtc.close()), right.evaluate(() => globalThis.__rtc.close())]);
  await leftContext.close();
  await rightContext.close();
});

test("two isolated browser contexts reject mixed TypeScript and Rust authorities", async ({ browser }) => {
  const address = server.resolvedUrls?.local[0];
  if (address == null) {
    throw new Error("Vite did not publish RTC fixture");
  }
  const leftContext = await browser.newContext();
  const rightContext = await browser.newContext();
  const left = await leftContext.newPage();
  const right = await rightContext.newPage();
  await Promise.all([
    left.goto(new URL("m8-rtc.html", address).href),
    right.goto(new URL("m8-rtc.html?runtime=typescript", address).href),
  ]);
  await Promise.all([
    left.waitForFunction(() => "__rtc" in globalThis),
    right.waitForFunction(() => "__rtc" in globalThis),
  ]);
  await negotiate(left, right);
  await expect(
    Promise.all([left.evaluate(() => globalThis.__rtc.failed()), right.evaluate(() => globalThis.__rtc.failed())]),
  ).resolves.toEqual([true, true]);
  await Promise.all([left.evaluate(() => globalThis.__rtc.close()), right.evaluate(() => globalThis.__rtc.close())]);
  await leftContext.close();
  await rightContext.close();
});
