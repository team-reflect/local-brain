//! Read commands: `brain search` and `brain show`. Retrieval reuses
//! the same FTS5 contract as the app (the SQL is the shared layer), reimplemented
//! here in Rust so the CLI runs standalone.

use std::collections::HashMap;

use rusqlite::{params, params_from_iter, types::Value as SqlValue, Connection, OptionalExtension};
use serde::Serialize;
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

fn recency_score(age_days: Option<f64>) -> f64 {
    match age_days {
        Some(age) if age.is_finite() => 0.5_f64.powf(age.max(0.0) / RECENCY_HALF_LIFE_DAYS),
        _ => 0.25,
    }
}

fn combined_search_score(lexical: f64, age_days: Option<f64>) -> f64 {
    lexical * 0.7 + recency_score(age_days) * 0.3
}

struct ParsedSearchQuery {
    text: String,
    tag_filters: Vec<String>,
}

#[derive(Clone)]
struct SearchHit {
    kind: String,
    id: String,
    title: String,
    subtitle: Option<String>,
    snippet: Option<String>,
    score: f64,
}

#[derive(Serialize)]
struct SearchHitOutput<'a> {
    kind: &'a str,
    id: &'a str,
    title: &'a str,
    subtitle: Option<&'a str>,
    snippet: Option<&'a str>,
    score: f64,
    #[serde(rename = "recordRef")]
    record_ref: String,
    #[serde(rename = "showCommand")]
    show_command: [&'a str; 5],
}

impl SearchHit {
    fn new(
        kind: impl Into<String>,
        id: String,
        title: Option<String>,
        snippet: Option<String>,
        score: f64,
    ) -> Self {
        Self {
            kind: kind.into(),
            id,
            title: title.unwrap_or_else(|| "(untitled)".into()),
            subtitle: None,
            snippet,
            score,
        }
    }

    fn with_subtitle(mut self, subtitle: Option<String>) -> Self {
        self.subtitle = subtitle;
        self
    }

    fn to_output(&self) -> SearchHitOutput<'_> {
        SearchHitOutput {
            kind: &self.kind,
            id: &self.id,
            title: &self.title,
            subtitle: self.subtitle.as_deref(),
            snippet: self.snippet.as_deref(),
            score: self.score,
            record_ref: format!("{}:{}", self.kind, self.id),
            show_command: ["brain", "--json", "show", &self.kind, &self.id],
        }
    }
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
    let mut hits: Vec<SearchHit> = Vec::new();
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
                Ok(SearchHit::new(
                    kind,
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    Some(row.get::<_, Option<String>>(2)?.unwrap_or_default()),
                    combined_search_score(
                        lexical_score(row.get::<_, f64>(3)?),
                        row.get::<_, Option<f64>>(4)?,
                    ),
                ))
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
            Ok(SearchHit::new(
                "asset",
                row.get::<_, String>(0)?,
                Some(row.get::<_, String>(1)?),
                row.get::<_, Option<String>>(3)?,
                combined_search_score(
                    lexical_score(row.get::<_, f64>(4)?),
                    row.get::<_, Option<f64>>(5)?,
                ),
            )
            .with_subtitle(row.get::<_, Option<String>>(2)?))
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
            Ok(SearchHit::new(
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                Some(row.get::<_, Option<String>>(3)?.unwrap_or_default()),
                combined_search_score(
                    lexical_score(row.get::<_, f64>(4)?),
                    row.get::<_, Option<f64>>(5)?,
                ),
            ))
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
                Ok(SearchHit::new(
                    kind,
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    None,
                    combined_search_score(NAME_HIT_SCORE, row.get::<_, Option<f64>>(2)?),
                ))
            })?;
            for row in rows {
                hits.push(row?);
            }
        }

        let participant_tag_filter = tag_filter_sql("interaction", "i.id", &parsed.tag_filters);
        let participant_sql = format!(
            "SELECT i.id,
                    i.title,
                    COALESCE(ip.handle, ip.normalized_handle, ip.display_name),
                    julianday('now') - julianday(COALESCE(i.occurred_at, i.updated_at))
             FROM interaction_participants ip
             JOIN interactions i ON i.id = ip.interaction_id
             WHERE i.archived_at IS NULL
               AND (
                 ip.handle LIKE ? ESCAPE '\\'
                 OR ip.normalized_handle LIKE ? ESCAPE '\\'
                 OR ip.display_name LIKE ? ESCAPE '\\'
                 OR (
                   normalize_phone(?) IS NOT NULL
                   AND normalize_phone(COALESCE(ip.normalized_handle, ip.handle, ''))
                     LIKE '%' || normalize_phone(?) || '%'
                 )
               )
               {}
             LIMIT ?",
            participant_tag_filter.sql
        );
        let mut participant_stmt = conn.prepare(&participant_sql)?;
        let mut participant_params = vec![
            SqlValue::from(like.to_string()),
            SqlValue::from(like.to_string()),
            SqlValue::from(like.to_string()),
            SqlValue::from(parsed.text.clone()),
            SqlValue::from(parsed.text.clone()),
        ];
        participant_params.extend(participant_tag_filter.params);
        participant_params.push(SqlValue::from(limit as i64));
        let participant_rows =
            participant_stmt.query_map(params_from_iter(participant_params), |row| {
                let matched: Option<String> = row.get(2)?;
                Ok(SearchHit::new(
                    "interaction",
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    matched.map(|value| format!("Participant: {value}")),
                    combined_search_score(NAME_HIT_SCORE, row.get::<_, Option<f64>>(3)?),
                ))
            })?;
        for row in participant_rows {
            hits.push(row?);
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

fn dedupe_and_rank_hits(hits: Vec<SearchHit>, limit: usize) -> Vec<SearchHit> {
    // Merge all kinds, rank by score, and apply one final cap — like the app's
    // `globalSearch`, instead of returning up to `limit` rows per source table.
    let mut unique_hits: Vec<SearchHit> = Vec::new();
    let mut seen: HashMap<(String, String), usize> = HashMap::new();
    for hit in hits {
        let key = (hit.kind.clone(), hit.id.clone());
        if let Some(index) = seen.get(&key).copied() {
            let existing_score = unique_hits[index].score;
            let new_score = hit.score;
            let existing_has_snippet = unique_hits[index].snippet.is_some();
            let new_has_snippet = hit.snippet.is_some();
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
        // Tie-break equal scores by title so ordering is deterministic, mirroring
        // core's `dedupeAndRank`. (This is byte ordering rather than JS
        // `localeCompare`, so non-ASCII titles can differ slightly.)
        b.score
            .partial_cmp(&a.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| a.title.cmp(&b.title))
    });
    unique_hits.truncate(limit);
    unique_hits
}

fn tag_hits(
    conn: &Connection,
    tag_like: Option<&str>,
    tag_filters: &[String],
    limit: usize,
) -> Result<Vec<SearchHit>, CliError> {
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

fn tag_hit_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SearchHit> {
    Ok(SearchHit::new(
        row.get::<_, String>(0)?,
        row.get::<_, String>(1)?,
        row.get::<_, Option<String>>(2)?,
        row.get::<_, Option<String>>(4)?,
        combined_search_score(TAG_HIT_SCORE, row.get::<_, Option<f64>>(5)?),
    )
    .with_subtitle(row.get::<_, Option<String>>(3)?))
}

/// Render `brain search` hits as a JSON data array or a compact human table.
fn emit_search(json: bool, query: &str, hits: &[SearchHit]) -> Result<(), CliError> {
    if json {
        let results = hits.iter().map(SearchHit::to_output).collect::<Vec<_>>();
        return print_json(&json!({ "query": query, "results": results }));
    }
    if hits.is_empty() {
        println!("(no matches)");
    }
    for hit in hits {
        println!("{:>12}  {}  {}", hit.kind, hit.id, hit.title);
    }
    Ok(())
}

/// `brain show <kind> <id>` — a record's core fields plus its linked neighborhood.
pub fn show(conn: &Connection, json: bool, kind: &str, id: &str) -> Result<(), CliError> {
    let record = match kind {
        "interaction" => fetch_interaction(conn, id)?,
        "asset" => fetch_asset(conn, id)?,
        other => match show_sql(other) {
            Some(sql) => fetch_one(conn, sql, id)?,
            None => return Err(CliError::Runtime(format!("unknown record kind '{other}'"))),
        },
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

fn show_sql(kind: &str) -> Option<&'static str> {
    match kind {
        "person" => Some(
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
        ),
        "organization" => Some(
            "SELECT id, name AS title, kind AS subtitle, domain, location, summary, notes
             FROM organizations
             WHERE id = ?1",
        ),
        "project" => Some(
            "SELECT id, name AS title, status AS subtitle, kind, summary, target_date
             FROM projects
             WHERE id = ?1",
        ),
        "task" => Some(
            "SELECT id, title, status AS subtitle, description, due_at, scheduled_for, priority, project_id
             FROM tasks
             WHERE id = ?1",
        ),
        "document" => Some(
            "SELECT id,
                    title,
                    kind AS subtitle,
                    kind,
                    body_text,
                    summary,
                    mime_type,
                    original_path,
                    original_url,
                    content_hash,
                    authored_at,
                    occurred_at,
                    created_at,
                    updated_at
             FROM documents
             WHERE id = ?1 AND archived_at IS NULL",
        ),
        "interaction_transcript" => Some(
            "SELECT tr.id,
                    COALESCE(i.title, 'Transcript') AS title,
                    'transcript' AS subtitle,
                    tr.interaction_id,
                    tr.raw_text,
                    tr.format,
                    tr.language,
                    tr.segments_json,
                    tr.recording_url,
                    tr.storage_path,
                    tr.source_id,
                    tr.source_external_id,
                    tr.transcribed_by,
                    tr.transcribed_at,
                    tr.content_hash,
                    tr.metadata_json,
                    tr.created_at,
                    tr.updated_at
             FROM interaction_transcripts tr
             LEFT JOIN interactions i ON i.id = tr.interaction_id
             WHERE tr.id = ?1
               AND (i.id IS NULL OR i.archived_at IS NULL)",
        ),
        "ai_note" => Some(
            "SELECT id,
                    title,
                    kind AS subtitle,
                    kind,
                    interaction_id,
                    document_id,
                    subject_type,
                    subject_id,
                    content,
                    content_format,
                    model,
                    prompt_fingerprint,
                    source_id,
                    metadata_json,
                    generated_at,
                    created_at,
                    updated_at
             FROM ai_notes
             WHERE id = ?1",
        ),
        "extracted_fact" => Some(
            "SELECT id,
                    key AS title,
                    subject_type AS subtitle,
                    subject_type,
                    subject_id,
                    key,
                    value_text,
                    value_json,
                    confidence,
                    source_record_type,
                    source_record_id,
                    source_excerpt,
                    observed_at,
                    model,
                    prompt_fingerprint,
                    metadata_json,
                    created_at,
                    updated_at
             FROM extracted_facts
             WHERE id = ?1 AND archived_at IS NULL",
        ),
        "memory" => Some(
            "SELECT id,
                    claim AS title,
                    kind AS subtitle,
                    kind,
                    claim,
                    confidence,
                    valid_from,
                    valid_to,
                    promoted_from_fact_id,
                    created_at,
                    updated_at
             FROM memories
             WHERE id = ?1 AND archived_at IS NULL",
        ),
        "organization_profile" => Some(
            "SELECT op.id,
                    COALESCE(op.one_line_description, op.canonical_name, o.name) AS title,
                    op.category AS subtitle,
                    op.organization_id,
                    o.name AS organization_title,
                    op.model,
                    op.prompt_fingerprint,
                    op.canonical_name,
                    op.website,
                    op.one_line_description,
                    op.category,
                    op.why_it_matters,
                    op.offerings_json,
                    op.notable_people_json,
                    op.suggested_tags_json,
                    op.review_flags_json,
                    op.source_urls_json,
                    op.raw_enrichment_json,
                    op.researched_at,
                    op.created_at,
                    op.updated_at
             FROM organization_profiles op
             LEFT JOIN organizations o ON o.id = op.organization_id
             WHERE op.id = ?1",
        ),
        _ => None,
    }
}

fn fetch_interaction(conn: &Connection, id: &str) -> Result<Option<Value>, CliError> {
    let Some(mut record) = fetch_one(
        conn,
        "SELECT id,
                title,
                kind AS subtitle,
                kind,
                body_text,
                summary,
                occurred_at,
                ended_at,
                duration_seconds,
                location,
                external_id,
                original_path,
                original_url,
                content_hash,
                metadata_json,
                created_at,
                updated_at
         FROM interactions
         WHERE id = ?1 AND archived_at IS NULL",
        id,
    )?
    else {
        return Ok(None);
    };

    let participants = interaction_participants(conn, id)?;
    if let Some(obj) = record.as_object_mut() {
        obj.insert("participants".to_string(), Value::Array(participants));
    }
    Ok(Some(record))
}

fn interaction_participants(
    conn: &Connection,
    interaction_id: &str,
) -> Result<Vec<Value>, CliError> {
    let mut stmt = conn.prepare(
        "SELECT ip.person_id,
                COALESCE(p.full_name, ip.display_name, ip.handle, 'Unknown participant') AS name,
                ip.role,
                ip.handle,
                ip.normalized_handle,
                ip.display_name,
                s.slug AS source
         FROM interaction_participants ip
         LEFT JOIN people p ON p.id = ip.person_id AND p.archived_at IS NULL
         LEFT JOIN sources s ON s.id = ip.source_id
         WHERE ip.interaction_id = ?1
         ORDER BY ip.created_at, ip.id",
    )?;
    let rows = stmt.query_map(params![interaction_id], |row| {
        Ok(json!({
            "personId": row.get::<_, Option<String>>(0)?,
            "name": row.get::<_, String>(1)?,
            "role": row.get::<_, Option<String>>(2)?,
            "handle": row.get::<_, Option<String>>(3)?,
            "normalizedHandle": row.get::<_, Option<String>>(4)?,
            "displayName": row.get::<_, Option<String>>(5)?,
            "source": row.get::<_, Option<String>>(6)?,
        }))
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(CliError::from)
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
