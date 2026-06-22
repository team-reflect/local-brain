//! `brain affiliate` and the shared affiliation upsert: link a person to an
//! organization (their employer/role), deduped by (person, organization, title).
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
    pub department: Option<&'a str>,
    pub role: Option<&'a str>,
    pub role_family: Option<&'a str>,
    pub seniority: Option<&'a str>,
    pub is_current: bool,
    pub is_primary: bool,
}

pub(super) struct AffiliationUpsert<'a> {
    pub person_id: &'a str,
    pub organization_id: &'a str,
    pub title: Option<&'a str>,
    pub department: Option<&'a str>,
    pub role: Option<&'a str>,
    pub role_family: Option<&'a str>,
    pub seniority: Option<&'a str>,
    pub is_current: bool,
    pub is_primary: bool,
}

/// Upsert one person<->org affiliation. Deduped by (person, org, title): an
/// existing row has blank enrichment fields filled and is promoted to current
/// when asked; a new row is inserted otherwise. When `is_current`, every other
/// affiliation for the person is demoted and `people.current_organization_id` is
/// set so exactly one current employer is recorded.
pub(super) fn upsert_affiliation(
    conn: &Connection,
    args: AffiliationUpsert<'_>,
) -> Result<(), CliError> {
    // Demote every current affiliation for the person FIRST, before inserting or
    // promoting the target, so the single-current unique index
    // (idx_affiliations_one_current) is never momentarily violated by two current
    // rows. The target is (re)marked current below.
    if args.is_current {
        conn.execute(
            "UPDATE affiliations
             SET is_current = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE person_id = ?1 AND is_current = 1",
            params![args.person_id],
        )?;
    }
    if args.is_primary {
        conn.execute(
            "UPDATE affiliations
             SET is_primary = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE person_id = ?1 AND is_primary = 1",
            params![args.person_id],
        )?;
    }
    let normalized_title = normalize_optional(args.title);
    let existing: Option<String> = match normalized_title.as_deref() {
        Some(title) => conn
            .query_row(
                "SELECT id FROM affiliations
                 WHERE person_id = ?1 AND organization_id = ?2 AND title = ?3
                 LIMIT 1",
                params![args.person_id, args.organization_id, title],
                |row| row.get(0),
            )
            .optional()?,
        None => {
            let blank_title = conn
                .query_row(
                    "SELECT id FROM affiliations
                     WHERE person_id = ?1
                       AND organization_id = ?2
                       AND (title IS NULL OR trim(title) = '')
                     LIMIT 1",
                    params![args.person_id, args.organization_id],
                    |row| row.get(0),
                )
                .optional()?;
            match blank_title {
                Some(id) => Some(id),
                None => {
                    let mut stmt = conn.prepare(
                        "SELECT id FROM affiliations
                         WHERE person_id = ?1 AND organization_id = ?2
                         LIMIT 2",
                    )?;
                    let ids = stmt
                        .query_map(params![args.person_id, args.organization_id], |row| {
                            row.get::<_, String>(0)
                        })?
                        .collect::<Result<Vec<_>, _>>()?;
                    if ids.len() == 1 {
                        Some(ids[0].clone())
                    } else {
                        None
                    }
                }
            }
        }
    };
    let affiliation_id = match existing {
        Some(id) => {
            conn.execute(
                "UPDATE affiliations
                 SET title = CASE
                       WHEN (title IS NULL OR trim(title) = '') AND ?2 IS NOT NULL THEN ?2 ELSE title END,
                     department = CASE
                       WHEN (department IS NULL OR trim(department) = '') AND ?3 IS NOT NULL THEN ?3 ELSE department END,
                     role = CASE
                       WHEN (role IS NULL OR trim(role) = '') AND ?4 IS NOT NULL THEN ?4 ELSE role END,
                     role_family = CASE
                       WHEN (role_family IS NULL OR trim(role_family) = '') AND ?5 IS NOT NULL THEN ?5 ELSE role_family END,
                     seniority = CASE
                       WHEN (seniority IS NULL OR trim(seniority) = '') AND ?6 IS NOT NULL THEN ?6 ELSE seniority END,
                     is_current = CASE WHEN ?7 = 1 THEN 1 ELSE is_current END,
                     is_primary = CASE WHEN ?8 = 1 THEN 1 ELSE is_primary END,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1",
                params![
                    id,
                    normalized_title.as_deref(),
                    normalize_optional(args.department),
                    normalize_optional(args.role),
                    normalize_optional(args.role_family),
                    normalize_optional(args.seniority),
                    i64::from(args.is_current),
                    i64::from(args.is_primary),
                ],
            )?;
            id
        }
        None => {
            let id = new_id();
            conn.execute(
                "INSERT INTO affiliations
                   (id, person_id, organization_id, title, department, role,
                    role_family, seniority, is_current, is_primary)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                params![
                    id,
                    args.person_id,
                    args.organization_id,
                    normalized_title.as_deref(),
                    normalize_optional(args.department),
                    normalize_optional(args.role),
                    normalize_optional(args.role_family),
                    normalize_optional(args.seniority),
                    i64::from(args.is_current),
                    i64::from(args.is_primary),
                ],
            )?;
            id
        }
    };
    // Others were already demoted above, so the target is the sole current row;
    // sync the denormalized current employer to match.
    if args.is_current {
        conn.execute(
            "UPDATE people
             SET current_organization_id = ?1,
                 current_title = (SELECT title FROM affiliations WHERE id = ?3),
                 current_department = (SELECT department FROM affiliations WHERE id = ?3),
                 role_family = (SELECT role_family FROM affiliations WHERE id = ?3),
                 seniority = (SELECT seniority FROM affiliations WHERE id = ?3),
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?2",
            params![args.organization_id, args.person_id, affiliation_id],
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
        AffiliationUpsert {
            person_id: args.person_id,
            organization_id: args.organization_id,
            title: args.title,
            department: args.department,
            role: args.role,
            role_family: args.role_family,
            seniority: args.seniority,
            is_current: args.is_current,
            is_primary: args.is_primary,
        },
    )?;
    tx.commit()?;
    if json {
        print_json(&json!({
            "kind": "affiliation",
            "personId": args.person_id,
            "organizationId": args.organization_id,
            "isCurrent": args.is_current,
            "isPrimary": args.is_primary,
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

    fn upsert_test_affiliation(
        conn: &Connection,
        person_id: &str,
        organization_id: &str,
        title: Option<&str>,
        department: Option<&str>,
        is_current: bool,
        is_primary: bool,
    ) {
        upsert_affiliation(
            conn,
            AffiliationUpsert {
                person_id,
                organization_id,
                title,
                department,
                role: None,
                role_family: None,
                seniority: None,
                is_current,
                is_primary,
            },
        )
        .unwrap();
    }

    #[test]
    fn upsert_affiliation_dedupes_and_sets_single_current() {
        let conn = brain_schema::open_in_memory().unwrap();
        let (person, org) = seed_person_and_org(&conn);
        upsert_test_affiliation(
            &conn,
            &person,
            &org,
            Some("Lead Designer"),
            None,
            true,
            true,
        );
        // Re-run: must not fork a second affiliation row.
        upsert_test_affiliation(&conn, &person, &org, None, None, false, false);
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
    fn upsert_affiliation_keeps_distinct_titles_separate() {
        let conn = brain_schema::open_in_memory().unwrap();
        let (person, org) = seed_person_and_org(&conn);
        upsert_test_affiliation(&conn, &person, &org, Some("Advisor"), None, false, false);
        upsert_test_affiliation(&conn, &person, &org, Some("Investor"), None, false, false);
        upsert_test_affiliation(
            &conn,
            &person,
            &org,
            Some("Advisor"),
            Some("Board"),
            false,
            false,
        );

        let (count, advisor_department): (i64, String) = conn
            .query_row(
                "SELECT COUNT(*),
                        MAX(CASE WHEN title = 'Advisor' THEN department END)
                 FROM affiliations
                 WHERE person_id = ?1 AND organization_id = ?2",
                params![person, org],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(count, 2);
        assert_eq!(advisor_department, "Board");
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
        upsert_test_affiliation(&conn, &person, &org_a, Some("Founder"), None, true, true);
        upsert_test_affiliation(&conn, &person, &org_b, None, None, true, true);
        let current_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM affiliations WHERE person_id = ?1 AND is_current = 1",
                params![person],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(current_count, 1, "only one current affiliation at a time");
        let (current_org, current_title): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT current_organization_id, current_title FROM people WHERE id = ?1",
                params![person],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(current_org.as_deref(), Some(org_b.as_str()));
        assert_eq!(current_title, None);
    }

    #[test]
    fn affiliate_errors_when_person_missing() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        let (_, org) = seed_person_and_org(&conn);
        let missing = gen_id();
        let result = affiliate(
            &mut conn,
            true,
            AffiliateArgs {
                person_id: &missing,
                organization_id: &org,
                title: None,
                department: None,
                role: None,
                role_family: None,
                seniority: None,
                is_current: false,
                is_primary: false,
            },
        );
        assert!(
            matches!(result, Err(CliError::NotFound(_))),
            "affiliating an unknown person must error, not silently insert"
        );
    }

    #[test]
    fn affiliate_errors_when_organization_missing() {
        let mut conn = brain_schema::open_in_memory().unwrap();
        let (person, _) = seed_person_and_org(&conn);
        let missing = gen_id();
        let result = affiliate(
            &mut conn,
            true,
            AffiliateArgs {
                person_id: &person,
                organization_id: &missing,
                title: None,
                department: None,
                role: None,
                role_family: None,
                seniority: None,
                is_current: false,
                is_primary: false,
            },
        );
        assert!(
            matches!(result, Err(CliError::NotFound(_))),
            "affiliating with an unknown organization must error"
        );
    }
}
