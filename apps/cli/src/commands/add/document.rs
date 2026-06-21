//! `brain add document` — ingest a reference document (record + derived chunks +
//! links) in one transaction, deduped on its normalized-body content hash.

use rusqlite::{params, Connection};

use super::identity::{
    external_kind, find_duplicate, find_external_identity, insert_external_identity,
    insert_record_provenance, source_id, ExternalIdentityWrite, RecordProvenanceWrite,
};
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
    pub source_slug: Option<&'a str>,
    pub external_kind: &'a str,
    pub external_id: Option<&'a str>,
    pub original_path: Option<&'a str>,
    pub original_url: Option<&'a str>,
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
    let source_id = source_id(conn, args.source_slug)?;
    let identity_kind = external_kind(args.external_kind);
    let existing_by_external = find_external_identity(
        conn,
        "document",
        source_id.as_deref(),
        &identity_kind,
        args.external_id,
    )?;
    let existing = existing_by_external.or(find_duplicate(conn, "documents", &hash)?);
    if let Some(existing) = existing.as_deref() {
        if !args.allow_duplicate {
            let tx = conn.transaction()?;
            super::fill_blanks(
                &tx,
                "documents",
                existing,
                &[
                    ("title", title.clone()),
                    ("kind", normalize_optional(args.kind)),
                    ("original_path", normalize_optional(args.original_path)),
                    ("original_url", normalize_optional(args.original_url)),
                ],
            )?;
            insert_links(&tx, "document", existing, &args.links)?;
            insert_external_identity(
                &tx,
                ExternalIdentityWrite {
                    entity_type: "document",
                    entity_id: existing,
                    source_id: source_id.as_deref(),
                    kind: &identity_kind,
                    external_id: args.external_id,
                    url: args.original_url,
                    force_duplicate: false,
                },
            )?;
            insert_record_provenance(
                &tx,
                RecordProvenanceWrite {
                    record_type: "document",
                    record_id: existing,
                    provenance_kind: "imported",
                    source_id: source_id.as_deref(),
                    original_path: args.original_path,
                    original_url: args.original_url,
                    model: None,
                    prompt_fingerprint: None,
                    metadata_json: None,
                },
            )?;
            tx.commit()?;
            return report_record(json, "document", existing, true, 0);
        }
    }
    let body_text = if body.is_empty() {
        None
    } else {
        Some(body.as_str())
    };
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO documents
           (id, title, kind, body_text, original_path, original_url, content_hash)
         VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            id,
            title,
            normalize_optional(args.kind),
            body_text,
            normalize_optional(args.original_path),
            normalize_optional(args.original_url),
            hash,
        ],
    )?;
    let count = insert_chunks(&tx, "document", &id, &body)?;
    insert_links(&tx, "document", &id, &args.links)?;
    insert_external_identity(
        &tx,
        ExternalIdentityWrite {
            entity_type: "document",
            entity_id: &id,
            source_id: source_id.as_deref(),
            kind: &identity_kind,
            external_id: args.external_id,
            url: args.original_url,
            force_duplicate: false,
        },
    )?;
    insert_record_provenance(
        &tx,
        RecordProvenanceWrite {
            record_type: "document",
            record_id: &id,
            provenance_kind: "imported",
            source_id: source_id.as_deref(),
            original_path: args.original_path,
            original_url: args.original_url,
            model: None,
            prompt_fingerprint: None,
            metadata_json: None,
        },
    )?;
    tx.commit()?;
    report_record(json, "document", &id, false, count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn title_only_document_stores_null_body_text() {
        let mut conn = brain_schema::open_in_memory().unwrap();

        add_document(
            &mut conn,
            true,
            AddDocumentArgs {
                title: Some("Project note"),
                kind: None,
                body: "   \n\t ".to_string(),
                source_slug: None,
                external_kind: "record",
                external_id: None,
                original_path: None,
                original_url: None,
                links: vec![],
                allow_duplicate: false,
            },
        )
        .unwrap();

        let body_text: Option<String> = conn
            .query_row(
                "SELECT body_text FROM documents WHERE title = ?1",
                params!["Project note"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(body_text, None);
    }
}
