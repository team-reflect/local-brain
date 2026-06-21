import type { ReactNode } from 'react'
import type { Route } from '../routing/route'
import { TodaySurface } from '../surfaces/today'
import { TasksSurface } from '../surfaces/tasks'
import { NetworkSurface } from '../surfaces/network'
import { ProjectsSurface } from '../surfaces/projects'
import { ChatSurface } from '../surfaces/chat'
import { SettingsSurface } from '../surfaces/settings'
import { ProjectDetail } from '../surfaces/detail/project'
import { TaskDetail } from '../surfaces/detail/task'
import { DocumentDetail } from '../surfaces/detail/document'
import { InteractionDetail } from '../surfaces/detail/interaction'
import { AssetDetail } from '../surfaces/detail/asset'

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
    case 'chat':
      return <ChatSurface conversationId={route.conversationId} />
    case 'person':
      return <NetworkSurface tab="people" detail={{ kind: 'person', id: route.id }} />
    case 'organization':
      return <NetworkSurface tab="organizations" detail={{ kind: 'organization', id: route.id }} />
    case 'project':
      return <ProjectDetail id={route.id} />
    case 'task':
      return <TaskDetail id={route.id} />
    case 'document':
      return <DocumentDetail id={route.id} />
    case 'interaction':
      return <InteractionDetail id={route.id} />
    case 'asset':
      return <AssetDetail id={route.id} />
    case 'settings':
      return <SettingsSurface section={route.section} />
  }
}
