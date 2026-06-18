import type { ReactElement } from 'react'
import { hasMacosTitleBarOverlay } from '../lib/window-chrome'

/**
 * Invisible strip standing in for the macOS title bar when it's overlaid.
 * Tauri's `data-tauri-drag-region` handler makes mousedown drag the window and
 * double-click toggle zoom, matching native title-bar behavior.
 */
export function WindowDragRegion(): ReactElement | null {
  if (!hasMacosTitleBarOverlay) {
    return null
  }
  return <div aria-hidden data-tauri-drag-region className="fixed inset-x-0 top-0 z-40 h-7" />
}
