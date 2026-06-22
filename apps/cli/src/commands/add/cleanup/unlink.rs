use rusqlite::{params, Connection};
use serde_json::json;

use super::super::identity::{insert_record_provenance, RecordProvenanceWrite};
use super::super::record_ref::{parse_record_ref, require_record};
use super::super::text::normalize_optional;
use super::{sync_person_current_affiliation, UnlinkArgs};
use crate::error::CliError;
use crate::output::print_json;

/// How a typed link between two record kinds is stored, so [`unlink_records`] can
/// remove it generically. Both variants reference their endpoints by *kind* (e.g.
/// `"person"`), and [`id_for`] resolves the kind to the actual id at call time, so
/// the canonical (alphabetically sorted) endpoint order is irrelevant.
enum LinkSpec {
    /// The link is a row in a join table keyed by two foreign keys; deleting the
    /// row removes the link.
    DeleteJoin {
        table: &'static str,
        a: (&'static str, &'static str),
        b: (&'static str, &'static str),
        /// After a successful delete, resync this kind's denormalized current
        /// affiliation (only the person↔organization affiliation needs it).
        resync_current_affiliation: Option<&'static str>,
    },
    /// The link is a nullable foreign-key column on one entity's own row (no join
    /// table); clearing the column removes the link.
    NullColumn {
        table: &'static str,
        /// (kind, column) identifying the row to update.
        id: (&'static str, &'static str),
        /// (kind, column) of the foreign key to clear.
        fk: (&'static str, &'static str),
    },
}

impl LinkSpec {
    fn unlink(
        &self,
        conn: &Connection,
        left: (&str, &str),
        right: (&str, &str),
    ) -> Result<usize, CliError> {
        let changed = match self {
            LinkSpec::DeleteJoin {
                table,
                a,
                b,
                resync_current_affiliation,
            } => {
                let sql = format!("DELETE FROM {table} WHERE {} = ?1 AND {} = ?2", a.1, b.1);
                let changed = conn.execute(
                    &sql,
                    params![id_for(a.0, left, right), id_for(b.0, left, right)],
                )?;
                if changed > 0 {
                    if let Some(kind) = resync_current_affiliation {
                        sync_person_current_affiliation(conn, id_for(kind, left, right))?;
                    }
                }
                changed
            }
            LinkSpec::NullColumn { table, id, fk } => {
                let sql = format!(
                    "UPDATE {table}
                     SET {fk_col} = NULL,
                         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                     WHERE {id_col} = ?1 AND {fk_col} = ?2",
                    fk_col = fk.1,
                    id_col = id.1,
                );
                conn.execute(
                    &sql,
                    params![id_for(id.0, left, right), id_for(fk.0, left, right)],
                )?
            }
        };
        Ok(changed)
    }
}

/// Typed links keyed by the canonical (sorted) `relation_key`. Adding a new
/// linkable pair is a single row here. Asset links are polymorphic
/// (`record_type` / `record_id`) and handled separately in [`unlink_records`].
const LINK_SPECS: &[(&str, LinkSpec)] = &[
    (
        "organization|person",
        LinkSpec::DeleteJoin {
            table: "affiliations",
            a: ("person", "person_id"),
            b: ("organization", "organization_id"),
            resync_current_affiliation: Some("person"),
        },
    ),
    (
        "person|project",
        LinkSpec::DeleteJoin {
            table: "project_people",
            a: ("person", "person_id"),
            b: ("project", "project_id"),
            resync_current_affiliation: None,
        },
    ),
    (
        "person|task",
        LinkSpec::DeleteJoin {
            table: "task_people",
            a: ("person", "person_id"),
            b: ("task", "task_id"),
            resync_current_affiliation: None,
        },
    ),
    (
        "interaction|person",
        LinkSpec::DeleteJoin {
            table: "interaction_participants",
            a: ("interaction", "interaction_id"),
            b: ("person", "person_id"),
            resync_current_affiliation: None,
        },
    ),
    (
        "document|person",
        LinkSpec::DeleteJoin {
            table: "document_people",
            a: ("document", "document_id"),
            b: ("person", "person_id"),
            resync_current_affiliation: None,
        },
    ),
    (
        "organization|project",
        LinkSpec::DeleteJoin {
            table: "project_organizations",
            a: ("organization", "organization_id"),
            b: ("project", "project_id"),
            resync_current_affiliation: None,
        },
    ),
    (
        "document|organization",
        LinkSpec::DeleteJoin {
            table: "document_organizations",
            a: ("document", "document_id"),
            b: ("organization", "organization_id"),
            resync_current_affiliation: None,
        },
    ),
    (
        "interaction|organization",
        LinkSpec::DeleteJoin {
            table: "interaction_organizations",
            a: ("interaction", "interaction_id"),
            b: ("organization", "organization_id"),
            resync_current_affiliation: None,
        },
    ),
    (
        "organization|task",
        LinkSpec::DeleteJoin {
            table: "task_organizations",
            a: ("organization", "organization_id"),
            b: ("task", "task_id"),
            resync_current_affiliation: None,
        },
    ),
    (
        "project|task",
        LinkSpec::NullColumn {
            table: "tasks",
            id: ("task", "id"),
            fk: ("project", "project_id"),
        },
    ),
    (
        "document|project",
        LinkSpec::DeleteJoin {
            table: "project_documents",
            a: ("document", "document_id"),
            b: ("project", "project_id"),
            resync_current_affiliation: None,
        },
    ),
    (
        "interaction|project",
        LinkSpec::DeleteJoin {
            table: "project_interactions",
            a: ("interaction", "interaction_id"),
            b: ("project", "project_id"),
            resync_current_affiliation: None,
        },
    ),
    (
        "document|task",
        LinkSpec::DeleteJoin {
            table: "task_documents",
            a: ("document", "document_id"),
            b: ("task", "task_id"),
            resync_current_affiliation: None,
        },
    ),
    (
        "interaction|task",
        LinkSpec::DeleteJoin {
            table: "task_interactions",
            a: ("interaction", "interaction_id"),
            b: ("task", "task_id"),
            resync_current_affiliation: None,
        },
    ),
    (
        "document|interaction",
        LinkSpec::DeleteJoin {
            table: "document_interactions",
            a: ("document", "document_id"),
            b: ("interaction", "interaction_id"),
            resync_current_affiliation: None,
        },
    ),
];

fn provenance_for_unlink(
    conn: &Connection,
    left_kind: &str,
    left_id: &str,
    right_kind: &str,
    right_id: &str,
    reason: &str,
) -> Result<(), CliError> {
    let metadata = json!({
        "reason": reason,
        "left": format!("{left_kind}:{left_id}"),
        "right": format!("{right_kind}:{right_id}"),
    })
    .to_string();
    for (kind, id) in [(left_kind, left_id), (right_kind, right_id)] {
        insert_record_provenance(
            conn,
            RecordProvenanceWrite {
                record_type: kind,
                record_id: id,
                provenance_kind: "unlinked",
                source_id: None,
                original_path: None,
                original_url: None,
                model: None,
                prompt_fingerprint: None,
                metadata_json: Some(metadata.as_str()),
            },
        )?;
    }
    Ok(())
}

/// Canonical key for a pair of record kinds: the two kinds sorted and joined with
/// `|`, so `(person, organization)` and `(organization, person)` map to the same
/// `LinkSpec`.
fn relation_key(a: &str, b: &str) -> String {
    if a <= b {
        format!("{a}|{b}")
    } else {
        format!("{b}|{a}")
    }
}

/// Resolve the id of whichever endpoint has the given `kind`.
fn id_for<'a>(kind: &str, left: (&'a str, &'a str), right: (&'a str, &'a str)) -> &'a str {
    if left.0 == kind {
        left.1
    } else {
        right.1
    }
}

/// Remove a polymorphic asset link (`asset_links.record_type` / `record_id`)
/// between an asset and any other record.
fn unlink_asset(
    conn: &Connection,
    left: (&str, &str),
    right: (&str, &str),
) -> Result<usize, CliError> {
    let (other_kind, other_id) = if left.0 == "asset" { right } else { left };
    Ok(conn.execute(
        "DELETE FROM asset_links
         WHERE asset_id = ?1 AND record_type = ?2 AND record_id = ?3",
        params![id_for("asset", left, right), other_kind, other_id],
    )?)
}

/// Remove a single typed link between two records, identified as `kind:id`. The
/// pair is resolved to a [`LinkSpec`] (or the polymorphic asset-link path) and the
/// matching join row deleted, or foreign key cleared, with unlink provenance on
/// both endpoints.
pub fn unlink_records(
    conn: &mut Connection,
    json_output: bool,
    args: UnlinkArgs,
) -> Result<(), CliError> {
    let reason = normalize_optional(Some(args.reason))
        .ok_or_else(|| CliError::Runtime("--reason cannot be blank".into()))?;
    let (left_kind, left_id) = parse_record_ref(args.left, "left record")?;
    let (right_kind, right_id) = parse_record_ref(args.right, "right record")?;
    require_record(conn, &left_kind, &left_id)?;
    require_record(conn, &right_kind, &right_id)?;
    let left = (left_kind.as_str(), left_id.as_str());
    let right = (right_kind.as_str(), right_id.as_str());
    let tx = conn.transaction()?;
    let changed = if left_kind == "asset" || right_kind == "asset" {
        unlink_asset(&tx, left, right)?
    } else {
        let key = relation_key(&left_kind, &right_kind);
        match LINK_SPECS.iter().find(|(spec_key, _)| *spec_key == key) {
            Some((_, spec)) => spec.unlink(&tx, left, right)?,
            None => {
                return Err(CliError::Runtime(format!(
                    "no typed link between {left_kind} and {right_kind}"
                )));
            }
        }
    };
    provenance_for_unlink(&tx, &left_kind, &left_id, &right_kind, &right_id, &reason)?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "unlink",
            "left": { "kind": left_kind, "id": left_id },
            "right": { "kind": right_kind, "id": right_id },
            "rowsRemoved": changed,
        }))
    } else {
        println!("unlinked {} and {}", args.left, args.right);
        Ok(())
    }
}
