//! `brain` command implementations. Each function takes the opened
//! `rusqlite::Connection` and the global `--json` flag and writes data to
//! stdout / diagnostics to stderr. Shared helpers (link parsing, text sourcing,
//! timestamps) live here.

pub mod add;
pub mod graph;
pub mod read;
pub mod report;
pub mod source;

use std::io::Read;
use std::path::Path;

use rusqlite::Connection;

use crate::error::CliError;

/// The visible record kinds a link can point at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkKind {
    Person,
    Organization,
    Project,
    Task,
    Document,
    Interaction,
}

impl LinkKind {
    /// The canonical `record_type` string stored in join/provenance tables
    /// (`memory_links`, `asset_links`, …). The single source of truth so every
    /// writer labels a link the same way.
    pub fn as_str(self) -> &'static str {
        match self {
            LinkKind::Person => "person",
            LinkKind::Organization => "organization",
            LinkKind::Project => "project",
            LinkKind::Task => "task",
            LinkKind::Document => "document",
            LinkKind::Interaction => "interaction",
        }
    }
}

/// A parsed `--link kind:id` reference.
#[derive(Debug, Clone)]
pub struct LinkRef {
    pub kind: LinkKind,
    pub id: String,
}

/// A parsed evidence pointer, e.g. `interaction:01ABC#0`.
#[derive(Debug, Clone)]
pub struct EvidenceRef {
    pub kind: LinkKind,
    pub id: String,
    pub chunk_index: i64,
}

/// Parse `person:01ABC` / `organization:…` / `project:…` / `task:…`.
pub fn parse_link(raw: &str) -> Result<LinkRef, CliError> {
    let (kind, id) = raw
        .split_once(':')
        .ok_or_else(|| CliError::Runtime(format!("invalid --link '{raw}' (expected kind:id)")))?;
    let kind = match kind {
        "person" => LinkKind::Person,
        "organization" | "org" => LinkKind::Organization,
        "project" => LinkKind::Project,
        "task" => LinkKind::Task,
        "document" | "doc" => LinkKind::Document,
        "interaction" => LinkKind::Interaction,
        other => return Err(CliError::Runtime(format!("unknown link kind '{other}'"))),
    };
    if id.is_empty() {
        return Err(CliError::Runtime(format!(
            "invalid --link '{raw}' (empty id)"
        )));
    }
    Ok(LinkRef {
        kind,
        id: id.to_string(),
    })
}

pub fn parse_links(raw: &[String]) -> Result<Vec<LinkRef>, CliError> {
    raw.iter().map(|r| parse_link(r)).collect()
}

/// Parse `document:<id>#<chunk_index>` / `interaction:<id>#<chunk_index>`.
pub fn parse_evidence_ref(raw: &str) -> Result<EvidenceRef, CliError> {
    let (link, chunk) = raw.split_once('#').ok_or_else(|| {
        CliError::Runtime(format!(
            "invalid --evidence '{raw}' (expected document:id#chunk or interaction:id#chunk)"
        ))
    })?;
    let link = parse_link(link)?;
    if !matches!(link.kind, LinkKind::Document | LinkKind::Interaction) {
        return Err(CliError::Runtime(format!(
            "invalid --evidence '{raw}' (evidence must cite a document or interaction chunk)"
        )));
    }
    let chunk_index = chunk.parse::<i64>().map_err(|_| {
        CliError::Runtime(format!(
            "invalid --evidence '{raw}' (chunk index must be an integer)"
        ))
    })?;
    if chunk_index < 0 {
        return Err(CliError::Runtime(format!(
            "invalid --evidence '{raw}' (chunk index must be non-negative)"
        )));
    }
    Ok(EvidenceRef {
        kind: link.kind,
        id: link.id,
        chunk_index,
    })
}

pub fn parse_evidence_refs(raw: &[String]) -> Result<Vec<EvidenceRef>, CliError> {
    raw.iter().map(|r| parse_evidence_ref(r)).collect()
}

/// Resolve the body text for an `add` command from `--text` or `--text-file`
/// (a path, or `-` for stdin). Exactly one must be provided.
pub fn resolve_text(text: Option<&str>, text_file: Option<&Path>) -> Result<String, CliError> {
    match (text, text_file) {
        (Some(t), None) => Ok(t.to_string()),
        (None, Some(path)) => {
            if path.as_os_str() == "-" {
                let mut buf = String::new();
                std::io::stdin()
                    .read_to_string(&mut buf)
                    .map_err(|e| CliError::Runtime(format!("could not read stdin: {e}")))?;
                Ok(buf)
            } else {
                std::fs::read_to_string(path).map_err(|e| {
                    CliError::Runtime(format!("could not read {}: {e}", path.display()))
                })
            }
        }
        (Some(_), Some(_)) => Err(CliError::Runtime(
            "provide only one of --text / --text-file".into(),
        )),
        (None, None) => Err(CliError::Runtime("provide --text or --text-file".into())),
    }
}

/// Resolve optional body text for commands that can be represented by typed
/// fields alone. At most one source may be provided.
pub fn resolve_optional_text(
    text: Option<&str>,
    text_file: Option<&Path>,
) -> Result<Option<String>, CliError> {
    match (text, text_file) {
        (Some(t), None) => Ok(Some(t.to_string())),
        (None, Some(path)) => resolve_text(None, Some(path)).map(Some),
        (Some(_), Some(_)) => Err(CliError::Runtime(
            "provide only one of --text / --text-file".into(),
        )),
        (None, None) => Ok(None),
    }
}

/// Current timestamp as the app's ISO-8601 millisecond format, from SQLite so it
/// matches column defaults exactly.
pub fn now_iso(conn: &Connection) -> Result<String, CliError> {
    Ok(
        conn.query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')", [], |row| {
            row.get(0)
        })?,
    )
}

/// Today's date (`YYYY-MM-DD`) from SQLite, for task bucketing.
pub fn today(conn: &Connection) -> Result<String, CliError> {
    Ok(conn.query_row("SELECT date('now')", [], |row| row.get(0))?)
}

/// Build a safe FTS5 `MATCH` expression from arbitrary text — the Rust twin of
/// `toMatchQuery` in core. Tokenizes to alphanumerics (so no FTS operator can
/// survive), prefix-matches the last token, and joins with AND (precision) or
/// OR (recall, for question-style retrieval). Returns `None` when there are no
/// searchable tokens.
pub fn to_match_query(raw: &str, or: bool) -> Option<String> {
    let lower = raw.to_lowercase();
    let tokens: Vec<String> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|t| !t.is_empty())
        .map(|t| t.to_string())
        .collect();
    if tokens.is_empty() {
        return None;
    }
    let last = tokens.len() - 1;
    let terms: Vec<String> = tokens
        .iter()
        .enumerate()
        .map(|(i, t)| {
            if i == last {
                format!("{t}*")
            } else {
                t.clone()
            }
        })
        .collect();
    Some(terms.join(if or { " OR " } else { " " }))
}

/// Build a `%term%` `LIKE` pattern from arbitrary text — the Rust twin of core's
/// `toLikePattern`. Escapes the LIKE wildcards (`\`, `%`, `_`) so they match
/// literally (paired with an `ESCAPE '\'` clause) instead of deleting them, which
/// would turn a wildcard-only query into a `%%` that matches every record.
/// Returns `None` for blank input.
pub fn to_like_pattern(raw: &str) -> Option<String> {
    let needle = raw.trim();
    if needle.is_empty() {
        return None;
    }
    let mut pattern = String::with_capacity(needle.len() + 2);
    pattern.push('%');
    for ch in needle.chars() {
        if matches!(ch, '\\' | '%' | '_') {
            pattern.push('\\');
        }
        pattern.push(ch);
    }
    pattern.push('%');
    Some(pattern)
}
