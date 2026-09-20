/**
 * The in-process scheduler: a wall-clock tick that reconciles durable
 * automations, claims due occurrences record-then-run (a crash between
 * claim and run loses the slot, never double-fires it), skips occurrences
 * whose automation still has a run in flight, and launches the runner
 * without awaiting it. Long waits need no timers of their own: every tick
 * re-reads the wall clock and durable state, so sleep, clock moves, and
 * restarts reconcile on the next tick.
 */

import { advanceDue, allocateRunId } from './domain.js'

/**
 * Scheduler over the two cron tables. One instance per process; ticks are
 * serialized against each other, claims are serialized by the synchronous
 * store.
 */
export class CronScheduler {
  /**
   * @param {object} automations - the automations table of the store.
   * @param {object} runs - the runs table of the store.
   * @param {{ run(record: object, occurrenceAt: string, runId: string): Promise<void> }} runner - occurrence executor.
   * @param {() => number} [now] - wall-clock source, injectable for tests.
   */
  constructor(automations, runs, runner, now = Date.now) {
    this.#automations = automations
    this.#runs = runs
    this.#runner = runner
    this.#now = now
  }

  #automations
  #runs
  #runner
  #now
  /** Automations with a launched run still in flight (in-memory claim set). */
  #inFlight = new Set()
  /** Launched run promises, so disposal can await in-flight work. */
  #launches = new Set()
  #ticking = false
  #stopping = false

  /**
   * Reconcile claims orphaned by a restart: no agent from the previous
   * process is still executing them, so they fail loudly with the interrupt
   * reason instead of staying claimed forever.
   * @returns {Promise<void>} resolves when the sweep is durable.
   */
  async sweepInterrupted() {
    const nowMs = this.#now()
    const stamp = new Date(nowMs).toISOString()
    for (const [, run] of this.#runs.entries()) {
      if (run.status !== 'claimed' && run.status !== 'running') continue
      await this.#runs.update(run.id, current => ({
        ...current,
        status: 'failed',
        finishedAt: stamp,
        durationMs: nowMs - Date.parse(current.startedAt),
        error: 'interrupted: the host restarted before this run finished',
      }))
      await this.#automations.update(run.cronId, current => current.status === 'active'
        ? { ...current, lastRunAt: stamp, lastRunStatus: 'failed' }
        : current)
    }
  }

  /**
   * One reconciliation pass: claim every due active automation, then launch
   * its runner without awaiting completion. Overlapping ticks are dropped:
   * the previous pass still owns the claim decisions.
   * @returns {Promise<void>} resolves when all claims of this pass are durable.
   */
  async tick() {
    if (this.#ticking || this.#stopping) return
    this.#ticking = true
    try {
      const nowMs = this.#now()
      for (const [, record] of this.#automations.entries()) {
        if (record.status !== 'active' || record.nextAt === null) continue
        if (Date.parse(record.nextAt) > nowMs) continue
        try {
          await this.#claim(record, nowMs)
        } catch (error) {
          // One record failing (for example deleted mid-tick) must not stop
          // the other due automations of this pass.
          console.error('[dsh-cron] claim failed:', error)
        }
      }
    } finally {
      this.#ticking = false
    }
  }

  /**
   * Claim one due occurrence and launch or skip it. The claim advances the
   * durable record first (record-then-run): a crash after the advance but
   * before the run completes leaves an interrupted run, never a repeat fire.
   * @param {object} observed - the due record as read by the current tick.
   * @param {number} nowMs - sampled decision clock.
   */
  async #claim(observed, nowMs) {
    const inFlight = this.#inFlight.has(observed.id)
    const observedNextAt = observed.nextAt
    let advanced
    let occurrenceAt = ''
    await this.#automations.update(observed.id, (current) => {
      if (current.status !== 'active' || current.nextAt !== observedNextAt) return current
      const outcome = advanceDue(current, nowMs, inFlight ? 'skipped' : 'claimed')
      advanced = outcome.record
      occurrenceAt = outcome.occurrenceAt
      return outcome.record
    })
    if (advanced === undefined) return
    const claimed = advanced
    const runId = allocateRunId()
    const stamp = new Date(nowMs).toISOString()
    const run = inFlight
      ? {
        id: runId,
        cronId: claimed.id,
        occurrenceAt,
        status: 'skipped',
        sessionId: null,
        startedAt: stamp,
        finishedAt: stamp,
        durationMs: 0,
        error: 'skipped: another run of this automation was still in flight',
      }
      : {
        id: runId,
        cronId: claimed.id,
        occurrenceAt,
        status: 'claimed',
        sessionId: null,
        startedAt: stamp,
        finishedAt: null,
        durationMs: null,
        error: null,
      }
    await this.#runs.put(runId, run)
    if (inFlight) return
    this.#inFlight.add(claimed.id)
    const launch = this.#runner.run(claimed, occurrenceAt, runId)
      .catch(() => {})
      .finally(() => {
        this.#inFlight.delete(claimed.id)
        this.#launches.delete(launch)
      })
    this.#launches.add(launch)
  }

  /**
   * Stop accepting new work and await every launched run still in flight.
   * Durable records are left as they are; interrupted claims reconcile at the
   * next process's sweep.
   * @returns {Promise<void>} resolves when in-flight launches settle.
   */
  async stop() {
    this.#stopping = true
    await Promise.allSettled([...this.#launches])
  }
}
