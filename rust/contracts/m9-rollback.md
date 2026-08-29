# M9 signed rollback directive

`RollbackDirectiveV1` binds directive, affected/target releases, target authority, scope, typed reason, issue/expiry time, and policy revision. It is Ed25519-signed over `er-m9:rollback-directive-v1\0` plus canonical payload bytes.

Default target is the previous complete qualified Rust release. Rollback is a policy pointer update and never rebuilds artifacts. New and unstarted assigned sessions follow the directive. Active sessions remain pinned unless their release is unusable and an explicitly compatible safe-boundary migration is accepted.

Scopes are `NEW_SESSIONS`, `UNSTARTED_ASSIGNED_SESSIONS`, and `ALL_SAFE_BOUNDARY_SESSIONS`. `LEGACY_TRANSITION` requires an explicit signed directive and eligibility; it is never the implicit target for Rust-mutated saves.

Unknown key, invalid signature, expired directive, missing target release, revoked/incomplete target, incompatible save, policy-hash race, or broadened scope fails closed. Rollback publication records expected prior policy hash, resulting policy hash, operator approval, reason, and release health evidence.
