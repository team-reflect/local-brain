use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;

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

pub(super) fn normalize_primary_email(conn: &Connection, person_id: &str) -> Result<(), CliError> {
    let primary_email: Option<String> = conn.query_row(
        "SELECT primary_email FROM people WHERE id = ?1",
        params![person_id],
        |row| row.get(0),
    )?;
    let normalized_primary = normalize_email(primary_email.as_deref());
    let preferred_id: Option<String> = match normalized_primary.as_deref() {
        Some(primary) => conn
            .query_row(
                "SELECT id FROM person_emails
                 WHERE person_id = ?1 AND normalized_email = ?2
                 ORDER BY is_primary DESC, created_at ASC, id ASC
                 LIMIT 1",
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
                "SELECT id FROM person_emails
                 WHERE person_id = ?1
                 ORDER BY is_primary DESC, created_at ASC, id ASC
                 LIMIT 1",
                params![person_id],
                |row| row.get(0),
            )
            .optional()?,
    };
    if let Some(chosen) = chosen {
        conn.execute(
            "UPDATE person_emails
             SET is_primary = CASE WHEN id = ?2 THEN 1 ELSE 0 END,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE person_id = ?1",
            params![person_id, chosen],
        )?;
        let email: String = conn.query_row(
            "SELECT email FROM person_emails WHERE id = ?1",
            params![chosen],
            |row| row.get(0),
        )?;
        conn.execute(
            "UPDATE people
             SET primary_email = ?2,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![person_id, email],
        )?;
    } else {
        conn.execute(
            "UPDATE people
             SET primary_email = NULL,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![person_id],
        )?;
    }
    Ok(())
}

pub(super) fn normalize_primary_phone(conn: &Connection, person_id: &str) -> Result<(), CliError> {
    let primary_phone: Option<String> = conn.query_row(
        "SELECT primary_phone FROM people WHERE id = ?1",
        params![person_id],
        |row| row.get(0),
    )?;
    let normalized_primary = normalize_phone(primary_phone.as_deref());
    let preferred_id: Option<String> = match normalized_primary.as_deref() {
        Some(primary) => conn
            .query_row(
                "SELECT id FROM person_phones
                 WHERE person_id = ?1 AND normalized_phone = ?2
                 ORDER BY is_primary DESC, created_at ASC, id ASC
                 LIMIT 1",
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
                "SELECT id FROM person_phones
                 WHERE person_id = ?1
                 ORDER BY is_primary DESC, created_at ASC, id ASC
                 LIMIT 1",
                params![person_id],
                |row| row.get(0),
            )
            .optional()?,
    };
    if let Some(chosen) = chosen {
        conn.execute(
            "UPDATE person_phones
             SET is_primary = CASE WHEN id = ?2 THEN 1 ELSE 0 END,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE person_id = ?1",
            params![person_id, chosen],
        )?;
        let phone: String = conn.query_row(
            "SELECT phone FROM person_phones WHERE id = ?1",
            params![chosen],
            |row| row.get(0),
        )?;
        conn.execute(
            "UPDATE people
             SET primary_phone = ?2,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![person_id, phone],
        )?;
    } else {
        conn.execute(
            "UPDATE people
             SET primary_phone = NULL,
                 updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
             WHERE id = ?1",
            params![person_id],
        )?;
    }
    Ok(())
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

fn email_owned_by_other(
    conn: &Connection,
    person_id: &str,
    normalized_email: &str,
) -> Result<bool, CliError> {
    Ok(conn.query_row(
        "SELECT EXISTS(
           SELECT 1
           FROM people p
           LEFT JOIN person_emails pe ON pe.person_id = p.id
           WHERE p.archived_at IS NULL
             AND p.id <> ?1
             AND (lower(p.primary_email) = ?2 OR pe.normalized_email = ?2)
         )",
        params![person_id, normalized_email],
        |row| row.get(0),
    )?)
}

fn phone_owned_by_other(
    conn: &Connection,
    person_id: &str,
    normalized_phone: &str,
) -> Result<bool, CliError> {
    Ok(conn.query_row(
        "SELECT EXISTS(
           SELECT 1
           FROM people p
           LEFT JOIN person_phones pp ON pp.person_id = p.id
           WHERE p.archived_at IS NULL
             AND p.id <> ?1
             AND (
               pp.normalized_phone = ?2
               OR replace(replace(replace(replace(replace(COALESCE(p.primary_phone, ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') = ?2
             )
         )",
        params![person_id, normalized_phone],
        |row| row.get(0),
    )?)
}

fn active_phone_owners(conn: &Connection, normalized_phone: &str) -> Result<Vec<String>, CliError> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT p.id
         FROM people p
         LEFT JOIN person_phones pp ON pp.person_id = p.id
         WHERE p.archived_at IS NULL
           AND (
             pp.normalized_phone = ?1
             OR replace(replace(replace(replace(replace(COALESCE(p.primary_phone, ''), '+', ''), ' ', ''), '-', ''), '(', ''), ')', '') = ?1
           )
         ORDER BY p.id",
    )?;
    let rows = stmt.query_map(params![normalized_phone], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn person_email_add(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.person_id)?;
    let email = normalize_optional(Some(args.value))
        .ok_or_else(|| CliError::Runtime("--email cannot be blank".into()))?;
    let normalized_email = normalize_email(Some(&email))
        .ok_or_else(|| CliError::Runtime("--email cannot be blank".into()))?;
    if !valid_email(&normalized_email) {
        return Err(CliError::Runtime(
            "--email must be a valid email address".into(),
        ));
    }
    let tx = conn.transaction()?;
    if email_owned_by_other(&tx, args.person_id, &normalized_email)? {
        return Err(CliError::Runtime(format!(
            "email {normalized_email} is already owned by another active person"
        )));
    }
    let existed: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM person_emails
           WHERE person_id = ?1 AND normalized_email = ?2
         )",
        params![args.person_id, normalized_email],
        |row| row.get(0),
    )?;
    if !existed {
        tx.execute(
            "INSERT INTO person_emails (id, person_id, email, normalized_email, is_primary)
             VALUES (?1,?2,?3,?4,0)",
            params![new_id(), args.person_id, email, normalized_email],
        )?;
    }
    normalize_primary_email(&tx, args.person_id)?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "person_email",
            "personId": args.person_id,
            "email": normalized_email,
            "created": !existed,
        }))
    } else {
        println!("email {normalized_email}");
        Ok(())
    }
}

pub fn person_email_remove(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.person_id)?;
    let normalized_email = normalize_email(Some(args.value))
        .ok_or_else(|| CliError::Runtime("--email cannot be blank".into()))?;
    let tx = conn.transaction()?;
    let changed = tx.execute(
        "DELETE FROM person_emails WHERE person_id = ?1 AND normalized_email = ?2",
        params![args.person_id, normalized_email],
    )?;
    let primary_email: Option<String> = tx.query_row(
        "SELECT primary_email FROM people WHERE id = ?1",
        params![args.person_id],
        |row| row.get(0),
    )?;
    if normalize_email(primary_email.as_deref()).as_deref() == Some(normalized_email.as_str()) {
        tx.execute(
            "UPDATE people SET primary_email = NULL WHERE id = ?1",
            params![args.person_id],
        )?;
    }
    normalize_primary_email(&tx, args.person_id)?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "person_email",
            "personId": args.person_id,
            "email": normalized_email,
            "removed": changed,
        }))
    } else {
        println!("removed email {normalized_email}");
        Ok(())
    }
}

pub fn person_phone_add(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.person_id)?;
    let phone = normalize_optional(Some(args.value))
        .ok_or_else(|| CliError::Runtime("--phone cannot be blank".into()))?;
    let normalized_phone = normalize_phone(Some(&phone))
        .ok_or_else(|| CliError::Runtime("--phone must contain digits".into()))?;
    let tx = conn.transaction()?;
    if phone_owned_by_other(&tx, args.person_id, &normalized_phone)? {
        return Err(CliError::Runtime(format!(
            "phone {normalized_phone} is already owned by another active person"
        )));
    }
    let existed: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM person_phones
           WHERE person_id = ?1 AND normalized_phone = ?2
         )",
        params![args.person_id, normalized_phone],
        |row| row.get(0),
    )?;
    if !existed {
        tx.execute(
            "INSERT INTO person_phones (id, person_id, phone, normalized_phone, is_primary)
             VALUES (?1,?2,?3,?4,0)",
            params![new_id(), args.person_id, phone, normalized_phone],
        )?;
    }
    normalize_primary_phone(&tx, args.person_id)?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "person_phone",
            "personId": args.person_id,
            "phone": normalized_phone,
            "created": !existed,
        }))
    } else {
        println!("phone {normalized_phone}");
        Ok(())
    }
}

pub fn person_phone_remove(
    conn: &mut Connection,
    json_output: bool,
    args: PersonContactArgs,
) -> Result<(), CliError> {
    require_active_person(conn, args.person_id)?;
    let normalized_phone = normalize_phone(Some(args.value))
        .ok_or_else(|| CliError::Runtime("--phone must contain digits".into()))?;
    let tx = conn.transaction()?;
    let changed = tx.execute(
        "DELETE FROM person_phones WHERE person_id = ?1 AND normalized_phone = ?2",
        params![args.person_id, normalized_phone],
    )?;
    let primary_phone: Option<String> = tx.query_row(
        "SELECT primary_phone FROM people WHERE id = ?1",
        params![args.person_id],
        |row| row.get(0),
    )?;
    if normalize_phone(primary_phone.as_deref()).as_deref() == Some(normalized_phone.as_str()) {
        tx.execute(
            "UPDATE people SET primary_phone = NULL WHERE id = ?1",
            params![args.person_id],
        )?;
    }
    normalize_primary_phone(&tx, args.person_id)?;
    tx.commit()?;
    if json_output {
        print_json(&json!({
            "kind": "person_phone",
            "personId": args.person_id,
            "phone": normalized_phone,
            "removed": changed,
        }))
    } else {
        println!("removed phone {normalized_phone}");
        Ok(())
    }
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
    let owned_by_from: bool = tx.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM person_phones
           WHERE person_id = ?1 AND normalized_phone = ?2
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
