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
		
		
		// ─── src/client/page.js ───
		/**
		 * The cron panel main page (Task 4 minimal: real catalog data as a plain
		 * list). Later tasks grow the master-detail UI here; components receive all
		 * data through injected props (catalog snapshot + actions), never ctx.
		 */
		
		
		/** Local subscription over one observable snapshot prop (dsh-memory pattern). */
		function useSnapshot(source) {
		  const [snap, setSnap] = useState(() => source.getSnapshot())
		  useEffect(() => source.subscribe(() => setSnap(source.getSnapshot())), [source])
		  return snap
		}
		
		/** Minimal panel page: catalog phase + automation titles. */
		function CronPage(props) {
		  const source = props.catalogSource
		  const snapshot = source ? useSnapshot(source) : { phase: 'loading', automations: [] }
		  const automations = snapshot.automations ?? []
		  const t = props.t ?? (() => '')
		  return h('div', { style: { padding: '24px', fontSize: '14px' } },
		    h('h2', { style: { margin: '0 0 12px', fontSize: '16px' } }, t('panel')),
		    snapshot.phase === 'error' && h('p', { style: { color: 'var(--dsw-color-danger, #d33)' } },
		      `${t('error')}: ${snapshot.error ?? ''}`),
		    snapshot.phase === 'loading' && h('p', null, t('loading')),
		    h('ul', null, automations.map(entry =>
		      h('li', { key: entry.id }, `${entry.title ?? entry.id} [${entry.status ?? '?'}]`))),
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
		exports.inject = ['slots', 'locale', 'remote', 'typert']
		exports.apply = function apply(ctx) {
		  ctx.effect(() => ctx.locale.register('cron.manager', {
		    zh: { panel: '定时任务', loading: '加载中…', error: '加载失败' },
		    en: { panel: 'Cron Tasks', loading: 'Loading…', error: 'Load failed' },
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
		      inject: () => ({ catalogSource: source.hooks.catalog, t }),
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
