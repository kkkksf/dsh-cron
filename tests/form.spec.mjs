import test from 'node:test'
import assert from 'node:assert/strict'
import { serializeForm, validateDraft, TIMEZONES, optionsWithCurrent } from '../src/client/form-logic.js'

test('optionsWithCurrent：未列出的当前值附加在尾部', () => {
  assert.deepEqual(optionsWithCurrent(['a', 'b'], 'b'), ['a', 'b'])
  assert.deepEqual(optionsWithCurrent(['a', 'b'], 'z'), ['a', 'b', 'z'])
  assert.deepEqual(optionsWithCurrent(['a'], ''), ['a'])
  assert.deepEqual(optionsWithCurrent(null, 'x'), ['x'])
})

test('TIMEZONES：含常用时区且默认上海在前', () => {
  assert.ok(Array.isArray(TIMEZONES))
  assert.equal(TIMEZONES[0], 'Asia/Shanghai')
  for (const zone of ['UTC', 'Asia/Tokyo', 'Asia/Hong_Kong', 'Europe/London', 'America/New_York']) {
    assert.ok(TIMEZONES.includes(zone), zone)
  }
})

const baseDraft = {
  title: '巡检',
  prompt: '跑巡检',
  model: 'zai-coding-cn/glm-5.3',
  workspaceId: 'ws-1',
  kind: 'cron',
  cronExpression: '0 6 * * *',
  timeZone: 'Asia/Shanghai',
  delayMinutes: '',
  interval: '',
  intervalUnit: 'minute',
  maxRuns: '',
}

test('serializeForm: maxRuns 空串 → 省略字段、数字串 → Number，字段各带自己的 JSON 类型', () => {
  const wire = serializeForm({ ...baseDraft, maxRuns: '' })
  assert.equal('max_runs' in wire, false)
  assert.equal(wire.selector.cron_expression, '0 6 * * *')
  assert.equal(wire.selector.time_zone, 'Asia/Shanghai')
  assert.equal(typeof wire.title, 'string')

  const numeric = serializeForm({ ...baseDraft, maxRuns: '5' })
  assert.equal(numeric.max_runs, 5)
  assert.equal(typeof numeric.max_runs, 'number')
})

test('serializeForm: 三种调度选择器互斥产出', () => {
  assert.deepEqual(
    serializeForm({ ...baseDraft, kind: 'once', delayMinutes: '30' }).selector,
    { delay_minutes: 30 },
  )
  assert.deepEqual(
    serializeForm({ ...baseDraft, kind: 'interval', interval: '15' }).selector,
    { interval: 15, interval_unit: 'minute' },
  )
  assert.deepEqual(
    serializeForm({ ...baseDraft }).selector,
    { cron_expression: '0 6 * * *', time_zone: 'Asia/Shanghai' },
  )
})

test('validateDraft: 标题/prompt 空、model 路由格式、cron 五段', () => {
  assert.deepEqual(validateDraft(baseDraft), {})
  assert.match(validateDraft({ ...baseDraft, title: '  ' }).title ?? '', /./)
  assert.match(validateDraft({ ...baseDraft, prompt: '' }).prompt ?? '', /./)
  assert.match(validateDraft({ ...baseDraft, model: 'no-slash' }).model ?? '', /./)
  assert.match(validateDraft({ ...baseDraft, cronExpression: '* * *' }).cronExpression ?? '', /./)
  assert.match(validateDraft({ ...baseDraft, kind: 'once', delayMinutes: 'abc' }).delayMinutes ?? '', /./)
  assert.match(validateDraft({ ...baseDraft, kind: 'interval', interval: '' }).interval ?? '', /./)
})

test('validateDraft 的 once 错误键是错误描述而非字段标签', () => {
  const errors = validateDraft({ ...baseDraft, kind: 'once', delayMinutes: 'abc' })
  assert.notEqual(errors.delayMinutes, 'form.delayMinutes')
  assert.equal(errors.delayMinutes, 'form.delayMinutesInvalid')
})
