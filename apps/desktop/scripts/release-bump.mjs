// Request a version for the rolling release PR, or recover an already-merged
// version bump by pushing its tag. The Release PR workflow owns normal version
// edits so local release commands cannot race a second short-lived PR.
//
// Usage:
//   pnpm release:bump                         Request the next stable patch
//   pnpm release:bump patch|minor|major      Request a stable bump
//   pnpm release:bump beta|stable            Advance or finish a beta
//   pnpm release:bump prepatch|preminor|premajor
//   pnpm release:bump 0.5.0-beta.1           Request an explicit version
//   pnpm release:bump --tag-only             Recovery: tag the current merged version
//
// Flags:
//   --dry-run   Show the request and exit
//   --tag-only  Push the tag for an already-merged version bump
//   --yes       Skip the confirmation prompt
//   --help

import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const appDir = join(here, '..')
const repoRoot = join(here, '..', '..', '..')
const tauriConfPath = join(appDir, 'src-tauri', 'tauri.conf.json')
const tauriConfRelativePath = 'apps/desktop/src-tauri/tauri.conf.json'
const versionFilePaths = [tauriConfRelativePath, 'apps/desktop/src-tauri/Cargo.toml', 'Cargo.lock']

const PREID = 'beta'
const RELEASE_BRANCH = 'master'
const RELEASE_PR_WORKFLOW = 'release-pr.yml'
const LEVELS = ['beta', 'stable', 'patch', 'minor', 'major', 'prepatch', 'preminor', 'premajor']

function log(message) {
  console.log(`release-bump: ${message}`)
}

function fail(message) {
  console.error(`release-bump: error: ${message}`)
  process.exit(1)
}

export function parseVersion(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(
    version,
  )
  if (!match) throw new Error(`"${version}" is not a valid MAJOR.MINOR.PATCH[-prerelease] version`)
  const [, major, minor, patch, prerelease] = match
  const core = [major, minor, patch].map(Number)
  if (core.some((part) => !Number.isSafeInteger(part))) {
    throw new Error(`"${version}" contains a numeric component larger than JavaScript can safely represent`)
  }
  for (const identifier of prerelease?.split('.') ?? []) {
    if (/^\d+$/.test(identifier)) {
      if (identifier.length > 1 && identifier.startsWith('0')) {
        throw new Error(`"${version}" contains a prerelease number with a leading zero`)
      }
      if (!Number.isSafeInteger(Number(identifier))) {
        throw new Error(`"${version}" contains a prerelease number larger than JavaScript can safely represent`)
      }
    }
  }
  return { major: core[0], minor: core[1], patch: core[2], prerelease: prerelease ?? null }
}

export function formatVersion({ major, minor, patch, prerelease }) {
  const core = `${major}.${minor}.${patch}`
  const version = prerelease ? `${core}-${prerelease}` : core
  parseVersion(version)
  return version
}

function prereleaseNumber(prerelease) {
  const match = new RegExp(`^${PREID}\\.(\\d+)$`).exec(prerelease)
  if (!match) throw new Error(`prerelease "${prerelease}" is not "${PREID}.N" - pass an explicit version instead`)
  return Number(match[1])
}

export function computeNextVersion(current, bump) {
  if (!LEVELS.includes(bump)) return formatVersion(parseVersion(bump))

  const version = parseVersion(current)
  switch (bump) {
    case 'beta':
      if (!version.prerelease) {
        throw new Error(`${current} is already stable - use prepatch/preminor/premajor to open a new beta cycle`)
      }
      return formatVersion({ ...version, prerelease: `${PREID}.${prereleaseNumber(version.prerelease) + 1}` })
    case 'stable':
      if (!version.prerelease) throw new Error(`${current} is already stable`)
      return formatVersion({ ...version, prerelease: null })
    case 'patch':
      return formatVersion({ major: version.major, minor: version.minor, patch: version.patch + 1, prerelease: null })
    case 'minor':
      return formatVersion({ major: version.major, minor: version.minor + 1, patch: 0, prerelease: null })
    case 'major':
      return formatVersion({ major: version.major + 1, minor: 0, patch: 0, prerelease: null })
    case 'prepatch':
      return formatVersion({ major: version.major, minor: version.minor, patch: version.patch + 1, prerelease: `${PREID}.1` })
    case 'preminor':
      return formatVersion({ major: version.major, minor: version.minor + 1, patch: 0, prerelease: `${PREID}.1` })
    case 'premajor':
      return formatVersion({ major: version.major + 1, minor: 0, patch: 0, prerelease: `${PREID}.1` })
    default:
      throw new Error(`unhandled bump level "${bump}"`)
  }
}

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

async function confirm(question) {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  const answer = (await readline.question(question)).trim().toLowerCase()
  readline.close()
  return answer === 'y' || answer === 'yes'
}

function assertSynchronizedMaster() {
  const branch = currentBranch()
  if (branch !== RELEASE_BRANCH) {
    fail(`release requests come from ${RELEASE_BRANCH} - switch there and run this again`)
  }
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
    fail(`local ${branch} is not in sync with origin/${branch} - pull the latest changes first`)
  }
}

export function selectReleaseCommit({
  version,
  candidates,
  versionAtCommit,
  versionAtParent,
  changedPathsAtCommit,
  isAncestor,
}) {
  const expectedPaths = [...versionFilePaths].sort()
  for (const commit of candidates) {
    if (!isAncestor(commit) || versionAtCommit(commit) !== version) continue
    const previousVersion = versionAtParent(commit)
    if (!previousVersion || previousVersion === version) continue
    const changedPaths = [...changedPathsAtCommit(commit)].sort()
    if (JSON.stringify(changedPaths) === JSON.stringify(expectedPaths)) return commit
  }
  throw new Error(`could not find the exact three-file commit that introduced version ${version}`)
}

function findReleaseCommit(version) {
  const candidates = git(['log', '--first-parent', '--format=%H', `origin/${RELEASE_BRANCH}`])
    .split('\n')
    .filter(Boolean)
  const versionAtRef = (ref) => {
    const result = tryGit(['show', `${ref}:${tauriConfRelativePath}`])
    if (result.status !== 0) return null
    try {
      return JSON.parse(result.output).version
    } catch {
      return null
    }
  }

  return selectReleaseCommit({
    version,
    candidates,
    versionAtCommit: versionAtRef,
    versionAtParent: (commit) => versionAtRef(`${commit}^`),
    changedPathsAtCommit: (commit) =>
      git(['diff', '--name-only', `${commit}^`, commit])
        .split('\n')
        .filter(Boolean),
    isAncestor: (commit) =>
      tryGit(['merge-base', '--is-ancestor', commit, `origin/${RELEASE_BRANCH}`]).status === 0,
  })
}

async function pushTagOnly({ skipPrompt }) {
  assertSynchronizedMaster()
  const version = readCurrentVersion()
  const tag = `v${version}`
  if (git(['tag', '--list', tag]) !== '') fail(`tag ${tag} already exists locally`)
  if (git(['ls-remote', '--tags', 'origin', tag]) !== '') fail(`tag ${tag} already exists on origin`)

  let releaseCommit
  try {
    releaseCommit = findReleaseCommit(version)
  } catch (error) {
    fail(error.message)
  }

  log(`version: ${version}`)
  log(`release commit: ${releaseCommit}`)
  log(`plan: tag that exact reviewed version transition as ${tag} and trigger the Release workflow`)
  if (!skipPrompt && !(await confirm('Proceed? [y/N] '))) {
    log('aborted - nothing changed')
    return
  }

  git(['tag', tag, releaseCommit])
  if (spawnSync('git', ['push', 'origin', tag], { cwd: repoRoot, stdio: 'inherit' }).status !== 0) {
    fail(`pushing ${tag} failed - run \`git push origin ${tag}\` to retry`)
  }
  log(`done - ${tag} pushed; the Release workflow will build and publish it`)
}

export function workflowDispatchArgs(targetVersion) {
  return ['workflow', 'run', RELEASE_PR_WORKFLOW, '--ref', RELEASE_BRANCH, '-f', `bump=${targetVersion}`]
}

async function main() {
  const argv = process.argv.slice(2)
  const flags = argv.filter((argument) => argument.startsWith('--'))
  const positionals = argv.filter((argument) => !argument.startsWith('--'))
  const knownFlags = ['--dry-run', '--tag-only', '--yes', '--help', '--direct', '--no-tag']
  const unknownFlag = flags.find((flag) => !knownFlags.includes(flag))
  if (unknownFlag) fail(`unknown flag "${unknownFlag}" - try --help`)
  if (positionals.length > 1) fail(`expected at most one level/version, got: ${positionals.join(' ')}`)
  if (flags.includes('--help')) {
    console.log(USAGE)
    return
  }
  if (flags.includes('--direct') || flags.includes('--no-tag')) {
    fail(
      '--direct and --no-tag were retired by the rolling Release PR; use the reviewed PR, or run Release with an exact ref for recovery',
    )
  }

  const dryRun = flags.includes('--dry-run')
  const tagOnly = flags.includes('--tag-only')
  const skipPrompt = flags.includes('--yes')
  if (tagOnly) {
    if (positionals.length > 0) fail('--tag-only does not take a level/version')
    if (dryRun) fail('--tag-only cannot be combined with --dry-run')
    await pushTagOnly({ skipPrompt })
    return
  }

  assertSynchronizedMaster()
  const current = readCurrentVersion()
  const bump = positionals[0] ?? (current.includes('-') ? 'beta' : 'patch')
  let target
  try {
    target = computeNextVersion(current, bump)
  } catch (error) {
    fail(error.message)
  }
  if (target === current) fail(`the requested version equals the current one (${current})`)
  if (git(['ls-remote', '--tags', 'origin', `v${target}`]) !== '') {
    fail(`tag v${target} already exists on origin - choose a newer version`)
  }

  log(`current version: ${current}`)
  log(`requested version: ${target} (${bump})`)
  log('plan: dispatch the Release PR workflow to create or update the reviewed rolling PR')
  if (dryRun) {
    log('dry run - nothing changed')
    return
  }
  ensureGhReady()
  if (!skipPrompt && !(await confirm('Proceed? [y/N] '))) {
    log('aborted - nothing changed')
    return
  }

  const dispatch = run('gh', workflowDispatchArgs(target))
  if (dispatch.status !== 0) fail(`could not dispatch the Release PR workflow:\n${dispatch.output.trim()}`)
  log('release PR request queued - track it in GitHub -> Actions -> Release PR')
}

const USAGE = `Usage: pnpm release:bump [level|version] [flags]

Levels:
  patch      stable patch bump (default for a stable release)
  beta       next beta.N (default while on a beta)
  stable     remove the beta suffix
  minor      stable minor bump
  major      stable major bump
  prepatch   open a patch beta cycle
  preminor   open a minor beta cycle
  premajor   open a major beta cycle
  <version>  explicit version, for example 0.5.0-beta.1

Flags:
  --dry-run   show the release PR request without dispatching it
  --tag-only  recovery: tag the current merged version and trigger Release
  --yes       skip the confirmation prompt
  --help      show this help

Normal releases are reviewed in the rolling Release PR and ship when it is merged.
Docs: docs/macos-distribution.md`

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
