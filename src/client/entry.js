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
