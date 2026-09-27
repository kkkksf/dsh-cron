# dsh-cron

dsh 的工作区级定时任务插件：到点把任务提示词作为一条全新会话在所属工作区里执行，结果就是普通会话（可点击、可回看、可分支）。

外部插件，不改 dsh 源码；像 dsh-memory 一样挂进 profile。

## 安装

profile 的 `package.json`（`~/.dsh/profiles/web/package.json`）：

```json
{
  "dsh": { "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dsh-memory", "dsh-cron"] } },
  "dependencies": { "dsh-cron": "link:E:/projects/dsh-cron" }
}
```

然后在该目录 `pnpm install`。

## 使用

- **全局面板（推荐日常管理）**：dsh web 侧栏「定时任务」图标 → 主列管理页。
  列表（搜索 / 状态筛选 / 工作区徽标）+ 详情（调度规则、运行历史、打开会话）
  + 新建/编辑表单 + 启停/删除。面板每 5 秒轮询刷新，断连时显示横幅并禁用操作，
  重连自动恢复。
- 斜杠命令：
  - `/cron` — 列出全部任务
  - `/cron add <调度> <模型路由> :: <提示词>` — 新建；调度写法 `every:10m` / `every:2h` / `every:1d` / `every:1w`、`in:30m`（一次性延时）、`cron:0 9 * * 1-5`（五段式，默认时区 Asia/Shanghai）
  - `/cron pause <id前缀>` / `/cron resume <id前缀>` / `/cron rm <id前缀>`
  - `/cron info <id前缀>` / `/cron history <id前缀> [条数]`
- 模型工具（复杂参数直接对话）：`cron_create` / `cron_list` / `cron_update` / `cron_delete`
- 触发结果 = 所属工作区里的一个普通会话；任务提示词会被包一层 `[CRON AUTOMATION]` 框架说明

## 架构（面板）

- 宿主侧 `src/remote.js`：`CronRemoteService`（TypertRemoteService，命名空间
  `cron`），六方法（list/create/update/toggle/delete/history）复用 store 与
  manage.js 校验，是浏览器唯一的读写入口；方法返回裸业务值、错误 throw。
- 浏览器半体 `src/client/`：经 `dsh.client` 清单下发；`remote.$mount` 挂命名空间，
  轮询 catalog 源 + master-detail 页面；样式全走 `--dsw-*` 主题令牌，zh/en 双语。
- 构建：`npm run build:client`（零依赖拼装脚本产出 `lib/client.js`）。
  **改宿主侧或浏览器半体后须重启 dsh web**（产物在激活期被快照）。
- 测试：`npm test`（node --test；宿主 remote 单测 + 浏览器纯逻辑单测）。

## 语义

- 触发需要 dsh 进程活着；进程重启后，错过的循环任务只补最近一次，错过的一次性任务补跑一次
- 运行中的任务不会被下一次到点打断（重叠触发记为 skipped）
- `max_runs` 用尽后任务转 completed，不可再改，需新建
- 存储在 `$DSH_HOME/cron/store.json`（JSON，原子写）；删除任务同时删运行历史

## 配置（cordis.yml 行内 config）

| 字段 | 默认 | 说明 |
|---|---|---|
| tickMs | 5000 | 调度轮询间隔（1000-600000） |
| defaultTimeZone | Asia/Shanghai | cron 表达式默认时区 |
| storeDir | 空 = $DSH_HOME/cron | 存储目录 |

## 已知边界

- 电脑待机期间不触发（醒来后按上面的补跑规则恢复）
- 模型路由需是有效的 `provider/model`（如 `deepseek-official/deepseek-v4-flash`）
- 命令在全新的空白会话里可能不响应（dsh 已知问题，在有内容的会话里用）
