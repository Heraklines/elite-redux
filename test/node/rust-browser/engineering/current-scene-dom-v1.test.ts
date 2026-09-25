// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  BrowserRequestV2,
  CurrentPresentationSceneV1Wire,
} from "../../../../src/rust-browser/contracts/browser-contracts-v2";
import { CurrentSceneDomV1 } from "../../../../src/rust-browser/routes/current-scene-dom-v1";

const scene: CurrentPresentationSceneV1Wire = {
  schema_version: 1,
  control: {
    schema_version: 2,
    revision: 7,
    kind: "BATTLE_COMMAND",
    owner_seat: 1,
    action_context: {},
    actionable: true,
    menu: {
      control_id: "battle/command",
      selected_option_id: "battle/command/fight",
      options: [
        { option_id: "battle/command/fight", visible: true, enabled: true },
        { option_id: "battle/command/item", visible: true, enabled: false },
        { option_id: "battle/command/hidden", visible: false, enabled: true },
      ],
    },
  },
  actors: [
    {
      slot: { side: "PLAYER", position: 0 },
      pokemon: 1,
      species: 1,
      form: 0,
      owner_seat: 1,
      status: "NONE",
      hp: { kind: "PLAYER_EXACT", hp: 20, max_hp: 30 },
    },
    {
      slot: { side: "ENEMY", position: 0 },
      pokemon: 2,
      species: 915,
      form: 0,
      owner_seat: null,
      status: "POISON",
      hp: { kind: "ENEMY_BAR", ten_thousandths: 6250 },
    },
  ],
};

afterEach(() => {
  document.body.replaceChildren();
});

describe("CurrentSceneDomV1", () => {
  it("renders the player-safe scene and sends only the owning seat's raw keys", async () => {
    const root = document.createElement("main");
    document.body.append(root);
    const sent: BrowserRequestV2[] = [];
    const onError = vi.fn();
    const view = new CurrentSceneDomV1(
      root,
      1,
      async request => {
        sent.push(request);
      },
      onError,
    );
    view.render(scene);
    expect(root.textContent).toContain("HP 20/30");
    expect(root.textContent).toContain("HP bar 63%");
    expect(root.textContent).toContain("battle/command/item (unavailable)");
    expect(root.textContent).not.toContain("battle/command/hidden");
    root.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    root.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", bubbles: true }));
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent).toEqual([
      {
        kind: "RAW_INPUT",
        event: {
          kind: "KEY_DOWN",
          data: { code: { kind: "SPACE" }, printable: false, browser_repeat: false, focus: "GAME" },
        },
      },
      { kind: "RAW_INPUT", event: { kind: "KEY_UP", data: { code: { kind: "SPACE" } } } },
    ]);
    view.render({ ...scene, control: { ...scene.control, owner_seat: 2 } });
    root.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", bubbles: true }));
    expect(sent).toHaveLength(2);
    expect(onError).not.toHaveBeenCalled();
    view.dispose();
    expect(root.childElementCount).toBe(0);
  });
});
