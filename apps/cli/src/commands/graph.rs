//! `brain graph --center self` — the user-centered knowledge graph as JSON.
//! Compatible (simpler) twin of the app's `getGraph`: the self person row is the
//! hub, with typed nodes and edges drawn from the durable join tables. The graph
//! is intentionally uncapped; renderers should optimize layout/rendering instead
//! of shrinking the data contract.

use std::collections::HashSet;

use rusqlite::Connection;
use serde_json::{json, Value};

use crate::error::CliError;
use crate::output::print_json;

fn label(label: Option<String>, fallback: &str) -> String {
    let value = label.unwrap_or_default();
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return fallback.to_string();
    }
    trimmed.to_string()
}

fn collect(
    conn: &Connection,
    sql: &str,
    sql_params: &[&dyn rusqlite::ToSql],
    kind: &str,
    nodes: &mut Vec<Value>,
) -> Result<(), CliError> {
    let mut stmt = conn.prepare(sql)?;
    let rows: Vec<(String, Option<String>)> = stmt
        .query_map(sql_params, |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    for (id, raw_label) in rows {
        nodes.push(json!({ "id": id, "kind": kind, "label": label(raw_label, kind) }));
    }
    Ok(())
}

fn node_id(node: &Value) -> Option<&str> {
    node.get("id").and_then(Value::as_str)
}

fn edges_from(
    conn: &Connection,
    sql: &str,
    kind: &str,
    node_ids: &HashSet<String>,
) -> Result<Vec<Value>, CliError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;
    let mut edges = Vec::new();
    for row in rows {
        let (source, target) = row?;
        if node_ids.contains(&source) && node_ids.contains(&target) {
            edges.push(json!({ "source": source, "target": target, "kind": kind }));
        }
    }
    Ok(edges)
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

    if let Some(id) = &self_id {
        let raw_label: Option<String> = conn
            .query_row("SELECT full_name FROM people WHERE id = ?1", [id], |row| {
                row.get(0)
            })
            .ok();
        nodes.push(json!({ "id": id, "kind": "self", "label": label(raw_label, "You") }));
    }

    // Exclude the self row from the people nodes with a bound parameter rather
    // than interpolating the id into the SQL string.
    let (people_sql, people_params): (String, Vec<&dyn rusqlite::ToSql>) = match &self_id {
        Some(id) => (
            "SELECT id, full_name FROM people WHERE archived_at IS NULL AND is_self = 0 AND id <> ?1 ORDER BY full_name ASC".to_string(),
            vec![id],
        ),
        None => (
            "SELECT id, full_name FROM people WHERE archived_at IS NULL AND is_self = 0 ORDER BY full_name ASC".to_string(),
            Vec::new(),
        ),
    };

    collect(conn, &people_sql, &people_params, "person", &mut nodes)?;
    collect(
        conn,
        "SELECT id, name FROM organizations WHERE archived_at IS NULL ORDER BY name ASC",
        &[],
        "organization",
        &mut nodes,
    )?;
    collect(
        conn,
        "SELECT id, name FROM projects WHERE archived_at IS NULL ORDER BY created_at DESC",
        &[],
        "project",
        &mut nodes,
    )?;
    collect(
        conn,
        "SELECT id, title FROM tasks WHERE archived_at IS NULL ORDER BY created_at DESC",
        &[],
        "task",
        &mut nodes,
    )?;
    collect(
        conn,
        "SELECT id, title FROM documents WHERE archived_at IS NULL ORDER BY created_at DESC",
        &[],
        "document",
        &mut nodes,
    )?;
    collect(
        conn,
        "SELECT id, COALESCE(title, kind) FROM interactions WHERE archived_at IS NULL ORDER BY occurred_at DESC",
        &[],
        "interaction",
        &mut nodes,
    )?;
    collect(
        conn,
        "SELECT id, claim FROM memories WHERE archived_at IS NULL ORDER BY created_at DESC",
        &[],
        "memory",
        &mut nodes,
    )?;

    let node_ids: HashSet<String> = nodes
        .iter()
        .filter_map(node_id)
        .map(ToOwned::to_owned)
        .collect();

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
        &node_ids,
    )?);
    edges.extend(edges_from(
        conn,
        "SELECT project_id, person_id FROM project_people",
        "member",
        &node_ids,
    )?);
    edges.extend(edges_from(
        conn,
        "SELECT interaction_id, person_id FROM interaction_participants WHERE person_id IS NOT NULL",
        "participant",
        &node_ids,
    )?);
    edges.extend(edges_from(
        conn,
        "SELECT project_id, id FROM tasks WHERE project_id IS NOT NULL AND archived_at IS NULL",
        "task",
        &node_ids,
    )?);
    edges.extend(edges_from(
        conn,
        "SELECT memory_id, record_id FROM memory_links",
        "memory",
        &node_ids,
    )?);

    let graph = json!({
        "selfId": self_id,
        "nodes": nodes,
        "edges": edges,
    });

    if json {
        print_json(&graph)
    } else {
        println!("{}", serde_json::to_string_pretty(&graph)?);
        Ok(())
    }
}
