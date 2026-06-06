import { statSync } from 'node:fs'
import { Hono } from 'hono'
import { Database } from 'bun:sqlite'
import { configuration } from '../../configuration'
import type { Store } from '../../store'
import type { WebAppEnv } from '../middleware/auth'

export function createMaintenanceRoutes(store: Store): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/maintenance/storage', (c) => {
        const namespace = c.get('namespace')
        let dbBytes = 0
        try {
            dbBytes = statSync(configuration.dbPath).size
        } catch {
            // file may not exist in tests
        }
        const all = store.sessions.getSessions({ includeArchived: true }).filter((s) => s.namespace === namespace)
        const sessionCount = all.filter((s) => s.archivedAt === null).length
        const archivedCount = all.filter((s) => s.archivedAt !== null).length
        return c.json({ dbBytes, sessionCount, archivedCount })
    })

    app.post('/maintenance/vacuum', (c) => {
        // VACUUM cannot run on a connection that holds the WAL writer; open a
        // dedicated connection for it. This briefly contends with the main
        // store but does not block reads under WAL mode.
        const tmp = new Database(configuration.dbPath, { create: false, readwrite: true, strict: true })
        try {
            tmp.exec('VACUUM')
            const dbBytes = statSync(configuration.dbPath).size
            return c.json({ ok: true, dbBytes })
        } finally {
            tmp.close()
        }
    })

    return app
}
