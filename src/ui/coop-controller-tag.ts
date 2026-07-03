/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { getCoopController } from "#data/elite-redux/coop/coop-runtime";
import { setCoopUiMirrorSessionHook } from "#data/elite-redux/coop/coop-ui-mirror";
import { TextStyle } from "#enums/text-style";
import { addTextObject } from "#ui/text";

/**
 * Co-op CONTROLLER NAME TAG (#789): on every ALTERNATING screen (reward shop, mystery event,
 * move-forget picker - anything the ui mirror sessions), a small badge shows WHOSE turn it is
 * to drive the screen, green when it is you and amber when a partner controls it. Hooked into
 * the mirror session lifecycle, so any newly mirrored screen gets the tag for free.
 *
 * N-WAY READY (3/6-player plans): the name comes from the session controller (local name vs
 * partner name today); when N-player seats land, resolving the OWNER SEAT'S name in
 * `controllerNameFor` is the only change - the tag itself is seat-count agnostic.
 */

const TAG_DEPTH = 5000;
const LOCAL_COLOR = "#78c850";
const REMOTE_COLOR = "#f0b848";

let container: Phaser.GameObjects.Container | null = null;

function controllerNameFor(localOwns: boolean): { name: string; isLocal: boolean } {
  const controller = getCoopController();
  if (localOwns) {
    return { name: controller?.localName() ?? "You", isLocal: true };
  }
  return { name: controller?.partnerName ?? "Partner", isLocal: false };
}

function showTag(localOwns: boolean): void {
  hideTag();
  try {
    const { name, isLocal } = controllerNameFor(localOwns);
    const label = isLocal ? `${name} (you) is choosing` : `${name} is choosing`;
    // Top-center, above every window the mirrored screens draw; logical 320x180.
    container = globalScene.add.container(160, -178);
    const text = addTextObject(0, 0, label, TextStyle.TOOLTIP_CONTENT, { fontSize: "48px" });
    text.setOrigin(0.5, 0);
    text.setColor(isLocal ? LOCAL_COLOR : REMOTE_COLOR);
    const pad = 3;
    const bg = globalScene.add
      .rectangle(0, -1, text.displayWidth + pad * 2, text.displayHeight + 2, 0x000000, 0.6)
      .setOrigin(0.5, 0);
    container.add(bg);
    container.add(text);
    container.setDepth(TAG_DEPTH);
    globalScene.ui.add(container);
  } catch {
    container = null; // cosmetic - never break the screen over the tag
  }
}

function hideTag(): void {
  try {
    container?.destroy();
  } catch {
    /* already gone */
  }
  container = null;
}

// Register with the engine-free mirror at module load (ui.ts imports this file at boot).
setCoopUiMirrorSessionHook((active, role) => {
  if (active) {
    showTag(role === "owner");
  } else {
    hideTag();
  }
});

/**
 * #817: explicit tag control for the co-op ME paths (they never open a ui-mirror
 * session, so the hook above cannot drive them). Same look as the shop tag.
 */
export function showCoopControllerTagFor(localOwns: boolean): void {
  showTag(localOwns);
}

/** #817: hide the tag when the ME choice resolves / hands off to a battle. */
export function hideCoopControllerTag(): void {
  hideTag();
}

/** Test/diagnostic surface: whether the tag is currently shown. */
export function coopControllerTagVisible(): boolean {
  return container != null;
}
