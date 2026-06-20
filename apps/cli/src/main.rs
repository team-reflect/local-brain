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
mod output;
mod text;

use std::path::PathBuf;
use std::process::ExitCode;

use clap::{Parser, Subcommand};
use serde_json::json;

use commands::{
    add, graph as graph_cmd, parse_evidence_refs, parse_links, read, report, resolve_optional_text,
    resolve_text, source,
};
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
    /// Report environment and database health.
    Doctor,
    /// Print the machine-readable CLI contract for local agents.
    Contract,
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
    /// Show or set the user's own (self) person and known handles.
    #[command(name = "self")]
    SelfPerson {
        #[command(subcommand)]
        what: SelfCommand,
    },
    /// Link a person to an organization (employer affiliation).
    Affiliate(AffiliateArgs),
    /// Propose, list, accept, or dismiss curation suggestions.
    Suggest {
        #[command(subcommand)]
        what: SuggestCommand,
    },
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
    /// Today's brief: tasks and recent interactions.
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
    /// Records created/updated since a timestamp.
    Changes(ChangesArgs),
    /// One-call read-first context for an importing agent.
    ImportContext(ImportContextArgs),
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
    /// Add an organization.
    Organization(AddOrganizationArgs),
    /// Add a manually curated project.
    Project(AddProjectArgs),
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
    source: Option<String>,
    #[arg(long, default_value = "contact")]
    external_kind: String,
    #[arg(long)]
    external_id: Option<String>,
    #[arg(long)]
    original_url: Option<String>,
    #[arg(long)]
    allow_duplicate: bool,
    /// Employer organization name; find-or-creates the org and an affiliation.
    #[arg(long)]
    org: Option<String>,
    /// Employer email domain used to dedupe the org (e.g. evensendesign.com).
    #[arg(long)]
    org_domain: Option<String>,
    /// Job title for the employer affiliation.
    #[arg(long)]
    title: Option<String>,
    /// Affiliation role label.
    #[arg(long)]
    role: Option<String>,
    /// Mark this organization as the person's current employer.
    #[arg(long)]
    current: bool,
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
    #[arg(long)]
    headline: Option<String>,
    #[arg(long)]
    phone: Option<String>,
    #[arg(long)]
    location: Option<String>,
    /// Employer organization name; find-or-creates the org and an affiliation.
    #[arg(long)]
    org: Option<String>,
    /// Employer email domain used to dedupe the org.
    #[arg(long)]
    org_domain: Option<String>,
    /// Job title for the employer affiliation.
    #[arg(long)]
    title: Option<String>,
    /// Mark this organization as the person's current employer.
    #[arg(long)]
    current: bool,
}

#[derive(Parser)]
struct AddOrganizationArgs {
    #[arg(long)]
    name: String,
    #[arg(long)]
    kind: Option<String>,
    #[arg(long)]
    domain: Option<String>,
    #[arg(long)]
    location: Option<String>,
    #[arg(long)]
    summary: Option<String>,
    #[arg(long)]
    notes: Option<String>,
    #[arg(long)]
    source: Option<String>,
    #[arg(long, default_value = "record")]
    external_kind: String,
    #[arg(long)]
    external_id: Option<String>,
    #[arg(long)]
    original_url: Option<String>,
    #[arg(long)]
    allow_duplicate: bool,
}

#[derive(Parser)]
struct AffiliateArgs {
    #[arg(long)]
    person: String,
    #[arg(long)]
    org: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    role: Option<String>,
    #[arg(long)]
    current: bool,
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
    /// Interaction kind, e.g. note, meeting, call, email, message, event.
    #[arg(long, default_value = "note")]
    kind: String,
    /// Short display title.
    #[arg(long)]
    title: Option<String>,
    /// When the interaction/event starts or happened (ISO timestamp or YYYY-MM-DD).
    #[arg(long)]
    occurred_at: Option<String>,
    /// When the interaction/event ends (ISO timestamp or YYYY-MM-DD).
    #[arg(long)]
    ended_at: Option<String>,
    /// Venue, address, or meaningful location label.
    #[arg(long)]
    location: Option<String>,
    /// Upstream source slug, e.g. gmail, google_calendar, google_people.
    #[arg(long)]
    source: Option<String>,
    /// Upstream identity scope, e.g. record, message, thread, event.
    #[arg(long, default_value = "record")]
    external_kind: String,
    /// Stable upstream record id scoped to --source.
    #[arg(long)]
    external_id: Option<String>,
    /// Provider URL for the original record.
    #[arg(long)]
    original_url: Option<String>,
    /// Optional readable body text. Use --text-file for large bodies.
    #[arg(long)]
    summary: Option<String>,
    #[arg(long)]
    text: Option<String>,
    /// Optional file containing body text, or '-' to read stdin.
    #[arg(long, value_name = "PATH")]
    text_file: Option<PathBuf>,
    /// Typed link to an existing record, e.g. person:01ABC or project:01XYZ.
    #[arg(long = "link", value_name = "KIND:ID")]
    links: Vec<String>,
    /// Raw unresolved participant, e.g. attendee:Alice <alice@example.com>.
    #[arg(long = "participant", value_name = "ROLE:NAME <EMAIL>")]
    participants: Vec<String>,
    /// Participant row for the user's own self person, e.g. attendee:You <you@example.com>.
    #[arg(long = "self-participant", value_name = "ROLE:NAME <EMAIL>")]
    self_participants: Vec<String>,
    /// Force a new record even if content or external identity already matches.
    #[arg(long)]
    allow_duplicate: bool,
    /// Replace body text and regenerated chunks on a source-backed re-import.
    #[arg(long)]
    replace_body: bool,
    /// Re-digest the body only when it changed on a source-backed re-import (a
    /// no-op otherwise). Safe to pass on every daily-automation re-import.
    #[arg(long)]
    refresh: bool,
}

#[derive(Parser)]
struct AddProjectArgs {
    #[arg(long)]
    name: String,
    #[arg(long, default_value = "active")]
    status: String,
    #[arg(long)]
    kind: Option<String>,
    #[arg(long)]
    summary: Option<String>,
    #[arg(long)]
    notes: Option<String>,
    #[arg(long)]
    started_on: Option<String>,
    #[arg(long)]
    target_date: Option<String>,
    #[arg(long)]
    source: Option<String>,
    #[arg(long, default_value = "record")]
    external_kind: String,
    #[arg(long)]
    external_id: Option<String>,
    #[arg(long)]
    original_url: Option<String>,
    #[arg(long = "link", value_name = "KIND:ID")]
    links: Vec<String>,
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
    /// Source chunk evidence by index `interaction:01ABC#0` or by quote
    /// `interaction:01ABC~"a phrase from the chunk"`.
    #[arg(
        long = "evidence",
        value_name = "DOC_OR_INTERACTION:ID#CHUNK_OR_~QUOTE"
    )]
    evidence: Vec<String>,
    /// Person ID to assign this task to (repeatable; creates task_people row with role='assignee').
    #[arg(long, value_name = "PERSON_ID")]
    assignee: Vec<String>,
}

#[derive(Parser)]
struct RememberArgs {
    #[arg(long, default_value = "fact")]
    kind: String,
    #[arg(long)]
    claim: String,
    #[arg(long = "link", value_name = "KIND:ID")]
    links: Vec<String>,
    /// Source chunk evidence by index `interaction:01ABC#0` or by quote
    /// `interaction:01ABC~"a phrase from the chunk"`.
    #[arg(
        long = "evidence",
        value_name = "DOC_OR_INTERACTION:ID#CHUNK_OR_~QUOTE"
    )]
    evidence: Vec<String>,
}

#[derive(Parser)]
struct SearchArgs {
    query: String,
    #[arg(long, default_value_t = 20)]
    limit: usize,
}

#[derive(Parser)]
struct ChangesArgs {
    #[arg(long)]
    since: String,
    #[arg(long, default_value_t = 50)]
    limit: usize,
}

#[derive(Parser)]
struct ImportContextArgs {
    /// Max projects/organizations to list (compare against counts for the total).
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
enum SuggestCommand {
    /// Propose creating a new project (the importer must not auto-create one).
    Project(SuggestProjectArgs),
    /// Propose creating a new organization.
    Organization(SuggestOrgArgs),
    /// List suggestions (default: open).
    List(SuggestListArgs),
    /// Accept a suggestion: perform the typed write and relink cited records.
    Accept { id: String },
    /// Dismiss a suggestion (durable; it will not be re-raised).
    Dismiss { id: String },
}

#[derive(Parser)]
struct SuggestProjectArgs {
    /// Proposed project name.
    #[arg(long)]
    title: String,
    #[arg(long)]
    summary: Option<String>,
    #[arg(long)]
    rationale: Option<String>,
    /// Cited evidence record, e.g. `--link interaction:01ABC` (repeatable).
    #[arg(long = "link", value_name = "KIND:ID")]
    links: Vec<String>,
}

#[derive(Parser)]
struct SuggestOrgArgs {
    /// Proposed organization name.
    #[arg(long)]
    title: String,
    #[arg(long)]
    domain: Option<String>,
    #[arg(long)]
    kind: Option<String>,
    #[arg(long)]
    rationale: Option<String>,
    /// Cited evidence record, e.g. `--link person:01ABC` (repeatable).
    #[arg(long = "link", value_name = "KIND:ID")]
    links: Vec<String>,
}

#[derive(Parser)]
struct SuggestListArgs {
    /// open | accepted | dismissed | all
    #[arg(long, default_value = "open")]
    status: String,
}

#[derive(Subcommand)]
enum SelfCommand {
    /// Print the self person and registered handles.
    Show,
    /// Create or update the self person and known emails/phones.
    Set(SelfSetArgs),
}

#[derive(Parser)]
struct SelfSetArgs {
    #[arg(long)]
    full_name: Option<String>,
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
    let json = cli.json;
    match run(cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            if json {
                eprintln!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "ok": false,
                        "error": {
                            "kind": err.kind(),
                            "message": err.to_string(),
                            "exitCode": err.exit_code(),
                        }
                    }))
                    .unwrap_or_else(|_| err.to_string())
                );
            } else {
                diag(&err.to_string());
            }
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
        Command::Contract => contract(&storage, json),

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
                        source_slug: a.source.as_deref(),
                        external_kind: &a.external_kind,
                        external_id: a.external_id.as_deref(),
                        original_url: a.original_url.as_deref(),
                        allow_duplicate: a.allow_duplicate,
                        org: a.org.as_deref(),
                        org_domain: a.org_domain.as_deref(),
                        title: a.title.as_deref(),
                        role: a.role.as_deref(),
                        current: a.current,
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
                        headline: a.headline.as_deref(),
                        phone: a.phone.as_deref(),
                        location: a.location.as_deref(),
                        org: a.org.as_deref(),
                        org_domain: a.org_domain.as_deref(),
                        title: a.title.as_deref(),
                        current: a.current,
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
                        ended_at: a.ended_at.as_deref(),
                        location: a.location.as_deref(),
                        source_slug: a.source.as_deref(),
                        external_kind: &a.external_kind,
                        external_id: a.external_id.as_deref(),
                        original_url: a.original_url.as_deref(),
                        summary: a.summary.as_deref(),
                        body: resolve_optional_text(a.text.as_deref(), a.text_file.as_deref())?,
                        links: parse_links(&a.links)?,
                        raw_participants: a.participants.iter().map(String::as_str).collect(),
                        self_participants: a.self_participants.iter().map(String::as_str).collect(),
                        allow_duplicate: a.allow_duplicate,
                        replace_body: a.replace_body,
                        refresh: a.refresh,
                    },
                ),
                AddCommand::Organization(a) => add::add_organization(
                    &mut conn,
                    json,
                    add::AddOrganizationArgs {
                        name: &a.name,
                        kind: a.kind.as_deref(),
                        domain: a.domain.as_deref(),
                        location: a.location.as_deref(),
                        summary: a.summary.as_deref(),
                        notes: a.notes.as_deref(),
                        source_slug: a.source.as_deref(),
                        external_kind: &a.external_kind,
                        external_id: a.external_id.as_deref(),
                        original_url: a.original_url.as_deref(),
                        allow_duplicate: a.allow_duplicate,
                    },
                ),
                AddCommand::Project(a) => add::add_project(
                    &mut conn,
                    json,
                    add::AddProjectArgs {
                        name: &a.name,
                        status: &a.status,
                        kind: a.kind.as_deref(),
                        summary: a.summary.as_deref(),
                        notes: a.notes.as_deref(),
                        started_on: a.started_on.as_deref(),
                        target_date: a.target_date.as_deref(),
                        source_slug: a.source.as_deref(),
                        external_kind: &a.external_kind,
                        external_id: a.external_id.as_deref(),
                        original_url: a.original_url.as_deref(),
                        links: parse_links(&a.links)?,
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
                        evidence: parse_evidence_refs(&a.evidence)?,
                        assignee_ids: a.assignee.clone(),
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
                    evidence: parse_evidence_refs(&a.evidence)?,
                },
            )
        }
        Command::SelfPerson { what } => match what {
            SelfCommand::Show => {
                let conn = db::open_existing(&db_path)?;
                add::show_self(&conn, json)
            }
            SelfCommand::Set(a) => {
                let mut conn = db::open(&db_path)?;
                add::set_self(
                    &mut conn,
                    json,
                    add::SetSelfArgs {
                        full_name: a.full_name.as_deref(),
                        preferred_name: a.preferred_name.as_deref(),
                        emails: a.email.iter().map(String::as_str).collect(),
                        phones: a.phone.iter().map(String::as_str).collect(),
                        headline: a.headline.as_deref(),
                        location: a.location.as_deref(),
                    },
                )
            }
        },
        Command::Affiliate(a) => {
            let mut conn = db::open(&db_path)?;
            add::affiliate(
                &mut conn,
                json,
                add::AffiliateArgs {
                    person_id: &a.person,
                    organization_id: &a.org,
                    title: a.title.as_deref(),
                    role: a.role.as_deref(),
                    is_current: a.current,
                },
            )
        }
        Command::Suggest { what } => match what {
            SuggestCommand::Project(a) => {
                let mut conn = db::open(&db_path)?;
                add::suggest(
                    &mut conn,
                    json,
                    add::SuggestArgs {
                        kind: add::SuggestionKind::Project,
                        title: &a.title,
                        summary: a.summary.as_deref(),
                        domain: None,
                        org_kind: None,
                        rationale: a.rationale.as_deref(),
                        links: parse_links(&a.links)?,
                    },
                )
            }
            SuggestCommand::Organization(a) => {
                let mut conn = db::open(&db_path)?;
                add::suggest(
                    &mut conn,
                    json,
                    add::SuggestArgs {
                        kind: add::SuggestionKind::Organization,
                        title: &a.title,
                        summary: None,
                        domain: a.domain.as_deref(),
                        org_kind: a.kind.as_deref(),
                        rationale: a.rationale.as_deref(),
                        links: parse_links(&a.links)?,
                    },
                )
            }
            SuggestCommand::List(a) => {
                let conn = db::open_existing(&db_path)?;
                add::list_suggestions(&conn, json, &a.status)
            }
            SuggestCommand::Accept { id } => {
                let mut conn = db::open(&db_path)?;
                add::accept_suggestion(&mut conn, json, &id)
            }
            SuggestCommand::Dismiss { id } => {
                let mut conn = db::open(&db_path)?;
                add::dismiss_suggestion(&mut conn, json, &id)
            }
        },
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
        Command::Changes(a) => {
            let conn = db::open_existing(&db_path)?;
            report::changes(&conn, json, &a.since, a.limit)
        }
        Command::ImportContext(a) => {
            // A priming command: tolerate a brand-new brain (create + migrate like
            // `status`) so "run this first" works before any data exists.
            let conn = db::open(&db_path)?;
            report::import_context(&conn, json, a.limit)
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

/// `brain doctor` — environment and database health.
fn doctor(storage: &db::StoragePaths, json: bool) -> Result<(), CliError> {
    let db_path = &storage.database_path;
    let exists = db_path.is_file();
    let (schema_version, ok) = match db::open(db_path) {
        Ok(conn) => (db::schema_version(&conn).unwrap_or(-1), true),
        Err(_) => (-1, false),
    };
    if json {
        print_json(&json!({
            "brainRoot": storage.root_path.as_ref().map(|path| path.display().to_string()),
            "dbPath": db_path.display().to_string(),
            "assetsPath": storage.assets_path.as_ref().map(|path| path.display().to_string()),
            "dbExists": exists,
            "dbOk": ok,
            "schemaVersion": schema_version,
            "expectedSchemaVersion": brain_schema::LATEST_SCHEMA_VERSION,
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
        Ok(())
    }
}

/// `brain contract` — a compact, machine-readable guide for local agents.
fn contract(storage: &db::StoragePaths, _json: bool) -> Result<(), CliError> {
    print_json(&json!({
        "name": "brain",
        "version": env!("CARGO_PKG_VERSION"),
        "purpose": "Agent interface to a Local Brain SQLite database.",
        "paths": {
            "brainRoot": storage.root_path.as_ref().map(|path| path.display().to_string()),
            "dbPath": storage.database_path.display().to_string(),
            "assetsPath": storage.assets_path.as_ref().map(|path| path.display().to_string()),
        },
        "output": {
            "stdout": "data only",
            "stderr": "diagnostics and errors only",
            "json": "Pass global --json for stable camelCase JSON on stdout. With --json, command errors are JSON on stderr.",
        },
        "exitCodes": [
            { "code": 0, "kind": "ok", "meaning": "success" },
            { "code": 1, "kind": "runtime", "meaning": "validation, SQL, IO, or unsupported operation failure" },
            { "code": 3, "kind": "not_found", "meaning": "requested record was not found" },
            { "code": 4, "kind": "no_database", "meaning": "database is missing or unusable" },
        ],
        "recordKinds": [
            "person",
            "organization",
            "project",
            "task",
            "document",
            "interaction",
            "asset",
            "memory",
        ],
        "linkSyntax": {
            "format": "kind:id",
            "acceptedKinds": ["person", "organization", "org", "project", "task", "document", "doc", "interaction"],
            "examples": ["person:01ABC", "project:01XYZ", "task:01TODO"],
        },
        "sources": {
            "builtInSlugs": [
                "manual",
                "agent",
                "file",
                "gmail",
                "google_people",
                "google_calendar",
                "google_meet",
                "zoom",
                "ai_extraction",
            ],
            "identityRule": "Use --source plus --external-id for idempotent provider imports. External ids are source-scoped.",
        },
        "writeRules": [
            "Search before writing likely duplicates.",
            "Prefer typed fields over burying structure in notes/body text.",
            "Reuse and link existing people, organizations, projects, and tasks when possible.",
            "Projects are manually curated user structure: importers may link existing projects, but must not auto-create projects from source topics.",
            "Preserve provider provenance with --source, --external-id, and --original-url.",
            "Do not create people for every raw sender or attendee; preserve unresolved handles with --participant.",
            "Use --text-file or --text-file - for large text bodies; structured calendar events may omit body text.",
        ],
        "commands": {
            "status": {
                "usage": "brain --json status",
                "returns": "database path, existence, and schema version",
            },
            "doctor": {
                "usage": "brain --json doctor",
                "returns": "database health and expected schema version",
            },
            "search": {
                "usage": "brain --json search <query> --limit 20",
                "returns": "ranked records with kind, id, title, snippet, and score",
            },
            "show": {
                "usage": "brain --json show <person|organization|project|task> <id>",
                "returns": "core typed fields for one visible record",
            },
            "addPerson": {
                "usage": "brain --json add person --full-name <name> [--email <email>...] [--phone <phone>...] [--source <slug> --external-id <id>]",
                "dedupe": "external identity, then email handle, then normalized name",
            },
            "addPersonFromEmail": {
                "usage": "brain --json add person-from-email --full-name <display> --email <email> --source gmail --external-id <message-id>",
                "purpose": "Safely create people from untrusted sender/display-name pairs; machine senders are skipped with reasonCodes.",
            },
            "addDocument": {
                "usage": "brain --json add document --title <title> (--text <text>|--text-file <path|->) [--link kind:id...]",
                "useFor": ["reference notes", "PDF text", "webpages", "receipts", "long-form material"],
            },
            "addInteraction": {
                "usage": "brain --json add interaction --kind <kind> --title <title> [--text <text>|--text-file <path|->] [--occurred-at <iso>] [--ended-at <iso>] [--location <label>] [--source <slug> --external-id <id>] [--original-url <url>] [--participant 'role:Name <email>'...] [--self-participant 'role:Name <email>'...] [--link kind:id...] [--replace-body|--refresh]",
                "kinds": ["note", "meeting", "call", "email", "message", "event"],
                "bodyText": "Optional for structured calendar events; title or body text is still required.",
                "freshness": "On a source-backed re-import (e.g. a Gmail thread digest), a matched record returns bodyChanged:true when the upstream body differs from the stored one. Pass --refresh to re-digest only when it changed (a no-op otherwise), or --replace-body to always re-chunk.",
                "kindGuidance": "Use event for travel, lodging, reservations, reminders, and all-day schedule blocks even if they have attendees. Use meeting for people-centered appointments.",
                "calendarMapping": {
                    "start": "--occurred-at",
                    "end": "--ended-at",
                    "venueOrAddress": "--location",
                    "providerUrl": "--original-url",
                    "attendees": "--participant",
                    "selfAttendees": "--self-participant",
                    "knownPeople": "--link person:<id> or matching participant email",
                    "notes": "Only source-specific leftovers that do not have typed fields.",
                },
            },
            "addAsset": {
                "usage": "brain --json add asset --file <path> --link <kind:id> [--role attachment|avatar|logo|screenshot|source_file]",
                "purpose": "Copy bytes into the managed assets directory and link them to a typed record.",
            },
            "addOrganization": {
                "usage": "brain --json add organization --name <name> [--domain <domain>] [--kind <kind>] [--location <loc>] [--source <slug> --external-id <id>]",
                "dedupe": "external identity, then normalized name, then normalized domain (www-stripped)",
            },
            "addPersonAffiliation": {
                "usage": "brain --json add person --full-name <name> --org <org-name> [--org-domain <domain>] [--title <title>] [--current]",
                "purpose": "On person create/enrich, find-or-create the employer org and upsert an affiliation. --current marks the single current employer and sets people.current_organization_id. person-from-email accepts the same --org/--org-domain/--title/--current plus --headline/--phone/--location.",
            },
            "affiliate": {
                "usage": "brain --json affiliate --person <person-id> --org <org-id> [--title <title>] [--role <role>] [--current]",
                "purpose": "Link an existing person to an existing organization; deduped by (person, org).",
            },
            "suggest": {
                "usage": "brain --json suggest project --title <name> [--rationale <r>] [--link interaction:<id>...] | suggest organization --title <name> [--domain <d>] | suggest list [--status open] | suggest accept <id> | suggest dismiss <id>",
                "purpose": "Durable curation queue for structure the importer must not auto-create (a new project or organization). Accepting performs the typed write and relinks the cited records; dismissals persist so a proposal is never re-raised. Use this instead of auto-creating projects/orgs from inferred source topics.",
                "kinds": ["create_project", "create_organization"],
            },
            "addTask": {
                "usage": "brain --json add task --title <title> [--due-at <iso>] [--link kind:id...] [--assignee <person-id>...]",
                "assigneeFlag": "Use --assignee <person-id> (repeatable) to mark someone as responsible for the task. Creates a task_people row with role='assignee'. Distinct from generic --link person:<id> which creates a generic person link.",
            },
            "remember": {
                "usage": "brain --json remember --kind <fact|preference|decision|commitment|instruction|risk|idea> --claim <atomic claim> --link kind:id... [--evidence interaction:<id>#<chunk>|interaction:<id>~\"quote\"]",
                "rule": "Memories should be atomic and linked to visible evidence records.",
                "evidence": "Cite a chunk by index (#0) or by a quote substring (~\"a phrase\") resolved against the record's chunks at write time, so you need not know chunk boundaries. Works for `remember` and `add task`.",
            },
            "self": {
                "usage": "brain --json self show | brain --json self set --full-name <name> [--email <email>...] [--phone <phone>...]",
                "purpose": "Show or set the single is_self person and its known handles. Registered emails/phones auto-resolve the user as an interaction participant without --self-participant.",
            },
            "today": {
                "usage": "brain --json today",
                "returns": "tasks, recentInteractions, and counts",
            },
            "tasksPlanDay": {
                "usage": "brain --json tasks plan-day --limit 25",
                "returns": "prioritized open task list",
            },
            "changes": {
                "usage": "brain --json changes --since <iso> --limit 50",
                "returns": "recently updated visible records",
            },
            "importContext": {
                "usage": "brain --json import-context [--limit 50]",
                "returns": "one-call read-first context for an import: self (with `configured` flag), sources, existing projects and organizations to link (capped by --limit), openSuggestions, per-source import watermarks (imports[].latestAt), and counts",
                "use": "Run this first when importing. Honors query-before-write: link existing projects/orgs instead of forking, skip re-proposing open suggestions, and resume incrementally from imports[].latestAt.",
            },
            "graph": {
                "usage": "brain --json graph --center self",
                "returns": "typed user-centered graph nodes and edges",
            },
        },
        "examples": [
            {
                "name": "calendarEvent",
                "command": "brain --json add interaction --kind event --title 'Calendar: Stay at Louma' --occurred-at 2026-07-09 --ended-at 2026-07-12 --location 'Louma Country Shepherds Hut' --source google_calendar --external-id 3p20rd --original-url 'https://www.google.com/calendar/event?eid=...' --participant 'organizer:Alice Wyatt <alice@example.com>' --self-participant 'attendee:You <alex@example.com>'",
            },
            {
                "name": "email",
                "command": "brain --json add interaction --kind email --title 'Email from Maya' --occurred-at 2026-06-19T10:00:00Z --source gmail --external-id msg-123 --participant 'from:Maya Chen <maya@example.com>' --text-file body.txt",
            },
            {
                "name": "dailyAutomation",
                "commands": [
                    "brain --json today",
                    "brain --json tasks plan-day --limit 25",
                ],
            },
        ],
    }))
}
