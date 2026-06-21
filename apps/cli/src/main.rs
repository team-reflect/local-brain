#![recursion_limit = "256"]

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
    /// Source-led import phases and completeness checks.
    Import {
        #[command(subcommand)]
        what: Box<ImportCommand>,
    },
    /// Enrich an existing person or organization profile.
    Enrich {
        #[command(subcommand)]
        what: Box<EnrichCommand>,
    },
    /// Add a hidden memory (atomic claim) with provenance links.
    Remember(RememberArgs),
    /// Promote an extracted fact into a curated hidden memory.
    Promote {
        #[command(subcommand)]
        what: PromoteCommand,
    },
    /// Ensure or attach tags to typed records.
    Tag {
        #[command(subcommand)]
        what: TagCommand,
    },
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
    /// Add a narrative AI artifact tied to one record.
    #[command(name = "ai-note")]
    AiNote(AddAiNoteArgs),
    /// Add an append-only extracted fact.
    Fact(AddFactArgs),
}

#[derive(Subcommand)]
enum ImportCommand {
    /// Import a provider-neutral interaction.
    Interaction(AddInteractionArgs),
    /// Import a provider-neutral document.
    Document(AddDocumentArgs),
    /// Import or replace a raw transcript for an interaction.
    Transcript(AddTranscriptArgs),
    /// Report incomplete document/interaction imports.
    Audit(ImportAuditArgs),
    /// Check whether one imported record has met the completion rule.
    Finalize(ImportFinalizeArgs),
}

#[derive(Subcommand)]
enum EnrichCommand {
    /// Enrich a person profile.
    Person(EnrichPersonArgs),
    /// Enrich an organization and optionally write an organization profile.
    Organization(EnrichOrganizationArgs),
}

#[derive(Subcommand)]
enum PromoteCommand {
    /// Promote an extracted fact into a memory.
    Fact(PromoteFactArgs),
}

#[derive(Subcommand)]
enum TagCommand {
    /// Ensure a tag exists.
    Ensure(TagEnsureArgs),
    /// Attach an existing tag to a record.
    Attach(TagAttachArgs),
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
    headline: Option<String>,
    #[arg(long)]
    location: Option<String>,
    #[arg(long)]
    summary: Option<String>,
    #[arg(long)]
    website: Option<String>,
    #[arg(long)]
    industry: Option<String>,
    #[arg(long)]
    hq_city: Option<String>,
    #[arg(long)]
    hq_region: Option<String>,
    #[arg(long)]
    hq_country: Option<String>,
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
    department: Option<String>,
    #[arg(long)]
    role: Option<String>,
    #[arg(long)]
    role_family: Option<String>,
    #[arg(long)]
    seniority: Option<String>,
    #[arg(long)]
    current: bool,
    #[arg(long)]
    primary: bool,
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
    source: Option<String>,
    #[arg(long, default_value = "record")]
    external_kind: String,
    #[arg(long)]
    external_id: Option<String>,
    #[arg(long)]
    original_path: Option<String>,
    #[arg(long)]
    original_url: Option<String>,
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
    #[arg(long = "evidence", value_name = "RECORD_TYPE:ID#CHUNK_OR_~QUOTE")]
    evidence: Vec<String>,
    /// Person ID to assign this task to (repeatable; creates task_people row with role='assignee').
    #[arg(long, value_name = "PERSON_ID")]
    assignee: Vec<String>,
}

#[derive(Parser)]
struct AddTranscriptArgs {
    #[arg(long)]
    interaction: String,
    #[arg(long)]
    text: Option<String>,
    #[arg(long, value_name = "PATH")]
    text_file: Option<PathBuf>,
    #[arg(long, default_value = "plain_text")]
    format: String,
    #[arg(long)]
    language: Option<String>,
    #[arg(long)]
    segments_json: Option<String>,
    #[arg(long)]
    recording_url: Option<String>,
    #[arg(long)]
    storage_path: Option<String>,
    #[arg(long)]
    source: Option<String>,
    #[arg(long, default_value = "transcript")]
    external_kind: String,
    #[arg(long)]
    external_id: Option<String>,
    #[arg(long)]
    transcribed_by: Option<String>,
    #[arg(long)]
    transcribed_at: Option<String>,
    #[arg(long)]
    metadata_json: Option<String>,
}

#[derive(Parser)]
struct AddAiNoteArgs {
    #[arg(long, default_value = "summary")]
    kind: String,
    #[arg(long)]
    interaction: Option<String>,
    #[arg(long)]
    document: Option<String>,
    #[arg(long, value_name = "KIND:ID")]
    subject: Option<String>,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    text: Option<String>,
    #[arg(long, value_name = "PATH")]
    text_file: Option<PathBuf>,
    #[arg(long, default_value = "markdown")]
    content_format: String,
    #[arg(long)]
    model: Option<String>,
    #[arg(long)]
    prompt_fingerprint: Option<String>,
    #[arg(long)]
    source: Option<String>,
    #[arg(long)]
    metadata_json: Option<String>,
    #[arg(long = "evidence", value_name = "RECORD_TYPE:ID#CHUNK_OR_~QUOTE")]
    evidence: Vec<String>,
}

#[derive(Parser)]
struct AddFactArgs {
    #[arg(long, value_name = "KIND:ID")]
    subject: String,
    #[arg(long)]
    key: String,
    #[arg(long)]
    value_text: Option<String>,
    #[arg(long)]
    value_json: Option<String>,
    #[arg(long)]
    confidence: Option<f64>,
    #[arg(long, value_name = "KIND:ID")]
    source_record: Option<String>,
    #[arg(long)]
    source_excerpt: Option<String>,
    #[arg(long)]
    observed_at: Option<String>,
    #[arg(long)]
    model: Option<String>,
    #[arg(long)]
    prompt_fingerprint: Option<String>,
    #[arg(long)]
    metadata_json: Option<String>,
    #[arg(long = "evidence", value_name = "RECORD_TYPE:ID#CHUNK_OR_~QUOTE")]
    evidence: Vec<String>,
}

#[derive(Parser)]
struct EnrichPersonArgs {
    id: String,
    #[arg(long)]
    preferred_name: Option<String>,
    #[arg(long)]
    headline: Option<String>,
    #[arg(long)]
    summary: Option<String>,
    #[arg(long)]
    location: Option<String>,
    #[arg(long)]
    city: Option<String>,
    #[arg(long)]
    region: Option<String>,
    #[arg(long)]
    country: Option<String>,
    #[arg(long)]
    timezone: Option<String>,
    #[arg(long)]
    linkedin_url: Option<String>,
    #[arg(long)]
    website: Option<String>,
    #[arg(long)]
    important_dates_json: Option<String>,
    #[arg(long)]
    current_title: Option<String>,
    #[arg(long)]
    current_department: Option<String>,
    #[arg(long)]
    role_family: Option<String>,
    #[arg(long)]
    seniority: Option<String>,
    #[arg(long)]
    notes: Option<String>,
}

#[derive(Parser)]
struct EnrichOrganizationArgs {
    id: String,
    #[arg(long)]
    kind: Option<String>,
    #[arg(long)]
    domain: Option<String>,
    #[arg(long)]
    headline: Option<String>,
    #[arg(long)]
    summary: Option<String>,
    #[arg(long)]
    website: Option<String>,
    #[arg(long)]
    industry: Option<String>,
    #[arg(long)]
    location: Option<String>,
    #[arg(long)]
    hq_city: Option<String>,
    #[arg(long)]
    hq_region: Option<String>,
    #[arg(long)]
    hq_country: Option<String>,
    #[arg(long)]
    notes: Option<String>,
    #[arg(long)]
    model: Option<String>,
    #[arg(long)]
    prompt_fingerprint: Option<String>,
    #[arg(long)]
    canonical_name: Option<String>,
    #[arg(long)]
    one_line_description: Option<String>,
    #[arg(long)]
    category: Option<String>,
    #[arg(long)]
    why_it_matters: Option<String>,
    #[arg(long)]
    offerings_json: Option<String>,
    #[arg(long)]
    notable_people_json: Option<String>,
    #[arg(long)]
    suggested_tags_json: Option<String>,
    #[arg(long)]
    review_flags_json: Option<String>,
    #[arg(long)]
    source_urls_json: Option<String>,
    #[arg(long)]
    raw_enrichment_json: Option<String>,
    #[arg(long)]
    source: Option<String>,
}

#[derive(Parser)]
struct PromoteFactArgs {
    id: String,
    #[arg(long, default_value = "fact")]
    memory_kind: String,
}

#[derive(Parser)]
struct TagEnsureArgs {
    #[arg(long)]
    name: String,
    #[arg(long)]
    slug: Option<String>,
    #[arg(long)]
    color: Option<String>,
    #[arg(long)]
    description: Option<String>,
}

#[derive(Parser)]
struct TagAttachArgs {
    #[arg(long)]
    tag: String,
    #[arg(long, value_name = "KIND:ID")]
    record: String,
    #[arg(long)]
    source: Option<String>,
}

#[derive(Parser)]
struct ImportAuditArgs {
    #[arg(long, default_value_t = 100)]
    limit: usize,
}

#[derive(Parser)]
struct ImportFinalizeArgs {
    #[arg(long, value_name = "KIND:ID")]
    record: String,
    /// Mark raw source text unavailable after a good-faith fetch attempt.
    #[arg(long)]
    raw_text_unavailable: bool,
    /// Mark the record as having no useful participants/entities to link.
    #[arg(long)]
    no_entities: bool,
    /// Mark the record as not belonging to a current project or task.
    #[arg(long)]
    no_project_or_task_link: bool,
    /// Mark the record as having no actionable tasks or durable memories.
    #[arg(long)]
    no_derived_actions: bool,
    /// Mark the record as having no structured facts worth extracting.
    #[arg(long)]
    no_extracted_facts: bool,
}

#[derive(Parser)]
struct RememberArgs {
    #[arg(long, default_value = "fact")]
    kind: String,
    #[arg(long)]
    claim: String,
    #[arg(long = "link", value_name = "KIND:ID")]
    links: Vec<String>,
    /// Source chunk evidence by index `record_type:01ABC#0` or by quote
    /// `record_type:01ABC~"a phrase from the chunk"`.
    #[arg(long = "evidence", value_name = "RECORD_TYPE:ID#CHUNK_OR_~QUOTE")]
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

/// Borrow each clap arg struct into its `commands`-layer twin. The clap structs
/// own `String`/`Vec<String>`; the command functions take borrowed `&str`/`&[T]`,
/// so every `run` arm would otherwise repeat a field-by-field copy. Keeping the
/// mapping here next to the struct definitions makes `run` read as a dispatch
/// table. Methods that parse `--link`/`--evidence` or resolve `--text(-file)` are
/// fallible and return `Result`.
impl AddPersonArgs {
    fn to_command(&self) -> add::AddPersonArgs<'_> {
        add::AddPersonArgs {
            full_name: &self.full_name,
            preferred_name: self.preferred_name.as_deref(),
            emails: self.email.iter().map(String::as_str).collect(),
            phones: self.phone.iter().map(String::as_str).collect(),
            headline: self.headline.as_deref(),
            location: self.location.as_deref(),
            summary: self.summary.as_deref(),
            notes: self.notes.as_deref(),
            source_slug: self.source.as_deref(),
            external_kind: &self.external_kind,
            external_id: self.external_id.as_deref(),
            original_url: self.original_url.as_deref(),
            allow_duplicate: self.allow_duplicate,
            org: self.org.as_deref(),
            org_domain: self.org_domain.as_deref(),
            title: self.title.as_deref(),
            role: self.role.as_deref(),
            current: self.current,
        }
    }
}

impl AddPersonFromEmailArgs {
    fn to_command(&self) -> add::AddPersonFromEmailArgs<'_> {
        add::AddPersonFromEmailArgs {
            full_name: &self.full_name,
            email: &self.email,
            source_slug: self.source.as_deref(),
            external_id: self.external_id.as_deref(),
            headline: self.headline.as_deref(),
            phone: self.phone.as_deref(),
            location: self.location.as_deref(),
            org: self.org.as_deref(),
            org_domain: self.org_domain.as_deref(),
            title: self.title.as_deref(),
            current: self.current,
        }
    }
}

impl AddAssetArgs {
    fn to_command(&self) -> Result<add::AddAssetArgs<'_>, CliError> {
        Ok(add::AddAssetArgs {
            file: &self.file,
            kind: &self.kind,
            mime_type: self.mime_type.as_deref(),
            original_filename: self.original_filename.as_deref(),
            original_url: self.original_url.as_deref(),
            text: resolve_optional_text(self.text.as_deref(), self.text_file.as_deref())?,
            text_source: &self.text_source,
            role: &self.role,
            caption: self.caption.as_deref(),
            links: parse_links(&self.links)?,
            allow_duplicate: self.allow_duplicate,
        })
    }
}

impl AddDocumentArgs {
    fn to_command(&self) -> Result<add::AddDocumentArgs<'_>, CliError> {
        Ok(add::AddDocumentArgs {
            title: self.title.as_deref(),
            kind: self.kind.as_deref(),
            body: resolve_text(self.text.as_deref(), self.text_file.as_deref())?,
            source_slug: self.source.as_deref(),
            external_kind: &self.external_kind,
            external_id: self.external_id.as_deref(),
            original_path: self.original_path.as_deref(),
            original_url: self.original_url.as_deref(),
            links: parse_links(&self.links)?,
            allow_duplicate: self.allow_duplicate,
        })
    }
}

impl AddInteractionArgs {
    fn to_command(&self) -> Result<add::AddInteractionArgs<'_>, CliError> {
        Ok(add::AddInteractionArgs {
            title: self.title.as_deref(),
            kind: &self.kind,
            occurred_at: self.occurred_at.as_deref(),
            ended_at: self.ended_at.as_deref(),
            location: self.location.as_deref(),
            source_slug: self.source.as_deref(),
            external_kind: &self.external_kind,
            external_id: self.external_id.as_deref(),
            original_url: self.original_url.as_deref(),
            summary: self.summary.as_deref(),
            body: resolve_optional_text(self.text.as_deref(), self.text_file.as_deref())?,
            links: parse_links(&self.links)?,
            raw_participants: self.participants.iter().map(String::as_str).collect(),
            self_participants: self.self_participants.iter().map(String::as_str).collect(),
            allow_duplicate: self.allow_duplicate,
            replace_body: self.replace_body,
            refresh: self.refresh,
        })
    }
}

impl AddOrganizationArgs {
    fn to_command(&self) -> add::AddOrganizationArgs<'_> {
        add::AddOrganizationArgs {
            name: &self.name,
            kind: self.kind.as_deref(),
            domain: self.domain.as_deref(),
            headline: self.headline.as_deref(),
            location: self.location.as_deref(),
            summary: self.summary.as_deref(),
            website: self.website.as_deref(),
            industry: self.industry.as_deref(),
            hq_city: self.hq_city.as_deref(),
            hq_region: self.hq_region.as_deref(),
            hq_country: self.hq_country.as_deref(),
            notes: self.notes.as_deref(),
            source_slug: self.source.as_deref(),
            external_kind: &self.external_kind,
            external_id: self.external_id.as_deref(),
            original_url: self.original_url.as_deref(),
            allow_duplicate: self.allow_duplicate,
        }
    }
}

impl AddProjectArgs {
    fn to_command(&self) -> Result<add::AddProjectArgs<'_>, CliError> {
        Ok(add::AddProjectArgs {
            name: &self.name,
            status: &self.status,
            kind: self.kind.as_deref(),
            summary: self.summary.as_deref(),
            notes: self.notes.as_deref(),
            started_on: self.started_on.as_deref(),
            target_date: self.target_date.as_deref(),
            source_slug: self.source.as_deref(),
            external_kind: &self.external_kind,
            external_id: self.external_id.as_deref(),
            original_url: self.original_url.as_deref(),
            links: parse_links(&self.links)?,
            allow_duplicate: self.allow_duplicate,
        })
    }
}

impl AddTaskArgs {
    fn to_command(&self) -> Result<add::AddTaskArgs<'_>, CliError> {
        Ok(add::AddTaskArgs {
            title: &self.title,
            status: &self.status,
            due_at: self.due_at.as_deref(),
            project_id: None,
            links: parse_links(&self.links)?,
            evidence: parse_evidence_refs(&self.evidence)?,
            assignee_ids: self.assignee.clone(),
        })
    }
}

impl AddTranscriptArgs {
    fn to_command(&self) -> Result<add::AddTranscriptArgs<'_>, CliError> {
        Ok(add::AddTranscriptArgs {
            interaction_id: &self.interaction,
            body: resolve_text(self.text.as_deref(), self.text_file.as_deref())?,
            format: &self.format,
            language: self.language.as_deref(),
            segments_json: self.segments_json.as_deref(),
            recording_url: self.recording_url.as_deref(),
            storage_path: self.storage_path.as_deref(),
            source_slug: self.source.as_deref(),
            external_kind: &self.external_kind,
            external_id: self.external_id.as_deref(),
            transcribed_by: self.transcribed_by.as_deref(),
            transcribed_at: self.transcribed_at.as_deref(),
            metadata_json: self.metadata_json.as_deref(),
        })
    }
}

impl AddAiNoteArgs {
    fn to_command(&self) -> Result<add::AddAiNoteArgs<'_>, CliError> {
        Ok(add::AddAiNoteArgs {
            kind: &self.kind,
            interaction_id: self.interaction.as_deref(),
            document_id: self.document.as_deref(),
            subject: self.subject.as_deref(),
            title: self.title.as_deref(),
            content: resolve_text(self.text.as_deref(), self.text_file.as_deref())?,
            content_format: &self.content_format,
            model: self.model.as_deref(),
            prompt_fingerprint: self.prompt_fingerprint.as_deref(),
            source_slug: self.source.as_deref(),
            metadata_json: self.metadata_json.as_deref(),
            evidence: parse_evidence_refs(&self.evidence)?,
        })
    }
}

impl AddFactArgs {
    fn to_command(&self) -> Result<add::AddFactArgs<'_>, CliError> {
        Ok(add::AddFactArgs {
            subject: &self.subject,
            key: &self.key,
            value_text: self.value_text.as_deref(),
            value_json: self.value_json.as_deref(),
            confidence: self.confidence,
            source_record: self.source_record.as_deref(),
            source_excerpt: self.source_excerpt.as_deref(),
            observed_at: self.observed_at.as_deref(),
            model: self.model.as_deref(),
            prompt_fingerprint: self.prompt_fingerprint.as_deref(),
            metadata_json: self.metadata_json.as_deref(),
            evidence: parse_evidence_refs(&self.evidence)?,
        })
    }
}

impl EnrichPersonArgs {
    fn to_command(&self) -> add::EnrichPersonArgs<'_> {
        add::EnrichPersonArgs {
            id: &self.id,
            preferred_name: self.preferred_name.as_deref(),
            headline: self.headline.as_deref(),
            summary: self.summary.as_deref(),
            location: self.location.as_deref(),
            city: self.city.as_deref(),
            region: self.region.as_deref(),
            country: self.country.as_deref(),
            timezone: self.timezone.as_deref(),
            linkedin_url: self.linkedin_url.as_deref(),
            website: self.website.as_deref(),
            important_dates_json: self.important_dates_json.as_deref(),
            current_title: self.current_title.as_deref(),
            current_department: self.current_department.as_deref(),
            role_family: self.role_family.as_deref(),
            seniority: self.seniority.as_deref(),
            notes: self.notes.as_deref(),
        }
    }
}

impl EnrichOrganizationArgs {
    fn to_command(&self) -> add::EnrichOrganizationArgs<'_> {
        add::EnrichOrganizationArgs {
            id: &self.id,
            kind: self.kind.as_deref(),
            domain: self.domain.as_deref(),
            headline: self.headline.as_deref(),
            summary: self.summary.as_deref(),
            website: self.website.as_deref(),
            industry: self.industry.as_deref(),
            location: self.location.as_deref(),
            hq_city: self.hq_city.as_deref(),
            hq_region: self.hq_region.as_deref(),
            hq_country: self.hq_country.as_deref(),
            notes: self.notes.as_deref(),
            model: self.model.as_deref(),
            prompt_fingerprint: self.prompt_fingerprint.as_deref(),
            canonical_name: self.canonical_name.as_deref(),
            one_line_description: self.one_line_description.as_deref(),
            category: self.category.as_deref(),
            why_it_matters: self.why_it_matters.as_deref(),
            offerings_json: self.offerings_json.as_deref(),
            notable_people_json: self.notable_people_json.as_deref(),
            suggested_tags_json: self.suggested_tags_json.as_deref(),
            review_flags_json: self.review_flags_json.as_deref(),
            source_urls_json: self.source_urls_json.as_deref(),
            raw_enrichment_json: self.raw_enrichment_json.as_deref(),
            source_slug: self.source.as_deref(),
        }
    }
}

impl PromoteFactArgs {
    fn to_command(&self) -> add::PromoteFactArgs<'_> {
        add::PromoteFactArgs {
            fact_id: &self.id,
            memory_kind: &self.memory_kind,
        }
    }
}

impl TagEnsureArgs {
    fn to_command(&self) -> add::TagEnsureArgs<'_> {
        add::TagEnsureArgs {
            name: &self.name,
            slug: self.slug.as_deref(),
            color: self.color.as_deref(),
            description: self.description.as_deref(),
        }
    }
}

impl TagAttachArgs {
    fn to_command(&self) -> add::TagAttachArgs<'_> {
        add::TagAttachArgs {
            tag: &self.tag,
            record: &self.record,
            source_slug: self.source.as_deref(),
        }
    }
}

impl ImportAuditArgs {
    fn to_command(&self) -> add::ImportAuditArgs {
        add::ImportAuditArgs { limit: self.limit }
    }
}

impl ImportFinalizeArgs {
    fn to_command(&self) -> add::ImportFinalizeArgs<'_> {
        add::ImportFinalizeArgs {
            record: &self.record,
            raw_text_unavailable: self.raw_text_unavailable,
            no_entities: self.no_entities,
            no_project_or_task_link: self.no_project_or_task_link,
            no_derived_actions: self.no_derived_actions,
            no_extracted_facts: self.no_extracted_facts,
        }
    }
}

impl RememberArgs {
    fn to_command(&self) -> Result<add::RememberArgs<'_>, CliError> {
        Ok(add::RememberArgs {
            kind: &self.kind,
            claim: &self.claim,
            links: parse_links(&self.links)?,
            evidence: parse_evidence_refs(&self.evidence)?,
        })
    }
}

impl AffiliateArgs {
    fn to_command(&self) -> add::AffiliateArgs<'_> {
        add::AffiliateArgs {
            person_id: &self.person,
            organization_id: &self.org,
            title: self.title.as_deref(),
            department: self.department.as_deref(),
            role: self.role.as_deref(),
            role_family: self.role_family.as_deref(),
            seniority: self.seniority.as_deref(),
            is_current: self.current,
            is_primary: self.primary,
        }
    }
}

impl SelfSetArgs {
    fn to_command(&self) -> add::SetSelfArgs<'_> {
        add::SetSelfArgs {
            full_name: self.full_name.as_deref(),
            preferred_name: self.preferred_name.as_deref(),
            emails: self.email.iter().map(String::as_str).collect(),
            phones: self.phone.iter().map(String::as_str).collect(),
            headline: self.headline.as_deref(),
            location: self.location.as_deref(),
        }
    }
}

impl SuggestProjectArgs {
    fn to_command(&self) -> Result<add::SuggestArgs<'_>, CliError> {
        Ok(add::SuggestArgs {
            kind: add::SuggestionKind::Project,
            title: &self.title,
            summary: self.summary.as_deref(),
            domain: None,
            org_kind: None,
            rationale: self.rationale.as_deref(),
            links: parse_links(&self.links)?,
        })
    }
}

impl SuggestOrgArgs {
    fn to_command(&self) -> Result<add::SuggestArgs<'_>, CliError> {
        Ok(add::SuggestArgs {
            kind: add::SuggestionKind::Organization,
            title: &self.title,
            summary: None,
            domain: self.domain.as_deref(),
            org_kind: self.kind.as_deref(),
            rationale: self.rationale.as_deref(),
            links: parse_links(&self.links)?,
        })
    }
}

impl EnsureSourceArgs {
    fn to_command(&self) -> source::EnsureSourceArgs<'_> {
        source::EnsureSourceArgs {
            slug: &self.slug,
            name: &self.name,
            description: self.description.as_deref(),
        }
    }
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
                AddCommand::Person(a) => add::add_person(&mut conn, json, a.to_command()),
                AddCommand::PersonFromEmail(a) => {
                    add::add_person_from_email(&mut conn, json, a.to_command())
                }
                AddCommand::Asset(a) => add::add_asset(
                    &mut conn,
                    storage.assets_path.as_deref(),
                    json,
                    a.to_command()?,
                ),
                AddCommand::Document(a) => add::add_document(&mut conn, json, a.to_command()?),
                AddCommand::Interaction(a) => {
                    add::add_interaction(&mut conn, json, a.to_command()?)
                }
                AddCommand::Organization(a) => {
                    add::add_organization(&mut conn, json, a.to_command())
                }
                AddCommand::Project(a) => add::add_project(&mut conn, json, a.to_command()?),
                AddCommand::Task(a) => add::add_task(&mut conn, json, a.to_command()?),
                AddCommand::AiNote(a) => add::add_ai_note(&mut conn, json, a.to_command()?),
                AddCommand::Fact(a) => add::add_fact(&mut conn, json, a.to_command()?),
            }
        }
        Command::Import { what } => {
            let mut conn = db::open(&db_path)?;
            match *what {
                ImportCommand::Interaction(a) => {
                    add::add_interaction(&mut conn, json, a.to_command()?)
                }
                ImportCommand::Document(a) => add::add_document(&mut conn, json, a.to_command()?),
                ImportCommand::Transcript(a) => {
                    add::add_transcript(&mut conn, json, a.to_command()?)
                }
                ImportCommand::Audit(a) => add::import_audit(&conn, json, a.to_command()),
                ImportCommand::Finalize(a) => add::import_finalize(&conn, json, a.to_command()),
            }
        }
        Command::Enrich { what } => {
            let mut conn = db::open(&db_path)?;
            match *what {
                EnrichCommand::Person(a) => add::enrich_person(&mut conn, json, a.to_command()),
                EnrichCommand::Organization(a) => {
                    add::enrich_organization(&mut conn, json, a.to_command())
                }
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
            add::remember(&mut conn, json, a.to_command()?)
        }
        Command::Promote { what } => {
            let mut conn = db::open(&db_path)?;
            match what {
                PromoteCommand::Fact(a) => add::promote_fact(&mut conn, json, a.to_command()),
            }
        }
        Command::Tag { what } => {
            let mut conn = db::open(&db_path)?;
            match what {
                TagCommand::Ensure(a) => add::ensure_tag(&mut conn, json, a.to_command()),
                TagCommand::Attach(a) => add::attach_tag(&mut conn, json, a.to_command()),
            }
        }
        Command::SelfPerson { what } => match what {
            SelfCommand::Show => {
                let conn = db::open_existing(&db_path)?;
                add::show_self(&conn, json)
            }
            SelfCommand::Set(a) => {
                let mut conn = db::open(&db_path)?;
                add::set_self(&mut conn, json, a.to_command())
            }
        },
        Command::Affiliate(a) => {
            let mut conn = db::open(&db_path)?;
            add::affiliate(&mut conn, json, a.to_command())
        }
        Command::Suggest { what } => match what {
            SuggestCommand::Project(a) => {
                let mut conn = db::open(&db_path)?;
                add::suggest(&mut conn, json, a.to_command()?)
            }
            SuggestCommand::Organization(a) => {
                let mut conn = db::open(&db_path)?;
                add::suggest(&mut conn, json, a.to_command()?)
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
                SourceCommand::Ensure(a) => source::ensure(&mut conn, json, a.to_command()),
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
            "interaction_transcript",
            "ai_note",
            "extracted_fact",
            "organization_profile",
        ],
        "linkSyntax": {
            "format": "kind:id",
            "acceptedKinds": ["person", "organization", "org", "project", "task", "document", "doc", "interaction"],
            "examples": ["person:01ABC", "project:01XYZ", "task:01TODO"],
        },
        "evidenceSyntax": {
            "format": "record_type:id#chunk_index or record_type:id~quote",
            "acceptedRecordTypes": ["person", "organization", "organization_profile", "project", "task", "document", "interaction", "interaction_transcript", "ai_note", "extracted_fact", "memory", "asset"],
            "aliases": { "doc": "document", "org": "organization" },
            "examples": ["document:01ABC#0", "interaction_transcript:01XYZ~\"ship the credential flow\""],
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
                "granola",
                "reflect_notes",
                "public_web",
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
                "usage": "brain --json add document --title <title> (--text <text>|--text-file <path|->) [--source <slug> --external-kind <kind> --external-id <id>] [--original-path <path>] [--original-url <url>] [--link kind:id...]",
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
            "importInteraction": {
                "usage": "brain --json import interaction <same args as add interaction>",
                "purpose": "Preferred source-led import alias for interactions.",
            },
            "importDocument": {
                "usage": "brain --json import document <same args as add document>",
                "purpose": "Preferred source-led import alias for documents.",
            },
            "importTranscript": {
                "usage": "brain --json import transcript --interaction <id> (--text <text>|--text-file <path|->) [--source <slug> --external-kind transcript --external-id <id>] [--language <code>] [--segments-json <json>]",
                "purpose": "Store full raw transcript text for an interaction and create universal retrieval chunks.",
            },
            "importFinalize": {
                "usage": "brain --json import finalize --record <kind:id> [--raw-text-unavailable] [--no-entities] [--no-project-or-task-link] [--no-derived-actions] [--no-extracted-facts]",
                "returns": "complete flag plus missing staged-import requirements; complete records get finalized provenance.",
            },
            "importAudit": {
                "usage": "brain --json import audit --limit 100",
                "returns": "recent incomplete documents/interactions and their missing stages.",
            },
            "addAsset": {
                "usage": "brain --json add asset --file <path> --link <kind:id> [--role attachment|avatar|logo|screenshot|source_file]",
                "purpose": "Copy bytes into the managed assets directory and link them to a typed record.",
            },
            "addOrganization": {
                "usage": "brain --json add organization --name <name> [--domain <domain>] [--kind <kind>] [--headline <one-line>] [--website <url>] [--industry <industry>] [--location <loc>] [--source <slug> --external-id <id>]",
                "dedupe": "external identity, then normalized name, then normalized domain (www-stripped)",
            },
            "enrichPerson": {
                "usage": "brain --json enrich person <id> [--headline <headline>] [--summary <summary>] [--city <city>] [--timezone <tz>] [--current-title <title>] [--role-family <family>] [--seniority <level>]",
                "purpose": "Update rich person profile fields and regenerate person chunks.",
            },
            "enrichOrganization": {
                "usage": "brain --json enrich organization <id> [--headline <headline>] [--summary <summary>] [--website <url>] [--industry <industry>] [--one-line-description <text>] [--why-it-matters <text>] [--source-urls-json <json>]",
                "purpose": "Update organization profile fields and optionally write an organization_profiles enrichment row.",
            },
            "addPersonAffiliation": {
                "usage": "brain --json add person --full-name <name> --org <org-name> [--org-domain <domain>] [--title <title>] [--current]",
                "purpose": "On person create/enrich, find-or-create the employer org and upsert an affiliation. --current marks the single current employer and sets people.current_organization_id. person-from-email accepts the same --org/--org-domain/--title/--current plus --headline/--phone/--location.",
            },
            "affiliate": {
                "usage": "brain --json affiliate --person <person-id> --org <org-id> [--title <title>] [--department <dept>] [--role <role>] [--role-family <family>] [--seniority <level>] [--current] [--primary]",
                "purpose": "Link an existing person to an existing organization; deduped by (person, org).",
            },
            "suggest": {
                "usage": "brain --json suggest project --title <name> [--rationale <r>] [--link interaction:<id>...] | suggest organization --title <name> [--domain <d>] | suggest list [--status open] | suggest accept <id> | suggest dismiss <id>",
                "purpose": "Durable curation queue for structure the importer must not auto-create (a new project or organization). Accepting performs the typed write and relinks the cited records; dismissals persist so a proposal is never re-raised. Use this instead of auto-creating projects/orgs from inferred source topics.",
                "kinds": ["create_project", "create_organization"],
            },
            "addTask": {
                "usage": "brain --json add task --title <title> [--due-at <iso>] [--link kind:id...] [--evidence record_type:id#0] [--assignee <person-id>...]",
                "assigneeFlag": "Use --assignee <person-id> (repeatable) to mark someone as responsible for the task. Creates a task_people row with role='assignee'. Distinct from generic --link person:<id> which creates a generic person link.",
            },
            "addAiNote": {
                "usage": "brain --json add ai-note --kind <summary|action_items|decisions|risks|highlights|coaching|other> (--interaction <id>|--document <id>|--subject <kind:id>) (--text <text>|--text-file <path|->) [--evidence record_type:id#0]",
                "purpose": "Store narrative AI artifacts separately from raw evidence.",
            },
            "addFact": {
                "usage": "brain --json add fact --subject <kind:id> --key <key> (--value-text <text>|--value-json <json>) [--source-record <kind:id>] [--confidence <0..1>] [--evidence record_type:id~\"quote\"]",
                "purpose": "Append a structured claim without automatically promoting it to memory.",
            },
            "promoteFact": {
                "usage": "brain --json promote fact <fact-id> --memory-kind <kind>",
                "purpose": "Promote a selected extracted fact into a curated hidden memory.",
            },
            "tag": {
                "usage": "brain --json tag ensure --name <name> [--slug <slug>] | brain --json tag attach --tag <id|slug|name> --record <kind:id>",
                "purpose": "Ensure tags and attach them to typed records.",
            },
            "remember": {
                "usage": "brain --json remember --kind <fact|preference|decision|commitment|instruction|risk|idea> --claim <atomic claim> --link kind:id... [--evidence record_type:<id>#<chunk>|record_type:<id>~\"quote\"]",
                "rule": "Memories should be atomic and linked to visible evidence records.",
                "evidence": "Cite a universal content chunk by index (#0) or by a quote substring (~\"a phrase\") resolved against the record's chunks at write time, so you need not know chunk boundaries. Works for `remember`, `add task`, `add ai-note`, and `add fact`.",
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
