import { setBridge } from '../ipc/bridge'
import type { IpcBridge } from '../ipc/bridge'

/**
 * Shared in-memory IPC bridges for unit tests, so each test file stops
 * re-implementing the same spy. These do not touch a real database — for
 * round-trip tests against real SQLite see `db/sqlite-harness.mjs`.
 */

export interface CapturedCall {
  command: string
  args: Record<string, unknown>
}

/**
 * Install a bridge that records every call and answers the SQLite commands the
 * way the Rust bridge does: `db_query` → `rows`, `db_execute` → 1 affected row,
 * `db_batch` → one affected row per statement, everything else → null. Returns
 * the (growing) list of captured calls.
 */
export function captureDbBridge(rows: unknown[] = []): CapturedCall[] {
  const calls: CapturedCall[] = []
  setBridge({
    invoke: (command, args) => {
      calls.push({ command, args })
      switch (command) {
        case 'db_query':
          return Promise.resolve(rows)
        case 'db_execute':
          return Promise.resolve(1)
        case 'db_batch':
          return Promise.resolve((args['statements'] as unknown[]).map(() => 1))
        case 'active_database_identity':
        case 'embed_database_identity':
          return Promise.resolve({ databasePath: '/test/brain.sqlite', generation: 1 })
        case 'embed_delete':
          return Promise.resolve(0)
        default:
          return Promise.resolve(null)
      }
    },
  })
  return calls
}

/**
 * Install a bridge that records every call and answers *every* command with the
 * one canned `response`. Returns the captured calls for assertions on the
 * command name and args a binding sent.
 */
export function captureBridge(response: unknown = null): CapturedCall[] {
  const calls: CapturedCall[] = []
  setBridge({
    invoke: (command, args) => {
      calls.push({ command, args })
      return Promise.resolve(response)
    },
  })
  return calls
}

/** A non-recording bridge that answers every command with `value`. */
export function bridgeReturning(value: unknown): IpcBridge {
  return { invoke: () => Promise.resolve(value) }
}
