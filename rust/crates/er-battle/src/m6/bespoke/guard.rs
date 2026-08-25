//! Bespoke protect/endure/guard transitions (`PROTECT_ENDURE_GUARD`).
//!
//! Pure battle transitions over [`GuardFamilyState`]. Every function follows
//! the atomic pattern: validate inputs, clone-and-mutate the candidate output,
//! validate the result, then return it together with deterministic evidence.
//! No transition draws RNG internally — the exact oracle threshold
//! (`randBattleSeedInt(3^timesUsed) === 0`) is admitted as an audited outcome
//! supplied by the caller, consumed once, and echoed in the evidence.
//!
//! Oracle provenance (`src/data/moves/move.ts`,
//! `src/data/battler-tags.ts`, `src/data/arena-tag.ts`,
//! `src/phases/move-effect-phase.ts`, `src/field/pokemon.ts`):
//!
//! - `ProtectAttr.getCondition`: first chained use always succeeds; later uses
//!   draw from range `3^timesUsed` and succeed only on roll `0`. QUICK_GUARD
//!   and WIDE_GUARD count into `timesUsed` without consuming odds; any failed
//!   or unrelated move breaks the chain.
//! - `MoveEffectPhase.protectedCheck`: field-targeted moves are never blocked;
//!   side conditional guards evaluate first (creation order), then the self
//!   protection tag. The `IGNORE_PROTECT` flag or a contact-bypass ability
//!   suppresses both branches except CRAFTY_SHIELD, whose protection
//!   supersedes the bypass. King's Shield/Obstruct/Silk Trap do not block
//!   status-category moves; Endure never blocks anything.
//! - `Pokemon.damage`: lethal damage survives at 1 HP through ENDURING
//!   (any HP), then STURDY (only above 1 HP), then ENDURE_TOKEN, consuming
//!   the first matching flag; `preventEndure` skips every path.

use er_state::bespoke_v2::guard::{
    ActiveSelfGuardEntry, ActiveSideGuardEntry, GuardFamilyState, GuardFamilyStateError, GuardKind,
    SideGuardKind, SurvivalFlag,
};
use er_types::SafeU53;
use er_types::battle_ids::BattleSide;
use er_types::battle_model::MoveCategory;
use er_types::mechanics::MechanicScope;
use serde::Serialize;
use thiserror::Error;

/// Schema version of every evidence payload produced here.
pub const GUARD_TRANSITION_SCHEMA_VERSION: u32 = 1;

/// Errors raised by pure guard transitions. Every variant names the exact
/// rejected input; nothing is coerced, defaulted, or silently skipped.
#[derive(Clone, Debug, Eq, Error, PartialEq)]
pub enum GuardTransitionError {
    #[error("input guard family state is invalid: {0}")]
    InvalidInputState(#[from] GuardFamilyStateError),
    #[error("defender scope must be a Pokemon")]
    InvalidDefenderScope,
    #[error("guard owner scope does not fit the activated guard")]
    InvalidOwnerScope,
    #[error("owner already holds an active guard of this family slot")]
    ActiveGuardConflict,
    #[error("success threshold 3^{depth} is not representable in the audited draw domain")]
    ThresholdRangeUnrepresentable { depth: u32 },
    #[error("chain depth counter exhausted")]
    ChainDepthOverflow,
    #[error("audited draw required at chain depth {depth}, range {expected}")]
    MissingAuditedDraw { depth: u32, expected: u64 },
    #[error("first chained use is guaranteed; audited draws are not admitted")]
    DrawSuppliedForGuaranteedSuccess,
    #[error("side guards never consume odds; audited draws are not admitted")]
    DrawSuppliedForUngatedActivation,
    #[error("audited draw range mismatch: threshold requires {expected}, got {actual}")]
    RangeMismatch { expected: u64, actual: u64 },
    #[error("audited roll {roll} lies outside the declared range {range}")]
    RollOutOfRange { roll: u64, range: u64 },
    #[error("ordinal counter exhausted")]
    OrdinalSpaceExhausted,
    #[error("damage amount must be positive")]
    ZeroDamage,
}

/// Shape of the battlefield an incoming move addresses.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum IncomingTargetShape {
    /// One chosen battler (ally or opponent).
    SingleTarget,
    /// Several distinct battlers (spread attacks); Wide Guard's domain.
    SpreadTargets,
    /// Whole opposing side; never blocked by individual protection.
    EnemySide,
    /// Both sides; never blocked by individual protection.
    BothSides,
}

/// Typed description of one incoming move, resolved by the executor before
/// the guard query. Effective priority already includes ability modifications
/// (Quick Guard's oracle condition reads the modified value).
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct IncomingMoveDescriptor {
    pub category: MoveCategory,
    pub target_shape: IncomingTargetShape,
    pub effective_priority: i16,
    /// Move carries the frozen `IGNORE_PROTECT` flag.
    pub ignores_protect_flag: bool,
    pub makes_contact: bool,
    /// Attacker resolves an ignore-protect-on-contact attribute (Unseen Fist
    /// class); combined with [`Self::makes_contact`] it produces a bypass.
    pub attacker_contact_protect_bypass: bool,
}

impl IncomingMoveDescriptor {
    /// Oracle gate: whole-side and both-side targets bypass individual
    /// protection entirely.
    pub const fn field_targeted(&self) -> bool {
        matches!(
            self.target_shape,
            IncomingTargetShape::EnemySide | IncomingTargetShape::BothSides
        )
    }

    /// Oracle bypass predicate: the `IGNORE_PROTECT` flag, or a
    /// contact-bypass ability on a contacting move.
    pub const fn bypasses_protection(&self) -> bool {
        self.ignores_protect_flag || (self.attacker_contact_protect_bypass && self.makes_contact)
    }
}

/// Which active guard answered the incoming move.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum BlockingGuard {
    SelfGuard(GuardKind),
    SideGuard(SideGuardKind),
}

/// Why a matched guard did not stop the move.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GuardBypassReason {
    IgnoreProtectMoveFlag,
    ContactProtectBypassAbility,
}

/// Deterministic verdict for one incoming move against one defender.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GuardBlockDecision {
    NotBlocked,
    Blocked {
        guard: BlockingGuard,
    },
    Bypassed {
        guard: BlockingGuard,
        reason: GuardBypassReason,
    },
}

/// Evidence for one guard-block resolution.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GuardBlockEvidence {
    pub schema_version: u32,
    pub defender: MechanicScope,
    pub defender_side: BattleSide,
    pub decision: GuardBlockDecision,
    /// Creation ordinal of the lapsed self guard when the block consumed one.
    pub consumed_self_guard_ordinal: Option<SafeU53>,
}

/// Outcome of [`resolve_incoming_move`]: possibly-lapsed state plus evidence.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GuardBlockResolution {
    pub state: GuardFamilyState,
    pub decision: GuardBlockDecision,
    pub evidence: GuardBlockEvidence,
}

/// Resolves one incoming move against one defender.
///
/// Evaluation mirrors the oracle exactly: field-targeted shapes pass; side
/// conditional guards run in creation order; the self protection tag runs
/// last and is lapsed when it blocks. Every non-blocking path is read-only.
///
/// # Errors
/// Returns [`GuardTransitionError`] when the input state fails validation or
/// the defender scope is not a Pokemon. The verdict itself is total.
pub fn resolve_incoming_move(
    state: &GuardFamilyState,
    defender: MechanicScope,
    defender_side: BattleSide,
    incoming: &IncomingMoveDescriptor,
) -> Result<GuardBlockResolution, GuardTransitionError> {
    state.validate()?;
    if !matches!(defender, MechanicScope::Pokemon { .. }) {
        return Err(GuardTransitionError::InvalidDefenderScope);
    }

    let mut candidate = state.clone();
    let mut consumed_self_guard_ordinal: Option<SafeU53> = None;
    let decision = evaluate_guard_block(
        state,
        defender_side,
        incoming,
        &mut consumed_self_guard_ordinal,
    );
    if consumed_self_guard_ordinal.is_some() {
        candidate
            .self_guards
            .retain(|entry| entry.owner != defender);
        candidate.validate()?;
    }

    let evidence = GuardBlockEvidence {
        schema_version: GUARD_TRANSITION_SCHEMA_VERSION,
        defender,
        defender_side,
        decision,
        consumed_self_guard_ordinal,
    };
    Ok(GuardBlockResolution {
        state: candidate,
        decision,
        evidence,
    })
}

/// Pure read-only verdict; shared by resolution and direct queries. When a
/// blocking self guard is found, its creation ordinal is reported through
/// `consumed` so callers lapse it atomically.
fn evaluate_guard_block(
    state: &GuardFamilyState,
    defender_side: BattleSide,
    incoming: &IncomingMoveDescriptor,
    consumed: &mut Option<SafeU53>,
) -> GuardBlockDecision {
    if incoming.field_targeted() {
        return GuardBlockDecision::NotBlocked;
    }

    // Side conditional guards first, creation order preserved.
    for entry in state.active_side_guards_for(defender_side) {
        let matches = match entry.kind {
            // Quick Guard: modified priority greater than zero.
            SideGuardKind::QuickGuard => incoming.effective_priority > 0,
            // Wide Guard: spread moves only.
            SideGuardKind::WideGuard => {
                matches!(incoming.target_shape, IncomingTargetShape::SpreadTargets)
            }
            // Mat Block: physical or special attacks.
            SideGuardKind::MatBlock => incoming.category != MoveCategory::Status,
            // Crafty Shield: status moves that are not field hazards; the
            // shape gate already excluded side/field-wide targeting.
            SideGuardKind::CraftyShield => incoming.category == MoveCategory::Status,
            // Safeguard owns lifecycle here, not block decisions.
            SideGuardKind::Safeguard => false,
        };
        if !matches {
            continue;
        }
        let guard = BlockingGuard::SideGuard(entry.kind);
        // Crafty Shield's protection supersedes protect-ignoring effects.
        if entry.kind == SideGuardKind::CraftyShield {
            return GuardBlockDecision::Blocked { guard };
        }
        if incoming.bypasses_protection() {
            return GuardBlockDecision::Bypassed {
                guard,
                reason: bypass_reason(incoming),
            };
        }
        return GuardBlockDecision::Blocked { guard };
    }

    // Self protection last. Endure blocks nothing; stat-stage contact
    // protects let status-category moves through.
    let Some(entry) = state.self_guards.iter().find(|entry| {
        !entry.kind.is_endure()
            && !(incoming.category == MoveCategory::Status && !entry.kind.blocks_status())
    }) else {
        return GuardBlockDecision::NotBlocked;
    };
    let guard = BlockingGuard::SelfGuard(entry.kind);
    if incoming.bypasses_protection() {
        return GuardBlockDecision::Bypassed {
            guard,
            reason: bypass_reason(incoming),
        };
    }
    *consumed = Some(entry.creation_ordinal);
    GuardBlockDecision::Blocked { guard }
}

const fn bypass_reason(incoming: &IncomingMoveDescriptor) -> GuardBypassReason {
    if incoming.ignores_protect_flag {
        GuardBypassReason::IgnoreProtectMoveFlag
    } else {
        GuardBypassReason::ContactProtectBypassAbility
    }
}

/// One audited RNG outcome admitted into a chained guard activation.
///
/// Mirrors the oracle draw site exactly: the caller supplies the resolved
/// roll plus the range the oracle would have drawn from; the transition
/// verifies the range against the exact threshold `3^chain_depth` and treats
/// roll `0` as success. No transition constructs or stores RNG state.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AuditedGuardDraw {
    roll: SafeU53,
    range: u64,
}

impl AuditedGuardDraw {
    pub const fn new(roll: SafeU53, range: u64) -> Self {
        Self { roll, range }
    }

    pub const fn roll(self) -> SafeU53 {
        self.roll
    }

    pub const fn range(&self) -> u64 {
        self.range
    }
}

/// Closed activation surface of the family.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GuardActivation {
    /// A catalog `ProtectAttr` move (odds-gated, chain-extending on success).
    SelfGuard(GuardKind),
    /// A side guard arena tag (never odds-gated; Quick/Wide extend the chain,
    /// the rest break it).
    SideGuard(SideGuardKind),
}

/// Request to activate one guard for one owner.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GuardUseRequest {
    pub owner: MechanicScope,
    pub activation: GuardActivation,
}

/// Deterministic record of one activation attempt.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GuardUseEvidence {
    pub schema_version: u32,
    pub activation: GuardActivation,
    pub owner: MechanicScope,
    pub chain_depth_before: u32,
    pub chain_depth_after: u32,
    /// Exact threshold range `3^depth`; `None` for ungated side guards.
    pub threshold_range: Option<u64>,
    /// The audited outcome admitted and inspected by this transition, if any.
    pub consumed_draw: Option<AuditedGuardDraw>,
    pub succeeded: bool,
    /// Creation ordinal minted for the new active guard, if any.
    pub ordinal_consumed: Option<SafeU53>,
}

/// Atomic result of [`apply_guard_use`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GuardUseTransition {
    pub state: GuardFamilyState,
    pub evidence: GuardUseEvidence,
}

/// Applies one guard activation.
///
/// Odds gating applies only to `ProtectAttr` self guards: depth 0 is a
/// guaranteed success that rejects any supplied draw; deeper depths require
/// an audited draw whose declared range equals `3^depth` exactly, succeeding
/// only on roll `0`. Side guards never consume odds. A failed draw resets the
/// chain to zero (the failed move breaks the oracle chain walk); a successful
/// self guard or Quick/Wide side guard advances it, any other successful side
/// guard breaks it.
pub fn apply_guard_use(
    state: &GuardFamilyState,
    request: &GuardUseRequest,
    draw: Option<AuditedGuardDraw>,
) -> Result<GuardUseTransition, GuardTransitionError> {
    state.validate()?;
    let depth_before = state.chain_depth;
    let mut candidate = state.clone();
    let mut evidence = GuardUseEvidence {
        schema_version: GUARD_TRANSITION_SCHEMA_VERSION,
        activation: request.activation,
        owner: request.owner,
        chain_depth_before: depth_before,
        chain_depth_after: depth_before,
        threshold_range: None,
        consumed_draw: draw,
        succeeded: false,
        ordinal_consumed: None,
    };

    let succeeded;
    match request.activation {
        GuardActivation::SelfGuard(_) => {
            let threshold = threshold_range(depth_before)?;
            evidence.threshold_range = Some(threshold);
            succeeded = match draw {
                None if depth_before == 0 => true,
                None => {
                    return Err(GuardTransitionError::MissingAuditedDraw {
                        depth: depth_before,
                        expected: threshold,
                    });
                }
                Some(outcome) => {
                    if depth_before == 0 {
                        return Err(GuardTransitionError::DrawSuppliedForGuaranteedSuccess);
                    }
                    if outcome.range() != threshold {
                        return Err(GuardTransitionError::RangeMismatch {
                            expected: threshold,
                            actual: outcome.range(),
                        });
                    }
                    if outcome.roll().get() >= outcome.range() {
                        return Err(GuardTransitionError::RollOutOfRange {
                            roll: outcome.roll().get(),
                            range: outcome.range(),
                        });
                    }
                    outcome.roll().get() == 0
                }
            };
            if succeeded {
                advance_chain_checked(&mut candidate, depth_before)?;
            } else {
                candidate.chain_depth = 0;
            }
        }
        GuardActivation::SideGuard(kind) => {
            if draw.is_some() {
                return Err(GuardTransitionError::DrawSuppliedForUngatedActivation);
            }
            succeeded = true;
            if kind.extends_chain() {
                advance_chain_checked(&mut candidate, depth_before)?;
            } else {
                candidate.chain_depth = 0;
            }
        }
    }
    evidence.succeeded = succeeded;

    if succeeded {
        let ordinal = candidate.next_creation_ordinal;
        match request.activation {
            GuardActivation::SelfGuard(kind) => {
                insert_self_guard(&mut candidate, request.owner, kind, ordinal)?;
            }
            GuardActivation::SideGuard(kind) => {
                insert_side_guard(&mut candidate, request.owner, kind, ordinal)?;
            }
        }
        candidate.next_creation_ordinal = SafeU53::new(
            ordinal
                .get()
                .checked_add(1)
                .ok_or(GuardTransitionError::OrdinalSpaceExhausted)?,
        )
        .map_err(|_| GuardTransitionError::OrdinalSpaceExhausted)?;
        evidence.ordinal_consumed = Some(ordinal);
    }
    evidence.chain_depth_after = candidate.chain_depth;

    candidate.validate()?;
    Ok(GuardUseTransition {
        state: candidate,
        evidence,
    })
}

fn advance_chain_checked(
    candidate: &mut GuardFamilyState,
    depth_before: u32,
) -> Result<(), GuardTransitionError> {
    let next_depth = depth_before
        .checked_add(1)
        .ok_or(GuardTransitionError::ChainDepthOverflow)?;
    candidate.chain_depth = next_depth;
    Ok(())
}

/// Exact oracle threshold: the draw range equals `3^chain_depth`. The range
/// must stay inside the audited draw domain — a `SafeU53` roll, exactly as
/// the oracle's `randBattleSeedInt` — so the first depth whose power of three
/// leaves that domain is the frozen numeric boundary; deeper chains fail
/// deterministically instead of approximating.
fn threshold_range(depth: u32) -> Result<u64, GuardTransitionError> {
    const DRAW_DOMAIN_MAX: u64 = SafeU53::MAX.get();
    let mut range: u64 = 1;
    for _ in 0..depth {
        match range.checked_mul(3) {
            Some(next) if next <= DRAW_DOMAIN_MAX => range = next,
            Some(_) | None => {
                return Err(GuardTransitionError::ThresholdRangeUnrepresentable { depth });
            }
        }
    }
    Ok(range)
}

fn insert_self_guard(
    state: &mut GuardFamilyState,
    owner: MechanicScope,
    kind: GuardKind,
    ordinal: SafeU53,
) -> Result<(), GuardTransitionError> {
    if !matches!(owner, MechanicScope::Pokemon { .. }) {
        return Err(GuardTransitionError::InvalidOwnerScope);
    }
    if kind.is_endure() {
        insert_owner_once(&mut state.enduring_owners, owner)?;
        return Ok(());
    }
    if state.self_guards.iter().any(|entry| entry.owner == owner) {
        return Err(GuardTransitionError::ActiveGuardConflict);
    }
    // Appends preserve the strictly increasing ordinal invariant.
    state.self_guards.push(ActiveSelfGuardEntry {
        kind,
        owner,
        creation_ordinal: ordinal,
    });
    Ok(())
}

fn insert_side_guard(
    state: &mut GuardFamilyState,
    owner: MechanicScope,
    kind: SideGuardKind,
    ordinal: SafeU53,
) -> Result<(), GuardTransitionError> {
    let side = match owner {
        MechanicScope::Side { side } => side,
        _ => return Err(GuardTransitionError::InvalidOwnerScope),
    };
    if state.has_side_guard(side, kind) {
        return Err(GuardTransitionError::ActiveGuardConflict);
    }
    state.side_guards.push(ActiveSideGuardEntry {
        kind,
        owner,
        creation_ordinal: ordinal,
    });
    Ok(())
}

fn insert_owner_once(
    owners: &mut Vec<MechanicScope>,
    owner: MechanicScope,
) -> Result<(), GuardTransitionError> {
    if owners.contains(&owner) {
        return Err(GuardTransitionError::ActiveGuardConflict);
    }
    let position = owners
        .binary_search(&owner)
        .unwrap_or_else(|insert_at| insert_at);
    owners.insert(position, owner);
    Ok(())
}

/// Breaks the consecutive-use chain (any successful non-chain move, switch,
/// or explicit reset). Active guards are untouched; turn-end expiry owns
/// those.
pub fn reset_guard_chain(
    state: &GuardFamilyState,
) -> Result<GuardFamilyState, GuardTransitionError> {
    state.validate()?;
    let mut candidate = state.clone();
    candidate.chain_depth = 0;
    candidate.validate()?;
    Ok(candidate)
}

/// Evidence for turn-end expiration.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct GuardTurnEndEvidence {
    pub schema_version: u32,
    pub self_guards_expired: u64,
    pub side_guards_expired: u64,
    pub enduring_flags_expired: u64,
    pub endure_token_flags_expired: u64,
    pub sturdy_flags_expired: u64,
    /// Chain depth survives expiry; only move history breaks it.
    pub chain_depth_preserved: u32,
}

/// Atomic result of [`expire_turn_end`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GuardTurnEndTransition {
    pub state: GuardFamilyState,
    pub evidence: GuardTurnEndEvidence,
}

/// Expires every active guard and survival flag at turn end while preserving
/// the consecutive-use chain and the ordinal counter.
pub fn expire_turn_end(
    state: &GuardFamilyState,
) -> Result<GuardTurnEndTransition, GuardTransitionError> {
    state.validate()?;
    let mut candidate = state.clone();
    let evidence = GuardTurnEndEvidence {
        schema_version: GUARD_TRANSITION_SCHEMA_VERSION,
        self_guards_expired: drain_len(&mut candidate.self_guards),
        side_guards_expired: drain_len(&mut candidate.side_guards),
        enduring_flags_expired: drain_len(&mut candidate.enduring_owners),
        endure_token_flags_expired: drain_len(&mut candidate.endure_token_owners),
        sturdy_flags_expired: drain_len(&mut candidate.sturdy_owners),
        chain_depth_preserved: candidate.chain_depth,
    };
    candidate.validate()?;
    Ok(GuardTurnEndTransition {
        state: candidate,
        evidence,
    })
}

fn drain_len<T>(vector: &mut Vec<T>) -> u64 {
    vector.drain(..).count() as u64
}

/// Closed survival sources in oracle precedence order.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SurvivalSource {
    EnduringTag,
    SturdyTag,
    EndureToken,
}

impl SurvivalSource {
    const fn flag(self) -> SurvivalFlag {
        match self {
            Self::EnduringTag => SurvivalFlag::Enduring,
            Self::SturdyTag => SurvivalFlag::Sturdy,
            Self::EndureToken => SurvivalFlag::EndureToken,
        }
    }
}

/// Typed lethal-damage input for [`apply_lethal_damage`].
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct LethalDamageInput {
    pub owner: MechanicScope,
    pub current_hp: u32,
    pub damage: u32,
    /// Oracle `preventEndure`: skips every survival path.
    pub prevent_endure: bool,
}

/// Verdict of one lethal-damage application.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DamageSurvivalDecision {
    Fainted,
    SurvivedAtMinimumHp { source: SurvivalSource },
}

/// Evidence for one lethal-damage application.
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SurvivalEvidence {
    pub schema_version: u32,
    pub owner: MechanicScope,
    pub hp_before: u32,
    pub damage: u32,
    /// Always 1 after survival; 0 when the defender faints.
    pub hp_after: u32,
    pub decision: DamageSurvivalDecision,
}

/// Atomic result of [`apply_lethal_damage`].
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EndureSurvivalTransition {
    pub state: GuardFamilyState,
    pub decision: DamageSurvivalDecision,
    pub evidence: SurvivalEvidence,
}

/// Applies lethal damage under Endure/Sturdy/ENDURE_TOKEN semantics.
///
/// Oracle precedence and gates, exactly: ENDURING requires current HP of at
/// least 1; STURDY requires more than 1; ENDURE_TOKEN requires at least 1.
/// The first satisfied path consumes its flag and clamps post-damage HP to 1
/// (`damage = hp - 1`); otherwise the defender faints. Non-lethal damage is
/// out of contract here — callers route it straight to HP bookkeeping.
pub fn apply_lethal_damage(
    state: &GuardFamilyState,
    input: &LethalDamageInput,
) -> Result<EndureSurvivalTransition, GuardTransitionError> {
    state.validate()?;
    if input.damage == 0 {
        return Err(GuardTransitionError::ZeroDamage);
    }
    let mut candidate = state.clone();

    let decision = if input.damage < input.current_hp || input.prevent_endure {
        DamageSurvivalDecision::Fainted
    } else {
        match survival_source(&candidate, input) {
            Some(source) => {
                consume_survival_flag(&mut candidate, input.owner, source)?;
                DamageSurvivalDecision::SurvivedAtMinimumHp { source }
            }
            None => DamageSurvivalDecision::Fainted,
        }
    };

    let hp_after = match decision {
        DamageSurvivalDecision::SurvivedAtMinimumHp { .. } => 1,
        DamageSurvivalDecision::Fainted => 0,
    };
    let evidence = SurvivalEvidence {
        schema_version: GUARD_TRANSITION_SCHEMA_VERSION,
        owner: input.owner,
        hp_before: input.current_hp,
        damage: input.damage,
        hp_after,
        decision,
    };
    candidate.validate()?;
    Ok(EndureSurvivalTransition {
        state: candidate,
        decision,
        evidence,
    })
}

/// Oracle precedence: ENDURING at any positive HP, then STURDY above 1 HP,
/// then ENDURE_TOKEN, first flag present wins.
fn survival_source(state: &GuardFamilyState, input: &LethalDamageInput) -> Option<SurvivalSource> {
    let candidates = [
        (SurvivalSource::EnduringTag, input.current_hp >= 1),
        (SurvivalSource::SturdyTag, input.current_hp > 1),
        (SurvivalSource::EndureToken, input.current_hp >= 1),
    ];
    candidates
        .into_iter()
        .filter(|(_, allowed)| *allowed)
        .find(|(source, _)| state.has_survival_flag(&input.owner, source.flag()))
        .map(|(source, _)| source)
}

fn consume_survival_flag(
    state: &mut GuardFamilyState,
    owner: MechanicScope,
    source: SurvivalSource,
) -> Result<(), GuardTransitionError> {
    let vector = match source.flag() {
        SurvivalFlag::Enduring => &mut state.enduring_owners,
        SurvivalFlag::Sturdy => &mut state.sturdy_owners,
        SurvivalFlag::EndureToken => &mut state.endure_token_owners,
    };
    let Some(position) = vector.iter().position(|candidate| *candidate == owner) else {
        return Err(GuardTransitionError::ActiveGuardConflict);
    };
    vector.remove(position);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWNER_A: u64 = 101;
    const OWNER_B: u64 = 202;

    fn fresh_state() -> GuardFamilyState {
        GuardFamilyState::default()
    }

    fn pokemon(id: u64) -> MechanicScope {
        MechanicScope::Pokemon {
            pokemon: er_types::battle_ids::PokemonId::new(SafeU53::new(id).unwrap()),
        }
    }

    fn side(side: BattleSide) -> MechanicScope {
        MechanicScope::Side { side }
    }

    fn attack(priority: i16) -> IncomingMoveDescriptor {
        IncomingMoveDescriptor {
            category: MoveCategory::Physical,
            target_shape: IncomingTargetShape::SingleTarget,
            effective_priority: priority,
            ignores_protect_flag: false,
            makes_contact: false,
            attacker_contact_protect_bypass: false,
        }
    }

    fn status_move() -> IncomingMoveDescriptor {
        IncomingMoveDescriptor {
            category: MoveCategory::Status,
            ..attack(0)
        }
    }

    fn spread_attack() -> IncomingMoveDescriptor {
        IncomingMoveDescriptor {
            target_shape: IncomingTargetShape::SpreadTargets,
            ..attack(0)
        }
    }

    fn self_request(owner_id: u64, kind: GuardKind) -> GuardUseRequest {
        GuardUseRequest {
            owner: pokemon(owner_id),
            activation: GuardActivation::SelfGuard(kind),
        }
    }

    fn side_request(owner_side: BattleSide, kind: SideGuardKind) -> GuardUseRequest {
        GuardUseRequest {
            owner: side(owner_side),
            activation: GuardActivation::SideGuard(kind),
        }
    }

    fn resolve_against(
        state: &GuardFamilyState,
        defender_id: u64,
        defender_side: BattleSide,
        incoming: &IncomingMoveDescriptor,
    ) -> GuardBlockDecision {
        resolve_incoming_move(state, pokemon(defender_id), defender_side, incoming)
            .unwrap()
            .decision
    }

    #[test]
    fn first_use_is_guaranteed_and_rejects_any_draw() {
        let state = fresh_state();
        let request = self_request(OWNER_A, GuardKind::Protect);

        let clean = apply_guard_use(&state, &request, None).unwrap();
        assert!(clean.evidence.succeeded);
        assert_eq!(clean.evidence.chain_depth_after, 1);
        assert_eq!(clean.evidence.threshold_range, Some(1));
        assert!(clean.evidence.consumed_draw.is_none());
        assert_eq!(
            clean
                .state
                .self_guard_for(&pokemon(OWNER_A))
                .map(|e| e.kind),
            Some(GuardKind::Protect)
        );

        let admitted = AuditedGuardDraw::new(SafeU53::ZERO, 1);
        assert_eq!(
            apply_guard_use(&state, &request, Some(admitted)),
            Err(GuardTransitionError::DrawSuppliedForGuaranteedSuccess)
        );
    }

    #[test]
    fn consecutive_use_consumes_exact_threshold_once() {
        let base = fresh_state();
        let first = self_request(OWNER_A, GuardKind::Protect);
        let second = self_request(OWNER_B, GuardKind::Detect);
        let depth_one = apply_guard_use(&base, &first, None).unwrap().state;

        assert_eq!(
            apply_guard_use(&depth_one, &second, None),
            Err(GuardTransitionError::MissingAuditedDraw {
                depth: 1,
                expected: 3
            })
        );
        let wrong_range = AuditedGuardDraw::new(SafeU53::ZERO, 4);
        assert_eq!(
            apply_guard_use(&depth_one, &second, Some(wrong_range)),
            Err(GuardTransitionError::RangeMismatch {
                expected: 3,
                actual: 4
            })
        );
        let out_of_range = AuditedGuardDraw::new(SafeU53::new(7).unwrap(), 3);
        assert_eq!(
            apply_guard_use(&depth_one, &second, Some(out_of_range)),
            Err(GuardTransitionError::RollOutOfRange { roll: 7, range: 3 })
        );

        let miss = AuditedGuardDraw::new(SafeU53::new(1).unwrap(), 3);
        let failed = apply_guard_use(&depth_one, &second, Some(miss)).unwrap();
        assert!(!failed.evidence.succeeded);
        assert_eq!(failed.state.chain_depth, 0);
        assert!(failed.state.self_guards.is_empty());

        let rebuilt = apply_guard_use(&failed.state, &first, None).unwrap().state;
        let hit = AuditedGuardDraw::new(SafeU53::ZERO, 3);
        let passed = apply_guard_use(&rebuilt, &second, Some(hit)).unwrap();
        assert!(passed.evidence.succeeded);
        assert_eq!(passed.state.chain_depth, 2);
        assert_eq!(
            passed.evidence.consumed_draw.map(AuditedGuardDraw::roll),
            Some(SafeU53::ZERO)
        );
    }

    #[test]
    fn quick_and_wide_extend_chain_while_others_break_it() {
        let base = fresh_state();
        let protect = self_request(OWNER_A, GuardKind::Protect);
        let depth_one = apply_guard_use(&base, &protect, None).unwrap().state;

        let quick = apply_guard_use(
            &depth_one,
            &side_request(BattleSide::Player, SideGuardKind::QuickGuard),
            None,
        )
        .unwrap();
        assert_eq!(quick.state.chain_depth, 2);

        let wide = apply_guard_use(
            &quick.state,
            &side_request(BattleSide::Player, SideGuardKind::WideGuard),
            None,
        )
        .unwrap();
        assert_eq!(wide.state.chain_depth, 3);

        let crafty = apply_guard_use(
            &wide.state,
            &side_request(BattleSide::Player, SideGuardKind::CraftyShield),
            None,
        )
        .unwrap();
        assert_eq!(crafty.state.chain_depth, 0);
        let next_protect = self_request(OWNER_B, GuardKind::Detect);
        assert!(apply_guard_use(&crafty.state, &next_protect, None).is_ok());

        assert_eq!(
            apply_guard_use(
                &crafty.state,
                &side_request(BattleSide::Enemy, SideGuardKind::MatBlock),
                Some(AuditedGuardDraw::new(SafeU53::ZERO, 9)),
            ),
            Err(GuardTransitionError::DrawSuppliedForUngatedActivation)
        );
    }

    #[test]
    fn chains_run_deep_past_six_with_exact_powers_of_three() {
        let mut deep = fresh_state();
        deep.chain_depth = 7;
        deep.validate().unwrap();
        let request = self_request(OWNER_A, GuardKind::Protect);

        assert_eq!(
            apply_guard_use(&deep, &request, None),
            Err(GuardTransitionError::MissingAuditedDraw {
                depth: 7,
                expected: 2187
            })
        );
        let miss = AuditedGuardDraw::new(SafeU53::new(1).unwrap(), 2187);
        let failed = apply_guard_use(&deep, &request, Some(miss)).unwrap();
        assert!(!failed.evidence.succeeded);
        assert_eq!(failed.state.chain_depth, 0);

        deep.chain_depth = 6;
        let hit = AuditedGuardDraw::new(SafeU53::ZERO, 729);
        let passed = apply_guard_use(&deep, &request, Some(hit)).unwrap();
        assert!(passed.evidence.succeeded);
        assert_eq!(passed.state.chain_depth, 7);
    }

    #[test]
    fn boundary_is_the_safe_draw_domain_not_a_depth_cap() {
        const DOMAIN_MAX: u64 = SafeU53::MAX.get();
        // 3^33 fits the safe-integer draw domain; 3^34 does not.
        assert_eq!(3_u64.pow(33) <= DOMAIN_MAX, true);
        assert_eq!(3_u64.pow(34) > DOMAIN_MAX, true);

        let mut deepest = fresh_state();
        deepest.chain_depth = 33;
        deepest.validate().unwrap();
        let request = self_request(OWNER_A, GuardKind::Protect);
        assert_eq!(
            apply_guard_use(&deepest, &request, None),
            Err(GuardTransitionError::MissingAuditedDraw {
                depth: 33,
                expected: 5_559_060_566_555_523
            })
        );
        let last_hit = AuditedGuardDraw::new(SafeU53::ZERO, 5_559_060_566_555_523);
        let survived = apply_guard_use(&deepest, &request, Some(last_hit)).unwrap();
        assert!(survived.evidence.succeeded);
        assert_eq!(survived.state.chain_depth, 34);

        // The very next depth crosses the frozen numeric boundary.
        let beyond = AuditedGuardDraw::new(SafeU53::ZERO, u64::MAX);
        assert_eq!(
            apply_guard_use(&survived.state, &request, Some(beyond)),
            Err(GuardTransitionError::ThresholdRangeUnrepresentable { depth: 34 })
        );

        // The threshold computation itself refuses before any draw is
        // consulted, whether or not an outcome was supplied.
        assert_eq!(
            apply_guard_use(&survived.state, &request, None),
            Err(GuardTransitionError::ThresholdRangeUnrepresentable { depth: 34 })
        );
    }

    #[test]
    fn each_scope_blocks_exactly_its_domain() {
        let base = fresh_state();

        // Self protection: default kinds block damaging and status moves.
        let protected = apply_guard_use(&base, &self_request(OWNER_A, GuardKind::Protect), None)
            .unwrap()
            .state;
        for incoming in [attack(0), status_move()] {
            assert_eq!(
                resolve_against(&protected, OWNER_A, BattleSide::Player, &incoming),
                GuardBlockDecision::Blocked {
                    guard: BlockingGuard::SelfGuard(GuardKind::Protect)
                }
            );
        }

        // King's Shield lets status moves through but stops attacks.
        let kings = apply_guard_use(&base, &self_request(OWNER_A, GuardKind::KingsShield), None)
            .unwrap()
            .state;
        assert_eq!(
            resolve_against(&kings, OWNER_A, BattleSide::Player, &status_move()),
            GuardBlockDecision::NotBlocked
        );
        assert_eq!(
            resolve_against(&kings, OWNER_A, BattleSide::Player, &attack(0)),
            GuardBlockDecision::Blocked {
                guard: BlockingGuard::SelfGuard(GuardKind::KingsShield)
            }
        );

        // Endure blocks nothing.
        let endured = apply_guard_use(&base, &self_request(OWNER_A, GuardKind::Endure), None)
            .unwrap()
            .state;
        assert_eq!(
            resolve_against(&endured, OWNER_A, BattleSide::Player, &attack(0)),
            GuardBlockDecision::NotBlocked
        );
        assert!(endured.has_survival_flag(&pokemon(OWNER_A), SurvivalFlag::Enduring));

        // Wide Guard: spread only, and covers the whole side.
        let wide = apply_guard_use(
            &base,
            &side_request(BattleSide::Player, SideGuardKind::WideGuard),
            None,
        )
        .unwrap()
        .state;
        assert_eq!(
            resolve_against(&wide, OWNER_A, BattleSide::Player, &spread_attack()),
            GuardBlockDecision::Blocked {
                guard: BlockingGuard::SideGuard(SideGuardKind::WideGuard)
            }
        );
        assert_eq!(
            resolve_against(&wide, OWNER_A, BattleSide::Player, &attack(0)),
            GuardBlockDecision::NotBlocked
        );
        assert_eq!(
            resolve_against(&wide, OWNER_B, BattleSide::Enemy, &spread_attack()),
            GuardBlockDecision::NotBlocked
        );

        // Quick Guard: modified priority above zero only.
        let quick = apply_guard_use(
            &base,
            &side_request(BattleSide::Player, SideGuardKind::QuickGuard),
            None,
        )
        .unwrap()
        .state;
        assert_eq!(
            resolve_against(&quick, OWNER_A, BattleSide::Player, &attack(1)),
            GuardBlockDecision::Blocked {
                guard: BlockingGuard::SideGuard(SideGuardKind::QuickGuard)
            }
        );
        assert_eq!(
            resolve_against(&quick, OWNER_A, BattleSide::Player, &attack(0)),
            GuardBlockDecision::NotBlocked
        );

        // Mat Block: physical and special only.
        let mat = apply_guard_use(
            &base,
            &side_request(BattleSide::Player, SideGuardKind::MatBlock),
            None,
        )
        .unwrap()
        .state;
        assert_eq!(
            resolve_against(&mat, OWNER_A, BattleSide::Player, &attack(0)),
            GuardBlockDecision::Blocked {
                guard: BlockingGuard::SideGuard(SideGuardKind::MatBlock)
            }
        );
        assert_eq!(
            resolve_against(&mat, OWNER_A, BattleSide::Player, &status_move()),
            GuardBlockDecision::NotBlocked
        );

        // Crafty Shield: status only.
        let crafty = apply_guard_use(
            &base,
            &side_request(BattleSide::Player, SideGuardKind::CraftyShield),
            None,
        )
        .unwrap()
        .state;
        assert_eq!(
            resolve_against(&crafty, OWNER_A, BattleSide::Player, &status_move()),
            GuardBlockDecision::Blocked {
                guard: BlockingGuard::SideGuard(SideGuardKind::CraftyShield)
            }
        );
        assert_eq!(
            resolve_against(&crafty, OWNER_A, BattleSide::Player, &attack(0)),
            GuardBlockDecision::NotBlocked
        );
    }

    #[test]
    fn field_targeted_moves_are_never_blocked() {
        let base = fresh_state();
        let protected = apply_guard_use(&base, &self_request(OWNER_A, GuardKind::Protect), None)
            .unwrap()
            .state;
        let wide = apply_guard_use(
            &protected,
            &side_request(BattleSide::Player, SideGuardKind::WideGuard),
            None,
        )
        .unwrap()
        .state;

        for shape in [
            IncomingTargetShape::EnemySide,
            IncomingTargetShape::BothSides,
        ] {
            let incoming = IncomingMoveDescriptor {
                target_shape: shape,
                ..spread_attack()
            };
            assert_eq!(
                resolve_against(&wide, OWNER_A, BattleSide::Player, &incoming),
                GuardBlockDecision::NotBlocked
            );
        }
    }

    #[test]
    fn bypass_paths_match_the_oracle_branches() {
        let base = fresh_state();
        let protected = apply_guard_use(&base, &self_request(OWNER_A, GuardKind::Protect), None)
            .unwrap()
            .state;

        // IGNORE_PROTECT flag bypasses the tag.
        let feint = IncomingMoveDescriptor {
            ignores_protect_flag: true,
            ..attack(2)
        };
        assert_eq!(
            resolve_against(&protected, OWNER_A, BattleSide::Player, &feint),
            GuardBlockDecision::Bypassed {
                guard: BlockingGuard::SelfGuard(GuardKind::Protect),
                reason: GuardBypassReason::IgnoreProtectMoveFlag,
            }
        );

        // Contact-bypass ability works only through contacting moves...
        let unseen_fist_contact = IncomingMoveDescriptor {
            makes_contact: true,
            attacker_contact_protect_bypass: true,
            ..attack(0)
        };
        assert_eq!(
            resolve_against(
                &protected,
                OWNER_A,
                BattleSide::Player,
                &unseen_fist_contact
            ),
            GuardBlockDecision::Bypassed {
                guard: BlockingGuard::SelfGuard(GuardKind::Protect),
                reason: GuardBypassReason::ContactProtectBypassAbility,
            }
        );
        let unseen_fist_ranged = IncomingMoveDescriptor {
            attacker_contact_protect_bypass: true,
            ..attack(0)
        };
        assert_eq!(
            resolve_against(&protected, OWNER_A, BattleSide::Player, &unseen_fist_ranged),
            GuardBlockDecision::Blocked {
                guard: BlockingGuard::SelfGuard(GuardKind::Protect)
            }
        );

        // ...and the same bypass suppresses Quick Guard...
        let quick = apply_guard_use(
            &base,
            &side_request(BattleSide::Player, SideGuardKind::QuickGuard),
            None,
        )
        .unwrap()
        .state;
        assert_eq!(
            resolve_against(&quick, OWNER_A, BattleSide::Player, &feint),
            GuardBlockDecision::Bypassed {
                guard: BlockingGuard::SideGuard(SideGuardKind::QuickGuard),
                reason: GuardBypassReason::IgnoreProtectMoveFlag,
            }
        );

        // ...while Crafty Shield supersedes it outright.
        let crafty = apply_guard_use(
            &quick,
            &side_request(BattleSide::Player, SideGuardKind::CraftyShield),
            None,
        )
        .unwrap()
        .state;
        let crafty_status = IncomingMoveDescriptor {
            ignores_protect_flag: true,
            attacker_contact_protect_bypass: true,
            makes_contact: true,
            ..status_move()
        };
        assert_eq!(
            resolve_against(&crafty, OWNER_A, BattleSide::Player, &crafty_status),
            GuardBlockDecision::Blocked {
                guard: BlockingGuard::SideGuard(SideGuardKind::CraftyShield)
            }
        );
    }

    #[test]
    fn blocking_lapses_only_the_self_guard_tag() {
        let base = fresh_state();
        let protected = apply_guard_use(&base, &self_request(OWNER_A, GuardKind::Protect), None)
            .unwrap()
            .state;
        let ordinal_before = protected
            .self_guard_for(&pokemon(OWNER_A))
            .unwrap()
            .creation_ordinal;

        let first_hit =
            resolve_incoming_move(&protected, pokemon(OWNER_A), BattleSide::Player, &attack(0))
                .unwrap();
        assert!(first_hit.evidence.consumed_self_guard_ordinal.is_some());
        assert_eq!(
            first_hit.evidence.consumed_self_guard_ordinal,
            Some(ordinal_before)
        );
        assert!(first_hit.state.self_guard_for(&pokemon(OWNER_A)).is_none());
        // Side guards and the chain survive a block resolution.
        assert_eq!(first_hit.state.chain_depth, protected.chain_depth);

        let second_hit = resolve_incoming_move(
            &first_hit.state,
            pokemon(OWNER_A),
            BattleSide::Player,
            &attack(0),
        )
        .unwrap();
        assert_eq!(second_hit.decision, GuardBlockDecision::NotBlocked);
        assert_eq!(second_hit.evidence.consumed_self_guard_ordinal, None);
    }

    #[test]
    fn side_guard_evaluation_follows_creation_order() {
        let base = fresh_state();
        let with_quick = apply_guard_use(
            &base,
            &side_request(BattleSide::Player, SideGuardKind::QuickGuard),
            None,
        )
        .unwrap()
        .state;
        let both = apply_guard_use(
            &with_quick,
            &side_request(BattleSide::Player, SideGuardKind::WideGuard),
            None,
        )
        .unwrap()
        .state;
        let priority_spread = IncomingMoveDescriptor {
            effective_priority: 1,
            ..spread_attack()
        };
        // Both conditions match; the earlier-created Quick Guard answers.
        assert_eq!(
            resolve_against(&both, OWNER_A, BattleSide::Player, &priority_spread),
            GuardBlockDecision::Blocked {
                guard: BlockingGuard::SideGuard(SideGuardKind::QuickGuard)
            }
        );
        // Non-matching earlier guards fall through to later ones.
        let mat_then_wide = apply_guard_use(
            &base,
            &side_request(BattleSide::Player, SideGuardKind::MatBlock),
            None,
        )
        .unwrap()
        .state;
        let layered = apply_guard_use(
            &mat_then_wide,
            &side_request(BattleSide::Player, SideGuardKind::WideGuard),
            None,
        )
        .unwrap()
        .state;
        assert_eq!(
            resolve_against(&layered, OWNER_A, BattleSide::Player, &spread_attack()),
            GuardBlockDecision::Blocked {
                guard: BlockingGuard::SideGuard(SideGuardKind::WideGuard)
            }
        );
    }

    #[test]
    fn invalid_defender_scope_is_rejected() {
        let base = fresh_state();
        assert_eq!(
            resolve_incoming_move(
                &base,
                side(BattleSide::Player),
                BattleSide::Player,
                &attack(0)
            ),
            Err(GuardTransitionError::InvalidDefenderScope)
        );
    }

    #[test]
    fn duplicate_active_guards_conflict() {
        let base = fresh_state();
        let protect = self_request(OWNER_A, GuardKind::Protect);
        let once = apply_guard_use(&base, &protect, None).unwrap().state;
        assert_eq!(
            apply_guard_use(&once, &protect, None),
            Err(GuardTransitionError::ActiveGuardConflict)
        );

        let endure = self_request(OWNER_A, GuardKind::Endure);
        let enduring = apply_guard_use(&base, &endure, None).unwrap().state;
        assert_eq!(
            apply_guard_use(&enduring, &endure, None),
            Err(GuardTransitionError::ActiveGuardConflict)
        );

        let wide = side_request(BattleSide::Player, SideGuardKind::WideGuard);
        let widened = apply_guard_use(&base, &wide, None).unwrap().state;
        assert_eq!(
            apply_guard_use(&widened, &wide, None),
            Err(GuardTransitionError::ActiveGuardConflict)
        );
        // Different kinds on one side coexist; different sides stay disjoint.
        assert!(
            apply_guard_use(
                &widened,
                &side_request(BattleSide::Player, SideGuardKind::QuickGuard),
                None
            )
            .is_ok()
        );
        assert!(
            apply_guard_use(
                &widened,
                &side_request(BattleSide::Enemy, SideGuardKind::WideGuard),
                None
            )
            .is_ok()
        );

        // Owner scopes must fit the activation surface.
        let misdirected = GuardUseRequest {
            owner: pokemon(OWNER_A),
            activation: GuardActivation::SideGuard(SideGuardKind::WideGuard),
        };
        assert_eq!(
            apply_guard_use(&base, &misdirected, None),
            Err(GuardTransitionError::InvalidOwnerScope)
        );
    }

    #[test]
    fn endure_survival_precedence_and_minimum_hp() {
        let base = fresh_state();

        // No flags: faint.
        let bare = LethalDamageInput {
            owner: pokemon(OWNER_A),
            current_hp: 100,
            damage: 250,
            prevent_endure: false,
        };
        let fainted = apply_lethal_damage(&base, &bare).unwrap();
        assert_eq!(fainted.decision, DamageSurvivalDecision::Fainted);
        assert_eq!(fainted.evidence.hp_after, 0);

        // Endure survives at exactly 1 HP and consumes the flag.
        let mut enduring = base.clone();
        enduring.enduring_owners = vec![pokemon(OWNER_A)];
        let survived = apply_lethal_damage(&enduring, &bare).unwrap();
        assert_eq!(
            survived.decision,
            DamageSurvivalDecision::SurvivedAtMinimumHp {
                source: SurvivalSource::EnduringTag
            }
        );
        assert_eq!(survived.evidence.hp_after, 1);
        assert!(survived.state.enduring_owners.is_empty());

        // Sturdy holds above 1 HP but cannot save from exactly 1 HP left.
        let mut sturdy = base.clone();
        sturdy.sturdy_owners = vec![pokemon(OWNER_A)];
        let saved = apply_lethal_damage(
            &sturdy,
            &LethalDamageInput {
                current_hp: 30,
                damage: 30,
                ..bare_no_owner()
            },
        )
        .unwrap();
        assert!(matches!(
            saved.decision,
            DamageSurvivalDecision::SurvivedAtMinimumHp {
                source: SurvivalSource::SturdyTag
            }
        ));
        let last_hp = apply_lethal_damage(
            &sturdy,
            &LethalDamageInput {
                current_hp: 1,
                damage: 5,
                ..bare_no_owner()
            },
        )
        .unwrap();
        assert_eq!(last_hp.decision, DamageSurvivalDecision::Fainted);

        // Precedence: Enduring beats Sturdy beats token when several exist.
        let mut layered = base.clone();
        layered.enduring_owners = vec![pokemon(OWNER_A)];
        layered.sturdy_owners = vec![pokemon(OWNER_A)];
        let picked_enduring = apply_lethal_damage(&layered, &bare).unwrap();
        assert!(matches!(
            picked_enduring.decision,
            DamageSurvivalDecision::SurvivedAtMinimumHp {
                source: SurvivalSource::EnduringTag
            }
        ));
        assert!(!picked_enduring.state.sturdy_owners.is_empty());

        let mut tokens = base.clone();
        tokens.endure_token_owners = vec![pokemon(OWNER_A)];
        let picked_token = apply_lethal_damage(&tokens, &bare).unwrap();
        assert!(matches!(
            picked_token.decision,
            DamageSurvivalDecision::SurvivedAtMinimumHp {
                source: SurvivalSource::EndureToken
            }
        ));
        assert!(picked_token.state.endure_token_owners.is_empty());

        // preventEndure skips everything.
        let prevented = apply_lethal_damage(
            &enduring,
            &LethalDamageInput {
                prevent_endure: true,
                ..bare_no_owner()
            },
        )
        .unwrap();
        assert_eq!(prevented.decision, DamageSurvivalDecision::Fainted);
        assert_eq!(prevented.evidence.hp_after, 0);

        // Zero damage is rejected outright.
        assert_eq!(
            apply_lethal_damage(
                &base,
                &LethalDamageInput {
                    damage: 0,
                    ..bare_no_owner()
                }
            ),
            Err(GuardTransitionError::ZeroDamage)
        );
    }

    fn bare_no_owner() -> LethalDamageInput {
        LethalDamageInput {
            owner: pokemon(OWNER_A),
            current_hp: 100,
            damage: 250,
            prevent_endure: false,
        }
    }

    #[test]
    fn turn_end_expires_actives_but_preserves_chain() {
        let base = fresh_state();
        let after_protect =
            apply_guard_use(&base, &self_request(OWNER_A, GuardKind::Protect), None)
                .unwrap()
                .state;
        let after_quick = apply_guard_use(
            &after_protect,
            &side_request(BattleSide::Player, SideGuardKind::QuickGuard),
            None,
        )
        .unwrap()
        .state;
        let mut armed = after_quick.clone();
        armed.enduring_owners = vec![pokemon(OWNER_B)];
        armed.endure_token_owners = vec![pokemon(OWNER_A)];
        armed.sturdy_owners = vec![pokemon(OWNER_A), pokemon(OWNER_B)];
        armed.validate().unwrap();

        let expired = expire_turn_end(&armed).unwrap();
        assert_eq!(expired.evidence.self_guards_expired, 1);
        assert_eq!(expired.evidence.side_guards_expired, 1);
        assert_eq!(expired.evidence.enduring_flags_expired, 1);
        assert_eq!(expired.evidence.endure_token_flags_expired, 1);
        assert_eq!(expired.evidence.sturdy_flags_expired, 2);
        assert_eq!(expired.evidence.chain_depth_preserved, 2);
        assert_eq!(expired.state.chain_depth, 2);
        assert!(expired.state.self_guards.is_empty());
        assert!(expired.state.side_guards.is_empty());
        assert!(expired.state.enduring_owners.is_empty());
        assert!(expired.state.endure_token_owners.is_empty());
        assert!(expired.state.sturdy_owners.is_empty());
        // Ordinals keep advancing across expiry.
        assert_eq!(
            expired.state.next_creation_ordinal,
            armed.next_creation_ordinal
        );
    }

    #[test]
    fn reset_breaks_the_chain_without_touching_actives() {
        let base = fresh_state();
        let protect = self_request(OWNER_A, GuardKind::Protect);
        let chained = apply_guard_use(&base, &protect, None).unwrap().state;
        let chained_again =
            apply_guard_use(&chained, &self_request(OWNER_B, GuardKind::Detect), None)
                .unwrap()
                .state;
        let reset = reset_guard_chain(&chained_again).unwrap();
        assert_eq!(reset.self_guards.len(), chained_again.self_guards.len());
        assert_eq!(reset.chain_depth, 0);
        assert_eq!(
            reset.next_creation_ordinal,
            chained_again.next_creation_ordinal
        );
    }

    #[test]
    fn transitions_are_deterministic_and_never_mutate_input() {
        let base = fresh_state();
        let snapshot = base.clone();
        let protect = self_request(OWNER_A, GuardKind::Protect);
        let run_a = apply_guard_use(&base, &protect, None).unwrap();
        let run_b = apply_guard_use(&base, &protect, None).unwrap();
        assert_eq!(run_a, run_b);
        assert_eq!(base, snapshot);
    }
}
