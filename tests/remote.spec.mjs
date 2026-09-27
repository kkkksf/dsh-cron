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
