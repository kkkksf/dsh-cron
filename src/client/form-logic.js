/**
 * Form pure logic: client-side pre-validation and typed wire serialization.
 * No React — node tests exercise these directly.
 */

/**
 * Common IANA zones for the schedule timezone dropdown; Shanghai first as
 * the deployment default. Values outside the list still render (the form
 * appends the entry's stored zone).
 */
export const TIMEZONES = [
  'Asia/Shanghai', 'UTC', 'Asia/Hong_Kong', 'Asia/Taipei', 'Asia/Tokyo',
  'Asia/Singapore', 'Europe/London', 'Europe/Berlin', 'Europe/Moscow',
  'America/New_York', 'America/Chicago', 'America/Los_Angeles',
]

/**
 * Options for a dropdown that must include one possibly-unlisted current
 * value: the base list plus the value appended when absent.
 * @param {string[]} base - the listed options.
 * @param {string} current - the currently selected value.
 * @returns {string[]} options covering the current value.
 */
export function optionsWithCurrent(base, current) {
  const list = [...(base ?? [])]
  if (current !== undefined && current !== null && current !== '' && !list.includes(current)) {
    list.push(current)
  }
  return list
}

/**
 * Client-side pre-validation of one draft. Returns a map of field → error
 * message; empty object means the draft may be submitted.
 * @param {object} draft - the live form draft.
 * @returns {Record<string, string>} field errors (locale keys).
 */
export function validateDraft(draft) {
  const errors = {}
  if ((draft.title ?? '').trim() === '') errors.title = 'form.titleRequired'
  if ((draft.prompt ?? '').trim() === '') errors.prompt = 'form.promptRequired'
  if (!/^[^\s/]+\/[^\s/]+$/.test((draft.model ?? '').trim())) errors.model = 'form.modelRoute'
  if (draft.kind === 'cron') {
    const fields = (draft.cronExpression ?? '').trim().split(/\s+/)
    if (fields.length !== 5 || fields.some(part => !/^[*/,\-0-9]+$/.test(part))) {
      errors.cronExpression = 'form.cronFiveFields'
    }
  } else if (draft.kind === 'once') {
    if (!/^\d+$/.test((draft.delayMinutes ?? '').trim()) || Number(draft.delayMinutes) < 1) {
      errors.delayMinutes = 'form.delayMinutesInvalid'
    }
  } else if (draft.kind === 'interval') {
    if (!/^\d+$/.test((draft.interval ?? '').trim()) || Number(draft.interval) < 1) {
      errors.interval = 'form.intervalPositive'
    }
  }
  if ((draft.maxRuns ?? '').trim() !== '' && !/^\d+$/.test(draft.maxRuns.trim())) {
    errors.maxRuns = 'form.maxRunsInteger'
  }
  return errors
}

/**
 * Serialize one validated draft into the host wire request. Every field
 * carries its own JSON type: numbers through Number(), never a blanket
 * String().
 * @param {object} draft - the live form draft.
 * @returns {{ workspaceId: string, title: string, prompt: string, model: string, selector: object, max_runs: number | null }} the create request body.
 */
export function serializeForm(draft) {
  const selector = draft.kind === 'once'
    ? { delay_minutes: Number(draft.delayMinutes) }
    : draft.kind === 'interval'
      ? { interval: Number(draft.interval), interval_unit: draft.intervalUnit || 'minute' }
      : {
        cron_expression: draft.cronExpression.trim(),
        ...(draft.timeZone.trim() === '' ? {} : { time_zone: draft.timeZone.trim() }),
      }
  const maxRuns = (draft.maxRuns ?? '').trim()
  return {
    workspaceId: draft.workspaceId,
    title: draft.title.trim(),
    prompt: draft.prompt.trim(),
    model: draft.model.trim(),
    selector,
    // Empty means unlimited: omit the field entirely — the host treats a
    // present null as an invalid bound, not as "no bound".
    ...(maxRuns === '' ? {} : { max_runs: Number(maxRuns) }),
  }
}

/** Seconds per interval unit, mirroring the host's INTERVAL_UNIT_SECONDS. */
const UNIT_SECONDS = { minute: 60, hourly: 3600, hour: 3600, daily: 86_400, day: 86_400, weekly: 604_800, week: 604_800 }

/**
 * Build the edit-form draft from a stored entry: interval/once schedules are
 * rehydrated so editing them validates without retyping, and a once task's
 * remaining delay is recomputed from now (the host re-anchors runAt on save
 * either way).
 * @param {object} entry - the catalog entry being edited (null for create).
 * @param {{ nowMs?: number }} [options] - clock for once rehydration.
 * @returns {object} the form draft.
 */
export function draftFromEntry(entry, options = {}) {
  if (entry === null || entry === undefined) {
    return {
      title: '', prompt: '', model: '', workspaceId: '', kind: 'cron',
      cronExpression: '', timeZone: '', delayMinutes: '', interval: '',
      intervalUnit: 'minute', maxRuns: '',
    }
  }
  const schedule = entry.schedule ?? {}
  const nowMs = options.nowMs ?? Date.now()
  return {
    title: entry.title ?? '',
    prompt: entry.prompt ?? '',
    model: entry.model ?? '',
    workspaceId: entry.workspaceId ?? '',
    kind: schedule.kind === 'interval' ? 'interval' : schedule.kind === 'once' ? 'once' : 'cron',
    cronExpression: schedule.expression ?? '',
    timeZone: schedule.timeZone ?? '',
    delayMinutes: schedule.kind === 'once' && schedule.runAt !== undefined
      ? String(Math.max(1, Math.ceil((Date.parse(schedule.runAt) - nowMs) / 60_000)))
      : '',
    interval: schedule.kind === 'interval' && typeof schedule.everySeconds === 'number'
      ? String(Math.max(1, Math.round(schedule.everySeconds / (UNIT_SECONDS[schedule.unit ?? 'minute'] ?? 60))))
      : '',
    intervalUnit: schedule.kind === 'interval' ? (schedule.unit ?? 'minute') : 'minute',
    maxRuns: entry.maxRuns === null || entry.maxRuns === undefined ? '' : String(entry.maxRuns),
  }
}

/**
 * Remount key for the edit form: any persisted change (updatedAt moves with
 * every host write) rebuilds the form from the fresh entry, which is exactly
 * the spec's conflict flow — refresh first, retype the edit on top.
 * @param {object} entry - the catalog entry.
 * @returns {string} stable-per-version key.
 */
export function editFormKey(entry) {
  return `${entry?.id ?? 'new'}:${entry?.updatedAt ?? '0'}`
}

/**
 * Whether the draft's schedule differs from the stored entry's. Only a real
 * change carries a selector on update — the host recomputes nextAt whenever
 * one is present, which would silently skip a pending occurrence.
 * @param {object} entry - the stored entry.
 * @param {object} draft - the live form draft.
 * @returns {boolean} true when the wire request must replace the schedule.
 */
export function scheduleChanged(entry, draft) {
  const schedule = entry?.schedule ?? {}
  if (draft.kind === 'cron') {
    return schedule.kind !== 'cron'
      || (schedule.expression ?? '') !== draft.cronExpression.trim()
      || (schedule.timeZone ?? '') !== draft.timeZone.trim()
  }
  if (draft.kind === 'interval') {
    return schedule.kind !== 'interval'
      || schedule.everySeconds !== Number(draft.interval) * (UNIT_SECONDS[draft.intervalUnit] ?? 60)
      || (schedule.unit ?? 'minute') !== draft.intervalUnit
  }
  // once: any re-anchored delay is a change (the host re-anchors from now).
  return true
}

/**
 * Map known host error prefixes onto locale keys; unknown messages pass
 * through verbatim (the host vocabulary is English by design).
 * @param {string | undefined} message - the raw error message.
 * @param {(key: string) => string} t - locale binder.
 * @returns {string} user-facing text.
 */
export function localizeError(message, t) {
  const raw = String(message ?? '')
  if (raw === '') return t('error.generic')
  if (raw.startsWith('cron_not_found')) return t('error.cronNotFound')
  if (raw.startsWith('cron_completed')) return t('error.cronCompleted')
  if (raw.startsWith('workspace_not_found')) return t('error.workspaceNotFound')
  if (raw.includes('invalid cron expression')) return t('error.cronInvalid')
  if (raw.startsWith('title must be')) return t('error.titleRange')
  if (raw.startsWith('prompt must be')) return t('error.promptRange')
  if (raw.startsWith('time_zone')) return t('error.timeZone')
  if (raw.startsWith('delay_minutes')) return t('error.delayMinutes')
  if (raw.startsWith('interval')) return t('error.interval')
  if (raw.includes('provider/model')) return t('error.modelRoute')
  if (raw.startsWith('max_runs')) return t('error.maxRuns')
  if (raw.startsWith('pass exactly one of')) return t('error.selector')
  return raw
}
