//! Shared deterministic DTOs for the PokéRogue Redux Rust kernel.

pub mod authority;
pub mod ids;
pub mod input;
pub mod protocol;
pub mod trace;
pub mod ui;

pub use authority::*;
pub use ids::*;
pub use input::*;
pub use protocol::*;
pub use trace::*;
pub use ui::*;

#[cfg(test)]
mod tests {
    use crate::SafeU53;

    #[test]
    fn m1_contract_modules_are_linked() {
        assert!(SafeU53::new(1).is_ok());
    }
}
