import { expect, test, vi } from 'vitest'

import {
  completeValidatedRelease,
  createReleaseArgs,
  createFinalizeReleaseArgs,
  createUpdaterManifest,
  githubAssetName,
  missingUpdaterAssetUrls,
  releaseAssetUrlForTag,
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

test('release completion validates before publishing', () => {
  const calls = []
  const finalizeResult = { status: 0, stdout: 'published' }
  const result = completeValidatedRelease({
    draft: false,
    manifestPath: '/tmp/latest.json',
    prerelease: false,
    tag: 'v0.2.0',
    verifyRelease: (input) => calls.push(['verify', input]),
    finalizeRelease: (args) => {
      calls.push(['finalize', args])
      return finalizeResult
    },
  })

  expect(calls).toEqual([
    ['verify', { tag: 'v0.2.0', manifestPath: '/tmp/latest.json' }],
    [
      'finalize',
      ['release', 'edit', 'v0.2.0', '--prerelease=false', '--latest', '--draft=false'],
    ],
  ])
  expect(result).toBe(finalizeResult)
})

test('a validation failure prevents release publication', () => {
  const finalizeRelease = vi.fn()
  expect(() =>
    completeValidatedRelease({
      draft: false,
      manifestPath: '/tmp/latest.json',
      prerelease: false,
      tag: 'v0.2.0',
      verifyRelease: () => {
        throw new Error('missing updater asset')
      },
      finalizeRelease,
    }),
  ).toThrow('missing updater asset')
  expect(finalizeRelease).not.toHaveBeenCalled()
})

test('an explicit draft is validated but never published', () => {
  const verifyRelease = vi.fn()
  const finalizeRelease = vi.fn()
  const result = completeValidatedRelease({
    draft: true,
    manifestPath: '/tmp/latest.json',
    prerelease: true,
    tag: 'v0.2.0-beta.15',
    verifyRelease,
    finalizeRelease,
  })

  expect(verifyRelease).toHaveBeenCalledWith({
    tag: 'v0.2.0-beta.15',
    manifestPath: '/tmp/latest.json',
  })
  expect(finalizeRelease).not.toHaveBeenCalled()
  expect(result).toBeNull()
})

test('GitHub asset names replace spaces with dots', () => {
  expect(githubAssetName('Local Brain.app.tar.gz')).toBe('Local.Brain.app.tar.gz')
})

test('draft asset URLs project onto their final tagged release URLs', () => {
  const assetUrl =
    'https://github.com/team-reflect/local-brain/releases/download/untagged-a5ce18f2f46d03af7e68/Local.Brain.app.tar.gz'
  for (const tag of ['v0.2.0', 'v0.2.0+build.1']) {
    expect(releaseAssetUrlForTag({ assetUrl, tag })).toBe(
      `https://github.com/team-reflect/local-brain/releases/download/${tag}/Local.Brain.app.tar.gz`,
    )
  }
})

test('release asset URL projection rejects non-GitHub and malformed asset URLs', () => {
  for (const assetUrl of [
    'https://example.com/team-reflect/local-brain/releases/download/untagged-123/Local.Brain.app.tar.gz',
    'https://github.com/team-reflect/local-brain/releases/download/untagged-123/nested/Local.Brain.app.tar.gz',
    'https://github.com/team-reflect/local-brain/releases/download/untagged-123/Local.Brain.app.tar.gz?token=secret',
    'https://github.com/team-reflect/local-brain/releases/download/v0.1.9/Local.Brain.app.tar.gz',
  ]) {
    expect(releaseAssetUrlForTag({ assetUrl, tag: 'v0.2.0' })).toBeNull()
  }
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
        'https://github.com/team-reflect/local-brain/releases/download/untagged-a5ce18f2f46d03af7e68/Local.Brain.app.tar.gz',
      ],
      tag: 'v0.2.0',
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
        'https://github.com/team-reflect/local-brain/releases/download/untagged-a5ce18f2f46d03af7e68/Local.Brain.app.tar.gz',
      ],
      tag: 'v0.2.0',
    }),
  ).toEqual([brokenUrl])
})

test('release validation rejects updater URLs for the wrong repository or tag', () => {
  const assetUrls = [
    'https://github.com/team-reflect/local-brain/releases/download/untagged-a5ce18f2f46d03af7e68/Local.Brain.app.tar.gz',
  ]
  for (const brokenUrl of [
    'https://github.com/another-org/local-brain/releases/download/v0.2.0/Local.Brain.app.tar.gz',
    'https://github.com/team-reflect/local-brain/releases/download/v0.1.9/Local.Brain.app.tar.gz',
  ]) {
    expect(
      missingUpdaterAssetUrls({
        manifest: {
          platforms: {
            'darwin-aarch64': { signature: 'minisign-signature', url: brokenUrl },
          },
        },
        assetUrls,
        tag: 'v0.2.0',
      }),
    ).toEqual([brokenUrl])
  }
})
