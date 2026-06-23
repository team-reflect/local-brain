import { invoke } from '@tauri-apps/api/core'
import { Update } from '@tauri-apps/plugin-updater'

interface PrivateUpdateMetadata {
  rid: number
  currentVersion: string
  version: string
  date?: string
  body?: string
  rawJson: Record<string, unknown>
}

const GITHUB_API_VERSION = '2022-11-28'
const GITHUB_UPDATER_TOKEN = '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'

export function privateGithubUpdateHeaders(): HeadersInit {
  return {
    Accept: 'application/octet-stream',
    Authorization: `Bearer ${GITHUB_UPDATER_TOKEN}`,
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
  }
}

export async function checkPrivateGithubUpdate(): Promise<Update | null> {
  const metadata = await invoke<PrivateUpdateMetadata | null>('github_private_update_check')
  return metadata ? new Update(metadata) : null
}
