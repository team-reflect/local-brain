# Remaining Mega PR — Plan

## Objective

Compose one mega PR against `master` that merges the remaining Local Brain work,
preserving Plan 06–09 functionality and applying the Reflect design system last.

This is a **merge/composition** branch, not a redesign rewrite.

## Base

- Branch: `codex/local-brain-remaining-mega-pr`
- Base: `origin/master` @ `9b828abcae93e16dd23c5d4a8d4fe76694cca53a`
- PR #13 (mega through Plan 05a) and PR #14 (Plan 05b) already merged into master.

## Merge order (exact)

1. PR #15 — `origin/codex/local-brain-06-search-ai` @ `00b2313a5404d01307cf96ca404f4cfbfdcf2542`
2. PR #16 — `origin/codex/local-brain-07-cli-skills` @ `e088a3ba9d51fd154897f0b62eb48e535d541a33`
3. PR #17 — `origin/codex/local-brain-08-settings-backup-privacy` @ `c31268aed953476b04f13b3898a0c6680b119dce`
4. PR #19 — `origin/codex/local-brain-09-packaging-launch` @ `be9bc4af46466afad46643832952ca697741d082`
5. PR #18 — `origin/codex/local-brain-reflect-design-system` @ `735271ef502b8132cfcc33d3188c8a06ad2c71bb`

**Plan PRs first, in order, then the redesign on top. Do not reverse.**

## SHA verification

All five remote SHAs fetched and verified equal to the values above (2026-06-17).

## Branch topology (observed)

- Plan PRs are **stacked linearly**: 06 ⊂ 07 ⊂ 08 ⊂ 09 (each is an ancestor of the next).
- `reflect-design-system` is **independent** — branched from the same base
  (`bf4ebea`, the Plan 05b tip) with a single commit; it is NOT stacked on the plan PRs.
- Common merge-base of all branches with master: `bf4ebea3f681066dbcb305a0de55f719d5c3bb22`.

## Strategy

- Merge each plan PR sequentially with `--no-ff` real merge commits so the PR shows
  the merge sequence clearly. Because the plan PRs are stacked, merges 2–4 mostly
  carry one new commit each.
- Merge `reflect-design-system` last with `--no-ff`.
- Conflict policy for the redesign merge: **keep Plan 06–09 functionality; apply the
  Reflect visual system around it.** Focus areas: Ask, Settings, first-run, command
  palette, backup/export/model settings, CLI/sidecar docs, launch docs.

## Verification (final branch)

- `pnpm check`
- `pnpm --filter @local-brain/desktop build`
- `cargo fmt --all -- --check`
- `cargo check --workspace`
- `cargo test --workspace`
- `git diff --check`
- `pnpm tauri build` only if feasible (note headless DMG/Finder caveat otherwise).

## Exclusions

- The product-docs branch `codex/local-brain-product-docs` is **NOT** included.
