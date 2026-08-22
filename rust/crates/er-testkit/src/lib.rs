//! Test-only fixture, assertion, and raw-keyboard utilities.

pub mod assertions;
pub mod fixture;
pub mod keyboard_driver;
pub mod m3_fixture;
pub mod m4_fixture;

pub use assertions::{AssertionError, assert_fixture_digest, assert_fixture_round_trip};
pub use fixture::{
    FixtureEnvelope, FixtureError, fixture_path, load_fixture, load_fixture_envelope,
};
pub use keyboard_driver::{
    DetachedKeyboardDriver, DetachedKeyboardDriverState, DriverHoldState, KeyHoldPlan,
    KeyboardDriver,
};
