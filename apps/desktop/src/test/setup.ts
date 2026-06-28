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

// jsdom exposes scrollTop but not HTMLElement.scrollTo. shadcn's message
// scroller uses scrollTo for its tested browser behavior, so component tests
// need a tiny DOM-compatible implementation.
if (typeof HTMLElement !== 'undefined' && typeof HTMLElement.prototype.scrollTo === 'undefined') {
  HTMLElement.prototype.scrollTo = function scrollTo(
    optionsOrX?: ScrollToOptions | number,
    maybeY?: number,
  ): void {
    if (typeof optionsOrX === 'number') {
      this.scrollLeft = optionsOrX
      this.scrollTop = maybeY ?? 0
      return
    }

    this.scrollLeft = optionsOrX?.left ?? this.scrollLeft
    this.scrollTop = optionsOrX?.top ?? this.scrollTop
  }
}
