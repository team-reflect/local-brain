//! `brain add document` — ingest a reference document (record + derived chunks +
//! links) in one transaction, deduped on its normalized-body content hash.

use rusqlite::{params, Connection};

use super::identity::find_duplicate;
use super::links::{insert_chunks, insert_links};
use super::report_record;
use super::text::{normalize_optional, normalize_title};
use crate::commands::LinkRef;
use crate::error::CliError;
use crate::id::new_id;
use crate::text::{content_hash, normalize_text};

pub struct AddDocumentArgs<'a> {
    pub title: Option<&'a str>,
    pub kind: Option<&'a str>,
    pub body: String,
    pub links: Vec<LinkRef>,
    pub allow_duplicate: bool,
}

pub fn add_document(
    conn: &mut Connection,
    json: bool,
    args: AddDocumentArgs,
) -> Result<(), CliError> {
    let body = normalize_text(&args.body);
    let title = normalize_title(args.title);
    // Parity with the core `validateNewDocument`: both columns are nullable in
    // SQLite, so reject a document with neither a title nor a body.
    if title.is_none() && body.is_empty() {
        return Err(CliError::Runtime(
            "a document needs a title or body text".into(),
        ));
    }
    let hash = content_hash(&body);
    if let Some(existing) = find_duplicate(conn, "documents", &hash)? {
        if !args.allow_duplicate {
            return report_record(json, "document", &existing, true, 0);
        }
    }
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO documents (id, title, kind, body_text, content_hash) VALUES (?1,?2,?3,?4,?5)",
        params![id, title, normalize_optional(args.kind), body, hash],
    )?;
    let count = insert_chunks(&tx, "document", &id, &body)?;
    insert_links(&tx, "document", &id, &args.links)?;
    tx.commit()?;
    report_record(json, "document", &id, false, count)
}
