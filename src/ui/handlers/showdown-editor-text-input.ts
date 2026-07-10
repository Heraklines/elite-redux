/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// The Showdown Set Editor's mobile/desktop text-input bridge (implements the
// {@linkcode ShowdownEditorTextInput} seam the handler stubbed in P1).
//
// It rides the SAME infra the login / nickname forms use: a rex `InputText` wraps a real hidden DOM
// `<input>`. Focusing it raises the NATIVE on-screen keyboard on a touch device AND captures the
// physical keyboard on desktop (type-anywhere while a search pane is open), so both input worlds feed
// the editor's typeahead through one path. The controller path never touches this (it drives the pane
// via `processInput` directly). Every character change is pushed to the handler's `setFilter` via the
// `onFilterChange` callback; the DOM input itself is kept OFF-SCREEN (it is a capture surface, not a
// visible field - the editor draws the filter string itself).
// =============================================================================

import { globalScene } from "#app/global-scene";
import { TextStyle } from "#enums/text-style";
import type { ShowdownEditorTextInput } from "#ui/showdown-set-editor-ui-handler";
import { addTextInputObject } from "#ui/text";
import type InputText from "phaser3-rex-plugins/plugins/inputtext";

export class DomShowdownEditorTextInput implements ShowdownEditorTextInput {
  private input: InputText | null = null;
  private changeHandler: ((value: string) => void) | null = null;

  open(initial: string, onFilterChange: (value: string) => void): void {
    // Headless / no-DOM (tests, render harness): the factory is absent, so this is an inert no-op and
    // the editor simply runs without a native keyboard - the controller/step-driven paths are unaffected.
    if (typeof globalScene?.add?.rexInputText !== "function") {
      return;
    }
    this.close();
    // Off-screen capture surface: a maxLength cap keeps a hostile paste bounded; text is read back via
    // the `textchange` event, never shown here (the editor renders the filter string in its pane header).
    const input = addTextInputObject(-1000, -1000, 200, 40, TextStyle.TOOLTIP_CONTENT, {
      type: "text",
      maxLength: 24,
    });
    input.setText(initial);
    this.changeHandler = () => onFilterChange(input.text);
    input.on("textchange", this.changeHandler);
    input.setFocus();
    this.input = input;
  }

  close(): void {
    if (this.input == null) {
      return;
    }
    if (this.changeHandler != null) {
      this.input.off("textchange", this.changeHandler);
      this.changeHandler = null;
    }
    // Blur so the native keyboard drops, then destroy the DOM node (a fresh one is made on the next open).
    this.input.setBlur();
    this.input.destroy();
    this.input = null;
  }
}
