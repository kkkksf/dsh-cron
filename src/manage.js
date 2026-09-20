/**
 * Shared automation management logic: input validation and the create/update
 * transitions used by both the Agent-scoped tools and the /cron commands.
 * One home per rule, so the tool surface and the command surface cannot
 * drift.
 */

import {
  INTERVAL_UNIT_SECONDS,
  MAX_DELAY_MINUTES,
  MAX_INTERVAL_VALUE,
  MAX_MAX_RUNS,
  allocateCronId,
  initialNextAtMs,
  resumeNextAtMs,
  splitModelRoute,
  validTimeZone,
} from './domain.js'

/** Maximum characters of an automation title. */
export const MAX_TITLE_CHARS = 80
/** Maximum characters of an automation task prompt. */
export const MAX_PROMPT_CHARS = 8_000

const UNITS = Object.keys(INTERVAL_UNIT_SECONDS)

/**
 * Validate shared scalar fields and return their trimmed forms.
 * @param {{ title: string, prompt: string }} raw - caller-supplied title and prompt.
 * @returns {{ title: string, prompt: string }} trimmed title and prompt.
 */
export function scalars(raw) {
  const title = raw.title.trim()
  if (title.length === 0 || title.length > MAX_TITLE_CHARS) {
    throw new Error(`title must be 1-${MAX_TITLE_CHARS} characters`)
  }
  const prompt = raw.prompt.trim()
  if (prompt.length === 0 || prompt.length > MAX_PROMPT_CHARS) {
    throw new Error(`prompt must be 1-${MAX_PROMPT_CHARS} characters`)
  }
  return { title, prompt }
}

/**
 * Build the durable schedule from exactly one selector. Value constraints are
 * re-checked here for every surface.
 * @param {object} raw - create/update arguments carrying at most one selector
 *   (cron_expression, delay_minutes, interval, optional time_zone / interval_unit).
 * @param {string} defaultTimeZone - deployment zone fallback.
 * @param {number} nowMs - decision clock for delay anchoring.
 * @returns {object} the durable schedule.
 */
export function buildSchedule(raw, defaultTimeZone, nowMs) {
  const selectors = [raw.cron_expression, raw.delay_minutes, raw.interval].filter(value => value !== undefined)
  if (selectors.length !== 1) {
    throw new Error('pass exactly one of cron_expression, delay_minutes, or interval')
  }
  if (raw.cron_expression !== undefined) {
    const timeZone = (raw.time_zone ?? defaultTimeZone).trim()
    if (timeZone === '') {
      throw new Error('a cron expression needs an explicit time_zone (or a configured default)')
    }
    if (!validTimeZone(timeZone)) {
      throw new Error(`time_zone ${JSON.stringify(timeZone)} is not a valid IANA zone`)
    }
    return { kind: 'cron', expression: raw.cron_expression.trim(), timeZone }
  }
  if (raw.delay_minutes !== undefined) {
    if (raw.delay_minutes < 1 || raw.delay_minutes > MAX_DELAY_MINUTES) {
      throw new Error(`delay_minutes must be an integer from 1 through ${MAX_DELAY_MINUTES}`)
    }
    return { kind: 'once', runAt: new Date(nowMs + raw.delay_minutes * 60_000).toISOString() }
  }
  const interval = raw.interval
  if (interval < 1 || interval > MAX_INTERVAL_VALUE) {
    throw new Error(`interval must be an integer from 1 through ${MAX_INTERVAL_VALUE}`)
  }
  const unit = raw.interval_unit === undefined ? 'minute' : raw.interval_unit
  if (!UNITS.includes(unit)) {
    throw new Error(`interval_unit must be one of ${UNITS.join(', ')}`)
  }
  return { kind: 'interval', everySeconds: interval * INTERVAL_UNIT_SECONDS[unit], unit }
}

/**
 * Optional max_runs validation shared by create and update.
 * @param {number | undefined} maxRuns - caller-supplied bound, or undefined when omitted.
 * @returns {number | null} the validated bound, or null when omitted.
 */
export function optionalMaxRuns(maxRuns) {
  if (maxRuns === undefined) return null
  if (maxRuns < 1 || maxRuns > MAX_MAX_RUNS) {
    throw new Error(`max_runs must be an integer from 1 through ${MAX_MAX_RUNS}`)
  }
  return maxRuns
}

/**
 * Build the durable record for a new automation.
 * @param {object} input - validated caller input (workspaceId, title, prompt, model, optional maxRuns).
 * @param {object} selector - schedule selector (exactly one of its three forms).
 * @param {string} defaultTimeZone - deployment zone fallback.
 * @param {number} nowMs - creation clock.
 * @returns {object} the record to persist.
 */
export function prepareCreate(input, selector, defaultTimeZone, nowMs) {
  const { title, prompt } = scalars(input)
  splitModelRoute(input.model)
  const schedule = buildSchedule(selector, defaultTimeZone, nowMs)
  const nextAtMs = initialNextAtMs(schedule, nowMs)
  if (nextAtMs === null) {
    throw new Error('the cron expression has no future match')
  }
  const stamp = new Date(nowMs).toISOString()
  return {
    id: allocateCronId(),
    workspaceId: input.workspaceId,
    title,
    prompt,
    model: input.model.trim(),
    schedule,
    status: 'active',
    maxRuns: optionalMaxRuns(input.maxRuns),
    runCount: 0,
    nextAt: new Date(nextAtMs).toISOString(),
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: stamp,
    updatedAt: stamp,
  }
}

/**
 * Apply one management update to a current record: scalar edits, pause/resume,
 * schedule replacement, and the completed/max_runs invariants. Pure — the
 * caller persists the result.
 * @param {object} current - the durable record as read.
 * @param {object} input - requested changes; absent fields keep the stored value.
 * @param {object} selector - replacement schedule selector when the schedule is replaced.
 * @param {boolean} hasSelector - whether the schedule is being replaced.
 * @param {string} defaultTimeZone - deployment zone fallback.
 * @param {number} nowMs - decision clock.
 * @returns {object} the next record to persist.
 */
export function applyUpdate(current, input, selector, hasSelector, defaultTimeZone, nowMs) {
  if (current.status === 'completed') {
    throw new Error('the automation already completed; create a new one instead')
  }
  const patch = {}
  if (input.title !== undefined || input.prompt !== undefined) {
    const merged = scalars({ title: input.title ?? current.title, prompt: input.prompt ?? current.prompt })
    patch.title = merged.title
    patch.prompt = merged.prompt
  }
  if (input.model !== undefined) {
    splitModelRoute(input.model)
    patch.model = input.model.trim()
  }
  const nextSchedule = hasSelector ? buildSchedule(selector, defaultTimeZone, nowMs) : current.schedule
  const maxRuns = input.maxRuns === undefined ? current.maxRuns : optionalMaxRuns(input.maxRuns)
  let status = current.status
  if (input.enabled !== undefined) status = input.enabled ? 'active' : 'paused'
  // Invariant: an automation that is not completed is active or paused and
  // always carries a nextAt — advanceDue completes a record rather than
  // clearing its target.
  let nextAtMs
  if (hasSelector || (input.enabled === true && current.status === 'paused')) {
    nextAtMs = resumeNextAtMs(nextSchedule, nowMs)
  } else {
    nextAtMs = Date.parse(current.nextAt)
  }
  const exhausted = maxRuns !== null && current.runCount >= maxRuns
  if (exhausted || nextAtMs === null) status = 'completed'
  return {
    ...current,
    ...patch,
    schedule: nextSchedule,
    status,
    maxRuns,
    nextAt: status === 'completed' ? null : new Date(nextAtMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
  }
}
