use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Map, Value};

use super::super::text::{
    normalize_email, normalize_optional, normalize_phone, normalize_title, valid_email,
};
use super::{
    insert_cleanup_provenance, refresh_person_chunks, require_active_person, PersonContactArgs,
    PersonPhoneMoveArgs, PersonRenameArgs,
};
use crate::error::CliError;
use crate::id::new_id;
use crate::output::print_json;

/// SQL that normalizes the denormalized `people.primary_phone` column (which has
/// no stored normalized form) for cross-person ownership comparisons. Backed by the
/// `normalize_phone` SQL function registered in `db::open`, so it matches the Rust
/// [`normalize_phone`] — and therefore the handle table's `normalized_phone` —
/// exactly, with no formatting drift.
const PHONE_PRIMARY_NORMALIZED_SQL: &str = "normalize_phone(p.primary_phone)";

/// One person contact channel (email or phone). A single descriptor parameterizes
/// the otherwise identical add / remove / primary-normalization machinery so the
/// two channels can't drift apart.
struct ContactKind {
    /// `kind` value in JSON output, e.g. `"person_email"`.
    json_kind: &'static str,
    /// Human noun used in messages and as the JSON value key, e.g. `"email"`.
    noun: &'static str,
    /// Handle table, e.g. `"person_emails"`.
    table: &'static str,
    /// Display-value column on `table`, e.g. `"email"`.
    value_col: &'static str,
    /// Normalized-key column on `table`, e.g. `"normalized_email"`.
    normalized_col: &'static str,
    /// Denormalized primary column on `people`, e.g. `"primary_email"`.
    primary_col: &'static str,
    /// Normalizer mirroring how the column is stored.
    normalize: fn(Option<&str>) -> Option<String>,
    /// SQL expression (over `people` alias `p`) that normalizes `primary_col` for
    /// cross-person ownership comparisons.
    primary_normalized_sql: &'static str,
    /// Error when the input is blank.
    blank_error: &'static str,
    /// Error when the input normalizes to nothing, e.g. `"--phone must contain digits"`.
    normalize_error: &'static str,
    /// Optional extra structural check on the normalized value (email shape).
    validate: Option<fn(&str) -> bool>,
    /// Error when `validate` fails.
    validate_error: &'static str,
}

const EMAIL: ContactKind = ContactKind {
    json_kind: "person_email",
    noun: "email",
    table: "person_emails",
    value_col: "email",
    normalized_col: "normalized_email",
    primary_col: "primary_email",
    normalize: normalize_email,
    primary_normalized_sql: "lower(p.primary_email)",
    blank_error: "--email cannot be blank",
    normalize_error: "--email cannot be blank",
    validate: Some(valid_email),
    validate_error: "--email must be a valid email address",
};

const PHONE: ContactKind = ContactKind {
    json_kind: "person_phone",
    noun: "phone",
    table: "person_phones",
    value_col: "phone",
    normalized_col: "normalized_phone",
    primary_col: "primary_phone",
    normalize: normalize_phone,
    primary_normalized_sql: PHONE_PRIMARY_NORMALIZED_SQL,
    blank_error: "--phone cannot be blank",
    normalize_error: "--phone must contain digits",
    validate: None,
    validate_error: "",
};

/// Pick exactly one handle row to be `is_primary` for the person and sync the
/// denormalized `people.<primary_col>` to its value. Prefers a row matching the
/// existing primary value, else the oldest/primary-flagged row; clears the column
/// when the person has no handles left.
fn normalize_primary_handle(
    conn: &Connection,
    person_id: &str,
    kind: &ContactKind,
) -> Result<(), CliError> {
    let primary: Option<String> = conn.query_row(
        &format!("SELECT {} FROM people WHERE id = ?1", kind.primary_col),
        params![person_id],
        |row| row.get(0),
    )?;
    let normalized_primary = (kind.normalize)(primary.as_deref());
    let preferred_id: Option<String> = match normalized_primary.as_deref() {
        Some(primary) => conn
            .query_row(
                &format!(
                    "SELECT id FROM {table}
                     WHERE person_id = ?1 AND {normalized_col} = ?2
                     ORDER BY is_primary DESC, created_at ASC, id ASC
                     LIMIT 1",
                    table = kind.table,
                    normalized_col = kind.normalized_col,
                ),
                params![person_id, primary],
                |row| row.get(0),
            )
            .optional()?,
        None => None,
    };
    let chosen = match preferred_id {
        Some(id) => Some(id),
        None => conn
            .query_row(
                &format!(
                    "SELECT id FROM {table}
                     WHERE person_id = ?1
                     ORDER BY is_primary DESC, created_at ASC, id ASC
                     LIMIT 1",
                    table = kind.table,
                ),
                params![person_id],
                |row| row.get(0),
            )
            .optional()?,
    };
    if let Some(chosen) = chosen {
        conn.execute(
            &format!(
                "UPDATE {table}
                 SET is_primary = CASE WHEN id = ?2 THEN 1 ELSE 0 END,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE person_id = ?1",
                table = kind.table,
            ),
            params![person_id, chosen],
        )?;
        let value: String = conn.query_row(
            &format!(
                "SELECT {} FROM {} WHERE id = ?1",
                kind.value_col, kind.table
            ),
            params![chosen],
            |row| row.get(0),
        )?;
        conn.execute(
            &format!(
                "UPDATE people
                 SET {primary_col} = ?2,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1",
                primary_col = kind.primary_col,
            ),
            params![person_id, value],
        )?;
    } else {
        conn.execute(
            &format!(
                "UPDATE people
                 SET {primary_col} = NULL,
                     updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                 WHERE id = ?1",
                primary_col = kind.primary_col,
            ),
            params![person_id],
        )?;
    }
    Ok(())
}

pub(super) fn normalize_primary_email(conn: &Connection, person_id: &str) -> Result<(), CliError> {
    normalize_primary_handle(conn, person_id, &EMAIL)
}

pub(super) fn normalize_primary_phone(conn: &Connection, person_id: &str) -> Result<(), CliError> {
    normalize_primary_handle(conn, person_id, &PHONE)
}

pub fn rename_person(
    conn: &mut Connection,
    json_output: bool,
    args: PersonRenameArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.person_id)?;
    let full_name = normalize_title(Some(args.full_name))
        .ok_or_else(|| CliError::Runtime("--full-name cannot be blank".into()))?;
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE people
         SET full_name = ?2,
             updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE id = ?1",
        params![args.person_id, full_name],
    )?;
    let count = refresh_person_chunks(&tx, args.person_id)?;
    insert_cleanup_provenance(&tx, "person", args.person_id, "renamed", None)?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "person",
            "id": args.person_id,
            "fullName": full_name,
            "chunkCount": count,
        }))
    } else {
        println!("person {}", args.person_id);
        Ok(())
    }
}

/// Whether any *other* active person already owns `normalized` on this channel,
/// checked against both the handle table and the denormalized primary column.
fn handle_owned_by_other(
    conn: &Connection,
    person_id: &str,
    normalized: &str,
    kind: &ContactKind,
) -> Result<bool, CliError> {
    Ok(conn.query_row(
        &format!(
            "SELECT EXISTS(
               SELECT 1
               FROM people p
               LEFT JOIN {table} h ON h.person_id = p.id
               WHERE p.archived_at IS NULL
                 AND p.id <> ?1
                 AND (h.{normalized_col} = ?2 OR {primary_expr} = ?2)
             )",
            table = kind.table,
            normalized_col = kind.normalized_col,
            primary_expr = kind.primary_normalized_sql,
        ),
        params![person_id, normalized],
        |row| row.get(0),
    )?)
}

/// The first *active* person other than `exclude_a` / `exclude_b` that owns
/// `normalized` on this channel (via a handle row or the denormalized primary
/// column), if any. Person merge uses this to avoid handing a contact to a second
/// active owner.
pub(super) fn active_contact_owner_excluding(
    conn: &Connection,
    is_email: bool,
    normalized: &str,
    exclude_a: &str,
    exclude_b: &str,
) -> Result<Option<String>, CliError> {
    let kind = if is_email { &EMAIL } else { &PHONE };
    Ok(conn
        .query_row(
            &format!(
                "SELECT p.id
                 FROM people p
                 LEFT JOIN {table} h ON h.person_id = p.id
                 WHERE p.archived_at IS NULL
                   AND p.id <> ?1
                   AND p.id <> ?2
                   AND (h.{normalized_col} = ?3 OR {primary_expr} = ?3)
                 LIMIT 1",
                table = kind.table,
                normalized_col = kind.normalized_col,
                primary_expr = kind.primary_normalized_sql,
            ),
            params![exclude_a, exclude_b, normalized],
            |row| row.get(0),
        )
        .optional()?)
}

fn active_phone_owners(conn: &Connection, normalized_phone: &str) -> Result<Vec<String>, CliError> {
    let mut stmt = conn.prepare(&format!(
        "SELECT DISTINCT p.id
         FROM people p
         LEFT JOIN person_phones pp ON pp.person_id = p.id
         WHERE p.archived_at IS NULL
           AND (pp.normalized_phone = ?1 OR {PHONE_PRIMARY_NORMALIZED_SQL} = ?1)
         ORDER BY p.id",
    ))?;
    let rows = stmt.query_map(params![normalized_phone], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Add a contact handle to a person (idempotent on the normalized value), then
/// re-pick the primary. Refuses values already owned by another active person.
fn person_handle_add(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
    kind: &ContactKind,
) -> Result<(), CliError> {
    require_active_person(conn, args.person_id)?;
    let display = normalize_optional(Some(args.value))
        .ok_or_else(|| CliError::Runtime(kind.blank_error.into()))?;
    let normalized = (kind.normalize)(Some(&display))
        .ok_or_else(|| CliError::Runtime(kind.normalize_error.into()))?;
    if let Some(validate) = kind.validate {
        if !validate(&normalized) {
            return Err(CliError::Runtime(kind.validate_error.into()));
        }
    }
    let tx = conn.transaction()?;
    if handle_owned_by_other(&tx, args.person_id, &normalized, kind)? {
        return Err(CliError::Runtime(format!(
            "{} {normalized} is already owned by another active person",
            kind.noun
        )));
    }
    let existed: bool = tx.query_row(
        &format!(
            "SELECT EXISTS(SELECT 1 FROM {table} WHERE person_id = ?1 AND {normalized_col} = ?2)",
            table = kind.table,
            normalized_col = kind.normalized_col,
        ),
        params![args.person_id, normalized],
        |row| row.get(0),
    )?;
    if !existed {
        tx.execute(
            &format!(
                "INSERT INTO {table} (id, person_id, {value_col}, {normalized_col}, is_primary)
                 VALUES (?1,?2,?3,?4,0)",
                table = kind.table,
                value_col = kind.value_col,
                normalized_col = kind.normalized_col,
            ),
            params![new_id(), args.person_id, display, normalized],
        )?;
    }
    normalize_primary_handle(&tx, args.person_id, kind)?;
    tx.commit()?;
    if json_output {
        print_json(&handle_json(
            kind,
            args.person_id,
            &normalized,
            "created",
            json!(!existed),
        ))
    } else {
        println!("{} {normalized}", kind.noun);
        Ok(())
    }
}

/// Remove a contact handle from a person, clear the primary column if it pointed
/// at the removed value, then re-pick the primary.
fn person_handle_remove(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
    kind: &ContactKind,
) -> Result<(), CliError> {
    require_active_person(conn, args.person_id)?;
    let normalized = (kind.normalize)(Some(args.value))
        .ok_or_else(|| CliError::Runtime(kind.normalize_error.into()))?;
    let tx = conn.transaction()?;
    let changed = tx.execute(
        &format!(
            "DELETE FROM {table} WHERE person_id = ?1 AND {normalized_col} = ?2",
            table = kind.table,
            normalized_col = kind.normalized_col,
        ),
        params![args.person_id, normalized],
    )?;
    let primary: Option<String> = tx.query_row(
        &format!("SELECT {} FROM people WHERE id = ?1", kind.primary_col),
        params![args.person_id],
        |row| row.get(0),
    )?;
    if (kind.normalize)(primary.as_deref()).as_deref() == Some(normalized.as_str()) {
        tx.execute(
            &format!(
                "UPDATE people SET {} = NULL WHERE id = ?1",
                kind.primary_col
            ),
            params![args.person_id],
        )?;
    }
    normalize_primary_handle(&tx, args.person_id, kind)?;
    tx.commit()?;
    if json_output {
        print_json(&handle_json(
            kind,
            args.person_id,
            &normalized,
            "removed",
            json!(changed),
        ))
    } else {
        println!("removed {} {normalized}", kind.noun);
        Ok(())
    }
}

/// Build the `{kind, personId, <noun>, <status_key>}` JSON payload shared by the
/// add/remove handlers (the value key is the channel noun, e.g. `"email"`).
fn handle_json(
    kind: &ContactKind,
    person_id: &str,
    normalized: &str,
    status_key: &str,
    status_value: Value,
) -> Value {
    let mut obj = Map::new();
    obj.insert("kind".into(), json!(kind.json_kind));
    obj.insert("personId".into(), json!(person_id));
    obj.insert(kind.noun.into(), json!(normalized));
    obj.insert(status_key.into(), status_value);
    Value::Object(obj)
}

/// Add an email handle to a person.
pub fn person_email_add(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
) -> Result<(), CliError> {
    person_handle_add(conn, json_output, args, &EMAIL)
}

/// Remove an email handle from a person.
pub fn person_email_remove(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
) -> Result<(), CliError> {
    person_handle_remove(conn, json_output, args, &EMAIL)
}

/// Add a phone handle to a person.
pub fn person_phone_add(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
) -> Result<(), CliError> {
    person_handle_add(conn, json_output, args, &PHONE)
}

/// Remove a phone handle from a person.
pub fn person_phone_remove(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
) -> Result<(), CliError> {
    person_handle_remove(conn, json_output, args, &PHONE)
}

pub fn repair_person_phone_move(
    conn: &mut Connection,
    json_output: bool,
    args: PersonPhoneMoveArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.from_person_id)?;
    require_active_person(conn, args.to_person_id)?;
    if args.from_person_id == args.to_person_id {
        return Err(CliError::Runtime(
            "--from and --to must be different people".into(),
        ));
    }
    let display_phone = normalize_optional(Some(args.phone))
        .ok_or_else(|| CliError::Runtime("--phone cannot be blank".into()))?;
    let normalized_phone = normalize_phone(Some(&display_phone))
        .ok_or_else(|| CliError::Runtime("--phone must contain digits".into()))?;
    let tx = conn.transaction()?;
    let owners = active_phone_owners(&tx, &normalized_phone)?;
    let outside_owners = owners
        .iter()
        .filter(|owner| {
            owner.as_str() != args.from_person_id && owner.as_str() != args.to_person_id
        })
        .cloned()
        .collect::<Vec<_>>();
    if !outside_owners.is_empty() {
        return Err(CliError::Runtime(format!(
            "phone {normalized_phone} is also owned by active person(s): {}",
            outside_owners.join(", ")
        )));
    }
    // Match how `active_phone_owners` decides ownership: a handle row OR the
    // denormalized primary column, so a source that holds the number only on
    // `primary_phone` still counts as the owner.
    let owned_by_from: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1
           FROM people p
           LEFT JOIN person_phones pp ON pp.person_id = p.id
           WHERE p.id = ?1
             AND (pp.normalized_phone = ?2 OR normalize_phone(p.primary_phone) = ?2)
         )",
        params![args.from_person_id, normalized_phone],
        |row| row.get(0),
    )?;
    if !owned_by_from {
        return Err(CliError::Runtime(format!(
            "person {} does not own phone {normalized_phone}",
            args.from_person_id
        )));
    }
    let stored_phone: String = tx
        .query_row(
            "SELECT phone FROM person_phones
             WHERE person_id = ?1 AND normalized_phone = ?2
             ORDER BY is_primary DESC, created_at ASC, id ASC
             LIMIT 1",
            params![args.from_person_id, normalized_phone],
            |row| row.get(0),
        )
        .optional()?
        .unwrap_or_else(|| display_phone.clone());
    let deleted_rows = tx.execute(
        "DELETE FROM person_phones WHERE person_id = ?1 AND normalized_phone = ?2",
        params![args.from_person_id, normalized_phone],
    )?;
    normalize_primary_phone(&tx, args.from_person_id)?;
    let existed_on_target: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM person_phones
           WHERE person_id = ?1 AND normalized_phone = ?2
         )",
        params![args.to_person_id, normalized_phone],
        |row| row.get(0),
    )?;
    if !existed_on_target {
        tx.execute(
            "INSERT INTO person_phones (id, person_id, phone, normalized_phone, is_primary)
             VALUES (?1,?2,?3,?4,0)",
            params![new_id(), args.to_person_id, stored_phone, normalized_phone],
        )?;
    }
    normalize_primary_phone(&tx, args.to_person_id)?;
    let relink = if args.relink_participants {
        super::super::participants::relink_participants_for_handle(
            &tx,
            &normalized_phone,
            args.to_person_id,
            Some(args.from_person_id),
            false,
            Some(&stored_phone),
            None,
        )?
    } else {
        super::super::participants::RelinkResult::default()
    };
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "person_phone_move",
            "phone": normalized_phone,
            "fromPersonId": args.from_person_id,
            "toPersonId": args.to_person_id,
            "phoneRowsMoved": deleted_rows,
            "phoneAttached": !existed_on_target,
            "participantsRelinked": relink.updated_rows,
            "participantsMerged": relink.merged_rows,
        }))
    } else {
        println!(
            "phone {} moved {} -> {}",
            normalized_phone, args.from_person_id, args.to_person_id
        );
        Ok(())
    }
}
