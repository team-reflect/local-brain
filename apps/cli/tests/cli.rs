//! Integration tests for the `brain` CLI against a temporary SQLite database.
//! They run the real built binary (`CARGO_BIN_EXE_brain`), assert the stable
//! JSON contracts, and verify stdout/stderr separation.

use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};

use brain_schema::LATEST_SCHEMA_VERSION;
use rusqlite::Connection;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tempfile::TempDir;

const BIN: &str = env!("CARGO_BIN_EXE_brain");

fn run(db: &Path, args: &[&str]) -> Output {
    Command::new(BIN)
        .arg("--db")
        .arg(db)
        .args(args)
        .env_remove("BRAIN_DB")
        .env_remove("BRAIN_ROOT")
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
        .output()
        .expect("failed to run brain")
}

fn run_with_brain_stdin(root: &Path, args: &[&str], stdin: &str) -> Output {
    let mut child = Command::new(BIN)
        .arg("--brain")
        .arg(root)
        .args(args)
        .env_remove("BRAIN_DB")
        .env_remove("BRAIN_ROOT")
        .env_remove("ANTHROPIC_API_KEY")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to run brain");
    child
        .stdin
        .as_mut()
        .unwrap()
        .write_all(stdin.as_bytes())
        .expect("failed to write stdin");
    child.wait_with_output().expect("failed to wait for brain")
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

fn run_brain_json_stdin(root: &Path, args: &[&str], stdin: &str) -> Value {
    let out = run_with_brain_stdin(root, args, stdin);
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

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
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
fn cli_without_target_fails_instead_of_using_app_data_fallback() {
    let out = Command::new(BIN)
        .args(["--json", "path"])
        .env_remove("BRAIN_DB")
        .env_remove("BRAIN_ROOT")
        .output()
        .expect("failed to run brain");
    assert!(!out.status.success());
    assert_eq!(out.status.code(), Some(4));
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("no brain selected"),
        "stderr should explain the missing target: {stderr}"
    );
}

#[test]
fn contract_reports_agent_cli_contract() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let contract = run_json(&db, &["--json", "contract"]);
    assert_eq!(contract["name"], "brain");
    assert_eq!(contract["output"]["stdout"], "data only");
    assert_eq!(
        contract["commands"]["addInteraction"]["calendarMapping"]["end"],
        "--ended-at"
    );
    assert_eq!(
        contract["commands"]["addInteraction"]["calendarMapping"]["selfAttendees"],
        "--self-participant"
    );
    assert!(contract["commands"]["addInteraction"]["usage"]
        .as_str()
        .unwrap()
        .contains("[--text <text>|--text-file <path|->]"));
    assert!(contract["commands"]["addInteraction"]["usage"]
        .as_str()
        .unwrap()
        .contains("[--metadata-json <json>|--metadata-json-file <path|->]"));
    assert!(contract["commands"]["addInteraction"]["usage"]
        .as_str()
        .unwrap()
        .contains("[--event-json <json>|--event-json-file <path|->]"));
    assert_eq!(
        contract["commands"]["addInteraction"]["eventJson"]["validOnlyWith"],
        "--kind event"
    );
    assert_eq!(
        contract["commands"]["addInteraction"]["calendarMapping"]["rawProviderPayload"],
        "--metadata-json or --metadata-json-file"
    );
    assert!(contract["commands"]["addProject"]["usage"]
        .as_str()
        .unwrap()
        .contains("brain --json add project"));
    assert!(contract["commands"]["addProject"]["purpose"]
        .as_str()
        .unwrap()
        .contains("user sign-off"));
    assert!(contract["commands"]["suggest"]["purpose"]
        .as_str()
        .unwrap()
        .contains("not-yet-approved"));
    assert!(contract["writeRules"]
        .as_array()
        .unwrap()
        .iter()
        .any(|rule| rule
            .as_str()
            .unwrap()
            .contains("typed fields over burying structure")));
    assert!(contract["writeRules"]
        .as_array()
        .unwrap()
        .iter()
        .any(|rule| rule.as_str().unwrap().contains("explicit user sign-off")));
    assert!(contract["writeRules"]
        .as_array()
        .unwrap()
        .iter()
        .any(|rule| rule
            .as_str()
            .unwrap()
            .contains("do not redact imported body text")));
}

#[test]
fn json_errors_are_machine_readable_on_stderr() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let out = run(&db, &["--json", "add", "interaction", "--text", "   "]);
    assert!(!out.status.success());
    assert!(out.stdout.is_empty(), "errors must not write to stdout");
    let error: Value = serde_json::from_slice(&out.stderr).unwrap_or_else(|e| {
        panic!(
            "stderr was not JSON ({e}): {}",
            String::from_utf8_lossy(&out.stderr)
        )
    });
    assert_eq!(error["ok"], false);
    assert_eq!(error["error"]["kind"], "runtime");
    assert_eq!(error["error"]["exitCode"], 1);
    assert!(error["error"]["message"]
        .as_str()
        .unwrap()
        .contains("title or body"));
}

#[test]
fn event_json_is_only_valid_for_event_interactions() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let out = run(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Not an event",
            "--text",
            "Full readable source.",
            "--event-json",
            r#"{"details":{"subtype":"generic"}}"#,
        ],
    );
    assert!(!out.status.success());
    assert!(out.stdout.is_empty(), "errors must not write to stdout");
    assert!(String::from_utf8_lossy(&out.stderr).contains("--event-json requires --kind event"));
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
    assert_eq!(second["chunkCount"], 1);
}

#[test]
fn add_document_rejects_empty_title_and_body() {
    // Parity with the core `validateNewDocument`: a record with neither a title
    // nor body text is unreadable/unsearchable and is rejected before insert.
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let out = run(
        &db,
        &[
            "--json", "add", "document", "--title", "   ", "--text", "   ",
        ],
    );
    assert!(!out.status.success());
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty(), "errors must not write to stdout");
    assert!(String::from_utf8_lossy(&out.stderr).contains("title or body"));

    let conn = Connection::open(&db).unwrap();
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM documents", [], |row| row.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn add_interaction_rejects_empty_title_and_body() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let out = run(&db, &["--json", "add", "interaction", "--text", "   "]);
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("title or body"));
}

#[test]
fn add_document_squishes_internal_title_whitespace() {
    // Parity with the core `squish`: internal whitespace runs collapse to single
    // spaces (not just trimmed ends) so the CLI and app store titles identically.
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let added = run_json(
        &db,
        &[
            "--json",
            "add",
            "document",
            "--title",
            "  Field   note\tdraft ",
            "--text",
            "body",
        ],
    );
    let conn = Connection::open(&db).unwrap();
    let title: String = conn
        .query_row(
            "SELECT title FROM documents WHERE id = ?1",
            [added["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(title, "Field note draft");
}

#[test]
fn add_interaction_squishes_internal_title_whitespace() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let added = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--title",
            "  Sync   up ",
            "--text",
            "we talked",
        ],
    );
    let conn = Connection::open(&db).unwrap();
    let title: String = conn
        .query_row(
            "SELECT title FROM interactions WHERE id = ?1",
            [added["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(title, "Sync up");
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

    let same_name_other_email = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Maya Chen",
            "--email",
            "other-maya@example.com",
        ],
    );
    assert_eq!(same_name_other_email["isDuplicate"], false);
    assert_ne!(same_name_other_email["id"], first["id"]);

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
    assert_eq!(shown["primaryEmail"], "MAYA@EXAMPLE.COM");
    assert_eq!(shown["primaryPhone"], "+1 555 0100");
    assert_eq!(shown["subtitle"], "Designer");
    assert_eq!(shown["location"], "Austin");
    assert_eq!(shown["relationshipStrength"], Value::Null);

    let sparse = run_json(
        &db,
        &["--json", "add", "person", "--full-name", "Jordan Lee"],
    );
    let enriched = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Jordan   Lee",
            "--email",
            "JORDAN@EXAMPLE.COM",
            "--phone",
            "+1 555 0200",
            "--headline",
            "Investor",
            "--location",
            "New York",
            "--summary",
            "Met through a contact export.",
            "--notes",
            "Prefers concise updates.",
        ],
    );
    assert_eq!(enriched["isDuplicate"], true);
    assert_eq!(enriched["id"], sparse["id"]);
    let enriched_id = sparse["id"].as_str().unwrap();
    let enriched_shown = run_json(&db, &["--json", "show", "person", enriched_id]);
    assert_eq!(enriched_shown["primaryEmail"], "JORDAN@EXAMPLE.COM");
    assert_eq!(enriched_shown["primaryPhone"], "+1 555 0200");
    assert_eq!(enriched_shown["subtitle"], "Investor");
    assert_eq!(enriched_shown["location"], "New York");
    assert_eq!(enriched_shown["summary"], "Met through a contact export.");
    assert_eq!(enriched_shown["notes"], "Prefers concise updates.");

    let ascii_name = run_json(
        &db,
        &["--json", "add", "person", "--full-name", "Renee Muller"],
    );
    let accented_name = run_json(
        &db,
        &["--json", "add", "person", "--full-name", "Renée Müller"],
    );
    assert_eq!(accented_name["isDuplicate"], true);
    assert_eq!(accented_name["id"], ascii_name["id"]);
}

#[test]
fn source_ensure_is_idempotent() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "source",
            "ensure",
            "--slug",
            "newsletter",
            "--name",
            "Newsletter",
        ],
    );
    assert_eq!(first["kind"], "source");
    assert_eq!(first["slug"], "newsletter");
    assert_eq!(first["created"], true);

    let second = run_json(
        &db,
        &[
            "--json",
            "source",
            "ensure",
            "--slug",
            "newsletter",
            "--name",
            "Newsletter Import",
        ],
    );
    assert_eq!(second["created"], false);
    assert_eq!(second["id"], first["id"]);
}

#[test]
fn add_project_dedupes_by_source_identity_and_name() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    run_json(
        &db,
        &[
            "--json", "source", "ensure", "--slug", "gmail", "--name", "Gmail",
        ],
    );

    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "project",
            "--name",
            "Everlywell Integration",
            "--summary",
            "PWN Labs Module go-live context.",
            "--source",
            "gmail",
            "--external-kind",
            "thread-cluster",
            "--external-id",
            "everlywell-integration",
        ],
    );
    assert_eq!(first["kind"], "project");
    assert_eq!(first["isDuplicate"], false);

    let by_identity = run_json(
        &db,
        &[
            "--json",
            "add",
            "project",
            "--name",
            "Different Name",
            "--source",
            "gmail",
            "--external-kind",
            "thread-cluster",
            "--external-id",
            "everlywell-integration",
        ],
    );
    assert_eq!(by_identity["isDuplicate"], true);
    assert_eq!(by_identity["id"], first["id"]);

    let by_name = run_json(
        &db,
        &[
            "--json",
            "add",
            "project",
            "--name",
            " Everlywell   Integration ",
        ],
    );
    assert_eq!(by_name["isDuplicate"], true);
    assert_eq!(by_name["id"], first["id"]);
}

#[test]
fn add_project_links_task_through_task_project_id() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let task = run_json(
        &db,
        &["--json", "add", "task", "--title", "Draft launch brief"],
    );
    let task_link = format!("task:{}", task["id"].as_str().unwrap());

    let project = run_json(
        &db,
        &[
            "--json", "add", "project", "--name", "Apollo", "--link", &task_link,
        ],
    );

    let conn = Connection::open(&db).unwrap();
    let project_id: String = conn
        .query_row(
            "SELECT project_id FROM tasks WHERE id = ?1",
            [task["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(project_id, project["id"].as_str().unwrap());
}

#[test]
fn add_interaction_keeps_message_and_thread_external_ids_separate() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    run_json(
        &db,
        &[
            "--json", "source", "ensure", "--slug", "gmail", "--name", "Gmail",
        ],
    );

    let message = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Message import",
            "--summary",
            "Message-level summary.",
            "--text",
            "Message-level body.",
            "--source",
            "gmail",
            "--external-kind",
            "message",
            "--external-id",
            "abc123",
        ],
    );
    let thread = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Thread import",
            "--summary",
            "Thread-level summary.",
            "--text",
            "Thread-level body.",
            "--source",
            "gmail",
            "--external-kind",
            "thread",
            "--external-id",
            "abc123",
        ],
    );
    assert_ne!(message["id"], thread["id"]);
    let record = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Legacy record import",
            "--summary",
            "Record-level summary.",
            "--text",
            "Message-level body.",
            "--source",
            "gmail",
            "--external-id",
            "abc123",
        ],
    );
    assert_ne!(record["id"], message["id"]);
    assert_ne!(record["id"], thread["id"]);

    let conn = Connection::open(&db).unwrap();
    let summary: String = conn
        .query_row(
            "SELECT summary FROM interactions WHERE id = ?1",
            [thread["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(summary, "Thread-level summary.");
}

#[test]
fn add_person_stores_handles_and_external_identity() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Robin Spencer",
            "--email",
            "Robin@Example.com",
            "--email",
            "r.spencer@example.com",
            "--phone",
            "+1 555 0101",
            "--phone",
            "(555) 0102",
            "--source",
            "google_people",
            "--external-id",
            "people/c123",
            "--original-url",
            "https://contacts.google.com/person/c123",
        ],
    );
    assert_eq!(first["isDuplicate"], false);

    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Someone Else",
            "--email",
            "robin@example.com",
            "--source",
            "google_people",
            "--external-id",
            "people/c123",
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]);

    let conn = Connection::open(&db).unwrap();
    let email_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM person_emails WHERE person_id = ?1",
            [first["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    let phone_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM person_phones WHERE person_id = ?1",
            [first["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    let external_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM external_identities WHERE entity_type = 'person' AND entity_id = ?1",
            [first["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(email_count, 2);
    assert_eq!(phone_count, 2);
    assert_eq!(external_count, 1);
}

#[test]
fn add_person_external_id_reimport_skips_archived_record() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Robin Spencer",
            "--email",
            "robin@example.com",
            "--source",
            "google_people",
            "--external-id",
            "people/c9",
        ],
    );
    assert_eq!(first["isDuplicate"], false);

    // Archive the imported person, then re-import with the same source/external
    // id. The archived record must not be revived as an active duplicate.
    let conn = Connection::open(&db).unwrap();
    conn.execute(
        "UPDATE people SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1",
        [first["id"].as_str().unwrap()],
    )
    .unwrap();
    drop(conn);

    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Robin Spencer",
            "--email",
            "robin@example.com",
            "--source",
            "google_people",
            "--external-id",
            "people/c9",
        ],
    );
    assert_eq!(second["isDuplicate"], false);
    assert_ne!(second["id"], first["id"]);

    let conn = Connection::open(&db).unwrap();
    let active: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM people WHERE full_name = 'Robin Spencer' AND archived_at IS NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    let archived: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM people WHERE full_name = 'Robin Spencer' AND archived_at IS NOT NULL",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(active, 1);
    assert_eq!(archived, 1);
}

#[test]
fn add_person_from_email_creates_humans_and_skips_machine_senders() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let created = run_json(
        &db,
        &[
            "--json",
            "add",
            "person-from-email",
            "--full-name",
            "Spencer, Robin",
            "--email",
            "Robin@Example.com",
            "--source",
            "gmail",
            "--external-id",
            "msg-1",
        ],
    );
    assert_eq!(created["created"], true);
    assert_eq!(created["normalizedName"], "Robin Spencer");
    assert!(created["reasonCodes"].as_array().unwrap().is_empty());

    let duplicate = run_json(
        &db,
        &[
            "--json",
            "add",
            "person-from-email",
            "--full-name",
            "Robin Spencer",
            "--email",
            "robin@example.com",
            "--source",
            "gmail",
            "--external-id",
            "msg-1",
        ],
    );
    assert_eq!(duplicate["created"], false);
    assert_eq!(duplicate["isDuplicate"], true);
    assert_eq!(duplicate["id"], created["id"]);

    let skipped = run_json(
        &db,
        &[
            "--json",
            "add",
            "person-from-email",
            "--full-name",
            "GitHub Notifications",
            "--email",
            "notifications@example.com",
            "--source",
            "gmail",
            "--external-id",
            "msg-2",
        ],
    );
    assert_eq!(skipped["created"], false);
    assert_eq!(skipped["id"], Value::Null);
    assert!(skipped["reasonCodes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|code| code == "machine_email"));
}

#[test]
fn add_interaction_dedupes_by_source_and_preserves_raw_participants() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Hello",
            "--text",
            "Plain text email body.",
            "--source",
            "gmail",
            "--external-id",
            "gmail-msg-1",
            "--participant",
            "from:Robin Spencer <robin@example.com>",
        ],
    );
    assert_eq!(first["isDuplicate"], false);

    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Hello again",
            "--text",
            "Different body from the same upstream message.",
            "--source",
            "gmail",
            "--external-id",
            "gmail-msg-1",
            "--participant",
            "from:Robin Spencer <robin@example.com>",
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]);

    let conn = Connection::open(&db).unwrap();
    let row: (Option<String>, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT person_id, handle, display_name
             FROM interaction_participants
             WHERE interaction_id = ?1 AND role = 'from'",
            [first["id"].as_str().unwrap()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(row.0, None);
    assert_eq!(row.1.as_deref(), Some("robin@example.com"));
    assert_eq!(row.2.as_deref(), Some("Robin Spencer"));
}

#[test]
fn add_interaction_replace_body_updates_source_backed_record_and_chunks() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    run_json(
        &db,
        &[
            "--json", "source", "ensure", "--slug", "granola", "--name", "Granola",
        ],
    );
    let old_body = "old transcript marker ".repeat(90);
    let new_body = "raw transcript replacement from Granola";

    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Granola meeting",
            "--text",
            old_body.as_str(),
            "--source",
            "granola",
            "--external-id",
            "meeting-1",
        ],
    );
    assert_eq!(first["isDuplicate"], false);
    assert!(
        first["chunkCount"].as_i64().unwrap() > 1,
        "test setup needs multiple chunks so stale chunk rows are visible"
    );
    let interaction_link = format!("interaction:{}", first["id"].as_str().unwrap());
    let interaction_evidence = format!("{interaction_link}#0");
    let task = run_json(
        &db,
        &[
            "--json",
            "add",
            "task",
            "--title",
            "Transcript follow-up",
            "--link",
            &interaction_link,
            "--evidence",
            &interaction_evidence,
        ],
    );

    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Granola meeting",
            "--text",
            new_body,
            "--summary",
            "Compact AI summary.",
            "--source",
            "granola",
            "--external-id",
            "meeting-1",
            "--replace-body",
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]);
    assert_eq!(second["chunkCount"], 1);

    let conn = Connection::open(&db).unwrap();
    let (body, summary): (String, String) = conn
        .query_row(
            "SELECT body_text, summary FROM interactions WHERE id = ?1",
            [first["id"].as_str().unwrap()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(body, new_body);
    assert_eq!(summary, "Compact AI summary.");

    let stale_chunks: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM content_chunks
             WHERE record_type = 'interaction'
               AND record_id = ?1
               AND text LIKE '%old transcript marker%'",
            [first["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stale_chunks, 0);
    let fresh_chunks: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM content_chunks
             WHERE record_type = 'interaction'
               AND record_id = ?1
               AND text LIKE '%raw transcript replacement%'",
            [first["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(fresh_chunks, 1);
    let evidence_refs: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM evidence_refs er
             JOIN content_chunks cc ON cc.id = er.chunk_id
             WHERE er.subject_type = 'task'
               AND er.subject_id = ?1
               AND cc.record_type = 'interaction'
               AND cc.record_id = ?2
               AND cc.chunk_index = 0",
            (task["id"].as_str().unwrap(), first["id"].as_str().unwrap()),
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(evidence_refs, 1);
}

#[test]
fn add_interaction_stores_calendar_fields_and_resolves_known_participants() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let alice = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Alice Wyatt",
            "--email",
            "alice@example.com",
        ],
    );
    let alice_id = alice["id"].as_str().unwrap();

    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Calendar: Stay at Louma",
            "--occurred-at",
            "2026-07-09",
            "--text",
            "Calendar: primary\nStatus: confirmed",
            "--source",
            "google_calendar",
            "--external-id",
            "calendar-event-1",
            "--participant",
            "organizer:Alice Wyatt <ALICE@example.com>",
            "--participant",
            "attendee:Visitor <visitor@example.com>",
        ],
    );
    assert_eq!(first["isDuplicate"], false);

    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Calendar: Stay at Louma",
            "--occurred-at",
            "2026-07-09",
            "--ended-at",
            "2026-07-12",
            "--location",
            "Louma Country Shepherd's Hut",
            "--text",
            "Calendar: primary\nStatus: confirmed\nEnd: 2026-07-12",
            "--source",
            "google_calendar",
            "--external-id",
            "calendar-event-1",
            "--original-url",
            "https://www.google.com/calendar/event?eid=calendar-event-1",
            "--participant",
            "organizer:Alice Wyatt <alice@example.com>",
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]);

    let conn = Connection::open(&db).unwrap();
    let (occurred_at, ended_at, location, original_url): (
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT occurred_at, ended_at, location, original_url
             FROM interactions
             WHERE id = ?1",
            [first["id"].as_str().unwrap()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(occurred_at.as_deref(), Some("2026-07-09"));
    assert_eq!(ended_at.as_deref(), Some("2026-07-12"));
    assert_eq!(location.as_deref(), Some("Louma Country Shepherd's Hut"));
    assert_eq!(
        original_url.as_deref(),
        Some("https://www.google.com/calendar/event?eid=calendar-event-1")
    );

    let linked_alice: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM interaction_participants
             WHERE interaction_id = ?1
               AND person_id = ?2
               AND normalized_handle = 'alice@example.com'",
            (first["id"].as_str().unwrap(), alice_id),
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(linked_alice, 1);

    let unresolved_visitor: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM interaction_participants
             WHERE interaction_id = ?1
               AND person_id IS NULL
               AND normalized_handle = 'visitor@example.com'",
            [first["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(unresolved_visitor, 1);
}

#[test]
fn import_interaction_writes_structured_event_payload_and_metadata() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let metadata_path = dir.path().join("gcal-payload.json");
    let event_path = dir.path().join("event-payload.json");
    std::fs::write(
        &metadata_path,
        r#"{"provider":"google_calendar","html":"Full readable booking source"}"#,
    )
    .unwrap();
    std::fs::write(
        &event_path,
        r#"{
          "details": {
            "subtype": "flight",
            "status": "confirmed",
            "startLocalAt": "2026-07-09T09:00:00",
            "startTimezone": "Europe/London",
            "endLocalAt": "2026-07-09T15:20:00",
            "endTimezone": "America/Chicago",
            "venueName": "London Heathrow",
            "address": "Heathrow Airport",
            "providerName": "Google Calendar",
            "providerRecordKind": "calendar_event",
            "sourceCompleteness": "complete"
          },
          "booking": {
            "bookingType": "flight",
            "confirmationReference": "ABC123",
            "bookingChannel": "British Airways",
            "providerName": "BA",
            "partyCount": 1,
            "guestCount": 1,
            "contact": {"email":"support@example.com"},
            "cost": {"currency":"USD","total":1200},
            "cancellationPolicy": {"summary":"fare rules apply"}
          },
          "lodgingStay": {
            "propertyName": "Four Seasons Montreal",
            "checkInLocalAt": "2026-07-09T16:00:00",
            "checkOutLocalAt": "2026-07-12T11:00:00",
            "nights": 3,
            "roomCount": 1,
            "rooms": [{"name":"Premier King"}],
            "guests": [{"name":"Alex"}],
            "benefits": {"breakfast":true},
            "policies": {"deposit":"one night"},
            "arrivalNotes": "Late arrival requested"
          },
          "flightSegments": [{
            "segmentIndex": 0,
            "carrierName": "British Airways",
            "carrierCode": "BA",
            "flightNumber": "191",
            "serviceClass": "business",
            "originCode": "LHR",
            "originName": "London Heathrow",
            "originTimezone": "Europe/London",
            "destinationCode": "AUS",
            "destinationName": "Austin",
            "destinationTimezone": "America/Chicago",
            "departureLocalAt": "2026-07-09T09:00:00",
            "arrivalLocalAt": "2026-07-09T15:20:00",
            "departureAt": "2026-07-09T08:00:00Z",
            "arrivalAt": "2026-07-09T20:20:00Z",
            "durationMinutes": 740,
            "confirmationReference": "ABC123",
            "ticketNumbers": ["1250000000001"],
            "passengers": [{"name":"Alex"}]
          }]
        }"#,
    )
    .unwrap();
    let metadata_file = metadata_path.to_str().unwrap();
    let event_file = event_path.to_str().unwrap();

    let imported = run_json(
        &db,
        &[
            "--json",
            "import",
            "interaction",
            "--kind",
            "event",
            "--title",
            "Calendar: Flight: London Heathrow, LHR to AUS",
            "--text",
            "Full readable source: BA confirmation ABC123, LHR to AUS, Four Seasons Montreal.",
            "--source",
            "google_calendar",
            "--external-kind",
            "event",
            "--external-id",
            "calendar-event-structured-1",
            "--metadata-json-file",
            metadata_file,
            "--event-json-file",
            event_file,
        ],
    );
    assert_eq!(imported["isDuplicate"], false);
    assert!(imported["chunkCount"].as_i64().unwrap() > 0);
    let id = imported["id"].as_str().unwrap();

    let conn = Connection::open(&db).unwrap();
    let (body_text, metadata_json): (String, String) = conn
        .query_row(
            "SELECT body_text, metadata_json FROM interactions WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert!(body_text.contains("Full readable source"));
    let metadata: Value = serde_json::from_str(&metadata_json).unwrap();
    assert_eq!(metadata["provider"], "google_calendar");
    assert_eq!(metadata["html"], "Full readable booking source");

    let (subtype, status, provider, completeness): (String, String, String, String) = conn
        .query_row(
            "SELECT subtype, status, provider_name, source_completeness
             FROM interaction_event_details
             WHERE interaction_id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(subtype, "flight");
    assert_eq!(status, "confirmed");
    assert_eq!(provider, "Google Calendar");
    assert_eq!(completeness, "complete");

    let (confirmation, guest_count, cost_json): (String, i64, String) = conn
        .query_row(
            "SELECT confirmation_reference, guest_count, cost_json
             FROM interaction_event_bookings
             WHERE interaction_id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(confirmation, "ABC123");
    assert_eq!(guest_count, 1);
    assert_eq!(
        serde_json::from_str::<Value>(&cost_json).unwrap()["total"],
        1200
    );

    let (property, nights, rooms_json): (String, i64, String) = conn
        .query_row(
            "SELECT property_name, nights, rooms_json
             FROM interaction_event_lodging_stays
             WHERE interaction_id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(property, "Four Seasons Montreal");
    assert_eq!(nights, 3);
    assert_eq!(
        serde_json::from_str::<Value>(&rooms_json).unwrap()[0]["name"],
        "Premier King"
    );

    let (origin, destination, flight_number): (String, String, String) = conn
        .query_row(
            "SELECT origin_code, destination_code, flight_number
             FROM interaction_event_flight_segments
             WHERE interaction_id = ?1 AND segment_index = 0",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(origin, "LHR");
    assert_eq!(destination, "AUS");
    assert_eq!(flight_number, "191");

    let update_event_json = r#"{
      "details": {
        "subtype": "flight",
        "status": "schedule_updated",
        "startLocalAt": "2026-07-09T10:00:00",
        "startTimezone": "Europe/London",
        "providerName": "Google Calendar",
        "sourceCompleteness": "complete"
      },
      "booking": {
        "bookingType": "flight",
        "confirmationReference": "UPDATED",
        "providerName": "BA"
      },
      "flightSegments": [
        {"carrierCode":"BA","flightNumber":"193","originCode":"LHR","destinationCode":"ORD"},
        {"carrierCode":"AA","flightNumber":"1234","originCode":"ORD","destinationCode":"AUS"}
      ]
    }"#;
    let reimported = run_json(
        &db,
        &[
            "--json",
            "import",
            "interaction",
            "--kind",
            "event",
            "--title",
            "Calendar: Flight: London Heathrow, LHR to AUS",
            "--text",
            "Full readable source after airline schedule change.",
            "--source",
            "google_calendar",
            "--external-kind",
            "event",
            "--external-id",
            "calendar-event-structured-1",
            "--refresh",
            "--metadata-json",
            r#"{"provider":"google_calendar","version":2}"#,
            "--event-json",
            update_event_json,
        ],
    );
    assert_eq!(reimported["isDuplicate"], true);
    assert_eq!(reimported["id"], id);

    let (detail_rows, updated_status, updated_confirmation, segment_count): (
        i64,
        String,
        String,
        i64,
    ) = conn
        .query_row(
            "SELECT
               (SELECT COUNT(*) FROM interaction_event_details WHERE interaction_id = ?1),
               (SELECT status FROM interaction_event_details WHERE interaction_id = ?1),
               (SELECT confirmation_reference FROM interaction_event_bookings WHERE interaction_id = ?1),
               (SELECT COUNT(*) FROM interaction_event_flight_segments WHERE interaction_id = ?1)",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(detail_rows, 1);
    assert_eq!(updated_status, "schedule_updated");
    assert_eq!(updated_confirmation, "UPDATED");
    assert_eq!(segment_count, 2);

    let updated_metadata: String = conn
        .query_row(
            "SELECT metadata_json FROM interactions WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&updated_metadata).unwrap()["version"],
        2
    );

    let lodging_rows: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM interaction_event_lodging_stays WHERE interaction_id = ?1",
            [id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(
        lodging_rows, 1,
        "unsupplied lodgingStay section should not be deleted on reimport"
    );
}

#[test]
fn granola_interaction_reports_post_analysis_requirement() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    run_json(
        &db,
        &[
            "--json", "source", "ensure", "--slug", "granola", "--name", "Granola",
        ],
    );

    let interaction = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Granola transcript",
            "--text",
            "Raw transcript body.",
            "--summary",
            "Short summary.",
            "--source",
            "granola",
            "--external-id",
            "meeting-analysis-1",
        ],
    );

    assert_eq!(interaction["postAnalysisRequired"], true);
    let checklist = interaction["postAnalysisChecklist"].as_array().unwrap();
    assert!(checklist.iter().any(|item| item == "people"));
    assert!(checklist.iter().any(|item| item == "followUpTasks"));
}

#[test]
fn add_interaction_stores_bodyless_calendar_event_as_incomplete_evidence() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "event",
            "--title",
            "Calendar: Hotel stay",
            "--occurred-at",
            "2026-07-09",
            "--ended-at",
            "2026-07-12",
            "--location",
            "Louma Country Shepherd's Hut",
            "--source",
            "google_calendar",
            "--external-id",
            "calendar-event-no-body",
        ],
    );
    assert_eq!(first["isDuplicate"], false);
    assert_eq!(first["chunkCount"], 0);

    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "event",
            "--title",
            "Calendar: Hotel stay",
            "--occurred-at",
            "2026-07-09",
            "--ended-at",
            "2026-07-12",
            "--location",
            "Louma Country Shepherd's Hut",
            "--source",
            "google_calendar",
            "--external-id",
            "calendar-event-no-body",
            "--original-url",
            "https://www.google.com/calendar/event?eid=calendar-event-no-body",
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]);

    let conn = Connection::open(&db).unwrap();
    let (body_text, content_hash, chunks, original_url): (
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT body_text,
                    content_hash,
                    (SELECT COUNT(*) FROM content_chunks WHERE record_type = 'interaction' AND record_id = interactions.id),
                    original_url
             FROM interactions
             WHERE id = ?1",
            [first["id"].as_str().unwrap()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(body_text, None);
    assert_eq!(content_hash, None);
    assert_eq!(chunks, 0);
    assert_eq!(
        original_url.as_deref(),
        Some("https://www.google.com/calendar/event?eid=calendar-event-no-body")
    );

    let event_ref = format!("interaction:{}", first["id"].as_str().unwrap());
    let finalized = run_json(
        &db,
        &["--json", "import", "finalize", "--record", &event_ref],
    );
    assert_eq!(finalized["complete"], false);
    let missing = finalized["missing"].as_array().unwrap();
    assert!(
        missing.iter().any(|item| item == "rawText"),
        "bodyless event imports must report missing rawText"
    );
    assert!(
        missing.iter().any(|item| item == "chunks"),
        "bodyless event imports must report missing chunks"
    );
}

#[test]
fn add_interaction_external_id_reimport_enriches_start_time() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "event",
            "--title",
            "Calendar: Needs start",
            "--source",
            "google_calendar",
            "--external-id",
            "calendar-event-start-later",
        ],
    );
    assert_eq!(first["isDuplicate"], false);

    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "event",
            "--title",
            "Calendar: Needs start",
            "--occurred-at",
            "2026-07-09",
            "--source",
            "google_calendar",
            "--external-id",
            "calendar-event-start-later",
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]);

    let conn = Connection::open(&db).unwrap();
    let occurred_at: String = conn
        .query_row(
            "SELECT occurred_at FROM interactions WHERE id = ?1",
            [first["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(occurred_at, "2026-07-09");
}

#[test]
fn add_interaction_replace_body_rejects_empty_body() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    run_json(
        &db,
        &[
            "--json", "source", "ensure", "--slug", "granola", "--name", "Granola",
        ],
    );

    let out = run(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Granola meeting",
            "--text",
            "   ",
            "--source",
            "granola",
            "--external-id",
            "meeting-1",
            "--replace-body",
        ],
    );
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("body text"));
}

#[test]
fn add_interaction_self_participant_links_self_and_dedupes_roles() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    run_json(&db, &["--json", "status"]);
    let conn = Connection::open(&db).unwrap();
    conn.execute(
        "INSERT INTO people (id, full_name, is_self) VALUES ('self-test', 'You', 1)",
        [],
    )
    .unwrap();
    drop(conn);

    let interaction = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Calendar: Self marked",
            "--source",
            "google_calendar",
            "--external-id",
            "calendar-self-1",
            "--self-participant",
            "organizer:You <alex@maccaw.org>",
            "--self-participant",
            "attendee:You <alex@maccaw.org>",
        ],
    );
    let id = interaction["id"].as_str().unwrap();

    let conn = Connection::open(&db).unwrap();
    let (rows, role, handle, normalized_handle, display_name, source_id): (
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
    ) = conn
        .query_row(
            "SELECT COUNT(*), role, handle, normalized_handle, display_name, source_id
             FROM interaction_participants
             WHERE interaction_id = ?1 AND person_id = ?2",
            (id, "self-test"),
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(rows, 1);
    assert_eq!(role.as_deref(), Some("organizer"));
    assert_eq!(handle.as_deref(), Some("alex@maccaw.org"));
    assert_eq!(normalized_handle.as_deref(), Some("alex@maccaw.org"));
    assert_eq!(display_name.as_deref(), Some("You"));
    assert_eq!(source_id.as_deref(), Some("source_google_calendar"));
}

#[test]
fn add_interaction_self_participant_requires_self_row() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    run_json(&db, &["--json", "status"]);
    let conn = Connection::open(&db).unwrap();
    conn.execute("DELETE FROM people WHERE is_self = 1", [])
        .unwrap();
    drop(conn);

    let out = run(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--title",
            "Calendar: No self",
            "--self-participant",
            "attendee:You <alex@example.com>",
        ],
    );
    assert!(!out.status.success());
    assert!(out.stdout.is_empty());
    let error: Value = serde_json::from_slice(&out.stderr).unwrap();
    assert_eq!(error["error"]["kind"], "runtime");
    assert!(error["error"]["message"]
        .as_str()
        .unwrap()
        .contains("--self-participant requires an active self person"));
}

#[test]
fn add_interaction_reimport_resolves_existing_raw_participant() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Calendar: Dinner",
            "--text",
            "Calendar body",
            "--source",
            "google_calendar",
            "--external-id",
            "calendar-event-2",
            "--participant",
            "attendee:Alice Wyatt <alice@example.com>",
        ],
    );

    let alice = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Alice Wyatt",
            "--email",
            "alice@example.com",
        ],
    );
    let alice_id = alice["id"].as_str().unwrap();

    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Calendar: Dinner",
            "--text",
            "Calendar body",
            "--source",
            "google_calendar",
            "--external-id",
            "calendar-event-2",
            "--participant",
            "attendee:Alice Wyatt <alice@example.com>",
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]);

    let conn = Connection::open(&db).unwrap();
    let (participant_rows, linked_rows): (i64, i64) = conn
        .query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN person_id = ?2 THEN 1 ELSE 0 END)
             FROM interaction_participants
             WHERE interaction_id = ?1
               AND normalized_handle = 'alice@example.com'",
            (first["id"].as_str().unwrap(), alice_id),
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(participant_rows, 1);
    assert_eq!(linked_rows, 1);
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

    std::fs::write(root.join(&storage_path), "truncated").unwrap();
    let repaired = run_brain_json(
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
    assert_eq!(repaired["isDuplicate"], true);
    assert_eq!(repaired["id"], asset["id"]);
    assert_eq!(
        std::fs::read_to_string(root.join(&storage_path)).unwrap(),
        "attachment bytes"
    );

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
fn asset_search_finds_filename_links_and_text() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("AssetSearchBrain");
    let source = dir.path().join("receipt.pdf");
    std::fs::write(&source, b"%PDF fake binary bytes").unwrap();

    let interaction = run_brain_json(
        &root,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Gmail receipt thread",
            "--text",
            "Plain text email body mentions the Northwind order.",
        ],
    );
    let link = format!("interaction:{}", interaction["id"].as_str().unwrap());
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
            "application/pdf",
            "--original-filename",
            "Receipt-2446-0056.pdf",
            "--caption",
            "signed invoice attachment",
            "--link",
            &link,
            "--text",
            "Extracted importer receipt total and vendor text",
            "--text-source",
            "importer",
        ],
    );

    let filename_results = run_brain_json(&root, &["--json", "search", "Receipt-2446-0056"]);
    assert!(filename_results["results"]
        .as_array()
        .unwrap()
        .iter()
        .any(|hit| {
            hit["kind"] == "asset"
                && hit["id"] == asset["id"]
                && hit["title"] == "Receipt-2446-0056.pdf"
        }));

    let text_results = run_brain_json(&root, &["--json", "search", "vendor"]);
    assert!(text_results["results"]
        .as_array()
        .unwrap()
        .iter()
        .any(|hit| hit["kind"] == "asset" && hit["id"] == asset["id"]));

    let interaction_results = run_brain_json(&root, &["--json", "search", "Northwind"]);
    assert!(interaction_results["results"]
        .as_array()
        .unwrap()
        .iter()
        .any(|hit| hit["kind"] == "interaction" && hit["id"] == interaction["id"]));

    run_brain_json_stdin(
        &root,
        &[
            "--json",
            "asset",
            "text",
            "set",
            asset["id"].as_str().unwrap(),
            "--text-file",
            "-",
            "--source",
            "manual",
        ],
        "Corrected searchable asset text with reimbursable keyword.",
    );
    let updated_results = run_brain_json(&root, &["--json", "search", "reimbursable"]);
    assert!(updated_results["results"]
        .as_array()
        .unwrap()
        .iter()
        .any(|hit| hit["kind"] == "asset" && hit["id"] == asset["id"]));

    let shown = run_brain_json(
        &root,
        &["--json", "show", "asset", asset["id"].as_str().unwrap()],
    );
    assert_eq!(shown["title"], "Receipt-2446-0056.pdf");
    assert_eq!(shown["textSource"], "manual");
    assert_eq!(shown["linkedRecords"][0]["kind"], "interaction");
}

#[test]
fn add_asset_rolls_back_manifest_when_file_write_fails() {
    let dir = TempDir::new().unwrap();
    let root = dir.path().join("BrokenAssetsBrain");
    let source = dir.path().join("blocked.txt");
    let bytes = b"blocked bytes";
    std::fs::write(&source, bytes).unwrap();

    run_brain_json(&root, &["--json", "status"]);
    let hash = sha256_hex(bytes);
    let prefix = &hash[0..2];
    let blocked_prefix = root.join("assets").join("objects").join(prefix);
    std::fs::create_dir_all(blocked_prefix.parent().unwrap()).unwrap();
    std::fs::write(&blocked_prefix, "not a directory").unwrap();

    let out = run_with_brain(
        &root,
        &["--json", "add", "asset", "--file", source.to_str().unwrap()],
    );
    assert!(!out.status.success());

    let conn = Connection::open(root.join("brain.sqlite")).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM assets WHERE content_hash = ?1",
            [&hash],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn add_interaction_dedupes_by_external_id_and_enriches_provenance() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let person = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Sam Rivera",
            "--email",
            "sam@example.com",
        ],
    );
    let person_id = person["id"].as_str().unwrap();
    let link = format!("person:{person_id}");

    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Intro",
            "--text",
            "Thanks for the introduction.",
        ],
    );
    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Intro",
            "--text",
            "Thanks for the introduction.",
            "--external-id",
            "gmail:msg-1",
            "--original-url",
            "https://mail.google.com/mail/u/0/#inbox/msg-1",
            "--link",
            &link,
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]);

    let third = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Intro updated",
            "--text",
            "A later import has slightly different body text.",
            "--external-id",
            "gmail:msg-1",
            "--link",
            &link,
        ],
    );
    assert_eq!(third["isDuplicate"], true);
    assert_eq!(third["id"], first["id"]);

    let conn = Connection::open(&db).unwrap();
    let (external_id, original_url): (String, String) = conn
        .query_row(
            "SELECT external_id, original_url FROM interactions WHERE id = ?1",
            [first["id"].as_str().unwrap()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(external_id, "gmail:msg-1");
    assert_eq!(
        original_url,
        "https://mail.google.com/mail/u/0/#inbox/msg-1"
    );
    let interactions: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM interactions WHERE external_id = 'gmail:msg-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(interactions, 1);
    let participants: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM interaction_participants WHERE interaction_id = ?1 AND person_id = ?2",
            (first["id"].as_str().unwrap(), person_id),
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(participants, 1);
}

#[test]
fn add_interaction_external_id_dedupe_is_source_scoped() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    // Same upstream id under different sources must stay distinct: external ids
    // are only unique within a source.
    let gmail = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Gmail message",
            "--text",
            "Body from the Gmail copy.",
            "--source",
            "gmail",
            "--external-id",
            "shared-id-1",
        ],
    );
    assert_eq!(gmail["isDuplicate"], false);

    let zoom = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Zoom meeting",
            "--text",
            "A completely different Zoom transcript.",
            "--source",
            "zoom",
            "--external-id",
            "shared-id-1",
        ],
    );
    assert_eq!(zoom["isDuplicate"], false, "zoom must not merge into gmail");
    assert_ne!(zoom["id"], gmail["id"]);

    // An import that omits --source must not merge into either claimed record.
    let sourceless = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "note",
            "--title",
            "Sourceless",
            "--text",
            "Yet another body with the same external id.",
            "--external-id",
            "shared-id-1",
        ],
    );
    assert_eq!(sourceless["isDuplicate"], false);
    assert_ne!(sourceless["id"], gmail["id"]);
    assert_ne!(sourceless["id"], zoom["id"]);

    let conn = Connection::open(&db).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM interactions WHERE external_id = 'shared-id-1'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 3);
}

#[test]
fn add_interaction_external_id_dedupe_matches_within_same_source() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "First",
            "--text",
            "First body.",
            "--source",
            "gmail",
            "--external-id",
            "same-source-1",
        ],
    );
    assert_eq!(first["isDuplicate"], false);

    // Different body, same source + external id → still the same record.
    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "First (re-import)",
            "--text",
            "A slightly different body for the same Gmail message.",
            "--source",
            "gmail",
            "--external-id",
            "same-source-1",
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]);
}

#[test]
fn add_interaction_rejects_empty_bracket_participant() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    // `from:<>` carries no usable identity and would violate the
    // interaction_participants CHECK; the command must fail cleanly instead.
    let out = run(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Broken participant",
            "--text",
            "Body with a bad participant.",
            "--participant",
            "from:<>",
        ],
    );
    assert!(!out.status.success());
    let stderr = String::from_utf8_lossy(&out.stderr);
    assert!(
        stderr.contains("missing a name or handle"),
        "unexpected stderr: {stderr}"
    );

    let conn = Connection::open(&db).unwrap();
    let interactions: i64 = conn
        .query_row("SELECT COUNT(*) FROM interactions", [], |row| row.get(0))
        .unwrap();
    assert_eq!(interactions, 0, "interaction must roll back");
    let participants: i64 = conn
        .query_row("SELECT COUNT(*) FROM interaction_participants", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(participants, 0);
}

#[test]
fn add_interaction_keeps_name_only_participant() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    // A display name with empty brackets is still a valid participant.
    let interaction = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Name only",
            "--text",
            "Body with a name-only participant.",
            "--participant",
            "from:Casey Jordan <>",
        ],
    );
    let id = interaction["id"].as_str().unwrap();
    let conn = Connection::open(&db).unwrap();
    let (handle, display_name): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT handle, display_name FROM interaction_participants
             WHERE interaction_id = ?1 AND role = 'from'",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(handle, None);
    assert_eq!(display_name.as_deref(), Some("Casey Jordan"));
}

#[test]
fn add_interaction_reimport_does_not_duplicate_name_only_participant() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    // A name-only participant has no covering unique index, so a duplicate
    // interaction re-import must not append a second identical participant row.
    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Name only",
            "--text",
            "First body for this upstream message.",
            "--source",
            "gmail",
            "--external-id",
            "gmail-msg-7",
            "--participant",
            "from:Casey Jordan <>",
        ],
    );
    assert_eq!(first["isDuplicate"], false);

    let second = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Name only again",
            "--text",
            "Different body from the same upstream message.",
            "--source",
            "gmail",
            "--external-id",
            "gmail-msg-7",
            "--participant",
            "from:Casey Jordan <>",
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]);

    let conn = Connection::open(&db).unwrap();
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM interaction_participants
             WHERE interaction_id = ?1 AND role = 'from' AND display_name = 'Casey Jordan'",
            [first["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(count, 1);
}

#[test]
fn add_person_from_email_skips_org_comma_labels() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    // "Acme, Sales" / "Amazon, Customer Service" must not be inverted into fake
    // people.
    for name in ["Acme, Sales", "Amazon, Customer Service"] {
        let skipped = run_json(
            &db,
            &[
                "--json",
                "add",
                "person-from-email",
                "--full-name",
                name,
                "--email",
                "team@example.com",
            ],
        );
        assert_eq!(skipped["id"], Value::Null, "{name} should be skipped");
        let codes = skipped["reasonCodes"].as_array().unwrap();
        assert!(
            codes.iter().any(|c| c == "not_capitalized_first_last"),
            "{name} reasonCodes: {codes:?}"
        );
    }

    // A genuine "Last, First" directory entry is still inverted and created.
    let created = run_json(
        &db,
        &[
            "--json",
            "add",
            "person-from-email",
            "--full-name",
            "Rivera, Sam",
            "--email",
            "sam@example.com",
        ],
    );
    assert_eq!(created["normalizedName"], "Sam Rivera");
    assert!(created["id"].is_string());
}

#[test]
fn add_person_from_email_strips_route_phrase_and_creates_person() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    // "Robin Spencer via LinkedIn" normalizes to a usable person name once the
    // routing marker is stripped, so a person is created and not flagged.
    let created = run_json(
        &db,
        &[
            "--json",
            "add",
            "person-from-email",
            "--full-name",
            "Robin Spencer via LinkedIn",
            "--email",
            "robin@example.com",
        ],
    );
    assert_eq!(created["created"], true);
    assert_eq!(created["normalizedName"], "Robin Spencer");
    let codes = created["reasonCodes"].as_array().unwrap();
    assert!(codes.is_empty(), "reasonCodes: {codes:?}");

    // A routing marker that strips down to non-name noise is still skipped.
    let skipped = run_json(
        &db,
        &[
            "--json",
            "add",
            "person-from-email",
            "--full-name",
            "noreply via Mailchimp",
            "--email",
            "sender@example.com",
        ],
    );
    assert_eq!(skipped["id"], Value::Null);
    let codes = skipped["reasonCodes"].as_array().unwrap();
    assert!(
        codes.iter().any(|c| c == "route_phrase"),
        "reasonCodes: {codes:?}"
    );
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
    let org = run_json(
        &db,
        &[
            "--json",
            "add",
            "organization",
            "--name",
            "Northwind Partnership",
        ],
    );
    let org_id = org["id"].as_str().unwrap();
    run_json(
        &db,
        &[
            "--json",
            "enrich",
            "organization",
            org_id,
            "--summary",
            "Northwind Partnership is a distribution relationship.",
        ],
    );
    let results = run_json(&db, &["--json", "search", "partnership"]);
    let hits = results["results"].as_array().unwrap();
    assert!(hits
        .iter()
        .any(|h| h["kind"] == "interaction" && h["title"] == "Kickoff"));
    let org_hits = hits
        .iter()
        .filter(|h| h["kind"] == "organization" && h["id"] == org_id)
        .count();
    assert_eq!(org_hits, 1);
}

#[test]
fn add_task_with_assignee_creates_role_row_and_json_includes_assignee_count() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let person = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Dana Scully",
            "--email",
            "dana@example.com",
        ],
    );
    let person_id = person["id"].as_str().unwrap();

    let task = run_json(
        &db,
        &[
            "--json",
            "add",
            "task",
            "--title",
            "Send the deck",
            "--assignee",
            person_id,
        ],
    );
    assert_eq!(task["kind"], "task");
    assert_eq!(task["assigneeCount"], 1);
    let task_id = task["id"].as_str().unwrap();

    let conn = Connection::open(&db).unwrap();
    let (role, linked_person_id): (String, String) = conn
        .query_row(
            "SELECT role, person_id FROM task_people WHERE task_id = ?1",
            [task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(role, "assignee");
    assert_eq!(linked_person_id, person_id);
}

#[test]
fn add_task_assignee_and_person_link_same_person_yields_one_assignee_row() {
    // --link person:X and --assignee X for the same person must not create two
    // task_people rows. The assignee row (role='assignee') wins.
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let person = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Dana Scully",
            "--email",
            "dana@example.com",
        ],
    );
    let person_id = person["id"].as_str().unwrap();
    let link_arg = format!("person:{person_id}");

    let task = run_json(
        &db,
        &[
            "--json",
            "add",
            "task",
            "--title",
            "Send the deck",
            "--link",
            &link_arg,
            "--assignee",
            person_id,
        ],
    );
    assert_eq!(task["assigneeCount"], 1);
    let task_id = task["id"].as_str().unwrap();

    let conn = Connection::open(&db).unwrap();
    let row_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM task_people WHERE task_id = ?1",
            [task_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(row_count, 1, "expected exactly one task_people row");

    let role: String = conn
        .query_row(
            "SELECT role FROM task_people WHERE task_id = ?1",
            [task_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(role, "assignee");
}

#[test]
fn add_task_duplicate_assignee_flag_succeeds_and_inserts_once() {
    // Passing --assignee <id> twice must not fail with a UNIQUE constraint
    // violation; it should succeed and produce exactly one task_people row.
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let person = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Dana Scully",
            "--email",
            "dana@example.com",
        ],
    );
    let person_id = person["id"].as_str().unwrap();

    let task = run_json(
        &db,
        &[
            "--json",
            "add",
            "task",
            "--title",
            "Send the deck",
            "--assignee",
            person_id,
            "--assignee",
            person_id, // duplicate flag
        ],
    );
    assert_eq!(task["kind"], "task");
    assert_eq!(task["assigneeCount"], 1);
    let task_id = task["id"].as_str().unwrap();

    let conn = Connection::open(&db).unwrap();
    let row_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM task_people WHERE task_id = ?1",
            [task_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(row_count, 1, "expected exactly one task_people row");

    let role: String = conn
        .query_row(
            "SELECT role FROM task_people WHERE task_id = ?1",
            [task_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(role, "assignee");
}

#[test]
fn plan_day_json_includes_assignees() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let person = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Dana Scully",
            "--email",
            "dana@example.com",
        ],
    );
    let person_id = person["id"].as_str().unwrap();

    run_json(
        &db,
        &[
            "--json",
            "add",
            "task",
            "--title",
            "Send the deck",
            "--assignee",
            person_id,
        ],
    );

    let plan = run_json(&db, &["--json", "tasks", "plan-day"]);
    let tasks = plan["tasks"].as_array().unwrap();
    assert_eq!(tasks.len(), 1);
    let assignees = tasks[0]["assignees"].as_array().unwrap();
    assert_eq!(assignees.len(), 1);
    assert_eq!(assignees[0]["name"], "Dana Scully");
    assert_eq!(assignees[0]["id"], person_id);
}

#[test]
fn today_json_includes_assignees() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let person = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Robin Spencer",
            "--email",
            "robin@example.com",
        ],
    );
    let person_id = person["id"].as_str().unwrap();

    run_json(
        &db,
        &[
            "--json",
            "add",
            "task",
            "--title",
            "Review the proposal",
            "--assignee",
            person_id,
        ],
    );

    let today = run_json(&db, &["--json", "today"]);
    // Collect all tasks from all buckets
    let open = today["tasks"]["open"].as_array().unwrap();
    let task = open
        .iter()
        .find(|t| t["title"] == "Review the proposal")
        .unwrap();
    let assignees = task["assignees"].as_array().unwrap();
    assert_eq!(assignees.len(), 1);
    assert_eq!(assignees[0]["name"], "Robin Spencer");
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
fn add_task_links_to_origin_interaction_and_project() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let interaction = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Transcript",
            "--text",
            "Discussed a follow-up task.",
        ],
    );
    let project = run_json(
        &db,
        &["--json", "add", "project", "--name", "Transcript Follow-up"],
    );
    let interaction_link = format!("interaction:{}", interaction["id"].as_str().unwrap());
    let interaction_evidence = format!("{}#0", interaction_link);
    let project_link = format!("project:{}", project["id"].as_str().unwrap());
    let task = run_json(
        &db,
        &[
            "--json",
            "add",
            "task",
            "--title",
            "Do the follow-up",
            "--link",
            &interaction_link,
            "--link",
            &project_link,
            "--evidence",
            &interaction_evidence,
        ],
    );
    assert_eq!(task["evidence"], 1);
    let task_id = task["id"].as_str().unwrap();
    let conn = Connection::open(&db).unwrap();
    let (project_id, origin_interaction_id): (String, String) = conn
        .query_row(
            "SELECT project_id, origin_interaction_id FROM tasks WHERE id = ?1",
            [task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(project_id, project["id"].as_str().unwrap());
    assert_eq!(origin_interaction_id, interaction["id"].as_str().unwrap());

    let task_interactions: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM task_interactions WHERE task_id = ?1 AND interaction_id = ?2",
            (task_id, interaction["id"].as_str().unwrap()),
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(task_interactions, 1);
    let evidence_refs: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM evidence_refs er
             JOIN content_chunks cc ON cc.id = er.chunk_id
             WHERE er.subject_type = 'task'
               AND er.subject_id = ?1
               AND cc.record_type = 'interaction'
               AND cc.record_id = ?2
               AND cc.chunk_index = 0",
            (task_id, interaction["id"].as_str().unwrap()),
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(evidence_refs, 1);
}

#[test]
fn remember_can_cite_source_interaction_chunk() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let interaction = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Transcript",
            "--text",
            "Alex prefers transcript-backed memories.",
        ],
    );
    let interaction_link = format!("interaction:{}", interaction["id"].as_str().unwrap());
    let interaction_evidence = format!("{}#0", interaction_link);

    let memory = run_json(
        &db,
        &[
            "--json",
            "remember",
            "--kind",
            "preference",
            "--claim",
            "Alex prefers transcript-backed memories.",
            "--link",
            &interaction_link,
            "--evidence",
            &interaction_evidence,
        ],
    );

    assert_eq!(memory["links"], 1);
    assert_eq!(memory["evidence"], 1);
    let conn = Connection::open(&db).unwrap();
    let evidence_refs: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM evidence_refs er
             JOIN content_chunks cc ON cc.id = er.chunk_id
             WHERE er.subject_type = 'memory'
               AND er.subject_id = ?1
               AND cc.record_type = 'interaction'
               AND cc.record_id = ?2
               AND cc.chunk_index = 0",
            (
                memory["id"].as_str().unwrap(),
                interaction["id"].as_str().unwrap(),
            ),
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(evidence_refs, 1);
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
    Connection::open(&db)
        .unwrap()
        .execute(
            "INSERT INTO people (id, full_name, is_self) VALUES ('self', 'You', 1)",
            [],
        )
        .unwrap();
    let person = run_json(&db, &["--json", "add", "person", "--full-name", "Ada"]);
    let interaction = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Catchup",
            "--link",
            &format!("person:{}", person["id"].as_str().unwrap()),
        ],
    );
    let raw_interaction = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Raw sender",
            "--participant",
            "from:Raw Sender <raw@example.com>",
        ],
    );
    Connection::open(&db)
        .unwrap()
        .execute_batch(&format!(
            "INSERT INTO memories (id, claim) VALUES ('mem-from-interaction', 'Ada likes graphs');
             INSERT INTO memory_links (id, memory_id, record_type, record_id)
             VALUES ('ml-from-interaction', 'mem-from-interaction', 'interaction', '{}');
             INSERT INTO memories (id, claim) VALUES ('mem-from-raw-interaction', 'Raw sender likes graphs');
             INSERT INTO memory_links (id, memory_id, record_type, record_id)
             VALUES ('ml-from-raw-interaction', 'mem-from-raw-interaction', 'interaction', '{}');
             INSERT INTO memories (id, claim) VALUES ('mem-from-missing-interaction', 'Missing interaction');
             INSERT INTO memory_links (id, memory_id, record_type, record_id)
             VALUES ('ml-from-missing-interaction', 'mem-from-missing-interaction', 'interaction', 'missing-interaction');",
            interaction["id"].as_str().unwrap(),
            raw_interaction["id"].as_str().unwrap()
        ))
        .unwrap();
    let graph = run_json(&db, &["--json", "graph", "--center", "self"]);
    assert!(graph["nodes"].is_array());
    assert!(graph["edges"].is_array());
    assert!(graph.get("truncatedKinds").is_none());
    assert!(!graph["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .any(|node| node["kind"] == "interaction"));
    assert!(graph["edges"].as_array().unwrap().iter().any(|edge| {
        edge["kind"] == "interaction"
            && edge["weight"] == 1
            && edge["interactionId"] == interaction["id"]
    }));
    assert!(graph["edges"].as_array().unwrap().iter().any(|edge| {
        edge["kind"] == "memory"
            && edge["source"] == "mem-from-interaction"
            && edge["target"] == person["id"]
    }));
    assert!(graph["edges"].as_array().unwrap().iter().any(|edge| {
        edge["kind"] == "memory"
            && edge["source"] == "mem-from-raw-interaction"
            && edge["target"] == "self"
    }));
    assert!(!graph["edges"].as_array().unwrap().iter().any(|edge| {
        edge["kind"] == "memory"
            && edge["source"] == "mem-from-missing-interaction"
            && edge["target"] == "self"
    }));
}

#[test]
fn graph_does_not_cap_dense_node_kinds() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let mut ids = Vec::new();

    for index in 0..75 {
        let person = run_json(
            &db,
            &[
                "--json",
                "add",
                "person",
                "--full-name",
                &format!("Graph Person {index:02}"),
            ],
        );
        ids.push(person["id"].as_str().unwrap().to_string());
    }

    let graph = run_json(&db, &["--json", "graph", "--center", "self"]);
    let nodes = graph["nodes"].as_array().unwrap();
    let node_ids: std::collections::HashSet<&str> = nodes
        .iter()
        .filter_map(|node| node["id"].as_str())
        .collect();

    for id in &ids {
        assert!(node_ids.contains(id.as_str()), "graph omitted {id}");
    }
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

#[test]
fn self_set_and_show_json_contract() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let set = run_json(
        &db,
        &[
            "--json",
            "self",
            "set",
            "--full-name",
            "Alex MacCaw",
            "--email",
            "alex@maccaw.org",
            "--email",
            "me@work.com",
        ],
    );
    assert_eq!(set["isSelf"], true);
    assert_eq!(set["fullName"], "Alex MacCaw");
    assert_eq!(set["emails"].as_array().unwrap().len(), 2);

    let show = run_json(&db, &["--json", "self", "show"]);
    assert_eq!(show["primaryEmail"], "alex@maccaw.org");
    assert_eq!(show["isSelf"], true);
}

#[test]
fn add_organization_json_contract_and_dedupe() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "organization",
            "--name",
            "Evensen Design",
            "--domain",
            "evensendesign.com",
        ],
    );
    assert_eq!(first["kind"], "organization");
    assert_eq!(first["isDuplicate"], false);

    // Same name (different spacing/casing) dedupes; same domain too.
    let by_name = run_json(
        &db,
        &[
            "--json",
            "add",
            "organization",
            "--name",
            "  evensen   design ",
        ],
    );
    assert_eq!(by_name["isDuplicate"], true);
    assert_eq!(by_name["id"], first["id"]);
    let by_domain = run_json(
        &db,
        &[
            "--json",
            "add",
            "organization",
            "--name",
            "Evensen Studio",
            "--domain",
            "www.evensendesign.com",
        ],
    );
    assert_eq!(by_domain["id"], first["id"]);
}

#[test]
fn affiliate_json_contract_and_missing_person_is_not_found() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let person = run_json(
        &db,
        &["--json", "add", "person", "--full-name", "Lisa Freeman"],
    );
    let org = run_json(
        &db,
        &["--json", "add", "organization", "--name", "Evensen Design"],
    );
    let pid = person["id"].as_str().unwrap();
    let oid = org["id"].as_str().unwrap();

    let aff = run_json(
        &db,
        &[
            "--json",
            "affiliate",
            "--person",
            pid,
            "--org",
            oid,
            "--title",
            "Lead Designer",
            "--current",
        ],
    );
    assert_eq!(aff["kind"], "affiliation");
    assert_eq!(aff["isCurrent"], true);

    let out = run(
        &db,
        &["--json", "affiliate", "--person", "nope", "--org", oid],
    );
    assert_eq!(out.status.code(), Some(3), "missing person is not_found");
}

#[test]
fn suggest_project_accept_and_dedupe_json_contract() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let interaction = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Thread",
            "--text",
            "design body",
        ],
    );
    let iid = interaction["id"].as_str().unwrap();
    let link = format!("interaction:{iid}");

    let suggestion = run_json(
        &db,
        &[
            "--json",
            "suggest",
            "project",
            "--title",
            "West Elizabeth",
            "--link",
            &link,
        ],
    );
    assert_eq!(suggestion["status"], "open");
    let sid = suggestion["id"].as_str().unwrap().to_string();

    let list = run_json(&db, &["--json", "suggest", "list"]);
    assert_eq!(list["suggestions"].as_array().unwrap().len(), 1);

    let accepted = run_json(&db, &["--json", "suggest", "accept", &sid]);
    assert_eq!(accepted["status"], "accepted");
    assert_eq!(accepted["recordType"], "project");

    // Re-proposing an already-accepted title dedupes rather than forking.
    let again = run_json(
        &db,
        &[
            "--json",
            "suggest",
            "project",
            "--title",
            "west   elizabeth",
        ],
    );
    assert_eq!(again["isDuplicate"], true);
    // Accepting/dismissing a non-open suggestion errors.
    let out = run(&db, &["--json", "suggest", "dismiss", &sid]);
    assert!(!out.status.success());
}

#[test]
fn interaction_refresh_reports_body_changed_then_redigests() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    // gmail source is seeded by the schema; thread import is source-backed.
    let first = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Thread",
            "--source",
            "gmail",
            "--external-kind",
            "thread",
            "--external-id",
            "thr-1",
            "--text",
            "first body",
        ],
    );
    assert_eq!(first["isDuplicate"], false);

    // Grown body, no --refresh: detected (bodyChanged) but not mutated.
    let changed = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Thread",
            "--source",
            "gmail",
            "--external-kind",
            "thread",
            "--external-id",
            "thr-1",
            "--text",
            "first body and a new reply",
        ],
    );
    assert_eq!(changed["isDuplicate"], true);
    assert_eq!(changed["bodyChanged"], true);

    // With --refresh: re-digest, and the staleness flag is consumed.
    let refreshed = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Thread",
            "--source",
            "gmail",
            "--external-kind",
            "thread",
            "--external-id",
            "thr-1",
            "--refresh",
            "--text",
            "first body and a new reply",
        ],
    );
    assert_eq!(refreshed["isDuplicate"], true);
    assert!(
        refreshed.get("bodyChanged").is_none(),
        "refresh re-digested, so no stale signal: {refreshed}"
    );
}

#[test]
fn remember_evidence_by_quote_resolves_chunk() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let interaction = run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "note",
            "--title",
            "T",
            "--text",
            "intro line. the Powder Bathroom sink decision and lead times.",
        ],
    );
    let iid = interaction["id"].as_str().unwrap();
    let link = format!("interaction:{iid}");
    let good = format!("interaction:{iid}~Powder Bathroom sink");
    let memory = run_json(
        &db,
        &[
            "--json",
            "remember",
            "--kind",
            "fact",
            "--claim",
            "Order the sink soon",
            "--link",
            &link,
            "--evidence",
            &good,
        ],
    );
    assert_eq!(memory["kind"], "memory");
    assert_eq!(memory["evidence"], 1);

    let bad = format!("interaction:{iid}~a phrase that is not present");
    let out = run(
        &db,
        &[
            "--json",
            "remember",
            "--kind",
            "fact",
            "--claim",
            "x",
            "--link",
            &link,
            "--evidence",
            &bad,
        ],
    );
    assert!(!out.status.success(), "an unmatched quote must error");
}

#[test]
fn import_context_bundles_everything_an_import_needs() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);

    // Empty brain: self is null, sources are seeded, counts are zero.
    let empty = run_json(&db, &["--json", "import-context"]);
    assert!(empty["self"].is_null(), "no self yet");
    assert!(
        empty["sources"]
            .as_array()
            .unwrap()
            .iter()
            .any(|s| s["slug"] == "gmail"),
        "seeded sources are listed"
    );
    assert_eq!(empty["counts"]["people"], 0);

    // Populate: self, an existing project + org, a source-backed interaction, and an
    // open suggestion.
    run_json(
        &db,
        &[
            "--json",
            "self",
            "set",
            "--full-name",
            "Alex MacCaw",
            "--email",
            "alex@maccaw.org",
        ],
    );
    run_json(
        &db,
        &["--json", "add", "project", "--name", "Existing Project"],
    );
    run_json(
        &db,
        &[
            "--json",
            "add",
            "organization",
            "--name",
            "Evensen Design",
            "--domain",
            "evensendesign.com",
        ],
    );
    run_json(
        &db,
        &[
            "--json",
            "add",
            "interaction",
            "--kind",
            "email",
            "--title",
            "Thread",
            "--source",
            "gmail",
            "--external-kind",
            "thread",
            "--external-id",
            "thr-1",
            "--occurred-at",
            "2026-06-19T10:00:00Z",
            "--text",
            "body",
        ],
    );
    run_json(
        &db,
        &["--json", "suggest", "project", "--title", "West Elizabeth"],
    );

    let ctx = run_json(&db, &["--json", "import-context"]);
    assert_eq!(ctx["self"]["configured"], true);
    assert_eq!(ctx["self"]["fullName"], "Alex MacCaw");
    assert!(
        ctx["projects"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["name"] == "Existing Project"),
        "existing projects are listed to link"
    );
    assert!(
        ctx["organizations"]
            .as_array()
            .unwrap()
            .iter()
            .any(|o| o["name"] == "Evensen Design"),
        "existing organizations are listed to link"
    );
    assert_eq!(ctx["openSuggestions"].as_array().unwrap().len(), 1);

    // Per-source watermark from the imported interaction.
    let gmail = ctx["imports"]
        .as_array()
        .unwrap()
        .iter()
        .find(|w| w["source"] == "gmail")
        .expect("gmail watermark present");
    assert_eq!(gmail["latestAt"], "2026-06-19T10:00:00Z");
    assert_eq!(gmail["count"], 1);
    assert_eq!(ctx["counts"]["interactions"], 1);
}

#[test]
fn import_document_records_identity_provenance_and_finalizes() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let person = run_json(
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
    let project = run_json(
        &db,
        &["--json", "add", "project", "--name", "Project Alpha"],
    );
    let person_link = format!("person:{}", person["id"].as_str().unwrap());
    let project_link = format!("project:{}", project["id"].as_str().unwrap());

    let document = run_json(
        &db,
        &[
            "--json",
            "import",
            "document",
            "--title",
            "Reflect note: Project Alpha",
            "--text",
            "Maya Chen confirmed Project Alpha should launch with the new credential flow.",
            "--source",
            "reflect_notes",
            "--external-kind",
            "note",
            "--external-id",
            "reflect-note-1",
            "--original-path",
            "/Users/alex/Documents/reflect-maccman2/project-alpha.md",
            "--original-url",
            "reflect://note/reflect-note-1",
            "--link",
            &person_link,
            "--link",
            &project_link,
        ],
    );
    let document_id = document["id"].as_str().unwrap();
    let document_ref = format!("document:{document_id}");
    let document_alias_ref = format!("doc:{document_id}");
    let evidence = format!("{document_ref}~credential flow");

    run_json(
        &db,
        &[
            "--json",
            "add",
            "ai-note",
            "--kind",
            "summary",
            "--subject",
            &document_alias_ref,
            "--text",
            "Project Alpha should launch with the credential flow.",
            "--evidence",
            &evidence,
        ],
    );
    let fact = run_json(
        &db,
        &[
            "--json",
            "add",
            "fact",
            "--subject",
            &document_ref,
            "--key",
            "decision",
            "--value-text",
            "Project Alpha should launch with the credential flow.",
            "--source-record",
            &document_ref,
            "--confidence",
            "0.9",
            "--evidence",
            &evidence,
        ],
    );
    let memory = run_json(
        &db,
        &[
            "--json",
            "promote",
            "fact",
            fact["id"].as_str().unwrap(),
            "--memory-kind",
            "decision",
        ],
    );
    assert_eq!(memory["isDuplicate"], false);
    assert_eq!(memory["chunkCount"], 1);
    let duplicate_memory = run_json(
        &db,
        &[
            "--json",
            "promote",
            "fact",
            fact["id"].as_str().unwrap(),
            "--memory-kind",
            "decision",
        ],
    );
    assert_eq!(duplicate_memory["id"], memory["id"]);
    assert_eq!(duplicate_memory["isDuplicate"], true);
    run_json(
        &db,
        &[
            "--json",
            "tag",
            "ensure",
            "--name",
            "Project Alpha",
            "--slug",
            "project-alpha",
        ],
    );
    run_json(
        &db,
        &[
            "--json",
            "tag",
            "attach",
            "--tag",
            "project-alpha",
            "--record",
            &document_ref,
        ],
    );

    let finalized = run_json(
        &db,
        &[
            "--json",
            "import",
            "finalize",
            "--record",
            &document_alias_ref,
        ],
    );
    assert_eq!(finalized["complete"], true);
    assert!(finalized["missing"].as_array().unwrap().is_empty());
    let finalized_again = run_json(
        &db,
        &["--json", "import", "finalize", "--record", &document_ref],
    );
    assert_eq!(finalized_again["complete"], true);

    let conn = Connection::open(&db).unwrap();
    let identity_count: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM external_identities
             WHERE entity_type = 'document'
               AND entity_id = ?1
               AND kind = 'note'
               AND external_id = 'reflect-note-1'",
            [document_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(identity_count, 1);
    let (provenance_count, finalized_count, memory_count, memory_chunks): (i64, i64, i64, i64) =
        conn.query_row(
            "SELECT COUNT(*),
                    SUM(CASE WHEN provenance_kind = 'finalized' THEN 1 ELSE 0 END),
                    (SELECT COUNT(*) FROM memories WHERE promoted_from_fact_id = ?2),
                    (SELECT COUNT(*) FROM content_chunks
                     WHERE record_type = 'memory' AND record_id = ?3)
             FROM record_provenance
             WHERE record_type = 'document'
               AND record_id = ?1
               AND provenance_kind IN ('imported', 'finalized')",
            (
                document_id,
                fact["id"].as_str().unwrap(),
                memory["id"].as_str().unwrap(),
            ),
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .unwrap();
    assert_eq!(provenance_count, 2);
    assert_eq!(finalized_count, 1);
    assert_eq!(memory_count, 1);
    assert_eq!(memory_chunks, 1);
}

#[test]
fn import_document_reimport_by_source_identity_refreshes_body_and_chunks() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "import",
            "document",
            "--title",
            "Reflect note",
            "--text",
            "Old searchable marker.",
            "--source",
            "reflect_notes",
            "--external-kind",
            "note",
            "--external-id",
            "reflect-note-refresh",
        ],
    );
    let second = run_json(
        &db,
        &[
            "--json",
            "import",
            "document",
            "--title",
            "Reflect note",
            "--text",
            "New searchable marker.",
            "--source",
            "reflect_notes",
            "--external-kind",
            "note",
            "--external-id",
            "reflect-note-refresh",
        ],
    );
    assert_eq!(second["isDuplicate"], true);
    assert_eq!(second["id"], first["id"]);
    assert_eq!(second["chunkCount"], 1);

    let conn = Connection::open(&db).unwrap();
    let body: String = conn
        .query_row(
            "SELECT body_text FROM documents WHERE id = ?1",
            [first["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(body, "New searchable marker.");
    let stale_chunks: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM content_chunks
             WHERE record_type = 'document'
               AND record_id = ?1
               AND text LIKE '%Old searchable marker%'",
            [first["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(stale_chunks, 0);
    let fresh_chunks: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM content_chunks
             WHERE record_type = 'document'
               AND record_id = ?1
               AND text LIKE '%New searchable marker%'",
            [first["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(fresh_chunks, 1);
}

#[test]
fn evidence_refs_accept_transcript_chunks() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let interaction = run_json(
        &db,
        &[
            "--json",
            "import",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Granola sync",
            "--text",
            "Meeting shell imported from Granola.",
            "--source",
            "granola",
            "--external-id",
            "granola-meeting-1",
            "--participant",
            "speaker:Alex MacCaw <alex@example.com>",
        ],
    );
    let interaction_id = interaction["id"].as_str().unwrap();
    let transcript = run_json(
        &db,
        &[
            "--json",
            "import",
            "transcript",
            "--interaction",
            interaction_id,
            "--text",
            "Alex: The credential flow needs to be ready before Friday.",
            "--source",
            "granola",
            "--external-kind",
            "transcript",
            "--external-id",
            "granola-transcript-1",
            "--transcribed-by",
            "granola",
        ],
    );
    let transcript_id = transcript["id"].as_str().unwrap();
    let interaction_ref = format!("interaction:{interaction_id}");
    let transcript_ref = format!("interaction_transcript:{transcript_id}");
    let evidence = format!("{transcript_ref}~credential flow");

    let fact = run_json(
        &db,
        &[
            "--json",
            "add",
            "fact",
            "--subject",
            &interaction_ref,
            "--key",
            "follow_up",
            "--value-text",
            "Credential flow needs to be ready before Friday.",
            "--source-record",
            &transcript_ref,
            "--evidence",
            &evidence,
        ],
    );

    let conn = Connection::open(&db).unwrap();
    let transcript_evidence: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM evidence_refs er
             JOIN content_chunks cc ON cc.id = er.chunk_id
             WHERE er.subject_type = 'extracted_fact'
               AND er.subject_id = ?1
               AND cc.record_type = 'interaction_transcript'
               AND cc.record_id = ?2",
            (fact["id"].as_str().unwrap(), transcript_id),
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(transcript_evidence, 1);
    let transcript_provenance: i64 = conn
        .query_row(
            "SELECT COUNT(*)
             FROM record_provenance
             WHERE record_type = 'interaction_transcript'
               AND record_id = ?1
               AND provenance_kind = 'imported'",
            [transcript_id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(transcript_provenance, 1);
}

#[test]
fn import_finalize_accepts_transcript_chunks_for_interaction() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let person = run_json(
        &db,
        &[
            "--json",
            "add",
            "person",
            "--full-name",
            "Alex MacCaw",
            "--email",
            "alex@example.com",
        ],
    );
    let project = run_json(
        &db,
        &["--json", "add", "project", "--name", "Credential Flow"],
    );
    let participant = "speaker:Alex MacCaw <alex@example.com>";
    let interaction = run_json(
        &db,
        &[
            "--json",
            "import",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Granola sync",
            "--source",
            "granola",
            "--external-id",
            "granola-meeting-transcript-only",
            "--participant",
            participant,
        ],
    );
    let interaction_id = interaction["id"].as_str().unwrap();
    let transcript = run_json(
        &db,
        &[
            "--json",
            "import",
            "transcript",
            "--interaction",
            interaction_id,
            "--text",
            "Alex: The credential flow needs to be ready before Friday.",
            "--source",
            "granola",
            "--external-kind",
            "transcript",
            "--external-id",
            "granola-transcript-finalize",
            "--transcribed-by",
            "granola",
        ],
    );
    let transcript_id = transcript["id"].as_str().unwrap();
    let interaction_ref = format!("interaction:{interaction_id}");
    let transcript_ref = format!("interaction_transcript:{transcript_id}");
    let project_ref = format!("project:{}", project["id"].as_str().unwrap());
    let person_ref = format!("person:{}", person["id"].as_str().unwrap());
    let evidence = format!("{transcript_ref}~credential flow");

    run_json(
        &db,
        &[
            "--json",
            "add",
            "ai-note",
            "--kind",
            "summary",
            "--interaction",
            interaction_id,
            "--text",
            "The credential flow needs to be ready before Friday.",
            "--evidence",
            &evidence,
        ],
    );
    run_json(
        &db,
        &[
            "--json",
            "add",
            "fact",
            "--subject",
            &interaction_ref,
            "--key",
            "deadline",
            "--value-text",
            "The credential flow needs to be ready before Friday.",
            "--source-record",
            &transcript_ref,
            "--evidence",
            &evidence,
        ],
    );
    run_json(
        &db,
        &[
            "--json",
            "add",
            "task",
            "--title",
            "Ready the credential flow",
            "--link",
            &interaction_ref,
            "--link",
            &project_ref,
            "--link",
            &person_ref,
            "--evidence",
            &evidence,
        ],
    );
    run_json(
        &db,
        &[
            "--json",
            "tag",
            "ensure",
            "--name",
            "Credential Flow",
            "--slug",
            "credential-flow",
        ],
    );
    run_json(
        &db,
        &[
            "--json",
            "tag",
            "attach",
            "--tag",
            "credential-flow",
            "--record",
            &interaction_ref,
        ],
    );

    let finalized = run_json(
        &db,
        &["--json", "import", "finalize", "--record", &interaction_ref],
    );
    assert_eq!(finalized["complete"], true);
    assert!(finalized["missing"].as_array().unwrap().is_empty());
}

#[test]
fn import_transcript_rejects_external_identity_for_another_interaction() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let first = run_json(
        &db,
        &[
            "--json",
            "import",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "First meeting",
            "--text",
            "First shell.",
            "--source",
            "granola",
            "--external-id",
            "meeting-one",
        ],
    );
    let second = run_json(
        &db,
        &[
            "--json",
            "import",
            "interaction",
            "--kind",
            "meeting",
            "--title",
            "Second meeting",
            "--text",
            "Second shell.",
            "--source",
            "granola",
            "--external-id",
            "meeting-two",
        ],
    );
    run_json(
        &db,
        &[
            "--json",
            "import",
            "transcript",
            "--interaction",
            first["id"].as_str().unwrap(),
            "--text",
            "First transcript text.",
            "--source",
            "granola",
            "--external-kind",
            "transcript",
            "--external-id",
            "shared-transcript",
        ],
    );

    let out = run(
        &db,
        &[
            "--json",
            "import",
            "transcript",
            "--interaction",
            second["id"].as_str().unwrap(),
            "--text",
            "Second transcript text should not overwrite first.",
            "--source",
            "granola",
            "--external-kind",
            "transcript",
            "--external-id",
            "shared-transcript",
        ],
    );
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("belongs to interaction"));

    let conn = Connection::open(&db).unwrap();
    let first_text: String = conn
        .query_row(
            "SELECT raw_text FROM interaction_transcripts WHERE interaction_id = ?1",
            [first["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(first_text, "First transcript text.");
    let second_count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM interaction_transcripts WHERE interaction_id = ?1",
            [second["id"].as_str().unwrap()],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(second_count, 0);
}

#[test]
fn enrich_organization_reuses_profile_for_same_prompt_fingerprint() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let org = run_json(
        &db,
        &["--json", "add", "organization", "--name", "Example Labs"],
    );
    let org_id = org["id"].as_str().unwrap();

    let first = run_json(
        &db,
        &[
            "--json",
            "enrich",
            "organization",
            org_id,
            "--one-line-description",
            "Original profile text.",
            "--why-it-matters",
            "Original reason.",
            "--model",
            "agent-research",
            "--prompt-fingerprint",
            "org-profile-v1",
        ],
    );
    let second = run_json(
        &db,
        &[
            "--json",
            "enrich",
            "organization",
            org_id,
            "--one-line-description",
            "Updated profile text.",
            "--why-it-matters",
            "Updated reason.",
            "--model",
            "agent-research",
            "--prompt-fingerprint",
            "org-profile-v1",
        ],
    );
    assert_eq!(second["profileId"], first["profileId"]);

    let conn = Connection::open(&db).unwrap();
    let (profile_count, description, why): (i64, String, String) = conn
        .query_row(
            "SELECT COUNT(*), one_line_description, why_it_matters
             FROM organization_profiles
             WHERE organization_id = ?1",
            [org_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(profile_count, 1);
    assert_eq!(description, "Updated profile text.");
    assert_eq!(why, "Updated reason.");
}

#[test]
fn enrich_organization_reuses_profile_without_prompt_fingerprint() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let org = run_json(
        &db,
        &["--json", "add", "organization", "--name", "Example Labs"],
    );
    let org_id = org["id"].as_str().unwrap();

    let first = run_json(
        &db,
        &[
            "--json",
            "enrich",
            "organization",
            org_id,
            "--one-line-description",
            "Original profile text.",
        ],
    );
    let second = run_json(
        &db,
        &[
            "--json",
            "enrich",
            "organization",
            org_id,
            "--one-line-description",
            "Updated profile text.",
        ],
    );
    assert_eq!(second["profileId"], first["profileId"]);

    let conn = Connection::open(&db).unwrap();
    let (profile_count, description): (i64, String) = conn
        .query_row(
            "SELECT COUNT(*), one_line_description
             FROM organization_profiles
             WHERE organization_id = ?1",
            [org_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(profile_count, 1);
    assert_eq!(description, "Updated profile text.");
}

#[test]
fn import_finalize_supports_explicit_waivers_for_structured_events() {
    let dir = TempDir::new().unwrap();
    let db = db_path(&dir);
    let event = run_json(
        &db,
        &[
            "--json",
            "import",
            "interaction",
            "--kind",
            "event",
            "--title",
            "Calendar: flight to SFO",
            "--occurred-at",
            "2026-07-09T09:00:00Z",
            "--source",
            "google_calendar",
            "--external-kind",
            "event",
            "--external-id",
            "calendar-event-waived-1",
        ],
    );
    assert_eq!(event["chunkCount"], 0);
    let event_id = event["id"].as_str().unwrap();
    let event_ref = format!("interaction:{event_id}");

    run_json(
        &db,
        &[
            "--json",
            "add",
            "ai-note",
            "--kind",
            "summary",
            "--interaction",
            event_id,
            "--text",
            "Structured calendar travel block.",
        ],
    );
    run_json(
        &db,
        &[
            "--json", "tag", "ensure", "--name", "Travel", "--slug", "travel",
        ],
    );
    run_json(
        &db,
        &[
            "--json", "tag", "attach", "--tag", "travel", "--record", &event_ref,
        ],
    );

    let before = run_json(
        &db,
        &["--json", "import", "finalize", "--record", &event_ref],
    );
    assert_eq!(before["complete"], false);
    assert!(before["missing"]
        .as_array()
        .unwrap()
        .iter()
        .any(|missing| missing == "rawText"));
    assert!(before["missing"]
        .as_array()
        .unwrap()
        .iter()
        .any(|missing| missing == "chunks"));
    assert!(before["missing"]
        .as_array()
        .unwrap()
        .iter()
        .any(|missing| missing == "participantsOrEntities"));

    let still_incomplete = run_json(
        &db,
        &[
            "--json",
            "import",
            "finalize",
            "--record",
            &event_ref,
            "--no-entities",
            "--no-project-or-task-link",
            "--no-derived-actions",
            "--no-extracted-facts",
        ],
    );
    assert_eq!(still_incomplete["complete"], false);
    assert!(still_incomplete["missing"]
        .as_array()
        .unwrap()
        .iter()
        .any(|missing| missing == "rawText"));

    let finalized = run_json(
        &db,
        &[
            "--json",
            "import",
            "finalize",
            "--record",
            &event_ref,
            "--raw-text-unavailable",
            "--no-entities",
            "--no-project-or-task-link",
            "--no-derived-actions",
            "--no-extracted-facts",
        ],
    );
    assert_eq!(finalized["complete"], true);
    assert_eq!(finalized["waivers"]["rawTextUnavailable"], true);
    assert_eq!(finalized["waivers"]["noEntities"], true);
    assert_eq!(finalized["waivers"]["noExtractedFacts"], true);

    let audit = run_json(&db, &["--json", "import", "audit", "--limit", "10"]);
    assert_eq!(audit["incompleteCount"], 0);
}
