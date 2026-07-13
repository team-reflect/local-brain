import { expect, test } from 'vitest'

import {
  computeNextVersion,
  formatVersion,
  parseVersion,
  selectReleaseCommit,
  workflowDispatchArgs,
} from './release-bump.mjs'

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
