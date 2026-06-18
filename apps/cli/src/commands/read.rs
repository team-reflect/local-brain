//! Read commands: `brain search`, `brain ask`, `brain show`. Retrieval reuses
//! the same FTS5 contract as the app (the SQL is the shared layer), reimplemented
//! here in Rust so the CLI runs standalone. `ask` is grounded: it returns the
//! cited chunks the answer is built from, and only synthesizes prose when a model
//! is configured — otherwise it degrades to returning the evidence for the
//! calling agent to reason over.

use rusqlite::{params, Connection};
use serde_json::{json, Value};

use super::{now_iso, to_like_pattern, to_match_query};
use crate::error::CliError;
use crate::id::new_id;
use crate::model;
use crate::output::{diag, print_json};

/// A retrieved chunk with enough provenance to cite it.
pub struct ChunkHit {
    pub chunk_id: String,
    pub text: String,
    pub snippet: String,
    pub record_type: String,
    pub record_id: String,
    pub record_title: Option<String>,
    pub lexical: f64,
}

/// bm25 (more-negative is better) -> bounded [0,1] lexical score (mirrors core).
fn lexical_score(bm25: f64) -> f64 {
    let magnitude = (-bm25).max(0.0);
    magnitude / (magnitude + 4.0)
}

/// Retrieve the top-`limit` grounding chunks for a query via FTS5 over
/// `content_chunks` (OR-recall, ranked by bm25).
pub fn retrieve_chunks(
    conn: &Connection,
    query: &str,
    limit: usize,
) -> Result<Vec<ChunkHit>, CliError> {
    let Some(match_query) = to_match_query(query, true) else {
        return Ok(Vec::new());
    };
    let mut stmt = conn.prepare(
        "SELECT cc.id, cc.text,
                snippet(content_chunks_fts, 0, '[', ']', '…', 12),
                cc.record_type, cc.record_id,
                COALESCE(d.title, i.title),
                bm25(content_chunks_fts)
         FROM content_chunks_fts
         JOIN content_chunks cc ON cc.rowid = content_chunks_fts.rowid
         LEFT JOIN documents d    ON d.id = cc.record_id AND cc.record_type = 'document'
         LEFT JOIN interactions i ON i.id = cc.record_id AND cc.record_type = 'interaction'
         WHERE content_chunks_fts MATCH ?1
           AND d.archived_at IS NULL AND i.archived_at IS NULL
         ORDER BY bm25(content_chunks_fts)
         LIMIT ?2",
    )?;
    let rows = stmt.query_map(params![match_query, limit as i64], |row| {
        Ok(ChunkHit {
            chunk_id: row.get(0)?,
            text: row.get(1)?,
            snippet: row.get(2)?,
            record_type: row.get(3)?,
            record_id: row.get(4)?,
            record_title: row.get(5)?,
            lexical: lexical_score(row.get::<_, f64>(6)?),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(CliError::from)
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

/// `brain ask` — grounded question answering. Always returns the cited evidence;
/// synthesizes an answer when a model is configured, otherwise degrades cleanly
/// (`answered: false`) so the calling agent can reason over the evidence itself.
pub fn ask(
    conn: &mut Connection,
    json: bool,
    question: &str,
    limit: usize,
    no_model: bool,
) -> Result<(), CliError> {
    let chunks = retrieve_chunks(conn, question, limit)?;
    let citations: Vec<Value> = chunks
        .iter()
        .enumerate()
        .map(|(i, c)| {
            json!({
                "index": i + 1,
                "chunkId": c.chunk_id,
                "recordType": c.record_type,
                "recordId": c.record_id,
                "recordTitle": c.record_title,
                "snippet": c.snippet,
                "quote": c.text,
                "score": c.lexical,
            })
        })
        .collect();

    let model_result = if no_model {
        None
    } else {
        model::synthesize(question, &chunks)?
    };

    match model_result {
        Some(answer) => {
            // Persist the answer + cited evidence so it shows in the app's Ask history.
            let (conversation_id, message_id) = persist_answer(conn, question, &answer, &chunks)?;
            if json {
                print_json(&json!({
                    "answered": true,
                    "answer": answer.text,
                    "model": answer.model,
                    "conversationId": conversation_id,
                    "messageId": message_id,
                    "citations": citations,
                }))
            } else {
                println!("{}", answer.text);
                Ok(())
            }
        }
        None => {
            let reason = if no_model {
                "model disabled (--no-model)"
            } else {
                "no model configured (set ANTHROPIC_API_KEY); returning retrieved evidence"
            };
            diag(reason);
            if json {
                print_json(&json!({
                    "answered": false,
                    "reason": reason,
                    "citations": citations,
                }))
            } else {
                if citations.is_empty() {
                    println!("(no relevant records found)");
                }
                for c in &citations {
                    println!("[{}] {}\n    {}", c["index"], c["recordTitle"], c["quote"]);
                }
                Ok(())
            }
        }
    }
}

/// Insert a conversation + assistant message + one evidence_ref per cited source.
fn persist_answer(
    conn: &mut Connection,
    question: &str,
    answer: &model::Answer,
    chunks: &[ChunkHit],
) -> Result<(String, String), CliError> {
    let conversation_id = new_id();
    let user_id = new_id();
    let message_id = new_id();
    let now = now_iso(conn)?;
    let title: String = question.chars().take(60).collect();
    let tx = conn.transaction()?;
    tx.execute(
        "INSERT INTO chat_conversations (id, title, updated_at) VALUES (?1,?2,?3)",
        params![conversation_id, title, now],
    )?;
    tx.execute(
        "INSERT INTO chat_messages (id, conversation_id, role, content) VALUES (?1,?2,'user',?3)",
        params![user_id, conversation_id, question],
    )?;
    tx.execute(
        "INSERT INTO chat_messages (id, conversation_id, role, content, model) VALUES (?1,?2,'assistant',?3,?4)",
        params![message_id, conversation_id, answer.text, answer.model],
    )?;
    // Cite every retrieved chunk the answer was grounded in.
    for chunk in chunks {
        tx.execute(
            "INSERT INTO evidence_refs (id, subject_type, subject_id, chunk_id, note) VALUES (?1,'chat_message',?2,?3,?4)",
            params![new_id(), message_id, chunk.chunk_id, chunk.record_title],
        )?;
    }
    tx.commit()?;
    Ok((conversation_id, message_id))
}

/// `brain show <kind> <id>` — a record's core fields plus its linked neighborhood.
pub fn show(conn: &Connection, json: bool, kind: &str, id: &str) -> Result<(), CliError> {
    let record = match kind {
        "person" => fetch_one(
            conn,
            "SELECT id, full_name AS title, headline AS subtitle, summary, notes, relationship_strength, last_interaction_at, next_reconnect_at FROM people WHERE id = ?1",
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
