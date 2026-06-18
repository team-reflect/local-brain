//! The CLI's BYOK model boundary. Mirrors the app's checked boundary: the key
//! comes from the environment (`ANTHROPIC_API_KEY`), never from a settings row,
//! and the whole surface degrades cleanly when it is absent. To stay dependency-
//! free (no HTTP/TLS crate), the actual request is made by shelling out to
//! `curl`, which ships on macOS. When no key is set, `synthesize` returns
//! `Ok(None)` and `brain ask` falls back to returning the retrieved evidence.

use std::process::Command;

use serde_json::{json, Value};

use crate::commands::read::ChunkHit;
use crate::error::CliError;

const DEFAULT_MODEL: &str = "claude-sonnet-4-6";
const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";

pub struct Answer {
    pub text: String,
    pub model: String,
}

const SYSTEM: &str = "You are Local Brain, a personal knowledge assistant. Answer the question using ONLY the numbered sources provided. Cite every factual claim with bracketed source numbers like [1] or [2][3]. If the sources do not contain the answer, say so plainly. Do not use outside knowledge. Be concise.";

/// Assemble the single user message from the cited chunks — the one typed
/// boundary through which retrieved text reaches the model (nothing else is sent).
fn build_user_message(question: &str, chunks: &[ChunkHit]) -> String {
    if chunks.is_empty() {
        return format!("Question: {question}\n\n(No sources were retrieved.)");
    }
    let mut sources = String::new();
    for (i, chunk) in chunks.iter().enumerate() {
        let label = chunk.record_title.as_deref().unwrap_or(&chunk.record_type);
        let body: String = chunk.text.chars().take(1200).collect();
        sources.push_str(&format!(
            "[{}] ({}: {})\n{}\n\n",
            i + 1,
            chunk.record_type,
            label,
            body
        ));
    }
    format!("Sources:\n\n{sources}---\n\nQuestion: {question}")
}

/// Synthesize an answer if a model is configured. `Ok(None)` means no key set
/// (degrade to evidence-only); `Err` means a configured model call failed.
pub fn synthesize(question: &str, chunks: &[ChunkHit]) -> Result<Option<Answer>, CliError> {
    let key = match std::env::var("ANTHROPIC_API_KEY") {
        Ok(k) if !k.trim().is_empty() => k,
        _ => return Ok(None),
    };
    let model = std::env::var("BRAIN_MODEL").unwrap_or_else(|_| DEFAULT_MODEL.to_string());

    let body = json!({
        "model": model,
        "max_tokens": 1024,
        "temperature": 0,
        "system": SYSTEM,
        "messages": [{ "role": "user", "content": build_user_message(question, chunks) }],
    });

    let output = Command::new("curl")
        .arg("-sS")
        .arg("-X")
        .arg("POST")
        .arg(ENDPOINT)
        .arg("-H")
        .arg("content-type: application/json")
        .arg("-H")
        .arg(format!("x-api-key: {key}"))
        .arg("-H")
        .arg("anthropic-version: 2023-06-01")
        .arg("-d")
        .arg(body.to_string())
        .output()
        .map_err(|e| CliError::Runtime(format!("could not run curl for the model call: {e}")))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(CliError::Runtime(format!(
            "model request failed: {}",
            err.trim()
        )));
    }

    let parsed: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| CliError::Runtime(format!("could not parse model response: {e}")))?;
    if let Some(error) = parsed.get("error") {
        return Err(CliError::Runtime(format!("model error: {error}")));
    }
    let text = parsed
        .get("content")
        .and_then(|c| c.as_array())
        .map(|blocks| {
            blocks
                .iter()
                .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("")
        })
        .unwrap_or_default();
    let returned_model = parsed
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or(&model)
        .to_string();

    Ok(Some(Answer {
        text,
        model: returned_model,
    }))
}
