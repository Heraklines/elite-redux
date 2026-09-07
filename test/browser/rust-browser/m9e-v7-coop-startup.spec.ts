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
    await Promise.all([left, right].map(page => page.evaluate(() => (globalThis as any).__naturalCoop.peer.ready())));
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
        const canonical = (value: any): string => JSON.stringify(value);
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
              if (!(event.data instanceof ArrayBuffer) || event.data.byteLength === 0 || event.data.byteLength > 32 << 20) throw new Error("bounded replay response required");
              const result = JSON.parse(new TextDecoder().decode(event.data));
              if (result.version !== 2 || result.request_id !== expected + 1 || result.accepted_sequence !== expected
                || result.response.kind === "FAULT") throw new Error("replay response correlation or acceptance differs");
              resolve(result.response);
            } catch (issue) { reject(issue); }
          };
          worker.addEventListener("message", message); worker.addEventListener("error", error);
          const envelope = new TextEncoder().encode(JSON.stringify({ version: 2, request_id: expected + 1, sequence: expected, request: payload }));
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
          const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
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
