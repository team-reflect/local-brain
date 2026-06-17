//! Safe file-read primitives for ingestion (Plan 04b).
//!
//! These commands let the user import readable text from disk without exposing
//! arbitrary filesystem access:
//!
//! - [`read_text_file`] reads ONE user-selected text/markdown file: it
//!   canonicalizes the path, enforces a size cap, and requires valid UTF-8,
//!   returning clear errors otherwise.
//! - [`read_text_folder`] scans a chosen directory for supported text-like
//!   files, skipping hidden/unsupported/oversized/binary files and anything that
//!   resolves (via a symlink) outside the chosen root, and reports per-file skip
//!   reasons plus counts.
//!
//! The returned `content_hash` is SHA-256 over the file's raw UTF-8 bytes; it is
//! used to flag duplicate files *within a folder scan*. The authoritative
//! cross-record dedupe hash is computed at ingest time (Plan 04a) over the
//! *normalized* text, so a pasted note and an imported file still converge.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::error::{AppError, AppResult};

/// Per-file import ceiling. Text/markdown notes are tiny; this guards against
/// accidentally slurping a huge file into SQLite as a "document".
const MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;

/// A successfully read text file, ready to be ingested as a document/interaction.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileImport {
    /// The canonical absolute path read from.
    pub path: String,
    /// The file's UTF-8 contents (not yet normalized — ingest does that).
    pub contents: String,
    /// SHA-256 (hex) of the raw UTF-8 bytes; used for intra-scan dedupe.
    pub content_hash: String,
    pub byte_len: u64,
    /// `"text"` or `"markdown"`.
    pub kind: String,
}

/// A file the folder scan declined to import, with a machine-readable reason.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkippedFile {
    pub path: String,
    /// One of: hidden, unsupported, oversized, binary, unreadable, traversal, duplicate.
    pub reason: String,
}

/// The result of scanning a folder for importable text files.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderScan {
    pub root: String,
    pub files: Vec<FileImport>,
    pub skipped: Vec<SkippedFile>,
    pub imported_count: usize,
    pub skipped_count: usize,
}

enum SkipReason {
    Unsupported,
    Oversized,
    Binary,
    Unreadable,
}

impl SkipReason {
    fn as_str(&self) -> &'static str {
        match self {
            SkipReason::Unsupported => "unsupported",
            SkipReason::Oversized => "oversized",
            SkipReason::Binary => "binary",
            SkipReason::Unreadable => "unreadable",
        }
    }
}

/// Map a supported extension to its document kind; `None` means unsupported.
fn kind_for(path: &Path) -> Option<&'static str> {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("md" | "markdown") => Some("markdown"),
        Some("txt" | "text") => Some("text"),
        _ => None,
    }
}

fn hash_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Read and validate one already-canonical regular file. Returns a typed
/// [`SkipReason`] (rather than an `AppError`) so the folder scan can record it.
fn classify(canonical: &Path) -> Result<FileImport, SkipReason> {
    let Some(kind) = kind_for(canonical) else {
        return Err(SkipReason::Unsupported);
    };
    let meta = fs::metadata(canonical).map_err(|_| SkipReason::Unreadable)?;
    if meta.len() > MAX_FILE_BYTES {
        return Err(SkipReason::Oversized);
    }
    let bytes = fs::read(canonical).map_err(|_| SkipReason::Unreadable)?;
    let contents = String::from_utf8(bytes).map_err(|_| SkipReason::Binary)?;
    let content_hash = hash_hex(contents.as_bytes());
    Ok(FileImport {
        path: canonical.display().to_string(),
        content_hash,
        byte_len: meta.len(),
        kind: kind.to_string(),
        contents,
    })
}

/// Canonicalize a path, translating "not found" into a typed [`AppError`].
fn canonicalize(path: &str) -> AppResult<PathBuf> {
    Path::new(path).canonicalize().map_err(|err| {
        if err.kind() == std::io::ErrorKind::NotFound {
            AppError::not_found(format!("no such file or directory: {path}"))
        } else {
            AppError::io(format!("could not resolve path {path}: {err}"))
        }
    })
}

/// Read one user-selected text/markdown file into memory. Pure core of the
/// `read_text_file` command (no Tauri types) so it is unit-testable.
pub fn read_one(path: &str) -> AppResult<FileImport> {
    let canonical = canonicalize(path)?;
    if !canonical.is_file() {
        return Err(AppError::parse(format!("not a regular file: {path}")));
    }
    classify(&canonical).map_err(|reason| match reason {
        SkipReason::Oversized => AppError::parse(format!(
            "file exceeds the {MAX_FILE_BYTES}-byte import limit: {path}"
        )),
        SkipReason::Binary => AppError::parse(format!("file is not valid UTF-8 text: {path}")),
        SkipReason::Unsupported => AppError::parse(format!(
            "unsupported file type (expected .txt or .md): {path}"
        )),
        SkipReason::Unreadable => AppError::io(format!("could not read file: {path}")),
    })
}

/// Scan a folder (recursively) for importable text files. Pure core of the
/// `read_text_folder` command.
pub fn scan(root: &str) -> AppResult<FolderScan> {
    let root_canonical = canonicalize(root)?;
    if !root_canonical.is_dir() {
        return Err(AppError::parse(format!("not a directory: {root}")));
    }

    let mut files: Vec<FileImport> = Vec::new();
    let mut skipped: Vec<SkippedFile> = Vec::new();
    let mut seen_hashes: HashSet<String> = HashSet::new();
    let mut stack: Vec<PathBuf> = vec![root_canonical.clone()];

    let skip = |path: &Path, reason: &str, out: &mut Vec<SkippedFile>| {
        out.push(SkippedFile {
            path: path.display().to_string(),
            reason: reason.to_string(),
        });
    };

    while let Some(dir) = stack.pop() {
        let entries = fs::read_dir(&dir)?;
        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();

            // Skip dotfiles and dot-directories outright.
            if name.starts_with('.') {
                skip(&path, "hidden", &mut skipped);
                continue;
            }

            let file_type = entry.file_type()?;

            if file_type.is_dir() {
                match path.canonicalize() {
                    Ok(canonical) if canonical.starts_with(&root_canonical) => {
                        stack.push(canonical)
                    }
                    Ok(_) => skip(&path, "traversal", &mut skipped),
                    Err(_) => skip(&path, "unreadable", &mut skipped),
                }
                continue;
            }

            // Regular files only (reject symlinks-to-files etc. for safety).
            if !file_type.is_file() {
                skip(&path, "unsupported", &mut skipped);
                continue;
            }

            let canonical = match path.canonicalize() {
                Ok(canonical) => canonical,
                Err(_) => {
                    skip(&path, "unreadable", &mut skipped);
                    continue;
                }
            };
            if !canonical.starts_with(&root_canonical) {
                skip(&path, "traversal", &mut skipped);
                continue;
            }

            match classify(&canonical) {
                Ok(file) => {
                    if seen_hashes.contains(&file.content_hash) {
                        skip(&canonical, "duplicate", &mut skipped);
                    } else {
                        seen_hashes.insert(file.content_hash.clone());
                        files.push(file);
                    }
                }
                Err(reason) => skip(&canonical, reason.as_str(), &mut skipped),
            }
        }
    }

    Ok(FolderScan {
        root: root_canonical.display().to_string(),
        imported_count: files.len(),
        skipped_count: skipped.len(),
        files,
        skipped,
    })
}

/// Read one user-selected text/markdown file.
#[tauri::command]
pub fn read_text_file(path: String) -> AppResult<FileImport> {
    read_one(&path)
}

/// Scan a user-selected folder for importable text/markdown files.
#[tauri::command]
pub fn read_text_folder(path: String) -> AppResult<FolderScan> {
    scan(&path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use tempfile::tempdir;

    fn write(dir: &Path, name: &str, contents: &[u8]) -> PathBuf {
        let path = dir.join(name);
        let mut file = File::create(&path).unwrap();
        file.write_all(contents).unwrap();
        path
    }

    #[test]
    fn reads_a_text_file_and_hashes_it() {
        let dir = tempdir().unwrap();
        let path = write(dir.path(), "note.md", b"# Title\n\nBody.");
        let import = read_one(path.to_str().unwrap()).unwrap();
        assert_eq!(import.kind, "markdown");
        assert_eq!(import.contents, "# Title\n\nBody.");
        assert_eq!(import.content_hash.len(), 64);
        assert_eq!(import.byte_len, 14);
    }

    #[test]
    fn rejects_unsupported_and_missing_and_binary() {
        let dir = tempdir().unwrap();
        let bin = write(dir.path(), "app.bin", &[0xff, 0xfe, 0x00, 0x01]);
        // Wrong extension is rejected before we even read.
        assert!(read_one(bin.to_str().unwrap()).is_err());

        // A .txt with invalid UTF-8 is rejected as not-text.
        let bad = write(dir.path(), "bad.txt", &[0xff, 0xfe, 0x00]);
        let err = read_one(bad.to_str().unwrap()).unwrap_err();
        assert!(matches!(err, AppError::Parse { .. }));

        let missing = dir.path().join("nope.txt");
        let err = read_one(missing.to_str().unwrap()).unwrap_err();
        assert!(matches!(err, AppError::NotFound { .. }));
    }

    #[test]
    fn scans_a_folder_skipping_hidden_unsupported_and_duplicates() {
        let dir = tempdir().unwrap();
        write(dir.path(), "a.txt", b"alpha");
        write(dir.path(), "b.md", b"beta");
        write(dir.path(), "dup.txt", b"alpha"); // same content as a.txt
        write(dir.path(), ".secret", b"hidden");
        write(dir.path(), "image.png", b"not text");
        // A nested directory is walked recursively.
        let nested = dir.path().join("sub");
        fs::create_dir(&nested).unwrap();
        write(&nested, "c.txt", b"gamma");

        let scan = scan(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(scan.imported_count, 3, "a.txt, b.md, sub/c.txt");
        let reasons: HashSet<&str> = scan.skipped.iter().map(|s| s.reason.as_str()).collect();
        assert!(reasons.contains("hidden"));
        assert!(reasons.contains("unsupported"));
        assert!(reasons.contains("duplicate"));
    }
}
