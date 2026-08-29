export interface LogicalOptionProjectionV1 {
  option_id: string;
  label: string;
  disabled: boolean;
  hidden: boolean;
  selected: boolean;
  row: number;
  column: number;
}

export interface LogicalUiProjectionV1 {
  control_id: string;
  control_kind: string;
  menu_instance_id: number;
  actionable: boolean;
  title: string;
  options: LogicalOptionProjectionV1[];
  status_lines: string[];
  terminal: string | null;
  fault: string | null;
}

function decodeProjection(bytes: Uint8Array): LogicalUiProjectionV1 {
  const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (typeof value !== "object" || value == null) {
    throw new Error("Rust UI projection is not an object");
  }
  const projection = value as Partial<LogicalUiProjectionV1>;
  if (
    typeof projection.control_id !== "string"
    || typeof projection.control_kind !== "string"
    || !Number.isSafeInteger(projection.menu_instance_id)
    || typeof projection.actionable !== "boolean"
    || typeof projection.title !== "string"
    || !Array.isArray(projection.options)
    || !Array.isArray(projection.status_lines)
  ) {
    throw new Error("Rust UI projection does not match the frozen reference shape");
  }
  return projection as LogicalUiProjectionV1;
}

export class DomReferenceView {
  readonly #root: HTMLElement;
  #disposed = false;

  constructor(root: HTMLElement) {
    this.#root = root;
    this.#root.dataset.rustKernelView = "reference-v1";
    this.#root.setAttribute("aria-live", "polite");
  }

  render(bytes: Uint8Array): void {
    if (this.#disposed) {
      throw new Error("DOM reference view is disposed");
    }
    const projection = decodeProjection(bytes);
    const fragment = document.createDocumentFragment();
    const heading = document.createElement("h1");
    heading.textContent = projection.title;
    fragment.append(heading);

    const status = document.createElement("div");
    status.setAttribute("role", "status");
    for (const line of projection.status_lines) {
      const paragraph = document.createElement("p");
      paragraph.textContent = line;
      status.append(paragraph);
    }
    fragment.append(status);

    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", projection.control_kind);
    menu.dataset.controlId = projection.control_id;
    menu.dataset.menuInstanceId = String(projection.menu_instance_id);
    menu.dataset.actionable = String(projection.actionable);
    for (const option of projection.options) {
      if (option.hidden) {
        continue;
      }
      const element = document.createElement("button");
      element.type = "button";
      element.setAttribute("role", "menuitem");
      element.dataset.optionId = option.option_id;
      element.dataset.row = String(option.row);
      element.dataset.column = String(option.column);
      element.disabled = option.disabled || !projection.actionable;
      element.tabIndex = option.selected ? 0 : -1;
      element.setAttribute("aria-current", option.selected ? "true" : "false");
      element.textContent = option.label;
      menu.append(element);
    }
    fragment.append(menu);

    const controller = document.createElement("div");
    controller.setAttribute("role", "group");
    controller.setAttribute("aria-label", "Rust physical controls");
    for (const [code, label] of [
      ["ArrowUp", "Up"],
      ["ArrowDown", "Down"],
      ["ArrowLeft", "Left"],
      ["ArrowRight", "Right"],
      ["Space", "Action"],
      ["Escape", "Cancel"],
    ] as const) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.rustPhysicalKey = code;
      button.disabled = !projection.actionable;
      button.textContent = label;
      controller.append(button);
    }
    fragment.append(controller);

    if (projection.terminal != null || projection.fault != null) {
      const terminal = document.createElement("div");
      terminal.setAttribute("role", "alert");
      terminal.dataset.kind = projection.fault == null ? "terminal" : "fault";
      terminal.textContent = projection.fault ?? projection.terminal ?? "";
      fragment.append(terminal);
    }
    this.#root.replaceChildren(fragment);
  }

  dispose(): void {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#root.replaceChildren();
    delete this.#root.dataset.rustKernelView;
  }
}
