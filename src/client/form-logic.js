/**
 * Form pure logic: client-side pre-validation and typed wire serialization.
 * No React — node tests exercise these directly.
 */

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
      errors.delayMinutes = 'form.delayMinutes'
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
