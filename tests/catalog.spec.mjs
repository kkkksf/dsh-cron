import test from 'node:test'
import assert from 'node:assert/strict'
import { createCatalogSource } from '../src/client/catalog.js'

function snapshotOf(source) { return source.hooks.catalog.getSnapshot() }

test('首拉成功进入 ready；错误进入 error 不清空旧数据', async () => {
  let counter = 0
  const calls = []
  const source = createCatalogSource({
    call: async (method, arg) => {
      calls.push(method)
      if (++counter === 2) throw new Error('conn dropped')
      return { ok: true, value: { workspaces: [], automations: [
        { id: 'a' + counter, title: 't', status: 'active' },
      ] } }
    },
    intervalMs: 0,
  })
  await source.start()
  assert.equal(snapshotOf(source).phase, 'ready')
  assert.equal(snapshotOf(source).automations[0].id, 'a1')
  await source.refresh()
  assert.equal(snapshotOf(source).phase, 'error')
  assert.equal(snapshotOf(source).automations[0].id, 'a1')
  assert.deepEqual(calls, ['list', 'list'])
  source.stop()
})

test('ok:false 分支进入 error 且携带宿主消息', async () => {
  const source = createCatalogSource({
    call: async () => ({ ok: false, error: { message: 'cron_not_found: nope' } }),
    intervalMs: 0,
  })
  await source.refresh()
  assert.equal(snapshotOf(source).phase, 'error')
  assert.match(snapshotOf(source).error, /cron_not_found/)
})

test('refresh 串行：并发调用不交叠', async () => {
  let inflight = 0
  let maxInflight = 0
  const source = createCatalogSource({
    call: async () => {
      inflight += 1
      maxInflight = Math.max(maxInflight, inflight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inflight -= 1
      return { ok: true, value: { workspaces: [], automations: [] } }
    },
    intervalMs: 0,
  })
  await Promise.all([source.refresh(), source.refresh(), source.refresh()])
  assert.equal(maxInflight, 1)
  assert.equal(snapshotOf(source).phase, 'ready')
})
