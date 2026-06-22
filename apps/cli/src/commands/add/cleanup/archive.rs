use rusqlite::{params, Connection};
use serde_json::json;

use super::super::text::normalize_optional;
use super::{
    insert_cleanup_provenance, require_active_organization, require_active_person, ArchiveArgs,
    ArchiveKind,
};
use crate::commands::now_iso;
use crate::error::CliError;
use crate::output::print_json;

pub fn archive_record(
    conn: &mut Connection,
    json_output: bool,
    args: ArchiveArgs,
) -> Result<(), CliError> {
    if normalize_optional(Some(args.reason)).is_none() {
        return Err(CliError::Runtime("--reason cannot be blank".into()));
    }
    match args.kind {
        ArchiveKind::Person => require_active_person(conn, args.id)?,
        ArchiveKind::Organization => {
            require_active_organization(conn, args.id)?;
            let current_affiliations: i64 = conn.query_row(
                "SELECT COUNT(*)
                 FROM affiliations a
                 JOIN people p ON p.id = a.person_id AND p.archived_at IS NULL
                 WHERE a.organization_id = ?1 AND a.is_current = 1",
                params![args.id],
                |row| row.get(0),
            )?;
            if current_affiliations > 0 {
                return Err(CliError::Runtime(format!(
                    "organization {} still has {current_affiliations} current active affiliation(s); unlink first",
                    args.id
                )));
            }
        }
    }
    let tx = conn.transaction()?;
    let now = now_iso(&tx)?;
    let sql = format!(
        "UPDATE {}
         SET archived_at = COALESCE(archived_at, ?2),
             updated_at = ?2
         WHERE id = ?1 AND archived_at IS NULL",
        args.kind.table()
    );
    let changed = tx.execute(&sql, params![args.id, now])?;
    insert_cleanup_provenance(
        &tx,
        args.kind.record_type(),
        args.id,
        "archived",
        Some(args.reason),
    )?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "archive",
            "recordType": args.kind.record_type(),
            "id": args.id,
            "archived": changed > 0,
        }))
    } else {
        println!("archived {}:{}", args.kind.record_type(), args.id);
        Ok(())
    }
}
