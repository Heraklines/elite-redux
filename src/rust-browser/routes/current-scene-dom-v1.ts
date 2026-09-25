import type { BrowserRequestV2, CurrentPresentationSceneV1Wire } from "../contracts/browser-contracts-v2";

type MenuView = {
  control_id: string;
  selected_option_id: string;
  options: Array<{ option_id: string; visible: boolean; enabled: boolean }>;
};

const KEY_CODES = {
  ArrowUp: "ARROW_UP",
  ArrowDown: "ARROW_DOWN",
  ArrowLeft: "ARROW_LEFT",
  ArrowRight: "ARROW_RIGHT",
  Enter: "ENTER",
  Space: "SPACE",
  Escape: "ESCAPE",
  Backspace: "BACKSPACE",
} as const;

/** Modest current-session reference view. It only receives the game-owned
 * projection and sends raw keys; it never reads a mechanical snapshot.
 */
export class CurrentSceneDomV1 {
  readonly #root: HTMLElement;
  readonly #localSeat: number;
  readonly #send: (request: BrowserRequestV2) => Promise<unknown>;
  readonly #onError: (error: unknown) => void;
  #scene: CurrentPresentationSceneV1Wire | null = null;
  #delivery: Promise<unknown> = Promise.resolve();
  #failed = false;
  #disposed = false;

  constructor(
    root: HTMLElement,
    localSeat: number,
    send: (request: BrowserRequestV2) => Promise<unknown>,
    onError: (error: unknown) => void,
  ) {
    if (!Number.isSafeInteger(localSeat) || localSeat <= 0) {
      throw new Error("invalid local presentation seat");
    }
    this.#root = root;
    this.#localSeat = localSeat;
    this.#send = send;
    this.#onError = onError;
    root.tabIndex = 0;
    root.addEventListener("keydown", this.#key);
    root.addEventListener("keyup", this.#key);
  }

  render(scene: CurrentPresentationSceneV1Wire): void {
    if (this.#disposed || scene.schema_version !== 1) {
      throw new Error("unsupported current scene");
    }
    this.#scene = scene;
    const doc = this.#root.ownerDocument;
    const heading = doc.createElement("h2");
    heading.textContent = scene.control.kind;
    const owner = doc.createElement("p");
    owner.textContent =
      scene.control.owner_seat == null
        ? "Shared control"
        : scene.control.owner_seat === this.#localSeat
          ? "Your control"
          : `Seat ${scene.control.owner_seat} controls`;
    const field = doc.createElement("ul");
    field.setAttribute("aria-label", "Battle field");
    for (const actor of scene.actors) {
      const item = doc.createElement("li");
      const hp =
        actor.hp.kind === "PLAYER_EXACT"
          ? `HP ${actor.hp.hp}/${actor.hp.max_hp}`
          : `HP bar ${Math.round(actor.hp.ten_thousandths / 100)}%`;
      item.textContent = `${actor.slot.side} ${actor.slot.position + 1}: species ${actor.species}, form ${actor.form}, ${hp}, ${actor.status}`;
      field.append(item);
    }
    const menu = scene.control.menu as MenuView | null;
    const options = doc.createElement("ul");
    options.setAttribute("aria-label", menu?.control_id ?? "No menu");
    for (const option of menu?.options ?? []) {
      if (!option.visible) {
        continue;
      }
      const item = doc.createElement("li");
      const selected = option.option_id === menu?.selected_option_id;
      item.textContent = `${selected ? "▶ " : ""}${option.option_id}${option.enabled ? "" : " (unavailable)"}`;
      item.setAttribute("aria-current", selected ? "true" : "false");
      item.setAttribute("aria-disabled", option.enabled ? "false" : "true");
      options.append(item);
    }
    this.#root.replaceChildren(heading, owner, field, options);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#scene = null;
    this.#root.removeEventListener("keydown", this.#key);
    this.#root.removeEventListener("keyup", this.#key);
    this.#root.replaceChildren();
  }

  readonly #key = (event: KeyboardEvent): void => {
    if (this.#disposed || this.#failed || this.#scene == null) {
      return;
    }
    if (this.#scene.control.owner_seat != null && this.#scene.control.owner_seat !== this.#localSeat) {
      return;
    }
    const kind = KEY_CODES[event.code as keyof typeof KEY_CODES];
    if (kind == null) {
      return;
    }
    event.preventDefault();
    const request: BrowserRequestV2 = {
      kind: "RAW_INPUT",
      event:
        event.type === "keydown"
          ? {
              kind: "KEY_DOWN",
              data: { code: { kind }, printable: false, browser_repeat: event.repeat, focus: "GAME" },
            }
          : { kind: "KEY_UP", data: { code: { kind } } },
    };
    this.#delivery = this.#delivery
      .then(() => this.#send(request))
      .catch(error => {
        this.#failed = true;
        this.#onError(error);
      });
  };
}
