import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { setBridge } from '@local-brain/core'
import { render, type RenderResult } from '@testing-library/react'
import { RouterProvider } from '../routing/router'
import { ThemeProvider } from '../providers/theme-provider'
import { UpdateProvider } from '../providers/update-provider'

export interface FakeBridgeOptions {
  /** Rows returned for every `db_query` (default: none). */
  queryRows?: unknown[]
  /** Per-query rows, chosen from the compiled SQL — overrides `queryRows`. */
  query?: (sql: string, params: unknown[]) => Promise<unknown[]> | unknown[]
  /**
   * Answer specific non-db commands (e.g. `active_brain`, `list_brains`). Return
   * `undefined` to fall through to the built-in defaults.
   */
  respond?: (command: string, args: Record<string, unknown>) => unknown
}

/**
 * Install an in-memory IPC bridge for component tests: `db_query` returns the
 * supplied rows (optionally per-SQL), writes report one affected row, and
 * `app_version` returns a stub. Mirrors the shape the real Tauri bridge speaks
 * so hooks resolve.
 */
export function installFakeBridge(options: FakeBridgeOptions = {}): void {
  setBridge({
    invoke: (command, args) => {
      if (options.respond) {
        const answer = options.respond(command, args)
        if (answer !== undefined) return Promise.resolve(answer)
      }
      switch (command) {
        case 'db_query': {
          if (options.query) {
            const sql = String(args['sql'] ?? '')
            const params = (args['params'] as unknown[]) ?? []
            return Promise.resolve(options.query(sql, params))
          }
          return Promise.resolve(options.queryRows ?? [])
        }
        case 'db_execute':
          return Promise.resolve(1)
        case 'db_batch':
          return Promise.resolve(((args['statements'] as unknown[]) ?? []).map(() => 1))
        case 'active_database_identity':
        case 'embed_database_identity':
          return Promise.resolve({ databasePath: '/test/brain.sqlite', generation: 1 })
        case 'app_version':
          return Promise.resolve({ name: 'Local Brain', version: '0.1.0', platform: 'test' })
        case 'cli_status':
          return Promise.resolve({
            supported: true,
            bundledPath: '/Applications/Local Brain.app/Contents/MacOS/brain',
            bundledVersion: 'brain 0.1.0',
            installTargetPath: '/Users/alex/.local/bin/brain',
            installTargetDir: '/Users/alex/.local/bin',
            targetDirOnPath: true,
            installedPath: null,
            installedVersion: null,
            installState: 'missing',
          })
        case 'cli_install':
          return Promise.resolve({
            supported: true,
            bundledPath: '/Applications/Local Brain.app/Contents/MacOS/brain',
            bundledVersion: 'brain 0.1.0',
            installTargetPath: '/Users/alex/.local/bin/brain',
            installTargetDir: '/Users/alex/.local/bin',
            targetDirOnPath: true,
            installedPath: '/Applications/Local Brain.app/Contents/MacOS/brain',
            installedVersion: 'brain 0.1.0',
            installState: 'current',
          })
        case 'cli_uninstall':
          return Promise.resolve({
            supported: true,
            bundledPath: '/Applications/Local Brain.app/Contents/MacOS/brain',
            bundledVersion: 'brain 0.1.0',
            installTargetPath: '/Users/alex/.local/bin/brain',
            installTargetDir: '/Users/alex/.local/bin',
            targetDirOnPath: true,
            installedPath: null,
            installedVersion: null,
            installState: 'missing',
          })
        case 'skill_status':
          return Promise.resolve({
            supported: true,
            installTargetDir: '/Users/alex/.agents/skills',
            installState: 'missing',
            skills: [
              {
                id: 'brain',
                installTargetDir: '/Users/alex/.agents/skills/brain',
                bundledHash: 'abc123abc123abc123',
                installedHash: null,
                installState: 'missing',
              },
              {
                id: 'brain-backfill',
                installTargetDir: '/Users/alex/.agents/skills/brain-backfill',
                bundledHash: 'def456def456def456',
                installedHash: null,
                installState: 'missing',
              },
            ],
          })
        case 'skill_install':
          return Promise.resolve({
            supported: true,
            installTargetDir: '/Users/alex/.agents/skills',
            installState: 'current',
            skills: [
              {
                id: 'brain',
                installTargetDir: '/Users/alex/.agents/skills/brain',
                bundledHash: 'abc123abc123abc123',
                installedHash: 'abc123abc123abc123',
                installState: 'current',
              },
              {
                id: 'brain-backfill',
                installTargetDir: '/Users/alex/.agents/skills/brain-backfill',
                bundledHash: 'def456def456def456',
                installedHash: 'def456def456def456',
                installState: 'current',
              },
            ],
          })
        case 'skill_uninstall':
          return Promise.resolve({
            supported: true,
            installTargetDir: '/Users/alex/.agents/skills',
            installState: 'missing',
            skills: [
              {
                id: 'brain',
                installTargetDir: '/Users/alex/.agents/skills/brain',
                bundledHash: 'abc123abc123abc123',
                installedHash: null,
                installState: 'missing',
              },
              {
                id: 'brain-backfill',
                installTargetDir: '/Users/alex/.agents/skills/brain-backfill',
                bundledHash: 'def456def456def456',
                installedHash: null,
                installState: 'missing',
              },
            ],
          })
        default:
          return Promise.resolve(null)
      }
    },
  })
}

function Providers({ children }: { children: ReactNode }): ReactElement {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <UpdateProvider autoCheck={false}>
          <RouterProvider>{children}</RouterProvider>
        </UpdateProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

/** Render a component inside the query + router providers used by the app. */
export function renderWithProviders(ui: ReactElement): RenderResult {
  return render(<Providers>{ui}</Providers>)
}
