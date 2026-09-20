/**
 * The occurrence runner: turns one claimed run into a fresh headless session
 * inside the automation's workspace, drives it to idle through the public
 * Agent surface (create → followup → whenIdle → flush), attaches the session
 * to the workspace, and finalizes the run record. The prompt is user-authored
 * automation input, so the framing names its origin and the session log keeps
 * the full transcript — the run record stores facts only, never the outcome
 * promise.
 */

import { randomUUID } from 'node:crypto'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { splitModelRoute } from './domain.js'

/**
 * The stable framing every fired occurrence presents. The title is
 * JSON-escaped; the prompt body is the task itself and stays literal.
 * @param {object} record - the automation being fired.
 * @param {string} occurrenceAt - occurrence being presented.
 * @returns {string} the user-role message text.
 */
export function renderAutomationFraming(record, occurrenceAt) {
  return [
    '[CRON AUTOMATION]',
    `This request was fired by the scheduled automation ${JSON.stringify(record.title)} at occurrence ${occurrenceAt}.`,
    'Perform the task below now in this session and report the outcome.',
    `task_prompt: ${JSON.stringify(record.prompt)}`,
  ].join('\n')
}

/**
 * Terminal turn outcome of one run interval: the error description of the
 * last failed turn, or null when every turn completed.
 * @param {object[]} events - the session's events.
 * @param {number} firstSeq - event offset the run owns.
 * @returns {string | null} the error string, or null.
 */
export function runError(events, firstSeq) {
  let error = null
  for (let index = firstSeq; index < events.length; index += 1) {
    const event = events[index]
    if (event === undefined || event.type !== 'turn/end') continue
    if (event.data.reason.kind === 'error') {
      const { code, message } = event.data.reason.error
      error = `${code}: ${message}`
    }
  }
  return error
}

/**
 * Build the runner over the store's two tables.
 * @param {object} services - host agent, session, and workspace seams
 *   (createAgent, flush, getWorkspace).
 * @param {object} automations - the automations table (lastRun summary writes).
 * @param {object} runs - the runs table (terminal transition writes).
 * @param {() => number} [now] - wall-clock source, injectable for tests.
 * @returns {{ run(record: object, occurrenceAt: string, runId: string): Promise<void> }} the runner.
 */
export function createRunner(services, automations, runs, now = Date.now) {
  return {
    async run(record, occurrenceAt, runId) {
      await runs.update(runId, current => ({ ...current, status: 'running' }))
      const startedMs = now()
      let sessionId = null
      let error = null
      try {
        const workspace = services.getWorkspace(record.workspaceId)
        if (workspace === undefined) {
          throw new Error(`workspace ${JSON.stringify(record.workspaceId)} no longer exists`)
        }
        const route = splitModelRoute(record.model)
        const plannedSessionId = `session-${randomUUID()}`
        const handle = await services.createAgent({
          sessionId: plannedSessionId,
          meta: { cwd: workspace.path },
          agentOptions: { provider: route.provider, model: route.model },
        })
        sessionId = plannedSessionId
        try {
          const agent = handle.agent
          const firstSeq = agent.session.seq
          agent.followup(createUserMessage({
            content: [{ type: 'text', text: renderAutomationFraming(record, occurrenceAt) }],
            source: { kind: 'plugin', plugin: 'cron' },
          }))
          await agent.whenIdle()
          await services.flush(agent.session)
          error = runError(agent.session.snapshotEvents(), firstSeq)
        } finally {
          await handle.dispose()
        }
        await workspace.attachSession(sessionId)
      } catch (thrown) {
        error = thrown.message
      }
      const finishedMs = now()
      const stamp = new Date(finishedMs).toISOString()
      const finalStatus = error === null ? 'succeeded' : 'failed'
      await runs.update(runId, current => ({
        ...current,
        status: finalStatus,
        sessionId: sessionId === null ? current.sessionId : sessionId,
        finishedAt: stamp,
        durationMs: finishedMs - startedMs,
        error,
      }))
      // Stamp even when the claim already moved the record to completed or
      // paused: the record's last outcome must be the finished run, never the
      // transient claim.
      await automations.update(record.id, current => ({
        ...current,
        lastRunAt: stamp,
        lastRunStatus: finalStatus,
      }))
    },
  }
}
