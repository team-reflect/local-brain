//! Pure string-normalization helpers shared by the `add` writers. None touch the
//! database; they mirror the core TypeScript normalizers so a record written via
//! the CLI stores byte-identically to one written in the app.

use unicode_normalization::{char::is_combining_mark, UnicodeNormalization};

/// Trim a string, collapsing blank-or-missing to `None`.
pub(super) fn normalize_optional(raw: Option<&str>) -> Option<String> {
    raw.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

/// Collapse internal whitespace runs to single spaces and trim, preserving case.
/// The Rust twin of core `squish` (`packages/core/src/text/normalize.ts`), used
/// for short display labels like titles so the CLI and app store them identically.
pub(super) fn squish(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Normalize a title to its storage form (squish), collapsing blank to `None`.
/// Mirrors the core `labelOrNull` used by `validateNewDocument`/`Interaction`.
pub(super) fn normalize_title(raw: Option<&str>) -> Option<String> {
    raw.map(squish).filter(|value| !value.is_empty())
}

/// Lowercase + trim an email, collapsing blank to `None`.
pub(super) fn normalize_email(raw: Option<&str>) -> Option<String> {
    normalize_optional(raw).map(|value| value.to_lowercase())
}

/// Reduce a phone number to its ASCII digits, collapsing empty to `None`.
pub(super) fn normalize_phone(raw: Option<&str>) -> Option<String> {
    normalize_optional(raw)
        .map(|value| value.chars().filter(|c| c.is_ascii_digit()).collect())
        .filter(|value: &String| !value.is_empty())
}

/// Fold a display name to a comparison key: lowercase, strip diacritics, replace
/// punctuation with spaces, and collapse whitespace. Used for name-based dedupe.
pub(super) fn normalize_name(raw: &str) -> String {
    raw.to_lowercase()
        .nfkd()
        .filter(|c| !is_combining_mark(*c))
        .map(|c| {
            if c.is_alphanumeric() || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Trim + lowercase a source slug to its lookup form.
pub(super) fn normalize_source_slug(raw: &str) -> String {
    raw.trim().to_lowercase()
}

/// A minimal structural email check: a non-empty local part, a dotted domain,
/// and no internal whitespace. Not RFC-complete — just enough to reject obvious
/// non-addresses before they become people.
pub(super) fn valid_email(email: &str) -> bool {
    let Some((local, domain)) = email.split_once('@') else {
        return false;
    };
    !local.trim().is_empty()
        && !domain.trim().is_empty()
        && domain.contains('.')
        && !email.chars().any(char::is_whitespace)
}

/// Reduce an arbitrary string to a filesystem-safe asset filename: keep
/// alphanumerics plus `.`/`-`/`_`, replace everything else with `-`, and never
/// return an empty name.
pub(super) fn safe_filename(raw: &str) -> String {
    let cleaned = raw
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .trim_matches(['.', '-'])
        .to_string();
    if cleaned.is_empty() {
        "asset".to_string()
    } else {
        cleaned
    }
}
