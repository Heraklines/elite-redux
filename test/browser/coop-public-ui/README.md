# Co-op two-browser public-UI journeys

This opt-in harness drives two deployed game clients through the same surfaces a player uses. Each seat has
its own Chromium `BrowserContext`, cookie jar, local storage, login form, canvas, and keyboard. The driver
does not import game source, call scene or phase methods, inject relay messages, mirror waves, or apply
resyncs. `check-public-boundary.mjs` protects that boundary.

The harness is deliberately separate from the engine and WebRTC gates. It is prework for the audit's first
human-equivalent checkpoint and can be run against a built staging deployment without loading Phaser or
Vitest on a developer workstation. Before opening either browser it verifies that every live Cloudflare
asset route points to one immutable `er-assets` SHA and that staging serves the inert cache-buster manifest.
It hashes that deployed HTML, manifest, and redirect surface again after the journey and fails if a deploy or
asset-pin change occurred while the two clients were running.

## Journeys

| Journey | Public actions and required result | Account precondition |
| --- | --- | --- |
| `probe` | Open both clients, log in through the visible form, reach Title | Two tutorial-complete staging accounts |
| `fresh-wave2` | Lobby invite/accept, New Run, starter selection, wave 1 commands, reward leave, wave 2 command UI | Accounts have no title-menu Continue entry unless title keys are configured |
| `fresh-resume` | `fresh-wave2`, close both pages, reopen/login, pair in the same direction, accept Resume, reach command UI | Same as `fresh-wave2` |
| `reverse-resume` | Same, but reverse which player sends the lobby request after reopening | Same as `fresh-wave2`; this is the invitation-direction regression |
| `faint-replacement` | Pair, Resume, submit battle commands, select a legal replacement through the public picker, observe summon/continued battle | A shared save at a deterministic low-HP boundary |

`fresh-*` marks the subsequent title layout as `Continue, New Game` only after both clients have publicly
reached the wave-2 command surface. If that save was not actually persisted, the next keyboard action takes
the wrong visible route and the resume journey fails.

## Run on an isolated machine

Use the opt-in **Co-op Public UI Journey** GitHub workflow for normal execution. Its four credentials are
repository secrets and it uploads evidence even when the journey fails. Do not use real player accounts;
journeys intentionally create or advance staging saves. The workflow targets
`https://elite-redux-staging.pages.dev` unless a maintainer sets the protected `COOP_UI_STAGING_URL`
repository variable; a workflow dispatcher cannot redirect credential entry to another origin.

For an isolated runner with Chrome already installed:

```text
COOP_UI_BASE_URL=https://elite-redux-staging.pages.dev
COOP_UI_HOST_USERNAME=<staging account A>
COOP_UI_HOST_PASSWORD=<secret>
COOP_UI_GUEST_USERNAME=<staging account B>
COOP_UI_GUEST_PASSWORD=<secret>
COOP_UI_JOURNEY=fresh-resume
node test/browser/coop-public-ui/run.mjs
```

Relevant options:

- `COOP_UI_REQUESTER_SEAT=guest-seat|host-seat` controls who sends the initial invitation.
- `COOP_UI_FAINT_OWNER_SEAT=guest-seat|host-seat` identifies the prepared replacement owner.
- `COOP_UI_HOST_TITLE_NEW_GAME_KEYS` and `COOP_UI_GUEST_TITLE_NEW_GAME_KEYS` are JSON key arrays. Use
  `["ArrowDown"]` when a prepared account already shows Continue above New Game.
- `COOP_UI_STARTER_KEYS`, `COOP_UI_BATTLE_KEYS`, `COOP_UI_REWARD_LEAVE_KEYS`, and
  `COOP_UI_REPLACEMENT_KEYS` override the default public keyboard sequences.
- `COOP_UI_ACTION_DELAY_MS` and `COOP_UI_SETTLE_DELAY_MS` permit timing variation without bypassing UI.
- `COOP_UI_CHROME_TRACE=0` disables the optional Chrome performance trace; JSONL event traces and
  screenshots remain mandatory.

The default keyboard model is QWERTY: arrows navigate, Space is Action, Enter is Submit, and Backspace is
Cancel. Test accounts must have already completed gender/tutorial setup. Fresh journeys should use clean
accounts, or explicitly provide the title-menu selection keys above.

## Evidence and pass conditions

Every run writes `dev-logs/coop-public-ui/<timestamp>-<journey>/` with:

- per-seat `public-ui-trace.jsonl` event timelines;
- per-checkpoint PNG screenshots;
- sanitized DOM inventories and cookie metadata (never cookie values or passwords);
- one or more Chrome performance traces when enabled; and
- `summary.json` with duration, journey, requester direction, replacement count, the pre/post deployed-surface
  hashes and immutable asset SHA, and any journey or surface-verification failure stack.

The run fails on timeouts, page exceptions, unexpected console errors, non-aborted request failures,
incorrect lobby roles, missing command/reward/replacement surfaces, a mixed/mutable asset redirect surface,
a non-inert cache-buster manifest, a staging deployment change during the run, or any stale reconnect
observation. A screenshot alone is never treated as proof of progression.

Before changing the driver, run the cheap boundary check:

```text
node test/browser/coop-public-ui/check-public-boundary.mjs
```

This harness remains opt-in until the blocked observability items in
[`blocked-instrumentation.md`](./blocked-instrumentation.md) are resolved and the journeys are green on
prepared staging accounts. It does not replace the calibrated co-op gate or milestone soak matrix.
