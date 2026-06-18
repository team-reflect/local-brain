//! The brain registry: Local Brain's top-level workspace picker model.
//!
//! In Reflect a "graph" is the top-level container; Local Brain calls it a
//! **brain** — one self-contained SQLite database file — so the word "graph"
//! stays reserved for the Network graph *visualization*.
//!
//! A brain's own `settings` table lives *inside* that brain, so it cannot hold
//! the cross-brain catalogue the switcher needs (it must render brains that
//! aren't open). Following Reflect Open's "recents in OS app-config, not in a
//! graph" rule — but keeping Local Brain SQLite-first/local-first for durable
//! product state — this registry is its own small SQLite database at
//! `<app data dir>/registry.sqlite`, deliberately separate from every switchable
//! brain DB. It records every known brain's path, display name, identity color,
//! and timestamps (table `brains`), plus which brain is active (`registry_meta`).
//!
//! Rust owns it end to end: writes land in a WAL-backed SQLite transaction,
//! paths are canonicalized, and the actual connection swap (see [`DbState::swap`])
//! happens here. A failed open leaves the previously active brain intact, and a
//! corrupt registry file is moved aside and recreated so the app still starts.
//! If even that recreate fails the registry falls back to a non-persistent
//! in-memory catalogue so the app still launches, but every registry *write*
//! (switch, rename, recolor, forget) then fails loudly via [`BrainState::durable`]
//! rather than silently succeeding for the session and vanishing on next launch.
//! The registry's own database file can never be opened as a brain
//! (see [`BrainState::is_registry`]): doing so would run brain migrations on the
//! registry and leave a second live connection to the same file.
//!
//! Switching is ordered so the two stores can never disagree: a switch persists
//! the new active brain to this registry *before* it swaps the live [`DbState`]
//! connection (see [`switch_to`]). If the registry write fails the swap never
//! runs, so both the open connection and the recorded active brain stay on the
//! previous brain — there is no window where the UI shows one brain while reads
//! and writes hit another. Because the registry *is* a SQLite database read on
//! demand (no separate in-memory catalogue), a failed metadata write likewise
//! leaves the observable state exactly as it was; memory cannot drift from disk.
//!
//! That persist-before-swap ordering only protects a single switch; the registry
//! write and the live swap still take *separate* locks, so two overlapping
//! switches (rapid Switch clicks → concurrent `open_brain`/`create_brain`) could
//! interleave — both persist, then swap in the opposite order — and settle with
//! `registry_meta` recording one brain while the live connection is open on the
//! other. A dedicated switch mutex ([`BrainState::switch`]) closes that window:
//! every switch holds it across both the persist and the swap, so the two steps
//! are one indivisible critical section with respect to other switches and the
//! last switch to start always wins both stores. Ordinary reads and writes never
//! take this lock, so concurrent query throughput is unaffected.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use tauri::State;

use crate::db::DbState;
use crate::error::{AppError, AppResult};

/// The identity colors a brain can take, mirrored by the `brainColorSchema`
/// zod enum in `@local-brain/core`. `indigo` is the default (the app accent).
const BRAIN_COLORS: [&str; 9] = [
    "indigo", "blue", "teal", "green", "amber", "orange", "red", "pink", "purple",
];

const DEFAULT_COLOR: &str = "indigo";

/// One brain as the frontend sees it (camelCase to match the zod schema).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BrainInfo {
    /// Absolute, canonical path of the brain's SQLite file.
    pub path: String,
    /// User-facing display name.
    pub name: String,
    /// Identity color id (one of [`BRAIN_COLORS`]).
    pub color: String,
    pub created_ms: u64,
    pub last_opened_ms: u64,
    /// Whether this is the currently open brain.
    pub is_active: bool,
    /// Applied schema version — only resolved for the active brain (else null).
    pub schema_version: Option<i64>,
}

/// One catalogued brain (a row of the registry `brains` table).
#[derive(Debug, Clone, PartialEq, Eq)]
struct BrainRecord {
    path: String,
    name: String,
    color: String,
    created_ms: u64,
    last_opened_ms: u64,
}

/// Milliseconds since the Unix epoch (0 if the clock is before the epoch).
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

/// A friendly default name from a brain path: the parent folder name when the
/// file is the conventional `brain.sqlite`, otherwise the file stem.
fn derive_name(path: &Path) -> String {
    let stem = path.file_stem().and_then(|stem| stem.to_str());
    if matches!(stem, Some("brain")) {
        if let Some(parent) = path
            .parent()
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
        {
            if !parent.is_empty() {
                return parent.to_string();
            }
        }
    }
    stem.filter(|stem| !stem.is_empty())
        .unwrap_or("Brain")
        .to_string()
}

/// Canonicalize when the path exists, else fall back to the input string so
/// metadata-only operations (rename, color, forget) still match a record.
fn normalize(path: &str) -> String {
    Path::new(path)
        .canonicalize()
        .map(|canonical| canonical.display().to_string())
        .unwrap_or_else(|_| path.to_string())
}

fn require_color(color: &str) -> AppResult<()> {
    if BRAIN_COLORS.contains(&color) {
        Ok(())
    } else {
        Err(AppError::parse(format!("unknown brain color: {color}")))
    }
}

// ---- Registry SQLite store ------------------------------------------------

/// Create the registry tables if missing. Run on every open; the first
/// statement also fails fast when `conn` points at a file that is not a valid
/// SQLite database, which drives the corrupt-file recovery in [`open_resilient`].
fn ensure_schema(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;\
         PRAGMA synchronous = NORMAL;\
         CREATE TABLE IF NOT EXISTS brains (\
             path TEXT PRIMARY KEY,\
             name TEXT NOT NULL,\
             color TEXT NOT NULL DEFAULT 'indigo',\
             created_ms INTEGER NOT NULL DEFAULT 0,\
             last_opened_ms INTEGER NOT NULL DEFAULT 0\
         );\
         CREATE TABLE IF NOT EXISTS registry_meta (\
             key TEXT PRIMARY KEY,\
             value TEXT NOT NULL\
         );",
    )?;
    Ok(())
}

/// Open (creating if needed) the registry database at `path` with the shared
/// WAL + busy-timeout settings, and ensure its schema.
fn open_registry(path: &Path) -> AppResult<Connection> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let conn = Connection::open(path)?;
    conn.busy_timeout(Duration::from_millis(5000))?;
    ensure_schema(&conn)?;
    Ok(conn)
}

/// An always-usable in-memory registry — the last-resort fallback so the app can
/// still start (with an empty catalogue) even if no on-disk registry can open.
fn open_memory_registry() -> Connection {
    let conn = Connection::open_in_memory().expect("an in-memory SQLite database must open");
    ensure_schema(&conn).expect("the in-memory registry schema must apply");
    conn
}

/// Open the registry resiliently: a corrupt or non-SQLite file is moved aside
/// (`registry.sqlite.corrupt`) and recreated empty rather than failing startup —
/// matching the old JSON registry's "corrupt → empty default" behavior.
///
/// Returns the connection and a `durable` flag: `true` when it is backed by the
/// on-disk file, `false` for the last-resort in-memory fallback used only when no
/// on-disk registry can be opened *or* recreated. A non-durable registry keeps
/// the app usable for reads but must reject writes (see [`BrainState::durable`])
/// so a switch or metadata edit can't silently disappear on the next launch.
fn open_resilient(path: &Path) -> (Connection, bool) {
    match open_registry(path) {
        Ok(conn) => (conn, true),
        Err(_) => {
            let _ = fs::rename(path, path.with_extension("sqlite.corrupt"));
            match open_registry(path) {
                Ok(conn) => (conn, true),
                Err(_) => (open_memory_registry(), false),
            }
        }
    }
}

/// The active brain path recorded in `registry_meta`, if any.
fn active_path(conn: &Connection) -> AppResult<Option<String>> {
    conn.query_row(
        "SELECT value FROM registry_meta WHERE key = 'active_path'",
        [],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(AppError::from)
}

/// Record `path` as the active brain.
fn set_active_path(conn: &Connection, path: &str) -> AppResult<()> {
    conn.execute(
        "INSERT INTO registry_meta (key, value) VALUES ('active_path', ?1)\
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [path],
    )?;
    Ok(())
}

/// One brain record by path.
fn find(conn: &Connection, path: &str) -> AppResult<Option<BrainRecord>> {
    conn.query_row(
        "SELECT path, name, color, created_ms, last_opened_ms FROM brains WHERE path = ?1",
        [path],
        row_to_record,
    )
    .optional()
    .map_err(AppError::from)
}

/// Every catalogued brain, newest-opened first.
fn all_records(conn: &Connection) -> AppResult<Vec<BrainRecord>> {
    let mut stmt = conn.prepare(
        "SELECT path, name, color, created_ms, last_opened_ms FROM brains \
         ORDER BY last_opened_ms DESC, name ASC",
    )?;
    let rows = stmt.query_map([], row_to_record)?;
    rows.collect::<rusqlite::Result<Vec<_>>>()
        .map_err(AppError::from)
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<BrainRecord> {
    Ok(BrainRecord {
        path: row.get(0)?,
        name: row.get(1)?,
        color: row.get(2)?,
        created_ms: row.get::<_, i64>(3)? as u64,
        last_opened_ms: row.get::<_, i64>(4)? as u64,
    })
}

/// Insert (or refresh) the record for `path` and mark it active. The catalogue
/// upsert and the `active_path` metadata update run in **one SQLite transaction**
/// so the two registry stores can never disagree: if the active-path write fails
/// after the upsert, the whole transaction rolls back and the catalogue keeps no
/// orphaned row pointing at a brain the registry doesn't consider active. This
/// upholds the persist-before-swap guarantee — a half-applied open (catalogued
/// but not active) can't survive. A provided non-empty `name` overwrites the
/// stored name; otherwise the existing name (or a derived default for a new
/// brain) is kept.
///
/// The path is [`normalize`]d into the catalogue key (and the active pointer) so
/// the same brain reached by different spellings — a `$BRAIN_DB` pin, a stored
/// candidate path vs the startup `canonicalize` of it — always hits one row
/// instead of inserting a duplicate. A path whose file can't be canonicalized
/// falls back to its raw string, matching the metadata commands' [`normalize`].
fn mark_opened(conn: &Connection, path: &str, name: Option<&str>) -> AppResult<()> {
    let key = normalize(path);
    let now = now_ms() as i64;
    let provided = name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string);
    let name_provided = provided.is_some();
    let name_value = provided.unwrap_or_else(|| derive_name(Path::new(&key)));
    // One transaction over both writes: an `unchecked_transaction` keeps the
    // shared `&Connection` signature (callers hold the registry mutex, so there
    // is no concurrent transaction on this connection). Dropping `tx` without a
    // commit — e.g. when `set_active_path` fails — rolls the upsert back too.
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO brains (path, name, color, created_ms, last_opened_ms)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(path) DO UPDATE SET
             last_opened_ms = excluded.last_opened_ms,
             name = CASE WHEN ?5 THEN excluded.name ELSE brains.name END",
        params![key, name_value, DEFAULT_COLOR, now, name_provided],
    )?;
    set_active_path(&tx, &key)?;
    tx.commit().map_err(AppError::from)
}

/// Ensure a catalogue row exists for the live active brain so a metadata edit
/// (rename / color) can target it. The active brain can be valid yet
/// *uncatalogued* — [`active_info`] synthesizes a record when startup
/// [`register_active`] failed (its error is ignored in `lib.rs`) or for a
/// `$BRAIN_DB` pin that was never persisted — and Settings still offers rename
/// and color for it. Without a row those `UPDATE`s match nothing and return "not
/// found". This materializes a default row keyed on the active path if missing;
/// an existing row (its name/color/timestamps) and the active pointer are left
/// untouched, and a persistence failure surfaces before any edit lands.
fn ensure_catalogued(conn: &Connection, key: &str) -> AppResult<()> {
    let now = now_ms() as i64;
    let name = derive_name(Path::new(key));
    conn.execute(
        "INSERT INTO brains (path, name, color, created_ms, last_opened_ms)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(path) DO NOTHING",
        params![key, name, DEFAULT_COLOR, now],
    )?;
    Ok(())
}

/// Catalogued brains as [`BrainInfo`], newest-opened first, active flag set.
///
/// Active-ness and the schema version come from `live_active` — the path the live
/// [`DbState`] connection is actually open on — *not* the registry's recorded
/// `active_path`. The two can disagree (a startup `register_active` that failed,
/// or otherwise stale registry metadata), and the live connection is the source
/// of truth for which brain reads and writes hit; deriving from it means the list
/// can never flag the wrong brain active or attach a schema version to a brain
/// that is not open.
fn infos(
    conn: &Connection,
    live_active: Option<&Path>,
    active_schema_version: Option<i64>,
) -> AppResult<Vec<BrainInfo>> {
    let active = live_active
        .map(|path| path.display().to_string())
        .unwrap_or_default();
    let records = all_records(conn)?;
    Ok(records
        .into_iter()
        .map(|record| {
            let is_active = !active.is_empty() && record.path == active;
            BrainInfo {
                path: record.path,
                name: record.name,
                color: record.color,
                created_ms: record.created_ms,
                last_opened_ms: record.last_opened_ms,
                is_active,
                schema_version: if is_active {
                    active_schema_version
                } else {
                    None
                },
            }
        })
        .collect())
}

// ---- State ----------------------------------------------------------------

/// The process-wide brain registry, backed by its own SQLite database.
pub struct BrainState {
    registry: Mutex<Connection>,
    /// Serializes brain switches. A switch persists the new active brain to
    /// `registry` and then swaps the live [`DbState`] connection under two
    /// separate locks; holding this mutex across both makes that pair one
    /// indivisible critical section, so overlapping switches cannot interleave
    /// and leave `registry_meta` and the live connection on different brains.
    /// It guards only switches — ordinary reads/writes never take it.
    switch: Mutex<()>,
    /// Whether `registry` is backed by the on-disk file. `false` only for the
    /// in-memory fallback ([`open_resilient`]) used when no on-disk registry can
    /// be opened or recreated; in that state registry writes are refused (see
    /// [`BrainState::require_durable`]) so they can't silently vanish on restart.
    durable: bool,
    /// Canonical path of the registry's own database file, so [`open_brain`] can
    /// refuse to open it as a brain (see [`BrainState::is_registry`]).
    registry_path: PathBuf,
}

impl BrainState {
    /// Load (or create) the registry for the given app data layout. The default
    /// brain `default_db_path` only fixes where `registry.sqlite` lands when no
    /// platform data dir resolves; a brain is not registered until it is opened.
    pub fn load(default_db_path: &Path) -> Self {
        let registry_path = brain_schema::app_data_dir()
            .map(|dir| dir.join("registry.sqlite"))
            .unwrap_or_else(|| default_db_path.with_file_name("registry.sqlite"));
        let (registry, durable) = open_resilient(&registry_path);
        // open_resilient has created the file (unless it fell back to memory), so
        // canonicalize now to match the canonical path open_brain compares against;
        // on the in-memory fallback the raw path is fine since no brain can ever
        // resolve to an in-memory database.
        let registry_path = registry_path.canonicalize().unwrap_or(registry_path);
        Self {
            registry: Mutex::new(registry),
            switch: Mutex::new(()),
            durable,
            registry_path,
        }
    }

    fn lock(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.registry
            .lock()
            .map_err(|_| AppError::io("the brain registry lock was poisoned by an earlier panic"))
    }

    /// Whether `candidate` is this app's own registry database. Opening
    /// `registry.sqlite` as a brain would run brain migrations on the registry
    /// and leave a second live connection to the same file, so [`open_brain`]
    /// refuses it and [`active_candidate`] skips it at startup. The stored path is
    /// canonical; we re-canonicalize it on each call so a recreated registry still
    /// matches, and canonicalize `candidate` too so a relative/symlinked/`$BRAIN_DB`
    /// spelling of the same file still resolves to the registry.
    ///
    /// [`active_candidate`]: BrainState::active_candidate
    fn is_registry(&self, candidate: &Path) -> bool {
        let resolved = candidate.canonicalize();
        let candidate = resolved.as_deref().unwrap_or(candidate);
        if self.registry_path == candidate {
            return true;
        }
        matches!(self.registry_path.canonicalize(), Ok(canonical) if canonical == candidate)
    }

    /// Refuse a registry write when running on the non-persistent in-memory
    /// fallback ([`open_resilient`]). The catalogue still renders for the session,
    /// but a switch, rename, recolor, or forget would be lost on the next launch;
    /// failing loudly surfaces that instead of pretending the write succeeded.
    fn require_durable(&self) -> AppResult<()> {
        if self.durable {
            Ok(())
        } else {
            Err(AppError::io(
                "the brain registry could not be opened or recreated on disk, so it is \
                 running in a temporary in-memory fallback; changes to your brain list \
                 cannot be saved. Restart Local Brain after restoring access to its app \
                 data directory.",
            ))
        }
    }

    /// Acquire the switch lock, held for the whole of a [`switch_to`] so the
    /// registry persist and the live swap stay indivisible against other switches.
    fn switch_guard(&self) -> AppResult<MutexGuard<'_, ()>> {
        self.switch
            .lock()
            .map_err(|_| AppError::io("the brain switch lock was poisoned by an earlier panic"))
    }

    /// The brain to open at startup: `$BRAIN_DB` (CLI parity / explicit pin),
    /// else the last active brain if its file still exists, else the default.
    ///
    /// Neither the `$BRAIN_DB` pin nor a stale stored active path may resolve to
    /// our own `registry.sqlite`: startup runs [`open_and_migrate`] on whatever
    /// this returns, so returning the registry would migrate the catalogue like a
    /// brain and keep a second live connection to it — the same hazard
    /// [`open_brain`] guards against via [`is_registry`]. Both candidates are
    /// therefore filtered through [`is_registry`], falling through to the default
    /// brain (which is never the registry; see [`load`]) when they point at it.
    ///
    /// [`open_and_migrate`]: brain_schema::open_and_migrate
    /// [`is_registry`]: BrainState::is_registry
    /// [`load`]: BrainState::load
    pub fn active_candidate(&self, default_db_path: &Path) -> PathBuf {
        if let Some(env) = std::env::var_os("BRAIN_DB") {
            if !env.is_empty() {
                let pinned = PathBuf::from(env);
                if !self.is_registry(&pinned) {
                    return pinned;
                }
            }
        }
        if let Ok(conn) = self.registry.lock() {
            if let Ok(Some(active)) = active_path(&conn) {
                let stored = PathBuf::from(&active);
                if !active.is_empty() && stored.is_file() && !self.is_registry(&stored) {
                    return stored;
                }
            }
        }
        default_db_path.to_path_buf()
    }

    /// Record `canonical` as opened and active, persisting it to the registry
    /// database in one atomic upsert. Used at startup (best-effort) and as the
    /// durable half of a runtime switch — see [`switch_to`], which only swaps the
    /// live connection once this has committed.
    pub fn register_active(&self, canonical: &Path, name: Option<&str>) -> AppResult<()> {
        self.require_durable()?;
        let path = canonical.display().to_string();
        let conn = self.lock()?;
        mark_opened(&conn, &path, name)
    }

    fn active_info(&self, db: &DbState) -> AppResult<BrainInfo> {
        let active = db.active_path()?.display().to_string();
        let schema_version = db.schema_version().ok();
        let conn = self.lock()?;
        if let Some(record) = find(&conn, &active)? {
            Ok(BrainInfo {
                path: record.path,
                name: record.name,
                color: record.color,
                created_ms: record.created_ms,
                last_opened_ms: record.last_opened_ms,
                is_active: true,
                schema_version,
            })
        } else {
            // Defensive: the open brain isn't catalogued (e.g. a `$BRAIN_DB`
            // pin we never persisted). Synthesize a record from the path.
            Ok(BrainInfo {
                name: derive_name(Path::new(&active)),
                color: DEFAULT_COLOR.to_string(),
                created_ms: 0,
                last_opened_ms: 0,
                is_active: true,
                schema_version,
                path: active,
            })
        }
    }
}

/// Switch the live database to an already-opened, migrated brain.
///
/// Two invariants combine here:
///
/// 1. **Ordering.** The durable registry update ([`BrainState::register_active`])
///    must commit *before* the live [`DbState`] connection is swapped. If
///    persistence fails we return that error without swapping, so the open
///    connection — and the registry's recorded active brain — both stay on the
///    previous brain, leaving nothing for the frontend to fall out of sync with.
///    Swapping first (the old ordering) could leave the SQLite connection
///    pointing at the newly opened brain while the command reports failure and
///    the UI keeps showing — and reading/writing through — the old one.
/// 2. **Atomicity against other switches.** The persist and the swap take
///    separate locks, so we hold the switch mutex
///    ([`BrainState::switch_guard`]) across both. Without it, two overlapping
///    switches could both persist and then swap in the opposite order, settling
///    with `registry_meta` on one brain and the live connection on another;
///    holding it serializes switches so the last to start wins both stores.
fn switch_to(
    db: &DbState,
    brains: &BrainState,
    conn: Connection,
    canonical: &Path,
    name: Option<&str>,
) -> AppResult<BrainInfo> {
    // One switch at a time: persist + swap is a single critical section so
    // overlapping switches can't interleave the two stores onto different brains.
    let _switch = brains.switch_guard()?;
    // Durable first: persist the new active brain to the registry database.
    brains.register_active(canonical, name)?;
    // Only now point the live connection at it — this cannot fail except on a
    // poisoned lock, which already implies a crashed thread.
    db.swap(conn, canonical)?;
    brains.active_info(db)
}

// ---- Tauri commands -------------------------------------------------------

/// List every known brain, newest-opened first.
#[tauri::command]
pub fn list_brains(
    db: State<'_, DbState>,
    brains: State<'_, BrainState>,
) -> AppResult<Vec<BrainInfo>> {
    // Derive the active flag from the live connection, not the registry pointer,
    // so a stale `active_path` can't mark the wrong brain active (see [`infos`]).
    let live_active = db.active_path().ok();
    let schema_version = db.schema_version().ok();
    let conn = brains.lock()?;
    infos(&conn, live_active.as_deref(), schema_version)
}

/// The currently open brain.
#[tauri::command]
pub fn active_brain(db: State<'_, DbState>, brains: State<'_, BrainState>) -> AppResult<BrainInfo> {
    brains.active_info(&db)
}

/// Open an existing brain and make it active. Errors (bad path, open failure)
/// leave the current brain untouched.
#[tauri::command]
pub fn open_brain(
    db: State<'_, DbState>,
    brains: State<'_, BrainState>,
    path: String,
) -> AppResult<BrainInfo> {
    open_brain_impl(&db, &brains, &path)
}

fn open_brain_impl(db: &DbState, brains: &BrainState, path: &str) -> AppResult<BrainInfo> {
    let canonical = Path::new(path)
        .canonicalize()
        .map_err(|err| AppError::not_found(format!("no brain at {path}: {err}")))?;
    if !canonical.is_file() {
        return Err(AppError::parse(format!(
            "not a brain database file: {path}"
        )));
    }
    // Never open the app's own registry as a brain: that would migrate the
    // registry like a brain and leave a second live connection to the same file.
    if brains.is_registry(&canonical) {
        return Err(AppError::parse(format!(
            "{path} is Local Brain's internal brain registry, not a brain database"
        )));
    }
    let conn = brain_schema::open_and_migrate(&canonical)?;
    switch_to(db, brains, conn, &canonical, None)
}

/// Create a brand-new brain at `path`, then open it. `path` must be absolute and
/// must not already exist (open the existing one instead).
#[tauri::command]
pub fn create_brain(
    db: State<'_, DbState>,
    brains: State<'_, BrainState>,
    path: String,
    name: Option<String>,
) -> AppResult<BrainInfo> {
    let target = Path::new(&path);
    if !target.is_absolute() {
        return Err(AppError::parse(format!(
            "a new brain needs an absolute path: {path}"
        )));
    }
    if target.exists() {
        return Err(AppError::parse(format!(
            "a file already exists at {path} — open it instead"
        )));
    }
    let conn = brain_schema::open_and_migrate(target)?;
    let canonical = target
        .canonicalize()
        .unwrap_or_else(|_| target.to_path_buf());
    switch_to(&db, &brains, conn, &canonical, name.as_deref())
}

/// Apply a single-column metadata edit (rename / color) to a catalogued brain.
///
/// `update` must be an `UPDATE brains SET <col> = ?2 WHERE path = ?1` statement
/// and `value` its `?2`. The brain is keyed on [`normalize`]d `raw_path`. If that
/// key is the *live* active brain (per [`DbState`]) the row is materialized first
/// via [`ensure_catalogued`], so edits to a synthesized/uncatalogued active brain
/// land instead of failing "not found". Any other uncatalogued path is still
/// rejected. A persistence failure (read-only registry) surfaces before the edit,
/// so the observable state stays exactly as it was.
fn edit_metadata(
    db: &DbState,
    brains: &BrainState,
    raw_path: &str,
    update: &str,
    value: &str,
) -> AppResult<BrainInfo> {
    brains.require_durable()?;
    let key = normalize(raw_path);
    let live_active = db
        .active_path()
        .ok()
        .map(|path| normalize(&path.display().to_string()));
    {
        let conn = brains.lock()?;
        if live_active.as_deref() == Some(key.as_str()) {
            ensure_catalogued(&conn, &key)?;
        }
        let affected = conn.execute(update, params![key, value])?;
        if affected == 0 {
            return Err(AppError::not_found(format!(
                "no brain registered at {raw_path}"
            )));
        }
    }
    brains.active_info(db)
}

/// Rename a brain in the catalogue.
#[tauri::command]
pub fn rename_brain(
    db: State<'_, DbState>,
    brains: State<'_, BrainState>,
    path: String,
    name: String,
) -> AppResult<BrainInfo> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::parse("a brain name cannot be empty"));
    }
    edit_metadata(
        &db,
        &brains,
        &path,
        "UPDATE brains SET name = ?2 WHERE path = ?1",
        trimmed,
    )
}

/// Set a brain's identity color.
#[tauri::command]
pub fn set_brain_color(
    db: State<'_, DbState>,
    brains: State<'_, BrainState>,
    path: String,
    color: String,
) -> AppResult<BrainInfo> {
    require_color(&color)?;
    edit_metadata(
        &db,
        &brains,
        &path,
        "UPDATE brains SET color = ?2 WHERE path = ?1",
        &color,
    )
}

/// Drop a brain from the catalogue (does not delete the database file). The
/// active brain cannot be forgotten.
#[tauri::command]
pub fn forget_brain(
    db: State<'_, DbState>,
    brains: State<'_, BrainState>,
    path: String,
) -> AppResult<Vec<BrainInfo>> {
    forget_brain_impl(&db, &brains, &path)
}

fn forget_brain_impl(db: &DbState, brains: &BrainState, path: &str) -> AppResult<Vec<BrainInfo>> {
    let key = normalize(path);
    // Guard against forgetting the *live* active brain (the one reads/writes hit),
    // and derive the returned list's active flag from it too, so a stale registry
    // pointer can neither block a valid forget nor mislabel the survivors.
    let live_active = db.active_path().ok();
    let live_active_str = live_active.as_ref().map(|path| path.display().to_string());
    if live_active_str.as_deref() == Some(key.as_str()) {
        return Err(AppError::parse(
            "cannot forget the active brain — switch to another brain first",
        ));
    }
    // A non-durable (in-memory fallback) registry would lose the removal on
    // restart, so reject it rather than report a forget that silently comes back.
    brains.require_durable()?;
    let schema_version = db.schema_version().ok();
    let conn = brains.lock()?;
    // The DELETE and the active-path reconciliation run in one transaction so a
    // forget can never drop the catalogue row while leaving `active_path` naming
    // it — a half-applied forget would still let the next launch reopen it.
    let tx = conn.unchecked_transaction()?;
    // A DELETE that matches no row means the requested brain isn't catalogued
    // (a stale path, or a legacy spelling that no longer normalizes to the
    // stored key). Returning the unchanged list would imply the forget
    // succeeded, so surface it as "not found" instead of a silent no-op.
    let affected = tx.execute("DELETE FROM brains WHERE path = ?1", [&key])?;
    if affected == 0 {
        return Err(AppError::not_found(format!(
            "no brain registered at {path}"
        )));
    }
    // The forget guard only protects the *live* active brain; the registry's
    // recorded `active_path` can still name the brain we just removed (stale
    // metadata from a failed startup `register_active`). Forgetting doesn't
    // delete the database file, so leaving `active_path` pointing at the gone
    // brain would let `active_candidate` reopen it on the next launch. Reconcile
    // it to the live active brain — the source of truth — instead.
    if active_path(&tx)?.as_deref() == Some(key.as_str()) {
        match live_active_str.as_deref() {
            Some(live) => set_active_path(&tx, live)?,
            None => {
                tx.execute("DELETE FROM registry_meta WHERE key = 'active_path'", [])?;
            }
        }
    }
    tx.commit()?;
    infos(&conn, live_active.as_deref(), schema_version)
}

/// Reveal a brain's database file in the OS file manager (best effort).
#[tauri::command]
pub fn reveal_brain(path: String) -> AppResult<()> {
    tauri_plugin_opener::reveal_item_in_dir(&path)
        .map_err(|err| AppError::io(format!("could not reveal {path}: {err}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    /// A registry backed by an in-memory SQLite database (no file on disk),
    /// treated as durable: it stands in for a normal on-disk registry in tests
    /// that don't exercise the non-durable fallback.
    fn memory_state() -> BrainState {
        BrainState {
            registry: Mutex::new(open_memory_registry()),
            switch: Mutex::new(()),
            durable: true,
            registry_path: PathBuf::new(),
        }
    }

    /// A registry backed by an on-disk SQLite file, for persistence tests. Its
    /// canonical `registry_path` is recorded so the open-brain guard can be tested.
    fn file_state(path: &Path) -> BrainState {
        BrainState {
            registry: Mutex::new(open_registry(path).unwrap()),
            switch: Mutex::new(()),
            durable: true,
            registry_path: path.canonicalize().unwrap_or_else(|_| path.to_path_buf()),
        }
    }

    /// A registry whose connection rejects every write (`PRAGMA query_only`),
    /// standing in for a persistence failure (disk full, I/O error, ...).
    fn read_only_state() -> BrainState {
        let conn = open_memory_registry();
        conn.execute_batch("PRAGMA query_only = ON;").unwrap();
        BrainState {
            registry: Mutex::new(conn),
            switch: Mutex::new(()),
            durable: true,
            registry_path: PathBuf::new(),
        }
    }

    /// A non-durable registry: the in-memory fallback used when no on-disk
    /// registry can be opened or recreated. Writes through it must fail loudly so
    /// they can't silently vanish on the next launch.
    fn non_durable_state() -> BrainState {
        BrainState {
            registry: Mutex::new(open_memory_registry()),
            switch: Mutex::new(()),
            durable: false,
            registry_path: PathBuf::new(),
        }
    }

    #[test]
    fn derive_name_prefers_parent_for_default_filename() {
        assert_eq!(derive_name(Path::new("/x/Work/brain.sqlite")), "Work");
        assert_eq!(derive_name(Path::new("/x/personal.sqlite")), "personal");
    }

    #[test]
    fn register_active_persists_and_round_trips() {
        let dir = tempdir().unwrap();
        let registry_path = dir.path().join("registry.sqlite");
        let path = dir.path().join("Work").join("brain.sqlite");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"db").unwrap();
        let canonical = path.canonicalize().unwrap();

        {
            let brains = file_state(&registry_path);
            brains.register_active(&canonical, None).unwrap();
        } // drop the connection so the WAL is flushed before reopening

        // Reopen from disk: the entry, name, color, and active pointer survive.
        let reopened = open_registry(&registry_path).unwrap();
        let records = all_records(&reopened).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(
            active_path(&reopened).unwrap().unwrap(),
            canonical.display().to_string()
        );
        assert_eq!(records[0].name, "Work");
        assert_eq!(records[0].color, DEFAULT_COLOR);
        assert!(records[0].created_ms > 0);
    }

    #[test]
    fn mark_opened_rolls_back_catalogue_when_active_update_fails() {
        // Bugbot Medium regression: the catalogue upsert and the active-path
        // metadata update must run in one transaction. If the active-path write
        // fails after the upsert, the whole thing rolls back — otherwise the
        // catalogue would record the open while `active_path` stayed stale,
        // contradicting the persist-before-swap guarantee.
        let brains = memory_state();
        let conn = brains.lock().unwrap();

        // Force only the second write (into registry_meta) to fail, after the
        // catalogue upsert has already run inside the transaction.
        conn.execute_batch(
            "CREATE TRIGGER fail_active BEFORE INSERT ON registry_meta \
             BEGIN SELECT RAISE(ABORT, 'simulated active-path write failure'); END;",
        )
        .unwrap();

        let result = mark_opened(&conn, "/x/brain.sqlite", Some("X"));
        assert!(result.is_err(), "the active-path write must fail");

        // The catalogue upsert rolled back with it: no orphaned row, and no
        // active pointer left dangling.
        assert!(
            all_records(&conn).unwrap().is_empty(),
            "the catalogue upsert must roll back when the active-path update fails"
        );
        assert!(
            active_path(&conn).unwrap().is_none(),
            "no active pointer must survive a rolled-back open"
        );
    }

    #[test]
    fn rename_and_color_mutate_the_record() {
        let brains = memory_state();
        let conn = brains.lock().unwrap();
        mark_opened(&conn, "/x/brain.sqlite", None).unwrap();

        conn.execute(
            "UPDATE brains SET name = 'Renamed' WHERE path = ?1",
            ["/x/brain.sqlite"],
        )
        .unwrap();
        conn.execute(
            "UPDATE brains SET color = 'teal' WHERE path = ?1",
            ["/x/brain.sqlite"],
        )
        .unwrap();

        let record = find(&conn, "/x/brain.sqlite").unwrap().unwrap();
        assert_eq!(record.name, "Renamed");
        assert_eq!(record.color, "teal");

        require_color("teal").unwrap();
        assert!(require_color("chartreuse").is_err());
    }

    #[test]
    fn forget_removes_non_active_and_keeps_active() {
        let brains = memory_state();
        let conn = brains.lock().unwrap();
        mark_opened(&conn, "/a/brain.sqlite", Some("A")).unwrap();
        mark_opened(&conn, "/b/brain.sqlite", Some("B")).unwrap(); // active = B
        assert_eq!(active_path(&conn).unwrap().unwrap(), "/b/brain.sqlite");

        // Forgetting A (non-active) succeeds; B stays.
        conn.execute("DELETE FROM brains WHERE path = ?1", ["/a/brain.sqlite"])
            .unwrap();
        let records = all_records(&conn).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].path, "/b/brain.sqlite");

        // infos() marks the live active brain and orders newest-opened first.
        let infos = infos(&conn, Some(Path::new("/b/brain.sqlite")), Some(2)).unwrap();
        assert!(infos[0].is_active);
        assert_eq!(infos[0].schema_version, Some(2));
    }

    #[test]
    fn forget_unknown_path_errors_instead_of_silent_no_op() {
        // Bugbot Low regression: forgetting a path that matches no catalogue row
        // (a stale path, or a legacy spelling that no longer normalizes to the
        // stored key) must report failure. A DELETE affecting zero rows used to
        // succeed and return an unchanged list, which reads as "forgotten".
        let dir = tempdir().unwrap();
        let active = dir.path().join("active.sqlite");
        let (db, _) = live_db(&active);
        let brains = memory_state();
        {
            let conn = brains.lock().unwrap();
            mark_opened(&conn, "/a/brain.sqlite", Some("A")).unwrap();
        }

        let result = forget_brain_impl(&db, &brains, "/nope/missing.sqlite");
        assert!(
            result.is_err(),
            "forgetting an uncatalogued brain must error, not silently no-op"
        );

        // The catalogued brain is untouched by the failed forget.
        let conn = brains.lock().unwrap();
        let records = all_records(&conn).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].path, "/a/brain.sqlite");
    }

    #[test]
    fn forget_clears_stale_active_path_pointing_at_removed_brain() {
        // Bugbot Medium regression: the forget guard only protects the *live*
        // active brain, but the registry's recorded `active_path` can be stale and
        // name a *different* brain (a failed startup `register_active`). Forgetting
        // that stale-active brain used to DELETE its row while leaving `active_path`
        // pointing at it — and since forget never deletes the file, the next launch
        // would reopen the forgotten brain. The forget must reconcile `active_path`
        // to the live active brain instead.
        let dir = tempdir().unwrap();
        let live = dir.path().join("live.sqlite");
        let (db, live_key) = live_db(&live);
        let brains = memory_state();
        {
            let conn = brains.lock().unwrap();
            mark_opened(&conn, &live_key, Some("Live")).unwrap();
            // Catalogue a second brain and force the registry pointer stale to it,
            // even though the live connection is open on `live`.
            mark_opened(&conn, "/stale/brain.sqlite", Some("Stale")).unwrap();
            set_active_path(&conn, "/stale/brain.sqlite").unwrap();
            assert_eq!(active_path(&conn).unwrap().unwrap(), "/stale/brain.sqlite");
        }

        // Forgetting the stale-active (but not live-active) brain succeeds...
        let remaining = forget_brain_impl(&db, &brains, "/stale/brain.sqlite").unwrap();
        assert!(
            remaining
                .iter()
                .all(|info| info.path != "/stale/brain.sqlite"),
            "the forgotten brain must not appear in the returned list"
        );

        // ...and `active_path` no longer dangles at the removed brain — it now
        // names the live active brain, so the next launch reopens the right one.
        let conn = brains.lock().unwrap();
        assert_eq!(
            active_path(&conn).unwrap().unwrap(),
            live_key,
            "active_path must be reconciled to the live brain, not the removed one"
        );
    }

    #[test]
    fn forget_leaves_active_path_when_a_different_brain_is_recorded() {
        // The reconciliation must be surgical: forgetting a brain that is *not* the
        // recorded active one leaves `active_path` untouched.
        let dir = tempdir().unwrap();
        let live = dir.path().join("live.sqlite");
        let (db, live_key) = live_db(&live);
        let brains = memory_state();
        {
            let conn = brains.lock().unwrap();
            mark_opened(&conn, &live_key, Some("Live")).unwrap(); // active_path = live
            mark_opened(&conn, "/other/brain.sqlite", Some("Other")).unwrap();
            set_active_path(&conn, &live_key).unwrap();
        }

        forget_brain_impl(&db, &brains, "/other/brain.sqlite").unwrap();

        let conn = brains.lock().unwrap();
        assert_eq!(
            active_path(&conn).unwrap().unwrap(),
            live_key,
            "forgetting an unrelated brain must not disturb active_path"
        );
    }

    #[test]
    fn forget_removes_catalogued_non_active_brain() {
        // The companion to the guard above: a forget that matches a real,
        // non-active catalogue row still succeeds and drops it.
        let dir = tempdir().unwrap();
        let active = dir.path().join("active.sqlite");
        let (db, _) = live_db(&active);
        let brains = memory_state();
        {
            let conn = brains.lock().unwrap();
            mark_opened(&conn, "/a/brain.sqlite", Some("A")).unwrap();
        }

        let remaining = forget_brain_impl(&db, &brains, "/a/brain.sqlite").unwrap();
        assert!(
            remaining.iter().all(|info| info.path != "/a/brain.sqlite"),
            "the forgotten brain must not appear in the returned list"
        );
        let conn = brains.lock().unwrap();
        assert!(
            all_records(&conn).unwrap().is_empty(),
            "the catalogue row must be gone"
        );
    }

    #[test]
    fn infos_derives_active_from_live_db_not_stale_registry() {
        // Bug regression: list_brains must mark active-ness from the live DbState
        // open path, not the registry's recorded active_path. If a startup
        // `register_active` failed (ignored with `let _ =` in lib.rs) the registry
        // pointer can be stale — here it points at A while the live connection is
        // open on B. The list must flag B active (with the schema version) and A
        // inactive, never the reverse.
        let brains = memory_state();
        let conn = brains.lock().unwrap();
        mark_opened(&conn, "/a/brain.sqlite", Some("A")).unwrap(); // registry active = A
        mark_opened(&conn, "/b/brain.sqlite", Some("B")).unwrap(); // registry active = B
        set_active_path(&conn, "/a/brain.sqlite").unwrap(); // ...but force it stale to A
        assert_eq!(active_path(&conn).unwrap().unwrap(), "/a/brain.sqlite");

        // The live connection is actually open on B.
        let live = infos(&conn, Some(Path::new("/b/brain.sqlite")), Some(7)).unwrap();
        let by_path = |path: &str| live.iter().find(|info| info.path == path).unwrap();

        let b = by_path("/b/brain.sqlite");
        assert!(b.is_active, "the live brain (B) must be active");
        assert_eq!(b.schema_version, Some(7), "schema version attaches to B");

        let a = by_path("/a/brain.sqlite");
        assert!(
            !a.is_active,
            "the stale registry pointer (A) must not be active"
        );
        assert_eq!(
            a.schema_version, None,
            "no schema version on a non-open brain"
        );

        // Exactly one brain is active.
        assert_eq!(live.iter().filter(|info| info.is_active).count(), 1);

        // With no live brain open, nothing is flagged active (not even the
        // registry's recorded active_path).
        let none = infos(&conn, None, None).unwrap();
        assert!(none.iter().all(|info| !info.is_active));
    }

    #[test]
    fn corrupt_registry_falls_back_to_empty() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("registry.sqlite");
        std::fs::write(&path, b"this is not a sqlite database at all").unwrap();

        let (conn, durable) = open_resilient(&path);
        assert!(all_records(&conn).unwrap().is_empty());
        // The corrupt file is recreated on disk, so the registry stays durable.
        assert!(durable);
        // The corrupt file is moved aside, not silently overwritten.
        assert!(path.with_extension("sqlite.corrupt").exists());
    }

    #[test]
    fn active_candidate_prefers_existing_active_then_default() {
        let dir = tempdir().unwrap();
        let brains = memory_state();
        let default = dir.path().join("default.sqlite");

        // No active set and BRAIN_DB unset → default. (Guard against a stray env.)
        if std::env::var_os("BRAIN_DB").is_none() {
            assert_eq!(brains.active_candidate(&default), default);
        }

        // A real active file is preferred.
        let active = dir.path().join("active.sqlite");
        std::fs::write(&active, b"db").unwrap();
        {
            let conn = brains.lock().unwrap();
            set_active_path(&conn, &active.display().to_string()).unwrap();
        }
        if std::env::var_os("BRAIN_DB").is_none() {
            assert_eq!(brains.active_candidate(&default), active);
        }
    }

    #[test]
    fn active_candidate_skips_a_stale_registry_active_path() {
        // Bugbot High regression: startup runs open_and_migrate on whatever
        // active_candidate returns, with no is_registry guard of its own. A stale
        // stored active path pointing at registry.sqlite would migrate the
        // catalogue like a brain and open a second live connection to it. The
        // candidate must be filtered through is_registry and fall through to the
        // default brain. (The $BRAIN_DB pin shares the same guard.)
        let dir = tempdir().unwrap();
        let registry_path = dir.path().join("registry.sqlite");
        let brains = file_state(&registry_path);
        let default = dir.path().join("default.sqlite");

        // The registry file exists, so a non-canonical spelling of it still
        // resolves: record that stale path as the active brain.
        let stale = dir
            .path()
            .join(".")
            .join("registry.sqlite")
            .display()
            .to_string();
        {
            let conn = brains.lock().unwrap();
            set_active_path(&conn, &stale).unwrap();
        }

        // Guard against a stray $BRAIN_DB in the test environment masking this.
        if std::env::var_os("BRAIN_DB").is_none() {
            assert_eq!(
                brains.active_candidate(&default),
                default,
                "a stored active path pointing at the registry must not open it as a brain"
            );
        }
    }

    #[test]
    fn switch_does_not_swap_live_db_when_registry_persist_fails() {
        // Bug 1 regression: a switch must persist the new active brain to the
        // registry *before* swapping the live connection. If persistence fails,
        // the live DB must stay on the previous brain so the UI (which skips
        // cache invalidation on error) and the database keep pointing at the
        // same brain. The old swap-then-persist ordering left the connection on
        // the new brain while the command reported failure.
        let dir = tempdir().unwrap();

        // A live DB already open on the "old" brain.
        let old = dir.path().join("old.sqlite");
        let db = DbState::new(brain_schema::open_and_migrate(&old).unwrap(), old.clone());

        // A valid, migrated "new" brain we attempt to switch to.
        let new = dir.path().join("new.sqlite");
        let new_conn = brain_schema::open_and_migrate(&new).unwrap();
        let canonical = new.canonicalize().unwrap();

        // The registry rejects writes → the switch fails...
        let brains = read_only_state();
        let result = switch_to(&db, &brains, new_conn, &canonical, None);
        assert!(result.is_err());

        // ...and the live connection still points at the old brain.
        assert_eq!(db.active_path().unwrap(), old);
    }

    #[test]
    fn switch_persists_then_swaps_on_success() {
        let dir = tempdir().unwrap();
        let old = dir.path().join("old.sqlite");
        let db = DbState::new(brain_schema::open_and_migrate(&old).unwrap(), old.clone());

        let new = dir.path().join("Work").join("brain.sqlite");
        std::fs::create_dir_all(new.parent().unwrap()).unwrap();
        let new_conn = brain_schema::open_and_migrate(&new).unwrap();
        let canonical = new.canonicalize().unwrap();

        let brains = memory_state();
        let info = switch_to(&db, &brains, new_conn, &canonical, None).unwrap();

        // The live DB moved to the new brain...
        assert_eq!(db.active_path().unwrap(), canonical);
        // ...and the registry durably records it as the active brain.
        assert!(info.is_active);
        assert_eq!(info.path, canonical.display().to_string());
        let conn = brains.lock().unwrap();
        assert_eq!(
            active_path(&conn).unwrap().unwrap(),
            canonical.display().to_string()
        );
    }

    #[test]
    fn overlapping_switches_keep_registry_and_live_db_in_sync() {
        // Bug regression: overlapping switches (rapid Switch clicks driving
        // concurrent open_brain/create_brain) must not interleave the registry
        // persist and the live swap such that `registry_meta` settles on one brain
        // while the live connection is open on another. switch_to holds the switch
        // mutex across both steps, so however the two threads interleave the last
        // switch to start wins *both* stores and they always agree.
        let dir = tempdir().unwrap();

        let start = dir.path().join("start.sqlite");
        let db = DbState::new(
            brain_schema::open_and_migrate(&start).unwrap(),
            start.clone(),
        );

        let a = dir.path().join("a.sqlite");
        let b = dir.path().join("b.sqlite");
        // Migrate both up front so the threads only race the register + swap.
        brain_schema::open_and_migrate(&a).unwrap();
        brain_schema::open_and_migrate(&b).unwrap();
        let a = a.canonicalize().unwrap();
        let b = b.canonicalize().unwrap();

        let brains = memory_state();

        // Many rounds of two simultaneous switches in opposite directions: the
        // window the switch mutex closes is timing-dependent, so we hammer it.
        for _ in 0..200 {
            std::thread::scope(|scope| {
                scope.spawn(|| {
                    let conn = brain_schema::open_and_migrate(&a).unwrap();
                    let _ = switch_to(&db, &brains, conn, &a, None);
                });
                scope.spawn(|| {
                    let conn = brain_schema::open_and_migrate(&b).unwrap();
                    let _ = switch_to(&db, &brains, conn, &b, None);
                });
            });

            // Whichever switch resolved last, both stores must name the same brain.
            let live = db.active_path().unwrap().display().to_string();
            let recorded = {
                let conn = brains.lock().unwrap();
                active_path(&conn).unwrap().unwrap()
            };
            assert_eq!(
                live, recorded,
                "registry_meta and the live DbState must not desync after overlapping switches"
            );
            assert!(
                live == a.display().to_string() || live == b.display().to_string(),
                "the live brain must be one of the two switch targets"
            );
        }
    }

    #[test]
    fn failed_metadata_write_leaves_registry_state_unchanged() {
        // Bug 2 regression: the SQLite registry is read on demand with no
        // separate in-memory catalogue, so a metadata write that fails leaves
        // the observable state exactly as it was. The old path mutated an
        // in-memory Vec before writing JSON, so a failed write diverged from
        // disk until restart.
        let brains = memory_state();
        let conn = brains.lock().unwrap();
        mark_opened(&conn, "/x/brain.sqlite", Some("Original")).unwrap();
        conn.execute(
            "UPDATE brains SET color = ?2 WHERE path = ?1",
            params!["/x/brain.sqlite", "teal"],
        )
        .unwrap();

        // Reject writes, then attempt the same mutations the commands issue.
        conn.execute_batch("PRAGMA query_only = ON;").unwrap();
        assert!(conn
            .execute(
                "UPDATE brains SET name = ?2 WHERE path = ?1",
                params!["/x/brain.sqlite", "Renamed"],
            )
            .is_err());
        assert!(conn
            .execute(
                "UPDATE brains SET color = ?2 WHERE path = ?1",
                params!["/x/brain.sqlite", "red"],
            )
            .is_err());

        // Re-enable reads/writes and confirm nothing changed on the failed path.
        conn.execute_batch("PRAGMA query_only = OFF;").unwrap();
        let record = find(&conn, "/x/brain.sqlite").unwrap().unwrap();
        assert_eq!(record.name, "Original");
        assert_eq!(record.color, "teal");
    }

    const RENAME_SQL: &str = "UPDATE brains SET name = ?2 WHERE path = ?1";
    const COLOR_SQL: &str = "UPDATE brains SET color = ?2 WHERE path = ?1";

    /// A live DB open on a freshly migrated brain at `path`, with its canonical
    /// path (so `active_path()` matches the registry's normalized key).
    fn live_db(path: &Path) -> (DbState, String) {
        let conn = brain_schema::open_and_migrate(path).unwrap();
        let canonical = path.canonicalize().unwrap();
        let key = canonical.display().to_string();
        (DbState::new(conn, canonical), key)
    }

    #[test]
    fn mark_opened_dedupes_path_spellings() {
        // Bug 2 regression: the catalogue must key on the canonical path, so the
        // same brain reached by different spellings (a stored candidate path vs
        // the startup `canonicalize` of it) updates one row instead of listing
        // the brain twice.
        let dir = tempdir().unwrap();
        let nested = dir.path().join("Work");
        std::fs::create_dir_all(&nested).unwrap();
        let path = nested.join("brain.sqlite");
        std::fs::write(&path, b"db").unwrap();

        let brains = memory_state();
        let conn = brains.lock().unwrap();

        let canonical = path.canonicalize().unwrap().display().to_string();
        // A non-canonical spelling of the same file ("…/Work/./brain.sqlite").
        let dotted = nested.join(".").join("brain.sqlite").display().to_string();
        assert_ne!(canonical, dotted, "the spellings must actually differ");

        mark_opened(&conn, &canonical, Some("First")).unwrap();
        mark_opened(&conn, &dotted, None).unwrap();

        let records = all_records(&conn).unwrap();
        assert_eq!(records.len(), 1, "the same brain must not list twice");
        assert_eq!(records[0].path, canonical);
        // The active pointer normalizes too, so it names the single row.
        assert_eq!(active_path(&conn).unwrap().unwrap(), canonical);
    }

    #[test]
    fn edit_materializes_uncatalogued_active_brain() {
        // Bug 1 regression: the active brain can be valid yet uncatalogued — a
        // synthesized record when startup `register_active` failed or a
        // `$BRAIN_DB` pin was never persisted. Settings still offers rename and
        // color, so those edits must materialize the row and land, not 404.
        let dir = tempdir().unwrap();
        let path = dir.path().join("Work").join("brain.sqlite");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let (db, key) = live_db(&path);

        // An empty registry: the live active brain has no catalogue row.
        let brains = memory_state();
        {
            let conn = brains.lock().unwrap();
            assert!(find(&conn, &key).unwrap().is_none());
        }

        // Rename then recolor the active brain through the command path.
        let renamed = edit_metadata(&db, &brains, &key, RENAME_SQL, "Renamed").unwrap();
        assert_eq!(renamed.name, "Renamed");
        assert!(renamed.is_active);
        let recolored = edit_metadata(&db, &brains, &key, COLOR_SQL, "teal").unwrap();
        assert_eq!(recolored.color, "teal");
        assert_eq!(recolored.name, "Renamed", "the rename is preserved");

        // Exactly one row now exists, carrying both edits.
        let conn = brains.lock().unwrap();
        let records = all_records(&conn).unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].name, "Renamed");
        assert_eq!(records[0].color, "teal");
    }

    #[test]
    fn edit_rejects_unknown_non_active_path() {
        // A path that is neither catalogued nor the live active brain is still
        // rejected — only the active brain gets materialized on demand.
        let dir = tempdir().unwrap();
        let active = dir.path().join("active.sqlite");
        let (db, _) = live_db(&active);
        let brains = memory_state();

        let result = edit_metadata(
            &db,
            &brains,
            "/nonexistent/other.sqlite",
            RENAME_SQL,
            "Nope",
        );
        assert!(result.is_err(), "an unknown non-active path must 404");

        // ...and no row was conjured for it.
        let conn = brains.lock().unwrap();
        assert!(all_records(&conn).unwrap().is_empty());
    }

    #[test]
    fn edit_on_readonly_registry_creates_no_row() {
        // Persistence/failure invariant: if materializing the active brain's row
        // fails (read-only registry), the edit errors and nothing is catalogued —
        // the observable state stays exactly as it was.
        let dir = tempdir().unwrap();
        let active = dir.path().join("active.sqlite");
        let (db, key) = live_db(&active);
        let brains = read_only_state();

        let result = edit_metadata(&db, &brains, &key, RENAME_SQL, "X");
        assert!(result.is_err());

        let conn = brains.lock().unwrap();
        conn.execute_batch("PRAGMA query_only = OFF;").unwrap();
        assert!(
            all_records(&conn).unwrap().is_empty(),
            "a failed edit must not catalogue the brain"
        );
    }

    #[test]
    fn open_brain_rejects_the_registry_file() {
        // Bugbot High regression: open_brain must refuse to open the app's own
        // registry.sqlite as a brain. Doing so would run brain migrations on the
        // registry DB, point DbState at it, and leave a second live connection to
        // the same file for the catalogue. is_registry guards on the canonical path.
        let dir = tempdir().unwrap();
        let registry_path = dir.path().join("registry.sqlite");
        let brains = file_state(&registry_path);

        // A live DB already open on a real brain.
        let old = dir.path().join("old.sqlite");
        let db = DbState::new(brain_schema::open_and_migrate(&old).unwrap(), old.clone());

        // Opening the registry path — even via a non-canonical spelling — is refused.
        let dotted = dir
            .path()
            .join(".")
            .join("registry.sqlite")
            .display()
            .to_string();
        let result = open_brain_impl(&db, &brains, &dotted);
        assert!(result.is_err(), "the registry must not open as a brain");

        // The live connection still points at the original brain, untouched.
        assert_eq!(db.active_path().unwrap(), old);
        // The registry was not catalogued or migrated as a brain.
        let conn = brains.lock().unwrap();
        assert!(all_records(&conn).unwrap().is_empty());
    }

    #[test]
    fn open_brain_opens_a_real_brain() {
        // The guard rejects only the registry itself — an ordinary brain still opens.
        let dir = tempdir().unwrap();
        let registry_path = dir.path().join("registry.sqlite");
        let brains = file_state(&registry_path);

        let old = dir.path().join("old.sqlite");
        let db = DbState::new(brain_schema::open_and_migrate(&old).unwrap(), old.clone());

        let target = dir.path().join("Work").join("brain.sqlite");
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        brain_schema::open_and_migrate(&target).unwrap();
        let canonical = target.canonicalize().unwrap();

        let info = open_brain_impl(&db, &brains, &target.display().to_string()).unwrap();
        assert!(info.is_active);
        assert_eq!(db.active_path().unwrap(), canonical);
    }

    #[test]
    fn non_durable_registry_blocks_switch_loudly() {
        // Bugbot Medium regression: when the registry fell back to a
        // non-persistent in-memory store, a switch would appear to succeed for the
        // session and silently disappear on the next launch. switch_to must now
        // fail loudly and leave the live DB on the previous brain.
        let dir = tempdir().unwrap();
        let old = dir.path().join("old.sqlite");
        let db = DbState::new(brain_schema::open_and_migrate(&old).unwrap(), old.clone());

        let new = dir.path().join("new.sqlite");
        let new_conn = brain_schema::open_and_migrate(&new).unwrap();
        let canonical = new.canonicalize().unwrap();

        let brains = non_durable_state();
        let result = switch_to(&db, &brains, new_conn, &canonical, None);
        assert!(
            result.is_err(),
            "a switch on a non-durable registry must fail"
        );
        assert_eq!(
            db.active_path().unwrap(),
            old,
            "the live DB must stay on the previous brain"
        );
    }

    #[test]
    fn non_durable_registry_blocks_metadata_and_forget() {
        // The same lost-save guard must cover metadata edits and forget, which
        // would otherwise report success and vanish on restart.
        let dir = tempdir().unwrap();
        let active = dir.path().join("active.sqlite");
        let (db, key) = live_db(&active);
        let brains = non_durable_state();

        assert!(
            edit_metadata(&db, &brains, &key, RENAME_SQL, "X").is_err(),
            "rename on a non-durable registry must fail"
        );
        assert!(
            edit_metadata(&db, &brains, &key, COLOR_SQL, "teal").is_err(),
            "recolor on a non-durable registry must fail"
        );
        assert!(
            forget_brain_impl(&db, &brains, "/some/other.sqlite").is_err(),
            "forget on a non-durable registry must fail"
        );
    }

    #[test]
    fn durable_registry_still_allows_writes() {
        // The guard must not regress normal operation: a durable registry accepts
        // a switch and the metadata edits exactly as before.
        let dir = tempdir().unwrap();
        let old = dir.path().join("old.sqlite");
        let db = DbState::new(brain_schema::open_and_migrate(&old).unwrap(), old.clone());

        let new = dir.path().join("Work").join("brain.sqlite");
        std::fs::create_dir_all(new.parent().unwrap()).unwrap();
        let new_conn = brain_schema::open_and_migrate(&new).unwrap();
        let canonical = new.canonicalize().unwrap();

        let brains = memory_state(); // durable
        let info = switch_to(&db, &brains, new_conn, &canonical, None).unwrap();
        assert!(info.is_active);
        assert_eq!(db.active_path().unwrap(), canonical);
    }
}
