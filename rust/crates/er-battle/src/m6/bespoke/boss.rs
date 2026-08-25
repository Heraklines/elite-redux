//! Pure mechanics and transitions for the closed `BOSS_CUSTOM_ER` bespoke
//! family, plus the central fixed-dispatch registry over the `CUSTOM_DISPATCH`
//! BESPOKE behavior-unit surface.
//!
//! Every transition consumes typed canonical state, validates inputs, clones,
//! applies, re-validates, and returns updated state with ordered evidence.
//! Inputs are never mutated, including on error. No callbacks, trait-object
//! scripting, raw semantic commands, or process-global RNG live here: the
//! single frozen boss draw (`boss.randBattleSeedInt(6)` at
//! `er-trainer-runtime-hook.ts:938:17`) admits externally supplied, audited
//! results only.

use std::collections::BTreeSet;

use er_state::bespoke_v2::boss::{
    boss_owner_unit, frozen_rng_site_id, BossCustomErStateV1, BossStateErrorV1,
    CustomDispatchRegistryErrorV1, CustomDispatchRegistryV1, DispatchRouteEntryV1,
    FixedDispatchHandlerKindV1, BOSS_FROZEN_RNG_CARDINALITY,
    CUSTOM_DISPATCH_REGISTRY_SCHEMA_VERSION,
};
use er_types::{BehaviorUnitId, ProvenanceHash, RngSiteId, SafeU53};
use thiserror::Error;

// ---------------------------------------------------------------------------
// Ordered evidence
// ---------------------------------------------------------------------------

/// One observed boss-family effect in deterministic execution order.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BossEvidenceKindV1 {
    /// One or more boss bars were lost to a single damage application.
    SegmentLost { from: u8, to: u8 },
    /// A one-time threshold trigger fired (recorded in the ledger).
    TriggerFired { trigger_id: u32 },
    /// The boss entered a new phase.
    PhaseChanged { from: u8, to: u8 },
    /// A phase entry granted (or replaced with) an active shield.
    ShieldGained { charges: u8 },
    /// One shield charge was consumed.
    ShieldConsumed { remaining: u8 },
    /// An audited draw at the frozen site passed admission.
    RngAdmitted { sequence: SafeU53, result: SafeU53 },
    /// Terminal cleanup ran; transient surfaces cleared, audit retained.
    Retired,
}

/// Evidence entry carrying its creation-order ordinal (starting at 1).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BossEvidenceV1 {
    pub ordinal: SafeU53,
    pub kind: BossEvidenceKindV1,
}

fn ordain(kinds: Vec<BossEvidenceKindV1>) -> Vec<BossEvidenceV1> {
    kinds
        .into_iter()
        .enumerate()
        .map(|(index, kind)| BossEvidenceV1 {
            ordinal: SafeU53::new(index as u64 + 1).unwrap_or(SafeU53::ZERO),
            kind,
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Closed failures for every boss-family transition.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum BossMechanicErrorV1 {
    #[error("boss canonical state is invalid: {0}")]
    State(#[from] BossStateErrorV1),
    #[error("boss damage must be positive")]
    ZeroDamage,
    #[error("boss max HP must be positive")]
    ZeroMaxHp,
    #[error("current HP {current} exceeds max HP {max}")]
    CurrentHpAboveMax { current: u32, max: u32 },
    #[error("retired boss state rejects every further transition")]
    AlreadyTerminal,
    #[error("the boss shield is not active")]
    ShieldInactive,
    #[error("RNG admission owner is not the frozen boss behavior unit")]
    RngOwnerMismatch,
    #[error("RNG admission site is not the frozen boss RNG site")]
    RngSiteMismatch,
    #[error("RNG admission cardinality must be {expected}, got {actual}")]
    RngCardinalityMismatch { expected: u64, actual: u64 },
    #[error("RNG result {result} is outside the closed range of {cardinality}")]
    RngResultOutOfRange { cardinality: u64, result: u64 },
    #[error(
        "RNG admission sequence {sequence} does not advance past {previous}"
    )]
    RngSequenceNotAdvancing { sequence: u64, previous: u64 },
    #[error("RNG admission ledger cannot grow any further")]
    RngAdmissionOverflow,
    #[error("scripted action slot {slot} is not part of the phase plan")]
    UnknownScriptedSlot { slot: u8 },
}

// ---------------------------------------------------------------------------
// Damage, thresholds, phases, shields
// ---------------------------------------------------------------------------

/// Output of one atomic damage application against the boss surface.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BossDamageTransitionV1 {
    pub state: BossCustomErStateV1,
    /// Remaining HP after saturating subtraction; never below zero.
    pub hp_after: u32,
    /// Effects in deterministic order: segment loss, then each fired
    /// boundary in canonical crossing order (trigger, phase, shield).
    pub evidence: Vec<BossEvidenceV1>,
}

/// Exact crossing predicate: the HP fraction moved from strictly above the
/// boundary to at-or-below it, computed without division.
fn boundary_crossed(
    hp_before: u32,
    hp_after: u32,
    max_hp: u32,
    numerator: u32,
    denominator: u32,
) -> bool {
    let before = u64::from(hp_before) * u64::from(denominator);
    let after = u64::from(hp_after) * u64::from(denominator);
    let point = u64::from(numerator) * u64::from(max_hp);
    before > point && after <= point
}

/// Remaining boss bars: ceiling of `hp / max_hp * segments_total`.
fn segment_count(hp: u32, max_hp: u32, segments_total: u8) -> u8 {
    let scaled = (u64::from(hp) * u64::from(segments_total) + u64::from(max_hp) - 1)
        / u64::from(max_hp);
    scaled.min(u64::from(segments_total)) as u8
}

/// Applies one damage amount against the boss and resolves every resulting
/// threshold crossing, including multi-threshold hits, in canonical order.
///
/// Crossing a boundary fires its one-time trigger exactly once across the
/// battle: later damage at or beyond an already-fired boundary is inert.
pub fn apply_boss_damage(
    state: &BossCustomErStateV1,
    damage: u32,
    current_hp: u32,
    max_hp: u32,
) -> Result<BossDamageTransitionV1, BossMechanicErrorV1> {
    state.validate()?;
    if state.terminal {
        return Err(BossMechanicErrorV1::AlreadyTerminal);
    }
    if damage == 0 {
        return Err(BossMechanicErrorV1::ZeroDamage);
    }
    if max_hp == 0 {
        return Err(BossMechanicErrorV1::ZeroMaxHp);
    }
    if current_hp > max_hp {
        return Err(BossMechanicErrorV1::CurrentHpAboveMax { current: current_hp, max: max_hp });
    }

    let hp_after = current_hp.saturating_sub(damage);
    let mut updated = state.clone();
    let mut kinds = Vec::new();

    let segments_after = segment_count(hp_after, max_hp, updated.segments_total);
    if segments_after < updated.segments_remaining {
        kinds.push(BossEvidenceKindV1::SegmentLost {
            from: updated.segments_remaining,
            to: segments_after,
        });
        updated.segments_remaining = segments_after;
    }

    for boundary in &state.boundaries {
        if updated.fired_triggers.contains(&boundary.trigger_id) {
            continue;
        }
        if !boundary_crossed(
            current_hp,
            hp_after,
            max_hp,
            boundary.hp_fraction_numerator,
            boundary.hp_fraction_denominator,
        ) {
            continue;
        }
        kinds.push(BossEvidenceKindV1::TriggerFired {
            trigger_id: boundary.trigger_id,
        });
        updated.fired_triggers.push(boundary.trigger_id);
        if updated.current_phase != boundary.phase_index {
            kinds.push(BossEvidenceKindV1::PhaseChanged {
                from: updated.current_phase,
                to: boundary.phase_index,
            });
            updated.current_phase = boundary.phase_index;
        }
        updated.shield_charges = boundary.shield_charges;
        updated.shield_active = updated.shield_charges > 0;
        if updated.shield_active {
            kinds.push(BossEvidenceKindV1::ShieldGained {
                charges: updated.shield_charges,
            });
        }
    }

    updated.validate()?;
    Ok(BossDamageTransitionV1 {
        state: updated,
        hp_after,
        evidence: ordain(kinds),
    })
}

/// Output of consuming one shield charge.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BossShieldTransitionV1 {
    pub state: BossCustomErStateV1,
    pub evidence: Vec<BossEvidenceV1>,
}

/// Consumes exactly one shield charge deterministically; the shield
/// deactivates when the last charge goes.
pub fn consume_boss_shield_charge(
    state: &BossCustomErStateV1,
) -> Result<BossShieldTransitionV1, BossMechanicErrorV1> {
    state.validate()?;
    if state.terminal {
        return Err(BossMechanicErrorV1::AlreadyTerminal);
    }
    if !state.shield_active || state.shield_charges == 0 {
        return Err(BossMechanicErrorV1::ShieldInactive);
    }
    let mut updated = state.clone();
    updated.shield_charges -= 1;
    updated.shield_active = updated.shield_charges > 0;
    updated.validate()?;
    Ok(BossShieldTransitionV1 {
        state: updated,
        evidence: ordain(vec![BossEvidenceKindV1::ShieldConsumed {
            remaining: updated.shield_charges,
        }]),
    })
}

// ---------------------------------------------------------------------------
// Scripted action eligibility
// ---------------------------------------------------------------------------

/// Deterministic scripted-action selection outcome for one request.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BossScriptedActionDecisionV1 {
    /// The current phase has unlocked the slot; the scripted action may run.
    Unlocked { slot: u8 },
    /// The slot exists in the plan but no fired boundary has unlocked it yet.
    Locked { slot: u8 },
    /// Terminal bosses select nothing.
    Terminal,
}

/// Resolves scripted-action eligibility for one requested slot.
///
/// Selection boundaries: slots outside the plan are hard errors; known-but-
/// locked slots are denied decisions, not errors; terminal states deny.
pub fn decide_boss_scripted_action(
    state: &BossCustomErStateV1,
    requested_slot: u8,
) -> Result<BossScriptedActionDecisionV1, BossMechanicErrorV1> {
    state.validate()?;
    if state.terminal {
        return Ok(BossScriptedActionDecisionV1::Terminal);
    }
    let planned = state
        .boundaries
        .iter()
        .filter_map(|boundary| boundary.scripted_action_slot);
    if !planned.clone().any(|slot| slot == requested_slot) {
        return Err(BossMechanicErrorV1::UnknownScriptedSlot {
            slot: requested_slot,
        });
    }
    if state.unlocked_scripted_slots().contains(&requested_slot) {
        Ok(BossScriptedActionDecisionV1::Unlocked {
            slot: requested_slot,
        })
    } else {
        Ok(BossScriptedActionDecisionV1::Locked {
            slot: requested_slot,
        })
    }
}

// ---------------------------------------------------------------------------
// Audited RNG admission at the frozen boss site
// ---------------------------------------------------------------------------

/// An externally supplied, already-audited draw result offered for admission
/// at the frozen boss RNG site. The battle core never draws here itself.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BossRngAdmissionV1 {
    pub owner: BehaviorUnitId,
    pub site: RngSiteId,
    /// Requested range cardinality; must equal the frozen literal `6`.
    pub cardinality: SafeU53,
    /// Monotone audit sequence proving the draw happened in order.
    pub sequence: SafeU53,
    pub result: SafeU53,
}

/// Output of one admitted draw.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BossRngTransitionV1 {
    pub state: BossCustomErStateV1,
    pub evidence: Vec<BossEvidenceV1>,
}

/// Admits one audited draw result into the boss ledger.
///
/// Admission fails closed on any identity drift (owner, site), range drift
/// (cardinality or result outside `6`), ordering violation, or retired state.
pub fn admit_boss_rng_draw(
    state: &BossCustomErStateV1,
    admission: &BossRngAdmissionV1,
) -> Result<BossRngTransitionV1, BossMechanicErrorV1> {
    state.validate()?;
    if state.terminal {
        return Err(BossMechanicErrorV1::AlreadyTerminal);
    }
    if admission.owner != boss_owner_unit() {
        return Err(BossMechanicErrorV1::RngOwnerMismatch);
    }
    if admission.site != frozen_rng_site_id() {
        return Err(BossMechanicErrorV1::RngSiteMismatch);
    }
    if admission.cardinality.get() != BOSS_FROZEN_RNG_CARDINALITY {
        return Err(BossMechanicErrorV1::RngCardinalityMismatch {
            expected: BOSS_FROZEN_RNG_CARDINALITY,
            actual: admission.cardinality.get(),
        });
    }
    if admission.result.get() >= admission.cardinality.get() {
        return Err(BossMechanicErrorV1::RngResultOutOfRange {
            cardinality: admission.cardinality.get(),
            result: admission.result.get(),
        });
    }
    if let Some(previous) = state.last_rng_sequence {
        if admission.sequence.get() <= previous.get() {
            return Err(BossMechanicErrorV1::RngSequenceNotAdvancing {
                sequence: admission.sequence.get(),
                previous: previous.get(),
            });
        }
    }
    let mut updated = state.clone();
    updated.rng_admissions = updated
        .rng_admissions
        .checked_add(1)
        .ok_or(BossMechanicErrorV1::RngAdmissionOverflow)?;
    updated.last_rng_sequence = Some(admission.sequence);
    updated.last_rng_result = Some(admission.result);
    updated.validate()?;
    Ok(BossRngTransitionV1 {
        state: updated,
        evidence: ordain(vec![BossEvidenceKindV1::RngAdmitted {
            sequence: admission.sequence,
            result: admission.result,
        }]),
    })
}

// ---------------------------------------------------------------------------
// Terminal cleanup
// ---------------------------------------------------------------------------

/// Output of terminal cleanup.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BossRetirementTransitionV1 {
    pub state: BossCustomErStateV1,
    pub evidence: Vec<BossEvidenceV1>,
}

/// Runs one-time terminal cleanup: clears transient shield state, keeps the
/// trigger ledger and RNG audit trail intact, and freezes the state against
/// every further transition.
pub fn retire_boss_state(
    state: &BossCustomErStateV1,
) -> Result<BossRetirementTransitionV1, BossMechanicErrorV1> {
    state.validate()?;
    if state.terminal {
        return Err(BossMechanicErrorV1::AlreadyTerminal);
    }
    let mut updated = state.clone();
    updated.shield_active = false;
    updated.shield_charges = 0;
    updated.terminal = true;
    updated.validate()?;
    Ok(BossRetirementTransitionV1 {
        state: updated,
        evidence: ordain(vec![BossEvidenceKindV1::Retired]),
    })
}

// ---------------------------------------------------------------------------
// Central fixed-dispatch registry (CUSTOM_DISPATCH BESPOKE surface)
// ---------------------------------------------------------------------------

/// Gross-set identity of one `CUSTOM_DISPATCH` BESPOKE behavior unit.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DispatchUnitIdentityV1 {
    pub provenance_hash: ProvenanceHash,
    pub registry_key: String,
}

/// Closed failures while building the central registry.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum DispatchRegistryBuildErrorV1 {
    #[error("dispatch registry invariant violated: {0}")]
    Validation(#[from] CustomDispatchRegistryErrorV1),
    #[error(
        "duplicate behavior unit identity {}",
        provenance_hash.as_str()
    )]
    DuplicateUnit { provenance_hash: ProvenanceHash },
    #[error(
        "sibling exclusion {} is not part of the gross set",
        provenance_hash.as_str()
    )]
    UnknownSiblingExclusion { provenance_hash: ProvenanceHash },
    #[error(
        "behavior unit {} has no closed handler classification",
        provenance_hash.as_str()
    )]
    UnclassifiedUnit { provenance_hash: ProvenanceHash },
}

/// Classifies one frozen registry key into its closed handler kind.
///
/// Classification is a pure function of key shape: `RNG:` sites split by
/// callee, `attr:` registrations split by ability versus move attribute, and
/// bare dispatcher callees split by dispatch surface. Anything else is a
/// residual and must fail the build.
pub fn classify_dispatch_registry_key(
    registry_key: &str,
) -> Result<FixedDispatchHandlerKindV1, ()> {
    if let Some(site) = registry_key.strip_prefix("RNG:") {
        let callee = site.rsplit(':').next().ok_or(())?;
        return if callee.ends_with(".randBattleSeedInt") || callee == "randBattleSeedInt" {
            Ok(FixedDispatchHandlerKindV1::BattleSeedDraw)
        } else if callee == "randSeedShuffle" {
            Ok(FixedDispatchHandlerKindV1::SeedShuffle)
        } else if callee == "randSeedInt" {
            Ok(FixedDispatchHandlerKindV1::RunSeedDraw)
        } else if callee == "localRng?.integerInRange" {
            Ok(FixedDispatchHandlerKindV1::LocalRangeDraw)
        } else if callee == "Math.random" {
            Ok(FixedDispatchHandlerKindV1::NondeterministicSourceRejected)
        } else {
            Err(())
        };
    }
    if let Some(attr_name) = registry_key.rsplit(":attr:").next() {
        if registry_key.contains(":attr:") {
            return if attr_name.ends_with("AbAttr") {
                Ok(FixedDispatchHandlerKindV1::AbilityAttributeRegistration)
            } else {
                Ok(FixedDispatchHandlerKindV1::MoveAttributeRegistration)
            };
        }
    }
    let callee = registry_key.rsplit(':').next().ok_or(())?;
    if callee == "applyAbAttrs" || callee == "applyFilteredAbAttrs" {
        Ok(FixedDispatchHandlerKindV1::AbilityAttributeDispatch)
    } else if callee == "applyMoveAttrs" {
        Ok(FixedDispatchHandlerKindV1::MoveAttributeDispatch)
    } else if callee.starts_with("globalScene.applyModifier") {
        Ok(FixedDispatchHandlerKindV1::ModifierDispatch)
    } else {
        Err(())
    }
}

/// Builds the canonical central registry from the gross `BESPOKE` unit set
/// and the exact sibling claims.
///
/// Deterministic construction: duplicates collide, unknown exclusions reject,
/// every remaining unit classifies or the build fails naming the residual,
/// and the finished registry conserves the gross count exactly.
pub fn build_custom_dispatch_registry(
    gross_units: &[DispatchUnitIdentityV1],
    sibling_exclusions: &BTreeSet<ProvenanceHash>,
) -> Result<CustomDispatchRegistryV1, DispatchRegistryBuildErrorV1> {
    let mut seen = BTreeSet::new();
    for unit in gross_units {
        if !seen.insert(unit.provenance_hash.as_str()) {
            return Err(DispatchRegistryBuildErrorV1::DuplicateUnit {
                provenance_hash: unit.provenance_hash.clone(),
            });
        }
    }
    for exclusion in sibling_exclusions {
        if !seen.contains(exclusion.as_str()) {
            return Err(DispatchRegistryBuildErrorV1::UnknownSiblingExclusion {
                provenance_hash: exclusion.clone(),
            });
        }
    }
    let mut classified: Vec<&DispatchUnitIdentityV1> = gross_units
        .iter()
        .filter(|unit| !sibling_exclusions.contains(&unit.provenance_hash))
        .collect();
    classified.sort_by(|left, right| left.provenance_hash.cmp(&right.provenance_hash));

    let mut routes = Vec::new();
    let mut rejected_nondeterministic = Vec::new();
    for unit in classified {
        match classify_dispatch_registry_key(&unit.registry_key) {
            Ok(handler) if handler.is_reject_kind() => {
                rejected_nondeterministic.push(unit.provenance_hash.clone());
            }
            Ok(handler) => routes.push(DispatchRouteEntryV1 {
                provenance_hash: unit.provenance_hash.clone(),
                registry_key: unit.registry_key.clone(),
                handler,
            }),
            Err(()) => {
                return Err(DispatchRegistryBuildErrorV1::UnclassifiedUnit {
                    provenance_hash: unit.provenance_hash.clone(),
                });
            }
        }
    }
    rejected_nondeterministic.sort();
    let registry = CustomDispatchRegistryV1 {
        schema_version: CUSTOM_DISPATCH_REGISTRY_SCHEMA_VERSION,
        gross_unit_count: u32::try_from(seen.len()).unwrap_or(u32::MAX),
        sibling_exclusions: sibling_exclusions.iter().cloned().collect(),
        rejected_nondeterministic,
        routes,
    };
    registry.validate()?;
    Ok(registry)
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_state::bespoke_v2::boss::{BossPhaseBoundaryV1, BOSS_MAX_SHIELD_CHARGES};
    use er_types::mechanics::MechanicScope;
    use er_types::{PokemonId, RngSiteOrdinal};
    use std::collections::BTreeMap;

    const OWNER_HASH: &str =
        "b0fe628993091a058fd71026b19ee1981ae457afe37823435c9cbb3c9b5e2787";
    const SITE_HASH: &str =
        "8b45ad4919d6e3b96286ddf9560b7ac4dc41fef80883fed673a31b84a475090b";

    fn subject() -> MechanicScope {
        MechanicScope::Pokemon {
            pokemon: PokemonId::new(SafeU53::new(1).expect("valid id")),
        }
    }

    fn boundary(trigger_id: u32, numerator: u32, denominator: u32, phase: u8, slot: Option<u8>) -> BossPhaseBoundaryV1 {
        BossPhaseBoundaryV1 {
            trigger_id,
            hp_fraction_numerator: numerator,
            hp_fraction_denominator: denominator,
            phase_index: phase,
            shield_charges: 0,
            scripted_action_slot: slot,
        }
    }

    fn two_boundary_state() -> BossCustomErStateV1 {
        let mut state = BossCustomErStateV1::new(
            subject(),
            3,
            vec![
                boundary(11, 1, 2, 1, Some(4)),
                boundary(12, 1, 4, 2, Some(7)),
            ],
        );
        state.boundaries[0].shield_charges = 2;
        state
    }

    fn admission(sequence: u64, result: u64) -> BossRngAdmissionV1 {
        BossRngAdmissionV1 {
            owner: boss_owner_unit(),
            site: frozen_rng_site_id(),
            cardinality: SafeU53::new(6).expect("six"),
            sequence: SafeU53::new(sequence).expect("sequence"),
            result: SafeU53::new(result).expect("result"),
        }
    }

    #[test]
    fn multi_threshold_damage_fires_both_boundaries_in_order() {
        let state = two_boundary_state();
        // 1000 max HP, drop from full to 200: crosses 1/2 (500) and 1/4 (250).
        let transition =
            apply_boss_damage(&state, 800, 1000, 1000).expect("damage transition");
        assert_eq!(transition.hp_after, 200);
        assert_eq!(transition.state.segments_remaining, 1);
        assert_eq!(transition.state.current_phase, 2);
        assert!(transition.state.shield_active);
        let fired: Vec<_> = transition
            .evidence
            .iter()
            .map(|entry| entry.kind.clone())
            .collect();
        assert_eq!(
            fired,
            vec![
                BossEvidenceKindV1::SegmentLost { from: 3, to: 1 },
                BossEvidenceKindV1::TriggerFired { trigger_id: 11 },
                BossEvidenceKindV1::PhaseChanged { from: 0, to: 1 },
                BossEvidenceKindV1::ShieldGained { charges: 2 },
                BossEvidenceKindV1::TriggerFired { trigger_id: 12 },
                BossEvidenceKindV1::PhaseChanged { from: 1, to: 2 },
            ]
        );
        let ordinals: Vec<u64> = transition
            .evidence
            .iter()
            .map(|entry| entry.ordinal.get())
            .collect();
        assert_eq!(ordinals, vec![1, 2, 3, 4, 5, 6]);
    }

    #[test]
    fn already_fired_threshold_never_refires() {
        let state = two_boundary_state();
        let first =
            apply_boss_damage(&state, 600, 1000, 1000).expect("first damage");
        // Back above the half line, then cross it again: the trigger stays
        // consumed and no phase/shield replay happens.
        let second = apply_boss_damage(&first.state, 100, 400, 1000)
            .expect("second damage");
        assert_eq!(second.state.fired_triggers, vec![11]);
        assert_eq!(second.state.current_phase, 1);
        assert!(matches!(
            second.evidence.first().map(|entry| entry.kind.clone()),
            Some(BossEvidenceKindV1::SegmentLost { .. })
        ));
        assert_eq!(second.evidence.len(), 1);
    }

    #[test]
    fn invalid_damage_inputs_leave_input_unchanged() {
        let state = two_boundary_state();
        let snapshot = state.clone();
        assert_eq!(
            apply_boss_damage(&state, 0, 1000, 1000),
            Err(BossMechanicErrorV1::ZeroDamage)
        );
        assert_eq!(
            apply_boss_damage(&state, 10, 1001, 1000),
            Err(BossMechanicErrorV1::CurrentHpAboveMax {
                current: 1001,
                max: 1000
            })
        );
        assert_eq!(
            apply_boss_damage(&state, 10, 500, 0),
            Err(BossMechanicErrorV1::ZeroMaxHp)
        );
        assert_eq!(state, snapshot);
    }

    #[test]
    fn shield_consumption_is_deterministic_and_exhaustible() {
        let state = two_boundary_state();
        let damaged = apply_boss_damage(&state, 600, 1000, 1000).expect("damage");
        assert_eq!(damaged.state.shield_charges, 2);
        let first = consume_boss_shield_charge(&damaged.state).expect("consume");
        assert_eq!(first.state.shield_charges, 1);
        let second = consume_boss_shield_charge(&first.state).expect("consume");
        assert_eq!(second.state.shield_charges, 0);
        assert!(!second.state.shield_active);
        assert!(matches!(
            second.evidence.first().map(|entry| entry.kind.clone()),
            Some(BossEvidenceKindV1::ShieldConsumed { remaining: 0 })
        ));
        assert_eq!(
            consume_boss_shield_charge(&second.state),
            Err(BossMechanicErrorV1::ShieldInactive)
        );
    }

    #[test]
    fn scripted_selection_respects_plan_boundaries() {
        let state = two_boundary_state();
        // Slot 9 is not part of any boundary plan: hard error.
        assert_eq!(
            decide_boss_scripted_action(&state, 9),
            Err(BossMechanicErrorV1::UnknownScriptedSlot { slot: 9 })
        );
        // Slot 4 is planned but phase 0 has unlocked nothing yet.
        assert_eq!(
            decide_boss_scripted_action(&state, 4),
            Ok(BossScriptedActionDecisionV1::Locked { slot: 4 })
        );
        let damaged = apply_boss_damage(&state, 600, 1000, 1000).expect("damage");
        assert_eq!(
            decide_boss_scripted_action(&damaged.state, 4),
            Ok(BossScriptedActionDecisionV1::Unlocked { slot: 4 })
        );
        assert_eq!(
            decide_boss_scripted_action(&damaged.state, 7),
            Ok(BossScriptedActionDecisionV1::Locked { slot: 7 })
        );
        let deeper =
            apply_boss_damage(&damaged.state, 300, 400, 1000).expect("damage");
        assert_eq!(
            decide_boss_scripted_action(&deeper.state, 7),
            Ok(BossScriptedActionDecisionV1::Unlocked { slot: 7 })
        );
    }

    #[test]
    fn rng_admission_rejects_every_drift_without_mutating_input() {
        let state = two_boundary_state();
        let snapshot = state.clone();

        let mut drifted = admission(10, 3);
        drifted.owner = er_types::BehaviorUnitId {
            source: er_types::BehaviorSourceId::Bespoke {
                registry_key: String::from("RNG:other"),
            },
            unit_kind: er_types::BehaviorUnitKind::FixedDispatchBehavior,
            ordinal: er_types::BehaviorUnitOrdinal::ZERO,
            provenance_hash: ProvenanceHash::parse(OWNER_HASH).expect("hash"),
        };
        assert_eq!(
            admit_boss_rng_draw(&state, &drifted),
            Err(BossMechanicErrorV1::RngOwnerMismatch)
        );

        let wrong_site = BossRngAdmissionV1 {
            site: er_types::RngSiteId {
                ordinal: RngSiteOrdinal::new(99),
                provenance_hash: ProvenanceHash::parse(SITE_HASH).expect("hash"),
            },
            ..admission(10, 3)
        };
        assert_eq!(
            admit_boss_rng_draw(&state, &wrong_site),
            Err(BossMechanicErrorV1::RngSiteMismatch)
        );

        let wrong_cardinality = BossRngAdmissionV1 {
            cardinality: SafeU53::new(100).expect("hundred"),
            ..admission(10, 3)
        };
        assert_eq!(
            admit_boss_rng_draw(&state, &wrong_cardinality),
            Err(BossMechanicErrorV1::RngCardinalityMismatch {
                expected: 6,
                actual: 100
            })
        );

        let out_of_range = BossRngAdmissionV1 {
            result: SafeU53::new(6).expect("six"),
            ..admission(10, 6)
        };
        assert_eq!(
            admit_boss_rng_draw(&state, &out_of_range),
            Err(BossMechanicErrorV1::RngResultOutOfRange {
                cardinality: 6,
                result: 6
            })
        );

        assert!(admit_boss_rng_draw(&state, &admission(10, 3)).is_ok());
        assert_eq!(
            admit_boss_rng_draw(&state, &admission(10, 3)),
            Err(BossMechanicErrorV1::RngSequenceNotAdvancing {
                sequence: 10,
                previous: 10
            })
        );
        assert_eq!(state, snapshot);
    }

    #[test]
    fn rng_admission_accepts_advancing_audited_results() {
        let state = two_boundary_state();
        let first = admit_boss_rng_draw(&state, &admission(5, 2)).expect("admit");
        assert_eq!(first.state.rng_admissions, 1);
        let second =
            admit_boss_rng_draw(&first.state, &admission(6, 5)).expect("admit");
        assert_eq!(second.state.rng_admissions, 2);
        assert_eq!(second.state.last_rng_result.map(|value| value.get()), Some(5));
    }

    #[test]
    fn terminal_cleanup_runs_once_and_freezes_state() {
        let state = two_boundary_state();
        let damaged = apply_boss_damage(&state, 600, 1000, 1000).expect("damage");
        let admitted =
            admit_boss_rng_draw(&damaged.state, &admission(5, 2)).expect("admit");
        let retired = retire_boss_state(&admitted.state).expect("retire");
        assert!(retired.state.terminal);
        assert!(!retired.state.shield_active);
        assert_eq!(retired.state.shield_charges, 0);
        assert_eq!(retired.state.fired_triggers, vec![11]);
        assert_eq!(retired.state.rng_admissions, 1);
        assert_eq!(
            retire_boss_state(&retired.state),
            Err(BossMechanicErrorV1::AlreadyTerminal)
        );
        assert_eq!(
            apply_boss_damage(&retired.state, 10, 500, 1000),
            Err(BossMechanicErrorV1::AlreadyTerminal)
        );
        assert_eq!(
            decide_boss_scripted_action(&retired.state, 4),
            Ok(BossScriptedActionDecisionV1::Terminal)
        );
    }

    #[test]
    fn invalid_canonical_state_is_rejected_before_any_transition() {
        let mut state = two_boundary_state();
        state.schema_version = 99;
        assert!(matches!(
            apply_boss_damage(&state, 10, 500, 1000),
            Err(BossMechanicErrorV1::State(
                BossStateErrorV1::SchemaVersion { .. }
            ))
        ));
    }

    #[test]
    fn shield_ceiling_is_enforced_in_canonical_state() {
        let mut state = two_boundary_state();
        state.boundaries[0].shield_charges = BOSS_MAX_SHIELD_CHARGES + 1;
        assert!(matches!(
            state.validate(),
            Err(BossStateErrorV1::ShieldChargesAboveCeiling { .. })
        ));
    }

    // -- Central fixed-dispatch registry -----------------------------------

    fn unit(hash: &str, key: &str) -> DispatchUnitIdentityV1 {
        DispatchUnitIdentityV1 {
            provenance_hash: ProvenanceHash::parse(hash).expect("fixture hash"),
            registry_key: String::from(key),
        }
    }

    fn sample_gross_set() -> Vec<DispatchUnitIdentityV1> {
        vec![
            unit(
                "aa00000000000000000000000000000000000000000000000000000000000001",
                "RNG:src/data/elite-redux/er-trainer-runtime-hook.ts:938:17:boss.randBattleSeedInt",
            ),
            unit(
                "aa00000000000000000000000000000000000000000000000000000000000002",
                "RNG:src/data/elite-redux/coop/coop-session-controller.ts:508:38:Math.random",
            ),
            unit(
                "aa00000000000000000000000000000000000000000000000000000000000003",
                "RNG:src/data/elite-redux/er-quiz.ts:401:24:randSeedInt",
            ),
            unit(
                "aa00000000000000000000000000000000000000000000000000000000000004",
                "RNG:src/data/elite-redux/er-quiz.ts:77:29:randSeedShuffle",
            ),
            unit(
                "aa00000000000000000000000000000000000000000000000000000000000005",
                "RNG:src/data/elite-redux/er-bargain-sins.ts:96:34:localRng?.integerInRange",
            ),
            unit(
                "aa00000000000000000000000000000000000000000000000000000000000006",
                "src/data/elite-redux/abilities/bernerd-roster-mechanics.ts:255:7:attr:LowerOffenseMoveCategoryAbAttr",
            ),
            unit(
                "aa00000000000000000000000000000000000000000000000000000000000007",
                "src/data/elite-redux/init-elite-redux-custom-moves.ts:1151:7:attr:MultiHitAttr",
            ),
            unit(
                "aa00000000000000000000000000000000000000000000000000000000000008",
                "src/data/moves/move.ts:1028:applyAbAttrs",
            ),
            unit(
                "aa00000000000000000000000000000000000000000000000000000000000009",
                "src/data/elite-redux/archetypes/post-faint-detonate.ts:316:applyAbAttrs",
            ),
            unit(
                "aa0000000000000000000000000000000000000000000000000000000000000a",
                "src/data/field/pokemon.ts:2041:applyMoveAttrs",
            ),
            unit(
                "aa0000000000000000000000000000000000000000000000000000000000000b",
                "src/modifier/modifier.ts:1951:globalScene.applyModifiers",
            ),
        ]
    }

    fn handler_counts(registry: &CustomDispatchRegistryV1) -> BTreeMap<String, usize> {
        let mut counts = BTreeMap::new();
        for route in &registry.routes {
            *counts.entry(format!("{:?}", route.handler)).or_insert(0) += 1;
        }
        counts.insert(
            String::from("REJECTED_NONDETERMINISTIC"),
            registry.rejected_nondeterministic.len(),
        );
        counts
    }

    #[test]
    fn sample_registry_classifies_every_shape_and_conserves_counts() {
        let registry = build_custom_dispatch_registry(&sample_gross_set(), &BTreeSet::new())
            .expect("sample registry");
        assert_eq!(registry.sibling_exclusions.len(), 0);
        let counts = handler_counts(&registry);
        assert_eq!(counts.get("BattleSeedDraw"), Some(&1));
        assert_eq!(counts.get("RunSeedDraw"), Some(&1));
        assert_eq!(counts.get("SeedShuffle"), Some(&1));
        assert_eq!(counts.get("LocalRangeDraw"), Some(&1));
        assert_eq!(counts.get("AbilityAttributeRegistration"), Some(&1));
        assert_eq!(counts.get("MoveAttributeRegistration"), Some(&1));
        assert_eq!(counts.get("AbilityAttributeDispatch"), Some(&2));
        assert_eq!(counts.get("MoveAttributeDispatch"), Some(&1));
        assert_eq!(counts.get("ModifierDispatch"), Some(&1));
        assert_eq!(counts.get("REJECTED_NONDETERMINISTIC"), Some(&1));
        let total: usize = counts.values().sum();
        assert_eq!(total, sample_gross_set().len());
        assert_eq!(registry.validate(), Ok(()));
    }

    #[test]
    fn registry_build_rejects_collisions_unknown_exclusions_and_residuals() {
        let gross = sample_gross_set();
        // Collision: the same identity twice.
        let mut duplicated = gross.clone();
        duplicated.push(gross[0].clone());
        assert!(matches!(
            build_custom_dispatch_registry(&duplicated, &BTreeSet::new()),
            Err(DispatchRegistryBuildErrorV1::DuplicateUnit { .. })
        ));
        // Exclusion of a unit outside the gross set.
        let phantom = BTreeSet::from([ProvenanceHash::parse(
            "bb00000000000000000000000000000000000000000000000000000000000001",
        )
        .expect("hash")]);
        assert!(matches!(
            build_custom_dispatch_registry(&gross, &phantom),
            Err(DispatchRegistryBuildErrorV1::UnknownSiblingExclusion { .. })
        ));
        // Residual: an unclassifiable key fails the build naming the unit.
        let mut residual = gross.clone();
        residual.retain(|unit| !unit.registry_key.starts_with("RNG:"));
        residual.push(unit(
            "cc00000000000000000000000000000000000000000000000000000000000001",
            "src/data/elite-redux/unknown-callback-surface.ts:1:1:mysteryCall",
        ));
        assert!(matches!(
            build_custom_dispatch_registry(&residual, &BTreeSet::new()),
            Err(DispatchRegistryBuildErrorV1::UnclassifiedUnit { .. })
        ));
    }

    #[test]
    fn sibling_exclusion_removes_units_from_routes_deterministically() {
        let gross = sample_gross_set();
        let exclusions = BTreeSet::from([
            ProvenanceHash::parse(
                "aa00000000000000000000000000000000000000000000000000000000000001",
            )
            .expect("hash"),
            ProvenanceHash::parse(
                "aa00000000000000000000000000000000000000000000000000000000000006",
            )
            .expect("hash"),
        ]);
        let registry =
            build_custom_dispatch_registry(&gross, &exclusions).expect("registry");
        assert_eq!(registry.sibling_exclusions.len(), 2);
        assert_eq!(registry.routes.len(), 8);
        assert_eq!(registry.rejected_nondeterministic.len(), 1);
        assert_eq!(registry.validate(), Ok(()));
    }

    #[test]
    fn full_fixture_corpus_builds_with_zero_residual() {
        let manifest = env!("CARGO_MANIFEST_DIR");
        let fixture_path = format!("{}/../../fixtures/m6/bespoke-clusters-v1.json", manifest);
        let raw = std::fs::read_to_string(fixture_path).expect("pinned fixture");
        #[derive(serde::Deserialize)]
        struct Cluster {
            cluster: String,
            behavior_units: Vec<FixtureUnit>,
        }
        #[derive(serde::Deserialize)]
        struct FixtureUnit {
            provenance_hash: String,
            source: FixtureSource,
        }
        #[derive(serde::Deserialize)]
        struct FixtureSource {
            kind: String,
            registry_key: Option<String>,
        }
        let parsed: Vec<Cluster> = serde_json::from_str(&raw).expect("fixture shape");
        let units: Vec<DispatchUnitIdentityV1> = parsed
            .iter()
            .filter(|cluster| cluster.cluster == "CUSTOM_DISPATCH")
            .flat_map(|cluster| &cluster.behavior_units)
            .filter(|unit| unit.source.kind == "BESPOKE")
            .map(|unit| DispatchUnitIdentityV1 {
                provenance_hash: ProvenanceHash::parse(&unit.provenance_hash)
                    .expect("fixture hash"),
                registry_key: unit.source.registry_key.clone().expect("bespoke key"),
            })
            .collect();
        assert_eq!(
            units.len(),
            er_state::bespoke_v2::boss::CUSTOM_DISPATCH_GROSS_BESPOKE_UNIT_COUNT as usize
        );
        let registry = build_custom_dispatch_registry(&units, &BTreeSet::new())
            .expect("zero-residual registry");
        let counts = handler_counts(&registry);
        assert_eq!(registry.gross_unit_count, units.len() as u32);
        assert_eq!(counts.get("BattleSeedDraw"), Some(&99));
        assert_eq!(counts.get("RunSeedDraw"), Some(&75));
        assert_eq!(counts.get("SeedShuffle"), Some(&9));
        assert_eq!(counts.get("LocalRangeDraw"), Some(&3));
        assert_eq!(counts.get("AbilityAttributeRegistration"), Some(&193));
        assert_eq!(counts.get("MoveAttributeRegistration"), Some(&34));
        assert_eq!(counts.get("AbilityAttributeDispatch"), Some(&46));
        assert_eq!(counts.get("MoveAttributeDispatch"), Some(&19));
        assert_eq!(counts.get("ModifierDispatch"), Some(&32));
        assert_eq!(counts.get("REJECTED_NONDETERMINISTIC"), Some(&5));
        assert_eq!(registry.routes.len(), 510);
        assert_eq!(registry.rejected_nondeterministic.len(), 5);
        assert_eq!(registry.sibling_exclusions.len(), 0);
        assert_eq!(registry.validate(), Ok(()));
    }
}
