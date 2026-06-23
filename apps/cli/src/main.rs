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

use std::io::Read;
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

    /// Path to the brain database (advanced exact-file override; overrides $BRAIN_DB).
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
    /// Repair identity and participant links after an audited import issue.
    Repair {
        #[command(subcommand)]
        what: RepairCommand,
    },
    /// Merge duplicate records after review.
    Merge {
        #[command(subcommand)]
        what: MergeCommand,
    },
    /// Soft-archive a record after cleanup.
    Archive {
        #[command(subcommand)]
        what: ArchiveCommand,
    },
    /// Remove a typed link between two records.
    Unlink(UnlinkArgs),
    /// Maintain an existing person record.
    Person {
        #[command(subcommand)]
        what: PersonCommand,
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
    /// Agent-oriented grounded recall over universal content chunks.
    Retrieve(RetrieveArgs),
    /// Load bounded context for records found by retrieve.
    #[command(name = "get-records")]
    GetRecords(GetRecordsArgs),
    /// Today's brief: tasks and recent interactions.
    Today,
    /// Generate a report.
    Report {
        #[command(subcommand)]
        what: ReportCommand,
    },
    /// Task planning and evidence-backed task maintenance.
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
    /// Add a user-agreed project.
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
    /// Audit or promote unresolved interaction participants.
    Participants {
        #[command(subcommand)]
        what: ImportParticipantsCommand,
    },
    /// Check whether one imported record has met the completion rule.
    Finalize(ImportFinalizeArgs),
}

#[derive(Subcommand)]
enum ImportParticipantsCommand {
    /// Group unresolved participant handles and recommend promotion work.
    Audit(ImportParticipantsAuditArgs),
    /// Promote one unresolved email handle to a person and relink matching rows.
    Promote(ImportParticipantsPromoteArgs),
}

#[derive(Subcommand)]
enum RepairCommand {
    /// Move an email handle between people.
    #[command(name = "person-email")]
    PersonEmail {
        #[command(subcommand)]
        what: RepairPersonEmailCommand,
    },
    /// Move a phone handle between people.
    #[command(name = "person-phone")]
    PersonPhone {
        #[command(subcommand)]
        what: RepairPersonPhoneCommand,
    },
    /// Relink unresolved participant rows.
    Participants {
        #[command(subcommand)]
        what: RepairParticipantsCommand,
    },
}

#[derive(Subcommand)]
enum RepairPersonEmailCommand {
    /// Move one email from one person to another.
    Move(RepairPersonEmailMoveArgs),
}

#[derive(Subcommand)]
enum RepairPersonPhoneCommand {
    /// Move one phone from one person to another.
    Move(RepairPersonPhoneMoveArgs),
}

#[derive(Subcommand)]
enum RepairParticipantsCommand {
    /// Relink unresolved participants with a handle to a person.
    Relink(RepairParticipantsRelinkArgs),
}

#[derive(Subcommand)]
enum MergeCommand {
    /// Merge one duplicate person into another.
    Person(MergePersonArgs),
}

#[derive(Subcommand)]
enum ArchiveCommand {
    /// Archive one person.
    Person(ArchiveRecordArgs),
    /// Archive one organization.
    Organization(ArchiveRecordArgs),
}

#[derive(Subcommand)]
enum PersonCommand {
    /// Rename the canonical full name.
    Rename(PersonRenameArgs),
    /// Maintain email handles.
    Email {
        #[command(subcommand)]
        what: PersonEmailCommand,
    },
    /// Maintain phone handles.
    Phone {
        #[command(subcommand)]
        what: PersonPhoneCommand,
    },
}

#[derive(Subcommand)]
enum PersonEmailCommand {
    /// Add an email handle to a person.
    Add(PersonEmailArgs),
    /// Remove an email handle from a person.
    Remove(PersonEmailArgs),
}

#[derive(Subcommand)]
enum PersonPhoneCommand {
    /// Add a phone handle to a person.
    Add(PersonPhoneArgs),
    /// Remove a phone handle from a person.
    Remove(PersonPhoneArgs),
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
    /// Raw provider payload JSON stored on the interaction.
    #[arg(long)]
    metadata_json: Option<String>,
    /// File containing raw provider payload JSON, or '-' to read stdin.
    #[arg(long, value_name = "PATH")]
    metadata_json_file: Option<PathBuf>,
    /// Structured event payload JSON; valid only with --kind event.
    #[arg(long)]
    event_json: Option<String>,
    /// File containing structured event payload JSON, or '-' to read stdin.
    #[arg(long, value_name = "PATH")]
    event_json_file: Option<PathBuf>,
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
struct UpdateTaskArgs {
    id: String,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    description: Option<String>,
    #[arg(long)]
    status: Option<String>,
    #[arg(long)]
    due_at: Option<String>,
    #[arg(long)]
    scheduled_for: Option<String>,
    #[arg(long = "link", value_name = "KIND:ID")]
    links: Vec<String>,
    /// Required evidence by index `interaction:01ABC#0` or by quote
    /// `interaction:01ABC~"a phrase from the chunk"`.
    #[arg(long = "evidence", value_name = "RECORD_TYPE:ID#CHUNK_OR_~QUOTE")]
    evidence: Vec<String>,
}

#[derive(Parser)]
struct CompleteTaskArgs {
    id: String,
    /// Required evidence by index `interaction:01ABC#0` or by quote
    /// `interaction:01ABC~"a phrase from the chunk"`.
    #[arg(long = "evidence", value_name = "RECORD_TYPE:ID#CHUNK_OR_~QUOTE")]
    evidence: Vec<String>,
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
    #[arg(long)]
    source: Option<String>,
    #[arg(long, default_value = "record")]
    external_kind: String,
    #[arg(long)]
    external_id: Option<String>,
    #[arg(long)]
    refresh: bool,
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
struct ImportParticipantsAuditArgs {
    #[arg(long)]
    source: Option<String>,
    #[arg(long, default_value_t = 2)]
    min_count: usize,
    #[arg(long, default_value_t = 50)]
    limit: usize,
    #[arg(long)]
    fail_on_promote_candidates: bool,
}

#[derive(Parser)]
struct ImportParticipantsPromoteArgs {
    #[arg(long)]
    handle: String,
    #[arg(long)]
    full_name: String,
    #[arg(long)]
    headline: Option<String>,
    #[arg(long)]
    org: Option<String>,
    #[arg(long)]
    org_domain: Option<String>,
    #[arg(long)]
    title: Option<String>,
    #[arg(long)]
    current: bool,
}

#[derive(Parser)]
struct RepairPersonEmailMoveArgs {
    #[arg(long)]
    email: String,
    #[arg(long = "from")]
    from_person: String,
    #[arg(long = "to")]
    to_person: String,
    #[arg(long)]
    relink_participants: bool,
}

#[derive(Parser)]
struct RepairPersonPhoneMoveArgs {
    #[arg(long)]
    phone: String,
    #[arg(long = "from")]
    from_person: String,
    #[arg(long = "to")]
    to_person: String,
    #[arg(long)]
    relink_participants: bool,
}

#[derive(Parser)]
struct RepairParticipantsRelinkArgs {
    #[arg(long)]
    handle: String,
    #[arg(long)]
    person: String,
    #[arg(long)]
    from_person: Option<String>,
    #[arg(long)]
    force: bool,
}

#[derive(Parser)]
struct MergePersonArgs {
    #[arg(long = "from")]
    from_person: String,
    #[arg(long = "to")]
    to_person: String,
    #[arg(long)]
    dry_run: bool,
    #[arg(long)]
    reason: Option<String>,
}

#[derive(Parser)]
struct ArchiveRecordArgs {
    id: String,
    #[arg(long)]
    reason: String,
}

#[derive(Parser)]
struct UnlinkArgs {
    #[arg(value_name = "KIND:ID")]
    left: String,
    #[arg(value_name = "KIND:ID")]
    right: String,
    #[arg(long)]
    reason: String,
}

#[derive(Parser)]
struct PersonRenameArgs {
    id: String,
    #[arg(long)]
    full_name: String,
}

#[derive(Parser)]
struct PersonEmailArgs {
    id: String,
    #[arg(long)]
    email: String,
}

#[derive(Parser)]
struct PersonPhoneArgs {
    id: String,
    #[arg(long)]
    phone: String,
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
struct RetrieveArgs {
    /// Topic or keywords. Omit only when browsing with filters.
    query: Option<String>,
    /// Restrict to retrievable source record types, e.g. interaction or document.
    #[arg(long = "record-type")]
    record_types: Vec<String>,
    /// Restrict interaction-backed chunks to these interaction kinds, e.g. email.
    #[arg(long = "kind")]
    kinds: Vec<String>,
    /// Only records on/after this ISO timestamp or YYYY-MM-DD date.
    #[arg(long)]
    after: Option<String>,
    /// Only records on/before this ISO timestamp or YYYY-MM-DD date.
    #[arg(long)]
    before: Option<String>,
    /// relevance | recency
    #[arg(long, default_value = "relevance")]
    sort: String,
    #[arg(long, default_value_t = 20)]
    limit: usize,
}

#[derive(Parser)]
struct GetRecordsArgs {
    /// Record refs to load, e.g. interaction:01ABC or document:01XYZ.
    #[arg(value_name = "KIND:ID", required = true)]
    records: Vec<String>,
    /// Focus context around matching chunk ids from `brain retrieve`.
    #[arg(long = "chunk")]
    chunk_ids: Vec<String>,
    /// Max chunk text characters to return per record.
    #[arg(long = "max-chars", default_value_t = 4000)]
    max_chars_per_record: usize,
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
    /// Evidence-backed update to an existing task.
    Update(UpdateTaskArgs),
    /// Mark an existing task complete with evidence.
    Complete(CompleteTaskArgs),
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

fn resolve_optional_payload(
    inline: Option<&str>,
    file: Option<&PathBuf>,
    inline_flag: &str,
    file_flag: &str,
) -> Result<Option<String>, CliError> {
    match (inline, file) {
        (Some(value), None) => Ok(Some(value.to_string())),
        (None, Some(path)) => {
            if path.as_os_str() == "-" {
                let mut buf = String::new();
                std::io::stdin()
                    .read_to_string(&mut buf)
                    .map_err(|e| CliError::Runtime(format!("could not read stdin: {e}")))?;
                Ok(Some(buf))
            } else {
                std::fs::read_to_string(path).map(Some).map_err(|e| {
                    CliError::Runtime(format!("could not read {}: {e}", path.display()))
                })
            }
        }
        (Some(_), Some(_)) => Err(CliError::Runtime(format!(
            "provide only one of {inline_flag} / {file_flag}"
        ))),
        (None, None) => Ok(None),
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
            metadata_json: resolve_optional_payload(
                self.metadata_json.as_deref(),
                self.metadata_json_file.as_ref(),
                "--metadata-json",
                "--metadata-json-file",
            )?,
            event_json: resolve_optional_payload(
                self.event_json.as_deref(),
                self.event_json_file.as_ref(),
                "--event-json",
                "--event-json-file",
            )?,
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

impl UpdateTaskArgs {
    fn to_command(&self) -> Result<add::UpdateTaskArgs<'_>, CliError> {
        Ok(add::UpdateTaskArgs {
            id: &self.id,
            title: self.title.as_deref(),
            description: self.description.as_deref(),
            status: self.status.as_deref(),
            due_at: self.due_at.as_deref(),
            scheduled_for: self.scheduled_for.as_deref(),
            links: parse_links(&self.links)?,
            evidence: parse_evidence_refs(&self.evidence)?,
        })
    }
}

impl CompleteTaskArgs {
    fn to_command(&self) -> Result<add::CompleteTaskArgs<'_>, CliError> {
        Ok(add::CompleteTaskArgs {
            id: &self.id,
            evidence: parse_evidence_refs(&self.evidence)?,
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
            source_slug: self.source.as_deref(),
            external_kind: &self.external_kind,
            external_id: self.external_id.as_deref(),
            refresh: self.refresh,
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

impl ImportParticipantsAuditArgs {
    fn to_command(&self) -> add::ParticipantAuditArgs<'_> {
        add::ParticipantAuditArgs {
            source_slug: self.source.as_deref(),
            min_count: self.min_count,
            limit: self.limit,
            fail_on_promote_candidates: self.fail_on_promote_candidates,
        }
    }
}

impl ImportParticipantsPromoteArgs {
    fn to_command(&self) -> add::ParticipantPromoteArgs<'_> {
        add::ParticipantPromoteArgs {
            handle: &self.handle,
            full_name: &self.full_name,
            headline: self.headline.as_deref(),
            org: self.org.as_deref(),
            org_domain: self.org_domain.as_deref(),
            title: self.title.as_deref(),
            current: self.current,
        }
    }
}

impl RepairPersonEmailMoveArgs {
    fn to_command(&self) -> add::PersonEmailMoveArgs<'_> {
        add::PersonEmailMoveArgs {
            email: &self.email,
            from_person_id: &self.from_person,
            to_person_id: &self.to_person,
            relink_participants: self.relink_participants,
        }
    }
}

impl RepairPersonPhoneMoveArgs {
    fn to_command(&self) -> add::PersonPhoneMoveArgs<'_> {
        add::PersonPhoneMoveArgs {
            phone: &self.phone,
            from_person_id: &self.from_person,
            to_person_id: &self.to_person,
            relink_participants: self.relink_participants,
        }
    }
}

impl RepairParticipantsRelinkArgs {
    fn to_command(&self) -> add::ParticipantRelinkArgs<'_> {
        add::ParticipantRelinkArgs {
            handle: &self.handle,
            person_id: &self.person,
            from_person_id: self.from_person.as_deref(),
            force: self.force,
        }
    }
}

impl MergePersonArgs {
    fn to_command(&self) -> add::MergePersonArgs<'_> {
        add::MergePersonArgs {
            from_person_id: &self.from_person,
            to_person_id: &self.to_person,
            dry_run: self.dry_run,
            reason: self.reason.as_deref(),
        }
    }
}

impl ArchiveRecordArgs {
    fn to_command(&self, kind: add::ArchiveKind) -> add::ArchiveArgs<'_> {
        add::ArchiveArgs {
            kind,
            id: &self.id,
            reason: &self.reason,
        }
    }
}

impl UnlinkArgs {
    fn to_command(&self) -> add::UnlinkArgs<'_> {
        add::UnlinkArgs {
            left: &self.left,
            right: &self.right,
            reason: &self.reason,
        }
    }
}

impl PersonRenameArgs {
    fn to_command(&self) -> add::PersonRenameArgs<'_> {
        add::PersonRenameArgs {
            person_id: &self.id,
            full_name: &self.full_name,
        }
    }
}

impl PersonEmailArgs {
    fn to_command(&self) -> add::PersonContactArgs<'_> {
        add::PersonContactArgs {
            person_id: &self.id,
            value: &self.email,
        }
    }
}

impl PersonPhoneArgs {
    fn to_command(&self) -> add::PersonContactArgs<'_> {
        add::PersonContactArgs {
            person_id: &self.id,
            value: &self.phone,
        }
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

impl RetrieveArgs {
    fn to_command(&self) -> read::RetrieveArgs<'_> {
        read::RetrieveArgs {
            query: self.query.as_deref(),
            record_types: self.record_types.iter().map(String::as_str).collect(),
            kinds: self.kinds.iter().map(String::as_str).collect(),
            after: self.after.as_deref(),
            before: self.before.as_deref(),
            sort: &self.sort,
            limit: self.limit,
        }
    }
}

impl GetRecordsArgs {
    fn to_command(&self) -> read::GetRecordsArgs<'_> {
        read::GetRecordsArgs {
            records: self.records.iter().map(String::as_str).collect(),
            chunk_ids: self.chunk_ids.iter().map(String::as_str).collect(),
            max_chars_per_record: self.max_chars_per_record,
        }
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
                let mut error = json!({
                    "kind": err.kind(),
                    "message": err.to_string(),
                    "exitCode": err.exit_code(),
                });
                if let Some(existing_record_id) = err.existing_record_id() {
                    error["existingRecordId"] = json!(existing_record_id);
                }
                if let Some(conflicting_fields) = err.conflicting_fields() {
                    error["conflictingFields"] = json!(conflicting_fields);
                }
                eprintln!(
                    "{}",
                    serde_json::to_string_pretty(&json!({
                        "ok": false,
                        "error": error,
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
                ImportCommand::Participants { what } => match what {
                    ImportParticipantsCommand::Audit(a) => {
                        add::audit_participants(&conn, json, a.to_command())
                    }
                    ImportParticipantsCommand::Promote(a) => {
                        add::promote_participant(&mut conn, json, a.to_command())
                    }
                },
                ImportCommand::Finalize(a) => add::import_finalize(&conn, json, a.to_command()),
            }
        }
        Command::Repair { what } => {
            let mut conn = db::open(&db_path)?;
            match what {
                RepairCommand::PersonEmail { what } => match what {
                    RepairPersonEmailCommand::Move(a) => {
                        add::repair_person_email_move(&mut conn, json, a.to_command())
                    }
                },
                RepairCommand::PersonPhone { what } => match what {
                    RepairPersonPhoneCommand::Move(a) => {
                        add::repair_person_phone_move(&mut conn, json, a.to_command())
                    }
                },
                RepairCommand::Participants { what } => match what {
                    RepairParticipantsCommand::Relink(a) => {
                        add::repair_participants_relink(&mut conn, json, a.to_command())
                    }
                },
            }
        }
        Command::Merge { what } => {
            let mut conn = db::open(&db_path)?;
            match what {
                MergeCommand::Person(a) => add::merge_person(&mut conn, json, a.to_command()),
            }
        }
        Command::Archive { what } => {
            let mut conn = db::open(&db_path)?;
            match what {
                ArchiveCommand::Person(a) => {
                    add::archive_record(&mut conn, json, a.to_command(add::ArchiveKind::Person))
                }
                ArchiveCommand::Organization(a) => add::archive_record(
                    &mut conn,
                    json,
                    a.to_command(add::ArchiveKind::Organization),
                ),
            }
        }
        Command::Unlink(a) => {
            let mut conn = db::open(&db_path)?;
            add::unlink_records(&mut conn, json, a.to_command())
        }
        Command::Person { what } => {
            let mut conn = db::open(&db_path)?;
            match what {
                PersonCommand::Rename(a) => add::rename_person(&mut conn, json, a.to_command()),
                PersonCommand::Email { what } => match what {
                    PersonEmailCommand::Add(a) => {
                        add::person_email_add(&mut conn, json, a.to_command())
                    }
                    PersonEmailCommand::Remove(a) => {
                        add::person_email_remove(&mut conn, json, a.to_command())
                    }
                },
                PersonCommand::Phone { what } => match what {
                    PersonPhoneCommand::Add(a) => {
                        add::person_phone_add(&mut conn, json, a.to_command())
                    }
                    PersonPhoneCommand::Remove(a) => {
                        add::person_phone_remove(&mut conn, json, a.to_command())
                    }
                },
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
        Command::Retrieve(a) => {
            let conn = db::open_existing(&db_path)?;
            read::retrieve(&conn, json, a.to_command())
        }
        Command::GetRecords(a) => {
            let conn = db::open_existing(&db_path)?;
            read::get_records(&conn, json, a.to_command())
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
        Command::Tasks { what } => match what {
            TasksCommand::PlanDay { limit } => {
                let conn = db::open_existing(&db_path)?;
                report::plan_day(&conn, json, limit)
            }
            TasksCommand::Update(a) => {
                let mut conn = db::open(&db_path)?;
                add::update_task(&mut conn, json, a.to_command()?)
            }
            TasksCommand::Complete(a) => {
                let mut conn = db::open(&db_path)?;
                add::complete_task(&mut conn, json, a.to_command()?)
            }
        },
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
            { "code": 1, "kind": "external_identity_conflict", "meaning": "a person/org external identity matched an active record but conflicted with incoming email, domain, or normalized name" },
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
            "identityRule": "Use --source plus --external-id for idempotent provider imports. For people and organizations, --external-id must identify that person/org itself (for example contact id or stable org id), not a source email thread, message, meeting, event, or document id.",
        },
        "writeRules": [
            "Search before writing likely duplicates.",
            "Prefer typed fields over burying structure in notes/body text.",
            "Reuse and link existing people, organizations, projects, and tasks when possible.",
            "Projects are user-agreed structure: create them only after explicit user sign-off, otherwise link existing projects or suggest inferred candidates.",
            "Preserve provider provenance with --source, --external-id, and --original-url.",
            "Never reuse a source record id as a person/org --external-id. If no stable participant/org upstream id exists, omit --external-id and rely on email/domain/name dedupe.",
            "Do not create people for every raw sender or attendee; preserve unresolved handles with --participant.",
            "Before final backfill reporting, run import participants audit, promote recurring real people, and rerun it with --fail-on-promote-candidates.",
            "Use --text-file or --text-file - for large source bodies. Imported source records must store complete local readable evidence; do not redact imported body text.",
            "If a source record is too sensitive or not worth storing, skip the whole record and ledger it instead of importing a partial redaction.",
            "Concise summaries belong in summary or ai-note records, not as replacements for source body text.",
            "When a newer source clearly advances an existing task, use `tasks update` with evidence instead of leaving stale task wording. Create a new task for clear missing follow-ups; keep suggestions for uncertain task edits.",
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
                "returns": "ranked navigational records with kind, id, title, snippet, and score",
                "use": "Use for quick lookup/navigation. Use retrieve + get-records for grounded agent answer context.",
            },
            "retrieve": {
                "usage": "brain --json retrieve [query] [--record-type <type>...] [--kind <interaction-kind>...] [--after <iso|date>] [--before <iso|date>] [--sort relevance|recency] [--limit 20]",
                "returns": "chunk-oriented hits with recordType, recordId, recordRef, chunkId, chunkIndex, title, date, snippet, score, and semanticAvailable:false for the standalone CLI",
                "use": "Agent grounding path over universal content_chunks. To list recent records, omit query and pass filters such as --record-type interaction --kind email --sort recency --after YYYY-MM-DD.",
            },
            "getRecords": {
                "usage": "brain --json get-records <recordType:id>... [--chunk <chunk-id>...] [--max-chars 4000]",
                "returns": "bounded record context: found, title, date, metadata object, chunks with text, and truncated",
                "use": "Call after retrieve. Pass chunk ids from retrieve to focus the returned context around matching chunks.",
            },
            "show": {
                "usage": "brain --json show <person|organization|project|task> <id>",
                "returns": "core typed fields for one visible/top-level record. This is not the universal agent grounding path.",
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
                "usage": "brain --json add interaction --kind <kind> --title <title> [--text <text>|--text-file <path|->] [--metadata-json <json>|--metadata-json-file <path|->] [--event-json <json>|--event-json-file <path|->] [--occurred-at <iso>] [--ended-at <iso>] [--location <label>] [--source <slug> --external-id <id>] [--original-url <url>] [--participant 'role:Name <email>'...] [--self-participant 'role:Name <email>'...] [--link kind:id...] [--replace-body|--refresh]",
                "kinds": ["note", "meeting", "call", "email", "message", "event"],
                "bodyText": "Imported source records need full readable body text when the source has readable content. Use import finalize --raw-text-unavailable only after a good-faith fetch proves raw text is unavailable.",
                "metadataJson": "Raw provider payload JSON stored on interactions.metadata_json. Do not duplicate the full payload in event child tables.",
                "eventJson": {
                    "validOnlyWith": "--kind event",
                    "sections": ["details", "booking", "lodgingStay", "flightSegments"],
                    "detailsSubtype": ["flight", "lodging", "dining_reservation", "transport", "travel_block", "appointment", "generic"],
                    "reimport": "On source-backed reimport, supplied details, booking, and lodgingStay sections are upserted; supplied flightSegments replace existing segments.",
                },
                "freshness": "On a source-backed re-import (e.g. a Gmail thread body), a matched record returns bodyChanged:true when the upstream body differs from the stored one. Pass --refresh to re-digest only when it changed (a no-op otherwise), or --replace-body to always re-chunk.",
                "kindGuidance": "Use event for travel, lodging, reservations, reminders, and all-day schedule blocks even if they have attendees. Use meeting for people-centered appointments.",
                "calendarMapping": {
                    "start": "--occurred-at",
                    "end": "--ended-at",
                    "typedDetails": "--event-json or --event-json-file",
                    "rawProviderPayload": "--metadata-json or --metadata-json-file",
                    "venueOrAddress": "--location",
                    "providerUrl": "--original-url",
                    "attendees": "--participant",
                    "selfAttendees": "--self-participant",
                    "knownPeople": "--link person:<id> or matching participant email",
                    "notes": "Calendar placeholders such as 'see Gmail for details' are incomplete unless the importer fetches the linked Gmail source or uses --raw-text-unavailable with a ledger note.",
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
            "importParticipantsAudit": {
                "usage": "brain --json import participants audit [--source <slug>] [--min-count <n>] [--limit <n>] [--fail-on-promote-candidates]",
                "returns": "unresolved interaction participant groups with counts, sources, first/latest interaction, sample titles, and recommendation promote|skip|review.",
            },
            "importParticipantsPromote": {
                "usage": "brain --json import participants promote --handle <email> --full-name <name> [--headline <text>] [--org <name>] [--org-domain <domain>] [--title <title>] [--current]",
                "purpose": "Create or reuse a person for a real participant, attach the email if safe, relink matching participant rows, and refresh relationship recency.",
            },
            "repairPersonEmailMove": {
                "usage": "brain --json repair person-email move --email <email> --from <person-id> --to <person-id> [--relink-participants]",
                "purpose": "Move an email handle between existing people and optionally relink matching participant rows.",
            },
            "repairPersonPhoneMove": {
                "usage": "brain --json repair person-phone move --phone <phone> --from <person-id> --to <person-id> [--relink-participants]",
                "purpose": "Move a phone handle between existing people and optionally relink matching phone-like participant rows.",
            },
            "repairParticipantsRelink": {
                "usage": "brain --json repair participants relink --handle <email|phone> --person <person-id> [--from-person <person-id>] [--force]",
                "purpose": "Relink unresolved participant rows for one handle to an existing person. Use --from-person to move rows from a wrong person; add --force only when the target is already linked and duplicate participant rows must be merged.",
            },
            "mergePerson": {
                "usage": "brain --json merge person --from <source-person-id> --to <target-person-id> [--dry-run] [--reason <text>]",
                "purpose": "Move duplicate person links and handles onto the canonical target, then archive the source. --dry-run reports the merge plan without writes.",
            },
            "archive": {
                "usage": "brain --json archive person <id> --reason <text> | brain --json archive organization <id> --reason <text>",
                "purpose": "Soft-archive mistaken person or organization records and write archive provenance. Organization archive blocks while current active affiliations remain.",
            },
            "unlink": {
                "usage": "brain --json unlink <kind:id> <kind:id> --reason <text>",
                "purpose": "Remove a typed relationship, such as a mistaken person-organization affiliation or wrong person/document/task/project link.",
            },
            "personMaintenance": {
                "usage": "brain --json person rename <id> --full-name <name> | brain --json person email add|remove <id> --email <email> | brain --json person phone add|remove <id> --phone <phone>",
                "purpose": "Maintain an existing person after dedupe finds a canonical record.",
            },
            "addAsset": {
                "usage": "brain --json add asset --file <path> --link <kind:id> [--role attachment|avatar|logo|screenshot|source_file]",
                "purpose": "Copy bytes into the managed assets directory and link them to a typed record.",
            },
            "addOrganization": {
                "usage": "brain --json add organization --name <name> [--domain <domain>] [--kind <kind>] [--headline <one-line>] [--website <url>] [--industry <industry>] [--location <loc>] [--source <slug> --external-id <id>]",
                "dedupe": "external identity, then normalized name, then normalized domain (www-stripped)",
            },
            "addProject": {
                "usage": "brain --json add project --name <name> [--status active|waiting|paused|done] [--kind <kind>] [--summary <summary>] [--source <slug> --external-id <id>] [--link kind:id...]",
                "purpose": "Create or enrich a durable project only after the user has explicitly agreed to the project boundary. Without user sign-off, link existing projects or use suggest project for inferred candidates.",
                "dedupe": "external identity, then normalized name",
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
                "purpose": "Durable curation queue for inferred or not-yet-approved structure, such as a possible project boundary or high-impact organization. Accepting performs the typed write and relinks the cited records; dismissals persist so a proposal is never re-raised.",
                "kinds": ["create_project", "create_organization"],
            },
            "addTask": {
                "usage": "brain --json add task --title <title> [--due-at <iso>] [--link kind:id...] [--evidence record_type:id#0] [--assignee <person-id>...]",
                "assigneeFlag": "Use --assignee <person-id> (repeatable) to mark someone as responsible for the task. Creates a task_people row with role='assignee'. Distinct from generic --link person:<id> which creates a generic person link.",
            },
            "tasksUpdate": {
                "usage": "brain --json tasks update <task-id> [--title <title>] [--description <text>] [--status open|waiting|done|cancelled] [--due-at <iso>] [--scheduled-for <date>] [--link kind:id...] --evidence record_type:id#0",
                "purpose": "Evidence-backed maintenance for existing tasks when an imported source clearly advances the task state. Interaction links also fill origin_interaction_id when blank.",
                "requiresEvidence": true,
            },
            "tasksComplete": {
                "usage": "brain --json tasks complete <task-id> --evidence record_type:id#0",
                "purpose": "Mark an existing task done with source evidence and a completed_at timestamp.",
                "requiresEvidence": true,
            },
            "addAiNote": {
                "usage": "brain --json add ai-note --kind <summary|action_items|decisions|risks|highlights|coaching|other> (--interaction <id>|--document <id>|--subject <kind:id>) (--text <text>|--text-file <path|->) [--evidence record_type:id#0]",
                "purpose": "Store narrative AI artifacts separately from raw evidence.",
            },
            "addFact": {
                "usage": "brain --json add fact --subject <kind:id> --key <key> (--value-text <text>|--value-json <json>) [--source-record <kind:id>] [--source <slug> --external-kind <kind> --external-id <id> [--refresh]] [--confidence <0..1>] [--evidence record_type:id~\"quote\"]",
                "purpose": "Append a structured claim without automatically promoting it to memory. Source-keyed facts are idempotent; pass --refresh to update that same imported fact.",
            },
            "promoteFact": {
                "usage": "brain --json promote fact <fact-id> --memory-kind <kind>",
                "purpose": "Promote a selected extracted fact into a curated hidden memory using the fact value as the memory claim.",
            },
            "tag": {
                "usage": "brain --json tag ensure --name <name> [--slug <slug>] | brain --json tag attach --tag <id|slug|name> --record <kind:id>",
                "purpose": "Ensure tags and attach them to typed records.",
            },
            "remember": {
                "usage": "brain --json remember --kind <fact|preference|decision|commitment|instruction|risk|idea> --claim <atomic claim> --link kind:id... [--evidence record_type:<id>#<chunk>|record_type:<id>~\"quote\"]",
                "rule": "Memories should be atomic and linked to visible evidence records.",
                "evidence": "Cite a universal content chunk by index (#0) or by a quote substring (~\"a phrase\") resolved against the record's chunks at write time, so you need not know chunk boundaries. Works for `remember`, `add task`, `tasks update`, `tasks complete`, `add ai-note`, and `add fact`.",
            },
            "self": {
                "usage": "brain --json self show | brain --json self set --full-name <name> [--email <email>...] [--phone <phone>...]",
                "purpose": "Show or set the single is_self person and its known handles. Registered emails/phones auto-resolve the user as an interaction participant without --self-participant.",
            },
            "today": {
                "usage": "brain --json today",
                "returns": "AI-ready daily brief context: generatedAt, date, userName, task buckets, waitingItems, recentInteractions, recentChanges, relationshipContext, activeProjects, and counts",
            },
            "reportDaily": {
                "usage": "brain --json report daily",
                "returns": "Same AI-ready daily brief context as `brain --json today`; use this from external agents that want to generate the narrative brief outside Tauri.",
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
