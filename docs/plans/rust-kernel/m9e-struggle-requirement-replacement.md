# Struggle and the exhausted-PP regression

The pinned content oracle is `399d5d368f0b5642ebf8f45bd8a5e73350fa4de7`.
Its `src/phases/command-phase.ts` offers Struggle when there are no usable
moves. Move 165 in `src/data/moves/move.ts` has 50 physical power,
unconditional accuracy, typeless damage, and recoil of one quarter of maximum
HP after a hit. The prepared bundle binds this move to intrinsic program 176.

The previous test
`authority_ai_exhausted_max_pp_rejects_raw_turn_without_state_or_rng_changes`
asserted a missing fallback. Its replacement,
`authority_ai_exhausted_max_pp_uses_struggle_without_extra_decisions_or_pp`,
retains all four ordinary-PP, PP-Up, and maximum-PP override exhaustion cases.
It requires a legal authority command, exactly one committed AI decision,
unchanged exhausted move slots, recoil, damage, and complete raw-input replay
from a restored snapshot. The old artifact remains historical evidence; its
incorrect rejection requirement is not a current compatibility promise.

`authority_ai_can_choose_a_legal_enemy_switch` retains its identity and switch
assertion. Its constructed player target now has 400 HP so the existing
policy's estimated knockout bonus for Struggle does not obscure the switch
choice. This is a controlled policy boundary, not a natural trainer journey.

Focused run `34083459858` on
`de0a21d34c03e2375ce7eaf2afdee6fc0367844c` passed all 14 current kernel tests
and both new Struggle tests. Those new tests also failed on the unchanged
runtime in run `34081296113`, before the implementation was added. They check
player/AI exhaustion, typeless query behavior, PP conservation, recoil,
transaction ownership, and restored-snapshot replay.

This evidence does not close full campaign or M9 qualification. Recoil ability
modifiers and broader source-defined move-unavailability conditions remain
separate fidelity work. No final tag or supported-game-scope claim changes.
