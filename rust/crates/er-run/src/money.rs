//! Checked money arithmetic for the selected M4 slice.
//!
//! `Money` is a validated safe-integer newtype (`rust/contracts/m4-api.md`).
//! Payment cannot underflow; rewards cannot overflow; both failures are typed
//! and never saturate silently (`rust/contracts/m4-reward-market.md`).

use er_types::run_ids::Money;
use thiserror::Error;

#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
pub enum MoneyError {
    #[error("payment would underflow the money balance")]
    Underflow,
    #[error("reward would overflow the money balance")]
    Overflow,
}

/// Adds a non-negative reward delta to a balance.
pub fn credit(balance: Money, delta: u64) -> Result<Money, MoneyError> {
    let next = balance
        .get()
        .get()
        .checked_add(delta)
        .ok_or(MoneyError::Overflow)?;
    Ok(Money::new(
        er_types::SafeU53::new(next).map_err(|_| MoneyError::Overflow)?,
    ))
}

/// Subtracts a non-negative payment from a balance.
pub fn debit(balance: Money, amount: u64) -> Result<Money, MoneyError> {
    let current = balance.get().get();
    if amount > current {
        return Err(MoneyError::Underflow);
    }
    let next = current - amount;
    Ok(Money::new(
        er_types::SafeU53::new(next).map_err(|_| MoneyError::Underflow)?,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use er_types::SafeU53;

    fn money(value: u64) -> Money {
        Money::new(SafeU53::new(value).expect("safe money"))
    }

    #[test]
    fn credit_and_debit_round_trip() {
        let balance = money(1_000);
        assert_eq!(credit(balance, 250).expect("credit").get().get(), 1_250);
        assert_eq!(debit(balance, 400).expect("debit").get().get(), 600);
    }

    #[test]
    fn underflow_is_typed_not_saturating() {
        assert_eq!(debit(money(100), 101), Err(MoneyError::Underflow));
    }

    #[test]
    fn overflow_beyond_safe_integer_is_typed() {
        assert_eq!(
            credit(money(er_types::SafeU53::MAX.get()), 1),
            Err(MoneyError::Overflow)
        );
    }
}
