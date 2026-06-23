import { globalScene } from "#app/global-scene";
import { fixedInt } from "#utils/common";

/**
 * Logical-pixel height of a single line of a {@linkcode TextStyle.BATTLE_INFO}
 * sized description, in the text object's own (local/container) coordinate
 * space. This is the value the proven scroll pattern in
 * `#ui/move-info-overlay` and `#ui/pokedex-info-overlay` animates `y` by per
 * overflowing line. It is derived from the empirical line height those overlays
 * use to count lines (`14.83` display px) converted back to local space via the
 * same `72 / 96` factor.
 */
const LINE_HEIGHT_LOCAL = 14.83 * (72 / 96);

/** The global render scale - text is drawn at 6x the logical canvas (320x180). */
const GLOBAL_SCALE = 6;

/**
 * Handle returned by {@linkcode attachAutoScroll}. Lets the caller re-evaluate
 * the scroll after changing the text (`refresh`) and tear the scroll tween down
 * when the description is hidden (`stop`).
 */
export interface AutoScrollHandle {
  /**
   * Re-evaluate overflow and (re)start the looping scroll. Call this AFTER
   * `text.setText(...)`. Removes any prior scroll tween and resets the text to
   * its base `y` first; only re-adds a tween when the text overflows the box.
   */
  refresh: () => void;
  /**
   * Stop any running scroll tween and reset the text to its base `y`. Call this
   * when the description is hidden / focus leaves the element.
   */
  stop: () => void;
}

/**
 * Attach a geometry mask + looping auto-scroll to an already-created
 * {@linkcode Phaser.GameObjects.Text}, mirroring the proven pattern in
 * `#ui/move-info-overlay` (the scale-6 world-space mask rect + the looping
 * `descScroll` tween). Use this for over-long descriptions that must scroll
 * within a fixed box instead of being clipped.
 *
 * The text MUST already be created with a `wordWrap.width` and added to its
 * container before calling this (so `displayHeight` reflects the wrapped
 * height). The mask is fixed in WORLD space; the scroll animates the text's
 * local `y`, so the two are kept in sync via the world top-left passed in.
 *
 * @param text - The wrapped text object to mask + scroll.
 * @param worldX - World-space x (logical px) of the visible box's top-left.
 *   Negative values wrap from the right canvas edge (matching the convention in
 *   `move-info-overlay` / `pokedex-info-overlay` for right/bottom-anchored UI).
 * @param worldY - World-space y (logical px) of the visible box's top-left.
 *   Negative values wrap from the bottom canvas edge.
 * @param boxWidth - Visible box width in logical px.
 * @param boxHeight - Visible box height in logical px.
 * @returns An {@linkcode AutoScrollHandle} to `refresh` / `stop` the scroll.
 */
export function attachAutoScroll(
  text: Phaser.GameObjects.Text,
  worldX: number,
  worldY: number,
  boxWidth: number,
  boxHeight: number,
): AutoScrollHandle {
  // The mask rect is positioned in world space and drawn at the global scale,
  // exactly like move-info-overlay lines ~101-113. Negative anchors wrap from
  // the far canvas edge so right/bottom-anchored boxes mask the right region.
  let maskX = worldX;
  let maskY = worldY;
  if (maskX < 0) {
    maskX += globalScene.scaledCanvas.width;
  }
  if (maskY < 0) {
    maskY += globalScene.scaledCanvas.height;
  }

  const maskRect = globalScene.make.graphics();
  maskRect.fillStyle(0xff0000);
  maskRect.fillRect(maskX, maskY, boxWidth, boxHeight);
  maskRect.setScale(GLOBAL_SCALE);
  text.setMask(text.createGeometryMask(maskRect));

  // The base y the text rests at when not scrolled; restored before every
  // refresh so repeated `setText` calls never accumulate offset.
  const baseY = text.y;

  // How many lines fit in the visible box height (in local space). Matches the
  // per-line height the scroll tween steps by, generalising the hardcoded "3"
  // visible lines that move-info-overlay assumes for its fixed 48px box.
  const visibleLines = Math.max(1, Math.floor(boxHeight / LINE_HEIGHT_LOCAL));

  let scroll: Phaser.Tweens.Tween | null = null;

  const stop = (): void => {
    if (scroll) {
      scroll.remove();
      scroll = null;
    }
    text.y = baseY;
  };

  const refresh = (): void => {
    stop();

    // Same line-count formula as move-info-overlay / pokedex-info-overlay.
    const lineCount = Math.floor((text.displayHeight * (96 / 72)) / 14.83);
    if (lineCount > visibleLines) {
      const overflowLines = lineCount - visibleLines;
      scroll = globalScene.tweens.add({
        targets: text,
        delay: fixedInt(2000),
        loop: -1,
        hold: fixedInt(2000),
        duration: fixedInt(overflowLines * 2000),
        y: `-=${LINE_HEIGHT_LOCAL * overflowLines}`,
      });
    }
  };

  return { refresh, stop };
}
