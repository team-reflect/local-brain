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
fn open_resilient(path: &Path) -> Connection {
    match open_registry(path) {
        Ok(conn) => conn,
        Err(_) => {
            let _ = fs::rename(path, path.with_extension("sqlite.corrupt"));
            open_registry(path).unwrap_or_else(|_| open_memory_registry())
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

/// Insert (or refresh) the record for `path` and mark it active, in one atomic
/// upsert. A provided non-empty `name` overwrites the stored name; otherwise the
/// existing name (or a derived default for a new brain) is kept.
fn mark_opened(conn: &Connection, path: &str, name: Option<&str>) -> AppResult<()> {
    let now = now_ms() as i64;
    let provided = name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string);
    let name_provided = provided.is_some();
    let name_value = provided.unwrap_or_else(|| derive_name(Path::new(path)));
    conn.execute(
        "INSERT INTO brains (path, name, color, created_ms, last_opened_ms)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(path) DO UPDATE SET
             last_opened_ms = excluded.last_opened_ms,
             name = CASE WHEN ?5 THEN excluded.name ELSE brains.name END",
        params![path, name_value, DEFAULT_COLOR, now, name_provided],
    )?;
    set_active_path(conn, path)
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
}

impl BrainState {
    /// Load (or create) the registry for the given app data layout. The default
    /// brain `default_db_path` only fixes where `registry.sqlite` lands when no
    /// platform data dir resolves; a brain is not registered until it is opened.
    pub fn load(default_db_path: &Path) -> Self {
        let registry_path = brain_schema::app_data_dir()
            .map(|dir| dir.join("registry.sqlite"))
            .unwrap_or_else(|| default_db_path.with_file_name("registry.sqlite"));
        Self {
            registry: Mutex::new(open_resilient(&registry_path)),
            switch: Mutex::new(()),
        }
    }

    fn lock(&self) -> AppResult<MutexGuard<'_, Connection>> {
        self.registry
            .lock()
            .map_err(|_| AppError::io("the brain registry lock was poisoned by an earlier panic"))
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
    pub fn active_candidate(&self, default_db_path: &Path) -> PathBuf {
        if let Some(env) = std::env::var_os("BRAIN_DB") {
            if !env.is_empty() {
                return PathBuf::from(env);
            }
        }
        if let Ok(conn) = self.registry.lock() {
            if let Ok(Some(active)) = active_path(&conn) {
                if !active.is_empty() && Path::new(&active).is_file() {
                    return PathBuf::from(active);
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
    let canonical = Path::new(&path)
        .canonicalize()
        .map_err(|err| AppError::not_found(format!("no brain at {path}: {err}")))?;
    if !canonical.is_file() {
        return Err(AppError::parse(format!(
            "not a brain database file: {path}"
        )));
    }
    let conn = brain_schema::open_and_migrate(&canonical)?;
    switch_to(&db, &brains, conn, &canonical, None)
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
    let key = normalize(&path);
    {
        let conn = brains.lock()?;
        let affected = conn.execute(
            "UPDATE brains SET name = ?2 WHERE path = ?1",
            params![key, trimmed],
        )?;
        if affected == 0 {
            return Err(AppError::not_found(format!(
                "no brain registered at {path}"
            )));
        }
    }
    brains.active_info(&db)
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
    let key = normalize(&path);
    {
        let conn = brains.lock()?;
        let affected = conn.execute(
            "UPDATE brains SET color = ?2 WHERE path = ?1",
            params![key, color],
        )?;
        if affected == 0 {
            return Err(AppError::not_found(format!(
                "no brain registered at {path}"
            )));
        }
    }
    brains.active_info(&db)
}

/// Drop a brain from the catalogue (does not delete the database file). The
/// active brain cannot be forgotten.
#[tauri::command]
pub fn forget_brain(
    db: State<'_, DbState>,
    brains: State<'_, BrainState>,
    path: String,
) -> AppResult<Vec<BrainInfo>> {
    let key = normalize(&path);
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
    let schema_version = db.schema_version().ok();
    let conn = brains.lock()?;
    conn.execute("DELETE FROM brains WHERE path = ?1", [&key])?;
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

    /// A registry backed by an in-memory SQLite database (no file on disk).
    fn memory_state() -> BrainState {
        BrainState {
            registry: Mutex::new(open_memory_registry()),
            switch: Mutex::new(()),
        }
    }

    /// A registry backed by an on-disk SQLite file, for persistence tests.
    fn file_state(path: &Path) -> BrainState {
        BrainState {
            registry: Mutex::new(open_registry(path).unwrap()),
            switch: Mutex::new(()),
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

        let conn = open_resilient(&path);
        assert!(all_records(&conn).unwrap().is_empty());
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
}
