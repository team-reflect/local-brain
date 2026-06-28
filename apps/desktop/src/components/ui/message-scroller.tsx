import type { ComponentProps, ReactNode } from 'react'
import { ArrowDown } from 'lucide-react'
import {
  MessageScroller as MessageScrollerPrimitive,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
} from '@shadcn/react/message-scroller'
import { Button } from '../button'
import { cn } from '../../lib/utils'

function MessageScrollerProvider(
  props: ComponentProps<typeof MessageScrollerPrimitive.Provider>,
): ReactNode {
  return <MessageScrollerPrimitive.Provider {...props} />
}

function MessageScroller({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Root>): ReactNode {
  return (
    <MessageScrollerPrimitive.Root
      data-slot="message-scroller"
      className={cn(
        'group/message-scroller relative flex size-full min-h-0 flex-col overflow-hidden',
        className,
      )}
      {...props}
    />
  )
}

function MessageScrollerViewport({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Viewport>): ReactNode {
  return (
    <MessageScrollerPrimitive.Viewport
      data-slot="message-scroller-viewport"
      className={cn(
        'size-full min-h-0 min-w-0 scroll-fade-b scrollbar-thin scrollbar-gutter-stable overflow-y-auto overscroll-contain contain-content data-autoscrolling:scrollbar-none',
        className,
      )}
      {...props}
    />
  )
}

function MessageScrollerContent({
  className,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Content>): ReactNode {
  return (
    <MessageScrollerPrimitive.Content
      data-slot="message-scroller-content"
      className={cn('flex h-max min-h-full flex-col gap-8', className)}
      {...props}
    />
  )
}

function MessageScrollerItem({
  className,
  scrollAnchor = false,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Item>): ReactNode {
  return (
    <MessageScrollerPrimitive.Item
      data-slot="message-scroller-item"
      scrollAnchor={scrollAnchor}
      className={cn(
        'min-w-0 shrink-0 [contain-intrinsic-size:auto_10rem] [content-visibility:auto]',
        className,
      )}
      {...props}
    />
  )
}

function MessageScrollerButton({
  direction = 'end',
  className,
  children,
  render,
  ...props
}: ComponentProps<typeof MessageScrollerPrimitive.Button>): ReactNode {
  return (
    <MessageScrollerPrimitive.Button
      data-slot="message-scroller-button"
      data-direction={direction}
      direction={direction}
      className={cn(
        'absolute left-1/2 -translate-x-1/2 border-border bg-background text-foreground transition-[translate,scale,opacity] duration-200 hover:bg-muted hover:text-foreground data-[active=false]:pointer-events-none data-[active=false]:scale-95 data-[active=false]:opacity-0 data-[active=false]:duration-400 data-[active=false]:ease-[cubic-bezier(0.7,0,0.84,0)] data-[active=true]:translate-y-0 data-[active=true]:scale-100 data-[active=true]:opacity-100 data-[active=true]:ease-[cubic-bezier(0.23,1,0.32,1)] data-[direction=end]:bottom-4 data-[direction=end]:data-[active=false]:translate-y-full data-[direction=start]:top-4 data-[direction=start]:data-[active=false]:-translate-y-full data-[direction=start]:[&_svg]:rotate-180',
        className,
      )}
      render={render ?? <Button variant="outline" size="sm" className="size-7 rounded-md px-0" />}
      {...props}
    >
      {children ?? (
        <>
          <ArrowDown aria-hidden className="size-4" />
          <span className="sr-only">
            {direction === 'end' ? 'Scroll to end' : 'Scroll to start'}
          </span>
        </>
      )}
    </MessageScrollerPrimitive.Button>
  )
}

export {
  MessageScrollerProvider,
  MessageScroller,
  MessageScrollerViewport,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerButton,
  useMessageScroller,
  useMessageScrollerScrollable,
  useMessageScrollerVisibility,
}
