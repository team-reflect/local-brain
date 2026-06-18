//! Output discipline for the CLI: **stdout carries data only**, stderr carries
//! diagnostics and human-readable status. `--json` emits stable camelCase JSON
//! (snapshot-tested); without it, commands print a compact human summary. Both
//! draw from the same value so the contract can't drift.

use crate::error::CliError;

/// Print a JSON value to stdout (the data channel). Pretty-printed for humans
/// and stable for snapshot tests.
pub fn print_json(value: &serde_json::Value) -> Result<(), CliError> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

/// A diagnostic line on stderr — never part of the data contract.
pub fn diag(message: &str) {
    eprintln!("brain: {message}");
}
