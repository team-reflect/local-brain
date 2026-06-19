# Status

Complete. Not blocked.

- Audited the desktop app: FirstRun was the only remaining hand-rolled dialog.
- Extended `ui/dialog.tsx` with a `placement="center"` option (default stays top).
- Rewrote `first-run.tsx` on the shared Dialog primitive; removed the custom
  overlay + ref-driven Tab focus trap. Kept the `pushBlockingModal` guard. Gate is
  non-dismissable (no-op `onOpenChange`; Escape / outside `preventDefault`-ed).
- Extended `first-run.dom.test.tsx`: accessible dialog + title, Escape does not
  dismiss, completion closes via the mutation path.

Verification results are in `final-report.md`.
