//! Skill lint: every `brain` command the agent skill documents must be a real,
//! invokable CLI command. This guards against the skill doc drifting away from
//! the actual command surface (a stale skill would mislead an agent).

use std::process::Command;

const BIN: &str = env!("CARGO_BIN_EXE_brain");

/// Top-level and nested command paths the skill (skills/brain/SKILL.md) relies on.
const DOCUMENTED: &[&[&str]] = &[
    &["status"],
    &["path"],
    &["doctor"],
    &["contract"],
    &["add", "person"],
    &["add", "asset"],
    &["add", "document"],
    &["add", "interaction"],
    &["add", "task"],
    &["remember"],
    &["search"],
    &["show"],
    &["today"],
    &["report", "daily"],
    &["tasks", "plan-day"],
    &["relationships", "followups"],
    &["changes"],
    &["graph"],
];

#[test]
fn skill_documents_only_real_commands() {
    for path in DOCUMENTED {
        let mut args: Vec<&str> = path.to_vec();
        args.push("--help");
        let out = Command::new(BIN)
            .args(&args)
            .output()
            .expect("run brain --help");
        assert!(
            out.status.success(),
            "documented command `brain {}` is not valid: {}",
            path.join(" "),
            String::from_utf8_lossy(&out.stderr)
        );
    }
}

#[test]
fn skill_doc_exists_and_covers_the_nouns() {
    // The doc lives at the repo root, two levels up from apps/cli.
    let doc = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../skills/brain/SKILL.md");
    let text =
        std::fs::read_to_string(&doc).expect("SKILL.md should exist at skills/brain/SKILL.md");
    for noun in ["document", "interaction", "task", "memory", "person"] {
        assert!(
            text.contains(noun),
            "skill doc must explain the noun `{noun}`"
        );
    }
    assert!(
        text.contains("Query before you write"),
        "skill must teach query-before-write"
    );
    assert!(
        text.contains("stdout is data"),
        "skill must teach the stdout/stderr contract"
    );
    assert!(
        text.contains("brain --json contract") || text.contains("brain contract --json"),
        "skill must teach agents to discover the CLI contract"
    );
    assert!(
        text.contains("--ended-at")
            && text.contains("google_calendar")
            && text.contains("--self-participant"),
        "skill must teach structured calendar imports"
    );
    assert!(
        text.contains("Use `event`") && text.contains("travel, lodging"),
        "skill must teach event-vs-meeting calendar guidance"
    );
}
