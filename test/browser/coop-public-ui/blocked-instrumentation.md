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
| Fresh accounts may enter gender/tutorial instead of Title | Require tutorial-complete staging accounts | Account-fixture lifecycle that proves and reports tutorial-complete state without altering the game page |
| Save persistence has no public completion marker | Close only after both pages reach the identical wave-2 command address/digest; failure appears on reopen | Public `checkpoint persisted` UI event with run ID, wave, slot, and monotonic revision, excluding save contents |
| Resume decision has no stable public option ID | Host/guest Action sequences plus wire-visible public logs | Accessible Resume/New Run prompt and continuation-ready marker on both rendered clients |
| Wave-end state is still a raw companion rather than one retained complete transaction | Compare both clients' exact wave-2 address and mechanical digest; the journey fails closed on a race | Retained WAVE_ADVANCE transaction containing post-battle state and destination, with an exact continuation-ready ACK |
| One Chromium process still shares browser executable and OS resources | Separate BrowserContexts guarantee independent cookies/storage but not process-global browser faults | CI variant with one Chrome process per player, ideally on separate runners joined through staging signaling |
| Full timing fan-out requires multiple dedicated account pairs | Primary cadence is selectable; optional reverse/slow runner consumes the same sealed artifact with `COOP_UI_ALT_*` accounts | Provision one isolated account pair per fast/normal/slow lane and enable all lanes together |
| Screenshots cannot prove animation completion or detect a stale trainer sprite automatically | Retain boundary screenshots for reviewer comparison | Pixel/region baselines keyed to public render markers, with animation-idle stabilization and intentional tolerance masks |
| Browser failures cannot yet be correlated end-to-end with server traces | Sanitized timestamps plus exact retained turn address, membership generation, surface, and digest proofs | Correlation ID spanning lobby pairing, run membership generation, commit, continuation-ready ACK, persistence CAS, and recovery attempt |

Instrumentation must remain read-only. It may expose what a human can see plus stable correlation IDs; it
must never let the driver mutate a scene, inject protocol messages, choose on behalf of a player, seed RNG,
or directly apply recovered state. Fixture creation belongs outside the game browser and must produce the
same signed persistence format that staging normally loads.

