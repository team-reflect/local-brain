import { z } from 'zod'
import { call } from './invoke'

/**
 * Foundation-only diagnostic command. Proves the typed IPC path end to end:
 * Rust `app_version` returns a struct, the response is validated here, and no
 * component touches `invoke` directly. Real domain bindings arrive with Plan 02.
 */
const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
})

export type AppInfo = z.infer<typeof appInfoSchema>

export function appVersion(): Promise<AppInfo> {
  return call('app_version', {}, appInfoSchema)
}
