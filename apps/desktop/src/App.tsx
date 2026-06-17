import { useQuery } from '@tanstack/react-query'
import { appVersion } from '@local-brain/core'

/**
 * Foundation placeholder shell. It exists to prove the typed IPC path end to end
 * — `appVersion()` runs through the `call()` boundary into the Rust
 * `app_version` command — and to anchor the design tokens. The real app shell
 * (sidebar, routes, command palette) arrives in Plan 03.
 */
export function App() {
  const { data, isError } = useQuery({
    queryKey: ['app-version'],
    queryFn: appVersion,
  })

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 p-8">
      <div className="text-center">
        <p className="font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
          Local Brain
        </p>
        <h1 className="mt-1 font-serif text-2xl text-foreground">Foundation scaffold</h1>
      </div>

      <div className="rounded-md border border-border bg-card px-4 py-3 font-mono text-xs text-card-foreground">
        {data ? (
          <span>
            {data.name} v{data.version} · {data.platform}
          </span>
        ) : isError ? (
          <span className="text-destructive">Failed to load app info</span>
        ) : (
          <span className="text-muted-foreground">Loading…</span>
        )}
      </div>
    </main>
  )
}
