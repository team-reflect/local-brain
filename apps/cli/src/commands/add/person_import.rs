//! Guardrails for `brain add person-from-email`, which mints people from
//! untrusted email display names. The heuristics here decide whether a
//! `(display name, email)` pair looks like a real person worth creating —
//! inverting `Last, First` directory forms, stripping routing markers like
//! "via LinkedIn", and rejecting machine mailboxes, org/department labels, and
//! token noise — so automated imports do not flood the brain with fake people.

use super::text::{normalize_email, valid_email};

/// The outcome of assessing one untrusted `(name, email)` import pair.
pub(super) struct PersonImportAssessment {
    pub normalized_name: String,
    pub should_create_person: bool,
    pub reason_codes: Vec<&'static str>,
}

/// Assess whether an untrusted display-name/email pair should mint a person,
/// recording machine-readable `reason_codes` for every disqualifying signal.
pub(super) fn assess_person_import(raw_name: &str, email: &str) -> PersonImportAssessment {
    let email = normalize_email(Some(email)).unwrap_or_default();
    let (normalized_name, has_route_phrase) = normalize_untrusted_name(raw_name);
    let mut reason_codes = Vec::new();
    if !valid_email(&email) {
        reason_codes.push("invalid_email");
    }
    if is_machine_email(&email) {
        reason_codes.push("machine_email");
    }
    if normalized_name.is_empty() {
        reason_codes.push("missing_name");
    }
    if !normalized_name.is_empty()
        && (normalized_name.eq_ignore_ascii_case(&email)
            || normalized_name.contains('@')
            || normalize_email(Some(&normalized_name)).as_deref() == Some(email.as_str()))
    {
        reason_codes.push("email_as_name");
    }
    // A routing marker (" via ", " from ", " at ") was stripped from the display
    // name. That alone is not disqualifying: senders such as
    // "Robin Spencer via LinkedIn" normalize to a perfectly usable "Robin Spencer".
    // Only flag it when the residual name does not independently read like a
    // capitalized person name, so noise like "noreply via Mailchimp" -> "noreply"
    // is still skipped.
    if has_route_phrase && !looks_like_capitalized_person_name(&normalized_name) {
        reason_codes.push("route_phrase");
    }
    if has_numeric_or_token_noise(&normalized_name) {
        reason_codes.push("numeric_or_token_noise");
    }
    if !normalized_name.is_empty()
        && !reason_codes.iter().any(|code| {
            matches!(
                *code,
                "email_as_name" | "numeric_or_token_noise" | "route_phrase"
            )
        })
        && !looks_like_capitalized_person_name(&normalized_name)
    {
        reason_codes.push("not_capitalized_first_last");
    }

    PersonImportAssessment {
        normalized_name,
        should_create_person: reason_codes.is_empty(),
        reason_codes,
    }
}

/// Normalize an untrusted display name: strip quotes, collapse whitespace, drop a
/// trailing routing marker, and invert a plausible `Last, First` directory form.
/// Returns the cleaned name and whether a routing marker was present.
fn normalize_untrusted_name(raw: &str) -> (String, bool) {
    let cleaned = raw
        .trim()
        .trim_matches(|c: char| c == '\'' || c == '"')
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let lower = cleaned.to_lowercase();
    let mut route_index = None;
    for needle in [" via ", " from ", " at "] {
        if let Some(index) = lower.rfind(needle) {
            route_index = Some(route_index.map_or(index, |current: usize| current.min(index)));
        }
    }
    let route_stripped = route_index
        .map(|index| cleaned[..index].trim().to_string())
        .unwrap_or(cleaned);
    let parts: Vec<&str> = route_stripped.split(',').map(str::trim).collect();
    // Only invert `Last, First` directory strings when both sides read like a
    // real person name. Org/department labels such as "Acme, Sales" or
    // "Amazon, Customer Service" keep their comma so the downstream
    // capitalized-name guardrail rejects them instead of minting fake people.
    let normalized = if parts.len() == 2 && is_plausible_person_comma_inversion(parts[0], parts[1])
    {
        format!("{} {}", parts[1], parts[0])
    } else {
        route_stripped
    };
    (normalized.trim().to_string(), route_index.is_some())
}

/// Whether `Last, First` should be inverted to `First Last`. We require the
/// segment after the comma to look like a given name (one token, optionally a
/// trailing initial) and reject obvious organization/role labels on either side.
fn is_plausible_person_comma_inversion(last: &str, first: &str) -> bool {
    let last = last.trim();
    let first = first.trim();
    if last.is_empty() || first.is_empty() || is_name_suffix(first) {
        return false;
    }
    if last.split_whitespace().any(is_generic_role_term)
        || first.split_whitespace().any(is_generic_role_term)
    {
        return false;
    }
    if !is_plausible_given_name_segment(first) {
        return false;
    }
    looks_like_capitalized_person_name(&format!("{first} {last}"))
}

/// A `First` segment from a directory `Last, First` string: a single given name,
/// optionally followed by a short initial like `A.`. Two full words (e.g.
/// "Customer Service") are rejected.
fn is_plausible_given_name_segment(first: &str) -> bool {
    let mut words = first.split_whitespace();
    let Some(given) = words.next() else {
        return false;
    };
    if is_generic_role_term(given) {
        return false;
    }
    match words.next() {
        None => true,
        Some(second) => words.next().is_none() && is_name_initial(second),
    }
}

fn is_name_initial(token: &str) -> bool {
    let core = token.trim_end_matches('.');
    core.chars().count() == 1 && core.chars().all(char::is_alphabetic)
}

/// Generic role/department words that signal an organization mailbox rather than
/// a personal name (e.g. "Acme, Sales"). Mirrors the generic locals used by
/// `is_machine_email`.
fn is_generic_role_term(word: &str) -> bool {
    let cleaned = word
        .trim_matches(|c: char| !c.is_alphanumeric())
        .to_lowercase();
    matches!(
        cleaned.as_str(),
        "accounting"
            | "admin"
            | "billing"
            | "concierge"
            | "contact"
            | "customer"
            | "department"
            | "devs"
            | "education"
            | "finance"
            | "hello"
            | "help"
            | "info"
            | "marketing"
            | "newsletter"
            | "notifications"
            | "ops"
            | "operations"
            | "registration"
            | "sales"
            | "service"
            | "services"
            | "ship"
            | "support"
            | "team"
    )
}

fn is_name_suffix(raw: &str) -> bool {
    matches!(
        raw.trim().trim_matches('.').to_lowercase().as_str(),
        "jr" | "sr" | "ii" | "iii" | "iv" | "md" | "m d" | "do" | "d o" | "phd" | "ph d"
    )
}

/// Whether an address is a machine/no-reply/role mailbox rather than a person's.
fn is_machine_email(email: &str) -> bool {
    if !valid_email(email) {
        return false;
    }
    let (local, domain) = email.split_once('@').unwrap_or(("", ""));
    let generic = [
        "accounting",
        "admin",
        "announcements",
        "billing",
        "concierge",
        "contact",
        "customer.service",
        "customerservice",
        "devs",
        "do-not-reply",
        "donotreply",
        "education",
        "finance",
        "hello",
        "help",
        "info",
        "marketing",
        "newsletter",
        "no-reply",
        "noreply",
        "notifications",
        "ops",
        "operations",
        "postmaster",
        "registration",
        "sales",
        "ship",
        "support",
        "team",
        "test",
    ];
    if generic.contains(&local) {
        return true;
    }
    if [
        "bounce",
        "bounces",
        "mailer-daemon",
        "notification",
        "notifications",
        "reply",
        "replies",
    ]
    .iter()
    .any(|prefix| {
        local == *prefix
            || local.starts_with(&format!("{prefix}."))
            || local.starts_with(&format!("{prefix}-"))
            || local.starts_with(&format!("{prefix}_"))
    }) {
        return true;
    }
    if local.starts_with("no.reply")
        || local.starts_with("no-reply")
        || local.starts_with("noreply")
        || local.starts_with("do-not-reply")
        || local.starts_with("donotreply")
    {
        return true;
    }
    if [
        "adobesign.com",
        "docusign.net",
        "email.pandadoc.net",
        "facebookmail.com",
        "info.vercel.com",
        "login.customer.io",
        "team.twilio.com",
    ]
    .contains(&domain)
    {
        return true;
    }
    if domain.ends_with(".bnc.salesforce.com") {
        return true;
    }
    let compact: String = local
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    compact.len() >= 28 && compact.chars().any(|c| c.is_ascii_digit())
}

fn has_numeric_or_token_noise(name: &str) -> bool {
    let compact: String = name.chars().filter(|c| c.is_alphanumeric()).collect();
    name.chars().any(|c| c.is_ascii_digit())
        || (compact.chars().count() >= 24 && compact.chars().any(|c| c.is_ascii_digit()))
}

/// Whether a normalized name reads like a capitalized person name (2–6 words, each
/// capitalized or a lowercase particle like "van"/"de"), the final guardrail
/// before an untrusted name becomes a person.
fn looks_like_capitalized_person_name(name: &str) -> bool {
    let without_suffix = strip_name_suffix(name);
    let words: Vec<&str> = without_suffix.split_whitespace().collect();
    if words.len() < 2 || words.len() > 6 {
        return false;
    }
    let particles = [
        "de", "del", "der", "van", "von", "da", "di", "la", "le", "du",
    ];
    words.iter().all(|word| {
        // A surviving comma marks an un-inverted org string (e.g. "Acme,") that
        // normalize_untrusted_name deliberately left alone — not a person name.
        if word.contains(',') {
            return false;
        }
        let trimmed = word.trim_matches(|c: char| c == '\'' || c == '.' || c == '-');
        if trimmed.is_empty() {
            return false;
        }
        let lower = trimmed.to_lowercase();
        if particles.contains(&lower.as_str()) {
            return true;
        }
        trimmed
            .chars()
            .next()
            .map(|c| c.is_uppercase())
            .unwrap_or(false)
    })
}

fn strip_name_suffix(name: &str) -> String {
    let parts: Vec<&str> = name.split_whitespace().collect();
    if let Some(last) = parts.last() {
        if is_name_suffix(last.trim_start_matches(',')) {
            return parts[..parts.len().saturating_sub(1)].join(" ");
        }
    }
    name.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comma_inverts_plausible_person_names() {
        // Classic directory "Last, First" forms become "First Last".
        assert_eq!(normalize_untrusted_name("Smith, John").0, "John Smith");
        assert_eq!(normalize_untrusted_name("Doe, Jane A.").0, "Jane A. Doe");
        assert_eq!(
            normalize_untrusted_name("van der Berg, Maria").0,
            "Maria van der Berg"
        );
    }

    #[test]
    fn comma_keeps_org_labels_intact() {
        // Org/department labels must NOT be reversed into fake people.
        assert_eq!(normalize_untrusted_name("Acme, Sales").0, "Acme, Sales");
        assert_eq!(
            normalize_untrusted_name("Amazon, Customer Service").0,
            "Amazon, Customer Service"
        );
    }

    #[test]
    fn org_comma_labels_are_not_person_names() {
        // The downstream guardrail rejects the un-inverted comma strings, so no
        // person is minted for them.
        assert!(!looks_like_capitalized_person_name("Acme, Sales"));
        assert!(!looks_like_capitalized_person_name(
            "Amazon, Customer Service"
        ));
        // A real inverted person name still passes.
        assert!(looks_like_capitalized_person_name("John Smith"));
    }

    #[test]
    fn assess_skips_org_comma_labels() {
        let acme = assess_person_import("Acme, Sales", "person@example.com");
        assert!(!acme.should_create_person);
        assert!(acme.reason_codes.contains(&"not_capitalized_first_last"));

        let amazon = assess_person_import("Amazon, Customer Service", "buyer@example.com");
        assert!(!amazon.should_create_person);
        assert!(amazon.reason_codes.contains(&"not_capitalized_first_last"));
    }

    #[test]
    fn assess_creates_plausible_inverted_person() {
        let person = assess_person_import("Smith, John", "john@example.com");
        assert_eq!(person.normalized_name, "John Smith");
        assert!(person.should_create_person, "{:?}", person.reason_codes);
    }

    #[test]
    fn route_phrase_strips_to_usable_person_name() {
        // A routing marker is stripped, leaving a clean person name.
        let (name, had_route) = normalize_untrusted_name("Robin Spencer via LinkedIn");
        assert_eq!(name, "Robin Spencer");
        assert!(had_route);
    }

    #[test]
    fn assess_creates_person_after_stripping_route_phrase() {
        // Legitimate senders whose display name carries a routing marker must
        // still create a person once the marker is removed.
        for raw in [
            "Robin Spencer via LinkedIn",
            "Robin Spencer from Acme",
            "Robin Spencer at LinkedIn",
        ] {
            let person = assess_person_import(raw, "robin@example.com");
            assert_eq!(person.normalized_name, "Robin Spencer", "{raw}");
            assert!(
                person.should_create_person,
                "{raw} reason_codes: {:?}",
                person.reason_codes
            );
            assert!(
                !person.reason_codes.contains(&"route_phrase"),
                "{raw} should not be flagged route_phrase: {:?}",
                person.reason_codes
            );
        }
    }

    #[test]
    fn assess_skips_route_phrase_noise() {
        // When stripping the routing marker leaves something that is not a
        // capitalized person name, the import is still skipped and flagged.
        let noise = assess_person_import("noreply via Mailchimp", "sender@example.com");
        assert!(!noise.should_create_person);
        assert!(
            noise.reason_codes.contains(&"route_phrase"),
            "{:?}",
            noise.reason_codes
        );
    }
}
