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

const BRAIN_SKILL_SOURCE: &str = include_str!("../../../../skills/brain/SKILL.md");
const BRAIN_BACKFILL_SKILL_SOURCE: &str =
    include_str!("../../../../skills/brain-backfill/SKILL.md");
const TASK_REVIEW_SKILL_SOURCE: &str =
    include_str!("../../../../skills/brain-task-review/SKILL.md");
const TASK_REVIEW_SCRIPT_SOURCE: &str =
    include_str!("../../../../skills/brain-task-review/scripts/task_review.py");
const MANAGED_PREFIX: &str = "<!-- local-brain-managed: sha256=";
const SCRIPT_MANAGED_PREFIX: &str = "# local-brain-managed: sha256=";
const AGENT_SKILL_DIR: &str = ".agents";
const BRAINS_MANIFEST_FILE: &str = "brains.json";

#[derive(Debug, Clone, Copy)]
struct ManagedSkill {
    id: &'static str,
    source: &'static str,
    sync_brain_manifest: bool,
    scripts: &'static [ManagedScript],
}

#[derive(Debug, Clone, Copy)]
struct ManagedScript {
    path: &'static str,
    source: &'static str,
}

const MANAGED_SKILLS: &[ManagedSkill] = &[
    ManagedSkill {
        id: "brain",
        source: BRAIN_SKILL_SOURCE,
        sync_brain_manifest: true,
        scripts: &[],
    },
    ManagedSkill {
        id: "brain-backfill",
        source: BRAIN_BACKFILL_SKILL_SOURCE,
        sync_brain_manifest: false,
        scripts: &[],
    },
    ManagedSkill {
        id: "brain-task-review",
        source: TASK_REVIEW_SKILL_SOURCE,
        sync_brain_manifest: false,
        scripts: &[ManagedScript {
            path: "scripts/task_review.py",
            source: TASK_REVIEW_SCRIPT_SOURCE,
        }],
    },
];

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
    pub install_target_dir: String,
    pub install_state: SkillInstallState,
    pub skills: Vec<ManagedSkillStatus>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSkillStatus {
    pub id: String,
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
    let snapshot = snapshot_install_files(&paths)?;
    if let Err(err) = install_for(&paths) {
        if let Err(rollback_err) = restore_file_snapshot(&snapshot) {
            return Err(AppError::io(format!(
                "{err}; also failed to roll back agent skill install: {rollback_err}"
            )));
        }
        return Err(err);
    }
    if let Err(err) = sync_brain_manifest(&db, &brains) {
        if let Err(rollback_err) = restore_file_snapshot(&snapshot) {
            return Err(AppError::io(format!(
                "{err}; also failed to roll back agent skill install: {rollback_err}"
            )));
        }
        return Err(err);
    }
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
    skills_root: PathBuf,
}

fn runtime_paths() -> SkillPaths {
    let skills_root = match home_dir() {
        Some(home) => home.join(AGENT_SKILL_DIR).join("skills"),
        None => PathBuf::from("~/.agents/skills"),
    };
    SkillPaths {
        supported: home_dir().is_some(),
        skills_root,
    }
}

fn home_dir() -> Option<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
}

fn status_for(paths: &SkillPaths) -> AppResult<SkillStatus> {
    let skills = MANAGED_SKILLS
        .iter()
        .map(|skill| status_for_skill(paths, skill))
        .collect::<AppResult<Vec<_>>>()?;
    let install_state = aggregate_install_state(&skills, paths.supported);
    Ok(SkillStatus {
        supported: paths.supported,
        install_target_dir: display_path(&paths.skills_root),
        install_state,
        skills,
    })
}

fn status_for_skill(paths: &SkillPaths, skill: &ManagedSkill) -> AppResult<ManagedSkillStatus> {
    let bundled_hash = source_hash(skill);
    let installed = read_installed_skill(paths, skill)?;
    let mut install_state = classify_install(
        installed.as_deref(),
        &bundled_hash,
        &managed_skill_content(skill),
        paths.supported,
    );
    if paths.supported {
        for script in skill.scripts {
            let content = read_optional_file(&script_target(paths, skill, script), "skill script")?;
            let script_state = classify_script(content.as_deref(), script);
            install_state = match (install_state, script_state) {
                (SkillInstallState::Conflict, _) | (_, SkillInstallState::Conflict) => {
                    SkillInstallState::Conflict
                }
                (SkillInstallState::Missing, SkillInstallState::Missing) => {
                    SkillInstallState::Missing
                }
                (SkillInstallState::Current, SkillInstallState::Current) => {
                    SkillInstallState::Current
                }
                _ => SkillInstallState::Stale,
            };
        }
    }
    Ok(ManagedSkillStatus {
        id: skill.id.to_string(),
        install_target_dir: display_path(&install_dir(paths, skill)),
        bundled_hash,
        installed_hash: installed.as_deref().and_then(managed_hash),
        install_state,
    })
}

fn read_installed_skill(paths: &SkillPaths, skill: &ManagedSkill) -> AppResult<Option<String>> {
    if !paths.supported {
        return Ok(None);
    }

    let target = install_target(paths, skill);
    match fs::read_to_string(&target) {
        Ok(content) => Ok(Some(content)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(AppError::io(format!(
            "Could not read installed skill at {}: {err}",
            target.display()
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
            for skill_status in &status.skills {
                if matches!(
                    skill_status.install_state,
                    SkillInstallState::Missing | SkillInstallState::Stale
                ) {
                    let skill = managed_skill_by_id(&skill_status.id)?;
                    let dir = install_dir(paths, skill);
                    fs::create_dir_all(&dir)?;
                    fs::write(install_target(paths, skill), managed_skill_content(skill))?;
                    for script in skill.scripts {
                        let target = script_target(paths, skill, script);
                        if let Some(parent) = target.parent() {
                            fs::create_dir_all(parent)?;
                        }
                        fs::write(target, managed_script_content(script.source))?;
                    }
                }
            }
        }
        SkillInstallState::Current => {}
        SkillInstallState::Conflict => {
            let conflict = status
                .skills
                .iter()
                .find(|skill| skill.install_state == SkillInstallState::Conflict);
            let path = conflict
                .map(|skill| skill.install_target_dir.as_str())
                .unwrap_or(&status.install_target_dir);
            return Err(AppError::io(format!(
                "Refusing to overwrite existing skill at {}",
                path
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
    let removable = status.skills.iter().any(is_removable_skill);
    if !removable && status.install_state == SkillInstallState::Conflict {
        let conflict = status
            .skills
            .iter()
            .find(|skill| skill.install_state == SkillInstallState::Conflict);
        let path = conflict
            .map(|skill| skill.install_target_dir.as_str())
            .unwrap_or(&status.install_target_dir);
        return Err(AppError::io(format!(
            "Refusing to remove unmanaged skill at {}",
            path
        )));
    }

    if removable {
        let snapshot = snapshot_install_files(paths)?;
        if let Err(err) = remove_managed_skill_files(paths, &status) {
            if let Err(rollback_err) = restore_file_snapshot(&snapshot) {
                return Err(AppError::io(format!(
                    "{err}; also failed to roll back agent skill uninstall: {rollback_err}"
                )));
            }
            return Err(err);
        }
    }

    status_for(paths)
}

fn is_removable_skill(skill: &ManagedSkillStatus) -> bool {
    matches!(
        skill.install_state,
        SkillInstallState::Current | SkillInstallState::Stale
    )
}

fn remove_managed_skill_files(paths: &SkillPaths, status: &SkillStatus) -> AppResult<()> {
    for skill_status in status
        .skills
        .iter()
        .filter(|skill| is_removable_skill(skill))
    {
        let skill = managed_skill_by_id(&skill_status.id)?;
        remove_optional_file(&install_target(paths, skill))?;
        for script in skill.scripts {
            remove_optional_file(&script_target(paths, skill, script))?;
        }
        if skill.sync_brain_manifest {
            remove_brain_manifest(paths)?;
        }
    }
    Ok(())
}

#[derive(Debug, Clone)]
struct FileSnapshot {
    path: PathBuf,
    content: Option<String>,
}

fn snapshot_install_files(paths: &SkillPaths) -> AppResult<Vec<FileSnapshot>> {
    if !paths.supported {
        return Ok(Vec::new());
    }

    let mut snapshots = Vec::with_capacity(MANAGED_SKILLS.len() + 1);
    for skill in MANAGED_SKILLS {
        let path = install_target(paths, skill);
        snapshots.push(FileSnapshot {
            content: read_optional_file(&path, "installed skill")?,
            path,
        });
        for script in skill.scripts {
            let path = script_target(paths, skill, script);
            snapshots.push(FileSnapshot {
                content: read_optional_file(&path, "skill script")?,
                path,
            });
        }
    }
    if let Some(skill) = MANAGED_SKILLS
        .iter()
        .find(|skill| skill.sync_brain_manifest)
    {
        let path = brain_manifest_target(paths, skill);
        snapshots.push(FileSnapshot {
            content: read_optional_file(&path, "brain manifest")?,
            path,
        });
    }
    Ok(snapshots)
}

fn read_optional_file(path: &Path, label: &str) -> AppResult<Option<String>> {
    match fs::read_to_string(path) {
        Ok(content) => Ok(Some(content)),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(err) => Err(AppError::io(format!(
            "Could not read {label} at {}: {err}",
            path.display()
        ))),
    }
}

fn remove_optional_file(path: &Path) -> AppResult<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(err.into()),
    }
}

fn restore_file_snapshot(snapshot: &[FileSnapshot]) -> AppResult<()> {
    for file in snapshot {
        match &file.content {
            Some(content) => {
                if let Some(parent) = file.path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::write(&file.path, content)?;
            }
            None => match fs::remove_file(&file.path) {
                Ok(()) => {}
                Err(err) if err.kind() == std::io::ErrorKind::NotFound => {}
                Err(err) => {
                    return Err(AppError::io(format!(
                        "Could not remove restored-missing file at {}: {err}",
                        file.path.display()
                    )));
                }
            },
        }
    }
    Ok(())
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
    if !should_sync_brain_manifest(paths)? {
        return Ok(false);
    }
    write_brain_manifest(paths, infos)?;
    Ok(true)
}

fn should_sync_brain_manifest(paths: &SkillPaths) -> AppResult<bool> {
    if !paths.supported {
        return Ok(false);
    }
    let Some(skill) = MANAGED_SKILLS
        .iter()
        .find(|skill| skill.sync_brain_manifest)
    else {
        return Ok(false);
    };
    let Some(installed) = read_installed_skill(paths, skill)? else {
        return Ok(false);
    };
    Ok(managed_hash(&installed).is_some())
}

fn write_brain_manifest(paths: &SkillPaths, infos: &[BrainInfo]) -> AppResult<()> {
    let Some(skill) = MANAGED_SKILLS
        .iter()
        .find(|skill| skill.sync_brain_manifest)
    else {
        return Ok(());
    };
    let target = brain_manifest_target(paths, skill);
    fs::create_dir_all(install_dir(paths, skill))?;
    let manifest = BrainManifest {
        version: 1,
        updated_at_ms: unix_ms(),
        brains: infos.to_vec(),
    };
    let json = serde_json::to_string_pretty(&manifest)
        .map_err(|err| AppError::parse(format!("could not serialize brain manifest: {err}")))?;
    let temp = target.with_extension("json.tmp");
    fs::write(&temp, format!("{json}\n"))?;
    fs::rename(temp, &target)?;
    Ok(())
}

fn remove_brain_manifest(paths: &SkillPaths) -> AppResult<()> {
    let Some(skill) = MANAGED_SKILLS
        .iter()
        .find(|skill| skill.sync_brain_manifest)
    else {
        return Ok(());
    };
    let target = brain_manifest_target(paths, skill);
    match fs::remove_file(&target) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(err) => Err(AppError::io(format!(
            "Could not remove brain manifest at {}: {err}",
            target.display()
        ))),
    }
}

fn aggregate_install_state(skills: &[ManagedSkillStatus], supported: bool) -> SkillInstallState {
    if !supported {
        return SkillInstallState::Unsupported;
    }
    if skills
        .iter()
        .any(|skill| skill.install_state == SkillInstallState::Conflict)
    {
        return SkillInstallState::Conflict;
    }
    if skills
        .iter()
        .any(|skill| skill.install_state == SkillInstallState::Stale)
    {
        return SkillInstallState::Stale;
    }
    if skills
        .iter()
        .any(|skill| skill.install_state == SkillInstallState::Missing)
    {
        return SkillInstallState::Missing;
    }
    SkillInstallState::Current
}

fn classify_install(
    installed: Option<&str>,
    bundled_hash: &str,
    managed_content: &str,
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

    let mut removed_marker = false;
    let source: String = installed
        .split_inclusive('\n')
        .filter(|line| {
            if !removed_marker && line.trim().starts_with(MANAGED_PREFIX) {
                removed_marker = true;
                false
            } else {
                true
            }
        })
        .collect();
    if hash != sha256_hex(source.as_bytes()) {
        return SkillInstallState::Conflict;
    }

    if hash != bundled_hash {
        return SkillInstallState::Stale;
    }

    if installed == managed_content {
        SkillInstallState::Current
    } else {
        SkillInstallState::Conflict
    }
}

fn managed_skill_content(skill: &ManagedSkill) -> String {
    insert_marker(skill.source, &source_hash(skill))
}

fn script_target(paths: &SkillPaths, skill: &ManagedSkill, script: &ManagedScript) -> PathBuf {
    install_dir(paths, skill).join(script.path)
}

fn managed_script_content(source: &str) -> String {
    format!(
        "{SCRIPT_MANAGED_PREFIX}{}\n{source}",
        sha256_hex(source.as_bytes())
    )
}

fn classify_script(installed: Option<&str>, script: &ManagedScript) -> SkillInstallState {
    let Some(installed) = installed else {
        return SkillInstallState::Missing;
    };
    if installed == managed_script_content(script.source) {
        return SkillInstallState::Current;
    }
    let Some((marker, source)) = installed.split_once('\n') else {
        return SkillInstallState::Conflict;
    };
    let Some(hash) = marker.strip_prefix(SCRIPT_MANAGED_PREFIX) else {
        return SkillInstallState::Conflict;
    };
    // Like Reflect Open's skill marker, verify ownership against the file's own
    // bytes before replacing an old version. User edits must survive upgrades.
    if hash != sha256_hex(source.as_bytes()) {
        return SkillInstallState::Conflict;
    }
    SkillInstallState::Stale
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

fn source_hash(skill: &ManagedSkill) -> String {
    sha256_hex(skill.source.as_bytes())
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

fn install_dir(paths: &SkillPaths, skill: &ManagedSkill) -> PathBuf {
    paths.skills_root.join(skill.id)
}

fn install_target(paths: &SkillPaths, skill: &ManagedSkill) -> PathBuf {
    install_dir(paths, skill).join("SKILL.md")
}

fn brain_manifest_target(paths: &SkillPaths, skill: &ManagedSkill) -> PathBuf {
    install_dir(paths, skill).join(BRAINS_MANIFEST_FILE)
}

fn managed_skill_by_id(id: &str) -> AppResult<&'static ManagedSkill> {
    MANAGED_SKILLS
        .iter()
        .find(|skill| skill.id == id)
        .ok_or_else(|| AppError::parse(format!("unknown managed skill: {id}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn paths_for(root: &Path) -> SkillPaths {
        SkillPaths {
            supported: true,
            skills_root: root.join(AGENT_SKILL_DIR).join("skills"),
        }
    }

    fn brain_skill() -> &'static ManagedSkill {
        managed_skill_by_id("brain").unwrap()
    }

    fn backfill_skill() -> &'static ManagedSkill {
        managed_skill_by_id("brain-backfill").unwrap()
    }

    fn review_skill() -> &'static ManagedSkill {
        managed_skill_by_id("brain-task-review").unwrap()
    }

    fn review_script_target(paths: &SkillPaths) -> PathBuf {
        script_target(paths, review_skill(), &review_skill().scripts[0])
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
            classify_install(
                None,
                &source_hash(brain_skill()),
                &managed_skill_content(brain_skill()),
                true
            ),
            SkillInstallState::Missing
        );
    }

    #[test]
    fn classifies_current_managed_skill() {
        let content = managed_skill_content(brain_skill());

        assert_eq!(
            classify_install(
                Some(&content),
                &source_hash(brain_skill()),
                &managed_skill_content(brain_skill()),
                true
            ),
            SkillInstallState::Current
        );
    }

    #[test]
    fn classifies_stale_managed_skill() {
        let content = insert_marker("# old skill\n", &sha256_hex(b"# old skill\n"));

        assert_eq!(
            classify_install(
                Some(&content),
                &source_hash(brain_skill()),
                &managed_skill_content(brain_skill()),
                true
            ),
            SkillInstallState::Stale
        );
    }

    #[test]
    fn classifies_user_edit_as_conflict_even_with_current_marker() {
        let mut content = managed_skill_content(brain_skill());
        content.push_str("\nUser edit\n");

        assert_eq!(
            classify_install(
                Some(&content),
                &source_hash(brain_skill()),
                &managed_skill_content(brain_skill()),
                true
            ),
            SkillInstallState::Conflict
        );
    }

    #[test]
    fn preserves_edited_skill_even_when_bundled_version_changed() {
        let content = format!(
            "{}\nUser edit\n",
            insert_marker("# old skill\n", &sha256_hex(b"# old skill\n"))
        );
        assert_eq!(
            classify_install(
                Some(&content),
                &source_hash(review_skill()),
                &managed_skill_content(review_skill()),
                true,
            ),
            SkillInstallState::Conflict
        );
    }

    #[test]
    fn classifies_unmanaged_skill_as_conflict() {
        assert_eq!(
            classify_install(
                Some(BRAIN_SKILL_SOURCE),
                &source_hash(brain_skill()),
                &managed_skill_content(brain_skill()),
                true
            ),
            SkillInstallState::Conflict
        );
    }

    #[test]
    fn installs_missing_skills() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());

        let status = install_for(&paths).unwrap();

        assert_eq!(status.install_state, SkillInstallState::Current);
        assert_eq!(
            fs::read_to_string(install_target(&paths, brain_skill())).unwrap(),
            managed_skill_content(brain_skill())
        );
        assert_eq!(
            fs::read_to_string(install_target(&paths, backfill_skill())).unwrap(),
            managed_skill_content(backfill_skill())
        );
        assert_eq!(
            fs::read_to_string(install_target(&paths, review_skill())).unwrap(),
            managed_skill_content(review_skill())
        );
        let script = review_script_target(&paths);
        assert_eq!(
            fs::read_to_string(&script).unwrap(),
            managed_script_content(TASK_REVIEW_SCRIPT_SOURCE)
        );
        let output = std::process::Command::new("python3")
            .arg(script)
            .arg("--help")
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).contains("snapshot"));
    }

    #[test]
    fn repairs_missing_or_stale_review_script() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        install_for(&paths).unwrap();
        let target = review_script_target(&paths);

        fs::remove_file(&target).unwrap();
        assert_eq!(
            status_for(&paths).unwrap().install_state,
            SkillInstallState::Stale
        );
        assert_eq!(
            install_for(&paths).unwrap().install_state,
            SkillInstallState::Current
        );

        fs::write(&target, managed_script_content("# old version\n")).unwrap();
        assert_eq!(
            status_for(&paths).unwrap().install_state,
            SkillInstallState::Stale
        );
        install_for(&paths).unwrap();
        assert_eq!(
            fs::read_to_string(target).unwrap(),
            managed_script_content(TASK_REVIEW_SCRIPT_SOURCE)
        );
    }

    #[test]
    fn preserves_custom_review_scripts_during_install_and_uninstall() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        let target = review_script_target(&paths);
        for content in [
            "# my unmanaged script\n".to_string(),
            format!(
                "{}# user edit\n",
                managed_script_content(TASK_REVIEW_SCRIPT_SOURCE)
            ),
            format!("{}# user edit\n", managed_script_content("# old version\n")),
        ] {
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(&target, &content).unwrap();
            assert_eq!(
                status_for(&paths).unwrap().install_state,
                SkillInstallState::Conflict
            );
            assert!(install_for(&paths).is_err());
            assert!(uninstall_for(&paths).is_err());
            assert_eq!(fs::read_to_string(&target).unwrap(), content);
            assert!(!install_target(&paths, brain_skill()).exists());
        }
    }

    #[test]
    fn rollback_restores_review_script_bytes() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        install_for(&paths).unwrap();
        let target = review_script_target(&paths);
        let old = managed_script_content("# old version\n");
        fs::write(&target, &old).unwrap();
        let snapshot = snapshot_install_files(&paths).unwrap();
        install_for(&paths).unwrap();
        restore_file_snapshot(&snapshot).unwrap();
        assert_eq!(fs::read_to_string(target).unwrap(), old);
    }

    #[test]
    fn uninstalls_review_script_when_skill_document_is_missing() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        install_for(&paths).unwrap();
        fs::remove_file(install_target(&paths, review_skill())).unwrap();
        assert_eq!(
            uninstall_for(&paths).unwrap().install_state,
            SkillInstallState::Missing
        );
        assert!(!review_script_target(&paths).exists());
    }

    #[test]
    fn syncs_brain_manifest_next_to_managed_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(install_dir(&paths, brain_skill())).unwrap();
        fs::write(
            install_target(&paths, brain_skill()),
            managed_skill_content(brain_skill()),
        )
        .unwrap();

        let infos = vec![brain_info(&temp.path().join("Personal"), "Personal", true)];

        assert!(sync_brain_manifest_for_paths(&paths, &infos).unwrap());

        let manifest = fs::read_to_string(brain_manifest_target(&paths, brain_skill())).unwrap();
        assert!(manifest.contains("\"version\": 1"));
        assert!(manifest.contains("\"name\": \"Personal\""));
        assert!(manifest.contains("\"isActive\": true"));
    }

    #[test]
    fn skips_brain_manifest_for_unmanaged_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(install_dir(&paths, brain_skill())).unwrap();
        fs::write(install_target(&paths, brain_skill()), BRAIN_SKILL_SOURCE).unwrap();

        let infos = vec![brain_info(&temp.path().join("Personal"), "Personal", true)];

        assert!(!sync_brain_manifest_for_paths(&paths, &infos).unwrap());
        assert!(!brain_manifest_target(&paths, brain_skill()).exists());
    }

    #[test]
    fn repairs_stale_managed_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(install_dir(&paths, brain_skill())).unwrap();
        fs::write(
            install_target(&paths, brain_skill()),
            insert_marker("# old skill\n", &sha256_hex(b"# old skill\n")),
        )
        .unwrap();
        fs::create_dir_all(install_dir(&paths, backfill_skill())).unwrap();
        fs::write(
            install_target(&paths, backfill_skill()),
            managed_skill_content(backfill_skill()),
        )
        .unwrap();

        let status = install_for(&paths).unwrap();

        assert_eq!(status.install_state, SkillInstallState::Current);
        assert_eq!(
            fs::read_to_string(install_target(&paths, brain_skill())).unwrap(),
            managed_skill_content(brain_skill())
        );
    }

    #[test]
    fn refuses_to_overwrite_unmanaged_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(install_dir(&paths, brain_skill())).unwrap();
        fs::write(install_target(&paths, brain_skill()), BRAIN_SKILL_SOURCE).unwrap();

        assert!(install_for(&paths).is_err());
        assert!(!install_target(&paths, backfill_skill()).exists());
    }

    #[test]
    fn refuses_to_install_when_existing_skill_cannot_be_read() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(install_target(&paths, brain_skill())).unwrap();

        assert!(status_for(&paths).is_err());
        assert!(install_for(&paths).is_err());
        assert!(install_target(&paths, brain_skill()).is_dir());
    }

    #[test]
    fn repairs_partial_install() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(install_dir(&paths, brain_skill())).unwrap();
        fs::write(
            install_target(&paths, brain_skill()),
            managed_skill_content(brain_skill()),
        )
        .unwrap();

        assert_eq!(
            status_for(&paths).unwrap().install_state,
            SkillInstallState::Missing
        );

        let status = install_for(&paths).unwrap();

        assert_eq!(status.install_state, SkillInstallState::Current);
        assert_eq!(
            fs::read_to_string(install_target(&paths, backfill_skill())).unwrap(),
            managed_skill_content(backfill_skill())
        );
    }

    #[test]
    fn rollback_restores_partial_install_snapshot() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        let manifest = "{\"version\":1}\n";
        fs::create_dir_all(install_dir(&paths, brain_skill())).unwrap();
        fs::write(
            install_target(&paths, brain_skill()),
            managed_skill_content(brain_skill()),
        )
        .unwrap();
        fs::write(brain_manifest_target(&paths, brain_skill()), manifest).unwrap();

        let snapshot = snapshot_install_files(&paths).unwrap();
        install_for(&paths).unwrap();

        assert!(install_target(&paths, backfill_skill()).exists());

        restore_file_snapshot(&snapshot).unwrap();

        assert_eq!(
            fs::read_to_string(install_target(&paths, brain_skill())).unwrap(),
            managed_skill_content(brain_skill())
        );
        assert!(!install_target(&paths, backfill_skill()).exists());
        assert_eq!(
            fs::read_to_string(brain_manifest_target(&paths, brain_skill())).unwrap(),
            manifest
        );
        assert!(!install_target(&paths, review_skill()).exists());
        assert!(!review_script_target(&paths).exists());
    }

    #[test]
    fn uninstalls_current_managed_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        install_for(&paths).unwrap();
        fs::write(brain_manifest_target(&paths, brain_skill()), "{}").unwrap();
        let user_file = install_dir(&paths, review_skill()).join("notes.txt");
        fs::write(&user_file, "keep this").unwrap();

        let status = uninstall_for(&paths).unwrap();

        assert_eq!(status.install_state, SkillInstallState::Missing);
        assert!(!install_target(&paths, brain_skill()).exists());
        assert!(!install_target(&paths, backfill_skill()).exists());
        assert!(!brain_manifest_target(&paths, brain_skill()).exists());
        assert!(!install_target(&paths, review_skill()).exists());
        assert!(!review_script_target(&paths).exists());
        assert_eq!(fs::read_to_string(user_file).unwrap(), "keep this");
    }

    #[test]
    fn uninstalls_partial_managed_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(install_dir(&paths, brain_skill())).unwrap();
        fs::write(
            install_target(&paths, brain_skill()),
            managed_skill_content(brain_skill()),
        )
        .unwrap();
        fs::write(brain_manifest_target(&paths, brain_skill()), "{}").unwrap();

        assert_eq!(
            status_for(&paths).unwrap().install_state,
            SkillInstallState::Missing
        );

        let status = uninstall_for(&paths).unwrap();

        assert_eq!(status.install_state, SkillInstallState::Missing);
        assert!(!install_target(&paths, brain_skill()).exists());
        assert!(!install_target(&paths, backfill_skill()).exists());
        assert!(!brain_manifest_target(&paths, brain_skill()).exists());
    }

    #[test]
    fn uninstalls_managed_skill_when_sibling_conflicts() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(install_dir(&paths, brain_skill())).unwrap();
        fs::write(
            install_target(&paths, brain_skill()),
            managed_skill_content(brain_skill()),
        )
        .unwrap();
        fs::write(brain_manifest_target(&paths, brain_skill()), "{}").unwrap();
        fs::create_dir_all(install_dir(&paths, backfill_skill())).unwrap();
        fs::write(
            install_target(&paths, backfill_skill()),
            BRAIN_BACKFILL_SKILL_SOURCE,
        )
        .unwrap();

        let status = uninstall_for(&paths).unwrap();

        assert_eq!(status.install_state, SkillInstallState::Conflict);
        assert!(!install_target(&paths, brain_skill()).exists());
        assert!(!brain_manifest_target(&paths, brain_skill()).exists());
        assert_eq!(
            fs::read_to_string(install_target(&paths, backfill_skill())).unwrap(),
            BRAIN_BACKFILL_SKILL_SOURCE
        );
    }

    #[test]
    fn refuses_to_uninstall_unmanaged_skill() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(install_dir(&paths, brain_skill())).unwrap();
        fs::write(install_target(&paths, brain_skill()), BRAIN_SKILL_SOURCE).unwrap();

        assert!(uninstall_for(&paths).is_err());
    }
}
