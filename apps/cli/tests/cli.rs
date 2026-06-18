//! Integration tests for the `brain` CLI against a temporary SQLite database.
//! They run the real built binary (`CARGO_BIN_EXE_brain`), assert the stable
//! JSON contracts, and verify stdout/stderr separation. No model key is needed:
//! `ask` is exercised in its degraded (evidence-only) mode.

use std::path::Path;
use std::process::{Command, Output};

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
    assert_eq!(shown["primaryEmail"], "maya@example.com");
    assert_eq!(shown["primaryPhone"], "+1 555 0100");
    assert_eq!(shown["subtitle"], "Designer");
    assert_eq!(shown["location"], "Austin");
    assert_eq!(shown["reconnectIntervalDays"], 30);
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
            "--reconnect-interval-days",
            "14",
        ],
    );
    assert_eq!(enriched["isDuplicate"], true);
    assert_eq!(enriched["id"], sparse["id"]);
    let enriched_id = sparse["id"].as_str().unwrap();
    let enriched_shown = run_json(&db, &["--json", "show", "person", enriched_id]);
    assert_eq!(enriched_shown["primaryEmail"], "jordan@example.com");
    assert_eq!(enriched_shown["primaryPhone"], "+1 555 0200");
    assert_eq!(enriched_shown["subtitle"], "Investor");
    assert_eq!(enriched_shown["location"], "New York");
    assert_eq!(enriched_shown["summary"], "Met through a contact export.");
    assert_eq!(enriched_shown["notes"], "Prefers concise updates.");
    assert_eq!(enriched_shown["reconnectIntervalDays"], 14);

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
