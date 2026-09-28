/**
 * The browser-facing Remote service over the cron store: the panel's single
 * read/write path, sharing store.js durability and manage.js validation with
 * the model tools. Methods return bare business values and throw on failure
 * (the gateway folds throws into the client-side error envelope, matching
 * every in-repo TypertRemoteService). Method markers are attached after the
 * class definition (plain-JS plugins cannot use decorator syntax); the shape
 * is the protocol's versioned prototype descriptor.
 */

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { applyUpdate, prepareCreate } from './manage.js'

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
   *           listWorkspaces: () => Array<{id: string, name: string, path: string}> }} deps - store tables and host facts.
   */
  constructor(ctx, deps) {
    super(ctx, 'cron')
    // Plain property, not a #private field: the gateway invokes Remote
    // methods through the Cordis service proxy, and private fields do not
    // survive a proxy receiver.
    this.cronDeps = deps
  }

  cronDeps

  /** Full catalog for the panel: automations, workspaces, and configured model routes. */
  async list() {
    let models = []
    try {
      models = await this.cronDeps.listModelRoutes()
    } catch {
      // Model discovery is advisory for the form dropdown; the panel still
      // renders when the llm service is absent or a provider fails.
      models = []
    }
    return {
      workspaces: this.cronDeps.listWorkspaces(),
      automations: [...this.cronDeps.automations.entries()].map(([, record]) => toEntry(record)),
      models,
    }
  }

  /** One remote-writable create over prepareCreate. */
  async create(request) {
    const workspaces = this.cronDeps.listWorkspaces()
    if (request.workspaceId === undefined || request.workspaceId === null
      || String(request.workspaceId).trim() === ''
      || (workspaces.length > 0 && !workspaces.some(w => w.id === request.workspaceId))) {
      throw new Error(`workspace_not_found: no workspace ${JSON.stringify(request.workspaceId)}`)
    }
    const nowMs = Date.now()
    const record = prepareCreate({
      workspaceId: request.workspaceId,
      title: request.title,
      prompt: request.prompt,
      model: request.model,
      ...(request.max_runs === undefined ? {} : { maxRuns: request.max_runs }),
    }, request.selector, this.cronDeps.defaultTimeZone, nowMs)
    await this.cronDeps.automations.put(record.id, record)
    return toEntry(record)
  }

  /** One remote-writable update over applyUpdate, guarded by the optimistic lock. */
  async update(request) {
    if (this.cronDeps.automations.get(request.id) === undefined) {
      throw new Error(`cron_not_found: no automation ${JSON.stringify(request.id)}`)
    }
    const nowMs = Date.now()
    let conflict = null
    const next = await this.cronDeps.automations.update(request.id, (current) => {
      if (current.nextAt !== request.expectedNextAt) {
        conflict = current
        return current
      }
      return applyUpdate(current, request.changes, request.changes.selector,
        request.changes.selector !== undefined, this.cronDeps.defaultTimeZone, nowMs)
    })
    if (conflict !== null) return { outcome: 'conflict', entry: toEntry(conflict) }
    return { outcome: 'updated', entry: toEntry(next) }
  }

  /** Enable/disable over the update path; completed records refuse revival. */
  async toggle(request) {
    const current = this.cronDeps.automations.get(request.id)
    if (current === undefined) {
      throw new Error(`cron_not_found: no automation ${JSON.stringify(request.id)}`)
    }
    if (current.status === 'completed') {
      throw new Error('cron_completed: the automation already completed; create a new one instead')
    }
    return this.update({ id: request.id, expectedNextAt: current.nextAt, changes: { enabled: request.enabled } })
  }

  /** Delete one automation together with its run records. */
  async delete(request) {
    if (this.cronDeps.automations.get(request.id) === undefined) {
      throw new Error(`cron_not_found: no automation ${JSON.stringify(request.id)}`)
    }
    for (const [runId, run] of this.cronDeps.runs.entries()) {
      if (run.cronId === request.id) await this.cronDeps.runs.delete(runId)
    }
    await this.cronDeps.automations.delete(request.id)
    return { id: request.id, deleted: true }
  }

  /** Run history of one automation, newest first. */
  async history(request) {
    if (this.cronDeps.automations.get(request.id) === undefined) {
      throw new Error(`cron_not_found: no automation ${JSON.stringify(request.id)}`)
    }
    const limit = Math.min(Math.max(request.limit ?? 20, 1), 200)
    const runs = [...this.cronDeps.runs.entries()]
      .map(([, run]) => run)
      .filter(run => run.cronId === request.id)
      .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
      .slice(0, limit)
    return { runs }
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
        { method: 'create', invocation: Object.freeze({ kind: 'direct' }) },
        { method: 'update', invocation: Object.freeze({ kind: 'direct' }) },
        { method: 'toggle', invocation: Object.freeze({ kind: 'direct' }) },
        { method: 'delete', invocation: Object.freeze({ kind: 'direct' }) },
        { method: 'history', invocation: Object.freeze({ kind: 'direct' }) },
      ]),
    }),
  })
