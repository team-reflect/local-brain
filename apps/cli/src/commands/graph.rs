//! `brain graph --center self` — the user-centered knowledge graph as JSON.
//! Compatible (simpler) twin of the app's `getGraph`: the self person row is the
//! hub, with typed nodes and edges drawn from the durable join tables. Interactions
//! are summarized as edge evidence instead of emitted as individual nodes. The graph
//! is intentionally uncapped; renderers should optimize layout/rendering instead of
//! shrinking the data contract.

use std::collections::{HashMap, HashSet};

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

fn ordered_pair(a: &str, b: &str) -> (String, String) {
    if a < b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}

fn add_interaction_edge(
    edges: &mut HashMap<String, (String, String, i64, Option<String>)>,
    source: &str,
    target: &str,
    occurred_at: Option<&str>,
) {
    let (source, target) = ordered_pair(source, target);
    let key = format!("{source}\0{target}\0interaction");
    let entry = edges
        .entry(key)
        .or_insert_with(|| (source, target, 0, None));
    entry.2 += 1;
    if let Some(value) = occurred_at {
        if entry.3.as_deref().map_or(true, |current| value > current) {
            entry.3 = Some(value.to_string());
        }
    }
}

fn interaction_people(
    conn: &Connection,
) -> Result<HashMap<String, Vec<(String, Option<String>)>>, CliError> {
    let mut stmt = conn.prepare(
        "SELECT ip.interaction_id, ip.person_id, i.occurred_at
           FROM interaction_participants ip
           JOIN interactions i ON i.id = ip.interaction_id
          WHERE i.archived_at IS NULL AND ip.person_id IS NOT NULL",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut grouped: HashMap<String, Vec<(String, Option<String>)>> = HashMap::new();
    for row in rows {
        let (interaction_id, person_id, occurred_at) = row?;
        grouped
            .entry(interaction_id)
            .or_default()
            .push((person_id, occurred_at));
    }
    Ok(grouped)
}

fn interaction_targets(
    conn: &Connection,
    sql: &str,
) -> Result<HashMap<String, Vec<(String, Option<String>)>>, CliError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    let mut grouped: HashMap<String, Vec<(String, Option<String>)>> = HashMap::new();
    for row in rows {
        let (interaction_id, target_id, occurred_at) = row?;
        grouped
            .entry(interaction_id)
            .or_default()
            .push((target_id, occurred_at));
    }
    Ok(grouped)
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

    let people_by_interaction = interaction_people(conn)?;
    let orgs_by_interaction = interaction_targets(
        conn,
        "SELECT io.interaction_id, io.organization_id, i.occurred_at
           FROM interaction_organizations io
           JOIN interactions i ON i.id = io.interaction_id
          WHERE i.archived_at IS NULL",
    )?;
    let projects_by_interaction = interaction_targets(
        conn,
        "SELECT pi.interaction_id, pi.project_id, i.occurred_at
           FROM project_interactions pi
           JOIN interactions i ON i.id = pi.interaction_id
          WHERE i.archived_at IS NULL",
    )?;
    let tasks_by_interaction = interaction_targets(
        conn,
        "SELECT ti.interaction_id, ti.task_id, i.occurred_at
           FROM task_interactions ti
           JOIN interactions i ON i.id = ti.interaction_id
          WHERE i.archived_at IS NULL
          UNION
         SELECT t.origin_interaction_id, t.id, i.occurred_at
           FROM tasks t
           JOIN interactions i ON i.id = t.origin_interaction_id
          WHERE t.archived_at IS NULL AND i.archived_at IS NULL",
    )?;
    let mut interaction_edges: HashMap<String, (String, String, i64, Option<String>)> =
        HashMap::new();

    for (interaction_id, people) in &people_by_interaction {
        for a in 0..people.len() {
            let (source, occurred_at) = &people[a];
            for (target, target_occurred_at) in people.iter().skip(a + 1) {
                if node_ids.contains(source) && node_ids.contains(target) {
                    add_interaction_edge(
                        &mut interaction_edges,
                        source,
                        target,
                        occurred_at.as_deref().or(target_occurred_at.as_deref()),
                    );
                }
            }
        }

        let has_self = self_id
            .as_ref()
            .is_some_and(|id| people.iter().any(|(person_id, _)| person_id == id));
        for (person_id, occurred_at) in people {
            if let Some(id) = &self_id {
                if !has_self
                    && person_id != id
                    && node_ids.contains(id)
                    && node_ids.contains(person_id)
                {
                    add_interaction_edge(
                        &mut interaction_edges,
                        id,
                        person_id,
                        occurred_at.as_deref(),
                    );
                }
            }

            for (org_id, occurred_at) in orgs_by_interaction
                .get(interaction_id)
                .into_iter()
                .flatten()
            {
                if node_ids.contains(person_id) && node_ids.contains(org_id) {
                    add_interaction_edge(
                        &mut interaction_edges,
                        person_id,
                        org_id,
                        occurred_at.as_deref(),
                    );
                }
            }
            for (project_id, occurred_at) in projects_by_interaction
                .get(interaction_id)
                .into_iter()
                .flatten()
            {
                if node_ids.contains(person_id) && node_ids.contains(project_id) {
                    add_interaction_edge(
                        &mut interaction_edges,
                        person_id,
                        project_id,
                        occurred_at.as_deref(),
                    );
                }
            }
            for (task_id, occurred_at) in tasks_by_interaction
                .get(interaction_id)
                .into_iter()
                .flatten()
            {
                if node_ids.contains(person_id) && node_ids.contains(task_id) {
                    add_interaction_edge(
                        &mut interaction_edges,
                        person_id,
                        task_id,
                        occurred_at.as_deref(),
                    );
                }
            }
        }
    }

    for (_, (source, target, count, latest)) in interaction_edges {
        edges.push(json!({
            "source": source,
            "target": target,
            "kind": "interaction",
            "interactionCount": count,
            "latestInteractionAt": latest,
        }));
    }

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
