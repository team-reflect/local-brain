import type { ReactNode } from 'react'
import type { Route } from '../routing/route'
import { TodaySurface } from '../surfaces/today'
import { TasksSurface } from '../surfaces/tasks'
import { NetworkSurface } from '../surfaces/network'
import { ProjectsSurface } from '../surfaces/projects'
import { GraphSurface } from '../surfaces/graph'
import { AskSurface } from '../surfaces/ask'
import { SettingsSurface } from '../surfaces/settings'
import { PersonDetail } from '../surfaces/detail/person'
import { ProjectDetail } from '../surfaces/detail/project'
import { TaskDetail } from '../surfaces/detail/task'
import { DocumentDetail } from '../surfaces/detail/document'
import { InteractionDetail } from '../surfaces/detail/interaction'
import { OrganizationDetail } from '../surfaces/detail/organization'

/** The single place routes become surfaces. */
export function RouteContent({ route }: { route: Route }): ReactNode {
  switch (route.kind) {
    case 'today':
      return <TodaySurface />
    case 'tasks':
      return <TasksSurface />
    case 'network':
      return <NetworkSurface tab={route.tab} />
    case 'projects':
      return <ProjectsSurface />
    case 'person':
      return <PersonDetail id={route.id} />
    case 'organization':
      return <OrganizationDetail id={route.id} />
    case 'project':
      return <ProjectDetail id={route.id} />
    case 'task':
      return <TaskDetail id={route.id} />
    case 'document':
      return <DocumentDetail id={route.id} />
    case 'interaction':
      return <InteractionDetail id={route.id} />
    case 'graph':
      return <GraphSurface />
    case 'ask':
      return <AskSurface />
    case 'settings':
      return <SettingsSurface />
  }
}
