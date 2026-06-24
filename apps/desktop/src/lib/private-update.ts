import { call } from '@local-brain/core'
import { Update } from '@tauri-apps/plugin-updater'
import { z } from 'zod'

// `date`/`body` are Rust `Option`s that serde serializes as `null` (not
// omitted) when empty - and a Tauri release manifest carries no notes, so an
// available update always arrives with `body: null`. `.nullish()` accepts both
// `null` and `undefined`; `.optional()` rejected `null`, which made every real
// update throw a parse error and fall back to the (always-404) public endpoint.
const privateUpdateMetadataSchema = z.object({
  rid: z.number(),
  currentVersion: z.string(),
  version: z.string(),
  date: z.string().nullish(),
  body: z.string().nullish(),
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
    // `== null` collapses both `null` and `undefined` to "absent".
    ...(metadata.date == null ? {} : { date: metadata.date }),
    ...(metadata.body == null ? {} : { body: metadata.body }),
  })
}
