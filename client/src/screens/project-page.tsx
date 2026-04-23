/** Project detail page — composes the project-specific header (rename
 *  + back-link + key/label) with the shared Dashboard component, and
 *  owns the insights query that only the project view consumes.
 *
 *  Lives here (instead of inlined in App.tsx) so project-only logic
 *  doesn't leak into the global app shell. The home dashboard skips
 *  this entirely and renders <Dashboard inProjectView={false}/> on
 *  the App side. */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Dashboard } from './dashboard'
import { useT } from '../i18n'
import { hrefFor, navigate } from '../router'
import { apiGet, apiPatch, dashboardParams } from '../api'
import type { Granularity, InsightsResponse, OverviewResponse, ProjectInfo } from '../types'
import { toInputDate } from '../lib/format'

type DashboardSharedProps = {
  modelNames: string[]
  granularity: Granularity
  onSelectProject: (key: string) => void
  editing: boolean
  layoutEpoch: number
  onLayoutReset: () => void
}

export function ProjectPage({
  projectId, data, start, end, providersParam, claudeInScope, lookedUpProject, dashboardProps,
}: {
  projectId: string
  data: OverviewResponse
  start: Date
  end: Date
  providersParam: string
  claudeInScope: boolean
  lookedUpProject: ProjectInfo | null
  dashboardProps: DashboardSharedProps
}) {
  const insightsQuery = useQuery<InsightsResponse>({
    queryKey: ['insights', projectId, toInputDate(start), toInputDate(end), providersParam],
    queryFn: () => apiGet<InsightsResponse>(`/api/insights/${projectId}?${dashboardParams({
      start, end, providers: providersParam,
    })}`),
    enabled: !!projectId && claudeInScope,
    placeholderData: keepPreviousData,
  })

  return (
    <>
      {data.frame.project && (
        <ProjectHeader
          projectId={projectId}
          frameProject={data.frame.project}
          lookedUp={lookedUpProject}
        />
      )}
      <Dashboard
        {...dashboardProps}
        data={data}
        inProjectView
        insightsData={claudeInScope ? insightsQuery.data : undefined}
        insightsProjectKey={data.frame.project?.key ?? null}
      />
    </>
  )
}

function ProjectHeader({ projectId, frameProject, lookedUp }: {
  projectId: string
  frameProject: NonNullable<OverviewResponse['frame']['project']>
  lookedUp: ProjectInfo | null
}) {
  const t = useT()
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const isRenamed = lookedUp ? (lookedUp.customLabel != null && lookedUp.customLabel.trim() !== '') : false

  const mutation = useMutation({
    mutationFn: (body: { customLabel: string | null }) =>
      apiPatch<ProjectInfo>(`/api/projects/${projectId}`, body),
    onSuccess: () => {
      // Both the projects list and the overview (which feeds
      // frameProject.label here) carry the project label — refetch both
      // so the rename shows up everywhere immediately.
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })

  const startEdit = () => {
    setValue(lookedUp?.customLabel ?? lookedUp?.autoLabel ?? frameProject.label)
    setEditing(true)
  }
  const save = () => {
    const trimmed = value.trim()
    mutation.mutate({ customLabel: trimmed || null })
    setEditing(false)
  }
  const reset = () => {
    mutation.mutate({ customLabel: null })
    setEditing(false)
  }
  const cancel = () => setEditing(false)

  return (
    <div className="project-header">
      <a
        className="project-header-back"
        href={hrefFor({ name: 'projects' })}
        onClick={e => { e.preventDefault(); navigate({ name: 'projects' }) }}
      >
        <span aria-hidden="true">←</span> {t('nav.projects')}
      </a>
      <h1 className="project-header-title">
        {editing ? (
          <span className="project-header-title-edit">
            <input
              autoFocus
              type="text"
              value={value}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') save()
                else if (e.key === 'Escape') cancel()
              }}
              placeholder={t('projects.editPlaceholder')}
              maxLength={200}
            />
            <button className="btn-save" onClick={save} title={t('projects.save')} aria-label={t('projects.save')}>✓</button>
            <button className="btn-cancel" onClick={cancel} title={t('projects.cancel')} aria-label={t('projects.cancel')}>×</button>
            {isRenamed && (
              <button className="btn-reset" onClick={reset} title={t('projects.reset')} aria-label={t('projects.reset')}>⟲</button>
            )}
          </span>
        ) : (
          <>
            <span className="project-header-title-label">{frameProject.label}</span>
            <button
              className="project-header-rename"
              onClick={startEdit}
              title={t('projects.editTitle')}
              aria-label={t('projects.editTitle')}
            >✎</button>
          </>
        )}
      </h1>
      {isRenamed && !editing && (
        <div className="project-header-sub" title={frameProject.key}>
          <span className="project-header-sub-label">{t('projects.sessionLabel')}:</span>{' '}
          <span className="project-header-sub-value">{frameProject.key}</span>
        </div>
      )}
    </div>
  )
}
