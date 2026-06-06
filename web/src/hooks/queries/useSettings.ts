import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApiClient } from '@/api/client'

export type ServerSettings = {
    autoArchiveIdleDays: number | null
    autoDeleteArchivedDays: number | null
}

export type StorageStats = {
    dbBytes: number
    sessionCount: number
    archivedCount: number
}

const settingsKey = ['serverSettings'] as const
const storageKey = ['storageStats'] as const

export function useServerSettings(api: ApiClient | null) {
    return useQuery({
        queryKey: settingsKey,
        queryFn: async (): Promise<ServerSettings> => {
            if (!api) throw new Error('API unavailable')
            return await api.getServerSettings()
        },
        enabled: Boolean(api),
        staleTime: 30_000
    })
}

export function useUpdateServerSettings(api: ApiClient | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (updates: Partial<ServerSettings>): Promise<ServerSettings> => {
            if (!api) throw new Error('API unavailable')
            return await api.patchServerSettings(updates)
        },
        onSuccess: (data) => {
            queryClient.setQueryData(settingsKey, data)
        }
    })
}

export function useStorageStats(api: ApiClient | null) {
    return useQuery({
        queryKey: storageKey,
        queryFn: async (): Promise<StorageStats> => {
            if (!api) throw new Error('API unavailable')
            return await api.getStorageStats()
        },
        enabled: Boolean(api),
        refetchInterval: 30_000
    })
}

export function useVacuum(api: ApiClient | null) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (): Promise<{ ok: boolean; dbBytes: number }> => {
            if (!api) throw new Error('API unavailable')
            return await api.runVacuum()
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: storageKey })
        }
    })
}
