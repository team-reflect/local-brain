import { expect, test } from 'vitest'

import { createReleaseArgs, updaterManifest } from './release-macos.mjs'

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

test('updater manifest can target a GitHub API asset URL for private releases', () => {
  expect(
    updaterManifest({
      version: '0.2.0',
      signature: 'minisign-signature',
      url: 'https://api.github.com/repos/team-reflect/local-brain/releases/assets/123',
      pubDate: '2026-06-23T21:00:00.000Z',
      arch: 'aarch64',
    }),
  ).toEqual({
    version: '0.2.0',
    pub_date: '2026-06-23T21:00:00.000Z',
    platforms: {
      'darwin-aarch64': {
        signature: 'minisign-signature',
        url: 'https://api.github.com/repos/team-reflect/local-brain/releases/assets/123',
      },
    },
  })
})
