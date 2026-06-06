import { useEffect, useMemo, useState } from 'react'
import type { SessionSummary } from '@/types/api'
import type { ApiClient } from '@/api/client'
import { useLongPress } from '@/hooks/useLongPress'
import { usePlatform } from '@/hooks/usePlatform'
import { useSessionActions } from '@/hooks/mutations/useSessionActions'
import { SessionActionMenu } from '@/components/SessionActionMenu'
import { RenameSessionDialog } from '@/components/RenameSessionDialog'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { getSessionModelLabel } from '@/lib/sessionModelLabel'
import { useToast } from '@/lib/toast-context'
import { useTranslation } from '@/lib/use-translation'

type SessionGroup = {
    directory: string
    displayName: string
    sessions: SessionSummary[]
    latestUpdatedAt: number
    hasActiveSession: boolean
}

type BucketKey = 'active' | 'recent' | 'thisMonth' | 'older' | 'archived'

const BUCKET_ORDER: BucketKey[] = ['active', 'recent', 'thisMonth', 'older', 'archived']

const BUCKET_DEFAULT_EXPANDED: Record<BucketKey, boolean> = {
    active: true,
    recent: true,
    thisMonth: false,
    older: false,
    archived: false
}

const RECENT_THRESHOLD_MS = 7 * 86_400_000
const THIS_MONTH_THRESHOLD_MS = 30 * 86_400_000

function getBucket(s: SessionSummary, now: number): BucketKey {
    if (s.archivedAt !== null) return 'archived'
    if (s.active) return 'active'
    const ageMs = now - s.updatedAt
    if (ageMs < RECENT_THRESHOLD_MS) return 'recent'
    if (ageMs < THIS_MONTH_THRESHOLD_MS) return 'thisMonth'
    return 'older'
}

function bucketize(sessions: SessionSummary[]): { bucket: BucketKey; groups: SessionGroup[] }[] {
    const now = Date.now()
    const byBucket = new Map<BucketKey, SessionSummary[]>()
    for (const s of sessions) {
        const b = getBucket(s, now)
        const list = byBucket.get(b) ?? []
        list.push(s)
        byBucket.set(b, list)
    }
    const result: { bucket: BucketKey; groups: SessionGroup[] }[] = []
    for (const bucket of BUCKET_ORDER) {
        const items = byBucket.get(bucket)
        if (items && items.length > 0) {
            result.push({ bucket, groups: groupSessionsByDirectory(items) })
        }
    }
    return result
}

function getGroupDisplayName(directory: string): string {
    if (directory === 'Other') return directory
    const parts = directory.split(/[\\/]+/).filter(Boolean)
    if (parts.length === 0) return directory
    if (parts.length === 1) return parts[0]
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`
}

function groupSessionsByDirectory(sessions: SessionSummary[]): SessionGroup[] {
    const groups = new Map<string, SessionSummary[]>()

    sessions.forEach(session => {
        const path = session.metadata?.worktree?.basePath ?? session.metadata?.path ?? 'Other'
        if (!groups.has(path)) {
            groups.set(path, [])
        }
        groups.get(path)!.push(session)
    })

    return Array.from(groups.entries())
        .map(([directory, groupSessions]) => {
            const sortedSessions = [...groupSessions].sort((a, b) => {
                const rankA = a.active ? (a.pendingRequestsCount > 0 ? 0 : 1) : 2
                const rankB = b.active ? (b.pendingRequestsCount > 0 ? 0 : 1) : 2
                if (rankA !== rankB) return rankA - rankB
                return b.updatedAt - a.updatedAt
            })
            const latestUpdatedAt = groupSessions.reduce(
                (max, s) => (s.updatedAt > max ? s.updatedAt : max),
                -Infinity
            )
            const hasActiveSession = groupSessions.some(s => s.active)
            const displayName = getGroupDisplayName(directory)

            return { directory, displayName, sessions: sortedSessions, latestUpdatedAt, hasActiveSession }
        })
        .sort((a, b) => {
            if (a.hasActiveSession !== b.hasActiveSession) {
                return a.hasActiveSession ? -1 : 1
            }
            return b.latestUpdatedAt - a.latestUpdatedAt
        })
}

function PlusIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
    )
}

function BulbIcon(props: { className?: string }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={props.className}
        >
            <path d="M9 18h6" />
            <path d="M10 22h4" />
            <path d="M12 2a7 7 0 0 0-4 12c.6.6 1 1.2 1 2h6c0-.8.4-1.4 1-2a7 7 0 0 0-4-12Z" />
        </svg>
    )
}

function ChevronIcon(props: { className?: string; collapsed?: boolean }) {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`${props.className ?? ''} transition-transform duration-200 ${props.collapsed ? '' : 'rotate-90'}`}
        >
            <polyline points="9 18 15 12 9 6" />
        </svg>
    )
}

function getSessionTitle(session: SessionSummary): string {
    if (session.metadata?.name) {
        return session.metadata.name
    }
    if (session.metadata?.summary?.text) {
        return session.metadata.summary.text
    }
    if (session.metadata?.path) {
        const parts = session.metadata.path.split('/').filter(Boolean)
        return parts.length > 0 ? parts[parts.length - 1] : session.id.slice(0, 8)
    }
    return session.id.slice(0, 8)
}

function getTodoProgress(session: SessionSummary): { completed: number; total: number } | null {
    if (!session.todoProgress) return null
    if (session.todoProgress.completed === session.todoProgress.total) return null
    return session.todoProgress
}

function getAgentLabel(session: SessionSummary): string {
    const flavor = session.metadata?.flavor?.trim()
    if (flavor) return flavor
    return 'unknown'
}

function formatRelativeTime(value: number, t: (key: string, params?: Record<string, string | number>) => string): string | null {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value
    if (!Number.isFinite(ms)) return null
    const delta = Date.now() - ms
    if (delta < 60_000) return t('session.time.justNow')
    const minutes = Math.floor(delta / 60_000)
    if (minutes < 60) return t('session.time.minutesAgo', { n: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('session.time.hoursAgo', { n: hours })
    const days = Math.floor(hours / 24)
    if (days < 7) return t('session.time.daysAgo', { n: days })
    return new Date(ms).toLocaleDateString()
}

function SessionItem(props: {
    session: SessionSummary
    onSelect: (sessionId: string) => void
    showPath?: boolean
    api: ApiClient | null
    selected?: boolean
}) {
    const { t } = useTranslation()
    const { addToast } = useToast()
    const { session: s, onSelect, showPath = true, api, selected = false } = props
    const { haptic } = usePlatform()
    const [menuOpen, setMenuOpen] = useState(false)
    const [menuAnchorPoint, setMenuAnchorPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
    const [renameOpen, setRenameOpen] = useState(false)
    const [stopOpen, setStopOpen] = useState(false)
    const [deleteOpen, setDeleteOpen] = useState(false)

    const {
        stopSession,
        archiveSession,
        unarchiveSession,
        renameSession,
        deleteSession,
        isPending
    } = useSessionActions(
        api,
        s.id,
        s.metadata?.flavor ?? null
    )

    const sessionName = getSessionTitle(s)

    const handleArchive = async () => {
        try {
            await archiveSession()
            addToast({
                title: t('toast.archived.title'),
                body: sessionName,
                sessionId: '',
                url: '',
                action: {
                    label: t('toast.archived.undo'),
                    onClick: () => { void unarchiveSession() }
                }
            })
        } catch {
            // mutation surfaces its own error path; nothing to do here
        }
    }

    const handleUnarchive = async () => {
        try {
            await unarchiveSession()
            addToast({
                title: t('toast.unarchived.title'),
                body: sessionName,
                sessionId: '',
                url: '',
                action: {
                    label: t('toast.unarchived.undo'),
                    onClick: () => { void archiveSession() }
                }
            })
        } catch {
            // see above
        }
    }

    const longPressHandlers = useLongPress({
        onLongPress: (point) => {
            haptic.impact('medium')
            setMenuAnchorPoint(point)
            setMenuOpen(true)
        },
        onClick: () => {
            if (!menuOpen) {
                onSelect(s.id)
            }
        },
        threshold: 500
    })

    const modelLabel = getSessionModelLabel(s)
    const statusDotClass = s.active
        ? (s.thinking ? 'bg-[#007AFF]' : 'bg-[var(--app-badge-success-text)]')
        : 'bg-[var(--app-hint)]'
    return (
        <>
            <button
                type="button"
                {...longPressHandlers}
                className={`session-list-item flex w-full flex-col gap-1.5 px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)] select-none ${selected ? 'bg-[var(--app-secondary-bg)]' : ''}`}
                style={{ WebkitTouchCallout: 'none' }}
                aria-current={selected ? 'page' : undefined}
            >
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                            <span
                                className={`h-2 w-2 rounded-full ${statusDotClass}`}
                            />
                        </span>
                        <div className="truncate text-base font-medium">
                            {sessionName}
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs">
                        {s.thinking ? (
                            <span className="text-[#007AFF] animate-pulse">
                                {t('session.item.thinking')}
                            </span>
                        ) : null}
                        {(() => {
                            const progress = getTodoProgress(s)
                            if (!progress) return null
                            return (
                                <span className="flex items-center gap-1 text-[var(--app-hint)]">
                                    <BulbIcon className="h-3 w-3" />
                                    {progress.completed}/{progress.total}
                                </span>
                            )
                        })()}
                        {s.pendingRequestsCount > 0 ? (
                            <span className="text-[var(--app-badge-warning-text)]">
                                {t('session.item.pending')} {s.pendingRequestsCount}
                            </span>
                        ) : null}
                        <span className="text-[var(--app-hint)]">
                            {formatRelativeTime(s.updatedAt, t)}
                        </span>
                    </div>
                </div>
                {showPath ? (
                    <div className="truncate text-xs text-[var(--app-hint)]">
                        {s.metadata?.path ?? s.id}
                    </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--app-hint)]">
                    <span className="inline-flex items-center gap-2">
                        <span className="flex h-4 w-4 items-center justify-center" aria-hidden="true">
                            ❖
                        </span>
                        {getAgentLabel(s)}
                    </span>
                    {modelLabel ? (
                        <span>{t(modelLabel.key)}: {modelLabel.value}</span>
                    ) : null}
                    {s.metadata?.worktree?.branch ? (
                        <span>{t('session.item.worktree')}: {s.metadata.worktree.branch}</span>
                    ) : null}
                </div>
            </button>

            <SessionActionMenu
                isOpen={menuOpen}
                onClose={() => setMenuOpen(false)}
                sessionActive={s.active}
                sessionArchived={s.archivedAt !== null}
                onRename={() => setRenameOpen(true)}
                onStop={() => setStopOpen(true)}
                onArchive={() => { void handleArchive() }}
                onUnarchive={() => { void handleUnarchive() }}
                onDelete={() => setDeleteOpen(true)}
                anchorPoint={menuAnchorPoint}
            />

            <RenameSessionDialog
                isOpen={renameOpen}
                onClose={() => setRenameOpen(false)}
                currentName={sessionName}
                onRename={renameSession}
                isPending={isPending}
            />

            <ConfirmDialog
                isOpen={stopOpen}
                onClose={() => setStopOpen(false)}
                title={t('dialog.stop.title')}
                description={t('dialog.stop.description', { name: sessionName })}
                confirmLabel={t('dialog.stop.confirm')}
                confirmingLabel={t('dialog.stop.confirming')}
                onConfirm={stopSession}
                isPending={isPending}
                destructive
            />

            <ConfirmDialog
                isOpen={deleteOpen}
                onClose={() => setDeleteOpen(false)}
                title={t('dialog.delete.title')}
                description={t('dialog.delete.description', { name: sessionName })}
                confirmLabel={t('dialog.delete.confirm')}
                confirmingLabel={t('dialog.delete.confirming')}
                onConfirm={deleteSession}
                isPending={isPending}
                destructive
            />
        </>
    )
}

export function SessionList(props: {
    sessions: SessionSummary[]
    onSelect: (sessionId: string) => void
    onNewSession: () => void
    onRefresh: () => void
    isLoading: boolean
    renderHeader?: boolean
    api: ApiClient | null
    selectedSessionId?: string | null
}) {
    const { t } = useTranslation()
    const { renderHeader = true, api, selectedSessionId } = props
    const buckets = useMemo(
        () => bucketize(props.sessions),
        [props.sessions]
    )
    const totalProjectCount = useMemo(() => {
        const directories = new Set<string>()
        for (const { groups } of buckets) {
            for (const group of groups) {
                directories.add(group.directory)
            }
        }
        return directories.size
    }, [buckets])

    const [bucketCollapseOverrides, setBucketCollapseOverrides] = useState<Map<BucketKey, boolean>>(
        () => new Map()
    )
    const [groupCollapseOverrides, setGroupCollapseOverrides] = useState<Map<string, boolean>>(
        () => new Map()
    )

    const isBucketCollapsed = (bucket: BucketKey): boolean => {
        const override = bucketCollapseOverrides.get(bucket)
        if (override !== undefined) return override
        return !BUCKET_DEFAULT_EXPANDED[bucket]
    }

    const toggleBucket = (bucket: BucketKey, isCollapsed: boolean) => {
        setBucketCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(bucket, !isCollapsed)
            return next
        })
    }

    const isGroupCollapsed = (bucket: BucketKey, group: SessionGroup): boolean => {
        const key = `${bucket}::${group.directory}`
        const override = groupCollapseOverrides.get(key)
        if (override !== undefined) return override
        // Within a bucket, default expand groups that have an active session;
        // archived bucket also collapses everything by default.
        if (bucket === 'archived') return true
        return !group.hasActiveSession
    }

    const toggleGroup = (bucket: BucketKey, directory: string, isCollapsed: boolean) => {
        const key = `${bucket}::${directory}`
        setGroupCollapseOverrides(prev => {
            const next = new Map(prev)
            next.set(key, !isCollapsed)
            return next
        })
    }

    useEffect(() => {
        const known = new Set<string>()
        for (const { bucket, groups } of buckets) {
            for (const group of groups) {
                known.add(`${bucket}::${group.directory}`)
            }
        }
        setGroupCollapseOverrides(prev => {
            if (prev.size === 0) return prev
            const next = new Map(prev)
            let changed = false
            for (const key of next.keys()) {
                if (!known.has(key)) {
                    next.delete(key)
                    changed = true
                }
            }
            return changed ? next : prev
        })
    }, [buckets])

    return (
        <div className="mx-auto w-full max-w-content flex flex-col">
            {renderHeader ? (
                <div className="flex items-center justify-between px-3 py-1">
                    <div className="text-xs text-[var(--app-hint)]">
                        {t('sessions.count', { n: props.sessions.length, m: totalProjectCount })}
                    </div>
                    <button
                        type="button"
                        onClick={props.onNewSession}
                        className="session-list-new-button p-1.5 rounded-full text-[var(--app-link)] transition-colors"
                        title={t('sessions.new')}
                    >
                        <PlusIcon className="h-5 w-5" />
                    </button>
                </div>
            ) : null}

            <div className="flex flex-col">
                {buckets.map(({ bucket, groups }) => {
                    const bucketCollapsed = isBucketCollapsed(bucket)
                    const sessionCount = groups.reduce((n, g) => n + g.sessions.length, 0)
                    return (
                        <div key={bucket}>
                            <button
                                type="button"
                                onClick={() => toggleBucket(bucket, bucketCollapsed)}
                                className="sticky top-0 z-20 flex w-full items-center gap-2 px-3 py-2 text-left bg-[var(--app-secondary-bg)] border-b border-[var(--app-divider)] transition-colors hover:bg-[var(--app-subtle-bg)]"
                            >
                                <ChevronIcon
                                    className="h-4 w-4 text-[var(--app-hint)]"
                                    collapsed={bucketCollapsed}
                                />
                                <span className="text-xs font-semibold uppercase tracking-wide text-[var(--app-fg)]">
                                    {t(`sessions.bucket.${bucket}`)}
                                </span>
                                <span className="ml-auto text-xs text-[var(--app-hint)] tabular-nums">
                                    {sessionCount}
                                </span>
                            </button>
                            {!bucketCollapsed ? groups.map((group) => {
                                const groupCollapsed = isGroupCollapsed(bucket, group)
                                return (
                                    <div key={`${bucket}::${group.directory}`}>
                                        <button
                                            type="button"
                                            onClick={() => toggleGroup(bucket, group.directory, groupCollapsed)}
                                            className="sticky top-[33px] z-10 flex w-full items-center gap-2 px-3 py-2 text-left bg-[var(--app-bg)] border-b border-[var(--app-divider)] transition-colors hover:bg-[var(--app-secondary-bg)]"
                                        >
                                            <ChevronIcon
                                                className="h-4 w-4 text-[var(--app-hint)]"
                                                collapsed={groupCollapsed}
                                            />
                                            <div className="flex items-center gap-2 min-w-0 flex-1">
                                                <span className="font-medium text-base break-words" title={group.directory}>
                                                    {group.displayName}
                                                </span>
                                                <span className="shrink-0 text-xs text-[var(--app-hint)] tabular-nums">
                                                    ({group.sessions.length})
                                                </span>
                                            </div>
                                            <span className="shrink-0 text-xs text-[var(--app-hint)]">
                                                {formatRelativeTime(group.latestUpdatedAt, t)}
                                            </span>
                                        </button>
                                        {!groupCollapsed ? (
                                            <div className="flex flex-col divide-y divide-[var(--app-divider)] border-b border-[var(--app-divider)]">
                                                {group.sessions.map((s) => (
                                                    <SessionItem
                                                        key={s.id}
                                                        session={s}
                                                        onSelect={props.onSelect}
                                                        showPath={false}
                                                        api={api}
                                                        selected={s.id === selectedSessionId}
                                                    />
                                                ))}
                                            </div>
                                        ) : null}
                                    </div>
                                )
                            }) : null}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
