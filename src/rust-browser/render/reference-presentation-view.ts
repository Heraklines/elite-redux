export type PresentationSettlementOutcomeV1 = "SETTLED" | "INTENTIONALLY_SKIPPED" | "FAILED";

export interface BrowserPresentationCueV1 {
  event_id: string;
  kind:
    | "MOVE_USED"
    | "HP_CHANGED"
    | "STATUS_APPLIED"
    | "STAT_STAGE_CHANGED"
    | "SWITCHED"
    | "FAINTED"
    | "ABILITY_ACTIVATED"
    | "BATTLE_WON"
    | "BATTLE_LOST";
  blocking_policy: "NON_BLOCKING" | "BLOCKS_HUMAN_INPUT";
  text: string;
  duration_ms?: number;
}

const CUE_KINDS = new Set<BrowserPresentationCueV1["kind"]>([
  "MOVE_USED",
  "HP_CHANGED",
  "STATUS_APPLIED",
  "STAT_STAGE_CHANGED",
  "SWITCHED",
  "FAINTED",
  "ABILITY_ACTIVATED",
  "BATTLE_WON",
  "BATTLE_LOST",
]);

export function decodeBrowserPresentationCue(bytes: Uint8Array): BrowserPresentationCueV1 {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (typeof value !== "object" || value == null) {
    throw new Error("presentation cue is not an object");
  }
  const cue = value as Partial<BrowserPresentationCueV1>;
  if (
    typeof cue.event_id !== "string"
    || !CUE_KINDS.has(cue.kind as BrowserPresentationCueV1["kind"])
    || (cue.blocking_policy !== "NON_BLOCKING" && cue.blocking_policy !== "BLOCKS_HUMAN_INPUT")
    || typeof cue.text !== "string"
    || (cue.duration_ms != null
      && (!Number.isSafeInteger(cue.duration_ms) || cue.duration_ms < 0 || cue.duration_ms > 10_000))
  ) {
    throw new Error("presentation cue does not match the frozen reference shape");
  }
  return cue as BrowserPresentationCueV1;
}

export class ReferencePresentationView {
  readonly #root: HTMLElement;
  #generation = 0;
  #disposed = false;
  #activeTimer: number | null = null;
  #activeResolve: ((outcome: PresentationSettlementOutcomeV1) => void) | null = null;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#root.dataset.rustPresentationView = "reference-v1";
    this.#root.setAttribute("aria-live", "assertive");
  }

  async present(bytes: Uint8Array): Promise<PresentationSettlementOutcomeV1> {
    if (this.#disposed) {
      return "FAILED";
    }
    let cue: BrowserPresentationCueV1;
    try {
      cue = decodeBrowserPresentationCue(bytes);
    } catch {
      return "FAILED";
    }
    this.#cancelActive("FAILED");
    const generation = ++this.#generation;
    const element = document.createElement("div");
    element.dataset.eventId = cue.event_id;
    element.dataset.kind = cue.kind;
    element.dataset.blocking = String(cue.blocking_policy === "BLOCKS_HUMAN_INPUT");
    element.setAttribute("role", cue.kind === "BATTLE_WON" || cue.kind === "BATTLE_LOST" ? "alert" : "status");
    element.textContent = cue.text;
    this.#root.replaceChildren(element);

    const duration = cue.blocking_policy === "NON_BLOCKING" ? 0 : Math.max(0, cue.duration_ms ?? 180);
    return new Promise<PresentationSettlementOutcomeV1>(resolve => {
      this.#activeResolve = resolve;
      this.#activeTimer = window.setTimeout(() => {
        if (this.#disposed || generation !== this.#generation) {
          return;
        }
        this.#activeTimer = null;
        this.#activeResolve = null;
        element.dataset.settled = "true";
        resolve("SETTLED");
      }, duration);
    });
  }

  skip(): void {
    this.#cancelActive("INTENTIONALLY_SKIPPED");
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#generation += 1;
    this.#cancelActive("FAILED");
    this.#root.replaceChildren();
    delete this.#root.dataset.rustPresentationView;
  }

  #cancelActive(outcome: PresentationSettlementOutcomeV1): void {
    if (this.#activeTimer != null) {
      window.clearTimeout(this.#activeTimer);
      this.#activeTimer = null;
    }
    const resolve = this.#activeResolve;
    this.#activeResolve = null;
    resolve?.(outcome);
  }
}
