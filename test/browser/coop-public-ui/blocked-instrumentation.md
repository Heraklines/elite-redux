# Public-UI instrumentation debt

The executable harness sends only visible form and keyboard input. The following gaps prevent it from yet
being a complete human-production oracle.

| Gap | Current safe fallback | Required production instrumentation |
| --- | --- | --- |
| Phaser menu items have no DOM/accessibility identity or selected-state selector | Configured key sequences plus screenshots | Read-only accessibility mirror containing screen ID, option IDs, selected option, enabled state, and owning seat |
| Lobby player rows exist only on canvas | Observe the same sanitized `/coop/lobby` response already consumed by the page, then navigate by its displayed ordering | Public accessibility rows with stable player IDs and selected/request state |
| Command, reward, and replacement readiness exist only on canvas in deployed builds | Exact-SHA CI entry emits a read-only marker after the real handler is active, including address and mechanical digest | Production accessibility event with the same surface contract, so the CI-only observer can be removed |
| Sprite correctness is visual only | PNG evidence at command, faint, replacement, reward, and wave-2 boundaries | Stable render markers for battler seat, species/form, visibility, texture-ready state, and UI bar ownership |
| Deterministic faint cannot be prepared through ordinary play in a short test | Dedicated staging accounts saved at a low-HP command boundary | Staging-only account fixture API that creates a normal signed save; the journey must still resume and act only through public UI |
| Fresh accounts enter gender selection instead of Title | Register and choose gender through visible public UI; tutorials use the beta build flag | Account-fixture lifecycle cleanup plus a public onboarding-complete marker |
| Save persistence has no public completion marker | Close only after both pages reach the identical wave-2 command address/digest; failure appears on reopen | Public `checkpoint persisted` UI event with run ID, wave, slot, and monotonic revision, excluding save contents |
| Resume decision has no stable public option ID | Host/guest Action sequences plus wire-visible public logs | Accessible Resume/New Run prompt and continuation-ready marker on both rendered clients |
| Wave-end state is still a raw companion rather than one retained complete transaction | Compare both clients' exact wave-2 address and mechanical digest; the journey fails closed on a race | Retained WAVE_ADVANCE transaction containing post-battle state and destination, with an exact continuation-ready ACK |
| Both Chromium processes still share one hosted runner's CPU, memory, and OS scheduler | Separate processes close browser-global focus, renderer, and process-fault coupling, but not machine-wide starvation | Distributed variant with one Chrome process per runner joined through staging signaling |
| Full timing fan-out requires multiple dedicated account pairs | Primary cadence is selectable; optional reverse/slow runner consumes the same sealed artifact with `COOP_UI_ALT_*` accounts | Provision one isolated account pair per fast/normal/slow lane and enable all lanes together |
| Screenshots cannot prove animation completion or detect a stale trainer sprite automatically | Retain boundary screenshots for reviewer comparison | Pixel/region baselines keyed to public render markers, with animation-idle stabilization and intentional tolerance masks |
| Browser failures cannot yet be correlated end-to-end with server traces | Sanitized timestamps plus exact retained turn address, membership generation, surface, and digest proofs | Correlation ID spanning lobby pairing, run membership generation, commit, continuation-ready ACK, persistence CAS, and recovery attempt |

Instrumentation must remain read-only. It may expose what a human can see plus stable correlation IDs; it
must never let the driver mutate a scene, inject protocol messages, choose on behalf of a player, seed RNG,
or directly apply recovered state. Fixture creation belongs outside the game browser and must produce the
same signed persistence format that staging normally loads.

## Semantic surface mirror (v2) gaps

The v2 mirror (`[coop-browser:surface2]`, `scripts/coop-browser-entry.ts`) emits every field that is
observable read-only today. The following are emitted best-effort or omitted; each is a gap, not faked:

| Gap | Current observable emission | Required production instrumentation |
| --- | --- | --- |
| Some `AbstractOptionSelectUiHandler` call sites have not declared `semanticId` yet | Declared ids are emitted verbatim; undeclared options use stable `slot:<n>` ordinals, never localized labels | Add intrinsic ids when a new automated flow must target a specific dynamic option rather than an ordinal |
| Per-surface interaction OWNER counter is private to each phase | `ownerSeat` is derived from `isLocalOwnerAtCounter(interactionCounter())` (the LIVE counter) - accurate for a freshly pinned surface, imprecise if the counter advanced after the pin | Each interactive phase exposes the counter it pinned, so owner is read exactly per surface |
| `seatsWithInput` is this client's local view (own seat for local surfaces, owner seat for interaction surfaces) | Emitted from `ownerModel`; a driver must union both clients' markers to see the full input set | A read-only per-surface "input-enabled seats" set on the shared surface contract |
| True presentation-ready / animation-idle / sprite-ready state | `ready.handlerActive` + `ready.awaitingActionInput` (where the handler is awaitable) only | A render-idle / presentation-complete marker per surface (same request as the v1 sprite-readiness gap above) |
| Reward-shop row axis (rewards vs. reroll/lock/continue) | `selectedOptionId` reads `options[getCursor()]` with the modifier type id; the private `rowCursor` axis is not read | A read-only current-row + row-option enumeration on the modifier-select contract |
| Exotic surfaces (bargain, colosseum, quiz, shiny-lab) | Classified with `surfaceId` + address + readiness; their option lists are only emitted when the handler exposes a public `options`/`getCursor`. Showdown team and wager options are now enumerated exactly. | Per-handler read-only option/selection enumeration for the remaining bespoke ER screens |

