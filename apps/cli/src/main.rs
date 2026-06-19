//! The `brain` CLI — the supported agent interface to a Local Brain database.
//!
//! It opens the SQLite file directly via the shared `brain-schema` crate (no
//! Tauri IPC), so it runs with the desktop app closed and always at the same
//! migration version. Conventions: **data on stdout, diagnostics on stderr**,
//! `--json` for stable camelCase machine output, and typed exit codes (see
//! `error::CliError`).

mod commands;
mod db;
mod error;
mod id;
mod model;
mod output;
mod text;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use serde_json::json;

use commands::{add, graph as graph_cmd, parse_links, read, report, resolve_text, source};
use error::CliError;
use output::{diag, print_json};

#[derive(Parser)]
#[command(
    name = "brain",
    version,
    about = "Agent interface to a Local Brain database"
)]
struct Cli {
    /// Path to a brain folder (uses <DIR>/brain.sqlite; overrides $BRAIN_ROOT).
    #[arg(long, global = true, value_name = "DIR", conflicts_with = "db")]
    brain: Option<PathBuf>,

    /// Path to the brain database (overrides $BRAIN_DB and the default location).
    #[arg(long, global = true, value_name = "PATH")]
    db: Option<PathBuf>,

    /// Emit JSON on stdout instead of human-readable text.
    #[arg(long, global = true)]
    json: bool,

    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Print the resolved database path and schema status.
    Status,
    /// Print the resolved database path only.
    Path,
    /// Report environment, database, and model-boundary health.
    Doctor,
    /// Add a record (person, asset, document, interaction, or task).
    Add {
        // Boxed because the `add` subcommands carry by far the largest argument
        // structs; without indirection the whole `Command` enum is sized to them
        // (clippy::large_enum_variant).
        #[command(subcommand)]
        what: Box<AddCommand>,
    },
    /// Add a hidden memory (atomic claim) with provenance links.
    Remember(RememberArgs),
    /// Manage upstream source identities for imports.
    Source {
        #[command(subcommand)]
        what: SourceCommand,
    },
    /// Manage existing assets.
    Asset {
        #[command(subcommand)]
        what: AssetCommand,
    },
    /// Full-text search across your records.
    Search(SearchArgs),
    /// Ask a grounded, cited question.
    Ask(AskArgs),
    /// Today's brief: tasks, recent interactions, reconnects.
    Today,
    /// Generate a report.
    Report {
        #[command(subcommand)]
        what: ReportCommand,
    },
    /// Task planning helpers.
    Tasks {
        #[command(subcommand)]
        what: TasksCommand,
    },
    /// Relationship helpers.
    Relationships {
        #[command(subcommand)]
        what: RelCommand,
    },
    /// Records created/updated since a timestamp.
    Changes(ChangesArgs),
    /// The user-centered knowledge graph as JSON.
    Graph(GraphArgs),
    /// Show a record by kind and id.
    Show {
        /// person | organization | project | task
        kind: String,
        id: String,
    },
}

#[derive(Subcommand)]
enum AddCommand {
    /// Add a person.
    Person(AddPersonArgs),
    /// Safely add a person from an untrusted email/display-name pair.
    PersonFromEmail(AddPersonFromEmailArgs),
    /// Add a binary asset file.
    Asset(AddAssetArgs),
    /// Add a reference document.
    Document(AddDocumentArgs),
    /// Add a human interaction (meeting, call, note, …).
    Interaction(AddInteractionArgs),
    /// Add a task.
    Task(AddTaskArgs),
}

#[derive(Parser)]
struct AddPersonArgs {
    #[arg(long)]
    full_name: String,
    #[arg(long)]
    preferred_name: Option<String>,
    #[arg(long)]
    email: Vec<String>,
    #[arg(long)]
    phone: Vec<String>,
    #[arg(long)]
    headline: Option<String>,
    #[arg(long)]
    location: Option<String>,
    #[arg(long)]
    summary: Option<String>,
    #[arg(long)]
    notes: Option<String>,
    #[arg(long)]
    reconnect_interval_days: Option<i64>,
    #[arg(long)]
    source: Option<String>,
    #[arg(long, default_value = "contact")]
    external_kind: String,
    #[arg(long)]
    external_id: Option<String>,
    #[arg(long)]
    original_url: Option<String>,
    #[arg(long)]
    allow_duplicate: bool,
}

#[derive(Parser)]
struct AddPersonFromEmailArgs {
    #[arg(long)]
    full_name: String,
    #[arg(long)]
    email: String,
    #[arg(long)]
    source: Option<String>,
    #[arg(long)]
    external_id: Option<String>,
}

#[derive(Parser)]
struct AddAssetArgs {
    #[arg(long, value_name = "PATH")]
    file: PathBuf,
    #[arg(long, default_value = "attachment")]
    kind: String,
    #[arg(long)]
    mime_type: Option<String>,
    #[arg(long)]
    original_filename: Option<String>,
    #[arg(long)]
    original_url: Option<String>,
    #[arg(long)]
    text: Option<String>,
    #[arg(long, value_name = "PATH")]
    text_file: Option<PathBuf>,
    #[arg(long, default_value = "manual")]
    text_source: String,
    #[arg(long, default_value = "attachment")]
    role: String,
    #[arg(long)]
    caption: Option<String>,
    #[arg(long = "link", value_name = "KIND:ID")]
    links: Vec<String>,
    #[arg(long)]
    allow_duplicate: bool,
}

#[derive(Parser)]
struct AddDocumentArgs {
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    kind: Option<String>,
    #[arg(long)]
    text: Option<String>,
    #[arg(long, value_name = "PATH")]
    text_file: Option<PathBuf>,
    /// Link to a record, e.g. `--link person:01ABC` (repeatable).
    #[arg(long = "link", value_name = "KIND:ID")]
    links: Vec<String>,
    #[arg(long)]
    allow_duplicate: bool,
}

#[derive(Parser)]
struct AddInteractionArgs {
    #[arg(long, default_value = "note")]
    kind: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    occurred_at: Option<String>,
    #[arg(long)]
    source: Option<String>,
    #[arg(long)]
    external_id: Option<String>,
    #[arg(long)]
    original_url: Option<String>,
    #[arg(long)]
    text: Option<String>,
    #[arg(long, value_name = "PATH")]
    text_file: Option<PathBuf>,
    #[arg(long = "link", value_name = "KIND:ID")]
    links: Vec<String>,
    #[arg(long = "participant", value_name = "ROLE:NAME <EMAIL>")]
    participants: Vec<String>,
    #[arg(long)]
    allow_duplicate: bool,
}

#[derive(Parser)]
struct AddTaskArgs {
    #[arg(long)]
    title: String,
    #[arg(long, default_value = "open")]
    status: String,
    #[arg(long)]
    due_at: Option<String>,
    #[arg(long = "link", value_name = "KIND:ID")]
    links: Vec<String>,
}

#[derive(Parser)]
struct RememberArgs {
    #[arg(long, default_value = "fact")]
    kind: String,
    #[arg(long)]
    claim: String,
    #[arg(long = "link", value_name = "KIND:ID")]
    links: Vec<String>,
}

#[derive(Parser)]
struct SearchArgs {
    query: String,
    #[arg(long, default_value_t = 20)]
    limit: usize,
}

#[derive(Parser)]
struct AskArgs {
    question: String,
    #[arg(long, default_value_t = 8)]
    limit: usize,
    /// Skip the model call; return retrieved evidence only.
    #[arg(long)]
    no_model: bool,
}

#[derive(Parser)]
struct ChangesArgs {
    #[arg(long)]
    since: String,
    #[arg(long, default_value_t = 50)]
    limit: usize,
}

#[derive(Parser)]
struct GraphArgs {
    /// Currently only `self` is supported.
    #[arg(long, default_value = "self")]
    center: String,
}

#[derive(Subcommand)]
enum ReportCommand {
    /// The daily report.
    Daily,
}

#[derive(Subcommand)]
enum TasksCommand {
    /// A prioritized todo list for the day.
    PlanDay {
        #[arg(long, default_value_t = 25)]
        limit: usize,
    },
}

#[derive(Subcommand)]
enum RelCommand {
    /// People due (or overdue) for a reconnect.
    Followups,
}

#[derive(Subcommand)]
enum SourceCommand {
    /// Ensure an upstream source exists.
    Ensure(EnsureSourceArgs),
}

#[derive(Subcommand)]
enum AssetCommand {
    /// Manage searchable text for an existing asset.
    Text {
        #[command(subcommand)]
        what: AssetTextCommand,
    },
}

#[derive(Subcommand)]
enum AssetTextCommand {
    /// Set or replace searchable text for an existing asset.
    Set(AssetTextSetArgs),
}

#[derive(Parser)]
struct AssetTextSetArgs {
    asset_id: String,
    #[arg(long)]
    text: Option<String>,
    #[arg(long, value_name = "PATH")]
    text_file: Option<PathBuf>,
    #[arg(long, default_value = "manual")]
    source: String,
}

#[derive(Parser)]
struct EnsureSourceArgs {
    #[arg(long)]
    slug: String,
    #[arg(long)]
    name: String,
    #[arg(long)]
    description: Option<String>,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            diag(&err.to_string());
            ExitCode::from(err.exit_code())
        }
    }
}

fn run(cli: Cli) -> Result<(), CliError> {
    let storage = db::resolve_storage(cli.brain.as_deref(), cli.db.as_deref())?;
    let db_path = storage.database_path.clone();
    let json = cli.json;

    match cli.command {
        Command::Path => {
            if json {
                print_json(&json!({
                    "brainRoot": storage.root_path.as_ref().map(|path| path.display().to_string()),
                    "dbPath": db_path.display().to_string(),
                    "assetsPath": storage.assets_path.as_ref().map(|path| path.display().to_string()),
                }))
            } else {
                println!("{}", db_path.display());
                Ok(())
            }
        }
        Command::Status => {
            let exists = db_path.is_file();
            let conn = db::open(&db_path)?;
            let version = db::schema_version(&conn)?;
            if json {
                print_json(&json!({
                    "brainRoot": storage.root_path.as_ref().map(|path| path.display().to_string()),
                    "dbPath": db_path.display().to_string(),
                    "assetsPath": storage.assets_path.as_ref().map(|path| path.display().to_string()),
                    "exists": exists,
                    "schemaVersion": version,
                }))
            } else {
                diag(&format!("database: {}", db_path.display()));
                println!("ok schema v{version}");
                Ok(())
            }
        }
        Command::Doctor => doctor(&storage, json),

        Command::Add { what } => {
            let mut conn = db::open(&db_path)?;
            match *what {
                AddCommand::Person(a) => add::add_person(
                    &mut conn,
                    json,
                    add::AddPersonArgs {
                        full_name: &a.full_name,
                        preferred_name: a.preferred_name.as_deref(),
                        emails: a.email.iter().map(String::as_str).collect(),
                        phones: a.phone.iter().map(String::as_str).collect(),
                        headline: a.headline.as_deref(),
                        location: a.location.as_deref(),
                        summary: a.summary.as_deref(),
                        notes: a.notes.as_deref(),
                        reconnect_interval_days: a.reconnect_interval_days,
                        source_slug: a.source.as_deref(),
                        external_kind: &a.external_kind,
                        external_id: a.external_id.as_deref(),
                        original_url: a.original_url.as_deref(),
                        allow_duplicate: a.allow_duplicate,
                    },
                ),
                AddCommand::PersonFromEmail(a) => add::add_person_from_email(
                    &mut conn,
                    json,
                    add::AddPersonFromEmailArgs {
                        full_name: &a.full_name,
                        email: &a.email,
                        source_slug: a.source.as_deref(),
                        external_id: a.external_id.as_deref(),
                    },
                ),
                AddCommand::Asset(a) => add::add_asset(
                    &mut conn,
                    storage.assets_path.as_deref(),
                    json,
                    add::AddAssetArgs {
                        file: &a.file,
                        kind: &a.kind,
                        mime_type: a.mime_type.as_deref(),
                        original_filename: a.original_filename.as_deref(),
                        original_url: a.original_url.as_deref(),
                        text: resolve_optional_text(a.text.as_deref(), a.text_file.as_deref())?,
                        text_source: &a.text_source,
                        role: &a.role,
                        caption: a.caption.as_deref(),
                        links: parse_links(&a.links)?,
                        allow_duplicate: a.allow_duplicate,
                    },
                ),
                AddCommand::Document(a) => add::add_document(
                    &mut conn,
                    json,
                    add::AddDocumentArgs {
                        title: a.title.as_deref(),
                        kind: a.kind.as_deref(),
                        body: resolve_text(a.text.as_deref(), a.text_file.as_deref())?,
                        links: parse_links(&a.links)?,
                        allow_duplicate: a.allow_duplicate,
                    },
                ),
                AddCommand::Interaction(a) => add::add_interaction(
                    &mut conn,
                    json,
                    add::AddInteractionArgs {
                        title: a.title.as_deref(),
                        kind: &a.kind,
                        occurred_at: a.occurred_at.as_deref(),
                        source_slug: a.source.as_deref(),
                        external_id: a.external_id.as_deref(),
                        original_url: a.original_url.as_deref(),
                        body: resolve_text(a.text.as_deref(), a.text_file.as_deref())?,
                        links: parse_links(&a.links)?,
                        raw_participants: a.participants.iter().map(String::as_str).collect(),
                        allow_duplicate: a.allow_duplicate,
                    },
                ),
                AddCommand::Task(a) => add::add_task(
                    &mut conn,
                    json,
                    add::AddTaskArgs {
                        title: &a.title,
                        status: &a.status,
                        due_at: a.due_at.as_deref(),
                        project_id: None,
                        links: parse_links(&a.links)?,
                    },
                ),
            }
        }
        Command::Asset { what } => {
            let mut conn = db::open(&db_path)?;
            match what {
                AssetCommand::Text { what } => match what {
                    AssetTextCommand::Set(a) => add::set_asset_text(
                        &mut conn,
                        json,
                        &a.asset_id,
                        &resolve_text(a.text.as_deref(), a.text_file.as_deref())?,
                        &a.source,
                    ),
                },
            }
        }
        Command::Remember(a) => {
            let mut conn = db::open(&db_path)?;
            add::remember(
                &mut conn,
                json,
                add::RememberArgs {
                    kind: &a.kind,
                    claim: &a.claim,
                    links: parse_links(&a.links)?,
                },
            )
        }
        Command::Source { what } => {
            let mut conn = db::open(&db_path)?;
            match what {
                SourceCommand::Ensure(a) => source::ensure(
                    &mut conn,
                    json,
                    source::EnsureSourceArgs {
                        slug: &a.slug,
                        name: &a.name,
                        description: a.description.as_deref(),
                    },
                ),
            }
        }

        Command::Search(a) => {
            let conn = db::open_existing(&db_path)?;
            read::search(&conn, json, &a.query, a.limit)
        }
        Command::Ask(a) => {
            let mut conn = db::open_existing(&db_path)?;
            read::ask(&mut conn, json, &a.question, a.limit, a.no_model)
        }
        Command::Show { kind, id } => {
            let conn = db::open_existing(&db_path)?;
            read::show(&conn, json, &kind, &id)
        }

        Command::Today => {
            let conn = db::open_existing(&db_path)?;
            report::today_brief(&conn, json)
        }
        Command::Report { what } => {
            let conn = db::open_existing(&db_path)?;
            match what {
                ReportCommand::Daily => report::report_daily(&conn, json),
            }
        }
        Command::Tasks { what } => {
            let conn = db::open_existing(&db_path)?;
            match what {
                TasksCommand::PlanDay { limit } => report::plan_day(&conn, json, limit),
            }
        }
        Command::Relationships { what } => {
            let conn = db::open_existing(&db_path)?;
            match what {
                RelCommand::Followups => report::followups(&conn, json),
            }
        }
        Command::Changes(a) => {
            let conn = db::open_existing(&db_path)?;
            report::changes(&conn, json, &a.since, a.limit)
        }
        Command::Graph(a) => {
            if a.center != "self" {
                return Err(CliError::Runtime(format!(
                    "unsupported --center '{}' (only 'self')",
                    a.center
                )));
            }
            let conn = db::open_existing(&db_path)?;
            graph_cmd::graph(&conn, json)
        }
    }
}

fn resolve_optional_text(
    text: Option<&str>,
    text_file: Option<&std::path::Path>,
) -> Result<Option<String>, CliError> {
    match (text, text_file) {
        (None, None) => Ok(None),
        _ => resolve_text(text, text_file).map(Some),
    }
}

/// `brain doctor` — environment, database, and model-boundary health.
fn doctor(storage: &db::StoragePaths, json: bool) -> Result<(), CliError> {
    let db_path = &storage.database_path;
    let exists = db_path.is_file();
    let (schema_version, ok) = match db::open(db_path) {
        Ok(conn) => (db::schema_version(&conn).unwrap_or(-1), true),
        Err(_) => (-1, false),
    };
    let model_configured = std::env::var("ANTHROPIC_API_KEY")
        .map(|k| !k.trim().is_empty())
        .unwrap_or(false);
    let curl = std::process::Command::new("curl")
        .arg("--version")
        .output()
        .is_ok();

    if json {
        print_json(&json!({
            "brainRoot": storage.root_path.as_ref().map(|path| path.display().to_string()),
            "dbPath": db_path.display().to_string(),
            "assetsPath": storage.assets_path.as_ref().map(|path| path.display().to_string()),
            "dbExists": exists,
            "dbOk": ok,
            "schemaVersion": schema_version,
            "expectedSchemaVersion": brain_schema::LATEST_SCHEMA_VERSION,
            "modelConfigured": model_configured,
            "curlAvailable": curl,
        }))
    } else {
        diag(&format!(
            "database: {} ({})",
            db_path.display(),
            if exists { "exists" } else { "absent" }
        ));
        println!(
            "schema: v{schema_version} (expected v{})",
            brain_schema::LATEST_SCHEMA_VERSION
        );
        println!(
            "model: {}",
            if model_configured {
                "configured (ANTHROPIC_API_KEY)"
            } else {
                "not configured"
            }
        );
        println!("curl: {}", if curl { "available" } else { "missing" });
        Ok(())
    }
}
