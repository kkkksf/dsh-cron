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
		 * One catalog source: a loading/ready/error snapshot store refreshed by
		 * polling, by post-mutation refetch, and by connection reset.
		 * @param {{ call: (method: string, request: object) => Promise<{ok: boolean, value?: object, error?: {message?: string}}>,
		 *           intervalMs?: number }} options - remote call seam and poll cadence (0 = no timer).
		 * @returns {{ hooks: { catalog: object }, refresh: () => Promise<void>, start: () => void, stop: () => void }} the source handle.
		 */
		function createCatalogSource({ call, intervalMs = 5000 }) {
		  const listeners = new Set()
		  let snapshot = { phase: 'loading', workspaces: [], automations: [], error: null }
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
		 * beyond. Past and future share the same buckets with the sign in the text.
		 * @param {string | null} iso - the target instant, or null when none.
		 * @param {number} nowMs - reference clock in epoch milliseconds.
		 * @returns {string} localized-free bucket text like "5 分钟" / "3 小时", or '' when absent.
		 */
		function relativeTime(iso, nowMs) {
		  if (iso === null || iso === undefined) return ''
		  const deltaMs = Date.parse(iso) - nowMs
		  if (Number.isNaN(deltaMs)) return ''
		  const minutes = Math.round(Math.abs(deltaMs) / 60_000)
		  if (minutes < 60) return `${minutes} 分钟`
		  const hours = Math.round(minutes / 60)
		  if (hours < 24) return `${hours} 小时`
		  return `${Math.round(hours / 24)} 天`
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
		function DetailPane({ entry, workspaces, call, openSession, onEdit, onToggle, onDelete, t }) {
		  const [historySource] = useState(() => createHistorySource({ call }))
		  const [historyLimit, setHistoryLimit] = useState(10)
		  const [snap, setSnap] = useState(() => historySource.hooks.history.getSnapshot())
		  useEffect(() => {
		    setSnap(historySource.hooks.history.getSnapshot())
		    return historySource.hooks.history.subscribe(() => setSnap(historySource.hooks.history.getSnapshot()))
		  }, [historySource])
		  useEffect(() => {
		    if (entry?.id !== undefined) void historySource.load(entry.id, historyLimit)
		  }, [historySource, entry?.id, historyLimit])
		
		  if (entry === null || entry === undefined) {
		    return h('div', { className: 'dsh-cron-detail dsh-cron-detail-empty' },
		      h('p', { className: 'dsh-cron-hint' }, t('detail.empty')))
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
		        h('button', { type: 'button', onClick: onEdit }, t('detail.edit')),
		        entry.status !== 'completed' && h('button', { type: 'button', onClick: onToggle },
		          entry.status === 'active' ? t('detail.pause') : t('detail.resume')),
		        h('button', { type: 'button', className: 'dsh-cron-danger', onClick: onDelete }, t('detail.delete')))),
		    field(t('detail.workspace'), workspace?.name ?? entry.workspaceId ?? ''),
		    field(t('detail.model'), entry.model ?? ''),
		    field(t('detail.schedule'), summary),
		    field(t('detail.next'), entry.nextAt ?? t('list.noNext')),
		    field(t('detail.last'),
		      `${entry.lastRunAt ?? ''} ${entry.lastRunStatus ?? ''}`.trim() || t('list.noNext')),
		    field(t('detail.runs'), `${entry.runCount ?? 0}${entry.maxRuns === null ? '' : ` / ${entry.maxRuns}`}`),
		    h('h4', { className: 'dsh-cron-history-title' }, t('detail.history')),
		    snap.phase === 'error' && h('p', { className: 'dsh-cron-banner-error' }, `${t('error')}: ${snap.error ?? ''}`),
		    (snap.runs ?? []).length === 0 && snap.phase === 'ready' && h('p', { className: 'dsh-cron-hint' }, t('detail.noRuns')),
		    h('ul', { className: 'dsh-cron-runs' },
		      (snap.runs ?? []).map(run => h(RunRow, { key: run.id, run, openSession, t }))),
		    (snap.runs ?? []).length >= historyLimit && h('button', {
		      type: 'button', className: 'dsh-cron-more',
		      onClick: () => { setHistoryLimit(Math.min(historyLimit + 20, 200)) },
		    }, t('detail.more')),
		  )
		}
		
		
		// ─── src/client/page.js ───
		/**
		 * The cron panel main page: toolbar (search / status filter) + automation
		 * list. Components receive all data through injected props (catalog snapshot
		 * source + actions), never ctx.
		 */
		
		
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
		  const summary = scheduleSummary(entry.schedule, {
		    cron: s => s.expression ?? '',
		    interval: s => t('schedule.interval', { seconds: s.everySeconds ?? 0 }),
		    once: s => t('schedule.once'),
		  })
		  const next = entry.nextAt === null
		    ? t('list.noNext')
		    : `${t('list.next')} ${relativeTime(entry.nextAt, Date.now())}`
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
		
		/** The cron panel page: toolbar + list on the left, detail on the right. */
		function CronPage(props) {
		  const source = props.catalogSource
		  const snapshot = source ? useSnapshot(source) : { phase: 'loading', automations: [] }
		  const automations = snapshot.automations ?? []
		  const workspaces = snapshot.workspaces ?? []
		  const t = props.t ?? (() => '')
		  const [query, setQuery] = useState('')
		  const [status, setStatus] = useState('all')
		  const [selectedId, setSelectedId] = useState(null)
		  const visible = filterAutomations(automations, { query, status })
		  const selected = selectedId === null
		    ? null
		    : (automations.find(entry => entry.id === selectedId) ?? null)
		
		  return h('div', { className: `dsh-cron-page${selected !== null ? ' dsh-cron-has-detail' : ''}` },
		    snapshot.phase === 'error' && h('p', { className: 'dsh-cron-banner-error' },
		      `${t('error')}: ${snapshot.error ?? ''}`),
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
		      ),
		      snapshot.phase === 'loading' && h('p', { className: 'dsh-cron-hint' }, t('loading')),
		      h('div', { className: 'dsh-cron-list', role: 'list' },
		        visible.length === 0 && snapshot.phase === 'ready' && h('p', { className: 'dsh-cron-hint' }, t('list.empty')),
		        visible.map(entry => h(AutomationRow, {
		          key: entry.id, entry, workspaces, selected: entry.id === selectedId,
		          onSelect: setSelectedId, t,
		        }))),
		    ),
		    h(DetailPane, {
		      entry: selected, workspaces,
		      call: props.call ?? null,
		      openSession: props.openSession ?? null,
		      onEdit: props.onEdit ?? null, onToggle: props.onToggle ?? null, onDelete: props.onDelete ?? null,
		      t,
		    }),
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
		
		
		// ─── src/client/entry.js ───
		/**
		 * Browser-half entry: mounts the cron remote namespace, starts the polling
		 * catalog, and registers the sidebar icon + keyed main panel. All cleanup
		 * rides the plugin fiber's effect disposer.
		 */
		
		exports.name = 'dsh-cron-client'
		exports.inject = ['slots', 'locale', 'remote', 'typert', 'uiWorkspace']
		exports.apply = function apply(ctx) {
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
		      'detail.sessionUnavailable': '无法打开会话',
		      'run.succeeded': '成功', 'run.failed': '失败', 'run.skipped': '跳过', 'run.claimed': '已认领', 'run.running': '运行中', 'run.unknown': '未知',
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
		      'detail.sessionUnavailable': 'Cannot open session',
		      'run.succeeded': 'succeeded', 'run.failed': 'failed', 'run.skipped': 'skipped', 'run.claimed': 'claimed', 'run.running': 'running', 'run.unknown': 'unknown',
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
