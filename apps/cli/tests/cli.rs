//! Integration tests for the `brain` CLI against a temporary SQLite database.
//! They run the real built binary (`CARGO_BIN_EXE_brain`), assert the stable
//! JSON contracts, and verify stdout/stderr separation. No model key is needed:
//! `ask` is exercised in its degraded (evidence-only) mode.

use std::path::Path;
use std::process::{Command, Output};

use brain_schema::LATEST_SCHEMA_VERSION;
use rusqlite::Connection;
use serde_json::Value;
use tempfile::TempDir;

const BIN: &str = env!("CARGO_BIN_EXE_brain");

fn run(db: &Path, args: &[&str]) -> Output {
    Command::new(BIN)
        .arg("--db")
        .arg(db)
        .args(args)
        .env_remove("BRAIN_DB")
        .env_remove("BRAIN_ROOT")
        .env_remove("ANTHROPIC_API_KEY")
        .output()
        .expect("failed to run brain")
}

fn run_with_brain(root: &Path, args: &[&str]) -> Output {
    Command::new(BIN)
        .arg("--brain")
        .arg(root)
        .args(args)
        .env_remove("BRAIN_DB")
        .env_remove("BRAIN_ROOT")
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

fn run_brain_json(root: &Path, args: &[&str]) -> Value {
    let out = run_with_brain(root, args);
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
    assert_eq!(status["schemaVersion"], LATEST_SCHEMA_VERSION);
}

#[test]
fn brain_flag_derives_standard_folder_layout() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("Work");
    let status = run_brain_json(&root, &["--json", "status"]);
    let canonical = root.canonicalize().unwrap();
    assert_eq!(status["brainRoot"], canonical.display().to_string());
    assert_eq!(
        status["dbPath"],
        canonical.join("brain.sqlite").display().to_string()
    );
    assert_eq!(
        status["assetsPath"],
        canonical.join("assets").display().to_string()
    );
    assert!(root.join("brain.sqlite").is_file());
    assert!(root.join("assets").is_dir());
    assert!(root.join(".local-brain").join("meta.json").is_file());
}

#[test]
fn brain_root_env_derives_standard_folder_layout() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("EnvBrain");
    let out = Command::new(BIN)
        .args(["--json", "path"])
        .env_remove("BRAIN_DB")
        .env("BRAIN_ROOT", &root)
        .env_remove("ANTHROPIC_API_KEY")
        .output()
        .expect("failed to run brain");
    assert!(
        out.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let value: Value = serde_json::from_slice(&out.stdout).unwrap();
    let canonical = root.canonicalize().unwrap();
    assert_eq!(
        value["dbPath"],
        canonical.join("brain.sqlite").display().to_string()
    );
    assert_eq!(
        value["assetsPath"],
        canonical.join("assets").display().to_string()
    );
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
fn add_person_dedupes_and_returns_contact_fields() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Maya Chen",
            "--preferred-name",
            "Maya",
            "--email",
            "MAYA@EXAMPLE.COM",
            "--phone",
            "+1 555 0100",
            "--headline",
            "Designer",
            "--location",
            "Austin",
            "--notes",
            "Imported from a contact export.",
            "--reconnect-interval-days",
            "30",
        ],
    );
    assert_eq!(first["kind"], "person");
    assert_eq!(first["isDuplicate"], false);

    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Maya Chen",
            "--email",
            "maya@example.com",
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]);

    let by_name = run_json(
        &db,
        &["--json", "add", "person", "--full-name", "Maya   Chen"],
    );
    assert_eq!(by_name["isDuplicate"], true);
    assert_eq!(by_name["id"], first["id"]);

    let search = run_json(&db, &["--json", "search", "Maya"]);
    assert!(search["results"]
        .as_array()
        .unwrap()
        .iter()
        .any(|h| h["kind"] == "person" && h["title"] == "Maya Chen"));

    let id = first["id"].as_str().unwrap();
    let shown = run_json(&db, &["--json", "show", "person", id]);
    assert_eq!(shown["title"], "Maya Chen");
    assert_eq!(shown["preferredName"], "Maya");
    assert_eq!(shown["primaryEmail"], "maya@example.com");
    assert_eq!(shown["primaryPhone"], "+1 555 0100");
    assert_eq!(shown["subtitle"], "Designer");
    assert_eq!(shown["location"], "Austin");
    assert_eq!(shown["reconnectIntervalDays"], 30);
    assert_eq!(shown["relationshipStrength"], Value::Null);
}

#[test]
fn add_asset_copies_file_and_links_to_interaction() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("AssetsBrain");
    let source = dir.path().join("invoice.txt");
    std::fs::write(&source, "attachment bytes").unwrap();

    let interaction = run_brain_json(
        &root,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Email with attachment",
            "--text",
            "Plain text email body.",
        ],
    );
    let interaction_id = interaction["id"].as_str().unwrap();
    let link = format!("interaction:{interaction_id}");
    let asset = run_brain_json(
        &root,
        &[
            "--json",
            "add",
            "asset",
            "--file",
            source.to_str().unwrap(),
            "--kind",
            "attachment",
            "--mime-type",
            "text/plain",
            "--link",
            &link,
        ],
    );
    assert_eq!(asset["kind"], "asset");
    assert_eq!(asset["isDuplicate"], false);
    assert_eq!(asset["linkCount"], 1);

    let conn = Connection::open(root.join("brain.sqlite")).unwrap();
    let storage_path: String = conn
        .query_row(
            "SELECT storage_path FROM assets WHERE id = ?1",
            [asset["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert!(root.join(&storage_path).is_file());
    let linked: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM asset_links WHERE asset_id = ?1 AND record_type = 'interaction' AND record_id = ?2",
            (asset["id"].as_str().unwrap(), interaction_id),
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(linked, 1);

    let duplicate = run_brain_json(
        &root,
        &[
            "--json",
            "add",
            "asset",
            "--file",
            source.to_str().unwrap(),
            "--link",
            &link,
        ],
    );
    assert_eq!(duplicate["isDuplicate"], true);
    assert_eq!(duplicate["id"], asset["id"]);
    assert_eq!(duplicate["linkCount"], 0);

    std::fs::remove_file(root.join(&storage_path)).unwrap();
    let restored = run_brain_json(
        &root,
        &[
            "--json",
            "add",
            "asset",
            "--file",
            source.to_str().unwrap(),
            "--link",
            &link,
        ],
    );
    assert_eq!(restored["isDuplicate"], true);
    assert_eq!(restored["id"], asset["id"]);
    assert!(root.join(&storage_path).is_file());

    conn.execute(
        "UPDATE assets SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        [asset["id"].as_str().unwrap()],
    )
    .unwrap();
    let reimported = run_brain_json(
        &root,
        &[
            "--json",
            "add",
            "asset",
            "--file",
            source.to_str().unwrap(),
            "--link",
            &link,
        ],
    );
    assert_eq!(reimported["isDuplicate"], false);
    assert_ne!(reimported["id"], asset["id"]);
    let reimported_storage_path: String = conn
        .query_row(
            "SELECT storage_path FROM assets WHERE id = ?1",
            [reimported["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_ne!(reimported_storage_path, storage_path);
    assert!(root.join(reimported_storage_path).is_file());
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
