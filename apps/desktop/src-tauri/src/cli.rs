use std::env;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::Serialize;

use crate::error::{AppError, AppResult};

const CLI_BINARY: &str = "brain";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CliInstallState {
    Unsupported,
    Missing,
    Current,
    Stale,
    Conflict,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub supported: bool,
    pub bundled_path: String,
    pub bundled_version: Option<String>,
    pub install_target_path: String,
    pub install_target_dir: String,
    pub target_dir_on_path: bool,
    pub installed_path: Option<String>,
    pub installed_version: Option<String>,
    pub install_state: CliInstallState,
}

#[tauri::command]
pub fn cli_status() -> AppResult<CliStatus> {
    Ok(status_for(&runtime_paths()?))
}

#[tauri::command]
pub fn cli_install() -> AppResult<CliStatus> {
    let paths = runtime_paths()?;
    install_for(&paths)
}

#[tauri::command]
pub fn cli_uninstall() -> AppResult<CliStatus> {
    let paths = runtime_paths()?;
    uninstall_for(&paths)
}

fn install_for(paths: &CliPaths) -> AppResult<CliStatus> {
    if !paths.supported {
        return Ok(status_for(&paths));
    }
    if !paths.bundled_path.is_file() {
        return Err(AppError::not_found(format!(
            "Bundled brain CLI is missing at {}",
            paths.bundled_path.display()
        )));
    }

    let status = status_for(&paths);
    match status.install_state {
        CliInstallState::Missing => {
            fs::create_dir_all(&paths.install_dir)?;
            create_symlink(&paths.bundled_path, &paths.install_target)?;
        }
        CliInstallState::Current => {}
        CliInstallState::Stale => {
            fs::remove_file(&paths.install_target)?;
            create_symlink(&paths.bundled_path, &paths.install_target)?;
        }
        CliInstallState::Conflict => {
            return Err(AppError::io(format!(
                "Refusing to overwrite existing file at {}",
                paths.install_target.display()
            )));
        }
        CliInstallState::Unsupported => {}
    }

    Ok(status_for(&paths))
}

fn uninstall_for(paths: &CliPaths) -> AppResult<CliStatus> {
    if !paths.supported {
        return Ok(status_for(&paths));
    }

    let status = status_for(&paths);
    match status.install_state {
        CliInstallState::Current | CliInstallState::Stale => {
            fs::remove_file(&paths.install_target)?;
        }
        CliInstallState::Conflict => {
            return Err(AppError::io(format!(
                "Refusing to remove unrelated file at {}",
                paths.install_target.display()
            )));
        }
        CliInstallState::Missing | CliInstallState::Unsupported => {}
    }

    Ok(status_for(&paths))
}

#[derive(Debug, Clone)]
struct CliPaths {
    supported: bool,
    bundled_path: PathBuf,
    install_dir: PathBuf,
    install_target: PathBuf,
}

fn runtime_paths() -> AppResult<CliPaths> {
    let exe = env::current_exe().map_err(|err| AppError::io(err.to_string()))?;
    let exe_dir = exe
        .parent()
        .ok_or_else(|| AppError::io("executable has no parent directory"))?;
    let supported = cfg!(target_os = "macos");
    let install_dir = match home_dir() {
        Ok(home) => home.join(".local").join("bin"),
        Err(err) if supported => return Err(err),
        Err(_) => PathBuf::from("~/.local/bin"),
    };
    Ok(CliPaths {
        supported,
        bundled_path: exe_dir.join(CLI_BINARY),
        install_target: install_dir.join(CLI_BINARY),
        install_dir,
    })
}

fn home_dir() -> AppResult<PathBuf> {
    env::var_os("HOME")
        .map(PathBuf::from)
        .filter(|path| !path.as_os_str().is_empty())
        .ok_or_else(|| AppError::io("HOME is not set"))
}

fn status_for(paths: &CliPaths) -> CliStatus {
    let installed_path = symlink_target(&paths.install_target).map(|target| display_path(&target));
    let install_state =
        classify_install(&paths.install_target, &paths.bundled_path, paths.supported);
    CliStatus {
        supported: paths.supported,
        bundled_path: display_path(&paths.bundled_path),
        bundled_version: version_for(&paths.bundled_path),
        install_target_path: display_path(&paths.install_target),
        install_target_dir: display_path(&paths.install_dir),
        target_dir_on_path: target_dir_on_path(&paths.install_dir),
        installed_version: match install_state {
            CliInstallState::Current | CliInstallState::Stale => version_for(&paths.install_target),
            CliInstallState::Unsupported | CliInstallState::Missing | CliInstallState::Conflict => {
                None
            }
        },
        installed_path,
        install_state,
    }
}

fn classify_install(
    install_target: &Path,
    bundled_path: &Path,
    supported: bool,
) -> CliInstallState {
    if !supported {
        return CliInstallState::Unsupported;
    }

    let metadata = match fs::symlink_metadata(install_target) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return CliInstallState::Missing,
        Err(_) => return CliInstallState::Conflict,
    };

    if !metadata.file_type().is_symlink() {
        return CliInstallState::Conflict;
    }

    let target = match fs::read_link(install_target) {
        Ok(target) => target,
        Err(_) => return CliInstallState::Conflict,
    };
    let absolute_target = absolutize_symlink_target(install_target, &target);

    if same_path(&absolute_target, bundled_path) {
        return CliInstallState::Current;
    }

    if is_local_brain_sidecar(&absolute_target) {
        CliInstallState::Stale
    } else {
        CliInstallState::Conflict
    }
}

fn absolutize_symlink_target(link: &Path, target: &Path) -> PathBuf {
    if target.is_absolute() {
        return target.to_path_buf();
    }
    link.parent().unwrap_or_else(|| Path::new(".")).join(target)
}

fn same_path(first: &Path, second: &Path) -> bool {
    if first == second {
        return true;
    }
    match (first.canonicalize(), second.canonicalize()) {
        (Ok(first), Ok(second)) => first == second,
        _ => false,
    }
}

fn is_local_brain_sidecar(path: &Path) -> bool {
    if path.file_name().and_then(|name| name.to_str()) != Some(CLI_BINARY) {
        return false;
    }
    let Some(macos_dir) = path.parent() else {
        return false;
    };
    if macos_dir.file_name().and_then(|name| name.to_str()) != Some("MacOS") {
        return false;
    }
    let Some(contents_dir) = macos_dir.parent() else {
        return false;
    };
    if contents_dir.file_name().and_then(|name| name.to_str()) != Some("Contents") {
        return false;
    }
    contents_dir
        .parent()
        .and_then(|app_dir| app_dir.file_name())
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with("Local Brain") && name.ends_with(".app"))
}

fn symlink_target(path: &Path) -> Option<PathBuf> {
    let metadata = fs::symlink_metadata(path).ok()?;
    if !metadata.file_type().is_symlink() {
        return None;
    }
    fs::read_link(path).ok()
}

fn target_dir_on_path(dir: &Path) -> bool {
    process_path_contains_dir(dir) || shell_path_contains_dir(dir).unwrap_or(false)
}

fn process_path_contains_dir(dir: &Path) -> bool {
    let Some(path) = env::var_os("PATH") else {
        return false;
    };
    path_list_contains_dir(dir, &path)
}

fn shell_path_contains_dir(dir: &Path) -> Option<bool> {
    let path = login_shell_path()?;
    Some(path_list_contains_dir(dir, &path))
}

fn login_shell_path() -> Option<OsString> {
    let shell = env::var_os("SHELL")
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| OsString::from("/bin/zsh"));
    let output = Command::new(shell)
        .args(["-lc", "printf %s \"$PATH\""])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(OsString::from(String::from_utf8(output.stdout).ok()?))
}

fn path_list_contains_dir(dir: &Path, path: &std::ffi::OsStr) -> bool {
    env::split_paths(path).any(|entry| same_path(&entry, dir))
}

fn version_for(binary: &Path) -> Option<String> {
    let output = Command::new(binary).arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8(output.stdout).ok()?;
    let version = stdout.trim();
    if version.is_empty() {
        None
    } else {
        Some(version.to_string())
    }
}

fn display_path(path: &Path) -> String {
    path.display().to_string()
}

#[cfg(unix)]
fn create_symlink(source: &Path, target: &Path) -> AppResult<()> {
    std::os::unix::fs::symlink(source, target)?;
    Ok(())
}

#[cfg(not(unix))]
fn create_symlink(_source: &Path, _target: &Path) -> AppResult<()> {
    Err(AppError::io("symlink install is only supported on Unix"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn paths_for(root: &Path) -> CliPaths {
        let bundle = root.join("Local Brain.app").join("Contents").join("MacOS");
        let install_dir = root.join("home").join(".local").join("bin");
        fs::create_dir_all(&bundle).unwrap();
        fs::write(bundle.join(CLI_BINARY), "#!/bin/sh\n").unwrap();
        CliPaths {
            supported: true,
            bundled_path: bundle.join(CLI_BINARY),
            install_target: install_dir.join(CLI_BINARY),
            install_dir,
        }
    }

    #[test]
    fn classifies_missing_install() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());

        assert_eq!(
            classify_install(&paths.install_target, &paths.bundled_path, true),
            CliInstallState::Missing
        );
    }

    #[test]
    fn classifies_current_symlink() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(&paths.install_dir).unwrap();
        create_symlink(&paths.bundled_path, &paths.install_target).unwrap();

        assert_eq!(
            classify_install(&paths.install_target, &paths.bundled_path, true),
            CliInstallState::Current
        );
    }

    #[test]
    fn classifies_stale_local_brain_sidecar_symlink() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        let old_bundle = temp
            .path()
            .join("Old")
            .join("Local Brain.app")
            .join("Contents")
            .join("MacOS");
        fs::create_dir_all(&old_bundle).unwrap();
        fs::write(old_bundle.join(CLI_BINARY), "#!/bin/sh\n").unwrap();
        fs::create_dir_all(&paths.install_dir).unwrap();
        create_symlink(&old_bundle.join(CLI_BINARY), &paths.install_target).unwrap();

        assert_eq!(
            classify_install(&paths.install_target, &paths.bundled_path, true),
            CliInstallState::Stale
        );
    }

    #[test]
    fn classifies_regular_file_as_conflict() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(&paths.install_dir).unwrap();
        fs::write(&paths.install_target, "#!/bin/sh\n").unwrap();

        assert_eq!(
            classify_install(&paths.install_target, &paths.bundled_path, true),
            CliInstallState::Conflict
        );
    }

    #[test]
    fn classifies_unrelated_symlink_as_conflict() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        let other = temp.path().join("other-brain");
        fs::write(&other, "#!/bin/sh\n").unwrap();
        fs::create_dir_all(&paths.install_dir).unwrap();
        create_symlink(&other, &paths.install_target).unwrap();

        assert_eq!(
            classify_install(&paths.install_target, &paths.bundled_path, true),
            CliInstallState::Conflict
        );
    }

    #[test]
    #[cfg(unix)]
    fn status_does_not_execute_conflicting_symlink() {
        use std::os::unix::fs::PermissionsExt;

        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        let marker = temp.path().join("executed");
        let other = temp.path().join("other-brain");
        fs::write(
            &other,
            format!("#!/bin/sh\ntouch '{}'\necho other\n", marker.display()),
        )
        .unwrap();
        let mut permissions = fs::metadata(&other).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&other, permissions).unwrap();
        fs::create_dir_all(&paths.install_dir).unwrap();
        create_symlink(&other, &paths.install_target).unwrap();

        let status = status_for(&paths);

        assert_eq!(status.install_state, CliInstallState::Conflict);
        assert_eq!(status.installed_version, None);
        assert!(!marker.exists());
    }

    #[test]
    fn reports_unsupported_without_inspecting_install() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());

        assert_eq!(
            classify_install(&paths.install_target, &paths.bundled_path, false),
            CliInstallState::Unsupported
        );
    }

    #[test]
    fn detects_when_target_dir_is_not_on_path() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        let other_path = env::join_paths([temp.path().join("bin")]).unwrap();

        assert!(!path_list_contains_dir(&paths.install_dir, &other_path));
    }

    #[test]
    fn installs_missing_symlink() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());

        let status = install_for(&paths).unwrap();

        assert_eq!(status.install_state, CliInstallState::Current);
        assert_eq!(
            fs::read_link(&paths.install_target).unwrap(),
            paths.bundled_path
        );
    }

    #[test]
    fn repairs_stale_local_brain_symlink() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        let old_bundle = temp
            .path()
            .join("Old")
            .join("Local Brain.app")
            .join("Contents")
            .join("MacOS");
        fs::create_dir_all(&old_bundle).unwrap();
        fs::write(old_bundle.join(CLI_BINARY), "#!/bin/sh\n").unwrap();
        fs::create_dir_all(&paths.install_dir).unwrap();
        create_symlink(&old_bundle.join(CLI_BINARY), &paths.install_target).unwrap();

        let status = install_for(&paths).unwrap();

        assert_eq!(status.install_state, CliInstallState::Current);
        assert_eq!(
            fs::read_link(&paths.install_target).unwrap(),
            paths.bundled_path
        );
    }

    #[test]
    fn refuses_to_install_over_conflict() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(&paths.install_dir).unwrap();
        fs::write(&paths.install_target, "#!/bin/sh\n").unwrap();

        assert!(install_for(&paths).is_err());
    }

    #[test]
    fn uninstalls_current_symlink() {
        let temp = TempDir::new().unwrap();
        let paths = paths_for(temp.path());
        fs::create_dir_all(&paths.install_dir).unwrap();
        create_symlink(&paths.bundled_path, &paths.install_target).unwrap();

        let status = uninstall_for(&paths).unwrap();

        assert_eq!(status.install_state, CliInstallState::Missing);
        assert!(!paths.install_target.exists());
    }
}
