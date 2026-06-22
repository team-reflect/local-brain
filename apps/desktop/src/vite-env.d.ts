/// <reference types="vite/client" />

declare module '*.css'

interface ImportMetaEnv {
  /** Optional dev/demo BYOK key for the Anthropic provider; never persisted. */
  readonly VITE_ANTHROPIC_API_KEY?: string
  /** Tauri CLI build-time platform, absent in plain Vite/test runs. */
  readonly TAURI_ENV_PLATFORM?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
