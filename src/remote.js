/**
 * The browser-facing Remote service over the cron store: the panel's single
 * read/write path, sharing store.js durability and manage.js validation with
 * the model tools. Method markers are attached after the class definition
 * (plain-JS plugins cannot use decorator syntax); the shape is the protocol's
 * versioned prototype descriptor.
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
    this.#deps = deps
  }

  #deps

  /** Full catalog for the panel: every workspace's automations plus the workspace list. */
  async list() {
    return { ok: true, value: {
      workspaces: this.#deps.listWorkspaces(),
      automations: [...this.#deps.automations.entries()].map(([, record]) => toEntry(record)),
    } }
  }

  /** One remote-writable create over prepareCreate. */
  async create(request) {
    try {
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
    } catch (error) {
      return failure(error)
    }
  }

  /** One remote-writable update over applyUpdate, guarded by the optimistic lock. */
  async update(request) {
    try {
      if (this.#deps.automations.get(request.id) === undefined) {
        throw new Error(`cron_not_found: no automation ${JSON.stringify(request.id)}`)
      }
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
    } catch (error) {
      return failure(error)
    }
  }
}

/** Fold one thrown error into the Remote failure branch (wire-identical to throwing). */
function failure(error) {
  return { ok: false, error: { message: String(error?.message ?? error) } }
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
      ]),
    }),
  })
