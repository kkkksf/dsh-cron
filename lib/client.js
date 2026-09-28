/**
 * GENERATED FILE — do not edit. Rebuild: node scripts/build-client.mjs
 * dsh-cron browser half (catalog source + cron panel + entry).
 */
window.__ModuleLoader__.load({
	id: "dsh-cron",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;

		const React = require("react");
		const h = React.createElement;
		const useState = React.useState;
		const useEffect = React.useEffect;

		// ─── src/client/catalog.js ───
		/**
		 * Polling catalog source over the mounted cron remote namespace. Pure logic:
		 * no React, no window — the browser entry injects the remote `call` function,
		 * node tests inject fakes. Envelope discipline: every `result.ok` is checked
		 * before reading `value` (destructured reads of an envelope silently yield
		 * undefined and crash far from the cause).
		 */
		
		/** Client-side descriptors of the host `cron` namespace (see plan Task 4).
		 * Parameter lists must mirror the host methods' real parameter names (the
		 * gateway derives wire fields from them): list() takes none, the rest take
		 * one `request`. Parameter codecs must be strict — the gate checks the mode,
		 * and nothing client-side executes `create`, so a permissive schema stub is
		 * the honest hand-written equivalent of a generated one. */
		const STRICT_REQUEST_CODEC = (method) => Object.freeze({
		  mode: 'strict',
		  typeSymbol: `dsh-cron/${method}.request`,
		  create: () => ({
		    parse: value => value,
		    safeParse: value => ({ success: true, value }),
		  }),
		})
		const RESULT_CODEC = Object.freeze({ mode: 'src-json' })
		const NO_PARAMS = Object.freeze([])
		const REQUEST_PARAMS = (method) => Object.freeze([
		  Object.freeze({
		    name: 'request', wire: 'request', source: 'json',
		    codec: STRICT_REQUEST_CODEC(method),
		  }),
		])
		
		const CRON_DESCRIPTORS = Object.freeze(['list', 'create', 'update', 'toggle', 'delete', 'history']
		  .map(method => Object.freeze({
		    id: `dsh-cron/${method}`,
		    service: 'cron',
		    namespace: 'cron',
		    method,
		    invocation: Object.freeze({ kind: 'direct' }),
		    parameters: method === 'list' ? NO_PARAMS : REQUEST_PARAMS(method),
		    result: RESULT_CODEC,
		  })))
		
		/**
		 * Defensive projection of one catalog snapshot: a crashed or stale read
		 * must never take the whole panel down (a slot contribution that throws is
		 * silently unmounted), so missing containers become empty arrays and a
		 * missing snapshot reads as loading.
		 * @param {object | null | undefined} snapshot - raw snapshot.
		 * @returns {{ phase: string, workspaces: Array, automations: Array, models: Array, error: string | null }} guarded snapshot.
		 */
		function withDefaults(snapshot) {
		  if (snapshot === null || typeof snapshot !== 'object') {
		    return { phase: 'loading', workspaces: [], automations: [], models: [], error: null }
		  }
		  return {
		    phase: typeof snapshot.phase === 'string' ? snapshot.phase : 'loading',
		    workspaces: Array.isArray(snapshot.workspaces) ? snapshot.workspaces : [],
		    automations: Array.isArray(snapshot.automations) ? snapshot.automations : [],
		    models: Array.isArray(snapshot.models) ? snapshot.models : [],
		    error: snapshot.error ?? null,
		  }
		}
		
		/**
		 * One catalog source: a loading/ready/error snapshot store refreshed by
		 * polling, by post-mutation refetch, and by connection reset.
		 * @param {{ call: (method: string, request?: object) => Promise<{ok: boolean, value?: object, error?: {message?: string}}>,
		 *           intervalMs?: number }} options - remote call seam and poll cadence (0 = no timer).
		 * @returns {{ hooks: { catalog: object }, refresh: () => Promise<void>, start: () => Promise<void>, stop: () => void }} the source handle.
		 */
		function createCatalogSource({ call, intervalMs = 5000 }) {
		  const listeners = new Set()
		  let snapshot = { phase: 'loading', workspaces: [], automations: [], models: [], error: null }
		  let timer = null
		  let inflight = Promise.resolve()
		
		  const publish = (next) => {
		    snapshot = next
		    for (const listener of listeners) listener()
		  }
		
		  const refresh = () => {
		    inflight = inflight.then(async () => {
		      try {
		        const result = await call('list')
		        if (result.ok !== true) {
		          throw new Error(String(result.error?.message ?? result.error))
		        }
		        publish({
		          phase: 'ready',
		          workspaces: result.value?.workspaces ?? [],
		          automations: result.value?.automations ?? [],
		          models: result.value?.models ?? [],
		          error: null,
		        })
		      } catch (error) {
		        publish({ ...snapshot, phase: 'error', error: String(error?.message ?? error) })
		      }
		    })
		    return inflight
		  }
		
		  return {
		    hooks: {
		      catalog: {
		        getSnapshot: () => snapshot,
		        subscribe: (listener) => {
		          listeners.add(listener)
		          return () => listeners.delete(listener)
		        },
		      },
		    },
		    refresh,
		    start() {
		      const first = refresh()
		      if (intervalMs > 0) timer = setInterval(() => { void refresh() }, intervalMs)
		      return first
		    },
		    stop() {
		      if (timer !== null) clearInterval(timer)
		      timer = null
		    },
		  }
		}
		
		
		// ─── src/client/list.js ───
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
		function filterAutomations(automations, filter) {		
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
		function scheduleSummary(schedule, renderers) {		
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
		function relativeTime(iso, nowMs, units = { minute: '分钟', hour: '小时', day: '天' }) {		
		  if (iso === null || iso === undefined) return ''		
		  const deltaMs = Date.parse(iso) - nowMs		
		  if (Number.isNaN(deltaMs)) return ''		
		  const minutes = Math.round(Math.abs(deltaMs) / 60_000)		
		  if (minutes < 60) return `${minutes} ${units.minute}`		
		  const hours = Math.round(minutes / 60)		
		  if (hours < 24) return `${hours} ${units.hour}`		
		  return `${Math.round(hours / 24)} ${units.day}`		
		}		
		
		
		// ─── src/client/detail-source.js ───
		/**		
		 * Run-history source: loads `history` calls with last-request-wins		
		 * serialization, keeping stale runs visible on failure. Pure logic — no		
		 * React, no window — so node tests exercise it directly.		
		 */		
				
		/**		
		 * @param {{ call: (method: string, request: object) => Promise<{ok: boolean, value?: object, error?: {message?: string}}> }} options - remote seam.		
		 * @returns {{ hooks: { history: object }, load: (id: string, limit?: number) => Promise<void> }} the source handle.		
		 */		
		function createHistorySource({ call }) {		
		  const listeners = new Set()		
		  let snapshot = { phase: 'idle', runs: [], error: null }		
		  let latestKey = 0		
				
		  const publish = (next) => {		
		    snapshot = next		
		    for (const listener of listeners) listener()		
		  }		
				
		  const load = async (id, limit = 10) => {		
		    const key = ++latestKey		
		    try {		
		      const result = await call('history', { id, limit })		
		      if (key !== latestKey) return		
		      if (result.ok !== true) {		
		        throw new Error(String(result.error?.message ?? result.error))		
		      }		
		      publish({ phase: 'ready', runs: result.value?.runs ?? [], error: null })		
		    } catch (error) {		
		      if (key !== latestKey) return		
		      publish({ ...snapshot, phase: 'error', error: String(error?.message ?? error) })		
		    }		
		  }		
				
		  return {		
		    hooks: {		
		      history: {		
		        getSnapshot: () => snapshot,		
		        subscribe: (listener) => {		
		          listeners.add(listener)		
		          return () => listeners.delete(listener)		
		        },		
		      },		
		    },		
		    load,		
		  }		
		}		
		
		
		// ─── src/client/actions.js ───
		/**		
		 * Shared action feedback state machine for the detail pane's operations		
		 * (toggle / delete): one busy window, failures surface their message,		
		 * success clears it. Pure logic — React wiring lives in detail.js.		
		 */		
				
		/**		
		 * @returns {{ snapshot: () => { phase: 'idle'|'busy'|'error', message: string | null },		
		 *            subscribe: (listener: () => void) => () => void,		
		 *            run: (tag: string, op: () => Promise<{ ok: boolean, error?: { message?: string } }>) => Promise<boolean> }} the machine.		
		 */		
		function createActionFeedback() {		
		  const listeners = new Set()		
		  let state = { phase: 'idle', message: null }		
				
		  const publish = (next) => {		
		    state = next		
		    for (const listener of listeners) listener()		
		  }		
				
		  const run = async (tag, op) => {		
		    if (state.phase === 'busy') return false		
		    publish({ phase: 'busy', message: null })		
		    const result = await op()		
		    if (result.ok !== true) {		
		      publish({ phase: 'error', message: String(result.error?.message ?? result.error ?? 'operation failed') })		
		      return false		
		    }		
		    publish({ phase: 'idle', message: null })		
		    return true		
		  }		
				
		  return {		
		    snapshot: () => state,		
		    subscribe: (listener) => {		
		      listeners.add(listener)		
		      return () => listeners.delete(listener)		
		    },		
		    run,		
		  }		
		}		
		
		
		// ─── src/client/detail.js ───
		/**		
		 * The detail pane: one automation's fields, run history, and the action		
		 * buttons. Data arrives through the injected catalog entry and a history		
		 * source over the same `call` seam the catalog uses.		
		 */		
				
				
		/** One run-history row. */		
		function RunRow({ run, openSession, t }) {		
		  const status = run.status ?? 'unknown'		
		  const duration = typeof run.durationMs === 'number' ? `${Math.round(run.durationMs / 1000)}s` : ''		
		  return h('li', { className: 'dsh-cron-run' },		
		    h('span', { className: `dsh-cron-run-status dsh-cron-run-${status}`, 'aria-hidden': 'true' }),		
		    h('span', { className: 'dsh-cron-run-main' },		
		      h('span', null, `${run.startedAt ?? ''} · ${t(`run.${status}`)}`),		
		      h('span', { className: 'dsh-cron-run-sub' }, [		
		        duration,		
		        run.error ?? '',		
		      ].filter(part => part !== '').join(' · '))),		
		    run.sessionId != null && h('button', {		
		      type: 'button',		
		      className: 'dsh-cron-run-open',		
		      disabled: openSession === null,		
		      title: openSession === null ? t('detail.sessionUnavailable') : undefined,		
		      onClick: () => { if (openSession !== null) openSession(run.sessionId) },		
		    }, t('detail.openSession')),		
		  )		
		}		
				
		/** The detail pane for the selected automation. */		
		function DetailPane({ entry, workspaces, call, openSession, offline = false, onEdit, onToggle, onDelete, t }) {		
		  const [historySource] = useState(() => createHistorySource({ call }))		
		  const [historyLimit, setHistoryLimit] = useState(10)		
		  const [snap, setSnap] = useState(() => historySource.hooks.history.getSnapshot())		
		  const [feedbackMachine] = useState(() => createActionFeedback())		
		  const [actionState, setActionState] = useState(() => feedbackMachine.snapshot())		
		  const [confirmingDelete, setConfirmingDelete] = useState(false)		
		  useEffect(() => {		
		    setSnap(historySource.hooks.history.getSnapshot())		
		    return historySource.hooks.history.subscribe(() => setSnap(historySource.hooks.history.getSnapshot()))		
		  }, [historySource])		
		  useEffect(() => feedbackMachine.subscribe(() => setActionState(feedbackMachine.snapshot())), [feedbackMachine])		
		  useEffect(() => { setConfirmingDelete(false) }, [entry?.id])		
		  useEffect(() => {		
		    if (entry?.id !== undefined) void historySource.load(entry.id, historyLimit)		
		  }, [historySource, entry?.id, historyLimit])		
				
		  if (entry === null || entry === undefined) {		
		    return h('div', { className: 'dsh-cron-detail dsh-cron-detail-empty' },		
		      h('p', { className: 'dsh-cron-hint' }, t('detail.empty')))		
		  }		
				
		  const busy = actionState.phase === 'busy' || offline		
		  const runToggle = () => {		
		    void feedbackMachine.run('toggle', async () => onToggle())		
		  }		
		  const runDelete = () => {		
		    void feedbackMachine.run('delete', async () => onDelete())		
		  }		
				
		  const workspace = (workspaces ?? []).find(w => w.id === entry.workspaceId)		
		  const summary = scheduleSummary(entry.schedule, {		
		    cron: s => `${s.expression ?? ''} (${s.timeZone ?? 'UTC'})`,		
		    interval: s => t('schedule.interval', { seconds: s.everySeconds ?? 0 }),		
		    once: s => `${t('schedule.once')} ${s.runAt ?? ''}`,		
		  })		
		  const field = (label, value) => h('div', { className: 'dsh-cron-field' },		
		    h('span', { className: 'dsh-cron-field-label' }, label),		
		    h('span', { className: 'dsh-cron-field-value' }, value))		
				
		  return h('div', { className: 'dsh-cron-detail' },		
		    h('div', { className: 'dsh-cron-detail-head' },		
		      h('h3', { className: 'dsh-cron-detail-title' }, entry.title ?? t('list.untitled')),		
		      h('div', { className: 'dsh-cron-detail-actions' },		
		        h('button', { type: 'button', disabled: busy, onClick: onEdit }, t('detail.edit')),		
		        entry.status !== 'completed' && h('button', { type: 'button', disabled: busy, onClick: runToggle },		
		          entry.status === 'active' ? t('detail.pause') : t('detail.resume')),		
		        !confirmingDelete && h('button', {		
		          type: 'button', className: 'dsh-cron-danger', disabled: busy,		
		          onClick: () => { setConfirmingDelete(true) },		
		        }, t('detail.delete')),		
		        confirmingDelete && h('span', { className: 'dsh-cron-confirm' },		
		          h('span', null, t('detail.confirmDelete')),		
		          h('button', {		
		            type: 'button', className: 'dsh-cron-danger', disabled: busy,		
		            onClick: runDelete,		
		          }, t('detail.delete')),		
		          h('button', { type: 'button', disabled: busy, onClick: () => { setConfirmingDelete(false) } }, t('form.cancel'))))),		
		    actionState.phase === 'error' && h('p', { className: 'dsh-cron-banner-error' },		
		      localizeError(actionState.message, t)),		
		    field(t('detail.workspace'), workspace?.name ?? entry.workspaceId ?? ''),		
		    field(t('detail.model'), entry.model ?? ''),		
		    field(t('detail.schedule'), summary),		
		    field(t('detail.next'), entry.nextAt ?? t('list.noNext')),		
		    field(t('detail.last'),		
		      `${entry.lastRunAt ?? ''} ${entry.lastRunStatus ?? ''}`.trim() || t('list.noNext')),		
		    field(t('detail.runs'), `${entry.runCount ?? 0}${entry.maxRuns === null ? '' : ` / ${entry.maxRuns}`}`),		
		    h('h4', { className: 'dsh-cron-history-title' }, t('detail.history')),		
		    snap.phase === 'error' && h('p', { className: 'dsh-cron-banner-error' }, localizeError(snap.error, t)),		
		    (snap.runs ?? []).length === 0 && snap.phase === 'ready' && h('p', { className: 'dsh-cron-hint' }, t('detail.noRuns')),		
		    h('ul', { className: 'dsh-cron-runs' },		
		      (snap.runs ?? []).map(run => h(RunRow, { key: run.id, run, openSession, t }))),		
		    (snap.runs ?? []).length >= historyLimit && h('button', {		
		      type: 'button', className: 'dsh-cron-more',		
		      onClick: () => { setHistoryLimit(Math.min(historyLimit + 20, 200)) },		
		    }, t('detail.more')),		
		  )		
		}		
		
		
		// ─── src/client/form-logic.js ───
		/**		
		 * Form pure logic: client-side pre-validation and typed wire serialization.		
		 * No React — node tests exercise these directly.		
		 */		
				
		/**		
		 * Common IANA zones for the schedule timezone dropdown; Shanghai first as		
		 * the deployment default. Values outside the list still render (the form		
		 * appends the entry's stored zone).		
		 */		
		const TIMEZONES = [		
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
		function optionsWithCurrent(base, current) {		
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
		function validateDraft(draft) {		
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
		function serializeForm(draft) {		
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
		function draftFromEntry(entry, options = {}) {		
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
		function editFormKey(entry) {		
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
		function scheduleChanged(entry, draft) {		
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
		function localizeError(message, t) {		
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
		
		
		// ─── src/client/form.js ───
		/**		
		 * The create/edit form component: typed serialization and client-side		
		 * pre-validation live in form-logic.js (host validation stays		
		 * authoritative); this module owns the React surface and the conflict		
		 * notice flow.		
		 */		
				
				
		/** One labeled input row with its inline error. */		
		function Field({ label, error, children }) {		
		  return h('label', { className: 'dsh-cron-form-field' },		
		    h('span', { className: 'dsh-cron-field-label' }, label),		
		    children,		
		    error !== undefined && h('span', { className: 'dsh-cron-form-error' }, error),		
		  )		
		}		
				
		/**		
		 * The create/edit form component.		
		 * @param {object} props - mode ('create'|'edit'), entry (edit baseline), workspaces, defaults, callbacks.		
		 */		
		function CronForm(props) {		
		  const t = props.t ?? (() => '')		
		  const entry = props.entry		
		  const [draft, setDraft] = useState(() => ({		
		    ...draftFromEntry(entry),		
		    model: entry?.model ?? props.defaultModel ?? '',		
		    workspaceId: entry?.workspaceId ?? props.defaultWorkspaceId ?? '',		
		    // The select always shows a concrete zone; create starts at the default.		
		    timeZone: entry?.schedule?.timeZone ?? props.defaultTimeZone ?? TIMEZONES[0],		
		  }))		
		  const [busy, setBusy] = useState(false)		
		  const [notice, setNotice] = useState(null)		
		  const [fieldErrors, setFieldErrors] = useState({})		
		  const edit = (key, value) => { setDraft(current => ({ ...current, [key]: value })) }		
				
		  const submit = async () => {		
		    const errors = validateDraft(draft)		
		    setFieldErrors(errors)		
		    if (Object.keys(errors).length > 0) return		
		    setBusy(true)		
		    setNotice(null)		
		    try {		
		      const outcome = await props.onSubmit(draft, serializeForm(draft))		
		      if (outcome === 'conflict') setNotice('form.conflict')		
		      else if (outcome !== true && typeof outcome === 'string') setNotice(outcome)		
		    } catch (error) {		
		      setNotice(String(error?.message ?? error))		
		    } finally {		
		      setBusy(false)		
		    }		
		  }		
				
		  const err = (key) => (fieldErrors[key] === undefined ? undefined : t(fieldErrors[key]))		
				
		  return h('div', { className: 'dsh-cron-detail dsh-cron-form' },		
		    h('div', { className: 'dsh-cron-detail-head' },		
		      h('h3', { className: 'dsh-cron-detail-title' }, t(props.mode === 'create' ? 'form.newTitle' : 'form.editTitle')),		
		      h('div', { className: 'dsh-cron-detail-actions' },		
		        h('button', { type: 'button', disabled: busy, onClick: submit }, busy ? t('form.saving') : t('form.save')),		
		        h('button', { type: 'button', disabled: busy, onClick: props.onCancel }, t('form.cancel')))),		
		    notice !== null && h('p', { className: 'dsh-cron-banner-error' }, notice === 'form.conflict' ? t('form.conflict') : notice),		
		    h(Field, { label: t('form.title'), error: err('title') },		
		      h('input', { type: 'text', value: draft.title, onChange: e => { edit('title', e.target.value) } })),		
		    h(Field, { label: t('form.workspace'), error: err('workspaceId') },		
		      h('select', {		
		        value: draft.workspaceId,		
		        onChange: e => { edit('workspaceId', e.target.value) },		
		      }, (props.workspaces ?? []).map(w =>		
		        h('option', { key: w.id, value: w.id }, w.name ?? w.id)))),		
		    h(Field, { label: t('form.model'), error: err('model') },		
		      h('select', {		
		        value: draft.model,		
		        onChange: e => { edit('model', e.target.value) },		
		      }, h('option', { value: '' }, t('form.modelPlaceholder')),		
		        optionsWithCurrent(props.models, draft.model).map(route =>		
		          h('option', { key: route, value: route }, route)))),		
		    h(Field, { label: t('form.scheduleKind'), error: undefined },		
		      h('select', { value: draft.kind, onChange: e => { edit('kind', e.target.value) } },		
		        h('option', { value: 'cron' }, t('form.kindCron')),		
		        h('option', { value: 'interval' }, t('form.kindInterval')),		
		        h('option', { value: 'once' }, t('form.kindOnce')))),		
		    draft.kind === 'cron' && h(Field, { label: t('form.cronExpression'), error: err('cronExpression') },		
		      h('input', { type: 'text', value: draft.cronExpression, placeholder: '0 9 * * 1-5',		
		        onChange: e => { edit('cronExpression', e.target.value) } }),		
		      h('select', { value: draft.timeZone, onChange: e => { edit('timeZone', e.target.value) } },		
		        optionsWithCurrent(TIMEZONES, draft.timeZone).map(zone =>		
		          h('option', { key: zone, value: zone }, zone))),		
		      err('cronExpression') === undefined && h('span', { className: 'dsh-cron-form-hint' }, t('form.cronHint'))),		
		    draft.kind === 'interval' && h(Field, { label: t('form.interval'), error: err('interval') },		
		      h('input', { type: 'number', min: '1', value: draft.interval,		
		        onChange: e => { edit('interval', e.target.value) } }),		
		      h('select', { value: draft.intervalUnit, onChange: e => { edit('intervalUnit', e.target.value) } },		
		        ['minute', 'hourly', 'daily', 'weekly'].map(unit =>		
		          h('option', { key: unit, value: unit }, unit)))),		
		    draft.kind === 'once' && h(Field, { label: t('form.delayMinutes'), error: err('delayMinutes') },		
		      h('input', { type: 'number', min: '1', value: draft.delayMinutes,		
		        onChange: e => { edit('delayMinutes', e.target.value) } })),		
		    h(Field, { label: t('form.maxRuns'), error: err('maxRuns') },		
		      h('input', { type: 'number', min: '1', value: draft.maxRuns,		
		        onChange: e => { edit('maxRuns', e.target.value) } })),		
		    h(Field, { label: t('form.prompt'), error: err('prompt') },		
		      h('textarea', { rows: 6, value: draft.prompt,		
		        onChange: e => { edit('prompt', e.target.value) } })),		
		  )		
		}		
		
		
		// ─── src/client/page.js ───
		/**		
		 * The cron panel main page: toolbar (search / status filter) + automation		
		 * list. Components receive all data through injected props (catalog snapshot		
		 * source + actions), never ctx.		
		 */		
				
				
		/** Stand-in observable for a missing catalog source: stays loading forever. */		
		const NO_SOURCE = {		
		  getSnapshot: () => ({ phase: 'loading', workspaces: [], automations: [], error: null }),		
		  subscribe: () => () => {},		
		}		
				
		/** Local subscription over one observable snapshot prop (dsh-memory pattern). */		
		function useSnapshot(source) {		
		  const [snap, setSnap] = useState(() => source.getSnapshot())		
		  useEffect(() => source.subscribe(() => setSnap(source.getSnapshot())), [source])		
		  return snap		
		}		
				
		/** One status bucket's filter chip. */		
		function FilterChip({ value, active, label, onSelect }) {		
		  return h('button', {		
		    type: 'button',		
		    className: `dsh-cron-chip${active ? ' dsh-cron-chip-active' : ''}`,		
		    'aria-pressed': active,		
		    onClick: () => { onSelect(value) },		
		  }, label)		
		}		
				
		/** One automation row. */		
		function AutomationRow({ entry, workspaces, selected, onSelect, t }) {		
		  const workspace = (workspaces ?? []).find(w => w.id === entry.workspaceId)		
		  const units = { minute: t('time.minute'), hour: t('time.hour'), day: t('time.day') }		
		  const summary = scheduleSummary(entry.schedule, {		
		    cron: s => s.expression ?? '',		
		    interval: s => t('schedule.interval', { seconds: s.everySeconds ?? 0 }),		
		    once: s => t('schedule.once'),		
		  })		
		  const next = entry.nextAt === null		
		    ? t('list.noNext')		
		    : `${t('list.next')} ${relativeTime(entry.nextAt, Date.now(), units)}`		
		  return h('button', {		
		    type: 'button',		
		    className: `dsh-cron-row${selected ? ' dsh-cron-row-selected' : ''}`,		
		    onClick: () => { onSelect(entry.id) },		
		  },		
		    h('span', { className: `dsh-cron-dot dsh-cron-dot-${entry.status ?? 'active'}`, 'aria-hidden': 'true' }),		
		    h('span', { className: 'dsh-cron-row-main' },		
		      h('span', { className: 'dsh-cron-row-title' }, entry.title ?? t('list.untitled')),		
		      h('span', { className: 'dsh-cron-row-sub' },		
		        `${summary} · ${next}`)),		
		    h('span', { className: 'dsh-cron-row-badge' }, workspace?.name ?? entry.workspaceId ?? ''),		
		  )		
		}		
				
		/** The cron panel page: toolbar + list on the left, detail/form on the right. */		
		function CronPage(props) {		
		  // Hooks are unconditional (Rules of Hooks): a missing source reads as a		
		  // perpetual loading state instead of crashing the panel slot.		
		  const snapshot = withDefaults(useSnapshot(props.catalogSource ?? NO_SOURCE))		
		  const automations = snapshot.automations		
		  const workspaces = snapshot.workspaces		
		  const offline = snapshot.phase === 'error'		
		  const t = props.t ?? (() => '')		
		  const localize = (message) => localizeError(message, t)		
		  const call = props.call		
		  const refresh = props.refresh ?? (() => {})		
		  const [query, setQuery] = useState('')		
		  const [status, setStatus] = useState('all')		
		  const [selectedId, setSelectedId] = useState(null)		
		  const [formMode, setFormMode] = useState('none') // 'none' | 'create' | 'edit'		
		  const visible = filterAutomations(automations, { query, status })		
		  const selected = selectedId === null		
		    ? null		
		    : (automations.find(entry => entry.id === selectedId) ?? null)		
				
		  /** Submit the form over create/update; returns the form's outcome token. */		
		  const submitForm = async (draft, wire) => {		
		    if (formMode === 'create') {		
		      const result = await call('create', wire)		
		      if (result.ok !== true) return localize(result.error?.message)		
		      setFormMode('none')		
		      setSelectedId(result.value?.id ?? null)		
		      await refresh()		
		      return true		
		    }		
		    const result = await call('update', {		
		      id: selected?.id,		
		      expectedNextAt: selected?.nextAt ?? null,		
		      changes: {		
		        title: wire.title,		
		        prompt: wire.prompt,		
		        model: wire.model,		
		        ...(wire.max_runs === undefined ? {} : { max_runs: wire.max_runs }),		
		        // Only a real schedule change carries a selector: the host		
		        // recomputes nextAt whenever one is present, which would silently		
		        // skip a pending occurrence on a title-only edit.		
		        ...(scheduleChanged(selected, draft) ? { selector: wire.selector } : {}),		
		      },		
		    })		
		    if (result.ok !== true) return localize(result.error?.message)		
		    await refresh()		
		    if (result.value?.outcome === 'conflict') return 'conflict'		
		    setFormMode('none')		
		    return true		
		  }		
				
		  const detailOrForm = formMode === 'none'		
		    ? h(DetailPane, {		
		      entry: selected, workspaces,		
		      call,		
		      openSession: props.openSession ?? null,		
		      offline,		
		      onEdit: selected === null ? null : () => { setFormMode('edit') },		
		      onToggle: selected === null ? null : async () => {		
		        const result = await call('toggle', { id: selected.id, enabled: selected.status !== 'active' })		
		        if (result.ok === true) await refresh()		
		        return result		
		      },		
		      onDelete: selected === null ? null : async () => {		
		        const result = await call('delete', { id: selected.id })		
		        if (result.ok === true) { setSelectedId(null); await refresh() }		
		        return result		
		      },		
		      t,		
		    })		
		    : h(CronForm, {		
		      key: editFormKey(selected),		
		      mode: formMode,		
		      entry: formMode === 'edit' ? selected : null,		
		      workspaces,		
		      models: snapshot.models,		
		      defaultWorkspaceId: props.defaultWorkspaceId ?? workspaces[0]?.id,		
		      defaultModel: props.defaultModel,		
		      defaultTimeZone: props.defaultTimeZone,		
		      onSubmit: submitForm,		
		      onCancel: () => { setFormMode('none') },		
		      t,		
		    })		
				
		  return h('div', { className: `dsh-cron-page${selected !== null || formMode !== 'none' ? ' dsh-cron-has-detail' : ''}` },		
		    offline && h('p', { className: 'dsh-cron-banner-error', role: 'alert' },		
		      `${t('banner.disconnected')}${snapshot.error ? `（${localize(snapshot.error)}）` : ''}`),		
		    h('div', { className: 'dsh-cron-master' },		
		      h('div', { className: 'dsh-cron-toolbar' },		
		        h('input', {		
		          type: 'search', className: 'dsh-cron-search',		
		          placeholder: t('search.placeholder'), value: query,		
		          onChange: event => { setQuery(event.target.value) },		
		          'aria-label': t('search.placeholder'),		
		        }),		
		        h('div', { className: 'dsh-cron-filters', role: 'group', 'aria-label': t('filter.group') },		
		          ['all', 'active', 'paused', 'completed'].map(value =>		
		            h(FilterChip, {		
		              key: value, value, active: status === value,		
		              label: t(`filter.${value}`), onSelect: setStatus,		
		            }))),		
		        h('button', {		
		          type: 'button', className: 'dsh-cron-new', disabled: offline,		
		          onClick: () => { setSelectedId(null); setFormMode('create') },		
		        }, t('form.new'))),		
		      snapshot.phase === 'loading' && h('p', { className: 'dsh-cron-hint' }, t('loading')),		
		      h('div', { className: 'dsh-cron-list', role: 'list' },		
		        visible.length === 0 && snapshot.phase === 'ready' && h('p', { className: 'dsh-cron-hint' }, t('list.empty')),		
		        visible.map(entry => h(AutomationRow, {		
		          key: entry.id, entry, workspaces, selected: entry.id === selectedId,		
		          onSelect: id => { setFormMode('none'); setSelectedId(id) },		
		          t,		
		        }))),		
		    ),		
		    detailOrForm,		
		  )		
		}		
				
		/** Sidebar panel icon: clock glyph, sized by the shell. */		
		function CronIcon({ size }) {		
		  return h('svg', {		
		    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',		
		    'aria-hidden': 'true', stroke: 'currentColor', 'stroke-width': '1.8',		
		  },		
		    h('circle', { cx: '12', cy: '12', r: '9' }),		
		    h('path', { d: 'M12 7v5l3.5 2', 'stroke-linecap': 'round' }),		
		  )		
		}		
		
		
		// ─── src/client/styles.js ───
		/**		
		 * Panel styles: one injected <style> element, class prefix dsh-cron-*, all		
		 * colors/fonts/radii through the shared --dsw-* theme tokens so dark mode		
		 * follows automatically. Injected once from the entry.		
		 */		
				
		/** Idempotently install the panel stylesheet. */		
		function installStyles() {		
		  const id = 'dsh-cron-styles'		
		  if (document.getElementById(id) !== null) return		
		  const style = document.createElement('style')		
		  style.id = id		
		  style.textContent = `		
		.dsh-cron-page { display: flex; height: 100%; min-height: 0; font-size: 13px;		
		  color: var(--dsw-alias-label-primary); font-family: var(--dsw-font-family); }		
		.dsh-cron-master { display: flex; flex-direction: column; min-width: 320px; width: 38%;		
		  border-right: 1px solid var(--dsw-alias-border-inverted); padding: 16px 12px; gap: 8px; min-height: 0; }		
		.dsh-cron-page.dsh-cron-has-detail .dsh-cron-master { width: 34%; }		
		.dsh-cron-detail { flex: 1; overflow-y: auto; padding: 20px 24px; min-width: 0; }		
		.dsh-cron-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }		
		.dsh-cron-search { flex: 1; min-width: 120px; padding: 5px 10px; border-radius: var(--dsw-radius-sm);		
		  border: 1px solid var(--dsw-alias-border-inverted); background: transparent;		
		  color: var(--dsw-alias-label-primary); font-size: 13px; }		
		.dsh-cron-filters { display: flex; gap: 4px; }		
		.dsh-cron-chip { padding: 4px 10px; border-radius: 999px; border: 1px solid transparent;		
		  background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 12px; }		
		.dsh-cron-chip:hover { background: var(--dsw-alias-interactive-bg-hover); }		
		.dsh-cron-chip-active { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }		
		.dsh-cron-new { padding: 4px 10px; border-radius: var(--dsw-radius-sm); cursor: pointer; font-size: 12px;		
		  border: 1px solid var(--dsw-alias-border-inverted); background: transparent; color: var(--dsw-alias-label-primary); }		
		.dsh-cron-new:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }		
		.dsh-cron-new:disabled { opacity: .5; cursor: not-allowed; }		
		.dsh-cron-list { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; min-height: 0; }		
		.dsh-cron-row { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;		
		  padding: 8px 10px; border-radius: var(--dsw-radius-sm); border: none; cursor: pointer;		
		  background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; }		
		.dsh-cron-row:hover { background: var(--dsw-alias-interactive-bg-hover); }		
		.dsh-cron-row-selected { background: var(--dsw-alias-interactive-bg-active); }		
		.dsh-cron-row-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }		
		.dsh-cron-row-title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }		
		.dsh-cron-row-sub { color: var(--dsw-alias-label-secondary); font-size: 12px; overflow: hidden;		
		  text-overflow: ellipsis; white-space: nowrap; }		
		.dsh-cron-row-badge { font-size: 11px; color: var(--dsw-alias-label-secondary);		
		  border: 1px solid var(--dsw-alias-border-inverted); border-radius: 999px; padding: 1px 8px;		
		  max-width: 90px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }		
		.dsh-cron-dot, .dsh-cron-run-status { width: 8px; height: 8px; border-radius: 50%; flex: none; }		
		.dsh-cron-dot-active, .dsh-cron-run-succeeded, .dsh-cron-run-claimed, .dsh-cron-run-running { background: var(--dsw-alias-state-success-primary); }		
		.dsh-cron-run-running, .dsh-cron-run-claimed { background: var(--dsw-alias-state-warn-primary); }		
		.dsh-cron-dot-paused { background: var(--dsw-alias-label-secondary); }		
		.dsh-cron-dot-completed, .dsh-cron-run-failed { background: var(--dsw-alias-state-error-primary); }		
		.dsh-cron-run-skipped { background: var(--dsw-alias-state-warn-primary); }		
		.dsh-cron-hint { color: var(--dsw-alias-label-secondary); font-size: 12px; margin: 8px 0; }		
		.dsh-cron-banner-error { color: var(--dsw-alias-state-error-primary); font-size: 12px; margin: 0 0 8px; }		
		.dsh-cron-detail-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }		
		.dsh-cron-detail-title { margin: 0; font-size: 16px; font-weight: 600; }		
		.dsh-cron-detail-actions { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }		
		.dsh-cron-detail-actions button, .dsh-cron-confirm button { padding: 4px 10px; border-radius: var(--dsw-radius-sm);		
		  border: 1px solid var(--dsw-alias-border-inverted); background: transparent; cursor: pointer;		
		  color: var(--dsw-alias-label-primary); font-size: 12px; }		
		.dsh-cron-detail-actions button:hover:not(:disabled), .dsh-cron-confirm button:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }		
		.dsh-cron-detail-actions button:disabled, .dsh-cron-confirm button:disabled { opacity: .5; cursor: not-allowed; }		
		.dsh-cron-danger { color: var(--dsw-alias-state-error-primary) !important; }		
		.dsh-cron-confirm { display: inline-flex; gap: 6px; align-items: center; font-size: 12px; color: var(--dsw-alias-state-warn-label); }		
		.dsh-cron-field { display: grid; grid-template-columns: 90px 1fr; gap: 8px; padding: 4px 0; align-items: baseline; }		
		.dsh-cron-field-label { color: var(--dsw-alias-label-secondary); font-size: 12px; }		
		.dsh-cron-field-value { word-break: break-all; }		
		.dsh-cron-history-title { margin: 16px 0 8px; font-size: 13px; }		
		.dsh-cron-runs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }		
		.dsh-cron-run { display: flex; align-items: center; gap: 8px; font-size: 12px; }		
		.dsh-cron-run-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }		
		.dsh-cron-run-sub { color: var(--dsw-alias-state-error-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }		
		.dsh-cron-run-open { padding: 2px 8px; border-radius: var(--dsw-radius-sm); border: 1px solid var(--dsw-alias-border-inverted);		
		  background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font-size: 11px; }		
		.dsh-cron-run-open:disabled { opacity: .5; cursor: not-allowed; }		
		.dsh-cron-more { margin-top: 8px; padding: 4px 10px; border-radius: var(--dsw-radius-sm);		
		  border: 1px solid var(--dsw-alias-border-inverted); background: transparent; cursor: pointer;		
		  color: var(--dsw-alias-label-secondary); font-size: 12px; }		
		.dsh-cron-form-field { display: grid; grid-template-columns: 120px 1fr; gap: 8px; padding: 6px 0;		
		  align-items: baseline; }		
		.dsh-cron-form-field input, .dsh-cron-form-field select, .dsh-cron-form-field textarea {		
		  padding: 5px 8px; border-radius: var(--dsw-radius-sm); border: 1px solid var(--dsw-alias-border-inverted);		
		  background: transparent; color: var(--dsw-alias-label-primary); font-size: 13px; width: 100%;		
		  box-sizing: border-box; }		
		.dsh-cron-form-field input:not(:last-child) { margin-bottom: 4px; }		
		.dsh-cron-form-error { grid-column: 2; color: var(--dsw-alias-state-error-primary); font-size: 11px; }		
		.dsh-cron-form-hint { grid-column: 2; color: var(--dsw-alias-label-secondary); font-size: 11px; }		
		.dsh-cron-detail-empty { display: flex; align-items: center; justify-content: center; }		
		`		
		  document.head.appendChild(style)		
		}		
		
		
		// ─── src/client/entry.js ───
		/**		
		 * Browser-half entry: mounts the cron remote namespace, starts the polling		
		 * catalog, and registers the sidebar icon + keyed main panel. All cleanup		
		 * rides the plugin fiber's effect disposer.		
		 */		
				
		exports.name = 'dsh-cron-client'		
		exports.inject = ['slots', 'locale', 'remote', 'typert', 'uiWorkspace']		
		exports.apply = function apply(ctx) {		
		  installStyles()		
		  ctx.effect(() => ctx.locale.register('cron.manager', {		
		    zh: {		
		      panel: '定时任务', loading: '加载中…', error: '加载失败',		
		      'search.placeholder': '搜索标题 / 提示词 / 表达式', 'filter.group': '状态筛选',		
		      'filter.all': '全部', 'filter.active': '启用', 'filter.paused': '停用', 'filter.completed': '已完结',		
		      'list.untitled': '未命名任务', 'list.empty': '没有匹配的自动化', 'list.next': '下次', 'list.noNext': '无下次执行',		
		      'schedule.interval': '每 {seconds} 秒', 'schedule.once': '一次性',		
		      'detail.empty': '选择一个任务查看详情', 'detail.edit': '编辑', 'detail.pause': '停用', 'detail.resume': '启用',		
		      'detail.delete': '删除', 'detail.workspace': '工作区', 'detail.model': '模型路由', 'detail.schedule': '调度规则',		
		      'detail.next': '下次执行', 'detail.last': '最近执行', 'detail.runs': '执行次数', 'detail.history': '运行历史',		
		      'detail.noRuns': '还没有运行记录', 'detail.more': '加载更多', 'detail.openSession': '打开会话',		
		      'detail.sessionUnavailable': '无法打开会话', 'detail.confirmDelete': '确认删除？',		
		      'banner.disconnected': '连接已断开，重连后自动恢复',		
		      'time.minute': '分钟', 'time.hour': '小时', 'time.day': '天',		
		      'error.generic': '操作失败', 'error.cronNotFound': '任务不存在（可能已被删除）', 'error.cronCompleted': '任务已完结，请新建',		
		      'error.workspaceNotFound': '工作区不存在', 'error.cronInvalid': 'cron 表达式非法（须为五段）', 'error.titleRange': '标题长度须为 1-80 字符',		
		      'error.promptRange': '提示词长度超出限制', 'error.timeZone': '时区无效', 'error.delayMinutes': '延迟分钟数超出范围',		
		      'error.interval': '间隔数值超出范围', 'error.modelRoute': '模型路由须为 provider/model', 'error.maxRuns': '最大执行次数超出范围',		
		      'error.selector': '调度参数须三选一',		
		      'run.succeeded': '成功', 'run.failed': '失败', 'run.skipped': '跳过', 'run.claimed': '已认领', 'run.running': '运行中', 'run.unknown': '未知',		
		      'form.new': '＋新建', 'form.newTitle': '新建自动化', 'form.editTitle': '编辑自动化', 'form.save': '保存', 'form.saving': '保存中…',		
		      'form.cancel': '取消', 'form.conflict': '任务已被修改，已刷新为最新值，请重试',		
		      'form.title': '标题', 'form.titleRequired': '标题不能为空', 'form.workspace': '工作区', 'form.model': '模型路由',		
		      'form.modelPlaceholder': '选择模型路由', 'form.modelRoute': '格式须为 provider/model', 'form.scheduleKind': '调度方式', 'form.kindCron': 'cron 表达式',		
		      'form.kindInterval': '固定间隔', 'form.kindOnce': '一次性延迟', 'form.cronExpression': 'cron 表达式（五段）',		
		      'form.cronFiveFields': '须为五段表达式', 'form.interval': '间隔', 'form.intervalPositive': '须为正整数',		
		      'form.cronHint': '五段「分 时 日 月 周」：0 9 * * * = 每天 9 点 · 0 9 * * 1-5 = 工作日 9 点 · */15 * * * * = 每 15 分钟',		
		      'form.delayMinutes': '延迟分钟数', 'form.maxRuns': '最大执行次数（空 = 不限）', 'form.maxRunsInteger': '须为整数',		
		      'form.prompt': '提示词', 'form.promptRequired': '提示词不能为空',		
		    },		
		    en: {		
		      panel: 'Cron Tasks', loading: 'Loading…', error: 'Load failed',		
		      'search.placeholder': 'Search title / prompt / expression', 'filter.group': 'Status filter',		
		      'filter.all': 'All', 'filter.active': 'Active', 'filter.paused': 'Paused', 'filter.completed': 'Completed',		
		      'list.untitled': 'Untitled', 'list.empty': 'No matching automations', 'list.next': 'next', 'list.noNext': 'no next run',		
		      'schedule.interval': 'every {seconds}s', 'schedule.once': 'one-shot',		
		      'detail.empty': 'Select a task to see details', 'detail.edit': 'Edit', 'detail.pause': 'Pause', 'detail.resume': 'Resume',		
		      'detail.delete': 'Delete', 'detail.workspace': 'Workspace', 'detail.model': 'Model route', 'detail.schedule': 'Schedule',		
		      'detail.next': 'Next run', 'detail.last': 'Last run', 'detail.runs': 'Runs', 'detail.history': 'Run history',		
		      'detail.noRuns': 'No runs yet', 'detail.more': 'Load more', 'detail.openSession': 'Open session',		
		      'detail.sessionUnavailable': 'Cannot open session', 'detail.confirmDelete': 'Delete?',		
		      'banner.disconnected': 'Connection lost; will resume on reconnect',		
		      'time.minute': 'min', 'time.hour': 'h', 'time.day': 'd',		
		      'error.generic': 'Operation failed', 'error.cronNotFound': 'Automation not found (may have been deleted)', 'error.cronCompleted': 'Automation already completed; create a new one',		
		      'error.workspaceNotFound': 'Workspace not found', 'error.cronInvalid': 'Invalid cron expression (five fields required)', 'error.titleRange': 'Title must be 1-80 characters',		
		      'error.promptRange': 'Prompt exceeds its length limit', 'error.timeZone': 'Invalid time zone', 'error.delayMinutes': 'Delay minutes out of range',		
		      'error.interval': 'Interval out of range', 'error.modelRoute': 'Model route must be provider/model', 'error.maxRuns': 'Max runs out of range',		
		      'error.selector': 'Pass exactly one schedule selector',		
		      'run.succeeded': 'succeeded', 'run.failed': 'failed', 'run.skipped': 'skipped', 'run.claimed': 'claimed', 'run.running': 'running', 'run.unknown': 'unknown',		
		      'form.new': '+ New', 'form.newTitle': 'New automation', 'form.editTitle': 'Edit automation', 'form.save': 'Save', 'form.saving': 'Saving…',		
		      'form.cancel': 'Cancel', 'form.conflict': 'The task changed; refreshed to the latest — retry',		
		      'form.title': 'Title', 'form.titleRequired': 'Title is required', 'form.workspace': 'Workspace', 'form.model': 'Model route',		
		      'form.modelPlaceholder': 'Select a model route', 'form.modelRoute': 'Must be provider/model', 'form.scheduleKind': 'Schedule kind', 'form.kindCron': 'cron expression',		
		      'form.kindInterval': 'fixed interval', 'form.kindOnce': 'one-shot delay', 'form.cronExpression': 'cron expression (five fields)',		
		      'form.cronFiveFields': 'Must be five fields', 'form.interval': 'Interval', 'form.intervalPositive': 'Must be a positive integer',		
		      'form.cronHint': 'Five fields "min hour day month weekday": 0 9 * * * = daily 9am · 0 9 * * 1-5 = weekdays 9am · */15 * * * * = every 15 min',		
		      'form.delayMinutes': 'Delay minutes', 'form.maxRuns': 'Max runs (empty = unlimited)', 'form.maxRunsInteger': 'Must be an integer',		
		      'form.prompt': 'Prompt', 'form.promptRequired': 'Prompt is required',		
		    },		
		  }), 'dsh-cron client: locale')		
				
		  const t = ctx.locale.bind('cron.manager')		
				
		  // The catalog source and the remote seam it needs; the panel renders from		
		  // the snapshot whatever phase it is in, so the slots register synchronously		
		  // and the remote mount/polling join later.		
		  let cronNamespace		
		  const source = createCatalogSource({		
		    call: async (method, request) => {		
		      const ns = cronNamespace		
		      if (ns === undefined) throw new Error('cron namespace not mounted yet')		
		      // Zero-parameter host methods (list) must be called with no argument.		
		      return request === undefined ? ns[method]() : ns[method](request)		
		    },		
		  })		
				
		  ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register(		
		    {		
		      name: 'main', key: 'cron', locale: 'cron.manager',		
		      // Plain inject props, not the `hooks` compartment: a bare observable		
		      // rides `catalogSource` and the page subscribes locally (dsh-memory		
		      // pattern; the framework-bound use<Name> route needs the renderer's		
		      // own hook machinery, unavailable to a hand-written bundle).		
		      inject: () => ({		
		        catalogSource: source.hooks.catalog,		
		        call: (method, request) => (request === undefined		
		          ? cronNamespace[method]()		
		          : cronNamespace[method](request)),		
		        openSession: id => ctx.uiWorkspace.openSession(id),		
		        refresh: () => source.refresh(),		
		        t,		
		      }),		
		    },		
		    CronPage,		
		  )), 'dsh-cron client: main panel')		
				
		  ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(		
		    { name: 'sidebar.panellist', id: 'cron', order: 20, locale: 'cron.manager',		
		      label: () => t('panel') },		
		    CronIcon,		
		  )), 'dsh-cron client: sidebar icon')		
				
		  ctx.effect(async () => {		
		    const disposeMount = await ctx.remote.$mount({		
		      package: 'dsh-cron',		
		      descriptors: CRON_DESCRIPTORS,		
		    })		
		    // Strict injection: reading the mounted namespace needs a declared		
		    // inject on its service key, which exists only after $mount resolved.		
		    let disposeInject = () => {}		
		    disposeInject = ctx.inject(['remote.cron'], (nsCtx) => {		
		      cronNamespace = nsCtx['remote.cron']		
		      const disposeReset = ctx.on('connection/reset', () => { void source.refresh() })		
		      void source.start()		
		      return () => {		
		        cronNamespace = undefined		
		        disposeReset()		
		        source.stop()		
		      }		
		    })		
		    return () => {		
		      disposeInject()		
		      disposeMount()		
		    }		
		  }, 'dsh-cron client: remote mount + polling')		
		}		
		

		return module.exports;
	},
});
