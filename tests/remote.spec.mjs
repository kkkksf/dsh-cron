import test from 'node:test'
import assert from 'node:assert/strict'
import { CronRemoteService } from '../src/remote.js'

/** Minimal fake ctx: the cordis Service base needs a Context-shaped object. */
function fakeCtx() {
  const disposers = []
  return {
    effect: (fn) => { const d = fn(); return () => { disposers.push(d) } },
    on: () => () => {},
    emit: () => {},
    reflect: { provide: () => () => {} },
    accessor: () => {},
    root: null,
    logger: { warn: () => {}, error: () => {} },
  }
}

function makeTables() {
  const automations = new Map([
    ['cron-1', {
      id: 'cron-1', workspaceId: 'ws-a', title: '站会', prompt: '写纪要',
      model: 'p/m', status: 'active',
      schedule: { kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'Asia/Shanghai' },
      maxRuns: null, nextAt: '2026-09-28T01:00:00.000Z',
      lastRunAt: null, lastRunStatus: null, runCount: 0,
      createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
    }],
  ])
  const runs = new Map()
  const table = (map) => ({
    get: id => map.get(id), put: (id, r) => map.set(id, r),
    update(id, fn) { const c = map.get(id); if (c === undefined) throw new Error(`no record '${id}'`); const n = fn(c); map.set(id, n); return n },
    delete: id => map.delete(id), entries: () => map.entries(),
  })
  return { automations: table(automations), runs: table(runs) }
}

const ENTRY_KEYS = ['id', 'workspaceId', 'title', 'prompt', 'model', 'status',
  'schedule', 'maxRuns', 'nextAt', 'lastRunAt', 'lastRunStatus', 'runCount',
  'createdAt', 'updatedAt']

test('list() 投影全部自动化与工作区名单', async () => {
  const tables = makeTables()
  const service = new CronRemoteService(fakeCtx(), {
    ...tables, defaultTimeZone: 'Asia/Shanghai',
    listWorkspaces: () => [{ id: 'ws-a', name: 'flowagent', path: 'E:/x' }],
  })
  const result = await service.list()
  assert.equal(result.ok, true)
  assert.deepEqual(result.value.workspaces, [{ id: 'ws-a', name: 'flowagent', path: 'E:/x' }])
  assert.equal(result.value.automations.length, 1)
  assert.deepEqual(Object.keys(result.value.automations[0]).sort(), ENTRY_KEYS.slice().sort())
  assert.equal(result.value.automations[0].schedule.expression, '0 9 * * 1-5')
})

test('create() 建 cron 任务并算出 nextAt；非法表达式抛错', async () => {
  const tables = makeTables()
  const service = new CronRemoteService(fakeCtx(), {
    ...tables, defaultTimeZone: 'Asia/Shanghai', listWorkspaces: () => [],
  })
  const created = await service.create({
    workspaceId: 'ws-a', title: '巡检', prompt: '跑巡检', model: 'p/m',
    selector: { cron_expression: '0 6 * * *', time_zone: 'Asia/Shanghai' },
  })
  assert.equal(created.ok, true)
  assert.equal(created.value.status, 'active')
  assert.ok(created.value.nextAt !== null)
  assert.equal([...tables.automations.entries()].length, 2)

  const bad = await service.create({
    workspaceId: 'ws-a', title: 'x', prompt: 'x', model: 'p/m',
    selector: { cron_expression: '* * *', time_zone: 'Asia/Shanghai' },
  })
  assert.equal(bad.ok, false)
  assert.match(bad.error.message, /invalid cron expression/)
})

test('update() 乐观锁：expectedNextAt 过期返回 conflict 与最新 entry', async () => {
  const tables = makeTables()
  const service = new CronRemoteService(fakeCtx(), {
    ...tables, defaultTimeZone: 'Asia/Shanghai', listWorkspaces: () => [],
  })
  const stale = await service.update({
    id: 'cron-1', expectedNextAt: '2000-01-01T00:00:00.000Z',
    changes: { title: '新标题' },
  })
  assert.equal(stale.ok, true)
  assert.equal(stale.value.outcome, 'conflict')
  assert.equal(stale.value.entry.title, '站会')

  const fresh = await service.update({
    id: 'cron-1', expectedNextAt: '2026-09-28T01:00:00.000Z',
    changes: { title: '新标题' },
  })
  assert.equal(fresh.ok, true)
  assert.equal(fresh.value.outcome, 'updated')
  assert.equal(fresh.value.entry.title, '新标题')

  const missing = await service.update({
    id: 'cron-404', expectedNextAt: null, changes: { title: 'x' },
  })
  assert.equal(missing.ok, false)
  assert.match(missing.error.message, /cron_not_found/)
})

test('toggle 往返与 completed 拒绝', async () => {
  const tables = makeTables()
  const service = new CronRemoteService(fakeCtx(), {
    ...tables, defaultTimeZone: 'Asia/Shanghai', listWorkspaces: () => [],
  })
  const paused = await service.toggle({ id: 'cron-1', enabled: false })
  assert.equal(paused.value.outcome, 'updated')
  assert.equal(paused.value.entry.status, 'paused')
  assert.equal(paused.value.entry.nextAt, '2026-09-28T01:00:00.000Z') // store 不变量：暂停不清 nextAt
  const resumed = await service.toggle({ id: 'cron-1', enabled: true })
  assert.equal(resumed.value.entry.status, 'active')
  assert.ok(resumed.value.entry.nextAt !== null) // resumeNextAtMs 重算

  tables.automations.put('cron-2', {
    id: 'cron-2', workspaceId: 'ws-a', title: 'x', prompt: 'x', model: 'p/m',
    status: 'completed', schedule: { kind: 'once', runAt: '2000-01-01T00:00:00.000Z' },
    maxRuns: 1, nextAt: null, lastRunAt: null, lastRunStatus: null,
    runCount: 1, createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z',
  })
  const refused = await service.toggle({ id: 'cron-2', enabled: true })
  assert.equal(refused.ok, false)
  assert.match(refused.error.message, /cron_completed/)
})

test('delete 连带清 run 记录；history 按时间降序', async () => {
  const tables = makeTables()
  tables.runs.put('run-2', { id: 'run-2', cronId: 'cron-1', status: 'succeeded',
    occurrenceAt: 't', startedAt: '2026-09-27T02:00:00.000Z',
    finishedAt: '2026-09-27T02:00:05.000Z', durationMs: 5000,
    sessionId: 's-2', error: null })
  tables.runs.put('run-1', { id: 'run-1', cronId: 'cron-1', status: 'failed',
    occurrenceAt: 't', startedAt: '2026-09-27T01:00:00.000Z',
    finishedAt: '2026-09-27T01:00:01.000Z', durationMs: 1000,
    sessionId: null, error: 'boom' })
  const service = new CronRemoteService(fakeCtx(), {
    ...tables, defaultTimeZone: 'Asia/Shanghai', listWorkspaces: () => [],
  })
  const history = await service.history({ id: 'cron-1' })
  assert.deepEqual(history.value.runs.map(r => r.id), ['run-2', 'run-1'])

  const gone = await service.delete({ id: 'cron-1' })
  assert.equal(gone.value.deleted, true)
  assert.equal([...tables.runs.entries()].length, 0)
  const missing = await service.history({ id: 'cron-1' })
  assert.equal(missing.ok, false)
  assert.match(missing.error.message, /cron_not_found/)
})
