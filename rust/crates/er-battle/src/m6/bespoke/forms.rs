//! M6 battle-side transitions for the bespoke `forms` family
//! (`TRANSFORM_FORM_COPY` subset: form / stance / Mega / Tera overlays;
//! Transform *copying* belongs to the `transform_imposter` family).
//!
//! Every transition here is pure: it borrows canonical
//! [`FormsStateV2`], clones it, applies exactly one validated step, re-validates
//! the clone, and returns it together with a typed outcome and the presentation
//! cues staged during the call. False conditions never mutate
//! (oracle negative assertion `FALSE_CONDITION_DOES_NOT_MUTATE`) and repeated
//! requests are either idempotent or rejected with a typed error — never a
//! silent double application.
//!
//! Frozen mutual-exclusion rules (catalog/oracle evidence):
//! - at most ONE overlay per scope at any time;
//! - Terastallization is blocked while a Mega/Primal overlay is active
//!   (`canSpeciesTera`, `src/utils/pokemon-utils.ts:204-208`);
//! - Terastallization consumes the frozen per-side budget of
//!   [`TERAS_PER_SIDE_MAX`] (`MAX_TERAS_PER_ARENA`, `src/constants.ts:129`)
//!   and PERSISTS through switch-out: `resetTera()`
//!   (`src/field/pokemon.ts:7523`) runs only on faint
//!   (`src/phases/faint-phase.ts:202`) and trainer-battle end
//!   (`src/battle-scene.ts:2440`); `SpeciesFormChangeLapseTeraTrigger`
//!   reverts Ogerpon/Terapagos form keys inside that reset, never on
//!   switch.
//! - stance swaps are same-species and cannot be staged under a one-time
//!   overlay.
//!
//! The family additionally owns the closed CUSTOM_DISPATCH `SPECIES` group:
//! every otherwise-unowned `SPECIES_FORM_BEHAVIOR` behavior unit is covered by
//! the deterministic [`SpeciesFormRegistryV2`] battle-metadata lookup, and the
//! test suite proves exact closure over the frozen cluster fixture.

use thiserror::Error;

use er_state::bespoke_v2::forms::{
    FormCueKindV2, FormIdentityV2, FormOverlayKindV2, FormOverlayV2, FormPresentationCueV2,
    FormsStateError, FormsStateV2, FormsTransitionScopeError, MAX_POKEMON_TYPE_ORDINAL,
    SpeciesFormRegistryV2, StanceRequestV2, TERAS_PER_SIDE_MAX,
};
use er_types::battle_ids::BattleSide;
use er_types::mechanics::MechanicScope;

/// Exact closure count of the CUSTOM_DISPATCH `SPECIES`
/// (`SPECIES_FORM_BEHAVIOR`) subset owned by this family.
pub const CUSTOM_DISPATCH_SPECIES_CLOSURE_COUNT: usize = 2018;

/// Result of one validated family transition.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FormsTransitionV2 {
    /// Updated canonical state; the input value is never modified.
    pub state: FormsStateV2,
    pub outcome: FormsOutcomeV2,
    /// Presentation cues staged by this transition, in ordinal order.
    pub cues: Vec<FormPresentationCueV2>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum FormsOutcomeV2 {
    /// The transition mutated canonical state.
    Applied,
    /// A false/repeated condition matched; canonical state was preserved.
    IdempotentNoOp,
    /// A new stance transition request was staged.
    RequestStaged,
    /// An identical stance transition request was already staged.
    RequestAlreadyStaged,
}

#[derive(Debug, Eq, Error, PartialEq)]
pub enum FormsTransitionError {
    #[error("no battler is registered under the requested mechanic scope")]
    UnknownBattlerScope,
    #[error("scope already carries an active {active:?} overlay")]
    OverlayActive { active: FormOverlayKindV2 },
    #[error("mega evolution was already admitted for this battler this battle")]
    MegaAlreadyUsed,
    #[error("mega target must keep the battler's base species")]
    MegaCrossSpecies,
    #[error("mega target equals the base form")]
    MegaTargetEqualsBase,
    #[error("stance targets must keep the battler's base species")]
    StanceCrossSpecies,
    #[error("stance request must change the presented form")]
    StanceTargetEqualsCurrent,
    #[error("another stance request {pending_request_id} is already staged")]
    StanceRequestPending { pending_request_id: u64 },
    #[error("request id {staged_request_id} is already staged for a different stance target")]
    StanceRequestConflict { staged_request_id: u64 },
    #[error("no stance request is staged for this scope")]
    NoStancePending,
    #[error("tera type ordinal must be within 0..={MAX_POKEMON_TYPE_ORDINAL} inclusive")]
    InvalidTeraTypeOrdinal,
    #[error("side {side:?} already consumed its frozen Tera budget of {TERAS_PER_SIDE_MAX}")]
    TeraBudgetExhausted { side: BattleSide },
    #[error("terastallization requires a field-slot battler scope")]
    ScopeNotFieldBattler,
    #[error("scope belongs to the opposite side but the command targeted {side:?}")]
    TeraSideMismatch { side: BattleSide },
    #[error("stance request id must be positive")]
    ZeroStanceRequestId,
    #[error("form identity is invalid: {0}")]
    InvalidFormIdentity(#[source] FormsStateError),
    #[error("transition produced invalid canonical state: {0}")]
    StateInvariant(#[source] FormsStateError),
}

fn prepared(
    state: &FormsStateV2,
    scope: &MechanicScope,
) -> Result<(FormsStateV2, usize), FormsTransitionError> {
    state.prepare_transition(scope).map_err(|err| match err {
        FormsTransitionScopeError::UnknownScope => FormsTransitionError::UnknownBattlerScope,
    })
}

/// Validates the post-transition clone and packages it with the cues staged
/// during the call.
fn finish(
    next: FormsStateV2,
    outcome: FormsOutcomeV2,
    cue_start: usize,
) -> Result<FormsTransitionV2, FormsTransitionError> {
    next.validate()
        .map_err(FormsTransitionError::StateInvariant)?;
    let cues = next.cues[cue_start..].to_vec();
    Ok(FormsTransitionV2 {
        state: next,
        outcome,
        cues,
    })
}

fn require_identity(target: &FormIdentityV2) -> Result<(), FormsTransitionError> {
    target
        .validate()
        .map_err(FormsTransitionError::InvalidFormIdentity)
}

fn active_overlay(
    battler: &er_state::bespoke_v2::forms::FormsBattlerStateV2,
) -> Option<FormOverlayKindV2> {
    battler.overlay.as_ref().map(|overlay| overlay.kind)
}

fn one_time_active(
    battler: &er_state::bespoke_v2::forms::FormsBattlerStateV2,
) -> Option<FormOverlayKindV2> {
    match active_overlay(battler) {
        Some(kind @ (FormOverlayKindV2::Mega | FormOverlayKindV2::Tera)) => Some(kind),
        _ => None,
    }
}

/// Confirms the battler's species carries closed form battle-metadata before
/// any overlay admission. Integration resolves the metadata once at battle
/// load; the check keeps overlay behavior traceable to owned catalog evidence.
pub fn require_species_metadata(
    registry: &SpeciesFormRegistryV2,
    identity: &FormIdentityV2,
) -> Result<(), FormsTransitionError> {
    if registry.covers(identity.species.get()) {
        Ok(())
    } else {
        Err(FormsTransitionError::UnknownBattlerScope)
    }
}

/// Stages a stance transition request. Re-submitting the identical request is
/// idempotent ([`FormsOutcomeV2::RequestAlreadyStaged`]); a conflicting id or
/// target is rejected without mutating anything.
pub fn stage_stance_request(
    state: &FormsStateV2,
    scope: &MechanicScope,
    request_id: u64,
    target: FormIdentityV2,
) -> Result<FormsTransitionV2, FormsTransitionError> {
    if request_id == 0 {
        return Err(FormsTransitionError::ZeroStanceRequestId);
    }
    require_identity(&target)?;
    let (mut next, position) = prepared(state, scope)?;
    let cue_start = next.cues.len();
    let battler = next.battler_mut_at(position);
    if let Some(active) = one_time_active(battler) {
        return Err(FormsTransitionError::OverlayActive { active });
    }
    // Oracle precedence: the identity of an already-staged request is
    // resolved first — idempotent restage or typed conflict — before any
    // false-condition validation of a fresh target.
    if let Some(pending) = &battler.pending_stance_request {
        if pending.request_id == request_id {
            if pending.target == target {
                return finish(next, FormsOutcomeV2::RequestAlreadyStaged, cue_start);
            }
            return Err(FormsTransitionError::StanceRequestConflict {
                staged_request_id: pending.request_id,
            });
        }
        return Err(FormsTransitionError::StanceRequestPending {
            pending_request_id: pending.request_id,
        });
    }
    if target.species != battler.base.species {
        return Err(FormsTransitionError::StanceCrossSpecies);
    }
    if target == battler.current {
        return Err(FormsTransitionError::StanceTargetEqualsCurrent);
    }
    battler.pending_stance_request = Some(StanceRequestV2 {
        request_id,
        target: target.clone(),
    });
    let from = Some(battler.current.clone());
    next.push_cue(
        FormCueKindV2::StanceRequestStaged,
        *scope,
        from,
        Some(target),
    );
    finish(next, FormsOutcomeV2::RequestStaged, cue_start)
}

/// Resolves the staged stance request into a reversible
/// [`FormOverlayKindV2::Stance`] swap. A repeated resolution finds no pending
/// request and is rejected.
pub fn resolve_pending_stance(
    state: &FormsStateV2,
    scope: &MechanicScope,
) -> Result<FormsTransitionV2, FormsTransitionError> {
    let (mut next, position) = prepared(state, scope)?;
    let cue_start = next.cues.len();
    let battler = next.battler_mut_at(position);
    let pending = battler
        .pending_stance_request
        .take()
        .ok_or(FormsTransitionError::NoStancePending)?;
    let from = Some(battler.current.clone());
    battler.overlay = Some(FormOverlayV2 {
        kind: FormOverlayKindV2::Stance,
        current: pending.target.clone(),
        tera_type_ordinal: None,
    });
    battler.current = pending.target.clone();
    next.push_cue(
        FormCueKindV2::OverlayApplied(FormOverlayKindV2::Stance),
        *scope,
        from,
        Some(pending.target),
    );
    finish(next, FormsOutcomeV2::Applied, cue_start)
}

/// Applies a trigger-gated reversible overlay (weather/status/time-of-day).
/// Applying the identical overlay again is a no-op that preserves state.
pub fn apply_conditional_overlay(
    state: &FormsStateV2,
    scope: &MechanicScope,
    target: FormIdentityV2,
) -> Result<FormsTransitionV2, FormsTransitionError> {
    require_identity(&target)?;
    let (mut next, position) = prepared(state, scope)?;
    let cue_start = next.cues.len();
    let battler = next.battler_mut_at(position);
    if let Some(active) = one_time_active(battler) {
        return Err(FormsTransitionError::OverlayActive { active });
    }
    if let Some(overlay) = &battler.overlay {
        if overlay.kind == FormOverlayKindV2::Conditional && overlay.current == target {
            return finish(next, FormsOutcomeV2::IdempotentNoOp, cue_start);
        }
    }
    let from = Some(battler.current.clone());
    battler.overlay = Some(FormOverlayV2 {
        kind: FormOverlayKindV2::Conditional,
        current: target.clone(),
        tera_type_ordinal: None,
    });
    battler.current = target.clone();
    next.push_cue(
        FormCueKindV2::OverlayApplied(FormOverlayKindV2::Conditional),
        *scope,
        from,
        Some(target),
    );
    finish(next, FormsOutcomeV2::Applied, cue_start)
}

/// Reverts the trigger-gated reversible overlay back to the stable base form.
/// With no conditional overlay present this is a no-op.
pub fn revert_conditional_overlay(
    state: &FormsStateV2,
    scope: &MechanicScope,
) -> Result<FormsTransitionV2, FormsTransitionError> {
    let (mut next, position) = prepared(state, scope)?;
    let cue_start = next.cues.len();
    let battler = next.battler_mut_at(position);
    let matches = matches!(
        &battler.overlay,
        Some(overlay) if overlay.kind == FormOverlayKindV2::Conditional
    );
    if !matches {
        return finish(next, FormsOutcomeV2::IdempotentNoOp, cue_start);
    }
    let from = Some(battler.current.clone());
    let base = battler.base.clone();
    battler.overlay = None;
    battler.current = base.clone();
    next.push_cue(
        FormCueKindV2::OverlayReverted(FormOverlayKindV2::Conditional),
        *scope,
        from,
        Some(base),
    );
    finish(next, FormsOutcomeV2::Applied, cue_start)
}

/// Admits the one-time Mega/Primal overlay for this battler for this battle.
pub fn admit_mega(
    state: &FormsStateV2,
    scope: &MechanicScope,
    mega_target: FormIdentityV2,
) -> Result<FormsTransitionV2, FormsTransitionError> {
    require_identity(&mega_target)?;
    let (mut next, position) = prepared(state, scope)?;
    let cue_start = next.cues.len();
    let battler = next.battler_mut_at(position);
    if battler.mega_used {
        return Err(FormsTransitionError::MegaAlreadyUsed);
    }
    if let Some(active) = active_overlay(battler) {
        return Err(FormsTransitionError::OverlayActive { active });
    }
    if mega_target.species != battler.base.species {
        return Err(FormsTransitionError::MegaCrossSpecies);
    }
    if mega_target.form_key == battler.base.form_key {
        return Err(FormsTransitionError::MegaTargetEqualsBase);
    }
    let from = Some(battler.current.clone());
    battler.mega_used = true;
    battler.overlay = Some(FormOverlayV2 {
        kind: FormOverlayKindV2::Mega,
        current: mega_target.clone(),
        tera_type_ordinal: None,
    });
    battler.current = mega_target.clone();
    next.push_cue(
        FormCueKindV2::OverlayApplied(FormOverlayKindV2::Mega),
        *scope,
        from,
        Some(mega_target),
    );
    finish(next, FormsOutcomeV2::Applied, cue_start)
}

/// Admits Terastallization for a field-slot battler. Validates the assigned
/// Tera type ordinal, the frozen per-side budget, and the Mega-block rule.
pub fn admit_tera(
    state: &FormsStateV2,
    side: BattleSide,
    scope: &MechanicScope,
    tera_type_ordinal: u8,
) -> Result<FormsTransitionV2, FormsTransitionError> {
    if tera_type_ordinal > MAX_POKEMON_TYPE_ORDINAL {
        return Err(FormsTransitionError::InvalidTeraTypeOrdinal);
    }
    let slot = match scope {
        MechanicScope::Field { slot } => *slot,
        _ => return Err(FormsTransitionError::ScopeNotFieldBattler),
    };
    if slot.side != side {
        return Err(FormsTransitionError::TeraSideMismatch { side });
    }
    if state.teras_used(side) >= TERAS_PER_SIDE_MAX {
        return Err(FormsTransitionError::TeraBudgetExhausted { side });
    }
    let (mut next, position) = prepared(state, scope)?;
    let cue_start = next.cues.len();
    let battler = next.battler_mut_at(position);
    if let Some(active) = active_overlay(battler) {
        // Frozen rule: Mega/Primal forms cannot Terastallize
        // (`canSpeciesTera`, src/utils/pokemon-utils.ts:206); canonically no
        // overlay composes with another.
        return Err(FormsTransitionError::OverlayActive { active });
    }
    let from = Some(battler.current.clone());
    let presented = battler.base.clone();
    battler.overlay = Some(FormOverlayV2 {
        kind: FormOverlayKindV2::Tera,
        current: presented.clone(),
        tera_type_ordinal: Some(tera_type_ordinal),
    });
    match side {
        BattleSide::Player => next.teras_used_player_side += 1,
        BattleSide::Enemy => next.teras_used_enemy_side += 1,
    }
    next.push_cue(
        FormCueKindV2::OverlayApplied(FormOverlayKindV2::Tera),
        *scope,
        from,
        Some(presented),
    );
    finish(next, FormsOutcomeV2::Applied, cue_start)
}

/// Switch-out cleanup: lapses the reversible overlays (Conditional/Stance)
/// on the scope back to its stable base form and discards a pending stance
/// request. The Tera overlay PERSISTS through switch-out (frozen rule:
/// `resetTera()` runs only on faint, `src/phases/faint-phase.ts:202`, and
/// trainer-battle end, `src/battle-scene.ts:2440`), as do consumed one-time
/// admissions (`mega_used`, per-side Tera budget). With nothing to lapse
/// this is a no-op.
pub fn cleanup_on_switch(
    state: &FormsStateV2,
    scope: &MechanicScope,
) -> Result<FormsTransitionV2, FormsTransitionError> {
    let (mut next, position) = prepared(state, scope)?;
    let cue_start = next.cues.len();
    let (lapsed, base, previous) = {
        let battler = next.battler_mut_at(position);
        let lapsed = match &battler.overlay {
            Some(overlay) if overlay.kind != FormOverlayKindV2::Tera => Some(overlay.kind),
            _ => None,
        };
        if lapsed.is_none() && battler.pending_stance_request.is_none() {
            return finish(next, FormsOutcomeV2::IdempotentNoOp, cue_start);
        }
        let base = battler.base.clone();
        let previous = battler.current.clone();
        // Mutate through the owned borrow first; cue staging below re-borrows
        // `next`, so the mutable battler borrow must end before the calls.
        if lapsed.is_some() {
            battler.overlay = None;
            battler.current = base.clone();
        }
        battler.pending_stance_request = None;
        (lapsed, base, previous)
    };
    if let Some(kind) = lapsed {
        next.push_cue(
            FormCueKindV2::OverlayReverted(kind),
            *scope,
            Some(previous),
            Some(base),
        );
    }
    next.push_cue(FormCueKindV2::SwitchCleanup, *scope, None, None);
    finish(next, FormsOutcomeV2::Applied, cue_start)
}

/// Battle-end cleanup: resets every battler to its stable base form and
/// restores all one-time admissions. Already-pristine state is a no-op.
pub fn cleanup_battle_end(state: &FormsStateV2) -> Result<FormsTransitionV2, FormsTransitionError> {
    let mut next = state.clone();
    let cue_start = next.cues.len();
    let dirty = next.teras_used_player_side > 0
        || next.teras_used_enemy_side > 0
        || next.battlers.iter().any(|battler| {
            battler.overlay.is_some()
                || battler.pending_stance_request.is_some()
                || battler.mega_used
        });
    if !dirty {
        return finish(next, FormsOutcomeV2::IdempotentNoOp, cue_start);
    }
    for battler in &mut next.battlers {
        battler.pending_stance_request = None;
        battler.overlay = None;
        battler.current = battler.base.clone();
        battler.mega_used = false;
    }
    next.teras_used_player_side = 0;
    next.teras_used_enemy_side = 0;
    next.push_cue(
        FormCueKindV2::BattleEndReset,
        MechanicScope::Battle,
        None,
        None,
    );
    finish(next, FormsOutcomeV2::Applied, cue_start)
}

/// Deterministic presentation evidence: the full ordered cue ledger.
pub fn presentation_cues(state: &FormsStateV2) -> &[FormPresentationCueV2] {
    &state.cues
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_state::bespoke_v2::forms::{
        FORMS_STATE_SCHEMA_VERSION, FORMS_STATE_SCHEMA_VERSION as SCHEMA_V2,
    };
    use er_state::bespoke_v2::forms::{FormsBattlerStateV2, FormsStateError, TERAS_PER_SIDE_MAX};
    use er_types::battle_ids::FieldSlot;

    const SPECIES_AEGISLASH: u64 = 681;
    const SPECIES_CASTFORM: u64 = 351;

    fn field_scope(side: BattleSide, position: u8) -> MechanicScope {
        MechanicScope::Field {
            slot: FieldSlot::new(side, position).expect("slot"),
        }
    }

    fn identity(species: u64, form_key: &str) -> FormIdentityV2 {
        FormIdentityV2::new(species, form_key).expect("identity")
    }

    /// One player-side Aegislash (stance pair shield/blade) and one enemy-side
    /// Castform (weather trio), registered in canonical scope order.
    fn seeded() -> FormsStateV2 {
        FormsStateV2::default()
            .register_battler(
                field_scope(BattleSide::Enemy, 0),
                identity(SPECIES_CASTFORM, "forecast"),
            )
            .expect("enemy registration")
            .register_battler(
                field_scope(BattleSide::Player, 0),
                identity(SPECIES_AEGISLASH, "shield"),
            )
            .expect("player registration")
    }

    #[test]
    fn schema_version_is_frozen_mechanic_state_v2() {
        assert_eq!(FORMS_STATE_SCHEMA_VERSION, 2);
        assert_eq!(SCHEMA_V2, 2);
        let state = seeded();
        assert_eq!(state.schema_version, SCHEMA_V2);
        state.validate().expect("seeded state validates");
    }

    #[test]
    fn register_rejects_duplicate_scope_and_unknown_lookups_are_none() {
        let state = seeded();
        let duplicate = state.register_battler(
            field_scope(BattleSide::Player, 0),
            identity(SPECIES_AEGISLASH, "blade"),
        );
        assert_eq!(duplicate.unwrap_err(), FormsStateError::DuplicateScope);
        assert!(state.battler(&field_scope(BattleSide::Player, 2)).is_none());
    }

    #[test]
    fn stance_stage_resolve_swap_and_repeat_resolution_is_rejected() {
        let state = seeded();
        let scope = field_scope(BattleSide::Player, 0);

        let staged = stage_stance_request(&state, &scope, 7, identity(SPECIES_AEGISLASH, "blade"))
            .expect("stage");
        assert_eq!(staged.outcome, FormsOutcomeV2::RequestStaged);
        assert_eq!(staged.cues.len(), 1);
        assert!(
            staged
                .state
                .battler(&scope)
                .expect("battler")
                .pending_stance_request
                .is_some()
        );

        // Identical resubmission: idempotent, no new cue, equal state.
        let repeat = stage_stance_request(
            &staged.state,
            &scope,
            7,
            identity(SPECIES_AEGISLASH, "blade"),
        )
        .expect("idempotent restage");
        assert_eq!(repeat.outcome, FormsOutcomeV2::RequestAlreadyStaged);
        assert_eq!(repeat.cues.len(), 0);
        assert_eq!(repeat.state, staged.state);

        // Same id, different target: conflict rejection.
        let conflict = stage_stance_request(
            &staged.state,
            &scope,
            7,
            identity(SPECIES_AEGISLASH, "shield"),
        );
        assert_eq!(
            conflict.unwrap_err(),
            FormsTransitionError::StanceRequestConflict {
                staged_request_id: 7
            }
        );

        // Different id while pending: rejection naming the pending id.
        let busy = stage_stance_request(
            &staged.state,
            &scope,
            8,
            identity(SPECIES_AEGISLASH, "blade"),
        );
        assert_eq!(
            busy.unwrap_err(),
            FormsTransitionError::StanceRequestPending {
                pending_request_id: 7
            }
        );

        // Resolve swaps the presented form under a Stance overlay.
        let resolved = resolve_pending_stance(&staged.state, &scope).expect("resolve");
        assert_eq!(resolved.outcome, FormsOutcomeV2::Applied);
        let battler = resolved.state.battler(&scope).expect("battler");
        assert_eq!(battler.current.form_key, "blade");
        assert_eq!(battler.base.form_key, "shield");
        assert_eq!(
            battler.overlay,
            Some(FormOverlayV2 {
                kind: FormOverlayKindV2::Stance,
                current: identity(SPECIES_AEGISLASH, "blade"),
                tera_type_ordinal: None,
            })
        );

        // Repeated resolution: rejected, resolved state untouched.
        assert_eq!(
            resolve_pending_stance(&resolved.state, &scope).unwrap_err(),
            FormsTransitionError::NoStancePending
        );
        assert!(
            resolved
                .state
                .battler(&scope)
                .expect("battler")
                .pending_stance_request
                .is_none()
        );
    }

    #[test]
    fn stance_requests_are_validated_against_false_conditions() {
        let state = seeded();
        let scope = field_scope(BattleSide::Player, 0);
        // Cross-species stance target.
        assert_eq!(
            stage_stance_request(&state, &scope, 1, identity(SPECIES_CASTFORM, "sunny"))
                .unwrap_err(),
            FormsTransitionError::StanceCrossSpecies
        );
        // Target equals the currently presented form.
        assert_eq!(
            stage_stance_request(&state, &scope, 1, identity(SPECIES_AEGISLASH, "shield"))
                .unwrap_err(),
            FormsTransitionError::StanceTargetEqualsCurrent
        );
        // Zero request id.
        assert_eq!(
            stage_stance_request(&state, &scope, 0, identity(SPECIES_AEGISLASH, "blade"))
                .unwrap_err(),
            FormsTransitionError::ZeroStanceRequestId
        );
        // Unknown scope.
        assert_eq!(
            stage_stance_request(
                &state,
                &field_scope(BattleSide::Player, 2),
                1,
                identity(SPECIES_AEGISLASH, "blade")
            )
            .unwrap_err(),
            FormsTransitionError::UnknownBattlerScope
        );
        // Nothing above mutated the seed.
        assert_eq!(state.cues.len(), 0);
    }

    #[test]
    fn conditional_overlay_applies_idempotently_and_reverts() {
        let state = seeded();
        let scope = field_scope(BattleSide::Enemy, 0);

        let applied =
            apply_conditional_overlay(&state, &scope, identity(SPECIES_CASTFORM, "sunny"))
                .expect("apply");
        assert_eq!(applied.outcome, FormsOutcomeV2::Applied);
        assert_eq!(
            applied.state.battler(&scope).expect("b").current.form_key,
            "sunny"
        );

        // Same target again: false condition, no mutation, no cue.
        let repeat =
            apply_conditional_overlay(&applied.state, &scope, identity(SPECIES_CASTFORM, "sunny"))
                .expect("repeat apply");
        assert_eq!(repeat.outcome, FormsOutcomeV2::IdempotentNoOp);
        assert_eq!(repeat.cues.len(), 0);
        assert_eq!(repeat.state, applied.state);

        // A different weather replaces the reversible overlay.
        let switched =
            apply_conditional_overlay(&applied.state, &scope, identity(SPECIES_CASTFORM, "rainy"))
                .expect("switch weather");
        assert_eq!(switched.outcome, FormsOutcomeV2::Applied);
        assert_eq!(
            switched.state.battler(&scope).expect("b").current.form_key,
            "rainy"
        );

        // Revert returns to the stable base form; reverting again is a no-op.
        let reverted = revert_conditional_overlay(&switched.state, &scope).expect("revert");
        let battler = reverted.state.battler(&scope).expect("b");
        assert_eq!(battler.overlay, None);
        assert_eq!(battler.current.form_key, "forecast");
        let idle = revert_conditional_overlay(&reverted.state, &scope).expect("idle revert");
        assert_eq!(idle.outcome, FormsOutcomeV2::IdempotentNoOp);
        assert_eq!(idle.state, reverted.state);
    }

    #[test]
    fn mega_admission_is_one_time_and_survives_switch_cleanup() {
        let state = seeded();
        let scope = field_scope(BattleSide::Player, 0);

        let mega = admit_mega(&state, &scope, identity(SPECIES_AEGISLASH, "mega")).expect("mega");
        assert_eq!(mega.outcome, FormsOutcomeV2::Applied);
        let battler = mega.state.battler(&scope).expect("b");
        assert!(battler.mega_used);
        assert_eq!(battler.current.form_key, "mega");

        // Second admission: rejected one-time rule, no mutation.
        assert_eq!(
            admit_mega(&mega.state, &scope, identity(SPECIES_AEGISLASH, "mega")).unwrap_err(),
            FormsTransitionError::MegaAlreadyUsed
        );
        // Any overlay blocks a stance request while active.
        assert_eq!(
            stage_stance_request(&mega.state, &scope, 3, identity(SPECIES_AEGISLASH, "blade"))
                .unwrap_err(),
            FormsTransitionError::OverlayActive {
                active: FormOverlayKindV2::Mega
            }
        );

        // Switch cleanup lapses the overlay but the admission stays consumed.
        let cleaned = cleanup_on_switch(&mega.state, &scope).expect("cleanup");
        let battler = cleaned.state.battler(&scope).expect("b");
        assert_eq!(battler.overlay, None);
        assert_eq!(battler.current.form_key, "shield");
        assert!(battler.mega_used);
        assert_eq!(
            admit_mega(&cleaned.state, &scope, identity(SPECIES_AEGISLASH, "mega")).unwrap_err(),
            FormsTransitionError::MegaAlreadyUsed
        );
        // Cleanup again: nothing to lapse.
        let idle = cleanup_on_switch(&cleaned.state, &scope).expect("idle cleanup");
        assert_eq!(idle.outcome, FormsOutcomeV2::IdempotentNoOp);
        assert_eq!(idle.state, cleaned.state);
    }

    #[test]
    fn mega_admission_rejects_invalid_targets() {
        let state = seeded();
        let scope = field_scope(BattleSide::Player, 0);
        assert_eq!(
            admit_mega(&state, &scope, identity(SPECIES_CASTFORM, "mega")).unwrap_err(),
            FormsTransitionError::MegaCrossSpecies
        );
        assert_eq!(
            admit_mega(&state, &scope, identity(SPECIES_AEGISLASH, "shield")).unwrap_err(),
            FormsTransitionError::MegaTargetEqualsBase
        );
        assert_eq!(
            admit_mega(
                &state,
                &field_scope(BattleSide::Enemy, 1),
                identity(SPECIES_AEGISLASH, "mega")
            )
            .unwrap_err(),
            FormsTransitionError::UnknownBattlerScope
        );
    }

    #[test]
    fn tera_admission_consumes_side_budget_and_persists_through_switch() {
        let state = seeded();
        let scope = field_scope(BattleSide::Player, 0);

        let tera = admit_tera(&state, BattleSide::Player, &scope, 10).expect("tera");
        assert_eq!(tera.outcome, FormsOutcomeV2::Applied);
        assert_eq!(
            tera.state.teras_used(BattleSide::Player),
            TERAS_PER_SIDE_MAX
        );
        assert_eq!(
            tera.state.battler(&scope).expect("b").overlay,
            Some(FormOverlayV2 {
                kind: FormOverlayKindV2::Tera,
                current: identity(SPECIES_AEGISLASH, "shield"),
                tera_type_ordinal: Some(10),
            })
        );

        // Budget exhausted for the whole side (evidence: MAX_TERAS_PER_ARENA=1).
        assert_eq!(
            admit_tera(&tera.state, BattleSide::Player, &scope, 10).unwrap_err(),
            FormsTransitionError::TeraBudgetExhausted {
                side: BattleSide::Player
            }
        );
        // The enemy side still owns its own budget.
        let enemy_scope = field_scope(BattleSide::Enemy, 0);
        let enemy_tera =
            admit_tera(&tera.state, BattleSide::Enemy, &enemy_scope, 11).expect("enemy tera");
        assert_eq!(enemy_tera.state.teras_used(BattleSide::Enemy), 1);

        // Tera PERSISTS through switch-out: resetTera() runs only on faint
        // (src/phases/faint-phase.ts:202) and trainer-battle end
        // (src/battle-scene.ts:2440), never on switch.
        let cleaned = cleanup_on_switch(&enemy_tera.state, &scope).expect("cleanup");
        assert_eq!(cleaned.outcome, FormsOutcomeV2::IdempotentNoOp);
        assert_eq!(
            cleaned.state.battler(&scope).expect("b").overlay,
            Some(FormOverlayV2 {
                kind: FormOverlayKindV2::Tera,
                current: identity(SPECIES_AEGISLASH, "shield"),
                tera_type_ordinal: Some(10),
            })
        );
        // The side budget stays consumed until battle end.
        assert_eq!(
            cleaned.state.teras_used(BattleSide::Player),
            TERAS_PER_SIDE_MAX
        );
        assert_eq!(
            admit_tera(&cleaned.state, BattleSide::Player, &scope, 10).unwrap_err(),
            FormsTransitionError::TeraBudgetExhausted {
                side: BattleSide::Player
            }
        );
    }

    #[test]
    fn tera_admission_enforces_evidence_based_exclusions() {
        let state = seeded();
        let player = field_scope(BattleSide::Player, 0);
        let enemy = field_scope(BattleSide::Enemy, 0);

        // Mega blocks Tera (canSpeciesTera: isMega() || isMax() ...).
        let mega = admit_mega(&state, &player, identity(SPECIES_AEGISLASH, "mega")).expect("mega");
        assert_eq!(
            admit_tera(&mega.state, BattleSide::Player, &player, 0).unwrap_err(),
            FormsTransitionError::OverlayActive {
                active: FormOverlayKindV2::Mega
            }
        );

        // Ordinal above MAX_POKEMON_TYPE_ORDINAL (STELLAR = 19) is illegal.
        assert_eq!(
            admit_tera(&state, BattleSide::Player, &player, 20).unwrap_err(),
            FormsTransitionError::InvalidTeraTypeOrdinal
        );

        // Side/scope agreement is checked before any mutation.
        assert_eq!(
            admit_tera(&state, BattleSide::Enemy, &player, 0).unwrap_err(),
            FormsTransitionError::TeraSideMismatch {
                side: BattleSide::Enemy
            }
        );
        // Non-field scopes cannot carry a side-scoped admission.
        assert_eq!(
            admit_tera(&state, BattleSide::Player, &MechanicScope::Battle, 0).unwrap_err(),
            FormsTransitionError::ScopeNotFieldBattler
        );
        // A conditional overlay equally excludes Tera.
        let rainy = apply_conditional_overlay(&state, &enemy, identity(SPECIES_CASTFORM, "rainy"))
            .expect("weather");
        assert_eq!(
            admit_tera(&rainy.state, BattleSide::Enemy, &enemy, 0).unwrap_err(),
            FormsTransitionError::OverlayActive {
                active: FormOverlayKindV2::Conditional
            }
        );
        assert_eq!(rainy.state.teras_used(BattleSide::Enemy), 0);
    }

    #[test]
    fn switch_cleanup_discards_pending_stance_requests() {
        let state = seeded();
        let scope = field_scope(BattleSide::Player, 0);
        let staged = stage_stance_request(&state, &scope, 9, identity(SPECIES_AEGISLASH, "blade"))
            .expect("stage");
        let cleaned = cleanup_on_switch(&staged.state, &scope).expect("cleanup");
        assert_eq!(cleaned.outcome, FormsOutcomeV2::Applied);
        assert!(
            cleaned
                .state
                .battler(&scope)
                .expect("b")
                .pending_stance_request
                .is_none()
        );
        // The discarded request id frees the scope for a fresh request.
        let restaged = stage_stance_request(
            &cleaned.state,
            &scope,
            9,
            identity(SPECIES_AEGISLASH, "blade"),
        )
        .expect("restage");
        assert_eq!(restaged.outcome, FormsOutcomeV2::RequestStaged);
    }

    #[test]
    fn battle_end_cleanup_restores_pristine_canonical_state() {
        let mut state = seeded();
        let player = field_scope(BattleSide::Player, 0);
        let enemy = field_scope(BattleSide::Enemy, 0);
        state = admit_mega(&state, &player, identity(SPECIES_AEGISLASH, "mega"))
            .expect("mega")
            .state;
        state = admit_tera(&state, BattleSide::Enemy, &enemy, 19)
            .expect("stellar tera")
            .state;

        let ended = cleanup_battle_end(&state).expect("battle end");
        assert_eq!(ended.outcome, FormsOutcomeV2::Applied);
        assert_eq!(ended.cues.len(), 1);
        assert_eq!(ended.state.teras_used(BattleSide::Enemy), 0);
        assert!(
            ended
                .state
                .battlers
                .iter()
                .all(|battler| battler.overlay.is_none()
                    && battler.pending_stance_request.is_none()
                    && !battler.mega_used
                    && battler.current == battler.base)
        );
        ended.state.validate().expect("pristine state validates");

        // Ending an already-pristine battle is a no-op without cues.
        let idle = cleanup_battle_end(&ended.state).expect("idle battle end");
        assert_eq!(idle.outcome, FormsOutcomeV2::IdempotentNoOp);
        assert_eq!(idle.cues.len(), 0);
        assert_eq!(idle.state, ended.state);
    }

    #[test]
    fn transitions_never_mutate_their_input_state() {
        let state = seeded();
        let snapshot = state.clone();
        let player = field_scope(BattleSide::Player, 0);
        let enemy = field_scope(BattleSide::Enemy, 0);

        let _ = stage_stance_request(&state, &player, 1, identity(SPECIES_AEGISLASH, "blade"));
        let _ = apply_conditional_overlay(&state, &enemy, identity(SPECIES_CASTFORM, "sunny"));
        let _ = admit_mega(&state, &player, identity(SPECIES_AEGISLASH, "mega_x"));
        let _ = admit_tera(&state, BattleSide::Enemy, &enemy, 5);
        let _ = cleanup_on_switch(&state, &player);
        let _ = cleanup_battle_end(&state);

        assert_eq!(state, snapshot);
    }

    #[test]
    fn canonical_validation_rejects_corrupt_states() {
        let state = seeded();

        // Schema version drift.
        let mut corrupt = state.clone();
        corrupt.schema_version = FORMS_STATE_SCHEMA_VERSION + 1;
        assert_eq!(
            corrupt.validate().unwrap_err(),
            FormsStateError::SchemaVersion {
                expected: FORMS_STATE_SCHEMA_VERSION,
                actual: FORMS_STATE_SCHEMA_VERSION + 1,
            }
        );

        // Presented form diverging from base with no overlay.
        let mut corrupt = state.clone();
        corrupt.battlers[1].current.form_key = "ghost".into();
        assert_eq!(
            corrupt.validate().unwrap_err(),
            FormsStateError::CurrentFormMismatch
        );

        // Out-of-order battler scopes break canonical ordering.
        let mut corrupt = state.clone();
        corrupt.battlers.swap(0, 1);
        assert_eq!(
            corrupt.validate().unwrap_err(),
            FormsStateError::BattlersOutOfOrder
        );

        // Side Tera budget ceiling is enforced.
        let mut corrupt = state.clone();
        corrupt.teras_used_player_side = TERAS_PER_SIDE_MAX + 1;
        assert_eq!(
            corrupt.validate().unwrap_err(),
            FormsStateError::SideTeraBudgetExceeded
        );

        // Duplicate scope registration is rejected up front.
        assert_eq!(
            state
                .register_battler(
                    field_scope(BattleSide::Player, 0),
                    identity(SPECIES_AEGISLASH, "blade")
                )
                .unwrap_err(),
            FormsStateError::DuplicateScope
        );
    }

    #[test]
    fn species_registry_validates_closed_membership() {
        let registry =
            SpeciesFormRegistryV2::from_species_ids([70062u64, 1, 42]).expect("registry");
        assert_eq!(registry.len(), 3);
        assert!(registry.covers(1));
        assert!(registry.covers(42));
        assert!(registry.covers(70062));
        assert!(!registry.covers(43));
        assert!(!registry.covers(0));
        registry.validate().expect("sorted registry validates");

        // Duplicates and zero ids are contract failures.
        assert_eq!(
            SpeciesFormRegistryV2::from_species_ids([7u64, 7]).unwrap_err(),
            FormsStateError::DuplicateSpeciesEntry
        );
        assert_eq!(
            SpeciesFormRegistryV2::from_species_ids([0u64]).unwrap_err(),
            FormsStateError::ZeroSpecies
        );

        // Metadata lookup gates overlay admission on owned evidence.
        let missing = require_species_metadata(&registry, &identity(999, "shield"));
        assert!(missing.is_err());
        require_species_metadata(&registry, &identity(42, "shield")).expect("covered species");
    }

    /// Walks up from the crate manifest so the frozen cluster fixture
    /// resolves under any integration layout (crate dir, workspace root,
    /// or a relocated checkout that keeps `fixtures/m6` or
    /// `rust/fixtures/m6` on the ancestor chain).
    fn resolve_cluster_fixture() -> std::path::PathBuf {
        let mut dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        loop {
            for candidate in [
                dir.join("fixtures/m6/bespoke-clusters-v1.json"),
                dir.join("rust/fixtures/m6/bespoke-clusters-v1.json"),
            ] {
                if candidate.is_file() {
                    return candidate;
                }
            }
            if !dir.pop() {
                break;
            }
        }
        panic!(
            "frozen bespoke clusters fixture not found above {}",
            env!("CARGO_MANIFEST_DIR")
        );
    }

    #[test]
    fn custom_dispatch_species_subset_is_exactly_covered() {
        let raw = std::fs::read_to_string(resolve_cluster_fixture())
            .expect("frozen bespoke clusters fixture exists");
        let fixture: serde_json::Value = serde_json::from_str(&raw).expect("fixture parses");

        let clusters = fixture["clusters"].as_array().expect("clusters array");
        let dispatch = clusters
            .iter()
            .find(|cluster| cluster["cluster"] == "CUSTOM_DISPATCH")
            .expect("CUSTOM_DISPATCH cluster exists");
        let units = dispatch["behavior_units"].as_array().expect("units array");

        let species_units: Vec<&serde_json::Value> = units
            .iter()
            .filter(|unit| {
                unit["source"]["kind"] == "SPECIES" && unit["unit_kind"] == "SPECIES_FORM_BEHAVIOR"
            })
            .collect();

        // Exact frozen closure evidence: 2,018 units, each a distinct species.
        assert_eq!(species_units.len(), CUSTOM_DISPATCH_SPECIES_CLOSURE_COUNT);
        assert_eq!(CUSTOM_DISPATCH_SPECIES_CLOSURE_COUNT, 2018);

        let species_ids: Vec<u64> = species_units
            .iter()
            .map(|unit| {
                unit["source"]["numeric_id"]
                    .as_u64()
                    .expect("numeric species id")
            })
            .collect();
        assert_eq!(
            species_ids.len(),
            species_ids
                .iter()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
        );

        let exemplars: std::collections::BTreeSet<u64> =
            [1u64, 2u64, 3u64, 70062u64].into_iter().collect();
        assert!(exemplars.iter().all(|id| species_ids.contains(id)));

        // The canonical registry covers the entire subset losslessly.
        let registry = SpeciesFormRegistryV2::from_species_ids(species_ids.iter().copied())
            .expect("closure registry builds");
        registry.validate().expect("closure registry validates");
        assert_eq!(registry.len(), CUSTOM_DISPATCH_SPECIES_CLOSURE_COUNT);
        assert!(species_ids.iter().all(|id| registry.covers(*id)));

        // The remaining CUSTOM_DISPATCH groups belong to other families.
        let residual = units.len() - species_units.len();
        assert_eq!(residual, 1269);
    }

    #[test]
    fn presentation_ledger_is_deterministic_and_ordered() {
        let mut state = seeded();
        let player = field_scope(BattleSide::Player, 0);
        state = stage_stance_request(&state, &player, 1, identity(SPECIES_AEGISLASH, "blade"))
            .expect("stage")
            .state;
        state = resolve_pending_stance(&state, &player)
            .expect("resolve")
            .state;
        state = cleanup_on_switch(&state, &player).expect("cleanup").state;

        let ordinals: Vec<u64> = presentation_cues(&state)
            .iter()
            .map(|cue| cue.ordinal)
            .collect();
        assert_eq!(ordinals, vec![1, 2, 3, 4]);
        let kinds: Vec<FormCueKindV2> = presentation_cues(&state)
            .iter()
            .map(|cue| cue.kind)
            .collect();
        assert_eq!(
            kinds,
            vec![
                FormCueKindV2::StanceRequestStaged,
                FormCueKindV2::OverlayApplied(FormOverlayKindV2::Stance),
                FormCueKindV2::OverlayReverted(FormOverlayKindV2::Stance),
                FormCueKindV2::SwitchCleanup,
            ]
        );
        state.validate().expect("cue ledger validates");
    }

    #[test]
    fn battler_entry_shape_is_canonical() {
        let state = seeded();
        let battler = state
            .battler(&field_scope(BattleSide::Player, 0))
            .expect("b");
        assert!(matches!(battler, FormsBattlerStateV2 { .. }));
        assert_eq!(battler.base, battler.current);
        assert!(!battler.mega_used);
        assert!(battler.overlay.is_none());
        assert!(battler.pending_stance_request.is_none());
    }
}
