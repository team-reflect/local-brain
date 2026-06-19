import type { ReactNode, ComponentPropsWithoutRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '../../lib/utils'

/** Tailwind-styled component overrides for react-markdown — no raw HTML. */
const components = {
  h1: ({ children }: ComponentPropsWithoutRef<'h1'>) => (
    <h1 className="mt-4 mb-1 text-sm font-semibold leading-5">{children}</h1>
  ),
  h2: ({ children }: ComponentPropsWithoutRef<'h2'>) => (
    <h2 className="mt-3 mb-1 text-sm font-semibold leading-5">{children}</h2>
  ),
  h3: ({ children }: ComponentPropsWithoutRef<'h3'>) => (
    <h3 className="mt-2 mb-0.5 text-sm font-medium leading-5">{children}</h3>
  ),
  p: ({ children }: ComponentPropsWithoutRef<'p'>) => (
    <p className="my-1 leading-6">{children}</p>
  ),
  ul: ({ children }: ComponentPropsWithoutRef<'ul'>) => (
    <ul className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>
  ),
  ol: ({ children }: ComponentPropsWithoutRef<'ol'>) => (
    <ol className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>
  ),
  li: ({ children }: ComponentPropsWithoutRef<'li'>) => (
    <li className="leading-6">{children}</li>
  ),
  code: ({ children, className }: ComponentPropsWithoutRef<'code'>) => {
    const isBlock = typeof className === 'string' && className.startsWith('language-')
    return isBlock ? (
      <code className="block">{children}</code>
    ) : (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>
    )
  },
  pre: ({ children }: ComponentPropsWithoutRef<'pre'>) => (
    <pre className="my-2 overflow-x-auto rounded bg-muted px-3 py-2 font-mono text-xs">{children}</pre>
  ),
  blockquote: ({ children }: ComponentPropsWithoutRef<'blockquote'>) => (
    <blockquote className="my-1 border-l-2 border-muted-foreground/30 pl-3 text-muted-foreground">
      {children}
    </blockquote>
  ),
  strong: ({ children }: ComponentPropsWithoutRef<'strong'>) => (
    <strong className="font-semibold">{children}</strong>
  ),
  em: ({ children }: ComponentPropsWithoutRef<'em'>) => (
    <em className="italic">{children}</em>
  ),
  a: ({ children, href }: ComponentPropsWithoutRef<'a'>) => (
    <a
      href={href}
      className="text-primary underline underline-offset-2"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-2 border-border" />,
}

interface ChatMarkdownProps {
  text: string
  className?: string
}

/**
 * Safe markdown renderer for settled assistant messages. Uses react-markdown
 * with remark-gfm; raw HTML is never enabled so inline `<script>` and other
 * unsafe content is always escaped.
 */
export function ChatMarkdown({ text, className }: ChatMarkdownProps): ReactNode {
  return (
    <div className={cn('text-sm leading-6 text-foreground', className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  )
}
