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
