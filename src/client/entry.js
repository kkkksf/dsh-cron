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
