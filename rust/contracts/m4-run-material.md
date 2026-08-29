# M4 authority material contract

## Invariant

Every authoritative run transition is represented by a typed material, canonical-encoded, canonical-decoded, and applied through one production applier on both authority and replica. The authority does not adopt its prepared candidate directly. Replicas never rerun progression, reward, market, biome, encounter, or battle-start RNG.

All materials contain:

- schema version and closed material kind;
- M4 oracle SHA for current run and battle content plus immutable M3 parity oracle SHA;
- battle-content and run-content hashes;
- run, wave, interaction, and source identities appropriate to the kind;
- mechanical before and after digests;
- complete typed before and after `GameState` values;
- ordered mutations, presentation plan, and RNG audit;
- exact next `GameControlPlan`;
- allocator and interaction-counter after-state.

`serde_json::Value`, callbacks, scripts, dynamic trait objects, and opaque adapter-success fields are forbidden inside canonical material.

## Material mapping

| Authority kind | Payload |
|---|---|
| `TURN_COMMIT` | `BattleTurnMaterialV2` |
| `REPLACEMENT_COMMIT` | `BattleReplacementMaterialV2` |
| `WAVE_ADVANCE` | `WaveAdvanceMaterialV1` |
| `INTERACTION_COMMIT` | `RunInteractionMaterialV1` |
| `TERMINAL_COMMIT` | `RunTerminalMaterialV1` |

`BattleTurnMaterialV2` and `BattleReplacementMaterialV2` carry the complete game-owned player party and encounter-owned battle after-state. They cannot contain a second player-party copy under `BattleState`.

`WaveAdvanceMaterialV1` settles the source battle exactly once, records participation and defeated-enemy evidence, applies money/EXP/progression effects, destroys the old battle, advances the wave, and opens the exact next control or progression frontier.

`RunInteractionMaterialV1` commits one progression or surface action. Continuing shop purchases advance the per-surface action ordinal but do not close the surface. Terminal reward, learn, Crossroads, market leave, and biome-selection actions close or replace their exact surface according to the frozen control transition.

Encounter generation and `BattleStartV2` are folded into the same `WaveAdvanceMaterialV1` or terminal `RunInteractionMaterialV1` that closes the preceding boundary. Its `after_state` is already `RunStage::Battle`; no separate battle-start material, operation, or Authority revision exists.

`RunTerminalMaterialV1` records run victory or defeat and installs `GameControl::Complete`.

## Identity and idempotence

Canonical operation IDs preserve the live Authority V2 grammar:

```text
interaction: <epoch>:<ownerSeat>:<KIND>:<address>
ambient reward/market address: pinned*100000 + actionOrdinal
Crossroads: <epoch>:<owner>:CROSSROADS_PICK:<9600000+pinned>
interactive biome: <epoch>:<owner>:BIOME_PICK:<9700000+pinned>
deterministic biome: <epoch>:0:BIOME_PICK:<9800001+sourceWave>
move learning: <epoch>:<pokemonOwner>:<LEARN_MOVE|LEARN_MOVE_BATCH>:<ordinal>
global wave: V2/WAVE/e<epoch>/w<wave>/tick<authorityTick>
terminal: V2/TERMINAL/e<epoch>/w<wave>/tick<authorityTick>
```

Interaction IDs do not encode wave. Wave, run, surface, and task coordinates remain in retained control/material state and the proposal fingerprint. Adapter-only `IREW`, `IMKT`, and `IBIO` addresses are forbidden.

A proposal fingerprint includes the complete operation ID, run ID, wave, owner seat, surface kind and ID, action ordinal, menu instance, control ID, selected stable option ID, target identity when present, and semantic payload. Identical identity plus identical fingerprint is idempotent. Identical identity plus different fingerprint is a protocol violation.

## Apply protocol

1. Canonical-decode and reject noncanonical bytes.
2. Validate kind, schema, M4 content oracle SHA, M3 parity oracle SHA, and both content hashes.
3. Validate material `before_state`, recompute its mechanical digest, and require exact equality with material `before_digest`. Failure is invalid authority material.
4. Validate material `after_state`, recompute its mechanical digest, and require exact equality with material `after_digest`.
5. Replay ordered mutations against material `before_state`, validate RNG before/after state and audit continuity without drawing, and require exact material `after_state`.
6. Validate the exact authority-log predecessor and operation identity.
7. Compare the already self-validated material `before_digest` with the endpoint-local mechanical frontier. Only this mismatch is correlated recovery.
8. Validate next control, allocator, interaction counters, and surface digest.
9. Replace the complete staged game state atomically.
10. Queue presentation and install logical control under the presentation barrier.

Duplicate application returns the existing completion receipt and mutates nothing. Any other failure follows `m4-error-policy.md` and cannot leak staged state or effects.

## Candidate equality

For every authority transition:

```text
prepared candidate after-state
== decoded material-applied authority state
== decoded material-applied replica state
```

The hosted material suite compares the complete state, all three M3 digests plus the M4 surface digest, allocator state, and external effect sequence.