# dsh-cron 全局面板设计（spec）

- 日期：2026-09-27
- 状态：设计已通过（待实施计划）
- 项目：dsh-cron（外部 dsh 插件，`E:\projects\dsh-cron`）
- 探针证据：2026-09-27 浏览器探针已验证外部插件可以在 dsh 0.1.7-rc.2 上注册
  `sidebar.panellist` + keyed `main` 插槽并渲染静态面板，全程不改 dsh 源码。

## 目标

为 dsh-cron 提供一个专门的管理界面：dsh web 客户端里的全局面板（侧栏图标位于
「新建会话」与工作区列表之间；主列页面），支持对工作区定时任务的完整增删改查和
运行历史查看。deepseek-harness 源码零改动；一切能力随 dsh-cron 包自身携带
（浏览器半体经 `dsh.client` 清单下发）。

## 需求（用户已确认）

1. 全功能管理：列表、新建、编辑、启用/停用、删除、运行历史（不是只读，也不是
   「新建只在会话里做」）。
2. 作用域：全部工作区的自动化，每条标注所属工作区。
3. 详情呈现：面板内 master-detail（全局面板激活时右侧边栏未挂载——宿主结构不允许）。
4. 浏览器写入与模型工具共享同一个宿主 store；不引入第二份事实来源。

## 架构

```
宿主（dsh-cron Node 半体）
  CronRemoteService extends TypertRemoteService(ctx, 'cron')
    list / create / update / toggle / delete / history
    复用 store.js 原子写入 + domain.js 校验
        |  typert gateway（动态发现 typertRemote 绑定）
        v
浏览器半体（lib/client.js，经 dsh.client 清单下发的 cordis 客户端插件）
  remote.$mount({ package: 'dsh-cron', descriptors })  ->  ctx.remote.cron
  catalog 源：list() 轮询（面板可见期间每 5s + 每次写操作后 + connection/reset）
  sidebar.panellist 条目（id 'cron'，order 20）+ keyed main 插槽 'cron'
  master-detail 页面：列表 / 详情 / 表单 / 运行历史
```

关键决策：

- remote 服务是浏览器唯一的写入口；它调用调度器和工具使用的同一个 store，
  不引入新状态。
- 客户端用 `ctx.remote.$mount` 在运行时挂载命名空间，`InvocationDescriptor`
  手写（仓库内插件用生成的 api-remotes 装配；外部插件不能，而 `$mount` 正是
  运行时贡献的正规缝隙）。
- 宿主包 peer 依赖 `@deepseek-ai/dsh-typert-protocol`（已装 dsh 的
  node_modules 里存在；解析方式与 dsh-memory 的 peer 相同）。

## 宿主 Remote API（命名空间 `cron`）

所有方法返回 `RemoteResult` 信封（`{ok:true,value}` / `{ok:false,error}`）。
错误消息沿用 domain.js 现有格式（`cron_not_found`、表达式非法措辞……），
工具、`/cron`、面板三方共用同一套错误语义。

| 方法 | 入参 | 出参 |
|---|---|---|
| `list()` | — | `{ workspaces: {id,name,path}[], automations: CatalogEntry[] }`，含算好的 `nextAt` 与最近一次运行状态；`CatalogEntry` 字段以 store 记录为准（含 `runCount`） |
| `create(request)` | `{ workspaceId, title, prompt, model, schedule 选择器（与 cron_create 工具同一词汇：cron_expression+time_zone / delay_minutes / interval+interval_unit 三选一）, max_runs? }` | 新建的 `CatalogEntry` |
| `update(request)` | `{ id, expected: {nextAtMs}, 变更字段… }` | `{ outcome: 'updated' \| 'conflict', entry }`；`nextAtMs` 不匹配 → `outcome:'conflict'` 并附最新 entry（对调度器的乐观锁；不用错误分支，避免依赖传输层错误码） |
| `toggle(request)` | `{ id, enabled }` | `{ outcome, entry }`（与 update 同形；经 applyUpdate 的 enabled 分支——暂停保留 nextAt（store 不变量），恢复按 `resumeNextAtMs` 重算；completed 记录报错） |
| `delete(request)` | `{ id }` | `{ id, deleted }`（连带删除 run 记录） |
| `history(request)` | `{ id, limit? }` | `{ runs: RunRecord[] }`（时间、状态、耗时、产生的 sessionId） |

刷新策略（2026-09-28 修订）：浏览器转发事件白名单（api-remotes 的
`API_REMOTE_FORWARDED_EVENTS`）是 dsh 仓库内的编译期常量，外部插件的
`cron/changed` 进不去，因此实时性用轮询实现：面板可见期间每 5 秒 `list()`、
每次写操作后立即重拉、`connection/reset` 后全量重拉。调度器 tick 本身是 5s
粒度，轮询不损失可感知的时效。写操作的返回值直接携带最新 entry，本地立即
应用。

实现要点：

- `CronRemoteService` 在插件 `apply` 里于现有 store 单例之上实例化；方法标记
  采用协议的版本化原型描述符（纯 JS 不能用装饰器语法）。
- 校验与状态迁移**直接复用 `manage.js` 的 `prepareCreate` / `applyUpdate` /
  `buildSchedule`**（工具与浏览器共用同一套语义；schedule 词汇沿用工具的
  snake_case 选择器）。
- 服务导出形状须兼容 vendored loader 的 `unwrapExports`
  （`exports.default ?? exports`）。

## 面板 UI

`main` 'cron' 页内的 master-detail：

- 工具条：搜索框、状态筛选（全部/启用/停用）、新建按钮。
- 列表（约 38% 宽）：标题、工作区徽标、规则摘要（cron 表达式 /「每 N 分钟」/
  「一次性 延迟 N 分钟」）、下次执行相对时间、启用状态点。点击选中。
- 详情（约 62%）：标题 / 工作区 / 模型路由；调度规则 + 下次/最近执行；运行
  历史（默认最近 10 条，可加载更多；状态、触发时间、耗时，以及「打开会话」
  ——经 `ctx.uiWorkspace.openSession(sessionId)`，不可用时置灰并显示原因）；
  编辑 / 启停 / 删除操作。删除用行内二次确认，不用 `confirm()`。
- 表单（新建/编辑）：标题、工作区下拉（默认当前会话的工作区）、模型路由文本框
  （默认会话当前路由，格式校验）、调度选择器（三种，与 `cron_create` 对齐）、
  maxRuns、提示词文本域。校验错误行内显示。保存遇 `outcome:'conflict'` → 行内
  提示「任务已被修改，已刷新为最新值」，绝不静默覆盖。编辑期间轮询发现任务被
  外部修改 → 顶部出现「已有更新」提示条，不强制打断输入。
- 空态：未选中任务时显示引导。

## 样式、本地化与文件组织

- 样式：注入单个 `<style>` 元素，类名前缀 `dsh-cron-`，颜色/字体/间距全部引用
  `--dsw-*` 主题令牌（暗色主题自动跟随）。不引组件库。
- 本地化：`ctx.locale.register('cron.manager', { zh, en })`；所有用户可见文案
  （含空态、错误、按钮）进字典，跟随界面语言。
- 文件：宿主 `src/remote.js`；浏览器 `src/client/{page,list,detail,form,
  catalog,styles}.js` + 一个零依赖 node 拼装脚本产出 `lib/client.js`
  （`__ModuleLoader__` 工厂格式；dsh-memory 单文件手写方案的可维护化版本）。

## 错误处理

- Remote 失败（断连 / 宿主重启）：横幅「连接已断开，重连后自动恢复」，操作
  按钮禁用，`connection/reset` 后自动全量重拉。
- 业务错误（`cron_not_found`、表达式非法……）在触发操作的位置行内显示。
- slot 贡献崩溃会静默卸载（宿主行为）：catalog 数据带防御性默认值，所有
  `result.ok` 判断缺一不可。

## 测试与验收

1. 宿主单测：remote 方法到 store 读写的映射、乐观锁冲突、错误码（沿用现有
   store/domain 测试风格）。
2. 真实浏览器端到端（探针实例端口模式）：打开面板 → 新建 → 列表出现 →
   编辑/启停/删除 → 核对 `store.json` 落盘 → 刷新页面状态保持 → 断连重连恢复。
3. 并发冒烟：会话里 `cron_update` 工具与面板同时对同一任务修改；验证
   `cron/changed` 双向刷新两个界面。

## 范围之外

- 右侧边栏详情 tab（宿主结构：全局面板激活时该 seat 未挂载）。
- 跨宿主/远程访问、多用户问题。
- 对 deepseek-harness 源码的任何改动。
