import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Node is the default test environment (routing/command/layout unit tests).
// Component render tests opt into jsdom with a `// @vitest-environment jsdom`
// docblock at the top of the file. `globals: true` lets @testing-library/react
// register its automatic per-test cleanup.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
})
