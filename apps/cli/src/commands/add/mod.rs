//! Write commands: `brain add person|asset|document|interaction|task` and
//! `brain remember`. Each write runs in a single transaction (record + derived
//! chunks + links), mirroring the app's ingest paths so provenance and dedupe
//! behave identically regardless of which tool wrote the record.
//!
//! Module layout:
//! - [`text`] — pure string normalization shared across writers.
//! - [`identity`] — sources, content-hash dedupe, and `external_identities`.
//! - [`links`] — chunk + typed-link writers for documents/interactions.
//! - [`person`] / [`person_import`] — person writes and untrusted-name guardrails.
//! - [`asset`], [`document`], [`interaction`], [`task`], [`memory`] — one entity
//!   per module, each with its own tests.

mod asset;
mod document;
mod identity;
mod interaction;
mod links;
mod memory;
mod person;
mod person_import;
mod task;
mod text;

use serde_json::json;

use crate::error::CliError;
use crate::output::print_json;

pub use asset::{add_asset, set_asset_text, AddAssetArgs};
pub use document::{add_document, AddDocumentArgs};
pub use interaction::{add_interaction, AddInteractionArgs};
pub use memory::{remember, RememberArgs};
pub use person::{add_person, add_person_from_email, AddPersonArgs, AddPersonFromEmailArgs};
pub use task::{add_task, AddTaskArgs};

/// Report a freshly-written or deduped record (document/interaction): JSON on the
/// data channel, or a one-line human summary.
pub(super) fn report_record(
    json: bool,
    kind: &str,
    id: &str,
    duplicate: bool,
    chunk_count: usize,
) -> Result<(), CliError> {
    if json {
        print_json(&json!({
            "kind": kind,
            "id": id,
            "isDuplicate": duplicate,
            "chunkCount": chunk_count,
        }))
    } else {
        if duplicate {
            println!("{kind} {id} (duplicate, skipped)");
        } else {
            println!("{kind} {id} ({chunk_count} chunks)");
        }
        Ok(())
    }
}
