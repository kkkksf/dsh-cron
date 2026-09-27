import test from 'node:test'
import assert from 'node:assert/strict'
import { filterAutomations, scheduleSummary, relativeTime } from '../src/client/list.js'

const entries = [
  { id: 'a', title: '站会纪要', prompt: '写纪要', status: 'active',
    schedule: { kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'Asia/Shanghai' }, nextAt: '2999-01-01T01:00:00.000Z' },
  { id: 'b', title: 'Weekly Report', prompt: 'draft', status: 'paused',
    schedule: { kind: 'interval', everySeconds: 3600, unit: 'hour' }, nextAt: null },
  { id: 'c', title: '扫描', prompt: 'scan deps', status: 'completed',
    schedule: { kind: 'once', runAt: '2000-01-01T00:00:00.000Z' }, nextAt: null },
]

test('filterAutomations: 状态筛选三分支', () => {
  assert.deepEqual(filterAutomations(entries, { query: '', status: 'all' }).map(e => e.id), ['a', 'b', 'c'])
  assert.deepEqual(filterAutomations(entries, { query: '', status: 'active' }).map(e => e.id), ['a'])
  assert.deepEqual(filterAutomations(entries, { query: '', status: 'paused' }).map(e => e.id), ['b'])
  assert.deepEqual(filterAutomations(entries, { query: '', status: 'completed' }).map(e => e.id), ['c'])
})

test('filterAutomations: query 对标题/提示词/表达式不区分大小写子串', () => {
  assert.deepEqual(filterAutomations(entries, { query: 'weekly', status: 'all' }).map(e => e.id), ['b'])
  assert.deepEqual(filterAutomations(entries, { query: 'SCAN', status: 'all' }).map(e => e.id), ['c'])
  assert.deepEqual(filterAutomations(entries, { query: '0 9 *', status: 'all' }).map(e => e.id), ['a'])
  assert.deepEqual(filterAutomations(entries, { query: '不存在', status: 'all' }), [])
})

test('scheduleSummary: 三种调度形态', () => {
  const t = (key) => ({ zh: { cron: '表达式', interval: '每', once: '一次性' } })[key]
  assert.equal(scheduleSummary(entries[0].schedule, {
    cron: (s) => s.expression,
    interval: (s) => `every ${s.everySeconds}s`,
    once: (s) => `once ${s.runAt}`,
  }), '0 9 * * 1-5')
  assert.equal(scheduleSummary(entries[1].schedule, {
    cron: (s) => s.expression,
    interval: (s) => `every ${s.everySeconds}s`,
    once: (s) => `once ${s.runAt}`,
  }), 'every 3600s')
  assert.equal(scheduleSummary(entries[2].schedule, {
    cron: (s) => s.expression,
    interval: (s) => `every ${s.everySeconds}s`,
    once: (s) => `once ${s.runAt}`,
  }), 'once 2000-01-01T00:00:00.000Z')
})

test('relativeTime: 未来/过去/空 三档', () => {
  const now = Date.parse('2026-09-28T00:00:00.000Z')
  assert.match(relativeTime('2026-09-28T00:05:00.000Z', now), /5/)
  assert.match(relativeTime('2026-09-27T23:00:00.000Z', now), /1/)
  assert.equal(relativeTime(null, now), '')
})
