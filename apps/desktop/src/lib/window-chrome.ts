import { isTauri } from '@tauri-apps/api/core'

/**
 * Whether the window draws content under a transparent macOS title bar
 * (`titleBarStyle: "Overlay"` in tauri.conf.json), with the traffic lights
 * floating over the top-left of the webview.
 */
export const hasMacosTitleBarOverlay: boolean =
  isTauri() &&
  typeof navigator !== 'undefined' &&
  navigator.userAgent.includes('Macintosh') &&
  navigator.maxTouchPoints === 0
