/**
 * Automation list pure helpers: filtering, schedule summaries, relative
 * times. Presentation-adjacent but plain, so the panel stays testable in
 * node without React.
 */

/**
 * Filter automations by status bucket and a case-insensitive substring over
 * title, prompt, and cron expression.
 * @param {Array<object>} automations - catalog entries.
 * @param {{ query: string, status: 'all'|'active'|'paused'|'completed' }} filter - current filter.
 * @returns {Array<object>} matching entries, original order.
 */
export function filterAutomations(automations, filter) {
  const query = (filter.query ?? '').trim().toLowerCase()
  return (automations ?? []).filter((entry) => {
    if (filter.status !== 'all' && entry.status !== filter.status) return false
    if (query === '') return true
    const haystack = [
      entry.title ?? '',
      entry.prompt ?? '',
      entry.schedule?.expression ?? '',
    ].join('\n').toLowerCase()
    return haystack.includes(query)
  })
}

/**
 * Render one schedule's summary through the locale's three renderers.
 * @param {object} schedule - the entry's durable schedule rule.
 * @param {{ cron: (s: object) => string, interval: (s: object) => string, once: (s: object) => string }} renderers - locale-bound kind renderers.
 * @returns {string} the summary text; the raw schedule JSON for unknown kinds.
 */
export function scheduleSummary(schedule, renderers) {
  if (schedule === null || typeof schedule !== 'object') return ''
  if (schedule.kind === 'cron') return renderers.cron(schedule)
  if (schedule.kind === 'interval') return renderers.interval(schedule)
  if (schedule.kind === 'once') return renderers.once(schedule)
  return JSON.stringify(schedule)
}

/**
 * Coarse relative time: minutes under an hour, hours under a day, days
 * beyond. Unit labels arrive from the locale (the numbers themselves are
 * language-neutral).
 * @param {string | null} iso - the target instant, or null when none.
 * @param {number} nowMs - reference clock in epoch milliseconds.
 * @param {{ minute: string, hour: string, day: string }} units - locale unit labels.
 * @returns {string} text like "5 分钟" / "3 h", or '' when absent.
 */
export function relativeTime(iso, nowMs, units = { minute: '分钟', hour: '小时', day: '天' }) {
  if (iso === null || iso === undefined) return ''
  const deltaMs = Date.parse(iso) - nowMs
  if (Number.isNaN(deltaMs)) return ''
  const minutes = Math.round(Math.abs(deltaMs) / 60_000)
  if (minutes < 60) return `${minutes} ${units.minute}`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} ${units.hour}`
  return `${Math.round(hours / 24)} ${units.day}`
}
