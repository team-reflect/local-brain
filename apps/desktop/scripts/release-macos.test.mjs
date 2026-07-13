import { expect, test } from 'vitest'

import {
  createReleaseArgs,
  createFinalizeReleaseArgs,
  createUpdaterManifest,
  githubAssetName,
  missingUpdaterAssetUrls,
} from './release-macos.mjs'

const baseInput = {
  assets: ['Local Brain.dmg', 'Local Brain.app.tar.gz', 'Local Brain.app.tar.gz.sig', 'latest.json'],
  commit: 'abc123',
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
    '--draft',
  ])
})

test('stable release creation stays draft while marking its eventual channel', () => {
  const args = createReleaseArgs({
    ...baseInput,
    prerelease: false,
    tag: 'v0.2.0',
    version: '0.2.0',
  })

  expect(args).toContain('--latest')
  expect(args).not.toContain('--prerelease')
  expect(args).not.toContain('--latest=false')
  expect(args.at(-1)).toBe('--draft')
})

test('finalizing a stable draft publishes it as latest', () => {
  expect(createFinalizeReleaseArgs({ prerelease: false, tag: 'v0.2.0' })).toEqual([
    'release',
    'edit',
    'v0.2.0',
    '--prerelease=false',
    '--latest',
    '--draft=false',
  ])
})

test('finalizing a prerelease keeps it out of the stable latest channel', () => {
  expect(createFinalizeReleaseArgs({ prerelease: true, tag: 'v0.2.0-beta.15' })).toEqual([
    'release',
    'edit',
    'v0.2.0-beta.15',
    '--prerelease',
    '--latest=false',
    '--draft=false',
  ])
})

test('GitHub asset names replace spaces with dots', () => {
  expect(githubAssetName('Local Brain.app.tar.gz')).toBe('Local.Brain.app.tar.gz')
})

test('updater manifest targets the exact GitHub release asset name', () => {
  const manifest = createUpdaterManifest({
    version: '0.2.0',
    signature: 'minisign-signature',
    slug: 'team-reflect/local-brain',
    tag: 'v0.2.0',
    updaterArchive: '/tmp/Local Brain.app.tar.gz',
    pubDate: '2026-06-23T21:00:00.000Z',
    arch: 'aarch64',
  })

  expect(manifest).toEqual({
    version: '0.2.0',
    pub_date: '2026-06-23T21:00:00.000Z',
    platforms: {
      'darwin-aarch64': {
        signature: 'minisign-signature',
        url: 'https://github.com/team-reflect/local-brain/releases/download/v0.2.0/Local.Brain.app.tar.gz',
      },
    },
  })

  expect(
    missingUpdaterAssetUrls({
      manifest,
      assetUrls: [
        'https://github.com/team-reflect/local-brain/releases/download/v0.2.0/Local.Brain.app.tar.gz',
      ],
    }),
  ).toEqual([])
})

test('release validation reports updater URLs without matching assets', () => {
  const brokenUrl =
    'https://github.com/team-reflect/local-brain/releases/download/v0.2.0/Local%20Brain.app.tar.gz'
  expect(
    missingUpdaterAssetUrls({
      manifest: {
        platforms: {
          'darwin-aarch64': { signature: 'minisign-signature', url: brokenUrl },
        },
      },
      assetUrls: [
        'https://github.com/team-reflect/local-brain/releases/download/v0.2.0/Local.Brain.app.tar.gz',
      ],
    }),
  ).toEqual([brokenUrl])
})
