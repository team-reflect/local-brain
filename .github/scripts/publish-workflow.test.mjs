import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { computeNextVersion } from '../../apps/desktop/scripts/release-bump.mjs'

const workspace = fileURLToPath(new URL('../../', import.meta.url))
const workflow = readFileSync(new URL('../workflows/release.yml', import.meta.url), 'utf8')
const version = '0.1.19'
// Exercise the actual inline workflow guard, so moving or dropping the guard
// cannot leave a passing test for a helper that publishing no longer calls.
const step = workflow.split('      - name: Prevent stable updater rollback\n')[1]
assert.ok(step, 'The publisher must guard the stable feed after acquiring its lock')
const script = step.split('          script: |\n')[1].split('\n      - name:')[0]
  .split('\n').filter((line) => line.startsWith('            ')).map((line) => line.slice(12)).join('\n')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const guard = new AsyncFunction('github', 'context', 'core', 'process', script)

async function runGuard(getLatestRelease, releaseVersion = version) {
  const failures = []
  const directory = mkdtempSync(join(tmpdir(), 'brain-publish-guard-'))
  const previousDirectory = process.cwd()
  try {
    mkdirSync(join(directory, 'apps/desktop/src-tauri'), { recursive: true })
    writeFileSync(join(directory, 'apps/desktop/src-tauri/tauri.conf.json'), JSON.stringify({ version: releaseVersion }))
    process.chdir(directory)
    await guard(
      { rest: { repos: { getLatestRelease } } },
      { repo: { owner: 'team-reflect', repo: 'local-brain' } },
      { setFailed: (message) => failures.push(message) },
      { env: { GITHUB_WORKSPACE: workspace } },
    )
  } finally {
    process.chdir(previousDirectory)
    rmSync(directory, { recursive: true, force: true })
  }
  return failures
}

test('publisher refuses a newer stable version that appeared while waiting for its lock', async () => {
  const failures = await runGuard(async () => ({ data: { tag_name: `v${computeNextVersion(version, 'major')}` } }))
  assert.equal(failures.length, 1)
  assert.match(failures[0], /Refusing to replace/)
})

test('publisher permits an initial release or an unchanged latest version', async () => {
  assert.deepEqual(await runGuard(async () => { throw Object.assign(new Error('Not found'), { status: 404 }) }), [])
  assert.deepEqual(await runGuard(async () => ({ data: { tag_name: `v${version}` } })), [])
})

test('publisher fails closed when it cannot read or parse the latest stable release', async () => {
  await assert.rejects(runGuard(async () => { throw Object.assign(new Error('Forbidden'), { status: 403 }) }), /Forbidden/)
  await assert.rejects(runGuard(async () => ({ data: { tag_name: 'unknown' } })), /not a valid/)
})

test('publisher leaves beta releases outside the stable updater comparison', async () => {
  assert.deepEqual(await runGuard(() => assert.fail('Beta must not read the stable feed'), '0.2.0-beta.1'), [])
})
