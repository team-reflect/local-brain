import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { registerAppCommands } from './lib/commands/app-commands'
import { installModel } from './lib/ai/install-model'
import { installTauriBridge } from './lib/ipc/tauri-bridge'
import { queryClient } from './lib/query-client'
import { ThemeProvider } from './providers/theme-provider'
import { UpdateProvider } from './providers/update-provider'
import './app/globals.css'

installTauriBridge()
registerAppCommands()
void installModel()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root was not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <UpdateProvider>
          <App />
        </UpdateProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
