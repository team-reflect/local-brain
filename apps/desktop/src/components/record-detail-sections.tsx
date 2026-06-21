import type { ReactNode } from 'react'
import type {
  ExternalIdentitySummary,
  OrganizationProfile,
  PersonAffiliation,
  PersonEmail,
  PersonPhone,
  RecordProvenanceSummary,
} from '@local-brain/core'
import { ExternalLink } from 'lucide-react'
import { Badge } from './badge'
import { Section } from './section'
import { metaText, sectionLabel } from '../lib/ui'
import { cn } from '../lib/utils'

interface DetailRow {
  id: string
  title: ReactNode
  subtitle?: ReactNode
  meta?: ReactNode
  body?: ReactNode
}

function trimDate(value: string | null | undefined): string | null {
  if (!value) return null
  return value.includes('T') ? value.slice(0, 10) : value
}

function compact(values: Array<string | null | undefined>, separator = ', '): string | null {
  const text = values.filter((value): value is string => Boolean(value)).join(separator)
  return text || null
}

function normalizeUrl(value: string): string {
  return /^https?:\/\//i.test(value) ? value : `https://${value}`
}

function parseJson(value: string | null): unknown {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function jsonItems(value: string | null): string[] {
  const parsed = parseJson(value)
  if (parsed === null) return []
  if (Array.isArray(parsed)) {
    return parsed
      .map((item) => {
        if (typeof item === 'string') return item
        if (typeof item === 'number' || typeof item === 'boolean') return String(item)
        return JSON.stringify(item)
      })
      .filter((item) => item.length > 0)
  }
  if (typeof parsed === 'object') {
    return Object.entries(parsed)
      .map(([key, item]) => `${key}: ${typeof item === 'string' ? item : JSON.stringify(item)}`)
      .filter((item) => item.length > 0)
  }
  return [String(parsed)]
}

function JsonList({ value }: { value: string | null }): ReactNode {
  const items = jsonItems(value)
  if (items.length === 0) return null
  return (
    <ul className="flex flex-col gap-1">
      {items.map((item) => (
        <li key={item} className="text-sm leading-5 text-foreground">
          {item}
        </li>
      ))}
    </ul>
  )
}

function ExternalAnchor({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return (
    <a
      href={normalizeUrl(href)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-w-0 items-center gap-1 text-foreground underline-offset-2 hover:underline"
    >
      <span className="truncate">{children}</span>
      <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
    </a>
  )
}

export function DetailNote({
  title,
  children,
}: {
  title: string
  children?: string | null
}): ReactNode {
  if (!children) return null
  return (
    <Section title={title}>
      <p className="whitespace-pre-wrap text-sm leading-5 text-foreground">{children}</p>
    </Section>
  )
}

export function DetailLink({ href }: { href?: string | null }): ReactNode {
  if (!href) return '—'
  return <ExternalAnchor href={href}>{href}</ExternalAnchor>
}

export function DetailRows({
  title,
  rows,
}: {
  title: string
  rows: DetailRow[]
}): ReactNode {
  const visible = rows.filter(
    (row) => row.title !== null && row.title !== undefined && row.title !== '',
  )
  if (visible.length === 0) return null
  return (
    <Section title={title}>
      <ul className="divide-y divide-border/70 border-y border-border/70">
        {visible.map((row) => (
          <li key={row.id} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 truncate text-sm text-foreground">{row.title}</div>
                {row.subtitle ? (
                  <div className="shrink-0 text-xs text-muted-foreground">{row.subtitle}</div>
                ) : null}
              </div>
              {row.body ? <div className="mt-1 text-sm leading-5 text-foreground">{row.body}</div> : null}
            </div>
            {row.meta ? <div className={cn('shrink-0 pt-0.5', metaText)}>{row.meta}</div> : null}
          </li>
        ))}
      </ul>
    </Section>
  )
}

export function PersonContactSection({
  emails,
  phones,
}: {
  emails?: PersonEmail[] | undefined
  phones?: PersonPhone[] | undefined
}): ReactNode {
  const rows: DetailRow[] = [
    ...(emails ?? []).map((email) => ({
      id: `email:${email.id}`,
      title: <a href={`mailto:${email.email}`} className="hover:underline">{email.email}</a>,
      subtitle: email.label,
      meta: compact([email.isPrimary ? 'primary' : null, email.sourceId], ' · '),
    })),
    ...(phones ?? []).map((phone) => ({
      id: `phone:${phone.id}`,
      title: phone.phone,
      subtitle: phone.label,
      meta: compact([phone.isPrimary ? 'primary' : null, phone.sourceId], ' · '),
    })),
  ]
  return <DetailRows title="Contact methods" rows={rows} />
}

export function PersonAffiliationsSection({
  affiliations,
}: {
  affiliations?: PersonAffiliation[] | undefined
}): ReactNode {
  const rows =
    affiliations?.map((affiliation) => {
      const title = compact([affiliation.title, affiliation.organizationName], ' at ')
        ?? affiliation.organizationName
        ?? affiliation.title
        ?? '(untitled role)'
      const department = compact([affiliation.department, affiliation.role], ' · ')
      const roleMeta = compact([affiliation.roleFamily, affiliation.seniority], ' · ')
      const dates = compact([trimDate(affiliation.startedOn), trimDate(affiliation.endedOn)], ' → ')
      return {
        id: affiliation.id,
        title,
        subtitle: department,
        meta: dates,
        body: (
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap gap-1.5">
              {affiliation.isCurrent ? <Badge tone="accent">Current</Badge> : null}
              {affiliation.isPrimary ? <Badge>Primary</Badge> : null}
              {roleMeta ? <span className={metaText}>{roleMeta}</span> : null}
            </div>
            {affiliation.notes ? (
              <p className="whitespace-pre-wrap text-sm leading-5 text-foreground">{affiliation.notes}</p>
            ) : null}
            {affiliation.evidenceRefId ? (
              <p className={metaText}>Evidence {affiliation.evidenceRefId}</p>
            ) : null}
          </div>
        ),
      }
    }) ?? []
  return <DetailRows title="Affiliations" rows={rows} />
}

export function ImportantDatesSection({ value }: { value: string | null }): ReactNode {
  const items = jsonItems(value)
  if (items.length === 0) return null
  return (
    <Section title="Important dates">
      <ul className="grid gap-1 text-sm text-foreground">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Section>
  )
}

export function OrganizationProfilesSection({
  profiles,
}: {
  profiles?: OrganizationProfile[] | undefined
}): ReactNode {
  if (!profiles || profiles.length === 0) return null
  const latest = profiles[0]
  if (!latest) return null
  const older = profiles.slice(1)
  const sourceUrls = jsonItems(latest.sourceUrlsJson)
  return (
    <Section title="Research profile">
      <div className="flex flex-col gap-3 border-y border-border/70 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-foreground">
              {latest.canonicalName ?? latest.oneLineDescription ?? 'Organization profile'}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {latest.category ? <Badge>{latest.category}</Badge> : null}
              {latest.model ? <span className={metaText}>{latest.model}</span> : null}
              {older.length > 0 ? <span className={metaText}>{older.length} older</span> : null}
            </div>
          </div>
          {latest.researchedAt ? (
            <div className={cn('shrink-0 pt-0.5', metaText)}>{trimDate(latest.researchedAt)}</div>
          ) : null}
        </div>
        {latest.oneLineDescription ? (
          <p className="text-sm leading-5 text-foreground">{latest.oneLineDescription}</p>
        ) : null}
        {latest.whyItMatters ? (
          <div>
            <p className={sectionLabel}>Why it matters</p>
            <p className="mt-1 text-sm leading-5 text-foreground">{latest.whyItMatters}</p>
          </div>
        ) : null}
        {latest.website ? (
          <div>
            <p className={sectionLabel}>Website</p>
            <div className="mt-1 text-sm"><ExternalAnchor href={latest.website}>{latest.website}</ExternalAnchor></div>
          </div>
        ) : null}
        {latest.offeringsJson ? (
          <div>
            <p className={sectionLabel}>Offerings</p>
            <div className="mt-1"><JsonList value={latest.offeringsJson} /></div>
          </div>
        ) : null}
        {latest.notablePeopleJson ? (
          <div>
            <p className={sectionLabel}>Notable people</p>
            <div className="mt-1"><JsonList value={latest.notablePeopleJson} /></div>
          </div>
        ) : null}
        {latest.suggestedTagsJson ? (
          <div>
            <p className={sectionLabel}>Suggested tags</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {jsonItems(latest.suggestedTagsJson).map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          </div>
        ) : null}
        {latest.reviewFlagsJson ? (
          <div>
            <p className={sectionLabel}>Review flags</p>
            <div className="mt-1"><JsonList value={latest.reviewFlagsJson} /></div>
          </div>
        ) : null}
        {sourceUrls.length > 0 ? (
          <div>
            <p className={sectionLabel}>Sources</p>
            <ul className="mt-1 flex flex-col gap-1 text-sm">
              {sourceUrls.map((url) => (
                <li key={url}><ExternalAnchor href={url}>{url}</ExternalAnchor></li>
              ))}
            </ul>
          </div>
        ) : null}
        {latest.promptFingerprint ? (
          <p className={metaText}>Prompt {latest.promptFingerprint}</p>
        ) : null}
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span className={metaText}>Profile created {trimDate(latest.createdAt)}</span>
          <span className={metaText}>Updated {trimDate(latest.updatedAt)}</span>
        </div>
        {older.length > 0 ? (
          <div>
            <p className={sectionLabel}>Older profiles</p>
            <ul className="mt-1 divide-y divide-border/70 border-y border-border/70">
              {older.map((profile) => (
                <li key={profile.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-sm text-foreground">
                    {profile.canonicalName ?? profile.oneLineDescription ?? 'Organization profile'}
                  </span>
                  <span className={cn('shrink-0', metaText)}>
                    {trimDate(profile.researchedAt) ?? trimDate(profile.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {latest.rawEnrichmentJson ? (
          <details className="text-sm">
            <summary className="cursor-default text-muted-foreground">Raw enrichment</summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-secondary p-2 font-mono text-[11px] leading-4 text-muted-foreground">
              {latest.rawEnrichmentJson}
            </pre>
          </details>
        ) : null}
      </div>
    </Section>
  )
}

export function SourceTrailSection({
  identities,
  provenance,
}: {
  identities?: ExternalIdentitySummary[] | undefined
  provenance?: RecordProvenanceSummary[] | undefined
}): ReactNode {
  const rows: DetailRow[] = [
    ...(provenance ?? []).map((item) => ({
      id: `provenance:${item.id}`,
      title: compact([item.provenanceKind, item.sourceName ?? item.sourceSlug], ' from ')
        ?? item.provenanceKind,
      subtitle: compact([item.externalKind, item.externalId], ' '),
      meta: trimDate(item.importedAt) ?? trimDate(item.createdAt),
      body: (
        <div className="flex flex-col gap-1">
          {item.originalUrl ? <ExternalAnchor href={item.originalUrl}>{item.originalUrl}</ExternalAnchor> : null}
          {item.externalUrl ? <ExternalAnchor href={item.externalUrl}>{item.externalUrl}</ExternalAnchor> : null}
          {item.originalPath ? <span className={metaText}>{item.originalPath}</span> : null}
          {item.model ? <span className={metaText}>{item.model}</span> : null}
          {item.promptFingerprint ? <span className={metaText}>Prompt {item.promptFingerprint}</span> : null}
          {item.metadataJson ? (
            <details>
              <summary className="cursor-default text-muted-foreground">Metadata</summary>
              <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-secondary p-2 font-mono text-[11px] leading-4 text-muted-foreground">
                {item.metadataJson}
              </pre>
            </details>
          ) : null}
        </div>
      ),
    })),
    ...(identities ?? []).map((identity) => ({
      id: `identity:${identity.id}`,
      title: compact([identity.kind, identity.sourceName ?? identity.sourceSlug], ' from ') ?? identity.kind,
      subtitle: identity.externalId,
      meta: trimDate(identity.createdAt),
      body: (
        <div className="flex flex-col gap-1">
          {identity.url ? <ExternalAnchor href={identity.url}>{identity.url}</ExternalAnchor> : null}
          {identity.metadataJson ? (
            <details>
              <summary className="cursor-default text-muted-foreground">Metadata</summary>
              <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-secondary p-2 font-mono text-[11px] leading-4 text-muted-foreground">
                {identity.metadataJson}
              </pre>
            </details>
          ) : null}
        </div>
      ),
    })),
  ]
  return <DetailRows title="Sources" rows={rows} />
}
