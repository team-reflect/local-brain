# Audit status & decisions

Running log of the triage decisions. See `audit.md` for the full finding table
and `final-report.md` for the verification summary.

## Process

1. `git fetch origin --prune` — branch confirmed based on current `origin/master`
   (`3137d12`); no rebase needed.
2. Enumerated all PRs: 22 total, all closed (merged or closed-unmerged), 0 open.
3. Pulled issue comments, review comments, and reviews for #1–#22.
4. Comments concentrate in #15–#21 (all Cursor Bugbot); #2/#3 carry only author
   verification notes; #1, #4–#14, and #22 have none.
5. Each finding verified by reading the file **on current `master`** and comparing
   against the core/app reference implementation, then fixed if real.

## Decisions

- **install-model precedence (#17/#21, 3 comments):** the doc comment states the
  env var is an intentional "no-persist escape hatch [that] takes precedence", so
  env-first is the *intended* design. The real defect was the **inconsistency**
  between `installModel` (env-first) and `refreshModelProvider` (keychain-first),
  plus the `catch` dropping the env key. Fixed by sharing one `resolveProviderKey`.
  "Clear key still uses dev env" is then expected, documented behaviour.
- **Keychain error handling (#17):** verified `security` exits **44**
  (`errSecItemNotFound`) for a missing item on this machine, so 44 → `None`/`Ok`
  and any other non-zero status → `Err`.
- **CLI search (#16 High + #16 Med + #21 Low):** the High `%%`-matches-everything
  bug, the per-source limit, and the metacharacter stripping are all in
  `read.rs::search`; fixed together by mirroring core `globalSearch` (token gate,
  escaped `LIKE … ESCAPE '\'`, merged ranked cap).
- **Palette tokens (#21):** declined. `globalSearch`'s token requirement is the
  deliberate, documented behaviour and is precisely what prevents the #4 bug;
  reverting to substring `LIKE` would reintroduce it.
- **Source-label mismatch (#15 Low):** real but deferred — a correct fix needs the
  citation marker persisted (schema change) and a deterministic read order;
  disproportionate to a Low cosmetic issue. Citations still open the right record.
- **Stray XML tags (#20):** not applicable — `docs/current-state.md` never reached
  `master`; no such file or stray tags exist in the tree.

## Outcome

- 22 closed PRs audited.
- 28 comment/review items collected (2 author issue comments, 19 substantive
  Bugbot review comments, 7 Bugbot review summaries).
- 16 distinct technical findings; **13 fixed**, 1 deferred (real/minor), 1 not
  applicable, 1 by design.
- 11 source files changed + 1 new file (`modal-guard.ts`); 1 new Rust test.
