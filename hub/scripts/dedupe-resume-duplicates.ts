#!/usr/bin/env bun
/**
 * One-time migration: dedupe sessions that share an underlying agent
 * conversation id (claudeSessionId / codexSessionId / etc).
 *
 * Background: prior to the resume-merge fix, every "resume" via the mobile
 * app created a new hapi session row pointing at the same Claude (or other
 * agent) conversation. Many of those rows were never merged back into their
 * parent because the post-spawn merge timed out. This script picks one
 * winner per group (latest updated_at), moves messages from the losers into
 * the winner, and deletes the loser session rows.
 *
 * Default mode is dry-run (read-only). Pass --apply to actually write.
 *
 * Usage:
 *   bun run hub/scripts/dedupe-resume-duplicates.ts           # dry-run
 *   bun run hub/scripts/dedupe-resume-duplicates.ts --apply   # prompts before writing
 *   bun run hub/scripts/dedupe-resume-duplicates.ts --apply --force   # no prompt
 */

import { Database } from 'bun:sqlite'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

type Args = { apply: boolean; force: boolean; help: boolean }

function parseArgs(): Args {
    const args = process.argv.slice(2)
    const out: Args = { apply: false, force: false, help: false }
    for (const arg of args) {
        if (arg === '--help' || arg === '-h') out.help = true
        else if (arg === '--apply') out.apply = true
        else if (arg === '--force' || arg === '-f') out.force = true
        else {
            console.error(`Unknown argument: ${arg}`)
            console.error('Use --help for usage information')
            process.exit(1)
        }
    }
    return out
}

function getDbPath(): string {
    if (process.env.DB_PATH) {
        return process.env.DB_PATH.replace(/^~/, homedir())
    }
    const dataDir = process.env.HAPI_HOME
        ? process.env.HAPI_HOME.replace(/^~/, homedir())
        : join(homedir(), '.hapi')
    return join(dataDir, 'hapi.db')
}

type GroupRow = {
    namespace: string
    flavor: string | null
    agent_id: string
    ids: string
    updated_ats: string
    msg_counts: string
}

type SessionRecord = {
    id: string
    updatedAt: number
    messageCount: number
}

function loadGroups(db: Database): Array<{ namespace: string; flavor: string | null; agentId: string; sessions: SessionRecord[] }> {
    const rows = db.query<GroupRow, []>(`
        WITH agent_keyed AS (
            SELECT
                s.id,
                s.namespace,
                s.updated_at,
                json_extract(s.metadata, '$.flavor') AS flavor,
                COALESCE(
                    json_extract(s.metadata, '$.claudeSessionId'),
                    json_extract(s.metadata, '$.codexSessionId'),
                    json_extract(s.metadata, '$.geminiSessionId'),
                    json_extract(s.metadata, '$.opencodeSessionId'),
                    json_extract(s.metadata, '$.cursorSessionId')
                ) AS agent_id
            FROM sessions s
        ),
        with_counts AS (
            SELECT a.id, a.namespace, a.flavor, a.agent_id, a.updated_at,
                   (SELECT COUNT(*) FROM messages m WHERE m.session_id = a.id) AS msg_count
            FROM agent_keyed a
            WHERE a.agent_id IS NOT NULL
        )
        SELECT
            namespace,
            flavor,
            agent_id,
            GROUP_CONCAT(id, char(31)) AS ids,
            GROUP_CONCAT(updated_at, char(31)) AS updated_ats,
            GROUP_CONCAT(msg_count, char(31)) AS msg_counts
        FROM with_counts
        GROUP BY namespace, flavor, agent_id
        HAVING COUNT(*) > 1
        ORDER BY COUNT(*) DESC, MAX(updated_at) DESC
    `).all()

    return rows.map((row) => {
        const ids = row.ids.split('\x1f')
        const updatedAts = row.updated_ats.split('\x1f').map((v) => Number(v))
        const msgCounts = row.msg_counts.split('\x1f').map((v) => Number(v))
        const sessions: SessionRecord[] = ids.map((id, i) => ({
            id,
            updatedAt: updatedAts[i] ?? 0,
            messageCount: msgCounts[i] ?? 0
        }))
        sessions.sort((a, b) => b.updatedAt - a.updatedAt)
        return {
            namespace: row.namespace,
            flavor: row.flavor,
            agentId: row.agent_id,
            sessions
        }
    })
}

function getMaxSeq(db: Database, sessionId: string): number {
    const row = db.prepare(
        'SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM messages WHERE session_id = ?'
    ).get(sessionId) as { maxSeq: number } | undefined
    return row?.maxSeq ?? 0
}

function mergeMessagesAndDeleteLoser(db: Database, loserId: string, winnerId: string): number {
    if (loserId === winnerId) return 0

    const oldMaxSeq = getMaxSeq(db, loserId)
    const newMaxSeq = getMaxSeq(db, winnerId)

    db.exec('BEGIN')
    try {
        if (newMaxSeq > 0 && oldMaxSeq > 0) {
            db.prepare(
                'UPDATE messages SET seq = seq + ? WHERE session_id = ?'
            ).run(oldMaxSeq, winnerId)
        }

        const collisions = db.prepare(`
            SELECT local_id FROM messages
            WHERE session_id = ? AND local_id IS NOT NULL
            INTERSECT
            SELECT local_id FROM messages
            WHERE session_id = ? AND local_id IS NOT NULL
        `).all(winnerId, loserId) as Array<{ local_id: string }>

        if (collisions.length > 0) {
            const localIds = collisions.map((r) => r.local_id)
            const placeholders = localIds.map(() => '?').join(', ')
            db.prepare(
                `UPDATE messages SET local_id = NULL WHERE session_id = ? AND local_id IN (${placeholders})`
            ).run(loserId, ...localIds)
        }

        const moved = db.prepare(
            'UPDATE messages SET session_id = ? WHERE session_id = ?'
        ).run(winnerId, loserId).changes

        db.prepare('DELETE FROM sessions WHERE id = ?').run(loserId)

        db.exec('COMMIT')
        return moved
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
}

async function confirm(message: string): Promise<boolean> {
    process.stdout.write(`${message} [y/N]: `)
    for await (const line of console) {
        const answer = line.trim().toLowerCase()
        return answer === 'y' || answer === 'yes'
    }
    return false
}

function help(): void {
    console.log(`
Usage: bun run hub/scripts/dedupe-resume-duplicates.ts [options]

Options:
  --apply     Actually merge + delete (default is dry-run)
  --force     Skip the confirmation prompt when applying
  --help      Show this help

What it does:
  Finds session rows that share the same underlying agent conversation id
  (claudeSessionId / codexSessionId / geminiSessionId / opencodeSessionId
  / cursorSessionId), grouped per (namespace, flavor). Picks the row with
  the most recent updated_at as the winner, moves messages from the older
  rows into it (re-seq + local_id collision NULL-out, mirroring the live
  mergeSessionMessages logic), and deletes the older rows.

  Dry-run is the default. Use --apply to actually write.
`)
}

async function main(): Promise<void> {
    const args = parseArgs()
    if (args.help) {
        help()
        process.exit(0)
    }

    const dbPath = getDbPath()
    if (!existsSync(dbPath)) {
        console.error(`Database not found: ${dbPath}`)
        process.exit(1)
    }

    console.log(`Database: ${dbPath}`)
    console.log(`Mode: ${args.apply ? 'APPLY' : 'dry-run'}`)
    console.log()

    const db = new Database(dbPath)
    db.run('PRAGMA foreign_keys = ON')

    try {
        const groups = loadGroups(db)
        if (groups.length === 0) {
            console.log('No duplicates found.')
            return
        }

        let totalLosers = 0
        let totalMessages = 0
        for (const g of groups) {
            const losers = g.sessions.slice(1)
            totalLosers += losers.length
            for (const l of losers) totalMessages += l.messageCount
        }

        console.log(`Groups with duplicates: ${groups.length}`)
        console.log(`Loser rows to remove:   ${totalLosers}`)
        console.log(`Loser messages to move: ${totalMessages}`)
        console.log()

        const head = ['flavor', 'agent_id', '#rows', 'winner', 'losers (id|updated|msgs)'].join(' | ')
        console.log(head)
        console.log('-'.repeat(head.length))
        for (const g of groups.slice(0, 30)) {
            const winner = g.sessions[0]
            const losers = g.sessions.slice(1)
            const flavor = (g.flavor ?? '?').padEnd(8)
            const agent = g.agentId.slice(0, 8)
            const winnerCol = `${winner.id.slice(0, 8)} (${winner.messageCount}msg)`
            const losersCol = losers
                .map((l) => `${l.id.slice(0, 8)}|${new Date(l.updatedAt).toISOString().slice(0, 10)}|${l.messageCount}`)
                .join(', ')
            console.log([flavor, agent, String(g.sessions.length).padStart(5), winnerCol, losersCol].join(' | '))
        }
        if (groups.length > 30) {
            console.log(`... and ${groups.length - 30} more groups`)
        }
        console.log()

        if (!args.apply) {
            console.log('Dry-run only. Re-run with --apply to actually merge + delete.')
            return
        }

        if (!args.force) {
            const ok = await confirm(`Apply: merge ${totalMessages} messages and delete ${totalLosers} session rows?`)
            if (!ok) {
                console.log('Aborted.')
                return
            }
        }

        let mergedRows = 0
        let movedMessages = 0
        for (const g of groups) {
            const winner = g.sessions[0]
            for (const loser of g.sessions.slice(1)) {
                const moved = mergeMessagesAndDeleteLoser(db, loser.id, winner.id)
                movedMessages += moved
                mergedRows += 1
            }
        }

        console.log(`Done. Removed ${mergedRows} loser row(s); moved ${movedMessages} message row(s).`)
    } finally {
        db.close()
    }
}

main().catch((err) => {
    console.error('Error:', err.message)
    process.exit(1)
})
