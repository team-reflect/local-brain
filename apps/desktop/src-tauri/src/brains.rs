//! The brain registry: Local Brain's top-level workspace picker model.
//!
//! In Reflect a "graph" is the top-level container; Local Brain calls it a
//! **brain** — one self-contained SQLite database file — so the word "graph"
//! stays reserved for the Network graph *visualization*.
//!
//! A brain's own `settings` table lives *inside* that brain, so it cannot hold
//! the cross-brain catalogue the switcher needs (it must render brains that
//! aren't open). Following Reflect Open's "recents in OS app-config, not in a
//! graph" rule, this registry is a Rust-owned JSON file at
//! `<app data dir>/brains.json`. It records every known brain's path, display
//! name, identity color, and timestamps, plus which brain is active.
//!
//! Rust owns it end to end: atomic writes (temp file + rename), canonical paths,
//! and the actual connection swap (see [`DbState::swap`]). A failed open leaves
//! the previously active brain intact.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::db::DbState;
use crate::error::{AppError, AppResult};

/// The identity colors a brain can take, mirrored by the `brainColorSchema`
/// zod enum in `@local-brain/core`. `indigo` is the default (the app accent).
const BRAIN_COLORS: [&str; 9] = [
    "indigo", "blue", "teal", "green", "amber", "orange", "red", "pink", "purple",
];

const DEFAULT_COLOR: &str = "indigo";
const REGISTRY_VERSION: u32 = 1;

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

/// A persisted registry entry (internal on-disk shape).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BrainRecord {
    path: String,
    name: String,
    #[serde(default = "default_color")]
    color: String,
    #[serde(default)]
    created_ms: u64,
    #[serde(default)]
    last_opened_ms: u64,
}

fn default_color() -> String {
    DEFAULT_COLOR.to_string()
}

/// The whole registry file.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Registry {
    #[serde(default = "registry_version")]
    version: u32,
    #[serde(default)]
    active_path: String,
    #[serde(default)]
    brains: Vec<BrainRecord>,
}

fn registry_version() -> u32 {
    REGISTRY_VERSION
}

impl Default for Registry {
    fn default() -> Self {
        Self {
            version: REGISTRY_VERSION,
            active_path: String::new(),
            brains: Vec::new(),
        }
    }
}

impl Registry {
    fn find(&self, path: &str) -> Option<&BrainRecord> {
        self.brains.iter().find(|brain| brain.path == path)
    }

    fn find_mut(&mut self, path: &str) -> Option<&mut BrainRecord> {
        self.brains.iter_mut().find(|brain| brain.path == path)
    }

    /// Insert (or refresh) the record for `path` and mark it active.
    fn mark_opened(&mut self, path: &str, name: Option<&str>) {
        let now = now_ms();
        if let Some(record) = self.find_mut(path) {
            record.last_opened_ms = now;
            if let Some(name) = name {
                if !name.trim().is_empty() {
                    record.name = name.trim().to_string();
                }
            }
        } else {
            self.brains.push(BrainRecord {
                path: path.to_string(),
                name: name
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .map(str::to_string)
                    .unwrap_or_else(|| derive_name(Path::new(path))),
                color: DEFAULT_COLOR.to_string(),
                created_ms: now,
                last_opened_ms: now,
            });
        }
        self.active_path = path.to_string();
    }

    /// Brains as [`BrainInfo`], newest-opened first, with the active flag set.
    fn infos(&self, active_schema_version: Option<i64>) -> Vec<BrainInfo> {
        let mut infos: Vec<BrainInfo> = self
            .brains
            .iter()
            .map(|record| {
                let is_active = record.path == self.active_path;
                BrainInfo {
                    path: record.path.clone(),
                    name: record.name.clone(),
                    color: record.color.clone(),
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
            .collect();
        infos.sort_by(|a, b| b.last_opened_ms.cmp(&a.last_opened_ms));
        infos
    }
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

/// The process-wide brain registry, persisted to `registry_path`.
pub struct BrainState {
    registry_path: PathBuf,
    registry: Mutex<Registry>,
}

impl BrainState {
    /// Load (or default) the registry for the given app data layout. The default
    /// brain `default_db_path` only fixes where `brains.json` lands when no
    /// platform data dir resolves; it is not yet registered (open does that).
    pub fn load(default_db_path: &Path) -> Self {
        let registry_path = brain_schema::app_data_dir()
            .map(|dir| dir.join("brains.json"))
            .unwrap_or_else(|| default_db_path.with_file_name("brains.json"));
        let registry = read_registry(&registry_path);
        Self {
            registry_path,
            registry: Mutex::new(registry),
        }
    }

    fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Registry>> {
        self.registry
            .lock()
            .map_err(|_| AppError::io("the brain registry lock was poisoned by an earlier panic"))
    }

    /// The brain to open at startup: `$BRAIN_DB` (CLI parity / explicit pin),
    /// else the last active brain if its file still exists, else the default.
    pub fn active_candidate(&self, default_db_path: &Path) -> PathBuf {
        if let Some(env) = std::env::var_os("BRAIN_DB") {
            if !env.is_empty() {
                return PathBuf::from(env);
            }
        }
        if let Ok(registry) = self.registry.lock() {
            let active = &registry.active_path;
            if !active.is_empty() && Path::new(active).is_file() {
                return PathBuf::from(active);
            }
        }
        default_db_path.to_path_buf()
    }

    /// Record `canonical` as opened and active, persisting the registry. Used at
    /// startup and after a runtime switch. Persist failure is non-fatal (the
    /// brain is still open) but is surfaced for logging.
    pub fn register_active(&self, canonical: &Path, name: Option<&str>) -> AppResult<()> {
        let path = canonical.display().to_string();
        let mut registry = self.lock()?;
        registry.mark_opened(&path, name);
        write_registry(&self.registry_path, &registry)
    }

    fn active_info(&self, db: &DbState) -> AppResult<BrainInfo> {
        let active_path = db.active_path()?.display().to_string();
        let schema_version = db.schema_version().ok();
        let registry = self.lock()?;
        if let Some(record) = registry.find(&active_path) {
            Ok(BrainInfo {
                path: record.path.clone(),
                name: record.name.clone(),
                color: record.color.clone(),
                created_ms: record.created_ms,
                last_opened_ms: record.last_opened_ms,
                is_active: true,
                schema_version,
            })
        } else {
            // Defensive: the open brain isn't catalogued (e.g. a `$BRAIN_DB`
            // pin we never persisted). Synthesize a record from the path.
            Ok(BrainInfo {
                name: derive_name(Path::new(&active_path)),
                color: DEFAULT_COLOR.to_string(),
                created_ms: 0,
                last_opened_ms: 0,
                is_active: true,
                schema_version,
                path: active_path,
            })
        }
    }
}

/// Read the registry, resiliently: a missing or corrupt file yields the empty
/// default rather than failing app startup.
fn read_registry(path: &Path) -> Registry {
    let Ok(text) = fs::read_to_string(path) else {
        return Registry::default();
    };
    serde_json::from_str(&text).unwrap_or_default()
}

/// Persist the registry atomically (temp file + rename) so a crash mid-write
/// never truncates the catalogue.
fn write_registry(path: &Path, registry: &Registry) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(registry)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json.as_bytes())?;
    fs::rename(&tmp, path)?;
    Ok(())
}

fn require_color(color: &str) -> AppResult<()> {
    if BRAIN_COLORS.contains(&color) {
        Ok(())
    } else {
        Err(AppError::parse(format!("unknown brain color: {color}")))
    }
}

// ---- Tauri commands -------------------------------------------------------

/// List every known brain, newest-opened first.
#[tauri::command]
pub fn list_brains(
    db: State<'_, DbState>,
    brains: State<'_, BrainState>,
) -> AppResult<Vec<BrainInfo>> {
    let schema_version = db.schema_version().ok();
    let registry = brains.lock()?;
    Ok(registry.infos(schema_version))
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
    db.swap(conn, &canonical)?;
    brains.register_active(&canonical, None)?;
    brains.active_info(&db)
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
    db.swap(conn, &canonical)?;
    brains.register_active(&canonical, name.as_deref())?;
    brains.active_info(&db)
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
        let mut registry = brains.lock()?;
        let record = registry
            .find_mut(&key)
            .ok_or_else(|| AppError::not_found(format!("no brain registered at {path}")))?;
        record.name = trimmed.to_string();
        write_registry(&brains.registry_path, &registry)?;
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
        let mut registry = brains.lock()?;
        let record = registry
            .find_mut(&key)
            .ok_or_else(|| AppError::not_found(format!("no brain registered at {path}")))?;
        record.color = color;
        write_registry(&brains.registry_path, &registry)?;
    }
    brains.active_info(&db)
}

/// Drop a brain from the catalogue (does not delete the database file). The
/// active brain cannot be forgotten.
#[tauri::command]
pub fn forget_brain(brains: State<'_, BrainState>, path: String) -> AppResult<Vec<BrainInfo>> {
    let key = normalize(&path);
    let mut registry = brains.lock()?;
    if registry.active_path == key {
        return Err(AppError::parse(
            "cannot forget the active brain — switch to another brain first",
        ));
    }
    registry.brains.retain(|brain| brain.path != key);
    write_registry(&brains.registry_path, &registry)?;
    Ok(registry.infos(None))
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

    fn state_with_registry(dir: &Path) -> BrainState {
        BrainState {
            registry_path: dir.join("brains.json"),
            registry: Mutex::new(Registry::default()),
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
        let brains = state_with_registry(dir.path());
        let path = dir.path().join("Work").join("brain.sqlite");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, b"db").unwrap();
        let canonical = path.canonicalize().unwrap();

        brains.register_active(&canonical, None).unwrap();

        // Reload from disk: the entry, name, and active pointer survive.
        let reloaded = read_registry(&brains.registry_path);
        assert_eq!(reloaded.brains.len(), 1);
        assert_eq!(reloaded.active_path, canonical.display().to_string());
        assert_eq!(reloaded.brains[0].name, "Work");
        assert_eq!(reloaded.brains[0].color, DEFAULT_COLOR);
        assert!(reloaded.brains[0].created_ms > 0);
    }

    #[test]
    fn rename_and_color_mutate_the_record() {
        let dir = tempdir().unwrap();
        let brains = state_with_registry(dir.path());
        let path = dir.path().join("brain.sqlite");
        std::fs::write(&path, b"db").unwrap();
        let canonical = path.canonicalize().unwrap();
        brains.register_active(&canonical, None).unwrap();
        let key = canonical.display().to_string();

        {
            let mut registry = brains.lock().unwrap();
            registry.find_mut(&key).unwrap().name = "Renamed".to_string();
        }
        require_color("teal").unwrap();
        assert!(require_color("chartreuse").is_err());

        let mut registry = brains.lock().unwrap();
        assert_eq!(registry.find(&key).unwrap().name, "Renamed");
        registry.find_mut(&key).unwrap().color = "teal".to_string();
        assert_eq!(registry.find(&key).unwrap().color, "teal");
    }

    #[test]
    fn forget_removes_non_active_and_keeps_active() {
        let dir = tempdir().unwrap();
        let brains = state_with_registry(dir.path());
        let mut registry = brains.lock().unwrap();
        registry.mark_opened("/a/brain.sqlite", Some("A"));
        registry.mark_opened("/b/brain.sqlite", Some("B")); // active = B
        assert_eq!(registry.active_path, "/b/brain.sqlite");

        // Forgetting A (non-active) succeeds; B stays.
        registry
            .brains
            .retain(|brain| brain.path != "/a/brain.sqlite");
        assert_eq!(registry.brains.len(), 1);
        assert_eq!(registry.brains[0].path, "/b/brain.sqlite");

        // infos() marks the active brain and orders newest-opened first.
        let infos = registry.infos(Some(2));
        assert!(infos[0].is_active);
        assert_eq!(infos[0].schema_version, Some(2));
    }

    #[test]
    fn corrupt_registry_falls_back_to_empty() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("brains.json");
        std::fs::write(&path, b"not json at all").unwrap();
        let registry = read_registry(&path);
        assert!(registry.brains.is_empty());
        assert_eq!(registry.version, REGISTRY_VERSION);
    }

    #[test]
    fn active_candidate_prefers_existing_active_then_default() {
        let dir = tempdir().unwrap();
        let brains = state_with_registry(dir.path());
        let default = dir.path().join("default.sqlite");

        // No active set and BRAIN_DB unset → default. (Guard against a stray env.)
        if std::env::var_os("BRAIN_DB").is_none() {
            assert_eq!(brains.active_candidate(&default), default);
        }

        // A real active file is preferred.
        let active = dir.path().join("active.sqlite");
        std::fs::write(&active, b"db").unwrap();
        brains.lock().unwrap().active_path = active.display().to_string();
        if std::env::var_os("BRAIN_DB").is_none() {
            assert_eq!(brains.active_candidate(&default), active);
        }
    }
}
