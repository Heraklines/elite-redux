//! The M4 run runtime state machine.
//!
//! Contract: `rust/contracts/m4-api.md` (stage invariants) and
//! `rust/contracts/m4-run-material.md` (apply protocol). One production
//! applier serves both authority and replica: neither side adopts a prepared
//! candidate directly, and replicas never rerun any RNG.

use thiserror::Error;

use er_run::run_material::{AuthorityRunMaterial, RunMaterialHeader};
use er_state::digest_v2::MechanicalStateDigestV2;
use er_state::game_v2::GameStateV2;
use er_types::SeatId;
use er_types::battle_ids::ContentPackHash;
use er_types::run_control::{GameControl, GameControlPlan};
use er_types::run_model::RunStage;

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum RunRuntimeError {
    #[error("material before-digest disagrees with the endpoint-local frontier")]
    LocalFrontierMismatch,
    #[error("material header digests disagree with their carried states")]
    HeaderDigestMismatch,
    #[error("material carries an unsupported schema version")]
    UnsupportedSchema,
    #[error("material M3 parity oracle SHA is not frozen")]
    WrongParityOracle,
    #[error("material content hashes disagree with loaded content identity")]
    ContentIdentity,
    #[error("material after-state validation failed")]
    InvalidAfterState,
    #[error("material next-control plan failed validation")]
    InvalidNextControl,
}

/// The run-side runtime: complete game state plus immutable content identity.
///
/// Material application replaces the whole state atomically on success and
/// leaves `self` untouched on any failure (`m4-atomic-transition.md`).
#[derive(Clone)]
pub struct RunRuntime {
    state: GameStateV2,
    battle_content_hash: ContentPackHash,
    run_content_hash: er_types::run_ids::RunContentPackHash,
    m4_oracle_sha: String,
}

impl RunRuntime {
    /// Constructs one runtime from validated initial state and content
    /// identity. State must already validate.
    pub fn new(
        state: GameStateV2,
        battle_content_hash: ContentPackHash,
        run_content_hash: er_types::run_ids::RunContentPackHash,
        m4_oracle_sha: impl Into<String>,
    ) -> Result<Self, RunRuntimeError> {
        state
            .validate()
            .map_err(|_| RunRuntimeError::InvalidAfterState)?;
        Ok(Self {
            state,
            battle_content_hash,
            run_content_hash,
            m4_oracle_sha: m4_oracle_sha.into(),
        })
    }

    pub fn state(&self) -> &GameStateV2 {
        &self.state
    }

    /// The endpoint-local mechanical frontier used in step 7 of the apply
    /// protocol.
    pub fn frontier_digest(&self) -> Result<MechanicalStateDigestV2, RunRuntimeError> {
        MechanicalStateDigestV2::compute(&self.state)
            .map_err(|_| RunRuntimeError::InvalidAfterState)
    }

    /// Applies one run material through the shared production path.
    ///
    /// Steps 1-5 and 8-9 of `m4-run-material.md`: canonical bytes are decoded
    /// by the caller; here we validate kind/schema/oracle/content identity,
    /// recompute both digests from the carried states, compare the local
    /// frontier, validate control, then swap atomically. Duplicate application
    /// is detected upstream by operation identity at the kernel layer.
    pub fn apply(&mut self, material: &AuthorityRunMaterial) -> Result<(), RunRuntimeError> {
        let header = match material {
            AuthorityRunMaterial::WaveAdvance(value) => {
                if value.schema_version != er_run::run_material::WAVE_ADVANCE_MATERIAL_VERSION {
                    return Err(RunRuntimeError::UnsupportedSchema);
                }
                &value.header
            }
            AuthorityRunMaterial::Interaction(value) => {
                if value.schema_version != er_run::run_material::RUN_INTERACTION_MATERIAL_VERSION {
                    return Err(RunRuntimeError::UnsupportedSchema);
                }
                &value.header
            }
            AuthorityRunMaterial::Terminal(value) => {
                if value.schema_version != er_run::run_material::RUN_TERMINAL_MATERIAL_VERSION {
                    return Err(RunRuntimeError::UnsupportedSchema);
                }
                &value.header
            }
        };
        Self::validate_header(
            header,
            material,
            self.battle_content_hash.clone(),
            self.run_content_hash.clone(),
            &self.m4_oracle_sha,
        )?;
        let local = self.frontier_digest()?;
        if *header.before_digest.as_str() != *local.as_str() {
            return Err(RunRuntimeError::LocalFrontierMismatch);
        }
        header
            .after_state
            .validate()
            .map_err(|_| RunRuntimeError::InvalidAfterState)?;
        header
            .next_control
            .validate()
            .map_err(|_| RunRuntimeError::InvalidNextControl)?;
        // Step 9: atomic whole-state swap. Nothing above mutated self.
        self.state = header.after_state.clone();
        Ok(())
    }

    fn validate_header(
        header: &RunMaterialHeader,
        _material: &AuthorityRunMaterial,
        battle_hash: ContentPackHash,
        run_hash: er_types::run_ids::RunContentPackHash,
        oracle_sha: &str,
    ) -> Result<(), RunRuntimeError> {
        if header.m3_parity_oracle_sha != er_run::run_material::RUN_MATERIAL_M3_PARITY_ORACLE_SHA {
            return Err(RunRuntimeError::WrongParityOracle);
        }
        if header.m4_oracle_sha != oracle_sha {
            return Err(RunRuntimeError::WrongParityOracle);
        }
        if header.battle_content_hash != battle_hash || header.run_content_hash != run_hash {
            return Err(RunRuntimeError::ContentIdentity);
        }
        // Step 3/4 digests are recomputed from the carried states themselves.
        let before = MechanicalStateDigestV2::compute(&header.before_state)
            .map_err(|_| RunRuntimeError::HeaderDigestMismatch)?;
        if before != header.before_digest {
            return Err(RunRuntimeError::HeaderDigestMismatch);
        }
        let after = MechanicalStateDigestV2::compute(&header.after_state)
            .map_err(|_| RunRuntimeError::HeaderDigestMismatch)?;
        if *after.as_str() != *header.after_digest.as_str() {
            return Err(RunRuntimeError::HeaderDigestMismatch);
        }
        Ok(())
    }
}

/// Projects the solo-seat [`GameControlPlan`] implied by one validated stage.
///
/// Stage table (`rust/contracts/m4-api.md`, "Stage invariants"):
/// - Battle installs the battle's retained control (projected upstream).
/// - AwaitingWaveAdvance waits on the wave-tick operation.
/// - Progression/Surface install their surface controls (projected upstream).
/// - Complete installs [`GameControl::Complete`].
///
/// This helper covers the two stages whose control is fully determined by
/// state alone (AwaitingWaveAdvance waiting, Complete); surface-specific menus
/// are projected by their owning adapters with captured option evidence.
pub fn project_terminal_or_wait_control(
    state: &GameStateV2,
    next_control_id: impl Into<String>,
    owner_seat: SeatId,
    menu_instance_id: er_types::MenuInstanceId,
) -> Result<GameControlPlan, RunRuntimeError> {
    state
        .validate()
        .map_err(|_| RunRuntimeError::InvalidAfterState)?;
    if state.run.stage != RunStage::Complete {
        // Only the terminal stage's control is fully determined by state
        // alone; surface menus are projected by their owning adapters.
        return Err(RunRuntimeError::InvalidNextControl);
    }
    let control = GameControl::Complete(state.run.outcome);
    let seats = vec![er_types::run_control::SeatControlPlan {
        seat: owner_seat,
        owner: true,
        control_id: next_control_id.into(),
        menu_instance_id,
        actionable_after: er_types::run_control::PresentationBarrier::NonBlocking,
        control,
    }];
    GameControlPlan::new(seats, "run-stage".to_owned(), menu_instance_id)
        .map_err(|_| RunRuntimeError::InvalidNextControl)
}
