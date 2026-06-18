//! Integration tests for the `brain` CLI against a temporary SQLite database.
//! They run the real built binary (`CARGO_BIN_EXE_brain`), assert the stable
//! JSON contracts, and verify stdout/stderr separation. No model key is needed:
//! `ask` is exercised in its degraded (evidence-only) mode.

use std::path::Path;
use std::process::{Command, Output};

use serde_json::Value;
use tempfile::TempDir;

const BIN: &str = env!("CARGO_BIN_EXE_brain");

fn run(db: &Path, args: &[&str]) -> Output {
    Command::new(BIN)
        .arg("--db")
        .arg(db)
        .args(args)
        .env_remove("BRAIN_DB")
        .env_remove("ANTHROPIC_API_KEY")
        .output()
        .expect("failed to run brain")
}

fn run_json(db: &Path, args: &[&str]) -> Value {
    let out = run(db, args);
    assert!(
        out.status.success(),
        "command {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    serde_json::from_slice(&out.stdout).unwrap_or_else(|e| {
        panic!(
            "stdout for {args:?} was not JSON ({e}): {}",
            String::from_utf8_lossy(&out.stdout)
        )
    })
}

fn db_path(dir: &TempDir) -> std::path::PathBuf {
    dir.path().join("brain.sqlite")
}

#[test]
fn status_reports_schema_version() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let status = run_json(&db, &["--json", "status"]);
    assert_eq!(status["schemaVersion"], 2);
}

#[test]
fn add_dedupes_identical_content() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "document",
            "--title",
            "Note",
            "--text",
            "hello world",
        ],
    );
    assert_eq!(first["isDuplicate"], false);
    assert_eq!(first["chunkCount"], 1);

    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "document",
            "--title",
            "Note",
            "--text",
            "hello world",
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]); // points back at the original
}

#[test]
fn search_finds_added_records_by_full_text() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Kickoff",
            "--text",
            "We discussed the Northwind partnership proposal.",
        ],
    );
    let results = run_json(&db, &["--json", "search", "partnership"]);
    let hits = results["results"].as_array().unwrap();
    assert!(hits
        .iter()
        .any(|h| h["kind"] == "interaction" && h["title"] == "Kickoff"));
}

#[test]
fn ask_degrades_to_cited_evidence_without_a_model() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    run_json(
        &db,
        &[
            "--json",
            "add",
            "document",
            "--title",
            "Doc",
            "--text",
            "The partnership covers go-to-market.",
        ],
    );
    let answer = run_json(&db, &["--json", "ask", "what is the partnership about?"]);
    assert_eq!(answer["answered"], false);
    let citations = answer["citations"].as_array().unwrap();
    assert!(!citations.is_empty());
    assert!(citations[0]["recordType"].is_string());
    assert!(citations[0]["quote"].is_string());
}

#[test]
fn plan_day_buckets_overdue_first() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    run_json(
        &db,
        &[
            "--json",
            "add",
            "task",
            "--title",
            "Overdue",
            "--due-at",
            "2000-01-01",
        ],
    );
    let plan = run_json(&db, &["--json", "tasks", "plan-day"]);
    let tasks = plan["tasks"].as_array().unwrap();
    assert_eq!(tasks[0]["bucket"], "overdue");
    assert_eq!(tasks[0]["title"], "Overdue");
}

#[test]
fn show_task_returns_camelcase_fields() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let task = run_json(&db, &["--json", "add", "task", "--title", "Ship it"]);
    let id = task["id"].as_str().unwrap();
    let shown = run_json(&db, &["--json", "show", "task", id]);
    assert_eq!(shown["title"], "Ship it");
    assert_eq!(shown["id"], id);
}

#[test]
fn today_and_changes_emit_valid_json() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    run_json(&db, &["--json", "add", "task", "--title", "A task"]);
    let today = run_json(&db, &["--json", "today"]);
    assert!(today["counts"]["openTasks"].as_i64().unwrap() >= 1);
    let changes = run_json(
        &db,
        &["--json", "changes", "--since", "2000-01-01T00:00:00Z"],
    );
    assert!(changes["changes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|c| c["title"] == "A task"));
}

#[test]
fn graph_is_centered_and_typed() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    run_json(&db, &["--json", "add", "task", "--title", "T"]);
    let graph = run_json(&db, &["--json", "graph", "--center", "self"]);
    assert!(graph["nodes"].is_array());
    assert!(graph["edges"].is_array());
    assert!(graph.get("truncatedKinds").is_some());
}

#[test]
fn stdout_is_data_only_stderr_carries_diagnostics() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    // Non-JSON status: the schema line is data (stdout); the path is a diagnostic (stderr).
    let out = run(&db, &["status"]);
    assert!(out.status.success());
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(stdout.contains("ok schema"), "stdout: {stdout}");
    assert!(
        !stdout.contains("database:"),
        "diagnostics leaked to stdout: {stdout}"
    );
    assert!(stderr.contains("database:"), "stderr: {stderr}");
}

#[test]
fn read_commands_fail_clearly_with_no_database() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir); // never created
    let out = run(&db, &["--json", "search", "anything"]);
    assert!(!out.status.success());
    assert_eq!(out.status.code(), Some(4)); // NoDatabase exit code
    assert!(String::from_utf8_lossy(&out.stderr).contains("no brain database"));
}
