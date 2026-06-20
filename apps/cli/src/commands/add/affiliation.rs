//! `brain affiliate` and the shared affiliation upsert: link a person to an
//! organization (their employer/role), deduped by (person, organization).
//! Marking an affiliation current makes it the person's single current employer
//! and stamps `people.current_organization_id`.

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;

use super::text::normalize_optional;
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;

pub struct AffiliateArgs<'a> {
    pub person_id: &'a str,
    pub organization_id: &'a str,
    pub title: Option<&'a str>,
    pub role: Option<&'a str>,
    pub is_current: bool,
}

/// Upsert one person<->org affiliation. Deduped by (person, org): an existing row
/// has its blank title/role filled and is promoted to current when asked; a new
/// row is inserted otherwise. When `is_current`, every other affiliation for the
/// person is demoted and `people.current_organization_id` is set so exactly one
/// current employer is recorded.
pub(super) fn upsert_affiliation(
    conn: &Connection,
    person_id: &str,
    organization_id: &str,
    title: Option<&str>,
    role: Option<&str>,
    is_current: bool,
) -> Result<(), CliError> {
    let existing: Option<String> = conn
        .query_row(
            "SELECT id FROM affiliations
             WHERE person_id = ?1 AND organization_id = ?2
             LIMIT 1",
            params![person_id, organization_id],
            |row| row.get(0),
        )
        .optional()?;
    let affiliation_id = match existing {
        Some(id) => {
            conn.execute(
                "UPDATE affiliations
                 SET title = CASE
                       WHEN (title IS NULL OR trim(title) = '') AND ?2 IS NOT NULL THEN ?2 ELSE title END,
                     role = CASE
                       WHEN (role IS NULL OR trim(role) = '') AND ?3 IS NOT NULL THEN ?3 ELSE role END,
                     is_current = CASE WHEN ?4 = 1 THEN 1 ELSE is_current END,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1",
                params![
                    id,
                    normalize_optional(title),
                    normalize_optional(role),
                    i64::from(is_current),
                ],
            )?;
            id
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO affiliations
                   (id, person_id, organization_id, title, role, is_current)
                 VALUES (?1,?2,?3,?4,?5,?6)",
                params![
                    id,
                    person_id,
                    organization_id,
                    normalize_optional(title),
                    normalize_optional(role),
                    i64::from(is_current),
                ],
            )?;
            id
        }
    };
    if is_current {
        conn.execute(
            "UPDATE affiliations
             SET is_current = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE person_id = ?1 AND id <> ?2 AND is_current = 1",
            params![person_id, affiliation_id],
        )?;
        conn.execute(
            "UPDATE people
             SET current_organization_id = ?1,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?2",
            params![organization_id, person_id],
        )?;
    }
    Ok(())
}

pub fn affiliate(conn: &mut Connection, json: bool, args: AffiliateArgs) -> Result<(), CliError> {
    let person_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM people WHERE id = ?1 AND archived_at IS NULL)",
        params![args.person_id],
        |row| row.get(0),
    )?;
    if !person_exists {
        return Err(CliError::NotFound(format!(
            "no active person {}",
            args.person_id
        )));
    }
    let org_exists: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM organizations WHERE id = ?1 AND archived_at IS NULL)",
        params![args.organization_id],
        |row| row.get(0),
    )?;
    if !org_exists {
        return Err(CliError::NotFound(format!(
            "no active organization {}",
            args.organization_id
        )));
    }
    let tx = conn.transaction()?;
    upsert_affiliation(
        &tx,
        args.person_id,
        args.organization_id,
        args.title,
        args.role,
        args.is_current,
    )?;
    tx.commit()?;
    if json {
        print_json(&json!({
            "kind": "affiliation",
            "personId": args.person_id,
            "organizationId": args.organization_id,
            "isCurrent": args.is_current,
        }))
    } else {
        println!(
            "affiliated person {} with organization {}",
            args.person_id, args.organization_id
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::id::new_id as gen_id;

    fn seed_person_and_org(conn: &Connection) -> (String, String) {
        let person = gen_id();
        let org = gen_id();
        conn.execute(
            "INSERT INTO people (id, full_name) VALUES (?1, 'Lisa Freeman')",
            params![person],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO organizations (id, name) VALUES (?1, 'Evensen Design')",
            params![org],
        )
        .unwrap();
        (person, org)
    }

    #[test]
    fn upsert_affiliation_dedupes_and_sets_single_current() {
        let conn = brain_schema::open_in_memory().unwrap();
        let (person, org) = seed_person_and_org(&conn);
        upsert_affiliation(&conn, &person, &org, Some("Lead Designer"), None, true).unwrap();
        // Re-run: must not fork a second affiliation row.
        upsert_affiliation(&conn, &person, &org, None, None, false).unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM affiliations WHERE person_id = ?1",
                params![person],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "affiliation deduped by (person, org)");
        let current_org: Option<String> = conn
            .query_row(
                "SELECT current_organization_id FROM people WHERE id = ?1",
                params![person],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(current_org.as_deref(), Some(org.as_str()));
    }

    #[test]
    fn marking_current_demotes_prior_current_affiliation() {
        let conn = brain_schema::open_in_memory().unwrap();
        let (person, org_a) = seed_person_and_org(&conn);
        let org_b = gen_id();
        conn.execute(
            "INSERT INTO organizations (id, name) VALUES (?1, 'New Co')",
            params![org_b],
        )
        .unwrap();
        upsert_affiliation(&conn, &person, &org_a, None, None, true).unwrap();
        upsert_affiliation(&conn, &person, &org_b, None, None, true).unwrap();
        let current_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM affiliations WHERE person_id = ?1 AND is_current = 1",
                params![person],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(current_count, 1, "only one current affiliation at a time");
        let current_org: Option<String> = conn
            .query_row(
                "SELECT current_organization_id FROM people WHERE id = ?1",
                params![person],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(current_org.as_deref(), Some(org_b.as_str()));
    }
}
