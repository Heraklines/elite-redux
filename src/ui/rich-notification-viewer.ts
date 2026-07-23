/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

export interface RichNotificationContent {
  title: string;
  markdown: string;
  actionLabel?: string;
  actionUrl?: string;
}

const markdown = new MarkdownIt({ breaks: true, html: false, linkify: true, typographer: true });
const ALLOWED_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "h1",
  "h2",
  "h3",
  "hr",
  "img",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
];

/** Accept public HTTPS URLs plus local HTTP URLs used by development builds. */
export function safeRichNotificationUrl(
  raw: string,
  base = globalThis.location?.href ?? "https://localhost/",
): string | null {
  try {
    const url = new URL(raw, base);
    const localHttp = url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return url.protocol === "https:" || localHttp ? url.href : null;
  } catch {
    return null;
  }
}

/** Render untrusted notification Markdown without permitting raw HTML or unsafe URLs. */
export function renderRichNotificationMarkdown(source: string): string {
  const rendered = markdown.render(source);
  const clean = String(
    DOMPurify.sanitize(rendered, {
      ALLOWED_ATTR: ["alt", "href", "src", "title"],
      ALLOWED_TAGS,
    }),
  );
  if (typeof document === "undefined") {
    return clean;
  }

  const template = document.createElement("template");
  template.innerHTML = clean;
  for (const link of template.content.querySelectorAll("a")) {
    const href = safeRichNotificationUrl(link.getAttribute("href") ?? "");
    if (href == null) {
      link.removeAttribute("href");
      continue;
    }
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  }
  for (const image of template.content.querySelectorAll("img")) {
    const src = safeRichNotificationUrl(image.getAttribute("src") ?? "");
    if (src == null) {
      image.remove();
      continue;
    }
    image.src = src;
    image.loading = "lazy";
    image.decoding = "async";
  }
  return template.innerHTML;
}

export class RichNotificationViewer {
  private readonly root: HTMLDivElement;
  private readonly scroller: HTMLElement;
  private readonly actionUrl: string | null;
  private readonly onClose: () => void;
  private closed = false;

  constructor(content: RichNotificationContent, onClose: () => void) {
    this.onClose = onClose;
    this.actionUrl = content.actionUrl ? safeRichNotificationUrl(content.actionUrl) : null;
    this.root = document.createElement("div");
    this.root.className = "er-rich-notification-backdrop";
    this.root.setAttribute("role", "presentation");

    const dialog = document.createElement("section");
    dialog.className = "er-rich-notification";
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", "er-rich-notification-title");

    const header = document.createElement("header");
    const title = document.createElement("h1");
    title.id = "er-rich-notification-title";
    title.textContent = content.title;
    const close = document.createElement("button");
    close.className = "er-rich-notification-close";
    close.type = "button";
    close.title = "Close";
    close.setAttribute("aria-label", "Close patch notes");
    close.textContent = "x";
    close.addEventListener("click", () => this.close());
    header.append(title, close);

    this.scroller = document.createElement("article");
    this.scroller.className = "er-rich-notification-content";
    this.scroller.innerHTML = renderRichNotificationMarkdown(content.markdown);

    const footer = document.createElement("footer");
    const hint = document.createElement("span");
    hint.textContent = "Scroll for the full notes";
    footer.append(hint);
    if (this.actionUrl != null) {
      const action = document.createElement("button");
      action.className = "er-rich-notification-action";
      action.type = "button";
      action.textContent = content.actionLabel?.trim() || "Open link";
      action.addEventListener("click", () => this.activateAction());
      footer.append(action);
    }

    dialog.append(header, this.scroller, footer);
    this.root.append(dialog);
    this.root.addEventListener("click", event => {
      if (event.target === this.root) {
        this.close();
      }
    });
    this.root.addEventListener("keydown", this.handleKeyDown, true);
    document.body.append(this.root);
    close.focus();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    switch (event.key) {
      case "Escape":
        this.close();
        break;
      case "ArrowDown":
        this.scrollBy(90);
        break;
      case "ArrowUp":
        this.scrollBy(-90);
        break;
      case "PageDown":
        this.scrollBy(this.scroller.clientHeight * 0.8);
        break;
      case "PageUp":
        this.scrollBy(this.scroller.clientHeight * -0.8);
        break;
      case "Home":
        this.scroller.scrollTo({ top: 0 });
        break;
      case "End":
        this.scroller.scrollTo({ top: this.scroller.scrollHeight });
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  scrollBy(amount: number): void {
    this.scroller.scrollBy({ behavior: "smooth", top: amount });
  }

  activateAction(): boolean {
    if (this.actionUrl == null) {
      return false;
    }
    window.open(this.actionUrl, "_blank", "noopener,noreferrer")?.focus();
    return true;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.destroy();
    this.onClose();
  }

  destroy(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.root.removeEventListener("keydown", this.handleKeyDown, true);
    this.root.remove();
  }
}
