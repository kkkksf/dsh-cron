/**
 * dsh-cron: workspace cron automations as an external dsh plugin.
 * Runs one in-process scheduler tick loop over a JSON store
 * ($DSH_HOME/cron/store.json), installs the four cron tools on every root
 * Agent, and registers the /cron command. Fired occurrences become fresh
 * headless sessions in the automation's workspace. Firing requires the dsh
 * process to be running; missed recurring occurrences present only the
 * latest one on catch-up, and a missed one-shot fires once on restart.
 *
 * The workspace registry is consumed optionally: profiles without it (for
 * example headless) still register the tools and commands, but creation
 * fails with a clear message until run inside a workspace-aware profile.
 */

import { homedir } from 'node:os'
import { join } from 'node:path'
import Schema from '@deepseek-ai/schemastery'
import { createCronCommand } from './commands.js'
import { validTimeZone } from './domain.js'
import { createRunner } from './runner.js'
import { CronRemoteService } from './remote.js'
import { CronScheduler } from './scheduler.js'
import { CronStore } from './store.js'
import { registerCronTools } from './tools.js'

/** Cordis plugin name. */
export const name = 'dsh-cron'

/** Services this plugin consumes; workspaceRegistry joins optionally below. */
export const inject = ['agents', 'sessions', 'tools', 'commands']

/** Plugin configuration, validated by the loader. */
export const Config = Schema.object({
  tickMs: Schema.number().default(5_000).description('调度器轮询间隔（毫秒，1000-600000）'),
  defaultTimeZone: Schema.string().default('Asia/Shanghai').description('cron 表达式的默认 IANA 时区；空则每次调用必须显式传时区'),
  storeDir: Schema.string().default('').description('存储目录；空 = $DSH_HOME/cron'),
})

/**
 * Resolve the dsh home directory the same way the harness does.
 * @returns {string} absolute dsh home.
 */
function dshHome() {
  const fromEnv = process.env.DSH_HOME
  return fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv : join(homedir(), '.dsh')
}

/**
 * Mount the scheduler, Agent-scoped tools, and the /cron command.
 * @param {object} ctx - Cordis context carrying the injected services.
 * @param {object} config - validated plugin configuration.
 * @returns {void}
 */
export function apply(ctx, config = {}) {
  const tickMs = config.tickMs ?? 5_000
  const defaultTimeZone = config.defaultTimeZone ?? 'Asia/Shanghai'
  if (!Number.isInteger(tickMs) || tickMs < 1_000 || tickMs > 600_000) {
    throw new Error('dsh-cron: tickMs must be an integer from 1000 through 600000')
  }
  if (defaultTimeZone !== '' && !validTimeZone(defaultTimeZone)) {
    throw new Error(`dsh-cron: defaultTimeZone ${JSON.stringify(defaultTimeZone)} is not a valid IANA zone`)
  }

  const storeDir = config.storeDir && config.storeDir.trim() !== ''
    ? config.storeDir
    : join(dshHome(), 'cron')
  const store = new CronStore(join(storeDir, 'store.json'))
  store.load()

  // Present only in workspace-aware profiles (web); creation surfaces fail
  // with a clear message without it, while firing keeps working.
  let registry
  ctx.inject(['workspaceRegistry'], (regCtx) => {
    registry = regCtx.workspaceRegistry
    console.log('[dsh-cron] workspace registry available: creation enabled')
  })

  const runner = createRunner({
    createAgent: options => ctx.agents.create(options),
    flush: async (session) => {
      await ctx.sessions.flush(session)
    },
    getWorkspace: workspaceId => registry?.get(workspaceId),
  }, store.automations, store.runs)
  const scheduler = new CronScheduler(store.automations, store.runs, runner)
  // The browser panel's single read/write path over the same tables.
  new CronRemoteService(ctx, {
    automations: store.automations,
    runs: store.runs,
    defaultTimeZone,
    listWorkspaces: () => registry?.list().map(w => ({ id: w.id, name: w.title, path: w.path })) ?? [],
    // Every configured provider/model route, for the form's dropdown. A
    // missing llm service or a failing provider degrades to an empty list.
    listModelRoutes: async () => {
      const llm = ctx.get('llm')
      const routes = []
      for (const provider of llm.listProviders()) {
        for (const model of await llm.listModels(provider.id)) {
          routes.push(`${provider.id}/${model.id}`)
        }
      }
      return routes
    },
  })
  // Restart reconciliation: fail claims orphaned by the previous process,
  // then run one pass so overdue work fires without waiting a full tick.
  void scheduler.sweepInterrupted().then(() => {
    void scheduler.tick()
  })
  const timer = setInterval(() => {
    void scheduler.tick()
  }, tickMs)

  // The plugin owns every registration's cleanup so disposal never leaks an
  // Agent's tools.
  const toolCleanups = new Map()
  let stopping = false

  ctx.on('agent/created', ({ agent }) => {
    if (stopping || toolCleanups.has(agent) || !ctx.agents.roots().includes(agent)) return
    const cleanup = agent.ctx.effect(() => {
      const disposeTools = registerCronTools(agent.ctx, {
        store,
        defaultTimeZone,
        resolveWorkspace: async () => {
          if (registry === undefined) return undefined
          const cwd = agent.session.header.cwd
          return cwd === undefined ? undefined : await registry.resolveByPath(cwd)
        },
      })
      return () => {
        disposeTools()
        if (toolCleanups.get(agent) === cleanup) toolCleanups.delete(agent)
      }
    }, 'dsh-cron.tools()')
    toolCleanups.set(agent, cleanup)
  })

  const disposeCommand = ctx.commands.register({
    definitionId: 'dsh-cron',
    ...createCronCommand({
      store,
      defaultTimeZone,
      resolveWorkspace: async (invocation) => {
        if (registry === undefined) return undefined
        const cwd = invocation.agent?.session?.header?.cwd
        return cwd === undefined ? undefined : await registry.resolveByPath(cwd)
      },
      workspacePath: (workspaceId) => {
        return registry?.get(workspaceId)?.path
      },
    }),
  })

  ctx.effect(() => async () => {
    stopping = true
    clearInterval(timer)
    disposeCommand()
    const cleanups = [...toolCleanups.values()]
    toolCleanups.clear()
    await Promise.allSettled(cleanups.map(cleanup => Promise.resolve(cleanup())))
    await scheduler.stop()
  }, 'dsh-cron.dispose')

  console.log(`[dsh-cron] active: store ${join(storeDir, 'store.json')} (tick ${tickMs}ms, zone ${defaultTimeZone === '' ? '<none>' : defaultTimeZone}, ${store.automations.entries().length} automation(s))`)
}
