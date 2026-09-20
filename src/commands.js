/**
 * The `/cron` slash command: list, create, pause/resume, remove, inspect,
 * and run history for workspace automations. Creation binds to the invoking
 * session's workspace; everything else addresses records by id prefix or
 * exact title across all workspaces.
 */

import { applyUpdate, prepareCreate } from './manage.js'

const USAGE = [
  '用法：',
  '/cron — 列出全部定时任务',
  '/cron add <调度> <模型路由> :: <提示词> — 新建任务（标题自动取提示词首行）',
  '  调度写法：every:10m / every:2h / every:1d / every:1w（固定间隔）',
  '             in:30m / in:2h（一次性延时）  cron:0 9 * * 1-5（五段式表达式，时区用配置默认）',
  '/cron info <id前缀> — 查看单个任务详情',
  '/cron pause <id前缀> — 暂停   /cron resume <id前缀> — 恢复',
  '/cron rm <id前缀> — 删除任务及其运行历史',
  '/cron history <id前缀> [条数] — 查看运行历史（默认 10 条）',
  '提示：复杂参数建议直接对话创建（模型会调 cron_create 工具）。',
].join('\n')

const INTERVAL_UNITS = { m: 'minute', h: 'hourly', d: 'daily', w: 'weekly' }
const DELAY_MINUTES = { m: 1, h: 60, d: 1_440 }

/** Uniform error outcome. */
function err(text) {
  return { kind: 'error', text }
}

/** Uniform success outcome. */
function ok(text) {
  return { kind: 'success', text }
}

/** Short human form of one schedule. */
function scheduleText(schedule) {
  if (schedule.kind === 'once') return `单次 @ ${schedule.runAt}`
  if (schedule.kind === 'interval') return `每 ${schedule.everySeconds / INTERVAL_SECONDS[schedule.unit] ?? '?'} ${schedule.unit}`
  return `cron "${schedule.expression}" (${schedule.timeZone})`
}

const INTERVAL_SECONDS = { minute: 60, hourly: 3_600, daily: 86_400, weekly: 604_800 }

/**
 * Parse the compact schedule spec used by /cron add.
 * @param {string} spec - every:10m | in:30m | cron:<five-field expr>.
 * @returns {object} the manage.js schedule selector.
 */
function parseSpec(spec) {
  const interval = /^every:(\d+)([mhdw])$/.exec(spec)
  if (interval !== null) {
    return { interval: Number(interval[1]), interval_unit: INTERVAL_UNITS[interval[2]] }
  }
  const delay = /^in:(\d+)([mhd])$/.exec(spec)
  if (delay !== null) {
    return { delay_minutes: Number(delay[1]) * DELAY_MINUTES[delay[2]] }
  }
  if (spec.startsWith('cron:')) {
    return { cron_expression: spec.slice('cron:'.length).trim() }
  }
  throw new Error(`无法识别调度写法 ${JSON.stringify(spec)}；支持 every:Nm/h/d/w、in:Nm/h/d、cron:<表达式>`)
}

/**
 * Resolve one id prefix (or exact title) to exactly one automation record.
 * @param {object} store - the cron store.
 * @param {string} key - user-typed id prefix or title.
 * @returns {object} the record.
 */
function resolveOne(store, key) {
  if (key === '') throw new Error('请提供任务 id 前缀或标题')
  const records = [...store.automations.entries()].map(([, record]) => record)
  const byTitle = records.filter(record => record.title === key)
  const byPrefix = records.filter(record => record.id.startsWith(key))
  const matches = byTitle.length > 0 ? byTitle : byPrefix
  if (matches.length === 0) {
    throw new Error(`没有匹配 "${key}" 的任务；用 /cron 查看列表`)
  }
  if (matches.length > 1) {
    throw new Error(`"${key}" 匹配到多个任务：\n${matches.map(r => `${r.id.slice(0, 13)} ${r.title}`).join('\n')}`)
  }
  return matches[0]
}

/**
 * Build the /cron command handler.
 * @param {object} deps - { store, defaultTimeZone, resolveWorkspace, workspacePath, now }.
 * @returns {object} registry-ready command definition body (name/description/handler).
 */
export function createCronCommand(deps) {
  const now = deps.now ?? Date.now

  /** List every automation across workspaces, newest last. */
  function listAll() {
    const records = [...deps.store.automations.entries()]
      .map(([, record]) => record)
      .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
    if (records.length === 0) return ok('还没有定时任务。用 /cron add 新建，或直接对话创建。')
    const lines = records.map((record) => {
      const dir = deps.workspacePath(record.workspaceId)
      return [
        `${record.id.slice(0, 13)}  ${record.title}`,
        `  ${scheduleText(record.schedule)}｜状态 ${record.status}｜下次 ${record.nextAt ?? '—'}｜已运行 ${record.runCount}${record.maxRuns === null ? '' : `/${record.maxRuns}`} 次`,
        `  模型 ${record.model}${dir === undefined ? '' : `｜工作区 ${dir}`}`,
      ].join('\n')
    })
    return ok(`共 ${records.length} 个任务：\n\n${lines.join('\n\n')}`)
  }

  /** Run-history lines for one record. */
  function history(record, limit) {
    const runs = [...deps.store.runs.entries()]
      .map(([, run]) => run)
      .filter(run => run.cronId === record.id)
      .sort((left, right) => Date.parse(right.startedAt) - Date.parse(left.startedAt))
      .slice(0, limit)
    if (runs.length === 0) return ok(`「${record.title}」还没有运行记录。`)
    const lines = runs.map(run => [
      `${run.status === 'succeeded' ? '✅' : run.status === 'failed' ? '❌' : '⏳'} ${run.occurrenceAt}｜${run.durationMs === null ? '—' : `${Math.round(run.durationMs / 1000)}s`}`,
      `  会话 ${run.sessionId ?? '—'}${run.error === null ? '' : `｜${run.error}`}`,
    ].join('\n'))
    return ok(`「${record.title}」最近 ${runs.length} 次运行：\n\n${lines.join('\n\n')}`)
  }

  return {
    name: 'cron',
    description: '管理定时任务：查看、新建、暂停/恢复、删除、运行历史',
    async handler(invocation) {
      const raw = (invocation.rawInput ?? '').trim()
      const [sub, ...rest] = raw.split(/\s+/)
      const arg = rest.join(' ').trim()
      try {
        if (sub === undefined || sub === '') return listAll()
        if (sub === 'add') {
          const split = raw.indexOf('::')
          const head = raw.slice('add'.length, split).trim()
          const prompt = raw.slice(split + 2).trim()
          if (split < 0 || head === '' || prompt === '') {
            return err('格式：/cron add <调度> <模型路由> :: <提示词>\n' + USAGE)
          }
          const model = head.slice(head.lastIndexOf(' ') + 1)
          const spec = head.slice(0, head.length - model.length).trim()
          const workspace = await deps.resolveWorkspace(invocation)
          if (workspace === undefined) {
            return err('当前会话不在任何已注册工作区；请先在工作区里打开会话再创建定时任务。')
          }
          const selector = parseSpec(spec)
          const title = prompt.split('\n')[0].slice(0, 40)
          const record = prepareCreate({
            workspaceId: workspace.id,
            title,
            prompt,
            model,
          }, selector, deps.defaultTimeZone, now())
          await deps.store.automations.put(record.id, record)
          return ok(`已创建「${record.title}」(${record.id.slice(0, 13)})：${scheduleText(record.schedule)}，下次运行 ${record.nextAt}。到点会在此工作区新建会话执行。`)
        }
        if (sub === 'info') {
          const record = resolveOne(deps.store, arg)
          return ok([
            `「${record.title}」 ${record.id}`,
            `调度：${scheduleText(record.schedule)}`,
            `状态：${record.status}｜下次 ${record.nextAt ?? '—'}｜已运行 ${record.runCount}${record.maxRuns === null ? '' : `/${record.maxRuns}`} 次`,
            `上次：${record.lastRunAt ?? '—'}（${record.lastRunStatus ?? '—'}）`,
            `模型：${record.model}`,
            `提示词：${record.prompt}`,
          ].join('\n'))
        }
        if (sub === 'pause' || sub === 'resume') {
          const record = resolveOne(deps.store, arg)
          const updated = applyUpdate(record, { enabled: sub === 'resume' }, {}, false, deps.defaultTimeZone, now())
          await deps.store.automations.put(updated.id, updated)
          return ok(`「${updated.title}」已${sub === 'pause' ? '暂停' : '恢复'}；${updated.status === 'completed' ? '已达上限，状态为完成' : `下次运行 ${updated.nextAt}`}。`)
        }
        if (sub === 'rm') {
          const record = resolveOne(deps.store, arg)
          const doomed = [...deps.store.runs.entries()].map(([, run]) => run).filter(run => run.cronId === record.id)
          for (const run of doomed) await deps.store.runs.delete(run.id)
          await deps.store.automations.delete(record.id)
          return ok(`已删除「${record.title}」及 ${doomed.length} 条运行记录。`)
        }
        if (sub === 'history') {
          const [key, count] = rest.filter(part => part !== '')
          const record = resolveOne(deps.store, key ?? '')
          const limit = Math.min(Math.max(Number(count) || 10, 1), 50)
          return history(record, limit)
        }
        return err(`未知子命令 "${sub}"。\n${USAGE}`)
      } catch (error) {
        return err(`执行失败：${error.message}`)
      }
    },
  }
}
