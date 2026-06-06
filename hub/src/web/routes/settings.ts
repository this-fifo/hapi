import { Hono } from 'hono'
import { z } from 'zod'
import { getConfiguration } from '../../configuration'
import { updateMaintenanceSettings } from '../../config/serverSettings'
import type { WebAppEnv } from '../middleware/auth'

const patchSchema = z.object({
    autoArchiveIdleDays: z.number().int().positive().nullable().optional(),
    autoDeleteArchivedDays: z.number().int().positive().nullable().optional()
})

export function createSettingsRoutes(): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/settings', (c) => {
        const config = getConfiguration()
        return c.json({
            autoArchiveIdleDays: config.autoArchiveIdleDays,
            autoDeleteArchivedDays: config.autoDeleteArchivedDays
        })
    })

    app.patch('/settings', async (c) => {
        const body = await c.req.json().catch(() => null)
        const parsed = patchSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const config = getConfiguration()
        const updated = await updateMaintenanceSettings(config.dataDir, parsed.data)

        // Reflect in the running process so the next archive tick honors the new policy.
        config.autoArchiveIdleDays = updated.autoArchiveIdleDays
        config.autoDeleteArchivedDays = updated.autoDeleteArchivedDays

        return c.json(updated)
    })

    return app
}
