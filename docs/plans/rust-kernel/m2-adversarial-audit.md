# PokéRogue Redux M2 adversarial API-bypass and static-boundary audit

This is the M2B-12 audit for PokéRogue Redux. “Elite Redux” appears only when a
source, branch, protocol, or oracle identifier is pinned by the contracts; it is
not the product name.

The executable check is
rust/crates/er-sim/tests/m2_api_bypass.rs. It is deliberately source-facing:
it parses the public pair and keyboard-driver surfaces, checks the frozen
operation union and metadata, and scans the complete production source trees
for forbidden escape hatches. The test harness may read repository files and
invoke git for evidence; those are test-audit operations and are not
production capabilities.

## Result boundary

M2 is architecture, menu, and protocol completion. It is not the full
Pokémon combat or run engine. This document and lane are a static/API-bypass
audit: they record what the later hosted gates must prove, but do not
themselves establish runtime campaign, Wasm, browser transport, or benchmark
evidence.

Milestone completion additionally requires a separate Rust Kernel Gate run
against the exact integration SHA; the final handoff must identify the current
hosted run.

## Requirement evidence

| Milestone / requirement | Executable evidence | Exact boundary and status |
| --- | --- | --- |
| M0: oracle and source lock | source_lock_ownership_and_contract_map_are_frozen; rust/source-lock.toml; rust/contracts/m1-api.md; docs/plans/rust-kernel/authority-v2-oracle.md | Requires oracle game SHA 3b534099919efae827019d4a3f3c4ab0ecd6d67b, pinned branch ci/coop/v2-showdown-command-coordinate-20260720, protocol er-coop-47, schema 1, and repeat 250/250. |
| M0: contract map | audit_contract_array; rust/fixtures/v1/authority-v2-test-map.json; rust/crates/er-protocol/tests/authority_v2_contract_map.rs | Requires all 29 source-lock contracts and all 29 node contracts, unique IDs, non-empty Rust evidence, 28 production node entries, and one visibly distinct simulator reference entry. |
| M1: raw input boundary | simulated_pair_and_keyboard_surfaces_are_raw_only; rust/contracts/m1-api.md; rust/crates/er-testkit/src/keyboard_driver.rs; rust/crates/er-testkit/tests/keyboard_driver_api.rs | Pair and representative driver methods are restricted to raw keys, focus/blur, virtual durations, snapshots, and teardown. Semantic choice/menu names and owner handles are rejected from public signatures. |
| M1: compatibility adapter | The same surface audit plus rust/crates/er-kernel/src/kernel.rs and ui_reducer.rs | KeyboardDriver::new(&mut GameKernel, ...) is the one construction-time low-level adapter exception. The driver exposes copied ui_view() -> UiViewModel and live_resources() -> LiveResourceSnapshot only; no mutable or read-only GameKernel handle, UiReducer, scheduler, or protocol owner is public. M1 low-level reducer/kernel compatibility remains separately constructed and is not a pair capability. |
| M2: pair operation union | pair_operation_is_the_raw_environment_union; rust/crates/er-sim/src/pair.rs; rust/contracts/m2-api.md | Exact variants are RawInput, AdvanceTime, Fault, Disconnect, Reconnect, PresentationSettled, StorageResult, Suspend, and Resume. UiIntent and semantic choices cannot enter PairOperation. |
| M2: frozen snapshot seed | pair_operation_is_the_raw_environment_union; PairSnapshot in pair.rs; rust/contracts/m2-api.md | PairSnapshot.seed must be Rust String; the contract requires a canonical unsigned decimal string and forbids JSON numeric, empty, signed, or padded representations. |
| M2/G5: deterministic production core | production_core_has_no_escape_hatches_or_test_transition_branches; every .rs file under rust/crates/er-kernel/src, er-protocol/src, and er-sim/src | After comments, doc comments, strings, chars, and raw strings are masked, the audit rejects async/runtime, threads, sleep/park/wall-time reads, sockets/network, filesystem, browser/Phaser/Vite, unsafe, mutable globals, and callback retention. |
| M2/G5: test-only branches | assert_cfg_policy and strip_test_modules in the same production scan | cfg(test) is allowed only on a brace-balanced test module. Feature cfgs, cfg!, cfg_attr, and test-conditioned transition code fail. The sole documented item exception is KernelScheduler::set_next_timer_id_for_test, which is removed as a cfg(test)-only allocator helper, as allowed by m2-ownership.toml. |
| M2B-04..08 final integration boundary | later_m2b_campaigns_cannot_call_semantic_or_lower_level_transitions | The five exact campaign files collectively cover the ten contract-required raw-input/environment scenarios and are required at final integration; any missing file fails closed. Read-only matching/assertion of emitted KernelEffect::UiIntent and typed UiIntent variants is allowed as raw-key causality evidence. Semantic PairOperation construction, semantic SimulatedPair calls, KernelInput/GameKernel/reducer/owner handles, and direct transitions fail. This is static/API-bypass evidence only; milestone completion still requires the separate exact-SHA hosted Rust Kernel Gate, with the current hosted run identified in the final handoff. |
| M2: TypeScript immutability | no_production_typescript_path_changed_since_the_oracle; exact git diff invocation below | The audit fails unless the oracle-to-HEAD diff has no .ts path. This is a precise evidence check, not a claim that Rust implements the missing browser/scene/transport adapters. |
| M2/G5: ownership and schema | source_lock_ownership_and_contract_map_are_frozen; rust/contracts/m2-ownership.toml | Requires ownership schema revision 6, M2B-12’s two owned paths, local Rust/co-op execution disabled, and production TypeScript read-only. No public schema or dependency changes are made here. |

## Exact public allowlist

SimulatedPair’s complete public method set is:

- new(SimulatedPairConfig)
- apply(PairOperation)
- key_down, key_up, press, hold_for with PairEndpoint, PhysicalKey, and
  virtual SafeU53 inputs as applicable
- blur, focus, and advance_time
- snapshot and teardown

No select_command, choose_replacement, choose_option, set_cursor,
submit_interaction, open_menu, or close_menu surface is accepted. There is no
public mutable or read-only kernel/reducer handle and no direct protocol-owner
handle.

PairOperation is exactly the raw/environment union RawInput, AdvanceTime,
Fault, Disconnect, Reconnect, PresentationSettled, StorageResult, Suspend,
Resume. It cannot carry UiIntent or a semantic choice.

Campaigns may observe emitted intent evidence. Importing or pattern-matching
UiIntent, including KernelEffect::UiIntent, is not itself an input bypass. The
campaign audit instead parses PairOperation uses and rejects semantic variants
or semantic fields, rejects the named semantic SimulatedPair methods, and
rejects every KernelInput, GameKernel, reducer, scheduler, or protocol-owner
handle plus direct step/reduce/menu-transition calls. A campaign-created
KernelInput::UiIntent-like path therefore fails closed without confusing an
output assertion with an injected input.

The representative driver allowlist is DetachedKeyboardDriver’s new, seat,
input_focus, key_down, key_up, press, hold_for, blur, focus and
KeyboardDriver’s new, key_down, key_up, press, hold_for, blur, focus, ui_view,
live_resources. The one adapter boundary is KeyboardDriver::new(&mut
GameKernel, ...); every other public method must reject both mutable and
read-only GameKernel handles. ui_view returns a copied UiViewModel and
live_resources returns a copied LiveResourceSnapshot. A method named kernel is
forbidden. Public semantic method names and protocol/reducer/scheduler owners
are rejected.

## Matching and false-positive policy

The test’s small Rust lexer preserves byte offsets and newlines while blanking
line/block comments (including nested blocks), normal/raw strings, byte
strings, and character literals. Identifier matching is token-based; qualified
matching removes whitespace only after literals have been masked. Therefore a
comment, doc example, test name, string fixture, or InstantPresenter enum
variant cannot trigger the wall-clock rule. The production scan rejects
qualified or imported std/core::time::Instant/SystemTime, including direct
namespace aliases and wildcard imports, rather than blanket-rejecting the
harmless PresenterMode::Instant identifier. Legal std/core::time::Duration
imports remain allowed. The brace-balanced cfg(test)
extractor removes only test modules before scanning production code. A
non-test cfg, feature branch, cfg!, or cfg_attr fails before extraction.

The forbidden set covers:

- async functions and runtimes, OS threads, spawning, sleeps, parks, blocking
  waits, and qualified/imported std::time::Instant/SystemTime reads;
- sockets, network clients, browser APIs, filesystem/process APIs, Phaser, and
  Vite;
- unsafe, mutable static state, lazy/global runtime state, and retained
  callbacks/function objects.

VirtualClock arithmetic, deterministic seeded FaultNetwork, synchronous
presenter/storage value adapters, and ordinary Rust collections remain
allowed. Their source is audited in er-sim/src; they do not retain callbacks or
own a real transport, filesystem, browser, or wall clock. If an er-sim/benches
directory is later added, the executable audit scans its Rust sources with the
measurement-only exception: wall-time/process/output measurement may exist
there, but sleeps, network/browser APIs, and runtime/thread escape hatches fail.

## Known nonportable adapter boundaries

KeyboardDriver is a testkit/compatibility adapter and borrows a mutable
GameKernel only at construction so raw input can be stepped. Its public
ui_view and live_resources methods return copied values; no public method
returns a GameKernel reference. The pair public surface does not return that
handle. GameKernel::replace_menu and direct UiReducer methods are M1
low-level compatibility APIs and must remain separately constructed from a
campaign pair. Presenter, storage, and network objects are deterministic
in-memory/value adapters; they are not browser or transport implementations.
Browser/Phaser/scene/transport integration is a later adapter boundary.

Benchmark orchestration may measure wall time or use a process runner to
measure a Rust-native scenario, but kernel/protocol/simulator code may not
sleep, read wall time, or perform local I/O. The benchmark exception is
measurement-only and must remain outside production core.

Final integration requires all five exact M2B-04..08 campaign filenames from
the ownership manifest; together they cover the ten required raw-only
scenarios. The executable audit fails closed if any is missing or
if any file constructs a semantic PairOperation, calls a semantic pair method,
or reaches a lower-level transition/owner surface. Read-only UiIntent output
matching remains valid evidence. This lane does not claim that those branches,
the M2B-03 driver revision, M2B-11 benchmark runner, or the hosted G5 gate are
already green; the final hosted gate remains the authority for the complete
composition.

## Final integration evidence checklist

Run from a checkout that contains the oracle object and the exact integration
SHA. Do not run the Rust/co-op commands on a developer workstation; the
ownership manifest requires hosted execution.

1. Source lock and map inventory:

   ~~~text
   git show HEAD:rust/source-lock.toml
   git diff --name-status 3b534099919efae827019d4a3f3c4ab0ecd6d67b HEAD -- rust/source-lock.toml rust/contracts/m2-ownership.toml rust/fixtures/v1/authority-v2-test-map.json
   ~~~

   The executable audit additionally parses the lock as an exact six-key
   assignment set and parses the JSON map as exact 29/29 arrays.

2. Owned-path and whitespace audit:

   ~~~text
   git diff --check 3b534099919efae827019d4a3f3c4ab0ecd6d67b HEAD
   git diff --name-only d516b839d571a97326c3ebf68980866513fad786 HEAD
   ~~~

   The second command must list only
   rust/crates/er-sim/tests/m2_api_bypass.rs and
   docs/plans/rust-kernel/m2-adversarial-audit.md for this task branch.

3. Exact TypeScript immutability evidence:

   ~~~text
   git diff --name-status 3b534099919efae827019d4a3f3c4ab0ecd6d67b HEAD -- ':(glob)**/*.ts'
   ~~~

   It must be empty. This deliberately checks every TypeScript path, which is
   stricter than only checking production directories.

4. Hosted static/audit job (not local Cargo):

   ~~~text
   cargo test -p er-sim --test m2_api_bypass -- --nocapture
   ~~~

   Record the hosted log, source inventory, source-lock/map result, and the
   exact commit SHA. The local policy permits only git diff --check, source
   parsing, JSON/TOML parsing, and owned-path inspection.

5. Hosted six-job M2/G5 gate: the integration owner pushes the exact
   integration SHA to the configured branch, then watches the registered
   Rust Kernel Gate workflow:

   ~~~text
   gh run list --workflow rust-kernel.yml --commit <INTEGRATION_SHA> --limit 1
   gh run watch <RUN_ID> --exit-status
   ~~~

   Require source-lock/fixtures, format, clippy, native nextest/doctests,
   Wasm Node parity, and the benchmark-contract job to finish. Wait for all
   six jobs with fail-fast disabled and retain each job’s compact manifest plus
   failure logs/screenshots/traces. A green audit alone is not a green G5
   gate.

6. Hosted Wasm parity: run the pinned Wasm parity job against the same SHA and
   retain the replay/digest artifact and browser-adapter result. This audit
   does not replace that behavioral check.

7. Measured benchmark evidence is required from the M2B-11 runner before this
   lane is cherry-picked. Run its measured mode on a hosted runner and retain
   the exact four-workload artifact:

   ~~~text
   node scripts/benchmark-kernel-m2.mjs --mode measure > rust-ci-benchmarks/benchmark-kernel-m2.json
   ~~~

   Verify that the artifact is bound to the exact integration SHA and checked-in
   rust/fixtures/v1/m2-benchmark-manifest.json M2B-11 manifest, contains exactly
   the four Rust-native workloads (1,000
   input/menu transitions; 1,000 proposal/receipt cycles; 10,000 deterministic
   fault schedules; one 100,000-step synthetic campaign), and includes measured
   results plus runner metadata. Wall-time measurement belongs to orchestration
   only; it is not permission for production core sleeps or wall-clock reads.

8. Final artifacts: exact commit SHA, owned-path diff, git diff --check
   result, hosted audit log, six-job gate summaries, Wasm parity replay/digest,
   benchmark manifest/raw result, and the campaign audit report. Any missing
   M2B-04..08 campaign file is a final-integration failure.
