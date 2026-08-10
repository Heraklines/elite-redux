//! Game-local clone/validate/swap transaction.
//!
//! `GameTransaction` deliberately stops at the game owner.  The kernel adds
//! protocol, scheduler, input, UI, presentation, and effect staging around
//! this value in its private `KernelTransaction`.

use er_types::battle_control::BattleControlPlan;
use er_state::digest::MechanicalStateDigest;

use crate::internal_event::{GameIntent, PreparedBattleResolution};
use crate::runtime::{GameReduction, GameRuntime, GameRuntimeError};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum GameTransactionError {
    #[error("game transaction rejected: {0}")]
    Runtime(#[from] GameRuntimeError),
    #[error("the live game runtime changed since this transaction began")]
    BaseChanged,
}

/// A private staged copy of one `GameRuntime`.
#[derive(Clone, Debug)]
pub struct GameTransaction {
    base: GameRuntime,
    staged: GameRuntime,
}

impl GameTransaction {
    pub fn begin(base: &GameRuntime) -> Self {
        Self {
            base: base.clone(),
            staged: base.clone(),
        }
    }

    pub fn base(&self) -> &GameRuntime {
        &self.base
    }

    pub fn staged(&self) -> &GameRuntime {
        &self.staged
    }

    /// Reduce against a private candidate clone.  An error leaves the staged
    /// transaction byte-for-byte equivalent to its prior value.
    pub fn reduce(&mut self, intent: GameIntent) -> Result<GameReduction, GameTransactionError> {
        let mut candidate = self.staged.clone();
        let reduction = candidate.reduce(intent)?;
        candidate.validate()?;
        self.staged = candidate;
        Ok(reduction)
    }

    pub fn apply_intent(&mut self, intent: GameIntent) -> Result<GameReduction, GameTransactionError> {
        self.reduce(intent)
    }

    /// Install a prepared resolver result atomically inside the game clone.
    pub fn install_resolution(
        &mut self,
        resolution: &PreparedBattleResolution,
    ) -> Result<(), GameTransactionError> {
        let mut candidate = self.staged.clone();
        candidate.install_resolution(resolution)?;
        candidate.validate()?;
        self.staged = candidate;
        Ok(())
    }

    pub fn install_state(
        &mut self,
        before_digest: &MechanicalStateDigest,
        after: er_state::snapshot::GameState,
    ) -> Result<(), GameTransactionError> {
        let mut candidate = self.staged.clone();
        candidate.install_state(before_digest, after)?;
        self.staged = candidate;
        Ok(())
    }

    /// Install a control produced by the common material/control boundary.
    pub fn install_control(
        &mut self,
        control: BattleControlPlan,
    ) -> Result<(), GameTransactionError> {
        let mut candidate = self.staged.clone();
        candidate.install_control(control)?;
        candidate.validate()?;
        self.staged = candidate;
        Ok(())
    }

    pub fn validate(&self) -> Result<(), GameTransactionError> {
        self.staged.validate()?;
        Ok(())
    }

    /// Return the validated game clone.  The caller's live runtime is not
    /// changed until the kernel swaps this value into its larger transaction.
    pub fn commit(self) -> Result<GameRuntime, GameTransactionError> {
        self.staged.validate()?;
        Ok(self.staged)
    }

    /// Swap into the live game only if the original base is still current.
    pub fn commit_into(self, live: &mut GameRuntime) -> Result<(), GameTransactionError> {
        if *live != self.base {
            return Err(GameTransactionError::BaseChanged);
        }
        self.staged.validate()?;
        *live = self.staged;
        Ok(())
    }

    /// Explicitly discard the staged game.  The method exists to make the
    /// rollback boundary visible to kernel orchestration and tests.
    pub fn rollback(self) {}
}
