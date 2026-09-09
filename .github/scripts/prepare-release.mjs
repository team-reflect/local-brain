import {
  RELEASE_VERSION_FILE_PATHS,
  compareSemver,
  computeNextVersion,
  parseVersion,
  readReleaseVersionFiles,
} from '../../apps/desktop/scripts/release-bump.mjs'

const VERSION_FILE_PATHS = RELEASE_VERSION_FILE_PATHS
const RELEASE_SOURCE = 'Local-Brain-Release-Source: '

function replaceExactlyOnce(content, find, replacement, label) {
  const occurrences = content.split(find).length - 1
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one ${label}, found ${occurrences}`)
  }
  return content.replace(find, replacement)
}

/** Read the synchronized desktop version from all three release declarations. */
export function readVersionFiles(files) {
  return readReleaseVersionFiles(files)
}

/** Change only the desktop version, preserving every other byte in the files. */
export function updateVersionFiles(files, targetVersion) {
  const currentVersion = readVersionFiles(files)
  parseVersion(targetVersion)
  const updated = { ...files }

  const tauriLines = files[VERSION_FILE_PATHS[0]].split('\n')
  const tauriVersionLineIndexes = tauriLines.flatMap((line, index) =>
    /^  "version": "[^"]+",?\s*$/.test(line) ? [index] : [],
  )
  if (tauriVersionLineIndexes.length !== 1) {
    throw new Error(
      `Expected one top-level version in tauri.conf.json, found ${tauriVersionLineIndexes.length}`,
    )
  }
  const tauriVersionLineIndex = tauriVersionLineIndexes[0]
  tauriLines[tauriVersionLineIndex] = tauriLines[tauriVersionLineIndex].replace(
    `"${currentVersion}"`,
    `"${targetVersion}"`,
  )
  updated[VERSION_FILE_PATHS[0]] = tauriLines.join('\n')

  const cargoPackageVersion = `version = "${currentVersion}"`
  const cargoPackageTarget = `version = "${targetVersion}"`
  const packageSection = /^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(
    files[VERSION_FILE_PATHS[1]],
  )
  const updatedPackageSection = replaceExactlyOnce(
    packageSection[0],
    cargoPackageVersion,
    cargoPackageTarget,
    'package version in Cargo.toml',
  )
  updated[VERSION_FILE_PATHS[1]] = files[VERSION_FILE_PATHS[1]].replace(
    packageSection[0],
    updatedPackageSection,
  )

  const lockBlocks = files[VERSION_FILE_PATHS[2]].split('[[package]]')
  const lockBlockIndexes = lockBlocks.flatMap((block, index) =>
    /^name = "local-brain-desktop"$/m.test(block) ? [index] : [],
  )
  if (lockBlockIndexes.length !== 1) {
    throw new Error(
      `Expected one local-brain-desktop package in Cargo.lock, found ${lockBlockIndexes.length}`,
    )
  }
  const lockIndex = lockBlockIndexes[0]
  lockBlocks[lockIndex] = replaceExactlyOnce(
    lockBlocks[lockIndex],
    `version = "${currentVersion}"`,
    `version = "${targetVersion}"`,
    'local-brain-desktop version in Cargo.lock',
  )
  updated[VERSION_FILE_PATHS[2]] = lockBlocks.join('[[package]]')

  readVersionFiles(updated)
  return updated
}

async function getFileContent({ github, owner, repo, path, ref }) {
  const response = await github.rest.repos.getContent({ owner, repo, path, ref })
  if (Array.isArray(response.data) || response.data.type !== 'file') {
    throw new Error(`${path} at ${ref} is not a file`)
  }
  return Buffer.from(response.data.content, response.data.encoding ?? 'base64').toString('utf8')
}

async function readReleaseStateAtRef({ github, owner, repo, ref }) {
  const entries = await Promise.all(
    VERSION_FILE_PATHS.map(async (path) => [path, await getFileContent({ github, owner, repo, path, ref })]),
  )
  const files = Object.fromEntries(entries)
  return { files, version: readVersionFiles(files) }
}

async function getTagCommitShaOrNull({ github, owner, repo, tag }) {
  let object
  try {
    const response = await github.rest.git.getRef({ owner, repo, ref: `tags/${tag}` })
    object = response.data.object
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }

  const seen = new Set()
  while (object.type === 'tag') {
    if (seen.has(object.sha)) throw new Error(`${tag} contains an annotated tag cycle`)
    seen.add(object.sha)
    const response = await github.rest.git.getTag({ owner, repo, tag_sha: object.sha })
    object = response.data.object
  }
  if (object.type !== 'commit') {
    throw new Error(`${tag} points to a ${object.type}, not a commit`)
  }
  return object.sha
}

async function getReleaseStatus({ github, owner, repo, version, expectedCommitSha }) {
  const tag = `v${version}`
  let releaseStatus = null
  try {
    const response = await github.rest.repos.getReleaseByTag({ owner, repo, tag })
    releaseStatus = response.data.draft ? 'draft' : 'published'
  } catch (error) {
    if (error.status !== 404) throw error
  }

  const tagCommitSha = await getTagCommitShaOrNull({ github, owner, repo, tag })
  if (expectedCommitSha && tagCommitSha && tagCommitSha !== expectedCommitSha) {
    throw new Error(`${tag} points to ${tagCommitSha}, not the release commit ${expectedCommitSha}`)
  }
  if (expectedCommitSha && releaseStatus === 'published' && !tagCommitSha) {
    throw new Error(`${tag} has a published release but no corresponding Git tag`)
  }

  return releaseStatus ?? (tagCommitSha ? 'tag-only' : 'missing')
}

function isMasterCiRun(run, repository) {
  return (
    ['push', 'workflow_dispatch'].includes(run.event) &&
    run.head_branch === 'master' &&
    run.head_repository?.full_name === repository &&
    run.path === '.github/workflows/ci.yml'
  )
}

function releaseSource(commit) {
  return commit.commit.message.split('\n').find((line) => line.startsWith(RELEASE_SOURCE))?.slice(RELEASE_SOURCE.length)
}

async function hasSuccessfulCi({ github, owner, repo, sha }) {
  const response = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: 'ci.yml',
    branch: 'master',
    head_sha: sha,
    per_page: 100,
  })
  // A failed or still-running rerun supersedes an older success on the same SHA.
  const latest = response.data.workflow_runs.find(
    (run) => run.head_sha === sha && isMasterCiRun(run, `${owner}/${repo}`),
  )
  return latest?.status === 'completed' && latest.conclusion === 'success'
}

async function requireSourceCi({ github, context, core, sha }) {
  if (await hasSuccessfulCi({ github, ...context.repo, sha })) return true
  const message = `Waiting for successful master CI on ${sha}`
  // Do not silently discard a manually requested version while CI is pending.
  if (context.eventName === 'workflow_dispatch') {
    throw new Error(`${message}; rerun the release request after CI passes`)
  }
  core.warning(message)
  return false
}

async function testedSource({ github, owner, repo, commit, state }) {
  let source = releaseSource(commit)
  while (source) {
    if (commit.parents.length !== 1 || commit.parents[0].sha !== source) {
      throw new Error('Release source must be the version commit\'s sole parent')
    }
    const previous = await readReleaseStateAtRef({ github, owner, repo, ref: source })
    if (compareSemver(state.version, previous.version) <= 0) {
      throw new Error('Release commit must advance the desktop version')
    }
    const expected = updateVersionFiles(previous.files, state.version)
    const paths = (commit.files ?? []).map((file) => file.filename).sort()
    if (
      JSON.stringify(paths) !== JSON.stringify([...VERSION_FILE_PATHS].sort()) ||
      !VERSION_FILE_PATHS.every((path) => state.files[path] === expected[path])
    ) {
      throw new Error('Release commit must contain only the three exact version edits')
    }
    commit = (await github.rest.repos.getCommit({ owner, repo, ref: source })).data
    state = previous
    source = releaseSource(commit)
  }
  return commit.sha
}

async function newerStablePublished({ github, owner, repo, version }) {
  if (version.includes('-')) return false
  try {
    const response = await github.rest.repos.getLatestRelease({ owner, repo })
    return compareSemver(response.data.tag_name.replace(/^v/, ''), version) > 0
  } catch (error) {
    if (error.status === 404) return false
    throw error
  }
}

/**
 * Reconcile current master after CI, fast-forwarding a version-only commit and
 * returning its immutable SHA to the signed publisher. Old notifications inspect
 * current master too, so GitHub's replacement of pending runs cannot lose a merge.
 * This function never reads or executes code from a PR head or CI artifact.
 */
export async function prepareRelease({ github, context, core, bump }) {
  const { owner, repo } = context.repo
  if (context.eventName === 'workflow_run') {
    const run = (await github.rest.actions.getWorkflowRun({
      owner, repo, run_id: context.payload.workflow_run.id,
    })).data
    if (!isMasterCiRun(run, `${owner}/${repo}`) || run.status !== 'completed' || run.conclusion !== 'success') {
      return { releaseNeeded: false }
    }
  } else if (context.eventName !== 'workflow_dispatch' || context.ref !== 'refs/heads/master') {
    throw new Error('Automatic releases must run from master CI or a manual master dispatch')
  }

  const master = (await github.rest.git.getRef({ owner, repo, ref: 'heads/master' })).data.object.sha
  const commit = (await github.rest.repos.getCommit({ owner, repo, ref: master })).data
  const state = await readReleaseStateAtRef({ github, owner, repo, ref: master })
  const source = await testedSource({ github, owner, repo, commit, state })
  const prepared = Boolean(releaseSource(commit))
  let version = state.version

  if (prepared) {
    const status = await getReleaseStatus({ github, owner, repo, version, expectedCommitSha: master })
    if (status === 'draft') {
      throw new Error(`v${version} already has a draft; finish or delete it before retrying`)
    }
    if (status === 'published' && !bump) return { releaseNeeded: false }
    if (status !== 'published') {
      if (bump && computeNextVersion(version, bump) !== version) {
        throw new Error(`Publish pending v${version} before requesting another version`)
      }
      if (await newerStablePublished({ github, owner, repo, version })) {
        core.warning(`Skipping v${version}: a newer stable release is already published`)
        return { releaseNeeded: false }
      }
      if (!(await requireSourceCi({ github, context, core, sha: source }))) {
        return { releaseNeeded: false }
      }
      return { releaseNeeded: true, releaseRef: master, version }
    }
  }

  if (!(await requireSourceCi({ github, context, core, sha: source }))) {
    return { releaseNeeded: false }
  }
  version = computeNextVersion(version, bump ?? (version.includes('-') ? 'beta' : 'patch'))
  if (compareSemver(version, state.version) <= 0) {
    throw new Error(`Release target ${version} must be newer than ${state.version}`)
  }
  if (await newerStablePublished({ github, owner, repo, version })) {
    throw new Error(`Choose a version newer than the latest published stable release`)
  }
  if ((await getReleaseStatus({ github, owner, repo, version })) !== 'missing') {
    throw new Error(`v${version} already has a tag or release; choose a newer version`)
  }

  const files = updateVersionFiles(state.files, version)
  const tree = await github.rest.git.createTree({
    owner,
    repo,
    base_tree: commit.commit.tree.sha,
    tree: VERSION_FILE_PATHS.map((path) => ({ path, mode: '100644', type: 'blob', content: files[path] })),
  })
  const releaseCommit = await github.rest.git.createCommit({
    owner,
    repo,
    message: `Release v${version}\n\n${RELEASE_SOURCE}${master}`,
    tree: tree.data.sha,
    parents: [master],
  })
  // force:false rejects a merge that races this version bump. The new master's
  // CI completion will reconcile again; never overwrite it or build untested code.
  await github.rest.git.updateRef({
    owner, repo, ref: 'heads/master', sha: releaseCommit.data.sha, force: false,
  })
  core.notice(`Prepared v${version} at ${releaseCommit.data.sha}, from tested source ${source}`)
  return { releaseNeeded: true, releaseRef: releaseCommit.data.sha, version }
}
