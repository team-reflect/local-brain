//! Reporting/automation commands: `brain today`, `brain report daily`,
//! `brain tasks plan-day`, `brain relationships followups`, `brain changes`.
//! These mirror the app's `reports/` endpoints so a daily automation produces
//! the same structured context from the terminal as the Today surface shows.

use rusqlite::{params, Connection};
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

fn task_json(task: &TaskRow, bucket: &str) -> Value {
    json!({
        "id": task.id,
        "title": task.title,
        "status": task.status,
        "dueAt": task.due_at,
        "scheduledFor": task.scheduled_for,
        "priority": task.priority,
        "projectId": task.project_id,
        "bucket": bucket,
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

fn reconnect_suggestions(conn: &Connection) -> Result<Vec<Value>, CliError> {
    let mut stmt = conn.prepare(
        "SELECT people.id,
                people.full_name,
                relationship_strengths.relationship_strength,
                people.last_interaction_at,
                people.next_reconnect_at
         FROM people
         LEFT JOIN relationship_strengths ON relationship_strengths.person_id = people.id
         WHERE people.is_self = 0 AND people.archived_at IS NULL
           AND people.next_reconnect_at IS NOT NULL
           AND people.next_reconnect_at <= strftime('%Y-%m-%dT%H:%M:%fZ','now')
         ORDER BY people.next_reconnect_at ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(json!({
            "id": row.get::<_, String>(0)?,
            "fullName": row.get::<_, String>(1)?,
            "relationshipStrength": row.get::<_, Option<i64>>(2)?,
            "lastInteractionAt": row.get::<_, Option<String>>(3)?,
            "nextReconnectAt": row.get::<_, Option<String>>(4)?,
        }))
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(CliError::from)
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
    let (mut overdue, mut due_today, mut soon, mut open) = (vec![], vec![], vec![], vec![]);
    for task in &tasks {
        let bucket = bucket_for(task, &today, &cutoff);
        let value = task_json(task, bucket);
        match bucket {
            "overdue" => overdue.push(value),
            "today" => due_today.push(value),
            "soon" => soon.push(value),
            _ => open.push(value),
        }
    }
    let reconnect = reconnect_suggestions(conn)?;
    Ok(json!({
        "date": today,
        "tasks": { "overdue": overdue, "today": due_today, "soon": soon, "open": open },
        "recentInteractions": recent_interactions(conn, 5)?,
        "reconnect": reconnect,
        "counts": {
            "openTasks": tasks.len(),
            "overdueTasks": overdue.len(),
            "dueToday": due_today.len(),
            "reconnectDue": reconnect.len(),
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
        .map(|t| task_json(t, bucket_for(t, &today, &cutoff)))
        .collect();
    emit(json, &json!({ "tasks": plan }))
}

pub fn followups(conn: &Connection, json: bool) -> Result<(), CliError> {
    let reconnect = reconnect_suggestions(conn)?;
    emit(json, &json!({ "followups": reconnect }))
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

/// Emit a brief either as JSON (stdout data) or a compact human summary.
fn emit(json: bool, value: &Value) -> Result<(), CliError> {
    if json {
        return print_json(value);
    }
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}
