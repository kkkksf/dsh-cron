import test from 'node:test'
import assert from 'node:assert/strict'
import { createHistorySource } from '../src/client/detail-source.js'

test('history 拉取成功进入 ready；ok:false 抛错进入 error 且保留旧 runs', async () => {
  let fail = false
  const calls = []
  const source = createHistorySource({
    call: async (method, request) => {
      calls.push([method, request])
      if (fail) return { ok: false, error: { message: 'cron_not_found: gone' } }
      return { ok: true, value: { runs: [{ id: 'r1', status: 'succeeded' }] } }
    },
  })
  await source.load('cron-1')
  assert.deepEqual(calls, [['history', { id: 'cron-1', limit: 10 }]])
  assert.equal(source.hooks.history.getSnapshot().phase, 'ready')
  assert.equal(source.hooks.history.getSnapshot().runs.length, 1)

  fail = true
  await source.load('cron-1', 30)
  const snap = source.hooks.history.getSnapshot()
  assert.equal(snap.phase, 'error')
  assert.match(snap.error, /cron_not_found/)
  assert.equal(snap.runs.length, 1) // 旧数据保留
})

test('load 串行且以最后一次请求为准', async () => {
  const order = []
  const source = createHistorySource({
    call: async (_method, request) => {
      order.push(`start ${request.limit}`)
      await new Promise(resolve => setTimeout(resolve, request.limit === 10 ? 10 : 1))
      order.push(`end ${request.limit}`)
      return { ok: true, value: { runs: [{ id: `r${request.limit}` }] } }
    },
  })
  await Promise.all([source.load('cron-1', 10), source.load('cron-1', 30)])
  const snap = source.hooks.history.getSnapshot()
  assert.equal(snap.phase, 'ready')
  assert.equal(snap.runs[0].id, 'r30') // 慢请求先发、快请求后至，后至者胜
})
