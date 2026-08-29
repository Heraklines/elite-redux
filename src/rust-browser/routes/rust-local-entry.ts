import { BrowserClockAdapter } from "../adapters/clock-adapter";
import { BrowserRawInputAdapter } from "../adapters/input-adapter";
import { BrowserLifecycleAdapter } from "../adapters/lifecycle-adapter";
import { BrowserStorageAdapter } from "../adapters/storage-adapter";
import {
  BrowserExecutionModeV1,
  type BrowserRequestV1,
  type BrowserResponseEnvelopeV1,
} from "../contracts/browser-contracts";
import { RustBrowserHost } from "../host/rust-browser-host";
import { DomReferenceView } from "../render/dom-reference-view";
import { ReferencePresentationView } from "../render/reference-presentation-view";

export interface RustLocalRouteOptionsV1 {
  workerUrl: URL;
  executionIdentityBytes: Uint8Array;
  sessionStartBytes: Uint8Array;
  uiRoot: HTMLElement;
  presentationRoot: HTMLElement;
  storageDatabaseName: string;
  executionIdentity: string;
  contentIdentity: string;
}

export interface RustLocalRouteSessionV1 {
  snapshot(): Promise<Uint8Array>;
  exportRepro(): Promise<Uint8Array>;
  mechanicalDigest(): Promise<string>;
  dispose(): Promise<void>;
}

export async function startRustLocalRoute(options: RustLocalRouteOptionsV1): Promise<RustLocalRouteSessionV1> {
  const host = await RustBrowserHost.create({
    workerUrl: options.workerUrl,
    initialize: {
      kind: "INITIALIZE",
      value: {
        mode: BrowserExecutionModeV1.RUST_LOCAL_AUTHORITY,
        execution_identity_bytes: Array.from(options.executionIdentityBytes),
        session_start_bytes: Array.from(options.sessionStartBytes),
        maximum_pending_requests: 64,
      },
    },
  });
  const dom = new DomReferenceView(options.uiRoot);
  const presentation = new ReferencePresentationView(options.presentationRoot);
  const storage = new BrowserStorageAdapter({
    databaseName: options.storageDatabaseName,
    executionIdentity: options.executionIdentity,
    contentIdentity: options.contentIdentity,
  });
  let disposed = false;
  let work = Promise.resolve();
  let disposePromise: Promise<void> | null = null;

  const handleResponses = async (responses: BrowserResponseEnvelopeV1[]): Promise<void> => {
    for (const envelope of responses) {
      if (envelope.response.kind === "FAULT") {
        throw new Error(`${envelope.response.value.code}: ${envelope.response.value.message}`);
      }
      if (envelope.response.kind !== "EFFECTS") {
        continue;
      }
      for (const effect of envelope.response.value.effects) {
        if (effect.kind === "UI_CHANGED") {
          dom.render(Uint8Array.from(effect.value));
        } else if (effect.kind === "PRESENTATION") {
          const bytes = Uint8Array.from(effect.value);
          const parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as { event_id?: unknown };
          const eventId = typeof parsed.event_id === "string" ? parsed.event_id : "unknown-presentation";
          const outcome = await presentation.present(bytes);
          await dispatch({ kind: "PRESENTATION_SETTLED", value: { event_id: eventId, outcome } });
        } else if (effect.kind === "STORAGE_REQUEST") {
          await handleStorageRequest(Uint8Array.from(effect.value));
        }
      }
      clock.schedule(envelope.response.value.next_wakeup_micros);
    }
  };

  const dispatch = async (request: BrowserRequestV1): Promise<void> => {
    if (disposed) {
      throw new Error("Rust-local route is disposed");
    }
    await handleResponses(await host.dispatch(request));
  };

  const enqueue = (request: BrowserRequestV1): void => {
    work = work.then(() => dispatch(request));
    work.catch(error => {
      options.uiRoot.replaceChildren(
        Object.assign(document.createElement("div"), { role: "alert", textContent: String(error) }),
      );
    });
  };

  const handleStorageRequest = async (bytes: Uint8Array): Promise<void> => {
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as {
      request_id: number;
      operation: "READ" | "WRITE" | "DELETE";
      key: string;
      expected_revision?: number | null;
      bytes?: number[];
    };
    let result: unknown;
    if (value.operation === "READ") {
      const stored = await storage.read(value.key);
      result = stored == null ? null : { revision: stored.revision, bytes: Array.from(stored.bytes) };
    } else if (value.operation === "WRITE") {
      result = {
        revision: await storage.compareAndSwap(
          value.key,
          value.expected_revision ?? null,
          Uint8Array.from(value.bytes ?? []),
        ),
      };
    } else {
      await storage.delete(value.key, value.expected_revision ?? -1);
      result = { deleted: true };
    }
    const resultBytes = new TextEncoder().encode(JSON.stringify(result));
    await dispatch({ kind: "STORAGE_RESULT", value: { request_id: value.request_id, bytes: Array.from(resultBytes) } });
  };

  const clock = new BrowserClockAdapter({ emit: enqueue });
  const lifecycle = new BrowserLifecycleAdapter({ emit: enqueue, clock });
  const input = new BrowserRawInputAdapter({ emit: enqueue });
  lifecycle.start();
  input.start();
  enqueue({ kind: "OBSERVE", value: { profile: "RUST_LOCAL_INITIAL" } });

  return {
    snapshot: () => host.snapshot(),
    exportRepro: () => host.exportRepro(),
    mechanicalDigest: async () => {
      await work;
      const responses = await host.dispatch({ kind: "OBSERVE", value: { profile: "RUST_LOCAL_DIGEST" } });
      await handleResponses(responses);
      const digest = responses.at(-1)?.after_mechanical_digest;
      if (digest == null) {
        throw new Error("Rust-local observation returned no mechanical digest");
      }
      return digest;
    },
    dispose: () => {
      if (disposePromise != null) {
        return disposePromise;
      }
      input.dispose();
      lifecycle.dispose();
      clock.dispose();
      disposePromise = (async () => {
        await work.catch(() => undefined);
        disposed = true;
        await storage.dispose();
        presentation.dispose();
        dom.dispose();
        await host.dispose();
      })();
      return disposePromise;
    },
  };
}
