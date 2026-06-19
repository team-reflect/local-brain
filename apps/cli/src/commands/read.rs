//! Read commands: `brain search` and `brain show`. Retrieval reuses
//! the same FTS5 contract as the app (the SQL is the shared layer), reimplemented
//! here in Rust so the CLI runs standalone.

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::{to_like_pattern, to_match_query};
use crate::error::CliError;
use crate::output::print_json;

/// bm25 (more-negative is better) -> bounded [0,1] lexical score (mirrors core).
fn lexical_score(bm25: f64) -> f64 {
    let magnitude = (-bm25).max(0.0);
    magnitude / (magnitude + 4.0)
}

/// `brain search` — full-text across documents/interactions plus name matches
/// for people/orgs/projects/tasks. Output is the data array (stdout).
pub fn search(conn: &Connection, json: bool, query: &str, limit: usize) -> Result<(), CliError> {
    let mut hits: Vec<Value> = Vec::new();

    // Mirror core `globalSearch`: a query with no searchable tokens is "no query",
    // not a request for everything. Returning early stops a wildcard-only input
    // (e.g. "%") from collapsing into a `%%` LIKE that matches every record.
    let (Some(mq), Some(like)) = (to_match_query(query, false), to_like_pattern(query)) else {
        return emit_search(json, query, &hits);
    };

    for (table, fts, kind) in [
        ("documents", "documents_fts", "document"),
        ("interactions", "interactions_fts", "interaction"),
    ] {
        let sql = format!(
            "SELECT t.id, t.title, snippet({fts}, 1, '[', ']', '…', 10), bm25({fts}, 10.0, 1.0)
             FROM {fts} JOIN {table} t ON t.rowid = {fts}.rowid
             WHERE {fts} MATCH ?1 AND t.archived_at IS NULL
             ORDER BY bm25({fts}, 10.0, 1.0) LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![mq, limit as i64], |row| {
            Ok(json!({
                "kind": kind,
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "(untitled)".into()),
                "snippet": row.get::<_, String>(2)?,
                "score": lexical_score(row.get::<_, f64>(3)?),
            }))
        })?;
        for row in rows {
            hits.push(row?);
        }
    }

    for (table, name_col, kind) in [
        ("people", "full_name", "person"),
        ("organizations", "name", "organization"),
        ("projects", "name", "project"),
        ("tasks", "title", "task"),
    ] {
        let sql = format!(
            "SELECT id, {name_col} FROM {table} WHERE archived_at IS NULL AND {name_col} LIKE ?1 ESCAPE '\\' LIMIT ?2"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![like, limit as i64], |row| {
            Ok(json!({
                "kind": kind,
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "(untitled)".into()),
                "snippet": Value::Null,
                "score": 0.6,
            }))
        })?;
        for row in rows {
            hits.push(row?);
        }
    }

    // Merge all kinds, rank by score, and apply one final cap — like the app's
    // `globalSearch`, instead of returning up to `limit` rows per source table.
    hits.sort_by(|a, b| {
        let sb = b["score"].as_f64().unwrap_or(0.0);
        let sa = a["score"].as_f64().unwrap_or(0.0);
        sb.partial_cmp(&sa).unwrap_or(std::cmp::Ordering::Equal)
    });
    hits.truncate(limit);

    emit_search(json, query, &hits)
}

/// Render `brain search` hits as a JSON data array or a compact human table.
fn emit_search(json: bool, query: &str, hits: &[Value]) -> Result<(), CliError> {
    if json {
        return print_json(&json!({ "query": query, "results": hits }));
    }
    if hits.is_empty() {
        println!("(no matches)");
    }
    for hit in hits {
        println!(
            "{:>12}  {}  {}",
            hit["kind"].as_str().unwrap_or(""),
            hit["id"].as_str().unwrap_or(""),
            hit["title"].as_str().unwrap_or("")
        );
    }
    Ok(())
}

/// `brain show <kind> <id>` — a record's core fields plus its linked neighborhood.
pub fn show(conn: &Connection, json: bool, kind: &str, id: &str) -> Result<(), CliError> {
    let record = match kind {
        "person" => fetch_one(
            conn,
            "SELECT people.id,
                    people.full_name AS title,
                    people.preferred_name,
                    people.headline AS subtitle,
                    people.primary_email,
                    people.primary_phone,
                    people.location,
                    people.summary,
                    people.notes,
                    people.reconnect_interval_days,
                    relationship_strengths.relationship_strength,
                    relationship_strengths.last_interaction_at,
                    relationship_strengths.next_reconnect_at
             FROM people
             LEFT JOIN relationship_strengths ON relationship_strengths.person_id = people.id
             WHERE people.id = ?1",
            id,
        )?,
        "organization" => fetch_one(
            conn,
            "SELECT id, name AS title, kind AS subtitle, domain, location, summary, notes FROM organizations WHERE id = ?1",
            id,
        )?,
        "project" => fetch_one(
            conn,
            "SELECT id, name AS title, status AS subtitle, kind, summary, target_date FROM projects WHERE id = ?1",
            id,
        )?,
        "task" => fetch_one(
            conn,
            "SELECT id, title, status AS subtitle, description, due_at, scheduled_for, priority, project_id FROM tasks WHERE id = ?1",
            id,
        )?,
        other => return Err(CliError::Runtime(format!("unknown record kind '{other}'"))),
    };
    let Some(record) = record else {
        return Err(CliError::NotFound(format!("{kind} {id} not found")));
    };

    if json {
        print_json(&record)
    } else {
        println!("{}", serde_json::to_string_pretty(&record)?);
        Ok(())
    }
}

/// Fetch one row as a JSON object keyed by column/alias name (camelCase-ish).
fn fetch_one(conn: &Connection, sql: &str, id: &str) -> Result<Option<Value>, CliError> {
    let mut stmt = conn.prepare(sql)?;
    let names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|c| snake_to_camel(c))
        .collect();
    let mut rows = stmt.query(params![id])?;
    if let Some(row) = rows.next()? {
        let mut obj = serde_json::Map::new();
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), value_at(row, i)?);
        }
        Ok(Some(Value::Object(obj)))
    } else {
        Ok(None)
    }
}

fn value_at(row: &rusqlite::Row, i: usize) -> Result<Value, CliError> {
    use rusqlite::types::ValueRef;
    Ok(match row.get_ref(i)? {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(n) => Value::from(n),
        ValueRef::Real(f) => Value::from(f),
        ValueRef::Text(t) => Value::from(String::from_utf8_lossy(t).to_string()),
        ValueRef::Blob(_) => Value::Null,
    })
}

fn snake_to_camel(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut upper = false;
    for ch in name.chars() {
        if ch == '_' {
            upper = true;
        } else if upper {
            out.extend(ch.to_uppercase());
            upper = false;
        } else {
            out.push(ch);
        }
    }
    out
}
