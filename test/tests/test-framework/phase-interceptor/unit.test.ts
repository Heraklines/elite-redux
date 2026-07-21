import { globalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import { GameManager } from "#test/framework/game-manager";
import { MockPhase } from "#test/mocks/mock-phase";
import type { Constructor } from "#types/common";
import type { PhaseString } from "#types/phase-types";
import Phaser from "phaser";
import type { NonEmptyTuple } from "type-fest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// TODO: Move these to `mock-phase.ts` if/when unit tests for the phase manager are created
class ApplePhase extends MockPhase {
  public readonly phaseName = "ApplePhase";
}

class BananaPhase extends MockPhase {
  public readonly phaseName = "BananaPhase";
}

class CoconutPhase extends MockPhase {
  public readonly phaseName = "CoconutPhase";
}

class OneSecTimerPhase extends MockPhase {
  public readonly phaseName = "OneSecTimerPhase";
  override start() {
    setTimeout(() => {
      console.log("1 sec passed!");
      this.end();
    }, 1000);
  }
}

class UnshifterPhase extends MockPhase {
  public readonly phaseName = "UnshifterPhase";
  override start() {
    globalScene.phaseManager.unshiftPhase(new ApplePhase() as unknown as Phase);
    globalScene.phaseManager.unshiftPhase(new BananaPhase() as unknown as Phase);
    globalScene.phaseManager.unshiftPhase(new CoconutPhase() as unknown as Phase);
    this.end();
  }
}

describe("Utils - Phase Interceptor - Unit", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    setPhases(ApplePhase, BananaPhase, CoconutPhase, ApplePhase, CoconutPhase);
  });

  /**
   * Helper function to set the phase manager's phases array to the specified values and start the first one.
   * @param phases - One or more constructors of {@linkcode MockPhase}s to set
   * Constructors must have no arguments.
   */
  function setPhases(...phases: NonEmptyTuple<Constructor<MockPhase>>): void {
    game.scene.phaseManager.clearAllPhases();
    for (const phase of phases) {
      game.scene.phaseManager.unshiftPhase(new phase());
    }
    // start the thing going
    game.scene.phaseManager.shiftPhase();
  }

  function getQueuedPhases(): string[] {
    return game.scene.phaseManager["phaseQueue"]["levels"].flat(2).map(p => p.phaseName);
  }

  function expectAtPhase(phaseName: string) {
    expect(game).toBeAtPhase(phaseName as PhaseString);
  }

  /** Wrapper function to make TS not complain about incompatible argument typing on `PhaseString`. */
  function to(phaseName: string, runTarget?: false): Promise<void> {
    return game.phaseInterceptor.to(phaseName as unknown as PhaseString, runTarget);
  }

  describe("to", () => {
    it("should start the specified phase and resolve after it ends", async () => {
      await to("ApplePhase");

      expectAtPhase("BananaPhase");
      expect(getQueuedPhases()).toEqual(["CoconutPhase", "ApplePhase", "CoconutPhase"]);
      expect(game.phaseInterceptor.log).toEqual(["ApplePhase"]);
    });

    it("should run to the specified phase without starting/logging", async () => {
      await to("ApplePhase", false);

      expectAtPhase("ApplePhase");
      expect(getQueuedPhases()).toEqual(["BananaPhase", "CoconutPhase", "ApplePhase", "CoconutPhase"]);
      expect(game.phaseInterceptor.log).toEqual([]);

      await to("ApplePhase", false);

      // should not do anything
      expectAtPhase("ApplePhase");
      expect(getQueuedPhases()).toEqual(["BananaPhase", "CoconutPhase", "ApplePhase", "CoconutPhase"]);
      expect(game.phaseInterceptor.log).toEqual([]);
    });

    it("returns control when a predecessor synchronously opens the interactive target", async () => {
      vi.spyOn(ApplePhase.prototype, "start").mockImplementation(() => {
        globalScene.phaseManager.shiftPhase();
        game.phaseInterceptor.checkMode();
      });

      await to("BananaPhase", false);

      expectAtPhase("BananaPhase");
      expect(game.phaseInterceptor.log).toEqual(["ApplePhase"]);
    });

    it("observes its requested target even when the shared prompt target is replaced", async () => {
      vi.spyOn(ApplePhase.prototype, "start").mockImplementation(() => {
        globalScene.phaseManager.shiftPhase();
        game.phaseInterceptor.checkMode();
        // Model a nested/asynchronous request replacing PromptHandler's routing slot while the original
        // stop-before call is still unwinding from its predecessor.
        game.phaseInterceptor["target"] = "CoconutPhase" as PhaseString;
      });

      await to("BananaPhase", false);

      expectAtPhase("BananaPhase");
      expect(game.phaseInterceptor.log).toEqual(["ApplePhase"]);
    });

    it("should run all phases between start and the first instance of target", async () => {
      await to("CoconutPhase");

      expectAtPhase("ApplePhase");
      expect(getQueuedPhases()).toEqual(["CoconutPhase"]);
      expect(game.phaseInterceptor.log).toEqual(["ApplePhase", "BananaPhase", "CoconutPhase"]);
    });

    it("should work on newly unshifted phases", async () => {
      setPhases(UnshifterPhase, CoconutPhase); // adds ApplePhase, BananaPhase and CoconutPhase to queue
      await to("BananaPhase");

      expectAtPhase("CoconutPhase");
      expect(getQueuedPhases()).toEqual(["CoconutPhase"]);
      expect(game.phaseInterceptor.log).toEqual(["UnshifterPhase", "ApplePhase", "BananaPhase"]);
    });

    it("should wait for asynchronous phases to end", async () => {
      setPhases(OneSecTimerPhase, CoconutPhase);
      const callback = vi.fn(() => console.log("fffffff"));
      const spy = vi.spyOn(OneSecTimerPhase.prototype, "end");
      setTimeout(() => {
        callback();
      }, 500);
      await to("CoconutPhase");
      expect(callback).toHaveBeenCalled();
      expect(spy).toHaveBeenCalled();
    });
  });

  describe("toFirst", () => {
    it("stops before the first matching branch target without starting it", async () => {
      const reached = await game.phaseInterceptor.toFirst([
        "BananaPhase" as PhaseString,
        "CoconutPhase" as PhaseString,
      ]);

      expect(reached).toBe("BananaPhase");
      expectAtPhase("BananaPhase");
      expect(getQueuedPhases()).toEqual(["CoconutPhase", "ApplePhase", "CoconutPhase"]);
      expect(game.phaseInterceptor.log).toEqual(["ApplePhase"]);
    });

    it("returns an interactive branch target opened synchronously by its predecessor", async () => {
      vi.spyOn(ApplePhase.prototype, "start").mockImplementation(() => {
        globalScene.phaseManager.shiftPhase();
        game.phaseInterceptor.checkMode();
      });

      const reached = await game.phaseInterceptor.toFirst([
        "BananaPhase" as PhaseString,
        "CoconutPhase" as PhaseString,
      ]);

      expect(reached).toBe("BananaPhase");
      expectAtPhase("BananaPhase");
      expect(game.phaseInterceptor.log).toEqual(["ApplePhase"]);
    });

    it("rejects an empty branch target set", async () => {
      await expect(game.phaseInterceptor.toFirst([])).rejects.toThrow("requires at least one target phase");
    });
  });

  describe("shift", () => {
    it("should skip the next phase in line without starting it", async () => {
      const startSpy = vi.spyOn(ApplePhase.prototype, "start");

      game.phaseInterceptor.shiftPhase();

      expectAtPhase("BananaPhase");
      expect(getQueuedPhases()).toEqual(["CoconutPhase", "ApplePhase", "CoconutPhase"]);
      expect(startSpy).not.toHaveBeenCalled();
      expect(game.phaseInterceptor.log).toEqual([]);
    });
  });
});
