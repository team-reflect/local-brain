//! Source commands: provider-neutral upstream system registry used for
//! idempotent imports.

use rusqlite::{params, Connection};
use serde_json::json;

use super::now_iso;
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;

pub struct EnsureSourceArgs<'a> {
    pub slug: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
}

pub fn ensure(conn: &mut Connection, json: bool, args: EnsureSourceArgs) -> Result<(), CliError> {
    let slug = normalize_slug(args.slug)?;
    let name = args.name.trim();
    if name.is_empty() {
        return Err(CliError::Runtime("--name cannot be blank".into()));
    }
    let existing = conn
        .query_row(
            "SELECT id FROM sources WHERE slug = ?1",
            params![slug],
            |row| row.get::<_, String>(0),
        )
        .ok();
    let (id, created) = if let Some(id) = existing {
        conn.execute(
            "UPDATE sources
             SET name = ?1,
                 description = COALESCE(?2, description),
                 updated_at = ?3
             WHERE id = ?4",
            params![
                name,
                normalize_optional(args.description),
                now_iso(conn)?,
                id
            ],
        )?;
        (id, false)
    } else {
        let id = new_id();
        conn.execute(
            "INSERT INTO sources (id, slug, name, description) VALUES (?1,?2,?3,?4)",
            params![id, slug, name, normalize_optional(args.description)],
        )?;
        (id, true)
    };

    if json {
        print_json(&json!({
            "kind": "source",
            "id": id,
            "slug": slug,
            "created": created,
        }))
    } else {
        if created {
            println!("source {id}");
        } else {
            println!("source {id} (updated)");
        }
        Ok(())
    }
}

fn normalize_optional(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn normalize_slug(raw: &str) -> Result<String, CliError> {
    let slug = raw.trim().to_lowercase();
    if slug.is_empty()
        || !slug
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err(CliError::Runtime(
            "--slug must contain only lowercase letters, numbers, '_' or '-'".into(),
        ));
    }
    Ok(slug)
}
