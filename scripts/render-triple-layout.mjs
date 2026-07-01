/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Faithful LAYOUT render for triple-battle sprite + HP-bar positioning. The battlefield is
// scene-level (the UiHandler render harness can't rasterize it), so this draws the EXACT
// positions the game computes, using the game's sprite base coords (player 100,132 /
// enemy 236,86 in the ~320x180 base space) and the SAME offset math as
// src/data/battle-format.ts (fieldSpriteOffset / barSlotOffset - kept in sync below).
// Renders a DOUBLE reference next to the TRIPLE so spacing is judged vs the accepted 2-wide.
//
//   node scripts/render-triple-layout.mjs   ->   dev-logs/ui-pages/triple-layout.png

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createCanvas } from "@napi-rs/canvas";

// --- MIRROR of src/data/battle-format.ts (keep in sync) ----------------------
// FieldPosition: 0 CENTER, 1 LEFT, 2 RIGHT
const CENTER = 0;
const LEFT = 1;
const RIGHT = 2;

function fieldSpriteOffset(position, capacity) {
  if (capacity >= 3) {
    if (position === LEFT) {
      return [-58, 10];
    }
    if (position === RIGHT) {
      return [58, 10];
    }
    return [0, -8];
  }
  if (position === LEFT) {
    return [-32, -8];
  }
  if (position === RIGHT) {
    return [32, 0];
  }
  return [0, 0];
}
function barSlotOffset(slot, playerSide, capacity = 2) {
  const dx = 10 * (playerSide ? 1 : -1);
  if (capacity >= 3) {
    // Triple+: player bars stack UP (bottom-anchored), enemy DOWN (top-anchored); tighter step.
    return [dx * slot, (playerSide ? -22 : 22) * slot];
  }
  return [dx * slot, 27 * slot];
}
function posForSlot(slot, capacity) {
  if (capacity <= 1) {
    return CENTER;
  }
  if (slot <= 0) {
    return LEFT;
  }
  if (slot >= capacity - 1) {
    return RIGHT;
  }
  return CENTER;
}
// -----------------------------------------------------------------------------

const PLAYER_BASE = { x: 100, y: 132 };
const ENEMY_BASE = { x: 236, y: 86 };
const SPRITE_W = 52;
const SPRITE_H = 52;
const BAR_W = 46;
const BAR_H = 16;

function drawField(ctx, originX, scale, capacity, label) {
  const sx = x => originX + x * scale;
  const sy = y => 10 * scale + y * scale;

  ctx.globalAlpha = 1;
  ctx.fillStyle = "#26303a";
  ctx.fillRect(originX, 10 * scale, 336 * scale, 180 * scale);
  ctx.fillStyle = "#e8e8e8";
  ctx.font = `${Math.round(7 * scale)}px sans-serif`;
  ctx.textAlign = "left";
  ctx.fillText(label, originX + 6 * scale, 22 * scale);

  const drawSide = (base, player) => {
    const barAnchor = player ? { x: 150, y: 150 } : { x: 28, y: 24 };
    for (let slot = 0; slot < capacity; slot++) {
      const pos = posForSlot(slot, capacity);
      const [ox, oy] = fieldSpriteOffset(pos, capacity);
      const cx = base.x + ox;
      const cy = base.y + oy;
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = player ? "#3b6ea5" : "#a5453b";
      ctx.fillRect(sx(cx - SPRITE_W / 2), sy(cy - SPRITE_H), SPRITE_W * scale, SPRITE_H * scale);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(sx(cx - SPRITE_W / 2), sy(cy - SPRITE_H), SPRITE_W * scale, SPRITE_H * scale);
      ctx.fillStyle = "#ffffff";
      ctx.font = `${Math.round(9 * scale)}px sans-serif`;
      ctx.fillText(`${player ? "P" : "E"}${slot}`, sx(cx - 6), sy(cy - SPRITE_H / 2));

      const [bx, by] = barSlotOffset(slot, player, capacity);
      const barX = barAnchor.x + bx;
      const barY = barAnchor.y + by;
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = player ? "#2e5f3a" : "#5f2e2e";
      ctx.fillRect(sx(barX), sy(barY), BAR_W * scale, BAR_H * scale);
      ctx.strokeStyle = "#cfe8cf";
      ctx.strokeRect(sx(barX), sy(barY), BAR_W * scale, BAR_H * scale);
      ctx.fillStyle = "#d8ffd8";
      ctx.font = `${Math.round(7 * scale)}px sans-serif`;
      ctx.fillText(`${player ? "P" : "E"}${slot} HP`, sx(barX + 2), sy(barY + 11));
    }
  };

  drawSide(ENEMY_BASE, false);
  drawSide(PLAYER_BASE, true);
}

const scale = 3;
const panelW = 340 * scale;
const canvas = createCanvas(panelW * 2 + 30, 200 * scale);
const ctx = canvas.getContext("2d");
ctx.fillStyle = "#11151a";
ctx.fillRect(0, 0, panelW * 2 + 30, 200 * scale);

drawField(ctx, 10, scale, 2, "DOUBLE (reference - accepted spacing)");
drawField(ctx, panelW + 20, scale, 3, "TRIPLE (new 3-wide layout)");

const out = resolve("dev-logs/ui-pages/triple-layout.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, canvas.toBuffer("image/png"));
console.log("wrote", out);
