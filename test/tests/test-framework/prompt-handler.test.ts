import type { Phase } from "#app/phase";
import { UiMode } from "#enums/ui-mode";
import type { GameManager } from "#test/framework/game-manager";
import type { PhaseInterceptor } from "#test/framework/phase-interceptor";
import type { UIPromptOptions } from "#test/helpers/prompt-handler";
import { PromptHandler } from "#test/helpers/prompt-handler";
import type { PhaseManager, PhaseString } from "#types/phase-types";
import type { AwaitableUiHandler } from "#ui/handlers/awaitable-ui-handler";
import type { UI } from "#ui/ui";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

describe("Test Utils - PromptHandler", () => {
  let promptHandler: PromptHandler;
  let handler: AwaitableUiHandler;

  let callback1: Mock;
  let callback2: Mock;
  let setModeCallback: Mock;
  let checkModeCallback: Mock;

  beforeEach(() => {
    setModeCallback = vi.fn(() => console.log("set mode called!")).mockName("set mode callback");
    checkModeCallback = vi.fn(() => console.log("check mode called!")).mockName("check mode callback");
    callback1 = vi.fn(() => console.log("callback 1 called!")).mockName("callback 1");
    callback2 = vi.fn(() => console.log("callback 2 called!")).mockName("callback 2");

    handler = {
      active: true,
      show: () => true,
      awaitingActionInput: true,
    } as unknown as AwaitableUiHandler;

    promptHandler = new PromptHandler({
      scene: {
        ui: {
          getHandler: () => handler,
          setModeInternal: () => {
            setModeCallback();
            return Promise.resolve();
          },
          getMode: () => UiMode.TEST_DIALOGUE,
        } as unknown as UI,
        phaseManager: {
          getCurrentPhase: () =>
            ({
              phaseName: "testDialoguePhase" as unknown as PhaseString,
            }) as Phase,
        } as PhaseManager,
      },
      phaseInterceptor: {
        checkMode: () => {
          checkModeCallback();
        },
      } as PhaseInterceptor,
    } as GameManager);
  });

  // Wrapper func to ignore incorrect typing on `PhaseString`
  function onNextPrompt(
    target: string,
    mode: UiMode,
    callback: () => void | boolean,
    expireFn?: () => boolean,
    awaitingActionInput = false,
    options: UIPromptOptions = {},
  ) {
    promptHandler.addToNextPrompt(
      target as unknown as PhaseString,
      mode,
      callback,
      expireFn,
      awaitingActionInput,
      options,
    );
  }

  describe("setMode", () => {
    it("should wrap and pass along original function arguments from setModeInternal", async () => {
      const setModeSpy = vi.spyOn(promptHandler as any, "setMode");
      await promptHandler["game"].scene.ui["setModeInternal"](UiMode.PARTY, false, false, false, []);

      expect(setModeSpy).toHaveBeenCalledExactlyOnceWith([UiMode.PARTY, false, false, false, []]);
      expect(setModeCallback).toHaveBeenCalledAfter(setModeSpy);
    });

    it("should call PhaseInterceptor.checkMode if current phase is in `endBySetMode`", async () => {
      promptHandler["game"]["scene"]["phaseManager"]["getCurrentPhase"] = () =>
        ({ phaseName: "CommandPhase" }) as Phase;
      await promptHandler["game"].scene.ui["setModeInternal"](UiMode.PARTY, false, false, false, []);

      expect(checkModeCallback).toHaveBeenCalledOnce();
    });
  });

  describe("doPromptCheck", () => {
    it("should check and remove the first prompt matching criteria", () => {
      onNextPrompt("testDialoguePhase", UiMode.TEST_DIALOGUE, callback1);
      onNextPrompt("testDialoguePhase", UiMode.TEST_DIALOGUE, callback2);
      promptHandler["doPromptCheck"]();

      expect(callback1).toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
      expect(promptHandler["prompts"]).toHaveLength(1);
    });

    it("should retry a matching prompt when the public UI rejects its input", () => {
      const retryingCallback = vi.fn().mockReturnValueOnce(false).mockReturnValueOnce(true);
      onNextPrompt("testDialoguePhase", UiMode.TEST_DIALOGUE, retryingCallback);

      promptHandler["doPromptCheck"]();
      expect(retryingCallback).toHaveBeenCalledOnce();
      expect(promptHandler["prompts"]).toHaveLength(1);

      promptHandler["doPromptCheck"]();
      expect(retryingCallback).toHaveBeenCalledTimes(2);
      expect(promptHandler["prompts"]).toHaveLength(0);
    });

    it.each<{ reason: string; callback: () => void }>([
      {
        reason: "wrong UI mode",
        callback: () => onNextPrompt("testDialoguePhase", UiMode.ACHIEVEMENTS, callback1),
      },
      {
        reason: "wrong phase",
        callback: () => onNextPrompt("wrong phase", UiMode.TEST_DIALOGUE, callback1),
      },
      {
        reason: "UI handler is inactive",
        callback: () => {
          handler.active = false;
          onNextPrompt("testDialoguePhase", UiMode.TEST_DIALOGUE, callback1);
        },
      },
      {
        reason: "UI handler is not awaiting input",
        callback: () => {
          handler["awaitingActionInput"] = false;
          onNextPrompt("testDialoguePhase", UiMode.TEST_DIALOGUE, callback1, undefined, true);
        },
      },
    ])("should skip callback and keep in queue if $reason", ({ callback }) => {
      callback();
      onNextPrompt("testDialoguePhase", UiMode.TEST_DIALOGUE, callback2);
      promptHandler["doPromptCheck"]();

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
      expect(promptHandler["prompts"]).toHaveLength(2);
    });

    it("should remove expired prompts without blocking", () => {
      onNextPrompt("testDialoguePhase", UiMode.TEST_DIALOGUE, callback1, () => true);
      onNextPrompt("testDialoguePhase", UiMode.TEST_DIALOGUE, callback2, () => false);
      promptHandler["doPromptCheck"]();

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
      expect(promptHandler["prompts"]).toHaveLength(1);

      promptHandler["doPromptCheck"]();
      expect(callback2).toHaveBeenCalledOnce();
      expect(promptHandler["prompts"]).toHaveLength(0);
    });

    it("should route only an explicitly keyed prompt past an unrelated FIFO entry", () => {
      onNextPrompt("wrong phase", UiMode.ACHIEVEMENTS, callback1);
      onNextPrompt("testDialoguePhase", UiMode.TEST_DIALOGUE, callback2, undefined, false, {
        allowOutOfOrder: true,
        matchFn: () => true,
      });

      promptHandler["doPromptCheck"]();

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).toHaveBeenCalledOnce();
      expect(promptHandler["prompts"]).toHaveLength(1);
    });

    it("should not route a keyed prompt whose instance predicate does not match", () => {
      onNextPrompt("wrong phase", UiMode.ACHIEVEMENTS, callback1);
      onNextPrompt("testDialoguePhase", UiMode.TEST_DIALOGUE, callback2, undefined, false, {
        allowOutOfOrder: true,
        matchFn: () => false,
      });

      promptHandler["doPromptCheck"]();

      expect(callback1).not.toHaveBeenCalled();
      expect(callback2).not.toHaveBeenCalled();
      expect(promptHandler["prompts"]).toHaveLength(2);
    });

    it("should keep an out-of-order prompt in place when the public UI rejects its input", () => {
      const retryingCallback = vi.fn().mockReturnValue(false);
      onNextPrompt("wrong phase", UiMode.ACHIEVEMENTS, callback1);
      onNextPrompt("testDialoguePhase", UiMode.TEST_DIALOGUE, retryingCallback, undefined, false, {
        allowOutOfOrder: true,
        matchFn: () => true,
      });

      promptHandler["doPromptCheck"]();

      expect(callback1).not.toHaveBeenCalled();
      expect(retryingCallback).toHaveBeenCalledOnce();
      expect(promptHandler["prompts"]).toHaveLength(2);
    });

    it("should report only prompts matching the exact current surface", () => {
      onNextPrompt("wrong phase", UiMode.ACHIEVEMENTS, callback1);
      expect(promptHandler.hasMatchingPrompt()).toBe(false);

      onNextPrompt("testDialoguePhase", UiMode.TEST_DIALOGUE, callback2, undefined, false, {
        matchFn: () => true,
      });
      expect(promptHandler.hasMatchingPrompt()).toBe(true);
    });
  });
});
