/**
 * The BYOK / local-model boundary seam (Plan 06, step 11).
 *
 * Local Brain never bundles a model. A {@link ModelProvider} is registered at
 * runtime — the desktop app wires one backed by a keychain-stored provider key
 * (Plan 08), and tests register a mock. When no provider is registered, the
 * model-backed extractor is a no-op.
 * Nothing here fakes a model with heuristics.
 *
 * All external-model context is assembled through the single typed helper in
 * `context.ts`, so unchecked text cannot reach a provider by accident.
 */

export interface ModelMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ModelRequest {
  /** System instruction; the only place product framing belongs. */
  system: string
  messages: ModelMessage[]
  maxTokens?: number
  temperature?: number
}

export interface ModelUsage {
  inputTokens?: number
  outputTokens?: number
}

export interface ModelCompletion {
  text: string
  /** The concrete model id that produced the text (for chat-message metadata). */
  model: string
  usage?: ModelUsage
}

export interface ModelProvider {
  /** Stable provider id, e.g. `anthropic`, `openai`, `local`. */
  id: string
  label: string
  /** Default model id this provider calls. */
  model: string
  /** Can the provider make a call right now (e.g. a key is present)? */
  isAvailable(): boolean | Promise<boolean>
  generate(request: ModelRequest): Promise<ModelCompletion>
}

let provider: ModelProvider | null = null

/** Register (or clear, with `null`) the active model provider. */
export function setModelProvider(next: ModelProvider | null): void {
  provider = next
}

export function getModelProvider(): ModelProvider | null {
  return provider
}
