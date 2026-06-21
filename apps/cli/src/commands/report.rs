//! Reporting/automation commands: `brain today`, `brain report daily`,
//! `brain tasks plan-day`, `brain changes`.
//! These mirror the app's `reports/` endpoints so a daily automation produces
//! the same structured context from the terminal as the Today surface shows.

use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};

use super::today;
use crate::error::CliError;
use crate::output::print_json;

struct TaskRow {
    id: String,
    title: String,
    status: String,
    due_at: Option<String>,
    scheduled_for: Option<String>,
    priority: Option<i64>,
    project_id: Option<String>,
}

fn fetch_open_tasks(conn: &Connection) -> Result<Vec<TaskRow>, CliError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, status, due_at, scheduled_for, priority, project_id
         FROM tasks
         WHERE archived_at IS NULL AND status IN ('open','in_progress','waiting','blocked')
         ORDER BY due_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(TaskRow {
            id: row.get(0)?,
            title: row.get(1)?,
            status: row.get(2)?,
            due_at: row.get(3)?,
            scheduled_for: row.get(4)?,
            priority: row.get(5)?,
            project_id: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(CliError::from)
}

/// Load all task assignees (role='assignee') in one query, keyed by task_id.
fn fetch_task_assignees(conn: &Connection) -> Result<HashMap<String, Vec<Value>>, CliError> {
    let mut stmt = conn.prepare(
        "SELECT tp.task_id, tp.person_id, p.full_name
         FROM task_people tp
         JOIN people p ON p.id = tp.person_id
         WHERE tp.role = 'assignee' AND p.archived_at IS NULL
         ORDER BY p.full_name ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
        ))
    })?;
    let mut map: HashMap<String, Vec<Value>> = HashMap::new();
    for row in rows {
        let (task_id, person_id, name) = row?;
        map.entry(task_id)
            .or_default()
            .push(json!({ "id": person_id, "name": name }));
    }
    Ok(map)
}

/// `overdue | today | soon | scheduled | open` for a task, given today's date and
/// a soon window. Mirrors core `bucketFor`: a task scheduled for a future day is
/// `scheduled` (ranked with `soon`), not generic `open`.
fn bucket_for(task: &TaskRow, today: &str, soon_cutoff: &str) -> &'static str {
    if let Some(due) = &task.due_at {
        let due = &due[..due.len().min(10)];
        if due < today {
            return "overdue";
        }
        if due == today {
            return "today";
        }
        if due <= soon_cutoff {
            return "soon";
        }
    }
    if let Some(sched) = &task.scheduled_for {
        let sched = &sched[..sched.len().min(10)];
        if sched <= today {
            return "today";
        }
        return "scheduled";
    }
    "open"
}

fn task_json(task: &TaskRow, bucket: &str, assignees: &[Value]) -> Value {
    json!({
        "id": task.id,
        "title": task.title,
        "status": task.status,
        "dueAt": task.due_at,
        "scheduledFor": task.scheduled_for,
        "priority": task.priority,
        "projectId": task.project_id,
        "bucket": bucket,
        "assignees": assignees,
    })
}

/// Soon cutoff = today + `days`, computed by SQLite to avoid date math here.
fn soon_cutoff(conn: &Connection, days: i64) -> Result<String, CliError> {
    Ok(conn.query_row(
        "SELECT date('now', ?1)",
        params![format!("+{days} days")],
        |row| row.get(0),
    )?)
}

fn recent_interactions(conn: &Connection, limit: i64) -> Result<Vec<Value>, CliError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, kind, occurred_at FROM interactions
         WHERE archived_at IS NULL ORDER BY occurred_at DESC LIMIT ?1",
    )?;
    let rows = stmt.query_map(params![limit], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "title": row.get::<_, Option<String>>(1)?,
            "kind": row.get::<_, String>(2)?,
            "occurredAt": row.get::<_, Option<String>>(3)?,
        }))
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(CliError::from)
}

/// Build the daily brief value shared by `brain today` and `brain report daily`.
fn daily_brief(conn: &Connection) -> Result<Value, CliError> {
    let today = today(conn)?;
    let cutoff = soon_cutoff(conn, 7)?;
    let tasks = fetch_open_tasks(conn)?;
    let assignee_map = fetch_task_assignees(conn)?;
    let empty: Vec<Value> = vec![];
    let (mut overdue, mut due_today, mut soon, mut open) = (vec![], vec![], vec![], vec![]);
    for task in &tasks {
        let bucket = bucket_for(task, &today, &cutoff);
        let assignees = assignee_map.get(&task.id).unwrap_or(&empty);
        let value = task_json(task, bucket, assignees);
        match bucket {
            "overdue" => overdue.push(value),
            "today" => due_today.push(value),
            "soon" => soon.push(value),
            _ => open.push(value),
        }
    }
    Ok(json!({
        "date": today,
        "tasks": { "overdue": overdue, "today": due_today, "soon": soon, "open": open },
        "recentInteractions": recent_interactions(conn, 5)?,
        "counts": {
            "openTasks": tasks.len(),
            "overdueTasks": overdue.len(),
            "dueToday": due_today.len(),
        },
    }))
}

pub fn today_brief(conn: &Connection, json: bool) -> Result<(), CliError> {
    let brief = daily_brief(conn)?;
    emit(json, &brief)
}

pub fn report_daily(conn: &Connection, json: bool) -> Result<(), CliError> {
    let brief = daily_brief(conn)?;
    emit(json, &brief)
}

/// `brain tasks plan-day` — a prioritized todo list (overdue → today → soon → open).
pub fn plan_day(conn: &Connection, json: bool, limit: usize) -> Result<(), CliError> {
    let today = today(conn)?;
    let cutoff = soon_cutoff(conn, 7)?;
    let mut tasks = fetch_open_tasks(conn)?;
    let assignee_map = fetch_task_assignees(conn)?;
    let empty: Vec<Value> = vec![];
    let rank = |t: &TaskRow| match bucket_for(t, &today, &cutoff) {
        "overdue" => 0,
        "today" => 1,
        "soon" | "scheduled" => 2,
        _ => 3,
    };
    tasks.sort_by(|a, b| {
        rank(a)
            .cmp(&rank(b))
            .then(a.priority.unwrap_or(99).cmp(&b.priority.unwrap_or(99)))
            .then(
                a.due_at
                    .clone()
                    .unwrap_or_else(|| "~".into())
                    .cmp(&b.due_at.clone().unwrap_or_else(|| "~".into())),
            )
    });
    let plan: Vec<Value> = tasks
        .iter()
        .take(limit)
        .map(|t| {
            let assignees = assignee_map.get(&t.id).unwrap_or(&empty);
            task_json(t, bucket_for(t, &today, &cutoff), assignees)
        })
        .collect();
    emit(json, &json!({ "tasks": plan }))
}

/// `brain changes --since <iso>` — records created/updated at or after a timestamp.
pub fn changes(conn: &Connection, json: bool, since: &str, limit: usize) -> Result<(), CliError> {
    let mut out: Vec<Value> = Vec::new();
    for (table, title_col, kind) in [
        ("people", "full_name", "person"),
        ("organizations", "name", "organization"),
        ("projects", "name", "project"),
        ("tasks", "title", "task"),
        ("documents", "title", "document"),
        ("interactions", "title", "interaction"),
    ] {
        let sql = format!("SELECT id, {title_col}, updated_at FROM {table} WHERE updated_at >= ?1");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params![since], |row| {
            Ok(json!({
                "kind": kind,
                "id": row.get::<_, String>(0)?,
                "title": row.get::<_, Option<String>>(1)?.unwrap_or_else(|| "(untitled)".into()),
                "updatedAt": row.get::<_, String>(2)?,
            }))
        })?;
        for row in rows {
            out.push(row?);
        }
    }
    out.sort_by(|a, b| {
        b["updatedAt"]
            .as_str()
            .unwrap_or("")
            .cmp(a["updatedAt"].as_str().unwrap_or(""))
    });
    out.truncate(limit);
    emit(json, &json!({ "since": since, "changes": out }))
}

fn collect_strings(conn: &Connection, sql: &str, id: &str) -> Result<Vec<String>, CliError> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(params![id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// `brain import-context` — the read-first context an importing agent needs in one
/// call, so it can honor "query before you write" without a dozen separate reads:
///   * `self` — the configured self person + known handles (so participants resolve
///     to the user, and a `configured: false` flags that `brain self set` is needed),
///   * `sources` — registered upstream slugs,
///   * `projects` / `organizations` — existing records to LINK rather than fork
///     (capped by `limit`; compare against `counts` to see if more exist),
///   * `openSuggestions` — pending proposals, so nothing is re-suggested,
///   * `imports` — the latest imported interaction per source (an incremental
///     watermark to resume from),
///   * `counts` — orientation totals.
pub fn import_context(conn: &Connection, json: bool, limit: usize) -> Result<(), CliError> {
    let limit = limit as i64;

    let self_value = match conn
        .query_row(
            "SELECT id, full_name, primary_email FROM people
             WHERE is_self = 1 AND archived_at IS NULL LIMIT 1",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            },
        )
        .optional()?
    {
        Some((id, full_name, primary_email)) => {
            let emails = collect_strings(
                conn,
                "SELECT email FROM person_emails WHERE person_id = ?1 ORDER BY is_primary DESC, email",
                &id,
            )?;
            let phones = collect_strings(
                conn,
                "SELECT phone FROM person_phones WHERE person_id = ?1 ORDER BY is_primary DESC, phone",
                &id,
            )?;
            let configured = primary_email.is_some() || !emails.is_empty();
            json!({
                "id": id,
                "fullName": full_name,
                "primaryEmail": primary_email,
                "emails": emails,
                "phones": phones,
                "configured": configured,
            })
        }
        None => Value::Null,
    };

    let mut stmt = conn.prepare("SELECT slug, name FROM sources ORDER BY slug")?;
    let sources: Vec<Value> = stmt
        .query_map([], |row| {
            Ok(json!({ "slug": row.get::<_, String>(0)?, "name": row.get::<_, String>(1)? }))
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(
        "SELECT id, name, status FROM projects
         WHERE archived_at IS NULL
         ORDER BY (status = 'active') DESC, name ASC
         LIMIT ?1",
    )?;
    let projects: Vec<Value> = stmt
        .query_map(params![limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "status": row.get::<_, String>(2)?,
            }))
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(
        "SELECT id, name, domain FROM organizations
         WHERE archived_at IS NULL
         ORDER BY updated_at DESC, name ASC
         LIMIT ?1",
    )?;
    let organizations: Vec<Value> = stmt
        .query_map(params![limit], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "domain": row.get::<_, Option<String>>(2)?,
            }))
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let mut stmt = conn.prepare(
        "SELECT id, kind, title FROM suggestions
         WHERE status = 'open'
         ORDER BY created_at DESC, id DESC",
    )?;
    let open_suggestions: Vec<Value> = stmt
        .query_map([], |row| {
            Ok(json!({
                "id": row.get::<_, String>(0)?,
                "kind": row.get::<_, String>(1)?,
                "title": row.get::<_, String>(2)?,
            }))
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    // Per-source import watermark: the newest imported interaction and how many,
    // so an incremental import knows where to resume (e.g. "gmail newer_than …").
    let mut stmt = conn.prepare(
        "SELECT s.slug,
                MAX(COALESCE(i.occurred_at, i.created_at)) AS latest,
                COUNT(*) AS imported
         FROM external_identities ei
         JOIN sources s ON s.id = ei.source_id
         JOIN interactions i ON i.id = ei.entity_id
         WHERE ei.entity_type = 'interaction' AND i.archived_at IS NULL
         GROUP BY s.slug
         ORDER BY latest DESC",
    )?;
    let imports: Vec<Value> = stmt
        .query_map([], |row| {
            Ok(json!({
                "source": row.get::<_, String>(0)?,
                "latestAt": row.get::<_, Option<String>>(1)?,
                "count": row.get::<_, i64>(2)?,
            }))
        })?
        .collect::<rusqlite::Result<_>>()?;
    drop(stmt);

    let count =
        |sql: &str| -> Result<i64, CliError> { Ok(conn.query_row(sql, [], |row| row.get(0))?) };
    let counts = json!({
        "people": count("SELECT COUNT(*) FROM people WHERE archived_at IS NULL")?,
        "organizations": count("SELECT COUNT(*) FROM organizations WHERE archived_at IS NULL")?,
        "projects": count("SELECT COUNT(*) FROM projects WHERE archived_at IS NULL")?,
        "interactions": count("SELECT COUNT(*) FROM interactions WHERE archived_at IS NULL")?,
        "documents": count("SELECT COUNT(*) FROM documents WHERE archived_at IS NULL")?,
        "openSuggestions": count("SELECT COUNT(*) FROM suggestions WHERE status = 'open'")?,
    });

    emit(
        json,
        &json!({
            "self": self_value,
            "sources": sources,
            "projects": projects,
            "organizations": organizations,
            "openSuggestions": open_suggestions,
            "imports": imports,
            "counts": counts,
        }),
    )
}

/// Emit a brief either as JSON (stdout data) or a compact human summary.
fn emit(json: bool, value: &Value) -> Result<(), CliError> {
    if json {
        return print_json(value);
    }
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}
