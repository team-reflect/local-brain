import type { ComponentProps, ReactNode } from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { cn } from '../../lib/utils'

function Command({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive>): ReactNode {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn('flex min-h-0 flex-col overflow-hidden bg-popover text-popover-foreground', className)}
      {...props}
    />
  )
}

function CommandInput({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Input>): ReactNode {
  return (
    <CommandPrimitive.Input
      data-slot="command-input"
      className={cn(
        'w-full bg-transparent py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CommandList({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.List>): ReactNode {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn('max-h-80 overflow-y-auto p-1.5', className)}
      {...props}
    />
  )
}

function CommandEmpty({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Empty>): ReactNode {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className={cn('px-3 py-6 text-center text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Group>): ReactNode {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        'py-1 [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: ComponentProps<typeof CommandPrimitive.Item>): ReactNode {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        'flex cursor-default select-none items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left text-sm text-foreground outline-none transition-colors data-[selected=true]:bg-secondary data-[selected=true]:text-foreground',
        className,
      )}
      {...props}
    />
  )
}

export { Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem }
