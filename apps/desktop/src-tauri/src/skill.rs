use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

use crate::brains::{self, BrainInfo, BrainState};
use crate::db::DbState;
use crate::error::{AppError, AppResult};

const SKILL_SOURCE: &str = include_str!("../../../../skills/brain/SKILL.md");
const MANAGED_PREFIX: &str = "<!-- local-brain-managed: sha256=";
const AGENT_SKILL_DIR: &str = ".agents";
const BRAINS_MANIFEST_FILE: &str = "brains.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkillInstallState {
    Unsupported,
    Missing,
    Current,
    Stale,
    Conflict,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillStatus {
    pub supported: bool,
    pub install_target_path: String,
    pub install_target_dir: String,
    pub bundled_hash: String,
    pub installed_hash: Option<String>,
    pub install_state: SkillInstallState,
}

#[tauri::command]
pub fn skill_status() -> AppResult<SkillStatus> {
    status_for(&runtime_paths())
}

#[tauri::command]
pub fn skill_install(
    db: State<'_, DbState>,
    brains: State<'_, BrainState>,
) -> AppResult<SkillStatus> {
    let paths = runtime_paths();
    install_for(&paths)?;
    sync_brain_manifest(&db, &brains)?;
    status_for(&paths)
}

#[tauri::command]
pub fn skill_uninstall() -> AppResult<SkillStatus> {
    let paths = runtime_paths();
    uninstall_for(&paths)
}

#[derive(Debug, Clone)]
struct SkillPaths {
    supported: bool,
    install_dir: PathBuf,
    install_target: PathBuf,
    brains_manifest_target: PathBuf,
}

fn runtime_paths() -> SkillPaths {
    let install_dir = match home_dir() {
        Some(home) => home.join(AGENT_SKILL_DIR).join("skills").join("brain"),
        None => PathBuf::from("~/.agents/skills/brain"),
    };
    SkillPaths {
        supported: home_dir().is_some(),
        install_target: install_dir.join("SKILL.md"),
        brains_manifest_target: install_dir.join(BRAINS_MANIFEST_FILE),
        install_dir,
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

fn status_for(paths: &SkillPaths) -> AppResult<SkillStatus> {
    let bundled_hash = source_hash();
    let installed = read_installed_skill(paths)?;
    Ok(SkillStatus {
        supported: paths.supported,
        install_target_path: display_path(&paths.install_target),
        install_target_dir: display_path(&paths.install_dir),
        bundled_hash: bundled_hash.clone(),
        installed_hash: installed.as_deref().and_then(managed_hash),
        install_state: classify_install(installed.as_deref(), &bundled_hash, paths.supported),
    })
}

fn read_installed_skill(paths: &SkillPaths) -> AppResult<Option<String>> {
    if !paths.supported {
        return Ok(None);
    }

    match fs::read_to_string(&paths.install_target) {
        Ok(content) => Ok(Some(content)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(AppError::io(format!(
            "Could not read installed skill at {}: {err}",
            paths.install_target.display()
        ))),
    }
}

fn install_for(paths: &SkillPaths) -> AppResult<SkillStatus> {
    if !paths.supported {
        return status_for(paths);
    }

    let status = status_for(paths)?;
    match status.install_state {
        SkillInstallState::Missing | SkillInstallState::Stale => {
            fs::create_dir_all(&paths.install_dir)?;
            fs::write(&paths.install_target, managed_skill_content())?;
        }
        SkillInstallState::Current => {}
        SkillInstallState::Conflict => {
            return Err(AppError::io(format!(
                "Refusing to overwrite existing skill at {}",
                paths.install_target.display()
            )));
        }
        SkillInstallState::Unsupported => {}
    }

    status_for(paths)
}

fn uninstall_for(paths: &SkillPaths) -> AppResult<SkillStatus> {
    if !paths.supported {
        return status_for(paths);
    }

    let status = status_for(paths)?;
    match status.install_state {
        SkillInstallState::Current | SkillInstallState::Stale => {
            fs::remove_file(&paths.install_target)?;
            remove_brain_manifest(paths)?;
        }
        SkillInstallState::Conflict => {
            return Err(AppError::io(format!(
                "Refusing to remove unmanaged skill at {}",
                paths.install_target.display()
            )));
        }
        SkillInstallState::Missing | SkillInstallState::Unsupported => {}
    }

    status_for(paths)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrainManifest {
    version: u8,
    updated_at_ms: u64,
    brains: Vec<BrainInfo>,
}

pub(crate) fn sync_brain_manifest(db: &DbState, brains: &BrainState) -> AppResult<bool> {
    let infos = brains::list_brain_infos(db, brains)?;
    sync_brain_manifest_from_infos(&infos)
}

pub(crate) fn sync_brain_manifest_from_infos(infos: &[BrainInfo]) -> AppResult<bool> {
    let paths = runtime_paths();
    sync_brain_manifest_for_paths(&paths, infos)
}

fn sync_brain_manifest_for_paths(paths: &SkillPaths, infos: &[BrainInfo]) -> AppResult<bool> {
    if !should_sync_brain_manifest(&paths)? {
        return Ok(false);
    }
    write_brain_manifest(&paths, infos)?;
    Ok(true)
}

fn should_sync_brain_manifest(paths: &SkillPaths) -> AppResult<bool> {
    if !paths.supported {
        return Ok(false);
    }
    let Some(installed) = read_installed_skill(paths)? else {
        return Ok(false);
    };
    Ok(managed_hash(&installed).is_some())
}

fn write_brain_manifest(paths: &SkillPaths, infos: &[BrainInfo]) -> AppResult<()> {
    fs::create_dir_all(&paths.install_dir)?;
    let manifest = BrainManifest {
        version: 1,
        updated_at_ms: unix_ms(),
        brains: infos.to_vec(),
    };
    let json = serde_json::to_string_pretty(&manifest)
        .map_err(|err| AppError::parse(format!("could not serialize brain manifest: {err}")))?;
    let temp = paths.brains_manifest_target.with_extension("json.tmp");
    fs::write(&temp, format!("{json}\n"))?;
    fs::rename(temp, &paths.brains_manifest_target)?;
    Ok(())
}

fn remove_brain_manifest(paths: &SkillPaths) -> AppResult<()> {
    match fs::remove_file(&paths.brains_manifest_target) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(AppError::io(format!(
            "Could not remove brain manifest at {}: {err}",
            paths.brains_manifest_target.display()
        ))),
    }
}

fn classify_install(
    installed: Option<&str>,
    bundled_hash: &str,
    supported: bool,
) -> SkillInstallState {
    if !supported {
        return SkillInstallState::Unsupported;
    }

    let Some(installed) = installed else {
        return SkillInstallState::Missing;
    };

    let Some(hash) = managed_hash(installed) else {
        return SkillInstallState::Conflict;
    };

    if hash != bundled_hash {
        return SkillInstallState::Stale;
    }

    if installed == managed_skill_content() {
        SkillInstallState::Current
    } else {
        SkillInstallState::Conflict
    }
}

fn managed_skill_content() -> String {
    insert_marker(SKILL_SOURCE, &source_hash())
}

fn insert_marker(source: &str, hash: &str) -> String {
    let marker = format!("{MANAGED_PREFIX}{hash} -->");
    if let Some(rest) = source.strip_prefix("---\n") {
        if let Some(index) = rest.find("\n---\n") {
            let split = "---\n".len() + index + "\n---\n".len();
            let (frontmatter, body) = source.split_at(split);
            return format!("{frontmatter}{marker}\n{body}");
        }
    }
    format!("{marker}\n{source}")
}

fn managed_hash(content: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let value = line
            .trim()
            .strip_prefix(MANAGED_PREFIX)?
            .strip_suffix(" -->")?;
        Some(value.to_string())
    })
}

fn source_hash() -> String {
    sha256_hex(SKILL_SOURCE.as_bytes())
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

fn display_path(path: &Path) -> String {
    path.display().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn paths_for(root: &Path) -> SkillPaths {
        let install_dir = root.join(AGENT_SKILL_DIR).join("skills").join("brain");
        SkillPaths {
            supported: true,
            install_target: install_dir.join("SKILL.md"),
            brains_manifest_target: install_dir.join(BRAINS_MANIFEST_FILE),
            install_dir,
        }
    }

    fn brain_info(root: &Path, name: &str, is_active: bool) -> BrainInfo {
        BrainInfo {
            root_path: root.display().to_string(),
            database_path: root.join("brain.sqlite").display().to_string(),
            assets_path: root.join("assets").display().to_string(),
            name: name.to_string(),
            color: "indigo".to_string(),
            created_ms: 1,
            last_opened_ms: 2,
            is_active,
            schema_version: if is_active { Some(13) } else { None },
        }
    }

    #[test]
    fn classifies_missing_install() {
        assert_eq!(
            classify_install(None, &source_hash(), true),
            SkillInstallState::Missing
        );
    }

    #[test]
    fn classifies_current_managed_skill() {
        let content = managed_skill_content();

        assert_eq!(
            classify_install(Some(&content), &source_hash(), true),
            SkillInstallState::Current
        );
    }

    #[test]
    fn classifies_stale_managed_skill() {
        let content = insert_marker(SKILL_SOURCE, "old");

        assert_eq!(
            classify_install(Some(&content), &source_hash(), true),
            SkillInstallState::Stale
        );
    }

    #[test]
    fn classifies_user_edit_as_conflict_even_with_current_marker() {
        let mut content = managed_skill_content();
        content.push_str("\nUser edit\n");

        assert_eq!(
            classify_install(Some(&content), &source_hash(), true),
            SkillInstallState::Conflict
        );
    }

    #[test]
    fn classifies_unmanaged_skill_as_conflict() {
        assert_eq!(
            classify_install(Some(SKILL_SOURCE), &source_hash(), true),
            SkillInstallState::Conflict
        );
    }

    #[test]
    fn installs_missing_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());

        let status = install_for(&paths).unwrap();

        assert_eq!(status.install_state, SkillInstallState::Current);
        assert_eq!(
            fs::read_to_string(&paths.install_target).unwrap(),
            managed_skill_content()
        );
    }

    #[test]
    fn syncs_brain_manifest_next_to_managed_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(&paths.install_dir).unwrap();
        fs::write(&paths.install_target, managed_skill_content()).unwrap();

        let infos = vec![brain_info(&temp.path().join("Personal"), "Personal", true)];

        assert!(sync_brain_manifest_for_paths(&paths, &infos).unwrap());

        let manifest = fs::read_to_string(&paths.brains_manifest_target).unwrap();
        assert!(manifest.contains("\"version\": 1"));
        assert!(manifest.contains("\"name\": \"Personal\""));
        assert!(manifest.contains("\"isActive\": true"));
    }

    #[test]
    fn skips_brain_manifest_for_unmanaged_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(&paths.install_dir).unwrap();
        fs::write(&paths.install_target, SKILL_SOURCE).unwrap();

        let infos = vec![brain_info(&temp.path().join("Personal"), "Personal", true)];

        assert!(!sync_brain_manifest_for_paths(&paths, &infos).unwrap());
        assert!(!paths.brains_manifest_target.exists());
    }

    #[test]
    fn repairs_stale_managed_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(&paths.install_dir).unwrap();
        fs::write(&paths.install_target, insert_marker(SKILL_SOURCE, "old")).unwrap();

        let status = install_for(&paths).unwrap();

        assert_eq!(status.install_state, SkillInstallState::Current);
        assert_eq!(
            fs::read_to_string(&paths.install_target).unwrap(),
            managed_skill_content()
        );
    }

    #[test]
    fn refuses_to_overwrite_unmanaged_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(&paths.install_dir).unwrap();
        fs::write(&paths.install_target, SKILL_SOURCE).unwrap();

        assert!(install_for(&paths).is_err());
    }

    #[test]
    fn refuses_to_install_when_existing_skill_cannot_be_read() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(&paths.install_target).unwrap();

        assert!(status_for(&paths).is_err());
        assert!(install_for(&paths).is_err());
        assert!(paths.install_target.is_dir());
    }

    #[test]
    fn uninstalls_current_managed_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(&paths.install_dir).unwrap();
        fs::write(&paths.install_target, managed_skill_content()).unwrap();
        fs::write(&paths.brains_manifest_target, "{}").unwrap();

        let status = uninstall_for(&paths).unwrap();

        assert_eq!(status.install_state, SkillInstallState::Missing);
        assert!(!paths.install_target.exists());
        assert!(!paths.brains_manifest_target.exists());
    }

    #[test]
    fn refuses_to_uninstall_unmanaged_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(&paths.install_dir).unwrap();
        fs::write(&paths.install_target, SKILL_SOURCE).unwrap();

        assert!(uninstall_for(&paths).is_err());
    }
}
