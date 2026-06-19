//! `brain graph --center self` — the user-centered knowledge graph as JSON.
//! Compatible (simpler) twin of the app's `getGraph`: the self person row is the
//! hub, with typed nodes and edges drawn from the durable join tables. Per-kind
//! caps keep it legible; `truncatedKinds` names anything that hit the cap so the
//! output never silently implies it drew everything.

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::error::CliError;
use crate::output::print_json;

const NODE_CAP: i64 = 60;

fn truncate(label: Option<String>, fallback: &str) -> String {
    let value = label.unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    if trimmed.chars().count() > 48 {
        let short: String = trimmed.chars().take(47).collect();
        format!("{short}…")
    } else {
        trimmed.to_string()
    }
}

fn collect(
    conn: &Connection,
    sql: &str,
    sql_params: &[&dyn rusqlite::ToSql],
    kind: &str,
    nodes: &mut Vec<Value>,
    truncated: &mut Vec<String>,
) -> Result<(), CliError> {
    let mut stmt = conn.prepare(sql)?;
    let rows: Vec<(String, Option<String>)> = stmt
        .query_map(sql_params, |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    if rows.len() as i64 >= NODE_CAP {
        truncated.push(kind.to_string());
    }
    for (id, label) in rows {
        nodes.push(json!({ "id": id, "kind": kind, "label": truncate(label, kind) }));
    }
    Ok(())
}

fn edges_from(conn: &Connection, sql: &str, kind: &str) -> Result<Vec<Value>, CliError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(json!({ "source": row.get::<_, String>(0)?, "target": row.get::<_, String>(1)?, "kind": kind }))
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(CliError::from)
}

pub fn graph(conn: &Connection, json: bool) -> Result<(), CliError> {
    let self_id: Option<String> = conn
        .query_row(
            "SELECT id FROM people WHERE is_self = 1 LIMIT 1",
            [],
            |row| row.get(0),
        )
        .ok();

    let mut nodes: Vec<Value> = Vec::new();
    let mut truncated: Vec<String> = Vec::new();

    if let Some(id) = &self_id {
        let label: Option<String> = conn
            .query_row("SELECT full_name FROM people WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .ok();
        nodes.push(json!({ "id": id, "kind": "self", "label": truncate(label, "You") }));
    }

    // Exclude the self row from the people nodes with a bound parameter rather
    // than interpolating the id into the SQL string.
    let (people_sql, people_params): (String, Vec<&dyn rusqlite::ToSql>) = match &self_id {
        Some(id) => (
            format!("SELECT id, full_name FROM people WHERE archived_at IS NULL AND is_self = 0 AND id <> ?1 LIMIT {NODE_CAP}"),
            vec![id],
        ),
        None => (
            format!("SELECT id, full_name FROM people WHERE archived_at IS NULL AND is_self = 0 LIMIT {NODE_CAP}"),
            Vec::new(),
        ),
    };

    collect(
        conn,
        &people_sql,
        &people_params,
        "person",
        &mut nodes,
        &mut truncated,
    )?;
    collect(
        conn,
        &format!("SELECT id, name FROM organizations WHERE archived_at IS NULL LIMIT {NODE_CAP}"),
        &[],
        "organization",
        &mut nodes,
        &mut truncated,
    )?;
    collect(
        conn,
        &format!("SELECT id, name FROM projects WHERE archived_at IS NULL LIMIT {NODE_CAP}"),
        &[],
        "project",
        &mut nodes,
        &mut truncated,
    )?;
    collect(
        conn,
        &format!("SELECT id, title FROM tasks WHERE archived_at IS NULL LIMIT {NODE_CAP}"),
        &[],
        "task",
        &mut nodes,
        &mut truncated,
    )?;

    let mut edges: Vec<Value> = Vec::new();
    if let Some(id) = &self_id {
        // The self hub: you know the people, you own the projects.
        for person in nodes.iter().filter(|n| n["kind"] == "person") {
            edges.push(json!({ "source": id, "target": person["id"], "kind": "knows" }));
        }
        for project in nodes.iter().filter(|n| n["kind"] == "project") {
            edges.push(json!({ "source": id, "target": project["id"], "kind": "owns" }));
        }
    }
    edges.extend(edges_from(
        conn,
        "SELECT person_id, organization_id FROM affiliations",
        "affiliation",
    )?);
    edges.extend(edges_from(
        conn,
        "SELECT project_id, id FROM tasks WHERE project_id IS NOT NULL AND archived_at IS NULL",
        "task",
    )?);

    let graph = json!({
        "selfId": self_id,
        "nodes": nodes,
        "edges": edges,
        "truncatedKinds": truncated,
    });

    if json {
        print_json(&graph)
    } else {
        println!("{}", serde_json::to_string_pretty(&graph)?);
        Ok(())
    }
}
