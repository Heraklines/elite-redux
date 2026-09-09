//! Source PhaseTree ordering for resolved phases. This does not execute phases,
//! resolve dynamic markers, or settle pending experience.
use std::collections::VecDeque;

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MAX_CURRENT_PHASE_LEVELS: usize = 64;
pub const MAX_CURRENT_QUEUED_PHASES: usize = 4096;

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CurrentPhaseTreeSnapshot<T> {
    pub levels: Vec<VecDeque<T>>,
    pub current_level: usize,
    pub deferred_active: bool,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CurrentPhaseTree<T> {
    state: CurrentPhaseTreeSnapshot<T>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Error)]
pub enum CurrentPhaseTreeError {
    #[error("phase tree references a nonexistent source level")]
    InvalidLevel,
    #[error("phase tree exceeds the supported retained queue bounds")]
    Capacity,
}

impl<T: Clone> Default for CurrentPhaseTree<T> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: Clone> CurrentPhaseTree<T> {
    pub fn new() -> Self {
        Self {
            state: CurrentPhaseTreeSnapshot {
                levels: vec![VecDeque::new()],
                current_level: 0,
                deferred_active: false,
            },
        }
    }

    /// Structural restore only; provenance belongs to the containing run owner.
    pub fn restore(state: CurrentPhaseTreeSnapshot<T>) -> Result<Self, CurrentPhaseTreeError> {
        if state.levels.is_empty() || state.current_level >= state.levels.len() {
            return Err(CurrentPhaseTreeError::InvalidLevel);
        }
        if state.levels.len() > MAX_CURRENT_PHASE_LEVELS
            || state.levels.iter().map(VecDeque::len).sum::<usize>() > MAX_CURRENT_QUEUED_PHASES
        {
            return Err(CurrentPhaseTreeError::Capacity);
        }
        Ok(Self { state })
    }

    pub fn snapshot(&self) -> CurrentPhaseTreeSnapshot<T> {
        self.state.clone()
    }

    fn room(&self) -> Result<(), CurrentPhaseTreeError> {
        if self.state.levels.iter().map(VecDeque::len).sum::<usize>() >= MAX_CURRENT_QUEUED_PHASES {
            return Err(CurrentPhaseTreeError::Capacity);
        }
        Ok(())
    }

    fn add(&mut self, phase: T, level: usize) -> Result<(), CurrentPhaseTreeError> {
        self.room()?;
        if level == self.state.current_level + 1 && level == self.state.levels.len() {
            if self.state.levels.len() == MAX_CURRENT_PHASE_LEVELS {
                return Err(CurrentPhaseTreeError::Capacity);
            }
            self.state.levels.push(VecDeque::new());
        }
        self.state
            .levels
            .get_mut(level)
            .ok_or(CurrentPhaseTreeError::InvalidLevel)?
            .push_back(phase);
        Ok(())
    }

    pub fn add_phase(&mut self, phase: T, defer: bool) -> Result<(), CurrentPhaseTreeError> {
        // Source deferral inserts below the deepest level, even when that level
        // is empty. Commit only after admission succeeds.
        let mut candidate = self.clone();
        if defer && !candidate.state.deferred_active {
            if candidate.state.levels.len() == MAX_CURRENT_PHASE_LEVELS {
                return Err(CurrentPhaseTreeError::Capacity);
            }
            candidate.state.deferred_active = true;
            candidate
                .state
                .levels
                .insert(candidate.state.levels.len() - 1, VecDeque::new());
            candidate.state.current_level += 1;
        }
        candidate.add(
            phase,
            candidate.state.current_level + 1 - usize::from(defer),
        )?;
        *self = candidate;
        Ok(())
    }

    pub fn push_phase(&mut self, phase: T) -> Result<(), CurrentPhaseTreeError> {
        self.add(phase, 0)
    }

    pub fn add_barrier(&mut self, phase: T) -> Result<(), CurrentPhaseTreeError> {
        self.room()?;
        let siblings = self
            .state
            .levels
            .get_mut(self.state.current_level)
            .ok_or(CurrentPhaseTreeError::InvalidLevel)?;
        siblings.push_front(phase);
        Ok(())
    }

    pub fn next_phase(&mut self) -> Option<T> {
        self.state.current_level = self.state.levels.len() - 1;
        while self.state.current_level > 0 && self.state.levels[self.state.current_level].is_empty()
        {
            self.state.deferred_active = false;
            self.state.levels.pop();
            self.state.current_level -= 1;
        }
        self.state.levels[self.state.current_level].pop_front()
    }

    pub fn queued(&self) -> Vec<T> {
        self.state
            .levels
            .iter()
            .rev()
            .flat_map(|level| level.iter().cloned())
            .collect()
    }

    /// The predicate supplies the source phase-type test and optional filter.
    pub fn add_after_where(&mut self, phase: T, mut matches: impl FnMut(&T) -> bool) -> Result<(), CurrentPhaseTreeError> {
        self.room()?;
        for level in self.state.levels.iter_mut().rev() {
            if let Some(index) = level.iter().position(&mut matches) {
                level.insert(index + 1, phase);
                return Ok(());
            }
        }
        self.add_phase(phase, false)
    }

    pub fn find_where(&self, mut matches: impl FnMut(&T) -> bool) -> Option<&T> {
        for level in self.state.levels.iter().rev() {
            if let Some(phase) = level.iter().find(|phase| matches(phase)) {
                return Some(phase);
            }
        }
        None
    }

    pub fn find_all_where(&self, mut matches: impl FnMut(&T) -> bool) -> Vec<&T> {
        self.state.levels.iter().rev().flat_map(|level| level.iter()).filter(|phase| matches(phase)).collect()
    }

    pub fn remove_where(&mut self, mut matches: impl FnMut(&T) -> bool) -> bool {
        for level in self.state.levels.iter_mut().rev() {
            if let Some(index) = level.iter().position(&mut matches) {
                level.remove(index);
                return true;
            }
        }
        false
    }

    pub fn remove_all_where(&mut self, mut matches: impl FnMut(&T) -> bool) {
        for level in &mut self.state.levels {
            level.retain(|phase| !matches(phase));
        }
    }

    pub fn exists_where(&self, mut matches: impl FnMut(&T) -> bool) -> bool {
        // Unlike find, source exists visits the root level first.
        let mut source_levels = self.state.levels.iter();
        source_levels.any(|level| level.iter().any(&mut matches))
    }

    pub fn clear(&mut self, leave_first_level: bool) {
        let retained = if leave_first_level {
            self.state.levels.last().cloned().unwrap_or_default()
        } else {
            VecDeque::new()
        };
        self.state.levels = vec![retained];
        self.state.current_level = 0;
        // The source deliberately leaves deferredActive untouched here.
    }
}
