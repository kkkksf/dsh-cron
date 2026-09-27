/**
 * The browser-facing Remote service over the cron store: the panel's single
 * read/write path, sharing store.js durability and manage.js validation with
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
