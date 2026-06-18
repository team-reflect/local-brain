import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { App } from './App'
import { registerAppCommands } from './lib/commands/app-commands'
import { installModel } from './lib/ai/install-model'
import { installTauriBridge } from './lib/ipc/tauri-bridge'
import { queryClient } from './lib/query-client'
import './app/globals.css'

installTauriBridge()
registerAppCommands()
installModel()

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element #root was not found')
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
