import type { FormModalConfig, InputFieldConfig } from "#ui/form-modal-ui-handler";
import { FormModalUiHandler } from "#ui/form-modal-ui-handler";
import type { ModalConfig } from "#ui/modal-ui-handler";
import i18next from "i18next";

/**
 * Modal that collects a free-text bug description. The actual submission
 * (console-log + state capture, POST + clipboard/download) is performed by the
 * caller via {@linkcode ModalConfig.buttonActions}`[0]`, which receives the
 * sanitized description string — mirroring {@linkcode RenameFormUiHandler}.
 */
export class BugReportFormUiHandler extends FormModalUiHandler {
  getModalTitle(_config?: ModalConfig): string {
    return i18next.t("menuUiHandler:reportBugTitle");
  }

  // Wider than the default 160 so the description label/input aren't cramped.
  getWidth(_config?: ModalConfig): number {
    return 300;
  }

  getMargin(_config?: ModalConfig): [number, number, number, number] {
    return [0, 0, 48, 0];
  }

  getButtonLabels(_config?: ModalConfig): string[] {
    return [i18next.t("menuUiHandler:reportBugSubmit"), i18next.t("menu:cancel")];
  }

  override getInputFieldConfigs(): InputFieldConfig[] {
    return [{ label: i18next.t("menuUiHandler:reportBugPrompt") }];
  }

  show(args: any[]): boolean {
    if (super.show(args)) {
      const config = args[0] as ModalConfig;
      // Allow a longer description than the default 20-char text field.
      this.inputs[0]?.setMaxLength(500);
      this.submitAction = () => {
        this.sanitizeInputs();
        const description = this.inputs[0].text;
        if (!description) {
          this.updateContainer({
            ...config,
            errorMessage: i18next.t("menuUiHandler:reportBugEmpty"),
          } as FormModalConfig);
          return;
        }
        config.buttonActions[0](description);
      };
      return true;
    }
    return false;
  }
}
