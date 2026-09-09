import { createHash } from "node:crypto";
import { once } from "node:events";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { relative, resolve, sep } from "node:path";
import { expect, test } from "playwright/test";

// Same bounded allowance as the existing real V7 in-page witnesses.
test.setTimeout(300_000);
const root = process.env.M9E_V7_WEB_DIR;
if (root == null) throw new Error("M9E_V7_WEB_DIR is required");
const fixture = realpathSync(root);
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
interface Asset { bytes: number; sha256: string; role?: "entry" | "worker" | "chunk" }
interface Manifest {
  schema_version: number;
  browser_worker_protocol_version: number;
  source_sha: string;
  entry: string;
  worker: string;
  assets: Record<string, Asset>;
  cohort: { glue_sha256: string; wasm_sha256: string; content_sha256: string };
}
function boundedFile(path: string, maximum: number): Buffer {
  if (!/^[a-zA-Z0-9_.\/-]+$/u.test(path) || path.split("/").some(part => part === ".." || part === "." || part === "")) {
    throw new Error("invalid Worker fixture path");
  }
  const absolute = resolve(fixture, path);
  const info = lstatSync(absolute);
  const actual = realpathSync(absolute);
  const contained = relative(fixture, actual);
  if (!info.isFile() || info.isSymbolicLink() || contained === ".." || contained.startsWith(`..${sep}`)
    || resolve(fixture, contained) !== actual || info.size < 1 || info.size > maximum) {
    throw new Error("Worker fixture file escapes its regular bounded asset root");
  }
  return readFileSync(actual);
}
const manifestBytes = boundedFile("m9e-v7-worker-assets.json", 32 * 1024);
const manifest = JSON.parse(manifestBytes.toString("utf8")) as Manifest;
const cohort = JSON.parse(boundedFile("m9e-v7-web-assets.json", 32 * 1024).toString("utf8")) as {
  source_sha: string; assets: Record<string, Asset>;
};
if (manifest.schema_version !== 1 || manifest.browser_worker_protocol_version !== 2
  || !/^[0-9a-f]{40}$/u.test(manifest.source_sha) || manifest.source_sha !== cohort.source_sha
  || (process.env.GITHUB_SHA != null && manifest.source_sha !== process.env.GITHUB_SHA)
  || manifest.entry !== "current-worker-entry.js"
  || manifest.assets[manifest.entry]?.role !== "entry" || manifest.assets[manifest.worker]?.role !== "worker"
  || Object.keys(manifest.assets).length > 8
  || Object.values(manifest.assets).filter(asset => asset.role === "worker").length !== 1
  || Object.values(manifest.assets).filter(asset => asset.role === "entry").length !== 1) {
  throw new Error("Worker manifest identity or emitted roles are invalid");
}
const served = new Map<string, Buffer>();
let totalBundleBytes = 0;
for (const [path, asset] of Object.entries(manifest.assets)) {
  const bytes = boundedFile(path, 4 << 20);
  if (!path.endsWith(".js") || !["entry", "worker", "chunk"].includes(asset.role ?? "")
    || asset.bytes !== bytes.length || asset.sha256 !== sha(bytes)) throw new Error("Worker emitted asset mismatch");
  totalBundleBytes += bytes.length;
  served.set(`/m9e-assets/${path}`, bytes);
}
if (totalBundleBytes > 4 << 20) throw new Error("Worker bundle aggregate exceeds its bound");
for (const [path, expected] of [
  ["er_web.js", manifest.cohort.glue_sha256],
  ["er_web_bg.wasm", manifest.cohort.wasm_sha256],
  ["game-content-bundle-v2.json", manifest.cohort.content_sha256],
] as const) {
  const bytes = boundedFile(path, path.endsWith(".js") ? 4 << 20 : 32 << 20);
  if (expected !== sha(bytes) || cohort.assets[path]?.sha256 !== expected || cohort.assets[path]?.bytes !== bytes.length) {
    throw new Error("Worker Wasm cohort mismatch");
  }
  served.set(`/m9e-assets/${path}`, bytes);
}
let server: Server;
let address: string;
test.beforeAll(async () => {
  server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname === "/") {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<!doctype html><html><body>Current V2 Worker fixture</body></html>");
      return;
    }
    const body = served.get(url.pathname);
    if (body == null) { response.writeHead(404); response.end(); return; }
    // A real verified Wasm fetch is observed before externally killing this
    // Worker. Never respond: the client's bounded deadline must settle its work.
    if (url.pathname.endsWith("/er_web_bg.wasm") && url.search === "?blocked=1") return;
    response.writeHead(200, { "content-type": url.pathname.endsWith(".wasm") ? "application/wasm"
      : url.pathname.endsWith(".js") ? "text/javascript" : "application/json", "cache-control": "no-store" });
    response.end(body);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const socket = server.address();
  if (socket == null || typeof socket === "string") throw new Error("Worker fixture did not bind TCP");
  address = `http://127.0.0.1:${socket.port}`;
});
test.afterAll(async () => {
  if (server == null) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
});
function assets(blocked = false) {
  return { wasm_url: `${address}/m9e-assets/er_web_bg.wasm${blocked ? "?blocked=1" : ""}`,
    wasm_sha256: manifest.cohort.wasm_sha256, glue_url: `${address}/m9e-assets/er_web.js`,
    glue_sha256: manifest.cohort.glue_sha256, content_url: `${address}/m9e-assets/game-content-bundle-v2.json`,
    content_sha256: manifest.cohort.content_sha256 };
}
function binding(observed: string[]) {
  expect(observed.length).toBeGreaterThan(0);
  for (const url of observed) {
    expect(new URL(url).origin).toBe(address);
    expect(new URL(url).pathname).toBe(`/m9e-assets/${manifest.worker}`);
  }
  return { schema_version: 1, source_sha: manifest.source_sha, manifest_sha256: sha(manifestBytes),
    entry_sha256: manifest.assets[manifest.entry].sha256, worker_sha256: manifest.assets[manifest.worker].sha256,
    worker_path: manifest.worker, ...manifest.cohort, browser_worker_protocol_version: 2,
    observed_worker_count: observed.length };
}

const setupBytes = boundedFile("m9e-v7-coop-startup-assets.json", 16 << 10);
const setup = JSON.parse(setupBytes.toString("utf8"));
if (setup.source_sha !== manifest.source_sha || setup.schema_version !== 1
  || Object.keys(setup.assets).sort().join(",") !== "coop-guest-initialization.json,coop-host-initialization.json") {
  throw new Error("natural rebind initialization source or inventory mismatch");
}
for (const [path, asset] of Object.entries(setup.assets) as [string, Asset][]) {
  const bytes = boundedFile(path, 64 << 10);
  if (bytes.length !== asset.bytes || sha(bytes) !== asset.sha256) throw new Error("natural rebind initialization differs");
  served.set(`/m9e-assets/${path}`, bytes);
}

test("current V7 Workers physically reconnect RTC generations two and three with retained receipts and replay", async ({ page }, testInfo) => {
  const observed: string[] = [];
  page.on("worker", worker => observed.push(worker.url()));
  await page.goto(address);
  const evidence = await page.evaluate(async ({ entry, assets, initializations }) => {
    const module = await import(entry);
    const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
    const canonical = (value: any): any => Array.isArray(value) ? value.map(canonical)
      : value != null && typeof value === "object"
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
    const text = (value: unknown) => JSON.stringify(canonical(value));
    const equal = (left: unknown, right: unknown, message: string) => assert(text(left) === text(right), message);
    const digest = async (value: unknown) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
      new TextEncoder().encode(text(value))))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    const wireDigest = async (bytes: number[]) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
      Uint8Array.from(bytes)))).map(byte => byte.toString(16).padStart(2, "0")).join("");
    const clients: any[] = [];
    const connections: RTCPeerConnection[] = [];
    const carriers: any[] = [];
    const deadline = async <T>(task: Promise<T>): Promise<T> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try { return await Promise.race([task, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("physical RTC event deadline")), 30_000);
      })]); } finally { clearTimeout(timer); }
    };
    const connect = async (generation: number) => {
      const left = new RTCPeerConnection({ iceServers: [] });
      const right = new RTCPeerConnection({ iceServers: [] });
      connections.push(left, right);
      const received = new Promise<RTCDataChannel>(resolve => right.addEventListener("datachannel", event => resolve(event.channel), { once: true }));
      const outgoing = left.createDataChannel("m9e-rebind-physical", { ordered: true });
      const gathered = (pc: RTCPeerConnection) => pc.iceGatheringState === "complete" ? Promise.resolve()
        : deadline(new Promise<void>(resolve => {
          const changed = () => { if (pc.iceGatheringState === "complete") { pc.removeEventListener("icegatheringstatechange", changed); resolve(); } };
          pc.addEventListener("icegatheringstatechange", changed); changed();
        }));
      await left.setLocalDescription(await left.createOffer()); await gathered(left);
      await right.setRemoteDescription(left.localDescription!);
      await right.setLocalDescription(await right.createAnswer()); await gathered(right);
      await left.setRemoteDescription(right.localDescription!);
      const incoming = await deadline(received);
      const channels = [outgoing, incoming];
      for (const channel of channels) {
        channel.binaryType = "arraybuffer";
        if (channel.readyState !== "open") await deadline(new Promise<void>((resolve, reject) => {
          channel.addEventListener("open", () => resolve(), { once: true });
          channel.addEventListener("close", () => reject(new Error("RTC closed before open")), { once: true });
        }));
        assert(channel.ordered && channel.maxRetransmits == null && channel.maxPacketLifeTime == null, "reliable physical data channel required");
      }
      const record = { generation, sent: [0, 0], received: [0, 0], closed: false, selected_pairs: 0 };
      const transfer = async (sender: number, bytes: number[]) => {
        assert(!record.closed && bytes.length > 0 && bytes.length <= (1 << 20), "bounded live physical packet required");
        const destination = channels[1 - sender];
        const delivery = new Promise<number[]>((resolve, reject) => {
          destination.addEventListener("message", event => {
            if (!(event.data instanceof ArrayBuffer)) { reject(new Error("RTC packet must be binary")); return; }
            record.received[1 - sender]++;
            resolve(Array.from(new Uint8Array(event.data)));
          }, { once: true });
        });
        channels[sender].send(Uint8Array.from(bytes).buffer); record.sent[sender]++;
        const actual = await deadline(delivery);
        equal(actual, bytes, "physical RTC packet differs from emitted kernel bytes");
        return actual;
      };
      const close = async () => {
        for (const pc of [left, right]) {
          const stats = await pc.getStats();
          stats.forEach(stat => { if (stat.type === "transport" && stat.selectedCandidatePairId != null) {
            const pair = stats.get(stat.selectedCandidatePairId);
            assert(pair?.state === "succeeded", "actual selected ICE pair required"); record.selected_pairs++;
          } });
        }
        assert(record.selected_pairs === 2, "both physical peers require a selected ICE pair");
        const closed = channels.map(channel => channel.readyState === "closed" ? Promise.resolve()
          : deadline(new Promise<void>(resolve => channel.addEventListener("close", () => resolve(), { once: true }))));
        outgoing.close(); await Promise.all(closed);
        left.close(); right.close(); record.closed = true;
        assert(left.connectionState === "closed" && right.connectionState === "closed", "old physical connections must close");
      };
      carriers.push(record);
      return { transfer, close };
    };
    let disposed = 0;
    const create = () => {
      const client = module.createCurrentDevelopmentWorkerV2({ assets });
      clients.push(client);
      return client;
    };
    const snapshot = async (client: any) => {
      const result = await client.dispatch({ kind: "SNAPSHOT" });
      assert(result.response.kind === "SNAPSHOT", "real V7 snapshot response required");
      return result.response.snapshot;
    };
    const capsule = async (client: any) => {
      const result = await client.dispatch({ kind: "EXPORT_REPRO" });
      assert(result.response.kind === "EFFECTS", "current capsule response required");
      const [effect] = result.response.batch.effects;
      assert(result.response.batch.effects.length === 1 && effect.kind === "CURRENT_REPRO_READY", "current capsule effect required");
      return { bytes: effect.capsule_bytes,
        value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(effect.capsule_bytes))) };
    };
    const peers: any[] = [];
    try {
      for (let index = 0; index < 2; index++) {
        const initialization = await (await fetch(initializations[index])).json();
        assert(initialization.kind === "NATURAL_COOP", "actual natural setup required");
        const client = create();
        const initialized = await client.dispatch({ kind: "INITIALIZE", initialization });
        assert(initialized.response.kind === "READY", "actual Worker initialization required");
        const initial = await snapshot(client);
        assert(initial.lifecycle.kind === "BOOTSTRAP" && initial.lifecycle.value.stage === "TITLE"
          && initial.current_coop_setup != null, "actual owned Title setup required");
        const peer: any = { client, context: initialization.context, host: index === 0, control: initial.lifecycle.value.control,
          raw: 0, presentations: 0, rebinds: 0, rejected: 0 };
        peer.ordinary = async (request: any) => {
          const result = await peer.client.dispatch(request);
          assert(result.response.kind === "EFFECTS", "ordinary request must have actual effects");
          const frames: number[][] = [];
          for (const effect of result.response.batch.effects) {
            if (effect.kind === "UI_CHANGED") peer.control = structuredClone(effect.control);
            if (effect.kind === "SEND_NETWORK_FRAME") {
              assert(effect.generation === (peer.generation ?? 1) && effect.bytes.length > 0
                && effect.bytes.length <= (1 << 20), "actual bounded wire frame generation");
              frames.push(effect.bytes);
            }
          }
          return frames;
        };
        peer.press = async (kind = "SPACE") => {
          const frames: number[][] = [];
          for (const event of [{ kind: "KEY_DOWN", data: { code: { kind }, printable: false, browser_repeat: false, focus: "GAME" } },
            { kind: "KEY_UP", data: { code: { kind } } }]) {
            frames.push(...await peer.ordinary({ kind: "RAW_INPUT", event })); peer.raw++;
          }
          return frames;
        };
        peer.choose = async (target: string) => {
          const frames: number[][] = [];
          const bound = peer.control.menu.options.length + 1;
          for (let index = 0; index < bound; index++) {
            const menu = peer.control.menu;
            if (menu.selected_option_id === target) return [...frames, ...await peer.press()];
            const selected = menu.options.findIndex((option: any) => option.option_id === menu.selected_option_id);
            const wanted = menu.options.findIndex((option: any) => option.option_id === target);
            assert(selected >= 0 && wanted >= 0, "actual menu option required");
            frames.push(...await peer.press(wanted < selected ? "ARROW_UP" : "ARROW_DOWN"));
          }
          throw new Error("bounded actual menu navigation failed");
        };
        peer.rebind = async (control: any) => {
          const result = await peer.client.dispatch({ kind: "COOP_REBIND", control });
          assert(result.response.kind === "REBIND" && result.response.output.generation === (peer.rebindGeneration ?? 2)
            && result.response.observation.kernel_version === 7, "dedicated real rebind result");
          peer.rebinds++;
          return result.response.output;
        };
        peer.settle = async () => {
          for (let pass = 0; pass < 16; pass++) {
            const pending = (await snapshot(peer.client)).pending_presentations;
            if (pending.length === 0) return;
            for (const effect of pending) {
              await peer.ordinary({ kind: "PRESENTATION_SETTLED", event_id: effect.event_id, outcome: { kind: "SETTLED" } });
              assert(!(await snapshot(peer.client)).pending_presentations.some((item: any) => item.event_id === effect.event_id),
                "actual callback releases its own presentation");
              peer.presentations++;
            }
          }
          throw new Error("presentation bound exceeded");
        };
        peers.push(peer);
      }
      const one = (frames: number[][]) => { assert(frames.length === 1, "one actual wire frame required"); return frames[0]; };
      const starters = async (peer: any) => {
        const initial = (await snapshot(peer.client)).lifecycle.value;
        const mode = initial.catalog.modes.find((mode: any) => mode.cooperative && mode.supported);
        assert(mode != null, "supported co-op mode required");
        const wire = await peer.press();
        wire.push(...await peer.choose(`bootstrap/mode/${mode.mode}`));
        if (mode.challenge_selection && peer.host) wire.push(...await peer.choose("bootstrap/challenge/done"));
        const setup = (await snapshot(peer.client)).lifecycle.value;
        assert(setup.stage === "STARTER_SELECT", "actual starter selection required");
        const starter = setup.catalog.starters.find((value: any) => value.cost <= setup.catalog.maximum_starter_cost);
        assert(starter != null, "actual affordable starter required");
        wire.push(...await peer.choose(`bootstrap/starter/${starter.pokemon_id}`));
        wire.push(...await peer.choose("bootstrap/starter/confirm"));
        wire.push(...await peer.press());
        if (peer.host) for (let index = 0; index < 4; index++) {
          const state = await snapshot(peer.client);
          if (state.lifecycle.kind === "ACTIVE" || state.lifecycle.value.stage === "COMPLETE") break;
          wire.push(...await peer.press());
        }
        return wire;
      };
      const [host, guest] = peers;
      const first = await connect(1);
      const choices = one(await starters(guest));
      assert((await starters(host)).length === 0, "host waits for actual guest choices");
      const started = one(await host.ordinary({ kind: "NETWORK_FRAME", generation: 1, bytes: await first.transfer(1, choices) }));
      await guest.ordinary({ kind: "NETWORK_FRAME", generation: 1, bytes: await first.transfer(0, started) });
      await first.close();
      const handoffSnapshots: string[] = [];
      for (const peer of peers) {
        const actual = await snapshot(peer.client);
        assert(actual.lifecycle.kind === "ACTIVE", "natural game must start before rebind");
        // The real Title journey precedes this bounded rebind capture. Restore its
        // exact reached state in a fresh Worker, retaining every subsequent control.
        const replacement = create();
        const initialized = await replacement.dispatch({ kind: "INITIALIZE", initialization: {
          kind: "SNAPSHOT", snapshot: actual, context: { ...peer.context,
            scheduler: actual.scheduler, protocol: actual.protocol } } });
        assert(initialized.response.kind === "READY", "actual battle checkpoint must initialize");
        equal(await snapshot(replacement), actual, "battle handoff changed complete snapshot");
        const fresh = (await capsule(replacement)).value;
        equal(fresh.checkpoint, actual, "rebind capture checkpoint must be the real reached battle");
        assert(fresh.base_position === 0 && fresh.final_position === 0 && fresh.attempts.length === 0,
          "fresh rebind capture must begin before any control");
        handoffSnapshots.push(await digest(actual));
        await peer.client.dispose(); disposed++;
        assert(peer.client.status.closed && peer.client.status.pending === 0, "startup Worker disposal incomplete");
        peer.client = replacement;
        await peer.ordinary({ kind: "TRANSPORT_CHANGED", generation: 1, connected: false });
        assert((await peer.rebind({ kind: "BEGIN" })).frames.length === 0, "disconnected begin emits no wire");
        peer.generation = 2;
      }
      const second = await connect(2);
      for (const peer of peers) await peer.ordinary({ kind: "TRANSPORT_CHANGED", generation: 2, connected: true });
      let wire = one((await host.rebind({ kind: "RETRY" })).frames);
      const beforeRejected = await snapshot(guest.client);
      const beforeCapsule = await capsule(guest.client);
      let rejected = false;
      try { await guest.client.dispatch({ kind: "COOP_REBIND", control: { kind: "RECEIVE", generation: 1, bytes: wire } }); }
      catch (error: any) { rejected = error?.diagnostic?.acceptance === "REJECTED" && error.diagnostic.code === "HOST_REJECTED"; }
      assert(rejected, "wrong generation must be a known transactional host rejection");
      guest.rejected++;
      equal(await snapshot(guest.client), beforeRejected, "wrong generation changed game snapshot");
      const rejectedCapture = await capsule(guest.client);
      assert(rejectedCapture.value.final_position === beforeCapsule.value.final_position + 1,
        "actual typed rejection must be captured");
      for (let index = 0; index < 8; index++) {
        const peer = peers[index % 2 === 0 ? 1 : 0];
        const output = await peer.rebind({ kind: "RECEIVE", generation: 2, bytes: await second.transfer(index % 2, wire) });
        const before = await snapshot(peer.client);
        const captureBefore = await capsule(peer.client);
        const retry = await peer.rebind({ kind: "RETRY" });
        equal(await snapshot(peer.client), before, "retry changed kernel state");
        assert((await capsule(peer.client)).value.final_position === captureBefore.value.final_position + 1,
          "no-op retry remains a causal capture attempt");
        if (index < 7) { equal(retry, output, "retry must conserve actual pending output"); wire = one(retry.frames); }
        else assert(output.frames.length === 0, "open authority has no pending control");
        if (index === 2) {
          const saved = await capsule(peer.client);
          const restored = create();
          await restored.dispatch({ kind: "INITIALIZE", initialization: { kind: "CURRENT_REPRO_CAPSULE", capsule_bytes: saved.bytes } });
          equal(await snapshot(restored), before, "actual midphase Worker capsule restoration differs");
          const repeated = await restored.dispatch({ kind: "COOP_REBIND", control: { kind: "RETRY" } });
          equal(repeated.response.output, retry, "restored pending control differs");
          await restored.dispose(); disposed++;
          assert(restored.status.closed && restored.status.pending === 0, "midphase Worker disposal incomplete");
        }
      }
      for (const peer of peers) {
        const owner = (await snapshot(peer.client)).current_coop_setup.rebind;
        assert(owner.phase === "OPEN" && owner.transcript.length === 8, "actual eight-control open owner required");
        const capture = (await capsule(peer.client)).value;
        const controls = capture.attempts.filter((attempt: any) => attempt.event.kind === "COOP_REBIND");
        assert(controls.length > 0 && controls.every((attempt: any) => attempt.origin === "browser.coop.REBIND"
          && attempt.browser_transport.before_generation === attempt.browser_transport.after_generation),
        "browser control capture must preserve origin and separate transport generation");
      }
      const nextFrame = async (peer: any) => {
        for (let index = 0; index < 8; index++) {
          await peer.settle(); const frames = await peer.press(); if (frames.length > 0) return one(frames);
        }
        throw new Error("actual natural gameplay frame missing");
      };
      const material = await nextFrame(host);
      await guest.ordinary({ kind: "NETWORK_FRAME", generation: 2, bytes: await second.transfer(0, material) });
      await host.settle(); await guest.settle();
      const proposal = await nextFrame(guest);
      const receipt = one(await host.ordinary({ kind: "NETWORK_FRAME", generation: 2, bytes: await second.transfer(1, proposal) }));
      const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(receipt)));
      assert(decoded.schema_version === 2 && decoded.authority_context.connectionGeneration === 2,
        "actual generation two receipt required");
      const hostAfter = await snapshot(host.client);
      equal(decoded.proposal_hex, proposal.map((byte: number) => byte.toString(16).padStart(2, "0")).join(""),
        "receipt must bind exact actual proposal bytes");
      equal(decoded.proposal_digest, `sha256-json-bytes-v1:${await digest(proposal)}`, "receipt proposal digest differs");
      equal(decoded.rebind_transaction_id, hostAfter.current_coop_setup.rebind.transcript[7].transaction_id,
        "receipt belongs to another rebind transaction");
      equal(one(await host.ordinary({ kind: "NETWORK_FRAME", generation: 2, bytes: await second.transfer(1, proposal) })), receipt,
        "duplicate proposal must return actual retained receipt");
      equal(await snapshot(host.client), hostAfter, "duplicate proposal changed host");
      await guest.ordinary({ kind: "NETWORK_FRAME", generation: 2, bytes: await second.transfer(0, receipt) });
      await guest.settle(); await host.settle();
      let final = await Promise.all(peers.map(peer => snapshot(peer.client)));
      equal(final[0].lifecycle, final[1].lifecycle, "settled generation two gameplay diverged");
      await second.close();
      // Continue the same two owners after a real generation-two guest receipt.
      // The cached receipt remains authentic while a different transaction opens.
      for (const peer of peers) {
        peer.rebindGeneration = 3;
        await peer.ordinary({ kind: "TRANSPORT_CHANGED", generation: 2, connected: false });
        assert((await peer.rebind({ kind: "BEGIN" })).frames.length === 0, "second disconnected begin emits no wire");
        peer.generation = 3;
      }
      const third = await connect(3);
      for (const peer of peers) await peer.ordinary({ kind: "TRANSPORT_CHANGED", generation: 3, connected: true });
      wire = one((await host.rebind({ kind: "RETRY" })).frames);
      for (let index = 0; index < 8; index++) {
        const peer = peers[index % 2 === 0 ? 1 : 0];
        const output = await peer.rebind({ kind: "RECEIVE", generation: 3, bytes: await third.transfer(index % 2, wire) });
        const before = await snapshot(peer.client);
        const retry = await peer.rebind({ kind: "RETRY" });
        equal(await snapshot(peer.client), before, "third-generation retry changed kernel state");
        if (index < 7) { equal(retry, output, "third-generation pending retry differs"); wire = one(retry.frames); }
        else assert(output.frames.length === 0, "third-generation authority must open");
        if (index === 2) {
          const saved = await capsule(peer.client);
          const restored = create();
          await restored.dispatch({ kind: "INITIALIZE", initialization: { kind: "CURRENT_REPRO_CAPSULE", capsule_bytes: saved.bytes } });
          equal(await snapshot(restored), before, "second handshake midphase restore lost retained receipt proof");
          const repeated = await restored.dispatch({ kind: "COOP_REBIND", control: { kind: "RETRY" } });
          equal(repeated.response.output, retry, "second handshake restored retry differs");
          await restored.dispose(); disposed++;
          assert(restored.status.closed && restored.status.pending === 0, "second midphase Worker disposal incomplete");
        }
      }
      const rejectOldFrame = async (sender: number, bytes: number[]) => {
        const peer = peers[1 - sender];
        const before = await snapshot(peer.client);
        const transferred = await third.transfer(sender, bytes);
        let rejected = false;
        try { await peer.client.dispatch({ kind: "NETWORK_FRAME", generation: 3, bytes: transferred }); }
        catch (error: any) { rejected = error?.diagnostic?.acceptance === "REJECTED" && error.diagnostic.code === "HOST_REJECTED"; }
        assert(rejected, "old payload carried by the new physical connection must reject");
        equal(await snapshot(peer.client), before, "stale payload changed complete current snapshot");
        peer.rejected++;
      };
      await rejectOldFrame(1, proposal);
      await rejectOldFrame(0, receipt);
      await rejectOldFrame(0, material);
      for (const peer of peers) {
        const current = await snapshot(peer.client);
        assert(current.current_coop_setup.rebind.phase === "OPEN"
          && current.current_coop_setup.rebind.from_generation === 2
          && current.current_coop_setup.rebind.to_generation === 3,
          "same Worker must own the actual second completed rebind");
      }
      const thirdMaterial = await nextFrame(host);
      await guest.ordinary({ kind: "NETWORK_FRAME", generation: 3, bytes: await third.transfer(0, thirdMaterial) });
      await host.settle(); await guest.settle();
      const thirdProposal = await nextFrame(guest);
      const thirdReceipt = one(await host.ordinary({ kind: "NETWORK_FRAME", generation: 3,
        bytes: await third.transfer(1, thirdProposal) }));
      const thirdDecoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(thirdReceipt)));
      assert(thirdDecoded.schema_version === 2 && thirdDecoded.authority_context.connectionGeneration === 3,
        "new gameplay must produce a genuine third-generation receipt");
      const thirdHostAfter = await snapshot(host.client);
      assert(thirdHostAfter.current_coop_setup.retired_reply_rebind == null,
        "actual new receipt must retire its previous bounded witness");
      equal(one(await host.ordinary({ kind: "NETWORK_FRAME", generation: 3,
        bytes: await third.transfer(1, thirdProposal) })), thirdReceipt,
        "duplicate third-generation proposal must return exactly the new receipt");
      equal(await snapshot(host.client), thirdHostAfter, "duplicate new proposal changed current owner");
      equal(thirdDecoded.rebind_transaction_id, thirdHostAfter.current_coop_setup.rebind.transcript[7].transaction_id,
        "new receipt must replace the retained transaction proof");
      equal(thirdDecoded.proposal_hex, thirdProposal.map((byte: number) => byte.toString(16).padStart(2, "0")).join(""),
        "new receipt must bind actual new proposal");
      await guest.ordinary({ kind: "NETWORK_FRAME", generation: 3, bytes: await third.transfer(0, thirdReceipt) });
      await guest.settle(); await host.settle();
      final = await Promise.all(peers.map(peer => snapshot(peer.client)));
      equal(final[0].lifecycle, final[1].lifecycle, "third-generation natural gameplay diverged");
      await third.close();
      const replayHashes: string[] = [];
      for (let index = 0; index < 2; index++) {
        const saved = await capsule(peers[index].client);
        assert(saved.value.base_position === 0 && saved.value.attempts.filter((attempt: any) =>
          attempt.event.kind === "COOP_REBIND" && attempt.event.control.kind === "BEGIN").length === 2,
          "final bounded capsule must retain both actual reconnects from its original reached checkpoint");
        const replay = create();
        const missing = structuredClone(saved.value);
        const removed = missing.attempts.findIndex((attempt: any) => attempt.event.kind === "COOP_REBIND"
          && attempt.event.control.kind === "RECEIVE" && attempt.outcome.kind === "REBIND_APPLIED");
        assert(removed >= 0, "final capsule must retain actual rebind receive");
        missing.attempts.splice(removed, 1);
        missing.attempts.forEach((attempt: any, offset: number) => { attempt.position = missing.base_position + offset + 1; });
        missing.final_position = missing.base_position + missing.attempts.length;
        let missingRejected = false;
        try { await replay.dispatch({ kind: "INITIALIZE", initialization: { kind: "CURRENT_REPRO_CAPSULE",
          capsule_bytes: Array.from(new TextEncoder().encode(text(missing))) } }); }
        catch (error: any) { missingRejected = error?.diagnostic?.acceptance === "REJECTED"
          && error.diagnostic.code === "HOST_REJECTED"; }
        assert(missingRejected && replay.status.acceptedSequence === null, "deleted control must reject before initialization commits");
        await replay.dispatch({ kind: "INITIALIZE", initialization: { kind: "CURRENT_REPRO_CAPSULE", capsule_bytes: saved.bytes } });
        equal(await snapshot(replay), final[index], "actual Worker chronological replay differs");
        replayHashes.push(await digest(saved.value));
        await replay.dispose(); disposed++;
      }
      for (const peer of peers) { await peer.client.dispose(); disposed++;
        assert(peer.client.status.closed && peer.client.status.pending === 0, "real Worker disposal incomplete"); }
      return { physical_connections: connections.length, physical_carriers: carriers,
        actual_workers: clients.length, disposed_workers: disposed, generation: 3, transcript_controls: 16,
        startup_handoff_snapshots: handoffSnapshots, startup_handoff_verified: true,
        raw_inputs: peers.map(peer => peer.raw), presentations: peers.map(peer => peer.presentations),
        rebind_attempts: peers.map(peer => peer.rebinds), known_rejections: peers.map(peer => peer.rejected),
        final_snapshot_sha256: await Promise.all(final.map(digest)), capsule_sha256: replayHashes,
        proposal_sha256: await wireDigest(proposal), receipt_sha256: await wireDigest(receipt),
        third_proposal_sha256: await wireDigest(thirdProposal), third_receipt_sha256: await wireDigest(thirdReceipt),
        repeated_rebind: true, stale_payloads_rejected: true, second_midphase_replay: true,
        midphase_replay: true, final_replay: true, deleted_control_rejected: true,
        duplicate_receipt_exact: true, retry_snapshot_conserved: true };
    } finally {
      for (const pc of connections) pc.close();
      for (const client of clients) if (!client.status.closed) client.terminate("rebind witness teardown");
    }
  }, { entry: `${address}/m9e-assets/${manifest.entry}`, assets: assets(),
    initializations: ["coop-host-initialization.json", "coop-guest-initialization.json"].map(path => `${address}/m9e-assets/${path}`) });
  expect(observed).toHaveLength(8);
  expect(evidence.actual_workers).toBe(8);
  expect(evidence.disposed_workers).toBe(8);
  expect(evidence.physical_connections).toBe(6);
  expect(evidence.physical_carriers).toEqual([
    { generation: 1, sent: [1, 1], received: [1, 1], closed: true, selected_pairs: 2 },
    { generation: 2, sent: [6, 6], received: [6, 6], closed: true, selected_pairs: 2 },
    { generation: 3, sent: [8, 7], received: [7, 8], closed: true, selected_pairs: 2 },
  ]);
  expect(evidence.known_rejections).toEqual([1, 3]);
  expect(evidence.generation).toBe(3);
  for (const count of evidence.raw_inputs) expect(count).toBeGreaterThan(0);
  for (const count of evidence.presentations) expect(count).toBeGreaterThan(0);
  const report = Buffer.from(JSON.stringify({ ...binding(observed), setup_manifest_sha256: sha(setupBytes), ...evidence }));
  expect(report.length).toBeLessThanOrEqual(16 << 10);
  await testInfo.attach("m9e-current-browser-physical-repeat-rebind", { body: report, contentType: "application/json" });
});
