//! Canonical form/stance/Mega/Tera overlay state for the M6 bespoke
//! `forms` family.
//!
//! The family owns the stable base form of every registered battler scope
//! together with at most one reversible or one-time overlay:
//!
//! - `Conditional`: trigger-gated reversible overlays (weather, status,
//!   time-of-day; catalog evidence `SpeciesFormChangeWeatherTrigger` /
//!   `SpeciesFormChangeRevertWeatherFormTrigger`);
//! - `Stance`: a staged two-way swap between same-species forms
//!   (catalog evidence: post-move stance triggers, e.g. Relic Song);
//! - `Mega` / `Primal`: a one-time battle admission keyed by the frozen
//!   mega/primal form keys (`Pokemon#isMega`, `src/field/pokemon.ts:6157`);
//! - `Tera`: a one-time per-side Terastallization carrying the assigned
//!   Tera type (`MAX_TERAS_PER_ARENA = 1`, `src/constants.ts:129`;
//!   blocked while a Mega/Primal overlay is active,
//!   `src/utils/pokemon-utils.ts:204-208`). Tera persists through
//!   switch-out: `resetTera()` (`src/field/pokemon.ts:7523`) runs only on
//!   faint (`src/phases/faint-phase.ts:202`) and trainer-battle end
//!   (`src/battle-scene.ts:2440`), and `SpeciesFormChangeLapseTeraTrigger`
//!   is the Ogerpon/Terapagos form-key revert inside that reset, never a
//!   switch hook.
//!
//! State is canonical and total: every invariant listed under
//! [`FormsStateV2::validate`] holds for any accepted value. Transitions live
//! in `er-battle/src/m6/bespoke/forms.rs` and are pure.

use er_types::SafeU53;
use er_types::battle_ids::BattleSide;
use er_types::m6::M6_MECHANIC_STATE_SCHEMA_VERSION;
use er_types::mechanics::MechanicScope;
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Schema version of this family DTO. Frozen with the M6 mechanic-state V2
/// schema so integration cannot silently re-shape the wire format.
pub const FORMS_STATE_SCHEMA_VERSION: u32 = M6_MECHANIC_STATE_SCHEMA_VERSION;

/// Largest legal PokemonType ordinal, inclusive of Stellar
/// (`MAX_POKEMON_TYPE`, `src/enums/pokemon-type.ts`).
pub const MAX_POKEMON_TYPE_ORDINAL: u8 = 19;

/// Terastallizations allowed per side per battle
/// (`MAX_TERAS_PER_ARENA`, `src/constants.ts:129`).
pub const TERAS_PER_SIDE_MAX: u32 = 1;

/// A stable species + form-key identity.
///
/// The canonical base-form key is the empty string: every species whose
/// catalog identity carries no named form (or whose canonical index-zero form
/// exports the empty key) registers and presents under `""`. Named keys are
/// alternate presentations (stance targets, Mega evolutions); overlays never
/// change the stable base identity underneath.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FormIdentityV2 {
    pub species: SafeU53,
    pub form_key: String,
}

impl FormIdentityV2 {
    pub fn new(species: u64, form_key: impl Into<String>) -> Result<Self, FormsStateError> {
        let identity = Self {
            species: SafeU53::new(species).map_err(|_| FormsStateError::ZeroSpecies)?,
            form_key: form_key.into(),
        };
        identity.validate()?;
        Ok(identity)
    }

    pub fn validate(&self) -> Result<(), FormsStateError> {
        if self.species == SafeU53::ZERO {
            return Err(FormsStateError::ZeroSpecies);
        }
        // The empty key is the valid canonical base-form presentation; only a
        // zero species identity fails.
        Ok(())
    }
}

/// The closed set of overlays this family can hold on one battler scope.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FormOverlayKindV2 {
    /// Trigger-gated reversible overlay (weather/status/time-of-day).
    Conditional,
    /// Staged same-species stance swap (e.g. Aegislash blade/shield).
    Stance,
    /// One-time Mega/Primal evolution for the battle.
    Mega,
    /// One-time Terastallization for the side.
    Tera,
}

/// The active overlay on one battler scope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FormOverlayV2 {
    pub kind: FormOverlayKindV2,
    /// Identity presented while the overlay is active.
    pub current: FormIdentityV2,
    /// Assigned Tera type ordinal when `kind` is [`FormOverlayKindV2::Tera`].
    pub tera_type_ordinal: Option<u8>,
}

impl FormOverlayV2 {
    pub fn validate(&self) -> Result<(), FormsStateError> {
        self.current.validate()?;
        match self.kind {
            FormOverlayKindV2::Tera => match self.tera_type_ordinal {
                Some(ordinal) if ordinal <= MAX_POKEMON_TYPE_ORDINAL => Ok(()),
                _ => Err(FormsStateError::InvalidTeraTypeOrdinal),
            },
            FormOverlayKindV2::Conditional
            | FormOverlayKindV2::Stance
            | FormOverlayKindV2::Mega => {
                if self.tera_type_ordinal.is_some() {
                    return Err(FormsStateError::UnexpectedTeraType);
                }
                Ok(())
            }
        }
    }
}

/// A staged stance transition request. `request_id` is caller-assigned and
/// makes repeated submissions either idempotent or explicitly rejected.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StanceRequestV2 {
    pub request_id: u64,
    pub target: FormIdentityV2,
}

impl StanceRequestV2 {
    pub fn validate(&self) -> Result<(), FormsStateError> {
        if self.request_id == 0 {
            return Err(FormsStateError::ZeroRequestId);
        }
        self.target.validate()
    }
}

/// Overlay state for one battler scope.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FormsBattlerStateV2 {
    pub scope: MechanicScope,
    /// Stable base form; never changed by an overlay.
    pub base: FormIdentityV2,
    /// Currently presented form; equals `base` exactly when no overlay is
    /// active.
    pub current: FormIdentityV2,
    pub overlay: Option<FormOverlayV2>,
    /// One-time Mega admission consumed for this battler for the battle;
    /// survives switch cleanup and only resets at battle end.
    pub mega_used: bool,
    pub pending_stance_request: Option<StanceRequestV2>,
}

impl FormsBattlerStateV2 {
    pub fn new(scope: MechanicScope, base: FormIdentityV2) -> Result<Self, FormsStateError> {
        base.validate()?;
        Ok(Self {
            scope,
            current: base.clone(),
            base,
            overlay: None,
            mega_used: false,
            pending_stance_request: None,
        })
    }

    pub fn validate(&self) -> Result<(), FormsStateError> {
        self.base.validate()?;
        self.current.validate()?;
        match &self.overlay {
            None => {
                if self.current != self.base {
                    return Err(FormsStateError::CurrentFormMismatch);
                }
            }
            Some(overlay) => {
                overlay.validate()?;
                if self.current != overlay.current {
                    return Err(FormsStateError::CurrentFormMismatch);
                }
                if matches!(
                    overlay.kind,
                    FormOverlayKindV2::Mega | FormOverlayKindV2::Tera
                ) && self.pending_stance_request.is_some()
                {
                    return Err(FormsStateError::StancePendingUnderOneTimeOverlay);
                }
            }
        }
        if let Some(request) = &self.pending_stance_request {
            request.validate()?;
        }
        Ok(())
    }
}

/// Deterministic presentation evidence emitted by family transitions.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FormPresentationCueV2 {
    /// Monotone battle-wide ordinal assigned by the transition that staged
    /// the cue; strictly increasing across [`FormsStateV2::cues`].
    pub ordinal: u64,
    pub scope: MechanicScope,
    pub kind: FormCueKindV2,
    /// Identity before the transition, when one was presented.
    pub from: Option<FormIdentityV2>,
    /// Identity after the transition, when one is presented.
    pub to: Option<FormIdentityV2>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum FormCueKindV2 {
    OverlayApplied(FormOverlayKindV2),
    OverlayReverted(FormOverlayKindV2),
    StanceRequestStaged,
    SwitchCleanup,
    BattleEndReset,
}

/// Canonical state root of the `forms` family.
///
/// Battlers are kept strictly ordered by [`MechanicScope`] so lookups are
/// deterministic binary searches and serialization is canonical.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FormsStateV2 {
    pub schema_version: u32,
    pub teras_used_player_side: u32,
    pub teras_used_enemy_side: u32,
    pub battlers: Vec<FormsBattlerStateV2>,
    /// Next presentation-cue ordinal to assign; monotone across the battle.
    pub next_cue_ordinal: u64,
    pub cues: Vec<FormPresentationCueV2>,
}

impl Default for FormsStateV2 {
    fn default() -> Self {
        Self {
            schema_version: FORMS_STATE_SCHEMA_VERSION,
            teras_used_player_side: 0,
            teras_used_enemy_side: 0,
            battlers: Vec::new(),
            next_cue_ordinal: 1,
            cues: Vec::new(),
        }
    }
}

impl FormsStateV2 {
    /// Purely registers a battler scope with its stable base form and
    /// returns the updated state; the input is never mutated.
    pub fn register_battler(
        &self,
        scope: MechanicScope,
        base: FormIdentityV2,
    ) -> Result<Self, FormsStateError> {
        let mut next = self.clone();
        let entry = FormsBattlerStateV2::new(scope, base)?;
        match next
            .battlers
            .binary_search_by(|b| b.scope.cmp(&entry.scope))
        {
            Ok(_) => return Err(FormsStateError::DuplicateScope),
            Err(position) => next.battlers.insert(position, entry),
        }
        next.validate()?;
        Ok(next)
    }

    pub fn battler(&self, scope: &MechanicScope) -> Option<&FormsBattlerStateV2> {
        self.battlers
            .binary_search_by(|b| b.scope.cmp(scope))
            .ok()
            .map(|position| &self.battlers[position])
    }

    /// Teras already consumed by `side` this battle.
    pub fn teras_used(&self, side: BattleSide) -> u32 {
        match side {
            BattleSide::Player => self.teras_used_player_side,
            BattleSide::Enemy => self.teras_used_enemy_side,
        }
    }

    /// Validates the full canonical invariant set. Every constructor and
    /// transition in the family funnels through here.
    pub fn validate(&self) -> Result<(), FormsStateError> {
        if self.schema_version != FORMS_STATE_SCHEMA_VERSION {
            return Err(FormsStateError::SchemaVersion {
                expected: FORMS_STATE_SCHEMA_VERSION,
                actual: self.schema_version,
            });
        }
        if self.teras_used_player_side > TERAS_PER_SIDE_MAX
            || self.teras_used_enemy_side > TERAS_PER_SIDE_MAX
        {
            return Err(FormsStateError::SideTeraBudgetExceeded);
        }
        let mut previous_scope = None;
        for battler in &self.battlers {
            if previous_scope.is_some_and(|scope| battler.scope <= scope) {
                return Err(FormsStateError::BattlersOutOfOrder);
            }
            previous_scope = Some(battler.scope);
            battler.validate()?;
        }
        let mut previous_ordinal = 0u64;
        for cue in &self.cues {
            if cue.ordinal <= previous_ordinal || cue.ordinal >= self.next_cue_ordinal {
                return Err(FormsStateError::CueOrdinalsOutOfOrder);
            }
            previous_ordinal = cue.ordinal;
        }
        Ok(())
    }

    /// Appends `cue` with the next deterministic ordinal. Caller must have
    /// validated the state beforehand.
    pub fn push_cue(
        &mut self,
        kind: FormCueKindV2,
        scope: MechanicScope,
        from: Option<FormIdentityV2>,
        to: Option<FormIdentityV2>,
    ) -> FormPresentationCueV2 {
        let ordinal = self.next_cue_ordinal;
        self.next_cue_ordinal = ordinal.saturating_add(1);
        let cue = FormPresentationCueV2 {
            ordinal,
            scope,
            kind,
            from,
            to,
        };
        self.cues.push(cue.clone());
        cue
    }

    /// Shared mutation helper for transitions: clones the store, resolves the
    /// owned battler entry, and hands back the mutable clone.
    pub fn prepare_transition(
        &self,
        scope: &MechanicScope,
    ) -> Result<(Self, usize), FormsTransitionScopeError> {
        let next = self.clone();
        let position = next
            .battlers
            .binary_search_by(|b| b.scope.cmp(scope))
            .map_err(|_| FormsTransitionScopeError::UnknownScope)?;
        Ok((next, position))
    }

    pub fn battler_at(&self, position: usize) -> &FormsBattlerStateV2 {
        &self.battlers[position]
    }

    pub fn battler_mut_at(&mut self, position: usize) -> &mut FormsBattlerStateV2 {
        &mut self.battlers[position]
    }
}

/// Closed species/form battle-metadata registry.
///
/// Covers the frozen CUSTOM_DISPATCH `SPECIES` group: every otherwise
/// unowned `SPECIES_FORM_BEHAVIOR` behavior unit whose source is
/// `{ kind: SPECIES, numeric_id }`. The registry is the canonical lookup and
/// validation surface for that subset — one entry per distinct species id,
/// kept strictly ascending so lookups are deterministic binary searches.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SpeciesFormRegistryV2 {
    /// Distinct owned species ids, strictly ascending.
    entries: Vec<SafeU53>,
}

impl SpeciesFormRegistryV2 {
    /// Builds the registry from species ids in any order. Duplicate or zero
    /// ids are contract failures, never silently deduplicated.
    pub fn from_species_ids<I>(ids: I) -> Result<Self, FormsStateError>
    where
        I: IntoIterator<Item = u64>,
    {
        // SafeU53(0) is a representable value, so zero ids are rejected here
        // explicitly — the constructor must be total without a later validate().
        let mut entries: Vec<SafeU53> = ids
            .into_iter()
            .map(|id| {
                if id == 0 {
                    return Err(FormsStateError::ZeroSpecies);
                }
                SafeU53::new(id).map_err(|_| FormsStateError::ZeroSpecies)
            })
            .collect::<Result<_, _>>()?;
        entries.sort();
        if entries.windows(2).any(|window| window[0] == window[1]) {
            return Err(FormsStateError::DuplicateSpeciesEntry);
        }
        Ok(Self { entries })
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn entries(&self) -> &[SafeU53] {
        &self.entries
    }

    /// Deterministic membership lookup over the closed identity set.
    pub fn covers(&self, species: u64) -> bool {
        match SafeU53::new(species) {
            Ok(id) => self.entries.binary_search(&id).is_ok(),
            Err(_) => false,
        }
    }

    pub fn validate(&self) -> Result<(), FormsStateError> {
        if self.entries.windows(2).any(|window| window[0] >= window[1]) {
            return Err(FormsStateError::SpeciesRegistryOutOfOrder);
        }
        if self.entries.contains(&SafeU53::ZERO) {
            return Err(FormsStateError::ZeroSpecies);
        }
        Ok(())
    }
}

#[derive(Debug, Eq, Error, PartialEq)]
pub enum FormsTransitionScopeError {
    #[error("no battler is registered under the requested mechanic scope")]
    UnknownScope,
}

#[derive(Debug, Eq, Error, PartialEq)]
pub enum FormsStateError {
    #[error("forms state schema version must be {expected}, got {actual}")]
    SchemaVersion { expected: u32, actual: u32 },
    #[error("form species must be positive")]
    ZeroSpecies,
    #[error("tera type ordinal must be within 0..={MAX_POKEMON_TYPE_ORDINAL} inclusive")]
    InvalidTeraTypeOrdinal,
    #[error("only a Tera overlay may carry a Tera type")]
    UnexpectedTeraType,
    #[error("stance request ID must be positive")]
    ZeroRequestId,
    #[error("battler scopes must be unique")]
    DuplicateScope,
    #[error("registered battlers must be strictly ordered by scope")]
    BattlersOutOfOrder,
    #[error("presented form diverges from the base/overlay identity")]
    CurrentFormMismatch,
    #[error("a pending stance request cannot coexist with a Mega or Tera overlay")]
    StancePendingUnderOneTimeOverlay,
    #[error("per-side Tera budget exceeds the frozen ceiling of {TERAS_PER_SIDE_MAX}")]
    SideTeraBudgetExceeded,
    #[error("presentation cue ordinals must be strictly increasing below the next ordinal")]
    CueOrdinalsOutOfOrder,
    #[error("species registry entries must be strictly ordered and unique")]
    SpeciesRegistryOutOfOrder,
    #[error("species registry must not contain duplicate species ids")]
    DuplicateSpeciesEntry,
}
