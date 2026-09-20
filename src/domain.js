/**
 * Pure cron rule arithmetic and input validation: expression compilation,
 * model-route parsing, occurrence selection, and the due-advance transition.
 * Everything here is a total function over its inputs plus the sampled wall
 * clock, so replay and scheduling decisions never read ambient state beyond
 * the passed instant.
 */

import { randomUUID } from 'node:crypto'
import { Cron } from 'croner'

/** Exact seconds per supported interval unit. */
export const INTERVAL_UNIT_SECONDS = {
  minute: 60,
  hourly: 3_600,
  daily: 86_400,
  weekly: 604_800,
}

/** Lower bound for interval spacing; bounds wake frequency. */
export const MIN_INTERVAL_SECONDS = 60

/** Upper bound for the interval multiplier, mirroring the tool surface. */
export const MAX_INTERVAL_VALUE = 200

/** Upper bound for max_runs, mirroring the tool surface. */
export const MAX_MAX_RUNS = 10_000

/** Largest delay the tool surface accepts, in minutes. */
export const MAX_DELAY_MINUTES = 525_600

/** "provider/model" with no whitespace or extra slashes. */
const MODEL_ROUTE_PATTERN = /^[^/\s]+\/[^/\s]+$/

/** Field count of the supported cron dialect: minute hour day-of-month month day-of-week. */
const CRON_FIELD_COUNT = 5

/**
 * Split a validated "provider/model" route.
 * @param {string} route - the route string.
 * @returns {{ provider: string, model: string }} provider and model halves.
 */
export function splitModelRoute(route) {
  if (!MODEL_ROUTE_PATTERN.test(route)) {
    throw new Error(`invalid model route ${JSON.stringify(route)}: expected "provider/model"`)
  }
  const slash = route.indexOf('/')
  return { provider: route.slice(0, slash), model: route.slice(slash + 1) }
}

/**
 * Whether `zone` names a time zone `Intl` accepts.
 * @param {string} zone - candidate IANA zone id.
 * @returns {boolean} true when the zone resolves.
 */
export function validTimeZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return true
  } catch {
    return false
  }
}

/**
 * Compile and validate one cron expression under an explicit zone. Rejects
 * anything outside the five-field dialect (macros, second fields) so the
 * durable surface stays predictable.
 * @param {string} expression - five-field cron expression.
 * @param {string} timeZone - explicit IANA zone id.
 * @returns {object} the compiled Cron job.
 */
export function compileCron(expression, timeZone) {
  if (expression.trim().split(/\s+/).length !== CRON_FIELD_COUNT) {
    throw new Error(`invalid cron expression ${JSON.stringify(expression)}: expected five fields (minute hour day-of-month month day-of-week)`)
  }
  try {
    return new Cron(expression, { timezone: timeZone })
  } catch (error) {
    throw new Error(`invalid cron expression ${JSON.stringify(expression)}: ${error.message}`)
  }
}

/**
 * First due instant of a freshly created schedule.
 * @param {object} schedule - the durable rule.
 * @param {number} createdAtMs - creation anchor.
 * @returns {number | null} due instant in ms, or null when a cron expression has no future match.
 */
export function initialNextAtMs(schedule, createdAtMs) {
  if (schedule.kind === 'once') return Date.parse(schedule.runAt)
  if (schedule.kind === 'interval') return createdAtMs + schedule.everySeconds * 1_000
  return compileCron(schedule.expression, schedule.timeZone).nextRun(new Date(createdAtMs))?.getTime() ?? null
}

/**
 * The latest occurrence at or before `nowMs` — the one a due decision
 * presents. Catch-up never enumerates missed occurrences.
 * @param {object} record - the due automation record.
 * @param {number} nowMs - sampled wall clock.
 * @returns {number} occurrence instant in ms.
 */
export function latestDueOccurrenceMs(record, nowMs) {
  const schedule = record.schedule
  if (schedule.kind === 'once') return Date.parse(schedule.runAt)
  if (schedule.kind === 'interval') {
    const anchorMs = Date.parse(record.createdAt)
    const elapsed = Math.floor((nowMs - anchorMs) / (schedule.everySeconds * 1_000))
    return anchorMs + elapsed * schedule.everySeconds * 1_000
  }
  const due = compileCron(schedule.expression, schedule.timeZone).nextRun(new Date(nowMs - 1))
  return due?.getTime() ?? Date.parse(record.nextAt ?? new Date(nowMs).toISOString())
}

/**
 * The first occurrence strictly after `nowMs`.
 * @param {object} record - the automation record.
 * @param {number} nowMs - sampled wall clock.
 * @returns {number | null} next instant in ms, or null when the rule can never fire again.
 */
export function nextFutureOccurrenceMs(record, nowMs) {
  const schedule = record.schedule
  if (schedule.kind === 'once') return null
  if (schedule.kind === 'interval') {
    const anchorMs = Date.parse(record.createdAt)
    const elapsed = Math.floor((nowMs - anchorMs) / (schedule.everySeconds * 1_000))
    return anchorMs + (elapsed + 1) * schedule.everySeconds * 1_000
  }
  return compileCron(schedule.expression, schedule.timeZone).nextRun(new Date(nowMs))?.getTime() ?? null
}

/**
 * Advance one due automation: consume the latest due occurrence, move nextAt
 * to the first future occurrence, and complete the record when the once
 * instant fired, maxRuns ran out, or no future occurrence exists.
 * @param {object} record - an active record whose nextAt is at or before now.
 * @param {number} nowMs - sampled decision clock.
 * @param {string} claimedStatus - run status this claim records (claimed, or skipped when in flight).
 * @returns {{ record: object, occurrenceAt: string }} the advanced record and the presented occurrence.
 */
export function advanceDue(record, nowMs, claimedStatus) {
  const runCount = record.runCount + 1
  const occurrenceAt = new Date(latestDueOccurrenceMs(record, nowMs)).toISOString()
  const nextMs = record.schedule.kind === 'once' ? null : nextFutureOccurrenceMs(record, nowMs)
  const exhausted = record.maxRuns !== null && runCount >= record.maxRuns
  const completed = nextMs === null || exhausted
  return {
    occurrenceAt,
    record: {
      ...record,
      runCount,
      status: completed ? 'completed' : 'active',
      nextAt: completed ? null : new Date(nextMs).toISOString(),
      lastRunAt: occurrenceAt,
      lastRunStatus: claimedStatus,
      updatedAt: new Date(nowMs).toISOString(),
    },
  }
}

/**
 * Fresh nextAt for a schedule edit or a resume from paused: recurring rules
 * start from the next future occurrence (no backlog), a once rule keeps its
 * absolute instant so a missed one still fires overdue.
 * @param {object} schedule - the new or unchanged durable rule.
 * @param {number} nowMs - decision clock.
 * @returns {number | null} next due instant in ms, or null when the rule cannot fire.
 */
export function resumeNextAtMs(schedule, nowMs) {
  if (schedule.kind === 'once') return Date.parse(schedule.runAt)
  const probe = {
    id: 'probe',
    workspaceId: 'probe',
    title: 'probe',
    prompt: 'probe',
    model: 'probe/probe',
    schedule,
    status: 'active',
    maxRuns: null,
    runCount: 0,
    nextAt: null,
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
  }
  return nextFutureOccurrenceMs(probe, nowMs)
}

/**
 * Allocate a never-reused automation id.
 * @returns {string} a fresh automation id.
 */
export function allocateCronId() {
  return `cron-${randomUUID()}`
}

/**
 * Allocate a never-reused run id.
 * @returns {string} a fresh run id.
 */
export function allocateRunId() {
  return `run-${randomUUID()}`
}
