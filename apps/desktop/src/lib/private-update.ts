import { call } from '@local-brain/core'
import { Update } from '@tauri-apps/plugin-updater'
import { z } from 'zod'

const privateUpdateMetadataSchema = z.object({
  rid: z.number(),
  currentVersion: z.string(),
  version: z.string(),
  date: z.string().optional(),
  body: z.string().optional(),
  rawJson: z.record(z.string(), z.unknown()),
})

const GITHUB_API_VERSION = '2022-11-28'
const GITHUB_UPDATER_TOKEN = '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'

export function privateGithubUpdateHeaders(): HeadersInit {
  return {
    Accept: 'application/octet-stream',
    Authorization: `Bearer ${GITHUB_UPDATER_TOKEN}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  }
}

export async function checkPrivateGithubUpdate(): Promise<Update | null> {
  const metadata = await call('github_private_update_check', {}, privateUpdateMetadataSchema.nullable())
  if (!metadata) return null
  return new Update({
    rid: metadata.rid,
    currentVersion: metadata.currentVersion,
    version: metadata.version,
    rawJson: metadata.rawJson,
    ...(metadata.date === undefined ? {} : { date: metadata.date }),
    ...(metadata.body === undefined ? {} : { body: metadata.body }),
  })
}
