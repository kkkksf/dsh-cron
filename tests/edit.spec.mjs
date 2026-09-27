import test from 'node:test'
import assert from 'node:assert/strict'
import { draftFromEntry, editFormKey, scheduleChanged, localizeError } from '../src/client/form-logic.js'

const intervalEntry = {
  id: 'a', title: 't', prompt: 'p', model: 'm/m', workspaceId: 'ws',
  status: 'active', maxRuns: null,
  schedule: { kind: 'interval', everySeconds: 7200, unit: 'hour' },
}
const onceEntry = {
  id: 'b', title: 't', prompt: 'p', model: 'm/m', workspaceId: 'ws',
  status: 'active', maxRuns: 5,
  schedule: { kind: 'once', runAt: new Date(Date.now() + 30 * 60_000).toISOString() },
}
const cronEntry = {
  id: 'c', title: 't', prompt: 'p', model: 'm/m', workspaceId: 'ws',
  status: 'active', maxRuns: null,
  schedule: { kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'Asia/Shanghai' },
}

test('draftFromEntry: interval 回填数值与单位', () => {
  const draft = draftFromEntry(intervalEntry, {})
  assert.equal(draft.kind, 'interval')
  assert.equal(draft.interval, '2')
  assert.equal(draft.intervalUnit, 'hour')
})

test('draftFromEntry: once 回填剩余分钟（向上取整，至少 1）', () => {
  const draft = draftFromEntry(onceEntry, { nowMs: Date.now() })
  assert.equal(draft.kind, 'once')
  assert.equal(draft.delayMinutes, '30')
  const past = draftFromEntry({ ...onceEntry, schedule: { kind: 'once', runAt: '2000-01-01T00:00:00.000Z' } }, {})
  assert.equal(past.delayMinutes, '1')
})

test('draftFromEntry: cron 回填表达式与时区', () => {
  const draft = draftFromEntry(cronEntry, {})
  assert.equal(draft.kind, 'cron')
  assert.equal(draft.cronExpression, '0 9 * * 1-5')
  assert.equal(draft.timeZone, 'Asia/Shanghai')
})

test('editFormKey: 以 updatedAt 变化驱动表单重挂载', () => {
  assert.equal(editFormKey({ id: 'a', updatedAt: 't1' }), 'a:t1')
  assert.notEqual(editFormKey({ id: 'a', updatedAt: 't1' }), editFormKey({ id: 'a', updatedAt: 't2' }))
})

test('scheduleChanged: 调度未变时不重算', () => {
  const unchanged = draftFromEntry(cronEntry, {})
  assert.equal(scheduleChanged(cronEntry, unchanged), false)
  assert.equal(scheduleChanged(cronEntry, { ...unchanged, cronExpression: '0 8 * * *' }), true)

  const intervalDraft = draftFromEntry(intervalEntry, {})
  assert.equal(scheduleChanged(intervalEntry, intervalDraft), false)
  assert.equal(scheduleChanged(intervalEntry, { ...intervalDraft, interval: '5' }), true)

  // once: saving always re-anchors runAt from now, so it always counts as a
  // schedule change (the rehydrated delay is an approximation by design).
  const onceDraft = draftFromEntry(onceEntry, { nowMs: Date.now() })
  assert.equal(scheduleChanged(onceEntry, onceDraft), true)
})

test('localizeError: 已知前缀映射，未知原样返回', () => {
  const t = (key) => ({
    'error.cronNotFound': '任务不存在', 'error.cronCompleted': '任务已完结',
    'error.generic': '操作失败',
  })[key] ?? key
  assert.equal(localizeError('cron_not_found: no automation "x"', t), '任务不存在')
  assert.equal(localizeError('cron_completed: the automation already completed', t), '任务已完结')
  assert.equal(localizeError('some unexpected failure', t), 'some unexpected failure')
  assert.equal(localizeError(undefined, t), '操作失败')
})
