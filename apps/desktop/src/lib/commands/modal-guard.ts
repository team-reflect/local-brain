/**
 * A tiny reference-counted registry of open *blocking* modals — currently the
 * first-run onboarding overlay. Global keyboard shortcuts consult
 * {@link blockingModalOpen} so they do not fire (⌘K, navigation, add, …) while a
 * modal owns the screen, matching the modal's pointer blocking for keyboard users.
 */
let openCount = 0

/** Register a blocking modal as open; call the returned function once to release. */
export function pushBlockingModal(): () => void {
  openCount += 1
  let released = false
  return () => {
    if (released) return
    released = true
    openCount = Math.max(0, openCount - 1)
  }
}

/** Whether any blocking modal is currently open. */
export function blockingModalOpen(): boolean {
  return openCount > 0
}
