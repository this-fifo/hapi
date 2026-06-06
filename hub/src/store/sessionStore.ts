import type { Database } from 'bun:sqlite'

import type { StoredSession, VersionedUpdateResult } from './types'
import {
    archiveSession,
    bulkArchiveIdle,
    deleteArchivedOlderThan,
    deleteSession,
    getOrCreateSession,
    getSession,
    getSessionByNamespace,
    getSessions,
    getSessionsByNamespace,
    setSessionEffort,
    setSessionModel,
    setSessionModelReasoningEffort,
    setSessionTeamState,
    setSessionTodos,
    touchSessionUpdatedAt,
    unarchiveSession,
    updateSessionAgentState,
    updateSessionMetadata
} from './sessions'

export class SessionStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    getOrCreateSession(
        tag: string,
        metadata: unknown,
        agentState: unknown,
        namespace: string,
        model?: string,
        effort?: string,
        modelReasoningEffort?: string
    ): StoredSession {
        return getOrCreateSession(this.db, tag, metadata, agentState, namespace, model, effort, modelReasoningEffort)
    }

    updateSessionMetadata(
        id: string,
        metadata: unknown,
        expectedVersion: number,
        namespace: string,
        options?: { touchUpdatedAt?: boolean }
    ): VersionedUpdateResult<unknown | null> {
        return updateSessionMetadata(this.db, id, metadata, expectedVersion, namespace, options)
    }

    updateSessionAgentState(
        id: string,
        agentState: unknown,
        expectedVersion: number,
        namespace: string
    ): VersionedUpdateResult<unknown | null> {
        return updateSessionAgentState(this.db, id, agentState, expectedVersion, namespace)
    }

    setSessionTodos(id: string, todos: unknown, todosUpdatedAt: number, namespace: string): boolean {
        return setSessionTodos(this.db, id, todos, todosUpdatedAt, namespace)
    }

    setSessionTeamState(id: string, teamState: unknown, updatedAt: number, namespace: string): boolean {
        return setSessionTeamState(this.db, id, teamState, updatedAt, namespace)
    }

    setSessionModel(id: string, model: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): boolean {
        return setSessionModel(this.db, id, model, namespace, options)
    }

    setSessionModelReasoningEffort(
        id: string,
        modelReasoningEffort: string | null,
        namespace: string,
        options?: { touchUpdatedAt?: boolean }
    ): boolean {
        return setSessionModelReasoningEffort(this.db, id, modelReasoningEffort, namespace, options)
    }

    setSessionEffort(id: string, effort: string | null, namespace: string, options?: { touchUpdatedAt?: boolean }): boolean {
        return setSessionEffort(this.db, id, effort, namespace, options)
    }

    touchSessionUpdatedAt(id: string, updatedAt: number, namespace: string): boolean {
        return touchSessionUpdatedAt(this.db, id, updatedAt, namespace)
    }

    getSession(id: string): StoredSession | null {
        return getSession(this.db, id)
    }

    getSessionByNamespace(id: string, namespace: string): StoredSession | null {
        return getSessionByNamespace(this.db, id, namespace)
    }

    getSessions(opts?: { includeArchived?: boolean }): StoredSession[] {
        return getSessions(this.db, opts)
    }

    getSessionsByNamespace(namespace: string, opts?: { includeArchived?: boolean }): StoredSession[] {
        return getSessionsByNamespace(this.db, namespace, opts)
    }

    archiveSession(id: string, namespace: string): boolean {
        return archiveSession(this.db, id, namespace)
    }

    unarchiveSession(id: string, namespace: string): boolean {
        return unarchiveSession(this.db, id, namespace)
    }

    bulkArchiveIdle(namespace: string, updatedBeforeMs: number): string[] {
        return bulkArchiveIdle(this.db, namespace, updatedBeforeMs)
    }

    deleteArchivedOlderThan(namespace: string, archivedBeforeMs: number): string[] {
        return deleteArchivedOlderThan(this.db, namespace, archivedBeforeMs)
    }

    deleteSession(id: string, namespace: string): boolean {
        return deleteSession(this.db, id, namespace)
    }
}
