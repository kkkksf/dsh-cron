# dsh-cron 全局面板实施计划

> **执行者须知：** 需配合 superpowers:subagent-driven-development（推荐）或
> superpowers:executing-plans 逐任务执行本计划。步骤用复选框（`- [ ]`）跟踪。

**目标：** 为 dsh-cron 提供宿主 remote 服务 + 浏览器全局面板（列表/详情/表单/
运行历史），实现 spec 的全部功能。

**架构：** 宿主侧新增 `CronRemoteService`（TypertRemoteService 子类，命名空间
`cron`），是浏览器唯一的读写入口，复用现有 store/domain；浏览器半体经
`dsh.client` 清单下发，`remote.$mount` 挂命名空间，主面板为 master-detail，
轮询刷新。

**技术栈：** 纯 ESM JavaScript（无 TypeScript、无构建依赖）；宿主测试用
Node 内置 `node --test`；浏览器产物用零依赖拼装脚本生成
`__ModuleLoader__` 工厂格式。

**Spec：** `docs/specs/2026-09-27-cron-global-panel-design.md`（本计划从 spec
出发，执行者须同时阅读两者）。

## 全局约束

- dsh 源码零改动；一切在 `E:\projects\dsh-cron` 内完成。
- 宿主包对 `@deepseek-ai/dsh-typert-protocol` 声明 peerDependency（解析方式
  与 dsh-memory 的 peer 相同，经由宿主 profile 的解析拦截）。
- 远程方法标记不能用装饰器语法（外部插件是纯 JS，不经 TS 转换）：类定义后用
  `Object.defineProperty` 手动写协议的版本化原型描述符，键为字符串
  `'@deepseek-ai/dsh-typert-protocol/remote-methods'`，值形状
  `{ version: 1, methods: [{ method, invocation: { kind: 'direct' } }, …] }`。
- 所有宿主 remote 方法返回 `RemoteResult` 信封：成功
  `{ ok: true, value }`；失败直接 `throw Error`（协议面自动折成
  `{ ok: false, error }`）。冲突不用错误分支，用成功信封内的
  `outcome: 'updated' | 'conflict'` 判别。
- 错误消息沿用 domain.js 现有格式（`cron_not_found: …` 等前缀风格）。
- 记录字段语义以现有代码为准：`status ∈ {'active','paused','completed'}`；
  「启用/停用」映射 active/paused；一次性任务跑完变 completed。
- 浏览器组件不接触 ctx：数据全部经注入的 catalog 源（plain data + 回调）。
- 每个用户可见文案进 locale 字典（`cron.manager` 命名空间，zh/en 双语）。
- 样式只用 `--dsw-*` 主题令牌，类名前缀 `dsh-cron-`，不用组件库。
- 提交信息用 conventional commits。
- 浏览器半体产物 `lib/client.js` 由 `node scripts/build-client.mjs` 生成，
  不手改；源文件在 `src/client/`。

## 审查要点（各任务测试之外的易错面）

1. **RemoteResult 信封解构**：`const { crons } = await remote.list()` 会静默
   得到 `undefined` 并在远处炸 React——每个调用点必须先判 `result.ok`
   （见 dsh-typert-controller-conventions 记忆）。→ Task 4 的 `callCron`
   统一收口并测试。
2. **slot 静默卸载**：浏览器半体任何未捕获渲染错误会让整个面板消失且无报错
   浮层。所有对 catalog 快照的读取带默认值（`?? []`、`?? {}`）。→ Task 9
   专门测试缺字段的快照。
3. **乐观锁误判**：调度器 claim 推进 `nextAt` 与用户编辑并发时必须返回
   `conflict` 而不是覆盖。→ Task 2 的并发用例。
4. **类型化写入教训**（dsh-settings-card-typed-writes）：表单到 wire 的每个
   字段带自己的 JSON 类型，`maxRuns` 用 `Number()`，不许整体 `String()`。
   → Task 7 表单序列化测试。
5. **completed 任务不可再启停**：一次性任务已完成后 toggle 必须报错而不是
   复活一个已完结记录。→ Task 3 的 completed 用例。

---

### Task 1: 宿主 remote 服务骨架与 `list()`

**Files:**
- Create: `src/remote.js`
- Modify: `src/index.js`（apply 内实例化服务）
- Modify: `package.json`（peerDependencies + `"test"` script）
- Test: `tests/remote.spec.mjs`

**Interfaces:**
- Consumes: `CronStore`（`store.automations` / `store.runs` 两个 jsonTable，
  `get/put/update/delete/entries`）；`domain.js` 现有导出。
- Produces: `class CronRemoteService`（构造签名
  `new CronRemoteService(ctx, deps)`，`deps = { automations, runs,
  defaultTimeZone, listWorkspaces }`）；实例方法均为 async、返回信封：
  - `list()` → `{ ok, value: { workspaces: Array<{id,name,path}>,
    automations: Array<CatalogEntry> } }`
  - `CatalogEntry = { id, workspaceId, title, prompt, model, status,
    schedule: { kind, expression?, timeZone?, everySeconds?, unit?, runAt? },
    maxRuns, nextAt, lastRunAt, lastRunStatus, runCount, createdAt, updatedAt }`
  - `listWorkspaces: () => Array<{id,name,path}>`（由 index.js 从
    workspaceRegistry 提供，无注册表时返回 `[]`）

- [ ] **Step 1: 写失败测试**

```js
// tests/remote.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { CronRemoteService } from '../src/remote.js'

/** 最小 fake ctx：Service 基类只要求一个带 effect/on 的 Context 形状。 */
function fakeCtx() {
  return {
    effect: () => () => {},
    on: () => () => {},
    emit: () => {},
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/remote.spec.mjs`
Expected: FAIL（`Cannot find module '../src/remote.js'`）

- [ ] **Step 3: 实现 `src/remote.js` 最小版**

```js
/**
 * The browser-facing Remote service over the cron store: the panel's single
 * read/write path, sharing store.js durability and domain.js validation with
 * the model tools. Method markers are attached after the class definition
 * (plain-JS plugins cannot use decorator syntax); the shape is the protocol's
 * versioned prototype descriptor.
 */

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'

/** Wire projection of one automation record (spec: CatalogEntry). */
function toEntry(record) {
  return {
    id: record.id, workspaceId: record.workspaceId, title: record.title,
    prompt: record.prompt, model: record.model, status: record.status,
    schedule: record.schedule, maxRuns: record.maxRuns, nextAt: record.nextAt,
    lastRunAt: record.lastRunAt, lastRunStatus: record.lastRunStatus,
    runCount: record.runCount, createdAt: record.createdAt, updatedAt: record.updatedAt,
  }
}

export class CronRemoteService extends TypertRemoteService {
  /**
   * @param {object} ctx - plugin context.
   * @param {{ automations: object, runs: object, defaultTimeZone: string,
   *           listWorkspaces: () => Array<{id,name,path}> }} deps - store tables and host facts.
   */
  constructor(ctx, deps) {
    super(ctx, 'cron')
    this.#deps = deps
  }

  #deps

  /** Full catalog for the panel: every workspace's automations plus the workspace list. */
  async list() {
    return { ok: true, value: {
      workspaces: this.#deps.listWorkspaces(),
      automations: [...this.#deps.automations.entries()].map(([, r]) => toEntry(r)),
    } }
  }
}

// Protocol method markers, attached in declaration order (see file header).
Object.defineProperty(CronRemoteService.prototype,
  '@deepseek-ai/dsh-typert-protocol/remote-methods', {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze([
        { method: 'list', invocation: Object.freeze({ kind: 'direct' }) },
      ]),
    }),
  })
```

- [ ] **Step 4: 跑测试确认通过**

Run: `node --test tests/remote.spec.mjs`
Expected: PASS（注意：fakeCtx 必须满足 cordis `Service` 基类的最小要求；若
构造时报 `ctx.effect is not a function` 之类，补 fake 字段而不是改产品代码）

- [ ] **Step 5: 接线 `src/index.js` 与 `package.json`**

`src/index.js` 在 `const scheduler = …` 之后加：

```js
import { CronRemoteService } from './remote.js'
// …
const cronRemote = new CronRemoteService(ctx, {
  store: undefined, // 占位见下；直接传表
  automations: store.automations,
  runs: store.runs,
  defaultTimeZone,
  listWorkspaces: () => {
    if (registry === undefined) return []
    return [...registry.entries?.() ?? []].map(w => ({ id: w.id, name: w.name, path: w.path }))
  },
})
```

（若 `workspaceRegistry` 没有 `entries()`，用其现有的枚举方法——先读
宿主类型声明确认；没有就遍历已知 automation 的 workspaceId 去重补名字。）

`package.json`：
- `scripts` 加 `"test": "node --test tests/"`
- `peerDependencies` 加 `"@deepseek-ai/dsh-typert-protocol": ">=0.1.0"`

- [ ] **Step 6: 全量测试 + 提交**

Run: `npm test` → PASS
```bash
git add src/remote.js src/index.js package.json tests/remote.spec.mjs
git commit -m "feat(remote): host cron remote service with list()"
```

---

### Task 2: `create()` / `update()`（含乐观锁）

**Files:**
- Modify: `src/remote.js`
- Test: `tests/remote.spec.mjs`

**Interfaces:**
- Consumes: `manage.js` 的 `prepareCreate(input, selector, defaultTimeZone,
  nowMs)` 与 `applyUpdate(current, input, selector, hasSelector,
  defaultTimeZone, nowMs)`（先读这两个函数全文再动笔；schedule 选择器词汇
  与工具一致：`cron_expression+time_zone` / `delay_minutes` /
  `interval+interval_unit`）。
- Produces:
  - `create(request)` → `{ ok, value: CatalogEntry }`；request =
    `{ workspaceId, title, prompt, model, selector, max_runs? }`（selector
    即 manage.js 的选择器形状，浏览器表单直接产出它）。
  - `update(request)` → `{ ok, value: { outcome:'updated'|'conflict', entry } }`；
    request = `{ id, expectedNextAt, changes: { title?, prompt?, model?,
    selector?, max_runs?, enabled? } }`；`expectedNextAt === null` 表示记录
    当前无 `nextAt`。冲突时返回最新 entry 供表单刷新。

- [ ] **Step 1: 写失败测试**（追加到 `tests/remote.spec.mjs`）

```js
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `node --test tests/remote.spec.mjs` → 新用例 FAIL（方法不存在）

- [ ] **Step 3: 实现 create/update（复用 manage.js，完整代码如下）**

```js
import { applyUpdate, prepareCreate } from './manage.js'

/** One remote-writable create request over prepareCreate. */
async create(request) {
  const nowMs = Date.now()
  const record = prepareCreate({
    workspaceId: request.workspaceId,
    title: request.title,
    prompt: request.prompt,
    model: request.model,
    ...(request.max_runs === undefined ? {} : { maxRuns: request.max_runs }),
  }, request.selector, this.#deps.defaultTimeZone, nowMs)
  await this.#deps.automations.put(record.id, record)
  return { ok: true, value: toEntry(record) }
}

/** One remote-writable update over applyUpdate, guarded by the optimistic lock. */
async update(request) {
  const nowMs = Date.now()
  let conflict = null
  const next = await this.#deps.automations.update(request.id, (current) => {
    if (current.nextAt !== request.expectedNextAt) {
      conflict = current
      return current
    }
    return applyUpdate(current, request.changes, request.changes.selector,
      request.changes.selector !== undefined, this.#deps.defaultTimeZone, nowMs)
  })
  if (conflict !== null) return { ok: true, value: { outcome: 'conflict', entry: toEntry(conflict) } }
  return { ok: true, value: { outcome: 'updated', entry: toEntry(next) } }
}
```

（`automations.update` 对不存在的 id 抛 `cron store has no record …`；
包一层转成 `cron_not_found: no automation "<id>"` 前缀——与 tools.js 的
措辞对齐。原型 methods 数组追加 `create`、`update` 两个 direct 条目。）

- [ ] **Step 4: 跑测试确认通过** → `node --test tests/remote.spec.mjs` PASS
- [ ] **Step 5: 提交**

```bash
git add src/remote.js tests/remote.spec.mjs
git commit -m "feat(remote): create/update with optimistic lock"
```

---

### Task 3: `toggle()` / `delete()` / `history()`

**Files:**
- Modify: `src/remote.js`
- Test: `tests/remote.spec.mjs`

**Interfaces:**
- Consumes: Task 2 的 `update()`（toggle 是它的 `enabled` 特例）；`store.runs` 表。
- Produces:
  - `toggle(request)` → `{ ok, value: { outcome:'updated'|'conflict', entry } }`
    （与 update 同形；实现 = 读当前记录取 `nextAt` 作 expected 后委托
    `update`）；对 `status==='completed'` 的记录 `applyUpdate` 抛
    `'the automation already completed; create a new one instead'`，包装成
    `cron_completed: …` 前缀抛出。
  - `delete(request)` → `{ ok, value: { id, deleted: true } }`；连带删除该
    cronId 的全部 run 记录。
  - `history(request)` → `{ ok, value: { runs: RunView[] } }`，request =
    `{ id, limit? }`（默认 20，上限 200）；`RunView = { id, status,
    occurrenceAt, startedAt, finishedAt, durationMs, sessionId, error }`，
    按 `startedAt` 降序。

- [ ] **Step 1: 写失败测试**（追加）

```js
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
```

- [ ] **Step 2: 确认失败** → `node --test tests/remote.spec.mjs`
- [ ] **Step 3: 实现**（toggle：`const current = automations.get(id)`，缺记录
  抛 `cron_not_found`；`current.status === 'completed'` 抛
  `cron_completed: the automation already completed`；否则
  `return this.update({ id, expectedNextAt: current.nextAt, changes: { enabled: request.enabled } })`。
  delete：先遍历 `runs.entries()` 删该 cronId 的记录，再删 automation。
  history：过滤 `cronId`、`startedAt` 降序、截断 limit、缺记录抛
  `cron_not_found`。原型 methods 追加三个条目）
- [ ] **Step 4: 确认通过** → `node --test tests/remote.spec.mjs` PASS
- [ ] **Step 5: 提交**

```bash
git add src/remote.js tests/remote.spec.mjs
git commit -m "feat(remote): toggle/delete/history"
```

---

### Task 4: 浏览器半体基建——catalog 源与 `$mount`，真实数据最小列表

**Files:**
- Create: `src/client/catalog.js`
- Create: `src/client/page.js`（本任务只做最小版：标题 + 条数 + 标题列表）
- Create: `scripts/build-client.mjs`
- Modify: `lib/client.js`（生成产物替换探针版）
- Test: `tests/catalog.spec.mjs`（node --test，用假 remote）

**Interfaces:**
- Consumes: `ctx.remote.$mount(contribution)`、`ctx.slots`、`ctx.locale`；
  客户端描述符常量 `CRON_DESCRIPTORS`（6 个方法，参数 wire 名统一
  `request`，`codec: { mode: 'src-json' }`，`invocation: { kind: 'direct' }`，
  `id` 形如 `'dsh-cron/list'`）。
- Produces:
  - `createCatalogSource({ call, now })` → `{ hooks: { catalog }, refresh,
    start, stop }`；`call(method, arg)` 是注入的远程调用函数（测试与生产
    共用此纯结构）；`catalog` 是 `ObservableSnapshot`
    （`getSnapshot()/subscribe(listener)`，快照形状
    `{ phase: 'loading'|'ready'|'error', workspaces, automations, error }`）。
  - 模块约定：`src/client/` 各文件用 `export`/`import`，拼装脚本按
    「catalog.js → page.js → entry 尾巴」的顺序 concat，外层包
    `window.__ModuleLoader__.load({ id: 'dsh-cron', factory })` 工厂；入口
    尾巴（entry.js 内容）负责 `exports.name/inject/apply`。

- [ ] **Step 1: 写 catalog 失败测试**

```js
// tests/catalog.spec.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { createCatalogSource } from '../src/client/catalog.js'

function snapshotOf(source) { return source.hooks.catalog.getSnapshot() }

test('首拉成功进入 ready；轮询后刷新；错误进入 error 不清空旧数据', async () => {
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
  source.start()
  await source.refresh()           // 首拉
  assert.equal(snapshotOf(source).phase, 'ready')
  assert.equal(snapshotOf(source).automations[0].id, 'a1')
  await source.refresh()           // 第二次抛错
  assert.equal(snapshotOf(source).phase, 'error')
  assert.equal(snapshotOf(source).automations[0].id, 'a1') // 旧数据保留
  assert.deepEqual(calls, ['list', 'list'])
  source.stop()
})
```

（`createCatalogSource` 在 node 下不得触碰 `window`/React——保持纯逻辑；
intervalMs 生产传 5000，测试传 0 表示不自动起 timer、只手动 refresh。）

- [ ] **Step 2: 确认失败** → `node --test tests/catalog.spec.mjs`
- [ ] **Step 3: 实现 catalog + 最小 page + 拼装脚本 + entry**

`src/client/catalog.js` 核心（`ok` 判断必须存在，见审查要点 1）：

```js
export function createCatalogSource({ call, intervalMs = 5000 }) {
  const listeners = new Set()
  let snapshot = { phase: 'loading', workspaces: [], automations: [], error: null }
  let timer = null
  let inflight = Promise.resolve()
  const publish = (next) => { snapshot = next; for (const l of listeners) l() }
  const refresh = () => {
    inflight = inflight.then(async () => {
      try {
        const result = await call('list', {})
        if (result.ok !== true) throw new Error(String(result.error?.message ?? result.error))
        publish({ phase: 'ready', workspaces: result.value.workspaces ?? [],
          automations: result.value.automations ?? [], error: null })
      } catch (error) {
        publish({ ...snapshot, phase: 'error', error: String(error?.message ?? error) })
      }
    })
    return inflight
  }
  return {
    hooks: { catalog: {
      getSnapshot: () => snapshot,
      subscribe: (l) => { listeners.add(l); return () => listeners.delete(l) },
    } },
    refresh,
    start() { refresh(); if (intervalMs > 0) timer = setInterval(refresh, intervalMs) },
    stop() { if (timer !== null) clearInterval(timer); timer = null },
  }
}
```

`src/client/page.js` 最小版（`h` 由拼装脚本注入的全局约定：各文件顶部
`import` 在拼装时被剥掉，统一用参数注入——拼装脚本把每个模块包成
`(exports, require, h) => { … }` 简单命名空间，实现方式自定但产物必须零
手工步骤可重建）。

`scripts/build-client.mjs`：读 `src/client/catalog.js`、`page.js`、
`entry.js`，剥掉模块头注释外的 `import`/`export` 关键字（或采用「每个文件
定义 `globalThis.__cronModules[name]`」的最简单方案），产出
`lib/client.js`，末尾打印产物字节数。**约定：拼装器只做机械变换，产物可
随时删除重建。**

`src/client/entry.js`（拼装尾部）：

```js
exports.name = 'dsh-cron-client'
exports.inject = ['slots', 'locale', 'remote']
exports.apply = function apply(ctx) {
  ctx.effect(() => ctx.locale.register('cron.manager', {
    zh: { panel: '定时任务', count: (n) => `${n} 个自动化` },
    en: { panel: 'Cron Tasks', count: (n) => `${n} automation(s)` },
  }), 'dsh-cron client: locale')
  const t = ctx.locale.bind('cron.manager')
  ctx.effect(async () => {
    const disposeMount = await ctx.remote.$mount({
      package: 'dsh-cron',
      descriptors: CRON_DESCRIPTORS /* catalog.js 里定义的常量 */,
    })
    const call = (method, request) => ctx.remote.cron[method](request)
    const source = createCatalogSource({ call })
    source.start()
    ctx.on('connection/reset', () => { source.refresh() })
    const disposeMain = ctx.slots.inject('main', () => ctx.slots.register(
      { name: 'main', key: 'cron', locale: 'cron.manager' }, CronPage))
    const disposeIcon = ctx.slots.inject('sidebar.panellist', () => ctx.slots.register(
      { name: 'sidebar.panellist', id: 'cron', order: 20, locale: 'cron.manager',
        label: () => t('panel') }, CronIcon))
    return () => { disposeIcon(); disposeMain(); source.stop(); disposeMount() }
  }, 'dsh-cron client: panel')
}
```

（`ctx.remote.cron[method]` 的挂载方法名与描述符一致；`CronIcon` 沿用探针
里的时钟 SVG。）

- [ ] **Step 4: node 测试通过 + 重建产物**

Run: `node --test tests/` → PASS；`node scripts/build-client.mjs` → 生成
`lib/client.js`。

- [ ] **Step 5: 浏览器冒烟（真实数据）**

```powershell
dsh --profile web --port 3180 --no-open   # 后台任务
```
打开带 token 的 URL → 点侧栏「定时任务」→ 面板应显示 store.json 里现有的
2 个自动化的真实标题；`node --test tests/` 仍 PASS。console 无报错。

- [ ] **Step 6: 提交**

```bash
git add src/client scripts/build-client.mjs lib/client.js tests/catalog.spec.mjs package.json
git commit -m "feat(client): browser half with $mount catalog and live list"
```

---

### Task 5: 完整列表页（搜索 / 筛选 / 徽标 / 相对时间）

**Files:**
- Modify: `src/client/page.js`（或拆出 `src/client/list.js`，由拼装脚本收录）
- Test: `tests/list.spec.mjs`（纯函数过滤逻辑）

**Interfaces:**
- Consumes: catalog 快照（Task 4 形状）。
- Produces: `filterAutomations(automations, { query, status })` → 过滤后的
  数组（query 对 title/prompt/cron 表达式不区分大小写子串；status ∈
  `'all'|'active'|'paused'|'completed'`）；`scheduleSummary(schedule, t)` →
  本地化摘要字符串；`relativeTime(iso, now)` → 「3 分钟后 / 2 小时前」式
  摘要。列表选中项回调 `onSelect(id)`。

- [ ] **Step 1: 写过滤/摘要失败测试**（`filterAutomations` 三种 status 分支、
  query 大小写、`scheduleSummary` 三种 kind、`relativeTime` 未来/过去/空）
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**（时间格式化只用 `Date` 与 `Intl.RelativeTimeFormat`
  或手写分钟/小时/天分档，勿引库）
- [ ] **Step 4: 确认通过 + 重建产物 + 浏览器冒烟**（搜索框输入即过滤）
- [ ] **Step 5: 提交** `feat(client): filterable automation list`

---

### Task 6: 详情页与运行历史

**Files:**
- Create: `src/client/detail.js`
- Modify: `src/client/page.js`（master-detail 布局挂接）
- Test: `tests/detail.spec.mjs`

**Interfaces:**
- Consumes: catalog 快照 + `call('history', { id, limit })`。
- Produces: `HistoryPane({ call, id, t })` 组件形状（内部自拉 history，快照
  `{ phase, runs }`，`runs` 条目字段同 Task 3 RunView）；详情区展示 entry 全
  部字段 + 操作按钮回调 `onEdit/onToggle/onDelete`。「打开会话」调
  `props.openSession(sessionId)`（由 entry 注入
  `id => ctx.uiWorkspace?.openSession(id)`，不可用时传 `null`，按钮置灰并
  显示 `t('detail.sessionUnavailable')`）。
- 详情为空态（未选中）显示 `t('detail.empty')`。

- [ ] **Step 1: 写 history 拉取逻辑测试**（`ok:false` 时 phase:'error' 且保留
  旧 runs；limit 传递正确；runs 排序信任宿主，客户端只渲染）
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现 detail.js 与布局挂接**（历史默认取 10 条，「加载更多」
  每次 +20，上限 200）
- [ ] **Step 4: 确认通过 + 重建产物 + 浏览器冒烟**（点列表项出详情；历史
  渲染宿主真实 runs——可先在会话里用 `/cron` 建一条一次性任务跑一轮产生数据）
- [ ] **Step 5: 提交** `feat(client): detail pane with run history`

---

### Task 7: 新建/编辑表单（类型化写入 + 乐观锁提示）

**Files:**
- Create: `src/client/form.js`
- Modify: `src/client/page.js`
- Test: `tests/form.spec.mjs`

**Interfaces:**
- Consumes: `call('create'|'update', …)`；catalog 的 workspaces（下拉）。
- Produces: `serializeForm(draft)` → wire request（**每个字段带自己的 JSON
  类型**：`maxRuns: draft.maxRuns === '' ? null : Number(draft.maxRuns)`，
  字符串字段 `String()`；这是审查要点 4）；`CronForm({ mode, entry,
  workspaces, defaultWorkspaceId, defaultModel, t, onSubmit, onCancel })`。
- 行为：保存成功 → `onSaved(entry)`；`outcome:'conflict'` → 表单顶部行内
  提示 `t('form.conflict')` 并把 entry 刷新进表单（不自动重提交）；校验错
  （标题/prompt 空、model 路由格式、cron 表达式五段）→ 对应字段下方行内
  错误，不发请求（客户端预校验只是体验，宿主仍是权威）。

- [ ] **Step 1: 写 serializeForm 与校验失败测试**（maxRuns 空串→null、
  数字字符串→Number、非法 model 路由被拒、三种 schedule 选择器互斥）
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现表单**（编辑模式初始值来自 entry；默认工作区/模型由
  page 注入——workspaceId 取当前会话工作区，模型取
  `props.defaultModel`，page 侧从会话路由读不到就空串）
- [ ] **Step 4: 确认通过 + 重建产物 + 浏览器端到端**：面板新建一条 → 列表
  出现 → 编辑改标题 → store.json 里核对（`Get-Content ~/.dsh/cron/store.json`）
- [ ] **Step 5: 提交** `feat(client): create/edit form with typed writes`

---

### Task 8: 启停 / 删除操作与行内确认

**Files:**
- Modify: `src/client/detail.js`
- Test: `tests/actions.spec.mjs`

**Interfaces:**
- Consumes: `call('toggle'|'delete', …)`。
- Produces: `useActionFeedback()` 小状态机（`idle|busy|error(message)`，
  供详情页三个操作共用）；删除为两段式（按钮 → 行内确认条「确认删除？
  [删除] [取消]」），确认后才发 `delete`；`toggle` 对
  `cron_completed` 错误行内显示宿主消息。所有操作完成后调
  `catalog.refresh()` 立即拉最新。

- [ ] **Step 1: 写状态机测试**（busy 期间重复点击被忽略；失败后回 idle 并
  带消息；成功回调触发）
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现 + 挂接**
- [ ] **Step 4: 确认通过 + 重建产物 + 浏览器端到端**（启停往返、删除后列
  表消失且 store.json 无该记录）
- [ ] **Step 5: 提交** `feat(client): toggle/delete with inline confirm`

---

### Task 9: 断连恢复与防御性渲染

**Files:**
- Modify: `src/client/page.js`、`src/client/catalog.js`
- Test: `tests/resilience.spec.mjs`

**Interfaces:**
- Consumes: catalog `phase:'error'`。
- Produces: 面板顶部横幅（`t('banner.disconnected')`），出现于
  `phase==='error'`；期间操作按钮禁用。所有快照读取走
  `withDefaults(snapshot)`（`workspaces ?? []`、`automations ?? []`、每条
  entry 的字段 `?? 默认`——空标题降级为 `t('list.untitled')`）。
  `connection/reset` 事件已由 entry 接 `source.refresh()`（Task 4 完成），
  本任务补「重连后 phase 回 ready、横幅消失」的路径测试。

- [ ] **Step 1: 写测试**（error 快照经 `withDefaults` 后渲染数据不炸；
  refresh 成功后 phase 回 ready；杀宿主进程再重启的浏览器实测放在
  Step 4）
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 确认通过 + 重建产物 + 浏览器实测**：面板开着 → 杀掉 3180
  实例 → 横幅出现、按钮禁用 → 重启实例（同端口）→ 横幅消失、列表恢复
- [ ] **Step 5: 提交** `feat(client): disconnect banner and defensive rendering`

---

### Task 10: 样式令牌化与双语收尾

**Files:**
- Create: `src/client/styles.js`（注入 `<style id="dsh-cron-styles">`，类名
  `dsh-cron-*`，颜色/圆角/间距全部 `var(--dsw-*)`；先读
  `packages/client/ui-theme/src/styles/` 里现有令牌名，选实际存在的）
- Modify: 全部 `src/client/*.js`（class 接线）、locale 字典补漏（空态、
  错误、按钮、横幅、相对时间单位）
- Test: 手测清单 + `node --test tests/` 全绿

- [ ] **Step 1: 样式与字典补全**（暗色主题下肉眼核对：切 dark 主题刷新）
- [ ] **Step 2: 全量测试 + 重建产物**
- [ ] **Step 3: 浏览器全流程回归**（spec「测试与验收」第 2 条清单逐项走）
- [ ] **Step 4: 更新 README**（新架构段落：remote 服务、浏览器半体、构建
  命令 `node scripts/build-client.mjs`、改完须重启 dsh web）
- [ ] **Step 5: 提交** `feat(client): themed styles and full locale coverage`

---

### Task 11: 并发冒烟与收尾

**Files:**
- 无新文件；可能微调 `src/remote.js`。

- [ ] **Step 1: 并发冒烟**：面板打开某任务详情 → 同一工作区的会话里用
  `cron_update` 工具改同一任务标题 → 5s 内面板列表自动出现新标题（轮询生
  效）；再在面板编辑该任务并保存 → 正常路径不误报 conflict（expectedNextAt
  取自最新轮询快照）
- [ ] **Step 2: 一次性任务全周期**：`delay_minutes: 1` 建一条 → 面板观察
  状态变 completed、历史出现 succeeded 记录
- [ ] **Step 3: `node --test tests/` 全绿；重建产物；探针实例关闭**
- [ ] **Step 4: 提交** `test: end-to-end smoke for cron panel`（如无代码变
  更则空提交记录验收，或把 README 验收清单一起提交）
