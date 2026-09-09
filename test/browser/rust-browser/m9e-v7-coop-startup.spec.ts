import { createHash } from "node:crypto";
import { once } from "node:events";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { relative, resolve, sep } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "playwright/test";

test.setTimeout(300_000);
const directory = process.env.M9E_V7_WEB_DIR;
if (directory == null) throw new Error("M9E_V7_WEB_DIR is required");
const root = realpathSync(directory);
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function readBounded(path: string, maximum: number): Buffer {
  if (!/^[a-zA-Z0-9_.-]+$/u.test(path) || path === "." || path === "..") throw new Error("RTC fixture path invalid");
  const absolute = resolve(root, path);
  const stat = lstatSync(absolute);
  const actual = realpathSync(absolute);
  const rel = relative(root, actual);
  if (!stat.isFile() || stat.isSymbolicLink() || rel === ".." || rel.startsWith(`..${sep}`)
    || stat.size < 1 || stat.size > maximum) throw new Error("RTC fixture must be a bounded regular contained file");
  return readFileSync(actual);
}
interface Asset { bytes: number; sha256: string; role?: "entry" | "worker" | "chunk" }
const manifestBytes = readBounded("m9e-v7-rtc-assets.json", 16 << 10);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as { schema_version: number; source_sha: string;
  browser_worker_protocol_version: number; entry: string; worker: string; assets: Record<string, Asset>;
  cohort: { glue_sha256: string; wasm_sha256: string; content_sha256: string } };
const cohort = JSON.parse(readBounded("m9e-v7-web-assets.json", 16 << 10).toString("utf8")) as {
  source_sha: string; assets: Record<string, Asset> };
if (manifest.schema_version !== 1 || manifest.browser_worker_protocol_version !== 2
  || !/^[0-9a-f]{40}$/u.test(manifest.source_sha) || manifest.source_sha !== cohort.source_sha
  || (process.env.GITHUB_SHA != null && manifest.source_sha !== process.env.GITHUB_SHA)
  || manifest.entry !== "current-rtc-entry.js" || manifest.assets[manifest.entry]?.role !== "entry"
  || manifest.assets[manifest.worker]?.role !== "worker" || Object.keys(manifest.assets).length > 8
  || Object.values(manifest.assets).filter(asset => asset.role === "entry").length !== 1
  || Object.values(manifest.assets).filter(asset => asset.role === "worker").length !== 1) {
  throw new Error("RTC bundle manifest does not identify one current entry and actual Worker");
}
const served = new Map<string, Buffer>();
let bundleBytes = 0;
for (const [path, asset] of Object.entries(manifest.assets)) {
  const bytes = readBounded(path, 4 << 20);
  if (!path.endsWith(".js") || !["entry", "worker", "chunk"].includes(asset.role ?? "")
    || bytes.length !== asset.bytes || digest(bytes) !== asset.sha256) throw new Error("RTC bundle asset mismatch");
  bundleBytes += bytes.length;
  served.set(`/assets/${path}`, bytes);
}

if (bundleBytes > 4 << 20) throw new Error("RTC bundle aggregate exceeds4MiB");
for (const path of ["er_web.js", "er_web_bg.wasm", "game-content-bundle-v2.json",
  "coop-authority-snapshot.json", "coop-replica-snapshot.json"]) {
  const bytes = readBounded(path, path.endsWith(".js") ? 4 << 20 : 32 << 20);
  if (bytes.length !== cohort.assets[path]?.bytes || digest(bytes) !== cohort.assets[path]?.sha256) throw new Error("RTC natural fixture/cohort mismatch");
  served.set(`/assets/${path}`, bytes);
}
for (const [key, path] of [["glue_sha256", "er_web.js"], ["wasm_sha256", "er_web_bg.wasm"],
  ["content_sha256", "game-content-bundle-v2.json"]] as const) {
  if (manifest.cohort[key] !== cohort.assets[path].sha256) throw new Error("RTC cohort identity disagreement");
}
let server: Server;
let address: string;
test.beforeAll(async () => {
  server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    if (path === "/") { response.writeHead(200, { "content-type": "text/html" }); response.end("<!doctype html><html><body>Current RTC checkpoint pair</body></html>"); return; }
    const body = served.get(path);
    if (body == null) { response.writeHead(404); response.end(); return; }
    response.writeHead(200, { "content-type": path.endsWith(".js") ? "text/javascript"
      : path.endsWith(".wasm") ? "application/wasm" : "application/json", "cache-control": "no-store" });
    response.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const bound = server.address();
  if (bound == null || typeof bound === "string") throw new Error("RTC fixture did not bind TCP");
  address = `http://127.0.0.1:${bound.port}`;
});
test.afterAll(async () => {
  if (server == null) return;
  const closed = once(server, "close"); server.close(); server.closeAllConnections(); await closed;
});

const setupBytes = readBounded("m9e-v7-coop-startup-assets.json", 16 << 10);
const setup = JSON.parse(setupBytes.toString("utf8"));
if (setup.source_sha !== manifest.source_sha || setup.schema_version !== 1
  || Object.keys(setup.assets).sort().join(",") !== "coop-guest-initialization.json,coop-host-initialization.json") {
  throw new Error("natural initialization source or inventory mismatch");
}
for (const [path, asset] of Object.entries(setup.assets) as [string, Asset][]) {
  const bytes = readBounded(path, 64 << 10);
  if (bytes.length !== asset.bytes || digest(bytes) !== asset.sha256) throw new Error("natural initialization hash mismatch");
  served.set(`/assets/${path}`, bytes);
}

interface Pair { contexts: BrowserContext[]; left: Page; right: Page; workers: string[] }
async function pair(browser: Browser, delayOffer: boolean): Promise<Pair> {
  const contexts: BrowserContext[] = [];
  try {
    contexts.push(await browser.newContext(), await browser.newContext());
    const left = await contexts[0].newPage();
    const right = await contexts[1].newPage();
    const workers: string[] = [];
    for (const page of [left, right]) page.on("worker", worker => workers.push(worker.url()));
    await Promise.all([left.goto(address), right.goto(address)]);
    await Promise.all([left, right].map((page, index) => page.evaluate(async ({ entry, path, assets, source, workerHash }) => {
      // Diagnostic-only observers never retain payloads, modify events, or await.
      const journal: { t: number; event: string; owner: number; kind?: string; q?: number; a?: number }[] = [];
      let overflow = false; let active = true; let owners = 0;
      const started = performance.now();
      const note = (event: string, owner: number, fields: { kind?: string; q?: number; a?: number } = {}) => {
        if (!active) return;
        if (journal.length >= 96) { overflow = true; return; }
        journal.push({ t: Math.round((performance.now() - started) * 1000) / 1000, event, owner, ...fields });
      };
      const metadata = (data: unknown, rtc = false): { kind?: string; q?: number; a?: number } => {
        if (!active) return {};
        try {
          let value: any = data;
          if (data instanceof ArrayBuffer) {
            if (data.byteLength > (rtc ? 4096 : 65536)) return { kind: "OVERSIZE_UNINSPECTED" };
            value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
          }
          const candidate = rtc ? value?.kind : value?.request?.kind ?? value?.response?.kind ?? value?.kind;
          const kind = typeof candidate === "string" && /^[A-Z0-9_]{1,64}$/u.test(candidate) ? candidate : "UNCLASSIFIED";
          return { kind, ...(Number.isSafeInteger(value?.sequence) ? { q: value.sequence } : {}),
            ...(Number.isSafeInteger(value?.accepted_sequence) ? { a: value.accepted_sequence } : {}) };
        } catch { return { kind: "UNINSPECTED" }; }
      };
      const channels = new WeakMap<RTCDataChannel, number>();
      const observe = (channel: RTCDataChannel) => {
        if (channels.has(channel)) return;
        const owner = ++owners; channels.set(channel, owner);
        note("rtc-attached", owner, { kind: channel.readyState.toUpperCase() });
        for (const name of ["open", "close", "error"]) channel.addEventListener(name, () => note(`rtc-${name}`, owner));
        channel.addEventListener("message", event => note("rtc-message", owner, metadata(event.data, true)));
      };
      const NativePeer = RTCPeerConnection;
      globalThis.RTCPeerConnection = class extends NativePeer {
        constructor(configuration?: RTCConfiguration) {
          super(configuration);
          this.addEventListener("datachannel", event => observe(event.channel));
        }
      };
      const createChannel = NativePeer.prototype.createDataChannel;
      (NativePeer.prototype as any).createDataChannel = function(this: RTCPeerConnection, ...args: any[]) {
        const channel = Reflect.apply(createChannel, this, args); observe(channel); return channel;
      };
      const send = RTCDataChannel.prototype.send;
      (RTCDataChannel.prototype as any).send = function(this: RTCDataChannel, ...args: any[]) {
        note("rtc-send", channels.get(this) ?? 0, metadata(args[0], true));
        return Reflect.apply(send, this, args);
      };
      const NativeWorker = Worker;
      const workerIds = new WeakMap<Worker, number>();
      globalThis.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          const owner = ++owners; workerIds.set(this, owner); note("worker-created", owner);
          this.addEventListener("message", event => note("worker-response", owner, metadata(event.data)));
          this.addEventListener("error", () => note("worker-error", owner));
          this.addEventListener("messageerror", () => note("worker-messageerror", owner));
        }
      };
      const post = NativeWorker.prototype.postMessage;
      (NativeWorker.prototype as any).postMessage = function(this: Worker, ...args: any[]) {
        note("worker-request", workerIds.get(this) ?? 0, metadata(args[0]));
        return Reflect.apply(post, this, args);
      };
      (globalThis as any).__rtcJournal = () => {
        active = false;
        return { journal, overflow, elapsed_ms: performance.now() - started,
          status: (globalThis as any).__naturalCoop?.peer?.status ?? null };
      };
      const module = await import(entry);
      const initialization = await (await fetch(path)).json();
      if (initialization.kind !== "NATURAL_COOP") throw new Error("explicit natural setup required");
      const { context, profile, seed, save_slots, local_is_host } = initialization;
      const protocol = context.protocol;
      const frame = protocol.frame_context.context;
      const evidence = { frames: [] as { direction: string; generation: number; bytes: number[] }[],
        bytes: 0, presentations: [] as number[] };
      const options = { assets, context, natural_start: { profile, seed, save_slots, local_is_host },
        identity: { source_sha: source, content_sha256: assets.content_sha256, worker_sha256: workerHash,
          session_id: frame.sessionId, run_id: frame.runId, authority_seat: frame.authoritySeatId,
          local_seat: context.local_seat, session_epoch: frame.sessionEpoch, seat_map_id: frame.seatMapId,
          membership_revision: frame.membershipRevision, peer_seat: protocol.connections[0].peer_seat, generation: 1 },
        present: async (effect: { event_id: number }) => { evidence.presentations.push(effect.event_id); },
        frame: (direction: string, generation: number, bytes: Uint8Array) => {
          if (evidence.frames.length >= 16 || bytes.length > (4 << 20) - evidence.bytes) throw new Error("startup frame evidence exceeds bound");
          evidence.bytes += bytes.length;
          evidence.frames.push({ direction, generation, bytes: Array.from(bytes) });
          // Opt-in witness: queue a real snapshot before a later receipt ingress.
          // Never await from the synchronous effect observer's own operation.
          const current = (globalThis as any).__naturalCoop;
          if (current?.capturePending === true && current.publicationSnapshot == null
            && direction === "sent" && bytes[0] === 123
            && JSON.parse(new TextDecoder().decode(bytes)).schema_version === 2) {
            current.publicationSnapshot = current.peer.dispatch({ kind: "SNAPSHOT" })
              .then((result: any) => ({ ok: true, snapshot: result.response.snapshot }),
                (error: unknown) => ({ ok: false, error: String(error) }));
          }
        },
      };
      for (const invalid of ["role", "sender", "extra_peer", "generation", "ambiguous_owner"]) {
        const context = structuredClone(options.context);
        const natural_start = structuredClone(options.natural_start);
        if (invalid === "role") natural_start.local_is_host = !natural_start.local_is_host;
        if (invalid === "sender") context.protocol.frame_context.context.senderSeatId = 0;
        if (invalid === "extra_peer") context.protocol.connections.push(structuredClone(context.protocol.connections[0]));
        if (invalid === "generation") context.protocol.frame_context.context.connectionGeneration = 2;
        let rejected = false;
        try { new module.CurrentDevelopmentRtcPeerV1({ ...options, context, natural_start,
          ...(invalid === "ambiguous_owner" ? { checkpoint: { schema_version: 7 } } : {}) }); }
        catch (error) { rejected = error instanceof Error && error.message.includes("binding does not match"); }
        if (!rejected) throw new Error(`invalid natural RTC ownership admitted: ${invalid}`);
      }
      const peer = new module.CurrentDevelopmentRtcPeerV1(options);
      // Prove constructor owns its initialization before the first await.
      options.context.local_seat = 0;
      options.natural_start.seed = "caller-mutated";
      options.natural_start.save_slots.length = 0;
      await peer.initialize();
      const initial = (await peer.dispatch({ kind: "SNAPSHOT" })).response.snapshot;
      if (initial.lifecycle.kind !== "BOOTSTRAP" || initial.lifecycle.value.stage !== "TITLE"
        || initial.lifecycle.value.seed !== seed || initial.lifecycle.value.selections.starters.length !== 0
        || initial.current_coop_setup == null) throw new Error("actual Worker did not start its owned empty Title setup");
      let control = structuredClone(initial.lifecycle.value.control);
      let rawInputs = 0;
      const press = async (kind = "SPACE") => {
        for (const event of [{ kind: "KEY_DOWN", data: { code: { kind }, printable: false, browser_repeat: false, focus: "GAME" } },
          { kind: "KEY_UP", data: { code: { kind } } }]) {
          const response = await peer.dispatch({ kind: "RAW_INPUT", event });
          if (response.response.kind !== "EFFECTS") throw new Error("actual raw Worker effects required");
          for (const effect of response.response.batch.effects) {
            if (effect.kind === "UI_CHANGED") control = structuredClone(effect.control);
          }
          rawInputs++;
        }
      };
      (globalThis as any).__naturalCoop = { peer, evidence, press, control: () => structuredClone(control), rawInputs: () => rawInputs,
        assets, snapshot: async () => (await peer.dispatch({ kind: "SNAPSHOT" })).response.snapshot,
        retry: async () => { await peer.dispatch({ kind: "RETRY_COOP_SETUP" }); } };
    }, { entry: `${address}/assets/${manifest.entry}`,
      path: `${address}/assets/${index === 0 ? "coop-host-initialization.json" : "coop-guest-initialization.json"}`,
      assets: { wasm_url: `${address}/assets/er_web_bg.wasm`, wasm_sha256: manifest.cohort.wasm_sha256,
        glue_url: `${address}/assets/er_web.js`, glue_sha256: manifest.cohort.glue_sha256,
        content_url: `${address}/assets/game-content-bundle-v2.json`, content_sha256: manifest.cohort.content_sha256 },
      source: manifest.source_sha, workerHash: manifest.assets[manifest.worker].sha256 })));
    const offer = await left.evaluate(async delayMs => {
      const original = RTCPeerConnection.prototype.createOffer;
      try {
        if (delayMs > 0) {
          (RTCPeerConnection.prototype as any).createOffer = async function(this: RTCPeerConnection, options?: RTCOfferOptions) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
            return Reflect.apply(original, this, [options]);
          };
        }
        const started = performance.now();
        const offer = await (globalThis as any).__naturalCoop.peer.offer();
        if (performance.now() - started < delayMs) throw new Error("actual delayed offer preparation was bypassed");
        return offer;
      } finally { RTCPeerConnection.prototype.createOffer = original; }
    }, delayOffer ? 12_000 : 0);
    const answer = await right.evaluate(offer => (globalThis as any).__naturalCoop.peer.answer(offer), offer);
    await left.evaluate(answer => (globalThis as any).__naturalCoop.peer.accept(answer), answer);
    try {
      await Promise.all([left, right].map(page => page.evaluate(() => (globalThis as any).__naturalCoop.peer.ready())));
    } finally {
      const journals = await Promise.all([left, right].map(page => page.evaluate(() => (globalThis as any).__rtcJournal())));
      const bytes = Buffer.from(JSON.stringify({ schema_version: 1, source_sha: manifest.source_sha, journals }));
      if (bytes.length > 32768) throw new Error("bounded handshake journal exceeds32KiB");
      await test.info().attach("m9e-rtc-startup-kind-journal", { body: bytes, contentType: "application/json" });
    }
    return { contexts, left, right, workers };
  } catch (error) { await Promise.allSettled(contexts.map(context => context.close())); throw error; }
}
const snapshot = (page: Page): Promise<any> => page.evaluate(() => (globalThis as any).__naturalCoop.snapshot());
const status = (page: Page): Promise<any> => page.evaluate(() => (globalThis as any).__naturalCoop.peer.status);
const press = (page: Page, kind = "SPACE"): Promise<void> => page.evaluate(kind => (globalThis as any).__naturalCoop.press(kind), kind);
const retry = (page: Page): Promise<void> => page.evaluate(() => (globalThis as any).__naturalCoop.retry());
const frames = (page: Page): Promise<any[]> => page.evaluate(() => (globalThis as any).__naturalCoop.evidence.frames);
async function navigate(page: Page, target: string): Promise<void> {
  await page.evaluate(async target => {
    const current = (globalThis as any).__naturalCoop;
    // UI_CHANGED is the actual Rust control returned by each Worker response.
    // Keep every raw key event while avoiding full snapshots and browser-driver
    // crossings between arrows. The observation never predicts or edits a menu.
    const bound = current.control().menu.options.length + 1;
    for (let index = 0; index < bound; index++) {
      const menu = current.control().menu;
      if (menu.selected_option_id === target) return;
      const selected = menu.options.findIndex((option: any) => option.option_id === menu.selected_option_id);
      const wanted = menu.options.findIndex((option: any) => option.option_id === target);
      if (selected < 0 || wanted < 0) throw new Error(`actual bootstrap option missing: ${target}`);
      await current.press(wanted < selected ? "ARROW_UP" : "ARROW_DOWN");
    }
    throw new Error(`bounded raw navigation could not reach ${target}`);
  }, target);
}
async function choices(page: Page, host: boolean): Promise<any[]> {
  const before = (await snapshot(page)).lifecycle.value;
  const mode = before.catalog.modes.find((mode: any) => mode.cooperative && mode.supported);
  expect(mode).toBeTruthy();
  await press(page);
  await navigate(page, `bootstrap/mode/${mode.mode}`); await press(page);
  if (mode.challenge_selection && host) { await navigate(page, "bootstrap/challenge/done"); await press(page); }
  const setup = (await snapshot(page)).lifecycle.value;
  expect(setup.stage).toBe("STARTER_SELECT");
  let remaining = setup.catalog.maximum_starter_cost;
  const selected: any[] = [];
  for (const starter of setup.catalog.starters.slice(host ? 0 : 2)) {
    if (starter.cost > remaining) continue;
    remaining -= starter.cost; selected.push(starter);
    if (selected.length === (host ? 1 : 2)) break;
  }
  expect(selected).toHaveLength(host ? 1 : 2);
  for (const starter of selected) { await navigate(page, `bootstrap/starter/${starter.pokemon_id}`); await press(page); }
  await navigate(page, "bootstrap/starter/confirm"); await press(page);
  expect((await snapshot(page)).lifecycle.value.stage).toBe("CONFIRMATION");
  expect((await snapshot(page)).lifecycle.value.selections.starters).toEqual(selected);
  await press(page);
  if (host) {
    for (let index = 0; index < 4; index++) {
      const current = (await snapshot(page)).lifecycle;
      if (current.kind === "ACTIVE" || current.value.stage === "COMPLETE") break;
      await press(page);
    }
  }
  return selected;
}
async function delivered(page: Page, count: number): Promise<void> {
  await expect.poll(async () => (await status(page)).rtc?.kernelDeliveredFrames, { timeout: 30_000 }).toBe(count);
}
for (const hostFirst of [true, false]) {
  test(`natural cooperative Title through two Workers and RTC ${hostFirst ? "host" : "guest"} ready first`, async ({ browser }, info) => {
    const peers = await pair(browser, hostFirst);
    try {
      let hostChoices: any[]; let guestChoices: any[];
      if (hostFirst) {
        hostChoices = await choices(peers.left, true);
        const waiting = await snapshot(peers.left);
        expect(waiting.lifecycle.kind).toBe("BOOTSTRAP"); expect(waiting.lifecycle.value.stage).toBe("COMPLETE");
        expect(await frames(peers.left)).toEqual([]);
        guestChoices = await choices(peers.right, false);
      } else {
        guestChoices = await choices(peers.right, false); await delivered(peers.left, 1);
        expect((await snapshot(peers.right)).lifecycle.value.stage).toBe("WAITING_FOR_PARTNER");
        expect((await snapshot(peers.left)).lifecycle.value.stage).toBe("TITLE");
        expect((await snapshot(peers.left)).current_coop_setup.choices.starters).toEqual(guestChoices);
        const waiting = await snapshot(peers.right);
        await retry(peers.right); await delivered(peers.left, 2);
        expect(await snapshot(peers.right)).toEqual(waiting);
        hostChoices = await choices(peers.left, true);
      }
      await delivered(peers.left, hostFirst ? 1 : 2); await delivered(peers.right, 1);
      const left = await snapshot(peers.left); const right = await snapshot(peers.right);
      expect(left.lifecycle.kind).toBe("ACTIVE"); expect(right.lifecycle).toEqual(left.lifecycle);
      expect(right.material_ledger).toEqual(left.material_ledger);
      expect(left.pending_presentations).toEqual([]); expect(right.pending_presentations).toEqual([]);
      const party = left.lifecycle.value.active_run.party;
      expect(party).toHaveLength(3);
      expect(party.map((pokemon: any) => ({ owner_seat: pokemon.owner_seat, species_id: pokemon.species_id, form_index: pokemon.form_index })))
        .toEqual([...hostChoices, ...guestChoices].map(selected => ({ owner_seat: selected.owner_seat, species_id: selected.species_id, form_index: selected.form_index })));
      const sentGuest = (await frames(peers.right)).find(frame => frame.direction === "sent").bytes;
      const sentHost = (await frames(peers.left)).find(frame => frame.direction === "sent").bytes;
      const published = JSON.parse(Buffer.from(sentGuest).toString("utf8"));
      const started = JSON.parse(Buffer.from(sentHost).toString("utf8"));
      expect(published.kind).toBe("CURRENT_COOP_CHOICES"); expect(published.choices.starters).toEqual(guestChoices);
      expect(started.kind).toBe("CURRENT_COOP_STARTED"); expect(started.choices).toEqual(published.choices);
      expect(started.host.starters).toEqual(hostChoices);
      expect(started.material_hex).toMatch(/^(?:[0-9a-f]{2})+$/u);
      const material = JSON.parse(Buffer.from(started.material_hex, "hex").toString("utf8"));
      expect(material.value.after_state).toEqual(left.lifecycle.value);
      expect((await frames(peers.left)).find(frame => frame.direction === "received").bytes).toEqual(sentGuest);
      expect((await frames(peers.right)).find(frame => frame.direction === "received").bytes).toEqual(sentHost);
      const presentations = await Promise.all([peers.left, peers.right].map(page => page.evaluate(() => (globalThis as any).__naturalCoop.evidence.presentations)));
      expect(presentations[0].length).toBeGreaterThan(0); expect(presentations[1]).toEqual(presentations[0]);
      expect(new Set(presentations[0]).size).toBe(presentations[0].length);
      // A completed guest retry is a recorded no-op. Independently resend its
      // actual earlier wire bytes to exercise the host's cached reply over RTC.
      await retry(peers.right);
      await peers.right.evaluate(bytes => (globalThis as any).__naturalCoop.peer.sendFrame(1, Uint8Array.from(bytes)), sentGuest);
      await delivered(peers.left, hostFirst ? 2 : 3); await delivered(peers.right, 2);
      await retry(peers.left); await delivered(peers.right, 3);
      expect(await snapshot(peers.left)).toEqual(left); expect(await snapshot(peers.right)).toEqual(right);
      expect((await status(peers.right)).lastNetworkEffects).toBe(0);
      expect((await frames(peers.right)).filter(frame => frame.direction === "sent").map(frame => frame.bytes)).toEqual(hostFirst ? [sentGuest, sentGuest] : [sentGuest, sentGuest, sentGuest]);
      expect((await frames(peers.left)).filter(frame => frame.direction === "sent").map(frame => frame.bytes)).toEqual([sentHost, sentHost, sentHost]);
      expect(await Promise.all([peers.left, peers.right].map(page => page.evaluate(() => (globalThis as any).__naturalCoop.evidence.presentations)))).toEqual(presentations);
      expect(peers.workers).toHaveLength(2);
      const rawInputs = await Promise.all([peers.left, peers.right].map(page => page.evaluate(() => (globalThis as any).__naturalCoop.rawInputs())));
      for (const url of peers.workers) { expect(new URL(url).origin).toBe(address); expect(new URL(url).pathname).toBe(`/assets/${manifest.worker}`); }
      const originalWorkers = peers.workers.length;
      const replayEvidence = await Promise.all([peers.left, peers.right].map(page => page.evaluate(async workerPath => {
        const owner = (globalThis as any).__naturalCoop;
        const before = await owner.snapshot();
        const bytes = await owner.peer.exportRepro();
        if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > 4 << 20) throw new Error("bounded actual RTC capture required");
        const second = await owner.peer.exportRepro();
        if (second.length !== bytes.length || bytes.some((byte: number, index: number) => byte !== second[index])) {
          throw new Error("read-only exports changed the recorded input stream");
        }
        const canonical = (value: any): string => JSON.stringify(value, (_key, item) =>
          item != null && typeof item === "object" && !Array.isArray(item)
            ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
        if (canonical(await owner.snapshot()) !== canonical(before)) throw new Error("export changed the live current snapshot");
        const worker = new Worker(workerPath, { type: "module", name: "m9e-real-current-capsule-replay" });
        let sequence = 0;
        const request = (payload: any): Promise<any> => new Promise((resolve, reject) => {
          const expected = sequence++;
          const timer = setTimeout(() => { clean(); reject(new Error("actual replay Worker deadline")); }, 120_000);
          const clean = () => { clearTimeout(timer); worker.removeEventListener("message", message); worker.removeEventListener("error", error); };
          const error = () => { clean(); reject(new Error("actual replay Worker error")); };
          const message = (event: MessageEvent) => {
            clean();
            try {
              if (!(event.data instanceof ArrayBuffer)) {
                const diagnostic = event.data;
                throw new Error("actual replay Worker rejected: " + JSON.stringify({
                  kind: diagnostic?.kind, code: diagnostic?.code, message: String(diagnostic?.message).slice(0, 512),
                  acceptance: diagnostic?.acceptance, request_id: diagnostic?.request_id, sequence: diagnostic?.sequence,
                  accepted_sequence: diagnostic?.accepted_sequence,
                }));
              }
              if (event.data.byteLength === 0 || event.data.byteLength > 32 << 20) throw new Error("bounded replay response required");
              const result = JSON.parse(new TextDecoder().decode(event.data));
              if (result.version !== 2 || result.request_id !== expected + 1 || result.accepted_sequence !== expected
                || result.response.kind === "FAULT") throw new Error("replay response correlation or acceptance differs");
              resolve(result.response);
            } catch (issue) { reject(issue); }
          };
          worker.addEventListener("message", message); worker.addEventListener("error", error);
          const envelope = new TextEncoder().encode(canonical({ version: 2, request_id: expected + 1, sequence: expected, request: payload }));
          if (envelope.byteLength > 16 << 20) { clean(); reject(new Error("replay request exceeds current ingress bound")); return; }
          worker.postMessage(envelope.buffer, [envelope.buffer]);
        });
        try {
          worker.postMessage({ kind: "CONFIGURE_CURRENT_WORKER_V2", assets: owner.assets });
          const initialized = await request({ kind: "INITIALIZE", initialization: { kind: "CURRENT_REPRO_CAPSULE", capsule_bytes: Array.from(bytes) } });
          if (initialized.kind !== "READY") throw new Error("current capsule initialization did not replay");
          const replay = await request({ kind: "SNAPSHOT" });
          if (replay.kind !== "SNAPSHOT" || canonical(replay.snapshot) !== canonical(before)) throw new Error("actual replay differs from complete live snapshot");
          const exported = await request({ kind: "EXPORT_REPRO" });
          if (exported.kind !== "EFFECTS" || exported.batch.effects.length !== 1 || exported.batch.effects[0].kind !== "CURRENT_REPRO_READY") {
            throw new Error("replayed Worker did not retain current capture");
          }
          const restored = exported.batch.effects[0].capsule_bytes;
          if (restored.length !== bytes.length || bytes.some((byte: number, index: number) => byte !== restored[index])) throw new Error("replay changed complete capsule bytes");
          if ((await request({ kind: "DISPOSE" })).kind !== "DISPOSED") throw new Error("replay Worker disposal not acknowledged");
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))), value => value.toString(16).padStart(2, "0")).join("");
          return { bytes: bytes.length, sha256: hash, live_snapshot_preserved: true, full_replay_equal: true, reexport_equal: true, disposed: true };
        } finally { worker.terminate(); bytes.fill(0); second.fill(0); }
      }, address + "/assets/" + manifest.worker)));
      expect(peers.workers).toHaveLength(4);
      expect(replayEvidence).toHaveLength(2);
      await info.attach("m9e-natural-coop-startup", { contentType: "application/json", body: Buffer.from(JSON.stringify({
        source_sha: manifest.source_sha, order: hostFirst ? "host" : "guest", actual_workers: originalWorkers, replay_workers: peers.workers.length - originalWorkers, replay: replayEvidence,
        worker_sha256: manifest.assets[manifest.worker].sha256, ...manifest.cohort,
        setup_manifest_sha256: digest(setupBytes), host_choices: hostChoices.map(choice => choice.species_id),
        guest_choices: guestChoices.map(choice => choice.species_id), choices_sha256: digest(Buffer.from(sentGuest)),
        started_sha256: digest(Buffer.from(sentHost)), choices_bytes: sentGuest.length, started_bytes: sentHost.length,
        party_owners: party.map((pokemon: any) => pokemon.owner_seat), presentations: presentations[0].length,
        received: [hostFirst ? 2 : 3, 3], raw_inputs: rawInputs, delayed_offer_ms: hostFirst ? 12_000 : 0, retry_preserved_snapshots: true,
      })) });
    } finally {
      try { await Promise.allSettled([peers.left, peers.right].map(page => page.evaluate(() => (globalThis as any).__naturalCoop.peer.dispose()))); }
      finally { await Promise.allSettled(peers.contexts.map(context => context.close())); }
    }
  });
}
test("owned natural co-op public retry recovers a pending proposal after disconnected snapshot restore through six Workers", async ({ browser }, info) => {
  const peers = await pair(browser, false);
  try {
    await choices(peers.left, true); await choices(peers.right, false);
    await delivered(peers.left, 1); await delivered(peers.right, 1);
    for (const page of [peers.left, peers.right]) {
      expect(await page.evaluate(async () => {
        const state = await (globalThis as any).__naturalCoop.snapshot();
        return { lifecycle: state.lifecycle.kind, control: state.lifecycle.value.active_run.control.kind,
          started: state.current_coop_setup?.started != null };
      })).toEqual({ lifecycle: "ACTIVE", control: "BATTLE_COMMAND", started: true });
    }
    // The actual default command opens the move menu; its selected offered move
    // is admitted through raw keys. No material, party or winning state is edited.
    await press(peers.left);
    expect(await peers.left.evaluate(async () => (await (globalThis as any).__naturalCoop.snapshot())
      .lifecycle.value.active_run.control.kind)).toBe("BATTLE_MOVE");
    await press(peers.left); await delivered(peers.right, 2);
    await press(peers.right);
    expect(await peers.right.evaluate(async () => (await (globalThis as any).__naturalCoop.snapshot())
      .lifecycle.value.active_run.control.kind)).toBe("BATTLE_MOVE");
    await peers.right.evaluate(() => { (globalThis as any).__naturalCoop.capturePending = true; });
    await press(peers.right);
    await delivered(peers.left, 2); await delivered(peers.right, 3);
    // Keep complete snapshots and wire vectors in their browser pages. The
    // driver receives only bounded facts, never either retained snapshot owner.
    await Promise.all([peers.left, peers.right].map((page, index) => page.evaluate(async guest => {
      const current = (globalThis as any).__naturalCoop;
      const canonical = (value: any): string => JSON.stringify(value, (_key, item) =>
        item != null && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
      const same = (left: any, right: any, reason: string) => {
        if (canonical(left) !== canonical(right)) throw new Error(reason);
      };
      const decode = (bytes: number[]) => JSON.parse(new TextDecoder().decode(Uint8Array.from(bytes)));
      const actual = await current.snapshot();
      const proposal = current.evidence.frames.findLast((frame: any) => frame.direction === (guest ? "sent" : "received")
        && decode(frame.bytes).schema_version === 2)?.bytes;
      const receipt = current.evidence.frames.findLast((frame: any) => frame.direction === (guest ? "received" : "sent"))?.bytes;
      if (proposal == null || receipt == null) throw new Error("actual proposal and receipt frames required");
      const wire = decode(receipt);
      const proposalHex = Array.from(Uint8Array.from(proposal), value => value.toString(16).padStart(2, "0")).join("");
      if (wire.proposal_hex !== proposalHex) throw new Error("actual reply does not bind the original proposal");
      if (wire.kind !== "CURRENT_PROPOSAL_MATERIAL_RECEIPT" || wire.schema_version !== 1
        || proposal.length > 16 << 10 || receipt.length > 1 << 20
        || typeof wire.material_hex !== "string" || !/^(?:[0-9a-f]{2})+$/u.test(wire.material_hex)
        || wire.material_hex.length > (448 << 10) * 2) throw new Error("bounded actual current receipt required");
      const inner = Uint8Array.from(wire.material_hex.match(/../gu), (byte: string) => Number.parseInt(byte, 16));
      const material = JSON.parse(new TextDecoder().decode(inner));
      const transition = material.value;
      const envelope = decode(proposal);
      const vectorDigest = async (bytes: Uint8Array) => "sha256-json-bytes-v1:" + Array.from(new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(Array.from(bytes))))),
      value => value.toString(16).padStart(2, "0")).join("");
      if (wire.proposal_digest !== await vectorDigest(Uint8Array.from(proposal))
        || wire.material_digest !== await vectorDigest(inner) || transition.schema_version !== 6
        || transition.operation_id !== envelope.proposal.context.operation_id
        || transition.authority_revision !== envelope.proposal.context.authority_revision
        || transition.authority_seat !== envelope.proposal.context.authority_seat) throw new Error("receipt vector digest or proposal context differs");
      same(transition.accepted_action, envelope.proposal.action, "receipt action differs from actual proposal");
      same(wire.authority_context, guest ? actual.protocol.peer_identity.peer : actual.protocol.frame_context.context,
        "receipt authority context differs from actual paired endpoint");
      const record = actual.material_ledger.records.find((entry: any) => entry.operation_id === transition.operation_id);
      if (record == null || record.material_fingerprint !== wire.material_fingerprint
        || record.authority_revision !== transition.authority_revision || record.after_digest !== transition.after_digest) {
        throw new Error("actual committed receipt ledger binding differs");
      }
      let checkpoint = actual;
      if (guest) {
        const publication = await current.publicationSnapshot;
        if (publication?.ok !== true || publication.snapshot.current_proposal?.kind !== "PENDING"
          || publication.snapshot.current_proposal.retained.proposal_hex !== proposalHex
          || publication.snapshot.current_proposal.retained.proposal_digest !== wire.proposal_digest
          || actual.current_proposal != null) throw new Error("genuine pending-to-accepted guest cut required");
        checkpoint = publication.snapshot;
      } else {
        same(actual.current_coop_setup.last_reply, wire, "host did not retain its actual wire receipt");
      }
      if (checkpoint.current_coop_setup?.started == null) throw new Error("checkpoint lost natural setup ownership");
      (globalThis as any).__publicRetry = { canonical, same, decode, checkpoint, proposal, receipt,
        assets: current.assets, initialRawInputs: current.rawInputs(), originalPresentations: current.evidence.presentations.slice(),
        originalSnapshot: actual, guest, stages: [] };
    }, index === 1)));
    // Two fresh generations of route/Worker owners, both using protocol generation
    // one. The intermediate real disconnect produces the final restore inputs.
    for (const phase of ["checkpoint", "disconnected_restore"]) {
      await Promise.all([peers.left, peers.right].map(page => page.evaluate(async ({ entry, source, workerHash, phase }) => {
        const retained = (globalThis as any).__publicRetry;
        const previous = (globalThis as any).__naturalCoop;
        await previous.peer.dispose();
        if (!previous.peer.status.disposeAcknowledged || !previous.peer.status.worker.closed) throw new Error("old Worker was not disposed");
        const checkpoint = retained.checkpoint;
        const protocol = checkpoint.protocol;
        const frame = protocol.frame_context.context;
        const evidence = { frames: [] as { direction: string; generation: number; bytes: number[] }[], bytes: 0, presentations: [] as number[] };
        const module = await import(entry);
        const peer = new module.CurrentDevelopmentRtcPeerV1({ assets: retained.assets, checkpoint,
          context: { local_seat: frame.senderSeatId, role: protocol.role, protocol: null,
            scheduler: { disposed: false, next_timer_id: 0, timers: [], pauses: [] } },
          identity: { source_sha: source, content_sha256: retained.assets.content_sha256, worker_sha256: workerHash,
            session_id: frame.sessionId, run_id: frame.runId, authority_seat: frame.authoritySeatId,
            local_seat: frame.senderSeatId, session_epoch: frame.sessionEpoch, seat_map_id: frame.seatMapId,
            membership_revision: frame.membershipRevision, peer_seat: protocol.connections[0].peer_seat, generation: 1 },
          present: async (effect: { event_id: number }) => { evidence.presentations.push(effect.event_id); },
          frame: (direction: string, generation: number, bytes: Uint8Array) => {
            if (evidence.frames.length >= 16 || bytes.length > (4 << 20) - evidence.bytes) throw new Error("retry frame evidence exceeds bound");
            evidence.bytes += bytes.length; evidence.frames.push({ direction, generation, bytes: Array.from(bytes) });
          },
        });
        (globalThis as any).__naturalCoop = { peer, evidence,
          snapshot: async () => (await peer.dispatch({ kind: "SNAPSHOT" })).response.snapshot,
          retry: async () => { await peer.dispatch({ kind: "RETRY_COOP_SETUP" }); } };
        await peer.initialize();
        const before = (await peer.dispatch({ kind: "SNAPSHOT" })).response.snapshot;
        retained.same(before, checkpoint, "fresh actual Worker did not restore the complete checkpoint");
        let rejected = false;
        try { await peer.dispatch({ kind: "RETRY_COOP_SETUP" }); }
        catch (error) { rejected = error instanceof Error && error.message.includes("requires its admitted peer connection"); }
        if (!rejected || evidence.frames.length !== 0 || evidence.presentations.length !== 0) throw new Error("unconnected retry was not fenced without effects");
        retained.same((await peer.dispatch({ kind: "SNAPSHOT" })).response.snapshot, before, "rejected retry changed restored ownership");
        retained.stages.push({ phase, exact_restore: true, preconnection_retry_rejected: true });
      }, { entry: `${address}/assets/${manifest.entry}`, source: manifest.source_sha,
        workerHash: manifest.assets[manifest.worker].sha256, phase })));
      const offer = await peers.left.evaluate(() => (globalThis as any).__naturalCoop.peer.offer());
      const answer = await peers.right.evaluate(offer => (globalThis as any).__naturalCoop.peer.answer(offer), offer);
      await peers.left.evaluate(answer => (globalThis as any).__naturalCoop.peer.accept(answer), answer);
      await Promise.all([peers.left, peers.right].map(page => page.evaluate(() => (globalThis as any).__naturalCoop.peer.ready())));
      if (phase === "checkpoint") {
        await Promise.all([peers.left, peers.right].map(page => page.evaluate(() => (globalThis as any).__naturalCoop.peer.closeTransport())));
        for (const page of [peers.left, peers.right]) {
          await expect.poll(async () => (await status(page)).disconnectedEvents, { timeout: 30_000 }).toBe(1);
          await page.evaluate(async () => {
            const current = (globalThis as any).__naturalCoop;
            const retained = (globalThis as any).__publicRetry;
            const state = await current.snapshot();
            if (state.protocol.connections[0].state !== "DISCONNECTED"
              || !state.scheduler.pauses.some((pause: any) => pause.time_class === "connected" && pause.reasons.includes("transport-disconnected"))) {
              throw new Error("actual disconnected protocol/scheduler snapshot required");
            }
            retained.same(state.current_proposal, retained.checkpoint.current_proposal, "disconnect changed proposal ownership");
            retained.same(state.current_coop_setup, retained.checkpoint.current_coop_setup, "disconnect changed retained reply/setup");
            if (current.evidence.frames.length !== 0 || current.evidence.presentations.length !== 0) throw new Error("checkpoint pair replayed effects before explicit retry");
            let rejected = false;
            try { await current.peer.dispatch({ kind: "RETRY_COOP_SETUP" }); }
            catch (error) { rejected = error instanceof Error && error.message.includes("requires its admitted peer connection"); }
            if (!rejected) throw new Error("actual disconnected route admitted public retry");
            retained.same(await current.snapshot(), state, "disconnected retry changed complete ownership");
            retained.checkpoint = state;
          });
        }
      }
    }
    await Promise.all([peers.left, peers.right].map(page => page.evaluate(async () => {
      const current = (globalThis as any).__naturalCoop;
      const retained = (globalThis as any).__publicRetry;
      retained.beforeRetry = await current.snapshot();
      if (current.peer.status.connectedEvents !== 1 || current.evidence.frames.length !== 0
        || current.evidence.presentations.length !== 0) throw new Error("fresh connected pair must be quiescent before public retry");
    })));
    await retry(peers.right);
    await delivered(peers.left, 1); await delivered(peers.right, 1);
    const facts = await Promise.all([peers.left, peers.right].map(page => page.evaluate(async () => {
      const current = (globalThis as any).__naturalCoop;
      const retained = (globalThis as any).__publicRetry;
      const after = await current.snapshot();
      const sent = current.evidence.frames.filter((frame: any) => frame.direction === "sent");
      const received = current.evidence.frames.filter((frame: any) => frame.direction === "received");
      if (sent.length !== 1 || received.length !== 1 || current.evidence.frames.some((frame: any) => frame.generation !== 1)) throw new Error("public retry must exchange exactly one proposal and receipt");
      retained.same(sent[0].bytes, retained.guest ? retained.proposal : retained.receipt, "retry changed original sent bytes");
      retained.same(received[0].bytes, retained.guest ? retained.receipt : retained.proposal, "retry changed original received bytes");
      if (retained.guest) {
        if (retained.beforeRetry.current_proposal?.kind !== "PENDING" || after.current_proposal != null) throw new Error("public retry did not retire pending ownership");
        retained.same(after.lifecycle, retained.originalSnapshot.lifecycle, "guest retry did not reach the original committed lifecycle");
        retained.same(after.material_ledger, retained.originalSnapshot.material_ledger, "guest retry ledger differs from original receipt application");
      } else {
        retained.same(after, retained.beforeRetry, "host duplicate reply changed the complete kernel snapshot");
        if (current.evidence.presentations.length !== 0) throw new Error("host duplicate reply replayed a presentation");
      }
      const canonicalBytes = (value: any) => new TextEncoder().encode(retained.canonical(value));
      const hash = async (bytes: Uint8Array) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes))), value => value.toString(16).padStart(2, "0")).join("");
      const pending = canonicalBytes(retained.checkpoint);
      const beforeBytes = canonicalBytes(retained.beforeRetry);
      const afterBytes = canonicalBytes(after);
      retained.afterRetry = after;
      retained.afterRetryPresentations = current.evidence.presentations.slice();
      return { role: retained.guest ? "REPLICA" : "AUTHORITY", stages: retained.stages,
        checkpoint_bytes: pending.length, checkpoint_sha256: await hash(pending),
        before_bytes: beforeBytes.length, before_sha256: await hash(beforeBytes), after_bytes: afterBytes.length, after_sha256: await hash(afterBytes),
        proposal_bytes: retained.proposal.length, proposal_sha256: await hash(Uint8Array.from(retained.proposal)),
        receipt_bytes: retained.receipt.length, receipt_sha256: await hash(Uint8Array.from(retained.receipt)),
        sent: sent.length, received: received.length, frame_bytes: current.evidence.bytes,
        presentations: current.evidence.presentations.length, original_presentations: retained.originalPresentations.length,
        original_raw_inputs: retained.initialRawInputs, restored_raw_inputs: 0,
        lifecycle_sha256: await hash(canonicalBytes(after.lifecycle)), ledger_sha256: await hash(canonicalBytes(after.material_ledger)),
        exact_frames: true, ownership_verified: true, host_snapshot_conserved: !retained.guest };
    })));
    expect(facts[0].proposal_sha256).toBe(facts[1].proposal_sha256);
    expect(facts[0].receipt_sha256).toBe(facts[1].receipt_sha256);
    expect(facts[0].lifecycle_sha256).toBe(facts[1].lifecycle_sha256);
    expect(facts[0].ledger_sha256).toBe(facts[1].ledger_sha256);
    await retry(peers.right);
    await Promise.all([peers.left, peers.right].map(page => page.evaluate(async () => {
      const current = (globalThis as any).__naturalCoop;
      const retained = (globalThis as any).__publicRetry;
      retained.same(await current.snapshot(), retained.afterRetry, "settled public retry changed a complete snapshot");
      retained.same(current.evidence.presentations, retained.afterRetryPresentations, "settled retry repeated presentations");
      if (current.evidence.frames.length !== 2) throw new Error("settled guest retry emitted another frame");
    })));
    expect(peers.workers).toHaveLength(6);
    for (const url of peers.workers) { expect(new URL(url).origin).toBe(address); expect(new URL(url).pathname).toBe(`/assets/${manifest.worker}`); }
    await Promise.all([peers.left, peers.right].map(page => page.evaluate(async () => {
      const peer = (globalThis as any).__naturalCoop.peer;
      await peer.dispose();
      if (!peer.status.disposeAcknowledged || !peer.status.worker.closed) throw new Error("final Worker disposal not acknowledged");
    })));
    const evidence = Buffer.from(JSON.stringify({ schema_version: 1, source_sha: manifest.source_sha,
      worker_sha256: manifest.assets[manifest.worker].sha256, ...manifest.cohort,
      setup_manifest_sha256: digest(setupBytes), actual_workers: 6, generation: 1,
      recovery: "genuine_pending_and_committed_checkpoints_then_actual_disconnected_restore",
      peers: facts, settled_retry_noop: true, disposed_workers: 6 }));
    expect(evidence.length).toBeLessThanOrEqual(16 << 10);
    await info.attach("m9e-natural-coop-public-retry", { contentType: "application/json", body: evidence });
  } finally {
    try { await Promise.allSettled([peers.left, peers.right].map(page => page.evaluate(() => (globalThis as any).__naturalCoop.peer.dispose()))); }
    finally { await Promise.allSettled(peers.contexts.map(context => context.close())); }
  }
});