import type { AiProviderId } from './provider-catalog'

export type ApiKeyValidation = 'valid' | 'invalid' | 'unreachable'

interface KeyProbe {
  url: string
  headers: (key: string) => Record<string, string>
  invalidStatuses: number[]
}

const PROBES: Record<AiProviderId, KeyProbe> = {
  openai: {
    url: 'https://api.openai.com/v1/models',
    headers: (key) => ({ authorization: `Bearer ${key}` }),
    invalidStatuses: [401, 403],
  },
  anthropic: {
    url: 'https://api.anthropic.com/v1/models',
    headers: (key) => ({
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    }),
    invalidStatuses: [401, 403],
  },
  google: {
    url: 'https://generativelanguage.googleapis.com/v1beta/models',
    headers: (key) => ({ 'x-goog-api-key': key }),
    invalidStatuses: [400, 401, 403],
  },
}

export async function validateApiKey(
  provider: AiProviderId,
  apiKey: string,
  fetchFn: typeof fetch = fetch,
): Promise<ApiKeyValidation> {
  const probe = PROBES[provider]
  let response: Response
  try {
    response = await fetchFn(probe.url, { method: 'GET', headers: probe.headers(apiKey) })
  } catch {
    return 'unreachable'
  }
  if (response.ok) return 'valid'
  return probe.invalidStatuses.includes(response.status) ? 'invalid' : 'unreachable'
}
