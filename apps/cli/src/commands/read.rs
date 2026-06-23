//! Read commands: `brain search` and `brain show`. Retrieval reuses
//! the same FTS5 contract as the app (the SQL is the shared layer), reimplemented
//! here in Rust so the CLI runs standalone.

use std::collections::HashMap;

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::{to_like_pattern, to_like_pattern_lower, to_match_query};
use crate::error::CliError;
use crate::output::print_json;

/// bm25 (more-negative is better) -> bounded [0,1] lexical score (mirrors core).
fn lexical_score(bm25: f64) -> f64 {
    let magnitude = (-bm25).max(0.0);
    magnitude / (magnitude + 4.0)
}

const RECENCY_HALF_LIFE_DAYS: f64 = 90.0;
const NAME_HIT_SCORE: f64 = 0.6;
const TAG_HIT_SCORE: f64 = 0.58;
const DEFAULT_RECORD_DETAIL_CHARS: usize = 4000;
const MAX_RECORD_DETAIL_CHARS: usize = 12000;
const RETRIEVABLE_RECORD_TYPES: &[&str] = &[
    "person",
    "organization",
    "organization_profile",
    "project",
    "task",
    "document",
    "interaction",
    "interaction_transcript",
    "ai_note",
    "extracted_fact",
    "memory",
    "asset",
];

fn recency_score(age_days: Option<f64>) -> f64 {
    match age_days {
        Some(age) if age.is_finite() => 0.5_f64.powf(age.max(0.0) / RECENCY_HALF_LIFE_DAYS),
        _ => 0.25,
    }
}

fn combined_search_score(lexical: f64, age_days: Option<f64>) -> f64 {
    lexical * 0.7 + recency_score(age_days) * 0.3
}

fn preview_of(text: &str, max: usize) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= max {
        trimmed.to_string()
    } else {
        format!("{}...", truncate_to_boundary(trimmed, max).trim_end())
    }
}

fn truncate_to_boundary(value: &str, max: usize) -> &str {
    value
        .char_indices()
        .nth(max)
        .map_or(value, |(index, _)| &value[..index])
}

fn is_retrievable_record_type(record_type: &str) -> bool {
    RETRIEVABLE_RECORD_TYPES.contains(&record_type)
}

fn record_ref(record_type: &str, record_id: &str) -> String {
    format!("{record_type}:{record_id}")
}

struct ParsedSearchQuery {
    text: String,
    tag_filters: Vec<String>,
}

// `brain search` is the Rust twin of core's `globalSearch`
// (packages/core/src/retrieval). The tag grammar (`parse_search_query`), tag
// SQL (`tag_filter_sql`/`tag_hits`), and merge (`dedupe_and_rank_hits`) below
// mirror the sibling modules there — keep the two in sync.
fn parse_search_query(query: &str) -> ParsedSearchQuery {
    let mut text = Vec::new();
    let mut tag_filters = Vec::new();
    for token in query.split_whitespace() {
        if let Some(tag) = parse_tag_filter(token) {
            if !tag_filters.contains(&tag) {
                tag_filters.push(tag);
            }
        } else {
            text.push(token);
        }
    }
    ParsedSearchQuery {
        text: text.join(" "),
        tag_filters,
    }
}

fn parse_tag_filter(token: &str) -> Option<String> {
    let raw = token.strip_prefix('#')?;
    let mut chars = raw.chars();
    let first = chars.next()?;
    if !first.is_alphanumeric() {
        return None;
    }
    if chars.all(|ch| ch.is_alphanumeric() || matches!(ch, '-' | '_' | '/')) {
        Some(raw.to_lowercase())
    } else {
        None
    }
}

#[derive(Default)]
struct SqlFragment {
    sql: String,
    params: Vec<SqlValue>,
}

fn tag_filter_sql(record_type: &str, record_id_expr: &str, tag_filters: &[String]) -> SqlFragment {
    tag_filter_sql_inner("?", Some(record_type), record_id_expr, tag_filters)
}

fn tag_filter_sql_for_expr(
    record_type_expr: &str,
    record_id_expr: &str,
    tag_filters: &[String],
) -> SqlFragment {
    tag_filter_sql_inner(record_type_expr, None, record_id_expr, tag_filters)
}

fn tag_filter_sql_inner(
    record_type_expr: &str,
    record_type_param: Option<&str>,
    record_id_expr: &str,
    tag_filters: &[String],
) -> SqlFragment {
    if tag_filters.is_empty() {
        return SqlFragment::default();
    }
    let mut fragment = SqlFragment::default();
    for tag in tag_filters {
        fragment.sql.push_str(&format!(
            " AND EXISTS (
                    SELECT 1
                    FROM taggings filter_taggings
                    JOIN tags filter_tags ON filter_tags.id = filter_taggings.tag_id
                    WHERE filter_taggings.record_type = {record_type_expr}
                      AND filter_taggings.record_id = {record_id_expr}
                      AND (
                        lower(COALESCE(filter_tags.slug, filter_tags.name)) = ?
                        OR lower(filter_tags.name) = ?
                      )
                 )"
        ));
        if let Some(record_type) = record_type_param {
            fragment
                .params
                .push(SqlValue::from(record_type.to_string()));
        }
        fragment.params.push(SqlValue::from(tag.clone()));
        fragment.params.push(SqlValue::from(tag.clone()));
    }
    fragment
}

fn has_plain_tag_match(conn: &Connection, tag_like: &str) -> Result<bool, CliError> {
    let hit: Option<i64> = conn
        .query_row(
            "SELECT 1
             FROM tags
             WHERE lower(name) LIKE ?1 ESCAPE '\\'
                OR lower(COALESCE(slug, '')) LIKE ?1 ESCAPE '\\'
             LIMIT 1",
            params![tag_like],
            |row| row.get(0),
        )
        .optional()?;
    Ok(hit.is_some())
}

fn should_search_tag_hits(
    conn: &Connection,
    text: &str,
    tag_like: Option<&str>,
    tag_filters: &[String],
) -> Result<bool, CliError> {
    if text.trim().is_empty() && !tag_filters.is_empty() {
        return Ok(true);
    }
    match tag_like {
        Some(tag_like) => has_plain_tag_match(conn, tag_like),
        None => Ok(false),
    }
}

/// `brain search` — full-text across records, name matches, assets, and tags.
/// Output is the data array (stdout).
pub fn search(conn: &Connection, json: bool, query: &str, limit: usize) -> Result<(), CliError> {
    let mut hits: Vec<Value> = Vec::new();
    let parsed = parse_search_query(query);

    // Mirror core `globalSearch`: a query with no searchable tokens is "no query",
    // not a request for everything. Returning early stops a wildcard-only input
    // (e.g. "%") from collapsing into a `%%` LIKE that matches every record.
    let mq = to_match_query(&parsed.text, false);
    let like = to_like_pattern(&parsed.text);
    if mq.is_none() && like.is_none() && parsed.tag_filters.is_empty() {
        return emit_search(json, query, &hits);
    };
    let tag_like = to_like_pattern_lower(&parsed.text);

    if let Some(mq) = mq.as_deref() {
        for (table, fts, kind, record_date) in [
            ("documents", "documents_fts", "document", "t.updated_at"),
            (
                "interactions",
                "interactions_fts",
                "interaction",
                "t.occurred_at",
            ),
        ] {
            // Columns: 0=title, 1=body_text, 2=summary. Weight title highest, then the
            // summary (a curated digest / Granola note), then the raw body. Snippet from
            // body, falling back to summary then title so a summary-only record (no body)
            // still shows useful matched text.
            let tag_filter = tag_filter_sql(kind, "t.id", &parsed.tag_filters);
            let sql = format!(
                "SELECT t.id, t.title,
                        COALESCE(
                          NULLIF(snippet({fts}, 1, '[', ']', '…', 10), ''),
                          NULLIF(snippet({fts}, 2, '[', ']', '…', 10), ''),
                          NULLIF(snippet({fts}, 0, '[', ']', '…', 10), '')
                        ),
                        bm25({fts}, 10.0, 1.0, 2.0),
                        julianday('now') - julianday({record_date})
                 FROM {fts} JOIN {table} t ON t.rowid = {fts}.rowid
                 WHERE {fts} MATCH ?
                   AND t.archived_at IS NULL
                   {}
                 ORDER BY bm25({fts}, 10.0, 1.0, 2.0) LIMIT ?",
                tag_filter.sql
            );
            let mut stmt = conn.prepare(&sql)?;
            let mut query_params = vec![SqlValue::from(mq.to_string())];
            query_params.extend(tag_filter.params);
            query_params.push(SqlValue::from(limit as i64));
            let rows = stmt.query_map(params_from_iter(query_params), |row| {
                Ok(json!({
                    "kind": kind,
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "(untitled)".into()),
                    "snippet": row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    "score": combined_search_score(
                        lexical_score(row.get::<_, f64>(3)?),
                        row.get::<_, Option<f64>>(4)?
                    ),
                }))
            })?;
            for row in rows {
                hits.push(row?);
            }
        }

        let asset_tag_filter = tag_filter_sql("asset", "s.asset_id", &parsed.tag_filters);
        let asset_sql = format!(
            "SELECT s.asset_id,
                    s.title,
                    s.subtitle,
                    COALESCE(
                      NULLIF(snippet(assets_fts, 0, '[', ']', '…', 10), ''),
                      NULLIF(snippet(assets_fts, 2, '[', ']', '…', 10), ''),
                      NULLIF(snippet(assets_fts, 3, '[', ']', '…', 10), ''),
                      NULLIF(snippet(assets_fts, 1, '[', ']', '…', 10), '')
                    ),
                    bm25(assets_fts, 10.0, 2.0, 2.0, 1.0),
                    julianday('now') - julianday(s.updated_at)
             FROM assets_fts
             JOIN asset_search s ON s.rowid = assets_fts.rowid
             JOIN assets a ON a.id = s.asset_id
             WHERE assets_fts MATCH ?
               AND a.archived_at IS NULL
               {}
             ORDER BY bm25(assets_fts, 10.0, 2.0, 2.0, 1.0)
             LIMIT ?",
            asset_tag_filter.sql
        );
        let mut asset_stmt = conn.prepare(&asset_sql)?;
        let mut asset_params = vec![SqlValue::from(mq.to_string())];
        asset_params.extend(asset_tag_filter.params);
        asset_params.push(SqlValue::from(limit as i64));
        let asset_rows = asset_stmt.query_map(params_from_iter(asset_params), |row| {
            Ok(json!({
                "kind": "asset",
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, String>(1)?,
                "subtitle": row.get::<_, Option<String>>(2)?,
                "snippet": row.get::<_, Option<String>>(3)?,
                "score": combined_search_score(
                    lexical_score(row.get::<_, f64>(4)?),
                    row.get::<_, Option<f64>>(5)?
                ),
            }))
        })?;
        for row in asset_rows {
            hits.push(row?);
        }

        let chunk_tag_filter =
            tag_filter_sql_for_expr("cc.record_type", "cc.record_id", &parsed.tag_filters);
        let chunk_sql = format!(
            "SELECT cc.record_type,
                    cc.record_id,
                    COALESCE(
                      p.full_name,
                      o.name,
                      op.one_line_description,
                      pr.name,
                      t.title,
                      ti.title,
                      an.title,
                      ef.key,
                      m.claim,
                      '(untitled)'
                    ) AS title,
                    snippet(content_chunks_fts, 0, '[', ']', '…', 10),
                    bm25(content_chunks_fts),
                    julianday('now') - julianday(COALESCE(
                      p.updated_at,
                      o.updated_at,
                      op.updated_at,
                      pr.updated_at,
                      t.updated_at,
                      ti.updated_at,
                      an.updated_at,
                      ef.updated_at,
                      m.updated_at
                    ))
             FROM content_chunks_fts
             JOIN content_chunks cc ON cc.rowid = content_chunks_fts.rowid
             LEFT JOIN people p
               ON cc.record_type = 'person' AND p.id = cc.record_id
             LEFT JOIN organizations o
               ON cc.record_type = 'organization' AND o.id = cc.record_id
             LEFT JOIN organization_profiles op
               ON cc.record_type = 'organization_profile' AND op.id = cc.record_id
             LEFT JOIN projects pr
               ON cc.record_type = 'project' AND pr.id = cc.record_id
             LEFT JOIN tasks t
               ON cc.record_type = 'task' AND t.id = cc.record_id
             LEFT JOIN interaction_transcripts tr
               ON cc.record_type = 'interaction_transcript' AND tr.id = cc.record_id
             LEFT JOIN interactions ti
               ON ti.id = tr.interaction_id
             LEFT JOIN ai_notes an
               ON cc.record_type = 'ai_note' AND an.id = cc.record_id
             LEFT JOIN extracted_facts ef
               ON cc.record_type = 'extracted_fact' AND ef.id = cc.record_id
             LEFT JOIN memories m
               ON cc.record_type = 'memory' AND m.id = cc.record_id
             WHERE content_chunks_fts MATCH ?
               AND cc.record_type NOT IN ('document', 'interaction', 'asset')
               {}
               AND (
                 (cc.record_type = 'person' AND p.archived_at IS NULL)
                 OR (cc.record_type = 'organization' AND o.archived_at IS NULL)
                 OR (cc.record_type = 'organization_profile' AND op.id IS NOT NULL)
                 OR (cc.record_type = 'project' AND pr.archived_at IS NULL)
                 OR (cc.record_type = 'task' AND t.archived_at IS NULL)
                 OR (cc.record_type = 'interaction_transcript' AND tr.id IS NOT NULL AND ti.archived_at IS NULL)
                 OR (cc.record_type = 'ai_note' AND an.id IS NOT NULL)
                 OR (cc.record_type = 'extracted_fact' AND ef.archived_at IS NULL)
                 OR (cc.record_type = 'memory' AND m.archived_at IS NULL)
               )
             ORDER BY bm25(content_chunks_fts)
             LIMIT ?",
            chunk_tag_filter.sql
        );
        let mut chunk_stmt = conn.prepare(&chunk_sql)?;
        let mut chunk_params = vec![SqlValue::from(mq.to_string())];
        chunk_params.extend(chunk_tag_filter.params);
        chunk_params.push(SqlValue::from(limit as i64));
        let chunk_rows = chunk_stmt.query_map(params_from_iter(chunk_params), |row| {
            Ok(json!({
                "kind": row.get::<_, String>(0)?,
                "id": row.get::<_, String>(1)?,
                "title": row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "(untitled)".into()),
                "snippet": row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                "score": combined_search_score(
                    lexical_score(row.get::<_, f64>(4)?),
                    row.get::<_, Option<f64>>(5)?
                ),
            }))
        })?;
        for row in chunk_rows {
            hits.push(row?);
        }
    }

    if let Some(like) = like.as_deref() {
        for (table, name_col, kind) in [
            ("people", "full_name", "person"),
            ("organizations", "name", "organization"),
            ("projects", "name", "project"),
            ("tasks", "title", "task"),
        ] {
            let record_id = format!("{table}.id");
            let tag_filter = tag_filter_sql(kind, &record_id, &parsed.tag_filters);
            let record_date = format!("{table}.updated_at");
            let sql = format!(
                "SELECT {table}.id, {name_col}, julianday('now') - julianday({record_date})
                 FROM {table}
                 WHERE archived_at IS NULL
                   AND {name_col} LIKE ? ESCAPE '\\'
                   {}
                 LIMIT ?",
                tag_filter.sql
            );
            let mut stmt = conn.prepare(&sql)?;
            let mut query_params = vec![SqlValue::from(like.to_string())];
            query_params.extend(tag_filter.params);
            query_params.push(SqlValue::from(limit as i64));
            let rows = stmt.query_map(params_from_iter(query_params), |row| {
                Ok(json!({
                    "kind": kind,
                    "id": row.get::<_, String>(0)?,
                    "title": row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "(untitled)".into()),
                    "snippet": Value::Null,
                    "score": combined_search_score(NAME_HIT_SCORE, row.get::<_, Option<f64>>(2)?),
                }))
            })?;
            for row in rows {
                hits.push(row?);
            }
        }
    }

    if should_search_tag_hits(conn, &parsed.text, tag_like.as_deref(), &parsed.tag_filters)? {
        hits.extend(tag_hits(
            conn,
            tag_like.as_deref(),
            &parsed.tag_filters,
            limit,
        )?);
    }

    let hits = dedupe_and_rank_hits(hits, limit);
    emit_search(json, query, &hits)
}

fn dedupe_and_rank_hits(hits: Vec<Value>, limit: usize) -> Vec<Value> {
    // Merge all kinds, rank by score, and apply one final cap — like the app's
    // `globalSearch`, instead of returning up to `limit` rows per source table.
    let mut unique_hits: Vec<Value> = Vec::new();
    let mut seen: HashMap<(String, String), usize> = HashMap::new();
    for hit in hits {
        let key = (
            hit["kind"].as_str().unwrap_or("").to_string(),
            hit["id"].as_str().unwrap_or("").to_string(),
        );
        if let Some(index) = seen.get(&key).copied() {
            let existing_score = unique_hits[index]["score"].as_f64().unwrap_or(0.0);
            let new_score = hit["score"].as_f64().unwrap_or(0.0);
            let existing_has_snippet = unique_hits[index]["snippet"].as_str().is_some();
            let new_has_snippet = hit["snippet"].as_str().is_some();
            if new_score > existing_score
                || (new_score == existing_score && !existing_has_snippet && new_has_snippet)
            {
                unique_hits[index] = hit;
            }
        } else {
            seen.insert(key, unique_hits.len());
            unique_hits.push(hit);
        }
    }
    unique_hits.sort_by(|a, b| {
        let sb = b["score"].as_f64().unwrap_or(0.0);
        let sa = a["score"].as_f64().unwrap_or(0.0);
        // Tie-break equal scores by title so ordering is deterministic, mirroring
        // core's `dedupeAndRank`. (This is byte ordering rather than JS
        // `localeCompare`, so non-ASCII titles can differ slightly.)
        sb.partial_cmp(&sa)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                let ta = a["title"].as_str().unwrap_or("");
                let tb = b["title"].as_str().unwrap_or("");
                ta.cmp(tb)
            })
    });
    unique_hits.truncate(limit);
    unique_hits
}

fn tag_hits(
    conn: &Connection,
    tag_like: Option<&str>,
    tag_filters: &[String],
    limit: usize,
) -> Result<Vec<Value>, CliError> {
    let tag_text_sql = if tag_like.is_some() {
        " AND EXISTS (
            SELECT 1
            FROM taggings text_taggings
            JOIN tags text_tags ON text_tags.id = text_taggings.tag_id
            WHERE text_taggings.record_type = records.kind
              AND text_taggings.record_id = records.id
              AND (
                lower(text_tags.name) LIKE ? ESCAPE '\\'
                OR lower(COALESCE(text_tags.slug, '')) LIKE ? ESCAPE '\\'
              )
          )"
    } else {
        ""
    };
    let tag_filter = tag_filter_sql_for_expr("records.kind", "records.id", tag_filters);
    let sql = format!(
        "WITH records(kind, id, title, subtitle, record_date) AS (
           SELECT 'person', id, full_name, headline, updated_at
           FROM people
           WHERE archived_at IS NULL
           UNION ALL
           SELECT 'organization', id, name, kind, updated_at
           FROM organizations
           WHERE archived_at IS NULL
           UNION ALL
           SELECT 'project', id, name, status, updated_at
           FROM projects
           WHERE archived_at IS NULL
           UNION ALL
           SELECT 'task', id, title, status, COALESCE(due_at, scheduled_for, updated_at)
           FROM tasks
           WHERE archived_at IS NULL
           UNION ALL
           SELECT 'document', id, title, kind, updated_at
           FROM documents
           WHERE archived_at IS NULL
           UNION ALL
           SELECT 'interaction', id, title, kind, COALESCE(occurred_at, updated_at)
           FROM interactions
           WHERE archived_at IS NULL
           UNION ALL
           SELECT 'asset',
                  id,
                  COALESCE(NULLIF(trim(original_filename), ''), storage_path),
                  COALESCE(NULLIF(trim(mime_type), ''), NULLIF(trim(kind), '')),
                  updated_at
           FROM assets
           WHERE archived_at IS NULL
         )
         SELECT
           records.kind,
           records.id,
           records.title,
           records.subtitle,
           (
             SELECT 'Tagged #' || group_concat(label, ', #')
             FROM (
               SELECT DISTINCT COALESCE(NULLIF(trim(tags.slug), ''), tags.name) AS label
               FROM taggings
               JOIN tags ON tags.id = taggings.tag_id
               WHERE taggings.record_type = records.kind
                 AND taggings.record_id = records.id
               ORDER BY label ASC
             )
           ) AS snippet
           ,
           julianday('now') - julianday(records.record_date)
         FROM records
         WHERE 1 = 1
           {}
           {tag_text_sql}
         ORDER BY records.record_date DESC
         LIMIT ?",
        tag_filter.sql
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut hits = Vec::new();
    let mut query_params = tag_filter.params;
    if let Some(tag_like) = tag_like {
        query_params.push(SqlValue::from(tag_like.to_string()));
        query_params.push(SqlValue::from(tag_like.to_string()));
    }
    query_params.push(SqlValue::from(limit as i64));
    let rows = stmt.query_map(params_from_iter(query_params), tag_hit_from_row)?;
    for row in rows {
        hits.push(row?);
    }
    Ok(hits)
}

fn tag_hit_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Value> {
    Ok(json!({
        "kind": row.get::<_, String>(0)?,
        "id": row.get::<_, String>(1)?,
        "title": row.get::<_, Option<String>>(2)?.unwrap_or_else(|| "(untitled)".into()),
        "subtitle": row.get::<_, Option<String>>(3)?,
        "snippet": row.get::<_, Option<String>>(4)?,
        "score": combined_search_score(TAG_HIT_SCORE, row.get::<_, Option<f64>>(5)?),
    }))
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

#[derive(Default)]
pub struct RetrieveArgs<'a> {
    pub query: Option<&'a str>,
    pub record_types: Vec<&'a str>,
    pub kinds: Vec<&'a str>,
    pub after: Option<&'a str>,
    pub before: Option<&'a str>,
    pub sort: &'a str,
    pub limit: usize,
}

#[derive(Default)]
pub struct GetRecordsArgs<'a> {
    pub records: Vec<&'a str>,
    pub chunk_ids: Vec<&'a str>,
    pub max_chars_per_record: usize,
}

struct RetrievalFilter {
    sql: String,
    params: Vec<SqlValue>,
}

struct RetrievedChunkRow {
    chunk_id: String,
    snippet: String,
    record_type: String,
    record_id: String,
    record_title: Option<String>,
    record_date: Option<String>,
    chunk_index: i64,
    score: f64,
}

const CHUNK_RECORD_JOINS: &str = "
  LEFT JOIN people p ON p.id = cc.record_id AND cc.record_type = 'person'
  LEFT JOIN organizations o ON o.id = cc.record_id AND cc.record_type = 'organization'
  LEFT JOIN organization_profiles op ON op.id = cc.record_id AND cc.record_type = 'organization_profile'
  LEFT JOIN projects pr ON pr.id = cc.record_id AND cc.record_type = 'project'
  LEFT JOIN tasks t ON t.id = cc.record_id AND cc.record_type = 'task'
  LEFT JOIN documents d ON d.id = cc.record_id AND cc.record_type = 'document'
  LEFT JOIN interactions i ON i.id = cc.record_id AND cc.record_type = 'interaction'
  LEFT JOIN interaction_transcripts tr ON tr.id = cc.record_id AND cc.record_type = 'interaction_transcript'
  LEFT JOIN interactions transcript_interaction ON transcript_interaction.id = tr.interaction_id
  LEFT JOIN ai_notes an ON an.id = cc.record_id AND cc.record_type = 'ai_note'
  LEFT JOIN extracted_facts ef ON ef.id = cc.record_id AND cc.record_type = 'extracted_fact'
  LEFT JOIN memories m ON m.id = cc.record_id AND cc.record_type = 'memory'
  LEFT JOIN assets a ON a.id = cc.record_id AND cc.record_type = 'asset'
";

const CHUNK_VISIBILITY_FILTER: &str = "(
    (cc.record_type = 'person' AND p.archived_at IS NULL)
    OR (cc.record_type = 'organization' AND o.archived_at IS NULL)
    OR (cc.record_type = 'organization_profile' AND op.id IS NOT NULL)
    OR (cc.record_type = 'project' AND pr.archived_at IS NULL)
    OR (cc.record_type = 'task' AND t.archived_at IS NULL)
    OR (cc.record_type = 'document' AND d.archived_at IS NULL)
    OR (cc.record_type = 'interaction' AND i.archived_at IS NULL)
    OR (cc.record_type = 'interaction_transcript' AND tr.id IS NOT NULL AND transcript_interaction.archived_at IS NULL)
    OR (cc.record_type = 'ai_note' AND an.id IS NOT NULL)
    OR (cc.record_type = 'extracted_fact' AND ef.archived_at IS NULL)
    OR (cc.record_type = 'memory' AND m.archived_at IS NULL)
    OR (cc.record_type = 'asset' AND a.archived_at IS NULL)
)";

const CHUNK_RECORD_TITLE: &str = "COALESCE(
    p.full_name,
    o.name,
    op.one_line_description,
    pr.name,
    t.title,
    d.title,
    i.title,
    transcript_interaction.title,
    an.title,
    ef.key,
    m.claim,
    a.original_filename,
    a.storage_path
)";

const CHUNK_RECORD_DATE: &str = "COALESCE(
    i.occurred_at,
    transcript_interaction.occurred_at,
    d.occurred_at,
    d.authored_at,
    t.due_at,
    an.generated_at,
    ef.observed_at,
    m.valid_from,
    p.last_interaction_at,
    d.updated_at,
    i.updated_at,
    p.updated_at,
    o.updated_at,
    pr.updated_at,
    t.updated_at,
    an.updated_at,
    ef.updated_at,
    m.updated_at,
    a.updated_at
)";

fn inclusive_upper_bound(value: &str) -> String {
    if value.len() == 10
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
    {
        format!("{value}T23:59:59.999Z")
    } else {
        value.to_string()
    }
}

fn retrieval_filter(args: &RetrieveArgs<'_>) -> Result<RetrievalFilter, CliError> {
    let mut clauses = Vec::new();
    let mut params = Vec::new();

    if !args.record_types.is_empty() {
        for record_type in &args.record_types {
            if !is_retrievable_record_type(record_type) {
                return Err(CliError::Runtime(format!(
                    "unsupported --record-type '{record_type}'"
                )));
            }
        }
        let placeholders = std::iter::repeat_n("?", args.record_types.len())
            .collect::<Vec<_>>()
            .join(", ");
        clauses.push(format!("cc.record_type IN ({placeholders})"));
        params.extend(
            args.record_types
                .iter()
                .map(|record_type| SqlValue::from((*record_type).to_string())),
        );
    }

    if !args.kinds.is_empty() {
        let placeholders = std::iter::repeat_n("?", args.kinds.len())
            .collect::<Vec<_>>()
            .join(", ");
        clauses.push(format!(
            "(i.kind IN ({placeholders}) OR transcript_interaction.kind IN ({placeholders}))"
        ));
        params.extend(
            args.kinds
                .iter()
                .map(|kind| SqlValue::from((*kind).to_string())),
        );
        params.extend(
            args.kinds
                .iter()
                .map(|kind| SqlValue::from((*kind).to_string())),
        );
    }

    if let Some(after) = args.after {
        clauses.push(format!("{CHUNK_RECORD_DATE} >= ?"));
        params.push(SqlValue::from(after.to_string()));
    }

    if let Some(before) = args.before {
        clauses.push(format!("{CHUNK_RECORD_DATE} <= ?"));
        params.push(SqlValue::from(inclusive_upper_bound(before)));
    }

    let sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" AND {}", clauses.join(" AND "))
    };
    Ok(RetrievalFilter { sql, params })
}

fn retrieve_hit_json(hit: &RetrievedChunkRow) -> Value {
    json!({
        "chunkId": hit.chunk_id,
        "chunkIndex": hit.chunk_index,
        "recordType": hit.record_type,
        "recordId": hit.record_id,
        "recordRef": record_ref(&hit.record_type, &hit.record_id),
        "title": hit.record_title,
        "date": hit.record_date,
        "snippet": hit.snippet,
        "score": hit.score,
    })
}

/// `brain retrieve` — agent-oriented grounded recall over universal chunks.
pub fn retrieve(conn: &Connection, json: bool, args: RetrieveArgs<'_>) -> Result<(), CliError> {
    let query = args.query.unwrap_or("").trim();
    let match_query = to_match_query(query, true);
    let has_filter = !args.record_types.is_empty()
        || !args.kinds.is_empty()
        || args.after.is_some()
        || args.before.is_some();
    if match_query.is_none() && !has_filter {
        return Err(CliError::Runtime(
            "provide a query or at least one filter (--record-type, --kind, --after, --before)"
                .into(),
        ));
    }

    let sort = match args.sort {
        "relevance" | "" => "relevance",
        "recency" => "recency",
        other => return Err(CliError::Runtime(format!("unsupported --sort '{other}'"))),
    };

    let filter = retrieval_filter(&args)?;
    let (mode, hits) = if let Some(match_query) = match_query {
        (
            "lexical",
            retrieve_lexical(conn, query, &match_query, &filter, sort, args.limit)?,
        )
    } else {
        ("browse", retrieve_browse(conn, query, &filter, args.limit)?)
    };

    if json {
        print_json(&json!({
            "query": query,
            "mode": mode,
            "semanticAvailable": false,
            "hits": hits.iter().map(retrieve_hit_json).collect::<Vec<_>>(),
            "count": hits.len(),
        }))
    } else {
        for hit in &hits {
            println!(
                "{:>22}  {}  {}",
                record_ref(&hit.record_type, &hit.record_id),
                hit.chunk_id,
                hit.record_title.as_deref().unwrap_or("(untitled)")
            );
        }
        Ok(())
    }
}

fn retrieve_lexical(
    conn: &Connection,
    _query: &str,
    match_query: &str,
    filter: &RetrievalFilter,
    sort: &str,
    limit: usize,
) -> Result<Vec<RetrievedChunkRow>, CliError> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let order_by = if sort == "recency" {
        format!("{CHUNK_RECORD_DATE} DESC")
    } else {
        "bm25(content_chunks_fts)".to_string()
    };
    let query_limit = if sort == "recency" {
        limit
    } else {
        limit.saturating_mul(4).min(1000).max(limit)
    };
    let sql = format!(
        "SELECT cc.id,
                cc.text,
                snippet(content_chunks_fts, 0, '[', ']', '…', 12),
                cc.record_type,
                cc.record_id,
                cc.chunk_index,
                {CHUNK_RECORD_TITLE} AS title,
                {CHUNK_RECORD_DATE} AS record_date,
                bm25(content_chunks_fts),
                julianday('now') - julianday({CHUNK_RECORD_DATE})
         FROM content_chunks_fts
         JOIN content_chunks cc ON cc.rowid = content_chunks_fts.rowid
         {CHUNK_RECORD_JOINS}
         WHERE content_chunks_fts MATCH ?
           AND {CHUNK_VISIBILITY_FILTER}
           {}
         ORDER BY {order_by}
         LIMIT ?",
        filter.sql
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut query_params = vec![SqlValue::from(match_query.to_string())];
    query_params.extend(filter.params.iter().cloned());
    query_params.push(SqlValue::from(query_limit as i64));
    let rows = stmt.query_map(params_from_iter(query_params), |row| {
        let bm25 = row.get::<_, f64>(8)?;
        let age_days = row.get::<_, Option<f64>>(9)?;
        Ok(RetrievedChunkRow {
            chunk_id: row.get(0)?,
            snippet: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            record_type: row.get(3)?,
            record_id: row.get(4)?,
            chunk_index: row.get(5)?,
            record_title: row.get(6)?,
            record_date: row.get(7)?,
            score: combined_search_score(lexical_score(bm25), age_days),
        })
    })?;
    let mut hits = rows.collect::<Result<Vec<_>, _>>()?;
    if sort == "relevance" {
        hits.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    }
    hits.truncate(limit);
    Ok(hits)
}

fn retrieve_browse(
    conn: &Connection,
    _query: &str,
    filter: &RetrievalFilter,
    limit: usize,
) -> Result<Vec<RetrievedChunkRow>, CliError> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let sql = format!(
        "WITH first_chunks AS (
           SELECT *,
                  ROW_NUMBER() OVER (
                    PARTITION BY record_type, record_id
                    ORDER BY chunk_index ASC
                  ) AS rn
           FROM content_chunks
         )
         SELECT cc.id,
                cc.text,
                cc.record_type,
                cc.record_id,
                cc.chunk_index,
                {CHUNK_RECORD_TITLE} AS title,
                {CHUNK_RECORD_DATE} AS record_date,
                julianday('now') - julianday({CHUNK_RECORD_DATE})
         FROM first_chunks cc
         {CHUNK_RECORD_JOINS}
         WHERE cc.rn = 1
           AND {CHUNK_VISIBILITY_FILTER}
           {}
         ORDER BY {CHUNK_RECORD_DATE} DESC
         LIMIT ?",
        filter.sql
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut query_params = filter.params.clone();
    query_params.push(SqlValue::from(limit as i64));
    let rows = stmt.query_map(params_from_iter(query_params), |row| {
        let text = row.get::<_, String>(1)?;
        let age_days = row.get::<_, Option<f64>>(7)?;
        Ok(RetrievedChunkRow {
            chunk_id: row.get(0)?,
            snippet: preview_of(&text, 240),
            record_type: row.get(2)?,
            record_id: row.get(3)?,
            chunk_index: row.get(4)?,
            record_title: row.get(5)?,
            record_date: row.get(6)?,
            score: recency_score(age_days),
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(CliError::from)
}

/// `brain get-records` — bounded context for records found by `brain retrieve`.
pub fn get_records(
    conn: &Connection,
    json: bool,
    args: GetRecordsArgs<'_>,
) -> Result<(), CliError> {
    if args.records.is_empty() {
        return Err(CliError::Runtime("provide at least one record ref".into()));
    }
    let max_chars = args
        .max_chars_per_record
        .clamp(1, MAX_RECORD_DETAIL_CHARS)
        .max(DEFAULT_RECORD_DETAIL_CHARS.min(args.max_chars_per_record.max(1)));
    let mut records = Vec::new();
    for raw in args.records {
        let (record_type, record_id) = parse_record_ref(raw)?;
        records.push(record_context(
            conn,
            record_type,
            record_id,
            &args.chunk_ids,
            max_chars,
        )?);
    }

    if json {
        print_json(&json!({
            "records": records,
            "count": records.len(),
        }))
    } else {
        println!("{}", serde_json::to_string_pretty(&json!(records))?);
        Ok(())
    }
}

fn parse_record_ref(raw: &str) -> Result<(&str, &str), CliError> {
    let Some((record_type, record_id)) = raw.split_once(':') else {
        return Err(CliError::Runtime(format!(
            "record ref '{raw}' must use kind:id syntax"
        )));
    };
    if !is_retrievable_record_type(record_type) {
        return Err(CliError::Runtime(format!(
            "unsupported record type '{record_type}'"
        )));
    }
    if record_id.trim().is_empty() {
        return Err(CliError::Runtime(format!(
            "record ref '{raw}' is missing an id"
        )));
    }
    Ok((record_type, record_id))
}

fn record_context(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
    chunk_ids: &[&str],
    max_chars: usize,
) -> Result<Value, CliError> {
    let Some((title, date)) = record_header(conn, record_type, record_id)? else {
        return Ok(json!({
            "recordType": record_type,
            "recordId": record_id,
            "recordRef": record_ref(record_type, record_id),
            "found": false,
            "title": Value::Null,
            "date": Value::Null,
            "metadata": {},
            "chunks": [],
            "truncated": false,
        }));
    };
    let (chunks, truncated) = record_chunks(conn, record_type, record_id, chunk_ids, max_chars)?;
    Ok(json!({
        "recordType": record_type,
        "recordId": record_id,
        "recordRef": record_ref(record_type, record_id),
        "found": true,
        "title": title,
        "date": date,
        "metadata": {},
        "chunks": chunks,
        "truncated": truncated,
    }))
}

fn record_header(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
) -> Result<Option<(Value, Value)>, CliError> {
    let sql = format!(
        "WITH selected_chunk AS (
           SELECT *
           FROM content_chunks
           WHERE record_type = ?1 AND record_id = ?2
           ORDER BY chunk_index ASC
           LIMIT 1
         )
         SELECT {CHUNK_RECORD_TITLE} AS title,
                {CHUNK_RECORD_DATE} AS record_date
         FROM selected_chunk cc
         {CHUNK_RECORD_JOINS}
         WHERE {CHUNK_VISIBILITY_FILTER}
         LIMIT 1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let mut rows = stmt.query(params![record_type, record_id])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    Ok(Some((value_at(row, 0)?, value_at(row, 1)?)))
}

fn record_chunks(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
    chunk_ids: &[&str],
    max_chars: usize,
) -> Result<(Vec<Value>, bool), CliError> {
    let total: usize = conn.query_row(
        "SELECT COUNT(*) FROM content_chunks WHERE record_type = ?1 AND record_id = ?2",
        params![record_type, record_id],
        |row| row.get::<_, i64>(0),
    )? as usize;
    let rows = if chunk_ids.is_empty() {
        chunks_by_record(conn, record_type, record_id)?
    } else {
        chunks_around_ids(conn, record_type, record_id, chunk_ids)?
    };
    let (chunks, truncated_by_budget) = fit_chunks(rows, max_chars);
    let returned = chunks.len();
    Ok((chunks, truncated_by_budget || total > returned))
}

fn chunks_by_record(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
) -> Result<Vec<(String, i64, String)>, CliError> {
    let mut stmt = conn.prepare(
        "SELECT id, chunk_index, text
         FROM content_chunks
         WHERE record_type = ?1 AND record_id = ?2
         ORDER BY chunk_index ASC",
    )?;
    let rows = stmt.query_map(params![record_type, record_id], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(CliError::from)
}

fn chunks_around_ids(
    conn: &Connection,
    record_type: &str,
    record_id: &str,
    chunk_ids: &[&str],
) -> Result<Vec<(String, i64, String)>, CliError> {
    let placeholders = std::iter::repeat_n("?", chunk_ids.len())
        .collect::<Vec<_>>()
        .join(", ");
    let index_sql = format!(
        "SELECT chunk_index
         FROM content_chunks
         WHERE record_type = ?
           AND record_id = ?
           AND id IN ({placeholders})"
    );
    let mut params = vec![
        SqlValue::from(record_type.to_string()),
        SqlValue::from(record_id.to_string()),
    ];
    params.extend(chunk_ids.iter().map(|id| SqlValue::from((*id).to_string())));
    let mut stmt = conn.prepare(&index_sql)?;
    let rows = stmt.query_map(params_from_iter(params), |row| row.get::<_, i64>(0))?;
    let mut indexes = Vec::new();
    for row in rows {
        let index = row?;
        if index > 0 {
            indexes.push(index - 1);
        }
        indexes.push(index);
        indexes.push(index + 1);
    }
    indexes.sort_unstable();
    indexes.dedup();
    if indexes.is_empty() {
        return Ok(Vec::new());
    }

    let index_placeholders = std::iter::repeat_n("?", indexes.len())
        .collect::<Vec<_>>()
        .join(", ");
    let chunk_sql = format!(
        "SELECT id, chunk_index, text
         FROM content_chunks
         WHERE record_type = ?
           AND record_id = ?
           AND chunk_index IN ({index_placeholders})
         ORDER BY chunk_index ASC"
    );
    let mut chunk_params = vec![
        SqlValue::from(record_type.to_string()),
        SqlValue::from(record_id.to_string()),
    ];
    chunk_params.extend(indexes.into_iter().map(SqlValue::from));
    let mut chunk_stmt = conn.prepare(&chunk_sql)?;
    let chunks = chunk_stmt.query_map(params_from_iter(chunk_params), |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    })?;
    chunks
        .collect::<Result<Vec<_>, _>>()
        .map_err(CliError::from)
}

fn fit_chunks(rows: Vec<(String, i64, String)>, max_chars: usize) -> (Vec<Value>, bool) {
    let mut remaining = max_chars;
    let mut chunks = Vec::new();
    for (chunk_id, chunk_index, text) in rows {
        if remaining == 0 {
            return (chunks, true);
        }
        let text_chars = text.chars().count();
        let truncated = text_chars > remaining;
        let fitted = if truncated {
            truncate_to_boundary(&text, remaining).to_string()
        } else {
            text
        };
        let used = fitted.chars().count();
        chunks.push(json!({
            "chunkId": chunk_id,
            "chunkIndex": chunk_index,
            "text": fitted,
        }));
        if truncated {
            return (chunks, true);
        }
        remaining = remaining.saturating_sub(used);
    }
    (chunks, false)
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
                    relationship_strengths.relationship_strength,
                    relationship_strengths.last_interaction_at
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
        "asset" => fetch_asset(conn, id)?,
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

fn fetch_asset(conn: &Connection, id: &str) -> Result<Option<Value>, CliError> {
    let Some(mut record) = fetch_one(
        conn,
        "SELECT a.id,
                COALESCE(NULLIF(trim(a.original_filename), ''), a.storage_path) AS title,
                a.kind AS subtitle,
                a.kind,
                a.mime_type,
                a.byte_size,
                a.storage_path,
                a.content_hash,
                a.original_filename,
                a.original_path,
                a.original_url,
                at.text_source,
                at.content_hash AS text_content_hash,
                length(at.text) AS text_length,
                at.updated_at AS text_updated_at,
                a.created_at,
                a.updated_at
         FROM assets a
         LEFT JOIN asset_texts at ON at.asset_id = a.id
         WHERE a.id = ?1 AND a.archived_at IS NULL",
        id,
    )?
    else {
        return Ok(None);
    };

    let links = asset_links(conn, id)?;
    if let Some(obj) = record.as_object_mut() {
        obj.insert("linkedRecords".to_string(), Value::Array(links));
    }
    Ok(Some(record))
}

fn asset_links(conn: &Connection, asset_id: &str) -> Result<Vec<Value>, CliError> {
    let mut stmt = conn.prepare(
        "SELECT al.record_type,
                al.record_id,
                al.role,
                al.caption,
                COALESCE(p.full_name, o.name, pr.name, t.title, d.title, i.title) AS title
         FROM asset_links al
         LEFT JOIN people p
           ON al.record_type = 'person' AND p.id = al.record_id AND p.archived_at IS NULL
         LEFT JOIN organizations o
           ON al.record_type = 'organization' AND o.id = al.record_id AND o.archived_at IS NULL
         LEFT JOIN projects pr
           ON al.record_type = 'project' AND pr.id = al.record_id AND pr.archived_at IS NULL
         LEFT JOIN tasks t
           ON al.record_type = 'task' AND t.id = al.record_id AND t.archived_at IS NULL
         LEFT JOIN documents d
           ON al.record_type = 'document' AND d.id = al.record_id AND d.archived_at IS NULL
         LEFT JOIN interactions i
           ON al.record_type = 'interaction' AND i.id = al.record_id AND i.archived_at IS NULL
         WHERE al.asset_id = ?1
         ORDER BY al.created_at, al.id",
    )?;
    let rows = stmt.query_map(params![asset_id], |row| {
        Ok(json!({
            "kind": row.get::<_, String>(0)?,
            "id": row.get::<_, String>(1)?,
            "role": row.get::<_, Option<String>>(2)?,
            "caption": row.get::<_, Option<String>>(3)?,
            "title": row.get::<_, Option<String>>(4)?,
        }))
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(CliError::from)
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

#[cfg(test)]
mod tests {
    use super::{combined_search_score, parse_search_query};

    #[test]
    fn parses_search_query_like_core() {
        let parsed = parse_search_query("   ");
        assert_eq!(parsed.text, "");
        assert!(parsed.tag_filters.is_empty());

        let parsed = parse_search_query("budget revised plan");
        assert_eq!(parsed.text, "budget revised plan");
        assert!(parsed.tag_filters.is_empty());

        let parsed = parse_search_query("#Travel #project-alpha");
        assert_eq!(parsed.text, "");
        assert_eq!(
            parsed.tag_filters,
            vec!["travel".to_string(), "project-alpha".to_string()]
        );

        let parsed = parse_search_query("#travel #travel receipts");
        assert_eq!(parsed.text, "receipts");
        assert_eq!(parsed.tag_filters, vec!["travel".to_string()]);

        let parsed = parse_search_query("# travel ##work #! #- #_ #/");
        assert_eq!(parsed.text, "# travel ##work #! #- #_ #/");
        assert!(parsed.tag_filters.is_empty());

        let parsed = parse_search_query("Project Alpha");
        assert_eq!(parsed.text, "Project Alpha");
        assert!(parsed.tag_filters.is_empty());
    }

    #[test]
    fn search_score_blends_recency_like_core() {
        let fresh = combined_search_score(0.6, Some(0.0));
        let recent = combined_search_score(0.6, Some(30.0));
        let undated = combined_search_score(0.6, None);

        assert!(fresh > recent);
        assert!(recent > undated);
    }
}
