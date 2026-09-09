import assert from 'node:assert/strict'
import test from 'node:test'

import { RELEASE_VERSION_FILE_PATHS as PATHS } from '../../apps/desktop/scripts/release-bump.mjs'
import { prepareRelease, readVersionFiles, updateVersionFiles } from './prepare-release.mjs'

function versionFiles(version) {
  return {
    [PATHS[0]]: `{
  "productName": "Local Brain",
  "version": "${version}",
  "metadata": { "version": "${version}" }
}\n`,
    [PATHS[1]]: `[package]\nname = "local-brain-desktop"\nversion = "${version}"\n\n[dependencies]\nfixture = { version = "${version}" }\n`,
    [PATHS[2]]: `[[package]]\nname = "fixture"\nversion = "${version}"\n\n[[package]]\nname = "local-brain-desktop"\nversion = "${version}"\n`,
  }
}

function notFound() {
  return Object.assign(new Error('Not found'), { status: 404 })
}

function ciRun(sha = 'source', overrides = {}) {
  return {
    id: 99,
    event: 'push',
    head_branch: 'master',
    head_sha: sha,
    head_repository: { full_name: 'team-reflect/local-brain' },
    path: '.github/workflows/ci.yml',
    status: 'completed',
    conclusion: 'success',
    ...overrides,
  }
}

function scenario(version = '0.1.18') {
  const refs = new Map([['heads/master', { sha: 'source', type: 'commit' }]])
  const files = new Map([['source', versionFiles(version)]])
  const commits = new Map([['source', {
    sha: 'source', parents: [{ sha: 'previous' }], files: [{ filename: 'app.ts' }],
    commit: { message: 'Add a feature (#42)', tree: { sha: 'source-tree' } },
  }]])
  const runs = new Map([['source', [ciRun()]]])
  const releases = new Map()
  const trees = new Map()
  const calls = { ci: [], createCommit: [], updateRef: [] }
  const warnings = []
  const fixture = {
    refs, files, commits, runs, releases, calls, warnings,
    latest: null,
    triggeringRun: ciRun(),
    beforeUpdate: () => {},
  }
  const github = { rest: {
    actions: {
      getWorkflowRun: async () => ({ data: fixture.triggeringRun }),
      listWorkflowRuns: async (parameters) => {
        calls.ci.push(parameters)
        return { data: { workflow_runs: runs.get(parameters.head_sha) ?? [] } }
      },
    },
    repos: {
      getCommit: async ({ ref }) => {
        if (!commits.has(ref)) throw notFound()
        return { data: commits.get(ref) }
      },
      getContent: async ({ path, ref }) => ({ data: {
        type: 'file', encoding: 'base64', content: Buffer.from(files.get(ref)[path]).toString('base64'),
      } }),
      getReleaseByTag: async ({ tag }) => {
        if (!releases.has(tag)) throw notFound()
        return { data: releases.get(tag) }
      },
      getLatestRelease: async () => {
        if (!fixture.latest) throw notFound()
        return { data: { tag_name: fixture.latest } }
      },
    },
    git: {
      getRef: async ({ ref }) => {
        if (!refs.has(ref)) throw notFound()
        return { data: { object: refs.get(ref) } }
      },
      getTag: async () => ({ data: { object: { sha: refs.get('heads/master').sha, type: 'commit' } } }),
      createTree: async ({ tree, base_tree: baseTree }) => {
        const base = [...commits.values()].find((commit) => commit.commit.tree.sha === baseTree)
        const snapshot = { ...files.get(base.sha), ...Object.fromEntries(tree.map((item) => [item.path, item.content])) }
        const sha = `tree-${trees.size}`
        trees.set(sha, snapshot)
        return { data: { sha } }
      },
      createCommit: async (parameters) => {
        calls.createCommit.push(parameters)
        const sha = `release-${calls.createCommit.length}`
        commits.set(sha, {
          sha, parents: parameters.parents.map((parent) => ({ sha: parent })),
          files: PATHS.map((filename) => ({ filename })),
          commit: { message: parameters.message, tree: { sha: parameters.tree } },
        })
        files.set(sha, trees.get(parameters.tree))
        return { data: { sha } }
      },
      updateRef: async (parameters) => {
        calls.updateRef.push(parameters)
        fixture.beforeUpdate()
        if (commits.get(parameters.sha).parents[0].sha !== refs.get(parameters.ref).sha) {
          throw Object.assign(new Error('Update is not a fast forward'), { status: 422 })
        }
        refs.set(parameters.ref, { sha: parameters.sha, type: 'commit' })
        return { data: {} }
      },
    },
  } }
  const context = {
    repo: { owner: 'team-reflect', repo: 'local-brain' },
    eventName: 'workflow_run',
    ref: 'refs/heads/master',
    payload: { workflow_run: { id: 99 } },
  }
  const core = { notice: () => {}, warning: (message) => warnings.push(message) }
  return Object.assign(fixture, {
    github, context,
    run: (bump) => prepareRelease({ github, context, core, bump }),
    publish: (result, draft = false) => {
      refs.set(`tags/v${result.version}`, { sha: result.releaseRef, type: 'commit' })
      releases.set(`v${result.version}`, { draft })
      if (!draft && !result.version.includes('-')) fixture.latest = `v${result.version}`
    },
  })
}

test('version edits preserve nested version fields and dependency versions', () => {
  const files = versionFiles('0.1.18')
  const updated = updateVersionFiles(files, '0.1.19')
  assert.equal(readVersionFiles(updated), '0.1.19')
  assert.match(updated[PATHS[0]], /"metadata": \{ "version": "0\.1\.18" \}/)
  assert.match(updated[PATHS[1]], /fixture = \{ version = "0\.1\.18" \}/)
  assert.match(updated[PATHS[2]], /name = "fixture"\nversion = "0\.1\.18"/)
  files[PATHS[1]] = files[PATHS[1]].replace('version = "0.1.18"', 'version = "0.1.17"')
  assert.throws(() => updateVersionFiles(files, '0.1.19'), /out of sync/)
})

test('successful master CI bumps and returns the exact version commit without needing the old release', async () => {
  const fixture = scenario()
  const result = await fixture.run()
  assert.deepEqual(result, { releaseNeeded: true, releaseRef: 'release-1', version: '0.1.19' })
  assert.equal(fixture.refs.get('heads/master').sha, result.releaseRef)
  assert.equal(readVersionFiles(fixture.files.get(result.releaseRef)), '0.1.19')
  assert.deepEqual(fixture.calls.createCommit[0].parents, ['source'])
  assert.equal(fixture.calls.ci[0].head_sha, 'source')
  assert.equal(fixture.calls.updateRef[0].force, false)
})

test('old CI notifications reconcile the newest master, with CI required for that exact SHA', async () => {
  const fixture = scenario()
  fixture.refs.set('heads/master', { sha: 'new-source', type: 'commit' })
  fixture.files.set('new-source', versionFiles('0.1.18'))
  fixture.commits.set('new-source', { ...fixture.commits.get('source'), sha: 'new-source' })
  assert.deepEqual(await fixture.run(), { releaseNeeded: false })
  assert.equal(fixture.calls.createCommit.length, 0)
  fixture.runs.set('new-source', [ciRun('new-source')])
  assert.equal((await fixture.run()).releaseNeeded, true)
  assert.deepEqual(fixture.calls.createCommit[0].parents, ['new-source'])
})

test('failed, pending, foreign, and PR CI cannot authorize publishing', async () => {
  for (const overrides of [
    { conclusion: 'failure' },
    { status: 'in_progress', conclusion: null },
    { event: 'pull_request' },
    { path: '.github/workflows/another.yml' },
    { head_branch: 'feature' },
    { head_repository: { full_name: 'someone/fork' } },
  ]) {
    const fixture = scenario()
    fixture.triggeringRun = ciRun('source', overrides)
    assert.deepEqual(await fixture.run(), { releaseNeeded: false })
    assert.equal(fixture.calls.createCommit.length, 0)
  }
})

test('latest unsuccessful CI supersedes an older green run on the same source', async () => {
  const fixture = scenario()
  fixture.runs.set('source', [ciRun('source', { conclusion: 'failure' }), ciRun()])
  assert.deepEqual(await fixture.run(), { releaseNeeded: false })
  assert.equal(fixture.calls.createCommit.length, 0)
})

test('a concurrent master merge cannot be overwritten by a version commit', async () => {
  const fixture = scenario()
  fixture.beforeUpdate = () => fixture.refs.set('heads/master', { sha: 'concurrent-merge', type: 'commit' })
  await assert.rejects(fixture.run(), /not a fast forward/)
  assert.equal(fixture.refs.get('heads/master').sha, 'concurrent-merge')
})

test('retry before publishing reuses the version and source instead of bumping again', async () => {
  const fixture = scenario()
  const result = await fixture.run()
  assert.deepEqual(await fixture.run(), result)
  assert.equal(fixture.calls.createCommit.length, 1)
  assert.equal(fixture.calls.ci.at(-1).head_sha, 'source')
  fixture.publish(result)
  assert.deepEqual(await fixture.run(), { releaseNeeded: false })
  assert.equal(fixture.calls.createCommit.length, 1)
})

test('a draft stops retries until it is finished or deleted', async () => {
  const fixture = scenario()
  const result = await fixture.run()
  fixture.publish(result, true)
  await assert.rejects(fixture.run(), /already has a draft/)
})

test('retry rejects a tag that points to another commit, including published releases', async () => {
  for (const published of [false, true]) {
    const fixture = scenario()
    const result = await fixture.run()
    if (published) fixture.publish(result)
    fixture.refs.set('tags/v0.1.19', { sha: 'wrong', type: 'commit' })
    await assert.rejects(fixture.run(), /points to wrong/)
  }
})

test('retry accepts a matching annotated tag but never republishes an existing release', async () => {
  const fixture = scenario()
  const result = await fixture.run()
  fixture.refs.set('tags/v0.1.19', { sha: 'tag-object', type: 'tag' })
  assert.deepEqual(await fixture.run(), result)
  fixture.releases.set('v0.1.19', { draft: false })
  assert.deepEqual(await fixture.run(), { releaseNeeded: false })
})

test('a version-only marker cannot hide code or configuration edits on retry', async () => {
  for (const tamper of [
    (fixture) => fixture.commits.get('release-1').files.push({ filename: 'app.ts' }),
    (fixture) => { fixture.files.get('release-1')[PATHS[0]] += ' '; },
    (fixture) => { fixture.commits.get('release-1').parents = [{ sha: 'other' }]; },
  ]) {
    const fixture = scenario()
    await fixture.run()
    tamper(fixture)
    await assert.rejects(fixture.run(), /only the three exact version edits|sole parent/)
  }
})

test('manual requests require master and green CI; minor and beta promotions still work', async () => {
  const fixture = scenario()
  fixture.context.eventName = 'workflow_dispatch'
  fixture.context.ref = 'refs/heads/feature'
  await assert.rejects(fixture.run('minor'), /manual master dispatch/)
  fixture.context.ref = 'refs/heads/master'
  const minor = await fixture.run('minor')
  assert.equal(minor.version, '0.2.0')
  await assert.rejects(fixture.run('preminor'), /Publish pending/)
  fixture.publish(minor)
  const beta = await fixture.run('preminor')
  assert.equal(beta.version, '0.3.0-beta.1')
  fixture.publish(beta)
  const stable = await fixture.run('stable')
  assert.equal(stable.version, '0.3.0')
  assert.deepEqual(await fixture.run('0.3.0'), stable)
  assert.equal(fixture.calls.ci.at(-1).head_sha, 'source')
})

test('defaults advance beta releases without promoting stable', async () => {
  const fixture = scenario('0.2.0-beta.4')
  assert.equal((await fixture.run()).version, '0.2.0-beta.5')
})

test('a manual version choice is never silently lost while source CI is pending', async () => {
  const fixture = scenario()
  fixture.context.eventName = 'workflow_dispatch'
  fixture.runs.set('source', [ciRun('source', { status: 'in_progress', conclusion: null })])
  await assert.rejects(fixture.run('minor'), /rerun the release request after CI passes/)
  assert.equal(fixture.calls.createCommit.length, 0)
})

test('existing targets, rollbacks, and newer published stable versions are rejected', async () => {
  const existing = scenario()
  existing.refs.set('tags/v0.1.19', { sha: 'existing', type: 'commit' })
  await assert.rejects(existing.run(), /already has a tag or release/)
  const fixture = scenario()
  await assert.rejects(fixture.run('0.1.17'), /must be newer/)
  fixture.latest = 'v0.1.20'
  await assert.rejects(fixture.run(), /newer than the latest published/)
})

test('a retry cannot move the stable updater feed back after a newer release', async () => {
  const fixture = scenario()
  await fixture.run()
  fixture.latest = 'v0.1.20'
  assert.deepEqual(await fixture.run(), { releaseNeeded: false })
})
