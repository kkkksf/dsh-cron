import test from 'node:test'
import assert from 'node:assert/strict'
import { createActionFeedback } from '../src/client/actions.js'

test('busy 期间重复提交被忽略；失败回 idle 带消息；成功触发回调', async () => {
  const feedback = createActionFeedback()
  assert.equal(feedback.snapshot().phase, 'idle')

  let release
  const gate = new Promise(resolve => { release = resolve })
  const started = []
  const first = feedback.run('op-1', async () => {
    started.push('first')
    await gate
    return { ok: true }
  })
  // busy 中的第二次提交应被忽略
  const skipped = await feedback.run('op-2', async () => {
    started.push('second')
    return { ok: true }
  })
  assert.equal(skipped, false)
  assert.deepEqual(started, ['first'])
  assert.equal(feedback.snapshot().phase, 'busy')

  release()
  assert.equal(await first, true)
  assert.equal(feedback.snapshot().phase, 'idle')

  const failed = await feedback.run('op-3', async () => ({ ok: false, error: { message: 'boom' } }))
  assert.equal(failed, false)
  assert.equal(feedback.snapshot().phase, 'error')
  assert.equal(feedback.snapshot().message, 'boom')

  // 成功操作清除错误
  await feedback.run('op-4', async () => ({ ok: true }))
  assert.equal(feedback.snapshot().phase, 'idle')
})
