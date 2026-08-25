//! M6C bespoke substitute proxy-HP mechanics (`SUBSTITUTE_PROXY_HP` family).
//!
//! Pure transitions over [`er_state::bespoke_v2::substitute`] canonical state.
//! Oracle evidence: `AddSubstituteAttr` (`src/data/moves/move.ts:2715`,
//! moves 164/880), `RemoveAllSubstitutesAttr` (`move.ts:8179`, move 882),
//! `SubstituteTag` (`src/data/battler-tags.ts:3522`), interception in
//! `src/phases/move-effect-phase.ts` (`hitsSubstitute`, doll HP deduction,
//! `updateSubstitutes` break sweep), and switch/faint cleanup in
//! `src/phases/switch-summon-phase.ts`.
//!
//! Frozen oracle facts implemented here:
//! - Creation cost is `roundUp ? ceil(maxHp * frac) : max(floor(maxHp * frac), 1)`
//!   with default fraction 1/4 (Substitute) or 1/2 rounded up (Shed Tail).
//! - Creation requires no existing doll and `hp_current > cost` (strict);
//!   the cost is paid from current HP without fainting.
//! - The doll's HP is `floor(maxHp / 4)` regardless of the paid cost.
//! - Intercepted attacks deduct full incoming damage from doll HP; overflow
//!   breaks the doll (`hp <= 0` removal sweep), exact equality breaks too.
//! - While intercepted, target-side move effects (status, stat stages,
//!   secondary effects) are blocked; user-side effects still apply.
//! - Infiltrator, sound-based moves, and `IGNORE_SUBSTITUTE` bypass the doll;
//!   self/side-targeting moves never hit it.
//! - Degenerate owners (`maxHp < 4`) pay the cost and create a zero-HP doll
//!   that still intercepts one hit before removal (exact oracle lifecycle).
//! - Switch-out, faint, and `RemoveAllSubstitutesAttr` clear dolls outright.

use er_state::bespoke_v2::substitute::{
    SubstituteProxyStateError, SubstituteProxyStateV2, SubstituteProxyStoreV2,
};
use er_types::SafeU53;
use er_types::battle_ids::PokemonId;
use er_types::m6::BehaviorUnitId;
use thiserror::Error;

/// Rational HP-cost fraction mirroring the frozen `AddSubstituteAttr`
/// operands (`JS_NUMBER_BITS` 0x3fd0.. = 1/4, 0x3fe0.. = 1/2).
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct HpCostFraction {
    pub numerator: u64,
    pub denominator: u64,
}

impl HpCostFraction {
    pub const SUBSTITUTE: Self = Self {
        numerator: 1,
        denominator: 4,
    };
    pub const SHED_TAIL: Self = Self {
        numerator: 1,
        denominator: 2,
    };

    /// # Errors
    /// Rejects a zero denominator or numerator.
    pub fn new(numerator: u64, denominator: u64) -> Result<Self, SubstituteMechanicError> {
        if denominator == 0 || numerator == 0 {
            return Err(SubstituteMechanicError::InvalidCostFraction);
        }
        Ok(Self {
            numerator,
            denominator,
        })
    }
}

/// Attack facts deciding whether one hit lands on the doll.
///
/// The caller resolves ability/flag queries (`InfiltratorAbAttr`,
/// `SOUND_BASED`, `IGNORE_SUBSTITUTE`) through the prepared-content executor;
/// this module consumes only the closed decision.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InterceptionFacts {
    /// Move target class strikes the defender directly (`!USER`, `!USER_SIDE`,
    /// `!ENEMY_SIDE`, `!BOTH_SIDES`).
    pub targets_owner: bool,
    /// At least one bypass holds (Infiltrator, sound-based, IGNORE_SUBSTITUTE).
    pub bypasses_substitute: bool,
}

/// Why a doll left canonical state.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SubstituteClearReason {
    /// The owner switched out; dolls never persist across switches.
    SwitchOut,
    /// The owner fainted.
    Faint,
    /// `RemoveAllSubstitutesAttr` (move 882) cleared every doll.
    RemoveAll,
}

/// Typed creation decision.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SubstituteCreationOutcome {
    Created { cost: SafeU53, proxy_hp: SafeU53 },
    Failed(SubstituteCreationFailure),
}

/// Deterministic creation-failure reasons.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SubstituteCreationFailure {
    /// A doll is already protecting this battler (`substituteOnOverlap`).
    ProxyAlreadyActive,
    /// `hp_current <= cost`; the strict-oracle eligibility failed.
    InsufficientHp { hp_current: SafeU53, cost: SafeU53 },
}

/// One atomic creation attempt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubstituteCreationTransition {
    pub outcome: SubstituteCreationOutcome,
    /// Owner current HP after the cost was paid (unchanged on failure).
    pub owner_hp_after: SafeU53,
    /// HP deducted from the owner (zero on failure).
    pub owner_hp_paid: SafeU53,
    /// Updated canonical store; byte-equal to the input on failure.
    pub store: SubstituteProxyStoreV2,
}

/// Typed interception decision for one hit.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SubstituteDamageOutcome {
    /// No doll applied (absent, bypassed, or non-owner targeting): the full
    /// damage reaches the owner's real HP.
    PassedThrough { damage_to_owner: SafeU53 },
    /// The doll absorbed the hit.
    Absorbed {
        proxy_hp_before: SafeU53,
        /// Damage credited to the attacker: `min(damage, proxy_hp)`.
        damage_credited: SafeU53,
        /// Overflow past the doll; positive exactly when broken.
        overkill: SafeU53,
        /// Deterministic break evidence: doll HP reached zero.
        broken: bool,
    },
}

/// One atomic damage-interception attempt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubstituteDamageTransition {
    pub outcome: SubstituteDamageOutcome,
    /// Target-side move effects are blocked exactly while intercepted
    /// (secondary effects, status moves, stat-stage changes).
    pub target_effects_blocked: bool,
    /// Owner real HP after the hit (only `PassedThrough` changes it).
    pub owner_hp_after: SafeU53,
    pub store: SubstituteProxyStoreV2,
}

/// One atomic cleanup transition (switch-out, faint, or remove-all).
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubstituteCleanupTransition {
    pub reason: SubstituteClearReason,
    /// Dolls removed, in deterministic owner order.
    pub cleared: Vec<SubstituteProxyStateV2>,
    pub store: SubstituteProxyStoreV2,
}

/// Fail-closed mechanic errors; eligibility failures are typed outcomes.
#[derive(Debug, Error, PartialEq)]
pub enum SubstituteMechanicError {
    #[error("substitute HP-cost fraction must have a positive numerator and denominator")]
    InvalidCostFraction,
    #[error("substitute arithmetic overflowed checked bounds")]
    Overflow,
    #[error("substitute requires a positive owner max HP")]
    ZeroMaxHp,
    #[error("substitute interception requires positive incoming damage")]
    ZeroIncomingDamage,
    #[error("substitute proxy state is invalid: {0}")]
    State(#[from] SubstituteProxyStateError),
}

/// Computes the exact creation cost from the oracle formula:
/// `roundUp ? ceil(maxHp * num / den) : max(floor(maxHp * num / den), 1)`.
///
/// # Errors
/// Returns [`SubstituteMechanicError::ZeroMaxHp`] for zero max HP,
/// [`SubstituteMechanicError::Overflow`] on checked-arithmetic overflow.
pub fn compute_creation_cost(
    hp_max: SafeU53,
    fraction: HpCostFraction,
    round_up: bool,
) -> Result<SafeU53, SubstituteMechanicError> {
    if hp_max == SafeU53::ZERO {
        return Err(SubstituteMechanicError::ZeroMaxHp);
    }
    let scaled = hp_max
        .get()
        .checked_mul(fraction.numerator)
        .ok_or(SubstituteMechanicError::Overflow)?;
    let cost = if round_up {
        scaled.div_ceil(fraction.denominator)
    } else {
        (scaled / fraction.denominator).max(1)
    };
    SafeU53::new(cost).map_err(|_| SubstituteMechanicError::Overflow)
}

/// Oracle proxy size: `floor(maxHp / 4)`.
///
/// # Errors
/// Returns [`SubstituteMechanicError::ZeroMaxHp`] for zero max HP.
pub fn compute_proxy_hp(hp_max: SafeU53) -> Result<SafeU53, SubstituteMechanicError> {
    if hp_max == SafeU53::ZERO {
        return Err(SubstituteMechanicError::ZeroMaxHp);
    }
    Ok(SubstituteProxyStateV2::proxy_bound(hp_max))
}

/// Typed creation input bundle.
#[derive(Clone, Copy, Debug)]
pub struct SubstituteCreationRequest<'a> {
    pub owner: PokemonId,
    pub hp_current: SafeU53,
    pub hp_max: SafeU53,
    pub cost_fraction: HpCostFraction,
    pub round_up: bool,
    pub source_behavior_unit: &'a BehaviorUnitId,
}

/// Attempts to create a substitute doll for `request.owner`.
///
/// Pure: validates inputs, clones the store, applies the result, revalidates,
/// and returns the transition. Failed creations leave the store byte-equal to
/// the input and pay no HP. Degenerate owners (`maxHp < 4`) succeed with a
/// zero-HP doll exactly like the production tag.
///
/// # Errors
/// Only arithmetic/state failures; eligibility failures are typed outcomes.
pub fn create_substitute(
    store: &SubstituteProxyStoreV2,
    request: SubstituteCreationRequest<'_>,
) -> Result<SubstituteCreationTransition, SubstituteMechanicError> {
    let failure = |reason| {
        Ok(SubstituteCreationTransition {
            outcome: SubstituteCreationOutcome::Failed(reason),
            owner_hp_after: request.hp_current,
            owner_hp_paid: SafeU53::ZERO,
            store: store.clone(),
        })
    };
    let cost = compute_creation_cost(request.hp_max, request.cost_fraction, request.round_up)?;

    if store.is_active(request.owner) {
        return failure(SubstituteCreationFailure::ProxyAlreadyActive);
    }
    if request.hp_current <= cost {
        return failure(SubstituteCreationFailure::InsufficientHp {
            hp_current: request.hp_current,
            cost,
        });
    }

    // Zero proxy HP is admissible: degenerate owners (`maxHp < 4`) create a
    // doll that intercepts exactly one hit before removal, per the oracle.
    let proxy_hp = compute_proxy_hp(request.hp_max)?;

    // Eligibility guarantees `hp_current > cost`, so no underflow is possible.
    let hp_after = request
        .hp_current
        .get()
        .checked_sub(cost.get())
        .ok_or(SubstituteMechanicError::Overflow)?;
    let owner_hp_after = SafeU53::new(hp_after).map_err(|_| SubstituteMechanicError::Overflow)?;

    let updated = store.clone().upsert(SubstituteProxyStateV2 {
        owner: request.owner,
        proxy_hp,
        owner_max_hp: request.hp_max,
        source_behavior_unit: request.source_behavior_unit.clone(),
    })?;
    updated.validate()?;

    Ok(SubstituteCreationTransition {
        outcome: SubstituteCreationOutcome::Created { cost, proxy_hp },
        owner_hp_after,
        owner_hp_paid: cost,
        store: updated,
    })
}

/// True exactly when a hit against `defender` lands on an active doll.
///
/// This is the single blocking predicate reused for damage interception and
/// every target-side effect query (status moves, stat stages, secondary
/// effects): blocked iff the doll is active (entry exists, including zero
/// HP), the attack targets the owner directly, and no bypass applies.
#[must_use]
pub fn intercepts_hit(
    store: &SubstituteProxyStoreV2,
    defender: PokemonId,
    facts: &InterceptionFacts,
) -> bool {
    facts.targets_owner && !facts.bypasses_substitute && store.is_active(defender)
}

/// Routes one hit of `incoming_damage` at `defender` through any active doll.
///
/// Pure: clones the store, deducts full incoming damage from doll HP
/// saturating at zero (break on `<= 0`, matching the `hp > 0` removal sweep),
/// revalidates, and returns the transition. Real HP is untouched while
/// intercepted.
///
/// # Errors
/// Returns [`SubstituteMechanicError::ZeroIncomingDamage`] for zero damage
/// (the oracle returns before interception), plus arithmetic/state failures.
pub fn intercept_damage(
    store: &SubstituteProxyStoreV2,
    defender: PokemonId,
    facts: &InterceptionFacts,
    incoming_damage: SafeU53,
    owner_hp_current: SafeU53,
) -> Result<SubstituteDamageTransition, SubstituteMechanicError> {
    if incoming_damage == SafeU53::ZERO {
        return Err(SubstituteMechanicError::ZeroIncomingDamage);
    }

    if !intercepts_hit(store, defender, facts) {
        let damage_to_owner = incoming_damage;
        // Real HP floors at zero; faint handling stays with the battle
        // transition owner, exactly like `damageAndUpdate` in the oracle.
        let owner_hp_after =
            SafeU53::new(owner_hp_current.get().saturating_sub(damage_to_owner.get()))
                .map_err(|_| SubstituteMechanicError::Overflow)?;
        return Ok(SubstituteDamageTransition {
            outcome: SubstituteDamageOutcome::PassedThrough { damage_to_owner },
            target_effects_blocked: false,
            owner_hp_after,
            store: store.clone(),
        });
    }

    let proxy = store
        .active_proxy(defender)
        .ok_or(SubstituteProxyStateError::ProxiesOutOfOrder)?;
    let proxy_hp_before = proxy.proxy_hp;

    let (remaining, overkill, broken) = if incoming_damage >= proxy_hp_before {
        (
            SafeU53::ZERO,
            SafeU53::new(incoming_damage.get() - proxy_hp_before.get())
                .map_err(|_| SubstituteMechanicError::Overflow)?,
            true,
        )
    } else {
        (
            SafeU53::new(proxy_hp_before.get() - incoming_damage.get())
                .map_err(|_| SubstituteMechanicError::Overflow)?,
            SafeU53::ZERO,
            false,
        )
    };
    let damage_credited = SafeU53::new(proxy_hp_before.get().min(incoming_damage.get()))
        .map_err(|_| SubstituteMechanicError::Overflow)?;

    let mut updated = store.clone();
    if broken {
        updated = updated.remove(defender).0;
    } else {
        let mut refreshed = proxy.clone();
        refreshed.proxy_hp = remaining;
        updated = updated.upsert(refreshed)?;
    }
    updated.validate()?;

    Ok(SubstituteDamageTransition {
        outcome: SubstituteDamageOutcome::Absorbed {
            proxy_hp_before,
            damage_credited,
            overkill,
            broken,
        },
        target_effects_blocked: true,
        owner_hp_after: owner_hp_current,
        store: updated,
    })
}

/// Clears the doll for `owner` on switch-out or faint. Missing dolls are a
/// successful no-op with empty evidence; the store stays byte-equal.
///
/// # Errors
/// State-validation failures only.
pub fn clear_proxy(
    store: &SubstituteProxyStoreV2,
    owner: PokemonId,
    reason: SubstituteClearReason,
) -> Result<SubstituteCleanupTransition, SubstituteMechanicError> {
    let (updated, cleared) = store.clone().remove(owner);
    updated.validate()?;
    Ok(SubstituteCleanupTransition {
        reason,
        cleared: cleared.into_iter().collect(),
        store: updated,
    })
}

/// Clears every doll (`RemoveAllSubstitutesAttr`, move 882) in deterministic
/// owner order.
///
/// # Errors
/// State-validation failures only.
pub fn clear_all_proxies(
    store: &SubstituteProxyStoreV2,
) -> Result<SubstituteCleanupTransition, SubstituteMechanicError> {
    let (updated, cleared) = store.clone().remove_all();
    updated.validate()?;
    Ok(SubstituteCleanupTransition {
        reason: SubstituteClearReason::RemoveAll,
        cleared,
        store: updated,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::m6::{BehaviorSourceId, BehaviorUnitKind, BehaviorUnitOrdinal, ProvenanceHash};

    const SUBSTITUTE_PROVENANCE: &str =
        "d924185e7284028910e2738903457ad6822921afb528754c56056b78acdf5526";

    fn owner(id: u64) -> PokemonId {
        PokemonId::try_from_u64(id).expect("pokemon id")
    }

    fn hp(value: u64) -> SafeU53 {
        SafeU53::new(value).expect("safe hp")
    }

    fn substitute_unit() -> BehaviorUnitId {
        BehaviorUnitId {
            source: BehaviorSourceId::Move {
                numeric_id: hp(164),
            },
            unit_kind: BehaviorUnitKind::MoveAttribute,
            ordinal: BehaviorUnitOrdinal::new(0),
            provenance_hash: ProvenanceHash::parse(SUBSTITUTE_PROVENANCE).expect("provenance"),
        }
    }

    fn direct_hit() -> InterceptionFacts {
        InterceptionFacts {
            targets_owner: true,
            bypasses_substitute: false,
        }
    }

    fn create(
        store: &SubstituteProxyStoreV2,
        id: u64,
        current: u64,
        max: u64,
    ) -> Result<SubstituteCreationTransition, SubstituteMechanicError> {
        create_substitute(
            store,
            SubstituteCreationRequest {
                owner: owner(id),
                hp_current: hp(current),
                hp_max: hp(max),
                cost_fraction: HpCostFraction::SUBSTITUTE,
                round_up: false,
                source_behavior_unit: &substitute_unit(),
            },
        )
    }

    #[test]
    fn creation_cost_matches_oracle_boundaries() {
        // floor(100 * 1/4) = 25; proxy floor(100 / 4) = 25.
        assert_eq!(
            compute_creation_cost(hp(100), HpCostFraction::SUBSTITUTE, false).unwrap(),
            hp(25)
        );
        assert_eq!(compute_proxy_hp(hp(100)).unwrap(), hp(25));
        // toDmgValue floors but enforces the minimum of 1.
        assert_eq!(
            compute_creation_cost(hp(3), HpCostFraction::SUBSTITUTE, false).unwrap(),
            hp(1)
        );
        // Shed Tail rounds up: ceil(101 * 1/2) = 51 while the doll stays 25.
        assert_eq!(
            compute_creation_cost(hp(101), HpCostFraction::SHED_TAIL, true).unwrap(),
            hp(51)
        );
        assert_eq!(compute_proxy_hp(hp(101)).unwrap(), hp(25));
    }

    #[test]
    fn creation_eligibility_is_strict_at_the_cost_boundary() {
        let store = SubstituteProxyStoreV2::new();
        // hp == cost fails the strict `hp > cost` condition...
        let failed = create(&store, 7, 25, 100).unwrap();
        assert_eq!(
            failed.outcome,
            SubstituteCreationOutcome::Failed(SubstituteCreationFailure::InsufficientHp {
                hp_current: hp(25),
                cost: hp(25),
            })
        );
        assert_eq!(failed.owner_hp_after, hp(25));
        assert_eq!(failed.owner_hp_paid, SafeU53::ZERO);
        // ...and pays nothing.
        assert_eq!(failed.store, store);
        // hp == cost + 1 succeeds and pays exactly the cost.
        let created = create(&store, 7, 26, 100).unwrap();
        assert_eq!(
            created.outcome,
            SubstituteCreationOutcome::Created {
                cost: hp(25),
                proxy_hp: hp(25),
            }
        );
        assert_eq!(created.owner_hp_after, hp(1));
        assert_eq!(created.owner_hp_paid, hp(25));
        created.store.validate().unwrap();
        assert!(created.store.is_active(owner(7)));
    }

    #[test]
    fn failed_creations_leave_input_unmutated() {
        let store = SubstituteProxyStoreV2::new();

        // Overlap failure.
        let seeded = create(&store, 3, 80, 100).unwrap().store;
        let seeded_baseline = seeded.clone();
        let overlapped = create(&seeded, 3, 80, 100).unwrap();
        assert_eq!(
            overlapped.outcome,
            SubstituteCreationOutcome::Failed(SubstituteCreationFailure::ProxyAlreadyActive)
        );
        assert_eq!(overlapped.store, seeded_baseline);
        // The failed overlap attempt left the seeded store byte-equal.
        assert_eq!(seeded, seeded_baseline);
    }

    #[test]
    fn degenerate_max_hp_creates_a_zero_hp_proxy_with_exact_lifecycle() {
        let store = SubstituteProxyStoreV2::new();

        // maxHp 3: cost = max(floor(3/4), 1) = 1; hp 3 > 1 passes eligibility;
        // the owner pays 1 HP and the doll is created with floor(3/4) = 0 HP,
        // exactly like `SubstituteTag.onAdd`.
        let created = create(&store, 9, 3, 3).unwrap();
        assert_eq!(
            created.outcome,
            SubstituteCreationOutcome::Created {
                cost: hp(1),
                proxy_hp: SafeU53::ZERO,
            }
        );
        assert_eq!(created.owner_hp_after, hp(2));
        created.store.validate().unwrap();
        let proxy = created.store.active_proxy(owner(9)).unwrap();
        assert_eq!(proxy.proxy_hp, SafeU53::ZERO);
        assert_eq!(proxy.owner_max_hp, hp(3));

        // The zero-HP doll still blocks target-side effects and intercepts
        // exactly one hit: credited damage min(damage, 0) = 0, overkill =
        // full damage, broken, then removed by the break sweep.
        assert!(intercepts_hit(&created.store, owner(9), &direct_hit()));
        let hit = intercept_damage(&created.store, owner(9), &direct_hit(), hp(5), hp(2)).unwrap();
        assert_eq!(
            hit.outcome,
            SubstituteDamageOutcome::Absorbed {
                proxy_hp_before: SafeU53::ZERO,
                damage_credited: SafeU53::ZERO,
                overkill: hp(5),
                broken: true,
            }
        );
        assert!(hit.target_effects_blocked);
        assert_eq!(hit.owner_hp_after, hp(2));
        assert!(!hit.store.is_active(owner(9)));
        hit.store.validate().unwrap();
    }

    #[test]
    fn damage_below_proxy_is_intercepted_without_breaking() {
        let store = create(&SubstituteProxyStoreV2::new(), 5, 80, 100)
            .unwrap()
            .store;
        // 10 < 25: the doll takes the full hit and survives with 15 HP.
        let transition = intercept_damage(&store, owner(5), &direct_hit(), hp(10), hp(55)).unwrap();
        assert_eq!(
            transition.outcome,
            SubstituteDamageOutcome::Absorbed {
                proxy_hp_before: hp(25),
                damage_credited: hp(10),
                overkill: SafeU53::ZERO,
                broken: false,
            }
        );
        assert!(transition.target_effects_blocked);
        assert_eq!(transition.owner_hp_after, hp(55));
        assert_eq!(
            transition.store.active_proxy(owner(5)).unwrap().proxy_hp,
            hp(15)
        );
        assert!(!matches!(
            transition.outcome,
            SubstituteDamageOutcome::Absorbed { broken: true, .. }
        ));
    }

    #[test]
    fn damage_equal_and_above_proxy_breaks_with_deterministic_overkill() {
        let store = create(&SubstituteProxyStoreV2::new(), 5, 80, 100)
            .unwrap()
            .store;

        // Exact equality breaks: the removal sweep keeps only `hp > 0`.
        let equal = intercept_damage(&store, owner(5), &direct_hit(), hp(25), hp(55)).unwrap();
        assert_eq!(
            equal.outcome,
            SubstituteDamageOutcome::Absorbed {
                proxy_hp_before: hp(25),
                damage_credited: hp(25),
                overkill: SafeU53::ZERO,
                broken: true,
            }
        );
        assert!(!equal.store.is_active(owner(5)));
        equal.store.validate().unwrap();

        // Overflow breaks and reports the excess past the doll.
        let recreated = create(&equal.store, 5, 80, 100).unwrap().store;
        let above = intercept_damage(&recreated, owner(5), &direct_hit(), hp(90), hp(55)).unwrap();
        assert_eq!(
            above.outcome,
            SubstituteDamageOutcome::Absorbed {
                proxy_hp_before: hp(25),
                damage_credited: hp(25),
                overkill: hp(65),
                broken: true,
            }
        );
        assert!(!above.store.is_active(owner(5)));
        assert_eq!(above.owner_hp_after, hp(55));
        above.store.validate().unwrap();
    }

    #[test]
    fn bypassed_and_mistargeted_hits_pass_through_without_blocking() {
        let store = create(&SubstituteProxyStoreV2::new(), 5, 80, 100)
            .unwrap()
            .store;
        let baseline = store.active_proxy(owner(5)).cloned().unwrap();

        // Infiltrator / sound-based / IGNORE_SUBSTITUTE resolve to bypass.
        let bypass = intercept_damage(
            &store,
            owner(5),
            &InterceptionFacts {
                targets_owner: true,
                bypasses_substitute: true,
            },
            hp(30),
            hp(55),
        )
        .unwrap();
        assert_eq!(
            bypass.outcome,
            SubstituteDamageOutcome::PassedThrough {
                damage_to_owner: hp(30)
            }
        );
        assert!(!bypass.target_effects_blocked);
        assert_eq!(bypass.owner_hp_after, hp(25));

        // Side/self-targeting moves never hit the doll.
        let mistargeted = intercept_damage(
            &store,
            owner(5),
            &InterceptionFacts {
                targets_owner: false,
                bypasses_substitute: false,
            },
            hp(30),
            hp(55),
        )
        .unwrap();
        assert!(matches!(
            mistargeted.outcome,
            SubstituteDamageOutcome::PassedThrough { .. }
        ));
        assert!(!mistargeted.target_effects_blocked);
        assert_eq!(mistargeted.store.active_proxy(owner(5)), Some(&baseline));
    }

    #[test]
    fn target_effects_are_blocked_exactly_while_intercepted() {
        let store = create(&SubstituteProxyStoreV2::new(), 5, 80, 100)
            .unwrap()
            .store;
        // Status moves and stat-stage changes reuse the same predicate.
        assert!(intercepts_hit(&store, owner(5), &direct_hit()));
        assert!(!intercepts_hit(&store, owner(6), &direct_hit()));
        assert!(!intercepts_hit(
            &store,
            owner(5),
            &InterceptionFacts {
                targets_owner: true,
                bypasses_substitute: true
            }
        ));
    }

    #[test]
    fn switch_and_faint_cleanup_clears_only_the_leaving_battler() {
        let store = create(&SubstituteProxyStoreV2::new(), 5, 80, 100)
            .unwrap()
            .store;
        let store = create(&store, 6, 80, 100).unwrap().store;

        let switch_out = clear_proxy(&store, owner(5), SubstituteClearReason::SwitchOut).unwrap();
        assert_eq!(switch_out.cleared.len(), 1);
        assert_eq!(switch_out.cleared[0].owner, owner(5));
        assert_eq!(switch_out.reason, SubstituteClearReason::SwitchOut);
        assert!(!switch_out.store.is_active(owner(5)));
        assert!(switch_out.store.is_active(owner(6)));

        let faint = clear_proxy(&switch_out.store, owner(6), SubstituteClearReason::Faint).unwrap();
        assert_eq!(faint.cleared.len(), 1);
        faint.store.validate().unwrap();
        assert!(faint.store.proxies.is_empty());

        // Clearing an absent doll is a deterministic no-op.
        let noop = clear_proxy(&faint.store, owner(5), SubstituteClearReason::SwitchOut).unwrap();
        assert!(noop.cleared.is_empty());
        assert_eq!(noop.store, faint.store);
    }

    #[test]
    fn remove_all_clears_every_doll_in_owner_order() {
        let mut store = SubstituteProxyStoreV2::new();
        for id in [11u64, 4, 7] {
            store = create(&store, id, 80, 100).unwrap().store;
        }
        let cleared = clear_all_proxies(&store).unwrap();
        assert_eq!(cleared.reason, SubstituteClearReason::RemoveAll);
        let owners: Vec<u64> = cleared
            .cleared
            .iter()
            .map(|proxy| proxy.owner.into_inner().get())
            .collect();
        assert_eq!(owners, vec![4, 7, 11]);
        assert!(cleared.store.proxies.is_empty());
    }

    #[test]
    fn canonical_state_enforces_positive_bounded_proxies() {
        use er_state::bespoke_v2::substitute::SubstituteProxyStateError;

        // Proxy HP above the creation bound is rejected.
        let result = SubstituteProxyStoreV2::new().upsert(SubstituteProxyStateV2 {
            owner: owner(1),
            proxy_hp: hp(26),
            owner_max_hp: hp(100),
            source_behavior_unit: substitute_unit(),
        });
        assert_eq!(
            result.unwrap_err(),
            SubstituteProxyStateError::ProxyHpAboveBound
        );

        // Deserialized out-of-order owners are rejected by validation.
        let mut disordered = SubstituteProxyStoreV2::new();
        disordered.proxies.push(SubstituteProxyStateV2 {
            owner: owner(9),
            proxy_hp: hp(25),
            owner_max_hp: hp(100),
            source_behavior_unit: substitute_unit(),
        });
        disordered.proxies.push(SubstituteProxyStateV2 {
            owner: owner(2),
            proxy_hp: hp(25),
            owner_max_hp: hp(100),
            source_behavior_unit: substitute_unit(),
        });
        assert_eq!(
            disordered.validate().unwrap_err(),
            SubstituteProxyStateError::ProxiesOutOfOrder
        );

        // Wrong schema version is rejected.
        let mut stale = SubstituteProxyStoreV2::new();
        stale.schema_version = 1;
        assert!(matches!(
            stale.validate(),
            Err(SubstituteProxyStateError::SchemaVersion {
                expected: 2,
                actual: 1
            })
        ));

        // Zero incoming damage is rejected before interception.
        let store = create(&SubstituteProxyStoreV2::new(), 5, 80, 100)
            .unwrap()
            .store;
        assert_eq!(
            intercept_damage(&store, owner(5), &direct_hit(), SafeU53::ZERO, hp(55)).unwrap_err(),
            SubstituteMechanicError::ZeroIncomingDamage
        );

        // A zero-HP doll (degenerate owner) is admissible canonical state.
        let degenerate = create(&SubstituteProxyStoreV2::new(), 2, 3, 3)
            .unwrap()
            .store;
        degenerate.validate().unwrap();
        assert!(degenerate.is_active(owner(2)));
    }
}
