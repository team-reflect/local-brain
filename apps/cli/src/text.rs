//! Text normalization, paragraph-aware chunking, and SHA-256 content hashing.
//! A faithful Rust port of `packages/core/src/ingest/{chunk,hash}.ts` so a note
//! added via the CLI dedupes against — and chunks identically to — one added in
//! the app. The shared SQLite schema is the contract; this keeps the derived
//! data byte-compatible across both writers.

use std::collections::HashSet;

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

/// Lowercase SHA-256 hex of arbitrary bytes. The one hashing primitive for the
/// CLI: text dedupe ([`content_hash`]) and binary asset dedupe both hash through
/// here so the digest format can never diverge between them.
pub fn sha256_hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let digest = Sha256::digest(bytes);
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        hex.push(HEX[(byte >> 4) as usize] as char);
        hex.push(HEX[(byte & 0x0f) as usize] as char);
    }
    hex
}

/// SHA-256 hex of the UTF-8 bytes (already-normalized text). Mirrors `contentHash`.
pub fn content_hash(text: &str) -> String {
    sha256_hex(text.as_bytes())
}

/// Hard-split a paragraph longer than `max_chars` (in UTF-16 code units) into
/// whole-char pieces, each within budget. Packing by UTF-16 units — not Unicode
/// scalars — keeps boundaries aligned with the TS `chunkText`, which measures
/// with `String.length`.
fn split_oversized(paragraph: &str, max_chars: usize) -> Vec<String> {
    let mut pieces: Vec<String> = Vec::new();
    let mut current = String::new();
    let mut units = 0usize;
    for ch in paragraph.chars() {
        let width = ch.len_utf16();
        if units + width > max_chars && !current.is_empty() {
            pieces.push(std::mem::take(&mut current));
            units = 0;
        }
        current.push(ch);
        units += width;
    }
    if !current.is_empty() {
        pieces.push(current);
    }
    pieces
}

/// Length in UTF-16 code units, mirroring JavaScript's `String.length` so chunk
/// sizing matches the TS port byte-for-byte for the same normalized text.
fn char_len(s: &str) -> usize {
    s.chars().map(char::len_utf16).sum()
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
    // Preserve the complete source body, but index only the earliest occurrence
    // of byte-identical chunks. Quoted email history otherwise creates hundreds
    // of redundant FTS rows and embeddings for one interaction. This is the
    // Rust twin of the exact-text de-duplication in the TypeScript `chunkText`.
    let mut seen = HashSet::new();
    chunks
        .into_iter()
        .filter(|chunk| seen.insert(chunk.clone()))
        .collect()
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

        let big = format!(
            "{}{}{}",
            "a".repeat(1000),
            "b".repeat(1000),
            "c".repeat(500)
        );
        let pieces = chunk_text_with(&big, 1000);
        assert_eq!(pieces.len(), 3);
        assert_eq!(char_len(&pieces[0]), 1000);
    }

    #[test]
    fn packs_by_utf16_units_like_js_string_length() {
        // "😀" is one Unicode scalar but two UTF-16 code units, like JS counts it.
        // 600 of them is 1200 units, so the 1000 cap must hard-split (a scalar
        // count of 600 would have wrongly fit in a single chunk).
        let emoji = "😀".repeat(600);
        let pieces = chunk_text_with(&emoji, 1000);
        assert!(
            pieces.len() >= 2,
            "expected a hard split, got {}",
            pieces.len()
        );
        for piece in &pieces {
            assert!(char_len(piece) <= 1000);
        }
    }

    #[test]
    fn keeps_only_the_earliest_byte_identical_searchable_chunk() {
        let repeated = "x".repeat(10);
        let text = format!("{repeated}\n\nunique text\n\n{repeated}");
        assert_eq!(
            chunk_text_with(&text, 10),
            vec![repeated, "unique tex".to_string(), "t".to_string()]
        );
    }

    #[test]
    fn exact_chunk_dedupe_is_case_sensitive() {
        assert_eq!(
            chunk_text_with("Quoted text\n\nquoted text", 11),
            vec!["Quoted text".to_string(), "quoted text".to_string()]
        );
    }
}
