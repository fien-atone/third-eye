/**
 * Client hooks for the agent-registry feature. Thin wrappers over the
 * server API; one hook per endpoint so the invalidation surface stays
 * obvious.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiGet, apiPut, apiDelete, apiPost } from '../api'

export type DetectedRole = {
  rawRole: string
  confidence: string
  sessions: number
  tokens: number
  cost: number
  registered: boolean
  displayName: string | null
  enabled: boolean | null
  mergedInto: string | null
}

export type DetectedResponse = {
  project: { id: string; key: string }
  detected: DetectedRole[]
  unclassified: number
  configured: boolean
}

const KEY_DETECTED = (pid: string) => ['agents', 'detected', pid] as const
const KEY_UNCLASSIFIED_GLOBAL = ['agents', 'unclassified-global'] as const

export function useUnclassifiedGlobal() {
  return useQuery<{ count: number; anyConfigured: boolean }>({
    queryKey: KEY_UNCLASSIFIED_GLOBAL,
    queryFn: () => apiGet<{ count: number; anyConfigured: boolean }>('/api/agents/unclassified-global'),
  })
}

export function useDetectedRoles(projectId: string | null) {
  return useQuery<DetectedResponse>({
    queryKey: KEY_DETECTED(projectId ?? ''),
    queryFn: () => apiGet<DetectedResponse>(`/api/agents/${encodeURIComponent(projectId!)}/detected`),
    enabled: !!projectId,
  })
}

export function useUpsertRole(projectId: string) {
  const qc = useQueryClient()
  return useMutation<
    { row: unknown }, Error,
    { rawRole: string; displayName?: string | null; enabled?: boolean; mergedInto?: string | null }
  >({
    mutationFn: input =>
      apiPut(
        `/api/agents/${encodeURIComponent(projectId)}/registry/${encodeURIComponent(input.rawRole)}`,
        input,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_DETECTED(projectId) })
      qc.invalidateQueries({ queryKey: KEY_UNCLASSIFIED_GLOBAL })
    },
  })
}

export function useDeleteRole(projectId: string) {
  const qc = useQueryClient()
  return useMutation<{ ok: true }, Error, { rawRole: string }>({
    mutationFn: ({ rawRole }) =>
      apiDelete(
        `/api/agents/${encodeURIComponent(projectId)}/registry/${encodeURIComponent(rawRole)}`,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_DETECTED(projectId) })
      qc.invalidateQueries({ queryKey: KEY_UNCLASSIFIED_GLOBAL })
    },
  })
}

export function useAcknowledgeAll(projectId: string) {
  const qc = useQueryClient()
  return useMutation<{ acknowledged: number }, Error, void>({
    mutationFn: () =>
      apiPost(`/api/agents/${encodeURIComponent(projectId)}/registry/acknowledge-all`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KEY_DETECTED(projectId) })
      qc.invalidateQueries({ queryKey: KEY_UNCLASSIFIED_GLOBAL })
    },
  })
}
