//! The local embedding runtime (Reflect-embeddings port): fastembed (ONNX)
//! in-process, off the UI thread. The model (all-MiniLM-L6-v2, 384-dim) is
//! downloaded on demand into app data — never bundled — and every failure
//! degrades to a reported "unavailable" state (the same recoverable contract as
//! sqlite-vec): semantic search is strictly additive, so nothing here may ever
//! take the app down.
//!
//! Unlike Reflect Open, the desktop has no Tauri event channel wired into the
//! IPC bridge, so progress is *polled*: `embed_status` reports the latest byte
//! counts the runtime has stored, and the frontend re-queries while loading.

mod write;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};
use hf_hub::api::sync::ApiBuilder;
use hf_hub::api::Progress;
use hf_hub::Cache;
use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::db::DbState;
use crate::error::{AppError, AppResult};

pub use write::EmbeddedChunk;

/// Identifier recorded per vector; changing the model bumps this and forces an
/// embedding rebuild (the TS pipeline compares it per chunk).
pub const MODEL_ID: &str = "all-MiniLM-L6-v2";

/// The hf-hub repo and files fastembed resolves for `AllMiniLML6V2`. Mirrored
/// here so the pre-download (the progress-reporting path) fills the exact cache
/// `try_new` reads. If fastembed ever changes its file set, the only cost is
/// that it downloads the difference itself — without progress.
const MODEL_REPO: &str = "Qdrant/all-MiniLM-L6-v2-onnx";
const MODEL_FILES: [&str; 5] = [
    "model.onnx",
    "tokenizer.json",
    "config.json",
    "special_tokens_map.json",
    "tokenizer_config.json",
];

/// Byte counts for an active model download. Absent until the download starts;
/// after the last byte it stays at 100% through the model-load phase.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ByteProgress {
    pub downloaded: u64,
    pub total: u64,
}

/// The runtime status, serialized as `{ status, ... }` for the TS zod union.
#[derive(Clone, Serialize)]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "status"
)]
pub enum EmbedStatus {
    /// No model loaded yet; `embed_ensure` will download/load it.
    Uninitialized,
    /// Download/load in progress (first run downloads ~90MB). The runtime keeps
    /// the latest byte counts so polls report real progress.
    Loading {
        #[serde(skip_serializing_if = "Option::is_none")]
        progress: Option<ByteProgress>,
    },
    /// `embed_texts` is ready; `model` is recorded per vector (rebuild key).
    Ready { model: String },
    /// Load failed; semantic search is unavailable (lexical still works).
    Failed { message: String },
}

#[derive(Default)]
enum Runtime {
    #[default]
    Uninitialized,
    Loading {
        progress: Option<ByteProgress>,
    },
    // fastembed's `embed` takes `&mut self`, so the model sits behind its own
    // Mutex — embed calls serialize, which batching makes irrelevant.
    Ready(Arc<Mutex<TextEmbedding>>),
    Failed(String),
}

/// Process-wide embedding runtime state.
#[derive(Default)]
pub struct EmbedState(Mutex<Runtime>);

fn lock_state<'a>(
    state: &'a State<'a, EmbedState>,
) -> AppResult<std::sync::MutexGuard<'a, Runtime>> {
    state
        .0
        .lock()
        .map_err(|_| AppError::io("embed state lock poisoned by an earlier panic"))
}

fn status_of(runtime: &Runtime) -> EmbedStatus {
    match runtime {
        Runtime::Uninitialized => EmbedStatus::Uninitialized,
        Runtime::Loading { progress } => EmbedStatus::Loading {
            progress: *progress,
        },
        Runtime::Ready(_) => EmbedStatus::Ready {
            model: MODEL_ID.to_string(),
        },
        Runtime::Failed(message) => EmbedStatus::Failed {
            message: message.clone(),
        },
    }
}

/// Record download progress on the runtime state, so an `embed_status` poll
/// (e.g. a settings surface opened mid-download) reports the same bytes the
/// downloader has seen. Only an in-flight load is updated.
fn store_progress(app: &AppHandle, progress: ByteProgress) {
    let state = app.state::<EmbedState>();
    let Ok(mut runtime) = state.0.lock() else {
        return;
    };
    if matches!(*runtime, Runtime::Loading { .. }) {
        *runtime = Runtime::Loading {
            progress: Some(progress),
        };
    }
}

/// How many newly-downloaded bytes accumulate between progress updates.
const PROGRESS_STEP: u64 = 1024 * 1024;

struct DownloadState {
    app: AppHandle,
    downloaded: u64,
    total: u64,
    stored: u64,
}

impl DownloadState {
    fn store(&mut self) {
        self.stored = self.downloaded;
        store_progress(
            &self.app,
            ByteProgress {
                downloaded: self.downloaded,
                total: self.total,
            },
        );
    }
}

/// Cumulative byte progress across the whole file set. hf-hub takes the reporter
/// by value per file, so the shared tally lives behind an `Arc`.
#[derive(Clone)]
struct DownloadProgress(Arc<Mutex<DownloadState>>);

impl DownloadProgress {
    fn new(app: AppHandle, total: u64) -> Self {
        let mut state = DownloadState {
            app,
            downloaded: 0,
            total,
            stored: 0,
        };
        state.store();
        Self(Arc::new(Mutex::new(state)))
    }
}

impl Progress for DownloadProgress {
    fn init(&mut self, _size: usize, _filename: &str) {}

    fn update(&mut self, size: usize) {
        let Ok(mut state) = self.0.lock() else {
            return;
        };
        state.downloaded += size as u64;
        if state.downloaded - state.stored >= PROGRESS_STEP || state.downloaded >= state.total {
            state.store();
        }
    }

    fn finish(&mut self) {}
}

/// Fetch whatever model files are missing from the cache, with byte progress.
/// fastembed downloads these itself inside `try_new`, but silently; fetching
/// them first through the same hf-hub cache gives the UI a progress bar and
/// leaves `try_new` a pure cache hit. Mirrors fastembed's resolution (env
/// overrides included) so both sides agree on location and endpoint.
fn download_model_files(app: &AppHandle, cache_dir: &Path) -> Result<(), String> {
    let cache_dir = std::env::var("HF_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| cache_dir.to_path_buf());
    let endpoint =
        std::env::var("HF_ENDPOINT").unwrap_or_else(|_| "https://huggingface.co".to_string());

    let cached = Cache::new(cache_dir.clone()).model(MODEL_REPO.to_string());
    let missing: Vec<&str> = MODEL_FILES
        .iter()
        .copied()
        .filter(|file| cached.get(file).is_none())
        .collect();
    if missing.is_empty() {
        return Ok(());
    }

    let api = ApiBuilder::new()
        .with_cache_dir(cache_dir)
        .with_endpoint(endpoint)
        .build()
        .map_err(|err| format!("hf-hub api: {err}"))?;
    let repo = api.model(MODEL_REPO.to_string());

    // Size every missing file up front so the bar tracks one stable total.
    let mut total: u64 = 0;
    for file in &missing {
        total += api
            .metadata(&repo.url(file))
            .map_err(|err| format!("sizing {file}: {err}"))?
            .size() as u64;
    }

    let progress = DownloadProgress::new(app.clone(), total);
    for file in missing {
        repo.download_with_progress(file, progress.clone())
            .map_err(|err| format!("downloading {file}: {err}"))?;
    }
    Ok(())
}

/// Current runtime status. Poll this; it carries live download progress.
#[tauri::command]
pub fn embed_status(state: State<EmbedState>) -> AppResult<EmbedStatus> {
    let runtime = lock_state(&state)?;
    Ok(status_of(&runtime))
}

/// Ensure the model is loaded, downloading it on first use. Idempotent: a
/// concurrent call while loading returns immediately. Runs the load on a
/// blocking thread — model init is seconds even when cached.
#[tauri::command]
pub async fn embed_ensure(app: AppHandle, state: State<'_, EmbedState>) -> AppResult<EmbedStatus> {
    // Resolve the cache dir BEFORE flipping to Loading: it's the only step here
    // that may fail without a guaranteed state transition afterwards.
    let cache_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| AppError::io(format!("no app data dir: {err}")))?
        .join("models");

    {
        let mut runtime = lock_state(&state)?;
        match &*runtime {
            Runtime::Ready(_) | Runtime::Loading { .. } => return Ok(status_of(&runtime)),
            Runtime::Uninitialized | Runtime::Failed(_) => {
                *runtime = Runtime::Loading { progress: None };
            }
        }
    }

    // From here every path — success, load failure, even a panicked blocking
    // task — must land the state in Ready or Failed: an early `?` would wedge
    // the runtime in Loading forever (later ensures return early on Loading).
    let app_for_progress = app.clone();
    let loaded: Result<TextEmbedding, String> =
        match tauri::async_runtime::spawn_blocking(move || {
            download_model_files(&app_for_progress, &cache_dir)?;
            TextEmbedding::try_new(
                InitOptions::new(EmbeddingModel::AllMiniLML6V2).with_cache_dir(cache_dir),
            )
            .map_err(|err| err.to_string())
        })
        .await
        {
            Ok(result) => result,
            Err(err) => Err(format!("embedding load task panicked: {err}")),
        };

    let status = {
        let mut runtime = lock_state(&state)?;
        *runtime = match loaded {
            Ok(model) => Runtime::Ready(Arc::new(Mutex::new(model))),
            Err(message) => Runtime::Failed(message),
        };
        status_of(&runtime)
    };
    Ok(status)
}

/// Embed a batch of texts → 384-dim vectors, off the UI thread. Errors if the
/// model isn't `Ready` (callers gate on `embed_status`/`embed_ensure`).
#[tauri::command]
pub async fn embed_texts(
    texts: Vec<String>,
    state: State<'_, EmbedState>,
) -> AppResult<Vec<Vec<f32>>> {
    let model = {
        let runtime = lock_state(&state)?;
        match &*runtime {
            Runtime::Ready(model) => Arc::clone(model),
            _ => return Err(AppError::io("embedding model is not loaded")),
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        let mut model = model
            .lock()
            .map_err(|_| AppError::io("embedding model lock poisoned"))?;
        model
            .embed(texts, None)
            .map_err(|err| AppError::io(format!("embedding failed: {err}")))
    })
    .await
    .map_err(|err| AppError::io(format!("embedding task panicked: {err}")))?
}

/// Apply a batch of freshly-embedded chunks: upsert each `(chunk_id, model_id)`
/// row and its vec0 vector. The TS pipeline only sends chunks it actually
/// embedded (hash-skip happens there), so this is a straight replace.
#[tauri::command]
pub fn embed_apply(db: State<DbState>, chunks: Vec<EmbeddedChunk>) -> AppResult<usize> {
    db.with_connection_mut(|conn| write::apply_chunks(conn, &chunks))
}

/// Drop the embeddings for content chunks that no longer exist (pruning).
#[tauri::command]
pub fn embed_delete(db: State<DbState>, chunk_ids: Vec<String>) -> AppResult<usize> {
    db.with_connection_mut(|conn| write::delete_chunks(conn, &chunk_ids))
}

/// Wipe every embedding + vector (rebuild / model change). Product data and the
/// FTS index are untouched — only this derived projection is cleared.
#[tauri::command]
pub fn embed_clear(db: State<DbState>) -> AppResult<usize> {
    db.with_connection_mut(write::clear)
}

#[cfg(test)]
mod e2e {
    //! End-to-end validation of the real native path: the actual fastembed model
    //! produces 384-dim vectors, `apply_chunks` stores them, and a real vec0
    //! cosine-KNN ranks a query by *meaning*. Ignored by default because it
    //! downloads ~90MB on first run; exercise with:
    //!   cargo test -p local-brain-desktop -- --ignored embeds_and_ranks_by_meaning

    use super::write::{apply_chunks, EmbeddedChunk};
    use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};

    fn vector_json(v: &[f32]) -> String {
        let parts: Vec<String> = v.iter().map(|x| x.to_string()).collect();
        format!("[{}]", parts.join(","))
    }

    #[test]
    #[ignore = "downloads ~90MB model; run with --ignored and network access"]
    fn embeds_and_ranks_by_meaning() {
        let mut model =
            TextEmbedding::try_new(InitOptions::new(EmbeddingModel::AllMiniLML6V2)).unwrap();
        let docs = vec![
            "Quarterly revenue grew on strong enterprise software sales.".to_string(),
            "My cat likes to nap in the afternoon sun by the window.".to_string(),
        ];
        let vectors = model.embed(docs, None).unwrap();
        assert_eq!(
            vectors[0].len(),
            384,
            "fastembed must produce 384-dim vectors"
        );

        let conn = brain_schema::open_in_memory().unwrap();
        let chunks: Vec<EmbeddedChunk> = vectors
            .iter()
            .enumerate()
            .map(|(i, vector)| EmbeddedChunk {
                chunk_id: format!("c{i}"),
                content_hash: format!("h{i}"),
                model_id: super::MODEL_ID.to_string(),
                vector: vector.clone(),
            })
            .collect();
        apply_chunks(&conn, &chunks).unwrap();

        // A finance-flavoured query should rank the revenue chunk first.
        let query = model
            .embed(
                vec!["How did our company sales perform last quarter?".to_string()],
                None,
            )
            .unwrap();
        let nearest: String = conn
            .query_row(
                "SELECT ce.chunk_id FROM chunk_vectors v \
                 JOIN chunk_embeddings ce ON ce.id = v.rowid \
                 WHERE v.embedding MATCH ?1 AND k = 2 ORDER BY v.distance LIMIT 1",
                rusqlite::params![vector_json(&query[0])],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(
            nearest, "c0",
            "semantic KNN should surface the revenue chunk"
        );
    }
}
