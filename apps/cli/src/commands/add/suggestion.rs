//! Suggestions: durable proposals the importer must not auto-create — a new
//! project or organization. Each suggestion is *actionable* (accepting it performs
//! the typed write and relinks the cited records) and *cites evidence* (the
//! interactions/people that prompted it). Proposals dedupe by (kind, normalized
//! title) across every status, so a dismissal is permanent and the agent never
//! re-raises something the user already accepted or declined. This is a curation
//! queue awaiting ratification, not an automation log.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::organization::{find_or_create_organization, insert_organization_links};
use super::project::{find_or_create_project, insert_project_links};
use super::text::{normalize_name, normalize_optional, normalize_title};
use crate::commands::{LinkKind, LinkRef};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum SuggestionKind {
    Project,
    Organization,
}

impl SuggestionKind {
    fn as_str(self) -> &'static str {
        match self {
            SuggestionKind::Project => "create_project",
            SuggestionKind::Organization => "create_organization",
        }
    }
}

pub struct SuggestArgs<'a> {
    pub kind: SuggestionKind,
    pub title: &'a str,
    pub summary: Option<&'a str>,
    pub domain: Option<&'a str>,
    pub org_kind: Option<&'a str>,
    pub rationale: Option<&'a str>,
    pub links: Vec<LinkRef>,
}

fn link_kind_str(kind: LinkKind) -> &'static str {
    kind.as_str()
}

fn link_kind_from_str(value: &str) -> Option<LinkKind> {
    match value {
        "person" => Some(LinkKind::Person),
        "organization" => Some(LinkKind::Organization),
        "project" => Some(LinkKind::Project),
        "task" => Some(LinkKind::Task),
        "document" => Some(LinkKind::Document),
        "interaction" => Some(LinkKind::Interaction),
        _ => None,
    }
}

/// Insert the evidence links for a suggestion (deduped by the table's UNIQUE).
fn insert_suggestion_links(
    conn: &Connection,
    suggestion_id: &str,
    links: &[LinkRef],
) -> Result<(), CliError> {
    for link in links {
        conn.execute(
            "INSERT OR IGNORE INTO suggestion_links (id, suggestion_id, record_type, record_id)
             VALUES (?1,?2,?3,?4)",
            params![new_id(), suggestion_id, link_kind_str(link.kind), link.id],
        )?;
    }
    Ok(())
}

/// The cited records of a suggestion, as `LinkRef`s for relinking on accept.
fn suggestion_links(conn: &Connection, suggestion_id: &str) -> Result<Vec<LinkRef>, CliError> {
    let mut stmt = conn.prepare(
        "SELECT record_type, record_id FROM suggestion_links
         WHERE suggestion_id = ?1 ORDER BY created_at ASC, id ASC",
    )?;
    let rows = stmt.query_map(params![suggestion_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut links = Vec::new();
    for row in rows {
        let (record_type, id) = row?;
        if let Some(kind) = link_kind_from_str(&record_type) {
            links.push(LinkRef { kind, id });
        }
    }
    Ok(links)
}

pub fn suggest(conn: &mut Connection, json: bool, args: SuggestArgs) -> Result<(), CliError> {
    let title = normalize_title(Some(args.title))
        .ok_or_else(|| CliError::Runtime("a suggestion needs a title".into()))?;
    let kind = args.kind.as_str();
    let key = normalize_name(&title);

    // Dedupe by (kind, normalized title) across ALL statuses so a dismissed or
    // accepted proposal is never re-raised.
    let mut stmt = conn.prepare("SELECT id, title, status FROM suggestions WHERE kind = ?1")?;
    let rows = stmt.query_map(params![kind], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut matched = None;
    for row in rows {
        let (id, existing_title, status) = row?;
        if normalize_name(&existing_title) == key {
            matched = Some((id, status));
            break;
        }
    }
    drop(stmt);
    if let Some((id, status)) = matched {
        // Merge any newly cited evidence into an existing *open* proposal
        // (INSERT OR IGNORE dedupes the pairs); a resolved proposal is left
        // untouched so an accepted/dismissed decision is never reopened or grown.
        if status == "open" && !args.links.is_empty() {
            let tx = conn.transaction()?;
            insert_suggestion_links(&tx, &id, &args.links)?;
            tx.commit()?;
        }
        return report_suggestion(json, &id, kind, &status, true);
    }

    let payload = json!({
        "name": title,
        "summary": normalize_optional(args.summary),
        "domain": normalize_optional(args.domain),
        "kind": normalize_optional(args.org_kind),
    });
    let id = new_id();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO suggestions (id, kind, title, payload_json, rationale)
         VALUES (?1,?2,?3,?4,?5)",
        params![
            id,
            kind,
            title,
            payload.to_string(),
            normalize_optional(args.rationale),
        ],
    )?;
    insert_suggestion_links(&tx, &id, &args.links)?;
    tx.commit()?;
    report_suggestion(json, &id, kind, "open", false)
}

pub fn list_suggestions(conn: &Connection, json: bool, status: &str) -> Result<(), CliError> {
    let all = status.eq_ignore_ascii_case("all");
    let mut stmt = conn.prepare(
        "SELECT id, kind, title, rationale, status, payload_json, created_at
         FROM suggestions
         WHERE (?1 = 1 OR status = ?2)
         ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt.query_map(params![i64::from(all), status.to_lowercase()], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, String>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, String>(6)?,
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (id, kind, title, rationale, status, payload_json, created_at) = row?;
        let payload: Value = payload_json
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok())
            .unwrap_or(Value::Null);
        let links = suggestion_links(conn, &id)?;
        out.push(json!({
            "id": id,
            "kind": kind,
            "title": title,
            "rationale": rationale,
            "status": status,
            "payload": payload,
            "links": links.iter().map(|link| json!({
                "recordType": link_kind_str(link.kind),
                "recordId": link.id,
            })).collect::<Vec<_>>(),
            "createdAt": created_at,
        }));
    }
    if json {
        print_json(&json!({ "suggestions": out }))
    } else {
        if out.is_empty() {
            println!("no suggestions");
        }
        for item in &out {
            println!(
                "{} [{}] {} ({})",
                item["id"].as_str().unwrap_or(""),
                item["kind"].as_str().unwrap_or(""),
                item["title"].as_str().unwrap_or(""),
                item["status"].as_str().unwrap_or(""),
            );
        }
        Ok(())
    }
}

struct SuggestionRow {
    kind: String,
    title: String,
    payload: Value,
    status: String,
}

fn load_suggestion(conn: &Connection, id: &str) -> Result<SuggestionRow, CliError> {
    let row = conn
        .query_row(
            "SELECT kind, title, payload_json, status FROM suggestions WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| CliError::NotFound(format!("no suggestion {id}")))?;
    let (kind, title, payload_json, status) = row;
    let payload: Value = payload_json
        .as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or(Value::Null);
    Ok(SuggestionRow {
        kind,
        title,
        payload,
        status,
    })
}

pub fn accept_suggestion(conn: &mut Connection, json: bool, id: &str) -> Result<(), CliError> {
    let suggestion = load_suggestion(conn, id)?;
    if suggestion.status != "open" {
        return Err(CliError::Runtime(format!(
            "suggestion {id} is already {}",
            suggestion.status
        )));
    }
    let payload_str = |key: &str| -> Option<String> {
        suggestion
            .payload
            .get(key)
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
    };
    let links = suggestion_links(conn, id)?;
    let tx = conn.transaction()?;
    let (record_type, record_id) = match suggestion.kind.as_str() {
        "create_project" => {
            let name = payload_str("name").unwrap_or_else(|| suggestion.title.clone());
            let project_id = find_or_create_project(&tx, &name, payload_str("summary").as_deref())?;
            insert_project_links(&tx, &project_id, &links)?;
            ("project", project_id)
        }
        "create_organization" => {
            // Relink cited interactions/documents/projects to the org as
            // provenance. Cited *people* are evidence, NOT asserted employees —
            // auto-affiliating them would manufacture relationships the user never
            // confirmed; use `brain affiliate` / `add person --org` for employment.
            let name = payload_str("name").unwrap_or_else(|| suggestion.title.clone());
            let org_id = find_or_create_organization(
                &tx,
                &name,
                payload_str("domain").as_deref(),
                payload_str("kind").as_deref(),
            )?;
            insert_organization_links(&tx, &org_id, &links)?;
            ("organization", org_id)
        }
        other => {
            return Err(CliError::Runtime(format!(
                "cannot accept suggestion of unknown kind '{other}'"
            )));
        }
    };
    tx.execute(
        "UPDATE suggestions
         SET status = 'accepted',
             resolved_record_type = ?2,
             resolved_record_id = ?3,
             resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id, record_type, record_id],
    )?;
    tx.commit()?;
    if json {
        print_json(&json!({
            "kind": "suggestion",
            "id": id,
            "status": "accepted",
            "recordType": record_type,
            "recordId": record_id,
        }))
    } else {
        println!("suggestion {id} accepted -> {record_type} {record_id}");
        Ok(())
    }
}

pub fn dismiss_suggestion(conn: &mut Connection, json: bool, id: &str) -> Result<(), CliError> {
    let suggestion = load_suggestion(conn, id)?;
    if suggestion.status != "open" {
        return Err(CliError::Runtime(format!(
            "suggestion {id} is already {}",
            suggestion.status
        )));
    }
    conn.execute(
        "UPDATE suggestions
         SET status = 'dismissed',
             resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![id],
    )?;
    if json {
        print_json(&json!({ "kind": "suggestion", "id": id, "status": "dismissed" }))
    } else {
        println!("suggestion {id} dismissed");
        Ok(())
    }
}

fn report_suggestion(
    json: bool,
    id: &str,
    kind: &str,
    status: &str,
    duplicate: bool,
) -> Result<(), CliError> {
    if json {
        print_json(&json!({
            "kind": "suggestion",
            "id": id,
            "suggestionKind": kind,
            "status": status,
            "isDuplicate": duplicate,
        }))
    } else {
        if duplicate {
            println!("suggestion {id} ({status}, already exists)");
        } else {
            println!("suggestion {id} ({kind})");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn interaction_id(conn: &Connection) -> String {
        let id = new_id();
        conn.execute(
            "INSERT INTO interactions (id, title, body_text) VALUES (?1, 'Thread', 'body')",
            params![id],
        )
        .unwrap();
        id
    }

    fn project_suggestion<'a>(title: &'a str, links: Vec<LinkRef>) -> SuggestArgs<'a> {
        SuggestArgs {
            kind: SuggestionKind::Project,
            title,
            summary: Some("interior design thread"),
            domain: None,
            org_kind: None,
            rationale: Some("multi-party design thread looks project-shaped"),
            links,
        }
    }

    #[test]
    fn suggest_dedupes_by_kind_and_title_across_statuses() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        suggest(
            &mut conn,
            true,
            project_suggestion("West Elizabeth", vec![]),
        )
        .unwrap();
        // A second identical proposal must not create a second row.
        suggest(
            &mut conn,
            true,
            project_suggestion("  west   elizabeth ", vec![]),
        )
        .unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM suggestions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1, "same proposal deduped");
    }

    #[test]
    fn accept_create_project_creates_and_relinks_cited_interaction() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        let interaction = interaction_id(&conn);
        suggest(
            &mut conn,
            true,
            project_suggestion(
                "West Elizabeth",
                vec![LinkRef {
                    kind: LinkKind::Interaction,
                    id: interaction.clone(),
                }],
            ),
        )
        .unwrap();
        let suggestion_id: String = conn
            .query_row("SELECT id FROM suggestions", [], |row| row.get(0))
            .unwrap();
        accept_suggestion(&mut conn, true, &suggestion_id).unwrap();

        let project_id: String = conn
            .query_row(
                "SELECT resolved_record_id FROM suggestions WHERE id = ?1",
                params![suggestion_id],
                |row| row.get(0),
            )
            .unwrap();
        let linked: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM project_interactions
                 WHERE project_id = ?1 AND interaction_id = ?2",
                params![project_id, interaction],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            linked, 1,
            "accept relinks the cited interaction to the project"
        );
        let status: String = conn
            .query_row(
                "SELECT status FROM suggestions WHERE id = ?1",
                params![suggestion_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(status, "accepted");
    }

    #[test]
    fn accept_create_organization_relinks_interaction_but_does_not_affiliate_people() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        // A person and an interaction both cited as evidence for the proposal.
        let person = new_id();
        conn.execute(
            "INSERT INTO people (id, full_name) VALUES (?1, 'Cited Person')",
            params![person],
        )
        .unwrap();
        let interaction = interaction_id(&conn);
        suggest(
            &mut conn,
            true,
            SuggestArgs {
                kind: SuggestionKind::Organization,
                title: "Evensen Design",
                summary: None,
                domain: Some("evensendesign.com"),
                org_kind: Some("studio"),
                rationale: Some("two correspondents share the domain"),
                links: vec![
                    LinkRef {
                        kind: LinkKind::Person,
                        id: person.clone(),
                    },
                    LinkRef {
                        kind: LinkKind::Interaction,
                        id: interaction.clone(),
                    },
                ],
            },
        )
        .unwrap();
        let sid: String = conn
            .query_row("SELECT id FROM suggestions", [], |row| row.get(0))
            .unwrap();
        accept_suggestion(&mut conn, true, &sid).unwrap();

        let org_id: String = conn
            .query_row(
                "SELECT resolved_record_id FROM suggestions WHERE id = ?1",
                params![sid],
                |row| row.get(0),
            )
            .unwrap();
        let kind: Option<String> = conn
            .query_row(
                "SELECT kind FROM organizations WHERE id = ?1",
                params![org_id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            kind.as_deref(),
            Some("studio"),
            "accept carries the proposed kind"
        );
        // The cited interaction is relinked to the new org (provenance).
        let linked_interaction: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM interaction_organizations
                 WHERE organization_id = ?1 AND interaction_id = ?2",
                params![org_id, interaction],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            linked_interaction, 1,
            "cited interaction relinks to the org"
        );
        // But the cited person is NOT turned into an employee.
        let affiliations: i64 = conn
            .query_row("SELECT COUNT(*) FROM affiliations", [], |row| row.get(0))
            .unwrap();
        assert_eq!(
            affiliations, 0,
            "cited people are evidence, not auto-affiliated employees"
        );
    }

    #[test]
    fn re_suggesting_an_open_proposal_merges_new_evidence() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        let first = interaction_id(&conn);
        suggest(
            &mut conn,
            true,
            project_suggestion(
                "West Elizabeth",
                vec![LinkRef {
                    kind: LinkKind::Interaction,
                    id: first,
                }],
            ),
        )
        .unwrap();
        let sid: String = conn
            .query_row("SELECT id FROM suggestions", [], |row| row.get(0))
            .unwrap();
        // Re-propose the same (deduped) title with a *new* cited interaction.
        let second = interaction_id(&conn);
        suggest(
            &mut conn,
            true,
            project_suggestion(
                "  west   elizabeth ",
                vec![LinkRef {
                    kind: LinkKind::Interaction,
                    id: second,
                }],
            ),
        )
        .unwrap();
        let suggestions: i64 = conn
            .query_row("SELECT COUNT(*) FROM suggestions", [], |row| row.get(0))
            .unwrap();
        assert_eq!(suggestions, 1, "still one suggestion (deduped)");
        let links: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM suggestion_links WHERE suggestion_id = ?1",
                params![sid],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(links, 2, "new evidence merged into the open proposal");
    }

    #[test]
    fn dismiss_then_resuggest_does_not_reopen() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        suggest(
            &mut conn,
            true,
            project_suggestion("West Elizabeth", vec![]),
        )
        .unwrap();
        let id: String = conn
            .query_row("SELECT id FROM suggestions", [], |row| row.get(0))
            .unwrap();
        dismiss_suggestion(&mut conn, true, &id).unwrap();
        // Re-proposing must NOT reopen or fork; the dismissal stands.
        suggest(
            &mut conn,
            true,
            project_suggestion("West Elizabeth", vec![]),
        )
        .unwrap();
        let (count, status): (i64, String) = conn
            .query_row("SELECT COUNT(*), MAX(status) FROM suggestions", [], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .unwrap();
        assert_eq!(count, 1, "no second suggestion row");
        assert_eq!(status, "dismissed", "dismissal is durable");
    }
}
