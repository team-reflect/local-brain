import { db } from '../db/client'
import { newId } from '../db/id'
import type { ExtractionResult } from './contracts'
import {
  matchOrganization,
  matchPerson,
  matchProject,
  type OrganizationCandidate,
  type PersonCandidate,
} from './match'
import { loadAffiliationPairs } from './apply-store'
import type { ApplyContext } from './apply-context'
import type { DatabaseIdentity } from '../db/identity'

/**
 * Network-entity appliers for {@link applyExtraction}: people, organizations,
 * projects, and the person↔organization affiliations between them. People and
 * organizations resolve to an existing row or a new one. Projects are manual user
 * structure: extraction may link existing projects, but misses become suggestions
 * and are never written. Below-threshold entities also become suggestions.
 */

export function applyPeople(ctx: ApplyContext, people: ExtractionResult['people']): void {
  for (const person of people) {
    if (!ctx.accepts(person.confidence)) {
      ctx.suggest('person', person.ref, person.fullName, person.confidence)
      continue
    }
    const matchId = matchPerson(person, ctx.candidates.people)
    if (matchId) {
      ctx.resolve(person.ref, 'person', matchId)
      ctx.summary.people.matched++
      continue
    }
    const id = newId()
    ctx.inserts.people.push(
      db.insertInto('people').values({
        id,
        fullName: person.fullName,
        preferredName: person.preferredName ?? null,
        primaryEmail: person.primaryEmail ?? null,
        primaryPhone: person.primaryPhone ?? null,
        headline: person.headline ?? null,
        location: person.location ?? null,
      }),
    )
    // Make the new row matchable so two refs for the same person collapse.
    const candidate: PersonCandidate = {
      id,
      fullName: person.fullName,
      primaryEmail: person.primaryEmail ?? null,
    }
    ctx.candidates.people.push(candidate)
    ctx.resolve(person.ref, 'person', id)
    ctx.summary.people.created++
  }
}

export function applyOrganizations(
  ctx: ApplyContext,
  organizations: ExtractionResult['organizations'],
): void {
  for (const organization of organizations) {
    if (!ctx.accepts(organization.confidence)) {
      ctx.suggest('organization', organization.ref, organization.name, organization.confidence)
      continue
    }
    const matchId = matchOrganization(organization, ctx.candidates.organizations)
    if (matchId) {
      ctx.resolve(organization.ref, 'organization', matchId)
      ctx.summary.organizations.matched++
      continue
    }
    const id = newId()
    ctx.inserts.organizations.push(
      db.insertInto('organizations').values({
        id,
        name: organization.name,
        kind: organization.kind ?? null,
        domain: organization.domain ?? null,
        location: organization.location ?? null,
      }),
    )
    const candidate: OrganizationCandidate = {
      id,
      name: organization.name,
      domain: organization.domain ?? null,
    }
    ctx.candidates.organizations.push(candidate)
    ctx.resolve(organization.ref, 'organization', id)
    ctx.summary.organizations.created++
  }
}

export function applyProjects(ctx: ApplyContext, projects: ExtractionResult['projects']): void {
  for (const project of projects) {
    if (!ctx.accepts(project.confidence)) {
      ctx.suggest('project', project.ref, project.name, project.confidence)
      continue
    }
    const matchId = matchProject(project, ctx.candidates.projects)
    if (matchId) {
      ctx.resolve(project.ref, 'project', matchId)
      ctx.summary.projects.matched++
      continue
    }
    ctx.suggest('project', project.ref, project.name, project.confidence)
  }
}

export async function applyAffiliations(
  ctx: ApplyContext,
  affiliations: ExtractionResult['affiliations'],
  databaseIdentity: DatabaseIdentity,
): Promise<void> {
  const existing = await loadAffiliationPairs(
    [...ctx.resolved.values()].filter((r) => r.type === 'person').map((r) => r.id),
    databaseIdentity,
  )
  for (const affiliation of affiliations) {
    if (!ctx.accepts(affiliation.confidence)) continue
    const person = ctx.resolved.get(affiliation.personRef)
    const organization = ctx.resolved.get(affiliation.organizationRef)
    if (person?.type !== 'person' || organization?.type !== 'organization') continue
    const pairKey = `${person.id}:${organization.id}`
    if (existing.has(pairKey)) continue
    existing.add(pairKey)
    ctx.inserts.affiliations.push(
      db.insertInto('affiliations').values({
        id: newId(),
        personId: person.id,
        organizationId: organization.id,
        title: affiliation.title ?? null,
        role: affiliation.role ?? null,
        isCurrent: affiliation.isCurrent ? 1 : 0,
        startedOn: affiliation.startedOn ?? null,
        endedOn: affiliation.endedOn ?? null,
      }),
    )
    ctx.summary.affiliations.created++
  }
}
