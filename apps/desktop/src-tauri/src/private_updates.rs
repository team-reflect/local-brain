use std::time::Duration;

use semver::Version;
use serde::{Deserialize, Serialize};
use tauri::{Manager, ResourceId, Runtime, Webview};
use tauri_plugin_updater::UpdaterExt;
use url::Url;

use crate::error::{AppError, AppResult};

const GITHUB_OWNER: &str = "team-reflect";
const GITHUB_REPO: &str = "local-brain";
const GITHUB_API_VERSION: &str = "2022-11-28";

// Temporary private-alpha updater credential. This is intentionally embedded so
// distributed private builds can read release assets until the repo is public.
const GITHUB_UPDATER_TOKEN: &str =
    "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";

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateUpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

fn github_auth_header() -> String {
    format!("Bearer {GITHUB_UPDATER_TOKEN}")
}

fn github_error(err: impl std::fmt::Display) -> AppError {
    AppError::Network {
        message: format!("GitHub updater request failed: {err}"),
    }
}

fn updater_error(err: impl std::fmt::Display) -> AppError {
    AppError::Network {
        message: format!("Private updater check failed: {err}"),
    }
}

fn parse_version(value: &str) -> AppResult<Version> {
    Version::parse(value.trim_start_matches('v')).map_err(|err| AppError::parse(err.to_string()))
}

fn release_version(manifest: &serde_json::Value) -> AppResult<Version> {
    let version = manifest
        .get("version")
        .or_else(|| manifest.get("name"))
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| AppError::parse("updater manifest is missing version".to_string()))?;
    parse_version(version)
}

async fn latest_release_manifest_asset() -> AppResult<GitHubAsset> {
    let url = format!("https://api.github.com/repos/{GITHUB_OWNER}/{GITHUB_REPO}/releases/latest");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(github_error)?;

    let release = client
        .get(url)
        .header("Accept", "application/vnd.github+json")
        .header("Authorization", github_auth_header())
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .header("User-Agent", "local-brain-updater")
        .send()
        .await
        .map_err(github_error)?
        .error_for_status()
        .map_err(github_error)?
        .json::<GitHubRelease>()
        .await
        .map_err(github_error)?;

    release
        .assets
        .into_iter()
        .find(|asset| asset.name == "latest.json")
        .ok_or_else(|| AppError::not_found("GitHub release is missing latest.json"))
}

async fn latest_release_manifest(asset: &GitHubAsset) -> AppResult<serde_json::Value> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(github_error)?;

    client
        .get(&asset.url)
        .header("Accept", "application/octet-stream")
        .header("Authorization", github_auth_header())
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .header("User-Agent", "local-brain-updater")
        .send()
        .await
        .map_err(github_error)?
        .error_for_status()
        .map_err(github_error)?
        .json::<serde_json::Value>()
        .await
        .map_err(github_error)
}

/// Check the private GitHub release feed through the GitHub API. The standard
/// github.com release download URL returns 404 for private repos even with a
/// bearer token, so this command discovers the latest release asset ID first,
/// then points Tauri's updater at the API asset URL with auth headers.
#[tauri::command]
pub async fn github_private_update_check<R: Runtime>(
    webview: Webview<R>,
) -> AppResult<Option<PrivateUpdateMetadata>> {
    let manifest_asset = latest_release_manifest_asset().await?;
    let manifest = latest_release_manifest(&manifest_asset).await?;
    let current_version = parse_version(&webview.package_info().version.to_string())?;
    if release_version(&manifest)? <= current_version {
        return Ok(None);
    }

    let endpoint =
        Url::parse(&manifest_asset.url).map_err(|err| AppError::parse(err.to_string()))?;

    let updater = webview
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(updater_error)?
        .header("Accept", "application/octet-stream")
        .map_err(updater_error)?
        .header("Authorization", github_auth_header())
        .map_err(updater_error)?
        .header("X-GitHub-Api-Version", GITHUB_API_VERSION)
        .map_err(updater_error)?
        .build()
        .map_err(updater_error)?;

    let update = updater.check().await.map_err(updater_error)?;
    if let Some(update) = update {
        let date = update
            .date
            .map(|date| date.format(&time::format_description::well_known::Rfc3339))
            .transpose()
            .map_err(|err| AppError::parse(err.to_string()))?;
        Ok(Some(PrivateUpdateMetadata {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            date,
            body: update.body.clone(),
            raw_json: update.raw_json.clone(),
            rid: webview.resources_table().add(update),
        }))
    } else {
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{parse_version, release_version};

    #[test]
    fn release_version_accepts_tauri_manifest_version() {
        assert_eq!(
            release_version(&json!({ "version": "0.1.6" })).unwrap(),
            parse_version("0.1.6").unwrap()
        );
    }

    #[test]
    fn release_version_accepts_legacy_name_alias() {
        assert_eq!(
            release_version(&json!({ "name": "v0.2.0" })).unwrap(),
            parse_version("0.2.0").unwrap()
        );
    }
}
