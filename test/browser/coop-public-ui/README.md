# Co-op two-browser public-UI journeys

This opt-in harness drives two clients built from the exact implementation SHA through the same surfaces a
player uses. Each seat has its own Chromium `BrowserContext`, cookie jar, local storage, login form, canvas,
and keyboard. The driver does not import game source, call scene or phase methods, inject relay messages,
mirror waves, or apply resyncs. `check-public-boundary.mjs` protects that boundary.

The workflow builds the normal application once, adds only the CI entry's read-only surface observer, seals
the bundle manifest, and fans runners from that same artifact. It resolves the current `er-assets` HEAD just
as staging deployment does, then seals the rewritten Cloudflare redirects and inert cache-buster manifest
into the artifact. Its localhost preview therefore loads images, audio, battle animations, and fonts from
one immutable production asset revision instead of a partial development-asset checkout. The observer emits only after a real UI
handler is rendered and active. It reports role, membership generation, epoch/wave/turn, phase/mode, and the
mechanical digest; it exposes no mutation method. A journey passes a boundary only when both clients report
the same address, digest, and continuation surface. Every battle turn also correlates the guest's exact
`continuationReady` ACK with the host's retained-address release.

## Journeys

| Journey | Public actions and required result | Account precondition |
| --- | --- | --- |
| `probe` | Open both clients, log in through the visible form, complete first-login gender selection, reach Title | Workflow provisions isolated staging accounts; manual runs supply accounts |
| `fresh-wave2` | Lobby invite/accept, New Run, host-only challenge and difficulty selection, starter selection, wave 1 commands, reward leave, wave 2 command UI | Isolated accounts have no title-menu Continue entry unless title keys are configured |
| `fresh-resume` | `fresh-wave2`, close both pages, reopen/login, pair in the same direction, accept Resume, reach command UI | Same as `fresh-wave2` |
| `reverse-resume` | Same, but reverse which player sends the lobby request after reopening | Same as `fresh-wave2`; this is the invitation-direction regression |
| `faint-replacement` | Pair, Resume, submit battle commands, select a legal replacement through the public picker, observe summon/continued battle | A shared save at a deterministic low-HP boundary |
| `commander-skip` | Pair, New Run, publicly confirm visible Dondozo/Tatsugiri teams, drive only Dondozo's command UI, prove the hidden Commander skip traverses reciprocal `cmd:<wave>:<turn>`, retain rewards, and reach the next shared Commander command boundary | Dedicated CI bundle only; runs both Commander ownership parities on isolated fresh accounts |

`commander-skip` has one explicit setup-fidelity boundary. Fresh isolated accounts cannot reliably select
account-locked Dondozo/Tatsugiri, so only the dedicated public-browser build
(`VITE_COOP_BROWSER_FIXTURE=commander-skip`) accepts the exact per-client `coopfixture=commander|dondozo`
URL checkpoint. That checkpoint pre-populates the normal visible starter-team strip; each browser still
submits and confirms it with real keys. Lobby pairing, challenge/difficulty choice, battle commands,
rewards, WebRTC, rendering, and wave continuation all remain production paths. The fixture never writes
dex/save unlocks, is inert in ordinary local/staging/production bundles, and performs no post-launch
mutation. This journey proves co-op authority from the configured-party boundary onward; it does not claim
to test natural collection/unlock acquisition.

The CI public-UI matrix disables only Puppeteer's optional screenshot-enabled CDP performance timeline by
default. A measured trace artifact reached 537 MB and starved two real 10x clients even though both kept
advancing at the same co-op address over a healthy RTC connection. Per-checkpoint PNGs, per-seat
semantic/causal/network JSONL, console output, per-key latency, public keyboard input, both real renderers,
staging WebRTC, and every address/digest/continuation assertion remain enabled. The explicit fidelity delta
is therefore loss of Chrome's low-level performance timeline, not loss of gameplay, input, rendering,
network, or causal evidence. A manually dispatched diagnostic run can set `chrome_trace=true` to capture
that timeline when its resource cost is specifically needed; it is not part of a normal two-player verdict.

`fresh-*` marks the subsequent title layout as `Continue, New Game` only after both clients have publicly
reached the wave-2 command surface. If that save was not actually persisted, the next keyboard action takes
the wrong visible route and the resume journey fails.

## Run on an isolated machine

Use the opt-in **Co-op Public UI Journey** GitHub workflow for execution. Its primary runner generates a
unique masked credential pair, then creates both staging accounts through the visible registration form and
performs every game/lobby action through the visible application. It uploads evidence even when the journey fails. Do not use real
player accounts; journeys intentionally create or advance isolated staging-API saves. `COOP_UI_API_URL` (or
the repository's normal `STAGING_SERVER_URL` fallback) and
`COOP_UI_SIGNAL_URL` are maintainer-owned repository variables; workflow inputs cannot redirect fixture
creation or credential entry. The optional
reverse-resume fan-out uses a separately provisioned `COOP_UI_ALT_*` account pair so concurrent runners
never race one save or lobby identity.

For an isolated runner with Chrome and an already sealed exact-SHA bundle:

```text
COOP_UI_BASE_URL=http://127.0.0.1:4175/?coopdebug=1
COOP_UI_BROWSER_DIST=dist-coop-public-ui
COOP_UI_ASSET_DIR=assets
COOP_UI_EXPECTED_API_ORIGIN=https://er-save-api-staging.heraklines.workers.dev
COOP_UI_EXPECTED_SIGNAL_ORIGIN=https://er-coop-api.heraklines.workers.dev
COOP_UI_HOST_USERNAME=<staging account A>
COOP_UI_HOST_PASSWORD=<secret>
COOP_UI_GUEST_USERNAME=<staging account B>
COOP_UI_GUEST_PASSWORD=<secret>
COOP_UI_JOURNEY=fresh-resume
node test/browser/coop-public-ui/run.mjs
```

Relevant options:

- `COOP_UI_REQUESTER_SEAT=guest-seat|host-seat` controls who sends the initial invitation.
- `COOP_UI_ACCOUNT_MODE=login|register` chooses visible login or first-time registration; CI uses `register`.
- `COOP_UI_FAINT_OWNER_SEAT=guest-seat|host-seat` identifies the prepared replacement owner.
- `COOP_UI_COMMANDER_OWNER_SEAT=guest-seat|host-seat` chooses the fixture's Tatsugiri owner; CI fans both.
- `COOP_UI_HOST_TITLE_NEW_GAME_KEYS` and `COOP_UI_GUEST_TITLE_NEW_GAME_KEYS` are JSON key arrays. Use
  `["ArrowDown"]` when a prepared account already shows Continue above New Game.
- `COOP_UI_CHALLENGE_KEYS`, `COOP_UI_STARTER_KEYS`, `COOP_UI_DIFFICULTY_KEYS`, `COOP_UI_BATTLE_KEYS`,
  `COOP_UI_REWARD_LEAVE_KEYS`, and `COOP_UI_REPLACEMENT_KEYS` override the default public keyboard sequences.
- `COOP_UI_ACTION_DELAY_MS` and `COOP_UI_SETTLE_DELAY_MS` permit timing variation without bypassing UI.
- `COOP_UI_BOOT_TIMEOUT_MS` budgets the first immutable full-asset load only (default five minutes);
  gameplay and synchronization waits keep the shorter `COOP_UI_TIMEOUT_MS` budget.
- `COOP_UI_CHROME_TRACE=0` disables the optional Chrome performance trace; JSONL event traces and
  screenshots remain mandatory.

The default keyboard model is QWERTY: arrows navigate, Space is Action, Enter is Submit, and Backspace is
Cancel. The runner completes a new account's visible gender prompt; tutorials remain disabled by the
normal beta build flag. Manual fresh journeys should use clean accounts, or explicitly provide the
title-menu selection keys above.

## Evidence and pass conditions

Every run writes `dev-logs/coop-public-ui/<timestamp>-<journey>/` with:

- per-seat `public-ui-trace.jsonl` event timelines;
- per-checkpoint PNG screenshots;
- sanitized DOM inventories and cookie metadata (never cookie values or passwords);
- one or more Chrome performance traces when enabled; and
- `summary.json` with the sealed SHA/digest, duration, journey, requester direction, replacement count, and
  account/save and signaling origins, failure stack.

The run fails on timeouts, page exceptions, unexpected console errors, non-aborted request failures,
incorrect lobby roles, missing command/reward/replacement surfaces, divergent epoch/wave/turn or mechanical
digest, a UI handler that is not active on both clients, a guest ACK that releases the wrong retained host
address, an artifact/SHA/API-origin/signaling-origin mismatch, or any stale reconnect observation. A screenshot alone
is never treated as proof of progression.

Before changing the driver, run the cheap boundary check:

```text
node test/browser/coop-public-ui/check-public-boundary.mjs
```

This harness remains opt-in until the blocked observability and account-fixture items in
[`blocked-instrumentation.md`](./blocked-instrumentation.md) are resolved and the journeys are green on
prepared dedicated accounts. It does not replace the calibrated co-op gate or milestone soak matrix.

## Campaign + semantic surface mirror

`campaign.mjs` / `run-campaign.mjs` drive a longer co-op run using the read-only **v2 semantic surface
mirror** the sealed observer emits
(`[coop-browser:surface2]`, parsed by `evidence.mjs` as `browser-surface2`). The mirror reports, per
active interactive surface: a stable `surfaceId`, `operationClass`, authoritative `address`
`{epoch,wave,turn}`, `ownerSeat`/`ownerModel`, this client's `seatsWithInput`, `optionIds` +
`selectedOptionId` where the handler exposes them, and readiness bits. `COOP_UI_CAMPAIGN_MODE` gates the
loud-fail contract: only `shakedown` may press through an UNKNOWN surface (`COOP_UI_AUTO_FIRST`);
`gating` and `nightly` runs fail loudly and immediately on any surface with no registered driver.
`check-campaign-boundary.mjs` re-applies the private-state prohibitions to the campaign files.

The opt-in market profile adds `COOP_UI_MARKET_MODE=target-held`. It reads the CI-only, read-only market
projection, navigates the real 4x4 canvas grid to `COOP_UI_MARKET_TARGET_ID` (default `WIDE_LENS`), opens
the real party picker, chooses `COOP_UI_MARKET_PARTY_SLOT`, confirms APPLY, proves the paid money change,
held-item quantity, and one stock-ledger decrement on both clients, then verifies the market stayed open.
It buys the same already-proven compatible held item again when stock/money permit, then leaves through
the normal confirmation and requires both clients to converge on the next public command surface. The
`market-wide-lens` workflow uses one continuous fresh wave-1 -> wave-20 run with
`COOP_UI_MARKET_REQUIRED_PURCHASES=2` and `COOP_UI_MARKET_REQUIRE_BOTH_OWNER_SEATS=1`: the wave-10 market
is guest-owned and the wave-20 market is host-owned under the natural interaction schedule. The market
stock is seed-dependent, so a run without affordable Wide Lens stock at both parities fails loudly and
remains evidence for checkpoint calibration; the driver never substitutes another item or mutates stock
while claiming Wide Lens coverage.

Dropping or reordering a WebRTC market terminal is intentionally not injected by this public driver. Doing
so would require mutating the page's private DataChannel, which violates the human-equivalent boundary.
The closest exact fault layer is `coop-duo-biome-market-continuation.test.ts` (dropped raw biomeShop buy +
leave relays still materialize in ordinal order) plus `coop-reward-authoritative-result.test.ts`
(dropped/reordered/delayed immutable results, including the typed market terminal, apply and render once
in revision order). This browser lane proves the natural retained terminal over real staging WebRTC and
public inputs; the external co-op gate owns those fault tests.

## Run speed and the fidelity-profile split

Two-browser runs are slow; the following keep them fast WITHOUT weakening what makes them
trustworthy (all lossless - they never change what is asserted):

- **Fast-abort watchdog** (`terminal-watchdog.mjs`): a decided leg (launch-snapshot abort,
  shared-session terminal, fail-closed, game over, lobby start failure) previously rode out
  120s waits several times over, burning 10+ minutes past the verdict. The watchdog races the
  journey against a poll of the clients' own console evidence and ends the leg within ~200ms of
  a terminal marker, capturing evidence first. `summary.json`'s error names the terminal marker.
- **Marker-driven waits**: the driver's per-step waits poll the v2 semantic surface stream /
  phase markers with short intervals rather than sleeping fixed durations, so a surface that is
  ready early is picked up immediately.
- **Source-keyed bundle cache**: the build job caches the sealed bundle keyed on a hash of the
  GAME source (`src/`, `public/`, lockfile, entry, sealer, vite config, workflow env) - NOT the
  harness driver - so a harness-only push reuses the identical-source bundle and skips the build.
  The seal step always re-runs, re-stamping the current commit SHA + recomputing the digest from
  the identical source, so the exact-SHA seal is preserved (a bad reuse fails loudly at the
  gameplay job's manifest verification). Inter-job handoff is compressed; solo + campaign legs
  run as parallel jobs off one build.
- **CDN-only artifact pruning**: the beta Vite plugin copies vendored images, audio, battle
  animations, and fonts into its output even though staging serves those exact paths through
  immutable `er-assets@<sha>` redirects. Before sealing, the artifact builder removes only paths
  validated by `_redirects`. This prevents local files from masking CDN failures and avoids
  transferring the measured 34,203-file / 522.5 MB duplicate asset payload to every fan-out runner;
  application chunks and all non-redirected runtime data remain digest-sealed.
- **Runner sizing (note for the maintainer):** two Chromium contexts + the localhost preview on
  the default 2-vCPU `ubuntu-latest` are CPU-starved, which inflates WebRTC ICE (~33s observed to
  open the data channel) and the guest's real-cloud persist RTTs. Moving the gameplay jobs to a
  4-core larger runner is a one-line `runs-on:` label change (e.g. a 4-vCPU runner label) - the
  maintainer decides on the paid runner separately; it would materially cut ICE + RTT (and may on
  its own let the guest durability ACK land inside the host's budget).

### In-game speed and assets

- **Game Speed 10x is the DEFAULT** (every profile, incl. nightly). The driver walks the REAL
  Settings menu early in the run - Title menu -> Settings -> Game Speed -> RIGHT x4 to 10x
  (Ludicrous) -> back - which is a legitimate player flow and MORE representative than 1x (the
  overwhelming majority of players run 10x). It is a persisted account setting, so it applies to
  the whole run. Override the key path with `COOP_UI_SPEED_KEYS` (JSON), or pass `"[]"` to leave
  the account's speed unchanged; `COOP_UI_RAISE_SPEED=0` skips the step entirely.
- **Assets always load from the real jsDelivr production CDN** in every profile - local asset
  serving is deliberately NOT offered, so a CDN/asset regression can still surface.
- The campaign workflow fans two labelled profiles from the same immutable bundle. The short
  `animations-on-surface` lane (default 3 waves, `surface_waves`) keeps Move Animations ON and must
  observe both the authoritative move phase and the guest renderer replay. The longer
  `animations-skipped-depth` lane (`campaign_waves`, default 30) visibly selects Move Animations OFF
  through each client's real Display Settings menu and must observe the renderer's explicit
  `anims=false` no-op. The depth lane preserves real accounts, canvas input, game mechanics, staging
  WebRTC, synchronization barriers, CDN assets, and all non-move UI; its one declared fidelity cost is
  move-animation rendering/tween timing. Screenshots, traces, summaries, job names, and artifact names
  retain the profile label so a depth result can never be mistaken for animation-rendering coverage.

## Known future-proofing TODO (do not do now)

The rig hard-codes a two-seat topology: `pair()` asserts the sorted seat set is exactly `[0,1]` and
`assertSharedSurface` (see the `host=0/guest=1` seat assertion, `public-ui-harness.mjs` ~L623) pins host
to seat 0 and guest to seat 1. An **NClientRig** refactor (arbitrary seat count, seat-indexed client map,
per-seat owner resolution) is the path to >2-player co-op journeys. Deferred - the two-seat assertion is
correct for every current journey.
