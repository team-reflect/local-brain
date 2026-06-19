// jsdom does not implement ResizeObserver, which Radix UI uses internally (e.g.
// Checkbox indicator sizing). Provide a no-op stub so component tests that
// render Radix primitives don't throw "ResizeObserver is not defined".
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
