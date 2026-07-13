import { computeNextVersion, parseVersion } from '../../apps/desktop/scripts/release-bump.mjs'

const RELEASE_BASE = 'master'
const RELEASE_HEAD = 'automation/release'
const RELEASE_CI_WORKFLOW = 'ci.yml'
const DESKTOP_CRATE = 'local-brain-desktop'

export const MANAGED_SECTION_START = '<!-- local-brain-release-pr:start -->'
export const MANAGED_SECTION_END = '<!-- local-brain-release-pr:end -->'

export const VERSION_FILE_PATHS = [
  'apps/desktop/src-tauri/tauri.conf.json',
  'apps/desktop/src-tauri/Cargo.toml',
  'Cargo.lock',
]

const CHANGELOG_CATEGORIES = ['Breaking changes', 'Features', 'Fixes', 'Other changes']

function getLabelNames(pullRequest) {
  return new Set(
    pullRequest.labels
      .map((label) => (typeof label === 'string' ? label : label.name))
      .filter((name) => typeof name === 'string')
      .map((name) => name.toLowerCase()),
  )
}

export function classifyPullRequest(pullRequest) {
  const labels = getLabelNames(pullRequest)
  const title = pullRequest.title.trim()

  if (labels.has('skip-changelog')) return null

  if (
    labels.has('breaking-change') ||
    labels.has('breaking change') ||
    /^[a-z]+(?:\([^)]*\))?!:/i.test(title)
  ) {
    return 'Breaking changes'
  }

  if (
    labels.has('bug') ||
    /^(?:fix|bugfix)(?:\([^)]*\))?!?:/i.test(title) ||
    /^(?:fix|fixed|repair|resolve)\b/i.test(title)
  ) {
    return 'Fixes'
  }

  if (
    labels.has('enhancement') ||
    /^(?:feat|feature)(?:\([^)]*\))?!?:/i.test(title) ||
    /^(?:add|introduce|enable|support)\b/i.test(title)
  ) {
    return 'Features'
  }

  return 'Other changes'
}

function escapeMarkdownText(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('\\', '\\\\')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]')
}

function getCommitTitle(message) {
  const lines = message
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (/^Merge pull request #\d+/i.test(lines[0] ?? '') && lines[1]) return lines[1]
  return lines[0] ?? 'Direct commit'
}

function replaceExactlyOnce(content, find, replacement, label) {
  const occurrences = content.split(find).length - 1
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one ${label}, found ${occurrences}`)
  }
  return content.replace(find, replacement)
}

function readCargoPackageVersion(content) {
  const packageSection = /^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(content)?.[1]
  if (!packageSection) throw new Error('Cargo.toml is missing its [package] section')
  const versions = [...packageSection.matchAll(/^version\s*=\s*"([^"]+)"\s*$/gm)]
  if (versions.length !== 1) {
    throw new Error(`Expected one package version in Cargo.toml, found ${versions.length}`)
  }
  return versions[0][1]
}

function readCargoLockVersion(content) {
  const packageBlocks = content
    .split('[[package]]')
    .slice(1)
    .filter((block) => new RegExp(`^name = "${DESKTOP_CRATE}"$`, 'm').test(block))
  if (packageBlocks.length !== 1) {
    throw new Error(`Expected one ${DESKTOP_CRATE} package in Cargo.lock, found ${packageBlocks.length}`)
  }
  const versions = [...packageBlocks[0].matchAll(/^version = "([^"]+)"$/gm)]
  if (versions.length !== 1) {
    throw new Error(`Expected one ${DESKTOP_CRATE} version in Cargo.lock, found ${versions.length}`)
  }
  return versions[0][1]
}

export function readVersionFiles(files) {
  const tauriPath = VERSION_FILE_PATHS[0]
  const cargoTomlPath = VERSION_FILE_PATHS[1]
  const cargoLockPath = VERSION_FILE_PATHS[2]
  const tauriVersion = JSON.parse(files[tauriPath]).version
  const cargoVersion = readCargoPackageVersion(files[cargoTomlPath])
  const lockVersion = readCargoLockVersion(files[cargoLockPath])

  if (typeof tauriVersion !== 'string') {
    throw new Error('tauri.conf.json is missing its string version')
  }
  parseVersion(tauriVersion)

  const versions = new Set([tauriVersion, cargoVersion, lockVersion])
  if (versions.size !== 1) {
    throw new Error(
      `Release versions are out of sync: tauri.conf.json=${tauriVersion}, Cargo.toml=${cargoVersion}, Cargo.lock=${lockVersion}`,
    )
  }

  return tauriVersion
}

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
    new RegExp(`^name = "${DESKTOP_CRATE}"$`, 'm').test(block) ? [index] : [],
  )
  if (lockBlockIndexes.length !== 1) {
    throw new Error(`Expected one ${DESKTOP_CRATE} package in Cargo.lock, found ${lockBlockIndexes.length}`)
  }
  const lockIndex = lockBlockIndexes[0]
  lockBlocks[lockIndex] = replaceExactlyOnce(
    lockBlocks[lockIndex],
    `version = "${currentVersion}"`,
    `version = "${targetVersion}"`,
    `${DESKTOP_CRATE} version in Cargo.lock`,
  )
  updated[VERSION_FILE_PATHS[2]] = lockBlocks.join('[[package]]')

  readVersionFiles(updated)
  return updated
}

function compareSemver(left, right) {
  const leftVersion = parseVersion(left)
  const rightVersion = parseVersion(right)
  for (const key of ['major', 'minor', 'patch']) {
    if (leftVersion[key] !== rightVersion[key]) return leftVersion[key] - rightVersion[key]
  }
  if (leftVersion.prerelease === rightVersion.prerelease) return 0
  if (leftVersion.prerelease === null) return 1
  if (rightVersion.prerelease === null) return -1

  const leftParts = leftVersion.prerelease.split('.')
  const rightParts = rightVersion.prerelease.split('.')
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    if (leftParts[index] === undefined) return -1
    if (rightParts[index] === undefined) return 1
    if (leftParts[index] === rightParts[index]) continue
    const leftNumber = /^\d+$/.test(leftParts[index]) ? Number(leftParts[index]) : null
    const rightNumber = /^\d+$/.test(rightParts[index]) ? Number(rightParts[index]) : null
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber
    if (leftNumber !== null) return -1
    if (rightNumber !== null) return 1
    return leftParts[index].localeCompare(rightParts[index])
  }
  return 0
}

async function getFileContent({ github, owner, repo, path, ref }) {
  const response = await github.rest.repos.getContent({ owner, repo, path, ref })
  if (Array.isArray(response.data) || response.data.type !== 'file') {
    throw new Error(`${path} at ${ref} is not a file`)
  }
  return Buffer.from(response.data.content, response.data.encoding ?? 'base64').toString('utf8')
}

export async function readReleaseStateAtRef({ github, owner, repo, ref }) {
  const entries = await Promise.all(
    VERSION_FILE_PATHS.map(async (path) => [path, await getFileContent({ github, owner, repo, path, ref })]),
  )
  const files = Object.fromEntries(entries)
  return { files, version: readVersionFiles(files) }
}

async function getReleaseStatus({ github, owner, repo, version }) {
  const tag = `v${version}`
  try {
    const response = await github.rest.repos.getReleaseByTag({ owner, repo, tag })
    return response.data.draft ? 'draft' : 'published'
  } catch (error) {
    if (error.status !== 404) throw error
  }

  try {
    await github.rest.git.getRef({ owner, repo, ref: `tags/${tag}` })
    return 'tag-only'
  } catch (error) {
    if (error.status !== 404) throw error
  }

  return 'missing'
}

async function compareRefs({ github, owner, repo, base, head }) {
  const commits = []
  let comparison
  let page = 1

  while (true) {
    const response = await github.rest.repos.compareCommitsWithBasehead({
      owner,
      repo,
      basehead: `${base}...${head}`,
      per_page: 100,
      page,
    })
    comparison ??= response.data
    commits.push(...response.data.commits)

    if (
      response.data.commits.length === 0 ||
      response.data.commits.length < 100 ||
      commits.length >= response.data.total_commits
    ) {
      break
    }
    page += 1
  }

  if (comparison.behind_by !== 0) {
    throw new Error(`${base} is not an ancestor of ${head}`)
  }

  return {
    aheadBy: comparison.ahead_by,
    commits,
    compareUrl: comparison.html_url,
  }
}

async function getAssociatedPullRequests({ github, owner, repo, commitSha }) {
  return await github.paginate(github.rest.repos.listPullRequestsAssociatedWithCommit, {
    owner,
    repo,
    commit_sha: commitSha,
    per_page: 100,
  })
}

export async function collectReleaseChanges({ github, owner, repo, baseTag, headSha }) {
  const comparison = await compareRefs({ github, owner, repo, base: baseTag, head: headSha })
  const pullRequestsByNumber = new Map()
  const directCommits = []

  for (const commit of comparison.commits) {
    const associatedPullRequests = await getAssociatedPullRequests({
      github,
      owner,
      repo,
      commitSha: commit.sha,
    })
    const mergedPullRequests = associatedPullRequests.filter(
      (pullRequest) => pullRequest.merged_at !== null && pullRequest.base.ref === RELEASE_BASE,
    )

    if (mergedPullRequests.length > 0) {
      for (const pullRequest of mergedPullRequests) {
        pullRequestsByNumber.set(pullRequest.number, pullRequest)
      }
    } else {
      directCommits.push({
        category: 'Other changes',
        sha: commit.sha,
        title: getCommitTitle(commit.commit.message),
        url: commit.html_url,
      })
    }
  }

  const pullRequests = [...pullRequestsByNumber.values()]
    .sort((first, second) => {
      const mergedAtComparison = first.merged_at.localeCompare(second.merged_at)
      return mergedAtComparison || first.number - second.number
    })
    .flatMap((pullRequest) => {
      const category = classifyPullRequest(pullRequest)
      if (category === null) return []
      return [
        {
          author: pullRequest.user?.login ?? null,
          category,
          number: pullRequest.number,
          title: pullRequest.title,
          url: pullRequest.html_url,
        },
      ]
    })

  return {
    aheadBy: comparison.aheadBy,
    changes: [...pullRequests, ...directCommits],
    compareUrl: comparison.compareUrl,
  }
}

function renderChange(change) {
  const title = escapeMarkdownText(change.title)
  if ('number' in change) {
    const author = change.author ? ` — @${change.author}` : ''
    return `- ${title} ([#${change.number}](${change.url}))${author}`
  }
  return `- ${title} ([${change.sha.slice(0, 7)}](${change.url}))`
}

export function renderChangelog(changes) {
  const sections = CHANGELOG_CATEGORIES.flatMap((category) => {
    const categoryChanges = changes.filter((change) => change.category === category)
    if (categoryChanges.length === 0) return []
    return [`### ${category}\n\n${categoryChanges.map(renderChange).join('\n')}`]
  })
  return sections.length > 0 ? sections.join('\n\n') : '_No changelog entries for this release._'
}

export function renderManagedSection({ changes, compareUrl, currentVersion, targetVersion }) {
  return `${MANAGED_SECTION_START}
## Summary

Bumps Local Brain from \`${currentVersion}\` to \`${targetVersion}\` and publishes the commits below.

## Changelog

${renderChangelog(changes)}

## Release

Merging this pull request triggers the signed and notarized macOS release from the exact merge commit. The release remains a human decision: review the generated notes and wait for CI before merging.

[View the full \`v${currentVersion}...master\` comparison](${compareUrl}).
${MANAGED_SECTION_END}`
}

export function upsertManagedSection(existingBody, managedSection) {
  const startIndex = existingBody.indexOf(MANAGED_SECTION_START)
  const endIndex = existingBody.indexOf(MANAGED_SECTION_END)

  if ((startIndex === -1) !== (endIndex === -1)) {
    throw new Error('The release PR body contains an incomplete managed section')
  }
  if (startIndex === -1) {
    const trimmedBody = existingBody.trim()
    return trimmedBody ? `${trimmedBody}\n\n${managedSection}` : managedSection
  }
  if (
    startIndex !== existingBody.lastIndexOf(MANAGED_SECTION_START) ||
    endIndex !== existingBody.lastIndexOf(MANAGED_SECTION_END) ||
    endIndex < startIndex
  ) {
    throw new Error('The release PR body contains malformed managed sections')
  }

  const bodyBeforeSection = existingBody.slice(0, startIndex)
  const bodyAfterSection = existingBody.slice(endIndex + MANAGED_SECTION_END.length)
  return `${bodyBeforeSection}${managedSection}${bodyAfterSection}`
}

async function findOpenReleasePullRequests({ github, owner, repo }) {
  return await github.paginate(github.rest.pulls.list, {
    owner,
    repo,
    state: 'open',
    base: RELEASE_BASE,
    head: `${owner}:${RELEASE_HEAD}`,
    per_page: 100,
  })
}

async function getRefOrNull({ github, owner, repo, ref }) {
  try {
    return await github.rest.git.getRef({ owner, repo, ref })
  } catch (error) {
    if (error.status === 404) return null
    throw error
  }
}

async function releaseBranchIsCurrent({ github, owner, repo, branchRef, baseSha, desiredFiles }) {
  if (!branchRef) return false
  const branchSha = branchRef.data.object.sha
  const commit = await github.rest.git.getCommit({ owner, repo, commit_sha: branchSha })
  if (commit.data.parents.length !== 1 || commit.data.parents[0].sha !== baseSha) return false
  const state = await readReleaseStateAtRef({ github, owner, repo, ref: branchSha })
  if (!VERSION_FILE_PATHS.every((path) => state.files[path] === desiredFiles[path])) return false

  const repositoryCommit = await github.rest.repos.getCommit({ owner, repo, ref: branchSha })
  const changedPaths = (repositoryCommit.data.files ?? []).map((file) => file.filename).sort()
  const expectedPaths = [...VERSION_FILE_PATHS].sort()
  return JSON.stringify(changedPaths) === JSON.stringify(expectedPaths)
}

async function ensureReleaseBranch({ github, owner, repo, baseSha, desiredFiles, targetVersion }) {
  const branchRefName = `heads/${RELEASE_HEAD}`
  const observedRef = await getRefOrNull({ github, owner, repo, ref: branchRefName })
  if (
    await releaseBranchIsCurrent({
      github,
      owner,
      repo,
      branchRef: observedRef,
      baseSha,
      desiredFiles,
    })
  ) {
    return { changed: false, sha: observedRef.data.object.sha }
  }

  const baseCommit = await github.rest.git.getCommit({ owner, repo, commit_sha: baseSha })
  const blobs = await Promise.all(
    VERSION_FILE_PATHS.map(async (path) => {
      const response = await github.rest.git.createBlob({
        owner,
        repo,
        content: desiredFiles[path],
        encoding: 'utf-8',
      })
      return { path, mode: '100644', type: 'blob', sha: response.data.sha }
    }),
  )
  const tree = await github.rest.git.createTree({
    owner,
    repo,
    base_tree: baseCommit.data.tree.sha,
    tree: blobs,
  })
  const commit = await github.rest.git.createCommit({
    owner,
    repo,
    message: `Release v${targetVersion}`,
    tree: tree.data.sha,
    parents: [baseSha],
  })

  if (observedRef) {
    const latestRef = await github.rest.git.getRef({ owner, repo, ref: branchRefName })
    if (latestRef.data.object.sha !== observedRef.data.object.sha) {
      throw new Error(`${RELEASE_HEAD} changed while the release commit was being prepared; retry the workflow`)
    }
    await github.rest.git.updateRef({
      owner,
      repo,
      ref: branchRefName,
      sha: commit.data.sha,
      force: true,
    })
  } else {
    await github.rest.git.createRef({
      owner,
      repo,
      ref: `refs/${branchRefName}`,
      sha: commit.data.sha,
    })
  }

  return { changed: true, sha: commit.data.sha }
}

async function targetVersionForRelease({ github, owner, repo, currentVersion, existingPullRequest, bump }) {
  let targetVersion
  if (bump) {
    targetVersion = computeNextVersion(currentVersion, bump)
  } else if (existingPullRequest) {
    const existingState = await readReleaseStateAtRef({
      github,
      owner,
      repo,
      ref: existingPullRequest.head.sha,
    })
    if (existingState.version !== currentVersion) targetVersion = existingState.version
  }

  targetVersion ??= computeNextVersion(currentVersion, currentVersion.includes('-') ? 'beta' : 'patch')
  if (compareSemver(targetVersion, currentVersion) <= 0) {
    throw new Error(`Release target ${targetVersion} must be newer than ${currentVersion}`)
  }
  return targetVersion
}

async function closeStaleReleasePullRequest({ github, owner, repo, pullRequest, core }) {
  if (!pullRequest) return
  await github.rest.pulls.update({
    owner,
    repo,
    pull_number: pullRequest.number,
    state: 'closed',
  })
  core.notice(`Closed stale release PR #${pullRequest.number}`)
}

export async function maintainReleasePullRequest({ github, context, core, baseSha, bump }) {
  const { owner, repo } = context.repo
  const openPullRequests = await findOpenReleasePullRequests({ github, owner, repo })
  if (openPullRequests.length > 1) {
    throw new Error(
      `Expected at most one open ${RELEASE_HEAD} -> ${RELEASE_BASE} pull request, found ${openPullRequests.length}`,
    )
  }
  const existingPullRequest = openPullRequests[0]

  const resolvedBaseSha =
    baseSha ?? (await github.rest.git.getRef({ owner, repo, ref: `heads/${RELEASE_BASE}` })).data.object.sha
  const baseState = await readReleaseStateAtRef({ github, owner, repo, ref: resolvedBaseSha })
  const releaseStatus = await getReleaseStatus({
    github,
    owner,
    repo,
    version: baseState.version,
  })
  if (releaseStatus !== 'published') {
    core.warning(
      `v${baseState.version} is ${releaseStatus}; not preparing another release until it is published`,
    )
    return { action: 'pending-release', version: baseState.version }
  }

  const release = await collectReleaseChanges({
    github,
    owner,
    repo,
    baseTag: `v${baseState.version}`,
    headSha: resolvedBaseSha,
  })
  if (release.aheadBy === 0) {
    await closeStaleReleasePullRequest({
      github,
      owner,
      repo,
      pullRequest: existingPullRequest,
      core,
    })
    core.info(`${RELEASE_BASE} has no unreleased commits; nothing to do`)
    return { action: 'idle', version: baseState.version }
  }

  const targetVersion = await targetVersionForRelease({
    github,
    owner,
    repo,
    currentVersion: baseState.version,
    existingPullRequest,
    bump,
  })
  const desiredFiles = updateVersionFiles(baseState.files, targetVersion)
  await ensureReleaseBranch({
    github,
    owner,
    repo,
    baseSha: resolvedBaseSha,
    desiredFiles,
    targetVersion,
  })
  const managedSection = renderManagedSection({
    ...release,
    currentVersion: baseState.version,
    targetVersion,
  })
  const title = `Release v${targetVersion}`

  let pullRequestNumber
  if (!existingPullRequest) {
    const response = await github.rest.pulls.create({
      owner,
      repo,
      title,
      body: managedSection,
      base: RELEASE_BASE,
      head: RELEASE_HEAD,
      maintainer_can_modify: true,
    })
    pullRequestNumber = response.data.number
    core.notice(`Created release PR #${pullRequestNumber}`)
  } else {
    pullRequestNumber = existingPullRequest.number
    const body = upsertManagedSection(existingPullRequest.body ?? '', managedSection)
    if (title !== existingPullRequest.title || body !== (existingPullRequest.body ?? '')) {
      await github.rest.pulls.update({
        owner,
        repo,
        pull_number: existingPullRequest.number,
        title,
        body,
      })
      core.notice(`Updated release PR #${pullRequestNumber}`)
    } else {
      core.info(`Release PR #${pullRequestNumber} is already current`)
    }
  }

  await github.rest.actions.createWorkflowDispatch({
    owner,
    repo,
    workflow_id: RELEASE_CI_WORKFLOW,
    ref: RELEASE_HEAD,
  })
  core.notice(`Dispatched CI for release PR #${pullRequestNumber}`)

  return {
    action: existingPullRequest ? 'updated' : 'created',
    pullRequestNumber,
    targetVersion,
  }
}

function hasReleaseMarkers(body) {
  return body.includes(MANAGED_SECTION_START) && body.includes(MANAGED_SECTION_END)
}

export async function analyzeMergedReleasePullRequest({ github, context, core }) {
  const pullRequest = context.payload.pull_request
  const { owner, repo } = context.repo
  if (
    !pullRequest?.merged ||
    pullRequest.base.ref !== RELEASE_BASE ||
    pullRequest.head.ref !== RELEASE_HEAD ||
    pullRequest.head.repo?.full_name !== `${owner}/${repo}`
  ) {
    return { releaseNeeded: false }
  }
  if (!hasReleaseMarkers(pullRequest.body ?? '')) {
    throw new Error(`Merged ${RELEASE_HEAD} PR #${pullRequest.number} is missing its release markers`)
  }

  const releaseRef = pullRequest.merge_commit_sha
  if (!releaseRef) throw new Error(`Merged release PR #${pullRequest.number} has no merge commit SHA`)
  const mergeCommit = await github.rest.repos.getCommit({ owner, repo, ref: releaseRef })
  const parentSha = mergeCommit.data.parents[0]?.sha
  if (!parentSha) throw new Error(`Release commit ${releaseRef} has no first parent`)
  if (parentSha !== pullRequest.base.sha) {
    throw new Error(
      `Release commit parent ${parentSha} does not match the reviewed base ${pullRequest.base.sha}`,
    )
  }
  const releaseHead = await github.rest.git.getCommit({
    owner,
    repo,
    commit_sha: pullRequest.head.sha,
  })
  if (releaseHead.data.parents.length !== 1 || releaseHead.data.parents[0].sha !== parentSha) {
    throw new Error(
      `Release PR head was not generated from merge base ${parentSha}; refresh the rolling PR and rerun CI`,
    )
  }
  const ciRuns = await github.rest.actions.listWorkflowRuns({
    owner,
    repo,
    workflow_id: RELEASE_CI_WORKFLOW,
    head_sha: pullRequest.head.sha,
    status: 'completed',
    per_page: 100,
  })
  if (!ciRuns.data.workflow_runs.some((run) => run.conclusion === 'success')) {
    throw new Error(
      `Release PR head ${pullRequest.head.sha} has no successful completed CI run; rerun this workflow after CI passes`,
    )
  }

  const changedPaths = (mergeCommit.data.files ?? []).map((file) => file.filename).sort()
  const expectedPaths = [...VERSION_FILE_PATHS].sort()
  if (JSON.stringify(changedPaths) !== JSON.stringify(expectedPaths)) {
    throw new Error(
      `Release commit ${releaseRef.slice(0, 7)} changed unexpected files: ${changedPaths.join(', ')}`,
    )
  }

  const [previousState, releaseState] = await Promise.all([
    readReleaseStateAtRef({ github, owner, repo, ref: parentSha }),
    readReleaseStateAtRef({ github, owner, repo, ref: releaseRef }),
  ])
  if (compareSemver(releaseState.version, previousState.version) <= 0) {
    throw new Error(
      `Release PR did not advance the version: ${previousState.version} -> ${releaseState.version}`,
    )
  }

  const releaseStatus = await getReleaseStatus({
    github,
    owner,
    repo,
    version: releaseState.version,
  })
  if (releaseStatus === 'published') {
    core.info(`v${releaseState.version} is already published`)
    return { releaseNeeded: false, releaseRef, version: releaseState.version }
  }
  if (releaseStatus === 'draft') {
    throw new Error(`v${releaseState.version} already has a draft release; finish or delete it before retrying`)
  }
  if (releaseStatus === 'tag-only') {
    core.warning(`v${releaseState.version} already has a tag; its tag-triggered Release run owns publishing`)
    return { releaseNeeded: false, releaseRef, version: releaseState.version }
  }

  core.notice(`Release PR #${pullRequest.number} is ready to publish v${releaseState.version}`)
  return { releaseNeeded: true, releaseRef, version: releaseState.version }
}
