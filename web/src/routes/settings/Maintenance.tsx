import { useEffect, useState } from 'react'
import { useOptionalAppContext } from '@/lib/app-context'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'
import {
    useBulkArchive,
    useServerSettings,
    useStorageStats,
    useUpdateServerSettings,
    useVacuum
} from '@/hooks/queries/useSettings'

function formatMB(bytes: number): string {
    if (bytes <= 0) return '0 MB'
    const mb = bytes / 1024 / 1024
    return mb >= 1024 ? `${(mb / 1024).toFixed(2)} GB` : `${mb.toFixed(1)} MB`
}

function PolicyRow(props: {
    label: string
    value: number | null
    placeholder: string
    suffix: string
    onSave: (value: number | null) => void
    isPending: boolean
}) {
    const [draft, setDraft] = useState<string>(props.value === null ? '' : String(props.value))

    useEffect(() => {
        setDraft(props.value === null ? '' : String(props.value))
    }, [props.value])

    const commit = () => {
        if (draft.trim() === '') {
            if (props.value !== null) props.onSave(null)
            return
        }
        const parsed = Number.parseInt(draft, 10)
        if (!Number.isFinite(parsed) || parsed <= 0) {
            setDraft(props.value === null ? '' : String(props.value))
            return
        }
        if (parsed !== props.value) props.onSave(parsed)
    }

    return (
        <div className="flex w-full items-center justify-between gap-3 px-3 py-3">
            <span className="text-[var(--app-fg)]">{props.label}</span>
            <span className="flex items-center gap-2 text-[var(--app-hint)]">
                <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    value={draft}
                    placeholder={props.placeholder}
                    disabled={props.isPending}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commit}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    }}
                    className="w-16 rounded border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1 text-right text-base text-[var(--app-fg)] tabular-nums focus:outline-none focus:ring-2 focus:ring-[var(--app-link)]"
                />
                <span>{props.suffix}</span>
            </span>
        </div>
    )
}

export function MaintenanceSection() {
    const { t } = useTranslation()
    const ctx = useOptionalAppContext()
    const api = ctx?.api ?? null
    const { addToast } = useToast()
    const { data: settings } = useServerSettings(api)
    const { data: stats } = useStorageStats(api)
    const updateMutation = useUpdateServerSettings(api)
    const vacuumMutation = useVacuum(api)
    const bulkArchiveMutation = useBulkArchive(api)

    const handleBulkArchive = async () => {
        const days = settings?.autoArchiveIdleDays ?? 30
        try {
            const result = await bulkArchiveMutation.mutateAsync({ olderThanDays: days })
            addToast({
                title: t('settings.maintenance.archivedToast', { n: result.archived }),
                body: '',
                sessionId: '',
                url: ''
            })
        } catch (error) {
            addToast({
                title: t('settings.maintenance.archiveFailed'),
                body: error instanceof Error ? error.message : '',
                sessionId: '',
                url: ''
            })
        }
    }

    const handleVacuum = async () => {
        try {
            const result = await vacuumMutation.mutateAsync()
            addToast({
                title: t('settings.maintenance.vacuumDone'),
                body: t('settings.maintenance.vacuumDoneBody', { size: formatMB(result.dbBytes) }),
                sessionId: '',
                url: ''
            })
        } catch (error) {
            addToast({
                title: t('settings.maintenance.vacuumFailed'),
                body: error instanceof Error ? error.message : '',
                sessionId: '',
                url: ''
            })
        }
    }

    const baseButtonClass = 'flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-[var(--app-subtle-bg)] disabled:opacity-50 disabled:cursor-not-allowed'

    return (
        <div className="border-b border-[var(--app-divider)]">
            <div className="px-3 py-2 text-xs font-semibold text-[var(--app-hint)] uppercase tracking-wide">
                {t('settings.maintenance.title')}
            </div>

            <PolicyRow
                label={t('settings.maintenance.autoArchiveIdle')}
                value={settings?.autoArchiveIdleDays ?? null}
                placeholder={t('settings.maintenance.off')}
                suffix={t('settings.maintenance.daysSuffix')}
                onSave={(value) => updateMutation.mutate({ autoArchiveIdleDays: value })}
                isPending={updateMutation.isPending}
            />

            <PolicyRow
                label={t('settings.maintenance.autoDeleteArchived')}
                value={settings?.autoDeleteArchivedDays ?? null}
                placeholder={t('settings.maintenance.off')}
                suffix={t('settings.maintenance.daysSuffix')}
                onSave={(value) => updateMutation.mutate({ autoDeleteArchivedDays: value })}
                isPending={updateMutation.isPending}
            />

            <div className="flex w-full items-center justify-between px-3 py-3">
                <span className="text-[var(--app-fg)]">{t('settings.maintenance.dbSize')}</span>
                <span className="text-[var(--app-hint)] tabular-nums">{stats ? formatMB(stats.dbBytes) : '—'}</span>
            </div>
            <div className="flex w-full items-center justify-between px-3 py-3">
                <span className="text-[var(--app-fg)]">{t('settings.maintenance.activeCount')}</span>
                <span className="text-[var(--app-hint)] tabular-nums">{stats?.sessionCount ?? '—'}</span>
            </div>
            <div className="flex w-full items-center justify-between px-3 py-3">
                <span className="text-[var(--app-fg)]">{t('settings.maintenance.archivedCount')}</span>
                <span className="text-[var(--app-hint)] tabular-nums">{stats?.archivedCount ?? '—'}</span>
            </div>

            <button
                type="button"
                onClick={() => { void handleBulkArchive() }}
                disabled={bulkArchiveMutation.isPending}
                className={baseButtonClass}
            >
                <span className="text-[var(--app-fg)]">{t('settings.maintenance.archiveIdleNow')}</span>
                <span className="text-[var(--app-link)]">{bulkArchiveMutation.isPending ? '…' : '→'}</span>
            </button>

            <button
                type="button"
                onClick={() => { void handleVacuum() }}
                disabled={vacuumMutation.isPending}
                className={baseButtonClass}
            >
                <span className="text-[var(--app-fg)]">{t('settings.maintenance.vacuum')}</span>
                <span className="text-[var(--app-link)]">{vacuumMutation.isPending ? '…' : '→'}</span>
            </button>
        </div>
    )
}
