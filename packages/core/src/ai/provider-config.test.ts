import { describe, expect, it } from 'vitest'
import type { AiProviderConfig } from '../domains/settings/model'
import {
  aiKeySecretName,
  apiKeyHint,
  defaultAiProvider,
  withAiProviderAdded,
  withAiProviderRemoved,
} from './provider-config'

function config(overrides: Partial<AiProviderConfig>): AiProviderConfig {
  return {
    id: 'cfg-a',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    keyHint: 'abcde',
    ...overrides,
  }
}

describe('AI provider config', () => {
  it('keeps only a safe trailing key hint', () => {
    expect(apiKeyHint('sk-short')).toBe('')
    expect(apiKeyHint('sk-ant-1234567890')).toBe('67890')
  })

  it('adds the first provider as default and resolves dangling defaults', () => {
    const state = withAiProviderAdded(
      { providers: [], defaultProviderId: null },
      config({ id: 'cfg-a' }),
      false,
    )
    expect(state.defaultProviderId).toBe('cfg-a')
    expect(defaultAiProvider({ ...state, defaultProviderId: 'missing' })?.id).toBe('cfg-a')
  })

  it('removes the default provider and promotes the first remaining entry', () => {
    const state = {
      providers: [config({ id: 'cfg-a' }), config({ id: 'cfg-b', provider: 'openai' })],
      defaultProviderId: 'cfg-a',
    }
    expect(withAiProviderRemoved(state, 'cfg-a')).toMatchObject({
      defaultProviderId: 'cfg-b',
      providers: [{ id: 'cfg-b' }],
    })
  })

  it('addresses keychain secrets by configured entry id', () => {
    expect(aiKeySecretName('cfg-a')).toBe('ai-api-key:cfg-a')
  })
})
