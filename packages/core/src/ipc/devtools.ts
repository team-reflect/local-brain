import { z } from 'zod'
import { call } from './invoke'

/**
 * Toggle the native Web Inspector for the calling Tauri window.
 *
 * Hosts without a native shell should gate this with `hasBridge()` before
 * calling; plain-browser dev already has browser DevTools.
 */
export async function toggleDevtools(): Promise<void> {
  await call('toggle_devtools', {}, z.null())
}
