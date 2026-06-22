use rusqlite::{params, Connection};
use serde_json::json;

use super::super::identity::{insert_record_provenance, RecordProvenanceWrite};
use super::super::record_ref::{parse_record_ref, require_record};
use super::super::text::normalize_optional;
use super::{sync_person_current_affiliation, UnlinkArgs};
use crate::error::CliError;
use crate::output::print_json;

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

fn relation_key(a: &str, b: &str) -> String {
    if a <= b {
        format!("{a}|{b}")
    } else {
        format!("{b}|{a}")
    }
}

fn id_for<'a>(kind: &str, left: (&'a str, &'a str), right: (&'a str, &'a str)) -> &'a str {
    if left.0 == kind {
        left.1
    } else {
        right.1
    }
}

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
    let key = relation_key(&left_kind, &right_kind);
    let tx = conn.transaction()?;
    let changed = match key.as_str() {
        "organization|person" => {
            let person_id = id_for("person", (&left_kind, &left_id), (&right_kind, &right_id));
            let organization_id =
                id_for("organization", (&left_kind, &left_id), (&right_kind, &right_id));
            let changed = tx.execute(
                "DELETE FROM affiliations WHERE person_id = ?1 AND organization_id = ?2",
                params![person_id, organization_id],
            )?;
            if changed > 0 {
                sync_person_current_affiliation(&tx, person_id)?;
            }
            changed
        }
        "person|project" => tx.execute(
            "DELETE FROM project_people WHERE person_id = ?1 AND project_id = ?2",
            params![
                id_for("person", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for("project", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "person|task" => tx.execute(
            "DELETE FROM task_people WHERE person_id = ?1 AND task_id = ?2",
            params![
                id_for("person", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for("task", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "interaction|person" => tx.execute(
            "DELETE FROM interaction_participants WHERE interaction_id = ?1 AND person_id = ?2",
            params![
                id_for(
                    "interaction",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                ),
                id_for("person", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "document|person" => tx.execute(
            "DELETE FROM document_people WHERE document_id = ?1 AND person_id = ?2",
            params![
                id_for("document", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for("person", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "organization|project" => tx.execute(
            "DELETE FROM project_organizations WHERE organization_id = ?1 AND project_id = ?2",
            params![
                id_for(
                    "organization",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                ),
                id_for("project", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "document|organization" => tx.execute(
            "DELETE FROM document_organizations WHERE document_id = ?1 AND organization_id = ?2",
            params![
                id_for("document", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for(
                    "organization",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                )
            ],
        )?,
        "interaction|organization" => tx.execute(
            "DELETE FROM interaction_organizations WHERE interaction_id = ?1 AND organization_id = ?2",
            params![
                id_for(
                    "interaction",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                ),
                id_for(
                    "organization",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                )
            ],
        )?,
        "organization|task" => tx.execute(
            "DELETE FROM task_organizations WHERE organization_id = ?1 AND task_id = ?2",
            params![
                id_for(
                    "organization",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                ),
                id_for("task", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "project|task" => tx.execute(
            "UPDATE tasks
             SET project_id = NULL,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1 AND project_id = ?2",
            params![
                id_for("task", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for("project", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "document|project" => tx.execute(
            "DELETE FROM project_documents WHERE document_id = ?1 AND project_id = ?2",
            params![
                id_for("document", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for("project", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "interaction|project" => tx.execute(
            "DELETE FROM project_interactions WHERE interaction_id = ?1 AND project_id = ?2",
            params![
                id_for(
                    "interaction",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                ),
                id_for("project", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "document|task" => tx.execute(
            "DELETE FROM task_documents WHERE document_id = ?1 AND task_id = ?2",
            params![
                id_for("document", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for("task", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "interaction|task" => tx.execute(
            "DELETE FROM task_interactions WHERE interaction_id = ?1 AND task_id = ?2",
            params![
                id_for(
                    "interaction",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                ),
                id_for("task", (&left_kind, &left_id), (&right_kind, &right_id))
            ],
        )?,
        "document|interaction" => tx.execute(
            "DELETE FROM document_interactions WHERE document_id = ?1 AND interaction_id = ?2",
            params![
                id_for("document", (&left_kind, &left_id), (&right_kind, &right_id)),
                id_for(
                    "interaction",
                    (&left_kind, &left_id),
                    (&right_kind, &right_id)
                )
            ],
        )?,
        key if key.starts_with("asset|") => {
            let other_kind = if left_kind == "asset" {
                right_kind.as_str()
            } else {
                left_kind.as_str()
            };
            let other_id = if left_kind == "asset" {
                right_id.as_str()
            } else {
                left_id.as_str()
            };
            tx.execute(
                "DELETE FROM asset_links
                 WHERE asset_id = ?1 AND record_type = ?2 AND record_id = ?3",
                params![
                    id_for("asset", (&left_kind, &left_id), (&right_kind, &right_id)),
                    other_kind,
                    other_id
                ],
            )?
        }
        _ => {
            return Err(CliError::Runtime(format!(
                "no typed link between {left_kind} and {right_kind}"
            )));
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
