import type { BrowserLifecycleEventV1, BrowserRequestV1 } from "../contracts/browser-contracts";
import type { BrowserClockAdapter } from "./clock-adapter";

export interface BrowserLifecycleAdapterOptions {
  emit(request: BrowserRequestV1): void;
  clock: BrowserClockAdapter;
  window?: Window;
  document?: Document;
}

export class BrowserLifecycleAdapter {
  readonly #emit: (request: BrowserRequestV1) => void;
  readonly #clock: BrowserClockAdapter;
  readonly #window: Window;
  readonly #document: Document;
  #started = false;
  #disposed = false;

  constructor(options: BrowserLifecycleAdapterOptions) {
    this.#emit = options.emit;
    this.#clock = options.clock;
    this.#window = options.window ?? window;
    this.#document = options.document ?? document;
  }

  start(): void {
    if (this.#disposed || this.#started) {
      throw new Error("lifecycle adapter cannot be started twice or after disposal");
    }
    this.#started = true;
    this.#document.addEventListener("visibilitychange", this.#visibilityChanged);
    this.#window.addEventListener("pagehide", this.#pageHidden);
    this.#window.addEventListener("pageshow", this.#pageShown);
    this.#window.addEventListener("freeze", this.#pageFreeze);
    this.#window.addEventListener("resume", this.#pageResume);
    this.#window.addEventListener("beforeunload", this.#beforeUnload);
    this.#window.addEventListener("online", this.#networkOnline);
    this.#window.addEventListener("offline", this.#networkOffline);
    this.#visibilityChanged();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#document.removeEventListener("visibilitychange", this.#visibilityChanged);
    this.#window.removeEventListener("pagehide", this.#pageHidden);
    this.#window.removeEventListener("pageshow", this.#pageShown);
    this.#window.removeEventListener("freeze", this.#pageFreeze);
    this.#window.removeEventListener("resume", this.#pageResume);
    this.#window.removeEventListener("beforeunload", this.#beforeUnload);
    this.#window.removeEventListener("online", this.#networkOnline);
    this.#window.removeEventListener("offline", this.#networkOffline);
  }

  readonly #send = (value: BrowserLifecycleEventV1): void => {
    if (!this.#disposed) {
      this.#emit({ kind: "LIFECYCLE", value });
    }
  };
  readonly #visibilityChanged = (): void => {
    const hidden = this.#document.visibilityState === "hidden";
    if (hidden) {
      this.#clock.pause();
    } else {
      this.#clock.resume();
    }
    this.#send({ kind: "VISIBILITY_CHANGED", value: hidden ? "HIDDEN" : "VISIBLE" });
  };
  readonly #pageHidden = (): void => {
    this.#clock.pause();
    this.#send({ kind: "PAGE_HIDDEN" });
  };
  readonly #pageShown = (): void => {
    this.#clock.resume();
    this.#send({ kind: "PAGE_SHOWN" });
  };
  readonly #pageFreeze = (): void => {
    this.#clock.pause();
    this.#send({ kind: "PAGE_FREEZE" });
  };
  readonly #pageResume = (): void => {
    this.#clock.resume();
    this.#send({ kind: "PAGE_RESUME" });
  };
  readonly #beforeUnload = (): void => this.#send({ kind: "BEFORE_UNLOAD" });
  readonly #networkOnline = (): void => this.#send({ kind: "NETWORK_ONLINE" });
  readonly #networkOffline = (): void => this.#send({ kind: "NETWORK_OFFLINE" });
}
