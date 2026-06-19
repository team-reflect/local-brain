//! `brain remember` — add a hidden memory (atomic claim) with direct provenance
//! links to the records it is about. Memory + links commit in one transaction.

use rusqlite::{params, Connection};
use serde_json::json;

use super::links::insert_evidence_refs;
use crate::commands::{now_iso, EvidenceRef, LinkRef};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;

pub struct RememberArgs<'a> {
    pub kind: &'a str,
    pub claim: &'a str,
    pub links: Vec<LinkRef>,
    pub evidence: Vec<EvidenceRef>,
}

pub fn remember(conn: &mut Connection, json: bool, args: RememberArgs) -> Result<(), CliError> {
    let id = new_id();
    let created = now_iso(conn)?;
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO memories (id, kind, claim, valid_from) VALUES (?1,?2,?3,?4)",
        params![id, args.kind, args.claim, created],
    )?;
    for link in &args.links {
        tx.execute(
            "INSERT INTO memory_links (id, memory_id, record_type, record_id) VALUES (?1,?2,?3,?4)",
            params![new_id(), id, link.kind.as_str(), link.id],
        )?;
    }
    insert_evidence_refs(&tx, "memory", &id, &args.evidence)?;
    tx.commit()?;
    if json {
        print_json(&json!({
            "kind": "memory",
            "id": id,
            "links": args.links.len(),
            "evidence": args.evidence.len(),
        }))
    } else {
        println!("memory {id}");
        Ok(())
    }
}
