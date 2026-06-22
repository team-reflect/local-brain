// Bump the app version everywhere it lives and prepare a stable release.
//
// The version is declared in three places that must stay in lockstep:
//   - apps/desktop/src-tauri/tauri.conf.json  (what release-macos.mjs reads)
//   - apps/desktop/src-tauri/Cargo.toml       (the crate that gets compiled)
//   - Cargo.lock                              (the local-brain-desktop entry)
//
// This is intentionally stable-only: Local Brain releases ship from master.
//
// Usage:
//   pnpm release:bump                    Patch bump: 0.1.0 -> 0.1.1
//   pnpm release:bump patch|minor|major
//   pnpm release:bump 0.5.0              Set an explicit stable version
//   pnpm release:bump --tag-only         Recovery: push the tag for an already-merged bump
//
// Flags:
//   --dry-run   Show the plan and exit; touch nothing
//   --direct    Push the bump commit directly to master and tag immediately
//   --no-tag    With --direct, bump + push master, but don't tag (no release)
//   --yes       Skip the confirmation prompt
//   --help

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..')
const repoRoot = join(here, '..', '..', '..')
const tauriConfPath = join(appDir, 'src-tauri', 'tauri.conf.json')
const cargoTomlPath = join(appDir, 'src-tauri', 'Cargo.toml')
const cargoLockPath = join(repoRoot, 'Cargo.lock')

/** The Cargo package whose version drives the release and lockfile entry. */
const CRATE = 'local-brain-desktop'
const RELEASE_BRANCH = 'master'
const LEVELS = ['patch', 'minor', 'major']

function log(message) {
  console.log(`release-bump: ${message}`)
}

function fail(message) {
  console.error(`release-bump: error: ${message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Version math - pure and exported so it can be unit-tested in isolation.
// ---------------------------------------------------------------------------

export function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/.exec(version)
  if (!match) throw new Error(`"${version}" is not a MAJOR.MINOR.PATCH[-prerelease] version`)
  const [, major, minor, patch, prerelease] = match
  return { major: Number(major), minor: Number(minor), patch: Number(patch), prerelease: prerelease ?? null }
}

export function formatVersion({ major, minor, patch, prerelease }) {
  const core = `${major}.${minor}.${patch}`
  return prerelease ? `${core}-${prerelease}` : core
}

export function computeNextVersion(current, bump) {
  if (!LEVELS.includes(bump)) {
    return formatVersion(parseVersion(bump))
  }
  const version = parseVersion(current)
  if (version.prerelease) {
    throw new Error(`${current} is a prerelease; pass an explicit stable version instead`)
  }
  switch (bump) {
    case 'patch':
      return formatVersion({ major: version.major, minor: version.minor, patch: version.patch + 1, prerelease: null })
    case 'minor':
      return formatVersion({ major: version.major, minor: version.minor + 1, patch: 0, prerelease: null })
    case 'major':
      return formatVersion({ major: version.major + 1, minor: 0, patch: 0, prerelease: null })
    default:
      throw new Error(`unhandled bump level "${bump}"`)
  }
}

// ---------------------------------------------------------------------------
// Git + filesystem side effects.
// ---------------------------------------------------------------------------

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}

function tryGit(args) {
  const result = spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, encoding: 'utf8' })
  return { status: result.status, output: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

function ensureGhReady() {
  if (run('gh', ['--version']).status !== 0) {
    fail('GitHub CLI not found - install it from https://cli.github.com and run `gh auth login`')
  }
  const auth = run('gh', ['auth', 'status'])
  if (auth.status !== 0) fail(`gh is not authenticated - run \`gh auth login\`\n${auth.output.trim()}`)
}

function currentBranch() {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch === 'HEAD') fail(`detached HEAD - check out ${RELEASE_BRANCH} first`)
  return branch
}

function readCurrentVersion() {
  return JSON.parse(readFileSync(tauriConfPath, 'utf8')).version
}

function replaceOnce(path, find, replace, label) {
  const content = readFileSync(path, 'utf8')
  const occurrences = content.split(find).length - 1
  if (occurrences !== 1) {
    fail(`expected exactly one \`${find}\` in ${label}, found ${occurrences} - update release-bump.mjs`)
  }
  writeFileSync(path, content.replace(find, replace))
}

function writeVersion(current, next) {
  replaceOnce(tauriConfPath, `"version": "${current}"`, `"version": "${next}"`, 'tauri.conf.json')
  replaceOnce(cargoTomlPath, `version = "${current}"`, `version = "${next}"`, 'Cargo.toml')
  const update = spawnSync('cargo', ['update', '-p', CRATE, '--offline'], { cwd: repoRoot, encoding: 'utf8' })
  if (update.status !== 0) {
    fail(`cargo update -p ${CRATE} failed (is cargo installed?):\n${update.stderr ?? ''}`)
  }
}

function releaseBranchName(tag) {
  return `release/${tag}`
}

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds)
}

async function confirm(question) {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await readline.question(question)).trim().toLowerCase()
  readline.close()
  return answer === 'y' || answer === 'yes'
}

async function pushTagOnly({ skipPrompt }) {
  const current = readCurrentVersion()
  if (current.includes('-')) fail(`refusing to tag prerelease version ${current}; Local Brain ships master releases only`)
  const tag = `v${current}`
  const branch = currentBranch()
  if (branch !== RELEASE_BRANCH) fail(`refusing to tag ${current} from "${branch}" - switch to ${RELEASE_BRANCH} first`)
  if (git(['status', '--porcelain']) !== '') {
    fail('the working tree has uncommitted changes - commit or stash them first')
  }

  log('fetching origin...')
  const fetch = tryGit(['fetch', 'origin', branch, '--tags'])
  if (fetch.status !== 0) fail(`git fetch failed:\n${fetch.output.trim()}`)
  if (tryGit(['rev-parse', '--verify', `origin/${branch}`]).status !== 0) {
    fail(`origin/${branch} does not exist - push ${branch} first`)
  }
  if (git(['rev-parse', 'HEAD']) !== git(['rev-parse', `origin/${branch}`])) {
    fail(`local ${branch} is not in sync with origin/${branch} - pull the merged release PR first`)
  }
  if (git(['tag', '--list', tag]) !== '') fail(`tag ${tag} already exists locally`)
  if (git(['ls-remote', '--tags', 'origin', tag]) !== '') fail(`tag ${tag} already exists on origin`)

  log(`version: ${current}`)
  log(`branch:  ${branch}  (in sync with origin)`)
  log('plan:')
  console.log(`  - tag ${tag} at ${branch}`)
  console.log(`  - push ${tag} to origin -> triggers the Release workflow`)

  if (!skipPrompt && !(await confirm('Proceed? [y/N] '))) {
    log('aborted - nothing changed')
    return
  }

  git(['tag', tag])
  log(`pushing tag ${tag}...`)
  if (spawnSync('git', ['push', 'origin', tag], { cwd: repoRoot, stdio: 'inherit' }).status !== 0) {
    fail(`pushing the tag failed - run \`git push origin ${tag}\` to retry`)
  }
  log(`done - ${tag} pushed; the Release workflow will build and publish the release.`)
  log('track it in GitHub -> Actions -> Release.')
}

function createReleasePr({ releaseBranch, baseBranch, tag, version }) {
  const body = [
    `Bumps Local Brain to ${version}.`,
    '',
    'The release bump script will merge this PR, pull the merged commit, and push the release tag.',
  ].join('\n')
  const create = run('gh', [
    'pr',
    'create',
    '--base',
    baseBranch,
    '--head',
    releaseBranch,
    '--title',
    `Release ${tag}`,
    '--body',
    body,
  ])
  if (create.status === 0) {
    const prUrl = create.output.trim()
    log(`opened release PR: ${prUrl}`)
    return prUrl
  }

  fail(`could not create the release PR:\n${create.output.trim()}`)
}

function mergeReleasePr({ prUrl, tag, version }) {
  const merge = run('gh', [
    'pr',
    'merge',
    prUrl,
    '--squash',
    '--delete-branch',
    '--admin',
    '--subject',
    `Release ${tag}`,
    '--body',
    `Bump Local Brain to ${version}.`,
  ])
  if (merge.status !== 0) fail(`could not merge the release PR:\n${merge.output.trim()}`)
  log(`merged release PR: ${prUrl}`)
}

function waitForMergedPr(prUrl) {
  for (let attempt = 1; attempt <= 60; attempt += 1) {
    const view = run('gh', ['pr', 'view', prUrl, '--json', 'state,mergeCommit'])
    if (view.status !== 0) fail(`could not inspect the release PR:\n${view.output.trim()}`)
    const pr = JSON.parse(view.output)
    if (pr.state === 'MERGED' && pr.mergeCommit?.oid) return pr.mergeCommit.oid
    if (pr.state === 'CLOSED') fail(`release PR closed without merging: ${prUrl}`)
    if (attempt === 1) log('waiting for GitHub to report the merged release PR...')
    sleep(5000)
  }
  fail(`timed out waiting for release PR to merge: ${prUrl}`)
}

function syncMergedReleaseBranch({ baseBranch, releaseBranch, mergeCommit }) {
  git(['fetch', 'origin', baseBranch, '--tags'])
  git(['switch', baseBranch])
  git(['pull', '--ff-only', 'origin', baseBranch])
  const head = git(['rev-parse', 'HEAD'])
  if (head !== mergeCommit) {
    fail(`local ${baseBranch} is at ${head.slice(0, 7)} but the release PR merged as ${mergeCommit.slice(0, 7)}`)
  }
  const deleteBranch = tryGit(['branch', '-D', releaseBranch])
  if (deleteBranch.status !== 0) log(`could not delete local ${releaseBranch}: ${deleteBranch.output.trim()}`)
}

async function main() {
  const argv = process.argv.slice(2)
  const flags = argv.filter((arg) => arg.startsWith('--'))
  const positionals = argv.filter((arg) => !arg.startsWith('--'))
  const knownFlags = ['--dry-run', '--direct', '--no-tag', '--tag-only', '--yes', '--help']
  const unknownFlag = flags.find((flag) => !knownFlags.includes(flag))
  if (unknownFlag) fail(`unknown flag "${unknownFlag}" - try --help`)
  if (positionals.length > 1) fail(`expected at most one level/version, got: ${positionals.join(' ')}`)
  if (flags.includes('--help')) {
    console.log(USAGE)
    return
  }

  const dryRun = flags.includes('--dry-run')
  const direct = flags.includes('--direct')
  const noTag = flags.includes('--no-tag')
  const tagOnly = flags.includes('--tag-only')
  const skipPrompt = flags.includes('--yes')
  if (tagOnly) {
    if (positionals.length > 0) fail('--tag-only does not take a level/version')
    if (dryRun) fail('--tag-only cannot be combined with --dry-run')
    if (direct) fail('--tag-only cannot be combined with --direct')
    if (noTag) fail('--tag-only cannot be combined with --no-tag')
    await pushTagOnly({ skipPrompt })
    return
  }
  if (noTag && !direct) {
    fail('--no-tag only applies with --direct; PR mode always tags after merging the release PR')
  }
  const bump = positionals[0] ?? 'patch'

  const current = readCurrentVersion()
  let next
  try {
    next = computeNextVersion(current, bump)
  } catch (error) {
    fail(error.message)
  }
  if (next === current) fail(`the new version equals the current one (${current}) - nothing to bump`)
  if (next.includes('-')) fail(`refusing to cut prerelease ${next}; Local Brain ships master releases only`)

  const branch = currentBranch()
  const tag = `v${next}`
  if (branch !== RELEASE_BRANCH) {
    fail(`refusing to cut release ${next} from "${branch}".\n  Stable releases ship from ${RELEASE_BRANCH}.`)
  }
  const releaseBranch = releaseBranchName(tag)

  if (git(['status', '--porcelain']) !== '') {
    fail('the working tree has uncommitted changes - commit or stash them first')
  }

  log('fetching origin...')
  const fetch = tryGit(['fetch', 'origin', branch, '--tags'])
  if (fetch.status !== 0) fail(`git fetch failed:\n${fetch.output.trim()}`)

  if (tryGit(['rev-parse', '--verify', `origin/${branch}`]).status !== 0) {
    fail(`origin/${branch} does not exist - push ${branch} first`)
  }
  if (git(['rev-parse', 'HEAD']) !== git(['rev-parse', `origin/${branch}`])) {
    fail(
      `local ${branch} is not in sync with origin/${branch}.\n` +
        '  Pull or push so the release builds exactly the published code plus the version bump.',
    )
  }

  if (git(['tag', '--list', tag]) !== '') fail(`tag ${tag} already exists locally - bump to a new version`)
  if (git(['ls-remote', '--tags', 'origin', tag]) !== '') {
    fail(`tag ${tag} already exists on origin - bump to a new version`)
  }
  if (!direct) {
    if (tryGit(['rev-parse', '--verify', `refs/heads/${releaseBranch}`]).status === 0) {
      fail(`local branch ${releaseBranch} already exists - delete it or choose another version`)
    }
    if (git(['ls-remote', '--heads', 'origin', releaseBranch]) !== '') {
      fail(`origin branch ${releaseBranch} already exists - delete it or choose another version`)
    }
  }

  if (!direct) ensureGhReady()
  log(`current version: ${current}`)
  log(`next version:    ${next}  (${bump})`)
  log(`branch:          ${branch}  (in sync with origin)`)
  log('plan:')
  if (!direct) console.log(`  - create ${releaseBranch} from ${branch}`)
  console.log('  - update tauri.conf.json, Cargo.toml, Cargo.lock')
  console.log(`  - commit "Release ${tag}"`)
  if (direct) {
    console.log(`  - push ${branch} to origin`)
  } else {
    console.log(`  - push ${releaseBranch} to origin`)
    console.log(`  - open a PR into ${branch}`)
    console.log('  - merge the PR immediately with admin bypass')
    console.log(`  - fast-forward ${branch} to the merged release commit`)
    console.log(`  - tag ${tag} and push it -> triggers the Release workflow`)
  }
  if (direct && noTag) {
    console.log('  - (skipping the tag - no release will be triggered)')
  } else if (direct) {
    console.log(`  - tag ${tag} and push it -> triggers the Release workflow`)
  } else {
    console.log('  - clean up the local release branch')
  }

  if (dryRun) {
    log('dry run - nothing changed')
    return
  }
  if (!skipPrompt && !(await confirm('Proceed? [y/N] '))) {
    log('aborted - nothing changed')
    return
  }

  if (!direct) git(['switch', '-c', releaseBranch])
  writeVersion(current, next)
  git(['add', tauriConfPath, cargoTomlPath, cargoLockPath])
  git(['commit', '-m', `Release ${tag}`])

  if (!direct) {
    log(`pushing ${releaseBranch} to origin...`)
    if (spawnSync('git', ['push', '-u', 'origin', releaseBranch], { cwd: repoRoot, stdio: 'inherit' }).status !== 0) {
      fail('pushing the release branch failed - resolve the issue and retry (nothing was tagged)')
    }
    const prUrl = createReleasePr({ releaseBranch, baseBranch: branch, tag, version: next })
    mergeReleasePr({ prUrl, tag, version: next })
    const mergeCommit = waitForMergedPr(prUrl)
    syncMergedReleaseBranch({ baseBranch: branch, releaseBranch, mergeCommit })
    await pushTagOnly({ skipPrompt: true })
    return
  }

  log(`pushing ${branch} to origin...`)
  if (spawnSync('git', ['push', 'origin', `HEAD:${branch}`], { cwd: repoRoot, stdio: 'inherit' }).status !== 0) {
    fail('pushing the branch failed - resolve the issue and retry (nothing was tagged)')
  }

  if (noTag) {
    log(`bumped to ${next} and pushed ${branch} (no tag).`)
    log(`to release later: git tag ${tag} && git push origin ${tag}`)
    return
  }

  git(['tag', tag])
  log(`pushing tag ${tag}...`)
  if (spawnSync('git', ['push', 'origin', tag], { cwd: repoRoot, stdio: 'inherit' }).status !== 0) {
    fail(`pushing the tag failed - the branch is pushed; run \`git push origin ${tag}\` to trigger the release`)
  }
  log(`done - ${tag} pushed; the Release workflow will build and publish the release.`)
  log('track it in GitHub -> Actions -> Release.')
}

const USAGE = `Usage: pnpm release:bump [level|version] [flags]

Levels:
  patch      (default) stable patch bump: 0.1.0 -> 0.1.1
  minor      stable minor bump:           0.1.0 -> 0.2.0
  major      stable major bump:           0.1.0 -> 1.0.0
  <version>  set an explicit stable version, e.g. 0.5.0

Flags:
  --dry-run   show the plan and exit; change nothing
  --tag-only  recovery: push the tag for an already-merged release bump
  --direct    push the bump commit directly to master and tag immediately
  --no-tag    with --direct, bump + push the branch, but don't tag (no release)
  --yes       skip the confirmation prompt
  --help      show this help

Stable releases ship from ${RELEASE_BRANCH}.
Docs: docs/macos-distribution.md`

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
