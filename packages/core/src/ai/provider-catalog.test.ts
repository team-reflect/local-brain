import { describe, expect, it } from 'vitest'
import { aiProvider, modelContextWindow } from './provider-catalog'

describe('AI provider catalog', () => {
  it('offers the GPT-5.6 family and defaults new OpenAI configs to the Sol alias', () => {
    expect(aiProvider('openai').models.slice(0, 3)).toEqual([
      { id: 'gpt-5.6', label: 'GPT-5.6 Sol', contextWindow: 1_050_000 },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', contextWindow: 1_050_000 },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', contextWindow: 1_050_000 },
    ])
  })

  it('uses the documented GPT-5.6 context window for token budgeting', () => {
    expect(modelContextWindow('openai', 'gpt-5.6')).toBe(1_050_000)
    expect(modelContextWindow('openai', 'gpt-5.6-terra')).toBe(1_050_000)
    expect(modelContextWindow('openai', 'gpt-5.6-luna')).toBe(1_050_000)
  })
})
