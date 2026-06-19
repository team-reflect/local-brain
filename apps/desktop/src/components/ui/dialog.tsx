import type { ComponentProps, ReactNode } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { cn } from '../../lib/utils'

/**
 * Shared modal primitive (shadcn/ui pattern over `radix-ui`'s `Dialog`), matching
 * the existing `popover.tsx` / `dropdown-menu.tsx` wrappers. Centralises the one
 * scrim + elevated-card chrome the app's overlays were each hand-rolling, and —
 * unlike the previous copies — gets focus trap, focus restore on close, scroll
 * lock, Escape, and outside-click dismissal for free from Radix.
 *
 * The card is top-aligned by default (`pt-[12vh]`, the app's historical
 * placement); pass `placement="center"` for vertically centred surfaces such as
 * the blocking first-run gate. Width is left to each consumer's `className`.
 */
function Dialog(props: ComponentProps<typeof DialogPrimitive.Root>): ReactNode {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>): ReactNode {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogClose(props: ComponentProps<typeof DialogPrimitive.Close>): ReactNode {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Overlay>): ReactNode {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-foreground/25 px-4 pt-[12vh] pb-10 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  )
}

/**
 * The dialog card. Rendered inside the overlay so the overlay's flex layout
 * positions it; clicking the overlay (outside the card) closes via Radix.
 */
function DialogContent({
  className,
  children,
  overlayClassName,
  placement = 'top',
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  overlayClassName?: string
  /** Vertical placement within the overlay. Defaults to the app's top alignment. */
  placement?: 'top' | 'center'
}): ReactNode {
  return (
    <DialogPrimitive.Portal data-slot="dialog-portal">
      <DialogOverlay
        className={cn(placement === 'center' && 'items-center pt-10', overlayClassName)}
      >
        <DialogPrimitive.Content
          data-slot="dialog-content"
          className={cn(
            'relative z-50 my-auto flex max-h-full w-full max-w-[92vw] flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-[0_8px_28px_rgba(2,6,23,0.16)] outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogOverlay>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Title>): ReactNode {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-sm font-semibold text-foreground', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>): ReactNode {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
}
