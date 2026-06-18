//! Text normalization, paragraph-aware chunking, and SHA-256 content hashing.
//! A faithful Rust port of `packages/core/src/ingest/{chunk,hash}.ts` so a note
//! added via the CLI dedupes against — and chunks identically to — one added in
//! the app. The shared SQLite schema is the contract; this keeps the derived
//! data byte-compatible across both writers.

use sha2::{Digest, Sha256};

const DEFAULT_MAX_CHARS: usize = 1000;

/// Normalize newlines to `\n`, strip trailing line whitespace, collapse 3+ blank
/// lines to one, and trim. Mirrors `normalizeText`.
pub fn normalize_text(raw: &str) -> String {
    let unified = raw.replace("\r\n", "\n").replace('\r', "\n");
    let trimmed_lines: Vec<&str> = unified
        .lines()
        .map(|line| line.trim_end_matches([' ', '\t']))
        .collect();
    let joined = trimmed_lines.join("\n");
    // Collapse runs of 3+ newlines down to exactly two.
    let mut out = String::with_capacity(joined.len());
    let mut newline_run = 0usize;
    for ch in joined.chars() {
        if ch == '\n' {
            newline_run += 1;
            if newline_run <= 2 {
                out.push('\n');
            }
        } else {
            newline_run = 0;
            out.push(ch);
        }
    }
    out.trim().to_string()
}

/// SHA-256 hex of the UTF-8 bytes (already-normalized text). Mirrors `contentHash`.
pub fn content_hash(text: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in digest {
        hex.push_str(&format!("{byte:02x}"));
    }
    hex
}

/// Hard-split a paragraph longer than `max_chars` on char boundaries.
fn split_oversized(paragraph: &str, max_chars: usize) -> Vec<String> {
    let chars: Vec<char> = paragraph.chars().collect();
    chars
        .chunks(max_chars)
        .map(|piece| piece.iter().collect())
        .collect()
}

fn char_len(s: &str) -> usize {
    s.chars().count()
}

/// Split normalized text into ordered chunk strings. Mirrors `chunkText`
/// (paragraph packing up to `max_chars`, hard-split of oversized paragraphs).
pub fn chunk_text(text: &str) -> Vec<String> {
    chunk_text_with(text, DEFAULT_MAX_CHARS)
}

pub fn chunk_text_with(text: &str, max_chars: usize) -> Vec<String> {
    let normalized = normalize_text(text);
    if normalized.is_empty() {
        return Vec::new();
    }

    let mut paragraphs: Vec<String> = Vec::new();
    for para in normalized.split("\n\n") {
        let trimmed = para.trim();
        if trimmed.is_empty() {
            continue;
        }
        if char_len(trimmed) > max_chars {
            paragraphs.extend(split_oversized(trimmed, max_chars));
        } else {
            paragraphs.push(trimmed.to_string());
        }
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();
    for paragraph in paragraphs {
        if current.is_empty() {
            current = paragraph;
        } else if char_len(&current) + 2 + char_len(&paragraph) <= max_chars {
            current.push_str("\n\n");
            current.push_str(&paragraph);
        } else {
            chunks.push(std::mem::take(&mut current));
            current = paragraph;
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_whitespace_like_the_ts_port() {
        assert_eq!(normalize_text("a  \r\n\r\n\r\n\r\nb  "), "a\n\nb");
    }

    #[test]
    fn hash_is_stable_sha256_hex() {
        // echo -n "hello" | sha256sum
        assert_eq!(
            content_hash("hello"),
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    }

    #[test]
    fn chunks_pack_paragraphs_and_hard_split_oversized() {
        assert_eq!(chunk_text(""), Vec::<String>::new());
        let packed = chunk_text("one\n\ntwo");
        assert_eq!(packed, vec!["one\n\ntwo".to_string()]);

        let big = "x".repeat(2500);
        let pieces = chunk_text_with(&big, 1000);
        assert_eq!(pieces.len(), 3);
        assert_eq!(char_len(&pieces[0]), 1000);
    }
}
