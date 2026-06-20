//! `brain graph --center self` — the user-centered knowledge graph as JSON.
//! Compatible (simpler) twin of the app's `getGraph`: the self person row is the
//! hub, with typed nodes and edges drawn from the durable join tables. Interactions
//! are summarized as weighted person-to-person edge evidence instead of emitted as
//! individual nodes. The graph is intentionally uncapped; renderers should optimize
//! layout/rendering instead of shrinking the data contract.

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
    edges: &mut HashMap<String, (String, String, i64, String)>,
    source: &str,
    target: &str,
    interaction_id: &str,
    recency_rank: &HashMap<String, usize>,
) {
    if source == target {
        return;
    }
    let (source, target) = ordered_pair(source, target);
    let key = format!("{source}\0{target}");
    let entry = edges
        .entry(key)
        .or_insert_with(|| (source, target, 0, interaction_id.to_string()));
    entry.2 += 1;

    let incoming = recency_rank
        .get(interaction_id)
        .copied()
        .unwrap_or(usize::MAX);
    let current = recency_rank.get(&entry.3).copied().unwrap_or(usize::MAX);
    if incoming < current {
        entry.3 = interaction_id.to_string();
    }
}

fn active_interaction_ranks(conn: &Connection) -> Result<HashMap<String, usize>, CliError> {
    let mut interactions_stmt = conn.prepare(
        "SELECT id FROM interactions WHERE archived_at IS NULL ORDER BY occurred_at DESC",
    )?;
    let interaction_rows = interactions_stmt.query_map([], |row| row.get::<_, String>(0))?;
    let mut recency_rank = HashMap::new();
    for (index, row) in interaction_rows.enumerate() {
        recency_rank.insert(row?, index);
    }
    Ok(recency_rank)
}

fn interaction_people(
    conn: &Connection,
    person_ids: &HashSet<String>,
    recency_rank: &HashMap<String, usize>,
) -> Result<HashMap<String, HashSet<String>>, CliError> {
    let mut participants_stmt = conn.prepare(
        "SELECT interaction_id, person_id
           FROM interaction_participants
          WHERE person_id IS NOT NULL",
    )?;
    let participants = participants_stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut people_by_interaction: HashMap<String, HashSet<String>> = HashMap::new();
    for participant in participants {
        let (interaction_id, person_id) = participant?;
        if !recency_rank.contains_key(&interaction_id) || !person_ids.contains(&person_id) {
            continue;
        }
        people_by_interaction
            .entry(interaction_id)
            .or_default()
            .insert(person_id);
    }
    Ok(people_by_interaction)
}

fn derive_interaction_edges(
    people_by_interaction: &HashMap<String, HashSet<String>>,
    recency_rank: &HashMap<String, usize>,
    self_id: Option<&str>,
) -> Vec<Value> {
    let mut interaction_edges: HashMap<String, (String, String, i64, String)> = HashMap::new();
    for (interaction_id, people) in people_by_interaction {
        let people: Vec<&String> = people.iter().collect();
        if people.len() >= 2 {
            for a in 0..people.len() {
                for b in (a + 1)..people.len() {
                    add_interaction_edge(
                        &mut interaction_edges,
                        people[a],
                        people[b],
                        interaction_id,
                        recency_rank,
                    );
                }
            }
        } else if let (Some(id), Some(person_id)) = (self_id, people.first()) {
            add_interaction_edge(
                &mut interaction_edges,
                id,
                person_id,
                interaction_id,
                recency_rank,
            );
        }
    }

    interaction_edges
        .into_values()
        .map(|(source, target, weight, interaction_id)| {
            json!({
                "source": source,
                "target": target,
                "kind": "interaction",
                "weight": weight,
                "interactionId": interaction_id,
            })
        })
        .collect()
}

fn derive_memory_edges(
    conn: &Connection,
    node_ids: &HashSet<String>,
    people_by_interaction: &HashMap<String, HashSet<String>>,
    recency_rank: &HashMap<String, usize>,
    self_id: Option<&str>,
) -> Result<Vec<Value>, CliError> {
    let mut stmt = conn.prepare("SELECT memory_id, record_type, record_id FROM memory_links")?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut edges = Vec::new();
    let mut seen = HashSet::new();
    let mut push = |memory_id: &str, record_id: &str| {
        if !node_ids.contains(memory_id) || !node_ids.contains(record_id) {
            return;
        }
        let key = format!("{memory_id}\0{record_id}");
        if !seen.insert(key) {
            return;
        }
        edges.push(json!({ "source": memory_id, "target": record_id, "kind": "memory" }));
    };

    for row in rows {
        let (memory_id, record_type, record_id) = row?;
        if record_type == "interaction" {
            if let Some(people) = people_by_interaction
                .get(&record_id)
                .filter(|p| !p.is_empty())
            {
                for person_id in people {
                    push(&memory_id, person_id);
                }
            } else if recency_rank.contains_key(&record_id) {
                if let Some(id) = self_id {
                    push(&memory_id, id);
                }
            }
        } else {
            push(&memory_id, &record_id);
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
    let person_ids: HashSet<String> = nodes
        .iter()
        .filter(|node| node["kind"] == "self" || node["kind"] == "person")
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
    let recency_rank = active_interaction_ranks(conn)?;
    let people_by_interaction = interaction_people(conn, &person_ids, &recency_rank)?;
    edges.extend(derive_memory_edges(
        conn,
        &node_ids,
        &people_by_interaction,
        &recency_rank,
        self_id.as_deref(),
    )?);
    edges.extend(derive_interaction_edges(
        &people_by_interaction,
        &recency_rank,
        self_id.as_deref(),
    ));

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
