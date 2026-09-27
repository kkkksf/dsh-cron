import test from 'node:test'
import assert from 'node:assert/strict'
import { withDefaults } from '../src/client/catalog.js'
import { createCatalogSource } from '../src/client/catalog.js'

test('withDefaults: 缺字段快照不炸，entry 字段降级', () => {
  const guarded = withDefaults({ phase: 'ready' })
  assert.deepEqual(guarded.workspaces, [])
  assert.deepEqual(guarded.automations, [])

  const entry = withDefaults({ phase: 'ready', automations: [{ id: 'a' }], workspaces: null })
  assert.deepEqual(entry.automations.map(e => e.id), ['a'])
  assert.equal(entry.automations[0].title, undefined) // 原样保留，渲染层用 ?? 兜底

  assert.equal(withDefaults(null).phase, 'loading')
})

test('error 后一次成功 refresh 回 ready 且横幅消息清除', async () => {
  let fail = true
  const source = createCatalogSource({
    call: async () => {
      if (fail) throw new Error('dropped')
      return { ok: true, value: { workspaces: [], automations: [{ id: 'x' }] } }
    },
    intervalMs: 0,
  })
  await source.start()
  assert.equal(source.hooks.catalog.getSnapshot().phase, 'error')
  fail = false
  await source.refresh()
  const snap = source.hooks.catalog.getSnapshot()
  assert.equal(snap.phase, 'ready')
  assert.equal(snap.error, null)
})
