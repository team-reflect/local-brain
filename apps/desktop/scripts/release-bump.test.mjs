import { expect, test } from 'vitest'

import {
  RELEASE_VERSION_FILE_PATHS,
  compareSemver,
  computeNextVersion,
  formatVersion,
  parseVersion,
  readReleaseVersionFiles,
  selectReleaseCommit,
  workflowDispatchArgs,
} from './release-bump.mjs'

function versionFiles(version) {
  return {
    [RELEASE_VERSION_FILE_PATHS[0]]: JSON.stringify({ version }),
    [RELEASE_VERSION_FILE_PATHS[1]]: `[package]\nname = "local-brain-desktop"\nversion = "${version}"\n`,
    [RELEASE_VERSION_FILE_PATHS[2]]: `[[package]]\nname = "local-brain-desktop"\nversion = "${version}"\n`,
  }
}

test('parseVersion splits a stable and a prerelease version', () => {
  expect(parseVersion('0.2.0')).toEqual({ major: 0, minor: 2, patch: 0, prerelease: null })
  expect(parseVersion('1.4.10-beta.3')).toEqual({ major: 1, minor: 4, patch: 10, prerelease: 'beta.3' })
})

test('parseVersion rejects malformed input', () => {
  expect(() => parseVersion('1.2')).toThrow()
  expect(() => parseVersion('v1.2.3')).toThrow()
  expect(() => parseVersion('1.2.x')).toThrow()
  expect(() => parseVersion('01.2.3')).toThrow()
  expect(() => parseVersion('1.2.3-beta..1')).toThrow()
  expect(() => parseVersion('1.2.3-beta.01')).toThrow()
  expect(() => parseVersion('9007199254740993.0.0')).toThrow(/safely represent/)
})

test('formatVersion round-trips parseVersion', () => {
  for (const version of ['0.0.0', '0.2.0', '1.4.10-beta.3']) {
    expect(formatVersion(parseVersion(version))).toBe(version)
  }
})

test('SemVer prerelease identifiers use ASCII ordering', () => {
  expect(compareSemver('1.0.0-A', '1.0.0-a')).toBeLessThan(0)
  expect(compareSemver('1.0.0-a', '1.0.0-A')).toBeGreaterThan(0)
})

test('release versions must agree across Tauri, Cargo.toml, and Cargo.lock', () => {
  const files = versionFiles('0.2.1')
  expect(readReleaseVersionFiles(files)).toBe('0.2.1')

  files[RELEASE_VERSION_FILE_PATHS[2]] = files[RELEASE_VERSION_FILE_PATHS[2]].replace(
    '0.2.1',
    '0.2.0',
  )
  expect(() => readReleaseVersionFiles(files)).toThrow(/versions are out of sync/i)
})

test('beta increments the prerelease number, including past nine', () => {
  expect(computeNextVersion('0.2.0-beta.1', 'beta')).toBe('0.2.0-beta.2')
  expect(computeNextVersion('0.2.0-beta.9', 'beta')).toBe('0.2.0-beta.10')
})

test('beta defaults are only valid on a prerelease version', () => {
  expect(() => computeNextVersion('0.2.0', 'beta')).toThrow(/already stable/)
})

test('stable drops the prerelease, keeping the base version', () => {
  expect(computeNextVersion('0.2.0-beta.3', 'stable')).toBe('0.2.0')
  expect(() => computeNextVersion('0.2.0', 'stable')).toThrow(/already stable/)
})

test('patch/minor/major bump the component and clear any prerelease', () => {
  expect(computeNextVersion('0.2.0', 'patch')).toBe('0.2.1')
  expect(computeNextVersion('0.2.0', 'minor')).toBe('0.3.0')
  expect(computeNextVersion('0.2.0', 'major')).toBe('1.0.0')
  expect(computeNextVersion('0.2.3-beta.1', 'minor')).toBe('0.3.0')
})

test('prepatch/preminor/premajor open a beta cycle at beta.1', () => {
  expect(computeNextVersion('0.2.0', 'prepatch')).toBe('0.2.1-beta.1')
  expect(computeNextVersion('0.2.0', 'preminor')).toBe('0.3.0-beta.1')
  expect(computeNextVersion('0.2.0', 'premajor')).toBe('1.0.0-beta.1')
})

test('an explicit version target is accepted verbatim', () => {
  expect(computeNextVersion('0.2.0-beta.1', '0.5.0-beta.1')).toBe('0.5.0-beta.1')
  expect(computeNextVersion('0.2.0-beta.1', '1.0.0')).toBe('1.0.0')
})

test('an explicit garbage version is rejected', () => {
  expect(() => computeNextVersion('0.2.0', 'nonsense')).toThrow()
  expect(() => computeNextVersion('0.2.0', '1.2')).toThrow()
})

test('beta on a non-beta prerelease is rejected', () => {
  expect(() => computeNextVersion('0.2.0-rc.1', 'beta')).toThrow(/beta\.N/)
})

test('release requests dispatch the rolling workflow with an explicit target', () => {
  expect(workflowDispatchArgs('0.3.0')).toEqual([
    'workflow',
    'run',
    'release-pr.yml',
    '--ref',
    'master',
    '-f',
    'bump=0.3.0',
  ])
})

test('tag recovery selects the reviewed version transition instead of a newer master commit', () => {
  const versions = {
    feature: '0.2.1',
    release: '0.2.1',
    previous: '0.2.0',
  }
  const parents = { feature: 'release', release: 'previous' }
  const changedPaths = {
    feature: ['apps/desktop/src/main.tsx'],
    release: [
      'Cargo.lock',
      'apps/desktop/src-tauri/Cargo.toml',
      'apps/desktop/src-tauri/tauri.conf.json',
    ],
  }

  expect(
    selectReleaseCommit({
      version: '0.2.1',
      candidates: ['feature', 'release', 'previous'],
      versionAtCommit: (commit) => versions[commit],
      versionAtParent: (commit) => versions[parents[commit]],
      changedPathsAtCommit: (commit) => changedPaths[commit] ?? [],
      isAncestor: () => true,
    }),
  ).toBe('release')
})

test('tag recovery rejects a rollback that reintroduces an older version', () => {
  const versions = {
    rollback: '0.2.0',
    newer: '0.2.1',
    oldRelease: '0.2.0',
    oldParent: '0.1.9',
  }
  const parents = { rollback: 'newer', oldRelease: 'oldParent' }

  expect(() =>
    selectReleaseCommit({
      version: '0.2.0',
      candidates: ['rollback', 'newer', 'oldRelease', 'oldParent'],
      versionAtCommit: (commit) => versions[commit],
      versionAtParent: (commit) => versions[parents[commit]],
      changedPathsAtCommit: () => [...RELEASE_VERSION_FILE_PATHS],
      isAncestor: () => true,
    }),
  ).toThrow(/not a forward version transition/)
})

test('tag recovery does not scan past an inconsistent current-version commit', () => {
  expect(() =>
    selectReleaseCommit({
      version: '0.2.0',
      candidates: ['inconsistent', 'oldRelease'],
      versionAtCommit: (commit) => (commit === 'oldRelease' ? '0.2.0' : null),
      versionAtParent: () => '0.1.9',
      changedPathsAtCommit: () => [...RELEASE_VERSION_FILE_PATHS],
      isAncestor: () => true,
    }),
  ).toThrow(/first release-history commit inconsistent is not synchronized/)
})
