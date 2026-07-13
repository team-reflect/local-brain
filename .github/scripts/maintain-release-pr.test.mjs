import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MANAGED_SECTION_END,
  MANAGED_SECTION_START,
  VERSION_FILE_PATHS,
  analyzeMergedReleasePullRequest,
  classifyPullRequest,
  collectReleaseChanges,
  maintainReleasePullRequest,
  readVersionFiles,
  renderChangelog,
  updateVersionFiles,
  upsertManagedSection,
} from './maintain-release-pr.mjs'

function versionFiles(version) {
  return {
    [VERSION_FILE_PATHS[0]]: `{
  "productName": "Local Brain",
  "version": "${version}",
  "metadata": {
    "version": "${version}"
  }
}
`,
    [VERSION_FILE_PATHS[1]]: `[package]
name = "local-brain-desktop"
version = "${version}"
edition = "2021"

[dependencies]
fixture = { version = "${version}" }
`,
    [VERSION_FILE_PATHS[2]]: `[[package]]
name = "fixture"
version = "${version}"

[[package]]
name = "local-brain-desktop"
version = "${version}"
dependencies = [
 "fixture",
]
`,
  }
}

function notFound(message = 'Not found') {
  return Object.assign(new Error(message), { status: 404 })
}

function createCommit(sha, message) {
  return {
    sha,
    html_url: `https://github.com/team-reflect/local-brain/commit/${sha}`,
    commit: { message },
  }
}

function createPullRequest(overrides = {}) {
  return {
    number: 42,
    title: 'Add release automation',
    body: '',
    html_url: 'https://github.com/team-reflect/local-brain/pull/42',
    merged_at: '2026-07-13T12:00:00Z',
    base: { ref: 'master', sha: 'previous-sha' },
    head: {
      ref: 'feature/release',
      sha: 'feature-head',
      repo: { full_name: 'team-reflect/local-brain' },
    },
    user: { login: 'octocat' },
    labels: [],
    ...overrides,
  }
}

function createCore() {
  return {
    info: () => {},
    notice: () => {},
    warning: () => {},
  }
}

function createGithub({
  baseSha = 'base-sha',
  baseFiles = versionFiles('0.1.16'),
  ciRuns = [{ conclusion: 'success' }],
  commits = [],
  pullRequestsByCommit = {},
  openPullRequests = [],
  releaseStatus = 'published',
  filesByRef = {},
  gitCommitData = {},
  repoCommits = {},
  refs = {},
} = {}) {
  const fileSnapshots = new Map([[baseSha, baseFiles], ...Object.entries(filesByRef)])
  const gitRefs = new Map([[`heads/master`, baseSha], ...Object.entries(refs)])
  const gitCommits = new Map([
    [baseSha, { sha: baseSha, tree: { sha: 'base-tree' }, parents: [] }],
    ...Object.entries(gitCommitData),
  ])
  const blobContents = new Map()
  let blobIndex = 0
  const calls = {
    actionsDispatch: [],
    comparePages: [],
    createBlob: [],
    createCommit: [],
    createPull: [],
    createRef: [],
    createTree: [],
    updatePull: [],
    updateRef: [],
  }

  const github = {
    paginate: async (method, parameters) => {
      const response = await method(parameters)
      return response.data
    },
    rest: {
      actions: {
        createWorkflowDispatch: async (parameters) => {
          calls.actionsDispatch.push(parameters)
          return { data: {} }
        },
        listWorkflowRuns: async () => ({ data: { workflow_runs: ciRuns } }),
      },
      git: {
        createBlob: async (parameters) => {
          calls.createBlob.push(parameters)
          const sha = `blob-${blobIndex}`
          blobIndex += 1
          blobContents.set(sha, parameters.content)
          return { data: { sha } }
        },
        createCommit: async (parameters) => {
          calls.createCommit.push(parameters)
          const sha = 'release-commit'
          gitCommits.set(sha, {
            sha,
            tree: { sha: parameters.tree },
            parents: parameters.parents.map((parent) => ({ sha: parent })),
          })
          return { data: { sha } }
        },
        createRef: async (parameters) => {
          calls.createRef.push(parameters)
          gitRefs.set(parameters.ref.replace(/^refs\//, ''), parameters.sha)
          return { data: { object: { sha: parameters.sha } } }
        },
        createTree: async (parameters) => {
          calls.createTree.push(parameters)
          return { data: { sha: 'release-tree' } }
        },
        getCommit: async ({ commit_sha: commitSha }) => {
          const commit = gitCommits.get(commitSha)
          if (!commit) throw notFound(`Missing commit ${commitSha}`)
          return { data: commit }
        },
        getRef: async ({ ref }) => {
          const sha = gitRefs.get(ref)
          if (!sha) throw notFound(`Missing ref ${ref}`)
          return { data: { object: { sha } } }
        },
        updateRef: async (parameters) => {
          calls.updateRef.push(parameters)
          gitRefs.set(parameters.ref, parameters.sha)
          return { data: { object: { sha: parameters.sha } } }
        },
      },
      pulls: {
        create: async (parameters) => {
          calls.createPull.push(parameters)
          return { data: { number: 99 } }
        },
        list: async () => ({ data: openPullRequests }),
        update: async (parameters) => {
          calls.updatePull.push(parameters)
          return { data: {} }
        },
      },
      repos: {
        compareCommitsWithBasehead: async ({ page = 1, per_page: perPage }) => {
          calls.comparePages.push(page)
          const startIndex = (page - 1) * perPage
          return {
            data: {
              ahead_by: commits.length,
              behind_by: 0,
              commits: commits.slice(startIndex, startIndex + perPage),
              html_url: 'https://github.com/team-reflect/local-brain/compare/v0.1.16...master',
              total_commits: commits.length,
            },
          }
        },
        getCommit: async ({ ref }) => {
          const commit = repoCommits[ref]
          if (!commit) throw notFound(`Missing repository commit ${ref}`)
          return { data: commit }
        },
        getContent: async ({ path, ref }) => {
          const snapshot = fileSnapshots.get(ref)
          if (!snapshot || !(path in snapshot)) throw notFound(`Missing ${path} at ${ref}`)
          return {
            data: {
              type: 'file',
              content: Buffer.from(snapshot[path]).toString('base64'),
              encoding: 'base64',
            },
          }
        },
        getReleaseByTag: async () => {
          if (releaseStatus === 'missing' || releaseStatus === 'tag-only') throw notFound()
          return { data: { draft: releaseStatus === 'draft' } }
        },
        listPullRequestsAssociatedWithCommit: async ({ commit_sha: commitSha }) => ({
          data: pullRequestsByCommit[commitSha] ?? [],
        }),
      },
    },
  }

  if (releaseStatus === 'tag-only') gitRefs.set('tags/v0.1.17', 'release-commit')

  return { blobContents, calls, github }
}

test('updates the three release versions without touching lookalike declarations', () => {
  const files = versionFiles('0.1.16')
  const updated = updateVersionFiles(files, '0.1.17')

  assert.equal(readVersionFiles(updated), '0.1.17')
  assert.match(updated[VERSION_FILE_PATHS[0]], /"metadata": \{\n    "version": "0\.1\.16"/)
  assert.match(updated[VERSION_FILE_PATHS[1]], /fixture = \{ version = "0\.1\.16" \}/)
  assert.match(updated[VERSION_FILE_PATHS[2]], /name = "fixture"\nversion = "0\.1\.16"/)
})

test('rejects out-of-sync version declarations', () => {
  const files = versionFiles('0.1.16')
  files[VERSION_FILE_PATHS[2]] = files[VERSION_FILE_PATHS[2]].replace(
    'name = "local-brain-desktop"\nversion = "0.1.16"',
    'name = "local-brain-desktop"\nversion = "0.1.15"',
  )
  assert.throws(() => readVersionFiles(files), /versions are out of sync/i)
})

test('classifies common release-note title and label styles', () => {
  assert.equal(classifyPullRequest(createPullRequest({ title: 'feat: add graph filters' })), 'Features')
  assert.equal(classifyPullRequest(createPullRequest({ title: 'Fix updater URLs' })), 'Fixes')
  assert.equal(
    classifyPullRequest(createPullRequest({ title: 'feat!: replace storage format' })),
    'Breaking changes',
  )
  assert.equal(
    classifyPullRequest(createPullRequest({ labels: [{ name: 'skip-changelog' }] })),
    null,
  )
})

test('renders escaped changelog entries and preserves text outside the managed section', () => {
  const changelog = renderChangelog([
    {
      author: 'octocat',
      category: 'Fixes',
      number: 42,
      title: 'Fix [updater] <!-- local-brain-release-pr:end -->',
      url: 'https://github.com/team-reflect/local-brain/pull/42',
    },
  ])
  assert.match(changelog, /Fix \\\[updater\\\]/)
  assert.doesNotMatch(changelog, /<!-- local-brain-release-pr:end -->/)

  const existing = `Keep this note.\n\n${MANAGED_SECTION_START}\nOld\n${MANAGED_SECTION_END}\n\nKeep this too.`
  const replacement = `${MANAGED_SECTION_START}\nNew\n${MANAGED_SECTION_END}`
  assert.equal(
    upsertManagedSection(existing, replacement),
    `Keep this note.\n\n${replacement}\n\nKeep this too.`,
  )
})

test('collects associated PRs once and keeps direct commits', async () => {
  const pullRequest = createPullRequest()
  const commits = [createCommit('aaaa', 'Add release automation'), createCommit('bbbb', 'Update docs')]
  const { github } = createGithub({
    commits,
    pullRequestsByCommit: { aaaa: [pullRequest] },
  })
  const release = await collectReleaseChanges({
    github,
    owner: 'team-reflect',
    repo: 'local-brain',
    baseTag: 'v0.1.16',
    headSha: 'base-sha',
  })
  assert.deepEqual(
    release.changes.map((change) => change.title),
    ['Add release automation', 'Update docs'],
  )
})

test('creates a version branch, release PR, and explicit CI dispatch', async () => {
  const commit = createCommit('aaaa', 'Fix updater URLs')
  const pullRequest = createPullRequest({ title: 'Fix updater URLs' })
  const { blobContents, calls, github } = createGithub({
    commits: [commit],
    pullRequestsByCommit: { aaaa: [pullRequest] },
  })

  const result = await maintainReleasePullRequest({
    github,
    context: { repo: { owner: 'team-reflect', repo: 'local-brain' } },
    core: createCore(),
    baseSha: 'base-sha',
  })

  assert.equal(result.action, 'created')
  assert.equal(result.targetVersion, '0.1.17')
  assert.equal(calls.createRef[0].ref, 'refs/heads/automation/release')
  assert.equal(calls.createPull[0].base, 'master')
  assert.equal(calls.createPull[0].head, 'automation/release')
  assert.equal(calls.actionsDispatch[0].workflow_id, 'ci.yml')
  assert.equal(calls.actionsDispatch[0].ref, 'automation/release')
  for (const content of blobContents.values()) assert.match(content, /0\.1\.17/)
})

test('honors an explicit release bump override', async () => {
  const { github } = createGithub({ commits: [createCommit('aaaa', 'Add projects')] })
  const result = await maintainReleasePullRequest({
    github,
    context: { repo: { owner: 'team-reflect', repo: 'local-brain' } },
    core: createCore(),
    baseSha: 'base-sha',
    bump: 'minor',
  })
  assert.equal(result.targetVersion, '0.2.0')
})

test('refreshes an existing release branch while preserving its chosen target and human notes', async () => {
  const existingBody = `Keep this release note.\n\n${MANAGED_SECTION_START}\nOld generated notes\n${MANAGED_SECTION_END}`
  const existingPullRequest = createPullRequest({
    number: 77,
    title: 'Release v0.2.0',
    body: existingBody,
    head: {
      ref: 'automation/release',
      sha: 'old-release-head',
      repo: { full_name: 'team-reflect/local-brain' },
    },
  })
  const { calls, github } = createGithub({
    commits: [createCommit('aaaa', 'Add projects')],
    openPullRequests: [existingPullRequest],
    filesByRef: { 'old-release-head': versionFiles('0.2.0') },
    gitCommitData: {
      'old-release-head': {
        sha: 'old-release-head',
        tree: { sha: 'old-release-tree' },
        parents: [{ sha: 'old-master' }],
      },
    },
    refs: { 'heads/automation/release': 'old-release-head' },
  })

  const result = await maintainReleasePullRequest({
    github,
    context: { repo: { owner: 'team-reflect', repo: 'local-brain' } },
    core: createCore(),
    baseSha: 'base-sha',
  })

  assert.equal(result.action, 'updated')
  assert.equal(result.targetVersion, '0.2.0')
  assert.equal(calls.createRef.length, 0)
  assert.equal(calls.createPull.length, 0)
  assert.equal(calls.updateRef.length, 1)
  assert.equal(calls.updateRef[0].force, true)
  assert.equal(calls.updatePull.length, 1)
  assert.match(calls.updatePull[0].body, /^Keep this release note\./)
  assert.doesNotMatch(calls.updatePull[0].body, /Old generated notes/)
  assert.equal(calls.actionsDispatch.length, 1)
})

test('keeps an exact generated release branch without rewriting it', async () => {
  const releaseHead = 'current-release-head'
  const existingPullRequest = createPullRequest({
    number: 77,
    title: 'Release v0.1.17',
    head: {
      ref: 'automation/release',
      sha: releaseHead,
      repo: { full_name: 'team-reflect/local-brain' },
    },
  })
  const { calls, github } = createGithub({
    commits: [createCommit('aaaa', 'Add projects')],
    openPullRequests: [existingPullRequest],
    filesByRef: { [releaseHead]: updateVersionFiles(versionFiles('0.1.16'), '0.1.17') },
    gitCommitData: {
      [releaseHead]: {
        sha: releaseHead,
        tree: { sha: 'release-tree' },
        parents: [{ sha: 'base-sha' }],
      },
    },
    repoCommits: {
      [releaseHead]: {
        sha: releaseHead,
        files: VERSION_FILE_PATHS.map((filename) => ({ filename })),
      },
    },
    refs: { 'heads/automation/release': releaseHead },
  })

  await maintainReleasePullRequest({
    github,
    context: { repo: { owner: 'team-reflect', repo: 'local-brain' } },
    core: createCore(),
    baseSha: 'base-sha',
  })

  assert.equal(calls.createCommit.length, 0)
  assert.equal(calls.updateRef.length, 0)
  assert.equal(calls.actionsDispatch.length, 1)
})

test('rewrites a release branch commit that carries an extra file', async () => {
  const releaseHead = 'altered-release-head'
  const existingPullRequest = createPullRequest({
    number: 77,
    title: 'Release v0.1.17',
    head: {
      ref: 'automation/release',
      sha: releaseHead,
      repo: { full_name: 'team-reflect/local-brain' },
    },
  })
  const { calls, github } = createGithub({
    commits: [createCommit('aaaa', 'Add projects')],
    openPullRequests: [existingPullRequest],
    filesByRef: { [releaseHead]: updateVersionFiles(versionFiles('0.1.16'), '0.1.17') },
    gitCommitData: {
      [releaseHead]: {
        sha: releaseHead,
        tree: { sha: 'release-tree' },
        parents: [{ sha: 'base-sha' }],
      },
    },
    repoCommits: {
      [releaseHead]: {
        sha: releaseHead,
        files: [...VERSION_FILE_PATHS, 'apps/desktop/src/main.tsx'].map((filename) => ({ filename })),
      },
    },
    refs: { 'heads/automation/release': releaseHead },
  })

  await maintainReleasePullRequest({
    github,
    context: { repo: { owner: 'team-reflect', repo: 'local-brain' } },
    core: createCore(),
    baseSha: 'base-sha',
  })

  assert.equal(calls.createCommit.length, 1)
  assert.equal(calls.updateRef.length, 1)
  assert.equal(calls.updateRef[0].force, true)
})

test('does not prepare another PR while the current version is unpublished', async () => {
  const { calls, github } = createGithub({
    commits: [createCommit('aaaa', 'Fix updater URLs')],
    releaseStatus: 'missing',
  })
  const result = await maintainReleasePullRequest({
    github,
    context: { repo: { owner: 'team-reflect', repo: 'local-brain' } },
    core: createCore(),
    baseSha: 'base-sha',
  })
  assert.equal(result.action, 'pending-release')
  assert.equal(calls.createPull.length, 0)
  assert.equal(calls.createRef.length, 0)
})

test('refuses to choose between duplicate rolling release PRs', async () => {
  const { github } = createGithub({
    openPullRequests: [createPullRequest({ number: 1 }), createPullRequest({ number: 2 })],
  })
  await assert.rejects(
    maintainReleasePullRequest({
      github,
      context: { repo: { owner: 'team-reflect', repo: 'local-brain' } },
      core: createCore(),
      baseSha: 'base-sha',
    }),
    /Expected at most one open automation\/release -> master pull request/,
  )
})

test('publishes only a marked merged rolling PR that changes the version files', async () => {
  const previousFiles = versionFiles('0.1.16')
  const releaseFiles = versionFiles('0.1.17')
  const releaseRef = 'release-merge-sha'
  const { github } = createGithub({
    releaseStatus: 'missing',
    gitCommitData: {
      'release-head': {
        sha: 'release-head',
        tree: { sha: 'release-tree' },
        parents: [{ sha: 'previous-sha' }],
      },
    },
    filesByRef: {
      'previous-sha': previousFiles,
      [releaseRef]: releaseFiles,
    },
    repoCommits: {
      [releaseRef]: {
        sha: releaseRef,
        parents: [{ sha: 'previous-sha' }],
        files: VERSION_FILE_PATHS.map((filename) => ({ filename })),
      },
    },
  })
  const pullRequest = createPullRequest({
    number: 99,
    merged: true,
    merge_commit_sha: releaseRef,
    body: `${MANAGED_SECTION_START}\nGenerated\n${MANAGED_SECTION_END}`,
    head: {
      ref: 'automation/release',
      sha: 'release-head',
      repo: { full_name: 'team-reflect/local-brain' },
    },
  })

  const result = await analyzeMergedReleasePullRequest({
    github,
    context: {
      repo: { owner: 'team-reflect', repo: 'local-brain' },
      payload: { pull_request: pullRequest },
    },
    core: createCore(),
  })
  assert.deepEqual(result, {
    releaseNeeded: true,
    releaseRef,
    version: '0.1.17',
  })
})

test('refuses to publish a release PR head without successful CI', async () => {
  const releaseRef = 'release-merge-sha'
  const { github } = createGithub({
    ciRuns: [{ conclusion: 'failure' }],
    releaseStatus: 'missing',
    gitCommitData: {
      'release-head': {
        sha: 'release-head',
        tree: { sha: 'release-tree' },
        parents: [{ sha: 'previous-sha' }],
      },
    },
    filesByRef: {
      'previous-sha': versionFiles('0.1.16'),
      [releaseRef]: versionFiles('0.1.17'),
    },
    repoCommits: {
      [releaseRef]: {
        sha: releaseRef,
        parents: [{ sha: 'previous-sha' }],
        files: VERSION_FILE_PATHS.map((filename) => ({ filename })),
      },
    },
  })
  const pullRequest = createPullRequest({
    merged: true,
    merge_commit_sha: releaseRef,
    body: `${MANAGED_SECTION_START}\nGenerated\n${MANAGED_SECTION_END}`,
    head: {
      ref: 'automation/release',
      sha: 'release-head',
      repo: { full_name: 'team-reflect/local-brain' },
    },
  })

  await assert.rejects(
    analyzeMergedReleasePullRequest({
      github,
      context: {
        repo: { owner: 'team-reflect', repo: 'local-brain' },
        payload: { pull_request: pullRequest },
      },
      core: createCore(),
    }),
    /no successful completed CI run/,
  )
})

test('rejects a marked release merge containing an unexpected file', async () => {
  const releaseRef = 'release-merge-sha'
  const { github } = createGithub({
    releaseStatus: 'missing',
    gitCommitData: {
      'release-head': {
        sha: 'release-head',
        tree: { sha: 'release-tree' },
        parents: [{ sha: 'previous-sha' }],
      },
    },
    filesByRef: {
      'previous-sha': versionFiles('0.1.16'),
      [releaseRef]: versionFiles('0.1.17'),
    },
    repoCommits: {
      [releaseRef]: {
        sha: releaseRef,
        parents: [{ sha: 'previous-sha' }],
        files: [...VERSION_FILE_PATHS, 'apps/desktop/src/main.tsx'].map((filename) => ({ filename })),
      },
    },
  })
  const pullRequest = createPullRequest({
    merged: true,
    merge_commit_sha: releaseRef,
    body: `${MANAGED_SECTION_START}\nGenerated\n${MANAGED_SECTION_END}`,
    head: {
      ref: 'automation/release',
      sha: 'release-head',
      repo: { full_name: 'team-reflect/local-brain' },
    },
  })
  await assert.rejects(
    analyzeMergedReleasePullRequest({
      github,
      context: {
        repo: { owner: 'team-reflect', repo: 'local-brain' },
        payload: { pull_request: pullRequest },
      },
      core: createCore(),
    }),
    /changed unexpected files/,
  )
})

test('rejects a release PR whose generated head was behind master at merge time', async () => {
  const releaseRef = 'release-merge-sha'
  const { github } = createGithub({
    releaseStatus: 'missing',
    gitCommitData: {
      'release-head': {
        sha: 'release-head',
        tree: { sha: 'release-tree' },
        parents: [{ sha: 'older-master' }],
      },
    },
    filesByRef: {
      'newer-master': versionFiles('0.1.16'),
      [releaseRef]: versionFiles('0.1.17'),
    },
    repoCommits: {
      [releaseRef]: {
        sha: releaseRef,
        parents: [{ sha: 'newer-master' }],
        files: VERSION_FILE_PATHS.map((filename) => ({ filename })),
      },
    },
  })
  const pullRequest = createPullRequest({
    merged: true,
    merge_commit_sha: releaseRef,
    base: { ref: 'master', sha: 'newer-master' },
    body: `${MANAGED_SECTION_START}\nGenerated\n${MANAGED_SECTION_END}`,
    head: {
      ref: 'automation/release',
      sha: 'release-head',
      repo: { full_name: 'team-reflect/local-brain' },
    },
  })

  await assert.rejects(
    analyzeMergedReleasePullRequest({
      github,
      context: {
        repo: { owner: 'team-reflect', repo: 'local-brain' },
        payload: { pull_request: pullRequest },
      },
      core: createCore(),
    }),
    /head was not generated from merge base/,
  )
})

test('ignores merged pull requests from any other branch', async () => {
  const { github } = createGithub()
  const result = await analyzeMergedReleasePullRequest({
    github,
    context: {
      repo: { owner: 'team-reflect', repo: 'local-brain' },
      payload: { pull_request: createPullRequest({ merged: true }) },
    },
    core: createCore(),
  })
  assert.deepEqual(result, { releaseNeeded: false })
})
