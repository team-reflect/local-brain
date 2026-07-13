import { useEffect } from 'react'
import { pushBlockingModal } from './modal-guard'

/** Suppress global app commands for the lifetime of an open modal. */
export function useBlockingModal(open: boolean): void {
  useEffect(() => {
    if (!open) return undefined
    return pushBlockingModal()
  }, [open])
}
