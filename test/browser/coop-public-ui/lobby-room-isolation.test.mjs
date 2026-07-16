import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("real-browser lanes assign one public lobby room per isolated pair", () => {
  const campaign = source("../../../.github/workflows/coop-public-ui-campaign.yml");
  const journey = source("../../../.github/workflows/coop-public-ui-journey.yml");
  for (const workflow of [campaign, journey]) {
    assert.match(workflow, /VITE_COOP_LOBBY_ROOM_QUERY:\s*1/u);
    assert.match(workflow, /COOP_UI_LOBBY_ROOM:/u);
  }
  assert.match(campaign, /campaign-\$\{\{ github\.run_id \}\}-\$\{\{ matrix\.artifact \}\}/u);
  assert.match(journey, /primary-\$\{\{ github\.run_id \}\}-\$\{\{ matrix\.commander_owner_seat \}\}/u);
  assert.match(journey, /reverse-\$\{\{ github\.run_id \}\}/u);
});

test("the browser room reaches CoopLobbyController without changing production defaults", () => {
  const lobby = source("../../../src/data/elite-redux/coop/coop-lobby.ts");
  const title = source("../../../src/phases/title-phase.ts");
  const harness = source("./public-ui-harness.mjs");
  assert.match(lobby, /VITE_COOP_LOBBY_ROOM_QUERY === "1"/u);
  assert.match(lobby, /get\("cooproom"\)/u);
  assert.match(lobby, /options\.p33Dependencies \?\? \{ room: coopLobbyRoomFromEnv\(\) \}/u);
  assert.match(title, /new CoopLobbyController\(username, \{/u);
  assert.match(harness, /entryUrl\.searchParams\.set\("cooproom", this\.config\.lobbyRoom\)/u);
});
