//! The `brain` CLI. Foundation scaffold: it resolves the database path
//! (`--db` > `$BRAIN_DB` > platform default), opens/migrates via the shared
//! `brain-schema` crate, and reports status. The write/read command surface
//! (add, remember, search, ask, today, report) is built in Plan 07.
//!
//! Conventions: data on stdout, diagnostics on stderr, `--json` for stable
//! machine output, typed exit codes (see `error::CliError`).

mod error;

use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use serde::Serialize;

use error::CliError;

#[derive(Parser)]
#[command(name = "brain", version, about = "Agent interface to a Local Brain database")]
struct Cli {
    /// Path to the brain database (overrides $BRAIN_DB and the default location).
    #[arg(long, global = true, value_name = "PATH")]
    db: Option<PathBuf>,

    /// Emit JSON on stdout instead of human-readable text.
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print the resolved database path and schema status.
    Status,
    /// Print the resolved database path only.
    Path,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusJson {
    db_path: String,
    exists: bool,
    schema_version: i64,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(&cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("brain: {err}");
            ExitCode::from(err.exit_code())
        }
    }
}

fn run(cli: &Cli) -> Result<(), CliError> {
    let db_path = resolve_db_path(cli.db.as_deref())?;

    match &cli.command {
        Command::Path => {
            if cli.json {
                let payload = serde_json::json!({ "dbPath": db_path.display().to_string() });
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                println!("{}", db_path.display());
            }
            Ok(())
        }
        Command::Status => {
            let exists = db_path.is_file();
            // Open + migrate to report the live schema version (creates the file).
            let conn = brain_schema::open_and_migrate(&db_path)?;
            let schema_version: i64 =
                conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

            if cli.json {
                let payload = StatusJson {
                    db_path: db_path.display().to_string(),
                    exists,
                    schema_version,
                };
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                eprintln!("database: {}", db_path.display());
                println!("ok schema v{schema_version}");
            }
            Ok(())
        }
    }
}

/// Resolve the database path: `--db` flag, then `$BRAIN_DB`, then the platform
/// data directory. Plan 02 also lets the desktop app persist a chosen path that
/// the CLI can read.
fn resolve_db_path(flag: Option<&Path>) -> Result<PathBuf, CliError> {
    if let Some(path) = flag {
        return Ok(path.to_path_buf());
    }
    if let Some(env) = std::env::var_os("BRAIN_DB") {
        if !env.is_empty() {
            return Ok(PathBuf::from(env));
        }
    }
    let base = dirs::data_dir()
        .ok_or_else(|| CliError::NoDatabase("could not resolve a data directory".to_string()))?;
    Ok(base.join("local-brain").join("brain.sqlite"))
}
