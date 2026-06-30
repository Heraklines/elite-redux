/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Community Challenge - a single, configurable text-input modal. The create
// designer reuses ONE instance for the NAME / SUBTITLE / DESCRIPTION fields: the
// title is set per open (read by getModalTitle, which the modal re-applies on
// show via updateContainer), and the entered string is returned RAW (no base64)
// through the caller's buttonActions[0]. This replaces the wrongly-reused
// "Report a Bug" form the first pass shipped.
// =============================================================================

import { Button } from "#enums/buttons";
import type { InputFieldConfig } from "#ui/form-modal-ui-handler";
import { FormModalUiHandler } from "#ui/form-modal-ui-handler";
import type { ModalConfig } from "#ui/modal-ui-handler";

/** Options passed as the SECOND show() arg (after the ModalConfig with buttonActions). */
export interface ErChallengeTextInputArgs {
  /** Modal title, e.g. "Challenge Name". */
  title: string;
  /** The input-field label, defaults to the title. */
  fieldLabel?: string;
  /** Pre-fill text (the current draft value). */
  initial?: string;
}

// One generous cap covers the longest field (description = 600); the per-field
// limits (name <= 60, subtitle <= 80) are enforced at publish by validateChallengeConfig.
const FIELD_CAP = 600;

export class ErChallengeTextInputUiHandler extends FormModalUiHandler {
  private title = "Enter Text";
  private fieldLabel = "Text";

  getModalTitle(_config?: ModalConfig): string {
    return this.title;
  }

  getWidth(_config?: ModalConfig): number {
    return 160;
  }

  getMargin(_config?: ModalConfig): [number, number, number, number] {
    return [0, 0, 48, 0];
  }

  getButtonLabels(_config?: ModalConfig): string[] {
    return ["Confirm", "Cancel"];
  }

  override getInputFieldConfigs(): InputFieldConfig[] {
    return [{ label: this.fieldLabel, maxLength: FIELD_CAP }];
  }

  show(args: any[]): boolean {
    const opts = (args[1] ?? {}) as ErChallengeTextInputArgs;
    this.title = opts.title ?? "Enter Text";
    this.fieldLabel = opts.fieldLabel ?? this.title;
    if (!super.show(args)) {
      return false;
    }
    const config = args[0] as ModalConfig;
    // The field label was built once in setup() with the default; retitle it now.
    this.formLabels[0]?.setText(this.fieldLabel);
    this.inputs[0].text = opts.initial ?? "";
    this.submitAction = () => {
      this.sanitizeInputs();
      config.buttonActions[0](this.inputs[0].text);
      return true;
    };
    return true;
  }

  override processInput(button: Button): boolean {
    // B cancels (when the input field is not capturing the key); SUBMIT confirms
    // via the base. The on-screen Confirm/Cancel buttons (pointer) work regardless.
    if (button === Button.CANCEL && this.cancelAction) {
      this.cancelAction();
      return true;
    }
    return super.processInput(button);
  }
}
