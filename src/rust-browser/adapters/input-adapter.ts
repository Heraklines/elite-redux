import type { BrowserRequestV1, PhysicalKeyV1, RawInputEventV1 } from "../contracts/browser-contracts";

export interface BrowserRawInputAdapterOptions {
  target?: Window;
  document?: Document;
  emit(request: BrowserRequestV1): void;
  gamepadPollIntervalMs?: number;
}

const KNOWN_KEYS: Readonly<Record<string, PhysicalKeyV1["kind"]>> = {
  ArrowUp: "ARROW_UP",
  ArrowDown: "ARROW_DOWN",
  ArrowLeft: "ARROW_LEFT",
  ArrowRight: "ARROW_RIGHT",
  Enter: "ENTER",
  Space: "SPACE",
  Escape: "ESCAPE",
  Backspace: "BACKSPACE",
  KeyA: "KEY_A",
  KeyB: "KEY_B",
  KeyC: "KEY_C",
  KeyD: "KEY_D",
  KeyE: "KEY_E",
  KeyF: "KEY_F",
  KeyN: "KEY_N",
  KeyR: "KEY_R",
  KeyT: "KEY_T",
};

function physicalKey(code: string): PhysicalKeyV1 {
  const kind = KNOWN_KEYS[code];
  return kind == null ? { kind: "UNKNOWN", value: code } : { kind };
}

function isTextEntry(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) {
    return false;
  }
  return (
    element.isContentEditable
    || element instanceof HTMLInputElement
    || element instanceof HTMLTextAreaElement
    || element instanceof HTMLSelectElement
  );
}

export class BrowserRawInputAdapter {
  readonly #target: Window;
  readonly #document: Document;
  readonly #emit: (request: BrowserRequestV1) => void;
  readonly #pollInterval: number;
  readonly #pressedKeys = new Set<string>();
  readonly #gamepadButtons = new Map<string, boolean>();
  readonly #pointerKeys = new Map<number, PhysicalKeyV1>();
  #poller: number | null = null;
  #disposed = false;

  constructor(options: BrowserRawInputAdapterOptions) {
    this.#target = options.target ?? window;
    this.#document = options.document ?? document;
    this.#emit = options.emit;
    this.#pollInterval = Math.max(16, options.gamepadPollIntervalMs ?? 50);
  }

  start(): void {
    if (this.#disposed || this.#poller != null) {
      throw new Error("raw input adapter cannot be started twice or after disposal");
    }
    this.#target.addEventListener("keydown", this.#onKeyDown, { capture: true });
    this.#target.addEventListener("keyup", this.#onKeyUp, { capture: true });
    this.#target.addEventListener("blur", this.#onBlur);
    this.#target.addEventListener("focus", this.#onFocus);
    this.#document.addEventListener("focusin", this.#onFocusChanged);
    this.#document.addEventListener("focusout", this.#onFocusChanged);
    this.#document.addEventListener("pointerdown", this.#onPointerDown);
    this.#document.addEventListener("pointerup", this.#onPointerUp);
    this.#document.addEventListener("pointercancel", this.#onPointerUp);
    this.#poller = this.#target.setInterval(this.#pollGamepads, this.#pollInterval);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#target.removeEventListener("keydown", this.#onKeyDown, { capture: true });
    this.#target.removeEventListener("keyup", this.#onKeyUp, { capture: true });
    this.#target.removeEventListener("blur", this.#onBlur);
    this.#target.removeEventListener("focus", this.#onFocus);
    this.#document.removeEventListener("focusin", this.#onFocusChanged);
    this.#document.removeEventListener("focusout", this.#onFocusChanged);
    this.#document.removeEventListener("pointerdown", this.#onPointerDown);
    this.#document.removeEventListener("pointerup", this.#onPointerUp);
    this.#document.removeEventListener("pointercancel", this.#onPointerUp);
    if (this.#poller != null) {
      this.#target.clearInterval(this.#poller);
      this.#poller = null;
    }
    this.#pressedKeys.clear();
    this.#gamepadButtons.clear();
    this.#pointerKeys.clear();
  }

  readonly #send = (event: RawInputEventV1): void => {
    if (!this.#disposed) {
      this.#emit({ kind: "RAW_INPUT", value: event });
    }
  };

  readonly #onKeyDown = (event: KeyboardEvent): void => {
    const duplicate = this.#pressedKeys.has(event.code);
    this.#pressedKeys.add(event.code);
    this.#send({
      kind: "KEY_DOWN",
      data: {
        code: physicalKey(event.code),
        printable: event.key.length === 1,
        browser_repeat: event.repeat || duplicate,
        focus: isTextEntry(this.#document.activeElement) ? "TEXT_ENTRY" : "GAME",
      },
    });
  };

  readonly #onKeyUp = (event: KeyboardEvent): void => {
    this.#pressedKeys.delete(event.code);
    this.#send({ kind: "KEY_UP", data: { code: physicalKey(event.code) } });
  };

  readonly #onBlur = (): void => {
    this.#pressedKeys.clear();
    this.#gamepadButtons.clear();
    this.#send({ kind: "WINDOW_BLURRED" });
  };

  readonly #onFocus = (): void => this.#send({ kind: "WINDOW_FOCUSED" });

  readonly #onFocusChanged = (): void => {
    this.#send({ kind: "FOCUS_CHANGED", data: isTextEntry(this.#document.activeElement) ? "TEXT_ENTRY" : "GAME" });
  };

  readonly #onPointerDown = (event: PointerEvent): void => {
    const source =
      event.target instanceof Element ? event.target.closest<HTMLElement>("[data-rust-physical-key]") : null;
    const code = source?.dataset.rustPhysicalKey;
    if (code == null || this.#pointerKeys.has(event.pointerId)) {
      return;
    }
    const key = physicalKey(code);
    this.#pointerKeys.set(event.pointerId, key);
    this.#send({
      kind: "KEY_DOWN",
      data: { code: key, printable: false, browser_repeat: false, focus: "GAME" },
    });
  };

  readonly #onPointerUp = (event: PointerEvent): void => {
    const key = this.#pointerKeys.get(event.pointerId);
    if (key == null) {
      return;
    }
    this.#pointerKeys.delete(event.pointerId);
    this.#send({ kind: "KEY_UP", data: { code: key } });
  };

  readonly #pollGamepads = (): void => {
    if (this.#disposed || typeof navigator.getGamepads !== "function") {
      return;
    }
    for (const pad of navigator.getGamepads()) {
      if (pad == null) {
        continue;
      }
      pad.buttons.forEach((button, index) => {
        const key = `${pad.index}:${index}`;
        const previous = this.#gamepadButtons.get(key) ?? false;
        if (button.pressed !== previous) {
          this.#gamepadButtons.set(key, button.pressed);
          this.#send({ kind: button.pressed ? "GAMEPAD_DOWN" : "GAMEPAD_UP", data: { button: index } });
        }
      });
    }
  };
}
