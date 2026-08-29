import type { BrowserRequestV1 } from "../contracts/browser-contracts";
import { BrowserRawInputAdapter } from "./input-adapter";

export interface MobileInputAdapterOptionsV1 {
  emit(request: BrowserRequestV1): void;
  root: HTMLElement;
  window?: Window;
  document?: Document;
}

export class MobileInputAdapterV1 {
  readonly #window: Window;
  readonly #document: Document;
  readonly #root: HTMLElement;
  readonly #raw: BrowserRawInputAdapter;
  readonly #orientation: MediaQueryList;
  #started = false;
  #disposed = false;

  constructor(options: MobileInputAdapterOptionsV1) {
    this.#window = options.window ?? window;
    this.#document = options.document ?? document;
    this.#root = options.root;
    this.#raw = new BrowserRawInputAdapter({
      target: this.#window,
      document: this.#document,
      emit: options.emit,
      gamepadPollIntervalMs: 32,
    });
    this.#orientation = this.#window.matchMedia("(orientation: portrait)");
  }

  start(): void {
    if (this.#disposed || this.#started) {
      throw new Error("mobile input adapter cannot start twice or after disposal");
    }
    this.#started = true;
    this.#raw.start();
    this.#window.visualViewport?.addEventListener("resize", this.#layout);
    this.#orientation.addEventListener("change", this.#layout);
    this.#root.addEventListener("contextmenu", this.#preventControllerContextMenu);
    this.#layout();
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#raw.dispose();
    this.#window.visualViewport?.removeEventListener("resize", this.#layout);
    this.#orientation.removeEventListener("change", this.#layout);
    this.#root.removeEventListener("contextmenu", this.#preventControllerContextMenu);
    this.#root.style.removeProperty("--rust-visual-width");
    this.#root.style.removeProperty("--rust-visual-height");
    delete this.#root.dataset.rustOrientation;
  }

  readonly #layout = (): void => {
    if (this.#disposed) {
      return;
    }
    const viewport = this.#window.visualViewport;
    const width = Math.max(1, Math.floor(viewport?.width ?? this.#window.innerWidth));
    const height = Math.max(1, Math.floor(viewport?.height ?? this.#window.innerHeight));
    this.#root.style.setProperty("--rust-visual-width", `${width}px`);
    this.#root.style.setProperty("--rust-visual-height", `${height}px`);
    this.#root.dataset.rustOrientation = this.#orientation.matches ? "portrait" : "landscape";
  };

  readonly #preventControllerContextMenu = (event: Event): void => {
    if (event.target instanceof Element && event.target.closest("[data-rust-physical-key]") != null) {
      event.preventDefault();
    }
  };
}
