import { expect, test } from 'vitest'

import { createReleaseArgs } from './release-macos.mjs'

const baseInput = {
  assets: ['Local Brain.dmg', 'Local Brain.app.tar.gz', 'Local Brain.app.tar.gz.sig', 'latest.json'],
  commit: 'abc123',
  draft: false,
  productName: 'Local Brain',
}

test('pre-release publish opts out of GitHub latest heuristics', () => {
  const args = createReleaseArgs({
    ...baseInput,
    prerelease: true,
    tag: 'v0.2.0-beta.14',
    version: '0.2.0-beta.14',
  })

  expect(args).toEqual([
    'release',
    'create',
    'v0.2.0-beta.14',
    'Local Brain.dmg',
    'Local Brain.app.tar.gz',
    'Local Brain.app.tar.gz.sig',
    'latest.json',
    '--title',
    'Local Brain 0.2.0-beta.14',
    '--target',
    'abc123',
    '--generate-notes',
    '--prerelease',
    '--latest=false',
  ])
})

test('stable publish marks the release as latest', () => {
  const args = createReleaseArgs({
    ...baseInput,
    prerelease: false,
    tag: 'v0.2.0',
    version: '0.2.0',
  })

  expect(args).toContain('--latest')
  expect(args).not.toContain('--prerelease')
  expect(args).not.toContain('--latest=false')
})

test('draft publish keeps the draft flag last', () => {
  const args = createReleaseArgs({
    ...baseInput,
    draft: true,
    prerelease: true,
    tag: 'v0.2.0-beta.15',
    version: '0.2.0-beta.15',
  })

  expect(args.at(-1)).toBe('--draft')
})
