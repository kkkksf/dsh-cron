/**
 * The four model-facing tools over workspace automations: cron_create,
 * cron_list, cron_update, cron_delete. Tools are registered inside the root
 * Agent scope; every mutation persists to the cron store before answering,
 * and the scheduler picks changes up on its next tick.
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { applyUpdate, prepareCreate } from './manage.js'

/**
 * Canonical model-facing view of one automation record.
 * @param {object} record - the durable record.
 * @returns {object} the wire view.
 */
function cronView(record) {
  return {
    id: record.id,
    title: record.title,
    model: record.model,
    schedule: { ...record.schedule },
    status: record.status,
    maxRuns: record.maxRuns,
    runCount: record.runCount,
    nextAt: record.nextAt,
    lastRunAt: record.lastRunAt,
    lastRunStatus: record.lastRunStatus,
    createdAt: record.createdAt,
  }
}

/** Author-facing schema of the cron view. */
const CRON_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    title: { type: 'string', required: true },
    model: { type: 'string', required: true },
    schedule: { type: 'object', additionalProperties: true, required: true },
    status: { type: 'string', required: true, enum: ['active', 'paused', 'completed'] },
    maxRuns: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
    runCount: { type: 'integer', required: true },
    nextAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    lastRunAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    lastRunStatus: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
    createdAt: { type: 'string', required: true },
  },
}

/**
 * Register the four cron tools on the Agent-scoped context.
 * @param {object} agentCtx - the root Agent's context; tool registration dies with the Agent.
 * @param {object} deps - { store, defaultTimeZone, resolveWorkspace, now }.
 * @returns {() => void} the tool-registration disposer.
 */
export function registerCronTools(agentCtx, deps) {
  const now = deps.now ?? Date.now
  const tables = () => ({ automations: deps.store.automations, runs: deps.store.runs })

  const requireWorkspace = async () => {
    const workspace = await deps.resolveWorkspace()
    if (workspace === undefined) {
      throw new Error('the session cwd is not a registered workspace; open this project as a workspace first')
    }
    return workspace
  }

  const disposeCreate = agentCtx.tools.register(defineTool({
    name: 'cron_create',
    description:
      'Create a workspace automation that fires the prompt as a fresh headless session on a schedule. '
      + 'Pass exactly one selector: cron_expression (five-field, local time per time_zone), '
      + 'delay_minutes (one-shot from now), or interval + interval_unit (fixed spacing from creation). '
      + 'model is the explicit "provider/model" route for the fired session. '
      + 'Delivery is workspace-run: firing requires the dsh process to be running, missed recurring '
      + 'occurrences present only the latest one, and a one-shot missed while the process was down fires once on restart.',
    parameters: {
      title: { type: 'string', required: true, description: 'Short user-facing name of the automation.' },
      prompt: { type: 'string', required: true, description: 'The task the fired session performs verbatim.' },
      model: { type: 'string', required: true, description: 'Explicit "provider/model" route for the fired session.' },
      cron_expression: { type: 'string', description: 'Five-field cron expression (minute hour day-of-month month day-of-week).' },
      time_zone: { type: 'string', description: 'IANA zone for the cron expression; required when no default is configured.' },
      delay_minutes: { type: 'integer', description: 'One-shot delay from now, in whole minutes (stored as an absolute instant).' },
      interval: { type: 'integer', description: 'Fixed spacing multiplier, paired with interval_unit.' },
      interval_unit: { type: 'string', description: 'minute (default) | hourly | daily | weekly.' },
      max_runs: { type: 'integer', description: 'Stop after this many dispatched occurrences; omit to repeat while active.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { cron: { ...CRON_VIEW_SCHEMA, required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Created automation ${value.cron.title} (${value.cron.schedule.kind}) next at ${value.cron.nextAt}.`,
      }],
    },
    presentCall: args => ({ card: 'generic', title: 'Create cron automation', kind: 'other', rawInput: args }),
    async execute(args) {
      const workspace = await requireWorkspace()
      const { automations } = tables()
      const record = prepareCreate({
        workspaceId: workspace.id,
        title: args.title,
        prompt: args.prompt,
        model: args.model,
        ...(args.max_runs === undefined ? {} : { maxRuns: args.max_runs }),
      }, args, deps.defaultTimeZone, now())
      await automations.put(record.id, record)
      return { cron: cronView(record) }
    },
  }))

  const disposeList = agentCtx.tools.register(defineTool({
    name: 'cron_list',
    description: 'List this workspace\'s automations with status, next due time, and last run summary.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { crons: { type: 'array', items: CRON_VIEW_SCHEMA, required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.crons.length === 0
          ? 'No automations in this workspace.'
          : `${value.crons.length} automation(s): ${value.crons.map(cron => `${cron.title} [${cron.status}]`).join(', ')}.`,
      }],
    },
    presentCall: () => ({ card: 'generic', title: 'List cron automations', kind: 'other', rawInput: {} }),
    async execute() {
      const workspace = await requireWorkspace()
      const { automations } = tables()
      const crons = [...automations.entries()]
        .map(([, record]) => record)
        .filter(record => record.workspaceId === workspace.id)
        .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt))
        .map(cronView)
      return { crons }
    },
  }))

  const disposeUpdate = agentCtx.tools.register(defineTool({
    name: 'cron_update',
    description:
      'Update one automation by id: edit title/prompt/model/max_runs, pause or resume with enabled, '
      + 'or replace the schedule with exactly one new selector. A replaced schedule reschedules from now '
      + '(a one-shot keeps its absolute instant). Completed automations cannot be updated; create a new one.',
    parameters: {
      automation_id: { type: 'string', required: true, description: 'The automation id from cron_create/cron_list.' },
      title: { type: 'string', description: 'New short name.' },
      prompt: { type: 'string', description: 'New task prompt.' },
      model: { type: 'string', description: 'New explicit "provider/model" route.' },
      enabled: { type: 'boolean', description: 'false pauses; true resumes and reschedules from now.' },
      max_runs: { type: 'integer', description: 'New stop-after count.' },
      cron_expression: { type: 'string', description: 'Replacement schedule: five-field cron expression.' },
      time_zone: { type: 'string', description: 'IANA zone for a replacement cron expression.' },
      delay_minutes: { type: 'integer', description: 'Replacement schedule: one-shot delay from now.' },
      interval: { type: 'integer', description: 'Replacement schedule: spacing multiplier.' },
      interval_unit: { type: 'string', description: 'Replacement schedule: minute | hourly | daily | weekly.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: { cron: { ...CRON_VIEW_SCHEMA, required: true } },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Updated automation ${value.cron.title}: status ${value.cron.status}, next at ${value.cron.nextAt ?? 'never'}.`,
      }],
    },
    presentCall: args => ({ card: 'generic', title: 'Update cron automation', kind: 'other', rawInput: args }),
    async execute(args) {
      const workspace = await requireWorkspace()
      const { automations } = tables()
      const current = automations.get(args.automation_id)
      if (current === undefined || current.workspaceId !== workspace.id) {
        throw new Error(`cron_not_found: no automation ${JSON.stringify(args.automation_id)} in this workspace`)
      }
      const replacesSchedule = args.cron_expression !== undefined || args.delay_minutes !== undefined || args.interval !== undefined
      const updated = applyUpdate(current, {
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.prompt === undefined ? {} : { prompt: args.prompt }),
        ...(args.model === undefined ? {} : { model: args.model }),
        ...(args.enabled === undefined ? {} : { enabled: args.enabled }),
        ...(args.max_runs === undefined ? {} : { maxRuns: args.max_runs }),
        ...(args.cron_expression === undefined ? {} : { cron_expression: args.cron_expression }),
        ...(args.time_zone === undefined ? {} : { time_zone: args.time_zone }),
        ...(args.delay_minutes === undefined ? {} : { delay_minutes: args.delay_minutes }),
        ...(args.interval === undefined ? {} : { interval: args.interval }),
        ...(args.interval_unit === undefined ? {} : { interval_unit: args.interval_unit }),
      }, args, replacesSchedule, deps.defaultTimeZone, now())
      await automations.put(updated.id, updated)
      return { cron: cronView(updated) }
    },
  }))

  const disposeDelete = agentCtx.tools.register(defineTool({
    name: 'cron_delete',
    description: 'Delete one automation by id together with its complete run history. Deletion is immediate and permanent.',
    parameters: {
      automation_id: { type: 'string', required: true, description: 'The automation id from cron_create/cron_list.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          deleted: { type: 'string', required: true },
          removedRuns: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Deleted automation ${value.deleted} and ${value.removedRuns} run record(s).`,
      }],
    },
    presentCall: args => ({ card: 'generic', title: 'Delete cron automation', kind: 'other', rawInput: args }),
    async execute(args) {
      const workspace = await requireWorkspace()
      const { automations, runs } = tables()
      const current = automations.get(args.automation_id)
      if (current === undefined || current.workspaceId !== workspace.id) {
        throw new Error(`cron_not_found: no automation ${JSON.stringify(args.automation_id)} in this workspace`)
      }
      const doomed = [...runs.entries()].map(([, run]) => run).filter(run => run.cronId === current.id)
      for (const run of doomed) await runs.delete(run.id)
      await automations.delete(current.id)
      return { deleted: current.id, removedRuns: doomed.length }
    },
  }))

  return () => {
    disposeDelete()
    disposeUpdate()
    disposeList()
    disposeCreate()
  }
}
